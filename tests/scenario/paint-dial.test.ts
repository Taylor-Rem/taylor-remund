// P4 D2b: the paint dial in t-components' crate. Its knob turns the workshop's scheme through the dial's detents, one
// effect a change under the visitor's transaction, undone exactly by the lever; a drag through several detents is one
// gesture, one transaction. The scheme is the dial's and stays with it whatever is done to it (carried, thrown, on the
// belt and shipped and back up the chute, painted on the platen, stowed again); out of reach a turn is a misfire.
// Never saved: a visit left in another scheme opens in the first, its crate's lid as it was. Reset puts it back.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, waitFor, onBelt, BENCH, type Tape } from './line-helpers.ts';
import { plug, textAndWait, traySpot } from './patchlamp-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { PAINT } from '../../src/workshop/sim/scenes/bench.ts';
import { PAINT_TUNING, SCHEME_FIELD } from '../../src/workshop/sim/machines/paint-dial.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import { parseSaved } from '../../src/workshop/sim/saved.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PaintDialView } from '../../src/workshop/sim/types.ts';

const D = PAINT.dial;
const K = PAINT.knob;
const S = PAINT_TUNING.schemes;
const scheme = (w: World): string => w.setting(D, SCHEME_FIELD) as string;
const view = (w: World): PaintDialView => w.machine(PAINT.unit) as PaintDialView;
const press = (w: World, id: string): void => w.dispatch({ type: 'press', id });
const turn = (w: World, value: number): void => w.dispatch({ type: 'turn', id: K, value });
const at = (i: number): number => i / (S.length - 1);
/** A press turns the paint once the double-tap window is past (`pressWait`), and a step. */
const PRESS = steps(PAINT_TUNING.pressWait) + 2;

/** The bench with t-components' crate opened: the dial on its tray. */
async function opened(seed: string): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: BENCH });
  const t = tape(w);
  t.run(30);
  press(w, `${PAINT.crate}-lid`);
  t.run(2);
  return { w, t };
}

describe('the paint dial', () => {
  test('stowed in its crate in the first scheme, its knob a misfire there; on the open crate\'s tray it turns', async () => {
    const w = await benchWorld('pd-start', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    expect(w.mode(D)).toBe('gone');
    expect(w.part(D)!.location).toMatchObject({ at: 'in', mouth: PAINT.crate });
    expect(scheme(w)).toBe(S[0]);
    expect(w.interactable(K)?.affordances).toEqual(expect.arrayContaining(['turn', 'press']));
    press(w, K);
    const ev = t.run(PRESS);
    expect(ev).toContainEqual({ type: 'misfire', id: K, level: 1 });
    expect(scheme(w)).toBe(S[0]);
    expect(w.undoStack()).toEqual([]);
    w.dispose();
    const { w: w2, t: t2 } = await opened('pd-open');
    expect(w2.mode(D)).toBe('machine');
    expect(view(w2).reachable).toBe(true);
    press(w2, K);
    const ev2 = t2.run(PRESS);
    expect(scheme(w2)).toBe(S[1]);
    expect(ev2.filter((e) => e.type === 'effect' && e.effect.target === D)).toHaveLength(1);
    expect(ev2).toContainEqual(expect.objectContaining({ type: 'paint.turned', scheme: S[1], from: S[0], index: 1, of: S.length }));
    expect(ev2).toContainEqual(expect.objectContaining({ type: 'handle.worked', id: K }));
    w2.dispose();
  });

  test('a press moves it one detent on, past the last back to the first; each is one effect the lever takes back exactly', async () => {
    const { w, t } = await opened('pd-press');
    const seen: string[] = [scheme(w)];
    for (let i = 0; i < S.length; i++) {
      press(w, K);
      t.run(steps(0.6)); // a new gesture each time
      seen.push(scheme(w));
    }
    expect(seen).toEqual([...S, S[0]]);
    // the lever: back one detent at a time, exactly
    for (let i = S.length - 1; i >= 0; i--) {
      w.dispatch({ type: 'undo' });
      t.run(2);
      expect(scheme(w)).toBe(seen[i]);
    }
    expect(view(w).change).toMatchObject({ to: S[0], by: 'restore' });
    w.dispose();
  });

  test('a drag through several detents is one gesture: one transaction, and one pull of the lever undoes it', async () => {
    const { w, t } = await opened('pd-drag');
    const n0 = w.undoStack().length;
    for (const i of [1, 2, 3]) {
      turn(w, at(i));
      t.run(3);
    }
    expect(scheme(w)).toBe(S[3]);
    expect(w.undoStack().length).toBe(n0 + 1);
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(scheme(w)).toBe(S[0]);
    // a turn to where it already is changes nothing and records nothing (but the knob still clicks)
    const n1 = w.undoStack().length;
    turn(w, 0);
    const ev = t.run(1);
    expect(w.undoStack().length).toBe(n1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'handle.worked', id: K }));
    w.dispose();
  });

  test('the bell rings once the wipe has crossed the room, for a turn and for the lever', async () => {
    const { w, t } = await opened('pd-bell');
    press(w, K);
    t.run(PRESS);
    t.run(steps(PAINT_TUNING.wipeSeconds) - 3);
    expect(t.of('paint.wiped')).toHaveLength(0);
    t.run(5);
    expect(t.of('paint.wiped').map((x) => x.e.scheme)).toEqual([S[1]]);
    t.run(HZ);
    expect(t.of('paint.wiped')).toHaveLength(1);
    w.dispatch({ type: 'undo' });
    t.run(steps(PAINT_TUNING.wipeSeconds) + 3);
    expect(t.of('paint.wiped').map((x) => x.e.scheme)).toEqual([S[1], S[0]]);
    w.dispose();
  });

  test('"Reset the workshop": the first scheme, the dial stowed in its shut crate', async () => {
    const { w, t } = await opened('pd-reset');
    press(w, K);
    press(w, K);
    t.run(PRESS);
    putOn(w, t, D, [-0.4, 0, -1.0]);
    t.run(HZ);
    expect(scheme(w)).not.toBe(S[0]);
    w.dispatch({ type: 'reset' });
    t.run(2);
    expect(scheme(w)).toBe(S[0]);
    expect(w.mode(D)).toBe('gone');
    expect(w.part(D)!.location).toMatchObject({ at: 'in', mouth: PAINT.crate });
    expect(w.setting(PAINT.crate, OPEN)).toBe(false);
    expect(view(w).change).toMatchObject({ to: S[0], by: 'restore' });
    w.dispose();
  });

  test('never saved: a visit left in another scheme opens in the first, its crate\'s lid as it was', async () => {
    const { w, t } = await opened('pd-save');
    press(w, K);
    press(w, K);
    t.run(PRESS);
    expect(scheme(w)).toBe(S[2]);
    const snap = w.saved();
    expect(JSON.stringify(snap)).not.toContain(SCHEME_FIELD);
    expect(snap.open).toEqual([PAINT.crate]);
    const saved = parseSaved(JSON.stringify(snap))!;
    w.dispose();
    const w2 = await benchWorld('pd-save-2', { scene: BENCH, saved });
    const t2 = tape(w2);
    t2.run(2);
    expect(scheme(w2)).toBe(S[0]);
    expect(w2.setting(PAINT.crate, OPEN)).toBe(true);
    expect(w2.mode(D)).toBe('machine');
    expect(view(w2).change).toBeNull();
    w2.dispose();
  });

  test('carried, its knob is a misfire and the scheme stays; thrown, it keeps its scheme and turns where it lands', async () => {
    const { w, t } = await opened('pd-carry');
    press(w, K);
    t.run(PRESS);
    const m = w.motion(D)!;
    w.dispatch({ type: 'grab', id: D, grip: m.pose.p });
    t.run(10);
    expect(w.mode(D)).toBe('held');
    expect(view(w).reachable).toBe(false);
    press(w, K);
    const ev = t.run(PRESS);
    expect(ev).toContainEqual({ type: 'misfire', id: K, level: 1 });
    expect(scheme(w)).toBe(S[1]);
    w.dispatch({ type: 'release', velocity: [1.5, 2.5, -1] });
    t.run(4 * HZ);
    expect(scheme(w)).toBe(S[1]);
    if (w.mode(D) === 'free') {
      press(w, K);
      t.run(PRESS);
      expect(scheme(w)).toBe(S[2]);
    }
    w.dispose();
  });

  test('set on the platen and painted by a text, it is painted; its scheme is as it was; it turns there', async () => {
    const { w, t } = await opened('pd-paint');
    press(w, K);
    t.run(PRESS);
    putOn(w, t, D, traySpot(), 120);
    t.run(HZ);
    expect(w.part(D)!.location).toMatchObject({ at: 'in', mouth: 'platen' });
    plug(w, t, 'jack-platen');
    const a = textAndWait(w, t, 'paint it blue');
    expect(a.e.type).toBe('line.reply');
    t.run(2 * HZ);
    expect(w.part(D)!.colour).toBe('paint-blue');
    expect(scheme(w)).toBe(S[1]);
    press(w, K);
    t.run(PRESS);
    expect(scheme(w)).toBe(S[2]);
    w.dispose();
  }, 120_000);

  test('shipped off the belt it is out of reach (a misfire); it comes back up the chute in its scheme, and stows again on its crate', async () => {
    const { w, t } = await opened('pd-ship');
    press(w, K);
    t.run(PRESS);
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(2);
    putOn(w, t, D, onBelt(0.6), 60);
    expect(waitFor(w, t, D, 'shipped', 60 * HZ)).toBe(true);
    expect(w.mode(D)).toBe('gone');
    press(w, K);
    expect(t.run(1)).toContainEqual({ type: 'misfire', id: K, level: 1 });
    let back = false;
    for (let i = 0; i < 20 * HZ && !back; i++) {
      t.run(1);
      back = w.mode(D) === 'free' && w.part(D)!.location.at === 'rest';
    }
    expect(back).toBe(true);
    expect(scheme(w)).toBe(S[1]);
    // set back on its open crate: stowed (in its crate's custody), still in its scheme, and it turns there
    const c = w.motion(PAINT.crate)!.pose.p;
    putOn(w, t, D, [c[0], c[1] + w.halfExtents(PAINT.crate)![1], c[2]]);
    t.run(HZ);
    expect(w.part(D)!.location).toMatchObject({ at: 'in', mouth: PAINT.crate });
    expect(scheme(w)).toBe(S[1]);
    press(w, K);
    t.run(PRESS);
    expect(scheme(w)).toBe(S[2]);
    // shut with it inside: out of reach
    press(w, `${PAINT.crate}-lid`);
    t.run(2);
    expect(w.mode(D)).toBe('gone');
    press(w, K);
    expect(t.run(1)).toContainEqual({ type: 'misfire', id: K, level: 1 });
    expect(scheme(w)).toBe(S[2]);
    w.dispose();
  }, 120_000);

  test('the lever after the dial was carried away: the scheme comes back, whatever has happened to the dial since', async () => {
    const { w, t } = await opened('pd-undo-away');
    press(w, K);
    t.run(PRESS);
    putOn(w, t, D, [-0.4, 0, -1.0]);
    t.run(HZ);
    w.dispatch({ type: 'undo' }); // the move
    t.run(2);
    w.dispatch({ type: 'undo' }); // the turn
    t.run(2);
    expect(scheme(w)).toBe(S[0]);
    w.dispose();
  });

  test('(D2c) a double-tap only looks: its first tap\'s press is withdrawn, the camera asked to its crate\'s card; out on the bench, to the dial', async () => {
    const { w, t } = await opened('pd-select');
    const n0 = w.undoStack().length;
    // the double-tap as the input sends it: the first tap's press, the second tap's press, then the select
    press(w, K);
    t.run(3);
    expect(view(w).pending).toBe(1); // the knob is drawn one on at once
    expect(scheme(w)).toBe(S[0]); // the paint waits
    press(w, K);
    t.run(3);
    expect(view(w).pending).toBe(2);
    w.dispatch({ type: 'select', id: K });
    const ev = t.run(PRESS);
    expect(scheme(w)).toBe(S[0]);
    expect(view(w).pending).toBeNull();
    expect(ev).toContainEqual({ type: 'look', target: `${PAINT.crate}-card` });
    expect(ev.some((e) => e.type === 'paint.turned' || e.type === 'look.back')).toBe(false);
    // nothing recorded: the withdrawn press left no transaction for the lever to find
    expect(w.undoStack().length).toBe(n0);
    // out on the bench: a select on the dial itself looks at the dial
    putOn(w, t, D, [-0.4, 0, -1.0]);
    t.run(HZ);
    w.dispatch({ type: 'select', id: D });
    expect(t.run(1)).toContainEqual({ type: 'look', target: D });
    w.dispose();
  });

  test('(D2c) a turn by hand sends the camera back out (look.back), a press once its window is past and a drag at once; the lever and a reset do not', async () => {
    const { w, t } = await opened('pd-back');
    press(w, K);
    expect(t.run(PRESS).filter((e) => e.type === 'look.back')).toHaveLength(1);
    turn(w, at(3));
    expect(t.run(1).filter((e) => e.type === 'look.back')).toHaveLength(1);
    w.dispatch({ type: 'undo' });
    expect(t.run(3).filter((e) => e.type === 'look.back')).toHaveLength(0);
    w.dispatch({ type: 'reset' });
    expect(t.run(3).filter((e) => e.type === 'look.back')).toHaveLength(0);
    w.dispose();
  });
});
