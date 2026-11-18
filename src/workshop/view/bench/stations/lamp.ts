/**
 * The lamp (station `top`; § D 14, § B2 X1): its body clamped at its spot, its arm posed from the
 * simulation's aim, its light (level, colour, on and off, the dip) and the key light at its drawn
 * shade, so every shadow on the bench moves with the arm (view/stations/lamp.ts).
 */
import { LAYOUT, origin } from '../../bench.ts';
import { createLampView } from '../../stations/lamp.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'lamp',
  order: ORDER.late,
  make(k) {
    const [x, z] = origin(LAYOUT.stations.lamp);
    return createLampView({ arm: { place: [x, LAYOUT.stations.lamp.y, z], seed: k.seed } });
  },
};
