/**
 * Patch, take "the enamel figurine". The switchboard operator as a painted
 * cast-metal toy from a 1940s shop window, chipped from years on a shelf:
 * a big wedge of a head built from separate cast volumes (so every colour
 * area meets the next at a hard painted edge: teal-grey fur, cream muzzle
 * and brows, a dark mask, a black nose), glossy eyes under heavy lid
 * shutters, a painted smirk, one ear notched, a cable-red cardigan with
 * moulded rib and brass button studs, the 1940s headset with brass cups and
 * a boom, a fat ringed tail, jointed like a tin toy on brass rivets.
 *
 * The rig and the expressions are in rig.ts (pure). Build with
 * `patchToy({ pose })` for a posed piece (the cavity is always baked at the
 * neutral pose), or realize it once and drive it with `posePatch`.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { profile } from '../../profile.ts';
import { capsule, ellipsoid, extrude, lathe, superellipsoid, torus } from '../../solids.ts';
import type { LatheOptions } from '../../solids.ts';
import { deform, transform } from '../../deform.ts';
import { sweep, polylinePath, sections } from '../../sweep.ts';
import { aim, chain, mat, part, piece, T } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { ridgedBand } from '../../cheap.ts';
import { setFinish } from '../../space.ts';
import { PAINT, cast, colour, colourBy, lidShell, sphereCap, wearAdd } from './geo.ts';
import type { RGB } from './geo.ts';
import {
  BROW, CUP, EXPRESSIONS, EXPRESSION_NAMES, EYE, FOREARM, HEAD, LID, NEUTRAL, PUPIL, TAIL, TORSO, UPPER_ARM, poseMatrices,
} from './rig.ts';
import type { ExpressionName, PatchPose } from './rig.ts';

export { posePatch, poseMatrices, EXPRESSIONS, EXPRESSION_NAMES, NEUTRAL, PRESETS, ARM_PRESETS, SEAT_H, SIT_YAW } from './rig.ts';
export type { PatchPose, ArmJoints, ArmPreset, Arms, ExpressionName } from './rig.ts';

export interface PatchToyOptions extends KitOptions {
  /** The cardigan's material class (default 'felt': matte knit). */
  cardigan?: CardiganClass;
  /** A named expression or an explicit pose, applied to the node transforms after the bake. */
  pose?: ExpressionName | PatchPose;
}

const S = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeScale(x, y, z);
const RX = (a: number): Matrix4 => new Matrix4().makeRotationX(a);
const RY = (a: number): Matrix4 => new Matrix4().makeRotationY(a);
const RZ = (a: number): Matrix4 => new Matrix4().makeRotationZ(a);

/** A turned part without the wear band (small, seen from a distance). */
const turn = (p: Parameters<typeof lathe>[0], o: LatheOptions = {}): BufferGeometry => lathe(p, { band: 0, ...o });

/** A painted (enamel) part in a mixed colour. */
const enamel = (g: BufferGeometry, c: RGB, seed = 0, jitter = 0.03): KitPart => ({ material: 'steel', geometry: colour(g, c, jitter, seed) });
/** A brass part. */
const brass = (g: BufferGeometry, seed = 0, polish = 0.3): KitPart => setFinish(part('brass', g, 'brass', { seed, jitter: 0.04, warm: 0.03 }), polish);

/** An ellipsoid centred on the origin. */
const egg = (rx: number, ry: number, rz: number, segs: number, detail: 'high' | 'low'): BufferGeometry => transform(ellipsoid({ rx, ry, rz, segs, detail }), T(0, -ry, 0));
/**
 * The front half (+Z) of an ellipsoid centred on the origin, open at the back: for cast volumes
 * whose back half is buried in the head (the mask lobes, the cheeks). `n` segments round a full turn.
 */
function halfEgg(rx: number, ry: number, rz: number, n: number, detail: 'high' | 'low', span = Math.PI): BufferGeometry {
  const rings = Math.max(6, Math.round(n / 2));
  const samples = [];
  for (let i = 0; i <= rings; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / rings;
    samples.push({ o: Math.cos(t), y: Math.sin(t), no: Math.cos(t), ny: Math.sin(t) });
  }
  const mid = Math.PI / 2;
  const g = lathe(samples, { segs: Math.round((n * span) / (Math.PI * 2)), from: mid - span / 2, to: mid + span / 2, caps: false, detail, band: 0 });
  return transform(g, S(rx, ry, rz));
}

/** A superellipsoid centred on the origin. */
const blob = (rx: number, ry: number, rz: number, e1: number, e2: number, segs: number, detail: 'high' | 'low'): BufferGeometry =>
  transform(superellipsoid({ rx, ry, rz, e1, e2, segs, detail }), T(0, -ry, 0));

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function patchToy(o: PatchToyOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const cardigan = o.cardigan ?? 'steel';
  const b = piece('patch-toy', { detail, seed });
  const rest = poseMatrices(NEUTRAL);

  buildLegs(b, detail, seed);
  const spine = b.node('spine', rest.spine);
  buildTorso(spine, detail, seed, cardigan);
  const head = spine.node('head', rest.head);
  buildHead(head, rest, detail, seed);
  for (const s of ['L', 'R'] as const) buildArm(spine, s, rest, detail, seed + (s === 'L' ? 100 : 200), cardigan);
  buildTail(b, rest, detail);

  b.socket('seat', mat({}));
  const built = b.build();
  // a figurine is small: its paint chips, and the battered places they gather in, are finer than a machine's
  scaleLpos(built.root, 'steel', ENAMEL_SCALE);
  // lids and pupils are baked tucked against the eyeball; give them open air's cavity so a closing lid is not grimy
  clearCavity(built.root, new Set(['lidL', 'lidR', 'pupilL', 'pupilR', 'browL', 'browR']), 0.15);
  if (o.pose) applyPose(built, typeof o.pose === 'string' ? EXPRESSIONS[o.pose] : o.pose);
  return built;
}

/** How much finer the enamel's chips are on Patch than on a machine (material space is scaled by this). */
const ENAMEL_SCALE = 2.0;
/**
 * The cardigan's material: knitted wool even on a tin toy, matte and deep, darker than the Button in
 * every view (the brass buttons are its only sparkle). Override with `cardigan` in the options.
 */
export type CardiganClass = 'felt' | 'steel';
/** A knitted (cardigan) part in a mixed colour. */
const knit = (cls: CardiganClass, g: BufferGeometry, c: RGB, seed = 0, jitter = 0.03): KitPart => ({ material: cls, geometry: colour(g, c, jitter, seed) });

/** Scale the material-space positions of one class's parts in a built tree. In place. */
function scaleLpos(n: PieceNode, cls: KitPart['material'], k: number): void {
  for (const q of n.parts) {
    if (q.material !== cls) continue;
    const l = q.geometry.getAttribute('lpos');
    const a = l.array as Float32Array;
    for (let i = 0; i < a.length; i++) a[i] = a[i]! * k;
    l.needsUpdate = true;
  }
  for (const c of n.children ?? []) scaleLpos(c, cls, k);
}

/** Cap the baked cavity (surf.y) on the named nodes' parts. In place. */
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

/** Set a built piece's node transforms to a pose (the cavity keeps its neutral bake). In place. */
export function applyPose(p: Piece, pose: PatchPose): Piece {
  const ms = poseMatrices(pose);
  const walk = (n: PieceNode): void => {
    const m = ms[n.name];
    if (m && n.name !== 'root') n.transform = m.clone();
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return p;
}

/** Cup an ear: its sides curl forward (+Z) round a vertical crease, its tip leans back. In place. */
const cup = (g: BufferGeometry): BufferGeometry => deform(g, (x, y, z) => [x * (1 - 0.6 * x * x), y, z + 7 * x * x - 0.12 * Math.max(0, y) * Math.max(0, y)]);

// ---- the head ---------------------------------------------------------------------------

function buildHead(n: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  const C = new Vector3(0, HEAD.y, HEAD.z);
  // the cranium: a soft box widest at the cheeks, narrowing to the crown, the face a little flattened
  let cranium = transform(blob(HEAD.rx, HEAD.ry, HEAD.rz, 0.78, 0.82, lo ? 20 : 26, detail), T(C.x, C.y, C.z));
  cranium = deform(cranium, (x, y, z) => {
    const t = (y - C.y) / HEAD.ry;
    const zl = z - C.z;
    const widen = 1 + 0.13 * Math.exp(-(((t + 0.32) / 0.55) ** 2)) - 0.1 * Math.max(0, t) ** 2;
    const zz = zl > 0 ? zl * (0.95 - 0.06 * Math.max(0, t)) : zl;
    return [x * widen, y, C.z + zz];
  });
  n.add(enamel(cranium, PAINT.fur, seed + 1, 0.02));

  // the muzzle: a cream wedge out of the lower face, narrowing to the nose
  const mz = new Vector3(0, C.y - 0.082, C.z + 0.122);
  let muzzle = blob(0.118, 0.074, 0.118, 0.72, 0.78, lo ? 16 : 26, detail);
  muzzle = deform(muzzle, (x, y, z) => {
    const f = smooth(-0.05, 0.118, z);
    return [x * (1 - 0.34 * f), y * (1 - 0.12 * f) + 0.012 * f, z];
  });
  muzzle = transform(muzzle, T(mz.x, mz.y, mz.z));
  wearAdd(muzzle, 1.3, 0.3, (p) => smooth(mz.z + 0.07, mz.z + 0.11, p.z) * smooth(mz.y - 0.01, mz.y + 0.05, p.y));
  n.add(enamel(muzzle, PAINT.cream, seed + 2, 0.02));
  // cream cheeks under the mask, swept back into the tufts
  const cheeks: BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const g = transform(halfEgg(0.105, 0.066, 0.09, lo ? 14 : 20, detail, 3.6), chain(T(s * 0.13, C.y - 0.082, C.z + 0.09), RZ(s * 0.32), RY(s * 0.2)));
    wearAdd(g, 1.2, 0.35, (p) => smooth(0.17, 0.22, Math.abs(p.x)));
    cheeks.push(g);
    n.add(enamel(g, PAINT.cream, seed + 3, 0.02));
  }
  // the mask: two lobes round the eyes, drooping at their outer ends, meeting over the bridge
  for (const s of [1, -1]) {
    const g = transform(halfEgg(0.14, 0.074, 0.115, lo ? 16 : 32, detail, 3.6), chain(T(s * 0.112, EYE.y - 0.014, EYE.z - 0.08), RZ(-s * 0.34), RY(s * 0.2)));
    n.add(enamel(g, PAINT.mask, seed + 4, 0.02));
  }

  // the nose: a glossy black wedge on the muzzle's tip, chipped where it sticks out
  const tipHit = cast([muzzle], new Vector3(0, mz.y + 0.018, 1), new Vector3(0, 0, -1));
  const tip = tipHit ? tipHit.p : new Vector3(0, mz.y, mz.z + 0.13);
  let nose = blob(0.044, 0.029, 0.034, 0.6, 0.7, lo ? 10 : 14, detail);
  nose = deform(nose, (x, y, z) => [x * (0.78 + 0.22 * smooth(-0.03, 0.025, y)) * (1 - 0.15 * smooth(0, 0.034, z)), y, z]);
  nose = transform(nose, chain(T(0, tip.y + 0.006, tip.z - 0.008), RX(-0.25)));
  wearAdd(nose, 1.6, 0.45, (p) => smooth(tip.z - 0.02, tip.z + 0.02, p.z) + smooth(tip.y, tip.y + 0.03, p.y) * 0.5);
  n.add(setFinish(enamel(nose, PAINT.ink, seed + 5, 0), 0.65));

  // the smirk: a painted line on the muzzle, the philtrum down from the nose, the mouth hooking up at Patch's left
  const sm: Array<[number, number]> = [
    [0, tip.y - 0.024], [0, tip.y - 0.046],
    [-0.02, tip.y - 0.049], [-0.032, tip.y - 0.048],
  ];
  // Patch's left corner pulls up and round: the smirk
  const sm2: Array<[number, number]> = [[0, tip.y - 0.046], [0.026, tip.y - 0.05], [0.05, tip.y - 0.043], [0.064, tip.y - 0.026], [0.062, tip.y - 0.015]];
  for (const line of [sm, sm2]) {
    const pts: Array<[number, number, number]> = [];
    for (const [x, y] of line) {
      const h = cast([muzzle, ...cheeks], new Vector3(x, y, 1), new Vector3(0, 0, -1));
      if (h) pts.push([h.p.x + h.n.x * 0.0015, h.p.y + h.n.y * 0.0015, h.p.z + h.n.z * 0.0015]);
    }
    if (pts.length >= 2) n.add(enamel(sweep(polylinePath(pts, 0.012, 3), { radius: 0.0048, segs: 5, ends: 'round' }), PAINT.ink, 0, 0));
  }

  // the ears: thick cast triangles with cream linings; the left one notched
  for (const s of [1, -1] as const) {
    const nm = s > 0 ? 'L' : 'R';
    const ear = n.node(`ear${nm}`, rest[`ear${nm}`]);
    const notch = s > 0;
    const outline: Array<[number, number]> = notch
      ? [[-0.08, -0.05], [0.084, -0.05], [0.074, 0.05], [0.058, 0.098], [0.022, 0.092], [0.04, 0.128], [0.006, 0.17], [-0.04, 0.15], [-0.074, 0.07]]
      : [[-0.08, -0.05], [0.084, -0.05], [0.074, 0.06], [0.044, 0.14], [0.006, 0.172], [-0.04, 0.15], [-0.074, 0.07]];
    const rad = notch ? [0.02, 0.02, 0.02, 0.004, 0.003, 0.006, 0.03, 0.022, 0.02] : [0.02, 0.02, 0.02, 0.028, 0.03, 0.022, 0.02];
    // drawn for the left (+X) side; the right ear is the mirror image
    const shape = outline.map(([x, y]) => [x * s, y] as [number, number]);
    if (s < 0) shape.reverse();
    const radii = s < 0 ? [...rad].reverse() : rad;
    const shell = transform(extrude(shape, 0.046, { bevel: 0.012, bevelBase: 0.008, radius: radii, segs: 2, detail }), T(0, 0, -0.026));
    cup(shell);
    // the rims chip first, most at the tip and round the notch
    wearAdd(shell, 1.3, 0.55, (p, nn) => (1 - smooth(0.35, 0.8, Math.abs(nn.z))) * smooth(0.0, 0.12, p.y));
    ear.add(enamel(shell, PAINT.fur, seed + 10 + s, 0.03));
    const lining = shape.map(([x, y]) => [x * 0.62, 0.028 + (y - 0.028) * 0.68] as [number, number]);
    const liningG = cup(transform(extrude(lining, 0.014, { bevel: 0.005, bevelBase: 0, radius: 0.012, segs: 2, detail: 'low', caps: 'end' }), T(0, 0, 0.012)));
    ear.add(enamel(liningG, PAINT.cream, seed + 12 + s, 0.02));
  }

  // cheek tufts: crisp cast planes out of the jaw, three points each side
  for (const s of [1, -1] as const) {
    const out: Array<[number, number]> = [[-0.04, 0.07], [0.085, 0.045], [0.052, 0.012], [0.13, -0.025], [0.06, -0.042], [0.095, -0.1], [0.012, -0.072], [-0.04, -0.05]];
    const shape = out.map(([x, y]) => [x * s, y] as [number, number]);
    if (s < 0) shape.reverse();
    const r0 = [0.012, 0.004, 0.006, 0.004, 0.006, 0.004, 0.008, 0.012];
    const tuft = transform(
      extrude(shape, 0.07, { bevel: 0.012, radius: s < 0 ? [...r0].reverse() : r0, segs: 2, detail }),
      chain(T(s * 0.235, C.y - 0.07, C.z + 0.02), RY(s * 0.55), RZ(-s * 0.18), T(0, 0, -0.035)),
    );
    wearAdd(tuft, 1.2, 0.5, (_p, nn) => 1 - smooth(0.3, 0.8, Math.abs(nn.z)));
    n.add(enamel(tuft, PAINT.fur, seed + 20 + s, 0.03));
  }

  // the neck rivet: a brass collar the head turns on
  n.add(brass(turn(profile(0, -0.03).to(0.085, -0.03, { sharp: true }).to(0.088, -0.012, { fillet: 0.008 }).to(0.07, 0.01, { fillet: 0.008 }).to(0, 0.02), { segs: lo ? 12 : 16, detail, caps: 'end' }), seed + 30, 0.35));

  // the eyes
  for (const s of [1, -1] as const) {
    const nm = s > 0 ? 'L' : 'R';
    const eye = n.node(`eye${nm}`, rest[`eye${nm}`]);
    eye.add(setFinish(enamel(egg(EYE.r, EYE.r, EYE.r, lo ? 12 : 14, detail), PAINT.eyeWhite, seed + 40 + s, 0.01), 0.55));
    const pupil = eye.node(`pupil${nm}`, rest[`pupil${nm}`]);
    pupil.add(setFinish({ material: 'glass', geometry: colour(sphereCap(EYE.r + 0.0016, PUPIL.ang, { segs: lo ? 12 : 14, rings: 3, lip: 0.002 }), PAINT.ink) }, 1));
    const lid = eye.node(`lid${nm}`, rest[`lid${nm}`]);
    const shell = lidShell(EYE.r + 0.0065, LID.t, 1.9, { segs: lo ? 5 : 6, across: lo ? 8 : 11 });
    // the lid's lip carries a black painted lash line, the rest of the shutter is fur
    colourBy(shell, (p) => {
      const e = Math.atan2(p.y, p.z);
      return e < 0.11 ? PAINT.ink : PAINT.fur;
    });
    wearAdd(shell, 0.5);
    lid.add({ material: 'steel', geometry: shell });
  }

  // brows: cream ridges above the mask, seated on the cranium's surface
  for (const s of [1, -1] as const) {
    const nm = s > 0 ? 'L' : 'R';
    const brow = n.node(`brow${nm}`, rest[`brow${nm}`]);
    const h = cast([cranium], new Vector3(s * BROW.x, BROW.y, 1), new Vector3(0, 0, -1));
    const zs = h ? h.p.z : BROW.z;
    let g = blob(0.068, 0.02, 0.03, 0.55, 0.7, lo ? 10 : 12, detail);
    // a crescent: the ends bend back round the head and down
    g = deform(g, (x, y, z) => [x, y - 2.2 * x * x, z - 2.4 * x * x]);
    g = transform(g, T(0, 0, zs - BROW.z - 0.012));
    wearAdd(g, 1.2, 0.4, (p) => smooth(0.035, 0.065, Math.abs(p.x)));
    brow.add(enamel(g, PAINT.cream, seed + 50 + s, 0.02));
  }

  buildHeadset(n, rest, detail, seed);
}

function buildHeadset(n: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  // the band: a flat ink strap over the crown, behind the ears
  const pts: Array<[number, number, number]> = [];
  const N = lo ? 8 : 12;
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI * i) / N;
    const up = Math.sin(t);
    pts.push([(CUP.x + 0.004) * Math.cos(t), CUP.y + 0.04 + (HEAD.y + HEAD.ry + 0.016 - CUP.y - 0.04) * up, CUP.z - 0.07 * up]);
  }
  const band = sweep(polylinePath(pts, 0.03, 2), { section: sectionsRR(0.005, 0.014), radius: 0.004, ends: 'round', up: [0, 0, 1] });
  n.add(enamel(band, PAINT.ink, seed + 60, 0));
  // the cups: ink enamel cans in fat brass rims, a brass boss in the middle
  for (const s of [1, -1] as const) {
    const at = (d: number): Matrix4 => aim([s * (CUP.x - 0.012 + d), CUP.y, CUP.z], [s, 0, 0]);
    const can = turn(profile(0, 0).to(CUP.r - 0.004, 0, { sharp: true }).to(CUP.r, 0.03, { fillet: 0.01 }).to(CUP.r - 0.018, 0.046, { fillet: 0.012 }).to(0, 0.05), { segs: lo ? 14 : 18, detail, caps: 'end' });
    n.add(enamel(transform(can, at(0)), PAINT.ink, seed + 61 + s, 0.02));
    const rim = turn(profile(CUP.r - 0.01, 0).to(CUP.r + 0.008, 0, { fillet: 0.005 }).to(CUP.r + 0.01, 0.018, { fillet: 0.007 }).to(CUP.r - 0.01, 0.022, { fillet: 0.004 }).close(), { segs: lo ? 14 : 20, detail });
    n.add(brass(transform(rim, at(0.004)), seed + 63 + s, 0.5));
    const boss = turn(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.008, { fillet: 0.004 }).curve(0, 0.018, 0.026, 0.018, 3), { segs: lo ? 10 : 14, detail, caps: 'end' });
    n.add(brass(transform(boss, at(0.046)), seed + 65 + s, 0.6));
  }
  // the boom: from a knuckle on the right cup, forward and down past the cheek to a ball mic at the mouth
  const boom = n.node('boom', rest.boom);
  boom.add(brass(transform(turn(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.016, { fillet: 0.006 }).curve(0, 0.03, 0.02, 0.028, 3), { segs: 12, detail, caps: 'end' }), aim([-0.004, 0, 0], [-1, 0, 0])), seed + 70, 0.5));
  const path: Array<[number, number, number]> = [[0, 0, 0], [0.004, -0.02, 0.07], [0.04, -0.085, 0.17], [0.13, -0.13, 0.245], [0.2, -0.14, 0.268]];
  boom.add(brass(sweep(polylinePath(path, 0.05, 3), { radius: 0.0105, segs: 6, ends: 'flat' }), seed + 71, 0.35));
  const end = new Vector3(...path[path.length - 1]!);
  const ball = turn(profile(0, -0.026).curve(0.027, -0.002, 0.03, -0.026, 4).curve(0, 0.026, 0.03, 0.024, 4), { segs: 12, detail, caps: false });
  boom.add(brass(transform(ball, chain(T(end.x + 0.012, end.y, end.z + 0.004), RZ(Math.PI / 2))), seed + 72, 0.45));
  const grille = ridgedBand(0.029, 0.012, 12, 0.003);
  boom.add(enamel(transform(grille, chain(T(end.x + 0.012, end.y, end.z + 0.004), RZ(Math.PI / 2), T(0, -0.006, 0))), PAINT.ink, 0, 0));
}

/** A rounded-rectangle sweep section. */
const sectionsRR = (hx: number, hz: number): ReturnType<typeof sections.roundRect> => sections.roundRect(hx, hz, 2);

// ---- the torso --------------------------------------------------------------------------

function buildTorso(n: NodeBuilder, detail: 'high' | 'low', seed: number, cls: CardiganClass): void {
  const lo = detail === 'low';
  const { y0, y1, rx, rz } = TORSO;
  const kz = rz / rx;
  const band = 0.07;
  // the cardigan's body: a pear, flat-backed, its knit moulded as shallow vertical ribs
  const prof = profile(0, y0 + band - 0.01)
    .to(rx - 0.008, y0 + band - 0.01, { sharp: true })
    .curve(rx * 0.97, 0.2, rx + 0.006, 0.08, 6)
    .curve(0.15, y1 - 0.02, rx * 0.95, y1 - 0.06, 6)
    .curve(0.06, y1 + 0.012, 0.11, y1 + 0.012, 4)
    .to(0, y1 + 0.012);
  let body = turn(prof, { segs: lo ? 32 : 48, detail, caps: 'end' });
  // 16 moulded ribs, three segments each: a cast knit, chunky enough to catch the lamp
  const ribs = 16;
  body = deform(body, (x, y, z) => {
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const k = 1 + 0.016 * Math.cos(a * ribs) * smooth(y0 + band, y0 + band + 0.04, y) * (1 - smooth(y1 - 0.08, y1, y));
    return [x * k, y, z * k * kz * (r > 0 ? 1 : 1)];
  });
  n.add(knit(cls, body, PAINT.red, seed + 80, 0.02));
  // the ribbed waistband (the hem on the seat)
  const wb = transform(ridgedBand(rx + 0.008, band, lo ? 28 : 36, 0.009), chain(S(1, 1, kz), T(0, y0, 0)));
  n.add(knit(cls, wb, PAINT.redDark, seed + 81, 0.02));
  // a cream shirt in the cardigan's V
  const vTop = y1 - 0.01, vBot = 0.15;
  let shirt = blob(0.085, (vTop - vBot) / 2 + 0.02, 0.05, 0.6, 0.6, lo ? 12 : 14, detail);
  shirt = deform(shirt, (x, y, z) => {
    const t = smooth(-0.13, 0.12, y);
    return [x * (0.15 + 0.85 * t), y, z];
  });
  const front = (y: number): number => {
    const h = cast([body], new Vector3(0, y, 1), new Vector3(0, 0, -1));
    return h ? h.p.z : rz;
  };
  const ym = (vTop + vBot) / 2;
  n.add(enamel(transform(shirt, T(0, ym, front(ym) - 0.035)), PAINT.cream, seed + 82, 0.02));
  // the lapels: rolled red bands down each side of the V, crossing at the bottom
  for (const s of [1, -1]) {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const y = vTop - (vTop - vBot + 0.02) * t;
      const x = s * (0.1 * (1 - t) + 0.008);
      const h = cast([body], new Vector3(x, y, 1), new Vector3(0, 0, -1));
      const z = (h ? h.p.z : rz) + 0.008;
      pts.push([x, y, z]);
    }
    n.add(knit(cls, sweep(polylinePath(pts, 0.04, 3), { section: sectionsRR(0.016, 0.004), radius: 0.006, ends: 'round', up: [0, 0, 1] }), PAINT.red, seed + 83 + s, 0.02));
  }
  // brass button studs down the placket
  for (const [i, y] of [vBot - 0.02, 0.07, 0.0].entries()) {
    const h = cast([body], new Vector3(0.006, y, 1), new Vector3(0, 0, -1));
    if (!h) continue;
    const g = turn(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.006, { fillet: 0.003 }).curve(0, 0.014, 0.02, 0.014, 3), { segs: 12, detail: 'low', caps: 'end' });
    n.add(brass(transform(g, aim([h.p.x, h.p.y, h.p.z - 0.002], [h.n.x, h.n.y, h.n.z])), seed + 85 + i, 0.6));
  }
  // the cream collar bunched round the neck
  const collar = transform(torus({ R: 0.105, r: 0.038, segs: lo ? 16 : 20, tubeSegs: lo ? 7 : 8, detail }), chain(T(0, y1 - 0.045, 0.012), S(1, 1, 0.92), RX(-0.12)));
  n.add(enamel(collar, PAINT.cream, seed + 88, 0.02));
}

// ---- the arms --------------------------------------------------------------------------

function buildArm(spine: NodeBuilder, s: 'L' | 'R', rest: Record<string, Matrix4>, detail: 'high' | 'low', seed: number, cls: CardiganClass): void {
  const lo = detail === 'low';
  const sx = s === 'L' ? 1 : -1;
  const arm = spine.node(`arm${s}`, rest[`arm${s}`]);
  // the upper arm: a sleeve hanging from a round shoulder
  const ua = turn(
    profile(0, -UPPER_ARM - 0.012)
      .to(0.05, -UPPER_ARM - 0.012, { fillet: 0.015 })
      .to(0.058, -0.06, { smooth: true })
      .curve(0, 0.062, 0.066, 0.05, 5),
    { segs: lo ? 12 : 16, detail, caps: true },
  );
  arm.add(knit(cls, ua, PAINT.red, seed + 1, 0.02));
  // the shoulder rivet: a brass dome on the outside of the joint
  arm.add(brass(transform(turn(profile(0, 0).to(0.028, 0, { sharp: true }).to(0.028, 0.004, { fillet: 0.002 }).curve(0, 0.014, 0.026, 0.013, 3), { segs: 12, detail: 'low', caps: 'end' }), aim([sx * 0.056, 0.005, 0], [sx, 0.15, 0])), seed + 2, 0.55));
  const fore = arm.node(`forearm${s}`, rest[`forearm${s}`]);
  const fa = turn(
    profile(0, -FOREARM + 0.03)
      .to(0.047, -FOREARM + 0.03, { sharp: true })
      .to(0.052, -0.04, { smooth: true })
      .curve(0, 0.04, 0.054, 0.03, 4),
    { segs: lo ? 12 : 16, detail, caps: 'start' },
  );
  fore.add(knit(cls, fa, PAINT.red, seed + 3, 0.02));
  // the ribbed cuff
  fore.add(knit(cls, transform(ridgedBand(0.056, 0.036, lo ? 12 : 18, 0.006), T(0, -FOREARM, 0)), PAINT.redDark, seed + 4, 0.02));
  fore.add(knit(cls, transform(turn(profile(0, 0).to(0.05, 0, { sharp: true }).to(0, 0.002), { segs: 12, detail: 'low', caps: false }), T(0, -FOREARM + 0.036, 0)), PAINT.redDark, 0, 0));
  // the paw: a dark mitten with three knuckles and a thumb
  const paw = fore.node(`paw${s}`, rest[`paw${s}`]);
  const dark = PAINT.mask.map((v) => v * 0.55) as RGB;
  let mitt = blob(0.044, 0.05, 0.034, 0.7, 0.75, 10, detail);
  mitt = deform(mitt, (x, y, z) => [x * (1 + 0.15 * smooth(0.02, -0.05, y)), y, z + 0.012 * smooth(0, -0.05, y)]);
  paw.add(enamel(transform(mitt, T(0, -0.05, 0.004)), dark, seed + 5, 0.02));
  for (let i = 0; i < 3; i++) {
    const kx = (i - 1) * 0.026;
    paw.add(enamel(transform(egg(0.015, 0.02, 0.017, 10, 'low'), T(kx, -0.098 + Math.abs(i - 1) * 0.006, 0.014)), dark, seed + 6 + i, 0.02));
  }
  paw.add(enamel(transform(egg(0.014, 0.024, 0.015, 10, 'low'), chain(T(-sx * 0.04, -0.058, 0.024), RZ(sx * 0.5))), dark, seed + 9, 0.02));
}

// ---- the legs and the tail ---------------------------------------------------------------

function limb(a: Vector3, bb: Vector3, r: number, segs: number): BufferGeometry {
  const d = bb.clone().sub(a);
  const L = d.length();
  const g = capsule({ r, h: L + 2 * r, segs, detail: 'high' });
  return transform(g, chain(aim([a.x, a.y, a.z], [d.x, d.y, d.z]), T(0, -r, 0)));
}

function buildLegs(n: NodeBuilder, detail: 'high' | 'low', seed: number): void {
  const lo = detail === 'low';
  for (const s of [1, -1]) {
    const hip = new Vector3(s * 0.105, 0.07, -0.01);
    const knee = new Vector3(s * 0.125, 0.065, 0.2);
    const ankle = new Vector3(s * 0.13, -0.11, 0.25);
    n.add(enamel(limb(hip, knee, 0.078, lo ? 10 : 12), PAINT.fur, seed + 150 + s, 0.02));
    n.add(enamel(limb(knee, ankle, 0.058, lo ? 8 : 10), PAINT.furDark, seed + 152 + s, 0.02));
    // the foot: a dark cast shoe of a paw, toes forward and a little out
    let foot = blob(0.058, 0.036, 0.082, 0.7, 0.75, lo ? 10 : 12, detail);
    foot = deform(foot, (x, y, z) => [x * (1 + 0.2 * smooth(-0.02, 0.08, z)), y + 0.01 * smooth(0.03, 0.08, z), z]);
    const dark = PAINT.mask.map((v) => v * 0.55) as RGB;
    n.add(enamel(transform(foot, chain(T(ankle.x + s * 0.008, ankle.y - 0.035, ankle.z + 0.04), RY(s * 0.2))), dark, seed + 154 + s, 0.02));
  }
}

function buildTail(n: NodeBuilder, rest: Record<string, Matrix4>, detail: 'high' | 'low'): void {
  const lo = detail === 'low';
  const names = ['tail', 'tail2', 'tail3', 'tail4'];
  const radii = [0.072, 0.086, 0.084, 0.07];
  let node = n;
  for (let i = 0; i < 4; i++) {
    node = node.node(names[i]!, rest[names[i]!]);
    const L = TAIL.segs[i]!;
    const r = radii[i]!;
    const yb = -L * 0.52;
    const last = i === 3;
    const p = profile(0, 0.045)
      .curve(r * 0.97, 0.0, r * 0.9, 0.042, 4)
      .to(r, yb + 0.012, { smooth: true })
      .to(r - 0.012, yb, { sharp: true })
      .to(r - 0.002, yb - 0.012, { sharp: true });
    if (last) p.curve(0, -L - 0.03, r * 0.85, -L - 0.03, 6);
    else p.to(r * 0.98, -L + 0.01, { smooth: true }).curve(0, -L - 0.035, r * 0.9, -L - 0.03, 4);
    const g = turn(p, { segs: lo ? 10 : 12, detail, caps: false });
    colourBy(g, (q, nn) => (q.y - nn.y * 0.004 > yb ? PAINT.fur : PAINT.mask));
    wearAdd(g, 1, 0, () => 0);
    node.add({ material: 'steel', geometry: g });
  }
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'patch-toy',
    build: (opts = {}) => {
      const o: PatchToyOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      if (opts['cardigan'] === 'steel' || opts['cardigan'] === 'felt') o.cardigan = opts['cardigan'];
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) o.pose = pose as ExpressionName;
      else if (pose && typeof pose === 'object') o.pose = pose as PatchPose;
      return patchToy(o);
    },
    poses: EXPRESSION_NAMES,
    variants: { ...Object.fromEntries(EXPRESSION_NAMES.map((n) => [n, { pose: n }])), low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 4.2 },
    note: 'Patch, take "the enamel figurine": a painted cast-metal toy raccoon at the switchboard. ?pose=unimpressed|amused|the-look|working|checking',
  },
];
