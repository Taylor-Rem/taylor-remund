/**
 * The floor far below the bench (V; ART-P2 § 5): dark boards that catch
 * whatever reaches them (the cool fill, the lamp's spill past the bench's
 * ends) and nothing else.
 *
 * What the camera can see of it is little: under the bench between the
 * legs (z about 1 to 4) and past the bench's ends against the wall, all of
 * it deep in the room's fall-off. So it is cheap: boards along X (one long
 * board is cheaper than many short ones, and their seams run across the
 * picture like the bench's), lengths with staggered butt joints, each a
 * hair off level, darker toward the wall. Only the top and the near edges
 * are built.
 *
 *   floor({ width, z0, z1 })   top at y = 0 in its own space (place it at the floor's height),
 *                              centred on x = 0, from z0 (the wall) to z1 (toward the visitor).
 */
import type { KitOptions, Piece } from '../../types.ts';
import { large, piece } from '../../compose.ts';
import { bevelBox } from '../../cheap.ts';
import { rng } from '../../rng.ts';
import { tint } from '../../surface.ts';

export interface FloorOptions extends KitOptions {
  /** Along X (default 27). */
  width?: number;
  /** From the wall (default -5) to the near side (default 4.5). */
  z0?: number;
  z1?: number;
}

/** How dark the floor is: `wood` taken far down. */
export const FLOOR_SHADE = 0.3;

export function floor(o: FloorOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const W = o.width ?? 27;
  const z0 = o.z0 ?? -5, z1 = o.z1 ?? 4.5;
  const b = piece('floor', { detail, seed, ao: false });
  const bw = 0.82;
  const gap = 0.02;
  const rows = Math.ceil((z1 - z0) / bw);
  for (let i = 0; i < rows; i++) {
    const za = z0 + i * bw + gap / 2, zb = Math.min(z1, za + bw - gap);
    const xs = [-W / 2];
    let x = -W / 2 + R.range(1.5, 7);
    while (x < W / 2 - 1.5) {
      xs.push(x);
      x += R.range(5, 10);
    }
    xs.push(W / 2);
    // darker toward the wall, where nothing reaches
    const back = 1 - Math.min(1, Math.max(0, (za - z0) / (z1 - z0)));
    for (let k = 0; k < xs.length - 1; k++) {
      const xa = xs[k]! + (k > 0 ? 0.01 : 0), xb = xs[k + 1]! - (k < xs.length - 2 ? 0.01 : 0);
      const dy = R() < 0.35 ? -R.range(0.004, 0.012) : 0;
      const g = bevelBox({ min: [xa, -0.2 + dy, za], max: [xb, dy, zb], c: 0.018, omit: ['ny', 'nz', ...(k === 0 ? ['nx' as const] : []), ...(k === xs.length - 2 ? ['px' as const] : [])], wear: 0.45 });
      tint(g, 'wood', { seed: R.int(0, 1e6), jitter: 0.08, warm: 0.04, shade: FLOOR_SHADE * (1 - 0.35 * back) });
      b.add(large({ material: 'wood', geometry: g }));
    }
  }
  return b.build();
}
