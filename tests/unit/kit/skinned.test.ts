import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Material, Mesh, Object3D, SkinnedMesh } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue as porterCat } from '../../../src/workshop/view/kit/pieces/fetch-porter/index.ts';
import { catalogue as buttonCat } from '../../../src/workshop/view/kit/pieces/button/index.ts';
import { catalogue as crateCat } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
import { catalogue as beltCat } from '../../../src/workshop/view/kit/pieces/belt/index.ts';

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

/** Every node's local transform in a piece, by name. */
function nodeTransforms(p: Piece): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, (n.transform ?? new Matrix4()).clone());
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

/** Pose a realised object by setting its named nodes' local transforms (what every pose helper does). */
function applyPose(o: Object3D, pose: Map<string, Matrix4>): void {
  for (const [name, m] of pose) {
    if (name === 'root') continue;
    const x = o.getObjectByName(name);
    if (x) m.decompose(x.position, x.quaternion, x.scale);
  }
  o.updateMatrixWorld(true);
}

/** A seeded arbitrary pose: every non-root node turned and nudged from its rest. */
function wildPose(p: Piece, seed: number): Map<string, Matrix4> {
  const r = K.rng(seed);
  const out = new Map<string, Matrix4>();
  for (const [name, m] of nodeTransforms(p)) {
    if (name === 'root') continue;
    const q = new Quaternion().setFromAxisAngle(new Vector3(r.spread(1), r.spread(1), r.spread(1)).normalize(), r.spread(0.8));
    out.set(name, m.clone().multiply(new Matrix4().compose(new Vector3(r.spread(0.05), r.spread(0.05), r.spread(0.05)), q, new Vector3(1, 1, 1))));
  }
  return out;
}

/** World positions of every source part's vertices, keyed by source geometry and node. */
function worldVerts(o: Object3D): Map<string, Map<BufferGeometry, Float32Array>> {
  o.updateMatrixWorld(true);
  const out = new Map<string, Map<BufferGeometry, Float32Array>>();
  const v = new Vector3();
  o.traverse((x) => {
    const m = x as Mesh;
    if (!m.isMesh) return;
    const skinned = (m as SkinnedMesh).isSkinnedMesh;
    for (const s of K.sourcesOf(m)) {
      const a = new Float32Array(s.count * 3);
      for (let i = 0; i < s.count; i++) {
        if (skinned) (m as SkinnedMesh).getVertexPosition(s.start + i, v);
        else v.fromBufferAttribute(m.geometry.getAttribute('position'), s.start + i);
        v.applyMatrix4(m.matrixWorld);
        a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z;
      }
      const byNode = out.get(s.node) ?? new Map<BufferGeometry, Float32Array>();
      byNode.set(s.source, a);
      out.set(s.node, byNode);
    }
  });
  return out;
}

function compare(p: Piece, pose: Map<string, Matrix4> | null, place?: Matrix4): number {
  const a = K.realize(p, stub, { backend: 'nodes' });
  const b = K.realize(p, stub, { backend: 'skinned' });
  for (const o of [a, b]) {
    if (place) place.decompose(o.position, o.quaternion, o.scale);
    if (pose) applyPose(o, pose);
    o.updateMatrixWorld(true);
  }
  const wa = worldVerts(a), wb = worldVerts(b);
  let worst = 0, n = 0;
  for (const [node, parts] of wa) {
    for (const [src, va] of parts) {
      const vb = wb.get(node)?.get(src);
      expect(vb, `${p.name}: ${node} part missing in the skinned backend`).toBeDefined();
      for (let i = 0; i < va.length; i++) worst = Math.max(worst, Math.abs(va[i]! - vb![i]!));
      n += va.length / 3;
    }
  }
  expect(n).toBeGreaterThan(0);
  return worst;
}

const pieces: Array<{ name: string; build: (o?: Record<string, unknown>) => Piece; poses: string[] }> = [
  { name: 'fetch-porter', build: (o) => porterCat[0]!.build(o ?? {}), poses: [...(porterCat[0]!.poses ?? [])] },
  { name: 'button', build: (o) => buttonCat[0]!.build(o ?? {}), poses: [...(buttonCat[0]!.poses ?? [])] },
  { name: 'crate', build: (o) => crateCat[0]!.build(o ?? {}), poses: [] },
];

describe('skinned backend = per-node backend, vertex for vertex', () => {
  for (const pc of pieces) {
    it(`${pc.name}: at rest, in every named pose and in seeded wild poses, within 1e-5`, () => {
      const rest = pc.build();
      expect(compare(rest, null)).toBeLessThan(1e-5);
      // named poses: the node transforms of the piece built in that pose, applied to the rest realisation
      for (const name of pc.poses) expect(compare(rest, nodeTransforms(pc.build({ pose: name })))).toBeLessThan(1e-5);
      // arbitrary poses, and the whole piece moved somewhere
      for (const seed of [1, 2, 3]) expect(compare(rest, wildPose(rest, seed), new Matrix4().compose(new Vector3(3, 0.5, -2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7), new Vector3(1, 1, 1)))).toBeLessThan(1e-5);
    });
  }

  it('a piece built in a pose binds in that pose (rest = bind)', () => {
    const p = pieces[1]!.build({ pose: 'pressed' });
    expect(compare(p, null)).toBeLessThan(1e-5);
  });
});

describe('skinned realisation', () => {
  it('node names resolve to bones in the same hierarchy with the same local transforms', () => {
    const p = pieces[0]!.build();
    const o = K.realize(p, stub);
    const walk = (n: PieceNode, parent: string | null): void => {
      const x = o.getObjectByName(n.name);
      expect(x, n.name).toBeDefined();
      expect((x as unknown as { isBone: boolean }).isBone).toBe(true);
      if (parent) expect(x!.parent!.name).toBe(parent);
      const m = new Matrix4().compose(x!.position, x!.quaternion, x!.scale);
      const want = n.transform ?? new Matrix4();
      for (let i = 0; i < 16; i++) expect(m.elements[i]).toBeCloseTo(want.elements[i]!, 6);
      for (const c of n.children ?? []) walk(c, n.name);
    };
    walk(p.root, null);
  });

  it('mesh counts: one per material key for a rig; single-node pieces stay plain meshes', () => {
    const counts: Record<string, [number, number]> = {};
    for (const [name, build] of [
      ['fetch-porter', () => pieces[0]!.build()],
      ['button', () => pieces[1]!.build()],
      ['crate S', () => crateCat[0]!.build({ size: 'S' })],
      ['crate M', () => crateCat[0]!.build({ size: 'M' })],
      ['crate L', () => crateCat[0]!.build({ size: 'L' })],
      ['belt', () => beltCat[0]!.build({})],
    ] as const) {
      const p = build();
      const before = K.drawStats(K.realize(p, stub, { backend: 'nodes' })).meshes;
      const after = K.drawStats(K.realize(p, stub)).meshes;
      counts[name] = [before, after];
      expect(after).toBeLessThan(before);
      expect(after).toBeLessThanOrEqual(10);
    }
    // the numbers, for the record (they print on failure)
    expect(Object.keys(counts).length).toBe(6);
    const single = K.piece('one', { ao: false }).add(K.part('wood', K.roundedBox({ w: 1, h: 1, d: 1 })), K.part('brass', K.collar()[0]!.geometry)).build();
    const o = K.realize(single, stub);
    let skinned = 0;
    o.traverse((x) => { if ((x as SkinnedMesh).isSkinnedMesh) skinned++; });
    expect(skinned).toBe(0);
    expect(K.drawStats(o).meshes).toBe(2);
  });

  it('skinned geometry is shared between realisations of one Piece, bones are not', () => {
    const p = pieces[1]!.build();
    const a = K.realize(p, stub), b = K.realize(p, stub);
    const ga: BufferGeometry[] = [], gb: BufferGeometry[] = [];
    a.traverse((x) => { if ((x as Mesh).isMesh) ga.push((x as Mesh).geometry); });
    b.traverse((x) => { if ((x as Mesh).isMesh) gb.push((x as Mesh).geometry); });
    expect(ga).toEqual(gb);
    expect(a.getObjectByName('cap')).not.toBe(b.getObjectByName('cap'));
  });

  it('all kit attributes pass through, with one bone at full weight per vertex', () => {
    const o = K.realize(pieces[1]!.build(), stub);
    o.traverse((x) => {
      const m = x as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      for (const a of ['position', 'normal', 'color', 'surf', 'lpos', 'skinIndex', 'skinWeight']) expect(m.geometry.getAttribute(a), a).toBeDefined();
      const w = m.geometry.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i += 97) {
        expect(w.getX(i)).toBeCloseTo(1, 6);
        expect(w.getY(i) + w.getZ(i) + w.getW(i)).toBe(0);
      }
    });
  });

  it('a posed rig is never culled: each skinned mesh has a conservative bounding sphere holding every posed vertex', () => {
    const p = pieces[0]!.build();
    const o = K.realize(p, stub);
    for (const seed of [4, 5]) {
      applyPose(o, wildPose(p, seed));
      o.traverse((x) => {
        const m = x as SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const s = m.boundingSphere!;
        const v = new Vector3();
        for (let i = 0; i < m.geometry.getAttribute('position').count; i += 7) {
          m.getVertexPosition(i, v);
          expect(v.distanceTo(s.center)).toBeLessThanOrEqual(s.radius + 1e-6);
        }
      });
    }
  });

  it('shadows: bulbs, blended decals and castShadow:false parts do not cast; the rest do', () => {
    const b = K.piece('casts', { ao: false });
    b.add(K.part('steel', K.roundedBox({ w: 0.4, h: 0.4, d: 0.4 })), K.noShadow([K.part('steel', K.stud(0.02, 0.01))]));
    b.node('lamp', K.T(0, 0.5, 0)).add(K.part('bulb', K.ellipsoid({ rx: 0.05, ry: 0.05, rz: 0.05 })), K.texturedPart('paper', K.sheet({ w: 0.1, h: 0.1 }), 'stencil|A'));
    const o = K.realize(b.build(), stub);
    const byName = new Map<string, Mesh>();
    o.traverse((x) => { if ((x as Mesh).isMesh) byName.set(x.name, x as Mesh); });
    expect([...byName.keys()].sort()).toEqual(['skin.bulb', 'skin.paper.stencil|A', 'skin.steel', 'skin.steel.noshadow']);
    expect(byName.get('skin.steel')!.castShadow).toBe(true);
    expect(byName.get('skin.steel.noshadow')!.castShadow).toBe(false);
    expect(byName.get('skin.steel.noshadow')!.receiveShadow).toBe(true);
    expect(byName.get('skin.bulb')!.castShadow).toBe(false);
    expect(byName.get('skin.paper.stencil|A')!.castShadow).toBe(false);
    void (null as unknown as Material);
  });

  it('budget() reports draw calls for both backends', () => {
    const p = pieces[0]!.build();
    const bd = K.budget(p);
    const real = K.drawStats(K.realize(p, stub));
    const nodes = K.drawStats(K.realize(p, stub, { backend: 'nodes' }));
    expect(bd.meshes).toBe(real.meshes);
    expect(bd.casting).toBe(real.casting);
    expect(bd.calls).toBe(real.calls);
    expect(bd.nodesCalls).toBe(nodes.calls);
    expect(bd.text).toContain('draw calls');
  });
});
