/**
 * The platen (station `patchlamp`; W2 part 4), at its own origin: its base merged into the set, its arm,
 * tray, tape head, sight tube, gauge, wheel and lamp performed from the simulation's beats
 * (`view/stations/platen.ts`).
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createPlatenView } from '../../stations/platen.ts';
import { ORDER, at, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'platen',
  order: ORDER.pool,
  make(k) {
    const [x, z] = origin(LAYOUT.stations.platen);
    return createPlatenView({ entry: k.entry('platen'), at: at(x, 0, z), seed: k.seed, pool: k.pool, key: k });
  },
};
