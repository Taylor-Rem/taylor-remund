/**
 * Stand-ins for what the showcase stands on, until the real `bench` piece is
 * registered (then mount.ts uses that instead): a plank bench top (wood,
 * `large` variant, planks along X, top at y = 0) with a thick apron, and a
 * slice of back wall in dark horizontal boards. Built from kit solids only.
 */
import type { Piece } from '../kit/types.ts';
import { roundedBox } from '../kit/solids.ts';
import { part, piece, T } from '../kit/compose.ts';
import { transform } from '../kit/deform.ts';
import { rng } from '../kit/rng.ts';

export interface GroundOptions {
  width?: number;
  depth?: number;
  seed?: number;
}

/** A plank bench top, 20 x 10 by default, its top at y = 0 and its front edge at z = depth / 2. */
export function benchStandIn(o: GroundOptions = {}): Piece {
  const W = o.width ?? 20;
  const D = o.depth ?? 10;
  const R = rng(o.seed ?? 7);
  const b = piece('bench-standin', { ao: false });
  const n = Math.max(1, Math.round(D / 1.25));
  const pd = D / n;
  const t = 0.42;
  for (let i = 0; i < n; i++) {
    const z = -D / 2 + pd * (i + 0.5);
    const front = i === n - 1;
    const g = roundedBox({ w: W, h: t, d: pd - 0.022, r: 0.03, rTop: front ? 0.12 : 0.03, segs: 4 });
    // planks are not all quite level or quite the same board
    const lift = R.spread(0.004);
    b.add({ ...part('wood', transform(g, T(0, -t + lift, z)), 'wood', { seed: R.int(0, 9999), jitter: 0.09, warm: 0.04 }), variant: 'large' as const });
  }
  // the apron under the front edge
  const apron = roundedBox({ w: W - 0.4, h: 0.8, d: 0.3, r: 0.05 });
  b.add({ ...part('wood', transform(apron, T(0, -t - 0.8, D / 2 - 0.2)), 'wood', { seed: 3, shade: 0.72 }), variant: 'large' as const });
  return b.build();
}

/** A slice of back wall: dark horizontal boards standing at z = `at`, from the bench up. */
export function wallStandIn(o: GroundOptions & { height?: number; at?: number } = {}): Piece {
  const W = o.width ?? 20;
  const H = o.height ?? 6.5;
  const z = o.at ?? -5;
  const R = rng(o.seed ?? 11);
  const b = piece('wall-standin', { ao: false });
  const bh = 0.62;
  const n = Math.ceil(H / bh);
  for (let i = 0; i < n; i++) {
    const g = roundedBox({ w: W, h: bh - 0.025, d: 0.16, r: 0.025, segs: 3 });
    b.add({ ...part('wood', transform(g, T(R.spread(0.3), i * bh - 0.42, z - 0.16 + R.spread(0.006))), 'wood', { seed: R.int(0, 9999), jitter: 0.12, shade: 0.42 }), variant: 'large' as const });
  }
  return b.build();
}
