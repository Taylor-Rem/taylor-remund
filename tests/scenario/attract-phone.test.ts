// Picking the phone up is a first action (REWRITE.md § B3, § D 3): the line declares `open` and takes the
// press the stage sends when the visitor opens the phone (shell/boot.ts), so attract mode ends and the
// crew's demonstration stops; no crew text arrives in the visitor's log after it, and the press commits nothing.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

const sent = (w: Awaited<ReturnType<typeof benchWorld>>): number => {
  const v = w.machine('line');
  return v?.kind === 'line' ? v.log.filter((e) => e.kind === 'sent').length : -1;
};

describe('attract mode ended by opening the phone', () => {
  test('the line declares open; a press on it ends attract mode, commits nothing, and the crew texts no more', async () => {
    const w = await benchWorld('attract-phone', { scene: FULL_BENCH });
    expect(w.interactable('line')?.affordances).toContain('open');
    for (let i = 0; i < 4 * HZ; i++) w.advance();
    expect(w.attract().on).toBe(true);
    expect(w.playMode).toBe(false);
    w.dispatch({ type: 'press', id: 'line' });
    w.advance();
    expect(w.playMode).toBe(true);
    expect(w.attract().on).toBe(false);
    const before = sent(w);
    for (let i = 0; i < 40 * HZ; i++) w.advance();
    expect(sent(w), 'no crew text after the visitor picked the phone up').toBe(before);
    // nothing the visitor did is on the undo stack: the press opened no transaction
    expect(w.durable().filter((d) => typeof d.writer === 'string' && /^t\d+$/.test(d.writer))).toEqual([]);
    w.dispose();
  });

  test('while a rung plays the press is not taken, and the world carries on', async () => {
    const w = await benchWorld('attract-phone-rung', { scene: FULL_BENCH });
    w.dispatch({ type: 'press', id: 'button' });
    w.advance();
    w.dispatch({ type: 'press', id: 'line' });
    expect(() => {
      for (let i = 0; i < 2 * HZ; i++) w.advance();
    }).not.toThrow();
    w.dispose();
  });
});
