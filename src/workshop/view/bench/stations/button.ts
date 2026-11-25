/** The Big Red Button on its console (station `button`; § B4): view/stations/button.ts, where the scene's body is (L2: in the back left corner, at CONSOLE_SCALE). */
import { CONSOLE_SCALE } from '../../bench.ts';
import { createButtonView } from '../../stations/button.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

/**
 * (I2) The candidate the bench has when none is asked for: the lead's provisional pick (1, the lit cap) until the owner
 * rules between them.
 */
export const CORNER_DEFAULT: 'lit' | 'lamp' | undefined = 'lit';
/** (L2, development only) `?corner=1`: the lit cap; `?corner=2`: the work lamp; `?corner=0`: neither (the candidates for the Button in its corner). */
const corner = (): 'lit' | 'lamp' | undefined => {
  if (!import.meta.env.DEV) return CORNER_DEFAULT;
  try {
    const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get('corner');
    return q === '1' ? 'lit' : q === '2' ? 'lamp' : q === '0' ? undefined : CORNER_DEFAULT;
  } catch {
    return CORNER_DEFAULT;
  }
};

export const station: BenchStation = {
  name: 'button',
  order: ORDER.crew + 1,
  make(k) {
    const c = corner();
    const s = k.scene.statics.find((x) => x.id === 'console');
    return timed('button', createButtonView({ scale: CONSOLE_SCALE, ...(c ? { corner: c } : {}), ...(s ? { consoleAt: [s.pose.p[0], s.pose.p[2]] as const } : {}) }));
  },
};
