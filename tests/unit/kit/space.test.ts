import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial } from 'three';
import type { BufferGeometry, Mesh, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { bakeStats } from '../../../src/workshop/view/kit/surface.ts';
import { pieceFolders, loadCatalogue, findEntry, buildCached, clearBuildCache } from '../../../src/workshop/view/kit/pieces/registry.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { MaterialClass, MaterialVariant } from '../../../src/workshop/view/kit/types.ts';
import { checkGeometry } from './helpers.ts';

const arr = (g: BufferGeometry, name: string): number[] => Array.from(g.getAttribute(name).array);

describe('surf finish channel', () => {
  it('every solid starts at finish 0; setFinish sets it, optionally where a test holds', () => {
    const g = K.roundedBox({ w: 0.3, h: 0.2, d: 0.3 });
    const s = g.getAttribute('surf');
    for (let i = 0; i < s.count; i++) expect(s.getZ(i)).toBe(0);
    K.setFinish(g, 1, (_x, y) => y > 0.1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < s.count; i++) expect(s.getZ(i)).toBe(pos.getY(i) > 0.1 ? 1 : 0);
  });
  it('finish survives deform (curvature is recomputed, finish is kept) and merge', () => {
    const g = K.setFinish(K.roundedBox({ w: 0.3, h: 0.2, d: 0.3 }), 0.8);
    K.bulge(g, 0.2, 0.05);
    const m = K.merge([K.part('steel', g), K.part('steel', K.roundedBox({ w: 0.1, h: 0.1, d: 0.1 }))])[0]!.geometry;
    const s = m.getAttribute('surf');
    expect(s.getZ(0)).toBeCloseTo(0.8, 6);
    expect(s.getZ(s.count - 1)).toBe(0);
  });
});

describe('lpos (material space)', () => {
  it('is the local position for boxes; transform, place and deform never touch it', () => {
    const g = K.roundedBox({ w: 0.6, h: 0.1, d: 0.2 });
    expect(arr(g, 'lpos')).toEqual(arr(g, 'position'));
    const before = arr(g, 'lpos');
    K.transform(g, new Matrix4().makeRotationY(1.1).setPosition(3, 2, 1));
    K.taper(g, 0, 0.1, 0.8, 0.8);
    expect(arr(g, 'lpos')).toEqual(before);
    const placed = K.place([K.part('wood', g)], K.T(5, 0, 0))[0]!.geometry;
    expect(arr(placed, 'lpos')).toEqual(before);
  });
  it('runs along the axis of a lathe and along the path of a sweep', () => {
    const l = K.lathe(K.profile(0, 0).to(0.1, 0).to(0.1, 0.5).to(0, 0.5));
    const lp = l.getAttribute('lpos'), p = l.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(lp.getX(i)).toBeCloseTo(p.getY(i), 6); // the axis is +X
      expect(Math.hypot(lp.getY(i), lp.getZ(i))).toBeCloseTo(Math.hypot(p.getX(i), p.getZ(i)), 5);
    }
    const s = K.sweep(K.polylinePath([[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]], 0.1), { radius: 0.02 });
    const sl = s.getAttribute('lpos');
    let max = 0;
    for (let i = 0; i < sl.count; i++) {
      max = Math.max(max, sl.getX(i));
      expect(Math.hypot(sl.getY(i), sl.getZ(i))).toBeLessThanOrEqual(0.0201);
    }
    expect(max).toBeCloseTo(K.pathLength(K.polylinePath([[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]], 0.1)), 4);
  });
  it('merge keeps each part’s lpos', () => {
    const a = K.part('wood', K.roundedBox({ w: 0.6, h: 0.1, d: 0.2 }));
    const b = K.place([K.part('wood', K.roundedBox({ w: 0.6, h: 0.1, d: 0.2 }))], K.Rdeg(0, 90, 0))[0]!;
    const m = K.merge([a, b])[0]!.geometry;
    expect(arr(m, 'lpos')).toEqual([...arr(a.geometry, 'lpos'), ...arr(b.geometry, 'lpos')]);
  });
  it('grain re-aims it', () => {
    const g = K.grain(K.roundedBox({ w: 0.1, h: 0.1, d: 0.8 }), 'z');
    const lp = g.getAttribute('lpos'), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(lp.getX(i)).toBe(p.getZ(i));
  });
  it('the piece builder offsets each part along +X only, deterministically from the piece seed', () => {
    const make = (seed: number) => {
      const b = K.piece('offsets', { seed, ao: false });
      b.add(K.hexBolt({ seed: 1 }), K.hexBolt({ seed: 1 }));
      return b.build();
    };
    const ref = K.hexBolt({ seed: 1 })[0]!.geometry;
    const p1 = make(4), p2 = make(4), p3 = make(5);
    const g1 = p1.root.parts[0]!.geometry, g2 = p2.root.parts[0]!.geometry, g3 = p3.root.parts[0]!.geometry;
    expect(arr(g1, 'lpos')).toEqual(arr(g2, 'lpos'));
    expect(arr(g1, 'lpos')).not.toEqual(arr(g3, 'lpos'));
    const n = ref.getAttribute('lpos').count;
    const l1 = g1.getAttribute('lpos'), lr = ref.getAttribute('lpos');
    // the two identical bolts (merged one after the other) got different offsets, along x only
    const dxA = l1.getX(0) - lr.getX(0);
    let dxB = NaN;
    // find the second copy of the head: same layout, so its first vertex is at a known offset in the merge
    const headCount = n;
    const washerless = K.hexBolt({ seed: 1 }).length;
    expect(washerless).toBe(1);
    dxB = l1.getX(headCount) - lr.getX(0);
    expect(Math.abs(dxA - dxB)).toBeGreaterThan(1e-3);
    for (let i = 0; i < n; i++) {
      expect(l1.getY(i)).toBe(lr.getY(i));
      expect(l1.getZ(i)).toBe(lr.getZ(i));
      expect(l1.getX(i) - lr.getX(i)).toBeCloseTo(dxA, 4);
    }
    expect(dxA).toBeGreaterThanOrEqual(0);
    expect(dxA).toBeLessThan(K.LPOS_OFFSET);
  });
});

describe('variants', () => {
  it('merge keeps variants apart and realize asks the materials for of(material, variant)', () => {
    const asked: Array<[MaterialClass, MaterialVariant | undefined]> = [];
    const mats: Materials = {
      of: (c, v) => { asked.push([c, v]); return new MeshBasicMaterial(); },
      textured: () => new MeshBasicMaterial(),
      update() {},
      dispose() {},
    };
    const b = K.piece('v', { ao: false });
    b.add(K.part('wood', K.roundedBox({ w: 1, h: 0.1, d: 1 })), K.large([K.part('wood', K.roundedBox({ w: 4, h: 0.1, d: 2 }))]));
    const pc = b.build();
    expect(pc.root.parts.map((q) => q.variant)).toEqual([undefined, 'large']);
    const o = K.realize(pc, mats, { shadowProxy: false });
    const meshes: Mesh[] = [];
    o.traverse((x: Object3D) => { if ((x as Mesh).isMesh) meshes.push(x as Mesh); });
    expect(meshes.length).toBe(2);
    expect(asked).toEqual([['wood', undefined], ['wood', 'large']]);
  });
});

describe('belt', () => {
  it('beltLoop carries uv.x along the loop in world units', () => {
    const span = 1.2, r = 0.06;
    const parts = K.beltLoop({ span, r, width: 0.3 });
    expect(parts[0]!.material).toBe('belt');
    const g = parts[0]!.geometry;
    checkGeometry(g);
    const uv = g.getAttribute('uv');
    let max = 0;
    for (let i = 0; i < uv.count; i++) max = Math.max(max, uv.getX(i));
    expect(max).toBeCloseTo(2 * span + 2 * Math.PI * r, 1);
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < uv.count; i++) { vmin = Math.min(vmin, uv.getY(i)); vmax = Math.max(vmax, uv.getY(i)); }
    expect(vmax - vmin).toBeCloseTo(0.3, 2);
  });
});

describe('cavity bake memo', () => {
  it('an identical piece is baked once (a hit costs a hash), with identical results', () => {
    const build = () => {
      const b = K.piece('memo', { seed: 3 });
      b.add(K.part('steel', K.slab({ w: 0.4, d: 0.4, t: 0.04 })), K.place(K.hexBolt({ af: 0.06, seed: 9 }), K.T(0, 0.04, 0)));
      return b.build();
    };
    const a = build();
    const hits = bakeStats.cacheHits;
    const b = build();
    expect(bakeStats.cacheHits).toBe(hits + 1);
    expect(arr(a.root.parts[1]!.geometry, 'surf')).toEqual(arr(b.root.parts[1]!.geometry, 'surf'));
  });
});

describe('piece registry', () => {
  it('discovers piece folders without a shared list, and builds through a memo', async () => {
    expect(pieceFolders()).toContain('test-block');
    const all = await loadCatalogue();
    expect(all.map((e) => e.name)).toContain('test-block');
    const e = (await findEntry('test-block'))!;
    expect(e.variants).toBeDefined();
    clearBuildCache();
    const p1 = buildCached(e, { seed: 7, detail: 'low' });
    const p2 = buildCached(e, { detail: 'low', seed: 7 });
    expect(p2).toBe(p1);
    expect(buildCached(e, { seed: 8, detail: 'low' })).not.toBe(p1);
    expect(p1.name).toBe('test-block');
  });
});
