/**
 * Pitch's mooring mast (P4 P1a): C1's kit piece, standing where the scene moors him (`PITCH_AT`), its cup turned to
 * his nose. It never moves, so it is handed to the set's pool and merged with the set's meshes (no draw of its own).
 * Only on a bench whose scene has him.
 */
import { Matrix4 } from 'three';
import { PITCH_AT, PITCH_BODY } from '../../../sim/index.ts';
import { ORDER, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'pitch-mast',
  order: ORDER.pool,
  make(k) {
    if (!k.scene.parts.some((p) => p.id === PITCH_BODY.id)) return null;
    return staticStation(k, (build) => {
      const piece = build('pitch-mast', { height: PITCH_AT.mastHeight, seed: 9 });
      if (!piece) return [];
      const h = PITCH_AT.heading;
      // the cup (the head's +X) turned toward him: he is behind his nose, along minus his heading
      const yaw = Math.atan2(Math.cos(h), -Math.sin(h));
      const s = k.crewScale;
      const at = new Matrix4().makeTranslation(PITCH_AT.mast[0], 0, PITCH_AT.mast[1]).multiply(new Matrix4().makeRotationY(yaw)).multiply(new Matrix4().makeScale(s, s, s));
      return [{ piece, at }];
    });
  },
};
