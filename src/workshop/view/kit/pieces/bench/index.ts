/**
 * The stage every hero object stands on (REWRITE.md § C, art-direction § 10
 * "BENCH, WALL AND ROOM"): the bench top in bolted sections, the lane tape
 * laid on it, and the back wall. Cheap and quiet on purpose: they are seen
 * whole, at every distance, behind everything else.
 *
 *  - `benchSection({ width, depth, seed })`: wide `wood` planks running
 *    along X (seams, per-plank tone, a butt joint or two), a worn rounded
 *    front edge with a few modelled dings, a thick apron under it whose
 *    lower half falls into the dark (cavity written as a gradient, so the
 *    materials' grime takes it down), and optional steel mending plates with
 *    four bolts on the apron where sections meet. Top surface exactly y = 0;
 *    the section spans x ±width/2 and z ±depth/2; its front is +Z.
 *  - `bench({ sections, width, depth, seed })`: sections side by side,
 *    bolted together; centred on x = 0.
 *  - `laneTape({ points, seed })`: `tape-yellow` floor tape laid along a
 *    polyline in the bench plane (points are [x, z]; repeat the first point
 *    last to close it): strips overlapping at the corners, wavy edges, a
 *    torn end on an open run, one bubble. Real thickness, each strip a hair
 *    higher than the last, so nothing z-fights.
 *  - `backWall({ width, height, seed })`: dark vertical boards (`teal-deep`
 *    wood), a skirting, a few nail heads. Stands on y = 0 with its face at
 *    z = 0 looking +Z (place it at the back of the bench, z = -depth/2).
 */
import { Matrix4, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { aim, chain, large, part, piece, T, type NodeBuilder } from '../../compose.ts';
import { dent, transform } from '../../deform.ts';
import { hexBolt } from '../../details.ts';
import { finish, MeshData } from '../../mesh.ts';
import { rng, type Rng } from '../../rng.ts';
import { ATTR } from '../../types.ts';
import { bevelBox, stud } from '../crate/geo.ts';
import { blob, patchGeometry, planMarks, PATCH_LIFT, type Patch } from './dress.ts';
import { mergeGeometries } from '../../compose.ts';
import { setFinish } from '../../space.ts';
import { tint } from '../../surface.ts';
import { grain } from '../../space.ts';

export interface BenchSectionOptions extends KitOptions {
  /** Along X (default 5). */
  width?: number;
  /** Along Z (default 10). */
  depth?: number;
  /** Thickness of the top (default 0.36). */
  thickness?: number;
  /** Height of the apron under the front edge (default 0.75). */
  apron?: number;
  /** Mending plates at the section's ends (default none): where it meets its neighbours. */
  joints?: { left?: boolean; right?: boolean };
}

const NOSE_R = 0.15; // the worn, rounded front edge
const NOSE_STEP = 0.11; // rows along X on the nose (the dings need them)

/** The front plank: a flat top that rolls over a fat rounded nose into the front face; built along X with rows for the dings. */
function nosePlank(x0: number, x1: number, zBack: number, zFront: number, T: number, detail: 'high' | 'low', caps: { left: boolean; right: boolean }): BufferGeometry {
  const r = NOSE_R, rb = 0.025, cb = 0.012;
  const arc = detail === 'low' ? 3 : 6;
  // cross-section (z, y, nz, ny), from the back of the top round the nose to the underside
  const sec: Array<[number, number, number, number]> = [];
  sec.push([zBack + cb, 0, 0, 1]);
  sec.push([zFront - r, 0, 0, 1]);
  for (let i = 1; i < arc; i++) {
    const a = (i / arc) * (Math.PI / 2);
    sec.push([zFront - r + Math.sin(a) * r, -r + Math.cos(a) * r, Math.sin(a), Math.cos(a)]);
  }
  sec.push([zFront, -r, 1, 0]);
  sec.push([zFront, -T + rb, 1, 0]);
  sec.push([zFront - rb * 0.3, -T + rb * 0.3, 0.7, -0.7]);
  sec.push([zFront - rb, -T, 0, -1]);
  const n = Math.max(2, Math.round((x1 - x0) / (detail === 'low' ? NOSE_STEP * 2 : NOSE_STEP)));
  const md = new MeshData();
  const rows: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    rows.push(sec.map(([z, y, nz, ny]) => md.v(x, y, z, 0, ny, nz)));
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < sec.length - 1; k++) md.quad(rows[i]![k]!, rows[i]![k + 1]!, rows[i + 1]![k + 1]!, rows[i + 1]![k]!);
  // the back chamfer down into the seam, and the end caps (end grain at the bench's ends)
  for (const [xi, sx] of [[0, -1], [n, 1]] as const) {
    if (!(sx < 0 ? caps.left : caps.right)) continue;
    const x = x0 + ((x1 - x0) * xi) / n;
    const pts: Array<[number, number]> = [[zBack, -cb], ...sec.map(([z, y]) => [z, y] as [number, number]), [zBack, -T]];
    const ids = pts.map(([z, y]) => md.v(x, y, z, sx, 0, 0));
    const cz = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const c = md.v(x, cy, cz, sx, 0, 0);
    for (let k = 0; k < ids.length; k++) md.tri(c, ids[k]!, ids[(k + 1) % ids.length]!);
  }
  // the chamfer at the back edge of the top (into the seam) and the back face
  const b0 = md.v(x0, 0, zBack + cb, 0, 0.7, -0.7), b1 = md.v(x1, 0, zBack + cb, 0, 0.7, -0.7);
  const c0 = md.v(x0, -cb, zBack, 0, 0.7, -0.7), c1 = md.v(x1, -cb, zBack, 0, 0.7, -0.7);
  md.quad(b0, b1, c1, c0);
  const d0 = md.v(x0, -cb, zBack, 0, 0, -1), d1 = md.v(x1, -cb, zBack, 0, 0, -1);
  const e0 = md.v(x0, -T, zBack, 0, 0, -1), e1 = md.v(x1, -T, zBack, 0, 0, -1);
  md.quad(d0, d1, e1, e0);
  return finish(md, { wear: [2, 8] }); // the whole roll of the nose reads worn (lighter)
}

/** Write a top-to-bottom cavity ramp (the apron falling into the dark). */
function darkenDown(g: BufferGeometry, yTop: number, yBottom: number, amount: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const s = g.getAttribute(ATTR.surf);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (yTop - pos.getY(i)) / (yTop - yBottom)));
    s.setY(i, Math.max(s.getY(i), Math.min(1, t * t * amount)));
  }
  s.needsUpdate = true;
  return g;
}

/** How dark the bench reads against what stands on it: the `wood` token, taken well down (walnut in lamplight, not pine). */
const BENCH_SHADE = 0.55;

interface TopOptions {
  x0: number;
  x1: number;
  depth: number;
  thickness: number;
  apron: number;
  detail: 'high' | 'low';
  /** x of each joint between bolted sections (inside x0..x1): a fine seam in the nose and apron, and a mending plate. */
  joints: number[];
  /** Plates also at the outer ends (a lone section showing where its neighbours bolt on). */
  endPlates?: { left?: boolean; right?: boolean };
}

/**
 * The bench top: long boards running the whole length in rows, each row cut
 * into boards of uneven length so the butt joints stagger (grain flows
 * along each board, tone barely changes board to board); the nose plank and
 * the apron are cut at the section joints with a fine seam, and the joints
 * carry steel mending plates on the apron.
 */
function addTop(b: NodeBuilder, R: Rng, o: TopOptions): void {
  const { x0, x1, depth } = o;
  const T = o.thickness;
  const low = o.detail === 'low';
  const zF = depth / 2, zB = -depth / 2;
  const nP = Math.max(3, Math.round(depth / 1.15));
  const gap = 0.012;
  const widths = Array.from({ length: nP }, () => 1 + R.spread(0.12));
  const sum = widths.reduce((s, w) => s + w, 0);
  const avail = depth - gap * (nP - 1);
  const seam = 0.003;
  const tone = (): { seed: number; jitter: number; warm: number; shade: number } => ({ seed: R.int(0, 1e6), jitter: 0.045, warm: 0.02, shade: BENCH_SHADE });
  const cuts = [x0, ...o.joints, x1];
  // every top board, collected first so the marks of use can be merged into the board they lie on
  interface Board { g: BufferGeometry; tone: ReturnType<typeof tone>; xa: number; xb: number; za: number; zb: number; y: number }
  const boards: Board[] = [];
  let z = zB;
  for (let i = 0; i < nP; i++) {
    const pw = (widths[i]! / sum) * avail;
    const za = z, zb = z + pw;
    if (i === nP - 1) {
      // the nose plank, one length per section
      for (let k = 0; k < cuts.length - 1; k++) {
        const xa = cuts[k]! + (k > 0 ? seam : 0), xb = cuts[k + 1]! - (k < cuts.length - 2 ? seam : 0);
        const g = nosePlank(xa, xb, za, zb, T, o.detail, { left: true, right: true });
        if (!low) {
          // knocks along the front edge where things were dropped
          const dings = Math.max(2, Math.round((xb - xa) * 1.5));
          for (let d = 0; d < dings; d++) {
            const x = xa + 0.25 + R() * (xb - xa - 0.5);
            const a = R.range(0.2, 1.3);
            dent(g, [x, -NOSE_R + Math.cos(a) * NOSE_R, zb - NOSE_R + Math.sin(a) * NOSE_R], [0, Math.cos(a), Math.sin(a)], R.range(0.035, 0.09), R.range(0.008, 0.02));
          }
          // a chipped corner at one end of the length
          const end = R() < 0.5 ? xa : xb;
          dent(g, [end, -0.02, zb - 0.02], [end === xa ? -1 : 1, 0.6, 0.6], 0.12, 0.035);
        }
        boards.push({ g, tone: tone(), xa, xb, za, zb: zb - NOSE_R, y: 0 });
      }
    } else {
      // boards of uneven length, butt joints staggered row to row
      const xs = [x0];
      let x = x0 + R.range(1.2, 5.5);
      while (x < x1 - 1.0) {
        xs.push(x);
        x += R.range(3.4, 6.8);
      }
      xs.push(x1);
      for (let k = 0; k < xs.length - 1; k++) {
        const xa = xs[k]! + (k > 0 ? seam : 0), xb = xs[k + 1]! - (k < xs.length - 2 ? seam : 0);
        // the odd board has shrunk or settled a hair below its neighbours (never above the plane y = 0)
        const y = R() < 0.3 ? -R.range(0.0015, 0.004) : 0;
        const g = bevelBox({ min: [xa, -T + y, za], max: [xb, y, zb], c: low ? 0.008 : 0.012, omit: ['ny'], wear: 0.7 });
        boards.push({ g, tone: tone(), xa, xb, za, zb, y });
      }
    }
    z = zb + gap;
  }

  // ---- years of use (dress.ts): marks merged into their boards, things lying on top as parts ----
  const marks = planMarks(R, x0, x1, zB, zF, low);
  const inset = 0.02;
  const fits = (bd: Board, x: number, zz: number, rx: number, rz: number): boolean =>
    x - rx >= bd.xa + inset && x + rx <= bd.xb - inset && zz - rz >= bd.za + inset && zz + rz <= bd.zb - inset;
  const extra = new Map<Board, BufferGeometry[]>();
  for (const pt of marks.patches) {
    // the patch's reach along X and Z (rotated ellipse, with the outline's wobble)
    const c = Math.abs(Math.cos(pt.rot)), sn = Math.abs(Math.sin(pt.rot));
    const ex = (pt.rx * c + pt.rz * sn) * 1.2, ez = (pt.rx * sn + pt.rz * c) * 1.2;
    const home = boards.find((q) => pt.x >= q.xa && pt.x <= q.xb && pt.z >= q.za && pt.z <= q.zb);
    if (!home) continue;
    // slide it across its board until it fits, if it can
    pt.z = Math.max(home.za + ez + inset, Math.min(home.zb - ez - inset, pt.z));
    if (!fits(home, pt.x, pt.z, ex, ez)) continue;
    const list = extra.get(home) ?? [];
    list.push(patchGeometry(pt, home.y + PATCH_LIFT, R));
    extra.set(home, list);
  }
  for (const bd of boards) {
    tint(bd.g, 'wood', bd.tone);
    const more = extra.get(bd) ?? [];
    for (const m of more) tint(m, 'wood', bd.tone); // exactly the board's colour: only its surf shows
    const g = more.length ? mergeGeometries([bd.g, ...more]) : bd.g;
    b.add(large({ material: 'wood', geometry: g }));
  }
  const topAt = (x: number, zz: number): number => boards.find((q) => x >= q.xa && x <= q.xb && zz >= q.za && zz <= q.zb)?.y ?? 0;
  for (const d of marks.drips) {
    const g = setFinish(blob(d.x, d.z, d.r * d.long, d.r, d.rot, low ? 6 : 9, topAt(d.x, d.z) + 0.0016, R), 1);
    b.add(part('wood', g, d.token, { seed: R.int(0, 1e6), jitter: 0.04 }));
  }
  for (const l of marks.lines) {
    const g = blob(l.x, l.z, l.len / 2, 0.0032, l.rot, 6, topAt(l.x, l.z) + 0.0014, R, 0.04);
    b.add(part('metal', g, 'ink', { seed: R.int(0, 1e6), shade: 1.6, jitter: 0.1 })); // graphite: a dull sheen
  }
  for (const t of marks.residue) {
    const g = blob(t.x, t.z, t.len / 2, t.w / 2, t.rot, 14, topAt(t.x, t.z) + 0.0013, R, 0.12);
    b.add(part('paper', g, 'paper', { seed: R.int(0, 1e6), shade: 0.16, warm: 0.15 })); // old, yellowed, dirty
  }
  // nail heads where the boards cross the bearers under them
  if (!low) {
    const bearers: number[] = [];
    for (let k = 0; k < cuts.length - 1; k++) bearers.push(cuts[k]! + 0.32, (cuts[k]! + cuts[k + 1]!) / 2, cuts[k + 1]! - 0.32);
    for (const bx of bearers) {
      for (const bd of boards) {
        if (bx < bd.xa + 0.05 || bx > bd.xb - 0.05) continue;
        const w = bd.zb - bd.za;
        for (const f of [0.24, 0.76]) {
          if (R() < 0.12) continue; // pulled, or never driven
          const at: [number, number, number] = [bx + R.spread(0.03), bd.y, bd.za + w * f + R.spread(0.04)];
          const s = grain(stud(0.016, 0.0045, 5), 'y');
          b.add(part('metal', transform(s, aim(at, [0, 1, 0], R.range(0, 72))), 'steel', { seed: R.int(0, 1e6), shade: 0.45, jitter: 0.15 }));
        }
      }
    }
  }
  // the apron under the front edge, one length per section, its lower half in the dark
  const ap = o.apron;
  const za = zF - 0.05;
  for (let k = 0; k < cuts.length - 1; k++) {
    const xa = cuts[k]! + (k > 0 ? seam : 0), xb = cuts[k + 1]! - (k < cuts.length - 2 ? seam : 0);
    const g = bevelBox({ min: [xa, -T - ap, za - 0.12], max: [xb, -T + 0.001, za], c: 0.016, omit: ['py', 'nz'], wear: 0.6 });
    darkenDown(g, -T - 0.03, -T - ap, 2.2);
    b.add(large(part('wood', g, 'wood', { ...tone(), shade: BENCH_SHADE * 0.62 })));
  }
  // steel mending plates over the joints, four bolts each
  const plates = [...o.joints, ...(o.endPlates?.left ? [x0] : []), ...(o.endPlates?.right ? [x1] : [])];
  for (const xj of plates) {
    const pw = 0.34, ph = 0.3, pt = 0.012;
    const yc = -T - ap * 0.42 + R.spread(0.02);
    const xc = xj + R.spread(0.01);
    const plate = bevelBox({ min: [xc - pw / 2, yc - ph / 2, za], max: [xc + pw / 2, yc + ph / 2, za + pt], c: 0.004, omit: ['nz'], wear: 0.9 });
    b.add(part('metal', plate, 'steel', { seed: R.int(0, 1e6), shade: 0.55, jitter: 0.06 }));
    for (const [dx, dy] of [[-0.11, -0.09], [0.11, -0.09], [-0.11, 0.09], [0.11, 0.09]] as const) {
      const s = R.int(0, 999);
      b.small(() => hexBolt({ af: 0.05, washer: true, detail: o.detail, seed: s }).map((q) => ({ ...q, geometry: transform(q.geometry, aim([xc + dx + R.spread(0.004), yc + dy + R.spread(0.004), za + pt], [0, 0, 1], R.range(0, 60))) })));
    }
  }
}

/** One bench section (see the file note). */
export function benchSection(o: BenchSectionOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const width = o.width ?? 5, depth = o.depth ?? 10;
  const b = piece('bench-section', { detail, seed, ao: { distance: 0.25 } });
  addTop(b, rng(seed), { x0: -width / 2, x1: width / 2, depth, thickness: o.thickness ?? 0.36, apron: o.apron ?? 0.75, detail, joints: [], endPlates: o.joints ?? {} });
  return b.build();
}

export interface BenchOptions extends Omit<BenchSectionOptions, 'joints'> {
  /** Number of sections side by side (default 2). */
  sections?: number;
}

/** Several sections bolted together, centred on x = 0: the boards run on across the joints; the joints show in the nose, the apron and the plates. */
export function bench(o: BenchOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const n = Math.max(1, o.sections ?? 2);
  const width = o.width ?? 5, depth = o.depth ?? 10;
  const b = piece('bench', { detail, seed, ao: { distance: 0.25 } });
  const x0 = -(n * width) / 2;
  addTop(b, rng(seed), { x0, x1: -x0, depth, thickness: o.thickness ?? 0.36, apron: o.apron ?? 0.75, detail, joints: Array.from({ length: n - 1 }, (_, i) => x0 + (i + 1) * width) });
  return b.build();
}

// ---- lane tape ------------------------------------------------------------------

export interface LaneTapeOptions extends KitOptions {
  /** Polyline in the bench plane, [x, z] each; repeat the first point last to close it. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Tape width (default 0.12). */
  width?: number;
}

const TAPE_T = 0.004;

/** One strip of tape from a to b (local X along the strip), wavy edges, optional torn end and bubble. */
function strip(len: number, w: number, y: number, R: Rng, o: { torn: boolean; bubbleAt: number | null; detail: 'high' | 'low' }): BufferGeometry {
  const md = new MeshData();
  const step = o.detail === 'low' ? 0.5 : 0.22;
  const xs: number[] = [];
  for (let x = 0; x < len; x += step) xs.push(x);
  xs.push(len);
  if (o.detail !== 'low') xs.push(0.035, len - 0.035); // rows near the ends, which lift a little
  if (o.bubbleAt !== null) {
    for (let k = -4; k <= 4; k++) xs.push(o.bubbleAt + k * 0.02);
  }
  const rowsX = [...new Set(xs.filter((x) => x >= 0 && x <= len).map((x) => Math.round(x * 1e5) / 1e5))].sort((a, b) => a - b);
  const cols = [-1, -0.5, 0, 0.5, 1];
  // edge waviness: a slow wander per edge, sampled by a seeded walk
  const wobble = (seedOff: number) => {
    const a = R.range(0, 6.28), f = R.range(2.5, 5), g = R.range(9, 15), b2 = R.range(0, 6.28);
    return (x: number): number => (Math.sin(a + x * f + seedOff) * 0.0016 + Math.sin(b2 + x * g) * 0.0009);
  };
  const wl = wobble(0), wr = wobble(1.7);
  const bub = o.bubbleAt;
  const bubZ = R.spread(w * 0.15);
  const top: number[][] = [];
  const tornJag = cols.map(() => R.spread(0.012));
  const liftAmt = R.range(0.5, 1.2);
  // where wheels and boxes cross it, the middle is scuffed dull: a few runs along the strip
  const runs = Array.from({ length: 1 + R.int(0, 2) }, () => [R() * len, R.range(0.25, 0.7), R.range(0.45, 0.8)] as const);
  const scuffAt = (x: number): number => runs.reduce((m, [x0, l, a]) => Math.max(m, a * Math.max(0, 1 - Math.abs(x - x0) / l)), 0);
  for (const x of rowsX) {
    const row: number[] = [];
    for (const c of cols) {
      let z = (c * w) / 2;
      if (c === -1) z += wl(x);
      if (c === 1) z += wr(x);
      let xx = x;
      if (o.torn && x === len) xx = len + tornJag[cols.indexOf(c)]!;
      let yy = y + TAPE_T;
      // the ends have let go a little: lifted most at the corners
      const fromEnd = Math.min(x, len - x);
      if (o.detail !== 'low' && fromEnd < 0.035) yy += (1 - fromEnd / 0.035) * (0.0012 + 0.0022 * Math.abs(c)) * liftAmt;
      if (bub !== null) {
        const d = Math.hypot((x - bub) / 0.065, (z - bubZ) / 0.045);
        if (d < 1) yy += 0.0055 * (1 - d * d) * (1 - d * d);
      }
      row.push(md.v(xx, yy, z, 0, 1, 0));
    }
    top.push(row);
  }
  for (let i = 0; i < top.length - 1; i++) for (let k = 0; k < cols.length - 1; k++) md.quad(top[i]![k]!, top[i]![k + 1]!, top[i + 1]![k + 1]!, top[i + 1]![k]!);
  // the two long edges (its thickness) and the two ends
  const wear: number[] = new Array<number>(md.vertexCount).fill(0);
  const side = (k: number, nz: number): void => {
    let prevT = -1, prevB = -1;
    for (let i = 0; i < top.length; i++) {
      const id = top[i]![k]!;
      const px = md.pos[id * 3]!, pz = md.pos[id * 3 + 2]!;
      const t = md.v(px, md.pos[id * 3 + 1]!, pz, 0, 0.3, nz);
      const bt = md.v(px, y, pz, 0, 0, nz);
      wear.push(0.8, 0.3);
      if (prevT >= 0) md.quad(prevT, t, bt, prevB);
      prevT = t;
      prevB = bt;
    }
  };
  side(0, -1);
  side(cols.length - 1, 1);
  for (const i of [0, top.length - 1]) {
    const nx = i === 0 ? -1 : 1;
    let prevT = -1, prevB = -1;
    for (let k = 0; k < cols.length; k++) {
      const id = top[i]![k]!;
      const px = md.pos[id * 3]!, pz = md.pos[id * 3 + 2]!;
      const t = md.v(px, md.pos[id * 3 + 1]!, pz, nx, 0.3, 0);
      const bt = md.v(px, y, pz, nx, 0, 0);
      wear.push(0.8, 0.3);
      if (prevT >= 0) md.quad(prevT, t, bt, prevB);
      prevT = t;
      prevB = bt;
    }
  }
  // the top's edge vertices are worn too
  rowsX.forEach((x, i) => {
    const row = top[i]!;
    wear[row[0]!] = 0.6;
    wear[row[cols.length - 1]!] = 0.6;
    const sc = scuffAt(x);
    wear[row[1]!] = sc * 0.7;
    wear[row[2]!] = sc;
    wear[row[3]!] = sc * 0.7;
  });
  const g = finish(md);
  const s = g.getAttribute(ATTR.surf);
  for (let i = 0; i < s.count; i++) s.setXYZ(i, wear[i] ?? 0, 0, 0);
  return g;
}

/** Floor tape along a polyline (see the file note). */
export function laneTape(o: LaneTapeOptions): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const w = o.width ?? 0.12;
  const pts = o.points;
  const closed = pts.length > 2 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1];
  const b = piece('lane-tape', { detail, seed, ao: false });
  const nSeg = pts.length - 1;
  const bubbleSeg = R.int(0, Math.max(0, nSeg - 1));
  for (let i = 0; i < nSeg; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    // strips overlap at corners: run past each joined end by half the width (laid by hand: a little more or less)
    const pre = i > 0 || closed ? w / 2 + R.spread(0.01) : 0;
    const post = i < nSeg - 1 || closed ? w / 2 + R.spread(0.01) : 0;
    const len = L + pre + post;
    const bubbleAt = i === bubbleSeg && detail === 'high' ? R.range(0.25, 0.75) * len : null;
    const g = strip(len, w, 0.0006 * i, R, { torn: !closed && i === nSeg - 1, bubbleAt, detail });
    // laid by hand: a fraction of a degree off the line
    const ang = Math.atan2(-dz, dx) + R.spread(0.004);
    transform(g, chain(T(ax, 0, az), new Matrix4().makeRotationY(ang), T(-pre, 0, 0)));
    b.add(part('tape', g, 'tape-yellow', { seed: R.int(0, 1e6), jitter: 0.04, shade: 0.8, warm: 0.03 })); // a little darker and dirtier than the token: the Button's hazard plate owns pure yellow
  }
  return b.build();
}

// ---- the back wall --------------------------------------------------------------------

export interface BackWallOptions extends KitOptions {
  /** Along X (default 20). */
  width?: number;
  /** Default 6. */
  height?: number;
}

/** The dark boarded wall behind the bench (see the file note). */
export function backWall(o: BackWallOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const R = rng(seed);
  const width = o.width ?? 20, height = o.height ?? 6;
  const b = piece('back-wall', { detail, seed, ao: { distance: 0.2 } });
  const t = 0.05;
  const skirtH = 0.26, skirtT = 0.045;
  const dadoY = 2.15 + R.spread(0.03), dadoH = 0.13;
  // where something once hung: a lighter rectangle, crisp-edged, cut by the board seams
  const ghost = { x0: R.range(-width * 0.3, width * 0.1), y0: R.range(2.6, 3.2), w: R.range(1.1, 1.6), h: R.range(0.8, 1.1) };
  // scuffs low down where things were stood against it
  const scuffs = Array.from({ length: low ? 0 : Math.round(width / 3) }, () => ({ x: R.range(-width / 2 + 0.5, width / 2 - 0.5), y: R.range(0.45, 1.3), rx: R.range(0.12, 0.3), ry: R.range(0.1, 0.35) }));
  let x = -width / 2;
  const nails: number[][] = [];
  const toWall = new Matrix4().set(0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); // (x, y, z) -> (-y, x, z): X up
  const flipX = new Matrix4().makeScale(-1, 1, 1);
  const fromPlan = new Matrix4().makeRotationX(Math.PI / 2); // a patch laid in XZ, stood up to face +Z
  /** A patch on the wall at (x, y = pt.z), its material space set to match the board's (grain up the board). */
  const wallPatch = (pt: Patch, zLift: number): BufferGeometry => {
    const g = patchGeometry({ ...pt, z: -pt.z }, 0, R);
    transform(g, fromPlan);
    transform(g, new Matrix4().makeTranslation(0, 0, zLift));
    const pos = g.getAttribute('position');
    const lp = g.getAttribute(ATTR.lpos);
    for (let i = 0; i < pos.count; i++) lp.setXYZ(i, pos.getY(i), pos.getX(i), pos.getZ(i));
    return g;
  };
  while (x < width / 2 - 1e-3) {
    const bw = Math.min(width / 2 - x, 0.68 + R.spread(0.12));
    const gap = 0.012;
    const xa = x, xb = x + bw - gap;
    // a board standing up: built along X (its grain), then stood on end
    const g = bevelBox({ min: [0, xa, -t], max: [height + R.spread(0.02), xb, 0], c: low ? 0.006 : 0.01, omit: ['nz', 'nx'], wear: 0.6 });
    transform(g, toWall);
    transform(g, flipX);
    // a step lighter than the room: between teal-deep and teal-panel, board by board
    const tone = R() < 0.5 ? { token: 'teal-deep' as const, shade: R.range(1.35, 1.75) } : { token: 'teal-panel' as const, shade: R.range(0.55, 0.72) };
    const tn = { seed: R.int(0, 1e6), jitter: 0.06, shade: tone.shade, warm: R.spread(0.05) };
    tint(g, tone.token, tn);
    const more: BufferGeometry[] = [];
    if (!low) {
      const ox0 = Math.max(xa + 0.02, ghost.x0), ox1 = Math.min(xb - 0.02, ghost.x0 + ghost.w);
      if (ox1 - ox0 > 0.05) {
        more.push(wallPatch({ x: (ox0 + ox1) / 2, z: ghost.y0 + ghost.h / 2, rx: (ox1 - ox0) / 2, rz: ghost.h / 2, rot: 0, surf: (tt) => [tt >= 1 ? 0 : 0.75, 0], rings: [0.96, 1], segs: 4, square: true }, 0.0012));
      }
      for (const sc of scuffs) {
        if (sc.x - sc.rx < xa + 0.02 || sc.x + sc.rx > xb - 0.02) continue;
        more.push(wallPatch({ x: sc.x, z: sc.y, rx: sc.rx, rz: sc.ry, rot: R.spread(0.6), surf: (tt) => [0, tt >= 1 ? 0 : 0.5 * (1 - tt)], rings: [0.5, 1], segs: 10 }, 0.0012));
      }
    }
    for (const m of more) tint(m, tone.token, tn);
    b.add(large({ material: 'wood', geometry: more.length ? mergeGeometries([g, ...more]) : g }));
    if (!low) for (const yy of [1.35, 3.9]) nails.push([(xa + xb) / 2 + R.spread(0.05), yy + R.spread(0.04)]);
    x += bw;
  }
  // the skirting and a dado rail
  const sk = bevelBox({ min: [-width / 2, 0, 0], max: [width / 2, skirtH, skirtT], c: 0.016, omit: ['ny', 'nz'], wear: 0.8 });
  b.add(large(part('wood', sk, 'wood', { seed: R.int(0, 1e6), shade: 0.45, jitter: 0.04 })));
  const dado = bevelBox({ min: [-width / 2, dadoY, 0], max: [width / 2, dadoY + dadoH, 0.035], c: 0.012, omit: ['nz'], wear: 0.85 });
  b.add(large(part('wood', dado, 'teal-panel', { seed: R.int(0, 1e6), shade: 0.55, jitter: 0.04 })));
  // nail heads (some boards lost theirs), the two that held whatever hung there, and the dado's
  if (!low) {
    nails.push([ghost.x0 + ghost.w * 0.2, ghost.y0 + ghost.h - 0.06, 0.0001], [ghost.x0 + ghost.w * 0.8, ghost.y0 + ghost.h - 0.06, 0.0001]);
    for (let xx = -width / 2 + 0.4; xx < width / 2 - 0.2; xx += R.range(1.1, 1.8)) nails.push([xx, dadoY + dadoH / 2, 0.035]);
  }
  for (const nl of nails) {
    if (nl.length === 2 && R() < 0.3) continue;
    const s = grain(stud(0.011, 0.005, 5), 'y');
    b.add(part('metal', transform(s, aim([nl[0]!, nl[1]!, nl[2] ?? 0], [0, 0, 1], R.range(0, 72))), 'steel', { seed: R.int(0, 1e6), shade: 0.35, jitter: 0.12 }));
  }
  return b.build();
}

// ---- catalogue -------------------------------------------------------------------

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const kit = (opts: Record<string, unknown>): KitOptions => ({
  ...(typeof opts['seed'] === 'number' ? { seed: opts['seed'] } : {}),
  ...(opts['detail'] === 'low' || opts['detail'] === 'high' ? { detail: opts['detail'] } : {}),
});

/** The taped bay used by the catalogue: a rectangle with one open, torn run beside it. */
export const SAMPLE_TAPE: ReadonlyArray<readonly [number, number]> = [[-2, -1.2], [2, -1.2], [2, 1.4], [-2, 1.4], [-2, -1.2]];

export const catalogue: CatalogueEntry[] = [
  {
    name: 'bench',
    build: (opts = {}) => bench({ ...kit(opts), sections: num(opts['sections'], 3), width: num(opts['width'], 6.5), depth: num(opts['depth'], 10) }),
    variants: { 'three sections': {}, 'one section': { sections: 1, width: 5 }, low: { detail: 'low' } },
    camera: { distance: 16 },
    note: 'Three bolted bench sections (x ±9.75, joints off-centre): wide planks, worn rounded nose, apron falling into the dark. Top at y = 0.',
  },
  {
    name: 'lane-tape',
    build: (opts = {}) => laneTape({ ...kit(opts), points: SAMPLE_TAPE }),
    variants: { bay: {} },
    camera: { distance: 7 },
    note: 'Yellow floor tape along a polyline: overlapping corners, wavy edges, a bubble, a torn end on open runs.',
  },
  {
    name: 'back-wall',
    build: (opts = {}) => backWall({ ...kit(opts), width: num(opts['width'], 12), height: num(opts['height'], 5) }),
    variants: { wall: {} },
    camera: { distance: 14 },
    note: 'Dark boarded back wall with a skirting and a few nail heads; face at z = 0.',
  },
];

export type { Rng };
