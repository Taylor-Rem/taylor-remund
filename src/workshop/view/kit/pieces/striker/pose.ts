/**
 * The striker's mechanism as numbers, and poseStriker: set its moving nodes.
 * Pure transform setting; no simulation logic, no easing (the view drives
 * it: turn the cam, let the arm ride the follower, drop it on the part).
 *
 * How it works (so a view can drive it honestly): a brass snail cam turns in
 * the housing on the post's front. A follower rod rides its edge and lifts
 * the arm from underneath, just ahead of the pivot. The cam's slow spiral
 * raises the arm (the overhead spring loads); at the cam's step the rod
 * drops away and the spring throws the hammer down onto whatever is under it
 * (or onto the stop: the cam's base circle, just below an S crate's top).
 * The arm parks with the cam part-way up its spiral (`rest`), high enough
 * that an L crate on the belt passes under the felt.
 *
 * Nodes (each pivot at its node's origin; hinges and wheels turn about the
 * node's local +Y, sliders travel along its local +X, as kit/types.ts asks):
 *  - `arm`       the arm and hammer, about the pivot pin (local +Y is world +X).
 *  - `cam`       the snail cam, about its shaft (local +Y is world +Z).
 *  - `follower`  the rod and its roller, sliding up and down (local +X is world +Y).
 *  - `spring`    the overhead spring, from its boss to the arm's cup: aimed and
 *                stretched along its local +X to follow the arm.
 *  - `lamp.lit` / `lamp.unlit` (under `lamp`): the station lamp.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';

const DEG = Math.PI / 180;

/** The mechanism's fixed numbers (root space, world units; +Z is toward the belt and the visitor). */
export const STRIKER = {
  /** The pivot pin's centre. */
  pivot: [0, 1.45, 0] as const,
  /**
   * The mechanism stands turned this many degrees about +Y (its arm reaches forward and to the left), so
   * the arm is seen as an arm from the front camera instead of end-on, and the hammer stands clear of the
   * cam housing. Everything below is in the mechanism's own frame (before the turn) unless it says root.
   */
  yawDeg: 22,
  /** Pivot to the hammer's axis, along the arm (its reach across the bench is 0.92: the belt's centre line). */
  reach: 0.99,
  /** The felt's face below the arm's centreline (along the hammer's axis). */
  feltDrop: 0.15,
  /** Half the arm's depth (its underside is this far below the centreline). */
  armHalf: 0.03,
  /** Where the follower rod meets the lifter's underside, along it from the pivot shaft. The lifter is a short
   * second arm on the same shaft, out over the cam beside the post (so the hammer never hides the cam). */
  tappet: 0.15,
  /** The cam's shaft centre (root space) and its base and peak radii. */
  cam: [0.4, 1.0, 0.15] as const,
  baseR: 0.075,
  peakR: 0.2,
  /** The follower's roller radius. */
  rollerR: 0.026,
  /** Fraction of a turn the spiral rises over, and how long the step takes. */
  rise: 0.84,
  step: 0.035,
  /** The spring's seat on the arm (along it from the pivot) and its boss above (root space). */
  springAt: 0.31,
  boss: [0, 1.9, 0.31] as const,
  /** The belt's carrying surface under the hammer, for the strike heights. */
  beltTop: 0.5,
  /** The felt's height at rest (above an L crate's top, 1.3, with room). */
  restFelt: 1.43,
} as const;

/** Crate heights (art-direction § 2). */
export const PART_HEIGHT = { S: 0.45, M: 0.6, L: 0.8 } as const;
export type PartSize = keyof typeof PART_HEIGHT;

/** Scale of a hidden twin (a lamp's unlit or lit body). */
export const HIDDEN = 1e-4;

/** The cam's radius at the top (under the follower) after `turns` turns. 0 is the start of the spiral. */
export function camRadius(turns: number): number {
  const u = ((turns % 1) + 1) % 1;
  const { baseR: rb, peakR: rp, rise, step } = STRIKER;
  if (u < rise) {
    const t = u / rise;
    return rb + (rp - rb) * (t * (2 - t) * 0.35 + t * 0.65); // a little faster at first: the arm lifts at once
  }
  if (u < rise + step) return rp - ((rp - rb) * (u - rise)) / step;
  return rb;
}

/** The follower rod's top (root y) for a cam at `turns`. */
export function rodTop(turns: number): number {
  return STRIKER.cam[1] + camRadius(turns) + STRIKER.rollerR + rodLength();
}

/** Height of the arm's underside over the tappet, for an arm `deg` above horizontal. */
function tappetY(deg: number): number {
  const a = deg * DEG;
  return STRIKER.pivot[1] + STRIKER.tappet * Math.tan(a) - STRIKER.armHalf / Math.cos(a);
}

/** The felt's lowest point (root y) for an arm `deg` above horizontal. */
export function feltY(deg: number): number {
  const a = deg * DEG;
  return STRIKER.pivot[1] + STRIKER.reach * Math.sin(a) - STRIKER.feltDrop * Math.cos(a);
}

function solve(f: (deg: number) => number, target: number): number {
  let lo = -60, hi = 60;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** The arm's angle (degrees above horizontal) with its felt on a part of height `h` standing on the belt. */
export function strikeDeg(h: number): number {
  return solve(feltY, STRIKER.beltTop + h);
}

/** The stop: where the arm lands with nothing under it (the felt a hair below an S crate's top). */
export function stopDeg(): number {
  return strikeDeg(PART_HEIGHT.S - 0.02);
}

/** The follower rod's length: at the cam's base circle it holds the arm at the stop. */
export function rodLength(): number {
  return tappetY(stopDeg()) - (STRIKER.cam[1] + STRIKER.baseR + STRIKER.rollerR);
}

/** The arm's angle riding the follower, for a cam at `turns`. */
export function armOnCam(turns: number): number {
  return solve(tappetY, rodTop(turns));
}

/** The cam's turn (within the spiral) at which the riding arm's felt stands at `felt`. */
function turnsForFelt(felt: number): number {
  let lo = 0, hi: number = STRIKER.rise;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (feltY(armOnCam(m)) < felt) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Where the cam parks between strikes, and the arm's angle there. */
export const REST = (() => {
  const turns = turnsForFelt(STRIKER.restFelt);
  return { turns, deg: armOnCam(turns) };
})();

/** The cam at the top of its spiral (cocked), and the arm's angle there. */
export const COCKED = (() => {
  const turns = STRIKER.rise - 0.005;
  return { turns, deg: armOnCam(turns) };
})();

export interface StrikerPose {
  /** The arm's angle in degrees above horizontal (default: riding the cam). */
  arm?: number;
  /** The cam's turns (default REST.turns). The follower rides it. */
  cam?: number;
  /** The station lamp lit. */
  lamp?: boolean;
}

/** The cam's turn just after its step (the hammer has been let go). */
export const DROPPED = STRIKER.rise + STRIKER.step + 0.02;

/** Named poses for the catalogue (`?pose=`): what the view will show. */
export const NAMED_POSES: Readonly<Record<string, StrikerPose>> = {
  rest: {},
  lit: { lamp: true },
  cocked: { cam: COCKED.turns, lamp: true },
  'struck-S': { cam: DROPPED, arm: strikeDeg(PART_HEIGHT.S), lamp: true },
  'struck-M': { cam: DROPPED, arm: strikeDeg(PART_HEIGHT.M), lamp: true },
  'struck-L': { cam: DROPPED, arm: strikeDeg(PART_HEIGHT.L), lamp: true },
  stop: { cam: DROPPED, lamp: true },
  'lift-1': { cam: 0.15, lamp: true },
  'lift-2': { cam: 0.4, lamp: true },
};

/** Where the spring's lower end sits (mechanism frame) with the arm at `deg`. */
export function springSeat(deg: number): Vector3 {
  const a = deg * DEG;
  const [px, py, pz] = STRIKER.pivot;
  const top = STRIKER.armHalf + 0.012; // the cup's floor
  // the point (0, top, springAt) in the arm's frame, turned up by a about +X
  return new Vector3(px, py + top * Math.cos(a) + STRIKER.springAt * Math.sin(a), pz - top * Math.sin(a) + STRIKER.springAt * Math.cos(a));
}

/** The spring node's transform (mechanism frame): at the boss, its local +X down to the seat, stretched to reach it. */
export function springMatrix(deg: number, restLen: number): Matrix4 {
  const b = new Vector3(...STRIKER.boss);
  const d = springSeat(deg).sub(b);
  const len = d.length();
  const e1 = d.normalize();
  const e3 = new Vector3(1, 0, 0);
  const e2 = new Vector3().crossVectors(e3, e1);
  return new Matrix4().makeTranslation(b.x, b.y, b.z).multiply(new Matrix4().makeBasis(e1, e2, e3)).multiply(new Matrix4().makeScale(len / restLen, 1, 1));
}

/** The spring's length at rest (as built). */
export function springRestLength(): number {
  return springSeat(REST.deg).distanceTo(new Vector3(...STRIKER.boss));
}

function targets(pose: StrikerPose, rest: (name: string) => Matrix4 | null): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const cam = pose.cam ?? REST.turns;
  const deg = pose.arm ?? armOnCam(cam);
  const arm = rest('arm');
  // local +Y is world +X; turning the tip up is a negative turn about +X
  if (arm) out.set('arm', arm.clone().multiply(new Matrix4().makeRotationY(-(deg - REST.deg) * DEG)));
  const c = rest('cam');
  // the cam turns clockwise seen from the front, so the spiral climbs under the follower
  if (c) out.set('cam', c.clone().multiply(new Matrix4().makeRotationY(-(cam - REST.turns) * Math.PI * 2)));
  const f = rest('follower');
  if (f) out.set('follower', f.clone().multiply(new Matrix4().makeTranslation(camRadius(cam) - camRadius(REST.turns), 0, 0)));
  if (rest('spring')) out.set('spring', springMatrix(deg, springRestLength()));
  const on = pose.lamp ?? false;
  const k = (show: boolean): Matrix4 => (show ? new Matrix4() : new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN));
  if (rest('lamp.lit')) out.set('lamp.lit', k(on));
  if (rest('lamp.unlit')) out.set('lamp.unlit', k(!on));
  return out;
}

const MOVING = ['arm', 'cam', 'follower', 'spring', 'lamp.lit', 'lamp.unlit'] as const;

/** Pose a realized striker (the Object3D `realize` made, or any ancestor of it). Moves only the nodes listed above. */
export function poseStriker(root: Object3D, pose: StrikerPose): void {
  const objs = new Map<string, Object3D>();
  for (const n of MOVING) {
    const o = root.getObjectByName(n);
    if (o) objs.set(n, o);
  }
  const t = targets(pose, (n) => {
    const o = objs.get(n);
    if (!o) return null;
    const u = o.userData as { strikerRest?: Matrix4 };
    u.strikerRest ??= new Matrix4().compose(o.position, o.quaternion, o.scale);
    return u.strikerRest;
  });
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  for (const [n, m] of t) {
    const o = objs.get(n)!;
    m.decompose(p, q, s);
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
}

/** The same pose applied to a freshly built Piece description (call once; the cavity bake stays at rest). */
export function posePiece(root: PieceNode, pose: StrikerPose): void {
  const nodes = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    nodes.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  const t = targets(pose, (n) => {
    const node = nodes.get(n);
    return node ? (node.transform ?? new Matrix4()) : null;
  });
  for (const [n, m] of t) nodes.get(n)!.transform = m;
}
