import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { button, poseButton, POSE, catalogue } from '../../../src/workshop/view/kit/pieces/button/index.ts';
import { wheelDigit } from '../../../src/workshop/view/kit/pieces/button/pose.ts';
import { tapeStrips } from '../../../src/workshop/view/kit/pieces/button/labels.ts';
import { world } from '../../../src/workshop/view/labels/content.ts';

const BUDGET = 8000; // the census cap (was 11,000 before the diet)

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

describe('the Button', () => {
  const p = button();

  it('builds deterministically', () => {
    const a = button({ seed: 3 });
    const b = button({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const pa = nodes(a), pb = nodes(b);
    for (const [name, n] of pa) {
      const m = pb.get(name)!;
      expect(m.parts.length).toBe(n.parts.length);
      n.parts.forEach((q, i) => {
        const x = q.geometry.getAttribute('position').array, y = m.parts[i]!.geometry.getAttribute('position').array;
        expect(x.length).toBe(y.length);
        for (let k = 0; k < x.length; k += 97) expect(x[k]).toBe(y[k]);
      });
    }
    // and another seed is not the same piece
    expect(button({ seed: 4 }).root.parts[0]!.geometry.getAttribute('position').array).not.toEqual(a.root.parts[0]!.geometry.getAttribute('position').array);
  });

  it('has its moving nodes', () => {
    const n = nodes(p);
    for (const name of ['cap', 'guard', 'digit0', 'digit1', 'digit2', 'digit3']) expect(n.has(name), name).toBe(true);
    expect(n.get('cap')!.parts.some((q) => q.material === 'steel')).toBe(true);
  });

  it('stays inside its triangle budget at both details', () => {
    const low = button({ detail: 'low' });
    if (process.env['BUTTON_TRIS']) {
      const walk = (n: PieceNode, d = 0): void => {
        for (const q of n.parts) console.log(`${' '.repeat(d)}${n.name}.${q.material}${q.texture ? `[${q.texture}]` : ''} ${K.triangleCount(q.geometry)}`);
        for (const c of n.children ?? []) walk(c, d + 1);
      };
      walk(p.root);
      console.log('total', p.triangles, 'low', low.triangles, 'size', JSON.stringify(p.size));
    }
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(low.triangles).toBeLessThan(p.triangles * 0.75);
  });

  it('is the size the brief asks for, resting on the bench', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    expect(b.min.y).toBeLessThan(0.01);
    // the cap's crown, at rest, on the console's deck: about 1.4-1.55 above the bench
    const cap = p.sockets!['cap']!;
    const crown = new Vector3().setFromMatrixPosition(cap);
    expect(crown.y).toBeGreaterThan(1.4);
    expect(crown.y).toBeLessThan(1.55);
    // the console is about 2.1 wide
    expect(b.max.x - b.min.x).toBeGreaterThan(2.1);
    expect(p.size.x).toBeCloseTo(b.max.x - b.min.x, 6);
    expect(p.size.y).toBeCloseTo(b.max.y - b.min.y, 6);
    expect(p.size.z).toBeCloseTo(b.max.z - b.min.z, 6);
  });

  it('every geometry holds the kit invariants', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) {
        const g = q.geometry;
        expect(g.getAttribute('surf').itemSize).toBe(3);
        for (const v of g.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('the cap is the only button-red, glossy enamel', () => {
    const cap = nodes(p).get('cap')!;
    const red = cap.parts.find((q) => q.material === 'steel')!;
    const s = red.geometry.getAttribute('surf');
    for (let i = 0; i < s.count; i += 13) expect(s.getZ(i)).toBe(1);
  });

  it('poseButton moves only the named nodes, and the right way', () => {
    const o = K.realize(p, stub);
    const before = snapshot(o);
    const cap = o.getObjectByName('cap')!;
    const guard = o.getObjectByName('guard')!;
    const capRest = cap.getWorldPosition(new Vector3());
    const tab = new Vector3(0, 0, 0.9); // the front bar, in the guard's node space (local Y is the hinge line)
    const guardRest = guard.localToWorld(tab.clone());
    poseButton(o, { press: 1, guard: 1, count: 42 });
    const moved = new Set(['cap', 'guard', 'digit0', 'digit1', 'digit2', 'digit3']);
    const after = snapshot(o);
    o.traverse((c) => {
      const changed = before.get(c.uuid)!.some((v, i) => Math.abs(v - after.get(c.uuid)![i]!) > 1e-9);
      expect(changed, c.name).toBe(moved.has(c.name) && c.name !== 'digit2' && c.name !== 'digit3');
    });
    // the cap goes down by the travel, a little toward the visitor (the deck leans forward)
    const capNow = cap.getWorldPosition(new Vector3());
    expect(capRest.distanceTo(capNow)).toBeCloseTo(POSE.travel, 6);
    expect(capNow.y).toBeLessThan(capRest.y - POSE.travel * 0.95);
    // shut, the guard's far end comes down over the cap and forward
    o.updateMatrixWorld(true);
    const guardNow = guard.localToWorld(tab.clone());
    expect(guardNow.y).toBeLessThan(guardRest.y);
    // and back to rest restores everything
    poseButton(o, { press: 0, guard: 0, count: 0 });
    const back = snapshot(o);
    o.traverse((c) => before.get(c.uuid)!.forEach((v, i) => expect(back.get(c.uuid)![i]!).toBeCloseTo(v, 9)));
  });

  it('the wheels count like an odometer', () => {
    expect(wheelDigit(0, 0)).toBe(0);
    expect(wheelDigit(7, 0)).toBe(7);
    expect(wheelDigit(42, 0)).toBe(2);
    expect(wheelDigit(42, 1)).toBe(4);
    expect(wheelDigit(42, 2)).toBe(0);
    expect(wheelDigit(9.5, 1)).toBeCloseTo(0.5, 9);
    expect(wheelDigit(19.5, 1)).toBeCloseTo(1.5, 9);
    expect(wheelDigit(99.5, 2)).toBeCloseTo(0.5, 9);
    expect(wheelDigit(98.5, 2)).toBe(0);
  });

  it('the wheel turns a digit by a tenth of a turn about its axle', () => {
    const o = K.realize(p, stub);
    const w = o.getObjectByName('digit0')!;
    const q0 = w.quaternion.clone();
    poseButton(o, { count: 1 });
    const d = new Quaternion().copy(q0).invert().multiply(w.quaternion);
    expect(2 * Math.acos(Math.min(1, Math.abs(d.w)))).toBeCloseTo((Math.PI * 2) / 10, 6);
    // about the wheel's local Y, which is the world X axle
    const axis = new Vector3(d.x, d.y, d.z).normalize();
    expect(Math.abs(axis.y)).toBeCloseTo(1, 6);
    const axle = new Vector3(0, 1, 0).applyQuaternion(w.getWorldQuaternion(new Quaternion()));
    expect(Math.abs(axle.x)).toBeGreaterThan(0.99);
  });

  it('takes its tape words from the content, in two strips', () => {
    expect(tapeStrips().join(' ')).toBe(world.tape.doNotTouch);
    expect(tapeStrips().length).toBe(2);
  });

  it('builds in a named pose, matching poseButton', () => {
    const posed = button({ pose: 'shut-pressed' });
    const a = K.realize(posed, stub);
    const b = K.realize(button(), stub);
    poseButton(b, { guard: 1, press: 1 });
    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);
    for (const n of ['cap', 'guard']) {
      const ea = a.getObjectByName(n)!.matrixWorld.elements, eb = b.getObjectByName(n)!.matrixWorld.elements;
      ea.forEach((v, i) => expect(v).toBeCloseTo(eb[i]!, 6));
    }
    expect(() => button({ pose: 'nonsense' })).toThrow();
  });

  it('is registered in the catalogue', () => {
    expect(catalogue.map((e) => e.name)).toContain('button');
    const e = catalogue.find((x) => x.name === 'button')!;
    expect(e.build({ detail: 'low' }).name).toBe('button');
    expect(e.poses).toContain('shut-pressed');
    expect(typeof e.labels).toBe('function');
  });

  it('realizes into named groups with meshes', () => {
    const o = K.realize(p, stub);
    let meshes = 0;
    o.traverse((c) => {
      if ((c as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(5);
    expect(o.getObjectByName('guard')).toBeDefined();
    void Matrix4;
  });
});
