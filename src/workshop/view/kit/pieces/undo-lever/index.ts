/**
 * The UNDO lever (REWRITE.md § B2 X3, § D8; ART-P2 § 5 HANDLES). Registry
 * name `undo-lever`. The second most inviting thing on the bench after the
 * Button: one pull takes back the visitor's last change.
 *
 * A tall signal-box lever on a low enamel console. The console's broad front
 * leans back toward the camera and carries the UNDO tape; on its deck stands
 * a fan-shaped quadrant plate with a brass rim and an arc slot. The lever, a
 * painted steel bar, swings across the plate's face about a brass hub: home
 * leans right, a pull swings it left through LEVER.travelDeg (left is back
 * along the line, back in time). A rubber grip banded in `tape-yellow`, a
 * brass catch handle beside it whose rod lifts the catch block's pin out of
 * the slot, and a return spring from the deck's right to a lug on the lever
 * that stretches as it is pulled.
 *
 * Built in world space at rest (home); each node's parts are carried into its
 * own space. Four meshes: `steel` (enamel, the painted bar, the spring, the
 * bolts), `brass`, `rubber`, `tape`. Moving nodes: see pose.ts.
 *
 * Sockets: `base` (the origin: where it stands on the bench), `grip` (the
 * grip's middle at home, for a pointer to pick), `tape` (the label's centre,
 * +Z out of the face), `pivot`.
 */
import { Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { NodeBuilder } from '../../compose.ts';
import { chain, mat, part, piece, T, texturedPart } from '../../compose.ts';
import { extrude, lathe, profiledBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { helixPath, linePath, polylinePath, sections, sweep } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, sheet, stud } from '../../cheap.ts';
import { HIDDEN, LEVER, NAMED_POSES, leverAngle, lugAt, posePiece, springRestLength } from './pose.ts';
import type { UndoPose } from './pose.ts';
import { estimateLabels, undoLabels } from './labels.ts';
import type { UndoLabelRefs } from './labels.ts';

export { poseUndoLever, posePiece, NAMED_POSES, LEVER, leverAngle, springMatrix, HIDDEN } from './pose.ts';
export type { UndoPose } from './pose.ts';
export { undoLabels, UNDO_WORD, TAPE_CAP } from './labels.ts';
export type { UndoLabelRefs } from './labels.ts';

const DEG = Math.PI / 180;

/** The console: width, its side profile, the deck height. */
export const CONSOLE = {
  w: 1.36,
  y0: 0.085,
  top: 0.48,
  frontBottomZ: 0.4,
  frontTopZ: 0.15,
  backZ: -0.3,
} as const;

/** The quadrant plate: its front face z, thickness, radius; the slot's centre radius. */
export const QUADRANT = { zFront: -0.16, t: 0.045, r: 0.65, slotR: 0.43, slotW: 0.045 } as const;

export interface UndoLeverOptions extends KitOptions {
  /** Label ref from `undoLabels(labels)`. Without it the tape is blank (clay reviews, tests). */
  labels?: UndoLabelRefs;
  /** Build already posed (a name from NAMED_POSES, or a pose). Home is the default. */
  pose?: string | UndoPose;
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

/** Points on an arc about (cx, cy), angles in degrees from +Y toward +X. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    out.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
  }
  return out;
}

/** Turns a lathe's +Y axis to +Z (toward the visitor). */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
/** Turns a lathe's +Y axis to +X. */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

export function undoLever(o: UndoLeverOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('undo-lever', { detail, seed });

  /** Add world-space (rest) parts to a node whose rest world transform is W. */
  const into = (n: NodeBuilder, W: Matrix4, ...ps: KitPart[]): void => {
    const inv = W.clone().invert();
    for (const p of ps) n.add({ ...p, geometry: transform(p.geometry, inv) });
  };

  const W = CONSOLE.w;
  const yC0 = CONSOLE.y0, yTop = CONSOLE.top, zFB = CONSOLE.frontBottomZ, zFT = CONSOLE.frontTopZ, zBack = CONSOLE.backZ;
  const zMid = (zFB + zBack) / 2;
  const [px, py, pz] = LEVER.pivot;

  // ======================================================================
  // LARGE: a bolted flange, the console with its leaning front, the quadrant
  // ======================================================================
  const yF = 0.075;
  {
    const r = 0.16;
    const g = profiledBox(
      { w: W + 0.22, d: zFB - zBack + 0.22, rPlan: r, detail: 'low', band: 0 },
      profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.035, { fillet: 0.014, segs: 1 }).to(r - 0.11, yF, { fillet: 0.014, segs: 1 }).to(0, yF),
    );
    transform(g, T(0, 0, zMid));
    dentKeep(g, [0.45 + R.spread(0.1), 0.035, zFB + 0.11], [0, 0.3, 1], 0.09, 0.01);
    b.add(part('steel', g, 'teal-panel', { seed, shade: 0.82, jitter: 0.03 }));
  }
  {
    // the console's side profile (front foot, front top, back top, back foot) extruded across X
    const outline: Array<[number, number]> = [[-zFB, yC0 - 0.02], [-zFT, yTop], [-zBack - 0.02, yTop], [-zBack, yC0 - 0.02]];
    const g = extrude(outline, W, { radius: [0.03, 0.07, 0.05, 0.03], bevel: 0.04, segs: 2, detail: 'low', band: 0 });
    transform(g, chain(T(-W / 2, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
    dentKeep(g, [-W / 2 + 0.05, yC0 + 0.08, zFB - 0.04], [1, 0, -1], 0.08, 0.012);
    dentKeep(g, [W / 2 - 0.25 + R.spread(0.08), yTop - 0.01, zFT - 0.02], [0, 1, -1], 0.07, 0.009);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 1, shade: 1.1, jitter: 0.03 }));
  }
  const lean = Math.atan2(zFB - zFT, yTop - yC0);
  const zFront = (y: number): number => zFB - (y - yC0) * Math.tan(lean);
  /** A frame on the console's leaning front at (x, y), +Z out of the panel. */
  const front = (x: number, y: number, out = 0): Matrix4 => chain(T(x, y, zFront(y) + out / Math.cos(lean)), new Matrix4().makeRotationX(-lean));

  // the quadrant plate: a fan about the pivot standing on the deck, an arc slot through it
  const Q = QUADRANT;
  const homeLean = -LEVER.homeDeg; // degrees the lever leans right at home
  const pullLean = homeLean - LEVER.travelDeg; // (negative: leans left)
  {
    const a0 = -54, a1 = 52;
    const top = arc(px, py, Q.r, a1, a0, hi ? 8 : 6);
    const outline: Array<[number, number]> = [[px + Q.r * Math.sin(a1 * DEG) + 0.03, yTop - 0.01], ...top, [px + Q.r * Math.sin(a0 * DEG) - 0.03, yTop - 0.01]];
    const radii = outline.map((_, i) => (i === 0 || i === outline.length - 1 ? 0.02 : i === 1 || i === outline.length - 2 ? 0.03 : 0));
    const sa = pullLean - 5, sb = homeLean + 5;
    // the slot: an arc with round ends (the end caps written as points: a hole radius would round every arc point)
    const endCap = (a: number, from: number, n: number): Array<[number, number]> => {
      const c: [number, number] = [px + Q.slotR * Math.sin(a * DEG), py + Q.slotR * Math.cos(a * DEG)];
      const out: Array<[number, number]> = [];
      for (let i = 1; i < n; i++) {
        const t = from + (Math.PI * i) / n;
        out.push([c[0] + Q.slotW * Math.sin(t), c[1] + Q.slotW * Math.cos(t)]);
      }
      return out;
    };
    const slot: Array<[number, number]> = [...arc(px, py, Q.slotR + Q.slotW, sa, sb, hi ? 7 : 5), ...endCap(sb, sb * DEG, 4), ...arc(px, py, Q.slotR - Q.slotW, sb, sa, hi ? 6 : 4), ...endCap(sa, sa * DEG + Math.PI, 4)];
    const g = extrude(outline, Q.t, { radius: radii, bevel: 0.012, bevelBase: 0, caps: 'end', segs: 1, holes: [slot], holeRadius: 0, detail, band: 0 });
    transform(g, T(0, 0, Q.zFront - Q.t));
    b.add(part('steel', g, 'teal-panel', { seed: seed + 3, shade: 1.0, jitter: 0.03 }));
    // the brass quadrant rim along the arc, proud of the plate's face
    const rim0 = Q.r - 0.06, rim1 = Q.r - 0.008;
    const ring: Array<[number, number]> = [...arc(px, py, rim1, a0 + 2, a1 - 2, hi ? 8 : 6), ...arc(px, py, rim0, a1 - 2, a0 + 2, hi ? 8 : 6)];
    const rr = ring.map((_, i) => (i === 0 || i === ring.length - 1 || i === ring.length / 2 - 1 || i === ring.length / 2 ? 0.012 : 0));
    const rim = extrude(ring, 0.018, { radius: rr, bevel: 0.006, bevelBase: 0, caps: 'end', segs: 1, detail, band: 0 });
    b.add(setFinish(part('brass', transform(rim, T(0, 0, Q.zFront)), 'brass', { seed: seed + 4, warm: 0.03 }), 0.35));
    // index marks on the rim at home and pulled: two short ink notches cut across it
    for (const a of [homeLean, pullLean]) {
      const m = chain(T(px + (rim0 + rim1) / 2 * Math.sin(a * DEG), py + (rim0 + rim1) / 2 * Math.cos(a * DEG), Q.zFront + 0.018), new Matrix4().makeRotationZ(-a * DEG));
      b.add(part('steel', transform(bevelBox({ min: [-0.007, -0.03, -0.003], max: [0.007, 0.03, 0.002], omit: ['nz'] }), m), 'ink', { shade: 1.2 }));
    }
    // screws holding the rim down
    for (const a of [a0 + 7, -2, a1 - 7]) {
      const rm = (rim0 + rim1) / 2;
      b.small(() => [part('brass', transform(stud(0.014, 0.008, 6), chain(T(px + rm * Math.sin(a * DEG), py + rm * Math.cos(a * DEG), Q.zFront + 0.017), Y_TO_Z)), 'brass', { seed: seed + 5 })]);
    }
  }

  // ======================================================================
  // THE LEVER (built upright in its own frame F: origin the pivot, +Y up the
  // lever, +Z toward the visitor; then leaned to home)
  // ======================================================================
  const home = leverAngle(0);
  const Lw = chain(T(px, py, pz), new Matrix4().makeRotationZ(home)); // F -> world, at home
  const leverW = chain(Lw, Y_TO_Z); // node: local +Y is the pivot pin (+Z)
  const lever = b.node('lever', leverW);
  const F = (g: BufferGeometry): BufferGeometry => transform(g, Lw);
  const L = LEVER.length;
  const yGrip0 = L - 0.29, yGrip1 = L - 0.045;
  {
    // the bar: a flat bar of painted steel, tapering toward the grip, its tail below the pivot
    const bar = sweep(linePath([0, -0.12, 0], [0, yGrip0 + 0.03, 0], 1), { section: sections.roundRect(0.034, 0.011, 2), radius: 0.016, up: [1, 0, 0], ends: 'flat', taper: (t) => 1 - 0.3 * t, step: 0.4, detail });
    into(lever, leverW, part('steel', F(bar), 'steel', { seed: seed + 10, shade: 0.72, jitter: 0.03 }));
    // the hub: a fat brass boss on the pin, a hex nut in front
    const hub = lathe(profile(0, 0).to(0.092, 0, { sharp: true }).to(0.092, 0.024, { fillet: 0.014, segs: 1 }).to(0.056, 0.038, { fillet: 0.008, segs: 1 }).to(0.056, 0.08, { sharp: true }).to(0, 0.08), { segs: hi ? 10 : 8, detail, band: 0, caps: 'end' });
    into(lever, leverW, setFinish(part('brass', F(transform(hub, chain(T(0, 0, -0.035), Y_TO_Z))), 'brass', { seed: seed + 11, warm: 0.03 }), 0.4));
    into(lever, leverW, part('steel', F(transform(hexHead(0.08, 0.03, R.range(0, 1)), chain(T(0, 0, 0.045), Y_TO_Z))), 'steel', { seed: seed + 12, shade: 0.9 }));
    // the tail's rounded end, a washer under it
    into(lever, leverW, part('steel', F(transform(lathe(profile(0, 0).to(0.034, 0, { sharp: true }).to(0.034, 0.05, { fillet: 0.014, segs: 1 }).to(0, 0.05), { segs: 6, detail, band: 0 }), chain(T(0, -0.12, -0.025), Y_TO_Z))), 'steel', { seed: seed + 13, shade: 1.1 }));
    // the spring's lug: a stub behind the bar with an eye
    const lug = bevelBox({ min: [-0.022, LEVER.lugR - 0.026, LEVER.lugZ - pz - 0.012], max: [0.022, LEVER.lugR + 0.026, -0.018], c: 0.006, omit: ['pz'] });
    into(lever, leverW, part('steel', F(lug), 'steel', { seed: seed + 14, shade: 0.9 }));
    // a ferrule where the bar goes into the grip
    const fer = lathe(profile(0.042, 0).to(0.058, 0.012, { sharp: true }).to(0.058, 0.04, { sharp: true }).to(0.054, 0.05), { segs: hi ? 10 : 8, detail, band: 0, caps: false });
    into(lever, leverW, setFinish(part('brass', F(transform(fer, T(0, yGrip0 - 0.035, 0))), 'brass', { seed: seed + 15 }), 0.5));
    // the grip: fat rubber, a little barrelled, three grooves; a domed end
    const gl = yGrip1 - yGrip0;
    const gp = profile(0.056, 0).to(0.08, 0.045, { smooth: true }).to(0.088, gl * 0.55, { smooth: true }).to(0.082, gl - 0.01, { smooth: true }).curve(0, gl + 0.065, 0.082, gl + 0.06, 4);
    const grip = lathe(gp, { segs: hi ? 9 : 8, detail, band: 0, caps: false });
    into(lever, leverW, part('rubber', F(transform(grip, T(0, yGrip0, 0))), 'ink', { seed: seed + 16, shade: 1.15 }));
    // the two yellow bands, painted rings sitting in the grooves, a hair proud
    for (const t of [0.3, 0.62]) {
      const band = lathe(profile(0.076, -0.02).to(0.092, -0.015, { sharp: true }).to(0.092, 0.015, { sharp: true }).to(0.076, 0.02), { segs: hi ? 10 : 8, detail, band: 0, caps: false });
      into(lever, leverW, part('steel', F(transform(band, T(0, yGrip0 + gl * t, 0))), 'tape-yellow', { seed: seed + 17, shade: 0.95, jitter: 0.03 }));
    }
  }
  // the catch handle (`latch`), hinged on a clamp at the grip's top on the pull side (left)
  const hingeF: [number, number, number] = [-0.096, yGrip1 - 0.05, 0];
  {
    const clamp = lathe(profile(0.078, -0.018).to(0.09, -0.013, { sharp: true }).to(0.09, 0.013, { sharp: true }).to(0.078, 0.018), { segs: hi ? 10 : 8, detail, band: 0, caps: false });
    into(lever, leverW, part('brass', F(transform(clamp, T(0, hingeF[1], 0))), 'brass', { seed: seed + 20 }));
    into(lever, leverW, part('brass', F(bevelBox({ min: [hingeF[0] - 0.02, hingeF[1] - 0.018, -0.02], max: [-0.078, hingeF[1] + 0.018, 0.02], c: 0.006 })), 'brass', { seed: seed + 20 }));
    const latchW = chain(Lw, T(...hingeF), Y_TO_Z);
    const latch = lever.node('latch', chain(leverW.clone().invert(), latchW));
    // a bent brass bar hanging down beside the grip, its foot turning in toward the rod
    const pts: Array<[number, number, number]> = [[0, 0, 0], [-0.03, -0.04, 0], [-0.032, -0.17, 0], [-0.016, -0.215, 0], [0.018, -0.225, 0]];
    const lb = sweep(polylinePath(pts.map(([x, y, z]) => [hingeF[0] + x, hingeF[1] + y, z] as [number, number, number]), 0.035, 2), { radius: 0.014, segs: 5, ends: 'flat', detail });
    into(latch, latchW, setFinish(part('brass', F(lb), 'brass', { seed: seed + 21, warm: 0.03 }), 0.6));
    into(latch, latchW, part('brass', F(transform(lathe(profile(0, 0).to(0.016, 0, { sharp: true }).to(0.016, 0.05, { sharp: true }).to(0, 0.05), { segs: 8, detail, band: 0 }), chain(T(hingeF[0], hingeF[1], -0.025), Y_TO_Z))), 'brass', { seed: seed + 22 }));
  }
  // the catch (`catch`): a block clasping the bar at the slot's radius, its pin back into the slot, its rod up to the latch
  {
    const cy = Q.slotR;
    const catchW = chain(Lw, T(0, cy, 0), new Matrix4().makeRotationZ(Math.PI / 2)); // local +X is up the lever
    const ct = lever.node('catch', chain(leverW.clone().invert(), catchW));
    const blk = bevelBox({ min: [-0.06, cy - 0.045, -0.04], max: [0.06, cy + 0.045, 0.036], c: 0.013 });
    into(ct, catchW, setFinish(part('brass', F(blk), 'brass', { seed: seed + 25, warm: 0.03 }), 0.3));
    const pinLen = pz - (Q.zFront - Q.t * 0.6);
    const pin = lathe(profile(0, 0).to(0.022, 0, { fillet: 0.006, segs: 1 }).to(0.022, pinLen, { sharp: true }).to(0, pinLen), { segs: 6, detail, band: 0 });
    into(ct, catchW, part('steel', F(transform(pin, chain(T(0, cy, -0.03), new Matrix4().makeRotationX(-Math.PI / 2)))), 'steel', { seed: seed + 26, shade: 0.7 }));
    const rodTop = hingeF[1] - 0.225;
    const rod = sweep(linePath([-0.05, cy + 0.03, 0.02], [-0.062, rodTop, 0.012], 2), { radius: 0.009, segs: 5, ends: 'flat', detail });
    into(ct, catchW, part('steel', F(rod), 'steel', { seed: seed + 27, shade: 1.1 }));
    // the block's two cap screws
  }

  // ======================================================================
  // THE RETURN SPRING: from an eye post on the deck's right to the lever's lug
  // ======================================================================
  {
    const [ax, ay, az] = LEVER.anchor;
    const rest = springRestLength();
    const lug = lugAt(home);
    const rot = Math.atan2(lug.y - ay, lug.x - ax);
    const springW = chain(T(ax, ay, az), new Matrix4().makeRotationZ(rot));
    const sp = b.node('spring', springW);
    // the coil as a turned stack of beads (the lamp's way: a helix costs three times as much)
    // an open helix, few sides a turn (a closed bead stack read as a string of beads once stretched)
    const wire = 0.012, rc = 0.04;
    const c0 = 0.05, c1 = rest - 0.05;
    const turns = 7;
    const path = helixPath(rc, (c1 - c0) / turns, turns, 5);
    const coil = transform(sweep(path, { radius: wire, segs: 4, ends: 'flat', detail }), chain(T(c0, 0, 0), Y_TO_X));
    sp.add(part('steel', coil, 'steel', { seed: seed + 30, shade: 0.7 }));
    // hooks bent from the coil's ends to the eyes
    for (const [xa, xb] of [[c0, 0.0], [c1, rest]] as const) {
      sp.add(part('steel', sweep(polylinePath([[xa, rc * 0.6, 0], [xb, 0, 0]], 0.01, 1), { radius: wire * 0.9, segs: 4, ends: 'flat', detail }), 'steel', { seed: seed + 31, shade: 0.75 }));
    }
    // the anchor: a brass post screwed to the deck with an eye at its top
    const post = lathe(profile(0, 0).to(0.045, 0, { sharp: true }).to(0.045, 0.012, { fillet: 0.006, segs: 1 }).to(0.024, 0.024, { fillet: 0.008, segs: 1 }).to(0.02, ay - yTop + 0.01, { smooth: true }).curve(0, ay - yTop + 0.035, 0.022, ay - yTop + 0.03, 1), { segs: 6, detail, band: 0 });
    b.add(part('brass', transform(post, T(ax, yTop, az)), 'brass', { seed: seed + 32 }));
  }

  // ======================================================================
  // THE TAPE: UNDO, big, stuck on by hand, a little crooked, one end lifting
  // ======================================================================
  const tapeY = (yC0 + yTop) / 2 + 0.01;
  {
    const st = o.labels ? o.labels.tape : { key: '', ...estimateLabels().tape };
    const ang = R.range(1.0, 2.2) * (R() < 0.5 ? -1 : 1);
    const at = chain(front(R.spread(0.02), tapeY, 0.003), mat({ rot: [0, 0, ang] }));
    const lift = (u: number, v: number): number => 0.04 * Math.pow(Math.max(0, (u - 0.9) / 0.1), 2) * Math.max(0, 1 - v * 0.9);
    const face = transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: 8, ny: 2 }), at);
    if (o.labels && st.key) b.add(texturedPart('tape', face, st.key));
    else b.add(part('tape', face, 'ink'));
    b.add(part('tape', transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
  }

  // ======================================================================
  // SMALL: flange bolts (one replaced with a brass one), deck screws
  // ======================================================================
  {
    const hxF = W / 2 + 0.055, zf = zFB + 0.065, zb = zBack - 0.065;
    const pos: Array<[number, number]> = [[-hxF, zb], [hxF, zb], [-hxF, zf], [hxF, zf]];
    const replaced = R.int(0, pos.length - 1);
    pos.forEach(([x, z], i) => {
      const g = transform(hexHead(0.085, 0.045, R.range(0, Math.PI / 3)), T(x, 0.04, z));
      b.add(i === replaced ? part('brass', g, 'brass', { seed: seed + 50 + i }) : part('steel', g, 'steel', { seed: seed + 50 + i, jitter: 0.06, shade: 0.9 }));
    });
  }

  b.socket('base', new Matrix4());
  b.socket('pivot', T(px, py, pz));
  b.socket('grip', chain(Lw, T(0, (yGrip0 + yGrip1) / 2, 0)));
  b.socket('tape', front(0, tapeY, 0.01));
  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`undo-lever: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    posePiece(built.root, p);
  }
  void HIDDEN;
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'undo-lever',
    build: (opts = {}) =>
      undoLever({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as UndoLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    poses: Object.keys(NAMED_POSES),
    labels: (labels) => ({ labels: undoLabels(labels) }),
    camera: { distance: 5 },
    note: 'The UNDO lever: one pull takes back the last change.',
  },
];
