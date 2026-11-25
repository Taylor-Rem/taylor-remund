// P4 D1: the ledger board in the Ledger Management System's crate. Out of its crate it deals itself and one payment
// bounces; one press of the plunger re-deals month by month, the bounced payment in the side cup, every later payment
// one cup earlier, the last cup empty. Each control is one effect under its press, undone exactly by the lever; the
// board is a loose part like any other (grabbed, thrown, shipped, its crate shut while it is out, reset) and never
// loses a token.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, waitFor, onBelt, openOnStand, BENCH, LOOSE_BENCH, LOOSE_FULL_BENCH, type Tape } from './line-helpers.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
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

/** A clear spot on the open bench (front left), away from the opening stand. */
const ASIDE: [number, number, number] = [-5.6, 0, 1.6];
/**
 * The bench with the ledger's crate free (the crate on top of it set down clear of the stand) and opened: (I2) set down
 * on the opening stand, the one way a crate opens (it was its latch). `LOOSE_BENCH` for the tests of the board's life
 * as a loose part: on the shipped bench (`things: 'fixed'`) it never leaves its tray.
 */
async function opened(seed: string, scene: SceneDesc = BENCH): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene });
  const t = tape(w);
  t.run(30);
  putOn(w, t, 'crate-2', ASIDE);
  t.run(HZ);
  openOnStand(w, t, LEDGER.crate);
  t.run(2);
  return { w, t };
}
/** (I2) Shut the ledger's crate the way the stand has: lift it off and set it down clear of the stand (it was its latch). */
function shutOff(w: World, t: Tape): void {
  putOn(w, t, LEDGER.crate, [-4.4, 0, 1.6]);
  t.run(HZ);
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
    // (I2: the opening is the placing's on the stand, so the same pull also puts the crate back where it was carried from)
    expect(top.entries.map((e) => `${e.target}.${e.field}`).sort()).toEqual([`${LEDGER.crate}.location`, `${LEDGER.crate}.${OPEN}`, `${B}.${TOKENS_FIELD}`].sort());
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
    const { w, t } = await opened('lb-grab', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
    press(w, LEDGER.plunger); // waits for the deal
    t.run(10);
    putOn(w, t, B, [-0.4, 0, -1.0]);
    t.run(HZ);
    expect(w.part(B)!.location.at).toBe('rest');
    expect(view(w).show === null || view(w).show!.kind !== 'deal').toBe(true);
    expect(tokens(w)).toEqual(repaired(2));
    shutOff(w, t); // (I2: lifted off the stand, it shuts: the latch no longer does)
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
    const { w, t } = await opened('lb-reset', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
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
    const { w, t } = await opened('lb-paint', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
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
    const { w, t } = await opened('lb-ship', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
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

describe('"Reset the workshop" while the board is on its way back from the dock', () => {
  // (D1 part five) wherever it is on the way (behind the door, in the chute, in the air onto the pad, landed and not yet
  // at rest), a reset stows it in its crate, as from anywhere else
  // (I2) the board out of its crate and on its way: the stand's loose-things bench (on the shipped one it never leaves its tray)
  for (const [bench, scene] of [['quiet bench', LOOSE_BENCH], ['whole bench', LOOSE_FULL_BENCH]] as const) for (const phase of ['belt', 'dock', 'gone', 'chute', 'machine', 'free', 'edge'] as const) {
    test(`${bench}: a reset with the board ${phase === 'edge' ? 'fallen off the bench, in the chute' : phase === 'belt' ? 'riding the belt' : phase === 'dock' ? 'rolling to the dock door' : phase === 'gone' ? 'shipped, its return not yet due' : phase === 'chute' ? 'in the chute' : phase === 'machine' ? 'in the air onto the pad' : 'just landed'}: stowed in its crate, in the hopper`, async () => {
      const { w, t } = await opened(`lb-reset-${phase}`, scene);
      t.run(SHOW);
      w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
      t.run(2);
      if (phase === 'edge') {
        const m0 = w.motion(B)!;
        w.dispatch({ type: 'grab', id: B, grip: m0.pose.p });
        t.run(5);
        for (let k = 1; k <= 20; k++) {
          w.dispatch({ type: 'carry', target: [m0.pose.p[0] + 0.5 * k, 1.5, m0.pose.p[2] + 0.3 * k] });
          t.run(1);
        }
        w.dispatch({ type: 'release', velocity: [12, 3, 6] });
      } else putOn(w, t, B, onBelt(0.6), 60);
      const inMouth = (m: string) => { const l = w.part(B)!.location; return l.at === 'in' && l.mouth === m; };
      if (phase !== 'belt' && phase !== 'dock' && phase !== 'edge') expect(waitFor(w, t, B, 'shipped', 60 * HZ)).toBe(true);
      let seen = false;
      for (let i = 0; i < 20 * HZ && !seen; i++) {
        t.run(1);
        const m = w.mode(B);
        seen = phase === 'edge' ? m === 'chute' : phase === 'belt' ? inMouth('belt') && m === 'machine' : phase === 'dock' ? inMouth('dock') && m === 'machine' : phase === 'gone' ? m === 'gone' : phase === 'free' ? m === 'free' && w.part(B)!.location.at === 'shipped' : m === phase;
      }
      expect(seen, `the board seen ${phase} on its way back`).toBe(true);
      w.dispatch({ type: 'reset' });
      t.run(1);
      for (let i = 0; i < 15 * HZ; i++) {
        t.run(1);
        expect(w.mode(B), `step ${i} after the reset`).toBe('gone');
      }
      expect(w.part(B)!.location).toMatchObject({ at: 'in', mouth: LEDGER.crate });
      expect(tokens(w)).toEqual(fresh(2));
      w.dispose();
    }, 120_000);
  }
});

test('"Reset the workshop" with the board thrown off the bench from its tray before it ever rested (its location still in its crate): stowed', async () => {
  // (D1 part five: the case the soak found; nothing in the reset's list names the board, its location never changed)
  const { w, t } = await opened('lb-reset-thrown-from-tray', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
  t.run(SHOW);
  const m0 = w.motion(B)!;
  w.dispatch({ type: 'grab', id: B, grip: m0.pose.p });
  t.run(5);
  for (let k = 1; k <= 20; k++) {
    w.dispatch({ type: 'carry', target: [m0.pose.p[0] + 0.5 * k, 1.8, m0.pose.p[2] + 0.3 * k] });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: [12, 3, 6] });
  let chute = false;
  for (let i = 0; i < 10 * HZ && !chute; i++) {
    t.run(1);
    chute = w.mode(B) === 'chute';
  }
  expect(chute).toBe(true);
  expect(w.part(B)!.location).toMatchObject({ at: 'in', mouth: LEDGER.crate });
  // its crate shut meanwhile: the reset then changes nothing of the crate's either
  shutOff(w, t); // (I2: lifted off the stand, it shuts: the latch no longer does)
  expect(w.setting(LEDGER.crate, OPEN)).toBe(false);
  w.dispatch({ type: 'reset' });
  for (let i = 0; i < 15 * HZ; i++) {
    t.run(1);
    expect(w.mode(B), `step ${i} after the reset`).toBe('gone');
  }
  w.dispose();
}, 120_000);

test('"Reset the workshop" with the board in its shut crate and nothing of it changed: it stays in its crate (it fell out through the chute)', async () => {
  // (D1 part five: what the soak found. The world puts every loose part back where its location says; a crate's thing
  // `in` its crate is not in any mouth the world knows, so its body was released where it waited, under the bench: it
  // fell, came up the chute and lay on the bench, its location still saying it was in its crate. Nothing in the reset's
  // list named it, so its crate never stowed it again.)
  const w = await benchWorld('lb-reset-untouched', { scene: BENCH });
  const t = tape(w);
  t.run(30);
  w.dispatch({ type: 'reset' });
  for (let i = 0; i < 15 * HZ; i++) {
    t.run(1);
    expect(w.mode(B), `step ${i} after the reset`).toBe('gone');
  }
  expect(w.part(B)!.location).toMatchObject({ at: 'in', mouth: LEDGER.crate });
  w.dispose();
}, 120_000);

describe('the board asks to be looked at', () => {
  const looks = (t: Tape) => t.of('look').map((x) => x.e.target);
  test('a select on its tray asks for its crate\'s card; out on the bench for its own box; never in a hand or stowed', async () => {
    const { w, t } = await opened('lb-look', LOOSE_BENCH); // (I2) the board taken off its tray: the loose-things stand
    // the crate's opening asked for its card; the board's deal asked for the same
    expect(looks(t)).toContain(`${LEDGER.crate}-card`);
    t.run(SHOW);
    const n = looks(t).length;
    w.dispatch({ type: 'select', id: LEDGER.crank });
    t.run(1);
    expect(looks(t).slice(n)).toEqual([`${LEDGER.crate}-card`]);
    putOn(w, t, B, [-0.4, 0, -1.0]);
    t.run(HZ);
    w.dispatch({ type: 'select', id: B });
    t.run(1);
    expect(looks(t).at(-1)).toBe(LEDGER.look);
    // a deal and a repair each ask once as they begin
    const m = looks(t).length;
    press(w, LEDGER.crank);
    t.run(SHOW);
    press(w, LEDGER.plunger);
    t.run(SHOW);
    expect(looks(t).slice(m)).toEqual([LEDGER.look, LEDGER.look]);
    // in a hand: no look
    const p = w.motion(B)!.pose.p;
    w.dispatch({ type: 'grab', id: B, grip: p });
    t.run(3);
    const k = looks(t).length;
    w.dispatch({ type: 'select', id: LEDGER.plunger });
    t.run(1);
    expect(looks(t).length).toBe(k);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(HZ);
    // stowed: no look
    w.dispatch({ type: 'reset' });
    t.run(2);
    const j = looks(t).length;
    w.dispatch({ type: 'select', id: B });
    t.run(1);
    expect(looks(t).length).toBe(j);
    w.dispose();
  });

  test('(I2) on the shipped bench (its thing fixed on the tray): a select on its tray asks for its crate\'s card', async () => {
    const { w, t } = await opened('lb-look-fixed');
    expect(looks(t)).toContain(`${LEDGER.crate}-card`);
    t.run(SHOW);
    const n = looks(t).length;
    w.dispatch({ type: 'select', id: LEDGER.crank });
    t.run(1);
    expect(looks(t).slice(n)).toEqual([`${LEDGER.crate}-card`]);
    w.dispose();
  });

  test('a double-tap on the crank deals once and asks for the camera: its second press is half of the double-tap', async () => {
    const { w, t } = await opened('lb-double');
    t.run(SHOW);
    press(w, LEDGER.plunger);
    t.run(SHOW);
    const deals = () => t.of('ledger.dealt').length;
    const d0 = deals();
    // the input's double-tap: press, press (a moment later), then select (in the same frame as the second press)
    press(w, LEDGER.crank);
    t.run(12);
    press(w, LEDGER.crank);
    w.dispatch({ type: 'select', id: LEDGER.crank });
    t.run(SHOW + 60);
    expect(deals() - d0).toBe(1);
    expect((w.machine(LEDGER.unit) as LedgerView).waiting).toBeNull();
    // the same two presses with no select: two deals (the second waits its turn, a moment late)
    const d1 = deals();
    press(w, LEDGER.crank);
    t.run(12);
    press(w, LEDGER.crank);
    t.run(2 * SHOW);
    expect(deals() - d1).toBe(2);
    w.dispose();
  });
});
