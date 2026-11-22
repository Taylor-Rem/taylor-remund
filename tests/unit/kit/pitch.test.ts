import { describe, expect, it } from 'vitest';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue, pitch, pitchBanner, pitchMast, pivotsOf, EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, poseMatrices } from '../../../src/workshop/view/kit/pieces/pitch/index.ts';
import { budget } from '../../../src/workshop/view/kit/compose.ts';
import { checkGeometry } from './helpers.ts';

const NODES = ['root', 'float', 'eye', 'lid', 'tie', 'tieTip', 'prop', 'rudder', 'car', 'winch', 'cable', 'hook', 'sling'];

function names(n: PieceNode, out: string[] = []): string[] {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
}
function hashPiece(n: PieceNode): number {
  let h = 0;
  for (const q of n.parts) {
    const a = q.geometry.getAttribute('position').array;
    for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i]! * 1e5)) | 0;
  }
  for (const c of n.children ?? []) h = (h * 17 + hashPiece(c)) | 0;
  return h;
}
function walk(n: PieceNode, f: (n: PieceNode) => void): void {
  f(n);
  for (const c of n.children ?? []) walk(c, f);
}

describe('pitch (look sketch, C1)', () => {
  for (const take of ['A', 'B'] as const) {
    describe(`take ${take}`, () => {
      const p = pitch({ take, seed: 3 });
      it('is deterministic for a seed', () => {
        expect(hashPiece(pitch({ take, seed: 3 }).root)).toBe(hashPiece(p.root));
      });
      it('has every rig node once', () => {
        const all = names(p.root);
        for (const n of [...NODES, 'hat']) expect(all.filter((x) => x === n)).toHaveLength(1);
      });
      it('fits the brief: at most 6,000 triangles and 6 draw calls with its shadow proxy', () => {
        const b = budget(p);
        expect(p.triangles).toBeLessThanOrEqual(6000);
        expect(b.calls).toBeLessThanOrEqual(6);
        expect(pitch({ take, detail: 'low' }).triangles).toBeLessThan(p.triangles);
      });
      it('holds the kit invariants', () => {
        walk(p.root, (n) => n.parts.forEach((q) => checkGeometry(q.geometry)));
      });
    });
  }

  it('poses every expression with finite, invertible node transforms', () => {
    for (const take of ['A', 'B'] as const) {
      const pv = pivotsOf(take);
      for (const e of EXPRESSION_NAMES) {
        const ms = poseMatrices(EXPRESSIONS[e], pv);
        for (const m of Object.values(ms)) {
          expect(m.elements.every(Number.isFinite)).toBe(true);
          expect(Math.abs(m.determinant())).toBeGreaterThan(1e-12);
        }
      }
      expect(poseMatrices(NEUTRAL, pv)['float']!.elements[13]).toBeCloseTo(NEUTRAL.float, 6);
    }
  });

  it('builds its banner and its mast inside the kit', () => {
    for (const q of [pitchBanner(), pitchMast()]) walk(q.root, (n) => n.parts.forEach((x) => checkGeometry(x.geometry)));
    expect(pitchMast().triangles).toBeLessThan(2500);
    expect(pitchBanner().triangles).toBeLessThan(1000);
  });

  it('registers three catalogue entries', () => {
    expect(catalogue.map((e) => e.name)).toEqual(['pitch', 'pitch-banner', 'pitch-mast']);
  });

  it('reports its budget', () => {
    for (const take of ['A', 'B'] as const) console.log(budget(pitch({ take })).text);
    console.log(budget(pitchBanner()).text);
    console.log(budget(pitchMast()).text);
  });
});
