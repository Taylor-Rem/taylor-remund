/**
 * Revert's hatch and lift (ART-P2 § 2 "Revert comes up through a hatch in
 * the bench top", § 5 REVERT). Registry name `revert-hatch`.
 *
 * Two plank leaf doors, a little proud of the bench top, on long brass strap
 * hinges at their outer edges, with a brass ring pull each where they meet;
 * round them a steel frame painted `tape-yellow` and worn through to the
 * metal; under them a dark shaft and a steel lift platform with hazard-striped
 * edges on a ram. Shut, it reads as a trapdoor: proud, gapped, hinged.
 *
 * Local frame: the opening's centre on the bench top (y = 0), doors hinged
 * along Z at x = ±W/2, the good side up and toward +Z. The bench needs a hole
 * of OPENING.w × OPENING.d (plus nothing: the frame overlaps the cut) under it
 * for the shaft to be seen; until it has one the catalogue's `in bench`
 * variant stands a ring of planks round it for review.
 *
 * Moving nodes (pivots at the node origins; see `poseHatch`):
 *  - `doorL`, `doorR`: the leaves. Pivot on the hinge line; the hinge axis is
 *    each node's local +Y (the kit's convention), which runs along world Z.
 *  - `lift`: the platform and its ram. Slides along Y; Revert stands on it.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { NodeBuilder } from '../../compose.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe } from '../../solids.ts';
import { bevelBox, innerBox, stripes } from '../../cheap.ts';
import { deform, transform } from '../../deform.ts';
import { domeRivet, hexBolt } from '../../details.ts';
import { chain, large, part, piece, place, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { grain, setFinish } from '../../space.ts';

/** The opening (the hole the bench needs), the frame round it, the doors' height when shut, the shaft's depth. */
export const OPENING = { w: 1.84, d: 1.42 } as const;
export const FRAME = { w: 0.1, t: 0.022 } as const;
/** The doors: thickness, the gap between them and to the frame, how proud of the bench their top stands when shut. */
export const DOOR = { t: 0.04, gap: 0.014, top: 0.034 } as const;
/** How far the doors swing (radians): a little past upright, so they rest leaning out. */
export const DOOR_OPEN = 1.98;
/** The lift: depth of its travel below the bench (Revert, about 0.95 tall, fits under the shut doors), and its plate's thickness. */
export const LIFT = { depth: 1.16, plate: 0.05 } as const;

export interface HatchPose {
  /** 0 shut .. 1 open; one number for both, or [left, right]. */
  doors?: number | [number, number];
  /** 0 down in the shaft .. 1 up, its top flush with the bench (a hair over 1 is the stop's overshoot, clamped to 1.03). */
  lift?: number;
}

export const HATCH_POSES = {
  shut: { doors: 0, lift: 0 },
  opening: { doors: [0.55, 0.42], lift: 0 },
  rising: { doors: 1, lift: 0.55 },
  open: { doors: 1, lift: 1 },
} satisfies Record<string, HatchPose>;
export type HatchPoseName = keyof typeof HATCH_POSES;
export const HATCH_POSE_NAMES = Object.keys(HATCH_POSES) as HatchPoseName[];

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const ease = (t: number): number => t * t * (3 - 2 * t);

/** Height of the lift's top surface (where Revert's root goes) for a lift value. */
export function liftHeight(lift: number): number {
  return -LIFT.depth * (1 - clamp(lift, 0, 1.03));
}

/** Every moving node's local transform for a pose. Pure. */
export function hatchMatrices(pose: HatchPose = {}): Record<string, Matrix4> {
  const d = pose.doors ?? 0;
  const [l, r] = typeof d === 'number' ? [d, d] : d;
  const m: Record<string, Matrix4> = {};
  // local +Y is the hinge axis (world Z): a quarter turn about X carries it there
  const toZ = new Matrix4().makeRotationX(Math.PI / 2);
  m.doorL = chain(T(-OPENING.w / 2, DOOR.top - DOOR.t / 2, 0), toZ, new Matrix4().makeRotationY(DOOR_OPEN * ease(clamp(l, 0, 1))));
  m.doorR = chain(T(OPENING.w / 2, DOOR.top - DOOR.t / 2, 0), toZ, new Matrix4().makeRotationY(-DOOR_OPEN * ease(clamp(r, 0, 1))));
  m.lift = T(0, liftHeight(pose.lift ?? 0), 0);
  return m;
}

interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/** Pose a realized hatch: sets the two doors and the lift. */
export function poseHatch(root: Posable, pose: HatchPose = {}): void {
  for (const [name, mat] of Object.entries(hatchMatrices(pose))) {
    const o = root.getObjectByName(name);
    if (o) mat.decompose(o.position, o.quaternion, o.scale);
  }
}

export interface RevertHatchOptions extends KitOptions {
  pose?: HatchPoseName | HatchPose;
  /** Review only: a ring of bench planks round the frame, for a page with no hole in its bench. */
  surround?: boolean;
}

const turn = (p: Parameters<typeof lathe>[0], o: Parameters<typeof lathe>[1] = {}): BufferGeometry => lathe(p, { band: 0, support: false, ...o });

export function revertHatch(o: RevertHatchOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const b = piece('revert-hatch', { detail, seed });
  const rest = hatchMatrices({ doors: 0, lift: 1 });
  buildFrame(b, R, seed);
  buildShaft(b, seed);
  for (const s of [-1, 1] as const) buildDoor(b.node(s < 0 ? 'doorL' : 'doorR', rest[s < 0 ? 'doorL' : 'doorR']), s, R, seed + (s < 0 ? 10 : 40));
  buildLift(b.node('lift', rest.lift), seed);
  if (o.surround) buildSurround(b, R);
  b.socket('stand', new Matrix4());
  const built = b.build();
  // the doors and the lift move away from where they were baked: keep their shading open-air
  capCavity(built.root, new Set(['doorL', 'doorR', 'lift']), 0.25);
  const pose = o.pose === undefined ? HATCH_POSES.shut : typeof o.pose === 'string' ? HATCH_POSES[o.pose] : o.pose;
  const ms = hatchMatrices(pose);
  const walk = (n: PieceNode): void => {
    const mm = ms[n.name];
    if (mm) n.transform = mm.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(built.root);
  return built;
}

function capCavity(n: PieceNode, names: ReadonlySet<string>, cap: number): void {
  if (names.has(n.name)) {
    for (const q of n.parts) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, Math.min(sf.getY(i), cap));
      sf.needsUpdate = true;
    }
  }
  for (const c of n.children ?? []) capCavity(c, names, cap);
}

/** Scale a part's wear (surf.x), clamped to 1. In place. */
function worn<P extends KitPart>(q: P, k: number): P {
  const sf = q.geometry.getAttribute('surf');
  for (let i = 0; i < sf.count; i++) sf.setX(i, Math.min(1, sf.getX(i) * k));
  sf.needsUpdate = true;
  return q;
}

// ---- the frame: steel angle round the hole, painted yellow, worn to the metal ----

function buildFrame(b: NodeBuilder, R: Rng, seed: number): void {
  const { w: W, d: D } = OPENING;
  const fw = FRAME.w, ft = FRAME.t;
  const x0 = W / 2, z0 = D / 2;
  // four bars, mitred by overlap: the long ones run the full width
  const bars: Array<[number, number, number, number]> = [
    [-x0 - fw, x0 + fw, z0, z0 + fw],
    [-x0 - fw, x0 + fw, -z0 - fw, -z0],
    [-x0 - fw, -x0, -z0, z0],
    [x0, x0 + fw, -z0, z0],
  ];
  for (const [i, [xa, xb, za, zb]] of bars.entries()) {
    const g = bevelBox({ min: [xa, -0.004, za], max: [xb, ft, zb], c: 0.007, omit: ['ny'], wear: 0.9 });
    b.add(worn(part('steel', g, 'tape-yellow', { seed: seed + i, shade: 0.82, jitter: 0.05 }), 1.6));
  }
  // ink chevrons on the front bar, where the visitor looks: the stripe that says "something comes up here"
  const polys = stripes(x0 + fw - 0.03, fw / 2 - 0.016, 0.05, 0.14, [Math.SQRT1_2, -Math.SQRT1_2], R.range(0, 0.1));
  for (const poly of polys) {
    const g = extrude(poly, 0.0018, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0.003, segs: 1, caps: 'end', detail: 'low' });
    b.add(worn(part('steel', transform(g, T(0, ft - 0.0006, z0 + fw / 2)), 'ink', { seed: seed + 5, shade: 1.3 }), 2));
  }
  // a bolt at each corner
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const sd = R.int(0, 999);
    b.small(() => place(hexBolt({ af: 0.04, cheap: true, detail: 'low', seed: sd }), chain(T(x * (x0 + fw / 2), ft, z * (z0 + fw / 2)), new Matrix4().makeRotationY(R.range(0, 1)))));
  }
  // the hinges' fixed leaves, screwed to the frame's side bars
  for (const s of [-1, 1]) {
    for (const z of [-D * 0.3, D * 0.3]) {
      b.add(setFinish(part('brass', bevelBox({ min: [s > 0 ? x0 + 0.004 : -x0 - fw + 0.012, ft - 0.002, z - 0.07], max: [s > 0 ? x0 + fw - 0.012 : -x0 - 0.004, ft + 0.008, z + 0.07], c: 0.004, omit: ['ny'] }), 'brass', { seed: seed + 7, shade: 0.9 }), 0.3));
    }
  }
}

// ---- the shaft: a dark well under the doors (seen only through a hole in the bench) ----

function buildShaft(b: NodeBuilder, seed: number): void {
  const { w: W, d: D } = OPENING;
  const well = innerBox([-W / 2, -LIFT.depth - 0.25, -D / 2], [W / 2, -0.004, D / 2]);
  b.add(large(part('wood', grain(well, 'x'), 'teal-deep', { seed: seed + 20, shade: 0.55 })));
  // guide rails down the back corners, so the dark has something in it
  for (const s of [-1, 1]) {
    b.add(part('metal', bevelBox({ min: [s * (W / 2 - 0.06) - 0.025, -LIFT.depth - 0.2, -D / 2 + 0.005], max: [s * (W / 2 - 0.06) + 0.025, -0.02, -D / 2 + 0.05], c: 0.008, omit: ['nz'] }), 'steel', { seed: seed + 21, shade: 0.45 }));
  }
}

// ---- a door: planks along Z on battens, a long brass strap hinge, a ring pull ----

function buildDoor(n: NodeBuilder, s: -1 | 1, R: Rng, seed: number): void {
  const { w: W, d: D } = OPENING;
  const g = DOOR.gap;
  // built in the door's own world-aligned frame (hinge line along Z through the origin, the leaf running
  // inward toward the middle: -s·x), then turned into the node's space, whose local Y is the hinge axis
  const into = new Matrix4().makeRotationX(-Math.PI / 2);
  const lw = W / 2 - g * 1.5;
  const inward = -s;
  const t = DOOR.t;
  const planks = 4;
  const pw = lw / planks;
  const parts: KitPart[] = [];
  for (let i = 0; i < planks; i++) {
    const xa = inward * (g + i * pw), xb = inward * (g + (i + 1) * pw - 0.008);
    const lift = R.spread(0.0025);
    const pg = bevelBox({ min: [Math.min(xa, xb), -t / 2 + lift, -D / 2 + g], max: [Math.max(xa, xb), t / 2 + lift, D / 2 - g], c: 0.008, wear: 0.8 });
    parts.push(part('wood', grain(pg, 'z'), 'wood', { seed: R.int(0, 9999), jitter: 0.1, warm: 0.04, shade: 1.08 }));
  }
  // the straps: long brass hinge straps across the planks, a knuckle on the hinge line, two screws each
  for (const z of [-D * 0.3, D * 0.3]) {
    const L = lw * 0.62;
    const strap = bevelBox({ min: [0, t / 2 - 0.002, z - 0.032], max: [L, t / 2 + 0.008, z + 0.032], c: 0.004, omit: ['ny'] });
    const tapered = deform(strap, (x, y, zz) => [x * inward, y, z + (zz - z) * (1 - 0.45 * (x / L))]);
    parts.push(setFinish(part('brass', tapered, 'brass', { seed: R.int(0, 999), warm: 0.04 }), 0.35));
    const knuckle = turn(profile(0, 0).to(0.018, 0, { fillet: 0.005, segs: 1 }).to(0.018, 0.13, { fillet: 0.005, segs: 1 }).to(0, 0.13), { segs: 7, caps: true });
    parts.push(part('brass', transform(knuckle, chain(T(0, t / 2 + 0.006, z - 0.065), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: R.int(0, 999), shade: 0.9 }));
    for (const f of [0.8]) {
      const sd = R.int(0, 999);
      parts.push(...domeRivet({ d: 0.022, cheap: true, seed: sd }).map((q) => ({ ...q, geometry: transform(q.geometry, T(inward * L * f, t / 2 + 0.008, z)) })));
    }
  }
  // under it, two battens across the planks (seen when it stands open): what makes a trapdoor a trapdoor
  for (const z of [-D * 0.3, D * 0.3]) {
    const xa = inward * (g + 0.03), xb = inward * (lw - 0.03);
    parts.push(part('wood', grain(bevelBox({ min: [Math.min(xa, xb), -t / 2 - 0.035, z - 0.045], max: [Math.max(xa, xb), -t / 2 + 0.002, z + 0.045], c: 0.008, omit: ['py'] }), 'x'), 'wood', { seed: R.int(0, 9999), shade: 0.8, jitter: 0.06 }));
  }
  // the ring pull, on a brass plate by the meeting edge: lying flat, ready to be lifted
  const px = inward * (lw - 0.1);
  parts.push(setFinish(part('brass', bevelBox({ min: [px - 0.045, t / 2 - 0.002, -0.06], max: [px + 0.045, t / 2 + 0.006, 0.06], c: 0.004, omit: ['ny'] }), 'brass', { seed: seed + 1, shade: 0.85 }), 0.3));
  const ring = turn(profile(0.034, 0).to(0.046, 0, { fillet: 0.005, segs: 1 }).to(0.046, 0.009, { fillet: 0.004, segs: 1 }).to(0.034, 0.009).close(), { segs: 10 });
  parts.push(setFinish(part('brass', transform(ring, T(px, t / 2 + 0.006, 0.0)), 'brass', { seed: seed + 2, warm: 0.04 }), 0.55));
  for (const q of parts) n.add({ ...q, geometry: transform(q.geometry, into) });
}

// ---- the lift: a steel plate with hazard edges, on a ram ----

function buildLift(n: NodeBuilder, seed: number): void {
  const { w: W, d: D } = OPENING;
  const pw = W - 0.06, pd = D - 0.06, t = LIFT.plate;
  n.add(worn(part('steel', bevelBox({ min: [-pw / 2, -t, -pd / 2], max: [pw / 2, 0, pd / 2], c: 0.01, omit: ['ny'], wear: 0.8, band: 0.02 }), 'steel', { seed: seed + 30, shade: 0.75, jitter: 0.04 }), 1.6));
  // the platform's edge: a yellow band all round its top, so it reads as a lift when it comes up
  const e = 0.07;
  for (const [xa, xb, za, zb] of [[-pw / 2, pw / 2, pd / 2 - e, pd / 2], [-pw / 2, pw / 2, -pd / 2, -pd / 2 + e], [-pw / 2, -pw / 2 + e, -pd / 2 + e, pd / 2 - e], [pw / 2 - e, pw / 2, -pd / 2 + e, pd / 2 - e]] as const) {
    n.add(worn(part('steel', bevelBox({ min: [xa, -0.004, za], max: [xb, 0.004, zb], c: 0.002, omit: ['ny'] }), 'tape-yellow', { seed: seed + 31, shade: 0.8 }), 2));
  }
  // the ram under the middle: a polished rod into a cylinder
  n.add(part('metal', turn(profile(0, -0.7).to(0.05, -0.7, { sharp: true }).to(0.05, -t, { sharp: true }).to(0, -t), { segs: 10, caps: false }), 'steel', { seed: seed + 33, shade: 1.1 }));
  n.add(part('steel', turn(profile(0, -1.3).to(0.09, -1.3, { sharp: true }).to(0.09, -0.72, { fillet: 0.02, segs: 1 }).to(0, -0.7), { segs: 10, caps: 'end' }), 'teal-panel', { seed: seed + 34, shade: 0.7 }));
}

// ---- review only: a ring of bench planks round the frame ----

function buildSurround(b: NodeBuilder, R: Rng): void {
  const { w: W, d: D } = OPENING;
  const m = FRAME.w;
  const outer = { x: W / 2 + 1.6, z: D / 2 + 1.2 };
  const pieces: Array<[number, number, number, number]> = [
    [-outer.x, outer.x, D / 2 + m, outer.z],
    [-outer.x, outer.x, -outer.z, -D / 2 - m],
    [-outer.x, -W / 2 - m, -D / 2 - m, D / 2 + m],
    [W / 2 + m, outer.x, -D / 2 - m, D / 2 + m],
  ];
  for (const [xa, xb, za, zb] of pieces) {
    b.add(large(part('wood', grain(bevelBox({ min: [xa, -0.2, za], max: [xb, 0, zb], c: 0.004, omit: ['ny'] }), 'x'), 'wood', { seed: R.int(0, 9999), jitter: 0.08 })));
  }
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'revert-hatch',
    build: (opts = {}) => {
      const o: RevertHatchOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in HATCH_POSES) o.pose = pose as HatchPoseName;
      else if (pose && typeof pose === 'object') o.pose = pose as HatchPose;
      if (opts['surround'] === true) o.surround = true;
      return revertHatch(o);
    },
    poses: HATCH_POSE_NAMES,
    variants: { 'in bench': { surround: true }, low: { detail: 'low' } },
    camera: { distance: 5 },
    note: "Revert's hatch: plank leaf doors on brass strap hinges in a worn yellow frame, a dark shaft, a lift. ?pose=shut|opening|rising|open; variant 'in bench' (with ground=none) for review",
  },
];
