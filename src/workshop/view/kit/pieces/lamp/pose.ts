/**
 * The lamp's node transforms for a pose: pure functions, no geometry. A pose
 * moves nodes only (position, rotation, scale), as the skinned drawing needs.
 *
 *  - the joints' nodes (`swivel`, `knuckle`, `arm1`, `arm2`, `shade`, `head`)
 *    from the forward kinematics (aim.ts `armFrames`);
 *  - the springs: each spring's node sits on its arm's lug with its +X aimed
 *    at the other lug; its coils (`<spring>.ring<k>`) are spaced evenly
 *    between the hooks and its far hook (`<spring>.end`) sits on the far
 *    lug. Nothing is scaled: a stretched spring shows its coils spread apart,
 *    a relaxed one shows them closed up;
 *  - the light: `bulb.lit` / `bulb.unlit` swapped for on and off, and one of
 *    `bulb.lit.1..3` shown for the level. Hidden nodes collapse to 1e-4 at
 *    their pivot (inside the wrist hub).
 */
import { Matrix4, Vector3 } from 'three';
import type { Piece } from '../../types.ts';
import { DIM } from './rig.ts';
import { HOME, armFrames, jointsOf } from './aim.ts';
import type { ArmFrames, LampPose } from './aim.ts';

/** Scale of a hidden node (a level not shown, the dark twin of a lit bulb). */
export const HIDDEN = 1e-4;

/** The three brightness levels: the lit liner's, the glass's and the vents' glow × this. */
export const LIT_LEVELS = [0.3, 0.6, 1] as const;

const F0: ArmFrames = armFrames(HOME);
const downZ = (m: Matrix4): number => (new Vector3(0, 0, 1).transformDirection(m).y > 0 ? -1 : 1);
const dz1 = downZ(F0.arm1), dz2 = downZ(F0.arm2);

type Frame = 'knuckle' | 'arm1' | 'arm2';

export interface SpringSpec {
  /** The spring's node name, the arm it hangs from and its lug there (that arm's space). */
  name: string;
  parent: 'arm1' | 'arm2';
  lug: readonly [number, number, number];
  /** The other lug: on which node, given in the PARENT's space at home. */
  other: Frame;
  otherAtHome: readonly [number, number, number];
  /** Coil radius, wire radius, number of coils, hook length at each end, and each coil's height (closed up at the spring's shortest). */
  r: number;
  wire: number;
  rings: number;
  hook: number;
  coil: number;
  /** For the elbow's: where its lug on arm 1 is, back from the elbow and down off the arm. */
  lugBack?: number;
  lugDown?: number;
}

const shoulderSpec = { name: 'spring1', parent: 'arm1' as const, lug: [1.49, 0, dz1 * 0.13] as const, other: 'knuckle' as const, otherAtHome: [0.28, 0, -dz1 * 0.17] as const, r: 0.05, wire: 0.016, rings: 11, hook: 0.12 };
const ELBOW_LUG = { back: 0.3, down: 0.15 };
const elbowOther = new Vector3(DIM.l1 - ELBOW_LUG.back, 0, dz1 * ELBOW_LUG.down).applyMatrix4(F0.arm2.clone().invert().multiply(F0.arm1));
const elbowSpec = { name: 'spring2', parent: 'arm2' as const, lug: [1.11, 0, dz2 * 0.11] as const, other: 'arm1' as const, otherAtHome: [elbowOther.x, 0, elbowOther.z] as const, r: 0.042, wire: 0.014, rings: 9, hook: 0.1, lugBack: ELBOW_LUG.back, lugDown: ELBOW_LUG.down };

/** The other lug's position in the spring's parent space, for a set of frames. */
function otherLug(s: Omit<SpringSpec, 'coil'>, f: ArmFrames): Vector3 {
  const local = new Vector3(...s.otherAtHome).applyMatrix4(F0[s.parent]).applyMatrix4(F0[s.other].clone().invert());
  return local.applyMatrix4(f[s.other]).applyMatrix4(f[s.parent].clone().invert());
}

/** The spring's length, lug to lug, for a pose. */
export function springLength(s: Omit<SpringSpec, 'coil'>, pose: LampPose = {}): number {
  return otherLug(s, armFrames(jointsOf(pose))).distanceTo(new Vector3(...s.lug));
}

/**
 * Each coil's height: the coils touch at the home length (as approved). Stretched, they spread
 * apart; the elbow's can also get a little shorter than home (the arm folded for a spot near the
 * wall), where its coils close a little further, nested like a real coil's turns.
 */
const withCoil = <S extends Omit<SpringSpec, 'coil'>>(s: S): S & { coil: number } => ({ ...s, coil: ((springLength(s, {}) - 2 * s.hook) / s.rings) * 0.97 });

/** The two exposed springs. */
export const SPRINGS = { shoulder: withCoil(shoulderSpec), elbow: withCoil(elbowSpec) } as const;

/** A spring's home length (lug to lug). */
export function springRest(s: Omit<SpringSpec, 'coil'>): number {
  return springLength(s, {});
}

/** Where coil k sits along a spring `len` long: evenly between the hooks. */
export function ringX(s: SpringSpec, k: number, len: number): number {
  return s.hook + ((len - 2 * s.hook) * (k + 0.5)) / s.rings;
}

const rel = (parent: Matrix4, child: Matrix4): Matrix4 => parent.clone().invert().multiply(child);
const hidden = (): Matrix4 => new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN);

/** Every moving node's local transform for a pose (anything the pose leaves out at home; lit, full). */
export function nodeTransforms(pose: LampPose = {}): Record<string, Matrix4> {
  const f = armFrames(jointsOf(pose));
  const out: Record<string, Matrix4> = {
    swivel: f.swivel.clone(),
    knuckle: rel(f.swivel, f.knuckle),
    arm1: rel(f.knuckle, f.arm1),
    arm2: rel(f.arm1, f.arm2),
    shade: rel(f.arm2, f.shade),
    head: rel(f.shade, f.head),
  };
  for (const s of Object.values(SPRINGS)) {
    const a = new Vector3(...s.lug);
    const d = otherLug(s, f).sub(a);
    const len = d.length();
    out[s.name] = new Matrix4().makeTranslation(a.x, a.y, a.z).multiply(new Matrix4().makeRotationY(Math.atan2(-d.z, d.x)));
    for (let k = 0; k < s.rings; k++) out[`${s.name}.ring${k}`] = new Matrix4().makeTranslation(ringX(s, k, len), 0, 0);
    out[`${s.name}.end`] = new Matrix4().makeTranslation(len, 0, 0);
  }
  const on = pose.on ?? true;
  const level = pose.level ?? 3;
  out['bulb.lit'] = on ? new Matrix4() : hidden();
  out['bulb.unlit'] = on ? hidden() : new Matrix4();
  for (let i = 1; i <= LIT_LEVELS.length; i++) out[`bulb.lit.${i}`] = i === level ? new Matrix4() : hidden();
  return out;
}

/**
 * The sockets that move, for a pose, in the lamp's space: `bulb` (the filament, +Y along the light)
 * and `shade.grip` (the handle's middle, +Y out of it). Give the piece (its rest sockets).
 */
export function lampSockets(piece: Piece, pose: LampPose = {}): { bulb: Matrix4; grip: Matrix4 } {
  const f = armFrames(jointsOf(pose));
  // head(pose) · head(home)⁻¹: carries a point of the shade from home to the pose, in the lamp's space
  const carry = f.head.clone().multiply(F0.head.clone().invert());
  const bulb = piece.sockets?.['bulb'];
  const grip = piece.sockets?.['shade.grip'];
  if (!bulb || !grip) throw new Error('lamp: no bulb or grip socket');
  return { bulb: carry.clone().multiply(bulb), grip: carry.clone().multiply(grip) };
}
