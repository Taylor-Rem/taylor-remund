/**
 * The paint dial (P4 D2, D2b; DEMO-CONCEPTS concept 2): t-components' thing. One chip per paint scheme on the dial
 * (sim PAINT_TUNING.schemes, in dial order), each in its scheme's enamel with its trim, and a brass control that says
 * which the workshop wears. Two candidates, for the owner's eye (`style`):
 *
 *  - 'fan': a fan of chips round a brass knob on a cast plate, the chips clear of each other (they start beyond the
 *    knob), the knob's needle on the chip of the scheme worn. Node `knob` (turns about its local +Y).
 *  - 'deck': an upright deck of chips on a brass rod between two posts, the kind a paint shop hands you: the chip of
 *    the scheme worn hangs at the front; the ones before it are flicked over the rod and hang behind. Nodes `chip-<i>`
 *    (each turns about its local +X, the rod: a turn of −swing; 0 hangs straight down, a + swing its foot toward the visitor) and `knob`
 *    (a knurled thumbwheel on the rod's right end, turns about its local +X).
 *
 * Two materials (steel for the plate and the chips' enamel, brass for the rest): two draw calls. The chips' colours
 * are the schemes' own and never take the scheme: the dial is a loose part, and the parts view calls
 * `materials.keepColours` on it. Its own space: y up, the visitor toward +Z, resting on y = 0.
 *
 * Sockets: `grip` (where a hand takes the control).
 */
import { BufferAttribute, Matrix4, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { chain, part, piece, T } from '../../compose.ts';
import { extrude, lathe, slab } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { knurlGeom } from '../../details.ts';
import { ATTR } from '../../types.ts';
import { rng } from '../../rng.ts';
import { PAINT_TUNING } from '../../../../sim/index.ts';
import { slotColour, type SchemeId } from '../../../materials/scheme.ts';

const DEG = Math.PI / 180;

export type PaintDialStyle = 'fan' | 'deck';

/**
 * The style the bench draws. The fan: it lies low on its crate's tray, so a crate set on top of the open crate still
 * claps it shut (crates.ts `onTop`). The deck stands taller than that rule reaches; it is drawn with `?dial=deck`
 * (development), the simulation's body (sim PAINT.half) staying the fan's. The owner chooses.
 */
export const DIAL_STYLE: PaintDialStyle = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get('dial') === 'deck' ? 'deck' : 'fan';

/** Sizes (units). The fan's and the deck's. */
export const PAINT_DIAL = {
  fan: {
    w: 0.31,
    d: 0.2,
    t: 0.018,
    /** The pivot, from the plate's centre (toward the back). */
    pivotZ: -0.065,
    /** A chip: from `r0` out to `r1` from the pivot; its width there and at its tip; its thickness. */
    r0: 0.078,
    r1: 0.158,
    w0: 0.05,
    w1: 0.066,
    chipT: 0.005,
    /** The trim tab across a chip's tip (its length along the chip). */
    tab: 0.026,
    /** The chips span this (degrees each side of straight toward the visitor). */
    spread: 54,
    knobR: 0.034,
    knobH: 0.042,
    needle: 0.074,
  },
  deck: {
    /** The base: a cast block. */
    w: 0.22,
    d: 0.11,
    t: 0.026,
    /** The rod: its height over the bench, its half length, its radius; the posts' radius. */
    rodY: 0.19,
    rodHalf: 0.082,
    rodR: 0.0055,
    postR: 0.009,
    /** A chip card: width, length (down from the rod), thickness; its trim band at its foot. */
    cardW: 0.12,
    cardH: 0.15,
    cardT: 0.0035,
    band: 0.034,
    /** A chip hangs `front` degrees toward the visitor when it is the one worn; flicked over, `back` behind; the
     *  ones still to come hang behind the worn one, each `step` further back. */
    front: 14,
    back: -16,
    step: -5,
    wheelR: 0.022,
    wheelH: 0.016,
  },
} as const;

/** The schemes on the dial, in its order (the simulation's). */
export const DIAL_SCHEMES = PAINT_TUNING.schemes as readonly SchemeId[];

/** The fan's knob turn (radians about its local +Y) to point at chip `i` (fractions between). */
export function paintDialAngle(i: number): number {
  const n = DIAL_SCHEMES.length;
  const S = PAINT_DIAL.fan.spread;
  const k = Math.max(0, Math.min(n - 1, i));
  return (-S + (2 * S * k) / (n - 1)) * DEG;
}

/**
 * The deck: chip `chip`'s swing (radians about the rod, + its foot toward the visitor) with the deck turned to `at`
 * (the chip worn; fractions between are a flick on its way). Chips before the worn one hang behind, flicked over;
 * the worn one at the front; the ones to come behind it, a little further back each. A chip being flicked goes the
 * long way, over the top of the rod.
 */
export function deckSwing(chip: number, at: number): number {
  const D = PAINT_DIAL.deck;
  const rest = (k: number): number => {
    if (chip < k) return (360 + D.back) * DEG; // flicked over: hanging behind, having gone round the top
    if (chip === k) return D.front * DEG;
    return (D.back + D.step * (chip - k - 1)) * DEG;
  };
  const lo = Math.floor(at);
  const f = at - lo;
  if (f <= 0) return rest(lo);
  // between lo and lo + 1: chip lo is on its way over the top; the rest move between their two rests
  const a = rest(lo), b = rest(lo + 1);
  if (chip === lo) return a + (b - a) * f;
  // the ones behind lift to the front together as the flick ends (a chip comes forward only over the last third)
  const g = Math.max(0, (f - 0.66) / 0.34);
  // a chip not yet flicked moving to the front comes from behind (negative) to front (positive): never round the top
  if (b < a - Math.PI) return a + (b + 2 * Math.PI - a) * g;
  return a + (b - a) * g;
}

/** Write a linear colour into a geometry's colour attribute: the kit's `tint` for a colour that is not a token. */
function tintRgb(g: BufferGeometry, rgb: readonly [number, number, number], shade = 1): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], i * 3);
  g.setAttribute(ATTR.color, new BufferAttribute(a, 3));
  return g;
}

const enamel = (id: SchemeId): [number, number, number] => slotColour(id, 'teal-panel');
const trim = (id: SchemeId): [number, number, number] => slotColour(id, 'teal-light');

export interface PaintDialOptions extends KitOptions {
  style?: PaintDialStyle;
  /** The chip worn (its index in dial order; fractions are a turn on its way). */
  at?: number;
}

export function paintDial(o: PaintDialOptions = {}): Piece {
  return (o.style ?? 'fan') === 'fan' ? fan(o) : deck(o);
}

/** A tapered tongue in plan (x across, z out along +Z). */
const tongue = (r0: number, r1: number, w0: number, w1: number): Array<[number, number]> => [[-w0 / 2, r0], [w0 / 2, r0], [w1 / 2, r1], [-w1 / 2, r1]];

function fan(o: PaintDialOptions): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const P = PAINT_DIAL.fan;
  const b = piece('paint-dial', { detail, seed });
  const n = DIAL_SCHEMES.length;
  b.add(part('steel', slab({ w: P.w, d: P.d, t: P.t, r: 0.034, bevel: 0.007, detail: 'low' }), 'ink', { seed, shade: 1.7, jitter: 0.03 }));
  b.small(() => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part('brass', transform(stud(0.01, 0.006, 6), T(x! * (P.w / 2 - 0.024), P.t, z! * (P.d / 2 - 0.024))), 'brass', { seed: seed + 2, shade: 0.8, warm: 0.03 })));
  // the chips: round the pivot, clear of each other and of the knob
  for (let i = 0; i < n; i++) {
    const id = DIAL_SCHEMES[i]!;
    const a = paintDialAngle(i) + R.spread(1) * DEG;
    const at = chain(T(0, P.t, P.pivotZ), new Matrix4().makeRotationY(a));
    const chip = extrude(tongue(P.r0, P.r1, P.w0, P.w1), P.chipT, { axis: 'y', bevel: 0.0014, bevelBase: 0, radius: [0.007, 0.007, 0.012, 0.012], segs: 1, detail: 'low', band: 0, caps: 'end' });
    b.add(setFinish(part('steel', tintRgb(transform(chip, at), enamel(id))), 0.35));
    const tab = extrude(tongue(P.r1 - P.tab, P.r1 - 0.004, P.w1 - 0.006, P.w1 - 0.008), 0.0012, { axis: 'y', bevel: 0.0005, bevelBase: 0, radius: [0, 0, 0.01, 0.01], segs: 1, detail: 'low', band: 0, caps: 'end' });
    b.add(setFinish(part('steel', tintRgb(transform(tab, chain(at, T(0, P.chipT, 0))), trim(id))), 0.35));
  }
  // the knob: a washer, a fluted grip, a domed cap, and a needle out toward the chips
  const knob = b.node('knob', T(0, P.t, P.pivotZ));
  knob.add(setFinish(part('brass', lathe(profile(P.knobR + 0.01, 0).to(P.knobR + 0.01, 0.004, { sharp: true }).to(0, 0.004), { segs: 14, detail: 'low', band: 0, caps: false }), 'brass', { seed: seed + 5, shade: 0.85, warm: 0.03 }), 0.3));
  const lobes = 8, np = lobes * 3;
  const rim: Array<[number, number]> = [];
  for (let i = 0; i < np; i++) {
    const th = (i / np) * Math.PI * 2;
    const r = P.knobR - 0.003 + 0.003 * Math.cos(lobes * th);
    rim.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  knob.add(part('brass', transform(extrude(rim, P.knobH - 0.01, { axis: 'y', bevel: 0.005, bevelBase: 0, radius: 0, segs: 1, detail: 'low', band: 0, caps: 'end' }), T(0, 0.004, 0)), 'brass', { seed: seed + 6, shade: 0.82, warm: 0.05 }));
  const capY = P.knobH - 0.006;
  knob.add(setFinish(part('brass', lathe(profile(P.knobR * 0.7, capY - 0.002).to(P.knobR * 0.7, capY, { sharp: true }).to(P.knobR * 0.35, capY + 0.008, { fillet: 0.005, segs: 1 }).to(0, capY + 0.009), { segs: 12, detail: 'low', band: 0, caps: false }), 'brass', { seed: seed + 7, warm: 0.03 }), 0.6));
  const needle = extrude([[-0.006, P.knobR - 0.004], [0.006, P.knobR - 0.004], [0.004, P.needle - 0.016], [0, P.needle], [-0.004, P.needle - 0.016]], 0.003, { axis: 'y', bevel: 0.001, bevelBase: 0, radius: [0.002, 0.002, 0.001, 0.0005, 0.001], segs: 1, detail: 'low', band: 0, caps: 'end' });
  knob.add(setFinish(part('brass', transform(needle, T(0, 0.004, 0)), 'brass', { seed: seed + 8, shade: 0.95, warm: 0.03 }), 0.5));
  knob.transform = chain(T(0, P.t, P.pivotZ), new Matrix4().makeRotationY(paintDialAngle(o.at ?? 0)));
  b.socket('grip', T(0, P.t + P.knobH, P.pivotZ));
  return b.build();
}

function deck(o: PaintDialOptions): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const D = PAINT_DIAL.deck;
  const b = piece('paint-dial', { detail, seed });
  const n = DIAL_SCHEMES.length;
  const at = o.at ?? 0;
  // the base: a low cast block, a groove-free top; the posts stand in it
  b.add(part('steel', bevelBox({ min: [-D.w / 2, 0, -D.d / 2], max: [D.w / 2, D.t, D.d / 2], c: 0.008, omit: ['ny'] }), 'ink', { seed, shade: 1.7, jitter: 0.03 }));
  for (const s of [-1, 1]) {
    const x = s * (D.rodHalf + D.postR + 0.002);
    // a turned post with a collar at its foot and an eye at its top
    b.add(part('brass', transform(lathe(profile(D.postR + 0.006, 0).to(D.postR + 0.006, 0.008, { fillet: 0.003, segs: 1 }).to(D.postR, 0.014, { fillet: 0.003, segs: 1 }).to(D.postR, D.rodY - D.t - 0.004).to(D.postR + 0.004, D.rodY - D.t + 0.006, { fillet: 0.004, segs: 1 }).to(0, D.rodY - D.t + 0.012), { segs: 10, detail: 'low', band: 0, caps: false }), T(x, D.t, 0)), 'brass', { seed: seed + 3, shade: 0.85, warm: 0.04 }));
  }
  b.small(() => [-1, 1].map((s) => part('brass', transform(stud(0.009, 0.005, 6), T(s * (D.w / 2 - 0.02), D.t, D.d / 2 - 0.022)), 'brass', { seed: seed + 2, shade: 0.8, warm: 0.03 })));
  // the rod (along +X), through the posts' eyes
  const rod = transform(lathe(profile(D.rodR, -D.rodHalf - 0.016).to(D.rodR, D.rodHalf + 0.016), { segs: 8, detail: 'low', band: 0, caps: true }), new Matrix4().makeRotationZ(-Math.PI / 2));
  b.add(setFinish(part('brass', transform(rod, T(0, D.rodY, 0)), 'brass', { seed: seed + 4, warm: 0.03 }), 0.5));
  // the chips: cards hanging from the rod, each with its trim band at its foot and a brass eyelet at its top
  for (let i = 0; i < n; i++) {
    const id = DIAL_SCHEMES[i]!;
    const x = R.spread(0.004);
    const c = b.node(`chip-${i}`, chain(T(x, D.rodY, 0), new Matrix4().makeRotationX(-deckSwing(i, at))));
    const card = bevelBox({ min: [-D.cardW / 2, -D.cardH, -D.cardT / 2], max: [D.cardW / 2, -0.008, D.cardT / 2], c: 0.0012 });
    c.add(setFinish(part('steel', tintRgb(card, enamel(id))), 0.35));
    // the trim band, a hair proud of both faces
    const band = bevelBox({ min: [-D.cardW / 2 + 0.004, -D.cardH + 0.004, -D.cardT / 2 - 0.0008], max: [D.cardW / 2 - 0.004, -D.cardH + D.band, D.cardT / 2 + 0.0008], c: 0.0005 });
    c.add(setFinish(part('steel', tintRgb(band, trim(id))), 0.35));
    c.small(() => [part('brass', transform(lathe(profile(0.007, -0.0025).to(0.007, 0.0025), { segs: 8, detail: 'low', band: 0, caps: true }), chain(T(0, -0.0, 0), new Matrix4().makeRotationZ(-Math.PI / 2))), 'brass', { seed: seed + 9 + i, shade: 0.9, warm: 0.03 })]);
  }
  // the thumbwheel on the rod's right end: knurled brass, turns as the deck is flicked
  const wheel = b.node('knob', T(D.rodHalf + 0.016 + D.wheelH / 2, D.rodY, 0));
  wheel.add(part('brass', transform(knurlGeom(D.wheelR, D.wheelH, 18, undefined, 'low'), chain(new Matrix4().makeRotationZ(-Math.PI / 2), T(0, -D.wheelH / 2, 0))), 'brass', { seed: seed + 6, warm: 0.05 }));
  b.socket('grip', T(D.rodHalf + 0.016 + D.wheelH / 2, D.rodY + D.wheelR, 0));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'paint-dial',
    build: (opts = {}) =>
      paintDial({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['style'] === 'fan' || opts['style'] === 'deck' ? { style: opts['style'] } : {}),
        ...(typeof opts['at'] === 'number' ? { at: opts['at'] } : {}),
      }),
    variants: { deck: { style: 'deck' }, 'deck at 2': { style: 'deck', at: 2 }, 'deck mid-flick': { style: 'deck', at: 1.5 }, fan: { style: 'fan' }, 'fan at 2': { style: 'fan', at: 2 }, low: { detail: 'low' } },
    camera: { distance: 1.1 },
    note: 'The paint dial: one chip per paint scheme in its enamel and trim, as an upright deck on a rod (flicked chip to chip) or a fan round a knob.',
  },
];
