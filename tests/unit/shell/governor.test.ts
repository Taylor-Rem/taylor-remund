// Stepping down during a visit (REWRITE.md § E7; P3 B1): the governor on recorded frame-time sequences.
import { describe, expect, it } from 'vitest';
import { Governor, GOVERNOR_TUNING, nextRatio, type GovernorStep } from '../../../src/workshop/shell/governor.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';

/** A recording: [frame ms, how many frames]. */
type Run = Array<[number, number]>;

/** Feed a recording; every step with the time (s, from the first frame) it was taken. */
function play(g: Governor, run: Run, t0 = 0): Array<GovernorStep & { at: number }> {
  const out: Array<GovernorStep & { at: number }> = [];
  let t = t0;
  for (const [ms, n] of run) {
    for (let i = 0; i < n; i++) {
      t += ms;
      const s = g.frame(ms, t);
      if (s) out.push({ ...s, at: Math.round((t / 1000) * 10) / 10 });
    }
  }
  return out;
}
const seconds = (ms: number, s: number): [number, number] => [ms, Math.round((s * 1000) / ms)];
const high = (ratio = 2): Governor => new Governor({ tier: 'high', ratio, lowRatio: 1 });

describe('the governor', () => {
  it('a machine that keeps up: never a step, in a minute', () => {
    expect(play(high(), [seconds(16.7, 60)])).toEqual([]);
  });

  it('a machine that runs at 50 frames a second (20 ms): not slow enough to step', () => {
    expect(play(high(), [seconds(20, 60)])).toEqual([]);
  });

  it('one bad second is not a trend: a GC pause, a tab switch, the visit’s first grab', () => {
    const run: Run = [
      seconds(16.7, 5),
      [180, 1], // a GC pause
      seconds(16.7, 5),
      [4000, 1], // a tab switch (not a frame time at all)
      seconds(16.7, 5),
      seconds(45, 1), // the first grab of a visit: a second of slow frames
      seconds(16.7, 10),
      seconds(40, 1.5), // and a second and a half later in the visit
      seconds(16.7, 20),
    ];
    expect(play(high(), run)).toEqual([]);
  });

  it('a sustained slowdown: resolution first, step by step to the floor, then the low tier, then the part-count seam, then nothing', () => {
    const steps = play(high(2), [seconds(16.7, 4), seconds(30, 150)]);
    expect(steps.map((s) => (s.kind === 'resolution' ? `ratio ${s.ratio}` : s.kind))).toEqual(['ratio 1.5', 'ratio 1.125', 'ratio 0.844', 'ratio 0.75', 'low', 'parts']);
    // never two steps closer than the settling time plus the patience
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.at - steps[i - 1]!.at).toBeGreaterThanOrEqual((GOVERNOR_TUNING.settleMs + GOVERNOR_TUNING.windowMs + (GOVERNOR_TUNING.patience - 1) * GOVERNOR_TUNING.everyMs) / 1000 - 0.05);
    expect(steps[0]!.at).toBeGreaterThanOrEqual(6); // the first step only after a trend of several seconds
  });

  it('never steps back up: a fast stretch after a step changes nothing, and the low tier is never sharper than the resolution already reached', () => {
    const g = high(1);
    const steps = play(g, [seconds(30, 14), seconds(10, 60)]);
    expect(steps.map((s) => s.kind)).toEqual(['resolution', 'low']);
    expect(g.state).toMatchObject({ tier: 'low', ratio: 0.75 });
  });

  it('the probe: the first frames after the handoff under 30 a second → the low tier at once', () => {
    const steps = play(high(), [seconds(40, 3)]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'low', why: 'probe' });
    expect(steps[0]!.at).toBeLessThanOrEqual(2.1);
  });

  it('the probe ignores the swap’s own first frames (shaders met for the first time)', () => {
    expect(play(high(), [[120, 3], seconds(16.7, 30)])).toEqual([]);
  });

  it('the probe needs enough frames to judge (a stalled start is not a verdict)', () => {
    expect(play(high(), [[200, 10], seconds(16.7, 10)])).toEqual([]);
  });

  it('a stage started on the low tier is not probed; it steps resolution, then the seam', () => {
    const g = new Governor({ tier: 'low', ratio: 1, lowRatio: 1 });
    const steps = play(g, [seconds(40, 40)]);
    expect(steps.map((s) => s.kind)).toEqual(['resolution', 'parts']);
    expect(g.state.done).toBe(true);
  });

  it('a pause (the tab hidden, the paperwork read) forgets the window and settles again', () => {
    const g = high();
    play(g, [seconds(16.7, 3), seconds(30, 4.5)]); // slow, but not yet three judgements
    g.pause(7600);
    const steps = play(g, [seconds(30, 3)], 7600);
    expect(steps).toEqual([]);
  });

  it('nextRatio: × 0.75 down to the floor', () => {
    expect(nextRatio(2)).toBe(1.5);
    expect(nextRatio(1)).toBe(0.75);
    expect(nextRatio(0.8)).toBe(0.75);
    expect(nextRatio(0.75)).toBeNull();
  });
});

describe('part count (§ E7: the low tier keeps at most 30 loose bodies)', () => {
  it('the whole bench holds far fewer loose bodies than 30, crew and all: the cap is a named seam, not built', () => {
    const loose = bench.parts.length;
    expect(loose).toBeLessThan(30);
    console.log(`the bench's loose bodies: ${loose} (${bench.parts.map((p) => p.id).join(', ')})`);
  });
});
