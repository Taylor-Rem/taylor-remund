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
import { chamferedBox, extrude, lathe, profiledBox, roundedBox, slab, taperBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { domeRivet, slottedScrew } from '../../details.ts';
import { aim, chain, mat, part, piece, place, texturedPart, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish, grain } from '../../space.ts';
import { cylinderRibbons, DIGIT_STROKES, hexHead, ridgedBand, sheet, stripes } from './geom.ts';
import { estimateLabels } from './labels.ts';
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
  /** Height of the deck (the head's sloping top) at the centre, and its forward tilt in degrees. */
  deckY: 0.73,
  tilt: 10,
} as const;

export interface ButtonOptions extends KitOptions {
  /** Label refs from `buttonLabels(labels)`. Without them the tape and plate are blank (clay reviews, tests). */
  labels?: ButtonLabelRefs;
  /** Build already posed (a name from NAMED_POSES, or a pose). The rest pose is the default. */
  pose?: string | ButtonPose;
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
  // LARGE FORM: flange, body, waist, head
  // ======================================================================
  const yF = 0.11; // flange top
  const yB0 = 0.1, yB1 = 0.53; // body
  const bodyW = 0.98, bodyD = 0.84, bodyTopW = 0.95, bodyTopD = 0.8;
  {
    const r = 0.2;
    const flangeG = profiledBox(
          { w: 1.36, d: 1.18, rPlan: r, detail },
          profile(0, 0)
            .to(r, 0, { sharp: true })
            .to(r, 0.05, { fillet: 0.016, segs: 2 })
            .to(r - 0.125, 0.058, { fillet: 0.02, segs: 2 })
            .to(r - 0.14, yF, { fillet: 0.012 })
            .to(0, yF),
        );
    // the flange's front edge took a boot or two
    dentKeep(flangeG, [-0.35 + R.spread(0.08), 0.05, 0.59], [0, 0.3, 1], 0.08, 0.01);
    b.add(part('steel', flangeG, 'teal-panel', { seed, shade: 0.85, jitter: 0.03 }));
  }
  b.add(
    part(
      'steel',
      transform(taperBox({ w: bodyW, h: yB1 - yB0, d: bodyD, rPlan: 0.11, r: 0.03, rBottom: 0.01, topW: bodyTopW, topD: bodyTopD, detail, band: 0 }), T(0, yB0, 0)),
      'teal-panel',
      { seed: seed + 1, shade: 1.15, jitter: 0.03 },
    ),
  );
  // the waist: a dark recessed band between body and head
  {
    const r = 0.09;
    b.add(
      part(
        'steel',
        transform(profiledBox({ w: 0.86, d: 0.7, rPlan: r, detail }, profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.065, { sharp: true }).to(0, 0.065)), T(0, yB1 - 0.01, 0)),
        'teal-panel',
        { seed: seed + 2, shade: 0.55 },
      ),
    );
  }
  const tilt = BUTTON.tilt * DEG;
  const yH0 = yB1 + 0.045;
  {
    const r = 0.15;
    const H = BUTTON.deckY - yH0;
    const head = profiledBox(
      { w: 1.1, d: 1.0, rPlan: r, detail },
      profile(0, 0).to(r - 0.035, 0, { fillet: 0.012 }).to(r, 0.03, { fillet: 0.02 }).to(r, H - 0.06, { fillet: 0.014 }).to(r - 0.05, H, { fillet: 0.022 }).to(0, H),
    );
    transform(head, T(0, yH0, 0));
    // shear so the top slopes toward the visitor; the bottom stays flat on the waist
    deform(head, (x, y, z) => [x, y - Math.tan(tilt) * z * Math.max(0, (y - yH0) / H), z], { keepSurf: true });
    // a knock on the front right corner of the head (seeded: where it was dropped once)
    dentKeep(head, [0.5 + R.spread(0.03), yH0 + 0.05, 0.42], [-1, 0, -1], 0.07, 0.012);
    b.add(part('steel', head, 'teal-panel', { seed: seed + 3, shade: 1.1 }));
  }

  // the deck frame: origin at the head's top centre, +Y its tilted normal, +Z toward the visitor
  const deck = chain(T(0, BUTTON.deckY, 0), new Matrix4().makeRotationX(tilt));
  const plateT = 0.026;
  const plateW = 1.04, plateD = 0.98;

  // hazard plate, yellow, with ink stripes painted on
  {
    const r = 0.09;
    const plate = profiledBox({ w: plateW, d: plateD, rPlan: r, detail, band: 0 }, profile(0, 0).to(r, 0, { sharp: true }).to(r, plateT, { fillet: 0.009, segs: 2 }).to(0, plateT));
    b.add(part('steel', transform(plate, deck), 'tape-yellow', { seed: seed + 4, shade: 0.72, jitter: 0.03 }));
    const polys = stripes(plateW / 2 - 0.035, plateD / 2 - 0.035, 0.085, 0.18, [Math.SQRT1_2, -Math.SQRT1_2], R.range(0, 0.15));
    for (const poly of polys) {
      // skip what the brass ring hides completely
      if (poly.every(([x, z]) => Math.hypot(x, z) < 0.43)) continue;
      const g = extrude(poly, 0.0025, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0.003, segs: 1, caps: 'end', detail });
      b.add(part('steel', transform(g, chain(deck, T(0, plateT - 0.0006, 0))), 'ink', { seed: seed + 5, shade: 1.3 }));
    }
    // four screws hold the plate down
    for (const [x, z] of [[-1, 1], [1, 1]] as const) {
      const s = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.036, detail: 'low', material: 'metal', token: 'steel', seed: s }), chain(deck, T(x * (plateW / 2 - 0.04), plateT, z * (plateD / 2 - 0.04)))));
    }
  }

  // brass ring with a knurled band; the cap sits in it
  const ringH = 0.062;
  const rr0 = 0.022; // the guard's rod radius
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
        .to(rc - 0.05, -0.004, { fillet: 0.02, segs: 2 })
        .to(rc, 0.03, { fillet: 0.03, segs: 3 })
        .to(rc + 0.004, 0.08, { fillet: 0.06, segs: 3 })
        .cubic(0, capH, rc + 0.004, 0.2, rc * 0.52, capH, hi ? 9 : 5),
      { detail, segs: hi ? 28 : 18, caps: false },
    );
    cap.add(setFinish(part('steel', g, 'button-red', { seed: seed + 8 }), 1));
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
    const rr = 0.022;
    const segs = hi ? 6 : 5;
    const cs = hi ? 3 : 2;
    const rod = (pts: Array<[number, number, number]>, r: number, rad = rr): KitPart =>
      part('metal', transform(sweep(polylinePath(pts, r, cs), { radius: rad, detail, segs, ends: 'dome' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 });
    // the base frame: one rod bent round the cap (side rails, front bar), its ends turned into the hinge eyes
    guard.add(rod([[-cageX - 0.058, 0, 0], [-cageX, 0, 0], [-cageX, 0, reach], [cageX, 0, reach], [cageX, 0, 0], [cageX + 0.058, 0, 0]], 0.045));
    // three ribs bent over the crown, front to back: it reads as a cage from any side
    for (const x of [-0.27, 0, 0.27]) {
      const h = 0.345 - 0.05 * (x / 0.27) ** 2;
      guard.add(part('metal', transform(sweep(polylinePath([[x, 0, 0.03], [x, h * 0.8, 0.13], [x, h, 0.36], [x, h, reach - 0.36], [x, h * 0.8, reach - 0.13], [x, 0, reach]], 0.16, 2), { radius: rr * 0.9, detail, segs: 5, ends: 'flat' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 }));
    }
    // a back bar tying the ribs' feet together at the hinge line
    guard.add(rod([[-cageX + 0.02, 0, 0.03], [cageX - 0.02, 0, 0.03]], 0, rr * 0.9));
    // a brass lift tab on the front bar: where a thumb flips it shut
    guard.add(place([part('brass', transform(slab({ band: 0, w: 0.12, d: 0.05, t: 0.012, r: 0.02, bevel: 0.004, detail }), chain(T(0, -0.004, reach + 0.035), mat({ rot: [-25, 0, 0] }))), 'brass', { seed: seed + 11 })], toNode));
  }
  // the fixed halves of the hinges: brass brackets screwed to the plate, a barrel round the pin
  for (const x of [-cageX, cageX]) {
    const sx = Math.sign(x);
    const bx = x + sx * 0.03;
    // a foot screwed to the plate, an ear standing up from it, a barrel round the rod's end
    b.add(part('brass', transform(chamferedBox({ band: 0, w: 0.06, h: 0.022, d: 0.1, c: 0.007 }), chain(deck, T(bx, plateT - 0.002, hingeZ + 0.02))), 'brass', { seed: seed + 13, shade: 0.85 }));
    b.add(part('brass', transform(chamferedBox({ band: 0, w: 0.04, h: hingeY - plateT, d: 0.045, c: 0.006 }), chain(deck, T(bx, plateT + 0.01, hingeZ))), 'brass', { seed: seed + 13, shade: 0.85 }));
    const barrel = lathe(profile(0, 0).to(0.03, 0, { fillet: 0.008, segs: 1 }).to(0.03, 0.054, { fillet: 0.008, segs: 1 }).to(0, 0.054), { segs: 9, detail, band: 0 });
    b.add(part('brass', transform(barrel, chain(hingeAt, aim([bx - 0.027, 0, 0], [1, 0, 0]))), 'brass', { seed: seed + 14 }));
  }
  // rubber posts where the shut guard's front bar lands
  for (const x of [-cageX, cageX]) {
    const hp = hingeY - rr0 - plateT;
    const g = lathe(profile(0, 0).to(0.028, 0, { sharp: true }).to(0.024, hp - 0.012, { smooth: true }).to(0.022, hp, { fillet: 0.01, segs: 2 }).to(0, hp), { segs: 8, detail, caps: 'end', band: 0 });
    b.add(part('rubber', transform(g, chain(deck, T(x, plateT, hingeZ + reach))), 'ink', { seed: seed + 16 }));
  }

  // ======================================================================
  // MEDIUM: the front (hatch, tape), the counter, the cable
  // ======================================================================
  const lean = Math.atan2((bodyD - bodyTopD) / 2, yB1 - yB0);
  const zFront = (y: number): number => bodyD / 2 - (y - yB0) * Math.tan(lean);
  /** A frame on the body's front face at (x, y), +Z out of the face. */
  const front = (x: number, y: number, out = 0): Matrix4 => chain(T(x, y, zFront(y) + out), new Matrix4().makeRotationX(-lean));

  // the access hatch: a seam round a panel, two screws at the top
  {
    const hx = 0.425, y0 = 0.14, y1 = 0.5;
    b.add(part('steel', transform(slab({ w: hx * 2, d: y1 - y0, t: 0.012, r: 0.045, bevel: 0.005, detail, open: true }), chain(front(0, (y0 + y1) / 2, -0.004), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 24, shade: 1.04 }));
    for (const x of [-hx + 0.042, hx - 0.042]) {
      const s = R.int(0, 999);
      b.small(() => place(slottedScrew({ d: 0.042, detail: 'low', seed: s }), chain(front(x, y1 - 0.042, 0.008), mat({ rot: [90, 0, 0] }))));
    }
  }

  // the tape: DO NOT / TOUCH, stuck on by hand, crooked, the lower strip's corner lifting
  {
    const est = estimateLabels();
    const strips = o.labels ? o.labels.tape : est.tape.map((s) => ({ key: '', ...s }));
    const yTop = 0.405;
    let y = yTop;
    strips.forEach((s, i) => {
      const ang = i === 0 ? R.range(1.5, 3.2) : -R.range(1.2, 2.6);
      const x = (i === 0 ? -0.03 : 0.05) + R.spread(0.02);
      const lift = i === strips.length - 1 ? (u: number, v: number) => 0.022 * Math.pow(Math.max(0, (u - 0.86) / 0.14), 2) * Math.max(0, 1 - v * 0.9) : () => 0;
      // each strip goes on over the one before it
      const at = chain(front(x, y, 0.0092 + 0.0016 * i), mat({ rot: [0, 0, ang] }));
      const lifting = i === strips.length - 1;
      const face = transform(sheet({ w: s.w, h: s.h, lift, nx: lifting ? 6 : 1, ny: lifting ? 2 : 1 }), at);
      if (o.labels && s.key) b.add(texturedPart('tape', face, s.key));
      else b.add(part('tape', face, 'ink'));
      // the back and the cut edge show only where it lifts
      if (lifting) b.add(part('tape', transform(sheet({ w: s.w, h: s.h, lift, nx: 6, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
      y -= s.h * 0.86 + 0.02;
    });
  }

  // a short row of louvres pressed into the head's front band, under the cap
  {
    const n = 3;
    const yl = yH0 + 0.036;
    const zl = 0.5 - Math.tan(tilt) * 0.0; // the head's front face, below where the shear starts to bite
    b.add(part('metal', transform(slab({ band: 0, w: (n - 1) * 0.11 + 0.08, d: 0.014, t: 0.004, r: 0.006, bevel: 0.0015, detail: 'low' }), chain(T(0, yl - 0.005, zl - 0.008), mat({ rot: [90, 0, 0] }))), 'ink', { shade: 0.5 }));
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.11;
      // a pressed hood, leaning out at the top, open (dark) underneath
      const g = chamferedBox({ band: 0, w: 0.075, h: 0.024, d: 0.028, c: 0.007 });
      b.add(part('steel', transform(g, chain(T(x, yl, zl - 0.018), mat({ rot: [-28, 0, 0] }))), 'teal-panel', { seed: seed + 40 + i, shade: 1.1 }));
    }
  }

  // ---- the press counter: a brass box on a bracket off the left side ---------
  {
    const cx = -0.68, cy = 0.44, cz = 0.2;
    const W = 0.29, H = 0.16, Dp = 0.11;
    const at = chain(T(cx, cy, cz), askew(seed + 19, 2.5));
    // the bracket: a bent steel strap screwed to the body's side
    const br = extrude(
      [[0, 0], [0.26, 0], [0.26, 0.014], [0.014, 0.014], [0.014, 0.13], [0, 0.13]],
      0.09,
      { band: 0, bevel: 0.003, radius: [0.003, 0.003, 0.003, 0.012, 0.003, 0.003], segs: 1, detail },
    );
    b.add(part('steel', transform(br, chain(T(-bodyW / 2 + 0.012, cy - H / 2 - 0.014, cz - 0.075), mat({ rot: [0, 0, 0] }), new Matrix4().makeScale(-1, 1, 1))), 'teal-panel', { seed: seed + 20, shade: 0.8 }));
    // the case: a brass box, and a thick front plate with the window cut through it
    b.add(part('brass', transform(roundedBox({ band: 0, w: W - 0.006, h: H, d: Dp - 0.04, r: 0.016, rPlan: 0.02, detail }), chain(at, T(0, -H / 2, -Dp / 2 - 0.035))), 'brass', { seed: seed + 21, shade: 0.9 }));
    const ww = 0.172, wh = 0.056;
    const wy = 0.016;
    const frontPlate = extrude(
      [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]],
      0.05,
      { band: 0, holes: [[[-ww / 2, wy - wh / 2], [ww / 2, wy - wh / 2], [ww / 2, wy + wh / 2], [-ww / 2, wy + wh / 2]]], radius: 0.02, holeRadius: 0.006, bevel: 0.007, bevelBase: 0, caps: 'end', segs: 2, detail },
    );
    b.add(setFinish(part('brass', transform(frontPlate, chain(at, T(0, 0, -0.05))), 'brass', { seed: seed + 22, warm: 0.03 }), 0.35));
    // the four wheels, each its own node turning about the axle (+X)
    const wr = 0.046, wwid = 0.034, gap = 0.006;
    const glyph = 0.022;
    for (let i = 0; i < 4; i++) {
      // digit0 is the units wheel, on the right
      const x = (1.5 - i) * (wwid + gap);
      const wheel = b.node(`digit${i}`, chain(at, T(x, wy, -0.007 - wr), new Matrix4().makeRotationZ(-Math.PI / 2)));
      const body = lathe(profile(wr * 0.6, -wwid / 2).to(wr, -wwid / 2, { sharp: true }).to(wr, wwid / 2, { sharp: true }).to(wr * 0.6, wwid / 2), { segs: 6, caps: false, detail, band: 0 });
      wheel.add(part('rubber', body, 'ink', { seed: seed + 23 + i, shade: 1.1 }));
      const strokes: Array<ReadonlyArray<readonly [number, number]>> = [];
      const g: BufferGeometry[] = [];
      for (let d = 0; d < 10; d++) {
        const st = DIGIT_STROKES[d]!.map((s) => s.map(([u, v]) => [(u - 0.3) * glyph, (v - 0.5) * glyph] as [number, number]));
        g.push(cylinderRibbons(st, { r: wr, width: 0.0036, phi0: -d * ((Math.PI * 2) / 10) }));
        strokes.push(...st);
      }
      for (const q of g) wheel.add(part('paper', transform(q, new Matrix4()), 'paper'));
    }
    // the engraved plate under the window
    const pl = o.labels?.plate ?? { key: '', ...estimateLabels().plate };
    const plate = transform(sheet({ w: pl.w, h: pl.h, t: 0.002, nx: 1, ny: 1 }), chain(at, T(0, -0.04, 0.0005)));
    if (o.labels && pl.key) b.add(texturedPart('brass', plate, pl.key));
    else b.add(part('brass', plate, 'brass', { shade: 0.9 }));
    // two screws, and a knurled reset knob on the outboard end
    for (const x of [-W / 2 + 0.024, W / 2 - 0.024]) {
      const s = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.022, detail: 'low', seed: s }), chain(at, T(x, -0.04, 0.0), mat({ rot: [90, 0, 0] }))));
    }
    const knob = chain(at, T(-W / 2 + 0.004, 0.0, -0.05), new Matrix4().makeRotationZ(Math.PI / 2));
    b.add(part('brass', transform(ridgedBand(0.022, 0.03, hi ? 14 : 8, 0.004), knob), 'brass', { seed: seed + 27 }));
    b.add(part('brass', transform(lathe(profile(0, 0.03).to(0.02, 0.03, { sharp: true }).to(0.016, 0.036, { fillet: 0.004, segs: 1 }).to(0, 0.036), { segs: 10, detail, band: 0 }), knob), 'brass', { seed: seed + 27 }));
  }

  // ---- the cable: out of the right side through a gland, down, into the bench -
  {
    const gx = bodyW / 2 - 0.004, gy = 0.27, gz = 0.08;
    const cr = 0.032;
    // the gland: a brass hex body, a domed cap nut, a rubber boot gripping the cable (a cheap cut of the kit's cableGland)
    {
      const glandAt = aim([gx, gy, gz], [1, 0, 0]);
      const af = cr * 3.4, hh = af * 0.26;
      b.add(part('brass', transform(hexHead(af, hh, 0.2), glandAt), 'brass', { seed: seed + 28 }));
      const capR = af * 0.42;
      const nut = lathe(profile(capR * 0.8, hh).to(capR, hh + 0.006, { sharp: true }).to(capR, hh + af * 0.2, { fillet: af * 0.05, segs: 1 }).curve(cr * 1.4, hh + af * 0.36, capR * 0.85, hh + af * 0.35, 2), { segs: 10, caps: false, detail, band: 0 });
      b.add(part('brass', transform(nut, glandAt), 'brass', { seed: seed + 28, warm: 0.03 }));
      const y1 = hh + af * 0.3, L = af * 0.6;
      const boot = lathe(profile(cr * 1.42, y1).to(cr * 1.3, y1 + L * 0.5, { smooth: true }).to(cr * 1.06, y1 + L, { fillet: cr * 0.08, segs: 1 }).to(cr * 0.98, y1 + L), { segs: 9, caps: false, detail, band: 0 });
      b.add(part('rubber', transform(boot, glandAt), 'ink'));
    }
    const pts: Array<[number, number, number]> = [[gx + 0.12, gy, gz], [gx + 0.26, gy - 0.02, gz + 0.02], [gx + 0.36, cr + 0.01, gz + 0.1], [gx + 0.7, cr, gz + 0.06], [gx + 0.98, cr, -0.2], [gx + 1.08, cr, -0.33]];
    b.add(part('rubber', sweep(polylinePath(pts, 0.14, hi ? 4 : 2), { radius: cr, detail, segs: 6, ends: 'flat' }), 'ink', { seed: seed + 29, shade: 1.2 }));
    // a P-clip screwed to the bench, holding it down
    const clipAt: [number, number, number] = [gx + 0.62, 0, gz + 0.07];
    const clip = sweep(polylinePath([[-0.055, 0.008, 0], [-0.034, 0.008, 0], [-0.034, cr * 2.15, 0], [0.034, cr * 2.15, 0], [0.034, 0.008, 0], [0.055, 0.008, 0]], 0.022, 1), { radius: 0.008, detail, segs: 5 });
    b.add(part('metal', transform(clip, chain(T(...clipAt), new Matrix4().makeRotationY(Math.PI / 2 - 0.12))), 'steel', { seed: seed + 30 }));
    // where it goes into the bench: a squat brass bushing screwed down over a hole
    const gr = lathe(profile(0.075, 0).to(0.075, 0.012, { fillet: 0.006, segs: 1 }).to(0.055, 0.02, { fillet: 0.006, segs: 1 }).to(0.052, 0.07, { fillet: 0.012, segs: 2 }).to(0, 0.072), { segs: 12, detail, caps: 'end', band: 0 });
    b.add(part('brass', transform(gr, T(gx + 1.08, 0, -0.32)), 'brass', { seed: seed + 31 }));
  }

  // ---- SMALL: flange bolts (one replaced with a brass one), washers ----------
  {
    const pos: Array<[number, number]> = [[-0.57, -0.48], [0.57, -0.48], [-0.57, 0.48], [0.57, 0.48], [-0.62, 0], [0.62, 0]];
    const replaced = R.int(0, 5);
    pos.forEach(([x, z], i) => {
      const brass = i === replaced;
      const g = transform(hexHead(0.08, 0.04, R.range(0, Math.PI / 3)), T(x, 0.056, z));
      b.add(brass ? part('brass', g, 'brass', { seed: seed + 50 + i }) : part('metal', g, 'steel', { seed: seed + 50 + i, jitter: 0.06 }));
    });
  }

  b.socket('tape', mat({ at: [0, 0.38, bodyD / 2 + 0.01] }));
  b.socket('cap', chain(deck, T(0, plateT + ringH + capGap + capH, 0)));
  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`button: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    posePiece(built.root, p);
  }
  return built;
}

export const catalogue: Array<CatalogueEntry & { poses?: readonly string[] }> = [
  {
    name: 'button',
    build: (opts = {}) =>
      button({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as ButtonLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 5 },
    note: 'The Big Red Button on its pedestal: the reddest thing on the bench.',
  },
];
