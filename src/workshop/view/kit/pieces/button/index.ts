/**
 * The Big Red Button (REWRITE.md § B4, art-direction § 10 "THE BUTTON").
 * Registry name `button`.
 *
 * A glossy red mushroom cap in a knurled brass ring, on a hazard-striped
 * plate, on a stout teal enamel pedestal: a bolted flange, a body with an
 * access hatch and the DO NOT TOUCH tape, a dark waist, and a head whose top
 * slopes toward the visitor. A wire guard is parked open on two brass
 * hinges at the back; a brass press counter hangs off the left side on a
 * bracket; an armoured cable leaves the right side through a gland and runs
 * into the bench.
 *
 * Moving nodes (see pose.ts `poseButton`):
 *  - `cap`: travels down its local Y (the deck normal) by up to POSE.travel.
 *  - `guard`: swings about its local Y, which is the hinge line (world +X).
 *  - `digit0`..`digit3`: the counter's wheels (units first), turning about
 *    their local Y (the axle, world +X).
 */
import { Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { extrude, lathe, profiledBox, roundedBox, slab, taperBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath, arcPath } from '../../sweep.ts';
import { domeRivet } from '../../details.ts';
import { aim, chain, mat, part, piece, place, texturedPart, T, withVariant } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish, grain } from '../../space.ts';
import { cylinderRibbons, DIGIT_STROKES, hexHead, ridgedBand, sheet, stripes } from './geom.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { buttonLabels, estimateLabels } from './labels.ts';
import type { ButtonLabelRefs } from './labels.ts';
import { NAMED_POSES, POSE, posePiece } from './pose.ts';
import type { ButtonPose } from './pose.ts';

export { poseButton, posePiece, POSE, NAMED_POSES } from './pose.ts';
export type { ButtonPose } from './pose.ts';
export { buttonLabels, tapeStrips } from './labels.ts';
export type { ButtonLabelRefs, LabelRef } from './labels.ts';

const DEG = Math.PI / 180;

/** Dimensions shared with the tests and the view. */
export const BUTTON = {
  /** Height of the console's flat top (the deck), and the deck's forward tilt in degrees. */
  deckY: 1.04,
  tilt: 0,
} as const;

/** The console: width, its side profile (z of the front panel's foot and top, and of the back), where the cap and counter stand. */
export const CONSOLE = {
  w: 2.1,
  frontBottomZ: 0.66,
  frontTopZ: 0.37,
  backZ: -0.76,
  capX: 0.32,
  capZ: -0.2,
  counterX: -0.6,
} as const;

export interface ButtonOptions extends KitOptions {
  /** Label refs from `buttonLabels(labels)`. Without them the tape and plate are blank (clay reviews, tests). */
  labels?: ButtonLabelRefs;
  /** Build already posed (a name from NAMED_POSES, or a pose). The rest pose is the default. */
  pose?: string | ButtonPose;
  /**
   * (L2, a candidate behind `?corner=1`) The cap is an illuminated push button: its enamel the `bulb` class in its
   * 'button' variant (it glows red from inside; the view breathes it, materials/button-glow.ts).
   */
  lit?: boolean;
  /**
   * (L2, a candidate behind `?corner=2`) A small caged work lamp of its own: a brass clamp on the deck's back left
   * corner, a gooseneck, a steel shade with a wire guard over its mouth, aimed down across the cap. Socket
   * `worklamp`: the bulb's middle (where the view hangs the lamp's light).
   */
  workLamp?: boolean;
}

/** (L2) The cap lit: how deep a cut of `button-red` its glow is (the bulb class's indicator level times this). */
export const LIT_CAP = { shade: 0.42 } as const;
/** (L2) The work lamp: its foot on the deck (console space), and the bulb's glow (a cut of `amber-glow`). */
export const WORK_LAMP = { foot: [-0.86, -0.6] as const, bulb: 0.55 } as const;

/**
 * The hatch's screws, on the console's left side (seen only from far to the left, a few pixels
 * at a slant): a low dome with a dark slot across it, where the kit's slotted screw spends 132.
 */
function sideScrew(d: number, seed: number): KitPart[] {
  const r = d / 2, h = r * 0.55;
  const a = rng(seed).range(0, Math.PI);
  const spin = new Matrix4().makeRotationY(a);
  // three parts, as the kit's screw has: every part after them keeps its place in the piece's lpos
  // offsets (BUILD order), so its chips and grain do not move
  const slot = (x0: number, x1: number): KitPart => part('metal', transform(bevelBox({ min: [x0, h * 0.4, -r * 0.13], max: [x1, h * 1.02, r * 0.13], omit: ['ny'] }), spin), 'steel', { shade: 0.35 });
  return [part('metal', transform(stud(r, h, 6), spin), 'steel', { seed, jitter: 0.05 }), slot(-r * 0.82, 0), slot(0, r * 0.82)];
}

/** A dent that keeps the solid's wear and cavity (the kit's `dent` recomputes them without the wear band). */
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

export function button(o: ButtonOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('button', { detail, seed });

  // ======================================================================
  // LARGE FORM: a flared, bolted flange; a dark recessed plinth; a console
  // whose broad front panel leans back toward the visitor; a flat deck on top
  // ======================================================================
  const yF = 0.11; // flange top
  const yC0 = 0.15; // console body bottom
  const W = CONSOLE.w;
  const zFB = CONSOLE.frontBottomZ, zFT = CONSOLE.frontTopZ, zBack = CONSOLE.backZ;
  const yTop = BUTTON.deckY;
  const zMid = (zFB + zBack) / 2;
  {
    const r = 0.22;
    const flangeG = profiledBox(
      { w: W + 0.3, d: zFB - zBack + 0.3, rPlan: r, detail },
      profile(0, 0)
        .to(r, 0, { sharp: true })
        .to(r, 0.05, { fillet: 0.016, segs: 2 })
        .to(r - 0.13, 0.058, { fillet: 0.02, segs: 2 })
        .to(r - 0.15, yF, { fillet: 0.012 })
        .to(0, yF),
    );
    transform(flangeG, T(0, 0, zMid));
    // the flange's front edge took a boot or two
    dentKeep(flangeG, [-0.6 + R.spread(0.15), 0.05, zFB + 0.15], [0, 0.3, 1], 0.1, 0.012);
    b.add(part('steel', flangeG, 'teal-panel', { seed, shade: 0.85, jitter: 0.03 }));
  }
  // the plinth: a dark band set in under the console, so it sits a little proud of its flange
  {
    const r = 0.08;
    const g = profiledBox({ w: W - 0.08, d: zFB - zBack - 0.1, rPlan: r, detail, band: 0 }, profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.06, { sharp: true }).to(0, 0.06));
    b.add(part('steel', transform(g, T(0, yF - 0.01, zMid - 0.02)), 'teal-panel', { seed: seed + 2, shade: 0.5 }));
  }
  {
    // the console: its side profile (front foot, front top, back top, back foot) extruded across X
    const outline: Array<[number, number]> = [[-zFB, yC0], [-zFT, yTop], [-zBack - 0.02, yTop], [-zBack, yC0]];
    const g = extrude(outline, W, { radius: [0.03, 0.1, 0.07, 0.03], bevel: 0.045, segs: 3, detail });
    transform(g, chain(T(-W / 2, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
    // knocks: the front panel's lower left corner, the deck's right front edge
    dentKeep(g, [-W / 2 + 0.06 + R.spread(0.03), yC0 + 0.1, zFB - 0.03], [1, 0, -1], 0.09, 0.014);
    dentKeep(g, [W / 2 - 0.3 + R.spread(0.1), yTop - 0.02, zFT - 0.02], [0, 1, -1], 0.08, 0.01);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 1, shade: 1.12, jitter: 0.03 }));
  }
  const tilt = BUTTON.tilt * DEG;

  // the deck frame: origin where the cap stands, +Y up its axis, +Z toward the visitor
  const deck = chain(T(CONSOLE.capX, BUTTON.deckY, CONSOLE.capZ), new Matrix4().makeRotationX(tilt));
  const plateT = 0.026;
  const plateW = 1.04, plateD = 0.98;

  // hazard plate, yellow, with ink stripes painted on
  {
    const r = 0.09;
    const plate = profiledBox({ w: plateW, d: plateD, rPlan: r, detail, band: 0 }, profile(0, 0).to(r, 0, { sharp: true }).to(r, plateT, { fillet: 0.009, segs: 2 }).to(0, plateT));
    b.add(part('steel', transform(plate, deck), 'tape-yellow', { seed: seed + 4, shade: 0.9, jitter: 0.03 }));
    const polys = stripes(plateW / 2 - 0.035, plateD / 2 - 0.035, 0.085, 0.18, [Math.SQRT1_2, -Math.SQRT1_2], R.range(0, 0.15));
    for (const poly of polys) {
      // skip what the brass ring hides completely
      if (poly.every(([x, z]) => Math.hypot(x, z) < 0.43)) continue;
      // paint 2.5 mm thick: its corners need no rounding
      const g = extrude(poly, 0.0025, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0, segs: 1, caps: 'end', detail });
      b.add(part('steel', transform(g, chain(deck, T(0, plateT - 0.0006, 0))), 'ink', { seed: seed + 5, shade: 1.3 }));
    }
    // four screws hold the plate down
    for (const [x, z] of [[-1, 1], [1, 1]] as const) {
      const s = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.036, detail: 'low', cheap: true, material: 'metal', token: 'steel', seed: s }), chain(deck, T(x * (plateW / 2 - 0.04), plateT, z * (plateD / 2 - 0.04)))));
    }
  }

  // brass ring with a knurled band; the cap sits in it
  const ringH = 0.062;
  const rr0 = 0.028; // the guard's rod radius
  const ringR = 0.455;
  {
    const ri = 0.38;
    // two turned lips (the bottom and the crown); the knurled band between them is its own cheap part
    const lipSegs = hi ? 24 : 16;
    const g = lathe(profile(ringR, 0).to(ringR, ringH * 0.26, { fillet: 0.004, segs: 1 }).to(ringR - 0.014, ringH * 0.27), { detail, band: 0, segs: lipSegs, caps: false });
    b.add(part('brass', transform(g, chain(deck, T(0, plateT, 0))), 'brass', { seed: seed + 6, warm: 0.03 }));
    const crown = lathe(
      profile(ringR - 0.014, ringH * 0.74).to(ringR - 0.003, ringH * 0.78, { fillet: 0.004, segs: 1 }).to(ringR - 0.006, ringH, { fillet: 0.012, segs: 1 }).to(ri + 0.014, ringH, { fillet: 0.014, segs: 1 }).to(ri, ringH * 0.45),
      { detail, band: 0, segs: lipSegs, caps: false },
    );
    b.add(part('brass', transform(crown, chain(deck, T(0, plateT, 0))), 'brass', { seed: seed + 6, warm: 0.03 }));
    const k = ridgedBand(ringR - 0.004, ringH * 0.48 + 0.004, hi ? 48 : 30, 0.01);
    b.add(setFinish(part('brass', transform(k, chain(deck, T(0, plateT + ringH * 0.25 - 0.001, 0))), 'brass', { seed: seed + 7 }), 0.5));
  }

  // ======================================================================
  // THE CAP (moves down its local Y)
  // ======================================================================
  const capGap = 0.058;
  const capH = 0.285;
  const cap = b.node('cap', chain(deck, T(0, plateT + ringH + capGap, 0)));
  {
    const rc = 0.425;
    const g = lathe(
      profile(0.12, -0.01)
        .to(rc - 0.05, -0.004, { fillet: 0.02, segs: 1 })
        .to(rc, 0.03, { fillet: 0.03, segs: 3 })
        .to(rc + 0.004, 0.08, { fillet: 0.06, segs: 3 })
        .cubic(0, capH, rc + 0.004, 0.2, rc * 0.52, capH, hi ? 9 : 5),
      { detail, segs: hi ? 28 : 18, caps: false },
    );
    // thick wet enamel: a deeper cut of the token, so its lit side stays red under the gloss
    if (o.lit) cap.add(...withVariant(setFinish(part('bulb', g, 'button-red', { seed: seed + 8, shade: LIT_CAP.shade }), 1), 'button'));
    else cap.add(setFinish(part('steel', g, 'button-red', { seed: seed + 8, shade: 0.8 }), 1));
  }

  // ======================================================================
  // THE GUARD: a bent-rod cage on brass hinges at the plate's back edge
  // ======================================================================
  const hingeY = 0.12, hingeZ = -0.47;
  const hingeAt = chain(deck, T(0, hingeY, hingeZ));
  const yToX = new Matrix4().makeRotationZ(-Math.PI / 2); // node local +Y = the hinge line (+X)
  const toNode = yToX.clone().invert();
  const guard = b.node('guard', chain(hingeAt, yToX, new Matrix4().makeRotationY(POSE.guardOpenDeg * DEG)));
  const cageX = 0.47;
  const reach = 0.95; // hinge line to the front bar
  {
    // built in the hinge frame (x across, y up from the hinge line, z forward when shut), then into node space
    const rr = 0.028;
    const segs = hi ? 6 : 5;
    const cs = hi ? 3 : 2;
    // its ends are buried: the base frame's in the hinge barrels, the back bar's in the side rails
    const rod = (pts: Array<[number, number, number]>, r: number, rad = rr): KitPart =>
      part('metal', transform(sweep(polylinePath(pts, r, cs), { radius: rad, detail, segs, ends: 'flat' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 });
    // the base frame: one rod bent round the cap (side rails, front bar), its ends turned into the hinge eyes
    guard.add(rod([[-cageX - 0.058, 0, 0], [-cageX, 0, 0], [-cageX, 0, reach], [cageX, 0, reach], [cageX, 0, 0], [cageX + 0.058, 0, 0]], 0.045));
    // three ribs bent over the crown, front to back: it reads as a cage from any side
    for (const x of [-0.27, 0, 0.27]) {
      const h = 0.345 - 0.05 * (x / 0.27) ** 2;
      guard.add(part('metal', transform(sweep(polylinePath([[x, 0, 0.03], [x, h * 0.8, 0.13], [x, h, 0.36], [x, h, reach - 0.36], [x, h * 0.8, reach - 0.13], [x, 0, reach]], 0.16, 2), { radius: rr * 0.9, detail, segs: 5, ends: 'flat' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 }));
    }
    // a back bar tying the ribs' feet together at the hinge line
    guard.add(rod([[-cageX + 0.02, 0, 0.03], [cageX - 0.02, 0, 0.03]], 0, rr * 0.9));
    // a solid brass bar along the front (the top, parked open), with the lift tab a thumb flips it shut by
    // (one fillet step: the bar is a few pixels thick, its rounded ends are what shows when it is shut)
    guard.add(place([part('brass', transform(roundedBox({ band: 0, w: cageX * 2 + 0.04, h: 0.03, d: 0.075, r: 0.012, rPlan: 0.02, segs: 1, detail }), T(0, 0.012, reach + 0.004)), 'brass', { seed: seed + 11, shade: 0.9 })], toNode));
    guard.add(place([part('brass', transform(bevelBox({ min: [-0.06, 0, -0.025], max: [0.06, 0.012, 0.025], c: 0.004 }), chain(T(0, 0.02, reach + 0.05), mat({ rot: [-25, 0, 0] }))), 'brass', { seed: seed + 11 })], toNode));
  }
  // the fixed halves of the hinges: brass brackets screwed to the plate, a barrel round the pin
  for (const x of [-cageX, cageX]) {
    const sx = Math.sign(x);
    const bx = x + sx * 0.03;
    // a foot screwed to the plate, an ear standing up from it, a barrel round the rod's end
    // (on the plate and standing in the barrel: their bottoms are never seen)
    b.add(part('brass', transform(bevelBox({ min: [-0.03, 0, -0.05], max: [0.03, 0.022, 0.05], c: 0.007, omit: ['ny'] }), chain(deck, T(bx, plateT - 0.002, hingeZ + 0.02))), 'brass', { seed: seed + 13, shade: 0.85 }));
    b.add(part('brass', transform(bevelBox({ min: [-0.02, 0, -0.0225], max: [0.02, hingeY - plateT, 0.0225], c: 0.006, omit: ['ny'] }), chain(deck, T(bx, plateT + 0.01, hingeZ))), 'brass', { seed: seed + 13, shade: 0.85 }));
    const barrel = lathe(profile(0, 0).to(0.03, 0, { fillet: 0.008, segs: 1 }).to(0.03, 0.054, { fillet: 0.008, segs: 1 }).to(0, 0.054), { segs: 9, detail, band: 0 });
    b.add(part('brass', transform(barrel, chain(hingeAt, aim([bx - 0.027, 0, 0], [1, 0, 0]))), 'brass', { seed: seed + 14 }));
  }
  // rubber posts where the shut guard's front bar lands
  for (const x of [-cageX, cageX]) {
    const hp = hingeY - rr0 - plateT;
    const g = lathe(profile(0.028, 0).to(0.024, hp - 0.012, { smooth: true }).to(0.022, hp, { fillet: 0.01, segs: 1 }).to(0, hp), { segs: 8, detail, caps: false, band: 0 });
    b.add(part('rubber', transform(g, chain(deck, T(x, plateT, hingeZ + reach))), 'ink', { seed: seed + 16 }));
  }

  // ======================================================================
  // MEDIUM: the front panel (tape), the sides (hatch, louvres), the counter
  // ======================================================================
  const lean = Math.atan2(zFB - zFT, yTop - yC0);
  const zFront = (y: number): number => zFB - (y - yC0) * Math.tan(lean);
  /** A frame on the console's leaning front panel at (x, y), +Z out of the panel. */
  const front = (x: number, y: number, out = 0): Matrix4 => chain(T(x, y, zFront(y) + out / Math.cos(lean)), new Matrix4().makeRotationX(-lean));

  // the tape: DO NOT / TOUCH, big, stuck on by hand, crooked, the lower strip overlapping and its corner lifting
  {
    const est = estimateLabels();
    const strips = o.labels ? o.labels.tape : est.tape.map((q) => ({ key: '', ...q }));
    const total = strips.reduce((a, q) => a + q.h, 0) * 0.92;
    const mid = (yC0 + yTop) / 2 + 0.035;
    let y = mid + (total / 2 - strips[0]!.h / 2) * Math.cos(lean);
    strips.forEach((st, i) => {
      const ang = i === 0 ? R.range(1.2, 2.4) : -R.range(1.0, 2.0);
      const x = (i === 0 ? -0.06 : 0.07) + R.spread(0.03);
      const lifting = i === strips.length - 1;
      const lift = lifting ? (u: number, v: number) => 0.05 * Math.pow(Math.max(0, (u - 0.88) / 0.12), 2) * Math.max(0, 1 - v * 0.9) : () => 0;
      // each strip goes on over the one before it
      const at = chain(front(x, y, 0.003 + 0.002 * i), mat({ rot: [0, 0, ang] }));
      const face = transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: lifting ? 8 : 1, ny: lifting ? 2 : 1 }), at);
      if (o.labels && st.key) b.add(texturedPart('tape', face, st.key));
      else b.add(part('tape', face, 'ink'));
      // the back and the cut edge show only where it lifts
      if (lifting) b.add(part('tape', transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
      y -= st.h * 0.92 * Math.cos(lean);
    });
  }

  // the access hatch on the left side: a proud panel, two slotted screws
  {
    const side = chain(T(-W / 2, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2)); // +Z out of the left side
    const hc = chain(side, T(0.05, 0.56, 0));
    b.add(part('steel', transform(slab({ w: 0.62, d: 0.5, t: 0.012, r: 0.05, bevel: 0.005, detail: 'low', open: true, band: 0 }), chain(hc, T(0, 0, -0.004), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 24, shade: 1.04 }));
    for (const x of [-0.26, 0.26]) {
      const sd = R.int(0, 999);
      b.small(() => place(sideScrew(0.05, sd), chain(hc, T(x, 0.19, 0.008), mat({ rot: [90, 0, 0] }))));
    }
  }
  // a short row of louvres on the right side, toward the front
  {
    const side = chain(T(W / 2, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)); // +Z out of the right side
    const n = 4;
    const at = chain(side, T(-0.1, 0.72, 0));
    // the dark slot behind the louvres: a plate whose back is in the side
    b.add(part('metal', transform(bevelBox({ min: [-0.05, 0, -((n - 1) * 0.07 + 0.05) / 2], max: [0.05, 0.004, ((n - 1) * 0.07 + 0.05) / 2], c: 0.0015, omit: ['ny'] }), chain(at, T(0, 0, -0.002), mat({ rot: [90, 0, 0] }))), 'ink', { shade: 0.5 }));
    for (let i = 0; i < n; i++) {
      // a louvre's back is in the side: a bevelled blade without it
      const g = bevelBox({ min: [-0.06, 0, -0.0175], max: [0.06, 0.03, 0.0175], c: 0.008, omit: ['nz'] });
      b.add(part('steel', transform(g, chain(at, T(0, (i - (n - 1) / 2) * 0.07, -0.016), mat({ rot: [-28, 0, 0] }))), 'teal-panel', { seed: seed + 40 + i, shade: 1.1 }));
    }
  }

  // ---- the press counter: a housing on the deck, left of the cap, its face leaned toward the visitor ----
  {
    const lean2 = 35 * DEG;
    const hx = CONSOLE.counterX, hw = 0.74, slant = 0.42, z0 = 0.3;
    const faceM = chain(T(hx, yTop, z0), new Matrix4().makeRotationX(-lean2));
    const ct = Math.cos(lean2), sn = Math.sin(lean2);
    const set = 0.06; // the housing's own face is set back behind the brass front plate
    // the housing: a wedge, its side profile extruded across X
    {
      const fz = z0 - set * ct, fy = yTop - set * sn;
      const tz = z0 - slant * sn - set * ct, ty = yTop + slant * ct - set * sn;
      const outline: Array<[number, number]> = [[-fz, fy], [-tz, ty], [0.6, ty], [0.62, yTop - 0.02]];
      const g = extrude(outline, hw - 0.02, { radius: [0.01, 0.03, 0.05, 0.01], bevel: 0.03, segs: 2, detail });
      transform(g, chain(T(hx - (hw - 0.02) / 2, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
      b.add(part('steel', g, 'teal-panel', { seed: seed + 20, shade: 0.95 }));
    }
    // the brass front plate with the window cut through it
    const ww = 0.6, wh = 0.17, ws = 0.235;
    const frontPlate = extrude(
      [[-hw / 2, 0], [hw / 2, 0], [hw / 2, slant], [-hw / 2, slant]],
      set,
      { band: 0, holes: [[[-ww / 2, ws - wh / 2], [ww / 2, ws - wh / 2], [ww / 2, ws + wh / 2], [-ww / 2, ws + wh / 2]]], radius: 0.03, holeRadius: 0.012, bevel: 0.012, bevelBase: 0, caps: 'end', segs: 2, detail },
    );
    b.add(setFinish(part('brass', transform(frontPlate, chain(faceM, T(0, 0, -set))), 'brass', { seed: seed + 22, warm: 0.03 }), 0.2));
    // the four wheels, each its own node turning about the axle (+X); digit0 is the units wheel, on the right
    const wr = 0.26, wwid = 0.13, gap = 0.018;
    const glyph = 0.135;
    for (let i = 0; i < 4; i++) {
      const x = (1.5 - i) * (wwid + gap);
      const wheel = b.node(`digit${i}`, chain(faceM, T(x, ws, -0.012 - wr), new Matrix4().makeRotationZ(-Math.PI / 2)));
      const body = lathe(profile(wr * 0.8, -wwid / 2).to(wr, -wwid / 2, { sharp: true }).to(wr, wwid / 2, { sharp: true }).to(wr * 0.8, wwid / 2), { segs: hi ? 24 : 20, caps: false, detail, band: 0 });
      wheel.add(part('rubber', body, 'ink', { seed: seed + 23 + i, shade: 1.1 }));
      for (let d = 0; d < 10; d++) {
        const stks = DIGIT_STROKES[d]!.map((q) => q.map(([u, v]) => [(u - 0.3) * glyph, (v - 0.5) * glyph] as [number, number]));
        // printed numerals in satin enamel (finish 0), never worn: drawn by the painted-steel class, one mesh fewer
        wheel.add(setFinish(part('steel', cylinderRibbons(stks, { r: wr, width: 0.016, lift: 0.001, phi0: -d * ((Math.PI * 2) / 10) }), 'paper'), 0));
      }
    }
    // the engraved plate under the window, a rivet either side
    const pl = o.labels?.plate ?? { key: '', ...estimateLabels().plate };
    const plate = transform(sheet({ w: pl.w, h: pl.h, t: 0.003, nx: 1, ny: 1 }), chain(faceM, T(0, 0.064, 0.0005)));
    if (o.labels && pl.key) b.add(texturedPart('brass', plate, pl.key));
    else b.add(part('brass', plate, 'brass', { shade: 0.9 }));
    for (const x of [-hw / 2 + 0.04, hw / 2 - 0.04]) {
      const sd = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.032, detail: 'low', cheap: true, seed: sd }), chain(faceM, T(x, 0.064, 0.0), mat({ rot: [90, 0, 0] }))));
    }
    // a knurled reset knob on the housing's outboard end
    const knob = chain(T(hx - hw / 2 + 0.01, yTop + 0.17, -0.1), new Matrix4().makeRotationZ(Math.PI / 2));
    b.add(part('brass', transform(ridgedBand(0.045, 0.05, hi ? 14 : 10, 0.007), knob), 'brass', { seed: seed + 27 }));
    b.add(part('brass', transform(lathe(profile(0, 0.05).to(0.04, 0.05, { sharp: true }).to(0.032, 0.06, { fillet: 0.006, segs: 1 }).to(0, 0.06), { segs: 8, detail, band: 0 }), knob), 'brass', { seed: seed + 27 }));
  }

  // ---- the cable: out of the right side through a gland, down, into the bench -
  {
    const gx = W / 2 - 0.004, gy = 0.42, gz = 0.12;
    const cr = 0.032;
    // the gland: a brass hex body, a domed cap nut, a rubber boot gripping the cable (a cheap cut of the kit's cableGland)
    {
      const glandAt = aim([gx, gy, gz], [1, 0, 0]);
      const af = cr * 3.4, hh = af * 0.26;
      b.add(part('brass', transform(hexHead(af, hh, 0.2), glandAt), 'brass', { seed: seed + 28 }));
      const capR = af * 0.42;
      const nut = lathe(profile(capR * 0.8, hh).to(capR, hh + 0.006, { sharp: true }).to(capR, hh + af * 0.2, { fillet: af * 0.05, segs: 1 }).curve(cr * 1.4, hh + af * 0.36, capR * 0.85, hh + af * 0.35, 2), { segs: 8, caps: false, detail, band: 0 });
      b.add(part('brass', transform(nut, glandAt), 'brass', { seed: seed + 28, warm: 0.03 }));
      const y1 = hh + af * 0.3, L = af * 0.6;
      const boot = lathe(profile(cr * 1.42, y1).to(cr * 1.3, y1 + L * 0.5, { smooth: true }).to(cr * 1.06, y1 + L, { fillet: cr * 0.08, segs: 1 }).to(cr * 0.98, y1 + L), { segs: 9, caps: false, detail, band: 0 });
      b.add(part('rubber', transform(boot, glandAt), 'ink'));
    }
    const pts: Array<[number, number, number]> = [[gx + 0.12, gy, gz], [gx + 0.24, gy - 0.05, gz + 0.03], [gx + 0.3, cr + 0.06, gz + 0.12], [gx + 0.4, cr, gz + 0.2], [gx + 0.58, cr, gz + 0.16], [gx + 0.66, cr, gz + 0.04], [gx + 0.86, cr, gz - 0.02], [gx + 1.0, cr, -0.22], [gx + 1.08, cr, -0.33]];
    b.add(part('rubber', sweep(polylinePath(pts, 0.08, hi ? 3 : 2), { radius: cr, detail, segs: 6, ends: 'flat' }), 'ink', { seed: seed + 29, shade: 1.2 }));
    // a P-clip screwed to the bench, holding it down
    const clipAt: [number, number, number] = [gx + 0.76, 0, gz + 0.01];
    const clip = sweep(polylinePath([[-0.055, 0.008, 0], [-0.034, 0.008, 0], [-0.034, cr * 2.15, 0], [0.034, cr * 2.15, 0], [0.034, 0.008, 0], [0.055, 0.008, 0]], 0.022, 1), { radius: 0.008, detail, segs: 5, ends: 'flat' });
    b.add(part('metal', transform(clip, chain(T(...clipAt), new Matrix4().makeRotationY(Math.PI / 2 + 0.25))), 'steel', { seed: seed + 30 }));
    // where it goes into the bench: a squat brass bushing screwed down over a hole
    const gr = lathe(profile(0.075, 0).to(0.075, 0.012, { fillet: 0.006, segs: 1 }).to(0.055, 0.02, { fillet: 0.006, segs: 1 }).to(0.052, 0.07, { fillet: 0.012, segs: 1 }).to(0, 0.072), { segs: 10, detail, caps: false, band: 0 });
    b.add(part('brass', transform(gr, T(gx + 1.08, 0, -0.32)), 'brass', { seed: seed + 31 }));
  }

  // ---- SMALL: flange bolts (one replaced with a brass one), washers ----------
  {
    const hxF = W / 2 + 0.07, zf = zFB + 0.08, zb = zBack - 0.08;
    const pos: Array<[number, number]> = [[-hxF + 0.03, zb + 0.03], [hxF - 0.03, zb + 0.03], [-hxF + 0.03, zf - 0.03], [hxF - 0.03, zf - 0.03], [-0.36, zf], [0.36, zf], [-hxF, zMid], [hxF, zMid]];
    const replaced = R.int(0, 7);
    pos.forEach(([x, z], i) => {
      const brass = i === replaced;
      const g = transform(hexHead(0.1, 0.05, R.range(0, Math.PI / 3)), T(x, 0.056, z));
      b.add(brass ? part('brass', g, 'brass', { seed: seed + 50 + i }) : part('metal', g, 'steel', { seed: seed + 50 + i, jitter: 0.06 }));
    });
  }

  // ======================================================================
  // (L2, `?corner=2`) THE WORK LAMP: clamp, gooseneck, shade, guard, bulb
  // ======================================================================
  if (o.workLamp) {
    const L = R;
    const [fx, fz] = WORK_LAMP.foot;
    // large: the clamp block on the deck's corner and the neck rising out of it, bent over toward the cap
    b.add(part('brass', bevelBox({ min: [fx - 0.085, yTop - 0.004, fz - 0.075], max: [fx + 0.085, yTop + 0.075, fz + 0.075], c: 0.014, omit: ['ny'] }), 'brass', { seed: seed + 80, shade: 0.8, warm: 0.03 }));
    // the clamp's jaw down the console's back and its knurled thumbscrew
    b.add(part('brass', bevelBox({ min: [fx - 0.07, yTop - 0.16, zBack - 0.05], max: [fx + 0.07, yTop + 0.02, zBack - 0.005], c: 0.01 }), 'brass', { seed: seed + 81, shade: 0.75 }));
    b.add(part('brass', transform(ridgedBand(0.028, 0.04, 10, 0.004), chain(T(fx, yTop - 0.11, zBack - 0.07), aim([0, 0, 0], [0, 0, -1]))), 'brass', { seed: seed + 82 }));
    const lean = L.spread(0.03);
    const neck: Array<[number, number, number]> = [
      [fx, yTop + 0.07, fz],
      [fx + lean, yTop + 0.42, fz - 0.03],
      [fx + 0.03 + lean, yTop + 0.72, fz + 0.1],
      [fx + 0.16, yTop + 0.9, fz + 0.3],
      [fx + 0.3, yTop + 0.9, fz + 0.44],
    ];
    const neckPath = polylinePath(neck, 0.16, 4);
    b.add(part('metal', sweep(neckPath, { radius: 0.021, detail, segs: 8, ends: 'flat' }), 'steel', { seed: seed + 83, shade: 0.6 }));
    // mid: the flexible neck's ridges, a collar at its foot and at its head
    for (let i = 0; i + 1 < neck.length; i++) {
      const a = neck[i]!, c = neck[i + 1]!;
      const d: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const len = Math.hypot(...d);
      const n = Math.max(1, Math.round(len / 0.05));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        b.small(() => [part('metal', transform(lathe(profile(0.0255, 0).to(0.0255, 0.012, { fillet: 0.005, segs: 1 }).to(0, 0.012), { segs: 8, detail: 'low', caps: false, band: 0, support: false }), aim([a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], d)), 'steel', { seed: seed + 84, shade: 0.75 })]);
      }
    }
    b.add(part('metal', transform(lathe(profile(0.042, 0).to(0.042, 0.05, { fillet: 0.01, segs: 1 }).to(0.026, 0.06).to(0, 0.06), { segs: 12, detail, band: 0 }), T(fx, yTop + 0.07, fz)), 'steel', { seed: seed + 85, shade: 0.85 }));
    // the shade: its mouth aimed down across the cap
    const head = neck[neck.length - 1]!;
    const capAt: [number, number, number] = [CONSOLE.capX, yTop + 0.2, CONSOLE.capZ];
    const dir: [number, number, number] = [capAt[0] - head[0], capAt[1] - head[1], capAt[2] - head[2]];
    const at = aim(head, dir, L.range(0, 360));
    const shadeG = lathe(
      profile(0, -0.035).to(0.035, -0.035, { fillet: 0.01, segs: 1 }).to(0.045, 0.03, { fillet: 0.02, segs: 2 }).to(0.068, 0.07, { fillet: 0.03, segs: 2 }).to(0.15, 0.2, { fillet: 0.02, segs: 1 }).to(0.158, 0.215, { fillet: 0.006, segs: 1 }).to(0.142, 0.21).to(0.06, 0.08),
      { segs: 20, detail, caps: false },
    );
    // a knock in the shade's rim (it has been dropped)
    dentKeep(shadeG, [0.15, 0.2, 0], [1, 0.3, 0], 0.05, 0.01);
    b.add(part('steel', transform(shadeG, at), 'teal-panel', { seed: seed + 86, shade: 0.95, jitter: 0.04 }));
    // its switch, a little brass knob on the shade's back
    b.add(part('brass', transform(lathe(profile(0.014, 0).to(0.014, 0.03, { fillet: 0.005, segs: 1 }).to(0, 0.03), { segs: 8, detail: 'low', band: 0 }), chain(at, T(0.05, 0.05, 0), new Matrix4().makeRotationZ(-1.1))), 'brass', { seed: seed + 87 }));
    // the bulb, inside the mouth
    const bulbG = lathe(profile(0, 0.06).to(0.03, 0.07, { smooth: true }).to(0.05, 0.12, { smooth: true }).to(0.04, 0.16, { smooth: true }).to(0, 0.172), { segs: 12, detail, caps: false });
    b.add(part('bulb', transform(bulbG, at), 'amber-glow', { seed: seed + 88, shade: WORK_LAMP.bulb }));
    // small: the wire guard over the mouth: a ring at the rim and four wires domed over it
    b.add(part('metal', transform(sweep(arcPath([0, 0, 0], 0.15, 0, Math.PI * 2, 16, [1, 0, 0], [0, 0, 1]), { radius: 0.007, detail: 'low', segs: 5, ends: 'flat' }), chain(at, T(0, 0.212, 0))), 'steel', { seed: seed + 89 }));
    for (let k = 0; k < 2; k++) {
      const a0 = (k / 2) * (Math.PI / 2) + 0.3;
      const p0: [number, number, number] = [Math.cos(a0) * 0.15, 0.212, Math.sin(a0) * 0.15];
      const p1: [number, number, number] = [-p0[0], 0.212, -p0[2]];
      const g = sweep(polylinePath([p0, [p0[0] * 0.5, 0.262, p0[2] * 0.5], [0, 0.275, 0], [p1[0] * 0.5, 0.262, p1[2] * 0.5], p1], 0.04, 2), { radius: 0.006, detail: 'low', segs: 4, ends: 'flat' });
      b.add(part('metal', transform(g, at), 'steel', { seed: seed + 90 + k, shade: 0.9 }));
    }
    // two screws in the clamp block
    for (const x of [-0.045, 0.045]) b.small(() => place(domeRivet({ d: 0.028, detail: 'low', cheap: true, material: 'metal', token: 'steel', seed: seed + 92 }), T(fx + x, yTop + 0.075, fz + 0.03)));
    b.socket('worklamp', chain(at, T(0, 0.12, 0)));
  }

  b.socket('tape', front(0, (yC0 + yTop) / 2, 0.01));
  b.socket('cap', chain(deck, T(0, plateT + ringH + capGap + capH, 0)));
  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`button: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    posePiece(built.root, p);
  }
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'button',
    build: (opts = {}) =>
      button({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as ButtonLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
        ...(opts['lit'] === true ? { lit: true } : {}),
        ...(opts['workLamp'] === true ? { workLamp: true } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, 'lit cap (L2)': { lit: true }, 'work lamp (L2)': { workLamp: true } },
    poses: Object.keys(NAMED_POSES),
    labels: (labels) => ({ labels: buttonLabels(labels) }),
    camera: { distance: 5 },
    note: 'The Big Red Button on its console: the reddest thing on the bench.',
  },
];
