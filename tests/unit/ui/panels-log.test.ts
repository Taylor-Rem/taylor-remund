// P4 H1: the maker's plate's live log (REWRITE.md § G "P4 as Taylor amended it": the history the UNDO lever
// replays, in plain words, as it happens). On the whole bench, stepping the world: each kind of change the
// visitor (or Patch, for a text) makes is a line; the lever takes lines away; nothing is read from anywhere
// else and nothing is written.
import { describe, expect, test } from 'vitest';
import { stubWorld } from '../sim/helpers.ts';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Intent } from '../../../src/workshop/sim/types.ts';
import { historyLines, linesKey, LOG_LINES, type LogWords } from '../../../src/workshop/ui/panels/log.ts';
import { liveWords } from '../../../src/content/hatches.ts';

const words = liveWords() as unknown as LogWords;

function rig(): { w: World; act(i: Intent, steps?: number): void; lines(): string[] } {
  const w = stubWorld(1, { scene: bench }).world;
  const act = (i: Intent, steps = 2): void => {
    w.dispatch(i);
    for (let k = 0; k < steps; k++) w.advance();
    w.drainEvents();
  };
  return { w, act, lines: () => historyLines(w, w.undoStack(), words).map((l) => l.text) };
}

describe('the plate says what the UNDO lever can take back', () => {
  test('nothing done, nothing listed (attract mode is the crew’s, and never on the stack)', () => {
    const r = rig();
    for (let k = 0; k < 60 * 30; k++) r.w.advance();
    expect(r.lines()).toEqual([]);
  });

  test('the belt: speed and the lever, newest first, in plain words', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    r.act({ type: 'turn', id: 'belt-lever', value: 0.5 });
    expect(r.lines()).toEqual(['Belt: running → stopped', 'Belt speed: 3 → 5']);
  });

  test('the cord moved from jack to jack, and a text Patch acted on is marked as one', () => {
    const r = rig();
    r.act({ type: 'unplug', cord: 'cord' });
    r.act({ type: 'plug', cord: 'cord', jack: 'jack-belt' });
    expect(r.lines()[0]).toBe('Patch cord: Storefront jack → Belt jack');
    r.act({ type: 'text', text: 'faster' }, 60 * 20);
    const lines = r.lines();
    expect(lines[0]).toMatch(/^Belt speed: \d → \d, by text$/);
  });

  test('a pull of the lever takes the newest group away; its lines go', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    r.act({ type: 'turn', id: 'belt-lever', value: 0.5 });
    const before = historyLines(r.w, r.w.undoStack(), words);
    expect(before[0]!.next).toBe(true);
    expect(before[1]!.next).toBe(false);
    r.act({ type: 'undo' }, 60 * 4);
    expect(r.lines()).toEqual(['Belt speed: 3 → 5']);
    r.act({ type: 'undo' }, 60 * 4);
    expect(r.lines()).toEqual([]);
  });

  test('at most a dozen lines, and the key changes only when the lines do', () => {
    const r = rig();
    // (one handle turned again and again is one gesture: the dial and the lever take turns)
    for (let k = 0; k < 20; k++) r.act(k % 2 === 0 ? { type: 'turn', id: 'belt-dial', value: k % 4 === 0 ? 0 : 1 } : { type: 'turn', id: 'belt-lever', value: k % 4 === 1 ? 0.5 : 1 });
    const lines = historyLines(r.w, r.w.undoStack(), words);
    expect(lines).toHaveLength(LOG_LINES);
    expect(linesKey(lines)).toBe(linesKey(historyLines(r.w, r.w.undoStack(), words)));
  });

  test('a crate put on the belt, and the storefront changed by text (Rapier)', async () => {
    const w = await rapierWorld(1, { scene: bench });
    const step = (n: number): void => {
      for (let k = 0; k < n; k++) w.advance();
      w.drainEvents();
    };
    const id = 'crate-3';
    w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
    step(2);
    w.dispatch({ type: 'place', at: 'belt' });
    step(90);
    expect(historyLines(w, w.undoStack(), words).map((l) => l.text)).toContain('Small crate: on the bench → on the belt');
    w.dispatch({ type: 'text', text: 'make the sign blue' });
    step(60 * 20);
    expect(historyLines(w, w.undoStack(), words).map((l) => l.text)[0]).toMatch(/^Storefront sign: green → blue, by text$/);
  });

  test('reading changes nothing in the world', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    const durable = JSON.stringify(r.w.durable());
    const stack = JSON.stringify(r.w.undoStack());
    historyLines(r.w, r.w.undoStack(), words);
    expect(JSON.stringify(r.w.durable())).toBe(durable);
    expect(JSON.stringify(r.w.undoStack())).toBe(stack);
  });
});
