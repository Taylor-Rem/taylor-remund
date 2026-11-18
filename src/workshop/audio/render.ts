/**
 * Recipe to samples: draw a sound, make it safe (no DC, no click at either end), and set its loudness
 * to the palette's reference plus its own level. The same function feeds the browser's buffers, the
 * tests and the WAV files, so what is measured is what is played.
 */
import { dbToGain, finish, scale, seedOf, seeded, type Buf } from './dsp.ts';
import { loudnessOf } from './measure.ts';
import { soundDef, type SoundDef } from './voices.ts';

/**
 * The palette's reference loudness (dB, `measure.ts` `loudnessOf`): a struck note, the Button, the bell
 * sit here; everything else is set against it by its `level`. Quiet on purpose (AU1 brief § 3: a
 * visitor with headphones on must not jump): about 20 dB under a pop song's loudest moments. The
 * master's level budget (tests/unit/audio/mix.test.ts) is computed from it.
 */
export const REF_LOUDNESS = -30;

/** A parameter rounded to the sound's step and clamped to its range (so renders can be cached). */
export function paramOf(def: SoundDef, p?: number): number {
  if (!def.param) return 0;
  const { min, max, step } = def.param;
  const v = p ?? def.param.default;
  return Math.min(max, Math.max(min, Math.round(v / step) * step));
}

export function renderDef(def: SoundDef, sr: number, variant = 0, param?: number): Buf {
  const p = paramOf(def, param);
  const raw = def.draw(sr, seeded(seedOf(`${def.id}#${variant % def.variants}`)), p);
  // a loop is already seamless and centred (`seamless`); a filter's start-up would put a seam back
  const out = def.kind === 'loop' ? raw : finish(raw, sr);
  const l = loudnessOf(out, sr);
  return Number.isFinite(l) ? scale(out, dbToGain(REF_LOUDNESS + def.level - l)) : out;
}

export function render(id: string, sr: number, variant = 0, param?: number): Buf {
  return renderDef(soundDef(id), sr, variant, param);
}
