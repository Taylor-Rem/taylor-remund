/**
 * The whole switchboard and its cord (station `patchlamp`): four live jacks (`JACKS`), a drawer per line,
 * the stool's runner in front. The cabinet is merged into the set; its lamps, drawers, plug and cord live
 * (`view/stations/cord.ts`, which knows the cord's two jacks, STOREFRONT and LAMP, and keeps the cord off
 * the whole board's shelf through BOARD_WHOLE). The board stands where the scene's body is.
 */
import type { Entry } from '../../catalogue/registry.ts';
import { createCordView } from '../../stations/cord.ts';
import { JACKS } from '../../kit/pieces/switchboard/index.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'board',
  order: ORDER.pool,
  async make(k) {
    const e = k.entry('switchboard');
    const board: Entry | undefined = e
      ? { ...e, build: (opts = {}) => e.build({ ...opts, jacks: JACKS }), ...(e.labels ? { labels: (labels, opts) => e.labels!(labels, { ...opts, jacks: JACKS }) } : {}) }
      : undefined;
    const m = await k.module('switchboard');
    const boardModule = m ? { ...m, BOARD: m['BOARD_WHOLE'] ?? m['BOARD'] } : null;
    return createCordView({ board, plug: k.entry('cord-plug'), boardModule, fit: k.fit, seed: k.seed, pool: k.pool });
  },
};
