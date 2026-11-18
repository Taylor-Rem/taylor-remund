/**
 * What a bench station file is, and what it is handed (brief A1 job 2).
 *
 * Every file in `view/bench/stations/` exports `station: BenchStation`.
 * `loadBench` (view/bench.ts) finds them all with `import.meta.glob`, the
 * way `kit/pieces/registry.ts` finds pieces, sorts them by `order`, and
 * calls each one's `make` with the same `BenchKit`. Nobody edits a shared
 * list to add, replace or remove a station: they add, replace or remove a
 * file. How to write one is in the note at the top of `view/bench.ts`.
 */
import { Box3, Group, Matrix4 } from 'three';
import type { SceneDesc, WorldView } from '../../sim/types.ts';
import type { Labels, StationViewFactory } from '../types.ts';
import type { KitPart, Piece, PieceNode } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import type { StaticPool } from '../stations/set.ts';
import type { Vec3 } from '../../sim/types.ts';

/**
 * When a station's view is made and updated, lowest first. Views that hand
 * their fixed body to the set's pool must come before the set; Fetch after
 * the parts (it re-seats the crate in its hands); the overlays last.
 */
export const ORDER = {
  /** Feeds the set's pool: static pieces, and the fixed bodies of moving ones. */
  pool: 10,
  /** The merged static set (it empties the pool). */
  set: 50,
  /** Loose parts. */
  parts: 60,
  /** The crew and the handles that read the parts. */
  crew: 70,
  /** Last: what draws over the rest (the lamp's light, the cue card). */
  late: 90,
} as const;

/** Everything a station file is handed. One per bench; the same object for every station. */
export interface BenchKit {
  /** The scene the world boots from (`sim/scenes/bench.ts`). */
  readonly scene: SceneDesc;
  readonly seed: number;
  /** The crew's drawing scale (view/bench.ts CREW_SCALE, or the page's `?crew=`). */
  readonly crewScale: number;
  /** The room round the bench is drawn (`?room=0`: not). */
  readonly room: boolean;
  /** The switchboard, stool, phone and belt as fitted to the scene's bodies (jacks, seat, cord root). */
  readonly fit: Fit;
  /** Static pieces handed here (from a view factory, before the set's) are merged into one mesh per material. */
  readonly pool: StaticPool;
  /** The key light: the lamp's bulb and aim, from the real lamp at its spot. */
  readonly bulb: { at: Vec3; aim: Vec3 } | null;
  /** A registered piece by catalogue name (undefined: not registered). */
  entry(name: string): Entry | undefined;
  /** Every registered catalogue entry. */
  readonly entries: readonly Entry[];
  /** A piece folder's module (`kit/pieces/<folder>/index.ts`), for its pose helpers and constants. */
  module(folder: string): Promise<Record<string, unknown> | null>;
  /** The world as of the last frame (null before the first). */
  world(): WorldView | null;
}

export interface BenchStation {
  /** A name for logs and the page's read-out (usually its LAYOUT key). */
  readonly name: string;
  /** When its view is made and updated (ORDER). Ties: by file name. */
  readonly order: number;
  /** Its view(s); null when it draws nothing on this bench (a stand-in replaced, a piece not registered). */
  make(k: BenchKit): StationViewFactory | readonly StationViewFactory[] | null | Promise<StationViewFactory | readonly StationViewFactory[] | null>;
}

export type PoolItem = { piece: Piece; at: Matrix4; skip?: ReadonlySet<string> };

/**
 * A static station: a view that only hands pieces to the set's pool (they are merged with the set and
 * never move). `items` runs when the views are made, with the labels: build pieces with `build`.
 */
export function staticStation(k: BenchKit, items: (build: (name: string, opts?: Record<string, unknown>) => Piece | null, labels: Labels) => PoolItem[]): StationViewFactory {
  return (ctx) => {
    const build = (name: string, opts: Record<string, unknown> = {}): Piece | null => {
      const e = k.entry(name);
      return e ? buildEntry(e, null, { seed: k.seed, ...opts }, ctx.labels) : null;
    };
    k.pool.items.push(...items(build, ctx.labels));
    return { root: new Group(), update() {}, dispose() {} };
  };
}

/**
 * The piece with every part that lies wholly below `y` (world, placed at `at`) left out of the shadow
 * pass: under the bench top nothing the key light reaches needs a shadow from it (the frame, the legs,
 * the floor, a riser in the dark). `y` Infinity: nothing of it casts. A new tree; the piece is not changed.
 */
export function castAbove(p: Piece, at: Matrix4, y = 0.001): Piece {
  const box = new Box3();
  const walk = (n: PieceNode, parent: Matrix4): PieceNode => {
    const w = n.transform ? parent.clone().multiply(n.transform) : parent;
    const parts = n.parts.map((q): KitPart => {
      q.geometry.computeBoundingBox();
      const below = !q.geometry.boundingBox || box.copy(q.geometry.boundingBox).applyMatrix4(w).max.y < y;
      return below ? { ...q, castShadow: false } : q;
    });
    const out: PieceNode = { ...n, parts };
    if (n.children) out.children = n.children.map((c) => walk(c, w));
    return out;
  };
  return { ...p, root: walk(p.root, at) };
}

/** A translation, and a translation with a uniform scale. */
export const at = (x = 0, y = 0, z = 0): Matrix4 => new Matrix4().makeTranslation(x, y, z);
export const scaledAt = (x: number, z: number, s: number): Matrix4 => at(x, 0, z).multiply(new Matrix4().makeScale(s, s, s));
