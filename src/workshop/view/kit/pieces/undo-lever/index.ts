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
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { NodeBuilder } from '../../compose.ts';
import { chain, mat, part, piece, T, texturedPart } from '../../compose.ts';
import { extrude, lathe, profiledBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { arcPath, linePath, polylinePath, sections, sweep } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, sheet, stud } from '../../cheap.ts';
import { HIDDEN, LEVER, NAMED_POSES, leverAngle, lugAt, posePiece, ringX, springRestLength } from './pose.ts';
import type { UndoPose } from './pose.ts';
import { estimateLabels, undoLabels } from './labels.ts';
import type { UndoLabelRefs } from './labels.ts';

export { poseUndoLever, posePiece, NAMED_POSES, LEVER, leverAngle, springMatrix, springLength, ringX, HIDDEN } from './pose.ts';
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
export const QUADRANT = { zFront: -0.21, t: 0.045, r: 0.65, slotR: 0.43, slotW: 0.045 } as const;

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
    // a dark backing plate behind the slot, so the slot reads as a slot and not as a window onto the bench
    {
      const xs = (Q.slotR + Q.slotW + 0.02) * Math.sin(Math.max(Math.abs(sa), Math.abs(sb)) * DEG);
      const ys0 = py + (Q.slotR - Q.slotW - 0.03) * Math.cos(Math.max(Math.abs(sa), Math.abs(sb)) * DEG), ys1 = py + Q.slotR + Q.slotW + 0.02;
      b.add(part('steel', bevelBox({ min: [px - xs, ys0, Q.zFront - Q.t - 0.012], max: [px + xs, ys1, Q.zFront - Q.t - 0.006], omit: ['px', 'nx', 'py', 'ny', 'nz'] }), 'ink', { shade: 0.6 }));
    }
    // the brass quadrant rim along the arc, proud of the plate's face
    const rim0 = Q.r - 0.06, rim1 = Q.r - 0.008;
    const ring: Array<[number, number]> = [...arc(px, py, rim1, a0 + 2, a1 - 2, hi ? 8 : 6), ...arc(px, py, rim0, a1 - 2, a0 + 2, hi ? 8 : 6)];
    const rr = ring.map((_, i) => (i === 0 || i === ring.length - 1 || i === ring.length / 2 - 1 || i === ring.length / 2 ? 0.012 : 0));
    const rim = extrude(ring, 0.018, { radius: rr, bevel: 0.006, bevelBase: 0, caps: 'end', segs: 1, detail, band: 0 });
    b.add(setFinish(part('brass', transform(rim, T(0, 0, Q.zFront)), 'brass', { seed: seed + 4, warm: 0.03 }), 0.35));
    // index marks at home and pulled: raised brass tongues standing proud of the rim, pointing at the slot
    for (const a of [homeLean, pullLean]) {
      const m = chain(T(px + (rim0 - 0.012) * Math.sin(a * DEG), py + (rim0 - 0.012) * Math.cos(a * DEG), Q.zFront), new Matrix4().makeRotationZ(-a * DEG));
      b.add(setFinish(part('brass', transform(bevelBox({ min: [-0.016, -0.04, -0.004], max: [0.016, 0.07, 0.032], c: 0.008, omit: ['nz'] }), m), 'brass', { seed: seed + 7, warm: 0.04 }), 0.7));
    }
    // two cast ribs framing the slot's track, half-round beads standing on the plate's face
    for (const [r, k] of [[Q.slotR - Q.slotW - 0.04, 0], [Q.slotR + Q.slotW + 0.035, 1]] as const) {
      const pts = arc(px, py, r, a0 + 8, a1 - 8, hi ? 7 : 5).map(([x, y]) => [x, y, Q.zFront] as [number, number, number]);
      b.add(part('steel', sweep({ points: pts.map(([x, y, z]) => new Vector3(x, y, z)) }, { radius: 0.017, segs: 4, ends: 'flat', detail }), 'teal-panel', { seed: seed + 8 + k, shade: 1.12 }));
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
  // up the lever: the twin bars to yF0; a brass ferrule; the grip; a brass ferrule; a brass ball
  const yF0 = 0.72, yG0 = 0.77, yG1 = 1.17, yF1 = 1.215;
  const barX = 0.05; // each bar's centre either side of the lever's line (a visible gap between them)
  const barZ = 0.032; // half the bars' depth
  const gripR = 0.15;
  {
    // the twin bars: deep flat forgings with a gap between them, from the tail to the grip's ferrule
    for (const sx of [-1, 1]) {
      const bar = sweep(linePath([sx * barX, -0.15, 0], [sx * barX, yF0 + 0.02, 0], 1), { section: sections.roundRect(0.017, 0.02, 2), radius: 0.012, up: [1, 0, 0], ends: 'flat', detail });
      into(lever, leverW, part('steel', F(bar), 'steel', { seed: seed + 10 + sx, shade: 0.62, jitter: 0.04 }));
    }
    // the tail: a forged block tying the bars below the pivot; a spacer between them under the grip
    into(lever, leverW, part('steel', F(bevelBox({ min: [-barX - 0.025, -0.2, -barZ - 0.004], max: [barX + 0.025, -0.11, barZ + 0.004], c: 0.018 })), 'steel', { seed: seed + 13, shade: 0.8 }));
    into(lever, leverW, part('steel', F(bevelBox({ min: [-barX + 0.012, yF0 - 0.13, -barZ + 0.006], max: [barX - 0.012, yF0 - 0.06, barZ - 0.006], c: 0.008, omit: ['nz'] })), 'steel', { seed: seed + 14, shade: 0.6 }));
    // the hub: a fat brass boss on the pin, a hex nut in front
    const hub = lathe(profile(0, 0).to(0.115, 0, { sharp: true }).to(0.115, 0.026, { fillet: 0.016, segs: 1 }).to(0.066, 0.042, { fillet: 0.01, segs: 1 }).to(0.066, 0.085, { sharp: true }).to(0, 0.085), { segs: hi ? 10 : 8, detail, band: 0, caps: 'end' });
    into(lever, leverW, setFinish(part('brass', F(transform(hub, chain(T(0, 0, -0.04), Y_TO_Z))), 'brass', { seed: seed + 11, warm: 0.03 }), 0.4));
    into(lever, leverW, part('steel', F(transform(hexHead(0.09, 0.032, R.range(0, 1)), chain(T(0, 0, 0.045), Y_TO_Z))), 'steel', { seed: seed + 12, shade: 0.9 }));
    // the spring's lug: a stub between the bars, out behind them
    const lug = bevelBox({ min: [-0.024, LEVER.lugR - 0.03, LEVER.lugZ - pz - 0.016], max: [0.024, LEVER.lugR + 0.03, -barZ + 0.01], c: 0.007, omit: ['pz'] });
    into(lever, leverW, part('steel', F(lug), 'steel', { seed: seed + 15, shade: 0.9 }));
    // the ferrules: brass collars at both ends of the grip
    const ferrule = (y: number, r0: number, r1: number, h: number): BufferGeometry =>
      lathe(profile(r0, 0).to(r1, 0.008, { fillet: 0.006, segs: 1 }).to(r1, h - 0.012, { sharp: true }).to(r1 - 0.012, h, { fillet: 0.005, segs: 1 }).to(r0, h), { segs: hi ? 10 : 8, detail, band: 0, caps: false }).translate(0, y, 0);
    into(lever, leverW, setFinish(part('brass', F(ferrule(yF0, barX + 0.03, 0.105, yG0 - yF0 + 0.01)), 'brass', { seed: seed + 16, warm: 0.03 }), 0.5));
    into(lever, leverW, setFinish(part('brass', F(ferrule(yG1 - 0.01, 0.06, 0.112, yF1 - yG1 + 0.01)), 'brass', { seed: seed + 17, warm: 0.03 }), 0.5));
    // the grip: a fat turned handle a fist closes round, a little barrelled, fuller below the middle
    const gl = yG1 - yG0;
    const gp = profile(0.095, 0).to(gripR - 0.012, 0.05, { smooth: true }).to(gripR, gl * 0.4, { smooth: true }).to(gripR - 0.01, gl * 0.8, { smooth: true }).to(0.1, gl, { smooth: true });
    const grip = lathe(gp, { segs: hi ? 12 : 9, detail, band: 0, caps: false });
    into(lever, leverW, part('rubber', F(transform(grip, T(0, yG0, 0))), 'ink', { seed: seed + 18, shade: 1.15 }));
    // two yellow bands, painted rings a hair proud of the rubber
    for (const t of [0.24, 0.66]) {
      const rr = gripR + 0.004 - (t > 0.5 ? 0.006 : 0.002);
      const band = lathe(profile(rr - 0.012, -0.026).to(rr, -0.02, { sharp: true }).to(rr, 0.02, { sharp: true }).to(rr - 0.012, 0.026), { segs: hi ? 12 : 9, detail, band: 0, caps: false });
      into(lever, leverW, part('steel', F(transform(band, T(0, yG0 + gl * t, 0))), 'tape-yellow', { seed: seed + 19, shade: 0.95, jitter: 0.03 }));
    }
    // the finial: a polished brass ball on a short neck
    const ballR = 0.055, yb = L - ballR;
    const fin = lathe(profile(0, yF1 - 0.004).to(0.04, yF1 - 0.004, { sharp: true }).to(0.03, yF1 + 0.02, { smooth: true }).curve(ballR, yb, ballR * 0.6, yb - ballR * 0.9, 3).curve(0, L, ballR, L - ballR * 0.1, 3), { segs: hi ? 10 : 8, detail, band: 0 });
    into(lever, leverW, setFinish(part('brass', F(fin), 'brass', { seed: seed + 20, warm: 0.04 }), 0.7));
  }
  // the catch handle (`latch`): a brass trigger hinged on a lug of the upper ferrule, down the grip's pull side (left)
  const gl0 = (t: number): number => (yG1 - yG0) * t;
  const hingeF: [number, number, number] = [-0.125, yG1 - 0.005, 0];
  const trigFoot: [number, number] = [-0.115, yG0 - 0.005];
  {
    into(lever, leverW, part('brass', F(bevelBox({ min: [hingeF[0] - 0.02, hingeF[1] - 0.02, -0.022], max: [-0.09, hingeF[1] + 0.02, 0.022], c: 0.007 })), 'brass', { seed: seed + 21 }));
    const latchW = chain(Lw, T(...hingeF), Y_TO_Z);
    const latch = lever.node('latch', chain(leverW.clone().invert(), latchW));
    // the trigger: a flat brass bar bowed out round the grip, a gap a finger's width, its foot turned in to the rod
    const pts: Array<[number, number, number]> = [[hingeF[0], hingeF[1], 0], [-0.19, hingeF[1] - 0.05, 0], [-0.212, yG0 + gl0(0.55), 0], [-0.2, yG0 + 0.07, 0], [-0.16, yG0 + 0.01, 0], [trigFoot[0], trigFoot[1], 0]];
    const tb = sweep(polylinePath(pts, 0.05, 1), { radius: 0.017, segs: 5, ends: 'flat', detail });
    into(latch, latchW, setFinish(part('brass', F(tb), 'brass', { seed: seed + 22, warm: 0.03 }), 0.6));
    into(latch, latchW, part('brass', F(transform(lathe(profile(0, 0).to(0.018, 0, { sharp: true }).to(0.018, 0.06, { sharp: true }).to(0, 0.06), { segs: 8, detail, band: 0 }), chain(T(hingeF[0], hingeF[1], -0.03), Y_TO_Z))), 'brass', { seed: seed + 23 }));
  }
  // the catch (`catch`): a block clasping both bars at the slot's radius, its pin back into the slot, its rod up to the trigger's foot
  {
    const cy = Q.slotR;
    const catchW = chain(Lw, T(0, cy, 0), new Matrix4().makeRotationZ(Math.PI / 2)); // local +X is up the lever
    const ct = lever.node('catch', chain(leverW.clone().invert(), catchW));
    const blk = bevelBox({ min: [-barX - 0.04, cy - 0.05, -barZ - 0.012], max: [barX + 0.04, cy + 0.05, barZ + 0.01], c: 0.015 });
    into(ct, catchW, setFinish(part('brass', F(blk), 'brass', { seed: seed + 25, warm: 0.03 }), 0.3));
    const pinLen = pz - (Q.zFront - Q.t * 0.6);
    const pin = lathe(profile(0, 0).to(0.024, 0, { fillet: 0.006, segs: 1 }).to(0.024, pinLen, { sharp: true }).to(0, pinLen), { segs: 6, detail, band: 0 });
    into(ct, catchW, part('steel', F(transform(pin, chain(T(0, cy, -barZ), new Matrix4().makeRotationX(-Math.PI / 2)))), 'steel', { seed: seed + 26, shade: 0.7 }));
    const rod = sweep(linePath([-barX - 0.03, cy + 0.04, 0.0], [trigFoot[0], trigFoot[1] - 0.012, 0.0], 2), { radius: 0.01, segs: 6, ends: 'round', detail });
    into(ct, catchW, part('steel', F(rod), 'steel', { seed: seed + 27, shade: 1.1 }));
  }

  // ======================================================================
  // THE RETURN SPRING: from an eye post on the deck's right to the lever's lug.
  // Its coils are rings on nodes of their own, so a pull spreads them apart
  // (pose.ts) instead of stretching one coil.
  // ======================================================================
  {
    const [ax, ay, az] = LEVER.anchor;
    const rest = springRestLength();
    const lug = lugAt(home);
    const rot = Math.atan2(lug.y - ay, lug.x - ax);
    const springW = chain(T(ax, ay, az), new Matrix4().makeRotationZ(rot));
    const sp = b.node('spring', springW);
    const wire = 0.011, rc = 0.042;
    const n = LEVER.rings;
    const tilt = Math.atan2((rest - 2 * LEVER.hook) / n, 2 * Math.PI * rc); // the lean of one turn of a helix this pitch
    for (let k = 0; k < n; k++) {
      // one coil: a closed ring in the YZ plane (round the spring's +X), leaned like a turn of a helix
      const ringPts = arcPath([0, 0, 0], rc, 0, Math.PI * 2, hi ? 8 : 7, [0, 1, 0], [0, 0, 1]).points.slice(0, -1);
      const ring = sweep({ points: ringPts, closed: true }, { radius: wire, segs: 5, detail });
      const node = sp.node(`spring.ring${k}`, chain(T(ringX(k, rest), 0, 0), new Matrix4().makeRotationZ(tilt)));
      node.add(part('steel', ring, 'steel', { seed: seed + 30 + k, shade: 0.75 }));
    }
    // the hooks: the near one fixed in the spring's frame, the far one on `spring.end` at the lug
    sp.add(part('steel', sweep(polylinePath([[0, 0, 0], [LEVER.hook * 0.6, rc * 0.4, 0], [LEVER.hook + 0.01, rc, 0]], 0.012, 1), { radius: wire * 0.9, segs: 5, ends: 'flat', detail }), 'steel', { seed: seed + 38, shade: 0.75 }));
    const end = sp.node('spring.end', T(rest, 0, 0));
    end.add(part('steel', sweep(polylinePath([[0, 0, 0], [-LEVER.hook * 0.6, -rc * 0.4, 0], [-LEVER.hook - 0.01, -rc, 0]], 0.012, 1), { radius: wire * 0.9, segs: 5, ends: 'flat', detail }), 'steel', { seed: seed + 39, shade: 0.75 }));
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
  b.socket('grip', chain(Lw, T(0, (yG0 + yG1) / 2, 0)));
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
