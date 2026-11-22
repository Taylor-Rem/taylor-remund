/**
 * The report press (P4 D3), alive: view/stations/press.ts poses its lever, sheets, drawer and spring arm, paints its
 * paper, and gives the lever its pick target. After the parts: it reads the press's object as the parts view drew it.
 */
import { PRESS } from '../../../sim/index.ts';
import { createPressView } from '../../stations/press.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'press',
  order: ORDER.parts + 3,
  make(k) {
    if (!k.scene.parts.some((p) => p.id === PRESS.body)) return null;
    return timed('press', createPressView({ unit: PRESS.unit, body: PRESS.body, envelope: PRESS.envelope, lever: PRESS.lever }));
  },
};
