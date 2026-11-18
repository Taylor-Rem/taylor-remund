/**
 * The window in the back wall (V; REWRITE.md § C "The window shows cut-out
 * mountains"; ART-P2 § 5): a painted wood casing round a deep opening, a
 * six-pane sash set back in it with a brass lock and lifts, a deep sill
 * that stands out over the bench, and behind the sash three layers of
 * cut-out plywood mountains, like stage scenery, against a pale sky that
 * glows a little and coolly. It is where the cool fill and the rim come
 * from, so it is the one cool light-coloured thing in the room. No sun, no
 * moon, no gradient wash, nothing photographic.
 *
 * Seen only from the front and 33° above, through a long lens: a ray through
 * the opening drops about 0.65 for every unit it goes back, so the scenery
 * is laid out for where the eye actually lands behind the sash (the far
 * range sits lower than it would face on), and the sky panel runs well
 * below the sill.
 *
 *   windowPiece({ seed })
 *
 * Origin: the middle of the opening's bottom edge, on the wall's face
 * (place it at the wall face, z = -5). The opening is WINDOW.w × WINDOW.h;
 * cut the wall with `windowHole(x, y)`. Good side +Z. The sill stands
 * 0.26 proud of the wall; the scenery goes 4.9 behind it (inside the wall's
 * dark: nothing else is there).
 *
 * Classes: wood (casing, sash, sill, scenery), bulb (the sky), brass.
 */
import { Matrix4, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { chain, mergeGeometries, part, piece, place, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { handle } from '../../details.ts';
import { finish, MeshData } from '../../mesh.ts';
import { rng, type Rng } from '../../rng.ts';
import { grain } from '../../space.ts';
import { tint } from '../../surface.ts';
import { ATTR } from '../../types.ts';
import { linear, type Token } from '../../../palette.ts';
import type { WallOpening } from '../bench/index.ts';

/** The opening (inside the casing), and how deep the reveal goes. */
export const WINDOW = { w: 3.2, h: 2.7, reveal: 0.42, sillOut: 0.26 } as const;

/** How deep each layer of scenery stands behind the wall's face (the far flat carries the sky). */
export const SCENE = { near: -1.75, mid: -3.3, far: -4.85 } as const;

/**
 * How much lower a thing must be built per unit it stands behind the sash to read at a given
 * height: the tangent of the angle the camera looks down at the window from. The rig pitches
 * 33 degrees, but at the home framing the window is above the frame's centre and is seen from
 * about 26; in a close look, from 33. Built for 29: the ranges ride a little higher at home and a
 * little lower close to, which is only the parallax a real window would give.
 */
const DROP = Math.tan((29 * Math.PI) / 180);

/** The hole to cut in the back wall for a window whose origin stands at (x, y) on it. */
export function windowHole(x: number, y: number): WallOpening {
  // a little bigger than the opening: the cut board ends hide behind the linings, the sill and the head
  return { x0: x - WINDOW.w / 2 - 0.02, x1: x + WINDOW.w / 2 + 0.02, y0: y - 0.1, y1: y + WINDOW.h + 0.02 };
}

/** The window's own paint: the dado's teal, lightened a little, worn through to the wood at edges. */
const PAINT: Token = 'teal-panel';
const PAINT_SHADE = 1.0;

/** The sky's glow: its colour's level (the bulb class multiplies it up to an indicator's brightness). */
export const SKY = { level: 0.3, snow: 1.1, far: 0.62, mid: 0.5, near: 0.42, edge: 0.35 };

/** The finish value the bulb class reads as steady (above 1.5: materials/classes.ts `bulb`). */
export const STEADY = 2;

/** Linear colour between two tokens (t = 0 a, 1 b), times k. */
function mixToken(a: Token, b: Token, t: number, k = 1): [number, number, number] {
  return blend([[a, 1 - t], [b, t]], k);
}

/** A weighted blend of tokens in linear light, times k. */
function blend(ws: ReadonlyArray<readonly [Token, number]>, k = 1): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const sum = ws.reduce((s, [, wt]) => s + wt, 0) || 1;
  for (const [t, wt] of ws) {
    const c = linear(t);
    for (let i = 0; i < 3; i++) out[i] = out[i]! + (c[i]! * wt * k) / sum;
  }
  return out;
}

function setColour(g: BufferGeometry, c: readonly [number, number, number]): BufferGeometry {
  const col = g.getAttribute(ATTR.color);
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c[0], c[1], c[2]);
  col.needsUpdate = true;
  return g;
}

/**
 * Painted timber (wood class: finish = paint coverage). Faces keep all their paint; the chamfers,
 * where the solid writes its wear, are worn thin in patches down to the wood. `cover` says how
 * much the edges keep (lower on the sill's nose, where hands and weather go).
 */
function painted(g: BufferGeometry, R: Rng, cover = 0.97): BufferGeometry {
  tint(g, PAINT, { seed: R.int(0, 1e6), jitter: 0.05, shade: PAINT_SHADE });
  const s = g.getAttribute(ATTR.surf);
  for (let i = 0; i < s.count; i++) s.setZ(i, s.getX(i) > 0.3 ? Math.max(0, cover - 0.35) : 1);
  s.needsUpdate = true;
  return g;
}

/**
 * A plywood cut-out: a ridge line (x ascending) down to `bottom`, `t` thick,
 * front at z = 0. The front face is painted; the sawn top edge is bare ply.
 */
function cutout(ridge: ReadonlyArray<readonly [number, number]>, bottom: number, t: number): { face: BufferGeometry; edge: BufferGeometry } {
  const md = new MeshData();
  const wear: number[] = [];
  const cover: number[] = [];
  let prevB = -1, prevT = -1;
  for (const [x, y] of ridge) {
    const bi = md.v(x, bottom, 0, 0, 0, 1), ti = md.v(x, y, 0, 0, 0, 1);
    wear.push(0, 0.15);
    cover.push(1, 1);
    if (prevB >= 0) md.quad(prevB, bi, ti, prevT);
    prevB = bi;
    prevT = ti;
  }
  // the sawn edge: one quad a segment, its normal across the cut
  const me = new MeshData();
  for (let i = 0; i < ridge.length - 1; i++) {
    const [ax, ay] = ridge[i]!, [bx, by] = ridge[i + 1]!;
    const dx = bx - ax, dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const a0 = me.v(ax, ay, 0, nx, ny, 0.3), b0 = me.v(bx, by, 0, nx, ny, 0.3);
    const a1 = me.v(ax, ay, -t, nx, ny, 0), b1 = me.v(bx, by, -t, nx, ny, 0);
    me.quad(a0, b0, b1, a1);
  }
  const face = finish(md);
  const s = face.getAttribute(ATTR.surf);
  for (let i = 0; i < s.count; i++) s.setXYZ(i, wear[i] ?? 0, 0, cover[i] ?? 1);
  s.needsUpdate = true;
  // the edge is painted ply, matte (wood class, fully painted): it never glints like the glowing faces
  const edge = finish(me);
  const se = edge.getAttribute(ATTR.surf);
  for (let i = 0; i < se.count; i++) se.setXYZ(i, 0.2, 0, 1);
  se.needsUpdate = true;
  return { face, edge };
}

/** A ridge line across [x0, x1]: peaks at the given (x, height) with jagged shoulders between, seeded. */
function ridgeLine(R: Rng, x0: number, x1: number, peaks: ReadonlyArray<readonly [number, number]>, base: number, jag: number, step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const at = (x: number): number => {
    // the highest of the peaks' slopes at x (each peak a steep tent with a seeded lean)
    let y = base;
    for (const [px, ph] of peaks) {
      const lean = 1 + (px * 7.3 % 1) * 0.4;
      const slope = x < px ? 1.05 * lean : 0.85 / lean;
      y = Math.max(y, ph - Math.abs(x - px) * slope);
    }
    return y;
  };
  for (let x = x0; x < x1; x += step * (0.6 + R() * 0.8)) pts.push([x, at(x) + R.spread(jag)]);
  for (const [px, ph] of peaks) if (px > x0 && px < x1) pts.push([px, ph]);
  pts.push([x1, at(x1)]);
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

/** Fir trees along the near ridge: a row of stepped spikes rising from it. */
function treeLine(R: Rng, x0: number, x1: number, ground: (x: number) => number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x0, ground(x0)]];
  let x = x0 + R.range(0.05, 0.2);
  while (x < x1 - 0.2) {
    const g = ground(x);
    if (R() < 0.62) {
      const hgt = R.range(0.24, 0.44), w = hgt * R.range(0.5, 0.62);
      // a fir in three tiers, the cut-out way: each tier's tips stand out past the one above, on a stub of trunk
      const c = x + w / 2;
      const tier = (k: number): number => R.spread(0.03) * w * k;
      pts.push([c - 0.07 * w, g], [c - 0.07 * w, g + hgt * 0.1], [c - 0.5 * w + tier(1), g + hgt * 0.1], [c - 0.17 * w, g + hgt * 0.4], [c - 0.37 * w + tier(1), g + hgt * 0.38], [c - 0.1 * w, g + hgt * 0.68], [c - 0.24 * w + tier(1), g + hgt * 0.66], [c, g + hgt]);
      pts.push([c + 0.24 * w + tier(1), g + hgt * 0.66], [c + 0.1 * w, g + hgt * 0.68], [c + 0.37 * w + tier(1), g + hgt * 0.38], [c + 0.17 * w, g + hgt * 0.4], [c + 0.5 * w + tier(1), g + hgt * 0.1], [c + 0.07 * w, g + hgt * 0.1], [c + 0.07 * w, g]);
      x += w + R.range(0.0, 0.12);
    } else {
      const w = R.range(0.15, 0.35);
      pts.push([x + w, ground(x + w) + R.spread(0.02)]);
      x += w;
    }
  }
  pts.push([x1, ground(x1)]);
  return pts;
}

export function windowPiece(o: KitOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const { w, h, reveal, sillOut } = WINDOW;
  const b = piece('window', { detail, seed, ao: { distance: 0.2 } });
  const wood = (g: BufferGeometry, cover = 0.9): void => void b.add(part('wood', painted(g, R, cover)));
  const along = (g: BufferGeometry, axis: 'x' | 'y'): BufferGeometry => grain(g, axis);

  // ---- the casing on the wall's face: two stiles, a head with a drip cap ----
  const cw = 0.2, ct = 0.06;
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -w / 2 - cw : w / 2, xb = s < 0 ? -w / 2 : w / 2 + cw;
    wood(along(bevelBox({ min: [xa, -0.1, 0], max: [xb, h + 0.22, ct], c: 0.018, omit: ['nz', 'ny'], wear: 0.8 }), 'y'));
  }
  wood(along(bevelBox({ min: [-w / 2 - cw - 0.06, h + 0.2, 0], max: [w / 2 + cw + 0.06, h + 0.44, ct + 0.02], c: 0.02, omit: ['nz'], wear: 0.8 }), 'x'));
  wood(along(bevelBox({ min: [-w / 2 - cw - 0.14, h + 0.44, 0], max: [w / 2 + cw + 0.14, h + 0.5, ct + 0.1], c: 0.022, omit: ['nz'], wear: 1 }), 'x'), 1.0);

  // ---- the reveal: linings inside the opening (only the right one's face is seen, but the head shows its edge) ----
  wood(along(bevelBox({ min: [w / 2 - 0.035, 0, -reveal], max: [w / 2, h, 0], c: 0.006, omit: ['px', 'nz', 'py', 'ny'] }), 'y'), 0.85);
  wood(along(bevelBox({ min: [-w / 2, 0, -reveal], max: [-w / 2 + 0.035, h, 0], c: 0.006, omit: ['nx', 'nz', 'py', 'ny'] }), 'y'), 0.85);
  wood(along(bevelBox({ min: [-w / 2, h - 0.035, -reveal], max: [w / 2, h, 0], c: 0.006, omit: ['py', 'nz', 'nx', 'px'] }), 'x'), 0.85);

  // ---- the deep sill, standing out over the bench, its nose worn to the wood; an apron board under it ----
  {
    const g = bevelBox({ min: [-w / 2 - cw - 0.12, -0.1, -reveal], max: [w / 2 + cw + 0.12, 0.0, sillOut], c: 0.03, omit: ['nz'], wear: 1, band: 0.03 });
    wood(along(g, 'x'), 0.95);
    wood(along(bevelBox({ min: [-w / 2 - 0.05, -0.36, 0], max: [w / 2 + 0.05, -0.1, 0.05], c: 0.014, omit: ['nz', 'py'] }), 'x'));
    // two brackets under the nose
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.15);
      wood(along(bevelBox({ min: [x - 0.05, -0.3, 0.05], max: [x + 0.05, -0.1, sillOut - 0.05], c: 0.015, omit: ['nz', 'py'] }), 'y'));
    }
  }

  // ---- the sash: set back in the reveal, six panes; a meeting rail across the middle ----
  const zs0 = -0.27, zs1 = -0.17;
  const mem = 0.12;
  const parts: BufferGeometry[] = [];
  const bar = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, ax: 'x' | 'y'): void => {
    parts.push(along(bevelBox({ min: [x0, y0, z0], max: [x1, y1, z1], c: 0.012, omit: ['nz'], wear: 0.85 }), ax));
  };
  bar(-w / 2 + 0.035, 0, -w / 2 + 0.035 + mem, h - 0.035, zs0, zs1, 'y');
  bar(w / 2 - 0.035 - mem, 0, w / 2 - 0.035, h - 0.035, zs0, zs1, 'y');
  bar(-w / 2 + 0.035, h - 0.035 - mem, w / 2 - 0.035, h - 0.035, zs0, zs1, 'x');
  bar(-w / 2 + 0.035, 0, w / 2 - 0.035, 0.17, zs0, zs1 + 0.01, 'x');
  const ym = h * 0.52;
  bar(-w / 2 + 0.035, ym - 0.06, w / 2 - 0.035, ym + 0.06, zs0, zs1 + 0.03, 'x');
  for (const s of [-1, 1]) {
    const x = s * (w / 6) + R.spread(0.01);
    bar(x - 0.03, 0.15, x + 0.03, ym - 0.05, zs0 + 0.01, zs1 - 0.005, 'y');
    bar(x - 0.03, ym + 0.05, x + 0.03, h - 0.05, zs0 + 0.01, zs1 - 0.005, 'y');
  }
  wood(mergeGeometries(parts), 0.92);
  // putty lines where the glass would sit: a hair of darker paint round each pane is not worth the triangles; the bars carry it

  // ---- brass: the sash lock on the meeting rail, two lifts on the bottom rail ----
  {
    const lock = chain(T(R.spread(0.04), ym + 0.06, zs1 + 0.03), new Matrix4().makeRotationX(-Math.PI / 2));
    b.add(part('brass', transform(bevelBox({ min: [-0.08, 0, -0.035], max: [0.08, 0.02, 0.035], c: 0.006, omit: ['ny'] }), lock), 'brass', { seed: R.int(0, 1e6), shade: 0.9 }));
    b.add(part('brass', transform(grain(stud(0.03, 0.035, 7), 'y'), chain(lock, T(0.02, 0.02, 0))), 'brass', { seed: R.int(0, 1e6) }));
    b.add(part('brass', transform(bevelBox({ min: [-0.012, 0, -0.012], max: [0.1, 0.02, 0.012], c: 0.004 }), chain(lock, T(0.02, 0.05, 0), new Matrix4().makeRotationY(0.5))), 'brass', { seed: R.int(0, 1e6) }));
    for (const s of [-1, 1]) {
      b.small(() => place(handle({ span: 0.16, reach: 0.05, r: 0.011, material: 'brass', token: 'brass', detail: 'low', seed: R.int(0, 999) }), T(s * w * 0.3, 0.085, zs1 + 0.01)));
    }
  }

  // ---- the scenery behind the sash: a light box of three cut-out ranges against the sky ----
  // Every layer glows at its own level (bulb class, indicator level, colours well down), so the
  // lamp in the room cannot light the world outside: what reads is pure value steps, pale sky,
  // lighter far peaks, darker near firs, the way cut paper reads in front of a lit panel.
  //
  // The layers stand SCENE apart (more than the stage's contact shading reaches, about 1.45 along
  // the view, or every pane fills with soft grey blots) and the camera pans, so they slide past one
  // another a little: real parallax. Heights are given as they READ through the window, from the
  // camera's 33 degrees: a layer d behind the sash is built 0.65 d lower (`sunk`).
  const sc = b; // static: the scenery is part of the root (a node would make the window a skinned mesh)
  const sunk = (z: number): number => DROP * (-z + zs1);
  const glow = (g: BufferGeometry, c: readonly [number, number, number]): BufferGeometry => {
    // finish 2: the bulb class's steady level (indicator brightness, but outside: the lamp's dimmer and flicker do not reach it)
    setColour(g, c);
    const sf = g.getAttribute(ATTR.surf);
    for (let i = 0; i < sf.count; i++) sf.setZ(i, STEADY);
    sf.needsUpdate = true;
    return g;
  };
  /** A cut-out at depth z from a ridge given as it reads: its face glows, its sawn edge is matte paint a step darker (a hair of outline). */
  const layer = (z: number, ridge: ReadonlyArray<readonly [number, number]>, c: readonly [number, number, number], bottom = -0.6): void => {
    const d = sunk(z);
    const cut = cutout(ridge.map(([x, y]) => [x, y - d] as [number, number]), bottom - d, 0.025);
    sc.add(part('bulb', glow(transform(cut.face, T(0, 0, z)), c)));
    sc.add(part('wood', setColour(transform(cut.edge, T(0, 0, z)), [c[0] * SKY.edge, c[1] * SKY.edge, c[2] * SKY.edge])));
  };
  // how far each layer reaches past the opening: wide enough for the parallax at the bench's ends
  const reach = (z: number): [number, number] => [-w / 2 - 0.4 - 0.2 * -z, w / 2 + 0.4 + 0.2 * -z];
  const L = SKY.level;
  // far: tall peaks with snow on them, closest in value to the sky; the sky is the same flat (no gap for shading to find)
  const farZ = SCENE.far;
  const farPeaks: Array<[number, number]> = [[-1.25, 2.18], [-0.35, 1.92], [0.55, 2.4], [1.45, 2.06], [2.5, 2.0], [-2.3, 2.05]];
  const fs = reach(farZ);
  const far = ridgeLine(R, fs[0], fs[1], farPeaks, 1.3, 0.035, 0.16);
  {
    const d = sunk(farZ);
    const g = bevelBox({ min: [fs[0] - 0.2, -0.8 - d, farZ - 0.03], max: [fs[1] + 0.2, h + 0.6 - d, farZ - 0.02], omit: ['nz', 'nx', 'px', 'py', 'ny'] });
    sc.add(part('bulb', glow(g, blend([['teal-light', 0.45], ['paper', 0.35], ['paint-blue', 0.2]], L))));
  }
  layer(farZ, far, blend([['teal-light', 0.6], ['paint-blue', 0.25], ['paper', 0.15]], L * SKY.far));
  for (const [px, ph] of farPeaks) {
    // a snow cap: the top of the peak again, a hair in front, cut off ragged below
    const capH = 0.2 + R() * 0.08;
    const pts = far.filter(([x, y]) => y > ph - capH && Math.abs(x - px) < 0.5);
    if (pts.length < 2) continue;
    const d = sunk(farZ);
    const lo = ph - capH - d;
    const cap = cutout(pts.map(([x, y]) => [x, y - d] as [number, number]), lo, 0.006);
    // the cap's lower edge is a zigzag: pull alternate bottom vertices up
    const pos = cap.face.getAttribute('position');
    let k = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - lo) < 1e-6) pos.setY(i, lo + (k++ % 2 ? R.range(0.03, 0.08) : 0));
    sc.add(part('bulb', glow(transform(cap.face, T(0, 0, farZ + 0.004)), blend([['paper', 0.7], ['teal-light', 0.3]], L * SKY.snow))));
  }
  // middle: rounder shoulders, a step darker
  const midZ = SCENE.mid;
  const ms = reach(midZ);
  layer(midZ, ridgeLine(R, ms[0], ms[1], [[-2.4, 1.38], [-1.6, 1.52], [-0.6, 1.3], [0.25, 1.58], [1.3, 1.4], [2.1, 1.5]], 1.0, 0.025, 0.14), blend([['teal-light', 0.75], ['paint-blue', 0.25]], L * SKY.mid));
  // near: a low ridge with firs on it, darkest
  const nearZ = SCENE.near;
  const ns = reach(nearZ);
  const ground = (x: number): number => 0.56 + Math.sin(x * 1.7 + 0.8) * 0.1 + Math.sin(x * 4.1) * 0.03;
  layer(nearZ, treeLine(R, ns[0], ns[1], ground), blend([['teal-panel', 0.8], ['teal-deep', 0.2]], L * SKY.near));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'window',
    build: (opts = {}) => windowPiece({ ...(typeof opts['seed'] === 'number' ? { seed: opts['seed'] } : {}), ...(opts['detail'] === 'low' ? { detail: 'low' as const } : {}) }),
    variants: { high: {}, low: { detail: 'low' } },
    camera: { distance: 9 },
    note: 'The back-wall window: painted casing, deep sill, six-pane sash, cut-out mountains in three layers against a cool glowing sky. Origin: bottom middle of the opening on the wall face.',
  },
];

