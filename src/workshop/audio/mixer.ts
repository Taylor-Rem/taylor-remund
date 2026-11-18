/**
 * The mix (AU1 brief § 3): every voice through one master, the master through a ceiling it cannot
 * pass, a cap on simultaneous voices that drops the oldest quietest first, a little stereo by where
 * on the bench a thing happens. Web Audio used directly (REWRITE.md § E1).
 *
 *   voice: buffer source → (low-pass) → gain → stereo pan ┐
 *   loop:  buffer source (looped)     → gain → stereo pan ┤→ master (level × mute) → ÷ HEADROOM → ceiling curve → out
 *
 * The ceiling is a static curve (`dsp.ts` `ceilingCurve`: straight to -6 dBFS, a tanh knee to
 * -1 dBFS) in a `WaveShaperNode`, the same function the tests check the mix with. The palette's levels
 * keep a busy mix on the straight part (tests/unit/audio/mix.test.ts); the knee is the guard, not
 * the sound.
 */
import { ceilingTable } from './dsp.ts';

/** At most this many one-shot voices sound at once (loops are not counted). */
export const MAX_VOICES = 12;
/** The ceiling's input range: the curve covers ±HEADROOM, so a sum that large still lands on it. */
export const HEADROOM = 4;
/** A dropped voice fades out over this long (s): stolen, not cut. */
const STEAL_FADE = 0.012;

/**
 * Which voice the cap drops: the one that matters least now, its level times the fraction of it still
 * to come (the oldest quietest); among equals the oldest.
 */
export function victim(voices: readonly { readonly start: number; readonly length: number; readonly level: number }[], now: number): number {
  let k = 0;
  let best = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!;
    const left = Math.min(1, Math.max(0, 1 - (now - v.start) / v.length));
    const score = v.level * left;
    if (score < best - 1e-9) {
      best = score;
      k = i;
    }
  }
  return k;
}

interface Voice {
  readonly src: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly start: number;
  readonly length: number;
  readonly level: number;
  done: boolean;
}

export interface PlayOptions {
  readonly gain?: number;
  readonly pan?: number;
  readonly rate?: number;
  readonly lowpass?: number;
  /** Start this many seconds from now. */
  readonly delay?: number;
}

export interface LoopVoice {
  set(gain: number, rate: number, pan: number): void;
  stop(): void;
}

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  private readonly voices: Voice[] = [];
  private level = 1;
  private muted = false;
  /** Voices dropped by the cap so far (the audition page prints it). */
  stolen = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const down = ctx.createGain();
    down.gain.value = 1 / HEADROOM;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = ceilingTable(4097, HEADROOM) as Float32Array<ArrayBuffer>;
    ceiling.oversample = '2x';
    this.master.connect(down).connect(ceiling).connect(out);
  }

  /** The master level, 0..1 (the audition page's slider; the strip may offer it). */
  setLevel(v: number): void {
    this.level = Math.max(0, Math.min(1, v));
    this.apply();
  }

  setMuted(on: boolean): void {
    this.muted = on;
    this.apply();
  }

  private apply(): void {
    const g = this.muted ? 0 : this.level;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.015);
  }

  /** How many one-shot voices are sounding now. */
  get active(): number {
    this.prune();
    return this.voices.length;
  }

  play(buffer: AudioBuffer, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.delay ?? 0);
    const level = Math.max(0, o.gain ?? 1);
    if (level <= 0) return;
    this.prune();
    while (this.voices.length >= MAX_VOICES) this.steal(t);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const rate = o.rate ?? 1;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = level;
    let head: AudioNode = src;
    if (o.lowpass && o.lowpass < 16000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      lp.Q.value = 0.5;
      head = head.connect(lp);
    }
    head = head.connect(gain);
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      head = head.connect(p);
    }
    head.connect(this.master);
    const v: Voice = { src, gain, start: t, length: buffer.duration / rate, level, done: false };
    src.onended = () => {
      v.done = true;
      src.disconnect();
    };
    src.start(t);
    this.voices.push(v);
  }

  /** Drop the voice that matters least now (`victim`). */
  private steal(now: number): void {
    const k = victim(this.voices, now);
    const v = this.voices.splice(k, 1)[0]!;
    v.done = true;
    v.gain.gain.setTargetAtTime(0, now, STEAL_FADE / 3);
    try {
      v.src.stop(now + STEAL_FADE * 2);
    } catch {
      /* already stopped */
    }
    this.stolen++;
  }

  private prune(): void {
    const now = this.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]!;
      if (v.done || now > v.start + v.length + 0.05) this.voices.splice(i, 1);
    }
  }

  /** A looped voice, silent until `set`; its gain, rate and pan glide (no zipper, no click). */
  loop(buffer: AudioBuffer): LoopVoice {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(gain).connect(pan).connect(this.master);
    // start each loop at a different point so two never phase together
    src.start(ctx.currentTime, (buffer.duration * 0.37) % buffer.duration);
    let last = { gain: 0, rate: 1, pan: 0 };
    return {
      set(g, r, p) {
        const t = ctx.currentTime;
        if (Math.abs(g - last.gain) > 1e-3) gain.gain.setTargetAtTime(g, t, 0.06);
        if (Math.abs(r - last.rate) > 1e-3) src.playbackRate.setTargetAtTime(r, t, 0.12);
        if (Math.abs(p - last.pan) > 1e-3) pan.pan.setTargetAtTime(p, t, 0.1);
        last = { gain: g, rate: r, pan: p };
      },
      stop() {
        try {
          src.stop();
        } catch {
          /* never started */
        }
        src.disconnect();
      },
    };
  }

  /** Silence every one-shot at once (a reset of the page, a dispose). */
  hush(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(0, now, 0.005);
      try {
        v.src.stop(now + 0.03);
      } catch {
        /* gone */
      }
    }
    this.voices.length = 0;
  }
}
