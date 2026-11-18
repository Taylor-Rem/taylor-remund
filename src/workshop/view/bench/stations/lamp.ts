/** The lamp (station `top`): its body, its light, its flinch (view/stations/lamp.ts). */
import { createLampView } from '../../stations/lamp.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'lamp',
  order: ORDER.late,
  make() {
    return createLampView();
  },
};
