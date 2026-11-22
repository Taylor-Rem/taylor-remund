// The paint dial (D2): a fan of enamel chips, one per scheme, and a brass knob. Small, two draw calls, its chips in
// the schemes' own colours, its needle on the scheme asked for.
import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Vector3, type Material, type Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue, paintDial, paintDialAngle, PAINT_DIAL } from '../../../src/workshop/view/kit/pieces/paint-dial/index.ts';
import { crateSpec } from '../../../src/workshop/view/kit/pieces/crate/index.ts';
import { SCHEME_IDS, slotColour } from '../../../src/workshop/view/materials/scheme.ts';
import { checkGeometry } from './helpers.ts';

const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

function find(n: PieceNode, name: string): PieceNode | undefined {
  if (n.name === name) return n;
  for (const c of n.children ?? []) {
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

describe('the paint dial', () => {
  const p = paintDial();

  it('stays inside its budget: 1,200 triangles, two materials (two draw calls)', () => {
    expect(p.triangles).toBeLessThanOrEqual(1200);
    const classes = new Set<string>();
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) classes.add(q.material);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
    expect([...classes].sort()).toEqual(['brass', 'steel']);
    const o: Object3D = K.realize(p, stub);
    let meshes = 0;
    // drawn by the camera (layer 0); the shadow proxy is on its own layer and only casts
    o.traverse((c) => { if ((c as Mesh).isMesh && c.layers.isEnabled(0)) meshes++; });
    expect(meshes).toBeLessThanOrEqual(2);
  });

  it('is sound geometry, deterministic in its seed', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
    const a = paintDial({ seed: 3 }), b = paintDial({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    expect(a.root.parts[0]!.geometry.getAttribute('position').array).toEqual(b.root.parts[0]!.geometry.getAttribute('position').array);
  });

  it('fits on the tray of the smallest crate', () => {
    expect(p.size.x).toBeLessThan(crateSpec('S').w * 0.6);
    expect(p.size.z).toBeLessThan(crateSpec('S').d * 0.5);
    expect(p.size.y).toBeLessThan(0.08);
  });

  it('wears every scheme as a chip: its enamel, and its trim at the tip', () => {
    const seen = new Set<string>();
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) {
        if (q.material !== 'steel') continue;
        const c = q.geometry.getAttribute('color');
        for (let i = 0; i < c.count; i++) seen.add(`${c.getX(i).toFixed(5)},${c.getY(i).toFixed(5)},${c.getZ(i).toFixed(5)}`);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
    for (const id of SCHEME_IDS) {
      for (const slot of ['teal-panel', 'teal-light'] as const) {
        const c = slotColour(id, slot);
        expect(seen.has(c.map((x) => x.toFixed(5)).join(','))).toBe(true);
      }
    }
  });

  it('turns its knob to point at the scheme asked for, about its own +Y', () => {
    expect(SCHEME_IDS.map((id) => paintDialAngle(id))).toEqual(PAINT_DIAL.spread.map((d) => (d * Math.PI) / 180));
    expect(paintDialAngle(1.5)).toBeCloseTo(((PAINT_DIAL.spread[1]! + PAINT_DIAL.spread[2]!) / 2) * (Math.PI / 180), 9);
    const knob = find(paintDial({ scheme: 'C' }).root, 'knob')!;
    expect(knob).toBeDefined();
    // the needle points along +Z turned by the angle
    const dir = new Vector3(0, 0, 1).transformDirection(knob.transform!);
    expect(Math.atan2(dir.x, dir.z)).toBeCloseTo(paintDialAngle('C'), 6);
    expect(p.sockets?.['grip']).toBeDefined();
  });

  it('is registered with a variant per scheme', () => {
    expect(catalogue[0]!.name).toBe('paint-dial');
    for (const id of SCHEME_IDS) expect(catalogue[0]!.variants?.[id]).toBeDefined();
  });
});
