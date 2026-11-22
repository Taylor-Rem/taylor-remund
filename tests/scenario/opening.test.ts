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
// identical at every step. Re-recorded at P4 D2b (the paint dial in crate-3: one more body, stowed, its `scheme` field,
// its unit and its knob in the registry), compared the same way and found identical but for the dial.
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
