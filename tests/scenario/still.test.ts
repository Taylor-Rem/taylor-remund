// P3 S1: reduced motion in the world (REWRITE.md § B10: "the belt and crew start still ... Button rungs are a card and a
// lamp dip. Whatever the visitor does still moves. The settings can turn full motion on"), on the whole bench under
// real Rapier, from the pictures' step and from worlds already well into attract mode.
//
// The rule as built: while reduced motion is on and the visitor has not yet acted, nothing on the bench moves by
// itself. Fetch and Patch hold where they are, mid-stride, mid-stage, a crate in Fetch's hands (never in the air: a
// move in flight finishes first); attract mode, the fumble and the crew's idle laps wait; the belt is stopped (by the
// system: its `running` is written false). What is already falling, tumbling or being shipped finishes: within
// `SETTLE` seconds every body and every crew member is still, and stays so. From the visitor's first action the
// bench answers as it always does. Full motion switched back on before that resumes attract mode where it held.
import { describe, expect, test } from 'vitest';
import { openingWorld, PICTURE_STEP } from './opening-helpers.ts';
import { lastChange } from './still-helpers.ts';
import { onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent } from '../../src/workshop/sim/types.ts';

/** The longest anything goes on moving after the bench goes still (measured: 4.3 s, a restocked crate thrown up the chute onto the pad). */
const SETTLE = 5;
/** Where in attract mode the switch comes: the pictures' step, and a spread of moments through two laps (Fetch rolling, reaching, fumbling, Patch at work, a crate riding and shipping, the restock). */
const FROM = [PICTURE_STEP, 300, 900, 1095, 1500, 1988, 2552, 3200];

async function stepped(n: number): Promise<World> {
  const w = await openingWorld();
  for (let i = w.step; i < n; i++) {
    w.advance();
    w.drainEvents();
  }
  return w;
}

/** Reduced motion on, and the bench given `SETTLE` seconds to finish what was in flight. */
async function stilled(from: number): Promise<World> {
  const w = await stepped(from);
  w.dispatch({ type: 'motion', reduced: true });
  for (let i = 0; i < steps(SETTLE); i++) {
    w.advance();
    w.drainEvents();
  }
  return w;
}

const freePart = (w: World): Id => {
  const id = [...w.parts()].find((p) => p.kind === 'crate' && w.mode(p.id) === 'free' && !w.touched(p.id) && p.location.at === 'rest')?.id;
  if (!id) throw new Error('no free crate');
  return id;
};

describe('reduced motion before the first action: the bench is still', () => {
  for (const from of FROM) {
    test(`from step ${from}: everything still within ${SETTLE} s, and for a minute after`, async () => {
      const w = await stepped(from);
      w.dispatch({ type: 'motion', reduced: true });
      const settle = lastChange(w, steps(SETTLE));
      expect(settle).toBeLessThan(steps(SETTLE));
      expect(w.still).toBe(true);
      // a simulated minute: not one body, crew member or belt surface moves
      const tp = tape(w);
      const quiet = (() => {
        let changed = 0;
        const n = steps(60);
        for (let i = 0; i < n; i += steps(10)) changed = Math.max(changed, lastChange(w, steps(10)));
        return changed;
      })();
      expect(quiet).toBe(0);
      expect(tp.of('crew.state').filter((x) => x.e.id === 'fetch' && x.e.state === 'fumble')).toHaveLength(0);
      // the belt is stopped, by the system, and nothing of it is on the undo stack
      expect(w.setting('belt', 'running')).toBe(false);
      expect(w.writer('belt', 'running')).toBe('system');
      expect(w.undoStack()).toHaveLength(0);
      expect(w.playMode).toBe(false);
      w.dispose();
    });
  }

  test('the fresh world goes still at once: nothing moves after the belt has eased to a stop', async () => {
    const w = await stepped(PICTURE_STEP);
    w.dispatch({ type: 'motion', reduced: true });
    w.advance();
    const ev = w.drainEvents();
    expect(ev).toContainEqual({ type: 'still', on: true });
    // (the belt's surface eases to rest, under a second; Fetch and Patch hold from the first step)
    expect(lastChange(w, steps(SETTLE))).toBeLessThan(steps(1));
    w.dispose();
  });
});

describe('the first action brings the bench back to life', () => {
  test('the belt switched on carries a crate the visitor puts on it to the dock, and it ships', async () => {
    const w = await stilled(900);
    const t = tape(w);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    const woke = t.run(1);
    expect(woke).toContainEqual({ type: 'still', on: false });
    expect(w.playMode).toBe(true);
    expect(w.setting('belt', 'running')).toBe(true);
    expect(w.writer('belt', 'running')).toMatch(/^t\d+$/); // the visitor's now
    const id = freePart(w);
    putOn(w, t, id, onBelt(0.3));
    expect(waitFor(w, t, id, 'shipped', steps(40))).toBe(true);
    w.dispose();
  });

  test('a text gets its answer', async () => {
    const w = await stilled(1500);
    const t = tape(w);
    w.dispatch({ type: 'text', text: 'who are you' });
    t.run(steps(30));
    const sent = t.of('line.sent').find((x) => x.e.by === undefined);
    expect(sent).toBeDefined();
    const n = (sent!.e as Extract<SimEvent, { type: 'line.sent' }>).n;
    expect(t.events.some((x) => (x.e.type === 'line.reply' || x.e.type === 'line.refused') && x.e.n === n)).toBe(true);
    w.dispose();
  });

  test('a press plays the reduced rung (the dip and the card), and the bench is put back', async () => {
    const w = await stilled(PICTURE_STEP);
    const t = tape(w);
    w.dispatch({ type: 'press', id: 'button' });
    t.run(1);
    expect(w.button().script?.reduced).toBe(true);
    expect(w.button().script?.beats.map((b) => b.kind)).toEqual(['dip', 'rewind', 'card']);
    expect(t.until((e) => e.type === 'rung.ended', steps(5))).not.toBeNull();
    expect(t.of('card').some((c) => c.e.by === w.scene.button.cardBy)).toBe(true);
    w.dispose();
  });

  test('the crew are themselves again: Fetch, held mid-lap, goes on with its rounds once the visitor has acted', async () => {
    const w = await stilled(300);
    const t = tape(w);
    // the visitor's first action is the lever: the belt runs forward again, theirs; Fetch's rounds feed it
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(1);
    expect(t.of('crew.state').some((x) => x.e.id === 'fetch' && x.e.from === 'frozen')).toBe(true);
    const moved = lastChange(w, steps(20));
    expect(moved).toBeGreaterThan(0);
    const f = w.crewViews().find((c) => c.kind === 'fetch');
    expect(f && f.kind === 'fetch' ? f.member.state : null).not.toBe('frozen');
    w.dispose();
  });

  test('undo never takes the belt\'s stop back; the visitor\'s own lever use is theirs to undo', async () => {
    const w = await stilled(600);
    const t = tape(w);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.playMode).toBe(true);
    expect(w.setting('belt', 'running')).toBe(false);
    expect(w.writer('belt', 'running')).toBe('system');
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(2);
    expect(w.setting('belt', 'running')).toBe(true);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.setting('belt', 'running')).toBe(false);
    expect(w.writer('belt', 'running')).toBe('system');
    w.dispose();
  });
});

describe('full motion again', () => {
  test('before any action: the belt runs again (by the system) and attract mode goes on where it held', async () => {
    const w = await stilled(900);
    const beat = w.attract().beat;
    const laps = w.attract().laps.length;
    const t = tape(w);
    w.dispatch({ type: 'motion', reduced: false });
    t.run(1);
    expect(w.still).toBe(false);
    expect(t.of('still').map((x) => x.e.on)).toEqual([false]);
    t.run(2);
    expect(w.setting('belt', 'running')).toBe(true);
    expect(w.writer('belt', 'running')).toBe('system');
    expect(w.undoStack()).toHaveLength(0);
    // the lap goes on from the beat it held at, and comes round again
    expect(w.attract().on).toBe(true);
    for (let i = 0; i < steps(60) && w.attract().laps.length === laps; i++) t.run(1);
    expect(w.attract().laps.length).toBeGreaterThan(laps);
    expect(t.of('attract.beat').length).toBeGreaterThan(0);
    expect(beat).toBeTruthy();
    expect(w.playMode).toBe(false);
    w.dispose();
  });

  test('after an action: a belt the system stopped runs again; one the visitor has set since stays as they left it', async () => {
    const a = await stilled(600);
    a.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < steps(4); i++) a.advance();
    a.dispatch({ type: 'motion', reduced: false });
    for (let i = 0; i < 3; i++) a.advance();
    expect(a.setting('belt', 'running')).toBe(true);
    expect(a.writer('belt', 'running')).toBe('system');
    a.dispose();
    const b = await stilled(600);
    // forward, and back to the middle notch: stopped, and theirs
    b.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    for (let i = 0; i < 60; i++) b.advance();
    b.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    for (let i = 0; i < 3; i++) b.advance();
    b.dispatch({ type: 'motion', reduced: false });
    for (let i = 0; i < 3; i++) b.advance();
    expect(b.setting('belt', 'running')).toBe(false);
    expect(b.writer('belt', 'running')).toMatch(/^t\d+$/);
    b.dispose();
  });

  test('reduced motion switched on after the first action does not stop the bench (the crew\'s rounds and the belt are the visitor\'s)', async () => {
    const w = await stepped(600);
    w.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < steps(4); i++) w.advance();
    w.dispatch({ type: 'motion', reduced: true });
    for (let i = 0; i < 3; i++) w.advance();
    expect(w.still).toBe(false);
    expect(w.setting('belt', 'running')).toBe(true);
    expect(w.writer('belt', 'running')).toBe('settled');
    w.dispose();
  });
});
