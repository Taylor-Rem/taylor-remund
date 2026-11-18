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
 * from `src/content/`): one Revert is realised with its first card, and a
 * different card is the same paper mesh given that card's label, its node
 * scaled to the label's size (only while the card is stowed in the slot).
 */
import { Group, Matrix4, Quaternion, Vector3, type Material, type Mesh, type Object3D } from 'three';
import type { Id, Pose, RevertView, SimEvent, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { contentById } from '../labels/content.ts';
import { revert as revertPiece, revertCard, poseRevert, cardMatrix, POSES, ARMS, CARD_CAP, SHOULDER, BODY_Y, armReach, broomMatrix, HULL } from '../kit/pieces/revert/index.ts';
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
} as const;

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
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const Y = new Vector3(0, 1, 0);

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
    const R = ctx.reducedMotion;
    const z = (zeta: number): number => (R ? Math.max(1, zeta) : zeta);

    const root = new Group();
    root.name = 'revert-station';
    ctx.scene.add(root);

    // the hatch, where the layout puts it
    const hatchObj = ctx.realize(revertHatch({ seed, detail }));
    hatchObj.scale.setScalar(S);
    hatchObj.position.set(opts.hatch[0], 0, opts.hatch[1]);
    root.add(hatchObj);

    // Revert, with its first card (the longest of the rung lines: the others are scaled to it)
    const card0 = revertCard(ctx.labels, 'rung1');
    const body = new Group();
    body.name = 'revert';
    body.matrixAutoUpdate = false;
    root.add(body);
    const obj = ctx.realize(revertPiece({ seed, detail, card: card0 }));
    obj.scale.setScalar(S);
    body.add(obj);
    const cardNode = obj.getObjectByName('card');
    let paperMesh: Mesh | null = null;
    const paper0 = ctx.materials.textured('paper', card0.key);
    obj.traverse((o) => {
      const mesh = o as Mesh;
      if ((mesh as { isMesh?: boolean }).isMesh && mesh.material === paper0) paperMesh = mesh;
    });

    // ── state ──
    let placed = false;
    let bodyId: Id = 'revert';
    let top = 0;
    let hy = 0.672;
    const doors = { x: 0, v: 0 };
    const lift = new Spring(0, { omega: F.liftOmega, zeta: z(F.liftDamping) });
    const bob = new Spring(0, { omega: F.bodyOmega, zeta: z(F.bodyDamping) });
    const pitch = new Spring(0, { omega: F.bodyOmega * 0.7, zeta: z(F.bodyDamping) });
    const roll = new Spring(0, { omega: F.bodyOmega * 0.7, zeta: z(F.bodyDamping) });
    const crankRate = new Spring(0, { omega: F.crankOmega, zeta: z(F.crankDamping) });
    let crankAngle = 0;
    let crankingSince = -Infinity;
    const lids = new SpringVec([0.6, 0.6], { omega: F.lidOmega, zeta: z(F.lidDamping) });
    const slant = new SpringVec([0, 0], { omega: F.lidOmega * 0.6, zeta: z(F.lidDamping) });
    const brow = new SpringVec([0.3, 0], { omega: F.lidOmega * 0.6, zeta: z(F.lidDamping) });
    const gaze = new SpringVec([0, 0], { omega: F.gazeOmega, zeta: z(F.gazeDamping) });
    const arm = new SpringVec(jointsOf(ARMS.tucked), { omega: F.armOmega, zeta: z(F.armDamping) });
    const sag = new Spring(0, { omega: F.sagOmega, zeta: z(F.sagDamping) });
    const swing = new Spring(0, { omega: F.swingOmega, zeta: z(F.swingDamping) });
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
    const cardLift = new Spring(0, { omega: F.cardOmega, zeta: z(F.cardDamping) });
    const cardOpen = new Spring(0, { omega: F.openOmega, zeta: z(F.openDamping) });
    const wobble = new Spring(0, { omega: F.wobbleOmega, zeta: z(F.wobbleDamping) });
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
    const useCard = (content: string): void => {
      cardContent = content;
      if (!paperMesh) return;
      const key = ctx.labels.card(contentById(content).text, { capHeight: CARD_CAP });
      const sz = ctx.labels.size(key);
      (paperMesh as Mesh).material = ctx.materials.textured('paper', key) as Material;
      cardSize.w = sz.w;
      cardSize.h = sz.h;
      cardScale.x = sz.w / card0.w;
      cardScale.y = sz.h / card0.h;
    };

    /** The direction to the camera in Revert's own frame, as a gaze (-1..1). */
    const gazeAtCamera = (out: [number, number], heading: number, at: Vector3): [number, number] => {
      const cam = ctx.stage.camera.camera.position;
      tmpV.copy(cam).sub(at);
      const c = Math.cos(-heading), s = Math.sin(-heading);
      const lx = tmpV.x * c + tmpV.z * s;
      const lz = -tmpV.x * s + tmpV.z * c;
      const yaw = Math.atan2(lx, Math.max(0.2, lz));
      const pitchUp = Math.atan2(tmpV.y, Math.hypot(lx, lz)) - 0.55; // the face is raked back toward a camera ~33° up
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
        const px = lerp(prev.x, cur.x, a);
        const pz = lerp(prev.z, cur.z, a);
        const ph = prev.h + Math.atan2(Math.sin(cur.h - prev.h), Math.cos(cur.h - prev.h)) * a;

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
        poseHatch(hatchObj, { doors: doors.x, lift: Math.min(1.03, lift.x) });

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
          body.matrix.compose(tmpV, tmpQ, tmpV2.set(1, 1, 1));
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
          tmpV2.set(opts.centre[0], hy, opts.centre[1]).applyQuaternion(tmpQ);
          tmpV.sub(tmpV2);
          body.matrix.compose(tmpV, tmpQ, tmpV2.set(1, 1, 1));
          heading = 2 * Math.atan2(tmpQ.y, tmpQ.w);
        }
        body.matrixWorldNeedsUpdate = true;
        if (drawn && !wasDrawn) {
          // put down: it lands on its treads
          bob.kick(F.landKick * 1.4);
          lastVel.set(0, 0, 0);
        }
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
          pitch.step(0, dt);
          roll.step(0, dt);
          bob.step(0, dt);
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
        faceFor(rv, now, dt, heading, body);
        // the card
        cardFor(rv, now, dt);
        // the arm, the broom, the fit, the limp
        armFor(rv, now, dt);
        sag.step(drawn ? 0 : 1, dt);
        swing.step(0, dt);
        pose.sag = clamp(sag.x, 0, 1.2);

        poseRevert(obj, pose, cardSize);
        if (cardNode && cardPhase !== 'stowed') {
          const c = pose.card!;
          tmpM.copy(cardMatrix(c.lift ?? 0, c.open ?? 0, c.wobble ?? 0, cardSize.w, cardSize.h)).multiply(tmpS.makeScale(cardScale.x, cardScale.y, 1));
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

    function faceFor(rv: RevertView, now: number, dt: number, heading: number, b: Object3D): void {
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
      lids.step([l0, l1], dt);
      slant.step([s0, s1], dt);
      brow.step([bw, browRoll], dt);
      gaze.step([gx, gy], dt);
      pose.lids = [clamp01(lids.x[0]!), clamp01(lids.x[1]!)];
      pose.slant = [slant.x[0]!, slant.x[1]!];
      pose.brow = brow.x[0]!;
      pose.browRoll = brow.x[1]!;
      pose.gaze = [gaze.x[0]!, gaze.x[1]!];
      pose.lamps = eyes === 'one' ? [false, true] : [true, true];
    }

    function cardFor(rv: RevertView, now: number, dt: number): void {
      const want = rv.card ? cardWant ?? rv.card.content : null;
      if (!rv.card) cardWant = null;
      const s = now - cardAt;
      switch (cardPhase) {
        case 'stowed':
          if (want && rv.drawn && lift.x > 0.9) {
            useCard(want);
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
          cardLift.step(1, dt);
          if (R ? s > 0.2 : cardLift.x > F.openAt && s > 0.25) {
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
      arm.step(jointsOf(goal), dt);
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
