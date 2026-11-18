/**
 * Every part has its own note (REWRITE.md § B1: "three sizes, three notes, large is low; metal rings an
 * octave above wood"). The simulation decides the numbers (`NOTE` by size, `OCTAVE` by material, sent
 * on `struck`); this file only says what pitch the numbers are.
 *
 * The line's root is C4 (261.63 Hz): a large wooden crate is C4, a medium E4, a small G4, a C-major
 * triad. Metal is the octave above (C5 E5 G5), rubber the octave below (C3 E3 G3), paper the same
 * octave as wood (the simulation's `OCTAVE.paper` is 0: a duller timbre, the same pitch). Everything
 * else that has a pitch (the bell, the hum) is chosen in the same key so nothing jars against a run.
 */
import { NOTE, OCTAVE } from '../sim/index.ts';
import type { PartMaterial, PartSize } from '../sim/index.ts';
import { midiToHz } from './dsp.ts';

/** C4, as a MIDI number: the root of the line (a large wooden crate). */
export const ROOT_MIDI = 60;
export const ROOT_HZ = midiToHz(ROOT_MIDI);

/** The pitch a `struck` event names: semitones above the root and octaves from wood. */
export function struckHz(note: number, octave: number): number {
  return midiToHz(ROOT_MIDI + note + 12 * octave);
}

/** A part's own note, from its size and material (the same numbers the striker sends). */
export function partHz(size: PartSize, material: PartMaterial): number {
  return struckHz(NOTE[size], OCTAVE[material]);
}

export const SIZES: readonly PartSize[] = ['L', 'M', 'S'];
export const MATERIALS: readonly PartMaterial[] = ['wood', 'metal', 'paper', 'rubber'];

/** Names for the audition page and the tables: C4, E5, … */
export function noteName(hz: number): string {
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
