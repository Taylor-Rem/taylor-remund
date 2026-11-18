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
import type { Id, WorldView } from '../sim/types.ts';
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
