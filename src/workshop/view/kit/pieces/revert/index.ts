/**
 * Revert, the caretaker (REWRITE.md § B5; ART-P2 § 5). Registry name `revert`.
 *
 * A tracked floor polisher crossed with a strongbox: low, wide and heavy on
 * two rubber treads, much more worn than anything else on the bench. Deadpan
 * is the whole character: two small lamp eyes set wide apart under one heavy
 * brow plate, each with its own flat lid; no mouth. It answers with printed
 * cards fed up out of a slot in its deck and held in a brass clip, folded in
 * half on the way up (a card whose capitals pass 12 px is wider than any
 * robot this size) and flipped open facing the visitor. A brass crank on the
 * rewind box at its back turns when it undoes something. A push broom rides
 * on its left flank and a dustpan on its right; one stubby arm can take the
 * broom and push.
 *
 * Built at crew scale (about 0.9 tall, 1.45 wide, 1.1 deep): place it at
 * scale 1. The rig (pure pose maths, every node and pose) is rig.ts; build
 * with `revert({ pose })` for a still, or realize once and drive with
 * `poseRevert`. Drawing is skinned: poses only ever set node transforms.
 */
import { Matrix4 } from 'three';
import type { KitOptions, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { assertContent } from '../../../../../content/schema.ts';
import revertJson from '../../../../../content/revert.json';
import { piece, pieceBounds } from '../../compose.ts';
import { rng } from '../../rng.ts';
import {
  foldClasses, buildArm, buildBroom, buildBroomClips, buildBrow, buildCard, buildChassis, buildCrank, buildDrumStand, buildDustpan, buildEye, buildHull, buildShoulder,
  buildWheel, shoeGeometry,
} from './build.ts';
import type { CardSpec, Ctx } from './build.ts';
import { part } from '../../compose.ts';
import { CARD_CAP, CARD_ESTIMATE, NEUTRAL, POSES, POSE_NAMES, TRACK, broomMatrix, poseMatricesFor } from './rig.ts';
import type { PoseName, RevertPose } from './rig.ts';

export {
  poseRevert, poseMatrices, poseMatricesFor, cardMatrix, loopPoint, armReach, broomMatrix, POSES, POSE_NAMES, NEUTRAL, ARMS, ARM_PRESETS, HIDDEN, CARD_CAP,
  CARD_ESTIMATE, TRACK, LOOP, HULL, EYE, LID, BROW, CRANK, DRUM, SLOT, SHOULDER, BROOM, BODY_Y, AXLE_Y, FACE, faceZ,
} from './rig.ts';
export type { RevertPose, PoseName, CardPose, ArmJoints, ArmPreset } from './rig.ts';

const content = assertContent(revertJson, 'src/content/revert.json');

/** Revert's four cards (REWRITE.md § B4), by rung. */
export const CARD_LINES = {
  rung1: content.cards.rung1.text,
  rung2: content.cards.rung2.text,
  rung3: content.cards.rung3.text,
  rung4: content.cards.rung4.text,
} as const;
export type CardLine = keyof typeof CARD_LINES;

export interface RevertOptions extends KitOptions {
  /** A named pose or an explicit one, applied to the node transforms after the bake. Default: the neutral rest. */
  pose?: PoseName | RevertPose;
  /** The card's label (labels.card(text, { capHeight: CARD_CAP })) and size. Without it the card is blank paper of the estimate's size. */
  card?: CardSpec;
}

/** The pose the cavity is baked in: everything where it can be seen (card up and open, lids open, broom stowed). */
const BAKE: RevertPose = { ...NEUTRAL, card: { lift: 1, open: 1, wobble: 0 } };

export function revert(o: RevertOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const c: Ctx = { detail, seed, R: rng(seed) };
  const card: CardSpec = o.card ?? { key: '', ...CARD_ESTIMATE };
  const rest = poseMatricesFor(BAKE, card);
  const b = piece('revert', { detail, seed });

  // ---- the treads ----
  const chassis = b.node('chassis', rest.chassis);
  buildChassis(chassis, c);
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    for (const end of ['F', 'B'] as const) buildWheel(chassis.node(`wheel${side}${end}`, rest[`wheel${side}${end}`]), sx, c, seed + (side === 'L' ? 300 : 400) + (end === 'F' ? 0 : 10));
    const R = rng(seed + (sx > 0 ? 500 : 600));
    for (let i = 0; i < TRACK.n; i++) {
      chassis.node(`shoe${side}${i}`, rest[`shoe${side}${i}`]).add(part('rubber', shoeGeometry(sx), 'ink', { seed: R.int(0, 9999), jitter: 0.07 }));
    }
  }

  // ---- the body ----
  const body = b.node('body', rest.body);
  buildHull(body, c);
  buildBrow(body.node('brow', rest.brow), c);
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = body.node(`eye${side}`, rest[`eye${side}`]);
    const lamp = eye.node(`lamp${side}`, rest[`lamp${side}`]);
    const lid = eye.node(`lid${side}`, rest[`lid${side}`]);
    buildEye(eye, lamp, lid, c, seed + (s > 0 ? 200 : 250));
  }
  buildDrumStand(body, c);
  buildCrank(body.node('crank', rest.crank), c);
  const cardNode = body.node('card', rest.card);
  buildCard(cardNode, cardNode.node('cardL', rest.cardL), card, c);
  buildShoulder(body, c);
  const arm = body.node('arm', rest.arm);
  const fore = arm.node('forearm', rest.forearm);
  const hand = fore.node('hand', rest.hand);
  buildArm(arm, fore, hand, [hand.node('jaw0', rest.jaw0), hand.node('jaw1', rest.jaw1)], c);
  const stowed = broomMatrix(0, 0);
  buildBroom(body.node('broom', rest.broom), c);
  buildBroomClips(body, stowed, c);
  buildDustpan(body, c);

  b.socket('card', new Matrix4().makeTranslation(0, 1.6, -0.03));
  b.socket('lift', new Matrix4().makeTranslation(0, 1.0, 0));
  // five meshes: enamel, brass, rubber, the lamps, the card
  foldClasses(b, { metal: 'steel', wood: 'steel', glass: 'steel' });
  const built = b.build();
  // parts that move away from where they were baked keep the open air's shading, not the bake's
  capCavity(built.root, (n) => n.startsWith('lid') || n.startsWith('lamp') || n === 'broom' || n === 'card' || n === 'cardL', 0.15);
  capCavity(built.root, (n) => n.startsWith('shoe'), 0.35);
  // its size is the size at rest (card stowed, broom on its rack), not at the bake pose: layout and the collider use it
  applyPose(built, NEUTRAL, card);
  const box = pieceBounds(built);
  built.size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
  if (o.pose !== undefined) applyPose(built, typeof o.pose === 'string' ? POSES[o.pose] : o.pose, card);
  return built;
}

/** Cap the baked cavity (surf.y) on the matching nodes' parts. In place. */
function capCavity(n: PieceNode, match: (name: string) => boolean, cap: number): void {
  if (match(n.name)) {
    for (const q of n.parts) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, Math.min(sf.getY(i), cap));
      sf.needsUpdate = true;
    }
  }
  for (const ch of n.children ?? []) capCavity(ch, match, cap);
}

/** Set a built Revert's node transforms to a pose (the cavity keeps its bake). In place. */
export function applyPose(p: Piece, pose: RevertPose, card: { w: number; h: number } = CARD_ESTIMATE): Piece {
  const ms = poseMatricesFor(pose, card);
  const walk = (n: PieceNode): void => {
    const m = ms[n.name];
    if (m && n.name !== 'root') n.transform = m.clone();
    for (const ch of n.children ?? []) walk(ch);
  };
  walk(p.root);
  return p;
}

/** Make the label for one of Revert's cards (at Revert's cap height) and return the spec `card` wants. */
export function revertCard(labels: Labels, line: CardLine = 'rung1'): CardSpec {
  const key = labels.card(CARD_LINES[line], { capHeight: CARD_CAP });
  const sz = labels.size(key);
  return { key, w: sz.w, h: sz.h };
}

const lineOf = (v: unknown): CardLine => (typeof v === 'string' && v in CARD_LINES ? (v as CardLine) : 'rung1');

export const catalogue: CatalogueEntry[] = [
  {
    name: 'revert',
    build: (opts = {}) => {
      const o: RevertOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in POSES) o.pose = pose as PoseName;
      else if (pose && typeof pose === 'object') o.pose = pose as RevertPose;
      const card = opts['card'] as CardSpec | undefined;
      if (card && typeof card.key === 'string') o.card = card;
      return revert(o);
    },
    poses: POSE_NAMES,
    labels: (labels, opts) => ({ card: revertCard(labels, lineOf(opts['line'])) }),
    variants: { low: { detail: 'low' }, 'seed 2': { seed: 2 }, again: { line: 'rung2', pose: 'card-up' }, 'says do not': { line: 'rung3', pose: 'card-up' }, cleaned: { line: 'rung4', pose: 'card-up' } },
    camera: { distance: 5 },
    note: 'Revert, the caretaker: a tracked strongbox with two lamp eyes under one brow, a card feed, a crank, a broom. ?pose=' + POSE_NAMES.join('|'),
  },
];
