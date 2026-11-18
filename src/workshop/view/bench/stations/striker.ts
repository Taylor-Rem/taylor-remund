/**
 * The striker (station `line`; § B2 X2), alive: its post between the lane and the belt, its hammer over the
 * belt at the simulation's `LINE.strikerX`; its body merged into the set, its arm, cam, follower, spring and
 * lamp driven by `view/stations/striker.ts`.
 */
import { createStrikerView } from '../../stations/striker.ts';
import { LAYOUT, origin } from '../../bench.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'striker',
  order: ORDER.pool,
  make(k) {
    return createStrikerView({ entry: k.entry('striker'), at: origin(LAYOUT.stations.striker), seed: k.seed, pool: k.pool });
  },
};
