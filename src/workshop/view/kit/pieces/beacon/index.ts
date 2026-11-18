/**
 * The warning beacon (REWRITE.md § B4 rung 4 "a turning warning lamp"; W3
 * round 2). Registry name `beacon`.
 *
 * A squat amber dome on a short stalk, the kind bolted to a machine that
 * might do something alarming. It stands on the Button's console from the
 * first moment of the visit, dark and a little grimy, so a visitor wonders
 * what it is for; on rung 4 it lights and its reflector turns.
 *
 * Built in its own frame: the mount plate's underside on y = 0, the axis up
 * +Y, the cable side toward -Z.
 *  - a bolted square mount plate (painted steel, worn), a short brass stalk
 *    with a nut, a dark enamel collar;
 *  - the dome: `beacon.unlit` (dark amber glass, the dome as you first meet
 *    it) and `beacon.mirror` (the same dome lit: a bright face and a dim
 *    back, so turning it about Y sweeps the bright side round); one or the
 *    other is shown by scale (drawing is skinned: nothing is ever hidden);
 *  - a wire guard of three bent rods and a crown ring, a little bent.
 *
 * Moving nodes (pivots on the dome's axis at the collar's top):
 *  - `beacon.mirror`: turns about its own +Y; scale 1 lit, HIDDEN off.
 *  - `beacon.unlit`: scale 1 off, HIDDEN lit.
 *
 * At most 700 triangles (the brief's cap); `budget()` is in the test.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { part, piece, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { setFinish } from '../../space.ts';

/** Dimensions (world units) the view needs. */
export const BEACON = {
  /** The mount plate: half width, thickness. */
  plate: 0.085,
  plateT: 0.016,
  /** The collar's top: the dome's pivot height above the plate's underside. */
  pivot: 0.095,
  /** The dome: radius and height above the pivot. */
  domeR: 0.072,
  domeH: 0.125,
  /** Overall height. */
  height: 0.24,
} as const;

/** Scale of a hidden twin. */
export const HIDDEN = 1e-4;

export interface BeaconPose {
  /** Lit: the mirror shown and the dark dome hidden. */
  lit?: boolean;
  /** The reflector's angle about Y, radians. */
  angle?: number;
}

export interface BeaconOptions extends KitOptions {
  pose?: BeaconPose | keyof typeof BEACON_POSES;
}

export const BEACON_POSES = {
  dark: { lit: false, angle: 0 },
  lit: { lit: true, angle: 0.4 },
  'lit-turned': { lit: true, angle: 2.2 },
} satisfies Record<string, BeaconPose>;

const turn = (p: Parameters<typeof lathe>[0], o: Parameters<typeof lathe>[1] = {}): BufferGeometry => lathe(p, { band: 0, support: false, ...o });

/** The dome's profile from the collar up, a little squashed at the top (nothing perfect). */
function domeProfile(r: number, h: number) {
  return profile(0, 0)
    .to(r * 0.98, 0, { sharp: true })
    .to(r, h * 0.12, { fillet: 0.006, segs: 1 })
    .curve(r * 0.62, h * 0.86, r * 1.02, h * 0.62, 2)
    .curve(0, h, r * 0.3, h * 0.99, 2);
}

export function beacon(o: BeaconOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const B = BEACON;
  const b = piece('beacon', { detail, seed });
  const segs = detail === 'low' ? 8 : 10;

  // ---- the mount: a square plate, two bolts, a brass stalk with a nut, the enamel collar ----
  b.add(part('steel', bevelBox({ min: [-B.plate, 0, -B.plate], max: [B.plate, B.plateT, B.plate], c: 0.005 }), 'teal-deep', { seed: seed + 1, jitter: 0.05 }));
  for (const [x, z] of [[-0.058, 0.058], [0.058, -0.058]] as const) b.add(setFinish(part('metal', transform(stud(0.011, 0.007, 5), T(x, B.plateT, z)), 'steel', { seed: seed + 2, shade: 0.8 }), 0.3));
  const stalk = turn(profile(0, B.plateT).to(0.02, B.plateT, { sharp: true }).to(0.018, B.plateT + 0.045, { fillet: 0.003, segs: 1 }).to(0, B.plateT + 0.045), { segs: 7, caps: 'end' });
  b.add(setFinish(part('brass', stalk, 'brass', { seed: seed + 3, jitter: 0.08 }), 0.45));
  const nut = turn(profile(0, B.plateT + 0.004).to(0.027, B.plateT + 0.004, { sharp: true }).to(0.027, B.plateT + 0.018, { sharp: true }).to(0, B.plateT + 0.018), { segs: 6, caps: 'end' });
  b.add(setFinish(part('brass', nut, 'brass', { seed: seed + 4, shade: 0.85 }), 0.4));
  const collarY = B.pivot - 0.034;
  const collar = turn(profile(0, collarY).to(0.064, collarY, { sharp: true }).to(0.078, collarY + 0.012, { fillet: 0.004, segs: 1 }).to(0.08, B.pivot, { fillet: 0.003, segs: 1 }).to(0, B.pivot), { segs, caps: 'end' });
  b.add(part('steel', collar, 'ink', { seed: seed + 5, shade: 1.6 }));

  // ---- the dome: dark as you meet it ----
  const unlit = b.node('beacon.unlit', T(0, B.pivot, 0));
  const dome = deform(turn(domeProfile(B.domeR, B.domeH), { segs, caps: false }), (x, y, z) => [x * (1 + 0.015 * Math.sin(y * 40 + seed)), y, z]);
  unlit.add(part('glass', dome, 'amber', { seed: seed + 6, shade: 0.55, jitter: 0.04 }));

  // ---- lit: a bright face and a dim back, turned together ----
  const mirror = b.node('beacon.mirror', chain(T(0, B.pivot, 0), new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)));
  const half = (from: number, to: number) => turn(domeProfile(B.domeR, B.domeH), { segs: 4, caps: false, from, to });
  mirror.add(setFinish(part('bulb', half(-Math.PI / 2, Math.PI / 2), 'amber-glow', { seed: seed + 7 }), 0));
  mirror.add(setFinish(part('bulb', half(Math.PI / 2, (3 * Math.PI) / 2), 'amber', { seed: seed + 8, shade: 0.5 }), 1));

  // ---- the wire guard: three bent rods to a crown ring, each a hair off true ----
  const top = B.pivot + B.domeH + 0.018;
  const gr = B.domeR + 0.014;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3 + R.range(-0.06, 0.06);
    const c = Math.cos(a), s = Math.sin(a);
    const pts: [number, number, number][] = [
      [c * 0.072, B.pivot - 0.004, s * 0.072],
      [c * gr, B.pivot + 0.02, s * gr],
      [c * gr * 1.02, B.pivot + B.domeH * 0.6, s * gr * 1.02],
      [c * gr * 0.55, top, s * gr * 0.55],
    ];
    b.add(setFinish(part('metal', sweep(polylinePath(pts, 0, 1), { radius: 0.0045, segs: 3, ends: 'flat', detail }), 'steel', { seed: seed + 10 + i, shade: 0.75 }), 0.35));
  }
  const crown = turn(profile(gr * 0.5, top - 0.004).to(gr * 0.58, top - 0.004, { sharp: true }).to(gr * 0.58, top + 0.004, { sharp: true }).to(gr * 0.5, top + 0.004, { sharp: true }).close(), { segs: 6 });
  b.add(setFinish(part('metal', transform(crown, new Matrix4().makeRotationZ(R.range(-0.04, 0.04))), 'steel', { seed: seed + 14, shade: 0.75 }), 0.35));

  b.socket('light', T(0, B.pivot + B.domeH * 0.55, 0));
  const built = b.build();
  const p = typeof o.pose === 'string' ? BEACON_POSES[o.pose] : o.pose;
  if (p) posePieceBeacon(built, p);
  return built;
}

function chain(...ms: Matrix4[]): Matrix4 {
  const out = new Matrix4();
  for (const m of ms) out.multiply(m);
  return out;
}

/** The two moving nodes' local transforms for a pose. Pure. */
export function beaconMatrices(pose: BeaconPose, out: { mirror: Matrix4; unlit: Matrix4 }): void {
  const lit = !!pose.lit;
  const k = lit ? 1 : HIDDEN;
  out.mirror.makeRotationY(pose.angle ?? 0).scale(SCALE.set(k, k, k)).setPosition(0, BEACON.pivot, 0);
  const u = lit ? HIDDEN : 1;
  out.unlit.makeScale(u, u, u).setPosition(0, BEACON.pivot, 0);
}

const SCALE = new Vector3();
const M = { mirror: new Matrix4(), unlit: new Matrix4() };

interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/** Pose a realised beacon: lit or dark, and the reflector's angle. No allocation. */
export function poseBeacon(root: Posable, pose: BeaconPose): void {
  beaconMatrices(pose, M);
  const m = root.getObjectByName('beacon.mirror');
  if (m) M.mirror.decompose(m.position, m.quaternion, m.scale);
  const u = root.getObjectByName('beacon.unlit');
  if (u) M.unlit.decompose(u.position, u.quaternion, u.scale);
}

function posePieceBeacon(p: Piece, pose: BeaconPose): void {
  beaconMatrices(pose, M);
  for (const n of p.root.children ?? []) {
    if (n.name === 'beacon.mirror') n.transform = M.mirror.clone();
    if (n.name === 'beacon.unlit') n.transform = M.unlit.clone();
  }
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'beacon',
    build: (opts = {}) =>
      beacon({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        pose: typeof opts['pose'] === 'string' && opts['pose'] in BEACON_POSES ? (opts['pose'] as keyof typeof BEACON_POSES) : 'dark',
      }),
    poses: Object.keys(BEACON_POSES),
    variants: { lit: { pose: 'lit' }, low: { detail: 'low' } },
    camera: { distance: 0.9 },
    note: 'The warning beacon on the Button’s console: dark and grimy until rung 4, when it lights and its reflector turns.',
  },
];
