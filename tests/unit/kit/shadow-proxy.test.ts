// Shadow proxies (kit/realize.ts, H1): one position-only caster per piece, on SHADOW_LAYER,
// small detail cut, welded; the visible meshes cast nothing; posing moves the proxy with the bones.
import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Mesh, Object3D, SkinnedMesh } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { cluster, cullAway, detailMask, FIXED_SHADOW, principalFrame, shadowTriangles, SHADOW_LAYER, SHADOW_WELD } from '../../../src/workshop/view/kit/realize.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import { catalogue as crateCat, repaint } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
import { catalogue as porterCat } from '../../../src/workshop/view/kit/pieces/fetch-porter/index.ts';

const stub: Materials = {
  of: () => new MeshBasicMaterial(),
  textured: (_c, key) => {
    const m = new MeshBasicMaterial();
    if (key.startsWith('stencil')) m.transparent = true;
    return m;
  },
  update() {},
  dispose() {},
};

const meshes = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) out.push(x as Mesh);
  });
  return out;
};
const proxies = (o: Object3D): Mesh[] => meshes(o).filter((m) => m.userData['shadowProxy']);

describe('shadow proxies', () => {
  it('a rig casts through one skinned proxy on the shadow layer; its visible meshes cast nothing', () => {
    const o = K.realize(porterCat[0]!.build(), stub);
    const px = proxies(o);
    expect(px.length).toBe(1);
    const p = px[0] as SkinnedMesh;
    expect(p.isSkinnedMesh).toBe(true);
    expect(p.castShadow).toBe(true);
    expect(p.receiveShadow).toBe(false);
    expect(p.layers.mask).toBe(1 << SHADOW_LAYER);
    expect(Object.keys(p.geometry.attributes).sort()).toEqual(['position', 'skinIndex', 'skinWeight']);
    for (const m of meshes(o)) if (m !== p) expect(m.castShadow, m.name).toBe(false);
    expect(K.drawStats(o).casting).toBe(1);
    // the same skeleton as the visible meshes
    const vis = meshes(o).find((m) => !m.userData['shadowProxy']) as SkinnedMesh;
    expect(p.skeleton).toBe(vis.skeleton);
  });

  it('posing moves the proxy with the bones: every proxy vertex stays near the posed visible surface', () => {
    const piece = crateCat[0]!.build({ size: 'M' });
    const o = K.realize(piece, stub);
    const lid = o.getObjectByName('lid')!;
    lid.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -1.1));
    o.updateMatrixWorld(true);
    const p = proxies(o)[0] as SkinnedMesh;
    const vis: Vector3[] = [];
    for (const m of meshes(o)) {
      if (m === p) continue;
      const s = m as SkinnedMesh;
      for (let i = 0; i < s.geometry.getAttribute('position').count; i++) vis.push(s.getVertexPosition(i, new Vector3()));
    }
    const v = new Vector3();
    const n = p.geometry.getAttribute('position').count;
    let worst = 0;
    for (let i = 0; i < n; i += 3) {
      p.getVertexPosition(i, v);
      let best = Infinity;
      for (const w of vis) best = Math.min(best, w.distanceToSquared(v));
      worst = Math.max(worst, Math.sqrt(best));
    }
    // a welded vertex is the mean of its cell's vertices: within a cell diagonal of one of them
    expect(worst).toBeLessThan(SHADOW_WELD * Math.sqrt(3) + 1e-6);
  });

  it('small detail does not cast, big shapes do; a lone single-part piece casts for itself', () => {
    const b = K.piece('d', { ao: false });
    b.add(K.part('steel', K.roundedBox({ w: 0.5, h: 0.3, d: 0.4 })), K.part('brass', K.stud(0.02, 0.01)));
    const o = K.realize(b.build(), stub, { shadowWeld: 0 });
    const px = proxies(o);
    expect(px.length).toBe(1);
    const box = K.roundedBox({ w: 0.5, h: 0.3, d: 0.4 });
    const boxTris = (box.index ? box.index.count : box.getAttribute('position').count) / 3;
    expect(shadowTriangles(o)).toBe(boxTris);
    // one casting part, nothing cut: no proxy, the mesh casts (the cord re-shapes its own geometry)
    const lone = K.realize(K.piece('l', { ao: false }).add(K.part('rubber', K.roundedBox({ w: 1, h: 0.2, d: 0.2 }))).build(), stub);
    expect(proxies(lone).length).toBe(0);
    expect(meshes(lone)[0]!.castShadow).toBe(true);
    // everything small: nothing casts at all
    const tiny = K.realize(K.piece('t', { ao: false }).add(K.part('brass', K.stud(0.02, 0.01)), K.part('steel', K.stud(0.02, 0.01))).build(), stub);
    expect(shadowTriangles(tiny)).toBe(0);
  });

  it('bulbs, blended decals and castShadow:false parts stay out of the proxy', () => {
    const b = K.piece('c', { ao: false });
    b.add(K.part('steel', K.roundedBox({ w: 0.4, h: 0.4, d: 0.4 })), K.noShadow([K.part('steel', K.roundedBox({ w: 0.4, h: 0.4, d: 0.4 }))]));
    b.node('lamp', K.T(0, 0.5, 0)).add(K.part('bulb', K.ellipsoid({ rx: 0.2, ry: 0.2, rz: 0.2 })), K.texturedPart('paper', K.sheet({ w: 0.3, h: 0.3 }), 'stencil|A'));
    const p = b.build();
    const box = K.roundedBox({ w: 0.4, h: 0.4, d: 0.4 });
    const boxTris = (box.index ? box.index.count : box.getAttribute('position').count) / 3;
    // one casting part in a rig with nothing cut: it casts for itself, exactly as before
    const o = K.realize(p, stub, { shadowWeld: 0 });
    expect(shadowTriangles(o)).toBe(boxTris);
    expect(proxies(o).length).toBe(0);
  });

  it('proxies off: every visible mesh casts for itself, as before', () => {
    const o = K.realize(porterCat[0]!.build(), stub, { shadowProxy: false });
    expect(proxies(o).length).toBe(0);
    expect(K.drawStats(o).casting).toBeGreaterThan(1);
  });

  it('a crate repaints with its proxy present', () => {
    const p = crateCat[0]!.build({ size: 'S' });
    const withProxy = repaint(K.realize(p, stub), 'paint-blue');
    const without = repaint(K.realize(p, stub, { shadowProxy: false }), 'paint-blue');
    expect(withProxy).toBeGreaterThan(0);
    expect(withProxy).toBe(without);
  });

  it('the proxy costs fewer shadow triangles than the meshes it stands for', () => {
    for (const p of [porterCat[0]!.build(), crateCat[0]!.build({ size: 'L' })]) {
      const before = shadowTriangles(K.realize(p, stub, { shadowProxy: false }));
      const after = shadowTriangles(K.realize(p, stub));
      expect(after).toBeLessThan(before * 0.8);
    }
  });
});

describe('detailMask and cluster', () => {
  it('detailMask drops lumps smaller than the cut on every axis, welded by position', () => {
    const g = K.roundedBox({ w: 0.03, h: 0.03, d: 0.03 });
    expect([...detailMask(g, 0.045)].every((k) => k === 0)).toBe(true);
    expect([...detailMask(g, 0.02)].every((k) => k === 1)).toBe(true);
  });

  it('cluster drops collapsed and repeated triangles and keeps big ones', () => {
    const pos = [
      // a big triangle
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      // a sliver inside one cell
      0.5, 0.5, 0.5, 0.501, 0.5, 0.5, 0.5, 0.501, 0.5,
      // the big triangle again, starting at another vertex
      1, 0, 0, 0, 1, 0, 0, 0, 0,
    ];
    const r = cluster(pos, [0, 0, 0, 0, 0, 0, 0, 0, 0], 0.1);
    expect(r.pos.length).toBe(9);
    // different bones never weld together
    const r2 = cluster([0, 0, 0, 0.001, 0, 0, 0, 1, 0], [0, 1, 0], 0.1);
    expect(r2.pos.length).toBe(9);
  });
});

describe('fixedView', () => {
  it('a box keeps every face a fixed-pitch camera can see the front of, and loses its back and bottom', () => {
    const g = K.roundedBox({ w: 1, h: 1, d: 1, r: 0.001, segs: 1 });
    const out = cullAway(g);
    const normals = (geo: typeof g): Vector3[] => {
      const p = geo.getAttribute('position');
      const idx = geo.index!;
      const r: Vector3[] = [];
      for (let t = 0; t < idx.count / 3; t++) {
        const a = new Vector3().fromBufferAttribute(p, idx.getX(t * 3));
        const b = new Vector3().fromBufferAttribute(p, idx.getX(t * 3 + 1)).sub(a);
        const c = new Vector3().fromBufferAttribute(p, idx.getX(t * 3 + 2)).sub(a);
        const n = b.cross(c);
        if (n.length() > 1e-9) r.push(n.normalize());
      }
      return r;
    };
    const kept = normals(out);
    expect(kept.length).toBeLessThan(normals(g).length);
    expect(kept.some((n) => n.y > 0.99)).toBe(true); // top
    expect(kept.some((n) => n.z > 0.99)).toBe(true); // front
    expect(kept.some((n) => n.x > 0.99)).toBe(true); // a side (seen from a panned camera)
    expect(kept.some((n) => n.z < -0.99)).toBe(false); // back
    expect(kept.some((n) => n.y < -0.99)).toBe(false); // bottom
  });

  it('applies to single-node pieces only; its proxy drops what the light faces from everywhere, ground-level undersides and what is below the bench', () => {
    const b = K.piece('f', { ao: false });
    b.add(K.part('steel', K.roundedBox({ w: 1, h: 1, d: 1 })), K.place([K.part('wood', K.roundedBox({ w: 2, h: 0.2, d: 2 }))], { at: [0, -1, 0] }));
    const p = b.build();
    const full = shadowTriangles(K.realize(p, stub, { shadowWeld: 0, shadowDetail: 0 }));
    const o = K.realize(p, stub, { fixedView: true, shadowWeld: 0, shadowDetail: 0 });
    const fixed = shadowTriangles(o);
    expect(fixed).toBeLessThan(full);
    expect(fixed).toBeGreaterThan(0);
    const pos = proxies(o)[0]!.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeGreaterThan(FIXED_SHADOW.below - 0.5);
    const visible = meshes(o).filter((m) => !m.userData['shadowProxy']).reduce((n, m) => n + m.geometry.index!.count / 3, 0);
    expect(visible).toBeLessThan(p.triangles);
  });
});

describe("a part's shadow mode", () => {
  const base = (): K.KitPart => K.part('steel', K.roundedBox({ w: 1, h: 0.5, d: 0.5 }));
  const knob = (): K.KitPart => K.part('brass', K.ellipsoid({ rx: 0.3, ry: 0.3, rz: 0.3 }));
  const tris = (g: { index: { count: number } | null; getAttribute(n: string): { count: number } }): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  it("'none' casts nothing and 'hull' casts a hull of fewer triangles", () => {
    const plain = K.realize(K.piece('a', { ao: false }).add(base(), knob()).build(), stub, { shadowWeld: 0 });
    const none = K.realize(K.piece('b', { ao: false }).add(base(), { ...knob(), shadow: 'none' }).build(), stub, { shadowWeld: 0 });
    const hull = K.realize(K.piece('c', { ao: false }).add(base(), { ...knob(), shadow: 'hull' }).build(), stub, { shadowWeld: 0 });
    // one casting part left: it casts for itself
    expect(shadowTriangles(none)).toBe(tris(base().geometry));
    expect(shadowTriangles(hull)).toBeLessThanOrEqual(shadowTriangles(plain));
    expect(shadowTriangles(hull)).toBeGreaterThan(tris(base().geometry));
  });
  it('a merged part keeps where its hull and none spans went', () => {
    const merged = K.merge([base(), { ...knob(), shadow: 'hull' }, { ...K.part('steel', K.roundedBox({ w: 0.3, h: 0.3, d: 0.3 })), shadow: 'none' }]);
    const steel = merged.find((q) => q.material === 'steel')!;
    expect((steel.geometry.userData['shadowSpans'] as Array<{ mode: string }>).map((sp) => sp.mode)).toEqual(['none']);
    const brass = merged.find((q) => q.material === 'brass')!;
    expect((brass.geometry.userData['shadowSpans'] as Array<{ mode: string }>).map((sp) => sp.mode)).toEqual(['hull']);
  });
  it('principalFrame finds a diagonal rod thin', () => {
    const pts: number[] = [];
    const u = new Vector3(1, -1, 0).normalize(), w = new Vector3(1, 1, -2).normalize();
    for (let i = 0; i <= 40; i++) for (let k = 0; k < 8; k++) {
      const t = i / 40, a = (k / 8) * Math.PI * 2;
      const p = new Vector3(t, t, t).addScaledVector(u, 0.01 * Math.cos(a)).addScaledVector(w, 0.01 * Math.sin(a));
      pts.push(p.x, p.y, p.z);
    }
    const f = principalFrame(pts, Array.from({ length: pts.length / 3 }, (_, i) => i));
    expect(Math.min(...f.extent)).toBeLessThan(0.025);
    expect(Math.max(...f.extent)).toBeGreaterThan(1.7);
  });
});
