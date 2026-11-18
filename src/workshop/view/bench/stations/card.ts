/** The cue card the Button's rungs put up (view/stations/card.ts). */
import { createCardView } from '../../stations/card.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'card',
  order: ORDER.late + 1,
  make() {
    return createCardView();
  },
};
