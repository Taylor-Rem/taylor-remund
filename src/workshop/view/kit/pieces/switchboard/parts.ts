/**
 * The switchboard's small parts, shared by the slice and the whole board:
 * the big jack (with its liftable collar), a capped position, the small dead
 * jack, lens bezels and lenses, the cup pull and the drawer.
 *
 * Built along +Y with the face at y = 0 (a part is aimed out of the panel by
 * the caller), or, for the drawer, in board orientation about its pivot.
 *
 * The triangle diet (V-switchboard-r): turned parts use as few segments as
 * still read round at the Patch close-up (about 240 px a unit); fillets are
 * one segment where the highlight still lands; nothing is modelled where the
 * camera cannot see. Five material classes in all: `steel` (enamel, and the
 * dark bores and screw heads painted over), `brass`, `wood`, `bulb` (every
 * lens, lit or dark: a dark vertex colour is an unlit bulb) and `paper`.
 */
import { Matrix4 } from 'three';
import type { KitPart } from '../../types.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { chain, mat, mergeGeometries, part, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, ridgedBand, sheet, stud } from '../../cheap.ts';
import type { Rng } from '../../rng.ts';

export const Z_UP = new Matrix4().makeRotationX(Math.PI / 2); // a slab lying in XZ turned to face +Z

/** Height of a big jack's mouth above the plate. */
export const JACK_MOUTH = 0.088;
/** Height of a small jack's mouth above the plate. */
export const SMALL_MOUTH = 0.042;
/** Where a lens sits in its bezel. */
export const BEZEL_SEAT = 0.03;
/** How far a jack's collar lifts out of the plate when the jack offers itself (§ D 4). */
export const COLLAR_LIFT = 0.07;

/** A screw head: painted over with the plate (enamel class, steel grey). */
export function screw(r: number, h: number, seed: number, shade = 0.85): KitPart {
  return setFinish(part('steel', stud(r, h, 5), 'steel', { seed, shade, jitter: 0.08 }), 0.4);
}

/**
 * A big live jack: a brass escutcheon and a black fibre bore (fixed), and the
 * collar (a knurled band and a polished crown) that lifts out of it. Under the
 * collar, hidden at rest, a sleeve of yellow enamel: when the collar lifts, the
 * jack shows a bright band, a mechanical "this one is live".
 */
export function bigJack(segs: number, seed: number): { fixed: KitPart[]; sleeve: KitPart; collar: KitPart[] } {
  const esc = lathe(profile(0.175, 0).to(0.175, 0.012, { sharp: true }).to(0.142, 0.03, { sharp: true }).to(0.134, 0.032), { segs, caps: false, band: 0 });
  const knurl = transform(ridgedBand(0.135, 0.042, Math.round(segs * 1.4), 0.009), T(0, 0.03, 0));
  const rim = lathe(
    profile(0.136, 0.07).to(0.132, JACK_MOUTH, { fillet: 0.012, segs: 1 }).to(0.086, JACK_MOUTH, { sharp: true }).to(0.074, JACK_MOUTH - 0.012),
    { segs, caps: false, band: 0 },
  );
  // the bore runs from the mouth into the panel; its top sits under the crown at rest
  const bore = lathe(profile(0.074, JACK_MOUTH - 0.012).to(0.058, JACK_MOUTH - 0.02, { sharp: true }).to(0.058, -0.04, { sharp: true }).to(0, -0.04), { segs: 10, caps: false, band: 0 });
  // the sleeve: from the escutcheon up to the bore's lip, inside the knurl's valleys
  const sleeve = lathe(profile(0.124, 0.03).to(0.124, JACK_MOUTH - 0.014, { sharp: true }).to(0.074, JACK_MOUTH - 0.012), { segs: 12, caps: false, band: 0 });
  return {
    fixed: [
      part('brass', esc, 'brass', { seed, warm: 0.03, shade: 0.9 }),
      setFinish(part('steel', bore, 'ink', { seed: seed + 3, shade: 0.8 }), 0),
      ...[0, 1].map((k) => part('brass', transform(stud(0.012, 0.008, 5), T(Math.cos(0.8 + k * Math.PI) * 0.155, 0.012, Math.sin(0.8 + k * Math.PI) * 0.155)), 'brass', { seed: seed + 4 + k, shade: 0.8 })),
    ],
    sleeve: part('steel', sleeve, 'tape-yellow', { seed: seed + 6, shade: 1.0 }),
    collar: [setFinish(part('brass', knurl, 'brass', { seed: seed + 1 }), 0.45), setFinish(part('brass', rim, 'brass', { seed: seed + 2 }), 0.7)],
  };
}

/** A capped position: a plain escutcheon and a domed brass blank screwed into it. */
export function cappedJack(hi: boolean, seed: number): KitPart[] {
  const sg = hi ? 12 : 10;
  const esc = lathe(profile(0.13, 0).to(0.13, 0.01, { sharp: true }).to(0.105, 0.024, { fillet: 0.006, segs: 1 }).to(0.09, 0.025), { segs: sg, caps: false, band: 0 });
  const cap = lathe(profile(0.093, 0.042).to(0.088, 0.046, { sharp: true }).curve(0, 0.075, 0.075, 0.078, 2), { segs: sg, caps: false, band: 0 });
  const knurl = transform(ridgedBand(0.093, 0.018, hi ? 16 : 12, 0.006), T(0, 0.025, 0));
  return [part('brass', esc, 'brass', { seed, shade: 0.85 }), setFinish(part('brass', cap, 'brass', { seed: seed + 1, shade: 0.95 }), 0.3), part('brass', knurl, 'brass', { seed: seed + 2 })];
}

/** A small dead jack: a brass ring and a dark bore (cheap: there is a row of them). */
export function smallJack(seed: number): KitPart[] {
  const ring = lathe(profile(0.078, 0).to(0.058, SMALL_MOUTH, { sharp: true }).to(0.032, SMALL_MOUTH - 0.01), { segs: 7, caps: false, band: 0 });
  const bore = lathe(profile(0.032, SMALL_MOUTH - 0.012).to(0, 0), { segs: 6, caps: false, band: 0 });
  return [part('brass', ring, 'brass', { seed, shade: 0.82, jitter: 0.08 }), setFinish(part('steel', bore, 'ink', { shade: 0.6 }), 0)];
}

/** Where a jack was taken out: a dark bore in the plate with a chamfered lip. */
export function holeGeom(): KitPart[] {
  const g = lathe(profile(0.06, 0.003).to(0.04, 0.003, { sharp: true }).to(0.034, -0.004, { sharp: true }).to(0.034, -0.03).to(0, -0.03), { segs: 8, caps: false, band: 0 });
  return [part('steel', g, 'ink', { shade: 0.8 })];
}

/** A brass bezel ring for a lens (along +Y, seated on y = 0). */
export function bezel(r: number, hi: boolean, seed: number, cheap = false): KitPart[] {
  const s = cheap ? 7 : hi ? 13 : 10;
  const g = lathe(
    profile(r, 0)
      .to(r, r * 0.12, { sharp: true })
      .to(r * 0.86, r * 0.36, { sharp: true })
      .to(r * 0.66, r * 0.4, { sharp: true })
      .to(r * 0.6, r * 0.26),
    { segs: s, caps: false, band: 0 },
  );
  return [setFinish(part('brass', g, 'brass', { seed, warm: 0.03, shade: cheap ? 0.8 : 1 }), cheap ? 0 : 0.5)];
}

/**
 * A faceted jewel lens (few segments, creased: each facet catches the light).
 * Lit: the bulb class glowing amber. Dark: the same class with a dark amber
 * vertex colour (an unlit bulb: glossy, nearly black, a faint warmth).
 */
export function lensPart(r: number, segs: number, lit: boolean, seed: number, cheap = false): KitPart {
  const pr = cheap ? profile(r, 0).to(r * 0.6, r * 0.55, { sharp: true }).to(0, r * 0.68) : profile(0, 0).to(r, 0, { sharp: true }).to(r * 0.95, r * 0.28, { sharp: true }).to(r * 0.55, r * 0.62, { sharp: true }).to(0, r * 0.72);
  const g = lathe(pr, { segs, caps: false, band: 0 });
  // between the lamp and indicator levels: at the indicator level alone the lens reads pale, not lit
  if (lit) return setFinish(part('bulb', g, 'amber-glow', { seed }), 0.55);
  return setFinish(part('bulb', g, 'amber', { seed, shade: cheap ? 0.035 : 0.03 }), 1);
}

/** A brass cup (bin) pull: a back plate and a hood open underneath, centred at y. */
export function cupPull(seed: number, y: number): KitPart[] {
  const plate = bevelBox({ min: [-0.11, y - 0.042, -0.004], max: [0.11, y + 0.042, 0.008], c: 0.003, omit: ['nz'] });
  // the hood: a quarter-round shell, its curved face looking up and out, open below
  const L = 0.17, rr = 0.05;
  const hood = lathe(profile(0, 0).to(rr, 0, { sharp: true }).to(rr, L, { sharp: true }).to(0, L), { segs: 4, from: -Math.PI / 2, to: 0, caps: false, band: 0 });
  // lathe Y -> world X; its quarter (local -Z .. +X) -> world +Z .. +Y
  const rot = new Matrix4().set(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
  transform(hood, chain(T(-L / 2, y - 0.03, 0.008), rot));
  return [
    setFinish(part('brass', plate, 'brass', { seed, shade: 0.85 }), 0.2),
    setFinish(part('brass', hood, 'brass', { seed: seed + 1 }), 0.8),
  ];
}

/** The brass card holder for a card cw × ch centred at (0, y): a backing plate, side rails and a lip the card drops into; the card itself is the caller's. */
export function cardHolder(cw: number, ch: number, y: number, seed: number): KitPart {
  const x0 = -cw / 2 - 0.022, x1 = cw / 2 + 0.022, y0 = y - ch / 2 - 0.02, y1 = y + ch / 2 + 0.008;
  const back = bevelBox({ min: [x0, y0, -0.004], max: [x1, y1, 0.0015], c: 0.002, omit: ['nz'] });
  const lip = bevelBox({ min: [x0, y0, 0.0015], max: [x1, y - ch / 2 + 0.004, 0.01], c: 0.003, omit: ['nz', 'ny'] });
  const rails = [-1, 1].map((s) => bevelBox({ min: [s < 0 ? x0 : cw / 2 - 0.004, y - ch / 2, 0.0015], max: [s < 0 ? -cw / 2 + 0.004 : x1, y1, 0.008], c: 0.002, omit: ['nz', 'ny', 'py'] }));
  return setFinish(part('brass', mergeGeometries([back, lip, ...rails]), 'brass', { seed, warm: 0.03 }), 0.2);
}

/**
 * What is in a drawer, built in board orientation (+Z out of the board) with
 * the drawer front's back face at z = 0 and the floor at y = y0: two sides and
 * a floor of pale deal, and a kraft folder of papers lying in it, its tab up
 * (the "one folder per client" of § B5; the same in every drawer).
 */
export function drawerBox(R: Rng, seed: number, dw: number, depth: number, y0: number, sh: number): KitPart[] {
  const parts: KitPart[] = [];
  const z0 = -depth;
  for (const sx of [-1, 1]) parts.push(part('wood', bevelBox({ min: [sx * (dw / 2 - 0.05) - 0.012, y0, z0], max: [sx * (dw / 2 - 0.05) + 0.012, y0 + sh, 0], c: 0.004, omit: ['nz', 'pz', 'ny'] }), 'wood-light', { seed: seed + 1, shade: 0.7 }));
  parts.push(part('wood', bevelBox({ min: [-dw / 2 + 0.05, y0, z0], max: [dw / 2 - 0.05, y0 + 0.015, 0], omit: ['nz', 'pz', 'ny', 'nx', 'px'] }), 'wood-light', { seed: seed + 2, shade: 0.45 }));
  // the folder: a kraft cover lying a little askew, papers proud of it, a tab at its back
  const fw = Math.min(0.62, dw - 0.2), fd = depth - 0.1;
  const lay = chain(T(R.spread(0.03), y0 + 0.017, -depth / 2 - 0.02), mat({ rot: [-90, 0, R.spread(5)] }));
  parts.push(part('paper', transform(sheet({ w: fw, h: fd, t: 0.006, nx: 1, ny: 1 }), lay), 'wood-light', { seed: seed + 3, shade: 1.25 }));
  parts.push(part('paper', transform(sheet({ w: fw * 0.3, h: 0.06, t: 0.004, nx: 1, ny: 1 }), chain(lay, T(-fw * 0.22, fd / 2 + 0.025, 0))), 'wood-light', { seed: seed + 4, shade: 1.2 }));
  for (let k = 0; k < 2; k++) {
    const at = chain(lay, T(0.02 + R.spread(0.02) + k * 0.015, -0.01 - k * 0.02, 0.008 + k * 0.004), mat({ rot: [0, 0, R.spread(4)] }));
    parts.push(part('paper', transform(sheet({ w: fw - 0.08, h: fd - 0.06, t: 0.002, nx: 1, ny: 1 }), at), 'paper', { seed: seed + 5 + k, shade: 0.95 - k * 0.06 }));
  }
  return parts;
}
