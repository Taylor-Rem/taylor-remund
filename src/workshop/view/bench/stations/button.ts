/** The Big Red Button on its console (station `button`; § B4): view/stations/button.ts, where the scene's body is. */
import { createButtonView } from '../../stations/button.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'button',
  order: ORDER.crew + 1,
  make() {
    return timed('button', createButtonView());
  },
};
