/** The Big Red Button on its console (station `button`; § B4): view/stations/button.ts, where the scene's body is (L2: in the back left corner, at CONSOLE_SCALE; its cap lit from inside, the owner's choice of 2026-11-25). */
import { CONSOLE_SCALE } from '../../bench.ts';
import { createButtonView } from '../../stations/button.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'button',
  order: ORDER.crew + 1,
  make(k) {
    const s = k.scene.statics.find((x) => x.id === 'console');
    return timed('button', createButtonView({ scale: CONSOLE_SCALE, ...(s ? { consoleAt: [s.pose.p[0], s.pose.p[2]] as const } : {}) }));
  },
};
