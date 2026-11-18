// AU1 brief § 4: every sound, rendered, checked by numbers. Nobody on the team can hear, so these are
// the claims: in tune, under the ceiling, no DC, no click at either end, each as long as designed, each
// as loud as designed and the palette within a stated band.
import { describe, expect, test } from 'vitest';
import { cents, gainToDb } from '../../../src/workshop/audio/dsp.ts';
import { dcOf, edgesOf, fundamentalNear, lengthOf, loudnessOf, peakOf } from '../../../src/workshop/audio/measure.ts';
import { partHz, MATERIALS, SIZES, ROOT_HZ } from '../../../src/workshop/audio/notes.ts';
import { render, renderDef, REF_LOUDNESS } from '../../../src/workshop/audio/render.ts';
import { SOUNDS, BELL_HZ } from '../../../src/workshop/audio/voices.ts';
import { NOTE, OCTAVE } from '../../../src/workshop/sim/index.ts';

const SR = 48000;

/** Foreground: everything a visitor is meant to notice. Within 12 dB of each other (the loudest at most 4× the amplitude of the quietest). */
export const FOREGROUND: readonly [number, number] = [REF_LOUDNESS - 12, REF_LOUDNESS];
/** Background: the loops and the tell. 14 to 26 dB under the reference: a whisper. */
export const BACKGROUND: readonly [number, number] = [REF_LOUDNESS - 26, REF_LOUDNESS - 14];
/** No single voice peaks above this (dBFS): the master's budget (mix.test.ts) is built on it. */
export const VOICE_PEAK_DB = -14;

const background = (id: string): boolean => id.startsWith('loop.') || id === 'tell.tick';

describe('the notes (§ B1: three sizes, three notes, large is low; metal an octave above wood)', () => {
  test('the pitches are the simulation\'s numbers on a C4 root', () => {
    expect(ROOT_HZ).toBeCloseTo(261.6256, 3);
    for (const m of MATERIALS) for (const s of SIZES) expect(partHz(s, m)).toBeCloseTo(ROOT_HZ * Math.pow(2, (NOTE[s] + 12 * OCTAVE[m]) / 12), 6);
  });

  for (const touch of ['note', 'pick', 'hit'] as const) {
    for (const m of MATERIALS) {
      test(`${touch} ${m}: each size's fundamental within 10 cents, and the triad in tune with itself`, () => {
        const f: Record<string, number> = {};
        for (const s of SIZES) {
          const b = render(`${touch}.${m}.${s}`, SR);
          const want = partHz(s, m);
          const got = fundamentalNear(b, SR, want);
          expect(Math.abs(got.cents), `${touch}.${m}.${s}: ${got.f.toFixed(2)} Hz for ${want.toFixed(2)}`).toBeLessThan(10);
          // nothing below it louder (rubber is a thud: its low noise is allowed under the tone)
          if (m !== 'rubber') expect(got.lowest, `${touch}.${m}.${s} has a louder peak below its fundamental (${got.ratioBelow.toFixed(2)})`).toBe(true);
          f[s] = got.f;
        }
        expect(Math.abs(cents(f.M! / f.L!, Math.pow(2, 4 / 12)))).toBeLessThan(10); // a major third
        expect(Math.abs(cents(f.S! / f.L!, Math.pow(2, 7 / 12)))).toBeLessThan(10); // a fifth
        expect(Math.abs(cents(f.S! / f.M!, Math.pow(2, 3 / 12)))).toBeLessThan(10); // a minor third
      });
    }
  }

  test('metal rings an octave above wood; rubber an octave below; paper with wood', () => {
    for (const s of SIZES) {
      const wood = fundamentalNear(render(`note.wood.${s}`, SR), SR, partHz(s, 'wood')).f;
      const metal = fundamentalNear(render(`note.metal.${s}`, SR), SR, partHz(s, 'metal')).f;
      const rubber = fundamentalNear(render(`note.rubber.${s}`, SR), SR, partHz(s, 'rubber')).f;
      const paper = fundamentalNear(render(`note.paper.${s}`, SR), SR, partHz(s, 'paper')).f;
      expect(Math.abs(cents(metal / wood, 2))).toBeLessThan(10);
      expect(Math.abs(cents(wood / rubber, 2))).toBeLessThan(10);
      expect(Math.abs(cents(paper / wood, 1))).toBeLessThan(10);
    }
  });

  test('the bell strikes G5, in the line\'s key', () => {
    const got = fundamentalNear(render('dock.bell', SR), SR, BELL_HZ, 0.3);
    expect(Math.abs(got.cents)).toBeLessThan(10);
    expect(Math.abs(cents(BELL_HZ, ROOT_HZ * 3))).toBeLessThan(5); // the fifth, an octave and a half up
  });
});

describe('every sound', () => {
  for (const sr of [48000, 44100]) {
    for (const d of SOUNDS) {
      test(`${d.id} @ ${sr}`, () => {
        for (let v = 0; v < d.variants; v++) {
          const b = renderDef(d, sr, v);
          const peak = peakOf(b);
          const tag = `${d.id}#${v} @ ${sr}`;
          // under the voice budget, and far under the ceiling
          expect(gainToDb(peak), `${tag} peak`).toBeLessThanOrEqual(VOICE_PEAK_DB);
          // as loud as designed, and inside its band
          const l = loudnessOf(b, sr);
          expect(Math.abs(l - (REF_LOUDNESS + d.level)), `${tag} loudness ${l.toFixed(2)}`).toBeLessThan(0.25);
          const [lo, hi] = background(d.id) ? BACKGROUND : FOREGROUND;
          expect(l, `${tag} band`).toBeGreaterThanOrEqual(lo - 0.25);
          expect(l, `${tag} band`).toBeLessThanOrEqual(hi + 0.25);
          // no DC
          expect(Math.abs(dcOf(b)), `${tag} DC`).toBeLessThan(1e-3 * peak);
          if (d.kind === 'once') {
            // no click at either end: silence at the very first and last sample, and the first quarter
            // millisecond and the last millisecond far below the peak
            const e1 = edgesOf(b, sr, 0.25);
            const e2 = edgesOf(b, sr, 1);
            expect(e1.first, `${tag} first sample`).toBe(0);
            expect(e1.start, `${tag} first 0.25 ms`).toBeLessThan(0.1);
            expect(e2.end, `${tag} last 1 ms`).toBeLessThan(0.01);
            expect(e2.last, `${tag} last sample`).toBeLessThan(1e-6);
            // as long as designed (heard to -60 dB of its peak)
            const len = lengthOf(b, sr);
            const [a, z] = d.param ? [d.param.default * 0.9, d.param.default + 0.3] : d.length;
            expect(len, `${tag} length`).toBeGreaterThanOrEqual(a);
            expect(len, `${tag} length`).toBeLessThanOrEqual(z);
          } else {
            // a loop joins itself: the step across the seam is no bigger than the steps inside it
            let big = 0;
            for (let i = 1; i < b.length; i++) big = Math.max(big, Math.abs(b[i]! - b[i - 1]!));
            expect(Math.abs(b[0]! - b[b.length - 1]!), `${tag} seam`).toBeLessThanOrEqual(big);
            expect(lengthOf(b, sr)).toBeGreaterThanOrEqual(d.length[0]);
          }
          if (d.pitch) {
            const f = fundamentalNear(b, sr, d.pitch, Math.min(0.5, b.length / sr));
            expect(Math.abs(f.cents), `${tag} pitch ${f.f.toFixed(2)} for ${d.pitch}`).toBeLessThan(10);
          }
        }
      });
    }
  }

  test('a parameter sets the length: the tape follows how much was undone', () => {
    for (const s of [0.35, 0.6, 1.0, 1.4, 2.0]) {
      const len = lengthOf(render('tape.rewind', SR, 0, s), SR);
      expect(len).toBeGreaterThan(s * 0.95);
      expect(len).toBeLessThan(s + 0.12);
    }
    const w = lengthOf(render('rung.warning', SR, 0, 2), SR);
    expect(w).toBeGreaterThan(1.8);
    expect(w).toBeLessThan(2.1);
  });

  test('the same id and variant render the same samples (seeded, not rolled)', () => {
    const a = render('handle.dial', SR, 1);
    const b = render('handle.dial', SR, 1);
    const c = render('handle.dial', SR, 2);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
