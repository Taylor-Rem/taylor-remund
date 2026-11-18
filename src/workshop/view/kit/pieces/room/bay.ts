/**
 * A reserved bay (REWRITE.md § C "The reserved bays"; ART-P2 § 5): an old
 * rectangle of `tape-yellow` floor tape on the bench top, worn and scuffed
 * where things were dragged over it, and label tape stuck down inside it
 * saying what is coming. Its words come from src/content/room.json.
 *
 * The label lies flat on the bench, so from the camera (33° above) its
 * capitals are foreshortened to about 0.55 of their height: the tape is cut
 * big (CAP) so they still pass the 12 px rule at the default view, and a
 * long name goes on in two strips (the tape was not wide enough), the way
 * DO NOT / TOUCH did.
 *
 *   reservedBay({ w, d, which: 'inspection' | 'next', labels? })
 *
 * Origin: the bay's centre on the bench top (y = 0). Good side +Z (the
 * label reads from the front). Classes: tape.
 */
import { Matrix4 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { Labels } from '../../../types.ts';
import { chain, mat, part, piece, texturedPart, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { sheet } from '../../cheap.ts';
import { rng } from '../../rng.ts';
import { laneTape } from '../bench/index.ts';
import { room } from './words.ts';
import { ATTR } from '../../types.ts';

export type BayName = keyof typeof room.bays;

/** Height of a capital on the bay's label (world units; flat on the bench, so bigger than an upright tape's 0.26). */
export const BAY_CAP = 0.33;

/** How much older the bays' tape is than the lane's: its colour taken down, a scuff along all of it. */
const AGE = { tone: 0.82, scuff: 0.35 };

export interface BayLabelRef {
  key: string;
  w: number;
  h: number;
}

/** The label's words, split into the strips they were stuck down in. */
export function bayStrips(which: BayName): string[] {
  const t = room.bays[which].trim();
  const i = t.indexOf(': ');
  return i > 0 ? [t.slice(0, i + 1), t.slice(i + 2)] : [t];
}

/** Make the bay's label textures (call once the labels are ready). */
export function bayLabels(labels: Labels, which: BayName): BayLabelRef[] {
  return bayStrips(which).map((s) => {
    const key = labels.tape(s, 'black', { capHeight: BAY_CAP });
    return { key, ...labels.size(key) };
  });
}

/** Sizes to lay out with when no labels were made (clay, tests). */
export function estimateBayLabels(which: BayName): Array<{ w: number; h: number }> {
  const width = (s: string): number => 1.42 * BAY_CAP * (0.62 * s.replace(/ /g, '').length + 0.3 * (s.split(' ').length - 1) + 1.2);
  return bayStrips(which).map((s) => ({ w: width(s), h: BAY_CAP * 1.77 }));
}

export interface ReservedBayOptions extends KitOptions {
  /** Along X (default 3.6) and Z (default 2.2). */
  w?: number;
  d?: number;
  which?: BayName;
  /** Label refs from `bayLabels` (blank tape without them). */
  labels?: BayLabelRef[];
}

export function reservedBay(o: ReservedBayOptions = {}): Piece {
  const seed = o.seed ?? 3;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const which = o.which ?? 'inspection';
  const w = o.w ?? 3.6, d = o.d ?? 2.2;
  const b = piece('reserved-bay', { detail, seed, ao: false });
  // the tape: a closed rectangle laid by hand, corners overlapping, a hair out of square
  const hx = w / 2, hz = d / 2;
  const j = (): number => R.spread(0.025);
  const tape = laneTape({ seed: seed + 1, detail, width: 0.11, points: [[-hx + j(), -hz + j()], [hx + j(), -hz + j()], [hx + j(), hz + j()], [-hx + j(), hz + j()], [-hx, -hz]] });
  // older than Fetch's lane: dirtier yellow, scuffed duller all along where things were dragged over it
  for (const q of tape.root.parts) {
    const col = q.geometry.getAttribute(ATTR.color), s = q.geometry.getAttribute(ATTR.surf);
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(i, col.getX(i) * AGE.tone, col.getY(i) * AGE.tone, col.getZ(i) * AGE.tone * 0.9);
      s.setX(i, Math.max(s.getX(i), AGE.scuff * (0.6 + 0.4 * Math.sin(i * 1.7) ** 2)));
    }
  }
  b.add(...tape.root.parts);
  // the label: one or two strips, flat, near the front of the bay, a little crooked
  const strips = o.labels ?? estimateBayLabels(which).map((q) => ({ key: '', ...q }));
  const total = strips.reduce((a, q) => a + q.h, 0) * 0.94;
  let z = hz - 0.18 - total + strips[0]!.h / 2;
  strips.forEach((st, i) => {
    const ang = (i === 0 ? R.range(-2.2, -0.8) : R.range(0.6, 1.8)) * (Math.PI / 180);
    const x = -hx + 0.2 + st.w / 2 + (i === 0 ? 0 : R.range(0.05, 0.18));
    const lifting = i === strips.length - 1;
    const lift = lifting ? (u: number, v: number): number => 0.03 * Math.pow(Math.max(0, (u - 0.9) / 0.1), 2) * Math.max(0, 1 - v * 0.9) : (): number => 0;
    // flat on the bench, reading from the front: the sheet's +Z turned up, its top edge away from the visitor
    const at = chain(T(Math.min(x, hx - st.w / 2 - 0.15), 0.006 + 0.002 * i, z), mat({ rot: [-90, 0, 0] }), new Matrix4().makeRotationZ(ang));
    const face = transform(sheet({ w: st.w, h: st.h, t: 0.003, lift, nx: lifting ? 8 : 1, ny: lifting ? 2 : 1 }), at);
    if (st.key) b.add(texturedPart('tape', face, st.key));
    else b.add(part('tape', face, 'ink'));
    if (lifting) b.add(part('tape', transform(sheet({ w: st.w, h: st.h, t: 0.003, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
    z += st.h * 0.94;
  });
  return b.build();
}
