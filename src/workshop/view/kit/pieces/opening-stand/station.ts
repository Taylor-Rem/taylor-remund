/**
 * P4 S6 round two (the owner, 2026-11-24: "a decorated stand that communicates to the user that they should put a box on
 * it. Not too obvious, but enough to make people wonder what will happen if they put a box there"): two candidates for
 * the opening stand as a station, behind `?standLook=1|2` (0, today's low table, stays in `index.ts`). Both are about
 * one and a half times today's footprint and stand on a painted steel pedestal; on the oak deck a crate's outline is
 * painted (the tool wall's language: a painted outline says something belongs here), its corners held by brass stops
 * shaped to a crate's corners. Over the deck, on a post at its back, a two-jointed arm waits:
 *
 *  1. *The lifter*: a steel arm ending in a brass hook-paddle. It turns to a project crate the visitor carries and
 *     lifts to meet it; idle, now and then, it taps the empty deck. When a crate opens on it, the paddle comes down
 *     under the lid's front edge and lifts the lid open.
 *  2. *The inspection lamp*: a little anglepoise with a brass shade and a lens that lights. It turns to look at a project
 *     crate the visitor carries and its lens lights, brighter as the crate comes near; idle, now and then, it sweeps the
 *     empty outline. When a crate opens on it, the shade's lip comes under the lid's front edge and lifts it, then it
 *     looks in.
 *
 * (The lifter's post stands at the deck's left side, so its arm reaches in across the crate in profile from the front;
 * the lamp's at the back right corner.)
 * Nodes (each a bone the view turns): `yaw` (about Y, at the post's top), `upper` (about X, under `yaw`), `fore` (about
 * X, at the upper arm's end), `tip` (about X, at the forearm's end: the paddle or the shade), and for 2 `lit` (the lens
 * alight, scaled to nothing when dark). Arm lengths are `STAND_ARM`. Every colour a palette token; every mesh from the kit.
 */
import type { KitOptions, Piece } from '../../types.ts';
import { lathe, taperBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { hexBolt, domeRivet } from '../../details.ts';
import { aim, mat, part, piece, place, T, type NodeBuilder } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';

/** The arm's measures (world units): the post's height over the deck, the upper arm and forearm, where the post stands. */
export const STAND_ARM = {
  1: { post: 0.45, upper: 0.6, fore: 0.55, at: [-0.66, -0.05] as const },
  2: { post: 0.42, upper: 0.5, fore: 0.46, at: [0.6, -0.5] as const },
} as const;

export interface StandStationOptions extends KitOptions {
  look: 1 | 2;
  /** The deck's top over the floor. */
  h?: number;
  /** Half extents of the deck. */
  half?: readonly [number, number];
  /** The crate outline painted on the deck (half extents): the large crate's. */
  outline?: readonly [number, number];
}

/** A round rod from `a` to `b` (a turned tube: eight sides, open ends). */
function rod(a: readonly [number, number, number], b: readonly [number, number, number], r: number) {
  const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  return transform(lathe(profile(r, 0).to(r, L), { segs: 8, support: false, caps: false }), aim([a[0], a[1], a[2]], d));
}

export function standStation(o: StandStationOptions): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed * 53 + o.look * 7);
  const b = piece(`opening-stand-${o.look}`, { detail, seed });
  const H = o.h ?? 0.5;
  const [hx, hz] = o.half ?? [0.78, 0.72];
  const [ox, oz] = o.outline ?? [0.42, 0.39];
  const W = hx * 2, D = hz * 2;
  const deckT = 0.035;
  const A = STAND_ARM[o.look];

  // ---- large: a toe plinth, the pedestal, the deck ----
  b.add(part('steel', bevelBox({ min: [-hx + 0.02, 0, -hz + 0.02], max: [hx - 0.02, 0.035, hz - 0.02], c: 0.01, omit: ['ny'], wear: 0.8 }), 'teal-deep', { seed: seed + 2, jitter: 0.04 }));
  b.add(part('steel', transform(taperBox({ w: W - 0.12, h: H - deckT - 0.035, d: D - 0.12, rPlan: 0.06, rTop: 0.015, rBottom: 0.02, topW: W - 0.06, topD: D - 0.06, segs: 2, detail }), T(0, 0.035, 0)), 'teal-panel', { seed, jitter: 0.05 }));
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

  // ---- the post at the back and its foot ----
  const [px, pz] = A.at;
  b.add(part('steel', transform(lathe(profile(0.11, 0).to(0.11, 0.025, { sharp: true }).to(0.07, 0.045).to(0, 0.045), { segs: 14, support: false, caps: false }), T(px, H, pz)), 'teal-deep', { seed: seed + 50 }));
  b.add(part('metal', rod([px, H + 0.02, pz], [px, H + A.post - 0.03, pz], 0.036), 'steel', { seed: seed + 51, shade: 0.8 }));
  b.add(part('brass', transform(lathe(profile(0.05, 0).to(0.05, 0.06, { sharp: true }).to(0, 0.06), { segs: 12, support: false, caps: false }), T(px, H + A.post - 0.08, pz)), 'brass', { seed: seed + 52 }));
  b.small(() => [-0.06, 0.06].map((d) => place(domeRivet({ d: 0.014, cheap: true, seed: seed + 53 }), T(px + d, H + 0.03, pz))));

  // ---- small: bolts along the pedestal's front ----
  for (let i = 0; i < 5; i++) {
    const x = -W * 0.38 + (W * 0.76 * i) / 4;
    b.small(() => place(hexBolt({ af: 0.03, washer: false, cheap: true, detail, seed: R.int(0, 999), ...(i === 2 ? { material: 'brass' as const, token: 'brass' as const } : {}) }), aim([x, (H - deckT) * 0.6, hz - 0.035], [0, 0, 1])));
  }

  // ---- the arm (moving): yaw at the post's top, the upper arm, the forearm, the tip ----
  // what moves draws in two calls: look 1 its steel and its brass; look 2 all of it in the steel class (its brass parts
  // with the brass token, as the pilot lamps do) and its lit lens
  const jm = o.look === 2 ? ('steel' as const) : ('brass' as const);
  const yaw = b.node('yaw', T(px, H + A.post, pz));
  yaw.add(part(jm, transform(lathe(profile(0.05, -0.04).to(0.05, 0.03, { sharp: true }).to(0.035, 0.045).to(0, 0.045), { segs: 12, support: false, caps: false }), T(0, 0, 0)), 'brass', { seed: seed + 60 }));
  // the shoulder's knuckle: a turned boss either side of the arm's root
  yaw.add(part(jm, transform(lathe(profile(0.04, -0.06).to(0.04, 0.06, { sharp: true }).to(0, 0.06), { segs: 12, support: false, caps: false }), mat({ rot: [0, 0, 90] })), 'brass', { seed: seed + 64 }));
  const upper = yaw.node('upper');
  armBar(upper, A.upper, 0.05, seed + 61, jm);
  const fore = upper.node('fore', T(0, 0, A.upper));
  fore.add(part(jm, transform(lathe(profile(0.038, -0.055).to(0.038, 0.055, { sharp: true }).to(0, 0.055), { segs: 12, support: false, caps: false }), mat({ rot: [0, 0, 90] })), 'brass', { seed: seed + 62 }));
  armBar(fore, A.fore, 0.042, seed + 63, jm);
  const tip = fore.node('tip', T(0, 0, A.fore));
  if (o.look === 1) {
    // a brass paddle with a hooked lip, like a hand under a lid: flat, a little wider than the hasp
    tip.add(part('brass', transform(lathe(profile(0.032, -0.05).to(0.032, 0.05, { sharp: true }).to(0, 0.05), { segs: 10, support: false, caps: false }), mat({ rot: [0, 0, 90] })), 'brass', { seed: seed + 70 }));
    tip.add(part('brass', bevelBox({ min: [-0.02, -0.014, 0], max: [0.02, 0.014, 0.08], c: 0.005 }), 'brass', { seed: seed + 73 }));
    tip.add(part('brass', bevelBox({ min: [-0.11, -0.009, 0.06], max: [0.11, 0.009, 0.19], c: 0.004, wear: 1 }), 'brass', { seed: seed + 71 }));
    tip.add(part('brass', bevelBox({ min: [-0.11, -0.009, 0.18], max: [0.11, 0.05, 0.2], c: 0.004, wear: 1 }), 'brass', { seed: seed + 72, shade: 0.8 }));
  } else {
    // the shade: a brass cone opening along the tip's +Z (it looks where +Z points), a rolled lip, a lens inside
    const shade = lathe(profile(0.035, -0.02).to(0.05, 0.03).to(0.13, 0.17, { sharp: true }).to(0.138, 0.176, { sharp: true }).to(0.128, 0.18), { segs: 16, support: false, caps: false });
    tip.add(part('steel', transform(shade, mat({ rot: [90, 0, 0] })), 'brass', { seed: seed + 74, warm: 0.05 }));
    const lens = lathe(profile(0.11, 0.13).to(0.07, 0.15).to(0, 0.158), { segs: 14, support: false, caps: false });
    tip.add(part('steel', transform(lens, mat({ rot: [90, 0, 0] })), 'amber', { seed: seed + 75, shade: 0.35 }));
    const lit = tip.node('lit');
    lit.add({ ...part('bulb', transform(lathe(profile(0.112, 0.132).to(0.072, 0.152).to(0, 0.161), { segs: 14, support: false, caps: false }), mat({ rot: [90, 0, 0] })), 'amber-glow', { seed: seed + 76 }), shadow: 'none' });
    tip.small(() => part('steel', transform(stud(0.01, 0.012), T(0, 0.035, 0.01)), 'brass', { seed: seed + 77 }));
  }
  return b.build();
}

/** An arm's bar along +Z from 0 to `len`: two steel strips side by side (a parallel link) with brass bushes at the ends. */
function armBar(n: NodeBuilder, len: number, w: number, seed: number, jm: 'steel' | 'brass'): void {
  for (const sx of [-1, 1]) n.add(part('steel', bevelBox({ min: [sx * 0.032 - 0.009, -w / 2, 0], max: [sx * 0.032 + 0.009, w / 2, len], c: 0.004, wear: 0.9 }), 'teal-light', { seed: seed + sx }));
  for (const z of [len * 0.33, len * 0.66]) n.add(part(jm, transform(lathe(profile(0.016, -0.045).to(0.016, 0.045, { sharp: true }).to(0, 0.045), { segs: 8, support: false, caps: false }), chainZ(z)), 'brass', { seed: seed + 5, shade: 0.8 }));
}
const chainZ = (z: number) => mat({ at: [0, 0, z], rot: [0, 0, 90] });
