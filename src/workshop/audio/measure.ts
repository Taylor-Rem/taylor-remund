/**
 * Measuring a rendered sound (AU1 brief § 4): nobody on the team can hear, so every claim about a
 * sound is a number taken from its samples. Used by the tests, the WAV tool and the audition page
 * (which shows these beside each sound). Pure functions; no Web Audio.
 */
import { cents, filterWith, gainToDb, type Buf } from './dsp.ts';

export function peakOf(b: Buf): number {
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]!));
  return p;
}

export function dcOf(b: Buf): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i]!;
  return s / Math.max(1, b.length);
}

/** Largest |sample| in the first and the last `ms` milliseconds, against the peak (0..1). */
export function edgesOf(b: Buf, sr: number, ms: number): { start: number; end: number; first: number; last: number } {
  const n = Math.max(1, Math.round((ms / 1000) * sr));
  const p = peakOf(b) || 1;
  let s = 0,
    e = 0;
  for (let i = 0; i < Math.min(n, b.length); i++) s = Math.max(s, Math.abs(b[i]!));
  for (let i = Math.max(0, b.length - n); i < b.length; i++) e = Math.max(e, Math.abs(b[i]!));
  return { start: s / p, end: e / p, first: Math.abs(b[0] ?? 0), last: Math.abs(b[b.length - 1] ?? 0) };
}

/** Seconds from the start to the last sample above -60 dB of the peak: how long it is heard. */
export function lengthOf(b: Buf, sr: number): number {
  const floor = peakOf(b) * 1e-3;
  let end = b.length;
  while (end > 1 && Math.abs(b[end - 1]!) <= floor) end--;
  return end / sr;
}

/**
 * K-weighting (ITU-R BS.1770-4): the high shelf and the high-pass, with coefficients derived for any
 * sample rate (as libebur128 does) rather than the standard's 48 kHz table.
 */
export function kWeight(b: Buf, sr: number): Buf {
  const out = b.slice();
  // stage 1: the head's high shelf, +4 dB above ~1.7 kHz
  {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    filterWith(out, {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    });
  }
  // stage 2: the RLB high-pass, ~38 Hz
  {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sr);
    const a0 = 1 + K / Q + K * K;
    filterWith(out, { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 });
  }
  return out;
}

/** The window the loudness is taken over (seconds). Short, because most of these sounds are. */
export const LOUDNESS_WINDOW = 0.1;

/**
 * Loudness, dB: K-weighted mean square over the loudest `LOUDNESS_WINDOW` of the sound (hop 10 ms),
 * -0.691 dB as BS.1770 has it. A 100 ms window rather than the standard's 400 ms because a click is
 * 20 ms long; a sound shorter than the window is averaged with silence, which is how it is heard: as
 * quieter than a long one of the same peak. Not LUFS; a consistent yardstick across the palette.
 */
export function loudnessOf(b: Buf, sr: number): number {
  const k = kWeight(b, sr);
  const w = Math.max(1, Math.round(LOUDNESS_WINDOW * sr));
  const hop = Math.max(1, Math.round(0.01 * sr));
  // prefix sums of the square
  const cum = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) cum[i + 1] = cum[i]! + k[i]! * k[i]!;
  let best = 0;
  for (let s = 0; s === 0 || s + w <= k.length + hop; s += hop) {
    const e = Math.min(k.length, s + w);
    const ms = (cum[e]! - cum[Math.min(s, k.length)]!) / w;
    best = Math.max(best, ms);
    if (e >= k.length) break;
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -Infinity;
}

// ───────────────────────── spectrum ─────────────────────────

/** In-place radix-2 FFT of (re, im), length a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j]!,
          ai = im[i + j]!;
        const br = re[i + j + len / 2]! * cr - im[i + j + len / 2]! * ci;
        const bi = re[i + j + len / 2]! * ci + im[i + j + len / 2]! * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Magnitude spectrum of `seconds` from `from` (Hann window, zero-padded to `size`). Bin k is k·sr/size Hz. */
export function spectrum(b: Buf, sr: number, o: { from?: number; seconds?: number; size?: number } = {}): Float64Array {
  const size = o.size ?? 1 << 17;
  const s = Math.round((o.from ?? 0) * sr);
  const n = Math.min(b.length - s, Math.round((o.seconds ?? b.length / sr) * sr), size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = b[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

/** The interpolated frequency of the largest bin in [lo, hi] Hz (a parabola through the log magnitudes). */
export function peakIn(mag: Float64Array, sr: number, lo: number, hi: number): { f: number; mag: number } {
  const size = mag.length * 2;
  const a = Math.max(1, Math.floor((lo * size) / sr));
  const z = Math.min(mag.length - 2, Math.ceil((hi * size) / sr));
  let k = a;
  for (let i = a; i <= z; i++) if (mag[i]! > mag[k]!) k = i;
  const l = Math.log(mag[k - 1]! + 1e-30);
  const c = Math.log(mag[k]! + 1e-30);
  const r = Math.log(mag[k + 1]! + 1e-30);
  const d = l - 2 * c + r;
  const off = d !== 0 ? (0.5 * (l - r)) / d : 0;
  return { f: ((k + off) * sr) / size, mag: mag[k]! };
}

/**
 * The fundamental near an expected pitch: the largest spectral peak within a fourth below and a
 * fifth above `expect` (a note's own partials are further apart than that), and whether anything
 * below it is louder (it would then not be the fundamental: `lowest` false). The spectrum is taken
 * over the first `seconds`, where the tone is strongest.
 */
export function fundamentalNear(b: Buf, sr: number, expect: number, seconds = 0.5): { f: number; cents: number; lowest: boolean; ratioBelow: number } {
  const mag = spectrum(b, sr, { seconds });
  const p = peakIn(mag, sr, expect * 0.75, expect * 1.4);
  const below = peakIn(mag, sr, 60, expect * 0.7);
  return { f: p.f, cents: cents(p.f, expect), lowest: below.mag < p.mag, ratioBelow: below.mag / p.mag };
}

/** The strongest frequency in [lo, hi] over the whole sound. */
export function dominant(b: Buf, sr: number, lo = 40, hi = 8000, seconds?: number): number {
  return peakIn(spectrum(b, sr, seconds ? { seconds } : {}), sr, lo, hi).f;
}

/** Spectral centroid (Hz) over the first `seconds`: how bright it is. */
export function centroidOf(b: Buf, sr: number, seconds = 0.2): number {
  const mag = spectrum(b, sr, { seconds, size: 1 << 14 });
  let s = 0,
    w = 0;
  for (let i = 1; i < mag.length; i++) {
    const f = (i * sr) / (mag.length * 2);
    s += f * mag[i]!;
    w += mag[i]!;
  }
  return w > 0 ? s / w : 0;
}

/** A spectrogram: `frames` columns of `bins` log-spaced bands from 40 Hz to 16 kHz, dB (relative to the loudest cell). */
export function spectrogram(b: Buf, sr: number, frames: number, bins: number, size = 1024): Float32Array {
  const out = new Float32Array(frames * bins);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const lo = Math.log(40);
  const hi = Math.log(Math.min(16000, sr / 2));
  let max = 1e-12;
  for (let c = 0; c < frames; c++) {
    const s = Math.round((c / frames) * Math.max(0, b.length - size));
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < size && s + i < b.length; i++) re[i] = b[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    fft(re, im);
    for (let r = 0; r < bins; r++) {
      const f0 = Math.exp(lo + ((hi - lo) * r) / bins);
      const f1 = Math.exp(lo + ((hi - lo) * (r + 1)) / bins);
      const k0 = Math.max(1, Math.floor((f0 * size) / sr));
      const k1 = Math.max(k0, Math.min(size / 2 - 1, Math.floor((f1 * size) / sr)));
      let e = 0;
      for (let k = k0; k <= k1; k++) e = Math.max(e, re[k]! * re[k]! + im[k]! * im[k]!);
      out[c * bins + r] = e;
      max = Math.max(max, e);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = 10 * Math.log10((out[i]! + 1e-20) / max);
  return out;
}

/** Everything the audition page and the tests print about one sound. */
export interface Measured {
  readonly seconds: number;
  readonly peakDb: number;
  readonly loudness: number;
  readonly dc: number;
  readonly start: number;
  readonly end: number;
  /** The fundamental found near the expected pitch, and its error in cents; null for an unpitched sound. */
  readonly f0: number | null;
  readonly cents: number | null;
  /** The strongest frequency, for an unpitched sound. */
  readonly dominant: number;
}

export function measure(b: Buf, sr: number, expect: number | null): Measured {
  const fn = expect ? fundamentalNear(b, sr, expect) : null;
  return {
    seconds: lengthOf(b, sr),
    peakDb: gainToDb(peakOf(b)),
    loudness: loudnessOf(b, sr),
    dc: dcOf(b),
    ...(() => {
      const e = edgesOf(b, sr, 0.25);
      return { start: e.start, end: e.end };
    })(),
    f0: fn ? fn.f : null,
    cents: fn ? fn.cents : null,
    dominant: dominant(b, sr, 40, 8000, Math.min(0.5, b.length / sr)),
  };
}
