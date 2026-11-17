/**
 * The patch cord's plug and the cord itself (REWRITE.md § B2 X1;
 * art-direction § 10 SWITCHBOARD). Registry name `cord-plug`.
 *
 * PLUG: a turned brass plug: a ball tip, a black insulating ring, a ring
 * contact, a sleeve, a shoulder that seats on the jack's rim, a knurled
 * grip with a polished cap, and a `cable-red` rubber strain-relief boot
 * with three ribs where the cord leaves.
 *   Origin: the shoulder's seating face. +Z runs back along the plug toward
 *   the cord; the tip points down -Z. So the view seats it by setting the
 *   plug's transform to the board's `jack.<name>` socket.
 *   Socket `cord`: where the cord leaves the boot, +Z along the cord.
 *
 * CORD: `cordGeometry(points)` builds a braided `cable-red` rope through the
 * given points (a rope simulation's, ~24 of them) with a FIXED topology for
 * that point count; `updateCord(geometry, points)` moves it in place each
 * frame (positions, normals, material space; no allocation). `cordPart`
 * wraps it as a KitPart for `realize`. The braid is five twisted strands:
 * a ridged section turning along the length, each strand its own tone.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { chain, mat, part, piece, place, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { ridgedBand } from '../../cheap.ts';
import { ATTR } from '../../types.ts';
import { linear } from '../../../palette.ts';

/** The plug is turned at these sizes, then scaled up by SCALE (toy proportions: chunky in the paw). */
const BASE = { insert: 0.2, cordAt: 0.43, cordR: 0.032, r: 0.07 } as const;
const SCALE = 1.25;

/** The plug's dimensions, for the view and the tests. */
export const PLUG = {
  /** Length of the tip and sleeve that go into the jack (behind the seat, -Z). */
  insert: BASE.insert * SCALE,
  /** Where the cord leaves the boot (+Z from the seat). */
  cordAt: BASE.cordAt * SCALE,
  /** The cord's radius. */
  cordR: BASE.cordR * SCALE,
  /** Widest radius (the shoulder). */
  r: BASE.r * SCALE,
} as const;

/** Y (lathe axis) to +Z: a rotation of +90 degrees about X. */
const Y_TO_Z = mat({ rot: [90, 0, 0] });

export interface PlugOptions extends KitOptions {
  /**
   * 'seat' (default): origin at the seating face, axis along +Z (for the view).
   * 'bench': the same plug lying on the bench on its side (the catalogue's view of a loose plug).
   */
  rest?: 'seat' | 'bench';
  /** Also sweep a length of cord from the boot across the bench (catalogue review only). */
  demoCord?: boolean;
}

export function cordPlug(o: PlugOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const segs = hi ? 13 : 10;
  const b = piece('cord-plug', { detail, seed });
  const M = o.rest === 'bench' ? chain(T(0, PLUG.r, 0), mat({ rot: [0, -70, 0] }), mat({ rot: [0, 0, 8] })) : chain();
  const at = (p: KitPart[]): KitPart[] => place(p, chain(M, Y_TO_Z, mat({ scale: SCALE })));

  const tipY = -BASE.insert;
  // the tip: a brass ball on a neck
  const tip = lathe(
    profile(0, tipY).curve(0.03, tipY + 0.025, 0.03, tipY, hi ? 4 : 3).to(0.03, tipY + 0.035, { fillet: 0.006, segs: 1 }).to(0.021, tipY + 0.045, { sharp: true }).to(0.021, tipY + 0.055),
    { segs: hi ? 10 : 8, caps: false, band: 0 },
  );
  // the black insulating ring
  const ins = lathe(profile(0.021, tipY + 0.055).to(0.03, tipY + 0.055, { sharp: true }).to(0.03, tipY + 0.075, { sharp: true }).to(0.024, tipY + 0.078, { sharp: true }).to(0.024, tipY + 0.09), { segs: hi ? 10 : 8, caps: false, band: 0 });
  // the ring contact, a second insulator, the sleeve, the shoulder
  const ring = lathe(
    profile(0.024, tipY + 0.09).to(0.034, tipY + 0.092, { sharp: true }).to(0.034, tipY + 0.12, { fillet: 0.004, segs: 1 }).to(0.026, tipY + 0.123, { sharp: true }).to(0.026, tipY + 0.13),
    { segs: hi ? 10 : 8, caps: false, band: 0 },
  );
  const ins2 = lathe(profile(0.026, tipY + 0.13).to(0.038, tipY + 0.132, { sharp: true }).to(0.038, tipY + 0.142, { sharp: true }).to(0.03, tipY + 0.145), { segs: hi ? 10 : 8, caps: false, band: 0 });
  const sleeve = lathe(
    profile(0.03, tipY + 0.145)
      .to(0.041, tipY + 0.148, { sharp: true })
      .to(0.041, -0.004, { sharp: true })
      .to(BASE.r, 0, { fillet: 0.004, segs: 1 })
      .to(BASE.r, 0.022, { fillet: 0.008, segs: 2 })
      .to(0.062, 0.03, { sharp: true }),
    { segs, caps: false, band: 0 },
  );
  // the grip: a knurled barrel between two lips, a polished cap
  const knurl = transform(ridgedBand(0.064, 0.16, hi ? 14 : 10, 0.012), T(0, 0.04, 0));
  const lips = lathe(profile(0.062, 0.03).to(0.066, 0.034, { fillet: 0.003, segs: 1 }).to(0.066, 0.042, { sharp: true }).to(0.06, 0.042), { segs, caps: false, band: 0 });
  const cap = lathe(
    profile(0.06, 0.198).to(0.067, 0.2, { sharp: true }).to(0.067, 0.235, { fillet: 0.008, segs: 1 }).to(0.054, 0.27, { fillet: 0.012, segs: 1 }).to(0.04, 0.275),
    { segs, caps: false, band: 0 },
  );
  b.add(at([
    setFinish(part('brass', tip, 'brass', { seed, warm: 0.03 }), 0.9),
    part('rubber', ins, 'ink', { seed: seed + 1 }),
    setFinish(part('brass', ring, 'brass', { seed: seed + 2 }), 0.8),
    part('rubber', ins2, 'ink', { seed: seed + 3 }),
    setFinish(part('brass', sleeve, 'brass', { seed: seed + 4 }), 0.7),
    setFinish(part('brass', knurl, 'brass', { seed: seed + 5 }), 0.35),
    setFinish(part('brass', lips, 'brass', { seed: seed + 6 }), 0.6),
    setFinish(part('brass', cap, 'brass', { seed: seed + 7 }), 0.85),
  ]));
  // the strain relief: a cable-red boot, three ribs, tapering onto the cord
  {
    const y0 = 0.265, y1 = BASE.cordAt, cr = BASE.cordR;
    const p = profile(0.04, y0).to(0.05, y0 + 0.005, { fillet: 0.004, segs: 1 });
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      const ya = y0 + 0.012 + i * 0.05;
      const r = 0.05 - i * 0.004;
      p.to(r, ya + 0.022, { fillet: 0.005, segs: 1 }).to(r - 0.008, ya + 0.03, { smooth: true }).to(r - 0.008, ya + 0.04, { smooth: true });
    }
    p.to(cr * 1.2, y1 - 0.02, { smooth: true }).to(cr * 1.05, y1, { fillet: 0.004, segs: 1 }).to(cr * 0.9, y1);
    const boot = lathe(p, { segs: hi ? 10 : 8, caps: false, band: 0 });
    b.add(at([part('rubber', boot, 'cable-red', { seed: seed + 8, shade: 0.75 })]));
  }
  b.socket('cord', chain(M, Y_TO_Z, T(0, PLUG.cordAt, 0), mat({ rot: [-90, 0, 0] })));
  b.socket('seat', M.clone());

  if (o.demoCord) {
    // a length of cord leaving the boot, dropping to the bench and lying in a loose S (catalogue review only)
    const L = chain(M, Y_TO_Z);
    const drop = o.rest === 'bench' ? PLUG.r - PLUG.cordR : 0.4;
    const pts: Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      // plug frame: +Y here is along the plug toward the cord (Y_TO_Z turns it to +Z)
      const along = PLUG.cordAt + t * 2.0;
      const side = 0.45 * Math.sin(t * Math.PI * 1.3) * Math.min(1, t * 3);
      const down = -drop * Math.min(1, t * 5);
      pts.push(new Vector3(side, along, down).applyMatrix4(L));
    }
    b.add(cordPart(pts, { seed: seed + 20 }));
  }
  return b.build();
}

// ---- the cord ----------------------------------------------------------------------

export interface CordOptions {
  /** Radius (default PLUG.cordR). */
  radius?: number;
  /** Rings between two given points (default 3). */
  sub?: number;
  /** Strands in the braid (default 5); the section has 2 vertices a strand. */
  strands?: number;
  /** Strand turns per world unit along the cord (default 2.2). */
  twist?: number;
  /** Seeds the strands' tones. */
  seed?: number;
}

interface CordMeta {
  n: number;
  sub: number;
  segs: number;
  radius: number;
  twist: number;
}

type P3 = Vector3 | readonly [number, number, number];
const vx = (p: P3): number => (p instanceof Vector3 ? p.x : p[0]);
const vy = (p: P3): number => (p instanceof Vector3 ? p.y : p[1]);
const vz = (p: P3): number => (p instanceof Vector3 ? p.z : p[2]);

/**
 * A braided cord through `points` (at least 2). The topology depends only on
 * `points.length` and the options, so `updateCord` can move it every frame.
 * Carries the kit attributes: position, normal, color (cable-red, a tone per
 * strand), surf (wear on the strands' crowns, cavity between them), lpos
 * (+X along the cord in world units: the material's detail follows it).
 */
export function cordGeometry(points: readonly P3[], o: CordOptions = {}): BufferGeometry {
  const n = points.length;
  if (n < 2) throw new Error('cordGeometry: needs at least 2 points');
  const sub = Math.max(1, o.sub ?? 3);
  const strands = Math.max(3, o.strands ?? 5);
  const segs = strands * 2;
  const rings = (n - 1) * sub + 1;
  const nv = rings * segs;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute(ATTR.lpos, new BufferAttribute(new Float32Array(nv * 3), 3));
  // colour and surf never change: a tone per strand, crowns worn, valleys in cavity
  const col = new Float32Array(nv * 3), surf = new Float32Array(nv * 3);
  const c = linear('cable-red');
  let h = (o.seed ?? 1) * 2654435761;
  const tones: number[] = [];
  for (let k = 0; k < strands; k++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    tones.push(0.5 + ((h % 1000) / 1000) * 0.14 + (k % 2) * 0.06);
  }
  for (let r = 0; r < rings; r++) {
    for (let j = 0; j < segs; j++) {
      const i = r * segs + j;
      const crown = j % 2 === 0;
      const k = tones[Math.floor(j / 2)]! * (crown ? 1.08 : 0.72);
      col[i * 3] = c[0] * k;
      col[i * 3 + 1] = c[1] * k;
      col[i * 3 + 2] = c[2] * k;
      surf[i * 3] = crown ? 0.25 : 0;
      surf[i * 3 + 1] = crown ? 0 : 0.12;
    }
  }
  g.setAttribute(ATTR.color, new BufferAttribute(col, 3));
  g.setAttribute(ATTR.surf, new BufferAttribute(surf, 3));
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)((rings - 1) * segs * 6);
  let q = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let j = 0; j < segs; j++) {
      const a = r * segs + j, b = r * segs + ((j + 1) % segs), cc = a + segs, d = b + segs;
      idx[q++] = a; idx[q++] = b; idx[q++] = cc;
      idx[q++] = b; idx[q++] = d; idx[q++] = cc;
    }
  }
  g.setIndex(new BufferAttribute(idx, 1));
  const meta: CordMeta = { n, sub, segs, radius: o.radius ?? PLUG.cordR, twist: o.twist ?? 2.2 };
  g.userData['cord'] = meta;
  g.userData['kitSurf'] = 'intent';
  updateCord(g, points);
  return g;
}

// scratch, reused every frame
const P = new Vector3(), Tn = new Vector3(), Nn = new Vector3(), Bn = new Vector3(), tmp = new Vector3(), prevT = new Vector3();

/** Catmull-Rom point on the polyline at segment i, parameter t (uniform; ends clamped). */
function sample(points: readonly P3[], i: number, t: number, out: Vector3): Vector3 {
  const n = points.length;
  const p = (k: number): P3 => points[Math.max(0, Math.min(n - 1, k))]!;
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(vx(p0), vx(p1), vx(p2), vx(p3)), f(vy(p0), vy(p1), vy(p2), vy(p3)), f(vz(p0), vz(p1), vz(p2), vz(p3)));
}

let ringPts: Vector3[] = [];

/** Move a cord made by `cordGeometry` to new points (same count). In place; call each frame. */
export function updateCord(g: BufferGeometry, points: readonly P3[]): void {
  const m = g.userData['cord'] as CordMeta | undefined;
  if (!m) throw new Error('updateCord: not a cord geometry');
  if (points.length !== m.n) throw new Error(`updateCord: made for ${m.n} points, given ${points.length}`);
  const rings = (m.n - 1) * m.sub + 1;
  if (ringPts.length < rings) ringPts = Array.from({ length: rings }, () => new Vector3());
  for (let r = 0; r < rings; r++) {
    const seg = Math.min(m.n - 2, Math.floor(r / m.sub));
    const t = r / m.sub - seg;
    sample(points, seg, t, ringPts[r]!);
  }
  const pos = g.getAttribute('position') as BufferAttribute, nrm = g.getAttribute('normal') as BufferAttribute, lp = g.getAttribute(ATTR.lpos) as BufferAttribute;
  const pa = pos.array as Float32Array, na = nrm.array as Float32Array, la = lp.array as Float32Array;
  let s = 0;
  for (let r = 0; r < rings; r++) {
    const a = ringPts[Math.max(0, r - 1)]!, b = ringPts[Math.min(rings - 1, r + 1)]!;
    Tn.subVectors(b, a);
    if (Tn.lengthSq() < 1e-14) Tn.copy(prevT.lengthSq() > 0 ? prevT : tmp.set(0, 0, 1));
    Tn.normalize();
    if (r === 0) {
      // first normal: perpendicular to the tangent, as near world up as it can be
      tmp.set(0, 1, 0);
      if (Math.abs(tmp.dot(Tn)) > 0.9) tmp.set(1, 0, 0);
      Nn.copy(tmp).addScaledVector(Tn, -tmp.dot(Tn)).normalize();
    } else {
      // parallel transport: remove the new tangent's component from the last normal
      Nn.addScaledVector(Tn, -Nn.dot(Tn)).normalize();
      s += ringPts[r]!.distanceTo(ringPts[r - 1]!);
    }
    Bn.crossVectors(Tn, Nn);
    prevT.copy(Tn);
    P.copy(ringPts[r]!);
    const turn = s * m.twist * Math.PI * 2;
    for (let j = 0; j < m.segs; j++) {
      const i = r * m.segs + j;
      const phi = (j / m.segs) * Math.PI * 2 + turn;
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const rad = m.radius * (j % 2 === 0 ? 1 : 0.84);
      const ox = Nn.x * cs + Bn.x * sn, oy = Nn.y * cs + Bn.y * sn, oz = Nn.z * cs + Bn.z * sn;
      pa[i * 3] = P.x + ox * rad;
      pa[i * 3 + 1] = P.y + oy * rad;
      pa[i * 3 + 2] = P.z + oz * rad;
      // the strands' sides lean along the twist: tilt the normal a little toward the tangent on alternate vertices
      const lean = j % 2 === 0 ? 0 : 0.25;
      na[i * 3] = ox + Tn.x * lean;
      na[i * 3 + 1] = oy + Tn.y * lean;
      na[i * 3 + 2] = oz + Tn.z * lean;
      la[i * 3] = s;
      la[i * 3 + 1] = Math.cos(phi - turn) * rad;
      la[i * 3 + 2] = Math.sin(phi - turn) * rad;
    }
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  lp.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

/** The cord as a KitPart (`rubber` class: braided cloth reads matte, not glossy). */
export function cordPart(points: readonly P3[], o: CordOptions = {}): KitPart {
  return { material: 'rubber', geometry: cordGeometry(points, o) };
}
