/**
 * Stepping down during a visit (REWRITE.md § E7: "If frame time worsens
 * during a visit the stage steps down by itself: resolution first, then
 * shadows, then part count"; § B10; P3 B1). Pure: it is fed the time of each
 * drawn frame and answers, now and then, with one step down.
 *
 *   resolution   the pixel ratio in steps (× 0.75 each) down to a floor;
 *   low          then the low tier: no cast shadows (soft blobs instead),
 *                no post chain, pixel ratio 1 (the stage is built again on
 *                the same world: shell/loader.ts `restage`);
 *   (on low)     resolution again, down to the floor;
 *   parts        then the part count: a named seam. The whole bench holds
 *                fewer loose bodies than the low tier's 30
 *                (tests/unit/shell/governor.test.ts holds it), so there is
 *                nothing to cut; the step is answered and nothing is done.
 *
 * It never flaps: nothing ever steps back up within a visit. And one bad
 * second is not a trend: a step needs `patience` slow judgements in a row
 * (one a second, each over the last two seconds' median), frames longer
 * than `maxFrameMs` are not frame times at all (a tab switch, a debugger),
 * and after every step, after the start and after a pause (the tab hidden,
 * the paperwork read) nothing is judged for `settleMs`.
 *
 * The probe (§ E7 "Low: the probe fails"): the first judgement after the
 * start, over the frames from `probe.fromMs` to `probe.untilMs`, steps
 * straight to the low tier if their median is over `probe.slowMs`. It costs
 * the bench no time before it is usable: it is the first real frames.
 */

export interface GovernorTuning {
  /** The rolling window judged (ms of frames). */
  windowMs: number;
  /** How often it judges (ms). */
  everyMs: number;
  /** A judgement is slow when the window's median frame is over this (ms). */
  slowMs: number;
  /** Slow judgements in a row that make a trend. */
  patience: number;
  /** Nothing is judged this long after the start, a step or a pause (ms). */
  settleMs: number;
  /** A frame longer than this is not a frame time (ms). */
  maxFrameMs: number;
  /** The first frames after the handoff, judged once: a median over `slowMs` means the low tier. */
  probe: { fromMs: number; untilMs: number; slowMs: number; minFrames: number };
  /** Each resolution step multiplies the pixel ratio by this. */
  factor: number;
  /** The pixel ratio never goes under this. */
  floor: number;
}

export const GOVERNOR_TUNING: GovernorTuning = {
  windowMs: 2000,
  everyMs: 1000,
  // 60 Hz is 16.7 ms a frame: a median over 24 ms is under about 42 frames a second
  slowMs: 24,
  patience: 3,
  settleMs: 2000,
  maxFrameMs: 250,
  // under about 30 frames a second over the first second and a half after the swap
  probe: { fromMs: 400, untilMs: 2000, slowMs: 33, minFrames: 20 },
  factor: 0.75,
  floor: 0.75,
};

export type GovernorTier = 'high' | 'low';

export type GovernorStep =
  | { kind: 'resolution'; ratio: number; why: 'trend' }
  | { kind: 'low'; why: 'probe' | 'trend' }
  | { kind: 'parts'; why: 'trend' };

export interface GovernorState {
  tier: GovernorTier;
  /** The pixel ratio now (device ratio, capped by the tier, times the resolution scale). */
  ratio: number;
  /** Nothing left to step down to. */
  done: boolean;
}

interface Sample {
  t: number;
  ms: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};

/** The next resolution step from `ratio`, or null at the floor. */
export function nextRatio(ratio: number, t: Pick<GovernorTuning, 'factor' | 'floor'> = GOVERNOR_TUNING): number | null {
  if (ratio <= t.floor + 1e-6) return null;
  return Math.max(t.floor, Math.round(ratio * t.factor * 1000) / 1000);
}

export class Governor {
  private readonly t: GovernorTuning;
  private readonly samples: Sample[] = [];
  private tierNow: GovernorTier;
  private ratioNow: number;
  /** The pixel ratio the low tier starts at (its cap, 1, or less on a screen under 1). */
  private readonly lowRatio: number;
  private start: number | null = null;
  private quietUntil = 0;
  private nextJudge = 0;
  private slowRun = 0;
  private probed: boolean;
  private partsDone = false;

  /**
   * `ratio`: the pixel ratio the stage starts at (the device's, capped by the tier: 2 on high, 1 on low).
   * `lowRatio`: what the low tier starts at (min(device ratio, 1)). `probe`: false skips the probe (a
   * stage already on the low tier, or rebuilt on it).
   */
  constructor(o: { tier: GovernorTier; ratio: number; lowRatio: number; probe?: boolean }, tuning: GovernorTuning = GOVERNOR_TUNING) {
    this.t = tuning;
    this.tierNow = o.tier;
    this.ratioNow = o.ratio;
    this.lowRatio = o.lowRatio;
    this.probed = !(o.probe ?? o.tier === 'high');
  }

  get state(): GovernorState {
    return { tier: this.tierNow, ratio: this.ratioNow, done: this.tierNow === 'low' && nextRatio(this.ratioNow, this.t) === null && this.partsDone };
  }

  /** The tab was hidden, the paperwork read, the stage rebuilt: forget the window and settle again from `now`. */
  pause(now: number): void {
    this.samples.length = 0;
    this.slowRun = 0;
    this.quietUntil = now + this.t.settleMs;
    this.nextJudge = this.quietUntil + this.t.windowMs;
  }

  /** One drawn frame: `ms` since the last, at `now` (ms). Returns a step to take, or null. */
  frame(ms: number, now: number): GovernorStep | null {
    if (this.start === null) {
      this.start = now;
      this.quietUntil = now + (this.probed ? this.t.settleMs : this.t.probe.fromMs);
      this.nextJudge = this.probed ? this.quietUntil + this.t.windowMs : now + this.t.probe.untilMs;
    }
    if (now < this.quietUntil) return null;
    if (!(ms > 0) || ms > this.t.maxFrameMs) return null;
    this.samples.push({ t: now, ms });
    if (now < this.nextJudge) return null;

    if (!this.probed) {
      // the probe: the first frames after the handoff, judged once
      this.probed = true;
      const xs = this.samples.map((s) => s.ms);
      this.samples.length = 0;
      this.nextJudge = now + this.t.windowMs;
      if (xs.length >= this.t.probe.minFrames && median(xs) > this.t.probe.slowMs && this.tierNow === 'high') return this.stepLow('probe', now);
      return null;
    }

    while (this.samples.length && this.samples[0]!.t < now - this.t.windowMs) this.samples.shift();
    this.nextJudge = now + this.t.everyMs;
    const slow = median(this.samples.map((s) => s.ms)) > this.t.slowMs;
    this.slowRun = slow ? this.slowRun + 1 : 0;
    if (this.slowRun < this.t.patience) return null;
    return this.stepDown(now);
  }

  /** Nothing judged for `settleMs`, then a full window gathered before the first judgement. */
  private settle(now: number): void {
    this.samples.length = 0;
    this.slowRun = 0;
    this.quietUntil = now + this.t.settleMs;
    this.nextJudge = this.quietUntil + this.t.windowMs;
  }

  private stepLow(why: 'probe' | 'trend', now: number): GovernorStep {
    this.tierNow = 'low';
    // never sharper than it was: the low tier's own cap, or the resolution already stepped down to
    this.ratioNow = Math.min(this.lowRatio, this.ratioNow);
    this.settle(now);
    return { kind: 'low', why };
  }

  private stepDown(now: number): GovernorStep | null {
    const r = nextRatio(this.ratioNow, this.t);
    if (r !== null) {
      this.ratioNow = r;
      this.settle(now);
      return { kind: 'resolution', ratio: r, why: 'trend' };
    }
    if (this.tierNow === 'high') return this.stepLow('trend', now);
    if (!this.partsDone) {
      this.partsDone = true;
      this.settle(now);
      return { kind: 'parts', why: 'trend' };
    }
    // nothing left: stop judging
    this.settle(now);
    this.quietUntil = Infinity;
    return null;
  }
}
