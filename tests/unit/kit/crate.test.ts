import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { crate, crateLabelKeys, catalogue, paintRanges, repaint, stencilInk } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
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
      expect(hi.triangles).toBeLessThanOrEqual(1000);
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
    // the label sits on the front panel under the top rail, facing the visitor
    const at = new Vector3().setFromMatrixPosition(p.sockets!['label']!);
    expect(at.z).toBeGreaterThan(p.size.z / 2 - 0.07);
    expect(at.y).toBeGreaterThan(p.size.y * 0.7);
    // the lid's hinge axis (its local +Y) runs along world X, at the back
    const lid = nodes(p).find((n) => n.name === 'lid')!;
    const yAxis = new Vector3(0, 1, 0).transformDirection(lid.transform!);
    expect(Math.abs(yAxis.x)).toBeCloseTo(1, 6);
    expect(new Vector3().setFromMatrixPosition(lid.transform!).z).toBeLessThan(-0.2);
  });

  it('names the stencil textures it uses', () => {
    const p = crate({ size: 'S', seed: 1 });
    const ink = crateLabelKeys('S', 'ink'), paper = crateLabelKeys('S', 'paper');
    const tex = nodes(p).flatMap((n) => n.parts.map((q) => q.texture)).filter(Boolean);
    expect(new Set(tex)).toEqual(new Set([ink.arrows, ink.letter, paper.arrows, paper.letter]));
    expect(stencilInk(null)).toBe('ink');
    expect(stencilInk('paper')).toBe('ink');
    expect(stencilInk('cable-red')).toBe('paper');
    expect(stencilInk('paint-blue')).toBe('paper');
    expect(nodes(crate({ size: 'S', stencil: false })).flatMap((n) => n.parts.map((q) => q.texture)).filter(Boolean)).toEqual([]);
  });

  it('paint: a painted build differs from bare only in the paint ranges', () => {
    const bare = crate({ size: 'M', seed: 4 });
    const blue = crate({ size: 'M', seed: 4, paint: 'paint-blue' });
    const ranges = paintRanges(bare);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((r) => r.material === 'wood')).toBe(true);
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

  /** For each mesh of a realised crate, which of its vertices are paint and which are stencil (and which ink), via sourcesOf. */
  function layout(p: Piece, o: Object3D): Map<Mesh, { paint: Set<number>; stencil: Map<number, 'ink' | 'paper'> }> {
    const ranges = paintRanges(p);
    const partOf = new Map<unknown, { node: string; material: string; texture?: string }>();
    for (const n of nodes(p)) for (const q of n.parts) partOf.set(q.geometry, { node: n.name, material: q.material, ...(q.texture ? { texture: q.texture } : {}) });
    const out = new Map<Mesh, { paint: Set<number>; stencil: Map<number, 'ink' | 'paper'> }>();
    o.traverse((x: Object3D) => {
      const m = x as Mesh;
      if (!m.isMesh) return;
      const paint = new Set<number>();
      const stencil = new Map<number, 'ink' | 'paper'>();
      for (const s of K.sourcesOf(m)) {
        const part = partOf.get(s.source);
        if (!part) continue;
        if (part.texture) for (let i = 0; i < s.count; i++) stencil.set(s.start + i, part.texture.startsWith('stencil:paper') ? 'paper' : 'ink');
        const r = !part.texture ? ranges.find((x) => x.node === part.node && x.material === part.material) : undefined;
        if (r) for (const [a, c] of r.ranges) for (let i = a; i < a + c; i++) paint.add(s.start + i);
      }
      out.set(m, { paint, stencil });
    });
    return out;
  }

  const colours = (o: Object3D): Map<string, Float32Array> => {
    const out = new Map<string, Float32Array>();
    o.traverse((x: Object3D) => { const m = x as Mesh; if (m.isMesh) out.set(`${m.parent!.name}/${m.name}`, (m.geometry.getAttribute('color').array as Float32Array).slice()); });
    return out;
  };

  it('repaint, default (skinned) backend: only the paint range of this crate changes, its twin does not, and back to bare', () => {
    const p = crate({ size: 'M', seed: 9 });
    const a = K.realize(p, stub, { shadowProxy: false });
    const b = K.realize(p, stub, { shadowProxy: false }); // shares the skinned geometry with a
    expect(a.userData['kitBackend']).toBe('skinned');
    const lay = layout(p, a);
    const totalPaint = [...lay.values()].reduce((s, l) => s + l.paint.size, 0);
    const totalStencil = [...lay.values()].reduce((s, l) => s + l.stencil.size, 0);
    expect(totalPaint).toBeGreaterThan(100);
    const before = new Map<Mesh, Float32Array>();
    for (const m of lay.keys()) before.set(m, (m.geometry.getAttribute('color').array as Float32Array).slice());
    const bBefore = colours(b);
    // returns the vertices it wrote: every paint vertex and every stencil vertex
    expect(repaint(a, 'cable-red')).toBe(totalPaint + totalStencil);
    const red = linear('cable-red');
    for (const [m, l] of lay) {
      const now = m.geometry.getAttribute('color').array as Float32Array;
      const sz = m.geometry.getAttribute('surf');
      const old = before.get(m)!;
      for (let v = 0; v < now.length / 3; v++) {
        if (l.paint.has(v)) {
          expect(Math.abs(now[v * 3]! / now[v * 3 + 2]! - red[0] / red[2])).toBeLessThan(1e-3);
          expect(sz.getZ(v)).toBe(1);
        } else expect(now[v * 3]).toBe(old[v * 3]);
      }
    }
    expect(colours(b)).toEqual(bBefore);
    repaint(a, null);
    for (const [m, l] of lay) {
      expect(Array.from(m.geometry.getAttribute('color').array as Float32Array)).toEqual(Array.from(before.get(m)!));
      for (const v of l.paint) expect(m.geometry.getAttribute('surf').getZ(v)).toBe(0);
    }
    expect(repaint(K.realize(K.piece('x').add(K.part('wood', K.roundedBox({ w: 1, h: 1, d: 1 }), 'wood')).build(), stub), 'paper')).toBe(0);
  });

  it('repaint swaps the stencil ink on the default backend: paper up on dark paint, ink up when bare', () => {
    const p = crate({ size: 'M', seed: 2 });
    const o = K.realize(p, stub);
    const lay = layout(p, o);
    const mats = new Set<string>();
    for (const m of lay.keys()) mats.add(String(m.userData['kitMaterial']));
    expect(mats.has('steel')).toBe(false);
    const posBefore = new Map<Mesh, Float32Array>();
    for (const m of lay.keys()) posBefore.set(m, (m.geometry.getAttribute('position').array as Float32Array).slice());
    // the front-most z of each ink's vertices: the one showing sits 0.016 proud of the sunk one
    const front = (ink: 'ink' | 'paper'): number => {
      let z = -Infinity;
      for (const [m, l] of lay) for (const [v, k] of l.stencil) if (k === ink) z = Math.max(z, m.geometry.getAttribute('position').getZ(v));
      return z;
    };
    expect(front('ink') - front('paper')).toBeCloseTo(0.016, 3);
    repaint(o, 'paint-green');
    expect(front('paper') - front('ink')).toBeCloseTo(0.016, 3);
    // nothing but the stencil moved
    for (const [m, l] of lay) {
      const a = m.geometry.getAttribute('position').array as Float32Array, b0 = posBefore.get(m)!;
      for (let v = 0; v < a.length / 3; v++) if (!l.stencil.has(v)) expect(a[v * 3 + 2]).toBe(b0[v * 3 + 2]);
    }
    repaint(o, null);
    expect(front('ink') - front('paper')).toBeCloseTo(0.016, 3);
    // the painted build carries paint coverage in the finish channel
    const pp = crate({ size: 'M', seed: 2, paint: 'paint-green' });
    const r = paintRanges(pp)[0]!;
    const part = nodes(pp).find((n) => n.name === r.node)!.parts.find((q) => q.material === r.material && !q.texture)!;
    expect(part.geometry.getAttribute('surf').getZ(r.ranges[0]![0])).toBe(1);
  });

  it('the nodes and skinned backends agree after the same repaint', () => {
    const p = crate({ size: 'L', seed: 5 });
    const sk = K.realize(p, stub, { backend: 'skinned', shadowProxy: false });
    const nd = K.realize(p, stub, { backend: 'nodes', shadowProxy: false });
    expect(repaint(sk, 'paint-blue')).toBe(repaint(nd, 'paint-blue'));
    // compare every source part's colours and positions (in its node's space for nodes; merged for skinned)
    const per = (o: Object3D): Map<unknown, { col: number[]; z: number[] }> => {
      const out = new Map<unknown, { col: number[]; z: number[] }>();
      o.traverse((x: Object3D) => {
        const m = x as Mesh;
        if (!m.isMesh) return;
        const sources = (m.userData['crateOwnPaint'] as ReturnType<typeof K.sourcesOf> | undefined) ?? K.sourcesOf(m);
        for (const s of sources) {
          const c = m.geometry.getAttribute('color').array as Float32Array;
          out.set(s.source, { col: Array.from(c.slice(s.start * 3, (s.start + s.count) * 3)), z: [] });
        }
      });
      return out;
    };
    const a = per(sk), b = per(nd);
    let compared = 0;
    for (const [src, v] of b) {
      const w = a.get(src);
      if (!w) continue;
      expect(w.col.length).toBe(v.col.length);
      for (let i = 0; i < v.col.length; i++) expect(w.col[i]).toBeCloseTo(v.col[i]!, 6);
      compared++;
    }
    expect(compared).toBeGreaterThan(5);
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
