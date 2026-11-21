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
 * - lifted off the stool, held and thrown, it is a real body (`held`, `fly`:
 *   sim/crew/patch-body.ts, which wraps this unit). When the body comes to
 *   rest this script takes over from where and how it lies: it gets up
 *   (`land`), shakes its head (`shake`), gives the visitor the look, walks
 *   back (`walk`, `cross` over the belt) and climbs up (`climb`). Met a wall
 *   flat it is stuck to it a moment and slides down it (`wall`); over an open
 *   edge low and slow it catches the edge and hangs from it (`ledge` 1.6 s),
 *   hauls itself up (`haul` 0.7 s), dusts itself off (`dust` 0.5 s); thrown
 *   off the bench it is out of sight (`away`) and comes back up the chute. A
 *   job in hand waits and carries on where it was; texts wait meanwhile;
 * - a part thrown at it gets one of three answers, chosen by where the part
 *   is going: high (at its head) it ducks; at its hands, and small enough
 *   and slow enough, it catches it and sets it down on the shelf beside the
 *   board (the rest charged to the throw, rule 4); otherwise it takes it on
 *   the head (`bonk`: the part bounces off; Patch gives it the look). Patch
 *   is never hurt.
 */
import type { Cause, Id, Outcome, PatchAnswer, PatchState, PatchView, Pose, SimEvent, StationId, Vec3 } from '../types.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { Job } from '../history.ts';
import type { UnitFactory } from '../scene.ts';
import type { Call } from '../machines/line.ts';
import { deskOf } from '../machines/line.ts';
import { boardOf } from '../machines/shared/patchlamp.ts';
import { HZ, steps } from '../clock.ts';
import { add, dist, dot, length, rotate, scale, sub } from '../math.ts';
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo, obstacles } from './fetch-knock.ts';
import { bodiesOf, legClear } from './fetch-route.ts';
import type { Pt } from './fetch-route.ts';
import { PATCH_ROUTE, clearPoint, crossPoints, planWay, segmentMeetsBox, solidsOf, sphereMeets, stepClear, wayExists } from './patch-route.ts';
import type { BeltCrossing, Box, Solid, Way } from './patch-route.ts';
import { embodyPatch } from './patch-body.ts';

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
  /** R1: over the edge: it hangs from the edge, hauls itself up, dusts itself off (then the look, and the walk back). */
  ledge: 1.6,
  haul: 0.7,
  dust: 0.5,
  /** Where it stands once up: this far in from the edge. */
  ledgeIn: 0.35,
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
  /** R4: let go with the hand moving at least this fast (units/s), it is thrown (a sound of one); slower is a set-down. */
  throwAt: 1.5,
  /** R4: the hardest it is sent at a wall it is flicked into (units/s, level): the parts' base cap (S5: 14). */
  throwMax: 14,
  /** R4: in the hand its body's middle hangs this far below the hand (the scruff): `at` while held is the hand. */
  hangBelow: 0.6,
  /** R4: its drawn body's reach round its middle (S7: Revert keeps clear of it). */
  drawnR: 0.45,
  /** R4: sat on the bench, its middle is about this high (the wall's slide ends here). */
  restMid: 0.3,
  /** R4: within a unit of the stool's foot this long on its way back, it takes the last step whatever is there. */
  lastStep: 5,
  /** R4: how hard (units/s) a loose part at the stool's foot is nudged aside for that last step. */
  nudge: 1.6,
  /** R4: let go with the hand still, its lowest point more than this above the bench: it falls (a hand's height or less is a set-down). */
  dropFrom: 0.9,
  /**
   * R4: fallen this far (units) or more after a drop or a throw up, it flops: flat, a beat, then up; the flop's time
   * down at its highest is `flopMore` (`land`: the length of the scripted landing it was once measured against).
   */
  flopFrom: 1.5,
  flopMore: 1.0,
  land: 0.8,
  /** R4: the shake of the head after a landing (s; longer the further it fell). */
  shake: 0.6,
  /** R4: thrown well clear of the bench: out of sight this long, then up the chute (`chuteFly`: the chute's own set-down by the pad, after it has come back and gone again too often). */
  away: 0.5,
  chuteFly: 1.0,
  /** R4: a fixed body at least this much taller than its middle is a wall it can be flat against. */
  wallAbove: 0.3,
  /** R4: stuck to the wall (s), then down it at up to this speed (units/s), taking at least `slideMin` seconds. */
  stick: 0.35,
  slideDown: 1.6,
  slideMin: 0.4,
  /** R5: from high on the wall it comes down faster, so the slide is never much longer than this (s) once it is moving. */
  slideMost: 1.4,
  /**
   * R5 (the lead's film, 2026-11-20): flat against a wall only with its middle no higher than this, where the home
   * view still shows it: higher, the gag happened off the top of the picture.
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
  /**
   * The way the visitor's eye lies from anything on the bench as the stage frames it (unit: up toward +Z by the
   * camera's pitch). Far steeper than the line to `visitor`, which is where Patch looks to look at the visitor: a
   * stack of crates hides from this eye what is just behind it, and nothing further back.
   */
  readonly sight?: Vec3;
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
   * Its body while it is held and thrown (2026-11-20): a `crewBody` part of the scene, out of the world until the hand
   * takes hold (sim/crew/patch-body.ts).
   */
  readonly bodyPart: Id;
}

export interface PatchUnit extends MachineUnit {
  view(): PatchView;
}

/** A loose part faster than this (units/s) is in flight, not lying anywhere (the world's own line: `world.ts`). */
const LOOSE_FLYING = 0.6;
/**
 * Patch on the bench as the stage's eye looks for it among loose things: from these heights over its feet (its middle;
 * the middle of its pick box, which is where a pointer pressed at it is), at these offsets across it (it is about 0.5
 * wide), along `sight` this far (past anything loose on the bench).
 */
const SIGHT_UP = [0.45, 0.6] as const;
const SIGHT_SIDE = [-0.18, 0, 0.18] as const;
const SIGHT_FAR = 12;
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

  // ── R4: thrown (its body's: sim/crew/patch-body.ts, which sets these for the states it hands over to) ──
  const SOLIDS: Solid[] = solidsOf(ctx.scene);
  /** Met a wall flat (state `wall`): its outward direction, and how fast it came in. */
  let walled: { out: Vec3; speed: number } | null = null;
  /** Come down (states `land` and `shake`): where it lay, where it gets up, how fast it came in, how far it fell, and whether it fell rather than flew. */
  let landing: { from: Vec3; to: Vec3; speed: number; fall: number; drop: boolean } | null = null;
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
    // and nothing loose lying or stacked at rest in the way (a crate on the bench, the stack): not of the line from its
    // middle to `visitor`, nor of the figure as the stage's eye sees it, its middle and the middle of what the pointer
    // takes, each across its width (the pointer pressed at Patch takes the first thing on its ray: a crate in front
    // of half of it is in front of the press)
    const loose = lying();
    if (!loose.length) return true;
    const lines: [Vec3, Vec3][] = [[a, b]];
    const s = spec.sight;
    if (s)
      for (const up of SIGHT_UP)
        for (const side of SIGHT_SIDE) {
          const o: Vec3 = [p[0] + side, p[1] + up, p[2]];
          lines.push([o, [o[0] + s[0] * SIGHT_FAR, o[1] + s[1] * SIGHT_FAR, o[2] + s[2] * SIGHT_FAR]]);
        }
    return !loose.some((o) => lines.some(([u, v]) => segmentMeetsBox(u, v, o, 0.05)));
  }
  /**
   * Loose things lying or stacked at rest, as boxes (found once a step; `getUp` asks `inView` of a hundred places in
   * one). Not one in flight (it will be elsewhere by the time Patch is up), not one in a hand or a machine's or the
   * crew's keeping (mode not `free`), not its own body. Not Fetch or Revert either, standing still or not: each is on
   * its way somewhere within seconds, and Patch's place is chosen once, as it gets up; a hop away from a robot that
   * then drives off leaves Patch somewhere odd for no reason the visitor saw.
   */
  let lyingAt = -1;
  let lyingNow: Box[] = [];
  function lying(): readonly Box[] {
    if (lyingAt === ctx.clock.step) return lyingNow;
    lyingAt = ctx.clock.step;
    const crew = new Set<Id>([spec.bodyPart]);
    for (const c of ['fetch', 'revert-crew']) {
      const v = ctx.crewView(c) as { body?: Id | null } | undefined;
      if (v?.body) crew.add(v.body);
    }
    const out: Box[] = [];
    for (const id of ctx.parts()) {
      if (crew.has(id) || ctx.mode(id) !== 'free') continue;
      const p = ctx.pose(id);
      const h = ctx.halfExtents(id);
      const v = ctx.velocity(id);
      if (!p || !h) continue;
      // (moving and off the bench top: in flight, or falling off the stack. One sliding on the bench top, pushed by
      // Patch's own landing, stops within a hand's breadth of where it is: it counts)
      const low = p.p[1] - [0, 1, 2].reduce((s, i) => s + Math.abs(rotate(p.q, i === 0 ? [1, 0, 0] : i === 1 ? [0, 1, 0] : [0, 0, 1])[1]) * (h[i] as number), 0);
      if (v && length(v.linvel) > LOOSE_FLYING && low > ctx.scene.bench.top + 0.1) continue;
      out.push({ c: p.p, q: p.q, half: h });
    }
    lyingNow = out;
    return out;
  }
  /**
   * A fall from high after a drop or a throw up is a flop (flat, a beat, then up): its time down, longer the higher.
   * (Written as the scripted landing's length less its roll, `land`, which is what it was measured as: kept to the bit.)
   */
  const flopLength = (fall: number): number => T.land + (fall >= T.flopFrom ? T.flopMore * Math.min(1, 0.5 + (fall - T.flopFrom) / 6) : 0) - T.land;
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
      if (ctx.mode(id) !== 'free' || id === spec.bodyPart) continue; // (its own body is not a thing in its way)
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
  /** On its feet at `at`: the walk home, `elapsed` seconds into its set-off (a look, then the turn to its way); on its way already, past it. */
  function walkBack(elapsed = 0): void {
    if (dist(at, footNow()) < 0.15) {
      way = null;
      enter('climb');
      return;
    }
    planBack(false);
    pace = way && way.length > T.scamperOver ? T.scamper : T.walk;
    blockedAt = -1;
    enter('walk', elapsed);
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
        case 'cross': {
          // R2: up onto the rail, two quick steps across while the belt carries it, down the far side
          const c = crossing;
          if (!c || !BELT) {
            crossing = null;
            walkBack(T.setOff);
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
            walkBack(T.setOff);
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
      landing = null;
      walled = null;
      afoot = false;
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
        // (in the air the body's view says how it flies; come down, how it came down)
        thrown: state === 'fly' || state === 'land' || state === 'shake' ? { v: null, speed: landing?.speed ?? 0, chute: false, fall: landing?.fall ?? 0, drop: landing?.drop ?? false, top: false, float: 0 } : null,
        // (R5: the step before's `at`, in the same sense; `at` itself across a jump or a change of state)
        prevAt: at !== endAt ? at : lastState === endState ? lastAt : at,
        walk: state === 'walk' || state === 'cross' ? { pace, scamper: pace > T.walk, next: way ? onGround(way.points[0] ?? way.cross?.from ?? pt(footNow())) : null, waiting: state === 'walk' && seconds() >= T.setOff && (way === null || blockedAt >= 0) } : null,
        // (its body's view fills these in: sim/crew/patch-body.ts)
        body: null,
        lay: null,
      };
    },
  };
  // ── its body while it is held and thrown (sim/crew/patch-body.ts): that module gives this unit its intent and wraps
  // its pre, post, heard, reset and view, and reaches the script's own state only through the closures below ──
  {
    // (asked several times of one place in one step, as it chooses where to get up: answered once. Nothing it
    // depends on moves within a step.)
    const walked = { step: -1, at: new Map<string, boolean>() };
    const walkable = (q: Pt): boolean => {
      if (walked.step !== ctx.clock.step) {
        walked.step = ctx.clock.step;
        walked.at.clear();
      }
      const key = `${q[0].toFixed(3)},${q[1].toFixed(3)}`;
      let ok = walked.at.get(key);
      if (ok === undefined) walked.at.set(key, (ok = wayExists(q, pt(footNow()), R, offFoot([...STATICS, ...movers()]), routeBench, BELT, 0)));
      return ok;
    };
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
        // (where it lies is where it gets up, if it can walk home from there; else the nearest place round it that
        // it can, a ring at a time. Moving into the visitor's view is the body's own, a hop, after)
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
        // (taken hold of: its job waits, a part it caught is set down, its way home is given up)
        ledge = null;
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
      walkHome: walkBack,
      carryOn,
      shakeLength,
      flopLength,
    });
  }
  return unit;
}
