/**
 * Patch with a real body while it is held and thrown (prototype, 2026-11-20; `PatchSpec.flight: 'body'`).
 *
 * Taylor, 2026-11-20: "Patch should feel fun and physically convincing, retain momentum when thrown, interact
 * naturally with the environment, and always be able to recover and return to his stool ... prototype using a real
 * physics body for Patch while he's being thrown, tumbling, and interacting with the environment, with scripted
 * behavior taking over when appropriate for recovery." It is the pattern Fetch and Revert already follow.
 *
 * The scripted Patch (`patch.ts`) is untouched and is still everything Patch does on its stool, on its feet, at the
 * wall and on the ledge. This module wraps that unit (`embodyPatch`) and owns one window: from the hand taking hold
 * to the script taking over again.
 *
 *   held    the world carries Patch's body (a `crewBody` part) exactly as it carries a held part: weight in the
 *           hand, lag, contacts. `at` follows the body. Nothing here moves it.
 *   air     let go: the body is the engine's. No arc of its own, no rule per thing it meets. This module only
 *           watches: what it met (for sound), where it is (the edge), how it lies. (One thing is added, because the
 *           world offers a crew member's body to no machine: down on the running belt it is carried along it.)
 *   then the script takes over FROM WHERE AND HOW IT LIES (the body is stowed, its last pose kept for the view):
 *           it gets up there, or hops to the nearest place it can stand and walk home from; a shake, a look, the
 *           walk home (all the scripted Patch's own, their lengths scaled by how hard it came down).
 *
 * Recovery is the part that must never fail, so two things are this module's and not the script's: where it gets on
 * its feet is always a place it can walk home from (`haven`: the script's search, then wider, at last the foot of its
 * own stool); and its walk home, which is the script's and can wait on the crew for as long as they stand in its way,
 * is watched: stood in one place for `stuck` seconds it hops on toward its stool (`watchWalk`).
 *
 * The gags are reactions to what the engine did:
 *   the float   a throw that is nearly straight up lingers at its top: gravity is eased on the body near the apex by
 *               a weight that fades smoothly to nothing as the throw leans over (the one rule both Patches have:
 *               patch-float.ts). Its drift is untouched;
 *   the wall    a tall fixed body met side-on, square and fast: flat against it a moment, then down it (the scripted
 *               `wall` state and its slide). A glancing or slow contact is the engine's bounce;
 *   the ledge   over an open edge low and slow it catches the edge (the scripted `ledge`, `haul`, `dust`), eased
 *               there from where the body was with the motion it had. Fast or high it simply falls, out of sight,
 *               and comes back up the chute as a body thrown onto the bench by the pad.
 *
 * It can be taken hold of again at any moment (in the air the body simply becomes held where it is; from the script
 * the body comes back into the world where Patch is drawn), except while it is out of sight.
 *
 * While a Button rung plays Patch's script is frozen, as all the crew's is; its body, if it is in the air or
 * tumbling, is one more loose body: it lands and lies where the engine puts it, is rewound with everything else, and
 * at the end is back in the air where it was at the press with the motion it had. The throw then carries on.
 */
import type { Cause, Id, Intent, PatchState, PatchView, Pose, Quat, SimEvent, Vec3 } from '../types.ts';
import type { SimContext } from '../context.ts';
import type { PATCH_TUNING, PatchSpec, PatchUnit } from './patch.ts';
import type { Solid } from './patch-route.ts';
import { distanceTo } from './fetch-knock.ts';
import { offTop, sphereMeets } from './patch-route.ts';
import { PATCH_FLOAT, floatNow, floatPull, floatWeight } from './patch-float.ts';
import { HZ, steps } from '../clock.ts';
import { add, cross, dot, finitePose, finiteVec, length, qnormalize, qyaw, rotate, scale, sub, yawOf } from '../math.ts';

/** Seconds, units, units per second. Tune here. */
export const PATCH_BODY_TUNING = {
  // ── what it met (for sound) ──
  /** Slower than this into a thing, a contact is not a hit worth a sound. */
  hitSpeed: 1.5,

  // ── the wall ──
  /** Into a tall fixed body's face at least this fast, and at least this much of its level speed into the face (not glancing). */
  wallInto: 4.5,
  wallSquare: 0.7,
  /** The face must be at least this wide either side (not a post). */
  wallFace: 0.25,
  /** Let go with the hand this far (units) or more past where the wall holds its body, into the wall: the gag too (it was thrown at the wall from against it). */
  wallPress: 0.45,

  // ── the ledge, and gone ──
  /** Over an open edge no faster than this (level), not falling faster than `catchFall`, its middle this near the bench top: it catches the edge. */
  catchSpeed: 6,
  catchFall: 6,
  reachUp: 0.9,
  reachDown: 0.5,
  /** The catch: `at` goes from where the body was to the edge over this long, starting with the body's own motion. */
  catchEase: 0.2,
  /** Past the edge and this far below the bench top: out of sight. */
  outOfSight: 1.5,
  /** Back up the chute: how long the throw onto the bench is in the air, and how far short of the pad it is aimed (it tumbles on). */
  chuteFly: 0.85,
  chuteShort: 0.75,
  /** ...and how far off true, either way along and across (seeded: it does not land and lie the same way twice). */
  chuteSpread: 0.2,
  /** After this many returns in one outing the chute sets it down by the pad itself (it cannot bounce off for ever). */
  chuteTries: 2,

  // ── the belt ──
  /**
   * Lying on the running belt it is carried, as anything is: each step its level velocity along the belt gains this
   * share of what it lacks of the surface's (the grip of felt on the belt; it tumbles on meanwhile).
   */
  beltGrip: 0.25,

  // ── when the script takes over ──
  /** Plainly down: slower than these (units/s, rad/s), held up by something, for this long (the last of its rocking is not waited out). */
  slowLinear: 0.8,
  slowAngular: 3,
  slowFor: 0.12,
  /** However it tumbles, the script takes over after this long loose. */
  cap: 6,
  /** Its lowest point this near the bench top: it lies on the bench (higher: on something). */
  onBench: 0.12,
  /** On the stool's top this near the seat: it is home already. */
  onSeat: 0.3,

  // ── the walk home, watched ──
  /**
   * The walk home is the scripted Patch's, and it can wait: for a gap on the belt, for a crate where it would step
   * down, for the crew. Stood within `stuckRoom` of one spot for `stuck` seconds on its way, it stops waiting and
   * hops on toward its stool: `rescueHop` or more at a time, over whatever is in the way; at last onto the stool's
   * foot itself. (The scripted Patch waits for as long as they stand there. Longer than the script's own last
   * step at the stool's foot, `PATCH_TUNING.lastStep`, so that is tried first.)
   */
  stuck: 6.5,
  stuckRoom: 0.4,
  rescueHop: 1.6,

  // ── the get-up, by how hard it came down (0 a set-down .. 1 a hard landing) ──
  /**
   * How hard: the most any one contact took out of its velocity (units/s), from `softFrom` (0) to `hardAt` (1).
   * Measured: set down from a hand's height 3 to 5; a toss across the bench 6; a throw at 8 units/s, or a fall from
   * two units, 9; a hard throw across the bench 11 to 13; a fall from four units, or a throw straight up at the
   * most, 13 to 14; a fall from the top of the carry 16 and more.
   */
  softFrom: 3.5,
  hardAt: 16,
  /**
   * The whole bit, from the moment it first touches down to its first step home, is about this long: `bitLeast` for
   * a set-down, `bitMost` for the hardest landing (the scripted Patch took 2.9 to 4.5 s every time). Its tumble
   * under the engine counts toward it: after a long tumble it gets up and goes; after a fall that stops dead, the
   * get-up, the shake and the look take what the tumble did not.
   */
  bitLeast: 0.5,
  bitMost: 3.2,
  /** The get-up where it lies: this long sat as it landed, more by how far over it lies; and, where the bit has time left, more by how hard. */
  getUp: 0.15,
  getUpOver: 0.25,
  getUpHard: 0.2,
  /**
   * After a fall (let go still, or thrown up), up to this share of the scripted flop's extra time down, by how hard:
   * all of it (the view plays the flop in it when it stopped upright: over onto its front, a beat, and up).
   */
  flop: 1,
  /** A hop to where it can stand: this long, and more by the distance (units); its arc this high, and more by the distance. */
  hop: 0.28,
  hopPer: 0.12,
  hopHigh: 0.22,
  hopHighPer: 0.18,
  /** Nearer than this, where it can stand is where it lies (no hop: it shifts as it gets up). */
  hopOver: 0.1,
  /**
   * Come to rest where the visitor cannot see it (behind a machine), it hops to a place it can stand in their view if
   * there is one within this far (the nearest; the scripted landing looked a unit round too).
   */
  seenWithin: 1.0,
  /** The shake of the head: none below `shakeFrom`; from `shakeLeast` up to the scripted length. */
  shakeFrom: 0.18,
  shakeLeast: 0.3,
  /** The look at the visitor: none below `lookFrom` (it turns to its way at once); from `lookLeast` up to the scripted length. */
  lookFrom: 0.6,
  lookLeast: 0.4,
} as const;

export type Ledge = { readonly edge: 'front' | 'left' | 'right'; readonly at: Vec3; readonly up: Vec3; readonly out: Vec3 };
export type Landing = { readonly from: Vec3; readonly to: Vec3; readonly speed: number; readonly fall: number; readonly drop: boolean };

/** What this module needs of the scripted Patch (closures over its own state; `patch.ts` makes it in one place). */
export interface PatchHost {
  readonly T: typeof PATCH_TUNING;
  state(): PatchState;
  /** Seconds in the state, and how long it lasts. */
  seconds(): number;
  length(): number;
  enter(s: PatchState, elapsed?: number, len?: number): void;
  at(): Vec3;
  setAt(p: Vec3): void;
  heading(): number;
  setHeading(h: number): void;
  seatNow(): Vec3;
  footNow(): Vec3;
  /** Every fixed body standing on the bench. */
  readonly solids: readonly Solid[];
  /** The nearest point to `p` where it can stand (clear of every body and of what lies on the bench). */
  standingAt(p: Vec3): Vec3;
  /** Can it stand at `p` itself, and walk home from there? */
  canStand(p: Vec3): boolean;
  /** The nearest point to `p` where it can stand and walk home from. */
  restAt(p: Vec3): Vec3;
  /** Can the visitor see it sat at `p` (nothing tall between it and where the visitor looks from)? */
  inView(p: Vec3): boolean;
  /** The open edge a point is past, or null. */
  edgeFor(p: Vec3): Ledge | null;
  /** Taken hold of: what the scripted Patch does about its job, its catch, its way (it ends in `held`). */
  grabbed(): void;
  /** What every step does whatever its state (the desk's hook, parts thrown at it, the line's quiet). */
  idle(): void;
  setLanding(l: Landing | null): void;
  setWalled(w: { out: Vec3; speed: number } | null): void;
  setLedge(l: Ledge | null): void;
  ledge(): Ledge | null;
  setAfoot(on: boolean): void;
  setLookAt(p: Vec3 | null): void;
  /** On its feet at `at`: the walk home, `elapsed` seconds into its set-off (a look, then the turn to its way). */
  walkHome(elapsed: number): void;
  /** On its stool: back to its job, or to sitting. */
  carryOn(): void;
  shakeLength(fall: number): number;
  flopLength(fall: number): number;
}

type Phase = 'script' | 'held' | 'air' | 'catch' | 'wall' | 'getup' | 'shake' | 'look' | 'away';

interface Air {
  /** Steps loose (its own count: it does not run while a rung plays). */
  ticks: number;
  /** From the hand, or back up the chute. */
  chute: boolean;
  /** The float's weight for this throw (0: none), and how much of it is on now (0..1). */
  lift: number;
  float: number;
  /** Let go still, or thrown up: it comes down falling, not tumbling along. */
  drop: boolean;
  /** The highest its middle has been. */
  peak: number;
  /** The most one contact has taken out of its velocity (units/s): how hard it has come down. */
  impact: number;
  /** How fast it was going as it first met the bench. */
  landing: number;
  /** Its velocity and place a step ago (before the last step's contacts). */
  v: Vec3;
  p: Vec3;
  /** Things it has hit already (one sound each), whether it has touched the bench, anything at all (and at which of its steps first). */
  met: Set<Id>;
  landed: boolean;
  touched: boolean;
  touchedAt: number;
  /** Was it a throw (it made a sound leaving), or a set-down? */
  thrown: boolean;
  /** Past an open edge and going. */
  out: boolean;
  slow: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const level = (v: Vec3): number => Math.hypot(v[0], v[2]);
/** Between two orientations (the short way; near enough for the short blends here). */
function qmix(a: Quat, b: Quat, k: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qnormalize([lerp(a[0], b[0] * s, k), lerp(a[1], b[1] * s, k), lerp(a[2], b[2] * s, k), lerp(a[3], b[3] * s, k)]);
}

/** Wrap the scripted Patch `unit` so that it is held and thrown as a real body (`spec.bodyPart`). */
export function embodyPatch(ctx: SimContext, spec: PatchSpec, unit: PatchUnit, host: PatchHost): void {
  const part = spec.bodyPart;
  if (!part || ctx.mode(part) === undefined) throw new Error(`patch: flight 'body' needs its body part ("${part}") in the scene, as a crewBody`);
  const body: Id = part;
  const B = PATCH_BODY_TUNING;
  const T = host.T;
  const id = spec.id;
  const half = ctx.halfExtents(body) as Vec3;
  const top = ctx.scene.bench.top;
  const g = ctx.scene.gravity;
  /** Where the hand has it (its scruff), in its own frame. */
  const SCRUFF: Vec3 = [0, half[1], 0];
  const UP: Vec3 = [0, half[1] + 0.02, 0];

  let phase: Phase = 'script';
  let air: Air | null = null;
  /** Where the body comes into the world if the hand takes hold now (asked by the world right after the grab). */
  let pending: Pose | null = null;
  /** The hand, for a drag that did not come through the world's grab (no body in the hand); and where it was over its last few steps. */
  let hand: Vec3 = spec.seat;
  const hands: { step: number; p: Vec3 }[] = [];
  /** Hits heard at the end of the last step: who (null: something fixed). */
  let heardHits: (Id | null)[] = [];
  /** The pose it lay in when the script took over, how hard it had come down, the move it gets up with, and the shake and look to come (s). */
  let lay: { pose: Pose; hard: number; from: Vec3; to: Vec3; arc: number; rise: number; home: boolean; fall: number; speed: number; shake: number; look: number } | null = null;
  /** The ledge's catch: from where the body was, with its motion, to the edge. */
  let grab: { p0: Vec3; v0: Vec3; n: number } | null = null;
  /** Down the wall: where the slide began. */
  let slideFrom: number | null = null;
  let wallOut: Vec3 = [0, 0, 1];
  /** Returns up the chute this outing. */
  let returns = 0;
  /** The transaction of the throw that took it off the bench (what it knocks when it comes back is that throw's too). */
  let thrownAs: Cause | null = null;
  /** The seed's dice for this module (its own fork: nobody else's rolls move). */
  const chance = ctx.rng('patch-body');
  /** The body's pose now and a step ago, while it is in the world (for the view). */
  let now: Pose | null = null;
  let prev: Pose | null = null;

  const inWorld = (): boolean => {
    const m = ctx.mode(body);
    return m === 'held' || m === 'free';
  };
  const upOf = (q: Quat): number => 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  /** How far its box reaches below its middle as it lies. */
  const reachDown = (q: Quat): number => Math.abs(rotate(q, [1, 0, 0])[1]) * half[0] + Math.abs(rotate(q, [0, 1, 0])[1]) * half[1] + Math.abs(rotate(q, [0, 0, 1])[1]) * half[2];
  const outside = (p: Vec3): boolean => {
    const e = spec.edge;
    return !!e && (p[0] < e.minX || p[0] > e.maxX || p[2] > e.maxZ);
  };
  const offBench = (p: Vec3): boolean => {
    const b = ctx.scene.bench;
    return p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ || p[1] < top - 0.2;
  };
  /** How far its box reaches from its middle along the unit direction `d`, as it is turned. */
  const reach = (q: Quat, d: Vec3): number => Math.abs(dot(rotate(q, [1, 0, 0]), d)) * half[0] + Math.abs(dot(rotate(q, [0, 1, 0]), d)) * half[1] + Math.abs(dot(rotate(q, [0, 0, 1]), d)) * half[2];
  /** The fixed body its box is touching (the one it is deepest against), and the unit direction out of that body to its middle. */
  function against(pose: Pose): { o: Solid; n: Vec3 } | null {
    let best: { o: Solid; n: Vec3 } | null = null;
    let least = 0.07;
    const p = pose.p;
    for (const o of host.solids) {
      // the point of the body's box nearest its middle (in the body's own frame, back to the world)
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      const dx = p[0] - o.x, dz = p[2] - o.z;
      const lx = Math.min(o.hx, Math.max(-o.hx, c * dx - s * dz)), lz = Math.min(o.hz, Math.max(-o.hz, s * dx + c * dz));
      const near: Vec3 = [o.x + c * lx + s * lz, Math.min(o.y1, Math.max(o.y0, p[1])), o.z - s * lx + c * lz];
      const d = sub(p, near);
      const l = length(d);
      if (l < 1e-6) continue; // (its middle inside a fixed body: the engine does not leave it there)
      const n = scale(d, 1 / l);
      const gap = l - reach(pose.q, n);
      if (gap < least) [best, least] = [{ o, n }, gap];
    }
    return best;
  }
  /**
   * The top it is on at `p` (its middle): the bench, or the highest fixed body whose top is no higher than its middle
   * and whose footprint comes within `r` of it (0: under its middle itself). Never below the bench top.
   */
  const floorUnder = (p: Vec3, r = 0): number => Math.max(top, ...host.solids.filter((o) => o.y1 <= p[1] + 0.05 && distanceTo(o, p[0], p[2]) <= r).map((o) => o.y1));
  /** The belt's bed, and its surface's speed now (+X; 0 when it is stopped, or the scene has none). */
  const BED = spec.belt ? (host.solids.find((o) => o.id === spec.belt?.bed) ?? null) : null;
  function beltSurface(): number {
    const v = spec.belt ? (ctx.machine(spec.belt.id) as { view?: () => { kind: string; surface?: number } } | undefined)?.view?.() : undefined;
    return v && v.kind === 'belt' ? (v.surface ?? 0) : 0;
  }
  /** Is its body down on the belt's bed (its lowest point on the bed's top, its middle over it)? */
  const onBelt = (pose: Pose): boolean => !!BED && distanceTo(BED, pose.p[0], pose.p[2]) <= 0 && Math.abs(pose.p[1] - reachDown(pose.q) - BED.y1) < 0.08;
  /** A pose for the body out of every fixed body (a hair's push, where the script had Patch against one). */
  function clear(p: Pose): Pose {
    let c = p.p;
    const r = Math.min(half[0], half[2]);
    for (let i = 0; i < 4; i++) {
      const o = host.solids.find((s) => sphereMeets(s, c[0], c[1], c[2], r));
      if (!o) break;
      if (c[1] >= o.y1) c = [c[0], o.y1 + r + 0.01, c[2]];
      else {
        const n = offTop(o, c[0], c[2]);
        const push = r - distanceTo(o, c[0], c[2]) + 0.02;
        c = [c[0] + n[0] * push, c[1], c[2] + n[1] * push];
      }
    }
    return { p: c, q: p.q };
  }

  /** Where Patch's body is, as the script draws it now: where it comes into the world if the hand takes hold. */
  function scripted(): Pose {
    const st = host.state();
    const at = host.at();
    const upright = qyaw(host.heading());
    if (st === 'wall') return clear({ p: at, q: upright });
    if (st === 'ledge' || (st === 'haul' && host.seconds() < T.haul / 2)) {
      // hanging from the edge: beside the bench's side, its top at the edge
      const l = host.ledge();
      if (l) return { p: [l.at[0] + l.out[0] * (half[2] + 0.05), l.at[1] - half[1] + 0.1, l.at[2] + l.out[2] * (half[2] + 0.05)], q: upright };
    }
    if (st === 'land' && lay) {
      // getting up: from how it lay toward sitting up, where it is on its way
      const k = Math.min(1, host.seconds() / Math.max(1e-6, lay.rise));
      return clear({ p: [at[0], at[1] + lerp(lay.pose.p[1] - lay.from[1], half[1] + 0.02, k), at[2]], q: qmix(lay.pose.q, upright, k) });
    }
    return clear({ p: add(at, UP), q: upright });
  }

  // in the hand it turns to face the visitor, as Fetch does (the world's levelling eases it there)
  ctx.crewFor(body, {
    grabbed() {},
    taken() {},
    heldYaw: () => {
      const p = ctx.pose(body)?.p ?? host.at();
      return Math.atan2(spec.visitor[0] - p[0], spec.visitor[2] - p[2]);
    },
  });

  // ── let go ──
  function fly(chute: boolean): void {
    const pose = ctx.pose(body) as Pose;
    const v = ctx.velocity(body)?.linvel ?? [0, 0, 0];
    const speed = length(v);
    const high = pose.p[1] - reachDown(pose.q) - top > T.dropFrom;
    const thrown = chute || speed >= T.throwAt || high;
    const lift = chute ? 0 : floatWeight(v);
    air = { ticks: 0, chute, lift, float: 0, drop: !chute && (lift > 0.5 || level(v) < T.throwAt), peak: pose.p[1], impact: 0, landing: 0, v, p: pose.p, met: new Set(), landed: false, touched: false, touchedAt: 0, thrown, out: false, slow: 0 };
    lay = null;
    grab = null;
    heardHits = [];
    phase = 'air';
    host.setLanding(null);
    host.setWalled(null);
    host.setLedge(null);
    host.setLookAt(null);
    if (level(v) > 0.3) host.setHeading(Math.atan2(v[0], v[2]));
    host.setAt(pose.p);
    host.enter('fly');
    if (chute) ctx.emit({ type: 'patch.throw', phase: 'chute', speed });
    else if (thrown) ctx.emit({ type: 'patch.throw', phase: 'thrown', speed });
  }

  /** How hard it came down, 0..1. */
  const hardness = (a: Air): number => smooth(B.softFrom, B.hardAt, a.impact);

  /** Flat against a wall (`n`: level, out of it), then down it: the script's `wall` takes over from the pose its body had. */
  function splatOn(pose: Pose, what: Id, n: readonly [number, number], speed: number, took: number): void {
    ctx.stow(body, pose);
    ctx.emit({ type: 'patch.throw', phase: 'hit', speed, what, wall: true });
    wallOut = [n[0], 0, n[1]];
    slideFrom = null;
    phase = 'wall';
    lay = { pose, hard: smooth(B.softFrom, B.hardAt, took), from: pose.p, to: pose.p, arc: 0, rise: 0, home: false, fall: 0, speed, shake: 0, look: 0 };
    air = null;
    host.setLanding(null);
    host.setLedge(null);
    host.setLookAt(null);
    host.setWalled({ out: wallOut, speed });
    host.setAt(pose.p);
    host.setHeading(Math.atan2(-n[0], -n[1]));
    host.enter('wall');
  }

  /**
   * Let go while the hand was throwing it into a wall it is against (the hand `wallPress` or more past where the wall
   * holds its body, and still going into the wall's face at a throw's speed): the wall gag there, as the scripted
   * Patch's was. A throw up the screen at the back wall is this: the hand goes on into the wall and the body cannot.
   * Just touching a wall, held against one, or set down against one, is not.
   */
  function pressedTo(pose: Pose): { o: Solid; n: readonly [number, number] } | null {
    const met = against(pose);
    if (!met) return null;
    const flat = Math.hypot(met.n[0], met.n[2]);
    if (flat <= 0.8 || pose.p[1] >= met.o.y1 - 0.03) return null;
    const n: readonly [number, number] = [met.n[0] / flat, met.n[2] / flat];
    const o = met.o;
    const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
    const face = Math.abs(c * n[0] - sn * n[1]) > Math.abs(sn * n[0] + c * n[1]) ? o.hz : o.hx;
    if (o.y1 < pose.p[1] + T.wallAbove || pose.p[1] > T.wallMeet || face < B.wallFace) return null;
    const grip = add(pose.p, rotate(pose.q, SCRUFF));
    const push = -((hand[0] - grip[0]) * n[0] + (hand[2] - grip[2]) * n[1]);
    // (and the hand went into the wall at a throw's speed in its last quarter second: a throw at it, not a thing
    // held against it. The fastest of those steps: the world stops the hand itself at the bench's edge)
    let going = 0;
    for (let i = 1; i < hands.length; i++) {
      const a = hands[i - 1]!, b = hands[i]!;
      if (b.step > a.step) going = Math.max(going, (-((b.p[0] - a.p[0]) * n[0] + (b.p[2] - a.p[2]) * n[1]) * HZ) / (b.step - a.step));
    }
    return push >= B.wallPress && going >= T.throwAt ? { o, n } : null;
  }

  /**
   * Where it goes to get on its feet from `p` (the bench under where it lies): the nearest place it can stand AND
   * walk home from. Near first (the script's own search, a unit and a half round); then wider, ring by ring; and if
   * the whole bench round it is shut (it never has been), the foot of its own stool, which is home. Recovery never
   * ends on a spot it cannot leave.
   */
  function haven(p: Vec3): Vec3 {
    const near = host.restAt(p);
    if (host.canStand(near)) return near;
    const b = ctx.scene.bench;
    for (let rad = 1.75; rad <= 8; rad += 0.5) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const q: Vec3 = [p[0] + Math.cos(a) * rad, top, p[2] + Math.sin(a) * rad];
        if (q[0] < b.minX + 0.3 || q[0] > b.maxX - 0.3 || q[2] < b.minZ + 0.3 || q[2] > b.maxZ - 0.3) continue;
        if (host.canStand(q)) return q;
      }
    }
    return host.footNow();
  }

  /** The arc a hop from `from` to `q` needs: its own (by the distance), raised until no point of it is inside a fixed body. */
  function arcFor(from: Vec3, q: Vec3): number {
    const far = Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]);
    let h = B.hopHigh + B.hopHighPer * far;
    const inside = (): boolean => {
      for (let i = 1; i < 48; i++) {
        const k = i / 48;
        const p: Vec3 = [lerp(from[0], q[0], k), lerp(from[1], q[1], k) + 4 * h * k * (1 - k), lerp(from[2], q[2], k)];
        if (host.solids.some((o) => p[1] < o.y1 + 0.02 && p[1] > o.y0 && distanceTo(o, p[0], p[2]) <= 0.02)) return true;
      }
      return false;
    };
    for (let i = 0; i < 24 && inside(); i++) h += 0.25;
    return h;
  }

  /**
   * The script takes over from where and how it lies: `pose` (the body's, already out of the world). It gets up
   * there if it can stand there and walk home; else it hops, along a small arc, to the nearest place it can.
   */
  function getUp(pose: Pose, hard: number, fall: number, drop: boolean, speed: number, tumbled: number): void {
    const floor = floorUnder(pose.p);
    const low = Math.max(floor, pose.p[1] - reachDown(pose.q));
    const from: Vec3 = [pose.p[0], low, pose.p[2]];
    const ground: Vec3 = [pose.p[0], top, pose.p[2]];
    const seat = host.seatNow();
    // on its own stool: it is home
    const home = Math.hypot(pose.p[0] - seat[0], pose.p[2] - seat[2]) < B.onSeat && Math.abs(low - seat[1]) < 0.12;
    const stand = low - top <= B.onBench && host.canStand(ground);
    const arcTo = (q: Vec3): number => arcFor(from, q);
    let to = home ? seat : stand ? ground : haven(ground);
    // out of the visitor's sight (behind a machine): to the nearest place in their view, when one is near
    if (!home && !host.inView(to)) {
      seen: for (let ring = 1; ring * 0.1 <= B.seenWithin + 1e-9; ring++) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const q: Vec3 = [to[0] + Math.cos(a) * ring * 0.1, top, to[2] + Math.sin(a) * ring * 0.1];
          if (!host.canStand(q) || !host.inView(q)) continue;
          to = q;
          break seen;
        }
      }
    }
    let arc = 0;
    if (!home && Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > B.hopOver) {
      arc = arcTo(to);
      // the nearest place makes for a hop along the top of what it lies on, and so a high one (off the end of the
      // board's panel): then the place, a little further off any side, that makes the lowest hop
      const plain = B.hopHigh + B.hopHighPer * Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (arc > plain + 0.6) {
        let best = arc + 0.3 * Math.hypot(to[0] - from[0], to[2] - from[2]);
        for (const far of [0.7, 1.4, 2.1])
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const q = host.restAt([ground[0] + Math.cos(a) * far, top, ground[2] + Math.sin(a) * far]);
            const h = arcTo(q);
            const cost = h + 0.3 * Math.hypot(q[0] - from[0], q[2] - from[2]);
            if (cost < best - 1e-9) [best, to, arc] = [cost, q, h];
          }
      }
    }
    const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const hop = d > B.hopOver;
    // the beats to come. The get-up and the turn to its way, always. The shake of the head whenever it came down hard
    // enough to earn one (it is Patch's answer to being thrown, and short). Then, out of what the bit has left after
    // its tumble: the look at the visitor, and a longer time down
    const over = Math.min(1, 1 - upOf(pose.q));
    let rise = B.getUp + B.getUpOver * over;
    const shake = home || hard < B.shakeFrom ? 0 : lerp(B.shakeLeast, host.shakeLength(fall), hard);
    let left = lerp(B.bitLeast, B.bitMost, hard) - tumbled - rise - shake - T.setOff / 2;
    const want = (from: number, most: number, least: number): number => {
      const w = hard >= from && left >= least ? Math.min(left, most) : 0;
      left -= w;
      return w;
    };
    const look = home ? 0 : want(B.lookFrom, lerp(B.lookLeast, T.look, (hard - B.lookFrom) / (1 - B.lookFrom)), B.lookLeast);
    rise += want(0, B.getUpHard * hard + (drop ? host.flopLength(fall) * B.flop * hard : 0), 0);
    lay = { pose, hard, from, to, arc, rise, home, fall, speed, shake, look };
    phase = 'getup';
    host.setLanding({ from, to, speed, fall, drop });
    host.setAt(from);
    host.setLookAt(null);
    if (hop && Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.05) host.setHeading(Math.atan2(to[0] - from[0], to[2] - from[2]));
    else host.setHeading(yawOf(pose.q));
    host.enter('land', 0, rise + (hop ? B.hop + B.hopPer * d : 0));
  }

  /** The body has come to rest, or is plainly down, or has been loose too long: stow it and take over. */
  function recover(): void {
    const a = air as Air;
    const pose = ctx.pose(body) as Pose;
    air = null;
    if (offBench(pose.p)) {
      goAway(pose, a.out, length(a.v));
      return;
    }
    ctx.stow(body, pose);
    if (a.thrown && !a.landed) ctx.emit({ type: 'patch.throw', phase: 'landed', speed: a.impact });
    getUp(pose, hardness(a), Math.max(0, a.peak - top), a.drop, a.landing || a.impact, a.touched ? (a.ticks - a.touchedAt) / HZ : 0);
  }

  /** Off the bench and out of sight: the `away` beat, then back up the chute. */
  function goAway(pose: Pose, said: boolean, speed: number): void {
    if (ctx.mode(body) !== 'gone') {
      const by = ctx.history.chargeMachine(body);
      if (by !== 'crew' && by !== 'system') thrownAs = by;
      ctx.stow(body, pose);
    }
    if (!said) ctx.emit({ type: 'patch.throw', phase: 'gone', speed });
    air = null;
    lay = null;
    phase = 'away';
    host.setAt(pose.p);
    host.enter('away');
  }

  /** Out of the chute's mouth, thrown so that it comes down short of the pad and tumbles to rest by it. */
  function fromChute(): void {
    const c = spec.chute;
    if (!c) {
      // no chute in this scene: it is set down at the stool's foot
      phase = 'script';
      host.setAt(host.standingAt(host.footNow()));
      host.walkHome(0);
      return;
    }
    returns += 1;
    const land = haven([c.pad[0], top, c.pad[1]]);
    if (returns > B.chuteTries) {
      // it has come back and gone again: this time the chute's throw is the script's own, onto its feet by the pad
      const from: Vec3 = [c.from[0], Math.max(top, c.from[1] - half[1]), c.from[2]];
      const d = Math.hypot(land[0] - from[0], land[2] - from[2]);
      lay = { pose: { p: c.from, q: qyaw(Math.atan2(land[0] - from[0], land[2] - from[2])) }, hard: 0.5, from, to: land, arc: 1.2, rise: 0, home: false, fall: 0, speed: 0, shake: B.shakeLeast, look: 0 };
      phase = 'getup';
      host.setLanding({ from, to: land, speed: 0, fall: 0, drop: false });
      host.setAt(from);
      host.setHeading(Math.atan2(land[0] - from[0], land[2] - from[2]));
      ctx.emit({ type: 'patch.throw', phase: 'chute', speed: d / T.chuteFly });
      host.enter('land', 0, T.chuteFly);
      return;
    }
    const tf = B.chuteFly;
    // (a little off true each time, by the seed: it does not come down and lie the same way twice)
    const aim: Vec3 = [lerp(c.from[0], land[0], B.chuteShort) + chance.range(-B.chuteSpread, B.chuteSpread), top + half[1], lerp(c.from[2], land[2], B.chuteShort) + chance.range(-B.chuteSpread, B.chuteSpread)];
    const v: Vec3 = [(aim[0] - c.from[0]) / tf, (aim[1] - c.from[1]) / tf - 0.5 * g * tf, (aim[2] - c.from[2]) / tf];
    const pose: Pose = { p: c.from, q: qyaw(Math.atan2(v[0], v[2])) };
    // (still the throw's: what it knocks as it comes back is charged to the throw that sent it off, as the scripted
    // Patch's return was, while that throw is still on the stack)
    ctx.launch(body, pose, v, scale(cross([0, 1, 0], v), chance.range(0.3, 0.7)), thrownAs);
    if (thrownAs) ctx.history.claim(body, thrownAs, ctx.clock.step);
    now = pose;
    prev = pose;
    fly(true);
  }

  /**
   * The ledge's catch, a step of it: `at` from where the body was, leaving with the body's own velocity, to the point
   * of the edge its paws take (a curve that starts at that velocity and ends at rest there). Then the script's.
   */
  function reachEdge(): void {
    const l = host.ledge();
    const c = grab;
    if (!l || !c || host.state() !== 'ledge') {
      grab = null;
      phase = 'script';
      return;
    }
    c.n += 1;
    const D = B.catchEase;
    const s = Math.min(1, c.n / (D * HZ));
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2;
    const q: Vec3 = [h00 * c.p0[0] + h10 * D * c.v0[0] + h01 * l.at[0], h00 * c.p0[1] + h10 * D * c.v0[1] + h01 * l.at[1], h00 * c.p0[2] + h10 * D * c.v0[2] + h01 * l.at[2]];
    host.setAt([q[0], Math.max(top, q[1]), q[2]]);
    if (s >= 1) {
      grab = null;
      lay = null;
      phase = 'script';
    }
  }

  // ── the walk home, watched ──
  /** Where it has been standing on its walk home, and for how many steps. */
  let stood: { at: Vec3; ticks: number } | null = null;
  function watchWalk(): void {
    if (host.state() !== 'walk') {
      stood = null;
      return;
    }
    const at = host.at();
    if (!stood || Math.hypot(at[0] - stood.at[0], at[2] - stood.at[2]) > B.stuckRoom) {
      stood = { at, ticks: 0 };
      return;
    }
    stood.ticks += 1;
    if (stood.ticks < steps(B.stuck)) return;
    stood = null;
    // it has waited long enough: a hop on toward its stool, to the first place along the way that is nearer home
    // and that it can stand and walk home from; none short of the stool: onto the stool's foot
    const foot = host.footNow();
    const d = Math.hypot(foot[0] - at[0], foot[2] - at[2]);
    let to = foot;
    for (let far = B.rescueHop; far < d - 0.5; far += 0.8) {
      const q = host.standingAt([at[0] + ((foot[0] - at[0]) * far) / d, top, at[2] + ((foot[2] - at[2]) * far) / d]);
      if (Math.hypot(foot[0] - q[0], foot[2] - q[2]) < d - far * 0.6 && host.canStand(q)) {
        to = q;
        break;
      }
    }
    const from: Vec3 = [at[0], Math.max(top, at[1]), at[2]];
    lay = { pose: { p: add(from, UP), q: qyaw(host.heading()) }, hard: 0, from, to, arc: arcFor(from, to), rise: 0, home: false, fall: 0, speed: 0, shake: 0, look: 0 };
    phase = 'getup';
    host.setLanding({ from, to, speed: 0, fall: 0, drop: false });
    host.setLookAt(null);
    host.setHeading(Math.atan2(to[0] - from[0], to[2] - from[2]));
    host.enter('land', 0, B.hop + B.hopPer * Math.hypot(to[0] - from[0], to[2] - from[2]));
  }

  // ── a step in the air ──
  function airStep(): void {
    const a = air as Air;
    if (ctx.mode(body) !== 'free') {
      // the world took the body away (it should not: a reset comes through `reset`): take over from where it last was
      air = null;
      getUp(now ?? { p: add(host.at(), UP), q: qyaw(host.heading()) }, hardness(a), Math.max(0, a.peak - top), a.drop, a.landing || a.impact, B.bitMost);
      return;
    }
    const pose = ctx.pose(body) as Pose;
    const vel = ctx.velocity(body) as { linvel: Vec3; angvel: Vec3 };
    const p = pose.p;
    const v = vel.linvel;
    if (!finitePose(pose) || !finiteVec(v)) {
      // the engine has lost it (it never has: a safety net): out of sight from where it last was, and back by the chute
      goAway({ p: a.p, q: [0, 0, 0, 1] }, a.out, 0);
      return;
    }
    a.ticks += 1;
    a.peak = Math.max(a.peak, p[1]);

    // what it met in the last step (heard at its end): `a.v` is how it was going before
    const hits = heardHits;
    heardHits = [];
    if (hits.length > 0) {
      const before = length(a.v);
      a.impact = Math.max(a.impact, length(sub(v, a.v)));
      if (!a.touched) a.touchedAt = a.ticks;
      a.touched = true;
      for (const other of hits) {
        if (other !== null) {
          // a loose part or a robot, by real contact. Fetch answers a part that hits it itself (by momentum): no
          // `patch.throw` hit for it, which would make it play its scripted Patch-knock as well
          if (a.met.has(other) || other === ctx.scene.runner.id || before < B.hitSpeed) continue;
          a.met.add(other);
          let txn = ctx.history.chargeMachine(body);
          if (a.chute && (txn === 'crew' || txn === 'system')) {
            // back up the chute with no transaction of its own left (the throw that sent it off moved nothing, and
            // has left the stack): what it knocks now opens one, as the scripted Patch's return did
            txn = ctx.history.open('release', other, ctx.clock.step);
            ctx.history.claim(other, txn, ctx.clock.step);
            ctx.history.claim(body, txn, ctx.clock.step);
            thrownAs = txn;
          }
          ctx.emit({ type: 'patch.throw', phase: 'hit', speed: before, what: other, ...(txn !== 'crew' && txn !== 'system' ? { txn } : {}) });
          continue;
        }
        // (which fixed body: the one its box is against now, or was a step ago if it has already come off it)
        const met = against(pose) ?? against({ p: a.p, q: pose.q });
        if (!met) {
          // none of those: the bench itself, if it is down on it
          if (p[1] - reachDown(pose.q) > top + 0.2) continue;
          if (!a.landed && a.thrown) ctx.emit({ type: 'patch.throw', phase: 'landed', speed: before });
          if (!a.landed) a.landing = before;
          a.landed = true;
          continue;
        }
        const o = met.o;
        // met side-on: the way out of it is level (not its top), and its face goes on up above Patch's middle
        const flat = Math.hypot(met.n[0], met.n[2]);
        const n: readonly [number, number] = flat > 1e-6 ? [met.n[0] / flat, met.n[2] / flat] : [0, 0];
        const into = -(a.v[0] * n[0] + a.v[2] * n[1]);
        const side = flat > 0.8 && p[1] < o.y1 - 0.03;
        // the face it met: how wide (the fixed body's extent along that face)
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
        const alongX = Math.abs(c * n[0] - s * n[1]) > Math.abs(s * n[0] + c * n[1]);
        const face = alongX ? o.hz : o.hx;
        if (!a.chute && !a.out && side && o.y1 >= p[1] + T.wallAbove && p[1] <= T.wallMeet && into >= B.wallInto && into >= B.wallSquare * level(a.v) && face >= B.wallFace) {
          // the wall gag: it really met a wall, side-on, square and fast. Flat against it, then down it (the script's)
          // (how hard: the wall took all of the speed it came in with, and what the engine had already turned back)
          splatOn(pose, o.id, n, before, Math.max(a.impact, before));
          return;
        }
        if (!a.met.has(o.id) && before >= B.hitSpeed) {
          a.met.add(o.id);
          ctx.emit({ type: 'patch.throw', phase: 'hit', speed: before, what: o.id });
        }
      }
    }

    // over an open edge: low and slow it catches it; fast or high it simply falls
    if (!a.out && outside(p)) {
      const over = p[1] <= top + B.reachUp && p[1] >= top - B.reachDown && level(v) <= B.catchSpeed && v[1] >= -B.catchFall ? host.edgeFor(p) : null;
      // (and only where the haul stands it just in from the edge, at a place it can walk home from. Where that spot
      // is taken, the scripted catch hauls it to the nearest clear one however far, through whatever is between; and
      // by the storefront's end it stands it in the slot behind the pallets, shut in for good. There it does not
      // catch: it falls, and comes back by the chute)
      const inFrom = over ? Math.hypot(over.up[0] - (over.at[0] - over.out[0] * T.ledgeIn), over.up[2] - (over.at[2] - over.out[2] * T.ledgeIn)) : 0;
      if (over && inFrom < 0.3 && host.canStand(over.up)) {
        ctx.stow(body, pose);
        air = null;
        lay = { pose, hard: hardness(a), from: p, to: over.at, arc: 0, rise: 0, home: false, fall: 0, speed: length(v), shake: 0, look: 0 };
        // the catch is a real one: from where its body was, with the motion it had, to the edge
        grab = { p0: [p[0], Math.max(top, p[1]), p[2]], v0: v, n: 0 };
        phase = 'catch';
        host.setLedge(over);
        host.setHeading(Math.atan2(-over.out[0], -over.out[2]));
        host.enter('ledge');
        reachEdge(); // (this step too: it does not stop in the air for a step as the script takes over)
        return;
      }
      a.out = true;
      ctx.emit({ type: 'patch.throw', phase: 'gone', speed: length(v) });
    }
    if (a.out && p[1] < top - B.outOfSight) {
      goAway(pose, true, length(v));
      return;
    }

    // the float: near the top of a throw that was nearly straight up, gravity is eased (its drift is its own)
    if (a.lift > 0 && !a.touched) {
      a.float = floatNow(a.lift, v[1]);
      ctx.buoy(body, floatPull(a.lift, v[1]));
    } else if (a.float > 0) {
      a.float = 0;
      ctx.buoy(body, 1);
    }

    // down on the running belt: carried along it (the world does not offer a crew member's body to a machine, so
    // the belt's carrying of it is done here, as the surface's drag on what lies on it)
    const surface = beltSurface();
    const riding = Math.abs(surface) > 0.05 && onBelt(pose);
    if (riding) ctx.shove(body, [(surface - v[0]) * B.beltGrip, 0, 0]);
    // plainly down (slow where it lies, and held up: its fall is not gathering), at rest, or loose too long
    const held = a.float < 0.02 && Math.abs(v[1] - a.v[1]) < 0.15;
    // (riding, it is slow when it goes as the belt goes; and it rolls a little as the bed under it, which does not
    // itself move, drags on it: that turning is the carry's, not a tumble still to wait out)
    const over: Vec3 = riding ? [v[0] - surface, v[1], v[2]] : v;
    a.slow = length(over) < B.slowLinear && (riding || length(vel.angvel) < B.slowAngular) && held ? a.slow + 1 : 0;
    if (level(v) > 0.3) host.setHeading(Math.atan2(v[0], v[2]));
    host.setAt(p);
    a.v = v;
    a.p = p;
    if (ctx.settled(body) || a.slow >= steps(B.slowFor) || a.ticks >= steps(B.cap)) recover();
  }

  // ── the unit, wrapped ──
  const intent0 = unit.intent?.bind(unit);
  const pre0 = unit.pre?.bind(unit) ?? ((): void => {});
  const post0 = unit.post?.bind(unit);
  const heard0 = unit.heard?.bind(unit);
  const reset0 = unit.reset?.bind(unit);
  const view0 = unit.view.bind(unit);

  unit.intent = (intent: Intent): boolean => {
    if (intent.type !== 'drag' || intent.id !== id) return intent0?.(intent) ?? false;
    if (ctx.bracketed || phase === 'away') return false; // (out of sight: nothing to take hold of)
    if (phase !== 'held') {
      // taken hold of: in the air its body simply becomes held where it is; from the script it comes into the world
      // where Patch is
      pending = inWorld() ? (ctx.pose(body) as Pose) : scripted();
      if (air?.float) ctx.buoy(body, 1);
      stood = null;
      air = null;
      lay = null;
      grab = null;
      returns = 0;
      thrownAs = null;
      hands.length = 0;
      phase = 'held';
      host.grabbed();
    }
    hand = intent.target;
    if (hands.length > 0 && hands[hands.length - 1]!.step === ctx.clock.step) hands[hands.length - 1] = { step: ctx.clock.step, p: hand };
    else hands.push({ step: ctx.clock.step, p: hand });
    while (hands.length > 1 && ctx.clock.step - hands[0]!.step > 15) hands.shift();
    if (!inWorld()) host.setAt(hand); // (the world's grab brings the body in right after this; a bare drag has none)
    if (intent.end) {
      if (ctx.mode(body) === 'gone') {
        // let go by a drag that never came through the world's grab (no body was in the hand): thrown from the hand
        // with the velocity the drag states
        const pose = clear({ p: [hand[0], Math.max(top + half[1] + 0.02, hand[1] - half[1]), hand[2]], q: qyaw(host.heading()) });
        ctx.launch(body, pose, intent.velocity ?? [0, 0, 0], [0, 0, 0], null);
        now = pose;
        prev = pose;
      }
      if (ctx.mode(body) === 'free') {
        const pressed = pressedTo(ctx.pose(body) as Pose);
        fly(false);
        if (pressed) {
          // (thrown at the wall from against it: its body has no speed to show for it, the hand's push stands for it)
          const speed = Math.max(T.throwAt, length(ctx.velocity(body)?.linvel ?? [0, 0, 0]));
          if (air && !air.thrown) ctx.emit({ type: 'patch.throw', phase: 'thrown', speed });
          splatOn(ctx.pose(body) as Pose, pressed.o.id, pressed.n, speed, B.hardAt * 0.6);
        }
      }
    }
    return true;
  };

  unit.embody = (which: Id) => {
    if (which !== id || phase !== 'held') return null;
    const pose = ctx.mode(body) === 'free' ? (ctx.pose(body) as Pose) : (pending ?? scripted());
    pending = null;
    if (ctx.mode(body) !== 'free') {
      now = pose;
      prev = pose;
    }
    return { body, pose, grip: add(pose.p, rotate(pose.q, SCRUFF)) };
  };

  /** The scripted state each of this module's phases runs under. */
  const UNDER: Readonly<Record<Exclude<Phase, 'script'>, PatchState>> = { held: 'held', air: 'fly', catch: 'ledge', wall: 'wall', getup: 'land', shake: 'shake', look: 'look', away: 'away' };

  unit.pre = (): void => {
    if (phase !== 'script' && host.state() !== UNDER[phase]) {
      // the script has moved on by itself (nothing does that today; a safety net): its body goes with it
      if (ctx.mode(body) === 'free') ctx.stow(body, ctx.pose(body) as Pose);
      phase = 'script';
      air = null;
      lay = null;
      grab = null;
    }
    if (ctx.bracketed || phase === 'held') return pre0(); // (a rung plays: frozen, as the script is)
    if (phase === 'script') {
      pre0();
      watchWalk();
      return;
    }
    if (phase === 'catch') {
      // the script's `ledge` (it holds `at` at the edge); over it, the catch: eased there from where the body was
      pre0();
      reachEdge();
      return;
    }
    host.idle();
    const t = host.seconds();
    switch (phase) {
      case 'air':
        airStep();
        break;
      case 'wall': {
        // stuck flat to the wall a moment, then down it to the bench (the scripted slide), where it sits and gets up
        if (t < T.stick) break;
        const at = host.at();
        slideFrom ??= at[1];
        // (down to whatever stands at the wall's foot under any of it: the board's desk under its panel)
        const foot: Vec3 = [at[0] + wallOut[0] * 0.15, at[1], at[2] + wallOut[2] * 0.15];
        const rest = floorUnder([at[0], slideFrom, at[2]], Math.max(half[0], half[2])) + T.restMid;
        const drop = Math.max(0.05, slideFrom - rest);
        const v = Math.min(Math.max(T.slideDown, drop / T.slideMost), (t - T.stick) * 4, drop / T.slideMin + 0.05);
        const ny = at[1] - v / HZ;
        if (ny > rest) {
          host.setAt([at[0], ny, at[2]]);
          break;
        }
        const hard = lay?.hard ?? 0.5;
        const speed = lay?.speed ?? 0;
        host.setWalled(null);
        // sat at the wall's foot, its back to it
        getUp({ p: [foot[0], rest - T.restMid + half[1] + 0.01, foot[2]], q: qyaw(Math.atan2(wallOut[0], wallOut[2])) }, hard, drop, true, speed, t);
        break;
      }
      case 'getup': {
        const l = lay;
        const len = host.length();
        if (!l) {
          phase = 'script';
          host.walkHome(0);
          break;
        }
        // sat as it landed for `rise`, then (if it must) the hop: eased along its arc
        const k = len - l.rise > 1e-6 ? Math.min(1, Math.max(0, (t - l.rise) / (len - l.rise))) : t >= l.rise ? 1 : 0;
        const e = k * k * (3 - 2 * k);
        host.setAt([lerp(l.from[0], l.to[0], e), Math.max(top, lerp(l.from[1], l.to[1], e) + 4 * l.arc * e * (1 - e)), lerp(l.from[2], l.to[2], e)]);
        if (t < len) break;
        host.setAt(l.to);
        if (l.home) {
          // on its stool: home
          lay = null;
          phase = 'script';
          host.setLanding(null);
          host.setHeading(spec.facing);
          host.carryOn();
          break;
        }
        if (l.shake > 0) {
          phase = 'shake';
          host.enter('shake', 0, l.shake);
          break;
        }
        afterShake(l.look);
        break;
      }
      case 'shake':
        if (t >= host.length()) afterShake(lay?.look ?? 0);
        break;
      case 'look':
        // it has had its look: the walk's set-off is only the turn to its way
        if (t < host.length()) break;
        phase = 'script';
        host.setAfoot(false);
        host.setLookAt(null);
        host.walkHome(T.setOff / 2);
        break;
      case 'away':
        if (t >= T.away) fromChute();
        break;
    }
  };

  /** Sat up: the look at the visitor if it came down hard enough to earn one, then the walk home (the script's). */
  function afterShake(look: number): void {
    lay = null;
    returns = 0;
    thrownAs = null;
    host.setLanding(null);
    if (look > 0) {
      phase = 'look';
      host.setAfoot(true);
      host.setLookAt(spec.visitor);
      host.enter('look', 0, look);
      return;
    }
    // a gentle one: no look; it turns to its way and goes
    phase = 'script';
    host.walkHome(T.setOff / 2);
  }

  unit.post = (): void => {
    post0?.();
    if (inWorld()) {
      prev = now ?? (ctx.pose(body) as Pose);
      now = ctx.pose(body) as Pose;
    } else {
      now = null;
      prev = null;
    }
  };

  unit.heard = (events: readonly SimEvent[]): void => {
    // (its own body let go is not a part thrown at it)
    heard0?.(events.some((e) => e.type === 'part.released' && e.id === body) ? events.filter((e) => !(e.type === 'part.released' && e.id === body)) : events);
    if (phase !== 'air' || ctx.bracketed) return; // (a rung plays: its body is the rung's, and is rewound)
    for (const e of events) if (e.type === 'part.hit' && (e.id === body || e.other === body)) heardHits.push(e.id === body ? e.other : e.id);
  };

  const bracket0 = unit.bracket?.bind(unit);
  unit.bracket = (on: boolean): void => {
    bracket0?.(on);
    // a rung begins while it floats at the top of a throw: through the rung its body falls as any body does (the
    // world's snapshot, taken before this, has the float, so it is back when the rung has been rewound)
    if (on && air && air.float > 0) ctx.buoy(body, 1);
  };

  unit.reset = (): void => {
    const m = ctx.mode(body);
    if (m === 'free') ctx.stow(body, ctx.pose(body) as Pose);
    phase = 'script';
    air = null;
    lay = null;
    grab = null;
    pending = null;
    heardHits = [];
    returns = 0;
    thrownAs = null;
    stood = null;
    now = null;
    prev = null;
    reset0?.();
  };

  unit.view = (): PatchView => {
    const v = view0();
    const m = ctx.mode(body);
    if (m !== 'held' && m !== 'free') return { ...v, body: null, lay: lay ? { pose: lay.pose, hard: lay.hard, from: lay.from, to: lay.to, arc: lay.arc, rise: lay.rise } : null };
    // in the world: Patch is where its body is (also while a rung plays and rewinds it)
    const pose = ctx.pose(body) as Pose;
    const held = m === 'held';
    const a = air;
    const vel = ctx.velocity(body)?.linvel ?? [0, 0, 0];
    // (held, `at` is the hand as the scripted Patch has it: its middle hangs `hangBelow` under it)
    const sense = (p: Vec3): Vec3 => (held ? [p[0], p[1] + T.hangBelow, p[2]] : p);
    const at = sense(pose.p);
    return {
      ...v,
      at,
      // (a step ago, in the same sense; `at` itself when its body has only now come into the world: nothing to draw between)
      prevAt: prev && prev !== pose ? sense(prev.p) : at,
      heading: held ? yawOf(pose.q) : v.heading,
      // (`float`: how much this throw floats at its top; `top`: its pull down by more than a third, as the scripted Patch's)
      thrown: !held && a ? { v: vel, speed: length(vel), chute: a.chute, fall: Math.max(0, a.peak - pose.p[1]), drop: a.drop, top: a.float > 0 && floatPull(a.lift, vel[1]) < PATCH_FLOAT.topBelow, float: a.lift } : v.thrown,
      body: { id: body, pose, prev: prev ?? pose, half, held, float: held || !a ? 0 : a.float },
      lay: null,
    };
  };
}
