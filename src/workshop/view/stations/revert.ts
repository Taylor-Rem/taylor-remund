/**
 * Revert, the caretaker, and its hatch, alive (REWRITE.md § B5 "Revert", § B4
 * "Revert's card", § B2 X3; W3 brief § 1). The kit's `revert` and
 * `revert-hatch` pieces, driven by Revert's view state
 * (`world.machine('revert-crew')`, kind `revert`) and the step's events.
 *
 * Revert is never in a hurry, and deadpan is the whole character:
 *  - up through its hatch: the doors kick open and bounce on their stops, the
 *    lift waits for them, then rams up and clunks past its stop; the body
 *    settles on its treads;
 *  - trundling: the treads turn by the distance it actually covered (each side
 *    its own, so a turn on the spot counter-rotates them), the nose lifts as
 *    it pulls away and dips as it stops, a small chatter while it moves;
 *  - the crank: winds up, turns backwards through the rewind, winds down; the
 *    body leans into each turn; one eye squeezed, looking at the work;
 *  - the card: rises folded out of the deck on its stick, flips open facing
 *    the visitor with a wobble, the arm jabs at it; folded and dropped back;
 *  - the face: flat lids, a slow blink now and then; after a press a slow
 *    glare at the visitor (at most a second and a half); rolled eyes when
 *    picked up; asleep in the window's light with one eye open, watching;
 *  - the sweep: the arm takes the broom off its rack, pushes, and the part
 *    hops into the dustpan and on to where the simulation put it;
 *  - the cover: at the Button, the arm up and a turn of the wrist;
 *  - picked up: heavy and limp, treads sagging, the arm swinging.
 *
 * Reduced motion: no idles, blinks, glares, chatter or wobble; poses are
 * reached on short critically damped springs (one place: `R`).
 *
 * The card's words are content (any `card` event by Revert's body; text
 * from `src/content/`): Revert's card is a redrawable region of the label
 * atlas; while the card is stowed in its slot the next card's label is
 * copied into it and the card node is scaled to that label's size.
 */
import { Group, Matrix4, Quaternion, Vector3, type Object3D, type Texture } from 'three';
import type { Id, Pose, RevertView, SimEvent, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { contentById } from '../labels/content.ts';
import { revert as revertPiece, revertCard, poseRevertInto, revertScratch, cardMatrixInto, POSES, ARMS, CARD_CAP, SHOULDER, BODY_Y, armReach, broomMatrix, HULL } from '../kit/pieces/revert/index.ts';
import type { ArmJoints, RevertPose } from '../kit/pieces/revert/index.ts';
import { broomGrip } from '../kit/pieces/revert/rig.ts';
import { revertHatch, poseHatch, liftHeight } from '../kit/pieces/revert-hatch/index.ts';
import { Spring, SpringVec, Cadence, noise1, clamp, clamp01, lerp, smoothstep, damp } from '../anim/index.ts';
import { createHops, type PartHops } from './hops.ts';

/** Tune here. Seconds, radians, units of the piece (it is drawn at `scale`). */
export const REVERT_FEEL = {
  /** The doors: spring (they kick open and bounce off their stops) and how much speed a bounce keeps. */
  doorOmega: 13,
  doorDamping: 0.5,
  doorBounce: 0.32,
  /** The lift waits for the doors: it starts once the simulation's lift passes this. */
  liftWait: 0.28,
  /** The ram: spring onto its stop, and how far past the stop it may go (liftHeight clamps 1.03). */
  liftOmega: 8.5,
  liftDamping: 0.62,
  /** The body on its treads: bob and pitch springs; a landing kick; nose-up per unit/s² of acceleration. */
  bodyOmega: 16,
  bodyDamping: 0.42,
  landKick: -0.35,
  pitchPerAccel: -0.05,
  rollPerTurn: 0.035,
  chatter: 0.005,
  /** The crank: its top rate (rad/s, backwards for a rewind), the spring that winds it up and down, the lean per turn. */
  crankRate: 8,
  crankOmega: 7,
  crankDamping: 0.85,
  crankWindup: 0.5,
  crankLean: 0.035,
  /** The face: springs on the lids, the brow and the gaze. */
  lidOmega: 11,
  lidDamping: 0.75,
  gazeOmega: 6,
  gazeDamping: 0.8,
  blink: [3.6, 7.5] as readonly [number, number],
  blinkShut: 0.07,
  blinkOpen: 0.13,
  /** The glare after a press: waits, comes on slowly, holds, goes (≤ 1.5 s in all, § B5). */
  glare: { wait: 0.25, on: 0.55, hold: 0.4, off: 0.3 },
  /** The card: the stick's rise, the flip open, and the fold down. */
  cardOmega: 11,
  /** A new card's label is copied into Revert's card a band of this many texel rows a frame (no hitch). */
  copyRows: 32,
  /** Before it rises: the card's top peeks out of the slot this far (fraction of its rise) and waits this long. */
  peek: 0.09,
  peekHold: 0.3,
  /** Held up: a little over the stick's rest height (the rig allows 1.15), so the deadpan face shows under it. */
  hold: 1.13,
  cardDamping: 0.58,
  openAt: 0.8,
  openOmega: 15,
  openDamping: 0.42,
  openWobble: 14,
  wobbleOmega: 12,
  wobbleDamping: 0.22,
  foldTime: 0.14,
  dropTime: 0.26,
  /** The arm: spring between its poses. */
  armOmega: 10,
  armDamping: 0.6,
  /** The sweep: reach for the broom, take it out, push. */
  sweepReach: 0.3,
  sweepOut: 0.45,
  strokeHz: 1.7,
  stowTime: 0.55,
  /** Picked up: the treads' sag spring, the arm's swing. */
  sagOmega: 9,
  sagDamping: 0.25,
  swingOmega: 7,
  swingDamping: 0.18,
  swingGain: 0.06,
  /** Held: how far the treads hang away from the body (the rig's bob), and how hard the hand's moves swing them. */
  heldDrop: 0.07,
  heldSwing: 0.035,
  /** Put down any way but upright: it rights itself over this long (on its back or side; tipped a little). */
  rightBig: 1.5,
  rightSmall: 0.35,
} as const;

/**
 * Righting itself: progress 0..1 from how it lay to upright. Tipped a little it just settles;
 * on its back it rocks, falls back, rocks harder, falls back less, and goes over with a lurch.
 */
function rightCurve(u: number, big: boolean): number {
  const x = Math.min(1, Math.max(0, u));
  if (!big) return x * x * (3 - 2 * x);
  const keys = [[0, 0], [0.16, 0.2], [0.3, 0.04], [0.5, 0.36], [0.62, 0.16], [0.86, 1.06], [1, 1]] as const;
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (x <= t1) {
      const [t0, v0] = keys[i - 1]!;
      const k = (x - t0) / (t1 - t0);
      return v0 + (v1 - v0) * k * k * (3 - 2 * k);
    }
  }
  return 1;
}

export interface RevertViewOptions {
  /** The hatch's origin on the bench (x, z) and the scale both are drawn at. */
  hatch: readonly [number, number];
  scale: number;
  /** The piece's origin relative to its body's centre, in the piece's frame at `scale` (x, z): the footprint's centre minus the origin. */
  centre: readonly [number, number];
  seed?: number;
  /** Revert's unit id (default 'revert-crew'). */
  id?: Id;
}

export interface RevertViewState {
  lift: number;
  doors: number;
  crank: number;
  card: { content: string | null; lift: number; open: number };
  eyes: RevertView['eyes'] | null;
}

export interface RevertStationView extends StationView {
  readonly state: RevertViewState;
}

type CardPhase = 'stowed' | 'up' | 'fold' | 'drop';

const tmpM = new Matrix4();
const tmpS = new Matrix4();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const Y = new Vector3(0, 1, 0);

/** Every card Revert may hold up (content ids): the rungs, the deck, and its own two. */
const REVERT_CARDS = ['card.rung1', 'card.rung2', 'card.rung3', 'card.rung4', 'card.deck.1', 'card.deck.2', 'card.deck.3', 'card.deck.4', 'card.deck.5', 'card.deck.6', 'card.revert.kept', 'card.revert.nothing'];

/** Where the dustpan's mouth is, in Revert's root (piece) space. */
const DUSTPAN = new Vector3(HULL.w / 2 + 0.11, 0.5, 0.06);

export function createRevertView(opts: RevertViewOptions): (ctx: ViewContext) => RevertStationView {
  return (ctx) => {
    const F = REVERT_FEEL;
    const S = opts.scale;
    const unitId = opts.id ?? 'revert-crew';
    const seed = opts.seed ?? 3;
    const detail = ctx.tier === 'low' ? 'low' : 'high';
    // reduced motion, in one place: no idles or wobbles; springs critically damped
    // (the boot's setting, or the world's at run time: § B10; checked every frame in `update`)
    let R = ctx.reducedMotion;
    const z = (zeta: number): number => (R ? Math.max(1, zeta) : zeta);
    const springs: [Spring | SpringVec, number][] = [];
    const reg = <S extends Spring | SpringVec>(sp: S, zeta: number): S => {
      springs.push([sp, zeta]);
      return sp;
    };

    const root = new Group();
    root.name = 'revert-station';
    ctx.scene.add(root);

    // the hatch, where the layout puts it
    const hatchObj = ctx.realize(revertHatch({ seed, detail }));
    hatchObj.scale.setScalar(S);
    hatchObj.position.set(opts.hatch[0], 0, opts.hatch[1]);
    root.add(hatchObj);

    // Revert, its card a region of the label atlas the size of its first card (the longest rung line):
    // each card it holds up is that card's label, copied into the region; the node is scaled to the
    // card's own size, so a card of another size shows at its own proportions
    const first = revertCard(ctx.labels, 'rung1');
    const region = ctx.labels.region('revert-card', { w: first.w, h: first.h });
    const card0 = { key: region.key, w: first.w, h: first.h };
    const body = new Group();
    body.name = 'revert';
    body.matrixAutoUpdate = false;
    root.add(body);
    const obj = ctx.realize(revertPiece({ seed, detail, card: card0 }));
    obj.scale.setScalar(S);
    body.add(obj);
    const cardNode = obj.getObjectByName('card');
    const regionPx = new Uint8Array(region.px.w * region.px.h * 4);

    // ── state ──
    let placed = false;
    let bodyId: Id = 'revert';
    let top = 0;
    let hy = 0.672;
    const doors = { x: 0, v: 0 };
    const lift = reg(new Spring(0, { omega: F.liftOmega, zeta: z(F.liftDamping) }), F.liftDamping);
    const bob = reg(new Spring(0, { omega: F.bodyOmega, zeta: z(F.bodyDamping) }), F.bodyDamping);
    const pitch = reg(new Spring(0, { omega: F.bodyOmega * 0.7, zeta: z(F.bodyDamping) }), F.bodyDamping);
    const roll = reg(new Spring(0, { omega: F.bodyOmega * 0.7, zeta: z(F.bodyDamping) }), F.bodyDamping);
    const crankRate = reg(new Spring(0, { omega: F.crankOmega, zeta: z(F.crankDamping) }), F.crankDamping);
    let crankAngle = 0;
    let crankingSince = -Infinity;
    const lids = reg(new SpringVec([0.6, 0.6], { omega: F.lidOmega, zeta: z(F.lidDamping) }), F.lidDamping);
    const slant = reg(new SpringVec([0, 0], { omega: F.lidOmega * 0.6, zeta: z(F.lidDamping) }), F.lidDamping);
    const brow = reg(new SpringVec([0.3, 0], { omega: F.lidOmega * 0.6, zeta: z(F.lidDamping) }), F.lidDamping);
    const gaze = reg(new SpringVec([0, 0], { omega: F.gazeOmega, zeta: z(F.gazeDamping) }), F.gazeDamping);
    const arm = reg(new SpringVec(jointsOf(ARMS.tucked), { omega: F.armOmega, zeta: z(F.armDamping) }), F.armDamping);
    const sag = reg(new Spring(0, { omega: F.sagOmega, zeta: z(F.sagDamping) }), F.sagDamping);
    const swing = reg(new Spring(0, { omega: F.swingOmega, zeta: z(F.swingDamping) }), F.swingDamping);
    let travelL = 0;
    let travelR = 0;
    const blinks = new Cadence(F.blink[0], F.blink[1], seed + 11);
    let blinkAt = -Infinity;
    let glareAt = -Infinity;
    // the card
    let cardPhase: CardPhase = 'stowed';
    let cardAt = 0;
    let cardContent: string | null = null;
    let cardWant: string | null = null;
    const cardLift = reg(new Spring(0, { omega: F.cardOmega, zeta: z(F.cardDamping) }), F.cardDamping);
    const cardOpen = reg(new Spring(0, { omega: F.openOmega, zeta: z(F.openDamping) }), F.openDamping);
    const wobble = reg(new Spring(0, { omega: F.wobbleOmega, zeta: z(F.wobbleDamping) }), F.wobbleDamping);
    let foldFrom = { lift: 1, open: 1 };
    const cardSize = { w: card0.w, h: card0.h };
    const cardScale = { x: 1, y: 1 };
    // the broom
    let broom = 0;
    let sweepEnd = -Infinity;
    let stroke = 0;
    // the fit
    let fitTurn = 0;
    // interpolation of the simulation's place
    let lastStep = -1;
    const prev = { x: 0, z: 0, h: 0 };
    const cur = { x: 0, z: 0, h: 0 };
    let lastX = 0, lastZ = 0, lastH = 0, lastSpeed = 0;
    let wasDrawn = true;
    let wasLift = 0;
    const lastPose = new Vector3();
    const lastVel = new Vector3();
    const hops: PartHops = createHops(ctx.scene);
    const scratch = revertScratch();
    const jointsTmp = [0, 0, 0, 0, 0];
    const goal2 = [0, 0];
    const hatchPosed = [NaN, NaN];
    const heldVel = [0, 0];
    const rightQ = new Quaternion();
    const rightP = new Vector3();
    const rightV = new Vector3();
    let rightAt = -Infinity;
    let rightFor = 0;
    let rightBig = false;
    const pose: RevertPose = { travel: [0, 0], lids: [0.6, 0.6], slant: [0, 0], gaze: [0, 0], brow: 0, browRoll: 0, lamps: [true, true], card: { lift: 0, open: 0, wobble: 0 }, arm: { yaw: 0, swing: 0, elbow: 0, wrist: 0, grip: 0 }, broom: 0, stroke: 0, crank: 0, bob: 0, pitch: 0, roll: 0, sag: 0 };
    const state: RevertViewState = { lift: 0, doors: 0, crank: 0, card: { content: null, lift: 0, open: 0 }, eyes: null };

    const place = (w: WorldView): void => {
      placed = true;
      top = w.scene.bench.top;
      hatchObj.position.y = top;
      const rv = w.machine(unitId);
      if (rv && rv.kind === 'revert') bodyId = rv.body;
      hy = w.halfExtents(bodyId)?.[1] ?? hy;
      ctx.pickable(bodyId, obj);
    };

    /** Switch the card's words (only ever while it is stowed in the slot). */
    // every card Revert may hold, painted now (at start-up) rather than on the frame it is wanted
    const keyOf = new Map<string, string>();
    const cardKey = (content: string): string => {
      let k = keyOf.get(content);
      if (!k) {
        k = ctx.labels.card(contentById(content).text, { capHeight: CARD_CAP });
        keyOf.set(content, k);
      }
      return k;
    };
    for (const id of REVERT_CARDS) {
      try {
        cardKey(id);
      } catch {
        /* a card the content does not have (yet): painted when asked for */
      }
    }
    /** The next card's label, copied into the region a band of rows a frame while the card waits in its slot. */
    let copying: { content: string; key: string; row: number } | null = null;
    let regionHolds: string | null = null;
    const startCard = (content: string): void => {
      if (copying?.content === content) return;
      copying = { content, key: cardKey(content), row: 0 };
    };
    /** Copy the next band; true once the whole card is in the region (and uploaded). */
    const stepCard = (): boolean => {
      const c = copying;
      if (!c) return true;
      const j1 = Math.min(region.px.h, c.row + F.copyRows);
      copyLabel(ctx.labels.texture(c.key), region.px.w, region.px.h, regionPx, c.row, j1);
      c.row = j1;
      if (j1 < region.px.h) return false;
      region.put(regionPx);
      const sz = ctx.labels.size(c.key);
      cardContent = regionHolds = c.content;
      cardSize.w = sz.w;
      cardSize.h = sz.h;
      cardScale.x = sz.w / card0.w;
      cardScale.y = sz.h / card0.h;
      copying = null;
      return true;
    };

    /** The direction to the camera in Revert's own frame, as a gaze (-1..1). */
    const gazeAtCamera = (out: [number, number], heading: number, at: Vector3): [number, number] => gazeAt(out, heading, at, ctx.stage.camera.camera.position);
    /** The direction from `at` to `target` in Revert's own frame, as a gaze (-1..1). */
    const gazeAt = (out: [number, number], heading: number, at: Vector3, target: Vector3): [number, number] => {
      const dx = target.x - at.x, dy = target.y - at.y, dz = target.z - at.z;
      tmpV3.set(dx, dy, dz);
      const c = Math.cos(-heading), s = Math.sin(-heading);
      const lx = tmpV3.x * c + tmpV3.z * s;
      const lz = -tmpV3.x * s + tmpV3.z * c;
      const yaw = Math.atan2(lx, Math.max(0.2, lz));
      const pitchUp = Math.atan2(tmpV3.y, Math.hypot(lx, lz)) - 0.55; // the face is raked back toward a camera ~33° up
      out[0] = clamp(yaw * 1.4, -1, 1);
      out[1] = clamp(pitchUp * 2, -1, 1);
      return out;
    };
    const look: [number, number] = [0, 0];

    const view: RevertStationView = {
      root,
      state,
      update(frame: Frame) {
        const w = frame.world;
        if (!placed) place(w);
        const rv = w.machine(unitId);
        if (!rv || rv.kind !== 'revert') return;
        const reducedNow = ctx.reducedMotion || w.reducedMotion;
        if (reducedNow !== R) {
          R = reducedNow;
          for (const [sp, zeta] of springs) sp.tune({ zeta: z(zeta) });
        }
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);

        // ── the simulation's place, interpolated between its steps ──
        if (w.step !== lastStep) {
          if (lastStep < 0 || w.step - lastStep > 1) {
            cur.x = rv.x; cur.z = rv.z; cur.h = rv.heading;
          }
          prev.x = cur.x; prev.z = cur.z; prev.h = cur.h;
          cur.x = rv.x; cur.z = rv.z; cur.h = rv.heading;
          lastStep = w.step;
        }
        const a = clamp01(frame.alpha);
        let px = lerp(prev.x, cur.x, a);
        let pz = lerp(prev.z, cur.z, a);
        let ph = prev.h + Math.atan2(Math.sin(cur.h - prev.h), Math.cos(cur.h - prev.h)) * a;

        // ── events ──
        for (const e of frame.events) onEvent(e, rv, now);

        // ── the hatch ──
        const doorGoal = rv.hatch;
        if (R) {
          doors.x = doorGoal;
          doors.v = 0;
        } else {
          let left = dt;
          const k = F.doorOmega * F.doorOmega, c = 2 * F.doorDamping * F.doorOmega;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            doors.v += (k * (doorGoal - doors.x) - c * doors.v) * h;
            doors.x += doors.v * h;
            if (doors.x > 1) {
              doors.x = 1;
              doors.v = -Math.abs(doors.v) * F.doorBounce;
            } else if (doors.x < 0) {
              doors.x = 0;
              doors.v = Math.abs(doors.v) * F.doorBounce;
            }
            left -= h;
          }
          if (rv.state === 'stuck') doors.x = rv.hatch; // the rattle is the simulation's
        }
        // the lift: waits for the doors, then rams up onto its stop
        const liftGoal = rv.lift >= 1 ? 1 : clamp01((rv.lift - F.liftWait) / (1 - F.liftWait));
        if (R) lift.set(liftGoal);
        else lift.step(liftGoal, dt);
        if (lift.x > 1.03) {
          lift.x = 1.03;
          lift.v = Math.min(lift.v, 0);
        }
        if (lift.x < 0) lift.set(0);
        if (wasLift < 1 && lift.x >= 1 && !R) bob.kick(F.landKick); // the clunk onto the stop: the body settles on its treads
        wasLift = lift.x;
        state.lift = lift.x;
        state.doors = doors.x;
        // posed only when it moved (poseHatch makes matrices)
        if (doors.x !== hatchPosed[0] || lift.x !== hatchPosed[1]) {
          hatchPosed[0] = doors.x;
          hatchPosed[1] = lift.x;
          poseHatch(hatchObj, { doors: doors.x, lift: Math.min(1.03, lift.x) });
        }

        // ── Revert ──
        const drawn = rv.drawn;
        const m = w.motion(bodyId);
        const visible = drawn ? lift.x > 0.02 || rv.state !== 'below' : !!m && m.mode !== 'gone' && m.mode !== 'chute';
        obj.visible = visible;
        if (!visible) {
          state.eyes = null;
          hops.update(now, (id) => w.motion(id)?.pose);
          return;
        }

        if (drawn && !wasDrawn) {
          // put down: it lands on its treads (righting itself first if it lay any other way up)
          bob.kick(F.landKick * 1.4);
          lastVel.set(0, 0, 0);
          heldVel[0] = heldVel[1] = 0;
          const up = tmpV3.set(0, 1, 0).applyQuaternion(rightQ).y;
          rightBig = up < 0.5;
          rightFor = up > 0.97 ? 0 : rightBig ? F.rightBig : F.rightSmall;
          rightAt = now;
          // it is where it was set down, not where it last drove from
          prev.x = cur.x;
          prev.z = cur.z;
          prev.h = cur.h;
          px = lastX = cur.x;
          pz = lastZ = cur.z;
          ph = lastH = cur.h;
        }
        // where it is
        let heading = ph;
        if (drawn) {
          let y = top + liftHeight(Math.min(1.03, lift.x)) * S;
          if (rv.lift >= 1 && m && m.mode === 'crew' && !w.bracketed && lift.x >= 0.999) y = m.pose.p[1] - hy;
          // the piece's origin from its body's centre
          const c = Math.cos(heading), s = Math.sin(heading);
          const ox = opts.centre[0] * c + opts.centre[1] * s;
          const oz = -opts.centre[0] * s + opts.centre[1] * c;
          tmpV.set(px - ox, y, pz - oz);
          tmpQ.setFromAxisAngle(Y, heading);
          // set down on its back or its side: it rights itself, with effort (two goes that fall back, then over)
          const rt = now - rightAt;
          if (rightFor > 0 && rt < rightFor && !R) {
            const e = rightCurve(rt / rightFor, rightBig);
            tmpQ2.copy(rightQ).slerp(tmpQ, e);
            const lift = Math.sin(Math.PI * Math.min(1, e)) * 0.25 * (rightBig ? 1 : 0.3);
            rightV.lerpVectors(rightP, tmpV, Math.min(1, e));
            rightV.y += lift;
            body.matrix.compose(rightV, tmpQ2, tmpV2.set(1, 1, 1));
          } else body.matrix.compose(tmpV, tmpQ, tmpV2.set(1, 1, 1));
        } else if (m) {
          // in someone's hand, or falling: drawn from its body
          const P = frame.alpha >= 1 || m.prev === m.pose ? m.pose : m.prev;
          tmpV.set(P.p[0], P.p[1], P.p[2]);
          tmpQ.set(P.q[0], P.q[1], P.q[2], P.q[3]);
          if (P !== m.pose) {
            tmpV.lerp(tmpV2.set(m.pose.p[0], m.pose.p[1], m.pose.p[2]), a);
            tmpQ.slerp(tmpQ2.set(m.pose.q[0], m.pose.q[1], m.pose.q[2], m.pose.q[3]), a);
          }
          // its velocity (for the dangling arm and the sagging treads)
          if (dt > 0) {
            tmpV2.copy(tmpV).sub(lastPose).divideScalar(dt);
            const ay = (tmpV2.y - lastVel.y) / dt;
            const ah = Math.hypot(tmpV2.x - lastVel.x, tmpV2.z - lastVel.z) / dt;
            lastVel.copy(tmpV2);
            if (!R && wasDrawn === false) {
              swing.kick(clamp(ah * 0.0015 - ay * 0.001, -1.5, 1.5) * F.swingGain * 20);
              sag.kick(clamp(-ay * 0.004, -2, 2));
            }
          }
          lastPose.copy(tmpV);
          // held: the treads hang from the body and swing as a pendulum (the body node against the chassis)
          if (!R && dt > 0 && rv.state === 'held') {
            const c = Math.cos(heading), s2 = Math.sin(heading);
            const ax = (tmpV2.x * c - tmpV2.z * s2) - heldVel[0]!;
            const az = (tmpV2.x * s2 + tmpV2.z * c) - heldVel[1]!;
            heldVel[0]! += ax;
            heldVel[1]! += az;
            pitch.kick(clamp(az / dt, -40, 40) * F.heldSwing);
            roll.kick(clamp(-ax / dt, -40, 40) * F.heldSwing);
          }
          tmpV2.set(opts.centre[0], hy, opts.centre[1]).applyQuaternion(tmpQ);
          tmpV.sub(tmpV2);
          body.matrix.compose(tmpV, tmpQ, tmpV2.set(1, 1, 1));
          rightQ.copy(tmpQ);
          rightP.copy(tmpV);
          heading = 2 * Math.atan2(tmpQ.y, tmpQ.w);
        }
        body.matrixWorldNeedsUpdate = true;
        wasDrawn = drawn;

        // the treads: by the distance covered, each side its own
        if (drawn) {
          const dx = px - lastX, dz = pz - lastZ;
          const dh = Math.atan2(Math.sin(ph - lastH), Math.cos(ph - lastH));
          const fwd = dx * Math.sin(ph) + dz * Math.cos(ph);
          if (Math.hypot(dx, dz) < 0.5 && Math.abs(dh) < 0.5) {
            const r = 0.585 * S;
            travelL += (fwd - dh * r) / S;
            travelR += (fwd + dh * r) / S;
          }
          const speed = dt > 0 ? fwd / dt : 0;
          const acc = dt > 0 ? (speed - lastSpeed) / dt : 0;
          lastSpeed = damp(lastSpeed, speed, 30, dt);
          const moving = Math.abs(rv.speed) > 0.05 || Math.abs(rv.turning) > 0.1;
          // nose up pulling away, down stopping; a lean into a turn; chatter while the treads run
          const pGoal = R ? 0 : clamp(acc * F.pitchPerAccel, -0.12, 0.12) + (moving ? -0.03 : 0);
          pitch.step(pGoal, dt);
          roll.step(R ? 0 : clamp(-rv.turning * F.rollPerTurn, -0.08, 0.08), dt);
          bob.step(0, dt);
          const chatter = moving && !R ? F.chatter * noise1(now * 14, seed) : 0;
          pose.bob = bob.x + chatter;
        } else {
          // held or falling: the treads hang a little away from the body and swing
          pitch.step(0, dt);
          roll.step(0, dt);
          bob.step(R ? 0 : F.heldDrop, dt);
          pose.bob = bob.x;
        }
        lastX = px; lastZ = pz; lastH = ph;
        pose.pitch = pitch.x;
        pose.roll = roll.x;
        (pose.travel as [number, number])[0] = travelL;
        (pose.travel as [number, number])[1] = travelR;

        // the crank: wound up, turned backwards through the rewind, wound down
        const cranking = rv.cranking && drawn;
        if (cranking && crankingSince === -Infinity) crankingSince = now;
        if (!cranking) crankingSince = -Infinity;
        if (R) {
          crankAngle = -rv.crank;
        } else {
          const since = now - crankingSince;
          // anticipation: a quarter turn forward before it goes backwards
          const goal = cranking ? (since < 0.12 ? F.crankWindup / 0.12 : -F.crankRate) : 0;
          crankRate.step(goal, dt);
          crankAngle += crankRate.x * dt;
          if (!cranking && Math.abs(crankRate.x) < 0.3) crankAngle = damp(crankAngle, Math.round(crankAngle / (2 * Math.PI)) * 2 * Math.PI + 0.5, 4, dt);
        }
        pose.crank = crankAngle;
        state.crank = crankAngle;
        if (cranking && !R) pose.roll = (pose.roll ?? 0) + F.crankLean * Math.sin(crankAngle) - 0.06;

        // the face
        faceFor(rv, now, dt, heading, body, frame.hovered === bodyId && !w.bracketed ? frame.pointer : null);
        // the card
        cardFor(rv, now, dt);
        // the arm, the broom, the fit, the limp
        armFor(rv, now, dt);
        sag.step(drawn ? 0 : 1, dt);
        swing.step(0, dt);
        pose.sag = clamp(sag.x, 0, 1.2);

        poseRevertInto(obj, pose, cardSize, scratch);
        if (cardNode && cardPhase !== 'stowed') {
          const c = pose.card!;
          cardMatrixInto(c.lift ?? 0, c.open ?? 0, c.wobble ?? 0, cardSize.w, cardSize.h, tmpM, scratch).multiply(tmpS.makeScale(cardScale.x, cardScale.y, 1));
          tmpM.decompose(cardNode.position, cardNode.quaternion, cardNode.scale);
        }
        hops.update(now, (id) => w.motion(id)?.pose);
      },
      dispose() {
        root.removeFromParent();
      },
    };

    function onEvent(e: SimEvent, rv: RevertView, now: number): void {
      if (e.type === 'card' && e.by === bodyId) cardWant = e.content;
      else if (e.type === 'button.pressed' && rv.state !== 'below' && rv.state !== 'rising' && !R) glareAt = now;
      else if (e.type === 'misfire' && e.id === unitId && !R) {
        bob.kick(-0.5);
        pitch.kick(1.2);
      } else if (e.type === 'revert.sweep' && e.id === bodyId) {
        // the part hops into the dustpan, and on to where it was put
        const pan = DUSTPAN.clone().multiplyScalar(1).applyMatrix4(obj.matrixWorld);
        const to = e.to.at === 'rest' ? e.to.pose : null;
        hops.add(e.part, e.from, now, { via: pan, ...(to ? { to } : { to: { p: [pan.x, pan.y - 0.2, pan.z], q: e.from.q } as Pose, vanish: true }), dur: 0.85 });
        sweepEnd = now;
      }
    }

    function faceFor(rv: RevertView, now: number, dt: number, heading: number, b: Object3D, pointer: readonly [number, number, number] | null): void {
      const eyes = rv.eyes;
      state.eyes = eyes;
      let goal: RevertPose;
      switch (eyes) {
        case 'open':
          goal = rv.cranking ? POSES.crank : POSES.deadpan;
          break;
        case 'glare':
          goal = POSES.glare;
          break;
        case 'one':
          goal = POSES.asleep;
          break;
        case 'rolled':
          goal = POSES.limp;
          break;
        default:
          goal = rv.state === 'trundle' ? POSES.trundle : POSES.flat;
      }
      const gl = goal.lids ?? [0.6, 0.6];
      let l0 = gl[0], l1 = gl[1];
      let s0 = goal.slant?.[0] ?? 0, s1 = goal.slant?.[1] ?? 0;
      let bw = goal.brow ?? 0;
      const browRoll = goal.browRoll ?? 0;
      let gx = goal.gaze?.[0] ?? 0, gy = goal.gaze?.[1] ?? 0;
      b.updateWorldMatrix(true, false);
      tmpV2.set(0, 0.6, 0).applyMatrix4(b.matrixWorld);
      if (eyes === 'glare' || eyes === 'flat' || eyes === 'open') {
        // deadpan faces the visitor
        gazeAtCamera(look, heading, tmpV2);
        if (eyes !== 'open' || !rv.cranking) {
          gx = look[0] * 0.8;
          gy = look[1] * 0.8;
        }
      }
      if (eyes === 'one' && !R) {
        // asleep, one eye open, lazily following the pointer
        gx = -0.25 + 0.2 * noise1(now * 0.15, seed + 5);
      }
      // hovered: the eyes slide to the pointer; the head does not move
      if (pointer && rv.drawn && eyes !== 'rolled') {
        gazeAt(look, heading, tmpV2, tmpV.set(pointer[0], pointer[1], pointer[2]));
        gx = look[0];
        gy = look[1];
      }
      // the slow glare at the visitor after a press (§ B5: at most a second and a half)
      const G = F.glare;
      const ga = now - glareAt;
      if (!R && ga >= 0 && ga < G.wait + G.on + G.hold + G.off && (eyes === 'flat' || eyes === 'open')) {
        const k = ga < G.wait ? 0 : ga < G.wait + G.on ? smoothstep(0, 1, (ga - G.wait) / G.on) : ga < G.wait + G.on + G.hold ? 1 : 1 - smoothstep(0, 1, (ga - G.wait - G.on - G.hold) / G.off);
        gazeAtCamera(look, heading, tmpV2);
        l0 = lerp(l0, 0.62, k);
        l1 = lerp(l1, 0.62, k);
        s0 = lerp(s0, 0.26, k);
        s1 = lerp(s1, 0.26, k);
        bw = lerp(bw, 1, k);
        gx = lerp(gx, look[0], k);
        gy = lerp(gy, look[1], k);
      }
      // a slow blink now and then (awake only)
      if (!R && (eyes === 'flat' || eyes === 'open') && blinks.due(now)) blinkAt = now;
      const bt = now - blinkAt;
      if (bt >= 0 && bt < F.blinkShut + F.blinkOpen) {
        const k = bt < F.blinkShut ? bt / F.blinkShut : 1 - (bt - F.blinkShut) / F.blinkOpen;
        l0 = lerp(l0, 1, k);
        l1 = lerp(l1, 1, k);
        lids.x[0] = Math.max(lids.x[0]!, l0);
        lids.x[1] = Math.max(lids.x[1]!, l1);
      }
      const g2 = goal2;
      g2[0] = l0;
      g2[1] = l1;
      lids.step(g2, dt);
      g2[0] = s0;
      g2[1] = s1;
      slant.step(g2, dt);
      g2[0] = bw;
      g2[1] = browRoll;
      brow.step(g2, dt);
      g2[0] = gx;
      g2[1] = gy;
      gaze.step(g2, dt);
      const pl = pose.lids!, ps = pose.slant!, pg = pose.gaze!, pm = pose.lamps!;
      pl[0] = clamp01(lids.x[0]!);
      pl[1] = clamp01(lids.x[1]!);
      ps[0] = slant.x[0]!;
      ps[1] = slant.x[1]!;
      pose.brow = brow.x[0]!;
      pose.browRoll = brow.x[1]!;
      pg[0] = gaze.x[0]!;
      pg[1] = gaze.x[1]!;
      pm[0] = eyes !== 'one';
      pm[1] = true;
    }

    function cardFor(rv: RevertView, now: number, dt: number): void {
      const want = rv.card ? cardWant ?? rv.card.content : null;
      if (!rv.card) cardWant = null;
      const s = now - cardAt;
      switch (cardPhase) {
        case 'stowed':
          if (want && want !== cardContent) {
            if (regionHolds === want) cardContent = want;
            else startCard(want);
          }
          if (want && rv.drawn && lift.x > 0.9 && stepCard() && cardContent === want) {
            cardPhase = 'up';
            cardAt = now;
            cardLift.set(0);
            cardOpen.set(0);
            wobble.set(0);
          }
          break;
        case 'up':
          if (want !== cardContent || !rv.drawn) {
            foldFrom = { lift: cardLift.x, open: cardOpen.x };
            cardPhase = R ? 'drop' : 'fold';
            cardAt = now;
            break;
          }
          // anticipation: the card's top peeks out of the slot and stops, then up it goes
          cardLift.step(R || s >= F.peekHold ? F.hold : F.peek, dt);
          if (R ? s > 0.2 : cardLift.x > F.openAt && s > F.peekHold + 0.2) {
            const before = cardOpen.x;
            cardOpen.step(1, dt);
            if (before < 0.5 && cardOpen.x >= 0.5 && !R) wobble.kick(F.openWobble * 6);
          }
          break;
        case 'fold': {
          const k = clamp01(s / F.foldTime);
          cardOpen.set(foldFrom.open * (1 - k * k));
          if (k >= 1) {
            cardPhase = 'drop';
            cardAt = now;
          }
          break;
        }
        case 'drop': {
          const k = clamp01(s / F.dropTime);
          cardOpen.set(0);
          cardLift.set(foldFrom.lift * (1 - k * k));
          if (k >= 1) {
            cardLift.set(0);
            cardPhase = 'stowed';
            cardContent = null;
          }
          break;
        }
      }
      wobble.step(0, dt);
      const c = pose.card!;
      c.lift = cardPhase === 'stowed' ? 0 : clamp(cardLift.x, 0, 1.15);
      c.open = clamp01(cardOpen.x);
      c.wobble = clamp(wobble.x, -12, 12);
      state.card.content = cardContent;
      state.card.lift = c.lift;
      state.card.open = c.open;
    }

    function armFor(rv: RevertView, now: number, dt: number): void {
      let goal: ArmJoints = ARMS.tucked;
      let useBroom = false;
      let broomGoal = 0;
      if (!rv.drawn) {
        goal = ARMS.dangle;
      } else if (rv.state === 'sweep') {
        const s = rv.stateTime;
        if (s < F.sweepReach) goal = broomReach(0, 0);
        else {
          useBroom = true;
          broomGoal = 1;
        }
      } else if (now - sweepEnd < F.stowTime + 0.3 && broom > 0.02) {
        useBroom = true;
        broomGoal = 0;
      } else if (rv.state === 'fit') {
        // at the Button: the arm up at the cover, and a turn of the wrist
        const s = rv.stateTime;
        goal = { yaw: -0.25, swing: 2.25, elbow: 0.4, wrist: R ? 0 : 0.9 * Math.sin(Math.min(1, s / 1.0) * Math.PI * 3), grip: 0.1 };
        fitTurn = s;
      } else if (cardPhase === 'up' && cardOpen.x > 0.5) {
        goal = ARMS.point;
      } else if (rv.state === 'park') {
        goal = ARMS.hang;
      }
      if (useBroom) {
        const rate = 1 / (broomGoal > broom ? F.sweepOut : F.stowTime);
        broom = broomGoal > broom ? Math.min(broomGoal, broom + rate * dt) : Math.max(broomGoal, broom - rate * dt);
        stroke = broom > 0.95 && rv.state === 'sweep' && !R ? Math.sin((now * F.strokeHz) * 2 * Math.PI) : damp(stroke, 0, 8, dt);
        pose.arm = 'broom';
        pose.broom = smoothstep(0, 1, broom);
        pose.stroke = stroke;
        arm.set(jointsOf(broomReach(broom, stroke)));
        return;
      }
      broom = 0;
      pose.broom = 0;
      pose.stroke = 0;
      arm.step(jointsInto(goal, jointsTmp), dt);
      if (typeof pose.arm !== 'object') pose.arm = { yaw: 0, swing: 0, elbow: 0, wrist: 0, grip: 0 };
      const aj = pose.arm as ArmJoints;
      aj.yaw = arm.x[0]!;
      aj.swing = arm.x[1]! + (rv.drawn ? 0 : swing.x);
      aj.elbow = arm.x[2]!;
      aj.wrist = arm.x[3]!;
      aj.grip = clamp01(arm.x[4]!);
      void fitTurn;
    }

    return view;
  };
}

/**
 * A label's pixels (its region of an atlas page, or a texture of its own), resampled bilinearly to
 * `w` × `h` texels, rows top-down, into `out` (RGBA): what `LabelRegion.put` takes.
 */
function copyLabel(tex: Texture, w: number, h: number, out: Uint8Array, j0 = 0, j1 = h): void {
  const img = tex.image as { data?: Uint8Array | Uint8ClampedArray; width: number; height: number } | undefined;
  const data = img?.data;
  if (!img || !data) return;
  const W = img.width, H = img.height;
  const u0 = tex.offset.x, v0 = tex.offset.y, du = tex.repeat.x, dv = tex.repeat.y;
  // the columns' source texels and weights, once per call (the same for every row)
  if (COLS.w !== w || COLS.tex !== tex) {
    COLS.a = new Int32Array(w);
    COLS.b = new Int32Array(w);
    COLS.t = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      const fx = Math.min(W - 1, Math.max(0, (u0 + ((i + 0.5) / w) * du) * W - 0.5));
      const x0 = Math.floor(fx);
      COLS.a[i] = x0 * 4;
      COLS.b[i] = Math.min(W - 1, x0 + 1) * 4;
      COLS.t[i] = fx - x0;
    }
    COLS.w = w;
    COLS.tex = tex;
  }
  const ca = COLS.a!, cb = COLS.b!, ct = COLS.t!;
  for (let j = j0; j < j1; j++) {
    // rows top-down out; the page's rows run bottom-up (v up)
    const fy = Math.min(H - 1, Math.max(0, (v0 + (1 - (j + 0.5) / h) * dv) * H - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    const r0 = y0 * W * 4, r1 = Math.min(H - 1, y0 + 1) * W * 4;
    let o = j * w * 4;
    for (let i = 0; i < w; i++) {
      const a = r0 + ca[i]!, b = r0 + cb[i]!, c = r1 + ca[i]!, d = r1 + cb[i]!, tx = ct[i]!;
      for (let k = 0; k < 4; k++) {
        const top = data[a + k]! + (data[b + k]! - data[a + k]!) * tx;
        const bot = data[c + k]! + (data[d + k]! - data[c + k]!) * tx;
        out[o++] = top + (bot - top) * ty;
      }
    }
  }
}
const COLS: { w: number; tex: Texture | null; a: Int32Array | null; b: Int32Array | null; t: Float32Array | null } = { w: 0, tex: null, a: null, b: null, t: null };

function jointsInto(j: ArmJoints, out: number[]): number[] {
  out[0] = j.yaw;
  out[1] = j.swing;
  out[2] = j.elbow;
  out[3] = j.wrist;
  out[4] = j.grip;
  return out;
}

function jointsOf(j: ArmJoints): number[] {
  return [j.yaw, j.swing, j.elbow, j.wrist, j.grip];
}

/** The arm's joints that hold the broom at `broom` (0 on its rack .. 1 out) and `stroke`. */
function broomReach(broom: number, stroke: number): ArmJoints {
  const g = new Vector3(0, broomGrip(broom), 0).applyMatrix4(broomMatrix(broom, stroke));
  g.sub(new Vector3(SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z));
  const r = armReach(g);
  return { ...r, wrist: 0, grip: 0.1 };
}
