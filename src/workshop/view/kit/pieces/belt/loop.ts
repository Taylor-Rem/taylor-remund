/**
 * The belt's loop: one closed path round the two end drums, as pure maths
 * (where a point `s` along the loop is, and which way it travels), so the
 * geometry, the seam's pose and the view's roller spin all agree.
 *
 * The loop is the path of the belt's MIDDLE (half its thickness in from
 * either face). s = 0 is the middle of the return run, underneath, where
 * nobody looks: the belt material's ribs and noise are evaluated along s
 * (uv.x, world units), and the one place their phase jumps is where the
 * loop closes. From there it runs -X along the return run, up round the
 * tail drum (left), +X along the carrying run on top, down round the head
 * drum (right) and back. The top run travels +X: work flows left to right.
 */
import { BELT } from './dims.ts';

export interface LoopGeom {
  /** Distance between the drum axes. */
  span: number;
  /** Radius of the loop's middle round a drum (drum radius + half the belt). */
  r: number;
  /** Height of the drum axes. */
  axisY: number;
  /** Total length of the loop. */
  length: number;
}

/** The loop for a conveyor `length` long overall (the belt's outer ends at ±length/2). */
export function loopGeom(length: number): LoopGeom {
  const r = BELT.drumR + BELT.thickness / 2;
  const span = Math.max(0.5, length - 2 * (r + BELT.thickness / 2));
  const axisY = BELT.topY - BELT.thickness / 2 - r;
  return { span, r, axisY, length: 2 * span + 2 * Math.PI * r };
}

export interface LoopPoint {
  x: number;
  y: number;
  /** Direction of travel, radians about +Z (0 = +X). The outward normal is this plus 90°. */
  angle: number;
}

/** Where the belt's middle is at distance `s` along the loop (any s; wraps). */
export function loopAt(g: LoopGeom, sIn: number): LoopPoint {
  const { span, r, axisY } = g;
  let s = ((sIn % g.length) + g.length) % g.length;
  const half = span / 2;
  const wrap = Math.PI * r;
  // A: return run, x from 0 to -half, travelling -X
  if (s < half) return { x: -s, y: axisY - r, angle: Math.PI };
  s -= half;
  // B: up round the tail drum (left): from the bottom, through the far left, to the top
  if (s < wrap) {
    const th = s / r;
    const a = -Math.PI / 2 - th;
    return { x: -half + Math.cos(a) * r, y: axisY + Math.sin(a) * r, angle: Math.PI - th };
  }
  s -= wrap;
  // C: the carrying run on top, travelling +X
  if (s < span) return { x: -half + s, y: axisY + r, angle: 0 };
  s -= span;
  // D: down round the head drum (right)
  if (s < wrap) {
    const th = s / r;
    const a = Math.PI / 2 - th;
    return { x: half + Math.cos(a) * r, y: axisY + Math.sin(a) * r, angle: -th };
  }
  s -= wrap;
  // E: back along the return run to the middle
  return { x: half - s, y: axisY - r, angle: Math.PI };
}

/** The s at which the carrying run (on top) reaches x. */
export function topRunS(g: LoopGeom, x: number): number {
  return g.span / 2 + Math.PI * g.r + (x + g.span / 2);
}

/**
 * The loop's sample points for the sweep: few on the straight runs (the
 * top run every `topStep`, so the cavity bake has vertices near the rails),
 * `wrapSegs` round each drum.
 */
export function loopPoints(g: LoopGeom, topStep: number, wrapSegs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const half = g.span / 2;
  const wrap = Math.PI * g.r;
  const push = (s: number): void => {
    const p = loopAt(g, s);
    out.push([p.x, p.y]);
  };
  // return run (left half): 2 pieces
  push(0);
  push(half / 2);
  for (let i = 0; i < wrapSegs; i++) push(half + (wrap * i) / wrapSegs);
  const nTop = Math.max(2, Math.ceil(g.span / topStep));
  for (let i = 0; i < nTop; i++) push(half + wrap + (g.span * i) / nTop);
  for (let i = 0; i < wrapSegs; i++) push(half + wrap + g.span + (wrap * i) / wrapSegs);
  push(half + 2 * wrap + g.span);
  push(half + 2 * wrap + g.span + half / 2);
  return out;
}
