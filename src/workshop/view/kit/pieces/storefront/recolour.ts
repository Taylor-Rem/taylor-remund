/**
 * Paint on a realized storefront without a rebuild: the crate's way (vertex
 * colours rewritten in place), keyed by node instead of by vertex range.
 * Every paintable surface sits in a node of its own whose untextured parts
 * are all paint: the four fascia slats, `awning.colour` (the coloured
 * stripes) and `awning.valance.colour`. At build, each such part's
 * per-vertex tone (the seeded jitter round its paint) is remembered; a
 * repaint writes paint × tone, so the new colour keeps the old one's
 * unevenness.
 *
 * `writePaint` takes a function of the vertex's rest position, so a colour
 * can arrive as a wipe (the fascia: left to right, a ragged brush edge) and
 * run backwards for undo. Geometry shared with other realisations of the
 * same Piece is copied for this object first, so its twins never change.
 */
import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';
import type { Piece, PieceNode, Token } from '../../types.ts';
import { linear } from '../../../palette.ts';
import { sourcesOf } from '../../realize.ts';
import { FASCIA, NODES } from './dims.ts';

const TONE = new WeakMap<BufferGeometry, Float32Array>();

/** The fascia's paint nodes, and the awning's. */
export const FASCIA_NODES: readonly string[] = Array.from({ length: FASCIA.slats }, (_, i) => NODES.slat(i));
export const AWNING_NODES: readonly string[] = [NODES.awningColour, NODES.valanceColour];

/** After a build: remember the tone of every paint vertex in `nodes`, painted `base`. */
export function registerPaint(p: Piece, nodes: readonly string[], base: Token): void {
  const want = new Set(nodes);
  const [br, bg, bb] = linear(base);
  const sum = br + bg + bb;
  const walk = (n: PieceNode): void => {
    if (want.has(n.name)) {
      for (const q of n.parts) {
        if (q.texture) continue;
        const col = q.geometry.getAttribute('color');
        const t = new Float32Array(col.count);
        for (let i = 0; i < col.count; i++) t[i] = (col.getX(i) + col.getY(i) + col.getZ(i)) / sum;
        TONE.set(q.geometry, t);
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
}

export type Rgb = readonly [number, number, number];
/** A colour for a vertex at rest position (x, y, z) in the piece's space. */
export type ColourAt = (x: number, y: number, z: number) => Rgb;

/**
 * Write paint into every paint vertex of `nodes` in a realized storefront. Returns the
 * number of vertices written (0: not a storefront, or nothing registered).
 */
export function writePaint(object: Object3D, nodes: readonly string[], at: ColourAt): number {
  const want = new Set(nodes);
  let n = 0;
  object.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if ((m.material as { map?: unknown }).map) return;
    const own = m.userData['storefrontOwn'] as boolean | undefined;
    const sources = sourcesOf(m).filter((s) => want.has(s.node) && TONE.has(s.source));
    if (sources.length === 0) return;
    if (!own) {
      const g = m.geometry.clone();
      g.userData = { ...m.geometry.userData };
      m.geometry = g;
      m.userData['storefrontOwn'] = true;
    }
    const skinned = (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh === true;
    const col = m.geometry.getAttribute('color') as BufferAttribute;
    const pos = m.geometry.getAttribute('position') as BufferAttribute;
    for (const s of sources) {
      const tone = TONE.get(s.source)!;
      // per-node backend: positions are in the node's space; the paint nodes only translate and turn about x, so x stays true
      const node = skinned ? null : (m.parent as Object3D | null);
      for (let k = 0; k < s.count; k++) {
        const i = s.start + k;
        let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (node) {
          x += node.position.x;
          y += node.position.y;
          z += node.position.z;
        }
        const c = at(x, y, z);
        const t = tone[k] ?? 1;
        col.setXYZ(i, c[0] * t, c[1] * t, c[2] * t);
        n++;
      }
    }
    col.needsUpdate = true;
  });
  return n;
}

const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Paint the fascia `paint` at once. */
export function paintFascia(object: Object3D, paint: Token): number {
  const c = linear(paint);
  return writePaint(object, FASCIA_NODES, () => c);
}

/** Paint the awning's coloured stripes `paint` at once. */
export function paintAwning(object: Object3D, paint: Token): number {
  const c = linear(paint);
  return writePaint(object, AWNING_NODES, () => c);
}

/** Where the wipe's edge is (x) for progress t: off the left end at 0, off the right end at 1. */
export function wipeEdge(t: number): number {
  const reach = FASCIA.hw + WIPE_SOFT * 2 + 0.06;
  return -reach + 2 * reach * Math.max(0, Math.min(1, t));
}
/** The wipe's soft edge (a brush's width of wet paint). */
export const WIPE_SOFT = 0.07;

/**
 * The fascia part-way through a repaint from `from` to `to`: everything left of the
 * brush is new paint, a ragged soft edge, the old paint to the right. t = 0 is all
 * `from`, t = 1 all `to`; run t backwards for undo (or swap the colours).
 */
export function wipeFascia(object: Object3D, from: Token, to: Token, t: number): number {
  const a = linear(from), b = linear(to);
  const e = wipeEdge(t);
  return writePaint(object, FASCIA_NODES, (x, y) => {
    // a brush's ragged leading edge: the bristles drag further on some strokes than others
    const rag = 0.025 * Math.sin(y * 47.0) + 0.015 * Math.sin(y * 113.0 + 1.3);
    const w = Math.max(0, Math.min(1, (e + rag - x) / WIPE_SOFT + 0.5));
    return lerp3(a, b, w);
  });
}
