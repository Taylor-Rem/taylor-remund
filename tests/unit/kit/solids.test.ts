import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import type { BufferGeometry } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { checkGeometry } from './helpers.ts';

function size(g: BufferGeometry): [number, number, number] {
  const b = new Box3().setFromBufferAttribute(g.getAttribute('position') as never);
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
}

function expectSize(g: BufferGeometry, want: [number, number, number], tol = 1e-3): void {
  const s = size(g);
  for (let i = 0; i < 3; i++) expect(Math.abs(s[i]! - want[i]!)).toBeLessThan(tol);
}

const turned = K.profile(0, 0).to(0.2, 0, { fillet: 0.02 }).to(0.2, 0.05, { fillet: 0.015 }).to(0.12, 0.08, { fillet: 0.03 }).groove(0.015, 0.03).to(0.09, 0.28, { fillet: 0.02 }).to(0.15, 0.3, { fillet: 0.01 }).to(0.15, 0.34, { fillet: 0.015 }).to(0, 0.34);

interface Case {
  name: string;
  make: (detail: 'high' | 'low') => BufferGeometry;
  size: [number, number, number];
  tol?: number;
  cap: number;
}

const cases: Case[] = [
  { name: 'roundedBox', make: (detail) => K.roundedBox({ w: 0.5, h: 0.4, d: 0.3, r: 0.05, detail }), size: [0.5, 0.4, 0.3], cap: 900 },
  { name: 'roundedBox (top/bottom radii)', make: (detail) => K.roundedBox({ w: 0.5, h: 0.35, d: 0.4, rPlan: 0.12, rTop: 0.1, rBottom: 0.02, detail }), size: [0.5, 0.35, 0.4], cap: 1200 },
  { name: 'chamferedBox', make: () => K.chamferedBox({ w: 0.45, h: 0.35, d: 0.4, c: 0.05 }), size: [0.45, 0.35, 0.4], cap: 200 },
  { name: 'chamferedBox soft', make: () => K.chamferedBox({ w: 0.45, h: 0.35, d: 0.4, c: 0.05, crisp: false }), size: [0.45, 0.35, 0.4], cap: 450 },
  { name: 'taperBox', make: (detail) => K.taperBox({ w: 0.5, h: 0.4, d: 0.4, r: 0.04, topW: 0.3, topD: 0.3, detail }), size: [0.5, 0.4, 0.4], cap: 900 },
  { name: 'profiledBox', make: (detail) => K.profiledBox({ w: 0.6, d: 0.4, rPlan: 0.06, detail }, K.profile(0, 0).to(0.06, 0, { sharp: true }).to(0.06, 0.05, { fillet: 0.012 }).to(0.03, 0.08, { fillet: 0.01 }).to(0, 0.08)), size: [0.6, 0.08, 0.4], cap: 900 },
  { name: 'slab', make: (detail) => K.slab({ w: 0.5, d: 0.4, t: 0.06, detail }), size: [0.5, 0.06, 0.4], cap: 900 },
  { name: 'tray', make: (detail) => K.tray({ w: 0.5, h: 0.2, d: 0.4, wall: 0.035, detail }), size: [0.5, 0.2, 0.4], cap: 1500 },
  { name: 'lathe', make: (detail) => K.lathe(turned, { detail }), size: [0.4, 0.34, 0.4], tol: 2e-3, cap: 2500 },
  { name: 'lathe (partial)', make: (detail) => K.lathe(turned, { detail, from: 0, to: Math.PI }), size: [0.4, 0.34, 0.2], tol: 2e-3, cap: 1500 },
  { name: 'extrude', make: (detail) => K.extrude([[-0.2, 0], [0.2, 0], [0.2, 0.1], [-0.2, 0.1]], 0.05, { radius: 0.02, bevel: 0.01, holes: [K.ngon(12, 0.025).map(([x, y]) => [x, y + 0.05] as [number, number])], detail }), size: [0.4, 0.1, 0.05], cap: 1200 },
  { name: 'sweep', make: (detail) => K.sweep(K.polylinePath([[-0.2, 0, 0], [-0.2, 0.3, 0], [0.2, 0.3, 0]], 0.08), { radius: 0.03, detail }), size: [0.43, 0.33, 0.06], tol: 4e-3, cap: 1200 },
  { name: 'ellipsoid', make: (detail) => K.ellipsoid({ rx: 0.22, ry: 0.16, rz: 0.18, detail }), size: [0.44, 0.32, 0.36], tol: 2e-3, cap: 1100 },
  { name: 'capsule', make: (detail) => K.capsule({ r: 0.1, h: 0.4, detail }), size: [0.2, 0.4, 0.2], tol: 2e-3, cap: 700 },
  { name: 'torus', make: (detail) => K.torus({ R: 0.16, r: 0.05, detail }), size: [0.42, 0.1, 0.42], tol: 3e-3, cap: 800 },
  { name: 'superellipsoid', make: (detail) => K.superellipsoid({ rx: 0.2, ry: 0.18, rz: 0.18, e1: 0.35, e2: 0.35, detail }), size: [0.4, 0.36, 0.36], tol: 3e-3, cap: 1700 },
  { name: 'squircle', make: (detail) => K.squircle({ w: 0.45, h: 0.42, d: 0.4, swell: 0, detail }), size: [0.45, 0.42, 0.4], cap: 2500 },
];

describe('kit solids', () => {
  for (const c of cases) {
    it(`${c.name}: clean geometry, requested size, under its triangle cap`, () => {
      const g = c.make('high');
      checkGeometry(g);
      expectSize(g, c.size, c.tol);
      expect(K.triangleCount(g)).toBeLessThan(c.cap);
      expect(K.triangleCount(g)).toBeGreaterThan(8);
    });
    it(`${c.name}: 'low' detail is cheaper and still clean`, () => {
      const hi = c.make('high');
      const lo = c.make('low');
      checkGeometry(lo);
      expect(K.triangleCount(lo)).toBeLessThanOrEqual(K.triangleCount(hi));
    });
    it(`${c.name}: deterministic`, () => {
      const a = c.make('high'), b = c.make('high');
      expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
      expect(Array.from(a.getAttribute('surf').array)).toEqual(Array.from(b.getAttribute('surf').array));
    });
  }

  it('flats stay flat: every normal on the top of a rounded box is straight up', () => {
    const g = K.roundedBox({ w: 0.6, h: 0.3, d: 0.4, r: 0.04 });
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    let top = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 0.3) < 1e-6) {
        top++;
        expect(n.getY(i)).toBeGreaterThan(0.9999);
      }
    }
    expect(top).toBeGreaterThan(4);
  });

  it('fillets carry analytic normals: on the edge fillet the normal points away from the fillet axis', () => {
    const r = 0.05;
    const g = K.roundedBox({ w: 0.6, h: 0.3, d: 0.4, r });
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    // vertices on the front-top fillet, away from the corners: centre line at y = 0.3 - r, z = 0.2 - r
    let seen = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      if (Math.abs(n.getX(i)) > 1e-6 || z < 0.2 - r - 1e-6 || y < 0.3 - r - 1e-6) continue;
      const dy = y - (0.3 - r), dz = z - (0.2 - r);
      const d = Math.hypot(dy, dz);
      if (d < r * 0.99) continue;
      seen++;
      expect(Math.abs(d - r)).toBeLessThan(1e-4);
      expect(n.getY(i) * (dy / d) + n.getZ(i) * (dz / d)).toBeGreaterThan(0.9999);
    }
    expect(seen).toBeGreaterThan(2);
  });

  it('wear is high inside fillets and zero on the flats beyond the band; cavity is high inside a tray', () => {
    const g = K.roundedBox({ w: 0.6, h: 0.3, d: 0.4, r: 0.03 });
    const p = g.getAttribute('position'), s = g.getAttribute('surf'), n = g.getAttribute('normal');
    let crest = 0;
    for (let i = 0; i < p.count; i++) {
      const flat = Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))) > 0.9999;
      const inFromEdge = Math.min(0.3 - Math.abs(p.getX(i)), 0.2 - Math.abs(p.getZ(i)), p.getY(i), 0.3 - p.getY(i));
      if (flat && inFromEdge > 0.03 + 0.045 * 1.6) expect(s.getX(i)).toBe(0);
      if (Math.abs(n.getY(i) - Math.SQRT1_2) < 0.05 && Math.abs(n.getZ(i) - Math.SQRT1_2) < 0.05) crest = Math.max(crest, s.getX(i));
    }
    expect(crest).toBeGreaterThan(0.5);
    const t = K.tray({ w: 0.5, h: 0.2, d: 0.4, wall: 0.03 });
    const ts = t.getAttribute('surf');
    let maxCav = 0;
    for (let i = 0; i < ts.count; i++) maxCav = Math.max(maxCav, ts.getY(i));
    expect(maxCav).toBeGreaterThan(0.5);
  });
});
