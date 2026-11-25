/**
 * P4 S6: the opening stand drawn where the scene puts it (its static body, sim/scenes/bench.ts `withOpeningStand`). I2
 * (the owner, 2026-11-25): the placeholder that ships for now, the pedestal alone (kit/pieces/opening-stand/), until a
 * real machine is designed there; the decorated looks (`?standLook=1|2`, the lifter arm and the inspection lamp) and the
 * round-one table are gone. Nothing of it moves: the whole of it is merged into the set (no draw call of its own).
 */
import { openingStand } from '../../kit/pieces/opening-stand/index.ts';
import { ORDER, at, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'opening-stand',
  order: ORDER.pool + 1,
  make(k) {
    const os = k.scene.openingStand;
    const body = os ? k.scene.statics.find((s) => s.id === os.unit) : undefined;
    if (!os || !body || body.shape.type !== 'box') return null;
    const half = body.shape.half;
    const h = half[1] * 2;
    const [x, y, z] = body.pose.p;
    const base = y - h / 2;
    return staticStation(k, () => [{ piece: openingStand({ h, seed: k.seed, half: [half[0], half[2]] }), at: at(x, base, z) }]);
  },
};
