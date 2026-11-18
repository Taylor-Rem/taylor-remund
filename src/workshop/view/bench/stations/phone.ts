/**
 * The phone on its easel (station `patchlamp`; W2 part 5), where the scene's body is: it rings when a
 * reply arrives and its screen shows the last exchange (`view/stations/phone.ts`). The set leaves it out.
 */
import { createPhoneView } from '../../stations/phone.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'phone',
  order: ORDER.crew,
  make(k) {
    return createPhoneView({ entry: k.entry('phone'), at: k.fit.phone.at, seed: k.seed, key: k });
  },
};
