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
 * - **Between jobs** (Taylor, 2026-11-20: "If even one is out of reach of the fetch, just have the robot come
 *   out pretty quickly to clean it up"): any crate Fetch may not carry, lying still on the bench in nobody's
 *   hands or machine, that nobody has stirred for `heal.stir` seconds, brings it out, nearest first, one at a
 *   time: it sweeps the crate into its pan, carries it home and drops it down its hatch (`ctx.putAway`,
 *   rule 14), and the dock sends it back up the chute. Not during a rung; a pile (a crate on a crate, or raised
 *   on a machine) only once it has stood still `heal.pile` seconds, from the top. Taken from under its nose,
 *   it looks at the hand and goes home.
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
 *   one nobody has stirred, the visitor included, for `heal.stir` seconds.
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
  /**
   * Its hatch covered: it rattles the doors. R3: after `knockAfter` seconds of wanting up with only crates lying on
   * the leaves, it knocks from below (two jumps of the leaves at `knocks`, each bumping what lies on them up by
   * `knockKick` units/s), and at `knockOpen` the leaves open and what lay on them drops in (a put-away: the
   * dock sends the same crate back up the chute). Fetch, Patch, or a crate in someone's hands on the hatch: it
   * waits for them to go (they do), at most `stuckWait`, then stays down as before.
   */
  stuck: 1.2,
  knockAfter: 3,
  knocks: [0, 0.5] as readonly number[],
  knockKick: 1.6,
  knockOpen: 1.1,
  stuckWait: 20,
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
  /**
   * R3: carrying a crate in its pan home to drop it down the hatch: the pan opens out round it from its inner edge
   * on the bracket, so the crate's inner face is this far out from Revert's centre line, its bottom this high on
   * the pan's floor (the view's `PAN` at Revert's drawn scale, 1.2: inner edge 0.56 plus a 0.06 lip, from a
   * footprint centred 0.015 off the piece's origin; floor 0.43 plus the sheet, 0.034 opened out).
   */
  pan: 0.762,
  panHeight: 0.557,
  /** R3: out to heal a dry bench, it first takes in the scene this long (the empty belt, Fetch waiting, the crate, the visitor). */
  survey: 2.4,
  /** R3 (2026-11-20): out for a crate while Fetch still has work: one short look at the crate and the visitor. */
  glance: 0.8,
  /** R3: the crate it was going for taken by the visitor: it looks at the hand this long, then goes home. */
  lookTaken: 0.9,
  /**
   * R4 (2026-11-20): let go or come to rest up off the bench's floor: after `perchBeat` it trundles off anything
   * up to `perchLow` high (a crate), dropping the last of the way; from anything higher, or where it cannot drive
   * off, it goes down where it is and comes back up through its own hatch. Thrown off the bench or refused by the
   * dock it never comes up the chute: after `returnBeat` it rises through its hatch, gives the visitor one long
   * look (`returnLook`), and goes back to what it was doing.
   */
  perchBeat: 1,
  perchLow: 0.9,
  returnBeat: 1.6,
  returnLook: 1.8,
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
  /** R3: something in its way it may not put away (a crate in a hand, Fetch, Patch): it waits this long, looking at it, before it gives the trip up. */
  waitFor: 10,
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
   * it may carry. Revert puts back into circulation any crate Fetch may not carry that nobody has stirred for
   * `heal.stir` seconds (Taylor, 2026-11-20); a pile only after `heal.pile`. When Fetch has had nothing it may
   * carry for `heal.after` seconds (the bench has run dry) it takes in the whole scene before it sets off.
   */
  readonly pad?: { readonly at: readonly [number, number]; readonly radius: number };
  readonly heal?: { readonly after: number; readonly stir: number; readonly pile: number };
}

export interface RevertUnit extends MachineUnit {
  view(): RevertView;
}

export const CARD_KEPT = 'card.revert.kept';
export const CARD_NOTHING = 'card.revert.nothing';

type Purpose = 'cover' | 'park' | 'home' | 'sweep' | 'off';

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
  /** R3: turning on the spot the long way round (+1 left, -1 right) because the short way swings into the layout; 0: the short way. */
  turnDir: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** R3: Patch's states on its feet on the bench, and its footprint's radius there (Revert waits for it). */
const PATCH_AFOOT = new Set(['walk', 'cross', 'look', 'stare', 'climb', 'land', 'shake', 'roll', 'dust']);
const PATCH_R = 0.4;

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
  /** R3: the crate it is about to set off for while it takes in the scene (the view looks at it), or null. */
  let surveyFor: Id | null = null;
  /** R3: when it began its look round this time up (-1: not yet; Infinity: done until it next comes up). */
  let surveyFrom = -1;
  /** R3: this look round is the whole scene (the bench dry), not the short look. */
  let surveyLong = false;
  /** R3: the crate it was going for was taken: it looks at it until `lookUntil`, then goes home first. */
  let lookAt: Id | null = null;
  let lookUntil = -1;
  let homeFirst = false;
  /** R4: it went home the way it knows (down, and up through its hatch): when to come up, and the long look after. */
  let returnAt = -1;
  let lookBackUntil = -1;
  /** R4: driving off a perch: where it set off from (the drop comes over the last stretch). */
  let offFrom: readonly [number, number] = [0, 0];
  let fall = 0;
  /** R3: the knock from below a covered hatch: when it began (-1: not yet), and how many knocks so far. */
  let knockAt = -1;
  let knocked = 0;
  /** R3: what is in its way while it waits (looked at), or null. */
  let waitingFor: Id | null = null;
  /** R3: a crate it may sweep up where it lies: loose on the bench, at rest, in nobody's hands or machine. */
  function sweepable(id: Id): boolean {
    const p = ctx.part(id);
    return !!p && p.kind === 'crate' && p.location.at === 'rest' && ctx.mode(id) === 'free' && ctx.settled(id);
  }
  /** R3: what lies on its hatch now: crates it may knock in, and whether anything else is there (it waits). */
  function onLeaves(): { crates: Id[]; other: boolean } {
    const ids = blockers(spec.home.x, spec.home.z, spec.home.heading);
    const crates: Id[] = [];
    let other = false;
    for (const id of ids) {
      if (ctx.part(id)?.kind === 'crate' && ctx.mode(id) === 'free') crates.push(id);
      else other = true;
    }
    return { crates, other };
  }
  /** R3: the leaves during a knock (steps since it began): a jump at each knock, flung open at `knockOpen`. */
  function knockLeaves(k: number): number {
    for (const t of T.knocks) {
      const d = (k - steps(t)) / HZ;
      if (d >= 0 && d < 0.25) return 0.22 * Math.sin((d / 0.25) * Math.PI);
    }
    return 0;
  }
  /** R3: one step of the stuck state: wait for the hatch to clear, or knock in the crates that lie on it. */
  function stuckStep(now: number): void {
    const T0 = T;
    const leaves = onLeaves();
    if (leaves.crates.length === 0 && !leaves.other) {
      comeUp();
      return;
    }
    if (knockAt < 0) {
      if (ctx.bracketed || leaves.other || inState() < steps(T0.knockAfter)) {
        if (inState() >= steps(T0.stuckWait)) {
          nextAway = Math.max(nextAway, now + steps(T0.stuckRetry));
          enter('below');
          // a card it was to hold up goes up from below after all: said again now it is down, so the stick holds it
          if (pendingCard !== null) {
            const content = pendingCard;
            pendingCard = null;
            ctx.emit({ type: 'card', by: body, content });
          }
        }
        return;
      }
      knockAt = now;
    }
    const k = now - knockAt;
    while (knocked < T0.knocks.length && k >= steps(T0.knocks[knocked]!)) {
      for (const id of leaves.crates) ctx.shove(id, [0, T0.knockKick, 0]);
      knocked++;
    }
    if (k < steps(T0.knockOpen)) return;
    if (ctx.bracketed) return; // (nothing is put away while a rung is bracketed: the leaves open after it)
    if (leaves.other) {
      knockAt = -1; // something came onto it meanwhile: it waits again
      knocked = 0;
      return;
    }
    // the leaves open: what lay on them drops in (each a put-away, said as its own drop is)
    for (const id of leaves.crates) {
      const from = ctx.pose(id);
      if (!from) continue;
      ctx.emit({ type: 'revert.sweep', id: body, part: id, from, to: { at: 'shipped' } });
      ctx.putAway(id, { at: 'shipped' });
    }
    lastPutAway = now;
    knockAt = -1;
    knocked = 0;
    comeUp();
  }
  /** R3: when the visitor took the crate out of its pan (it looks at the empty pan). */
  let emptyPanAt = -Infinity;
  /** When its last trip home gave up (something in the way); -Infinity when its way home is open. */
  let homeShutAt = -Infinity;
  /** Its body is out of the world because it is down in its hatch (not because the dock shipped it). */
  let stowed = false;
  let resetting = false;
  /** No put-away before this step (one every `awayGap`; longer after its hatch was found covered). */
  let nextAway = -Infinity;
  let glareUntil = -1;
  const lastStir = new Map<Id, number>();

  const enter = (next: RevertState): void => {
    if (next === state) return;
    const from = state;
    state = next;
    entered = ctx.clock.step;
    if (next === 'rising' || next === 'below') surveyFrom = -1;
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
      // (R4: a card it was about to hold up is not held up later, on landing: none at all for being thrown)
      pendingCard = null;
      returnAt = -1;
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
      if (p[1] - e[1] > ground + 2 * hy - 0.15) continue; // above it (or riding on its back: it slides off as it goes)
      // (R3: a crate at its full size and a little: a body that only brushes a crate still shoves it along, kinematic as it is; another robot whichever way it is turned)
      const r = ctx.part(id)?.kind === 'robot' ? Math.hypot(e[0], e[2]) + 0.03 : Math.max(e[0], e[2]) + 0.02;
      const dx = p[0] - px;
      const dz = p[2] - pz;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) >= hx + r || Math.abs(lz) >= hz + r) continue;
      if (from && Math.hypot(p[0] - from[0], p[2] - from[1]) < Math.hypot(dx, dz)) continue; // moving away from it
      out.push(id);
    }
    // R3: Patch on its feet on the bench (it is not a loose part): Revert waits for it as for anything in its way
    const pv = ctx.crewView('patch');
    if (pv && pv.kind === 'patch') {
      const v = pv.view as { state: string; at: Vec3 };
      if (PATCH_AFOOT.has(v.state) && v.at[1] < ground + 0.6) {
        const dx = v.at[0] - px;
        const dz = v.at[2] - pz;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const near = Math.abs(lx) < hx + PATCH_R && Math.abs(lz) < hz + PATCH_R;
        const away = from && Math.hypot(v.at[0] - from[0], v.at[2] - from[1]) < Math.hypot(dx, dz);
        if (near && !away) out.push('patch');
      }
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
    route = { pts, i: 0, purpose, heading: to.heading, blocked: 0, backed: 0, reverse, turnDir: 0 };
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

  /**
   * R3: a stand on the near side of `part` (in its way), reached straight from where it is: a turn on the spot,
   * a straight run to a point `APPROACH` (or less) behind the stand, a turn to face the part, and in. The
   * nearest such, or null.
   */
  function nearStand(part: Id): { readonly at: RevertSpot; readonly pts: (readonly [number, number])[] } | null {
    const p = ctx.pose(part)?.p;
    const e = ctx.halfExtents(part);
    if (!p || !e) return null;
    const d = hz + Math.max(e[0], e[2]) + 0.12;
    let best: { at: RevertSpot; pts: (readonly [number, number])[]; cost: number } | null = null;
    for (let k = 0; k < 24; k++) {
      const h = (k * Math.PI) / 12;
      const sx = p[0] - Math.sin(h) * d;
      const sz = p[2] - Math.cos(h) * d;
      if (!room(sx, sz, h)) continue;
      for (const approach of [APPROACH, APPROACH * 0.6, 0.3]) {
        const qx = sx - Math.sin(h) * approach;
        const qz = sz - Math.cos(h) * approach;
        const cost = Math.hypot(qx - x, qz - z) + approach;
        if (best && cost >= best.cost) continue;
        if (!room(qx, qz, h)) continue;
        const run = Math.atan2(qx - x, qz - z);
        const short = Math.hypot(qx - x, qz - z) < 0.05;
        if (!short && (!clearTurn(x, z, heading, run) || !clearRun(x, z, qx, qz) || !clearTurn(qx, qz, run, h))) continue;
        if (short && !clearTurn(x, z, heading, h)) continue;
        best = { at: { x: sx, z: sz, heading: h }, pts: [[qx, qz], [sx, sz]], cost };
      }
    }
    return best;
  }

  /**
   * R4: off a perch: a floor spot beside it it can stand on, nearest first (and the least turn), or null.
   */
  function perchExit(): { readonly at: readonly [number, number]; readonly heading: number } | null {
    const g = ground;
    ground = 0; // (clear as it will stand there, on the floor)
    try {
      for (const d of [1.3, 1.7, 2.2]) {
        for (let k = 0; k < 16; k++) {
          const turn = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
          const h = wrap(heading + turn);
          const qx = x + Math.sin(h) * d;
          const qz = z + Math.cos(h) * d;
          if (room(qx, qz, h)) return { at: [qx, qz], heading: h };
        }
      }
      return null;
    } finally {
      ground = g;
    }
  }
  /** R4: one step of driving off a perch: turn to the way off, roll, and drop the last of the way (a heavy thump). */
  function driveOff(r: Route): boolean {
    const target = r.pts[0]!;
    const dx = target[0] - x;
    const dz = target[1] - z;
    const d = Math.hypot(dx, dz);
    const err = wrap(Math.atan2(dx, dz) - heading);
    if (d > 0.05 && Math.abs(err) > 0.04) {
      const step = Math.sign(err) * Math.min(Math.abs(err), T.turn * dt);
      heading += step;
      turning = step / dt;
      speed = 0;
      return false;
    }
    turning = 0;
    const d0 = Math.max(0.1, Math.hypot(target[0] - offFrom[0], target[1] - offFrom[1]));
    if (d > 0.01) {
      speed = T.speed * 0.6;
      const stepLen = Math.min(d, speed * dt);
      x += (dx / d) * stepLen;
      z += (dz / d) * stepLen;
    } else speed = 0;
    // over the edge: the last 40% of the way it drops
    if (ground > 0 && Math.hypot(x - offFrom[0], z - offFrom[1]) >= 0.6 * d0) {
      fall += 9.8 * dt;
      ground = Math.max(0, ground - fall * dt);
    }
    if (d <= 0.01 && ground <= 0) {
      fall = 0;
      speed = 0;
      return true;
    }
    return false;
  }
  /** R4: it goes home the way it knows: down where it is, then (after a beat) up through its hatch with a long look. */
  function downAndHome(): void {
    route = null;
    sweeping = null;
    speed = 0;
    turning = 0;
    pendingCard = null;
    returnAt = ctx.clock.step + steps(T.returnBeat);
    if (state !== 'below' && state !== 'sinking') enter('sinking');
  }

  /** One step along the route. True when it has arrived (facing the spot's heading). */
  function drive(r: Route): boolean {
    if (r.purpose === 'off') return driveOff(r);
    const target = r.pts[r.i];
    if (!target) {
      // at the end: turn to the spot's heading
      const d = wrap(r.heading - heading);
      const step = Math.sign(d) * Math.min(Math.abs(d), T.turn * dt);
      speed = 0;
      if (!canTurn(heading + step)) return backOff(r, turnBlocker(heading + step));
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
      const by = blocker(nx, nz, heading, [x, z]);
      if (by !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r, by);
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
      let step = (r.turnDir || Math.sign(err)) * Math.min(r.turnDir ? T.turn * dt : Math.abs(err), T.turn * dt);
      if (!canTurn(heading + step)) {
        // R3: the short way round swings a corner into the layout (or a part): the long way, if that is clear
        if (r.turnDir === 0 && canTurn(heading - step) && turnClearOfLayout(x, z, heading, heading - Math.sign(step) * 0.75 * Math.PI)) {
          r.turnDir = -Math.sign(step);
          step = -step;
        } else return backOff(r, turnBlocker(heading + step));
      }
      heading += step;
      turning = step / dt;
      if (speed <= 0) return false;
    } else {
      r.turnDir = 0;
      heading += err * Math.min(1, 8 * dt);
      const stopping = (speed * speed) / (2 * T.accel);
      speed = d <= stopping + 1e-4 ? Math.max(0.15, speed - T.accel * dt) : Math.min(T.speed, speed + T.accel * dt);
    }
    const stepLen = Math.min(d, speed * dt);
    const nx = x + Math.sin(heading) * stepLen;
    const nz = z + Math.cos(heading) * stepLen;
    const by = blocker(nx, nz, heading, [x, z]);
    if (by !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r, by);
    r.blocked = 0;
    waitingFor = null;
    x = nx;
    z = nz;
    return false;
  }

  /**
   * Something is in the way (a part, or the layout where it was not expected): it never pushes. It stops and
   * waits; after `blockedFor` it gives up the trip (a trip home given up: its way home is shut, it parks).
   */
  function held(r: Route, by: Id | null = null): false {
    speed = 0;
    turning = 0;
    // R3: a crate lying in its way that it may put away: that crate is the next it takes (swept from a stand on
    // its near side), then it goes on; anything else in its way (a crate in a hand or a machine, Fetch, Patch):
    // it waits, looking at it, until it has moved or `waitFor` has passed, rather than give up and set off again
    // (blocked by the very crate it is going to sweep: it is there; it sweeps it from where it stands)
    if (by !== null && r.purpose === 'sweep' && sweeping?.part === by && !carrying && sweepable(by) && r.blocked === 0) {
      const near = nearStand(by);
      if (near) {
        waitingFor = null;
        route = { pts: near.pts, i: 0, purpose: 'sweep', heading: near.at.heading, blocked: 0, backed: 0, reverse: -1, turnDir: 0 };
        return false;
      }
      const p = ctx.pose(by)?.p;
      const e = ctx.halfExtents(by);
      if (p && e && Math.hypot(p[0] - x, p[2] - z) <= hz + Math.max(e[0], e[2]) + 0.35) {
        // within reach of it already: it sweeps it from here
        route = null;
        waitingFor = null;
        enter('sweep');
        return false;
      }
    }
    if (by !== null && r.blocked === 0 && !carrying && sweepable(by) && !(r.purpose === 'sweep' && sweeping?.part === by)) {
      const stand = nearStand(by);
      if (stand) {
        sweeping = { part: by, stir: stirred(by), brushed: false };
        waitingFor = null;
        route = { pts: stand.pts, i: 0, purpose: 'sweep', heading: stand.at.heading, blocked: 0, backed: 0, reverse: -1, turnDir: 0 };
        away = true;
        return false;
      }
    }
    if (by !== null) {
      waitingFor = by;
      r.blocked += 1;
      if (r.blocked < steps(T.waitFor)) return false;
    } else r.blocked += 1;
    if (r.blocked >= steps(T.blockedFor)) {
      waitingFor = null;
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
    already.delete('patch'); // (R3: Patch beside it is never swung into, however close it already stands)
    return blockers(x, z, h).every((id) => already.has(id));
  }
  /**
   * No room to turn (a corner would swing into something): it backs straight off a little, if the way back
   * is clear, and tries the turn again; at most `backOff` units a trip, then it waits like any blocked trip.
   */
  /** R3: the part a turn on the spot to `h` would swing into (one it does not already touch), or null. */
  function turnBlocker(h: number): Id | null {
    const already = new Set(blockers(x, z, heading));
    return blockers(x, z, h).find((id) => !already.has(id)) ?? null;
  }
  function backOff(r: Route, by: Id | null = null): false {
    const stepLen = T.backSpeed * dt;
    const nx = x - Math.sin(heading) * stepLen;
    const nz = z - Math.cos(heading) * stepLen;
    if (r.backed + stepLen > T.backOff || blocker(nx, nz, heading, [x, z]) !== null || (fixedHit(nx, nz, heading) && !fixedHit(x, z, heading))) return held(r, by ?? blocker(nx, nz, heading, [x, z]));
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
      // its hatch is covered: it rattles the leaves, and (R3) if only crates lie there, knocks them in
      if (state !== 'stuck') {
        enter('stuck');
        knockAt = -1;
        knocked = 0;
      }
      return;
    }
    comeUp();
  }
  /** Up through its hatch (nothing on it). */
  function comeUp(): void {
    x = spec.home.x;
    z = spec.home.z;
    heading = spec.home.heading;
    ground = 0;
    enter('rising');
  }

  /** Called to work (a rung, an undo): wake, come up if it is down, crank for `seconds` (now, or from when the rewind starts). */
  function call(seconds: number): void {
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
    // (R3: under a covered hatch it is coming up, by a knock if need be: it holds the card up once it is up)
    // (R4: in a hand, in the air or on its way home it cannot hold a card up: the stick holds it; not later on landing)
    if (state === 'held' || state === 'loose') return;
    if (state === 'below' || state === 'sinking') {
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

  const stirred = (id: Id): number => lastStir.get(id) ?? 0;

  /** The next crate to put away, if any. */
  function clutter(): Id | null {
    return clutterList()[0] ?? null;
  }
  /** R3 (2026-11-20): what it will put away, nearest first (none while a rung plays). */
  function clutterList(): Id[] {
    if (ctx.bracketed) return [];
    const at = up() ? [x, z] : [spec.home.x, spec.home.z];
    const d = (id: Id): number => {
      const p = ctx.pose(id)?.p;
      return p ? Math.hypot(p[0] - at[0]!, p[2] - at[1]!) : Infinity;
    };
    return healable().sort((a, b) => d(a) - d(b) || (a < b ? -1 : 1));
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
  /** R3: a crate Fetch may carry where it lies: nobody has touched it, and it is on the stack or the pad. */
  function fetchMay(id: Id): boolean {
    if (ctx.touched(id)) return false;
    const q = ctx.pose(id)?.p;
    if (!q) return false;
    const [sx, sz] = spec.stack.at;
    if (Math.hypot(q[0] - sx, q[2] - sz) <= spec.stack.radius) return true;
    return !!spec.pad && Math.hypot(q[0] - spec.pad.at[0], q[2] - spec.pad.at[1]) <= spec.pad.radius;
  }
  /**
   * R3: a crate in a pile: it rests on another loose part, or one rests on it, or it lies raised off the bench
   * top (stood on a machine). A tower the visitor is building is not eaten from the bottom: a pile is left
   * until it has stood still `heal.pile` seconds, then taken from the top.
   */
  function piled(id: Id): { readonly pile: boolean; readonly under: boolean } {
    const p = ctx.pose(id)?.p;
    const e = ctx.halfExtents(id);
    if (!p || !e) return { pile: false, under: false };
    const top = ctx.scene.bench.top;
    let pile = p[1] - e[1] > top + 0.06;
    let under = false;
    for (const o of ctx.parts()) {
      if (o === id || o === body || ctx.mode(o) === 'gone') continue;
      const q = ctx.pose(o)?.p;
      const f = ctx.halfExtents(o);
      if (!q || !f) continue;
      const side = Math.max(e[0], e[2]) + Math.max(f[0], f[2]);
      if (Math.abs(q[0] - p[0]) >= side * 0.9 || Math.abs(q[2] - p[2]) >= side * 0.9) continue;
      if (q[1] - f[1] >= p[1] + e[1] - 0.06 && q[1] - f[1] <= p[1] + e[1] + 0.15) {
        pile = true;
        under = true; // something stands on it
      } else if (p[1] - e[1] >= q[1] + f[1] - 0.06 && p[1] - e[1] <= q[1] + f[1] + 0.15) pile = true;
    }
    return { pile, under };
  }
  /**
   * R3 (Taylor, 2026-11-20): crates to put back into circulation: any crate Fetch may not carry, lying still at
   * rest on the bench, in nobody's hands or machine, not stirred for `heal.stir`. A pile waits `heal.pile` and
   * goes from the top (never a crate something stands on).
   */
  function healable(): Id[] {
    if (!spec.heal || !ctx.scene.runner.rounds || !ctx.playMode) return [];
    const now = ctx.clock.step;
    const stir = steps(spec.heal.stir);
    const pileStill = steps(spec.heal.pile);
    return ctx.parts().filter((id) => {
      const p = ctx.part(id);
      if (!p || p.kind !== 'crate' || p.location.at !== 'rest' || ctx.mode(id) !== 'free' || !ctx.settled(id)) return false;
      if (fetchMay(id)) return false;
      if (now - stirred(id) < stir) return false;
      const pl = piled(id);
      if (pl.under) return false;
      return !pl.pile || now - stirred(id) >= pileStill;
    });
  }
  /**
   * S7 round 2: the stray it will sweep next and where it stands to do it: the oldest that has a proper
   * stand (its far side, facing the visitor, or the nearest that keeps its front or side to them). A stray
   * with no clear stand is left for later; it is never swept from wherever Revert happens to be.
   */
  function nextSweep(): { readonly part: Id; readonly stand: NonNullable<ReturnType<typeof standFor>> } | null {
    for (const part of clutterList()) {
      // (a stand that keeps its front or side to the visitor first; any side of the crate rather than leave it)
      const stand = standFor(part, false) ?? standFor(part, true);
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
  /** R3: where the pan holds a crate: on the bench at its right side, where its dustpan rides (the view's `DUSTPAN`). */
  function panPose(part: Id): Pose {
    const e = ctx.halfExtents(part) ?? [0.3, 0.3, 0.3];
    const d = T.pan + e[0];
    // its local +x (heading 0 faces +Z): (cos h, -sin h) on the bench
    return { p: [x + Math.cos(heading) * d, ground + T.panHeight + e[1], z - Math.sin(heading) * d], q: qyaw(heading) };
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
    if (state !== 'idle' && state !== 'park') return;
    // R4: up off the bench's floor (set or thrown onto a crate, the stool, a machine): it gets itself down
    if (ground > 0.05) {
      if (now - entered < steps(T.perchBeat)) return;
      const exit = ground <= T.perchLow ? perchExit() : null;
      if (exit) {
        offFrom = [x, z];
        fall = 0;
        away = true;
        route = { pts: [exit.at], i: 0, purpose: 'off', heading: exit.heading, blocked: 0, backed: 0, reverse: -1, turnDir: 0 };
        enter('trundle');
      } else downAndHome();
      return;
    }
    // R4: back up through its hatch after being thrown: one long look at the visitor first
    if (now < lookBackUntil) return;
    // R3: the crate it was going for was taken: a look at the hand, then home (no other crate first)
    if (now < lookUntil) return;
    if (homeFirst && atHome()) homeFirst = false;
    if (coverPending && ground < 0.05) {
      if (near(spec.button) && Math.abs(wrap(heading - spec.button.heading)) < 1e-2) enter('fit');
      else trip(spec.button, 'cover');
      return;
    }
    // (never another crate while one is in its pan: home first)
    if (now >= nextAway && !carrying && !homeFirst) {
      const n = nextSweep();
      // R3: before it sets off from its hatch, a look: the whole scene when the bench has run dry for Fetch, else
      // one short look at the crate and the visitor (once each time it comes up)
      if (n !== null && state === 'idle' && atHome() && !carrying && surveyFrom !== Infinity) {
        if (surveyFrom < 0) {
          surveyFrom = now;
          surveyLong = starving();
        }
        if (now - surveyFrom < steps(surveyLong ? T.survey : T.glance)) {
          surveyFor = n.part;
          return;
        }
      }
      if (surveyFrom >= 0) surveyFrom = Infinity;
      surveyFor = null;
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
    /**
     * R4: its own body coming back up the chute (off the bench's edge, refused by the dock, come to rest too high):
     * not out of the chute and onto the bench: it is home, below; after a beat it comes up through its hatch.
     */
    catchReturn(part: Id): boolean {
      if (part !== body) return false;
      route = null;
      sweeping = null;
      carrying = null;
      pendingCard = null;
      speed = 0;
      turning = 0;
      x = spec.home.x;
      z = spec.home.z;
      heading = spec.home.heading;
      ground = 0;
      lift = 0;
      ctx.stow(body, drawnPose());
      stowed = true;
      returnAt = ctx.clock.step + steps(T.returnBeat);
      enter('below');
      return true;
    },
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
      // R4: down away from its hatch (off a perch, thrown, refused): it is home below; after a beat it comes up
      if (state === 'below' && (Math.abs(x - spec.home.x) > 1e-6 || Math.abs(z - spec.home.z) > 1e-6 || ground !== 0)) {
        x = spec.home.x;
        z = spec.home.z;
        heading = spec.home.heading;
        ground = 0;
      }
      if (state === 'below' && returnAt >= 0 && now >= returnAt && !ctx.bracketed) {
        returnAt = -1;
        lookBackUntil = now + steps(T.rise + T.returnLook);
        rise();
      }
      if (state === 'stuck') stuckStep(now);
      const doorsWant = state === 'rising' || ((state === 'sinking' || up()) && onHatch()) ? 1 : 0;
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
        // R3: the crate it was going for taken by the visitor before the sweep: it stops, looks at the hand, and goes
        // home (it never chases a crate in a hand; set down again, the crate's own while starts again)
        if (sweeping && !carrying && (state === 'sweep' || (state === 'trundle' && route?.purpose === 'sweep')) && ctx.mode(sweeping.part) === 'held') {
          lookAt = sweeping.part;
          lookUntil = now + steps(T.lookTaken);
          homeFirst = true;
          sweeping = null;
          route = null;
          speed = 0;
          turning = 0;
          enter('idle');
        }
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
      surveyFrom = -1;
      surveyFor = null;
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
      nextAway = -Infinity;
      homeFirst = false;
      lookAt = null;
      lookUntil = -1;
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
        hatch: state === 'stuck' ? (knockAt >= 0 ? knockLeaves(now - knockAt) : 0.08 * Math.abs(Math.sin(inState() * 0.42))) : hatch,
        knock: state === 'stuck' && knockAt >= 0 ? (now - knockAt) / HZ : -1,
        waitingFor: state === 'trundle' ? waitingFor : ctx.clock.step < lookUntil ? lookAt : null,
        crank,
        cranking,
        speed,
        turning,
        eyes,
        card: card ? { content: card.content, since: (now - card.at) / HZ, read: Math.max(0, readUntil - card.at) / HZ } : null,
        sweeping: state === 'sweep' ? (sweeping?.part ?? null) : null,
        carrying,
        bound: sweeping?.part ?? (state === 'idle' ? surveyFor : null),
        surveying: state === 'idle' && surveyFor !== null,
        surveyLength: surveyLong ? T.survey : T.glance,
        emptyPan: (now - emptyPanAt) / HZ,
        lookingBack: up() && now < lookBackUntil,
        starving: starving(),
        drawn: state !== 'held' && state !== 'loose',
      };
    },
  };
  return unit;
}
