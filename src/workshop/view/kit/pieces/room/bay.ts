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

/** How much older the bays' tape is than the lane's: colour taken down and browner, scuffs and grime in patches, one corner lifted. */
const AGE = { tone: 0.78, scuff: 0.7, grime: 0.7, lift: 0.045, liftReach: 0.28, mottle: 0.38 };

/** The label lies over the tape (its bubbles stand up to about 0.012). */
const LABEL_Y = 0.014;

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
  /** Its size: along X (default 3.6) and Z (default 2.2). A label longer than the bay is wide is laid across the tape. */
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
  // the tape: a rectangle laid by hand years ago, a hair out of square, corners overlapping; walked
  // through on the front run (a gap, its ends torn), one corner come up off the bench
  const hx = w / 2, hz = d / 2;
  const j = (): number => R.spread(0.025);
  const gx = R.range(0.1, 0.45) * hx, gw = R.range(0.14, 0.22);
  const corners: Array<[number, number]> = [[hx + j(), hz + j()], [hx + j(), -hz + j()], [-hx + j(), -hz + j()], [-hx + j(), hz + j()]];
  const tape = laneTape({ seed: seed + 1, detail, width: 0.11, points: [[gx + gw / 2, hz], ...corners, [gx - gw / 2 - (gw * 0.2), hz]] });
  const lifted = corners[2]!; // the back-left corner, where nothing stands on it
  const lr = AGE.liftReach;
  for (const q of tape.root.parts) {
    const pos = q.geometry.getAttribute('position'), col = q.geometry.getAttribute(ATTR.color), sf = q.geometry.getAttribute(ATTR.surf);
    for (let i = 0; i < col.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // older than Fetch's lane: a dirtier, browner yellow, scuffed dull in long patches, grime in the scuffs
      const patch = Math.max(0, Math.min(1, 0.5 + 0.9 * Math.sin(x * 4.3 + z * 2.9 + seed) * Math.sin(x * 9.1 - z * 6.3 + seed * 0.7)));
      const k = AGE.tone * (1 - AGE.mottle * patch);
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * 0.97, col.getZ(i) * k * 0.85);
      sf.setX(i, Math.max(sf.getX(i), AGE.scuff * (0.5 + 0.5 * patch)));
      sf.setY(i, Math.max(sf.getY(i), AGE.grime * patch));
      // the lifted corner: curling up off the bench toward its tip
      const dl = Math.hypot(x - lifted[0], z - lifted[1]);
      if (dl < lr) pos.setY(i, pos.getY(i) + AGE.lift * (1 - dl / lr) ** 2);
    }
    pos.needsUpdate = true;
    q.geometry.computeBoundingBox();
  }
  b.add(...tape.root.parts);
  // the label: one or two strips, flat, near the front of the bay, a little crooked
  const strips = o.labels ?? estimateBayLabels(which).map((q) => ({ key: '', ...q }));
  const total = strips.reduce((a, q) => a + q.h, 0) * 0.94;
  let z = hz - 0.18 - total + strips[0]!.h / 2;
  strips.forEach((st, i) => {
    const ang = (i === 0 ? R.range(-2.2, -0.8) : R.range(0.6, 1.8)) * (Math.PI / 180);
    // laid from the bay's left edge; a label longer than the bay is wide goes on across the tape itself
    const room = 2 * hx - 0.35;
    const x = st.w > room ? R.spread(0.04) : Math.min(-hx + 0.2 + st.w / 2 + (i === 0 ? 0 : R.range(0.05, 0.18)), hx - st.w / 2 - 0.15);
    const lifting = i === strips.length - 1;
    const lift = lifting ? (u: number, v: number): number => 0.03 * Math.pow(Math.max(0, (u - 0.9) / 0.1), 2) * Math.max(0, 1 - v * 0.9) : (): number => 0;
    // flat on the bench, reading from the front: the sheet's +Z turned up, its top edge away from the visitor
    const at = chain(T(x, LABEL_Y + 0.002 * i, z), mat({ rot: [-90, 0, 0] }), new Matrix4().makeRotationZ(ang));
    const face = transform(sheet({ w: st.w, h: st.h, t: 0.003, lift, nx: lifting ? 8 : 1, ny: lifting ? 2 : 1 }), at);
    if (st.key) b.add(texturedPart('tape', face, st.key));
    else b.add(part('tape', face, 'ink'));
    if (lifting) b.add(part('tape', transform(sheet({ w: st.w, h: st.h, t: 0.003, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
    z += st.h * 0.94;
  });
  return b.build();
}
