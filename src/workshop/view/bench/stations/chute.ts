/**
 * The return chute (§ B1 "the bench edge"), static: up out of the dark at the front-left corner, over the
 * edge, back CHUTE_RUN and turned CHUTE_AIM so its mouth looks along the bench at the clear spot beside
 * the stack where a returned part lands.
 */
import { CHUTE_AIM, CHUTE_RUN, LAYOUT, origin } from '../../bench.ts';
import { ORDER, at, castAbove, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'chute',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const p = build('chute', { run: CHUTE_RUN, aim: CHUTE_AIM });
      const [x, z] = origin(LAYOUT.stations.chute);
      // its riser below the bench top casts nothing
      const m = at(x, 0, z);
      return p ? [{ piece: castAbove(p, m), at: m }] : [];
    });
  },
};
