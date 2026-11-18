// S5 round 2: the reach held as a property (the hands published as `CrewMember.hands` are a promise the arms
// are drawn to). On a bench whose Fetch reaches 1.3 and whose lane is a path of runs serving every place it
// handles: over three attract laps and thirty seconds of rounds, at every step the grip is within its reach of
// its centre, a part in its care is at the grip (or at the carry pose with the hands null), and nothing in its
// care, nor the grip, moves further in one step than its speed allows.
import { expect, test } from 'vitest';
import { benchWorld } from './line-helpers.ts';
import { reachBench, startPlay } from './fetch-helpers.ts';
import { FETCH_TUNING, canRunLap, fetchReach } from '../../src/workshop/sim/crew/fetch.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const SCENE = reachBench(1.3);
const QUIET = ['knocked', 'held', 'frozen', 'fumble'];

test('the reach holds: three attract laps and thirty seconds of rounds with a reach of 1.3', async () => {
  expect(fetchReach(SCENE)).toBe(1.3);
  expect(canRunLap(SCENE)).toEqual({ ok: true });
  const w = await benchWorld('reach-property', { scene: SCENE });
  const k = SCENE.crewScale ?? 1;
  const R = 1.3;
  // the most anything in its care can move in a step: its own run, its turn swinging the reach, and the hand's own speed
  const perStep = (FETCH_TUNING.maxSpeed * k + FETCH_TUNING.turnRate * R + FETCH_TUNING.handSpeed * k) / HZ + 1e-3;
  const carryPose = (x: number, z: number, heading: number, halfZ: number): Vec3 => {
    const d = (FETCH_TUNING.bodyHalfDepth + FETCH_TUNING.handGap) * k + halfZ;
    return [x + Math.sin(heading) * d, FETCH_TUNING.handHeight * k, z + Math.cos(heading) * d];
  };
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let prevGrip: Vec3 | null = null;
  let prevCare: { id: string; p: Vec3 } | null = null;
  let prevState = '';
  const seen = { hands: 0, carried: 0, placed: 0, taken: 0, taps: 0, maxReach: 0, maxStep: 0 };
  const check = (): void => {
    const f = w.crew('fetch')!;
    const quiet = QUIET.includes(f.state) || QUIET.includes(prevState);
    const hands = f.hands ?? null;
    const carry = carryPose(f.x, f.z, f.heading, f.carrying ? w.halfExtents(f.carrying)![2] : 0.225);
    const grip: Vec3 = hands ?? carry;
    if (hands) {
      seen.hands++;
      const r = Math.hypot(hands[0] - f.x, hands[2] - f.z);
      seen.maxReach = Math.max(seen.maxReach, r);
      expect(r, `step ${w.step} ${f.state}: the grip ${r.toFixed(3)} from its centre`).toBeLessThanOrEqual(R + 1e-6);
    }
    if (f.carrying && w.mode(f.carrying) === 'crew') {
      seen.carried++;
      const p = w.motion(f.carrying)!.pose.p;
      expect(dist(p, grip), `step ${w.step} ${f.state}: ${f.carrying} not at the grip`).toBeLessThan(2e-3);
      if (prevCare?.id === f.carrying && !quiet) {
        const d = dist(p, prevCare.p);
        seen.maxStep = Math.max(seen.maxStep, d);
        expect(d, `step ${w.step} ${f.state}: ${f.carrying} moved ${d.toFixed(3)} in a step`).toBeLessThanOrEqual(perStep);
      }
      prevCare = { id: f.carrying, p };
    } else prevCare = null;
    // the grip itself never jumps: not between steps, nor as the hands leave or come back to the carry pose
    if (prevGrip && !quiet) expect(dist(grip, prevGrip), `step ${w.step} ${prevState}→${f.state}: the grip jumped`).toBeLessThanOrEqual(perStep);
    prevGrip = quiet ? null : grip;
    prevState = f.state;
  };
  let lapsDone = 0;
  for (let i = 0; i < 200 * HZ && lapsDone < 3; i++) {
    if (i % steps(2) === 0) w.dispatch({ type: 'hover', id: null }); // a visitor present: no fumble, attract mode goes on
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'crew.state' && e.id === 'fetch' && e.state === 'tap') seen.taps++;
      if (e.type === 'crew.state' && e.id === 'fetch' && e.from === 'place') seen.placed++;
      if (e.type === 'crew.state' && e.id === 'fetch' && e.from === 'pickup') seen.taken++;
      expect(e.type === 'card' && e.by === 'fetch', 'OUT OF MY LANE with everything in reach').toBe(false);
      expect(e.type === 'crew.knocked', 'knocked by its own work').toBe(false);
    }
    lapsDone = w.attract().laps.length;
    check();
  }
  expect(lapsDone).toBe(3);
  startPlay(w);
  for (let i = 0; i < 30 * HZ; i++) {
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'crew.state' && e.id === 'fetch' && e.from === 'place') seen.placed++;
      if (e.type === 'crew.state' && e.id === 'fetch' && e.from === 'pickup') seen.taken++;
      expect(e.type === 'card' && e.by === 'fetch', 'OUT OF MY LANE with everything in reach').toBe(false);
    }
    check();
  }
  console.log(`reach 1.3: ${JSON.stringify(seen)} (per-step bound ${perStep.toFixed(3)})`);
  expect(seen.taps).toBeGreaterThanOrEqual(3);
  expect(seen.placed).toBeGreaterThanOrEqual(8);
  expect(seen.taken).toBeGreaterThanOrEqual(6);
  w.dispose();
}, 180_000);
