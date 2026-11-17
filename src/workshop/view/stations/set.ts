/**
 * The static set (REWRITE.md § C, § G P1 "A slice of back wall"): the bench,
 * the back wall, Fetch's lane tape, the sign with its bulbs, the tool wall
 * and its six tools, the lamp's body, the phone on its easel, Patch's stool.
 *
 * Nothing here moves, so it is merged hard: every piece is flattened into
 * world space and merged into one mesh per (material, variant, texture)
 * (REWRITE.md § E3 "the fixed body of each station is merged into as few
 * meshes as its materials allow"; § E7's draw-call budget counts the shadow
 * pass, so every mesh saved here is saved twice).
 *
 * A piece that has not been registered yet is a clay stand-in of its size.
 * The lamp's body places the stage's key light at its bulb socket, and the
 * sign's `wash` socket places the wall wash.
 */
import { Group, Matrix4, Vector3 } from 'three';
import type { SceneDesc } from '../../sim/types.ts';
import type { StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { KitPart, Piece, PieceNode } from '../kit/types.ts';
import { merge, part, piece, place } from '../kit/compose.ts';
import { roundedBox } from '../kit/solids.ts';
import { laneTape } from '../kit/pieces/bench/index.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';

/** Where a piece stands: its origin on the bench (or on the wall at height y), turned by yaw degrees. */
export interface Placed {
  x: number;
  y?: number;
  z: number;
  yaw?: number;
}

const DEG = Math.PI / 180;
const WALL_Z = -5;

export function placedMatrix(at: Placed): Matrix4 {
  return new Matrix4().makeRotationY((at.yaw ?? 0) * DEG).setPosition(at.x, at.y ?? 0, at.z);
}

/**
 * Flatten pieces into world-space parts (node transforms applied, geometry
 * cloned), optionally leaving out named nodes and everything under them.
 */
export function flatten(items: ReadonlyArray<{ piece: Piece; at: Matrix4; skip?: ReadonlySet<string> }>): KitPart[] {
  const out: KitPart[] = [];
  for (const it of items) {
    const walk = (n: PieceNode, parent: Matrix4): void => {
      if (it.skip?.has(n.name)) return;
      const w = n.transform ? parent.clone().multiply(n.transform) : parent;
      if (n.parts.length) out.push(...place(n.parts, w));
      for (const c of n.children ?? []) walk(c, w);
    };
    walk(it.piece.root, it.at);
  }
  return out;
}

/**
 * Static parts other station views hand to the set to be merged with it
 * (the belt's body, the board's cabinet): one pool per vignette. The views
 * that feed it must be constructed before the set.
 */
export interface StaticPool {
  items: Array<{ piece: Piece; at: Matrix4; skip?: ReadonlySet<string> }>;
}

/**
 * Split a piece into what never moves (handed to the pool, placed at `at`)
 * and what does: a copy of the tree keeping only the nodes `moving` matches
 * and their ancestors (the ancestors without their parts), for the view to
 * realize and drive. Node names and transforms are kept, so pose helpers
 * still find everything by name.
 */
export function splitStatic(p: Piece, at: Matrix4, moving: (name: string) => boolean, pool: StaticPool): Piece {
  const skip = new Set<string>();
  const keep = (n: PieceNode): PieceNode | null => {
    if (moving(n.name)) {
      skip.add(n.name);
      return n;
    }
    const kids = (n.children ?? []).map(keep).filter((c): c is PieceNode => c !== null);
    if (!kids.length) return null;
    const out: PieceNode = { name: n.name, parts: [], children: kids };
    if (n.transform) out.transform = n.transform;
    return out;
  };
  pool.items.push({ piece: p, at, skip });
  const root = keep(p.root) ?? { name: p.root.name, parts: [] };
  return { ...p, root };
}

/** One merged piece from flattened parts (no second cavity bake: each piece baked its own). */
export function mergedPiece(name: string, parts: KitPart[]): Piece {
  const b = piece(name, { ao: false });
  b.add(merge(parts));
  return b.build();
}

/** A clay block: a clearly temporary stand-in of a piece's size, resting on y = 0 (centred), good side +Z. */
export function clay(name: string, w: number, h: number, d: number): Piece {
  const b = piece(`stand-in-${name}`, { ao: false });
  b.add(part('paper', roundedBox({ w, h, d, r: Math.min(w, h, d) * 0.12 }), 'paper'));
  // lift so it rests on y = 0
  const p = b.build();
  p.root.transform = new Matrix4().makeTranslation(0, h / 2, 0);
  return p;
}

/** A socket's world matrix for a piece placed at `at`. */
export function socketMatrix(p: Piece, name: string, at: Matrix4): Matrix4 | null {
  const s = p.sockets?.[name];
  return s ? at.clone().multiply(s) : null;
}

export interface SetOptions {
  /** Registry entries by slot (undefined: not registered yet). */
  entries: {
    bench?: Entry | undefined;
    wall?: Entry | undefined;
    sign?: Entry | undefined;
    toolwall?: Entry | undefined;
    lamp?: Entry | undefined;
    phone?: Entry | undefined;
    stool?: Entry | undefined;
  };
  /** The `tool-…` entries. */
  tools: readonly Entry[];
  scene: SceneDesc;
  /** Placements of the set's pieces (from the vignette's layout). */
  at: {
    sign: { x: number; y: number };
    toolwall: { x: number; y: number };
    lamp: Placed;
    phone: Placed;
    stool: Placed;
  };
  seed: number;
  /** Build the lamp's body here (false when a lamp view of its own does). */
  lampBody: boolean;
  /** Static parts other views handed over to be merged with the set (they must be built first). */
  pool?: StaticPool;
  /** Stand-in sizes for pieces that have not landed. */
  standIn: Record<'sign' | 'toolwall' | 'lamp' | 'phone' | 'stool', { w: number; h: number; d: number }>;
}

/** What the set built, for the page's read-out. */
export interface SetInfo {
  triangles: number;
  meshes: number;
  bulb: Vector3 | null;
  wash: Vector3 | null;
}

export function createSetView(o: SetOptions): StationViewFactory & { info?: SetInfo } {
  const factory: StationViewFactory & { info?: SetInfo } = (ctx: ViewContext): StationView => {
    const E = o.entries;
    const build = (e: Entry | undefined, opts: Record<string, unknown> = {}): Piece | null => (e ? buildEntry(e, null, { seed: o.seed, ...opts }, ctx.labels) : null);
    const items: Array<{ piece: Piece; at: Matrix4; skip?: ReadonlySet<string> }> = [];
    const I = new Matrix4();
    const wallStand = (p: Piece, x: number, y: number): Matrix4 => {
      // its back face just off the wall
      const zMin = boundsZMin(p);
      return new Matrix4().makeTranslation(x, y, WALL_Z + 0.012 - zMin);
    };

    // the bench and the wall (registered since W2)
    const bench = build(E.bench);
    if (bench) items.push({ piece: bench, at: I });
    const wall = build(E.wall, { width: 21, height: 6.5 });
    if (wall) items.push({ piece: wall, at: new Matrix4().makeTranslation(0, 0, WALL_Z) });

    // Fetch's lane: a closed rectangle of tape round the runner's lane (it cannot leave it)
    const lane = o.scene.runner.lane;
    const hw = 0.52;
    const x0 = Math.min(lane.a[0], lane.b[0]) - 0.55, x1 = Math.max(lane.a[0], lane.b[0]) + 0.55;
    const zc = (lane.a[1] + lane.b[1]) / 2;
    items.push({
      piece: laneTape({ seed: o.seed + 4, points: [[x0, zc - hw], [x1, zc - hw + 0.015], [x1, zc + hw], [x0, zc + hw - 0.01], [x0, zc - hw]] }),
      at: I,
    });

    // the sign, hung above the board; its wash socket places the wall wash
    let washAt: Vector3 | null = null;
    const sign = build(E.sign);
    if (sign) {
      const m = wallStand(sign, o.at.sign.x, o.at.sign.y);
      items.push({ piece: sign, at: m });
      const w = socketMatrix(sign, 'wash', m);
      if (w) washAt = new Vector3().setFromMatrixPosition(w);
    } else {
      const s = o.standIn.sign;
      const p = clay('sign', s.w, s.h, s.d);
      items.push({ piece: p, at: wallStand(p, o.at.sign.x, o.at.sign.y) });
    }

    // the tool wall, its tools hung on their pegs
    const tw = build(E.toolwall);
    if (tw) {
      const m = wallStand(tw, o.at.toolwall.x, o.at.toolwall.y);
      items.push({ piece: tw, at: m });
      // the tool wall carries its six tools (each also registered alone as `tool-…`, for when they come loose)
    } else {
      const s = o.standIn.toolwall;
      const p = clay('toolwall', s.w, s.h, s.d);
      items.push({ piece: p, at: wallStand(p, o.at.toolwall.x, o.at.toolwall.y) });
    }

    // the lamp's body; the key light sits at its bulb
    let bulbAt: Vector3 | null = null;
    if (o.lampBody) {
      const lamp = build(E.lamp);
      const m = placedMatrix(o.at.lamp);
      if (lamp) {
        items.push({ piece: lamp, at: m });
        const b = socketMatrix(lamp, 'bulb', m);
        if (b) bulbAt = new Vector3().setFromMatrixPosition(b);
      } else {
        const s = o.standIn.lamp;
        items.push({ piece: clay('lamp', s.w, s.h, s.d), at: m });
      }
    }

    // the phone on its easel, the stool
    const phone = build(E.phone);
    const stool = build(E.stool);
    const ph = o.standIn.phone, st = o.standIn.stool;
    items.push({ piece: phone ?? clay('phone', ph.w, ph.h, ph.d), at: placedMatrix(o.at.phone) });
    items.push({ piece: stool ?? clay('stool', st.w, st.h, st.d), at: placedMatrix(o.at.stool) });

    if (o.pool) items.push(...o.pool.items);
    const merged = mergedPiece('set', flatten(items));
    const root = new Group();
    root.name = 'set';
    const obj = ctx.realize(merged);
    root.add(obj);
    ctx.scene.add(root);
    let meshes = 0;
    obj.traverse((m) => {
      if ((m as { isMesh?: boolean }).isMesh) meshes++;
    });

    const lights = ctx.stage.lights;
    if (bulbAt) {
      const t = lights.key.target.position;
      lights.setBulb([bulbAt.x, bulbAt.y, bulbAt.z], [t.x, t.y, t.z]);
    }
    if (washAt && lights.wash) lights.wash.position.copy(washAt);
    factory.info = { triangles: merged.triangles, meshes, bulb: bulbAt, wash: washAt };

    return {
      root,
      update() {},
      dispose() {
        root.removeFromParent();
      },
    };
  };
  return factory;
}

/** The lowest z of a piece's parts at rest (its back face). */
function boundsZMin(p: Piece): number {
  let z = Infinity;
  const walk = (n: PieceNode, m: Matrix4): void => {
    const w = n.transform ? m.clone().multiply(n.transform) : m;
    for (const q of n.parts) {
      q.geometry.computeBoundingBox();
      const bb = q.geometry.boundingBox;
      if (bb && !bb.isEmpty()) z = Math.min(z, bb.clone().applyMatrix4(w).min.z);
    }
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, new Matrix4());
  return Number.isFinite(z) ? z : 0;
}

