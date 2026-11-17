/**
 * The shared animation toolkit (W4 § A): small pieces for motion that is
 * "mechanical and weighted: things anticipate, overshoot a little and
 * settle" (REWRITE.md § A "Motion"). Every piece runs on the time or dt it
 * is handed (simulation time, `frame.time` / `frame.dt`), never a clock of
 * its own, so captures are deterministic and a frozen world stays frozen.
 *
 * - springs (`Spring`, `AngleSpring`, `SpringVec`, `springStep`): overshoot and settle;
 * - followers (`damp`, `dampAngle`, `approach`, `Derivative`): lag without bounce, measured rates;
 * - one-shots keyed off events (`OneShot`, `Envelope`);
 * - a tiny timeline (`Track`, `Timeline`, `track`) for beats that land on moments;
 * - easing (`outBack`, `inOutCubic`, `bump`, ...) and numeric helpers;
 * - seeded noise and cadences (`noise1`, `fbm1`, `Cadence`) for blinks, glances, balance.
 *
 * Reduced motion is honoured by the caller in one place: respond to events,
 * but do not run idles, sways or loops (skip `Cadence` and noise), and use
 * critically damped springs (`reducedMotionParams`).
 */
export * from './spring.ts';
export * from './ease.ts';
export * from './follow.ts';
export * from './oneshot.ts';
export * from './timeline.ts';
export * from './noise.ts';

import type { SpringParams } from './spring.ts';

/** The same stiffness without the bounce: a spring for reduced motion. */
export function reducedMotionParams(p: SpringParams): SpringParams {
  return { omega: p.omega, zeta: Math.max(1, p.zeta) };
}
