import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  PROPORTIONS,
  REGISTERS,
  capPx,
  labelKey,
  layoutLine,
  minCapHeight,
  planPaper,
  planPhone,
  planPlate,
  planSign,
  planStencil,
  planTape,
  textureBytes,
  wrap,
} from '../../../src/workshop/view/labels/layout.ts';
import type { Advance } from '../../../src/workshop/view/labels/layout.ts';
import { rng } from '../../../src/workshop/view/labels/rng.ts';

// A stand-in for canvas measurement: every glyph 0.8 cap wide, kerning "TA" by -0.1.
const adv: Advance = (ch, next) => (ch === ' ' ? 0.35 : 0.8) + (ch === 'T' && next === 'A' ? -0.1 : 0);

describe('the 12 px rule', () => {
  it('projects a front-facing capital by cos(pitch) and an upward-facing one by sin(pitch)', () => {
    expect(capPx(1, 'front', { pxPerUnit: 100, pitchDeg: 60 })).toBeCloseTo(50, 6);
    expect(capPx(1, 'up', { pxPerUnit: 100, pitchDeg: 30 })).toBeCloseTo(50, 6);
  });

  it('minCapHeight is the inverse of capPx, with the margin', () => {
    const h = minCapHeight('front', 1.1);
    expect(capPx(h, 'front')).toBeCloseTo(DEFAULT_VIEW.minCapPx * 1.1, 6);
  });

  it('every ruled register meets 12 px at the worst default view; sign, tape and plates with 10% to spare', () => {
    for (const [name, spec] of Object.entries(REGISTERS)) {
      if (!spec.ruled) continue;
      const px = capPx(spec.capHeight, 'front');
      expect(px, name).toBeGreaterThanOrEqual(DEFAULT_VIEW.minCapPx * (name === 'card' || name === 'slip' ? 1 : 1.1));
    }
  });

  it('a default tape, plate and sign plan carry capitals that meet the rule', () => {
    for (const plan of [planTape('DO NOT TOUCH', adv, rng(1)), planPlate('PRESSES', adv, rng(1)), planSign('TAYLOR', adv, rng(1))]) {
      expect(capPx(plan.capWorld, 'front')).toBeGreaterThanOrEqual(12);
      // and the texture really holds a capital that tall: world size and texel size agree
      expect(plan.world.h / plan.capWorld).toBeCloseTo(plan.px.h / plan.capTexels, 6);
    }
  });

  it('at the closest zoom (6x) the ruled registers have about a texel per screen pixel or better', () => {
    const closePxPerUnit = DEFAULT_VIEW.pxPerUnit * 6;
    for (const r of ['tape', 'plate'] as const) expect(REGISTERS[r].texelsPerUnit).toBeGreaterThanOrEqual(closePxPerUnit * 0.95);
    // the sign's capitals are 0.9 units: 200 texels a capital is plenty even magnified
    expect(REGISTERS.sign.capHeight * REGISTERS.sign.texelsPerUnit).toBeGreaterThanOrEqual(190);
  });
});

describe('layoutLine', () => {
  it('without jitter, places glyphs at their advances and skips spaces', () => {
    const l = layoutLine('TA B', adv, { tracking: 0.1, x: 0, y: 0, rot: 0, scale: 0 }, rng(3));
    expect(l.glyphs.map((g) => g.ch)).toEqual(['T', 'A', 'B']);
    expect(l.glyphs[0]!.x).toBe(0);
    expect(l.glyphs[1]!.x).toBeCloseTo(0.7 + 0.1, 9); // kerned TA, plus tracking
    expect(l.width).toBeCloseTo(0.7 + 0.1 + 0.8 + 0.1 + 0.35 + 0.1 + 0.8, 9);
  });

  it('jitter is seeded: the same seed gives the same line, another seed a different one', () => {
    const j = { tracking: 0.1, x: 0.05, y: 0.05, rot: 0.02, scale: 0.02 };
    const a = layoutLine('DO NOT TOUCH', adv, j, rng('k'));
    const b = layoutLine('DO NOT TOUCH', adv, j, rng('k'));
    const c = layoutLine('DO NOT TOUCH', adv, j, rng('other'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('jitter stays inside its bounds', () => {
    const j = { tracking: 0, x: 0.05, y: 0.04, rot: 0.02, scale: 0.03 };
    const l = layoutLine('ABCDEFGHIJKLMNOPQRSTUVWXYZ', adv, j, rng(9));
    for (const g of l.glyphs) {
      expect(Math.abs(g.y)).toBeLessThanOrEqual(0.04);
      expect(Math.abs(g.rot)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(g.scale - 1)).toBeLessThanOrEqual(0.03);
    }
  });
});

describe('wrap', () => {
  it('wraps greedily by characters', () => {
    expect(wrap('WELL, THAT WAS UNNECESSARY.', 15)).toEqual(['WELL, THAT WAS', 'UNNECESSARY.']);
    expect(wrap('OUT OF MY LANE.', 10)).toEqual(['OUT OF MY', 'LANE.']);
  });
  it('puts an over-long word on its own line', () => {
    expect(wrap('A SUPERCALIFRAGILISTIC B', 6)).toEqual(['A', 'SUPERCALIFRAGILISTIC', 'B']);
  });
});

describe('plans', () => {
  it('are deterministic for a seed', () => {
    expect(planTape('PLATEN', adv, rng('x'))).toEqual(planTape('PLATEN', adv, rng('x')));
    expect(planPaper('card', 'WELL, THAT WAS UNNECESSARY.', adv, rng('x'))).toEqual(planPaper('card', 'WELL, THAT WAS UNNECESSARY.', adv, rng('x')));
  });

  it('size a tape to its text: height from the cap, length from the letters', () => {
    const short = planTape('VUE', adv, rng(1));
    const long = planTape('STOREFRONT', adv, rng(1));
    expect(short.world.h).toBeCloseTo(long.world.h, 2);
    expect(long.world.w).toBeGreaterThan(short.world.w * 2);
    expect(short.world.h / short.capWorld).toBeCloseTo(PROPORTIONS.tape.heightPerCap, 1);
    // the glyphs fit inside the tape
    for (const p of [short, long]) {
      const line = p.lines[0]!;
      expect(line.left).toBeGreaterThan(0);
      expect(line.left + line.width).toBeLessThan(p.px.w);
      expect(line.baseline).toBeLessThan(p.px.h);
      expect(line.baseline - p.capTexels).toBeGreaterThan(0);
    }
  });

  it('honour a cap height override, keeping texel density', () => {
    const a = planTape('LARAVEL', adv, rng(1));
    const b = planTape('LARAVEL', adv, rng(1), { capHeight: 0.13 });
    expect(b.capWorld).toBe(0.13);
    expect(b.world.w / a.world.w).toBeCloseTo(0.5, 1);
    expect(b.px.w / a.px.w).toBeCloseTo(0.5, 1);
  });

  it('a cue card wraps at 12 characters, meets the rule, and keeps its lines inside the card', () => {
    const p = planPaper('card', 'WELL, THAT WAS UNNECESSARY.', adv, rng(2));
    expect(p.lines.map((l) => l.glyphs.length)).toEqual([9, 3, 12]); // WELL, THAT / WAS / UNNECESSARY. (spaces not placed)
    expect(capPx(p.capWorld, 'front')).toBeGreaterThanOrEqual(12);
    expect(p.world.h / p.world.w).toBeGreaterThanOrEqual(0.42);
    for (const l of p.lines) {
      expect(l.left + l.width).toBeLessThanOrEqual(p.px.w);
      expect(l.baseline).toBeLessThan(p.px.h);
    }
  });

  it('with the narrow print face (0.68 cap per character) the cue card is at most 2.2 wide and the slip two lines', () => {
    const print: Advance = () => 0.68;
    const card = planPaper('card', 'WELL, THAT WAS UNNECESSARY.', print, rng(2));
    expect(card.lines).toHaveLength(3);
    expect(card.world.w).toBeLessThanOrEqual(2.2);
    const slip = planPaper('slip', 'OUT OF MY LANE.', print, rng(2));
    expect(slip.lines).toHaveLength(2);
    expect(capPx(slip.capWorld, 'front')).toBeGreaterThanOrEqual(12);
    expect(slip.world.w).toBeLessThan(card.world.w);
  });

  it('a slip is narrower than a card for the same words', () => {
    const card = planPaper('card', 'OUT OF MY LANE.', adv, rng(2));
    const slip = planPaper('slip', 'OUT OF MY LANE.', adv, rng(2));
    expect(slip.world.w).toBeLessThan(card.world.w);
  });

  it('stencil and sign plans are wider than their text', () => {
    const s = planStencil('M', adv, rng(1));
    expect(s.px.w).toBeGreaterThan(s.lines[0]!.width);
    const g = planSign('TAYLOR', adv, rng(1));
    expect(g.world.h).toBeCloseTo(g.capWorld * PROPORTIONS.sign.heightPerCap, 2);
  });

  it('a phone screen is the size asked for', () => {
    const p = planPhone({ screen: { w: 0.3, h: 0.55 } });
    expect(p.world.w).toBeCloseTo(0.3, 2);
    expect(p.world.h).toBeCloseTo(0.55, 2);
  });
});

describe('keys and memory', () => {
  it('keys differ by register, variant, options and text', () => {
    const keys = new Set([
      labelKey('tape', 'VUE', 'red'),
      labelKey('tape', 'VUE', 'blue'),
      labelKey('tape', 'VUE', 'red', { capHeight: 0.1 }),
      labelKey('plate', 'VUE'),
      labelKey('tape', 'PHP', 'red'),
    ]);
    expect(keys.size).toBe(5);
  });

  it('textureBytes counts the full mip chain (about 4/3 of the base level)', () => {
    expect(textureBytes(1, 1)).toBe(4);
    expect(textureBytes(4, 4)).toBe((16 + 4 + 1) * 4);
    expect(textureBytes(1024, 256) / (1024 * 256 * 4)).toBeCloseTo(4 / 3, 2);
    expect(textureBytes(64, 64, false)).toBe(64 * 64 * 4);
  });
});
