import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { undoLever, poseUndoLever, catalogue, LEVER, NAMED_POSES, leverAngle, springMatrix, springLength, ringX, UNDO_WORD, TAPE_CAP } from '../../../src/workshop/view/kit/pieces/undo-lever/index.ts';
import { lugAt, springRestLength } from '../../../src/workshop/view/kit/pieces/undo-lever/pose.ts';
import handles from '../../../src/content/handles.json';
import { checkGeometry } from './helpers.ts';

const CAP = 3400; // raised from 2,500 for round 2 (the lead): a stout lever, a fat grip, a round spring

const stub: Materials = {
  of: (): Material => new MeshBasicMaterial(),
  textured: (): Material => new MeshBasicMaterial(),
  update() {},
  dispose() {},
};

function nodes(p: Piece): Map<string, PieceNode> {
  const out = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

function snapshot(o: Object3D): Map<string, number[]> {
  const m = new Map<string, number[]>();
  o.traverse((c) => m.set(c.uuid, [...c.position.toArray(), ...c.quaternion.toArray(), ...c.scale.toArray()]));
  return m;
}

describe('the UNDO lever', () => {
  const p = undoLever();

  it('builds deterministically, and another seed is another piece', () => {
    const a = undoLever({ seed: 3 }), b = undoLever({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const x = a.root.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(b.root.parts[0]!.geometry.getAttribute('position').array)).toEqual(Array.from(x));
    expect(Array.from(undoLever({ seed: 4 }).root.parts[0]!.geometry.getAttribute('position').array)).not.toEqual(Array.from(x));
  });

  it('fits its triangle cap in four meshes', () => {
    const b = K.budget(p, CAP);
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(b.meshes).toBeLessThanOrEqual(4);
    expect(new Set(Object.keys(b.byMaterial))).toEqual(new Set(['steel', 'brass', 'rubber', 'tape']));
    expect(undoLever({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
  });

  it('every geometry holds the kit invariants', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has its moving nodes and its sockets', () => {
    const n = nodes(p);
    for (const name of ['lever', 'latch', 'catch', 'spring', 'spring.end']) expect(n.has(name), name).toBe(true);
    for (let k = 0; k < LEVER.rings; k++) expect(n.has(`spring.ring${k}`), `ring ${k}`).toBe(true);
    // the latch and the catch ride on the lever
    expect(n.get('lever')!.children!.map((c) => c.name).sort()).toEqual(['catch', 'latch']);
    for (const s of ['base', 'pivot', 'grip', 'tape']) expect(p.sockets?.[s], s).toBeDefined();
  });

  it('is a tall lever on the bench: under 2 tall', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    expect(b.min.y).toBeLessThan(0.01);
    expect(b.max.y).toBeGreaterThan(1.7);
    expect(b.max.y).toBeLessThan(2.0);
    // the grip clears the quadrant by a hand's width
    expect(LEVER.length - 0.55).toBeGreaterThan(0.65 + 0.1);
  });

  it('travels at least 50 degrees, sideways across the visitor’s view', () => {
    expect(LEVER.travelDeg).toBeGreaterThanOrEqual(50);
    const home = leverAngle(0), pulled = leverAngle(1);
    expect((pulled - home) * 180 / Math.PI).toBeCloseTo(LEVER.travelDeg, 6);
    // home leans right, pulled leans left (the pivot turns about +Z, toward the visitor)
    expect(home).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(0);
  });

  it('spreads its spring\'s coils as it is pulled (never stretches them), and keeps it on its lug', () => {
    expect(springLength(leverAngle(0))).toBeCloseTo(springRestLength(), 9);
    for (const t of [0, 0.5, 1]) {
      const m = springMatrix(leverAngle(t));
      expect(new Vector3().setFromMatrixScale(m).x).toBeCloseTo(1, 9);
      const end = new Vector3(springLength(leverAngle(t)), 0, 0).applyMatrix4(m);
      expect(end.distanceTo(lugAt(leverAngle(t)))).toBeLessThan(1e-6);
    }
    const gap = (t: number): number => ringX(1, springLength(leverAngle(t))) - ringX(0, springLength(leverAngle(t)));
    expect(gap(1)).toBeGreaterThan(gap(0) * 1.25);
  });

  it('says UNDO from content, big enough to read', () => {
    expect(UNDO_WORD).toBe(handles.undo.lever.text);
    expect(handles.undo.lever.source.length).toBeGreaterThan(0);
    // a face leaned back toward the camera, at the bench's ~56 px a unit: 12 px or more
    expect(TAPE_CAP * 56).toBeGreaterThanOrEqual(12);
  });

  it('poseUndoLever moves only its nodes, the right way, and comes back', () => {
    const o = K.realize(p, stub);
    o.updateMatrixWorld(true);
    const before = snapshot(o);
    const grip = new Vector3().setFromMatrixPosition(p.sockets!['grip']!);
    const lever = o.getObjectByName('lever')!;
    const local = lever.worldToLocal(grip.clone());
    poseUndoLever(o, { ...NAMED_POSES['pulled'] });
    o.updateMatrixWorld(true);
    const moved = new Set(['lever', 'latch', 'catch', 'spring', 'spring.end', ...Array.from({ length: LEVER.rings }, (_, k) => `spring.ring${k}`)]);
    const after = snapshot(o);
    o.traverse((c) => {
      const changed = before.get(c.uuid)!.some((v, i) => Math.abs(v - after.get(c.uuid)![i]!) > 1e-9);
      if (!moved.has(c.name)) expect(changed, c.name).toBe(false);
    });
    // the grip swung from the right of the pivot to the left
    const now = lever.localToWorld(local.clone());
    expect(grip.x).toBeGreaterThan(0.2);
    expect(now.x).toBeLessThan(-0.3);
    poseUndoLever(o, {});
    const back = snapshot(o);
    o.traverse((c) => before.get(c.uuid)!.forEach((v, i) => expect(back.get(c.uuid)![i]!).toBeCloseTo(v, 6)));
  });

  it('builds in every named pose, and the catalogue knows them', () => {
    for (const name of Object.keys(NAMED_POSES)) expect(undoLever({ pose: name }).triangles).toBe(p.triangles);
    expect(() => undoLever({ pose: 'nope' })).toThrow();
    const e = catalogue[0]!;
    expect(e.name).toBe('undo-lever');
    expect(e.poses).toEqual(Object.keys(NAMED_POSES));
    expect(typeof e.labels).toBe('function');
  });
});
