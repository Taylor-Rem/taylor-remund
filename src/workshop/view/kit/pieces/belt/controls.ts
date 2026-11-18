/**
 * The belt's control face (REWRITE.md § D 5, § B1 law 3, § B2 X2; ART-P2 §
 * 5 HANDLES "the belt's control box"): the two handles a visitor plays the
 * line with, on the motor housing's sloped desk, facing the visitor at about
 * the camera's pitch.
 *
 *  - THE DIAL (node `dial`): a big knurled brass knob, 0.44 across, seated
 *    in a turned brass bezel, with a cream pointer fin across its crown. It
 *    turns over a cream scale sector whose five ink ticks grow from thin
 *    (slow, on the left) to fat (fast, on the right): marks, no numbers.
 *    Detent d (1..5) sits DIAL.stepDeg apart, the middle one pointing
 *    straight up the desk.
 *  - THE LEVER (node `lever`): a stout steel lever with a cream ball grip,
 *    lying across the desk's face and swinging about a brass hub low on the
 *    desk, over a brass gate plate whose arc slot has three notches. Leaning
 *    left it runs the belt backward (a cream arrow at the gate's left end
 *    points that way), upright it stops it (a cream square above the
 *    notch), leaning right it runs it forward (the arrow at the right end).
 *  - The line's station lamp (`lamp` with `lamp.lit` / `lamp.unlit`) in a
 *    brass bezel at the desk's top right.
 *
 * Both handles turn about their node's local +Y, which points out of the
 * desk (the kit's convention for knobs). Built in the belt root's space from
 * the desk frame the motor hands in.
 */
import { Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitPart } from '../../types.ts';
import type { NodeBuilder } from '../../compose.ts';
import { chain, part, T } from '../../compose.ts';
import { extrude, lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import type { Rng } from '../../rng.ts';

const DEG = Math.PI / 180;

/** The dial: its detents, their spacing, its sizes (face-local units). */
export const DIAL = {
  detents: 5,
  /** Degrees between detents; detent 3 points straight up the desk. */
  stepDeg: 36,
  /** Knob skirt radius (0.44 across), knurl radius, crown height. */
  r: 0.222,
  knurlR: 0.2,
  top: 0.142,
  /** The scale sector: inner and outer radius. */
  scale0: 0.25,
  scale1: 0.33,
} as const;

/** The lever: its throw each side of upright, its reach to the ball's centre, the ball. */
export const LEVER = {
  throwDeg: 30,
  reach: 0.41,
  ballR: 0.082,
  /** The gate's slot radius. */
  slotR: 0.28,
} as const;

/** The dial node's turn (radians about its local +Y, + is anticlockwise seen from the front) at detent `d` (1..5; fractions between). */
export function dialAngle(d: number): number {
  return (3 - d) * DIAL.stepDeg * DEG;
}

/** The lever node's turn (radians about its local +Y) at `v`: -1 backward (leans left), 0 stop (upright), 1 forward (leans right). */
export function leverAngle(v: number): number {
  return -Math.max(-1, Math.min(1, v)) * LEVER.throwDeg * DEG;
}

/** A point at radius r, angle a (radians, anticlockwise from straight up the desk) in face-local (x, z): up the desk is -z. */
const polar = (r: number, a: number): [number, number] => [-Math.sin(a) * r, -Math.cos(a) * r];

/** An annular sector's outline in face-local plan (x, z), from angle a0 to a1. */
function sector(r0: number, r1: number, a0: number, a1: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) out.push(polar(r1, a0 + ((a1 - a0) * i) / n));
  for (let i = n; i >= 0; i--) out.push(polar(r0, a0 + ((a1 - a0) * i) / n));
  return out;
}

/** Corner radii for a sector outline of 2(n+1) points: `r` at its four corners, none along its arcs (they are already smooth). */
export function sectorRadii(n: number, r: number): number[] {
  const out = new Array<number>(2 * (n + 1)).fill(0);
  out[0] = out[n] = out[n + 1] = out[2 * n + 1] = r;
  return out;
}

/** A flat glyph (an outline in face-local plan) raised `t` off the plate it sits on, at height y: sharp, unbevelled, cheap. */
function glyph(outline: Array<[number, number]>, t: number, y: number): BufferGeometry {
  return transform(extrude(outline, t, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0, segs: 1, detail: 'low', band: 0, caps: 'end' }), T(0, y, 0));
}

export interface ControlsOut {
  /** Desk frames (+Z out of the desk, +Y up it) at the dial's and the lever's pivots, and at the lamp. */
  dial: Matrix4;
  lever: Matrix4;
  lamp: Matrix4;
  /** Where a hand takes each (root space, at rest: detent 3, lever upright). */
  dialGrip: Matrix4;
  leverGrip: Matrix4;
}

/**
 * Build the control face. `face(u, v, out)` is the desk frame at (u across, v up the slope, `out`
 * off it); the controls are laid in face-local space = that frame turned so +Y is out of the desk.
 */
export function buildControls(b: NodeBuilder, desk: (u: number, v: number, out?: number) => Matrix4, seed: number, R: Rng, detail: 'high' | 'low'): ControlsOut {
  const hi = detail === 'high';
  const up = new Matrix4().makeRotationX(Math.PI / 2); // face-local +Y out of the desk, -Z up it
  const face = (u: number, v: number, out = 0): Matrix4 => chain(desk(u, v, out), up);
  const put = (g: BufferGeometry, m: Matrix4): BufferGeometry => transform(g, m);

  // ======================================================================
  // THE DIAL
  // ======================================================================
  const dialU = -0.32, dialV = -0.03;
  const dialAt = face(dialU, dialV);
  {
    // the scale sector: cream enamel, a little proud of the desk
    const a = (DIAL.stepDeg * 2 + 14) * DEG;
    const sn = 8;
    const sc = extrude(sector(DIAL.scale0, DIAL.scale1, -a, a, sn), 0.014, { axis: 'y', bevel: 0.005, bevelBase: 0, radius: sectorRadii(sn, 0.016), segs: 1, detail, band: 0, caps: 'end' });
    b.add(part('steel', put(sc, dialAt), 'paper', { seed: seed + 1, shade: 0.95, jitter: 0.02 }));
    // five ticks in ink, growing from slow (left) to fast (right)
    const ticks: KitPart[] = [];
    for (let d = 1; d <= DIAL.detents; d++) {
      const k = (d - 1) / (DIAL.detents - 1);
      const ang = (3 - d) * DIAL.stepDeg * DEG;
      const w = 0.012 + 0.026 * k, r0 = DIAL.scale0 + 0.018, r1 = DIAL.scale1 - 0.016 + 0.004 * k;
      const hw0 = w * 0.4, hw1 = w / 2; // a wedge: wider at the rim
      const c = Math.cos(ang), s = Math.sin(ang);
      // in the tick's own frame (x across, -z out along the radius), then turned to its angle
      const loc: Array<[number, number]> = [[-hw0, -r0], [hw0, -r0], [hw1, -r1], [-hw1, -r1]];
      const out = loc.map(([x, z]) => [x * c + z * s, -x * s + z * c] as [number, number]);
      ticks.push(part('steel', put(glyph(out, 0.004, 0.0135), dialAt), 'ink', { seed: seed + 2 + d, shade: 0.9 }));
    }
    b.add(...ticks);
    // the bezel the knob sits in: a turned brass ring, three screws
    const bz = lathe(
      profile(DIAL.r + 0.024, 0.0).to(DIAL.r + 0.024, 0.016, { fillet: 0.007, segs: 1 }).to(DIAL.r + 0.004, 0.024, { sharp: true }).to(DIAL.r - 0.004, 0.02, { sharp: true }),
      { segs: 16, detail, band: 0, caps: false },
    );
    b.add(setFinish(part('brass', put(bz, dialAt), 'brass', { seed: seed + 9, warm: 0.03, shade: 0.9 }), 0.3));
    // the knob: its own node, turning about +Y (out of the desk)
    const n = b.node('dial', dialAt);
    // the grip: a fluted brass body (ten scallops round its rim, so its outline says 'turn me' face-on), its top edge bevelled
    const lobes = 10, np = lobes * 4;
    const rim: Array<[number, number]> = [];
    for (let i = 0; i < np; i++) {
      const th = (i / np) * Math.PI * 2;
      const r = DIAL.r - 0.012 + 0.012 * Math.cos(lobes * th);
      rim.push([Math.cos(th) * r, Math.sin(th) * r]);
    }
    const body = extrude(rim, 0.1, { axis: 'y', bevel: 0.016, bevelBase: 0, radius: 0, segs: 1, detail, band: 0, caps: 'end' });
    n.add(part('brass', transform(body, T(0, 0.02, 0)), 'brass', { seed: seed + 11, shade: 0.82, warm: 0.05 }));
    // a domed, polished cap in the middle of the grip's top
    const crown = lathe(profile(0.15, 0.118).to(0.15, 0.124, { sharp: true }).to(0.09, DIAL.top - 0.004, { fillet: 0.04, segs: 1 }).to(0, DIAL.top), { segs: 20, detail, band: 0, caps: false });
    n.add(setFinish(part('brass', crown, 'brass', { seed: seed + 12, warm: 0.03 }), 0.55));
    // the pointer fin: cream, from a short tail across the crown to a point past the knurl, over the scale
    const fin = extrude([[-0.03, 0.1], [0.03, 0.1], [0.03, -0.17], [0, -DIAL.r - 0.026], [-0.03, -0.17]], 0.034, { axis: 'y', bevel: 0.008, bevelBase: 0, radius: [0.012, 0.012, 0.01, 0.006, 0.01], segs: 1, detail, band: 0, caps: 'end' });
    n.add(setFinish(part('steel', transform(fin, T(0, DIAL.top - 0.022, 0)), 'paper', { seed: seed + 13, shade: 1.0 }), 0.6));
  }

  // ======================================================================
  // THE LEVER
  // ======================================================================
  const leverU = 0.29, leverV = -0.22;
  const leverAt = face(leverU, leverV);
  {
    const sa = (LEVER.throwDeg + 13) * DEG;
    // the gate: a brass sector with the slot cut through it, three notches where the latch drops in
    const gr0 = 0.18, gr1 = 0.34;
    const slotA = (LEVER.throwDeg + 4) * DEG, sw = 0.017;
    const N = 8;
    const notchAt = (a: number): Array<[number, number]> => [polar(LEVER.slotR + sw - 0.004, a - 0.055), polar(LEVER.slotR + sw - 0.004, a + 0.055), polar(LEVER.slotR + sw + 0.03, a + 0.042), polar(LEVER.slotR + sw + 0.03, a - 0.042)];
    const gate = extrude(sector(gr0, gr1, -sa, sa, N), 0.018, { axis: 'y', bevel: 0.006, bevelBase: 0, radius: sectorRadii(N, 0.02), segs: 1, detail, band: 0, caps: 'end' });
    b.add(part('steel', put(gate, leverAt), 'ink', { seed: seed + 20, shade: 1.6, jitter: 0.02 }));
    // the slot the latch runs in and its three notches: brass-lined, a hair proud of the gate's face (a cut would cost three times as much)
    const lined: KitPart[] = [setFinish(part('brass', put(glyph(sector(LEVER.slotR - sw, LEVER.slotR + sw, -slotA, slotA, 6), 0.003, 0.018), leverAt), 'brass', { seed: seed + 19, shade: 0.8 }), 0.4)];
    for (const a of [-LEVER.throwDeg * DEG, 0, LEVER.throwDeg * DEG]) lined.push(setFinish(part('brass', put(glyph(notchAt(a), 0.003, 0.0182), leverAt), 'brass', { seed: seed + 18, shade: 0.8 }), 0.4));
    b.add(...lined);
    // screws holding the gate
    for (const a of [-sa + 0.08, sa - 0.08]) {
      const [x, z] = polar((gr0 + gr1) / 2, a);
      b.small(() => [part('brass', transform(stud(0.014, 0.008, 6), chain(leverAt, T(x, 0.018, z))), 'brass', { seed: seed + 21, shade: 0.75 })]);
    }
    // the marks, cream on the desk: an arrow out past each end of the gate, a square over the middle notch
    const arrow = (dir: 1 | -1): Array<[number, number]> => {
      // pointing along x by dir: a fat head and a short stem
      const L = 0.13, hw = 0.05, sw2 = 0.019, hl = 0.065;
      return [[-dir * L / 2, -sw2], [dir * (L / 2 - hl), -sw2], [dir * (L / 2 - hl), -hw], [dir * L / 2, 0], [dir * (L / 2 - hl), hw], [dir * (L / 2 - hl), sw2], [-dir * L / 2, sw2]].map(([x, z]) => [x, z] as [number, number]);
    };
    const marks: KitPart[] = [];
    for (const dir of [-1, 1] as const) {
      const pts = arrow(dir);
      // under the gate's end, level with the hub, pointing out the way the lever leans
      const cx = dir * 0.255, cz = 0.03;
      const o = dir > 0 ? pts : pts.slice().reverse();
      marks.push(part('steel', put(glyph(o.map(([x, z]) => [x + cx, z + cz] as [number, number]), 0.006, 0.0), leverAt), 'paper', { seed: seed + 22 + dir, shade: 0.95 }));
    }
    {
      const [cx, cz] = polar(LEVER.reach + LEVER.ballR + 0.07, 0);
      const q = 0.03;
      marks.push(part('steel', put(glyph([[cx - q, cz - q], [cx - q, cz + q], [cx + q, cz + q], [cx + q, cz - q]], 0.006, 0.0), leverAt), 'paper', { seed: seed + 24, shade: 0.95 }));
    }
    b.add(...marks);
    // the hub's boss on the desk
    const boss = lathe(profile(0.05, 0).to(0.085, 0, { sharp: true }).to(0.085, 0.02, { fillet: 0.008, segs: 1 }).to(0.05, 0.03, { sharp: true }), { segs: 10, detail, band: 0, caps: false });
    b.add(part('brass', put(boss, leverAt), 'brass', { seed: seed + 25, shade: 0.85, warm: 0.03 }));

    // the lever: its own node, swinging about +Y (out of the desk) through its hub
    const n = b.node('lever', leverAt);
    const yS = 0.056; // the shaft's height off the desk
    const hub = lathe(profile(0.02, 0.018).to(0.07, 0.018, { sharp: true }).to(0.07, 0.066, { fillet: 0.014, segs: 1 }).to(0.034, 0.08, { fillet: 0.01, segs: 1 }).to(0, 0.082), { segs: 10, detail, band: 0, caps: false });
    n.add(part('brass', hub, 'brass', { seed: seed + 26, warm: 0.04 }));
    n.add(setFinish(part('brass', transform(hexHead(0.056, 0.022, 0.2), T(0, 0.082, 0)), 'brass', { seed: seed + 27 }), 0.5));
    // the shaft: a tapered steel bar from the hub out to the ball, running up the desk (-z)
    const shaftLen = LEVER.reach - LEVER.ballR * 0.6;
    const sh = lathe(profile(0.034, 0).to(0.034, 0.02, { sharp: true }).to(0.025, shaftLen, { sharp: true }), { segs: 8, detail, band: 0, caps: false });
    n.add(part('metal', transform(sh, chain(T(0, yS, -0.04), new Matrix4().makeRotationX(-Math.PI / 2))), 'steel', { seed: seed + 28, shade: 1.05 }));
    // the latch: a block on the shaft over the slot, its pin dropped into the notch
    n.add(part('metal', bevelBox({ min: [-0.04, yS - 0.034, -LEVER.slotR - 0.035], max: [0.04, yS + 0.028, -LEVER.slotR + 0.035], c: 0.01, omit: ['ny'] }), 'steel', { seed: seed + 29, shade: 0.9 }));
    // a brass ferrule and the cream ball grip
    const fz = -(LEVER.reach - LEVER.ballR * 0.9);
    const fer = lathe(profile(0.024, 0).to(0.038, 0.006, { sharp: true }).to(0.038, 0.034, { fillet: 0.007, segs: 1 }).to(0.03, 0.04, { sharp: true }), { segs: 8, detail, band: 0, caps: false });
    n.add(part('brass', transform(fer, chain(T(0, yS, fz + 0.03), new Matrix4().makeRotationX(-Math.PI / 2))), 'brass', { seed: seed + 30 }));
    const br = LEVER.ballR;
    const ball = lathe(profile(0.02, 0).curve(br, br, br * 0.95, 0.008, 3).curve(0, br * 2, br * 0.95, br * 2, 3), { segs: 10, detail, band: 0, caps: false });
    n.add(setFinish(part('steel', transform(ball, chain(T(0, yS, fz + 0.006 - 0.004), new Matrix4().makeRotationX(-Math.PI / 2))), 'paper', { seed: seed + 31, shade: 1.02 }), 0.85));
  }

  // ======================================================================
  // THE LAMP: a brass bezel at the desk's top right; the glass is the lamp node's two twins
  // ======================================================================
  const lampAt = desk(0.55, 0.32, 0.0);
  {
    const bz = lathe(profile(0.034, 0).to(0.058, 0, { sharp: true }).to(0.058, 0.022, { fillet: 0.008, segs: 1 }).to(0.036, 0.03, { fillet: 0.005, segs: 1 }), { segs: 10, detail, band: 0, caps: false });
    b.add(setFinish(part('brass', transform(bz, chain(lampAt, up)), 'brass', { seed: seed + 40 }), 0.4));
  }
  void R;
  const grip = (m: Matrix4, x: number, y: number, z: number): Matrix4 => chain(m, T(x, y, z));
  return {
    dial: desk(dialU, dialV, 0),
    lever: desk(leverU, leverV, 0),
    lamp: chain(lampAt, T(0, 0, 0.02)),
    dialGrip: grip(dialAt, 0, DIAL.top * 0.6, 0),
    leverGrip: grip(leverAt, 0, 0.05, -(LEVER.reach - 0.01)),
  };
}
