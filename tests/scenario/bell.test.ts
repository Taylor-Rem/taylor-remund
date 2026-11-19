// (I1 R1) The dock's brass bell can be rung by hand: a press is the visitor's action (it ends attract mode),
// it swings and sounds the bell (`handle.worked` for the bell), and it changes nothing durable (not in the history).
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { bellOf } from '../../src/workshop/sim/machines/dock.ts';
import { Score } from '../../src/workshop/audio/score.ts';

describe('the dock’s bell', () => {
  test('a press rings it, ends attract mode, and writes nothing', async () => {
    const w = await benchWorld('bell', { scene: FULL_BENCH });
    const bell = bellOf('dock');
    expect(w.interactable(bell)?.affordances).toEqual(['press']);
    for (let i = 0; i < 2 * HZ; i++) w.advance();
    w.drainEvents();
    expect(w.playMode).toBe(false);
    w.dispatch({ type: 'press', id: bell });
    w.advance();
    const rang = w.drainEvents().filter((e) => e.type === 'handle.worked' && e.id === bell);
    expect(rang.length).toBe(1);
    expect(w.playMode).toBe(true);
    expect(w.attract().on).toBe(false);
    // rung again and again: each press rings; nothing is ever on the undo stack because of it
    for (let k = 0; k < 5; k++) {
      w.dispatch({ type: 'press', id: bell });
      w.advance();
    }
    expect(w.drainEvents().filter((e) => e.type === 'handle.worked' && e.id === bell).length).toBe(5);
    expect(w.durable().filter((d) => typeof d.writer === 'string' && /^t\d+$/.test(d.writer))).toEqual([]);
    w.dispose();
  });

  test('during a rung the bell does not answer', async () => {
    const w = await benchWorld('bell-rung', { scene: FULL_BENCH });
    w.dispatch({ type: 'press', id: 'button' });
    w.advance();
    w.drainEvents();
    w.dispatch({ type: 'press', id: bellOf('dock') });
    w.advance();
    expect(w.drainEvents().some((e) => e.type === 'handle.worked' && e.id === bellOf('dock'))).toBe(false);
    w.dispose();
  });

  test('it sounds, softer than a shipment, and rung fast never more than three at once', async () => {
    const w = await benchWorld('bell-sound', { scene: FULL_BENCH });
    const score = new Score();
    const bell = bellOf('dock');
    const rings: number[] = [];
    // ten presses, one every 0.1 s
    for (let k = 0; k < 10; k++) {
      w.dispatch({ type: 'press', id: bell });
      for (let i = 0; i < HZ / 10; i++) {
        w.advance();
        for (const c of score.hear(w, w.drainEvents()).cues) if (c.id === 'dock.bell') rings.push(c.gain);
      }
    }
    expect(rings.length).toBe(3);
    expect(rings[0]).toBeLessThan(1);
    expect(rings[1]!).toBeLessThan(rings[0]!);
    // after a rest it rings again
    for (let i = 0; i < 3 * HZ; i++) score.hear(w, (w.advance(), w.drainEvents()));
    w.dispatch({ type: 'press', id: bell });
    w.advance();
    expect(score.hear(w, w.drainEvents()).cues.some((c) => c.id === 'dock.bell')).toBe(true);
    w.dispose();
  });
});
