/**
 * Fetch, alive (REWRITE.md § B3, § B5; W4 § A). The simulation decides what
 * Fetch does (`world.crew('fetch')`: state, stateTime, position, heading,
 * speed, carrying, lookAt) and where its body is (`world.motion('fetch')`);
 * this view decides how it looks while doing it, and outputs one rig pose
 * per frame (`kit/pieces/fetch-porter` rig).
 *
 * Split in two so the acting is testable in Node:
 *  - `FetchPerformer`: pure. Inputs (what the world says, the pointer, the
 *    events) in; a `FetchPose` and the root's matrix out. All motion is on
 *    the frame's simulation time and dt.
 *  - `createFetchView`: realizes the piece, feeds the performer, writes the
 *    nodes, keeps a contact shadow under the tyre.
 *
 * The acting, in one paragraph: the eye leads (pupil first, then the
 * turret, then the body); it balances on its wheel with tiny corrections;
 * it leans into a start, digs in to brake, and whips forward when it stops,
 * then skids back and settles; the wheel turns exactly with the ground; the
 * spring compresses on starts, stops and landings; the aerial lags and
 * wobbles and the pennant flutters with speed. Every state has its own
 * performance, short (§ B5: the visitor comes first) and never looping.
 */
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { BodyMode, CrewMember, FetchState, Id, Pose, SimEvent, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { fetchPorter, fetchNameTape } from '../kit/pieces/fetch-porter/index.ts';
import { PRESETS, WHEEL_R, contactPoint, poseMatrices, type ArmJoints, type Arms, type FetchPose } from '../kit/pieces/fetch-porter/rig.ts';
import { blendPose, handsUp as handsUpBeat, held as heldBeat, knocked as knockedBeat, knockedLength, outOfLane, setDown as setDownBeat, LENGTHS } from '../kit/pieces/fetch-porter/perform.ts';
import { BlobShadows, type Blob } from '../effects/blob-shadows.ts';
import {
  AngleSpring, Cadence, Derivative, Spring, SpringVec, clamp, damp, fbm1, lerp, outBack, reducedMotionParams, smoothstep, track, wrapAngle,
} from '../anim/index.ts';

// ───────────────────────── tuning ─────────────────────────

/** Tune here. Angles in radians, times in seconds. */
export const FETCH_FEEL = {
  /** Lean into acceleration (rad per unit/s²) and into speed (rad per unit/s). */
  leanAccel: 0.034,
  leanSpeed: 0.035,
  /** Lean back against a load. */
  leanLoad: -0.08,
  /** The whip forward when a run stops (rad/s kicked into the lean spring). */
  whip: 5.5,
  /** The scoot at a start: the wheel shoots out from under it before it leans in. */
  scoot: -1.0,
  /** Balance: tiny constant corrections (amplitudes, rad; wheel shuffle, units). */
  balanceFore: 0.022,
  balanceSide: 0.03,
  balanceShuffle: 0.012,
  /** The turret's limits of yaw (the rest goes to the eye, then the body). */
  headYawMax: 1.4,
  /** How far the body turns off its heading to face what it looks at, when its hands are free. */
  bodyTurnMax: 0.75,
  /** The pupil's full deflection is this much angle left over after the turret. */
  gazeRange: 0.5,
  /** Pointer: counts as near within this distance; as moving above this speed (units/s), for this long after. */
  pointerNear: 2.2,
  pointerMoving: 0.4,
  pointerMemory: 1.4,
  /** Blinks: every [min, max] seconds. */
  blink: [2.2, 5.5] as readonly [number, number],
  /** Wheel spin in the air when picked up (rad/s), and how long it takes to run down on its bearing (s). */
  heldSpin: 26,
  heldRunDown: 1.8,
  /** A knock's strength (the simulation's 1..3) as the performance's 0..1. */
  knock1: 0.3,
  knock2: 0.62,
  knock3: 1,
  /** A beat cut short (its state left early) fades into the acting under it over this long (s). */
  beatOut: 0.18,
  /** The load: the spring takes a crate arriving in its hands (kick), and springs up when it lets one go. */
  loadIn: 3.2,
  loadOut: -3.4,
} as const;

/** The feel, widened so any field can be overridden with any number. */
export type FetchFeel = { -readonly [K in keyof typeof FETCH_FEEL]: (typeof FETCH_FEEL)[K] extends readonly number[] ? readonly [number, number] : number };

const OFFER_LOOK = 0.9; // sim FETCH_TUNING.offerLook: when the offer turns from the crate to the visitor
const EYE_H = 1.07; // the turret's centre above the bench at rest
const BODY_H = 0.6; // where a hand holds it, above the root

// ───────────────────────── inputs and outputs ─────────────────────────

export interface FetchInput {
  /** Simulation seconds (frame.time) and the frame's dt. */
  time: number;
  dt: number;
  member: CrewMember;
  mode: BodyMode;
  /** The body's pose (centre of its box), interpolated for this frame, and whether it jumped (righting itself). */
  pose: Pose;
  teleport: boolean;
  /** Half extents of its body box (the root sits `half[1]` below the centre). */
  half: Vec3;
  pointer: Vec3 | null;
  hovered: boolean;
  /** Where the visitor is (the camera). */
  visitor: Vec3;
  /** The Button's cap, for the freeze's sidelong look. */
  button: Vec3 | null;
  /** The part in its hands, where it is now. */
  carriedAt: Vec3 | null;
  /** A part the visitor is carrying, if it is near: hands up for it. */
  nearHeld: Vec3 | null;
  /** Things worth a glance when nothing else is going on. */
  sights: readonly Vec3[];
  /** Events since last frame (any; it picks out its own). */
  events: readonly SimEvent[];
  reducedMotion: boolean;
}

export interface FetchOutput {
  pose: FetchPose;
  /** The root's world matrix (the piece's origin: on the bench, under the tyre). */
  root: Matrix4;
  /** Contact shadow: ground point, size and strength. */
  shadow: { x: number; z: number; y: number; r: number; strength: number };
}

// ───────────────────────── helpers ─────────────────────────

const J = (s: number, a: number, t: number, e: number, w: number, g: number): ArmJoints => ({ swing: s, abduct: a, twist: t, elbow: e, wrist: w, grip: g });
const KEYS: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'grip'];
const toVec = (a: ArmJoints): number[] => KEYS.map((k) => a[k]);
const fromVec = (v: readonly number[]): ArmJoints => J(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!);
function mixArm(a: ArmJoints, b: ArmJoints, t: number): ArmJoints {
  return J(lerp(a.swing, b.swing, t), lerp(a.abduct, b.abduct, t), lerp(a.twist, b.twist, t), lerp(a.elbow, b.elbow, t), lerp(a.wrist, b.wrist, t), lerp(a.grip, b.grip, t));
}
function mixArms(a: Arms, b: Arms, t: number): Arms {
  return { left: mixArm(a.left, b.left, t), right: mixArm(a.right, b.right, t) };
}
const add = (a: ArmJoints, d: Partial<ArmJoints>): ArmJoints => J(a.swing + (d.swing ?? 0), a.abduct + (d.abduct ?? 0), a.twist + (d.twist ?? 0), a.elbow + (d.elbow ?? 0), a.wrist + (d.wrist ?? 0), a.grip + (d.grip ?? 0));

/** Arms held out to the sides while dangling in the visitor's hand. */
const DANGLE: Arms = { left: J(0.7, 1.15, -0.5, 0.6, -0.4, 0.95), right: J(0.65, 1.2, -0.5, 0.7, -0.4, 0.9) };
/** Both claws up and open: "here, here" (a part carried near it). */
const HANDS_UP: Arms = { left: J(1.75, 0.5, -0.3, 0.6, 0, 1), right: J(1.7, 0.45, -0.3, 0.65, 0, 1) };
/** Reaching down and forward for a crate on the bench. */
const REACH: Arms = { left: J(1.05, -0.12, -0.25, 0.35, 1.57, 1), right: J(1.05, -0.12, -0.25, 0.35, 1.57, 1) };
/** Reaching up for a crate on top of the stack. */
const REACH_UP: Arms = { left: J(1.95, 0.05, -0.25, 0.3, 1.57, 1), right: J(1.95, 0.05, -0.25, 0.3, 1.57, 1) };
/** Arms swept back, hurrying. */
const HURRY: Arms = { left: J(-0.35, 0.25, -0.3, 1.1, -0.3, 0.2), right: J(-0.35, 0.25, -0.3, 1.1, -0.3, 0.2) };
/** Lobbing a crate onto the belt: thrust out at arm's length. */
const PLACE_OUT: Arms = { left: J(1.3, -0.16, -0.25, 0.3, 1.57, 0.55), right: J(1.3, -0.16, -0.25, 0.3, 1.57, 0.55) };
/** The simulation's place timings (sim FETCH_TUNING.place): turn, out, lower, back. */
const PLACE_T = { turn: 0.3, out: 0.4, lower: 0.18, back: 0.3 } as const;
/** Rotate [x, z] by `a` (as the performance's own spin frame does). */
const rot2 = (v: readonly [number, number], a: number): [number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

// the salute, keyed to the simulation's 1.1 s
const SALUTE = {
  // 0: look down at the empty hands; 0.38: snap; 0.85: drop
  arm: track([0, 0], [0.36, 0], [0.5, 1, outBack(2.2)], [0.84, 1], [1.08, 0]),
  look: track([0, 0], [0.3, 0], [0.42, 1], [1.1, 1]),
  tall: track([0, 0], [0.38, 0], [0.5, 1, outBack(1.6)], [0.85, 1], [1.1, 0]),
};
// the shrug, keyed to 1.2 s
const SHRUG = {
  up: track([0, 0], [0.22, 1, outBack(1.4)], [0.72, 1], [1.0, 0]),
};

// ───────────────────────── the performer ─────────────────────────

export class FetchPerformer {
  readonly feel: FetchFeel;
  private readonly seed: number;

  // ground motion
  private readonly yaw = new AngleSpring(0, { omega: 30, zeta: 0.7 });
  private readonly bodyTurn = new Spring(0, { omega: 6.5, zeta: 0.7 });
  private readonly vel = new Derivative(40);
  private readonly accel = new Derivative(16);
  private readonly sideVel = new Derivative(30);
  private readonly sideAcc = new Derivative(16);
  private lastP: Vector3 | null = null;
  private wheel = 0;
  private spin = 0;
  // body
  private readonly leanF = new Spring(0, { omega: 14, zeta: 0.42 });
  private readonly leanS = new Spring(0, { omega: 10, zeta: 0.38 });
  private readonly squash = new Spring(0, { omega: 17, zeta: 0.32 });
  private readonly aerial: SpringVec;
  private readonly leanRate = new Derivative(30);
  private flag = 0;
  private flagRate = 0;
  private readonly armL = new SpringVec(toVec(PRESETS.rest.left), { omega: 13, zeta: 0.5 });
  private readonly armR = new SpringVec(toVec(PRESETS.rest.right), { omega: 11.5, zeta: 0.5 });
  // head and eye
  private readonly headYaw = new Spring(0, { omega: 12, zeta: 0.58 });
  private readonly headPitch = new Spring(0, { omega: 12, zeta: 0.58 });
  private readonly headRoll = new Spring(0, { omega: 8, zeta: 0.45 });
  private readonly pupil = new SpringVec([0, 0], { omega: 70, zeta: 0.85 });
  private readonly pupilSize = new Spring(1, { omega: 14, zeta: 0.6 });
  private readonly lidT = new Spring(0.1, { omega: 30, zeta: 0.8 });
  private readonly lidB = new Spring(0.1, { omega: 30, zeta: 0.8 });
  private readonly brow = new Spring(0, { omega: 16, zeta: 0.5 });
  private readonly blinks: Cadence;
  private blinkAt = -Infinity;
  private readonly glances: Cadence;
  private readonly micro: Cadence;
  private sight = 0;
  private microOff: [number, number] = [0, 0];
  private lastLook: Vector3 | null = null;
  // pointer attention
  private readonly px = new Derivative(20);
  private readonly pz = new Derivative(20);
  private pointerMovedAt = -Infinity;
  // bookkeeping
  private live = 0; // seconds of unfrozen time (noise and cadences run on it)
  private act: FetchState = 'idle'; // the state being performed (frozen keeps the last)
  private frozenAt: number | null = null;
  private frozenHead: [number, number] | null = null;
  private righting = 0;
  private readonly rightFrom = new Quaternion();
  private readonly lastQ = new Quaternion();
  private readonly rootM = new Matrix4();

  constructor(seed = 7, feel: Partial<FetchFeel> = {}) {
    this.feel = { ...FETCH_FEEL, ...feel };
    this.seed = seed;
    this.aerial = new SpringVec([0, 0], { omega: 9, zeta: 0.18 });
    this.blinks = new Cadence(this.feel.blink[0], this.feel.blink[1], seed * 31 + 1, 0.8);
    this.glances = new Cadence(1.3, 3.2, seed * 31 + 2, 0.5);
    this.micro = new Cadence(0.35, 1.3, seed * 31 + 3, 0.2);
  }

  update(i: FetchInput): FetchOutput {
    const F = this.feel;
    const m = i.member;
    const frozen = m.state === 'frozen';
    const dt = Math.min(Math.max(i.dt, 0), 0.1);
    const db = frozen ? 0 : dt; // body time: nothing but the eye moves in a freeze
    this.live += db;
    const t = this.live;
    const st = m.stateTime;
    const rm = i.reducedMotion;
    if (rm) this.aerial.tune(reducedMotionParams({ omega: 9, zeta: 0.18 }));

    // ── events: the kicks that make starts, stops and landings land ──
    for (const e of i.events) {
      if (e.type === 'crew.state' && e.id === m.id) this.transition(e.from as FetchState, e.state as FetchState, i.time);
      if (e.type === 'part.hit' && (e.id === m.id || e.other === m.id) && i.mode === 'free') this.squash.kick(Math.min(6, e.strength * 1.4));
    }
    if (!frozen) {
      this.act = m.state;
      this.frozenAt = null;
    } else if (this.frozenAt === null) this.frozenAt = i.time;
    const act = this.act;
    const carrying = m.carrying !== null;
    const inHand = i.mode === 'held';
    const loose = i.mode === 'free';
    const grounded = i.mode === 'crew';

    // ── where the body is ──
    const P = new Vector3(i.pose.p[0], i.pose.p[1], i.pose.p[2]);
    const Q = new Quaternion(i.pose.q[0], i.pose.q[1], i.pose.q[2], i.pose.q[3]);
    if (i.teleport && grounded && !this.lastQ.equals(Q)) {
      // righting itself after being put down: swing up from where it lay
      this.rightFrom.copy(this.lastQ).multiply(Q.clone().invert());
      this.righting = 1;
      this.squash.kick(-3.2);
    }
    if (grounded) {
      this.yaw.step(m.heading, db);
    } else {
      const f = new Vector3(0, 0, 1).applyQuaternion(Q);
      this.yaw.set(Math.atan2(f.x, f.z));
    }
    const yaw = this.yaw.x;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // Fetch's left (+X local)

    // ground speed along the body, from the drawn positions (the wheel matches it exactly)
    let ds = 0;
    const moved = new Vector3();
    if (!frozen) {
      if (this.lastP && !i.teleport) {
        const d = moved.copy(P).sub(this.lastP);
        ds = d.dot(fwd);
        this.cumF += ds;
        this.cumS += d.dot(side);
      } else {
        this.vel.reset(true);
        this.sideVel.reset(true);
      }
      this.accel.push(this.vel.push(this.cumF, db), db);
      this.sideAcc.push(this.sideVel.push(this.cumS, db), db);
      this.lastP = P.clone();
    }
    const v = grounded ? this.vel.value : 0;
    const a = clamp(this.accel.value, -30, 30);
    const aSide = clamp(this.sideAcc.value, -30, 30);

    // ── pointer attention ──
    let pointerOn = false;
    let pointerNear = false;
    if (i.pointer) {
      const sx = this.px.push(i.pointer[0], dt);
      const sz = this.pz.push(i.pointer[2], dt);
      if (Math.hypot(sx, sz) > F.pointerMoving) this.pointerMovedAt = i.time;
      pointerNear = Math.hypot(i.pointer[0] - P.x, i.pointer[2] - P.z) < F.pointerNear;
      pointerOn = pointerNear || i.time - this.pointerMovedAt < F.pointerMemory;
    } else {
      this.px.reset();
      this.pz.reset();
    }
    if (rm && !i.hovered) pointerOn = pointerOn && i.time - this.pointerMovedAt < F.pointerMemory;

    // ── the performance: targets for this state ──
    const eyeBase = new Vector3(P.x, P.y - i.half[1] + EYE_H, P.z);
    const ahead = (d: number, y = 0.25): Vector3 => new Vector3(P.x + fwd.x * d, y, P.z + fwd.z * d);
    const visitor = new Vector3(...i.visitor);
    const pointer = i.pointer ? new Vector3(...i.pointer) : null;
    const carried = i.carriedAt ? new Vector3(...i.carriedAt) : null;
    const lookAt = m.lookAt ? new Vector3(...m.lookAt) : null;
    // hands up and where the eye goes otherwise: the simulation says (S5); a world without them, the view's own guess
    const handsUpNow = (m.handsUp ?? i.nearHeld !== null) && grounded && !frozen;
    const gazeAt = m.gaze ? new Vector3(...m.gaze.at) : !m.handsUp && i.nearHeld ? new Vector3(...i.nearHeld) : null;
    // the load: a crate arriving in its hands sinks it on its spring; letting one go, it springs up
    if (m.carrying !== this.wasCarrying && !frozen) {
      if (m.carrying && !this.wasCarrying) {
        this.squash.kick(F.loadIn);
        this.leanF.kick(-1.2);
        this.armL.kick([-2.5, 0, 0, 1.5, 0, 0]);
        this.armR.kick([-2.2, 0, 0, 1.3, 0, 0]);
      } else if (!m.carrying && this.wasCarrying && grounded) {
        this.letGoAt = i.time;
        this.squash.kick(F.loadOut);
        this.aerial.kick([-3, 0]);
      }
      this.wasCarrying = m.carrying;
    }

    let look: Vector3 = ahead(2);
    let arms: Arms = carrying ? PRESETS.carry : PRESETS.rest;
    let armOmega = 12;
    let lids: [number, number] = [0.12, 0.1];
    let brow = 0;
    let pupil = 1;
    let roll = 0;
    let squash = carrying ? 0.14 : 0;
    let fore = carrying ? F.leanLoad : 0.02;
    let sideLean = 0;
    let turnOk = !carrying;
    /** Face the visitor: the body takes most of the turn (a beat addressed to them). */
    let present = false;
    let blinkOk = true;
    let pointerOk = true;
    let wander = false;

    switch (act) {
      case 'idle': {
        wander = true;
        if (carried && !pointerOn && st < 0.5) look = carried; // a check on its load as it stops
        if (handsUpNow && gazeAt) {
          // the arms are the hands-up beat's (below); the eye stays on the thing carried
          look = gazeAt;
          pointerOk = false;
          wander = false;
        }
        break;
      }
      case 'roll':
      case 'return': {
        look = ahead(2.6, 0.75);
        const hurry = act === 'return';
        const braking = a * Math.sign(v || 1) < -3;
        lids = braking ? [0.32, 0.28] : hurry ? [0.22, 0.1] : [0.06, 0.12];
        brow = braking ? 0.45 : hurry ? 0.35 : -0.15;
        pupil = braking ? 0.9 : 1.05;
        fore += F.leanSpeed * v + (hurry ? 0.08 : 0);
        if (!carrying) {
          // arms swept back with speed; hurrying, they pump with the wheel
          const k = smoothstep(0.3, 2.2, Math.abs(v));
          arms = mixArms(PRESETS.rest, HURRY, k);
          if (hurry) {
            const ph = Math.sin(this.wheel * 0.45);
            arms = { left: add(arms.left, { swing: 0.4 * ph }), right: add(arms.right, { swing: -0.4 * ph }) };
          }
        }
        pointerOk = pointerOn && !hurry;
        break;
      }
      case 'skid': {
        look = ahead(1.6, 0.5);
        lids = [0, 0.05];
        brow = -0.6;
        pupil = 0.8;
        squash += 0.1;
        pointerOk = false;
        blinkOk = false;
        break;
      }
      case 'fumble': {
        pointerOk = false;
        blinkOk = false;
        const windup = 0.35;
        if (st < windup) {
          // the crate slips: arms juggle, body wobbles, the eye goes to the load
          const k = 1 - st / windup;
          const j = Math.sin(st * 2 * Math.PI * 7) * (0.4 + 0.6 * k);
          arms = { left: add(PRESETS.carry.left, { swing: 0.7 * j, abduct: 0.25 * j, grip: 0.35 }), right: add(PRESETS.carry.right, { swing: -0.6 * j, abduct: -0.2 * j, grip: 0.35 }) };
          armOmega = 22;
          look = carried ?? ahead(0.5, 0.6);
          sideLean = 0.2 * Math.sin(st * 2 * Math.PI * 3.5);
          squash = 0.25 * Math.abs(j);
          fore = -0.12;
          brow = -0.7;
          lids = [0, 0];
          pupil = 0.75;
        } else {
          // gone: flail, eye wide, pupil a pinprick, hard down at the crate
          const u = st - windup;
          arms = mixArms(PRESETS.flail, PRESETS.rest, smoothstep(0.35, 0.75, u));
          armOmega = 16;
          look = lookAt ?? ahead(1.2, 0);
          fore = 0.16 * (1 - smoothstep(0.2, 0.7, u));
          sideLean = 0.12;
          brow = -1;
          lids = [0, 0];
          pupil = 0.55;
          roll = 0.25;
          squash = 0.35 * (1 - smoothstep(0, 0.5, u));
        }
        break;
      }
      case 'offer': {
        pointerOk = false;
        if (st < OFFER_LOOK) {
          // looks at the crate it dropped: down, rueful
          look = lookAt ?? ahead(1, 0);
          arms = mixArms(PRESETS.rest, { left: add(PRESETS.rest.left, { swing: 0.2 }), right: add(PRESETS.rest.right, { swing: 0.2 }) }, smoothstep(0, 0.4, st));
          lids = [0.18, 0.22];
          brow = 0.25;
          pupil = 1.05;
          roll = -0.1;
          fore = 0.06;
          turnOk = true;
          blinkOk = st > 0.3 && st < 0.6;
        } else {
          // then up and out at the visitor: eye first, turret, body, and the hands a beat later
          const u = st - OFFER_LOOK;
          look = visitor;
          const hands = smoothstep(0.22, 0.45, u);
          arms = mixArms(PRESETS.rest, PRESETS.offer, hands);
          armOmega = 10;
          lids = [0.06, lerp(0.15, 0.55, smoothstep(0.3, 0.8, u))];
          brow = -0.15 - 0.25 * smoothstep(0, 0.25, u) * (1 - smoothstep(0.6, 1.2, u));
          pupil = 1.25;
          // a cock of the head on the ask, and once more ("well?") a little later, then still
          roll = 0.22 - 0.3 * smoothstep(3.2, 3.5, u) * (1 - smoothstep(4.3, 4.7, u));
          squash = -0.22;
          fore = 0.08;
          turnOk = true;
          present = u > 0.08;
          blinkOk = u > 1.6;
          // the ask holds the visitor's eye: only a pointer close by (their hand reaching in) takes it
          pointerOk = u > 2.4 && pointerNear;
          if (handsUpNow && gazeAt) {
            look = gazeAt;
            pointerOk = false;
          }
        }
        break;
      }
      case 'pickup': {
        // reach for the crate where it is: down and forward for one on the bench, up on its spring with the
        // claws high for the top of the stack; once it is coming into its hands, the arms bring it down
        const at = carried ?? lookAt;
        look = lookAt ?? carried ?? ahead(0.6, 0);
        pointerOk = false;
        const k = smoothstep(0, 0.25, st);
        const handY = P.y - i.half[1] + 2.48 * i.half[1] * 0.5;
        const high = at ? smoothstep(0.1, 0.7, (at.y - handY) / i.half[1]) : 0;
        const reach = mixArms(REACH, REACH_UP, high);
        if (carrying) arms = mixArms(PRESETS.carry, reach, high);
        else {
          arms = mixArms(PRESETS.rest, reach, k);
          arms = { left: { ...arms.left, grip: lerp(1, 0.55, smoothstep(0.32, 0.45, st)) }, right: { ...arms.right, grip: lerp(1, 0.55, smoothstep(0.32, 0.45, st)) } };
        }
        armOmega = 16;
        fore = k * lerp(0.3, 0.05, high);
        squash = k * lerp(0.3, -0.5, high);
        brow = 0.2;
        lids = [0.15, 0.2];
        turnOk = true;
        present = true; // the body turns to the crate (look is the crate here)
        break;
      }
      case 'shrug': {
        const up = SHRUG.up.sample(st);
        if (!carrying) arms = mixArms(PRESETS.rest, PRESETS.shrug, up);
        look = visitor;
        squash = (carrying ? 0.14 : 0) - 0.4 * up;
        roll = 0.3 * up;
        brow = -0.6 * up;
        lids = [lerp(0.12, 0.38, up), lerp(0.1, 0.18, up)];
        pupil = 1.05;
        pointerOk = false;
        turnOk = !carrying;
        present = !carrying;
        break;
      }
      case 'salute': {
        const s = SALUTE.arm.sample(st);
        const lk = SALUTE.look.sample(st);
        const tall = SALUTE.tall.sample(st);
        // first: what happened to my crate? (looking at its empty claws)
        const hands = new Vector3(P.x + fwd.x * 0.45, 0.45, P.z + fwd.z * 0.45);
        look = hands.lerp(visitor, lk);
        arms = mixArms({ left: { ...PRESETS.carry.left, grip: 1 }, right: { ...PRESETS.carry.right, grip: 1 } }, PRESETS.salute, s);
        if (st > 0.84) arms = mixArms(PRESETS.rest, PRESETS.salute, s);
        armOmega = st > 0.3 && st < 0.6 ? 26 : 14;
        brow = lerp(-0.45, 0.4, lk);
        lids = [lerp(0, 0.18, lk), lerp(0.05, 0.4, lk)];
        pupil = lerp(1.25, 1.05, lk);
        squash = -0.32 * tall;
        roll = -0.12 * tall;
        fore = lerp(0.1, -0.04, lk);
        turnOk = true;
        present = lk > 0.5;
        pointerOk = false;
        blinkOk = false;
        break;
      }
      case 'held': {
        pointerOk = false;
        blinkOk = false;
        arms = DANGLE;
        armOmega = 9;
        lids = [0, 0];
        brow = -0.85;
        pupil = 0.7;
        squash = inHand ? -0.6 : -0.3;
        // looks down at the drop, with one glance up at whoever has it
        const glance = inHand ? smoothstep(1.4, 1.6, st) * (1 - smoothstep(2.1, 2.3, st)) : 0;
        const down = new Vector3(P.x + fwd.x * 0.3, P.y - 3, P.z + fwd.z * 0.3);
        look = down.lerp(visitor, glance);
        if (loose) arms = PRESETS.flail;
        break;
      }
      case 'place': {
        // The belt is further from the lane than its arms reach: the simulation carries the crate out over
        // the belt from its hands. So it is a lob: turning to the belt it winds up (crouched on its spring,
        // leaning back, the crate drawn in), thrusts as the crate leaves its hands (up on its spring, over
        // on its wheel, jaws flung open), follows it with its eye and arms held out, and when it is down,
        // arms back with a bounce and a pleased lower lid.
        const t0 = PLACE_T.turn;
        look = carried ?? lookAt ?? ahead(0.9, 0.4);
        pointerOk = false;
        blinkOk = false;
        const hands = i.half[2] * 2.4; // how far from its centre the crate is still in its hands
        const flying = carried !== null && Math.hypot(carried.x - P.x, carried.z - P.z) > hands;
        if (flying && this.lobAt < this.placeAt) this.lobAt = i.time;
        const sinceLob = this.lobAt >= this.placeAt ? i.time - this.lobAt : -1;
        if (carrying && sinceLob < 0) {
          // the wind-up: the crate drawn in to the chest, crouched, leaning back
          const k = smoothstep(0, t0, st);
          const drawn: Arms = { left: add(PRESETS.carry.left, { swing: -0.25, elbow: 0.35 }), right: add(PRESETS.carry.right, { swing: -0.25, elbow: 0.35 }) };
          arms = mixArms(PRESETS.carry, drawn, k);
          armOmega = 14;
          fore = F.leanLoad - 0.08 * k;
          squash = 0.14 + 0.22 * k;
          brow = 0.35;
          lids = [0.25, 0.3];
          pupil = 0.9;
        } else if (carrying || i.time - this.letGoAt < 0.06) {
          // the thrust and the follow-through: out after it, jaws open, eye on it
          const u = Math.max(0, sinceLob);
          const thrust = 1 - smoothstep(0.12, 0.4, u);
          const open: Arms = { left: { ...PLACE_OUT.left, grip: lerp(0.55, 1, smoothstep(0.02, 0.08, u)) }, right: { ...PLACE_OUT.right, grip: lerp(0.55, 1, smoothstep(0.03, 0.09, u)) } };
          arms = open;
          armOmega = u < 0.15 ? 26 : 14;
          fore = 0.06 + 0.2 * thrust;
          squash = -0.35 * thrust + 0.05;
          brow = -0.45;
          lids = [0, 0.15];
          pupil = 1.2;
        } else {
          const u = i.time - this.letGoAt;
          const open: Arms = { left: { ...PLACE_OUT.left, grip: 1 }, right: { ...PLACE_OUT.right, grip: 1 } };
          arms = mixArms(open, PRESETS.rest, smoothstep(0.06, 0.3, u));
          look = lookAt ?? look;
          armOmega = 13;
          fore = 0.02 + 0.05 * (1 - smoothstep(0, 0.3, u));
          squash = -0.15 * (1 - smoothstep(0.05, 0.35, u));
          // done: a look at it on the belt, a pleased lower lid
          brow = -0.25;
          lids = [0.08, 0.38];
          pupil = 1.1;
          blinkOk = u > 0.25;
        }
        break;
      }
      case 'reach': {
        // the stretch is the performance's (outOfLane, below); the eye on what it wants
        look = lookAt ?? ahead(2, 0.3);
        pointerOk = false;
        blinkOk = false;
        turnOk = true;
        break;
      }
      case 'knocked': {
        // the body is the simulation's (shoved and spun); the lean, whip and wobble are the beat's (below)
        look = ahead(1.5, 0.4);
        pointerOk = false;
        blinkOk = false;
        turnOk = false;
        break;
      }
      case 'tap': {
        // attract mode: it taps the phone (sim TAP: the text goes at 0.45 s of 0.9). The claw nearer the phone
        // comes up and out, cocks back a hair, jabs once (with a dip of the body behind it), and draws back;
        // a quick look out at the visitor after the tap: "did you see that?"
        const ph = lookAt ?? ahead(0.8, 0.4);
        const rel = ph.clone().sub(P);
        const leftSide = rel.dot(side) > 0;
        const up = smoothstep(0, 0.28, st) * (1 - smoothstep(0.62, 0.88, st));
        const cock = smoothstep(0.24, 0.36, st) * (1 - smoothstep(0.36, 0.43, st));
        const jab = smoothstep(0.36, 0.44, st) * (1 - smoothstep(0.5, 0.64, st));
        const point = J(lerp(0.42, 1.35, up) - 0.25 * cock + 0.3 * jab, lerp(0.2, 0.25, up), 0, lerp(0.95, 0.35, up) + 0.3 * cock - 0.3 * jab, 0, lerp(0.3, 0.05, up));
        arms = leftSide ? { left: point, right: PRESETS.rest.right } : { left: PRESETS.rest.left, right: point };
        armOmega = st > 0.3 && st < 0.6 ? 28 : 14;
        fore = 0.04 + 0.1 * jab - 0.04 * cock;
        squash = 0.12 * jab;
        const glance = smoothstep(0.55, 0.65, st) * (1 - smoothstep(0.82, 0.9, st));
        look = ph.clone().lerp(visitor, glance);
        brow = lerp(0.3, -0.45, glance);
        lids = [lerp(0.2, 0.05, glance), lerp(0.25, 0.4, glance)];
        pupil = lerp(0.95, 1.2, glance);
        pointerOk = false;
        blinkOk = false;
        turnOk = true;
        break;
      }
      case 'frozen':
        break;
    }

    // ── the freeze: a held breath; only the eye slides to the Button ──
    if (frozen) {
      look = i.button ? new Vector3(...i.button) : this.lastLook ?? look;
      pointerOk = false;
      blinkOk = false;
    }

    // ── what to look at: the beat's target, what the simulation says it watches, the pointer, or a wander ──
    if (gazeAt && (pointerOk || wander) && !frozen && grounded) look = gazeAt;
    else if (pointerOk && pointerOn && pointer) look = pointer;
    else if (wander && !frozen) {
      if (!rm && this.glances.due(t)) this.sight = Math.floor(this.glances.random() * (i.sights.length + 2));
      const s = i.sights[this.sight];
      look = s ? new Vector3(...s) : this.sight === i.sights.length ? visitor : carried ?? ahead(2, 0.3);
    }
    if (i.hovered && grounded && !frozen && act !== 'offer') {
      // the pointer on it: up on its spring, eye on the visitor
      look = pointer ?? visitor;
      squash -= 0.25;
      pupil = Math.max(pupil, 1.2);
      brow = Math.min(brow, -0.35);
    }
    if (pointerOk && pointerOn) pupil = Math.max(pupil, 1.15);
    // micro-saccades: tiny re-aims while it fixates
    if (!rm && !frozen && this.micro.due(t)) this.microOff = [(this.micro.random() - 0.5) * 0.08, (this.micro.random() - 0.5) * 0.06];
    // a large change of target earns a blink (most of the time)
    if (this.lastLook && blinkOk && !rm && look.distanceTo(this.lastLook) > 2.5 && this.blinks.random() < 0.6) this.blinkAt = i.time;
    this.lastLook = look.clone();

    // ── head and eye: the eye leads, then the turret, then the body ──
    const rel = look.clone().sub(eyeBase);
    const ry = Math.atan2(rel.x, rel.z) - yaw - this.bodyTurn.x;
    const want = wrapAngle(ry);
    const wantPitch = Math.atan2(rel.y, Math.hypot(rel.x, rel.z));
    const turnMax = turnOk && grounded ? (present ? 1.35 : F.bodyTurnMax) : 0;
    // the body takes what the turret cannot comfortably reach (or, presenting, nearly all of it)
    const reach = present ? 0.25 : F.headYawMax - 0.45;
    const over = Math.abs(want) > reach ? want - Math.sign(want) * reach : 0;
    this.bodyTurn.step(turnMax ? clamp(this.bodyTurn.x + over, -turnMax, turnMax) : 0, db);
    let headYaw = this.headYaw.step(clamp(want, -F.headYawMax, F.headYawMax), db);
    let headPitch = this.headPitch.step(clamp(wantPitch + this.leanF.x * 0.8, -0.45, 0.5), db);
    if (frozen && this.frozenAt !== null) {
      // a held breath: the eye slides first; after a beat the turret creeps a little after it (a guilty peek)
      if (this.frozenHead === null) this.frozenHead = [headYaw, headPitch];
      const peek = smoothstep(0.7, 1.6, i.time - this.frozenAt) * 0.45;
      headYaw = this.headYaw.x = damp(headYaw, lerp(this.frozenHead[0], clamp(want, -F.headYawMax, F.headYawMax), peek), 3, dt);
      headPitch = this.headPitch.x = damp(headPitch, lerp(this.frozenHead[1], clamp(wantPitch, -0.45, 0.5), peek), 3, dt);
    } else this.frozenHead = null;
    const gx = (want - headYaw) / F.gazeRange + this.microOff[0];
    const gy = (wantPitch + this.leanF.x * 0.8 - headPitch) / F.gazeRange + this.microOff[1];
    const pupilV = this.pupil.step([clamp(gx, -1, 1), clamp(gy, -1, 1)], frozen ? 0 : dt);
    if (frozen) {
      // a slow slide, not a saccade
      const k = 1 - Math.exp(-5 * dt);
      pupilV[0] = this.pupil.x[0] = lerp(pupilV[0]!, clamp(gx, -1.2, 1.2), k);
      pupilV[1] = this.pupil.x[1] = lerp(pupilV[1]!, clamp(gy, -1.2, 1.2), k);
    }

    // blinks
    if (blinkOk && !rm && this.blinks.due(t)) this.blinkAt = i.time;
    if (!blinkOk) this.blinks.defer(t, 0.8);
    const ba = i.time - this.blinkAt;
    const blink = ba >= 0 && ba < 0.17 && blinkOk ? (ba < 0.06 ? ba / 0.06 : ba < 0.08 ? 1 : 1 - (ba - 0.08) / 0.09) : 0;
    const lidT = Math.max(this.lidT.step(lids[0] - (frozen ? 0.06 : 0), dt), blink);
    const lidB = Math.max(this.lidB.step(lids[1], dt), blink * 0.85);
    const browV = this.brow.step(frozen ? Math.min(this.brow.x, -0.2) : brow, dt);
    const pupilS = this.pupilSize.step(frozen ? 0.8 : pupil, dt);

    // ── balance: tiny constant corrections, a shuffle of the wheel under them ──
    const still = grounded && !rm && !frozen ? 1 - smoothstep(0.2, 1.2, Math.abs(v)) : 0;
    const bf = F.balanceFore * fbm1(t * 1.25, this.seed) * still;
    const bs = F.balanceSide * fbm1(t * 1.05, this.seed + 9) * still;
    const shuffle = F.balanceShuffle * fbm1(t * 1.25 - 0.18, this.seed) * still;

    // ── lean: into acceleration and speed; held, a pendulum ──
    let foreT: number;
    let sideT: number;
    if (grounded) {
      // the skid is a slide: the wheel goes back under it and the body stays thrown forward, then settles
      foreT = act === 'skid' ? fore + 0.2 * (1 - smoothstep(0, 0.45, st)) + bf : fore + F.leanAccel * a + bf;
      sideT = sideLean + bs - 0.04 * this.yaw.v * Math.sign(v || 0);
    } else {
      // off the bench: the body is where the hand (or the fall) has it; in the hand the swing is the held beat's
      foreT = 0;
      sideT = 0;
    }
    this.leanF.tune({ zeta: grounded ? 0.42 : 0.16, omega: grounded ? (carrying ? 12 : 14) : 7 });
    this.leanS.tune({ zeta: grounded ? 0.38 : 0.16, omega: grounded ? 10 : 7 });
    const leanF = this.leanF.step(clamp(foreT, -0.42, 0.42), db);
    const leanS = this.leanS.step(clamp(sideT, -0.32, 0.32), db);
    const leanAcc = this.leanRate.push(this.leanF.v, db);

    // ── spring ──
    const sq = this.squash.step(squash, db);

    // ── wheel: exactly the ground under it; in the air it spins ──
    if (!frozen) {
      if (grounded && !i.teleport) {
        // along the way the body is drawn facing (it may be turned off its heading), shuffle included
        const face = yaw + this.bodyTurn.x;
        const dsFace = moved.x * Math.sin(face) + moved.z * Math.cos(face);
        this.wheel += (dsFace + (shuffle - this.lastShuffle) * Math.cos(this.bodyTurn.x)) / WHEEL_R;
        this.spin = ds / Math.max(db, 1e-6) / WHEEL_R;
      } else if (inHand) {
        // spinning free in the air, running down on its bearing
        this.spin *= Math.exp(-db / F.heldRunDown);
        this.wheel += this.spin * db;
      } else {
        this.spin = damp(this.spin, 0, 1.2, db);
        this.wheel += this.spin * db;
      }
      this.lastShuffle = shuffle;
    }

    // ── arms ──
    const armBias = clamp(-0.03 * a, -0.4, 0.4); // they swing back when it pulls away
    const tl = add(arms.left, { swing: armBias }), tr = add(arms.right, { swing: armBias });
    this.armL.tune({ omega: armOmega * 1.08 });
    this.armR.tune({ omega: armOmega * 0.94 });
    const L = fromVec(this.armL.step(toVec(tl), db));
    const R = fromVec(this.armR.step(toVec(tr), db));

    // ── aerial and pennant: they lag the body ──
    const baseAcc = a + leanAcc * 0.9;
    const aerT = [clamp(-0.06 * baseAcc - 0.12 * v - leanF * 1.2, -1.4, 1.4), clamp(0.05 * aSide - this.leanS.v * 0.15 + leanS * 1.5, -1.2, 1.2)];
    const aer = this.aerial.step(aerT, db);
    const wind = Math.abs(v) / 2.6 + Math.hypot(this.aerial.v[0]!, this.aerial.v[1]!) * 0.08;
    this.flagRate = damp(this.flagRate, rm ? 0 : 1.2 + 14 * Math.min(1.5, wind), 4, db);
    if (still > 0.9 && wind < 0.05) this.flagRate = damp(this.flagRate, 0, 2, db);
    this.flag += this.flagRate * db;

    // ── roll of the head ──
    const rollV = this.headRoll.step(roll - leanS * 0.6, db);

    let pose: FetchPose = {
      lean: [leanF, leanS],
      wheel: this.wheel,
      squash: clamp(sq, -0.6, 1),
      headYaw,
      headPitch,
      headRoll: rollV,
      brow: clamp(browV, -1, 1),
      pupilSize: pupilS,
      gaze: [pupilV[0]!, pupilV[1]!],
      lids: [clamp(lidT, 0, 1), clamp(lidB, 0, 1)],
      arms: { left: L, right: R },
      aerial: [aer[0]!, aer[1]!],
      flag: this.flag,
    };

    // ── the beats (kit/pieces/fetch-porter/perform.ts), played over the acting and cross-faded ──
    const face = yaw + this.bodyTurn.x;
    const cf = Math.cos(face), sf = Math.sin(face);
    /** A world direction [x, z] in its own frame (+X its left, +Z its front). */
    const own = (x: number, z: number): [number, number] => [x * cf - z * sf, x * sf + z * cf];
    let beat: FetchPose | null = null;
    let bw = 0;
    let extraWheel = 0;
    if (act === 'knocked' && m.knock && !rm) {
      // shoved and spun: the simulation moves and turns the body, so the beat's own slide and spin are zeroed;
      // its lean, whip and wobble are kept, carried out of the beat's spun frame into the body's
      const kn = m.knock;
      const s = kn.strength >= 3 ? F.knock3 : kn.strength === 2 ? F.knock2 : F.knock1;
      const L = knockedLength(s);
      const tb = (st * L) / Math.max(0.1, kn.shove + kn.wobble);
      const from = own(-Math.sin(kn.dir), -Math.cos(kn.dir));
      const kp = knockedBeat(tb, { from, strength: s });
      const sp = kp.spin ?? 0;
      const tip = rot2([kp.lean![1], kp.lean![0]], -sp);
      kp.lean = [tip[1], tip[0]];
      const hd = rot2([kp.headRoll ?? 0, -(kp.headPitch ?? 0)], -sp);
      kp.headRoll = hd[0];
      kp.headPitch = -hd[1];
      kp.spin = 0;
      kp.slide = [0, 0];
      beat = kp;
      bw = smoothstep(0, 0.035, st) * (1 - smoothstep(L * 0.8, L, tb));
      // a wallop: the wheel spins wild while the tyre is off the bench
      extraWheel = (kn.spin >= 0 ? 1 : -1) * smoothstep(0.55, 1, s) * 9 * Math.max(0, Math.min(tb, 0.3) - 0.04);
    } else if (act === 'reach' && !rm) {
      const tgt = lookAt ?? ahead(2, 0);
      const op = outOfLane(st, { toward: own(tgt.x - P.x, tgt.z - P.z) });
      op.slide = [0, 0];
      beat = op;
      bw = smoothstep(0, 0.08, st);
    }
    if (beat) {
      this.lastBeat = beat;
      this.lastBeatW = bw;
      this.beatEnd = i.time;
      this.extraWheel = extraWheel;
    } else if (this.lastBeat) {
      // its state left early (the simulation moved on): let the beat go, not cut it
      const k = 1 - (i.time - this.beatEnd) / F.beatOut;
      if (k <= 0) this.lastBeat = null;
      else {
        beat = this.lastBeat;
        bw = this.lastBeatW * smoothstep(0, 1, k);
        extraWheel = this.extraWheel;
      }
    }
    if (beat && bw > 0) pose = blendPose(pose, beat, bw);
    // set down: the spring takes it, it steadies (from the moment it is back on its wheel)
    const sinceDown = i.time - this.downAt;
    if (grounded && sinceDown >= 0 && sinceDown < LENGTHS.setDown && !rm) {
      pose = blendPose(pose, setDownBeat(sinceDown, { from: this.lastHeld ?? undefined, spin: 6 }), 1 - smoothstep(0.55, LENGTHS.setDown, sinceDown));
    }
    // in the hand: the root at the hand, the torso held, the wheel and limbs a pendulum under it, trailing the hand
    this.heldW.step(inHand ? 1 : 0, dt);
    if (this.heldW.x > 1e-3) {
      if (inHand) {
        const hv = this.handV;
        const k = 1 - Math.exp(-12 * dt);
        const inv = db > 0 ? 1 / db : 0;
        hv.x += (moved.x * inv - hv.x) * k;
        hv.y += ((this.lastY === null ? 0 : (P.y - this.lastY) * inv) - hv.y) * k;
        hv.z += (moved.z * inv - hv.z) * k;
        const [lx, lz] = own(hv.x, hv.z);
        this.lastHeld = heldBeat(st, { carry: [lx, hv.y, lz], spin: 0 });
      }
      if (this.lastHeld) pose = blendPose(pose, this.lastHeld, clamp(this.heldW.x, 0, 1));
    }
    this.lastY = P.y;
    // hands up: something carried near it (the simulation says); the head and eye stay the acting's (on the thing)
    if (handsUpNow && !this.huWas) this.huAt = i.time;
    this.huWas = handsUpNow;
    this.huW.step(handsUpNow && !carrying ? 1 : 0, dt);
    if (this.huW.x > 1e-3 && !rm) {
      const hp = handsUpBeat(i.time - this.huAt);
      hp.headYaw = pose.headYaw ?? 0;
      hp.headPitch = (pose.headPitch ?? 0) + 0.12;
      hp.headRoll = pose.headRoll ?? 0;
      hp.gaze = pose.gaze ?? [0, 0];
      pose = blendPose(pose, hp, clamp(this.huW.x, 0, 1));
    } else if (handsUpNow && rm) pose = { ...pose, arms: HANDS_UP };
    // the wheel and the pennant are the acting's own (they turn with the ground and the air)
    pose.wheel = this.wheel + extraWheel;
    pose.flag = this.flag;
    pose.spin = 0;
    pose.slide = [0, 0];

    // ── the root ──
    const root = this.rootM;
    if (grounded) {
      const pos = new Vector3(P.x, P.y - i.half[1], P.z).addScaledVector(fwd, shuffle);
      let q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw + this.bodyTurn.x);
      if (this.righting > 0) {
        this.righting = Math.max(0, this.righting - db / 0.32);
        const k = this.righting * this.righting * (3 - 2 * this.righting);
        q = new Quaternion().slerp(this.rightFrom, k).multiply(q);
      }
      root.compose(pos, q, new Vector3(1, 1, 1));
    } else {
      // in the hand it hangs from the hand and twists round to face the visitor (a slow pendulum twist that
      // overshoots and settles); let go, it twists back to however it falls
      const fq = new Vector3(0, 0, 1).applyQuaternion(Q);
      if (inHand) {
        const rel = wrapAngle(Math.atan2(visitor.x - P.x, visitor.z - P.z) - Math.atan2(fq.x, fq.z));
        if (rm) this.twist.set(rel);
        else this.twist.step(this.twist.x + wrapAngle(rel - this.twist.x), dt);
      } else this.twist.v *= Math.exp(-8 * dt); // falling: it keeps the turn it had; it rights itself from there
      const tq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.twist.x);
      const off = new Vector3(0, -i.half[1], 0).applyQuaternion(Q).applyQuaternion(tq);
      root.compose(P.clone().add(off), tq.multiply(Q), new Vector3(1, 1, 1));
    }
    if (grounded) this.twist.set(0);
    if (!frozen) this.lastQ.setFromRotationMatrix(root);

    // contact shadow: under the tyre where the pose puts it (a lean, a hop), fading as it leaves the bench
    const [cx, cz] = contactPoint(pose);
    const foot = new Vector3(cx, 0, cz).applyMatrix4(root);
    const h = Math.max(0, foot.y) + Math.max(0, pose.lift ?? 0);
    // a contact shadow only: the stage's cast shadow does the rest once it leaves the bench
    const shadow = { x: foot.x, z: foot.z, y: 0, r: 0.2, strength: 1 - smoothstep(0, 0.3, h) };
    return { pose, root, shadow };
  }

  private wasCarrying: Id | null = null;
  private letGoAt = -Infinity;
  private placeAt = -Infinity;
  private lobAt = -Infinity;
  private downAt = -Infinity;
  private lastBeat: FetchPose | null = null;
  private lastBeatW = 0;
  private beatEnd = -Infinity;
  private extraWheel = 0;
  private lastHeld: FetchPose | null = null;
  private readonly heldW = new Spring(0, { omega: 22, zeta: 1 });
  private readonly twist = new Spring(0, { omega: 4.5, zeta: 0.32 });
  private readonly handV = new Vector3();
  private lastY: number | null = null;
  private huWas = false;
  private huAt = -Infinity;
  private readonly huW = new Spring(0, { omega: 16, zeta: 1 });
  private cumF = 0;
  private cumS = 0;
  private lastShuffle = 0;

  private transition(from: FetchState, to: FetchState, time: number): void {
    const F = this.feel;
    if (to === 'frozen') return;
    if (from === 'frozen') {
      // the breath out
      this.squash.kick(1.4);
      this.blinkAt = time + 0.05;
      return;
    }
    if (to === 'roll' || to === 'return') {
      this.leanF.kick(F.scoot);
      this.squash.kick(2.2);
      this.aerial.kick([-2.5, 0]);
    }
    if (from === 'roll' && to !== 'roll') {
      // the stop: the body whips forward over the wheel, the spring takes it, the aerial snaps
      this.leanF.kick(F.whip);
      this.squash.kick(5);
      this.aerial.kick([6, 0.8]);
      this.armL.kick([3, 0, 0, -1, 0, 0]);
      this.armR.kick([3.4, 0, 0, -1, 0, 0]);
    }
    if (from === 'skid') {
      this.leanF.kick(1.1);
      this.squash.kick(1.6);
      this.aerial.kick([2.5, 0]);
    }
    if (from === 'return' && to === 'idle') {
      this.leanF.kick(2.4);
      this.squash.kick(2.2);
      this.aerial.kick([5, 0]);
    }
    if (to === 'held') {
      this.squash.kick(-5);
      // lifted, the wheel flies up to speed (the way it was turning, or forward)
      this.spin = (Math.sign(this.spin) || 1) * F.heldSpin;
    }
    if (from === 'held' && to === 'return') this.downAt = time;
    if (to === 'knocked') this.squash.kick(4);
    if (to === 'place') this.placeAt = time;
    if (to === 'fumble') this.squash.kick(0.8);
    if (from === 'fumble' && to === 'offer') this.squash.kick(-1);
  }
}

// ───────────────────────── the view ─────────────────────────

export interface FetchViewOptions {
  /** The scale it is drawn at (the bench's crew scale): its contact shadow is sized to match. Default 1. */
  scale?: number;
  /** Seed for its own variation (blinks, glances, balance) and the piece's wear. */
  seed?: number;
  /** Contact shadow strength (0 = none). Default: strong on the low tier, faint on high. */
  shadow?: number;
  feel?: Partial<FetchFeel>;
}

export function createFetchView(opts: FetchViewOptions = {}): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const seed = opts.seed ?? 7;
    const root = new Group();
    root.name = 'fetch';
    ctx.scene.add(root);
    const body = new Group();
    body.name = 'fetch:body';
    body.matrixAutoUpdate = false;
    root.add(body);
    const piece = fetchPorter({ seed, detail: ctx.tier === 'low' ? 'low' : 'high', nameTape: fetchNameTape(ctx.labels) });
    const obj = ctx.realize(piece);
    body.add(obj);
    const nodes = new Map<string, Object3D>();
    obj.traverse((o) => {
      if (o.name && !o.name.includes('.')) nodes.set(o.name, o);
    });
    const opacity = opts.shadow ?? (ctx.tier === 'low' ? 0.85 : 0.55);
    const shadows = opacity > 0 ? new BlobShadows(ctx.materials.decal(), 1, opacity).addTo(root) : null;
    const blob: Blob = { x: 0, z: 0, rx: 0.2, rz: 0.2, strength: 0 };
    const perf = new FetchPerformer(seed, opts.feel);
    let registered: Id | null = null;
    const pa = new Vector3();
    const pb = new Vector3();
    const qa = new Quaternion();
    const qb = new Quaternion();
    const camPos = new Vector3();
    // the carried crate is drawn in its hands: the body's offset from its unanimated pose is applied to the
    // crate's drawn matrix (the parts view rewrites that matrix every frame, so this view must update after it)
    const ms0 = poseMatrices({});
    const bodyRest0 = ms0.lean!.clone().multiply(ms0.body!);
    const restRoot = new Matrix4();
    const bodyNow = new Matrix4();
    const delta = new Matrix4();
    const yAxis = new Vector3(0, 1, 0);
    const qYaw = new Quaternion();
    const one = new Vector3(1, 1, 1);
    let carriedObj: { id: Id; o: Object3D | undefined } | null = null;
    // the catch: the simulation puts a picked-up crate straight into its hands; the drawn crate hops there
    let catchFrom: { id: Id; m: Matrix4; t0: number | null } | null = null;
    const ca = { p: new Vector3(), q: new Quaternion(), s: new Vector3() };
    const cb = { p: new Vector3(), q: new Quaternion(), s: new Vector3() };
    const CATCH = 0.3;
    const dp = { p: new Vector3(), q: new Quaternion(), s: new Vector3() };
    const dd0 = { p: new Vector3(), q: new Quaternion(), s: new Vector3() };

    const view: StationView = {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const spec = w.scene.runner;
        const id = spec.id;
        if (registered !== id) {
          ctx.pickable(id, body);
          registered = id;
        }
        const member = w.crew(id);
        const motion = w.motion(id);
        if (!member || !motion || motion.mode === 'chute') {
          body.visible = false;
          return;
        }
        body.visible = true;
        const teleport = motion.prev === motion.pose;
        pa.set(...motion.prev.p);
        pb.set(...motion.pose.p);
        qa.set(...motion.prev.q);
        qb.set(...motion.pose.q);
        if (!teleport && frame.alpha < 1) {
          pa.lerp(pb, frame.alpha);
          qa.slerp(qb, frame.alpha);
        } else {
          pa.copy(pb);
          qa.copy(qb);
        }
        const half = w.halfExtents(id) ?? [0.3, 0.5, 0.26];
        const cam = (ctx.stage.camera as { camera?: { position: Vector3 } }).camera;
        if (cam) camPos.copy(cam.position);
        else camPos.set(...spec.outward);
        const ped = w.scene.statics.find((s) => s.id === `${w.button().id}-pedestal`);
        const button: Vec3 | null = ped && ped.shape.type === 'box' ? [ped.pose.p[0], ped.pose.p[1] + ped.shape.half[1], ped.pose.p[2]] : null;
        const carriedAt = member.carrying ? (w.motion(member.carrying)?.pose.p ?? null) : null;
        let nearHeld: Vec3 | null = null;
        const h = w.holding();
        if (h?.kind === 'part' && h.id !== id) {
          const hp = w.motion(h.id)?.pose.p;
          if (hp && Math.hypot(hp[0] - pb.x, hp[2] - pb.z) < 1.6) nearHeld = hp;
        }
        const sights: Vec3[] = [];
        for (const sid of w.scene.button.stack) {
          const p = w.motion(sid)?.pose.p;
          if (p) {
            sights.push(p);
            break;
          }
        }
        if (button) sights.push(button);
        const out = perf.update({
          time: frame.time,
          dt: frame.dt,
          member,
          mode: motion.mode,
          pose: { p: [pa.x, pa.y, pa.z], q: [qa.x, qa.y, qa.z, qa.w] },
          teleport,
          half,
          pointer: frame.pointer,
          hovered: frame.hovered === id && !w.bracketed,
          visitor: [camPos.x, camPos.y, camPos.z],
          button,
          carriedAt,
          nearHeld,
          sights,
          events: frame.events,
          reducedMotion: ctx.reducedMotion || w.reducedMotion === true,
        });
        body.matrix.copy(out.root);
        body.matrixWorldNeedsUpdate = true;
        const ms = poseMatrices(out.pose);
        for (const [name, mat] of Object.entries(ms)) {
          if (name === 'root') continue;
          const o = nodes.get(name);
          if (o) mat.decompose(o.position, o.quaternion, o.scale);
        }
        if (member.carrying && motion.mode === 'crew' && w.mode(member.carrying) === 'crew') {
          if (carriedObj?.id !== member.carrying) carriedObj = { id: member.carrying, o: ctx.scene.getObjectByName(`part:${member.carrying}`) };
          const c = carriedObj.o;
          if (c) {
            restRoot.compose(pb.set(pa.x, pa.y - half[1], pa.z), qYaw.setFromAxisAngle(yAxis, member.heading), one);
            restRoot.multiply(bodyRest0).invert();
            bodyNow.copy(out.root).multiply(ms.lean!).multiply(ms.body!);
            delta.multiplyMatrices(bodyNow, restRoot);
            // only a crate in its hands rides its body; one the simulation carries out of reach (the lob onto
            // the belt) is where the simulation says, or a lean would swing it a long way at arm's length
            c.matrix.decompose(dp.p, dp.q, dp.s);
            const dd = Math.hypot(dp.p.x - pa.x, dp.p.z - pa.z);
            const wr = 1 - smoothstep(half[2] * 2.0, half[2] * 2.6, dd);
            if (wr >= 1) c.matrix.premultiply(delta);
            else if (wr > 0) {
              c.matrix.premultiply(delta).decompose(dd0.p, dd0.q, dd0.s);
              dp.p.lerp(dd0.p, wr);
              dp.q.slerp(dd0.q, wr);
              c.matrix.compose(dp.p, dp.q, dp.s);
            }
            if (catchFrom && catchFrom.id === member.carrying) {
              catchFrom.t0 ??= frame.time;
              const k = (frame.time - catchFrom.t0) / CATCH;
              if (k >= 1) catchFrom = null;
              else {
                const e = k * k * (3 - 2 * k);
                catchFrom.m.decompose(ca.p, ca.q, ca.s);
                c.matrix.decompose(cb.p, cb.q, cb.s);
                ca.p.lerp(cb.p, e);
                ca.p.y += 0.3 * Math.sin(Math.PI * k);
                ca.q.slerp(cb.q, e);
                c.matrix.compose(ca.p, ca.q, cb.s);
              }
            }
            c.matrixWorldNeedsUpdate = true;
          }
        } else if (member.state === 'pickup' && member.lookAt) {
          // remember where the crate it is about to take is drawn
          let best: Id | null = null;
          let bd = 0.2;
          for (const part of w.parts()) {
            const mp = w.motion(part.id)?.pose.p;
            if (!mp || part.id === id) continue;
            const d = Math.hypot(mp[0] - member.lookAt[0], mp[1] - member.lookAt[1], mp[2] - member.lookAt[2]);
            if (d < bd) {
              bd = d;
              best = part.id;
            }
          }
          const o = best ? ctx.scene.getObjectByName(`part:${best}`) : undefined;
          if (best && o) catchFrom = { id: best, m: o.matrix.clone(), t0: null };
        }
        if (shadows) {
          blob.x = out.shadow.x;
          blob.z = out.shadow.z;
          blob.rx = blob.rz = out.shadow.r * (opts.scale ?? 1);
          blob.strength = out.shadow.strength;
          shadows.set(blob.strength > 0.03 ? [blob] : []);
        }
      },
      dispose() {
        shadows?.dispose();
        root.removeFromParent();
      },
    };
    return view;
  };
}
