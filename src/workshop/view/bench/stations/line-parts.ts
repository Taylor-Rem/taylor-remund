/**
 * The line's parts (brief W1): what the belt, the striker, the dock and the chute do to the parts on them,
 * drawn over the parts view (`view/stations/line.ts`): struck, rocked at the hand-over and on the rollers,
 * slid down the deflector's slide, popped out of the chute, and an undo run backwards. After the parts.
 */
import { LINE } from '../../../sim/index.ts';
import { createLinePartsView } from '../../stations/line.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'line-parts',
  order: ORDER.crew,
  make() {
    return createLinePartsView({ belt: { to: LINE.belt.to, top: LINE.belt.top, z: LINE.belt.z }, ramp: LINE.ramp, door: { origin: LINE.door.origin, inward: LINE.door.inward } });
  },
};
