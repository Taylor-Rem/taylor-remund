/**
 * The workshop's palette (AU1 brief § 1-2): every sound it makes, as a recipe of decaying partials and
 * filtered noise, rendered to samples by `render.ts`. Each recipe states what it answers, its level
 * against the palette's reference, how long it is meant to be, and its pitch if it has one; the tests
 * hold every rendered sound to those numbers (tests/unit/audio/).
 *
 * The direction (REWRITE.md § A "Sound"): thunks, clicks, a bell, the belt's hum. Quiet, short,
 * mechanical, in tune. Scuffed enamel, brass, wood, rubber: nothing electronic but the phone.
 */
import type { PartMaterial, PartSize } from '../sim/index.ts';
import { ad, alloc, biquad, burst, mixInto, noise, partial, seamless, shape, sweep, type Buf } from './dsp.ts';
import { partHz, MATERIALS, SIZES } from './notes.ts';

/** How a sound is used: once, or looped under a level and a rate the score sets every frame. */
export type SoundKind = 'once' | 'loop';

export interface SoundDef {
  readonly id: string;
  /** For the audition page and the table: what it belongs to. */
  readonly group: 'note' | 'pick' | 'hit' | 'striker' | 'handle' | 'button' | 'line' | 'dock' | 'phone' | 'crew' | 'undo' | 'misc' | 'loop';
  /** The simulation event (or view state) it answers, as the table prints it. */
  readonly answers: string;
  /** Loudness against the palette's reference (`REF_LOUDNESS`), dB. Loudness is set to exactly this when rendered. */
  readonly level: number;
  /** The length it is designed to have, seconds (min, max), as heard (to -60 dB of its peak). */
  readonly length: readonly [number, number];
  /** Its fundamental, Hz, for a sound with a pitch; null for a noise or a knock. */
  readonly pitch: number | null;
  readonly kind: SoundKind;
  /** Seeded variants (a click is never quite the same twice); 1 for a note. */
  readonly variants: number;
  /** A parameter that changes its length (seconds): the tape's rewind, the warning lamp, the door. */
  readonly param?: { readonly default: number; readonly min: number; readonly max: number; readonly step: number };
  /** The raw samples (before `finish` and the level): `rnd` is seeded by id and variant. */
  draw(sr: number, rnd: () => number, param: number): Buf;
}

// ───────────────────────── building blocks ─────────────────────────

type Mode = readonly [f: number, amp: number, tau: number];

/**
 * A knock: a short noise impulse ringing a few resonant modes (a body's own frequencies), each a
 * decaying sinusoid. Every mechanical click here is one of these with different modes. `jitter`
 * moves each mode a few percent per variant: imperfection, seeded.
 */
function knock(out: Buf, sr: number, rnd: () => number, modes: readonly Mode[], o: { at?: number; gain?: number; jitter?: number; noiseF?: number; noiseTau?: number; noiseAmp?: number } = {}): Buf {
  const at = o.at ?? 0;
  const g = o.gain ?? 1;
  const j = o.jitter ?? 0.03;
  for (const [f, amp, tau] of modes) {
    partial(out, sr, { f: f * (1 + (rnd() * 2 - 1) * j), amp: amp * g, tau, delay: at, phase: rnd() * Math.PI * 2, attack: 0.0004 });
  }
  if ((o.noiseAmp ?? 0.4) > 0) {
    const nt = o.noiseTau ?? 0.0025;
    const b = burst(sr, Math.min(0.08, nt * 10), rnd, 'bandpass', o.noiseF ?? 3000, 0.9, ad(0.0003, nt));
    mixInto(out, b, (o.noiseAmp ?? 0.4) * g, Math.round(at * sr));
  }
  return out;
}

/** A low body thump: a sine that falls a little in pitch, and a puff of low noise. */
function thump(out: Buf, sr: number, rnd: () => number, o: { f: number; tau: number; amp?: number; at?: number; drop?: number; noiseF?: number }): Buf {
  const at = o.at ?? 0;
  partial(out, sr, { f: o.f, amp: o.amp ?? 1, tau: o.tau, delay: at, glide: o.drop ?? 0.85, glideTime: o.tau * 2, attack: 0.002 });
  const b = burst(sr, Math.min(0.2, o.tau * 4), rnd, 'lowpass', o.noiseF ?? 500, 0.7, ad(0.001, o.tau * 0.4));
  mixInto(out, b, 0.5 * (o.amp ?? 1), Math.round(at * sr));
  return out;
}

const sizeFactor: Readonly<Record<PartSize, number>> = { L: 1, M: 0.88, S: 0.76 };

// ───────────────────────── the instrument: struck things ─────────────────────────

/** How a note is played: struck by the striker, picked up (quieter and shorter), or landed on / hit. */
export type Touch = 'note' | 'pick' | 'hit';

/**
 * One struck voice for every part: the note from size, the octave and timbre from material
 * (AU1 brief § 1). `touch` shortens it (pick) or adds the knock of a landing (hit).
 */
export function struck(material: PartMaterial, size: PartSize, touch: Touch, sr: number, rnd: () => number): Buf {
  const f = partHz(size, material);
  const k = sizeFactor[size];
  const short = touch === 'pick' ? 0.4 : touch === 'hit' ? 0.55 : 1;
  switch (material) {
    case 'wood': {
      // a marimba-ish knock: fast attack, short decay, few partials (a tuned bar's 1 : 4 : 10)
      const tau = 0.2 * k * short;
      const out = alloc(sr, Math.min(1.6, tau * 7.5 + 0.05));
      partial(out, sr, { f, amp: 1, tau, attack: 0.001 });
      partial(out, sr, { f: f * 4, amp: 0.3, tau: tau * 0.22, attack: 0.0006 });
      if (f * 10 < sr * 0.4) partial(out, sr, { f: f * 10, amp: 0.08, tau: tau * 0.07, attack: 0.0004 });
      // the mallet: a little low-passed noise at the start
      mixInto(out, burst(sr, 0.03, rnd, 'lowpass', touch === 'hit' ? 900 : 1600, 0.8, ad(0.0005, 0.004)), touch === 'hit' ? 0.5 : 0.18);
      if (touch === 'hit') thump(out, sr, rnd, { f: f / 2, tau: 0.03, amp: 0.35 });
      return out;
    }
    case 'metal': {
      // a chime: an octave up, a long ring, a free bar's inharmonic partials (1 : 2.756 : 5.404 : 8.933)
      const tau = 0.42 * k * short;
      const out = alloc(sr, Math.min(2.6, tau * 6 + 0.05));
      partial(out, sr, { f: f - 0.35, beat: 0.7, amp: 1, tau, attack: 0.0006 });
      partial(out, sr, { f: f * 2.756, amp: 0.42, tau: tau * 0.42, attack: 0.0005 });
      partial(out, sr, { f: f * 5.404, amp: 0.2, tau: tau * 0.2, attack: 0.0004 });
      if (f * 8.933 < sr * 0.4) partial(out, sr, { f: f * 8.933, amp: 0.1, tau: tau * 0.1, attack: 0.0004 });
      mixInto(out, burst(sr, 0.02, rnd, 'highpass', 4500, 0.7, ad(0.0003, 0.0018)), touch === 'hit' ? 0.3 : 0.12);
      if (touch === 'hit') thump(out, sr, rnd, { f: f / 4, tau: 0.025, amp: 0.25 });
      return out;
    }
    case 'paper': {
      // a soft dry tap: a puff of mid noise and a short, faint tone at the note
      const tau = 0.045 * k * short;
      const out = alloc(sr, 0.2);
      partial(out, sr, { f, amp: 0.6, tau, attack: 0.0015 });
      partial(out, sr, { f: f * 2, amp: 0.12, tau: tau * 0.5, attack: 0.001 });
      mixInto(out, burst(sr, 0.06, rnd, 'bandpass', 2400, 0.7, ad(0.0006, 0.006)), touch === 'hit' ? 0.5 : 0.3);
      return out;
    }
    case 'rubber': {
      // an octave down, a dull thud with almost no pitch: a heavily damped low sine and a puff of low noise
      const tau = 0.05 * k * short;
      const out = alloc(sr, 0.3);
      partial(out, sr, { f, amp: 1, tau, attack: 0.003 });
      partial(out, sr, { f: f * 2, amp: 0.1, tau: tau * 0.4, attack: 0.002 });
      mixInto(out, burst(sr, 0.06, rnd, 'lowpass', 320, 0.7, ad(0.001, 0.008)), touch === 'hit' ? 0.5 : 0.25);
      return out;
    }
  }
}

const noteLevel: Readonly<Record<Touch, number>> = { note: 0, pick: -6, hit: -1 };
const noteLength: Readonly<Record<PartMaterial, Readonly<Record<Touch, readonly [number, number]>>>> = {
  wood: { note: [0.6, 1.6], pick: [0.25, 0.75], hit: [0.35, 0.95] },
  metal: { note: [1.2, 2.6], pick: [0.5, 1.2], hit: [0.7, 1.6] },
  paper: { note: [0.06, 0.25], pick: [0.04, 0.2], hit: [0.04, 0.2] },
  rubber: { note: [0.12, 0.3], pick: [0.06, 0.3], hit: [0.06, 0.3] },
};

const NOTES: SoundDef[] = [];
for (const touch of ['note', 'pick', 'hit'] as const) {
  for (const material of MATERIALS) {
    for (const size of SIZES) {
      NOTES.push({
        id: `${touch}.${material}.${size}`,
        group: touch,
        answers: touch === 'note' ? 'struck (size, material)' : touch === 'pick' ? 'part.grabbed' : 'part.hit (scaled by impact speed)',
        level: noteLevel[touch],
        length: noteLength[material][touch],
        pitch: partHz(size, material),
        kind: 'once',
        variants: 1,
        draw: (sr, rnd) => struck(material, size, touch, sr, rnd),
      });
    }
  }
}

// ───────────────────────── everything else ─────────────────────────

const once = (d: Omit<SoundDef, 'kind' | 'variants' | 'pitch'> & { variants?: number; pitch?: number | null }): SoundDef => ({ kind: 'once', variants: 3, pitch: null, ...d });

/** The bell's strike note: G5, the fifth of the line's key, a small brass shop bell. */
export const BELL_HZ = 783.99;
/** The belt motor's hum at the middle speed: G2. */
export const HUM_HZ = 98;

const OTHERS: SoundDef[] = [
  // ── the striker ──
  once({
    id: 'striker.felt',
    group: 'striker',
    answers: 'struck (under the note: the felt hammer)',
    level: -9,
    length: [0.04, 0.2],
    draw: (sr, rnd) => thump(alloc(sr, 0.2), sr, rnd, { f: 92, tau: 0.028, noiseF: 700 }),
  }),
  once({
    id: 'striker.air',
    group: 'striker',
    answers: 'struck with no part (a misfire: the arm hits air)',
    level: -9,
    length: [0.02, 0.12],
    draw: (sr, rnd) => knock(alloc(sr, 0.12), sr, rnd, [[1250, 0.4, 0.012], [2900, 0.3, 0.005]], { noiseF: 3200, noiseAmp: 0.5 }),
  }),

  // ── handles: a click for each (AU1 brief § 2) ──
  once({
    id: 'handle.dial',
    group: 'handle',
    answers: 'handle.worked: the belt dial, one detent',
    level: -7,
    length: [0.015, 0.08],
    draw: (sr, rnd) => knock(alloc(sr, 0.08), sr, rnd, [[2900, 0.6, 0.006], [4700, 0.35, 0.004], [1300, 0.3, 0.01]], { noiseF: 3800 }),
  }),
  once({
    id: 'handle.lever',
    group: 'handle',
    answers: 'handle.worked: the belt lever into a notch',
    level: -4,
    length: [0.04, 0.15],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.15);
      knock(out, sr, rnd, [[900, 0.7, 0.02], [1700, 0.45, 0.012], [3100, 0.3, 0.006]], { noiseF: 2400 });
      return thump(out, sr, rnd, { f: 180, tau: 0.025, amp: 0.5 });
    },
  }),
  once({
    id: 'undo.latch',
    group: 'undo',
    answers: 'handle.worked: the UNDO lever (the catch squeezed)',
    level: -7,
    length: [0.015, 0.08],
    draw: (sr, rnd) => knock(alloc(sr, 0.08), sr, rnd, [[3400, 0.5, 0.005], [2100, 0.6, 0.008]], { noiseF: 4200 }),
  }),
  once({
    id: 'undo.thunk',
    group: 'undo',
    answers: 'the UNDO lever reaches its stop (UndoLeverView phase pull to hold)',
    level: -2,
    length: [0.08, 0.3],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.3);
      thump(out, sr, rnd, { f: 140, tau: 0.05, noiseF: 1100 });
      return knock(out, sr, rnd, [[620, 0.5, 0.03], [1450, 0.3, 0.015]], { noiseF: 1800, noiseAmp: 0.3 });
    },
  }),
  once({
    id: 'undo.home',
    group: 'undo',
    answers: 'the UNDO lever springs home (phase return to rest)',
    level: -10,
    length: [0.02, 0.1],
    draw: (sr, rnd) => knock(alloc(sr, 0.1), sr, rnd, [[1100, 0.6, 0.012], [2300, 0.4, 0.008]], { noiseF: 2600 }),
  }),
  once({
    id: 'plug.out',
    group: 'handle',
    answers: 'cord.unplugged',
    level: -9,
    length: [0.02, 0.12],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.12);
      partial(out, sr, { f: 620, amp: 0.6, tau: 0.012, glide: 1.45, glideTime: 0.02, attack: 0.001 });
      return knock(out, sr, rnd, [[2200, 0.3, 0.004]], { noiseF: 2800, noiseAmp: 0.3 });
    },
  }),
  once({
    id: 'plug.seat',
    group: 'handle',
    answers: 'cord.plugged (the plug seating)',
    level: -4,
    length: [0.03, 0.15],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.15);
      knock(out, sr, rnd, [[2600, 0.5, 0.006], [1200, 0.4, 0.015]], { noiseF: 3000 });
      return thump(out, sr, rnd, { f: 220, tau: 0.025, amp: 0.45, at: 0.004 });
    },
  }),
  once({
    id: 'cover.snap',
    group: 'button',
    answers: 'handle.worked: the Button cover lifted or shut',
    level: -6,
    length: [0.02, 0.12],
    draw: (sr, rnd) => knock(alloc(sr, 0.12), sr, rnd, [[1800, 0.6, 0.01], [3900, 0.4, 0.005], [700, 0.3, 0.02]], { noiseF: 3000 }),
  }),
  once({
    id: 'lamp.creak',
    group: 'handle',
    answers: 'handle.worked: the lamp taken by its shade (the spring arm)',
    level: -12,
    length: [0.08, 0.3],
    draw: (sr, rnd) => {
      // a spring's short twang under a joint's friction
      const out = alloc(sr, 0.3);
      partial(out, sr, { f: 1480, amp: 0.4, tau: 0.06, beat: 9, attack: 0.012 });
      partial(out, sr, { f: 2210, amp: 0.2, tau: 0.04, attack: 0.008 });
      mixInto(out, burst(sr, 0.15, rnd, 'bandpass', 3200, 2, ad(0.02, 0.03)), 0.25);
      return out;
    },
  }),
  once({
    id: 'button.clunk',
    group: 'button',
    answers: 'button.pressed (a heavy clunk)',
    level: 0,
    length: [0.12, 0.45],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.45);
      thump(out, sr, rnd, { f: 96, tau: 0.08, noiseF: 900 });
      partial(out, sr, { f: 212, amp: 0.45, tau: 0.05, attack: 0.002 });
      knock(out, sr, rnd, [[480, 0.5, 0.04], [1250, 0.3, 0.02], [2600, 0.15, 0.008]], { noiseF: 1500, noiseAmp: 0.35 });
      // the spring under it, coming back a beat later
      knock(out, sr, rnd, [[1500, 0.15, 0.01]], { at: 0.13, noiseAmp: 0.1 });
      return out;
    },
  }),

  // ── the Button's rungs ──
  once({
    id: 'rung.flinch',
    group: 'button',
    answers: 'rung.beat flinch (the lamp dips, the belt lurches back)',
    level: -5,
    length: [0.15, 0.5],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.5);
      partial(out, sr, { f: 82, amp: 1, tau: 0.09, glide: 0.7, glideTime: 0.2, attack: 0.008 });
      partial(out, sr, { f: 164, amp: 0.4, tau: 0.06, glide: 0.7, glideTime: 0.2, attack: 0.006 });
      return knock(out, sr, rnd, [[640, 0.3, 0.02]], { at: 0.01, noiseF: 900, noiseAmp: 0.2 });
    },
  }),
  once({
    id: 'rung.hiccup',
    group: 'button',
    answers: 'rung.beat hiccup (a station misfires once)',
    level: -6,
    length: [0.12, 0.35],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.35);
      thump(out, sr, rnd, { f: 300, tau: 0.03, amp: 0.7 });
      thump(out, sr, rnd, { f: 250, tau: 0.035, amp: 0.55, at: 0.095 });
      return out;
    },
  }),
  once({
    id: 'rung.works',
    group: 'button',
    answers: 'rung.beat works (every used station misfires at once)',
    level: 0,
    length: [0.35, 0.8],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.8);
      let at = 0;
      for (let i = 0; i < 7; i++) {
        const f = 380 + rnd() * 1800;
        knock(out, sr, rnd, [[f, 0.6, 0.03], [f * 2.3, 0.3, 0.012]], { at, gain: 1 - i * 0.11, noiseF: 1500 + rnd() * 2000 });
        at += 0.035 + rnd() * 0.06;
      }
      return thump(out, sr, rnd, { f: 110, tau: 0.07, amp: 0.6 });
    },
  }),
  once({
    id: 'rung.sparks',
    group: 'button',
    answers: 'rung.beat sparks',
    level: -9,
    length: [0.3, 0.75],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.75);
      let t = 0;
      while (t < 0.6) {
        const g = Math.exp(-t / 0.25) * (0.4 + rnd() * 0.6);
        mixInto(out, burst(sr, 0.008, rnd, 'highpass', 4000 + rnd() * 3000, 0.7, ad(0.0002, 0.0008)), g, Math.round(t * sr));
        t += -Math.log(1 - rnd() * 0.999) / 70;
      }
      return out;
    },
  }),
  once({
    id: 'rung.warning',
    group: 'button',
    answers: 'rung.beat warning (a turning warning lamp, for its duration)',
    level: -12,
    length: [0.6, 5],
    variants: 1,
    param: { default: 4.6, min: 0.6, max: 5, step: 0.2 },
    draw: (sr, rnd, seconds) => {
      // the lamp's little motor and its beam sweeping past: a soft tone that swells 1.6 times a second
      const out = alloc(sr, seconds);
      partial(out, sr, { f: 523.25, amp: 0.5, tau: 1e9, attack: 0.05 });
      partial(out, sr, { f: 784, amp: 0.15, tau: 1e9, attack: 0.05 });
      mixInto(out, burst(sr, seconds, rnd, 'bandpass', 180, 3, () => 1), 0.2);
      return shape(out, sr, (t) => (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * 1.6 * t - Math.PI / 2), 2)) * Math.min(1, (seconds - t) / 0.15));
    },
  }),
  once({
    id: 'rung.shake',
    group: 'button',
    answers: 'rung.beat shake (the camera shakes)',
    level: -6,
    length: [0.4, 1],
    draw: (sr, rnd) => {
      const b = noise(Math.round(sr * 1), rnd);
      biquad(b, sr, 'lowpass', 140, 0.9);
      biquad(b, sr, 'lowpass', 220, 0.7);
      return shape(b, sr, ad(0.06, 0.22));
    },
  }),
  once({
    id: 'revert.hatch',
    group: 'crew',
    answers: 'rung.beat revert, and Revert rising: the hatch doors',
    level: -6,
    length: [0.1, 0.4],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.4);
      knock(out, sr, rnd, [[520, 0.6, 0.04], [1310, 0.4, 0.02], [2700, 0.2, 0.01]], { noiseF: 2200 });
      knock(out, sr, rnd, [[560, 0.5, 0.04], [1390, 0.3, 0.02], [2900, 0.2, 0.01]], { at: 0.085, gain: 0.8, noiseF: 2200 });
      return out;
    },
  }),

  // ── the line: the belt, the dock, the chute ──
  once({
    id: 'dock.open',
    group: 'dock',
    answers: 'door (open): the roll-up shutter',
    level: -9,
    length: [0.3, 0.7],
    variants: 2,
    draw: (sr, rnd) => shutter(sr, rnd, 0.4, false),
  }),
  once({
    id: 'dock.close',
    group: 'dock',
    answers: 'door (shut): the shutter comes down and lands',
    level: -8,
    length: [0.4, 0.8],
    variants: 2,
    draw: (sr, rnd) => shutter(sr, rnd, 0.55, true),
  }),
  {
    id: 'dock.bell',
    group: 'dock',
    answers: 'shipped (the bell: verb done)',
    level: 0,
    length: [1.5, 2.8],
    pitch: BELL_HZ,
    kind: 'once',
    // (R1) two strikes, so a ring by hand on the heels of a shipment is not the same samples a moment apart (a comb, a flange)
    variants: 2,
    draw: (sr, rnd) => bell(sr, rnd),
  },
  once({
    id: 'dock.beep',
    group: 'dock',
    answers: 'returned through the door (an undo: a reversing beep)',
    level: -10,
    length: [0.3, 0.6],
    variants: 1,
    pitch: 1046.5,
    draw: (sr) => {
      const out = alloc(sr, 0.6);
      for (const at of [0, 0.24]) {
        const one = alloc(sr, 0.13);
        partial(one, sr, { f: 1046.5, amp: 1, tau: 1e9, attack: 0.004 });
        partial(one, sr, { f: 3139.5, amp: 0.18, tau: 1e9, attack: 0.004 });
        shape(one, sr, (t) => Math.min(1, (0.13 - t) / 0.01));
        mixInto(out, one, 1, Math.round(at * sr));
      }
      return out;
    },
  }),
  once({
    id: 'chute.thump',
    group: 'line',
    answers: 'flap with a part (it comes back up the return chute: hollow)',
    level: -4,
    length: [0.12, 0.45],
    draw: (sr, rnd) => {
      // a pipe closed at one end: odd modes 1 : 3 : 5
      const out = alloc(sr, 0.45);
      partial(out, sr, { f: 150, amp: 1, tau: 0.09, attack: 0.002 });
      partial(out, sr, { f: 452, amp: 0.4, tau: 0.05, attack: 0.002 });
      partial(out, sr, { f: 757, amp: 0.2, tau: 0.03, attack: 0.002 });
      mixInto(out, burst(sr, 0.1, rnd, 'lowpass', 500, 0.7, ad(0.001, 0.02)), 0.5);
      return out;
    },
  }),
  once({
    id: 'chute.flap',
    group: 'line',
    answers: 'flap (the chute flap kicks; also its misfire)',
    level: -8,
    length: [0.06, 0.2],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.2);
      knock(out, sr, rnd, [[800, 0.6, 0.015], [1900, 0.4, 0.008]], { noiseF: 2200 });
      return knock(out, sr, rnd, [[820, 0.3, 0.012], [1950, 0.2, 0.006]], { at: 0.06, noiseF: 2200, noiseAmp: 0.15 });
    },
  }),

  // ── the phone ──
  once({
    id: 'phone.buzz',
    group: 'phone',
    answers: 'line.reply / line.refused (the phone buzzes)',
    level: -6,
    length: [0.3, 0.6],
    variants: 1,
    draw: (sr, rnd) => {
      // a vibration motor against a bench: 150 Hz, rich, two pulses
      const out = alloc(sr, 0.6);
      for (const at of [0, 0.27]) {
        const one = alloc(sr, 0.18);
        for (let h = 1; h <= 9; h += 1) partial(one, sr, { f: 150 * h + (rnd() - 0.5) * 2, amp: 1 / h, tau: 1e9, attack: 0.008, phase: rnd() * 6.28 });
        biquad(one, sr, 'lowpass', 1600, 0.8);
        biquad(one, sr, 'peak', 900, 2, 6);
        shape(one, sr, (t) => Math.min(1, t / 0.01, (0.18 - t) / 0.02));
        mixInto(out, one, 1, Math.round(at * sr));
      }
      return out;
    },
  }),
  once({
    id: 'phone.tick',
    group: 'phone',
    answers: 'line.sent (a soft tick: the text went)',
    level: -12,
    length: [0.02, 0.1],
    draw: (sr, rnd) => knock(alloc(sr, 0.1), sr, rnd, [[1800, 0.6, 0.012], [2700, 0.3, 0.006]], { noiseAmp: 0.1, jitter: 0.01 }),
  }),
  once({
    id: 'mailbox.flag',
    group: 'phone',
    answers: 'mailbox.flag (the flag goes up)',
    level: -10,
    length: [0.05, 0.25],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.25);
      partial(out, sr, { f: 900, amp: 0.4, tau: 0.03, glide: 1.6, glideTime: 0.05, attack: 0.004 });
      return knock(out, sr, rnd, [[1300, 0.5, 0.02], [2900, 0.25, 0.008]], { at: 0.05, noiseF: 2600 });
    },
  }),

  // ── the crew ──
  once({
    id: 'revert.ratchet',
    group: 'crew',
    answers: "Revert's crank, one pawl click per eighth of a turn (RevertView.crank)",
    level: -11,
    length: [0.01, 0.06],
    draw: (sr, rnd) => knock(alloc(sr, 0.06), sr, rnd, [[2400, 0.5, 0.004], [4100, 0.4, 0.003], [900, 0.3, 0.008]], { noiseF: 4500 }),
  }),
  once({
    id: 'crew.bonk',
    group: 'crew',
    answers: 'crew.knocked (Fetch: a comic bonk, scaled by strength)',
    level: 0,
    length: [0.15, 0.45],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.45);
      partial(out, sr, { f: 540, amp: 1, tau: 0.09, glide: 0.62, glideTime: 0.14, attack: 0.002 });
      partial(out, sr, { f: 1080, amp: 0.2, tau: 0.04, glide: 0.62, glideTime: 0.14, attack: 0.002 });
      knock(out, sr, rnd, [[1900, 0.4, 0.02], [3300, 0.2, 0.008]], { noiseF: 3000, noiseAmp: 0.3 });
      return thump(out, sr, rnd, { f: 150, tau: 0.035, amp: 0.4 });
    },
  }),
  once({
    id: 'patch.bonk',
    group: 'crew',
    answers: 'patch.reacted bonk (felt: a softer, lower bonk)',
    level: -4,
    length: [0.12, 0.45],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.45);
      partial(out, sr, { f: 392, amp: 1, tau: 0.08, glide: 0.66, glideTime: 0.13, attack: 0.004 });
      mixInto(out, burst(sr, 0.05, rnd, 'lowpass', 600, 0.7, ad(0.001, 0.01)), 0.5);
      return biquad(out, sr, 'lowpass', 2500, 0.7);
    },
  }),
  // (R1) the crew's small voices: Fetch is a servo (its wheel whines on G4), Patch is felt
  once({
    id: 'fetch.chirp',
    group: 'crew',
    answers: 'rung.started with Fetch on the bench (startled: a quick servo chirp up)',
    level: -9,
    length: [0.06, 0.2],
    variants: 2,
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.2);
      // G4 up toward D5 in 60 ms: the servo's harmonics, a little buzz, gone
      [1, 0.45, 0.25, 0.15].forEach((a, i) => partial(out, sr, { f: 392 * (i + 1), amp: a, tau: 0.035, glide: 1.5, glideTime: 0.06, attack: 0.004, phase: rnd() * 6.28 }));
      biquad(out, sr, 'lowpass', 3200, 0.7);
      return shape(out, sr, (t) => 0.8 + 0.2 * Math.sin(2 * Math.PI * 62 * t));
    },
  }),
  once({
    id: 'fetch.yelp',
    group: 'crew',
    answers: "crew.state held for Fetch (lifted: a servo squeak, up and back)",
    level: -8,
    length: [0.12, 0.3],
    variants: 2,
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.3);
      // two quick squeaks: up a fifth, then a higher one that drops; the gears' buzz under both
      [1, 0.4, 0.22].forEach((a, i) => partial(out, sr, { f: 392 * (i + 1), amp: a, tau: 0.04, glide: 1.5, glideTime: 0.05, attack: 0.003, phase: rnd() * 6.28 }));
      [1, 0.4, 0.22].forEach((a, i) => partial(out, sr, { f: 659.25 * (i + 1), amp: a * 0.8, tau: 0.05, delay: 0.075, glide: 0.8, glideTime: 0.08, attack: 0.003, phase: rnd() * 6.28 }));
      biquad(out, sr, 'lowpass', 3500, 0.7);
      return shape(out, sr, (t) => 0.75 + 0.25 * Math.sin(2 * Math.PI * 55 * t));
    },
  }),
  once({
    id: 'patch.yelp',
    group: 'crew',
    answers: 'crew.state held for Patch (lifted: a soft, small felt "mmp")',
    level: -11,
    length: [0.08, 0.3],
    variants: 2,
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.3);
      partial(out, sr, { f: 330, amp: 1, tau: 0.06, glide: 1.33, glideTime: 0.07, attack: 0.012 });
      partial(out, sr, { f: 660, amp: 0.15, tau: 0.03, glide: 1.33, glideTime: 0.07, attack: 0.01 });
      mixInto(out, burst(sr, 0.05, rnd, 'lowpass', 700, 0.7, ad(0.004, 0.01)), 0.3);
      return biquad(out, sr, 'lowpass', 1800, 0.7);
    },
  }),
  // ── R4: throwing ──
  once({
    id: 'throw.whoosh',
    group: 'crew',
    answers: 'part.released / patch.throw thrown at 4 u/s or more (the air it leaves through; length and pitch by speed)',
    level: -9,
    length: [0.1, 0.5],
    variants: 2,
    param: { default: 0.22, min: 0.12, max: 0.42, step: 0.02 },
    draw: (sr, rnd, seconds) => {
      // band noise sweeping down past the ear, a swell and a fall; quieter than any landing
      const b = noise(Math.round(sr * seconds), rnd);
      sweep(b, sr, 'bandpass', (t) => 2200 - 1300 * (t / seconds), 1.4);
      return shape(b, sr, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / seconds)), 1.6));
    },
  }),
  once({
    id: 'patch.fly',
    group: 'crew',
    answers: 'patch.throw thrown (the felt "mmp" drawn out: longer the harder it is thrown)',
    level: -11,
    length: [0.15, 0.6],
    variants: 2,
    param: { default: 0.25, min: 0.15, max: 0.55, step: 0.05 },
    draw: (sr, rnd, seconds) => {
      // the lift's soft voice, a held "wheee" in felt: up a fourth and held, a little wobble, low-passed
      const out = alloc(sr, seconds + 0.05);
      const n = Math.round(sr * seconds);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 330 * Math.pow(4 / 3, Math.min(1, t / 0.08)) * (1 + 0.02 * Math.sin(2 * Math.PI * 7 * t));
        ph += (2 * Math.PI * f) / sr;
        out[i] = Math.sin(ph) + 0.15 * Math.sin(2 * ph);
      }
      shape(out, sr, (t) => Math.min(1, t / 0.012) * Math.min(1, Math.max(0, (seconds - t) / 0.06)));
      mixInto(out, burst(sr, 0.05, rnd, 'lowpass', 700, 0.7, ad(0.004, 0.01)), 0.3);
      return biquad(out, sr, 'lowpass', 1800, 0.7);
    },
  }),
  once({
    id: 'patch.thud',
    group: 'crew',
    answers: 'patch.throw landed (a stuffed toy on wood: a soft felt thud, scaled by speed)',
    level: -6,
    length: [0.06, 0.3],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.3);
      thump(out, sr, rnd, { f: 140, tau: 0.035, noiseF: 500 });
      mixInto(out, burst(sr, 0.06, rnd, 'lowpass', 900, 0.7, ad(0.002, 0.012)), 0.4);
      return biquad(out, sr, 'lowpass', 1400, 0.7);
    },
  }),
  once({
    id: 'patch.pat',
    group: 'crew',
    answers: 'patch.throw hit with wall: true (flat against a wall: a pat)',
    level: -8,
    length: [0.03, 0.2],
    draw: (sr, rnd) => {
      // a flat soft slap: broad noise, very short, a little body under it
      const out = alloc(sr, 0.2);
      mixInto(out, burst(sr, 0.05, rnd, 'bandpass', 1300, 0.5, ad(0.0008, 0.007)), 1);
      thump(out, sr, rnd, { f: 190, tau: 0.02, amp: 0.4, noiseF: 600 });
      return biquad(out, sr, 'lowpass', 3500, 0.7);
    },
  }),
  once({
    id: 'patch.slide',
    group: 'crew',
    answers: 'Patch sliding down the wall (PatchView state wall, once it starts to move down): felt squeaking on paint',
    level: -12,
    length: [0.3, 0.6],
    variants: 2,
    draw: (sr, rnd) => {
      // a rubbery squeak in short stick-slip bursts, falling a little in pitch as it goes
      const out = alloc(sr, 0.55);
      const n = Math.round(sr * 0.5);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * (980 - 260 * (t / 0.5))) / sr;
        out[i] = Math.sin(ph) + 0.3 * Math.sin(2 * ph + 0.5);
      }
      const chops: number[] = [];
      for (let k = 0; k < 40; k++) chops.push(0.3 + 0.7 * rnd());
      shape(out, sr, (t) => {
        const x = t * 34;
        const i = Math.floor(x);
        return (chops[i] ?? 0) * Math.pow(Math.sin(Math.PI * (x - i)), 2) * Math.min(1, t / 0.03) * Math.max(0, Math.min(1, (0.5 - t) / 0.1));
      });
      return biquad(out, sr, 'lowpass', 3000, 0.7);
    },
  }),
  once({
    id: 'patch.bump',
    group: 'crew',
    answers: 'patch.throw hit (anything not a wall: a small soft bump)',
    level: -10,
    length: [0.04, 0.25],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.25);
      thump(out, sr, rnd, { f: 210, tau: 0.025, amp: 0.8, noiseF: 800 });
      return biquad(out, sr, 'lowpass', 2000, 0.7);
    },
  }),
  once({
    id: 'patch.fall',
    group: 'crew',
    answers: 'patch.throw gone (over the edge, well clear: its "mmp" trailing away downward)',
    level: -11,
    length: [0.4, 0.8],
    variants: 1,
    draw: (sr) => {
      const out = alloc(sr, 0.8);
      const n = Math.round(sr * 0.7);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * 440 * Math.pow(0.5, t / 0.7)) / sr;
        out[i] = Math.sin(ph) + 0.15 * Math.sin(2 * ph);
      }
      shape(out, sr, (t) => Math.min(1, t / 0.015) * Math.exp(-t / 0.22));
      return biquad(out, sr, 'lowpass', 1800, 0.7);
    },
  }),
  once({
    id: 'patch.rise',
    group: 'crew',
    answers: 'patch.throw chute (shot back up the chute: the "mmp" coming back up, under the launch)',
    level: -11,
    length: [0.3, 0.7],
    variants: 1,
    draw: (sr) => {
      const out = alloc(sr, 0.7);
      const n = Math.round(sr * 0.55);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * 262 * Math.pow(2, Math.min(1, t / 0.4))) / sr;
        out[i] = Math.sin(ph) + 0.15 * Math.sin(2 * ph);
      }
      shape(out, sr, (t) => Math.min(1, t / 0.08) * Math.max(0, Math.min(1, (0.55 - t) / 0.15)));
      return biquad(out, sr, 'lowpass', 1800, 0.7);
    },
  }),
  once({
    id: 'fetch.whirr',
    group: 'crew',
    answers: "crew.state fetch held to shrug (let go: it rights itself): a little servo whirr, up and settling",
    level: -11,
    length: [0.2, 0.5],
    variants: 2,
    draw: (sr, rnd) => {
      // its wheel's servo voice (G4) run up hard and back, with the gears' buzz
      const out = alloc(sr, 0.5);
      const n = Math.round(sr * 0.4);
      const ph = [0, 0, 0, 0].map(() => rnd() * 6.28);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 392 * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, t / 0.4)));
        for (let h = 0; h < 4; h++) {
          ph[h]! += (2 * Math.PI * f * (h + 1)) / sr;
          out[i]! += Math.sin(ph[h]!) * [1, 0.45, 0.25, 0.15][h]!;
        }
      }
      shape(out, sr, (t) => Math.min(1, t / 0.03) * Math.max(0, Math.min(1, (0.4 - t) / 0.08)) * (0.78 + 0.22 * Math.sin(2 * Math.PI * 58 * t)));
      return biquad(out, sr, 'lowpass', 3200, 0.7);
    },
  }),
  once({
    id: 'revert.knock',
    group: 'crew',
    answers: 'Revert knocking from under its covered hatch (RevertView.knock, each jump of the leaves): a hollow wooden knock',
    level: -6,
    length: [0.08, 0.35],
    variants: 2,
    draw: (sr, rnd) => {
      // knuckles on a wooden leaf over a hollow: a wood knock and the box's low ring
      const out = alloc(sr, 0.35);
      knock(out, sr, rnd, [[420, 0.7, 0.03], [980, 0.4, 0.015], [1900, 0.2, 0.006]], { noiseF: 1400, noiseAmp: 0.4 });
      partial(out, sr, { f: 140, amp: 0.6, tau: 0.07, attack: 0.002 });
      return biquad(out, sr, 'lowpass', 3000, 0.7);
    },
  }),
  once({
    id: 'jet.pop',
    group: 'crew',
    answers: "jet.ignited (Fetch's jets catch: a small pop)",
    level: -10,
    length: [0.04, 0.2],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.2);
      partial(out, sr, { f: 260, amp: 0.7, tau: 0.018, glide: 1.6, glideTime: 0.03, attack: 0.001 });
      mixInto(out, burst(sr, 0.08, rnd, 'bandpass', 1400, 0.8, ad(0.0008, 0.012)), 0.8);
      return out;
    },
  }),
  once({
    id: 'jet.puff',
    group: 'crew',
    answers: 'jet.cut (the jets cut: a little puff)',
    level: -12,
    length: [0.06, 0.25],
    draw: (sr, rnd) => {
      const b = noise(Math.round(sr * 0.22), rnd);
      sweep(b, sr, 'bandpass', (t) => 2400 - 1600 * Math.min(1, t / 0.12), 0.9);
      return shape(b, sr, ad(0.008, 0.035));
    },
  }),
  once({
    id: 'chute.launch',
    group: 'line',
    answers: 'restock.launched (a fresh crate thrown out of the chute: a pneumatic thump and a whoosh)',
    level: -6,
    length: [0.25, 0.6],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.6);
      // the piston: a hollow low thump (the chute's own odd modes, shorter)
      partial(out, sr, { f: 150, amp: 0.8, tau: 0.05, attack: 0.002 });
      partial(out, sr, { f: 452, amp: 0.3, tau: 0.03, attack: 0.002 });
      // the air: a band of noise that opens and falls away
      const air = noise(Math.round(sr * 0.5), rnd);
      sweep(air, sr, 'bandpass', (t) => 900 + 1800 * Math.exp(-t / 0.08), 1.1);
      shape(air, sr, (t) => (t < 0.015 ? t / 0.015 : Math.exp(-(t - 0.015) / 0.09)));
      mixInto(out, air, 0.7);
      return out;
    },
  }),
  once({
    id: 'crew.catch',
    group: 'crew',
    answers: 'patch.reacted catch; crew.nudged (a soft thud)',
    level: -11,
    length: [0.04, 0.25],
    draw: (sr, rnd) => thump(alloc(sr, 0.25), sr, rnd, { f: 160, tau: 0.03, noiseF: 700 }),
  }),
  once({
    id: 'revert.sweep',
    group: 'crew',
    answers: 'revert.sweep (the brush and the dustpan)',
    level: -12,
    length: [0.25, 0.55],
    draw: (sr, rnd) => {
      const b = noise(Math.round(sr * 0.55), rnd);
      sweep(b, sr, 'bandpass', (t) => 2000 + 1500 * Math.sin(t * 9), 0.8);
      return shape(b, sr, (t) => Math.sin(Math.PI * Math.min(1, t / 0.42)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 2 * Math.PI * 11))) * (t < 0.42 ? 1 : 0));
    },
  }),

  // ── undo ──
  once({
    id: 'tape.rewind',
    group: 'undo',
    answers: 'undone (length follows how much was undone); rung rewind; reset',
    level: -6,
    length: [0.3, 2.6],
    variants: 1,
    param: { default: 0.6, min: 0.3, max: 2.5, step: 0.05 },
    draw: (sr, rnd, seconds) => tape(sr, rnd, seconds),
  }),

  // ── small things ──
  once({
    id: 'tell.tick',
    group: 'misc',
    answers: "tell (an idle hint: a station's faint tick)",
    level: -18,
    length: [0.01, 0.06],
    draw: (sr, rnd) => knock(alloc(sr, 0.06), sr, rnd, [[3000, 0.5, 0.004], [1700, 0.3, 0.006]], { noiseAmp: 0.15 }),
  }),
  once({
    id: 'relay.tick',
    group: 'misc',
    answers: 'jack.answered; a misfire with no sound of its own (a relay)',
    level: -12,
    length: [0.02, 0.08],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.08);
      knock(out, sr, rnd, [[2200, 0.5, 0.004], [5200, 0.3, 0.002]], { noiseF: 5000 });
      return knock(out, sr, rnd, [[2300, 0.35, 0.004]], { at: 0.012, noiseF: 5000, noiseAmp: 0.2 });
    },
  }),
  once({
    id: 'card.slip',
    group: 'misc',
    answers: 'card (a slip or a card comes out)',
    level: -12,
    length: [0.05, 0.2],
    draw: (sr, rnd) => {
      const out = alloc(sr, 0.2);
      mixInto(out, burst(sr, 0.05, rnd, 'bandpass', 3600, 1.2, ad(0.002, 0.01)), 1);
      mixInto(out, burst(sr, 0.05, rnd, 'bandpass', 3000, 1.2, ad(0.002, 0.012)), 0.7, Math.round(0.045 * sr));
      return out;
    },
  }),

  // ── loops: level and rate set every frame by the score ──
  {
    id: 'loop.hum',
    group: 'loop',
    answers: "the belt running (BeltView.surface: rate by speed, silent when it stops)",
    level: -22,
    length: [1.9, 2.1],
    pitch: HUM_HZ,
    kind: 'loop',
    variants: 1,
    draw: (sr, rnd) => {
      // 2 s; every component a whole number of cycles in it, the noise cross-faded at the seam
      const out = alloc(sr, 2.1);
      [1, 0.5, 0.3, 0.2, 0.12, 0.06].forEach((a, i) => partial(out, sr, { f: HUM_HZ * (i + 1), amp: a, tau: 1e9, phase: rnd() * 6.28 }));
      mixInto(out, burst(sr, 2.1, rnd, 'bandpass', 1800, 1, () => 1), 0.18);
      shape(out, sr, (t) => 0.85 + 0.15 * Math.sin(2 * Math.PI * 3 * t));
      return seamless(out, sr, 0.1);
    },
  },
  {
    id: 'loop.treads',
    group: 'loop',
    answers: "Revert trundling (RevertView.speed: rate by speed)",
    level: -20,
    length: [0.9, 1.1],
    pitch: null,
    kind: 'loop',
    variants: 1,
    draw: (sr, rnd) => {
      const out = alloc(sr, 1.05);
      [1, 0.4, 0.2].forEach((a, i) => partial(out, sr, { f: 75 * (i + 1), amp: a * 0.6, tau: 1e9, phase: rnd() * 6.28 }));
      for (let i = 0; i <= 12; i++) knock(out, sr, rnd, [[620, 0.5, 0.01], [1400, 0.3, 0.006]], { at: i / 12, gain: 0.8 + rnd() * 0.4, noiseF: 1800, jitter: 0.06 });
      return seamless(out, sr, 0.05);
    },
  },
  {
    id: 'loop.jet',
    group: 'loop',
    answers: "Fetch's jetpack burning (from jet.ignited to jet.cut; level and brightness follow CrewMember.jet.thrust)",
    level: -14,
    length: [0.9, 1.1],
    pitch: null,
    kind: 'loop',
    variants: 1,
    draw: (sr, rnd) => {
      // a toy's jet, not a rocket: a soft breathy hiss with a little flutter, a faint low breath under it
      const out = alloc(sr, 1.05);
      const hiss = noise(out.length, rnd);
      biquad(hiss, sr, 'bandpass', 2600, 0.7);
      biquad(hiss, sr, 'lowpass', 6000, 0.7);
      mixInto(out, hiss, 1);
      const low = noise(out.length, rnd);
      biquad(low, sr, 'lowpass', 260, 0.7);
      mixInto(out, low, 0.6);
      shape(out, sr, (t) => 0.85 + 0.15 * Math.sin(2 * Math.PI * 24 * t));
      return seamless(out, sr, 0.05);
    },
  },
  {
    id: 'loop.wheel',
    group: 'loop',
    answers: "Fetch rolling (its speed: rate by speed); a servo whine on G4, in the line's key",
    level: -22,
    length: [0.9, 1.1],
    pitch: 392,
    kind: 'loop',
    variants: 1,
    draw: (sr, rnd) => {
      const out = alloc(sr, 1.05);
      [1, 0.5, 0.33, 0.25, 0.2, 0.16].forEach((a, i) => partial(out, sr, { f: 392 * (i + 1), amp: a, tau: 1e9, phase: rnd() * 6.28 }));
      biquad(out, sr, 'lowpass', 2200, 0.7);
      shape(out, sr, (t) => 0.75 + 0.25 * Math.sin(2 * Math.PI * 31 * t));
      return seamless(out, sr, 0.05);
    },
  },
];

/** The dock's roll-up shutter: slats ticking past, faster then slower, and a landing when it shuts. */
function shutter(sr: number, rnd: () => number, travel: number, lands: boolean): Buf {
  const out = alloc(sr, travel + 0.25);
  let t = 0.005;
  while (t < travel) {
    const u = t / travel;
    knock(out, sr, rnd, [[1700, 0.4, 0.006], [3200, 0.25, 0.004]], { at: t, gain: 0.5 + 0.5 * Math.sin(Math.PI * u), noiseF: 2600, jitter: 0.08 });
    t += 0.022 + 0.03 * Math.abs(u - 0.5);
  }
  mixInto(out, burst(sr, travel, rnd, 'lowpass', 300, 0.7, (x) => Math.sin(Math.PI * Math.min(1, x / travel))), 0.4);
  if (lands) thump(out, sr, rnd, { f: 160, tau: 0.04, amp: 1.2, at: travel });
  else knock(out, sr, rnd, [[900, 0.4, 0.02]], { at: travel, noiseF: 1500 });
  return out;
}

/**
 * A small brass bell (AU1 brief § 2: a bright strike with a long beating tail). A bell's partials
 * against its strike note (the nominal, G5): hum, prime, tierce (the minor third), quint, nominal,
 * superquint, octave nominal; each a split pair a fraction of a hertz apart, so the tail beats slowly.
 */
function bell(sr: number, rnd: () => number): Buf {
  const out = alloc(sr, 2.8);
  const n = BELL_HZ;
  const parts: readonly [ratio: number, amp: number, tau: number, beat: number][] = [
    [0.25, 0.12, 0.9, 0.3],
    [0.5, 0.35, 0.8, 0.45],
    [0.6, 0.3, 0.55, 0.9],
    [0.75, 0.12, 0.45, 0.6],
    [1, 1, 0.42, 1.3],
    [1.5, 0.35, 0.18, 2.1],
    [2, 0.28, 0.1, 2.9],
    [2.6, 0.12, 0.06, 3.6],
  ];
  for (const [r, a, tau, beat] of parts) partial(out, sr, { f: n * r - beat / 2, beat, amp: a, tau, phase: rnd() * 6.28, attack: 0.0006 });
  // the clapper's strike
  mixInto(out, burst(sr, 0.02, rnd, 'highpass', 3500, 0.7, ad(0.0003, 0.0015)), 0.35);
  return out;
}

/**
 * Tape running backwards (§ B1 "undone: a tape-rewind sound"): the reels spin up, the tape squeals
 * and chatters past the head with a wavering pitch, and the transport stops with a clunk. `seconds`
 * is how long it runs.
 */
function tape(sr: number, rnd: () => number, seconds: number): Buf {
  const out = alloc(sr, seconds + 0.1);
  const up = Math.min(0.12, seconds * 0.3);
  const down = Math.min(0.1, seconds * 0.2);
  const wowF = 6 + rnd() * 2;
  const pitch = (t: number): number => {
    const base = t < up ? 260 + (1150 - 260) * Math.sin((Math.PI / 2) * (t / up)) : t > seconds - down ? 1150 - (1150 - 380) * Math.min(1, (t - (seconds - down)) / down) : 1150;
    return base * (1 + 0.035 * Math.sin(2 * Math.PI * wowF * t));
  };
  // the squeal: a few harmonics following the reels
  const n = Math.round(seconds * sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * pitch(t)) / sr;
    out[i]! += 0.5 * Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.4) + 0.1 * Math.sin(3 * ph + 1.1);
  }
  // the chatter of what was recorded, going past backwards: band noise following the pitch, cut up
  const hiss = noise(n, rnd);
  sweep(hiss, sr, 'bandpass', (t) => pitch(t) * 2.2, 2.5);
  const chop: number[] = [];
  for (let k = 0; k < Math.ceil(seconds * 30) + 2; k++) chop.push(rnd());
  shape(hiss, sr, (t) => {
    const x = t * 30;
    const i = Math.floor(x);
    const f = x - i;
    return 0.35 + 0.65 * ((chop[i] ?? 0) * (1 - f) + (chop[i + 1] ?? 0) * f);
  });
  mixInto(out, hiss, 0.9);
  shape(out, sr, (t) => Math.min(1, t / 0.03) * (t > seconds ? 0 : Math.min(1, (seconds - t) / 0.03)));
  // the transport: a click on, a clunk off
  knock(out, sr, rnd, [[1600, 0.35, 0.006], [3100, 0.2, 0.003]], { noiseAmp: 0.2 });
  thump(out, sr, rnd, { f: 300, tau: 0.02, amp: 0.3, at: Math.max(0, seconds - 0.01) });
  return out;
}

/** Every sound the workshop makes, by id. */
export const SOUNDS: readonly SoundDef[] = [...NOTES, ...OTHERS];
export const SOUND: ReadonlyMap<string, SoundDef> = new Map(SOUNDS.map((s) => [s.id, s]));

export function soundDef(id: string): SoundDef {
  const d = SOUND.get(id);
  if (!d) throw new Error(`no sound ${id}`);
  return d;
}
