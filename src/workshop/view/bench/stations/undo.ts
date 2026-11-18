/**
 * The UNDO lever (§ B2 X3, § D 8), alive: view/stations/undo.ts. Beside the Button, in the lamp's pool.
 * After the parts: the undo's hops are drawn over the parts view.
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createUndoView } from '../../stations/undo.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'undo',
  order: ORDER.crew + 4,
  make(k) {
    return createUndoView({ at: origin(LAYOUT.stations.undo), seed: k.seed });
  },
};
