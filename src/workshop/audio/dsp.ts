/**
 * The synthesiser's arithmetic (REWRITE.md § A "Sound", § B9 "part notes are synthesised in the
 * browser"). Pure functions over `Float32Array`s: no Web Audio, no DOM, no clock, so every sound the
 * workshop makes is rendered the same in the browser and in Node, and checked by numbers in tests
 * (tests/unit/audio/). Randomness is seeded: the same sound is the same samples every time.
 */

export type Buf = Float32Array;

/** A small seeded generator (mulberry32): the imperfection of a sound is chosen, not rolled. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string to a seed (FNV-1a), so each sound's noise is its own. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);
/** Equal temperament from A4 = 440 Hz. */
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

export function alloc(sr: number, seconds: number): Buf {
  return new Float32Array(Math.max(1, Math.round(sr * seconds)));
}

/** out += src × gain, starting at sample `at`. */
export function mixInto(out: Buf, src: Buf, gain = 1, at = 0): Buf {
  const n = Math.min(src.length, out.length - at);
  for (let i = 0; i < n; i++) out[at + i]! += src[i]! * gain;
  return out;
}

/**
 * A decaying sinusoid: amplitude `amp`, decay time constant `tau` seconds (amplitude falls by e each
 * tau), starting `delay` seconds in. `beat` adds a second sinusoid `beat` Hz above, the same amplitude
 * (a split partial: the slow beating of a bell or a struck bar). `glide` multiplies the frequency from
 * 1 to `glide` over `glideTime` (exponential): a comic bonk.
 */
export function partial(out: Buf, sr: number, o: { f: number; amp: number; tau: number; delay?: number; phase?: number; beat?: number; glide?: number; glideTime?: number; attack?: number }): Buf {
  const start = Math.round((o.delay ?? 0) * sr);
  const two = o.beat ? 0.5 : 1;
  const att = Math.max(1, Math.round((o.attack ?? 0) * sr));
  const glide = o.glide ?? 1;
  const gT = o.glideTime ?? 0.1;
  const decay = Math.exp(-1 / (o.tau * sr));
  const p0 = o.phase ?? 0;
  if (glide !== 1) {
    // the slow path: the frequency moves, so the phase is integrated sample by sample
    let ph = p0;
    let env = 1;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / sr;
      if (env < 1e-6 && t > 0.01) break;
      ph += (2 * Math.PI * o.f * Math.pow(glide, Math.min(1, t / gT))) / sr;
      out[i]! += Math.sin(ph) * o.amp * env * (i - start < att ? (i - start) / att : 1);
      env *= decay;
    }
    return out;
  }
  // a fixed frequency: a rotating phasor (two multiplies a sample instead of a sine) under a multiplied decay
  const rot = (f: number): [number, number] => [Math.cos((2 * Math.PI * f) / sr), Math.sin((2 * Math.PI * f) / sr)];
  const [c1, s1] = rot(o.f);
  const [c2, s2] = rot(o.f + (o.beat ?? 0));
  let x1 = Math.cos(p0),
    y1 = Math.sin(p0),
    x2 = x1,
    y2 = y1;
  let env = o.amp * two;
  const beat = !!o.beat;
  for (let i = start; i < out.length; i++) {
    if (env < 1e-6 * o.amp && i - start > sr * 0.01) break;
    // advance first, as a phase accumulator does
    const nx1 = x1 * c1 - y1 * s1;
    y1 = x1 * s1 + y1 * c1;
    x1 = nx1;
    let s = y1;
    if (beat) {
      const nx2 = x2 * c2 - y2 * s2;
      y2 = x2 * s2 + y2 * c2;
      x2 = nx2;
      s += y2;
    }
    out[i]! += s * env * (i - start < att ? (i - start) / att : 1);
    env *= decay;
    // keep the phasors on the unit circle (rounding drifts them over seconds)
    if ((i & 1023) === 0) {
      const k1 = 1 / Math.hypot(x1, y1);
      x1 *= k1;
      y1 *= k1;
      const k2 = 1 / Math.hypot(x2, y2);
      x2 *= k2;
      y2 *= k2;
    }
  }
  return out;
}

/** White noise in -1..1, seeded. */
export function noise(n: number, rnd: () => number): Buf {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
  return out;
}

/** Shape a buffer by an envelope function of time (seconds). */
export function shape(buf: Buf, sr: number, env: (t: number) => number, from = 0): Buf {
  for (let i = from; i < buf.length; i++) buf[i]! *= env((i - from) / sr);
  return buf;
}

/** An attack-decay envelope: linear rise over `a` seconds, then exponential decay with constant `tau`. */
export const ad =
  (a: number, tau: number) =>
  (t: number): number =>
    t < a ? t / a : Math.exp(-(t - a) / tau);

// ───────────────────────── filters (RBJ biquads) ─────────────────────────

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'lowshelf' | 'highshelf';

export interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Robert Bristow-Johnson's cookbook, normalised (a0 = 1). `gainDb` for peak and shelves. */
export function biquadCoeffs(kind: BiquadKind, f: number, q: number, sr: number, gainDb = 0): Coeffs {
  const w = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run a biquad over `buf` in place (direct form I). */
export function filterWith(buf: Buf, c: Coeffs): Buf {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

export function biquad(buf: Buf, sr: number, kind: BiquadKind, f: number, q = Math.SQRT1_2, gainDb = 0): Buf {
  return filterWith(buf, biquadCoeffs(kind, f, q, sr, gainDb));
}

/**
 * A biquad whose centre moves with time (`f(t)`), recomputed every 32 samples: the tape's squeal
 * following the reels, a buzz's formant.
 */
export function sweep(buf: Buf, sr: number, kind: BiquadKind, f: (t: number) => number, q: number): Buf {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  let c = biquadCoeffs(kind, f(0), q, sr);
  for (let i = 0; i < buf.length; i++) {
    if ((i & 31) === 0) c = biquadCoeffs(kind, f(i / sr), q, sr);
    const x = buf[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

/** A filtered noise burst: `seconds` long, band-limited by `kind` at `f`, shaped by `env`. */
export function burst(sr: number, seconds: number, rnd: () => number, kind: BiquadKind, f: number, q: number, env: (t: number) => number): Buf {
  const b = noise(Math.round(sr * seconds), rnd);
  biquad(b, sr, kind, f, q);
  return shape(b, sr, env);
}

// ───────────────────────── finishing ─────────────────────────

/** The attack every sound starts with (seconds): long enough that its first sample is silence and nothing pops. */
export const EDGE_IN = 0.0015;
/** The fade every sound ends with (seconds). */
export const EDGE_OUT = 0.006;

/**
 * Make a raw render safe to play: a 25 Hz high-pass (no DC, no subsonic thump a laptop cannot play but
 * a headphone pushes), a raised-cosine fade in and out (no click at either end), trimmed after the
 * last sample above -70 dB of its peak.
 */
export function finish(buf: Buf, sr: number): Buf {
  biquad(buf, sr, 'highpass', 25, Math.SQRT1_2);
  // trim the silent tail
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
  const floor = peak * dbToGain(-70);
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]!) <= floor) end--;
  const tail = Math.round(EDGE_OUT * sr);
  end = Math.min(buf.length, end + tail);
  const out = buf.slice(0, end);
  // a sound still ringing when its buffer ends is faded over its last fifth (at most 0.3 s), not cut
  const last = Math.round(0.05 * sr);
  let tailPeak = 0;
  for (let i = Math.max(0, out.length - last); i < out.length; i++) tailPeak = Math.max(tailPeak, Math.abs(out[i]!));
  if (tailPeak > peak * dbToGain(-50)) {
    const n = Math.min(Math.round(0.3 * sr), Math.round(out.length / 5));
    for (let i = 0; i < n; i++) out[out.length - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
  }
  const nIn = Math.max(2, Math.round(EDGE_IN * sr));
  for (let i = 0; i < nIn && i < out.length; i++) out[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nIn);
  const nOut = Math.min(out.length, tail);
  for (let i = 0; i < nOut; i++) out[out.length - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nOut);
  // the high-pass leaves a residue of a few millionths; take the mean out, then the edges are re-zeroed by the fades above
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i]!;
  mean /= out.length;
  if (Math.abs(mean) > 0) {
    for (let i = nIn; i < out.length - nOut; i++) out[i]! -= mean;
  }
  return out;
}

/**
 * A loop that joins itself: the last `fade` seconds are cross-faded into the first, so a looped
 * buffer has no seam (the belt's hum, the treads, Fetch's wheel).
 */
export function seamless(buf: Buf, sr: number, fade: number): Buf {
  const n = Math.round(fade * sr);
  const len = buf.length - n;
  const out = buf.slice(0, len);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const a = Math.sin((k * Math.PI) / 2);
    const b = Math.cos((k * Math.PI) / 2);
    out[i] = buf[i]! * a + buf[len + i]! * b;
  }
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i]!;
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i]! -= mean;
  return out;
}

export function scale(buf: Buf, g: number): Buf {
  for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  return buf;
}

// ───────────────────────── the master's ceiling ─────────────────────────

/** The master never goes above this (-1 dBFS). */
export const CEILING = dbToGain(-1);
/** Below this the master's curve is a straight line: the level budget keeps the mix here (tests/unit/audio). */
export const KNEE = dbToGain(-6);

/**
 * The master's limiter as a static curve: unity up to `KNEE`, then a tanh knee that never passes
 * `CEILING`. The same function draws the `WaveShaperNode`'s curve and checks the mix in Node.
 */
export function ceilingCurve(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const room = CEILING - KNEE;
  return Math.sign(x) * (KNEE + room * Math.tanh((a - KNEE) / room));
}

/** The curve as a `WaveShaperNode` table over -1..1 (`n` points, odd so 0 maps to 0). */
export function ceilingTable(n = 4097, headroom = 4): Float32Array {
  // the shaper's input is clamped to -1..1, so the mix is scaled down by `headroom` before it and the curve scaled up
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * headroom;
    t[i] = ceilingCurve(x);
  }
  return t;
}
