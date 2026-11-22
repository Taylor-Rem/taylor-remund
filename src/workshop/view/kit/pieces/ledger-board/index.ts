/**
 * The ledger board (P4 D1): a small counting board of wood and brass, the thing in the Ledger Management System's
 * crate. Three scales: the large (the wooden base with its brass edge strip, the hopper's dish on its pedestal, the
 * star's post, the side cup); the medium (eight turned cups in two rows of four, the gutter along the front, the
 * plunger in its collar, the crank, the flip gate, eight tokens); the small (screws in the strip, rivets on the
 * post's foot, a brass replacement screw, the tokens' milled rims).
 *
 * Materials, honestly: wood (the base), brass (every fitting, and the metal tokens: brass, copper and steel finishes
 * are the three tiers, all turned metal, drawn in the brass class with their own colours so they share its draw),
 * rubber (the rubber token's thick ring, the plunger's knob, the crank's grip, the star's dark lens), bulb
 * (the star lit). Four draws while it is out; none while it is stowed.
 *
 * Nodes that move (the view poses them, view/stations/ledger.ts):
 *   'token-0' .. 'token-7'  the metal payments in deal order (origin: the coin's bottom centre)
 *   'rubber'                 the rubber payment (origin the same), with 'rubber-core-0..2': its tier's finish at its middle
 *   'crank'                  turns about its local Y (aimed toward the visitor)
 *   'plunger'                travels along its local Y (down is a press)
 *   'gate'                   swings about its local Y (vertical) toward the side cup
 *   'star-lit', 'star-dark'  the two twins of the red star (one shown at a time, by scale)
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

/** The three tiers' finishes: brass, copper (brass warmed toward the orange enamel), steel. */
const TIER_COLOUR: readonly (readonly [Token, Token, number])[] = [
  ['brass', 'brass', 0],
  ['brass', 'paint-orange', 0.55],
  ['steel', 'steel', 0],
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

/** A metal token: a turned coin with a raised milled rim and a sunk field. Origin at its bottom centre. */
function coin(tier: number, seed: number, low: boolean): KitPart[] {
  const r = BOARD.tokenR, t = BOARD.tokenT;
  const g = lathe(
    profile(0, 0).to(r, 0, { sharp: true }).to(r, t * 0.8, { sharp: true }).to(r * 0.84, t, { sharp: true }).to(0, t * 0.88),
    { segs: 8, support: false, caps: false },
  );
  const [a, b, k] = TIER_COLOUR[tier]!;
  mixTint(g, a, b, k, 1 + rng(seed).spread(0.05));
  return [setFinish(part('brass', g), tier === 2 ? 0.35 : 0.55)];
}

/** The star's outline: five points, facing +Z. */
function starOutline(R: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : R * 0.45;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}

export interface LedgerBoardOptions extends KitOptions {}

export function ledgerBoard(o: LedgerBoardOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const R = rng(seed);
  const b = piece('ledger-board', { detail, seed });
  const B = BOARD;

  // ---- large: the wooden base, its brass edge strip, feet ------------------------------------------------
  b.add(part('wood', roundedBox({ w: B.w, h: B.h, d: B.d, r: 0.012, segs: 2, detail }), 'wood', { seed, jitter: 0.05, warm: 0.03 }));
  // a brass strip along the back edge, a hair off true, screwed down (one screw a brass replacement of a different head)
  const stripM = chain(T(0, B.h - 0.001, -B.d / 2 + 0.02), askew(seed + 3, 0.8));
  b.add(part('brass', transform(slab({ w: B.w - 0.05, d: 0.022, t: 0.004, r: 0.004, bevel: 0.0015, detail, open: true }), stripM), 'brass', { seed: seed + 4, warm: 0.04 }));
  const odd = R.int(0, 2);
  b.small(() => [-0.22, 0.02, 0.22].flatMap((x, i) => domeRivet({ d: i === odd ? 0.013 : 0.01, detail: 'low', seed: seed + 10 + i, cheap: true }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(stripM, T(x + (i === odd ? 0.003 : 0), 0.004, 0))) }))));

  // ---- medium: the cups (turned brass rings sunk a hair into the base) -----------------------------------------
  const cupG = (): BufferGeometry =>
    lathe(profile(B.cupR - B.cupWall, B.cupH).to(B.cupR - B.cupWall * 0.3, B.cupH * 1.05, { sharp: true }).to(B.cupR, -0.002, { sharp: true }), { segs: low ? 8 : 9, support: false, caps: false });
  // a dark rubber mat under each month's row, so a coin in a cup (and the gap where one is not) reads from across the bench
  for (const z of B.rowZ) b.add(part('rubber', transform(slab({ w: 4 * B.cupDX + 0.012, d: 2 * B.cupR + 0.012, t: 0.002, r: B.cupR, bevel: 0.0008, detail: 'low', open: true }), T(B.cupX0 + 1.5 * B.cupDX, B.h - 0.0005, z)), 'ink', { shade: 1.4 }));
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 4), col = i % 4;
    b.add(part('brass', transform(cupG(), T(B.cupX0 + col * B.cupDX, B.h - 0.002, B.rowZ[row]!)), 'brass', { seed: seed + 20 + i, jitter: 0.05, warm: 0.04 }));
  }

  // ---- the hopper: a turned dish on a pedestal at the left end ------------------------------------------------
  const hx = B.hopperX, hz = B.hopperZ;
  b.add(part('brass', transform(lathe(profile(0.034, 0).to(0.022, 0.012, { sharp: true }).to(0.02, B.hopperFloor - B.h - 0.01, { sharp: true }).to(0, B.hopperFloor - B.h - 0.008), { segs: 9, support: false, caps: false }), T(hx, B.h, hz)), 'brass', { seed: seed + 30, warm: 0.04 }));
  b.add(part('brass', transform(lathe(profile(0, 0).to(B.hopperR * 0.7, 0.001, { sharp: true }).to(B.hopperR * 1.04, 0.026, { sharp: true }).to(B.hopperR * 0.96, 0.027, { sharp: true }).to(B.hopperR * 0.66, 0.006, { sharp: true }).to(0, 0.004), { segs: low ? 10 : 12, support: false, caps: false }), T(hx, B.hopperFloor - 0.004, hz)), 'brass', { seed: seed + 31, warm: 0.05 }));

  // ---- the crank on the hopper's pedestal front: a boss, an arm, a rubber grip (it turns about its local Y, toward the visitor)
  const crankAt = chain(T(hx, B.crankY, hz + B.crankZ), mat({ rot: [90, 0, 0] }));
  b.add(part('brass', transform(lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.02, { sharp: true }).to(0, 0.02), { segs: 8, support: false, caps: 'end' }), chain(crankAt, T(0, -0.02, 0))), 'brass', { seed: seed + 32 }));
  const crank = b.node('crank', crankAt);
  crank.add(part('brass', transform(roundedBox({ w: B.crankArm + 0.012, h: 0.006, d: 0.012, r: 0.0025, segs: 1, detail: 'low' }), T(B.crankArm / 2 - 0.002, 0.002, 0)), 'brass', { seed: seed + 33, warm: 0.04 }));
  crank.add(part('rubber', transform(lathe(profile(0, 0).to(0.008, 0, { sharp: true }).to(0.009, 0.017, { sharp: true }).to(0, 0.021), { segs: 7, support: false, caps: false }), T(B.crankArm, 0.007, 0)), 'ink'));

  // ---- the gutter along the front edge: a shallow brass channel ------------------------------------------------
  const gz = B.gutterZ;
  b.add(part('brass', transform(slab({ w: 0.4, d: 0.034, t: 0.003, r: 0.006, bevel: 0.001, detail: 'low', open: true }), T(0.01, B.h - 0.001, gz)), 'brass', { seed: seed + 40, shade: 0.9 }));

  // ---- the side cup and its flip gate --------------------------------------------------------------------------
  b.add(part('brass', transform(lathe(profile(B.sideR * 0.86, 0.024).to(B.sideR, 0.026, { sharp: true }).to(B.sideR * 1.08, 0, { sharp: true }).to(0, 0), { segs: low ? 10 : 12, support: false, caps: false }), T(B.sideX, B.h, B.sideZ)), 'brass', { seed: seed + 50, warm: 0.05 }));
  const gate = b.node('gate', T(B.gateX, B.h, B.sideZ - 0.02));
  gate.add(part('brass', transform(roundedBox({ w: 0.004, h: 0.026, d: 0.04, r: 0.0015, segs: 1, detail: 'low' }), T(0, 0, 0.02)), 'brass', { seed: seed + 51, warm: 0.05 }));
  gate.add(part('brass', transform(lathe(profile(0, 0).to(0.004, 0, { sharp: true }).to(0.004, 0.03, { sharp: true }).to(0, 0.03), { segs: 6, support: false, caps: false }), T(0, 0, 0)), 'brass', { seed: seed + 52 }));

  // ---- the star lamp on its post at the back --------------------------------------------------------------------
  const sx = B.starX, sz = B.starZ;
  b.add(part('brass', transform(lathe(profile(0.018, 0).to(0.018, 0.004, { sharp: true }).to(0.006, 0.01, { sharp: true }).to(0.005, B.starY - B.h - 0.01, { sharp: true }).to(0, B.starY - B.h - 0.008), { segs: 8, support: false, caps: false }), T(sx, B.h, sz)), 'brass', { seed: seed + 60, warm: 0.04 }));
  // a brass backplate the star sits in front of
  const plateAt = chain(T(sx, B.starY, sz + 0.004), mat({ rot: [90, 0, 0] }));
  b.add(part('brass', transform(lathe(profile(0, 0).to(B.starR * 1.14, 0, { sharp: true }).to(B.starR * 1.1, 0.006, { sharp: true }).to(0, 0.006), { segs: 12, support: false, caps: false }), chain(plateAt, mat({ rot: [180, 0, 0] }))), 'brass', { seed: seed + 62, warm: 0.05 }));
  const starG = (): BufferGeometry => extrude(starOutline(B.starR), 0.01, { bevel: 0.003, bevelBase: 0, radius: 0.003, segs: 1, support: false, caps: 'end' });
  const quiet = (q: KitPart): KitPart => ({ ...q, shadow: 'none' });
  const starM = T(sx, B.starY, sz + 0.006);
  // lit: the patch cord's red, hotter (a lamp glows; the Button's red is the Button's alone)
  b.node('star-lit', starM).add(quiet(setFinish(part('bulb', starG(), 'cable-red', { shade: 2.3 }), 1)));
  b.node('star-dark', starM).add(quiet(setFinish(part('rubber', starG(), 'cable-red', { shade: 0.28 }), 1)));

  // ---- the plunger at the right front: a brass collar, the rod and its rubber knob (it travels down its local Y)
  const px = B.plungerX, pz = B.plungerZ;
  b.add(part('brass', transform(lathe(profile(0.026, 0).to(0.026, 0.006, { sharp: true }).to(0.014, 0.012, { sharp: true }).to(0.013, 0.03, { sharp: true }).to(0, 0.032), { segs: 10, support: false, caps: false }), T(px, B.h, pz)), 'brass', { seed: seed + 70, warm: 0.04 }));
  const plunger = b.node('plunger', T(px, 0, pz));
  plunger.add(part('brass', transform(lathe(profile(0, 0).to(0.0055, 0, { sharp: true }).to(0.0055, 0.06, { sharp: true }).to(0, 0.06), { segs: 7, support: false, caps: false }), T(0, B.plungerTop - 0.068, 0)), 'brass', { seed: seed + 71 }));
  plunger.add(part('rubber', transform(lathe(profile(0, 0).to(0.02, 0.002, { sharp: true }).to(0.021, 0.011, { sharp: true }).to(0.015, 0.02, { sharp: true }).to(0, 0.023), { segs: 10, support: false, caps: false }), T(0, B.plungerTop - 0.022, 0)), 'ink'));

  // ---- the tokens: seven or eight metal coins in deal order, and the rubber ring (posed by the view) ----------------
  for (let i = 0; i < TOKENS; i++) b.node(`token-${i}`).add(coin(TIER[i]!, seed + 80 + i, low));
  const rubber = b.node('rubber');
  rubber.add(part('rubber', lathe(profile(B.rubberR * 0.45, 0).to(B.rubberR, 0.002, { sharp: true }).to(B.rubberR * 1.03, B.rubberT * 0.5, { sharp: true }).to(B.rubberR, B.rubberT - 0.002, { sharp: true }).to(B.rubberR * 0.45, B.rubberT, { sharp: true }), { segs: 10, support: false, caps: false }), 'ink', { shade: 0.8 }));
  for (let k = 0; k < 3; k++) {
    const core = b.node(`rubber-core-${k}`, T(0, 0, 0));
    const g = lathe(profile(B.rubberR * 0.46, 0.003).to(B.rubberR * 0.46, B.rubberT * 0.75, { sharp: true }).to(0, B.rubberT * 0.78), { segs: 7, support: false, caps: false });
    const [a, c, t] = TIER_COLOUR[k]!;
    core.add(setFinish(part('brass', mixTint(g, a, c, t)), 0.5));
  }
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'ledger-board',
    build: (opts = {}) => ledgerBoard({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    camera: { distance: 1.4 },
    note: 'The ledger board (P4 D1): eight cups in two rows, a hopper, a gutter, a side cup with a flip gate, a red star, a crank and a plunger; the tokens are nodes the view poses.',
  },
];
