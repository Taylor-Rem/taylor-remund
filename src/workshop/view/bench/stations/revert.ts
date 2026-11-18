/**
 * Revert and its hatch, alive (crew; § B5, § B4): view/stations/revert.ts. Both were built at the crew's
 * 1.25×: drawn at the bench's crew scale / 1.25. The bench top is cut for the hatch in set.ts. After the
 * parts (a put-away's hop is drawn over the parts view).
 */
import { LAYOUT, REVERT_SCALE, origin } from '../../bench.ts';
import { createRevertView } from '../../stations/revert.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'revert',
  order: ORDER.crew + 3,
  make(k) {
    const rk = k.crewScale / 1.25;
    const hatch = origin(LAYOUT.stations.hatch);
    const sp = LAYOUT.stations.revert;
    const [ox, oz] = origin(sp);
    // the footprint's centre from the piece's origin, at this crew scale (the layout's is at the bench's)
    const f = rk / REVERT_SCALE;
    return createRevertView({ hatch, scale: rk, centre: [(sp.x - ox) * f, (sp.z - oz) * f], seed: k.seed });
  },
};
