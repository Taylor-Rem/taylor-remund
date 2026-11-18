import { describe, expect, it } from 'vitest';
import { Group, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Bone, Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import {
  lamp, poseLamp, posePiece, keyLight, catalogue, LAMP_PLACE, STAGE_BULB, STAGE_AIM, DIM, solveArm, stageTarget, nodeTransforms, aimLamp, lampLight, lampSockets, AIM_TARGETS, SPRINGS, springLength, HOME,
} from '../../../src/workshop/view/kit/pieces/lamp/index.ts';
import { RIG } from '../../../src/workshop/view/stage/light.ts';
import { checkGeometry } from './helpers.ts';

/** V-lamp-r: 5,500 triangles and 5 meshes. */
const BUDGET = 5500;
const MESHES = 5;

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

/** World matrices of every node as described. */
function worlds(p: Piece): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const walk = (n: PieceNode, parent: Matrix4): void => {
    const w = parent.clone().multiply(n.transform ?? new Matrix4());
    out.set(n.name, w);
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, new Matrix4());
  return out;
}

const close = (a: Matrix4, b: Matrix4, eps = 1e-9): boolean => a.elements.every((e, i) => Math.abs(e - b.elements[i]!) < eps);

describe('the lamp', () => {
  const p = lamp();

  it('builds deterministically, with sound geometry', () => {
    const a = lamp({ seed: 3 }), b = lamp({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has a node for every joint, every spring coil and every light state', () => {
    const n = nodes(p);
    for (const name of ['swivel', 'knuckle', 'arm1', 'arm2', 'shade', 'head', 'bulb.lit', 'bulb.unlit', 'bulb.lit.1', 'bulb.lit.2', 'bulb.lit.3', 'spring1', 'spring1.end', 'spring2', 'spring2.end']) expect(n.has(name), name).toBe(true);
    for (const s of Object.values(SPRINGS)) for (let k = 0; k < s.rings; k++) expect(n.has(`${s.name}.ring${k}`)).toBe(true);
    // the lit levels glow; the dark twin does not
    for (const name of ['bulb.lit.1', 'bulb.lit.2', 'bulb.lit.3']) expect(n.get(name)!.parts.every((q) => q.material === 'bulb'), name).toBe(true);
    expect(n.get('bulb.unlit')!.parts.some((q) => q.material === 'bulb')).toBe(false);
  });

  it('stays inside its triangle and mesh budget', () => {
    const b = K.budget(p, BUDGET);
    if (process.env['LAMP_TRIS']) console.log(b.text, '\nlow', lamp({ detail: 'low' }).triangles, 'size', JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(b.meshes).toBeLessThanOrEqual(MESHES);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(lamp({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
    const o = K.realize(p, stub);
    expect(K.drawStats(o).meshes).toBeLessThanOrEqual(MESHES);
  });

  it('is the approved lamp at rest: filament on the stage key light, shade along the aim', () => {
    const k = keyLight(p);
    expect(new Vector3(...k.position).distanceTo(new Vector3(...STAGE_BULB))).toBeLessThan(1e-4);
    const want = new Vector3(...STAGE_AIM).sub(new Vector3(...STAGE_BULB)).normalize();
    const got = new Vector3(...k.aim).sub(new Vector3(...k.position)).normalize();
    expect(got.angleTo(want)).toBeLessThan((3 * Math.PI) / 180);
    // the arm's frames are the rig's solution, exactly
    const s = solveArm(stageTarget().bulb, stageTarget().aim);
    const w = worlds(p);
    expect(close(w.get('arm1')!, s.arm1)).toBe(true);
    expect(close(w.get('arm2')!, s.arm1.clone().multiply(s.arm2))).toBe(true);
    expect(close(w.get('head')!, s.arm1.clone().multiply(s.arm2).multiply(s.shade))).toBe(true);
    expect(s.elbow.distanceTo(s.shoulder)).toBeCloseTo(DIM.l1, 4);
    // the home pose IS the rest pose, node for node
    const m = nodeTransforms({});
    for (const [name, n] of nodes(p)) if (m[name]) expect(close(n.transform ?? new Matrix4(), m[name]!), name).toBe(true);
    // and the light it gives is the key light
    const L = lampLight({});
    expect(new Vector3(...L.position).add(new Vector3(...LAMP_PLACE)).distanceTo(new Vector3(...STAGE_BULB))).toBeLessThan(1e-6);
  });

  it('poses by node transforms only (geometry, materials and triangles untouched; nothing in a spring scaled)', () => {
    const q = lamp();
    const before = new Map([...nodes(q)].map(([k, n]) => [k, n.parts.map((x) => x.geometry)]));
    posePiece(q.root, { ...aimLamp(AIM_TARGETS['far-left']).pose, level: 1 });
    for (const [k, n] of nodes(q)) expect(n.parts.map((x) => x.geometry)).toEqual(before.get(k));
    expect(K.countTriangles(q)).toBe(p.triangles);
    const sc = new Vector3();
    for (const [name, t] of Object.entries(nodeTransforms(aimLamp(AIM_TARGETS['far-right']).pose))) {
      if (!name.startsWith('spring')) continue;
      t.decompose(new Vector3(), new Quaternion(), sc);
      expect(sc.distanceTo(new Vector3(1, 1, 1)), name).toBeLessThan(1e-9);
    }
  });

  it('keeps its springs honest: coils spread when stretched, never squeezed far past closed', () => {
    for (const s of Object.values(SPRINGS)) {
      const home = springLength(s, {});
      let lo = Infinity, hi = -Infinity;
      for (const t of Object.values(AIM_TARGETS)) {
        const L = springLength(s, aimLamp(t).pose);
        lo = Math.min(lo, L);
        hi = Math.max(hi, L);
      }
      // the coils close at home; a pose stretches them (the shoulder's only stretches)
      expect(hi, s.name).toBeGreaterThan(home * 1.05);
      expect(lo, s.name).toBeGreaterThan(home * 0.85);
    }
    // lowering the arm stretches the shoulder spring (a counterbalance)
    expect(springLength(SPRINGS.shoulder, { shoulder: HOME.shoulder - 0.5 })).toBeGreaterThan(springLength(SPRINGS.shoulder, {}));
  });

  it('keeps every part near the light outside the key light\'s cone, at home and aimed anywhere', () => {
    const cone = RIG.key.angle;
    const poses = [{}, ...Object.values(AIM_TARGETS).map((t) => aimLamp(t).pose)];
    for (const pose of poses) {
      const q = lamp({ pose });
      const w = worlds(q);
      const m = lampSockets(p, pose).bulb;
      const o = new Vector3().setFromMatrixPosition(m);
      const axis = new Vector3(0, 1, 0).transformDirection(m);
      let inside = 0;
      for (const [name, node] of nodes(q)) {
        if (name.startsWith('bulb')) continue;
        for (const part of node.parts) {
          if (part.material === 'bulb') continue;
          const pos = part.geometry.getAttribute('position');
          const v = new Vector3();
          for (let i = 0; i < pos.count; i += 3) {
            v.fromBufferAttribute(pos, i).applyMatrix4(w.get(name)!).sub(o);
            if (v.length() < 1e-6 || v.length() > 2.5) continue; // the lamp's own body near the light
            if (v.angleTo(axis) < cone + (2 * Math.PI) / 180) inside++;
          }
        }
      }
      expect(inside, JSON.stringify(pose)).toBe(0);
    }
  });

  it('realizes skinned; poseLamp moves bones only; the lit and dark twins swap by scale', () => {
    const o = K.realize(p, stub);
    const lit = o.getObjectByName('bulb.lit')!, unlit = o.getObjectByName('bulb.unlit')!;
    expect((lit as Bone).isBone).toBe(true);
    expect(unlit.scale.x).toBeLessThan(0.01);
    expect(o.getObjectByName('bulb.lit.3')!.scale.x).toBe(1);
    expect(o.getObjectByName('bulb.lit.1')!.scale.x).toBeLessThan(0.01);
    poseLamp(o, { on: false });
    expect(lit.scale.x).toBeLessThan(0.01);
    expect(unlit.scale.x).toBeCloseTo(1, 9);
    poseLamp(o, { level: 1 });
    expect(lit.scale.x).toBeCloseTo(1, 9);
    expect(o.getObjectByName('bulb.lit.1')!.scale.x).toBeCloseTo(1, 9);
    expect(o.getObjectByName('bulb.lit.3')!.scale.x).toBeLessThan(0.01);
    // posed by aim: the head bone's world frame is the forward kinematics'
    const a = aimLamp(AIM_TARGETS.button);
    poseLamp(o, a.pose);
    o.updateMatrixWorld(true);
    const head = o.getObjectByName('head') as Object3D;
    const want = new Vector3(...a.bulb);
    const got = new Vector3(DIM.neck, 0, 0).applyMatrix4(head.matrixWorld);
    expect(got.distanceTo(want)).toBeLessThan(1e-6);
    expect(o).toBeInstanceOf(Group);
  });

  it('moves its grip and bulb sockets with the pose', () => {
    const a = aimLamp(AIM_TARGETS['far-left']);
    const s = lampSockets(p, a.pose);
    expect(new Vector3().setFromMatrixPosition(s.bulb).distanceTo(new Vector3(...a.bulb))).toBeLessThan(1e-6);
    const home = lampSockets(p, {});
    expect(close(home.grip, p.sockets!['shade.grip']!, 1e-9)).toBe(true);
    // the grip rides on the shade: it stays the same distance from the filament
    const d0 = new Vector3().setFromMatrixPosition(home.grip).distanceTo(new Vector3().setFromMatrixPosition(home.bulb));
    const d1 = new Vector3().setFromMatrixPosition(s.grip).distanceTo(new Vector3().setFromMatrixPosition(s.bulb));
    expect(d1).toBeCloseTo(d0, 9);
  });

  it('is registered, with its named poses', () => {
    expect(catalogue.map((e) => e.name)).toEqual(['lamp']);
    expect(catalogue[0]!.build({ pose: 'off' }).triangles).toBe(p.triangles);
    for (const pose of catalogue[0]!.poses ?? []) expect(catalogue[0]!.build({ pose }).triangles, pose).toBe(p.triangles);
    expect(catalogue[0]!.build({ pose: 'aim:2,6' }).triangles).toBe(p.triangles);
    expect(LAMP_PLACE[0]).toBe(-4.5);
  });
});
