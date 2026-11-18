/** Patch on its stool at the board (crew; § B5), drawn at the crew's scale about its seat. */
import { createPatchView } from '../../stations/patch.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'patch',
  order: ORDER.crew,
  async make(k) {
    const inner = createPatchView({ entry: k.entry('patch-felt'), module: await k.module('patch-felt'), fit: k.fit, seed: k.seed });
    return (ctx) => {
      const v = inner(ctx);
      v.root.scale.setScalar(k.crewScale);
      return v;
    };
  },
};
