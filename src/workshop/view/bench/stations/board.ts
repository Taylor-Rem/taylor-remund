/**
 * The whole switchboard and its cord (station `patchlamp`; W2 part 1): six jacks, four live; the cabinet
 * merged into the set; its lenses, collars and drawers live, the plug and the cord
 * (`view/stations/switchboard.ts`). The board stands where the scene's body is.
 */
import { createSwitchboardView } from '../../stations/switchboard.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'board',
  order: ORDER.pool,
  make(k) {
    return createSwitchboardView({ board: k.entry('switchboard'), fit: k.fit, seed: k.seed, pool: k.pool, key: k });
  },
};
