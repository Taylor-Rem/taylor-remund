/**
 * The six hand tools of the tool wall (REWRITE.md § D9, art-direction § 10
 * TOOL WALL). Each stands for a technology Taylor works with and is a part
 * like any other (§ B1): it will be lifted, thrown, painted and shipped, so
 * each is its own Piece with a sensible `size` for a box collider.
 *
 *   laravel  open-ended spanner, red dipped grip      (`cable-red`)
 *   vue      screwdriver, fluted wooden handle        (`paint-green`)
 *   php      claw hammer, wooden handle               (`paint-violet`)
 *   python   slip-joint pliers, dipped grips          (`paint-blue`)
 *   rust     flat file, pear-shaped wooden handle     (`paint-orange`)
 *   sql      try-square, wooden stock, steel blade    (`tape-yellow`)
 *
 * Frame of every tool: built HANGING, its length along +Y from about y = 0,
 * centred on x = 0 and on z = 0 (its thickness), the good side facing +Z.
 * Steel heads are the `metal` class; wooden handles are painted `wood` (finish
 * = paint coverage, thinner where hands wore it); dipped grips are enamel.
 *
 * `toolShape(kind)` gives what the wall needs without building the tool: the
 * pegs it hangs from (tool-local), and its outline as polygons for the
 * painted shadow behind it.
 */
import { BufferAttribute, Matrix4, ShapeUtils, Vector2 } from 'three';
import type { BufferGeometry } from 'three';
import type { Token } from '../../../palette.ts';
import type { KitPart, Piece } from '../../types.ts';
import type { NodeBuilder } from '../../compose.ts';
import { chain, mergeGeometries, part, piece, T } from '../../compose.ts';
import { extrude, lathe, roundedBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath, sections, pathLength, arcPath, helixPath } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { finish, MeshData } from '../../mesh.ts';
import { bevelBox, ridgedBand, stud } from '../../cheap.ts';
import { rng } from '../../rng.ts';
import { ATTR } from '../../types.ts';

/** P4 T2: eight; FLUTTER and CLAUDE CODE joined the six (REWRITE.md § D9). */
export const TOOL_KINDS = ['laravel', 'vue', 'php', 'python', 'rust', 'sql', 'flutter', 'claude-code'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/**
 * Each tool's handle colour (§ 10): the colour it is known by, the one its things answer in. P4 T2, PROPOSED for the
 * owner: FLUTTER teal-light (nearest its own light blue among the paints), CLAUDE CODE paper (a cream enamel).
 */
export const TOOL_PAINT: Record<ToolKind, Token> = {
  laravel: 'cable-red',
  vue: 'paint-green',
  php: 'paint-violet',
  python: 'paint-blue',
  rust: 'paint-orange',
  sql: 'tape-yellow',
  flutter: 'teal-light',
  'claude-code': 'paper',
};

type P2 = [number, number];

export interface ToolShape {
  /** Where the board's pegs go, tool-local (x, y); the first is the `peg` socket. */
  pegs: P2[];
  /** Outline polygons (tool-local x, y), already grown a little: the painted shadow. */
  shadow: P2[][];
  /** Turn on the wall, degrees about Z (the file rests on its side). */
  turn: number;
}

// ---- small helpers -----------------------------------------------------------------

/** Grow a simple polygon by d (mitred, clamped). Works for either winding. */
export function grow(poly: readonly P2[], d: number): P2[] {
  const n = poly.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!, q = poly[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  const s = a > 0 ? 1 : -1; // CCW: outward normal is (dy, -dx)
  return poly.map((p, i) => {
    const pr = poly[(i - 1 + n) % n]!, nx = poly[(i + 1) % n]!;
    const e0 = [p[0] - pr[0], p[1] - pr[1]], e1 = [nx[0] - p[0], nx[1] - p[1]];
    const l0 = Math.hypot(e0[0]!, e0[1]!) || 1, l1 = Math.hypot(e1[0]!, e1[1]!) || 1;
    const n0 = [(s * e0[1]!) / l0, (-s * e0[0]!) / l0], n1 = [(s * e1[1]!) / l1, (-s * e1[0]!) / l1];
    let mx = n0[0]! + n1[0]!, my = n0[1]! + n1[1]!;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = Math.max(0.8, mx * n1[0]! + my * n1[1]!);
    return [p[0] + (mx * d) / cos, p[1] + (my * d) / cos];
  });
}

/** A lathe profile [r, y][] as a 2D outline round x = cx (both sides). */
function turnedOutline(rs: ReadonlyArray<readonly [number, number]>, cx = 0): P2[] {
  const right = rs.map(([r, y]) => [cx + r, y] as P2);
  const left = [...rs].reverse().map(([r, y]) => [cx - r, y] as P2);
  return [...right, ...left];
}

const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function ellipsePts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const rot2 = (p: readonly P2[], ang: number, c: P2 = [0, 0]): P2[] =>
  p.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(ang) - (y - c[1]) * Math.sin(ang), c[1] + (x - c[0]) * Math.sin(ang) + (y - c[1]) * Math.cos(ang)]);

/** Steel. */
const steel = (g: BufferGeometry, seed: number, shade = 1): KitPart => part('metal', g, 'steel', { seed, jitter: 0.05, shade });

/**
 * Painted wood: the paint is thick (coverage `cover`) and thins where the part is worn (its
 * wear channel), so edges and the knob show the wood; `rub` takes it off more along a band
 * of y where hands hold it.
 */
function paintedWood(g: BufferGeometry, token: Token, seed: number, cover = 0.96, rub?: { y0: number; y1: number; amount: number }): KitPart {
  const p = part('wood', g, token, { seed, jitter: 0.04 });
  const s = g.getAttribute(ATTR.surf) as BufferAttribute;
  const pos = g.getAttribute('position');
  for (let i = 0; i < s.count; i++) {
    let f = cover - 0.55 * s.getX(i);
    if (rub) {
      const y = pos.getY(i);
      const t = Math.max(0, Math.min(1, Math.min((y - rub.y0) / 0.08, (rub.y1 - y) / 0.08)));
      f -= rub.amount * t;
    }
    s.setZ(i, Math.max(0.05, Math.min(1, f)));
  }
  s.needsUpdate = true;
  return p;
}

/** A dipped grip: enamel in the tool's colour, satin. */
const dipped = (g: BufferGeometry, token: Token, seed: number): KitPart => part('steel', g, token, { seed, jitter: 0.03, shade: 0.95 });

/** Flat quads on the plane z = z0 facing +Z (file teeth, rule ticks). */
function marks(segs: ReadonlyArray<readonly [P2, P2]>, width: number, z0: number): BufferGeometry {
  const md = new MeshData();
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (width / 2), ny = (dx / l) * (width / 2);
    const v = [md.v(a[0] - nx, a[1] - ny, z0, 0, 0, 1), md.v(b[0] - nx, b[1] - ny, z0, 0, 0, 1), md.v(b[0] + nx, b[1] + ny, z0, 0, 0, 1), md.v(a[0] + nx, a[1] + ny, z0, 0, 0, 1)];
    md.quad(v[0]!, v[1]!, v[2]!, v[3]!);
  }
  return finish(md);
}

/**
 * The corner radius at each outline point: `r` where the outline turns a real corner (over about
 * 30 degrees), none where it is already a smooth run of points (an ellipse, a jaw's curve), which
 * rounding would only double.
 */
function cornerRadii(outline: readonly P2[], r: number): number[] {
  const n = outline.length;
  return outline.map((p, i) => {
    const a = outline[(i - 1 + n) % n]!, b = outline[(i + 1) % n]!;
    const d0 = [p[0] - a[0], p[1] - a[1]], d1 = [b[0] - p[0], b[1] - p[1]];
    const c = (d0[0]! * d1[0]! + d0[1]! * d1[1]!) / ((Math.hypot(d0[0]!, d0[1]!) * Math.hypot(d1[0]!, d1[1]!)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c))) > 0.52 ? r : 0;
  });
}

/** extrude in (x, y), thickness t centred on z = 0; a single radius rounds only the outline's real corners. */
function plate(outline: readonly P2[], t: number, o: Parameters<typeof extrude>[2] = {}): BufferGeometry {
  const radius = typeof o.radius === 'number' ? cornerRadii(outline, o.radius) : o.radius;
  return transform(extrude(outline, t, { segs: 2, bevelBase: 0, ...o, ...(radius ? { radius } : {}) }), T(0, 0, -t / 2));
}

// ---- the wrench (LARAVEL) ------------------------------------------------------------

const WRENCH = { big: { c: [0, 1.0] as P2, rx: 0.17, ry: 0.18, a: 0.068, yb: 0.02, ang: -15 }, small: { c: [0, 0.165] as P2, rx: 0.135, ry: 0.14, a: 0.052, yb: 0.015, ang: 180 + 15 } };

/** A C-shaped spanner head: an ellipse with a parallel slot opening along +y (head frame), then turned and placed. */
function headOutline(h: typeof WRENCH.big, grown = 0): P2[] {
  const { rx, ry, a, yb } = h;
  const ys = ry * Math.sqrt(Math.max(0, 1 - (a / rx) ** 2));
  const th0 = Math.atan2(ys / ry, a / rx);
  const pts: P2[] = ellipsePts(0, 0, rx, ry, Math.PI - th0, 2 * Math.PI + th0, 14);
  pts.push([a, yb]);
  pts.push(...ellipsePts(0, yb, a, a, 0, -Math.PI, 5).slice(1, -1));
  pts.push([-a, yb]);
  const p = grown ? grow(pts, grown) : pts;
  return rot2(p, (h.ang * Math.PI) / 180).map(([x, y]) => [x + h.c[0], y + h.c[1]] as P2);
}

function wrench(n: NodeBuilder, seed: number): void {
  const R = rng(seed);
  for (const [i, h] of [WRENCH.big, WRENCH.small].entries()) {
    n.add(steel(plate(headOutline(h), 0.068, { bevel: 0.016, radius: 0.022, band: 0, segs: 1 }), seed + i, 1.05));
  }
  // the shank, a little thinner than the heads, its edges eased
  const shank: P2[] = [[-0.062, 0.2], [0.062, 0.2], [0.072, 0.92], [-0.072, 0.92]];
  n.add(steel(plate(shank, 0.05, { bevel: 0.012, radius: 0.02, band: 0, segs: 1 }), seed + 2, 0.95));
  // the dipped grip: fat, rounded, a step at each end where the dip stopped
  const grip = roundedBox({ w: 0.2, h: 0.48, d: 0.1, r: 0.045, rPlan: 0.06, segs: 2, band: 0 });
  n.add(dipped(transform(grip, T(R.spread(0.003), 0.37, 0)), 'cable-red', seed + 3));
  // the dip's lips: a step two pixels tall at the wall's view, so a chamfered block
  const lip = bevelBox({ min: [-0.085, 0, -0.0425], max: [0.085, 0.03, 0.0425], c: 0.01 });
  for (const y of [0.345, 0.855]) n.add(dipped(transform(lip.clone(), T(0, y, 0)), 'cable-red', seed + 4));
  // a stamped size on the big head's face (two little dents read as numerals at a glance)
  n.add(steel(marks([[[0.03, 1.06], [0.03, 1.1]], [[0.055, 1.055], [0.06, 1.095]]], 0.012, 0.0345), seed + 5, 0.45));
}

function wrenchShape(): ToolShape {
  const g = 0.038;
  return {
    pegs: [rot2([[0, WRENCH.big.yb - WRENCH.big.a + 0.024]], (WRENCH.big.ang * Math.PI) / 180).map(([x, y]) => [x, y + WRENCH.big.c[1]] as P2)[0]!],
    shadow: [headOutline(WRENCH.big, g), headOutline(WRENCH.small, g), grow([[-0.07, 0.2], [0.07, 0.2], [0.08, 0.92], [-0.08, 0.92]], g), grow(rect(-0.1, 0.345, 0.1, 0.87), g)],
    turn: 0,
  };
}

// ---- the screwdriver (VUE) -----------------------------------------------------------

const SD_HANDLE: Array<[number, number]> = [[0.05, 0.69], [0.088, 0.72], [0.096, 0.8], [0.09, 0.95], [0.084, 1.06], [0.06, 1.12], [0.0, 1.14]];

function screwdriver(n: NodeBuilder, seed: number): void {
  // shaft
  n.add(setFinish(steel(lathe(profile(0, 0.08).to(0.028, 0.08, { sharp: true }).to(0.028, 0.66, { sharp: true }).to(0, 0.66), { segs: 8, caps: false, band: 0 }), seed, 1.3), 0.5));
  // the blade: a cone flattened into a flat tip
  const tip = lathe(profile(0, 0).to(0.03, 0.0, { sharp: true }).to(0.032, 0.03, { smooth: true }).to(0.028, 0.14).to(0, 0.14), { segs: 8, caps: 'start', band: 0 });
  deform(tip, (x, y, z) => {
    const t = Math.max(0, 1 - y / 0.14);
    return [x * (1 + 0.9 * t), y, z * (1 - 0.72 * t)];
  });
  n.add(steel(tip, seed + 1, 1.15));
  // bolster and brass ferrule
  n.add(part('brass', lathe(profile(0, 0.62).to(0.036, 0.62, { fillet: 0.006, segs: 1 }).to(0.052, 0.65, { fillet: 0.006, segs: 1 }).to(0.054, 0.71, { fillet: 0.005, segs: 1 }).to(0, 0.71), { segs: 10, band: 0, caps: 'end' }), 'brass', { seed: seed + 2, warm: 0.04 }));
  // the fluted handle: six flutes cut into a turned barrel, a domed end
  const pr = profile(0, 0.69);
  for (const [r, y] of SD_HANDLE.slice(0, -1)) pr.to(r, y, { smooth: true });
  pr.cubic(0, 1.15, 0.05, 1.135, 0.02, 1.15, 3);
  // five stations a flute (30 round): the flutes still scallop the silhouette
  const h = lathe(pr, { segs: 30, caps: false, band: 0 });
  deform(h, (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < 1e-5) return [x, y, z];
    const a = Math.atan2(z, x);
    const k = Math.max(0, Math.min(1, (y - 0.74) / 0.04, (1.06 - y) / 0.05));
    const f = 1 - 0.075 * k * (0.5 + 0.5 * Math.cos(a * 6));
    return [x * f, y, z * f];
  });
  n.add(paintedWood(grain(h, 'y'), 'paint-green', seed + 3, 0.97, { y0: 0.78, y1: 0.98, amount: 0.25 }));
}

function screwdriverShape(): ToolShape {
  const g = 0.036;
  return {
    pegs: [[-0.1, 0.672], [0.1, 0.672]],
    shadow: [grow(turnedOutline([[0.05, 0.62], ...SD_HANDLE.slice(1)]), g), grow(rect(-0.03, 0.12, 0.03, 0.66), g), grow([[-0.058, 0.0], [0.058, 0.0], [0.03, 0.14], [-0.03, 0.14]], g)],
    turn: 0,
  };
}

// ---- the claw hammer (PHP) -----------------------------------------------------------

const HM_HANDLE: Array<[number, number]> = [[0.048, 0.0], [0.06, 0.04], [0.058, 0.13], [0.046, 0.3], [0.04, 0.6], [0.046, 0.86], [0.05, 0.98]];
const HM = { eyeY: 0.92, eyeH: 0.23, face: 0.31, poll: 0.075 };

function clawOutline(): P2[] {
  const top: P2[] = [], bot: P2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // quadratic arcs: top from the eye's top corner sweeping down to the tip; bottom inside it
    const q = (a: P2, c: P2, b: P2): P2 => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
    top.push(q([-0.04, 1.125], [-0.26, 1.15], [-0.385, 0.915]));
    bot.push(q([-0.04, 1.03], [-0.21, 1.06], [-0.35, 0.9]));
  }
  return [...bot, [-0.372, 0.893], ...[...top].reverse()];
}

function hammer(n: NodeBuilder, seed: number): void {
  const R = rng(seed);
  // handle: turned, then pressed oval
  const pr = profile(0, 0);
  for (const [r, y] of HM_HANDLE) pr.to(r, y, y === 0 ? { fillet: 0.02, segs: 2 } : { smooth: true });
  pr.to(0, 0.98);
  const h = lathe(pr, { segs: 12, caps: 'start', band: 0 });
  transform(h, new Matrix4().makeScale(1, 1, 0.74));
  n.add(paintedWood(grain(h, 'y'), 'paint-violet', seed, 0.97, { y0: 0.05, y1: 0.42, amount: 0.3 }));
  // the head: the eye block, the poll turning out to the striking face, the claw
  const eye = roundedBox({ w: 0.17, h: HM.eyeH, d: 0.15, r: 0.03, rPlan: 0.035, segs: 2, band: 0 });
  n.add(steel(transform(eye, T(0, HM.eyeY, 0)), seed + 1, 0.9));
  const yc = HM.eyeY + HM.eyeH / 2;
  const poll = lathe(
    profile(0, 0.05).to(0.072, 0.05, { sharp: true }).to(0.062, 0.12, { smooth: true }).to(0.066, 0.2, { smooth: true }).to(0.082, 0.255, { fillet: 0.01, segs: 2 }).to(0.08, HM.face - 0.012).to(0.066, HM.face, { sharp: true }).to(0, HM.face + 0.004),
    { segs: 12, caps: false, band: 0 },
  );
  n.add(steel(transform(poll, chain(T(0, yc, 0), new Matrix4().makeRotationZ(-Math.PI / 2))), seed + 2, 1.0));
  n.add(steel(plate(clawOutline(), 0.11, { bevel: 0.02, radius: 0.01, segs: 1, band: 0 }), seed + 3, 0.95));
  // a polished striking face
  n.add(setFinish(steel(transform(lathe(profile(0, 0).to(0.064, 0, { sharp: true }).to(0.06, 0.006).to(0, 0.008), { segs: 12, band: 0, caps: false }), chain(T(HM.face + 0.003, yc, 0), new Matrix4().makeRotationZ(-Math.PI / 2))), seed + 4), 0.9));
  // the handle's end grain and its steel wedge on top of the eye
  n.add(part('wood', transform(bevelBox({ min: [-0.045, 0, -0.04], max: [0.045, 0.012, 0.04], c: 0.006 }), T(0, HM.eyeY + HM.eyeH, 0)), 'wood-light', { seed: seed + 5 }));
  n.add(steel(transform(bevelBox({ min: [-0.05, 0, -0.008], max: [0.05, 0.016, 0.008], c: 0.004 }), T(R.spread(0.004), HM.eyeY + HM.eyeH, 0)), seed + 6, 0.8));
}

function hammerShape(): ToolShape {
  const g = 0.036;
  const yc = HM.eyeY + HM.eyeH / 2;
  return {
    pegs: [[-0.1, 0.885], [0.1, 0.885]],
    shadow: [grow(turnedOutline(HM_HANDLE), g), grow(rect(-0.085, HM.eyeY, 0.085, HM.eyeY + HM.eyeH), g), grow([[0.05, yc - 0.075], [0.25, yc - 0.082], [HM.face, yc - 0.08], [HM.face, yc + 0.08], [0.25, yc + 0.082], [0.05, yc + 0.075]], g), grow(clawOutline(), g)],
    turn: 0,
  };
}

// ---- the slip-joint pliers (PYTHON) --------------------------------------------------

const PL = { pivot: [0, 0.68] as P2 };
const JAW: P2[] = [[-0.065, 0.645], [-0.03, 0.6], [0.03, 0.598], [0.075, 0.635], [0.088, 0.7], [0.078, 0.8], [0.058, 0.92], [0.036, 1.015], [0.012, 1.045], [-0.008, 1.035], [-0.004, 0.95], [0.012, 0.9], [0.024, 0.85], [0.016, 0.8], [-0.012, 0.765], [-0.05, 0.725]];
const handlePath = (s: number): Array<[number, number, number]> => [[-s * 0.03, 0.66, 0], [-s * 0.05, 0.52, 0], [-s * 0.085, 0.3, 0], [-s * 0.13, 0.08, 0], [-s * 0.14, 0.0, 0]];

function pliers(n: NodeBuilder, seed: number): void {
  for (const s of [1, -1]) {
    // each half: one jaw on this side and the handle on the other, crossing at the pivot
    const zc = s * 0.021;
    const jaw = plate(s > 0 ? JAW : JAW.map(([x, y]) => [-x, y] as P2).reverse(), 0.04, { bevel: 0.01, radius: 0.008, band: 0, segs: 1 });
    n.add(steel(transform(jaw, T(0, 0, zc)), seed + (s > 0 ? 0 : 5), 1.0));
    // serrations across the jaw's inner face, a few dark ticks
    const ticks: Array<[P2, P2]> = [];
    for (let i = 0; i < 5; i++) {
      const y = 0.9 + i * 0.026;
      ticks.push([[s * 0.0, y], [s * 0.03, y - 0.008]]);
    }
    if (s > 0) n.add(steel(marks(ticks, 0.007, zc + 0.0205), seed + 7, 0.4));
    const pts = handlePath(s);
    const shank = sweep(polylinePath(pts.slice(0, 3), 0.1, 2), { section: sections.roundRect(0.014, 0.008, 1), radius: 0.012, ends: 'flat' });
    n.add(steel(transform(shank, T(0, 0, zc)), seed + 1, 0.95));
    const gp = polylinePath([[pts[1]![0] * 1.04, 0.47, 0], pts[2]!, pts[3]!, pts[4]!], 0.12, 2);
    const gl = pathLength(gp), gr = 0.05;
    // round ends in two steps each (a dome of four is lost at the grip's size)
    const ends = profile(0, 0).to(gr, 0, { fillet: gr, segs: 2 }).to(gr, gl, { fillet: gr, segs: 2 }).to(0, gl);
    const grip = sweep(gp, { profile: ends, segs: 7, step: 0.09, taper: (t) => 1 - 0.08 * Math.sin(t * Math.PI) + 0.12 * Math.max(0, t - 0.85) / 0.15 });
    n.add(dipped(transform(grip, T(0, 0, zc)), 'paint-blue', seed + 2));
  }
  // the pivot: a fat rivet on the front, a dished washer behind it
  n.add(steel(transform(lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.05, 0.008, { fillet: 0.004, segs: 1 }).to(0.036, 0.018, { fillet: 0.01, segs: 1 }).to(0, 0.022), { segs: 10, band: 0, caps: false }), chain(T(PL.pivot[0], PL.pivot[1], 0.041), new Matrix4().makeRotationX(Math.PI / 2))), seed + 3, 1.15));
}

function pliersShape(): ToolShape {
  const g = 0.036;
  const handle = (s: number): P2[] => {
    const pts = handlePath(s).map(([x, y]) => [x, y] as P2);
    const left = pts.map(([x, y]) => [x - 0.045, y] as P2), right = pts.map(([x, y]) => [x + 0.045, y] as P2);
    return [...left, ...right.reverse()];
  };
  return {
    pegs: [[0, 0.555]],
    shadow: [grow(JAW, g), grow(JAW.map(([x, y]) => [-x, y] as P2), g), grow(handle(1), g), grow(handle(-1), g)],
    turn: 0,
  };
}

// ---- the file (RUST) -----------------------------------------------------------------

const FL_HANDLE: Array<[number, number]> = [[0.045, 0.0], [0.066, 0.05], [0.078, 0.15], [0.066, 0.27], [0.052, 0.33], [0.048, 0.35]];
const FL_BLADE: P2[] = [[-0.064, 0.44], [0.064, 0.44], [0.058, 0.8], [0.046, 1.1], [0.034, 1.2], [-0.034, 1.2], [-0.046, 1.1], [-0.058, 0.8]];

function file(n: NodeBuilder, seed: number): void {
  const pr = profile(0, 0);
  for (const [r, y] of FL_HANDLE) pr.to(r, y, y === 0 ? { fillet: 0.025, segs: 2 } : { smooth: true });
  pr.to(0, 0.35);
  n.add(paintedWood(grain(lathe(pr, { segs: 12, caps: 'start', band: 0 }), 'y'), 'paint-orange', seed, 0.96, { y0: 0.06, y1: 0.24, amount: 0.22 }));
  n.add(part('brass', lathe(profile(0, 0.32).to(0.054, 0.32, { fillet: 0.006, segs: 1 }).to(0.056, 0.4, { fillet: 0.008, segs: 1 }).to(0, 0.405), { segs: 10, band: 0, caps: 'end' }), 'brass', { seed: seed + 1, warm: 0.04 }));
  // the tang's shoulder, then the blade
  n.add(steel(plate([[-0.03, 0.39], [0.03, 0.39], [0.05, 0.45], [-0.05, 0.45]], 0.034, { bevel: 0.006, radius: 0.006, band: 0 }), seed + 2, 0.8));
  n.add(steel(plate(FL_BLADE, 0.036, { bevel: 0.008, radius: 0.012, band: 0 }), seed + 3, 0.85));
  // double-cut teeth: two sets of fine diagonal lines across the face
  const cuts: Array<[P2, P2]> = [];
  const halfW = (y: number): number => 0.064 - ((y - 0.44) / 0.76) * 0.03 - 0.008;
  for (let y = 0.48; y < 1.17; y += 0.034) {
    const w = halfW(y);
    cuts.push([[-w, y - 0.03], [w, y + 0.03]]);
    cuts.push([[-w, y + 0.012], [w, y - 0.012]]);
  }
  n.add(steel(marks(cuts, 0.006, 0.0182), seed + 4, 0.35));
}

function fileShape(): ToolShape {
  const g = 0.036;
  return {
    // it rests on its side on two pegs: under the ferrule and under the blade (tool-local +X is down on the wall)
    pegs: [[0.078, 0.36], [0.078, 0.96]],
    shadow: [grow(turnedOutline([...FL_HANDLE, [0.056, 0.4]]), g), grow(FL_BLADE, g)],
    turn: -90,
  };
}

// ---- the try-square (SQL) ------------------------------------------------------------

const SQ = { stock: { x0: -0.48, x1: 0.08, h: 0.14, t: 0.1 }, blade: { x0: -0.035, x1: 0.08, y1: 0.98, t: 0.022 }, hole: [0.022, 0.91] as P2 };

function square(n: NodeBuilder, seed: number): void {
  const { stock: s, blade: bl } = SQ;
  const st = roundedBox({ w: s.x1 - s.x0, h: s.h, d: s.t, r: 0.02, rPlan: 0.022, segs: 2, band: 0 });
  n.add(paintedWood(transform(st, T((s.x0 + s.x1) / 2, 0, 0)), 'tape-yellow', seed, 0.95));
  // the brass wear strip along the stock's working edge (its top), three rivets through the stock
  n.add(setFinish(part('brass', bevelBox({ min: [s.x0 + 0.03, s.h - 0.004, -0.03], max: [bl.x0, s.h + 0.006, 0.03], c: 0.003 }), 'brass', { seed: seed + 1, warm: 0.04 }), 0.3));
  for (const x of [-0.37, -0.2, 0.025]) n.add(part('brass', transform(stud(0.017, 0.008, 6), chain(T(x, s.h * 0.48, s.t / 2), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: seed + 2 }));
  // the blade, with the hole it hangs by
  const hole = ellipsePts(SQ.hole[0], SQ.hole[1], 0.03, 0.03, 0, Math.PI * 2, 10).slice(0, -1);
  const blade = transform(extrude([[bl.x0, 0.03], [bl.x1, 0.03], [bl.x1, bl.y1], [bl.x0, bl.y1]], bl.t, { holes: [hole], bevel: 0.005, radius: 0.012, holeRadius: 0.006, segs: 1, band: 0 }), T(0, 0, -bl.t / 2));
  n.add(setFinish(steel(blade, seed + 3, 1.15), 0.35));
  // graduations down the blade's inner edge: every 0.05, longer every fourth
  const ticks: Array<[P2, P2]> = [];
  for (let i = 0; i < 16; i++) {
    const y = s.h + 0.05 + i * 0.05;
    if (y > bl.y1 - 0.02) break;
    const L = i % 4 === 3 ? 0.055 : i % 2 ? 0.035 : 0.022;
    ticks.push([[bl.x0 + 0.004, y], [bl.x0 + 0.004 + L, y]]);
  }
  n.add(steel(marks(ticks, 0.006, bl.t / 2 + 0.0006), seed + 4, 0.3));
}

function squareShape(): ToolShape {
  const g = 0.036;
  const { stock: s, blade: bl } = SQ;
  return {
    pegs: [[SQ.hole[0], SQ.hole[1] + 0.006]],
    shadow: [grow(rect(s.x0, 0, s.x1, s.h), g), grow(rect(bl.x0, 0.03, bl.x1, bl.y1), g)],
    turn: 0,
  };
}

// ---- the two new tools (P4 T2): two candidates each, for the owner's eye ----------------
//
// A hanging brass eye (a ring a peg goes through): the brush, the roller and both drills hang by one.
function eye(n: NodeBuilder, x: number, y: number, r: number, seed: number): void {
  const ring = sweep({ ...arcPath([0, 0, 0], r, 0, Math.PI * 2, 8), closed: true }, { radius: 0.012, segs: 4 });
  n.add(part('brass', transform(ring, T(x, y, 0)), 'brass', { seed, warm: 0.05 }));
}

// FLUTTER, candidate A: a flat paint brush (it paints interfaces). Bristles down, its handle up, hung by an eye.
const BR = { tip: 0, bristle: 0.26, ferrule: 0.43, top: 1.0, w: 0.26, t: 0.075 };
const BR_HANDLE: Array<[number, number]> = [[0.05, BR.ferrule], [0.058, 0.5], [0.05, 0.62], [0.046, 0.8], [0.056, 0.92], [0.05, 0.98], [0.0, BR.top]];

function brush(n: NodeBuilder, seed: number): void {
  const R = rng(seed);
  // the bristles: a block that thins and splays a little toward its tip, the last of it dipped in paint (the tool's own colour)
  const bristles = roundedBox({ w: BR.w, h: BR.bristle - 0.01, d: BR.t, r: 0.018, rPlan: 0.02, segs: 2, band: 0 });
  deform(bristles, (x, y, z) => {
    const t = Math.max(0, 1 - y / BR.bristle);
    return [x * (1 + 0.08 * t), y, z * (1 - 0.5 * t * t)];
  });
  n.add(part('wood', transform(bristles, T(0, 0.005, 0)), 'ink', { seed: seed + 1, jitter: 0.05, warm: -0.02 }));
  // the strands: fine dark lines down both faces
  const strands: Array<[P2, P2]> = [];
  for (let i = 0; i < 11; i++) {
    const x = -BR.w / 2 + 0.02 + (i / 10) * (BR.w - 0.04) + R.spread(0.004);
    strands.push([[x, 0.03 + R() * 0.02], [x * 1.02, BR.bristle - 0.02]]);
  }
  n.add(part('wood', marks(strands, 0.005, BR.t / 2 + 0.0015), 'ink', { seed: seed + 2, shade: 0.55 }));
  // a dried dab of paint on the tip, front and back: the tool's own colour, glossy
  const dab = roundedBox({ w: BR.w * 1.04, h: 0.07, d: BR.t * 0.62, r: 0.02, rPlan: 0.02, segs: 2, band: 0 });
  deform(dab, (x, y, z) => [x, y + 0.012 * Math.sin(x * 31 + seed) * (y > 0.035 ? 1 : 0), z]);
  n.add(part('steel', transform(dab, T(0, 0.0, 0)), 'teal-light', { seed: seed + 3, jitter: 0.04, shade: 1.05 }));
  // the ferrule: a flattened tin collar, crimped twice, nailed through
  const fer = roundedBox({ w: BR.w + 0.03, h: BR.ferrule - BR.bristle + 0.01, d: BR.t + 0.035, r: 0.03, rPlan: 0.035, segs: 2, band: 0 });
  n.add(steel(transform(fer, T(0, BR.bristle - 0.01, 0)), seed + 4, 1.1));
  const crimps: Array<[P2, P2]> = [[[-0.13, 0.355], [0.13, 0.355]], [[-0.13, 0.372], [0.13, 0.372]]];
  n.add(steel(marks(crimps, 0.006, (BR.t + 0.035) / 2 + 0.001), seed + 5, 0.45));
  for (const x of [-0.07, 0.07]) n.add(steel(transform(stud(0.012, 0.006, 6), chain(T(x, 0.395, (BR.t + 0.035) / 2), new Matrix4().makeRotationX(Math.PI / 2))), seed + 6, 0.8));
  // the handle: turned, then pressed flat, painted, worn where the fingers go
  const pr = profile(0, BR.ferrule);
  for (const [r, y] of BR_HANDLE.slice(0, -1)) pr.to(r, y, { smooth: true });
  pr.cubic(0, BR.top, 0.05, 0.99, 0.02, BR.top, 3);
  const h = lathe(pr, { segs: 12, caps: false, band: 0 });
  transform(h, new Matrix4().makeScale(1.15, 1, 0.62));
  n.add(paintedWood(grain(h, 'y'), 'teal-light', seed + 7, 0.96, { y0: 0.5, y1: 0.72, amount: 0.28 }));
  eye(n, 0, BR.top + 0.035, 0.032, seed + 8);
}

function brushShape(): ToolShape {
  const g = 0.036;
  return {
    // (P4 T2) it lies on its side on two pegs under its handle, as the file does (tool-local +X is down on the wall)
    pegs: [[0.068, 0.82], [0.068, 0.62]],
    shadow: [grow(rect(-BR.w / 2 - 0.02, 0, BR.w / 2 + 0.02, BR.bristle), g), grow(rect(-BR.w / 2 - 0.015, BR.bristle - 0.01, BR.w / 2 + 0.015, BR.ferrule), g), grow(turnedOutline(BR_HANDLE.map(([r, y]) => [r * 1.15, y] as [number, number])), g)],
    turn: -90,
  };
}

// FLUTTER, candidate B: a paint roller (one coat over every surface). The roller down, the handle up.
const RL = { axle: 0.11, r: 0.095, half: 0.24, frameTop: 0.5, top: 1.02 };
const RL_HANDLE: Array<[number, number]> = [[0.04, RL.frameTop + 0.04], [0.05, 0.62], [0.052, 0.8], [0.045, 0.94], [0.0, RL.top]];

function roller(n: NodeBuilder, seed: number): void {
  // the nap: a fat soft cylinder in the tool's colour (felt: it is fuzzy)
  const nap = lathe(profile(0, -RL.half).to(RL.r - 0.012, -RL.half, { sharp: true }).to(RL.r, -RL.half + 0.02, { smooth: true }).to(RL.r, RL.half - 0.02, { smooth: true }).to(RL.r - 0.012, RL.half, { sharp: true }).to(0, RL.half), { segs: 16, band: 0 });
  const across = chain(T(0, RL.axle, 0), new Matrix4().makeRotationZ(-Math.PI / 2));
  n.add(part('felt', transform(nap, across), 'teal-light', { seed, jitter: 0.06 }));
  // its end caps, pressed steel
  for (const s of [-1, 1]) {
    const cap = lathe(profile(0, 0).to(RL.r - 0.016, 0, { fillet: 0.006, segs: 1 }).to(RL.r - 0.02, 0.012).to(0, 0.016), { segs: 14, band: 0, caps: false });
    n.add(steel(transform(cap, chain(T(s * (RL.half + 0.001), RL.axle, 0), new Matrix4().makeRotationZ(s > 0 ? -Math.PI / 2 : Math.PI / 2))), seed + 1, 1.05));
  }
  // the wire frame: from the axle's right end out, up, and in over the roller to the handle's foot
  const wire = polylinePath([[RL.half + 0.03, RL.axle, 0], [RL.half + 0.08, RL.axle, 0], [RL.half + 0.08, 0.3, 0], [0.0, 0.42, 0], [0, RL.frameTop + 0.06, 0]], 0.05, 3);
  n.add(steel(sweep(wire, { radius: 0.014, segs: 7, ends: 'flat' }), seed + 2, 1.2));
  // a brass collar where the wire enters the handle
  n.add(part('brass', lathe(profile(0, RL.frameTop).to(0.034, RL.frameTop, { fillet: 0.006, segs: 1 }).to(0.04, RL.frameTop + 0.05, { fillet: 0.006, segs: 1 }).to(0, RL.frameTop + 0.055), { segs: 10, band: 0, caps: 'end' }), 'brass', { seed: seed + 3, warm: 0.04 }));
  // the handle: turned, painted, a grip in its middle
  const pr = profile(0, RL.frameTop + 0.04);
  for (const [r, y] of RL_HANDLE.slice(0, -1)) pr.to(r, y, { smooth: true });
  pr.cubic(0, RL.top, 0.045, 1.0, 0.02, RL.top, 3);
  n.add(paintedWood(grain(lathe(pr, { segs: 12, caps: false, band: 0 }), 'y'), 'teal-light', seed + 4, 0.96, { y0: 0.66, y1: 0.86, amount: 0.3 }));
  eye(n, 0, RL.top + 0.035, 0.03, seed + 5);
}

function rollerShape(): ToolShape {
  const g = 0.036;
  return {
    // (P4 T2) on its side on two pegs under its handle, as the brush (tool-local +X is down on the wall)
    pegs: [[0.054, 0.86], [0.054, 0.66]],
    shadow: [grow(rect(-RL.half, RL.axle - RL.r, RL.half, RL.axle + RL.r), g), grow([[RL.half + 0.06, RL.axle - 0.02], [RL.half + 0.1, RL.axle - 0.02], [RL.half + 0.1, 0.31], [0.02, 0.44], [0.02, RL.frameTop + 0.06], [-0.02, RL.frameTop + 0.06], [-0.02, 0.41], [RL.half + 0.06, 0.29]], g), grow(turnedOutline(RL_HANDLE), g)],
    turn: -90,
  };
}

// CLAUDE CODE, candidate A: a hand-cranked drill (an egg-beater): it multiplies your turning, and you still aim it.
const DR = { bit: 0.15, chuck: 0.28, frame0: 0.34, frame1: 0.86, top: 1.1, gear: [0.16, 0.58] as P2, gearR: 0.18 };
const DR_HANDLE: Array<[number, number]> = [[0.045, DR.frame1], [0.06, 0.9], [0.068, 0.97], [0.062, 1.04], [0.05, 1.08], [0.0, DR.top]];

/** A spur gear's outline: `teeth` round radius r, each tooth `h` tall. */
function gearOutline(r: number, teeth: number, h: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, d = (Math.PI * 2) / teeth;
    for (const [f, rr] of [[0, r], [0.18, r + h], [0.5, r + h], [0.68, r]] as const) out.push([Math.cos(a + f * d) * rr, Math.sin(a + f * d) * rr]);
  }
  return out;
}

function drill(n: NodeBuilder, seed: number): void {
  const R = rng(seed);
  // the bit: a twist drill (a steel rod with its flutes as a raised spiral)
  n.add(setFinish(steel(lathe(profile(0, 0.0).to(0.012, 0.0, { sharp: true }).to(0.018, 0.02).to(0.018, DR.bit, { sharp: true }).to(0, DR.bit), { segs: 8, band: 0, caps: false }), seed, 1.3), 0.5));
  // its flutes: dark diagonal grooves down the front
  const flutes: Array<[P2, P2]> = [];
  for (let y = 0.03; y < DR.bit - 0.04; y += 0.035) flutes.push([[-0.016, y], [0.016, y + 0.022]]);
  n.add(steel(marks(flutes, 0.007, 0.0185), seed + 1, 0.4));
  // the chuck: a knurled steel cone and its nose
  n.add(steel(lathe(profile(0, DR.bit - 0.01).to(0.024, DR.bit - 0.01, { sharp: true }).to(0.04, DR.bit + 0.03, { smooth: true }).to(0.046, DR.chuck - 0.02, { fillet: 0.008, segs: 1 }).to(0.03, DR.chuck).to(0, DR.chuck + 0.004), { segs: 10, band: 0, caps: false }), seed + 2, 1.15));
  // the spindle, up through the frame
  n.add(steel(lathe(profile(0, DR.chuck).to(0.016, DR.chuck, { sharp: true }).to(0.016, DR.frame1, { sharp: true }).to(0, DR.frame1), { segs: 8, band: 0, caps: false }), seed + 4, 1.05));
  // the frame: a cast bar beside the spindle, enamelled, with a foot round the spindle at each end
  const frame: P2[] = [[-0.05, DR.frame0], [0.03, DR.frame0], [0.05, DR.frame0 + 0.06], [0.05, DR.frame1 - 0.06], [0.03, DR.frame1], [-0.05, DR.frame1], [-0.06, DR.frame1 - 0.04], [-0.06, DR.frame0 + 0.04]];
  n.add(part('steel', plate(frame, 0.05, { bevel: 0.012, radius: 0.016, band: 0, segs: 1 }), 'paper', { seed: seed + 5, jitter: 0.04 }));
  // the drive wheel: a spoked spur gear in the same enamel, its rim's teeth bare steel where they wore
  const [gx, gy] = DR.gear;
  // its toothed rim (one ring), and four spokes across it
  const rim = gearOutline(DR.gearR, 12, 0.02);
  const bore = ellipsePts(0, 0, DR.gearR - 0.04, DR.gearR - 0.04, 0, Math.PI * 2, 10).slice(0, -1);
  const wheel = transform(extrude(rim, 0.03, { holes: [bore], bevel: 0, bevelBase: 0, radius: 0, holeRadius: 0, segs: 1, band: 0, caps: 'end' }), T(gx, gy, 0.035));
  n.add(part('steel', wheel, 'paper', { seed: seed + 6, jitter: 0.05 }));
  const L = DR.gearR - 0.03;
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const bar = bevelBox({ min: [-L, -0.014, 0.038], max: [L, 0.014, 0.06], c: 0.005 });
    n.add(part('steel', transform(bar, chain(T(gx, gy, 0), new Matrix4().makeRotationZ(a))), 'paper', { seed: seed + 7, jitter: 0.05 }));
  }
  // its hub, and the pinion it turns on the spindle (brass)
  n.add(part('brass', transform(lathe(profile(0, 0).to(0.045, 0, { fillet: 0.008, segs: 1 }).to(0.045, 0.05, { fillet: 0.01, segs: 1 }).to(0, 0.055), { segs: 9, band: 0, caps: false }), chain(T(gx, gy, 0.03), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: seed + 8, warm: 0.05 }));
  n.add(part('brass', transform(lathe(profile(0, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.03, { sharp: true }).to(0, 0.03), { segs: 8, band: 0, caps: 'end' }), chain(T(0, gy - DR.gearR - 0.03, 0.02), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: seed + 9, warm: 0.04 }));
  // the crank: an arm off the hub, a turned wooden knob on it toward the visitor
  const ang = -0.6 + R.spread(0.05);
  const kx = gx + Math.cos(ang) * 0.13, ky = gy + Math.sin(ang) * 0.13;
  const arm = bevelBox({ min: [-0.012, -0.015, 0.07], max: [0.14, 0.015, 0.09], c: 0.005 });
  n.add(steel(transform(arm, chain(T(gx, gy, 0), new Matrix4().makeRotationZ(ang))), seed + 10, 1.1));
  const knob = lathe(profile(0, 0).to(0.026, 0.0, { fillet: 0.01, segs: 1 }).to(0.034, 0.04, { smooth: true }).to(0.03, 0.075, { fillet: 0.015, segs: 2 }).to(0, 0.082), { segs: 8, band: 0, caps: false });
  n.add(part('wood', grain(transform(knob, chain(T(kx, ky, 0.085), new Matrix4().makeRotationX(Math.PI / 2))), 'z'), 'wood', { seed: seed + 11, jitter: 0.06, warm: 0.03 }));
  // the top handle: turned, enamelled to match, worn to the wood where the palm sits
  const pr = profile(0, DR.frame1);
  for (const [r, y] of DR_HANDLE.slice(0, -1)) pr.to(r, y, { smooth: true });
  pr.cubic(0, DR.top, 0.05, 1.095, 0.02, DR.top, 3);
  n.add(paintedWood(grain(lathe(pr, { segs: 10, caps: false, band: 0 }), 'y'), 'paper', seed + 12, 0.95, { y0: 0.9, y1: 1.06, amount: 0.35 }));
  eye(n, 0, DR.top + 0.03, 0.03, seed + 13);
}

function drillShape(): ToolShape {
  const g = 0.036;
  const [gx, gy] = DR.gear;
  return {
    // (P4 T2) it lies on its back on two pegs, its wheel up: under its frame and under its handle (tool-local -X is down on the wall)
    pegs: [[-0.068, 0.97], [-0.068, 0.57]],
    shadow: [grow(rect(-0.022, 0, 0.022, DR.chuck), g), grow(rect(-0.05, DR.bit, 0.05, DR.chuck), g), grow(rect(-0.06, DR.frame0, 0.05, DR.frame1), g), grow(ellipsePts(gx, gy, DR.gearR + 0.012, DR.gearR + 0.012, 0, Math.PI * 2, 20).slice(0, -1), g), grow(turnedOutline(DR_HANDLE), g)],
    turn: 90,
  };
}

// CLAUDE CODE, candidate B: a push drill (a "Yankee"): you push, it does the turning; you still aim it.
const YK = { bit: 0.07, chuck: 0.17, spiral: 0.5, sleeve: 0.82, top: 1.16 };
const YK_HANDLE: Array<[number, number]> = [[0.042, YK.sleeve], [0.06, 0.88], [0.074, 0.98], [0.07, 1.06], [0.055, 1.13], [0.0, YK.top]];

function yankee(n: NodeBuilder, seed: number): void {
  // the bit: a flat screwdriver tip
  const tip = lathe(profile(0, 0).to(0.02, 0, { sharp: true }).to(0.014, YK.bit, { sharp: true }).to(0, YK.bit), { segs: 8, band: 0, caps: 'start' });
  deform(tip, (x, y, z) => [x * (1.6 - 0.6 * (y / YK.bit)), y, z * (0.35 + 0.65 * (y / YK.bit))]);
  n.add(steel(tip, seed, 1.2));
  // the chuck: a knurled collar
  n.add(steel(lathe(profile(0, YK.bit).to(0.026, YK.bit, { fillet: 0.006, segs: 1 }).to(0.03, YK.chuck, { fillet: 0.006, segs: 1 }).to(0, YK.chuck + 0.003), { segs: 12, band: 0, caps: false }), seed + 1, 1.0));
  n.add(steel(transform(ridgedBand(0.031, 0.06, 16, 0.005), T(0, YK.bit + 0.02, 0)), seed + 2, 0.85));
  // the spiral spindle: a polished rod wound with its flute, bright
  n.add(setFinish(steel(lathe(profile(0, YK.chuck).to(0.017, YK.chuck, { sharp: true }).to(0.017, YK.spiral + 0.05, { sharp: true }).to(0, YK.spiral + 0.05), { segs: 8, band: 0, caps: false }), seed + 3, 1.35), 0.6));
  n.add(setFinish(steel(transform(sweep(helixPath(0.018, 0.085, 3.8, 8), { radius: 0.006, segs: 3 }), T(0, YK.chuck + 0.005, 0)), seed + 4, 1.1), 0.6));
  // the sleeve it slides into, its brass shifter ring (the ratchet's three ways)
  n.add(steel(lathe(profile(0, YK.spiral).to(0.03, YK.spiral, { fillet: 0.01, segs: 1 }).to(0.032, YK.sleeve, { sharp: true }).to(0, YK.sleeve), { segs: 12, band: 0, caps: false }), seed + 5, 1.0));
  n.add(part('brass', transform(ridgedBand(0.038, 0.045, 14, 0.005), T(0, YK.sleeve - 0.12, 0)), 'brass', { seed: seed + 6, warm: 0.05 }));
  n.add(part('brass', lathe(profile(0, YK.sleeve - 0.124).to(0.036, YK.sleeve - 0.124, { fillet: 0.004, segs: 1 }).to(0.036, YK.sleeve - 0.075, { fillet: 0.004, segs: 1 }).to(0, YK.sleeve - 0.072), { segs: 12, band: 0, caps: false }), 'brass', { seed: seed + 7, warm: 0.05 }));
  // the pear-shaped handle, enamelled, worn at the palm; a brass ferrule under it
  n.add(part('brass', lathe(profile(0, YK.sleeve - 0.01).to(0.04, YK.sleeve - 0.01, { fillet: 0.005, segs: 1 }).to(0.044, YK.sleeve + 0.05, { fillet: 0.006, segs: 1 }).to(0, YK.sleeve + 0.055), { segs: 12, band: 0, caps: 'end' }), 'brass', { seed: seed + 8, warm: 0.04 }));
  const pr = profile(0, YK.sleeve + 0.04);
  for (const [r, y] of YK_HANDLE.slice(1, -1)) pr.to(r, y, { smooth: true });
  pr.cubic(0, YK.top, 0.055, 1.155, 0.02, YK.top, 3);
  n.add(paintedWood(grain(lathe(pr, { segs: 14, caps: false, band: 0 }), 'y'), 'paper', seed + 9, 0.95, { y0: 0.96, y1: 1.12, amount: 0.35 }));
  eye(n, 0, YK.top + 0.03, 0.03, seed + 10);
}

function yankeeShape(): ToolShape {
  const g = 0.036;
  return {
    // (P4 T2) on its back on two pegs under its handle, as the drill (tool-local -X is down on the wall)
    pegs: [[-0.075, 1.0], [-0.075, 0.8]],
    shadow: [grow(rect(-0.032, 0, 0.032, YK.spiral), g), grow(rect(-0.034, YK.spiral, 0.034, YK.sleeve), g), grow(turnedOutline(YK_HANDLE), g)],
    turn: 90,
  };
}

/** The two new tools' candidates (P4 T2: their shapes are a look decision for the owner): which one the wall hangs. */
export const CANDIDATES = { flutter: ['brush', 'roller'], 'claude-code': ['drill', 'yankee'] } as const;
export type Candidate = (typeof CANDIDATES)[keyof typeof CANDIDATES][number];
/** Proposed: the brush and the cranked drill (the lead's suggestions held up best in the pictures); the owner chooses. */
export const CHOSEN: { flutter: (typeof CANDIDATES)['flutter'][number]; 'claude-code': (typeof CANDIDATES)['claude-code'][number] } = { flutter: devChoice('toolFlutter', CANDIDATES.flutter) ?? 'brush', 'claude-code': devChoice('toolClaude', CANDIDATES['claude-code']) ?? 'drill' };

/**
 * The pictures for the owner (development pages only): `?toolFlutter=roller`, `?toolClaude=yankee` hang the other
 * candidate on the wall. The simulation's bodies stay the chosen ones' (sim/scenes/bench.ts TOOLWALL): for looking at, not
 * for throwing about. Never in a build.
 */
function devChoice<T extends string>(key: string, among: readonly T[]): T | null {
  if (!import.meta.env?.DEV) return null;
  try {
    const v = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get(key);
    return v && (among as readonly string[]).includes(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
const CAND_BUILD: Record<Candidate, (n: NodeBuilder, seed: number) => void> = { brush, roller, drill, yankee };
const CAND_SHAPE: Record<Candidate, () => ToolShape> = { brush: brushShape, roller: rollerShape, drill: drillShape, yankee: yankeeShape };

// ---- dispatch ------------------------------------------------------------------------

const BUILD: Record<ToolKind, (n: NodeBuilder, seed: number) => void> = { laravel: wrench, vue: screwdriver, php: hammer, python: pliers, rust: file, sql: square, flutter: (n, s) => CAND_BUILD[CHOSEN.flutter](n, s), 'claude-code': (n, s) => CAND_BUILD[CHOSEN['claude-code']](n, s) };
const SHAPE: Record<ToolKind, () => ToolShape> = { laravel: wrenchShape, vue: screwdriverShape, php: hammerShape, python: pliersShape, rust: fileShape, sql: squareShape, flutter: () => CAND_SHAPE[CHOSEN.flutter](), 'claude-code': () => CAND_SHAPE[CHOSEN['claude-code']]() };

/** Add a tool's parts to a node (tool-local frame). `candidate`: one of the new tools' other shapes (the owner's review). */
export function buildToolInto(kind: ToolKind, n: NodeBuilder, seed = 1, candidate?: Candidate): void {
  const s = seed * 101 + TOOL_KINDS.indexOf(kind) * 13;
  if (candidate) CAND_BUILD[candidate](n, s);
  else BUILD[kind](n, s);
}

/** The wall's facts about a tool (pegs, shadow), without building it. */
export function toolShape(kind: ToolKind, candidate?: Candidate): ToolShape {
  return candidate ? CAND_SHAPE[candidate]() : SHAPE[kind]();
}

/** One tool as a Piece of its own (registry names `tool-<kind>`), with socket `peg`. */
export function tool(kind: ToolKind, o: { seed?: number; detail?: 'high' | 'low'; candidate?: Candidate } = {}): Piece {
  const seed = o.seed ?? 1;
  const b = piece(`tool-${kind}`, { detail: o.detail ?? 'high', seed });
  buildToolInto(kind, b, seed, o.candidate);
  const [px, py] = toolShape(kind, o.candidate).pegs[0]!;
  b.socket('peg', T(px, py, 0));
  return b.build();
}

/** Merge a list of shadow polygons into one flat painted sheet on z = 0 facing +Z (each a hair above the last). */
export function shadowSheet(polys: readonly P2[][]): BufferGeometry {
  const md = new MeshData();
  polys.forEach((p, k) => {
    const pts = p.map(([x, y]) => new Vector2(x, y));
    const base = md.vertexCount;
    for (const q of pts) md.v(q.x, q.y, k * 0.0004, 0, 0, 1);
    for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) md.tri(base + a!, base + b!, base + c!);
  });
  return finish(md);
}
