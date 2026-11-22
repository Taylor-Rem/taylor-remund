// P4 D1: the ledger board's arithmetic (sim/machines/shared/ledger-board.ts), alone. The owner's condition: the machine
// visibly handles the bounced payment correctly and rebuilds the allocations; it never makes the problem disappear.
import { describe, expect, test } from 'vitest';
import {
  BOUNCE_RANGE, CUPS, MONTH, TOKENS, balanced, cupIndex, dealScript, dealt, fresh, needsRepair, nextBounce, placeOf, repairScript, repaired, rewindScript, rubberOf, starAt, tokensAt, validTokens,
} from '../../../src/workshop/sim/machines/shared/ledger-board.ts';
import { rng } from '../../../src/workshop/sim/rng.ts';

const positions = Array.from({ length: BOUNCE_RANGE.to - BOUNCE_RANGE.from + 1 }, (_, i) => BOUNCE_RANGE.from + i);

describe('the ledger board, as arithmetic', () => {
  test('a fresh board is balanced; dealt, one payment bounced, it is not; repaired it is', () => {
    for (const r of positions) {
      expect(validTokens(fresh(r))).toBe(true);
      expect(balanced(fresh(r))).toBe(true);
      expect(validTokens(dealt(r))).toBe(true);
      expect(needsRepair(dealt(r))).toBe(true);
      expect(validTokens(repaired(r))).toBe(true);
      expect(balanced(repaired(r))).toBe(true);
    }
  });

  test('the bounce is never the last payment: its gap always has payments standing past it', () => {
    for (const r of positions) {
      const d = dealt(r);
      const filled = d.map((s) => cupIndex(placeOf(s))).filter((c): c is number => c !== null);
      expect(filled.some((c) => c > r)).toBe(true);
      expect(filled).not.toContain(r);
    }
  });

  test('repaired: the cups hold the payments that counted, oldest charge first, the last cup empty, the bounced one in the side cup', () => {
    for (const r of positions) {
      const t = repaired(r);
      expect(placeOf(t[r]!)).toBe('s');
      expect(rubberOf(t)).toBe(r);
      const cups = t.map((s, i) => [i, cupIndex(placeOf(s))] as const).filter(([i]) => i !== r);
      // in deal order, from the first cup with no gap
      expect(cups.map(([, c]) => c)).toEqual(Array.from({ length: TOKENS - 1 }, (_, k) => k));
      // the last cup empty: one charge honestly unpaid, at the end
      expect(t.some((s) => placeOf(s) === `c${CUPS - 1}`)).toBe(false);
      // every payment after the bounced one is one cup earlier than it was dealt
      const d = dealt(r);
      for (let i = r + 1; i < TOKENS; i++) expect(cupIndex(placeOf(t[i]!))).toBe(cupIndex(placeOf(d[i]!))! - 1);
      // and nothing disappeared: eight payments, every one somewhere
      expect(t).toHaveLength(TOKENS);
    }
  });

  test('a value is refused unless it is eight places, one rubber, no two in a cup, the rubber never resting in a cup', () => {
    expect(validTokens(['h'])).toBe(false);
    expect(validTokens(fresh(2).map((s) => s.replace('r', '')))).toBe(false);
    expect(validTokens(['c0', 'c0', 'rg', 'c3', 'c4', 'c5', 'c6', 'c7'])).toBe(false);
    expect(validTokens(['c0', 'c1', 'rc2', 'c3', 'c4', 'c5', 'c6', 'c7'])).toBe(false);
    expect(validTokens(['c0', 'c1', 'rg', 'c3', 'c4', 'c5', 'c6', 'x'])).toBe(false);
  });

  test('the next deal puts the rubber payment somewhere other than last time, and reaches every place', () => {
    const r = rng('nb');
    const seen = new Set<number>();
    let last = 2;
    for (let i = 0; i < 400; i++) {
      const n = nextBounce(last, r.next());
      expect(n).not.toBe(last);
      expect(n).toBeGreaterThanOrEqual(BOUNCE_RANGE.from);
      expect(n).toBeLessThanOrEqual(BOUNCE_RANGE.to);
      seen.add(n);
      last = n;
    }
    expect(seen.size).toBe(positions.length);
  });

  test('the repair\'s show: month one wiped and dealt again before month two; the rubber one lands, then the gate; it ends as the state says', () => {
    for (const r of positions) {
      const before = dealt(r), after = repaired(r);
      const s = repairScript(before, after);
      const wipes = s.beats.filter((b) => b.kind === 'wipe');
      const drops = s.beats.filter((b) => b.kind === 'drop');
      const lastDrop0 = Math.max(...drops.filter((b) => b.month === 0).map((b) => b.at));
      const firstWipe1 = Math.min(...wipes.filter((b) => b.month === 1).map((b) => b.at));
      expect(lastDrop0).toBeLessThan(firstWipe1);
      const gate = s.beats.filter((b) => b.kind === 'gate');
      expect(gate.map((b) => b.token)).toEqual([r]);
      const land = drops.find((b) => b.token === r)!;
      expect(gate[0]!.at).toBeCloseTo(land.at + land.dur, 6);
      // month two's first payment goes back across into month one's last cup when the gap is in month one
      if (r < MONTH) expect(drops.find((b) => b.token === MONTH)!.to).toBe(`c${MONTH - 1}`);
      // about two and a half seconds
      expect(s.length).toBeGreaterThan(1.8);
      expect(s.length).toBeLessThan(3.2);
      // at its end it is exactly the state, and the star is dark; before its end, the star is lit
      expect(tokensAt(s, before, after, s.length).map((x) => x.to)).toEqual(after.map(placeOf));
      expect(starAt(s, before, after, s.length)).toBe(false);
      expect(starAt(s, before, after, 0.01)).toBe(true);
      // never two payments resting in one cup at the same moment
      for (let t = 0; t < s.length; t += 1 / 60) {
        const at = tokensAt(s, before, after, t);
        const resting = at.filter((x) => x.kind === null).map((x) => x.to).filter((p) => p.startsWith('c'));
        expect(new Set(resting).size, `t ${t.toFixed(2)}`).toBe(resting.length);
      }
    }
  });

  test('the deal\'s show: gathered, dealt in order oldest charge first, then the bounce and the star', () => {
    const before = repaired(2), after = dealt(5);
    const s = dealScript(before, after);
    const drops = s.beats.filter((b) => b.kind === 'drop');
    expect(drops.map((b) => b.token)).toEqual(Array.from({ length: TOKENS }, (_, i) => i));
    expect(drops.map((b) => b.to)).toEqual(Array.from({ length: TOKENS }, (_, i) => `c${i}`));
    const gathers = s.beats.filter((b) => b.kind === 'gather');
    expect(gathers).toHaveLength(TOKENS);
    expect(Math.max(...gathers.map((b) => b.at + b.dur))).toBeLessThanOrEqual(drops[0]!.at);
    const bounce = s.beats.find((b) => b.kind === 'bounce')!;
    expect(bounce.token).toBe(5);
    expect(bounce.at).toBeGreaterThan(Math.max(...drops.map((b) => b.at + b.dur)));
    // the star dark until the bounce lands (all eight full: nothing looks wrong yet), then lit
    expect(starAt(s, before, after, bounce.at - 0.01)).toBe(false);
    expect(starAt(s, before, after, s.length)).toBe(true);
    expect(tokensAt(s, before, after, s.length).map((x) => x.to)).toEqual(after.map(placeOf));
  });

  test('a rewind takes every moved payment straight back', () => {
    const s = rewindScript(repaired(3), dealt(3));
    expect(s.beats.filter((b) => b.kind === 'rewind').length).toBeGreaterThan(0);
    expect(tokensAt(s, repaired(3), dealt(3), s.length).map((x) => x.to)).toEqual(dealt(3).map(placeOf));
  });
});
