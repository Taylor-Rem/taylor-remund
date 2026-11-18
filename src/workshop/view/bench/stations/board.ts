/**
 * The switchboard and its cord (station `patchlamp`): the board's cabinet merged into the set, its lamps,
 * drawers, plug and cord live (`view/stations/cord.ts`). The board stands where the scene's body is.
 */
import { createCordView } from '../../stations/cord.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'board',
  order: ORDER.pool,
  async make(k) {
    return createCordView({ board: k.entry('switchboard'), plug: k.entry('cord-plug'), boardModule: await k.module('switchboard'), fit: k.fit, seed: k.seed, pool: k.pool });
  },
};
