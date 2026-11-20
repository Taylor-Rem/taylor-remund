// AU1: the score against the real bench (real Rapier): what the visitor does is what is heard, in
// order, with the right note; and hearing changes nothing in the world (REWRITE.md § E2: `audio` never
// decides when things happen).
import { describe, expect, test } from 'vitest';
import { benchWorld, onBelt, putOn, waitFor } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { line } from './helpers.ts';
import { Score, type Cue, type LoopCue } from '../../src/workshop/audio/score.ts';
import { BELT_TUNING } from '../../src/workshop/sim/machines/belt.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SimEvent } from '../../src/workshop/sim/types.ts';

interface Heard {
  step: number;
  cue: Cue;
}

/** A tape that also lets the score hear every step, as the browser does every frame. */
function listening(w: World, score: Score): Tape & { heard: Heard[]; loops: { step: number; loops: readonly LoopCue[] }[] } {
  const events: { step: number; e: SimEvent }[] = [];
  const heard: Heard[] = [];
  const loops: { step: number; loops: readonly LoopCue[] }[] = [];
  const step = (): SimEvent[] => {
    w.advance();
    const ev = w.drainEvents();
    for (const e of ev) events.push({ step: w.step, e });
    const h = score.hear(w, ev);
    for (const cue of h.cues) heard.push({ step: w.step, cue });
    loops.push({ step: w.step, loops: h.loops });
    return ev;
  };
  return {
    events,
    heard,
    loops,
    run(n) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) out.push(...step());
      return out;
    },
    until(pred, max) {
      for (let i = 0; i < max; i++) {
        const hit = step().find(pred);
        if (hit) return { step: w.step, e: hit };
      }
      return null;
    },
    of(type) {
      return events.filter((x) => x.e.type === type) as never;
    },
  };
}

const ids = (h: Heard[], from = 0): string[] => h.filter((x) => x.step > from).map((x) => x.cue.id);
const hum = (t: ReturnType<typeof listening>): LoopCue => t.loops[t.loops.length - 1]!.loops.find((l) => l.id === 'loop.hum')!;

describe('the score on the bench', () => {
  test('picked up: its own note; put on the belt: struck S M L, then the bell; the hum follows the belt', async () => {
    const w = await benchWorld(1);
    const t = listening(w, new Score());
    t.run(30);
    expect(hum(t).gain).toBeGreaterThan(0); // the belt starts running

    // the lever to its middle notch: a click, and the hum dies away with the belt
    let from = w.step;
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(90);
    expect(ids(t.heard, from)).toContain('handle.lever');
    expect(hum(t).gain).toBe(0);

    from = w.step;
    putOn(w, t, 'crate-3', onBelt(0.54));
    expect(ids(t.heard, from)[0]).toBe('pick.wood.S'); // picked up: its own note, first
    waitFor(w, t, 'crate-3', 'in');
    putOn(w, t, 'crate-2', onBelt(0.42));
    waitFor(w, t, 'crate-2', 'in');
    putOn(w, t, 'crate-1', onBelt(0.3));
    waitFor(w, t, 'crate-1', 'in');

    from = w.step;
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(12 * HZ);
    const notes = t.heard.filter((x) => x.step > from && x.cue.id.startsWith('note.'));
    expect(notes.map((x) => x.cue.id)).toEqual(['note.wood.S', 'note.wood.M', 'note.wood.L']);
    // each note with the felt hammer, in the same step
    for (const n of notes) expect(t.heard.some((x) => x.step === n.step && x.cue.id === 'striker.felt')).toBe(true);
    // the dock: the shutter, and a bell for each shipped
    const after = ids(t.heard, from);
    expect(after.filter((x) => x === 'dock.bell').length).toBe(t.of('shipped').filter((s) => s.step > from).length);
    expect(after).toContain('dock.open');
    expect(after.indexOf('dock.open')).toBeLessThan(after.indexOf('dock.bell'));
    // panned: the dock is right of centre
    expect(t.heard.find((x) => x.step > from && x.cue.id === 'dock.bell')!.cue.pan).toBeGreaterThan(0);
    w.dispose();
  }, 120_000);

  test('the dial: a detent click each turn; the hum\'s rate follows the speed', async () => {
    const w = await benchWorld(1);
    const t = listening(w, new Score());
    t.run(120);
    const rateAt = (detent: number): number => {
      w.dispatch({ type: 'turn', id: 'belt-dial', value: (detent - 1) / (BELT_TUNING.speeds.length - 1) });
      t.run(120);
      return hum(t).rate;
    };
    const from = w.step;
    const slow = rateAt(1);
    const mid = rateAt(3);
    const fast = rateAt(5);
    expect(ids(t.heard, from).filter((x) => x === 'handle.dial').length).toBe(3);
    expect(slow).toBeLessThan(mid);
    expect(mid).toBeCloseTo(1, 1);
    expect(fast).toBeGreaterThan(mid);
    w.dispose();
  }, 120_000);

  test('the UNDO lever: latch, thunk at its stop, the tape for as long as what was undone, the clack home', async () => {
    const w = await benchWorld(1);
    const t = listening(w, new Score());
    t.run(30);
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(30);
    const from = w.step;
    w.dispatch({ type: 'press', id: 'undo-lever' });
    t.run(90);
    const h = t.heard.filter((x) => x.step > from);
    const order = h.map((x) => x.cue.id).filter((x) => x.startsWith('undo.') || x === 'tape.rewind');
    expect(order).toEqual(['undo.latch', 'tape.rewind', 'undo.thunk', 'undo.home']);
    const tapeCue = h.find((x) => x.cue.id === 'tape.rewind')!.cue;
    expect(tapeCue.param).toBeGreaterThanOrEqual(0.35);
    // the thunk lands when the lever reaches its stop: a tenth of a second after the pull
    const dt = (h.find((x) => x.cue.id === 'undo.thunk')!.step - h.find((x) => x.cue.id === 'undo.latch')!.step) / HZ;
    expect(dt).toBeGreaterThan(0.05);
    expect(dt).toBeLessThan(0.2);
    w.dispose();
  }, 120_000);

  test('a crate set down and thrown down: knocks with its own note, louder the harder it lands; never a drum roll', async () => {
    const w = await benchWorld(1);
    const t = listening(w, new Score());
    t.run(60);
    const drop = (h: number, down: number): Heard[] => {
      const from = w.step;
      // lifted straight up over an open stretch of bench, and let go
      const m = w.motion('crate-4')!.pose.p;
      w.dispatch({ type: 'grab', id: 'crate-4', grip: m });
      for (const p of line(m, [-2, h + 0.3, 2.2], 40)) {
        w.dispatch({ type: 'carry', target: p });
        t.run(1);
      }
      t.run(30);
      const let_go = w.step;
      w.dispatch({ type: 'release', velocity: [0, -down, 0] });
      t.run(150);
      const hits = t.heard.filter((x) => x.step > let_go && x.cue.id.startsWith('hit.'));
      console.log(`dropped from ${h} at ${down} u/s: ${hits.map((x) => `${x.cue.id} ${x.cue.gain.toFixed(2)}`).join(', ')} (strengths ${t.of('part.hit').filter((x) => x.step > from).map((x) => x.e.strength.toFixed(2)).join(' ')})`);
      return hits;
    };
    // let go still, low down; and thrown down hard
    const low = drop(0.3, 0);
    // (R4) at 9 and at the new cap the crate used to reach the bench between two of the score's speed samples and
    // sound softer than a set-down: the score now hears a contact at the fastest of the last 0.1 s
    const high = drop(0.6, 9);
    const hardest = drop(0.6, 14);
    expect(hardest.length).toBeGreaterThan(0);
    expect(Math.max(...hardest.map((x) => x.cue.gain))).toBeGreaterThan(Math.max(0, ...low.map((x) => x.cue.gain)));
    expect(high.length).toBeGreaterThan(0);
    expect(high[0]!.cue.id).toBe('hit.wood.S');
    expect(Math.max(...high.map((x) => x.cue.gain))).toBeGreaterThan(Math.max(0, ...low.map((x) => x.cue.gain)));
    // never more than one knock per part within the gap
    const steps = high.map((x) => x.step).sort((a, b) => a - b);
    for (let i = 1; i < steps.length; i++) expect(steps[i]! - steps[i - 1]!).toBeGreaterThanOrEqual(Math.round(0.08 * HZ) - 1);
    w.dispose();
  }, 120_000);

  test('hearing changes nothing: the same visit with and without the score ends in the same world', async () => {
    const play = async (listen: boolean): Promise<string> => {
      const w = await benchWorld(7);
      const score = new Score();
      const step = (n: number): void => {
        for (let i = 0; i < n; i++) {
          w.advance();
          const ev = w.drainEvents();
          if (listen) score.hear(w, ev);
        }
      };
      step(30);
      const m = w.motion('crate-4')!.pose.p;
      w.dispatch({ type: 'grab', id: 'crate-4', grip: m });
      for (const p of line(m, [onBelt(0.4)[0], 1.5, onBelt(0.4)[2]], 40)) {
        w.dispatch({ type: 'carry', target: p });
        step(1);
      }
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      step(400);
      w.dispatch({ type: 'press', id: 'undo-lever' });
      step(200);
      const parts = [...w.parts()].map((p) => `${p.id}:${JSON.stringify(p.location)}:${w.motion(p.id)!.pose.p.map((x) => x.toFixed(6)).join(',')}`);
      w.dispose();
      return parts.join('\n');
    };
    expect(await play(true)).toBe(await play(false));
  }, 120_000);
});
