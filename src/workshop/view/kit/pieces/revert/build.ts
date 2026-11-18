/**
 * Revert's geometry: the treads, the strongbox hull with its raked face,
 * two lamp eyes under one heavy brow, the rewind drum and its crank, the
 * card feed, the stubby arm, the broom and the dustpan. Every builder writes
 * into a node in that node's own space (pivot at the origin); rig.ts places
 * the nodes. Detail is spent on the face, the top and the front; the back
 * and the underside get nothing.
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitPart } from '../../types.ts';
import type { NodeBuilder } from '../../compose.ts';
import type { PSample } from '../../profile.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe, profiledBox, roundedBox } from '../../solids.ts';
import type { LatheOptions } from '../../solids.ts';
import { bevelBox, sheet, stripes } from '../../cheap.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { domeRivet, hexBolt } from '../../details.ts';
import { aim, chain, part, place, T, texturedPart } from '../../compose.ts';
import { linear } from '../../../palette.ts';
import { tint } from '../../surface.ts';
import type { Token } from '../../../palette.ts';
import { askew } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { grain, setFinish } from '../../space.ts';
import {
  AXLE_Y, BODY_Y, BROOM, BROW, CARD_STICK, CRANK, DRUM, EYE, EYE_C, FACE, FORE, HULL, LAMP, LID, LOWER, RM, SHOE_L, SHOULDER, SLOT, TAN_RAKE, TRACK, UPPER,
  faceZ,
} from './rig.ts';

type Detail = 'high' | 'low';
export interface Ctx {
  detail: Detail;
  seed: number;
  R: Rng;
}

/** Lathe geometry is built along +Y; these turn it onto +Z and onto +X. */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);
/** Body space: root space less the body's pivot height. */
const by = (y: number): number => y - BODY_Y;
/** The raked face's frame at (x, y): origin on the face, +Z its outward normal, +Y up the slope. */
const onFace = (x: number, y: number, out = 0): Matrix4 => chain(T(x, by(y), faceZ(y)), new Matrix4().makeRotationX(-FACE.rake), T(0, 0, out));

/** A turned part without the wear band (small or far): `band` opts back in. */
const turn = (p: Parameters<typeof lathe>[0], o: LatheOptions = {}): BufferGeometry => lathe(p, { band: 0, support: false, ...o });

/**
 * Revert's enamel: `steel` grey leaned toward `teal-light` (a grey-green
 * nobody could take for Fetch's cream), per vertex. Much more worn than
 * anything else on the bench: its wear signal is pushed up.
 */
export function enamel(
  g: BufferGeometry,
  o: { seed?: number; shade?: number; jitter?: number; wear?: number; toward?: Token; mix?: number; battered?: number; ground?: number } = {},
): KitPart {
  const sh = (o.shade ?? 1) * 0.8;
  const p = part('steel', g, 'steel', { seed: o.seed ?? 0, jitter: o.jitter ?? 0.035, shade: sh, warm: 0.02 });
  const t = linear(o.toward ?? 'teal-light');
  const k = o.mix ?? 0.36;
  const c = p.geometry.getAttribute('color');
  const pos = p.geometry.getAttribute('position');
  const sf = p.geometry.getAttribute('surf');
  const s0 = (o.seed ?? 0) * 0.37;
  for (let i = 0; i < c.count; i++) {
    let r = c.getX(i) * (1 - k) + t[0] * sh * k, gg = c.getY(i) * (1 - k) + t[1] * sh * k, b = c.getZ(i) * (1 - k) + t[2] * sh * k;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (o.ground !== undefined) {
      // road dirt: the lower a surface sits, the dirtier and darker it is
      const wy = y + o.ground;
      const d = 0.78 + 0.22 * Math.min(1, Math.max(0, (wy - 0.12) / 0.5));
      r *= d;
      gg *= d;
      b *= d * 0.97;
    }
    c.setXYZ(i, r, gg, b);
    if (o.battered) {
      // battered all over, not only on its edges: a slow seeded field lifts the wear of whole patches of face
      const f = 0.5 + 0.5 * Math.sin(x * 6.1 + s0) * Math.sin(y * 7.3 + 1.7 + s0) * Math.sin(z * 5.2 + 0.6);
      sf.setX(i, Math.max(sf.getX(i), o.battered * f * f));
    }
  }
  c.needsUpdate = true;
  sf.needsUpdate = true;
  return wearScale(p, o.wear ?? 1.35);
}

/** Scale a part's wear (surf.x), clamped to 1. In place. */
export function wearScale<P extends KitPart>(q: P, k: number): P {
  const sf = q.geometry.getAttribute('surf');
  for (let i = 0; i < sf.count; i++) sf.setX(i, Math.min(1, sf.getX(i) * k));
  sf.needsUpdate = true;
  return q;
}

/** A cheap dome rivet, steel unless told. */
function rivet(d: number, seed: number, token: Token = 'steel', material: 'metal' | 'brass' = 'metal'): KitPart[] {
  return domeRivet({ d, cheap: true, seed, token, material });
}

/** A spherical cap of radius r round +Y from polar angle a0 to a1, as lathe samples (outside rim to the axis). */
function capSamples(r: number, a0: number, a1: number, n: number): PSample[] {
  const out: PSample[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + ((a0 - a1) * i) / n;
    out.push({ o: Math.sin(a) * r, y: Math.cos(a) * r, no: Math.sin(a), ny: Math.cos(a) });
  }
  return out;
}

/**
 * Fold material classes together before the piece is built, so a moving piece
 * draws as few skinned meshes as the eye allows (draw calls are the bench's
 * scarcest thing after triangles). Bare metal reads as worn grey enamel at
 * Revert's size, its wooden handles as painted ones, its lenses as gloss
 * enamel; the colour each part was given stays. Drops the `large` variant.
 */
export function foldClasses(n: NodeBuilder, into: Partial<Record<KitPart['material'], KitPart['material']>>): void {
  for (let i = 0; i < n.parts.length; i++) {
    const q = n.parts[i]!;
    const to = into[q.material];
    if (to) {
      const { variant: _v, ...rest } = q;
      n.parts[i] = { ...rest, material: to };
    }
  }
  for (const c of n.children) foldClasses(c, into);
}

// ---- the treads -------------------------------------------------------------------------

/** The two track frames: a dark core inside each loop and a bolted side plate on the outside. */
export function buildChassis(n: NodeBuilder, c: Ctx): void {
  const { hw, axleZ: a } = TRACK;
  for (const s of [1, -1]) {
    const x = s * TRACK.x;
    // the core the shoes run round: seen between the shoes, never as a gap
    n.add(enamel(bevelBox({ min: [x - hw * 0.9, AXLE_Y - RM + 0.026, -a - RM + 0.03], max: [x + hw * 0.9, AXLE_Y + RM - 0.026, a + RM - 0.03], c: 0.05, omit: [s > 0 ? 'nx' : 'px', 'ny'] }), { seed: c.seed + 1, shade: 0.35, mix: 0.5, toward: 'teal-panel' }));
    // the outer side plate: a stadium of flat bar between the axles
    const r = 0.1;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 5; i++) {
      const t = -Math.PI / 2 + (i / 5) * Math.PI;
      pts.push([a + Math.cos(t) * r, Math.sin(t) * r]);
    }
    for (let i = 0; i <= 5; i++) {
      const t = Math.PI / 2 + (i / 5) * Math.PI;
      pts.push([-a + Math.cos(t) * r, Math.sin(t) * r]);
    }
    const plate = extrude(pts, 0.03, { bevel: 0.012, bevelBase: 0, radius: 0.01, caps: 'end', detail: 'low', segs: 1 });
    // drawn in (z, y), extruded toward +Z: turn so it faces out along ±X
    const pm = chain(T(x + s * (hw + 0.004), AXLE_Y, 0), new Matrix4().makeRotationY((s * Math.PI) / 2));
    n.add(enamel(transform(plate, pm), { seed: c.seed + 2 + s, shade: 0.72, wear: 1.8 }));
    for (const z of [-0.17, 0.17]) {
      const sd = c.R.int(0, 999);
      n.small(() => place(hexBolt({ af: 0.036, cheap: true, detail: 'low', seed: sd }), aim([x + s * (hw + 0.034), AXLE_Y + 0.045, z], [s, 0, 0], c.R.range(0, 60))));
    }
  }
}

/** One end wheel's hub, in its node (axle along X): a brass cap standing out of the side plate, three bolts, so the turn shows. */
export function buildWheel(n: NodeBuilder, side: 1 | -1, c: Ctx, seed: number): void {
  const out = side * (TRACK.hw + 0.034);
  const cap = turn(
    profile(0, 0)
      .to(0.07, 0, { sharp: true })
      .to(0.07, 0.012, { fillet: 0.005, segs: 1 })
      .to(0.05, 0.024, { fillet: 0.008, segs: 1 })
      .curve(0, 0.036, 0.04, 0.036, 2),
    { segs: 10, caps: 'end' },
  );
  n.add(setFinish(part('brass', transform(cap, aim([out, 0, 0], [side, 0, 0])), 'brass', { seed: seed + 1, warm: 0.04, jitter: 0.06 }), 0.35));
  // one steel bolt off centre: the mark that shows the hub turning
  n.small(() => place(hexBolt({ af: 0.026, cheap: true, detail: 'low', seed: seed + 3 }), aim([out + side * 0.016, 0.046, 0.012], [side, 0, 0])));
  void c;
}

/** One track shoe: a moulded rubber pad (outer face +Y, length along Z). */
export function shoeGeometry(side: 1 | -1): BufferGeometry {
  const { hw, shoeT } = TRACK;
  // the face toward the hull is never seen
  return bevelBox({ min: [-hw, -shoeT / 2, -SHOE_L / 2], max: [hw, shoeT / 2, SHOE_L / 2], c: 0.011, omit: ['ny', side > 0 ? 'nx' : 'px'], wear: 0.6 });
}

// ---- the hull ---------------------------------------------------------------------------

export function buildHull(n: NodeBuilder, c: Ctx): void {
  const { w, d, rPlan: rp, y0, y1 } = HULL;
  const h = y1 - y0;
  // the strongbox: a skirt band at its foot, walls leaning in a hair, a heavy rolled top edge, a crowned deck
  const box = profiledBox(
    { w, d, rPlan: rp, detail: c.detail, band: 0 },
    profile(0, 0)
      .to(rp + 0.016, 0, { fillet: 0.012, segs: 1 })
      .to(rp + 0.016, 0.046, { fillet: 0.01, segs: 1 })
      .to(rp, 0.06, { fillet: 0.006, segs: 1 })
      .to(rp - 0.006, h - 0.07, { fillet: 0.06, segs: 2 })
      .to(rp - 0.075, h, { fillet: 0.03, segs: 2 })
      .to(0, h + 0.01),
  );
  // rake the front back from the chin to the deck: the face looks up at the visitor
  const zk = d / 2 - 0.3;
  const raked = deform(transform(box, T(0, y0, 0)), (x, y, z) => {
    const f = Math.min(1, Math.max(0, (z - zk) / (d / 2 - zk)));
    return [x, y - BODY_Y, z - Math.max(0, y - FACE.chin) * TAN_RAKE * f];
  });
  n.add(enamel(raked, { seed: c.seed + 10, wear: 1.5, battered: 0.42, ground: BODY_Y }));
  // the lower hull between the treads, darker, set back under the bumper
  const lower = roundedBox({ w: LOWER.w, h: LOWER.y1 - LOWER.y0, d: LOWER.d, r: 0.04, rPlan: 0.06, detail: 'low', band: 0 });
  n.add(enamel(transform(lower, T(0, by(LOWER.y0), 0)), { seed: c.seed + 11, shade: 0.5, mix: 0.45 }));

  // ---- the face: four fat bolts at its corners, a blank brass maker's plate, a weld seam under the eyes ----
  for (const [x, y] of [[-0.5, 0.405], [0.5, 0.405], [-0.5, 0.685], [0.5, 0.685]] as const) {
    const sd = c.R.int(0, 999);
    n.small(() => place(hexBolt({ af: 0.044, cheap: true, detail: 'low', seed: sd }), chain(onFace(x, y), new Matrix4().makeRotationX(Math.PI / 2), new Matrix4().makeRotationY(c.R.range(0, 1)))));
  }
  {
    const pm = chain(onFace(0.3, 0.392, 0.001), askew(c.seed + 12, 3));
    n.add(setFinish(part('brass', transform(bevelBox({ min: [-0.09, -0.032, 0], max: [0.09, 0.032, 0.009], c: 0.004, omit: ['nz'] }), pm), 'brass', { seed: c.seed + 13, shade: 0.8 }), 0.2));
    for (const s of [-1, 1]) n.small(() => place(rivet(0.016, c.seed + 14 + s, 'brass', 'brass'), chain(pm, T(s * 0.07, 0, 0.009), new Matrix4().makeRotationX(Math.PI / 2))));
  }

  // ---- repairs: a patch plate riveted over a hole low on the face, in paint that never matched;
  // and a strip of floor tape holding the deck's corner together ----
  {
    // on the deck, left of the drum: the top is what the visitor sees most
    const pm = chain(T(-0.4, by(HULL.y1) + 0.009, -0.3), new Matrix4().makeRotationX(-Math.PI / 2), new Matrix4().makeRotationZ(0.16));
    n.add(enamel(transform(bevelBox({ min: [-0.13, -0.06, 0], max: [0.1, 0.05, 0.008], c: 0.004, omit: ['nz'] }), pm), { seed: c.seed + 16, shade: 0.95, mix: 0.5, toward: 'cable-red', wear: 2.5 }));
    for (const [x, y] of [[-0.082, -0.04], [0.082, -0.04], [-0.082, 0.04], [0.082, 0.04]] as const) {
      const sd = c.R.int(0, 999);
      n.small(() => place(rivet(0.016, sd), chain(pm, T(x, y, 0.008), new Matrix4().makeRotationX(Math.PI / 2))));
    }
    const tape = bevelBox({ min: [-0.15, 0, -0.03], max: [0.15, 0.003, 0.03], c: 0.001, omit: ['ny'] });
    const tm = chain(T(0.5, by(HULL.y1) - 0.004, -0.36), new Matrix4().makeRotationY(-0.6));
    n.add(part('steel', deform(transform(tape, tm), (x, y, z) => [x, y - Math.max(0, x - 0.5) * 0.6 - Math.max(0, z - 0.14) * 0.6, z]), 'tape-yellow', { seed: c.seed + 17, shade: 0.85 }));
  }

  // ---- the bumper: a hazard bar between the treads ----
  {
    const bw = LOWER.w - 0.02, bh = 0.15, bd = 0.09;
    const z0 = LOWER.d / 2 - 0.012;
    const bar = roundedBox({ w: bw, h: bh, d: bd, r: 0.026, rPlan: 0.03, detail: 'low', band: 0 });
    n.add(wearScale(part('steel', transform(bar, T(0, by(0.105), z0 + bd / 2)), 'tape-yellow', { seed: c.seed + 20, shade: 0.86, jitter: 0.04 }), 2.2));
    const polys = stripes(bw / 2 - 0.035, bh / 2 - 0.024, 0.06, 0.13, [Math.SQRT1_2, Math.SQRT1_2], c.R.range(0, 0.1));
    for (const poly of polys) {
      const g = extrude(poly, 0.002, { bevel: 0, bevelBase: 0, radius: 0.003, segs: 1, caps: 'end', detail: 'low' });
      n.add(wearScale(part('steel', transform(g, T(0, by(0.105 + bh / 2), z0 + bd)), 'ink', { seed: c.seed + 21, shade: 1.25 }), 2.5));
    }
    for (const s of [-1, 1]) {
      n.add(part('rubber', bevelBox({ min: [s * (bw / 2) - 0.03, by(0.095), z0 - 0.01], max: [s * (bw / 2) + 0.03, by(0.27), z0 + bd + 0.016], c: 0.014, omit: ['nz'] }), 'ink', { seed: c.seed + 22 + s, shade: 1.2 }));
    }
  }

  // ---- the deck: the card slot ----
  {
    const L = 1.12, D = 0.15, t = 0.016, gap = 0.05;
    const y = by(SLOT.y - t);
    for (const [z0, z1, sh] of [[gap / 2, D / 2, 1], [-D / 2, -gap / 2, 0.9]] as const) {
      n.add(setFinish(part('brass', bevelBox({ min: [-L / 2, y, SLOT.z + z0], max: [L / 2, y + t, SLOT.z + z1], c: 0.006, omit: ['ny'] }), 'brass', { seed: c.seed + 30, jitter: 0.04, shade: sh }), 0.25));
    }
    for (const s of [-1, 1]) {
      n.add(part('brass', bevelBox({ min: [s > 0 ? L / 2 - 0.05 : -L / 2, y, SLOT.z - gap / 2], max: [s > 0 ? L / 2 : -L / 2 + 0.05, y + t * 0.9, SLOT.z + gap / 2], c: 0.004, omit: ['ny'] }), 'brass', { seed: c.seed + 31, shade: 0.85 }));
    }
    n.add(part('rubber', bevelBox({ min: [-L / 2 + 0.05, y - 0.02, SLOT.z - gap / 2], max: [L / 2 - 0.05, y + 0.002, SLOT.z + gap / 2], c: 0, omit: ['ny'] }), 'ink', { shade: 0.5 }));
    for (let i = 0; i < 3; i++) {
      const x = -L / 2 + 0.12 + (i * (L - 0.24)) / 2;
      for (const z of [(gap + D) / 4, -(gap + D) / 4]) {
        const sd = c.R.int(0, 999);
        n.small(() => place(rivet(0.022, sd), T(x, y + t, SLOT.z + z)));
      }
    }
  }
}

// ---- the face -----------------------------------------------------------------------------

/** One eye socket, in its node (face plane z = 0, +Z out of the face): a dark cup, a fat brass bezel, a glass lens; the lamp and lid nodes. */
export function buildEye(n: NodeBuilder, lamp: NodeBuilder, lid: NodeBuilder, c: Ctx, seed: number): void {
  const { rs, a } = EYE;
  const capA = Math.asin(a / rs);
  // a dark steel cup the eye is sunk into
  const cup = turn(profile(a + 0.046, -0.014).to(a + 0.046, -0.002, { fillet: 0.004, segs: 1 }).to(a + 0.004, 0.0).to(a, -0.014).close(), { segs: 14 });
  n.add(enamel(transform(cup, Y_TO_Z), { seed: seed + 1, shade: 0.32, mix: 0.6, toward: 'teal-panel' }));
  // the lens: a dark glass dome
  const lens = turn(capSamples(rs, 0, capA + 0.05, 3), { segs: 16, caps: false });
  n.add(setFinish(part('glass', transform(lens, chain(T(0, 0, EYE_C), Y_TO_Z)), 'teal-deep', { shade: 0.75 }), 1));
  // the bezel: a heavy brass ring with a rolled lip
  const bz = turn(
    profile(a - 0.007, -0.004)
      .to(a + 0.03, -0.004, { sharp: true })
      .to(a + 0.03, 0.006, { fillet: 0.005, segs: 1 })
      .to(a + 0.01, 0.019, { fillet: 0.01, segs: 2 })
      .to(a - 0.007, 0.008, { fillet: 0.004, segs: 1 })
      .to(a - 0.007, -0.004)
      .close(),
    { segs: 14 },
  );
  n.add(setFinish(part('brass', transform(bz, Y_TO_Z), 'brass', { seed: seed + 2, warm: 0.04, jitter: 0.05 }), 0.4));
  // the lamp: a lit disc riding on the lens sphere, with a hotter core
  const ir = rs + LAMP.lift;
  const disc = turn([{ o: Math.sin(LAMP.ang) * (rs - 0.002), y: Math.cos(LAMP.ang) * (rs - 0.002), no: Math.sin(LAMP.ang + 0.6), ny: Math.cos(LAMP.ang + 0.6) }, ...capSamples(ir, 0.14, LAMP.ang, 2)], { segs: 14, caps: false });
  lamp.add(setFinish(part('bulb', transform(disc, Y_TO_Z), 'amber'), 1));
  const core = turn(capSamples(ir + 0.0012, 0, 0.15, 2), { segs: 10, caps: false });
  lamp.add(setFinish(part('bulb', transform(core, Y_TO_Z), 'amber-glow'), 1));
  // the lid: a steel shell over the lens, its lip a dead straight line (it can only ever look unimpressed)
  const hw = a + 0.02;
  const Ro = LID.r + LID.t / 2, Ri = LID.r - LID.t / 2;
  const oo = Math.sqrt(Ro * Ro - hw * hw), oi = Math.sqrt(Ri * Ri - hw * hw);
  const sec = profile(oi, -hw)
    .to(oo, -hw, { fillet: LID.t * 0.4, segs: 1 })
    .arc(oo, hw, (Ro - oo) / (2 * hw), 5, { fillet: LID.t * 0.4, segs: 1 })
    .to(oi, hw)
    .arc(oi, -hw, -(Ri - oi) / (2 * hw), 2)
    .close();
  // lathe angle pi/2 turns to the front (+Z) once the axis lies along X; the shell runs from the lip up over the top
  const g = transform(turn(sec, { from: Math.PI / 2, to: Math.PI / 2 + LID.span, segs: 7 }), Y_TO_X);
  lid.add(wearScale(enamel(g, { seed: seed + 5, shade: 0.6, mix: 0.55, toward: 'teal-panel' }), 0.5));
  // the lip: a rolled bead along the lid's edge, darker, so the line of the lid reads from across the bench
  const lip = sweep(
    { points: Array.from({ length: 5 }, (_, i) => {
      const be = (-1 + (2 * i) / 4) * (hw / LID.r) * 0.98;
      const rr = LID.r + LID.t * 0.25;
      return new Vector3(Math.sin(be) * rr, 0.002, Math.cos(be) * rr);
    }) },
    { radius: 0.0065, segs: 5, ends: 'round' },
  );
  lid.add(part('metal', lip, 'ink', { shade: 1.5, seed: seed + 6 }));
  void c;
}

/** The brow: one heavy plate across the face, hinged at its back edge (node origin) on the deck, its nose a thick ledge over the eyes. */
export function buildBrow(n: NodeBuilder, c: Ctx): void {
  const D = BROW.front - BROW.hingeZ;
  const t = BROW.t;
  const plate = roundedBox({ w: BROW.w, h: t, d: D, r: 0.03, rPlan: 0.06, detail: c.detail, band: 0, segs: 3 });
  // it sits on the deck and hangs its nose down over the face; one end a hair lower (seeded)
  const drop = c.R.range(-0.008, 0.008);
  const g = deform(transform(plate, T(0, -t * 0.4, D / 2)), (x, y, z) => {
    const f = Math.max(0, (z - D * 0.3) / (D * 0.7));
    return [x, y - f * f * 0.035 + drop * (x / BROW.w), z];
  });
  // darker than the hull, so from across the bench it reads as one heavy brow over two lamps
  n.add(enamel(g, { seed: c.seed + 50, shade: 0.62, mix: 0.62, toward: 'teal-panel', wear: 2.2 }));
  // a strap of flat bar across its top, riveted
  const strap = bevelBox({ min: [-BROW.w / 2 + 0.07, t * 0.55 - 0.006, D * 0.28], max: [BROW.w / 2 - 0.07, t * 0.55 + 0.01, D * 0.46], c: 0.005, omit: ['ny'] });
  n.add(enamel(strap, { seed: c.seed + 51, shade: 0.5, mix: 0.6, toward: 'teal-panel', wear: 2 }));
  for (let i = 0; i < 5; i++) {
    const x = -BROW.w / 2 + 0.11 + (i * (BROW.w - 0.22)) / 4;
    const sd = c.R.int(0, 999);
    n.small(() => place(rivet(0.026, sd), T(x, t * 0.55 + 0.01, D * 0.37)));
  }
}

// ---- the rewind drum and the crank --------------------------------------------------------

/** The drum's brackets on the deck (body node). */
export function buildDrumStand(n: NodeBuilder, c: Ctx): void {
  for (const x of [DRUM.x0 - 0.03, DRUM.x1 + 0.035]) {
    const g = extrude([[-0.075, 0], [0.075, 0], [0.045, DRUM.y - HULL.y1 + 0.02], [-0.045, DRUM.y - HULL.y1 + 0.02]], 0.04, { bevel: 0.01, bevelBase: 0.01, radius: [0.01, 0.01, 0.04, 0.04], detail: 'low', segs: 1 });
    n.add(enamel(transform(g, chain(T(x + 0.02, by(HULL.y1) - 0.01, DRUM.z), new Matrix4().makeRotationY(Math.PI / 2))), { seed: c.seed + 60, shade: 0.75, wear: 1.8 }));
  }
}

/** The crank and the drum it winds, in the crank node (axis along X; the arm points +Y at angle 0, the handle stands out +X). */
export function buildCrank(n: NodeBuilder, c: Ctx): void {
  const L = CRANK.throw;
  const len = DRUM.x1 - DRUM.x0;
  const x0 = DRUM.x0 - CRANK.x;
  // the drum: brass flanges, a core wound with steel cable (grooves so its turn shows)
  const prof = profile(0, 0.02).to(DRUM.r, 0.02, { sharp: true });
  for (const f of [0.36, 0.64]) prof.to(DRUM.r, len * f - 0.02, { sharp: true }).to(DRUM.r + 0.006, len * f, { fillet: 0.004, segs: 1 }).to(DRUM.r, len * f + 0.02, { sharp: true });
  prof.to(DRUM.r, len - 0.02, { sharp: true }).to(0, len - 0.02);
  n.add(part('metal', transform(turn(prof, { segs: 12, caps: false }), chain(T(x0, 0, 0), Y_TO_X)), 'steel', { seed: c.seed + 69, shade: 0.8 }));
  // brass flange rings over the drum's ends
  for (const x of [x0, x0 + len - 0.024]) {
    n.add(setFinish(part('brass', transform(turn(profile(0, 0).to(DRUM.flange, 0, { fillet: 0.006, segs: 1 }).to(DRUM.flange, 0.024, { fillet: 0.006, segs: 1 }).to(0, 0.024), { segs: 14, caps: true }), chain(T(x, 0, 0), Y_TO_X)), 'brass', { seed: c.seed + 68, warm: 0.04 }), 0.4));
  }
  // the hub nut and the arm: a flat brass bar with a dog-leg out to the handle
  n.add(part('brass', transform(turn(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.024, { fillet: 0.008, segs: 1 }).curve(0, 0.04, 0.036, 0.04, 2), { segs: 10, caps: 'end' }), aim([0.0, 0, 0], [1, 0, 0])), 'brass', { seed: c.seed + 70, warm: 0.04 }));
  const arm = bevelBox({ min: [0.02, -0.03, -0.028], max: [0.046, L + 0.03, 0.028], c: 0.009 });
  n.add(setFinish(part('brass', deform(arm, (x, y, z) => [x + Math.max(0, y - L * 0.5) * 0.12, y, z * (1 - 0.3 * Math.max(0, y) / L)]), 'brass', { seed: c.seed + 71, warm: 0.04 }), 0.45));
  // the handle: a turned wooden grip on a brass pin, standing out sideways
  const hx = 0.046 + L * 0.06;
  n.add(part('brass', transform(turn(profile(0, 0).to(0.024, 0, { sharp: true }).to(0.024, 0.014, { fillet: 0.006, segs: 1 }).to(0, 0.018), { segs: 9, caps: 'end' }), aim([hx, L, 0], [1, 0, 0])), 'brass', { seed: c.seed + 72 }));
  const grip = turn(profile(0, 0).to(0.03, 0, { fillet: 0.008, segs: 1 }).to(0.038, 0.08, { smooth: true }).to(0.03, 0.15, { fillet: 0.012, segs: 1 }).to(0, 0.156), { segs: 10, caps: true });
  n.add(part('wood', transform(grain(grip, 'y'), aim([hx + 0.014, L, 0], [1, 0, 0])), 'wood-light', { seed: c.seed + 73, shade: 0.95 }));
}

// ---- the card feed ------------------------------------------------------------------------

export interface CardSpec {
  key: string;
  w: number;
  h: number;
}

/**
 * A leaf's plain back and cut edge. With a label it samples the card's own blank margin, so the
 * whole card is one textured mesh (one draw call, not two).
 */
function back(card: CardSpec, g: BufferGeometry): KitPart {
  if (!card.key) return part('paper', g, 'paper', { shade: 0.86 });
  const n = g.getAttribute('position').count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = 0.012;
    uv[i * 2 + 1] = 0.5;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return texturedPart('paper', tint(g, 'paper', { shade: 0.86 }), card.key);
}

/** A card leaf: x from x0 to x1 of a card w × h, its face carrying the matching slice of the card's texture. */
function leaf(card: CardSpec, x0: number, x1: number, y0: number, back: boolean): BufferGeometry {
  const lw = x1 - x0;
  const right = x1 > 0;
  const curl = (u: number, v: number): number => 0.014 * Math.sin(Math.PI * u) * v + (right && u > 0.86 && v > 0.84 ? 0.03 * ((u - 0.86) / 0.14) * ((v - 0.84) / 0.16) : 0);
  const g = transform(sheet({ w: lw, h: card.h, t: 0.006, nx: 4, ny: 3, lift: curl, back }), T((x0 + x1) / 2, y0 + card.h / 2, -0.003));
  if (!back) {
    const uv = g.getAttribute('uv') as BufferAttribute;
    const u0 = (x0 + card.w / 2) / card.w, u1 = (x1 + card.w / 2) / card.w;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
    uv.needsUpdate = true;
  }
  return g;
}

/** The card feed, in the card node (pivot at the slot's mouth): the stick, the clip, the card's right leaf; and its left leaf. */
export function buildCard(n: NodeBuilder, left: NodeBuilder, card: CardSpec, c: Ctx): void {
  const r = 0.016;
  n.add(setFinish(grain(part('brass', turn(profile(0, -0.14).to(r, -0.14, { sharp: true }).to(r, CARD_STICK - 0.03, { sharp: true }).to(r * 1.6, CARD_STICK - 0.02, { fillet: 0.004, segs: 1 }).to(r * 1.6, CARD_STICK, { fillet: 0.004, segs: 1 }).to(0, CARD_STICK), { segs: 9, caps: 'end' }), 'brass', { seed: c.seed + 80 }), 'y'), 0.5));
  // the clip: two brass jaws pinching the fold, a pin through them
  const jy = CARD_STICK + 0.035;
  for (const s of [1, -1]) {
    n.add(setFinish(part('brass', bevelBox({ min: [-0.075, CARD_STICK - 0.005, s > 0 ? 0.004 : -0.026], max: [0.075, jy + 0.03, s > 0 ? 0.026 : -0.004], c: 0.006 }), 'brass', { seed: c.seed + 81 + s, shade: s > 0 ? 1 : 0.85 }), 0.35));
  }
  n.add(part('metal', transform(turn(profile(0, -0.085).to(0.008, -0.085, { fillet: 0.003, segs: 1 }).to(0.008, 0.085, { fillet: 0.003, segs: 1 }).to(0, 0.085), { segs: 6, caps: true }), chain(T(0, CARD_STICK + 0.008, 0.03), Y_TO_X)), 'steel'));
  const y0 = jy - 0.01;
  const face = (x0: number, x1: number): KitPart => (card.key ? texturedPart('paper', leaf(card, x0, x1, y0, false), card.key) : part('paper', leaf(card, x0, x1, y0, false), 'paper'));
  n.add(face(0, card.w / 2));
  n.add(back(card, leaf(card, 0, card.w / 2, y0, true)));
  left.add(face(-card.w / 2, 0));
  left.add(back(card, leaf(card, -card.w / 2, 0, y0, true)));
}

// ---- the arm ----------------------------------------------------------------------------

/** The shoulder housing at the face's lower left corner (body node). */
export function buildShoulder(n: NodeBuilder, c: Ctx): void {
  const at: [number, number, number] = [SHOULDER.x + 0.02, by(SHOULDER.y), SHOULDER.z - 0.05];
  const boss = turn(profile(0, -0.04).to(0.082, -0.04, { sharp: true }).to(0.082, 0.0, { fillet: 0.012, segs: 1 }).to(0.06, 0.028, { fillet: 0.01, segs: 1 }).to(0, 0.028), { segs: 12, caps: 'end' });
  n.add(enamel(transform(boss, aim(at, [-0.55, -0.1, 0.83])), { seed: c.seed + 90, shade: 0.66, wear: 1.9 }));
}

export function buildArm(arm: NodeBuilder, fore: NodeBuilder, hand: NodeBuilder, jaws: [NodeBuilder, NodeBuilder], c: Ctx): void {
  // the shoulder ball, then a stubby upper arm in a ridged rubber boot (built hanging down -Y)
  arm.add(setFinish(part('brass', turn(profile(0, -0.05).curve(0.052, -0.004, 0.054, -0.05, 2).curve(0, 0.045, 0.054, 0.045, 2), { segs: 9, caps: false }), 'brass', { seed: c.seed + 100, warm: 0.03 }), 0.35));
  const p = profile(0, -UPPER + 0.02).to(0.044, -UPPER + 0.02, { fillet: 0.008, segs: 1 });
  const k = 2;
  for (let i = 0; i < k; i++) {
    const y = -UPPER + 0.03 + ((i + 0.5) * (UPPER - 0.08)) / k;
    p.to(0.054, y, { fillet: 0.01, segs: 1 }).to(0.044, y + (UPPER - 0.08) / k / 2, { fillet: 0.006, segs: 1 });
  }
  arm.add(part('rubber', turn(p.to(0.04, -0.045, { fillet: 0.004, segs: 1 }).to(0, -0.045), { segs: 8, caps: true }), 'ink', { seed: c.seed + 101, shade: 1.3 }));
  // the elbow knuckle and a short, thick forearm
  fore.add(part('brass', transform(turn(profile(0, -0.05).to(0.04, -0.05, { fillet: 0.012, segs: 1 }).to(0.04, 0.05, { fillet: 0.012, segs: 1 }).to(0, 0.05), { segs: 9, caps: true }), Y_TO_X), 'brass', { seed: c.seed + 102 }));
  const fa = turn(profile(0, -FORE + 0.004).to(0.05, -FORE + 0.004, { fillet: 0.014, segs: 1 }).to(0.053, -FORE + 0.045, { fillet: 0.01, segs: 1 }).to(0.036, -0.03, { smooth: true }).to(0.03, -0.012, { fillet: 0.004, segs: 1 }).to(0, -0.012), { segs: 9, caps: true });
  fore.add(enamel(fa, { seed: c.seed + 103, shade: 0.9, wear: 1.8 }));
  // the hand: a squat palm and two rubber-faced jaws that close about X
  hand.add(enamel(bevelBox({ min: [-0.05, -0.07, -0.036], max: [0.05, -0.02, 0.036], c: 0.014 }), { seed: c.seed + 104, shade: 0.72 }));
  for (const [i, j] of jaws.entries()) {
    const s = i === 0 ? 1 : -1;
    const g = deform(bevelBox({ min: [-0.038, -0.08, -0.009], max: [0.038, 0.004, 0.009], c: 0.007 }), (x, y, z) => [x, y, z + s * 0.012 * Math.sin((-y / 0.08) * Math.PI)]);
    j.add(part('metal', g, 'steel', { seed: c.seed + 105 + i, shade: 0.85 }));
    j.add(part('rubber', bevelBox({ min: [-0.034, -0.095, -s * 0.012 - 0.006], max: [0.034, -0.065, -s * 0.012 + 0.006], c: 0.004 }), 'ink', { seed: c.seed + 107 + i }));
  }
}

// ---- the broom and the dustpan --------------------------------------------------------------

/** The push broom, in its node: bristle tips on y = 0, the handle up +Y. */
export function buildBroom(n: NodeBuilder, c: Ctx): void {
  const hw = BROOM.head / 2;
  // the bristles: a stiff dark block with ridges, worn shorter at one end
  const br = roundedBox({ w: BROOM.head - 0.02, h: 0.075, d: 0.064, r: 0.012, rPlan: 0.014, detail: 'low', band: 0, segs: 1 });
  const bristles = deform(br, (x, y, z) => {
    const worn = y < 0.012 ? 0.012 * (x / hw + 1) : 0;
    return [x, y + worn, z * (y < 0.04 ? 1.12 : 1)];
  });
  n.add(part('rubber', bristles, 'ink', { seed: c.seed + 110, shade: 1.9, jitter: 0.06 }));
  // the stock: a wooden block
  const stock = roundedBox({ w: BROOM.head, h: 0.06, d: 0.084, r: 0.016, rPlan: 0.03, detail: 'low', band: 0, segs: 2 });
  n.add(part('wood', grain(transform(stock, T(0, 0.066, 0)), 'x'), 'wood-light', { seed: c.seed + 111, shade: 0.9 }));
  // the handle in a brass ferrule, a steel brace to the stock
  const hl = BROOM.len - 0.12;
  const handle = turn(profile(0, 0).to(0.021, 0, { sharp: true }).to(0.02, hl, { fillet: 0.008, segs: 1 }).curve(0, hl + 0.022, 0.02, hl + 0.022, 2), { segs: 8, caps: false });
  n.add(part('wood', grain(transform(handle, T(0, 0.12, 0)), 'y'), 'wood-light', { seed: c.seed + 112, shade: 1.05 }));
  n.add(setFinish(part('brass', transform(turn(profile(0, 0).to(0.03, 0, { fillet: 0.004, segs: 1 }).to(0.027, 0.07, { fillet: 0.004, segs: 1 }).to(0, 0.07), { segs: 9, caps: 'end' }), T(0, 0.11, 0)), 'brass', { seed: c.seed + 113, warm: 0.04 }), 0.3));
  const brace = sweep(polylinePath([[-hw * 0.7, 0.12, 0.02], [-0.02, 0.32, 0.024], [hw * 0.7, 0.12, 0.02]], 0.04, 2), { radius: 0.007, segs: 5, ends: 'flat' });
  n.add(part('metal', brace, 'steel', { seed: c.seed + 114, shade: 0.8 }));
}

/** The broom's clips on the left flank (body node): two brass spring clips it rides in when stowed. */
export function buildBroomClips(n: NodeBuilder, stowed: Matrix4, c: Ctx): void {
  for (const y of [0.5, 0.86]) {
    const p = new Vector3(0, y, 0).applyMatrix4(stowed);
    const x = -HULL.w / 2 - 0.004;
    n.add(setFinish(part('brass', bevelBox({ min: [p.x - 0.012, p.y - 0.032, p.z - 0.024], max: [x, p.y + 0.012, p.z + 0.024], c: 0.007, omit: ['px'] }), 'brass', { seed: c.seed + 120, shade: 0.9 }), 0.3));
  }
}

/** The dustpan, carried flat on a bracket off the right flank, its mouth forward (body node): from above it reads as what it is. */
export function buildDustpan(n: NodeBuilder, c: Ctx): void {
  const W = 0.3, D = 0.22, H = 0.1, t = 0.01;
  const parts: KitPart[] = [];
  // the pan: a floor, a back wall, two sloping cheeks (sheet with visible thickness)
  parts.push(part('metal', bevelBox({ min: [-W / 2, 0, 0], max: [W / 2, t, D], c: 0.003 }), 'steel', { seed: c.seed + 130, shade: 0.95 }));
  parts.push(part('metal', bevelBox({ min: [-W / 2, 0, -t], max: [W / 2, H, 0], c: 0.003 }), 'steel', { seed: c.seed + 131, shade: 0.88 }));
  for (const s of [-1, 1]) {
    const cheek = extrude([[0, 0], [D * 0.92, 0], [0, H]], t, { bevel: 0.002, bevelBase: 0.002, radius: 0.004, segs: 1, detail: 'low' });
    parts.push(part('metal', transform(cheek, chain(T(s * W / 2 - (s > 0 ? t : 0), 0, 0), new Matrix4().makeRotationY(-Math.PI / 2))), 'steel', { seed: c.seed + 132, shade: 0.82 }));
  }
  // a short turned handle off the back wall
  parts.push(part('wood', grain(transform(turn(profile(0, 0).to(0.019, 0, { fillet: 0.005, segs: 1 }).to(0.017, 0.15, { fillet: 0.006, segs: 1 }).to(0, 0.152), { segs: 8, caps: true }), chain(T(0, H * 0.6, -t), new Matrix4().makeRotationX(-Math.PI / 2 - 0.5))), 'y'), 'wood-light', { seed: c.seed + 133, shade: 0.85 }));
  // on its bracket over the right tread, mouth forward, a little askew
  const m = chain(T(HULL.w / 2 + 0.11, by(0.43), -0.04), new Matrix4().makeRotationY(-0.12), new Matrix4().makeRotationX(0.12), T(0, 0, -D * 0.5));
  for (const q of parts) n.add({ ...q, geometry: transform(q.geometry, m) });
  // its bracket: a bent strap off the flank that the pan sits in
  for (const z of [-0.12, 0.06]) n.add(setFinish(part('brass', bevelBox({ min: [HULL.w / 2 - 0.01, by(0.405), z - 0.022], max: [HULL.w / 2 + 0.2, by(0.43), z + 0.022], c: 0.008, omit: ['nx'] }), 'brass', { seed: c.seed + 134 }), 0.3));
}

export { Y_TO_Z, Y_TO_X, by };
