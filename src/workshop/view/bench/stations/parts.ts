/**
 * The loose parts (crates; Fetch's own body is drawn by fetch.ts): each crate built in its paint, with a
 * strip of label tape for its label; the parts view keeps both as the world says from then on.
 */
import type { StationView, ViewContext } from '../../types.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { createPartsView, paintToken } from '../../stations/parts.ts';
import { hashSeed } from '../../vignette.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'parts',
  order: ORDER.parts,
  make(k) {
    const crate = k.entry('crate');
    return (ctx: ViewContext): StationView =>
      createPartsView({
        half: (p) => k.world()?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
        tapes: true,
        ...(crate
          ? { piece: (p, _half, extras) => buildEntry(crate, null, { size: p.size, paint: paintToken(p.colour), seed: hashSeed(p.id), ...(extras.tape ? { tape: extras.tape } : {}) }, ctx.labels) }
          : {}),
      })(ctx);
  },
};
