/**
 * Patch, the operator (REWRITE.md § B5 "Patch", § D 3, § D 13, § E5 rule 10
 * and its worked example "pulls the lever while Patch is still reaching for
 * the drawer"; § F3). On its stool at the switchboard; it never walks the
 * bench except to get back to the stool.
 *
 * The job, in stages the view performs (`PatchView.state`), each a fixed
 * time on the simulation clock except the roll (the real thing takes about
 * a minute; the hatch says the toy is sped up, § F3). Free and already at
 * that jack, the change shows 2.6 s after the text and the reply comes at
 * 4.5 s (S6; the view time-scales its performances to `stateLength`):
 *   notice  0.5 s   turns to the board: the line's lamp is lit;
 *   roll    0-1.2 s the stool rolls along its runner to that jack (S6: by
 *                   distance, 1.2 s for the whole runner; skipped when it
 *                   is already there). `PatchView.stool` is where;
 *   drawer  0.8 s   pulls open the drawer for THAT jack (one folder per line);
 *   work    1.3 s   does it; at the end of this stage the change commits
 *                   (the desk's `perform`, sim/machines/line.ts);
 *   check   1.1 s   leans out toward the station to see it is really there;
 *   reply   0.8 s   texts back (the desk's `finish`: the reply is checked
 *                   against the durable state as it is sent).
 * When the line has been quiet for `PatchSpec.runner.quiet` seconds it rolls
 * back to its rest place at the runner's right end (state `roll` again).
 * Nothing durable is Patch's: it never commits anything itself except where
 * a part it caught comes to rest (charged to the throw).
 *
 * With the visitor (each reaction at most 1.5 s, § B5):
 * - the plug pulled mid-job: the job is dropped (nothing written); Patch
 *   looks at the dead plug (`stare`), then at the visitor (`look`);
 * - the lever pulled while it works: the job is dropped (rule 10); Patch
 *   looks at the lever;
 * - lifted off the stool (`drag` intents with its id): it hangs (`held`);
 *   put down anywhere it walks back (`walk`) and climbs up (`climb`). A job
 *   in hand waits and carries on where it was; texts wait meanwhile;
 * - let go of past an open edge of the bench, or flung over one (R1): it
 *   catches the edge and hangs from it (`ledge` 1.6 s), hauls itself up
 *   (`haul` 0.7 s), dusts itself off (`dust` 0.5 s), gives the visitor the
 *   look, and walks back. It is never carried by physics and nothing is
 *   charged; it cannot be taken hold of again until it is on its feet;
 * - a part thrown at it gets one of three answers, chosen by where the part
 *   is going: high (at its head) it ducks; at its hands, and small enough
 *   and slow enough, it catches it and sets it down on the shelf beside the
 *   board (the rest charged to the throw, rule 4); otherwise it takes it on
 *   the head (`bonk`: the part bounces off; Patch gives it the look). Patch
 *   is never moved by physics and never hurt.
 */
import type { Cause, Id, Intent, Outcome, PatchAnswer, PatchState, PatchView, Pose, SimEvent, StationId, Vec3 } from '../types.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { Job } from '../history.ts';
import type { UnitFactory } from '../scene.ts';
import type { Call } from '../machines/line.ts';
import { deskOf } from '../machines/line.ts';
import { boardOf } from '../machines/shared/patchlamp.ts';
import { HZ, steps } from '../clock.ts';
import { add, dist, dot, length, scale, sub } from '../math.ts';
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo, obstacles } from './fetch-knock.ts';
import { bodiesOf, legClear } from './fetch-route.ts';
import type { Pt } from './fetch-route.ts';
import { PATCH_ROUTE, clearPoint, crossPoints, offTop, planWay, solidsOf, sphereMeets, stepClear } from './patch-route.ts';
import type { BeltCrossing, Solid, Way } from './patch-route.ts';
import { embodyPatch } from './patch-body.ts';
import { floatPull as pullAt, floatWeight, inFloat as floating } from './patch-float.ts';

/** Seconds, units, units per second. Tune here. */
export const PATCH_TUNING = {
  /** The job's stages (§ B5), in order (S6: a little more air; the change shows at 2.6 s, the reply at 4.5 s). */
  notice: 0.5,
  drawer: 0.8,
  work: 1.3,
  check: 1.1,
  reply: 0.8,
  /** S6: the stool rolls the whole runner in this long; a shorter roll takes its share (none at all when it is there). */
  rollWhole: 1.2,
  /** S6: moving the cord to another jack (attract mode: the crew's text is for a line the cord is not in). */
  plug: 0.8,
  /** The dead plug, then the visitor (together at most 1.5 s, § B5). */
  stare: 0.6,
  look: 0.9,
  /** The look at the lever. */
  lever: 1.2,
  duck: 0.9,
  /** Catch: holds it up this long, then sets it on the shelf over `catchSet`. */
  catchHold: 0.55,
  catchSet: 0.45,
  bonk: 1.2,
  /** How far ahead it sees a part coming (s), and how soon before the part arrives it reacts. */
  horizon: 0.6,
  lead: 0.3,
  /** It catches only a part this slow (units/s) and not large. */
  catchMax: 6,
  /** A throw is watched this long after it leaves the hand. */
  watch: 2.5,
  /** Slower than this on release is not a throw. */
  throwMin: 1.2,
  /** How much speed a part keeps bouncing off its head. */
  bounce: 0.45,
  /** Walking back to the stool, and climbing up. */
  walk: 1.6,
  climb: 0.8,
  /** R1: off the edge: it hangs from the edge, hauls itself up, dusts itself off (then the look, and the walk back). */
  ledge: 1.6,
  haul: 0.7,
  dust: 0.5,
  /** Where it stands once up: this far in from the edge. */
  ledgeIn: 0.35,
  /** A release carries on the hand's travel for this long (s) when deciding whether it went over an edge (a fling). */
  fling: 0.25,
  /** R2: only a hand moving at least this fast (units/s) as it lets go has flung Patch (a carry is not a throw). */
  flingMin: 6,
  /** R2: before the first step: a look at the visitor, then it turns to face its way (s). */
  setOff: 0.6,
  /** R2: a walk longer than this (units) is a scamper, at `scamper` units/s. */
  scamperOver: 4,
  scamper: 3.0,
  /** R2: out of Fetch's way, a dash (units/s): Fetch drives its rounds and does not look out for Patch. */
  dash: 5.5,
  /** R2: stopped by something that moves (Fetch, a crate) or shut in: it tries a new way this often (s). */
  retry: 0.6,
  /** R2: across the belt: up onto the rail, two steps across (carried by the belt), down the far side (s). */
  crossOn: 0.25,
  crossOver: 0.45,
  crossOff: 0.25,
  /** R4: let go with the hand moving at least this fast (units/s), it is thrown; slower is a set-down. */
  throwAt: 1.5,
  /**
   * R4: the most a throw can send it at (units/s, the hand's level speed): the parts' base cap (S5: 14, scaled
   * down by mass; Patch is light and soft, so it gets the whole of it: it flies at least as far as a small crate).
   * The hand's velocity arrives level; Patch adds its own loft, as the world does for a part: `loft` × the level
   * speed upward, at most `loftMax`.
   */
  throwMax: 14,
  loft: 0.32,
  loftMax: 4.5,
  /** R4: in the hand its body's middle hangs this far below the hand (the scruff); a sphere of `bodyR` for what it meets. */
  hangBelow: 0.6,
  /** R4: its body's sphere in the air (what it meets); `drawnR`: its drawn body's reach round its middle (S7: Revert keeps clear of it). */
  bodyR: 0.35,
  drawnR: 0.45,
  /** R4: it has come down when its middle is this near the bench top (sat, its middle is about this high). */
  restMid: 0.3,
  /** R4: faster than this (level, units/s) as it crosses an open edge, it is gone (too fast to catch hold). */
  catchSpeed: 8,
  /** R4: within a unit of the stool's foot this long on its way back, it takes the last step whatever is there. */
  lastStep: 5,
  /** R4: how hard (units/s) a loose part at the stool's foot is nudged aside for that last step. */
  nudge: 1.6,
  /** R4: let go deep inside a body, it is moved out the least way (sideways first), no more than this. */
  clearMax: 0.5,
  /** R4: let go touching a body, a throw is a hit on it only with more than this much (units/s) of its level speed into its face. */
  intoBody: 2,
  /** R4 (Taylor: "you should be able to throw them up"): the most upward speed a throw keeps (units/s), as a crate's. */
  upMax: 12,
  /** R4: its middle never higher than this (world), whatever height it is let go at (S5's cap for parts). */
  topMid: 7.2,
  /** R4: let go with the hand moving up faster than this (units/s), it is thrown up (whatever its level speed). */
  upAt: 1.5,
  /**
   * R5 (Taylor, 2026-11-20, of a throw across the bench that had some lift in it: "Patch freezes mid air for several
   * frames"): thrown UP means more up than across: its level speed no more than this much of its upward speed (within
   * about 27 degrees of straight up). Only that throw rises arms up, hangs at the top and comes down in a flop. One
   * that travels goes over its top without a stop, head over heels, and lands in a roll, however high the hand sent it.
   */
  upLean: 0.5,
  /** R4: let go with the hand still, its middle more than this above the bench: it falls (a hand's height or less is a set-down). */
  dropFrom: 0.9,
  /** R4: caught in the air, how long (s) it takes to settle from where it was onto the hand. */
  catchEase: 0.3,
  /** R4: fallen this far (units, from the top of its flight to the bench) or more, it lands in a flop: a bounce, flat, a beat, then up. */
  flopFrom: 1.5,
  /** R4: the flop's extra time on the bench (s) over the landing's, at its highest. */
  flopMore: 1.0,
  /** R4: crossing an open edge with its middle this near the bench top (above, below), it catches the edge. */
  reachUp: 0.9,
  reachDown: 0.7,
  /** R4: landed: a bounce and a roll that eats the speed (`slide` seconds of it, at most `slideMax` units), sat up; a shake of the head. */
  land: 0.8,
  slide: 0.18,
  slideMax: 2.2,
  shake: 0.6,
  /** R4: thrown well clear of the bench: out of sight this long, then up the chute and onto the bench by the pad over `chuteFly`. */
  away: 0.5,
  chuteFly: 1.0,
  /** R4: a loose part it meets in the air gets this share of its velocity; it keeps this share of its own level speed. */
  knock: 0.8,
  keep: 0.25,
  /** R4: a fixed body met side-on, at least this much taller than its middle and this fast (units/s): a wall it sticks to. */
  wallAbove: 0.3,
  wallSpeed: 2.5,
  /** R4: stuck to the wall (s), then down it at up to this speed (units/s). */
  stick: 0.35,
  slideDown: 1.6,
  slideMin: 0.4,
  /** R5: from high on the wall it comes down faster, so the slide is never much longer than this (s) once it is moving. */
  slideMost: 1.4,
  /**
   * R5 (the lead's film, 2026-11-20): thrown at the back wall, its middle meets the wall no higher than this. A hard
   * flick up the screen has already lifted it some units in the hand, and with the throw's upward part it met the wall
   * at 6.4, where the home view shows only its feet: the gag happened off the top of the picture.
   */
  wallMeet: 5,
} as const;

export interface PatchSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** The phone line's unit id (its desk is where Patch works). */
  readonly line: Id;
  /** Where it sits: the top of the stool, under its middle. */
  readonly seat: Vec3;
  /** Its heading on the stool (radians about +Y; 0 faces +Z, the camera). */
  readonly facing: number;
  /** Where it climbs down to and up from: the bench in front of the stool. */
  readonly foot: Vec3;
  /** Its body for thrown parts: a sphere `up` above the seat, of radius `radius`; above `head` (over the seat) a part is at its head. */
  readonly body: { readonly up: number; readonly radius: number; readonly head: number; readonly hands: number };
  /** Where a caught part is set down (its bottom centre). */
  readonly shelf: Vec3;
  /** Things it looks at: the UNDO lever, the visitor, the phone. */
  readonly lever: Vec3;
  readonly visitor: Vec3;
  readonly phone: Vec3;
  /** Each jack's mouth (world): the line's lamp and the drawer under it. */
  readonly jacks: Readonly<Record<Id, Vec3>>;
  /** Where each station on a line is (unit id → world): it leans out toward it to check. */
  readonly stations: Readonly<Record<Id, Vec3>>;
  /** The bench: where it can be put down. */
  readonly bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /**
   * R1: the bench's open edges (world: its left and right ends, its front; the back is against the wall). Let go
   * of past one, Patch catches it and hangs (`ledge`). Without it a release past the bench is put down on it.
   */
  readonly edge?: { readonly minX: number; readonly maxX: number; readonly maxZ: number };
  /**
   * R2: the belt, which Patch may cross on its way back: the belt machine's id, its bed's static body id, and
   * the stretch (x) a crossing may start and end in (clear of the motor end, the striker and the ramp).
   */
  readonly belt?: { readonly id: Id; readonly bed: Id; readonly safe: readonly [number, number] };
  /** R4: thrown off the bench, it comes back up the chute (its mouth, world) and lands by the pad (x, z), as a shipped robot does. */
  readonly chute?: { readonly from: Vec3; readonly pad: readonly [number, number] };
  /**
   * S6: the stool's runner along the board (world x of the stool's middle). `rest` is its place at the
   * runner's right end (where `seat` and `foot` are measured); `jacks` is where it stands to work each
   * jack; the runner runs from the least of those to `rest`. `quiet`: seconds of a quiet line before it
   * rolls back to rest.
   */
  readonly runner?: { readonly rest: number; readonly jacks: Readonly<Record<Id, number>>; readonly quiet: number };
  /**
   * 2026-11-20 (prototype): how it is held and thrown. `script` (the default): everything in this file, a point on
   * a scripted arc. `body`: a real physics body from the hand taking hold until the script takes over to recover
   * (`sim/crew/patch-body.ts`, which wraps this unit); `bodyPart` is that body, a `crewBody` part of the scene.
   */
  readonly flight?: 'script' | 'body';
  readonly bodyPart?: Id;
}

export interface PatchUnit extends MachineUnit {
  view(): PatchView;
}

const JOB: readonly PatchState[] = ['notice', 'roll', 'plug', 'drawer', 'work', 'check', 'reply'];
const isJob = (s: PatchState): boolean => JOB.includes(s);

interface Watched {
  readonly id: Id;
  last: Vec3;
  until: number;
  /** Set once Patch has chosen its answer. */
  answer: PatchAnswer | null;
  cause: Cause | null;
}

export function patch(spec: PatchSpec): UnitFactory {
  return (ctx) => createPatch(ctx, spec);
}

export function createPatch(ctx: SimContext, spec: PatchSpec): PatchUnit {
  const T = PATCH_TUNING;
  const id = spec.id;
  const g = ctx.scene.gravity;
  let state: PatchState = 'seated';
  let since = ctx.clock.step;
  let length_ = Infinity;
  let call: Call | null = null;
  /** A job stage interrupted (lifted, a reaction): where to carry on, and how far in it was. */
  let resume: { state: PatchState; elapsed: number } | null = null;
  let lookAt: Vec3 | null = null;
  let at: Vec3 = spec.seat;
  let heading = spec.facing;
  /** R5, for the view only (nothing here reads it back): `at` and the state at the end of this step and the one before. */
  let endAt: Vec3 = at, endState: PatchState = state, lastAt: Vec3 = at, lastState: PatchState = state;
  /** A caught part, the throw it is charged to, and the job that keeps that throw on the stack while Patch has it (rule 4, rule 10). */
  let holding: { id: Id; cause: Cause | null; job: Job | null } | null = null;
  /** A caught part set down: its throw stays on the stack until the part has come to rest (and that rest is the throw's). */
  const finishing: { job: Job; part: Id; until: number }[] = [];
  let cancelledAt = -1;
  const watched: Watched[] = [];
  /** R1: the edge it hangs from and hauls itself up over (states `ledge`, `haul`, `dust`, and the look after). */
  let ledge: { edge: 'front' | 'left' | 'right'; at: Vec3; up: Vec3; out: Vec3 } | null = null;
  /** R1: on its feet on the bench after the ledge: the look ends in the walk back, not in carrying on. */
  let afoot = false;
  /** When it came within a unit of the stool's foot on its way back (-1: not there). */
  let nearFootAt = -1;
  /** R1: the hand's last few places while it holds Patch (a release past an edge is judged with the hand's travel). */
  const trail: { step: number; p: Vec3 }[] = [];

  // ── S6: the stool on its runner ──
  const runner = spec.runner ?? null;
  const restX = runner?.rest ?? spec.seat[0];
  const runnerMin = runner ? Math.min(restX, ...Object.values(runner.jacks)) : restX;
  const runnerLength = Math.max(1e-6, restX - runnerMin);
  /** Where the stool is (world x of its middle), and the roll in hand: from, to, and whether it is the way home. */
  let stoolX = restX;
  let roll: { from: number; to: number; home: boolean } | null = null;
  /** The step the line last had anything for Patch (a job in hand or waiting): it rolls home after a quiet spell. */
  let busyAt = ctx.clock.step;
  const workX = (jack: Id): number => runner?.jacks[jack] ?? stoolX;
  const rollSeconds = (from: number, to: number): number => (runner ? (T.rollWhole * Math.abs(to - from)) / runnerLength : 0);
  /** Where it sits now: the stool's top, wherever the stool is on its runner. */
  const seatNow = (): Vec3 => [spec.seat[0] + (stoolX - restX), spec.seat[1], spec.seat[2]];
  const footNow = (): Vec3 => [spec.foot[0] + (stoolX - restX), spec.foot[1], spec.foot[2]];
  /** The job's stages with their lengths, as planned when it was picked up (the view can lay the whole job out). */
  let plan: { state: PatchState; length: number }[] | null = null;
  /** S6: after a crew job for which it moved the cord, the jack it puts the cord back in (attract mode). */
  let back: Id | null = null;
  /** S6: the cord's move in hand (state `plug`): from one jack to another. */
  let plugging: { from: Id; to: Id } | null = null;
  const cordJack = (): Id | null => {
    const d = deskOf(ctx);
    return d ? ((ctx.setting(d.cordId, 'jack') as Id | undefined) ?? null) : null;
  };
  /** A crew call for a line the cord is not in: Patch moves the cord first. */
  const needsPlug = (c: Call): boolean => c.crew === true && cordJack() !== c.jack;
  /** Move the cord now (the commit point of the `plug` stage), as the crew: refused in play mode (rule 5). */
  function moveCord(to: Id): boolean {
    const d = deskOf(ctx);
    const from = cordJack();
    if (!d || from === null || from === to || ctx.playMode) return false;
    const r = ctx.commit([{ target: d.cordId, field: 'jack', after: to }], 'crew');
    if (r.refused.length > 0) return false;
    ctx.emit({ type: 'cord.unplugged', cord: d.cordId, jack: from, by: 'crew' });
    ctx.emit({ type: 'cord.plugged', cord: d.cordId, jack: to, by: 'crew' });
    return true;
  }
  /** The stage after the job's roll: the cord first if it must move, else the drawer. */
  function afterRoll(): void {
    if (call && needsPlug(call)) {
      plugging = { from: cordJack() as Id, to: call.jack };
      enter('plug');
    } else enter('drawer');
  }

  const bodyCentre = (): Vec3 => add(seatNow(), [0, spec.body.up, 0]);

  // ── R2: the way back to the stool, round things (sim/crew/patch-route.ts) ──
  const R = PATCH_ROUTE.radius;
  // the bench's fixed bodies, and Fetch's tape: Fetch drives up and down it and does not look out for Patch, so
  // Patch keeps off it (it walks round its ends) as it keeps off a body
  const TAPE: Obstacle[] = (() => {
    const pts = (ctx.scene as { runner?: { lane?: { points?: readonly (readonly [number, number])[] } } }).runner?.lane?.points ?? [];
    const out: Obstacle[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as readonly [number, number], b = pts[i + 1] as readonly [number, number];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      out.push({ id: `tape:${i}`, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hx: l / 2 + 0.3, hz: 0.3, yaw: Math.atan2(-dz, dx) });
    }
    return out;
  })();
  const STATICS: Obstacle[] = bodiesOf(obstacles(ctx.scene));
  const BODIES: Obstacle[] = [...STATICS, ...TAPE];
  const routeBench = { minX: ctx.scene.bench.minX, maxX: ctx.scene.bench.maxX, minZ: ctx.scene.bench.minZ, maxZ: ctx.scene.bench.maxZ };
  const BELT: BeltCrossing | null = (() => {
    const b = spec.belt;
    const bed = b ? BODIES.find((o) => o.id === b.bed) : undefined;
    const st = b ? ctx.scene.statics.find((s) => s.id === b.bed) : undefined;
    if (!b || !bed || !st) return null;
    const top = st.pose.p[1] + (st.shape.type === 'box' ? st.shape.half[1] : 0.25);
    return { bed, top, safe: b.safe };
  })();
  const CROSS = T.crossOn + T.crossOver + T.crossOff;
  /** The way in hand (its points still to walk; a crossing of the belt at its end), the pace, and the crossing under way. */
  let way: Way | null = null;
  let pace: number = T.walk;
  let blockedAt = -1;
  /** R5: what stopped its last step stands at the stool's foot (a big crate there stops it more than a unit short). */
  let footBlock = false;
  let retryAt = 0;
  let crossing: { x: number; z0: number; side: 1 | -1 } | null = null;
  let gapWaitAt = -1;
  /** Where Fetch was last seen (its velocity is read from it). */
  let fetchSeen: { step: number; x: number; z: number; vx: number; vz: number } | null = null;

  // ── R4: thrown ──
  const SOLIDS: Solid[] = solidsOf(ctx.scene);
  /** In the air: its velocity; past an open edge and going (out); coming back from the chute. */
  /** (R4 up: `peak` the highest its middle has been this flight; `drop` let go still from high; `up` thrown upward;
   * `float` how much it floats at its top (0..1, patch-float.ts).) */
  let fly: { v: Vec3; out: boolean; chute: boolean; tops: number; gone: boolean; knocked: Set<Id>; passing: Set<Id>; leaving: Set<Id>; txn: Cause | null; peak: number; drop: boolean; up: boolean; float: number } | null = null;
  const newFly = (v: Vec3, chute: boolean, from = -Infinity): NonNullable<typeof fly> => ({ v, out: false, chute, tops: 0, gone: false, knocked: new Set(), passing: new Set(), leaving: new Set(), txn: null, peak: from, drop: false, up: false, float: 0 });
  /** The share of the world's pull it has now (R5's float at the top of a throw up: under 1 near the top). */
  const floatPull = (f: NonNullable<typeof fly>): number => pullAt(f.float, f.v[1]);
  /** In the float: the pull down by more than a third. */
  const inFloat = (f: NonNullable<typeof fly>): boolean => floating(f.float, f.v[1]);
  /** Met a wall flat: its outward direction, and how fast it came in. */
  let walled: { out: Vec3; speed: number; slideFrom?: number } | null = null;
  /** How far a point is from a body's box (0 inside), in three dimensions. */
  const boxDist = (o: Solid, p: Vec3): number => {
    const dy = Math.max(0, o.y0 - p[1], p[1] - o.y1);
    return Math.hypot(distanceTo(o, p[0], p[2]), dy);
  };
  /** Fetch's and Revert's bodies as solids (in the air Patch stops against them). */
  function robotBodies(): Solid[] {
    const out: Solid[] = [];
    for (const who of ['fetch', 'revert']) {
      const c = ctx.crewView(who);
      if (!c || (c.kind !== 'fetch' && c.kind !== 'revert')) continue;
      const p = ctx.pose(c.body);
      const h = ctx.halfExtents(c.body);
      if (!p || !h) continue;
      out.push({ id: c.body, x: p.p[0], z: p.p[2], hx: h[0], hz: h[2], yaw: 0, y0: p.p[1] - h[1], y1: p.p[1] + h[1] });
    }
    return out;
  }
  /** Landed: from where it came down to where the roll ends, and how fast it came in. */
  let landing: { from: Vec3; to: Vec3; speed: number; fall: number; drop: boolean } | null = null;
  /** R4: caught in the air: where its scruff was against the hand at the catch, eased to nothing (no snap). */
  let gripOff: { off: Vec3; at: number } | null = null;
  /** Thrown from `p` (its middle, world) with the hand's velocity `v`. */
  function throwFrom(p: Vec3, v: Vec3, drop = false): void {
    // level, clamped to the cap; up: the hand's own upward speed (at most `upMax`, and never so fast that its middle
    // would pass `topMid`), or the level throw's loft, whichever is more (the loft is not added to a real upward part)
    const h = Math.hypot(v[0], v[2]);
    const k = h > T.throwMax ? T.throwMax / h : 1;
    const room = Math.max(0, T.topMid - p[1]);
    const upCap = Math.min(T.upMax, Math.sqrt(2 * -g * room));
    let vy = drop ? Math.min(0, v[1]) : Math.min(upCap, Math.max(v[1], Math.min(T.loftMax, T.loft * h * k)));
    // (at the back wall: no more upward speed than brings its middle to `wallMeet` where it meets the wall's face)
    const toWall = -v[2] * k;
    if (!drop && toWall >= T.wallSpeed) {
      const tw = (p[2] - (ctx.scene.bench.minZ + T.bodyR)) / toWall;
      if (tw > 1 / HZ) vy = Math.min(vy, (T.wallMeet - p[1] - 0.5 * g * tw * tw) / tw);
    }
    const vv: Vec3 = [v[0] * k, vy, v[2] * k];
    let q: Vec3 = p[1] > T.topMid ? [p[0], T.topMid, p[2]] : p;
    // (never starting inside a body, a robot or a part: out of it the least way, sideways before up, at most
    // `clearMax`; and if there is none, it is a hit there: it drops)
    const parts: Solid[] = [];
    for (const id of ctx.parts()) {
      const pp = ctx.pose(id);
      const h = ctx.halfExtents(id);
      const mode = ctx.mode(id);
      if (pp && h && mode !== 'gone' && mode !== 'chute') parts.push({ id, x: pp.p[0], z: pp.p[2], hx: h[0], hz: h[2], yaw: 0, y0: pp.p[1] - h[1], y1: pp.p[1] + h[1] });
    }
    // (a loose part it is let go against is not a reason to move: the flight knocks it, as anything in its way)
    const free = new Set([...ctx.parts()].filter((id) => ctx.mode(id) === 'free'));
    const all = [...SOLIDS, ...parts.filter((o) => !free.has(o.id)), ...robotBodies()];
    // let go deep in a body (most of its sphere in it, as a carry can leave it): out of it the least
    // way, sideways before up, at most `clearMax`; if nothing is that near, it drops where it can stand
    const deep = (c: Vec3): boolean => all.some((o) => sphereMeets(o, c[0], c[1], c[2], T.bodyR * 0.8));
    if (deep(q)) {
      let found: Vec3 | null = null;
      // hanging below the hand over a low body (the board's desk, the console), its middle is in it: up onto its
      // top first, where the hand is anyway, if that is no more than `clearMax` above the hand
      const hand = q[1] + T.hangBelow;
      // (the low bodies it hangs into, whose tops are under the hand: not a tall one beside them, the board's panel)
      const under = all.filter((o) => o.y1 <= hand && sphereMeets(o, q[0], q[1], q[2], T.bodyR * 0.8));
      // (clear of the top by its whole flight sphere: on it, not in it, so it comes down on it and is tipped off)
      const top = under.length ? Math.max(...under.map((o) => o.y1)) + T.bodyR + 0.01 : Infinity;
      if (top <= hand + T.clearMax && !deep([q[0], top, q[2]])) found = [q[0], top, q[2]];
      // (and the top taken by something standing on it, the board's panel on its desk: the nearest clear place
      // on that top, before anywhere at its own height)
      // (its middle over that body, or so near its edge that most of it is over it: not beside it)
      const over = under.some((o) => distanceTo(o, q[0], q[2]) <= T.bodyR * 0.5);
      for (let ring = 1; ring <= 10 && !found && over && top <= hand + T.clearMax; ring++) {
        const r = (ring / 10) * T.clearMax * 2;
        for (let i = 0; i < 16 && !found; i++) {
          const a = (i / 16) * Math.PI * 2;
          const c: Vec3 = [q[0] + Math.cos(a) * r, top, q[2] + Math.sin(a) * r];
          if (!deep(c) && under.some((o) => sphereMeets(o, c[0], c[1] - T.bodyR, c[2], T.bodyR * 0.8))) found = c;
        }
      }
      for (let ring = 1; ring <= 10 && !found; ring++) {
        const r = (ring / 10) * T.clearMax;
        for (let i = 0; i < 16 && !found; i++) {
          const a = (i / 16) * Math.PI * 2;
          const c: Vec3 = [q[0] + Math.cos(a) * r, q[1], q[2] + Math.sin(a) * r];
          if (!deep(c)) found = c;
        }
        if (!found && !deep([q[0], q[1] + r, q[2]])) found = [q[0], q[1] + r, q[2]];
      }
      if (!found) {
        at = q;
        ctx.emit({ type: 'patch.throw', phase: 'thrown', speed: length(vv) });
        ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(vv), what: all.find((o) => sphereMeets(o, q[0], q[1], q[2], T.bodyR * 0.8))?.id ?? '' });
        landAt(q, [0, 0, 0]);
        return;
      }
      q = found;
    }
    // touching a body as it is let go: a hit only if the throw points INTO it (more than `intoBody` units/s of its
    // level speed into the face it touches); pointing away or along, an ordinary throw from where it is, leaving it
    const touching = all.filter((o) => sphereMeets(o, q[0], q[1], q[2], T.bodyR));
    for (const o of touching) {
      if (q[1] >= o.y1) continue; // (over it, not against its side: it leaves it whichever way it is thrown)
      const n = offTop(o, q[0], q[2]);
      const into = -(vv[0] * n[0] + vv[2] * n[1]);
      if (into <= T.intoBody) continue;
      // (more along the face than into it, as a sweep past a corner is: it glances off and slides along it)
      if (into < Math.abs(vv[0] * n[1] - vv[2] * n[0])) continue;
      // (into its face, but glancing off its corner: a tenth of a second on along the throw it is clear of it)
      const ahead: Vec3 = [q[0] + vv[0] * 0.1, q[1], q[2] + vv[2] * 0.1];
      if (!sphereMeets(o, ahead[0], ahead[1], ahead[2], T.bodyR)) continue;
      at = q;
      fly = null;
      landing = null;
      lookAt = null;
      ctx.emit({ type: 'patch.throw', phase: 'thrown', speed: length(vv) });
      if (SOLIDS.includes(o as Solid) && o.y1 >= q[1] + T.wallAbove) {
        // a wall it is pressed to and thrown into: the wall gag, there
        ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(vv), what: o.id, wall: true });
        walled = { out: [n[0], 0, n[1]], speed: length(vv) };
        heading = Math.atan2(-n[0], -n[1]);
        enter('wall');
        return;
      }
      ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(vv), what: o.id });
      landAt(q, [0, 0, 0]);
      return;
    }
    at = q;
    fly = newFly(vv, false, q[1]);
    fly.drop = drop;
    // (thrown up by the hand: not a level throw's own loft, and not a throw across the bench that has lift in it)
    fly.up = !drop && v[1] >= T.upAt && Math.hypot(vv[0], vv[2]) <= T.upLean * vv[1];
    // (how much it floats at its top: the one rule both Patches have, patch-float.ts; none for a thing let go still)
    fly.float = drop ? 0 : floatWeight(vv);
    gripOff = null;
    for (const o of touching) if (q[1] < o.y1) fly.leaving.add(o.id); // (one it is over is a top it comes down on)
    // (a set-down from a hand's height is not a throw: no sound of one)
    if (!drop || q[1] - spec.foot[1] > T.dropFrom) ctx.emit({ type: 'patch.throw', phase: 'thrown', speed: length(vv) });
    // loose parts it was let go against: shoved aside along the throw as it leaves the hand (each once, the
    // throw's, as any knock), and it goes on at the speed it was thrown with
    for (const o of parts) {
      if (!free.has(o.id) || !sphereMeets(o, q[0], q[1], q[2], T.bodyR)) continue;
      fly.knocked.add(o.id);
      fly.passing.add(o.id);
      if (ctx.bracketed) continue;
      fly.txn ??= ctx.history.open('release', o.id, ctx.clock.step);
      ctx.history.claim(o.id, fly.txn, ctx.clock.step);
      const sp = Math.hypot(vv[0], vv[2]);
      ctx.shove(o.id, [vv[0] * T.knock * 0.5, Math.min(1.5, 0.3 + sp * 0.1), vv[2] * T.knock * 0.5]);
      const txn = fly.txn;
      ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(vv), what: o.id, ...(txn !== 'crew' && txn !== 'system' ? { txn } : {}) });
    }
    landing = null;
    lookAt = null;
    if (Math.hypot(vv[0], vv[2]) > 0.1) heading = Math.atan2(vv[0], vv[2]);
    enter('fly');
  }
  /** Where a throw comes down: where it stands (clear of every body), and the roll on from there that eats its speed. */
  /**
   * Can the visitor see a raccoon sat at `p` (feet, world)? Nothing tall between its middle and the visitor's eye
   * (`spec.visitor`). The simulation does not know the camera; the visitor's point is where Patch looks to look at
   * the visitor, and the camera looks from about there.
   */
  function inView(p: Vec3): boolean {
    const a: Vec3 = [p[0], p[1] + 0.45, p[2]];
    const b = spec.visitor;
    for (let i = 1; i <= 12; i++) {
      const k = i / 12;
      const q: Vec3 = [a[0] + (b[0] - a[0]) * k * 0.5, a[1] + (b[1] - a[1]) * k * 0.5, a[2] + (b[2] - a[2]) * k * 0.5];
      if (SOLIDS.some((o) => sphereMeets(o, q[0], q[1], q[2], 0.05))) return false;
    }
    return true;
  }
  /** Where it comes to rest: clear of every body, and in the visitor's view if a point within a unit is. */
  function restingAt(p: Vec3): Vec3 {
    const c0 = standingAt(p);
    // (never in a pocket it cannot walk out of: shut in by bodies and crates, it comes to rest at the nearest
    // point it can walk home from)
    const bodies = [...STATICS, ...movers()];
    const home = pt(footNow());
    // (R5: what stands at the stool's foot shuts every point in alike: the way home is judged without it)
    const round = offFoot(bodies);
    const free = (q: Pt): boolean => planWay(q, home, R, round, routeBench, BELT, 0) !== null;
    let c = c0;
    if (!free(pt(c0))) {
      search: for (let ring = 1; ring <= 6; ring++) {
        const rad = ring * 0.25;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const q: Pt = [c0[0] + Math.cos(a) * rad, c0[2] + Math.sin(a) * rad];
          if (clearPoint(q, R, bodies, routeBench)?.[0] !== q[0] || !free(q)) continue;
          c = onGround(q);
          break search;
        }
      }
    }
    if (inView(c)) return c;
    for (let ring = 1; ring <= 10; ring++) {
      const rad = ring * 0.1;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const q: Pt = [c[0] + Math.cos(a) * rad, c[2] + Math.sin(a) * rad];
        if (clearPoint(q, R, STATICS, routeBench)?.[0] !== q[0] || !legClear(pt(c), q, R, STATICS)) continue;
        const g3 = onGround(q);
        if (inView(g3)) return g3;
      }
    }
    return c;
  }

  function landAt(p: Vec3, v: Vec3): void {
    const from = restingAt([p[0], spec.foot[1], p[2]]);
    const sp = Math.hypot(v[0], v[2]);
    let roll = Math.min(T.slideMax, sp * T.slide);
    const dir: Pt = sp > 1e-6 ? [v[0] / sp, v[2] / sp] : [0, 0];
    let to: Pt = [from[0] + dir[0] * roll, from[2] + dir[1] * roll];
    while (roll > 0.02 && (!legClear(pt(from), to, R, STATICS) || clearPoint(to, R, STATICS, routeBench)?.[0] !== to[0])) {
      roll *= 0.5;
      to = [from[0] + dir[0] * roll, from[2] + dir[1] * roll];
    }
    if (roll <= 0.02) to = pt(from);
    // let go from a hand's height or less: a set-down after all, on its feet where it came down, and home
    if (fly?.drop && !fly.up && Math.max(fly.peak, p[1]) - spec.foot[1] <= T.dropFrom) {
      // (where it is put down, as a set-down always was: only moved if it would stand inside a body)
      const b = spec.bench;
      const down: Vec3 = [Math.min(b.maxX, Math.max(b.minX, p[0])), spec.foot[1], Math.min(b.maxZ, Math.max(b.minZ, p[2]))];
      at = dist(down, footNow()) >= 0.15 ? standingAt(down) : down;
      fly = null;
      landing = null;
      lookAt = null;
      walkBack();
      return;
    }
    ctx.emit({ type: 'patch.throw', phase: 'landed', speed: length(v) });
    // how far it fell (from the top of its flight to the bench), and whether it was dropped rather than thrown
    const fall = Math.max(0, (fly ? Math.max(fly.peak, p[1]) : p[1]) - spec.foot[1]);
    const dropped = !!fly && (fly.drop || fly.up);
    landing = { from, to: onGround(to), speed: sp, fall, drop: dropped };
    at = from;
    fly = null;
    enter('land', 0, landLength(fall, dropped));
  }
  /**
   * The landing's length: a fall from high after a drop or a throw up is a flop (a bounce, flat, a beat, then up),
   * longer the higher. A throw that travels lands in its roll and has no beat to wait out, from whatever height
   * (the view plays the roll, which is `land` long: the flop's time on top of it was a second of sitting still).
   */
  const landLength = (fall: number, flop: boolean): number => T.land + (flop && fall >= T.flopFrom ? T.flopMore * Math.min(1, 0.5 + (fall - T.flopFrom) / 6) : 0);
  /** The head's "really?" after it: longer the further it fell. */
  const shakeLength = (fall: number): number => T.shake + Math.min(0.6, Math.max(0, fall - 1) * 0.12);
  const pt = (v: Vec3): Pt => [v[0], v[2]];
  const onGround = (p: Pt): Vec3 => [p[0], spec.foot[1], p[1]];
  /** The belt's surface speed now (+X), 0 without one. */
  function beltSurface(): number {
    if (!spec.belt) return 0;
    const v = (ctx.machine(spec.belt.id) as Partial<MachineUnit> | undefined)?.view?.();
    return v && v.kind === 'belt' ? v.surface : 0;
  }
  const fetchBody = (): Id | null => {
    const f = ctx.crewView('fetch');
    return f && f.kind === 'fetch' ? f.body : null;
  };
  /** Things that move and stand on the bench: Fetch, and loose parts at rest on the bench top (not riding a machine). */
  function movers(): Obstacle[] {
    const out: Obstacle[] = [];
    const f = ctx.crewView('fetch');
    if (f && f.kind === 'fetch') {
      const p = ctx.pose(f.body);
      const h = ctx.halfExtents(f.body);
      if (p && h) {
        // Fetch drives its rounds and does not look out for Patch: Patch keeps out of where Fetch will be in the
        // next half second too (its box swept along its velocity)
        const now = ctx.clock.step;
        let vx = 0, vz = 0;
        if (fetchSeen && now > fetchSeen.step && now - fetchSeen.step <= 3) {
          vx = ((p.p[0] - fetchSeen.x) * HZ) / (now - fetchSeen.step);
          vz = ((p.p[2] - fetchSeen.z) * HZ) / (now - fetchSeen.step);
        } else if (fetchSeen && now === fetchSeen.step) {
          vx = fetchSeen.vx;
          vz = fetchSeen.vz;
        }
        if (!fetchSeen || now !== fetchSeen.step) fetchSeen = { step: now, x: p.p[0], z: p.p[2], vx, vz };
        const e = Math.max(h[0], h[2]);
        const ahead = 1.5;
        out.push({ id: f.body, x: p.p[0], z: p.p[2], hx: e, hz: e, yaw: 0 });
        out.push({ id: `${f.body}:ahead`, x: p.p[0] + (vx * ahead) / 2, z: p.p[2] + (vz * ahead) / 2, hx: e + (Math.abs(vx) * ahead) / 2, hz: e + (Math.abs(vz) * ahead) / 2, yaw: 0 });
      }
    }
    // R3: Revert on the bench (its body is the crew's, not a loose part at rest): a body Patch walks round and
    // stops short of, as it does Fetch; Revert waits for Patch in turn, so the one that yields is whoever is moving
    const rv = ctx.crewView('revert-crew');
    if (rv && rv.kind === 'revert' && rv.body) {
      const v = rv.view as { drawn: boolean; lift: number; x: number; z: number; heading: number };
      const h = ctx.halfExtents(rv.body);
      // (grown by the difference between Patch's drawn body, which Revert keeps clear of, and its route radius)
      const g = Math.max(0, T.drawnR - R);
      if (v.drawn && v.lift > 0.5 && h) out.push({ id: rv.body, x: v.x, z: v.z, hx: h[0] + g, hz: h[2] + g, yaw: v.heading });
    }
    const top = ctx.scene.bench.top;
    for (const id of ctx.parts()) {
      if (ctx.mode(id) !== 'free' || id === spec.bodyPart) continue; // (`flight: 'body'`: its own body is not a thing in its way)
      const p = ctx.pose(id);
      const h = ctx.halfExtents(id);
      if (!p || !h || p.p[1] - h[1] > top + 0.3) continue;
      const e = Math.max(h[0], h[2]);
      out.push({ id, x: p.p[0], z: p.p[2], hx: e, hz: e, yaw: 0 });
    }
    return out;
  }
  /** Where it stands when set down at `p` (or landed from the ledge): the nearest point clear of every body. */
  function standingAt(p: Vec3): Vec3 {
    const c = clearPoint(pt(p), R, [...STATICS, ...movers()], routeBench) ?? clearPoint(pt(p), R, STATICS, routeBench);
    return c ? onGround(c) : [p[0], spec.foot[1], p[2]];
  }
  /**
   * The things that move, less whatever stands at the stool's foot itself. No way that keeps clear of that can end
   * there; Patch's way goes up to it, and the last step deals with it (it waits for the crew, nudges a loose part).
   */
  function offFoot(mv: readonly Obstacle[]): Obstacle[] {
    const f = footNow();
    return mv.filter((o) => distanceTo(o, f[0], f[2]) >= R);
  }
  function planBack(withMovers: boolean): void {
    const mv = withMovers ? movers() : [];
    const drift = beltSurface() * (T.crossOver + T.crossOn);
    const plan = (bodies: readonly Obstacle[]): Way | null => planWay(pt(at), pt(footNow()), R, bodies, routeBench, BELT, drift);
    way = plan(withMovers ? [...BODIES, ...mv] : BODIES);
    // no way round the things that move as they stand now: the way round the fixed bodies (each step still stops
    // short of them); none round Fetch's tape either: across it (Fetch is still watched for, step by step)
    if (!way && withMovers) way = plan([...STATICS, ...mv]);
    // R5: something stands at the stool's foot (a crate thrown there), so no way round everything ends there: the
    // way round everything else, up to it. (The ways below keep clear of no crate at all: with one lying at the
    // stool, another on that way held Patch where it stood until Revert had cleared the bench, half a minute.)
    if (!way && withMovers) {
      const rest = offFoot(mv);
      if (rest.length < mv.length) way = plan([...BODIES, ...rest]) ?? plan([...STATICS, ...rest]);
    }
    if (!way && withMovers) way = plan(BODIES);
    if (!way) way = plan(STATICS);
    retryAt = ctx.clock.step + steps(T.retry);
  }
  /** On its feet on the bench: the way back (a look at the visitor and a turn first, unless it is on its way already). */
  function walkBack(going = false): void {
    if (dist(at, footNow()) < 0.15) {
      way = null;
      enter('climb');
      return;
    }
    planBack(false);
    pace = way && way.length > T.scamperOver ? T.scamper : T.walk;
    blockedAt = -1;
    enter('walk', going ? T.setOff : 0);
  }
  /** Is the belt clear at x for a crossing (nothing riding it there while Patch is over it)? */
  function beltGap(x: number): boolean {
    if (!spec.belt) return true;
    const v = (ctx.machine(spec.belt.id) as Partial<MachineUnit> | undefined)?.view?.();
    if (!v || v.kind !== 'belt') return true;
    const s = v.surface;
    for (const id of v.riding) {
      const p = ctx.pose(id);
      if (!p) continue;
      const h = Math.max(...(ctx.halfExtents(id) ?? [0.3, 0.3, 0.3]));
      for (let k = 0; k <= 8; k++) {
        const t = (k / 8) * CROSS;
        const me = x + s * Math.max(0, t - T.crossOn * 0.5);
        if (Math.abs(p.p[0] + s * t - me) < h + R + 0.2) return false;
      }
    }
    return true;
  }
  /** Will a crossing that starts at x now stay where the belt cannot carry it to a machine? */
  const crossSafe = (x: number): boolean => {
    if (!BELT) return false;
    const end = x + beltSurface() * (CROSS - T.crossOn * 0.5 - T.crossOff * 0.5);
    return x >= BELT.safe[0] && x <= BELT.safe[1] && end >= BELT.safe[0] && end <= BELT.safe[1];
  };
  const seconds = (): number => (ctx.clock.step - since) / HZ;
  const lengthOf = (s: PatchState): number =>
    s === 'roll' ? (roll ? rollSeconds(roll.from, roll.to) : 0) : (({ plug: T.plug, notice: T.notice, drawer: T.drawer, work: T.work, check: T.check, reply: T.reply, stare: T.stare, look: T.look, duck: T.duck, catch: T.catchHold + T.catchSet, bonk: T.bonk, climb: T.climb, ledge: T.ledge, haul: T.haul, dust: T.dust, cross: T.crossOn + T.crossOver + T.crossOff, land: T.land, shake: T.shake, away: T.away, wall: Infinity } as Record<string, number>)[s] ?? Infinity);

  /**
   * R1: where a release at `p` goes over an open edge (with the hand's travel carried on for `fling`
   * seconds), the point of that edge nearest to where it was going; null when it stays on the bench.
   */
  /**
   * The hand's velocity as it let go (world units/s): the input's, when it sends one; else from the hand's own
   * trail of carries, from the carry a little before the last to the last (the release itself is where the hand
   * was last carried to, so it is not counted twice). A fling needs a few carries and a recent one: one jump of
   * the target is not a throw, and a hand that paused has set Patch down.
   */
  function handVelocity(given?: Vec3): Vec3 {
    if (given) return given;
    const last = trail[trail.length - 1];
    const old = last ? trail.find((s) => last.step - s.step <= Math.round(0.15 * HZ)) : undefined;
    if (trail.length >= 3 && last && old && last.step > old.step && ctx.clock.step - last.step <= Math.round(0.1 * HZ)) return scale(sub(last.p, old.p), HZ / (last.step - old.step));
    return [0, 0, 0];
  }

  function overEdge(p: Vec3): { edge: 'front' | 'left' | 'right'; at: Vec3; up: Vec3; out: Vec3 } | null {
    const e = spec.edge;
    if (!e) return null;
    const v = handVelocity();
    const fast = Math.hypot(v[0], v[2]) >= T.flingMin;
    return edgeFor(fast ? add(p, scale(v, T.fling)) : p);
  }

  /** The edge a point beyond the bench is past (the one it is furthest past), and the point of it nearest; null when it is on the bench. */
  function edgeFor(q: Vec3): { edge: 'front' | 'left' | 'right'; at: Vec3; up: Vec3; out: Vec3 } | null {
    const e = spec.edge;
    if (!e) return null;
    // how far past each open edge it goes; the edge it goes furthest past is the one it catches
    const past = { left: e.minX - q[0], right: q[0] - e.maxX, front: q[2] - e.maxZ };
    const [edge, d] = (Object.entries(past) as ['front' | 'left' | 'right', number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
    if (d <= 0) return null;
    const y = spec.foot[1];
    const out: Vec3 = edge === 'front' ? [0, 0, 1] : edge === 'left' ? [-1, 0, 0] : [1, 0, 0];
    // the nearest point of that edge (kept a little in from the corners so it hangs from the edge, not a corner)
    const zIn = Math.min(e.maxZ - 0.5, Math.max(spec.bench.minZ, q[2]));
    const xIn = Math.min(e.maxX - 0.5, Math.max(e.minX + 0.5, q[0]));
    const at: Vec3 = edge === 'front' ? [xIn, y, e.maxZ] : edge === 'left' ? [e.minX, y, zIn] : [e.maxX, y, zIn];
    return { edge, at, up: standingAt(sub(at, scale(out, T.ledgeIn))), out };
  }

  /** Start the stool rolling to `to` (state `roll`); false (and nothing) when it is already there. */
  function rollTo(to: number, home: boolean): boolean {
    if (Math.abs(to - stoolX) < 1e-6) return false;
    roll = { from: stoolX, to, home };
    enter('roll');
    return true;
  }
  /** The stool's place during a roll: eased in and out. */
  function rolling(t: number): void {
    if (!roll) return;
    const len = rollSeconds(roll.from, roll.to);
    const f = len <= 0 ? 1 : Math.min(1, t / len);
    stoolX = roll.from + (roll.to - roll.from) * f * f * (3 - 2 * f);
  }

  function enter(s: PatchState, elapsed = 0, len = lengthOf(s)): void {
    if (s !== state) {
      nearFootAt = -1; // (the stool's-foot wait counts one walk at a time)
      footBlock = false;
    }
    if (s !== 'roll') roll = null; // a roll ends (or is given up) with any other state
    const from = state;
    state = s;
    since = ctx.clock.step - Math.round(elapsed * HZ);
    length_ = len;
    if (isJob(s)) lookAt = jobLook(s);
    if (from !== s) ctx.emit({ type: 'crew.state', id, state: s, from });
  }

  const jackAt = (j: Id): Vec3 => spec.jacks[j] ?? spec.seat;
  const drawerAt = (j: Id): Vec3 => {
    const p = jackAt(j);
    return [p[0], spec.seat[1] - 0.45, p[2] + 0.6];
  };

  /** Where its eyes go in a job stage. */
  function jobLook(s: PatchState): Vec3 | null {
    if (!call) return null;
    if (s === 'notice' || s === 'roll') return jackAt(call.jack);
    if (s === 'drawer' || s === 'work') return drawerAt(call.jack);
    if (s === 'check') return spec.stations[call.station] ?? null;
    if (s === 'reply') return spec.phone;
    return null;
  }

  /** Back to the job it was doing, or to sitting. */
  function carryOn(): void {
    lookAt = null;
    if (call && resume && isJob(resume.state)) {
      const r = resume;
      resume = null;
      // a roll interrupted goes on from where the stool is now, to the same jack
      if (r.state === 'roll') {
        if (!rollTo(workX(call.jack), false)) afterRoll();
        return;
      }
      if (r.state === 'plug') {
        afterRoll();
        return;
      }
      enter(r.state, r.elapsed);
      return;
    }
    resume = null;
    enter('seated');
  }

  /** Something interrupts a job stage: remember where it was. */
  function interrupt(): void {
    if (isJob(state) && call) resume = { state, elapsed: seconds() };
  }

  const seatedOrWorking = (): boolean => state === 'seated' || isJob(state);

  // the desk tells Patch when the job it may hold is dropped
  function onCancel(c: Call, why: 'cord' | 'undo'): void {
    if (c !== call) return;
    call = null;
    if (resume) resume = null;
    plan = null;
    if (roll && !roll.home) roll = null;
    if (afoot || !(seatedOrWorking() || state === 'stare' || state === 'look')) return; // lifted, off the edge or walking: it will find out
    if (why === 'cord') {
      lookAt = boardOf(ctx).plugAt ?? jackAt(c.jack);
      enter('stare');
    } else {
      cancelledAt = ctx.clock.step;
      lookAt = null;
      enter('seated');
    }
  }

  function setDown(part: Id, cause: Cause | null): void {
    if (ctx.mode(part) !== 'machine') return;
    const h = ctx.halfExtents(part)?.[1] ?? 0.3;
    ctx.drive(part, { p: [spec.shelf[0], spec.shelf[1] + h + 0.01, spec.shelf[2]], q: ctx.pose(part)?.q ?? [0, 0, 0, 1] }, true);
    ctx.release(part, [0, 0, 0], [0, 0, 0], cause);
  }

  /** Set the caught part down on the shelf: its rest is the throw's (committed this step); the job ends after it. */
  function letGoOfCatch(): void {
    const h = holding;
    holding = null;
    if (!h) return;
    setDown(h.id, h.cause);
    if (h.job) finishing.push({ job: h.job, part: h.id, until: ctx.clock.step + steps(3) });
  }

  /** Watch the parts in flight; answer one coming at it. */
  function watch(): void {
    const now = ctx.clock.step;
    const c = bodyCentre();
    for (const w of [...watched]) {
      const mode = ctx.mode(w.id);
      const pose = ctx.pose(w.id);
      if (now > w.until || mode !== 'free' || !pose) {
        watched.splice(watched.indexOf(w), 1);
        continue;
      }
      const v = scale(sub(pose.p, w.last), HZ);
      w.last = pose.p;
      const r = spec.body.radius + Math.max(...(ctx.halfExtents(w.id) ?? [0.3, 0.3, 0.3]));
      if (w.answer === null) {
        if (!seatedOrWorking()) continue;
        // where is it going? when its fall first meets Patch's body, and where it passes nearest its middle
        let hit: number | null = null;
        let nearest: { d: number; p: Vec3 } = { d: Infinity, p: pose.p };
        for (let k = 1; k <= Math.round(T.horizon * HZ); k++) {
          const t = k / HZ;
          const p: Vec3 = [pose.p[0] + v[0] * t, pose.p[1] + v[1] * t + 0.5 * g * t * t, pose.p[2] + v[2] * t];
          const d = dist(p, c);
          if (d < r && hit === null) hit = t;
          if (d < nearest.d) nearest = { d, p };
          else if (hit !== null) break;
        }
        if (hit === null || hit > T.lead) continue;
        const y = nearest.p[1] - spec.seat[1];
        const size = ctx.part(w.id)?.size;
        const answer: PatchAnswer = y > spec.body.head ? 'duck' : y >= spec.body.hands && size !== 'L' && length(v) < T.catchMax && holding === null ? 'catch' : 'bonk';
        w.answer = answer;
        w.cause = ctx.history.chargeMachine(w.id); // the throw's, while it flies (rule 4): a catch's rest is charged to it
        interrupt();
        lookAt = pose.p;
        enter(answer);
        ctx.emit({ type: 'patch.reacted', part: w.id, answer });
        if (answer === 'duck') watched.splice(watched.indexOf(w), 1);
        continue;
      }
      // it has chosen: meet the part when it arrives
      if (dist(pose.p, c) > r) continue;
      watched.splice(watched.indexOf(w), 1);
      if (w.answer === 'catch' && state === 'catch' && holding === null && ctx.take(w.id, id)) {
        const part = w.id;
        const cause = w.cause;
        // the throw stays on the stack while Patch holds what it threw (the window let go of it at the take)
        const job = cause !== null && cause !== 'crew' && cause !== 'system' ? ctx.history.work(cause, id, () => {
          if (holding?.id === part) holding = null; // undone (rule 10): the world puts the part back
        }) : null;
        holding = { id: part, cause, job };
      } else {
        const n = sub(pose.p, c);
        const ln = length(n) || 1;
        const u = scale(n, 1 / ln);
        const vn = dot(v, u);
        if (vn < 0) ctx.shove(w.id, scale(u, -(1 + T.bounce) * vn));
      }
    }
  }

  const unit: PatchUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: ['grab'],
    tell() {
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      ctx.emit({ type: 'misfire', id, level });
    },

    // S6: one grab: the world turns grab / carry / release of Patch into the `drag` intents below
    holds: (what: Id): boolean => what === id,

    intent(intent: Intent): boolean {
      if (intent.type !== 'drag' || intent.id !== id || ctx.bracketed) return false;
      // R1: hanging from the edge, or hauling itself up: it cannot be taken hold of until it is on its feet
      // (out of sight after a throw off the bench: nothing to take hold of)
      if (state === 'ledge' || state === 'haul' || state === 'away') return false;
      const taken = state !== 'held'; // the grab itself: where the hand took hold, not where it carries to
      // caught in the air: the scruff is where it was against the hand, eased onto the hand (no snap)
      if (taken) gripOff = state === 'fly' ? { off: sub([at[0], at[1] + T.hangBelow, at[2]], intent.target), at: ctx.clock.step } : null;
      if (taken) {
        trail.length = 0;
        ledge = null;
        fly = null;
        landing = null;
        walled = null;
        way = null;
        crossing = null;
        afoot = false;
        interrupt();
        back = null; // the cord's way back is given up: the line puts it back when attract mode ends
        if (roll?.home) roll = null; // the way home is given up; it carries on from where the stool is
        if (holding) {
          letGoOfCatch();
        }
        for (const w of watched) w.answer = null;
        lookAt = spec.visitor;
        enter('held');
      }
      at = intent.target;
      if (gripOff) {
        const k = Math.max(0, 1 - (ctx.clock.step - gripOff.at) / (T.catchEase * HZ));
        if (k <= 0) gripOff = null;
        else at = add(intent.target, scale(gripOff.off, k * k * (3 - 2 * k)));
      }
      if (!intent.end && !taken) {
        trail.push({ step: ctx.clock.step, p: intent.target });
        while (trail.length > 0 && ctx.clock.step - (trail[0] as { step: number }).step > Math.round(0.3 * HZ)) trail.shift();
      }
      if (intent.end) {
        // R4: let go with the hand moving, it flies (a scripted arc: never a physics body)
        const hv = handVelocity(intent.velocity);
        // (where its middle is: below the hand, or below where the hand caught it, eased)
        const mid: Vec3 = [at[0], at[1] - T.hangBelow, at[2]];
        if (Math.hypot(hv[0], hv[2]) >= T.throwAt || hv[1] >= T.upAt) {
          trail.length = 0;
          throwFrom(mid, hv);
          return true;
        }
        // let go still above the bench: it falls from where it was let go (I1: never put on the bench at once); from
        // a hand's height that is a set-down (on its feet, and home), from higher a landing by the height it fell
        if (mid[1] - spec.foot[1] > T.restMid + 0.02 && !overEdge(intent.target)) {
          trail.length = 0;
          throwFrom(mid, hv, true);
          return true;
        }
        const over = overEdge(intent.target);
        trail.length = 0;
        if (over) {
          // it goes over the edge and catches it: never carried by physics, nothing charged
          ledge = over;
          at = over.at;
          heading = Math.atan2(-over.out[0], -over.out[2]); // facing in, over the edge it holds
          lookAt = null;
          enter('ledge');
          return true;
        }
        const b = spec.bench;
        at = [Math.min(b.maxX, Math.max(b.minX, intent.target[0])), spec.foot[1], Math.min(b.maxZ, Math.max(b.minZ, intent.target[2]))];
        lookAt = null;
        if (dist(at, footNow()) >= 0.15) at = standingAt(at); // R2: never standing inside a body
        walkBack();
      }
      return true;
    },

    accept(): Outcome {
      return { ok: false, wanted: 'not-here' }; // no mouth: a part thrown at it is answered by `watch`
    },
    abort() {},

    lost(part: Id, _why: LostReason) {
      if (holding?.id === part) {
        holding.job?.done();
        holding = null;
      }
    },

    post() {
      for (const f of [...finishing])
        if (ctx.settled(f.part) || ctx.mode(f.part) !== 'free' || ctx.clock.step > f.until) {
          finishing.splice(finishing.indexOf(f), 1);
          f.job.done();
        }
      // (R5: kept for drawing between steps; read by `view()` only)
      lastAt = endAt;
      lastState = endState;
      endAt = at;
      endState = state;
    },

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        if (e.type === 'part.released' && e.speed >= T.throwMin && e.id !== id) {
          const p = ctx.pose(e.id);
          // S6: a part let go of inside Patch's body was not thrown at it (it would be answered at once, and again)
          const inside = p !== undefined && dist(p.p, bodyCentre()) < spec.body.radius;
          if (p && !inside) watched.push({ id: e.id, last: p.p, until: ctx.clock.step + steps(T.watch), answer: null, cause: null });
        } else if (e.type === 'undone' && e.by === 'lever' && e.cancelled.includes(spec.line) && cancelledAt === ctx.clock.step && state === 'seated') {
          // § E5's example: the lever pulled while Patch reached for the drawer; Patch looks at the lever
          lookAt = spec.lever;
          enter('look', 0, T.lever);
        }
      }
    },

    pre() {
      if (ctx.bracketed) {
        since += 1; // frozen: no stage advances while a rung plays
        return;
      }
      const desk = deskOf(ctx);
      if (desk && desk.onCancel !== onCancel) desk.onCancel = onCancel;
      watch();
      const t = seconds();
      if (call || desk?.next()) busyAt = ctx.clock.step;
      switch (state) {
        case 'seated':
          at = seatNow();
          heading = spec.facing;
          if (desk && !call) {
            const next = desk.next();
            if (next) {
              call = next;
              desk.start(next);
              const r = rollSeconds(stoolX, workX(next.jack));
              plan = [
                { state: 'notice', length: T.notice },
                ...(r > 0 ? [{ state: 'roll' as const, length: r }] : []),
                ...(needsPlug(next) ? [{ state: 'plug' as const, length: T.plug }] : []),
                { state: 'drawer', length: T.drawer },
                { state: 'work', length: T.work },
                { state: 'check', length: T.check },
                { state: 'reply', length: T.reply },
              ];
              enter('notice');
            } else if (runner && Math.abs(stoolX - restX) > 1e-6 && ctx.clock.step - busyAt >= steps(runner.quiet)) rollTo(restX, true);
          }
          break;
        case 'roll': {
          rolling(t);
          at = seatNow();
          heading = spec.facing;
          if (roll?.home) {
            // the way home: a text that comes meanwhile is picked up from wherever the stool is
            if (desk && !call && desk.next()) {
              roll = null;
              enter('seated');
              break;
            }
            if (t >= length_) {
              stoolX = roll.to;
              roll = null;
              enter('seated');
            }
            break;
          }
          if (back !== null && !call) {
            // to the jack the cord came from, to put it back
            if (t >= length_) {
              stoolX = roll?.to ?? stoolX;
              roll = null;
              plugging = { from: cordJack() as Id, to: back };
              enter('plug');
            }
            break;
          }
          if (!call || !desk) {
            roll = null;
            enter('seated');
            break;
          }
          lookAt = jobLook(state);
          if (t >= length_) {
            stoolX = roll?.to ?? stoolX;
            roll = null;
            afterRoll();
          }
          break;
        }
        case 'plug': {
          lookAt = plugging ? jackAt(plugging.to) : null;
          if (back !== null && !call) {
            if (t >= length_) {
              moveCord(back);
              back = null;
              plugging = null;
              busyAt = ctx.clock.step;
              enter('seated');
            }
            break;
          }
          if (!call || !desk) {
            plugging = null;
            enter('seated');
            break;
          }
          if (t >= length_) {
            const from = cordJack();
            if (moveCord(call.jack)) call.home = from;
            plugging = null;
            enter('drawer');
          }
          break;
        }
        case 'notice':
        case 'drawer':
        case 'work':
        case 'check':
        case 'reply': {
          if (!call || !desk) {
            enter('seated');
            break;
          }
          lookAt = jobLook(state);
          if (t < length_) break;
          const i = JOB.indexOf(state);
          if (state === 'work' && !desk.perform(call)) break; // dropped: `onCancel` has already moved Patch
          if (state === 'reply') {
            const c = call;
            call = null;
            plan = null;
            desk.finish(c);
            lookAt = null;
            busyAt = ctx.clock.step;
            // S6: a crew job that moved the cord puts it back where it was (attract mode only)
            if (c.crew && c.home && c.home !== cordJack() && !ctx.playMode) {
              back = c.home;
              if (!rollTo(workX(back), false)) {
                plugging = { from: cordJack() as Id, to: back };
                enter('plug');
              }
              break;
            }
            enter('seated');
            break;
          }
          if (state === 'notice') {
            if (!rollTo(workX(call.jack), false)) afterRoll();
            break;
          }
          enter(JOB[i + 1] as PatchState);
          break;
        }
        case 'stare':
          if (t >= length_) {
            lookAt = spec.visitor;
            enter('look');
          }
          break;
        case 'look':
          if (t >= length_) {
            if (afoot) {
              // R1: the look after the ledge ends in the walk back to the stool
              afoot = false;
              lookAt = null;
              walkBack();
            } else carryOn();
          }
          break;
        case 'duck':
        case 'bonk':
          if (t >= length_) carryOn();
          break;
        case 'ledge':
          if (ledge) at = ledge.at;
          if (t >= length_) enter('haul');
          break;
        case 'haul':
          if (ledge) {
            const k = Math.min(1, t / T.haul);
            at = add(ledge.at, scale(sub(ledge.up, ledge.at), k));
          }
          if (t >= length_) {
            if (ledge) at = ledge.up;
            afoot = true;
            enter('dust');
          }
          break;
        case 'dust':
          if (t >= length_) {
            ledge = null;
            lookAt = spec.visitor;
            enter('look');
          }
          break;
        case 'catch':
          if (holding) {
            const hands: Vec3 = add(seatNow(), [0, spec.body.hands + 0.15, 0.35]);
            const h = ctx.halfExtents(holding.id)?.[1] ?? 0.3;
            const goal = t < T.catchHold ? hands : add(hands, scale(sub([spec.shelf[0], spec.shelf[1] + h + 0.01, spec.shelf[2]], hands), Math.min(1, (t - T.catchHold) / T.catchSet)));
            // into its hands quickly but not in one jump; then along the way to the shelf
            const cur = ctx.pose(holding.id) ?? { p: goal, q: [0, 0, 0, 1] };
            const p = add(cur.p, scale(sub(goal, cur.p), t < T.catchHold ? 0.3 : 0.6));
            ctx.drive(holding.id, { p, q: cur.q } as Pose);
            lookAt = p;
          }
          if (t >= length_) {
            letGoOfCatch();
            carryOn();
          }
          break;
        case 'held':
          break;
        case 'walk': {
          // R2: round things, never through them (sim/crew/patch-route.ts)
          // Fetch coming at it (Fetch drives its rounds and does not look out for Patch): it steps out of the way
          const mv = movers();
          const near = (p: Pt): { d: number; o: Obstacle | null } => {
            let best: { d: number; o: Obstacle | null } = { d: Infinity, o: null };
            for (const o of mv) {
              const d = distanceTo(o, p[0], p[1]);
              if (d < best.d) best = { d, o };
            }
            return best;
          };
          const here = near(pt(at));
          const fb = fetchBody();
          // R4 (Taylor: "They should still always be able to recover"): never waiting at its own stool for good. Within
          // a unit of the stool's foot for `lastStep` seconds, it takes the last step anyway: a loose part in the way
          // (a crate thrown to the stool's foot) is nudged aside, a crew move; Fetch or Revert in the way it waits for
          // (R5: or stopped short by the very thing that stands at the foot, however far short: the big crate's
          // far face is more than a unit from it)
          const foot = footNow();
          if (Math.hypot(foot[0] - at[0], foot[2] - at[2]) < 1 || footBlock) {
            if (nearFootAt < 0) nearFootAt = ctx.clock.step;
          } else nearFootAt = -1;
          if (nearFootAt >= 0 && ctx.clock.step - nearFootAt >= steps(T.lastStep)) {
            const inWay = mv.filter((o) => !o.id.endsWith(':ahead') && (distanceTo(o, foot[0], foot[2]) < R + 0.05 || !stepClear(pt(at), pt(foot), R, [o])));
            if (inWay.every((o) => ctx.mode(o.id) === 'free')) {
              for (const o of inWay) {
                const dx = o.x - foot[0], dz = o.z - foot[2];
                const d = Math.hypot(dx, dz) || 1;
                ctx.shove(o.id, [(dx / d) * T.nudge, 0.4, (dz / d) * T.nudge]);
              }
              nearFootAt = -1;
              way = null;
              heading = Math.atan2(foot[0] - at[0], foot[2] - at[2]);
              at = foot;
              enter('climb');
              break;
            }
          }
          const fetchBoxes = fb ? mv.filter((o) => o.id === fb || o.id === `${fb}:ahead`) : [];
          const fetchDist = (p: Pt): number => Math.min(Infinity, ...fetchBoxes.map((o) => distanceTo(o, p[0], p[1])));
          const fetchHere = fetchDist(pt(at));
          if (fetchBoxes.length > 0 && fetchHere < R) {
            // out of Fetch's way: of eight directions, the step that leaves it furthest from where Fetch will be,
            // among those clear of the fixed bodies (a step it can take: never into a body to escape Fetch)
            const stepAway = T.dash / HZ;
            let best: { p: Pt; d: number } | null = null;
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const q: Pt = [at[0] + Math.sin(a) * stepAway, at[2] + Math.cos(a) * stepAway];
              // (out of Fetch's way it may step onto Fetch's own tape: only the fixed bodies stop it)
              if (!legClear(pt(at), q, R, STATICS) || clearPoint(q, R, STATICS, routeBench)?.[0] !== q[0]) continue;
              // look a few steps on, so it does not step into a corner it cannot leave
              const q4: Pt = [at[0] + Math.sin(a) * stepAway * 6, at[2] + Math.cos(a) * stepAway * 6];
              // never past Fetch: no step nearer its body than it is now
              const real = fetchBoxes[0] as Obstacle;
              const dq = distanceTo(real, q[0], q[1]);
              if (dq < distanceTo(real, at[0], at[2]) - 1e-9 && dq < 1.2) continue;
              // the best: furthest from where Fetch will be in a moment (and a few steps on, still clear)
              const soon: Obstacle = fetchSeen ? { ...real, x: real.x + fetchSeen.vx * 0.3, z: real.z + fetchSeen.vz * 0.3 } : real;
              const d = distanceTo(soon, q[0], q[1]) + 0.5 * (legClear(q, q4, R, STATICS) ? distanceTo(soon, q4[0], q4[1]) : 0);
              if (!best || d > best.d) best = { p: q, d };
            }
            if (best && fetchDist(best.p) >= fetchHere - 1e-9) {
              heading = Math.atan2(best.p[0] - at[0], best.p[1] - at[2]);
              at = onGround(best.p);
              way = null; // its way is planned again from where it has stepped to
              retryAt = ctx.clock.step + 1;
              blockedAt = ctx.clock.step;
              break;
            }
          }
          // in Fetch's way and nowhere to dash: it stands still (it does not walk on into Fetch)
          if (fetchBoxes.length > 0 && fetchHere < R && t >= T.setOff) {
            if (blockedAt < 0) blockedAt = ctx.clock.step;
            break;
          }
          if (!way && ctx.clock.step >= retryAt) planBack(true); // shut in, or stopped: try again
          const next: Pt | undefined = way ? (way.points[0] ?? way.cross?.from) : undefined;
          if (t < T.setOff) {
            // first a look at the visitor, then it turns to face its way
            lookAt = t < T.setOff * 0.5 ? spec.visitor : null;
            if (t >= T.setOff * 0.5 && next && Math.hypot(next[0] - at[0], next[1] - at[2]) > 1e-6) heading = Math.atan2(next[0] - at[0], next[1] - at[2]);
            break;
          }
          lookAt = null;
          if (!way) break; // shut in: it waits where it is (clear of everything) and tries again
          const target = way.points[0];
          if (!target) {
            if (way.cross) {
              // at the belt: across it when there is a gap and the belt cannot carry it to a machine; else wait
              const c = way.cross;
              if (!crossSafe(at[0])) {
                planBack(true);
                break;
              }
              heading = c.side > 0 ? Math.PI : 0;
              // and nothing (Fetch) where it will land, nor coming there
              const land = BELT ? crossPoints(BELT, at[0], c.side, beltSurface() * (CROSS - T.crossOn * 0.5 - T.crossOff * 0.5), R).off : null;
              const landClear = !land || mv.every((o) => distanceTo(o, land[0], land[1]) >= R + 0.1);
              if (beltGap(at[0]) && landClear) {
                gapWaitAt = -1;
                crossing = { x: at[0], z0: at[2], side: c.side };
                way = null;
                enter('cross');
              } else if (gapWaitAt < 0) gapWaitAt = ctx.clock.step;
              else if (ctx.clock.step - gapWaitAt >= steps(T.retry * 2) && Math.abs(beltSurface()) < 0.1 && BELT) {
                // the belt is stopped with something on it just here: along the belt to a clear stretch
                gapWaitAt = -1;
                const lo = BELT.safe[0], hi = BELT.safe[1];
                const x2 = [at[0] - 0.9, at[0] + 0.9, at[0] - 1.8, at[0] + 1.8].find((x) => x >= lo && x <= hi && beltGap(x));
                if (x2 !== undefined) way = { points: [[x2, at[2]]], cross: { ...c, from: [x2, at[2]], x: x2 }, length: Math.abs(x2 - at[0]) };
              }
              break;
            }
            way = null;
            at = footNow();
            enter('climb');
            break;
          }
          const stepLen = pace / HZ;
          const dx = target[0] - at[0], dz = target[1] - at[2];
          const n = Math.hypot(dx, dz);
          const np: Pt = n <= stepLen ? target : [at[0] + (dx / n) * stepLen, at[2] + (dz / n) * stepLen];
          // something that moves in its way (Fetch, a crate): it stops, and after a moment finds another way
          // (each thing that moves: no step that brings it nearer than its footprint, nor nearer once it is that near)
          const closer = mv.some((o) => {
            const dn = distanceTo(o, np[0], np[1]);
            return dn < R && dn < distanceTo(o, at[0], at[2]) - 1e-9;
          });
          if (!stepClear(pt(at), np, R, mv) || closer) {
            if (blockedAt < 0) blockedAt = ctx.clock.step;
            // (R5: stopped by what stands at the stool's foot: the last step's wait counts from here)
            footBlock = mv.some((o) => {
              if (o.id.endsWith(':ahead') || distanceTo(o, foot[0], foot[2]) >= R) return false;
              const dn = distanceTo(o, np[0], np[1]);
              return !stepClear(pt(at), np, R, [o]) || (dn < R && dn < distanceTo(o, at[0], at[2]) - 1e-9);
            });
            if (ctx.clock.step - blockedAt >= steps(T.retry)) {
              blockedAt = -1;
              planBack(true);
            }
            break;
          }
          blockedAt = -1;
          footBlock = false;
          if (n > 1e-6) heading = Math.atan2(dx, dz);
          at = onGround(np);
          if (n <= stepLen) way.points.shift();
          break;
        }
        case 'fly': {
          // R4: thrown: a scripted arc under the world's gravity (never a physics body)
          const f = fly;
          if (!f) {
            walkBack();
            break;
          }
          // thrown up: near the top gravity eases off and it floats a moment, drifting on, before it falls (the
          // cartoon's beat; patch-float.ts). The pull is taken at the middle of the step's change in speed (a
          // midpoint step), so the speed through the top is smooth whatever the step lands on
          const pull = f.float > 0 ? floatPull({ ...f, v: [f.v[0], f.v[1] + (g * floatPull(f)) / (2 * HZ), f.v[2]] }) : 1;
          f.v = [f.v[0], f.v[1] + (g * pull) / HZ, f.v[2]];
          let np: Vec3 = [at[0] + f.v[0] / HZ, at[1] + f.v[1] / HZ, at[2] + f.v[2] / HZ];
          // (never above `topMid`: the sign, the lamp's arm and its chain hang over the back of the bench but are not
          // bodies; nothing up there stops it but this)
          if (np[1] > T.topMid) {
            np = [np[0], T.topMid, np[2]];
            f.v = [f.v[0], Math.min(0, f.v[1]), f.v[2]];
          }
          f.peak = Math.max(f.peak, np[1]);
          const top = ctx.scene.bench.top;
          const e = spec.edge;
          const outside = (p: Vec3): boolean => !!e && (p[0] < e.minX || p[0] > e.maxX || p[2] > e.maxZ);
          if (!f.out && !f.chute && outside(np)) {
            // over an open edge: within reach of it, it catches it (as when let go there); well clear, it is gone
            const over = np[1] <= top + T.reachUp && np[1] >= top - T.reachDown && Math.hypot(f.v[0], f.v[2]) <= T.catchSpeed ? edgeFor(np) : null;
            if (over) {
              fly = null;
              ledge = over;
              at = over.at;
              heading = Math.atan2(-over.out[0], -over.out[2]);
              enter('ledge');
              break;
            }
            f.out = true;
          }
          if (f.out) {
            if (!f.gone) {
              f.gone = true;
              ctx.emit({ type: 'patch.throw', phase: 'gone', speed: length(f.v) });
            }
            // (past the edge it still never goes through a body: met side-on, it falls straight)
            const met = SOLIDS.find((o) => sphereMeets(o, np[0], np[1], np[2], T.bodyR * 0.8));
            if (met) {
              // (and out from its side as it falls, never down inside it)
              const d = offTop(met, at[0], at[2]);
              f.v = [d[0] * 0.8, Math.min(f.v[1], 0), d[1] * 0.8];
              np = [at[0] + d[0] * 0.06, at[1] + f.v[1] / HZ, at[2] + d[1] * 0.06];
            }
            at = np;
            if (np[1] < top - 1.5) {
              fly = null;
              enter('away');
            }
            break;
          }
          // loose parts in its way are knocked, each once a throw (as a thrown crate knocks them: they join the
          // throw's transaction, so their rests are its); it gives up most of its level speed and comes down past
          const knockedNow: Solid[] = [];
          for (const id of ctx.parts()) {
            const mode = ctx.mode(id);
            if (mode === 'gone' || mode === 'chute' || ctx.part(id)?.kind === 'robot') continue;
            const pp = ctx.pose(id);
            const h = ctx.halfExtents(id);
            if (!pp || !h) continue;
            const reach = T.bodyR + Math.max(h[0], h[1], h[2]) * 0.85;
            if (dist(pp.p, np) > reach) {
              f.passing.delete(id); // (clear of one it was let go against: from now on it is in its way like any)
              continue;
            }
            if (f.passing.has(id)) continue; // (going on through one it was let go against)
            // (one in a machine or in the crew's hands is not knocked: it is in its way, like a body)
            if (f.knocked.has(id) || mode !== 'free') {
              // knocked already: after that it is in its way like anything else (it does not pass through it)
              knockedNow.push({ id, x: pp.p[0], z: pp.p[2], hx: h[0], hz: h[2], yaw: 0, y0: pp.p[1] - h[1], y1: pp.p[1] + h[1] });
              continue;
            }
            f.knocked.add(id);
            if (!ctx.bracketed) {
              f.txn ??= ctx.history.open('release', id, ctx.clock.step);
              ctx.history.claim(id, f.txn, ctx.clock.step);
              const sp = Math.hypot(f.v[0], f.v[2]);
              ctx.shove(id, [f.v[0] * T.knock, Math.max(0, f.v[1]) * 0.3 + Math.min(1.5, 0.3 + sp * 0.15), f.v[2] * T.knock]);
            }
            ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(f.v), what: id, ...(f.txn && f.txn !== 'crew' && f.txn !== 'system' ? { txn: f.txn } : {}) });
            f.v = [f.v[0] * T.keep, Math.min(f.v[1], 0.5), f.v[2] * T.keep];
            // (this step it goes no further in: the part moves off it under the knock; come down on it from above,
            // it is tipped off it as off any top, below)
            np = [at[0], at[1] + f.v[1] / HZ, at[2]];
            knockedNow.push({ id, x: pp.p[0], z: pp.p[2], hx: h[0], hz: h[2], yaw: 0, y0: pp.p[1] - h[1], y1: pp.p[1] + h[1] });
          }
          // Fetch and Revert are solid to it: it stops against them and drops beside them (and a part it has knocked)
          for (const b of [...robotBodies(), ...knockedNow]) {
            const meetsB = sphereMeets(b, np[0], np[1], np[2], T.bodyR);
            if (f.leaving.has(b.id)) {
              if (!meetsB) f.leaving.delete(b.id); // (clear of what it was let go against)
              if (!meetsB || boxDist(b, np) >= boxDist(b, at) - 1e-9 || !sphereMeets(b, np[0], np[1], np[2], T.bodyR * 0.8)) continue; // (leaving it: glancing along it, never deep in it)
            }
            if (!meetsB) continue;
            if (!f.knocked.has(b.id)) {
              f.knocked.add(b.id);
              // § E5: what a visitor's throw disturbs belongs to that throw. A robot hit (Fetch, Revert) is the
              // throw's too: its transaction is opened (or is the one already open) and the robot's body claimed
              // into its window, and the event carries it, so what the robot drops can be charged to it
              let txn: Cause | null = null;
              if (!ctx.bracketed && ctx.part(b.id)) {
                f.txn ??= ctx.history.open('release', b.id, ctx.clock.step);
                ctx.history.claim(b.id, f.txn, ctx.clock.step);
                txn = f.txn;
              }
              ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(f.v), what: b.id, ...(txn && txn !== 'crew' && txn !== 'system' ? { txn } : {}) });
            }
            // (resting on top of it: off it by its nearer side, as off any top)
            if (at[1] >= b.y1) {
              const d = offTop(b, at[0], at[2]);
              f.v = [d[0] * 2.2, Math.max(f.v[1], 0.6), d[1] * 2.2];
              np = [at[0] + f.v[0] / HZ, at[1] + f.v[1] / HZ, at[2] + f.v[2] / HZ];
              continue;
            }
            const ax = at[0] - b.x, az = at[2] - b.z;
            const an = Math.hypot(ax, az) || 1;
            f.v = [(ax / an) * 1.5, Math.min(f.v[1], 0), (az / an) * 1.5];
            np = [at[0] + f.v[0] / HZ, at[1] + f.v[1] / HZ, at[2] + f.v[2] / HZ];
            if (sphereMeets(b, np[0], np[1], np[2], T.bodyR) && distanceTo(b, np[0], np[2]) < distanceTo(b, at[0], at[2])) np = [at[0], np[1], at[2]];
            // (a part or robot that is itself moving into it, a crate sliding under a knock: it is pushed along in
            // front of it, out of its side, never left inside it)
            const dIn = distanceTo(b, np[0], np[2]);
            if (sphereMeets(b, np[0], np[1], np[2], T.bodyR * 0.8) && dIn < T.bodyR) {
              const d = offTop(b, np[0], np[2]);
              const push = T.bodyR - dIn + 0.01;
              np = [np[0] + d[0] * push, np[1], np[2] + d[1] * push];
            }
          }
          // never through a fixed body: met from the side, it stops there and drops (a wall, met flat, it sticks to
          // and slides down); come down on its top, tipped off
          for (const o of SOLIDS) {
            const meetsO = sphereMeets(o, np[0], np[1], np[2], T.bodyR);
            if (f.leaving.has(o.id)) {
              if (!meetsO) f.leaving.delete(o.id); // (clear of what it was let go against, thrown away from it)
              if (!meetsO || boxDist(o, np) >= boxDist(o, at) - 1e-9 || !sphereMeets(o, np[0], np[1], np[2], T.bodyR * 0.8)) continue; // (leaving it: glancing along it, never deep in it)
              // (it would go deeper: it slides along the face this step, the part of its step into the face taken
              // out, and keeps the throw's velocity for when it is clear)
              const n = offTop(o, at[0], at[2]);
              const dx = np[0] - at[0], dz = np[2] - at[2];
              const inn = Math.min(0, dx * n[0] + dz * n[1]);
              np = [np[0] - inn * n[0], np[1], np[2] - inn * n[1]];
              continue;
            }
            if (!meetsO) continue;
            const side = at[1] - T.bodyR < o.y1 - 0.03;
            const sp = Math.hypot(f.v[0], f.v[2]);
            if (side && o.y1 >= at[1] + T.wallAbove && sp >= T.wallSpeed && !f.chute) {
              // the old gag: flat against it, stuck a moment, then down it to the bench
              const n = offTop(o, at[0], at[2]);
              const nx = -f.v[0] / sp, nz = -f.v[2] / sp;
              const out: Vec3 = n[0] * nx + n[1] * nz > 0.3 ? [n[0], 0, n[1]] : [nx, 0, nz];
              ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(f.v), what: o.id, wall: true });
              walled = { out, speed: length(f.v) };
              fly = null;
              heading = Math.atan2(-out[0], -out[2]);
              enter('wall');
              break;
            }
            if (side && !f.knocked.has(o.id)) {
              f.knocked.add(o.id);
              ctx.emit({ type: 'patch.throw', phase: 'hit', speed: length(f.v), what: o.id });
            }
            if (!side) {
              // tipped off by the nearer side of its top (a long body, such as the belt: across it, not along);
              // come down on tops a few times over (in among the ramp's steps), it slides off to where it can stand
              f.tops += 1;
              if (f.tops > 3) {
                landAt(at, [0, 0, 0]);
                break;
              }
              const d = offTop(o, at[0], at[2]);
              f.v = [d[0] * 2.2, 1.4, d[1] * 2.2];
            } else f.v = [-f.v[0] * 0.12, Math.min(f.v[1], 0), -f.v[2] * 0.12];
            np = [at[0], at[1] + f.v[1] / HZ, at[2]];
            // still meeting something (wedged by two): out sideways, away from what it meets, a little each step
            const wedged = SOLIDS.find((q) => !f.leaving.has(q.id) && sphereMeets(q, np[0], np[1], np[2], T.bodyR));
            if (wedged) {
              const ax = at[0] - wedged.x, az = at[2] - wedged.z;
              const an = Math.hypot(ax, az) || 1;
              np = [at[0] + (ax / an) * 0.06, at[1] + Math.min(0, f.v[1]) / HZ, at[2] + (az / an) * 0.06];
              if (SOLIDS.some((q) => !f.leaving.has(q.id) && sphereMeets(q, np[0], np[1], np[2], T.bodyR))) np = [at[0] + (ax / an) * 0.06, at[1], at[2] + (az / an) * 0.06];
            }
            break;
          }
          if (state !== 'fly') break; // (slid off the tops it kept coming down on, or met a wall)
          if (np[1] <= top + T.restMid) {
            landAt(np, f.v);
            break;
          }
          // (and never in the air for ever: a throw lasts a few seconds at most)
          if (t > 4 && !f.chute) {
            landAt(np, [0, 0, 0]);
            break;
          }
          if (Math.hypot(f.v[0], f.v[2]) > 0.3) heading = Math.atan2(f.v[0], f.v[2]);
          // the last word: whatever moved it this step, it does not end the step in a fixed body
          const deeper = (o: Solid, c: Vec3): boolean => sphereMeets(o, c[0], c[1], c[2], f.leaving.has(o.id) ? T.bodyR * 0.8 : T.bodyR * 0.95) && (!f.leaving.has(o.id) || boxDist(o, c) < boxDist(o, at) - 1e-9);
          if (SOLIDS.some((o) => deeper(o, np))) {
            const fall: Vec3 = [at[0], np[1], at[2]];
            np = SOLIDS.some((o) => deeper(o, fall)) ? at : fall;
            f.v = [0, Math.min(f.v[1], 0), 0];
          }
          at = np;
          break;
        }
        case 'land': {
          // R4: a bounce and a roll that eats the speed, ending sat up
          const l = landing;
          if (l) {
            const k = Math.min(1, t / Math.min(T.land, length_));
            const e = 1 - (1 - k) * (1 - k);
            at = add(l.from, scale(sub(l.to, l.from), e));
          }
          if (t >= length_) {
            if (l) at = l.to;
            enter('shake', 0, shakeLength(l?.fall ?? 0));
          }
          break;
        }
        case 'shake':
          if (t >= length_) {
            // a shake of the head, then the look at the visitor; then it gets up and walks home
            landing = null;
            afoot = true;
            lookAt = spec.visitor;
            enter('look');
          }
          break;
        case 'wall': {
          // R4: stuck flat to the wall a moment, then down it to the bench, where it lands and sits
          if (t < T.stick) break;
          // (a slide that reads even from low on the wall: it takes at least `slideMin` seconds to the bench)
          if (walled && walled.slideFrom === undefined) walled.slideFrom = at[1];
          const drop = Math.max(0.05, (walled?.slideFrom ?? at[1]) - (ctx.scene.bench.top + T.restMid));
          const v = Math.min(Math.max(T.slideDown, drop / T.slideMost), (t - T.stick) * 4, drop / T.slideMin + 0.05);
          const ny = at[1] - v / HZ;
          if (ny <= ctx.scene.bench.top + T.restMid) {
            const w = walled;
            walled = null;
            landAt([at[0] + (w ? w.out[0] * 0.15 : 0), at[1], at[2] + (w ? w.out[2] * 0.15 : 0)], [0, 0, 0]);
            break;
          }
          at = [at[0], ny, at[2]];
          break;
        }
        case 'away': {
          // R4: thrown well clear of the bench: out of sight; then up the chute and onto the bench by the pad
          if (t < length_) break;
          const c = spec.chute;
          if (!c) {
            landAt(standingAt(footNow()), [0, 0, 0]);
            break;
          }
          const land = standingAt([c.pad[0], spec.foot[1], c.pad[1]]);
          const tf = T.chuteFly;
          const v: Vec3 = [(land[0] - c.from[0]) / tf, (land[1] + T.bodyR - c.from[1]) / tf - 0.5 * g * tf, (land[2] - c.from[2]) / tf];
          at = c.from;
          fly = newFly(v, true);
          heading = Math.atan2(v[0], v[2]);
          ctx.emit({ type: 'patch.throw', phase: 'chute', speed: length(v) });
          enter('fly');
          break;
        }
        case 'cross': {
          // R2: up onto the rail, two quick steps across while the belt carries it, down the far side
          const c = crossing;
          if (!c || !BELT) {
            crossing = null;
            walkBack(true);
            break;
          }
          const b = BELT.bed;
          const on = T.crossOn, over = T.crossOver;
          // carried the way the belt runs while its feet are on it (it stops just short of either end of the safe stretch)
          if (t > on * 0.5 && t < on + over + T.crossOff * 0.5) c.x = Math.min(BELT.safe[1], Math.max(BELT.safe[0], c.x + beltSurface() / HZ));
          const zIn = b.z + c.side * b.hz * 0.6, zOut = b.z - c.side * b.hz * 0.6;
          const zOff = crossPoints(BELT, c.x, c.side, 0, R).off[1];
          const ease = (k: number): number => k * k * (3 - 2 * k);
          let z: number, y: number;
          if (t < on) {
            const k = ease(Math.min(1, t / on));
            z = c.z0 + (zIn - c.z0) * k;
            y = spec.foot[1] + (BELT.top - spec.foot[1]) * Math.min(1, k * 1.4);
          } else if (t < on + over) {
            z = zIn + (zOut - zIn) * ease((t - on) / over);
            y = BELT.top;
          } else {
            const k = ease(Math.min(1, (t - on - over) / T.crossOff));
            z = zOut + (zOff - zOut) * k;
            y = BELT.top + (spec.foot[1] - BELT.top) * k;
          }
          at = [c.x, y, z];
          heading = c.side > 0 ? Math.PI : 0;
          if (t >= length_) {
            crossing = null;
            at = standingAt([c.x, spec.foot[1], zOff]);
            walkBack(true);
          }
          break;
        }
        case 'climb': {
          const k = Math.min(1, t / T.climb);
          at = add(footNow(), scale(sub(seatNow(), footNow()), k));
          if (t >= length_) {
            at = seatNow();
            heading = spec.facing;
            carryOn();
          }
          break;
        }
      }
    },

    reset() {
      call = null;
      resume = null;
      holding = null;
      finishing.length = 0;
      watched.length = 0;
      lookAt = null;
      roll = null;
      plan = null;
      back = null;
      plugging = null;
      ledge = null;
      way = null;
      crossing = null;
      fly = null;
      landing = null;
      walled = null;
      afoot = false;
      trail.length = 0;
      stoolX = restX;
      busyAt = ctx.clock.step;
      at = spec.seat;
      heading = spec.facing;
      enter('seated');
    },

    crewView: () => ({ kind: 'patch', id, body: null, view: unit.view() }),

    view(): PatchView {
      return {
        kind: 'patch',
        id,
        station: spec.station,
        lamp: 'dark',
        misfire: null,
        state,
        stateTime: seconds(),
        stateLength: length_,
        at,
        heading,
        drawer: call && (state === 'drawer' || state === 'work' || state === 'check' || (resume !== null && ['drawer', 'work', 'check'].includes(resume.state))) ? call.jack : null,
        serving: call?.station ?? null,
        lookAt,
        holding: holding?.id ?? null,
        stool: { x: stoolX, rest: restX, min: runnerMin, roll: roll ? { from: roll.from, to: roll.to, home: roll.home } : null },
        plan,
        plug: state === 'plug' && plugging ? { ...plugging } : null,
        shelf: spec.shelf,
        foot: footNow(),
        ledge: ledge && (state === 'ledge' || state === 'haul' || state === 'dust') ? { edge: ledge.edge, at: ledge.at, up: ledge.up, out: ledge.out } : null,
        wall: state === 'wall' && walled ? { out: walled.out, stick: T.stick } : null,
        thrown:
          state === 'fly' || state === 'land' || state === 'shake'
            ? {
                v: fly ? fly.v : null,
                speed: landing ? landing.speed : fly ? length(fly.v) : 0,
                chute: fly?.chute ?? false,
                fall: landing ? landing.fall : fly ? Math.max(0, fly.peak - at[1]) : 0,
                drop: landing ? landing.drop : fly ? fly.drop || fly.up : false,
                top: !!fly && state === 'fly' && inFloat(fly),
                float: fly?.float ?? 0,
              }
            : null,
        // (R5: the step before's `at`, in the same sense; `at` itself across a jump or a change of state. Let go
        // from the hand, its middle a step before is where it hung then, under the hand)
        prevAt: at !== endAt ? at : lastState === endState ? lastAt : lastState === 'held' && endState === 'fly' ? [lastAt[0], lastAt[1] - T.hangBelow, lastAt[2]] : at,
        walk: state === 'walk' || state === 'cross' ? { pace, scamper: pace > T.walk, next: way ? onGround(way.points[0] ?? way.cross?.from ?? pt(footNow())) : null, waiting: state === 'walk' && seconds() >= T.setOff && (way === null || blockedAt >= 0) } : null,
      };
    },
  };
  // ── 2026-11-20 (prototype): a real body while it is held and thrown. Everything above is the scripted Patch and is
  // not changed by this; with `flight: 'body'` the module wraps this unit's intent, pre, post, heard, reset and view,
  // and reaches the script's own state only through the closures below. ──
  if (spec.flight === 'body') {
    const walkable = (q: Pt): boolean => planWay(q, pt(footNow()), R, offFoot([...STATICS, ...movers()]), routeBench, BELT, 0) !== null;
    embodyPatch(ctx, spec, unit, {
      T,
      state: () => state,
      seconds,
      length: () => length_,
      enter,
      at: () => at,
      setAt: (p) => void (at = p),
      heading: () => heading,
      setHeading: (h) => void (heading = h),
      seatNow,
      footNow,
      solids: SOLIDS,
      standingAt,
      canStand: (p) => {
        const c = standingAt(p);
        return Math.hypot(c[0] - p[0], c[2] - p[2]) < 0.02 && walkable(pt(c));
      },
      inView,
      restAt: (p) => {
        // (as `restingAt`, without its move into the visitor's view: where it lies is where it gets up, if it can;
        // the move into view is the body's own, a hop, after)
        const c0 = standingAt(p);
        if (walkable(pt(c0))) return c0;
        const bodies = [...STATICS, ...movers()];
        for (let ring = 1; ring <= 6; ring++) {
          const rad = ring * 0.25;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const q: Pt = [c0[0] + Math.cos(a) * rad, c0[2] + Math.sin(a) * rad];
            if (clearPoint(q, R, bodies, routeBench)?.[0] === q[0] && walkable(q)) return onGround(q);
          }
        }
        return c0;
      },
      edgeFor,
      grabbed: () => {
        // (what `intent` does as the hand takes hold of the scripted Patch)
        trail.length = 0;
        gripOff = null;
        ledge = null;
        fly = null;
        landing = null;
        walled = null;
        way = null;
        crossing = null;
        afoot = false;
        interrupt();
        back = null;
        if (roll?.home) roll = null;
        if (holding) letGoOfCatch();
        for (const w of watched) w.answer = null;
        lookAt = spec.visitor;
        enter('held');
      },
      idle: () => {
        // (what `pre` does every step before its state's own part)
        const desk = deskOf(ctx);
        if (desk && desk.onCancel !== onCancel) desk.onCancel = onCancel;
        watch();
        if (call || desk?.next()) busyAt = ctx.clock.step;
      },
      setLanding: (l) => void (landing = l),
      setWalled: (w) => void (walled = w),
      setLedge: (l) => void (ledge = l),
      ledge: () => ledge,
      setAfoot: (on) => void (afoot = on),
      setLookAt: (p) => void (lookAt = p),
      walkHome: (elapsed) => {
        // (`walkBack`, entered part-way into its set-off)
        if (dist(at, footNow()) < 0.15) {
          way = null;
          enter('climb');
          return;
        }
        planBack(false);
        pace = way && way.length > T.scamperOver ? T.scamper : T.walk;
        blockedAt = -1;
        enter('walk', elapsed);
      },
      carryOn,
      shakeLength,
      flopLength: (fall) => landLength(fall, true) - T.land,
    });
  }
  return unit;
}
