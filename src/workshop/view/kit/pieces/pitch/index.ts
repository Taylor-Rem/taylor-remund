/**
 * Pitch: "a pompous little businessman airship who takes his job very
 * seriously" (Taylor, 2026-11-21). The crew's account man: a courier who
 * brings what is asked for to the middle of the bench and presents it, and
 * shows a few big words on a towed banner. A LOOK SKETCH for the owner's eye
 * (brief C1): nothing here is in the bench scene or the simulation.
 *
 * Two takes, built far enough to judge:
 *
 *   A  "the pinstripe": the envelope IS the suit. Charcoal wool felt whose gore
 *      seams are chalk stripes; a white collar round his neck with a dark
 *      jacket collar behind it, a red striped tie hanging free, a bowler, a
 *      monocle on a chain over his one eye, and a briefcase for a gondola,
 *      hung by its own handle from a brass bar under the hull.
 *   B  "the company man": the workshop's own enamel livery, immaculate. A
 *      riveted teal zeppelin in a high gloss, a stiff white collar ring and a
 *      red tie, a double-breasted pair of brass buttons, a homburg pressed out
 *      of the same sheet steel, Fetch's brass-bezelled eye under a cream lid,
 *      and a little lit office for a gondola.
 *
 * Shared: one eye with a heavy upper lid (he lives at half mast), a
 * propeller in a guard ring at the tail, four fins with a hinged rudder, a
 * winch under the car paying out a line to a hook, and a rope cradle for a
 * crate. The rig is in rig.ts; the banner and the mooring mast are their own
 * catalogue pieces (they are drawn only while they are wanted).
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { profile } from '../../profile.ts';
import { extrude, lathe, roundedBox } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, linePath, sections } from '../../sweep.ts';
import { bevelBox } from '../../cheap.ts';
import { aim, chain, mat, merge, part, piece, place, T, texturedPart } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { rng } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { setFinish } from '../../space.ts';
import { linear } from '../../../palette.ts';
import type { Token } from '../../../palette.ts';
import { colourBy, hullBand, hullGeometry, hullR, hullRibbons, onHull } from './hull.ts';
import type { HullShape, RGB } from './hull.ts';
import { EXPRESSIONS, EXPRESSION_NAMES, HIDDEN, NEUTRAL, poseMatrices } from './rig.ts';
import type { ExpressionName, PitchPose, Pivots, Take } from './rig.ts';

export { EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, RIG, HIDDEN, poseMatrices, posePitch, lidAngle } from './rig.ts';
export type { ExpressionName, PitchPose, Pivots, Take } from './rig.ts';

export interface PitchOptions extends KitOptions {
  take?: Take;
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
/** Charcoal suiting: ink lifted toward steel, a breath of teal so it sits in the room. */
const CHARCOAL: RGB = mix('ink', 'steel', 0.16, 1.05);
const CHARCOAL_DEEP: RGB = mix('ink', 'teal-deep', 0.25, 0.9);
/** The chalk stripe: paper, dimmed so it is a stripe and not a light. */
const CHALK: RGB = mix('paper', 'steel', 0.25, 0.72);
const SHIRT: RGB = mix('paper', 'paper', 0, 0.94);
const BOWLER: RGB = mix('ink', 'teal-deep', 0.15, 0.8);
const BOWLER_BAND: RGB = mix('ink', 'cable-red', 0.12, 0.62);
const TIE: RGB = mix('cable-red', 'button-red', 0.25, 1.0);
const LEATHER: RGB = mix('wood', 'cable-red', 0.18, 0.62);
const LEATHER_DARK: RGB = mix('wood', 'ink', 0.45, 0.6);

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

// ---- the takes ------------------------------------------------------------------------------

interface TakeDef {
  hull: HullShape;
  /** z of the eye's centre on the nose (it sits on top, looking forward). */
  eyeZ: number;
  eyeR: number;
  /** z of the tie's knot under the chin. */
  knotZ: number;
  hatZ: number;
  /** Fin root span along z, and how far the fins stand out. */
  fin: { z0: number; z1: number; span: number; t: number };
}

export const TAKES: Record<Take, TakeDef> = {
  A: {
    hull: { nose: 0.4, tail: 0.8, r: 0.24, noseK: 2.2, tailK: 1.6, tailQ: 0.85 },
    eyeZ: 0.3,
    eyeR: 0.082,
    knotZ: 0.07,
    hatZ: 0.13,
    fin: { z0: -0.4, z1: -0.79, span: 0.15, t: 0.014 },
  },
  B: {
    hull: { nose: 0.38, tail: 0.74, r: 0.255, noseK: 2.3, tailK: 1.7, tailQ: 0.95 },
    eyeZ: 0.28,
    eyeR: 0.082,
    knotZ: 0.07,
    hatZ: 0.13,
    fin: { z0: -0.36, z1: -0.73, span: 0.15, t: 0.016 },
  },
  C: {
    hull: { nose: 0.36, tail: 0.5, r: 0.31, noseK: 2.0, tailK: 1.9, tailQ: 0.62, sy: 0.94 },
    eyeZ: 0.22,
    eyeR: 0.07,
    knotZ: 0.24,
    hatZ: 0.0,
    fin: { z0: -0.24, z1: -0.5, span: 0.15, t: 0.014 },
  },
};

/** The car hangs a little aft of the hull's middle, so the tie hangs clear in front of it. */
const CAR_Z = -0.2;

/** Where a take's moving parts pivot (rig.ts poses them). */
export function pivotsOf(take: Take): Pivots {
  const t = TAKES[take];
  const h = t.hull;
  // the eye sits on the upper front of the nose, a little sunk, looking straight ahead
  const eyeOn = onHull(h, t.eyeZ, 0, -t.eyeR * 0.5);
  const eyeAt = eyeOn.p;
  const eyeTilt = (Math.atan2(eyeOn.n.y, eyeOn.n.z) * 180) / Math.PI * 0.75;
  const knot = onHull(h, t.knotZ - 0.012, Math.PI, 0.02).p;
  return {
    eye: [0, eyeAt.y, eyeAt.z],
    eyeTilt,
    hat: [0, hullR(h, t.hatZ) * (h.sy ?? 1) - 0.006, t.hatZ],
    hatTilt: take === 'C' ? -4 : 7,
    knot: [0, knot.y, knot.z],
    tieMid: 0.15,
    prop: [0, 0, -h.tail - 0.035],
    rudder: [0, 0, t.fin.z1 + 0.08],
    tow: [0, -0.06, -h.tail - 0.05],
    car: [0, -h.r * (h.sy ?? 1), CAR_Z],
    drum: [0, take === 'B' ? -0.305 : -0.345, 0.02],
  };
}

export function pitch(o: PitchOptions = {}): Piece {
  const take = o.take ?? 'A';
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const def = TAKES[take];
  const pv = pivotsOf(take);
  const b = piece('pitch', { detail, seed });
  const rest = poseMatrices(NEUTRAL, pv);
  const float = b.node('float', rest.float);

  if (take === 'B') buildHullB(float, def, R.fork(1));
  else buildHullA(float, def, R.fork(1));
  buildFins(float, def, take, R.fork(2), rest);
  buildProp(float, def, take, rest);
  const eye = float.node('eye', rest.eye);
  buildEye(eye, def, take, rest, R.fork(3));
  if (take === 'B') buildHomburg(float.node('hat', rest.hat), R.fork(4));
  else buildBowler(float.node('hat', rest.hat), take, R.fork(4));
  buildCollar(float, def, take, R.fork(5));
  const tie = float.node('tie', rest.tie);
  buildTie(tie, take, rest);
  const car = float.node('car', rest.car);
  if (take === 'B') buildCabin(car, def, R.fork(6));
  else buildBriefcase(car, def, R.fork(6));
  buildWinch(car, rest, pv.drum[1]);

  b.socket('tow', mat({ at: [pv.tow[0], pv.tow[1] + NEUTRAL.float, pv.tow[2]] }));
  const built = b.build();
  // the hidden cradle, tie tip and lid move far from where they were baked: keep their cavity light
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

// ---- A: the suit ------------------------------------------------------------------------------

function buildHullA(n: NodeBuilder, def: TakeDef, R: Rng): void {
  const h = def.hull;
  const lo = n.detail === 'low';
  // the envelope: charcoal wool, a shade lighter along the top where it has been brushed
  const env = hullGeometry(h, lo ? 16 : 20, lo ? 18 : 22);
  colourBy(env, (_x, y) => {
    const k = 0.94 + 0.08 * Math.max(-1, Math.min(1, y / h.r));
    return [CHARCOAL[0] * k, CHARCOAL[1] * k, CHARCOAL[2] * k];
  });
  n.add(wear({ material: 'felt', geometry: env }, 0.3));
  // the chalk stripe is the gore seams: fourteen of them, nose cap to tail cone, skipping the shirt front
  const gores = 10;
  const curves: Array<Array<[number, number]>> = [];
  for (let k = 0; k < gores; k++) {
    const phi = (k / gores) * Math.PI * 2 + Math.PI / gores;
    const c: Array<[number, number]> = [];
    const steps = lo ? 8 : 12;
    for (let i = 0; i <= steps; i++) {
      const zEnd = def.knotZ - 0.06;
      const z = -h.tail * 0.9 + ((zEnd + h.tail * 0.9) * i) / steps;
      c.push([z, phi]);
    }
    curves.push(c);
  }
  n.add(wear(lump('felt', hullRibbons(h, curves, 0.005, 0.0026), CHALK, R), 0.2));
  // the nose cap: a covered button where the gores meet
  const tip = onHull(h, h.nose * 0.93, 0, 0).p;
  n.add(wear(lump('felt', transform(turn(profile(0, 0).to(0.05, 0, { sharp: true }).curve(0, 0.02, 0.048, 0.02, 3), { segs: 14, caps: 'end' }), aim([0, 0, tip.z - 0.004], [0, 0, 1])), CHARCOAL_DEEP, R), 0.4));
  // the tail cone: a turned brass bearing the propeller shaft runs out of
  n.add(wear(lump('brass', transform(turn(profile(0, 0).to(0.032, 0, { fillet: 0.006 }).to(0.024, 0.03, { fillet: 0.004 }).to(0.012, 0.04).to(0, 0.04), { segs: 12, caps: true }), chain(T(0, 0, -h.tail + 0.012), Y_TO_NZ)), linear('brass') as RGB, R), 0.6));
}

// ---- B: the livery ----------------------------------------------------------------------------

function buildHullB(n: NodeBuilder, def: TakeDef, R: Rng): void {
  const h = def.hull;
  const lo = n.detail === 'low';
  const env = hullGeometry(h, lo ? 16 : 20, lo ? 18 : 22);
  // the head (ahead of the collar) in cream enamel, the body in the machines' teal
  const body = linear('teal-panel');
  colourBy(env, (_x, y) => {
    const k = 0.95 + 0.08 * (y / h.r);
    return [body[0] * k, body[1] * k, body[2] * k];
  });
  // immaculate: a high gloss, almost no chips
  n.add(wear({ material: 'steel', geometry: env }, 0.15, 0.7));
  // the frame bands: three teal-light rings standing a little proud, each with its rivets
  const bands = [-0.16, -0.42];
  for (const z of bands) {
    const g = hullBand(h, z - 0.016, z + 0.016, 0.006, lo ? 16 : 20);
    n.add(wear(lump('steel', g, mix('teal-light', 'teal-panel', 0.2, 1.05), R), 0.4, 0.6));
    n.small(() => {
      const out: KitPart[] = [];
      const k = 5;
      for (let i = 0; i < k; i++) {
        const phi = (i / k) * Math.PI * 2 + 0.13;
        const { p, n: nn } = onHull(h, z, phi, 0.0055);
        out.push(...place([lump('brass', stud(0.013, 4), linear('brass') as RGB)], aim([p.x, p.y, p.z], [nn.x, nn.y, nn.z])));
      }
      return out;
    });
  }
  // the nose: a brass cap with a mooring eye
  const tip = onHull(h, h.nose * 0.95, 0, 0).p;
  n.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.045, 0, { sharp: true }).curve(0, 0.024, 0.044, 0.024, 3), { segs: 14, caps: 'end' }), aim([0, 0, tip.z - 0.006], [0, 0, 1])), linear('brass') as RGB, R), 0.55));
  // tail cone bearing
  n.add(wear(lump('brass', transform(turn(profile(0, 0).to(0.03, 0, { fillet: 0.006 }).to(0.022, 0.03, { fillet: 0.004 }).to(0.012, 0.04).to(0, 0.04), { segs: 12, caps: true }), chain(T(0, 0, -h.tail + 0.012), Y_TO_NZ)), linear('brass') as RGB, R), 0.6));
  // the double-breasted pair: two pairs of brass buttons on the chest, behind the collar
  for (const [z, w] of [[-0.0, 0.78], [-0.1, 0.8]] as const) {
    for (const s of [-1, 1]) {
      const { p, n: nn } = onHull(h, z, Math.PI + s * w, 0.0);
      n.add(setFinish(place([lump('brass', stud(0.026, 6), linear('brass') as RGB)], aim([p.x, p.y, p.z], [nn.x, nn.y, nn.z])), 0.6));
    }
  }
}

// ---- fins, rudder and the propeller --------------------------------------------------------------

function buildFins(n: NodeBuilder, def: TakeDef, take: Take, R: Rng, rest: Record<string, Matrix4>): void {
  const h = def.hull;
  const { z0, z1, span, t } = def.fin;
  const hinge = z1 + 0.08; // the rudder's hinge line (aft of it moves)
  const rootAt = (z: number): number => Math.max(0.012, hullR(h, z) - 0.01);
  // a fin's outline in (z, s): root along the hull, a raked leading edge, a straight trailing edge
  const outline = (aft: boolean): Array<[number, number]> => {
    if (!aft) {
      const pts: Array<[number, number]> = [];
      const n0 = 3;
      for (let i = 0; i <= n0; i++) {
        const z = z0 + ((hinge - z0) * i) / n0;
        pts.push([z, rootAt(z)]);
      }
      pts.push([hinge, rootAt(hinge) + span + 0.02], [z0 - (z0 - hinge) * 0.55, rootAt(z0 - (z0 - hinge) * 0.55) + span]);
      return pts;
    }
    return [[0, rootAt(hinge)], [z1 - hinge, rootAt(z1)], [z1 - hinge - 0.01, rootAt(hinge) + span + 0.01], [0, rootAt(hinge) + span + 0.02]];
  };
  const finColour: RGB = take === 'B' ? mix('teal-light', 'teal-panel', 0.15, 1.0) : CHARCOAL;
  const edgeColour: RGB = take === 'B' ? linear('paper') : CHALK;
  const cls: KitPart['material'] = take === 'B' ? 'steel' : 'felt';
  const slab = (pts: Array<[number, number]>): BufferGeometry => {
    // extrude in (x = z along the hull, y = out from the axis), thickness along local z; then lay it in the (z, radial) plane
    const g = extrude(pts.map(([a, s]) => [a, -s] as [number, number]), t, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
    // extrude's outline y is flipped for axis 'z'; the fin now has x = z, y = s, z = thickness 0..t
    transform(g, T(0, 0, -t / 2));
    // map (x, y, z) -> (thickness, radial, along): x->Z, y->Y, z->-X (a proper rotation)
    return transform(g, new Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  };
  // one fin about the axis at angle phi (0 = top)
  const about = (phi: number): Matrix4 => new Matrix4().makeRotationZ(-phi);
  const rudder = n.node('rudder', rest.rudder);
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2;
    const fixed = slab(outline(false));
    n.add(wear(lump(cls, transform(fixed, about(phi)), finColour, R), take === 'B' ? 0.6 : 0.4, take === 'B' ? 0.55 : undefined));
    const aft = slab(outline(true));
    const g = transform(aft, about(phi));
    // the rudder is the upright pair; the side pair's flaps are elevators (fixed in this sketch)
    if (k % 2 === 0) rudder.add(wear(lump(cls, g, take === 'B' ? mix('paper', 'paper', 0.0, 0.9) : CHARCOAL, R), 0.5, take === 'B' ? 0.55 : undefined));
    else n.add(wear(lump(cls, transform(g, T(0, 0, hinge)), take === 'B' ? mix('paper', 'paper', 0.0, 0.9) : CHARCOAL, R), 0.5, take === 'B' ? 0.55 : undefined));
    // piping along the fixed fin's leading edge
    const le: Array<[number, number, number]> = [];
    const a0 = outline(false);
    const tipL = a0[a0.length - 1]!, rootL = a0[0]!;
    for (let i = 0; i <= 1; i++) {
      const f = i;
      const z = rootL[0] + (tipL[0] - rootL[0]) * f, s = rootL[1] + (tipL[1] - rootL[1]) * f;
      le.push([Math.sin(phi) * s, Math.cos(phi) * s, z]);
    }
    const tipT = a0[a0.length - 2]!;
    le.push([Math.sin(phi) * tipT[1], Math.cos(phi) * tipT[1], tipT[0]]);
    n.add(wear(lump(cls === 'felt' ? 'felt' : 'brass', sweep(polylinePath(le, 0.02, 1), { radius: t * 0.62, segs: 3, ends: 'flat' }), cls === 'felt' ? edgeColour : (linear('brass') as RGB), R), 0.5));
  }
}

function buildProp(n: NodeBuilder, def: TakeDef, take: Take, rest: Record<string, Matrix4>): void {
  const h = def.hull;
  const lo = n.detail === 'low';
  const zp = -h.tail - 0.035;
  const ring = 0.11;
  // the guard: a brass hoop round the propeller's disc, held by the four fins' trailing tips
  const hoop = turn(profile(ring - 0.005, -0.015).to(ring + 0.005, -0.015, { sharp: true }).to(ring + 0.006, 0.015, { sharp: true }).to(ring - 0.005, 0.015, { sharp: true }).close(), { segs: lo ? 14 : 18 });
  n.add(setFinish(lump('brass', transform(hoop, chain(T(0, 0, zp), Y_TO_Z)), linear('brass') as RGB), 0.45));
  // the hoop's four stays to the fins
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2 + Math.PI / 4;
    const a: [number, number, number] = [Math.sin(phi) * ring, Math.cos(phi) * ring, zp];
    const bb: [number, number, number] = [Math.sin(phi) * 0.02, Math.cos(phi) * 0.02, zp + 0.05];
    n.add(lump('brass', sweep(linePath(a, bb, 1), { radius: 0.0035, segs: 4, ends: 'flat' }), linear('brass') as RGB));
  }
  const p = n.node('prop', rest.prop);
  // a spinner and three (B: four) paddle blades with a twist
  p.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.022, 0, { sharp: true }).curve(0, 0.04, 0.024, 0.032, 2), { segs: 9, caps: 'end' }), Y_TO_NZ), linear('brass') as RGB), 0.7));
  const blades = take === 'B' ? 4 : 3;
  const blade = extrude([[-0.008, 0.012], [0.008, 0.012], [0.02, 0.06], [0.016, 0.095], [-0.004, 0.1], [-0.016, 0.07]], 0.006, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
  transform(blade, T(0, 0, -0.003));
  const twisted = deform(blade, (x, y, z) => {
    const a = 0.5 - y * 2.5;
    return [x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)];
  });
  for (let k = 0; k < blades; k++) p.add(setFinish(lump('brass', transform(twisted.clone(), chain(new Matrix4().makeRotationZ((k / blades) * Math.PI * 2), T(0, 0, -0.012))), mix('brass', 'wood-light', take === 'B' ? 0.0 : 0.15, 1.0)), 0.5));
}

// ---- the eye -----------------------------------------------------------------------------------

function buildEye(eye: NodeBuilder, def: TakeDef, take: Take, rest: Record<string, Matrix4>, R: Rng): void {
  const lo = eye.detail === 'low';
  const r = def.eyeR;
  // the eyeball: a dark glass dome facing forward, set half into the hull
  const ball = turn(capSamples(r, 0, Math.PI * 0.62, lo ? 4 : 5), { segs: lo ? 14 : 16, caps: false });
  eye.add(setFinish(wear(lump('steel', transform(ball, Y_TO_Z), mix('teal-deep', 'ink', 0.5, 0.45)), 0), 1));
  // the iris: a warm lit ring on the dome, and the pupil
  const iris = turn(capSamples(r + 0.0015, 0.13, 0.36, 2), { segs: lo ? 14 : 18, caps: false });
  eye.add(setFinish(lump('bulb', transform(iris, Y_TO_Z), linear('amber')), 1));
  const pupil = turn(capSamples(r + 0.0022, 0, 0.14, 2), { segs: lo ? 10 : 14, caps: false });
  eye.add(setFinish(wear(lump('steel', transform(pupil, Y_TO_Z), mix('ink', 'ink', 0, 0.4)), 0), 1));
  // the socket: a rim round the eye where it meets the hull
  const rim = turn(profile(r * 0.98, -0.004).to(r + 0.016, -0.004, { fillet: 0.004, segs: 1 }).to(r + 0.014, 0.012, { fillet: 0.008, segs: 2 }).to(r * 0.98, 0.008).close(), { segs: lo ? 14 : 18, filletSegs: 1 });
  if (take === 'B') {
    // Fetch's family: a fat brass bezel, four screws
    eye.add(setFinish(wear(lump('brass', transform(rim, chain(T(0, 0, r * 0.55), Y_TO_Z)), linear('brass') as RGB, R), 0.5), 0.4));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      eye.small(() => place([lump('brass', stud(0.01, 6), linear('steel'))], aim([Math.cos(a) * (r + 0.008), Math.sin(a) * (r + 0.008), r * 0.55 + 0.012], [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1])));
    }
  }
  // the lid: a hemispherical shell over the eye, hinged about the eye's X. At angle 0 it covers the
  // top half of the eye (half mast); -90 tucks it back into the hull (wide open), +90 shuts it.
  const lid = eye.node('lid', rest.lid);
  const Ro = r + 0.01;
  const shell = turn(capSamples(Ro, 0, Math.PI / 2, lo ? 3 : 4), { segs: lo ? 12 : 16, caps: false });
  const lidTone: RGB = take === 'B' ? mix('paper', 'paper', 0, 0.86) : mix('ink', 'steel', 0.42, 1.5);
  const lidCls: KitPart['material'] = take === 'B' ? 'steel' : 'felt';
  lid.add(wear(lump(lidCls, shell, lidTone, R), 0.2, take === 'B' ? 0.6 : undefined));
  // its rolled lip round the open edge, a shade darker
  const lipPts = Array.from({ length: lo ? 12 : 16 }, (_, i) => {
    const a = (i / (lo ? 12 : 16)) * Math.PI * 2;
    return new Vector3(Math.cos(a) * (Ro - 0.001), 0.001, Math.sin(a) * (Ro - 0.001));
  });
  const lipTone: RGB = take === 'B' ? mix('teal-panel', 'teal-panel', 0, 0.8) : CHARCOAL_DEEP;
  lid.add(wear(lump(lidCls, sweep({ points: lipPts, closed: true }, { radius: 0.0055, segs: 4 }), lipTone, R), 0.3, take === 'B' ? 0.5 : undefined));
  // the monocle: a brass ring before the eye and its chain looping back to the hull (A and C)
  if (take !== 'B') {
    const mr = r + 0.012;
    const ringG = turn(profile(mr - 0.004, -0.004).to(mr + 0.005, -0.004, { fillet: 0.003, segs: 1 }).to(mr + 0.005, 0.004, { fillet: 0.003, segs: 1 }).to(mr - 0.004, 0.004).close(), { segs: lo ? 14 : 20, filletSegs: 1 });
    const mon = chain(T(0.004, -0.004, r * 0.92), mat({ rot: [4, -8, 0] }), Y_TO_Z);
    eye.add(setFinish(lump('brass', transform(ringG, mon), linear('brass') as RGB), 0.75));
    // the chain: a slack loop from the ring's lower right, down and back along the cheek
    const c0 = new Vector3(0.06, -0.05, r * 0.85);
    const pts = [c0, new Vector3(0.09, -0.1, r * 0.4), new Vector3(0.12, -0.13, 0.0), new Vector3(0.15, -0.12, -0.08)];
    eye.small(() => [lump('brass', sweep(polylinePath(pts.map((v) => [v.x, v.y, v.z] as [number, number, number]), 0.05, 3), { radius: 0.0028, segs: 4, ends: 'flat' }), mix('brass', 'brass', 0, 1.1))]);
  }
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

// ---- the bowler -------------------------------------------------------------------------------

function buildBowler(hat: NodeBuilder, take: Take, R: Rng): void {
  buildBowlerParts(hat, take, R);
  const k = new Matrix4().makeScale(1.25, 1.25, 1.25);
  for (const q of hat.parts) transform(q.geometry, k);
}

function buildBowlerParts(hat: NodeBuilder, take: Take, R: Rng): void {
  const lo = hat.detail === 'low';
  const top = take === 'C';
  if (top) {
    // C: a stovepipe topper
    const g = turn(
      profile(0, 0.006).to(0.15, 0.006, { fillet: 0.006, segs: 1 }).to(0.158, 0.016, { fillet: 0.006, segs: 2 }).to(0.092, 0.022, { sharp: true }).to(0.092, 0.03, { sharp: true }).to(0.1, 0.19, { smooth: true }).to(0.103, 0.2, { fillet: 0.006, segs: 1 }).to(0, 0.202),
      { segs: lo ? 18 : 26, caps: true },
    );
    hat.add(wear(lump('felt', deform(g, (x, y, z) => [x, y + (y < 0.03 ? 0.6 * x * x - 0.2 * z * z : 0), z]), BOWLER, R), 0.4));
    hat.add(lump('felt', turn(profile(0.0935, 0.03).to(0.096, 0.03, { sharp: true }).to(0.0965, 0.06, { sharp: true }).to(0.0935, 0.06).close(), { segs: lo ? 14 : 18 }), BOWLER_BAND));
    return;
  }
  // the crown: a hard felt dome, the brim curled up at the sides
  const crown = turn(
    profile(0, 0)
      .to(0.098, 0, { sharp: true })
      .to(0.1, 0.05, { smooth: true })
      .to(0.1, 0.07, { smooth: true })
      .curve(0.0, 0.142, 0.098, 0.14, lo ? 3 : 5),
    { segs: lo ? 14 : 18, caps: 'end', filletSegs: 2 },
  );
  hat.add(wear(lump('felt', crown, BOWLER, R), 0.5));
  const brim = turn(
    profile(0.092, 0.004).to(0.152, 0.004, { sharp: true }).to(0.157, 0.016, { fillet: 0.006, segs: 1 }).to(0.092, 0.014, { sharp: true }).close(),
    { segs: lo ? 14 : 18, filletSegs: 1 },
  );
  // curl the sides up, the front and back down a touch (and the whole brim follows the hull's crown)
  hat.add(wear(lump('felt', deform(brim, (x, y, z) => [x, y + 1.5 * x * x - 0.5 * z * z, z]), BOWLER, R), 0.5));
  // the band: grosgrain, a little bow on his left
  hat.add(lump('felt', turn(profile(0.1, 0.012).to(0.1035, 0.012, { sharp: true }).to(0.1045, 0.036, { sharp: true }).to(0.1, 0.036).close(), { segs: lo ? 14 : 18 }), BOWLER_BAND));
  hat.small(() => [lump('felt', roundedBox({ w: 0.012, h: 0.022, d: 0.028, r: 0.004, detail: 'low' }), BOWLER_BAND), ...[]].map((q) => ({ ...q, geometry: transform(q.geometry, T(0.104, 0.013, -0.01)) })));
}

/** B: a homburg pressed out of the workshop's own sheet steel (it is also his gas valve's cap): a creased crown, a curled brim, a brass band. */
function buildHomburg(hat: NodeBuilder, R: Rng): void {
  const lo = hat.detail === 'low';
  const crown = turn(
    profile(0, 0).to(0.112, 0, { sharp: true }).to(0.116, 0.06, { smooth: true }).to(0.108, 0.13, { fillet: 0.03, segs: 3 }).to(0, 0.14),
    { segs: lo ? 14 : 18, caps: 'end', filletSegs: 2 },
  );
  // the centre crease, front to back, and the two pinches at the front
  const creased = deform(crown, (x, y, z) => {
    const top = Math.max(0, (y - 0.08) / 0.06);
    const crease = 0.032 * Math.exp(-((x / 0.03) ** 2)) * top;
    const pinch = 0.012 * Math.max(0, z / 0.11) * top * Math.exp(-(((Math.abs(x) - 0.06) / 0.03) ** 2));
    return [x * (1 - pinch * 3), y - crease, z];
  });
  hat.add(setFinish(wear(lump('steel', creased, mix('teal-light', 'teal-panel', 0.35, 1.0), R), 0.3), 0.6));
  const brim = turn(
    profile(0.105, 0.004).to(0.17, 0.004, { sharp: true }).to(0.176, 0.02, { fillet: 0.007, segs: 1 }).to(0.105, 0.016, { sharp: true }).close(),
    { segs: lo ? 14 : 18, filletSegs: 1 },
  );
  hat.add(setFinish(wear(lump('steel', deform(brim, (x, y, z) => [x, y + 0.9 * x * x - 0.3 * z * z, z]), mix('teal-light', 'teal-panel', 0.35, 0.95), R), 0.4), 0.6));
  hat.add(setFinish(lump('brass', turn(profile(0.113, 0.014).to(0.118, 0.014, { sharp: true }).to(0.119, 0.04, { sharp: true }).to(0.114, 0.04).close(), { segs: lo ? 14 : 18 }), linear('brass') as RGB, R), 0.5));
}

// ---- collar, shirt front and tie ---------------------------------------------------------------------

function buildCollar(n: NodeBuilder, def: TakeDef, take: Take, R: Rng): void {
  const h = def.hull;
  const kz = def.knotZ;
  const segs = n.detail === 'low' ? 18 : 24;
  // the collar: a white band round his neck, between the head (eye, hat) and the body (the suit, the car)
  const white: RGB = take === 'B' ? mix('paper', 'paper', 0, 1.0) : SHIRT;
  const cls: KitPart['material'] = take === 'B' ? 'steel' : 'paper';
  const fin = take === 'B' ? 0.7 : undefined;
  n.add(wear(lump(cls, hullBand(h, kz - 0.03, kz + 0.022, 0.014, segs), white, R), 0.25, fin));
  // A: the jacket's collar, a dark felt roll just behind the shirt collar
  if (take !== 'B') n.add(wear(lump('felt', hullBand(h, kz - 0.062, kz - 0.026, 0.02, segs), CHARCOAL_DEEP, R), 0.5));
  // the collar's two points, turned down and out either side of the knot
  for (const s of [-1, 1]) {
    const pts: Array<[number, number]> = [[0, 0], [0.052, 0.004], [0.012, -0.058]];
    const g2 = extrude(pts.map(([x, y]) => [s * x, y] as [number, number]), 0.007, { bevel: 0.002, radius: 0.004, detail: 'low', segs: 1 });
    const at = onHull(h, kz + 0.01, Math.PI - s * 0.13, 0.016);
    const fr = new Matrix4().lookAt(new Vector3(0, 0, 0), at.n.clone().negate(), new Vector3(0, 0, 1));
    n.add(wear(lump(cls, transform(g2, chain(T(at.p.x, at.p.y, at.p.z), fr, mat({ rot: [0, 0, s * 6] }))), white, R), 0.2, fin));
  }
}

function buildTie(tie: NodeBuilder, take: Take, rest: Record<string, Matrix4>): void {
  const lo = tie.detail === 'low';
  const cls: KitPart['material'] = take === 'B' ? 'steel' : 'felt';
  const fin = take === 'B' ? 0.55 : undefined;
  // the knot: a fat little trapezoid
  const knot = extrude([[-0.024, 0.006], [0.024, 0.006], [0.016, -0.034], [-0.016, -0.034]], 0.026, { bevel: 0.007, radius: 0.006, detail: 'low', segs: 1, style: 'chamfer' });
  tie.add(wear(lump(cls, transform(knot, T(0, 0, -0.008)), TIE), 0.4, fin));
  // the blade, upper half (to the tip node's pivot) and lower half with the point
  const mid = 0.15;
  const upper = extrude([[-0.02, -0.022], [0.02, -0.022], [0.042, -mid - 0.004], [-0.042, -mid - 0.004]], 0.011, { bevel: 0.003, radius: 0.004, detail: 'low', segs: 1 });
  tie.add(wear(lump(cls, transform(upper, T(0, 0, -0.002)), TIE), 0.4, fin));
  const tip = tie.node('tieTip', rest.tieTip);
  const lower = extrude([[-0.042, 0.004], [0.042, 0.004], [0.054, -0.13], [0, -0.185], [-0.054, -0.13]], 0.011, { bevel: 0.003, radius: 0.005, detail: 'low', segs: 1 });
  tip.add(wear(lump(cls, transform(lower, T(0, 0, -0.002)), TIE), 0.4, fin));
  // a stripe across the blade (A: chalk; B: none) and a brass tie pin
  if (take !== 'B') {
    for (const y of [-0.05, -0.095]) {
      tip.add(lump('felt', bevelBox({ min: [-0.047, y - 0.006, 0.0085], max: [0.047, y + 0.006, 0.0105], c: 0 }), mix('cable-red', 'paper', 0.55, 0.85)));
    }
  }
  if (take !== 'B') tie.small(() => [setFinish(lump('brass', bevelBox({ min: [-0.03, -0.07, 0.008], max: [0.03, -0.064, 0.012], c: 0.0015 }), linear('brass') as RGB), 0.8)]);
}

// ---- the cars ---------------------------------------------------------------------------------

/** A: a briefcase, standing on its edge, hung by its own handle from a bar under the hull. */
function buildBriefcase(car: NodeBuilder, def: TakeDef, R: Rng): void {
  const w = 0.13, hh = 0.19, d = 0.36;
  const top = -0.13;
  const y0 = top - hh;
  const body = bevelBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, hh, d / 2], c: 0.012 });
  car.add(wear(lump('steel', transform(body, T(0, y0, 0)), LEATHER, R, 0.02), 0.15, 0.35));
  // brass corners on the four lower corners, and two clasps by the handle on each face
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const c = bevelBox({ min: [-0.012, -0.004, -0.012], max: [0.012, 0.028, 0.012], c: 0.004 });
    car.add(setFinish(lump('brass', transform(c, T(sx * (w / 2 - 0.008), y0 - 0.003, sz * (d / 2 - 0.008))), linear('brass') as RGB, R), 0.5));
  }
  for (const sx of [-1, 1]) for (const sz of [0]) {
    const c = bevelBox({ min: [0, -0.024, -0.014], max: [0.008, 0.004, 0.014], c: 0.002 });
    car.add(setFinish(lump('brass', transform(c, T(sx > 0 ? w / 2 - 0.002 : -w / 2 - 0.006, top - 0.012, sz * 0.09)), linear('brass') as RGB, R), 0.7));
  }
  // the handle: a leather arch between two brass loops, through the hull's carrying bar
  const hp = polylinePath([[0, top + 0.002, -0.08], [0, top + 0.055, -0.064], [0, top + 0.066, 0], [0, top + 0.055, 0.064], [0, top + 0.002, 0.08]], 0.03, 2);
  car.add(wear(lump('steel', sweep(hp, { section: sections.roundRect(0.004, 0.009, 1), radius: 0.004, ends: 'flat', up: [1, 0, 0] }), LEATHER_DARK, R), 0.2, 0.35));
  for (const sz of [-1, 1]) car.add(setFinish(lump('brass', transform(turn(profile(0, 0).to(0.012, 0, { fillet: 0.003 }).to(0.01, 0.012, { fillet: 0.003 }).to(0, 0.012), { segs: 8, caps: 'end' }), T(0, top - 0.002, sz * 0.08)), linear('brass') as RGB), 0.6));
  // the carrying bar under the hull and its two hangers
  const barY = top + 0.058;
  car.add(setFinish(lump('brass', sweep(linePath([0, barY, -0.12], [0, barY, 0.12], 1), { radius: 0.007, segs: 8, ends: 'round' }), linear('brass') as RGB), 0.6));
  for (const sz of [-1, 1]) {
    car.add(lump('brass', sweep(linePath([0, barY, sz * 0.11], [0, 0.03, sz * 0.11], 1), { radius: 0.0065, segs: 6, ends: 'flat' }), linear('brass') as RGB));
    car.add(lump('brass', transform(turn(profile(0, 0).to(0.022, 0, { fillet: 0.004 }).to(0.015, 0.01, { fillet: 0.003 }).to(0, 0.012), { segs: 7, caps: 'end' }), chain(T(0, 0.012, sz * 0.11), new Matrix4().makeRotationX(Math.PI))), linear('brass') as RGB));
  }
  // rigging: four lines from the hull's flanks to the case's top corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hullPt = onHull(def.hull, CAR_Z + sz * 0.24, Math.PI + sx * 0.95, 0.0).p;
    const a: [number, number, number] = [hullPt.x, hullPt.y + def.hull.r, hullPt.z - CAR_Z];
    const bb: [number, number, number] = [sx * (w / 2 - 0.01), top - 0.004, sz * (d / 2 - 0.03)];
    car.small(() => [lump('paper', sweep(linePath(a, bb, 1), { radius: 0.0026, segs: 4, ends: 'flat' }), mix('paper', 'wood-light', 0.4, 0.85))]);
  }
}

/** B: a little office: cream walls over a teal skirt, a row of lit windows, a brass rail. */
function buildCabin(car: NodeBuilder, def: TakeDef, R: Rng): void {
  const w = 0.15, hh = 0.14, d = 0.33;
  const top = -0.1;
  const y0 = top - hh;
  const body = roundedBox({ w, h: hh, d, r: 0.022, rPlan: 0.05, segs: 1, detail: car.detail });
  colourBy(body, (_x, y) => (y < hh * 0.42 ? mix('teal-panel', 'teal-panel', 0, 1.0) : mix('paper', 'paper', 0, 0.88)));
  car.add(setFinish(wear({ material: 'steel', geometry: transform(body, T(0, y0, 0)) }, 0.25), 0.6));
  // roof: a teal-light cap
  const roof = roundedBox({ w: w + 0.012, h: 0.018, d: d + 0.012, r: 0.008, rPlan: 0.055, segs: 1, detail: car.detail });
  car.add(setFinish(wear(lump('steel', transform(roof, T(0, top - 0.004, 0)), mix('teal-light', 'teal-panel', 0.2, 1.0), R), 0.4), 0.55));
  // windows: three a side and one at the front, lit from inside
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -0.095 + i * 0.095;
    const win = bevelBox({ min: [-0.003, -0.023, -0.029], max: [0.003, 0.023, 0.029], c: 0.002 });
    car.add(lump('bulb', transform(win, T(s * (w / 2 - 0.0015), top - 0.055, z)), mix('amber', 'amber-glow', 0.5, 0.55)));
  }
  // a brass rail round the cabin's waist
  const rail = polylinePath([[-w / 2 - 0.01, y0 + 0.055, -d / 2 + 0.03], [-w / 2 - 0.01, y0 + 0.055, d / 2 - 0.03], [w / 2 + 0.01, y0 + 0.055, d / 2 - 0.03], [w / 2 + 0.01, y0 + 0.055, -d / 2 + 0.03]], 0.04, 3);
  car.add(setFinish(lump('brass', sweep(rail, { radius: 0.0042, segs: 5, ends: 'round' }), linear('brass') as RGB), 0.6));
  // struts up to the hull
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    car.add(lump('brass', sweep(linePath([sx * 0.045, top, sz * 0.1], [sx * 0.06, 0.03, sz * 0.12], 1), { radius: 0.005, segs: 5, ends: 'flat' }), linear('brass') as RGB));
  }
  void def;
}

/** The winch under the car, its line and its hook, and the rope cradle for a crate. */
function buildWinch(car: NodeBuilder, rest: Record<string, Matrix4>, drumY: number): void {
  const lo = car.detail === 'low';
  // two cheeks from the car's keel holding the drum's axle
  for (const s of [-1, 1]) {
    const cheek = extrude([[-0.024, 0.03], [0.024, 0.03], [0.016, -0.012], [-0.016, -0.012]], 0.006, { bevel: 0, bevelBase: 0, radius: 0, detail: 'low', segs: 1 });
    car.add(setFinish(lump('brass', transform(cheek, chain(T(s * 0.036, drumY, 0.02), mat({ rot: [0, 90, 0] }), T(0, 0, -0.003))), linear('brass') as RGB), 0.5));
  }
  const winch = car.node('winch', rest.winch);
  // the drum (turns as the line pays out): flanged, with a few turns of line on it
  winch.add(setFinish(lump('brass', transform(turn(profile(0, -0.032).to(0.024, -0.032, { sharp: true }).to(0.024, -0.026, { sharp: true }).to(0.015, -0.026, { sharp: true }).to(0.015, 0.026, { sharp: true }).to(0.024, 0.026, { sharp: true }).to(0.024, 0.032, { sharp: true }).to(0, 0.032), { segs: 9, caps: true }), Y_TO_X), linear('brass') as RGB), 0.5));
  winch.add(lump('paper', transform(turn(profile(0, -0.026).to(0.019, -0.026, { sharp: true }).to(0.019, 0.026, { sharp: true }).to(0, 0.026), { segs: 8, caps: false }), Y_TO_X), mix('steel', 'paper', 0.25, 0.9)));
  // a crank on the right cheek
  car.small(() => [lump('brass', sweep(polylinePath([[0.045, drumY, 0.02], [0.05, drumY, 0.02], [0.05, drumY - 0.03, 0.03]], 0.006, 2), { radius: 0.003, segs: 4, ends: 'round' }), linear('brass') as RGB)]);
  // the line: unit length down -Y from the drum's underside (the pose scales it)
  const cable = car.node('cable', rest.cable);
  cable.add(lump('paper', transform(sweep(linePath([0, 0, 0], [0, -1, 0], 1), { radius: 0.0032, segs: 4, ends: 'flat' }), T(0, -0.0, 0)), mix('steel', 'paper', 0.25, 0.9)));
  // the hook: a brass shackle and a steel hook
  const hook = car.node('hook', rest.hook);
  hook.add(setFinish(lump('brass', transform(turn(profile(0, -0.012).to(0.01, -0.012, { fillet: 0.003 }).to(0.01, 0.0, { fillet: 0.003 }).to(0, 0), { segs: 8, caps: true }), T(0, -0.0, 0)), linear('brass') as RGB), 0.6));
  const J = polylinePath([[0, -0.012, 0], [0, -0.045, 0], [0.004, -0.07, 0], [0.028, -0.072, 0], [0.032, -0.05, 0]], 0.018, 3);
  hook.add(setFinish(lump('brass', sweep(J, { radius: 0.0065, segs: 5, ends: 'flat', taper: (t) => 1 - 0.45 * t, step: 0.02 }), mix('steel', 'steel', 0, 1.15)), 0.5));
  // the cradle: two rope loops round a crate hanging from the hook's bowl (sized to an S crate, 0.3; the pose scales it)
  const sling = hook.node('sling', rest.sling);
  const e = 0.3, topY = -0.1, s2 = e / 2 + 0.004;
  const rope = (pts: Array<[number, number, number]>): KitPart => lump('paper', sweep({ points: pts.map(([x, y, z]) => new Vector3(x, y, z)) }, { radius: 0.0055, segs: 3, ends: 'flat' }), mix('wood-light', 'paper', 0.35, 0.9));
  const bowl: [number, number, number] = [0.012, -0.0, 0];
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
    b.add(texturedPart('paper', face(-1, 0.0025, { u0: 0.5 - lw / L / 2, u1: 0.5 + lw / L / 2, v0: 0.5 - lh / H / 2, v1: 0.5 + lh / H / 2 }), o.words.key));
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
      if (t === 'A' || t === 'B' || t === 'C') o.take = t;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) o.pose = pose as ExpressionName;
      else if (pose && typeof pose === 'object') o.pose = pose as PitchPose;
      return pitch(o);
    },
    poses: EXPRESSION_NAMES,
    variants: { ...POSES, A: { take: 'A' }, B: { take: 'B' }, low: { detail: 'low' } },
    camera: { distance: 4.2 },
    note: 'Pitch (look sketch, C1): the businessman airship. ?take=A|B ?pose=rest|proud|greet|carry|strain|lower|present',
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

export { HIDDEN as PITCH_HIDDEN };
