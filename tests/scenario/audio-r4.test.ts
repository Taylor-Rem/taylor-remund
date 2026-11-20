// R4 (Taylor, 2026-11-19: "so you can throw boxes and Fetch and Patch and stuff"): throwing, heard. From the
// simulation's events and published states only: a whoosh at release by speed (silent for a set-down, never louder
// than the landing); the landing at its real speed; Patch thrown (the drawn-out "mmp", the felt thud, the pat and
// the squeak down a wall, the yelp falling away and coming back up the chute); Fetch thrown (its yelp, its steel
// landing, the whirr as it rights itself); Revert's two hollow knocks from under a covered hatch. And the worst
// case for voices: Patch thrown into the stack of crates.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, putOn, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { line } from './helpers.ts';
import { Score, SCORE_TUNING, type Cue } from '../../src/workshop/audio/score.ts';
import { render } from '../../src/workshop/audio/render.ts';
import { lengthOf } from '../../src/workshop/audio/measure.ts';
import { MAX_VOICES } from '../../src/workshop/audio/mixer.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { PatchView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

interface Heard {
  step: number;
  cue: Cue;
}

/** A tape whose every step the score hears, as each frame is in the browser. */
function heardTape(w: World): { t: Tape; heard: Heard[] } {
  const t = tape(w);
  const score = new Score();
  const heard: Heard[] = [];
  const one = t.run;
  const step = (): SimEvent[] => {
    const ev = one(1);
    for (const cue of score.hear(w, ev).cues) heard.push({ step: w.step, cue });
    return ev;
  };
  return {
    heard,
    t: {
      ...t,
      run(n: number) {
        const out: SimEvent[] = [];
        for (let i = 0; i < n; i++) out.push(...step());
        return out;
      },
      until(pred: (e: SimEvent) => boolean, max: number) {
        for (let i = 0; i < max; i++) {
          const hit = step().find(pred);
          if (hit) return { step: w.step, e: hit };
        }
        return null;
      },
    } as Tape,
  };
}

const after = (h: Heard[], from: number): Heard[] => h.filter((x) => x.step > from);
const ids = (h: Heard[]): string[] => h.map((x) => x.cue.id);

/** Lift a part straight up over open bench and let it go with `v`. Returns the step it left the hand. */
function throwPart(w: World, t: Tape, id: string, v: Vec3, at: Vec3 = [-2, 1.6, 2.2]): number {
  const m = w.motion(id)!.pose.p;
  w.dispatch({ type: 'grab', id, grip: m });
  for (const p of line(m, at, 40)) {
    w.dispatch({ type: 'carry', target: p });
    t.run(1);
  }
  t.run(30);
  const s = w.step;
  w.dispatch({ type: 'release', velocity: v });
  t.run(1);
  return s;
}

/** Lift Patch to `from` and let it go with the hand moving at `v` (as tests/scenario/patch-throw.test.ts does). */
function throwPatch(w: World, t: Tape, from: Vec3, v: Vec3): number {
  const s = (w.machine('patch') as PatchView).at;
  const a: Vec3 = [s[0], 3, s[2] + 0.6];
  for (let i = 0; i <= 40; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: [a[0] + ((from[0] - a[0]) * i) / 40, a[1] + ((from[1] - a[1]) * i) / 40, a[2] + ((from[2] - a[2]) * i) / 40] });
    t.run(1);
  }
  const at = w.step;
  w.dispatch({ type: 'drag', id: 'patch', target: from, end: true, velocity: v } as never);
  t.run(1);
  return at;
}

/** The most voices sounding at once in a stretch of cues (each as long as its rendered sound at its rate), and the most new (R4) ones. */
function peakVoices(h: Heard[]): { all: number; r4: number } {
  const R4 = new Set(['throw.whoosh', 'patch.fly', 'patch.thud', 'patch.pat', 'patch.slide', 'patch.bump', 'patch.fall', 'patch.rise', 'fetch.whirr', 'revert.knock']);
  const len = new Map<string, number>();
  const span = h.map((x) => {
    const key = `${x.cue.id}@${x.cue.param ?? ''}`;
    if (!len.has(key)) len.set(key, lengthOf(render(x.cue.id, 48000, 0, x.cue.param), 48000));
    return { a: x.step / HZ, z: x.step / HZ + len.get(key)! / (x.cue.rate ?? 1), r4: R4.has(x.cue.id) };
  });
  let all = 0,
    r4 = 0;
  for (const s of span) {
    const on = span.filter((o) => o.a <= s.a && o.z > s.a);
    all = Math.max(all, on.length);
    r4 = Math.max(r4, on.filter((o) => o.r4).length);
  }
  return { all, r4 };
}

describe('R4: throwing, heard', () => {
  test('a crate: no whoosh for a set-down; a whoosh by speed, never louder than its landing; a hard throw louder than a soft one', async () => {
    const w = await benchWorld('audio-r4-crate', { scene: FULL_BENCH });
    const { t, heard } = heardTape(w);
    t.run(30);
    const go = (v: Vec3): { whoosh: Cue | null; land: number } => {
      const from = throwPart(w, t, 'crate-4', v);
      t.run(steps(2.5));
      const h = after(heard, from);
      const wh = h.find((x) => x.cue.id === 'throw.whoosh')?.cue ?? null;
      const land = Math.max(0, ...h.filter((x) => x.cue.id.startsWith('hit.')).map((x) => x.cue.gain));
      return { whoosh: wh, land };
    };
    const setDown = go([0, 0, 0]);
    const slow = go([2.5, 0, 0]);
    const soft = go([5, 1, 0]);
    const hard = go([12, 2, 0]);
    expect(setDown.whoosh).toBeNull();
    expect(slow.whoosh).toBeNull();
    expect(soft.whoosh).not.toBeNull();
    expect(hard.whoosh).not.toBeNull();
    // louder, longer and higher the harder it goes
    expect(hard.whoosh!.gain).toBeGreaterThan(soft.whoosh!.gain);
    expect(hard.whoosh!.param!).toBeGreaterThan(soft.whoosh!.param!);
    expect(hard.whoosh!.rate!).toBeGreaterThan(soft.whoosh!.rate!);
    // the whoosh never louder than the landing it leads to (whoosh level -9 against a knock's -1, and a fraction of its gain)
    for (const r of [soft, hard]) expect(r.whoosh!.gain).toBeLessThanOrEqual(r.land);
    expect(hard.land).toBeGreaterThan(setDown.land);
    w.dispose();
  }, 300_000);

  test('Fetch thrown: its yelp at release, its landing in painted steel, the whirr as it rights itself (crew.state held to shrug)', async () => {
    const w = await benchWorld('audio-r4-fetch', { scene: FULL_BENCH });
    const { t, heard } = heardTape(w);
    t.run(30);
    t.run(steps(2.5)); // past the lift's yelp gap: the throw's yelp is its own anyway
    const from = throwPart(w, t, 'fetch', [9, 3, -1], [-3, 1.8, 1.5]);
    t.run(steps(6));
    const h = after(heard, from - 1);
    const i = ids(h);
    expect(i).toContain('throw.whoosh');
    expect(i.filter((x) => x === 'fetch.yelp').length).toBeGreaterThanOrEqual(1);
    expect(h.find((x) => x.cue.id === 'fetch.yelp')!.step).toBe(from + 1);
    const p = w.part('fetch')!;
    expect(i).toContain(`hit.${p.material}.${p.size}`);
    const shrug = t.of('crew.state').find((x) => x.step > from && x.e.id === 'fetch' && x.e.state === 'shrug' && x.e.from === 'held');
    if (shrug) expect(h.find((x) => x.cue.id === 'fetch.whirr')?.step).toBe(shrug.step);
    else expect(i).not.toContain('fetch.whirr');
    process.stderr.write(`\nFetch thrown: ${h.map((x) => `${((x.step - from) / HZ).toFixed(2)} ${x.cue.id} ${x.cue.gain.toFixed(2)}`).join(', ')}\n`);
    w.dispose();
  }, 300_000);

  test('Patch thrown across: the drawn-out "mmp" (longer when harder), a whoosh, the felt thud by speed', async () => {
    const w = await benchWorld(1);
    const { t, heard } = heardTape(w);
    t.run(20);
    const from = throwPatch(w, t, [4, 2.8, 2], [-6, 1, -0.5]);
    t.run(steps(4));
    const h = after(heard, from);
    const i = ids(h);
    const fly = h.find((x) => x.cue.id === 'patch.fly')!;
    expect(fly).toBeDefined();
    expect(i).toContain('throw.whoosh');
    expect(i).toContain('patch.thud');
    // nothing that reads as pain: no bonk for a throw
    expect(i).not.toContain('patch.bonk');
    // harder: longer
    const w2 = await benchWorld(1);
    const b = heardTape(w2);
    b.t.run(20);
    const f2 = throwPatch(w2, b.t, [4, 2.8, 2], [-2.5, 0.5, 0]);
    b.t.run(steps(3));
    const fly2 = after(b.heard, f2).find((x) => x.cue.id === 'patch.fly')!;
    expect(fly.cue.param!).toBeGreaterThan(fly2.cue.param!);
    expect(after(b.heard, f2).some((x) => x.cue.id === 'throw.whoosh')).toBe(false); // under 4 u/s: no whoosh
    w.dispose();
    w2.dispose();
  }, 300_000);

  test('Patch against the back wall: a pat, then the squeak when it starts down, then it lands', async () => {
    const w = await benchWorld(1);
    const { t, heard } = heardTape(w);
    t.run(20);
    const from = throwPatch(w, t, [-5, 3.2, 1], [0, 0, -9]);
    t.run(steps(4));
    const h = after(heard, from);
    const wall = t.of('patch.throw').find((x) => x.step > from && x.e.phase === 'hit' && x.e.wall);
    expect(wall).toBeDefined();
    const pat = h.find((x) => x.cue.id === 'patch.pat')!;
    const slide = h.find((x) => x.cue.id === 'patch.slide')!;
    expect(pat.step).toBe(wall!.step);
    // the squeak only once it moves: at least the quarter second it sticks after the pat
    expect((slide.step - pat.step) / HZ).toBeGreaterThanOrEqual(0.2);
    expect(ids(h).filter((x) => x === 'patch.slide').length).toBe(1);
    w.dispose();
  }, 300_000);

  test('Patch off the front, hard and high: the yelp falls away; back up the chute with the launch and the yelp rising; then it lands', async () => {
    const w = await benchWorld(1);
    const { t, heard } = heardTape(w);
    t.run(20);
    const from = throwPatch(w, t, [2, 3.5, 4], [0, 1.6, 7.5]);
    t.run(steps(12));
    const i = ids(after(heard, from));
    const order = i.filter((x) => ['patch.fly', 'patch.fall', 'chute.launch', 'patch.rise', 'patch.thud'].includes(x));
    expect(order).toEqual(['patch.fly', 'patch.fall', 'chute.launch', 'patch.rise', 'patch.thud']);
    w.dispose();
  }, 300_000);

  test('the worst case for voices: Patch thrown into the stack of crates', async () => {
    const w = await benchWorld(1);
    const { t, heard } = heardTape(w);
    t.run(20);
    const from = throwPatch(w, t, [-1.5, 2.1, 1.75], [9, 0, 0]);
    t.run(steps(4));
    const h = after(heard, from - 1);
    const v = peakVoices(h);
    process.stderr.write(`\nPatch into the stack: ${h.length} cues; at most ${v.all} voices at once (${v.r4} of them R4's) [${ids(h).join(' ')}]\n`);
    expect(v.r4).toBeLessThanOrEqual(3);
    expect(v.all).toBeLessThanOrEqual(MAX_VOICES);
    w.dispose();
  }, 300_000);

  test('Revert knocking from under a covered hatch: two hollow knocks, at the leaves\' jumps', async () => {
    const w = await benchWorld('audio-r4-knock', { scene: FULL_BENCH });
    const { t, heard } = heardTape(w);
    t.run(steps(25));
    const id = ['crate-1', 'crate-2', 'crate-3', 'crate-4'].find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
    putOn(w, t, id, [-4.83, 0, 0.37]);
    t.run(steps(3));
    const from = w.step;
    w.dispatch({ type: 'press', id: 'button' });
    t.run(steps(8));
    const k = after(heard, from).filter((x) => x.cue.id === 'revert.knock');
    expect(k.length).toBe(2);
    expect((k[1]!.step - k[0]!.step) / HZ).toBeCloseTo(0.5, 1);
    w.dispose();
  }, 300_000);
});
