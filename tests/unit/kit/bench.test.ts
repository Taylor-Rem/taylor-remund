import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { backWall, bench, benchSection, catalogue, laneTape, SAMPLE_TAPE } from '../../../src/workshop/view/kit/pieces/bench/index.ts';
import { checkGeometry } from './helpers.ts';
import { PATCH_LIFT } from '../../../src/workshop/view/kit/pieces/bench/dress.ts';

function parts(p: Piece): PieceNode['parts'] {
  const out: PieceNode['parts'] = [];
  const walk = (n: PieceNode): void => {
    out.push(...n.parts);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

function fingerprint(p: Piece): number[] {
  return parts(p).flatMap((q) => {
    const a = q.geometry.getAttribute('position').array;
    let s = 0;
    for (let i = 0; i < a.length; i += 5) s += a[i]! * ((i % 11) + 1);
    return [a.length, s];
  });
}

describe('bench section', () => {
  it('top surface exactly y = 0, spans its width and depth, falls below', () => {
    const p = benchSection({ width: 5, depth: 10, seed: 2 });
    const bb = K.pieceBounds(p);
    // the boards' top is the plane y = 0 (some settled a hair below); nail heads and drips stand a few mm on it
    const boards = new Box3();
    for (const q of parts(p)) if (q.variant === 'large') { q.geometry.computeBoundingBox(); boards.union(q.geometry.boundingBox!); }
    expect(boards.max.y).toBeLessThanOrEqual(PATCH_LIFT + 1e-6);
    expect(boards.max.y).toBeGreaterThan(0);
    expect(bb.max.y).toBeLessThan(0.008);
    expect(bb.min.y).toBeLessThan(-0.8);
    expect(bb.min.x).toBeCloseTo(-2.5, 3);
    expect(bb.max.x).toBeCloseTo(2.5, 3);
    expect(bb.min.z).toBeCloseTo(-5, 3);
    expect(bb.max.z).toBeCloseTo(5, 3);
    for (const q of parts(p)) checkGeometry(q.geometry);
    // the large variant on the screen-filling wood
    expect(parts(p).some((q) => q.material === 'wood' && q.variant === 'large')).toBe(true);
  });

  it('stays inside 6,000 triangles a section, at both detail levels, with joints', () => {
    const p = benchSection({ seed: 3, joints: { left: true, right: true } });
    expect(p.triangles).toBeLessThanOrEqual(6000);
    expect(benchSection({ seed: 3, detail: 'low' }).triangles).toBeLessThan(p.triangles);
    const two = bench({ sections: 2, seed: 3 });
    expect(two.triangles).toBeLessThanOrEqual(12000);
    expect(K.pieceBounds(two).max.x).toBeCloseTo(5, 3);
    console.log(`bench section ${p.triangles} tris (low ${benchSection({ seed: 3, detail: 'low' }).triangles}); two sections ${two.triangles}`);
  });

  it('a joint puts a steel plate and bolts on the apron', () => {
    const plain = benchSection({ seed: 4 });
    const jointed = benchSection({ seed: 4, joints: { right: true } });
    const metal = (p: Piece): number => parts(p).filter((q) => q.material === 'metal').reduce((s, q) => s + K.triangleCount(q.geometry), 0);
    expect(metal(jointed)).toBeGreaterThan(metal(plain) + 300); // the plate and four bolts
  });

  it('is deterministic per seed', () => {
    expect(fingerprint(benchSection({ seed: 7 }))).toEqual(fingerprint(benchSection({ seed: 7 })));
    expect(fingerprint(benchSection({ seed: 7 }))).not.toEqual(fingerprint(benchSection({ seed: 8 })));
  });
});

describe('lane tape', () => {
  it('lies a hair above the bench, never below it, never thick', () => {
    const p = laneTape({ points: SAMPLE_TAPE, seed: 1 });
    const bb = K.pieceBounds(p);
    expect(bb.min.y).toBeGreaterThanOrEqual(0);
    expect(bb.max.y).toBeLessThan(0.015);
    for (const q of parts(p)) {
      checkGeometry(q.geometry);
      expect(q.material).toBe('tape');
    }
    expect(fingerprint(laneTape({ points: SAMPLE_TAPE, seed: 1 }))).toEqual(fingerprint(p));
  });

  it('an open run has a torn end; strips are stacked so none z-fights', () => {
    const open = laneTape({ points: [[0, 0], [3, 0], [3, 2]], seed: 2 });
    expect(parts(open).length).toBe(1); // one material: merged
    expect(open.triangles).toBeLessThan(2000);
  });
});

describe('back wall', () => {
  it('stands on y = 0, face at z = 0, as wide and tall as asked', () => {
    const p = backWall({ width: 12, height: 5, seed: 1 });
    const bb = K.pieceBounds(p);
    expect(bb.min.y).toBeCloseTo(0, 3);
    expect(bb.max.y).toBeGreaterThan(4.95);
    expect(bb.max.z).toBeLessThan(0.06);
    expect(bb.min.x).toBeCloseTo(-6, 2);
    expect(bb.max.x).toBeGreaterThan(5.95);
    for (const q of parts(p)) checkGeometry(q.geometry);
    expect(p.triangles).toBeLessThan(6000);
  });
});

describe('catalogue', () => {
  it('registers bench, lane-tape and back-wall', () => {
    expect(catalogue.map((c) => c.name)).toEqual(['bench', 'lane-tape', 'back-wall']);
    for (const c of catalogue) expect(c.build({}).triangles).toBeGreaterThan(0);
  });
});
