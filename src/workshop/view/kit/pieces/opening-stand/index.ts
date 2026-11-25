/**
 * P4 S6: the opening stand (sim/machines/opening-stand.ts), as it ships for now (I2, the owner's ruling of 2026-11-25:
 * both decorated designs, the lifter arm and the inspection lamp, are dropped; a real machine is to be designed there
 * later). A placeholder: the pedestal alone. A painted steel pedestal on a toe plinth, an oak deck of four boards, a brass
 * edge band at its front, a crate's outline painted on the deck (the tool wall's language: a painted outline says
 * something belongs here) with brass stops at its corners shaped to a crate's corners, bolts along the front. Nothing of
 * it moves. `h` is its height (the deck's top, the collider's top), `half` the deck's half extents (the station size,
 * `STAND_STATION_SIZE`, by default). Socket `label`: the middle of the pedestal's front.
 *
 * Every colour a palette token; every mesh from the kit.
 */
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { taperBox } from '../../solids.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { hexBolt } from '../../details.ts';
import { aim, mat, part, piece, place, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';

export interface OpeningStandOptions extends KitOptions {
  /** Height of the deck's top over the floor (default 0.5, the station's). */
  h?: number;
  /** Half extents of the deck (default 0.78 × 0.72, the station's). */
  half?: readonly [number, number];
  /** The crate outline painted on the deck (half extents): the large crate's. */
  outline?: readonly [number, number];
}

export function openingStand(o: OpeningStandOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  // (the seed stream round two's pedestal had, so its boards and paint wear as they did)
  const R = rng(seed * 53 + 2 * 7);
  const b = piece('opening-stand', { detail, seed });
  const H = o.h ?? 0.5;
  const [hx, hz] = o.half ?? [0.78, 0.72];
  const [ox, oz] = o.outline ?? [0.42, 0.39];
  const W = hx * 2, D = hz * 2;
  const deckT = Math.min(0.035, H * 0.3);
  const plinth = Math.min(0.035, H * 0.15);

  // ---- large: a toe plinth, the pedestal, the deck ----
  b.add(part('steel', bevelBox({ min: [-hx + 0.02, 0, -hz + 0.02], max: [hx - 0.02, plinth, hz - 0.02], c: 0.01, omit: ['ny'], wear: 0.8 }), 'teal-deep', { seed: seed + 2, jitter: 0.04 }));
  b.add(part('steel', transform(taperBox({ w: W - 0.12, h: Math.max(0.02, H - deckT - plinth), d: D - 0.12, rPlan: 0.06, rTop: 0.015, rBottom: 0.02, topW: W - 0.06, topD: D - 0.06, segs: 2, detail }), T(0, plinth, 0)), 'teal-panel', { seed, jitter: 0.05 }));
  // the deck: four oak boards, a hair apart, one a little proud, one a shade lighter
  const boards = 4;
  const bw = (D - 0.02) / boards;
  for (let i = 0; i < boards; i++) {
    const z = -D / 2 + 0.01 + bw * (i + 0.5);
    const lift = i === 2 ? 0.0015 : 0;
    const x0 = R.spread(0.004);
    b.add(part('wood', bevelBox({ min: [x0 - W / 2, H - deckT + lift, z - bw / 2 + 0.004], max: [x0 + W / 2, H + lift, z + bw / 2 - 0.004], c: 0.004, omit: ['ny'], wear: 0.6 }), i === 1 ? 'wood-light' : 'wood', { seed: seed + 1 + i, jitter: 0.08 }));
  }
  // a brass edge band round the deck's front (the bench's machines wear one)
  b.add(part('brass', bevelBox({ min: [-hx - 0.004, H - deckT - 0.02, hz - 0.006], max: [hx + 0.004, H - deckT + 0.004, hz + 0.006], c: 0.003, wear: 1 }), 'brass', { seed: seed + 9, shade: 0.85 }));

  // ---- medium: the painted outline of a crate, brass corner stops shaped to its corners ----
  const lw = 0.028, lt = 0.0015;
  for (const [x0, z0, x1, z1] of [[-ox, -oz, ox, -oz + lw], [-ox, oz - lw, ox, oz], [-ox, -oz, -ox + lw, oz], [ox - lw, -oz, ox, oz]] as const) {
    // a little worn: the paint stops short here and there
    const gap = R.range(0, 1) < 0.5 ? R.range(0.1, 0.3) : 0;
    const along = x1 - x0 > z1 - z0;
    if (gap > 0) {
      const mid = along ? x0 + (x1 - x0) * gap : z0 + (z1 - z0) * gap;
      const segsA = along ? [[x0, z0, mid - 0.02, z1], [mid + 0.03, z0, x1, z1]] : [[x0, z0, x1, mid - 0.02], [x0, mid + 0.03, x1, z1]];
      for (const [a0, b0, a1, b1] of segsA) b.add(part('steel', bevelBox({ min: [a0!, H, b0!], max: [a1!, H + lt, b1!], c: 0, omit: ['ny'] }), 'tape-yellow', { seed: seed + 30, jitter: 0.1, shade: 0.9 }));
    } else b.add(part('steel', bevelBox({ min: [x0, H, z0], max: [x1, H + lt, z1], c: 0, omit: ['ny'] }), 'tape-yellow', { seed: seed + 30, jitter: 0.1, shade: 0.9 }));
  }
  // corner stops: brass angles just outside the outline's corners, a crate's corner fits into each
  const cs = 0.11, ct = 0.022, ch = 0.04;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = sx * (ox + ct / 2 + 0.006), z = sz * (oz + ct / 2 + 0.006);
    b.add(part('brass', bevelBox({ min: [Math.min(x, x - sx * cs), H, z - ct / 2], max: [Math.max(x, x - sx * cs), H + ch, z + ct / 2], c: 0.005, omit: ['ny'], wear: 1 }), 'brass', { seed: seed + 40 + sx + sz * 2, shade: 0.9 }));
    b.add(part('brass', bevelBox({ min: [x - ct / 2, H, Math.min(z, z - sz * cs)], max: [x + ct / 2, H + ch, Math.max(z, z - sz * cs)], c: 0.005, omit: ['ny'], wear: 1 }), 'brass', { seed: seed + 41 + sx + sz * 2, shade: 0.9 }));
    b.small(() => part('brass', transform(stud(0.008, 0.004), T(x - sx * cs * 0.6, H + ch, z)), 'brass', { seed: seed + 42, shade: 0.7 }));
  }

  // ---- small: bolts along the pedestal's front ----
  for (let i = 0; i < 5; i++) {
    const x = -W * 0.38 + (W * 0.76 * i) / 4;
    b.small(() => place(hexBolt({ af: 0.03, washer: false, cheap: true, detail, seed: R.int(0, 999), ...(i === 2 ? { material: 'brass' as const, token: 'brass' as const } : {}) }), aim([x, (H - deckT) * 0.6, hz - 0.035], [0, 0, 1])));
  }
  b.socket('label', mat({ at: [0, (H - deckT) * 0.5, hz - 0.03] }));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'opening-stand',
    build: (opts = {}) => openingStand({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    camera: { distance: 3.6 },
    note: 'P4 S6, the placeholder that ships (I2): the pedestal a project crate is set down on to open it, a crate painted on its deck and brass stops at its corners; no arm, no lamp (a real machine is to be designed there later).',
  },
];
