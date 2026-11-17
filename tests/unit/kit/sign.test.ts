import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { sign, catalogue, estimatePanel, SIGN, SIGN_CAP } from '../../../src/workshop/view/kit/pieces/sign/index.ts';
import { capPx } from '../../../src/workshop/view/labels/layout.ts';
import { checkGeometry } from './helpers.ts';

const BUDGET = 9000;

const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

function nodes(p: Piece): Map<string, PieceNode> {
  const out = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

describe('the sign', () => {
  const p = sign();

  it('builds deterministically, and another seed is another sign', () => {
    const a = sign({ seed: 3 }), b = sign({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    expect(a.root.parts[0]!.geometry.getAttribute('position').array).toEqual(b.root.parts[0]!.geometry.getAttribute('position').array);
    expect(sign({ seed: 4 }).root.parts[0]!.geometry.getAttribute('position').array).not.toEqual(a.root.parts[0]!.geometry.getAttribute('position').array);
  });

  it('stays inside its triangle budget', () => {
    const b = K.budget(p, BUDGET);
    expect(b.fits, b.text).toBe(true);
    expect(sign({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
  });

  it('is a board about the brief size, hung from the wall plane', () => {
    const box = K.pieceBounds(p);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.min.z).toBeGreaterThanOrEqual(-0.01);
    expect(p.size.x).toBeGreaterThan(5.2);
    expect(p.size.x).toBeLessThan(6.6);
    // capitals stay well over the 12 px rule
    expect(capPx(SIGN_CAP)).toBeGreaterThan(30);
  });

  it('lays out any number of words, one panel each', () => {
    const two = sign({ words: ['TAYLOR', 'REMUND'] });
    const w1 = estimatePanel('TAYLOR').w, w2 = estimatePanel('REMUND').w;
    expect(two.size.x - p.size.x).toBeGreaterThan(w2 * 0.9);
    expect(two.size.x).toBeLessThan(w1 + w2 + 1.4);
  });

  it('groups its lit bulbs in nodes of about six, and has a wash socket in front', () => {
    const n = nodes(p);
    const groups = [...n.keys()].filter((k) => /^bulbs\d+$/.test(k));
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (const g of groups) {
      const node = n.get(g)!;
      expect(node.parts.every((q) => q.material === 'bulb')).toBe(true);
    }
    const wash = new Vector3().setFromMatrixPosition(p.sockets!['wash']!);
    expect(wash.z).toBeCloseTo(SIGN.washOut, 3);
    expect(wash.y).toBeGreaterThan(0.5);
    expect(p.sockets!['face']).toBeDefined();
  });

  it('every geometry holds the kit invariants', () => {
    const walk = (nd: PieceNode): void => {
      for (const q of nd.parts) checkGeometry(q.geometry);
      for (const c of nd.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('is registered, with a labels hook, and realizes', () => {
    const e = catalogue.find((c) => c.name === 'sign')!;
    expect(typeof e.labels).toBe('function');
    const o = K.realize(e.build(), stub);
    let meshes = 0;
    o.traverse((c) => { if ((c as Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(4);
    expect(o.getObjectByName('bulbs0')).toBeDefined();
  });
});
