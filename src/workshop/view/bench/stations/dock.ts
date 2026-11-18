/**
 * The dock (station `line`), alive: its ramp fitted to the belt's end (DOCK_REACH), its body merged into the
 * set; the shutter, the ramp's rollers, the curtain, the bell and the lamp driven by `view/stations/dock.ts`.
 */
import { createDockView } from '../../stations/dock.ts';
import { DOCK_REACH, LAYOUT, origin } from '../../bench.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'dock',
  order: ORDER.pool,
  make(k) {
    return createDockView({ at: origin(LAYOUT.stations.dock), reach: DOCK_REACH, seed: k.seed, pool: k.pool });
  },
};
