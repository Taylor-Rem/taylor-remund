import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { belt, beltRollers, BELT, BELT_MOVING, catalogue, dialAngle, DEFLECT, HIDDEN, leverAngle, loopAt, loopGeom, MARKS, NAMED_POSES, parsePose, poseBelt, seamMatrix, topRunS } from '../../../src/workshop/view/kit/pieces/belt/index.ts';
import { checkGeometry } from './helpers.ts';

const BUDGET = 8000; // the lead's cap (brief V-belt-r): the line's belt at length 10, every option on
const MESHES = 5; // material classes, so meshes per pass

function nodes(p: Piece): Map<string, PieceNode> {
  const out = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

describe('the belt', () => {
  const p = belt();

  it('stays inside its triangle budget', () => {
    if (process.env['BELT_TRIS']) console.warn(K.budget(p, BUDGET).text, JSON.stringify(p.size), 'low', belt({ detail: 'low' }).triangles, 'L10', belt({ length: 10 }).triangles);
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(belt({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
  });

  it('builds deterministically, and another seed differs', () => {
    const a = belt({ seed: 3 }), b = belt({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const x = a.root.parts[0]!.geometry.getAttribute('position').array, y = b.root.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(x)).toEqual(Array.from(y));
    const steelA = a.root.parts.find((q) => q.material === 'steel')!.geometry.getAttribute('position').array;
    const steelB = belt({ seed: 4 }).root.parts.find((q) => q.material === 'steel')!.geometry.getAttribute('position').array;
    expect(Array.from(steelA)).not.toEqual(Array.from(steelB));
  });

  it('every part is a sound kit geometry', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('merges hard: few meshes on the static body, one per roller', () => {
    expect(p.root.parts.length).toBeLessThanOrEqual(6);
    const n = nodes(p);
    for (const r of beltRollers()) {
      const node = n.get(r.name)!;
      expect(node, r.name).toBeDefined();
      expect(node.parts.length).toBe(1);
      expect(node.parts[0]!.material).toBe('brass');
    }
    expect(n.get('seam')!.parts.length).toBe(1);
  });

  it('the carrying surface is at BELT.topY, and the belt is the belt class', () => {
    const bp = p.root.parts.find((q) => q.material === 'belt')!;
    bp.geometry.computeBoundingBox();
    expect(bp.geometry.boundingBox!.max.y).toBeCloseTo(BELT.topY, 3);
    expect(bp.geometry.boundingBox!.max.x).toBeCloseTo(BELT.defaultLength / 2, 2);
    expect(bp.geometry.getAttribute('uv')).toBeDefined();
    expect(BELT.topY).toBeCloseTo(0.5, 5);
  });

  it('rests on the bench and runs along X; the motor is at the left', () => {
    const box = K.pieceBounds(p);
    expect(box.min.y).toBeGreaterThan(-0.002);
    expect(box.min.y).toBeLessThan(0.01);
    expect(box.max.x - box.min.x).toBeGreaterThan(BELT.defaultLength);
    expect(-box.min.x).toBeGreaterThan(box.max.x + 0.5);
    expect(box.max.z - box.min.z).toBeLessThan(1.7);
  });

  it('length is a parameter', () => {
    const q = belt({ length: 10 });
    const bp = q.root.parts.find((x) => x.material === 'belt')!;
    bp.geometry.computeBoundingBox();
    expect(bp.geometry.boundingBox!.max.x).toBeCloseTo(5, 2);
    expect(beltRollers(12).length).toBeGreaterThan(beltRollers(6).length);
  });

  it('has the sockets the view and the controls need', () => {
    for (const s of ['dial', 'lever', 'lamp', 'surface', 'in', 'out']) expect(p.sockets?.[s], s).toBeDefined();
    // the panel faces the visitor and up
    const n = new Vector3(0, 0, 1).transformDirection(p.sockets!['dial']!);
    expect(n.z).toBeGreaterThan(0.4);
    expect(n.y).toBeGreaterThan(0.4);
    const lamp = nodes(p);
    expect(lamp.get('lamp.lit')!.parts[0]!.material).toBe('bulb');
    expect(lamp.get('lamp.unlit')!.parts[0]!.material).toBe('bulb');
  });
});

function classes(p: Piece): Set<string> {
  const out = new Set<string>();
  const walk = (n: PieceNode): void => {
    for (const q of n.parts) out.add(q.material);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

describe('the line\'s belt (option line)', () => {
  const p = belt({ length: 10, line: true });
  const n = nodes(p);

  it('stays inside the cap at length 10, in five meshes; the G1 belt too', () => {
    if (process.env['BELT_TRIS']) console.warn(K.budget(p, BUDGET).text);
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(classes(p).size).toBeLessThanOrEqual(MESHES);
    const g1 = belt();
    expect(g1.triangles).toBeLessThanOrEqual(BUDGET);
    expect(classes(g1).size).toBeLessThanOrEqual(MESHES);
  });

  it('every part is a sound kit geometry', () => {
    const walk = (q: PieceNode): void => {
      for (const x of q.parts) checkGeometry(x.geometry);
      for (const c of q.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has the dial, the lever, the lamp twins, the stripes, and the view keeps them moving', () => {
    for (const name of ['dial', 'lever', 'lamp', 'lamp.lit', 'lamp.unlit', 'seam', 'roller0']) expect(n.get(name), name).toBeDefined();
    for (let k = 1; k <= MARKS; k++) expect(n.get(`mark${k}`)).toBeDefined();
    for (const name of ['dial', 'lever', 'lamp', 'seam', 'mark1', 'roller3']) expect(BELT_MOVING.test(name), name).toBe(true);
    expect(BELT_MOVING.test('root')).toBe(false);
    // the G1 belt has none of the new nodes
    const g1 = nodes(belt());
    for (const name of ['dial', 'lever', 'mark1']) expect(g1.get(name), name).toBeUndefined();
  });

  it('has grips, the way off the back, and the ramp socket', () => {
    for (const s of ['dial.grip', 'lever.grip', 'off.back', 'deflector', 'ramp', 'dial', 'lever', 'lamp']) expect(p.sockets?.[s], s).toBeDefined();
    const off = new Vector3().setFromMatrixPosition(p.sockets!['off.back']!);
    expect(off.z).toBeLessThan(-BELT.railIn - 0.4); // behind the belt, on the bench
    expect(off.y).toBeCloseTo(0, 5);
    expect(off.x).toBeCloseTo(-5 + DEFLECT.rest[0], 5);
    const ramp = new Vector3().setFromMatrixPosition(p.sockets!['ramp']!);
    expect(ramp.x).toBeCloseTo(5, 5);
    expect(ramp.y).toBeCloseTo(BELT.topY, 5);
    // the control face looks at the camera's pitch (its normal 25-45° above the horizontal)
    const nrm = new Vector3(0, 0, 1).transformDirection(p.sockets!['dial']!);
    const elev = (Math.atan2(nrm.y, nrm.z) * 180) / Math.PI;
    expect(elev).toBeGreaterThan(25);
    expect(elev).toBeLessThan(45);
    // the tail is open for the dock's ramp: nothing past the bed end but the tension bolt's nuts
    expect(K.pieceBounds(p).max.x).toBeLessThan(5 + 0.1); // the dock's first ramp roller is 0.12 past it
    expect(K.pieceBounds(belt({ length: 10 })).max.x).toBeGreaterThan(5 + 0.15);
  });

  it('poses: the dial by detent, the lever three ways, the lamp, a parsed pose', () => {
    expect(dialAngle(3)).toBeCloseTo(0, 9);
    expect(dialAngle(1)).toBeGreaterThan(0); // slow is anticlockwise (left)
    expect(dialAngle(5)).toBeCloseTo(-dialAngle(1), 9);
    expect(leverAngle(1)).toBeLessThan(0); // forward leans right
    expect(leverAngle(-1)).toBeCloseTo(-leverAngle(1), 9);
    expect(parsePose('dial:2.5,lever:-1,lamp:1')).toEqual({ dial: 2.5, lever: -1, lamp: true });
    expect(parsePose('nonsense')).toBeNull();
    const root = new Group();
    const mk = (q: PieceNode, parent: Group): void => {
      const o = new Group();
      o.name = q.name;
      if (q.transform) q.transform.decompose(o.position, o.quaternion, o.scale);
      parent.add(o);
      for (const c of q.children ?? []) mk(c, o);
    };
    mk(p.root, root);
    const r = beltRollers(10);
    const lever = root.getObjectByName('lever')!;
    const lpos = (): Vector3 => new Vector3(0, 0, -0.4).applyQuaternion(lever.quaternion);
    poseBelt(root, 10, r, { lever: 0 });
    const up = lpos();
    poseBelt(root, 10, r, { lever: 1 });
    expect(lpos().distanceTo(up)).toBeGreaterThan(0.15);
    poseBelt(root, 10, r, { lamp: true });
    expect(root.getObjectByName('lamp.lit')!.scale.x).toBe(1);
    expect(root.getObjectByName('lamp.unlit')!.scale.x).toBeCloseTo(HIDDEN, 9);
    poseBelt(root, 10, r, { lamp: false });
    expect(root.getObjectByName('lamp.lit')!.scale.x).toBeCloseTo(HIDDEN, 9);
    // the stripes ride the loop with the seam, a third of the way round apart
    const g = loopGeom(10);
    poseBelt(root, 10, r, { travel: 0.7 });
    const a = root.getObjectByName('mark1')!.position.clone();
    poseBelt(root, 10, r, { travel: 0.7 + g.length / (MARKS + 1) });
    expect(root.getObjectByName('mark2')!.position.distanceTo(a)).toBeLessThan(1e-6);
    // built in a pose by name
    for (const pose of ['speed1', 'speed5', 'backward', 'forward', 'lit', 'dial:2,lever:-0.5']) expect(belt({ line: true, pose }).triangles).toBeGreaterThan(0);
  });
});

describe('the loop and the pose', () => {
  const g = loopGeom(6);

  it('is continuous all the way round, and the top run travels +X at the surface height', () => {
    const N = 2000;
    let prev = loopAt(g, 0);
    for (let i = 1; i <= N; i++) {
      const q = loopAt(g, (g.length * i) / N);
      expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThan((g.length / N) * 1.01 + 1e-9);
      prev = q;
    }
    const top = loopAt(g, topRunS(g, 0));
    expect(top.angle).toBeCloseTo(0, 6);
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y + BELT.thickness / 2).toBeCloseTo(BELT.topY, 6);
  });

  it('the seam moves with the travel and comes back after one loop', () => {
    const a = seamMatrix(6, 0), b = seamMatrix(6, 0.5), c = seamMatrix(6, g.length);
    const pa = new Vector3().setFromMatrixPosition(a), pb = new Vector3().setFromMatrixPosition(b), pc = new Vector3().setFromMatrixPosition(c);
    expect(pb.x - pa.x).toBeCloseTo(0.5, 5);
    expect(pc.distanceTo(pa)).toBeLessThan(1e-6);
  });

  it('poseBelt turns the rollers the right way and moves the seam', () => {
    const p = belt();
    const root = new Group();
    const mk = (n: PieceNode, parent: Group): void => {
      const o = new Group();
      o.name = n.name;
      if (n.transform) n.transform.decompose(o.position, o.quaternion, o.scale);
      parent.add(o);
      for (const c of n.children ?? []) mk(c, o);
    };
    mk(p.root, root);
    const rollers = beltRollers(6);
    poseBelt(root, 6, rollers, { travel: 0.1 });
    const drum = root.getObjectByName('roller0')!;
    // clockwise seen from the front: the cap's +Y swings toward +X
    const up = new Vector3(0, 1, 0).applyQuaternion(drum.quaternion);
    expect(up.x).toBeGreaterThan(0);
    const idler = root.getObjectByName('roller1')!;
    expect(new Vector3(0, 1, 0).applyQuaternion(idler.quaternion).x).toBeLessThan(0);
    const seam = root.getObjectByName('seam')!;
    expect(seam.position.x).toBeCloseTo(new Vector3().setFromMatrixPosition(seamMatrix(6, 0.1)).x, 6);
    // and back to rest
    poseBelt(root, 6, rollers, { travel: 0 });
    expect(new Vector3(0, 1, 0).applyQuaternion(drum.quaternion).x).toBeCloseTo(0, 6);
  });

  it('builds in every named pose from the catalogue', () => {
    const e = catalogue[0]!;
    for (const pose of Object.keys(NAMED_POSES)) expect(e.build({ pose }).triangles).toBeGreaterThan(0);
    void Matrix4;
  });
});
