// P3 S1: with reduced motion off and nothing restored, a fresh bench opens step for step as it did before tells, the
// visit's snapshot and reduced motion were built: the loading pictures (rendered at the pictures' step) and every test
// that follows the opening depend on it. `opening-fingerprint.json` was recorded from `rewrite` at c4bbefe, before any
// of that work, by stepping `openingWorld()` through `fingerprint()` (opening-helpers.ts). Re-recorded at P4 S5 (the crates
// became Taylor's six projects: a latch and a plate each in the registry, an `open` field each, two small spares behind the
// door instead of three of each size): every body's pose, mode and wakefulness and every crew view, step for step over
// the two minutes, was compared with the recording from `rewrite` at 01c6d57 (the small crates by size, since the one
// that comes up the chute in the second lap is another small crate now) and found identical. Re-recorded at P4 D1 (the ledger board in crate-1: one more body, stowed, its `tokens` field, its unit
// and two controls in the registry): a world with the board and one without it were stepped side by side for the two
// minutes and every body but the board, every durable field but its own, the crew, attract mode and the events were
// identical at every step. Re-recorded at P4 D3 (the report press in crate-2 and its envelope in the press: two more
// bodies, stowed, three fields, its unit and its lever in the registry): a world with the press and one without it were
// stepped side by side for the two minutes and every body but the two, every durable field but theirs, the crew,
// attract mode, the machines, the stack and the events were identical at every step. Re-recorded at D3 round two (the press redrawn:
// the envelope larger, the bed further out, a `refused` in its view), compared again the same way: identical. Re-recorded at
// P4 T2 (the tool wall: eight tools that start on their pegs, eight places, the board's body, its unit and its sheet): a world
// with them and one without them were stepped side by side for the two minutes and every body but the tools, every durable
// field but theirs, the crew, attract mode, the machines and the stack, and the events, were identical at every step.
// Re-recorded at P4 D2d, the paint dial joined to the tool wall (the dial in crate-3: one more body, stowed, its `scheme`
// field, its unit and its knob in the registry): with the dial, its knob, its unit and its field left out of the state,
// the opening matched the tool wall's recording at the pictures' step and every checkpoint.
// Re-recorded at I2 (the opening stand switched on: its body, its mouth and its unit in the bench; the six latches no
// longer in the registry): a world on the bench without the stand and one with it were stepped side by side for the two
// minutes, and every body, every durable field, the crew, attract mode, the machines but the stand (and the latches),
// the holding, the stack and the events were identical at every step (shots/i2/opening-compare.test.ts.txt).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fingerprint, openingWorld } from './opening-helpers.ts';
import type { Fingerprint } from './opening-helpers.ts';

const BEFORE = JSON.parse(readFileSync(new URL('./opening-fingerprint.json', import.meta.url), 'utf8')) as Fingerprint;

describe('the opening is unchanged', () => {
  test('a fresh world: the same state at the pictures\' step, and the same every step for two minutes', async () => {
    const w = await openingWorld();
    const now = fingerprint(w);
    expect(now.picture).toBe(BEFORE.picture);
    // (the first checkpoint that differs says where it began)
    for (let i = 0; i < BEFORE.checkpoints.length; i++) expect(now.checkpoints[i], `checkpoint ${i}`).toEqual(BEFORE.checkpoints[i]);
    w.dispose();
  });
});
