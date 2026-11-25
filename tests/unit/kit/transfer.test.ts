// (E1) A piece across a worker's boundary (kit/transfer.ts): Pitch's pieces are built in a worker and handed back as
// plain data, their buffers transferred. The piece that arrives is the piece that was built.
import { describe, expect, test } from 'vitest';
import type { BufferAttribute } from 'three';
import { pitch, pitchMast } from '../../../src/workshop/view/kit/pieces/pitch/index.ts';
import { packPiece, unpackPiece } from '../../../src/workshop/view/kit/transfer.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';

/** Every node's name, transform, and every part's material, texture and geometry, as plain numbers. */
function describePiece(p: Piece): unknown {
  const node = (n: PieceNode): unknown => ({
    name: n.name,
    t: n.transform ? [...n.transform.elements] : null,
    parts: n.parts.map((q) => ({
      material: q.material,
      variant: q.variant ?? null,
      texture: q.texture ?? null,
      castShadow: q.castShadow ?? null,
      shadow: q.shadow ?? null,
      attrs: Object.fromEntries(Object.entries(q.geometry.attributes).map(([k, a]) => [k, { n: (a as BufferAttribute).array.length, size: (a as BufferAttribute).itemSize, sum: Array.from((a as BufferAttribute).array as ArrayLike<number>).reduce((s, x) => s + x, 0) }])),
      index: q.geometry.index ? Array.from(q.geometry.index.array as ArrayLike<number>).reduce((s, x) => s + x, 0) : null,
      userData: q.geometry.userData,
    })),
    children: (n.children ?? []).map(node),
  });
  return { name: p.name, root: node(p.root), size: p.size, triangles: p.triangles, sockets: Object.fromEntries(Object.entries(p.sockets ?? {}).map(([k, m]) => [k, [...m.elements]])) };
}

describe('a piece across a worker boundary', () => {
  test.each([
    ['pitch', () => pitch({ take: 'C', cloth: 'charcoal', hook: 'cane', moustache: 'handlebar', seed: 3, detail: 'high' })],
    ['pitch, low', () => pitch({ take: 'C', cloth: 'charcoal', hook: 'cane', moustache: 'handlebar', seed: 3, detail: 'low' })],
    ['the mast', () => pitchMast({ height: 1.4, seed: 9 })],
  ])('%s arrives as it was built', (_, make) => {
    const want = describePiece(make());
    const { packed, transfer } = packPiece(make());
    expect(transfer.length).toBeGreaterThan(0);
    // as postMessage would carry it: a structured clone, the buffers moved
    const moved = structuredClone(packed, { transfer });
    expect(describePiece(unpackPiece(moved))).toEqual(want);
  });
});
