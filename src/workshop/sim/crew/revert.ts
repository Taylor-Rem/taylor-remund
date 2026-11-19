/**
 * Revert, the caretaker (REWRITE.md § B5; § B4 its cards; § E5 rules 8 and
 * 14). Low and wide on treads, deadpan, answers with printed cards. It lives
 * down a hatch in the bench top and comes up on a lift.
 *
 * What it does:
 * - **After the Button** (the rung's `revert` beat): it comes up through its
 *   hatch while the rung is already playing (if the hatch is clear), turns
 *   its crank through the rewind, and holds up the rung's card.
 * - **Whenever an undo runs** (the lever, the `U` key, "undo that"): it
 *   cranks at once if it is up, or rises while the change is already running
 *   backwards. The undo never waits for it. A card when the undo kept
 *   something (`card.revert.kept`: someone has moved that since) or when the
 *   lever found nothing left (`card.revert.nothing`).
 * - **After rung 3** it trundles to the Button and fits the cover, then goes
 *   back to its hatch.
 * - **Home again** (S7): standing on its hatch with nothing left to do (its
 *   card down), it waits a deadpan `homePause` and sinks (`sinking`: the
 *   lift takes it down over the rise time), then it is `below`. Called while
 *   it sinks, it rises again from where the lift is.
 * - **Between jobs**: when the bench is crowded (`crowded` stray crates or
 *   more, resting off the stack) it puts away the oldest one nobody has
 *   stirred for `aWhile` seconds (`ctx.putAway`, rule 14: onto the stack if
 *   there is room, else down the hatch as a spare), one every `awayGap`
 *   seconds, from where it stands. If the bench stays tidy for `parkAfter`
 *   seconds it trundles to where the window's light falls and powers down,
 *   one eye open.
 * - **Picked up** it is heavy (its part's mass) and goes limp; put down, it
 *   rights itself where it lies and carries on.
 *
 * Its rules (§ E5 rule 5, § B5 "the visitor always comes first"):
 * - It never moves a part. Its body is kinematic and it stops for anything
 *   in its way (and gives up after `blockedFor`); it does not rise through a
 *   covered hatch. (S7 round 2) Its trips are safe against the layout: it
 *   joins its track only by a straight leg clear of every fixed thing (after
 *   a short straight shuffle on its treads if it cannot turn where it
 *   stands), it never turns a corner into a fixed thing or a part, and with
 *   no room to turn mid-trip it backs straight off a little first. A trip
 *   home given up means its way home is shut: it parks instead, and tries
 *   again after `stuckRetry`. With no way onto its track at all it stays put. The one thing it does to a part is put it away, and only
 *   one nobody has touched, the visitor included, for `aWhile` seconds.
 * - Nothing it does commits, except the put-away (as `system`, by the
 *   world). Where it is and what it intends are transient.
 * - While a rung plays its body stays where it was (the world is recorded
 *   and rewound); what it does then is drawn from its view and the body
 *   catches up when the rung ends. A rung's `revert` beat calls it like any
 *   other call: down (stowed) it rises; sinking, it rises again from where
 *   its lift is. A rung without that beat (reduced motion) leaves the lift
 *   alone: a sinking Revert finishes sinking during it. When the rewind ends
 *   and it has nothing to do it stands by (`idle`), even if the next rung is
 *   already playing, and the next rung's beats start its next act from there.
 *
 * Its view is a `MachineView` of kind `revert` (see `RevertView`); its body
 * is the loose part `spec.body` (kind robot).
 */
import type { Cause, Id, Location, Outcome, Pose, RevertState, RevertView, SimEvent, StationId, Vec3 } from '../types.ts';
import type { Shape } from '../physics/port.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { qyaw, rotate, yawOf } from '../math.ts';
import { Beat, OK } from '../machine.ts';

/** Seconds, units per second, radians per second; tune here. Where and how much are scene numbers (`RevertSpec`). */
export const REVERT_TUNING = {
  /** From down in the hatch to standing on the bench. */
  rise: 0.9,
  /** The hatch's doors open (or shut) in this long. */
  doors: 0.3,
  /** Back on its hatch with nothing to do (its card down): it stands this long, deadpan, then sinks. */
  homePause: 1.2,
  /** Its hatch covered: it rattles the doors this long, then stays down. */
  stuck: 1.2,
  /** ...and does not try to come up to tidy again for this long. */
  stuckRetry: 20,
  /** Trundling: top speed, acceleration, turning on the spot. */
  speed: 1.4,
  accel: 3,
  turn: 2.6,
  /** Close enough to a waypoint, units; facing closely enough to drive, radians. */
  arrive: 0.03,
  aim: 0.12,
  /** The crank turns at this rate. */
  crankRate: 9,
  /** An undo's crank: this long, plus this much per field put back, at most this long. */
  undoCrank: { base: 0.9, per: 0.12, max: 2.4 },
  /**
   * R1: a card is read before anything else happens. It goes up only once Revert stands still facing the
   * visitor (turning to them first if it is more than `faceSlack` off), and it stays still and facing them
   * for `cardRead` seconds from then: the view's rise and flip (about `cardRise`) and the longest card's
   * read time, max(2.0 s, 1 s + 0.35 s a word) (tests/unit/sim/revert-card.test.ts holds every card to it).
   */
  cardRead: 3.9,
  cardRise: 0.7,
  faceSlack: 0.3,
  /** A card stays up this long (from when it goes up). */
  card: 4.4,
  /** Putting a part away takes this long (it turns to face it and sweeps). */
  sweep: 1.2,
  /** A part its own body brushed while sweeping: it waits at most this much longer for it to settle. */
  settle: 1.5,
  /** R3: carrying a crate in its pan home to drop it down the hatch: how far in front of its body the pan holds it. */
  pan: 0.08,
  /** At the Button, screwing the cover on. */
  fit: 1.2,
  /** After being put down: glaring this long before it carries on. */
  righting: 0.6,
  /** Set down off its hatch by the visitor: let alone this long, it heads home. */
  alone: 3,
  /** No room to turn: it backs straight off at this speed, at most this far a trip, to make room. */
  backSpeed: 0.5,
  backOff: 0.8,
  /** Something in its way: it waits this long, then gives up the trip. */
  blockedFor: 3,
  /** A misfire: a jolt, a glare. */
  jolt: 0.6,
} as const;

export interface RevertSpot {
  readonly x: number;
  readonly z: number;
  /** Radians about +Y; 0 faces +Z (the visitor). */
  readonly heading: number;
}

export interface RevertSpec {
  /** The unit's id (its view: `world.machine(id)`). */
  readonly id: Id;
  /** Its body: a loose part of kind robot (the id cards are printed `by`). */
  readonly body: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** Its hatch (where it comes up and goes home to), where the window's light falls, and beside the Button (to fit the cover). */
  readonly home: RevertSpot;
  readonly park: RevertSpot;
  readonly button: RevertSpot;
  /**
   * Its track (x, z): a line of waypoints from its hatch past the Button to where it parks, threading
   * between the fixed things. Every trip runs along it (from wherever it is, it first heads for the
   * nearest waypoint). `home`, `button` and `park` lie on it.
   */
  readonly path: readonly (readonly [number, number])[];
  /** The crate stack: ground point, radius, and how many crates it takes before put-aways go down the hatch instead. */
  readonly stack: { readonly at: readonly [number, number]; readonly radius: number; readonly max: number };
  /** Where it is when the visit begins. */
  readonly start: 'below' | 'up';
  /** "Crowded": this many stray crates resting off the stack. */
  readonly crowded: number;
  /** "Nobody has touched it for a while": seconds since anything last stirred it. */
  readonly aWhile: number;
  /** Seconds the bench must stay tidy before it parks. */
  readonly parkAfter: number;
  /** Seconds between two put-aways. */
  readonly awayGap: number;
  /**
   * S7: where the visitor is (as Fetch's `outward`). It sweeps a part from the part's far side, facing
   * the visitor, so the broom is seen. Default: straight out along +Z.
   */
  readonly outward?: Vec3;
  /**
   * R3: the pad the chute throws replacements onto (x, z, radius): with the stack, where Fetch looks for a crate
   * it may carry. When Fetch has had none for `heal.after` seconds in play mode, Revert puts back into
   * circulation every crate the visitor has not stirred for `heal.stir` seconds, one after another, until Fetch
   * has work again (Taylor, 2026-11-19: "the simulation will never get stuck because Fetch can't reach any boxes").
   */
  readonly pad?: { readonly at: readonly [number, number]; readonly radius: number };
  readonly heal?: { readonly after: number; readonly stir: number };
}

export interface RevertUnit extends MachineUnit {
  view(): RevertView;
}

export const CARD_KEPT = 'card.revert.kept';
export const CARD_NOTHING = 'card.revert.nothing';

type Purpose = 'cover' | 'park' | 'home' | 'sweep';

interface Route {
  readonly pts: (readonly [number, number])[];
  i: number;
  readonly purpose: Purpose;
  readonly heading: number;
  blocked: number;
  /** How far it has backed off this trip to make room to turn (S7 round 2). */
  backed: number;
  /** S7 round 2: the index of a point it reaches by backing straight off (to find room to turn onto its track), or -1. */
  readonly reverse: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function revert(spec: RevertSpec): UnitFactory {
  return (ctx) => createRevert(ctx, spec);
}

export function createRevert(ctx: SimContext, spec: RevertSpec): RevertUnit {
  const T = REVERT_TUNING;
  const dt = 1 / HZ;
  const body = spec.body;
  const half: Vec3 = ctx.halfExtents(body) ?? [0.87, 0.54, 0.66];
  const [hx, hy, hz] = half;
  const rng = ctx.rng(`revert:${spec.id}`);
  const beat = new Beat(ctx);

  let state: RevertState = 'below';
  let entered = ctx.clock.step;
  let x = spec.home.x;
  let z = spec.home.z;
  let heading = spec.home.heading;
  /** Height of the floor it stands on (0: the bench top; more after being put down on something). */
  let ground = 0;
  let lift = 0;
  let hatch = 0;
  let crank = 0;
  let crankUntil = -1;
  let speed = 0;
  let turning = 0;
  let card: { content: string; at: number } | null = null;
  /** R1: a card waiting to go up until Revert stands still facing the visitor; and when the one up has been read. */
  let pendingCard: string | null = null;
  let readUntil = -1;
  /** The step its last card came down (it sinks only a pause after that). */
  let cardDown = -Infinity;
  let route: Route | null = null;
  let coverPending = false;
  /**
   * The part it is putting away, when it was last stirred as the sweep began, and whether its own body has
   * brushed it since (turning on the spot inside its kinematic collider). A stir it caused itself does not
   * count; the visitor's does, and clears `brushed`.
   */
  let sweeping: { part: Id; stir: number; brushed: boolean } | null = null;
  /** Out on a job (a sweep, the cover) and owed the trip home afterwards. */
  let away = false;
  /** R3: the crate in its pan, on its way home to go down the hatch (and come back up the chute); null when the pan is empty. */
  let carrying: Id | null = null;
  /** R3: since when Fetch has had nothing it may carry (play mode), or -1. */
  let starvedSince = -1;
  /** R3: the step it last put a crate away (the dock's last resort waits for it). */
  let lastPutAway = -Infinity;
  /** R3: when the visitor took the crate out of its pan (it looks at the empty pan). */
  let emptyPanAt = -Infinity;
  /** When its last trip home gave up (something in the way); -Infinity when its way home is open. */
  let homeShutAt = -Infinity;
  /** Its body is out of the world because it is down in its hatch (not because the dock shipped it). */
  let stowed = false;
  let resetting = false;
  let tidySince = ctx.clock.step;
  /** No put-away before this step (one every `awayGap`; longer after its hatch was found covered). */
  let nextAway = -Infinity;
  let glareUntil = -1;
  const lastStir = new Map<Id, number>();

  const enter = (next: RevertState): void => {
    if (next === state) return;
    const from = state;
    state = next;
    entered = ctx.clock.step;
    ctx.emit({ type: 'crew.state', id: body, state: next, from });
  };
  const inState = (): number => ctx.clock.step - entered;
  /** Up on the bench and able to act (rising and sinking are neither up nor down). */
  const up = (): boolean => state !== 'below' && state !== 'rising' && state !== 'sinking' && state !== 'stuck';
  const loose = (): boolean => state === 'held' || state === 'loose';

  /** Where its body should be: on the bench at (x, z), lowered by the lift. */
  const drawnPose = (): Pose => ({ p: [x, ground + hy + (lift - 1) * (2 * hy + 0.02), z], q: qyaw(heading) });

  // ── its body ──
  function stow(): void {
    if (ctx.mode(body) !== 'gone') ctx.stow(body, drawnPose());
    stowed = true;
  }
  /** Make the body match its state: out of the world while down, in its own hands while up. */
  function place(teleport: boolean): void {
    if (loose()) return;
    const mode = ctx.mode(body);
    if (lift < 0.5) {
      if (mode !== 'gone') stow();
      stowed = true;
      return;
    }
    if (mode === 'gone' || mode === 'chute') {
      ctx.launch(body, drawnPose(), [0, 0, 0], [0, 0, 0], null);
      teleport = true;
    }
    if (ctx.mode(body) === 'free') {
      ctx.attach(body, body);
      teleport = true;
    }
    stowed = false;
    if (ctx.mode(body) === 'crew') ctx.drive(body, drawnPose(), teleport);
  }

  ctx.crewFor(body, {
    grabbed() {
      // picked up: heavy, limp; it lets go of whatever it was doing (the cover is still owed), the pan's crate too
      if (carrying && ctx.mode(carrying) === 'crew') ctx.detach(carrying, [0, 0, 0], [0, 0, 0], 'crew');
      carrying = null;
      sweeping = null;
      route = null;
      speed = 0;
      turning = 0;
      lift = 1;
      tidySince = ctx.clock.step;
      enter('held');
    },
    taken(part: Id) {
      // R3: the visitor took the crate out of its pan: theirs at once; it looks at its empty pan and goes home
      if (part === carrying) {
        carrying = null;
        emptyPanAt = ctx.clock.step;
      }
    },
  });

  if (spec.start === 'up') {
    lift = 1;
    enter('idle');
    place(true);
  } else stow();

  // ── what is in its way ──
  /** A part that overlaps its footprint at (px, pz) facing `h` (and, when moving, that it would come closer to). */
  function blocker(px: number, pz: number, h: number, from?: readonly [number, number]): Id | null {
    return blockers(px, pz, h, from)[0] ?? null;
  }
  function blockers(px: number, pz: number, h: number, from?: readonly [number, number]): Id[] {
    const s = Math.sin(h);
    const c = Math.cos(h);
    const out: Id[] = [];
    for (const id of ctx.parts()) {
      if (id === body || id === carrying) continue;
      const m = ctx.mode(id);
      if (m === 'gone' || m === 'chute' || m === 'held') continue;
      const p = ctx.pose(id)?.p;
      const e = ctx.halfExtents(id);
      if (!p || !e) continue;
      if (p[1] - e[1] > ground + 2 * hy) continue; // above it
      const r = Math.max(e[0], e[2]) * 0.8;
      const dx = p[0] - px;
      const dz = p[2] - pz;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) >= hx + r || Math.abs(lz) >= hz + r) continue;
      if (from && Math.hypot(p[0] - from[0], p[2] - from[1]) < Math.hypot(dx, dz)) continue; // moving away from it
      out.push(id);
    }
    return out;
  }

  /** Its body at (px, pz) facing `h` would be off the bench or in a fixed thing (the layout; parts aside). */
  function fixedHit(px: number, pz: number, h: number): boolean {
    const [ex, ez] = span(hx, hz, h);
    const b = ctx.scene.bench;
    if (px - ex < b.minX || px + ex > b.maxX || pz - ez < b.minZ || pz + ez > b.maxZ) return true;
    return fixed.some(([fx, fz, fhx, fhz, fyaw]) => overlaps(px, pz, hx, hz, h, fx, fz, fhx, fhz, fyaw, 0));
  }
  /** A straight drive from (ax, az) to (bx, bz), facing the way, clear of the layout along its whole length. */
  function legClear(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return true;
    const h = Math.atan2(bx - ax, bz - az);
    for (let t = 0; t <= len + 1e-9; t += 0.1) if (fixedHit(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, h)) return false;
    return !fixedHit(bx, bz, h);
  }
  /** Turning on the spot at (px, pz) from one heading to another, the short way, clear of the layout. */
  function turnClearOfLayout(px: number, pz: number, from: number, to: number): boolean {
    const d = wrap(to - from);
    const n = Math.max(2, Math.ceil(Math.abs(d) / (T.turn / HZ)));
    for (let k = 1; k <= n; k++) if (fixedHit(px, pz, from + (d * k) / n)) return false;
    return true;
  }

  /**
   * The waypoint nearest (px, pz). The hatch (the track's first point) is only ever a destination: for any
   * trip but the one home it is skipped, so a trip elsewhere never heads for its hatch first (it may be covered).
   */
  const nearestOnPath = (px: number, pz: number, home = true): number => {
    let best = 0;
    let bd = Infinity;
    spec.path.forEach(([wx, wz], i) => {
      if (i === 0 && !home && spec.path.length > 1) return;
      const d = Math.hypot(wx - px, wz - pz);
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  };

  /**
   * A trip along its track to `to` (S7 round 2: safe against the layout as it stands). From wherever it is it
   * joins the track at the nearest waypoint it can drive straight to, turning on the spot and driving clear
   * of every fixed thing (the track itself, its spurs and the ways in to its stands are checked where they
   * are made: the track by the scene's tests, a stand by `standFor`). False, and no trip, when there is no
   * such way onto the track: it stays where it is.
   */
  function goTo(to: RevertSpot, purpose: Purpose, via: readonly (readonly [number, number])[] = []): boolean {
    const pts: (readonly [number, number])[] = [];
    let reverse = -1;
    const leave = via[0] ?? [to.x, to.z];
    if (spec.path.length > 0) {
      const home = purpose === 'home';
      const join = joinAt(home);
      if (!join) return false;
      const ci = join.i;
      if (join.pre) {
        if (join.back) reverse = pts.length;
        pts.push(join.pre);
      }
      const ti = nearestOnPath(leave[0], leave[1], home);
      const c = spec.path[ci] as readonly [number, number];
      const [sx, sz] = join.pre ?? [x, z];
      // onto the track first (unless it is there, or the track's point is where it is going anyway)
      if (Math.hypot(c[0] - sx, c[1] - sz) > 0.05 && Math.hypot(c[0] - leave[0], c[1] - leave[1]) > 0.05) pts.push(c);
      const dir = Math.sign(ti - ci);
      for (let i = ci + dir; dir !== 0 && i !== ti; i += dir) pts.push(spec.path[i] as readonly [number, number]);
      // the waypoint it leaves the track from, when the place is off it (a spur, a stand by a part)
      const t = spec.path[ti] as readonly [number, number];
      if (ti !== ci && Math.hypot(t[0] - leave[0], t[1] - leave[1]) > 0.05) pts.push(t);
    }
    pts.push(...via, [to.x, to.z]);
    if (spec.path.length === 0 && !legClear(x, z, pts[0]![0], pts[0]![1])) return false;
    route = { pts, i: 0, purpose, heading: to.heading, blocked: 0, backed: 0, reverse };
    if (purpose === 'cover' || purpose === 'sweep') away = true;
    if (state !== 'present') enter('trundle'); // presenting a card: it sets off once the card has been read
    return true;
  }

  /** No new trip is planned before this step (a trip that found no way onto the track: it does not re-plan every step). */
  let noRouteUntil = -Infinity;
  /** Start a trip if there is a way; otherwise stay where it is (and try again after `blockedFor`). */
  function trip(to: RevertSpot, purpose: Purpose, via: readonly (readonly [number, number])[] = []): boolean {
    const now = ctx.clock.step;
    if (now >= noRouteUntil && goTo(to, purpose, via)) return true;
    if (now >= noRouteUntil) noRouteUntil = now + steps(T.blockedFor);
    if (purpose === 'home') homeShutAt = now; // no way home from here: it parks if it can
    if (purpose === 'sweep') sweeping = null;
    route = null;
    if (state === 'trundle') enter('idle');
    return false;
  }

  /** The waypoint it joins the track at: the nearest it can turn toward and drive straight to clear of the layout; -1 if none. */
  /**
   * Where it joins the track: the nearest waypoint it can turn toward and drive straight to, clear of the
   * layout; where it cannot turn where it stands, first a short straight shuffle forward or back (on its
   * treads, no turning) to where it can. Null when there is no such way.
   */
  function joinAt(home: boolean): { readonly i: number; readonly pre: readonly [number, number] | null; readonly back: boolean } | null {
    const order = spec.path
      .map((w, i) => ({ i, d: Math.hypot(w[0] - x, w[1] - z) }))
      .filter((c) => home || c.i !== 0 || spec.path.length === 1)
      .sort((a, b) => a.d - b.d || a.i - b.i);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (const shift of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
      const sx = x + fx * shift;
      const sz = z + fz * shift;
      if (shift !== 0) {
        let ok = true;
        for (let t = 0.1; t <= Math.abs(shift) + 1e-9 && ok; t += 0.1) ok = !fixedHit(x + fx * Math.sign(shift) * t, z + fz * Math.sign(shift) * t, heading);
        if (!ok) continue;
      }
      for (const { i } of order) {
        const [wx, wz] = spec.path[i] as readonly [number, number];
        const pre = shift === 0 ? null : ([sx, sz] as const);
        if (Math.hypot(wx - sx, wz - sz) <= 0.05) return { i, pre, back: shift < 0 };
        const h = Math.atan2(wx - sx, wz - sz);
        if (turnClearOfLayout(sx, sz, heading, h) && legClear(sx, sz, wx, wz)) return { i, pre, back: shift < 0 };
      }
    }
    return null;
  }

  const near = (s: RevertSpot, d = 0.08): boolean => Math.hypot(x - s.x, z - s.z) < d;
  /** Standing on its hatch (on the bench top, over the doors). */
  const onHatch = (): boolean => Math.hypot(x - spec.home.x, z - spec.home.z) < Math.max(hx, hz) && ground < 0.05;
  /** Standing squarely on its hatch, where the lift is: the only place it goes down from. */
  const atHome = (): boolean => near(spec.home, 0.08) && ground < 0.05;

  // ── where it stands to sweep (S7) ──
  /** The fixed things it could run into, as boxes on the bench top (x, z, half x, half z, yaw); flat things are left out. */
  const fixed: readonly (readonly [number, number, number, number, number])[] = (ctx.scene.statics ?? []).flatMap((st) => {
    const sh: Shape = st.shape;
    const parts = sh.type === 'box' ? [{ half: sh.half, at: { p: [0, 0, 0] as Vec3, q: [0, 0, 0, 1] as const } }] : sh.parts;
    const yaw = yawOf(st.pose.q);
    return parts.flatMap((pt) => {
      const c = rotate(st.pose.q, pt.at.p);
      const cy = st.pose.p[1] + c[1];
      if (cy + pt.half[1] < 0.1 || cy - pt.half[1] > 2 * hy) return []; // the bench top, a runner; or overhead
      return [[st.pose.p[0] + c[0], st.pose.p[2] + c[2], pt.half[0], pt.half[2], yaw + yawOf(pt.at.q as Pose['q'])] as const];
    });
  });
  /** Half extents on x and z of a box (hx, hz) turned by `h`. */
  const span = (ax: number, az: number, h: number): readonly [number, number] => {
    const c = Math.abs(Math.cos(h));
    const s = Math.abs(Math.sin(h));
    return [c * ax + s * az, s * ax + c * az];
  };
  /** Two boxes on the bench top (centre, half extents, yaw) overlap, or come within `m` (separating axes). */
  function overlaps(ax: number, az: number, ahx: number, ahz: number, ah: number, bx: number, bz: number, bhx: number, bhz: number, bh: number, m: number): boolean {
    const ar = [Math.cos(ah), -Math.sin(ah)] as const;
    const af = [Math.sin(ah), Math.cos(ah)] as const;
    const br = [Math.cos(bh), -Math.sin(bh)] as const;
    const bf = [Math.sin(bh), Math.cos(bh)] as const;
    for (const ax_ of [ar, af, br, bf]) {
      const pa = Math.abs(ar[0] * ax_[0] + ar[1] * ax_[1]) * ahx + Math.abs(af[0] * ax_[0] + af[1] * ax_[1]) * ahz;
      const pb = Math.abs(br[0] * ax_[0] + br[1] * ax_[1]) * bhx + Math.abs(bf[0] * ax_[0] + bf[1] * ax_[1]) * bhz;
      if (Math.abs((bx - ax) * ax_[0] + (bz - az) * ax_[1]) >= pa + pb + m) return false;
    }
    return true;
  }
  /** Room for its body at (px, pz) facing `h`: on the bench, clear of every fixed thing and every part. */
  function room(px: number, pz: number, h: number): boolean {
    const [ex, ez] = span(hx, hz, h);
    const b = ctx.scene.bench;
    const m = 0.02;
    if (px - ex < b.minX + m || px + ex > b.maxX - m || pz - ez < b.minZ + m || pz + ez > b.maxZ - m) return false;
    for (const [fx, fz, fhx, fhz, fyaw] of fixed) if (overlaps(px, pz, hx, hz, h, fx, fz, fhx, fhz, fyaw, m)) return false;
    return blocker(px, pz, h) === null;
  }
  /** Its way in to a stand: it drives the last `approach` units straight in, facing the part. */
  const APPROACH = 1;
  /** A clear drive from (ax, az) to (bx, bz) facing the way it goes (the first stretch, near the track, is the track's). */
  function clearRun(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return true;
    const h = Math.atan2(bx - ax, bz - az);
    for (let t = Math.min(len, 0.3); t <= len + 1e-9; t += 0.15) if (!room(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, h)) return false;
    return true;
  }
  /** Room to turn on the spot at (px, pz) from one heading to another, the short way. */
  function clearTurn(px: number, pz: number, from: number, to: number): boolean {
    const d = wrap(to - from);
    const n = Math.max(2, Math.ceil(Math.abs(d) / (T.turn / HZ)));
    for (let k = 1; k <= n; k++) if (!room(px, pz, from + (d * k) / n)) return false;
    return true;
  }
  /**
   * Where it stands to sweep `part`, and the way in: on the part's far side from the visitor, facing them
   * across it, so the broom pushes toward them and is seen. It comes in straight, facing the part, from a
   * point `APPROACH` behind the stand (its body is wider than it is deep: it never sidles up to a part).
   * Where the bench leaves no room for that (the back wall, a machine, other parts, Fetch), the nearest
   * stand round the part (up to a quarter turn either way) that still keeps its front or side to the
   * visitor. Null when there is none: it sweeps from where it is.
   */
  function standFor(part: Id, any = false): { readonly at: RevertSpot; readonly via: readonly (readonly [number, number])[] } | null {
    const p = ctx.pose(part)?.p;
    const e = ctx.halfExtents(part);
    if (!p || !e) return null;
    const out = spec.outward ?? [p[0], 0, p[2] + 10];
    const toVisitor = Math.atan2(out[0] - p[0], out[2] - p[2]);
    const d = hz + Math.max(e[0], e[2]) + 0.12;
    // its front or side to the visitor first; (R3) when the bench has run dry, any side of the crate at all
    const turns = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, Math.PI / 2, -Math.PI / 2];
    if (any) for (let k = 1; k <= 6; k++) turns.push(Math.PI / 2 + (k * Math.PI) / 12, -Math.PI / 2 - (k * Math.PI) / 12);
    // the waypoints it may leave its track from, nearest first (the hatch only on the way home)
    const ways = spec.path.map((w, i) => ({ w, i })).filter((x) => x.i !== 0 || spec.path.length === 1);
    for (const a of turns) {
      const h = wrap(toVisitor + a);
      const sx = p[0] - Math.sin(h) * d;
      const sz = p[2] - Math.cos(h) * d;
      if (!room(sx, sz, h)) continue;
      for (const approach of any ? [APPROACH, APPROACH * 0.6] : [APPROACH]) {
        const qx = sx - Math.sin(h) * approach;
        const qz = sz - Math.cos(h) * approach;
        if (!room(qx, qz, h)) continue;
        if (spec.path.length === 0) return { at: { x: sx, z: sz, heading: h }, via: [[qx, qz]] };
        const order = [...ways].sort((m, n) => Math.hypot(m.w[0] - qx, m.w[1] - qz) - Math.hypot(n.w[0] - qx, n.w[1] - qz));
        for (const { w } of any ? order : order.slice(0, 1)) {
          if (!clearRun(w[0], w[1], qx, qz) || !clearTurn(qx, qz, Math.atan2(qx - w[0], qz - w[1]), h)) continue;
          return { at: { x: sx, z: sz, heading: h }, via: [[w[0], w[1]], [qx, qz]] };
        }
      }
    }
    return null;
  }

  /** One step along the route. True when it has arrived (facing the spot's heading). */
  function drive(r: Route): boolean {
    const target = r.pts[r.i];
    if (!target) {
      // at the end: turn to the spot's heading
      const d = wrap(r.heading - heading);
      const step = Math.sign(d) * Math.min(Math.abs(d), T.turn * dt);
      speed = 0;
      if (!canTurn(heading + step)) return backOff(r);
      heading += step;
      turning = step / dt;
      return Math.abs(d) < 1e-3;
    }
    const dx = target[0] - x;
    const dz = target[1] - z;
    const d = Math.hypot(dx, dz);
    if (d < T.arrive) {
      x = target[0];
      z = target[1];
      r.i += 1;
      return false;
    }
    if (r.i === r.reverse) {
      // backing straight off to where it has room to turn: no turning, never into anything
      const stepLen = Math.min(d, T.backSpeed * dt);
      const nx = x + (dx / d) * stepLen;
      const nz = z + (dz / d) * stepLen;
      turning = 0;
      if (blocker(nx, nz, heading, [x, z]) !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r);
      r.blocked = 0;
      speed = -T.backSpeed;
      x = nx;
      z = nz;
      return false;
    }
    const want = Math.atan2(dx, dz);
    const err = wrap(want - heading);
    turning = 0;
    const sharp = Math.abs(err) > T.aim;
    if (sharp) {
      // turn on the spot first (treads counter-rotate); still rolling, it slows to a stop first and does not
      // speed up again until it faces the way (S7: a short leg after a sharp corner used to circle its point)
      speed = Math.max(0, speed - T.accel * dt);
      const step = Math.sign(err) * Math.min(Math.abs(err), T.turn * dt);
      if (!canTurn(heading + step)) return backOff(r);
      heading += step;
      turning = step / dt;
      if (speed <= 0) return false;
    } else {
      heading += err * Math.min(1, 8 * dt);
      const stopping = (speed * speed) / (2 * T.accel);
      speed = d <= stopping + 1e-4 ? Math.max(0.15, speed - T.accel * dt) : Math.min(T.speed, speed + T.accel * dt);
    }
    const stepLen = Math.min(d, speed * dt);
    const nx = x + Math.sin(heading) * stepLen;
    const nz = z + Math.cos(heading) * stepLen;
    if (blocker(nx, nz, heading, [x, z]) !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r);
    r.blocked = 0;
    x = nx;
    z = nz;
    return false;
  }

  /**
   * Something is in the way (a part, or the layout where it was not expected): it never pushes. It stops and
   * waits; after `blockedFor` it gives up the trip (a trip home given up: its way home is shut, it parks).
   */
  function held(r: Route): false {
    speed = 0;
    turning = 0;
    r.blocked += 1;
    if (r.blocked >= steps(T.blockedFor)) {
      route = null;
      if (r.purpose === 'home') homeShutAt = ctx.clock.step;
      if (r.purpose === 'sweep') {
        sweeping = null;
        nextAway = Math.max(nextAway, ctx.clock.step + steps(spec.awayGap)); // it looks again later
      }
      enter('idle');
    }
    return false;
  }
  /** Room to turn on the spot to `h`: no fixed thing, and no part it does not already touch. */
  function canTurn(h: number): boolean {
    if (fixedHit(x, z, h) && !fixedHit(x, z, heading)) return false;
    const already = new Set(blockers(x, z, heading));
    return blockers(x, z, h).every((id) => already.has(id));
  }
  /**
   * No room to turn (a corner would swing into something): it backs straight off a little, if the way back
   * is clear, and tries the turn again; at most `backOff` units a trip, then it waits like any blocked trip.
   */
  function backOff(r: Route): false {
    const stepLen = T.backSpeed * dt;
    const nx = x - Math.sin(heading) * stepLen;
    const nz = z - Math.cos(heading) * stepLen;
    if (r.backed + stepLen > T.backOff || blocker(nx, nz, heading, [x, z]) !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r);
    x = nx;
    z = nz;
    r.backed += stepLen;
    speed = -T.backSpeed;
    turning = 0;
    return false;
  }

  // ── jobs ──
  function rise(): void {
    if (state === 'sinking') {
      // still in the hatch's mouth: back up from where the lift is (nothing can have covered the open hatch)
      enter('rising');
      return;
    }
    if (blocker(spec.home.x, spec.home.z, spec.home.heading) !== null) {
      enter('stuck'); // its hatch is covered: it will not push the visitor's things off it
      return;
    }
    x = spec.home.x;
    z = spec.home.z;
    heading = spec.home.heading;
    ground = 0;
    enter('rising');
  }

  /** Called to work (a rung, an undo): wake, come up if it is down, crank for `seconds` (now, or from when the rewind starts). */
  function call(seconds: number): void {
    tidySince = ctx.clock.step;
    sweeping = null;
    if (route?.purpose === 'sweep') route = null; // the bench is changing under it: that trip is off
    if (seconds > 0) crankUntil = Math.max(crankUntil, ctx.clock.step + steps(seconds));
    if (state === 'below' || state === 'sinking') rise();
    else if (state === 'park') enter('idle');
    else if (state === 'sweep') enter('idle');
  }

  /**
   * A card for Revert to hold up (R1). Up on the bench it is shown by presenting (state `present`): it
   * stops, faces the visitor, raises the card, and holds still for the read. Down its hatch, in a hand or
   * falling, there is nobody to turn: the card goes up at once.
   */
  function showCard(content: string): void {
    if (state === 'below' || state === 'sinking' || state === 'stuck' || state === 'held' || state === 'loose') {
      card = { content, at: ctx.clock.step };
      readUntil = ctx.clock.step;
      pendingCard = null;
      return;
    }
    pendingCard = content;
  }
  /** The heading that faces the visitor from where it stands. */
  const facing = (): number => {
    const o = spec.outward ?? [x, 0, z + 10];
    return Math.atan2(o[0] - x, o[2] - z);
  };
  /** One step of presenting a card: face the visitor, raise it, hold still for the read, then carry on. */
  function present(): void {
    speed = 0;
    turning = 0;
    const now = ctx.clock.step;
    if (pendingCard !== null) {
      const d = wrap(facing() - heading);
      if (Math.abs(d) > T.faceSlack * 0.5 && inState() < steps(T.cardRise + 1.5)) {
        const step = Math.sign(d) * Math.min(Math.abs(d), T.turn * dt);
        if (canTurn(heading + step)) {
          heading += step;
          turning = step / dt;
          return;
        }
        if (Math.abs(d) > T.faceSlack) return; // no room to turn yet: it waits (a little while at most)
      }
      card = { content: pendingCard, at: now };
      readUntil = now + steps(T.cardRead);
      pendingCard = null;
      return;
    }
    if (now < readUntil) return;
    // read: back to what it was doing
    if (route) enter('trundle');
    else if (coverPending && near(spec.button)) enter('fit');
    else enter('idle');
  }

  /** Crates resting off the stack: the clutter. */
  function strays(): Id[] {
    const [sx, sz] = spec.stack.at;
    return ctx.parts().filter((id) => {
      const p = ctx.part(id);
      if (!p || p.kind !== 'crate' || p.location.at !== 'rest' || ctx.mode(id) !== 'free' || !ctx.settled(id)) return false;
      const q = ctx.pose(id)?.p;
      // (R3) not on the chute's pad either: a crate there is in circulation, Fetch's to take
      const onPad = !!q && !!spec.pad && Math.hypot(q[0] - spec.pad.at[0], q[2] - spec.pad.at[1]) <= spec.pad.radius;
      return !!q && !onPad && Math.hypot(q[0] - sx, q[2] - sz) > spec.stack.radius;
    });
  }
  const stirred = (id: Id): number => lastStir.get(id) ?? 0;

  /** The oldest stray nobody has stirred for a while, if the bench is crowded. */
  function clutter(): Id | null {
    return clutterList()[0] ?? null;
  }
  /**
   * What it will tidy, oldest stirred first: the crowded rule's strays nobody has stirred for `aWhile`; and (R3),
   * when the bench has run dry for Fetch (`starving`), every crate lying still that the visitor has not stirred
   * for `heal.stir`, wherever it lies (on the stack too: a handled crate there is not Fetch's to take).
   */
  function clutterList(): Id[] {
    const now = ctx.clock.step;
    const s = strays();
    const crowded = s.length >= spec.crowded ? s.filter((id) => now - stirred(id) >= steps(spec.aWhile)) : [];
    const heal = starving() ? healable() : [];
    return [...new Set([...heal, ...crowded])].sort((a, b) => stirred(a) - stirred(b) || (a < b ? -1 : 1));
  }
  /** R3: a crate Fetch may carry now: one nobody has touched, lying still on the pad or the stack. */
  function fetchHasWork(): boolean {
    const [sx, sz] = spec.stack.at;
    return ctx.parts().some((id) => {
      const p = ctx.part(id);
      if (!p || p.kind !== 'crate' || ctx.touched(id) || ctx.mode(id) !== 'free' || p.location.at !== 'rest') return false;
      const q = ctx.pose(id)?.p;
      if (!q) return false;
      if (Math.hypot(q[0] - sx, q[2] - sz) <= spec.stack.radius) return true;
      return !!spec.pad && Math.hypot(q[0] - spec.pad.at[0], q[2] - spec.pad.at[1]) <= spec.pad.radius;
    });
  }
  /** R3: Fetch has had nothing it may carry for `heal.after` seconds (play mode). */
  const starving = (): boolean => !!spec.heal && starvedSince >= 0 && ctx.clock.step - starvedSince >= steps(spec.heal.after);
  /** R3: crates to put back into circulation: lying still, at rest, in nobody's hands, not stirred for `heal.stir`, and not already Fetch's to take. */
  function healable(): Id[] {
    const now = ctx.clock.step;
    const stir = steps(spec.heal?.stir ?? 30);
    return ctx.parts().filter((id) => {
      const p = ctx.part(id);
      if (!p || p.kind !== 'crate' || p.location.at !== 'rest' || ctx.mode(id) !== 'free' || !ctx.settled(id)) return false;
      return now - stirred(id) >= stir;
    });
  }
  /**
   * S7 round 2: the stray it will sweep next and where it stands to do it: the oldest that has a proper
   * stand (its far side, facing the visitor, or the nearest that keeps its front or side to them). A stray
   * with no clear stand is left for later; it is never swept from wherever Revert happens to be.
   */
  function nextSweep(): { readonly part: Id; readonly stand: NonNullable<ReturnType<typeof standFor>> } | null {
    for (const part of clutterList()) {
      const stand = standFor(part, starving());
      if (stand) return { part, stand };
    }
    return null;
  }

  function finishSweep(): void {
    const s = sweeping;
    sweeping = null;
    enter('idle');
    if (!s) return;
    const p = ctx.part(s.part);
    const pose = ctx.pose(s.part);
    // still on the bench, still nobody's (no hand on it since it was picked): into the dustpan and away it
    // goes (rule 14), wherever the sweep left it; otherwise leave it be
    if (!p || !pose || p.location.at !== 'rest' || ctx.mode(s.part) !== 'free' || stirred(s.part) !== s.stir) return;
    // R3: into the pan (rule 14: every history entry about it forgotten, a fresh crate again), and it carries it
    // home to drop it down the hatch; the chute gives it back onto the pad (the dock hears the put-away)
    const pan = panPose(s.part);
    ctx.emit({ type: 'revert.sweep', id: body, part: s.part, from: pose, to: { at: 'rest', pose: pan } });
    ctx.putAway(s.part, { at: 'rest', pose: pan });
    if (ctx.attach(s.part, body)) {
      carrying = s.part;
      ctx.drive(s.part, pan, true);
      trip(spec.home, 'home');
    }
    lastPutAway = ctx.clock.step;
    nextAway = ctx.clock.step + steps(spec.awayGap);
  }
  /** R3: where the pan holds a crate: on the bench just in front of its body. */
  function panPose(part: Id): Pose {
    const e = ctx.halfExtents(part) ?? [0.3, 0.3, 0.3];
    const d = hz + T.pan + e[2];
    return { p: [x + Math.sin(heading) * d, ground + e[1] + 0.02, z + Math.cos(heading) * d], q: qyaw(heading) };
  }
  /** R3: at its hatch with a crate in the pan: down it goes (as a spare, out of the world); the chute brings it back. */
  function dropCarried(): void {
    const c = carrying;
    carrying = null;
    if (!c || ctx.mode(c) !== 'crew') return;
    const from = ctx.pose(c);
    if (from) ctx.emit({ type: 'revert.sweep', id: body, part: c, from, to: { at: 'shipped' } });
    ctx.detach(c, [0, 0, 0], [0, 0, 0], 'crew'); // out of its pan first: a put-away takes a part out of the world only from the bench
    ctx.putAway(c, { at: 'shipped' });
    lastPutAway = ctx.clock.step;
  }

  /** What it does when nothing calls it. */
  function think(): void {
    const now = ctx.clock.step;
    if (strays().length >= spec.crowded) tidySince = now;
    if (state !== 'idle' && state !== 'park') return;
    if (coverPending && ground < 0.05) {
      if (near(spec.button) && Math.abs(wrap(heading - spec.button.heading)) < 1e-2) enter('fit');
      else trip(spec.button, 'cover');
      return;
    }
    if (now >= nextAway) {
      const n = nextSweep();
      if (n !== null) {
        sweeping = { part: n.part, stir: stirred(n.part), brushed: false };
        if (!(near(n.stand.at, 0.05) && Math.abs(wrap(heading - n.stand.at.heading)) < 0.05)) trip(n.stand.at, 'sweep', n.stand.via);
        else enter('sweep');
        return;
      }
      if (clutter() !== null) nextAway = now + steps(spec.awayGap); // strays it cannot get at: it looks again later
    }
    // away from its hatch: after a job, at once; set down by the visitor, once it has been let alone a few
    // seconds. Back home by its track (and then down). With its way home shut, it parks in the window's
    // light instead, and tries the way home again after a while.
    const shut = now - homeShutAt < steps(T.stuckRetry);
    if (state === 'idle' && !atHome() && ground < 0.05 && now - entered >= steps(away ? T.righting : T.alone)) {
      if (!shut) trip(spec.home, 'home');
      else if (carrying) {
        // R3: its way home is shut with a crate in the pan: it sets the crate down where it stands, for later
        if (ctx.mode(carrying) === 'crew') ctx.detach(carrying, [0, 0, 0], [0, 0, 0], 'crew');
        carrying = null;
      } else if (!near(spec.park)) trip(spec.park, 'park');
      else enter('park');
      return;
    }
    if (state === 'park' && !shut && homeShutAt > -Infinity && now - entered >= steps(T.stuckRetry)) {
      homeShutAt = -Infinity;
      trip(spec.home, 'home');
      return;
    }
    // home on its hatch with nothing to do: a deadpan pause, then down it goes
    const pause = steps(T.homePause);
    if (state === 'idle' && atHome() && !card && now - entered >= pause && now - cardDown >= pause && now >= crankUntil) {
      enter('sinking');
      return;
    }
  }

  /** Put down (or come to rest after the belt, the chute, an undo): it rights itself where it lies, glares, and carries on. */
  function rightItself(): void {
    const p = ctx.pose(body) as Pose;
    x = p.p[0];
    z = p.p[2];
    heading = yawOf(p.q);
    ground = Math.max(0, p.p[1] - hy);
    lift = 1;
    stowed = false;
    ctx.attach(body, body);
    ctx.drive(body, drawnPose(), true);
    glareUntil = ctx.clock.step + steps(T.righting);
    enter('idle');
  }

  /** The crank stops: back to the trip it was on, the cover it was fitting, or standing by. */
  function doneCranking(): void {
    if (route) enter('trundle');
    else if (coverPending && near(spec.button)) enter('fit');
    else enter('idle');
  }

  function arrive(r: Route): void {
    route = null;
    speed = 0;
    turning = 0;
    if (r.purpose === 'cover' && coverPending) enter('fit');
    else if (r.purpose === 'cover') trip(spec.home, 'home');
    else if (r.purpose === 'sweep' && sweeping) enter('sweep');
    else if (r.purpose === 'park') enter('park');
    else {
      if (r.purpose === 'home') {
        away = false;
        homeShutAt = -Infinity;
        dropCarried(); // R3: the crate in its pan goes down the hatch
      }
      enter('idle');
    }
  }

  const unit: RevertUnit = {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      ctx.emit({ type: 'tell', id: spec.id });
    },
    misfire(level) {
      beat.hit(level);
      glareUntil = ctx.clock.step + steps(T.jolt);
      ctx.emit({ type: 'misfire', id: spec.id, level });
    },
    // no mouth names Revert; were it offered a part, the part rests where it lies
    accept: (): Outcome => OK,
    abort(_cause: Cause) {},

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        // what stirs a part: anything happening to it. The part it is out to sweep (from the moment it picks
        // it, through the trip and the sweep) is stirred only by a hand: what its own body or the engine does
        // to it on the way (woken as Revert passes, brushed as it turns, settled again) does not count.
        const sw = sweeping;
        const own = (id: Id): boolean => sw !== null && id === sw.part;
        switch (e.type) {
          case 'effect':
            if (!own(e.effect.target)) lastStir.set(e.effect.target, ctx.clock.step);
            break;
          case 'part.rested':
            if (!own(e.id)) lastStir.set(e.id, ctx.clock.step);
            break;
          case 'part.grabbed':
          case 'part.released':
          case 'part.returned':
          case 'put-away':
            if (sw && e.id === sw.part) sw.brushed = false; // someone else's hand: that counts
            lastStir.set(e.id, ctx.clock.step);
            break;
          case 'part.hit':
            if (sw && (e.id === sw.part || e.other === sw.part)) sw.brushed = true;
            if (!own(e.id)) lastStir.set(e.id, ctx.clock.step);
            if (e.other && !own(e.other)) lastStir.set(e.other, ctx.clock.step);
            break;
          case 'taken-in':
          case 'shipped':
          case 'returned':
          case 'restocked':
            lastStir.set(e.part, ctx.clock.step);
            break;
          case 'reset':
            for (const id of ctx.parts()) lastStir.set(id, ctx.clock.step);
            break;
          default:
            break;
        }
        // its jobs
        if (e.type === 'rung.beat' && e.beat === 'revert') call(0);
        else if (e.type === 'rung.beat' && e.beat === 'rewind') {
          if (state !== 'below' && state !== 'stuck' && state !== 'sinking' && !loose()) crankUntil = Math.max(crankUntil, ctx.clock.step + steps(e.duration));
        } else if (e.type === 'card' && e.by === body) showCard(e.content);
        else if (e.type === 'cover' && e.state === 'fitting') coverPending = true;
        else if (e.type === 'cover' && (e.state === 'none' || e.state === 'shut')) {
          coverPending = false;
          if (route?.purpose === 'cover') trip(spec.home, 'home'); // fitted without it: back home
        }
        else if (e.type === 'undone') {
          const U = T.undoCrank;
          call(Math.min(U.max, U.base + U.per * e.restores.length));
          if (e.kept.length > 0) {
            showCard(CARD_KEPT);
            ctx.emit({ type: 'card', by: body, content: CARD_KEPT });
          }
        } else if (e.type === 'undo.refused' && e.by === 'lever' && e.reason === 'nothing') {
          call(T.undoCrank.base * 0.5);
          showCard(CARD_NOTHING);
          ctx.emit({ type: 'card', by: body, content: CARD_NOTHING });
        }
      }
    },

    pre() {
      const now = ctx.clock.step;
      if (card && now - card.at >= steps(T.card)) {
        card = null;
        cardDown = now;
      }
      const cranking = now < crankUntil && state !== 'held' && state !== 'loose';
      if (cranking) crank += T.crankRate * dt;
      const mode = ctx.mode(body);

      // ── its body in someone else's hands ──
      if (state === 'held' || state === 'loose') {
        if (mode === 'free' && ctx.settled(body)) rightItself();
        else enter(mode === 'held' ? 'held' : 'loose');
        return;
      }
      if (state !== 'below' && !stowed && mode !== 'crew' && mode !== undefined && !ctx.bracketed) {
        // someone else has its body (on the belt, shipped, put back by an undo): wait for it
        route = null;
        sweeping = null;
        enter(mode === 'held' ? 'held' : 'loose');
        return;
      }

      // ── the lift and the hatch ──
      if (state === 'rising') {
        lift = Math.min(1, lift + dt / T.rise);
        if (lift >= 1) enter(cranking ? 'crank' : 'idle');
      }
      if (state === 'sinking') {
        lift = Math.max(0, lift - dt / T.rise);
        if (lift <= 0) enter('below');
      }
      if (state === 'stuck' && inState() >= steps(T.stuck)) {
        nextAway = Math.max(nextAway, now + steps(T.stuckRetry));
        enter('below');
      }
      const doorsWant = state === 'rising' || state === 'sinking' || (up() && onHatch()) ? 1 : 0;
      hatch = doorsWant ? Math.min(1, hatch + dt / T.doors) : Math.max(0, hatch - dt / T.doors);

      // ── R3: Fetch's work, and the crate in its pan ──
      if (!ctx.bracketed) {
        // Fetch is busy with a crate: carrying one, or one rides the belt or rolls into the dock, or one is flying up the chute
        // (a crate held on the platen's tray is not Fetch's work)
        const busy = ctx.parts().some((id) => {
          const p = ctx.part(id);
          if (id === carrying || p?.kind !== 'crate') return false;
          const m = ctx.mode(id);
          return m === 'crew' || m === 'chute' || (m === 'machine' && p.location.at === 'in' && (p.location.mouth === 'belt' || p.location.mouth === 'dock'));
        });
        // (only where Fetch has rounds to run: a bench without them has nothing to starve)
        if (spec.heal && ctx.scene.runner.rounds && ctx.playMode && !busy && !fetchHasWork()) {
          if (starvedSince < 0) starvedSince = now;
        } else starvedSince = -1;
        if (carrying) {
          if (ctx.mode(carrying) !== 'crew') carrying = null;
          else if (!loose()) ctx.drive(carrying, panPose(carrying), false);
        }
      }

      // ── R1: a card is read before anything else happens (it waits for a crank to finish, then presents) ──
      if (pendingCard !== null && !cranking && state !== 'present' && state !== 'rising' && up()) {
        if (state === 'sweep') sweeping = null;
        if (state === 'crank') doneCranking();
        enter('present');
      }
      if (state === 'present') {
        present();
        if (!ctx.bracketed) place(false);
        return;
      }

      if (ctx.bracketed) {
        // a rung plays: its body stays put (the world is recorded and rewound); it only cranks, rises and sinks
        speed = 0;
        turning = 0;
        if (cranking && (state === 'idle' || state === 'park' || state === 'trundle' || state === 'fit')) enter('crank');
        if (state === 'crank' && !cranking) doneCranking(); // the rewind is over: it stands by, even into the next rung
        return;
      }

      // ── cranking takes over whatever it was doing; afterwards it picks up its trip ──
      if (cranking && (state === 'idle' || state === 'park' || state === 'trundle' || state === 'fit' || state === 'sweep')) {
        if (state === 'sweep') sweeping = null;
        speed = 0;
        turning = 0;
        enter('crank');
      }
      if (state === 'crank' && !cranking) doneCranking();

      switch (state) {
        case 'trundle': {
          const r = route;
          if (!r) {
            enter('idle');
            break;
          }
          if (drive(r)) arrive(r);
          break;
        }
        case 'fit':
          if (inState() >= steps(T.fit)) {
            coverPending = false;
            trip(spec.home, 'home');
          }
          break;
        case 'sweep': {
          const s = sweeping;
          const p = s ? ctx.pose(s.part)?.p : undefined;
          if (p) {
            const d = wrap(Math.atan2(p[0] - x, p[2] - z) - heading);
            const step = Math.sign(d) * Math.min(Math.abs(d), T.turn * dt);
            heading += step;
            turning = step / dt;
          }
          // a part something knocked may still be wobbling: it waits for it to settle (a little while at most)
          const wobbling = !!s && s.brushed && !ctx.settled(s.part) && inState() < steps(T.sweep + T.settle);
          if (inState() >= steps(T.sweep) && !wobbling) {
            turning = 0;
            finishSweep();
          }
          break;
        }
        default:
          speed = 0;
          turning = 0;
      }
      if (up()) think();
      else if (state === 'below' && now >= nextAway && clutter() !== null) {
        // it comes up to tidy only a stray it can get at
        if (nextSweep() !== null) rise();
        else nextAway = now + steps(spec.awayGap);
      }
      place(false);
    },

    reset() {
      route = null;
      carrying = null;
      starvedSince = -1;
      sweeping = null;
      coverPending = false;
      card = null;
      cardDown = -Infinity;
      pendingCard = null;
      readUntil = -1;
      crankUntil = -1;
      speed = 0;
      turning = 0;
      ground = 0;
      x = spec.home.x;
      z = spec.home.z;
      heading = spec.home.heading;
      lift = spec.start === 'up' ? 1 : 0;
      hatch = 0;
      tidySince = ctx.clock.step;
      nextAway = -Infinity;
      glareUntil = -1;
      away = false;
      homeShutAt = -Infinity;
      beat.reset();
      enter(spec.start === 'up' ? 'idle' : 'below');
      resetting = true;
      if (spec.start !== 'up') stow();
    },

    restored(restores) {
      if (resetting) {
        // the world has put every part back where the visit began; its body goes where it belongs
        resetting = false;
        place(true);
        return;
      }
      if (state === 'below' && restores.some((r) => r.target === body) && ctx.mode(body) !== 'gone') stow();
    },

    crewView: () => ({ kind: 'revert', id: spec.id, body, view: unit.view() }),

    view(): RevertView {
      const now = ctx.clock.step;
      const cranking = now < crankUntil && state !== 'held' && state !== 'loose';
      let eyes: RevertView['eyes'] = 'flat';
      if (state === 'held' || state === 'loose') eyes = 'rolled';
      else if (state === 'park') eyes = 'one';
      else if (state === 'stuck' || now < glareUntil) eyes = 'glare';
      else if (cranking || state === 'rising' || state === 'fit' || state === 'crank') eyes = 'open';
      return {
        kind: 'revert',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: beat.view(),
        body,
        state,
        stateTime: inState() / HZ,
        x,
        z,
        heading,
        lift,
        hatch: state === 'stuck' ? 0.08 * Math.abs(Math.sin(inState() * 0.42)) : hatch,
        crank,
        cranking,
        speed,
        turning,
        eyes,
        card: card ? { content: card.content, since: (now - card.at) / HZ, read: Math.max(0, readUntil - card.at) / HZ } : null,
        sweeping: state === 'sweep' ? (sweeping?.part ?? null) : null,
        carrying,
        emptyPan: (now - emptyPanAt) / HZ,
        starving: starving(),
        drawn: state !== 'held' && state !== 'loose',
      };
    },
  };
  return unit;
}
