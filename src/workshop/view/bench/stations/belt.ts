/**
 * The belt (station `line`): the belt piece at the bench's length (view/stations/belt.ts), its body merged
 * into the set; the rollers, the seam and the lamp move here, scrolled by the belt machine's phase.
 */
import { createBeltView } from '../../stations/belt.ts';
import { LAYOUT } from '../../bench.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'belt',
  order: ORDER.pool,
  async make(k) {
    return createBeltView({ entry: k.entry('belt'), module: await k.module('belt'), fit: k.fit, seed: k.seed, pool: k.pool, length: LAYOUT.beltLength, build: { line: true } });
  },
};
