/**
 * The storefront (station `patchlamp`; W2 part 3), at its own origin: its body merged into the set, its
 * slats, awning, card, drum, window light and lamp performed from the simulation's beats
 * (`view/stations/storefront.ts`).
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createStorefrontView } from '../../stations/storefront.ts';
import { ORDER, at, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'storefront',
  order: ORDER.pool,
  make(k) {
    const [x, z] = origin(LAYOUT.stations.storefront);
    return createStorefrontView({ entry: k.entry('storefront'), at: at(x, 0, z), seed: k.seed, pool: k.pool, key: k });
  },
};
