/**
 * The paint dial (D2; DEMO-CONCEPTS concept 2): a paint-chip fan with a brass knob at its pivot. Each chip is
 * one paint scheme (view/materials/scheme.ts), in that scheme's enamel with a tab of its trim at the tip; the
 * knob's needle points at the scheme the workshop is wearing. Small: it fits the tray of an M crate (S5, crate/card.ts: about 0.28 by 0.15), as large as that allows (the first, smaller cut read as a smudge at the closest zoom); the chips fan wide so they read side by side and
 * is picked up like any loose part. Not wired to anything yet: the owner chooses the schemes first.
 *
 *  - a dark cast-iron base plate (steel, `ink`), a rivet at each corner;
 *  - the fan: four enamel chips stacked like a fan deck, splayed toward the visitor, overlapping at the pivot;
 *  - the knob (node `knob`, turns about its local +Y): a fluted brass grip on a washer, a domed cap, and a brass
 *    needle running out over the chips.
 *
 * Two materials (steel, brass): two draw calls. The chips' colours are the schemes' own and must never take
 * the scheme: the dial is a loose part, and whoever realises it calls `materials.keepColours` on it.
 *
 * Sockets: `grip` (the knob's crown, where a hand takes it). Its own space: y up, the visitor toward +Z.
 */
import { BufferAttribute, Matrix4, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { chain, part, piece, T } from '../../compose.ts';
import { extrude, lathe, slab } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { stud } from '../../cheap.ts';
import { ATTR } from '../../types.ts';
import { rng } from '../../rng.ts';
import { SCHEME_IDS, slotColour, type SchemeId } from '../../../materials/scheme.ts';

const DEG = Math.PI / 180;

/** Sizes (units). */
export const PAINT_DIAL = {
  /** The base plate. */
  w: 0.25,
  d: 0.118,
  t: 0.02,
  /** The fan's pivot, from the plate's centre (toward the back). */
  pivotZ: -0.03,
  /** A chip: from the pivot out to `reach`; its width at the tip and at the pivot; its thickness; how much each sits above the one under it. */
  reach: 0.094,
  tipW: 0.052,
  rootW: 0.036,
  chipT: 0.0045,
  lift: 0.0052,
  /** The trim tab at a chip's tip (its length along the chip). */
  tab: 0.024,
  /** The chips' directions, degrees from straight toward the visitor (+ is to the visitor's right). */
  spread: [-56, -19, 19, 56] as readonly number[],
  /** The knob: grip radius and height, needle length (from the pivot). */
  knobR: 0.027,
  knobH: 0.034,
  needle: 0.088,
} as const;

/** The knob's turn (radians about its local +Y) to point at scheme `id` (or a chip index, fractions between). */
export function paintDialAngle(id: SchemeId | number): number {
  const i = typeof id === 'number' ? id : SCHEME_IDS.indexOf(id);
  const s = PAINT_DIAL.spread;
  const lo = Math.max(0, Math.min(s.length - 1, Math.floor(i)));
  const hi = Math.min(s.length - 1, lo + 1);
  const f = Math.max(0, Math.min(1, i - lo));
  return (s[lo]! + (s[hi]! - s[lo]!) * f) * DEG;
}

/** Write a linear colour (times `shade`) into a geometry's colour attribute: the kit's `tint` for a colour that is not a token. */
function tintRgb(g: BufferGeometry, rgb: readonly [number, number, number], shade: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], i * 3);
  g.setAttribute(ATTR.color, new BufferAttribute(a, 3));
  return g;
}

/** A chip's outline in plan (x across, z out from the pivot along +Z): a tapered tongue with rounded ends. */
function chipOutline(r0: number, r1: number, w0: number, w1: number): Array<[number, number]> {
  return [[-w0 / 2, r0], [w0 / 2, r0], [w1 / 2, r1], [-w1 / 2, r1]];
}

export function paintDial(o: KitOptions & { scheme?: SchemeId | number } = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const P = PAINT_DIAL;
  const b = piece('paint-dial', { detail, seed });

  // ---- the base: a cast plate, rivets at the corners ----------------------------------------
  b.add(part('steel', slab({ w: P.w, d: P.d, t: P.t, r: 0.03, bevel: 0.007, detail: 'low' }), 'ink', { seed, shade: 1.7, jitter: 0.03 }));
  b.small(() => {
    const out = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      out.push(part('brass', transform(stud(0.01, 0.006, 6), T(x * (P.w / 2 - 0.024), P.t, z * (P.d / 2 - 0.024))), 'brass', { seed: seed + 2, shade: 0.8, warm: 0.03 }));
    }
    return out;
  });

  // ---- the fan ------------------------------------------------------------------------------
  const y0 = P.t;
  P.spread.forEach((deg, i) => {
    const id = SCHEME_IDS[i];
    if (!id) return;
    const a = deg * DEG + R.spread(1.2) * DEG; // a fan deck is never quite even
    const at = chain(T(0, y0 + i * P.lift, P.pivotZ), new Matrix4().makeRotationY(a));
    const chip = extrude(chipOutline(-0.018, P.reach, P.rootW, P.tipW), P.chipT, { axis: 'y', bevel: 0.0012, bevelBase: 0, radius: [0.008, 0.008, 0.01, 0.01], segs: 1, detail: 'low', band: 0, caps: 'end' });
    b.add(setFinish(part('steel', tintRgb(transform(chip, at), slotColour(id, 'teal-panel'), 1.0)), 0.35));
    // the trim: a tab across the tip, a hair proud of the chip
    const tab = extrude(chipOutline(P.reach - P.tab, P.reach - 0.003, P.tipW - 0.004, P.tipW - 0.006), 0.0012, { axis: 'y', bevel: 0.0005, bevelBase: 0, radius: [0, 0, 0.008, 0.008], segs: 1, detail: 'low', band: 0, caps: 'end' });
    b.add(setFinish(part('steel', tintRgb(transform(tab, chain(at, T(0, P.chipT, 0))), slotColour(id, 'teal-light'), 1.0)), 0.35));
  });

  // ---- the knob -----------------------------------------------------------------------------
  const top = y0 + (P.spread.length - 1) * P.lift + P.chipT;
  const knob = b.node('knob', T(0, top, P.pivotZ));
  // a washer under it
  knob.add(setFinish(part('brass', lathe(profile(P.knobR + 0.008, 0).to(P.knobR + 0.008, 0.003, { sharp: true }).to(0, 0.003), { segs: 12, detail: 'low', band: 0, caps: false }), 'brass', { seed: seed + 5, shade: 0.85, warm: 0.03 }), 0.3));
  // the grip: fluted (eight scallops), a bevelled top edge
  const lobes = 8, np = lobes * 3;
  const rim: Array<[number, number]> = [];
  for (let i = 0; i < np; i++) {
    const th = (i / np) * Math.PI * 2;
    const r = P.knobR - 0.0025 + 0.0025 * Math.cos(lobes * th);
    rim.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  const grip = extrude(rim, P.knobH - 0.007, { axis: 'y', bevel: 0.004, bevelBase: 0, radius: 0, segs: 1, detail: 'low', band: 0, caps: 'end' });
  knob.add(part('brass', transform(grip, T(0, 0.003, 0)), 'brass', { seed: seed + 6, shade: 0.82, warm: 0.05 }));
  // a domed, polished cap
  const capY = P.knobH - 0.004;
  knob.add(setFinish(part('brass', lathe(profile(P.knobR * 0.7, capY - 0.002).to(P.knobR * 0.7, capY, { sharp: true }).to(P.knobR * 0.35, capY + 0.006, { fillet: 0.004, segs: 1 }).to(0, capY + 0.007), { segs: 12, detail: 'low', band: 0, caps: false }), 'brass', { seed: seed + 7, warm: 0.03 }), 0.6));
  // the needle: a thin brass blade from a short tail behind the pivot out over the chips, toward +Z
  const needle = extrude([[-0.0075, -0.024], [0.0075, -0.024], [0.006, P.needle - 0.03], [0, P.needle], [-0.006, P.needle - 0.03]], 0.003, { axis: 'y', bevel: 0.0008, bevelBase: 0, radius: [0.003, 0.003, 0.001, 0.0005, 0.001], segs: 1, detail: 'low', band: 0, caps: 'end' });
  knob.add(setFinish(part('brass', transform(needle, T(0, 0.004, 0)), 'brass', { seed: seed + 8, shade: 0.95, warm: 0.03 }), 0.5));
  knob.transform = chain(T(0, top, P.pivotZ), new Matrix4().makeRotationY(paintDialAngle(o.scheme ?? 0)));

  b.socket('grip', T(0, top + P.knobH + 0.004, P.pivotZ));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'paint-dial',
    build: (opts = {}) => paintDial({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}), ...(typeof opts['scheme'] === 'string' ? { scheme: opts['scheme'] as SchemeId } : {}) }),
    variants: { A: { scheme: 'A' }, B: { scheme: 'B' }, C: { scheme: 'C' }, D: { scheme: 'D' }, low: { detail: 'low' } },
    camera: { distance: 0.9 },
    note: 'The paint dial: a fan of enamel chips, one per paint scheme, and a brass knob whose needle points at the one the workshop wears.',
  },
];
