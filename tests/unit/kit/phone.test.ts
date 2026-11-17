import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { phone, posePhone, catalogue, PHONE } from '../../../src/workshop/view/kit/pieces/phone/index.ts';
import { checkGeometry } from './helpers.ts';

const BUDGET = 2500;
const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

function find(n: PieceNode, name: string): PieceNode | undefined {
  if (n.name === name) return n;
  for (const c of n.children ?? []) {
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

describe('the phone', () => {
  const p = phone();

  it('builds deterministically, with sound geometry', () => {
    expect(phone({ seed: 4 }).triangles).toBe(phone({ seed: 4 }).triangles);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('stays inside its triangle budget', () => {
    if (process.env['PHONE_TRIS']) console.log(K.budget(p, BUDGET).text, 'size', JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(phone({ detail: 'low' }).triangles).toBeLessThanOrEqual(p.triangles);
  });

  it('is about 0.7 tall, rests on the bench, its screen looks up at the visitor', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    expect(b.max.y).toBeGreaterThan(0.6);
    expect(b.max.y).toBeLessThan(0.8);
    const s = p.sockets!['screen']!;
    const n = new Vector3(0, 0, 1).transformDirection(s);
    expect(n.z).toBeGreaterThan(0.9);
    expect(n.y).toBeGreaterThan(0.1);
  });

  it('has a phone node that rocks about its foot, and a lit screen', () => {
    const o = K.realize(p, stub);
    const n = o.getObjectByName('phone')!;
    const before = n.rotation.x;
    posePhone(o, { tilt: 5 });
    expect(n.rotation.x).toBeCloseTo(before - (5 * Math.PI) / 180, 6);
    posePhone(o, { tilt: 0 });
    expect(n.rotation.x).toBeCloseTo(before, 6);
    const ph = find(p.root, 'phone')!;
    expect(ph.parts.some((q) => q.material === 'bulb')).toBe(true);
    expect(new Matrix4().copy(ph.transform!).determinant()).toBeCloseTo(1, 6);
  });

  it('is registered with a labels hook', () => {
    expect(catalogue[0]!.name).toBe('phone');
    expect(typeof catalogue[0]!.labels).toBe('function');
    expect(PHONE.screen.w).toBeLessThan(PHONE.w);
  });
});
