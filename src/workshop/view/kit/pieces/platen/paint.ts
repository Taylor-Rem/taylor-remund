/**
 * The platen's paint: the column in the sight tube and the stream out of the
 * nozzle wear the colour about to be used, any of the eight paints. Like the
 * crate's repaint, `setPaint` rewrites only vertex colours (no rebuild, no new
 * material): the paint lives in its own nodes (`sight.paint`, `nozzle.paint`),
 * so every vertex bound to those nodes is paint, on either realize backend.
 */
import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';
import { linear, type Token } from '../../../palette.ts';
import type { Piece, PieceNode } from '../../types.ts';
import { sourcesOf } from '../../realize.ts';

/** The nodes whose parts are all paint. */
export const PAINT_NODES: ReadonlySet<string> = new Set(['sight.paint', 'nozzle.paint']);

/** The token paint parts are tinted with when built; a part's tone is its colour over this. */
export const PAINT_BASE: Token = 'paper';

/** Per paint geometry (the Piece's part geometry): each vertex's tone (its colour over the base token). */
const TONE = new WeakMap<BufferGeometry, Float32Array>();

/** After the build: remember the tone of every paint part. */
export function registerPaint(p: Piece): void {
  const base = linear(PAINT_BASE);
  const walk = (n: PieceNode): void => {
    if (PAINT_NODES.has(n.name)) {
      for (const q of n.parts) {
        // wet paint is never grimy: no baked cavity (the tube's guard and the tank would darken it to mud)
        const sf = q.geometry.getAttribute('surf');
        for (let i = 0; i < sf.count; i++) sf.setY(i, 0);
        sf.needsUpdate = true;
        const col = q.geometry.getAttribute('color').array as Float32Array;
        const tone = new Float32Array(col.length / 3);
        for (let i = 0; i < tone.length; i++) tone[i] = (col[i * 3]! / base[0] + col[i * 3 + 1]! / base[1] + col[i * 3 + 2]! / base[2]) / 3;
        TONE.set(q.geometry, tone);
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
}

/** Write `paint` into g's vertices from `at` on, using a part's tone. Returns the vertices written. */
function write(g: BufferGeometry, tone: Float32Array, paint: Token, at = 0): number {
  const col = g.getAttribute('color') as BufferAttribute;
  const a = col.array as Float32Array;
  const c = linear(paint);
  for (let i = 0; i < tone.length; i++) {
    const t = tone[i]!;
    a[(at + i) * 3] = c[0] * t;
    a[(at + i) * 3 + 1] = c[1] * t;
    a[(at + i) * 3 + 2] = c[2] * t;
  }
  col.needsUpdate = true;
  return tone.length;
}

/** Paint a built Piece (before it is realized). */
export function paintPiece(p: Piece, paint: Token): number {
  let n = 0;
  const walk = (node: PieceNode): void => {
    for (const q of node.parts) {
      const tone = TONE.get(q.geometry);
      if (tone) n += write(q.geometry, tone, paint);
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(p.root);
  return n;
}

/**
 * Show `paint` in a realized platen's sight tube and stream. Geometry shared
 * with other realizations is cloned for this object first, so its twins do
 * not change. Returns how many vertices it wrote (0: not a platen).
 */
export function setPaint(object: Object3D, paint: Token): number {
  let n = 0;
  object.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const own = m.userData['platenOwnPaint'] as ReturnType<typeof sourcesOf> | undefined;
    const sources = own ?? sourcesOf(m).filter((s) => TONE.has(s.source));
    if (sources.length === 0) return;
    if (!own) {
      const g = m.geometry.clone();
      g.userData = { ...m.geometry.userData };
      m.geometry = g;
      m.userData['platenOwnPaint'] = sources;
    }
    for (const s of sources) {
      const tone = TONE.get(s.source);
      if (tone && tone.length === s.count) n += write(m.geometry, tone, paint, s.start);
    }
  });
  return n;
}
