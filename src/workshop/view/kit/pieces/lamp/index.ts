/**
 * THE LAMP (art-direction § 10, W3 brief § C; V-lamp-r): the body of the key
 * light, and a thing a visitor can take by the shade and swing. Registry name
 * `lamp`.
 *
 * A machinist's task lamp clamped to a short wall rail at the back of the
 * bench: a brass thumbscrew clamp round a steel rail on two brass stand-offs,
 * a riser that swivels in its collar, a brass tilt knuckle, two arm sections
 * of paired steel tubes with exposed tension springs and wing-nut joints, a
 * bell shade on a wrist that tilts and pans (`teal-panel` enamel outside,
 * cream inside, a rolled cream lip) with a turned brass handle on its crown
 * wrapped in `tape-yellow` where the hand goes, an `amber-glow` bulb, a brown
 * cloth cord run along the arm and through the joints.
 *
 * Built in its own space (rig.ts): origin on the bench top at the face of the
 * back wall, below the clamp. At rest (the home pose, aim.ts `HOME`) the
 * filament lands on the stage's key light and the shade's axis points along
 * its aim: the approved G1 picture.
 *
 * NODES (each pivot at its node's origin; aim.ts has the joints and limits):
 *  - `swivel`   the riser, turning about its local +Y in the collar
 *  - `knuckle`  the tilt knuckle, leaning the arm's plane about its local +Z
 *  - `arm1`     the lower arm, about the shoulder pin (+Y)
 *  - `spring1`  (under arm1) the shoulder's spring: from arm 1's lug, its +X
 *               aimed at the knuckle's lug; its coils `spring1.ring<k>` and far
 *               hook `spring1.end` are spread along +X as it stretches
 *  - `arm2`     the upper arm, about the elbow pin (+Y)
 *  - `spring2`  (under arm2) the elbow's spring, from arm 2's lug to arm 1's
 *  - `shade`    the wrist: tilt about the pin (+Y)
 *  - `head`     the shade itself: pan about the wrist's +Z; light along +X
 *  - `bulb.lit` (under head) the glowing bulb, liner and vents, one level of
 *               three shown: `bulb.lit.1` (low) .. `bulb.lit.3` (full);
 *               `bulb.unlit` their dark twins. Hidden nodes are collapsed
 *               into the wrist hub (scale 1e-4).
 * Pose it only through `posePiece` / `poseLamp` (node transforms only).
 *
 * The cord is cut at every joint where it passes through the joint's own
 * axis (a pin's axis beside its hub, the knuckle's lean axis in front of the
 * hub), so it never parts as the arm swings; it goes into the riser through
 * a grommet and comes out under the clamp.
 *
 * Shadows. The key spot sits inside the shade; the shade's opening is wider
 * than the light's cone, so no part of the shade is lit by the key or drawn
 * into its own shadow; the bulb and the glowing liner are `bulb` class, which
 * never casts.
 *
 * Sockets (rest pose; aim.ts `lampSockets(pose)` gives them for any pose):
 * `bulb` (filament, +Y along the light), `shade.grip` (the handle's middle,
 * +Y out of it), `rail` (where the clamp bites), `cord` (where the cord runs
 * off the piece, along -X).
 */
import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { NodeBuilder } from '../../compose.ts';
import { extrude, lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, linePath, polylinePath, curvePath } from '../../sweep.ts';
import { aim, chain, part, piece, place, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, ridgedBand, stud, hexHead, sheet } from '../../cheap.ts';
import { ATTR } from '../../types.ts';
import { tint } from '../../surface.ts';
import { DIM, LAMP_PLACE } from './rig.ts';
import type { V3 } from './rig.ts';
import { HOME, armFrames, jointsOf, aimLamp, AIM_TARGETS } from './aim.ts';
import type { ArmFrames, LampPose } from './aim.ts';
import { SPRINGS, LIT_LEVELS, HIDDEN, nodeTransforms } from './pose.ts';

export { DIM, LAMP_PLACE, STAGE_AIM, STAGE_BULB, solveArm, stageTarget } from './rig.ts';
export type { ArmSolution, V3 } from './rig.ts';
export {
  HOME, LIMITS, JOINTS, MECH, REACH, AIM_FEEL, AIM_TARGETS, aimLamp, armFrames, jointsOf, inReach, nearestInReach, reachInWorld, LEAN_ZERO, landing, lampLight, leanFor, planeOf, clampJoints,
} from './aim.ts';
export type { LampPose, Joint, Aimed, AimOptions, ArmFrames } from './aim.ts';
export { nodeTransforms, lampSockets, SPRINGS, LIT_LEVELS, HIDDEN, springLength, springRest, ringX } from './pose.ts';
export type { SpringSpec } from './pose.ts';

/** The lit liner's vertex-colour scale (× paper) deep in the bell and at the lip, at full: its glow is this × the bulb class's lamp level. */
export const LINER_GLOW = { deep: 0.13, lip: 0.03 } as const;
/** Vent slots in the crown, and their glow at full (× amber-glow × the indicator level). */
const VENTS = 8;
const VENT_GLOW = 0.45;

export interface LampOptions extends KitOptions {
  /** The pose to build in (default home, lit, full). Only node transforms differ between poses. */
  pose?: LampPose;
  /** Lit (default) or dark: shorthand for `pose.on`. */
  on?: boolean;
}

/** Unit vector toward the camera at the stage's 33° pitch (good side +Z). */
const DEG = Math.PI / 180;
const TO_CAMERA = new Vector3(0, Math.sin(33 * DEG), Math.cos(33 * DEG));
/** Turn a lathe built about +Y so its axis runs along +X (the node's arm direction). */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

/** Scale a geometry's vertex colours by f(local y) (the liner's glow falloff). */
function shadeBy(g: BufferGeometry, f: (y: number) => number): BufferGeometry {
  const c = g.getAttribute(ATTR.color);
  const p = g.getAttribute('position');
  for (let i = 0; i < c.count; i++) {
    const k = f(p.getY(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return g;
}

/** Carry parts built in the lamp's space (at home) into a node whose home frame is `F`. */
const into = (F: Matrix4, p: KitPart[]): KitPart[] => place(p, F.clone().invert());

export function lamp(o: LampOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const F: ArmFrames = armFrames(HOME);
  const b = piece('lamp', { detail, seed });

  // which side of the pin faces the camera (the wing nuts go there; the cord runs on the other)
  const camSide = F.pin.dot(TO_CAMERA) >= 0 ? 1 : -1;
  const back = -camSide;
  /** Which local Z (±1) points down in the world, for a node frame (at home). */
  const downZ = (m: Matrix4): number => (new Vector3(0, 0, 1).transformDirection(m).y > 0 ? -1 : 1);
  const at = (m: Matrix4, x: number, y: number, z: number): Vector3 => new Vector3(x, y, z).applyMatrix4(m);

  // ====================================================================
  // THE RAIL: a steel tube on two brass stand-offs screwed to the wall
  // ====================================================================
  const { rail } = DIM;
  {
    const half = rail.len / 2;
    b.add(part('metal', sweep(linePath([-half, rail.y, rail.z], [half, rail.y, rail.z]), { radius: rail.r, segs: 8, ends: 'flat', detail }), 'steel', { seed: seed + 1, shade: 0.9 }));
    // turned end caps
    const cap = lathe(profile(0, 0).to(rail.r + 0.012, 0, { sharp: true }).to(rail.r + 0.012, 0.03, { sharp: true }).curve(0, 0.07, rail.r + 0.01, 0.07, 2), { segs: 7, detail, band: 0, caps: false });
    for (const s of [-1, 1]) b.add(part('brass', transform(cap.clone(), aim([s * half, rail.y, rail.z], [s, 0, 0])), 'brass', { seed: seed + 2 + s }));
    for (const x of [-0.55, 0.58]) {
      // a rosette on the wall and a turned post out to the rail
      const ros = lathe(profile(0.1, 0).to(0.1, 0.016, { sharp: true }).to(0.05, 0.03, { sharp: true }).to(0, 0.032), { segs: 7, detail, band: 0, caps: false });
      b.add(part('brass', transform(ros, aim([x, rail.y, 0], [0, 0, 1])), 'brass', { seed: seed + 5, warm: 0.03 }));
      const post = lathe(profile(0.034, 0).to(0.028, rail.z - 0.07, { smooth: true }).to(0.04, rail.z - 0.05, { sharp: true }).to(0, rail.z - 0.05), { segs: 6, detail, band: 0, caps: false });
      b.add(part('brass', transform(post, aim([x, rail.y, 0.02], [0, 0, 1])), 'brass', { seed: seed + 6 }));
      b.small(() => [part('metal', transform(stud(0.014, 0.01, 5), aim([x + Math.cos(0.4) * 0.072, rail.y + Math.sin(0.4) * 0.072, 0.012], [0, 0, 1])), 'steel', { shade: 0.8 })]);
    }
  }

  // ====================================================================
  // THE CLAMP: a brass C round the rail, the thumbscrew from below
  // ====================================================================
  const clampTop = rail.y + rail.r + 0.1;
  {
    const t = 0.17; // across X
    const top0 = rail.y + rail.r + 0.004;
    const bot1 = rail.y - rail.r - 0.05;
    const bot0 = bot1 - 0.085;
    // outline in (z, y), the throat open toward the wall
    const C: Array<[number, number]> = [
      [0.11, top0], [0.3, top0], [0.3, bot1], [0.13, bot1], [0.13, bot0], [0.385, bot0], [0.4, clampTop - 0.03], [0.36, clampTop], [0.11, clampTop],
    ];
    const g = extrude(C, t, { radius: [0, 0, 0, 0, 0.016, 0.03, 0.04, 0.03, 0], bevel: 0.014, segs: 1, detail, support: false, caps: 'end' });
    transform(g, chain(T(t / 2, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2)));
    b.add(setFinish(part('brass', g, 'brass', { seed: seed + 10, shade: 0.92, warm: 0.03 }), 0.15));
    b.small(() => place([part('brass', stud(0.018, 0.012, 5), 'brass', { seed: seed + 11 })], aim([-0.045, (bot0 + clampTop) / 2 + 0.05, 0.39], [0, 0, 1])));
    b.small(() => place([part('brass', stud(0.018, 0.012, 5), 'brass', { seed: seed + 12 })], aim([0.045, (bot0 + clampTop) / 2 + 0.05, 0.392], [0, 0, 1])));
    // the thumbscrew: a threaded shank, a knurled wheel and a turned end (the pad under the rail is hidden)
    const sx = 0, sz = rail.z;
    const shank = lathe(
      (() => {
        const p = profile(0.022, bot0 - 0.2);
        for (let k = 0; k < 3; k++) p.to(0.022, bot0 - 0.15 + k * 0.1, { smooth: true }).to(0.017, bot0 - 0.1 + k * 0.1, { smooth: true });
        return p.to(0.02, rail.y - rail.r - 0.02);
      })(),
      { segs: 6, detail, band: 0, caps: false },
    );
    b.add(part('metal', transform(shank, T(sx, 0, sz)), 'steel', { seed: seed + 14 }));
    const wy = bot0 - 0.27;
    b.add(setFinish(part('brass', transform(ridgedBand(0.085, 0.05, hi ? 14 : 10, 0.01), T(sx, wy, sz)), 'brass', { seed: seed + 15 }), 0.4));
    const lips = lathe(profile(0, wy - 0.012).to(0.075, wy - 0.012, { sharp: true }).to(0.08, wy, { smooth: true }).to(0.08, wy + 0.05, { smooth: true }).to(0.06, wy + 0.068, { sharp: true }).to(0, wy + 0.072), { segs: 9, detail, band: 0 });
    b.add(part('brass', transform(lips, T(sx, 0, sz)), 'brass', { seed: seed + 16 }));
    const knob = lathe(profile(0.032, 0).to(0.03, -0.05, { smooth: true }).curve(0, -0.08, 0.03, -0.08, 2), { segs: 6, detail, band: 0, caps: false });
    b.add(part('brass', transform(knob, T(sx, wy - 0.012, sz)), 'brass', { seed: seed + 17 }));
  }

  // ====================================================================
  // THE COLLAR (fixed on the clamp) and THE RISER (`swivel`): a steel post
  // turning in the collar, the brass knuckle casting on its top
  // ====================================================================
  const S = F.shoulder;
  const sw = b.node('swivel', F.swivel);
  {
    const y0 = clampTop;
    const col = lathe(profile(0.11, 0).to(0.11, 0.025, { sharp: true }).to(0.075, 0.04, { fillet: 0.01, segs: 1 }).to(0.07, 0.11, { sharp: true }).to(0, 0.11), { segs: 9, detail, band: 0, caps: false });
    b.add(part('brass', transform(col, T(S.x, y0, S.z)), 'brass', { seed: seed + 20, warm: 0.03 }));
    const swParts: KitPart[] = [];
    const post = lathe(profile(0.042, 0).to(0.042, S.y - y0 - 0.2, { smooth: true }).to(0, S.y - y0 - 0.2), { segs: 7, detail, band: 0, caps: false });
    swParts.push(part('metal', transform(post, T(S.x, y0 + 0.1, S.z)), 'steel', { seed: seed + 21 }));
    // the knuckle casting the shoulder hub sits in
    const kn = lathe(profile(0.05, 0).to(0.062, 0.03, { fillet: 0.02, segs: 1 }).curve(0.02, 0.12, 0.08, 0.11, 2).to(0, 0.125), { segs: 9, detail, band: 0, caps: false });
    swParts.push(part('brass', transform(kn, T(S.x, S.y - 0.17, S.z)), 'brass', { seed: seed + 22 }));
    sw.add(into(F.swivel, swParts));
  }

  // ====================================================================
  // THE KNUCKLE: the shoulder's wing nut and the shoulder spring's lug
  // ====================================================================
  const kn = sw.node('knuckle', F.swivel.clone().invert().multiply(F.knuckle));
  const dz1 = downZ(F.arm1), dz2 = downZ(F.arm2);
  {
    const wingAt = aim([S.x + F.pin.x * 0.2 * camSide, S.y + F.pin.y * 0.2 * camSide, S.z + F.pin.z * 0.2 * camSide], [F.pin.x * camSide, F.pin.y * camSide, F.pin.z * camSide], R.range(0, 90));
    kn.add(into(F.knuckle, place(wing(0.2, seed + 41, detail), wingAt)));
    // the lug the shoulder spring hooks to: a brass tongue out of the knuckle, over the arm and between its tubes (built in
    // arm 1's home frame): lowering the arm swings it back from the arm's lug, so the spring stretches as it should
    kn.add(into(F.knuckle, place([part('metal', bevelBox({ min: [0.06, -0.026, Math.min(0, -dz1 * 0.2)], max: [0.34, 0.026, Math.max(0, -dz1 * 0.2)], c: 0.012 }), 'steel', { seed: seed + 39, shade: 0.85 })], F.arm1)));
  }

  // ---- shared joint parts -------------------------------------------------
  const hub = (r: number, hl: number): BufferGeometry =>
    lathe(profile(r * 0.8, -hl).to(r, -hl + 0.02, { sharp: true }).to(r, hl - 0.02, { smooth: true }).to(r * 0.8, hl, { sharp: true }).to(0, hl), { segs: 8, detail, band: 0, caps: false });
  const hubCap = (r: number, hl: number): BufferGeometry => lathe(profile(0, -hl).to(r * 0.8, -hl), { segs: 8, detail, band: 0, caps: false });
  /** A tube along the node's +X at height y. */
  const tube = (x0: number, x1: number, y: number, r: number, z = 0): BufferGeometry => sweep(linePath([x0, y, z], [x1, y, z]), { radius: r, segs: 6, ends: 'flat', detail });
  /** A brass ferrule round a tube end, along +X from x. */
  const ferrule = (x: number, y: number, r: number, len: number, dir: 1 | -1): BufferGeometry => {
    const g = lathe(profile(r, 0).to(r + 0.014, 0.004, { sharp: true }).to(r + 0.014, len * 0.7, { smooth: true }).to(r + 0.004, len, { sharp: true }), { segs: 6, detail, band: 0, caps: false });
    return transform(g, chain(T(x, y, 0), new Matrix4().makeRotationZ(dir === 1 ? -Math.PI / 2 : Math.PI / 2)));
  };
  /** A cloth cord through the points (in one node's space). */
  const cord = (pts: Vector3[], n: number, segs = 4): KitPart =>
    part('rubber', sweep(curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), n), { radius: 0.034, segs, ends: 'flat', detail }), 'wood', { seed: seed + 80, shade: 0.45 });

  // ====================================================================
  // ARM 1 (the shoulder pin is its +Y)
  // ====================================================================
  const arm1 = kn.node('arm1', F.knuckle.clone().invert().multiply(F.arm1));
  const L1 = DIM.l1, L2 = DIM.l2;
  const y1 = 0.13, r1 = 0.046;
  // the cord's passing points: into each joint's hollow pin, at the hub's end away from the camera (on the pin's axis,
  // so the two pieces meet whatever the joint's angle)
  const cordPin = { shoulder: 0.18, elbow: 0.17, wrist: 0.13 };
  {
    arm1.add(part('brass', hub(0.1, 0.2), 'brass', { seed: seed + 30, warm: 0.03 }));
    for (const s of [-1, 1]) {
      arm1.add(part('metal', tube(0.06, L1 - 0.06, s * y1, r1), 'steel', { seed: seed + 31 + s, jitter: 0.04, shade: 1.25 }));
      arm1.add(part('brass', ferrule(0.05, s * y1, r1, 0.13, 1), 'brass', { seed: seed + 33 }));
      arm1.add(part('brass', ferrule(L1 - 0.05, s * y1, r1, 0.13, -1), 'brass', { seed: seed + 34 }));
    }
    const sp = lathe(profile(0.022, -y1).to(0.022, y1), { segs: 6, detail, band: 0, caps: false });
    arm1.add(part('metal', transform(sp, T(L1 * 0.6, 0, 0)), 'steel', { seed: seed + 35 }));
    // the spring's lug at the far end, and the elbow spring's lug just before the elbow
    arm1.add(part('metal', bevelBox({ min: [1.43, -0.035, Math.min(0, dz1 * 0.15)], max: [1.55, 0.035, Math.max(0, dz1 * 0.15)], c: 0.012 }), 'steel', { seed: seed + 40 }));
    arm1.add(part('brass', bevelBox({ min: [L1 - SPRINGS.elbow.lugBack - 0.06, -0.035, Math.min(0, dz1 * (SPRINGS.elbow.lugDown + 0.03))], max: [L1 - SPRINGS.elbow.lugBack + 0.06, 0.035, Math.max(0, dz1 * (SPRINGS.elbow.lugDown + 0.03))], c: 0.012 }), 'brass', { seed: seed + 42 }));
    // the cord: slung under the arm, from the elbow pin's axis to the shoulder pin's
    arm1.add(cord([
      new Vector3(L1, back * cordPin.elbow, 0),
      new Vector3(L1 * 0.85, back * 0.08, dz1 * 0.17),
      new Vector3(L1 * 0.5, back * 0.02, dz1 * 0.22),
      new Vector3(L1 * 0.18, back * 0.1, dz1 * 0.16),
      new Vector3(0, back * cordPin.shoulder, 0),
    ], hi ? 9 : 6));
  }
  spring(arm1, 'spring1', SPRINGS.shoulder, seed + 37);

  // ====================================================================
  // ARM 2 (the elbow pin is its +Y)
  // ====================================================================
  const arm2 = arm1.node('arm2', F.arm1.clone().invert().multiply(F.arm2));
  const y2 = 0.07, r2 = 0.04;
  {
    arm2.add(part('brass', hub(0.095, 0.19), 'brass', { seed: seed + 50, warm: 0.03 }));
    arm2.add(place(wing(0.19, seed + 51, detail), aim([0, camSide * 0.19, 0], [0, camSide, 0], R.range(0, 90))));
    for (const s of [-1, 1]) {
      arm2.add(part('metal', tube(0.06, L2 - 0.06, s * y2, r2), 'steel', { seed: seed + 52 + s, jitter: 0.04, shade: 1.25 }));
      arm2.add(part('brass', ferrule(L2 - 0.05, s * y2, r2, 0.12, -1), 'brass', { seed: seed + 55 }));
    }
    const sp = lathe(profile(0.02, -y2).to(0.02, y2), { segs: 6, detail, band: 0, caps: false });
    arm2.add(part('metal', transform(sp, T(L2 * 0.5, 0, 0)), 'steel', { seed: seed + 56 }));
    arm2.add(part('metal', bevelBox({ min: [1.06, -0.03, Math.min(0, dz2 * 0.13)], max: [1.16, 0.03, Math.max(0, dz2 * 0.13)], c: 0.012 }), 'steel', { seed: seed + 58 }));
    arm2.add(cord([
      new Vector3(L2, back * cordPin.wrist, 0),
      new Vector3(L2 - 0.12, back * 0.1, dz2 * 0.1),
      new Vector3(L2 * 0.62, back * 0.03, dz2 * 0.17),
      new Vector3(L2 * 0.25, back * 0.05, dz2 * 0.12),
      new Vector3(0, back * cordPin.elbow, 0),
    ], hi ? 8 : 6));
  }
  spring(arm2, 'spring2', SPRINGS.elbow, seed + 57);

  // ====================================================================
  // THE WRIST (`shade`: tilt about the pin) and THE SHADE (`head`: pan)
  // ====================================================================
  const wrist = arm2.node('shade', F.arm2.clone().invert().multiply(F.shade));
  {
    wrist.add(part('brass', hub(0.08, 0.15), 'brass', { seed: seed + 60, warm: 0.03 }));
    wrist.add(part('brass', hubCap(0.08, 0.15), 'brass', { seed: seed + 60 }));
    wrist.add(place(wing(0.17, seed + 61, detail), aim([0, camSide * 0.15, 0], [0, camSide, 0], R.range(0, 90))));
  }
  const head = wrist.node('head', F.shade.clone().invert().multiply(F.head));
  const fil = DIM.neck; // filament, along +X
  const bell0 = fil - 0.57; // where the bell's back starts
  const along = (y: number): Matrix4 => chain(T(bell0 + y, 0, 0), Y_TO_X);
  const dzS = downZ(F.head);
  /** The bell's outside profile (about +Y, y along the axis from bell0). */
  const outerProfile = profile(0.11, -0.012)
    .to(0.165, 0.0, { fillet: 0.03, segs: 1 })
    .cubic(0.36, 0.13, 0.25, 0.0, 0.33, 0.06, 2)
    .to(0.38, 0.14, { sharp: true })
    .cubic(0.455, 0.36, 0.42, 0.18, 0.45, 0.26, 2)
    .bead(0.022, 0.06, 3)
    .cubic(0.598, 0.81, 0.47, 0.56, 0.57, 0.72, hi ? 4 : 3);
  /** The bell's outside at height y along its axis: radius and the outward normal (o, y). */
  const bellAt = (y: number): { o: number; no: number; ny: number } => {
    const sm = outerProfile.expand({ detail: 1 });
    for (let i = 1; i < sm.length; i++) {
      const a = sm[i - 1]!, c = sm[i]!;
      if ((a.y - y) * (c.y - y) <= 0 && Math.abs(c.y - a.y) > 1e-6) {
        const f = (y - a.y) / (c.y - a.y);
        const no = c.o - a.o, ny = -(c.y - a.y);
        const l = Math.hypot(no, ny);
        return { o: a.o + (c.o - a.o) * f, no: Math.abs(ny / l), ny: -Math.abs(no / l) * Math.sign(c.o - a.o || 1) };
      }
    }
    return { o: 0.3, no: 1, ny: 0 };
  };
  /** A frame on the bell's outside: at height y along the axis, angle phi round it; X along the meridian, Z out of the surface. */
  const onBell = (y: number, phi: number, lift = 0.003): Matrix4 => {
    const s = bellAt(y);
    const c = Math.cos(phi), sn = Math.sin(phi);
    const X = new Vector3(-s.ny * c, s.no, -s.ny * sn);
    const Z = new Vector3(s.no * c, s.ny, s.no * sn);
    const Y = new Vector3().crossVectors(Z, X);
    return chain(along(0), new Matrix4().makeBasis(X, Y, Z).setPosition(s.o * c + Z.x * lift, y + Z.y * lift, s.o * sn + Z.z * lift));
  };
  /** The lathe angle (about the bell's axis) that faces a head-space direction. */
  const phiToward = (d: Vector3): number => {
    // lathe space: y along the axis (head +X); the lathe's (x, z) are head (-y, z) after Y_TO_X
    const v = d.clone().applyMatrix4(new Matrix4().copy(Y_TO_X).invert());
    return Math.atan2(v.z, v.x);
  };
  const toCamH = TO_CAMERA.clone().transformDirection(F.head.clone().invert());
  const upH = new Vector3(0, 1, 0).transformDirection(F.head.clone().invert());
  {
    // the stem and the neck housing (teal-light enamel, a groove, a brass switch knob)
    const stem = lathe(profile(0.034, 0).to(0.034, 0.2), { segs: 7, detail, band: 0, caps: false });
    head.add(part('brass', transform(stem, chain(T(0.04, 0, 0), Y_TO_X)), 'brass', { seed: seed + 62 }));
    const neck = lathe(profile(0.075, 0).to(0.105, 0.05, { fillet: 0.02, segs: 1 }).to(0.105, 0.11).groove(0.008, 0.016, 0, 0).to(0.11, 0.2, { fillet: 0.014, segs: 1 }).to(0.16, 0.215, { sharp: true }).to(0, 0.225), { segs: 8, detail, band: 0, caps: false });
    head.add(part('steel', transform(neck, chain(T(bell0 - 0.2, 0, 0), Y_TO_X)), 'teal-light', { seed: seed + 63, shade: 0.8 }));
    const knob = lathe(profile(0.03, 0).to(0.028, 0.04).to(0.04, 0.045, { sharp: true }).to(0.04, 0.075, { fillet: 0.012, segs: 1 }).to(0, 0.08), { segs: 6, detail, band: 0, caps: false });
    head.add(setFinish(part('brass', transform(knob, aim([bell0 - 0.11, camSide * 0.1, 0], [0, camSide, 0])), 'brass', { seed: seed + 64 }), 0.4));
    // the cord's gland on top of the housing
    const gl = lathe(profile(0.035, 0).to(0.032, 0.05, { sharp: true }).to(0.026, 0.06).to(0, 0.06), { segs: 6, detail, band: 0, caps: false });
    head.add(part('rubber', transform(gl, aim([bell0 - 0.1, 0, -dzS * 0.1], [0, 0, -dzS])), 'ink'));
    // the cord: out of the gland, over and down into the wrist hub's end (the wrist pin's axis)
    const end = new Vector3(0, back * cordPin.wrist, 0).applyMatrix4(F.head.clone().invert().multiply(F.shade));
    head.add(cord([
      new Vector3(bell0 - 0.1, 0, -dzS * 0.16),
      new Vector3(bell0 - 0.24, back * 0.05, -dzS * 0.17),
      end,
    ], hi ? 6 : 4));

    // the bell, outside: teal enamel
    const outer = lathe(outerProfile, { segs: hi ? 16 : 12, detail, caps: false, band: 0 });
    head.add(part('steel', transform(outer, along(0)), 'teal-panel', { seed: seed + 65, shade: 1.08, jitter: 0.03 }));
    // the rolled lip: cream enamel wrapped over the edge
    const lip = lathe(profile(0.596, 0.8).to(0.632, 0.838, { fillet: 0.02, segs: 1 }).to(0.614, 0.872, { sharp: true }).to(0.58, 0.858, { sharp: true }).to(0.572, 0.82).close(), { segs: hi ? 16 : 12, detail, band: 0 });
    {
      const sf = lip.getAttribute(ATTR.surf);
      for (let i = 0; i < sf.count; i++) sf.setX(i, sf.getX(i) * 0.45);
    }
    head.add(part('steel', transform(lip, along(0)), 'paper', { seed: seed + 66, shade: 0.82 }));
    // a brass maker's badge riveted on the visitor's side of the bell
    {
      const toCam = toCamH;
      const ang = Math.atan2(toCam.z, toCam.y) + R.spread(0.15);
      const yb = 0.6, ob = 0.548, slope = Math.atan(0.5);
      const at0 = chain(T(bell0 + yb, 0, 0), new Matrix4().makeRotationX(ang), T(0, ob + 0.004, 0), new Matrix4().makeRotationZ(-slope));
      head.add(setFinish(part('brass', transform(bevelBox({ min: [-0.09, 0, -0.055], max: [0.09, 0.012, 0.055], c: 0.005, omit: ['ny'] }), at0), 'brass', { seed: seed + 70, shade: 0.9 }), 0.3));
      head.small(() => [-0.065, 0.065].map((x) => part('brass', transform(stud(0.012, 0.01, 4), chain(at0, T(x, 0.012, 0))), 'brass', { seed: seed + 71 })));
      for (const z of [-0.018, 0.018]) head.add(part('metal', transform(bevelBox({ min: [-0.06, 0.012, z - 0.004], max: [0.06, 0.0135, z + 0.004], c: 0, omit: ['ny'] }), at0), 'ink', { shade: 1.5 }));
    }
    // the grip: a turned brass handle on the crown, bridging two turned posts, its middle wrapped in yellow tape
    {
      const phi = phiToward(upH.clone().addScaledVector(toCamH, 0.35));
      const g = GRIP;
      const a0 = onBell(g.y0, phi), a1 = onBell(g.y1, phi);
      const p0 = new Vector3().setFromMatrixPosition(a0), p1 = new Vector3().setFromMatrixPosition(a1);
      const n0 = new Vector3(0, 0, 1).transformDirection(a0), n1 = new Vector3(0, 0, 1).transformDirection(a1);
      const q0 = p0.clone().addScaledVector(n0, g.stand), q1 = p1.clone().addScaledVector(n1, g.stand);
      for (const [p, n] of [[p0, n0], [p1, n1]] as const) {
        const post = lathe(profile(0.045, 0).to(0.045, 0.02, { sharp: true }).to(0.026, 0.035, { sharp: true }).to(0.024, g.stand, { smooth: true }), { segs: 6, detail, band: 0, caps: false });
        head.add(part('brass', transform(post, aim([p.x, p.y, p.z], [n.x, n.y, n.z])), 'brass', { seed: seed + 72 }));
      }
      const bar = q1.clone().sub(q0);
      const len = bar.length();
      const rod = lathe(profile(0.034, 0).to(0.04, 0.02, { sharp: true }).to(0.04, 0.05, { sharp: true }).to(0.03, 0.07, { sharp: true }).to(0.03, len - 0.07).to(0.04, len - 0.05, { sharp: true }).to(0.04, len - 0.02, { sharp: true }).to(0.034, len), { segs: 7, detail, band: 0, caps: false });
      head.add(setFinish(part('brass', transform(rod, aim([q0.x, q0.y, q0.z], [bar.x, bar.y, bar.z])), 'brass', { seed: seed + 73 }), 0.5));
      // the yellow wrap over the middle (rubber class: a cloth tape, matte, a little proud)
      const wrap = lathe(profile(0.042, 0.09).to(0.046, 0.1, { sharp: true }).to(0.046, len - 0.1, { smooth: true }).to(0.042, len - 0.09), { segs: 7, detail, band: 0, caps: false });
      head.add(part('rubber', transform(wrap, aim([q0.x, q0.y, q0.z], [bar.x, bar.y, bar.z])), 'tape-yellow', { seed: seed + 74, shade: 1.1 }));
      const mid = q0.clone().lerp(q1, 0.5);
      const out = n0.clone().add(n1).normalize();
      const gripM = new Matrix4().makeBasis(bar.clone().normalize(), out, new Vector3().crossVectors(bar, out).normalize()).setPosition(mid);
      b.socket('shade.grip', F.head.clone().multiply(gripM));
    }
    // the socket cup and the bulb's screw base at the back of the bell, inside
    const cup = lathe(profile(0, 0.02).to(0.13, 0.02, { sharp: true }).to(0.13, 0.17, { sharp: true }).to(0.105, 0.19, { sharp: true }).to(0.08, 0.19).to(0, 0.19), { segs: 7, detail, band: 0, caps: false });
    head.add(part('brass', transform(cup, along(0)), 'brass', { seed: seed + 67, shade: 0.8 }));
    const screw = lathe(profile(0.074, 0.19).to(0.08, 0.24, { smooth: true }).to(0.07, 0.29, { smooth: true }).to(0.064, 0.345).to(0, 0.345), { segs: 6, detail, band: 0, caps: false });
    head.add(part('brass', transform(screw, along(0)), 'brass', { seed: seed + 68 }));

    // the liner and the bulb: lit at three levels, and their dark twins
    const linerProfile = (): ReturnType<typeof profile> =>
      profile(0.578, 0.83)
        .cubic(0.47, 0.5, 0.555, 0.76, 0.505, 0.7, 2)
        .cubic(0.12, 0.035, 0.45, 0.22, 0.28, 0.05, 3)
        .to(0.12, 0.03);
    const glassProfile = (): ReturnType<typeof profile> =>
      profile(0.062, 0.335)
        .cubic(0.205, 0.6, 0.066, 0.43, 0.205, 0.46, 3)
        .curve(0, 0.8, 0.205, 0.8, 3);
    const linerG = lathe(linerProfile(), { segs: 10, detail, caps: false, band: 0 });
    const glassG = lathe(glassProfile(), { segs: 6, detail, caps: false, band: 0 });
    /** The vent slots' frames round the crown. */
    const ventAt = (k: number): Matrix4 => onBell(0.075, ((k + 0.5) / VENTS) * Math.PI * 2);
    const lit = head.node('bulb.lit');
    LIT_LEVELS.forEach((k, i) => {
      const lv = lit.node(`bulb.lit.${i + 1}`, i === LIT_LEVELS.length - 1 ? undefined : new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN));
      // the bulb's own glow on its reflector: brightest deep in the bell, falling toward the lip
      const liner = tint(linerG.clone(), 'paper');
      shadeBy(liner, (y) => k * (LINER_GLOW.deep - (LINER_GLOW.deep - LINER_GLOW.lip) * Math.min(1, Math.max(0, (y - 0.1) / 0.72)) ** 0.8));
      lv.add(part('bulb', transform(liner, along(0))));
      lv.add(part('bulb', transform(glassG.clone(), along(0)), 'amber-glow', { shade: 0.25 + 0.75 * k }));
      // vent slots round the crown, the light leaking out of them: what tells the visitor, who
      // mostly sees the back of the shade, that this lamp is the one that is on
      for (let v = 0; v < VENTS; v++) lv.add(setFinish(part('bulb', transform(sheet({ w: 0.12, h: 0.03, t: 0.002, nx: 1, ny: 1 }), ventAt(v)), 'amber-glow', { shade: VENT_GLOW * k }), 1));
    });
    // the slots' dark surrounds (holes in the steel; the glow sits in them)
    for (let v = 0; v < VENTS; v++) head.add(part('rubber', transform(sheet({ w: 0.145, h: 0.05, t: 0.001, nx: 1, ny: 1 }), ventAt(v)), 'ink', { shade: 0.5 }));
    const unlit = head.node('bulb.unlit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN));
    {
      const liner = lathe(linerProfile(), { segs: 10, detail: 'low', caps: false, band: 0 });
      unlit.add(part('steel', transform(liner, along(0)), 'paper', { seed: seed + 69, shade: 0.9 }));
      // the dark bulb: glass with no light behind it (metal class, dark and polished: one mesh fewer than a glass class)
      const glass = lathe(glassProfile(), { segs: 6, detail: 'low', caps: false, band: 0 });
      unlit.add(setFinish(part('metal', transform(glass, along(0)), 'ink', { shade: 1.4 }), 1));
    }
  }

  // ====================================================================
  // THE CORD below the arm: from the shoulder pin round to the front of the
  // knuckle (its lean axis), down the riser into a grommet; out again under
  // the clamp, down and away along the foot of the wall
  // ====================================================================
  const cordEnd: V3 = [-1.25, 0.024, 0.26];
  {
    const leanPt = S.clone().addScaledVector(F.p, 0.17);
    const pinPt = S.clone().addScaledVector(F.pin, back * cordPin.shoulder);
    // the knuckle's piece: round the hub's back to its front
    kn.add(into(F.knuckle, [cord([pinPt, S.clone().addScaledVector(F.pin, back * 0.13).addScaledVector(F.p, 0.1).add(new Vector3(0, -0.1, 0)), leanPt], hi ? 4 : 3)]));
    // the riser's piece: down the front of the post to a grommet
    const gromY = clampTop + 0.26;
    const grom = new Vector3(S.x, gromY, S.z).addScaledVector(F.p, 0.05);
    sw.add(into(F.swivel, [cord([leanPt, leanPt.clone().add(new Vector3(0, -0.14, 0)).addScaledVector(F.p, 0.04), grom.clone().addScaledVector(F.p, 0.035).add(new Vector3(0, 0.06, 0)), grom], hi ? 5 : 4)]));
    const gr = lathe(profile(0.03, 0).to(0.036, 0.012, { sharp: true }).to(0.03, 0.03, { sharp: true }), { segs: 6, detail, band: 0, caps: false });
    sw.add(into(F.swivel, [part('rubber', transform(gr, aim([grom.x, grom.y, grom.z], [F.p.x, 0, F.p.z])), 'ink')]));
    // out under the clamp, by the strain hook, down to the bench and along the wall
    const pts: V3[] = [
      [0.12, clampTop - 0.12, 0.42],
      [0.2, rail.y - 0.3, 0.46],
      [0.14, 0.42, 0.38],
      [-0.12, 0.12, 0.3],
      [-0.4, 0.024, 0.24],
      [-0.8, 0.024, 0.28],
      cordEnd,
    ];
    b.add(cord(pts.map((q) => new Vector3(...q)), hi ? 12 : 8, 5));
    b.small(() => [part('metal', transform(hexHead(0.05, 0.025, 0.3), aim([0.13, clampTop - 0.12, 0.395], [0, 0, 1])), 'steel', { seed: seed + 82 })]);
  }

  // sockets
  b.socket('bulb', chain(F.head, T(fil, 0, 0), new Matrix4().makeRotationZ(-Math.PI / 2)));
  b.socket('rail', T(0, rail.y, rail.z));
  b.socket('cord', chain(T(...cordEnd), new Matrix4().makeRotationZ(Math.PI / 2)));
  const built = b.build();
  const pose: LampPose = { ...(o.pose ?? {}) };
  if (o.on !== undefined) pose.on = o.on;
  if (Object.keys(pose).length) posePiece(built.root, pose);
  return built;
}

/** The grip on the shade's crown: from y0 to y1 along the bell's axis, standing `stand` off it. */
export const GRIP = { y0: 0.16, y1: 0.46, stand: 0.11 } as const;

/** A big wing nut along +Y (seen at 8-20 px: a third of the kit's triangles). */
function wing(sz: number, sd: number, detail: 'high' | 'low'): KitPart[] {
  const body = lathe(profile(sz * 0.3, 0).to(sz * 0.22, sz * 0.36, { sharp: true }).to(0, sz * 0.4), { segs: 6, detail, band: 0, caps: false });
  const outline: Array<[number, number]> = [[sz * 0.14, sz * 0.04], [sz * 0.56, sz * 0.3], [sz * 0.56, sz * 0.66], [sz * 0.17, sz * 0.36]];
  const th = sz * 0.1;
  const w1 = transform(extrude(outline, th, { bevel: th * 0.3, bevelBase: 0, radius: [0, 0, sz * 0.14, 0], segs: 1, support: false, detail: 'low' }), T(0, 0, -th / 2));
  const w2 = transform(w1.clone(), new Matrix4().makeRotationY(Math.PI));
  return [part('brass', body, 'brass', { seed: sd, jitter: 0.04 }), part('brass', w1, 'brass', { seed: sd + 1, jitter: 0.04 }), part('brass', w2, 'brass', { seed: sd + 2, jitter: 0.05 })];
}

/**
 * An exposed tension spring as nodes under `parent` (an arm): `<name>` at the arm's lug, its +X
 * aimed at the other lug (pose.ts), carrying the near hook; its coils `<name>.ring<k>` and the far
 * hook `<name>.end` spread along +X. Built at its home length.
 */
function spring(parent: NodeBuilder, name: string, s: (typeof SPRINGS)[keyof typeof SPRINGS], sd: number): void {
  const home = nodeTransforms({});
  const n = parent.node(name, home[name]!);
  const { r, wire, rings, hook } = s;
  // one coil: a bead turned round +X (a helix costs three times as much and reads the same at this size)
  const h = s.coil;
  const bead = transform(lathe(profile(r - wire * 0.5, -h / 2).to(r + wire, 0, { smooth: true }).to(r - wire * 0.5, h / 2), { segs: 4, caps: false, band: 0 }), chain(Y_TO_X, new Matrix4().makeRotationY(Math.PI / 4)));
  for (let k = 0; k < rings; k++) {
    const rn = n.node(`${name}.ring${k}`, home[`${name}.ring${k}`]!);
    rn.add(part('metal', bead.clone(), 'steel', { seed: sd + k, shade: 1.1 }));
  }
  const hookG = (dir: 1 | -1): BufferGeometry => sweep({ points: [new Vector3(0, 0, 0), new Vector3(dir * hook * 0.6, 0, 0), new Vector3(dir * hook, 0, -r * 0.75)], closed: false }, { radius: wire * 0.9, segs: 4, ends: 'flat' });
  n.add(part('metal', hookG(1), 'steel', { seed: sd + 20 }));
  const end = n.node(`${name}.end`, home[`${name}.end`]!);
  end.add(part('metal', hookG(-1), 'steel', { seed: sd + 21 }));
}

/** Set a lamp piece's node transforms (Piece description) for a pose. */
export function posePiece(root: PieceNode, pose: LampPose): void {
  const m = nodeTransforms(pose);
  const walk = (n: PieceNode): void => {
    const t = m[n.name];
    if (t) n.transform = t.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

/**
 * Pose a realized lamp (node transforms only: position, rotation, scale of its bones or groups).
 * Pass a full pose each frame or the parts you change; anything left out takes its home value.
 */
export function poseLamp(root: Object3D, pose: LampPose): void {
  const m = nodeTransforms(pose);
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  for (const [name, t] of Object.entries(m)) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    t.decompose(p, q, s);
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
}

/**
 * Where the key light goes for a lamp piece (at rest) placed at `place` (world, no yaw):
 * the filament's world position, and a point `reach` along the shade's axis to aim at.
 * Pass both to `stage.lights.setBulb(position, aim)`. For a posed lamp use `lampLight(pose)`.
 */
export function keyLight(p: Piece, place: V3 = LAMP_PLACE, reach = 6.7): { position: V3; aim: V3 } {
  const m = p.sockets?.['bulb'];
  if (!m) throw new Error('lamp: no bulb socket');
  const o = new Vector3().setFromMatrixPosition(m).add(new Vector3(...place));
  const d = new Vector3(0, 1, 0).transformDirection(m);
  const a = o.clone().addScaledVector(d, reach);
  return { position: [o.x, o.y, o.z], aim: [a.x, a.y, a.z] };
}

/** Named poses for the catalogue (`?pose=`), and `aim:x,z` (a spot in the lamp's space) or `aim:x,y,z`. */
export function namedPose(name: string): LampPose | null {
  const [what, arg] = name.split(':');
  const lvl = (s: string | undefined): LampPose => (s === 'off' ? { on: false } : s === 'low' ? { level: 1 } : s === 'mid' ? { level: 2 } : {});
  if (what === 'aim' && arg) {
    const v = arg.split(',').map(Number);
    const t: V3 = v.length === 3 ? [v[0]!, v[1]!, v[2]!] : [v[0]!, 0, v[1]!];
    return aimLamp(t).pose;
  }
  const [base, state] = (what ?? '').split('.');
  if (base && base in AIM_TARGETS) return { ...aimLamp(AIM_TARGETS[base as keyof typeof AIM_TARGETS]).pose, ...lvl(state) };
  if (base === 'home' || base === 'on' || base === '') return lvl(state);
  if (base === 'off' || base === 'low' || base === 'mid') return lvl(base);
  return null;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'lamp',
    build: (opts = {}) => {
      const o: LampOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      if (typeof opts['pose'] === 'string') {
        const p = namedPose(opts['pose']);
        if (p) o.pose = p;
      }
      return lamp(o);
    },
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, off: { pose: 'off' }, 'seed 2': { seed: 2 } },
    poses: ['home', 'off', 'low', 'mid', ...Object.keys(AIM_TARGETS)],
    camera: { distance: 12 },
    note: 'The lamp: the key light\'s body, clamped to a wall rail; its bulb socket is the stage\'s default key light (place it at x -4.5, z -5). Drag poses: ?pose=aim:x,z (lamp space).',
  },
];
