// (E1) The seam: a late unit joins a running world (`World.join`). Pitch is its only user. The world takes him at a
// step boundary, like an intent; he makes his entrance (in from beyond the bench, high, his mast slung, set down over
// its place, then moored); he is not the visitor's doing (the lever cannot take him back, a reset does not replay him,
// the saved state does not change); reduced motion has no entrance; a Button rung holds him back till it ends; and,
// the point of it all: from the step he has finished arriving, the world agrees with one that had him from the start.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import { home, pitchOf, fmt, BODY, PITCHED, MOORED } from './pitch-helpers.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';
import { pitchArrival, PITCH_SPEC } from '../../src/workshop/sim/scenes/bench-pitch.ts';
import { savedText } from '../../src/workshop/sim/saved.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PitchView, Vec3 } from '../../src/workshop/sim/types.ts';

const S = (s: number): number => Math.round(s * HZ);
const has = (w: World): boolean => w.crewView('pitch') !== undefined;

/** Everything of the world but Pitch's own view, as plain data (parts' fields and motion, every other crew member, machines, the stack). */
function snapshot(w: World): string {
  const parts = [...w.parts()].map((p) => ({ p, m: w.motion(p.id), mode: w.mode(p.id) }));
  const crew = w.crewViews().filter((c) => c.kind !== 'pitch');
  const machines = [...w.interactables()].map((i) => [i.id, w.machine(i.id) ?? null]);
  return JSON.stringify({ step: w.step, parts, crew, machines, durable: [...w.durable()].sort((x, y) => (`${x.target}.${x.field}` < `${y.target}.${y.field}` ? -1 : 1)), stack: w.undoStack().length, saved: savedText(w.saved()), button: w.button() });
}
/** Pitch's view without what depends on how long he has been in his state (`since`) or how he got there (`ruffled`). */
function him(v: PitchView): unknown {
  const { since: _s, ruffled: _r, prevAt: _p, ...rest } = v;
  return rest;
}

describe('a late unit (World.join): Pitch', () => {
  test('joins at the start of the next step, not before; once; and makes his entrance to his mast', async () => {
    const w = await benchWorld('late', { scene: bench });
    const t = tape(w);
    t.run(S(1));
    expect(has(w)).toBe(false);
    const n0 = [...w.interactables()].length;
    w.join(pitchArrival());
    w.join(pitchArrival()); // (asking twice is asking once)
    expect(has(w)).toBe(false);
    expect(w.has('pitch')).toBe(false);
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'joined' && e.id === 'pitch')).toBe(true);
    expect(w.has('pitch')).toBe(true);
    expect([...w.interactables()].length).toBe(n0 + 1);
    expect(w.interactable('pitch')?.name).toBe('name.pitch');
    const v0 = pitchOf(w);
    expect(v0.state).toBe('arrive');
    expect(v0.mastCarried).toBe(true);
    // in from beyond the bench's right end, high
    expect(v0.at[0]).toBeGreaterThan(bench.bench.maxX);
    expect(v0.at[1]).toBeGreaterThan(5.5);
    expect(w.mode(BODY)).toBe('gone');
    // the entrance: arrive, plant (the mast set down over its place), the way in, moored; the mast with him till planted
    const seen: string[] = [];
    let plantedAt = -1;
    for (let i = 0; i < S(30) && !home(w); i++) {
      t.run(1);
      const v = pitchOf(w);
      if (seen.at(-1) !== v.state) seen.push(v.state);
      if (plantedAt < 0 && !v.mastCarried) plantedAt = w.step;
      expect(v.at.every(Number.isFinite)).toBe(true);
      // never his nose down on his way in: the attitude is the view's, but he never sinks fast while arriving
      if (v.state === 'arrive') expect(v.velocity[1]).toBeLessThan(2.0);
    }
    expect(home(w), `${pitchOf(w).state} at ${fmt(pitchOf(w).at)}`).toBe(true);
    expect(seen.slice(0, 2)).toEqual(['arrive', 'plant']);
    expect(seen.at(-1)).toBe('moored');
    expect(pitchOf(w).mastCarried).toBe(false);
    // he straightens up as he moors at the end of it (the view's hat and tie)
    expect(pitchOf(w).ruffled?.how).toBe('arrived');
    const took = (w.step - 61) / HZ;
    console.log(`late: ${seen.join(' → ')}; mast planted at ${((plantedAt - 61) / HZ).toFixed(1)} s, moored ${took.toFixed(1)} s after he joined`);
    expect(took).toBeLessThan(16);
    w.dispose();
  });

  test('from the step he has finished arriving, the world agrees with one that had him from the start', async () => {
    const a = await benchWorld('agree', { scene: PITCHED });
    const b = await benchWorld('agree', { scene: bench });
    const ta = tape(a);
    const tb = tape(b);
    const N = S(1.5);
    ta.run(N);
    tb.run(N);
    b.join(pitchArrival());
    ta.run(1);
    tb.run(1);
    let k = 0;
    while (!home(b) && k++ < S(30)) {
      ta.run(1);
      tb.run(1);
    }
    expect(home(b)).toBe(true);
    expect(home(a)).toBe(true);
    // everything else, exactly; and him, but for how long he has been moored
    if (snapshot(b) !== snapshot(a)) console.log(firstDiff(JSON.parse(snapshot(a)), JSON.parse(snapshot(b))));
    expect(snapshot(b)).toBe(snapshot(a));
    expect(him(pitchOf(b))).toEqual(him(pitchOf(a)));
    // and they go on agreeing: quiet (his round starts at the same step in both), then the same hand in both
    let changed = false;
    for (let i = 0; i < S(40); i++) {
      ta.run(1);
      tb.run(1);
      if (pitchOf(a).state !== 'moored') changed = true;
      if (changed) expect(pitchOf(b)).toEqual(pitchOf(a));
    }
    expect(changed, 'he went on his round in both').toBe(true);
    for (const w of [a, b]) {
      const p = pitchOf(w).at;
      w.dispatch({ type: 'grab', id: 'pitch', grip: [p[0], p[1] + 0.25, p[2]] });
    }
    ta.run(1);
    tb.run(1);
    for (let i = 0; i < 30; i++) {
      for (const w of [a, b]) w.dispatch({ type: 'carry', target: [1 + i * 0.1, 2.5, 1] });
      ta.run(1);
      tb.run(1);
    }
    for (const w of [a, b]) w.dispatch({ type: 'release', velocity: [6, 2, 1] });
    for (let i = 0; i < S(15); i++) {
      ta.run(1);
      tb.run(1);
    }
    expect(snapshot(b)).toBe(snapshot(a));
    expect(pitchOf(b)).toEqual(pitchOf(a));
    a.dispose();
    b.dispose();
  });

  test('not the visitor\'s doing: the lever cannot take him back, a reset does not replay him, the saved state is as it was', async () => {
    const w = await benchWorld('lever', { scene: bench });
    const t = tape(w);
    t.run(S(1));
    // the visitor moves a crate before he comes
    const c = w.motion('crate-4')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-4', grip: c });
    t.run(1);
    for (let i = 0; i < 20; i++) {
      w.dispatch({ type: 'carry', target: [c[0] + 0.05 * i, c[1] + 0.4, c[2] + 0.5] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(S(2));
    const stack = w.undoStack().length;
    const saved = savedText(w.saved());
    w.join(pitchArrival());
    t.run(S(2));
    expect(pitchOf(w).state).toBe('arrive');
    // his arrival recorded nothing: the stack is as it was, nothing written by anyone but `settled`
    expect(w.undoStack().length).toBe(stack);
    expect(w.durable().filter((d) => d.target === BODY).every((d) => d.writer === 'settled')).toBe(true);
    expect(savedText(w.saved())).toBe(saved);
    // the lever takes back the crate, and leaves him on his way in
    w.dispatch({ type: 'undo' });
    t.run(S(1));
    expect(has(w)).toBe(true);
    expect(['arrive', 'plant']).toContain(pitchOf(w).state);
    // pulled again with nothing left: refused; he is still here
    const ev = (w.dispatch({ type: 'undo' }), t.run(S(0.5)));
    expect(ev.some((e) => e.type === 'undo.refused')).toBe(true);
    expect(has(w)).toBe(true);
    // a reset puts him at his mast, mast standing: no entrance again
    w.dispatch({ type: 'reset' });
    t.run(2);
    expect(home(w)).toBe(true);
    expect(pitchOf(w).mastCarried).toBe(false);
    t.run(S(5));
    expect(home(w)).toBe(true);
    w.dispose();
  });

  test('with reduced motion there is no entrance: he is at his mast when he arrives', async () => {
    const w = await benchWorld('reduced', { scene: bench, button: { reducedMotion: true } as never });
    const t = tape(w);
    t.run(S(1));
    w.join(pitchArrival());
    t.run(1);
    expect(home(w), `${pitchOf(w).state} at ${fmt(pitchOf(w).at)}`).toBe(true);
    expect(pitchOf(w).mastCarried).toBe(false);
    w.dispose();
  });

  test('a Button rung holds him back: he joins at the first step after it', async () => {
    const w = await benchWorld('rung', { scene: bench });
    const t = tape(w);
    t.run(S(1));
    w.dispatch({ type: 'press', id: 'button' });
    t.run(1);
    expect(w.bracketed).toBe(true);
    w.join(pitchArrival());
    let joinedAt = -1;
    let bracketEnd = -1;
    for (let i = 0; i < S(20) && joinedAt < 0; i++) {
      const was = w.bracketed;
      const ev = t.run(1);
      if (was && !w.bracketed && bracketEnd < 0) bracketEnd = w.step;
      if (ev.some((e) => e.type === 'joined')) joinedAt = w.step;
      if (w.bracketed) expect(has(w)).toBe(false);
    }
    expect(joinedAt).toBeGreaterThan(0);
    expect(joinedAt).toBeGreaterThanOrEqual(bracketEnd);
    expect(joinedAt - bracketEnd).toBeLessThanOrEqual(1);
    expect(untilHomeOk(w, t)).toBe(true);
    w.dispose();
  });

  test('caught on his way in: affronted, his mast still with him; let go, he goes back to set it down, then moors', async () => {
    const w = await benchWorld('caught', { scene: bench });
    const t = tape(w);
    t.run(S(1));
    w.join(pitchArrival());
    t.run(1);
    // let him come into the bench's air, then take him
    while (pitchOf(w).at[0] > 8.0) t.run(1);
    const a = pitchOf(w).at;
    w.dispatch({ type: 'grab', id: 'pitch', grip: [a[0], a[1] - 0.2, a[2]] });
    t.run(1);
    expect(w.holding()?.id).toBe('pitch');
    expect(pitchOf(w).state).toBe('held');
    expect(pitchOf(w).mastCarried).toBe(true);
    // carried down to the middle of the bench and flung toward the visitor
    const to: Vec3 = [0, 2.2, 2];
    for (let i = 1; i <= 50; i++) {
      w.dispatch({ type: 'carry', target: [a[0] + (to[0] - a[0]) * (i / 50), a[1] + (to[1] - a[1]) * (i / 50), a[2] + (to[2] - a[2]) * (i / 50)] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [2, 1, 5] });
    t.run(1);
    expect(pitchOf(w).state).toBe('sail');
    // his way back is his entrance again: up, across, the mast set down, moored
    const seen: string[] = [];
    for (let i = 0; i < S(30) && !home(w); i++) {
      t.run(1);
      if (seen.at(-1) !== pitchOf(w).state) seen.push(pitchOf(w).state);
    }
    expect(home(w), `${seen.join(' → ')}; ${pitchOf(w).state} at ${fmt(pitchOf(w).at)}`).toBe(true);
    expect(seen).toContain('arrive');
    expect(seen).toContain('plant');
    expect(seen.indexOf('plant')).toBeGreaterThan(seen.indexOf('arrive'));
    expect(pitchOf(w).mastCarried).toBe(false);
    console.log(`caught: ${seen.join(' → ')}`);
    w.dispose();
  });

  test('the moored place is the same as from the start (his spec), and his entry is off the bench', () => {
    expect(PITCH_SPEC.entry[0]).toBeGreaterThan(bench.bench.maxX + 2);
    expect(MOORED[1]).toBeCloseTo(PITCH_SPEC.mast[1], 6);
  });
});

function untilHomeOk(w: World, t: ReturnType<typeof tape>): boolean {
  for (let i = 0; i < S(30); i++) {
    if (home(w)) return true;
    t.run(1);
  }
  return home(w);
}

/** Where two plain values first differ (a path and the two values), for a failing agreement. */
function firstDiff(x: unknown, y: unknown, path = ''): string | null {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const d = firstDiff((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(x)?.slice(0, 300)} vs ${JSON.stringify(y)?.slice(0, 300)}`;
}
