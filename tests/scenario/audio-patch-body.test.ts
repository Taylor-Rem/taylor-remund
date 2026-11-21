// Patch with a body of its own (the 2026-11-20 prototype), heard. Its body is a part of the world (a paper box, as
// far as the world knows), so the world says `part.released` and `part.hit` for it; and Patch's own unit says
// `patch.throw`, as the scripted Patch does. Each contact must sound once, as Patch: never a paper crate's whoosh or
// knock as well. What the body adds is what the script never had: after its first touchdown it tumbles on, and each
// further bounce is a soft pat.
import { describe, expect, test } from 'vitest';
import { lift, world, patch } from './patch-body-helpers.ts';
import { Score, type Cue } from '../../src/workshop/audio/score.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const OPEN: Vec3 = [-6.5, 1.6, -2];

describe("the body Patch's sounds: its own, each once", () => {
  test('thrown across the bench: its "mmp" and one whoosh, one thud, pats as it tumbles on, and no paper crate at all', async () => {
    const { w, t } = await world();
    const score = new Score();
    const heard: { step: number; cue: Cue }[] = [];
    const run = (n: number): void => {
      for (let i = 0; i < n; i++) for (const cue of score.hear(w, t.run(1)).cues) heard.push({ step: w.step, cue });
    };
    run(5);
    lift(w, t, OPEN);
    // (the lift ran on the plain tape: the score catches up on what it has not heard in one go, as a late frame does)
    const from = w.step;
    let hand: Vec3 = OPEN;
    for (let i = 0; i < 10; i++) {
      hand = [hand[0] + 10 / 60, hand[1], hand[2]];
      w.dispatch({ type: 'carry', target: hand });
      run(1);
    }
    w.dispatch({ type: 'release' });
    run(1);
    expect(patch(w).state).toBe('fly');
    for (let i = 0; i < 8 * 60 && patch(w).state === 'fly'; i++) run(1);
    const ids = heard.filter((h) => h.step > from).map((h) => h.cue.id);
    // nothing of a paper part: the body is Patch, not a crate
    expect(ids.filter((id) => id.startsWith('hit.paper') || id.startsWith('pick.paper'))).toEqual([]);
    // its own throw: one "mmp", one whoosh (not the part's as well), one thud for its first touchdown
    expect(ids.filter((id) => id === 'patch.fly').length).toBe(1);
    expect(ids.filter((id) => id === 'throw.whoosh').length).toBe(1);
    expect(ids.filter((id) => id === 'patch.thud').length).toBe(1);
    // and it tumbles on: a pat or more after the thud, each quieter than a knock, never two within a tenth of a second
    const thud = heard.find((h) => h.step > from && h.cue.id === 'patch.thud')!;
    const pats = heard.filter((h) => h.step > thud.step && h.cue.id === 'patch.pat');
    expect(pats.length).toBeGreaterThan(0);
    for (let i = 1; i < pats.length; i++) expect(pats[i]!.step - pats[i - 1]!.step).toBeGreaterThanOrEqual(6);
    expect(heard.filter((h) => h.step > from && h.step <= thud.step && h.cue.id === 'patch.pat')).toEqual([]);
    w.dispose();
  }, 60_000);
});
