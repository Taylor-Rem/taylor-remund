/**
 * Years of use on the bench top, cheaply (W2-crate round 4).
 *
 * The board material (`wood`, `large`) darkens with cavity (surf.y, its
 * grime layer) and lightens with wear (surf.x, its worn-edge layer), and
 * neither depends on vertex colour, so the grain is untouched. A *patch* is
 * a thin fan of concentric rings laid a hair over a board, merged INTO that
 * board (same colour, same material space, so it cannot be told from it)
 * and carrying only surf: grime tracks where things are dragged, a sanded
 * lighter patch, coffee rings, filled knots, old screw holes, cut marks.
 * The soft falloff to zero at the rim is what keeps them from reading as
 * stickers. Things that really are on the surface (paint drips, pencil
 * lines, tape residue, nail heads) are their own small parts.
 *
 * Everything is placed by a seeded planner that clusters work where work
 * happens (the centre and the front), not sprinkled evenly.
 */
import type { BufferGeometry } from 'three';
import { BufferAttribute } from 'three';
import { finish, MeshData } from '../../mesh.ts';
import { ATTR } from '../../types.ts';
import type { Rng } from '../../rng.ts';
import type { Token } from '../../../palette.ts';

/** How high a patch floats over its board (no z-fighting at the bench's distance; invisible edge-on). */
export const PATCH_LIFT = 0.0012;

export interface Patch {
  x: number;
  z: number;
  /** Radii along X and Z. */
  rx: number;
  rz: number;
  /** Rotation about Y (radians). */
  rot: number;
  /** Surf at ring t (0 centre .. 1 rim): [wear, cavity]. Must be [0, 0] at t = 1. */
  surf: (t: number) => [number, number];
  /** Ring positions (t values, ascending, ending at 1). */
  rings: number[];
  segs: number;
  /** A rectangle (crisp corners) instead of an ellipse: a ghost where something hung. */
  square?: boolean;
}

/** A patch as geometry at height y (normal up). Its rim carries nothing, so it melts into the board. */
export function patchGeometry(p: Patch, y: number, r: Rng): BufferGeometry {
  const md = new MeshData();
  const wear: number[] = [];
  const cav: number[] = [];
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const at = (u: number, v: number): [number, number] => [p.x + u * c - v * s, p.z + u * s + v * c];
  const centre = md.v(p.x, y, p.z, 0, 1, 0);
  const s0 = p.surf(0);
  wear.push(s0[0]);
  cav.push(s0[1]);
  // a wobbly outline: each spoke its own length (seeded), shared by every ring
  const wob = Array.from({ length: p.segs }, () => (p.square ? 1 : 1 + (r() - 0.5) * 0.35));
  let prev: number[] = [];
  for (const t of p.rings) {
    const ring: number[] = [];
    const sv = p.surf(t);
    for (let i = 0; i < p.segs; i++) {
      // a square patch puts its spokes on the corners
      const a = ((i + (p.square ? 0.5 : 0)) / p.segs) * Math.PI * 2;
      const k = t * wob[i]!;
      const cu = p.square ? Math.sign(Math.cos(a)) : Math.cos(a), su = p.square ? Math.sign(Math.sin(a)) : Math.sin(a);
      const [x, z] = at(cu * p.rx * k, su * p.rz * k);
      ring.push(md.v(x, y, z, 0, 1, 0));
      wear.push(sv[0]);
      cav.push(sv[1]);
    }
    for (let i = 0; i < p.segs; i++) {
      const j = (i + 1) % p.segs;
      if (prev.length === 0) md.tri(centre, ring[i]!, ring[j]!);
      else md.quad(prev[i]!, prev[j]!, ring[j]!, ring[i]!);
    }
    prev = ring;
  }
  const g = finish(md);
  const sf = new Float32Array(md.vertexCount * 3);
  for (let i = 0; i < md.vertexCount; i++) {
    sf[i * 3] = wear[i] ?? 0;
    sf[i * 3 + 1] = cav[i] ?? 0;
  }
  g.setAttribute(ATTR.surf, new BufferAttribute(sf, 3));
  return g;
}

/** A flat irregular blob (paint drip, speck) or strip (pencil line, residue) at height y: a fan of `n` points. */
export function blob(x: number, z: number, rx: number, rz: number, rot: number, n: number, y: number, r: Rng, ragged = 0.35): BufferGeometry {
  const md = new MeshData();
  const c = Math.cos(rot), s = Math.sin(rot);
  const centre = md.v(x, y, z, 0, 1, 0);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * ragged * 2;
    const u = Math.cos(a) * rx * k, v = Math.sin(a) * rz * k;
    ids.push(md.v(x + u * c - v * s, y, z + u * s + v * c, 0, 1, 0));
  }
  for (let i = 0; i < n; i++) md.tri(centre, ids[i]!, ids[(i + 1) % n]!);
  const g = finish(md);
  g.setAttribute(ATTR.surf, new BufferAttribute(new Float32Array(md.vertexCount * 3), 3));
  return g;
}

export interface Marks {
  patches: Patch[];
  drips: Array<{ x: number; z: number; r: number; rot: number; token: Token; long: number }>;
  lines: Array<{ x: number; z: number; len: number; rot: number }>;
  residue: Array<{ x: number; z: number; len: number; w: number; rot: number }>;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Surf profiles. */
const grimeProfile = (amount: number) => (t: number): [number, number] => [0, amount * (1 - smooth(0.2, 1, t))];
const sandProfile = (amount: number) => (t: number): [number, number] => [amount * (1 - smooth(0.45, 1, t)), 0];
const ringProfile = (amount: number) => (t: number): [number, number] => [0, t >= 1 ? 0 : amount * Math.max(0, 1 - Math.abs(t - 0.86) / 0.1) + amount * 0.12 * (1 - t)];
const dotProfile = (amount: number) => (t: number): [number, number] => [0, t >= 1 ? 0 : amount * (1 - smooth(0.5, 1, t))];

/**
 * Plan the marks of years of use over [x0, x1] × [zB, zF]. Work happens at
 * the centre and toward the front: positions are drawn from there.
 */
export function planMarks(R: Rng, x0: number, x1: number, zB: number, zF: number, low: boolean): Marks {
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  // a work spot: centred, front-weighted, a little spread
  const spot = (spread = 0.32): [number, number] => {
    const g = (): number => (R() + R() + R()) / 3 - 0.5; // soft bell
    const x = cx + g() * W * spread * 2;
    const z = zF - 1.4 - Math.abs(g()) * (zF - zB) * 0.75 + R.spread(0.5);
    return [Math.max(x0 + 0.4, Math.min(x1 - 0.4, x)), Math.max(zB + 0.5, Math.min(zF - 0.25, z))];
  };
  const m: Marks = { patches: [], drips: [], lines: [], residue: [] };
  const scale = W / 15;
  const n = (k: number): number => Math.max(1, Math.round(k * scale));
  // spokes round a patch: soft-edged grime needs few (P1 used 14; 9 reads the same and costs two thirds)
  const segs = low ? 7 : 9;
  // worn tracks along the bench (things slid left and right), front half
  for (let i = 0; i < n(4); i++) {
    const [x, z] = spot(0.4);
    m.patches.push({ x, z, rx: R.range(0.8, 1.8), rz: R.range(0.12, 0.26), rot: R.spread(0.08), surf: grimeProfile(R.range(0.85, 1)), rings: [0.55, 1], segs });
  }
  // grime where hands and tools rest
  for (let i = 0; i < n(6); i++) {
    const [x, z] = spot();
    const r0 = R.range(0.25, 0.6);
    m.patches.push({ x, z, rx: r0 * R.range(1, 1.6), rz: r0, rot: R.spread(1.5), surf: grimeProfile(R.range(0.6, 0.95)), rings: [0.5, 1], segs });
  }
  // a sanded, lighter patch (somebody took a stain out)
  {
    const [x, z] = spot(0.25);
    m.patches.push({ x, z: z - 0.6, rx: R.range(0.6, 0.9), rz: R.range(0.25, 0.38), rot: R.spread(0.15), surf: sandProfile(0.95), rings: [0.4, 0.75, 1], segs });
  }
  // coffee rings, one of them doubled
  for (let i = 0; i < n(3); i++) {
    const [x, z] = spot(0.35);
    const r0 = R.range(0.15, 0.21);
    const ring = { x, z, rx: r0, rz: r0 * R.range(0.94, 1.0), rot: R(), surf: ringProfile(1), rings: [0.76, 0.86, 0.96, 1], segs: low ? 10 : 15 };
    m.patches.push(ring);
    if (i === 0 && !low) m.patches.push({ ...ring, x: x + R.spread(0.08), z: z + R.spread(0.06), surf: ringProfile(0.7) });
  }
  // filled knots and old screw holes, anywhere
  for (let i = 0; i < n(3); i++) {
    const x = x0 + 0.5 + R() * (W - 1), z = zB + 0.8 + R() * (zF - zB - 1.6);
    m.patches.push({ x, z, rx: R.range(0.05, 0.09), rz: R.range(0.035, 0.05), rot: R.spread(0.3), surf: dotProfile(0.95), rings: [0.6, 1], segs: 7 });
  }
  if (!low) {
    for (let i = 0; i < n(5); i++) {
      const [x, z] = spot(0.45);
      for (const dx of R() < 0.5 ? [0] : [0, R.range(0.1, 0.3)]) m.patches.push({ x: x + dx, z, rx: 0.016, rz: 0.016, rot: 0, surf: dotProfile(1), rings: [0.5, 1], segs: 5 });
    }
    // knife cuts: short thin dark slits
    for (let i = 0; i < n(6); i++) {
      const [x, z] = spot(0.3);
      m.patches.push({ x, z, rx: R.range(0.06, 0.16), rz: 0.006, rot: R.spread(Math.PI), surf: dotProfile(0.9), rings: [0.6, 1], segs: 6 });
    }
  }
  // paint: a cluster of drips and specks in the paint colours, sparse
  const paints: Token[] = ['cable-red', 'paint-blue', 'tape-yellow', 'paint-green', 'paper', 'teal-light'];
  const clusters = low ? 1 : n(3);
  for (let c = 0; c < clusters; c++) {
    const [x, z] = spot(0.35);
    const token = R.pick(paints);
    const k = low ? 2 : R.int(4, 9);
    for (let i = 0; i < k; i++) {
      const big = i === 0;
      m.drips.push({ x: x + R.spread(0.25), z: z + R.spread(0.18), r: big ? R.range(0.03, 0.05) : R.range(0.007, 0.018), rot: R() * 6.28, token, long: big ? R.range(1, 1.8) : 1 });
    }
  }
  // pencil layout lines and ticks
  if (!low) {
    for (let i = 0; i < n(3); i++) {
      const [x, z] = spot(0.3);
      const len = R.range(0.35, 1.1);
      const rot = R() < 0.6 ? R.spread(0.03) : Math.PI / 2 + R.spread(0.03);
      m.lines.push({ x, z, len, rot });
      for (let t = 0; t < R.int(1, 3); t++) m.lines.push({ x: x + Math.cos(rot) * R.spread(len * 0.4), z: z - Math.sin(rot) * R.spread(len * 0.4), len: R.range(0.06, 0.1), rot: rot + Math.PI / 2 });
    }
  }
  // a strip of old tape residue
  {
    const [x, z] = spot(0.45);
    m.residue.push({ x, z, len: R.range(0.5, 0.9), w: 0.1, rot: R.spread(0.06) });
  }
  return m;
}
