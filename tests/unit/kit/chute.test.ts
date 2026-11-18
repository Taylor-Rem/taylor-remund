import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { CHUTE, NAMED_POSES, catalogue, chute, poseChute } from '../../../src/workshop/view/kit/pieces/chute/index.ts';
import { checkGeometry } from './helpers.ts';

const CAP = 2500; // ART-P2 § 4

function find(n: PieceNode, name: string): PieceNode | undefined {
  if (n.name === name) return n;
  for (const c of n.children ?? []) {
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

describe('the return chute', () => {
  const p = chute();

  it('stays inside its triangle cap', () => {
    const b = K.budget(p, CAP);
    if (process.env['CHUTE_TRIS']) console.warn(b.text, JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(chute({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
    expect(b.meshes).toBeLessThanOrEqual(5);
  });

  it('builds deterministically', () => {
    const arr = (q: Piece) => Array.from(q.root.parts[0]!.geometry.getAttribute('position').array);
    expect(arr(chute({ seed: 5 }))).toEqual(arr(chute({ seed: 5 })));
  });

  it('every part is a sound kit geometry', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('the mouth is above the bench, looking out toward +X and the visitor, a little down', () => {
    const m = p.sockets!['mouth']!;
    const at = new Vector3().setFromMatrixPosition(m);
    const out = new Vector3(0, 0, 1).transformDirection(m);
    expect(at.y).toBeGreaterThan(0.4);
    expect(at.y).toBeLessThan(0.9);
    expect(out.x).toBeGreaterThan(0.5);
    expect(out.z).toBeGreaterThan(0.3);
    expect(out.y).toBeLessThan(0);
    // where the part lands is in front of the mouth, on the bench
    const land = new Vector3().setFromMatrixPosition(p.sockets!['land']!);
    expect(land.y).toBe(0);
    expect(land.clone().sub(at).dot(out)).toBeGreaterThan(0.2);
    expect(CHUTE.yaw).toBeGreaterThan(0);
  });

  it('the flap is a node; kicked swings its foot out of the mouth', () => {
    const q = chute();
    const flap = find(q.root, 'flap')!;
    expect(flap).toBeDefined();
    const foot = (n: PieceNode): Vector3 => new Vector3(0, -0.4, 0).applyMatrix4(n.transform ?? new Matrix4());
    const mouth = q.sockets!['mouth']!;
    const out = new Vector3(0, 0, 1).transformDirection(mouth);
    const at = new Vector3().setFromMatrixPosition(mouth);
    const shut = foot(flap).sub(at).dot(out);
    poseChute(q.root, NAMED_POSES['kicked']!);
    const kicked = foot(flap).sub(at).dot(out);
    expect(kicked).toBeGreaterThan(shut + 0.2);
    for (const name of Object.keys(NAMED_POSES)) expect(chute({ pose: name }).triangles).toBe(p.triangles);
  });

  it('is in the catalogue', () => {
    expect(catalogue.map((e) => e.name)).toEqual(['chute']);
  });
});
