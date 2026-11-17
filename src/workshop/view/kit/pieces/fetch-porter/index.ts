/**
 * Fetch, take B: "the Porter". A squat lunch-pail torso with a carry handle,
 * a big tyre on a stout fork with a coil spring you can see work, real
 * shoulders, and all of its curiosity concentrated in one place: a round
 * turret on the lid, swivelling and tilting in a yoke, whose whole front is
 * the eye, under a cap's peak. The workmanlike body against the expressive
 * eye is the charm.
 *
 * The rig and the expressions are in rig.ts (pure). Build with
 * `fetchPorter({ pose })` to get a posed piece (the cavity is always baked
 * at the neutral pose), or realize it once and drive it with `poseFetch`.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { PSample } from '../../profile.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe, profiledBox, roundedBox, slab } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, linePath, sections } from '../../sweep.ts';
import { collar, domeRivet, hexBolt, louvre, slottedScrew, spring } from '../../details.ts';
import { aim, chain, mat, part, piece, place, T } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { setFinish, grain } from '../../space.ts';
import {
  AERIAL, CAN, CROWN_TOP, EXPRESSIONS, EXPRESSION_NAMES, EYE, EYE_C, FOREARM, IRIS, LID, NECK, NEUTRAL, SHOULDER, SPRING_L, TORSO, UPPER_ARM,
  WHEEL_R, WHEEL_W, poseMatrices,
} from './rig.ts';
import type { ExpressionName, FetchPose } from './rig.ts';

export { poseFetch, poseMatrices, EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, PRESETS, ARM_PRESETS } from './rig.ts';
export type { FetchPose, ArmJoints, ArmPreset, Arms, ExpressionName } from './rig.ts';

export interface FetchPorterOptions extends KitOptions {
  /** A named expression or an explicit pose, applied to the node transforms after the bake. */
  pose?: ExpressionName | FetchPose;
}

const DEG = Math.PI / 180;
/** Lathe geometry is built along +Y; this turns it to face +Z. */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
/** And this turns it to lie along +X. */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

/** A spherical cap (or band) of radius r round the +Y axis, from polar angle a0 to a1, as lathe samples (material inside). */
function capSamples(r: number, a0: number, a1: number, n: number, yOff = 0): PSample[] {
  const out: PSample[] = [];
  // lathe profiles run from the outside rim up to the axis (material on the left)
  for (let i = 0; i <= n; i++) {
    const a = a1 + ((a0 - a1) * i) / n;
    out.push({ o: Math.sin(a) * r, y: Math.cos(a) * r + yOff, no: Math.sin(a), ny: Math.cos(a) });
  }
  return out;
}

export function fetchPorter(o: FetchPorterOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const lo = detail === 'low';
  const R = rng(seed);
  const b = piece('fetch-porter', { detail, seed });
  const rest = poseMatrices(NEUTRAL);

  const lean = b.node('lean', rest.lean);
  buildWheel(lean.node('wheel', rest.wheel), detail, seed);
  buildFork(lean, detail, seed);
  buildSuspension(lean.node('suspension', rest.suspension), detail, seed);
  const body = lean.node('body', rest.body);
  buildTorso(body, detail, seed, R.fork(1));
  const head = body.node('head', rest.head);
  const tilt = head.node('headTilt', rest.headTilt);
  buildTurret(head, tilt, detail, seed);
  const eye = tilt.node('eye', rest.eye);
  buildEye(eye, rest, detail, seed);
  for (const s of ['L', 'R'] as const) buildArm(body, s, rest, detail, seed + (s === 'L' ? 100 : 200));
  buildAerial(body, rest, detail, seed);

  if (!lo) b.socket('nameplate', mat({ at: [0.02, rest.body!.elements[13]! + WHEEL_R + TORSO.y1 + 0.022, TORSO.d / 2 + 0.012] }));
  b.socket('carry', mat({ at: [0, 0.5, 0.42] }));
  const built = b.build();
  if (o.pose) applyPose(built, typeof o.pose === 'string' ? EXPRESSIONS[o.pose] : o.pose);
  return built;
}

/** Set a built piece's node transforms to a pose (the cavity keeps its neutral bake). In place. */
export function applyPose(p: Piece, pose: FetchPose): Piece {
  const ms = poseMatrices(pose);
  const walk = (n: PieceNode): void => {
    const m = ms[n.name];
    if (m && n.name !== 'root') n.transform = m.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return p;
}

// ---- the wheel ------------------------------------------------------------------------

function buildWheel(w: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const hw = WHEEL_W / 2;
  const Rw = WHEEL_R;
  const ri = Rw * 0.58;
  // a fat balloon tyre: rounded shoulders, a chevron tread pushed out of the crown
  const prof = profile(ri, -hw * 0.82)
    .to(Rw * 0.86, -hw, { fillet: 0.02 })
    .to(Rw - 0.012, -hw * 0.92, { fillet: 0.03 })
    .to(Rw, -hw * 0.55, { fillet: 0.02 })
    .to(Rw, hw * 0.55, { smooth: true })
    .to(Rw - 0.012, hw * 0.92, { fillet: 0.02 })
    .to(Rw * 0.86, hw, { fillet: 0.03 })
    .to(ri, hw * 0.82, { fillet: 0.02 });
  let tyre = lathe(prof, { segs: lo ? 48 : 80, detail: 'high', caps: false, filletSegs: lo ? 2 : 3 });
  const lugs = 16;
  const depth = 0.012;
  tyre = deform(tyre, (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < Rw - 0.03) return [x, y, z];
    const th = Math.atan2(z, x);
    const ay = Math.abs(y);
    const across = Math.max(0, 1 - Math.pow(ay / (hw * 0.9), 8));
    let u = ((th * lugs) / (Math.PI * 2)) % 1;
    if (u < 0) u += 1;
    const on = u < 0.45 ? 1 : 0;
    const k = Math.max(0, (r - (Rw - 0.03)) / 0.03) * across * on * depth;
    return [x * (1 + k / r), y, z * (1 + k / r)];
  });
  w.add(part('rubber', tyre, 'ink', { seed, jitter: 0.05 }));
  // the wheel disc: a pressed steel dish with a raised hub, both sides
  const disc = lathe(
    profile(0, -hw * 0.8)
      .to(ri + 0.004, -hw * 0.8, { fillet: 0.008 })
      .to(ri + 0.004, -hw * 0.62, { fillet: 0.006 })
      .to(ri * 0.62, -hw * 0.55, { fillet: 0.012 })
      .to(ri * 0.5, -hw * 0.7, { fillet: 0.01 })
      .to(0.028, -hw * 0.72, { fillet: 0.006 })
      .to(0, -hw * 0.72),
    { segs: lo ? 14 : 20, detail, caps: 'end' },
  );
  const discs = [disc, transform(disc.clone(), new Matrix4().makeScale(1, -1, 1))];
  for (const d of discs) w.add(part('steel', d, 'teal-light', { seed: seed + 3, shade: 0.95 }));
  // wheel nuts on both faces
  for (const sgn of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const at: [number, number, number] = [Math.cos(a) * ri * 0.56, sgn * -hw * 0.565, Math.sin(a) * ri * 0.56];
      w.small(() => place(hexBolt({ af: 0.018, detail: 'low', seed: seed + i, token: 'steel' }), aim(at, [0, -sgn, 0])));
    }
  }
}

// ---- the fork -------------------------------------------------------------------------

function buildFork(n: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const hw = WHEEL_W / 2;
  const px = hw + 0.032;
  const top = CROWN_TOP;
  const arch = top - 0.034;
  // the fork: one stout arch of flat bar, from boss to boss over the tyre
  const fork = sweep(polylinePath([[-px, -0.004, 0], [-px, arch, 0], [px, arch, 0], [px, -0.004, 0]], 0.1, lo ? 4 : 7), {
    section: sweepSection(0.034, 0.011),
    radius: 0.008,
    ends: 'round',
    up: [0, 0, 1],
  });
  n.add(part('steel', fork, 'teal-panel', { seed: seed + 11, jitter: 0.03 }));
  // the spring seat on the arch's crown
  n.add(part('steel', lathe(profile(0, arch).to(0.07, arch, { sharp: true }).to(0.07, arch + 0.02, { fillet: 0.008 }).to(0.058, top, { fillet: 0.006 }).to(0, top), { segs: 18, detail, caps: 'end' }), 'teal-panel', { seed: seed + 12, shade: 1.05 }));
  for (const s of [1, -1]) {
    // axle boss and its nut, outside the fork
    const boss = lathe(profile(0, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.014, { fillet: 0.006 }).to(0.024, 0.024, { fillet: 0.004 }).to(0, 0.024), { segs: 16, detail, caps: 'end' });
    n.add(part('brass', transform(boss, aim([s * (px + 0.008), 0, 0], [s, 0, 0])), 'brass', { seed: seed + 15 + s, warm: 0.03 }));
    n.small(() => place(hexBolt({ af: 0.026, detail: 'low', seed: seed + 17 + s }), aim([s * (px + 0.03), 0, 0], [s, 0, 0])));
  }
  // a mudguard over the top and back of the tyre: bent sheet
  const L = 0.42;
  let guard = roundedBox({ w: WHEEL_W + 0.026, h: 0.01, d: L, r: 0.0045, rPlan: 0.03, detail });
  const Rg = WHEEL_R + 0.022;
  guard = deform(guard, (x, y, z) => {
    const a = -0.35 + (z + L / 2) / Rg; // from just ahead of the top, round the back
    const rr = Rg + y;
    return [-x, Math.cos(a) * rr, -Math.sin(a) * rr]; // -x keeps the mapping's handedness
  });
  n.add(part('steel', guard, 'teal-light', { seed: seed + 19, shade: 0.92 }));
}

// ---- the spring -----------------------------------------------------------------------

function buildSuspension(n: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  // in the suspension node: y = 0 at the crown top, SPRING_L at the torso's cup (scaled on squash)
  const turns = 4;
  const wire = 0.0135;
  n.add(spring({ r: 0.06, wire, pitch: (SPRING_L - 2 * wire) / turns, turns, detail, seed: seed + 21, material: 'metal', token: 'steel' }));
  // damper rod and the spring seats
  n.add(part('metal', lathe(profile(0, 0).to(0.017, 0, { sharp: true }).to(0.017, SPRING_L, { sharp: true }).to(0, SPRING_L), { segs: 10, detail, caps: false }), 'steel', { seed: seed + 22, shade: 0.7 }));
  n.add(place(collar({ r: 0.078, inner: 0.016, h: 0.016, detail, seed: seed + 23 }), T(0, -0.002, 0)));
}

// ---- the torso ------------------------------------------------------------------------

function buildTorso(n: NodeBuilder, detail: 'high' | 'low', seed: number, R: ReturnType<typeof rng>): void {
  const { w, d, rPlan: rp, y0, y1, lidTop } = TORSO;
  const lo = detail === 'low';
  // the mounting cup under the pail, where the spring bears
  n.add(part('steel', lathe(profile(0, 0).to(0.075, 0, { fillet: 0.012 }).to(0.095, y0 + 0.012, { fillet: 0.01 }).to(0, y0 + 0.012), { segs: 18, detail, caps: 'end' }), 'teal-panel', { seed: seed + 30, shade: 0.8 }));
  // the pail: flared, soft-cornered, wider at the top than the bottom
  const h = y1 - y0;
  const pail = profiledBox(
    { w, d, rPlan: rp, detail },
    profile(0, 0)
      .to(rp - 0.1, 0, { fillet: 0.035 })
      .curve(rp - 0.008, h * 0.72, rp - 0.03, h * 0.5, lo ? 4 : 7)
      .to(rp, h * 0.88, { fillet: 0.02 })
      .to(rp + 0.006, h * 0.9, { fillet: 0.004 })
      .to(rp + 0.006, h, { fillet: 0.004 })
      .to(0, h),
  );
  n.add(part('steel', transform(pail, T(0, y0, 0)), 'teal-panel', { seed: seed + 31, jitter: 0.03 }));
  // a rubber bumper band round the pail's belly, where it knocks into things
  const band = profiledBox(
    { w, d, rPlan: rp, detail },
    profile(0, 0).to(rp - 0.034, 0, { sharp: true }).to(rp - 0.012, 0.006, { fillet: 0.006 }).to(rp - 0.002, 0.024, { fillet: 0.012 }).to(rp - 0.008, 0.042, { fillet: 0.006 }).to(0, 0.042),
  );
  n.add(part('rubber', transform(band, T(0, y0 + h * 0.43, 0)), 'ink', { seed: seed + 32 }));
  // the lid: a lip band and a domed top, in the lighter teal
  const lid = profiledBox(
    { w: w + 0.012, d: d + 0.012, rPlan: rp + 0.006, detail },
    profile(0, 0)
      .to(rp + 0.006, 0, { fillet: 0.004 })
      .to(rp + 0.006, 0.022, { fillet: 0.008 })
      .to(rp - 0.012, 0.032, { fillet: 0.012 })
      .curve(rp * 0.2, lidTop - y1 - 0.004, rp - 0.05, lidTop - y1 - 0.002, lo ? 4 : 7)
      .to(0, lidTop - y1),
  );
  n.add(part('steel', transform(lid, T(0, y1 + 0.001, 0)), 'teal-light', { seed: seed + 33, jitter: 0.03 }));

  // ---- front: a radio grille (screen left) and a gauge (screen right) ----
  const zf = d / 2 + 0.004;
  const gx = -0.13, gy = y0 + h * 0.74;
  // the grille's surround: a proud panel, a little off true
  const gm = chain(T(gx, gy, zf - 0.008), askew(seed + 34, 1.6), mat({ rot: [90, 0, 0] }));
  n.add(part('steel', transform(slab({ w: 0.2, d: 0.105, t: 0.016, r: 0.035, bevel: 0.006, detail, open: true }), gm), 'teal-panel', { seed: seed + 35, shade: 0.82 }));
  n.add(place(louvre({ w: 0.15, h: 0.066, count: 3, depth: 0.018, detail, seed: seed + 36, frameToken: 'teal-panel' }), chain(gm, mat({ rot: [-90, 0, 0] }), T(0, -0.033, 0.012))));
  for (const [dx, dy] of [[-0.084, 0.036], [0.084, 0.036], [-0.084, -0.036], [0.084, -0.036]] as const) {
    const s = R.int(0, 999);
    n.small(() => place(slottedScrew({ d: 0.02, detail: 'low', seed: s }), chain(gm, mat({ rot: [-90, 0, 0] }), T(dx, dy, 0.014), mat({ rot: [90, 0, 0] }))));
  }
  // the gauge: brass bezel, paper face, ink needle (it reads "a bit full")
  const ux = 0.15, uy = y0 + h * 0.74;
  n.add(place(collar({ r: 0.05, inner: 0.036, h: 0.018, detail, seed: seed + 37 }), aim([ux, uy, zf - 0.006], [0, 0, 1])));
  n.add(part('paper', transform(lathe(profile(0, 0).to(0.043, 0, { sharp: true }).to(0.043, 0.004, { fillet: 0.002 }).to(0, 0.006), { segs: 20, detail, caps: 'end' }), aim([ux, uy, zf - 0.004], [0, 0, 1])), 'paper', { seed: seed + 38, shade: 0.92 }));
  const needleA = (R.range(32, 48) * DEG);
  n.add(part('rubber', transform(roundedBox({ w: 0.0055, h: 0.036, d: 0.003, r: 0.0012, segs: 1, detail: 'low' }), chain(T(ux, uy, zf + 0.004), new Matrix4().makeRotationZ(-needleA), T(0, -0.006, 0))), 'ink'));
  n.add(part('brass', transform(lathe(profile(0, 0).to(0.006, 0, { sharp: true }).curve(0, 0.005, 0.006, 0.005, 2), { segs: 8, detail: 'low', caps: 'end' }), aim([ux, uy, zf + 0.004], [0, 0, 1])), 'brass'));
  // tick marks on the gauge face
  for (let i = 0; i <= 6; i++) {
    const a = (-60 + i * 20) * DEG;
    n.small(() => part('rubber', transform(roundedBox({ w: 0.003, h: 0.008, d: 0.002, r: 0.001, segs: 1, detail: 'low' }), chain(T(ux, uy, zf + 0.002), new Matrix4().makeRotationZ(-a), T(0, 0.03, 0))), 'ink'));
  }
  // a glass over the gauge
  n.add(setFinish(part('glass', transform(lathe(capSamples(0.09, 0, 0.47, lo ? 3 : 5, -0.09 * Math.cos(0.47)), { segs: 20, detail, caps: false }), aim([ux, uy, zf + 0.004], [0, 0, 1])), 'steel', { shade: 0.5 }), 1));

  // ---- lunch-pail clasps at the front corners, bridging body and lid ----
  for (const s of [-1, 1]) {
    const cx = s * (w / 2 - 0.08), cz = d / 2 + 0.006;
    const open = 0;
    const cm = chain(T(cx, y1 - 0.018, cz), askew(seed + 40 + s, 2), mat({ rot: [90, 0, 0] }));
    n.add(part('brass', transform(slab({ w: 0.046, d: 0.04, t: 0.007, r: 0.008, bevel: 0.003, detail, open: true }), chain(cm, T(0, 0, 0.012))), 'brass', { seed: seed + 41 + s, warm: 0.04 }));
    const bail = sweep(polylinePath([[cx - 0.016, y1 - 0.024, cz + 0.006], [cx - 0.016, y1 + 0.026 + open * 0.01, cz + 0.009], [cx + 0.016, y1 + 0.026, cz + 0.009], [cx + 0.016, y1 - 0.024, cz + 0.006]], 0.008, 3), { radius: 0.0042, segs: 6, ends: 'round' });
    n.add(setFinish(part('brass', bail, 'brass', { seed: seed + 43 + s }), 0.6));
    n.add(part('brass', transform(slab({ w: 0.04, d: 0.02, t: 0.006, r: 0.006, bevel: 0.0025, detail, open: true }), chain(T(cx, y1 + 0.024, d / 2 + 0.009), mat({ rot: [90, 0, 0] }))), 'brass', { seed: seed + 45 + s }));
  }

  // ---- the carry handle: a bail across the lid, behind the turret, laid back ----
  const hz = -0.12, hx = w / 2 - 0.035, hy = y1 + 0.03;
  const lay = 84 * DEG;
  const hh = 0.13;
  const pts: Array<[number, number, number]> = [
    [-hx, 0, 0], [-hx, hh * 0.85, 0], [-hx + 0.07, hh, 0], [hx - 0.07, hh, 0], [hx, hh * 0.85, 0], [hx, 0, 0],
  ];
  const hm = chain(T(0, hy, hz), new Matrix4().makeRotationX(-lay));
  const bar = sweep(polylinePath(pts, 0.05, lo ? 3 : 5), { radius: 0.011, segs: lo ? 6 : 8, ends: 'flat', up: [0, 0, 1] });
  n.add(part('metal', transform(bar, hm), 'steel', { seed: seed + 46 }));
  // a wooden grip on the handle
  const grip = lathe(profile(0, 0).to(0.019, 0, { fillet: 0.006 }).to(0.021, 0.08, { smooth: true }).to(0.019, 0.16, { fillet: 0.006 }).to(0, 0.16), { segs: 10, detail, caps: true });
  n.add(part('wood', transform(grain(grip, 'y'), chain(hm, T(-0.08, hh, 0), Y_TO_X)), 'wood-light', { seed: seed + 47 }));
  for (const s of [-1, 1]) {
    n.add(place(collar({ r: 0.026, inner: 0.009, h: 0.016, detail, seed: seed + 48 + s }), aim([s * (hx + 0.012), hy, hz], [s, 0, 0])));
    n.add(part('brass', transform(lathe(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.01, { fillet: 0.004 }).curve(0, 0.018, 0.02, 0.018, 3), { segs: 12, detail, caps: 'end' }), aim([s * (hx + 0.006), hy, hz], [s, 0, 0])), 'brass', { seed: seed + 50 + s }));
  }

  // ---- shoulders: turned hubs on the pail's sides ----
  for (const s of [-1, 1]) {
    const sx = s * (SHOULDER.x - 0.035);
    const hub = lathe(
      profile(0, 0).to(0.062, 0, { sharp: true }).to(0.062, 0.012, { fillet: 0.006 }).to(0.052, 0.02, { fillet: 0.005 }).to(0.05, 0.03, { fillet: 0.006 }).to(0, 0.03),
      { segs: 20, detail, caps: 'end' },
    );
    n.add(part('steel', transform(hub, aim([s * (w / 2 - 0.035), SHOULDER.y, SHOULDER.z], [s, 0, 0])), 'teal-light', { seed: seed + 52 + s }));
    // bolts round the hub
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const at: [number, number, number] = [sx + s * 0.002, SHOULDER.y + Math.cos(a) * 0.04, SHOULDER.z + Math.sin(a) * 0.04];
      const brass = s > 0 && i === 2; // the one replaced bolt
      n.small(() => place(hexBolt({ af: 0.016, detail: 'low', seed: seed + 60 + i, ...(brass ? { material: 'brass' as const, token: 'brass' as const } : {}) }), aim(at, [s, 0, 0])));
    }
  }

  // ---- small: rivets along the lid lip at the front, a seam, a dent ----
  for (let i = 0; i < 7; i++) {
    const x = -0.21 + i * 0.07;
    if (Math.abs(x) < 0.03) continue;
    n.small(() => place(domeRivet({ d: 0.014, detail: 'low', seed: seed + 70 + i, material: 'metal', token: 'steel' }), aim([x, y1 + 0.012, d / 2 + 0.0085], [0, 0, 1])));
  }
  // label-tape strip on the lid lip (its texture key is the nameplate socket's job)
  n.add(part('tape', transform(roundedBox({ w: 0.15, h: 0.0016, d: 0.026, r: 0.0007, segs: 1, detail: 'low' }), chain(T(0.02, y1 + 0.012, d / 2 + 0.0105), askew(seed + 80, 3), mat({ rot: [90, 0, 0] }))), 'ink', { shade: 1.4 }));
}

// ---- the turret --------------------------------------------------------------------------

function buildTurret(head: NodeBuilder, tilt: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const { r: cr, depth: cd, c: cc, front } = CAN;
  // swivel: a knurled brass ring on a teal base, on the lid
  head.add(part('steel', lathe(profile(0, -0.02).to(0.085, -0.02, { sharp: true }).to(0.085, 0.002, { fillet: 0.006 }).to(0.07, 0.01, { fillet: 0.004 }).to(0, 0.01), { segs: 20, detail, caps: 'end' }), 'teal-panel', { seed: seed + 90, shade: 0.9 }));
  head.add(place(collar({ r: 0.064, inner: 0.024, h: 0.02, detail, seed: seed + 91 }), T(0, 0.008, 0)));
  // the periscope mast: a turned tube with a gland at its foot
  const mast = lathe(
    profile(0, 0.02)
      .to(0.034, 0.02, { sharp: true })
      .to(0.034, 0.032, { fillet: 0.004 })
      .to(0.026, 0.038, { fillet: 0.004 })
      .to(0.024, NECK - 0.012, { smooth: true })
      .to(0, NECK - 0.012),
    { segs: 14, detail, caps: 'end' },
  );
  head.add(part('metal', mast, 'steel', { seed: seed + 92 }));
  // the knuckle the turret nods on: a brass ball in the mast's cup
  tilt.add(setFinish(part('brass', lathe(profile(0, -0.03).curve(0.034, 0, 0.036, -0.03, lo ? 3 : 5).curve(0, 0.03, 0.036, 0.03, lo ? 3 : 5), { segs: 14, detail, caps: false }), 'brass', { seed: seed + 93, warm: 0.03 }), 0.5));

  const C = T(0, cc, 0);
  // the saddle under the can, gripping the ball
  tilt.add(part('steel', transform(lathe(profile(0, 0).to(0.05, 0, { fillet: 0.01 }).to(0.064, 0.03, { fillet: 0.01 }).to(0, 0.036), { segs: 16, detail, caps: 'end' }), T(0, 0.012, 0)), 'teal-panel', { seed: seed + 89 }));
  // the can: cream enamel, a teal rear cap, a brass bead between them
  const back = -cd / 2 - 0.005;
  const rear = lathe(profile(0, 0).curve(cr * 0.93, 0.05, cr * 0.9, 0.004, lo ? 4 : 7).to(cr * 0.955, 0.075, { fillet: 0.01 }).to(0, 0.075), { segs: lo ? 20 : 32, detail, caps: 'end' });
  tilt.add(part('steel', transform(rear, chain(C, T(0, 0, back), Y_TO_Z)), 'teal-light', { seed: seed + 95 }));
  const shell = lathe(
    profile(cr * 0.95, 0.062)
      .to(cr, 0.08, { fillet: 0.01 })
      .curve(cr, cd - 0.05, cr * 1.025, (cd + 0.03) / 2, lo ? 3 : 5)
      .to(cr, cd, { fillet: 0.04 })
      .to(EYE.a + 0.03, cd, { fillet: 0.006 })
      .to(EYE.a + 0.002, cd - 0.004, { fillet: 0.003 })
      .to(EYE.a, cd - 0.03, { sharp: true })
      .to(0, cd - 0.03),
    { segs: lo ? 22 : 36, detail, caps: 'end' },
  );
  tilt.add(part('steel', transform(shell, chain(C, T(0, 0, back), Y_TO_Z)), 'paper', { seed: seed + 96, shade: 0.96 }));
  tilt.add(place(collar({ r: cr * 0.985, inner: cr * 0.9, h: 0.012, detail, seed: seed + 97 }), chain(C, T(0, 0, back + 0.064), Y_TO_Z)));
  // brass hubs on the can's flanks: its "ears"
  for (const s of [-1, 1]) {
    const cap = lathe(profile(0, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.008, { fillet: 0.004 }).to(0.028, 0.016, { fillet: 0.006 }).curve(0, 0.024, 0.022, 0.024, 3), { segs: 16, detail, caps: 'end' });
    tilt.add(setFinish(part('brass', transform(cap, aim([s * (cr - 0.004), cc, -0.01], [s, 0, 0])), 'brass', { seed: seed + 94 + s, warm: 0.03 }), 0.5));
  }
  // an indicator lamp on the crown in a brass cup
  tilt.add(place(collar({ r: 0.022, inner: 0.008, h: 0.012, detail, seed: seed + 98 }), T(0, cc + cr - 0.006, -0.035)));
  tilt.add(part('bulb', transform(lathe(profile(0, 0).to(0.012, 0, { sharp: true }).curve(0, 0.016, 0.013, 0.015, 3), { segs: 10, detail: 'low', caps: 'end' }), T(0, cc + cr + 0.005, -0.035)), 'amber-glow'));

  // the cap's peak: a curved brim over the eye, hugging the can, worn at an angle
  const bw = 0.36, bd = 0.1, bt = 0.013;
  const cock = 0.13;
  let brim = roundedBox({ w: bw, h: bt, d: bd, r: 0.005, rPlan: 0.04, detail });
  const Rb = cr + 0.006;
  brim = deform(brim, (x, y, z) => {
    const a = x / Rb + cock;
    const zz = z + bd / 2; // 0 at the back edge
    const droop = zz * zz * 0.9;
    const rr = Rb + y - droop;
    return [Math.sin(a) * rr, Math.cos(a) * rr + cc, front - 0.055 + zz * 0.95];
  });
  tilt.add(part('steel', brim, 'teal-panel', { seed: seed + 99 }));
  for (const s of [-1, 1]) {
    const a = s * 0.55 + cock;
    tilt.small(() => place(domeRivet({ d: 0.013, detail: 'low', seed: seed + 100 + s }), aim([Math.sin(a) * (Rb + bt), Math.cos(a) * (Rb + bt) - 0.001 + cc, front - 0.03], [Math.sin(a), Math.cos(a), 0])));
  }
  // rivets round the shell's rear bead
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    tilt.small(() => place(domeRivet({ d: 0.012, detail: 'low', seed: seed + 104 + i, material: 'metal', token: 'steel' }), aim([Math.cos(a) * (cr + 0.001), Math.sin(a) * (cr + 0.001) + cc, back + 0.1], [Math.cos(a), Math.sin(a), 0])));
  }
}

/** A rounded-rectangle sweep section (core half-sizes; the sweep's radius rounds it). */
const sweepSection = (hx: number, hz: number): ReturnType<typeof sections.roundRect> => sections.roundRect(hx, hz, 2);

// ---- the eye ---------------------------------------------------------------------------

function buildEye(eye: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const { rs, a } = EYE;
  const capA = Math.asin(a / rs);
  // the lens: a dark glass dome
  const lens = lathe(capSamples(rs, 0, capA + 0.04, lo ? 6 : 10), { segs: lo ? 24 : 40, detail, caps: false });
  eye.add(setFinish(part('glass', transform(lens, chain(T(0, 0, EYE_C), Y_TO_Z)), 'teal-deep', { shade: 0.8 }), 1));
  // the bezel: a fat brass ring with a rolled lip, six screws
  const bz = lathe(
    profile(a - 0.009, -0.006)
      .to(a + 0.034, -0.006, { sharp: true })
      .to(a + 0.034, 0.006, { fillet: 0.006 })
      .to(a + 0.016, 0.022, { fillet: 0.012 })
      .to(a - 0.004, 0.02, { fillet: 0.006 })
      .to(a - 0.009, 0.008, { fillet: 0.004 })
      .to(a - 0.009, -0.006)
      .close(),
    { segs: lo ? 24 : 44, detail },
  );
  eye.add(setFinish(part('brass', transform(bz, Y_TO_Z), 'brass', { seed: seed + 110, warm: 0.04 }), 0.35));
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.26;
    const rr = a + 0.026;
    eye.small(() => place(slottedScrew({ d: 0.011, detail: 'low', seed: seed + 111 + i }), aim([Math.cos(t) * rr, Math.sin(t) * rr, 0.009], [Math.cos(t) * 0.4, Math.sin(t) * 0.4, 1])));
  }

  // the pupil node: a warm lit iris and a dark pupil, riding on the lens sphere
  const pupil = eye.node('pupil', rest.pupil);
  const ir = rs + IRIS.lift;
  const iris = lathe(
    [
      { o: Math.sin(IRIS.ang) * (rs - 0.002), y: Math.cos(IRIS.ang) * (rs - 0.002), no: Math.sin(IRIS.ang + 0.6), ny: Math.cos(IRIS.ang + 0.6) },
      ...capSamples(ir, IRIS.pupil * 0.7, IRIS.ang, lo ? 4 : 6),
    ],
    { segs: lo ? 20 : 32, detail, caps: false },
  );
  pupil.add(part('bulb', transform(iris, Y_TO_Z), 'amber', { shade: 0.6 }));
  // a darker amber ring inside the iris
  const ring = lathe(capSamples(ir + 0.0012, IRIS.ang * 0.62, IRIS.ang * 0.74, 2), { segs: lo ? 20 : 32, detail, caps: false });
  pupil.add(part('bulb', transform(ring, Y_TO_Z), 'amber-glow', { shade: 0.75 }));
  const pr = ir + 0.0025;
  const pup = lathe(
    [
      { o: Math.sin(IRIS.pupil) * (ir - 0.001), y: Math.cos(IRIS.pupil) * (ir - 0.001), no: Math.sin(IRIS.pupil + 0.8), ny: Math.cos(IRIS.pupil + 0.8) },
      ...capSamples(pr, 0, IRIS.pupil, lo ? 3 : 5),
    ],
    { segs: lo ? 16 : 24, detail, caps: false },
  );
  pupil.add(setFinish(part('glass', transform(pup, Y_TO_Z), 'ink'), 1));

  // the lids: cream shells over the lens, curved on the lens sphere, a rolled lip
  for (const which of ['lidTop', 'lidBottom'] as const) {
    const node = eye.node(which, rest[which]);
    const sgn = which === 'lidTop' ? 1 : -1;
    const span = 1.3; // radians of arc the lid covers, from its lip back over the top (or under the bottom)
    const hw = a + 0.026;
    // a spherical shell: a closed section (outer and inner arcs) turned about the eye's X axis over `span`
    const Ro = LID.r + LID.t / 2, Ri = LID.r - LID.t / 2;
    const oo = Math.sqrt(Ro * Ro - hw * hw), oi = Math.sqrt(Ri * Ri - hw * hw);
    const sec = profile(oi, -hw)
      .to(oo, -hw, { fillet: LID.t * 0.4 })
      .arc(oo, hw, (Ro - oo) / (2 * hw), lo ? 6 : 10, { fillet: LID.t * 0.4 })
      .to(oi, hw)
      .arc(oi, -hw, -(Ri - oi) / (2 * hw), lo ? 4 : 6)
      .close();
    // lathe angle pi/2 turns to the front (+Z) and pi to the top (+Y) once the axis lies along X
    const from = sgn > 0 ? Math.PI / 2 : Math.PI / 2 - span;
    const g = transform(lathe(sec, { from, to: from + span, segs: lo ? 8 : 14, detail }), Y_TO_X);
    node.add(part('steel', g, 'paper', { seed: seed + 120 + sgn, shade: 0.93 }));
    // a dark lash line at the lip
    const lip = sweep(
      { points: Array.from({ length: 13 }, (_, i) => {
        const be = (-1 + (2 * i) / 12) * (hw / LID.r) * 0.98;
        const rr = LID.r + LID.t * 0.15;
        return new Vector3(Math.sin(be) * rr, sgn * 0.003, Math.cos(be) * rr);
      }) },
      { radius: 0.0042, segs: 6, ends: 'round' },
    );
    node.add(part('steel', lip, 'teal-panel', { seed: seed + 123 + sgn, shade: 0.7 }));
  }
}

// ---- the arms --------------------------------------------------------------------------

function buildArm(body: NodeBuilder, s: 'L' | 'R', rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const sg = 12;
  const arm = body.node(`arm${s}`, rest[`arm${s}`]);
  // the shoulder: a brass ball, then a turned upper arm (built hanging down -Y)
  arm.add(part('brass', lathe(profile(0, -0.04).curve(0.041, -0.002, 0.043, -0.04, lo ? 3 : 4).curve(0, 0.036, 0.043, 0.036, lo ? 3 : 4), { segs: 14, detail, caps: false }), 'brass', { seed, warm: 0.03 }));
  const ua = lathe(
    profile(0, -UPPER_ARM + 0.01)
      .to(0.03, -UPPER_ARM + 0.01, { fillet: 0.008 })
      .to(0.034, -0.05, { smooth: true })
      .to(0.04, -0.03, { fillet: 0.006 })
      .to(0.04, -0.018, { fillet: 0.005 })
      .to(0, -0.018),
    { segs: sg, detail, caps: true },
  );
  arm.add(part('steel', ua, 'teal-light', { seed: seed + 1, jitter: 0.03 }));
  // the elbow: a brass knuckle across the joint
  const fore = arm.node(`forearm${s}`, rest[`forearm${s}`]);
  const knuckle = lathe(profile(0, -0.04).to(0.031, -0.04, { fillet: 0.01 }).to(0.031, 0.04, { fillet: 0.01 }).to(0, 0.04), { segs: 12, detail, caps: true });
  fore.add(part('brass', transform(knuckle, Y_TO_X), 'brass', { seed: seed + 3 }));
  // the forearm swells toward the wrist: chunky, like a toy's
  const fa = lathe(
    profile(0, -FOREARM + 0.004)
      .to(0.044, -FOREARM + 0.004, { fillet: 0.01 })
      .to(0.047, -FOREARM + 0.036, { fillet: 0.012 })
      .to(0.03, -0.03, { smooth: true })
      .to(0.024, -0.012, { fillet: 0.004 })
      .to(0, -0.012),
    { segs: sg, detail, caps: true },
  );
  fore.add(part('steel', fa, 'teal-light', { seed: seed + 4, jitter: 0.03 }));
  fore.small(() => place(collar({ r: 0.05, inner: 0.024, h: 0.012, detail: 'low', seed: seed + 5 }), T(0, -FOREARM - 0.004, 0)));
  // the hand: a palm block and two chunky claws
  const hand = fore.node(`hand${s}`, rest[`hand${s}`]);
  hand.add(part('metal', transform(roundedBox({ w: 0.09, h: 0.05, d: 0.058, r: 0.018, detail }), T(0, -0.05, 0)), 'steel', { seed: seed + 6 }));
  // one claw outline (in the jaw's XY plane, pivot at the origin, curling in at the tip)
  const claw: Array<[number, number]> = [[-0.016, 0.006], [0.019, 0.006], [0.036, -0.04], [0.028, -0.088], [-0.002, -0.116], [-0.024, -0.102], [-0.008, -0.08], [0.002, -0.046], [-0.016, -0.018]];
  for (const j of [0, 1] as const) {
    const js = j === 0 ? 1 : -1;
    const jaw = hand.node(`pincer${s}${j}`, rest[`pincer${s}${j}`]);
    const g = extrude(claw.map(([x, y]) => [js * x, y] as [number, number]), 0.036, { bevel: 0.009, radius: 0.006, detail: 'low', segs: 2 });
    jaw.add(part('metal', transform(g, T(0, 0, -0.018)), 'steel', { seed: seed + 7 + j }));
    jaw.add(part('rubber', transform(roundedBox({ w: 0.024, h: 0.032, d: 0.04, r: 0.009, detail: 'low' }), chain(T(js * -0.013, -0.11, 0), new Matrix4().makeRotationZ(js * 0.8))), 'ink', { seed: seed + 9 + j }));
    jaw.add(part('brass', transform(lathe(profile(0, -0.019).to(0.009, -0.019, { fillet: 0.003 }).to(0.009, 0.019, { fillet: 0.003 }).to(0, 0.019), { segs: 8, detail: 'low', caps: true }), Y_TO_Z), 'brass'));
  }
}

// ---- the aerial and its pennant --------------------------------------------------------

function buildAerial(body: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  // the base: a brass gland on the lid
  body.add(place(collar({ r: 0.026, inner: 0.008, h: 0.022, detail, seed: seed + 130 }), chain(T(AERIAL.x, AERIAL.y - 0.012, AERIAL.z))));
  const segs = AERIAL.segs;
  const radii = [0.0105, 0.0085, 0.0068];
  let node = body.node('aerial', rest.aerial);
  const names = ['aerial', 'aerial2', 'aerial3'];
  for (let i = 0; i < 3; i++) {
    if (i > 0) node = node.node(names[i]!, rest[names[i]!]);
    const L = segs[i]!;
    const r = radii[i]!;
    node.add(part('metal', lathe(profile(0, 0).to(r, 0, { sharp: true }).to(r * 0.9, L, { sharp: true }).to(0, L), { segs: lo ? 6 : 8, detail, caps: false }), 'steel', { seed: seed + 131 + i }));
    // a brass ferrule at the joint
    node.add(part('brass', lathe(profile(0, -0.004).to(r + 0.004, -0.004, { fillet: 0.002 }).to(r + 0.004, 0.014, { fillet: 0.002 }).to(0, 0.014), { segs: 8, detail: 'low', caps: true }), 'brass', { seed: seed + 134 + i }));
  }
  // a ball tip
  node.add(part('brass', transform(lathe(profile(0, 0).curve(0.013, 0.012, 0.014, 0, 3).curve(0, 0.024, 0.014, 0.024, 3), { segs: 10, detail: 'low', caps: false }), T(0, segs[2]!, 0)), 'brass'));
  // the pennant: two panels so it can ripple, cloth in cable red
  const flag = node.node('flag', rest.flag);
  const h0 = 0.075;
  const cloth = (x0: number, x1: number, y0a: number, y0b: number, y1a: number, y1b: number): BufferGeometry =>
    extrude([[x0, y0a], [x1, y0b], [x1, y1b], [x0, y1a]], 0.006, { bevel: 0.002, radius: 0.004, detail: 'low', segs: 1 });
  flag.add(part('paper', transform(cloth(0.004, 0.085, 0, -0.012, h0, h0 - 0.026), T(0, -h0, -0.003)), 'cable-red', { seed: seed + 140 }));
  const tip = flag.node('flagTip', rest.flagTip);
  tip.add(part('paper', transform(cloth(0, 0.07, 0, -0.03, h0 - 0.026, -0.034), T(0, -h0 + 0.012, -0.003)), 'cable-red', { seed: seed + 141, shade: 0.94 }));
  flag.add(part('metal', lathe(profile(0, 0).to(0.004, 0, { sharp: true }).to(0.004, h0 + 0.004, { sharp: true }).to(0, h0 + 0.004), { segs: 6, detail: 'low', caps: false }), 'steel'));
  const fp = flag.parts[flag.parts.length - 1]!;
  transform(fp.geometry, T(0, -h0, 0));
}


const POSES = Object.fromEntries(EXPRESSION_NAMES.map((n) => [n, { pose: n }]));

export const catalogue: CatalogueEntry[] = [
  {
    name: 'fetch-porter',
    build: (opts = {}) => {
      const o: FetchPorterOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) o.pose = pose as ExpressionName;
      else if (pose && typeof pose === 'object') o.pose = pose as FetchPose;
      return fetchPorter(o);
    },
    variants: { ...POSES, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 4.2 },
    note: 'Fetch, take B: the Porter. A lunch-pail runner on one sprung wheel, its eye in a turret under a cap peak. ?pose=curious|eager|oops|offer|deadpan',
  },
];
