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
import { cableGland, domeRivet, slottedScrew } from '../../details.ts';
import { aim, chain, mat, part, piece, place, texturedPart, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish, grain } from '../../space.ts';
import { cylinderRibbons, DIGIT_STROKES, hexHead, ridgedBand, sheet, stripes } from './geom.ts';
import { estimateLabels } from './labels.ts';
import type { ButtonLabelRefs } from './labels.ts';
import { POSE } from './pose.ts';

export { poseButton, POSE } from './pose.ts';
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
    b.add(
      part(
        'steel',
        profiledBox(
          { w: 1.36, d: 1.18, rPlan: r, detail },
          profile(0, 0)
            .to(r, 0, { sharp: true })
            .to(r, 0.05, { fillet: 0.016, segs: 2 })
            .to(r - 0.125, 0.058, { fillet: 0.02, segs: 2 })
            .to(r - 0.14, yF, { fillet: 0.012 })
            .to(0, yF),
        ),
        'teal-panel',
        { seed, shade: 0.74, jitter: 0.03 },
      ),
    );
  }
  b.add(
    part(
      'steel',
      transform(taperBox({ w: bodyW, h: yB1 - yB0, d: bodyD, rPlan: 0.11, r: 0.03, rBottom: 0.01, topW: bodyTopW, topD: bodyTopD, detail }), T(0, yB0, 0)),
      'teal-panel',
      { seed: seed + 1, jitter: 0.03 },
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
    deform(head, (x, y, z) => [x, y - Math.tan(tilt) * z * Math.max(0, (y - yH0) / H), z]);
    b.add(part('steel', head, 'teal-panel', { seed: seed + 3, shade: 1.1 }));
  }

  // the deck frame: origin at the head's top centre, +Y its tilted normal, +Z toward the visitor
  const deck = chain(T(0, BUTTON.deckY, 0), new Matrix4().makeRotationX(tilt));
  const plateT = 0.026;
  const plateW = 1.04, plateD = 0.98;

  // hazard plate, yellow, with ink stripes painted on
  {
    const r = 0.09;
    const plate = profiledBox({ w: plateW, d: plateD, rPlan: r, detail }, profile(0, 0).to(r, 0, { sharp: true }).to(r, plateT, { fillet: 0.009, segs: 2 }).to(0, plateT));
    b.add(part('steel', transform(plate, deck), 'tape-yellow', { seed: seed + 4, jitter: 0.03 }));
    const polys = stripes(plateW / 2 - 0.035, plateD / 2 - 0.035, 0.085, 0.18, [Math.SQRT1_2, -Math.SQRT1_2], R.range(0, 0.15));
    for (const poly of polys) {
      // skip what the brass ring hides completely
      if (poly.every(([x, z]) => Math.hypot(x, z) < 0.43)) continue;
      const g = extrude(poly, 0.0025, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0.003, segs: 1, caps: 'end', detail });
      b.add(part('steel', transform(g, chain(deck, T(0, plateT - 0.0006, 0))), 'ink', { seed: seed + 5, shade: 1.3 }));
    }
    // four screws hold the plate down
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const s = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.036, detail: 'low', material: 'metal', token: 'steel', seed: s }), chain(deck, T(x * (plateW / 2 - 0.04), plateT, z * (plateD / 2 - 0.04)))));
    }
  }

  // brass ring with a knurled band; the cap sits in it
  const ringH = 0.062;
  const rr0 = 0.019; // the guard's rod radius
  const ringR = 0.455;
  {
    const ri = 0.38;
    // two turned lips (the bottom and the crown); the knurled band between them is its own cheap part
    const lipSegs = hi ? 36 : 22;
    const g = lathe(profile(ringR, 0).to(ringR, ringH * 0.26, { fillet: 0.004, segs: 1 }).to(ringR - 0.014, ringH * 0.27), { detail, segs: lipSegs, caps: false });
    b.add(part('brass', transform(g, chain(deck, T(0, plateT, 0))), 'brass', { seed: seed + 6, warm: 0.03 }));
    const crown = lathe(
      profile(ringR - 0.014, ringH * 0.74).to(ringR - 0.003, ringH * 0.78, { fillet: 0.004, segs: 1 }).to(ringR - 0.006, ringH, { fillet: 0.012, segs: 1 }).to(ri + 0.014, ringH, { fillet: 0.014, segs: 1 }).to(ri, ringH * 0.45),
      { detail, segs: lipSegs, caps: false },
    );
    b.add(part('brass', transform(crown, chain(deck, T(0, plateT, 0))), 'brass', { seed: seed + 6, warm: 0.03 }));
    const k = ridgedBand(ringR - 0.004, ringH * 0.48 + 0.004, hi ? 72 : 40, 0.008);
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
      { detail, segs: hi ? 36 : 22, caps: false },
    );
    cap.add(setFinish(part('steel', g, 'button-red', { seed: seed + 8 }), 1));
    // the stem: in the dark between cap and ring, seen only when pressed
    cap.add(part('metal', lathe(profile(0.1, -0.1).to(0.1, -0.005, { sharp: true }).to(0.12, -0.01), { segs: 14, caps: false, detail }), 'steel', { seed: seed + 9, shade: 0.6 }));
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
    const rr = 0.019;
    const segs = hi ? 6 : 5;
    const cs = hi ? 3 : 2;
    const rod = (pts: Array<[number, number, number]>, r: number, rad = rr): KitPart =>
      part('metal', transform(sweep(polylinePath(pts, r, cs), { radius: rad, detail, segs, ends: 'dome' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 });
    // the base frame: one rod bent round the cap (side rails, front bar), its ends turned into the hinge eyes
    guard.add(rod([[-cageX, 0, 0], [-cageX, 0, reach], [cageX, 0, reach], [cageX, 0, 0]], 0.09));
    // three ribs bent over the crown, front to back: it reads as a cage from any side
    for (const x of [-0.27, 0, 0.27]) {
      const h = 0.345 - 0.05 * (x / 0.27) ** 2;
      guard.add(part('metal', transform(sweep(polylinePath([[x, 0, 0.03], [x, h * 0.8, 0.13], [x, h, 0.36], [x, h, reach - 0.36], [x, h * 0.8, reach - 0.13], [x, 0, reach]], 0.16, 2), { radius: rr * 0.9, detail, segs: 5, ends: 'flat' }), toNode), 'steel', { seed: seed + 10, shade: 0.95 }));
    }
    // a back bar tying the ribs' feet together at the hinge line
    guard.add(rod([[-cageX + 0.02, 0, 0.03], [cageX - 0.02, 0, 0.03]], 0, rr * 0.9));
    // a brass lift tab on the front bar: where a thumb flips it shut
    guard.add(place([part('brass', transform(slab({ w: 0.12, d: 0.05, t: 0.012, r: 0.02, bevel: 0.004, detail }), chain(T(0, -0.004, reach + 0.035), mat({ rot: [-25, 0, 0] }))), 'brass', { seed: seed + 11 })], toNode));
    // hinge eyes: a turned boss round the pin at each rail's end
    for (const x of [-cageX, cageX]) {
      const eye = lathe(profile(0, 0).to(0.03, 0, { fillet: 0.006, segs: 1 }).to(0.03, 0.05, { fillet: 0.006, segs: 1 }).to(0, 0.05), { segs: 8, detail });
      guard.add(part('metal', transform(eye, chain(toNode, aim([x - 0.025, 0, 0], [1, 0, 0]))), 'steel', { seed: seed + 12, shade: 0.85 }));
    }
  }
  // the fixed halves of the hinges: brass brackets screwed to the plate, a barrel round the pin
  for (const x of [-cageX, cageX]) {
    const sx = Math.sign(x);
    const bx = x + sx * 0.05;
    const leaf = transform(chamferedBox({ w: 0.05, h: hingeY + 0.01, d: 0.07, c: 0.008 }), chain(deck, T(bx, plateT - 0.004, hingeZ)));
    b.add(part('brass', leaf, 'brass', { seed: seed + 13 }));
    const barrel = lathe(profile(0, 0).to(0.032, 0, { fillet: 0.008, segs: 1 }).to(0.032, 0.05, { fillet: 0.008, segs: 1 }).to(0, 0.05), { segs: 9, detail });
    b.add(part('brass', transform(barrel, chain(hingeAt, aim([bx - 0.025, 0, 0], [1, 0, 0]))), 'brass', { seed: seed + 14 }));
  }
  // rubber posts where the shut guard's front bar lands
  for (const x of [-cageX, cageX]) {
    const hp = hingeY - rr0 - plateT;
    const g = lathe(profile(0, 0).to(0.028, 0, { sharp: true }).to(0.024, hp - 0.012, { smooth: true }).to(0.022, hp, { fillet: 0.01, segs: 2 }).to(0, hp), { segs: 8, detail, caps: 'end' });
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
    const hx = 0.37, y0 = 0.15, y1 = 0.48;
    const cr = 0.04;
    b.add(part('steel', transform(slab({ w: hx * 2, d: y1 - y0, t: 0.012, r: 0.045, bevel: 0.005, detail, open: true }), chain(front(0, (y0 + y1) / 2, -0.004), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 24, shade: 1.04 }));
    for (const x of [-hx + 0.05, hx - 0.05]) {
      const s = R.int(0, 999);
      b.small(() => place(slottedScrew({ d: 0.042, detail: 'low', seed: s }), chain(front(x, y1 - 0.045, 0.008), mat({ rot: [90, 0, 0] }))));
    }
    // a finger notch at the bottom of the hatch
    b.add(part('steel', transform(slab({ w: 0.12, d: 0.03, t: 0.008, r: 0.012, bevel: 0.003, detail }), chain(front(0, y0 + 0.035), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 17, shade: 0.7 }));
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
      const at = chain(front(x, y, 0.0092), mat({ rot: [0, 0, ang] }));
      const face = transform(sheet({ w: s.w, h: s.h, lift, nx: 6, ny: 2 }), at);
      const back = transform(sheet({ w: s.w, h: s.h, lift, nx: 6, ny: 2, back: true }), at);
      if (o.labels && s.key) b.add(texturedPart('tape', face, s.key));
      else b.add(part('tape', face, 'ink'));
      b.add(part('tape', back, 'ink', { shade: 0.8 }));
      y -= s.h * 0.86 + 0.02;
    });
  }

  // a short row of louvres pressed into the head's front band, under the cap
  {
    const n = 4;
    const yl = yH0 + 0.036;
    const zl = 0.5 - Math.tan(tilt) * 0.0; // the head's front face, below where the shear starts to bite
    b.add(part('metal', transform(slab({ w: (n - 1) * 0.11 + 0.08, d: 0.014, t: 0.004, r: 0.006, bevel: 0.0015, detail: 'low' }), chain(T(0, yl - 0.005, zl - 0.008), mat({ rot: [90, 0, 0] }))), 'ink', { shade: 0.5 }));
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.11;
      // a pressed hood, leaning out at the top, open (dark) underneath
      const g = chamferedBox({ w: 0.075, h: 0.024, d: 0.028, c: 0.007 });
      b.add(part('steel', transform(g, chain(T(x, yl, zl - 0.018), mat({ rot: [-28, 0, 0] }))), 'teal-panel', { seed: seed + 40 + i, shade: 1.1 }));
    }
  }

  // ---- the press counter: a brass box on a bracket off the left side ---------
  {
    const cx = -0.68, cy = 0.44, cz = 0.2;
    const W = 0.27, H = 0.15, Dp = 0.11;
    const at = chain(T(cx, cy, cz), askew(seed + 19, 2.5));
    // the bracket: a bent steel strap screwed to the body's side
    const br = extrude(
      [[0, 0], [0.16, 0], [0.16, 0.012], [0.012, 0.012], [0.012, 0.11], [0, 0.11]],
      0.09,
      { bevel: 0.003, radius: [0.003, 0.003, 0.003, 0.012, 0.003, 0.003], segs: 1, detail },
    );
    b.add(part('steel', transform(br, chain(T(-bodyW / 2 + 0.01, cy - 0.12, cz - 0.045), mat({ rot: [0, 0, 0] }), new Matrix4().makeScale(-1, 1, 1))), 'teal-panel', { seed: seed + 20, shade: 0.8 }));
    // the case
    b.add(part('brass', transform(roundedBox({ w: W, h: H, d: Dp, r: 0.018, rPlan: 0.024, detail }), chain(at, T(0, -H / 2, -Dp / 2))), 'brass', { seed: seed + 21 }));
    // window bezel and the dark inside
    const ww = 0.172, wh = 0.058;
    const wy = 0.022;
    const bezel = extrude(
      [[-ww / 2 - 0.016, -wh / 2 - 0.014], [ww / 2 + 0.016, -wh / 2 - 0.014], [ww / 2 + 0.016, wh / 2 + 0.014], [-ww / 2 - 0.016, wh / 2 + 0.014]],
      0.01,
      { holes: [[[-ww / 2, -wh / 2], [ww / 2, -wh / 2], [ww / 2, wh / 2], [-ww / 2, wh / 2]]], radius: 0.012, holeRadius: 0.006, bevel: 0.004, bevelBase: 0, caps: 'end', segs: 2, detail },
    );
    b.add(setFinish(part('brass', transform(bezel, chain(at, T(0, wy, 0))), 'brass', { seed: seed + 22 }), 0.8));
    const pocket = extrude([[-ww / 2, -wh / 2], [ww / 2, -wh / 2], [ww / 2, wh / 2], [-ww / 2, wh / 2]], 0.004, { radius: 0.006, bevel: 0.001, caps: 'end', segs: 1 });
    b.add(part('metal', transform(pocket, chain(at, T(0, wy, -0.045))), 'ink', { shade: 0.6 }));
    // the four wheels, each its own node turning about the axle (+X)
    const wr = 0.034, wwid = 0.034, gap = 0.006;
    const glyph = 0.036;
    for (let i = 0; i < 4; i++) {
      // digit0 is the units wheel, on the right
      const x = (1.5 - i) * (wwid + gap);
      const wheel = b.node(`digit${i}`, chain(at, T(x, wy, -0.044 + 0.0), new Matrix4().makeRotationZ(-Math.PI / 2)));
      const body = lathe(profile(wr * 0.6, -wwid / 2).to(wr, -wwid / 2, { sharp: true }).to(wr, wwid / 2, { sharp: true }).to(wr * 0.6, wwid / 2), { segs: hi ? 10 : 8, caps: false, detail });
      wheel.add(part('rubber', body, 'ink', { seed: seed + 23 + i, shade: 1.1 }));
      const strokes: Array<ReadonlyArray<readonly [number, number]>> = [];
      const g: BufferGeometry[] = [];
      for (let d = 0; d < 10; d++) {
        const st = DIGIT_STROKES[d]!.map((s) => s.map(([u, v]) => [(u - 0.3) * glyph, (v - 0.5) * glyph] as [number, number]));
        g.push(cylinderRibbons(st, { r: wr, width: 0.0042, phi0: -d * ((Math.PI * 2) / 10) }));
        strokes.push(...st);
      }
      for (const q of g) wheel.add(part('paper', transform(q, new Matrix4()), 'paper'));
    }
    // the engraved plate under the window
    const pl = o.labels?.plate ?? { key: '', ...estimateLabels().plate };
    const plate = transform(sheet({ w: pl.w, h: pl.h, t: 0.002, nx: 1, ny: 1 }), chain(at, T(0, -0.035, 0.001)));
    if (o.labels && pl.key) b.add(texturedPart('brass', plate, pl.key));
    else b.add(part('brass', plate, 'brass', { shade: 0.9 }));
    // two screws, and a knurled reset knob on the outboard end
    for (const x of [-W / 2 + 0.022, W / 2 - 0.022]) {
      const s = R.int(0, 999);
      b.small(() => place(domeRivet({ d: 0.02, detail: 'low', seed: s }), chain(at, T(x, -0.035, 0.0), mat({ rot: [90, 0, 0] }))));
    }
    const knob = chain(at, T(-W / 2, -0.01, -Dp / 2), new Matrix4().makeRotationZ(Math.PI / 2));
    b.add(part('brass', transform(ridgedBand(0.022, 0.03, hi ? 14 : 8, 0.004), knob), 'brass', { seed: seed + 27 }));
    b.add(part('brass', transform(lathe(profile(0, 0.03).to(0.02, 0.03, { sharp: true }).to(0.016, 0.036, { fillet: 0.004, segs: 1 }).to(0, 0.036), { segs: 10, detail }), knob), 'brass', { seed: seed + 27 }));
  }

  // ---- the cable: out of the right side through a gland, down, into the bench -
  {
    const gx = bodyW / 2 - 0.004, gy = 0.27, gz = 0.08;
    const cr = 0.032;
    b.add(place(cableGland({ cable: cr, detail: 'low', seed: seed + 28 }), aim([gx, gy, gz], [1, 0, 0])));
    const pts: Array<[number, number, number]> = [[gx + 0.12, gy, gz], [gx + 0.26, gy - 0.02, gz + 0.02], [gx + 0.36, cr + 0.01, gz + 0.1], [gx + 0.7, cr, gz + 0.06], [gx + 0.98, cr, -0.2], [gx + 1.06, cr, -0.3], [gx + 1.08, -0.06, -0.32]];
    b.add(part('rubber', sweep(polylinePath(pts, 0.14, hi ? 4 : 2), { radius: cr, detail, segs: hi ? 7 : 6 }), 'ink', { seed: seed + 29, shade: 1.2 }));
    // a P-clip screwed to the bench, holding it down
    const clipAt: [number, number, number] = [gx + 0.62, 0, gz + 0.07];
    const clip = sweep(polylinePath([[-0.055, 0.004, 0], [-0.034, 0.004, 0], [-0.034, cr * 2.1, 0], [0.034, cr * 2.1, 0], [0.034, 0.004, 0], [0.055, 0.004, 0]], 0.022, 2), { radius: 0.006, detail, segs: 5 });
    b.add(part('metal', transform(clip, chain(T(...clipAt), new Matrix4().makeRotationY(Math.PI / 2 - 0.12))), 'steel', { seed: seed + 30 }));
    // where it dives into the bench: a brass grommet
    const gr = lathe(profile(0.062, 0).to(0.062, 0.008, { fillet: 0.006, segs: 1 }).to(0.04, 0.014, { fillet: 0.006, segs: 1 }).to(0.032, 0.002), { segs: 12, detail, caps: false });
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
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'button',
    build: (opts = {}) =>
      button({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as ButtonLabelRefs } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 5 },
    note: 'The Big Red Button on its pedestal: the reddest thing on the bench.',
  },
];
