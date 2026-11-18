/** The UNDO lever (§ B2 X3), at home and static until its view lands: beside the Button, in the lamp's pool. */
import { LAYOUT, origin } from '../../bench.ts';
import { ORDER, at, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'undo',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const p = build('undo-lever');
      const [x, z] = origin(LAYOUT.stations.undo);
      return p ? [{ piece: p, at: at(x, 0, z) }] : [];
    });
  },
};
