/**
 * The UNDO lever, alive, and the undo seen everywhere no station draws it
 * (REWRITE.md § B2 X3, § D 8, § E5 rules 8-12; W3 brief § 3). The kit's
 * `undo-lever` piece driven by its view state (`world.machine('undo-lever')`,
 * kind `undo-lever`) and the step's `undone` events:
 *
 *  - the pull follows the simulation's travel (a pull reaches the end of its
 *    travel in 100 ms): the catch handle squeezes first, the lever swings
 *    left and the spring's rings spread; at the end of the travel it knocks
 *    against its stop; let go, it snaps home on its spring, past home and
 *    back (the overshoot is this view's);
 *  - a misfire (rungs 2 to 4): the simulation's twitch, with a rattle;
 *  - its lamp: lit while there is something to undo; a slow blink as a tell;
 *  - the undo itself, for loose parts: each part restored to a place hops
 *    back to it from where it was at the moment of the undo, last moved
 *    first, on short arcs (`hops.ts`). A shipment coming back in through the
 *    dock's door is the dock's to draw; Revert is drawn by its own view.
 *
 * Reduced motion: the lever cuts between its travel and home (no overshoot,
 * no rattle) and parts are put back without a hop.
 */
import { Group } from 'three';
import type { Id, Pose, SimEvent, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { undoLever, undoLabels, poseUndoLever } from '../kit/pieces/undo-lever/index.ts';
import type { UndoPose } from '../kit/pieces/undo-lever/index.ts';
import { Spring } from '../anim/index.ts';
import { createHops, type PartHops } from './hops.ts';
import { nodeBounds, proxyOn } from './proxy.ts';

/** Tune here. Fractions of the lever's travel, seconds. */
export const UNDO_FEEL = {
  /** Following the hand: a stiff spring (the hand is quick); home: a looser one that overshoots past home. */
  pullOmega: 60,
  pullDamping: 0.75,
  homeOmega: 22,
  homeDamping: 0.3,
  /** The stop at the end of the travel: a knock back off it (fraction of travel per second). */
  knock: 1.6,
  /** The catch handle. */
  latchOmega: 40,
  latchDamping: 0.6,
  /** A misfire's rattle on top of the twitch. */
  rattle: 0.04,
  rattleHz: 17,
  /** The slow blink of a tell (Hz; the § B4 limit is three a second). */
  blinkHz: 1.25,
  /** Hovered: the latch stirs (fraction of its squeeze), the lever leans a hair (fraction of travel), eased (1/s). */
  hoverLatch: 0.3,
  hoverPull: 0.018,
  hoverRate: 20,
  /** Hops start a beat after the pull lands. */
  hopDelay: 0.08,
} as const;

export interface UndoViewOptions {
  /** Where the lever stands (its origin on the bench). */
  at: readonly [number, number];
  /** Its id (default 'undo-lever'). */
  id?: Id;
  seed?: number;
}

export interface UndoViewState {
  pull: number;
  latch: number;
  lamp: boolean;
  hops: number;
}

export interface UndoStationView extends StationView {
  readonly state: UndoViewState;
}

export function createUndoView(opts: UndoViewOptions): (ctx: ViewContext) => UndoStationView {
  return (ctx) => {
    const F = UNDO_FEEL;
    let R = ctx.reducedMotion;
    const id = opts.id ?? 'undo-lever';
    const root = new Group();
    root.name = 'undo-station';
    ctx.scene.add(root);
    const built = undoLever({ labels: undoLabels(ctx.labels), seed: opts.seed ?? 1, detail: ctx.tier === 'low' ? 'low' : 'high' });
    const obj = ctx.realize(built);
    root.add(obj);
    // the pick target is the lever itself, riding on it down its arc (generous: a finger needs 44 px)
    const leverBone = obj.getObjectByName('lever');
    const target = leverBone ? proxyOn(leverBone, nodeBounds(built, 'lever'), 'lever:proxy', 0.1) : obj;
    let hover = 0;
    let placed = false;
    const pull = new Spring(0, { omega: F.pullOmega, zeta: F.pullDamping });
    const latch = new Spring(0, { omega: F.latchOmega, zeta: F.latchDamping });
    let misfireAt = -Infinity;
    let atStop = false;
    const hops: PartHops = createHops(ctx.scene);
    const pose: UndoPose = { pull: 0, latch: 0, lamp: false };
    const state: UndoViewState = { pull: 0, latch: 0, lamp: false, hops: 0 };

    const place = (w: WorldView): void => {
      placed = true;
      root.position.set(opts.at[0], w.scene.bench.top, opts.at[1]);
      ctx.pickable(id, target);
    };

    /** The undo's loose parts, hopping back last moved first (the restores come most recent first). */
    const undone = (e: Extract<SimEvent, { type: 'undone' }>, events: readonly SimEvent[], w: WorldView, now: number): void => {
      if (R) return;
      const byDoor = new Set<Id>();
      for (const x of events) if (x.type === 'returned' && x.how === 'door') byDoor.add(x.part);
      const items: { id: Id; from: Pose }[] = [];
      const seen = new Set<Id>();
      for (const r of e.restores) {
        if (r.field !== 'location' || !r.pose || seen.has(r.target) || byDoor.has(r.target)) continue;
        const p = w.part(r.target);
        if (!p || p.kind === 'robot') continue;
        const now0 = w.motion(r.target)?.pose;
        if (now0 && Math.hypot(now0.p[0] - r.pose.p[0], now0.p[1] - r.pose.p[1], now0.p[2] - r.pose.p[2]) < 0.02) continue;
        seen.add(r.target);
        items.push({ id: r.target, from: r.pose });
      }
      if (items.length) hops.chain(items, now + F.hopDelay);
      state.hops = items.length;
    };

    const view: UndoStationView = {
      root,
      state,
      update(frame: Frame) {
        const w = frame.world;
        if (!placed) place(w);
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        R = ctx.reducedMotion || w.reducedMotion;
        const v = w.machine(id);
        for (const e of frame.events) {
          if (e.type === 'undone') undone(e, frame.events, w, now);
          else if (e.type === 'misfire' && e.id === id && !R) misfireAt = now;
        }
        if (v && v.kind === 'undo-lever') {
          const goal = v.travel;
          if (R) {
            pull.set(goal);
            latch.set(v.latch);
          } else {
            // following the hand on the way out; on its spring on the way home
            const out = v.phase === 'pull' || v.phase === 'hold';
            pull.tune(out ? { omega: F.pullOmega, zeta: F.pullDamping } : { omega: F.homeOmega, zeta: F.homeDamping });
            pull.step(goal, dt);
            // the stop at the end of the travel: it knocks against it once
            if (pull.x > 1.02) {
              pull.x = 1.02;
              if (!atStop) pull.v = -F.knock;
              atStop = true;
            } else if (pull.x < 0.95) atStop = false;
            latch.step(v.latch, dt);
          }
          // hovered, the latch stirs under the pointer and the lever leans a hair into the hand
          const live = !w.bracketed && w.holding() === null && v.phase === 'rest';
          hover = R ? 0 : hover + ((frame.hovered === id && live ? 1 : 0) - hover) * (1 - Math.exp(-F.hoverRate * dt));
          let p = pull.x + F.hoverPull * hover;
          const ma = now - misfireAt;
          if (!R && ma >= 0 && ma < 0.5) p += F.rattle * Math.exp(-7 * ma) * Math.sin(2 * Math.PI * F.rattleHz * ma);
          pose.pull = p;
          pose.latch = Math.max(0, Math.min(1, latch.x + F.hoverLatch * hover * (0.85 + 0.15 * Math.sin(now * 9))));
          // its lamp: lit while there is something to undo; a slow blink as a tell
          pose.lamp = v.lamp === 'blink' ? Math.sin(2 * Math.PI * F.blinkHz * now) > -0.2 : v.armed;
        }
        state.pull = pose.pull ?? 0;
        state.latch = pose.latch ?? 0;
        state.lamp = pose.lamp ?? false;
        poseUndoLever(obj, pose);
        hops.update(now, (pid) => w.motion(pid)?.pose);
      },
      dispose() {
        root.removeFromParent();
      },
    };
    return view;
  };
}
