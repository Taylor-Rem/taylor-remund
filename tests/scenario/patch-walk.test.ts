// R2: Patch's walk back to its stool: round the bench's bodies, never through them, never standing inside one;
// over the belt (only by its crossing) when that is the way; and in a time that fits the distance. On the
// whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { BENCH, benchWorld, FULL_BENCH, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, patchView } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PatchState, Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';
import { PATCH_ROUTE } from '../../src/workshop/sim/crew/patch-route.ts';
import { distanceTo, obstacles } from '../../src/workshop/sim/crew/fetch-knock.ts';
import { bodiesOf } from '../../src/workshop/sim/crew/fetch-route.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';

const T = PATCH_TUNING;
const R = PATCH_ROUTE.radius;
const BODIES = bodiesOf(obstacles(bench));

/** Lift Patch off its stool, carry it slowly to `to`, hold it there a moment, and let go (a set-down, not a fling). */
function setDown(w: World, t: Tape, to: Vec3): void {
  const s = patchView(w).at;
  const from: Vec3 = [s[0], 3, s[2] + 0.6];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: [from[0] + ((to[0] - from[0]) * i) / n, 3, from[2] + ((to[2] - from[2]) * i) / n] });
    t.run(1);
  }
  t.run(12);
  w.dispatch({ type: 'drag', id: 'patch', target: [to[0], 1.2, to[2]], end: true }); // (a hand's height: higher, it falls: R4)
  t.run(1);
  // (R4: let go above the bench it falls the little way to it first; the walk starts on its feet. The bench's Patch,
  // a body since 2026-11-20, lands where it falls and gets up from how it lies, onto the nearest place it can stand
  // and walk home from: the walk starts there)
  for (let i = 0; i < 120 && (patchView(w).state === 'fly' || patchView(w).state === 'land'); i++) t.run(1);
}

interface Trip {
  states: PatchState[];
  seconds: number;
  walked: number;
  /** The worst intrusion into a static body (0: never closer than its footprint), and where. */
  worst: number;
  worstAt: string;
  crossings: { x0: number; x1: number; seconds: number }[];
  /** The closest Patch's footprint came to Fetch's body while Patch moved (negative: overlapping), and who moved into whom. */
  fetchGap: number;
}

/** Run until Patch is back on its stool (or `limit` seconds), watching every step. */
function watchTrip(w: World, t: Tape, limit = 30): Trip {
  const trip: Trip = { states: [], seconds: 0, walked: 0, worst: 0, worstAt: '', crossings: [], fetchGap: Infinity };
  let prev = patchView(w).at;
  let crossFrom: number | null = null;
  let crossT = 0;
  for (let i = 0; i < limit * HZ; i++) {
    t.run(1);
    const v = patchView(w);
    if (trip.states[trip.states.length - 1] !== v.state) trip.states.push(v.state);
    trip.seconds += 1 / HZ;
    if (v.state === 'walk' && Math.hypot(v.at[0] - prev[0], v.at[2] - prev[2]) > 1e-9) {
      const fc = w.crewView('fetch');
      const fp = fc && fc.kind === 'fetch' ? w.motion(fc.body)?.pose.p : undefined;
      const fh = fc && fc.kind === 'fetch' ? w.halfExtents(fc.body) : undefined;
      if (fp && fh) {
        const e = Math.max(fh[0], fh[2]);
        const gap = distanceTo({ id: 'fetch', x: fp[0], z: fp[2], hx: e, hz: e, yaw: 0 }, v.at[0], v.at[2]) - R;
        if (process.env.PATCH_WALK_NEAR && gap < 0.05) console.log('near fetch', trip.seconds.toFixed(2), v.state, 'patch', v.at.map((x) => x.toFixed(2)).join(','), 'prev', prev.map((x) => x.toFixed(2)).join(','), 'fetch', fp.map((x) => x.toFixed(2)).join(','), 'gap', gap.toFixed(3));
        trip.fetchGap = Math.min(trip.fetchGap, gap);
      }
    }
    if (v.state === 'walk') {
      trip.walked += Math.hypot(v.at[0] - prev[0], v.at[2] - prev[2]);
      for (const o of BODIES) {
        const d = distanceTo(o, v.at[0], v.at[2]);
        const intr = R - d;
        if (intr > trip.worst + 1e-9) {
          trip.worst = intr;
          trip.worstAt = `${o.id} at ${v.at.map((x) => x.toFixed(2)).join(',')}`;
        }
      }
    }
    if (v.state === 'cross' && crossFrom === null) {
      crossFrom = v.at[0];
      crossT = 0;
    }
    if (v.state === 'cross') crossT += 1 / HZ;
    if (v.state !== 'cross' && crossFrom !== null) {
      trip.crossings.push({ x0: crossFrom, x1: prev[0], seconds: crossT });
      crossFrom = null;
    }
    prev = v.at;
    if (v.state === 'seated') break;
  }
  return trip;
}

/** A seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Patch walks back to its stool round things (R2)', () => {
  test('from twenty seeded set-down places: back on its stool, never inside a body, in a time that fits the distance', async () => {
    const r = rng(Number(process.env.PATCH_WALK_SEED ?? 20261119));
    const report: string[] = [];
    const fetchGaps: number[] = [];
    for (let k = 0; k < 20; k++) {
      const to: Vec3 = [-8.4 + r() * 16.8, 0, -2.4 + r() * 7.2];
      const w = await benchWorld(k + 1);
      const t = tape(w);
      t.run(20);
      setDown(w, t, to);
      const start = patchView(w).at;
      // where it stands is clear of every body
      for (const o of BODIES) expect(distanceTo(o, start[0], start[2]), `set down at ${to.map((x) => x.toFixed(2))} inside ${o.id}`).toBeGreaterThanOrEqual(R - 1e-6);
      const trip = watchTrip(w, t, 40);
      report.push(`${k}: ${to.map((x) => x.toFixed(1)).join(',')} ${trip.seconds.toFixed(1)}s walked ${trip.walked.toFixed(1)} ${trip.states.join('>')}`);
      if (process.env.PATCH_WALK_LOG) console.log(report[k], 'fetch gap', trip.fetchGap.toFixed(3), trip.crossings);
      fetchGaps.push(trip.fetchGap);
      expect(patchView(w).state, report[k]).toBe("seated");
      expect(trip.worst, `${report[k]}: ${trip.worstAt}`).toBeLessThan(1e-6);
      // the time fits the distance: the set-off, the walk at no less than the walk's pace, any crossing, the climb, and a little waiting
      const budget = T.setOff * (1 + trip.crossings.length) + trip.walked / T.walk + trip.crossings.length * (T.crossOn + T.crossOver + T.crossOff + 2) + T.climb + 2.5;
      expect(trip.seconds, report[k]).toBeLessThan(budget);
      // and the walk is not a wander: no more than twice the straight way, and a few units round a body
      const foot = PATCHLAMP.patch.foot;
      expect(trip.walked, report[k]).toBeLessThan(2 * Math.hypot(foot[0] - start[0], foot[2] - start[2]) + 6);
    }
    // moving, it never brushes Fetch: it stops short (or goes round) before its footprint reaches Fetch's body
    expect(Math.min(...fetchGaps)).toBeGreaterThanOrEqual(-1e-6);
  }, 240_000);

  for (const [name, lever] of [['forward', 1], ['reversed', 0], ['stopped', 0.5]] as const) {
    test(`set down in front of the belt, it crosses it (belt ${name}), carried just as far as the belt runs, and is never taken by a machine`, async () => {
      const w = await benchWorld(3);
      const t = tape(w);
      t.run(20);
      w.dispatch({ type: 'turn', id: 'belt-lever', value: lever });
      w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 }); // the top speed: the most drift
      t.run(30);
      setDown(w, t, [-1, 0, 4.78]);
      const events0 = t.events.length;
      const trip = watchTrip(w, t, 30);
      expect(trip.states).toContain('cross');
      expect(patchView(w).state).toBe('seated');
      expect(trip.worst).toBeLessThan(1e-6);
      const c = trip.crossings[0]!;
      const surface = (w.machine('belt') as { surface: number }).surface;
      const onBelt = T.crossOver + T.crossOn * 0.5 + T.crossOff * 0.5;
      expect(Math.abs(c.x1 - c.x0 - surface * onBelt)).toBeLessThan(0.15);
      // nothing took Patch: no machine event names it
      const named = t.events.slice(events0).filter((x) => JSON.stringify(x.e).includes('"patch"') && !['crew.state', 'patch.reacted'].includes(x.e.type));
      expect(named.map((x) => x.e.type)).toEqual([]);
    }, 60_000);
  }

  test('a far set-down is a scamper; a near one a walk', async () => {
    const w = await benchWorld(5);
    const t = tape(w);
    t.run(20);
    setDown(w, t, [-8, 0, 0]);
    t.run(Math.round((T.setOff + 0.2) * HZ));
    expect(patchView(w).walk).toMatchObject({ scamper: true, pace: T.scamper });
    const n = await benchWorld(5);
    const tn = tape(n);
    tn.run(20);
    const foot = PATCHLAMP.patch.foot;
    setDown(n, tn, [foot[0] + 1.5, 0, foot[2] + 1.2]);
    tn.run(Math.round((T.setOff + 0.2) * HZ));
    expect(patchView(n).walk).toMatchObject({ scamper: false, pace: T.walk });
  }, 60_000);

  // Set down gently it gets up and has only the set-off's turn to its way, then goes: the look at the visitor comes
  // only after a landing hard enough to earn it (sim/crew/patch-body.ts `afterShake`).
  test('before the first step: a turn to face its way, and no step', async () => {
    const w = await benchWorld(7, { scene: BENCH });
    const t = tape(w);
    t.run(20);
    setDown(w, t, [-4, 0, 1.5]);
    expect(patchView(w).state).toBe('walk');
    const at0 = patchView(w).at;
    const left = T.setOff - patchView(w).stateTime;
    expect(left, 'the set-off\'s turn is still to come').toBeGreaterThan(0.2);
    t.run(Math.round((left - 0.05) * HZ));
    const v = patchView(w);
    expect(v.at).toEqual(at0);
    const next = v.walk?.next;
    expect(next).toBeTruthy();
    expect(Math.abs(Math.atan2(Math.sin(v.heading - Math.atan2(next![0] - at0[0], next![2] - at0[2])), Math.cos(v.heading - Math.atan2(next![0] - at0[0], next![2] - at0[2]))))).toBeLessThan(1e-6);
    t.run(Math.round(0.3 * HZ));
    expect(Math.hypot(patchView(w).at[0] - at0[0], patchView(w).at[2] - at0[2])).toBeGreaterThan(0.1);
  }, 60_000);
});

/** Carry a loose part to `to` and set it down there (no throw), then let it come to rest. */
function place(w: World, t: Tape, id: string, to: Vec3): void {
  w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
  t.run(1);
  expect(w.holding()?.id, `${id} to hand`).toBe(id);
  // (up and over what stands between, as the page's carry rides over what it would run into: a hand that pushes
  // does not ram a crate through the platen's plinth, as the old carry's straight line here relied on)
  const from = w.motion(id)!.pose.p;
  for (let i = 1; i <= 50; i++) {
    const k = i / 50;
    const e = k * k * (3 - 2 * k);
    w.dispatch({ type: 'carry', target: [from[0] + (to[0] - from[0]) * e, Math.max(to[1], from[1]) + 2.4 * Math.sin(Math.PI * k), from[2] + (to[2] - from[2]) * e] });
    t.run(1);
  }
  // (carried until it is there and still: let go on the way, it slides on)
  for (let i = 0, there = 0; i < 400 && there < 15; i++) {
    w.dispatch({ type: 'carry', target: to });
    t.run(1);
    const p = w.motion(id)!.pose.p;
    there = Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2]) < 0.03 ? there + 1 : 0;
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  t.run(HZ);
}

/** Watch Patch home: the seconds it took, and the longest it stood in `walk` without a step, further than `beyond` from the stool's foot (the look and the turn before it sets off are part of that). */
function watchHome(w: World, t: Tape, limit: number, beyond: number): { seconds: number; stood: number; states: PatchState[] } {
  const foot = PATCHLAMP.patch.foot;
  const out = { seconds: 0, stood: 0, states: [] as PatchState[] };
  let prev = patchView(w).at;
  let run = 0;
  for (let i = 0; i < limit * HZ; i++) {
    t.run(1);
    const v = patchView(w);
    if (out.states[out.states.length - 1] !== v.state) out.states.push(v.state);
    out.seconds += 1 / HZ;
    const still = v.state === 'walk' && Math.hypot(v.at[0] - prev[0], v.at[2] - prev[2]) < 1e-9 && Math.hypot(v.at[0] - foot[0], v.at[2] - foot[2]) > beyond;
    run = still ? run + 1 : 0;
    out.stood = Math.max(out.stood, run / HZ);
    prev = v.at;
    if (v.state === 'seated') break;
  }
  return out;
}

// R5: found by the throw soak (its seed 2345, once "thrown up" meant more up than across and the throws fell
// differently). Taylor, R4: "They should still always be able to recover."
describe('Patch is never held up for good by crates lying on the bench (R5)', () => {
  test("a crate at the stool's foot and another across its way: round the one at once, and the other nudged aside at the last step", async () => {
    const w = await benchWorld(31, { scene: FULL_BENCH });
    const t = tape(w);
    t.run(20);
    const foot = PATCHLAMP.patch.foot;
    // one at the stool's foot: no way that keeps clear of every crate ends there
    place(w, t, 'crate-4', [foot[0] + 0.12, 0.6, foot[2] - 0.1]);
    const c4 = w.motion('crate-4')!.pose.p;
    expect(Math.hypot(c4[0] - foot[0], c4[2] - foot[2]), 'the crate lies at the foot').toBeLessThan(0.2);
    // and one where Patch's way round the fixed bodies leads, with Patch set down just behind it
    place(w, t, 'crate-1', [2.6, 0.8, 2.46]);
    setDown(w, t, [2.05, 0, 3.0]);
    expect(patchView(w).state).toBe('walk');
    const trip = watchHome(w, t, 40, 1.2);
    const what = `${trip.seconds.toFixed(1)} s, stood ${trip.stood.toFixed(1)} s, ${trip.states.join('>')}`;
    if (process.env.PATCH_WALK_LOG) console.log(what);
    expect(patchView(w).state, what).toBe('seated');
    // away from the stool it stands no longer than its set-off and one look for another way
    expect(trip.stood, what).toBeLessThan(T.setOff + T.retry + 0.5);
    // home: the set-off, the way round (a scamper), the wait at the foot for the crate there, the climb
    expect(trip.seconds, what).toBeLessThan(T.setOff + 10 / T.scamper + T.lastStep + T.climb + 3);
    // the crate at the foot was nudged aside, not walked through
    const c4b = w.motion('crate-4')!.pose.p;
    expect(Math.hypot(c4b[0] - c4[0], c4b[2] - c4[2]), 'the crate at the foot moved aside').toBeGreaterThan(0.1);
  }, 60_000);

  test("a big crate at the stool's foot that stops it more than a unit short: the last step's wait, the crate nudged aside, and up", async () => {
    const w = await benchWorld(32, { scene: FULL_BENCH });
    const t = tape(w);
    t.run(20);
    const foot = PATCHLAMP.patch.foot;
    // the big crate (0.4 half) with its near face inside Patch's footprint of the foot, on the side Patch comes from
    place(w, t, 'crate-1', [foot[0] + 0.56, 0.8, foot[2]]);
    const c1 = w.motion('crate-1')!.pose.p;
    setDown(w, t, [foot[0] + 3, 0, foot[2]]);
    // (it stops short of the crate, more than the unit the last step's wait was counted within)
    let short = 0;
    for (let i = 0; i < 4 * HZ; i++) {
      t.run(1);
      short = Math.hypot(patchView(w).at[0] - foot[0], patchView(w).at[2] - foot[2]);
    }
    expect(patchView(w).walk?.waiting, 'stopped by the crate').toBe(true);
    expect(short, 'more than a unit short').toBeGreaterThan(1);
    const trip = watchHome(w, t, 40, 0);
    const what = `${trip.seconds.toFixed(1)} s, stood ${trip.stood.toFixed(1)} s, ${trip.states.join('>')}, crate from ${[c1[0], c1[2]].map((x) => x.toFixed(2))} to ${[w.motion('crate-1')!.pose.p[0], w.motion('crate-1')!.pose.p[2]].map((x) => x.toFixed(2))}`;
    if (process.env.PATCH_WALK_LOG) console.log(what);
    expect(patchView(w).state, what).toBe('seated');
    // (one wait, the last step's, counted from when the crate stopped it: four seconds of it are already gone)
    expect(trip.seconds, what).toBeLessThan(T.lastStep - 4 + T.climb + 2.5);
    const c1b = w.motion('crate-1')!.pose.p;
    expect(Math.hypot(c1b[0] - c1[0], c1b[2] - c1[2]), 'the crate was nudged aside').toBeGreaterThan(0.05);
  }, 60_000);
});
