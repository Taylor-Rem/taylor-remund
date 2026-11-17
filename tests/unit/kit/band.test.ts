import { describe, expect, it } from 'vitest';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { WEAR_BAND } from '../../../src/workshop/view/kit/surface.ts';
import { checkGeometry } from './helpers.ts';

/** Top-face vertices of a box (normal straight up, at the top), with their distance in from the box's outline. */
function topFace(g: ReturnType<typeof K.roundedBox>, w: number, h: number, d: number): Array<{ edge: number; wear: number }> {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), s = g.getAttribute('surf');
  const out: Array<{ edge: number; wear: number }> = [];
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getY(i) - h) > 1e-6 || n.getY(i) < 0.9999) continue;
    out.push({ edge: Math.min(w / 2 - Math.abs(p.getX(i)), d / 2 - Math.abs(p.getZ(i))), wear: s.getX(i) });
  }
  return out;
}

describe('wear band: edge wear reaches onto faces', () => {
  const w = 0.6, h = 0.3, d = 0.4, r = 0.03;
  const g = K.roundedBox({ w, h, d, r });

  it('is clean geometry with a band ring on the face', () => {
    checkGeometry(g);
    const face = topFace(g, w, h, d);
    // a ring of vertices about one band in from the fillet's tangent line
    expect(face.some((v) => Math.abs(v.edge - (r + WEAR_BAND)) < 0.006)).toBe(true);
  });

  it('wear is > 0 on the face next to the edge, 0 a band in, and never rises going inward', () => {
    const face = topFace(g, w, h, d).sort((a, b) => a.edge - b.edge);
    const nearEdge = face.filter((v) => v.edge <= r + 1e-4);
    expect(nearEdge.length).toBeGreaterThan(0);
    expect(Math.max(...nearEdge.map((v) => v.wear))).toBeGreaterThan(0.1);
    for (const v of face) if (v.edge >= r + WEAR_BAND * 1.6 - 1e-4) expect(v.wear).toBe(0);
    // monotone: bucket by distance in, the most wear in each bucket does not increase inward
    let prev = Infinity;
    for (let e = 0; e <= 0.2; e += 0.01) {
      const b = face.filter((v) => v.edge >= e && v.edge < e + 0.01);
      if (!b.length) continue;
      const m = Math.max(...b.map((v) => v.wear));
      expect(m).toBeLessThanOrEqual(prev + 1e-6);
      prev = m;
    }
  });

  it('corners carry the most wear', () => {
    const p = g.getAttribute('position'), s = g.getAttribute('surf'), n = g.getAttribute('normal');
    let corner = 0, edgeMid = 0;
    for (let i = 0; i < p.count; i++) {
      const isCorner = Math.abs(n.getX(i)) > 0.4 && n.getY(i) > 0.4 && Math.abs(n.getZ(i)) > 0.4;
      const isEdge = Math.abs(n.getX(i)) < 1e-3 && Math.abs(n.getY(i) - Math.SQRT1_2) < 0.1;
      if (isCorner) corner = Math.max(corner, s.getX(i));
      if (isEdge) edgeMid = Math.max(edgeMid, s.getX(i));
    }
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeGreaterThanOrEqual(edgeMid);
  });

  it("detail 'low' and band 0 add no ring and spread no wear", () => {
    const lo = K.roundedBox({ w, h, d, r, detail: 'low' });
    const off = K.roundedBox({ w, h, d, r, band: 0 });
    expect(K.triangleCount(off)).toBeLessThan(K.triangleCount(g));
    for (const x of [lo, off]) for (const v of topFace(x, w, h, d)) if (v.edge > r + 1e-4) expect(v.wear).toBe(0);
  });

  it('the band shrinks on small parts so it never covers a small face', () => {
    expect(K.bandFor({}, 1)).toBe(WEAR_BAND);
    expect(K.bandFor({}, 0.1)).toBeCloseTo(0.02, 6);
    expect(K.bandFor({}, 0.02)).toBe(0);
    expect(K.bandFor({ detail: 'low' }, 1)).toBe(0);
  });

  it('is deterministic and keeps the ring count modest', () => {
    const again = K.roundedBox({ w, h, d, r });
    expect(Array.from(again.getAttribute('surf').array)).toEqual(Array.from(g.getAttribute('surf').array));
    // one ring per face run: about 2.5x on a lone small box, about +12% on the whole test block
    expect(K.triangleCount(g)).toBeLessThan(2.6 * K.triangleCount(K.roundedBox({ w, h, d, r, band: 0 })));
  });

  it('a lathe and an extrude get the band too', () => {
    const l = K.lathe(K.profile(0, 0).to(0.2, 0, { fillet: 0.02 }).to(0.2, 0.1, { fillet: 0.02 }).to(0, 0.1));
    const s = l.getAttribute('surf'), p = l.getAttribute('position'), n = l.getAttribute('normal');
    let onFace = 0;
    for (let i = 0; i < p.count; i++) if (n.getY(i) > 0.9999 && Math.hypot(p.getX(i), p.getZ(i)) < 0.18 && s.getX(i) > 0.05) onFace++;
    expect(onFace).toBeGreaterThan(0);
    const e = K.extrude([[-0.2, 0], [0.2, 0], [0.2, 0.2], [-0.2, 0.2]], 0.05, { radius: 0.03, bevel: 0.012 });
    checkGeometry(e);
  });
});

describe('thin parts are not all edge', () => {
  it('a thin strap and a louvre slat keep wear well below a stout part', () => {
    const maxWear = (g: ReturnType<typeof K.roundedBox>): number => Math.max(...Array.from(g.getAttribute('surf').array).filter((_, i) => i % 3 === 0));
    const strap = K.roundedBox({ w: 0.5, h: 0.01, d: 0.06, r: 0.004 });
    const stout = K.roundedBox({ w: 0.5, h: 0.2, d: 0.3, r: 0.015 });
    expect(maxWear(strap)).toBeLessThan(0.5);
    expect(maxWear(stout)).toBeGreaterThan(0.9);
    const slats = K.louvre({}).slice(2);
    for (const q of slats) expect(maxWear(q.geometry)).toBeLessThan(0.5);
  });
});

describe('debug colours', () => {
  it('surfDebugColors reads vec3 surf, including the finish view', () => {
    const g = K.setFinish(K.roundedBox({ w: 0.2, h: 0.2, d: 0.2 }), 1);
    const c = K.surfDebugColors(g, 'finish');
    expect(c.length).toBe(g.getAttribute('position').count * 3);
    expect(c[0]).toBeCloseTo(0.95, 5);
    const w = K.surfDebugColors(g, 'wear');
    expect(w.length).toBe(c.length);
  });
});
