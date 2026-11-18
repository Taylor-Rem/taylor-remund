/**
 * Patch at the board (crew; § B5; W2 part 2): on its stool on the runner, working the jack whose line
 * rang, drawn at the crew's scale about its seat (`view/stations/operator.ts`). The stool is drawn here.
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createOperatorView } from '../../stations/operator.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'patch',
  order: ORDER.crew,
  make(k) {
    const sf = origin(LAYOUT.stations.storefront);
    const pl = origin(LAYOUT.stations.platen);
    return createOperatorView({
      patch: k.entry('patch-felt'),
      stool: k.entry('stool'),
      fit: k.fit,
      seed: k.seed,
      crewScale: k.crewScale,
      key: k,
      // what each line changes, where Patch leans out to look: the shop's sign, the tray, the belt's middle, the lamp's shade
      things: {
        storefront: [sf[0] - 0.4, 1.9, sf[1] + 0.3],
        platen: [pl[0], 0.9, pl[1]],
        belt: [LAYOUT.stations.belt.x, 0.9, LAYOUT.stations.belt.z],
        lamp: [LAYOUT.stations.lamp.x + 0.6, 4.0, LAYOUT.stations.lamp.z + 1.4],
      },
    });
  },
};
