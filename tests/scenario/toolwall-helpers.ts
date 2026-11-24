// Helpers for the tool wall's scenarios (P4 T2): take a tool off its peg, carry it, hang it back.
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Vec3 } from '../../src/workshop/sim/types.ts';
import type { Tape } from './line-helpers.ts';
import { TOOLWALL, toolId, pegId } from '../../src/workshop/sim/scenes/bench.ts';
import { line } from './helpers.ts';

export const KINDS = Object.keys(TOOLWALL.tools);
export const TOOLS: readonly Id[] = KINDS.map(toolId);
export const hangAt = (id: Id): Vec3 => TOOLWALL.tools[id.slice('tool-'.length)]!.at;
export const pegOf = (id: Id): Id => pegId(id.slice('tool-'.length));

/** Is it on its peg: in the wall's hands, where it hangs. */
export function onPeg(w: World, id: Id): boolean {
  const m = w.motion(id);
  const l = w.part(id)?.location;
  if (!m || m.mode !== 'machine' || !l || l.at !== 'in' || l.mouth !== TOOLWALL.unit) return false;
  const h = hangAt(id);
  return Math.hypot(m.pose.p[0] - h[0], m.pose.p[1] - h[1], m.pose.p[2] - h[2]) < 0.01;
}

/** Take a tool by its middle and lift it a little off its peg (held). */
export function take(w: World, t: Tape, id: Id): void {
  const p = w.motion(id)!.pose.p;
  w.dispatch({ type: 'grab', id, grip: p });
  t.run(2);
}

/** Carry what is held to `to` (where its middle should be), in `n` steps, and let it settle in the hand. */
export function carryTo(w: World, t: Tape, id: Id, to: Vec3, n = 40): void {
  const from = w.motion(id)!.pose.p;
  for (const p of line(from, to, n)) {
    w.dispatch({ type: 'carry', target: p });
    t.run(1);
  }
  for (let i = 0; i < 60; i++) {
    w.dispatch({ type: 'carry', target: to });
    t.run(1);
    const q = w.motion(id)!.pose.p;
    if (Math.hypot(q[0] - to[0], q[1] - to[1], q[2] - to[2]) < 0.05) break;
  }
}

/** Let go, still, or with this velocity. */
export function letGo(w: World, t: Tape, velocity: Vec3 = [0, 0, 0]): void {
  w.dispatch({ type: 'release', velocity });
  t.run(1);
}

/** Wait until it rests (free, settled) or is on its peg, at most `max` steps. */
export function settle(w: World, t: Tape, id: Id, max = 400): void {
  for (let i = 0; i < max; i++) {
    t.run(1);
    if (onPeg(w, id)) return;
    const m = w.motion(id);
    if (m?.mode === 'free' && !m.awake && w.part(id)?.location.at === 'rest') return;
  }
}

/** Every tool on its peg. */
export const allHung = (w: World): boolean => TOOLS.every((id) => onPeg(w, id));
