/** The loose parts (crates; Fetch's own body is drawn by fetch.ts): each crate painted as the world says. */
import type { StationView, ViewContext } from '../../types.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { createPartsView } from '../../stations/parts.ts';
import { hashSeed } from '../../vignette.ts';
import { paints, type Token } from '../../palette.ts';
import { ORDER, type BenchStation } from '../station.ts';

const paintOf = (c: string): Token | null => ((paints as readonly string[]).includes(c) ? (c as Token) : null);

export const station: BenchStation = {
  name: 'parts',
  order: ORDER.parts,
  make(k) {
    const crate = k.entry('crate');
    return (ctx: ViewContext): StationView =>
      createPartsView({
        half: (p) => k.world()?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
        ...(crate ? { piece: (p) => buildEntry(crate, null, { size: p.size, paint: paintOf(p.colour), seed: hashSeed(p.id) }, ctx.labels) } : {}),
      })(ctx);
  },
};
