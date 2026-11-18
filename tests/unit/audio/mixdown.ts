/**
 * The mixer's arithmetic in Node: a script of cues summed as `Mixer` sums them (equal-power stereo
 * pan as `StereoPannerNode` pans a mono source, playback rate, a voice's low-pass, the master level,
 * the ceiling curve), so the mix can be checked without a browser. The Web Audio graph is the same
 * shape; its ceiling uses the same curve (`ceilingCurve`).
 */
import { biquad, ceilingCurve } from '../../../src/workshop/audio/dsp.ts';
import { render } from '../../../src/workshop/audio/render.ts';
import type { Script } from '../../../src/workshop/audio/audition.ts';

export interface Mixdown {
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** Before the ceiling: how far the plain sum went. */
  readonly prePeak: number;
  /** Samples that reached the knee (where the ceiling starts to bend). */
  readonly inKnee: number;
}

/** `StereoPannerNode` on a mono input: equal power, θ = (pan + 1)·π/4. */
export function panGains(pan: number): [number, number] {
  const th = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(th), Math.sin(th)];
}

function resample(b: Float32Array, rate: number): Float32Array {
  if (rate === 1) return b;
  const n = Math.floor(b.length / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * rate;
    const k = Math.floor(x);
    const f = x - k;
    out[i] = (b[k] ?? 0) * (1 - f) + (b[k + 1] ?? 0) * f;
  }
  return out;
}

export function mixdown(script: Script, sr: number, o: { level?: number; knee?: number } = {}): Mixdown {
  const n = Math.round(script.seconds * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const level = o.level ?? 1;
  const add = (b: Float32Array, at: number, gain: number, pan: number): void => {
    const [gl, gr] = panGains(pan);
    const s = Math.round(at * sr);
    for (let i = 0; i < b.length && s + i < n; i++) {
      L[s + i]! += b[i]! * gain * gl * level;
      R[s + i]! += b[i]! * gain * gr * level;
    }
  };
  const variants = new Map<string, number>();
  for (const { at, cue } of script.cues) {
    const v = variants.get(cue.id) ?? 0;
    variants.set(cue.id, v + 1);
    let b = render(cue.id, sr, v, cue.param);
    if (cue.lowpass && cue.lowpass < 16000) b = biquad(b.slice(), sr, 'lowpass', cue.lowpass, 0.5);
    add(resample(b, cue.rate ?? 1), at, cue.gain, cue.pan);
  }
  for (const span of script.loops) {
    const one = resample(render(span.loop.id, sr), span.loop.rate);
    const len = Math.round((span.to - span.from) * sr);
    const b = new Float32Array(len);
    for (let i = 0; i < len; i++) b[i] = one[i % one.length]!;
    add(b, span.from, span.loop.gain, span.loop.pan);
  }
  let pre = 0;
  let knee = 0;
  const K = o.knee ?? 0.5011872336272722;
  for (let i = 0; i < n; i++) {
    pre = Math.max(pre, Math.abs(L[i]!), Math.abs(R[i]!));
    if (Math.abs(L[i]!) > K || Math.abs(R[i]!) > K) knee++;
    L[i] = ceilingCurve(L[i]!);
    R[i] = ceilingCurve(R[i]!);
  }
  return { left: L, right: R, prePeak: pre, inKnee: knee };
}
