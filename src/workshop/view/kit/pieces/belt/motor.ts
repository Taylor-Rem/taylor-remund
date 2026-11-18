/**
 * The belt's drive: a motor housing at the left end. A teal enamel cabinet
 * on a bolted plinth whose front breaks back into a sloped control desk (a
 * cream panel carrying the speed dial's and the direction lever's blank
 * brass cover plates, and the line's own lamp); a finned motor lying on top
 * in a cradle, with a terminal box, a lifting eye and a cable into the
 * cabinet; louvres low on the front; a brass oil cup on the gearbox.
 *
 * Built in the belt's root space: `x1` is the housing's right face.
 */
import { Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { NodeBuilder } from '../../compose.ts';
import { chain, mat, part, place, T } from '../../compose.ts';
import { extrude, lathe, profiledBox, roundedBox, slab, torus } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { hexHead, ridgedBand, stud, bevelBox } from '../../cheap.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { transform, deform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import type { Rng } from '../../rng.ts';
import { BELT } from './dims.ts';
import { buildControls } from './controls.ts';
import type { ControlsOut } from './controls.ts';

/** The housing's side profile (z, y): front foot, top of the front, top of the desk, back. */
export const HOUSING = {
  /** Width across X. */
  W: BELT.motorW,
  zFoot: 0.7,
  zFrontTop: 0.68,
  yFrontTop: 0.38,
  zDeskTop: 0.3,
  yTop: 0.7,
  /** The deck behind the desk, where the motor sits (the same height here: no step). */
  yDeck: 0.7,
  zStep: 0.3,
  zBack: -0.62,
  /** Plinth height. */
  plinth: 0.07,
  /** The motor's centre line (z), and the gearbox sprocket (dx in from the right face, y). */
  motorZ: -0.2,
  sprocket: [0.2, 0.33],
} as const;

/**
 * The housing with the control face (option `controls`): wider, its desk a
 * taller slope facing the camera's pitch (its normal about 36° above the
 * horizontal) carrying the dial, the lever and the lamp, and a step down
 * behind it to the deck the motor sits on.
 */
export const CONSOLE = {
  W: 1.3,
  zFoot: 0.72,
  zFrontTop: 0.705,
  yFrontTop: 0.22,
  zDeskTop: 0.24,
  yTop: 0.86,
  yDeck: 0.68,
  zStep: 0.1,
  zBack: -0.62,
  plinth: 0.07,
  motorZ: -0.27,
  sprocket: [0.12, 0.17],
} as const;

export type HousingSpec = typeof HOUSING | typeof CONSOLE;

export interface MotorOut {
  /** Frames (root space) for the panel's sockets: +Z out of the panel, +Y up the slope. */
  dial: Matrix4;
  lever: Matrix4;
  /** Where the line's lamp is (its node goes here). */
  lamp: Matrix4;
  /** With the control face: where a hand takes the dial and the lever (root space, at rest). */
  dialGrip?: Matrix4;
  leverGrip?: Matrix4;
  /** The housing's left face (x) and its width. */
  x0: number;
  /** The gearbox output sprocket centre, for the chain guard. */
  sprocket: [number, number];
}

/** A dent that keeps the solid's wear and cavity. */
export function dentKeep(g: BufferGeometry, at: [number, number, number], dir: [number, number, number], r: number, d: number): void {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const nx = dir[0] / l, ny = dir[1] / l, nz = dir[2] / l;
  deform(g, (x, y, z) => {
    const q = Math.hypot(x - at[0], y - at[1], z - at[2]) / r;
    if (q >= 1) return [x, y, z];
    const w = (1 - q * q) * (1 - q * q) * d;
    return [x - nx * w, y - ny * w, z - nz * w];
  }, { keepSurf: true });
}

export function buildMotor(b: NodeBuilder, x1: number, seed: number, R: Rng, detail: 'high' | 'low', controls = false): MotorOut {
  const H: HousingSpec = controls ? CONSOLE : HOUSING;
  const W = H.W;
  const xm = x1 - W / 2;
  const hi = detail === 'high';

  // ---- plinth: a flared, bolted base a little wider than the cabinet ----
  {
    const r = 0.14;
    const d = H.zFoot - H.zBack;
    const g = profiledBox(
      { w: W + 0.16, d: d + 0.14, rPlan: r, detail: 'low', band: 0 },
      profile(0, 0)
        .to(r, 0, { sharp: true })
        .to(r, 0.035, { fillet: 0.012, segs: 1 })
        .to(r - 0.07, 0.045, { fillet: 0.015, segs: 1 })
        .to(r - 0.08, H.plinth, { sharp: true })
        .to(0, H.plinth),
    );
    transform(g, T(xm, 0, (H.zFoot + H.zBack) / 2));
    b.add(part('steel', g, 'teal-panel', { seed: seed + 100, shade: 0.8, jitter: 0.03 }));
    // plinth bolts along the front, one replaced in brass
    const zf = H.zFoot + 0.035;
    const xs = [xm - W / 2 - 0.02, xm - 0.18, xm + 0.2, xm + W / 2 + 0.02];
    const brassOne = R.int(0, xs.length - 1);
    xs.forEach((x, i) => {
      const gg = transform(hexHead(0.075, 0.04, R.range(0, Math.PI / 3)), T(x, 0.034, zf));
      b.add(i === brassOne ? part('brass', gg, 'brass', { seed: seed + 110 + i }) : part('metal', gg, 'steel', { seed: seed + 110 + i, jitter: 0.06 }));
    });
  }

  // ---- the cabinet: its side profile extruded across X ----
  const y0 = H.plinth - 0.01;
  {
    const outline: Array<[number, number]> = controls
      ? [[-H.zFoot + 0.04, y0], [-H.zFrontTop, H.yFrontTop], [-H.zDeskTop, H.yTop], [-H.zStep - 0.05, H.yTop], [-H.zStep, H.yDeck], [-H.zBack, H.yDeck], [-H.zBack, y0]]
      : [[-H.zFoot + 0.04, y0], [-H.zFrontTop, H.yFrontTop], [-H.zDeskTop, H.yTop], [-H.zBack, H.yTop], [-H.zBack, y0]];
    const radii = controls ? [0.04, 0.05, 0.07, 0.05, 0.05, 0.07, 0.04] : [0.04, 0.06, 0.07, 0.07, 0.04];
    const g = extrude(outline, W, { radius: radii, bevel: 0.035, segs: controls ? 1 : 2, detail, band: 0 });
    transform(g, chain(T(xm - W / 2, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
    // a knock on the desk's front edge and one low on the front
    dentKeep(g, [xm - 0.25 + R.spread(0.08), H.yFrontTop + 0.01, H.zFrontTop - 0.01], [0, 1, -1], 0.08, 0.012);
    dentKeep(g, [xm + W / 2 - 0.05, 0.18 + R.spread(0.04), H.zFoot - 0.02], [-0.6, 0, -1], 0.07, 0.01);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 101, shade: 1.1, jitter: 0.03 }));
  }

  // the desk frame: on the sloped face, origin at the slope's middle, +Z out, +Y up the slope
  const dz = H.zDeskTop - H.zFrontTop, dy = H.yTop - H.yFrontTop;
  const slopeLen = Math.hypot(dz, dy);
  const tilt = Math.atan2(-dz, dy); // angle of the face normal above the horizontal, from vertical
  const mid: [number, number] = [(H.zDeskTop + H.zFrontTop) / 2, (H.yTop + H.yFrontTop) / 2];
  const desk = (x: number, v: number, out = 0): Matrix4 => {
    const nz = Math.cos(tilt), ny = Math.sin(tilt);
    const uz = dz / slopeLen, uy = dy / slopeLen;
    return chain(T(xm + x, mid[1] + uy * v + ny * out, mid[0] + uz * v + nz * out), new Matrix4().makeRotationX(-tilt));
  };

  let ctl: ControlsOut | null = null;
  if (controls) ctl = buildControls(b, desk, seed + 300, R, detail);
  // ---- the control panel: a proud cream plate, screwed down ----
  const pw = W - 0.2, ph = slopeLen - 0.14;
  if (!controls) {
    const g = slab({ w: pw, d: ph, t: 0.024, r: 0.045, bevel: 0.009, detail, open: true });
    b.add(part('steel', transform(g, chain(desk(0, 0, -0.004), mat({ rot: [90, 0, 0] }))), 'paper', { seed: seed + 120, shade: 0.92, jitter: 0.02 }));
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const sd = R.int(0, 999);
      b.small(() => place([part('metal', stud(0.017, 0.009, 6), 'steel', { seed: sd })], chain(desk(sx * (pw / 2 - 0.035), sy * (ph / 2 - 0.035), 0.02), mat({ rot: [90, 0, 0] }))));
    }
  }
  // the dial's blank plate: a turned brass disc with a raised rim, three screws
  const dialX = -0.17, leverX = 0.2;
  const dialAt = desk(dialX, 0.0, 0.02);
  if (!controls) {
    const rr = 0.1;
    const g = lathe(
      profile(0, 0).to(rr, 0, { sharp: true }).to(rr, 0.014, { fillet: 0.006, segs: 2 }).to(rr - 0.016, 0.02, { fillet: 0.004, segs: 1 }).to(rr - 0.03, 0.012, { fillet: 0.004, segs: 1 }).to(0, 0.012),
      { segs: hi ? 12 : 10, detail, band: 0, caps: 'end' },
    );
    b.add(setFinish(part('brass', transform(g, chain(dialAt, mat({ rot: [90, 0, 0] }))), 'brass', { seed: seed + 121, warm: 0.03 }), 0.25));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      b.small(() => place([part('brass', stud(0.012, 0.008, 6), 'brass', { seed: seed + 122 + i, shade: 0.8 })], chain(dialAt, T(Math.cos(a) * (rr - 0.045), Math.sin(a) * (rr - 0.045), 0.012), mat({ rot: [90, 0, 0] }))));
    }
  }
  // the lever's blank plate: a brass strip over a slot (the lever will run left-right in it)
  const leverAt = desk(leverX, 0.0, 0.02);
  if (!controls) {
    const lw = 0.26, lh = 0.11;
    const g = slab({ w: lw, d: lh, t: 0.016, r: 0.04, bevel: 0.006, detail, band: 0, open: true });
    b.add(setFinish(part('brass', transform(g, chain(leverAt, mat({ rot: [90, 0, 0] }))), 'brass', { seed: seed + 125, warm: 0.03 }), 0.25));
    // the slot, blanked by a dark strip a hair below the plate's face
    const sl = slab({ w: lw - 0.09, d: 0.026, t: 0.004, r: 0.012, bevel: 0.0015, detail: 'low', band: 0, open: true });
    b.add(part('steel', transform(sl, chain(leverAt, T(0, 0, 0.014), mat({ rot: [90, 0, 0] }))), 'ink'));
    for (const sx of [-1, 1]) b.small(() => place([part('brass', stud(0.012, 0.008, 6), 'brass', { seed: seed + 126 + sx, shade: 0.8 })], chain(leverAt, T(sx * (lw / 2 - 0.028), 0, 0.016), mat({ rot: [90, 0, 0] }))));
  }
  // the lamp's brass bezel, top right of the panel (the lamp itself is a node the view lights)
  const lampAt = desk(0.37, 0.07, 0.02);
  if (!controls) {
    const bz = lathe(profile(0.026, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.016, { fillet: 0.006, segs: 2 }).to(0.026, 0.02, { fillet: 0.004, segs: 1 }), { segs: 14, detail, band: 0, caps: false });
    b.add(setFinish(part('brass', transform(bz, chain(lampAt, mat({ rot: [90, 0, 0] }))), 'brass', { seed: seed + 128 }), 0.4));
  }

  // ---- louvres low on the front, left of where the chain guard sits (the console's front is too low for them) ----
  if (!controls) {
    const lw = controls ? 0.36 : 0.4, lh = controls ? 0.12 : 0.2;
    // a cheap louvre: a dark recess, a proud frame of four bars, four blades leaning out and down
    const fl = [
      part('metal', bevelBox({ min: [-lw / 2 + 0.02, 0.02, -0.01], max: [lw / 2 - 0.02, lh - 0.02, 0.004], omit: ['nz'] }), 'ink', { shade: 0.8 }),
      part('steel', bevelBox({ min: [-lw / 2, 0, -0.01], max: [lw / 2, 0.03, 0.022], c: 0.009, omit: ['nz'] }), 'teal-panel', { seed: seed + 130, shade: 1.15 }),
      part('steel', bevelBox({ min: [-lw / 2, lh - 0.03, -0.01], max: [lw / 2, lh, 0.022], c: 0.009, omit: ['nz'] }), 'teal-panel', { seed: seed + 131, shade: 1.15 }),
      part('steel', bevelBox({ min: [-lw / 2, 0.02, -0.01], max: [-lw / 2 + 0.03, lh - 0.02, 0.022], c: 0.009, omit: ['nz'] }), 'teal-panel', { seed: seed + 132, shade: 1.15 }),
      part('steel', bevelBox({ min: [lw / 2 - 0.03, 0.02, -0.01], max: [lw / 2, lh - 0.02, 0.022], c: 0.009, omit: ['nz'] }), 'teal-panel', { seed: seed + 133, shade: 1.15 }),
    ];
    for (let i = 0; i < (controls ? 2 : 4); i++) {
      const slat = bevelBox({ min: [-lw / 2 + 0.03, -0.006, -0.002], max: [lw / 2 - 0.03, 0.006, 0.036], c: 0.004, omit: ['nz'] });
      fl.push(part('steel', transform(slat, chain(T(0, 0.055 + i * 0.037, 0.0), new Matrix4().makeRotationX(0.75))), 'teal-panel', { seed: seed + 134 + i, shade: 1.05 }));
    }
    // the front face leans back a little (foot to top)
    const lean = Math.atan2(H.zFoot - 0.04 - H.zFrontTop, H.yFrontTop - y0);
    const yb = controls ? 0.085 : 0.12;
    const zAt = H.zFoot - 0.04 - (yb - y0) * Math.tan(lean);
    b.add(place(fl, chain(T(controls ? xm - 0.3 : xm - 0.18, yb, zAt - 0.004), new Matrix4().makeRotationX(-lean))));
  }

  // ---- the motor: finned barrel along X in a cradle on the cabinet's top ----
  const mR = 0.19, mL = 0.7;
  const mx = controls ? xm - 0.06 : xm - 0.02, my = H.yDeck + 0.05 + mR, mz = H.motorZ;
  {
    const axis = chain(T(mx - mL / 2, my, mz), new Matrix4().makeRotationZ(-Math.PI / 2)); // lathe +Y -> world +X
    // the barrel with its two end bells
    const body = lathe(
      profile(0, -0.02)
        .to(mR * 0.55, -0.02, { fillet: 0.03, segs: 1 })
        .to(mR * 0.9, 0.04, { fillet: 0.03, segs: 1 })
        .to(mR * 0.92, 0.07, { sharp: true })
        .to(mR * 0.92, mL - 0.07, { sharp: true })
        .to(mR * 0.94, mL - 0.05, { fillet: 0.01, segs: 1 })
        .to(mR * 0.94, mL - 0.02, { fillet: 0.02, segs: 1 })
        .to(mR * 0.5, mL + 0.01, { fillet: 0.02, segs: 1 })
        .to(0, mL + 0.01),
      { segs: 10, detail, band: 0 },
    );
    b.add(part('steel', transform(body, axis), 'teal-light', { seed: seed + 140, shade: 0.9, jitter: 0.03 }));
    // the fins, between two rings that hide their open ends
    const fins = ridgedBand(mR + 0.012, mL - 0.2, hi ? 20 : 16, 0.028);
    b.add(part('steel', transform(fins, chain(axis, T(0, 0.1, 0))), 'teal-light', { seed: seed + 141, shade: 0.95 }));
    for (const yy of [0.08, mL - 0.11]) {
      const ring = lathe(profile(mR * 0.9, 0).to(mR + 0.02, 0, { sharp: true }).to(mR + 0.02, 0.03, { sharp: true }).to(mR * 0.9, 0.03), { segs: 10, detail, band: 0, caps: false });
      b.add(part('steel', transform(ring, chain(axis, T(0, yy, 0))), 'teal-light', { seed: seed + 142, shade: 0.85 }));
    }
    // the fan cowl on the left end: a domed cap with a brass centre boss
    const cowl = lathe(profile(mR * 0.86, 0).to(mR * 0.86, 0.05, { fillet: 0.03, segs: 1 }).to(mR * 0.3, 0.11, { fillet: 0.04, segs: 1 }).to(0, 0.115), { segs: 10, detail, band: 0, caps: false });
    b.add(part('steel', transform(cowl, chain(T(mx - mL / 2 + 0.01, my, mz), new Matrix4().makeRotationZ(Math.PI / 2))), 'teal-light', { seed: seed + 143, shade: 0.8 }));
    b.add(part('brass', transform(lathe(profile(0, 0).to(0.035, 0, { sharp: true }).to(0.03, 0.02, { fillet: 0.01, segs: 2 }).to(0, 0.022), { segs: 10, detail, band: 0 }), chain(T(mx - mL / 2 - 0.1, my, mz), new Matrix4().makeRotationZ(Math.PI / 2))), 'brass', { seed: seed + 144 }));
    // the cradle: two saddles bolted to the cabinet top
    for (const sx of [-0.22, 0.22]) {
      const sad = bevelBox({ min: [-0.05, 0, -0.17], max: [0.05, 0.1, 0.17], c: 0.016, omit: ['ny'] });
      b.add(part('steel', transform(sad, T(mx + sx, H.yDeck - 0.01, mz)), 'teal-panel', { seed: seed + 145, shade: 0.75 }));
      for (const sz of [-0.13, 0.13]) b.small(() => [part('metal', transform(stud(0.026, 0.02, 6), T(mx + sx, H.yDeck + 0.09, mz + sz)), 'steel', { seed: seed + 146 })]);
    }
    // the terminal box on top, its lid, four screws
    const tb = bevelBox({ min: [-0.11, 0, -0.085], max: [0.11, 0.12, 0.085], c: 0.022, omit: ['ny'] });
    const tx = mx + 0.12, ty = my + mR - 0.02;
    b.add(part('steel', transform(tb, T(tx, ty, mz + 0.02)), 'teal-light', { seed: seed + 147, shade: 0.95 }));
    b.add(part('steel', transform(bevelBox({ min: [-0.12, 0, -0.095], max: [0.12, 0.022, 0.095], c: 0.008, omit: ['ny'] }), T(tx, ty + 0.12, mz + 0.02)), 'teal-light', { seed: seed + 148, shade: 1.05 }));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.small(() => [part('metal', transform(stud(0.012, 0.008, 6), T(tx + sx * 0.09, ty + 0.14, mz + 0.02 + sz * 0.07)), 'steel', { seed: seed + 149 })]);
    // the cable: out of the box's right side, down into the cabinet top through a brass gland
    const cr = 0.024;
    const pts: Array<[number, number, number]> = [[tx + 0.11, ty + 0.06, mz + 0.02], [tx + 0.2, ty + 0.05, mz + 0.03], [tx + 0.27, ty - 0.08, mz + 0.06], [tx + 0.28, H.yDeck + 0.03, mz + 0.1]];
    b.add(part('steel', sweep(polylinePath(pts, 0.07, 2), { radius: cr, detail, segs: 5, ends: 'flat' }), 'ink', { seed: seed + 150, shade: 1.3 }));
    b.add(part('brass', transform(hexHead(0.07, 0.03, 0.3), T(tx + 0.28, H.yDeck - 0.005, mz + 0.1)), 'brass', { seed: seed + 151 }));
    // the lifting eye on top of the barrel, left of the box
    const ex = mx - 0.16;
    b.add(part('metal', transform(torus({ R: 0.036, r: 0.011, segs: 7, tubeSegs: 4, detail }), chain(T(ex, my + mR + 0.05, mz), new Matrix4().makeRotationX(Math.PI / 2), T(0, -0.011, 0))), 'steel', { seed: seed + 152 }));
    b.add(part('metal', transform(lathe(profile(0, 0).to(0.026, 0, { sharp: true }).to(0.024, 0.012, { fillet: 0.005, segs: 1 }).to(0.012, 0.02, { sharp: true }).to(0.012, 0.03).to(0, 0.03), { segs: 8, detail, band: 0 }), T(ex, my + mR - 0.012, mz)), 'steel', { seed: seed + 153 }));
  }

  // ---- the gearbox's oil cup: brass, on the cabinet top at the right ----
  if (!controls) {
    const oc = oilCup(seed + 160, detail);
    b.add(place(oc, chain(controls ? T(x1 - 0.12, H.yDeck - 0.004, -0.5) : T(x1 - 0.13, H.yTop - 0.004, 0.1), mat({ rot: [R.spread(3), 0, R.spread(4)] }))));
  }

  // the sprocket the chain leaves from: just inside the cabinet's right face, a little below the drum
  const sprocket: [number, number] = [x1 - H.sprocket[0], H.sprocket[1]];
  // a grab handle on the cabinet's left side (seen at the end; on the bench nobody sees that face): a bent rod on two bosses
  if (!controls) {
    const hx = xm - W / 2 - 0.004;
    const pts: Array<[number, number, number]> = [[hx, 0.5, 0.25], [hx - 0.06, 0.5, 0.21], [hx - 0.06, 0.5, -0.11], [hx, 0.5, -0.15]];
    b.add(part('metal', sweep(polylinePath(pts, 0.035, 2), { radius: 0.016, detail, segs: 6, ends: 'flat' }), 'steel', { seed: seed + 170 }));
  }
  if (ctl) return { dial: ctl.dial, lever: ctl.lever, lamp: ctl.lamp, dialGrip: ctl.dialGrip, leverGrip: ctl.leverGrip, sprocket, x0: x1 - W };
  return { dial: dialAt, lever: leverAt, lamp: lampAt, sprocket, x0: x1 - W };
}

/** A brass oil cup: a hex base, a waisted stem, a bulbous cup and a hinged domed lid with a flip tab. Along +Y from y = 0. */
export function oilCup(seed: number, detail: 'high' | 'low'): ReturnType<typeof part>[] {
  const hi = detail === 'high';
  const out = [part('brass', hexHead(0.056, 0.026, 0.2), 'brass', { seed, shade: 0.85 })];
  const body = lathe(
    profile(0.016, 0.024)
      .to(0.013, 0.05, { smooth: true })
      .to(0.034, 0.075, { fillet: 0.012, segs: 1 })
      .to(0.036, 0.11, { sharp: true })
      .to(0.031, 0.118, { sharp: true }),
    { segs: hi ? 7 : 6, detail, band: 0, caps: false },
  );
  out.push(part('brass', body, 'brass', { seed: seed + 1, warm: 0.04 }));
  const lid = lathe(profile(0.036, 0.118).to(0.036, 0.126, { sharp: true }).curve(0, 0.15, 0.026, 0.15, 2), { segs: hi ? 7 : 6, detail, band: 0, caps: false });
  out.push(setFinish(part('brass', lid, 'brass', { seed: seed + 2, warm: 0.04 }), 0.6));
  // the flip tab at the front
  out.push(part('brass', transform(bevelBox({ min: [-0.011, 0, -0.015], max: [0.011, 0.006, 0.015], c: 0.002 }), chain(T(0, 0.13, 0.036), mat({ rot: [-30, 0, 0] }))), 'brass', { seed: seed + 3 }));
  return out;
}
