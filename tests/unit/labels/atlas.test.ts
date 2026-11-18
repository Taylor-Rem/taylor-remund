import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial, Texture } from 'three';
import type { Material, Mesh, Object3D } from 'three';
import { Atlas, blit, CELL, GUTTER, labelAtlasOf, Page, Shelves } from '../../../src/workshop/view/labels/atlas.ts';
import type { AtlasInfo } from '../../../src/workshop/view/labels/atlas.ts';
import { rng } from '../../../src/workshop/view/labels/rng.ts';
import { realize, sourcesOf } from '../../../src/workshop/view/kit/realize.ts';
import type { KitPart, Piece } from '../../../src/workshop/view/kit/types.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';

describe('rng state', () => {
  it('carries on exactly from where it stood', () => {
    const a = rng('TAYLOR');
    for (let i = 0; i < 37; i++) a();
    const b = rng(a.state());
    expect(Array.from({ length: 200 }, () => b())).toEqual(Array.from({ length: 200 }, () => a()));
  });
});

describe('atlas layout', () => {
  it('packs regions inside aligned cells, never overlapping, gutters inside the page', () => {
    const s = new Shelves(2048, 1024);
    const rs = [];
    const r = rng(3);
    for (let i = 0; i < 60; i++) {
      const got = s.alloc(20 + Math.floor(r() * 400), 10 + Math.floor(r() * 120));
      if (got) rs.push(got);
    }
    expect(rs.length).toBeGreaterThan(20);
    for (const a of rs) {
      expect((a.x - GUTTER) % CELL).toBe(0);
      expect((a.y - GUTTER) % CELL).toBe(0);
      expect(a.x - GUTTER).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w + GUTTER).toBeLessThanOrEqual(2048);
      expect(a.y + a.h + GUTTER).toBeLessThanOrEqual(1024);
      for (const b of rs) {
        if (a === b) continue;
        const apart = a.x + a.w + GUTTER <= b.x - GUTTER || b.x + b.w + GUTTER <= a.x - GUTTER || a.y + a.h + GUTTER <= b.y - GUTTER || b.y + b.h + GUTTER <= a.y - GUTTER;
        expect(apart).toBe(true);
      }
    }
    expect(s.alloc(4000, 10)).toBeNull();
  });

  it('blits rows bottom-up and repeats the edge texels into the gutter (what ClampToEdge sampled)', () => {
    const w = 3, h = 2, g = 2, dw = 16;
    // top row: 1 2 3, bottom row: 4 5 6 (R channel)
    const src = new Uint8Array(w * h * 4);
    [1, 2, 3, 4, 5, 6].forEach((v, i) => (src[i * 4] = v));
    const dst = new Uint8Array(dw * 16 * 4);
    blit(dst, dw, src, w, h, 4, 4, g);
    const at = (x: number, y: number): number => dst[(y * dw + x) * 4]!;
    // texture row 4 is the label's bottom row
    expect([at(4, 4), at(5, 4), at(6, 4)]).toEqual([4, 5, 6]);
    expect([at(4, 5), at(5, 5), at(6, 5)]).toEqual([1, 2, 3]);
    // gutters
    expect([at(2, 4), at(3, 4), at(7, 4), at(8, 4)]).toEqual([4, 4, 6, 6]);
    expect([at(4, 2), at(4, 3), at(4, 6), at(4, 7)]).toEqual([4, 4, 1, 1]);
    expect(at(2, 2)).toBe(4);
    expect(at(8, 7)).toBe(3);
    expect(at(1, 4)).toBe(0);
  });

  it('writeRows (a redrawn band) lands where draw would put the whole region', () => {
    const p = new Page('flat', 0, 1, { w: 64, h: 64 });
    const rect = p.shelves.alloc(5, 4)!;
    const rows = new Uint8Array(5 * 4 * 4);
    for (let i = 0; i < rows.length; i++) rows[i] = (i * 7) % 251;
    const whole = new Uint8Array(64 * 64 * 4);
    blit(whole, 64, rows, 5, 4, rect.x, rect.y, GUTTER);
    p.writeRows(rect, 0, rows.subarray(0, 2 * 5 * 4), 2);
    p.writeRows(rect, 2, rows.subarray(2 * 5 * 4), 2);
    expect(Buffer.from(p.color.data).equals(Buffer.from(whole))).toBe(true);
  });

  it('views share the page (one GL texture) and cut their region out by offset/repeat', () => {
    const at = new Atlas(1);
    const a = at.place('relief', 300, 100)!;
    const b = at.place('relief', 200, 120)!;
    expect(a.page).toBe(b.page);
    const va = a.page.views(a.rect);
    const vb = b.page.views(b.rect);
    expect(va.map.source).toBe(vb.map.source);
    expect(va.rough!.source).toBe(vb.rough!.source);
    expect(va.map.offset.x).toBeCloseTo(a.rect.x / 2048);
    expect(va.map.repeat.y).toBeCloseTo(100 / 2048);
    const whole = a.page.wholeViews();
    expect(whole.map.channel).toBe(1);
    expect(whole.map.repeat.x).toBe(1);
    expect(at.byKey(a.page.key('cut'))?.alpha).toBe('cut');
    expect(a.page.key('spray').startsWith('stencil')).toBe(true);
    expect(a.page.key('opaque').includes('|')).toBe(false);
    // too big for any page: no place (the label keeps a texture of its own)
    expect(at.place('relief', 3000, 10)).toBeNull();
  });
});

describe('realize merges label quads that share a page', () => {
  /** A quad in the XY plane with 0..1 uvs. */
  const quad = (x: number): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };
  const rects: Record<string, [number, number, number, number]> = {
    'tape:black|A': [0.1, 0.2, 0.3, 0.25],
    'tape:black|B': [0.5, 0.6, 0.9, 0.7],
  };
  const textured: Material[] = [];
  const stub: Materials = {
    of: () => new MeshBasicMaterial(),
    textured: (_c, key) => {
      const m = new MeshBasicMaterial();
      m.name = key;
      const map = new Texture();
      if (rects[key]) map.userData['labelAtlas'] = { page: 'atlas.relief0.cut', rect: rects[key] } satisfies AtlasInfo;
      m.map = map;
      m.alphaTest = 0.5;
      textured.push(m);
      return m;
    },
    update() {},
    dispose() {},
  };
  const part = (x: number, key: string): KitPart => ({ material: 'tape', geometry: quad(x), texture: key });
  const meshes = (o: Object3D): Mesh[] => {
    const out: Mesh[] = [];
    o.traverse((x) => {
      if ((x as Mesh).isMesh && !x.userData['shadowProxy']) out.push(x as Mesh);
    });
    return out;
  };

  it('per node: two tapes become one mesh on the page material; uv stays, uv1 is the atlas place', () => {
    const piece: Piece = { name: 'wall', root: { name: 'root', parts: [part(0, 'tape:black|A'), part(2, 'tape:black|B'), part(4, 'tape:black|C')] }, size: { x: 5, y: 1, z: 0 }, triangles: 6 };
    const o = realize(piece, stub);
    const ms = meshes(o);
    // A and B merge; C (no atlas facts) keeps its own mesh
    expect(ms.length).toBe(2);
    const merged = ms.find((m) => m.name.includes('atlas.relief0.cut'))!;
    expect((merged.material as Material).name).toBe('atlas.relief0.cut');
    const uv = merged.geometry.getAttribute('uv');
    const uv1 = merged.geometry.getAttribute('uv1');
    expect(uv.getX(2)).toBe(1);
    const src = sourcesOf(merged);
    expect(src.map((s) => s.texture)).toEqual(['tape:black|A', 'tape:black|B']);
    // vertex 2 of A: uv (1, 1) -> (0.3, 0.25); vertex 0 of B: uv (0, 0) -> (0.5, 0.6)
    expect(uv1.getX(2)).toBeCloseTo(0.3);
    expect(uv1.getY(2)).toBeCloseTo(0.25);
    expect(uv1.getX(src[1]!.start)).toBeCloseTo(0.5);
    expect(uv1.getY(src[1]!.start)).toBeCloseTo(0.6);
    expect(labelAtlasOf(textured.find((m) => m.name === 'tape:black|A')!)?.page).toBe('atlas.relief0.cut');
  });

  it('skinned: tapes on two nodes become one skinned mesh, each bound to its own bone', () => {
    const piece: Piece = {
      name: 'rig',
      root: { name: 'root', parts: [part(0, 'tape:black|A')], children: [{ name: 'lid', transform: new Matrix4().makeTranslation(0, 2, 0), parts: [part(0, 'tape:black|B')] }] },
      size: { x: 1, y: 3, z: 0 },
      triangles: 4,
    };
    const o = realize(piece, stub);
    const ms = meshes(o);
    expect(ms.length).toBe(1);
    const g = ms[0]!.geometry;
    expect(sourcesOf(ms[0]!).map((s) => [s.node, s.texture])).toEqual([
      ['root', 'tape:black|A'],
      ['lid', 'tape:black|B'],
    ]);
    const si = g.getAttribute('skinIndex');
    expect(si.getX(0)).toBe(0);
    expect(si.getX(4)).toBe(1);
    expect(g.getAttribute('uv1').getX(4)).toBeCloseTo(0.5);
  });
});
