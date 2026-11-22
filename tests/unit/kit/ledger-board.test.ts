// P4 D1: the ledger board's piece within its budget (2,500 triangles out of its crate; its draws are one per
// material class: wood, brass, rubber and the star's bulb), with every node its view poses.
import { describe, expect, test } from 'vitest';
import { ledgerBoard } from '../../../src/workshop/view/kit/pieces/ledger-board/index.ts';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';

const classes = (n: PieceNode, out = new Set<string>()): Set<string> => {
  for (const p of n.parts) out.add(p.material);
  for (const c of n.children ?? []) classes(c, out);
  return out;
};
const names = (n: PieceNode, out: string[] = []): string[] => {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
};

describe('the ledger board piece', () => {
  test('under 2,500 triangles; four material classes; every moving node there', () => {
    const p = ledgerBoard({ seed: 3 });
    process.stderr.write(`\nledger board: ${p.triangles} triangles, classes ${[...classes(p.root)].join(', ')}, size ${JSON.stringify(p.size)}\n`);
    expect(p.triangles).toBeLessThanOrEqual(2500);
    expect([...classes(p.root)].sort()).toEqual(['brass', 'bulb', 'rubber', 'wood']);
    const n = names(p.root);
    for (const k of ['crank', 'plunger', 'gate', 'star-lit', 'star-dark', 'rubber', 'rubber-core-0', 'rubber-core-1', 'rubber-core-2', ...Array.from({ length: 8 }, (_, i) => `token-${i}`)]) expect(n, k).toContain(k);
    // its footprint is the body's (sim LEDGER.half: 0.56 × 0.38)
    expect(p.size.x).toBeCloseTo(0.56, 1);
    expect(p.size.z).toBeCloseTo(0.38, 1);
  });
});
