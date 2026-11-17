/**
 * The cue card (REWRITE.md § B4 "Revert's card"; W4 brief § B). In the
 * finished site Revert holds cards up; he is not in the vignette, so the
 * Button answers with a spring-loaded brass stick (`kit/pieces/card-arm`)
 * that shoots up out of a slot in the bench behind the console with the
 * typed card in its clip.
 *
 * On a `card` event (content id → `contentById` → `labels.card`):
 *  - pop: the stick fires up out of the slot, a little past its stop and
 *    back; it comes out leaning forward and rocks back onto its spring, the
 *    card lagging in its clip, a small sway that dies away;
 *  - hold: long enough to read it twice (by its length);
 *  - fold: a breath up and back (anticipation), then it drops away into the
 *    slot fast, leaning back as it goes.
 * A press while a card is up takes it away at once. With reduced motion it
 * rises and falls on a short ease, without a wobble.
 *
 * It stands left of the Button and behind it, raised high enough that the
 * console, the cap and the parked guard stay clear of it at the default view.
 */
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import type { WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { contentById } from '../labels/content.ts';
import { cardArm, poseCardArm, stowDepth, CARD_POSE } from '../kit/pieces/card-arm/index.ts';
import type { CardArmPose } from '../kit/pieces/card-arm/index.ts';

/** Tune here. */
export const CARD_FEEL = {
  /** Where the slot is, in the Button pedestal's frame (x right, z toward the visitor). */
  slot: { x: -1.24, z: -1.0, yaw: 2.5 },
  /** The pop: the stick's spring (lift is a fraction of the stow depth, so keep the overshoot small). */
  popOmega: 15,
  popDamping: 0.62,
  /** It leaves the slot leaning forward this much (deg) and rocks back onto its rest lean. */
  popLean: -6,
  leanOmega: 11,
  leanDamping: 0.32,
  /** The card lags the stick in its clip: how much of the stick's angular acceleration reaches it. */
  flapOmega: 14,
  flapDamping: 0.25,
  flapGain: 0.055,
  /** A sideways sway kick at the pop (deg/s) and its spring. */
  swayKick: 30,
  swayOmega: 9,
  swayDamping: 0.2,
  /** Hold: base seconds, plus seconds per character. */
  hold: 2.2,
  perChar: 0.06,
  /** Fold: the breath before it goes, and the drop. */
  breath: 0.16,
  breathLift: 1.035,
  breathLean: 10,
  drop: 0.3,
  /** Reduced motion: up and down on a plain ease. */
  reducedEase: 0.3,
} as const;

interface Built {
  obj: Object3D;
  stow: number;
  text: string;
}

type Phase = 'stowed' | 'pop' | 'hold' | 'breath' | 'drop';

export interface CardViewState {
  phase: Phase;
  content: string | null;
  pose: Required<CardArmPose>;
}

export interface CardView extends StationView {
  readonly state: CardViewState;
  /** Where the card is in the world now (its centre), for captures and tests. */
  cardCentre(out?: Vector3): Vector3 | null;
}

function springStep(s: { x: number; v: number }, to: number, omega: number, zeta: number, dt: number, force = 0): void {
  let left = dt;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    s.v += (-k * (s.x - to) - c * s.v + force) * h;
    s.x += s.v * h;
    left -= h;
  }
}

const smooth = (k: number): number => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

export function createCardView(): (ctx: ViewContext) => CardView {
  return (ctx) => {
    const F = CARD_FEEL;
    const reduced = ctx.reducedMotion;
    const root = new Group();
    root.name = 'card-arm';
    ctx.scene.add(root);
    const cache = new Map<string, Built>();
    let current: Built | null = null;
    let queued: string | null = null;
    let placed = false;
    let phase: Phase = 'stowed';
    let phaseAt = 0;
    let holdFor = 3;
    let dropFrom = 1;
    let leanFrom: number = CARD_POSE.lean;
    const lift = { x: 0, v: 0 };
    const lean = { x: CARD_POSE.lean as number, v: 0 };
    const flap = { x: CARD_POSE.flap as number, v: 0 };
    const sway = { x: 0, v: 0 };
    let lastLeanV = 0;
    const pose: Required<CardArmPose> = { lift: 0, lean: CARD_POSE.lean, sway: 0, twist: 0, flap: CARD_POSE.flap };
    const state: CardViewState = { phase, content: null, pose };

    const place = (w: WorldView): void => {
      placed = true;
      const s = w.scene.statics.find((x) => x.id === 'console');
      const q = s ? new Quaternion(s.pose.q[0], s.pose.q[1], s.pose.q[2], s.pose.q[3]) : new Quaternion();
      const p = s ? new Vector3(s.pose.p[0], w.scene.bench.top, s.pose.p[2]) : new Vector3(0, w.scene.bench.top, 0);
      const off = new Vector3(F.slot.x, 0, F.slot.z).applyQuaternion(q);
      root.position.copy(p).add(off);
      root.quaternion.copy(q).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (F.slot.yaw * Math.PI) / 180));
    };

    const build = (content: string): Built => {
      let b = cache.get(content);
      if (b) return b;
      const text = contentById(content).text;
      const key = ctx.labels.card(text);
      const size = ctx.labels.size(key);
      const obj = ctx.realize(cardArm({ card: { key, ...size }, detail: ctx.tier === 'low' ? 'low' : 'high' }));
      obj.visible = false;
      root.add(obj);
      b = { obj, stow: stowDepth(size.h), text };
      cache.set(content, b);
      return b;
    };

    const enter = (p: Phase, now: number): void => {
      phase = p;
      phaseAt = now;
      state.phase = p;
    };

    const show = (content: string, now: number): void => {
      if (current) current.obj.visible = false;
      current = build(content);
      current.obj.visible = true;
      state.content = content;
      holdFor = F.hold + F.perChar * current.text.length;
      lift.x = 0;
      lift.v = 0;
      lean.x = reduced ? CARD_POSE.lean : F.popLean;
      lean.v = 0;
      flap.x = CARD_POSE.flap;
      flap.v = 0;
      sway.x = 0;
      sway.v = reduced ? 0 : F.swayKick;
      lastLeanV = 0;
      enter('pop', now);
    };

    const fold = (now: number): void => {
      if (phase === 'stowed' || phase === 'breath' || phase === 'drop') return;
      dropFrom = Math.max(lift.x, 0.2);
      leanFrom = lean.x;
      enter(reduced ? 'drop' : 'breath', now);
    };

    const view: CardView = {
      root,
      state,
      cardCentre(out = new Vector3()) {
        if (!current || phase === 'stowed') return null;
        const c = current.obj.getObjectByName('card');
        if (!c) return null;
        c.updateWorldMatrix(true, false);
        const h = ctx.labels.size(ctx.labels.card(current.text)).h;
        return out.set(0, h / 2, 0).applyMatrix4(c.matrixWorld);
      },
      update(frame: Frame) {
        const w = frame.world;
        if (!placed) place(w);
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        for (const e of frame.events) {
          if (e.type === 'card') {
            if (phase === 'stowed') show(e.content, now);
            else if (state.content === e.content && (phase === 'pop' || phase === 'hold')) {
              enter('hold', now); // the same card again: hold it longer, with a jolt
              if (!reduced) sway.v += F.swayKick * 0.6;
            } else {
              queued = e.content;
              fold(now);
            }
          } else if (e.type === 'button.pressed') fold(now);
        }
        if (!current) return;
        const s = now - phaseAt;
        switch (phase) {
          case 'pop':
          case 'hold':
            if (reduced) {
              lift.x = phase === 'pop' ? smooth(s / F.reducedEase) : 1;
              if (phase === 'pop' && s >= F.reducedEase) enter('hold', now);
            } else {
              springStep(lift, 1, F.popOmega, F.popDamping, dt);
              if (phase === 'pop' && s > 0.6) enter('hold', now);
            }
            if (phase === 'hold' && now - phaseAt >= holdFor) fold(now);
            break;
          case 'breath': {
            const k = smooth(s / F.breath);
            lift.x = dropFrom + (F.breathLift - dropFrom) * k;
            lift.v = 0;
            lean.x = leanFrom + (CARD_POSE.lean + F.breathLean - leanFrom) * k;
            lean.v = 0;
            if (s >= F.breath) {
              dropFrom = lift.x;
              leanFrom = lean.x;
              enter('drop', now);
            }
            break;
          }
          case 'drop': {
            const d = reduced ? F.reducedEase : F.drop;
            const k = Math.min(1, s / d);
            lift.x = reduced ? dropFrom * (1 - smooth(k)) : dropFrom * (1 - k * k);
            if (!reduced) lean.x = leanFrom + 18 * k * k;
            if (k >= 1) {
              lift.x = 0;
              current.obj.visible = false;
              enter('stowed', now);
              state.content = null;
              if (queued) {
                const q = queued;
                queued = null;
                show(q, now);
              }
            }
            break;
          }
          case 'stowed':
            break;
        }
        if (!reduced && (phase === 'pop' || phase === 'hold')) {
          const prevV = lean.v;
          springStep(lean, CARD_POSE.lean, F.leanOmega, F.leanDamping, dt);
          lastLeanV = (lean.v - prevV) / Math.max(dt, 1e-4);
          springStep(sway, 0, F.swayOmega, F.swayDamping, dt);
        }
        if (!reduced) {
          // the card lags the stick: the stick's angular acceleration pushes it the other way
          springStep(flap, CARD_POSE.flap, F.flapOmega, F.flapDamping, dt, -lastLeanV * F.flapGain * F.flapOmega);
          if (phase === 'breath' || phase === 'drop') lastLeanV = 0;
        }
        pose.lift = lift.x;
        pose.lean = lean.x;
        pose.sway = sway.x;
        pose.flap = flap.x;
        if (phase !== 'stowed') poseCardArm(current.obj, pose, current.stow);
      },
      dispose() {
        root.removeFromParent();
        cache.clear();
      },
    };
    return view;
  };
}
