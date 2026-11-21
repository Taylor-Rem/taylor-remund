// A tell ends when the VISITOR uses the station (REWRITE.md § B3; sim/machine.ts `Lamp.used`): on the bench with
// real physics, the belt's blink goes out as the belt takes a crate the visitor put on it. (The other half, that a
// crate the crew brings does not put a blink out, is the lamp's own test: tests/unit/sim/tells.test.ts.)
import { expect, test } from 'vitest';
import { benchWorld, onBelt, putOn, tape } from './line-helpers.ts';
import { TELL_TUNING } from '../../src/workshop/sim/tells.ts';
import { steps } from '../../src/workshop/sim/clock.ts';

test("the belt is telling; the visitor puts a crate on it; the belt's lamp stops blinking as the belt takes the crate", async () => {
  const w = await benchWorld();
  const t = tape(w);
  t.run(30);
  // a first consequence: the Button, to the end of its rung
  w.dispatch({ type: 'press', id: 'button' });
  expect(t.until((e) => e.type === 'rung.ended', 3000)).not.toBeNull();
  // tells come every twelve seconds, nearest first: wait for the belt's
  const stations = 12;
  expect(t.until((e) => e.type === 'tell' && e.id === 'belt', steps(TELL_TUNING.every) * stations)).not.toBeNull();
  expect(w.machine('belt')?.lamp).toBe('blink');
  putOn(w, t, 'crate-2', onBelt(0.06));
  // (carrying it there took no longer than the blink: still telling as it is let go)
  const taken = t.until((e) => e.type === 'taken-in' && e.part === 'crate-2', 240);
  expect(taken?.e).toMatchObject({ id: 'belt', mouth: 'belt' });
  expect(w.machine('belt')?.lamp).not.toBe('blink');
});
