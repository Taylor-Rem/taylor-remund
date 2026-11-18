import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import {
  striker, poseStriker, catalogue, STRIKER, PART_HEIGHT, REST, COCKED, DROPPED, NAMED_POSES,
  camRadius, armOnCam, strikeDeg, stopDeg, feltY, rodTop, springMatrix, springSeat,
} from '../../../src/workshop/view/kit/pieces/striker/index.ts';
import { checkGeometry } from './helpers.ts';

const CAP = 5000;

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

describe('the striker', () => {
  const p = striker();

  it('builds deterministically, and another seed is another piece', () => {
    const a = striker({ seed: 3 }), b = striker({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const x = a.root.children![0]!.parts[0]!.geometry.getAttribute('position').array;
    const y = b.root.children![0]!.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(x)).toEqual(Array.from(y));
    const c = striker({ seed: 4 }).root.children![0]!.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(c)).not.toEqual(Array.from(x));
  });

  it('fits its triangle cap in four meshes', () => {
    const b = K.budget(p, CAP);
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(b.meshes).toBeLessThanOrEqual(4);
    expect(new Set(Object.keys(b.byMaterial))).toEqual(new Set(['steel', 'brass', 'rubber', 'bulb']));
    expect(striker({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
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
    for (const name of ['arm', 'cam', 'follower', 'spring', 'lamp', 'lamp.lit', 'lamp.unlit']) expect(n.has(name), name).toBe(true);
    for (const s of ['base', 'rail', 'hammer', 'grip', 'lamp']) expect(p.sockets?.[s], s).toBeDefined();
    // the card holder is an option, off by default
    expect(p.sockets?.['card']).toBeUndefined();
    const withCard = striker({ cardHolder: true });
    expect(withCard.sockets?.['card']).toBeDefined();
    expect(withCard.triangles).toBeGreaterThan(p.triangles);
    expect(withCard.triangles).toBeLessThanOrEqual(CAP);
    // the lamp's lit body is the only bulb, built hidden
    expect(n.get('lamp.lit')!.parts.every((q) => q.material === 'bulb')).toBe(true);
    expect(n.get('lamp.unlit')!.parts.every((q) => q.material !== 'bulb')).toBe(true);
  });

  it('stands on the bench, behind the far rail, its hammer over the belt centre', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    expect(b.min.y).toBeLessThan(0.01);
    // nothing low reaches the belt: below the rail top the piece stays behind the rail's back face
    const hammer = new Vector3().setFromMatrixPosition(p.sockets!['hammer']!);
    expect(hammer.z).toBeCloseTo(0.92, 1);
    expect(hammer.y).toBeCloseTo(STRIKER.restFelt, 2);
    expect(new Vector3().setFromMatrixPosition(p.sockets!['rail']!).z).toBeCloseTo(0.3, 6);
  });

  it('lets an L crate pass under the felt at rest and reaches an S crate', () => {
    expect(feltY(REST.deg)).toBeGreaterThan(STRIKER.beltTop + PART_HEIGHT.L + 0.08);
    expect(feltY(COCKED.deg)).toBeGreaterThan(feltY(REST.deg) + 0.1);
    for (const s of ['S', 'M', 'L'] as const) expect(feltY(strikeDeg(PART_HEIGHT[s]))).toBeCloseTo(STRIKER.beltTop + PART_HEIGHT[s], 4);
    expect(stopDeg()).toBeLessThan(strikeDeg(PART_HEIGHT.S));
    // the cam's base circle holds the arm at the stop; its spiral climbs; its step drops
    expect(armOnCam(DROPPED)).toBeCloseTo(stopDeg(), 3);
    let last = camRadius(0);
    for (let u = 0.01; u < STRIKER.rise; u += 0.01) {
      expect(camRadius(u)).toBeGreaterThan(last);
      last = camRadius(u);
    }
    expect(camRadius(STRIKER.rise + STRIKER.step + 0.001)).toBeCloseTo(STRIKER.baseR, 6);
    expect(rodTop(COCKED.turns)).toBeGreaterThan(rodTop(REST.turns));
  });

  it('keeps its spring on its seat at every angle', () => {
    const rest = springSeat(REST.deg).distanceTo(new Vector3(...STRIKER.boss));
    for (const deg of [stopDeg(), REST.deg, COCKED.deg]) {
      const end = new Vector3(rest, 0, 0).applyMatrix4(springMatrix(deg, rest));
      expect(end.distanceTo(springSeat(deg))).toBeLessThan(1e-6);
    }
    // it loads (shortens) as the arm is cocked
    const scale = (deg: number): number => new Vector3().setFromMatrixScale(springMatrix(deg, rest)).x;
    expect(scale(COCKED.deg)).toBeLessThan(0.95);
    expect(scale(stopDeg())).toBeGreaterThan(1.1);
  });

  it('poseStriker moves only its nodes, the right way, and comes back', () => {
    const o = K.realize(p, stub);
    o.updateMatrixWorld(true);
    const before = snapshot(o);
    const grip = new Vector3().setFromMatrixPosition(p.sockets!['grip']!);
    const arm = o.getObjectByName('arm')!;
    const local = arm.worldToLocal(grip.clone());
    poseStriker(o, { ...NAMED_POSES['struck-S'] });
    o.updateMatrixWorld(true);
    const moved = new Set(['arm', 'cam', 'follower', 'spring', 'lamp.lit', 'lamp.unlit']);
    const after = snapshot(o);
    o.traverse((c) => {
      const changed = before.get(c.uuid)!.some((v, i) => Math.abs(v - after.get(c.uuid)![i]!) > 1e-9);
      if (!moved.has(c.name)) expect(changed, c.name).toBe(false);
    });
    // the hammer came down
    const now = arm.localToWorld(local.clone());
    expect(now.y).toBeLessThan(grip.y - 0.3);
    poseStriker(o, {});
    const back = snapshot(o);
    o.traverse((c) => before.get(c.uuid)!.forEach((v, i) => expect(back.get(c.uuid)![i]!).toBeCloseTo(v, 6)));
  });

  it('builds in every named pose, and the catalogue knows them', () => {
    for (const name of Object.keys(NAMED_POSES)) expect(striker({ pose: name }).triangles).toBe(p.triangles);
    expect(() => striker({ pose: 'nope' })).toThrow();
    const e = catalogue[0]!;
    expect(e.name).toBe('striker');
    expect(e.poses).toEqual(Object.keys(NAMED_POSES));
  });
});
