/**
 * What a dial or a lever reads now (`HandleReading`: a value 0..1 over n
 * detents), so a drag, an arrow key or the wheel can move it one detent
 * from where it is.
 *
 * WORK-ROUND, to be deleted. The world publishes no generic reading for a
 * handle: a `turn` handle's value lives in its machine's view (the belt's
 * `speed` of `detents`, its `running` and `direction`). Until the contract
 * gives every `turn`/`slide` interactable its reading (proposed in the I1
 * hand-in: `WorldView.reading(id): { value: number; detents: number } |
 * undefined`, answered by the machine that registered the handle), this
 * reads it from the one machine view that has handles of that kind, found
 * by station, never by id. It imports only sim/types.
 */
import type { Id, Vec3, WorldView } from '../sim/types.ts';
import type { HandleReading } from './gesture.ts';

export function readingFromWorld(w: WorldView, id: Id): HandleReading | null {
  const it = w.interactable(id);
  if (!it) return null;
  const turn = it.affordances.includes('turn');
  const slide = it.affordances.includes('slide') && !it.affordances.includes('grab');
  if (!turn && !slide) return null;
  for (const other of w.interactables()) {
    if (other.station !== it.station) continue;
    const m = w.machine(other.id);
    if (m?.kind !== 'belt') continue;
    if (turn) return { value: m.detents > 1 ? (m.speed - 1) / (m.detents - 1) : 0, detents: m.detents };
    return { value: !m.running ? 0.5 : m.direction === 'forward' ? 1 : 0, detents: 3 };
  }
  return null;
}

/**
 * Where an arm that aims (a held unit that `slide`s: the lamp) points now, and the region it can reach
 * (world x, z, a convex polygon), so a drag starts from where the light is and the hand's target stays
 * where the arm can follow. Same work-round as above: the contract would give it as the unit's reading.
 */
export function aimFromWorld(w: WorldView, id: Id): { aim: Vec3; reach: readonly (readonly [number, number])[] } | null {
  const m = w.machine(id);
  return m?.kind === 'lamp' ? { aim: m.aim, reach: m.reach } : null;
}

/** The nearest point to (x, z) inside a convex polygon (either winding). */
export function clampToPolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): [number, number] {
  const n = poly.length;
  if (n < 3) return [x, z];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    area += ax * bz - bx * az;
  }
  const s = Math.sign(area) || 1;
  let inside = true;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    if (s * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 0) inside = false;
  }
  if (inside) return [x, z];
  let best: [number, number] = [x, z];
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    const dx = bx - ax;
    const dz = bz - az;
    const L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [px, pz];
    }
  }
  return best;
}
