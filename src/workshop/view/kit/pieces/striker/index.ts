/**
 * The striker (REWRITE.md § B2 X2, § D6; ART-P2 § 5 "THE STRIKER"). Registry
 * name `striker`. Every part that passes under it sounds: the belt is a
 * music box and this is its hammer.
 *
 * An enamel post standing behind the belt's far rail (bolted to it by a
 * bracket), a pivot fork on its top, and an arm reaching forward over the
 * belt to a brass hammer with a red felt face, like a giant typewriter key.
 * On the post's front an open housing shows a brass snail cam turning; a
 * follower rod rides it and lifts the arm from underneath, and a coil spring
 * hung from a gooseneck above throws the hammer down when the cam's step
 * lets go (pose.ts tells the whole mechanism). Beside it, standing on the
 * housing's right side on a bracket, an empty brass-framed card holder (the
 * house-tune card is P4). The station lamp sits on the gooseneck's crown.
 *
 * Origin: the bench under the post's centre. +Z points at the belt (and the
 * visitor): the hammer's axis is STRIKER.reach in front of the pivot, which
 * is the belt's centre line when the origin stands on the bench 0.92 behind
 * it (the bench plan has it at (4.15, 2.78) for a belt centred at z 3.7).
 *
 * Built in world space at rest; each node's parts are carried into its own
 * space. Four meshes: `steel` (enamel, the painted arm, the spring, the
 * bolts, the unlit lamp), `brass`, `rubber` (the felt, the roller's tyre,
 * the stop), `bulb` (the lit lamp: it casts no shadow).
 *
 * Sockets: `base`, `rail` (where the bracket meets the far rail's back face),
 * `hammer` (the felt's centre at rest, -Y down the hammer's axis), `grip`
 * (the hammer head, for a pointer), `card` (the holder's face, +Z out of it),
 * `lamp`.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { NodeBuilder } from '../../compose.ts';
import { chain, mat, part, piece, T } from '../../compose.ts';
import { extrude, lathe, profiledBox, tray } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { helixPath, linePath, polylinePath, sections, sweep } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import { camRadius, HIDDEN, NAMED_POSES, posePiece, REST, rodLength, springRestLength, springSeat, STRIKER } from './pose.ts';
import type { StrikerPose } from './pose.ts';

export {
  poseStriker, posePiece, NAMED_POSES, STRIKER, PART_HEIGHT, REST, COCKED, DROPPED, HIDDEN,
  camRadius, rodTop, rodLength, armOnCam, strikeDeg, stopDeg, feltY, springMatrix, springSeat,
} from './pose.ts';
export type { StrikerPose, PartSize } from './pose.ts';

const DEG = Math.PI / 180;

export interface StrikerOptions extends KitOptions {
  /** Build already posed (a name from NAMED_POSES, or a pose). Rest is the default. */
  pose?: string | StrikerPose;
}

/** Turns a lathe's +Y axis to +Z / +X. */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

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

export function striker(o: StrikerOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('striker', { detail, seed });
  const S = STRIKER;
  const [px, py, pz] = S.pivot;
  /** The mechanism's frame: turned about +Y so the arm reaches forward and left (pose.ts STRIKER.yawDeg). */
  const YAW = new Matrix4().makeRotationY(-S.yawDeg * DEG);
  const root = b;
  const m = b.node('frame', YAW);

  /** Add world-space (rest) parts to a node whose rest world transform is W. */
  const into = (n: NodeBuilder, W: Matrix4, ...ps: KitPart[]): void => {
    const inv = W.clone().invert();
    for (const p of ps) n.add({ ...p, geometry: transform(p.geometry, inv) });
  };

  // ======================================================================
  // LARGE: the base plate, the post, the fork, the gooseneck, the housing
  // ======================================================================
  const yB = 0.055; // base plate top
  const plate = { x0: -0.3, x1: 0.22, z0: -0.22, z1: 0.2 };
  {
    const r = 0.1;
    const w = plate.x1 - plate.x0, d = plate.z1 - plate.z0;
    const g = profiledBox({ w, d, rPlan: r, detail: 'low', band: 0 }, profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.03, { fillet: 0.012, segs: 1 }).to(r - 0.04, yB, { fillet: 0.012, segs: 1 }).to(0, yB));
    transform(g, T((plate.x0 + plate.x1) / 2, 0, 0));
    dentKeep(g, [-0.2, 0.03, plate.z1], [0, 0.3, 1], 0.07, 0.008);
    m.add(part('steel', g, 'teal-panel', { seed, shade: 0.8, jitter: 0.03 }));
  }
  const postTop = 1.33;
  const post = { hx: 0.12, hz: 0.11 };
  {
    // a square column with chamfered corners, flared at its foot and capped at its top
    const r = 0.035;
    const g = profiledBox(
      { w: post.hx * 2, d: post.hz * 2, rPlan: r, detail: 'low', band: 0 },
      profile(0, 0).to(r + 0.05, 0, { sharp: true }).to(r + 0.05, 0.02, { fillet: 0.01, segs: 1 }).to(r, 0.13, { fillet: 0.08, segs: 2 }).to(r, postTop - yB - 0.05, { sharp: true }).to(r + 0.018, postTop - yB - 0.035, { fillet: 0.008, segs: 1 }).to(r + 0.018, postTop - yB, { fillet: 0.01, segs: 1 }).to(0, postTop - yB),
    );
    transform(g, T(0, yB, 0));
    dentKeep(g, [post.hx, 0.7, post.hz], [1, 0, 1], 0.06, 0.01);
    m.add(part('steel', g, 'teal-panel', { seed: seed + 1, shade: 1.08, jitter: 0.03 }));
  }
  // the fork: two cheeks rising from the post's cap, the pin through them, brass bushes outside
  {
    const t = 0.03, gap = 0.065;
    for (const s of [-1, 1]) {
      const outline: Array<[number, number]> = [[-0.1, postTop - 0.01], [0.1, postTop - 0.01], [0.075, py + 0.02], [0, py + 0.08], [-0.075, py + 0.02]];
      const g = extrude(outline, t, { radius: [0, 0, 0.05, 0.07, 0.05], bevel: 0.008, bevelBase: 0.008, segs: 1, detail: 'low', band: 0 });
      // outline drawn in (z, y): turn it so it stands in the YZ plane, thickness along X
      transform(g, chain(T(s > 0 ? gap : -gap - t, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2), T(0, 0, -t)));
      m.add(part('steel', g, 'teal-panel', { seed: seed + 2, shade: 1.15 }));
      const bush = lathe(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.016, { fillet: 0.008, segs: 1 }).to(0.026, 0.028, { fillet: 0.006, segs: 1 }).to(0, 0.03), { segs: hi ? 10 : 8, detail, band: 0 });
      m.add(setFinish(part('brass', transform(bush, chain(T(px + s * (gap + t), py, pz), new Matrix4().makeRotationZ(-s * Math.PI / 2))), 'brass', { seed: seed + 3, warm: 0.03 }), 0.5));
    }
  }
  // the gooseneck: an enamel tube from the post's back, up and over, ending in the spring's boss
  const [bx, by, bz] = S.boss;
  {
    const pts: Array<[number, number, number]> = [[0, postTop - 0.06, -post.hz + 0.02], [0, postTop + 0.1, -post.hz - 0.06], [0, by + 0.1, -post.hz - 0.04], [0, by + 0.12, bz - 0.06], [0, by + 0.06, bz]];
    const g = sweep(polylinePath(pts, 0.14, hi ? 3 : 2), { section: sections.roundRect(0.022, 0.012, 2), radius: 0.02, up: [1, 0, 0], ends: 'flat', detail });
    m.add(part('steel', g, 'teal-panel', { seed: seed + 4, shade: 1.05, jitter: 0.03 }));
    // the boss the spring hangs from, and the knurled brass screw that sets its load
    const boss = lathe(profile(0, 0).to(0.055, 0, { fillet: 0.012, segs: 1 }).to(0.058, 0.07, { fillet: 0.014, segs: 1 }).to(0, 0.075), { segs: hi ? 10 : 8, detail, band: 0 });
    m.add(part('steel', transform(boss, T(bx, by, bz)), 'teal-panel', { seed: seed + 5, shade: 1.1 }));
    const knob = lathe(profile(0.012, 0).to(0.012, 0.03, { sharp: true }).to(0.04, 0.035, { fillet: 0.006, segs: 1 }).to(0.04, 0.065, { fillet: 0.008, segs: 1 }).to(0, 0.07), { segs: hi ? 10 : 8, detail, band: 0, caps: 'end' });
    m.add(setFinish(part('brass', transform(knob, T(bx, by + 0.075, bz)), 'brass', { seed: seed + 6, warm: 0.04 }), 0.6));
  }
  // the cam housing: an open-fronted enamel box on the post's front, a brass lip round its mouth
  const [cx, cy, cz] = S.cam;
  const hw = 0.28, hh = 0.27; // half width and height (its left wall against the post's right face)
  const hz0 = -0.05, hz1 = cz + 0.085;
  {
    const g = tray({ w: hw * 2, d: hh * 2, h: hz1 - hz0, wall: 0.03, rInner: 0.02, rBottom: 0.03, segs: 2, detail: 'low', band: 0 });
    transform(g, chain(T(cx, cy, hz0), new Matrix4().makeRotationX(Math.PI / 2)));
    dentKeep(g, [cx + hw, cy + hh - 0.04, hz1], [-1, -0.3, -1], 0.05, 0.008);
    m.add(part('steel', g, 'teal-panel', { seed: seed + 7, shade: 1.0, jitter: 0.03 }));
    // the lip: a thin brass frame round the mouth
    const lw = 0.022;
    const lip = extrude([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], 0.012, { holes: [[[-hw + lw, -hh + lw], [hw - lw, -hh + lw], [hw - lw, hh - lw], [-hw + lw, hh - lw]]], radius: 0.03, holeRadius: 0.012, bevel: 0.005, bevelBase: 0, caps: 'end', segs: 1, detail: 'low', band: 0 });
    m.add(setFinish(part('brass', transform(lip, T(cx, cy, hz1 - 0.004)), 'brass', { seed: seed + 8, warm: 0.03 }), 0.3));
    // the rocker shaft's outboard bearing: a pillow block on the housing's top
    {
      const xb = cx + 0.17, y0 = cy + hh;
      m.add(part('steel', bevelBox({ min: [xb - 0.04, y0 - 0.01, -0.05], max: [xb + 0.04, py - 0.01, 0.05], c: 0.012, omit: ['ny'] }), 'teal-panel', { seed: seed + 12, shade: 1.1 }));
      const cap = lathe(profile(0, -0.045).to(0.05, -0.045, { fillet: 0.012, segs: 1 }).to(0.05, 0.045, { fillet: 0.012, segs: 1 }).to(0, 0.045), { segs: hi ? 12 : 9, detail, band: 0 });
      m.add(setFinish(part('brass', transform(cap, chain(T(xb, py, pz), Y_TO_X)), 'brass', { seed: seed + 13, warm: 0.03 }), 0.5));
    }
    // the follower's guide: a brass bush through the housing's top
    const guide = lathe(profile(0.018, 0).to(0.036, 0, { sharp: true }).to(0.036, 0.04, { fillet: 0.008, segs: 1 }).to(0.018, 0.045), { segs: hi ? 10 : 8, detail, band: 0, caps: false });
    m.add(part('brass', transform(guide, T(cx, cy + hh - 0.005, cz)), 'brass', { seed: seed + 9 }));
  }
  // the bracket to the belt's far rail: a bent steel strap from the post's front, two bolts into the rail
  const railZ = 0.3;
  {
    const g = bevelBox({ min: [-0.08, 0.3, 0.02], max: [0.08, 0.46, railZ], c: 0.012, omit: ['ny'] });
    root.add(part('steel', g, 'teal-panel', { seed: seed + 10, shade: 0.9 }));
    for (const x of [-0.045, 0.045]) root.add(part('steel', transform(hexHead(0.05, 0.025, R.range(0, 1)), T(x, 0.46, railZ - 0.04)), 'steel', { seed: seed + 11 }));
  }

  // ======================================================================
  // THE CAM (turns about +Z): a brass snail plate on a hub
  // ======================================================================
  {
    const Cw = chain(T(cx, cy, cz), new Matrix4().makeRotationZ(-REST.turns * Math.PI * 2)); // cam frame (XY plane, +Z out) -> world
    const camW = chain(Cw, Y_TO_Z);
    const cam = m.node('cam', camW);
    const n = hi ? 22 : 16;
    const pts: Array<{ u: number; r: number; c: number }> = [];
    for (let i = 0; i < n; i++) pts.push({ u: i / n, r: camRadius(i / n), c: 0 });
    // the step: a crisp face from the peak down to the base circle
    pts.push({ u: S.rise - 1e-4, r: S.peakR, c: 0.006 }, { u: S.rise + S.step, r: S.baseR, c: 0.006 });
    pts.sort((p, q) => p.u - q.u);
    const outline = pts.map(({ u, r }) => [r * Math.cos(2 * Math.PI * u + Math.PI / 2), r * Math.sin(2 * Math.PI * u + Math.PI / 2)] as [number, number]);
    const g = extrude(outline, 0.04, { radius: pts.map((p) => p.c), bevel: 0.008, bevelBase: 0, caps: 'end', segs: 1, detail, band: 0 });
    into(cam, camW, setFinish(part('brass', transform(g, chain(Cw, T(0, 0, -0.02))), 'brass', { seed: seed + 20, warm: 0.04 }), 0.4));
    // the hub and its nut
    const hub = lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.05, 0.03, { fillet: 0.01, segs: 1 }).to(0, 0.032), { segs: hi ? 12 : 8, detail, band: 0 });
    into(cam, camW, part('brass', transform(hub, chain(Cw, T(0, 0, 0.02), Y_TO_Z)), 'brass', { seed: seed + 21 }));
    into(cam, camW, part('steel', transform(hexHead(0.05, 0.022, 0), chain(Cw, T(0, 0, 0.05), Y_TO_Z)), 'steel', { seed: seed + 22 }));
    // a drilled spot so the turning reads even where the spiral is slow
    into(cam, camW, part('steel', transform(stud(0.016, 0.004, 6), chain(Cw, T(0, -0.05, 0.021), Y_TO_Z)), 'ink', { shade: 1.2 }));
  }

  // ======================================================================
  // THE FOLLOWER (slides up along +Y): roller on the cam, rod up to the arm
  // ======================================================================
  {
    const yRoll = cy + camRadius(REST.turns) + S.rollerR;
    const fW = chain(T(cx, yRoll, cz), new Matrix4().makeRotationZ(Math.PI / 2));
    const f = m.node('follower', fW);
    const rodLen = rodLength();
    const rod = sweep(linePath([cx, yRoll + 0.02, cz], [cx, yRoll + rodLen, cz], 1), { radius: 0.014, segs: 6, ends: 'round', detail });
    into(f, fW, part('steel', rod, 'steel', { seed: seed + 25, shade: 1.15 }));
    // the roller in a fork at the rod's foot
    const roll = lathe(profile(0, -0.014).to(S.rollerR, -0.014, { fillet: 0.006, segs: 1 }).to(S.rollerR, 0.014, { fillet: 0.006, segs: 1 }).to(0, 0.014), { segs: hi ? 10 : 8, detail, band: 0 });
    into(f, fW, part('rubber', transform(roll, chain(T(cx, yRoll, cz + 0.01), Y_TO_Z)), 'ink', { seed: seed + 26, shade: 1.4 }));
    into(f, fW, part('steel', bevelBox({ min: [cx - 0.02, yRoll, cz - 0.02], max: [cx + 0.02, yRoll + 0.05, cz + 0.035], c: 0.006, omit: ['nz'] }), 'steel', { seed: seed + 27 }));
    // a little brass pad on top where it meets the arm
    const pad = lathe(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.016, { fillet: 0.006, segs: 1 }).to(0, 0.016), { segs: 8, detail, band: 0 });
    into(f, fW, part('brass', transform(pad, T(cx, yRoll + rodLen - 0.016, cz)), 'brass', { seed: seed + 28 }));
  }

  // ======================================================================
  // THE ARM (turns about +X): built level in its own frame A (origin the
  // pivot, +Z along the arm, +Y up), then raised to its rest angle
  // ======================================================================
  const Aw = chain(T(px, py, pz), new Matrix4().makeRotationX(-REST.deg * DEG)); // A -> world at rest
  const armW = chain(Aw, new Matrix4().makeRotationZ(-Math.PI / 2)); // node: local +Y is the pin (+X)
  const arm = m.node('arm', armW);
  const A = (g: BufferGeometry): BufferGeometry => transform(g, Aw);
  const reach = S.reach;
  {
    // the bar: a deep painted steel arm, tapering to the hammer
    const bar = sweep(linePath([0, 0, -0.09], [0, 0, reach - 0.08], 1), { section: sections.roundRect(0.02, 0.016, 2), radius: 0.014, up: [1, 0, 0], taper: (t) => 1 - 0.28 * t, step: 0.5, ends: 'flat', detail });
    into(arm, armW, part('steel', A(bar), 'steel', { seed: seed + 30, shade: 0.58, jitter: 0.03 }));
    // the hub between the fork's cheeks
    const hub = lathe(profile(0, -0.06).to(0.05, -0.06, { fillet: 0.012, segs: 1 }).to(0.05, 0.06, { fillet: 0.012, segs: 1 }).to(0, 0.06), { segs: hi ? 12 : 9, detail, band: 0 });
    into(arm, armW, part('steel', A(transform(hub, Y_TO_X)), 'steel', { seed: seed + 31, shade: 0.8 }));
    // the rocker shaft, out through the fork's right cheek to a bearing over the cam housing, and the lifter on it
    const xL = cx;
    const shaft = sweep(linePath([0.05, 0, 0], [xL + 0.12, 0, 0], 1), { radius: 0.022, segs: 8, ends: 'flat', detail });
    into(arm, armW, part('steel', A(shaft), 'steel', { seed: seed + 37, shade: 1.1 }));
    const lifter = bevelBox({ min: [xL - 0.035, -0.03, -0.04], max: [xL + 0.035, 0.03, S.tappet + 0.04], c: 0.012 });
    into(arm, armW, part('steel', A(lifter), 'steel', { seed: seed + 38, shade: 0.75 }));
    into(arm, armW, part('brass', A(transform(lathe(profile(0, -0.045).to(0.042, -0.045, { fillet: 0.01, segs: 1 }).to(0.042, 0.045, { fillet: 0.01, segs: 1 }).to(0, 0.045), { segs: 10, detail, band: 0 }), chain(T(xL, 0, 0), Y_TO_X))), 'brass', { seed: seed + 39 }));
    // the tail: a rounded counterweight behind the pivot
    const tail = lathe(profile(0, 0).to(0.045, 0, { fillet: 0.015, segs: 1 }).to(0.045, 0.08, { fillet: 0.02, segs: 1 }).to(0, 0.085), { segs: hi ? 10 : 8, detail, band: 0 });
    into(arm, armW, part('steel', A(transform(tail, chain(T(0, 0, -0.08), new Matrix4().makeRotationX(-Math.PI / 2)))), 'steel', { seed: seed + 32, shade: 0.8 }));
    // the spring's cup on top
    const cup = lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.05, 0.022, { fillet: 0.006, segs: 1 }).to(0.038, 0.024, { sharp: true }).to(0.038, 0.012, { sharp: true }).to(0, 0.012), { segs: hi ? 12 : 9, detail, band: 0 });
    into(arm, armW, part('brass', A(transform(cup, T(0, S.armHalf - 0.004, S.springAt))), 'brass', { seed: seed + 33, warm: 0.03 }));
    // a ferrule where the arm meets the head
    const fer = lathe(profile(0.034, 0).to(0.046, 0.01, { sharp: true }).to(0.046, 0.05, { sharp: true }).to(0.036, 0.06), { segs: hi ? 10 : 8, detail, band: 0, caps: false });
    into(arm, armW, part('brass', A(transform(fer, chain(T(0, 0, reach - 0.15), new Matrix4().makeRotationX(Math.PI / 2)))), 'brass', { seed: seed + 34 }));
    // the hammer: a turned brass head like a typewriter key, a dished top, a fat red felt face
    const fd = S.feltDrop;
    const head = lathe(
      profile(0, -fd + 0.035).to(0.105, -fd + 0.035, { sharp: true }).to(0.11, -fd + 0.05, { fillet: 0.008, segs: 1 }).to(0.1, 0.0, { smooth: true }).to(0.116, 0.035, { fillet: 0.012, segs: 1 }).to(0.112, 0.055, { fillet: 0.012, segs: 2 }).to(0.08, 0.058, { fillet: 0.01, segs: 1 }).to(0.07, 0.045, { smooth: true }).to(0, 0.042),
      { segs: hi ? 14 : 10, detail, band: 0 },
    );
    into(arm, armW, setFinish(part('brass', A(transform(head, T(0, 0, reach))), 'brass', { seed: seed + 35, warm: 0.04 }), 0.45));
    const keyTop = lathe(profile(0, 0.043).to(0.074, 0.043, { fillet: 0.01, segs: 1 }).to(0.074, 0.05, { sharp: true }).to(0, 0.054), { segs: hi ? 14 : 10, detail, band: 0, caps: false });
    into(arm, armW, part('steel', A(transform(keyTop, T(0, 0, reach))), 'paper', { seed: seed + 41, shade: 0.92 }));
    const felt = lathe(profile(0, -fd).to(0.088, -fd, { fillet: 0.02, segs: 2 }).to(0.1, -fd + 0.036, { fillet: 0.01, segs: 1 }).to(0, -fd + 0.036), { segs: hi ? 12 : 9, detail, band: 0 });
    into(arm, armW, part('rubber', A(transform(felt, T(0, 0, reach))), 'cable-red', { seed: seed + 36, shade: 0.9 }));
  }

  // ======================================================================
  // THE SPRING: hung from the boss down to the arm's cup
  // ======================================================================
  {
    const rest = springRestLength();
    const seat = springSeat(REST.deg);
    const boss = new Vector3(bx, by, bz);
    const d = seat.clone().sub(boss).normalize();
    const e2 = new Vector3().crossVectors(new Vector3(1, 0, 0), d);
    const spW = chain(T(bx, by, bz), new Matrix4().makeBasis(d, e2, new Vector3(1, 0, 0)));
    const sp = m.node('spring', spW);
    const turns = 6;
    const path = helixPath(0.034, (rest - 0.02) / turns, turns, 5);
    const coil = transform(sweep(path, { radius: 0.011, segs: 4, ends: 'flat', detail }), chain(T(0.01, 0, 0), Y_TO_X));
    sp.add(part('steel', coil, 'steel', { seed: seed + 40, shade: 0.7 }));
  }

  // ======================================================================
  // THE CARD HOLDER: a brass-framed board on a bracket off the cam housing's right side, empty
  // ======================================================================
  const standX = cx + hw + 0.27;
  const cardTilt = 24;
  const cardFace = chain(T(standX, 0.96, 0.02), mat({ rot: [-cardTilt, 0, 0] }));
  {
    // a bent steel bracket off the housing's right wall, its foot screwed on, its end turned up under the holder
    const xw = cx + hw;
    const arm = sweep(polylinePath([[xw - 0.01, 0.78, 0.04], [standX - 0.04, 0.78, 0.04], [standX, 0.82, 0.03]], 0.05, 2), { section: sections.roundRect(0.014, 0.006, 1), radius: 0.01, up: [0, 0, 1], ends: 'flat', detail });
    m.add(part('steel', arm, 'teal-panel', { seed: seed + 50, shade: 1.1 }));
    m.add(part('steel', bevelBox({ min: [xw - 0.004, 0.73, -0.01], max: [xw + 0.012, 0.83, 0.09], c: 0.006, omit: ['nx'] }), 'teal-panel', { seed: seed + 51 }));
    // the backboard: enamel, framed in brass, a ledge along its foot and a clip at its head
    const w = 0.44, h = 0.32;
    const back = bevelBox({ min: [-w / 2, -h / 2, -0.03], max: [w / 2, h / 2, -0.005], c: 0.008, omit: ['nz'] });
    m.add(part('steel', transform(back, cardFace), 'teal-panel', { seed: seed + 51, shade: 0.9 }));
    const fw = 0.016;
    const frame = extrude([[-w / 2 - 0.01, -h / 2 - 0.01], [w / 2 + 0.01, -h / 2 - 0.01], [w / 2 + 0.01, h / 2 + 0.01], [-w / 2 - 0.01, h / 2 + 0.01]], 0.012, { holes: [[[-w / 2 + fw, -h / 2 + fw], [w / 2 - fw, -h / 2 + fw], [w / 2 - fw, h / 2 - fw], [-w / 2 + fw, h / 2 - fw]]], radius: 0.02, holeRadius: 0.006, bevel: 0.004, bevelBase: 0, caps: 'end', segs: 1, detail: 'low', band: 0 });
    m.add(setFinish(part('brass', transform(frame, chain(cardFace, T(0, 0, -0.008))), 'brass', { seed: seed + 52, warm: 0.04 }), 0.3));
    const ledge = bevelBox({ min: [-w / 2, -h / 2 - 0.012, -0.008], max: [w / 2, -h / 2 + 0.008, 0.035], c: 0.006, omit: ['nz'] });
    m.add(part('brass', transform(ledge, cardFace), 'brass', { seed: seed + 53 }));
    const clip = bevelBox({ min: [-0.05, h / 2 - 0.05, 0.002], max: [0.05, h / 2 + 0.012, 0.014], c: 0.005, omit: ['nz'] });
    m.add(setFinish(part('brass', transform(clip, cardFace), 'brass', { seed: seed + 54 }), 0.6));
  }

  // ======================================================================
  // THE STATION LAMP: on the gooseneck's crown, looking up and out
  // ======================================================================
  const lampAt = chain(T(0, by + 0.135, (bz - post.hz - 0.06) / 2 - 0.01), mat({ rot: [35, 0, 0] }));
  {
    const bezel = lathe(profile(0.05, 0).to(0.052, 0.012, { fillet: 0.004, segs: 1 }).to(0.044, 0.032, { fillet: 0.006, segs: 1 }).to(0.034, 0.034, { fillet: 0.003, segs: 1 }).to(0.03, 0.022), { segs: hi ? 12 : 8, detail, band: 0, caps: false });
    m.add(setFinish(part('brass', transform(bezel, lampAt), 'brass', { seed: seed + 60, warm: 0.03 }), 0.5));
    const lamp = m.node('lamp', chain(lampAt, T(0, 0.02, 0)));
    const lens = (cls: 'bulb' | 'steel'): KitPart => {
      const g = lathe(profile(0, 0).to(0.033, 0, { sharp: true }).to(0.031, 0.012, { sharp: true }).to(0.018, 0.026, { sharp: true }).to(0, 0.03), { segs: 8, caps: false, band: 0 });
      return cls === 'bulb' ? setFinish(part('bulb', g, 'amber-glow', { seed: seed + 61 }), 0.55) : setFinish(part('steel', g, 'amber', { seed: seed + 62, shade: 0.3 }), 1);
    };
    lamp.node('lamp.lit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)).add(lens('bulb'));
    lamp.node('lamp.unlit').add(lens('steel'));
  }

  // ======================================================================
  // SMALL: base plate bolts (one replaced in brass)
  // ======================================================================
  {
    const pos: Array<[number, number]> = [[plate.x1 - 0.055, plate.z1 - 0.055], [plate.x0 + 0.055, plate.z1 - 0.055], [plate.x0 + 0.055, plate.z0 + 0.055], [plate.x1 - 0.055, plate.z0 + 0.055]];
    const replaced = R.int(0, pos.length - 1);
    pos.forEach(([x, z], i) => {
      const g = transform(hexHead(0.07, 0.035, R.range(0, Math.PI / 3)), T(x, yB - 0.004, z));
      m.add(i === replaced ? part('brass', g, 'brass', { seed: seed + 70 + i }) : part('steel', g, 'steel', { seed: seed + 70 + i, jitter: 0.06, shade: 0.9 }));
    });
  }

  b.socket('base', new Matrix4());
  b.socket('rail', T(0, 0.38, railZ));
  {
    const AwRoot = chain(YAW, Aw);
    const felt = new Vector3(0, -S.feltDrop, reach).applyMatrix4(AwRoot);
    b.socket('hammer', T(felt.x, felt.y, felt.z));
    const head = new Vector3(0, 0.02, reach).applyMatrix4(AwRoot);
    b.socket('grip', T(head.x, head.y, head.z));
  }
  b.socket('card', chain(YAW, cardFace));
  b.socket('lamp', chain(YAW, lampAt));
  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`striker: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    posePiece(built.root, p);
  }
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'striker',
    build: (opts = {}) =>
      striker({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 5 },
    note: 'The striker: every part that passes under it sounds.',
  },
];
