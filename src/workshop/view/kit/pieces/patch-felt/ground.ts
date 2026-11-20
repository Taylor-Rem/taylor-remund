/**
 * Patch on the floor (R4, Taylor: "I've noticed Patch often clips through the floor"): the lowest point of the posed
 * figure, from the rig, and a pose lifted by exactly what it needs so that nothing drawn goes below the floor. The
 * landing's roll turns the figure about its middle, which the simulation keeps 0.3 above the bench: the head, the
 * tail and the back sweep below it unless the figure is lifted for that frame.
 *
 * The figure is each node's own parts (their vertices, thinned) carried by the node's posed matrix: the felt is
 * skinned, but each part is bound rigidly to its node, so this is what is drawn to within the blend at the joints.
 */
import { Matrix4 } from 'three';
import type { Piece, PieceNode } from '../../types.ts';
import { poseMatrices, SCRUFF, type PatchPose } from './rig.ts';

interface FigureNode {
  /** The names from the piece's root down to this node, and each one's rest transform (used when the pose leaves it). */
  readonly path: readonly { name: string; rest: Matrix4 | null }[];
  /** Points of its own parts in its frame (x, y, z, ...). */
  readonly pts: Float32Array;
}

export interface Figure {
  readonly nodes: readonly FigureNode[];
}

/** The figure of a built Patch, at most `perNode` points to a node (the lowest of each part are always kept). */
export function figureOf(piece: Piece, perNode = 240): Figure {
  const nodes: FigureNode[] = [];
  const walk = (n: PieceNode, path: { name: string; rest: Matrix4 | null }[]): void => {
    const here = [...path, { name: n.name, rest: n.transform ?? null }];
    const all: number[] = [];
    for (const part of n.parts) {
      const pos = part.geometry.getAttribute('position');
      if (!pos) continue;
      const step = Math.max(1, Math.floor(pos.count / perNode));
      for (let i = 0; i < pos.count; i += step) all.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      // (and the extremes of the part along each axis, whatever the thinning skipped)
      for (let a = 0; a < 3; a++) {
        let lo = 0, hi = 0;
        for (let i = 1; i < pos.count; i++) {
          if (pos.getComponent(i, a) < pos.getComponent(lo, a)) lo = i;
          if (pos.getComponent(i, a) > pos.getComponent(hi, a)) hi = i;
        }
        for (const i of [lo, hi]) all.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    if (all.length > 0) nodes.push({ path: here, pts: new Float32Array(all) });
    for (const c of n.children ?? []) walk(c, here);
  };
  walk(piece.root, []);
  return { nodes };
}

const m = new Matrix4();

/**
 * The lowest point of the posed figure, in root space (the frame the pose's `body.at` is in). With `inside`, only
 * the points over the floor count (root-space x, z): over the edge, hanging below the top is no fault.
 */
export function lowestY(pose: PatchPose, fig: Figure, inside?: (x: number, z: number) => boolean): number {
  const ms = poseMatrices(pose);
  let low = Infinity;
  for (const n of fig.nodes) {
    m.identity();
    for (const s of n.path) {
      const x = ms[s.name] ?? s.rest;
      if (x) m.multiply(x);
    }
    const e = m.elements;
    // (a prop collapsed to nothing while it is put away, the folder: not drawn)
    if (e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]! < 1e-4) continue;
    const p = n.pts;
    for (let i = 0; i < p.length; i += 3) {
      const px = p[i]!, py = p[i + 1]!, pz = p[i + 2]!;
      const y = e[1]! * px + e[5]! * py + e[9]! * pz + e[13]!;
      if (y >= low) continue;
      if (inside && !inside(e[0]! * px + e[4]! * py + e[8]! * pz + e[12]!, e[2]! * px + e[6]! * py + e[10]! * pz + e[14]!)) continue;
      low = y;
    }
  }
  return low;
}

/**
 * The pose lifted so that its lowest point is at or above `floor` (root space): by exactly the shortfall, never
 * lowered. A pose with no `body.at` is lifted from where its pivot sits at rest.
 */
export function grounded(pose: PatchPose, fig: Figure, floor: number, inside?: (x: number, z: number) => boolean): PatchPose {
  const low = lowestY(pose, fig, inside);
  if (!(low < floor)) return pose;
  const lift = floor - low;
  const b = pose.body ?? {};
  const at = b.at ?? (b.pivot === 'scruff' ? SCRUFF : ([0, 0, 0] as const));
  return { ...pose, body: { ...b, at: [at[0], at[1] + lift, at[2]] } };
}

/**
 * Hanging from an edge: the pose moved out along `out` (root space, level, unit) by the least that leaves no drawn
 * point both over the bench (`inside`) and below its top. Its back against the bench's front, not through it.
 */
export function clearOfEdge(pose: PatchPose, fig: Figure, floor: number, inside: (x: number, z: number) => boolean, out: readonly [number, number]): PatchPose {
  const b = pose.body ?? {};
  const at = b.at ?? (b.pivot === 'scruff' ? SCRUFF : ([0, 0, 0] as const));
  const moved = (s: number): PatchPose => ({ ...pose, body: { ...b, at: [at[0] + out[0] * s, at[1], at[2] + out[1] * s] } });
  if (!(lowestY(pose, fig, inside) < floor)) return pose;
  let lo = 0, hi = 0.05;
  while (hi < 1 && lowestY(moved(hi), fig, inside) < floor) hi *= 2;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (lowestY(moved(mid), fig, inside) < floor) lo = mid;
    else hi = mid;
  }
  return moved(hi);
}
