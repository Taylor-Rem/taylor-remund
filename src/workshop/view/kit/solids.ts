/**
 * Solids: every one bevelled or filleted by default. All rest on y = 0,
 * centred on the Y axis, unless stated. Each returns a kit geometry
 * (position, normal, color, surf) ready to tint, place and merge.
 *
 * `detail: 'low'` halves segment counts.
 */
import type { BufferGeometry } from 'three';
import { Matrix4 } from 'three';
import { finish, MeshData } from './mesh.ts';
import type { FinishOptions } from './mesh.ts';
import { loft, planFrame } from './loft.ts';
import type { Frame } from './loft.ts';
import { autoSegs, chamferRectLoop, circleLoop, outlineLoop, profile, rectLoop } from './profile.ts';
import type { Loop, OutlineOptions, Profile, PSample } from './profile.ts';
import { bulge, deform, transform } from './deform.ts';

export type Detail = 'high' | 'low';
export interface DetailOpt {
  detail?: Detail | undefined;
}

/** Segment count scaled for detail, never below `min`. */
export function segs(n: number, detail: Detail | undefined, min = 3): number {
  return Math.max(min, Math.round(detail === 'low' ? n / 2 : n));
}
const dmul = (d: Detail | undefined): number => (d === 'low' ? 0.5 : 1);

// ---- boxes -----------------------------------------------------------------

export interface RoundedBoxOptions extends DetailOpt {
  w: number;
  h: number;
  d: number;
  /** Edge radius (all edges). Default 6% of the smallest side. */
  r?: number;
  /** Plan (vertical edge) radius; default r. Top/bottom radii are clamped to it. */
  rPlan?: number;
  /** Top edge radius; default r. */
  rTop?: number;
  /** Bottom edge radius; default r. */
  rBottom?: number;
  /** Most fillet segments per 90° (default: from each radius, 1 + 45·r, at most 6). */
  segs?: number;
}

/** A box with every edge filleted. Base on y = 0. */
export function roundedBox(o: RoundedBoxOptions): BufferGeometry {
  const r = o.r ?? Math.min(o.w, o.h, o.d) * 0.06;
  const rp = Math.min(o.rPlan ?? r, o.w / 2 - 1e-4, o.d / 2 - 1e-4);
  const rt = Math.min(o.rTop ?? r, rp, o.h / 2);
  const rb = Math.min(o.rBottom ?? r, rp, o.h / 2);
  const s = o.segs ?? 6;
  const loop = rectLoop(o.w / 2 - rp, o.d / 2 - rp, segs(autoSegs(rp, s), o.detail, 2));
  const p = profile(0, 0)
    .to(rp, 0, rb > 0 ? { fillet: rb } : { sharp: true })
    .to(rp, o.h, rt > 0 ? { fillet: rt } : { sharp: true })
    .to(0, o.h);
  return finish(loft({ loops: [loop], profile: p.expand({ detail: dmul(o.detail), segs: s }) }));
}

export interface ProfiledBoxOptions extends DetailOpt {
  /** Nominal plan size: the outline where the profile's o equals rPlan. */
  w: number;
  d: number;
  /** Plan corner radius at the nominal outline. */
  rPlan: number;
}

/**
 * A box with a turned-style side profile: the profile (o, y) is swept round
 * a rounded rectangle instead of a circle. o is the distance out from the
 * box's core; o = rPlan is the nominal w × d outline, larger o flares past
 * it, smaller o steps in. Write it like a lathe profile: from o = 0 at the
 * bottom, out, up, and back to o = 0 at the top. Plinths with shoulders,
 * lids with a raised centre, pedestals with a waist.
 */
export function profiledBox(o: ProfiledBoxOptions, p: Profile): BufferGeometry {
  const rp = Math.min(o.rPlan, o.w / 2 - 1e-4, o.d / 2 - 1e-4);
  const loop = rectLoop(o.w / 2 - rp, o.d / 2 - rp, segs(autoSegs(rp, 6), o.detail, 2));
  return finish(loft({ loops: [loop], profile: p.expand({ detail: dmul(o.detail) }), closedProfile: p.closed }));
}

export interface ChamferedBoxOptions extends DetailOpt {
  w: number;
  h: number;
  d: number;
  /** Chamfer leg. Default 8% of the smallest side. */
  c?: number;
  /** Crisp chamfer faces with split normals (default). False gives the softer weighted-normal look. */
  crisp?: boolean;
}

/** A box with 45° chamfers on every edge. */
export function chamferedBox(o: ChamferedBoxOptions): BufferGeometry {
  const c = Math.min(o.c ?? Math.min(o.w, o.h, o.d) * 0.08, o.w / 2 - 1e-4, o.d / 2 - 1e-4, o.h / 2);
  if (o.crisp === false) return roundedBox({ w: o.w, h: o.h, d: o.d, r: c, segs: 1, detail: 'high' });
  const loop = chamferRectLoop(o.w / 2 - c, o.d / 2 - c);
  const p = profile(0, 0).to(c, 0, { chamfer: c }).to(c, o.h, { chamfer: c }).to(0, o.h);
  // chamfer in profile at offset c with leg c: the bottom edge's chamfer meets the plan chamfer at the corners
  return finish(loft({ loops: [loop], profile: p.expand({ detail: 1 }) }));
}

export interface TaperBoxOptions extends RoundedBoxOptions {
  /** Top width and depth (default 80% of base). */
  topW?: number;
  topD?: number;
  /** Shift of the top's centre (a wedge leans). */
  shiftX?: number;
  shiftZ?: number;
}

/** A wedge / taper: a rounded box whose top is smaller than its base (and may lean). */
export function taperBox(o: TaperBoxOptions): BufferGeometry {
  const g = roundedBox(o);
  // the sides taper from where the bottom fillet ends, so the base keeps its full size
  const rb = Math.min(o.rBottom ?? o.r ?? Math.min(o.w, o.h, o.d) * 0.06, o.h / 2);
  const sx = (o.topW ?? o.w * 0.8) / o.w, sz = (o.topD ?? o.d * 0.8) / o.d;
  const dx = o.shiftX ?? 0, dz = o.shiftZ ?? 0;
  return deform(g, (x, y, z) => {
    const t = Math.max(0, (y - rb) / (o.h - rb));
    return [x * (1 + (sx - 1) * t) + dx * t, y, z * (1 + (sz - 1) * t) + dz * t];
  });
}

export interface TrayOptions extends DetailOpt {
  w: number;
  h: number;
  d: number;
  /** Wall thickness (default 0.03). */
  wall?: number;
  /** Floor thickness (default = wall). */
  floor?: number;
  /** Inside fillet where floor meets wall (default 0.6 × wall). */
  rInner?: number;
  /** Outside bottom edge radius (default wall). */
  rBottom?: number;
  segs?: number;
}

/** A hollow box / tray with visible wall thickness and a rounded lip. */
export function tray(o: TrayOptions): BufferGeometry {
  const wall = o.wall ?? 0.03;
  const floor = o.floor ?? wall;
  const ri = o.rInner ?? wall * 0.6;
  const C = Math.min(wall + ri + 0.01, o.w / 2 - 1e-3, o.d / 2 - 1e-3);
  const rb = Math.min(o.rBottom ?? wall, C);
  const s = o.segs ?? 6;
  const loop = rectLoop(o.w / 2 - C, o.d / 2 - C, segs(autoSegs(C, s), o.detail, 2));
  const p = profile(0, 0)
    .to(C, 0, { fillet: rb })
    .to(C, o.h, { fillet: wall / 2 })
    .to(C - wall, o.h, { fillet: wall / 2 })
    .to(C - wall, floor, { fillet: ri })
    .to(0, floor);
  return finish(loft({ loops: [loop], profile: p.expand({ detail: dmul(o.detail), segs: s }) }));
}

// ---- lathe -----------------------------------------------------------------

export interface LatheOptions extends DetailOpt {
  /** Segments round the axis (default from the largest radius: 220·r, 8..40). */
  segs?: number;
  /** Partial sweep: start and end angle in radians (0 = +X, π/2 = +Z). */
  from?: number;
  to?: number;
  /** Most fillet segments per 90° in the profile (default 6; unmarked fillets get 1 + 45·r). */
  filletSegs?: number;
  /** Support samples beside fillets (default false). */
  support?: boolean;
  /** Skip one end cap (e.g. a hidden base). */
  caps?: boolean | 'start' | 'end';
  finish?: FinishOptions;
}

/**
 * A turned part: the profile (radius, height) revolved about the Y axis.
 * Write the profile from the axis at the bottom, out, up, and back to the
 * axis at the top (material on the left). See profile.ts for the DSL.
 */
export function lathe(p: Profile | PSample[], o: LatheOptions = {}): BufferGeometry {
  const samples = Array.isArray(p) ? p : p.expand({ detail: dmul(o.detail), segs: o.filletSegs ?? 6, support: o.support ?? false });
  const maxR = samples.reduce((m, s) => Math.max(m, s.o), 0);
  const sweepFrac = Math.abs((o.to ?? Math.PI * 2) - (o.from ?? 0)) / (Math.PI * 2);
  const n = segs(o.segs ?? Math.max(8, Math.min(40, Math.round(maxR * 220 * sweepFrac))), o.detail, 6);
  const loop = circleLoop(n, o.from ?? 0, o.to ?? Math.PI * 2);
  const closed = !Array.isArray(p) && p.closed;
  const input: Parameters<typeof loft>[0] = { loops: [loop], profile: samples, closedProfile: closed };
  if (o.caps !== undefined) input.caps = o.caps;
  return finish(loft(input), o.finish);
}

// ---- extrude ---------------------------------------------------------------

export interface ExtrudeOptions extends DetailOpt {
  /** Corner radius applied to every outline corner (default 0.6 × bevel + 0.004). */
  radius?: number | number[];
  /** Bevel on the visible face, the one at `depth` (top for axis 'y', front for 'z'). Default 15% of depth, at most 0.02. */
  bevel?: number;
  /** Bevel on the face at 0 (default = bevel; 0 for a crisp hidden base). */
  bevelBase?: number;
  /** Support samples beside the bevels (default false). */
  support?: boolean;
  /** Skip a hidden cap: 'end' keeps only the visible face's cap. */
  caps?: boolean | 'start' | 'end';
  /** 'round' fillet (default) or crisp 'chamfer'. */
  style?: 'round' | 'chamfer';
  /** Holes, as outlines in the same coordinates. */
  holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  holeRadius?: number;
  /**
   * 'y': the outline is a plan (x, z), extruded up from y = 0 (a plate lying down).
   * 'z' (default): the outline is drawn in (x, y), extruded toward the visitor from z = 0.
   */
  axis?: 'y' | 'z';
  segs?: number;
}

/** A plate, bracket or tool head from a 2D outline, with rounded corners, a real bevel and holes. */
export function extrude(outline: ReadonlyArray<readonly [number, number]>, depth: number, o: ExtrudeOptions = {}): BufferGeometry {
  const axis = o.axis ?? 'z';
  const bb = Math.min(o.bevel ?? Math.min(depth * 0.15, 0.02), depth - 1e-5);
  const b = Math.min(o.bevelBase ?? bb, depth - bb - 1e-5);
  const flipV = axis === 'z';
  const conv = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> => pts.map((p) => [p[0], flipV ? -p[1] : p[1]]);
  const s = segs(o.segs ?? autoSegs(typeof o.radius === 'number' ? o.radius : Math.max(b, bb) * 1.1 + 0.004, 5), o.detail, 1);
  const lo: OutlineOptions = { radius: o.radius ?? Math.max(b, bb) * 1.1 + 0.004, segs: s, support: o.support ? Math.max(0.004, Math.min(Math.max(b, bb) * 0.8, 0.012)) : 0 };
  const loops: Loop[] = [outlineLoop(conv(outline), lo)];
  for (const h of o.holes ?? []) loops.push(outlineLoop(conv(h), { ...lo, radius: o.holeRadius ?? lo.radius!, hole: true }));
  const corner = (r: number) => (r <= 0 ? { sharp: true } : o.style === 'chamfer' ? { chamfer: r } : { fillet: r });
  const p = b > 0 ? profile(-b * 1.6, 0).to(0, 0, corner(b)) : profile(0, 0);
  p.to(0, depth, corner(bb)).to(-Math.max(bb, 1e-4) * 1.6, depth);
  const input: Parameters<typeof loft>[0] = { loops, profile: p.expand({ detail: dmul(o.detail), segs: 5, support: o.support ?? false }) };
  if (o.caps !== undefined) input.caps = o.caps;
  const g = finish(loft(input));
  if (axis === 'z') transform(g, new Matrix4().makeRotationX(Math.PI / 2));
  return g;
}

export interface SlabOptions extends DetailOpt {
  w: number;
  d: number;
  /** Thickness (Y). */
  t: number;
  /** Plan corner radius (default 15% of the smaller side). */
  r?: number;
  /** Edge bevel (default 30% of thickness). */
  bevel?: number;
}

/** A slab / plate lying flat with a rounded outline and rounded edges (a rounded box with independent plan radius). */
export function slab(o: SlabOptions): BufferGeometry {
  const rp = o.r ?? Math.min(o.w, o.d) * 0.15;
  const b = Math.min(o.bevel ?? o.t * 0.3, o.t / 2, rp);
  return roundedBox({ w: o.w, h: o.t, d: o.d, rPlan: rp, r: b, detail: o.detail });
}

// ---- soft forms ------------------------------------------------------------

function sphereSamples(n: number, r = 1, y0 = 0): PSample[] {
  const out: PSample[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    out.push({ o: Math.sin(t) * r, y: y0 + r - Math.cos(t) * r, no: Math.sin(t), ny: -Math.cos(t) });
  }
  return out;
}

export interface EllipsoidOptions extends DetailOpt {
  rx: number;
  ry: number;
  rz: number;
  segs?: number;
}

/** An ellipsoid resting on y = 0. */
export function ellipsoid(o: EllipsoidOptions): BufferGeometry {
  const n = segs(o.segs ?? 32, o.detail, 8);
  const g = finish(loft({ loops: [circleLoop(n)], profile: sphereSamples(Math.round(n / 2)) }));
  return transform(g, new Matrix4().makeScale(o.rx, o.ry, o.rz));
}

export interface CapsuleOptions extends DetailOpt {
  r: number;
  /** Total height (≥ 2r). */
  h: number;
  segs?: number;
}

/** A capsule standing on y = 0. */
export function capsule(o: CapsuleOptions): BufferGeometry {
  const n = segs(o.segs ?? 24, o.detail, 8);
  const q = Math.max(2, Math.round(n / 4));
  const mid = Math.max(0, o.h - 2 * o.r);
  const samples: PSample[] = [];
  for (let i = 0; i <= q; i++) {
    const t = (i / q) * (Math.PI / 2);
    samples.push({ o: Math.sin(t) * o.r, y: o.r - Math.cos(t) * o.r, no: Math.sin(t), ny: -Math.cos(t) });
  }
  for (let i = 0; i <= q; i++) {
    const t = Math.PI / 2 + (i / q) * (Math.PI / 2);
    samples.push({ o: Math.sin(t) * o.r, y: o.r + mid - Math.cos(t) * o.r, no: Math.sin(t), ny: -Math.cos(t) });
  }
  return finish(loft({ loops: [circleLoop(n)], profile: samples }));
}

export interface TorusOptions extends DetailOpt {
  /** Ring radius (to the tube centre). */
  R: number;
  /** Tube radius. */
  r: number;
  segs?: number;
  tubeSegs?: number;
}

/** A torus lying flat (axis Y), resting on y = 0. */
export function torus(o: TorusOptions): BufferGeometry {
  const n = segs(o.segs ?? 32, o.detail, 8);
  const m = segs(o.tubeSegs ?? 12, o.detail, 6);
  const samples: PSample[] = [];
  for (let i = 0; i < m; i++) {
    const t = (i / m) * Math.PI * 2;
    samples.push({ o: o.R + Math.cos(t) * o.r, y: o.r + Math.sin(t) * o.r, no: Math.cos(t), ny: Math.sin(t) });
  }
  return finish(loft({ loops: [circleLoop(n)], profile: samples, closedProfile: true }));
}

export interface SuperellipsoidOptions extends DetailOpt {
  rx: number;
  ry: number;
  rz: number;
  /** North-south squareness: 1 = round, < 1 boxier (0.3 is a soft box), > 1 pinched. */
  e1?: number;
  /** East-west squareness. */
  e2?: number;
  segs?: number;
}

const spow = (c: number, e: number): number => Math.sign(c) * Math.pow(Math.abs(c), e);

/** A superellipsoid resting on y = 0: the soft box/blob between a sphere and a cube. */
export function superellipsoid(o: SuperellipsoidOptions): BufferGeometry {
  const e1 = o.e1 ?? 0.4, e2 = o.e2 ?? 0.4;
  const nu = segs(o.segs ?? 40, o.detail, 8);
  const nv = Math.max(6, Math.round(nu / 2));
  const md = new MeshData();
  const P = (u: number, v: number): [number, number, number] => {
    const cv = spow(Math.cos(v), e1);
    return [o.rx * cv * spow(Math.cos(u), e2), o.ry + o.ry * spow(Math.sin(v), e1), o.rz * cv * spow(Math.sin(u), e2)];
  };
  // implicit-surface gradient for the normal (exact and stable at the flats)
  const N = (x: number, y: number, z: number): [number, number, number] => {
    const X = x / o.rx, Y = (y - o.ry) / o.ry, Z = z / o.rz;
    const a = 2 / e2, b = 2 / e1;
    const ax = Math.pow(Math.abs(X), a), az = Math.pow(Math.abs(Z), a);
    const base = ax + az;
    const k = base > 1e-12 ? (e2 / e1) * Math.pow(base, e2 / e1 - 1) : 0;
    const gx = k * a * Math.sign(X) * Math.pow(Math.abs(X), a - 1) / o.rx;
    const gz = k * a * Math.sign(Z) * Math.pow(Math.abs(Z), a - 1) / o.rz;
    const gy = b * Math.sign(Y) * Math.pow(Math.abs(Y), b - 1) / o.ry;
    return [gx, gy, gz];
  };
  const ids: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    const v = -Math.PI / 2 + (j / nv) * Math.PI;
    const row: number[] = [];
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2;
      const p = P(u, v);
      let n = j === 0 ? ([0, -1, 0] as [number, number, number]) : j === nv ? ([0, 1, 0] as [number, number, number]) : N(p[0], p[1], p[2]);
      if (!Number.isFinite(n[0] + n[1] + n[2]) || Math.hypot(...n) < 1e-9) n = [p[0], p[1] - o.ry, p[2]];
      row.push(md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
    }
    ids.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) md.quad(ids[j]![i]!, ids[j]![(i + 1) % nu]!, ids[j + 1]![(i + 1) % nu]!, ids[j + 1]![i]!);
  return finish(md);
}

export interface SquircleOptions extends DetailOpt {
  w: number;
  h: number;
  d: number;
  /** 0..1: how round the corners are (1 = the plan corners meet). Default 0.7. */
  roundness?: number;
  /** Top/bottom edge roundness relative to the plan radius (default 0.8). */
  soft?: number;
  /** Sideways swell in the middle of the height (default 0.04). */
  swell?: number;
}

/** A soft "squircle" body for characters: a deeply rounded box with gently swelling sides. */
export function squircle(o: SquircleOptions): BufferGeometry {
  const rp = (Math.min(o.w, o.d) / 2) * (o.roundness ?? 0.7);
  const re = Math.min(rp * (o.soft ?? 0.8), o.h / 2);
  const g = roundedBox({ w: o.w, h: o.h, d: o.d, rPlan: rp, rTop: re, rBottom: re, segs: 7, detail: o.detail });
  return bulge(g, o.h, o.swell ?? 0.04);
}

// ---- loft passthrough --------------------------------------------------------

/** Loft arbitrary loops along a profile (the raw core, for parts no helper covers). */
export function loftSolid(loops: Loop[], p: Profile | PSample[], opts: { frame?: (s: PSample, i: number) => Frame; caps?: boolean; detail?: Detail } = {}): BufferGeometry {
  const samples = Array.isArray(p) ? p : p.expand({ detail: dmul(opts.detail) });
  const closed = !Array.isArray(p) && p.closed;
  const input: Parameters<typeof loft>[0] = { loops, profile: samples, closedProfile: closed };
  if (opts.frame) input.frame = opts.frame;
  if (opts.caps !== undefined) input.caps = opts.caps;
  return finish(loft(input));
}

export { deform, planFrame };
