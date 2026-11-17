/**
 * Patch, take A: "the felt puppet". The switchboard operator as a hand-made
 * felt and wool toy, the kind a craftsperson sews for a model railway:
 * stuffed teal-grey felt, colour blocked in sewn-on pieces (cream brows and
 * cheeks, a dark mask), glossy black bead eyes sunk into cream felt under
 * heavy fur lids, a stitched smirk, a notched ear, wire whiskers, a chunky
 * rib-knit cardigan in cable red with brass buttons over a cream collar, a
 * fat ringed tail, and a 1940s headset in hard rubber and brass against all
 * that softness. The half-lidded stare is the character.
 *
 * The rig and expressions are in rig.ts (pure). Build with
 * `patchFelt({ pose })` for a posed piece (the cavity is always baked at the
 * neutral pose), or realize it once and drive it with `posePatch`.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { PSample } from '../../profile.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, sections } from '../../sweep.ts';
import { chain, mergeGeometries, part, piece, T } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { rng } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { setFinish } from '../../space.ts';
import {
  CUP, EXPRESSIONS, EXPRESSION_NAMES, EYE, FOREARM, HC, LID, MUZZLE, NEUTRAL, R0, SEAT_H, SIDE_ON, TAIL, UPPER_ARM,
  chartDir, earBase, eyeFrame, headRadius, poseMatrices,
} from './rig.ts';
import type { ExpressionName, PatchPose } from './rig.ts';
import { applique, pillow, planeChart, colour, colourBy, mirrorLoop, mixTone, radialChart, radialSolid, smoothLoop, stitches, stitchLine } from './felt.ts';
import type { P2, RGB } from './felt.ts';

export { posePatch, poseMatrices, EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, PRESETS, ARM_PRESETS, SIDE_ON, SEAT_H } from './rig.ts';
export type { PatchPose, ArmJoints, ArmPreset, Arms, ExpressionName } from './rig.ts';

export interface PatchFeltOptions extends KitOptions {
  /** A named expression or an explicit pose, applied to the node transforms after the bake. */
  pose?: ExpressionName | PatchPose;
  /** Build the stand-in stool under the seat (default true until the real `stool` lands). The piece then stands on y = 0. */
  standIn?: boolean;
  /** Turn on the stool (radians about Y; SIDE_ON is the board pose). Only with the stand-in: the layout turns the real one. */
  turn?: number;
}

/** Lathe geometry is built along +Y; this turns it to lie along +X. */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);

// ---- the felt tones (mixed from palette tokens) -------------------------------------------
const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const FUR: RGB = mix3(mixTone('teal-light', 'teal-panel', 0.4, 0.6), mixTone('steel', 'steel', 0, 0.5), 0.3);
const FUR_LID: RGB = mixTone('ink', 'teal-deep', 0.5, 0.75);
const MASK: RGB = mixTone('ink', 'teal-deep', 0.35, 0.55);
const CREAM: RGB = mixTone('paper', 'brass', 0.1, 0.8);
const PAW: RGB = mixTone('ink', 'teal-deep', 0.5, 0.9);
const RING: RGB = mixTone('teal-deep', 'ink', 0.3, 0.9);
const KNIT: RGB = mixTone('cable-red', 'ink', 0.08, 0.6);
const THREAD_DARK: RGB = mixTone('ink', 'teal-deep', 0.3, 1.0);
const THREAD_LIGHT: RGB = mixTone('paper', 'paper', 0, 0.85);

const felt = (g: BufferGeometry, c: RGB, R?: Rng, jitter = 0.03): KitPart => ({ material: 'felt', geometry: colour(g, c, jitter, R) });

/** A turned part from a radius function of height (domed ends where r falls to 0). */
function latheFn(r: (y: number) => number, y0: number, y1: number, n: number, segs: number, o: { from?: number; to?: number } = {}): BufferGeometry {
  const S: PSample[] = [];
  const h = (y1 - y0) / n;
  for (let i = 0; i <= n; i++) {
    const y = y0 + i * h;
    const o0 = Math.max(0, r(y));
    let no: number, ny: number;
    if (i === 0) {
      no = 0;
      ny = -1;
    } else if (i === n) {
      no = 0;
      ny = 1;
    } else {
      const d = (r(y + h * 0.25) - r(y - h * 0.25)) / (h * 0.5);
      const l = Math.hypot(1, d);
      no = 1 / l;
      ny = -d / l;
    }
    S.push({ o: i === 0 || i === n ? 0 : o0, y, no, ny });
  }
  return lathe(S, { segs, caps: false, band: 0, ...o });
}

/** Smooth interpolation through (y, r) knots (Catmull-Rom). */
function knots(k: ReadonlyArray<readonly [number, number]>): (y: number) => number {
  return (y: number): number => {
    if (y <= k[0]![0]) return k[0]![1];
    const last = k[k.length - 1]!;
    if (y >= last[0]) return last[1];
    let i = 0;
    while (i < k.length - 2 && k[i + 1]![0] < y) i++;
    const p0 = k[Math.max(0, i - 1)]!, p1 = k[i]!, p2 = k[i + 1]!, p3 = k[Math.min(k.length - 1, i + 2)]!;
    const f = (y - p1[0]) / (p2[0] - p1[0]);
    const f2 = f * f, f3 = f2 * f;
    return 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * f + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3);
  };
}

/** Knit rib: push the surface out in vertical ribs round the Y axis (amplitude in world units). */
function rib(g: BufferGeometry, n: number, amp: (y: number) => number, phase = 0): BufferGeometry {
  return deform(g, (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < 1e-5) return [x, y, z];
    const a = Math.atan2(x, z) + phase;
    // a rounded rib, flat-ish valleys: the knit's purl columns
    const w = Math.pow(0.5 + 0.5 * Math.cos(a * n), 0.7);
    const k = (r + amp(y) * (w - 0.5)) / r;
    return [x * k, y, z * k];
  });
}

export function patchFelt(o: PatchFeltOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const b = piece('patch-felt', { detail, seed });
  const rest = poseMatrices(NEUTRAL);
  const standIn = o.standIn ?? true;
  if (standIn) b.transform = chain(T(0, SEAT_H, 0), new Matrix4().makeRotationY(o.turn ?? 0));

  if (standIn) buildStandIn(b, seed);
  buildSeat(b, R.fork(1), detail);
  const spine = b.node('spine', rest.spine);
  buildTorso(spine, R.fork(2), detail);
  const head = spine.node('head', rest.head);
  buildHead(head, rest, R.fork(3), detail);
  for (const s of [1, -1] as const) buildArm(spine, s, rest, R.fork(10 + s), detail);
  buildTail(b, rest, R.fork(4), detail);

  b.socket('seat', new Matrix4());
  const built = b.build();
  // the lids and beads are baked inside the eye (open), which would read as grime once they move
  clearCavity(built.root, new Set(['lidL', 'lidR', 'lidLowL', 'lidLowR', 'pupilL', 'pupilR', 'browL', 'browR']), 0.15);
  if (o.pose) applyPose(built, typeof o.pose === 'string' ? EXPRESSIONS[o.pose] : o.pose);
  return built;
}

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

/** Set a built piece's node transforms to a pose (the cavity keeps its neutral bake). In place. */
export function applyPose(p: Piece, pose: PatchPose): Piece {
  const ms = poseMatrices(pose);
  const walk = (n: PieceNode): void => {
    const m = ms[n.name];
    if (m && n.name !== 'root') n.transform = m.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return p;
}

// ---- the stand-in stool (until `stool` lands) ---------------------------------------------

function buildStandIn(b: NodeBuilder, seed: number): void {
  const H = SEAT_H;
  const g = lathe(
    profile(0, -H)
      .to(0.2, -H, { sharp: true })
      .to(0.2, -H + 0.03, { fillet: 0.012 })
      .to(0.06, -H + 0.06, { fillet: 0.03 })
      .to(0.05, -0.1, { smooth: true })
      .to(0.12, -0.06, { fillet: 0.03 })
      .to(0.26, -0.05, { fillet: 0.02 })
      .to(0.262, -0.01, { fillet: 0.015 })
      .to(0, 0),
    { segs: 20, band: 0, filletSegs: 2 },
  );
  b.add(part('wood', g, 'wood-light', { seed }));
}

// ---- the seat: rump, legs, feet ----------------------------------------------------------

function buildSeat(n: NodeBuilder, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  // the rump: a stuffed cushion of felt the cardigan's hem sits on
  const rump = radialSolid((dx, dy, dz) => 1 / Math.sqrt((dx / 0.225) ** 2 + (dy / 0.1) ** 2 + (dz / 0.2) ** 2), [0, 0.095, -0.035], lo ? 12 : 14);
  n.add(felt(rump, FUR, R));
  for (const s of [1, -1] as const) {
    const sx = s * 0.09;
    // thigh forward over the seat, shin hanging over its edge; a soft sewn tube
    const path = polylinePath([[sx, 0.09, -0.02], [s * 0.1, 0.085, 0.235], [s * 0.105, -0.09, 0.285]], 0.075, 4);
    const leg = sweep(path, { radius: 0.084, segs: lo ? 7 : 9, ends: 'dome', taper: (t) => 1 - 0.2 * t, step: 0.05 });
    n.add(felt(leg, FUR, R));
    // a dark felt foot, toes forward, a little turned out
    const foot = radialSolid((dx, dy, dz) => {
      const r = 1 / Math.sqrt((dx / 0.05) ** 2 + (dy / 0.036) ** 2 + (dz / 0.072) ** 2);
      // toe bumps along the front edge
      const toes = dz > 0.4 && dy < 0.3 ? 1 + 0.06 * Math.max(0, Math.cos(dx * 14)) * dz : 1;
      return r * toes * (dy < -0.5 ? 0.9 : 1);
    }, [0, 0, 0], lo ? 10 : 12);
    n.add(felt(transform(foot, chain(T(s * 0.11, -0.135, 0.325), new Matrix4().makeRotationY(s * 0.25), new Matrix4().makeRotationX(0.25))), PAW, R));
  }
}

// ---- the cardigan --------------------------------------------------------------------

/** The cardigan's radius at a height (spine space). */
const TORSO_R = knots([
  [-0.06, 0.205], [-0.04, 0.226], [0.02, 0.228], [0.035, 0.222], [0.12, 0.234], [0.22, 0.214], [0.29, 0.19], [0.34, 0.158], [0.38, 0.115], [0.41, 0.07], [0.425, 0.03],
]);
const TORSO_DEPTH = 0.84;
const belly = (y: number): number => 0.022 * Math.exp(-(((y - 0.1) / 0.11) ** 2));
/** The cardigan's front surface (z at x = 0) at a height, ribs aside. */
const torsoFront = (y: number): number => TORSO_R(y) * TORSO_DEPTH + belly(y);

function buildTorso(n: NodeBuilder, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const y0 = -0.065, y1 = 0.43;
  let g = latheFn(TORSO_R, y0, y1, lo ? 9 : 11, lo ? 36 : 48);
  // rib: chunky columns over the body, tighter and deeper in the hem band
  g = rib(g, 16, (y) => (y < 0.025 ? 0.006 : y > 0.36 ? 0.002 : 0.0075));
  g = deform(g, (x, y, z) => [x, y, z * TORSO_DEPTH + belly(y) * Math.max(0, z) / Math.max(0.05, TORSO_R(y))]);
  n.add(felt(g, KNIT, R, 0.02));

  // the button band down the front: a plain knit strip, a little proud
  const pts: Vector3[] = [];
  for (let y = -0.058; y <= 0.36; y += 0.035) pts.push(new Vector3(0.004, y, torsoFront(y) + 0.003));
  const placket = sweep({ points: pts }, { section: sections.roundRect(0.019, 0.002, 1), radius: 0.0035, segs: 6, ends: 'round', up: [1, 0, 0] });
  n.add(felt(placket, KNIT, R, 0.02));
  // brass buttons: domed, with a rim
  for (const [i, y] of [0.03, 0.135, 0.24].entries()) {
    const z = torsoFront(y) + 0.011;
    const btn = lathe(profile(0, 0).to(0.019, 0, { sharp: true }).to(0.02, 0.005, { fillet: 0.003, segs: 1 }).curve(0, 0.011, 0.014, 0.011, 2), { segs: 9, band: 0, caps: 'end', filletSegs: 1 });
    const tilt = Math.atan2(torsoFront(y + 0.01) - torsoFront(y - 0.01), 0.02);
    n.add(setFinish(part('brass', transform(btn, chain(T(0.004 + R.spread(0.002), y, z), new Matrix4().makeRotationX(Math.PI / 2 - tilt), new Matrix4().makeRotationY(R.range(0, 3)))), 'brass', { seed: i + 7, warm: 0.03 }), 0.5));
  }

  // the neckline: a ribbed band of the knit round the neck
  const roll = lathe(profile(0.122, 0.345).arc(0.112, 0.392, 0.45, lo ? 3 : 4).to(0.095, 0.392).to(0.1, 0.345).close(), { segs: lo ? 27 : 36, band: 0 });
  const roll2 = rib(transform(roll, new Matrix4().makeScale(1, 1, 0.9)), 18, () => 0.006);
  n.add(felt(transform(roll2, T(0, 0, 0.014)), KNIT, R, 0.02));
  // the cream shirt collar: a band standing up out of the knit, and two big pointed flaps turned down over it
  const band = lathe(profile(0.104, 0.37).arc(0.1, 0.445, 0.25, 3).to(0.07, 0.445).to(0.07, 0.37).close(), { segs: lo ? 16 : 20, band: 0 });
  n.add(felt(transform(band, chain(T(0, 0, 0.022), new Matrix4().makeScale(1, 1, 0.9))), CREAM, R, 0.02));
  for (const s of [1, -1] as const) {
    const outline: P2[] = [[-0.008, 0.012], [0.07, 0.006], [0.1, -0.006], [0.035, -0.088], [-0.004, -0.04]];
    const flap = extrude(s > 0 ? outline : mirrorLoop(outline), 0.008, { bevel: 0.003, radius: 0.006, segs: 2, caps: 'end', detail });
    const fy = 0.43;
    const fz = torsoFront(0.38) + 0.004;
    const m = chain(T(s * 0.012, fy, fz), new Matrix4().makeRotationY(s * 0.62), new Matrix4().makeRotationX(-0.55), new Matrix4().makeRotationZ(s * 0.06));
    n.add(felt(transform(flap, m), CREAM, R, 0.02));
  }

  // a patch pocket on its left front, with a call slip poking out of it
  const pk = extrude(smoothLoop([[-0.048, -0.04], [0.048, -0.042], [0.05, 0.035], [-0.05, 0.036]], 8), 0.008, { bevel: 0.003, radius: 0.004, segs: 1, caps: 'end', detail });
  const py = 0.06;
  const pz = TORSO_R(py) * TORSO_DEPTH * Math.cos(0.5) + belly(py) * 0.9;
  const pm = chain(T(Math.sin(0.5) * TORSO_R(py) - 0.004, py, pz - 0.006), new Matrix4().makeRotationY(0.5), new Matrix4().makeRotationZ(0.03));
  n.add(felt(transform(pk, pm), KNIT, R, 0.04));
  const slip = extrude([[-0.024, 0], [0.026, 0], [0.024, 0.052], [-0.022, 0.05]], 0.003, { bevel: 0.001, radius: 0.002, segs: 1, detail: 'low' });
  n.add(part('paper', transform(slip, chain(pm, T(0.006, 0.0, 0.003), new Matrix4().makeRotationZ(-0.12))), 'paper', { seed: 5, shade: 0.95 }));
}

// ---- the head --------------------------------------------------------------------------

const MC: readonly [number, number, number] = [MUZZLE.c[0], MUZZLE.c[1], MUZZLE.c[2]];

/** The muzzle pod's radius per direction from its centre: a short, broad toy snout. */
function muzzleRadius(dx: number, dy: number, dz: number): number {
  const front = Math.max(0, dz);
  // narrower toward the nose, flatter on top, a soft chin underneath
  const a = MUZZLE.a * (1 - 0.22 * front * front);
  const bb = (dy > 0 ? MUZZLE.b * 0.92 : MUZZLE.b) * (1 - 0.1 * front);
  const r = 1 / Math.sqrt((dx / a) ** 2 + (dy / bb) ** 2 + (dz / MUZZLE.c2) ** 2);
  return r;
}

function buildHead(n: NodeBuilder, rest: Record<string, Matrix4>, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const head = radialSolid(headRadius, HC, lo ? 24 : 28);
  n.add(felt(head, FUR, R));
  const chart = radialChart(headRadius, HC, R0);
  const mchart = radialChart(muzzleRadius, MC, 0.09);

  // the seam over the crown: the two halves of the head were sewn together
  const crown: P2[] = [];
  for (let v = 0.5; v <= 2.3; v += 0.08) crown.push([0, v * R0]);
  addParts(n, stitches(chart, crown, { open: true, kind: 'running', pitch: 0.016, len: 0.01, inset: 0, h: 0.0, w: 0.0016, R }), THREAD_DARK);

  // ---- the mask: two dark felt pieces round the eyes, sweeping back to points ----
  const maskL = smoothLoop([
    [0.022, 0.002], [0.04, -0.02], [0.075, -0.038], [0.12, -0.052], [0.165, -0.075], [0.205, -0.092], [0.218, -0.058], [0.192, -0.004], [0.155, 0.04], [0.115, 0.064], [0.075, 0.07], [0.045, 0.055], [0.028, 0.03],
  ], lo ? 18 : 22);
  for (const s of [1, -1] as const) {
    const ol = s > 0 ? maskL : mirrorLoop(maskL);
    n.add(felt(applique(chart, ol, { t: 0.0065, edge: 0.004, puff: 0.002, centre: [s * 0.1, 0.005], rings: 2 }), MASK, R));
    addParts(n, stitches(chart, ol, { kind: 'blanket', pitch: 0.013, len: 0.005, inset: 0.002, h: 0.005, w: 0.0012, R }), THREAD_LIGHT);
  }
  // ---- the cream cheeks under the mask, out to the jowls ----
  const cheekL = smoothLoop([
    [0.02, -0.05], [0.06, -0.052], [0.1, -0.058], [0.14, -0.072], [0.172, -0.092], [0.17, -0.13], [0.13, -0.16], [0.08, -0.165], [0.035, -0.14], [0.012, -0.095],
  ], lo ? 16 : 22);
  for (const s of [1, -1] as const) {
    const ol = s > 0 ? cheekL : mirrorLoop(cheekL);
    n.add(felt(applique(chart, ol, { t: 0.005, edge: 0.004, puff: 0.003, centre: [s * 0.09, -0.11], rings: 2 }), CREAM, R));
    addParts(n, stitches(chart, ol, { kind: 'running', pitch: 0.012, len: 0.007, inset: 0.004, h: 0.006, w: 0.0012, R, where: (u, v) => v < -0.06 || Math.abs(u) > 0.14 }), THREAD_DARK);
  }

  // ---- the muzzle: a stuffed cream pod sewn on, a seam down its middle ----
  const muz = radialSolid(muzzleRadius, MC, lo ? 16 : 18);
  n.add(felt(muz, CREAM, R));
  // the centre seam from the nose down under the chin
  const seam: P2[] = [];
  for (let v = -0.02; v >= -0.16; v -= 0.02) seam.push([0, v]);
  addParts(n, stitches(mchart, seam, { open: true, kind: 'running', pitch: 0.014, len: 0.008, inset: 0, h: 0.0, w: 0.0013, R }), THREAD_DARK);

  // the nose: a glossy black safety nose, a rounded triangle on the tip
  const nd = new Vector3(0, 0.36, 0.93).normalize();
  const np = new Vector3(MC[0], MC[1], MC[2]).addScaledVector(nd, muzzleRadius(nd.x, nd.y, nd.z) - 0.006);
  const nose = radialSolid((dx, dy, dz) => {
    const w = 1 - 0.38 * Math.max(0, -dy); // narrower at the bottom: a triangle with round corners
    return 1 / Math.sqrt((dx / (0.037 * w)) ** 2 + (dy / 0.024) ** 2 + (dz / 0.024) ** 2);
  }, [0, 0, 0], lo ? 12 : 14);
  n.add(setFinish(part('glass', transform(nose, chain(T(np.x, np.y, np.z), new Matrix4().makeRotationX(-0.35))), 'ink'), 1));

  // the philtrum: one stitch line from under the nose down to the mouth
  const ph: Vector3[] = [], phn: Vector3[] = [];
  for (const v of [-0.004, -0.018, -0.032]) {
    const q = mchart(0, v);
    ph.push(q.p.addScaledVector(q.n, 0.0015));
    phn.push(q.n);
  }
  // the mouth: two halves of satin-stitched thread from the centre, each its own node
  const mouthC = mchart(0, -0.034);
  const mouthCv = mouthC.p.clone();
  const philtrum = sweep({ points: [new Vector3(np.x, np.y - 0.016, np.z + 0.0), ...ph.slice(1), mouthCv.clone().addScaledVector(mouthC.n, 0.0012)] }, { radius: 0.0026, segs: 5, ends: 'round' });
  n.add(felt(philtrum, THREAD_DARK));
  for (const s of [1, -1] as const) {
    const node = n.node(s > 0 ? 'mouthL' : 'mouthR', rest[s > 0 ? 'mouthL' : 'mouthR']);
    // a short flat line, then a curl up at the corner (the left corner curls more: the smirk)
    const pts: Vector3[] = [];
    const curl = s > 0 ? 0.03 : 0.006;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const u = s * (0.004 + t * 0.05);
      const v = -0.035 - 0.006 * Math.sin(t * Math.PI * 0.8) + curl * Math.pow(t, 3);
      const q = mchart(u, v);
      pts.push(q.p.addScaledVector(q.n, 0.0012).sub(new Vector3(MC[0], MC[1], MC[2])));
    }
    const mth = sweep({ points: pts }, { radius: 0.0028, segs: 4, ends: 'round', taper: (t) => 1 - 0.3 * t, step: 0.01 });
    node.add(felt(mth, THREAD_DARK));
  }

  // whiskers: fine wire, three a side, out of the muzzle's flanks
  for (const s of [1, -1] as const) {
    for (let k = 0; k < 3; k++) {
      const q = mchart(s * 0.06, -0.002 - k * 0.011);
      const dir = new Vector3(s * 1, 0.25 - k * 0.22 + R.spread(0.08), 0.35 + R.spread(0.1)).normalize();
      const a = q.p.clone().addScaledVector(q.n, -0.004);
      const L = 0.12 + R.spread(0.02);
      const mid = a.clone().addScaledVector(dir, L * 0.5).add(new Vector3(0, -0.006, 0));
      const e = a.clone().addScaledVector(dir, L).add(new Vector3(0, -0.02, 0));
      const w = sweep({ points: [a, mid, e] }, { radius: 0.0016, segs: 4, ends: 'flat', taper: (t) => 1 - 0.55 * t, step: 0.03 });
      n.add(part('metal', w, 'steel', { seed: k, shade: 0.75 }));
    }
  }

  // ---- brows: cream felt crescents above the mask; they slide over the felt ----
  const browL = smoothLoop([[0.03, 0.072], [0.07, 0.08], [0.11, 0.078], [0.145, 0.066], [0.155, 0.082], [0.122, 0.1], [0.078, 0.106], [0.04, 0.097]], lo ? 12 : 18);
  const back = new Matrix4().makeTranslation(-HC[0], -HC[1], -HC[2]);
  for (const s of [1, -1] as const) {
    const nm = s > 0 ? 'browL' : 'browR';
    const node = n.node(nm, rest[nm]);
    const ol = s > 0 ? browL : mirrorLoop(browL);
    node.add(felt(transform(applique(chart, ol, { t: 0.006, edge: 0.005, puff: 0.003, sink: 0.01, centre: [s * 0.09, 0.088], rings: 2 }), back), CREAM, R));
    const st = stitches(chart, ol, { kind: 'running', pitch: 0.011, len: 0.006, inset: 0.0045, h: 0.007, w: 0.0011, R });
    if (st) node.add(felt(transform(st, back), THREAD_DARK));
  }

  // ---- eyes: cream felt eyeballs sunk in the mask, black glass beads, heavy fur lids ----
  for (const s of [1, -1] as const) {
    const F = eyeFrame(s);
    const er = EYE.r;
    const ball = lathe(capSamples(er, 0, 1.75, lo ? 5 : 6), { segs: lo ? 12 : 16, caps: false, band: 0 });
    n.add(felt(transform(ball, chain(F, Y_TO_Z)), CREAM, R, 0.01));
    const nmP = s > 0 ? 'pupilL' : 'pupilR';
    const pupil = n.node(nmP, rest[nmP]);
    // the bead: a flattened glossy dome sitting on the eyeball
    const bead = radialSolid((dx, dy, dz) => 1 / Math.sqrt((dx / EYE.bead) ** 2 + (dy / EYE.bead) ** 2 + (dz / 0.012) ** 2), [0, 0, er - 0.0058], lo ? 10 : 12);
    pupil.add(setFinish(part('glass', bead, 'ink'), 1));
    // upper and lower lids: thick felt shells over the eyeball, a dark stitched lash line on the upper
    for (const which of ['up', 'low'] as const) {
      const nm = which === 'up' ? (s > 0 ? 'lidL' : 'lidR') : s > 0 ? 'lidLowL' : 'lidLowR';
      const node = n.node(nm, rest[nm]);
      const t = which === 'up' ? LID.t : LID.t * 0.8;
      const Rm = er + LID.gap + 0.003 + t / 2;
      const Ro = Rm + t / 2, Ri = Rm - t / 2;
      const hw = er * 1.02;
      const oo = Math.sqrt(Ro * Ro - hw * hw), oi = Math.sqrt(Math.max(1e-6, Ri * Ri - hw * hw));
      const sec = profile(oi, -hw)
        .to(oo, -hw, { fillet: t * 0.45 })
        .arc(oo, hw, (Ro - oo) / (2 * hw), lo ? 5 : 7, { fillet: t * 0.45 })
        .to(oi, hw)
        .arc(oi, -hw, -(Ri - oi) / (2 * hw), 4)
        .close();
      const span = which === 'up' ? 1.6 : 1.0;
      const from = which === 'up' ? Math.PI / 2 : Math.PI / 2 - span;
      const g = transform(lathe(sec, { from, to: from + span, segs: which === 'up' ? (lo ? 5 : 6) : 4, filletSegs: 1, band: 0 }), Y_TO_X);
      node.add(felt(g, FUR_LID, R, 0.02));
      if (which === 'up') {
        const pts: Vector3[] = [];
        for (let k = 0; k <= 10; k++) {
          const be = (-1 + (2 * k) / 10) * 0.82;
          const rr = Ro - 0.0015;
          pts.push(new Vector3(Math.sin(be) * rr, -0.001, Math.cos(be) * rr));
        }
        node.add(felt(sweep({ points: pts.filter((_, k) => k % 2 === 0) }, { radius: 0.0034, segs: 4, ends: 'round' }), THREAD_DARK));
      }
    }
  }

  // ---- ears: puffy sewn triangles with cream linings; the left one notched ----
  for (const s of [1, -1] as const) {
    const nm = s > 0 ? 'earL' : 'earR';
    const node = n.node(nm, rest[nm]);
    const notched = s > 0;
    const ctrl: P2[] = notched
      ? [[-0.07, 0], [0, -0.004], [0.072, 0], [0.074, 0.048], [0.064, 0.082], [0.04, 0.086], [0.054, 0.104], [0.036, 0.142], [0.014, 0.162], [-0.01, 0.152], [-0.042, 0.11], [-0.066, 0.052]]
      : [[-0.07, 0], [0, -0.004], [0.072, 0], [0.072, 0.05], [0.058, 0.1], [0.034, 0.144], [0.014, 0.162], [-0.01, 0.152], [-0.042, 0.11], [-0.066, 0.052]];
    const outline = s > 0 ? ctrl : mirrorLoop(ctrl);
    const cup = (x: number, y: number, z: number): [number, number, number] => [x, y, z + 0.9 * x * x * (1 - y * 2) - 0.12 * y * y];
    const shape = smoothLoop(outline, lo ? 18 : 22);
    for (const g of pillow(shape, { t: 0.014, edge: 0.011, puff: 0.004, back: 0.012, centre: [0, 0.06], rings: 2 })) node.add(felt(deform(g, cup), FUR, R));
    const inner = smoothLoop(outline.map(([x, y]) => [x * 0.64, y * 0.7 + 0.016] as const), lo ? 14 : 16);
    node.add(felt(deform(applique(planeChart(1, 0.0125), inner, { t: 0.004, edge: 0.003, puff: 0.003, sink: 0.004, centre: [0, 0.065], rings: 2 }), cup), CREAM, R));
  }

  // ---- cheek ruffs: pinked felt fringes standing off the jowls ----
  for (const s of [1, -1] as const) {
    const ol: P2[] = [[0, -0.05], [0.07, -0.038], [0.045, -0.012], [0.082, 0.004], [0.045, 0.02], [0.058, 0.042], [0, 0.045]];
    const frs = pillow(ol, { t: 0.006, edge: 0.005, puff: 0.002, centre: [0.02, 0.0], rings: 1 }).map((g) => transform(g, T(-0.012, 0, 0)));
    const fr = mergeGeometries(frs);
    const d = chartDir(s * 1.32, -0.42);
    const pnt = new Vector3(HC[0], HC[1], HC[2]).addScaledVector(d, headRadius(d.x, d.y, d.z) - 0.012);
    const out = new Vector3(d.x, -0.35, d.z - 0.25).normalize();
    const up = new Vector3(0, 1, 0);
    const zz = out.clone().cross(up).normalize().multiplyScalar(s);
    const yy = zz.clone().cross(out).normalize();
    const M = new Matrix4().makeBasis(out, yy, zz).setPosition(pnt);
    n.add(felt(transform(fr, M), FUR, R));
  }

  buildHeadset(n, rest, R.fork(9), detail);
}

/** Spherical cap samples (from the axis down to polar angle a1), for a lathe about +Y. */
function capSamples(r: number, a0: number, a1: number, n: number): PSample[] {
  const out: PSample[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + ((a0 - a1) * i) / n;
    out.push({ o: Math.sin(a) * r, y: Math.cos(a) * r, no: Math.sin(a), ny: Math.cos(a) });
  }
  return out;
}

function addParts(n: NodeBuilder, g: BufferGeometry | null, c: RGB): void {
  if (g) n.add(felt(g, c));
}

// ---- the headset ------------------------------------------------------------------------

function buildHeadset(n: NodeBuilder, rest: Record<string, Matrix4>, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const zb = HC[2] - 0.01;
  // the band: a flat strip of black rubber over the crown, cup to cup
  const pts: Vector3[] = [];
  for (let k = 0; k <= 14; k++) {
    const a = -Math.PI / 2 + (k / 14) * Math.PI;
    const d = new Vector3(Math.sin(a), Math.cos(a), 0);
    const r = headRadius(d.x, d.y, d.z) + 0.016;
    pts.push(new Vector3(HC[0] + d.x * r, HC[1] + d.y * r + 0.012, zb));
  }
  pts[0]!.y -= 0.004;
  const band = sweep({ points: pts }, { section: sections.roundRect(0.013, 0.0035, 1), radius: 0.0025, segs: 8, ends: 'round', up: [0, 0, 1] });
  n.add(part('rubber', band, 'ink', { seed: 1, shade: 1.3 }));
  for (const s of [1, -1] as const) {
    const cx = s * CUP.x, cy = HC[1] + CUP.y, cz = HC[2] + CUP.z;
    const at = chain(T(cx, cy, cz), new Matrix4().makeRotationZ(-s * Math.PI / 2));
    // cushion and cup body (rubber), brass rim, brass centre boss
    const body = lathe(
      profile(0, -0.012)
        .to(0.052, -0.012, { fillet: 0.008 })
        .to(0.06, 0.004, { fillet: 0.006 })
        .to(0.056, 0.012, { sharp: true })
        .to(0.058, 0.03, { fillet: 0.01 })
        .curve(0, 0.042, 0.04, 0.042, 3),
      { segs: lo ? 12 : 14, band: 0, filletSegs: 1 },
    );
    n.add(part('rubber', transform(body, at), 'ink', { seed: 2 + s, shade: 1.2 }));
    const rim = lathe(profile(0.055, 0.008).to(CUP.r, 0.008, { fillet: 0.003, segs: 1 }).to(CUP.r + 0.002, 0.016, { fillet: 0.004, segs: 1 }).to(0.055, 0.02, { sharp: true }).close(), { segs: lo ? 12 : 14, band: 0, filletSegs: 1 });
    n.add(setFinish(part('brass', transform(rim, at), 'brass', { seed: 4 + s, warm: 0.03 }), 0.4));
    const boss = lathe(profile(0, 0.038).to(0.02, 0.038, { sharp: true }).to(0.02, 0.044, { fillet: 0.003 }).curve(0, 0.05, 0.016, 0.05, 2), { segs: 12, band: 0, caps: 'end' });
    n.add(setFinish(part('brass', transform(boss, at), 'brass', { seed: 6 + s }), 0.6));
    // the band's brass slider where it meets the cup
    const yoke = lathe(profile(0, -0.012).to(0.011, -0.012, { fillet: 0.003 }).to(0.011, 0.012, { fillet: 0.003 }).to(0, 0.012), { segs: 8, band: 0 });
    n.add(part('brass', transform(yoke, T(s * (CUP.x - 0.004), cy + 0.075, zb)), 'brass', { seed: 8 + s }));
  }
  // the boom: a brass tube from the right cup, round the cheek to the corner of the mouth, a ball mic
  const boom = n.node('boom', rest.boom);
  const bp = polylinePath([[0, 0, 0], [0.004, -0.012, 0.06], [0.03, -0.055, 0.14], [0.1, -0.1, 0.205], [0.15, -0.108, 0.222]], 0.04, 3);
  boom.add(setFinish(part('brass', sweep(bp, { radius: 0.0062, segs: 6, ends: 'flat' }), 'brass', { seed: 11 }), 0.35));
  const piv = lathe(profile(0, 0).to(0.018, 0, { sharp: true }).to(0.018, 0.012, { fillet: 0.004 }).curve(0, 0.018, 0.014, 0.018, 2), { segs: 12, band: 0, caps: 'end' });
  boom.add(setFinish(part('brass', transform(piv, new Matrix4().makeRotationZ(Math.PI / 2)), 'brass', { seed: 12 }), 0.5));
  const mic = lathe(profile(0, -0.022).curve(0.022, 0, 0.022, -0.022, 4).curve(0, 0.022, 0.022, 0.022, 4), { segs: lo ? 10 : 12, band: 0 });
  const micM = chain(T(0.158, -0.108, 0.224), new Matrix4().makeRotationY(-0.9), Y_TO_Z);
  boom.add(setFinish(part('brass', transform(mic, micM), 'brass', { seed: 13, warm: 0.03 }), 0.55));
  const grille = lathe(profile(0.0225, -0.006).to(0.0235, -0.006, { fillet: 0.002 }).to(0.0235, 0.006, { fillet: 0.002 }).to(0.0225, 0.006).close(), { segs: lo ? 10 : 12, band: 0 });
  boom.add(part('rubber', transform(grille, micM), 'ink', { seed: 14, shade: 1.2 }));
}

// ---- arms -----------------------------------------------------------------------------

function buildArm(spine: NodeBuilder, s: 1 | -1, rest: Record<string, Matrix4>, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const nm = s > 0 ? 'L' : 'R';
  const arm = spine.node(`arm${nm}`, rest[`arm${nm}`]);
  const segs = lo ? 12 : 14;
  // the sleeve's upper half: a knit tube from a rounded shoulder cap (inside the body) to the elbow
  const ua = knots([[-UPPER_ARM - 0.03, 0.0], [-UPPER_ARM - 0.02, 0.04], [-UPPER_ARM, 0.056], [-0.08, 0.062], [-0.02, 0.066], [0.02, 0.06], [0.05, 0.03], [0.06, 0]]);
  const upper = rib(latheFn(ua, -UPPER_ARM - 0.03, 0.06, lo ? 7 : 8, segs), 7, () => 0.006);
  arm.add(felt(upper, KNIT, R, 0.02));
  const fore = arm.node(`forearm${nm}`, rest[`forearm${nm}`]);
  // the forearm, swelling into a chunky ribbed cuff
  const fa = knots([[-FOREARM - 0.012, 0], [-FOREARM - 0.006, 0.05], [-FOREARM + 0.002, 0.065], [-FOREARM + 0.04, 0.066], [-FOREARM + 0.05, 0.058], [-0.05, 0.056], [0.0, 0.058], [0.035, 0.045], [0.05, 0]]);
  const forearm = rib(latheFn(fa, -FOREARM - 0.012, 0.05, lo ? 7 : 9, segs), 7, (y) => (y < -FOREARM + 0.045 ? 0.009 : 0.005));
  fore.add(felt(forearm, KNIT, R, 0.02));
  // the paw: a dark felt mitten with three stitched finger lines and a thumb
  const paw = fore.node(`paw${nm}`, rest[`paw${nm}`]);
  const mitt = radialSolid((dx, dy, dz) => {
    const r = 1 / Math.sqrt((dx / 0.046) ** 2 + (dy / 0.058) ** 2 + (dz / 0.032) ** 2);
    const fingers = dy < -0.3 ? 1 + 0.07 * Math.max(0, Math.cos(dx * 16)) * -dy : 1;
    return r * fingers;
  }, [0, -0.044, 0.006], lo ? 12 : 14);
  paw.add(felt(mitt, PAW, R));
  const thumb = radialSolid((dx, dy, dz) => 1 / Math.sqrt((dx / 0.017) ** 2 + (dy / 0.028) ** 2 + (dz / 0.016) ** 2), [0, 0, 0], 10);
  paw.add(felt(transform(thumb, chain(T(-s * 0.036, -0.035, 0.016), new Matrix4().makeRotationZ(s * 0.6))), PAW, R));
  // the finger seams on the back of the paw
  for (const fx of [-0.015, 0.015]) {
    const pts = [new Vector3(fx, -0.068, 0.034), new Vector3(fx, -0.092, 0.024), new Vector3(fx, -0.1, 0.01)];
    const sl = stitchLine(pts, pts.map(() => new Vector3(0, -0.3, 1).normalize()), { pitch: 0.012, len: 0.009, w: 0.0013 });
    if (sl) paw.add(felt(sl, THREAD_LIGHT));
  }
}

// ---- the tail ---------------------------------------------------------------------------

function buildTail(b: NodeBuilder, rest: Record<string, Matrix4>, R: Rng, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const names = ['tail', 'tail2', 'tail3', 'tail4'] as const;
  const radii = [[0.06, 0.086], [0.09, 0.098], [0.098, 0.09], [0.088, 0.06]] as const;
  let node: NodeBuilder = b;
  // seam where it is sewn on: a ring of fur at the base
  for (let i = 0; i < 4; i++) {
    node = node.node(names[i]!, rest[names[i]!]);
    const L = TAIL.segs[i]!;
    const [r0, r1] = radii[i]!;
    const last = i === 3;
    // two sewn bands per segment, each a little puffed, pinched at the seams; ball ends tuck into the next
    const rOf = (y: number): number => {
      const base = r0 + (r1 - r0) * Math.min(1, Math.max(0, y / L));
      if (y < 0) {
        const d = 0.7 * r0;
        return Math.sqrt(Math.max(0, 1 - (y / d) ** 2)) * base * 0.88;
      }
      if (y > L) {
        const d = last ? 0.95 * r1 : 0.7 * r1;
        return Math.sqrt(Math.max(0, 1 - ((y - L) / d) ** 2)) * base * (last ? 1 : 0.88);
      }
      const u = (y / L) * 2; // two bands
      const f = u - Math.floor(u);
      const pinch = last && y > L * 0.5 ? 1 - 0.12 * Math.pow(1 - Math.sin(f * Math.PI), 3) * (f < 0.5 ? 1 : 0) : 1 - 0.12 * Math.pow(1 - Math.sin(f * Math.PI), 3);
      return base * pinch;
    };
    const y0 = -0.7 * r0, y1 = L + (last ? 0.95 * r1 : 0.7 * r1);
    const g = latheFn(rOf, y0, y1, lo ? 9 : 10, lo ? 11 : 12);
    // ring colours: segment i's two bands; the last segment ends in a dark tip
    colourBy(g, (_x, y) => {
      const band = Math.floor(Math.max(0, Math.min(1.999, (y / L) * 2)));
      const k = i * 2 + band;
      if (y < 0) return i % 2 === 0 ? FUR : FUR;
      return k % 2 === 0 ? FUR : RING;
    });
    node.add({ material: 'felt', geometry: g });
  }
}

// ---- catalogue --------------------------------------------------------------------------

const POSES = Object.fromEntries(EXPRESSION_NAMES.map((nm) => [nm, { pose: nm }]));

export const catalogue: CatalogueEntry[] = [
  {
    name: 'patch-felt',
    build: (opts = {}) => {
      const o: PatchFeltOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) o.pose = pose as ExpressionName;
      else if (pose && typeof pose === 'object') o.pose = pose as PatchPose;
      if (typeof opts['standIn'] === 'boolean') o.standIn = opts['standIn'];
      o.turn = typeof opts['turn'] === 'number' ? opts['turn'] : SIDE_ON;
      if (!o.pose) o.pose = 'unimpressed';
      return patchFelt(o);
    },
    poses: EXPRESSION_NAMES,
    variants: { ...POSES, front: { pose: 'unimpressed', turn: 0 }, low: { detail: 'low' } },
    camera: { distance: 4.2 },
    note: 'Patch, take A: the felt puppet. A sewn felt raccoon in a rib-knit cardigan and a brass headset, on a stand-in stool. ?pose=unimpressed|amused|the-look|working|checking',
  },
];

