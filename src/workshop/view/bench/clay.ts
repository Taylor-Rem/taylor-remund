/**
 * Clay: the stand-in of a piece being built (grey, of its footprint and
 * height, resting on y = 0, good side +Z). Plain on purpose: it says "a
 * thing this big goes here", nothing about what it looks like.
 */
import type { Piece } from '../kit/types.ts';
import { part, piece } from '../kit/compose.ts';
import { bevelBox } from '../kit/cheap.ts';

export function clayBlock(name: string, w: number, h: number, d: number, shade = 0.45): Piece {
  const b = piece(`stand-in-${name}`, { ao: false });
  const c = Math.max(0.005, Math.min(w, h, d) * 0.1);
  // 40 triangles: clay is counted in the budget (twice, with the shadow pass) like everything else
  b.add(part('paper', bevelBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], c, omit: ['ny'] }), 'steel', { shade }));
  return b.build();
}
