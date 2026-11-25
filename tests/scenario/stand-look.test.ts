// P4 S6 round four: the camera stays in while a crate lifted off the stand is in the hand, and goes out when it leaves the
// hand, by any end: let go off the stand, thrown, put back where it was taken (a cancelled gesture: a lost pointer,
// Escape, the window losing focus all end as a release or a select), carried into a machine's mouth, the lever pulled while
// it is held, a reset. Let go back onto the deck, it reopens and the page is never told to look back. And the rule on its
// own: no look is still held a second after a crate lifted off the stand has left the hand, unless that crate is open on
// the stand again. (The page's look is followed as the shell follows it: a `look` takes it, a `look.back` for the same
// card lets it go.)
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, BENCH, type Tape } from './line-helpers.ts';
import { OPENING_STAND, withOpeningStand } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const scene = withOpeningStand(BENCH, 'c');
const pl = OPENING_STAND.places.c;
const TOP: Vec3 = [pl.at[0], pl.at[1] + pl.h, pl.at[2]];
const C = 'crate-3', CARD = 'crate-3-card';

/** The page's look, followed from the events. */
class Page {
  look: string | null = null;
  backs = 0;
  hear(ev: readonly SimEvent[]): void {
    for (const e of ev) {
      if (e.type === 'look') this.look = e.target;
      else if (e.type === 'look.back') {
        this.backs++;
        if (this.look === e.target) this.look = null;
      }
    }
  }
}
const onStand = (w: World): boolean => {
  const p = w.motion(C)!.pose.p;
  return Math.abs(p[0] - TOP[0]) < OPENING_STAND.half[0] && Math.abs(p[2] - TOP[2]) < OPENING_STAND.half[1];
};
async function openOnStand(name: string): Promise<{ w: World; t: Tape; page: Page; run: (n: number) => void }> {
  const w = await benchWorld(`look-${name}`, { scene });
  const t = tape(w);
  const page = new Page();
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) page.hear(t.run(1));
  };
  run(30);
  // (the helper's put-on: its events heard too)
  const was = t.run;
  t.run = (n: number) => {
    const ev = was(n);
    page.hear(ev);
    return ev;
  };
  putOn(w, t, C, TOP);
  t.run = was;
  run(150);
  expect(w.setting(C, OPEN)).toBe(true);
  expect(page.look).toBe(CARD);
  return { w, t, page, run };
}
/** Lift it (grab and carry it up a little): the camera stays in. */
function lift(w: World, run: (n: number) => void, page: Page): void {
  w.dispatch({ type: 'grab', id: C, grip: w.motion(C)!.pose.p });
  const p = w.motion(C)!.pose.p;
  for (let i = 0; i < 20; i++) {
    w.dispatch({ type: 'carry', target: [p[0], p[1] + 0.4, p[2]] });
    run(1);
  }
  expect(w.holding()?.id).toBe(C);
  expect(page.look, 'the camera stays in while it is in the hand').toBe(CARD);
}
function carryTo(w: World, run: (n: number) => void, to: Vec3, n = 40): void {
  for (let i = 0; i < n; i++) {
    w.dispatch({ type: 'carry', target: to });
    run(1);
  }
}
/** The rule: a second after it has left the hand, no look is held unless the crate is open on the stand again. */
function rule(w: World, run: (n: number) => void, page: Page): void {
  for (let i = 0; i < 240 && w.holding()?.id === C; i++) run(1);
  run(60);
  const back = w.setting(C, OPEN) === true && onStand(w);
  expect(page.look === CARD ? back : true, `a second after it left the hand: look ${page.look}, open ${String(w.setting(C, OPEN))}, on the stand ${onStand(w)}`).toBe(true);
}

describe('a crate lifted off the stand: the camera stays in while it is in the hand, and goes out when it leaves it', () => {
  test('let go off the stand: the view back at the letting-go', async () => {
    const { w, run, page } = await openOnStand('off');
    lift(w, run, page);
    carryTo(w, run, [TOP[0] - 1.6, 1.2, TOP[2]]);
    expect(page.look).toBe(CARD);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(3);
    expect(page.look).toBeNull();
    rule(w, run, page);
    w.dispose();
  }, 60_000);

  test('thrown: the view back at the release', async () => {
    const { w, run, page } = await openOnStand('thrown');
    lift(w, run, page);
    w.dispatch({ type: 'release', velocity: [-4, 3, 1] });
    run(3);
    expect(page.look).toBeNull();
    rule(w, run, page);
    w.dispose();
  }, 60_000);

  test('the gesture cancelled (a lost pointer, Escape, the window losing focus: a release where it is)', async () => {
    const { w, run, page } = await openOnStand('cancel');
    lift(w, run, page);
    carryTo(w, run, [TOP[0] - 1.2, 1.0, TOP[2] + 0.4], 20);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    rule(w, run, page);
    expect(page.look).toBeNull();
    w.dispose();
  }, 60_000);

  test('put back where it was taken (a select, a pick-up let go at once): open on the stand, the camera never left', async () => {
    const { w, run, page } = await openOnStand('select');
    const backs = page.backs;
    w.dispatch({ type: 'grab', id: C, grip: w.motion(C)!.pose.p });
    run(3);
    w.dispatch({ type: 'select', id: C });
    run(60);
    expect(w.setting(C, OPEN)).toBe(true);
    expect(page.backs, 'never told to look back').toBe(backs);
    expect(page.look).toBe(CARD);
    rule(w, run, page);
    w.dispose();
  }, 60_000);

  test('carried into a machine (the belt): the view back', async () => {
    const { w, run, page } = await openOnStand('belt');
    lift(w, run, page);
    const belt = w.scene.mouths!.find((m) => m.id === 'belt')!;
    carryTo(w, run, [belt.drop[0] + 2, belt.drop[1] + 0.6, belt.drop[2]], 90);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    rule(w, run, page);
    expect(page.look).toBeNull();
    w.dispose();
  }, 60_000);

  test('the lever pulled while it is in the hand', async () => {
    const { w, run, page } = await openOnStand('lever');
    lift(w, run, page);
    carryTo(w, run, [TOP[0] - 1.2, 1.2, TOP[2]], 20);
    w.dispatch({ type: 'press', id: 'undo-lever' });
    run(30);
    if (w.holding()?.id === C) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    rule(w, run, page);
    w.dispose();
  }, 60_000);

  test('a reset while it is in the hand: the view back', async () => {
    const { w, run, page } = await openOnStand('reset');
    lift(w, run, page);
    w.dispatch({ type: 'reset' });
    run(30);
    expect(page.look).toBeNull();
    rule(w, run, page);
    w.dispose();
  }, 60_000);

  test('let go back onto the deck, three times: it reopens and the page is never told to look back', async () => {
    const { w, run, page } = await openOnStand('back');
    const backs = page.backs;
    for (let k = 0; k < 3; k++) {
      lift(w, run, page);
      carryTo(w, run, [TOP[0] + (k - 1) * 0.15, TOP[1] + 0.5, TOP[2] + 0.1]);
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      run(150);
      expect(w.setting(C, OPEN), `put back ${k + 1}`).toBe(true);
      expect(page.look).toBe(CARD);
    }
    expect(page.backs, 'never told to look back').toBe(backs);
    w.dispose();
  }, 60_000);

  test('let go over the deck but it falls off: the view back within a second', async () => {
    const { w, run, page } = await openOnStand('falloff');
    lift(w, run, page);
    carryTo(w, run, [TOP[0] + OPENING_STAND.half[0] - 0.05, TOP[1] + 0.9, TOP[2]]);
    w.dispatch({ type: 'release', velocity: [2.5, 0, 0] });
    rule(w, run, page);
    w.dispose();
  }, 60_000);
});
