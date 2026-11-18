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
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { PSample } from '../../profile.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe, roundedBox, slab } from '../../solids.ts';
import { loft } from '../../loft.ts';
import { finish } from '../../mesh.ts';
import { rectLoop } from '../../profile.ts';
import type { Profile } from '../../profile.ts';
import type { LatheOptions } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, linePath, sections, helixPath } from '../../sweep.ts';
import { hexBolt } from '../../details.ts';
import { bevelBox } from '../../cheap.ts';
import type { DetailOptions } from '../../details.ts';
import { aim, chain, mat, merge, part, piece, place, T, texturedPart } from '../../compose.ts';
import { tint } from '../../surface.ts';
import { linear } from '../../../palette.ts';
import { world } from '../../../labels/content.ts';
import type { Labels } from '../../../types.ts';
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
  /** Its name on label tape: a texture key from view/labels and the size that label wants (see the catalogue's `labels` hook). Blank tape without it. */
  nameTape?: { key: string; w: number; h: number };
}

const DEG = Math.PI / 180;
/** The claws are drawn at one size and built half as big again, so they register at the bench's scale. */
const CLAW = new Matrix4().makeScale(1.5, 1.5, 1.5);
/** Lathe geometry is built along +Y; this turns it to face +Z. */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
/** And this turns it to lie along +X. */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

/** A turned part without the wear band (small, seen from a distance): pass `band` to opt back in. */
const turn = (p: Parameters<typeof lathe>[0], o: LatheOptions = {}): BufferGeometry => lathe(p, { band: 0, ...o });

/** A cheap turned collar along +Y from y = 0 (its underside sits on a surface and is never seen). */
function ring(o: { r: number; inner: number; h: number; seed?: number; material?: 'brass' | 'metal'; segs?: number }): KitPart[] {
  const { r, inner: ri, h } = o;
  const g = lathe(
    profile(r, 0)
      .to(r, h * 0.5, { fillet: h * 0.2, segs: 1 })
      .to(r * 0.88, h * 0.62, { sharp: true })
      .to(r * 0.88, h, { fillet: h * 0.25, segs: 1 })
      .to(ri, h, { fillet: h * 0.15, segs: 1 })
      .to(ri, h * 0.4),
    { segs: o.segs ?? Math.max(10, Math.min(20, Math.round(r * 200))), band: 0, support: false, caps: false },
  );
  return [part(o.material ?? 'brass', g, 'brass', { seed: o.seed ?? 0, jitter: 0.04, warm: 0.03 })];
}

/** A cheap dome rivet (six sides is plenty at the size Fetch's rivets are seen), brass unless told. */
function rivet(o: DetailOptions & { d: number }): KitPart[] {
  const r = o.d / 2, h = r * 0.7;
  const g = lathe(profile(0, 0).to(r, 0, { sharp: true }).curve(0, h, r * 0.95, h * 1.05, 1), { segs: 6, band: 0, support: false, caps: 'end' });
  return [part(o.material ?? 'brass', g, o.token ?? 'brass', { seed: o.seed ?? 0, jitter: 0.07, warm: 0.04 })];
}

/**
 * profiledBox (solids.ts) with the plan corners in `corner` segments a quarter: the pail and its lid
 * are big soft corners seen from above, where the profile matters more than the plan.
 */
function plannedBox(o: { w: number; d: number; rPlan: number; corner: number }, p: Profile): BufferGeometry {
  const rp = Math.min(o.rPlan, o.w / 2 - 1e-4, o.d / 2 - 1e-4);
  return finish(loft({ loops: [rectLoop(o.w / 2 - rp, o.d / 2 - rp, o.corner)], profile: p.expand({ detail: 1 }), closedProfile: p.closed, capBand: 0 }), { band: 0 });
}

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
  buildTorso(body, detail, seed, R.fork(1), o.nameTape);
  const head = body.node('head', rest.head);
  const cock = head.node('headCock', rest.headCock);
  const tilt = cock.node('headTilt', rest.headTilt);
  const brow = tilt.node('brow', rest.brow);
  buildTurret(head, cock, tilt, brow, detail, seed);
  const eye = tilt.node('eye', rest.eye);
  buildEye(eye, rest, detail, seed);
  for (const s of ['L', 'R'] as const) buildArm(body, s, rest, detail, seed + (s === 'L' ? 100 : 200));
  buildAerial(body, rest, detail, seed);

  if (!lo) b.socket('nameplate', mat({ at: [0.02, rest.body!.elements[13]! + WHEEL_R + TORSO.y1 + 0.022, TORSO.d / 2 + 0.012] }));
  b.socket('carry', mat({ at: [0, 0.5, 0.42] }));
  const built = b.build();
  // the lids are baked tucked inside the can (open), which would read as grime once they close:
  // give them the open air's cavity instead
  clearCavity(built.root, new Set(['lidTop', 'lidBottom', 'pupil', 'pupilDot']), 0.12);
  // five meshes: bare steel, glass, paper and wood are drawn by the classes that remain
  foldClasses(built.root);
  if (o.pose) applyPose(built, typeof o.pose === 'string' ? EXPRESSIONS[o.pose] : o.pose);
  return built;
}

/** Scale a part's wear (surf.x): thin shells and small turned parts read as all-edge to the curvature measure. In place. */
function wearScale<T extends KitPart>(q: T, k: number): T {
  const sf = q.geometry.getAttribute('surf');
  for (let i = 0; i < sf.count; i++) sf.setX(i, sf.getX(i) * k);
  sf.needsUpdate = true;
  return q;
}

/** Cap the baked cavity (surf.y) on the named nodes' parts: for parts that move out of where they were baked. */
function clearCavity(n: PieceNode, names: ReadonlySet<string>, cap: number): void {
  if (names.has(n.name)) {
    for (const q of n.parts) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, Math.min(sf.getY(i), cap));
      sf.needsUpdate = true;
    }
  }
  for (const c of n.children ?? []) clearCavity(c, names, cap);
}

/**
 * Fetch draws as five skinned meshes (one per material class: painted steel, brass, rubber, bulb,
 * and its name tape). The few parts built in the other classes are folded into those, each
 * corrected so it reads as before:
 *  - bare steel (claws, spring, rivets, mast, grille bars) in the brass class, its colour turned
 *    back from brass's lift (×1.5) and yellow pull (g +10%, b -10%) to the bare-steel class's ×1.15:
 *    still a brushed, metallic grey;
 *  - the lens and the pupil (glass) in painted steel at finish 1 (the wet gloss coat does the
 *    reflecting), the colour taken down to glass's dark tint, never chipped;
 *  - the pennant and the gauge's face (paper) and the handle's grip (wood) in satin painted steel,
 *    worn a little less (thin parts read as all edge).
 * Re-merges each node's parts by class. In place.
 */
function foldClasses(n: PieceNode): void {
  const a = 0.84;
  const scale = (g: BufferGeometry, r: number, gg: number, b: number): void => {
    const c = g.getAttribute('color');
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * r, c.getY(i) * gg, c.getZ(i) * b);
    c.needsUpdate = true;
  };
  const surf = (g: BufferGeometry, wear: number, finish?: number): void => {
    const s = g.getAttribute('surf');
    for (let i = 0; i < s.count; i++) {
      s.setX(i, s.getX(i) * wear);
      if (finish !== undefined) s.setZ(i, finish);
    }
    s.needsUpdate = true;
  };
  let changed = false;
  for (const q of n.parts) {
    if (q.material === 'metal') {
      scale(q.geometry, a, a / 1.1, a / 0.9);
      q.material = 'brass';
      changed = true;
    } else if (q.material === 'glass') {
      // glass shows 22% of its colour; the gloss coat deepens paint to half
      scale(q.geometry, 0.44, 0.44, 0.44);
      surf(q.geometry, 0, 1);
      q.material = 'steel';
      changed = true;
    } else if (q.material === 'paper' || q.material === 'wood') {
      surf(q.geometry, 0.4, 0);
      q.material = 'steel';
      changed = true;
    }
  }
  if (changed) n.parts = merge(n.parts);
  for (const c of n.children ?? []) foldClasses(c);
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
    .to(Rw * 0.84, -hw, { sharp: true })
    .to(Rw, -hw * 0.6, { fillet: 0.045, segs: 1 })
    .to(Rw, hw * 0.6, { smooth: true })
    .to(Rw * 0.84, hw, { fillet: 0.045, segs: 1 })
    .to(ri, hw * 0.82, { sharp: true });
  let tyre = turn(prof, { segs: lo ? 30 : 36, detail, caps: false, filletSegs: 2 });
  const lugs = 9; // 36 segments: 4 per lug
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
  const disc = turn(
    profile(0, -hw * 0.8)
      .to(ri + 0.004, -hw * 0.8, { sharp: true })
      .to(ri + 0.004, -hw * 0.62, { fillet: 0.006, segs: 1 })
      .to(ri * 0.55, -hw * 0.55, { fillet: 0.012, segs: 1 })
      .to(ri * 0.42, -hw * 0.82, { fillet: 0.01, segs: 1 })
      .to(0, -hw * 0.86),
    { segs: 7, detail, caps: 'end', filletSegs: 1 },
  );
  const discs = [disc, transform(disc.clone(), new Matrix4().makeScale(1, -1, 1))];
  for (const d of discs) w.add(part('steel', d, 'teal-light', { seed: seed + 3, shade: 0.95 }));
  // three wheel nuts on the visitor's face of the hub
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const at: [number, number, number] = [Math.cos(a) * ri * 0.5, hw * 0.55, Math.sin(a) * ri * 0.5];
    w.small(() => place(rivet({ d: 0.02, seed: seed + i, material: 'metal', token: 'steel' }), aim(at, [0, 1, 0])));
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
  const fork = sweep(polylinePath([[-px, -0.004, 0], [-px, arch, 0], [px, arch, 0], [px, -0.004, 0]], 0.1, 3), {
    section: sweepSection(0.034, 0.011, 1),
    radius: 0.008,
    ends: 'flat',
    up: [0, 0, 1],
  });
  n.add(part('steel', fork, 'teal-panel', { seed: seed + 11, jitter: 0.03 }));
  // the spring seat on the arch's crown
  n.add(part('steel', turn(profile(0, arch).to(0.07, arch, { sharp: true }).to(0.07, arch + 0.02, { fillet: 0.008 }).to(0.058, top, { fillet: 0.006 }).to(0, top), { segs: 10, detail, caps: 'end', filletSegs: 1 }), 'teal-panel', { seed: seed + 12, shade: 1.05 }));
  for (const s of [1, -1]) {
    // axle boss and its nut, outside the fork
    const boss = turn(profile(0, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.014, { fillet: 0.006 }).to(0.024, 0.024, { fillet: 0.004 }).to(0, 0.024), { segs: 8, detail, caps: 'end', filletSegs: 1 });
    n.add(part('brass', transform(boss, aim([s * (px + 0.008), 0, 0], [s, 0, 0])), 'brass', { seed: seed + 15 + s, warm: 0.03 }));
    n.small(() => place(hexBolt({ af: 0.026, detail: 'low', cheap: true, seed: seed + 17 + s }), aim([s * (px + 0.03), 0, 0], [s, 0, 0])));
  }
  // a mudguard over the top and back of the tyre: a strip of sheet turned about the axle, with rolled edges
  const gw = WHEEL_W / 2 + 0.013, Rg = WHEEL_R + 0.022, gt = 0.009;
  const gsec = profile(Rg, -gw).to(Rg + gt, -gw, { fillet: gt * 0.45, segs: 1 }).to(Rg + gt, gw, { fillet: gt * 0.45, segs: 1 }).to(Rg, gw).close();
  // lathe angle pi lands on top (+Y) once turned onto the axle; the strip runs from just ahead of the top round the back
  const guard = transform(turn(gsec, { from: Math.PI - 0.35, to: Math.PI - 0.35 + 2.1, segs: 8 }), Y_TO_X);
  n.add(part('steel', guard, 'teal-panel', { seed: seed + 19 }));
}

// ---- the spring -----------------------------------------------------------------------

function buildSuspension(n: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  // in the suspension node: y = 0 at the crown top, SPRING_L at the torso's cup (scaled on squash)
  const turns = 3.5;
  const wire = 0.0135;
  // the coil (details.spring at eight samples a turn, its ends flat against the seats that hide them)
  const coil = sweep(helixPath(0.06, (SPRING_L - 2 * wire) / turns, turns, 8), { radius: wire, segs: 5, ends: 'flat' });
  n.add(part('metal', transform(coil, T(0, wire, 0)), 'steel', { seed: seed + 21 }));
  // damper rod and the spring seats
  n.add(part('metal', turn(profile(0, 0).to(0.017, 0, { sharp: true }).to(0.017, SPRING_L, { sharp: true }).to(0, SPRING_L), { segs: 10, detail, caps: false }), 'steel', { seed: seed + 22, shade: 0.7 }));
  n.add(place(ring({ r: 0.078, inner: 0.016, h: 0.016, seed: seed + 23, segs: 8 }), T(0, -0.002, 0)));
}

// ---- the torso ------------------------------------------------------------------------

function buildTorso(n: NodeBuilder, detail: 'high' | 'low', seed: number, R: ReturnType<typeof rng>, nameTape?: FetchPorterOptions['nameTape']): void {
  const { w, d, rPlan: rp, y0, y1, lidTop } = TORSO;
  const lo = detail === 'low';
  // the mounting cup under the pail, where the spring bears
  n.add(part('steel', turn(profile(0, 0).to(0.075, 0, { fillet: 0.012 }).to(0.095, y0 + 0.012, { fillet: 0.01 }).to(0, y0 + 0.012), { segs: 8, detail, caps: 'end', filletSegs: 1 }), 'teal-panel', { seed: seed + 30, shade: 0.8 }));
  // the pail: flared, soft-cornered, wider at the top than the bottom
  const h = y1 - y0;
  const pail = plannedBox(
    { w, d, rPlan: rp, corner: lo ? 3 : 4 },
    profile(0, 0)
      .to(rp - 0.1, 0, { fillet: 0.035, segs: 1 })
      .curve(rp - 0.008, h * 0.72, rp - 0.03, h * 0.5, 3)
      .to(rp, h * 0.88, { fillet: 0.02, segs: 1 })
      .to(rp + 0.006, h * 0.9, { sharp: true })
      .to(rp + 0.006, h, { sharp: true })
      .to(0, h),
  );
  // cream enamelware, like the mug on the switchboard shelf: chipped dark at the edges, never a cow pattern
  n.add(wearScale(part('steel', transform(pail, T(0, y0, 0)), 'paper', { seed: seed + 31, jitter: 0.03, shade: 0.9, warm: 0.04 }), 0.45));
  // the lid: a lip band and a domed top, in the lighter teal
  const lid = plannedBox(
    { w: w + 0.012, d: d + 0.012, rPlan: rp + 0.006, corner: lo ? 3 : 4 },
    profile(0, 0)
      .to(rp + 0.006, 0, { sharp: true })
      .to(rp + 0.006, 0.022, { fillet: 0.008, segs: 1 })
      .to(rp - 0.012, 0.032, { fillet: 0.012, segs: 2 })
      .curve(rp * 0.2, lidTop - y1 - 0.004, rp - 0.05, lidTop - y1 - 0.002, 3)
      .to(0, lidTop - y1),
  );
  // the lid is cream enamel too, with its rolled lip in teal (painted per vertex: one part, no extra triangles)
  const lidPart = part('steel', lid, 'paper', { seed: seed + 33, jitter: 0.03, shade: 0.93, warm: 0.03 });
  const rim = linear('teal-light');
  const lc = lid.getAttribute('color'), lp = lid.getAttribute('position');
  for (let i = 0; i < lp.count; i++) if (lp.getY(i) < 0.029) lc.setXYZ(i, rim[0], rim[1], rim[2]);
  lc.needsUpdate = true;
  n.add(wearScale({ ...lidPart, geometry: transform(lidPart.geometry, T(0, y1 + 0.001, 0)) }, 0.5));

  // ---- front: a radio grille (screen left) and a gauge (screen right) ----
  const zf = d / 2 + 0.004;
  const gx = -0.13, gy = y0 + h * 0.74;
  // the grille's surround: a proud panel, a little off true
  const gm = chain(T(gx, gy, zf - 0.008), askew(seed + 34, 1.6), mat({ rot: [90, 0, 0] }));
  n.add(part('steel', transform(slab({ w: 0.2, d: 0.105, t: 0.016, r: 0.035, bevel: 0.006, detail, open: true, band: 0 }), gm), 'teal-panel', { seed: seed + 35, shade: 0.82 }));
  // the grille: a dark recess with three chromed bars across it
  n.add(part('steel', transform(slab({ w: 0.16, d: 0.07, t: 0.004, r: 0.02, bevel: 0.002, detail: 'low', open: true, band: 0 }), chain(gm, T(0, 0.016, 0))), 'ink', { shade: 1.6 }));
  for (let i = 0; i < 3; i++) {
    const yy = (i - 1) * 0.021;
    n.add(part('metal', transform(sweep(linePath([-0.072, 0, 0], [0.072, 0, 0], 1), { radius: 0.0055, segs: 5, ends: 'flat' }), chain(gm, mat({ rot: [-90, 0, 0] }), T(0, yy, 0.026))), 'steel', { seed: seed + 36 + i }));
  }
  for (const [dx, dy] of [[-0.084, 0.036], [0.084, 0.036], [-0.084, -0.036], [0.084, -0.036]] as const) {
    const s = R.int(0, 999);
    n.small(() => place(rivet({ d: 0.016, detail: 'low', seed: s, material: 'metal', token: 'steel' }), chain(gm, mat({ rot: [-90, 0, 0] }), T(dx, dy, 0.014), mat({ rot: [90, 0, 0] }))));
  }
  // the gauge: brass bezel, paper face, ink needle (it reads "a bit full")
  const ux = 0.15, uy = y0 + h * 0.74;
  n.add(place(ring({ r: 0.05, inner: 0.036, h: 0.018, seed: seed + 37, segs: 9 }), aim([ux, uy, zf - 0.006], [0, 0, 1])));
  n.add(part('paper', transform(turn(profile(0, 0).to(0.043, 0, { sharp: true }).to(0.043, 0.004, { fillet: 0.002 }).to(0, 0.006), { segs: 14, detail, caps: 'end' }), aim([ux, uy, zf - 0.004], [0, 0, 1])), 'paper', { seed: seed + 38, shade: 0.92 }));
  const needleA = (R.range(32, 48) * DEG);
  n.add(part('rubber', transform(sweep(linePath([0, 0, 0], [0, 0.036, 0], 1), { radius: 0.0022, segs: 4, ends: 'flat', taper: (t) => 1 - 0.6 * t, step: 0.012 }), chain(T(ux, uy, zf + 0.004), new Matrix4().makeRotationZ(-needleA), T(0, -0.006, 0))), 'ink'));
  n.add(part('brass', transform(turn(profile(0, 0).to(0.006, 0, { sharp: true }).curve(0, 0.005, 0.006, 0.005, 2), { segs: 8, detail: 'low', caps: 'end' }), aim([ux, uy, zf + 0.004], [0, 0, 1])), 'brass'));

  // ---- lunch-pail clasps at the front corners, bridging body and lid ----
  for (const s of [-1, 1]) {
    const cx = s * (w / 2 - 0.08), cz = d / 2 + 0.006;
    const open = 0;
    const cm = chain(T(cx, y1 - 0.018, cz), askew(seed + 40 + s, 2), mat({ rot: [90, 0, 0] }));
    n.add(part('brass', transform(bevelBox({ min: [-0.023, 0, -0.02], max: [0.023, 0.007, 0.02], c: 0.0025, omit: ['ny'] }), chain(cm, T(0, 0, 0.012))), 'brass', { seed: seed + 41 + s, warm: 0.04 }));
    const bail = sweep(polylinePath([[cx - 0.016, y1 - 0.024, cz + 0.006], [cx - 0.016, y1 + 0.026 + open * 0.01, cz + 0.009], [cx + 0.016, y1 + 0.026, cz + 0.009], [cx + 0.016, y1 - 0.024, cz + 0.006]], 0.008, 1), { radius: 0.0042, segs: 3, ends: 'flat' });
    n.add(setFinish(part('brass', bail, 'brass', { seed: seed + 43 + s }), 0.6));
    n.add(part('brass', transform(bevelBox({ min: [-0.02, 0, -0.01], max: [0.02, 0.006, 0.01], c: 0.0022, omit: ['ny'] }), chain(T(cx, y1 + 0.024, d / 2 + 0.009), mat({ rot: [90, 0, 0] }))), 'brass', { seed: seed + 45 + s }));
  }

  // ---- the carry handle: a bail across the lid, behind the turret, laid back ----
  const hz = -0.12, hx = w / 2 - 0.035, hy = y1 + 0.03;
  const lay = 84 * DEG;
  const hh = 0.13;
  const pts: Array<[number, number, number]> = [
    [-hx, 0, 0], [-hx, hh * 0.85, 0], [-hx + 0.07, hh, 0], [hx - 0.07, hh, 0], [hx, hh * 0.85, 0], [hx, 0, 0],
  ];
  const hm = chain(T(0, hy, hz), new Matrix4().makeRotationX(-lay));
  const bar = sweep(polylinePath(pts, 0.05, 2), { radius: 0.011, segs: 5, ends: 'flat', up: [0, 0, 1] });
  n.add(part('metal', transform(bar, hm), 'steel', { seed: seed + 46 }));
  // a wooden grip on the handle
  const grip = turn(profile(0, 0).to(0.019, 0, { fillet: 0.006 }).to(0.021, 0.08, { smooth: true }).to(0.019, 0.16, { fillet: 0.006 }).to(0, 0.16), { segs: 7, detail, caps: true });
  n.add(part('wood', transform(grain(grip, 'y'), chain(hm, T(-0.08, hh, 0), Y_TO_X)), 'wood-light', { seed: seed + 47 }));
  for (const s of [-1, 1]) {
    n.add(part('brass', transform(turn(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.01, { fillet: 0.004, segs: 1 }).curve(0, 0.018, 0.02, 0.018, 1), { segs: 7, detail, caps: 'end' }), aim([s * (hx + 0.006), hy, hz], [s, 0, 0])), 'brass', { seed: seed + 50 + s }));
  }

  // ---- shoulders: turned hubs on the pail's sides ----
  for (const s of [-1, 1]) {
    const sx = s * (SHOULDER.x - 0.035);
    const hub = turn(
      profile(0, 0).to(0.062, 0, { sharp: true }).to(0.062, 0.012, { fillet: 0.006, segs: 1 }).to(0.05, 0.022, { fillet: 0.006, segs: 1 }).to(0, 0.03),
      { segs: 10, detail, caps: 'end' },
    );
    n.add(part('steel', transform(hub, aim([s * (w / 2 - 0.035), SHOULDER.y, SHOULDER.z], [s, 0, 0])), 'teal-light', { seed: seed + 52 + s }));
    // bolts round the hub
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const at: [number, number, number] = [sx + s * 0.002, SHOULDER.y + Math.cos(a) * 0.04, SHOULDER.z + Math.sin(a) * 0.04];
      const brass = s > 0 && i === 2; // the one replaced bolt
      n.small(() => place(rivet({ d: 0.017, detail: 'low', seed: seed + 60 + i, ...(brass ? {} : { material: 'metal' as const, token: 'steel' as const }) }), aim(at, [s, 0, 0])));
    }
  }

  // ---- small: rivets along the lid lip at the front, a seam, a dent ----
  for (const x of [-0.2, -0.11, 0.13, 0.2]) {
    const i = Math.round(x * 100);
    n.small(() => place(rivet({ d: 0.014, detail: 'low', seed: seed + 70 + i, material: 'metal', token: 'steel' }), aim([x, y1 + 0.012, d / 2 + 0.0085], [0, 0, 1])));
  }
  // its name on a strip of label tape across the lid's lip, a little crooked
  const tw = nameTape ? Math.min(0.19, nameTape.w) : 0.15, th = nameTape ? Math.min(0.03, nameTape.h) : 0.026;
  const tape = extrude([[-tw / 2, -th / 2], [tw / 2, -th / 2], [tw / 2, th / 2], [-tw / 2, th / 2]], 0.0016, { bevel: 0.0005, bevelBase: 0, radius: 0.0012, segs: 1, detail: 'low', caps: 'end' });
  const tm = chain(T(0.02, y1 + 0.012, d / 2 + 0.0095), askew(seed + 80, 3));
  if (nameTape) {
    // uv straight from the strip's face: u along the text, v up
    const pos = tape.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + tw / 2) / tw;
      uv[i * 2 + 1] = (pos.getY(i) + th / 2) / th;
    }
    tape.setAttribute('uv', new BufferAttribute(uv, 2));
    n.add(texturedPart('tape', tint(transform(tape, tm), 'paper'), nameTape.key));
  } else {
    n.add(part('tape', transform(tape, tm), 'ink', { shade: 1.4 }));
  }
}

// ---- the turret --------------------------------------------------------------------------

function buildTurret(head: NodeBuilder, cock: NodeBuilder, tilt: NodeBuilder, brow: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const { r: cr, depth: cd, c: cc, front } = CAN;
  // swivel: a knurled brass ring on a teal base, on the lid
  head.add(place(ring({ r: 0.07, inner: 0.024, h: 0.026, seed: seed + 91, segs: 10 }), T(0, -0.006, 0)));
  // the periscope mast: a turned tube with a gland at its foot
  const mast = turn(
    profile(0, 0.02)
      .to(0.034, 0.02, { sharp: true })
      .to(0.034, 0.032, { fillet: 0.004 })
      .to(0.026, 0.038, { fillet: 0.004 })
      .to(0.024, NECK - 0.012, { smooth: true })
      .to(0, NECK - 0.012),
    { segs: 7, detail, caps: false },
  );
  head.add(part('metal', mast, 'steel', { seed: seed + 92 }));
  // the knuckle the turret nods on: a brass ball in the mast's cup
  cock.add(setFinish(part('brass', turn(profile(0, -0.03).curve(0.034, 0, 0.036, -0.03, lo ? 3 : 5).curve(0, 0.03, 0.036, 0.03, 3), { segs: 8, detail, caps: false }), 'brass', { seed: seed + 93, warm: 0.03 }), 0.5));

  const C = new Matrix4();
  // the yoke: a U of flat bar from a saddle on the knuckle, up both flanks of the can to its pins
  const yx = cr + 0.022;
  const yb = 0.03;
  const yoke = sweep(polylinePath([[-yx, cc, 0], [-yx, yb, 0], [yx, yb, 0], [yx, cc, 0]], 0.08, 1), {
    section: sweepSection(0.006, 0.02, 1),
    radius: 0.004,
    ends: 'flat',
    up: [0, 0, 1],
  });
  cock.add(part('steel', yoke, 'teal-panel', { seed: seed + 88 }));
  // the saddle under the yoke, gripping the ball
  cock.add(part('steel', transform(turn(profile(0, 0).to(0.05, 0, { fillet: 0.01 }).to(0.064, 0.03, { fillet: 0.01 }).to(0, 0.036), { segs: 8, detail, caps: 'end', filletSegs: 1 }), T(0, 0.012, 0)), 'teal-panel', { seed: seed + 89 }));
  // the can: cream enamel, a teal rear cap, a brass bead between them
  const back = -cd / 2 - 0.005;
  const rear = lathe(profile(0, 0).curve(cr * 0.93, 0.05, cr * 0.9, 0.004, 2).to(cr * 0.955, 0.075, { fillet: 0.01, segs: 1 }).to(0, 0.075), { segs: 16, detail, caps: 'end', filletSegs: 1, band: 0 });
  tilt.add(part('steel', transform(rear, chain(C, T(0, 0, back), Y_TO_Z)), 'teal-light', { seed: seed + 95 }));
  const shell = lathe(
    profile(cr * 0.95, 0.062)
      .to(cr, 0.08, { sharp: true })
      .curve(cr, cd - 0.05, cr * 1.025, (cd + 0.03) / 2, 3)
      .to(cr, cd, { fillet: 0.04, segs: 2 })
      .to(EYE.a + 0.03, cd, { sharp: true })
      .to(EYE.a + 0.002, cd - 0.004, { sharp: true })
      .to(EYE.a, cd - 0.03, { sharp: true })
      .to(0, cd - 0.03),
    { segs: lo ? 18 : 20, detail, caps: 'end', filletSegs: 2, band: 0 },
  );
  tilt.add(wearScale(part('steel', transform(shell, chain(C, T(0, 0, back), Y_TO_Z)), 'paper', { seed: seed + 96, shade: 0.96 }), 0.28));
  tilt.add(part('brass', transform(turn(profile(cr * 0.9, 0).to(cr * 0.99, 0, { sharp: true }).to(cr + 0.006, 0.006, { fillet: 0.004, segs: 1 }).to(cr * 0.99, 0.012, { sharp: true }).to(cr * 0.9, 0.012).close(), { segs: 13, detail, band: 0 }), chain(C, T(0, 0, back + 0.064), Y_TO_Z)), 'brass', { seed: seed + 97, warm: 0.03 }));
  // brass hubs on the can's flanks: its "ears"
  for (const s of [-1, 1]) {
    // the yoke's pin hubs: the turret's brass "ears"
    const cap = turn(profile(0, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.008, { fillet: 0.004 }).to(0.028, 0.016, { fillet: 0.006 }).curve(0, 0.024, 0.022, 0.024, 1), { segs: 6, detail, caps: 'end', filletSegs: 1 });
    cock.add(setFinish(part('brass', transform(cap, aim([s * (yx + 0.004), cc, 0], [s, 0, 0])), 'brass', { seed: seed + 94 + s, warm: 0.03 }), 0.5));
  }
  // an indicator lamp on the crown in a brass cup
  tilt.add(place(ring({ r: 0.022, inner: 0.008, h: 0.012, seed: seed + 98, segs: 7 }), T(0, cr - 0.006, -0.035)));
  tilt.add(setFinish(part('bulb', transform(turn(profile(0, 0).to(0.012, 0, { sharp: true }).curve(0, 0.016, 0.013, 0.015, 2), { segs: 10, detail: 'low', caps: 'end' }), T(0, cr + 0.005, -0.035)), 'amber-glow'), 1));

  // the cap's peak: a curved brim over the eye, hugging the can, worn at an angle
  const bw = 0.36, bd = 0.1, bt = 0.013;
  const brimCock = 0.13;
  let brim = roundedBox({ w: bw, h: bt, d: bd, r: 0.005, rPlan: 0.04, detail });
  const Rb = cr + 0.006;
  brim = deform(brim, (x, y, z) => {
    const a = x / Rb + brimCock;
    const zz = z + bd / 2; // 0 at the back edge
    const droop = zz * zz * 0.9;
    const rr = Rb + y - droop;
    return [Math.sin(a) * rr, Math.cos(a) * rr, front - 0.055 + zz * 0.95];
  });
  brow.add(part('steel', brim, 'teal-light', { seed: seed + 99, shade: 0.9 }));
  for (const s of [-1, 1]) {
    const a = s * 0.55 + brimCock;
    brow.small(() => place(rivet({ d: 0.013, detail: 'low', seed: seed + 100 + s }), aim([Math.sin(a) * (Rb + bt), Math.cos(a) * (Rb + bt) - 0.001, front - 0.03], [Math.sin(a), Math.cos(a), 0])));
  }
  // rivets round the shell's rear bead
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    tilt.small(() => place(rivet({ d: 0.012, detail: 'low', seed: seed + 104 + i, material: 'metal', token: 'steel' }), aim([Math.cos(a) * (cr + 0.001), Math.sin(a) * (cr + 0.001), back + 0.1], [Math.cos(a), Math.sin(a), 0])));
  }
}

/** A rounded-rectangle sweep section (core half-sizes; the sweep's radius rounds it). */
const sweepSection = (hx: number, hz: number, corner = 2): ReturnType<typeof sections.roundRect> => sections.roundRect(hx, hz, corner);

// ---- the eye ---------------------------------------------------------------------------

function buildEye(eye: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const { rs, a } = EYE;
  const capA = Math.asin(a / rs);
  // the lens: a dark glass dome
  const lens = turn(capSamples(rs, 0, capA + 0.04, 4), { segs: lo ? 18 : 22, detail, caps: false });
  eye.add(setFinish(part('glass', transform(lens, chain(T(0, 0, EYE_C), Y_TO_Z)), 'teal-deep', { shade: 0.8 }), 1));
  // the bezel: a fat brass ring with a rolled lip, six screws
  const bz = turn(
    profile(a - 0.009, -0.006)
      .to(a + 0.034, -0.006, { sharp: true })
      .to(a + 0.034, 0.006, { fillet: 0.006, segs: 1 })
      .to(a + 0.016, 0.022, { fillet: 0.012, segs: 2 })
      .to(a - 0.004, 0.02, { fillet: 0.006, segs: 1 })
      .to(a - 0.009, 0.008, { sharp: true })
      .to(a - 0.009, -0.006)
      .close(),
    { segs: lo ? 18 : 24, detail, filletSegs: 1, band: 0 },
  );
  eye.add(setFinish(part('brass', transform(bz, Y_TO_Z), 'brass', { seed: seed + 110, warm: 0.04 }), 0.35));
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rr = a + 0.026;
    eye.small(() => place(rivet({ d: 0.011, detail: 'low', seed: seed + 111 + i }), aim([Math.cos(t) * rr, Math.sin(t) * rr, 0.009], [Math.cos(t) * 0.4, Math.sin(t) * 0.4, 1])));
  }

  // the pupil node: a warm lit iris and a dark pupil, riding on the lens sphere
  const pupil = eye.node('pupil', rest.pupil);
  const ir = rs + IRIS.lift;
  const iris = turn(
    [
      { o: Math.sin(IRIS.ang) * (rs - 0.002), y: Math.cos(IRIS.ang) * (rs - 0.002), no: Math.sin(IRIS.ang + 0.6), ny: Math.cos(IRIS.ang + 0.6) },
      ...capSamples(ir, IRIS.pupil * 0.7, IRIS.ang, lo ? 4 : 6),
    ],
    { segs: lo ? 12 : 14, detail, caps: false },
  );
  pupil.add(setFinish(part('bulb', transform(iris, Y_TO_Z), 'amber'), 1));
  // a darker amber ring inside the iris
  const ring = turn(capSamples(ir + 0.0012, IRIS.ang * 0.62, IRIS.ang * 0.74, 1), { segs: lo ? 12 : 14, detail, caps: false });
  pupil.add(setFinish(part('bulb', transform(ring, Y_TO_Z), 'amber-glow', { shade: 0.85 }), 1));
  const pr = ir + 0.004;
  const pup = turn(
    [
      { o: Math.sin(IRIS.pupil) * (ir - 0.001), y: Math.cos(IRIS.pupil) * (ir - 0.001), no: Math.sin(IRIS.pupil + 0.8), ny: Math.cos(IRIS.pupil + 0.8) },
      ...capSamples(pr, 0, IRIS.pupil, 3),
    ],
    { segs: lo ? 10 : 12, detail, caps: false },
  );
  const dot = pupil.node('pupilDot', rest.pupilDot);
  dot.add(setFinish(part('glass', transform(pup, Y_TO_Z), 'ink'), 1));

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
      .arc(oo, hw, (Ro - oo) / (2 * hw), 4, { fillet: LID.t * 0.4, segs: 1 })
      .to(oi, hw)
      .arc(oi, -hw, -(Ri - oi) / (2 * hw), 3)
      .close();
    // lathe angle pi/2 turns to the front (+Z) and pi to the top (+Y) once the axis lies along X
    const from = sgn > 0 ? Math.PI / 2 : Math.PI / 2 - span;
    const g = transform(turn(sec, { from, to: from + span, segs: 5, detail, filletSegs: 1 }), Y_TO_X);
    node.add(wearScale(part('steel', g, 'paper', { seed: seed + 120 + sgn, shade: 0.84 }), 0.12));
    // a dark lash line at the lip
    const lip = sweep(
      { points: Array.from({ length: 7 }, (_, i) => {
        const be = (-1 + (2 * i) / 6) * (hw / LID.r) * 0.98;
        const rr = LID.r + LID.t * 0.15;
        return new Vector3(Math.sin(be) * rr, sgn * 0.003, Math.cos(be) * rr);
      }) },
      { radius: 0.0042, segs: 4, ends: 'flat' },
    );
    node.add(wearScale(part('steel', lip, 'teal-panel', { seed: seed + 123 + sgn, shade: 0.7 }), 0.2));
  }
}

// ---- the arms --------------------------------------------------------------------------

function buildArm(body: NodeBuilder, s: 'L' | 'R', rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const sg = 7;
  const arm = body.node(`arm${s}`, rest[`arm${s}`]);
  // the shoulder: a brass ball, then a turned upper arm (built hanging down -Y)
  arm.add(part('brass', turn(profile(0, -0.04).curve(0.041, -0.002, 0.043, -0.04, 3).curve(0, 0.036, 0.043, 0.036, 3), { segs: 7, detail, caps: false }), 'brass', { seed, warm: 0.03 }));
  const ua = turn(
    profile(0, -UPPER_ARM + 0.01)
      .to(0.03, -UPPER_ARM + 0.01, { sharp: true })
      .to(0.034, -0.05, { smooth: true })
      .to(0.04, -0.03, { fillet: 0.006 })
      .to(0.04, -0.018, { fillet: 0.005 })
      .to(0, -0.018),
    { segs: sg, detail, caps: true },
  );
  arm.add(wearScale(part('steel', ua, 'teal-light', { seed: seed + 1, jitter: 0.03 }), 0.5));
  // the elbow: a brass knuckle across the joint
  const fore = arm.node(`forearm${s}`, rest[`forearm${s}`]);
  const knuckle = turn(profile(0, -0.04).to(0.031, -0.04, { fillet: 0.01, segs: 1 }).to(0.031, 0.04, { fillet: 0.01, segs: 1 }).to(0, 0.04), { segs: 7, detail, caps: true, filletSegs: 1 });
  fore.add(part('brass', transform(knuckle, Y_TO_X), 'brass', { seed: seed + 3 }));
  // the forearm swells toward the wrist: chunky, like a toy's
  const fa = turn(
    profile(0, -FOREARM + 0.004)
      .to(0.044, -FOREARM + 0.004, { fillet: 0.01, segs: 1 })
      .to(0.047, -FOREARM + 0.036, { fillet: 0.012, segs: 1 })
      .to(0.03, -0.03, { smooth: true })
      .to(0.024, -0.012, { sharp: true })
      .to(0, -0.012),
    { segs: sg, detail, caps: true },
  );
  fore.add(wearScale(part('steel', fa, 'teal-light', { seed: seed + 4, jitter: 0.03 }), 0.5));
  // the hand: a palm block and two chunky claws
  const hand = fore.node(`hand${s}`, rest[`hand${s}`]);
  hand.add(part('metal', transform(turn(profile(0, -0.034).to(0.05, -0.034, { fillet: 0.014, segs: 1 }).to(0.05, 0.034, { fillet: 0.014, segs: 1 }).to(0, 0.034), { segs: 8, caps: true }), chain(T(0, -0.054, 0), Y_TO_Z, new Matrix4().makeRotationY(Math.PI / 8))), 'steel', { seed: seed + 6 }));
  // one claw outline (in the jaw's XY plane, pivot at the origin, curling in at the tip)
  for (const j of [0, 1] as const) {
    const js = j === 0 ? 1 : -1;
    const jaw = hand.node(`pincer${s}${j}`, rest[`pincer${s}${j}`]);
    const g = sweep({ points: [new Vector3(0, 0.004, 0), new Vector3(js * 0.02, -0.04, 0), ...polylinePath([[js * 0.02, -0.04, 0], [js * 0.012, -0.088, 0], [-js * 0.01, -0.108, 0]], 0.03, 1).points.slice(1)] }, {
      section: sweepSection(0.006, 0.012, 1),
      radius: 0.006,
      ends: 'flat',
      up: [0, 0, 1],
    });
    jaw.add(part('metal', transform(g, CLAW), 'steel', { seed: seed + 7 + j }));
    jaw.add(part('rubber', transform(turn(profile(0, -0.02).curve(0.014, -0.008, 0.015, -0.02, 1).to(0.014, 0.008, { smooth: true }).curve(0, 0.02, 0.015, 0.02, 1), { segs: 6, caps: false }), chain(CLAW, T(js * -0.013, -0.11, 0), new Matrix4().makeRotationZ(js * 0.8), Y_TO_Z)), 'ink', { seed: seed + 9 + j }));
  }
}

// ---- the aerial and its pennant --------------------------------------------------------

function buildAerial(body: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  // the base: a brass gland on the lid
  body.add(place(ring({ r: 0.026, inner: 0.008, h: 0.022, seed: seed + 130, segs: 7 }), chain(T(AERIAL.x, AERIAL.y - 0.012, AERIAL.z))));
  const segs = AERIAL.segs;
  const radii = [0.0105, 0.0085, 0.0068];
  let node = body.node('aerial', rest.aerial);
  const names = ['aerial', 'aerial2', 'aerial3'];
  for (let i = 0; i < 3; i++) {
    if (i > 0) node = node.node(names[i]!, rest[names[i]!]);
    const L = segs[i]!;
    const r = radii[i]!;
    node.add(part('metal', turn(profile(0, 0).to(r, 0, { sharp: true }).to(r * 0.9, L, { sharp: true }).to(0, L), { segs: 6, detail, caps: false }), 'steel', { seed: seed + 131 + i }));
    // a brass ferrule at the joint
    node.add(part('brass', turn(profile(0, -0.004).to(r + 0.004, -0.004, { fillet: 0.002 }).to(r + 0.004, 0.014, { fillet: 0.002 }).to(0, 0.014), { segs: 6, detail: 'low', caps: true }), 'brass', { seed: seed + 134 + i }));
  }
  // a ball tip
  node.add(part('brass', transform(turn(profile(0, 0).curve(0.013, 0.012, 0.014, 0, 2).curve(0, 0.024, 0.014, 0.024, 2), { segs: 10, detail: 'low', caps: false }), T(0, segs[2]!, 0)), 'brass'));
  // the pennant: two panels so it can ripple, cloth in cable red
  const flag = node.node('flag', rest.flag);
  const h0 = 0.075;
  const cloth = (x0: number, x1: number, y0a: number, y0b: number, y1a: number, y1b: number): BufferGeometry =>
    extrude([[x0, y0a], [x1, y0b], [x1, y1b], [x0, y1a]], 0.005, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
  flag.add(part('paper', transform(cloth(0.004, 0.085, 0, -0.012, h0, h0 - 0.026), T(0, -h0, -0.003)), 'cable-red', { seed: seed + 140 }));
  const tip = flag.node('flagTip', rest.flagTip);
  tip.add(part('paper', transform(cloth(0, 0.07, 0, -0.03, h0 - 0.026, -0.034), T(0, -h0 + 0.012, -0.003)), 'cable-red', { seed: seed + 141, shade: 0.94 }));
  flag.add(part('metal', turn(profile(0, 0).to(0.004, 0, { sharp: true }).to(0.004, h0 + 0.004, { sharp: true }).to(0, h0 + 0.004), { segs: 6, detail: 'low', caps: false }), 'steel'));
  const fp = flag.parts[flag.parts.length - 1]!;
  transform(fp.geometry, T(0, -h0, 0));
}


/** Make Fetch's name tape (label tape from content) and return what `nameTape` wants. */
export function fetchNameTape(labels: Labels): NonNullable<FetchPorterOptions['nameTape']> {
  const key = labels.tape(world.names.fetch, 'black', { capHeight: 0.013 });
  const sz = labels.size(key);
  return { key, w: sz.w, h: sz.h };
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
      const tape = opts['nameTape'] as FetchPorterOptions['nameTape'] | undefined;
      if (tape && typeof tape.key === 'string') o.nameTape = tape;
      return fetchPorter(o);
    },
    poses: EXPRESSION_NAMES,
    labels: (labels: Labels) => ({ nameTape: fetchNameTape(labels) }),
    variants: { ...POSES, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 4.2 },
    note: 'Fetch, take B: the Porter. A lunch-pail runner on one sprung wheel, its eye in a turret under a cap peak. ?pose=curious|eager|oops|offer|deadpan',
  },
];
