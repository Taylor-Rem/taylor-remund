// Brief W5: the crate takes paint with a wipe (no triangle, no draw call added) and carries label tape.
import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, type Material, type Mesh, type Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { crate, crateLook, crateTape, paintCrate, repaint } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
import { paints } from '../../../src/workshop/view/palette.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';

const stub: Materials = { of: () => new MeshBasicMaterial() as Material, textured: () => new MeshBasicMaterial() as Material, update() {}, dispose() {} };

const meshes = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) out.push(x as Mesh);
  });
  return out;
};
const tris = (o: Object3D): number => meshes(o).filter((m) => m.name !== 'shadow.proxy').reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);

describe('crate paint and tape (W5)', () => {
  it('a tape adds one quad and no mesh when it shares the stencils\' material class', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      const a = crate({ size, seed: 4 });
      const b = crate({ size, seed: 4, tape: 'k' });
      expect(K.countTriangles(b) - K.countTriangles(a)).toBe(2);
      expect(K.countTriangles(b)).toBeLessThanOrEqual(1000);
    }
  });

  it('mid-wipe the paint is part on, part off; at the ends it is settled', () => {
    const o = K.realize(crate({ size: 'M', seed: 2 }), stub);
    expect(crateLook(o, paints).paint).toBeNull();
    paintCrate(o, { from: null, to: 'paint-blue', t: 0.5 });
    expect(crateLook(o, paints).paint).toBe('mixed');
    paintCrate(o, { from: null, to: 'paint-blue', t: 1 });
    expect(crateLook(o, paints).paint).toBe('paint-blue');
    paintCrate(o, { from: 'paint-blue', to: 'cable-red', t: 0.4 });
    expect(crateLook(o, paints).paint).toBe('mixed');
    paintCrate(o, { from: 'paint-blue', to: 'cable-red', t: 0 });
    expect(crateLook(o, paints).paint).toBe('paint-blue');
    repaint(o, null);
    expect(crateLook(o, paints).paint).toBeNull();
    expect(tris(o)).toBe(tris(K.realize(crate({ size: 'M', seed: 2 }), stub)));
  });

  it('the tape is hidden, laid part way and whole; a crate without one says so', () => {
    const o = K.realize(crate({ size: 'S', seed: 2, tape: 'k' }), stub);
    expect(crateTape(o, 0)).toBe(true);
    expect(crateLook(o, paints).tape).toBe(0);
    crateTape(o, 0.4);
    expect(crateLook(o, paints).tape).toBeCloseTo(0.4, 2);
    crateTape(o, 1);
    expect(crateLook(o, paints).tape).toBe(1);
    const bare = K.realize(crate({ size: 'S', seed: 2 }), stub);
    expect(crateTape(bare, 1)).toBe(false);
    expect(crateLook(bare, paints).tape).toBeNull();
  });
});
