/**
 * The striker (station `line`; § B2 X2), at rest and static until its view lands: its post between the
 * lane and the belt, its hammer over the belt at the simulation's `LINE.strikerX`.
 */
import { LAYOUT, origin } from '../../bench.ts';
import { ORDER, at, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'striker',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const p = build('striker');
      const [x, z] = origin(LAYOUT.stations.striker);
      return p ? [{ piece: p, at: at(x, 0, z) }] : [];
    });
  },
};
