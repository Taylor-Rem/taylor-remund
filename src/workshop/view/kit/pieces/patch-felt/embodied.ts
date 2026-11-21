/**
 * Patch drawn from a real body (the 2026-11-20 prototype, `PatchSpec.flight: 'body'`; view/stations/operator.ts).
 *
 * While its physics body is in the world the figure's body IS that body: its middle where the body's is, turned as
 * the body is turned (a quaternion: a body that tumbles freely has no three angles that do not unwind). What is
 * performed on top is only what a body cannot do for itself: the limbs flung out and trailing the way it goes, the
 * tail streaming behind, the face. So everything here is posed in the body's OWN frame (the body at rest at the
 * origin, the visitor's point brought into that frame), and the station puts the body where the engine has it.
 *
 *   placed / placeOf / mixPlace      a placement as a middle and a quaternion, to and from the rig's `BodyPlace`
 *   offsetOf / withOffset            where it was drawn against where it should be: let go of over a few frames
 *                                    (a takeover starts from the pose it had, never a cut)
 *   flung                            in the air and tumbling, down to lying where it stopped (the same pose, run out)
 *   gettingUp                        from how it lay into sitting up, then the hop to where it can stand
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { bodyMatrix, type ArmJoints, type BodyPlace, type LegJoints, type PatchPose } from './rig.ts';
import { SEATED, flop, mixPose, resolvePose, shakeOff, toPose, type FullPose, type V3 } from './perform.ts';
import { clamp, clamp01, lerp, smoothstep } from '../../../anim/ease.ts';

export type Q4 = [number, number, number, number];
/** Where the body is: the middle of its trunk (root space) and its turn. */
export interface Place {
  mid: V3;
  q: Q4;
}

/**
 * The middle of its physics box, this far up the body from its seat (root units): the middle of its trunk (the felt
 * trunk runs from the seat, 0, to the scruff, 0.52). The box is the trunk's core; the head, the limbs and the tail
 * are drawn outside it.
 */
export const CORE = 0.26;

const qa = new Quaternion(), qb = new Quaternion();
const va = new Vector3();
const ma = new Matrix4();

/** The rig's placement for a body with its middle at `p.mid`, turned by `p.q` (and squashed, if given). */
export function placed(p: Place, squash?: BodyPlace['squash']): BodyPlace {
  va.set(0, CORE, 0).applyQuaternion(qa.set(p.q[0], p.q[1], p.q[2], p.q[3]));
  return { at: [p.mid[0] - va.x, p.mid[1] - va.y, p.mid[2] - va.z], quat: [p.q[0], p.q[1], p.q[2], p.q[3]], ...(squash ? { squash } : {}) };
}

/** Any placement (three angles or a quaternion, about the seat or the scruff) as a middle and a quaternion. */
export function placeOf(b: BodyPlace | undefined): Place {
  const { squash: _squash, ...plain } = b ?? {};
  ma.copy(bodyMatrix(plain));
  qa.setFromRotationMatrix(ma);
  va.set(0, CORE, 0).applyMatrix4(ma);
  return { mid: [va.x, va.y, va.z], q: [qa.x, qa.y, qa.z, qa.w] };
}

/** Between two placements (w = 0: a, 1: b): the middle straight, the turn the short way. */
export function mixPlace(a: Place, b: Place, w: number): Place {
  qa.set(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(qb.set(b.q[0], b.q[1], b.q[2], b.q[3]), w);
  return { mid: [lerp(a.mid[0], b.mid[0], w), lerp(a.mid[1], b.mid[1], w), lerp(a.mid[2], b.mid[2], w)], q: [qa.x, qa.y, qa.z, qa.w] };
}

/** A placement turned further about its own axes (pitch: + tips the head forward; about its middle). */
export function pitched(p: Place, pitch: number): Place {
  qa.set(p.q[0], p.q[1], p.q[2], p.q[3]).multiply(qb.setFromAxisAngle(va.set(1, 0, 0), pitch));
  return { mid: p.mid, q: [qa.x, qa.y, qa.z, qa.w] };
}

/** How far the figure as drawn is from where it should be: carried, and let go of (`withOffset`). */
export interface Offset {
  dp: V3;
  dq: Q4;
}
export function offsetOf(drawn: Place, target: Place): Offset {
  // dq · target.q = drawn.q
  qa.set(drawn.q[0], drawn.q[1], drawn.q[2], drawn.q[3]).multiply(qb.set(target.q[0], target.q[1], target.q[2], target.q[3]).invert());
  if (qa.w < 0) qa.set(-qa.x, -qa.y, -qa.z, -qa.w);
  return { dp: [drawn.mid[0] - target.mid[0], drawn.mid[1] - target.mid[1], drawn.mid[2] - target.mid[2]], dq: [qa.x, qa.y, qa.z, qa.w] };
}
/** The offset's size: units, and radians. */
export function offsetSize(o: Offset): { far: number; turn: number } {
  return { far: Math.hypot(o.dp[0], o.dp[1], o.dp[2]), turn: 2 * Math.acos(clamp(Math.abs(o.dq[3]), 0, 1)) };
}
/** The target with `k` of the offset still on it (1: where it was drawn; 0: the target itself). */
export function withOffset(target: Place, o: Offset, k: number): Place {
  qa.set(0, 0, 0, 1).slerp(qb.set(o.dq[0], o.dq[1], o.dq[2], o.dq[3]), k).multiply(qb.set(target.q[0], target.q[1], target.q[2], target.q[3]));
  return { mid: [target.mid[0] + o.dp[0] * k, target.mid[1] + o.dp[1] * k, target.mid[2] + o.dp[2] * k], q: [qa.x, qa.y, qa.z, qa.w] };
}

/** A root-space point in the body's own frame (the frame the performances here are posed in: the seat at the origin). */
export function intoBody(p: Place, point: V3): V3 {
  ma.copy(bodyMatrix(placed(p))).invert();
  va.set(point[0], point[1], point[2]).applyMatrix4(ma);
  return [va.x, va.y, va.z];
}
/** A root-space direction in the body's own frame. */
export function dirIntoBody(p: Place, d: V3): V3 {
  va.set(d[0], d[1], d[2]).applyQuaternion(qa.set(p.q[0], p.q[1], p.q[2], p.q[3]).invert());
  return [va.x, va.y, va.z];
}

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, roll: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, roll });

export interface FlungOptions {
  /** Seconds loose (the flail's clock). */
  t: number;
  /**
   * The way its limbs trail, in the body's own frame: against its velocity, its length 0 (lying still) .. 1 (thrown
   * hard). The caller smooths it (the limbs follow a change of course a little late: follow-through).
   */
  trail: V3;
  /** How fast it is turning, 0..1: the limbs fly outward with it. */
  spin: number;
}

/**
 * Thrown and tumbling (the body's own frame; the body itself is the engine's): the limbs flung out and trailing the
 * way it goes, ears flat, eyes wide, and (§ B5 tone) enjoying it: a grin and one brow up, never alarm. As it slows
 * the same pose runs out into lying where it stopped: sprawled, limbs wherever they fell, the face gone flat. The
 * tail is the caller's (`PatchPose.stream`, which a blend does not carry).
 */
export function flung(o: FlungOptions): PatchPose {
  const [tx, ty, tz] = o.trail;
  const A = clamp01(Math.hypot(tx, ty, tz));
  const t = o.t;
  const w1 = Math.sin(t * 13) * A, w2 = Math.sin(t * 11 + 1.3) * A;
  const sp = clamp01(o.spin);
  const arm = (s: 1 | -1): ArmJoints => J(0.9 + 0.95 * ty + 0.75 * tz + s * 0.3 * w1, 0.75 + 0.45 * s * tx + 0.3 * sp, 0, 0.3 + 0.2 * w2, 0, 0);
  const leg = (s: 1 | -1): LegJoints => ({ lift: -0.35 + 0.85 * ty + 0.55 * tz + s * 0.3 * w1, splay: 0.5 + 0.3 * s * tx + 0.25 * sp, knee: 0.25 - 0.35 * ty - s * 0.25 * w2 });
  // the face: the grin of the thing in the air; run out, the flat look of a toy left where it fell
  const f = smoothstep(0.1, 0.5, A);
  const wide = smoothstep(0.4, 0.9, A);
  return {
    ...SEATED,
    body: {},
    legs: [leg(1), leg(-1)],
    lean: [-0.12 * tz, 0.1 * tx],
    twist: 0.15 * w2,
    arms: { left: arm(1), right: arm(-1) },
    headYaw: 0.25 * tx,
    headPitch: lerp(0.05, 0.2, f) + 0.15 * ty,
    headTilt: lerp(0.14, 0, f) + 0.1 * w2,
    gaze: [0, lerp(0.25, 0, f)],
    lids: [lerp(0.46, lerp(0.3, 0.22, wide), f), lerp(0.5, lerp(0.33, 0.25, wide), f)],
    lidsLow: [0.15, 0.15],
    brows: [lerp(-0.25, 0.55, f), lerp(0.2, -0.1, f)],
    browTilt: [lerp(-0.1, 0.25, f), 0],
    mouth: [lerp(0.05, 0.75, f), lerp(-0.25, 0.35, f)],
    ears: [lerp(0.25, 0.7, A), lerp(0.15, 0.7, A)],
    tail: [-0.3 + 0.3 * w1, 0.4 * w1],
    tailLift: lerp(0.3, 0.6, A),
    boom: lerp(0.15, 0.3, A),
  };
}

export interface GetUpOptions {
  /** How it lay: the body as it was drawn when the simulation took over (root space), and the limbs it had. */
  lie: Place;
  limbs: PatchPose;
  /** The simulation's `lay`: how long it sits up over (s), where it lay and where it hops to (root space, on the bench). */
  rise: number;
  from: V3;
  to: V3;
  /** Its feet now (root space: the simulation's `at`, which moves along the hop's arc). */
  feet: V3;
  /** The stage's length (s): past `rise`, the hop. */
  length: number;
  /** The way it faces sat up (root space yaw). */
  yaw: number;
  visitor: V3;
  /**
   * Come down hard from a fall (dropped from high, or thrown up) and stopped upright: the flop. It tips over flat on
   * its front where it stands, lies a beat like someone waiting for applause, and pushes itself up (the scripted
   * Patch's own gag, `flop`, here begun from the pose its body had). `fall`: how far it fell (units).
   */
  flop?: { fall: number };
}

/** The flop: it needs at least this long (s) of the sit-up, and tips over in this long. */
const FLOP_LEAST = 0.55;
const FLOP_TIP = 0.22;
/** Anticipation: the last of the sit-up, a crouch (s); how far it leans into it (rad) and squashes down. */
const CROUCH = 0.1;
const CROUCH_LEAN = 0.18;
const CROUCH_SQUASH = 0.16;

/**
 * The script takes over from where and how the body lies (the simulation's `land` with a `lay`): over `rise` it sits
 * up from that pose, paws down on the bench; then, if where it lay is not a place it can stand, a hop to one: a
 * crouch, a stretch off the bench, legs trailing, and down sat (the squash of the landing is the station's). Never
 * the scripted landing's roll. `squash`: the figure's scale along the upright (1: none).
 */
export function gettingUp(t: number, o: GetUpOptions): { pose: PatchPose; place: Place; squash: number } {
  const hop = o.length - o.rise > 1e-3 && Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1], o.to[2] - o.from[2]) > 0.02;
  const sat = (feet: V3): PatchPose => shakeOff(0, feet, o.yaw, { visitor: o.visitor });
  if (t < o.rise || !hop) {
    const u = o.rise > 1e-3 ? clamp01(t / o.rise) : 1;
    const s = sat(o.from);
    // (how upright it lay: its own up against the world's)
    va.set(0, 1, 0).applyQuaternion(qa.set(o.lie.q[0], o.lie.q[1], o.lie.q[2], o.lie.q[3]));
    const flopping = !!o.flop && o.rise >= FLOP_LEAST && va.y > 0.8;
    let place: Place, limbs: FullPose;
    if (flopping) {
      // the flop: over onto its front (falling over, so gathering speed), then the scripted flop's own beat and push-up
      const f = flop(Math.min(t, o.rise), o.from, o.yaw, o.flop!.fall, o.rise);
      const tip = clamp01(t / FLOP_TIP);
      place = mixPlace(o.lie, placeOf(f.body), tip * tip);
      limbs = mixPose(resolvePose(o.limbs), resolvePose(f), smoothstep(0, 1, tip));
    } else {
      // up in one push: quick off the bench, easing into the sit (a little past upright and back)
      const e = 1 - (1 - u) ** 3;
      const over = Math.sin(Math.PI * u) * 0.06 * (1 - u);
      place = pitched(mixPlace(o.lie, placeOf(s.body), e), over);
      limbs = mixPose(resolvePose(o.limbs), resolvePose(s), smoothstep(0.05, 0.85, u));
    }
    // the crouch before a hop: down on its haunches, paws back, ears forward
    const c = hop && o.rise > 1e-3 ? smoothstep(o.rise - Math.min(CROUCH, o.rise * 0.6), o.rise, t) : 0;
    const pose = crouched(limbs, c);
    return { pose: toPose(pose), place: c > 0 ? pitched(place, CROUCH_LEAN * c) : place, squash: 1 - CROUCH_SQUASH * c };
  }
  const k = clamp01((t - o.rise) / (o.length - o.rise));
  const s = resolvePose(sat(o.feet));
  // off the bench leaning into it, coming down leaning back; legs trailing, arms up and out, ears back
  const lean = k < 0.5 ? 0.32 * Math.sin(Math.PI * (k / 0.5)) * (1 - k) : -0.2 * Math.sin(Math.PI * ((k - 0.5) / 0.5));
  const air = smoothstep(0, 0.25, k) * (1 - smoothstep(0.7, 1, k));
  const arm = (a: ArmJoints): ArmJoints => ({ ...a, swing: lerp(a.swing, 1.7, air), abduct: lerp(a.abduct, 0.95, air), elbow: lerp(a.elbow, 0.25, air), twist: lerp(a.twist, 0, air), wrist: lerp(a.wrist, 0, air) });
  const leg = (l: LegJoints): LegJoints => ({ lift: lerp(l.lift, -0.75, air), splay: lerp(l.splay, 0.3, air), knee: lerp(l.knee, 0.55, air) });
  const pose: FullPose = {
    ...s,
    legs: [leg(s.legs[0]), leg(s.legs[1])],
    arms: { left: arm(s.arms.left), right: arm(s.arms.right) },
    lean: [lerp(s.lean[0], -0.05, air), s.lean[1]],
    headPitch: s.headPitch + 0.2 * air,
    ears: [lerp(s.ears[0], 0.75, air), lerp(s.ears[1], 0.75, air)],
    lids: [lerp(s.lids[0], 0.28, air), lerp(s.lids[1], 0.3, air)],
    brows: [lerp(s.brows[0], 0.45, air), lerp(s.brows[1], 0.1, air)],
    mouth: [lerp(s.mouth[0], 0.6, air), lerp(s.mouth[1], 0.2, air)],
    tail: [lerp(s.tail[0], -0.2, air), s.tail[1]],
    tailLift: lerp(s.tailLift, -0.5 + 1.2 * k, air),
  };
  // the stretch off the bench (the first third), and nothing at the top; the crouch it springs from let go of over
  // its first frames (the spring is quick, never a jump)
  const stretch = 0.16 * Math.sin(Math.PI * clamp01(k / 0.4)) * (k < 0.4 ? 1 : 0);
  const c = o.rise > 1e-3 ? 1 - smoothstep(0, 0.18, k) : 0;
  return { pose: toPose(crouched(pose, c)), place: pitched(placeOf(toPose(s).body), lean + CROUCH_LEAN * c), squash: (1 - CROUCH_SQUASH * c) * (1 + stretch) };
}

/** A sat pose drawn down into a crouch by `c` (0..1): the anticipation before a hop. */
function crouched(p: FullPose, c: number): FullPose {
  if (c <= 1e-4) return p;
  const arm = (a: ArmJoints): ArmJoints => ({ ...a, swing: a.swing - 0.45 * c, elbow: a.elbow + 0.3 * c });
  const leg = (l: LegJoints): LegJoints => ({ ...l, lift: l.lift + 0.2 * c, knee: l.knee + 0.35 * c });
  return {
    ...p,
    legs: [leg(p.legs[0]), leg(p.legs[1])],
    arms: { left: arm(p.arms.left), right: arm(p.arms.right) },
    lean: [p.lean[0] + 0.2 * c, p.lean[1]],
    ears: [lerp(p.ears[0], -0.6, c), lerp(p.ears[1], -0.6, c)],
    headPitch: p.headPitch + 0.1 * c,
  };
}
