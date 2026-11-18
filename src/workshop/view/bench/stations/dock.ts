/** The dock (station `line`), at rest and static until its view lands: its ramp fitted to the belt's end (DOCK_REACH). */
import { dock } from '../../kit/pieces/dock/index.ts';
import { DOCK_REACH, LAYOUT, origin } from '../../bench.ts';
import { ORDER, at, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'dock',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const [x, z] = origin(LAYOUT.stations.dock);
      return [{ piece: dock({ seed: k.seed, reach: DOCK_REACH }), at: at(x, 0, z) }];
    });
  },
};
