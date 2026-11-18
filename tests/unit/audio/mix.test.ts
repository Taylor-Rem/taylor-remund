// AU1 brief § 3-4: one master with a ceiling; nothing clips with twelve voices at once; the cap drops
// the oldest quietest; a busy scene stays on the straight part of the curve.
import { describe, expect, test } from 'vitest';
import { busy, run } from '../../../src/workshop/audio/audition.ts';
import { CEILING, KNEE, ceilingCurve, ceilingTable, gainToDb } from '../../../src/workshop/audio/dsp.ts';
import { peakOf } from '../../../src/workshop/audio/measure.ts';
import { HEADROOM, MAX_VOICES, victim } from '../../../src/workshop/audio/mixer.ts';
import { render } from '../../../src/workshop/audio/render.ts';
import { SOUNDS } from '../../../src/workshop/audio/voices.ts';
import { SCORE_TUNING } from '../../../src/workshop/audio/score.ts';
import { mixdown, panGains } from './mixdown.ts';

const SR = 48000;

describe('the ceiling', () => {
  test('straight up to the knee, never past the ceiling, monotonic, odd', () => {
    let prev = -Infinity;
    for (let x = -HEADROOM; x <= HEADROOM; x += 0.001) {
      const y = ceilingCurve(x);
      expect(Math.abs(y)).toBeLessThanOrEqual(CEILING + 1e-12);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(ceilingCurve(-x)).toBeCloseTo(-y, 12);
      if (Math.abs(x) <= KNEE) expect(y).toBe(x);
      prev = y;
    }
    expect(gainToDb(CEILING)).toBeCloseTo(-1, 6);
    expect(gainToDb(KNEE)).toBeCloseTo(-6, 6);
  });

  test('the shaper\'s table is the curve over ±HEADROOM, with 0 at its centre', () => {
    const t = ceilingTable(4097, HEADROOM);
    expect(t[2048]).toBe(0);
    expect(t[0]).toBeCloseTo(-CEILING, 3);
    expect(t[4096]).toBeCloseTo(CEILING, 3);
    // the shaper sees the mix ÷ HEADROOM and maps i/(n-1)·2-1 to t[i]: a sample at the knee comes out at the knee
    const i = Math.round(((KNEE / HEADROOM + 1) / 2) * 4096);
    expect(t[i]).toBeCloseTo(KNEE, 2);
  });
});

describe('twelve voices at once', () => {
  test('the twelve loudest sounds started together, panned hard to one side, do not clip', () => {
    const peaks = SOUNDS.filter((d) => d.kind === 'once').map((d) => ({ id: d.id, peak: peakOf(render(d.id, SR)) }));
    peaks.sort((a, b) => b.peak - a.peak);
    const top = peaks.slice(0, MAX_VOICES);
    const g = panGains(SCORE_TUNING.panWidth)[1];
    // the plain sum of their peaks: the worst case, every peak landing on the same sample
    const worst = top.reduce((s, p) => s + p.peak, 0) * g;
    // their real sum, all started on the same sample
    const script = { name: 'twelve', seconds: 3, cues: top.map((p) => ({ at: 0, cue: { id: p.id, gain: 1, pan: SCORE_TUNING.panWidth } })), loops: [] };
    const m = mixdown(script, SR);
    console.log(`twelve loudest at once: ${top.map((p) => p.id).join(', ')}; peaks sum ${gainToDb(worst).toFixed(1)} dBFS, real sum ${gainToDb(m.prePeak).toFixed(1)} dBFS, after the ceiling ${gainToDb(Math.max(peakOf(m.left), peakOf(m.right))).toFixed(1)} dBFS`);
    expect(Math.max(peakOf(m.left), peakOf(m.right))).toBeLessThanOrEqual(CEILING);
    // and even the impossible worst case is inside the curve's range (it bends; it does not flatten)
    expect(worst).toBeLessThan(HEADROOM);
    // the real sum of twelve is on the straight part, or barely into the knee
    expect(m.prePeak).toBeLessThan(CEILING);
  });

  test('the cap drops the voice that matters least: quiet and nearly over, before loud and new', () => {
    const now = 10;
    const vs = [
      { start: 9.0, length: 2, level: 1 }, // loud, half done: 0.5
      { start: 9.9, length: 0.2, level: 0.3 }, // quiet, half done: 0.15
      { start: 9.95, length: 2, level: 0.2 }, // quiet, new: 0.195
      { start: 8.0, length: 2.05, level: 1 }, // loud, nearly over: 0.024
    ];
    expect(victim(vs, now)).toBe(3);
    expect(victim(vs.slice(0, 3), now)).toBe(1);
    // equals (1 × half left, 0.5 × all left): the older, first started
    expect(victim([{ start: 0, length: 4, level: 1 }, { start: 2, length: 2, level: 0.5 }], 2)).toBe(0);
    // a voice scheduled a moment ahead counts as whole, not more
    expect(victim([{ start: 5, length: 1, level: 0.5 }, { start: 0, length: 2, level: 0.6 }], 0)).toBe(0);
  });
});

describe('the scripts the audition page plays', () => {
  test('a busy ten seconds stays on the straight part of the ceiling', () => {
    const m = mixdown(busy(), SR);
    console.log(`busy ten seconds: peak before the ceiling ${gainToDb(m.prePeak).toFixed(1)} dBFS, ${m.inKnee} samples in the knee`);
    expect(m.prePeak).toBeLessThanOrEqual(KNEE);
    expect(m.inKnee).toBe(0);
  });

  test('a run plays S M L forward (falling) and L M S reversed (rising), faster at a higher detent', () => {
    const f = run(3, false);
    const r = run(3, true);
    const notes = (s: ReturnType<typeof run>) => s.cues.filter((c) => c.cue.id.startsWith('note.')).map((c) => c.cue.id);
    expect(notes(f)).toEqual(['note.wood.S', 'note.wood.M', 'note.wood.L']);
    expect(notes(r)).toEqual(['note.wood.L', 'note.wood.M', 'note.wood.S']);
    const span = (s: ReturnType<typeof run>) => s.cues[s.cues.length - 1]!.at - s.cues[0]!.at;
    expect(span(run(5, false))).toBeLessThan(span(run(1, false)));
  });
});
