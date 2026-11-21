// P3 S1: with reduced motion off and nothing restored, a fresh bench opens step for step as it did before tells, the
// visit's snapshot and reduced motion were built: the loading pictures (rendered at the pictures' step) and every test
// that follows the opening depend on it. `opening-fingerprint.json` was recorded from `rewrite` at c4bbefe, before any
// of that work, by stepping `openingWorld()` through `fingerprint()` (opening-helpers.ts).
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
