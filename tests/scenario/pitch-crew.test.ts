// Pitch beside the rest of the crew (P4 P1a): while his script has him his body is out of the world, so nothing
// Fetch, Revert or Patch decide can read him. The proof: the same seeded visit on the bench with and without him
// (attract mode into play, Fetch on its rounds, Revert out to heal, Patch at a text), step by step, every other
// unit's body and every part where it would have been without him, to the last bit, until the first moment his body
// comes into the world (in this visit: never; his round is flown out of the world too).
import { expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH } from './line-helpers.ts';
import { PITCHED, BODY, pitchOf } from './pitch-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';

function script(w: World, step: number): void {
  // a visitor who plays a little and then watches (his round comes in the quiet)
  if (step === 8 * HZ) w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
  if (step > 8 * HZ && step < 8 * HZ + 40) w.dispatch({ type: 'carry', target: [-0.4, 1.2, 1.4] });
  if (step === 8 * HZ + 40) w.dispatch({ type: 'release', velocity: [-3, 1, 0.5] });
  if (step === 14 * HZ) w.dispatch({ type: 'text', text: 'make it red' });
}

test('with him moored and on his round, every other body moves exactly as it does without him', async () => {
  const a = await benchWorld('pitch-crew', { scene: FULL_BENCH });
  const b = await benchWorld('pitch-crew', { scene: PITCHED });
  const ta = tape(a), tb = tape(b);
  const ids = [...a.parts()].map((p) => p.id);
  let rounds = 0;
  let wasRound = false;
  let firstDiff: string | null = null;
  for (let s = 0; s < 75 * HZ; s++) {
    script(a, s);
    script(b, s);
    ta.run(1);
    tb.run(1);
    const v = pitchOf(b);
    if (v.leg === 'round' && !wasRound) rounds++;
    wasRound = v.leg === 'round';
    expect(b.mode(BODY), `step ${s}: his body came into the world`).toBe('gone');
    if (firstDiff) continue;
    for (const id of ids) {
      const pa = a.motion(id)!.pose, pb = b.motion(id)!.pose;
      if (pa.p.some((x, i) => x !== pb.p[i]) || pa.q.some((x, i) => x !== pb.q[i])) {
        firstDiff = `step ${s}: ${id} at ${pa.p.join(',')} without him, ${pb.p.join(',')} with him`;
        break;
      }
    }
    const fa = a.crew('fetch')!, fb = b.crew('fetch')!;
    if (!firstDiff && (fa.state !== fb.state || fa.carrying !== fb.carrying)) firstDiff = `step ${s}: Fetch ${fa.state} without him, ${fb.state} with him`;
  }
  console.log(`pitch beside the crew: 75 s, his rounds ${rounds}, first difference: ${firstDiff ?? 'none'}`);
  expect(rounds).toBeGreaterThan(0);
  expect(firstDiff).toBeNull();
  a.dispose();
  b.dispose();
}, 120_000);
