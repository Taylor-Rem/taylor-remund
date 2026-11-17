/**
 * A tiny timeline: keyed values over time, eased between keys. For a beat
 * that must land on particular moments (a salute: look at the empty hands,
 * snap the claw up, hold, drop). Sample it with the seconds since the beat
 * began; it holds its first value before the first key and its last after.
 */
import { type Ease, inOutQuad, lerp } from './ease.ts';

/** [time, value] or [time, value, ease into this key]. */
export type Key = readonly [t: number, v: number, ease?: Ease];

export class Track {
  readonly keys: readonly Key[];

  constructor(keys: readonly Key[], readonly ease: Ease = inOutQuad) {
    if (keys.length === 0) throw new Error('Track: no keys');
    for (let i = 1; i < keys.length; i++) if (keys[i]![0] < keys[i - 1]![0]) throw new Error('Track: keys out of order');
    this.keys = keys;
  }

  get duration(): number {
    return this.keys[this.keys.length - 1]![0];
  }

  sample(t: number): number {
    const k = this.keys;
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) {
      const b = k[i]!;
      if (t <= b[0]) {
        const a = k[i - 1]!;
        const span = b[0] - a[0];
        const u = span <= 0 ? 1 : (t - a[0]) / span;
        return lerp(a[1], b[1], (b[2] ?? this.ease)(u));
      }
    }
    return k[k.length - 1]![1];
  }
}

/** Several named tracks sampled together: a beat. */
export class Timeline<K extends string> {
  constructor(readonly tracks: Readonly<Record<K, Track>>) {}

  get duration(): number {
    let d = 0;
    for (const k in this.tracks) d = Math.max(d, this.tracks[k].duration);
    return d;
  }

  sample(t: number): Record<K, number> {
    const out = {} as Record<K, number>;
    for (const k in this.tracks) out[k] = this.tracks[k].sample(t);
    return out;
  }
}

/** Shorthand: `track([0, 0], [0.2, 1, outBack()])`. */
export const track = (...keys: Key[]): Track => new Track(keys);
