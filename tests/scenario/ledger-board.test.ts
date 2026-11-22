// P4 D1: the ledger board in the Ledger Management System's crate. Out of its crate it deals itself and one payment
// bounces; one press of the plunger re-deals month by month, the bounced payment in the side cup, every later payment
// one cup earlier, the last cup empty. Each control is one effect under its press, undone exactly by the lever; the
// board is a loose part like any other (grabbed, thrown, shipped, its crate shut while it is out, reset) and never
// loses a token.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, waitFor, onBelt, BENCH, type Tape } from './line-helpers.ts';
import { plug, textAndWait, traySpot } from './patchlamp-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LEDGER } from '../../src/workshop/sim/scenes/bench.ts';
import { TOKENS_FIELD } from '../../src/workshop/sim/machines/ledger.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import { balanced, dealt, fresh, placeOf, repaired, rubberOf, validTokens, type Tokens } from '../../src/workshop/sim/machines/shared/ledger-board.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { LedgerView } from '../../src/workshop/sim/types.ts';

const B = LEDGER.board;
const tokens = (w: World): Tokens => w.setting(B, TOKENS_FIELD) as Tokens;
const view = (w: World): LedgerView => w.machine(LEDGER.unit) as LedgerView;
const press = (w: World, id: string): void => w.dispatch({ type: 'press', id });
const SHOW = steps(4);

/** The bench with the ledger's crate free (the crate on top of it set down beside the stack) and opened. */
async function opened(seed: string): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: BENCH });
  const t = tape(w);
  t.run(30);
  putOn(w, t, 'crate-2', [-1.4, 0, 0.9]);
  t.run(HZ);
  press(w, `${LEDGER.crate}-lid`);
  t.run(2);
  return { w, t };
}

describe('the ledger board', () => {
  test('stowed in its crate, tokens in the hopper; out of it, it deals itself and one payment bounces: the star is lit', async () => {
    const w = await benchWorld('lb-start', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    expect(w.mode(B)).toBe('gone');
    expect(tokens(w)).toEqual(fresh(2));
    expect(w.interactable(LEDGER.crank)?.affordances).toContain('press');
    expect(w.interactable(LEDGER.plunger)?.affordances).toContain('press');
    // shut, its controls do nothing
    press(w, LEDGER.plunger);
    press(w, LEDGER.crank);
    t.run(1);
    expect(tokens(w)).toEqual(fresh(2));
    w.dispose();
    const { w: w2, t: t2 } = await opened('lb-open');
    expect(w2.mode(B)).toBe('machine');
    expect(tokens(w2)).toEqual(dealt(2));
    expect(view(w2).wrong).toBe(true);
    expect(view(w2).show?.kind).toBe('deal');
    // the deal is charged to the opening: one pull shuts the crate and puts the tokens back in the hopper
    const top = w2.undoStack().at(-1)!;
    expect(top.entries.map((e) => `${e.target}.${e.field}`).sort()).toEqual([`${LEDGER.crate}.${OPEN}`, `${B}.${TOKENS_FIELD}`].sort());
    t2.run(SHOW);
    expect(view(w2).show).toBeNull();
    w2.dispatch({ type: 'undo' });
    t2.run(2);
    expect(w2.setting(LEDGER.crate, OPEN)).toBe(false);
    expect(tokens(w2)).toEqual(fresh(2));
    expect(w2.mode(B)).toBe('gone');
    w2.dispose();
  });

  test('one press of the plunger: the bounced payment in the side cup, every later one a cup earlier, the last cup empty; the lever takes it back exactly', async () => {
    const { w, t } = await opened('lb-repair');
    t.run(SHOW);
    const before = tokens(w);
    press(w, LEDGER.plunger);
    const ev = t.run(1);
    expect(tokens(w)).toEqual(repaired(2));
    expect(ev.filter((e) => e.type === 'effect' && e.effect.target === B)).toHaveLength(1);
    expect(balanced(tokens(w))).toBe(true);
    expect(view(w).show?.kind).toBe('repair');
    t.run(SHOW);
    // the beats: month one wiped and dealt again before month two, the gate on the rubber one
    const beats = t.of('ledger.beat').filter((x) => x.e.show === 'repair').map((x) => x.e);
    const firstWipe2 = beats.findIndex((b) => b.beat === 'wipe' && b.month === 1);
    const lastDrop1 = beats.map((b, i) => (b.beat === 'drop' && b.month === 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastDrop1).toBeLessThan(firstWipe2);
    expect(beats.filter((b) => b.beat === 'gate').map((b) => b.token)).toEqual([2]);
    expect(beats.find((b) => b.beat === 'drop' && b.token === 4)?.to).toBe('c3');
    // a second press: nothing to repair
    press(w, LEDGER.plunger);
    const ev2 = t.run(1);
    expect(ev2.some((e) => e.type === 'ledger.refused')).toBe(true);
    expect(tokens(w)).toEqual(repaired(2));
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(tokens(w)).toEqual(before);
    expect(view(w).show?.kind).toBe('rewind');
    w.dispose();
  });

  test('the crank deals a new month, the rubber payment somewhere else; its undo restores exactly', async () => {
    const { w, t } = await opened('lb-crank');
    t.run(SHOW);
    press(w, LEDGER.plunger);
    t.run(SHOW);
    const seen = new Set<number>([2]);
    let last = 2;
    for (let i = 0; i < 6; i++) {
      const before = tokens(w);
      press(w, LEDGER.crank);
      t.run(1);
      const r = rubberOf(tokens(w));
      expect(r).not.toBe(last);
      expect(tokens(w)).toEqual(dealt(r));
      seen.add(r);
      last = r;
      t.run(SHOW);
      w.dispatch({ type: 'undo' });
      t.run(2);
      expect(tokens(w)).toEqual(before);
      press(w, LEDGER.crank);
      t.run(SHOW);
      last = rubberOf(tokens(w));
      seen.add(last);
    }
    expect(seen.size).toBeGreaterThan(2);
    w.dispose();
  });

  test('a press while the show plays waits its turn; the lever cancels it', async () => {
    const { w, t } = await opened('lb-wait');
    // the deal is still playing: the plunger waits
    press(w, LEDGER.plunger);
    t.run(1);
    expect(view(w).waiting).toBe('repair');
    expect(tokens(w)).toEqual(dealt(2));
    t.run(SHOW);
    expect(tokens(w)).toEqual(repaired(2));
    // the crank pressed during the repair waits, and the lever cancels it before it happens
    press(w, LEDGER.crank);
    t.run(1);
    expect(view(w).waiting).toBe('deal');
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(view(w).waiting).toBeNull();
    t.run(SHOW);
    expect(tokens(w)).toEqual(repaired(2));
    w.dispose();
  });

  test('picked up mid-show it is drawn as its state at once; carried, thrown, its crate shut behind it: nothing is lost, the star stays true', async () => {
    const { w, t } = await opened('lb-grab');
    press(w, LEDGER.plunger); // waits for the deal
    t.run(10);
    putOn(w, t, B, [-0.4, 0, -1.0]);
    t.run(HZ);
    expect(w.part(B)!.location.at).toBe('rest');
    expect(view(w).show === null || view(w).show!.kind !== 'deal').toBe(true);
    expect(tokens(w)).toEqual(repaired(2));
    press(w, `${LEDGER.crate}-lid`);
    t.run(2);
    expect(w.setting(LEDGER.crate, OPEN)).toBe(false);
    expect(w.mode(B)).toBe('free');
    press(w, LEDGER.crank);
    t.run(1);
    expect(view(w).wrong).toBe(true);
    // thrown
    const m = w.motion(B)!;
    w.dispatch({ type: 'grab', id: B, grip: m.pose.p });
    t.run(10);
    w.dispatch({ type: 'release', velocity: [2.5, 3, -1] });
    t.run(4 * HZ);
    expect(validTokens(tokens(w))).toBe(true);
    expect(view(w).wrong).toBe(!balanced(tokens(w)));
    w.dispose();
  });

  test('"Reset the workshop": stowed in its crate, the tokens in the hopper as a new visit has them', async () => {
    const { w, t } = await opened('lb-reset');
    t.run(SHOW);
    putOn(w, t, B, [-0.4, 0, -1.0]);
    t.run(HZ);
    press(w, LEDGER.plunger);
    t.run(5);
    w.dispatch({ type: 'reset' });
    t.run(2);
    expect(w.mode(B)).toBe('gone');
    expect(w.part(B)!.location).toMatchObject({ at: 'in', mouth: LEDGER.crate });
    expect(tokens(w)).toEqual(fresh(2));
    expect(placeOf(tokens(w)[2]!)).toBe('h');
    w.dispose();
  });

  test('set on the platen and painted by a text, it is painted; its tokens and its star are as they were; it works there', async () => {
    const { w, t } = await opened('lb-paint');
    t.run(SHOW);
    putOn(w, t, B, traySpot(), 120);
    t.run(HZ);
    expect(w.part(B)!.location).toMatchObject({ at: 'in', mouth: 'platen' });
    plug(w, t, 'jack-platen');
    const a = textAndWait(w, t, 'paint it blue');
    expect(a.e.type).toBe('line.reply');
    t.run(2 * HZ);
    expect(w.part(B)!.colour).toBe('paint-blue');
    expect(tokens(w)).toEqual(dealt(2));
    expect(view(w).wrong).toBe(true);
    press(w, LEDGER.plunger);
    t.run(1);
    expect(tokens(w)).toEqual(repaired(2));
    w.dispose();
  }, 120_000);

  test('shipped off the belt, it comes back up the chute with its tokens as they were', async () => {
    const { w, t } = await opened('lb-ship');
    t.run(SHOW);
    const was = tokens(w);
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(2);
    putOn(w, t, B, onBelt(0.6), 60);
    expect(waitFor(w, t, B, 'shipped', 60 * HZ)).toBe(true);
    expect(w.mode(B)).toBe('gone');
    let back = false;
    for (let i = 0; i < 20 * HZ && !back; i++) {
      t.run(1);
      back = w.mode(B) === 'free' && w.part(B)!.location.at === 'rest';
    }
    expect(back).toBe(true);
    expect(tokens(w)).toEqual(was);
    press(w, LEDGER.plunger);
    t.run(1);
    expect(tokens(w)).toEqual(repaired(2));
    w.dispose();
  }, 120_000);
});
