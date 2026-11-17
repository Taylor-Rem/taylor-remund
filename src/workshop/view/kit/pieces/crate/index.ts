/**
 * The crate (REWRITE.md § B1 "kind crate", art-direction § 10 CRATES), in
 * three sizes that differ in build, not only in scale:
 *
 *  - S (0.45): a small tight box, one plank a side, rope handles through
 *    its sides, nailed frame.
 *  - M (0.60): two planks a side, iron corner brackets with fat rivets.
 *  - L (0.80): three planks a side, a diagonal brace across the front,
 *    iron brackets, and two skids underneath.
 *
 * All three: proud corner posts and rails (bare `wood-light`) round inset
 * plank panels with real gaps and a dark inside; a lid of planks with two
 * cleats, hinged at the back; a brass hasp latch over a staple; the
 * stencil (two up-arrows and the size letter) sprayed across the front
 * planks; seeded out-of-square.
 *
 * Nodes: `root` (the body), `lid` (pivot on the back hinge line; local +Y
 * is world +X, so the view opens it by rotating about local Y, negative
 * lifts the front), `latch` (child of `lid`, the hasp, pivot on its
 * knuckle, local +Y along world +X; negative swings it up and off the
 * staple). Sockets: `label` (on the front top rail, facing +Z, where label
 * tape goes), `grip` (centre of mass).
 *
 * Paint (§ B1 "colour"): every inset panel plank carries a skin (a thin
 * ragged-edged layer a hair above its face, in the plank's own material
 * space, merged with the plank). Bare, the skin wears the plank's own
 * colour and cannot be told from it; painted, it wears the paint, and the
 * plank's bare wood shows round its ragged edge and in the gaps. The frame
 * is never painted. `repaint(object, paint)` rewrites only the skins'
 * vertex colours, so paint can arrive and drain without a rebuild.
 *
 * Stencil textures come from view/labels: call `crateLabels(labels)` once
 * before realizing a crate (it makes the keys the crate's parts name).
 */
import { BufferAttribute, CatmullRomCurve3, Matrix4, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { KitOptions, KitPart, MaterialClass, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { linear, paints, type Token } from '../../../palette.ts';
import { aim, chain, part, piece, texturedPart, T, type NodeBuilder } from '../../compose.ts';
import { deform, transform } from '../../deform.ts';
import { grain } from '../../space.ts';
import { tint } from '../../surface.ts';
import { rng, type Rng } from '../../rng.ts';
import { sweep, polylinePath, curvePath } from '../../sweep.ts';
import { labelKey } from '../../../labels/layout.ts';
import { world } from '../../../labels/content.ts';
import { bevelBox, decalBands, innerBox, mergeMarked, skin, stud, type FaceName } from './geo.ts';
import type { V3 } from '../../loft.ts';

export type CrateSize = 'S' | 'M' | 'L';

export interface CrateOptions extends KitOptions {
  size?: CrateSize;
  /** A palette token for the panels' paint, or null (default) for bare wood. */
  paint?: Token | null;
  /** Spray the stencil on the front (default true). Off for a piece realized without labels. */
  stencil?: boolean;
}

interface Spec {
  w: number; h: number; d: number;
  post: number; postC: number;
  /** How far the posts stand proud of the plank faces. */
  proud: number;
  railH: number; railProud: number; railC: number;
  plankT: number; plankC: number; gap: number; planks: number;
  lidPlanks: number; lidT: number; cleatT: number; cleatW: number;
  skid: number;
  /** Corner bracket size (0: none). */
  bracket: number;
  rope: boolean; brace: boolean; nails: boolean;
  /** Stencil: cap heights of the arrows and the letter, and their places on the front panel (fractions). */
  arrowCap: number; letterCap: number;
  skinPts: number;
}

const SPECS: Record<CrateSize, Spec> = {
  S: {
    w: 0.45, h: 0.44, d: 0.45, post: 0.066, postC: 0.011, proud: 0.034, railH: 0.062, railProud: 0.022, railC: 0.008,
    plankT: 0.024, plankC: 0.006, gap: 0.01, planks: 1, lidPlanks: 2, lidT: 0.03, cleatT: 0.022, cleatW: 0.062,
    skid: 0, bracket: 0, rope: true, brace: false, nails: true, arrowCap: 0.055, letterCap: 0.11, skinPts: 14,
  },
  M: {
    w: 0.6, h: 0.57, d: 0.58, post: 0.076, postC: 0.012, proud: 0.038, railH: 0.072, railProud: 0.026, railC: 0.009,
    plankT: 0.026, plankC: 0.007, gap: 0.011, planks: 2, lidPlanks: 2, lidT: 0.032, cleatT: 0.024, cleatW: 0.072,
    skid: 0, bracket: 0.104, rope: false, brace: false, nails: false, arrowCap: 0.068, letterCap: 0.15, skinPts: 16,
  },
  L: {
    w: 0.8, h: 0.75, d: 0.74, post: 0.09, postC: 0.014, proud: 0.044, railH: 0.086, railProud: 0.03, railC: 0.01,
    plankT: 0.028, plankC: 0.008, gap: 0.012, planks: 3, lidPlanks: 3, lidT: 0.036, cleatT: 0.028, cleatW: 0.086,
    skid: 0.072, bracket: 0.124, rope: false, brace: true, nails: false, arrowCap: 0.08, letterCap: 0.15, skinPts: 10,
  },
};

/** The outer size of a crate (Piece.size is measured; this is the design size). */
export function crateSpec(size: CrateSize): Readonly<Spec> {
  return SPECS[size];
}

// ---- the stencil -------------------------------------------------------------

const STENCIL_PAINT: Token = 'ink';
/**
 * Width of a stencil label in cap units: side pads (2 × 0.38, labels/layout
 * PROPORTIONS.stencil) plus the advance of its glyphs. The arrow's advance
 * is fixed (labels/draw ARROW_ADVANCE = 1); the letters' were measured in
 * the stencil face (Stardos Stencil Bold) on the labels dev page. The quad
 * is sized from these so the texture is not stretched.
 */
const STENCIL_W: Record<string, number> = { arrows: 2.89, S: 1.59, M: 2.0, L: 1.58 };
const STENCIL_H = 1.5;

function stencilTexts(size: CrateSize): { arrows: string; letter: string } {
  return { arrows: world.stencil.up + world.stencil.up, letter: world.stencil.size[size] };
}

/** The label keys a crate of this size names (the stencil textures). */
export function crateLabelKeys(size: CrateSize): { arrows: string; letter: string } {
  const s = SPECS[size];
  const t = stencilTexts(size);
  return {
    arrows: labelKey('stencil', t.arrows, STENCIL_PAINT, { capHeight: s.arrowCap }),
    letter: labelKey('stencil', t.letter, STENCIL_PAINT, { capHeight: s.letterCap }),
  };
}

/** Make every texture a crate needs (all three sizes). Call once before realizing crates. */
export function crateLabels(labels: Labels): void {
  for (const size of ['S', 'M', 'L'] as const) {
    const s = SPECS[size];
    const t = stencilTexts(size);
    const keys = crateLabelKeys(size);
    const a = labels.stencil(t.arrows, { paint: STENCIL_PAINT, capHeight: s.arrowCap });
    const l = labels.stencil(t.letter, { paint: STENCIL_PAINT, capHeight: s.letterCap });
    if (a !== keys.arrows || l !== keys.letter) throw new Error(`crate: label keys drifted (${a} / ${l})`);
  }
}

// ---- paint bookkeeping ----------------------------------------------------------

interface PaintInfo {
  /** [first vertex, count] of every skin in this geometry. */
  ranges: Array<[number, number]>;
  /** Per skin vertex (in range order): the bare colour (rgb) and the paint's tone multiplier. */
  bare: Float32Array;
  tone: Float32Array;
  /**
   * When the paint is its own material (enamel skins), bare means no paint at
   * all: the skins sink into their planks, out of sight, and come back up when painted.
   * The unfolded positions of the ranges, in range order.
   */
  rest: Float32Array | null;
}

/**
 * The paint's material class. 'steel' (enamel skins, folded away when bare)
 * reads as paint; 'wood' (skins merged into the planks, wearing the paint
 * colour over the grain) reads as stain. See the W2-crate report.
 */
const PAINT_CLASS = 'steel' as MaterialClass;
/** How far a bare crate's paint skins sit inside their planks (less than any plank is thick). */
const SKIN_SINK = 0.012;

const PAINT = new WeakMap<BufferGeometry, PaintInfo>();

/** Where the paint lives in a built crate: per node and material, the skin vertex ranges. */
export function paintRanges(p: Piece): Array<{ node: string; material: MaterialClass; ranges: Array<[number, number]> }> {
  const out: Array<{ node: string; material: MaterialClass; ranges: Array<[number, number]> }> = [];
  const walk = (n: PieceNode): void => {
    for (const q of n.parts) {
      const info = PAINT.get(q.geometry);
      if (info) out.push({ node: n.name, material: q.material, ranges: info.ranges.map((r) => [r[0], r[1]]) });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

function writePaint(g: BufferGeometry, info: PaintInfo, paint: Token | null): void {
  const col = g.getAttribute('color') as BufferAttribute;
  const a = col.array as Float32Array;
  const pc = paint ? linear(paint) : null;
  let k = 0;
  for (const [start, count] of info.ranges) {
    for (let i = start; i < start + count; i++, k++) {
      if (pc) {
        const t = info.tone[k]!;
        a[i * 3] = pc[0] * t;
        a[i * 3 + 1] = pc[1] * t;
        a[i * 3 + 2] = pc[2] * t;
      } else {
        a[i * 3] = info.bare[k * 3]!;
        a[i * 3 + 1] = info.bare[k * 3 + 1]!;
        a[i * 3 + 2] = info.bare[k * 3 + 2]!;
      }
    }
  }
  col.needsUpdate = true;
  if (info.rest) {
    // bare: each skin sinks into its plank (hidden inside the wood); painted: back on the face
    const pos = g.getAttribute('position') as BufferAttribute;
    const nrm = g.getAttribute('normal') as BufferAttribute;
    const p = pos.array as Float32Array;
    const sink = paint ? 0 : SKIN_SINK;
    let j = 0;
    for (const [start, count] of info.ranges) {
      for (let i = start; i < start + count; i++, j++) {
        p[i * 3] = info.rest[j * 3]! - nrm.getX(i) * sink;
        p[i * 3 + 1] = info.rest[j * 3 + 1]! - nrm.getY(i) * sink;
        p[i * 3 + 2] = info.rest[j * 3 + 2]! - nrm.getZ(i) * sink;
      }
    }
    pos.needsUpdate = true;
  }
}

/**
 * Repaint a realized crate (the Object3D from `realize`): rewrites the paint
 * skins' vertex colours to `paint` (a palette token) or back to bare wood
 * (null). Geometry shared with other crates (the build memo) is cloned for
 * this object first, so only this crate changes. Returns how many meshes it
 * touched (0: not a crate).
 */
export function repaint(object: Object3D, paint: Token | null): number {
  let n = 0;
  object.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    let info = PAINT.get(m.geometry);
    if (!info) return;
    if (m.userData['crateOwnPaint'] !== true) {
      const g = m.geometry.clone();
      PAINT.set(g, info);
      m.geometry = g;
      m.userData['crateOwnPaint'] = true;
      info = PAINT.get(g)!;
    }
    writePaint(m.geometry, info, paint);
    n++;
  });
  return n;
}

// ---- the build -------------------------------------------------------------------

const DEG = Math.PI / 180;
const Ry = (deg: number): Matrix4 => new Matrix4().makeRotationY(deg * DEG);
const Rx = (deg: number): Matrix4 => new Matrix4().makeRotationX(deg * DEG);

interface Skinned {
  geometry: BufferGeometry;
  ranges: Array<[number, number]>;
  bare: number[];
  tone: number[];
}

export function crate(o: CrateOptions = {}): Piece {
  const size = o.size ?? 'M';
  const S = SPECS[size];
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const paint = o.paint ?? null;
  const R = rng(seed * 7919 + size.charCodeAt(0));
  const b = piece('crate', { detail, seed });

  const W = S.w, H = S.h, D = S.d;
  const y0 = S.skid;
  const yLid = H - S.cleatT - S.lidT; // top of the walls, underside of the lid
  const cB = (c: number): number => (low ? 0 : c);

  // Out of square: a little lean, a little twist, a top not quite level (seeded, tiny).
  const lx = R.spread(0.007), lz = R.spread(0.007), tw = R.spread(0.03), ty = R.spread(0.006);
  const square = (g: BufferGeometry): BufferGeometry =>
    deform(g, (x, y, z) => {
      const t = y / H;
      const a = tw * t;
      return [x * Math.cos(a) - z * Math.sin(a) + lx * y, y + ty * x * t, x * Math.sin(a) + z * Math.cos(a) + lz * y];
    }, { keepSurf: true });

  const skinned = new Map<BufferGeometry, Skinned>();
  /** A wood part; when `skins` are given they merge into it and are remembered as its paint. */
  const wood = (g: BufferGeometry, token: Token, t: { seed: number; jitter?: number; shade?: number; warm?: number }, skins?: { geoms: BufferGeometry[]; tone: number }): KitPart[] => {
    tint(g, token, t);
    if (!skins || skins.geoms.length === 0) return [{ material: 'wood', geometry: g }];
    if (PAINT_CLASS !== 'wood') {
      // enamel: each skin its own part of the paint class, the whole of it paint
      const out: KitPart[] = [{ material: 'wood', geometry: g }];
      for (const s of skins.geoms) {
        tint(s, token, t);
        const n = s.getAttribute('position').count;
        const c = (s.getAttribute('color') as BufferAttribute).array as Float32Array;
        skinned.set(s, { geometry: s, ranges: [[0, n]], bare: Array.from(c), tone: new Array<number>(n).fill(skins.tone) });
        out.push({ material: PAINT_CLASS, geometry: s });
      }
      return out;
    }
    const base = (g.getAttribute('color') as BufferAttribute).array as Float32Array;
    const bare: number[] = [];
    const tone: number[] = [];
    for (const s of skins.geoms) {
      tint(s, token, t); // bare: exactly the plank's colour
      const n = s.getAttribute('position').count;
      for (let i = 0; i < n; i++) {
        bare.push(base[0]!, base[1]!, base[2]!);
        tone.push(skins.tone);
      }
    }
    const { geometry, ranges } = mergeMarked([g, ...skins.geoms], new Set(skins.geoms));
    skinned.set(geometry, { geometry, ranges, bare, tone });
    return [{ material: 'wood', geometry }];
  };

  const into = (node: NodeBuilder, parts: KitPart | KitPart[], toNode?: Matrix4): void => {
    for (const p of Array.isArray(parts) ? parts : [parts]) {
      square(p.geometry);
      if (toNode) transform(p.geometry, toNode);
      node.add(p);
    }
  };

  // ---- the body: posts ------------------------------------------------------------
  const P = S.post;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x0 = sx > 0 ? W / 2 - P : -W / 2, z0 = sz > 0 ? D / 2 - P : -D / 2;
    const g = grain(bevelBox({ min: [x0, y0, z0], max: [x0 + P, yLid, z0 + P], c: cB(S.postC), wear: 0.85 }), 'y');
    into(b, wood(g, 'wood-light', { seed: R.int(0, 1e6), jitter: 0.08, warm: 0.05, shade: 0.95 }));
  }

  // ---- walls: built facing +Z in a canonical frame, turned to each side ------------
  const zP = (half: number): number => half - S.proud; // plank face
  const walls: Array<{ rot: number; width: number; half: number; front: boolean; side: boolean }> = [
    { rot: 0, width: W, half: D / 2, front: true, side: false },
    { rot: 90, width: D, half: W / 2, front: false, side: true },
    { rot: 180, width: W, half: D / 2, front: false, side: false },
    { rot: -90, width: D, half: W / 2, front: false, side: true },
  ];
  const panelY0 = y0 + S.railH, panelY1 = yLid - S.railH;
  const span0 = panelY0 - 0.012, span1 = panelY1 + 0.012;
  const paintTone = (): number => 0.82 + R.spread(0.07);

  for (const wl of walls) {
    const Rw = Ry(wl.rot);
    const half = wl.half, Wc = wl.width;
    const zf = zP(half);
    const zR = zf + S.railProud;
    const xIn = Wc / 2 - P; // inner face of the posts
    // rails: buried in the posts at their ends, against the planks at their backs
    for (const [ya, yb] of [[y0, y0 + S.railH], [yLid - S.railH, yLid]] as const) {
      const g = bevelBox({ min: [-xIn - 0.01, ya, zf - 0.006], max: [xIn + 0.01, yb + R.spread(0.002), zR + R.spread(0.002)], c: cB(S.railC), omit: ['px', 'nx', 'nz'], wear: 0.8 });
      into(b, wood(transform(g, Rw), 'wood-light', { seed: R.int(0, 1e6), jitter: 0.08, warm: 0.05, shade: 0.95 }));
    }
    // planks, each a little cupped or tipped, with a paint skin and (on the front) the stencil
    const n = S.planks;
    const gaps = Array.from({ length: n - 1 }, () => S.gap * (0.75 + R() * 0.6));
    const ph = (span1 - span0 - gaps.reduce((s, x) => s + x, 0)) / n;
    let y = span0;
    const bands: Array<[number, number]> = [];
    const plankMats: Matrix4[] = [];
    const plankYs: number[] = [];
    for (let i = 0; i < n; i++) {
      const yc = y + ph / 2;
      const Mp = chain(Rw, T(0, yc, zf + R.spread(0.0015)), Rx(R.spread(0.9)));
      plankMats.push(Mp);
      plankYs.push(yc);
      const L = 2 * xIn + 0.024;
      const g = bevelBox({ min: [-L / 2, -ph / 2, -S.plankT], max: [L / 2, ph / 2, 0], c: cB(S.plankC), omit: ['px', 'nx', 'nz'], wear: 0.7 });
      // the skin: the visible face between the posts and rails, a hair proud
      const vy0 = Math.max(-ph / 2 + cB(S.plankC), panelY0 - yc), vy1 = Math.min(ph / 2 - cB(S.plankC), panelY1 - yc);
      const sk = skin(-xIn + 0.003, xIn - 0.003, vy0, vy1, low ? 5 : S.skinPts, low ? 0.004 : S.gap * 0.9, R);
      transform(sk, T(0, 0, 0.0022));
      bands.push([yc + vy0, yc + vy1]);
      transform(g, Mp);
      transform(sk, Mp);
      into(b, wood(g, 'wood-light', { seed: R.int(0, 1e6), jitter: 0.13, warm: 0.07, shade: 0.8 }, { geoms: [sk], tone: paintTone() }));
      y += ph + (gaps[i] ?? 0);
    }
    // the dark inside, seen through the gaps
    if (wl.front) {
      // stencil: arrows over the size letter, sprayed across the planks
      if (o.stencil !== false) {
        const keys = crateLabelKeys(size);
        const pw = 2 * xIn;
        const ph2 = panelY1 - panelY0;
        const aw = STENCIL_W.arrows! * S.arrowCap, ah = STENCIL_H * S.arrowCap;
        const lw = STENCIL_W[size]! * S.letterCap, lh = STENCIL_H * S.letterCap;
        let ax: number, ay: number, lxp: number, lyp: number;
        const mid = (bd: readonly [number, number]): number => (bd[0] + bd[1]) / 2;
        if (S.brace) {
          // the brace runs bottom-left to top-right: arrows above it, the letter below
          ax = -pw * 0.22; ay = mid(bands[n - 1]!);
          lxp = pw * 0.24; lyp = mid(bands[0]!) + 0.012;
        } else {
          // one plank: arrows over the letter; more: arrows on the top plank, the letter on the bottom one
          ax = R.spread(0.01); ay = n === 1 ? panelY0 + ph2 * 0.73 : mid(bands[n - 1]!);
          lxp = R.spread(0.012); lyp = n === 1 ? panelY0 + ph2 * 0.34 : mid(bands[0]!) + 0.015;
        }
        const zs = 0.0042;
        for (const [key, cx, cy, w, h] of [[keys.arrows, ax, ay, aw, ah], [keys.letter, lxp, lyp, lw, lh]] as const) {
          // each band rides its own plank (its tilt), cut at the gaps
          const tilt = R.spread(1.2);
          for (let i = 0; i < n; i++) {
            const band = bands[i]!;
            const g = decalBands(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, [band]);
            if (!g) continue;
            // the stencil was held a little crooked: turn the texture, not the band (the band must stop at the gap)
            const uv = g.getAttribute('uv') as BufferAttribute;
            const ca = Math.cos(tilt * DEG), sa = Math.sin(tilt * DEG);
            for (let j = 0; j < uv.count; j++) {
              const px = (uv.getX(j) - 0.5) * w, py = (uv.getY(j) - 0.5) * h;
              uv.setXY(j, (px * ca - py * sa) / w + 0.5, (px * sa + py * ca) / h + 0.5);
            }
            // the band is in wall coordinates: onto plank i's face (its own cup)
            transform(g, chain(plankMats[i]!, T(0, -plankYs[i]!, zs)));
            into(b, texturedPart('wood', g, key));
          }
        }
      }
    }
    // S: nail heads where the rails meet the posts
    if (S.nails && !low) {
      const nr = 0.0085;
      for (const sx of [-1, 1]) for (const yy of [y0 + S.railH / 2, yLid - S.railH / 2]) {
        const nx = sx * (xIn + P / 2);
        const s = grain(stud(nr, 0.005, 5), 'y');
        const m = chain(Rw, aim([nx + R.spread(0.006), yy + R.spread(0.008), half], [0, 0, 1], R.range(0, 72)));
        into(b, part('metal', transform(s, m), 'steel', { seed: R.int(0, 1e6), shade: 0.55, jitter: 0.1 }));
      }
    }
    // S: a rope handle through each side
    if (S.rope && wl.side) {
      const yh = panelY1 - 0.032;
      const hx = Wc * 0.17;
      const zr = zR;
      // a hanging loop: out of one hole, a sag (not quite symmetric), back into the other
      const sag = 0.078 + R.spread(0.006), lean = R.spread(0.012);
      const pts = [
        [-hx, yh, zf - 0.02], [-hx, yh, zr + 0.008], [-hx * 0.92, yh - sag * 0.55, zr + 0.013], [lean, yh - sag, zr + 0.015],
        [hx * 0.92, yh - sag * 0.55, zr + 0.013], [hx, yh, zr + 0.008], [hx, yh, zf - 0.02],
      ].map((p) => new Vector3(p[0], p[1], p[2]));
      const path = curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), low ? 6 : 12);
      const g = sweep(path, { radius: 0.0115, segs: low ? 4 : 6, ends: 'flat', detail });
      into(b, part('felt', transform(g, Rw), 'wood-light', { seed: R.int(0, 1e6), shade: 0.95 }));
      // the rope's whipping where it enters each hole
      if (!low) {
        for (const sx of [-1, 1]) {
          const wg = sweep(polylinePath([[sx * hx, yh, zf - 0.004], [sx * hx, yh, zf + 0.012]], 0, 1), { radius: 0.0145, segs: 6, ends: 'flat', detail });
          into(b, part('felt', transform(wg, Rw), 'wood', { seed: R.int(0, 1e6), shade: 0.8 }));
        }
      }
    }
  }

  // the inside: dark, so the gaps read as depth (faces look inward)
  {
    const inX = W / 2 - S.proud - S.plankT, inZ = D / 2 - S.proud - S.plankT;
    into(b, part('wood', innerBox([-inX, y0 + 0.02, -inZ], [inX, yLid - 0.002, inZ]), 'wood', { seed: 3, shade: 0.4 }));
    // the floor seen from below
    into(b, wood(bevelBox({ min: [-W / 2 + P * 0.5, y0 + 0.004, -D / 2 + P * 0.5], max: [W / 2 - P * 0.5, y0 + 0.03, D / 2 - P * 0.5], omit: ['px', 'nx', 'py', 'pz', 'nz'] }), 'wood-light', { seed: R.int(0, 1e6), shade: 0.8 }));
  }

  // L: the diagonal brace across the front, its ends cut level against the rails
  if (S.brace) {
    const xIn = W / 2 - P;
    const zf = zP(D / 2);
    const ya = panelY0, yb = panelY1;
    const bw = S.railH * 1.65; // measured across X: the sheared board is cos(angle) of that across its face
    const slope = (2 * xIn - bw * 0.55) / (yb - ya);
    const g = bevelBox({ min: [-bw / 2, ya, zf - 0.004], max: [bw / 2, yb, zf + S.railProud - 0.002], c: cB(S.railC), omit: ['py', 'ny', 'nz'], wear: 0.8 });
    const ym = (ya + yb) / 2;
    deform(g, (x, yy, z) => [x + (yy - ym) * slope, yy, z], { keepSurf: true });
    grain(g, new Matrix4().makeRotationZ(-Math.atan(slope))); // grain along the brace
    into(b, wood(g, 'wood-light', { seed: R.int(0, 1e6), jitter: 0.08, warm: 0.05, shade: 0.95 }));
  }

  // L: skids
  if (S.skid > 0) {
    for (const sz of [-1, 1]) {
      const zc = sz * (D / 2 - 0.13) + R.spread(0.01);
      const g = bevelBox({ min: [-W / 2 + 0.015, 0, zc - 0.05], max: [W / 2 - 0.015, S.skid + 0.004, zc + 0.05], c: cB(0.012), omit: ['py', 'ny'], wear: 0.85 });
      into(b, wood(g, 'wood', { seed: R.int(0, 1e6), jitter: 0.05, shade: 1.15 }));
    }
  }

  // M, L: iron corner brackets with fat rivets
  if (S.bracket > 0) {
    const bs = S.bracket, e = 0.0048;
    const missing = R.int(0, 15);
    let k = 0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      for (const top of [false, true]) {
        const ya = top ? yLid - bs : y0, yb = top ? yLid : y0 + bs;
        const xa = sx > 0 ? W / 2 - bs : -W / 2 - e, xb = sx > 0 ? W / 2 + e : -W / 2 + bs;
        const za = sz > 0 ? D / 2 - bs : -D / 2 - e, zb = sz > 0 ? D / 2 + e : -D / 2 + bs;
        if (low && !top) continue; // far away, the bottom brackets are lost in the contact shadow
        const g = bevelBox({ min: [xa, ya, za], max: [xb, yb, zb], c: cB(0.0042), wear: 0.95 });
        into(b, part('metal', g, 'steel', { seed: R.int(0, 1e6), shade: 0.85, jitter: 0.1 }));
        if (low || (!top && size === 'L')) continue;
        const ym = (ya + yb) / 2 + (top ? 0.006 : -0.006);
        const rr = bs * 0.13;
        for (const face of ['z', 'x'] as const) {
          if (k++ === missing) continue; // one rivet long gone
          const at: V3 = face === 'z' ? [sx * (W / 2 - bs * 0.42), ym, sz * (D / 2 + e)] : [sx * (W / 2 + e), ym, sz * (D / 2 - bs * 0.42)];
          const dir: V3 = face === 'z' ? [0, 0, sz] : [sx, 0, 0];
          const s = grain(stud(rr, rr * 0.75, 5), 'y');
          into(b, part('metal', transform(s, aim(at, dir, R.range(0, 60))), 'steel', { seed: R.int(0, 1e6), shade: 0.85, jitter: 0.1 }));
        }
      }
    }
  }

  // back hinges, the fixed leaves (on the back top rail)
  const hingeX = [-W * 0.3, W * 0.3];
  const zBack = -(D / 2 - S.proud + S.railProud);
  for (const hx of hingeX) {
    const g = bevelBox({ min: [hx - 0.035, yLid - S.railH * 0.85, zBack - 0.006], max: [hx + 0.035, yLid - 0.002, zBack], c: 0, omit: ["pz"] });
    into(b, part('metal', g, 'steel', { seed: R.int(0, 1e6), shade: 0.45 }));
  }

  // the staple the hasp drops over, on the front top rail
  const zRf = D / 2 - S.proud + S.railProud;
  const latchX = 0;
  const stapleY = yLid - S.railH * 0.5;
  into(b, part('brass', bevelBox({ min: [latchX - 0.028, stapleY - 0.022, zRf - 0.002], max: [latchX + 0.028, stapleY + 0.022, zRf + 0.004], c: 0, omit: ['nz'], wear: 0.9 }), 'brass', { seed: R.int(0, 1e6) }));
  into(b, part('brass', bevelBox({ min: [latchX - 0.011, stapleY - 0.008, zRf + 0.003], max: [latchX + 0.011, stapleY + 0.008, D / 2 + 0.022], c: cB(0.004), omit: ['nz'], wear: 0.9 }), 'brass', { seed: R.int(0, 1e6) }));

  // ---- the lid ----------------------------------------------------------------------
  const lidAt = chain(T(0, yLid, -D / 2), new Matrix4().makeRotationZ(-Math.PI / 2));
  const lid = b.node('lid', lidAt);
  const toLid = lidAt.clone().invert();
  {
    const n = S.lidPlanks;
    const gaps = Array.from({ length: n - 1 }, () => S.gap * (0.75 + R() * 0.6));
    const pd = (D - gaps.reduce((s, x) => s + x, 0)) / n;
    let z = -D / 2;
    for (let i = 0; i < n; i++) {
      const zc = z + pd / 2;
      // a plank lying face up: built facing +Z, turned so +Z is up
      const Mp = chain(T(R.spread(0.003), yLid + S.lidT, zc), Rx(-90), Rx(R.spread(0.8)));
      const g = bevelBox({ min: [-W / 2, -pd / 2, -S.lidT], max: [W / 2, pd / 2, 0], c: cB(S.plankC), omit: ['nz'], wear: 0.75 });
      const xs = W / 2 - S.cleatW - 0.035;
      const sk = skin(-xs, xs, -pd / 2 + cB(S.plankC), pd / 2 - cB(S.plankC), low ? 5 : S.skinPts, low ? 0.004 : S.gap * 0.9, R);
      transform(sk, T(0, 0, 0.0022));
      transform(g, Mp);
      transform(sk, Mp);
      into(lid, wood(g, 'wood-light', { seed: R.int(0, 1e6), jitter: 0.13, warm: 0.07, shade: 0.8 }, { geoms: [sk], tone: paintTone() }), toLid);
      z += pd + (gaps[i] ?? 0);
    }
    // two cleats across the planks, near the ends
    for (const sx of [-1, 1]) {
      const xc = sx * (W / 2 - S.cleatW / 2 - 0.012) + R.spread(0.004);
      const g = grain(bevelBox({ min: [xc - S.cleatW / 2, yLid + S.lidT - 0.003, -D / 2 + 0.008], max: [xc + S.cleatW / 2, H, D / 2 - 0.008], c: cB(S.railC), omit: ['ny'], wear: 0.85 }), 'z');
      into(lid, wood(g, 'wood-light', { seed: R.int(0, 1e6), jitter: 0.08, warm: 0.05, shade: 0.95 }), toLid);
    }
    // the hinges' moving leaves, on the back edge of the lid
    for (const hx of hingeX) {
      const g = bevelBox({ min: [hx - 0.035, yLid + 0.002, -D / 2 - 0.006], max: [hx + 0.035, yLid + S.lidT - 0.002, -D / 2], c: 0, omit: ["pz"] });
      into(lid, part('metal', g, 'steel', { seed: R.int(0, 1e6), shade: 0.45 }), toLid);
    }
  }

  // the hasp: hinged on the lid's front edge, hanging over the staple
  const kY = yLid + S.lidT * 0.5, kZ = D / 2 + 0.011;
  const haspAt = chain(T(latchX, kY, kZ), new Matrix4().makeRotationZ(-Math.PI / 2));
  const latch = lid.node('latch', chain(toLid, haspAt));
  const toHasp = haspAt.clone().invert();
  {
    const hw = size === 'L' ? 0.04 : size === 'M' ? 0.034 : 0.03;
    // the knuckle (barrel) and the plate
    const kn = grain(bevelBox({ min: [latchX - hw - 0.006, kY - 0.0085, kZ - 0.0085], max: [latchX + hw + 0.006, kY + 0.0085, kZ + 0.0085], c: cB(0.0045), wear: 0.95 }), 'x');
    into(latch, part('brass', kn, 'brass', { seed: R.int(0, 1e6) }), toHasp);
    const plate = bevelBox({ min: [latchX - hw, stapleY - 0.03, kZ - 0.0035], max: [latchX + hw, kY - 0.004, kZ + 0.0035], c: cB(0.0025), wear: 0.9 });
    into(latch, part('brass', grain(plate, 'y'), 'brass', { seed: R.int(0, 1e6), warm: 0.03 }), toHasp);
    // the fixed leaf of the hasp's hinge, on the lid's front edge
    const leaf = bevelBox({ min: [latchX - hw * 0.8, yLid + 0.004, D / 2 - 0.001], max: [latchX + hw * 0.8, yLid + S.lidT - 0.003, D / 2 + 0.004], c: 0, omit: ['nz'] });
    into(lid, part('brass', leaf, 'brass', { seed: R.int(0, 1e6) }), toLid);
  }

  b.socket('label', { at: [-W * 0.27, yLid - S.railH / 2, zRf + 0.001] });
  b.socket('grip', { at: [0, (y0 + H) / 2, 0] });
  const built = b.build();
  registerPaint(b, built, skinned);
  for (const [g, info] of paintGeoms(built)) if (paint || info.rest) writePaint(g, info, paint);
  return built;
}

/** After the build: find each skinned part inside the merged node geometry and record its ranges. */
function registerPaint(b: NodeBuilder, built: Piece, skinned: Map<BufferGeometry, Skinned>): void {
  const walk = (nb: NodeBuilder, node: PieceNode): void => {
    // replay merge(): one group per (material, variant, texture), in order of first appearance
    const groups = new Map<string, { at: number; ranges: Array<[number, number]>; bare: number[]; tone: number[] }>();
    for (const q of nb.parts) {
      const key = `${q.material}|${q.variant ?? ''}|${q.texture ?? ''}`;
      let gr = groups.get(key);
      if (!gr) {
        gr = { at: 0, ranges: [], bare: [], tone: [] };
        groups.set(key, gr);
      }
      const sk = skinned.get(q.geometry);
      if (sk) {
        for (const [s, c] of sk.ranges) gr.ranges.push([gr.at + s, c]);
        gr.bare.push(...sk.bare);
        gr.tone.push(...sk.tone);
      }
      gr.at += q.geometry.getAttribute('position').count;
    }
    for (const p of node.parts) {
      const gr = groups.get(`${p.material}|${p.variant ?? ''}|${p.texture ?? ''}`);
      if (gr && gr.ranges.length) {
        let rest: Float32Array | null = null;
        if (p.material !== 'wood') {
          const a = p.geometry.getAttribute('position').array as Float32Array;
          rest = new Float32Array(gr.ranges.reduce((s, r) => s + r[1], 0) * 3);
          let j = 0;
          for (const [st, c] of gr.ranges) for (let i = st; i < st + c; i++, j++) rest.set(a.subarray(i * 3, i * 3 + 3), j * 3);
        }
        PAINT.set(p.geometry, { ranges: gr.ranges, bare: new Float32Array(gr.bare), tone: new Float32Array(gr.tone), rest });
      }
    }
    nb.children.forEach((c, i) => {
      const child = node.children?.[i];
      if (child) walk(c, child);
    });
  };
  walk(b, built.root);
}

function paintGeoms(p: Piece): Array<[BufferGeometry, PaintInfo]> {
  const out: Array<[BufferGeometry, PaintInfo]> = [];
  const walk = (n: PieceNode): void => {
    for (const q of n.parts) {
      const info = PAINT.get(q.geometry);
      if (info) out.push([q.geometry, info]);
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

// ---- catalogue -------------------------------------------------------------------

const asSize = (v: unknown): CrateSize => (v === 'S' || v === 'L' ? v : 'M');
const asPaint = (v: unknown): Token | null => (typeof v === 'string' && (paints as readonly string[]).includes(v) ? (v as Token) : null);

export const catalogue: CatalogueEntry[] = [
  {
    name: 'crate',
    build: (opts = {}) =>
      crate({
        size: asSize(opts['size']),
        paint: asPaint(opts['paint']),
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        // the stencil needs its textures made first (crateLabels); the catalogue page does not make them yet
        ...(opts['stencil'] === true ? {} : { stencil: false }),
      }),
    variants: {
      M: { size: 'M' },
      S: { size: 'S' },
      L: { size: 'L' },
      'M blue': { size: 'M', paint: 'paint-blue' },
      'S red': { size: 'S', paint: 'cable-red' },
      'L green': { size: 'L', paint: 'paint-green' },
      'M low': { size: 'M', detail: 'low' },
    },
    camera: { distance: 3.2 },
    note: 'Shipping crate, S/M/L built differently; paint on the panels (repaint without rebuild), stencil from labels.',
  },
];

export type { FaceName };
