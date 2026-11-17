import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { BufferAttribute, Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { crate, crateLabelKeys, catalogue, paintRanges, repaint } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
import { linear } from '../../../src/workshop/view/palette.ts';
import { checkGeometry } from './helpers.ts';

const stub: Materials = {
  of: () => new MeshBasicMaterial() as Material,
  textured: () => new MeshBasicMaterial() as Material,
  update: () => {},
  dispose: () => {},
};

function nodes(p: Piece): PieceNode[] {
  const out: PieceNode[] = [];
  const walk = (n: PieceNode): void => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

function fingerprint(p: Piece): number[] {
  const out: number[] = [];
  for (const n of nodes(p)) for (const q of n.parts) {
    const pos = q.geometry.getAttribute('position').array;
    const col = q.geometry.getAttribute('color').array;
    let s = 0;
    for (let i = 0; i < pos.length; i += 7) s += pos[i]! * (i % 13) + col[i]!;
    out.push(pos.length, s);
  }
  return out;
}

describe('crate', () => {
  for (const size of ['S', 'M', 'L'] as const) {
    it(`${size}: within budget at both detail levels, every geometry well formed`, () => {
      const hi = crate({ size, seed: 3 });
      const lo = crate({ size, seed: 3, detail: 'low' });
      expect(hi.triangles).toBe(K.countTriangles(hi));
      expect(hi.triangles).toBeLessThanOrEqual(1400);
      expect(lo.triangles).toBeLessThanOrEqual(520);
      for (const n of nodes(hi)) for (const q of n.parts) checkGeometry(q.geometry);
      for (const n of nodes(lo)) for (const q of n.parts) checkGeometry(q.geometry);
    });
  }

  it('sizes: S < M < L, each about its design width, standing on y = 0', () => {
    const w = { S: 0.45, M: 0.6, L: 0.8 };
    let prev = 0;
    for (const size of ['S', 'M', 'L'] as const) {
      const p = crate({ size, seed: 1 });
      expect(p.size.x).toBeGreaterThan(w[size] - 0.01);
      expect(p.size.x).toBeLessThan(w[size] + 0.06);
      expect(p.size.x).toBeGreaterThan(prev);
      prev = p.size.x;
      const bb = K.pieceBounds(p);
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.005);
      expect(bb.min.y).toBeLessThan(0.005);
    }
  });

  it('is deterministic per seed, and different between seeds', () => {
    expect(fingerprint(crate({ size: 'M', seed: 5 }))).toEqual(fingerprint(crate({ size: 'M', seed: 5 })));
    expect(fingerprint(crate({ size: 'M', seed: 5 }))).not.toEqual(fingerprint(crate({ size: 'M', seed: 6 })));
  });

  it('names its moving nodes and sockets', () => {
    const p = crate({ size: 'L', seed: 2 });
    const names = nodes(p).map((n) => n.name);
    expect(names).toEqual(['root', 'lid', 'latch']);
    expect(Object.keys(p.sockets ?? {}).sort()).toEqual(['grip', 'label']);
    // the label sits on the front top rail, facing the visitor
    const at = new Vector3().setFromMatrixPosition(p.sockets!['label']!);
    expect(at.z).toBeGreaterThan(p.size.z / 2 - 0.05);
    expect(at.y).toBeGreaterThan(p.size.y * 0.75);
    // the lid's hinge axis (its local +Y) runs along world X, at the back
    const lid = nodes(p).find((n) => n.name === 'lid')!;
    const yAxis = new Vector3(0, 1, 0).transformDirection(lid.transform!);
    expect(Math.abs(yAxis.x)).toBeCloseTo(1, 6);
    expect(new Vector3().setFromMatrixPosition(lid.transform!).z).toBeLessThan(-0.2);
  });

  it('names the stencil textures it uses', () => {
    const p = crate({ size: 'S', seed: 1 });
    const keys = crateLabelKeys('S');
    const tex = nodes(p).flatMap((n) => n.parts.map((q) => q.texture)).filter(Boolean);
    expect(new Set(tex)).toEqual(new Set([keys.arrows, keys.letter]));
    expect(nodes(crate({ size: 'S', stencil: false })).flatMap((n) => n.parts.map((q) => q.texture)).filter(Boolean)).toEqual([]);
  });

  it('paint: a painted build differs from bare only in the paint ranges', () => {
    const bare = crate({ size: 'M', seed: 4 });
    const blue = crate({ size: 'M', seed: 4, paint: 'paint-blue' });
    const ranges = paintRanges(bare);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((r) => r.material === 'steel')).toBe(true);
    const nb = nodes(bare), nc = nodes(blue);
    let inside = 0;
    nb.forEach((n, i) => n.parts.forEach((q, j) => {
      const a = q.geometry.getAttribute('color').array, b = nc[i]!.parts[j]!.geometry.getAttribute('color').array;
      const r = ranges.find((x) => x.node === n.name && x.material === q.material && !q.texture);
      const isPaint = (v: number): boolean => !!r && r.ranges.some(([s, c]) => v >= s && v < s + c);
      for (let v = 0; v < a.length / 3; v++) {
        const same = a[v * 3] === b[v * 3] && a[v * 3 + 1] === b[v * 3 + 1] && a[v * 3 + 2] === b[v * 3 + 2];
        if (isPaint(v)) { expect(same).toBe(false); inside++; } else expect(same).toBe(true);
      }
    }));
    expect(inside).toBeGreaterThan(50);
  });

  it('repaint rewrites only the paint range of this object, and back to bare', () => {
    const p = crate({ size: 'S', seed: 9 });
    const a = K.realize(p, stub);
    const b = K.realize(p, stub); // shares geometry with a (the memo case)
    const before = new Map<Mesh, Float32Array>();
    a.traverse((o: Object3D) => { const m = o as Mesh; if (m.isMesh) before.set(m, (m.geometry.getAttribute('color').array as Float32Array).slice()); });
    expect(repaint(a, 'cable-red')).toBeGreaterThan(0);
    const red = linear('cable-red');
    const ranges = paintRanges(p);
    a.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const now = m.geometry.getAttribute('color').array as Float32Array;
      const old = before.get(m)!;
      const node = m.parent!.name;
      const r = ranges.find((x) => x.node === node && x.material === m.userData['kitMaterial'] && !m.name.includes('stencil'));
      for (let v = 0; v < now.length / 3; v++) {
        const inPaint = !!r && r.ranges.some(([s, c]) => v >= s && v < s + c);
        if (inPaint) expect(Math.abs(now[v * 3]! / now[v * 3 + 2]! - red[0] / red[2])).toBeLessThan(1e-3);
        else expect(now[v * 3]).toBe(old[v * 3]);
      }
    });
    // the other realisation, sharing the memoised geometry, is untouched
    b.traverse((o: Object3D) => { const m = o as Mesh; if (m.isMesh) for (const [mm, old] of before) if (mm.name === m.name && mm.parent!.name === m.parent!.name) expect(Array.from(m.geometry.getAttribute('color').array as Float32Array)).toEqual(Array.from(old)); });
    // back to bare: every colour as built
    repaint(a, null);
    a.traverse((o: Object3D) => { const m = o as Mesh; if (m.isMesh) expect(Array.from(m.geometry.getAttribute('color').array as Float32Array)).toEqual(Array.from(before.get(m)!)); });
    expect(repaint(K.realize(K.piece('x').add(K.part('wood', K.roundedBox({ w: 1, h: 1, d: 1 }), 'wood')).build(), stub), 'paper')).toBe(0);
    void (null as unknown as BufferAttribute);
    void Matrix4;
  });

  it('bare, the paint skins hide inside the planks; repaint brings them to the face', () => {
    const p = crate({ size: 'M', seed: 2 });
    const o = K.realize(p, stub);
    const steel: Mesh[] = [];
    o.traverse((x: Object3D) => { const m = x as Mesh; if (m.isMesh && m.userData['kitMaterial'] === 'steel') steel.push(m); });
    expect(steel.length).toBe(2); // body and lid
    const before = steel.map((m) => (m.geometry.getAttribute('position').array as Float32Array).slice());
    repaint(o, 'paint-green');
    steel.forEach((m, i) => {
      const a = m.geometry.getAttribute('position').array as Float32Array, n = m.geometry.getAttribute('normal').array as Float32Array;
      // every vertex moved out along its normal by the sink depth
      for (let v = 0; v < a.length / 3; v++) {
        const d = (a[v * 3]! - before[i]![v * 3]!) * n[v * 3]! + (a[v * 3 + 1]! - before[i]![v * 3 + 1]!) * n[v * 3 + 1]! + (a[v * 3 + 2]! - before[i]![v * 3 + 2]!) * n[v * 3 + 2]!;
        expect(d).toBeCloseTo(0.012, 5);
      }
    });
    repaint(o, null);
    steel.forEach((m, i) => expect(Array.from(m.geometry.getAttribute('position').array as Float32Array)).toEqual(Array.from(before[i]!)));
  });

  it('is registered with its sizes and paints', () => {
    const e = catalogue.find((c) => c.name === 'crate')!;
    expect(Object.keys(e.variants ?? {})).toEqual(expect.arrayContaining(['S', 'M', 'L']));
    expect(e.build({ size: 'L' }).size.x).toBeGreaterThan(0.79);
  });

  it('prints its budget', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      const p = crate({ size, seed: 1 });
      const lo = crate({ size, seed: 1, detail: 'low' });
      console.log(`crate ${size}: ${p.triangles} tris high, ${lo.triangles} low; size ${p.size.x.toFixed(3)} x ${p.size.y.toFixed(3)} x ${p.size.z.toFixed(3)}; meshes ${nodes(p).reduce((s, n) => s + n.parts.length, 0)}`);
    }
  });
});
