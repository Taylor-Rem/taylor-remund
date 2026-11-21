// Revert is never left standing (Taylor, 2026-11-20: "the characters reliably return home"). On the bench's floor with
// no way onto its track, neither home nor to park, it stands `stranded` seconds and then goes down where it stands
// (sinking there, seen) and comes back up through its hatch; and off a low perch it drives only to a floor spot it can
// get home from. Both layouts were found by the hand's tests on 2026-11-20, where it stood idle for good.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH, type Tape } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import { REVERT_TUNING } from '../../src/workshop/sim/crew/revert.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { RevertView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const T = REVERT_TUNING;
const rv = (w: World): RevertView => w.machine('revert-crew') as RevertView;
const HOME = [-4.832, 0.372] as const;

async function withRevertUp(seed: string): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(1));
  w.dispatch({ type: 'press', id: 'undo-lever' });
  for (let i = 0; i < steps(6) && rv(w).lift < 1; i++) t.run(1);
  t.run(steps(0.5));
  return { w, t };
}
/** Carry Revert by the hand and let it go still, its body steered over `to` (as revert-thrown's `carry`). */
function setDown(w: World, t: Tape, to: Vec3, passes = 3, each = 90): void {
  w.dispatch({ type: 'grab', id: 'revert', grip: w.motion('revert')!.pose.p });
  t.run(1);
  let target: Vec3 = [...to];
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < each; i++) {
      w.dispatch({ type: 'carry', target });
      t.run(1);
    }
    const p = w.motion('revert')!.pose.p;
    target = [target[0] + (to[0] - p[0]), target[1], target[2] + (to[2] - p[2])];
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 0] });
}
/** Watch for `secs`: the longest it stood idle on the floor away from its hatch, where it sank, and when it was home below. */
function watch(w: World, t: Tape, secs: number) {
  const ev: SimEvent[] = [];
  let idleAway = 0;
  let longest = 0;
  let sankAt: [number, number] | null = null;
  let below = -1;
  let upAgain = -1;
  let firstIdle: [number, number, number] | null = null;
  for (let i = 0; i < steps(secs); i++) {
    ev.push(...t.run(1));
    const r = rv(w);
    const away = Math.hypot(r.x - HOME[0], r.z - HOME[1]) > 0.1;
    if (r.state === 'idle' && away && w.motion('revert')!.mode === 'crew' && w.motion('revert')!.pose.p[1] - w.halfExtents('revert')![1] < 0.05) {
      if (!firstIdle) firstIdle = [r.x, r.z, r.heading];
      idleAway++;
      longest = Math.max(longest, idleAway);
    } else idleAway = 0;
    if (r.state === 'sinking' && away && !sankAt) sankAt = [r.x, r.z];
    if (r.state === 'below' && below < 0) below = i / HZ;
    if (below >= 0 && upAgain < 0 && r.lift >= 1) upAgain = i / HZ;
  }
  return { ev, longest: longest / HZ, sankAt, below, upAgain, firstIdle };
}

describe('Revert is never left standing with no way home', () => {
  test('set down on the floor at (-3.57, 1.85) facing the visitor, by the UNDO housing and Fetch\'s tape, with no way onto its track: it stands `stranded` s, sinks where it stands, comes up at its hatch, no card', async () => {
    const { w, t } = await withRevertUp('stranded');
    // (Carried straight to the place and let go there, in a second. Until 2026-11-21 this aimed a unit and a half
    // past it, at (-2.0, 1.95), and held on for four and a half seconds: the place was where Fetch, coming along its
    // lane meanwhile, and the housing's corner between them wedged a Revert that the hand was pressing into both.
    // The hand no longer presses a held thing into a fixed face (it slides along it), so that wedge is not where it
    // ends up; the place is what this test is about, not the way there.)
    setDown(w, t, [-3.57, 0.9, 1.85], 1, 60);
    const r = watch(w, t, 25);
    process.stderr.write(`\nstranded: came to stand at ${JSON.stringify(r.firstIdle?.map((n) => +n.toFixed(2)))}, idle away ${r.longest.toFixed(1)} s, sank at ${JSON.stringify(r.sankAt?.map((n) => +n.toFixed(2)))}, below at ${r.below.toFixed(1)} s, up again at ${r.upAgain.toFixed(1)} s\n`);
    // (the layout: it came to stand there, which is where it was found idle for good)
    expect(r.firstIdle, 'it came to stand on the floor').not.toBeNull();
    // (within a few tenths: where the hand's set-down leaves it moves a little with the carry's tuning; anywhere there
    // it has no trip it can start, which the sinking below proves)
    expect(Math.hypot(r.firstIdle![0] - -3.57, r.firstIdle![1] - 1.85), 'at the boxed-in spot').toBeLessThan(0.4);
    expect(r.longest, 'never left standing').toBeLessThan(T.alone + T.stranded + 0.5);
    expect(r.sankAt, 'it went down where it stood (seen sinking there)').not.toBeNull();
    expect(Math.hypot(r.sankAt![0] - r.firstIdle![0], r.sankAt![1] - r.firstIdle![1])).toBeLessThan(0.05);
    expect(r.below).toBeGreaterThan(0);
    expect(r.upAgain, 'back up through its hatch').toBeGreaterThan(r.below);
    expect(Math.hypot(rv(w).x - HOME[0], rv(w).z - HOME[1])).toBeLessThan(0.1);
    expect(r.ev.some((e) => e.type === 'card' && e.by === 'revert')).toBe(false);
    w.dispose();
  }, 120_000);

  test('let go over crate-3 at (-1.0, 1.85) (it lands on the crate and Fetch beside it): off the perch it drives only to a spot it can get home from, or goes down; home and below, never left standing', async () => {
    const { w, t } = await withRevertUp('perch-a crate');
    const p = w.motion('crate-3')!.pose.p;
    setDown(w, t, [p[0], 3.5, p[2]]);
    const r = watch(w, t, 30);
    process.stderr.write(`\noff crate-3: first stood at ${JSON.stringify(r.firstIdle?.map((n) => +n.toFixed(2)))}, idle away ${r.longest.toFixed(1)} s, below at ${r.below.toFixed(1)} s\n`);
    // (it was let go over the crate, where the old exit drove it to (-2.51, 1.96) and left it idle for good)
    expect(Math.hypot(p[0] - -1.0, p[2] - 1.85)).toBeLessThan(0.1);
    expect(r.longest, 'never left standing').toBeLessThan(T.alone + T.stranded + 0.5);
    expect(r.below, 'home and below').toBeGreaterThan(0);
    expect(r.ev.some((e) => e.type === 'card' && e.by === 'revert')).toBe(false);
    w.dispose();
  }, 120_000);
});
