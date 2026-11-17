/**
 * The parts kit contract (REWRITE.md § E3). Every mesh in the world comes
 * from a kit function; nothing is built from raw primitives at the point of
 * use. A kit function returns a *description* (a Piece): geometry grouped
 * by material class, in a small tree of named nodes for the bits that move.
 * `realize()` (kit/realize.ts) is the one place that turns a Piece into
 * Three.js objects. If G1 decides some geometry should be modelled instead,
 * a kit function may return a loaded model behind this same interface.
 *
 * Conventions (fixed): 1 unit = Fetch's body height. +Y up, +X to the
 * visitor's right, +Z toward the visitor. A piece is built resting on y = 0
 * at its own origin with its good side facing +Z.
 */
import type { BufferGeometry, Matrix4 } from 'three';
import type { Token } from '../palette.ts';

/**
 * What a surface is made of. One shared material per class; hue comes from
 * per-vertex colour, so many colours share a draw call.
 * The first five are the five materials of § A. The rest exist because the
 * world needs them; none may introduce a colour that is not a palette token.
 */
export type MaterialClass =
  | 'steel' // painted steel / enamel: the hero material, chips at worn edges
  | 'brass'
  | 'wood'
  | 'rubber'
  | 'paper'
  | 'metal' // bare steel: rollers, rails, tool heads, chipped-through areas
  | 'glass' // dark glossy lens glass
  | 'bulb' // emissive: bulbs and indicator lamps, the only things that glow
  | 'felt' // Patch: soft, fuzzy rim
  | 'tape' // glossy plastic label tape and lane tape
  | 'belt'; // the conveyor surface (its texture scrolls)

/**
 * Vertex attributes every kit geometry carries:
 *  - position, normal  (normals already finished: weighted/creased as the piece needs)
 *  - color   vec3, LINEAR rgb of a palette token (use `tint`), may be jittered per plank/panel
 *  - surf    vec2: x = wear   0..1  how exposed/convex (edges, corners, raised rims)
 *                  y = cavity 0..1  how enclosed/concave (creases, recesses, under overhangs)
 *  - uv      vec2, optional. For wood, u runs along the grain. For textured
 *            quads (labels, cards, plates) the usual 0..1.
 * Geometry is indexed or not as the builder prefers; `merge` must accept both.
 */
export const ATTR = { color: 'color', surf: 'surf' } as const;

/** A lump of one material. */
export interface KitPart {
  material: MaterialClass;
  geometry: BufferGeometry;
  /** For textured parts (label tape, cards, stencils, plates): key of a texture made by view/labels. */
  texture?: string;
}

/** A rigid node. Its parts move together; children move relative to it. */
export interface PieceNode {
  name: string;
  /** Local transform relative to the parent node. Identity when omitted. */
  transform?: Matrix4;
  parts: KitPart[];
  children?: PieceNode[];
}

/** What a kit function returns. */
export interface Piece {
  /** Kit name, e.g. 'crate', 'button', 'fetch'. Used by the catalogue page and tests. */
  name: string;
  root: PieceNode;
  /** Axis-aligned size of the piece at rest, for layout and for the physics collider. */
  size: { x: number; y: number; z: number };
  /** Named attachment points in the root's space (e.g. where a label goes, where a hand grips). */
  sockets?: Record<string, Matrix4>;
  /** Triangle count, filled by the kit so budgets can be checked without a renderer. */
  triangles: number;
}

/** Options every kit function accepts. */
export interface KitOptions {
  /** Seed for this instance's imperfections (askew angle, chips, plank tones). Same seed, same piece. */
  seed?: number;
  /** Detail level. 'high' is the default; 'low' halves bevel segments and drops the smallest parts. */
  detail?: 'high' | 'low';
}

export type { Token };
