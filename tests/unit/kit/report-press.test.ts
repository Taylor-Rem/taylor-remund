// P4 D3: the report press's piece and its envelope within their budgets (out of its crate: 3,000 triangles and three
// draws for the press, one material class a draw: wood, brass, paper; 60 triangles and one draw for the envelope),
// with every node the view poses, and the footprint the simulation's bodies have.
import { describe, expect, test } from 'vitest';
import { reportEnvelope, reportPress } from '../../../src/workshop/view/kit/pieces/report-press/index.ts';
import { PRESS } from '../../../src/workshop/sim/scenes/bench.ts';
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

describe('the report press piece', () => {
  test('under 3,000 triangles; three material classes; every moving node there; the body\'s footprint', () => {
    for (const paper of [undefined, 'region|report-press|paper']) {
      const p = reportPress({ seed: 3, ...(paper ? { paper } : {}) });
      process.stderr.write(`\nreport press: ${p.triangles} triangles, classes ${[...classes(p.root)].join(', ')}, size ${JSON.stringify(p.size)}\n`);
      expect(p.triangles).toBeLessThanOrEqual(3000);
      expect([...classes(p.root)].sort()).toEqual(['brass', 'paper', 'wood']);
      const n = names(p.root);
      for (const k of ['lever', 'printed', 'gridded', 'blank', 'drawer', 'stack', 'arm', 'env', 'flap-0', 'flap-1', 'flap-2']) expect(n, k).toContain(k);
      expect(p.size.x).toBeCloseTo(PRESS.half[0] * 2, 1);
      expect(p.size.z).toBeLessThanOrEqual(PRESS.half[2] * 2 + 0.12);
    }
  });

  test('the envelope: one class, under 60 triangles, the body\'s size', () => {
    const e = reportEnvelope({ seed: 3, paper: 'region|report-press|paper' });
    process.stderr.write(`\nenvelope: ${e.triangles} triangles, size ${JSON.stringify(e.size)}\n`);
    expect(e.triangles).toBeLessThanOrEqual(60);
    expect([...classes(e.root)]).toEqual(['paper']);
    expect(e.size.x).toBeCloseTo(PRESS.envelopeHalf[0] * 2, 2);
    expect(e.size.z).toBeCloseTo(PRESS.envelopeHalf[2] * 2, 2);
  });
});
