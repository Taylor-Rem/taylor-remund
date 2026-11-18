// Throwing things at Fetch (S5 knock scenarios).
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const G = 16;

/**
 * The visitor picks `id` up, carries it to a point `from` units away from Fetch along yaw `yaw` (0 = +Z),
 * at height `y`, holds it there a moment, and throws it at Fetch's middle at `speed` (horizontal),
 * aimed to arrive at the height of its body's centre. Returns the events of the carry and the release.
 */
export function throwAtFetch(w: World, id: Id, opts: { yaw: number; from?: number; speed: number; y?: number; aimSide?: number }): SimEvent[] {
  const out: SimEvent[] = [];
  const step = (): void => {
    w.advance();
    out.push(...w.drainEvents());
  };
  const m = w.motion(id);
  if (!m) throw new Error(`no part ${id}`);
  const f = w.crew('fetch')!;
  const from = opts.from ?? 1.7;
  const y = opts.y ?? 1.0;
  const sx = Math.sin(opts.yaw);
  const sz = Math.cos(opts.yaw);
  // across the line of the throw, for an off-centre hit
  const side = opts.aimSide ?? 0;
  const start: Vec3 = [f.x + sx * from + sz * side, y, f.z + sz * from - sx * side];
  w.dispatch({ type: 'grab', id, grip: m.pose.p });
  const a = m.pose.p;
  const high = Math.max(a[1], y) + 1.4;
  const n1 = 12;
  const n2 = 24;
  for (let i = 1; i <= n1; i++) {
    w.dispatch({ type: 'carry', target: [a[0], a[1] + ((high - a[1]) * i) / n1, a[2]] });
    step();
  }
  for (let i = 1; i <= n2; i++) {
    const k = i / n2;
    w.dispatch({ type: 'carry', target: [a[0] + (start[0] - a[0]) * k, high + (y - high) * k, a[2] + (start[2] - a[2]) * k] });
    step();
  }
  for (let i = 0; i < 25; i++) {
    w.dispatch({ type: 'carry', target: start });
    step();
  }
  const p = w.motion(id)!.pose.p;
  const g = w.crew('fetch')!;
  const tx = g.x + sz * side - p[0];
  const tz = g.z - sx * side - p[2];
  const d = Math.hypot(tx, tz);
  const t = Math.max(0.05, (d - 0.5) / opts.speed);
  const targetY = 0.75;
  const vy = (targetY - p[1] + 0.5 * G * t * t) / t;
  w.dispatch({ type: 'release', velocity: [(tx / d) * opts.speed, vy, (tz / d) * opts.speed] });
  step();
  return out;
}

/** Throw (as `throwAtFetch`), then run until Fetch is knocked or nudged, or `max` steps pass. */
export function throwAndSee(w: World, id: Id, opts: Parameters<typeof throwAtFetch>[2], max = 40): SimEvent[] {
  const out = throwAtFetch(w, id, opts);
  const hit = (): boolean => out.some((e) => e.type === 'crew.knocked' || e.type === 'crew.nudged');
  for (let i = 0; i < max && !hit(); i++) {
    w.advance();
    out.push(...w.drainEvents());
  }
  return out;
}

/** Advance until `pred` holds (checked after each step) or `max` steps; returns every event. */
export function runWhile(w: World, keepGoing: () => boolean, max: number, each?: (ev: SimEvent[]) => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max && keepGoing(); i++) {
    w.advance();
    const ev = w.drainEvents();
    each?.(ev);
    out.push(...ev);
  }
  return out;
}
