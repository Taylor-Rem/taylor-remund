import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial } from 'three';
import type { BufferGeometry, Mesh, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import { testBlock } from '../../../src/workshop/view/kit/pieces/test-block/index.ts';
import { checkGeometry } from './helpers.ts';

const wearOf = (g: BufferGeometry): number[] => Array.from(g.getAttribute('surf').array).filter((_, i) => i % 3 === 0);

describe('cheap solids (promoted from the crate and the Button)', () => {
  it('every one is clean kit geometry (position, normal, colour, surf vec3, lpos)', () => {
    const r = K.rng(1);
    const all: Array<BufferGeometry | null> = [
      K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006 }),
      K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006, band: 0.02, omit: ['ny'] }),
      K.innerBox([0, 0, 0], [0.4, 0.3, 0.4]),
      K.skin(0, 0.3, 0, 0.2, 14, 0.01, r),
      K.decalBands(0, 0.3, 0, 0.3, [[0, 0.12], [0.13, 0.3]]),
      K.stud(0.02, 0.012),
      K.sheet({ w: 0.2, h: 0.05, lift: (u) => Math.max(0, u - 0.8) * 0.1 }),
      K.sheet({ w: 0.2, h: 0.05, back: true }),
      K.cylinderRibbons(K.DIGIT_STROKES[8]!.map((s) => s.map(([x, y]) => [y * 0.05, x * 0.05] as const)), { r: 0.04, width: 0.006 }),
      K.ridgedBand(0.05, 0.03, 20, 0.004),
      K.hexHead(0.06, 0.025),
    ];
    for (const g of all) checkGeometry(g!);
  });

  it('bevelBox: 44 triangles whole; omitted faces drop out; the chamfer band is worn; the band ring adds 8 a face', () => {
    const whole = K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006 });
    expect(K.triangleCount(whole)).toBe(44);
    const open = K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006, omit: ['ny', 'nz'] });
    expect(K.triangleCount(open)).toBeLessThan(44);
    expect(Math.max(...wearOf(whole))).toBeCloseTo(0.75, 6);
    const banded = K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006, band: 0.02 });
    expect(K.triangleCount(banded)).toBe(44 + 6 * 8);
    // on the top face: the face's edge carries some wear, its centre none
    const p = banded.getAttribute('position'), n = banded.getAttribute('normal'), s = banded.getAttribute('surf');
    let edge = 0, centre = 1;
    for (let i = 0; i < p.count; i++) {
      if (n.getY(i) < 0.999 || Math.abs(p.getY(i) - 0.04) > 1e-6) continue;
      const inX = Math.min(p.getX(i), 0.6 - p.getX(i)), inZ = Math.min(p.getZ(i), 0.1 - p.getZ(i));
      if (Math.min(inX, inZ) < 0.0065 && s.getX(i) < 0.7) edge = Math.max(edge, s.getX(i));
      if (Math.min(inX, inZ) > 0.02) centre = Math.min(centre, s.getX(i));
    }
    expect(edge).toBeGreaterThan(0.3);
    expect(centre).toBe(0);
  });

  it('the detailed parts switch to their cheap twins', () => {
    expect(K.triangleCount(K.hexBolt({ cheap: true })[0]!.geometry)).toBe(30);
    expect(K.triangleCount(K.domeRivet({ cheap: true })[0]!.geometry)).toBe(18);
    expect(K.triangleCount(K.knurledBand({ cheap: true, ridges: 20 })[0]!.geometry)).toBe(80);
    expect(K.triangleCount(K.hexBolt({ cheap: true })[0]!.geometry)).toBeLessThan(K.triangleCount(K.hexBolt({})[0]!.geometry));
  });

  it('turned cheap parts put their axis on +X in lpos', () => {
    const g = K.hexHead(0.06, 0.025);
    const p = g.getAttribute('position'), l = g.getAttribute('lpos');
    for (let i = 0; i < p.count; i++) expect(l.getX(i)).toBe(p.getY(i));
  });

  it('stripes clip to the rectangle', () => {
    const polys = K.stripes(0.2, 0.1, 0.04, 0.08);
    expect(polys.length).toBeGreaterThan(3);
    for (const poly of polys) for (const [x, y] of poly) {
      expect(Math.abs(x)).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });
});

describe('deform keeps the wear signal', () => {
  it('a dent keeps the wear band away from the dent (no keepSurf needed) and the finish', () => {
    const make = () => K.setFinish(K.roundedBox({ w: 0.8, h: 0.3, d: 0.5, r: 0.03 }), 0.5);
    const ref = make();
    const g = make();
    K.dent(g, [-0.3, 0.3, 0.25], [0, 1, 1], 0.06, 0.01);
    const p = g.getAttribute('position'), s = g.getAttribute('surf'), rs = ref.getAttribute('surf');
    let far = 0, onFace = 0;
    for (let i = 0; i < p.count; i++) {
      expect(s.getZ(i)).toBeCloseTo(0.5, 6);
      if (Math.hypot(p.getX(i) + 0.3, p.getY(i) - 0.3, p.getZ(i) - 0.25) < 0.25) continue;
      far++;
      expect(s.getX(i)).toBeCloseTo(rs.getX(i), 5);
      if (s.getX(i) > 0.05 && Math.abs(p.getY(i) - 0.3) < 1e-6) onFace++;
    }
    expect(far).toBeGreaterThan(10);
    expect(onFace).toBeGreaterThan(0); // the band still reaches onto the top face
  });
  it('wear written by intent (cheap solids) survives deform untouched', () => {
    const g = K.bevelBox({ min: [0, 0, 0], max: [0.6, 0.04, 0.1], c: 0.006 });
    const before = wearOf(g);
    K.deform(g, (x, y, z) => [x, y + 0.01 * Math.sin(x * 10), z]);
    expect(wearOf(g)).toEqual(before);
  });
});

describe('realize: sprayed decals cast no shadow', () => {
  it('a blended textured part receives but does not cast; a cut label and an opaque part cast', () => {
    const mats: Materials = {
      of: () => new MeshBasicMaterial(),
      textured: (_c, key) => {
        const m = new MeshBasicMaterial();
        if (key.startsWith('stencil')) { m.transparent = true; m.depthWrite = false; }
        else m.alphaTest = 0.5;
        return m;
      },
      update() {},
      dispose() {},
    };
    const b = K.piece('decals', { ao: false });
    b.add(
      K.part('wood', K.roundedBox({ w: 0.4, h: 0.4, d: 0.4 })),
      K.texturedPart('paper', K.sheet({ w: 0.2, h: 0.1 }), 'stencil|M'),
      K.texturedPart('tape', K.sheet({ w: 0.2, h: 0.05 }), 'tape|DO NOT TOUCH'),
    );
    const o = K.realize(b.build(), mats);
    const meshes: Mesh[] = [];
    o.traverse((x: Object3D) => { if ((x as Mesh).isMesh) meshes.push(x as Mesh); });
    const byMat = (m: string): Mesh => meshes.find((x) => x.userData['kitMaterial'] === m)!;
    expect(byMat('paper').castShadow).toBe(false);
    expect(byMat('paper').receiveShadow).toBe(true);
    expect(byMat('tape').castShadow).toBe(true);
    expect(byMat('wood').castShadow).toBe(true);
  });
});

describe('budget', () => {
  it('splits a piece’s triangles by node and by material, and checks a cap', () => {
    const tb = testBlock({ seed: 1, detail: 'low' });
    const bd = K.budget(tb, 6000);
    expect(bd.total).toBe(tb.triangles);
    expect(Object.values(bd.byNode).reduce((a, b) => a + b, 0)).toBe(tb.triangles);
    expect(Object.values(bd.byMaterial).reduce((a, b) => a + (b ?? 0), 0)).toBe(tb.triangles);
    expect(Object.keys(bd.byNode)).toEqual(expect.arrayContaining(['root', 'root/hatch', 'root/knob']));
    expect(bd.rows[0]!.triangles).toBeGreaterThanOrEqual(bd.rows[bd.rows.length - 1]!.triangles);
    expect(bd.fits).toBe(true);
    expect(K.budget(tb, 100).fits).toBe(false);
    expect(bd.text).toContain('test-block');
  });
});
