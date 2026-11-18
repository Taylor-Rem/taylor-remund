/** The two reserved bays (§ C): taped rectangles with label tape naming what is coming. */
import { LAYOUT } from '../../bench.ts';
import { ORDER, at, staticStation, type BenchStation, type PoolItem } from '../station.ts';

export const station: BenchStation = {
  name: 'bays',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const out: PoolItem[] = [];
      for (const [which, s, seed] of [['next', LAYOUT.stations.bayNext, 3], ['inspection', LAYOUT.stations.bayInspection, 4]] as const) {
        const p = build('reserved-bay', { which, w: s.w, d: s.d, seed });
        if (p) out.push({ piece: p, at: at(s.x, 0, s.z) });
      }
      return out;
    });
  },
};
