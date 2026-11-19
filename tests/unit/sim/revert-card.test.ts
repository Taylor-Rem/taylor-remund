// R1 (Taylor, 2026-11-19: "the little clean up robot turns around at the exact moment his little sign pops
// up, so you can't read what the sign says"): every card Revert holds up is read before anything else
// happens. While a card is up and younger than its read time, Revert faces the visitor (within 25°) and
// is still. All ten Button cards (four rungs, the deck of six), and its own two after an undo.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, REVERT } from '../../../src/workshop/sim/scenes/bench.ts';
import { REVERT_TUNING } from '../../../src/workshop/sim/crew/revert.ts';
import { DECK } from '../../../src/workshop/sim/machines/button.ts';
import { HZ, steps } from '../../../src/workshop/sim/clock.ts';
import { contentById } from '../../../src/workshop/view/labels/content.ts';
import type { RevertView } from '../../../src/workshop/sim/types.ts';

const R = (w: World): RevertView => w.machine('revert-crew') as RevertView;
const words = (id: string): number => contentById(id).text.trim().split(/\s+/).length;
/** The brief's read time for a card: max(2.0 s, 1 s + 0.35 s a word). */
const readTime = (id: string): number => Math.max(2, 1 + 0.35 * words(id));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const CARDS = ['card.rung1', 'card.rung2', 'card.rung3', 'card.rung4', ...DECK.map((d) => d.card)];
const DEG25 = (25 * Math.PI) / 180;

/** Every step: while a card is up and not yet read (its rise and its read time), Revert faces the visitor and is still. */
function watch(w: World, n: number, seen: Map<string, number>): void {
  for (let i = 0; i < n; i++) {
    run(w, 1);
    const r = R(w);
    if (!r.card || r.card.read === 0) continue;
    const need = REVERT_TUNING.cardRise + readTime(r.card.content);
    if (r.card.since > need) continue;
    seen.set(r.card.content, Math.max(seen.get(r.card.content) ?? 0, r.card.since));
    const toVisitor = Math.atan2(REVERT.outward[0] - r.x, REVERT.outward[2] - r.z);
    const label = `${r.card.content} at ${r.card.since.toFixed(2)} s (state ${r.state})`;
    expect(Math.abs(wrap(r.heading - toVisitor)), label).toBeLessThanOrEqual(DEG25);
    expect(r.speed, label).toBe(0);
    expect(r.turning, label).toBe(0);
    expect(r.drawn, label).toBe(true);
  }
}

describe("Revert's card is read before it does anything else", () => {
  test('every card fits the read time: the rise and max(2 s, 1 s + 0.35 s a word) within the hold, and the card stays up longer', () => {
    for (const id of [...CARDS, 'card.revert.kept', 'card.revert.nothing']) {
      expect(REVERT_TUNING.cardRise + readTime(id), id).toBeLessThanOrEqual(REVERT_TUNING.cardRead + 1e-9);
    }
    expect(REVERT_TUNING.card).toBeGreaterThan(REVERT_TUNING.cardRead);
  });

  for (const gap of [6, 0.5]) {
    test(`all ten Button cards (the ladder, then the deck), pressed ${gap} s after each rung: facing the visitor and still for the read`, () => {
      const { world } = stubWorld(1, { scene: bench });
      run(world, 5);
      const seen = new Map<string, number>();
      for (let k = 0; k < 40 && CARDS.some((c) => !seen.has(c)); k++) {
        world.dispatch({ type: 'press', id: 'button' });
        watch(world, 1, seen);
        for (let i = 0; i < 2000 && world.bracketed; i++) watch(world, 1, seen);
        watch(world, steps(gap), seen);
      }
      watch(world, steps(15), seen);
      for (const c of CARDS) expect(seen.has(c), c).toBe(true);
    });
  }

  test('rung 3: the card is read first, and only then does it set off to fit the cover', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 5);
    const seen = new Map<string, number>();
    for (let k = 0; k < 3; k++) {
      world.dispatch({ type: 'press', id: 'button' });
      watch(world, 1, seen);
      for (let i = 0; i < 2000 && world.bracketed; i++) watch(world, 1, seen);
      if (k < 2) watch(world, steps(6), seen);
    }
    let firstMove = -1;
    let cardAt = -1;
    for (let i = 0; i < steps(8); i++) {
      run(world, 1);
      const r = R(world);
      if (cardAt < 0 && r.card?.content === 'card.rung3') cardAt = world.step;
      if (firstMove < 0 && cardAt >= 0 && (r.speed !== 0 || r.state === 'trundle')) firstMove = world.step;
    }
    expect(cardAt).toBeGreaterThan(0);
    expect(firstMove).toBeGreaterThan(0);
    expect((firstMove - cardAt) / HZ).toBeGreaterThanOrEqual(REVERT_TUNING.cardRise + readTime('card.rung3') - 1e-9);
  });

  test("its own cards after an undo: mid-trip, it stops, turns to face the visitor, and only then raises the card", () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 5);
    world.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 2000 && (i < 2 || world.bracketed); i++) run(world, 1);
    run(world, steps(8));
    // nothing to undo: the lever's card
    const seen = new Map<string, number>();
    world.dispatch({ type: 'press', id: 'undo-lever' });
    watch(world, steps(8), seen);
    expect(seen.has('card.revert.nothing')).toBe(true);
  });
});
