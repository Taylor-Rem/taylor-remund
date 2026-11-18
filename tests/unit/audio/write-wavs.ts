// Writes every sound of the palette as a WAV file (16-bit, 48 kHz, mono; the scripts in stereo) under
// shots/audio/ (git-ignored), and prints the table of sounds with their measured numbers.
//
//   node tests/unit/audio/write-wavs.ts            all sounds, the runs and the busy ten seconds
//
// The contact sheet of waveforms and spectrograms is the dev page: /dev/sound/?sheet=1.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { busy, run } from '../../../src/workshop/audio/audition.ts';
import { measure } from '../../../src/workshop/audio/measure.ts';
import { noteName } from '../../../src/workshop/audio/notes.ts';
import { renderDef } from '../../../src/workshop/audio/render.ts';
import { SOUNDS } from '../../../src/workshop/audio/voices.ts';
import { mixdown } from './mixdown.ts';

const SR = 48000;
const OUT = join(import.meta.dirname, '../../../shots/audio');

function wav(channels: readonly Float32Array[], sr: number): Buffer {
  const n = channels[0]!.length;
  const c = channels.length;
  const b = Buffer.alloc(44 + n * c * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * c * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(c, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * c * 2, 28);
  b.writeUInt16LE(c * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[k]![i]!)) * 32767), 44 + (i * c + k) * 2);
  return b;
}

mkdirSync(OUT, { recursive: true });
const rows: string[] = ['| sound | answers | length s (design) | fundamental | peak dBFS | loudness dB |', '|---|---|---|---|---|---|'];
for (const d of SOUNDS) {
  const b = renderDef(d, SR);
  writeFileSync(join(OUT, `${d.id}.wav`), wav([b], SR));
  const m = measure(b, SR, d.pitch);
  const f0 = m.f0 !== null ? `${m.f0.toFixed(2)} Hz ${noteName(m.f0)} (${m.cents! >= 0 ? '+' : ''}${m.cents!.toFixed(1)} c)` : `none (energy ~${Math.round(m.dominant)} Hz)`;
  rows.push(`| ${d.id} | ${d.answers} | ${m.seconds.toFixed(3)} (${d.length[0]}-${d.length[1]}) | ${f0} | ${m.peakDb.toFixed(1)} | ${m.loudness.toFixed(1)} |`);
}
for (const s of [run(3, false), run(3, true), run(5, false), run(1, true), run(3, false, 'metal'), busy()]) {
  const m = mixdown(s, SR);
  const name = s.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  writeFileSync(join(OUT, `script-${name}.wav`), wav([m.left, m.right], SR));
  rows.push(`| script: ${s.name} | | ${s.seconds.toFixed(1)} | | ${(20 * Math.log10(m.prePeak)).toFixed(1)} (before the ceiling; ${m.inKnee} samples in its knee) | |`);
}
writeFileSync(join(OUT, 'table.md'), rows.join('\n') + '\n');
console.log(rows.join('\n'));
console.log(`\nwrote ${SOUNDS.length} sounds and 6 scripts to ${OUT}`);
