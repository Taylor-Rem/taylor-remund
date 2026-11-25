/**
 * P4 S6, a prototype behind one switch: the opening stand (sim/machines/opening-stand.ts). A low steel table in the
 * bench's family: a painted steel skirt, a deck of three oak boards a crate is set down on, brass corner
 * stops, a brass lifter lying flat on the deck from a hinge at its back edge (node `lifter`: it swings up about its local X as a
 * crate on the stand opens, the lid riding on it), bolts along the skirt. `h` is its height (the deck's top, the
 * collider's top): 0.22 on the bench, lower on the console. Socket `label`: the middle of the front skirt.
 *
 * Every colour a palette token; every mesh from the kit.
 */
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { taperBox } from '../../solids.ts';
import { bevelBox } from '../../cheap.ts';
import { hexBolt } from '../../details.ts';
import { aim, mat, part, piece, place, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { standStation } from './station.ts';

export interface OpeningStandOptions extends KitOptions {
  /** Height of the deck's top over the floor (default 0.22). */
  h?: number;
  /** Half extents of the deck (default 0.52 × 0.48: the large crate with room). */
  half?: readonly [number, number];
}

/** The lifter's arm, from its hinge to its pad (world units). */
export const ARM = 0.3;

export function openingStand(o: OpeningStandOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed * 31 + 7);
  const b = piece('opening-stand', { detail, seed });
  const H = o.h ?? 0.22;
  const [hx, hz] = o.half ?? [0.52, 0.48];
  const W = hx * 2, D = hz * 2;
  const deckT = Math.min(0.03, H * 0.3);
  const foot = 0;
  const skirtH = Math.max(0.02, H - deckT - foot);

  // ---- large: feet, skirt, deck ----
  b.add(part('steel', transform(taperBox({ w: W - 0.04, h: skirtH, d: D - 0.04, rPlan: 0.05, rTop: 0.012, rBottom: 0.02, topW: W - 0.02, topD: D - 0.02, segs: 2, detail }), T(0, foot, 0)), 'teal-panel', { seed, jitter: 0.05 }));
  // the deck: three oak boards, a hair apart, one a little proud
  const boards = 3;
  const bw = (D - 0.02) / boards;
  for (let i = 0; i < boards; i++) {
    const z = -D / 2 + 0.01 + bw * (i + 0.5);
    const lift = i === 1 ? 0.0015 : 0;
    const x0 = R.spread(0.004);
    b.add(part('wood', bevelBox({ min: [x0 - W / 2, H - deckT + lift, z - bw / 2 + 0.004], max: [x0 + W / 2, H + lift, z + bw / 2 - 0.004], c: 0.003, omit: ['ny'], wear: 0.6 }), 'wood', { seed: seed + 1 + i, jitter: 0.08 }));
  }

  // ---- medium: brass corner stops, the lifter on its hinge ----
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const cx = sx * (hx - 0.035), cz = sz * (hz - 0.035);
    b.add(part('brass', bevelBox({ min: [cx - 0.035, H, cz - 0.035], max: [cx + 0.035, H + 0.03, cz + 0.035], c: 0.006, omit: ['ny'], wear: 1 }), 'brass', { seed: seed + 10 + sx + sz * 3, shade: 0.9 }));
  }
  // its hinge: two brass cheeks on the deck's back edge and the pin through the arm's foot
  for (const sx of [-1, 1]) b.add(part('brass', bevelBox({ min: [sx * 0.04 - 0.01, H, -hz + 0.015], max: [sx * 0.04 + 0.01, H + 0.035, -hz + 0.045], c: 0.004, omit: ['ny'] }), 'brass', { seed: seed + 23, shade: 0.8 }));
  const lifter = b.node('lifter', T(0, H + 0.016, -hz + 0.03));
  lifter.add(part('brass', bevelBox({ min: [-0.03, -0.011, -0.011], max: [0.03, 0.011, 0.011], c: 0.005 }), 'brass', { seed: seed + 24 }));
  // the arm: a brass bar lying flat on the deck from the back edge toward the front, its rubber pad at the tip (round
  // two: it lay out behind the stand, through the console at a and d); as a crate opens it swings up and back (about
  // the hinge's X, negative) and stands behind the crate's lid
  lifter.add(part('brass', bevelBox({ min: [-0.025, -0.009, 0.02], max: [0.025, 0.009, ARM], c: 0.005 }), 'brass', { seed: seed + 21 }));
  lifter.add(part('rubber', bevelBox({ min: [-0.045, -0.012, ARM - 0.02], max: [0.045, 0.014, ARM + 0.03], c: 0.006 }), 'ink', { seed: seed + 22 }));

  // ---- small: bolts along the skirt's front ----
  if (skirtH > 0.06) {
    for (let i = 0; i < 4; i++) {
      const x = -W * 0.36 + (W * 0.72 * i) / 3;
      b.small(() => place(hexBolt({ af: 0.03, washer: false, cheap: true, detail, seed: R.int(0, 999), ...(i === 2 ? { material: 'brass' as const, token: 'brass' as const } : {}) }), aim([x, foot + skirtH * 0.5, hz - 0.012], [0, 0, 1])));
    }
  }
  b.socket('label', mat({ at: [0, foot + skirtH * 0.5, hz - 0.008] }));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'opening-stand',
    build: (opts = {}) => openingStand({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    camera: { distance: 3.2 },
    note: 'P4 S6 prototype (?open=stand): the low table a project crate is set down on to open it; the lifter lies flat on the deck and stands up behind an open crate.',
  },
  ...([1, 2] as const).map(
    (look): CatalogueEntry => ({
      name: `opening-stand-${look}`,
      build: (opts = {}) => standStation({ look, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
      variants: { high: { detail: 'high' }, low: { detail: 'low' } },
      camera: { distance: 3.6 },
      note: look === 1 ? 'P4 S6 round two candidate 1 (?standLook=1): a pedestal with a crate painted on its deck, brass corner stops, a lifter arm waiting over it.' : 'P4 S6 round two candidate 2 (?standLook=2): a pedestal with a crate painted on its deck, brass corner stops, an inspection lamp on a jointed arm.',
    }),
  ),
];
