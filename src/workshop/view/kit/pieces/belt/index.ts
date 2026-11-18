/**
 * The belt (REWRITE.md § B1 "The belt", § D5; art-direction § 10 BELT).
 * Registry name `belt`. The room's clock: a length of conveyor along the
 * front of the bench that carries whatever is on it, left to right.
 *
 * Seen from the front and about 33° above, so the detail is spent on the
 * near rail, the belt's top and the motor housing's front and top; the far
 * rail is the same channel turned round, and nothing is modelled under the
 * belt or behind it that the camera cannot see.
 *
 *  - Two side rails of `teal-panel` enamel channel (the near one opens
 *    toward the visitor, so its recess holds the idlers' shaft nuts, the
 *    drums' brass bearings, a bolted splice and the take-up), on stout
 *    flared legs with bolted feet.
 *  - The belt: `ink` rubber in the `belt` class (its ribs scroll in the
 *    material), swept round the two end drums; a laced seam of steel clips
 *    (node `seam`) that rides the loop so the motion reads.
 *  - Rollers: `roller0` the drive drum (left), `roller<n-1>` the tail drum
 *    (right, on the take-up), and between them the return idlers that hang
 *    under the near rail; each node turns about its local Z (the axle,
 *    pointing at the visitor) and holds only its brass end cap, one draw
 *    call each. `beltRollers(length)` lists them with their radii.
 *  - The motor housing at the left end (motor.ts): the control panel with
 *    blank brass plates at sockets `dial` and `lever`, the line's lamp
 *    (node `lamp`, `bulb` class, unlit), a finned motor on top; a
 *    `tape-yellow` chain guard from the gearbox to the drive drum.
 *  - At the right end: the take-up (a brass bearing block on a tension
 *    bolt), an oil cup, and a little guard rail of bent rod round the drum.
 *
 * Height of the carrying surface: BELT.topY (0.5). Sockets: `dial`,
 * `lever`, `lamp`, `surface` (the middle of the carrying surface, +Y up),
 * `in` / `out` (the carrying surface's left and right ends).
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { aim, chain, mat, part, piece, place, T } from '../../compose.ts';
import { extrude, lathe, profiledBox, roundedBox, slab } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath, sections } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import { BELT, DEFLECT } from './dims.ts';
import { buildDeflector } from './deflector.ts';
import { loopGeom, loopPoints } from './loop.ts';
import { buildMotor, dentKeep, oilCup } from './motor.ts';
import { HIDDEN, MARKS, NAMED_POSES, parsePose, posePiece } from './pose.ts';
import type { BeltPose, RollerInfo } from './pose.ts';

export { BELT } from './dims.ts';
export { loopGeom, loopAt, topRunS } from './loop.ts';
export { poseBelt, posePiece, seamMatrix, markMatrix, parsePose, NAMED_POSES, SEAM_X0, MARKS, HIDDEN } from './pose.ts';
export { DIAL, LEVER, dialAngle, leverAngle } from './controls.ts';
export { DEFLECT } from './dims.ts';
export { deflectorAt } from './deflector.ts';
export type { BeltPose, RollerInfo } from './pose.ts';

export interface BeltOptions extends KitOptions {
  /** Overall length, belt end to belt end (default 6). The motor housing stands beyond the left end. */
  length?: number;
  /** Build already posed (a name from NAMED_POSES, a pose, or `dial:2.5,lever:-1,travel:0.4,lamp:1`). */
  pose?: string | BeltPose;
  /**
   * The whole line's belt (the bench): everything below on. Each can still be set on its own.
   * Off (the default) is the belt approved at G1, as the vignette builds it.
   */
  line?: boolean;
  /** The control face: a real speed dial and direction lever and the lamp on a taller desk (default: blank plates). */
  controls?: boolean;
  /** The deflector at the motor end and the slide off the back (default off). */
  deflector?: boolean;
  /** 'rail': the bent guard rail round the tail drum (default); 'ramp': left off, for the dock's roller ramp. */
  tail?: 'rail' | 'ramp';
  /** Painted tracking stripes riding the belt with the laced seam, so its motion reads at any speed (default off). */
  marks?: boolean;
}

/** The nodes of a belt that move (a view keeps these out of any static merge): rollers, seam, marks, dial, lever, lamp. */
export const BELT_MOVING = /^(roller\d+|seam|mark\d+|dial|lever|lamp)$/;

const RET_R = 0.045; // return idler radius

/** The rollers of a belt `length` long: the drive drum, the return idlers, the tail drum. */
export function beltRollers(length: number = BELT.defaultLength): RollerInfo[] {
  const g = loopGeom(length);
  const half = g.span / 2;
  const out: RollerInfo[] = [{ name: 'roller0', x: -half, y: g.axisY, r: BELT.drumR + BELT.thickness, sense: 1 }];
  // a return idler every 2.2 under a short belt, every 3.2 under a long one (they cost triangles and hang in the shadow)
  const n = Math.max(1, Math.round(g.span / (g.span > 6.5 ? 3.2 : 2.2)));
  const yRet = g.axisY - g.r - BELT.thickness / 2 - RET_R;
  for (let i = 0; i < n; i++) {
    const x = -half + (g.span * (i + 0.5)) / n + (i % 2 ? 0.17 : -0.11);
    out.push({ name: `roller${i + 1}`, x, y: yRet, r: RET_R, sense: -1 });
  }
  out.push({ name: `roller${n + 1}`, x: half, y: g.axisY, r: BELT.drumR + BELT.thickness, sense: 1 });
  return out;
}

/** A rail: the channel section extruded along X. `side` 1 is the near rail (opening toward +Z), -1 the far one. */
function railGeom(x0: number, x1: number, side: 1 | -1, detail: 'high' | 'low'): BufferGeometry {
  const zi = BELT.railIn, d = BELT.railDepth, w = BELT.railWeb, f = BELT.railFlange, y0 = BELT.railBottom, y1 = BELT.railTop;
  const zy: Array<[number, number]> = [
    [zi + d, y0], [zi, y0], [zi, y1], [zi + d, y1], [zi + d, y1 - f], [zi + w, y1 - f], [zi + w, y0 + f], [zi + d, y0 + f],
  ];
  const radii = [0.016, 0.03, 0.03, 0.018, 0.012, 0.016, 0.016, 0.012];
  const outline = zy.map(([z, y]) => [-side * z, y] as [number, number]);
  const len = x1 - x0;
  const g = extrude(outline, len, { radius: radii, bevel: 0.012, segs: 1, detail, band: 0 });
  transform(g, chain(T(x0, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
  return grain(g, 'x');
}

export function belt(o: BeltOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const L = o.length ?? BELT.defaultLength;
  const controls = o.controls ?? o.line ?? false;
  const deflect = o.deflector ?? o.line ?? false;
  const tail = o.tail ?? (o.line ? 'ramp' : 'rail');
  const marks = o.marks ?? o.line ?? false;
  const R = rng(seed);
  const b = piece('belt', { detail, seed });
  const g = loopGeom(L);
  const half = g.span / 2;
  const zi = BELT.railIn, zo = BELT.railIn + BELT.railDepth, zw = BELT.railIn + BELT.railWeb;
  const yR0 = BELT.railBottom, yR1 = BELT.railTop, fl = BELT.railFlange;
  const rails = { x0: -half - 0.1, x1: half + 0.1 };

  // ======================================================================
  // LARGE: the belt, the two rails, the legs, the motor housing
  // ======================================================================
  {
    const t = BELT.thickness, wdt = BELT.width;
    const c = Math.min(t * 0.45, wdt * 0.1);
    const pts = loopPoints(g, hi ? (L > 7 ? 2.5 : 1.5) : 2.5, 6).map(([x, y]) => new Vector3(x, y, 0));
    const gg = sweep({ points: pts, closed: true }, { section: sections.roundRect(wdt / 2 - c, t / 2 - c, 1), radius: c, up: [0, 0, 1], uv: true });
    b.add(part('belt', gg, 'ink', { seed: seed + 1, shade: 0.55 }));
  }
  {
    const near = railGeom(rails.x0, rails.x1, 1, detail);
    // a knock on the near rail's top edge
    dentKeep(near, [R.range(-1.5, 1.5), yR1, zo], [0, 1, -1], 0.1, 0.012);
    b.add(part('steel', near, 'teal-panel', { seed: seed + 2, shade: 1.12, jitter: 0.03 }));
    // the far rail: only its top and its face toward the belt are ever seen, so a chamfered bar does
    // with the deflector, the far rail stops short of the motor end: the gap is the way off the back
    const farX0 = deflect ? -L / 2 + DEFLECT.gap : rails.x0;
    const far = bevelBox({ min: [farX0, yR0, -zo], max: [rails.x1, yR1, -zi], c: 0.02, omit: ['nz', 'ny'], band: 0.02 });
    b.add(part('steel', grain(far, 'x'), 'teal-panel', { seed: seed + 3, shade: 1.0, jitter: 0.03 }));
  }
  // legs under the near rail: stout flared posts on bolted feet
  {
    const n = Math.max(2, Math.ceil((g.span - 0.6) / BELT.legPitch) + 1);
    const xa = -half + 0.32, xb = half - 0.32;
    const zc = (zi + zo) / 2;
    for (let i = 0; i < n; i++) {
      const x = xa + ((xb - xa) * i) / (n - 1) + (i > 0 && i < n - 1 ? R.spread(0.15) : 0);
      const h = yR0 + 0.004 - 0.03;
      // a turned post, octagonal and squashed to the old 0.13 × 0.1 plan: under the rail, in its shadow, 13 px wide
      const leg = lathe(
        profile(0, 0)
          .to(0.08, 0, { sharp: true })
          .to(0.072, 0.02, { sharp: true })
          .to(0.04, 0.075, { fillet: 0.04, segs: 1 })
          .to(0.036, h - 0.03, { smooth: true })
          .to(0.056, h, { sharp: true }),
        { segs: 6, detail, band: 0, caps: 'end' },
      );
      b.add(part('steel', transform(leg, chain(T(x, 0.03, zc), mat({ rot: [0, 30 + R.spread(1.5), R.spread(0.8)] }), new Matrix4().makeScale(1.0, 1, 0.78))), 'teal-panel', { seed: seed + 10 + i, shade: 0.95, jitter: 0.04 }));
      // the foot plate and its four bolts
      const foot = bevelBox({ min: [-0.15, 0, -0.125], max: [0.15, 0.032, 0.125], c: 0.012, omit: ['ny'] });
      b.add(part('steel', transform(foot, chain(T(x, 0, zc + 0.01), mat({ rot: [0, R.spread(3), 0] }))), 'teal-panel', { seed: seed + 20 + i, shade: 0.8 }));
      // the front two bolts (the back two are under the rail, in its shadow: not modelled)
      for (const sx of [-1, 1]) {
        const gg = transform(stud(0.026, 0.024, 6), T(x + sx * 0.112, 0.03, zc + 0.095));
        b.small(() => [part('metal', gg, 'steel', { seed: seed + 30 + i, jitter: 0.08 })]);
      }
    }
  }
  // the motor housing at the left end
  const motor = buildMotor(b, -L / 2 - BELT.motorGap, seed + 1000, R, detail, controls);

  // ======================================================================
  // MEDIUM: drums' bearings, the chain guard, idler nuts, the splice, the
  // take-up, return idlers, the guard rail at the right end
  // ======================================================================
  const rollers = beltRollers(L);
  const drumL = rollers[0]!, drumR = rollers[rollers.length - 1]!;
  const brassCap = (r: number, h: number): BufferGeometry =>
    lathe(
      profile(r, 0).to(r, h * 0.45, { sharp: true }).to(r * 0.78, h * 0.6, { sharp: true }).to(r * 0.7, h, { fillet: h * 0.3, segs: 1 }).to(0, h),
      { segs: 7, detail, band: 0, caps: false },
    );
  // the chain guard: a stadium of yellow enamel from the gearbox sprocket to the drive drum, proud of everything
  const guardZ = Math.max(zo, 0.71) + 0.01;
  {
    const [sx, sy] = motor.sprocket;
    const ax = drumL.x, ay = drumL.y;
    const ra = 0.15, rb = 0.125;
    const ang = Math.atan2(ay - sy, ax - sx);
    const pts: Array<[number, number]> = [];
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const a = ang - Math.PI / 2 + (Math.PI * i) / n;
      pts.push([ax + Math.cos(a) * ra, ay + Math.sin(a) * ra]);
    }
    for (let i = 0; i <= n; i++) {
      const a = ang + Math.PI / 2 + (Math.PI * i) / n;
      pts.push([sx + Math.cos(a) * rb, sy + Math.sin(a) * rb]);
    }
    const gd = 0.07;
    const gg = extrude(pts, gd, { radius: 0.03, bevel: 0.018, bevelBase: 0, caps: 'end', segs: 2, detail, band: 0 });
    // pillow the face a little, so the lamp rolls across it instead of lying flat on it
    deform(gg, (x, y, z) => {
      const ex = ax - sx, ey = ay - sy;
      const t = Math.max(0, Math.min(1, ((x - sx) * ex + (y - sy) * ey) / (ex * ex + ey * ey)));
      const d = Math.hypot(x - (sx + ex * t), y - (sy + ey * t));
      const rr = rb + (ra - rb) * t;
      const f = Math.max(0, 1 - (d / rr) ** 2);
      return [x, y, z + 0.016 * f * Math.max(0, z / gd)];
    }, { keepSurf: true });
    transform(gg, T(0, 0, guardZ));
    dentKeep(gg, [sx + 0.05, sy - 0.06, guardZ + gd], [0.3, 0, 1], 0.06, 0.01);
    b.add(part('steel', gg, 'tape-yellow', { seed: seed + 40, shade: 0.9 }));
    // standoffs behind it (seen at its edges) and two screws holding it on
    for (const [px, py] of [[sx, sy], [ax, ay]] as const) {
      b.add(part('metal', transform(lathe(profile(0, 0).to(0.03, 0).to(0.03, guardZ - zo + 0.01).to(0, guardZ - zo + 0.01), { segs: 8, detail, band: 0, caps: false }), aim([px, py, zo - 0.005], [0, 0, 1])), 'steel', { shade: 0.6 }));
    }
    const midx = (sx + ax) / 2, midy = (sy + ay) / 2;
    for (const k of [-1, 1]) {
      b.small(() => [part('metal', transform(stud(0.016, 0.01, 6), aim([midx + Math.cos(ang + Math.PI / 2) * k * 0.085, midy + Math.sin(ang + Math.PI / 2) * k * 0.085, guardZ + gd], [0, 0, 1])), 'steel', { seed: seed + 41 })]);
    }
    // the drive drum's bearing flange on the guard's face
    const fg = lathe(profile(0, 0).to(0.075, 0, { sharp: true }).to(0.075, 0.016, { fillet: 0.006, segs: 1 }).to(0.05, 0.022, { sharp: true }).to(0.045, 0.04, { fillet: 0.008, segs: 1 }).to(0, 0.04), { segs: 8, detail, band: 0, caps: 'end' });
    b.add(part('brass', transform(fg, aim([ax, ay, guardZ + gd - 0.004], [0, 0, 1])), 'brass', { seed: seed + 42, warm: 0.03 }));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      b.small(() => [part('metal', transform(hexHead(0.026, 0.014, R.range(0, 1)), aim([ax + Math.cos(a) * 0.062, ay + Math.sin(a) * 0.062, guardZ + gd + 0.012], [0, 0, 1])), 'steel', { seed: seed + 43 })]);
    }
  }
  // roller0: the drive drum's shaft end, a brass collar and nut on the guard's bearing
  {
    const n0 = b.node('rollers');
    const capAt = (x: number, y: number, z: number): Matrix4 => T(x, y, z);
    const d0 = n0.node(drumL.name, capAt(drumL.x, drumL.y, guardZ + 0.07 + 0.036));
    d0.add(part('brass', transform(brassCap(0.036, 0.04), new Matrix4().makeRotationX(Math.PI / 2)), 'brass', { seed: seed + 44, warm: 0.04 }));
    d0.add(setFinish(part('brass', transform(hexHead(0.034, 0.02, 0), chain(T(0, 0, 0.038), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: seed + 45 }), 0.5));
    // a set screw on the collar: an off-centre bump that shows it turning
    d0.add(part('brass', transform(stud(0.008, 0.012, 6), chain(T(0, 0.036, 0.02), new Matrix4())), 'brass', { seed: seed + 46 }));

    // the tail drum (right) rides a take-up block in the near rail's recess
    const dz = zw;
    const blk = bevelBox({ min: [-0.11, -0.065, 0], max: [0.11, 0.065, 0.06], c: 0.012, omit: ['nz'] });
    b.add(part('brass', transform(blk, T(drumR.x - 0.02, drumR.y, dz)), 'brass', { seed: seed + 47, shade: 0.85, warm: 0.03 }));
    // the slot it slides in: a dark strip on the web, longer than the block
    b.add(part('steel', transform(slab({ w: 0.36, d: 0.05, t: 0.004, r: 0.02, bevel: 0.0015, detail: 'low', band: 0, open: true }), chain(T(drumR.x - 0.06, drumR.y, dz + 0.001), mat({ rot: [90, 0, 0] }))), 'ink', { shade: 0.6 }));
    const d1 = n0.node(drumR.name, capAt(drumR.x, drumR.y, dz + 0.06));
    d1.add(part('brass', transform(brassCap(0.034, 0.034), new Matrix4().makeRotationX(Math.PI / 2)), 'brass', { seed: seed + 48, warm: 0.04 }));
    d1.add(part('brass', transform(stud(0.008, 0.012, 6), T(0, 0.032, 0.02)), 'brass', { seed: seed + 49 }));
    // the tension bolt: from the block out through a bracket at the rail's end, two nuts
    const ty = drumR.y - 0.035;
    const bx0 = drumR.x + 0.09, bx1 = rails.x1 + 0.06;
    const rodG = lathe(profile(0.013, 0).to(0.013, bx1 - bx0 + 0.06).to(0, bx1 - bx0 + 0.06), { segs: 6, detail, band: 0, caps: false });
    b.add(part('metal', transform(rodG, aim([bx0, ty, dz + 0.03], [1, 0, 0])), 'steel', { seed: seed + 50 }));
    const brk = bevelBox({ min: [0, -0.07, -0.06], max: [0.03, 0.05, 0.05], c: 0.008 });
    b.add(part('steel', transform(brk, T(rails.x1 - 0.005, ty, dz + 0.03)), 'teal-panel', { seed: seed + 51, shade: 0.9 }));
    for (const nx of [rails.x1 - 0.03, rails.x1 + 0.055]) b.add(part('metal', transform(hexHead(0.044, 0.026, R.range(0, 1)), aim([nx, ty, dz + 0.03], [nx > rails.x1 ? 1 : -1, 0, 0])), 'steel', { seed: seed + 52, jitter: 0.06 }));

    // return idlers: hung from drop brackets under the near rail; the brass cap is the node
    for (const r of rollers.slice(1, -1)) {
      // the idler's tube (static: under the belt, only its front end is ever seen)
      const tube = lathe(profile(RET_R, 0).to(RET_R, 0.3, { sharp: true }), { segs: 6, detail, band: 0, caps: false });
      b.add(part('metal', transform(tube, aim([r.x, r.y, zw + 0.01], [0, 0, -1])), 'steel', { seed: seed + 60, shade: 0.85 }));
      // a drop bracket: a bent strap from under the rail's bottom flange down past the axle
      const bracket = bevelBox({ min: [-0.045, r.y - 0.06, zo - 0.02], max: [0.045, yR0 + 0.004, zo + 0.006], c: 0.01, omit: ['nz', 'py'] });
      b.add(part('steel', transform(bracket, T(r.x, 0, 0)), 'teal-panel', { seed: seed + 61, shade: 0.9 }));
      b.add(part('metal', transform(stud(0.018, 0.012, 6), aim([r.x, yR0 - 0.02, zo + 0.006], [0, 0, 1])), 'steel', { seed: seed + 62 }));
      const nd = n0.node(r.name, T(r.x, r.y, zo + 0.006));
      nd.add(part('brass', transform(brassCap(0.03, 0.03), new Matrix4().makeRotationX(Math.PI / 2)), 'brass', { seed: seed + 63, warm: 0.04 }));
      nd.add(part('brass', transform(stud(0.007, 0.01, 6), T(0, 0.026, 0.018)), 'brass', { seed: seed + 64 }));
    }
  }
  // carrying idlers: their tubes are under the belt (not modelled); their fixed shaft ends show in the near rail's recess
  {
    const yI = BELT.topY - BELT.thickness - 0.045;
    const pitch = L > 7 ? 0.62 : 0.48;
    const n = Math.floor((g.span - 0.3) / pitch);
    const x0 = -((n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch;
      if (Math.abs(x) < 0.25 && L >= 4) continue; // the splice plate is here
      const gg = transform(stud(0.026, 0.02, 5), aim([x, yI, zw], [0, 0, 1]));
      b.add(part('metal', gg, 'steel', { seed: seed + 70 + i, jitter: 0.07 }));
    }
    // the drive drum's own bearing on the near rail (behind the guard) is not seen; the far rail's not at all
  }
  // the splice: the rails come in two lengths, joined by a bolted fish plate in the recess
  if (L >= 4) {
    const sp = bevelBox({ min: [-0.2, yR0 + fl + 0.008, zw], max: [0.2, yR1 - fl - 0.008, zw + 0.018], c: 0.006 });
    b.add(part('steel', transform(sp, T(0.03, 0, 0)), 'teal-panel', { seed: seed + 80, shade: 0.85 }));
    const ys = [yR0 + fl + 0.05, yR1 - fl - 0.05];
    for (const x of L > 7 ? [-0.13, 0.19] : [-0.13, -0.05, 0.11, 0.19]) for (const y of ys) {
      b.small(() => [part('metal', transform(stud(0.02, 0.016, 6), aim([x, y, zw + 0.018], [0, 0, 1])), 'steel', { seed: seed + 81, jitter: 0.07 })]);
    }
    // the joint itself: a hairline in the rail's top flange
    b.add(part('steel', transform(bevelBox({ min: [-0.003, yR1 - 0.0005, zi + 0.01], max: [0.003, yR1 + 0.001, zo - 0.01] }), T(0.03, 0, 0)), 'ink'));
  }
  // an oil cup on the near rail's top flange over the tail drum's bearing
  b.add(place(oilCup(seed + 90, detail), chain(T(drumR.x - 0.05, yR1, (zi + zo) / 2 + 0.01), mat({ rot: [R.spread(4), 0, R.spread(4)] }))));
  // a brass maker's plate on the near rail's top flange front, two rivets
  {
    const px = -half * 0.45 + R.spread(0.2);
    const pl = slab({ w: 0.3, d: fl - 0.012, t: 0.006, r: 0.012, bevel: 0.002, detail: 'low', band: 0, open: true });
    b.add(setFinish(part('brass', transform(pl, chain(T(px, yR1 - fl / 2, zo + 0.001), mat({ rot: [90, 0, R.spread(1.2)] }))), 'brass', { seed: seed + 91, warm: 0.03 }), 0.3));
    for (const sx of [-1, 1]) b.small(() => [part('brass', transform(stud(0.009, 0.006, 6), aim([px + sx * 0.125, yR1 - fl / 2, zo + 0.007], [0, 0, 1])), 'brass', { seed: seed + 92 })]);
  }
  // the guard rail at the right end: a bent rod round the tail drum, below the carrying surface, on brass collars
  if (tail === 'rail') {
    const y = BELT.topY - 0.03;
    const xe = rails.x1 - 0.02;
    const reach = half + g.r + 0.2;
    const z0 = zo - 0.02;
    const pts: Array<[number, number, number]> = [[xe, y, z0], [reach - 0.02, y, z0], [reach + 0.05, y, z0 - 0.15], [reach + 0.05, y, -z0 + 0.15], [reach - 0.02, y, -z0], [xe, y, -z0]];
    b.add(part('metal', sweep(polylinePath(pts, 0.12, hi ? 3 : 2), { radius: 0.027, detail, segs: 6, ends: 'flat' }), 'steel', { seed: seed + 95, shade: 1.05 }));
    // a drop leg from the front corner to the bench, so it is not hanging in the air
    b.add(part('metal', sweep(polylinePath([[reach - 0.02, y, z0], [reach + 0.01, y * 0.5, z0 + 0.03], [reach + 0.02, 0.02, z0 + 0.04]], 0.1, 2), { radius: 0.017, detail, segs: 6, ends: 'flat' }), 'steel', { seed: seed + 96 }));
    b.add(part('brass', transform(lathe(profile(0, 0).to(0.04, 0, { sharp: true }).to(0.04, 0.012, { fillet: 0.005, segs: 1 }).to(0.026, 0.02, { fillet: 0.005, segs: 1 }).to(0.024, 0.05, { fillet: 0.008, segs: 1 }).to(0, 0.05), { segs: 10, detail, band: 0 }), T(reach + 0.02, 0, z0 + 0.04)), 'brass', { seed: seed + 97 }));
    for (const z of [z0, -z0]) b.add(part('brass', transform(lathe(profile(0, 0).to(0.032, 0, { sharp: true }).to(0.032, 0.05, { fillet: 0.008, segs: 1 }).to(0, 0.05), { segs: 10, detail, band: 0 }), aim([xe - 0.03, y, z], [1, 0, 0])), 'brass', { seed: seed + 98 }));
  }

  // ======================================================================
  // SMALL: the laced seam, the lamp
  // ======================================================================
  {
    const seam = b.node('seam');
    const t2 = BELT.thickness / 2;
    const n = hi ? (L > 7 ? 7 : 8) : 6;
    const span = BELT.width - 0.1;
    for (let i = 0; i < n; i++) {
      const z = -span / 2 + (span * i) / (n - 1);
      const clip = bevelBox({ min: [-0.034, t2 - 0.002, z - 0.018], max: [0.034, t2 + 0.01, z + 0.018], c: 0.004, omit: ['ny'] });
      seam.add(part('metal', clip, 'steel', { seed: seed + 200 + i, shade: 0.95, jitter: 0.08 }));
    }
    const pin = lathe(profile(0, 0).to(0.006, 0).to(0.006, span + 0.04).to(0, span + 0.04), { segs: 6, detail: 'low', band: 0 });
    seam.add(part('metal', transform(pin, aim([0, t2 + 0.011, -span / 2 - 0.02], [0, 0, 1])), 'steel', { seed: seed + 199, shade: 1.1 }));
  }
  // painted tracking stripes: tape-yellow bands across the belt that ride the loop with the seam (pose.ts places them)
  if (marks) {
    const t2 = BELT.thickness / 2;
    for (let k = 1; k <= MARKS; k++) {
      const m = b.node(`mark${k}`);
      const w = BELT.width - 0.05;
      const g0 = bevelBox({ min: [-0.045, t2 - 0.001, -w / 2], max: [0.045, t2 + 0.0035, w / 2], c: 0.002, omit: ['ny'] });
      m.add(part('steel', g0, 'tape-yellow', { seed: seed + 210 + k, shade: 0.8, jitter: 0.05 }));
    }
  }
  // the station lamp: a dark lens (unlit) and its lit twin, one hidden at a time (pose.ts)
  {
    const lamp = b.node('lamp', motor.lamp);
    const lr = controls ? 0.036 : 0.026;
    const gl = lathe(profile(lr, 0).to(lr, 0.008, { sharp: true }).curve(0, lr * 1.15, lr * 0.85, lr * 1.15, 3), { segs: 10, detail, band: 0, caps: false });
    const lens = (lit: boolean): KitPart => {
      const gg = transform(gl.clone(), new Matrix4().makeRotationX(Math.PI / 2));
      // unlit: a dark cut of the glow token; lit: the glow itself at the indicator level
      return lit ? setFinish(part('bulb', gg, 'amber-glow', { seed: seed + 230 }), 1) : setFinish(part('bulb', gg, 'amber', { shade: 0.08 }), 1);
    };
    lamp.node('lamp.lit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)).add(lens(true));
    lamp.node('lamp.unlit').add(lens(false));
  }
  // the way off the motor end
  const off = deflect ? buildDeflector(b, -L / 2, seed + 400, R, detail) : null;

  b.socket('dial', motor.dial);
  b.socket('lever', motor.lever);
  b.socket('lamp', motor.lamp);
  if (motor.dialGrip) b.socket('dial.grip', motor.dialGrip);
  if (motor.leverGrip) b.socket('lever.grip', motor.leverGrip);
  b.socket('surface', T(0, BELT.topY, 0));
  b.socket('in', T(-half, BELT.topY, 0));
  b.socket('out', T(half, BELT.topY, 0));
  // where the dock's roller ramp begins: the belt's bed end, heading +X
  if (tail === 'ramp') b.socket('ramp', T(L / 2, BELT.topY, 0));
  if (off) {
    b.socket('off.back', off.offBack);
    b.socket('deflector', off.face);
  }
  void DEFLECT;
  const built = b.build();
  posePiece(built.root, L, rollers, {});
  if (o.pose) {
    const p = typeof o.pose === 'string' ? (NAMED_POSES[o.pose] ?? parsePose(o.pose)) : o.pose;
    if (!p) throw new Error(`belt: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')}, or 'dial:2,lever:-1,travel:0.5,lamp:1')`);
    posePiece(built.root, L, rollers, p);
  }
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'belt',
    build: (opts = {}) =>
      belt({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['length'] === 'number' ? { length: opts['length'] } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
        ...(typeof opts['line'] === 'boolean' ? { line: opts['line'] } : {}),
        ...(typeof opts['controls'] === 'boolean' ? { controls: opts['controls'] } : {}),
        ...(typeof opts['deflector'] === 'boolean' ? { deflector: opts['deflector'] } : {}),
        ...(opts['tail'] === 'rail' || opts['tail'] === 'ramp' ? { tail: opts['tail'] } : {}),
        ...(typeof opts['marks'] === 'boolean' ? { marks: opts['marks'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, 'length 10': { length: 10 }, line: { length: 10, line: true }, 'line 6': { line: true }, 'line 12': { length: 12, line: true } },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 9 },
    note: 'The belt: the room’s clock. Carries whatever is on it, left to right.',
  },
];
