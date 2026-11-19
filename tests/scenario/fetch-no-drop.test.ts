// R1 (Taylor, 2026-11-19: "when the robot grabs the box on the conveyor, he almost always drops it on the ground
// instead of the conveyor belt"): that was the fumble and nothing else. Three minutes of play on the real bench
// with no visitor input after the first action: every `place` ends with its crate taken in by the belt, and
// Fetch never lets go of a crate anywhere else.
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

test('three minutes of play: every set-down lands on the belt; nothing else leaves its hands', async () => {
  const w = await benchWorld('no-drop', { scene: FULL_BENCH });
  for (let i = 0; i < 2 * HZ; i++) w.advance();
  w.drainEvents();
  startPlay(w);
  // the belt; or the platen's tray, for a crate attract mode's lap was already setting there when play began
  const mouths = [FULL_BENCH.runner.rounds!.mouth, FULL_BENCH.runner.attract!.tray];
  let held: string | null = w.crew('fetch')!.carrying;
  let placing: string | null = null;
  const pending = new Map<string, number>(); // crate let go of by a place → the step it must be on the belt by
  let placed = 0;
  let fed = 0;
  const strays: string[] = [];
  for (let i = 0; i < 180 * HZ; i++) {
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'crew.state' && e.id === 'fetch' && e.state === 'place') placing = w.crew('fetch')!.carrying ?? held;
      if (e.type === 'taken-in' && mouths.includes(e.mouth) && pending.has(e.part)) {
        pending.delete(e.part);
        fed++;
      }
    }
    const f = w.crew('fetch')!;
    // a crate left its hands: by a place, or not
    if (held !== null && f.carrying !== held) {
      if (f.state === 'place' && placing === held) {
        placed++;
        pending.set(held, w.step + HZ);
      } else strays.push(`${held} let go in ${f.state} at ${(w.step / HZ).toFixed(2)} s`);
    }
    held = f.carrying;
    for (const [id, by] of pending) expect(w.step, `${id} set down but not taken in by the belt (or the tray)`).toBeLessThanOrEqual(by);
  }
  console.log(`three minutes of play: ${placed} set down, ${fed} taken in by the belt, strays ${JSON.stringify(strays)}`);
  expect(strays).toEqual([]);
  expect(placed).toBeGreaterThan(10);
  expect(fed).toBe(placed - pending.size);
  w.dispose();
}, 240_000);

// R1 (Taylor: "he pauses for too long after he drops it ... it just takes him too long to get back to things"):
// the offer lasts `ignoredFor` (5 s); then it is rolling at once, and the crate is on the belt within five seconds.
test('ignored, it gets back to work briskly: rolling as the offer ends, the crate fed within five seconds', async () => {
  const w = await benchWorld('brisk', { scene: FULL_BENCH });
  const at: Record<string, number> = {};
  for (let i = 0; i < 60 * HZ && at['fed'] === undefined; i++) {
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'crew.state' && e.id === 'fetch' && e.state === 'offer') at['offer'] ??= w.step;
      if (e.type === 'crew.state' && e.id === 'fetch' && e.from === 'offer') {
        at['offerEnds'] ??= w.step;
        expect(e.state).toBe('roll');
      }
      if (e.type === 'taken-in' && e.part === 'crate-4' && e.mouth === 'belt') at['fed'] ??= w.step;
    }
  }
  expect(FETCH_TUNING.ignoredFor).toBe(5);
  expect(at['offerEnds']! - at['offer']!).toBe(Math.round(FETCH_TUNING.ignoredFor * HZ));
  expect((at['fed']! - at['offerEnds']!) / HZ).toBeLessThan(5);
  w.dispose();
}, 60_000);
