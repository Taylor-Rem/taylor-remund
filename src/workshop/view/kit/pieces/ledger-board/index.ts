/**
 * The ledger board (P4 D1): a counting board of wood and brass, the thing in the Ledger Management System's crate. Three
 * scales: the large (the wooden base, the hopper's dish on its pedestal, the flag's post, the side cup); the medium
 * (eight turned cups in two rows of four on dark rubber mats, the gutter along the front, the plunger's T-handle, the
 * crank with its wooden knob, the flip gate, the flag, the brass strip along the back); the small (the tokens' raised
 * rims, the strip's rivets, one of them a bigger replacement set a hair off the line, the flag's axle boss).
 *
 * Materials, honestly, three draws: wood (the base, the crank's knob, the plunger's crossbar, and the flag's star: a
 * wooden star in red enamel, which the wood class draws as paint), brass (every fitting, and the metal tokens: brass,
 * copper and steel finishes are the three tiers, all turned metal, drawn in the brass class with their own colours),
 * rubber (the rubber token's fat black ring, the mats under the cups). No lamp: the red star is
 * a mark, as it is on the real portal, and it says so by standing up, not by glowing.
 *
 * Nodes that move (the view poses them, view/stations/ledger.ts):
 *   'token-0' .. 'token-7'  the metal payments in deal order (origin: the coin's bottom centre)
 *   'rubber'                 the rubber payment (origin the same)
 *   'crank'                  turns about its local Y (aimed toward the visitor)
 *   'plunger'                travels along its local Y (down is a press)
 *   'gate'                   swings about its local Y (vertical) toward the side cup
 *   'flag'                   swings about its local Y (an axle running front to back): 0 down (level, outward), 90° up
 */
import { BufferAttribute, type BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Token } from '../../types.ts';
import { roundedBox, slab, lathe, extrude } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { domeRivet } from '../../details.ts';
import { chain, mat, part, piece, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { ATTR } from '../../types.ts';
import { linear } from '../../../palette.ts';
import { BOARD } from './dims.ts';
import { TIER, TOKENS } from '../../../../sim/index.ts';

export { BOARD } from './dims.ts';

/** The three tiers' finishes: brass, copper (brass taken well toward the orange enamel), steel. */
const TIER_COLOUR: readonly (readonly [Token, Token, number, number])[] = [
  ['brass', 'brass', 0, 1],
  ['brass', 'paint-orange', 0.8, 0.95],
  ['steel', 'steel', 0, 1.1],
];

/** Write a colour mixed from two palette tokens into a geometry (copper is brass taken toward the orange enamel). */
function mixTint(g: BufferGeometry, a: Token, b: Token, t: number, shade = 1): BufferGeometry {
  const ca = linear(a), cb = linear(b);
  const c = [0, 1, 2].map((k) => (ca[k]! * (1 - t) + cb[k]! * t) * shade);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute(ATTR.color, new BufferAttribute(arr, 3));
  return g;
}

/** A metal token: a turned coin with a raised rim. Origin at its bottom centre. */
function coin(tier: number, seed: number): KitPart[] {
  const r = BOARD.tokenR, t = BOARD.tokenT;
  const g = lathe(profile(0, 0).to(r, 0, { sharp: true }).to(r, t * 0.8, { sharp: true }).to(r * 0.84, t, { sharp: true }).to(0, t * 0.88), { segs: 8, support: false, caps: false });
  const [a, b, k, shade] = TIER_COLOUR[tier]!;
  mixTint(g, a, b, k, shade * (1 + rng(seed).spread(0.05)));
  return [setFinish(part('brass', g), tier === 2 ? 0.3 : 0.55)];
}

/** The star's outline: five points, the top one along +X (outward along the flag's arm). */
function starOutline(R: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : R * 0.45;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}

export interface LedgerBoardOptions extends KitOptions {}

export function ledgerBoard(o: LedgerBoardOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const b = piece('ledger-board', { detail, seed });
  const B = BOARD;

  // ---- large: the wooden base, its brass strip along the back --------------------------------------------------
  b.add(part('wood', roundedBox({ w: B.w, h: B.h, d: B.d, r: 0.012, segs: 1, detail }), 'wood', { seed, jitter: 0.05, warm: 0.03 }));
  const stripM = chain(T(-0.04, B.h - 0.001, -B.d / 2 + 0.022), askew(seed + 3, 0.8));
  b.add(part('brass', transform(slab({ w: B.w - 0.17, d: 0.024, t: 0.004, r: 0.004, bevel: 0.0015, detail, open: true }), stripM), 'brass', { seed: seed + 4, warm: 0.04 }));
  const odd = R.int(0, 2);
  b.small(() => [-0.26, -0.04, 0.18].flatMap((x, i) => domeRivet({ d: i === odd ? 0.014 : 0.011, detail: 'low', seed: seed + 10 + i, cheap: true }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(stripM, T(x + (i === odd ? 0.003 : 0), 0.004, 0))) }))));

  // ---- medium: the cups (turned brass rings on dark rubber mats: an empty cup is a dark hole) ----------------------
  for (const z of B.rowZ) b.add(part('rubber', transform(slab({ w: 4 * B.cupDX + 0.014, d: 2 * B.cupR + 0.014, t: 0.002, r: B.cupR, bevel: 0.0008, detail: 'low', open: true }), T(B.cupX0 + 1.5 * B.cupDX, B.h - 0.0005, z)), 'ink', { shade: 0.7 }));
  const cupG = (): BufferGeometry => lathe(profile(B.cupR - B.cupWall, B.cupH).to(B.cupR - B.cupWall * 0.3, B.cupH * 1.05, { sharp: true }).to(B.cupR, -0.002, { sharp: true }), { segs: 9, support: false, caps: false });
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 4), col = i % 4;
    b.add(part('brass', transform(cupG(), T(B.cupX0 + col * B.cupDX, B.h - 0.002, B.rowZ[row]!)), 'brass', { seed: seed + 20 + i, jitter: 0.05, warm: 0.04 }));
  }

  // ---- the hopper: a turned dish on a pedestal at the left end ------------------------------------------------------
  const hx = B.hopperX, hz = B.hopperZ;
  b.add(part('brass', transform(lathe(profile(0.04, 0).to(0.026, 0.013, { sharp: true }).to(0.024, B.hopperFloor - B.h - 0.01, { sharp: true }).to(0, B.hopperFloor - B.h - 0.008), { segs: 9, support: false, caps: false }), T(hx, B.h, hz)), 'brass', { seed: seed + 30, warm: 0.04 }));
  b.add(part('brass', transform(lathe(profile(0, 0).to(B.hopperR * 0.7, 0.001, { sharp: true }).to(B.hopperR * 1.04, 0.03, { sharp: true }).to(B.hopperR * 0.96, 0.031, { sharp: true }).to(B.hopperR * 0.66, 0.007, { sharp: true }).to(0, 0.005), { segs: 10, support: false, caps: false }), T(hx, B.hopperFloor - 0.004, hz)), 'brass', { seed: seed + 31, warm: 0.05 }));

  // ---- the crank on the hopper's pedestal front: a boss, a brass arm, a turned wooden knob (it turns about its local Y, toward the visitor)
  const crankAt = chain(T(hx, B.crankY, hz + B.crankZ), mat({ rot: [90, 0, 0] }));
  b.add(part('brass', transform(lathe(profile(0, 0).to(0.015, 0, { sharp: true }).to(0.015, 0.03, { sharp: true }).to(0, 0.03), { segs: 8, support: false, caps: 'end' }), chain(crankAt, T(0, -0.03, 0))), 'brass', { seed: seed + 32 }));
  const crank = b.node('crank', crankAt);
  crank.add(part('brass', transform(roundedBox({ w: B.crankArm + 0.02, h: 0.008, d: 0.018, r: 0.0035, segs: 1, detail: 'low' }), T(B.crankArm / 2 - 0.004, 0.002, 0)), 'brass', { seed: seed + 33, warm: 0.04 }));
  crank.add(part('wood', transform(lathe(profile(0, 0).to(0.011, 0, { sharp: true }).to(0.013, 0.012, { sharp: true }).to(0.016, 0.03, { sharp: true }).to(0.01, 0.042, { sharp: true }).to(0, 0.044), { segs: 9, support: false, caps: false }), T(B.crankArm, 0.009, 0)), 'wood-light', { seed: seed + 34, shade: 0.9 }));

  // ---- the gutter along the front edge: a shallow brass channel ------------------------------------------------------
  b.add(part('brass', transform(slab({ w: 0.52, d: 0.04, t: 0.003, r: 0.007, bevel: 0.001, detail: 'low', open: true }), T(-0.01, B.h - 0.001, B.gutterZ)), 'brass', { seed: seed + 40, shade: 0.9 }));

  // ---- the side cup and its flip gate: a brass flipper on a post, its blade swung across to send a payment over ----
  b.add(part('brass', transform(lathe(profile(B.sideR * 0.86, 0.028).to(B.sideR, 0.03, { sharp: true }).to(B.sideR * 1.08, 0, { sharp: true }).to(0, 0), { segs: 12, support: false, caps: false }), T(B.sideX, B.h, B.sideZ)), 'brass', { seed: seed + 50, warm: 0.05 }));
  const gate = b.node('gate', T(B.gateX, B.h, B.sideZ - 0.034));
  gate.add(part('brass', lathe(profile(0, 0).to(0.007, 0, { sharp: true }).to(0.006, 0.04, { sharp: true }).to(0, 0.043), { segs: 7, support: false, caps: false }), 'brass', { seed: seed + 52 }));
  gate.add(part('brass', transform(roundedBox({ w: 0.005, h: 0.03, d: 0.062, r: 0.002, segs: 1, detail: 'low' }), T(0, 0.006, 0.035)), 'brass', { seed: seed + 51, warm: 0.05 }));

  // ---- the flag: a brass post with its axle, a coil spring, a brass arm, a wooden star in red enamel ----------------
  const fx = B.flagX, fz = B.flagZ;
  b.add(part('brass', transform(lathe(profile(0.02, 0).to(0.02, 0.005, { sharp: true }).to(0.008, 0.012, { sharp: true }).to(0.007, B.flagY - B.h, { sharp: true }).to(0, B.flagY - B.h + 0.002), { segs: 8, support: false, caps: false }), T(fx, B.h, fz)), 'brass', { seed: seed + 60, warm: 0.04 }));
  // the axle runs front to back: the flag node's local Y along +Z
  const flag = b.node('flag', chain(T(fx, B.flagY, fz), mat({ rot: [90, 0, 0] })));
  flag.add(part('brass', transform(lathe(profile(0, 0).to(0.011, 0, { sharp: true }).to(0.011, 0.012, { sharp: true }).to(0, 0.012), { segs: 6, support: false, caps: false }), T(0, -0.006, 0)), 'brass', { seed: seed + 62 }));
  flag.add(part('brass', transform(roundedBox({ w: B.flagArm, h: 0.006, d: 0.012, r: 0.0025, segs: 1, detail: 'low' }), T(B.flagArm / 2, -0.003, 0)), 'brass', { seed: seed + 63, warm: 0.04 }));
  // the star: a thick wooden star painted red, its face toward the visitor (local +Y) and its top point outward (+X)
  const starG = extrude(starOutline(B.starR), 0.012, { axis: 'y', bevel: 0.003, bevelBase: 0, radius: 0.002, segs: 1, support: false });
  flag.add(setFinish(part('wood', transform(starG, T(B.flagArm + B.starR * 0.55, -0.006, 0)), 'cable-red', { seed: seed + 64, shade: 1.15 }), 1));

  // ---- the plunger at the right front: a brass collar; the rod and a wooden T-handle (it travels down its local Y)
  const px = B.plungerX, pz = B.plungerZ;
  b.add(part('brass', transform(lathe(profile(0.03, 0).to(0.03, 0.007, { sharp: true }).to(0.016, 0.014, { sharp: true }).to(0.015, 0.034, { sharp: true }).to(0, 0.036), { segs: 10, support: false, caps: false }), T(px, B.h, pz)), 'brass', { seed: seed + 70, warm: 0.04 }));
  const plunger = b.node('plunger', T(px, 0, pz));
  plunger.add(part('brass', transform(lathe(profile(0, 0).to(0.0065, 0, { sharp: true }).to(0.0065, 0.09, { sharp: true }).to(0, 0.09), { segs: 7, support: false, caps: false }), T(0, B.plungerTop - 0.098, 0)), 'brass', { seed: seed + 71 }));
  // the crossbar: a turned wooden handle across, with brass ferrules at its ends
  const bar = mat({ at: [0, B.plungerTop - 0.012, 0], rot: [0, 0, 90] });
  plunger.add(part('wood', transform(lathe(profile(0, -0.05).to(0.01, -0.05, { sharp: true }).to(0.013, -0.025, { sharp: true }).to(0.013, 0.025, { sharp: true }).to(0.01, 0.05, { sharp: true }).to(0, 0.05), { segs: 9, support: false, caps: false }), bar), 'wood-light', { seed: seed + 72, shade: 0.85 }));

  // ---- the tokens: eight metal coins in deal order, and the rubber ring (posed by the view) ------------------------
  for (let i = 0; i < TOKENS; i++) b.node(`token-${i}`).add(coin(TIER[i]!, seed + 80 + i));
  // a fat black ring, bulging at its waist: it looks as if it would bounce, and it could never be taken for a coin
  const rr = B.rubberR, rt = B.rubberT;
  b.node('rubber').add(part('rubber', lathe(profile(rr * 0.4, 0.002).to(rr * 0.85, 0, { sharp: true }).to(rr * 1.05, rt * 0.5, { sharp: true }).to(rr * 0.85, rt, { sharp: true }).to(rr * 0.4, rt - 0.002, { sharp: true }).to(rr * 0.34, rt * 0.5, { sharp: true }).to(rr * 0.4, 0.002, { sharp: true }), { segs: 12, support: false, caps: false }), 'ink', { shade: 0.3 }));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'ledger-board',
    build: (opts = {}) => ledgerBoard({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    camera: { distance: 1.6 },
    note: 'The ledger board (P4 D1): eight cups in two rows, a hopper, a gutter, a side cup with a flip gate, a spring flag with a red star, a crank and a plunger; the tokens are nodes the view poses.',
  },
];
