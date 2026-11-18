/**
 * Revert risen on its lift, and its hatch open (crew; § B5), static until their view lands. Both were
 * built at the crew's 1.25×: drawn at the bench's crew scale / 1.25. The bench top is cut for the hatch
 * in set.ts.
 */
import { LAYOUT, origin } from '../../bench.ts';
import { ORDER, scaledAt, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'revert',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, (build) => {
      const rk = k.crewScale / 1.25;
      const [hx, hz] = origin(LAYOUT.stations.hatch), [rx, rz] = origin(LAYOUT.stations.revert);
      const hatch = build('revert-hatch', { pose: 'open' }), revert = build('revert', { pose: 'idle' });
      return [...(hatch ? [{ piece: hatch, at: scaledAt(hx, hz, rk) }] : []), ...(revert ? [{ piece: revert, at: scaledAt(rx, rz, rk) }] : [])];
    });
  },
};
