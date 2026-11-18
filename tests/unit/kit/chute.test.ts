import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { CHUTE, catalogue, chute, ductPath } from '../../../src/workshop/view/kit/pieces/chute/index.ts';
import { checkGeometry } from './helpers.ts';

const CAP = 2500; // ART-P2 § 4


const at = (m: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(m);

describe('the return chute', () => {
  const p = chute();

  it('stays inside its triangle cap, in three meshes', () => {
    const b = K.budget(p, CAP);
    if (process.env['CHUTE_TRIS']) console.warn(b.text, JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(chute({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
    expect(b.meshes).toBeLessThanOrEqual(3);
    expect(b.calls).toBeLessThanOrEqual(6);
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

  it('rises from the dark outside the apron, never through the bench', () => {
    const d = ductPath();
    const half = CHUTE.core + CHUTE.wall;
    expect(d.points[0]!.y).toBeLessThan(-2.5);
    for (const q of d.points) {
      // below the bench top the duct stays clear of the bench's front (the apron's face is at z = -0.05)
      if (q.y < 0.05) expect(q.z - half).toBeGreaterThan(0);
    }
    // where it passes over the edge, its underside clears the bench top
    const over = d.points.filter((q) => q.z < 0);
    for (const q of over) expect(q.y - half).toBeGreaterThan(0.3);
  });

  it('the mouth is 1.2-1.4 up, over the bench, looking along it (+X) and tipped up toward the camera', () => {
    const m = p.sockets!['mouth']!;
    const o = at(m);
    const out = new Vector3(0, 0, 1).transformDirection(m);
    expect(o.y).toBeGreaterThan(1.2);
    expect(o.y).toBeLessThan(1.45);
    expect(o.z).toBeLessThan(-0.6);
    expect(out.x).toBeGreaterThan(0.8);
    expect(out.y).toBeGreaterThan(0.3);
    // the camera (in front, about 33° up) sees into it
    const toCamera = new Vector3(0.29, 0.52, 0.8).normalize();
    expect(out.dot(toCamera)).toBeGreaterThan(0.4);
    const land = at(p.sockets!['land']!);
    expect(land.y).toBe(0);
    expect(land.z).toBeLessThan(-0.5);
    for (const k of ['apron', 'edge', 'bottom']) expect(p.sockets![k], k).toBeDefined();
  });

  it('nothing hangs in the mouth: the throat stays open', () => {
    expect(p.root.children ?? []).toHaveLength(0);
  });

  it('run and aim: inside the cap at the longest run, and the sockets follow', () => {
    for (const o of [{ run: CHUTE.runMax }, { run: CHUTE.runMax, aim: CHUTE.aimMax }, { aim: CHUTE.aimMax }]) {
      const q = chute(o);
      const b = K.budget(q, CAP);
      if (process.env['CHUTE_TRIS']) console.warn(JSON.stringify(o), b.text.split('\n')[0]);
      expect(q.triangles).toBeLessThanOrEqual(CAP);
      expect(b.meshes).toBeLessThanOrEqual(2);
      const walk = (n: PieceNode): void => {
        for (const part of n.parts) checkGeometry(part.geometry);
        for (const c of n.children ?? []) walk(c);
      };
      walk(q.root);
    }
    const near = at(chute().sockets!['mouth']!), far = at(chute({ run: 3 }).sockets!['mouth']!);
    expect(near.z - far.z).toBeCloseTo(3 - CHUTE.run, 1);
    // aim swings the mouth and where a part lands toward -Z
    const m40 = chute({ aim: 40 }).sockets!;
    const out40 = new Vector3(0, 0, 1).transformDirection(m40['mouth']!);
    expect(Math.atan2(-out40.z, out40.x) * (180 / Math.PI)).toBeCloseTo(40, 0);
    const land0 = at(p.sockets!['land']!), land40 = at(m40['land']!);
    expect(land40.z).toBeLessThan(land0.z - 0.3);
    // out of range is clamped
    expect(chute({ run: 9 }).triangles).toBe(chute({ run: CHUTE.runMax }).triangles);
  });

  it('the throat faces the camera at aim 0, and turns edge-on to it by about 40', () => {
    const toCamera = new Vector3(0.29, 0.52, 0.8).normalize();
    const facing = (aim: number): number => new Vector3(0, 0, 1).transformDirection(chute({ aim }).sockets!['mouth']!).dot(toCamera);
    if (process.env['CHUTE_TRIS']) console.warn([0, 10, 20, 30, 40].map((a) => `${a}: ${facing(a).toFixed(2)}`).join('  '));
    expect(facing(0)).toBeGreaterThan(0.45);
    expect(facing(40)).toBeLessThan(0.05);
  });

  it('is in the catalogue', () => {
    expect(catalogue.map((e) => e.name)).toEqual(['chute']);
  });
});
