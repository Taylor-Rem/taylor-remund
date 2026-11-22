/**
 * The paint dial (P4 D2b), alive: view/stations/paint-dial.ts poses its chips and wheel, repaints the workshop when its
 * scheme changes, and gives its control a pick target. After the parts: it reads the dial's object as the parts view drew it.
 */
import { PAINT } from '../../../sim/index.ts';
import { createPaintDialView } from '../../stations/paint-dial.ts';
import { DIAL_STYLE } from '../../kit/pieces/paint-dial/index.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'paint-dial',
  order: ORDER.parts + 3,
  make(k) {
    if (!k.scene.parts.some((p) => p.id === PAINT.dial)) return null;
    return timed('paint-dial', createPaintDialView({ dial: PAINT.dial, unit: PAINT.unit, knob: PAINT.knob, crate: PAINT.crate, style: DIAL_STYLE }));
  },
};
