/**
 * Pitch (crew; P4 P1a: sim/crew/pitch.ts), drawn at the crew's scale (view/stations/pitch.ts). Only on a bench
 * whose scene has him (`withPitch`, behind `PITCH_ON` and the development pages' `?pitch=1`): elsewhere nothing.
 */
import { createPitchView } from '../../stations/pitch.ts';
import { PITCH_BODY } from '../../../sim/index.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'pitch',
  order: ORDER.crew,
  make(k) {
    if (!k.scene.parts.some((p) => p.id === PITCH_BODY.id)) return null;
    return createPitchView({ scale: k.crewScale, seed: 3 });
  },
};
