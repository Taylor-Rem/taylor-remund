// The paint dial (D2, D2b): both candidates (the fan, the deck): two draw calls, inside 1,200 triangles, sound geometry,
// a chip per scheme on the dial in its own enamel and trim, the control posed for the chip worn.
import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Material, type Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue, deckSwing, DIAL_SCHEMES, paintDial, paintDialAngle, PAINT_DIAL, type PaintDialStyle } from '../../../src/workshop/view/kit/pieces/paint-dial/index.ts';
import { slotColour } from '../../../src/workshop/view/materials/scheme.ts';
import { PAINT_TUNING } from '../../../src/workshop/sim/machines/paint-dial.ts';
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

/** Every vertex where it is drawn. */
function extent(p: Piece): Box3 {
  const box = new Box3();
  const walk = (n: PieceNode, m: Matrix4): void => {
    const w = m.clone().multiply(n.transform ?? new Matrix4());
    for (const q of n.parts) {
      const pos = q.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) box.expandByPoint(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(w));
    }
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, new Matrix4());
  return box;
}

describe.each(['deck', 'fan'] as PaintDialStyle[])('the paint dial (%s)', (style) => {
  const p = paintDial({ style });

  it('stays inside its budget: 1,200 triangles, two materials (two draw calls)', () => {
    expect(p.triangles).toBeLessThanOrEqual(1200);
    const classes = new Set<string>();
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) classes.add(q.material);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
    expect([...classes].sort()).toEqual(['brass', 'paper']);
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
    const a = paintDial({ style, seed: 3 }), b = paintDial({ style, seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    expect(a.root.parts[0]!.geometry.getAttribute('position').array).toEqual(b.root.parts[0]!.geometry.getAttribute('position').array);
  });

  it('rests on the bench, a hand-sized thing (wider than a crate\'s tray is deep, smaller than a small crate)', () => {
    for (let at = 0; at < DIAL_SCHEMES.length; at++) {
      const box = extent(paintDial({ style, at }));
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.x - box.min.x).toBeLessThan(0.36);
      expect(box.max.z - box.min.z).toBeLessThan(0.26);
      expect(box.max.y).toBeLessThan(0.26);
    }
  });

  it('wears every scheme on the dial as a chip: its enamel, and its trim', () => {
    const seen = new Set<string>();
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) {
        if (q.material !== 'paper') continue;
        const c = q.geometry.getAttribute('color');
        for (let i = 0; i < c.count; i++) seen.add(`${c.getX(i).toFixed(5)},${c.getY(i).toFixed(5)},${c.getZ(i).toFixed(5)}`);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
    expect(DIAL_SCHEMES).toEqual(PAINT_TUNING.schemes);
    for (const id of DIAL_SCHEMES) {
      for (const slot of ['teal-panel', 'teal-light'] as const) expect(seen.has(slotColour(id, slot).map((x) => x.toFixed(5)).join(','))).toBe(true);
    }
  });

  it('its chips are nodes the view can pose', () => {
    for (let i = 0; i < DIAL_SCHEMES.length; i++) expect(find(p.root, `chip-${i}`), `chip-${i}`).toBeDefined();
  });

  it('is registered, both styles among its variants', () => {
    expect(catalogue[0]!.name).toBe('paint-dial');
    expect(catalogue[0]!.variants?.[style]).toBeDefined();
    expect(p.sockets?.['grip']).toBeDefined();
    expect(find(p.root, 'knob')).toBeDefined();
  });
});

describe('the paint dial\'s control', () => {
  it('the fan: the knob\'s needle on chip i, the chips evenly round it', () => {
    const n = DIAL_SCHEMES.length;
    const S = PAINT_DIAL.fan.spread;
    for (let i = 0; i < n; i++) expect(paintDialAngle(i)).toBeCloseTo(((-S + (2 * S * i) / (n - 1)) * Math.PI) / 180, 12);
    const knob = find(paintDial({ style: 'fan', at: 2 }).root, 'knob')!;
    const dir = new Vector3(0, 0, 1).transformDirection(knob.transform!);
    expect(Math.atan2(dir.x, dir.z)).toBeCloseTo(paintDialAngle(2), 6);
  });

  it('the deck: the chip worn hangs at the front, the ones before it flicked over behind, the ones to come behind it', () => {
    const D = PAINT_DIAL.deck;
    const n = DIAL_SCHEMES.length;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const a = deckSwing(i, k);
        if (i === k) expect(a).toBeCloseTo((D.front * Math.PI) / 180, 9);
        else expect(Math.sin(a)).toBeLessThan(0); // behind the worn chip: its foot away from the visitor
        if (i < k) expect(a).toBeGreaterThan(Math.PI); // gone round over the top
      }
    }
    // a flick: the chip worn goes over the top (through straight up) on its way to hanging behind
    const mid = deckSwing(1, 1.5);
    expect(mid).toBeGreaterThan(Math.PI * 0.8);
    expect(mid).toBeLessThan(Math.PI * 1.2);
    // the chip node is posed for `at`
    const c2 = find(paintDial({ style: 'deck', at: 2 }).root, 'chip-2')!;
    const down = new Vector3(0, -1, 0).transformDirection(c2.transform!);
    expect(down.z).toBeGreaterThan(0); // its foot toward the visitor: the front
  });
});
