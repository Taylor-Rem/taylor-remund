/**
 * Pitch, the courier (P4 P1a: the body; REWRITE.md § G "P4 as Taylor amended it": "a pompous little businessman
 * airship who takes his job very seriously"). The chairman who insists on doing the deliveries himself: lift, not
 * weight; slow and dignified; his self-importance gently punctured by the world and recovered every time. He carries
 * nothing yet (P1b).
 *
 * Two ways of being, and one rule that joins them:
 *
 *   scripted  moored at his mast, on his round, on his way home: a point that is steered (its speed and its turning
 *             each change only so fast, so every path is smooth) along a few straight legs a small planner lays
 *             out clear of every fixed body and of the lamp's arm. His body is out of the world meanwhile (a
 *             `crewBody` part, as Patch's is), so Fetch, Revert and every machine see nothing of him.
 *   a body    in the visitor's hand, let go, thrown, or bumped: his body is in the world and the engine's, with no
 *             gravity and heavy drag (a balloon: `PITCH_BODY` in the bench scene). In the hand it trails the hand
 *             like a balloon on a string (`CrewHandle.heldAt`); let go it sails, slows in a second or two, and
 *             when it is slow the script takes over again from where it is and how it is moving.
 *   the rule  anything coming at him while he is scripted (a thrown part, a carried one, a robot that moves)
 *             brings his body into the world a step or two before it would touch him, at his place with his
 *             speed: the engine then decides what the hit does, to him (pushed aside: a sail) and to the thing
 *             (it meets a light, soft body). He never dodges.
 *
 * Never tumbles: the figure is never drawn turned by the engine. His attitude is his own (`heading` here; the view's
 * lean from his speed and turning); the engine's body is a rounded box nearly as tall as it is wide and deep, whose
 * turning hardly changes what it meets. So there is nothing to right.
 *
 * Never lost: off the bench, past a wall, in the dock's door, on the platen's tray, his way home starts from where he
 * is. The planner's last resort ignores what is in the way rather than fail to give a way.
 *
 * Writes nothing durable of his own but this: the platen (offered his body by him, as the world offers a part that
 * comes to rest in a mouth: a crew body is offered to no mouth by the world) commits his body's location `in` its
 * tray under the visitor's transaction, and paints him like any robot. Leaving the tray by himself, he writes his
 * body's location back to out of the world, as `crew` (§ E5: what a robot does by itself is the crew's).
 */
import type { Cause, Id, Intent, Pose, PitchState, PitchView, StationId, Vec3 } from '../types.ts';
import type { CrewHandle, SimContext, Unit } from '../context.ts';
import type { UnitFactory, StaticSpec } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { add, dist, length, qconj, qyaw, rotate, scale, sub, yawOf } from '../math.ts';
import { inMouth } from '../mouths.ts';

/** Seconds, units, units per second. Tune here. */
export const PITCH_TUNING = {
  // ── flight (scripted) ──
  /** Along his way at cruise height, climbing and descending, and the last of the way into the cup. */
  cruise: 1.7,
  /** ...and on his way home after the hand, a bump or the tray: he has an appointment. */
  home: 3.3,
  climb: 1.9,
  moor: 0.6,
  /** How fast his speed may change (units/s²): a light thing under a small propeller. */
  accel: 1.7,
  /** How fast he turns (rad/s) and how fast his turning may change (rad/s²). */
  turn: 1.25,
  turnAccel: 1.6,
  /** He goes on to the next leg this near a corner (units): the turn is a curve, not a stop. */
  corner: 0.55,
  /** ...if it bends no more than this (cos of the angle between the legs); a sharper bend he slows to and turns at. */
  bend: 0.3,
  /** Nose-first: his level speed is held to this share of the leg's while he still faces away from his way (cos of the error, from 0.2 to 1). */
  alignMin: 0.12,
  /** Casting off: he backs off the cup this far, this slowly. */
  backOff: 0.55,
  backSpeed: 0.3,
  /** How far behind the cup the way in begins (along his moored nose), units. */
  approach: 0.5,
  /** Within this (level units) of the start of the way in, he turns his nose to the mast. */
  turnIn: 1.6,
  /** Over a machine on his round: how long he looks down at it, and how far below cruise he dips to. */
  pause: 2.8,
  dip: 0.5,
  // ── his round (seeded; never while the visitor is about) ──
  /** Idle this long at least (s; a range, drawn per round), nothing in the hand, no rung: the bench is his to inspect. */
  roundIdle: [21, 27] as const,
  /** After a round, at least this long (s; a range) before the next. */
  roundGap: [28, 50] as const,
  // ── the hand ──
  /** The string: its spring (1/s²) and damping (1/s), its length (units), and how far above the hand he floats (units). */
  stringK: 30,
  stringC: 7.5,
  stringLength: 0.8,
  stringLift: 0.12,
  /** A press let go within this long, the hand gone no further than this from where it took him: a poke, not a carry. */
  pokeTime: 1.2,
  pokeMove: 0.3,
  /** The poke's answer: he turns to face the visitor and adjusts his tie (s). */
  poked: 1.7,
  // ── loose ──
  /** Slower than this (units/s) for `slowFor` (s), or loose for `sailMost` (s): the script has him again. */
  slow: 0.8,
  slowFor: 0.12,
  sailMost: 3.5,
  /** His aftermath after a loose spell: he straightens his hat and tie on his way (s; the view's). */
  ruffled: 2.2,
  /** Faster than this as he leaves the hand: thrown (else let go). */
  thrownFrom: 2,
  // ── bumps ──
  /** His reach as a ball round his middle (units), the margin, and how many steps ahead he sees a thing coming. */
  reach: 0.62,
  margin: 0.02,
  ahead: 3,
  /** Slower than this (units/s, relative to him), a thing is not coming at him. */
  coming: 0.25,
  // ── the tray and the door ──
  /** On the platen's tray: he stays this long after the visitor's last action (s), then leaves. */
  trayIdle: 4.5,
  /** Out of the dock's door: this far, this slowly. */
  doorOut: 1.4,
  doorSpeed: 0.55,
  // ── keeping clear (the planner) ──
  /** His size against fixed bodies: across and up (units, padded round each body's box). */
  clearSide: 0.66,
  clearUp: 0.66,
  /** The lowest his middle is flown over the bench (units above its top). */
  floor: 0.75,
  /** The roadmap his ways are found on: its spacing along x and z (units), how far its points are joined, and how far a way's ends reach for it. */
  roadmap: [0.9, 0.8] as const,
  roadmapReach: 1.3,
  roadmapLink: 3.5,
  // ── (E1) the entrance: a late arrival ──
  /** In from beyond the bench at this speed, and over the mast's place at this height above the bench (his middle). */
  arrive: 3.0,
  arriveHigh: 5.8,
  /** Over the place: the mast lowered and let go after `plantLet` (s), and he stays till `plant`, then backs off and moors. */
  plantLet: 0.8,
  plant: 1.3,
  /** His middle above the mast's head while it hangs under him, as it is set down (his car hangs below his middle). */
  plantOver: 1.2,
} as const;

export interface PitchSpec {
  readonly id: Id;
  /** His body: a `crewBody` part of the scene, kind robot. */
  readonly body: Id;
  readonly station: StationId;
  /** Content id of his name. */
  readonly name: string;
  /** The mast's cup (world, where his nose clips in) and the way his nose points moored (radians about +Y). */
  readonly mast: Vec3;
  readonly heading: number;
  /** How far behind his nose his middle is (units): moored, his middle is this far back from the cup. */
  readonly nose: number;
  /** The height of his middle on his way (above every machine, everything loose, and the striker's arm at its top). */
  readonly cruise: number;
  /** Where he pauses on his round, over a machine (his middle), and what he looks down at there. */
  readonly stops: readonly { readonly over: Vec3; readonly look: Vec3 }[];
  /**
   * The lamp's arm sweeps the back left of the bench (x below `maxX`, z below `maxZ`) at heights from `under` up: he
   * is never flown there above `under` (he goes round it, along the front or the right of the bench).
   */
  readonly lamp: { readonly maxX: number; readonly maxZ: number; readonly under: number };
  /**
   * Where the rest of the crew are at home or about their work (Patch's runner, Revert's track, Fetch's lane) and what
   * moves on a machine (the striker's arm, the dock's lamp): boxes (world) his ways keep out of, as of a fixed body.
   */
  readonly keepOut: readonly { readonly min: Vec3; readonly max: Vec3 }[];
  /** Where he may be flown at all (his middle). */
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly maxY: number };
  /** The platen's mouth (its tray), and the dock's: let go slow in the one he is offered to it; in the other he backs out. */
  readonly tray: Id;
  readonly dock: Id;
  /** The dock's door: its middle, and the way out of it (unit, level). */
  readonly door: { readonly at: Vec3; readonly out: Vec3 };
  /** Where the visitor is (he turns to them). */
  readonly visitor: Vec3;
  /** (E1) The mast's foot (world, on the bench) and its height (world units): where he plants it when he arrives late. */
  readonly mastFoot: Vec3;
  readonly mastHeight: number;
  /** (E1) Where a late arrival comes in from: beyond the bench, high (his middle). */
  readonly entry: Vec3;
}

/** (E1) How he begins: at his mast (in the scene from the first step), or arriving (a late unit: `World.join`). */
export interface PitchStart {
  readonly arrive?: boolean;
}

export interface PitchUnit extends Unit {
  crewView(): { readonly kind: 'pitch'; readonly id: Id; readonly body: Id; readonly view: PitchView };
}

export function pitch(spec: PitchSpec, start: PitchStart = {}): UnitFactory {
  return (ctx) => createPitch(ctx, spec, start);
}

interface Leg {
  readonly to: Vec3;
  readonly speed: number;
  /** Stop there (the end of a way), rather than curving on to the next leg. */
  readonly stop?: boolean;
  /** Keep this heading along it (backing off the cup, the way in). */
  readonly face?: number;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clampN = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Every fixed body's box (world, axis-aligned round its turned footprint). */
function boxesOf(statics: readonly StaticSpec[]): Box[] {
  const out: Box[] = [];
  for (const s of statics) {
    const parts = s.shape.type === 'box' ? [{ half: s.shape.half, at: [0, 0, 0] as Vec3 }] : s.shape.parts.map((p) => ({ half: p.half, at: p.at.p }));
    const yaw = yawOf(s.pose.q);
    const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
    for (const p of parts) {
      const at = add(s.pose.p, rotate(s.pose.q, p.at));
      const hx = c * p.half[0] + sn * p.half[2];
      const hz = sn * p.half[0] + c * p.half[2];
      out.push({ minX: at[0] - hx, maxX: at[0] + hx, minY: at[1] - p.half[1], maxY: at[1] + p.half[1], minZ: at[2] - hz, maxZ: at[2] + hz });
    }
  }
  return out;
}

export function createPitch(ctx: SimContext, spec: PitchSpec, start: PitchStart = {}): PitchUnit {
  const T = PITCH_TUNING;
  const id = spec.id;
  const body = spec.body;
  if (ctx.mode(body) === undefined) throw new Error(`pitch: his body part ("${body}") must be in the scene, as a crewBody`);
  const rng = ctx.rng('pitch');
  const dt = 1 / HZ;
  const top = ctx.scene.bench.top;
  const fwdOf = (h: number): Vec3 => [Math.sin(h), 0, Math.cos(h)];
  const mastFwd = fwdOf(spec.heading);
  /** Moored: his middle, and the start of the way in behind it. */
  const MOORED: Vec3 = sub(spec.mast, scale(mastFwd, spec.nose));
  const APPROACH: Vec3 = sub(MOORED, scale(mastFwd, T.approach));
  const HIGH: Vec3 = [APPROACH[0], spec.cruise, APPROACH[2]];
  const PAD = { side: T.clearSide, up: T.clearUp };
  const SOLIDS = [
    ...boxesOf(ctx.scene.statics).map((b) => ({ minX: b.minX - PAD.side, maxX: b.maxX + PAD.side, minY: b.minY - PAD.up, maxY: b.maxY + PAD.up, minZ: b.minZ - PAD.side, maxZ: b.maxZ + PAD.side })),
    // (the crew's places are given generously already: only his height is added)
    ...spec.keepOut.map((k) => ({ minX: k.min[0], maxX: k.max[0], minY: k.min[1] - PAD.up, maxY: k.max[1] + PAD.up, minZ: k.min[2], maxZ: k.max[2] })),
  ];
  const L = spec.lamp;
  const B = spec.bounds;
  /** (E1) Over the mast's place: high (where the entrance comes to), and low (the mast's foot on the bench). */
  const foot = spec.mastFoot;
  const OVER_HIGH: Vec3 = [foot[0], top + T.arriveHigh, foot[2]];
  const PLANT_AT: Vec3 = [foot[0], foot[1] + spec.mastHeight + T.plantOver, foot[2]];
  /** ...and backed off it, at that height, behind the start of the way in. */
  const BACKED: Vec3 = [APPROACH[0], PLANT_AT[1], APPROACH[2]];

  // ── the scripted point ──
  let at: Vec3 = MOORED;
  let prevAt: Vec3 = MOORED;
  let vel: Vec3 = [0, 0, 0];
  let heading = spec.heading;
  let turn = 0;
  let state: PitchState = 'moored';
  let since = 0;
  let legs: Leg[] = [];
  let leg: 'round' | 'home' | null = null;
  let lookAt: Vec3 | null = null;
  /** The stop of the round under way (it pauses there), and the one before (not twice running). */
  let stop: number | null = null;
  let lastStop = -1;
  let ruffled: { how: 'thrown' | 'let-go' | 'bumped' | 'arrived'; at: number } | null = null;
  /** Rounds: the idle needed for the next, and not before this step. */
  let roundIdle = steps(rng.range(T.roundIdle[0], T.roundIdle[1]));
  let roundNotBefore = 0;
  let lastHover: Id | null = null;
  let idleWas = ctx.idleSteps();
  /**
   * Steps since the visitor's last input, a Button rung's not counted (the crew is frozen through it). (E1) A late
   * arrival starts from the world's own count, so his rounds keep the time they would have kept had he been here
   * (the count is one less than the world's idle steps at every step after an input, and this step's `pre` adds one;
   * a Button rung before he joined is not taken off, as it would have been had he been here).
   */
  let quiet = Math.max(0, ctx.idleSteps() - 2);
  /** The visitor has acted since the script last looked (read in every step, a rung's included). */
  let actedSince = false;
  // ── the hand ──
  let hand: Vec3 = MOORED;
  let grabbedAt = 0;
  let grabbedFrom: { at: Vec3; heading: number; state: PitchState; legs: Leg[]; leg: 'round' | 'home' | null; stop: number | null } | null = null;
  let handFar = 0;
  let handFrom: Vec3 = MOORED;
  let str: Vec3 = MOORED;
  let strV: Vec3 = [0, 0, 0];
  let pending: Pose | null = null;
  // ── loose ──
  let slowSteps = 0;
  let sailSteps = 0;
  /** After a poke: what he goes back to. */
  let after: { state: PitchState; legs: Leg[]; leg: 'round' | 'home' | null; stop: number | null } | null = null;
  // ── (E1) the entrance ──
  /** His mast stands on its foot (false only while a late arrival has not yet planted it). */
  let planted = true;
  /** On his entrance, till he first moors (he straightens up then). */
  let arriving = false;

  const inWorld = (): boolean => {
    const m = ctx.mode(body);
    return m === 'free' || m === 'held' || m === 'machine' || m === 'crew';
  };
  const enter = (s: PitchState): void => {
    state = s;
    since = 0;
  };
  const jump = (p: Vec3): void => {
    at = p;
    prevAt = p;
  };

  // ── keeping clear ──
  const lampHigh = (p: Vec3): boolean => p[0] < L.maxX && p[2] < L.maxZ && p[1] > L.under;
  const blocked = (p: Vec3): boolean => {
    if (p[1] < top + T.floor - 1e-6 && p[0] >= ctx.scene.bench.minX && p[0] <= ctx.scene.bench.maxX && p[2] >= ctx.scene.bench.minZ && p[2] <= ctx.scene.bench.maxZ) return true;
    if (lampHigh(p)) return true;
    for (const b of SOLIDS) if (p[0] > b.minX && p[0] < b.maxX && p[1] > b.minY && p[1] < b.maxY && p[2] > b.minZ && p[2] < b.maxZ) return true;
    return false;
  };
  /** Is the straight way from a to b clear (the first `skip` units of it not looked at: he may be starting against something)? */
  const clear = (a: Vec3, b: Vec3, skip = 0): boolean => {
    const d = dist(a, b);
    const n = Math.max(1, Math.ceil(d / 0.15));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (k * d < skip) continue;
      if (blocked([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k])) return false;
    }
    return true;
  };
  const pathLength = (from: Vec3, pts: readonly Vec3[]): number => {
    let s = 0;
    let p = from;
    for (const q of pts) {
      s += dist(p, q);
      p = q;
    }
    return s;
  };
  const pathClear = (from: Vec3, pts: readonly Vec3[], skip: number): boolean => {
    let p = from;
    for (let i = 0; i < pts.length; i++) {
      if (!clear(p, pts[i]!, i === 0 ? skip : 0)) return false;
      p = pts[i]!;
    }
    return true;
  };
  /** Into where he may be flown: inside the bounds, over the bench's top. */
  const inside = (p: Vec3): Vec3 => [clampN(p[0], B.minX, B.maxX), clampN(Math.max(p[1], top + T.floor), top + T.floor, B.maxY), clampN(p[2], B.minZ, B.maxZ)];
  const atCruise = (p: Vec3): Vec3 => [p[0], spec.cruise, p[2]];

  // ── the roadmap: points in the open air at three heights (low, under the lamp's arm, cruise), each joined to its
  // neighbours where the way between is clear; made once. A way is found along it and then pulled straight. ──
  const LAYERS = [L.under - 0.05, spec.cruise];
  const nodes: Vec3[] = [];
  for (const y of LAYERS)
    for (let x = B.minX; x <= B.maxX + 1e-6; x += T.roadmap[0])
      for (let z = B.minZ; z <= B.maxZ + 1e-6; z += T.roadmap[1]) {
        const p: Vec3 = [x, y, z];
        if (!blocked(p)) nodes.push(p);
      }
  for (const p of [APPROACH, HIGH, ...spec.stops.flatMap((s) => [s.over, atCruise(s.over)])]) if (!blocked(p)) nodes.push(p);
  const edges: { to: number; cost: number }[][] = nodes.map(() => []);
  const costOf = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[2] - a[2]) + Math.abs(b[1] - a[1]) * (T.cruise / T.climb);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      if (Math.hypot(b[0] - a[0], b[2] - a[2]) > T.roadmapReach || !clear(a, b)) continue;
      const c = costOf(a, b);
      edges[i]!.push({ to: j, cost: c });
      edges[j]!.push({ to: i, cost: c });
    }
  /** The roadmap's points that can be reached straight from `p` (nearest first), within `far`. */
  const linksOf = (p: Vec3, only: ((n: Vec3) => boolean) | null, skip: number): { to: number; cost: number }[] => {
    const near = nodes
      .map((n, i) => ({ i, d: dist(p, n) }))
      .filter((x) => x.d <= T.roadmapLink && (!only || only(nodes[x.i]!)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    const out: { to: number; cost: number }[] = [];
    for (const x of near) if (clear(p, nodes[x.i]!, skip)) out.push({ to: x.i, cost: costOf(p, nodes[x.i]!) });
    return out;
  };
  /** Pulled straight: from each point, on to the furthest one further along that it can see. */
  const pull = (from: Vec3, pts: Vec3[], skip: number): Vec3[] => {
    const out: Vec3[] = [];
    let p = from;
    let i = 0;
    let first = true;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !clear(p, pts[j]!, first ? skip : 0)) j--;
      out.push(pts[j]!);
      p = pts[j]!;
      i = j + 1;
      first = false;
    }
    return out;
  };

  /**
   * A way from `p` to `goal` (points, not including `p`), clear of every fixed body and of the lamp's arm: straight if it
   * can be, else along the roadmap (`only`: on the points it allows, his cruise height for his round), pulled straight.
   * If nothing joins them, up and over at cruise height anyway: he is never left without a way.
   */
  function plan(p: Vec3, goal: Vec3, only: ((n: Vec3) => boolean) | null = null): Vec3[] {
    let start = inside(p);
    let lead: Vec3[] = dist(start, p) > 0.02 ? [start] : [];
    // (from outside where he may be flown: up first, if the way in at his height meets something, until it does not)
    if (lead.length && !clear(p, start)) {
      for (let y = Math.max(p[1], start[1]); y <= B.maxY; y += 0.3) {
        const up: Vec3 = [p[0], y, p[2]], inn: Vec3 = [start[0], y, start[2]];
        if (clear(p, up, 0.3) && clear(up, inn)) {
          start = inn;
          lead = [up, inn];
          break;
        }
      }
    }
    if (clear(start, goal, lead.length ? 0 : 0.5)) return [...lead, goal];
    const from = linksOf(start, only, lead.length ? 0 : 0.5);
    const to = new Map(linksOf(goal, only, 0).map((l) => [l.to, l.cost]));
    // Dijkstra over the roadmap (a few hundred points)
    const n = nodes.length;
    const best = new Float64Array(n).fill(Infinity);
    const back = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    for (const l of from) if (l.cost < best[l.to]!) best[l.to] = l.cost;
    let end = -1;
    let endCost = Infinity;
    for (;;) {
      let u = -1;
      let bu = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && best[i]! < bu) [u, bu] = [i, best[i]!];
      if (u < 0 || bu >= endCost) break;
      done[u] = 1;
      const tail = to.get(u);
      if (tail !== undefined && bu + tail < endCost) [end, endCost] = [u, bu + tail];
      for (const e of edges[u]!) {
        if (only && !only(nodes[e.to]!)) continue;
        const c = bu + e.cost;
        if (c < best[e.to]!) {
          best[e.to] = c;
          back[e.to] = u;
        }
      }
    }
    if (end < 0) return [...lead, atCruise(start), atCruise(goal), goal];
    const way: Vec3[] = [];
    for (let i = end; i >= 0; i = back[i]!) way.unshift(nodes[i]!);
    return [...lead, ...pull(start, [...way, goal], lead.length ? 0 : 0.5)];
  }
  const onCruise = (q: Vec3): boolean => Math.abs(q[1] - spec.cruise) < 0.01;

  /** Legs from points, at the speed each calls for (level along, up or down). */
  const legsOf = (from: Vec3, pts: readonly Vec3[], home = false): Leg[] => {
    let p = from;
    return pts.map((q, i) => {
      const lv = Math.hypot(q[0] - p[0], q[2] - p[2]);
      const vy = Math.abs(q[1] - p[1]);
      const sp = vy > lv ? T.climb : home ? T.home : T.cruise;
      p = q;
      return i === pts.length - 1 ? { to: q, speed: sp, stop: true } : { to: q, speed: sp };
    });
  };

  /** Home from wherever he is: a way to the start of the way in, then nose into the cup. */
  function goHome(): void {
    if (!planted) return goPlant();
    legs = [...legsOf(at, plan(at, APPROACH), true), { to: MOORED, speed: T.moor, stop: true, face: spec.heading }];
    leg = 'home';
    stop = null;
    lookAt = null;
    enter('fly');
  }

  /**
   * (E1) Back to his entrance after the hand, a bump, the tray or the door took him off it: his mast still slung
   * along his flank, a way at his height to over the mast's place (as on his way home), turning to face the way he
   * will moor, and down until its foot is on the bench.
   */
  function goPlant(): void {
    const over: Vec3 = [foot[0], Math.max(spec.cruise, PLANT_AT[1]), foot[2]];
    legs = [...legsOf(at, plan(at, over), true).map((l) => ({ ...l, stop: false })), { to: PLANT_AT, speed: T.climb, stop: true, face: spec.heading }];
    leg = 'home';
    stop = null;
    lookAt = null;
    arriving = true;
    enter('arrive');
  }
  /** (E1) The mast set on its foot: he backs off it at that height, comes down behind the cup, and noses in. */
  function afterPlant(): void {
    planted = true;
    legs = [
      { to: BACKED, speed: T.cruise, face: spec.heading },
      { to: APPROACH, speed: T.climb, face: spec.heading },
      { to: MOORED, speed: T.moor, stop: true, face: spec.heading },
    ];
    leg = 'home';
    lookAt = null;
    enter('fly');
  }

  /** The round: off the cup, up to cruise, over to a machine at cruise height, down a little over it to look. */
  function goRound(): void {
    const n = spec.stops.length;
    if (n === 0) return;
    let k = rng.int(n);
    if (n > 1 && k === lastStop) k = (k + 1 + rng.int(n - 1)) % n;
    lastStop = k;
    stop = k;
    const s = spec.stops[k]!;
    const back = sub(MOORED, scale(mastFwd, T.backOff));
    const up: Vec3 = [back[0], spec.cruise, back[2]];
    legs = [{ to: back, speed: T.backSpeed, face: spec.heading }, ...legsOf(back, [up, ...plan(up, atCruise(s.over), onCruise), s.over])];
    leg = 'round';
    lookAt = null;
    enter('castoff');
  }

  /** From over a machine on his round: up to cruise, across at cruise height, down over the mast, and in. */
  function roundHome(): void {
    const up = atCruise(at);
    legs = [...legsOf(at, [up, ...plan(up, HIGH, onCruise), APPROACH]), { to: MOORED, speed: T.moor, stop: true, face: spec.heading }];
    leg = 'round';
    enter('fly');
  }

  // ── the steering: one step along the current legs ──
  /**
   * How fast he may pass the end of the first leg: the leg's own speed where the way goes on straight, less and less as
   * it bends, nothing at a bend sharper than `bend` or at the end of the way (he slows to it, rather than swinging wide).
   */
  const cornerSpeed = (): number => {
    const a = legs[0], b = legs[1];
    if (!a || !b || a.stop) return 0;
    const d1 = sub(a.to, at), d2 = sub(b.to, a.to);
    const l1 = length(d1), l2 = length(d2);
    if (l1 < 1e-6 || l2 < 1e-6) return Math.min(a.speed, b.speed);
    const c = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (l1 * l2);
    // (and no faster than he can still stop in, where the next leg is the last of the way)
    const after = b.stop || legs.length === 2 ? Math.sqrt(2 * T.accel * l2) : Infinity;
    return Math.min(a.speed, b.speed, after) * clampN((c - T.bend) / (1 - T.bend), 0, 1) ** 2;
  };
  /** The way his nose should point along the legs: the leg's own, else the way the first leg with any level run goes. */
  const faceAlong = (): number => {
    // (the last of the way down to the cup: he turns to it as he comes, not after)
    const l0 = legs[0];
    if (l0 && legs[1]?.to === MOORED && Math.hypot(l0.to[0] - at[0], l0.to[2] - at[2]) < T.turnIn) return spec.heading;
    let p = at;
    for (const l of legs) {
      if (l.face !== undefined) return l.face;
      const g = sub(l.to, p);
      if (Math.hypot(g[0], g[2]) > 0.3) return Math.atan2(g[0], g[2]);
      p = l.to;
    }
    return heading;
  };
  function steer(): void {
    prevAt = at;
    const l = legs[0];
    if (!l) {
      vel = scale(vel, Math.max(0, 1 - (T.accel * dt) / Math.max(1e-6, length(vel))));
      at = add(at, scale(vel, dt));
      turnTo(heading);
      return;
    }
    const gap = sub(l.to, at);
    const d = length(gap);
    const dir = d > 1e-6 ? scale(gap, 1 / d) : ([0, 0, 0] as Vec3);
    // nose first: level travel waits on his turning toward it
    const level = Math.hypot(gap[0], gap[2]);
    const face = faceAlong();
    const err = Math.abs(wrap(face - heading));
    const align = l.face !== undefined || level < 0.3 ? 1 : clampN((Math.cos(err) - 0.2) / 0.8, T.alignMin, 1);
    const vc = cornerSpeed();
    const halt = vc <= 1e-6;
    const sp = Math.min(l.speed, Math.sqrt(vc * vc + 2 * T.accel * Math.max(0, d - (halt ? 0.01 : T.corner))));
    const want: Vec3 = [dir[0] * sp * align, dir[1] * sp, dir[2] * sp * align];
    const dv = sub(want, vel);
    const dl = length(dv);
    const most = T.accel * dt;
    vel = dl > most ? add(vel, scale(dv, most / dl)) : want;
    at = add(at, scale(vel, dt));
    // on to the next leg: near a gentle corner, or there
    if (halt ? d < 0.015 && length(vel) < 0.08 : d < T.corner) {
      if (halt) {
        at = l.to;
        vel = [0, 0, 0];
      }
      legs.shift();
    }
    turnTo(face);
  }
  function turnTo(face: number): void {
    const err = wrap(face - heading);
    const want = clampN(err * 1.6, -T.turn, T.turn);
    turn += clampN(want - turn, -T.turnAccel * dt, T.turnAccel * dt);
    heading = wrap(heading + turn * dt);
  }

  // ── his body in the world: let go, thrown, bumped ──
  function loose(how: 'thrown' | 'let-go' | 'bumped'): void {
    ctx.buoy(body, 0);
    slowSteps = 0;
    sailSteps = 0;
    ruffled = { how, at: ctx.clock.step };
    legs = [];
    leg = null;
    stop = null;
    enter('sail');
  }
  /** Out of the world again, the script from where it was and how it moved. */
  function takeOver(): void {
    const p = ctx.pose(body);
    const v = ctx.velocity(body)?.linvel ?? [0, 0, 0];
    if (p) {
      prevAt = at;
      at = p.p;
    }
    vel = v;
    if (inWorld() && ctx.mode(body) !== 'held') ctx.stow(body, p ?? { p: at, q: qyaw(heading) });
    outOfWorld();
  }
  /** His body's location says what it is: out of the world (it was on the tray: he took himself off it). */
  function outOfWorld(): void {
    const loc = ctx.part(body)?.location;
    if (loc && loc.at !== 'shipped') ctx.commit([{ target: body, field: 'location', after: { at: 'shipped' } }], 'crew');
  }
  const mouthOf = (mid: Id): ReturnType<SimContext['mouth']> => ctx.mouth(mid);
  /** Slow in a mouth: the tray takes him (he is offered to it); the dock's door: he backs out. Else home. */
  function recover(): void {
    const p = ctx.pose(body)?.p ?? at;
    const tray = mouthOf(spec.tray);
    // (only what the visitor put there: bumped onto it, he goes on home)
    if (tray && inMouth(tray, p) && !ctx.bracketed && ruffled?.how !== 'bumped') {
      const m = ctx.machine(tray.machine);
      const part = ctx.part(body);
      if (m && part) {
        const cause: Cause = ctx.history.chargeRest(body, ctx.clock.step, null);
        const out = m.accept(part, cause, tray.id);
        if (!out.ok) ctx.emit({ type: 'card', by: m.id, content: out.wanted });
        else if (ctx.mode(body) === 'machine') {
          ctx.emit({ type: 'taken-in', id: m.id, part: body, mouth: tray.id });
          at = p;
          prevAt = p;
          vel = [0, 0, 0];
          lookAt = spec.visitor;
          enter('tray');
          return;
        }
      }
    }
    const dock = mouthOf(spec.dock);
    const nearDoor = Math.hypot(p[0] - spec.door.at[0], p[2] - spec.door.at[2]) < 1.3 && p[1] < spec.door.at[1] + 2.4;
    takeOver();
    if (ctx.reducedMotion) return cutHome();
    if ((dock && inMouth(dock, p)) || nearDoor) {
      const o = spec.door.out;
      const to = inside([p[0] + o[0] * T.doorOut, Math.max(p[1], top + T.floor + 0.2), p[2] + o[2] * T.doorOut]);
      legs = [{ to, speed: T.doorSpeed, stop: true, face: heading }];
      leg = 'home';
      lookAt = spec.visitor;
      enter('door');
      return;
    }
    goHome();
  }
  /** Reduced motion: put back at the mast with a cut (his mast standing: a late arrival is at it when he arrives). */
  function cutHome(): void {
    planted = true;
    arriving = false;
    if (inWorld() && ctx.mode(body) !== 'held') ctx.stow(body, ctx.pose(body) ?? { p: at, q: qyaw(heading) });
    outOfWorld();
    jump(MOORED);
    vel = [0, 0, 0];
    heading = spec.heading;
    turn = 0;
    legs = [];
    leg = null;
    stop = null;
    lookAt = null;
    ruffled = null;
    enter('moored');
  }
  /** Embodied where he is, moving as he moves (something is about to meet him). */
  function bump(): void {
    if (ctx.mode(body) !== 'gone') return;
    ctx.launch(body, { p: at, q: qyaw(heading) }, vel, [0, 0, 0], null);
    after = null;
    loose('bumped');
  }
  /**
   * Is anything about to meet him (now, or within `ahead` steps)? Each loose part, each robot and each thing in a
   * hand: the nearest point of its box to his middle, and how fast the two are closing.
   */
  function threatened(): boolean {
    const mine = ctx.halfExtents(body) ?? ([T.reach, T.reach, T.reach] as Vec3);
    for (const o of ctx.parts()) {
      if (o === body) continue;
      const m = ctx.mode(o);
      if (m !== 'free' && m !== 'held' && m !== 'crew') continue;
      const p = ctx.pose(o);
      const h = ctx.halfExtents(o);
      if (!p || !h) continue;
      if (dist(p.p, at) > length(mine) + length(h) + 3) continue;
      const ov = ctx.velocity(o)?.linvel ?? [0, 0, 0];
      // (only a thing that is itself moving comes at him: one lying still he passes, as he passes a machine's top)
      if (length(ov) < T.coming) continue;
      const rel = sub(ov, vel);
      // the nearest point of its box to his middle, and how far that is outside his own box (his box is level)
      const local = rotate(qconj(p.q), sub(at, p.p));
      const near = add(p.p, rotate(p.q, [clampN(local[0], -h[0], h[0]), clampN(local[1], -h[1], h[1]), clampN(local[2], -h[2], h[2])]));
      const off = sub(at, near);
      const gap = Math.max(Math.abs(off[0]) - mine[0], Math.abs(off[1]) - mine[1], Math.abs(off[2]) - mine[2]);
      const d = length(off);
      const closing = d > 1e-6 ? (rel[0] * off[0] + rel[1] * off[1] + rel[2] * off[2]) / d : length(rel);
      if (closing < T.coming) continue;
      if (gap < T.margin + (closing * T.ahead) / HZ) return true;
    }
    return false;
  }

  // ── the unit ──
  const handle: CrewHandle = {
    grabbed() {},
    taken() {},
    heldAt: () => str,
  };
  ctx.crewFor(body, handle);

  ctx.register({
    id,
    station: spec.station,
    name: spec.name,
    affordances: ['grab'],
    tell: () => ctx.emit({ type: 'tell', id }),
    misfire: (level) => ctx.emit({ type: 'misfire', id, level }),
  });

  /** The script's own step in a state that is his (not held, loose or on the tray). */
  function scripted(): void {
    // the visitor did something (not only passed the pointer over a thing): a round is cut short, home
    const acted = actedSince;
    actedSince = false;
    if (acted && leg === 'round' && (state === 'castoff' || state === 'fly' || state === 'pause')) {
      stop = null;
      goHome();
      return;
    }
    switch (state) {
      case 'moored': {
        prevAt = at;
        turnTo(spec.heading);
        const free = !ctx.reducedMotion && !ctx.still && ctx.holding() === null && ctx.clock.step >= roundNotBefore;
        if (free && quiet >= roundIdle) goRound();
        return;
      }
      case 'castoff':
        steer();
        if (legs.length === 0) goHome();
        else if (legs[0]!.face === undefined) enter('fly');
        return;
      case 'arrive':
        // (E1) in, high and stately; down over the place: the mast is lowered there
        steer();
        if (legs.length === 0) {
          vel = [0, 0, 0];
          lookAt = [foot[0], foot[1], foot[2]];
          enter('plant');
        }
        return;
      case 'plant':
        prevAt = at;
        turnTo(spec.heading);
        if (!planted && since >= T.plantLet) planted = true;
        if (since >= T.plant) afterPlant();
        return;
      case 'fly':
      case 'door':
      case 'moor':
        steer();
        if (state === 'fly' && legs.length === 1 && legs[0]!.to === MOORED) enter('moor');
        if (legs.length > 0) return;
        if (state === 'door') return goHome();
        if (leg === 'round' && stop !== null) {
          lookAt = spec.stops[stop]!.look;
          enter('pause');
          return;
        }
        // home: moored
        jump(MOORED);
        prevAt = at;
        heading = spec.heading;
        // (E1) moored is one state, however he came to it: no turning left over (a late arrival agrees with the start)
        turn = 0;
        vel = [0, 0, 0];
        if (leg === 'round') {
          roundNotBefore = ctx.clock.step + steps(rng.range(T.roundGap[0], T.roundGap[1]));
          roundIdle = steps(rng.range(T.roundIdle[0], T.roundIdle[1]));
        }
        leg = null;
        lookAt = null;
        // (E1) moored at the end of his entrance: he straightens his hat and tie (the view's), once
        ruffled = arriving ? { how: 'arrived', at: ctx.clock.step } : null;
        arriving = false;
        enter('moored');
        return;
      case 'pause':
        prevAt = at;
        turnTo(heading);
        if (since >= T.pause) {
          stop = null;
          lookAt = null;
          roundHome();
        }
        return;
      case 'poked': {
        prevAt = at;
        const toV = sub(spec.visitor, at);
        turnTo(Math.atan2(toV[0], toV[2]));
        lookAt = spec.visitor;
        if (since < T.poked) return;
        lookAt = null;
        const a = after;
        after = null;
        // (a round is not taken up again: he was poked; he goes home)
        if (a && a.state !== 'moored' && a.state !== 'poked' && a.leg !== 'round') {
          legs = a.legs;
          leg = a.leg;
          stop = a.stop;
          if (legs.length === 0) goHome();
          else enter(a.state === 'pause' || a.state === 'castoff' ? 'fly' : a.state);
        } else if (dist(at, MOORED) < 0.02) enter('moored');
        else goHome();
        return;
      }
      default:
        return;
    }
  }

  // (E1) a late arrival begins on his entrance: beyond the bench, high, already under way, his mast slung under him.
  // With reduced motion there is no entrance: he is at his mast when he arrives.
  if (start.arrive && !ctx.reducedMotion) {
    const d = sub(OVER_HIGH, spec.entry);
    const dl = Math.max(1e-6, length(d));
    jump(spec.entry);
    heading = Math.atan2(d[0], d[2]);
    vel = scale(d, T.arrive / dl);
    planted = false;
    arriving = true;
    legs = [
      { to: OVER_HIGH, speed: T.arrive },
      { to: PLANT_AT, speed: T.climb, stop: true, face: spec.heading },
    ];
    leg = 'home';
    enter('arrive');
  }

  const unit: PitchUnit = {
    id,
    holds: (what) => what === id,

    intent(intent: Intent): boolean {
      if (intent.type !== 'drag' || intent.id !== id) return false;
      if (ctx.bracketed) return false;
      if (state !== 'held') {
        // taken hold of: wherever he is (loose: as he is; on the tray: off it; scripted: into the world where he is drawn)
        if (ctx.mode(body) === 'machine') ctx.attach(body, body);
        const p = inWorld() ? (ctx.pose(body) as Pose) : { p: at, q: qyaw(heading) };
        pending = p;
        grabbedFrom = { at: p.p, heading, state, legs, leg, stop };
        grabbedAt = ctx.clock.step;
        handFar = 0;
        handFrom = intent.target;
        str = intent.target;
        strV = [0, 0, 0];
        legs = [];
        leg = null;
        stop = null;
        after = null;
        ruffled = null;
        lookAt = spec.visitor;
        enter('held');
      }
      hand = intent.target;
      handFar = Math.max(handFar, dist(hand, handFrom));
      if (intent.end) {
        const m = ctx.mode(body);
        if (m === 'gone') {
          // let go by a drag that never came through the world's grab (no body in the hand): from the hand
          ctx.launch(body, { p: at, q: qyaw(heading) }, intent.velocity ?? [0, 0, 0], [0, 0, 0], null);
        }
        if (ctx.mode(body) !== 'free') {
          goHome();
          return true;
        }
        const v = ctx.velocity(body)?.linvel ?? [0, 0, 0];
        const g = grabbedFrom;
        grabbedFrom = null;
        const short = ctx.clock.step - grabbedAt <= steps(T.pokeTime);
        if (g && short && handFar <= T.pokeMove + 0.25 && dist(ctx.pose(body)!.p, g.at) <= T.pokeMove + 0.35 && length(v) < T.thrownFrom) {
          // a press that did not take hold: back where he was, and he turns to the visitor and adjusts his tie
          ctx.stow(body, ctx.pose(body) as Pose);
          outOfWorld();
          jump(g.at);
          vel = [0, 0, 0];
          heading = g.heading;
          after = { state: g.state, legs: g.legs, leg: g.leg, stop: g.stop };
          lookAt = spec.visitor;
          enter('poked');
          return true;
        }
        if (ctx.reducedMotion) {
          cutHome();
          return true;
        }
        loose(length(v) >= T.thrownFrom ? 'thrown' : 'let-go');
      }
      return true;
    },

    embody(which: Id) {
      if (which !== id || state !== 'held') return null;
      const pose = pending ?? (ctx.pose(body) as Pose);
      pending = null;
      return { body, pose, grip: hand };
    },

    pre() {
      const idleNow = ctx.idleSteps();
      // (an input this step: the idle count is 1 at most; a carry repeats it every step)
      const input = idleNow <= 1 || idleNow < idleWas;
      if (input) quiet = 0;
      else if (!ctx.bracketed) quiet += 1;
      if (input && ctx.hovered() === lastHover) actedSince = true;
      idleWas = idleNow;
      lastHover = ctx.hovered();
      if (ctx.bracketed) return;
      since += dt;
      const m = ctx.mode(body);
      // the world (an undo, a reset, the platen) may have moved his body: he goes with it
      if (state === 'held') {
        const h = ctx.holding();
        if (!h || h.kind !== 'unit' || h.id !== id) {
          if (m === 'free') loose('let-go');
          else if (m === 'machine') enter('tray');
          else {
            takeOver();
            ctx.reducedMotion ? cutHome() : goHome();
          }
        }
      } else if (state === 'sail') {
        if (m === 'gone') {
          outOfWorld();
          ctx.reducedMotion ? cutHome() : goHome();
        } else if (m === 'machine') enter('tray');
      } else if (state === 'tray') {
        if (m === 'gone') {
          outOfWorld();
          ctx.reducedMotion ? cutHome() : goHome();
        } else if (m === 'free') loose('let-go');
      } else if (m === 'free') loose('let-go');
      else if (m === 'machine') {
        prevAt = at;
        enter('tray');
      }

      switch (state) {
        case 'held': {
          // the string: he floats a little above the hand and trails it, never further than its length
          const goal = add(hand, [0, T.stringLift, 0]);
          const acc = sub(scale(sub(goal, str), T.stringK), scale(strV, T.stringC));
          strV = add(strV, scale(acc, dt));
          str = add(str, scale(strV, dt));
          const off = sub(str, hand);
          const ol = length(off);
          if (ol > T.stringLength) {
            const n = scale(off, 1 / ol);
            str = add(hand, scale(n, T.stringLength));
            const out = strV[0] * n[0] + strV[1] * n[1] + strV[2] * n[2];
            if (out > 0) strV = sub(strV, scale(n, out));
          }
          return;
        }
        case 'sail': {
          ctx.buoy(body, 0);
          return;
        }
        case 'tray': {
          if (ctx.idleSteps() >= steps(T.trayIdle) && ctx.holding() === null && ctx.attach(body, body)) {
            // off the tray by himself, and home
            const p = ctx.pose(body) as Pose;
            ctx.stow(body, p);
            outOfWorld();
            jump(p.p);
            vel = [0, 0, 0];
            if (ctx.reducedMotion) cutHome();
            else goHome();
          }
          return;
        }
        default:
          if (state !== 'moored' || !ctx.still) {
            if (threatened()) {
              bump();
              return;
            }
          }
          scripted();
      }
    },

    post() {
      if (ctx.bracketed) return;
      if (state === 'held' || state === 'sail' || state === 'tray') {
        const p = ctx.pose(body);
        if (p && inWorld()) {
          prevAt = at;
          at = p.p;
          vel = ctx.velocity(body)?.linvel ?? vel;
        }
        if (state === 'held') {
          // he turns his tail to the way the hand takes him, and when it is still he faces the visitor
          const hv = Math.hypot(vel[0], vel[2]);
          const toV = sub(spec.visitor, at);
          turnTo(hv > 0.8 ? Math.atan2(vel[0], vel[2]) : Math.atan2(toV[0], toV[2]));
        } else if (state === 'tray') {
          const toV = sub(spec.visitor, at);
          turnTo(Math.atan2(toV[0], toV[2]));
        } else turn *= 0.96;
        if (state === 'sail') {
          sailSteps += 1;
          slowSteps = length(vel) < T.slow ? slowSteps + 1 : 0;
          if (slowSteps >= steps(T.slowFor) || sailSteps >= steps(T.sailMost)) recover();
        }
      }
    },

    bracket() {},

    still(on) {
      if (on && state !== 'moored') cutHome();
    },

    reset() {
      if (ctx.mode(body) !== 'gone' && ctx.mode(body) !== 'held') ctx.stow(body, ctx.pose(body) ?? { p: at, q: qyaw(heading) });
      // (E1) a reset does not replay his entrance: he is at his mast, his mast standing
      planted = true;
      arriving = false;
      grabbedFrom = null;
      pending = null;
      after = null;
      roundNotBefore = 0;
      roundIdle = steps(rng.range(T.roundIdle[0], T.roundIdle[1]));
      jump(MOORED);
      vel = [0, 0, 0];
      heading = spec.heading;
      turn = 0;
      legs = [];
      leg = null;
      stop = null;
      lookAt = null;
      ruffled = null;
      enter('moored');
    },

    crewView() {
      const rf = ruffled && ctx.clock.step - ruffled.at < steps((state === 'sail' ? T.sailMost : 0) + T.ruffled + 3) ? { how: ruffled.how, since: (ctx.clock.step - ruffled.at) / HZ } : null;
      return {
        kind: 'pitch',
        id,
        body,
        view: {
          kind: 'pitch',
          id,
          state,
          since,
          at,
          prevAt,
          velocity: vel,
          heading,
          turn,
          lookAt,
          leg,
          ruffled: rf,
          heldFor: state === 'held' ? (ctx.clock.step - grabbedAt) / HZ : 0,
          mast: spec.mast,
          mastHeading: spec.heading,
          body,
          mastCarried: !planted,
          planted: state === 'plant' ? Math.min(1, since / T.plantLet) : planted ? 1 : 0,
        },
      };
    },
  };
  return unit;
}
