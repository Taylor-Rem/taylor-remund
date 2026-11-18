// "A part crosses each machine's mouth once per ride": an observer of a world's event stream. A ride
// begins when a part is taken into a mouth and ends when something other than the line moves it on: the
// visitor picks it up, an undo or a reset puts it back, Revert puts it away, it ships or comes back, or it
// comes to rest outside every mouth. Within one ride no machine takes the same part in twice.
import type { Id, SimEvent } from '../../src/workshop/sim/types.ts';

export interface RideWatch {
  (events: readonly SimEvent[], step: number): void;
  readonly takes: number;
}

export function rideWatch(): RideWatch {
  const ride = new Map<Id, Set<Id>>();
  let takes = 0;
  const watch = ((events: readonly SimEvent[], step: number) => {
    const takenNow = new Set<Id>();
    for (const e of events) {
      if (e.type === 'reset') ride.clear();
      else if (e.type === 'undone') for (const r of e.restores) ride.delete(r.target);
      else if (e.type === 'part.grabbed' || e.type === 'put-away' || e.type === 'part.returned') ride.delete(e.id);
      else if (e.type === 'shipped' || e.type === 'restocked') ride.delete(e.part);
      else if (e.type === 'part.rested' && !takenNow.has(e.id)) ride.delete(e.id);
      else if (e.type === 'taken-in') {
        takes++;
        takenNow.add(e.part);
        const seen = ride.get(e.part) ?? new Set<Id>();
        if (seen.has(e.id)) throw new Error(`step ${step}: ${e.id} took ${e.part} in a second time in one ride (after ${[...seen].join(', ')})`);
        seen.add(e.id);
        ride.set(e.part, seen);
      }
    }
  }) as RideWatch;
  Object.defineProperty(watch, 'takes', { get: () => takes });
  return watch;
}
