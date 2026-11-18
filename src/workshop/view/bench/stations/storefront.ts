/** The storefront (station `patchlamp`), at rest and static until its view lands: placed at its own origin. */
import { LAYOUT, origin } from '../../bench.ts';
import { ORDER, at, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'storefront',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const p = build('storefront');
      const [x, z] = origin(LAYOUT.stations.storefront);
      return p ? [{ piece: p, at: at(x, 0, z) }] : [];
    });
  },
};
