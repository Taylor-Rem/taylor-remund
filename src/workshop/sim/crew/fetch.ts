/**
 * Fetch, the runner (REWRITE.md § B5, § B3, § G "P1", "P2"). A state machine
 * on the fixed step. Eager and too fast: it overshoots every stop and skids
 * back. It cannot leave its lane of tape (except to hurry back to it after
 * being put down elsewhere, or after being knocked off it).
 *
 * Attract mode (the vignette's Fetch, unchanged): rolls up and down its lane
 * carrying a crate; after ~4 s with no visitor input it fumbles the crate so
 * it tumbles to a stop beside the Button, looks at it, then out at the
 * visitor, hands out; if ignored for 5 s (12 s while the pointer is on the crate) it fetches it back, shrugs and
 * carries on. The fumble repeats at most every 40 s and never after the
 * visitor's first action (§ B3 "Never nag"). It freezes while a Button rung
 * plays.
 *
 * Play mode, its rounds (S5; `FetchSpec.rounds`; § B3 "Fetch goes on carrying
 * fresh crates down the belt"): it takes the top fresh crate off the stack
 * (`pickup`: reach, then the crate comes into its hands) and sets it on the
 * belt's motor end (`place`: turn, reach out, lower, let go), at most one
 * every `rounds.every` seconds, never with more than `rounds.cap` crates in
 * play, and only while the belt runs forward; the dock restocks the stack as
 * crates ship, so the loop never runs dry. What it cannot reach from its
 * tape it stretches for (`reach`), gives up on, and prints OUT OF MY LANE
 * (then not again for `giveUpFor` seconds). When the visitor does its job
 * for it (puts a crate on the belt while it is empty-handed, or takes the
 * crate out of its hands) it looks at its empty hands and salutes.
 *
 * Attract mode's lap (S6, § B3; `FetchSpec.attract`): until the visitor's
 * first action, on a bench where its tape reaches the stack, the platen's
 * tray, the phone and the belt's drop, it takes a crate off the stack (the
 * first lap: the one in its hands) to the tray, taps the phone (`tap`: the
 * crew's text goes down the PLATEN line; Patch moves the cord, paints it,
 * replies, puts the cord back), takes the painted crate off the tray to the
 * belt, and watches it ride and ship; when the stack has its fresh crate the
 * next lap begins (`attract()`, `ATTRACT_TIMELINE`, `attract.beat` events).
 * The fumble comes once, in the first lap. Everything it does is `crew`. At
 * the first action it goes on with its rounds, taking a crate it left on the
 * tray to the belt first if nobody has touched it.
 *
 * Knocked (S5; `fetch-knock.ts`): a free part that hits it (or the crate in
 * its hands) with speed shoves it along the part's line and spins it, by
 * one of three strengths from the part's momentum; the slide is cut short
 * of the bench edge and of every machine. It drops what it carried, charged
 * to the throw (§ E5 rule 4). It wobbles back to balance and returns to its
 * lane; it cannot be knocked again until the wobble is over. A slow part is
 * only a look (`crew.nudged`). Held, riding a machine, or frozen, it is not
 * knocked at all. The part that hit it keeps the momentum a toy would have
 * let it keep (Fetch is driven, so to the engine it is a wall).
 *
 * Its position and intentions are transient (§ E5): nothing here commits,
 * except where a part it lets go of comes to rest (charged to `crew`, or to
 * the throw that knocked it). It never touches a part the visitor has
 * touched (§ E5 rule 5: `attach` refuses it, and it checks before it reaches).
 *
 * `carry` in the brief is not a separate state: `carrying` is set while it
 * rolls, idles or skids with a crate in its hands.
 */
import type { AttractBeat, AttractView, Cause, CrewMember, FetchKnock, FetchState, Gaze, Id, Pose, Quat, SimEvent, Vec3 } from '../types.ts';
import { deskOf } from '../machines/line.ts';
import type { SimContext, Unit } from '../context.ts';
import { HZ, steps } from '../clock.ts';
import { qnormalize, qyaw, yawOf } from '../math.ts';
import { MATERIAL, massOf } from '../parts.ts';
import { KNOCK_TUNING, classify, clearRun, distanceTo, obstacles, toyBounce } from './fetch-knock.ts';
import { lanePath } from '../path.ts';
import { bodiesOf, route } from './fetch-route.ts';
import { jetAt, planHop, planJet } from './fetch-jet.ts';
import type { JetPhase, JetPlan, TallBody } from './fetch-jet.ts';
import type { Pt } from './fetch-route.ts';
import type { SceneDesc, StandPoint } from '../scene.ts';
import type { Obstacle, Strength } from './fetch-knock.ts';

/** Timings (seconds), speeds (units/s) and distances (units), at P1 size. Tune here. */
export const FETCH_TUNING = {
  accel: 7.5,
  maxSpeed: 2.6,
  brake: 8,
  /** How far past a stop it runs before skidding back. */
  overshoot: 0.3,
  skidBack: 0.8,
  /** S5 round 2: the hand never goes faster than this (units/s); a reach that far takes longer than its nominal time. */
  handSpeed: 6,
  /** Pause at each end of the lane: [min, max]. */
  idle: [0.8, 2.0] as readonly [number, number],
  /** The lane's stops are this far inside its ends. */
  inset: 0.3,
  bodyHalfHeight: 0.5,
  /** Hands reach this far beyond the front of its body (half depth `bodyHalfDepth`), plus the carried part's own half depth. */
  handGap: 0.03,
  bodyHalfDepth: 0.26,
  /** Nominal reach of the hands from its centre, for an S crate (used for the pickup distance). */
  handForward: 0.515,
  handHeight: 0.62,
  /** Visitor inactivity before the fumble (§ B3: about 4 s). */
  fumbleAfter: 4,
  /** At most one fumble per this many seconds (§ B3). */
  fumbleEvery: 40,
  /** From the start of the fumble to letting go. */
  fumbleWindup: 0.35,
  /** From letting go to offering. */
  fumbleRecover: 0.7,
  /** In the offer: looks at the crate this long, then out at the visitor. */
  offerLook: 0.9,
  /** Ignored this long, it fetches the crate back (§ B3). */
  /** R1 (Taylor, 2026-11-19: "it just takes him too long to get back to things"): 5 s, was 12. */
  ignoredFor: 5,
  /** R1: while the visitor's pointer is on the offered crate the offer holds, to at most this long in all (the old 12 s). */
  offerHeldFor: 12,
  /** How far from its lane it can reach for a part (beyond `handForward`). */
  reach: 1.15,
  pickup: 0.45,
  /** R1: 1.0 s, was 1.2 (the view's shrug curve is over at 1.0: no still tail). */
  shrug: 1.0,
  /** R4: thrown faster than this (units/s) it shakes itself off when it comes down, before it goes back. */
  shakeAfter: 3,
  /** R4: loose this long below this speed without the world calling it at rest (wedged and rocking), it gets up anyway. */
  stuckAfter: 2.5,
  /** R4: thrown into a machine's hands and held there this long without moving (the platen's tray, a stopped belt), it hops off on its jets. */
  leaveMachine: 2.5,
  /** ...but set there on purpose (on the platen's tray, to be painted), it waits this long first. */
  leaveMachineSet: 45,
  stuckSpeed: 0.4,
  /** R4: come to rest with its lowest point more than this over the bench top, it is up on something: it hops down. */
  standOn: 0.08,
  /** R4: how far into a body its footprint circle may reach where it comes down and still stand there (its box is smaller than the circle). */
  standSlack: 0.08,
  salute: 1.1,
  returnSpeed: 2.2,
  // ── S5 ──
  /** How fast it turns on the spot or into a run (radians/s). */
  turnRate: 11,
  /** After the reach, the crate comes into its hands over this long, lifted this much first (units). */
  gather: 0.55,
  gatherLift: 0.12,
  /** Setting a crate down: turn to the belt, reach out over the drop, lower it, let go; then arms back. */
  place: { turn: 0.3, out: 0.4, lower: 0.18, back: 0.3 } as const,
  /** The crate is carried out this high over the belt (units above its resting height). */
  placeLift: 0.15,
  /** The drop is clear when no other part is within this distance of it (horizontal, units). */
  dropClear: 0.55,
  /** Stretching for something past its tape, before it gives up. */
  stretch: 0.9,
  /** After giving up on something out of reach, it does not stretch (or print the slip) again for this long. */
  giveUpFor: 40,
  /** Hands up when a part in the visitor's hand comes within this distance (horizontal, units). */
  handsUpNear: 1.6,
  /** Its eye follows a loose part on the move within this distance (units). */
  gazeRange: 4,
  // ── S5 round 2: the path and the hands ──
  /** A corner of its path is ridden as an arc of this radius (less where the runs are too short), at no more than `cornerSpeed`. */
  cornerRadius: 0.3,
  cornerSpeed: 1.2,
  /**
   * The grip (`CrewMember.hands`), seconds: the claws closing on a part (inside `gather`), and the ease back to
   * the carry pose after a tap, a stretch or a reach given up (`back`), and after a set-down (`backAfterPlace`:
   * prompt, eased out, so the claws come home as the crate settles). The reach out itself takes `pickup`
   * (straight out to above the part, then down onto it: no wind-up here, round 3, the arm's own draw back is the
   * anticipation); `gather` brings it in (close, straight up `gatherLift`, across above the hands, down into
   * them); `place` and `TAP` time the others.
   */
  hands: { down: 0.12, close: 0.1, back: 0.3, backAfterPlace: 0.18, stretchOut: 0.4 } as const,
  /** S5 round 3: a way back that is shut in is tried again this often (seconds). */
  routeRetry: 3,
} as const;

export type { FetchState } from '../types.ts';

/**
 * Fetch at `k` times P1's size (`SceneDesc.crewScale`): its body, its hands and its reach scale, and so
 * do its speeds, so it looks just as eager. Times stay as they are.
 */
function scaled(t: typeof FETCH_TUNING, k: number): typeof FETCH_TUNING {
  if (k === 1) return t;
  return {
    ...t,
    accel: t.accel * k,
    maxSpeed: t.maxSpeed * k,
    brake: t.brake * k,
    overshoot: t.overshoot * k,
    skidBack: t.skidBack * k,
    bodyHalfHeight: t.bodyHalfHeight * k,
    handGap: t.handGap * k,
    bodyHalfDepth: t.bodyHalfDepth * k,
    handForward: t.handForward * k,
    handHeight: t.handHeight * k,
    reach: t.reach * k,
    returnSpeed: t.returnSpeed * k,
    gatherLift: t.gatherLift * k,
    placeLift: t.placeLift * k,
    dropClear: t.dropClear * k,
    handsUpNear: t.handsUpNear * k,
    gazeRange: t.gazeRange * k,
    cornerRadius: t.cornerRadius * k,
    cornerSpeed: t.cornerSpeed * k,
    handSpeed: t.handSpeed * k,
  } as typeof FETCH_TUNING;
}

/** Why it is rolling: a lap (or nothing in particular), to fumble, to fetch back the fumbled crate, to take one off the stack, to set one down, to stretch for one. */
type Purpose = 'lap' | 'fumble' | 'retrieve' | 'take' | 'place' | 'stretch' | 'collect' | 'tap';

/**
 * S6: attract mode's lap as data a view can follow (§ B3): its beats in order, a nominal length for each
 * (seconds, measured on the bench: the real lengths come from the crew's own states, published as they
 * go), and whose view state shows it (`fetch`: `CrewMember`; `patch`: `PatchView.plan`; `line`: the belt,
 * the striker and the dock and their events).
 */
export const ATTRACT_TIMELINE: readonly { readonly beat: AttractBeat; readonly nominal: number; readonly follow: 'fetch' | 'patch' | 'line' }[] = [
  { beat: 'fetch-crate', nominal: 2.5, follow: 'fetch' },
  { beat: 'to-tray', nominal: 3, follow: 'fetch' },
  { beat: 'tap', nominal: 1.5, follow: 'fetch' },
  { beat: 'patch', nominal: 6.5, follow: 'patch' },
  { beat: 'collect', nominal: 1.5, follow: 'fetch' },
  { beat: 'to-belt', nominal: 4, follow: 'fetch' },
  { beat: 'ride', nominal: 9, follow: 'line' },
];
/** After the lap's crate ships, the lap waits this long (seconds) for the stack's fresh crate before it ends anyway (the dock's restock comes 1.4 s after). */
const LAP_RESTOCK_WAIT = 3.4; // S5 R1: the restock 1.4 s after, then the chute's throw (about 1.2 s) onto the pad
/** Fetch's tap on the phone: it reaches out, taps (the text goes at `at`), and draws back. Seconds. */
export const TAP = { at: 0.45, length: 0.9 } as const;

export interface FetchUnit extends Unit {
  member(): CrewMember;
  /** S6: attract mode's lap, as data the view can follow. */
  attract(): AttractView;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (f: number): number => f * f * (3 - 2 * f);
const clamp01 = (f: number): number => Math.min(1, Math.max(0, f));
function nlerp(a: Quat, b: Quat, f: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qnormalize([a[0] + (b[0] * s - a[0]) * f, a[1] + (b[1] * s - a[1]) * f, a[2] + (b[2] * s - a[2]) * f, a[3] + (b[3] * s - a[3]) * f]);
}
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const isTxn = (c: Cause): boolean => c !== 'crew' && c !== 'system';

/** S5 round 2: the farthest Fetch's grip goes from its centre on the bench, in this scene (`FetchSpec.reach`, else P2's number). */
export function fetchReach(scene: SceneDesc, tuning: Partial<typeof FETCH_TUNING> = {}): number {
  const T = scaled({ ...FETCH_TUNING, ...tuning }, scene.crewScale ?? 1);
  return scene.runner.reach ?? T.reach + T.handForward;
}

/** S5 round 2: where on its path Fetch stands to handle `what` at (px, pz), and how far that is from it. */
export function fetchStand(scene: SceneDesc, what: 'stack' | 'tray' | 'phone' | 'feed' | 'pad', px: number, pz: number, tuning: Partial<typeof FETCH_TUNING> = {}): { s: number; at: [number, number]; d: number } {
  const T = scaled({ ...FETCH_TUNING, ...tuning }, scene.crewScale ?? 1);
  const path = lanePath(scene.runner.lane.points, T.cornerRadius);
  const ins = scene.runner.lane.endInset ?? T.inset;
  const [inA, inB] = typeof ins === 'number' ? [ins, ins] : ins;
  const lo = Math.min(inA, path.length / 2);
  const hi = Math.max(path.length - inB, path.length / 2);
  const clampS = (v: number): number => Math.min(hi, Math.max(lo, v));
  const onPath = (v: number): number => Math.min(path.length, Math.max(0, v));
  const st = scene.runner.stands?.[what];
  // a stand the scene gives is taken exactly (a path's end included); else the nearest point between the stops
  const sv = typeof st === 'number' ? onPath(st * path.length) : st ? path.nearest(st[0], st[1]) : clampS(path.nearest(px, pz));
  const at = path.at(sv);
  return { s: sv, at, d: Math.hypot(px - at[0], pz - at[1]) };
}

/**
 * S6 / S5 round 2: can Fetch run attract mode's lap on this scene? Every place it handles must be within its
 * reach (`fetchReach`) of where it stands for it (`fetchStand`). Says why not, naming the place, the distance
 * and the reach (what a layout engineer reads); the lap also needs the phone line's desk, which only a
 * running world can say.
 */
export function canRunLap(scene: SceneDesc, tuning: Partial<typeof FETCH_TUNING> = {}): { ok: true } | { ok: false; why: string } {
  const spec = scene.runner;
  const lap = spec.attract;
  const rounds = spec.rounds;
  if (!lap) return { ok: false, why: 'no attract lap in the scene (FetchSpec.attract)' };
  if (!rounds) return { ok: false, why: 'no rounds in the scene (FetchSpec.rounds): the stack and the belt are named there' };
  const tray = scene.mouths?.find((m) => m.id === lap.tray);
  const feed = scene.mouths?.find((m) => m.id === rounds.mouth);
  if (!tray) return { ok: false, why: `no mouth "${lap.tray}" for the tray` };
  if (!feed) return { ok: false, why: `no mouth "${rounds.mouth}" for the belt's feed` };
  const R = fetchReach(scene, tuning);
  const places: ['stack' | 'tray' | 'phone' | 'feed' | 'pad', number, number][] = [
    ['stack', rounds.stack[0], rounds.stack[1]],
    ['tray', tray.drop[0], tray.drop[2]],
    ['phone', lap.phone[0], lap.phone[2]],
    ['feed', feed.drop[0], feed.drop[2]],
    ...(rounds.pad ? [['pad', rounds.pad[0], rounds.pad[1]] as ['pad', number, number]] : []),
  ];
  for (const [what, px, pz] of places) {
    const st = fetchStand(scene, what, px, pz, tuning);
    if (st.d > R) return { ok: false, why: `${what} at (${px.toFixed(2)}, ${pz.toFixed(2)}) is ${st.d.toFixed(2)} from where Fetch stands for it (${st.at[0].toFixed(2)}, ${st.at[1].toFixed(2)}); its reach is ${R.toFixed(2)}` };
  }
  return { ok: true };
}

export function createFetch(ctx: SimContext, tuning: Partial<typeof FETCH_TUNING> = {}): FetchUnit {
  const k = ctx.scene.crewScale ?? 1;
  const T = scaled({ ...FETCH_TUNING, ...tuning }, k);
  const K = KNOCK_TUNING;
  const spec = ctx.scene.runner;
  const rounds = spec.rounds ?? null;
  const rng = ctx.rng('fetch');
  const knockRng = ctx.rng('fetch:knock'); // its own fork: a knock never shifts the idle pauses
  // S5 round 2: its lane is a path of runs; it rides it by distance `s` from the first point
  const PATH = lanePath(spec.lane.points, T.cornerRadius);
  const laneLen = PATH.length;
  const endInset = spec.lane.endInset ?? T.inset;
  const [insetA, insetB] = typeof endInset === 'number' ? [endInset, endInset] : endInset;
  const stopA = Math.min(insetA, laneLen / 2);
  const stopB = Math.max(laneLen - insetB, laneLen / 2);
  /** A point of the path itself: never past either end. */
  const onPath = (s: number): number => Math.min(laneLen, Math.max(0, s));
  const clampLane = (s: number): number => Math.min(stopB, Math.max(stopA, s));
  const at = (s: number): [number, number] => PATH.at(s);
  /** The way the path runs at `s` (toward its last point). */
  const pathYaw = (s: number): number => PATH.yaw(s);
  /** Path distance (between its stops) of the point nearest (x, z). */
  const nearest = (x: number, z: number): number => clampLane(PATH.nearest(x, z));
  /** S5 round 2: the farthest its grip goes from its centre, on the bench (`FetchSpec.reach`; else P2's number). */
  const R = spec.reach ?? T.reach + T.handForward;
  /** Where on the path it stands to handle `what` at (px, pz): the scene's stand point, else the nearest point. */
  const standS = (what: keyof NonNullable<typeof spec.stands>, px: number, pz: number): number => {
    const st: StandPoint | undefined = spec.stands?.[what];
    // taken exactly: a stand at a path's very end is that end, not the inset stop
    if (typeof st === 'number') return onPath(st * laneLen);
    if (st) return PATH.nearest(st[0], st[1]);
    return nearest(px, pz);
  };
  const selfSpec = ctx.scene.parts.find((p) => p.id === spec.id);
  const selfHalf: Vec3 = ctx.halfExtents(spec.id) ?? [0.3, 0.5, 0.26];
  const selfMass = selfSpec?.mass ?? massOf(selfHalf, selfSpec?.material ?? 'metal');
  const selfE = MATERIAL[selfSpec?.material ?? 'metal'].restitution;
  /** Its footprint as a circle, for the knock's clearance. */
  const footprint = Math.hypot(selfHalf[0], selfHalf[2]) + K.margin * k;
  /** S5 round 3: within this of a path's end it does not turn on the spot (its corners reach this much further than its nose). */
  const turnClear = Math.hypot(selfHalf[0], selfHalf[2]) - Math.min(selfHalf[0], selfHalf[2]) + 0.02;
  const OBSTACLES = obstacles(ctx.scene);
  /** S5 round 3: the fixed bodies it drives round on its way back. */
  const BODIES = bodiesOf(OBSTACLES);
  /**
   * S6: the other robots' bodies where they stand now (Revert is a body, not a static: up out of its hatch,
   * or put down anywhere, it is in the way of a knocked Fetch's slide; down its hatch, shipped or in the
   * visitor's hand it is not).
   */
  function robotObstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const id of ctx.parts()) {
      if (id === spec.id || ctx.part(id)?.kind !== 'robot') continue;
      const m = ctx.mode(id);
      if (m === 'gone' || m === 'chute' || m === 'held') continue;
      const p = ctx.pose(id);
      const h = ctx.halfExtents(id);
      if (!p || !h) continue;
      out.push({ id, x: p.p[0], z: p.p[2], hx: h[0], hz: h[2], yaw: yawOf(p.q) });
    }
    return out;
  }
  /**
   * S6: a part that starts inside Fetch's body (let go of there, put back there by an undo, set down
   * there by the dock or the chute while Fetch stood on the spot): the push that parts them is not a hit,
   * and must not knock it. Such a part's contacts with Fetch are not heard until it has come clear of
   * it; a real hit after that counts, once. A part merely touching it when let go (a throw from close
   * by) is a hit as usual.
   */
  const startedInside = new Set<Id>();
  /** Where each free part was at the last `pre` (a part new to physics, or one that jumped, is checked). */
  const lastFree = new Map<Id, Vec3>();
  /**
   * How far the part's box is from Fetch's body box on the bench (negative: they overlap by that much),
   * by the separating axes of the two turned rectangles; and whether they share height at all.
   */
  function gapToMe(id: Id): number {
    const pose = ctx.pose(id);
    const h = ctx.halfExtents(id);
    if (!pose || !h) return Infinity;
    const p = pose.p;
    if (p[1] - h[1] > 2 * selfHalf[1] || p[1] + h[1] < 0) return Infinity;
    const a = heading;
    const b = yawOf(pose.q);
    const dx = p[0] - x;
    const dz = p[2] - z;
    // each rectangle's two axes (its local +X and +Z on the bench)
    const axes: [number, number][] = [
      [Math.cos(a), -Math.sin(a)],
      [Math.sin(a), Math.cos(a)],
      [Math.cos(b), -Math.sin(b)],
      [Math.sin(b), Math.cos(b)],
    ];
    const proj = (ax: [number, number], yaw: number, hx: number, hz: number): number => hx * Math.abs(ax[0] * Math.cos(yaw) - ax[1] * Math.sin(yaw)) + hz * Math.abs(ax[0] * Math.sin(yaw) + ax[1] * Math.cos(yaw));
    let gap = -Infinity;
    for (const ax of axes) gap = Math.max(gap, Math.abs(dx * ax[0] + dz * ax[1]) - proj(ax, a, selfHalf[0], selfHalf[2]) - proj(ax, b, h[0], h[2]));
    return gap;
  }
  /** Note the free parts that have just appeared inside Fetch (before physics parts them). */
  function startsInside(): void {
    const free = new Set<Id>();
    for (const id of ctx.parts()) {
      if (id === spec.id || ctx.mode(id) !== 'free') continue;
      const p = ctx.pose(id)?.p;
      if (!p) continue;
      free.add(id);
      const last = lastFree.get(id);
      if ((!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.3) && gapToMe(id) < -0.05) startedInside.add(id); // inside by more than a hand pressing it against Fetch (about 1 cm)
      lastFree.set(id, p);
    }
    for (const id of [...lastFree.keys()]) if (!free.has(id)) lastFree.delete(id);
  }

  let state: FetchState = 'idle';
  let entered = ctx.clock.step;
  let s = clampLane(spec.start * laneLen);
  let x = at(s)[0];
  let z = at(s)[1];
  let v = 0; // signed speed along the lane (+ toward b)
  let heading = pathYaw(s);
  let carrying: Id | null = null;
  let target = s;
  /** Direction of the current run along the lane, fixed when it starts (the overshoot is past the stop in this direction). */
  let rollDir = 1;
  /** How far past this run's stop it overshoots (R1: less on a short hop). */
  let runOvershoot: number = T.overshoot;
  let purpose: Purpose = 'lap';
  let idleFor = steps(rng.range(T.idle[0], T.idle[1]));
  let lastFumble: number | null = null;
  let fumbled: Id | null = null; // the crate it fumbled and is offering
  let frozenFrom: { state: FetchState; entered: number; at: number } | null = null;
  /** R2: it went out through the dock while held; when it is down again it shakes itself off (a shrug) before it goes back. */
  let shipped = false;
  /** R4: the fastest it moved (horizontally, units/s) since it was let go: thrown, not set down. */
  let flung = 0;
  /** R4: steps loose and slow without settling. */
  let slowFor = 0;
  /** R4: steps held still in a machine's hands, and where it was last step. */
  let machineStill = 0;
  /** R4: it came into the machine's hands thrown (not set there on purpose). */
  let arrivedFlung = false;
  let machineLast: Vec3 | null = null;
  let shrugThenReturn = false;
  let lookAt: Vec3 | null = null;

  // ── S5 ──
  /** The part it is going for (pickup, reach), and what for. */
  let goal: Id | null = null;
  let goalWhy: 'retrieve' | 'take' | 'collect' = 'take';
  /** The crate coming into its hands: from where, since when. */
  let gather: { from: Pose; at: number; dur: number[] } | null = null;
  /** Setting a crate down: the drop pose (bottom of the crate at the mouth's drop point), and whether it has let go. */
  let placing: { to: Pose; above: Pose; from: Pose | null; out: number; let: boolean; dur: [number, number] } | null = null;
  /** The step it last set a crate down (the pace), and the crate, while it is still falling the last hair. */
  let lastPlaced = -Infinity;
  let justPlaced: Id | null = null;
  /** It gave up on something out of reach: not again until this step. */
  let giveUpUntil = -Infinity;
  /** The visitor did its job for it this step: salute at the next. */
  let saluteDue = false;
  /** The knock in progress, with where it started. */
  let knock: (FetchKnock & { x0: number; z0: number; h0: number; dx: number; dz: number }) | null = null;
  /** A hit heard this step, acted on at the next (`heard` never acts). */
  let hit: { by: Id; strength: Strength | 'nudge'; dirX: number; dirZ: number; speed: number; mass: number; spinSign: number } | null = null;
  /** A part to give back a toy's bounce to, at the next step. */
  let bounce: { id: Id; dv: Vec3 } | null = null;
  /** A nudge's look: at this part until this step. */
  let nudge: { id: Id; until: number } | null = null;
  /** Free parts' recent motion, to know how a part was moving just before it hit: its velocity over each of the last few steps, newest last. */
  const motion = new Map<Id, { p: Vec3; v: Vec3; hist: Vec3[] }>();
  /** How many steps of a part's motion are kept (a hit can be reported a step or two after the first touch). */
  const HISTORY = 5;
  let gaze: Gaze | null = null;
  let handsUp = false;
  /** S5 round 2: the grip this step (`CrewMember.hands`), and an ease back to the carry pose in progress. */
  let hands: Vec3 | null = null;
  /** S5 round 3: the way back to its path (way points, the last on the path), when to look for one again if shut in, and whether it is. */
  let way: Pt[] | null = null;
  let wayRetry = -Infinity;
  let shutIn = false;
  // ── the jetpack: over the bench's edge, it flies back onto its tape (fetch-jet.ts) ──
  /** The flight in hand: its plan, the tumble it went over with (eased upright in the fall), its landing on the path, the phase last published. */
  let jet: { plan: JetPlan; q0: Quat; landS: number; phase: JetPhase; cut: boolean } | null = null;
  let jetY = 0;
  /** While held: where its body was last step (how it was moving when it went over). */
  let heldLast: Vec3 | null = null;
  let armBack: { from: Vec3; at: number; dur: number } | null = null;

  const enter = (next: FetchState): void => {
    if (next === state) return;
    const from = state;
    state = next;
    entered = ctx.clock.step;
    reachLegs = null; // a reach belongs to the state that made it
    if (next === 'return') {
      way = null; // a new way back, found from where it is now
      wayRetry = -Infinity;
    }
    shutIn = false;
    ctx.emit({ type: 'crew.state', id: spec.id, state: next, from });
  };
  const inState = (): number => ctx.clock.step - entered;
  const turnToward = (yaw: number): boolean => {
    const d = wrap(yaw - heading);
    const max = T.turnRate / HZ;
    heading = Math.abs(d) <= max ? yaw : heading + Math.sign(d) * max;
    return Math.abs(d) <= max;
  };
  const yawTo = (p: Vec3): number => Math.atan2(p[0] - x, p[2] - z);

  const bodyPose = (): Pose => (jet ? { p: [x, jetY, z], q: jetQ() } : { p: [x, T.bodyHalfHeight, z], q: qyaw(heading) });
  const handPose = (): Pose => {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // never inside its own body: the crate's near face sits just clear of Fetch's front
    const reach = T.bodyHalfDepth + T.handGap + (carrying ? (ctx.halfExtents(carrying)?.[2] ?? 0.225) : 0.225);
    return { p: [x + fx * reach, T.handHeight, z + fz * reach], q: qyaw(heading) };
  };
  // ── S5 round 2: the grip. Every pose a part in its care takes is the grip's; the grip eases, never jumps ──

  const home = (): Vec3 => handPose().p;
  /** Never further from its centre (on the bench) than its reach. */
  const inReach = (p: Vec3): Vec3 => {
    const dx = p[0] - x;
    const dz = p[2] - z;
    const d = Math.hypot(dx, dz);
    return d <= R ? p : [x + (dx / d) * R, p[1], z + (dz / d) * R];
  };
  const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** A leg's time: its nominal length, or longer if the hand would otherwise go faster than `handSpeed` (an eased leg peaks at 1.5× its mean). */
  const legTime = (nominal: number, from: Vec3, to: Vec3): number => Math.max(nominal, (1.5 * dist3(from, to)) / T.handSpeed);
  /** Legs through `pts` (read live each step: Fetch may be turning), each eased, with fixed durations (seconds); t from the first leg's start. */
  function alongLegs(pts: readonly Vec3[], dur: readonly number[], t: number): Vec3 {
    let u = t;
    for (let i = 0; i < dur.length; i++) {
      const d = dur[i] as number;
      if (u < d) return lerp3(pts[i] as Vec3, pts[i + 1] as Vec3, smooth(clamp01(u / Math.max(1e-9, d))));
      u -= d;
    }
    return pts[pts.length - 1] as Vec3;
  }
  const sum = (a: readonly number[]): number => a.reduce((p, q) => p + q, 0);
  /** A reach in progress (pickup, tap, stretch): where to, by what points, the legs' times (fixed at its start). */
  let reachLegs: { at: number; dur: number[]; over: boolean; back: boolean } | null = null;
  /** Points of a reach out to `to`: straight out to above it at `high` and down onto it, or straight to it. */
  const reachPts = (to: Vec3, high: number | null): Vec3[] => (high === null ? [home(), to] : [home(), [to[0], high, to[2]], to]);
  /** Start a reach now: legs timed from their nominal lengths and the hand's speed. */
  function startReach(now: number, to: Vec3, high: number | null, total: number): void {
    const pts = reachPts(to, high);
    const down = high === null ? 0 : Math.min(T.hands.down, total * 0.3);
    const nominal = high === null ? [total] : [total - down, down];
    reachLegs = { at: now, dur: nominal.map((n, i) => legTime(n, pts[i] as Vec3, pts[i + 1] as Vec3)), over: high !== null, back: false };
  }
  const reachLen = (): number => (reachLegs ? sum(reachLegs.dur) : 0);
  const reachGrip = (now: number, to: Vec3, high: number | null): Vec3 => (reachLegs ? alongLegs(reachPts(to, high), reachLegs.dur, (now - reachLegs.at) / HZ) : home());
  /** Bringing a part in: the claws close where it rests, then straight up, across above the hands (never down through what it sat on), into them. */
  function gatherPts(): Vec3[] {
    const g = gather as { from: Pose };
    const hand = home();
    const high = Math.max(g.from.p[1] + T.gatherLift, hand[1]);
    return [g.from.p, g.from.p, [g.from.p[0], high, g.from.p[2]], [hand[0], high, hand[2]], hand];
  }
  function gatherGrip(now: number): { p: Vec3; q: Quat } | null {
    if (!gather) return null;
    const t = (now - gather.at) / HZ;
    const total = sum(gather.dur);
    if (t >= total) {
      gather = null;
      return null;
    }
    const f = clamp01((t - T.hands.close) / Math.max(1e-9, total - T.hands.close));
    return { p: alongLegs(gatherPts(), gather.dur, t), q: nlerp(gather.from.q, handPose().q, smooth(f)) };
  }
  /** Start bringing in the part whose claws just closed at `from`. */
  function startGather(now: number, from: Pose): void {
    gather = { from, at: now, dur: [] };
    const pts = gatherPts();
    const rest = T.gather - T.hands.close;
    gather.dur = [T.hands.close, ...[0.25, 0.5, 0.25].map((f, i) => legTime(rest * f, pts[i + 1] as Vec3, pts[i + 2] as Vec3))];
  }
  /** Setting a part down: out over the drop, lowered onto it; held there one step before the claws open. */
  function placeGrip(now: number): { p: Vec3; q: Quat } | null {
    if (!placing || placing.let || !placing.from) return null;
    const [out, lower] = placing.dur;
    const t = (now - placing.out) / HZ;
    if (t <= out) {
      const f = smooth(clamp01(t / Math.max(1e-9, out)));
      return { p: lerp3(placing.from.p, placing.above.p, f), q: nlerp(placing.from.q, placing.to.q, f) };
    }
    return { p: lerp3(placing.above.p, placing.to.p, smooth(clamp01((t - out) / Math.max(1e-9, lower)))), q: placing.to.q };
  }
  function armBackGrip(now: number): Vec3 | null {
    if (!armBack) return null;
    const f = (now - armBack.at) / Math.max(1, steps(armBack.dur));
    if (f >= 1) {
      armBack = null;
      return null;
    }
    // eased out: the hands leave at once and slow into the carry pose (no lingering where they let go)
    return lerp3(armBack.from, home(), 1 - (1 - f) * (1 - f));
  }
  /** The hands go back to the carry pose from wherever they are now (no faster than the hand's speed). */
  const drawBack = (from: Vec3 | null, now: number, dur: number = T.hands.back): void => {
    armBack = from ? { from, at: now, dur: Math.max(dur, (2 * dist3(from, home())) / T.handSpeed) } : null; // eased out: it peaks at twice its mean
  };

  /** Let go of the crate in its hands (the visitor took Fetch, or a knock): it falls, its rest charged to `cause`. */
  function letGo(linvel: Vec3, angvel: Vec3, cause: Cause | null): Id | null {
    const c = carrying;
    if (!c) return null;
    carrying = null;
    gather = null;
    placing = null;
    armBack = null;
    hands = null;
    if (ctx.mode(c) === 'crew') ctx.detach(c, linvel, angvel, cause);
    return c;
  }

  // take hold of its own body and its crate
  ctx.crewFor(spec.id, {
    grabbed() {
      // caught in mid-flight: the flight is dropped; it is held like any other time (and goes over again if let go there)
      jet = null;
      heldLast = null;
      letGo([0, 0, 0], [0, 0, 0], 'crew');
      fumbled = null;
      goal = null;
      knock = null;
      hit = null;
      v = 0;
      lookAt = null;
      enter('held');
    },
    heldYaw() {
      // held up, it turns to face whoever has it (the visitor)
      const p = ctx.pose(spec.id);
      return p ? Math.atan2(spec.outward[0] - p.p[0], spec.outward[2] - p.p[2]) : null;
    },
    taken(part) {
      if (part !== carrying) return;
      carrying = null;
      gather = null;
      placing = null;
      goal = null;
      if (purpose === 'fumble') purpose = 'lap';
      v = 0;
      enter('salute');
    },
  });
  ctx.attach(spec.id, spec.id);
  ctx.drive(spec.id, bodyPose(), true);
  if (spec.carrying && ctx.attach(spec.carrying, spec.id)) {
    carrying = spec.carrying;
    ctx.drive(carrying, handPose(), true);
  }

  function rollTo(lanePos: number, why: Purpose): void {
    target = onPath(lanePos);
    rollDir = Math.sign(target - s) || 1;
    // R1: a short hop overshoots in proportion (a full overshoot and skid back on a 0.1 shuffle is dead air)
    runOvershoot = T.overshoot * Math.min(1, Math.abs(target - s) / (3 * T.overshoot));
    purpose = why;
    if (Math.abs(target - s) < 0.01) arrive();
    else enter('roll');
  }

  function arrive(): void {
    s = target;
    v = 0;
    const why = purpose;
    purpose = why === 'retrieve' ? 'retrieve' : 'lap';
    if (why === 'fumble') enter('fumble');
    else if (why === 'retrieve' || why === 'take' || why === 'collect') enter('pickup');
    else if (why === 'tap') enter('tap');
    else if (why === 'place') enter('place');
    else if (why === 'stretch') enter('reach');
    else {
      idleFor = steps(rng.range(T.idle[0], T.idle[1]));
      enter('idle');
    }
  }

  const toIdle = (): void => {
    idleFor = steps(rng.range(T.idle[0], T.idle[1]));
    enter('idle');
  };

  const fumbleDue = (): boolean =>
    carrying !== null &&
    !ctx.playMode &&
    ctx.idleSteps() >= steps(T.fumbleAfter) &&
    // S6: running attract mode's lap, it fumbles once, inside the first lap, and never again
    (lapOn() ? lastFumble === null && lap === 1 : lastFumble === null || ctx.clock.step - lastFumble >= steps(T.fumbleEvery));

  function roll(): void {
    const dt = 1 / HZ;
    const aim = Math.min(laneLen, Math.max(0, target + rollDir * runOvershoot));
    const toAim = aim - s;
    const stopping = (v * v) / (2 * T.brake);
    if (Math.sign(toAim) === Math.sign(v) && Math.abs(toAim) <= stopping) {
      v -= Math.sign(v) * T.brake * dt;
    } else {
      v += Math.sign(toAim) * T.accel * dt;
      v = Math.max(-T.maxSpeed, Math.min(T.maxSpeed, v));
    }
    // S5 round 2: a corner ahead: no faster than it can brake down to `cornerSpeed` by the time it gets there
    const cap = Math.min(cornerCap(s, Math.sign(v) || rollDir), cornerCap(s + v * dt, Math.sign(v) || rollDir));
    if (Math.abs(v) > cap) v = Math.sign(v) * cap;
    const nextS = s + v * dt;
    // past the aim, or stopped near it: skid back to the stop
    if ((v > 0 && nextS >= aim) || (v < 0 && nextS <= aim) || (Math.abs(v) < T.brake * dt && Math.abs(toAim) < 0.02)) {
      s = Math.min(laneLen, Math.max(0, aim));
      v = 0;
      if (Math.abs(s - target) < 0.005) arrive();
      else enter('skid');
      return;
    }
    s = nextS;
    // into the run, and round each corner: an eased turn to the way the path runs (never a snap, so a crate in its hands swings rather than jumps)
    // (round 3) leaving a stand at a path's very end it backs off before it turns, so its corners never swing
    // into whatever it stood nose-up to
    const nearEnd = Math.min(s, laneLen - s) < turnClear;
    if (Math.abs(v) > 0.01 && !nearEnd) turnToward(v > 0 ? pathYaw(s) : pathYaw(s) + Math.PI);
  }

  /** The fastest it may go at `s` moving in direction `sgn`: slow through a corner, braking down into it. */
  function cornerCap(sv: number, sgn: number): number {
    let cap: number = T.maxSpeed;
    for (const c of PATH.corners) {
      if (sv >= c.s0 && sv <= c.s1) cap = Math.min(cap, T.cornerSpeed);
      const ahead = sgn > 0 ? c.s0 - sv : sv - c.s1;
      if (ahead >= 0) cap = Math.min(cap, Math.sqrt(T.cornerSpeed * T.cornerSpeed + 2 * T.brake * ahead));
    }
    return cap;
  }
  /** Along its path, the closer of its two ways (forward or back) to where it faces now. */
  const alongPath = (): number => {
    const py = pathYaw(s);
    return Math.cos(heading - py) >= 0 ? py : py + Math.PI;
  };

  function skid(): void {
    const dt = 1 / HZ;
    const d = target - s;
    const step = Math.sign(d) * Math.min(Math.abs(d), Math.max(0.15, Math.min(1, Math.abs(d) * 6)) * T.skidBack * dt);
    s += step;
    // skidding backwards: heading unchanged, so the speed along it is negative
    v = step / dt;
    if (Math.abs(target - s) < 0.003) arrive();
  }

  function laneXZ(): void {
    [x, z] = at(s);
  }

  // ── its rounds (play mode) ──

  const horizontal = (a: Vec3, bx: number, bz: number): number => Math.hypot(a[0] - bx, a[2] - bz);
  /** A crate it may use (rule 5): a crate nobody has touched, lying still, not in any machine. */
  const fresh = (id: Id): boolean => {
    const p = ctx.part(id);
    return !!p && p.kind === 'crate' && !ctx.touched(id) && ctx.mode(id) === 'free' && ctx.settled(id) && p.location.at === 'rest';
  };
  /** The top fresh crate on the stack, if any. */
  function stackTop(): Id | null {
    if (!rounds) return null;
    let best: Id | null = null;
    let bestY = -Infinity;
    for (const id of ctx.parts()) {
      const p = ctx.pose(id);
      // a stack still settling (a fresh crate dropped on it, one knocked) is waited for: lifting from it would knock the rest about
      if (p && ctx.mode(id) === 'free' && !ctx.settled(id) && horizontal(p.p, rounds.stack[0], rounds.stack[1]) <= rounds.stackRadius * 2) return null;
      if (!fresh(id)) continue;
      if (!p || horizontal(p.p, rounds.stack[0], rounds.stack[1]) > rounds.stackRadius) continue;
      if (p.p[1] > bestY) [best, bestY] = [id, p.p[1]];
    }
    return best;
  }
  // ── S5 R1: the chute's pad, and the stack kept stocked from it ──

  /** How many crates stood on the stack at the start (what it is restocked to). */
  const stackStart = rounds ? ctx.scene.parts.filter((p) => p.kind === 'crate' && !p.shipped && Math.hypot(p.pose.p[0] - rounds.stack[0], p.pose.p[2] - rounds.stack[1]) <= rounds.stackRadius).length : 0;
  /** Crates standing on the stack now (lying there or in the visitor's hand over it; not the one in Fetch's). */
  function stackCount(): number {
    if (!rounds) return 0;
    return ctx.parts().filter((id) => {
      const m = ctx.mode(id);
      const p = ctx.pose(id)?.p;
      return ctx.part(id)?.kind === 'crate' && (m === 'free' || m === 'held') && !!p && horizontal(p, rounds.stack[0], rounds.stack[1]) <= rounds.stackRadius;
    }).length;
  }
  /** A fresh crate lying still on the pad, if any. */
  function padCrate(): Id | null {
    const pad = rounds?.pad;
    if (!pad) return null;
    for (const id of ctx.parts()) {
      const p = ctx.pose(id);
      if (fresh(id) && p && horizontal(p.p, pad[0], pad[1]) <= (rounds?.padRadius ?? 0.45)) return id;
    }
    return null;
  }
  /** A crate on the pad still coming to rest (the chute's just landed): wait for it rather than go to the stack. */
  function padSettling(): boolean {
    const pad = rounds?.pad;
    if (!pad) return false;
    return ctx.parts().some((id) => {
      const p = ctx.pose(id)?.p;
      const m = ctx.mode(id);
      return !!p && (m === 'machine' || (m === 'free' && !ctx.settled(id))) && ctx.part(id)?.kind === 'crate' && horizontal(p, pad[0], pad[1]) <= (rounds?.padRadius ?? 0.45) + 0.3;
    });
  }
  /** S5 R1: a plain crate shipped: its replacement is on its way to the pad until about this step. */
  let replacementDue = -Infinity;
  /** The stack comes first (both modes: the Button's rungs and the visitor's platen need it stocked): below its starting count, with a crate on the pad. */
  const restockDue = (): boolean => !!rounds?.pad && stackCount() < stackStart && padCrate() !== null;
  /** Where the crate it is fetching goes: the belt (its rounds, the lap), or the stack (restocking it from the pad). */
  let carryTo: 'belt' | 'stack' = 'belt';
  /** Set the crate in its hands on top of the stack. */
  function toStack(): void {
    if (!rounds) return;
    const [sx, sz] = rounds.stack;
    let top = ctx.scene.bench.top;
    for (const id of ctx.parts()) {
      const m = ctx.mode(id);
      const p = ctx.pose(id)?.p;
      if (id === carrying || !p || (m !== 'free' && m !== 'held') || horizontal(p, sx, sz) > rounds.stackRadius) continue;
      top = Math.max(top, p[1] + (ctx.halfExtents(id)?.[1] ?? 0.3));
    }
    placeAt = [sx, top, sz];
    rollTo(standS('stack', sx, sz), 'place');
  }
  /** Go for a crate to restock the stack with, or to feed the belt from: the pad's. */
  function takeFromPad(to: 'belt' | 'stack'): boolean {
    const c = padCrate();
    if (!c) return false;
    // out of reach and given up on a moment ago: never nag
    const p = ctx.pose(c) as Pose;
    const [lx, lz] = at(standS('pad', p.p[0], p.p[2]));
    if (Math.hypot(p.p[0] - lx, p.p[2] - lz) > R && ctx.clock.step < giveUpUntil) return false;
    carryTo = to;
    goFor(c, 'take');
    return true;
  }

  /** Crates in play: riding or being shipped, the one in its hands, and the one it has just let go of. */
  function inPlay(): number {
    if (!rounds) return 0;
    let n = 0;
    for (const id of ctx.parts()) {
      if (id === carrying) {
        n++;
        continue;
      }
      const l = ctx.part(id)?.location;
      if (l?.at === 'in' && rounds.inPlay.includes(l.mouth)) n++;
      else if (id === justPlaced && ctx.mode(id) === 'free' && !ctx.settled(id)) n++;
    }
    return n;
  }
  const drop = (): Vec3 | null => (rounds ? (ctx.mouth(rounds.mouth)?.drop ?? null) : null);
  const feeding = (): boolean => !!rounds && rounds.feedWhen.every((c) => ctx.setting(c.target, c.field) === c.is);
  function dropClear(): boolean {
    const d = drop();
    if (!d) return false;
    for (const id of ctx.parts()) {
      if (id === carrying || id === spec.id) continue;
      const m = ctx.mode(id);
      if (m === 'gone' || m === 'chute' || m === 'crew') continue;
      const p = ctx.pose(id);
      if (p && horizontal(p.p, d[0], d[2]) < T.dropClear + (ctx.halfExtents(id)?.[0] ?? 0.3) && p.p[1] < d[1] + 2) return false;
    }
    return true;
  }
  /** Go for a part: to the nearest point of its tape, then take it, or stretch for it if it is past reach. */
  function goFor(part: Id, why: 'retrieve' | 'take' | 'collect'): void {
    const p = ctx.pose(part);
    if (!p) return;
    goal = part;
    goalWhy = why;
    // where it stands: the scene's stand point for the stack (a crate on it) or the tray, else the nearest point
    const onStack = rounds !== null && Math.hypot(p.p[0] - rounds.stack[0], p.p[2] - rounds.stack[1]) <= rounds.stackRadius;
    const onPad = !!rounds?.pad && Math.hypot(p.p[0] - rounds.pad[0], p.p[2] - rounds.pad[1]) <= (rounds.padRadius ?? 0.45);
    const sl = why === 'collect' ? standS('tray', p.p[0], p.p[2]) : why === 'take' && onStack ? standS('stack', p.p[0], p.p[2]) : why === 'take' && onPad ? standS('pad', p.p[0], p.p[2]) : nearest(p.p[0], p.p[2]);
    const [lx, lz] = at(sl);
    rollTo(sl, Math.hypot(p.p[0] - lx, p.p[2] - lz) <= R ? why : 'stretch');
  }
  // ── S6: attract mode's lap (§ B3): stack → the platen's tray → tap the phone → Patch → collect → the belt ──

  const lapSpec = spec.attract ?? null;
  /** Can this scene run the lap at all (`canRunLap`: every place within reach of where it stands)? Else Fetch laps its lane as in P1. */
  let lapPossible: boolean | null = null;
  function lapReach(): boolean {
    if (lapPossible !== null) return lapPossible;
    lapPossible = !!deskOf(ctx) && canRunLap(ctx.scene, tuning).ok;
    return lapPossible;
  }
  const lapOn = (): boolean => !ctx.playMode && lapReach();
  let beat: AttractBeat = 'fetch-crate';
  let lap = 1;
  let lapFrom = ctx.clock.step;
  let beatFrom = ctx.clock.step;
  /** This lap's crate, its text's number on the line, and how far the lap has got. */
  let lapCrate: Id | null = null;
  let textN: number | null = null;
  let replied = false;
  let shippedLap = false;
  /** When the lap's crate shipped: the lap ends when the stack has its fresh crate, or (the stack full) a moment later. */
  let shippedAt = 0;
  function endLap(): void {
    laps.push({ lap, start: lapFrom / HZ, end: ctx.clock.step / HZ });
    lap += 1;
    lapFrom = ctx.clock.step;
    lapCrate = null;
    textN = null;
    replied = false;
    shippedLap = false;
    setBeat('fetch-crate');
  }
  const laps: { lap: number; start: number; end: number }[] = [];
  /** Where a crate is being set down: the tray's seat (null: the belt's drop, with the rounds' checks). */
  let placeAt: Vec3 | null = null;
  const setBeat = (b: AttractBeat): void => {
    if (b === beat) return;
    beat = b;
    beatFrom = ctx.clock.step;
    ctx.emit({ type: 'attract.beat', lap, beat: b });
  };
  const inMouth = (id: Id | null, mouth: Id): boolean => {
    const l = id ? ctx.part(id)?.location : undefined;
    return l?.at === 'in' && l.mouth === mouth;
  };
  const landing = (id: Id | null): boolean => !!id && ctx.mode(id) === 'free' && !ctx.settled(id);

  /** Idle in attract mode: the lap's next step. True if it set off. */
  function lapStep(): boolean {
    if (!lapSpec || !rounds) return false;
    const tray = ctx.mouth(lapSpec.tray);
    if (!tray) return false;
    switch (beat) {
      case 'fetch-crate': {
        if (carrying && carryTo === 'stack') {
          // S5 R1: restocking the stack from the pad comes first
          if (gather) return false;
          toStack();
          return true;
        }
        if (carrying) {
          lapCrate = carrying;
          setBeat('to-tray');
          return lapStep();
        }
        if (landing(lapCrate) || padSettling()) return false;
        if (restockDue() && takeFromPad('stack')) return true;
        carryTo = 'belt';
        // S5 R1: the lap's crate is the one the chute brought (the pad's); the stack's only when the pad is empty
        const top = lapCrate && fresh(lapCrate) ? lapCrate : (padCrate() ?? stackTop());
        if (!top) return false;
        // gave up on it a moment ago (out of reach): never nag
        const tp = ctx.pose(top);
        if (tp && ctx.clock.step < giveUpUntil) {
          const [lx, lz] = at(standS('stack', tp.p[0], tp.p[2]));
          if (Math.hypot(tp.p[0] - lx, tp.p[2] - lz) > R) return false;
        }
        lapCrate = top;
        goFor(top, 'take');
        return true;
      }
      case 'to-tray':
        if (!carrying) {
          if (inMouth(lapCrate, lapSpec.tray)) {
            setBeat('tap');
            return lapStep();
          }
          if (landing(lapCrate)) return false;
          setBeat('fetch-crate');
          return false;
        }
        placeAt = tray.drop;
        rollTo(standS('tray', tray.drop[0], tray.drop[2]), 'place');
        return true;
      case 'tap':
        if (textN !== null) {
          setBeat('patch');
          return false;
        }
        rollTo(standS('phone', lapSpec.phone[0], lapSpec.phone[2]), 'tap');
        return true;
      case 'patch':
        if (!replied) return false;
        setBeat('collect');
        return lapStep();
      case 'collect':
        if (carrying) {
          setBeat('to-belt');
          return lapStep();
        }
        if (lapCrate && inMouth(lapCrate, lapSpec.tray) && ctx.mode(lapCrate) === 'machine') {
          goFor(lapCrate, 'collect');
          return true;
        }
        setBeat('fetch-crate');
        return false;
      case 'to-belt': {
        if (!carrying) {
          if (lapCrate && rounds.inPlay.some((m) => inMouth(lapCrate, m))) setBeat('ride');
          else if (!landing(lapCrate)) setBeat('fetch-crate');
          return false;
        }
        const d = drop();
        if (!d || !feeding() || !dropClear()) return false;
        placeAt = null;
        rollTo(standS('feed', d[0], d[2]), 'place');
        return true;
      }
      case 'ride':
        // shipped and restocked: the lap is over (`heard`); a crate that came off the line some other way starts it again
        if (lapCrate && !shippedLap && ctx.part(lapCrate)?.location.at === 'rest' && !landing(lapCrate)) setBeat('fetch-crate');
        return false;
    }
  }

  /** Idle in play mode with its rounds: what next? True if it set off. */
  function nextJob(): boolean {
    if (!rounds) return false;
    const now = ctx.clock.step;
    // S6: the crate attract mode left on the platen's tray, if nobody has touched it: it finishes the job
    if (!carrying && lapSpec && lapCrate && inMouth(lapCrate, lapSpec.tray) && ctx.mode(lapCrate) === 'machine' && !ctx.touched(lapCrate)) {
      goFor(lapCrate, 'collect');
      return true;
    }
    if (carrying) {
      if (carryTo === 'stack') {
        if (gather) return false;
        toStack();
        return true;
      }
      if (!gather && feeding() && now - lastPlaced >= steps(rounds.every) && inPlay() <= rounds.cap && dropClear()) {
        const d = drop() as Vec3;
        rollTo(standS('feed', d[0], d[2]), 'place');
        return true;
      }
      return false;
    }
    // the crate it fumbled, if it is still there for the taking
    if (fumbled && fresh(fumbled)) {
      goFor(fumbled, 'retrieve');
      return true;
    }
    fumbled = null;
    // S5 R1: the stack first, from the pad; then the belt, from the pad, and from the stack only when the pad is empty
    if (restockDue() && takeFromPad('stack')) return true;
    if (inPlay() >= rounds.cap) return false;
    if (takeFromPad('belt')) return true;
    // the stack only when the pad's chain is broken: nothing coming (a crate riding or shipped brings its replacement to the
    // pad), so it does not empty the visitor's stock only to fill it again from the pad a moment later
    if (rounds.pad && (padSettling() || inPlay() > 0 || now < replacementDue)) return false;
    carryTo = 'belt';
    const top = stackTop();
    if (!top) return false;
    const p = ctx.pose(top) as Pose;
    const sl = standS('stack', p.p[0], p.p[2]);
    const [lx, lz] = at(sl);
    if (Math.hypot(p.p[0] - lx, p.p[2] - lz) > R && now < giveUpUntil) return false; // gave up on it a moment ago: never nag
    goFor(top, 'take');
    return true;
  }

  // ── knocked ──

  function beginKnock(h: NonNullable<typeof hit>): void {
    const st = h.strength as Strength;
    const i = st - 1;
    const want = (K.distance[i] as number) * k;
    const run = clearRun(x, z, h.dirX, h.dirZ, want, footprint, ctx.scene.bench, [...OBSTACLES, ...robotObstacles()]);
    const spin = h.spinSign * (K.spin[i] as number) * 2 * Math.PI;
    // what it carried falls, its rest charged to the throw (§ E5 rule 4)
    const cause = ctx.history.chargeMachine(h.by);
    const shoveSpeed = run / Math.max(1e-3, K.shove[i] as number);
    const dropped = letGo([h.dirX * shoveSpeed * 0.8, 1.2, h.dirZ * shoveSpeed * 0.8], [h.dirZ * 4, spin * 0.5, -h.dirX * 4], cause);
    if (dropped && isTxn(cause)) ctx.history.claim(dropped, cause, ctx.clock.step);
    goal = null;
    placing = null;
    gather = null;
    armBack = null;
    hands = null;
    v = 0;
    knock = { by: h.by, strength: st, dir: Math.atan2(h.dirX, h.dirZ), distance: run, spin, shove: K.shove[i] as number, wobble: K.wobble[i] as number, x0: x, z0: z, h0: heading, dx: h.dirX, dz: h.dirZ };
    // the toy's bounce, at the next step
    const u = h.speed;
    bounce = { id: h.by, dv: toyBounce([h.dirX, 0, h.dirZ], u, h.mass, selfMass, (selfE + (MATERIAL[ctx.part(h.by)?.material ?? 'wood'].restitution ?? 0.2)) / 2) };
    lookAt = null;
    ctx.emit({ type: 'crew.knocked', id: spec.id, by: h.by, strength: st, dir: knock.dir, distance: run, spin, dropped });
    enter('knocked');
  }

  /** Can it be knocked now? Not held, not in a machine, not frozen, not still recovering from the last one. */
  const knockable = (): boolean => state !== 'held' && state !== 'frozen' && state !== 'knocked' && state !== 'jetpack' && !ctx.bracketed && ctx.mode(spec.id) === 'crew';

  /** Read a step's hits: one involving Fetch (or the crate in its hands) and a free part. */
  /** Parts it shoved about itself while knocked (sliding into them): their bounce off it a moment later is not a throw. */
  const shovedByMe = new Map<Id, number>();
  function hear(events: readonly SimEvent[]): void {
    const now = ctx.clock.step;
    for (const [id, until] of shovedByMe) if (until < now) shovedByMe.delete(id);
    for (const e of events) {
      if (e.type !== 'part.hit' || e.other === null) continue;
      // sliding into things while knocked, or anything the part in its own hands bumps
      const mine = state === 'knocked' ? spec.id : carrying;
      if (mine !== null && (e.id === mine || e.other === mine)) shovedByMe.set(e.id === mine ? e.other : e.id, now + steps(1.5));
    }
    if (!knockable()) return;
    for (const e of events) {
      if (e.type !== 'part.hit' || e.other === null) continue;
      const mine = (id: Id): boolean => id === spec.id || (id === carrying && carrying !== null);
      const by = mine(e.id) ? e.other : mine(e.other) ? e.id : null;
      if (by === null || by === carrying || ctx.mode(by) !== 'free' || startedInside.has(by) || shovedByMe.has(by)) continue;
      const part = ctx.part(by);
      const half = ctx.halfExtents(by);
      const pose = ctx.pose(by);
      if (!part || !half || !pose) continue;
      const mass = massOf(half, part.material);
      // toward Fetch: from the part's centre to Fetch's
      let nx = x - pose.p[0];
      let nz = z - pose.p[2];
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      // how it was moving just before the hit (the step before this one); else from the impulse
      const m = motion.get(by);
      let vx = 0;
      let vz = 0;
      let speed: number;
      if (m && m.hist.length >= 2) {
        // the fastest it came at Fetch over the last few steps (the step of the hit itself already bounced)
        speed = -Infinity;
        for (const hv of m.hist) {
          const toward = hv[0] * nx + hv[2] * nz;
          if (toward > speed) [speed, vx, vz] = [toward, hv[0], hv[2]];
        }
      } else {
        speed = e.strength / (mass * (1 + MATERIAL[part.material].restitution));
        vx = nx * speed;
        vz = nz * speed;
      }
      const kind = classify(speed, mass * Math.max(0, speed));
      if (kind === 0) continue;
      // shoved along the way the part was going (its line through Fetch, if it was barely moving across)
      const hv = Math.hypot(vx, vz);
      const [dx, dz] = hv > 1e-3 ? [vx / hv, vz / hv] : [nx, nz];
      // spun by where it struck: the torque about Fetch's centre; a dead-centre hit spins it either way
      const rx = pose.p[0] - x;
      const rz = pose.p[2] - z;
      const torque = (rz * vx - rx * vz) / Math.max(1e-6, Math.hypot(rx, rz) * Math.max(hv, 1e-6));
      const spinSign = Math.abs(torque) > K.offCentre ? Math.sign(torque) : knockRng.chance(0.5) ? 1 : -1;
      const h = { by, strength: kind, dirX: dx, dirZ: dz, speed: Math.max(0, speed), mass, spinSign };
      // the hardest hit of the step wins
      const rank = (x: Strength | 'nudge'): number => (x === 'nudge' ? 0 : x);
      if (!hit || rank(h.strength) > rank(hit.strength)) hit = h;
    }
  }

  function knocked(): void {
    const kn = knock;
    if (!kn) {
      enter('return');
      return;
    }
    const t = inState() / HZ;
    const f = clamp01(t / kn.shove);
    // eased out: it leaves fast and slides to a stop
    const e = 1 - (1 - f) * (1 - f) * (1 - f);
    x = kn.x0 + kn.dx * kn.distance * e;
    z = kn.z0 + kn.dz * kn.distance * e;
    heading = kn.h0 + kn.spin * e;
    v = f < 1 ? (kn.distance / kn.shove) * 3 * (1 - f) * (1 - f) : 0;
    if (t >= kn.shove + kn.wobble) {
      heading = wrap(heading);
      knock = null;
      s = nearest(x, z);
      enter('return');
    }
  }

  // ── the jetpack ──

  /** The fixed bodies with their tops (what the cruise must clear). */
  const TALL: TallBody[] = (() => {
    const out: TallBody[] = [];
    for (const st of ctx.scene.statics) {
      if (st.shape.type !== 'box') continue;
      const o = BODIES.find((b) => b.id === st.id);
      if (o) out.push({ o, top: st.pose.p[1] + st.shape.half[1] });
    }
    return out;
  })();
  /** Its centre past the bench's edge: it is going over. */
  function overEdge(p: Vec3): boolean {
    const b = ctx.scene.bench;
    const outside = p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ;
    return outside; // (at any height: from here its fall is scripted, as physics would have it, and then a beat out of sight)
  }
  /** The nearest free point of its tape to (px, pz): nothing loose standing in its footprint there (else the next along). */
  function freeLanding(px: number, pz: number): number {
    const s0 = nearest(px, pz);
    const free = (sv: number): boolean => {
      const [lx, lz] = at(sv);
      return !ctx.parts().some((id) => {
        if (id === spec.id) return false;
        const m = ctx.mode(id);
        const p = ctx.pose(id)?.p;
        return !!p && (m === 'free' || m === 'machine') && p[1] < 2 && Math.hypot(p[0] - lx, p[2] - lz) < footprint + Math.max(...[0, 2].map((k) => ctx.halfExtents(id)?.[k] ?? 0.3));
      });
    };
    for (let k = 0; k <= 40; k++) {
      for (const sv of k === 0 ? [s0] : [s0 + k * 0.3, s0 - k * 0.3]) if (sv >= stopA && sv <= stopB && free(sv)) return sv;
    }
    return s0;
  }
  /** R4: nothing but `mine` stands on the seat at `d` (the tray's, the stack's top) within a crate's reach. */
  function seatClear(d: Vec3, mine: Id): boolean {
    return !ctx.parts().some((id) => {
      if (id === mine || id === spec.id) return false;
      const m = ctx.mode(id);
      const q = ctx.pose(id)?.p;
      if (!q || m === 'gone' || m === 'chute' || m === 'held') return false;
      // on the seat, not under it (the stack's lower crates hold the seat up)
      return Math.hypot(q[0] - d[0], q[2] - d[2]) < 0.6 && q[1] > d[1] && q[1] < d[1] + 1.2;
    });
  }
  /** R4: the up axis's height (1 upright, 0 on its side, -1 on its back). */
  const upOf = (q: Quat): number => 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  /** Its lowest point's height, lying as it lies. */
  function bottomOf(p: Pose): number {
    const [qx, qy, qz, qw] = p.q;
    const r10 = 2 * (qx * qy + qz * qw);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r12 = 2 * (qy * qz - qx * qw);
    return p.p[1] - (Math.abs(r10) * selfHalf[0] + Math.abs(r11) * selfHalf[1] + Math.abs(r12) * selfHalf[2]);
  }
  /**
   * R4: can it stand up where it came to rest? On the bench top (not up on something), its footprint clear of
   * every fixed body, of the other robots and of anything loose.
   */
  function standable(p: Pose): boolean {
    const b = ctx.scene.bench;
    if (bottomOf(p) > b.top + T.standOn) return false;
    const [px, , pz] = p.p;
    const r = Math.hypot(selfHalf[0], selfHalf[2]) - T.standSlack;
    if (px - r < b.minX || px + r > b.maxX || pz - r < b.minZ || pz + r > b.maxZ) return false;
    if ([...BODIES, ...robotObstacles()].some((o) => distanceTo(o, px, pz) < r)) return false;
    return !ctx.parts().some((id) => {
      if (id === spec.id) return false;
      const m = ctx.mode(id);
      const q = ctx.pose(id)?.p;
      if (!q || m === 'gone' || m === 'chute' || q[1] > b.top + 2) return false;
      const h = ctx.halfExtents(id) ?? [0.3, 0.3, 0.3];
      return Math.hypot(q[0] - px, q[2] - pz) < r + Math.min(h[0], h[2]);
    });
  }
  /** R4: up off whatever it came to rest on (or out from where it is wedged), on its jets, to the nearest free point of its tape. */
  function startHop(p: Pose): void {
    if (!ctx.attach(spec.id, spec.id)) return; // (a machine keeping it: the dock's door; it goes on through)
    letGo([0, 0, 0], [0, 0, 0], null);
    const landS = freeLanding(p.p[0], p.p[2]);
    const [lx, lz] = at(landS);
    const plan = planHop({ p0: p.p, v0: [0, 0, 0], land: [lx, lz], half: T.bodyHalfHeight, radius: Math.hypot(selfHalf[0], selfHalf[2]), bench: ctx.scene.bench, bodies: TALL, g: Math.abs(ctx.scene.gravity) });
    jet = { plan, q0: p.q, landS, phase: 'fall', cut: false };
    x = p.p[0];
    z = p.p[2];
    jetY = plan.stand;
    heading = yawOf(p.q);
    v = 0;
    shipped = false;
    flung = 0;
    enter('jetpack');
  }
  function startJet(p: Pose, last: Vec3 | null): void {
    const v0: Vec3 = last ? [(p.p[0] - last[0]) * HZ, (p.p[1] - last[1]) * HZ, (p.p[2] - last[2]) * HZ] : [0, 0, 0];
    ctx.attach(spec.id, spec.id); // out of physics: a scripted path from here (never carried by physics while it flies)
    letGo([0, 0, 0], [0, 0, 0], null); // (a crate in its hands falls by itself, and comes back by the edge's ordinary law)
    const landS = freeLanding(p.p[0], p.p[2]);
    const [lx, lz] = at(landS);
    const plan = planJet({ p0: p.p, v0, land: [lx, lz], half: T.bodyHalfHeight, radius: Math.hypot(selfHalf[0], selfHalf[2]), bench: ctx.scene.bench, bodies: TALL, g: Math.abs(ctx.scene.gravity) });
    jet = { plan, q0: p.q, landS, phase: 'fall', cut: false };
    x = p.p[0];
    z = p.p[2];
    jetY = p.p[1];
    heading = yawOf(p.q);
    v = 0;
    enter('jetpack');
  }
  /** Upright from the tumble it went over with, eased over the fall; then its heading. */
  function jetQ(): Quat {
    if (!jet) return qyaw(heading);
    const f = smooth(clamp01(inState() / HZ / 0.4));
    return f >= 1 ? qyaw(heading) : nlerp(jet.q0, qyaw(heading), f);
  }
  function flyJet(now: number): void {
    const j = jet;
    if (!j) {
      enter('return');
      return;
    }
    const a = jetAt(j.plan, inState() / HZ);
    if (a.phase !== j.phase) {
      if (a.phase === 'ignite') ctx.emit({ type: 'jet.ignited', id: spec.id, at: a.p });
      j.phase = a.phase;
    }
    if (a.cut && !j.cut) {
      j.cut = true;
      ctx.emit({ type: 'jet.cut', id: spec.id, at: a.p });
    }
    const dx = a.p[0] - x;
    const dz = a.p[2] - z;
    if (a.phase === 'cruise' && Math.hypot(dx, dz) > 1e-4) turnToward(Math.atan2(dx, dz));
    x = a.p[0];
    z = a.p[2];
    jetY = a.p[1];
    lookAt = a.phase === 'cruise' || a.phase === 'hover' || a.phase === 'land' ? j.plan.land : null;
    if (!a.done || ctx.bracketed) return;
    // down on its tape: where it came to rest is written as a rest would be (the same cause as a rest out of the chute)
    jet = null;
    s = j.landS;
    [x, z] = at(s);
    const cause = ctx.history.chargeReturn(spec.id, now);
    ctx.commit([{ target: spec.id, field: 'location', after: { at: 'rest', pose: { p: [x, T.bodyHalfHeight, z], q: qyaw(heading) } } }], cause);
    enter('return');
  }

  // ── what it watches ──

  function watch(): void {
    // S6: a part that started against it is heard again once it has come clear
    for (const id of [...startedInside]) if (ctx.mode(id) !== 'free' || gapToMe(id) > 0.04) startedInside.delete(id);
    // free parts' motion, for the next step's hits
    for (const id of ctx.parts()) {
      if (id === spec.id || ctx.mode(id) !== 'free') {
        motion.delete(id);
        continue;
      }
      const p = ctx.pose(id) as Pose;
      const m = motion.get(id);
      const nv: Vec3 = m ? [(p.p[0] - m.p[0]) * HZ, (p.p[1] - m.p[1]) * HZ, (p.p[2] - m.p[2]) * HZ] : [0, 0, 0];
      motion.set(id, { p: p.p, v: nv, hist: m ? [...m.hist.slice(-(HISTORY - 1)), nv] : [] });
    }
    // the eye: what the visitor carries, else the nearest thing on the move
    gaze = null;
    handsUp = false;
    const h = ctx.holding();
    if (h?.kind === 'part' && h.id !== spec.id) {
      const p = ctx.pose(h.id);
      if (p) {
        gaze = { at: p.p, what: 'held', id: h.id };
        const calm = state === 'idle' || state === 'offer' || state === 'roll' || state === 'skid' || state === 'salute' || state === 'shrug' || state === 'return';
        handsUp = calm && carrying === null && Math.hypot(p.p[0] - x, p.p[2] - z) <= T.handsUpNear;
      }
      handsUp = handsUp || shutIn;
      return;
    }
    handsUp = shutIn; // shut in on its way back: hands up at the visitor
    let best: number = T.gazeRange;
    for (const [id, m] of motion) {
      if (ctx.settled(id) || Math.hypot(m.v[0], m.v[1], m.v[2]) < 0.3) continue;
      const d = Math.hypot(m.p[0] - x, m.p[1] - T.handHeight, m.p[2] - z);
      if (d < best) [best, gaze] = [d, { at: m.p, what: 'moving', id }];
    }
  }

  const unit: FetchUnit = {
    id: spec.id,

    bracket(on) {
      if (on) {
        if (state === 'held') return; // cannot happen: the Button refuses presses while anything is held
        frozenFrom = { state, entered, at: ctx.clock.step };
        hit = null;
        bounce = null;
        const keep = reachLegs;
        enter('frozen');
        reachLegs = keep;
      } else if (frozenFrom) {
        const was = frozenFrom;
        frozenFrom = null;
        const shift = ctx.clock.step - was.at;
        const keep = reachLegs;
        enter(was.state);
        reachLegs = keep;
        // resume as if no time had passed in the frozen state
        entered = was.entered + shift;
        if (gather) gather = { ...gather, at: gather.at + shift };
        if (placing) placing = { ...placing, out: placing.out + shift };
        if (reachLegs) reachLegs = { ...reachLegs, at: reachLegs.at + shift };
        if (armBack) armBack = { ...armBack, at: armBack.at + shift };
      }
    },

    reset() {
      // "Reset the workshop": back to idle on its lane (what is in its hands stays there; the world leaves crew parts be)
      if (jet) {
        // mid-flight: down at once on its landing point
        s = jet.landS;
        [x, z] = at(s);
        jet = null;
      }
      goal = null;
      gather = null;
      placing = null;
      knock = null;
      hit = null;
      bounce = null;
      nudge = null;
      saluteDue = false;
      justPlaced = null;
      fumbled = null;
      giveUpUntil = -Infinity;
      lastPlaced = -Infinity;
      purpose = 'lap';
      v = 0;
      shrugThenReturn = false;
      if (state !== 'held' && state !== 'frozen') {
        if (ctx.mode(spec.id) === 'crew') {
          s = nearest(x, z);
          enter('return');
        }
      }
    },

    heard(events) {
      hear(events);
      if (lapSpec && !ctx.playMode)
        for (const e of events) {
          if ((e.type === 'line.reply' || e.type === 'line.refused') && e.n === textN) replied = true;
          if (e.type === 'shipped' && e.part === lapCrate) {
            shippedLap = true;
            shippedAt = ctx.clock.step;
          }
          // the lap is over: the crate shipped and the stack has its fresh one
          if (e.type === 'restocked' && shippedLap) endLap();
        }
      // (or the stack was full, and the dock kept its spare: the time a restock takes, and a little)
      if (lapSpec && !ctx.playMode && shippedLap && ctx.clock.step - shippedAt > steps(LAP_RESTOCK_WAIT)) endLap();
      if (!rounds) return;
      for (const e of events) {
        // the visitor did its job for it: a crate of theirs taken in by the belt while it is empty-handed
        if (e.type === 'taken-in' && e.mouth === rounds.mouth && e.part !== justPlaced && ctx.touched(e.part)) saluteDue = true;
        if (e.type === 'taken-in' && e.part === justPlaced) justPlaced = null;
        // S5 R1: a crate shipped: the chute will throw its replacement onto the pad (the restock, then the flight)
        if (e.type === 'shipped' && ctx.part(e.part)?.kind === 'crate' && rounds.pad) replacementDue = ctx.clock.step + steps(5);
        if (e.type === 'restocked') replacementDue = -Infinity;
      }
    },

    pre() {
      if (state === 'frozen') return;
      startsInside();
      const now = ctx.clock.step;
      lookAt = null;
      /** The grip this step, if a state puts its hands somewhere (else the gather, the set-down or the ease back decides). */
      let grip: Vec3 | null = null;
      let gripQ: Quat | null = null;
      let tapped = false;
      const mode = ctx.mode(spec.id);

      if (bounce) {
        if (ctx.mode(bounce.id) === 'free') ctx.shove(bounce.id, bounce.dv);
        bounce = null;
      }

      if (state === 'held') {
        hit = null;
        saluteDue = false;
        hands = null;
        armBack = null;
        // over the bench's edge (thrown, dropped or let go past it): it falls a beat, then flies back on its jetpack
        const pNow = ctx.pose(spec.id);
        // (not while a Button rung plays: physics runs free then, the rung is rewound, and nothing commits)
        if (mode === 'free' && pNow && !ctx.bracketed && overEdge(pNow.p)) {
          startJet(pNow, heldLast);
          heldLast = null;
          return;
        }
        const speedNow = mode === 'free' && pNow && heldLast ? Math.hypot(pNow.p[0] - heldLast[0], pNow.p[1] - heldLast[1], pNow.p[2] - heldLast[2]) * HZ : Infinity;
        if (mode === 'free' && pNow && heldLast) flung = Math.max(flung, Math.hypot(pNow.p[0] - heldLast[0], pNow.p[2] - heldLast[2]) * HZ);
        if (mode === 'free' || mode === 'held') arrivedFlung = mode === 'free' && flung > T.shakeAfter;
        if (mode !== 'free') flung = 0;
        // R4: never settled (rocking where it is wedged, creeping): after `stuckAfter` loose and slow, it gets up anyway
        slowFor = mode === 'free' && speedNow < T.stuckSpeed ? slowFor + 1 : 0;
        // R4: held still in a machine that does not carry it on (the platen's tray; a stopped belt): it hops off
        const still = mode === 'machine' && pNow && machineLast ? Math.hypot(pNow.p[0] - machineLast[0], pNow.p[1] - machineLast[1], pNow.p[2] - machineLast[2]) < 0.002 : false;
        machineStill = still ? machineStill + 1 : 0;
        machineLast = mode === 'machine' && pNow ? pNow.p : null;
        if (machineStill >= steps(arrivedFlung ? T.leaveMachine : T.leaveMachineSet) && pNow && !ctx.bracketed) {
          machineStill = 0;
          machineLast = null;
          startHop(pNow);
          return;
        }
        heldLast = mode === 'free' && pNow ? pNow.p : null;
        if (ctx.part(spec.id)?.location.at === 'shipped') shipped = true;
        // put down: once it has come to rest, it rights itself and hurries back to its lane
        if (mode === 'free' && (ctx.settled(spec.id) || slowFor >= steps(T.stuckAfter))) {
          slowFor = 0;
          const p = ctx.pose(spec.id);
          // R4: where it came down it cannot stand (up on a crate, the stack or the tray; against a body): it hops
          // off on its jets to the nearest free point of its tape (not while a rung plays: it waits)
          if (p && !standable(p)) {
            if (!ctx.bracketed) startHop(p);
            return;
          }
          const tipped = !!p && upOf(p.q) < 0.9;
          if (p) {
            x = p.p[0];
            z = p.p[2];
            heading = yawOf(p.q);
          }
          ctx.attach(spec.id, spec.id);
          ctx.drive(spec.id, bodyPose(), true);
          s = nearest(x, z);
          // shipped and thrown home, on its back or side, or thrown hard: it shakes itself off first (R2, R4)
          const shake = shipped || tipped || flung > T.shakeAfter;
          shipped = false;
          flung = 0;
          if (shake) {
            shrugThenReturn = true;
            enter('shrug');
          } else enter('return');
        }
        return;
      }

      // a hit heard last step: a knock, or a look
      if (hit) {
        const h = hit;
        hit = null;
        if (knockable() && ctx.mode(h.by) !== undefined) {
          if (h.strength === 'nudge') {
            nudge = { id: h.by, until: now + steps(K.nudgeLook) };
            ctx.emit({ type: 'crew.nudged', id: spec.id, by: h.by });
          } else beginKnock(h);
        }
      }

      // on its rounds, the crate in its hands became the visitor's (changed by them, by text): it is theirs now
      // (rule 5), so it sets it down where it is, the rest charged to the change (rule 4: its consequence)
      if (rounds && carrying && ctx.touched(carrying) && ctx.playMode) {
        const c = carrying;
        let by: Cause = 'system';
        for (const f of ['colour', 'label', 'marks', 'contents', 'location']) {
          const wr = ctx.writer(c, f);
          if (wr && wr !== 'crew' && wr !== 'system' && wr !== 'settled' && (by === 'system' || Number(wr.slice(1)) > Number(by.slice(1)))) by = wr;
        }
        letGo([0, 0, 0], [0, 0, 0], by);
        if (isTxn(by)) ctx.history.claim(c, by, now);
      }

      if (saluteDue) {
        saluteDue = false;
        const busy = carrying !== null || state === 'knocked' || state === 'return' || state === 'fumble' || state === 'offer' || state === 'place' || state === 'reach';
        if (!busy && ctx.playMode) {
          goal = null;
          purpose = 'lap';
          v = 0;
          lastPlaced = now; // it counts as a crate set down: the pace starts again
          enter('salute');
        }
      }

      switch (state) {
        case 'idle': {
          // set down, back on its path, or after a job: square up to the path, the shorter way (a job below may turn it otherwise)
          if (!carrying || !(rounds && ctx.playMode)) turnToward(alongPath());
          if (fumbleDue()) {
            rollTo(spec.fumbleAt * laneLen, 'fumble');
            break;
          }
          if (rounds && ctx.playMode) {
            // its rounds: a job if there is one; otherwise it waits where it is, facing the belt with its load: but not
            // near the stack (S5 R1: at the tray's stand that turn swung the crate in its hands through the stack)
            if (inState() >= Math.min(idleFor, steps(0.4)) && nextJob()) break;
            const d = drop();
            const nearStack = Math.hypot(x - rounds.stack[0], z - rounds.stack[1]) < R + 1;
            if (carrying && d && !nearStack) turnToward(yawTo(d));
            else if (carrying) turnToward(alongPath());
            else if (rounds.pad && inState() >= Math.min(idleFor, steps(0.4))) {
              // S5 R1: empty-handed with nothing to do, it waits at the pad's stand (the tape's left end), facing the pad
              // where its next crate lands: not at the feed, where from the camera it stands in front of the UNDO plate
              const pad = rounds.pad;
              const home = standS('pad', pad[0], pad[1]);
              if (Math.abs(s - home) > 0.02) {
                rollTo(home, 'lap');
                break;
              }
              lookAt = [pad[0], T.handHeight, pad[1]];
              turnToward(Math.atan2(pad[0] - x, pad[1] - z));
            }
            break;
          }
          if (lapOn()) {
            // S6: attract mode's lap
            if (inState() >= Math.min(idleFor, steps(0.3)) && lapStep()) break;
            if (beat === 'patch' && lapSpec) lookAt = ctx.mouth(lapSpec.tray)?.drop ?? null;
            if (beat === 'ride' && lapCrate) lookAt = ctx.pose(lapCrate)?.p ?? null;
            break;
          }
          if (inState() >= idleFor) rollTo(Math.abs(s - stopA) < Math.abs(s - stopB) ? stopB : stopA, 'lap');
          break;
        }
        case 'roll':
          if ((purpose === 'lap' || (purpose === 'place' && lapOn())) && fumbleDue()) {
            // change of plan mid-run: head for the fumble mark (turning round if it is behind)
            target = clampLane(spec.fumbleAt * laneLen);
            rollDir = Math.sign(target - s) || rollDir;
            purpose = 'fumble';
          }
          if ((purpose === 'take' || purpose === 'retrieve' || purpose === 'stretch') && (goal === null || ctx.mode(goal) !== 'free' || ctx.touched(goal))) purpose = 'lap'; // gone from under its nose
          if (purpose === 'collect' && (goal === null || ctx.mode(goal) !== 'machine' || ctx.touched(goal))) purpose = 'lap';
          roll();
          laneXZ();
          break;
        case 'skid':
          skid();
          laneXZ();
          break;
        case 'fumble': {
          v = 0;
          // turn to the fumble heading during the wind-up (shortest way), so the toss is the same whichever way it came
          if (carrying) {
            const left = Math.max(1, steps(T.fumbleWindup) - inState());
            const d = Math.atan2(Math.sin(spec.fumbleHeading - heading), Math.cos(spec.fumbleHeading - heading));
            heading += d / left;
          }
          if (carrying && inState() >= steps(T.fumbleWindup)) {
            heading = spec.fumbleHeading;
            const crate = carrying;
            carrying = null;
            fumbled = crate;
            lastFumble = ctx.clock.step;
            ctx.detach(crate, spec.toss.linvel, spec.toss.angvel, 'crew');
          }
          if (fumbled) {
            lookAt = ctx.pose(fumbled)?.p ?? null;
            // after letting go, turn to face the visitor for the offer
            const left = Math.max(1, steps(T.fumbleWindup + T.fumbleRecover) - inState());
            heading += Math.atan2(Math.sin(spec.offerHeading - heading), Math.cos(spec.offerHeading - heading)) / left;
          }
          if (inState() >= steps(T.fumbleWindup + T.fumbleRecover)) {
            if (fumbled) heading = spec.offerHeading;
            enter(fumbled ? 'offer' : 'idle');
          }
          break;
        }
        case 'offer': {
          if (!fumbled || ctx.touched(fumbled) || ctx.mode(fumbled) !== 'free') {
            fumbled = null;
            toIdle();
            break;
          }
          lookAt = inState() < steps(T.offerLook) ? (ctx.pose(fumbled)?.p ?? null) : spec.outward;
          // R1: never from under a hand reaching for it: the pointer on the crate holds the offer (to `offerHeldFor`)
          const reachedFor = ctx.hovered() === fumbled && inState() < steps(T.offerHeldFor);
          if (inState() >= steps(T.ignoredFor) && !reachedFor && ctx.settled(fumbled)) goFor(fumbled, 'retrieve');
          break;
        }
        case 'pickup': {
          const g = goal;
          if (g && !carrying) {
            const p = ctx.pose(g);
            if (p) {
              lookAt = p.p;
              turnToward(yawTo(p.p));
              // out to it: pulled back, over it, then down onto its centre (no faster than the hand's speed)
              const high = Math.max(p.p[1] + T.gatherLift, home()[1]);
              if (!reachLegs) startReach(now, p.p, high, T.pickup);
              grip = reachGrip(now, p.p, high);
            }
            if (p && reachLegs && now - reachLegs.at < Math.round(reachLen() * HZ)) break;
            goal = null;
            if (g === fumbled) fumbled = null;
            // (S6) collecting from the platen's tray: the crate is in the platen's hands until Fetch takes it
            const takeable = goalWhy === 'collect' ? ctx.mode(g) === 'machine' : ctx.mode(g) === 'free' && ctx.settled(g);
            const ok = p && !ctx.touched(g) && takeable && Math.hypot(p.p[0] - x, p.p[2] - z) <= R;
            if (ok && ctx.attach(g, spec.id)) {
              // the claws close where it rests
              carrying = g;
              startGather(now, p);
              grip = p.p;
              gripQ = p.q;
              break;
            }
            drawBack(grip, now);
            if (p && Math.hypot(p.p[0] - x, p.p[2] - z) > R && !ctx.touched(g)) {
              // it moved out of reach while it rolled up: say so
              ctx.emit({ type: 'card', by: spec.id, content: 'slip.out-of-lane' });
              giveUpUntil = now + steps(T.giveUpFor);
            }
            enter('shrug');
            break;
          }
          if (gather) {
            // the crate coming into its hands: it turns back to its path as the crate comes in (over the top of what it
            // sat on), so the hands come down beside it, not into whatever is left there
            turnToward(alongPath());
            break;
          }
          purpose = 'lap';
          if (goalWhy === 'retrieve' || !carrying) enter('shrug');
          else toIdle();
          break;
        }
        case 'reach': {
          // stretching for something past its tape; then it gives up and says so (§ B5)
          const g = goal;
          const p = g ? ctx.pose(g) : undefined;
          if (p) {
            lookAt = p.p;
            turnToward(yawTo(p.p));
            // its hands go out as far as they go toward it, hold there, and come back
            const tip = inReach(p.p);
            if (!reachLegs) startReach(now, tip, null, T.hands.stretchOut);
            if (reachLegs && !reachLegs.back) {
              if ((now - reachLegs.at) / HZ < Math.max(T.stretch - T.hands.back, reachLen() + 0.1)) grip = reachGrip(now, tip, null);
              else {
                drawBack(hands ?? tip, now);
                reachLegs.back = true;
              }
            }
          }
          if (inState() >= steps(T.stretch) && armBack === null) {
            if (g && g === fumbled) fumbled = null;
            goal = null;
            giveUpUntil = now + steps(T.giveUpFor);
            ctx.emit({ type: 'card', by: spec.id, content: 'slip.out-of-lane' });
            enter('shrug');
          }
          break;
        }
        case 'tap': {
          // S6: attract mode: it reaches out and taps the phone; the crew's text goes down the line
          v = 0;
          const phone = lapSpec?.phone;
          if (phone) {
            lookAt = phone;
            turnToward(yawTo(phone));
            // a finger out to the phone, the tap (as it arrives), and back
            const tip = inReach(phone);
            if (!reachLegs) startReach(now, tip, null, TAP.at);
            if (reachLegs && !reachLegs.back) {
              grip = reachGrip(now, tip, null);
              if (now - reachLegs.at >= Math.round(reachLen() * HZ)) {
                drawBack(tip, now, TAP.length - TAP.at);
                reachLegs.back = true;
                tapped = true;
              }
            }
          }
          if (tapped && lapSpec && textN === null) {
            const n = deskOf(ctx)?.crewText(lapSpec.say, lapSpec.words, lapSpec.jack) ?? null;
            textN = n ?? -1;
            if (n === null) replied = true; // the line would not take it: on with the lap
          }
          if (inState() >= steps(TAP.length) && armBack === null) toIdle();
          break;
        }
        case 'place': {
          const d = placeAt ?? drop();
          if ((!carrying && !placing?.let) || !d || !rounds) {
            placing = null;
            toIdle();
            break;
          }
          if (!placing && carrying) {
            const half = ctx.halfExtents(carrying) ?? [0.3, 0.3, 0.3];
            const to: Pose = { p: [d[0], d[1] + half[1] + 0.005, d[2]], q: qyaw(0) };
            placing = { to, above: { p: [d[0], d[1] + half[1] + T.placeLift, d[2]], q: to.q }, from: null, out: -1, let: false, dur: [T.place.out, T.place.lower] };
          }
          if (!placing) break;
          // R4: a set-down on the tray (not the belt: the rounds check its drop) never onto something already there (a
          // crate thrown onto it while Fetch reached out): it keeps the crate and its rounds find it another place
          if (placeAt !== null && !placing.let && carrying && !seatClear(placeAt, carrying)) {
            placing = null;
            placeAt = null;
            toIdle();
            break;
          }
          lookAt = placing.to.p;
          const t = inState();
          if (!placing.from) {
            turnToward(yawTo(placing.to.p));
            if (t < steps(T.place.turn)) break;
            // last look before reaching out: the belt still running forward, the drop still clear (the belt only)
            if (placeAt === null && (!feeding() || !dropClear() || inPlay() > rounds.cap)) {
              placing = null;
              toIdle();
              break;
            }
            placing.from = handPose();
            placing.out = now;
            placing.dur = [legTime(T.place.out, placing.from.p, placing.above.p), legTime(T.place.lower, placing.above.p, placing.to.p)];
            break;
          }
          const sinceOut = now - placing.out;
          // the claws open the step after the part reached its place (it is there, still): nothing moves it after
          if (!placing.let && carrying && sinceOut > Math.round((placing.dur[0] + placing.dur[1]) * HZ)) {
            const c = carrying;
            ctx.detach(c, [0, 0, 0], [0, 0, 0], 'crew');
            drawBack(placing.to.p, now, T.hands.backAfterPlace);
            carrying = null;
            placing.let = true;
            lastPlaced = now;
            justPlaced = c;
          }
          if (placing.let && armBack === null) {
            placing = null;
            placeAt = null;
            toIdle();
            // S5 R1: on its rounds it leaves the feed at once (back to the pad's stand to wait, or on to the next job)
            if (ctx.playMode && rounds.pad) idleFor = 0;
          }
          break;
        }
        case 'knocked':
          knocked();
          break;
        case 'jetpack':
          flyJet(now);
          break;
        case 'shrug':
          if (inState() >= steps(T.shrug) && shrugThenReturn) {
            shrugThenReturn = false;
            enter('return');
          } else if (inState() >= steps(T.shrug)) {
            toIdle();
            // R1: crate back in hand, it gets straight back to work (no pause after the shrug)
            if (carrying) idleFor = 0;
          }
          break;
        case 'salute':
          if (inState() >= steps(T.salute)) toIdle();
          break;
        case 'return': {
          // S5 round 3: a route back, round whatever fixed body stands between (`fetch-route.ts`); shut in, it
          // stays, looks at the visitor with its hands up, and tries again every few seconds
          if (way === null && now >= wayRetry) {
            way = route([x, z], at(s), footprint, BODIES, ctx.scene.bench);
            if (way === null) wayRetry = now + steps(T.routeRetry);
          }
          if (way === null) {
            v = 0;
            shutIn = true;
            lookAt = spec.outward;
            turnToward(Math.atan2(spec.outward[0] - x, spec.outward[2] - z));
            break;
          }
          shutIn = false;
          const [tx, tz] = way[0] as Pt;
          const dx = tx - x;
          const dz = tz - z;
          const d = Math.hypot(dx, dz);
          const stepLen = T.returnSpeed / HZ;
          if (d <= stepLen) {
            x = tx;
            z = tz;
            way.shift();
            if (way.length > 0) break;
            way = null;
            v = 0;
            toIdle(); // it turns to its path in idle, the shorter way
          } else {
            x += (dx / d) * stepLen;
            z += (dz / d) * stepLen;
            // the shorter way round: it may hurry back rolling backwards rather than turn half a circle
            const way = Math.atan2(dx, dz);
            const fwd = Math.cos(heading - way) >= 0;
            turnToward(fwd ? way : way + Math.PI);
            v = fwd ? T.returnSpeed : -T.returnSpeed;
          }
          break;
        }
      }

      if (nudge && lookAt === null) {
        if (now < nudge.until && ctx.pose(nudge.id)) lookAt = ctx.pose(nudge.id)?.p ?? null;
        else nudge = null;
      }
      if (state === 'idle' || state === 'shrug' || state === 'salute' || state === 'fumble' || state === 'offer' || state === 'pickup' || state === 'place' || state === 'reach' || state === 'tap') v = 0;
      // the grip: a state's own, else bringing a part in, setting one down, or easing back to the carry pose
      if (!grip && carrying) {
        const g = gatherGrip(now) ?? placeGrip(now);
        if (g) [grip, gripQ] = [g.p, g.q];
      }
      if (!grip) grip = armBackGrip(now);
      if (state === 'knocked') grip = null;
      hands = grip ? inReach(grip) : null;
      if (ctx.mode(spec.id) === 'crew') ctx.drive(spec.id, bodyPose());
      if (carrying) ctx.drive(carrying, hands ? { p: hands, q: gripQ ?? handPose().q } : handPose());
    },

    post() {
      if (state === 'frozen') return;
      watch();
    },

    crewView: () => ({ kind: 'fetch', id: spec.id, body: spec.id, member: unit.member() }),

    attract(): AttractView {
      const now = ctx.clock.step;
      return {
        on: lapOn(),
        lap,
        beat,
        beatTime: (now - beatFrom) / HZ,
        lapTime: (now - lapFrom) / HZ,
        crate: lapCrate,
        text: textN !== null && textN > 0 ? textN : null,
        laps,
        timeline: ATTRACT_TIMELINE,
      };
    },

    member(): CrewMember {
      const facing = Math.cos(heading - pathYaw(s)) >= 0 ? 1 : -1;
      const speed = state === 'return' || state === 'knocked' ? v : v * facing;
      const kn: FetchKnock | null = knock && state === 'knocked' ? { by: knock.by, strength: knock.strength, dir: knock.dir, distance: knock.distance, spin: knock.spin, shove: knock.shove, wobble: knock.wobble } : null;
      let jv: CrewMember['jet'] = null;
      if (jet && state === 'jetpack') {
        const a = jetAt(jet.plan, inState() / HZ);
        jv = { phase: a.phase, phaseTime: a.phaseTime, phaseLength: a.phaseLength, thrust: a.thrust, from: [jet.plan.out[0], jet.plan.deep, jet.plan.out[1]], to: jet.plan.land };
      }
      return { id: spec.id, state, stateTime: inState() / HZ, x, z, heading, speed, carrying, lookAt, gaze, handsUp, knock: kn, hands, jet: jv };
    },
  };
  return unit;
}
