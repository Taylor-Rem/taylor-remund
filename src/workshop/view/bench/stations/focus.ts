/** The keyboard focus mark (I1 round 2, view/stations/focus.ts): one view marks whatever the keys have focused, last. */
import { createFocusView } from '../../stations/focus.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'focus',
  order: ORDER.late + 5,
  make() {
    return createFocusView();
  },
};
