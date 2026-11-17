import { describe, expect, it } from 'vitest';
import { Group, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Mesh } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { lamp, poseLamp, keyLight, catalogue, LAMP_PLACE, STAGE_BULB, STAGE_AIM, DIM, solveArm, stageTarget } from '../../../src/workshop/view/kit/pieces/lamp/index.ts';
import { RIG } from '../../../src/workshop/view/stage/light.ts';
import { checkGeometry } from './helpers.ts';

const BUDGET = 7000;

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

/** World matrices of every node at rest. */
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

  it('has its joints and the lit/unlit swap', () => {
    const n = nodes(p);
    for (const name of ['arm1', 'arm2', 'shade', 'lit', 'unlit']) expect(n.has(name), name).toBe(true);
    expect(n.get('lit')!.parts.every((q) => q.material === 'bulb')).toBe(true);
    expect(n.get('unlit')!.parts.some((q) => q.material === 'bulb')).toBe(false);
  });

  it('stays inside its triangle budget', () => {
    if (process.env['LAMP_TRIS']) console.log(K.budget(p, BUDGET).text, '\nlow', lamp({ detail: 'low' }).triangles, 'size', JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(lamp({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
  });

  it('puts its filament on the stage key light, the shade along the aim', () => {
    const k = keyLight(p);
    expect(new Vector3(...k.position).distanceTo(new Vector3(...STAGE_BULB))).toBeLessThan(1e-4);
    const want = new Vector3(...STAGE_AIM).sub(new Vector3(...STAGE_BULB)).normalize();
    const got = new Vector3(...k.aim).sub(new Vector3(...k.position)).normalize();
    expect(got.angleTo(want)).toBeLessThan((3 * Math.PI) / 180);
    // the arm really reaches: pivots are the lengths apart
    const s = solveArm(stageTarget().bulb, stageTarget().aim);
    expect(s.elbow.distanceTo(s.shoulder)).toBeCloseTo(DIM.l1, 4);
    expect(s.wrist.distanceTo(s.elbow)).toBeCloseTo(DIM.l2, 4);
  });

  it('keeps every part of the lamp near the light outside the key light\'s cone (no self-shadow, no light blocked)', () => {
    const w = worlds(p);
    const bulb = p.sockets!['bulb']!;
    const o = new Vector3().setFromMatrixPosition(bulb);
    const axis = new Vector3(0, 1, 0).transformDirection(bulb);
    const cone = RIG.key.angle;
    let inside = 0;
    for (const name of ['shade', 'arm1', 'arm2', 'root']) {
      const node = nodes(p).get(name)!;
      for (const q of node.parts) {
        if (q.material === 'bulb') continue;
        const pos = q.geometry.getAttribute('position');
        const m = w.get(name)!;
        const v = new Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m).sub(o);
          if (v.length() < 1e-6 || v.length() > 2) continue; // the lamp's own body near the light (the clamp far below may stand in the pool)
          if (v.angleTo(axis) < cone + 2 * (Math.PI / 180)) { inside++; if (process.env["LAMP_TRIS"] && inside < 6) console.log("in cone", name, q.material, v.length().toFixed(3), (v.angleTo(axis) * 180 / Math.PI).toFixed(1)); }
        }
      }
    }
    expect(inside).toBe(0);
  });

  it('realizes; the bulb and the lit liner never cast; poseLamp swaps lit and dark', () => {
    const o = K.realize(p, stub);
    const lit = o.getObjectByName('lit')!, unlit = o.getObjectByName('unlit')!;
    lit.traverse((m) => {
      if ((m as Mesh).isMesh) expect((m as Mesh).castShadow).toBe(false);
    });
    expect(unlit.scale.x).toBeLessThan(0.01);
    poseLamp(o, { on: false });
    expect(lit.visible).toBe(false);
    expect(unlit.visible).toBe(true);
    expect(unlit.scale.x).toBe(1);
    poseLamp(o, { on: true });
    expect(lit.visible).toBe(true);
    expect(unlit.visible).toBe(false);
    expect(o).toBeInstanceOf(Group);
  });

  it('is registered', () => {
    expect(catalogue.map((e) => e.name)).toEqual(['lamp']);
    expect(catalogue[0]!.build({ pose: 'off' }).triangles).toBe(p.triangles);
    expect(LAMP_PLACE[0]).toBe(-4.5);
  });
});
