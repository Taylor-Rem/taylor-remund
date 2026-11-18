/**
 * The dock (REWRITE.md § B1 "The dock": ships it, out, with a bell; § D 7;
 * § B2 X3: a shipped crate comes back in through the dock door). Registry
 * name `dock`. ART-P2 § 5 "THE DOCK".
 *
 * The one place on the bench where things LEAVE. A tall `teal-panel`
 * enamel portal on two posts that stand on the bench, a rounded drum
 * housing across their tops, hazard-striped post fronts with fat rubber
 * bumpers, a `tape-yellow` threshold plate in `ink` chevrons pointing in, a
 * corrugated steel roll-up shutter that rises into the housing, a brass
 * bell on a sprung strap, the station lamp in a wire cage on top, and a
 * lean-to bay behind with darkness inside (a rubber strip curtain hangs in
 * it). A curved roller ramp comes off the belt's end along +X at the belt's
 * height, runs straight, bends into the door and falls to the sill, so a
 * part rides square into the bay.
 *
 * The opening (DOCK.openW × DOCK.openH, 1.48 × 1.7) passes a robot 1.6 tall
 * and 1.25 wide. The bay is turned toward the camera by `turn` degrees
 * (default 40: a +Z-facing bay yawed -50°); place the piece with no yaw.
 * Everything of the bay hangs under the static node `bay` (the door's
 * frame: door-local +Z out of the door); the ramp is in the root.
 *
 * Moving nodes (pose.ts `poseDock`):
 *  - `door.0` (the bottom bar) .. `door.<n>`: the shutter's slats; they rise
 *    together and are collapsed inside the housing once in.
 *  - `bell` (swings about its local Z) and its child `bell.clapper`.
 *  - `flap`: the rubber curtain in the bay (its local X is the hinge).
 *  - `lamp.lit` / `lamp.unlit` under `lamp`.
 *  - `ramp.roller0..n`: the ramp's rollers, turning about their local Y.
 *
 * Sockets (root space): `belt` (where the belt's bed end is), `in` (the
 * ramp's first roller top, heading +X), `ramp.mid`, `threshold` (where the
 * ramp meets the sill, oriented as the door: its -Z points into the bay),
 * `vanish` (where a shipped part is out of sight), `return` (where a
 * returned part appears, its +Z pointing out of the door), `door` (the
 * middle of the sill, door frame), `bell`, `lamp`.
 */
import { Matrix4, Vector3 } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { aim, chain, part, piece, T } from '../../compose.ts';
import { extrude, lathe, profiledBox, roundedBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath, sections } from '../../sweep.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, innerBox, stripes, stud } from '../../cheap.ts';
import { DOCK, doorFrame, rampAt, rampGeom } from './dims.ts';
import type { RampGeom } from './dims.ts';
import { dentKeep, paintPoly, slatGeom } from './geo.ts';
import { HIDDEN, NAMED_POSES, poseDock, slats } from './pose.ts';
import type { DockPose } from './pose.ts';

export { DOCK, doorFrame, doorNormal, fitRamp, rampAt, rampGeom } from './dims.ts';
export type { RampGeom, RampPoint } from './dims.ts';
export { poseDock, slats, slatMatrix, NAMED_POSES, HIDDEN, DOOR_TRAVEL, LIP_Y, rollerNames } from './pose.ts';
export type { DockPose, SlatInfo } from './pose.ts';

export interface DockOptions extends KitOptions {
  /** How far the bay is turned toward the camera, degrees from facing -X (default DOCK.turn = 40, i.e. yaw -50). */
  turn?: number;
  /** Where the ramp starts (the belt's bed end plus a gap), [dx, dz] from the door's origin (default DOCK.reach). */
  reach?: readonly [number, number];
  /** Build already posed (a name from NAMED_POSES, or a pose). */
  pose?: string | DockPose;
}

/** The ramp's rollers: distance along the ramp of each. */
export function rampRollers(g: RampGeom = rampGeom()): number[] {
  const out: number[] = [];
  const n = Math.max(2, Math.round((g.length - 0.12) / DOCK.rollerPitch));
  for (let i = 0; i <= n; i++) out.push(0.06 + ((g.length - 0.14) * i) / n);
  return out;
}

const Z_UP = new Matrix4().makeRotationX(Math.PI / 2); // a slab's +Y turned to face +Z
const Y90 = new Matrix4().makeRotationY(Math.PI / 2);

/** An outline drawn in (z, y), extruded `len` along +X from x0 (the extrude's face toward -X... both faces kept). */
function sideExtrude(zy: ReadonlyArray<readonly [number, number]>, x0: number, len: number, o: Parameters<typeof extrude>[2]): ReturnType<typeof extrude> {
  const g = extrude(zy.map(([z, y]) => [-z, y] as [number, number]), len, o);
  return transform(g, chain(T(x0, 0, 0), Y90));
}

export function dock(o: DockOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const turn = o.turn ?? DOCK.turn;
  const R = rng(seed);
  const b = piece('dock', { detail, seed });
  const Df = doorFrame(turn);
  const bay = b.node('bay', Df);

  const W = DOCK.openW, H = DOCK.openH, yS = DOCK.sillY;
  const jw = DOCK.jambW;
  const yTop = yS + H;
  const xJ = W / 2 + jw / 2; // post centres
  const xO = W / 2 + jw; // the portal's outer edge
  const jz0 = -0.14, jz1 = 0.2; // the posts' back and front
  const hY0 = yTop, hY1 = yTop + DOCK.housingH;
  const hz0 = -0.24, hz1 = 0.3;
  const hx = xO + 0.05;
  const wallX = xO - 0.06;
  const wallT = 0.09;
  const zBack = -DOCK.bayDepth;

  // ======================================================================
  // LARGE: the posts, the drum housing, the lean-to bay and its dark
  // ======================================================================
  for (const sx of [-1, 1] as const) {
    const r = 0.03, h = yTop + 0.02;
    const g = profiledBox(
      { w: jw, d: jz1 - jz0, rPlan: r, detail },
      profile(0, 0)
        .to(r + 0.04, 0, { sharp: true })
        .to(r + 0.04, 0.035, { fillet: 0.01, segs: 1 })
        .to(r, 0.09, { fillet: 0.035, segs: 1 })
        .to(r, h, { sharp: true })
        .to(0, h),
    );
    transform(g, T(sx * xJ, 0, (jz0 + jz1) / 2));
    dentKeep(g, [sx * (xJ - jw / 2) + R.spread(0.02), 1.2 + R.range(0, 0.3), jz1], [-sx * 0.5, 0, 1], 0.07, 0.012);
    bay.add(part('steel', g, 'teal-panel', { seed: seed + 1 + (sx > 0 ? 1 : 0), shade: 1.1, jitter: 0.03 }));
  }
  {
    // the housing: its front rolled over into the top, a little proud of the posts
    const g = sideExtrude([[hz0, hY0], [hz1, hY0], [hz1, hY1], [hz0, hY1]], -hx, 2 * hx, { radius: [0.02, 0.03, 0.2, 0.05], bevel: 0.026, segs: 2, detail });
    grain(g, 'x');
    dentKeep(g, [-hx * 0.35 + R.spread(0.1), hY1 - 0.03, hz1 - 0.1], [0, 1, 0.7], 0.1, 0.014);
    bay.add(part('steel', g, 'teal-panel', { seed: seed + 3, shade: 1.18, jitter: 0.03 }));
  }
  const yWallF = yTop + 0.12, yWallB = yTop + 0.0;
  const zWallF = jz0 + 0.02;
  {
    // the near wall (+X, toward the visitor) is a bevelled slab; the far one is never seen face on
    const g = sideExtrude([[zWallF, 0], [zBack, 0], [zBack, yWallB], [zWallF, yWallF]], wallX - wallT, wallT, { radius: [0.01, 0.03, 0.04, 0.02], bevel: 0.02, bevelBase: 0, caps: 'end', segs: 1, detail });
    grain(g, 'y');
    dentKeep(g, [wallX, 0.5 + R.range(0, 0.3), zBack + 0.2 + R.range(0, 0.2)], [1, 0, 0], 0.09, 0.012);
    bay.add(part('steel', g, 'teal-panel', { seed: seed + 5, shade: 0.95, jitter: 0.04 }));
    const far = bevelBox({ min: [-wallX, 0, zBack], max: [-wallX + wallT, yWallF, zWallF], c: 0.02, omit: ['ny', 'px'] });
    bay.add(part('steel', far, 'teal-panel', { seed: seed + 4, shade: 0.7, jitter: 0.04 }));
    // the back
    bay.add(part('steel', bevelBox({ min: [-wallX, 0, zBack], max: [wallX, yWallB, zBack + 0.05], c: 0.015, omit: ['ny', 'pz'] }), 'teal-panel', { seed: seed + 9, shade: 0.75 }));
    // the roof: a sheet on the walls' sloping tops, pressed into ribs that run down the slope
    const slope = Math.atan2(yWallF - yWallB, zWallF - zBack);
    const len = Math.hypot(yWallF - yWallB, zWallF - zBack) + 0.1;
    const rf = chain(T(0, (yWallF + yWallB) / 2, (zWallF + zBack) / 2 - 0.02), new Matrix4().makeRotationX(-slope));
    const rw = 2 * wallX + 0.1;
    const roof = roundedBox({ w: rw, h: 0.04, d: len, r: 0.016, rPlan: 0.03, detail: 'low' });
    bay.add(part('steel', transform(roof, rf), 'teal-panel', { seed: seed + 6, shade: 0.9, jitter: 0.03 }));
    const nr = 6;
    for (let i = 0; i < nr; i++) {
      const x = -rw / 2 + 0.13 + ((rw - 0.26) * i) / (nr - 1);
      const rib = bevelBox({ min: [x - 0.035, 0.035, -len / 2 + 0.03], max: [x + 0.035, 0.07, len / 2 - 0.02], c: 0.014, omit: ['ny', 'nz'] });
      bay.add(part('steel', transform(grain(rib, 'z'), rf), 'teal-panel', { seed: seed + 7, shade: 1.0 }));
    }
    // the dark: a box seen from inside, from the shutter back
    bay.add(part('rubber', innerBox([-W / 2 - 0.02, 0.0, zBack + 0.05], [W / 2 + 0.02, yTop - 0.03, jz0]), 'ink', { shade: 0.14 }));
  }

  // ======================================================================
  // MEDIUM: the threshold, hazard cladding, bumpers, the housing's end,
  // guides, the bay wall's panel
  // ======================================================================
  {
    // the threshold: a yellow steel plate on the bench, its nose rolled down, ink chevrons pointing in
    const zf = DOCK.lipZ + 0.015, zb = -0.12;
    const plate = bevelBox({ min: [-W / 2 - 0.02, 0, zb], max: [W / 2 + 0.02, yS, zf], c: 0.016, omit: ['ny', 'nz'], band: 0.012 });
    dentKeep(plate, [W * 0.2 + R.spread(0.05), yS, zf], [0, 1, 0.6], 0.07, 0.008);
    bay.add(part('steel', plate, 'tape-yellow', { seed: seed + 10, shade: 0.95, jitter: 0.03 }));
    const hz = (zf - zb) / 2 - 0.025, hw = W / 4 - 0.02;
    const c0 = R.range(0, 0.04);
    for (const sx of [-1, 1] as const) {
      for (const poly of stripes(hw, hz, 0.08, 0.18, [sx * Math.SQRT1_2, Math.SQRT1_2], c0)) {
        const g = paintPoly(poly, 'xz');
        bay.add(part('steel', transform(g, T(sx * (W / 4), yS + 0.0015, (zf + zb) / 2)), 'ink', { seed: seed + 12, shade: 1.25 }));
      }
    }
    for (const [x, z] of [[-W / 2 + 0.04, zf - 0.045], [W / 2 - 0.04, zf - 0.045], [-W / 2 + 0.04, zb + 0.04], [W / 2 - 0.04, zb + 0.04]] as const) {
      bay.small(() => [part('metal', transform(stud(0.016, 0.006, 6), T(x, yS, z)), 'steel', { seed: seed + 13, shade: 0.9 })]);
    }
  }
  for (const sx of [-1, 1] as const) {
    // hazard cladding on each post's front, the rubber bumper under it, anchor bolts at its foot
    const x = sx * xJ;
    const y0 = 0.42, y1 = 1.12;
    const cw = jw - 0.04;
    bay.add(part('steel', transform(roundedBox({ w: cw, h: 0.014, d: y1 - y0, r: 0.005, rPlan: 0.01, detail: 'low', open: true }), chain(T(x, (y0 + y1) / 2, jz1 - 0.002), Z_UP)), 'tape-yellow', { seed: seed + 20 + sx, shade: 0.95 }));
    for (const poly of stripes(cw / 2 - 0.004, (y1 - y0) / 2 - 0.004, 0.065, 0.14, [sx * Math.SQRT1_2, Math.SQRT1_2], R.range(0, 0.05))) {
      const g = paintPoly(poly, 'xy');
      bay.add(part('steel', transform(g, T(x, (y0 + y1) / 2, jz1 + 0.0135)), 'ink', { seed: seed + 22, shade: 1.25 }));
    }
    const bump = profiledBox(
      { w: cw, d: 0.22, rPlan: 0.035, detail, band: 0 },
      profile(0, 0).to(0.035, 0, { sharp: true }).to(0.035, 0.06, { fillet: 0.02, segs: 1 }).to(0.012, 0.09, { fillet: 0.012, segs: 1 }).to(0, 0.09),
    );
    bay.add(part('rubber', transform(bump, chain(T(x, 0.26, jz1 - 0.005), Z_UP)), 'ink', { seed: seed + 24, shade: 1.7 }));
    for (const dy of [-0.055, 0.055]) bay.small(() => [part('metal', transform(stud(0.02, 0.01, 6), aim([x, 0.26 + dy, jz1 + 0.07], [0, 0, 1])), 'steel', { seed: seed + 25, shade: 0.75 })]);
    bay.small(() => [part('metal', transform(hexHead(0.04, 0.02, R.range(0, 1)), T(x + sx * (jw / 2 + 0.008), 0.035, (jz0 + jz1) / 2)), 'steel', { seed: seed + 26 })]);
  }
  for (const sx of [-1, 1] as const) {
    // the shutter's guides: steel channels on the posts' inner faces
    const x = sx * (W / 2);
    bay.add(part('metal', bevelBox({ min: [Math.min(x, x - sx * 0.03), yS, DOCK.shutterZ - 0.04], max: [Math.max(x, x - sx * 0.03), yTop, DOCK.shutterZ + 0.04], c: 0.008, omit: ['ny', 'py'] }), 'steel', { seed: seed + 30, shade: 0.7 }));
  }
  {
    // the housing's near end: a turned bearing boss where the drum's axle comes out, a brass cap, four bolts
    const at = aim([hx, (hY0 + hY1) / 2, 0.02], [1, 0, 0]);
    const boss = lathe(profile(0, 0).to(0.1, 0, { sharp: true }).to(0.1, 0.016, { fillet: 0.007, segs: 1 }).to(0.064, 0.028, { fillet: 0.01, segs: 1 }).to(0.06, 0.05, { fillet: 0.012, segs: 1 }).to(0, 0.05), { segs: hi ? 14 : 10, detail, band: 0 });
    bay.add(part('steel', transform(boss, at), 'teal-panel', { seed: seed + 32, shade: 0.95 }));
    const cap = lathe(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.018, { fillet: 0.006, segs: 1 }).to(0.026, 0.03, { fillet: 0.008, segs: 1 }).to(0, 0.03), { segs: hi ? 10 : 8, detail, band: 0 });
    bay.add(setFinish(part('brass', transform(cap, chain(at, T(0, 0.05, 0))), 'brass', { seed: seed + 33, warm: 0.03 }), 0.5));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      bay.small(() => [part('metal', transform(hexHead(0.028, 0.013, R.range(0, 1)), chain(at, T(Math.cos(a) * 0.082, 0.016, Math.sin(a) * 0.082))), 'steel', { seed: seed + 34 })]);
    }
    // the housing's front: a seam where its lid lifts off, a row of screws under it
    const ySeam = hY0 + 0.1;
    bay.add(part('rubber', bevelBox({ min: [-hx + 0.04, ySeam - 0.006, hz1 - 0.001], max: [hx - 0.04, ySeam + 0.006, hz1 + 0.004], c: 0.002, omit: ['nz'] }), 'ink', { shade: 0.6 }));
    const n = hi ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const x = -hx + 0.12 + ((2 * hx - 0.24) * i) / (n - 1);
      bay.small(() => [part('metal', transform(stud(0.016, 0.009, 6), aim([x, hY0 + 0.05, hz1], [0, 0, 1])), 'steel', { seed: seed + 36 + i, shade: 0.9, jitter: 0.1 })]);
    }
  }
  {
    // the bay wall toward the visitor: an inset panel, a rivet row along its foot and its top
    const x = wallX;
    const z0 = zBack + 0.1, z1 = zWallF - 0.1;
    const pTop = yWallB - 0.14;
    const pnl = roundedBox({ w: z1 - z0, h: 0.018, d: pTop - 0.32, r: 0.007, rPlan: 0.04, detail: 'low', open: true });
    bay.add(part('steel', transform(pnl, chain(T(x, 0.32 + (pTop - 0.32) / 2, (z0 + z1) / 2), Y90, Z_UP)), 'teal-panel', { seed: seed + 40, shade: 1.04 }));
    for (const y of [pTop + 0.07, 0.17]) {
      const n = hi ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const z = z0 - 0.02 + ((z1 - z0 + 0.04) * i) / (n - 1);
        bay.small(() => [part('metal', transform(stud(0.016, 0.009, 6), aim([x, y, z], [1, 0, 0])), 'steel', { seed: seed + 41, shade: 0.9, jitter: 0.1 })]);
      }
    }
  }

  // ---- the shutter ---------------------------------------------------------
  {
    const sw = W + 0.06;
    for (const [i, s] of slats().entries()) {
      const nd = bay.node(s.name, T(0, s.y0, DOCK.shutterZ));
      if (i === 0) {
        // the bottom bar: a heavier section in lighter enamel, a rubber seal under it, a brass pull
        nd.add(part('steel', grain(bevelBox({ min: [-sw / 2, 0.02, -0.025], max: [sw / 2, s.h, 0.03], c: 0.012, omit: ['nx', 'px'], band: 0.02 }), 'x'), 'teal-light', { seed: seed + 50 }));
        nd.add(part('rubber', bevelBox({ min: [-sw / 2, 0, -0.018], max: [sw / 2, 0.022, 0.022], c: 0.008, omit: ['nx', 'px', 'ny'] }), 'ink', { shade: 1.3 }));
        const pull = sweep(polylinePath([[-0.13, 0.055, 0.03], [-0.11, 0.055, 0.09], [0.11, 0.055, 0.09], [0.13, 0.055, 0.03]], 0.03, 3), { radius: 0.015, detail, segs: 7, ends: 'flat' });
        nd.add(setFinish(part('brass', pull, 'brass', { seed: seed + 51, warm: 0.04 }), 0.6));
        for (const sx of [-1, 1]) nd.add(part('brass', transform(stud(0.03, 0.014, 8), aim([sx * 0.13, 0.055, 0.03], [0, 0, 1])), 'brass', { seed: seed + 52 }));
      } else {
        const g = slatGeom(sw, s.h, 0.024, 0.012, hi ? 5 : 3);
        if (i === 4) dentKeep(g, [-0.3 + R.spread(0.1), s.h * 0.5, 0.03], [0.2, 0, 1], 0.13, 0.018);
        if (i === 11) dentKeep(g, [0.42 + R.spread(0.08), s.h * 0.6, 0.03], [0, -0.3, 1], 0.09, 0.013);
        nd.add(part('metal', g, 'steel', { seed: seed + 60 + i, shade: 1.0 + R.spread(0.07), jitter: 0.03 }));
      }
    }
  }

  // ---- the flap: a rubber strip curtain in the bay, a hazard band at its foot ----
  {
    const fz = -0.3;
    const fl = bay.node('flap', T(0, yTop - 0.02, fz));
    const fw = W - 0.04, n = 3, gap = 0.012;
    const sw = (fw - gap * (n - 1)) / n;
    const fh = H - 0.16;
    for (let i = 0; i < n; i++) {
      const x = -fw / 2 + sw / 2 + i * (sw + gap);
      fl.add(part('rubber', bevelBox({ min: [x - sw / 2, -fh, -0.012], max: [x + sw / 2, 0, 0.012], c: 0.005, omit: ['py', 'nz'] }), 'ink', { seed: seed + 70 + i, shade: 0.9, jitter: 0.08 }));
      fl.add(part('steel', bevelBox({ min: [x - sw / 2 + 0.002, -fh + 0.002, 0.011], max: [x + sw / 2 - 0.002, -fh + 0.08, 0.016], c: 0.003, omit: ['nz'] }), 'tape-yellow', { seed: seed + 74, shade: 0.8 }));
    }
    bay.add(part('metal', transform(bevelBox({ min: [-fw / 2 - 0.02, -0.03, -0.025], max: [fw / 2 + 0.02, 0.02, 0.025], c: 0.008 }), T(0, yTop - 0.02, fz)), 'steel', { seed: seed + 75, shade: 0.6 }));
  }

  // ---- the bell: brass, on a sprung steel strap off the housing's near end ----
  const bellAt = new Vector3(hx + 0.22, hY0 - 0.02, 0.1);
  {
    const sy = hY1 - 0.06;
    const pts: Array<[number, number, number]> = [[hx - 0.01, sy, 0.1], [hx + 0.12, sy, 0.1], [bellAt.x, sy - 0.08, 0.1], [bellAt.x, bellAt.y + 0.04, 0.1]];
    bay.add(part('metal', sweep(polylinePath(pts, 0.07, hi ? 4 : 2), { section: sections.roundRect(0.004, 0.024, 1), radius: 0.006, up: [0, 0, 1], detail, ends: 'flat' }), 'steel', { seed: seed + 80, shade: 0.95 }));
    bay.add(part('steel', bevelBox({ min: [hx - 0.01, sy - 0.05, 0.04], max: [hx + 0.04, sy + 0.04, 0.16], c: 0.01, omit: ['nx'] }), 'teal-panel', { seed: seed + 81, shade: 0.9 }));
    bay.small(() => [part('metal', transform(hexHead(0.03, 0.012, 0.3), aim([hx + 0.04, sy, 0.1], [1, 0, 0])), 'steel', { seed: seed + 82 })]);
    const bell = bay.node('bell', T(bellAt.x, bellAt.y, bellAt.z));
    const r = 0.16, h = 0.22;
    const shell = lathe(
      profile(r - 0.02, -h + 0.012)
        .to(r, -h, { fillet: 0.01, segs: 2 })
        .to(r * 0.94, -h + 0.035, { fillet: 0.04, segs: 2 })
        .to(r * 0.66, -h + 0.11, { smooth: true })
        .to(r * 0.6, -0.06, { smooth: true })
        .to(r * 0.46, -0.014, { fillet: 0.03, segs: 2 })
        .to(0, -0.012),
      { segs: hi ? 16 : 12, detail, band: 0, caps: false },
    );
    bell.add(setFinish(part('brass', shell, 'brass', { seed: seed + 83, warm: 0.04, shade: 1.05 }), 0.7));
    bell.add(part('brass', lathe(profile(0, -h + 0.04).to(r - 0.02, -h + 0.012, { sharp: true }), { segs: hi ? 12 : 8, detail, band: 0, caps: false }), 'brass', { shade: 0.25 }));
    bell.add(part('brass', lathe(profile(0, -0.014).to(0.032, -0.014, { sharp: true }).to(0.032, 0.01, { fillet: 0.008, segs: 1 }).to(0.018, 0.03, { fillet: 0.01, segs: 1 }).to(0, 0.04), { segs: 8, detail, band: 0 }), 'brass', { seed: seed + 84 }));
    const cl = bell.node('bell.clapper', T(0, -0.03, 0));
    cl.add(part('metal', sweep(polylinePath([[0, 0, 0], [0, -h + 0.07, 0]], 0, 1), { radius: 0.007, segs: 5, detail, ends: 'flat' }), 'steel', { shade: 0.7 }));
    cl.add(part('metal', transform(lathe(profile(0, -0.025).to(0.022, -0.02, { fillet: 0.012, segs: 1 }).to(0.022, 0.0, { fillet: 0.012, segs: 1 }).to(0, 0.005), { segs: 8, detail, band: 0 }), T(0, -h + 0.07, 0)), 'steel', { seed: seed + 85, shade: 0.8 }));
  }

  // ---- the station lamp: in a wire cage on the housing's top, toward the belt ----
  const lampAt = new Vector3(-hx + 0.34, hY1, 0.0);
  {
    const base = lathe(profile(0, 0).to(0.09, 0, { sharp: true }).to(0.09, 0.016, { fillet: 0.006, segs: 1 }).to(0.042, 0.03, { fillet: 0.01, segs: 1 }).to(0.038, 0.07, { sharp: true }).to(0.08, 0.075, { fillet: 0.004, segs: 1 }).to(0.08, 0.085, { sharp: true }).to(0, 0.085), { segs: hi ? 12 : 8, detail, band: 0 });
    bay.add(part('brass', transform(base, T(lampAt.x, lampAt.y - 0.006, lampAt.z)), 'brass', { seed: seed + 90, warm: 0.03 }));
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI + 0.4;
      const pts: Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = Math.PI * (k / 6);
        pts.push(new Vector3(lampAt.x + Math.cos(t) * 0.084 * Math.cos(a), lampAt.y + 0.08 + Math.sin(t) * 0.13, lampAt.z + Math.cos(t) * 0.084 * Math.sin(a)));
      }
      bay.add(part('metal', sweep({ points: pts }, { radius: 0.005, segs: 4, detail: 'low', ends: 'flat' }), 'steel', { seed: seed + 91, shade: 0.8 }));
    }
    const lamp = bay.node('lamp', T(lampAt.x, lampAt.y + 0.08, lampAt.z));
    const glass = (cls: 'bulb' | 'glass'): KitPart => {
      const g = lathe(profile(0, 0).to(0.062, 0, { sharp: true }).to(0.07, 0.04, { smooth: true }).curve(0.05, 0.11, 0, 0.12, 3), { segs: hi ? 10 : 8, detail, band: 0 });
      return cls === 'bulb' ? setFinish(part('bulb', g, 'amber-glow', { seed: seed + 92 }), 0.55) : setFinish(part('glass', g, 'amber', { seed: seed + 93, shade: 0.35 }), 0.6);
    };
    lamp.node('lamp.lit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)).add(glass('bulb'));
    lamp.node('lamp.unlit').add(glass('glass'));
  }

  // ======================================================================
  // THE RAMP (root space): straight off the belt, then curved and falling,
  // rollers between two rails, on legs
  // ======================================================================
  const rg = rampGeom(turn, o.reach ?? DOCK.reach);
  const rollerS = rampRollers(rg);
  {
    const railH = 0.15, railT = 0.032;
    const top = DOCK.railProud;
    // left of the heading is (hz, 0, -hx); the near rail is to the right (toward the visitor)
    const railPts = (off: number, dy: number): Vector3[] => {
      const pts: Vector3[] = [];
      const n = Math.max(6, Math.ceil(rg.length / 0.15));
      for (let i = 0; i <= n; i++) {
        const s = (rg.length * i) / n;
        const p = rampAt(rg, s);
        pts.push(new Vector3(p.x + p.hz * off, p.y + dy, p.z - p.hx * off));
      }
      return pts;
    };
    for (const side of [1, -1] as const) {
      const off = -side * (DOCK.railIn + railT / 2);
      const g = sweep({ points: railPts(off, top - railH / 2) }, { section: sections.roundRect(railH / 2 - 0.012, railT / 2 - 0.012, 1), radius: 0.012, up: [0, 1, 0], detail, ends: 'flat' });
      grain(g, 'x');
      b.add(part('steel', g, 'teal-panel', { seed: seed + 100 + side, shade: side > 0 ? 1.12 : 0.85, jitter: 0.03 }));
    }
    const rl = 2 * DOCK.railIn - 0.02, rr = DOCK.rollerR;
    for (const [i, s] of rollerS.entries()) {
      const p = rampAt(rg, s);
      const nd = b.node(`ramp.roller${i}`, aim([p.x, p.y - rr, p.z], [p.hz, 0, -p.hx]));
      const tube = lathe(profile(0, -rl / 2).to(rr, -rl / 2, { sharp: true }).to(rr, rl / 2, { sharp: true }).to(0, rl / 2), { segs: hi ? 8 : 6, detail, band: 0 });
      nd.add(part('metal', tube, 'steel', { seed: seed + 110 + i, shade: 1.0 + R.spread(0.08), jitter: 0.04 }));
      // the axle's nut on the near rail's face
      const e = DOCK.railIn + railT;
      b.small(() => [part('metal', transform(stud(0.02, 0.012, 6), aim([p.x - p.hz * e, p.y - rr, p.z + p.hx * e], [-p.hz, 0, p.hx])), 'steel', { seed: seed + 130 + i, shade: 0.85, jitter: 0.08 })]);
    }
    // legs where the ramp is high enough to want them: a post under each rail, a foot plate, bolts
    for (const [k, s] of [0.3, rg.approach * 0.75, rg.approach + rg.arc * 0.55].entries()) {
      const p = rampAt(rg, s);
      const h = p.y + top - railH + 0.01;
      if (h < 0.15) continue;
      for (const side of [1, -1] as const) {
        const off = side * (DOCK.railIn + railT / 2);
        const x = p.x - p.hz * off, z = p.z + p.hx * off;
        const yaw = new Matrix4().makeRotationY(Math.atan2(p.hx, p.hz));
        b.add(part('steel', transform(bevelBox({ min: [-0.035, 0.02, -0.03], max: [0.035, h, 0.03], c: 0.012, omit: ['ny', 'py'] }), chain(T(x, 0, z), yaw)), 'teal-panel', { seed: seed + 140 + k * 2 + side, shade: side > 0 ? 0.95 : 0.7 }));
        b.add(part('steel', transform(bevelBox({ min: [-0.08, 0, -0.06], max: [0.08, 0.025, 0.06], c: 0.01, omit: ['ny'] }), chain(T(x, 0, z), yaw)), 'teal-panel', { seed: seed + 145, shade: 0.8 }));
        if (side > 0) b.small(() => [part('metal', transform(hexHead(0.034, 0.016, R.range(0, 1)), chain(T(x, 0.025, z), yaw, T(0.055, 0, 0.03))), 'steel', { seed: seed + 150 })]);
      }
    }
    // the ramp's start: a brass maker's tag on the near rail, where the belt hands over
    {
      const p = rampAt(rg, 0.25);
      const e = DOCK.railIn + railT + 0.001;
      const tag = roundedBox({ w: 0.22, h: 0.006, d: 0.07, r: 0.002, rPlan: 0.012, detail: 'low', open: true });
      b.add(setFinish(part('brass', transform(tag, chain(T(p.x - p.hz * e, p.y + top - 0.06, p.z + p.hx * e), Z_UP)), 'brass', { seed: seed + 160, warm: 0.03 }), 0.3));
    }
  }

  // ======================================================================
  // SOCKETS
  // ======================================================================
  const start = rampAt(rg, 0);
  b.socket('in', T(start.x, start.y, start.z));
  b.socket('belt', T(start.x - DOCK.beltGap, start.y, start.z));
  const mid = rampAt(rg, rg.length / 2);
  b.socket('ramp.mid', chain(T(mid.x, mid.y, mid.z), new Matrix4().makeRotationY(Math.atan2(-mid.hz, mid.hx))));
  b.socket('threshold', chain(Df, T(0, yS, DOCK.lipZ)));
  b.socket('door', chain(Df, T(0, yS, 0)));
  b.socket('vanish', chain(Df, T(0, yS, -0.62)));
  b.socket('return', chain(Df, T(0, yS, -0.2)));
  b.socket('bell', chain(Df, T(bellAt.x, bellAt.y, bellAt.z)));
  b.socket('lamp', chain(Df, T(lampAt.x, lampAt.y + 0.12, lampAt.z)));

  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`dock: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    poseDock(built.root, p, rollerS.length);
  }
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'dock',
    build: (opts = {}) =>
      dock({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['turn'] === 'number' ? { turn: opts['turn'] } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, 'turn 30': { turn: 30 }, 'turn 50': { turn: 50 } },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 8 },
    note: 'The dock: where things leave (and come back). Roll-up shutter, bell, strip curtain, curved roller ramp off the belt.',
  },
];
