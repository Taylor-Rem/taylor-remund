/**
 * Pitch: "a pompous little businessman airship who takes his job very
 * seriously" (Taylor, 2026-11-21). The crew's account man: a courier who
 * brings what is asked for to the middle of the bench and presents it, and
 * shows a few big words on a towed banner. A LOOK SKETCH for the owner's eye
 * (brief C1): nothing here is in the bench scene or the simulation.
 *
 * Round two (the lead, 2026-11-21: "he reads as a bomb"): one plump body, a
 * balloon not a projectile. About 1.35 times as long as he is round, widest
 * forward of the middle (a pot belly under the waistcoat), a blunt round nose,
 * a round tail, four small soft fins set diagonally, a briefcase hung from the
 * envelope on lines, and he always flies level. On it, two takes:
 *
 *   A  "the pinstripe": a bowler, the suit cloth with a chalk stripe (the gore
 *      seams), a white collar under the chin and a bold red tie, a monocle on
 *      a chain over one heavy-lidded eye, a handlebar moustache, and a
 *      furled umbrella that the winch lowers by its tip: its crook catches the
 *      crate's sling.
 *   C  "the chairman": the same gentleman in a stovepipe topper, with a gold
 *      watch chain across his middle.
 *
 * The suit comes in cloths (`cloth`): 'flannel' (mid grey, chalk stripe),
 * 'linen' (cream, a tan stripe) and 'charcoal' (round one's). The rig is in
 * rig.ts; the banner and the mooring mast are their own catalogue pieces
 * (drawn only while they are wanted).
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, linePath, sections } from '../../sweep.ts';
import { bevelBox } from '../../cheap.ts';
import { aim, chain, mat, piece, place, T, texturedPart } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { rng } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { setFinish } from '../../space.ts';
import { linear } from '../../../palette.ts';
import type { Token } from '../../../palette.ts';
import { colourBy, hullBand, hullGeometry, hullR, hullRibbons, onHull } from './hull.ts';
import type { HullShape, RGB } from './hull.ts';
import { EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, poseMatrices } from './rig.ts';
import type { Cloth, ExpressionName, Hook, Moustache, PitchPose, Pivots, Take } from './rig.ts';

export { EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, RIG, HIDDEN, poseMatrices, posePitch, lidAngle } from './rig.ts';
export type { Cloth, ExpressionName, Hook, Moustache, PitchPose, Pivots, Take } from './rig.ts';

export interface PitchOptions extends KitOptions {
  take?: Take;
  cloth?: Cloth;
  /** Default: the handlebar (the pencil was tried under the fedora and reads as a grimace at bench scale). */
  moustache?: Moustache;
  /** What the winch lowers (default the cane). */
  hook?: Hook;
  /** The fedora's felt: 'brown' (default) or 'grey'. */
  felt?: 'brown' | 'grey';
  pose?: ExpressionName | PitchPose;
}

/** Lathe geometry is built along +Y; this turns it to face +Z. */
const Y_TO_Z = new Matrix4().makeRotationX(Math.PI / 2);
/** And this turns it to face -Z. */
const Y_TO_NZ = new Matrix4().makeRotationX(-Math.PI / 2);
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

// ---- tones, mixed from palette tokens (no literals) -----------------------------------------

const mix = (a: Token, b: Token, t: number, shade = 1): RGB => {
  const A = linear(a), B = linear(b);
  return [(A[0] + (B[0] - A[0]) * t) * shade, (A[1] + (B[1] - A[1]) * t) * shade, (A[2] + (B[2] - A[2]) * t) * shade];
};
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

interface Tones {
  cloth: RGB;
  stripe: RGB;
  /** The jacket's collar, the lid's lip, the fins' trailing roll: the cloth, deeper. */
  deep: RGB;
  hat: RGB;
  band: RGB;
  moustache: RGB;
}
const CLOTHS: Record<Cloth, Tones> = {
  flannel: {
    cloth: mix('steel', 'ink', 0.3, 0.52),
    stripe: mix('paper', 'paper', 0, 0.96),
    deep: mix('steel', 'ink', 0.6, 0.42),
    hat: mix('ink', 'teal-deep', 0.15, 0.8),
    band: mix('ink', 'cable-red', 0.12, 0.62),
    moustache: mix('ink', 'wood', 0.35, 0.85),
  },
  linen: {
    cloth: mix('wood-light', 'paper', 0.15, 0.42),
    stripe: mix('paper', 'paper', 0, 0.9),
    deep: mix('wood-light', 'wood', 0.6, 0.55),
    hat: mix('wood', 'ink', 0.35, 0.8),
    band: mix('ink', 'wood', 0.25, 0.7),
    moustache: mix('wood', 'ink', 0.25, 0.8),
  },
  charcoal: {
    cloth: mix('ink', 'steel', 0.16, 1.05),
    stripe: mix('paper', 'paper', 0, 0.86),
    deep: mix('ink', 'teal-deep', 0.25, 0.9),
    hat: mix('ink', 'teal-deep', 0.15, 0.8),
    band: mix('ink', 'cable-red', 0.12, 0.62),
    moustache: mix('paper', 'paper', 0, 0.97),
  },
};
const SHIRT: RGB = mix('paper', 'paper', 0, 0.95);
const TIE: RGB = mix('cable-red', 'button-red', 0.25, 1.0);
const TIE_STRIPE: RGB = mix('paper', 'brass', 0.2, 0.9);
const LEATHER: RGB = mix('wood', 'cable-red', 0.18, 0.62);
const LEATHER_DARK: RGB = mix('wood', 'ink', 0.45, 0.6);
const ROPE: RGB = mix('wood-light', 'paper', 0.35, 0.9);
const BRASS: RGB = linear('brass');

/** Write one colour into a geometry (with a little seeded tone jitter). */
function tone(g: BufferGeometry, c: RGB, R?: Rng, jitter = 0.02): BufferGeometry {
  const k = 1 + (R ? R.spread(jitter) : 0);
  return colourBy(g, () => [c[0] * k, c[1] * k, c[2] * k]);
}
const lump = (material: KitPart['material'], g: BufferGeometry, c: RGB, R?: Rng, jitter = 0.02): KitPart => ({ material, geometry: tone(g, c, R, jitter) });

/** Scale wear (surf.x) and optionally set finish (surf.z). In place. */
function wear<T extends KitPart>(q: T, k: number, finish?: number): T {
  const sf = q.geometry.getAttribute('surf');
  for (let i = 0; i < sf.count; i++) {
    sf.setX(i, sf.getX(i) * k);
    if (finish !== undefined) sf.setZ(i, finish);
  }
  sf.needsUpdate = true;
  return q;
}

/** A turned part without a wear band. */
const turn = (p: Parameters<typeof lathe>[0], o: Parameters<typeof lathe>[1] = {}): BufferGeometry => lathe(p, { band: 0, ...o });

/** A small dome stud (a rivet, a button), built along +Y. */
function stud(d: number, segs = 7): BufferGeometry {
  const r = d / 2, h = r * 0.75;
  return turn(profile(0, 0).to(r, 0, { sharp: true }).curve(0, h, r * 0.95, h * 1.05, 2), { segs, support: false, caps: 'end' });
}

const line = (a: Vector3 | [number, number, number], b: Vector3 | [number, number, number], r = 0.0032): BufferGeometry =>
  sweep(linePath(a instanceof Vector3 ? [a.x, a.y, a.z] : a, b instanceof Vector3 ? [b.x, b.y, b.z] : b, 1), { radius: r, segs: 4, ends: 'flat' });

// ---- the body -------------------------------------------------------------------------------

/** The one body both takes share: plump, widest forward, blunt nose, round tail. */
export const BODY: HullShape = { nose: 0.34, tail: 0.6, r: 0.31, noseK: 2.0, tailK: 1.9, tailQ: 0.62, sy: 0.96 };
const HEAD = {
  /** The eye: on the upper front of the nose, a big one. */
  eyeZ: 0.235,
  eyeR: 0.1,
  /** The collar: round his neck, leaning so it sits under the chin in front. */
  collarZ: 0.06,
  collarTilt: 0.1,
  hatZ: -0.03,
} as const;
/** The car (the briefcase) hangs a little aft, so the tie hangs clear in front of it. */
const CAR_Z = -0.2;
const STAYS = true;
/** Fins: four small rounded tabs, set diagonally. */
const FIN = { zc: -0.44, a: 0.1, span: 0.1, t: 0.018 } as const;

/** His two running lamps, port and starboard, on the hull's widest girth a little above the middle. */
const LAMPS = [-1, 1].map((s) => onHull(BODY, 0.02, s * (Math.PI / 2 - 0.25), 0.026));

/** Where a take's moving parts pivot (rig.ts poses them). */
export function pivotsOf(take: Take, hook: Hook = 'cane'): Pivots {
  const h = BODY;
  const eyeOn = onHull(h, HEAD.eyeZ, 0, -HEAD.eyeR * 0.5);
  const eyeTilt = ((Math.atan2(eyeOn.n.y, eyeOn.n.z) * 180) / Math.PI) * 0.7;
  const knot = onHull(h, HEAD.collarZ + HEAD.collarTilt - 0.004, Math.PI, 0.02).p;
  return {
    eye: [0, eyeOn.p.y, eyeOn.p.z],
    eyeTilt,
    hat: [0, hullR(h, HEAD.hatZ) * (h.sy ?? 1) + 0.004, HEAD.hatZ],
    hatTilt: take === 'C' ? -4 : take === 'F' ? 7 : 4,
    knot: [0, knot.y, knot.z],
    tieMid: 0.1,
    prop: [0, 0, -h.tail - 0.03],
    rudder: [0, 0, FIN.zc],
    tow: [0, -0.05, -h.tail - 0.05],
    car: [0, -h.r * (h.sy ?? 1), CAR_Z],
    drum: [0, -0.375, 0.02],
    sling: hook === 'cane' ? [0.05, -0.372, 0] : [0.03, -0.1, 0],
    lamps: LAMPS.map((l) => [l.p.x, l.p.y, l.p.z] as [number, number, number]),
  };
}

export function pitch(o: PitchOptions = {}): Piece {
  const take = o.take ?? 'A';
  const tones = CLOTHS[o.cloth ?? 'flannel'];
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const hookKind = o.hook ?? 'cane';
  const pv = pivotsOf(take, hookKind);
  const b = piece('pitch', { detail, seed });
  const rest = poseMatrices(NEUTRAL, pv);
  const float = b.node('float', rest.float);

  buildEnvelope(float, tones, take, R.fork(1));
  buildFins(float, tones, R.fork(2), rest);
  buildProp(float, rest);
  buildEye(float.node('eye', rest.eye), tones, rest, R.fork(3));
  buildMoustache(float, tones, R.fork(7), o.moustache ?? 'handlebar');
  const hat = float.node('hat', rest.hat);
  if (take === 'C') buildTopper(hat, tones, R.fork(4));
  else if (take === 'F') buildFedora(hat, o.felt ?? 'brown', R.fork(4));
  else buildBowler(hat, tones, R.fork(4));
  buildCollar(float, tones, R.fork(5));
  buildTie(float.node('tie', rest.tie), rest, take === 'A' ? 1 : 1.35);
  const car = float.node('car', rest.car);
  buildBriefcase(car, R.fork(6));
  buildWinch(car, rest, pv.drum[1], hookKind);

  b.socket('tow', mat({ at: [pv.tow[0], pv.tow[1] + NEUTRAL.float, pv.tow[2]] }));
  const built = b.build();
  // parts that move far from where they were baked keep a light cavity
  clearCavity(built.root, new Set(['sling', 'lid', 'hat', 'tie', 'tieTip', 'hook', 'cable']), 0.15);
  if (o.pose) applyPose(built, typeof o.pose === 'string' ? EXPRESSIONS[o.pose] : o.pose, pv);
  return built;
}

function clearCavity(n: PieceNode, names: ReadonlySet<string>, cap: number): void {
  if (names.has(n.name)) {
    for (const q of n.parts) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, Math.min(sf.getY(i), cap));
      sf.needsUpdate = true;
    }
  }
  for (const c of n.children ?? []) clearCavity(c, names, cap);
}

/** Set a built piece's node transforms to a pose (the cavity keeps its rest bake). In place. */
export function applyPose(p: Piece, pose: PitchPose, pv: Pivots): Piece {
  const ms = poseMatrices(pose, pv);
  const walk = (n: PieceNode): void => {
    const m = ms[n.name];
    if (m && n.name !== 'root') n.transform = m.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return p;
}

// ---- the envelope ------------------------------------------------------------------------------

function buildEnvelope(n: NodeBuilder, t: Tones, take: Take, R: Rng): void {
  const h = BODY;
  const lo = n.detail === 'low';
  const env = hullGeometry(h, lo ? 14 : 18, lo ? 16 : 20);
  colourBy(env, (_x, y) => scale(t.cloth, 0.95 + 0.07 * Math.max(-1, Math.min(1, y / h.r))));
  n.add(wear({ material: 'felt', geometry: env }, 0.3));
  // the stripe is the gore seams: twelve, tail cap to the jacket's collar
  const gores = 10;
  const curves: Array<Array<[number, number]>> = [];
  for (let k = 0; k < gores; k++) {
    const phi = (k / gores) * Math.PI * 2 + Math.PI / gores;
    const zEnd = HEAD.collarZ - HEAD.collarTilt * Math.cos(phi) - 0.05;
    const c: Array<[number, number]> = [];
    const steps = lo ? 7 : 10;
    for (let i = 0; i <= steps; i++) c.push([-h.tail * 0.72 + ((zEnd + h.tail * 0.72) * i) / steps, phi]);
    curves.push(c);
  }
  n.add(wear(lump('felt', hullRibbons(h, curves, 0.012, 0.0026), t.stripe, R), 0.2));
  // the tail cap: a brass bearing the propeller shaft runs out of, and the gas valve on top (round two: "something that says balloon")
  n.add(setFinish(wear(lump('brass', transform(turn(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.044, 0.02, { fillet: 0.006, segs: 1 }).to(0.024, 0.04, { fillet: 0.004, segs: 1 }).to(0.012, 0.05).to(0, 0.05), { segs: 12, caps: 'end' }), chain(T(0, 0, -h.tail + 0.03), Y_TO_NZ)), scale(BRASS, 0.85), R), 0.6), 0.05));
  // his running lamps: brass cups with amber domes (they glow; the page gives them halos)
  for (const l of LAMPS) {
    const at = aim([l.p.x - l.n.x * 0.026, l.p.y - l.n.y * 0.026, l.p.z - l.n.z * 0.026], [l.n.x, l.n.y, l.n.z]);
    n.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.014, { fillet: 0.004, segs: 1 }).to(0.022, 0.02, { sharp: true }).to(0, 0.02), { segs: 8, caps: 'end' }), at), BRASS), 0.4));
    n.add(lump('bulb', transform(turn(capSamples(0.02, 0, Math.PI / 2, 2), { segs: 8, caps: false }), chain(at, T(0, 0.016, 0))), linear('amber-glow')));
  }
  const vt = onHull(h, -0.26, 0, -0.004);
  n.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.012, { fillet: 0.004, segs: 1 }).to(0.018, 0.02, { sharp: true }).to(0.018, 0.03, { fillet: 0.004, segs: 1 }).to(0, 0.034), { segs: 8, caps: 'end' }), aim([vt.p.x, vt.p.y, vt.p.z], [vt.n.x, vt.n.y, vt.n.z])), BRASS, R), 0.55));
  if (take === 'C') {
    // the chairman's gold watch chain, swagged across his middle on the side the visitor sees
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      const z = 0.0 - 0.22 * f;
      const phi = -Math.PI / 2 - 0.5 - 0.35 * Math.sin(Math.PI * f);
      pts.push(onHull(h, z, phi, 0.006).p);
    }
    n.add(setFinish(lump('brass', sweep({ points: pts }, { radius: 0.0042, segs: 3, ends: 'flat' }), BRASS), 0.8));
    const fob = onHull(h, -0.22, -Math.PI / 2 - 0.5, 0.0);
    n.add(setFinish(place([lump('brass', stud(0.03, 8), BRASS)], aim([fob.p.x, fob.p.y, fob.p.z], [fob.n.x, fob.n.y, fob.n.z])), 0.7));
  }
}

// ---- fins and propeller -------------------------------------------------------------------------

function buildFins(n: NodeBuilder, t: Tones, R: Rng, rest: Record<string, Matrix4>): void {
  const h = BODY;
  const { zc, a, span, t: th } = FIN;
  const base = (z: number): number => Math.max(0.02, hullR(h, z) - 0.012);
  // a rounded tab in (z, s): along the hull's skin, then a half-ellipse out and back
  const outline: Array<[number, number]> = [];
  for (let i = 0; i <= 3; i++) {
    const z = zc + a - (2 * a * i) / 3;
    outline.push([z, base(z)]);
  }
  for (let i = 1; i < 8; i++) {
    const u = Math.PI - (Math.PI * i) / 8;
    const z = zc + a * Math.cos(u);
    outline.push([z, base(z) + span * Math.sin(u) * (0.75 + 0.25 * Math.sin(u))]);
  }
  const slab = (): BufferGeometry => {
    const g = extrude(outline.map(([z, s]) => [z, -s] as [number, number]), th, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
    transform(g, T(0, 0, -th / 2));
    return transform(g, new Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  };
  // the piping round the tab's edge, in the stripe
  const pipe: Array<[number, number, number]> = outline.slice(3).map(([z, s]) => [0, s, z]);
  const rudder = n.node('rudder', rest.rudder);
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + (k * Math.PI) / 2;
    const about = new Matrix4().makeRotationZ(-phi);
    const parts = [
      wear(lump('felt', transform(slab(), about), t.cloth, R), 0.4),
      wear(lump('felt', transform(sweep({ points: pipe.map(([x, y, z]) => new Vector3(x, y, z)) }, { radius: th * 0.6, segs: 3, ends: 'flat' }), about), t.deep, R), 0.3),
    ];
    // the upper pair are the rudder (they turn together); the lower pair are fixed
    if (k === 0 || k === 3) rudder.add(...parts.map((q) => ({ ...q, geometry: transform(q.geometry, T(0, 0, -zc)) })));
    else n.add(...parts);
  }
}

function buildProp(n: NodeBuilder, rest: Record<string, Matrix4>): void {
  const h = BODY;
  const lo = n.detail === 'low';
  const zp = -h.tail - 0.03;
  const ring = 0.08;
  const hoop = turn(profile(ring - 0.005, -0.012).to(ring + 0.005, -0.012, { sharp: true }).to(ring + 0.006, 0.012, { sharp: true }).to(ring - 0.005, 0.012, { sharp: true }).close(), { segs: lo ? 12 : 14 });
  n.add(setFinish(lump('brass', transform(hoop, chain(T(0, 0, zp), Y_TO_Z)), BRASS), 0.15));
  for (let k = 0; k < 3; k++) {
    const phi = (k * Math.PI * 2) / 3 + Math.PI;
    if (STAYS) n.add(lump('brass', line([Math.sin(phi) * ring, Math.cos(phi) * ring, zp], [Math.sin(phi) * 0.02, Math.cos(phi) * 0.02, zp + 0.035], 0.0035), BRASS));
  }
  const p = n.node('prop', rest.prop);
  p.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.02, 0, { sharp: true }).curve(0, 0.034, 0.022, 0.028, 2), { segs: 9, caps: 'end' }), Y_TO_NZ), scale(BRASS, 0.8)), 0.1));
  const blade = extrude([[-0.007, 0.01], [0.007, 0.01], [0.017, 0.05], [0.013, 0.07], [-0.004, 0.074], [-0.014, 0.052]], 0.005, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
  transform(blade, T(0, 0, -0.0025));
  const twisted = deform(blade, (x, y, z) => {
    const an = 0.5 - y * 3;
    return [x * Math.cos(an) - z * Math.sin(an), y, x * Math.sin(an) + z * Math.cos(an)];
  });
  for (let k = 0; k < 3; k++) p.add(setFinish(lump('brass', transform(twisted.clone(), chain(new Matrix4().makeRotationZ((k / 3) * Math.PI * 2), T(0, 0, -0.01))), mix('brass', 'wood-light', 0.3, 0.8)), 0.1));
}

// ---- the face: the eye, the monocle, the moustache ---------------------------------------------------

function buildEye(eye: NodeBuilder, t: Tones, rest: Record<string, Matrix4>, R: Rng): void {
  const lo = eye.detail === 'low';
  const r = HEAD.eyeR;
  // the eyeball: a dark glass dome facing forward, set half into the nose
  eye.add(setFinish(wear(lump('steel', transform(turn(capSamples(r, 0, Math.PI * 0.62, lo ? 4 : 5), { segs: lo ? 12 : 16, caps: false }), Y_TO_Z), mix('teal-deep', 'ink', 0.5, 0.45)), 0), 1));
  // the iris: a warm lit ring, and the pupil
  eye.add(setFinish(lump('bulb', transform(turn(capSamples(r + 0.0015, 0.13, 0.38, 2), { segs: lo ? 14 : 18, caps: false }), Y_TO_Z), mix('amber', 'amber-glow', 0.75, 1)), 1));
  eye.add(setFinish(wear(lump('steel', transform(turn(capSamples(r + 0.0022, 0, 0.14, 2), { segs: lo ? 10 : 12, caps: false }), Y_TO_Z), mix('ink', 'ink', 0, 0.4)), 0), 1));
  // the lid: a hemispherical shell hinged about the eye's X (0: tucked back, half mast at about 0.47)
  const lid = eye.node('lid', rest.lid);
  const Ro = r + 0.01;
  lid.add(wear(lump('felt', turn(capSamples(Ro, 0, Math.PI / 2, 3), { segs: lo ? 10 : 14, caps: false }), scale(t.cloth, 0.92), R), 0.2));
  const lipPts = Array.from({ length: lo ? 10 : 14 }, (_, i) => {
    const a = (i / (lo ? 10 : 14)) * Math.PI * 2;
    return new Vector3(Math.cos(a) * (Ro - 0.001), 0.001, Math.sin(a) * (Ro - 0.001));
  });
  lid.add(wear(lump('felt', sweep({ points: lipPts, closed: true }, { radius: 0.007, segs: 4 }), t.deep, R), 0.3));
  // the monocle: a brass ring before the eye and its chain looping back down the cheek
  const mr = r + 0.014;
  const ringG = turn(profile(mr - 0.004, -0.004).to(mr + 0.005, -0.004, { sharp: true }).to(mr + 0.005, 0.004, { sharp: true }).to(mr - 0.004, 0.004, { sharp: true }).close(), { segs: lo ? 14 : 18 });
  eye.add(setFinish(lump('brass', transform(ringG, chain(T(0.004, -0.004, r * 0.92), mat({ rot: [4, -8, 0] }), Y_TO_Z)), BRASS), 0.75));
  const pts: Array<[number, number, number]> = [[0.075, -0.06, r * 0.8], [0.11, -0.12, r * 0.35], [0.15, -0.15, 0.0], [0.19, -0.14, -0.1]];
  eye.small(() => [lump('brass', sweep(polylinePath(pts, 0.05, 2), { radius: 0.003, segs: 4, ends: 'flat' }), scale(BRASS, 1.1))]);
}

/** A spherical cap of radius r round +Y from polar angle a0 to a1, as lathe samples (outside facing out). */
function capSamples(r: number, a0: number, a1: number, n: number): Array<{ o: number; y: number; no: number; ny: number }> {
  const out: Array<{ o: number; y: number; no: number; ny: number }> = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + ((a0 - a1) * i) / n;
    out.push({ o: Math.sin(a) * r, y: Math.cos(a) * r, no: Math.sin(a), ny: Math.cos(a) });
  }
  return out;
}

/** The point on the nose's skin in front of (x, y), lifted `lift` along its normal. */
function onNose(x: number, y: number, lift: number): Vector3 {
  const h = BODY;
  const sy = h.sy ?? 1;
  const rho = Math.min(h.r * 0.999, Math.hypot(x, y / sy));
  const z = h.nose * Math.pow(Math.max(0, 1 - Math.pow(rho / h.r, h.noseK)), 1 / h.noseK);
  const phi = Math.atan2(x, y / sy);
  return onHull(h, z, phi, lift).p;
}

/** A handlebar moustache under the eye: two fat curls of felt that taper to waxed points turned up. */
function buildMoustache(n: NodeBuilder, t: Tones, R: Rng, kind: Moustache): void {
  const y0 = -0.035;
  if (kind === 'pencil') {
    // the pencil: a neat thin line, a little gap in the middle, the ends just turned down
    for (const s of [-1, 1]) {
      const path = [[0.012, y0 - 0.004], [0.05, y0 - 0.01], [0.09, y0 - 0.012], [0.115, y0 - 0.022]].map(([x, y]) => onNose(s * x!, y!, 0.01));
      n.add(wear(lump('felt', sweep({ points: path }, { radius: 0.012, segs: 4, ends: 'round', taper: (u) => 1 - 0.5 * u, step: 0.03 }), t.moustache, R), 0.3));
    }
    return;
  }
  for (const s of [-1, 1]) {
    const path = [
      [0.0, y0 + 0.004],
      [0.04, y0 - 0.008],
      [0.085, y0 - 0.014],
      [0.125, y0 - 0.004],
      [0.16, y0 + 0.02],
      [0.18, y0 + 0.055],
      [0.17, y0 + 0.08],
    ].map(([x, y], i) => onNose(s * x!, y!, 0.012 + 0.055 * Math.pow(i / 6, 2)));
    const g = sweep({ points: path }, { radius: 0.022, segs: 4, ends: 'round', taper: (u) => Math.max(0.12, 1 - u * 0.95) * (u < 0.08 ? 0.75 + u * 3 : 1), step: 0.03 });
    n.add(wear(lump('felt', g, t.moustache, R), 0.3));
  }
}

// ---- hats -----------------------------------------------------------------------------------------

/** A: the bowler, generous in the brim so it survives at 40 px. */
function buildBowler(hat: NodeBuilder, t: Tones, R: Rng): void {
  const lo = hat.detail === 'low';
  const k = 1.55;
  const S = new Matrix4().makeScale(k, k, k);
  const crown = turn(profile(0, 0).to(0.098, 0, { sharp: true }).to(0.1, 0.075, { smooth: true }).curve(0.0, 0.158, 0.098, 0.155, lo ? 3 : 5), { segs: lo ? 14 : 18, caps: 'end', filletSegs: 2 });
  hat.add(wear(lump('felt', transform(crown, S), t.hat, R), 0.5));
  const brim = turn(profile(0.092, 0.004).to(0.17, 0.004, { sharp: true }).to(0.176, 0.018, { fillet: 0.006, segs: 1 }).to(0.092, 0.014, { sharp: true }).close(), { segs: lo ? 16 : 22, filletSegs: 1 });
  hat.add(wear(lump('felt', transform(deform(brim, (x, y, z) => [x, y + 1.4 * x * x - 0.4 * z * z, z]), S), t.hat, R), 0.5));
  hat.add(lump('felt', transform(turn(profile(0.1, 0.012).to(0.1035, 0.012, { sharp: true }).to(0.1045, 0.036, { sharp: true }).to(0.1, 0.036).close(), { segs: lo ? 12 : 14 }), S), t.band));
}

/** C: the chairman's stovepipe topper. */
function buildTopper(hat: NodeBuilder, t: Tones, R: Rng): void {
  const lo = hat.detail === 'low';
  const k = 1.45;
  const S = new Matrix4().makeScale(k, k, k);
  const g = turn(
    profile(0, 0.006).to(0.16, 0.006, { sharp: true }).to(0.166, 0.018, { fillet: 0.006, segs: 1 }).to(0.092, 0.022, { sharp: true }).to(0.09, 0.03, { sharp: true }).to(0.1, 0.2, { smooth: true }).to(0.103, 0.21, { fillet: 0.006, segs: 1 }).to(0, 0.212),
    { segs: lo ? 12 : 16, caps: true },
  );
  hat.add(wear(lump('felt', transform(deform(g, (x, y, z) => [x, y + (y < 0.03 ? 1.2 * x * x - 0.3 * z * z : 0), z]), S), t.hat, R), 0.4));
  hat.add(setFinish(wear(lump('steel', transform(turn(profile(0.0915, 0.03).to(0.095, 0.03, { sharp: true }).to(0.0955, 0.062, { sharp: true }).to(0.0925, 0.062).close(), { segs: lo ? 12 : 16 }), S), mix('ink', 'cable-red', 0.3, 0.75)), 0.1), 0.9));
}

/**
 * F: a soft felt fedora, 1930s-40s: a tapered crown with a centre crease and two front pinches, a
 * snap brim down at the front and up at the back, a ribbon band with a small bow; worn a little rakishly.
 */
function buildFedora(hat: NodeBuilder, felt: 'brown' | 'grey', R: Rng): void {
  const lo = hat.detail === 'low';
  const colour: RGB = felt === 'grey' ? mix('steel', 'ink', 0.45, 0.6) : mix('wood', 'ink', 0.2, 0.8);
  const band: RGB = felt === 'grey' ? mix('ink', 'teal-deep', 0.3, 0.8) : mix('ink', 'wood', 0.35, 0.7);
  const k = 1.45;
  const S = chain(new Matrix4().makeRotationZ(-0.12), new Matrix4().makeScale(k, k, k));
  const crown = turn(profile(0, 0).to(0.096, 0, { sharp: true }).to(0.09, 0.09, { smooth: true }).to(0.074, 0.138, { fillet: 0.022, segs: 2 }).to(0, 0.142), { segs: lo ? 14 : 20, caps: 'end' });
  const shaped = deform(crown, (x, y, z) => {
    const top = Math.max(0, (y - 0.08) / 0.06);
    const crease = 0.05 * Math.exp(-((x / 0.028) ** 2)) * top * (0.6 + 0.4 * Math.max(0, -z / 0.1 + 0.5));
    const pinch = Math.max(0, z / 0.1) * top * Math.exp(-(((Math.abs(x) - 0.055) / 0.03) ** 2));
    // a teardrop in plan: narrower toward the front
    const taper = 1 - 0.12 * Math.max(0, z / 0.1) * Math.min(1, y / 0.05);
    return [x * taper * (1 - pinch * 0.35), y - crease - pinch * 0.012, z];
  });
  hat.add(wear(lump('felt', transform(shaped, S), colour, R), 0.4));
  const brim = turn(profile(0.09, 0.004).to(0.152, 0.004, { sharp: true }).to(0.156, 0.012, { fillet: 0.004, segs: 1 }).to(0.09, 0.012, { sharp: true }).close(), { segs: lo ? 14 : 18 });
  // the snap: down at the front, up at the back and a little at the sides
  const snapped = deform(brim, (x, y, z) => [x, y - 3.2 * Math.max(0, z - 0.04) ** 2 + 1.6 * Math.max(0, -z) ** 2 + 0.6 * x * x, z]);
  hat.add(wear(lump('felt', transform(snapped, S), colour, R), 0.4));
  hat.add(lump('felt', transform(turn(profile(0.1, 0.01).to(0.0995, 0.01, { sharp: true }).to(0.0985, 0.036, { sharp: true }).to(0.095, 0.036).close(), { segs: lo ? 12 : 16 }), S), band));
  hat.add(lump('felt', transform(bevelBox({ min: [0.096, 0.012, -0.03], max: [0.108, 0.034, -0.004], c: 0.003 }), S), band));
}

// ---- collar and tie ----------------------------------------------------------------------------------

function buildCollar(n: NodeBuilder, t: Tones, R: Rng): void {
  const h = BODY;
  const kz = HEAD.collarZ, tl = HEAD.collarTilt;
  const segs = n.detail === 'low' ? 16 : 20;
  // the shirt collar, white, and the jacket's collar behind it in the cloth's deep tone
  n.add(wear(lump('paper', hullBand(h, kz - 0.028, kz + 0.024, 0.015, segs, tl), SHIRT, R), 0.25));
  n.add(wear(lump('felt', hullBand(h, kz - 0.062, kz - 0.026, 0.02, segs, tl), t.deep, R), 0.5));
  // the collar's two points, turned down and out either side of the knot
  for (const s of [-1, 1]) {
    const pts: Array<[number, number]> = [[0, 0], [0.06, 0.004], [0.014, -0.064]];
    const g2 = extrude(pts.map(([x, y]) => [s * x, y] as [number, number]), 0.007, { bevel: 0.002, radius: 0.004, detail: 'low', segs: 1 });
    const at = onHull(h, kz + tl * Math.cos(0.13) + 0.012, Math.PI - s * 0.13, 0.017);
    const fr = new Matrix4().lookAt(new Vector3(0, 0, 0), at.n.clone().negate(), new Vector3(0, 0, 1));
    n.add(wear(lump('paper', transform(g2, chain(T(at.p.x, at.p.y, at.p.z), fr, mat({ rot: [0, 0, s * 6] }))), SHIRT, R), 0.2));
  }
}

/** A wide, short, bold tie: a fat knot at the collar and a blade with two stripes. */
function buildTie(tie: NodeBuilder, rest: Record<string, Matrix4>, wide = 1): void {
  const W = new Matrix4().makeScale(wide, 1, 1);
  const knot = extrude([[-0.032, 0.008], [0.032, 0.008], [0.02, -0.042], [-0.02, -0.042]], 0.032, { bevel: 0.008, radius: 0.007, detail: 'low', segs: 1, style: 'chamfer' });
  tie.add(wear(lump('felt', transform(knot, chain(W, T(0, 0, -0.012))), TIE), 0.4));
  const mid = 0.1;
  const upper = extrude([[-0.024, -0.03], [0.024, -0.03], [0.044, -mid - 0.004], [-0.044, -mid - 0.004]], 0.012, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
  tie.add(wear(lump('felt', transform(upper, chain(W, T(0, 0, -0.002))), TIE), 0.4));
  const tip = tie.node('tieTip', rest.tieTip);
  const lower = extrude([[-0.044, 0.004], [0.044, 0.004], [0.052, -0.095], [0, -0.145], [-0.052, -0.095]], 0.012, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
  tip.add(wear(lump('felt', transform(lower, chain(W, T(0, 0, -0.002))), TIE), 0.4));
  for (const [node, y, w] of [[tie, -0.065, 0.036], [tip, -0.03, 0.048]] as const) {
    node.add(lump('felt', transform(bevelBox({ min: [-w, y - 0.011, 0.0095], max: [w, y + 0.011, 0.0115], c: 0 }), W), TIE_STRIPE));
  }
}

// ---- the briefcase and its rigging ---------------------------------------------------------------------

/** The gondola: a briefcase on its edge, hung by its handle from a brass bar, the bar and the case on lines from the envelope. */
function buildBriefcase(car: NodeBuilder, R: Rng): void {
  const w = 0.13, hh = 0.19, d = 0.3;
  const top = -0.15;
  const y0 = top - hh;
  car.add(wear(lump('steel', bevelBox({ min: [-w / 2, y0, -d / 2], max: [w / 2, top, d / 2], c: 0.014 }), LEATHER, R, 0.02), 0.15, 0.35));
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    car.add(setFinish(lump('brass', transform(bevelBox({ min: [-0.013, -0.004, -0.013], max: [0.013, 0.03, 0.013], c: 0.004 }), T(sx * (w / 2 - 0.008), y0 - 0.003, sz * (d / 2 - 0.008))), BRASS, R), 0.5));
  }
  for (const sx of [-1, 1]) car.add(setFinish(lump('brass', transform(bevelBox({ min: [0, -0.028, -0.016], max: [0.009, 0.004, 0.016], c: 0.002 }), T(sx > 0 ? w / 2 - 0.002 : -w / 2 - 0.007, top - 0.014, 0)), BRASS, R), 0.7));
  // the handle, a leather arch, and the brass bar through it
  const hp = polylinePath([[0, top + 0.002, -0.07], [0, top + 0.05, -0.056], [0, top + 0.06, 0], [0, top + 0.05, 0.056], [0, top + 0.002, 0.07]], 0.03, 2);
  car.add(wear(lump('steel', sweep(hp, { section: sections.roundRect(0.004, 0.009, 1), radius: 0.004, ends: 'flat', up: [1, 0, 0] }), LEATHER_DARK, R), 0.2, 0.35));
  const barY = top + 0.052;
  car.add(setFinish(lump('brass', sweep(linePath([0, barY, -0.11], [0, barY, 0.11], 1), { radius: 0.008, segs: 8, ends: 'round' }), BRASS), 0.6));
  // the lines: a V from each end of the bar up to the envelope, and four from its flanks to the case's corners
  const at = (z: number, phi: number): Vector3 => {
    const p = onHull(BODY, CAR_Z + z, phi, -0.004).p;
    return new Vector3(p.x, p.y + BODY.r * (BODY.sy ?? 1), p.z - CAR_Z);
  };
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    car.add(lump('paper', line(new Vector3(0, barY, sz * 0.105), at(sz * 0.12, Math.PI + sx * 0.42)), ROPE));
    car.add(lump('paper', line(new Vector3(sx * (w / 2 - 0.006), top, sz * (d / 2 - 0.02)), at(sz * 0.2, Math.PI + sx * 1.0)), ROPE));
  }
}

/** The winch under the case, its line, the umbrella on it (hung by its tip; its crook is the hook) and the rope cradle. */
function buildWinch(car: NodeBuilder, rest: Record<string, Matrix4>, drumY: number, kind: Hook): void {
  for (const s of [-1, 1]) {
    const cheek = extrude([[-0.024, 0.03], [0.024, 0.03], [0.016, -0.012], [-0.016, -0.012]], 0.006, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
    car.add(setFinish(lump('brass', transform(cheek, chain(T(s * 0.036, drumY, 0.02), mat({ rot: [0, 90, 0] }), T(0, 0, -0.003))), BRASS), 0.5));
  }
  const winch = car.node('winch', rest.winch);
  winch.add(setFinish(lump('brass', transform(turn(profile(0, -0.032).to(0.024, -0.032, { sharp: true }).to(0.024, -0.026, { sharp: true }).to(0.015, -0.026, { sharp: true }).to(0.015, 0.026, { sharp: true }).to(0.024, 0.026, { sharp: true }).to(0.024, 0.032, { sharp: true }).to(0, 0.032), { segs: 9, caps: true }), Y_TO_X), BRASS), 0.5));
  winch.add(lump('paper', transform(turn(profile(0, -0.026).to(0.019, -0.026, { sharp: true }).to(0.019, 0.026, { sharp: true }).to(0, 0.026), { segs: 8, caps: false }), Y_TO_X), ROPE));
  const cable = car.node('cable', rest.cable);
  cable.add(lump('paper', line([0, 0, 0], [0, -1, 0], 0.003), ROPE));
  const hook = car.node('hook', rest.hook);
  if (kind === 'cane') {
    // the chairman's cane, hung by its tip: a brass ferrule, a black lacquered shaft, a gold collar and a
    // fat crook whose bowl takes the crate's sling. Chunky on purpose: it has to read at the home framing.
    hook.add(setFinish(lump('brass', turn(profile(0, -0.026).to(0.011, -0.026, { sharp: true }).to(0.008, 0, { sharp: true }).to(0, 0.004), { segs: 7, caps: false }), BRASS), 0.5));
    hook.add(setFinish(wear(lump('steel', turn(profile(0.0105, -0.29).to(0.0125, -0.29, { sharp: true }).to(0.0105, -0.024, { sharp: true }).to(0.0095, -0.024).close(), { segs: 8 }), mix('ink', 'ink', 0, 0.9)), 0.1), 0.85));
    hook.add(setFinish(lump('brass', turn(profile(0.012, -0.31).to(0.0165, -0.31, { sharp: true }).to(0.0165, -0.284, { sharp: true }).to(0.012, -0.284).close(), { segs: 8 }), scale(BRASS, 1.1)), 0.6));
    const crook = polylinePath([[0, -0.305, 0], [0, -0.33, 0], [0.012, -0.362, 0], [0.05, -0.38, 0], [0.088, -0.362, 0], [0.096, -0.33, 0]], 0.02, 2);
    hook.add(setFinish(wear(lump('steel', sweep(crook, { radius: 0.0135, segs: 6, ends: 'round', taper: (u) => 1 - 0.15 * u }), mix('ink', 'ink', 0, 0.9)), 0.1), 0.85));
  } else {
    // a plain brass hook (for comparison): a shackle and a fat J
    hook.add(setFinish(lump('brass', turn(profile(0, -0.02).to(0.012, -0.02, { fillet: 0.004 }).to(0.012, 0, { fillet: 0.004 }).to(0, 0), { segs: 8, caps: true }), BRASS), 0.6));
    const J = polylinePath([[0, -0.02, 0], [0, -0.07, 0], [0.006, -0.1, 0], [0.036, -0.104, 0], [0.044, -0.072, 0]], 0.022, 3);
    hook.add(setFinish(lump('brass', sweep(J, { radius: 0.01, segs: 6, ends: 'round', taper: (t) => 1 - 0.4 * t }), BRASS), 0.5));
  }
  // the cradle: two rope loops round a crate, hanging from the crook's bowl (built for an S crate, 0.3; the pose scales it)
  const sling = hook.node('sling', rest.sling);
  const e = 0.3, topY = -0.1, s2 = e / 2 + 0.004;
  const rope = (pts: Array<[number, number, number]>): KitPart => lump('paper', sweep({ points: pts.map(([x, y, z]) => new Vector3(x, y, z)) }, { radius: 0.0055, segs: 3, ends: 'flat' }), ROPE);
  const bowl: [number, number, number] = [0, 0, 0];
  sling.add(rope([bowl, [-s2, topY, 0], [-s2, topY - e - 0.008, 0], [s2, topY - e - 0.008, 0], [s2, topY, 0], bowl]));
  sling.add(rope([bowl, [0, topY, -s2], [0, topY - e - 0.008, -s2], [0, topY - e - 0.008, s2], [0, topY, s2], bowl]));
}

// ---- the banner ---------------------------------------------------------------------------------

export interface BannerOptions extends KitOptions {
  /** A texture key for the words (on the face the visitor sees when he flies nose to the right). Blank cloth without it. */
  words?: { key: string; w: number; h: number };
  /** Length of the cloth (units). */
  length?: number;
  height?: number;
  /** Ripple amplitude (units). */
  ripple?: number;
}

/**
 * The towed banner (its own piece: drawn only while he shows it). Built in the frame of his tow
 * point: the line runs back (-Z) and a little down to a brass spreader, the cloth trails behind it.
 * Its words read from the visitor's side when he flies broadside with his nose to their right.
 */
export function pitchBanner(o: BannerOptions = {}): Piece {
  const L = o.length ?? 1.7, H = o.height ?? 0.4;
  const R = rng(o.seed ?? 5);
  const b = piece('pitch-banner', { detail: o.detail ?? 'high', seed: o.seed ?? 5, ao: false });
  const z0 = -0.36, yTop = 0.02, yBot = yTop - H;
  const amp = o.ripple ?? 0.035;
  const wave = (z: number): number => {
    const t = (z0 - z) / L;
    return amp * Math.sin(((z0 - z) / 0.42) * Math.PI * 2 + 0.6) * (0.25 + 0.75 * t);
  };
  // the tow line: a bridle from his tail to the spreader's two ends
  for (const y of [yTop, yBot]) b.add(lump('paper', sweep(linePath([0, 0, 0], [0, y, z0 + 0.01], 1), { radius: 0.0035, segs: 4, ends: 'flat' }), mix('wood-light', 'paper', 0.35, 0.9)));
  b.add(setFinish(lump('brass', sweep(linePath([0, yTop + 0.02, z0], [0, yBot - 0.02, z0], 1), { radius: 0.008, segs: 8, ends: 'round' }), linear('brass') as RGB, R), 0.55));
  // the cloth: a rippled sheet, two faces (the words on -X, plain cloth on +X)
  const nz = 24, ny = 3;
  const face = (side: -1 | 1, off = 0, win?: { u0: number; u1: number; v0: number; v1: number }): BufferGeometry => {
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    // the grid covers the window (fractions of the cloth: u from the far end, v from the bottom), uv 0..1 over it
    const w0 = win ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
    for (let i = 0; i <= nz; i++) {
      const u = w0.u1 - ((w0.u1 - w0.u0) * i) / nz;
      const fi = 1 - u; // fraction of the way from the spreader
      const z = z0 - 0.01 - L * fi;
      const x = wave(z);
      const dx = (wave(z - 0.01) - wave(z + 0.01)) / 0.02;
      for (let j = 0; j <= ny; j++) {
        const v = w0.v0 + ((w0.v1 - w0.v0) * j) / ny;
        const y = yBot + H * v;
        const sag = 0.012 * Math.sin(Math.PI * fi) * (1 - v);
        pos.push(x + side * (0.0015 + off), y - sag, z);
        const nl = Math.hypot(1, dx);
        nrm.push((side * 1) / nl, 0, (side * -dx) / nl);
        uv.push((u - w0.u0) / (w0.u1 - w0.u0), (v - w0.v0) / (w0.v1 - w0.v0));
      }
    }
    for (let i = 0; i < nz; i++)
      for (let j = 0; j < ny; j++) {
        const a = i * (ny + 1) + j, c = a + ny + 1;
        // wound to face the side's own way (side -1 faces -X)
        if (side > 0) idx.push(a, c, a + 1, a + 1, c, c + 1);
        else idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    const g = sweep(linePath([0, 0, 0], [0, 0.01, 0], 1), { radius: 0.001, segs: 3 });
    // reuse the kit's attribute set: replace the geometry's buffers with the sheet's
    g.setIndex(idx);
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    const n = pos.length / 3;
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const surf = new Float32Array(n * 3);
    g.setAttribute('surf', new BufferAttribute(surf, 3));
    g.setAttribute('lpos', new BufferAttribute(new Float32Array(pos), 3));
    return g;
  };
  // the cloth's face is plain sailcloth; the words are sprayed over it in stencil (a fact: his name, from the sign)
  b.add(lump('paper', face(-1, 0), mix('paper', 'brass', 0.06, 0.9), R));
  if (o.words) {
    const lw = Math.min(L * 0.92, o.words.w), lh = Math.min(H * 0.8, o.words.h);
    const win = { u0: 0.5 - lw / L / 2, u1: 0.5 + lw / L / 2, v0: 0.5 - lh / H / 2, v1: 0.5 + lh / H / 2 };
    // four coats of spray, so the red reads as red on the cloth and not as a pink wash (one mesh: same texture)
    for (const off of [0.0025, 0.0035, 0.0045, 0.0055]) b.add(texturedPart('paper', face(-1, off, win), o.words.key));
  }
  b.add(lump('paper', face(1), mix('paper', 'brass', 0.1, 0.8), R));
  // a hem along the top and bottom edges
  for (const y of [yTop, yBot]) {
    const pts = Array.from({ length: 13 }, (_, i) => {
      const z = z0 - 0.01 - (L * i) / 12;
      return new Vector3(wave(z), y - (y === yBot ? 0.012 * Math.sin((Math.PI * i) / 12) : 0), z);
    });
    b.add(lump('paper', sweep({ points: pts }, { radius: 0.004, segs: 4, ends: 'flat' }), mix('cable-red', 'paper', 0.1, 0.9)));
  }
  return b.build();
}

// ---- the mooring mast ------------------------------------------------------------------------------

export interface MastOptions extends KitOptions {
  /** Height of the mooring cup above the bench (units, kit scale). */
  height?: number;
}

/**
 * Where he waits: a little mooring mast in the workshop's iron and brass, a cast foot bolted to the
 * bench, a turned column, a ladder of rungs, and at the top a swivelling cup his nose clips into.
 */
export function pitchMast(o: MastOptions = {}): Piece {
  const H = o.height ?? 0.86;
  const R = rng(o.seed ?? 9);
  const detail = o.detail ?? 'high';
  const b = piece('pitch-mast', { detail, seed: o.seed ?? 9 });
  const iron = mix('teal-panel', 'teal-deep', 0.25, 1.0);
  // the foot: a stepped cast base
  b.add(wear(lump('steel', turn(profile(0, 0).to(0.16, 0, { fillet: 0.01, segs: 1 }).to(0.15, 0.03, { fillet: 0.012, segs: 2 }).to(0.08, 0.05, { fillet: 0.02, segs: 2 }).to(0.04, 0.1, { fillet: 0.02, segs: 2 }).to(0, 0.1), { segs: 20, caps: 'end' }), iron, R), 0.8));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.small(() => place([lump('brass', stud(0.026, 6), linear('brass') as RGB)], T(Math.cos(a) * 0.12, 0.028, Math.sin(a) * 0.12)));
  }
  // the column: a slim tapered tube with brass collars
  b.add(wear(lump('steel', turn(profile(0, 0.09).to(0.026, 0.09, { sharp: true }).to(0.018, H - 0.05, { smooth: true }).to(0, H - 0.05), { segs: 12, caps: false }), iron, R), 0.7));
  for (const y of [0.1, H * 0.5, H - 0.06]) b.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.03, 0, { fillet: 0.004 }).to(0.03, 0.018, { fillet: 0.004 }).to(0, 0.018), { segs: 12, caps: true }), T(0, y - 0.009, 0)), linear('brass') as RGB, R), 0.5));
  // a ladder of rungs up the back
  for (let i = 0; i < 6; i++) {
    const y = 0.18 + i * ((H - 0.3) / 5);
    b.small(() => [lump('steel', sweep(polylinePath([[-0.03, y, -0.012], [-0.03, y, -0.04], [0.03, y, -0.04], [0.03, y, -0.012]], 0.008, 2), { radius: 0.004, segs: 4, ends: 'flat' }), iron)]);
  }
  // the head: a swivel bearing and the cup, facing +X (his nose comes in from the right)
  const head = b.node('head', T(0, H - 0.04, 0));
  head.add(setFinish(lump('brass', turn(profile(0, 0).to(0.036, 0, { fillet: 0.006 }).to(0.036, 0.03, { fillet: 0.006 }).to(0, 0.034), { segs: 14, caps: true }), linear('brass') as RGB, R), 0.55));
  head.add(wear(lump('steel', sweep(polylinePath([[0, 0.018, 0], [0.05, 0.02, 0], [0.07, 0.02, 0]], 0.01, 2), { radius: 0.012, segs: 8, ends: 'flat' }), iron, R), 0.6));
  const cup = turn(profile(0, 0).to(0.034, 0.0, { fillet: 0.006 }).to(0.05, 0.034, { fillet: 0.006, segs: 2 }).to(0.044, 0.036, { sharp: true }).to(0.03, 0.012, { smooth: true }).to(0, 0.008), { segs: 16, caps: true });
  head.add(setFinish(lump('brass', transform(cup, chain(T(0.07, 0.02, 0), Y_TO_X)), linear('brass') as RGB, R), 0.6));
  // an amber riding lamp on top (it glows at night; he likes to be seen)
  head.add(lump('bulb', transform(turn(profile(0, 0).to(0.014, 0, { sharp: true }).curve(0, 0.024, 0.016, 0.022, 3), { segs: 10, caps: 'end' }), T(0, 0.034, 0)), linear('amber-glow')));
  return b.build();
}

// ---- catalogue -----------------------------------------------------------------------------------

const POSES = Object.fromEntries(EXPRESSION_NAMES.map((nm) => [nm, { pose: nm }]));

/** The banner's words: TAYLOR REMUND, from the sign's own content (no new words). */
export function bannerWords(labels: Labels, words: readonly string[]): NonNullable<BannerOptions['words']> {
  const key = labels.stencil(words.join(' '), { paint: 'cable-red', capHeight: 0.16 });
  const sz = labels.size(key);
  return { key, w: sz.w, h: sz.h };
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'pitch',
    build: (opts = {}) => {
      const o: PitchOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const t = opts['take'];
      if (t === 'A' || t === 'C' || t === 'F') o.take = t;
      const m = opts['moustache'];
      if (m === 'handlebar' || m === 'pencil') o.moustache = m;
      const hk = opts['hook'];
      if (hk === 'cane' || hk === 'hook') o.hook = hk;
      const f = opts['felt'];
      if (f === 'brown' || f === 'grey') o.felt = f;
      const c = opts['cloth'];
      if (c === 'flannel' || c === 'linen' || c === 'charcoal') o.cloth = c;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) o.pose = pose as ExpressionName;
      else if (pose && typeof pose === 'object') o.pose = pose as PitchPose;
      return pitch(o);
    },
    poses: EXPRESSION_NAMES,
    variants: { ...POSES, A: { take: 'A' }, C: { take: 'C' }, F: { take: 'F' }, linen: { cloth: 'linen' }, low: { detail: 'low' } },
    camera: { distance: 4.2 },
    note: 'Pitch (look sketch, C1, round two): the businessman airship. ?take=A|C|F ?moustache=handlebar|pencil ?felt=brown|grey ?cloth=flannel|linen|charcoal ?pose=rest|proud|greet|carry|strain|lower|present',
  },
  {
    name: 'pitch-banner',
    build: (opts = {}) => {
      const o: BannerOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      const w = opts['words'] as BannerOptions['words'] | undefined;
      if (w && typeof w.key === 'string') o.words = w;
      return pitchBanner(o);
    },
    camera: { distance: 4 },
    note: "Pitch's towed banner (look sketch, C1).",
  },
  {
    name: 'pitch-mast',
    build: (opts = {}) => pitchMast({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(typeof opts['height'] === 'number' ? { height: opts['height'] } : {}) }),
    camera: { distance: 3 },
    note: "Pitch's mooring mast (look sketch, C1).",
  },
];

