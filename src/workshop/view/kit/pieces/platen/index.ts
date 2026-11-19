/**
 * The platen (REWRITE.md § B1 "the tray under the nozzle": changes a part's
 * colour and label by text; § B2 X1, X3; ART-P2 § 5 PLATEN). Registry name
 * `platen`.
 *
 * A small paint-and-label machine on a teal enamel base whose front slopes
 * up toward the visitor and carries the brass PLATEN jack plate. On the deck:
 * a steel turntable with a brass rim and four brass registration pins (it
 * seats an L crate or Fetch on its wheel) in a drip dish; behind it on the
 * left a column carrying a counterweighted arm that swings a brass gooseneck
 * nozzle from its drip pot over the tray and dips it; on the right a cream
 * enamel paint tank with a sight tube that shows the paint about to be used,
 * a pressure gauge and a hand wheel on its outlet valve, feeding the column
 * through a canvas hose; in front of the tank a tape head on brass rails that
 * runs in and presses a strip of label tape onto the part. The station lamp
 * is on the column; a cloth conduit leaves the jack plate for the
 * switchboard.
 *
 * Moving nodes (pose.ts `posePlaten`; node transforms only):
 *  - `tray`: turns about +Y (its pivot is the turntable's centre on the deck).
 *  - `arm`: yaw about +Y (parked → over) and pitch of the beam (dip); pivot at the column top.
 *  - `nozzle` (child of `arm`): counter-pitches so the gooseneck stays plumb.
 *  - `nozzle.paint` (child of `nozzle`): the stream, pivot at the tip, scaled along Y.
 *  - `tapehead`: slides along -X toward the tray. `tapehead.tape`: the strip, scaled.
 *  - `sight.paint`: the column of paint in the sight tube, scaled along Y (the level).
 *  - `gauge.needle`: turns about its local +Y (out of the dial).
 *  - `handwheel`: turns about its local +Y.
 *  - `lamp.lit` / `lamp.unlit`: the station lamp (scale swap).
 * Sockets (root space, rest pose): `seat` (the tray's top centre, +Y up),
 * `nozzle.tip` (parked), `tapehead.face` (the roller's contact line at rest,
 * +X out of it toward the tray is -X), `jack` (the conduit's jack on the
 * plate), `conduit` (where the conduit goes into the bench), `lamp`, `plate`.
 * `nozzleTip(pose)` and `tapeFace(pose)` give those two in any pose.
 */
import { CatmullRomCurve3, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { extrude, lathe, profiledBox, roundedBox, slab, torus } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { curvePath, polylinePath, sweep } from '../../sweep.ts';
import { aim, chain, mat, noShadow, part, piece, place, texturedPart, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, hexHead, ridgedBand, sheet, stud } from '../../cheap.ts';
import { paints, type Token } from '../../../palette.ts';
import { BEAM, PLATEN, YAW_IDLE } from './dims.ts';
import { estimateLabels, PLATE_LEAN_DEG, platenLabels } from './labels.ts';
import type { PlatenLabelRefs } from './labels.ts';
import { HIDDEN, NAMED_POSES, posePiece, POSE, REST } from './pose.ts';
import type { PlatenPose } from './pose.ts';
import { PAINT_BASE, paintPiece, registerPaint } from './paint.ts';
import { loadParts } from './load.ts';
import { crateLabels } from '../crate/index.ts';
import type { Labels } from '../../../types.ts';
import type { Load } from './load.ts';

export { posePlaten, posePiece, POSE, NAMED_POSES, REST, HIDDEN } from './pose.ts';
export type { PlatenPose } from './pose.ts';
export { setPaint, paintPiece, PAINT_NODES } from './paint.ts';
export { platenLabels, PLATE_TEXT, PLATE_CAP } from './labels.ts';
export type { PlatenLabelRefs } from './labels.ts';
export { PLATEN, REACH, BEAM, YAW_IDLE, YAW_OVER } from './dims.ts';

const DEG = Math.PI / 180;
const Ry = (a: number): Matrix4 => new Matrix4().makeRotationY(a);
const Rx = (a: number): Matrix4 => new Matrix4().makeRotationX(a);
const Rz = (a: number): Matrix4 => new Matrix4().makeRotationZ(a);

export interface PlatenOptions extends KitOptions {
  /** Label ref from `platenLabels(labels)`. Without it the plate is blank brass (clay reviews, tests). */
  labels?: PlatenLabelRefs;
  /** The paint about to be used (sight tube and stream). Default `paint-blue`. */
  paint?: Token;
  /** Build already posed (a name from NAMED_POSES, or a pose). Idle is the default. */
  pose?: string | PlatenPose;
  /** Something on the tray, for review pictures: an L crate, or a 1.25-unit stand-in robot. Rides the tray. */
  load?: Load;
  /** For `load: 'crate'`: crate options passed through (the stencil needs its labels). */
  crateStencil?: boolean;
  /** For `load: 'crate'`: the crate's paint. */
  cratePaint?: Token | null;
}

/** A dent that keeps the solid's wear and cavity. */
function dentKeep(g: BufferGeometry, at: [number, number, number], dir: [number, number, number], r: number, d: number): void {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const nx = dir[0] / l, ny = dir[1] / l, nz = dir[2] / l;
  deform(g, (x, y, z) => {
    const q = Math.hypot(x - at[0], y - at[1], z - at[2]) / r;
    if (q >= 1) return [x, y, z];
    const w = (1 - q * q) * (1 - q * q) * d;
    return [x - nx * w, y - ny * w, z - nz * w];
  }, { keepSurf: true });
}

const v3 = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

/** Zero the wear channel (wet paint, glass: nothing to chip). */
function noWear(g: BufferGeometry): BufferGeometry {
  const s = g.getAttribute('surf');
  for (let i = 0; i < s.count; i++) s.setX(i, 0);
  s.needsUpdate = true;
  return g;
}

export function platen(o: PlatenOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('platen', { detail, seed });
  const turned = (pr: ReturnType<typeof profile>, segs: number, caps: boolean | 'start' | 'end' = true): BufferGeometry => lathe(pr, { detail, band: 0, segs: hi ? Math.max(6, Math.round(segs * 0.72)) : Math.max(6, Math.round(segs * 0.55)), caps });

  const C = PLATEN.console;
  const W = C.x1 - C.x0, CX = (C.x0 + C.x1) / 2;
  const zFB = PLATEN.zFrontFoot, zFT = PLATEN.zFrontTop, zBack = PLATEN.zBack;
  const yF = PLATEN.flangeY, yC0 = PLATEN.bodyY, yTop = PLATEN.deckY;
  const zMid = (zFB + zBack) / 2;
  const lean = Math.atan2(zFB - zFT, yTop - yC0);
  const zFront = (y: number): number => zFB - (y - yC0) * Math.tan(lean);
  /** A frame on the console's sloped front at (x, y), +Z out of the slope, +Y up it. */
  const front = (x: number, y: number, out = 0): Matrix4 => chain(T(x, y, zFront(y) + out / Math.cos(lean)), Rx(-lean));
  const TR = PLATEN.tray;

  // ======================================================================
  // LARGE: the turntable's round plinth at the front-left, open on two sides
  // (its cast foot flares to PLATEN.plinth.foot from the seat); the console
  // to its right, its front sloping up toward the visitor, carrying the
  // column, the tank and the plates
  // ======================================================================
  {
    const P = PLATEN.plinth, r = P.r, fl = P.foot - P.r;
    const g = profiledBox(
      { w: 2 * r, d: 2 * r, rPlan: r, detail: 'low', band: 0 },
      profile(0, 0).to(r + fl, 0, { sharp: true }).to(r + fl, 0.03, { fillet: 0.012, segs: 1 }).to(r + 0.012, 0.075, { fillet: 0.03, segs: 1 }).to(r, 0.12, { sharp: true }).to(r, yTop - 0.03, { smooth: true }).to(r - 0.03, yTop, { fillet: 0.03, segs: 1 }).to(0, yTop),
    );
    transform(g, T(TR.x, 0, TR.z));
    dentKeep(g, [TR.x - 0.25, 0.3, TR.z + r * 0.97], [0.3, 0, 1], 0.08, 0.01);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 4, shade: 1.0, jitter: 0.03 }));
  }
  {
    const r = 0.16;
    const g = profiledBox(
      { w: W + 0.18, d: zFB - zBack + 0.18, rPlan: r, detail: 'low', band: 0 },
      profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.04, { fillet: 0.014, segs: 1 }).to(r - 0.09, 0.05, { fillet: 0.018, segs: 1 }).to(r - 0.11, yF, { sharp: true }).to(0, yF),
    );
    transform(g, T(CX, 0, zMid));
    b.add(part('steel', g, 'teal-panel', { seed, shade: 0.82, jitter: 0.03 }));
  }
  {
    const outline: Array<[number, number]> = [[-zFB, yC0], [-zFT, yTop], [-zBack - 0.02, yTop], [-zBack, yC0]];
    const g = extrude(outline, W, { radius: [0.03, 0.08, 0.06, 0.03], bevel: 0.04, segs: 2, detail, band: 0 });
    transform(g, chain(T(C.x0, 0, 0), Ry(Math.PI / 2)));
    dentKeep(g, [C.x1 - 0.05, yC0 + 0.12, zFB - 0.08], [-1, 0, -1], 0.08, 0.012);
    dentKeep(g, [C.x1 - 0.5 + R.spread(0.1), yTop - 0.01, zFT - 0.02], [0, 1, -1], 0.07, 0.009);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 1, shade: 1.1, jitter: 0.03 }));
  }

  // ======================================================================
  // THE TRAY: a drip dish on the deck, the turntable (node `tray`) in it
  // ======================================================================
  {
    const dr = TR.dishR;
    const g = turned(profile(dr - 0.01, 0).to(dr, 0.066, { sharp: true }).to(dr - 0.024, 0.066, { sharp: true }).to(dr - 0.03, 0.016, { sharp: true }).to(0, 0.016), hi ? 28 : 20, 'end');
    b.add(part('steel', transform(g, T(TR.x, yTop, TR.z)), 'steel', { seed: seed + 3, shade: 0.55 }));
    // years of overspray in the dish's floor, between the platter's rim and the dish wall
    for (let i = 0; i < 3; i++) {
      const a = R.range(0, Math.PI * 2), rr = R.range(TR.r + 0.008, dr - 0.03);
      const s = R.range(0.02, 0.035);
      const g2 = transform(stud(s, 0.004, 7), chain(T(TR.x + Math.cos(a) * rr, yTop + 0.016, TR.z + Math.sin(a) * rr), Ry(-a), new Matrix4().makeScale(R.range(1, 2), 1, 1)));
      b.add(setFinish(part('steel', noWear(g2), R.pick(paints), { seed: seed + 60 + i, shade: 0.8 }), 0.6));
    }
  }
  const tray = b.node('tray', chain(T(TR.x, yTop, TR.z), askew(seed + 5, 0.4)));
  {
    const rp = TR.r - 0.03; // the steel platter inside the brass rim
    const yT = TR.seatY;
    // the steel platter (its spindle is hidden under it)
    const plat = turned(profile(rp, yT - 0.02).to(rp, yT, { sharp: true }).to(0.26, yT).to(0, yT), hi ? 26 : 20, 'end');
    part('steel', noWear(plat), 'steel', { seed: seed + 7, shade: 0.72 });
    // a darker worn centre where parts are set down and turned: a radial fall of the vertex colour
    {
      const pos = plat.getAttribute('position'), col = plat.getAttribute('color');
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        const k = r < 0.26 ? 0.5 + 0.5 * Math.pow(r / 0.26, 1.5) : 1;
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k * 0.95);
      }
    }
    tray.add(setFinish({ material: 'steel', geometry: plat }, 0.5));
    // three scribed rings
    for (const rr of [0.15, 0.3, 0.42]) tray.add(part('steel', noWear(turned(profile(rr + 0.005, yT + 0.0012).to(rr - 0.005, yT + 0.0012), hi ? 26 : 20, false)), 'steel', { shade: 0.4 }));
    // the brass rim, its knurled edge where a hand turns it
    const rim = turned(profile(rp - 0.004, 0.05).to(TR.r, 0.05, { sharp: true }).to(TR.r, 0.064, { sharp: true }).to(rp - 0.004, yT + 0.006), hi ? 26 : 20, false);
    tray.add(setFinish(part('brass', rim, 'brass', { seed: seed + 8, warm: 0.03 }), 0.4));
    tray.add(part('brass', transform(ridgedBand(TR.r + 0.002, yT - 0.068, hi ? 22 : 16, 0.009), T(0, 0.066, 0)), 'brass', { seed: seed + 9, shade: 0.9 }));
    // four brass registration pins on the axes, just outside an L crate's sides (it is 0.8 x 0.74)
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const rr = TR.r - 0.035;
      const pin = turned(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.02, { sharp: true }).to(0.026, 0.032, { sharp: true }).to(0.026, 0.105, { sharp: true }).to(0, 0.13), 6);
      tray.add(setFinish(part('brass', transform(pin, T(Math.cos(a) * rr, yT, Math.sin(a) * rr)), 'brass', { seed: seed + 10 + k }), 0.7));
    }
    // a centre cross scribed on the platter
    const mark = (x0: number, z0: number, x1: number, z1: number): KitPart => part('steel', bevelBox({ min: [x0, yT - 0.002, z0], max: [x1, yT + 0.0018, z1], c: 0, omit: ['ny'] }), 'ink', { shade: 1.4 });
    const t = 0.006;
    tray.add(mark(-0.07, -t, 0.07, t), mark(-t, -0.07, t, -t), mark(-t, t, t, 0.07));
    // splashes on the platter from what was painted on it before
    for (let i = 0; i < 3; i++) {
      const a = R.range(0, Math.PI * 2), rr = R.range(0.16, rp - 0.05);
      const s = R.range(0.018, 0.04);
      const g2 = transform(stud(s, 0.003, 7), chain(T(Math.cos(a) * rr, yT - 0.0005, Math.sin(a) * rr), Ry(R.range(0, 3)), new Matrix4().makeScale(R.range(1, 1.8), 1, 1)));
      tray.add(setFinish(part('steel', noWear(g2), R.pick(paints), { seed: seed + 70 + i, shade: 0.85 }), 0.5));
    }
    // the strip of label tape the head lays on an L crate's top front batten, left to right (the pose pays it out)
    {
      const L = PLATEN.label;
      const strip = tray.node('label.strip', chain(T(L.x0, yT + L.y, L.z), new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)));
      strip.add(part('rubber', transform(sheet({ w: L.x1 - L.x0, h: L.h, t: 0.003, nx: 1, ny: 1 }), T((L.x1 - L.x0) / 2, 0, 0)), 'ink', { shade: 1.3 }));
    }
    if (o.load) tray.node('load', T(0, yT, 0)).add(loadParts(o.load, { seed, ...(o.crateStencil ? { stencil: true } : {}), paint: o.cratePaint ?? null }));
  }

  // ======================================================================
  // THE COLUMN and THE ARM: a cast pedestal that tapers to a bright slide;
  // the arm's sleeve rides it (dip) and turns on it (swing)
  // ======================================================================
  const PX = PLATEN.pillar.x, PZ = PLATEN.pillar.z, PY = PLATEN.pivotY;
  const colTop = PY + 0.17;
  const sleeveLo = -0.2; // the sleeve's foot, in the arm's frame
  const stopY = PY + sleeveLo - POSE.dipDrop; // where the sleeve sits at full dip
  const colR = (y: number): number => 0.16 - ((y - yTop) / (stopY - yTop)) * 0.05; // the pedestal's radius at height y
  {
    // a bolted cast foot flaring into the pedestal
    const foot = turned(profile(0, 0).to(0.235, 0, { sharp: true }).to(0.235, 0.035, { fillet: 0.012, segs: 1 }).to(0.185, 0.08, { fillet: 0.05, segs: 2 }).to(colR(yTop + 0.2) + 0.005, 0.2, { sharp: true }).to(0, 0.2), 16, 'end');
    b.add(part('steel', transform(foot, T(PX, yTop, PZ)), 'teal-panel', { seed: seed + 20, shade: 1.0 }));
    // the pedestal: tapering, a cast rib-band two thirds up, a chamfered head where the slide comes out
    const lower = turned(profile(colR(yTop + 0.18), 0.18).to(colR(stopY - 0.4), stopY - yTop - 0.4, { smooth: true }).to(colR(stopY - 0.4) + 0.02, stopY - yTop - 0.36, { sharp: true }).to(colR(stopY - 0.4) + 0.02, stopY - yTop - 0.3, { sharp: true }).to(colR(stopY), stopY - yTop - 0.26, { sharp: true }).to(colR(stopY), stopY - yTop - 0.05, { smooth: true }).to(0.085, stopY - yTop, { fillet: 0.02, segs: 1 }).to(0, stopY - yTop), 14, false);
    b.add(part('steel', transform(lower, T(PX, yTop, PZ)), 'teal-panel', { seed: seed + 21, shade: 1.15 }));
    const slide = turned(profile(0.085, 0).to(0.085, colTop - stopY - 0.03, { smooth: true }).to(0.1, colTop - stopY - 0.02, { fillet: 0.01, segs: 1 }).to(0.1, colTop - stopY + 0.02, { fillet: 0.014, segs: 1 }).to(0, colTop - stopY + 0.035), 12, false);
    b.add(setFinish(part('steel', noWear(transform(slide, T(PX, stopY, PZ))), 'steel', { seed: seed + 25, shade: 1.1 }), 0.7));
    // the brass stop collar the sleeve lands on
    const c = turned(profile(0.1, 0).to(0.125, 0.004, { sharp: true }).to(0.125, 0.05, { sharp: true }).to(0.085, 0.055), 12, false);
    b.add(setFinish(part('brass', transform(c, T(PX, stopY - 0.055, PZ)), 'brass', { seed: seed + 22 }), 0.5));
    for (let k = 0; k < 3; k++) {
      const a = (k + 0.25) * ((Math.PI * 2) / 3);
      b.small(() => part('steel', transform(hexHead(0.08, 0.04, R.range(0, 1)), T(PX + Math.cos(a) * 0.2, yTop + 0.025, PZ + Math.sin(a) * 0.2)), 'steel', { seed: seed + 24 + k }));
    }
  }

  // the arm: built along its local +X (the beam), pivot at the origin
  const arm = b.node('arm', chain(T(PX, PY, PZ), Ry(YAW_IDLE)));
  const tail = 0.5;
  const bz0 = 0.1, bz1 = 0.18, bh = 0.095;
  {
    // the sleeve: a stout turned collar round the slide; it turns and slides with the arm
    const sl = turned(profile(0.09, sleeveLo).to(0.17, sleeveLo, { sharp: true }).to(0.175, sleeveLo + 0.03, { fillet: 0.012, segs: 1 }).to(0.16, 0.05, { smooth: true }).to(0.165, 0.08, { fillet: 0.012, segs: 1 }).to(0.09, 0.085), 14, false);
    arm.add(part('steel', sl, 'teal-panel', { seed: seed + 30, shade: 1.05 }));
    // a brass locking handle on the sleeve's front: the hand that sets the height goes here
    arm.add(setFinish(part('brass', transform(turned(profile(0, 0).to(0.016, 0, { sharp: true }).to(0.016, 0.1).to(0.034, 0.118, { fillet: 0.014, segs: 1 }).to(0, 0.155), 8), aim([0, -0.12, 0.16], [0.2, 0.1, 1])), 'brass', { seed: seed + 29 }), 0.7));
    // the beam: two deep flat bars straddling the column, tied by a nose block; the gooseneck drops between them
    for (const s of [-1, 1]) {
      arm.add(part('steel', grain(bevelBox({ min: [-tail, -bh, s > 0 ? bz0 : -bz1], max: [PLATEN.beamEnd - 0.02, bh, s > 0 ? bz1 : -bz0], c: 0.02, wear: 0.8 }), 'x'), 'teal-panel', { seed: seed + 33 + s, shade: 1.2 }));
    }
    arm.add(part('steel', grain(bevelBox({ min: [PLATEN.beamEnd - 0.1, -bh - 0.01, -bz0], max: [PLATEN.beamEnd + 0.02, bh + 0.01, bz0], c: 0.025, wear: 0.9 }), 'x'), 'teal-panel', { seed: seed + 32, shade: 1.1 }));
    arm.small(() => place([part('steel', stud(0.022, 0.012, 6), 'steel', { seed: seed + 31 })], chain(T(0.26, 0, bz1 + 0.001), Rx(Math.PI / 2))));
    // the counterweight on the tail: a big cast block, bevelled, a brass nut on its end
    {
      const g = bevelBox({ min: [-tail - 0.06, -0.19, -0.2], max: [-tail + 0.26, 0.14, 0.2], c: 0.05, wear: 0.95 });
      arm.add(part('steel', g, 'ink', { seed: seed + 34, shade: 2.3 }));
      arm.add(setFinish(part('brass', transform(hexHead(0.11, 0.045, 0.3), chain(T(-tail - 0.06, -0.02, 0), Rz(Math.PI / 2))), 'brass', { seed: seed + 35 }), 0.6));
    }
    // the hose along the beam's top, out of the sleeve to the gooseneck
    {
      const hz = (bz0 + bz1) / 2, hy = bh + 0.028;
      const pts = [new Vector3(0.1, hy - 0.05, -hz), new Vector3(0.22, hy, -hz), new Vector3(BEAM - 0.25, hy, -hz), new Vector3(BEAM - 0.1, hy + 0.01, -0.03), new Vector3(BEAM - 0.02, 0.07, 0)];
      arm.add(part('rubber', sweep(curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), 9), { radius: 0.03, segs: 5, ends: 'flat', detail }), 'wood-light', { seed: seed + 36, shade: 0.75 }));
      arm.add(setFinish(part('brass', transform(turned(profile(0, 0).to(0.042, 0, { fillet: 0.006, segs: 1 }).to(0.042, 0.05, { fillet: 0.006, segs: 1 }).to(0, 0.05), 8), aim([0.09, hy - 0.08, -hz], [1, 0.4, 0])), 'brass', { seed: seed + 38 }), 0.5));
    }
  }

  // the nozzle: a brass gooseneck off the beam's end, plumb, ending in a spray bell
  const nozzle = arm.node('nozzle', T(BEAM, 0, 0));
  const G = PLATEN.goose;
  const tipY = -G.drop;
  {
    const neck = sweep(polylinePath([[0.0, 0.07, 0], [G.out, 0.07, 0], [G.out, tipY + 0.17, 0]], 0.08, hi ? 4 : 3), { radius: 0.03, segs: hi ? 7 : 6, ends: 'flat', detail });
    nozzle.add(setFinish(part('brass', neck, 'brass', { seed: seed + 41, warm: 0.03 }), 0.75));
    // the bell: a knurled collar, then a flared funnel open at the bottom, its rim rolled
    const tipM = T(G.out, tipY, 0);
    const bell = turned(profile(0.05, 0.004).to(0.095, 0, { fillet: 0.01, segs: 1 }).to(0.088, 0.01, { sharp: true }).curve(0.045, 0.1, 0.05, 0.03, 3).to(0.04, 0.17, { smooth: true }).to(0, 0.17), 14);
    nozzle.add(setFinish(part('brass', transform(bell, tipM), 'brass', { seed: seed + 42 }), 0.85));
    nozzle.add(part('brass', transform(ridgedBand(0.046, 0.045, hi ? 12 : 9, 0.007), chain(tipM, T(0, 0.115, 0))), 'brass', { seed: seed + 43, shade: 0.85 }));
    // the spray: a cone of paint out of the bell's mouth, long enough to reach an S crate's lid from the full dip (into an L crate's lid it is hidden); the pose scales it down from the mouth
    const stream = turned(profile(0, -0.58).to(0.078, -0.574, { fillet: 0.024, segs: 1 }).to(0.068, -0.48, { smooth: true }).to(0.05, 0.004, { smooth: true }).to(0, 0.004), 10);
    const pn = nozzle.node('nozzle.paint', chain(tipM, new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)));
    pn.add(setFinish(part('steel', noWear(stream), PAINT_BASE), 0.55));
  }

  // ======================================================================
  // THE TAPE HEAD: a carriage on the beam's front bar beside the nozzle,
  // its reel of black tape facing the visitor; a sprung ram drops a rubber
  // roller onto the part's top front edge and the carriage runs it left to
  // right, laying the tape behind it
  // ======================================================================
  const LH = PLATEN.labelHead;
  const head = arm.node('tapehead', T(LH.start, 0, 0));
  {
    // built on the beam's -Z side: z values are negated (zs) and boxes take their z extent through zr
    const zr = (a: number, b2: number): [number, number] => [-Math.max(a, b2), -Math.min(a, b2)];
    const box = (x0: number, y0: number, za: number, x1: number, y1: number, zb: number, c: number, wear?: number): BufferGeometry => {
      const [z0, z1] = zr(za, zb);
      return bevelBox({ min: [x0, y0, z0], max: [x1, y1, z1], c, ...(wear !== undefined ? { wear } : {}) });
    };
    const cz = bz1 + 0.005;
    // the carriage: a block hooked over the front bar, a lip on top
    head.add(part('steel', box(-0.085, -bh - 0.03, cz, 0.085, bh + 0.02, cz + 0.11, 0.025, 0.9), 'tape-yellow', { seed: seed + 84, shade: 0.9, jitter: 0.03 }));
    head.add(part('steel', box(-0.085, bh, bz0 + 0.01, 0.085, bh + 0.03, cz + 0.02, 0.01), 'tape-yellow', { seed: seed + 85, shade: 0.8 }));
    // the bracket out to the ram's guide, and the guide
    head.add(part('steel', box(-0.03, -0.06, cz + 0.08, 0.03, 0.0, -LH.z + 0.03, 0.015), 'tape-yellow', { seed: seed + 86, shade: 0.85 }));
    head.add(setFinish(part('brass', transform(turned(profile(0.024, 0).to(0.034, 0, { sharp: true }).to(0.034, 0.14, { fillet: 0.008, segs: 1 }).to(0.024, 0.15), 10, false), T(LH.out, -0.2, LH.z)), 'brass', { seed: seed + 87 }), 0.6));
    // the reel: a spool of black tape on a brass hub on the carriage's outer face, turning as it pays out
    const reel = head.node('tapehead.reel', chain(T(-0.01, -0.01, -(cz + 0.11)), Rx(-Math.PI / 2)));
    reel.add(part('rubber', turned(profile(0.04, 0).to(0.11, 0, { sharp: true }).to(0.11, 0.05, { sharp: true }).to(0.04, 0.05), 16, false), 'ink', { seed: seed + 88 }));
    reel.add(setFinish(part('brass', transform(turned(profile(0, -0.004).to(0.125, -0.004, { sharp: true }).to(0.125, 0.004, { sharp: true }).to(0, 0.004), 16, 'end'), T(0, 0.054, 0)), 'brass', { seed: seed + 89 }), 0.5));
    reel.add(setFinish(part('brass', bevelBox({ min: [-0.012, 0.055, -0.1], max: [0.012, 0.064, 0.1], c: 0 }), 'brass', { seed: seed + 90 }), 0.7));
    reel.add(setFinish(part('brass', turned(profile(0, 0).to(0.038, 0, { sharp: true }).to(0.038, 0.07, { fillet: 0.012, segs: 1 }).to(0, 0.078), 8), 'brass', { seed: seed + 91 }), 0.8));
    // the ram: a brass rod out of the guide, a fork and the rubber roller (axis across the part)
    // the ram: a two-stage telescope. The outer tube (`tapehead.ram`) slides in the guide, standing up
    // through the carriage when it is in; the inner rod (`tapehead.ram.inner`) runs out of the tube with
    // the fork and the rubber roller (axis across the part). Together they reach a crate's lid from the
    // arm's full height, so the label needs no dip.
    const ram = head.node('tapehead.ram', T(LH.out, 0, LH.z));
    ram.add(setFinish(part('brass', turned(profile(0, -0.4).to(0.026, -0.4, { fillet: 0.006, segs: 1 }).to(0.026, 0.25, { smooth: true }).to(0.032, 0.26, { sharp: true }).to(0.032, 0.28, { fillet: 0.006, segs: 1 }).to(0, 0.28), 10), 'brass', { seed: seed + 92 }), 0.85));
    const inner = ram.node('tapehead.ram.inner');
    inner.add(setFinish(part('steel', noWear(turned(profile(0.015, 0.12).to(0.015, -LH.hang + 0.08, { smooth: true }).to(0, -LH.hang + 0.08), 8, false)), 'steel', { seed: seed + 96, shade: 1.2 }), 0.8));
    inner.add(part('brass', bevelBox({ min: [-0.03, -LH.hang + 0.05, -0.075], max: [0.03, -LH.hang + 0.085, 0.075], c: 0.008 }), 'brass', { seed: seed + 93 }));
    for (const sg of [-1, 1]) inner.add(part('brass', bevelBox({ min: [-0.02, -LH.hang + 0.02, sg * 0.066 - 0.008], max: [0.02, -LH.hang + 0.06, sg * 0.066 + 0.008], c: 0 }), 'brass', { seed: seed + 94 }));
    inner.add(part('rubber', transform(turned(profile(0, -0.055).to(0.05, -0.055, { fillet: 0.012, segs: 1 }).to(0.05, 0.055, { fillet: 0.012, segs: 1 }).to(0, 0.055), 10), chain(T(0, -LH.hang + 0.05, 0), Rx(Math.PI / 2))), 'ink', { seed: seed + 95 }));
  }

  // ======================================================================
  // THE TANK: cream enamel, teal bands, on a ring stand
  // ======================================================================
  const TK = PLATEN.tank;
  const tk0 = yTop + 0.1, tkH = 0.82;
  {
    const r = TK.r;
    // the stand: a ring with three stubby feet
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const fx = TK.x + Math.cos(a) * (r - 0.06), fz = TK.z + Math.sin(a) * (r - 0.06);
      b.add(part('steel', bevelBox({ min: [fx - 0.04, yTop, fz - 0.04], max: [fx + 0.04, yTop + 0.11, fz + 0.04], c: 0.012, omit: ['ny'] }), 'teal-panel', { seed: seed + 50, shade: 0.7 }));
    }
    const body = turned(
      profile(0, 0).to(r - 0.04, 0, { sharp: true }).to(r, 0.04, { fillet: 0.03, segs: 2 }).to(r, tkH - 0.1, { smooth: true }).cubic(0.09, tkH + 0.08, r, tkH + 0.02, 0.17, tkH + 0.08, hi ? 4 : 3).to(0, tkH + 0.08),
      hi ? 20 : 14,
    );
    transform(body, T(TK.x, tk0, TK.z));
    dentKeep(body, [TK.x + 0.18, tk0 + 0.35, TK.z + 0.18], [-1, 0, -1], 0.08, 0.01);
    b.add(part('steel', body, 'paper', { seed: seed + 51, shade: 0.88, jitter: 0.02 }));
    // a teal band round its shoulder
    for (const [y, h] of [[tkH - 0.16, 0.07]] as const) {
      const band = turned(profile(r - 0.002, 0).to(r + 0.012, 0.006, { sharp: true }).to(r + 0.012, h - 0.006, { sharp: true }).to(r - 0.002, h), hi ? 20 : 14, false);
      b.add(part('steel', transform(band, T(TK.x, tk0 + y, TK.z)), 'teal-light', { seed: seed + 52, shade: 0.9 }));
    }
    // the filler cap on top: brass, knurled
    const capM = T(TK.x, tk0 + tkH + 0.08, TK.z);
    b.add(setFinish(part('brass', transform(turned(profile(0, 0).to(0.075, 0, { sharp: true }).to(0.075, 0.02, { sharp: true }).to(0.06, 0.03).to(0.06, 0.07, { fillet: 0.01, segs: 1 }).to(0, 0.075), 12), capM), 'brass', { seed: seed + 53 }), 0.5));
    b.add(part('brass', transform(ridgedBand(0.064, 0.035, 14, 0.008), chain(capM, T(0, 0.032, 0))), 'brass', { seed: seed + 54, shade: 0.85 }));
  }

  // the sight tube on the tank's front-left, facing the visitor
  const sightDir = new Vector3(-0.12, 0, 1).normalize();
  const sx = TK.x + sightDir.x * (TK.r + 0.08), sz = TK.z + sightDir.z * (TK.r + 0.08);
  const st0 = tk0 + 0.14, st1 = tk0 + tkH - 0.2;
  {
    const face = Math.atan2(sightDir.x, sightDir.z);
    // the dark glass and the brass fittings top and bottom, each with a stub into the tank
    const fitting = (y: number, up: boolean): KitPart[] => {
      const f = turned(profile(0, 0).to(0.058, 0, { fillet: 0.01, segs: 1 }).to(0.058, 0.06, { fillet: 0.01, segs: 1 }).to(0, 0.06), 9);
      const stub = turned(profile(0, 0).to(0.024, 0, { sharp: true }).to(0.024, 0.08).to(0, 0.08), 6);
      return [
        setFinish(part('brass', transform(f, T(sx, up ? y : y - 0.06, sz)), 'brass', { seed: seed + 56 }), 0.55),
        part('brass', transform(stub, aim([sx, y - 0.03, sz], [-sightDir.x, 0, -sightDir.z])), 'brass', { seed: seed + 57, shade: 0.8 }),

      ];
    };
    // the dark glass between them
    b.add(setFinish(part('steel', noWear(transform(turned(profile(0.038, 0).to(0.038, st1 - st0, { smooth: true }), 10, false), T(sx, st0, sz))), 'teal-deep', { seed: seed + 55, shade: 0.7 }), 1));
    b.add(fitting(st0, false), fitting(st1, true));
    // a dark enamel strip on the tank behind the tube, so any paint (cream too) reads against it
    b.add(part('steel', bevelBox({ min: [-0.075, st0 - 0.07, -0.02], max: [0.075, st1 + 0.07, 0.012], c: 0.012, omit: ['nz'] }), 'teal-deep', { seed: seed + 54, shade: 1.3 }));
    transform(b.parts[b.parts.length - 1]!.geometry, chain(T(TK.x + sightDir.x * (TK.r + 0.005), 0, TK.z + sightDir.z * (TK.r + 0.005)), Ry(face)));
    // two guard rods in front of the glass
    for (const s of [-1, 1]) {
      const off = new Vector3(Math.cos(face), 0, -Math.sin(face)).multiplyScalar(s * 0.05);
      const p0: [number, number, number] = [sx + off.x + sightDir.x * 0.018, st0 - 0.01, sz + off.z + sightDir.z * 0.018];
      const p1: [number, number, number] = [p0[0], st1 + 0.01, p0[2]];
      b.add(setFinish(part('brass', sweep(polylinePath([p0, p1], 0, 1), { radius: 0.007, segs: 5, ends: 'flat', detail }), 'brass', { seed: seed + 59 }), 0.6));
    }
    // the paint column inside: its own node, scaled along Y for the level
    const col = turned(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.97, { fillet: 0.012, segs: 1 }).to(0.028, 1).to(0, 0.99), 10, 'end');
    transform(col, new Matrix4().makeScale(1, (st1 - st0 - 0.01) * REST.level, 1));
    b.node('sight.paint', T(sx, st0 + 0.005, sz)).add(setFinish(part('steel', noWear(col), PAINT_BASE), 0.55));
  }

  // the pressure gauge on the tank's front-right shoulder, its face turned up toward the visitor
  const gaugeDir = new Vector3(0.5, 0, 1).normalize();
  {
    const gy = tk0 + tkH - 0.1;
    const base = new Vector3(TK.x + gaugeDir.x * TK.r, gy, TK.z + gaugeDir.z * TK.r);
    const n = gaugeDir.clone().multiplyScalar(Math.cos(28 * DEG)).add(new Vector3(0, Math.sin(28 * DEG), 0)).normalize();
    // a short brass stem out of the tank, then the gauge body facing n
    b.add(part('brass', transform(turned(profile(0, 0).to(0.025, 0, { sharp: true }).to(0.025, 0.08).to(0, 0.08), 8), aim(base.toArray() as [number, number, number], gaugeDir.toArray() as [number, number, number])), 'brass', { seed: seed + 60 }));
    const c = base.clone().addScaledVector(gaugeDir, 0.1);
    const gm = aim(c.toArray() as [number, number, number], n.toArray() as [number, number, number]);
    const gr = 0.11;
    const bez = turned(profile(gr - 0.01, -0.03).to(gr, 0.004, { fillet: 0.012, segs: 1 }).to(gr - 0.016, 0.024, { sharp: true }).to(gr - 0.02, 0.006), hi ? 18 : 12, false);
    b.add(setFinish(part('brass', transform(bez, gm), 'brass', { seed: seed + 61, warm: 0.03 }), 0.6));
    // the dial: cream enamel, ticks and a red sector
    const dial = turned(profile(0, 0.006).to(gr - 0.02, 0.006, { sharp: true }).to(0, 0.007), hi ? 18 : 12, false);
    b.add(setFinish(part('steel', noWear(transform(dial, gm)), 'paper', { seed: seed + 62, shade: 0.95 }), 0.3));
    const ticks: KitPart[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = (-120 + k * 30) * DEG;
      const long = k % 2 === 0;
      const r0 = gr - 0.036 - (long ? 0.014 : 0), r1 = gr - 0.03;
      const tw = long ? 0.004 : 0.0028;
      const g = bevelBox({ min: [-tw, 0.0068, r0], max: [tw, 0.0078, r1], c: 0, omit: ['ny'] });
      ticks.push(part('steel', noWear(transform(g, chain(gm, Ry(Math.PI - a)))), k >= 7 ? 'cable-red' : 'ink', { shade: 1.2 }));
    }
    b.add(ticks);
    // the needle and its hub (node: turns about its local +Y, the dial's normal)
    const needle = b.node('gauge.needle', chain(gm, T(0, 0.008, 0), Ry(-(REST.pressure * 2 - 1) * POSE.gaugeSweepDeg * DEG)));
    needle.add(part('steel', bevelBox({ min: [-0.0045, 0, -0.012], max: [0.0045, 0.004, gr - 0.032], c: 0, omit: ['ny'] }), 'cable-red', { shade: 1.1 }));
    needle.add(setFinish(part('brass', turned(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.006, { fillet: 0.003, segs: 1 }).to(0, 0.008), 8), 'brass', { seed: seed + 63 }), 0.8));
    // a dome of glass would wash out under the lamp: the dial stays open behind the bezel
  }

  // the outlet valve on the tank's left, low, its hand wheel on top; the canvas hose to the column
  const valve = new Vector3(TK.x - TK.r - 0.07, tk0 + 0.2, TK.z - 0.04);
  {
    const vb = turned(profile(0, -0.06).to(0.045, -0.06, { fillet: 0.01, segs: 1 }).to(0.045, 0.06, { fillet: 0.01, segs: 1 }).to(0, 0.06), 10);
    b.add(setFinish(part('brass', transform(vb, T(valve.x, valve.y, valve.z)), 'brass', { seed: seed + 64 }), 0.4));
    const stub = turned(profile(0, 0).to(0.026, 0, { sharp: true }).to(0.026, 0.1).to(0, 0.1), 8);
    b.add(part('brass', transform(stub, aim([valve.x, valve.y, valve.z], [1, 0, 0])), 'brass', { seed: seed + 65, shade: 0.8 }));
    b.add(part('brass', transform(turned(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.09).to(0, 0.09), 6), T(valve.x, valve.y + 0.05, valve.z)), 'brass', { seed: seed + 66, shade: 0.7 }));
    // the hand wheel: a rim, four spokes, a hub, a knob for a thumb
    const wheel = b.node('handwheel', T(valve.x, valve.y + 0.14, valve.z));
    const wr = 0.1;
    wheel.add(setFinish(part('brass', torus({ R: wr, r: 0.015, segs: hi ? 10 : 8, tubeSegs: 4, detail, band: 0 }), 'brass', { seed: seed + 67 }), 0.6));
    for (let k = 0; k < 3; k++) wheel.add(part('brass', transform(grain(bevelBox({ min: [0, -0.008, -0.008], max: [wr, 0.008, 0.008], c: 0, omit: ['ny'] }), 'x'), Ry((k * Math.PI * 2) / 3 + 0.3)), 'brass', { seed: seed + 68, shade: 0.85 }));
    wheel.add(part('brass', turned(profile(0, -0.02).to(0.025, -0.02, { fillet: 0.006, segs: 1 }).to(0.025, 0.02, { fillet: 0.008, segs: 1 }).to(0, 0.022), 8), 'brass', { seed: seed + 69 }));
    wheel.add(part('steel', transform(turned(profile(0, 0).to(0.016, 0, { sharp: true }).to(0.018, 0.04, { fillet: 0.008, segs: 1 }).to(0, 0.05), 6), T(wr * Math.cos(0.3 + Math.PI / 4), 0.01, -wr * Math.sin(0.3 + Math.PI / 4))), 'tape-yellow', { seed: seed + 70 }));
    // the hose: out of the valve, down onto the console's deck, up into the column's gland
    const gdir = new Vector3(valve.x - PX, 0, valve.z - PZ).normalize();
    const gland = new Vector3(PX, yTop + 0.42, PZ).addScaledVector(gdir, colR(yTop + 0.42) + 0.005);
    const hr = 0.035, lie = yTop + hr;
    const mid = new Vector3((valve.x + gland.x) / 2 + 0.12, lie, (valve.z + gland.z) / 2 + 0.05);
    const pts = [
      valve.clone().add(new Vector3(-0.1, 0, 0)),
      valve.clone().add(new Vector3(-0.17, -0.12, 0.04)),
      mid,
      gland.clone().addScaledVector(gdir, 0.22).add(new Vector3(0, -0.12, 0)),
      gland.clone().addScaledVector(gdir, 0.1),
    ];
    const hose = sweep(curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), hi ? 10 : 8), { radius: hr, segs: 5, ends: 'flat', detail });
    b.add(part('rubber', hose, 'wood-light', { seed: seed + 71, shade: 0.75 }));
    // brass ferrules at both ends; a boss on the column where it goes in
    const ferrule = (at: Vector3, dir: Vector3): KitPart => {
      const f = turned(profile(0, 0).to(0.044, 0, { fillet: 0.006, segs: 1 }).to(0.044, 0.06, { fillet: 0.006, segs: 1 }).to(0, 0.06), 9);
      return setFinish(part('brass', transform(f, aim(v3(at), v3(dir))), 'brass', { seed: seed + 72 }), 0.5);
    };
    b.add(ferrule(valve.clone().add(new Vector3(-0.1, 0, 0)), new Vector3(1, 0, 0)), ferrule(gland.clone().addScaledVector(gdir, 0.04), gdir.clone().negate()));
    b.add(part('steel', transform(turned(profile(0, 0).to(0.06, 0, { fillet: 0.01, segs: 1 }).to(0.055, 0.05, { fillet: 0.01, segs: 1 }).to(0, 0.05), 10), aim(v3(new Vector3(PX, yTop + 0.42, PZ).addScaledVector(gdir, colR(yTop + 0.42) - 0.03)), v3(gdir))), 'teal-panel', { seed: seed + 73 }));
  }

  // ======================================================================
  // THE STATION LAMP on the column, facing the visitor
  // ======================================================================
  const lampDir = new Vector3(0.3, 0.3, 1).normalize();
  const lampAt = new Vector3(PX, yTop + 1.2, PZ).addScaledVector(new Vector3(lampDir.x, 0, lampDir.z).normalize(), colR(yTop + 1.2) + 0.01);
  {
    const lm = aim(lampAt.toArray() as [number, number, number], lampDir.toArray() as [number, number, number]);
    b.add(setFinish(part('brass', transform(turned(profile(0.04, -0.05).to(0.07, 0.02, { fillet: 0.012, segs: 1 }).to(0.05, 0.03, { sharp: true }).to(0.05, 0.012), 12, false), lm), 'brass', { seed: seed + 100 }), 0.6));
    const lens = (cls: 'bulb' | 'glass'): KitPart => {
      const g = turned(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.047, 0.016, { sharp: true }).to(0.028, 0.036, { sharp: true }).to(0, 0.04), 8, false);
      return cls === 'bulb' ? setFinish(part('bulb', g, 'amber-glow', { seed: seed + 101 }), 0.55) : setFinish(part('steel', noWear(g), 'amber', { seed: seed + 102, shade: 0.3 }), 1);
    };
    const lamp = b.node('lamp', chain(lm, T(0, 0.015, 0)));
    lamp.node('lamp.lit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)).add(lens('bulb'));
    lamp.node('lamp.unlit').add(lens('glass'));
    b.socket('lamp', chain(lm, T(0, 0.06, 0)));
  }

  // ======================================================================
  // THE JACK PLATE on the front slope, and the conduit to the switchboard
  // ======================================================================
  {
    const est = estimateLabels();
    const pl = o.labels?.plate ?? { key: '', ...est.plate };
    const py = (yC0 + yTop) / 2 + 0.01;
    const plateM = chain(front(PLATEN.plateX, py, 0.004), mat({ rot: [0, 0, R.spread(0.8)] }));
    // a brass backing plate, and the engraved face on it
    b.add(setFinish(part('brass', transform(slab({ w: pl.w + 0.06, d: pl.h + 0.04, t: 0.012, r: 0.03, bevel: 0.004, detail: 'low', open: true, band: 0 }), chain(plateM, Rx(Math.PI / 2))), 'brass', { seed: seed + 110, shade: 0.7 }), 0.2));
    const face = transform(sheet({ w: pl.w, h: pl.h, t: 0.003, nx: 1, ny: 1 }), chain(plateM, T(0, 0, 0.0125)));
    if (o.labels && pl.key) b.add(noShadow([texturedPart('brass', face, pl.key)]));
    else b.add(part('brass', face, 'brass', { shade: 0.9 }));
    for (const x of [-pl.w / 2 - 0.0, pl.w / 2 + 0.0]) b.small(() => place([part('brass', stud(0.018, 0.01, 6), 'brass', { seed: seed + 111 })], chain(plateM, T(x, 0, 0.012), Rx(Math.PI / 2))));
    b.socket('plate', chain(plateM, T(0, 0, 0.016)));
    // the jack, right of the plate: a brass socket with the conduit's plug in it
    const jx = PLATEN.plateX + pl.w / 2 + 0.13;
    const jm = front(jx, py, 0.004);
    b.add(setFinish(part('brass', transform(turned(profile(0, 0).to(0.075, 0, { sharp: true }).to(0.075, 0.015, { fillet: 0.006, segs: 1 }).to(0.05, 0.03, { fillet: 0.008, segs: 1 }).to(0.04, 0.05).to(0, 0.05), 12), chain(jm, Rx(Math.PI / 2))), 'brass', { seed: seed + 112 }), 0.6));
    b.add(part('brass', transform(ridgedBand(0.042, 0.045, 12, 0.006), chain(jm, Rx(Math.PI / 2), T(0, 0.05, 0))), 'brass', { seed: seed + 113, shade: 0.85 }));
    const jackOut = new Vector3(0, 0.095, 0).applyMatrix4(chain(jm, Rx(Math.PI / 2)));
    b.socket('jack', chain(jm, T(0, 0, 0.1)));
    // the conduit: brown cloth, out of the plug, down to the bench, round the console's right end and away behind (never across the open sides)
    const n = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(jm));
    const cy = 0.048, end = new Vector3(C.x1 + 0.3, 0, -0.75);
    const pts = [jackOut, jackOut.clone().addScaledVector(n, 0.12), new Vector3(jackOut.x + 0.08, cy + 0.01, zFB + 0.2), new Vector3(C.x1 + 0.14, cy, zFB + 0.06), new Vector3(C.x1 + 0.28, cy, zFB - 0.4), new Vector3(end.x, cy, end.z + 0.3), new Vector3(end.x, cy, end.z + 0.04)];
    b.add(part('rubber', sweep(curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), hi ? 11 : 8), { radius: 0.034, segs: 5, ends: 'flat', detail }), 'wood', { seed: seed + 114, shade: 0.5 }));
    const bush = turned(profile(0.075, 0).to(0.075, 0.014, { sharp: true }).to(0.05, 0.024, { sharp: true }).to(0.048, 0.065, { fillet: 0.012, segs: 1 }).to(0, 0.066), 10, 'end');
    b.add(part('brass', transform(bush, T(end.x, 0, end.z)), 'brass', { seed: seed + 115 }));
    b.socket('conduit', T(end.x, 0, end.z));
  }

  // ======================================================================
  // SMALL: flange bolts (one replaced in brass), an inspection hatch on the deck
  // ======================================================================
  {
    const x0 = C.x1 - 0.42, x1 = C.x1 - 0.14, z0 = -0.32, z1 = 0.02;
    b.add(part('steel', bevelBox({ min: [x0, yTop - 0.004, z0], max: [x1, yTop + 0.014, z1], c: 0.008, omit: ['ny'] }), 'teal-panel', { seed: seed + 125, shade: 1.25 }));
    for (const [x, z] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.04, z1 - 0.04]] as const) b.small(() => part('steel', transform(stud(0.018, 0.01, 6), T(x, yTop + 0.014, z)), 'steel', { seed: seed + 126 }));
  }
  {
    const zf = zFB + 0.06;
    const pos: Array<[number, number]> = [[C.x0 + 0.5, zf], [C.x1 - 0.06, zf - 0.03], [C.x1 + 0.06, zMid], [TR.x - 0.3, TR.z - PLATEN.plinth.foot + 0.03]];
    const replaced = R.int(0, 3);
    pos.forEach(([x, z], i) => {
      const g = transform(hexHead(0.09, 0.045, R.range(0, Math.PI / 3)), T(x, 0.046, z));
      b.add(i === replaced ? part('brass', g, 'brass', { seed: seed + 120 + i }) : part('steel', g, 'steel', { seed: seed + 120 + i, jitter: 0.06 }));
    });
  }

  // ---- sockets ----
  b.socket('seat', T(TR.x, yTop + TR.seatY, TR.z));
  b.socket('nozzle.tip', nozzleTip({}));
  b.socket('tapehead.face', tapeFace({}));

  const built = b.build();
  registerPaint(built);
  // the platter is one flat fan: its baked cavity, sampled at the centre and the rim only, shows as wedges; it is open to the light anyway
  for (const n of built.root.children ?? []) {
    if (n.name !== 'tray') continue;
    for (const q of n.parts) {
      if (q.material !== 'steel') continue;
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, 0);
      sf.needsUpdate = true;
    }
  }
  paintPiece(built, o.paint ?? 'paint-blue');
  const pose = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
  if (typeof o.pose === 'string' && !pose) throw new Error(`platen: no pose '${o.pose}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
  if (pose) posePiece(built.root, pose);
  return built;
}

/** Where the nozzle's tip is, in the platen's root space, for a pose. */
export function nozzleTip(pose: PlatenPose): Matrix4 {
  const swing = Math.max(0, Math.min(1, pose.swing ?? 0));
  const dip = Math.max(0, Math.min(1, pose.dip ?? 0)) * POSE.dipDeg * DEG;
  const yaw = POSE.yawIdle + (POSE.yawOver - POSE.yawIdle) * swing;
  const drop = Math.max(0, Math.min(1, pose.dip ?? 0)) * POSE.dipDrop;
  return chain(T(PLATEN.pillar.x, PLATEN.pivotY - drop, PLATEN.pillar.z), Ry(yaw), Rz(-dip), T(BEAM, 0, 0), Rz(dip), T(PLATEN.goose.out, -PLATEN.goose.drop, 0));
}

/** Where the tape head's roller meets the part (the bottom of the roller), in root space, for a pose. */
export function tapeFace(pose: PlatenPose): Matrix4 {
  const LH = PLATEN.labelHead;
  const c = (v: number | undefined): number => Math.max(0, Math.min(1, v ?? 0));
  const yaw = POSE.yawIdle + (POSE.yawOver - POSE.yawIdle) * c(pose.swing);
  const x = LH.start + (LH.end - LH.start) * c(pose.tape);
  return chain(T(PLATEN.pillar.x, PLATEN.pivotY - c(pose.dip) * POSE.dipDrop, PLATEN.pillar.z), Ry(yaw), T(x + LH.out, -LH.hang - c(pose.press) * POSE.pressTravel, LH.z));
}

/** The head's two tool points for a pose: the nozzle's mouth and the roller's contact line (root space). */
export function toolPoints(pose: PlatenPose): { nozzle: Matrix4; roller: Matrix4 } {
  return { nozzle: nozzleTip(pose), roller: tapeFace(pose) };
}

// ---- catalogue ------------------------------------------------------------------

const asPaint = (v: unknown): Token | undefined => (typeof v === 'string' && (paints as readonly string[]).includes(v) ? (v as Token) : undefined);

export const catalogue: CatalogueEntry[] = [
  {
    name: 'platen',
    build: (opts = {}) => {
      const paint = asPaint(opts['paint']);
      const load = opts['load'] === 'crate' || opts['load'] === 'crate-s' || opts['load'] === 'robot' ? (opts['load'] as Load) : undefined;
      return platen({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as PlatenLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
        ...(paint ? { paint } : {}),
        ...(load ? { load } : {}),
        ...(opts['stencil'] === true ? { crateStencil: true } : {}),
      });
    },
    variants: {
      high: { detail: 'high' },
      low: { detail: 'low' },
      'with crate': { load: 'crate' },
      'with S crate': { load: 'crate-s' },
      'with robot': { load: 'robot' },
      ...Object.fromEntries(paints.map((p) => [p, { paint: p }])),
    },
    poses: Object.keys(NAMED_POSES),
    labels: (labels) => ({ labels: platenLabels(labels), ...(cratesLabelled(labels) ? { stencil: true } : {}) }),
    camera: { distance: 6 },
    note: 'The platen: paints and labels whatever is on its tray, by text. Variants: every paint, a crate or a stand-in robot on the tray.',
  },
];

function cratesLabelled(labels: Labels): boolean {
  crateLabels(labels);
  return true;
}
