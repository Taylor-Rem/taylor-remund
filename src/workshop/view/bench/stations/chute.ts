/**
 * The return chute (§ B1 "the bench edge"): up out of the dark at the front-left corner, over the edge, back
 * CHUTE_RUN and turned CHUTE_AIM so its mouth looks along the bench at the clear spot beside the stack where
 * a returned part lands. It jolts on its straps when a part pops out (`view/stations/chute.ts`), so it is
 * drawn on its own rather than merged into the set.
 */
import { createChuteView } from '../../stations/chute.ts';
import { CHUTE_AIM, CHUTE_RUN, LAYOUT, origin } from '../../bench.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { ORDER, at, castAbove, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'chute',
  order: ORDER.pool,
  make(k) {
    const e = k.entry('chute');
    const [x, z] = origin(LAYOUT.stations.chute);
    return (ctx) => {
      const p = e ? buildEntry(e, null, { seed: k.seed, run: CHUTE_RUN, aim: CHUTE_AIM }, ctx.labels) : null;
      // its riser below the bench top casts nothing
      return createChuteView({ piece: p ? castAbove(p, at(x, 0, z)) : null, at: [x, z] })(ctx);
    };
  },
};
