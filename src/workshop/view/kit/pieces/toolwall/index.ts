/**
 * The tool wall (REWRITE.md § C "Tool wall", § D9; art-direction § 10 TOOL
 * WALL). Registry names `toolwall`, and one entry per tool: `tool-laravel`,
 * `tool-vue`, `tool-php`, `tool-python`, `tool-rust`, `tool-sql` (tools.ts).
 *
 * A perforated `wood-light` pegboard in a walnut frame, on furring off the
 * wall. Six tools hang on steel pegs in two rows of three, each over its
 * painted shadow (the tool's outline, grown a little, painted `teal-deep`
 * onto the board), with its label-tape name under it at the labels module's
 * default cap height (0.26: the 12 px rule). The board is sized by those
 * tapes: LARAVEL alone is two units long, so the board is 5.2 x 3.8, not the
 * 4.2 x 2.4 first sketched.
 *
 * The perforation is vertex colour: the board face is a grid of one cell per
 * hole, each cell a fan of four triangles round a dark centre (no texture,
 * no labels engineer needed). It reads as a dotted board at the default
 * view; close up the holes are soft diamonds rather than crisp round holes.
 *
 * Frame: origin on the WALL plane (z = 0) under the middle of the board, y = 0
 * at the bottom of the frame, the face looking +Z.
 *
 * Nodes: `tool.<kind>` (with `tools: true`, the default): each tool, placed
 * where it hangs; a view that makes the tools loose parts builds the wall
 * with `tools: false` and realizes `tool(kind)` at socket `hang.<kind>`.
 * Sockets: `hang.<kind>` (where the tool's own origin goes when it hangs),
 * `peg.<kind>` (the first peg's tip, where its `peg` socket sits).
 */
import { BufferAttribute, Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { linear } from '../../../palette.ts';
import { chain, mat, mergeGeometries, part, piece, texturedPart, T } from '../../compose.ts';
import { roundedBox } from '../../solids.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { finish, MeshData } from '../../mesh.ts';
import { sheet, stud } from '../../cheap.ts';
import { rng } from '../../rng.ts';
import { ATTR } from '../../types.ts';
import { TOOL_KINDS, buildToolInto, shadowSheet, tool, toolShape } from './tools.ts';
import type { ToolKind } from './tools.ts';

export { TOOL_KINDS, TOOL_PAINT, tool, toolShape, buildToolInto } from './tools.ts';
export type { ToolKind, ToolShape } from './tools.ts';

/** Dimensions shared with the tests and the view. */
export const BOARD = {
  /** The pegboard face (inside the frame it is a little smaller). */
  w: 5.2,
  h: 3.8,
  /** Hole pitch: a peg can go in any hole. */
  pitch: 0.2,
  /** The board's bottom edge, its face off the wall. */
  y0: 0.1,
  face: 0.1,
  /** Frame bars. */
  bar: 0.24,
  depth: 0.16,
} as const;

export interface TapeRef {
  key: string;
  w: number;
  h: number;
}

export interface ToolwallOptions extends KitOptions {
  /** Hang the six tools on the board (default true). */
  tools?: boolean;
  /** Tape refs from `toolwallLabels` (blank tape of an estimated size without them). */
  tapes?: Partial<Record<ToolKind, TapeRef>>;
}

const TAPE_COLOUR: Record<ToolKind, 'black' | 'red' | 'blue'> = { laravel: 'black', vue: 'black', php: 'blue', python: 'black', rust: 'red', sql: 'black' };

/** The tapes' text, from content. */
export function toolName(kind: ToolKind): string {
  return world.tools[kind];
}

/** Make the six name tapes (the labels' default cap height: the 12 px rule). */
export function toolwallLabels(labels: Labels): Record<ToolKind, TapeRef> {
  const out = {} as Record<ToolKind, TapeRef>;
  for (const k of TOOL_KINDS) {
    const key = labels.tape(toolName(k), TAPE_COLOUR[k]);
    out[k] = { key, ...labels.size(key) };
  }
  return out;
}

/** A tape's size without the labels (clay, tests), within ~10% of the real one. */
export function estimateTape(text: string): { w: number; h: number } {
  const cap = 0.26;
  return { w: 1.42 * cap * (0.62 * text.length + 1.2), h: cap * 1.783 };
}

/** Where each tool goes: its row, the column centre of its tape, and where its own origin should land before the peg snaps to a hole. */
const LAYOUT: Record<ToolKind, { row: 0 | 1; x: number; ox: number; oy: number }> = {
  laravel: { row: 1, x: -1.3, ox: 0, oy: 0.06 },
  vue: { row: 1, x: 0.47, ox: 0, oy: 0.08 },
  php: { row: 1, x: 1.74, ox: 0, oy: 0.06 },
  python: { row: 0, x: -1.4, ox: 0, oy: 0.1 },
  rust: { row: 0, x: 0.4, ox: -0.6, oy: 0.62 },
  sql: { row: 0, x: 1.78, ox: 0.2, oy: 0.14 },
};
/** Tape centre heights (board frame, from y = 0) for the two rows, and where the tools above them start. */
const ROW = [{ tape: 0.5, tools: 0.82 }, { tape: 2.33, tools: 2.66 }] as const;
/** How far each tool stands off the board face (its half thickness and a gap). */
const STANDOFF: Record<ToolKind, number> = { laravel: 0.075, vue: 0.12, php: 0.1, python: 0.085, rust: 0.1, sql: 0.075 };

/** Hole centres: the grid the pegs snap to. */
function holeX(i: number): number {
  return -BOARD.w / 2 + BOARD.pitch / 2 + i * BOARD.pitch;
}
function holeY(j: number): number {
  return BOARD.y0 + BOARD.pitch / 2 + j * BOARD.pitch;
}
const snap = (v: number, at: (i: number) => number): number => {
  const i = Math.round((v - at(0)) / BOARD.pitch);
  return at(i);
};

export interface Hang {
  /** Where the tool's origin goes (board frame). */
  matrix: Matrix4;
  /** Peg centres on the board (x, y) and how far out the peg reaches. */
  pegs: Array<[number, number]>;
  reach: number;
  /** In-plane placement (for the shadow): x, y, turn in radians. */
  x: number;
  y: number;
  turn: number;
}

/** Where a tool hangs: its origin snapped so that its first peg is in a hole. Pure. */
export function hangOf(kind: ToolKind): Hang {
  const L = LAYOUT[kind];
  const sh = toolShape(kind);
  const turn = (sh.turn * Math.PI) / 180;
  const c = Math.cos(turn), s = Math.sin(turn);
  const rot = ([x, y]: [number, number]): [number, number] => [x * c - y * s, x * s + y * c];
  const want: [number, number] = [L.x + L.ox, ROW[L.row].tools + L.oy];
  const p0 = rot(sh.pegs[0]!);
  const px = snap(want[0] + p0[0], holeX), py = snap(want[1] + p0[1], holeY);
  const x = px - p0[0], y = py - p0[1];
  const zt = BOARD.face + STANDOFF[kind];
  return {
    matrix: chain(T(x, y, zt), new Matrix4().makeRotationZ(turn)),
    pegs: sh.pegs.map((p) => {
      const q = rot(p);
      return [x + q[0], y + q[1]] as [number, number];
    }),
    reach: STANDOFF[kind] + 0.07,
    x,
    y,
    turn,
  };
}

/**
 * The pegboard face: a plain board (a few big quads), and over it one small
 * dark octagon per hole, a hair proud: a fan whose centre is near black and
 * whose rim is the board darkened, so each hole has a crisp edge and a soft
 * depth. Holes under a tape are left out (`skip`).
 */
function boardFace(x0: number, x1: number, y0: number, y1: number, z: number, R: () => number, skip: (x: number, y: number) => boolean): { board: BufferGeometry; holes: BufferGeometry } {
  const md = new MeshData();
  const nx = 4, ny = 3;
  const grid: number[][] = [];
  for (let j = 0; j <= ny; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) row.push(md.v(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny, z, 0, 0, 1));
    grid.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) md.quad(grid[j]![i]!, grid[j]![i + 1]!, grid[j + 1]![i + 1]!, grid[j + 1]![i]!);
  const board = finish(md);
  const [r0, g0, b0] = linear('wood-light');
  const [r1, g1, b1] = linear('ink');
  const hm = new MeshData();
  const shades: number[] = [];
  const p = BOARD.pitch, rh = 0.031;
  for (let y = y0 + p / 2; y < y1; y += p)
    for (let x = x0 + p / 2; x < x1; x += p) {
      if (skip(x, y)) continue;
      const c = hm.v(x, y, z + 0.002, 0, 0, 1);
      shades.push(0);
      const ring: number[] = [];
      const ph = R() * 0.6;
      for (let k = 0; k < 8; k++) {
        const a = ph + (k / 8) * Math.PI * 2;
        ring.push(hm.v(x + Math.cos(a) * rh, y + Math.sin(a) * rh, z + 0.002, 0, 0, 1));
        shades.push(1);
      }
      for (let k = 0; k < 8; k++) hm.tri(c, ring[k]!, ring[(k + 1) % 8]!);
    }
  const holes = finish(hm);
  const col = holes.getAttribute(ATTR.color) as BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const t = shades[i]!;
    // the rim is the board in shadow; the middle the dark of the wall behind
    const k0 = 0.1 + 0.16 * t;
    col.setXYZ(i, r0 * k0 + r1 * (1 - t) * 0.3, g0 * k0 + g1 * (1 - t) * 0.3, b0 * k0 + b1 * (1 - t) * 0.3);
  }
  col.needsUpdate = true;
  return { board, holes };
}

/** A pegboard hook: out of the hole, along +Z, its tip kinked up so a tool cannot slide off. Built at the hole centre. */
function pegGeom(reach: number): BufferGeometry {
  const path = polylinePath([[0, 0, -0.01], [0, 0, reach - 0.03], [0, 0.035, reach]], 0.03, 2);
  return sweep(path, { radius: 0.019, segs: 6, ends: 'dome' });
}

export function toolwall(o: ToolwallOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const withTools = o.tools ?? true;
  const b = piece('toolwall', { detail, seed });
  const { w: BW, h: BH, y0, face: zF, bar, depth } = BOARD;

  // ---- the board ----------------------------------------------------------------------
  // where the tapes go (worked out first: no holes are drilled under them)
  const tapeAt = new Map<ToolKind, { m: Matrix4; ref: TapeRef }>();
  for (const kind of TOOL_KINDS) {
    const L = LAYOUT[kind];
    const ref = o.tapes?.[kind] ?? { key: '', ...estimateTape(toolName(kind)) };
    tapeAt.set(kind, { ref, m: chain(T(L.x + R.spread(0.04), ROW[L.row].tape + R.spread(0.02), zF + 0.005), mat({ rot: [0, 0, R.spread(1.8)] })) });
  }
  const under = (x: number, y: number): boolean => {
    for (const { m, ref } of tapeAt.values()) {
      const e = m.elements;
      if (Math.abs(x - e[12]!) < ref.w / 2 - 0.04 && Math.abs(y - e[13]!) < ref.h / 2 - 0.04) return true;
    }
    return false;
  };
  const face = boardFace(-BW / 2, BW / 2, y0, y0 + BH, zF, R, under);
  b.add(part('wood', face.board, 'wood-light', { seed: seed + 2, jitter: 0.03 }));
  b.add(part('wood', face.holes, undefined));
  // ---- the frame: rails full width, stiles between; screws -----------------------------
  const W = BW + 2 * bar - 0.16, H = y0 + BH + bar - 0.08;
  const fz0 = 0.0, fd = zF + 0.06 - fz0;
  const railY = [0, H - bar];
  for (const [i, y] of railY.entries()) {
    const g = roundedBox({ w: W, h: bar, d: fd, r: 0.035, rPlan: 0.03, segs: 2, detail });
    b.add(part('wood', transform(g, T(R.spread(0.004), y, fz0)), 'wood', { seed: seed + 3 + i, jitter: 0.07, warm: 0.03 }));
  }
  for (const sx of [-1, 1]) {
    const g = roundedBox({ w: bar, h: H - 2 * bar + 0.01, d: fd - 0.012, r: 0.03, rPlan: 0.03, segs: 2, detail });
    b.add(part('wood', grain(transform(g, T(sx * (W / 2 - bar / 2), bar - 0.005, fz0 + 0.004)), 'y'), 'wood', { seed: seed + 6 + sx, jitter: 0.08 }));
  }
  const screws: BufferGeometry[] = [];
  for (const [x, y] of [[-W / 2 + bar / 2, bar / 2], [W / 2 - bar / 2, bar / 2], [-W / 2 + bar / 2, H - bar / 2], [W / 2 - bar / 2, H - bar / 2], [0, bar / 2], [0, H - bar / 2], [-W / 2 + bar / 2, H / 2], [W / 2 - bar / 2, H / 2]] as const) {
    screws.push(transform(stud(0.026, 0.012, 6), chain(T(x + R.spread(0.01), y + R.spread(0.01), fz0 + fd), new Matrix4().makeRotationX(Math.PI / 2))));
  }
  b.small(() => part('metal', mergeGeometries(screws), 'steel', { seed: seed + 9, shade: 0.8 }));

  // ---- each tool: its painted shadow, its pegs, its tape, the tool -----------------------
  const pegs: BufferGeometry[] = [];
  for (const kind of TOOL_KINDS) {
    const hg = hangOf(kind);
    const sh = toolShape(kind);
    // the painted shadow, flat on the face
    const sm = chain(T(hg.x, hg.y, zF + 0.0035), new Matrix4().makeRotationZ(hg.turn));
    b.add(setFinish(part('wood', transform(shadowSheet(sh.shadow), sm), 'teal-deep', { seed: seed + 20 }), 0.98));
    for (const [px, py] of hg.pegs) pegs.push(transform(pegGeom(hg.reach), T(px, py, zF)));
    // the name tape under it, stuck on by hand
    const { m: at, ref: tp } = tapeAt.get(kind)!;
    const lifting = kind === 'rust';
    const lift = lifting ? (u: number, v: number) => 0.035 * Math.pow(Math.max(0, (u - 0.86) / 0.14), 2) * Math.max(0, 1 - v * 0.8) : () => 0;
    const faceG = transform(sheet({ w: tp.w, h: tp.h, t: 0.003, lift, nx: lifting ? 8 : 1, ny: lifting ? 2 : 1 }), at);
    if (tp.key) b.add(texturedPart('tape', faceG, tp.key));
    else b.add(part('tape', faceG, 'ink'));
    if (lifting) b.add(part('tape', transform(sheet({ w: tp.w, h: tp.h, t: 0.003, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));

    b.socket(`hang.${kind}`, hg.matrix);
    b.socket(`peg.${kind}`, T(hg.pegs[0]![0], hg.pegs[0]![1], zF + hg.reach));
    if (withTools) buildToolInto(kind, b.node(`tool.${kind}`, hg.matrix), seed);
  }
  // two spare pegs, waiting
  for (const [i, j] of [[24, 17], [22, 17]] as const) pegs.push(transform(pegGeom(0.16), T(holeX(i), holeY(j), zF)));
  b.add(part('metal', mergeGeometries(pegs), 'steel', { seed: seed + 30, shade: 1.05 }));
  return b.build();
}

const asTapes = (v: unknown): Partial<Record<ToolKind, TapeRef>> | undefined => (v && typeof v === 'object' ? (v as Partial<Record<ToolKind, TapeRef>>) : undefined);

export const catalogue: CatalogueEntry[] = [
  {
    name: 'toolwall',
    build: (opts = {}) => {
      const tapes = asTapes(opts['tapes']);
      return toolwall({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['tools'] === false ? { tools: false } : {}),
        ...(tapes ? { tapes } : {}),
      });
    },
    labels: (labels) => ({ tapes: toolwallLabels(labels) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, empty: { tools: false } },
    camera: { distance: 8 },
    note: 'Pegboard in a walnut frame: six tools on pegs over their painted shadows, a name tape under each.',
  },
  ...TOOL_KINDS.map(
    (kind): CatalogueEntry => ({
      name: `tool-${kind}`,
      build: (opts = {}) => tool(kind, { ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
      variants: { high: { detail: 'high' }, low: { detail: 'low' } },
      camera: { distance: 2.2 },
      note: `${toolName(kind)}: a hand tool from the tool wall, built hanging (length up +Y).`,
    }),
  ),
];
