/**
 * Rung 4's works (§ B4): the warning beacon on the Button's console and its amber wash, and sparks
 * where each used station would spark (view/stations/works.ts). The anchors come from the layout:
 * the striker's hammer, the belt's motor, the dock's door motor, the lever's hub, the lamp's shade.
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createWorksView } from '../../stations/works.ts';
import { ORDER, type BenchStation } from '../station.ts';
import type { Vec3 } from '../../../sim/types.ts';

export const station: BenchStation = {
  name: 'works',
  order: ORDER.crew + 5,
  make(k) {
    const S = LAYOUT.stations;
    const [ux, uz] = origin(S.undo);
    const [sx, sz] = origin(S.striker);
    const [dx, dz] = origin(S.dock);
    const belt = S.belt;
    const anchors: Record<string, Vec3> = {
      'undo-lever': [ux, 0.74, uz - 0.06],
      striker: [sx - 0.375, 1.0, sz + 0.928],
      belt: [belt.x - belt.w / 2 + 0.55, 1.05, belt.z],
      dock: [dx, 2.15, dz],
    };
    if (k.bulb) anchors['lamp'] = [k.bulb.at[0], k.bulb.at[1] - 0.15, k.bulb.at[2]];
    return createWorksView({ anchors, seed: k.seed });
  },
};
