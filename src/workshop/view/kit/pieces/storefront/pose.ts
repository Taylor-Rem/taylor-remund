/**
 * poseStorefront: every moving node's transform from a handful of numbers.
 * Pure node-transform setting (no geometry, no materials, no time, no
 * simulation): the same numbers give the same picture on either `realize`
 * backend, and running a number backwards runs the motion backwards (undo).
 *
 *  - words:   slat turns. 0 shows face A; 1 face B (every slat has turned
 *             half round); 2 face A again. In between, the slats turn one
 *             after another from the top, each with a little overshoot.
 *  - awning:  0 rolled up .. 1 out. The arms swing, the canvas pays out of
 *             the roller (its node scales along its own length), the
 *             valance rides on the arms' tips, the winder turns.
 *  - open:    1 the card says OPEN .. 0 it says CLOSED (it turns half round
 *             on its string, swinging past and settling).
 *  - lights:  0 the window dark .. 1 lit (a threshold at 0.5: the lit and
 *             unlit nodes swap). Defaults to following `open`.
 *  - picture: the drum's sixth turns: 0..5 is the face shown (content.ts PICTURES); fractions
 *             are mid-roll.
 *  - lamp:    the station lamp: 0 dark .. 1 lit (threshold 0.5).
 *
 * The rest pose (all zeros but awning 1, open 1) is how the piece is built.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { AWNING, FASCIA, JACKBOX, NODES, OPEN_SIGN, PICTURE, SHOP, WINDOW, WORDS, F, slatY, slatZ } from './dims.ts';

export interface StorefrontPose {
  words?: number;
  awning?: number;
  open?: number;
  lights?: number;
  picture?: number;
  lamp?: number;
}

export const REST: Required<StorefrontPose> = { words: 0, awning: 1, open: 1, lights: 1, picture: 0, lamp: 0 };

/** The scale a swapped-out node is collapsed to. */
export const HIDDEN = 1e-4;

const DEG = Math.PI / 180;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Ease with a small overshoot and settle (a slat thrown over by its spring). */
export function overshoot(x: number, amount = 0.08): number {
  const t = clamp01(x);
  if (t >= 1) return 1;
  // a smooth run to 1 + amount by 0.75, then back to 1
  if (t < 0.75) return smooth(t / 0.75) * (1 + amount);
  const u = (t - 0.75) / 0.25;
  return 1 + amount * (1 - smooth(u));
}

/** Turn of slat i (in half turns) for a `words` value: the slats go one after another from the top. */
export function slatTurn(words: number, i: number): number {
  const k = Math.floor(words);
  const f = words - k;
  if (f === 0) return k;
  const lag = 0.16;
  const order = FASCIA.slats - 1 - i; // the top slat first
  const span = 1 - lag * (FASCIA.slats - 1);
  return k + overshoot((f - order * lag) / span, 0.07);
}

/** Which face the fascia shows for a `words` value (the nearest whole turn). */
export function wordsFace(words: number): 'A' | 'B' {
  return Math.round(words) % 2 === 0 ? 'A' : 'B';
}

/** The awning's geometry for an extension: the arms' angle, the tip, the canvas's length and slope. */
export function awningGeometry(ext: number): { phi: number; tipY: number; tipZ: number; len: number; slope: number } {
  const phi = AWNING.outDeg * DEG * clamp01(ext);
  const tipY = AWNING.pivotY + AWNING.arm * Math.cos(phi);
  const tipZ = AWNING.pivotZ + AWNING.arm * Math.sin(phi);
  const vy = tipY - AWNING.rollerY, vz = tipZ - AWNING.rollerZ;
  return { phi, tipY, tipZ, len: Math.hypot(vy, vz), slope: Math.atan2(-vy, vz) };
}

const M = (): Matrix4 => new Matrix4();
const Tm = (x: number, y: number, z: number): Matrix4 => M().makeTranslation(x, y, z);
const Rx = (a: number): Matrix4 => M().makeRotationX(a);
const Ry = (a: number): Matrix4 => M().makeRotationY(a);
const Rz = (a: number): Matrix4 => M().makeRotationZ(a);
const S = (x: number, y = x, z = x): Matrix4 => M().makeScale(x, y, z);

/** The lit/unlit node pairs and the pose value that switches them. */
const SWITCHED: ReadonlyArray<{ lit: string; unlit: string; by: 'lights' | 'lamp' }> = [
  { lit: NODES.windowLit, unlit: NODES.windowUnlit, by: 'lights' },
  { lit: `${NODES.windowLit}.lantern`, unlit: `${NODES.windowUnlit}.lantern`, by: 'lights' },
  { lit: NODES.lampLit, unlit: NODES.lampUnlit, by: 'lamp' },
];

/** Where the lit and unlit nodes sit (their pivots); see build.ts. */
export const SWITCH_AT: Record<string, [number, number, number]> = {
  [NODES.windowLit]: [(WINDOW.x0 + WINDOW.x1) / 2, 0.75, F - WINDOW.depth + 0.004],
  [NODES.windowUnlit]: [0, 0, 0],
  [`${NODES.windowLit}.lantern`]: [-(SHOP.pilIn + SHOP.pilOut) / 2, 1.085, F + SHOP.pilProud + 0.17],
  [`${NODES.windowUnlit}.lantern`]: [-(SHOP.pilIn + SHOP.pilOut) / 2, 1.085, F + SHOP.pilProud + 0.17],
  [NODES.lampLit]: [JACKBOX.x - 0.09, JACKBOX.h * 0.48, JACKBOX.z + JACKBOX.d / 2 + 0.01],
  [NODES.lampUnlit]: [JACKBOX.x - 0.09, JACKBOX.h * 0.48, JACKBOX.z + JACKBOX.d / 2 + 0.01],
};

/**
 * Every moving node's local transform for a pose (missing values take REST). `bind`:
 * the build's own transforms (every switched node at full scale, the awning out).
 */
export function nodeMatrices(pose: StorefrontPose = {}, bind = false): Map<string, Matrix4> {
  const p = { ...REST, ...pose };
  if (pose.lights === undefined) p.lights = p.open >= 0.5 ? 1 : 0;
  const out = new Map<string, Matrix4>();
  // the fascia's slats
  for (let i = 0; i < FASCIA.slats; i++) {
    out.set(NODES.slat(i), Tm(0, slatY(i), slatZ(i)).multiply(Rx(-WORDS.leanDeg * DEG)).multiply(Rx(Math.PI * (bind ? 0 : slatTurn(p.words, i)))));
  }
  // the awning
  const g = awningGeometry(bind ? 1 : p.awning);
  const full = awningGeometry(1);
  out.set(NODES.armL, Tm(-(AWNING.hw + 0.022), AWNING.pivotY, AWNING.pivotZ).multiply(Rx(g.phi)));
  out.set(NODES.armR, Tm(AWNING.hw + 0.022, AWNING.pivotY, AWNING.pivotZ).multiply(Rx(g.phi)));
  out.set(NODES.awning, Tm(0, AWNING.rollerY, AWNING.rollerZ).multiply(Rx(g.slope)).multiply(S(1, 1, Math.max(0.02, g.len / full.len))));
  out.set(NODES.valance, Tm(0, g.tipY, g.tipZ));
  out.set(NODES.crank, Tm((SHOP.pilIn + SHOP.pilOut) / 2, 1.2, F + SHOP.pilProud + 0.034).multiply(Rz(-(bind ? 1 : p.awning) * AWNING.turns * Math.PI * 2)));
  // the OPEN card: half a turn about its string between OPEN (1) and CLOSED (0)
  out.set(NODES.openSign, Tm(OPEN_SIGN.x, OPEN_SIGN.y - OPEN_SIGN.drop, OPEN_SIGN.z).multiply(Ry(bind ? 0 : (1 - p.open) * Math.PI)));
  // the picture drum
  out.set(NODES.drum, Tm(PICTURE.x, PICTURE.y, PICTURE.z).multiply(Rx(((bind ? 0 : p.picture) * Math.PI) / 3)));
  // lit and unlit
  for (const s of SWITCHED) {
    const on = bind || (s.by === 'lights' ? p.lights : p.lamp) >= 0.5;
    const offOn = bind ? true : !on;
    const a = SWITCH_AT[s.lit]!, b = SWITCH_AT[s.unlit]!;
    out.set(s.lit, Tm(a[0], a[1], a[2]).multiply(S(on ? 1 : HIDDEN)));
    // the unlit twin sits a hair inside the lit one at bind, so the two never fight
    out.set(s.unlit, Tm(b[0], b[1], b[2]).multiply(S(offOn ? (bind ? 0.999 : 1) : HIDDEN)));
  }
  return out;
}

function isObject3D(n: Object3D | PieceNode): n is Object3D {
  return (n as Object3D).isObject3D === true;
}

function walk(n: PieceNode, f: (n: PieceNode) => void): void {
  f(n);
  for (const c of n.children ?? []) walk(c, f);
}

const tp = new Vector3(), tq = new Quaternion(), ts = new Vector3();

/** Which pose value moves which node (a pose only touches the nodes of the values it names). */
export function governedBy(node: string): keyof StorefrontPose | 'lightsOrOpen' | null {
  if (node.startsWith('sign.slat')) return 'words';
  if (node === NODES.awning || node === NODES.valance || node === NODES.armL || node === NODES.armR || node === NODES.crank) return 'awning';
  if (node === NODES.openSign) return 'open';
  if (node.startsWith(NODES.windowLit) || node.startsWith(NODES.windowUnlit)) return 'lightsOrOpen';
  if (node === NODES.drum) return 'picture';
  if (node === NODES.lampLit || node === NODES.lampUnlit) return 'lamp';
  return null;
}

/**
 * Pose a realized storefront (the Object3D `realize` made, or an ancestor) or a built
 * Piece's root node. Only the values named move anything: `{ awning: 0.5 }` leaves the
 * slats, the card, the drum and the lights as they are.
 */
export function poseStorefront(root: Object3D | PieceNode, pose: StorefrontPose): void {
  const all = nodeMatrices(pose);
  const m = new Map<string, Matrix4>();
  for (const [name, mat] of all) {
    const g = governedBy(name);
    const named = g === 'lightsOrOpen' ? pose.lights !== undefined || pose.open !== undefined : g !== null && pose[g] !== undefined;
    if (named) m.set(name, mat);
  }
  if (isObject3D(root)) {
    for (const [name, mat] of m) {
      const o = root.getObjectByName(name);
      if (!o) continue;
      mat.decompose(tp, tq, ts);
      o.position.copy(tp);
      o.quaternion.copy(tq);
      o.scale.copy(ts);
    }
    return;
  }
  walk(root, (n) => {
    const mat = m.get(n.name);
    if (mat) n.transform = mat.clone();
  });
}

/** Named poses for the catalogue (`?pose=`). `bind` leaves the build's own transforms. */
export const NAMED_POSES: Readonly<Record<string, StorefrontPose | null>> = {
  bind: null,
  rest: {},
  closed: { open: 0 },
  'awning-in': { awning: 0 },
  'awning-half': { awning: 0.5 },
  'words-turning': { words: 0.45 },
  'words-B': { words: 1 },
  'picture-1': { picture: 1 },
  'picture-rolling': { picture: 0.5 },
  'lamp-on': { lamp: 1 },
  'card-turning': { open: 0.5, lights: 1 },
};
