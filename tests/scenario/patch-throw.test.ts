// R4: Patch can be thrown. Let go with the hand moving, it flies a scripted arc (never a physics body), never
// through a fixed body; it lands clear, rolls, sits up, shakes its head, gives the look and walks home; over an
// open edge within reach it catches the ledge; well clear it is gone and comes back up the chute by the pad. A
// hundred seeded throws (any place, direction and speed to the cap; some while it holds a job, some with the
// Button pressed meanwhile) all end with Patch on its stool, the job carried on, nothing durable changed by it.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, answer, patchView, send } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PatchState, Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';
import { solidsOf, sphereMeets } from '../../src/workshop/sim/crew/patch-route.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';

const T = PATCH_TUNING;
const SOLIDS = solidsOf(bench);

/** Lift Patch, carry it to `from` (held: the hand there), and let go with the hand moving at `v`. */
function throwFrom(w: World, t: Tape, from: Vec3, v: Vec3): void {
  const s = patchView(w).at;
  const a: Vec3 = [s[0], 3, s[2] + 0.6];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: [a[0] + ((from[0] - a[0]) * i) / n, a[1] + ((from[1] - a[1]) * i) / n, a[2] + ((from[2] - a[2]) * i) / n] });
    t.run(1);
  }
  w.dispatch({ type: 'drag', id: 'patch', target: from, end: true, velocity: v });
  t.run(1);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Flight {
  states: PatchState[];
  /** The deepest it went into a fixed body in the air (0: never). */
  inside: number;
  insideAt: string;
  /** The most steps running its sphere was inside a loose part or a robot's body in the air (one: the step of contact). */
  overlap: number;
  overlapAt: string;
  /** The longest stretch in `walk` without a break (seconds). */
  walk: number;
}

/** Loose parts Patch knocked in its flight (from its events). */
// (S5 R4: and Fetch knocked by it: Fetch's slide drops the crate in its hands, as a crate's hit does, charged to the
// throw's transaction like a knocked crate)
const knocked = (t: Tape): string[] => [
  ...t.of('patch.throw').filter((x) => x.e.phase === 'hit' && x.e.what !== undefined && /^(crate|tool)/.test(x.e.what)).map((x) => x.e.what as string),
  ...t.of('crew.knocked').filter((x) => x.e.by === 'patch').map((x) => x.e.id),
];

/** Until it is back on its stool (or `limit` s), watching the flight. */
function watch(w: World, t: Tape, limit: number): Flight {
  const f: Flight = { states: [], inside: 0, insideAt: '', overlap: 0, overlapAt: '', walk: 0 };
  const run = new Map<string, number>();
  let walking = 0;
  for (let i = 0; i < limit * HZ; i++) {
    t.run(1);
    const v = patchView(w);
    walking = v.state === 'walk' ? walking + 1 : 0;
    f.walk = Math.max(f.walk, walking / HZ);
    if (f.states[f.states.length - 1] !== v.state) f.states.push(v.state);
    if (v.state === 'fly') {
      // a loose part or a robot: never inside it for more than the step it is met
      for (const part of w.parts()) {
        const id = part.id;
        const m = w.motion(id);
        const h = w.halfExtents(id);
        if (!m || !h) continue;
        // inside: more than halfway into its sphere (its box, near enough: the parts sit upright)
        const box = { id, x: m.pose.p[0], z: m.pose.p[2], hx: h[0], hz: h[2], yaw: 0, y0: m.pose.p[1] - h[1], y1: m.pose.p[1] + h[1] };
        const inside = sphereMeets(box, v.at[0], v.at[1], v.at[2], T.bodyR * 0.5);
        // (while a Button rung plays Patch is held where it is and the world rewinds round it: not counted)
        const n = inside ? (run.get(id) ?? 0) + (w.bracketed ? 0 : 1) : 0;
        run.set(id, n);
        if (n > f.overlap) {
          f.overlap = n;
          f.overlapAt = `${id} at ${v.at.map((x) => x.toFixed(2)).join(',')}`;
        }
      }
      for (const o of SOLIDS)
        if (sphereMeets(o, v.at[0], v.at[1], v.at[2], T.bodyR * 0.8)) {
          f.inside = Math.max(f.inside, 1);
          f.insideAt = `${o.id} at ${v.at.map((x) => x.toFixed(2)).join(',')}`;
        }
    }
    if (v.state === 'seated' && f.states.length > 1) break;
  }
  return f;
}

describe('Patch thrown (R4)', () => {
  test('it can be thrown at least as hard as a part (it is light and soft)', () => {
    expect(T.throwMax).toBeGreaterThanOrEqual(LOOSE_TUNING.throwMax);
  });

  test('a throw across the bench: it flies, lands clear, rolls, sits up, shakes its head, gives the look and walks home', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    const before = w.durable();
    t.run(20);
    throwFrom(w, t, [4, 2.8, 2], [-6, 1, -0.5]);
    expect(patchView(w).state).toBe('fly');
    const f = watch(w, t, 30);
    expect(f.states.slice(0, 5)).toEqual(['fly', 'land', 'shake', 'look', 'walk']);
    expect(f.states.at(-1)).toBe('seated');
    expect(f.inside, f.insideAt).toBe(0);
    // nothing durable changed, unless it knocked a crate on the way (then that is one transaction, the throw's)
    if (knocked(t).length === 0) {
      expect(w.durable()).toEqual(before);
      expect(w.undoStack()).toEqual([]);
    } else expect(w.undoStack().length).toBe(1);
  }, 60_000);

  test('against the back wall: it stops there and drops, never through it', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-5, 3, 0], [0, 1, -7.5]);
    let minZ = Infinity;
    for (let i = 0; i < 3 * HZ; i++) {
      t.run(1);
      const v = patchView(w);
      if (v.state === 'fly') minZ = Math.min(minZ, v.at[2]);
    }
    expect(minZ).toBeGreaterThan(-5 + T.bodyR * 0.8);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('off the front, hard and high: gone, then back up the chute by the pad, and home', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [2, 3.5, 4], [0, 1.6, 7.5]);
    const f = watch(w, t, 40);
    expect(f.states).toContain('away');
    const i = f.states.indexOf('away');
    expect(f.states.slice(i, i + 3)).toEqual(['away', 'fly', 'land']);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('off the front, low: it catches the ledge as when let go there', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [7, 1.4, 4.6], [0, 0, 3]); // (clear of the belt and the ramp: its middle 0.8 up as it crosses the edge)
    const f = watch(w, t, 30);
    expect(f.states.slice(0, 2)).toEqual(['fly', 'ledge']);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('thrown at the stack of crates: it knocks them (one at least goes more than half a unit), all come to rest in a valid place, charged to the throw', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    const at0 = new Map([...w.parts()].map((p) => [p.id, w.motion(p.id)!.pose.p]));
    throwFrom(w, t, [-1.5, 2.1, 1.75], [9, 0, 0]);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
    expect(knocked(t).length).toBeGreaterThan(0);
    t.run(5 * 60);
    const moved = [...w.parts()].filter((p) => p.kind === 'crate').map((p) => Math.hypot(w.motion(p.id)!.pose.p[0] - at0.get(p.id)![0], w.motion(p.id)!.pose.p[2] - at0.get(p.id)![2]));
    expect(Math.max(...moved)).toBeGreaterThan(0.5);
    for (const p of w.parts()) {
      if (p.kind !== 'crate') continue;
      const loc = w.durable().find((d) => d.target === p.id && d.field === 'location');
      expect(loc, p.id).toBeTruthy();
      const where = (loc!.value as { at: string }).at;
      expect(['rest', 'in', 'on', 'shipped'], `${p.id} ${JSON.stringify(loc!.value)}`).toContain(where);
      if (where === 'rest') expect(w.motion(p.id)!.pose.p[1]).toBeGreaterThan(-0.01); // on the bench (or a machine), not under it
    }
    // charged to one transaction: the throw's
    expect(w.undoStack().length).toBe(1);
    expect(f.overlap, f.overlapAt).toBeLessThanOrEqual(1);
  }, 60_000);

  test('thrown at Fetch: it stops against it and drops beside it, never inside its body; the event names Fetch', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    const fc = w.crewView('fetch')!;
    const body = fc.kind === 'fetch' ? fc.body : '';
    const fp = w.motion(body)!.pose.p;
    throwFrom(w, t, [fp[0] - 3, 2.2, fp[2]], [9, 0, 0]);
    // the stack as it stands after each step of the flight
    const stackAt = new Map<number, string[]>();
    // (until the hit, then the flight is watched from there; the steps before it are the arc out of the hand)
    for (let i = 0; i < 90 && !t.of('patch.throw').some((x) => x.e.phase === 'hit' && x.e.what === body); i++) {
      t.run(1);
      stackAt.set(w.step - 1, w.undoStack().map((x) => x.id));
      stackAt.set(w.step, w.undoStack().map((x) => x.id));
    }
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
    const hit = t.of('patch.throw').find((x) => x.e.phase === 'hit' && x.e.what === body);
    expect(hit).toBeTruthy();
    // § E5: the hit belongs to the throw: it carries the throw's transaction, and that is on the stack then
    const txn = hit!.e.txn;
    expect(txn).toMatch(/^t\d+$/);
    expect(stackAt.get(hit!.step)).toContain(txn);
    expect(f.overlap, f.overlapAt).toBeLessThanOrEqual(1);
  }, 60_000);

  test('the wall: met flat it sticks a moment, slides down it and sits', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-5, 3.2, 1], [0, 0, -9]);
    const seen: string[] = [];
    let stuckAt: number[] | null = null;
    for (let i = 0; i < 4 * 60; i++) {
      t.run(1);
      const v = patchView(w);
      if (seen.at(-1) !== v.state) seen.push(v.state);
      if (v.state === 'wall' && v.stateTime < 0.2) stuckAt = stuckAt ?? [...v.at];
      if (v.state === 'wall' && v.stateTime > 0 && v.stateTime < T.stick - 0.02) expect(v.at).toEqual(stuckAt);
    }
    expect(seen.slice(0, 3)).toEqual(['fly', 'wall', 'land']);
    expect(t.of('patch.throw').some((x) => x.e.phase === 'hit' && x.e.wall === true)).toBe(true);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  // R5 (Taylor, 2026-11-20: "it can be fun to throw them against the back wall too"): flicked hard up the screen from
  // the top of a lift it goes up and back, and met the wall above where the wall's body used to end (6): it sailed
  // over and came down at the wall's foot. The wall stands above anything it can reach; from high it slides faster.
  // And it meets the wall inside the picture: its middle no higher than `wallMeet`, however high the hand had it.
  for (const [from, v] of [[[-3.5, 1.6, 0.8], [0, 27, -15.3]], [[-3.5, 4.2, 0.8], [0, 27, -15.3]], [[-6, 6.8, -1], [0, 2, -12]]] as const) {
    test(`thrown up and back from ${from[1]} up: it meets the wall well up, sticks, slides down and sits, in under three seconds`, async () => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      throwFrom(w, t, [...from], [...v]);
      const seen: string[] = [];
      let metAt = -1, top = 0, downAfter = -1, minZ = Infinity;
      for (let i = 0; i < 6 * HZ; i++) {
        t.run(1);
        const pv = patchView(w);
        if (seen.at(-1) !== pv.state) seen.push(pv.state);
        top = Math.max(top, pv.at[1]);
        minZ = Math.min(minZ, pv.at[2]);
        if (pv.state === 'wall' && metAt < 0) metAt = pv.at[1];
        if (pv.state === 'wall') downAfter = pv.stateTime;
      }
      expect(seen.slice(0, 3), seen.join('>')).toEqual(['fly', 'wall', 'land']);
      expect(metAt, 'well up the wall').toBeGreaterThan(Math.min(from[1] + 0.5, T.wallMeet - 0.3));
      expect(metAt, 'and inside the picture').toBeLessThan(T.wallMeet + 0.1);
      expect(top, 'never past the top of its flight').toBeLessThanOrEqual(T.topMid + 0.01);
      expect(minZ, 'never into the wall').toBeGreaterThan(-5 + T.bodyR * 0.8);
      expect(downAfter, 'the slide is over in time').toBeLessThan(3);
      const f = watch(w, t, 30);
      expect(f.states.at(-1)).toBe('seated');
    }, 60_000);
  }

  test('the sound of a throw: thrown, landed (and gone and back up the chute off the bench), each with its speed', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [2, 3.5, 4], [0, 0, 12]);
    watch(w, t, 30);
    const phases = t.of('patch.throw').map((x) => x.e.phase);
    expect(phases.slice(0, 2)).toEqual(['thrown', 'gone']);
    expect(phases).toContain('chute');
    expect(phases).toContain('landed');
    expect(t.of('patch.throw').every((x) => Number.isFinite(x.e.speed))).toBe(true);
  }, 60_000);

  test('from the carry in the open back lane: it carries on as far as the throw was hard (and a set-down stays put)', async () => {
    const far = async (speed: number): Promise<number> => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      throwFrom(w, t, [-6.5, 0.95, -1.5], [speed, 0, 0]);
      for (let i = 0; i < 4 * 60 && !['shake', 'look', 'walk'].includes(patchView(w).state); i++) t.run(1);
      const v = patchView(w);
      return Math.hypot(v.at[0] + 6.5, v.at[2] + 1.5);
    };
    const cap = await far(14), mid = await far(8), soft = await far(4);
    expect(cap).toBeGreaterThanOrEqual(9);
    expect(cap).toBeLessThanOrEqual(11);
    expect(mid).toBeGreaterThanOrEqual(4);
    expect(mid).toBeLessThanOrEqual(5);
    expect(soft).toBeGreaterThanOrEqual(1);
    expect(soft).toBeLessThanOrEqual(2);
    if (process.env.PATCH_THROW_LOG) console.log('lane', cap.toFixed(2), mid.toFixed(2), soft.toFixed(2));
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-6.5, 0.95, -1.5], [0, 0, 0]);
    expect(patchView(w).state).not.toBe('fly');
  }, 60_000);

  test('let go touching Fetch, the phone, the console or the stack: no pop (never more than half a unit above the hand)', async () => {
    const places: [string, (w: World) => Vec3][] = [
      ['fetch', (w) => { const c = w.crewView('fetch')!; const p = w.motion(c.kind === 'fetch' ? c.body : '')!.pose.p; return [p[0] - 0.4, 0.95, p[2]]; }],
      ['phone', () => [0.2, 0.95, 1.9]],
      ['console', () => [-0.6, 0.95, 1.3]],
      ['stack', () => [2.21 - 0.55, 0.95, 1.75]],
    ];
    for (const [name, at] of places) {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const hand = at(w);
      throwFrom(w, t, hand, [6, 0, 0]);
      const v = patchView(w);
      expect(v.at[1], name).toBeLessThanOrEqual(hand[1] + 0.5);
      watch(w, t, 30);
      expect(patchView(w).state, name).toBe('seated');
    }
  }, 120_000);

  // R4 fault (I1's crew test): taken off its stool the carry presses Patch to the back wall; let go there with the
  // hand moving away from the wall, it must fly. Through the intent path, as the page does it: lifted, carried to the
  // body and held there, then let go with the hand's velocity.
  describe('let go touching a body: away or along it flies, into it is the hit', () => {
    // (`side`: along the face, the way that is open; the back wall's case is I1's own: the hand front-left)
    const places: { name: string; hand: Vec3; away: [number, number]; side: number }[] = [
      { name: 'the back wall by the stool', hand: [2.75, 1.2, -4.42], away: [0, 1], side: -1 },
      { name: "the console's back", hand: [-0.6, 1.2, -0.58], away: [0, -1], side: 1 },
      { name: "the storefront's front", hand: [6.0, 1.2, -2.66], away: [0, 1], side: -1 },
    ];
    for (const pl of places) {
      const [ax, az] = pl.away;
      const sx = pl.side;
      const cases: { what: string; v: Vec3; fly: boolean; min: number }[] = [
        { what: 'away and to the side at 12', v: [sx * 8.6 * Math.abs(az) + ax * 8.9, 0, az * 8.9 + sx * 8.6 * Math.abs(ax)], fly: true, min: 2.5 },
        { what: 'straight away at 14', v: [ax * 14, 0, az * 14], fly: true, min: 2.5 },
        // (along the back wall, the way the board's end is not: toward the storefront)
        { what: 'along it at 8', v: [(pl.name.startsWith('the back') ? 1 : sx) * 8 * Math.abs(az), 0, sx * 8 * Math.abs(ax)], fly: true, min: 1.5 },
        { what: 'into it at 6', v: [-ax * 6, 0, -az * 6], fly: false, min: 0 },
      ];
      for (const c of cases) {
        test(`${pl.name}: ${c.what}`, async () => {
          const w = await benchWorld(1);
          const t = tape(w);
          t.run(20);
          const s = patchView(w).at;
          // lifted off the stool, carried to the body and held against it (a pause, then the flick's own few carries)
          w.dispatch({ type: 'drag', id: 'patch', target: [s[0], 2.4, s[2]] });
          t.run(1);
          for (let i = 1; i <= 40; i++) {
            w.dispatch({ type: 'drag', id: 'patch', target: [s[0] + ((pl.hand[0] - s[0]) * i) / 40, 2.4 + ((pl.hand[1] - 2.4) * i) / 40, s[2] + ((pl.hand[2] - s[2]) * i) / 40] });
            t.run(1);
          }
          t.run(20);
          w.dispatch({ type: 'drag', id: 'patch', target: pl.hand, end: true, velocity: c.v });
          // where it comes to rest (the first frame of the shake), then home
          let rest: Vec3 | null = null;
          for (let i = 0; i < 6 * 60 && !rest; i++) {
            t.run(1);
            const v = patchView(w);
            if (v.state === 'shake') rest = [...v.at] as Vec3;
          }
          watch(w, t, 40);
          const all = t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state);
          const states = all.join('>');
          if (c.fly) {
            expect(all, states).toContain('fly');
            expect(rest, states).not.toBeNull();
            // as far as the throw was hard, unless something stood in its way (then it met it: a hit)
            const hitSomething = t.of('patch.throw').some((x) => x.e.phase === 'hit');
            if (!hitSomething) expect(Math.hypot(rest![0] - pl.hand[0], rest![2] - pl.hand[2]), states).toBeGreaterThan(c.min);
          } else {
            // the wall gag, there (at most a step or two of flight first, when it was held a hair off the face)
            expect(all, states).toContain('wall');
            const flew = t.of('crew.state').filter((x) => x.e.id === 'patch');
            const f0 = flew.find((x) => x.e.state === 'fly'), w0 = flew.find((x) => x.e.state === 'wall');
            if (f0 && w0) expect(w0.step - f0.step, states).toBeLessThanOrEqual(6);
          }
          expect(patchView(w).state, states).toBe('seated');
        }, 60_000);
      }
    }
  });

  // I1's two failing records: held against the back wall, the hand sweeping -x along it at y 1.2 and let go
  // front-left at 12 u/s at x 2.52 (its middle at the board's end) and at x 2.3 (its middle in the board's desk)
  // (and I1's third: the hand at 1.31, z -4.40, its middle 0.71 up: into the panel's foot as well as the desk)
  for (const [x, full, hy, hz] of [[2.52, false, 1.15, -4.42], [2.3, false, 1.15, -4.42], [2.38, true, 1.15, -4.42], [2.3, true, 1.15, -4.42], [2.6, true, 1.15, -4.42], [2.3, true, 1.31, -4.4]] as const) {
    test(`I1's record: let go at x ${x}, ${hy} up, z ${hz} over the board's end${full ? ' (the whole bench: the board panel on its desk)' : ''}, the hand front-left at 12: it flies`, async () => {
      const w = full ? await benchWorld(1, { scene: FULL_BENCH }) : await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const s = patchView(w).at;
      w.dispatch({ type: 'drag', id: 'patch', target: [s[0], 2.4, s[2]] });
      t.run(1);
      for (let i = 1; i <= 30; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: [s[0] + ((3.37 - s[0]) * i) / 30, 2.4 + ((hy + 0.24 - 2.4) * i) / 30, s[2] + ((hz - s[2]) * i) / 30] });
        t.run(1);
      }
      for (let i = 1; i <= 6; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: [3.37 + ((x - 3.37) * i) / 6, hy + 0.24 - (0.24 * i) / 6, hz] });
        t.run(1);
      }
      w.dispatch({ type: 'drag', id: 'patch', target: [x, hy, hz], end: true, velocity: [-8.5, 0, 8.8] });
      t.run(1);
      const first = patchView(w);
      expect(first.state).toBe('fly');
      expect(first.at[1]).toBeLessThanOrEqual(hy + 0.5);
      // and it goes somewhere: hanging over the desk it starts from the desk's top (in front of the panel), not
      // boxed in between the board's end, the stool and the wall (I1's 1.44-unit run)
      const p0 = first.at;
      let far = 0;
      for (let i = 0; i < 3 * HZ && ['fly', 'land'].includes(patchView(w).state); i++) {
        t.run(1);
        const a = patchView(w).at;
        far = Math.max(far, Math.hypot(a[0] - p0[0], a[2] - p0[2]));
      }
      if (full) expect(far).toBeGreaterThan(3);
      const f = watch(w, t, 40);
      const all = t.of('crew.state').filter((e) => e.e.id === 'patch').map((e) => e.e.state);
      expect(all, all.join('>')).not.toContain('wall');
      expect(f.states.at(-1)).toBe('seated');
    }, 60_000);
  }

  // R4 up (Taylor: "when you lift Patch then drop him, he should have a falling and landing animation ... You should
  // be able to throw them up ... like juggling"). Through the intent path: lifted off its stool, carried, let go.
  describe('dropped from high, thrown up, caught in the air', () => {
    /** Lifted off its stool and carried to `hand` (the hand's point; its middle hangs `hangBelow` under it), held still. */
    const carryTo = (w: World, t: Tape, hand: Vec3): void => {
      const s = patchView(w).at;
      const a: Vec3 = [s[0], 2.4, s[2] + 0.6];
      for (let i = 0; i <= 40; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: [a[0] + ((hand[0] - a[0]) * i) / 40, a[1] + ((hand[1] - a[1]) * i) / 40, a[2] + ((hand[2] - a[2]) * i) / 40] });
        t.run(1);
      }
      for (let i = 0; i < 20; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: hand });
        t.run(1);
      }
    };
    const statesOf = (t: Tape): string[] => t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state as string);

    for (const h of [1, 3, 5.5]) {
      test(`let go still with its middle ${h} above the bench: it falls, lands, and is home`, async () => {
        const w = await benchWorld(1);
        const t = tape(w);
        t.run(20);
        const hand: Vec3 = [-6, h + T.hangBelow, -2];
        carryTo(w, t, hand);
        w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true });
        t.run(1);
        expect(patchView(w).state).toBe('fly');
        expect(patchView(w).thrown?.drop).toBe(true);
        // it falls straight: where it lands is under where it was let go
        let landedAt: Vec3 | null = null;
        let fell = 0;
        for (let i = 0; i < 5 * HZ && !landedAt; i++) {
          t.run(1);
          const v = patchView(w);
          if (v.state === 'land') {
            landedAt = [...v.at] as Vec3;
            fell = v.thrown?.fall ?? 0;
          }
        }
        expect(landedAt).not.toBeNull();
        expect(Math.hypot(landedAt![0] - hand[0], landedAt![2] - hand[2]), JSON.stringify(landedAt)).toBeLessThan(0.5);
        expect(fell).toBeCloseTo(h, 0);
        const f = watch(w, t, 40);
        const all = statesOf(t);
        expect(all.join('>')).toMatch(/held>fly>land>shake>look>walk.*>seated/);
        expect(f.states.at(-1)).toBe('seated');
      }, 60_000);
    }

    // Taylor, 2026-11-20, of a throw across the bench that had some lift in it: "Patch freezes mid air for several
    // frames ... when he makes contact with the ground, he freezes again". The hang at the top and the flop are for a
    // throw UP (more up than across); a throw that travels goes over its top without a stop and lands in its roll
    for (const [level, up] of [[8, 5], [6, 9], [4, 7]] as const) {
      test(`thrown across the bench at ${level} u/s with ${up} u/s of lift: over its top without a stop, head over heels, and down in a roll`, async () => {
        const w = await benchWorld(1);
        const t = tape(w);
        t.run(20);
        // (along z -2: open bench from end to end, between the console and the switchboard's runner)
        const hand: Vec3 = [5, 1.6, -2];
        carryTo(w, t, hand);
        w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [-level, up, 0] });
        t.run(1);
        expect(patchView(w).state).toBe('fly');
        let peak = 0, still = 0, tops = 0, steps = 0;
        let last = [...patchView(w).at] as Vec3;
        let land: ReturnType<typeof patchView> | null = null;
        for (let i = 0; i < 6 * HZ && !land; i++) {
          t.run(1);
          const v = patchView(w);
          if (v.state === 'fly') {
            steps++;
            peak = Math.max(peak, v.at[1]);
            if (v.thrown?.top) tops++;
            // presented as a throw, not as a drop: the tumble, not the arms-up rise
            expect(v.thrown?.drop, 'in flight it is a throw').toBe(false);
            if (Math.hypot(v.at[0] - last[0], v.at[2] - last[2]) < 0.2 * (level / HZ)) still++;
            last = [...v.at] as Vec3;
          } else if (v.state === 'land') land = v;
        }
        expect(steps).toBeGreaterThan(20);
        expect(tops, 'no hang at the top').toBe(0);
        expect(still, 'never a step in the air without moving on').toBe(0);
        // it did go up by the hand's lift (its middle 0.6 under the hand), so this is the high arc, not the level throw's loft
        expect(peak).toBeGreaterThan(hand[1] - T.hangBelow + 0.5);
        expect(land, 'it lands on the bench').not.toBeNull();
        expect(land!.thrown?.drop, 'the landing is the roll, not the flop').toBe(false);
        expect(land!.stateLength, 'no beat to wait out after the roll').toBeCloseTo(T.land, 5);
        const f = watch(w, t, 40);
        expect(f.states.at(-1)).toBe('seated');
      }, 60_000);
    }

    // (R5: the hang at the top is a float now, not a stop of so many steps: it is in the float for a few steps, and
    // drifts on through them; tests/scenario/patch-float.test.ts holds the float itself)
    test('thrown up with a little drift (1.5 u/s across, 9 up): still a throw up, with its float at the top and its flop', async () => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const hand: Vec3 = [-6, 1.2, -2];
      carryTo(w, t, hand);
      w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [1.5, 9, 0] });
      t.run(1);
      let tops = 0;
      let land: ReturnType<typeof patchView> | null = null;
      for (let i = 0; i < 6 * HZ && !land; i++) {
        t.run(1);
        const v = patchView(w);
        if (v.state === 'fly' && v.thrown?.top) tops++;
        if (v.state === 'land') land = v;
      }
      expect(tops).toBeGreaterThan(3);
      expect(land!.thrown?.drop).toBe(true);
      expect(land!.stateLength).toBeGreaterThan(T.land);
    }, 60_000);

    for (const up of [6, 12]) {
      test(`thrown straight up at ${up} u/s: it rises, hangs at the top, falls, and lands within a unit of where it left`, async () => {
        const w = await benchWorld(1);
        const t = tape(w);
        t.run(20);
        const hand: Vec3 = [-6, 1.2, -2];
        carryTo(w, t, hand);
        w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [0, up, 0] });
        t.run(1);
        expect(patchView(w).state).toBe('fly');
        const g = -w.scene.gravity;
        let peak = 0, topSteps = 0;
        let landedAt: Vec3 | null = null;
        for (let i = 0; i < 6 * HZ && !landedAt; i++) {
          t.run(1);
          const v = patchView(w);
          if (v.state === 'fly') {
            peak = Math.max(peak, v.at[1]);
            if (v.thrown?.top) topSteps++;
          }
          if (v.state === 'land') landedAt = [...v.at] as Vec3;
        }
        // as high as the hand's speed takes it (from its middle, 0.6 under the hand)
        expect(peak).toBeCloseTo(hand[1] - T.hangBelow + (up * up) / (2 * g), 0);
        expect(topSteps).toBeGreaterThan(3);
        expect(landedAt).not.toBeNull();
        expect(Math.hypot(landedAt![0] - hand[0], landedAt![2] - hand[2])).toBeLessThan(1);
        const f = watch(w, t, 40);
        expect(f.states.at(-1)).toBe('seated');
      }, 60_000);
    }

    test('juggled: thrown up, caught at the top (no snap), thrown again from there, three times, never touching the bench', async () => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      let hand: Vec3 = [-6, 1.2, -2];
      carryTo(w, t, hand);
      for (let k = 0; k < 3; k++) {
        // (six tosses of 5.5 units/s, each caught at its top, about a unit higher each time: all of them under the
        // ceiling for a held thing with room to spare, so every one is a real throw up and floats at its top. At 9
        // the last ones started so near the ceiling that they were hops of 3 units/s or less, which do not float:
        // crew/patch-float.ts)
        w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [0, 5.5, 0] });
        t.run(1);
        expect(patchView(w).state, `throw ${k + 1}`).toBe('fly');
        // up to the top
        for (let i = 0; i < 3 * HZ && !patchView(w).thrown?.top; i++) t.run(1);
        const v0 = patchView(w);
        expect(v0.thrown?.top, `throw ${k + 1} reaches its top`).toBe(true);
        const mid0 = [...v0.at] as Vec3;
        // caught there: the hand takes it a little off its scruff; it does not jump to the hand
        const grip: Vec3 = [mid0[0] + 0.1, mid0[1] + 0.2, mid0[2]];
        w.dispatch({ type: 'drag', id: 'patch', target: grip });
        t.run(1);
        const v1 = patchView(w);
        expect(v1.state).toBe('held');
        expect(Math.hypot(v1.at[0] - mid0[0], v1.at[1] - T.hangBelow - mid0[1], v1.at[2] - mid0[2]), `caught ${k + 1}: where it was`).toBeLessThan(0.05);
        // held a moment, the hand still: settles onto the hand
        for (let i = 0; i < 30; i++) {
          w.dispatch({ type: 'drag', id: 'patch', target: grip });
          t.run(1);
        }
        hand = grip;
        // the next throw flies from where it hangs now
        const before = patchView(w).at;
        w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [0, 5.5, 0] });
        t.run(1);
        const v2 = patchView(w);
        expect(v2.state).toBe('fly');
        expect(Math.abs(v2.at[1] - (before[1] - T.hangBelow))).toBeLessThan(0.3);
        // (then caught again, below: the loop goes on from the next throw)
        for (let i = 0; i < 3 * HZ && !patchView(w).thrown?.top; i++) t.run(1);
        const top = patchView(w).at;
        hand = [top[0], top[1] + T.hangBelow, top[2]];
        w.dispatch({ type: 'drag', id: 'patch', target: hand });
        t.run(1);
        expect(patchView(w).state).toBe('held');
        for (let i = 0; i < 20; i++) {
          w.dispatch({ type: 'drag', id: 'patch', target: hand });
          t.run(1);
        }
      }
      // never down on the bench in all that
      expect(statesOf(t)).not.toContain('land');
      w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true });
      const f = watch(w, t, 40);
      expect(f.states.at(-1)).toBe('seated');
    }, 60_000);

    test('never higher than 7.2, however high it is let go and however hard it is thrown up', async () => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const hand: Vec3 = [-3, 5.5 + T.hangBelow, -3.4];
      carryTo(w, t, hand);
      w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: [0, 14, 0] });
      let peak = 0;
      for (let i = 0; i < 4 * HZ; i++) {
        t.run(1);
        peak = Math.max(peak, patchView(w).at[1]);
      }
      expect(peak).toBeLessThanOrEqual(T.topMid + 1e-9);
      const f = watch(w, t, 40);
      expect(f.states.at(-1)).toBe('seated');
    }, 60_000);
  });

  test('a hundred seeded throws: every one ends on the stool, the job carried on, nothing durable changed by it', async () => {
    const r = rng(Number(process.env.PATCH_THROW_SEED ?? 20261119));
    const log: string[] = [];
    for (let k = 0; k < 100; k++) {
      const from: Vec3 = [-8 + r() * 16, 1.2 + r() * 2.6, -3.5 + r() * 8];
      const a = r() * Math.PI * 2;
      const sp = r() * 16; // past the cap too: it is clamped
      // (R4 up: every fifth thrown up, the hand's upward part up to past the cap, the level part anything)
      const upward = k % 5 === 4;
      const v: Vec3 = upward ? [Math.sin(a) * sp * 0.4, 1.5 + r() * 12, Math.cos(a) * sp * 0.4] : [Math.sin(a) * sp, Math.min(1.6, 0.18 * sp) * r(), Math.cos(a) * sp];
      const kind = k % 4; // 0, 1: plain; 2: while it holds a job; 3: the Button pressed in the air
      const w = await benchWorld(k + 1);
      const t = tape(w);
      t.run(20);
      const before = w.durable();
      const job = kind === 2 ? send(w, t, 'make the sign red') : null;
      if (job !== null) for (let i = 0; i < 3 * HZ && patchView(w).state !== 'drawer'; i++) t.run(1);
      throwFrom(w, t, from, v);
      if (kind === 3) {
        w.dispatch({ type: 'press', id: 'button' });
        t.run(1);
      }
      const f = watch(w, t, 60);
      const line = `${k}: from ${from.map((x) => x.toFixed(1))} v ${v.map((x) => x.toFixed(1))} kind ${kind}: ${f.states.join('>')}`;
      log.push(line);
      expect(patchView(w).state, line).toBe('seated');
      expect(patchView(w).at, line).toEqual(PATCHLAMP.patch.seat.map((x, i) => (i === 0 ? x + (patchView(w).stool.x - patchView(w).stool.rest) : x)));
      expect(f.inside, `${line} ${f.insideAt}`).toBe(0);
      expect(f.walk, `${line}: walking without a break`).toBeLessThanOrEqual(30);
      if (job !== null) expect(answer(t, job, 30).e.type, line).toBe('line.reply');
      else if (kind !== 3 && knocked(t).length === 0) expect(w.durable(), line).toEqual(before);
      // (S5 R4) it knocked a crate, or Fetch (which drops what it carries): all of it is the throw's, one transaction
      else if (kind !== 3) expect(w.undoStack().length, line).toBe(1);
      expect(f.overlap, `${line} ${f.overlapAt}`).toBeLessThanOrEqual(1);
    }
    if (process.env.PATCH_THROW_LOG) console.log(log.join('\n'));
  }, 600_000);
});
