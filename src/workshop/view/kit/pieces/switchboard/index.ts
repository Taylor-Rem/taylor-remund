/**
 * The switchboard station (REWRITE.md § B2 X1, § B5 "Patch", § D 4): the
 * board (the G1 slice with two live jacks, or the whole board with four),
 * Patch's stool, and the patch cord's plug and cord geometry. Registry names
 * `switchboard`, `stool`, `cord-plug`, and `switchboard-operator` (review
 * only: the whole board with the lowered stool and a 1.5x Patch working it).
 * See board.ts, stool.ts and plug.ts for the nodes and sockets of each.
 */
import { Matrix4 } from 'three';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { KitPart, Piece, PieceNode } from '../../types.ts';
import { piece, place } from '../../compose.ts';
import { STOOL_SEAT, switchboard } from './board.ts';
import type { SwitchboardLabelRefs, JackName } from './labels.ts';
import { JACKS, SLICE_JACKS, switchboardLabels } from './labels.ts';
import { NAMED_POSES } from './pose.ts';
import { stool } from './stool.ts';
import { cordPlug } from './plug.ts';
import { patchFelt } from '../patch-felt/index.ts';
import type { PatchPose } from '../patch-felt/index.ts';

export { switchboard, BOARD, BOARD_WHOLE, STOOL_SEAT, JACK_MOUTH, COLLAR_LIFT, isSliceJacks, tapeCentreX } from './board.ts';
export type { SwitchboardOptions } from './board.ts';
export { poseSwitchboard, NAMED_POSES, POSE, HIDDEN } from './pose.ts';
export type { SwitchboardPose } from './pose.ts';
export { switchboardLabels, estimateLabels, jackText, JACKS, SLICE_JACKS, TAPE_CAP, TAPE_CAP_WHOLE, RESERVED_CAP, RESERVED_TEXT, CARD_CAP } from './labels.ts';
export type { JackName, SwitchboardLabelRefs, LabelRef } from './labels.ts';
export { stool, SEAT_Y } from './stool.ts';
export type { StoolOptions } from './stool.ts';
export { cordPlug, cordGeometry, updateCord, cordPart, PLUG } from './plug.ts';
export type { PlugOptions, CordOptions } from './plug.ts';

const kit = (opts: Record<string, unknown>) => ({
  ...(opts['seed'] !== undefined ? { seed: opts['seed'] as number } : {}),
  ...(opts['detail'] ? { detail: opts['detail'] as 'high' | 'low' } : {}),
});
const jacksOf = (opts: Record<string, unknown>): readonly JackName[] => (Array.isArray(opts['jacks']) ? (opts['jacks'] as JackName[]) : SLICE_JACKS);

/** Patch at 1.5x, side-on on the lowered stool (facing -X, its right side to the board). */
export const OPERATOR = { scale: 1.5, yaw: -Math.PI / 2 } as const;

/**
 * Review poses for the operator check (found by a search over the rig's joint limits; the
 * stool stands at the board's `stool.<jack>` socket, 0.15 right of the jack on its runner). `grip`: the paw on a plug seated in
 * STOREFRONT (0.3 out from the mouth); `drawer`: the paw on STOREFRONT's drawer pull.
 */
export const OPERATOR_POSES: Record<string, PatchPose> = {
  grip: {
    lean: [0.06, -0.05], twist: -0.57, headYaw: -0.6, headPitch: 0.25, lids: [0.35, 0.35],
    arms: { left: { swing: 0.95, abduct: 0.12, twist: -0.25, elbow: 0.55, wrist: 0.15, roll: 0.6 }, right: { swing: 1.52, abduct: 0.11, twist: 0.29, elbow: 0.96, wrist: 0, roll: 0 } },
  },
  drawer: {
    lean: [0.2, -0.2], twist: -0.58, headYaw: -0.5, headPitch: -0.35, lids: [0.35, 0.35],
    arms: { left: { swing: 0.95, abduct: 0.12, twist: -0.25, elbow: 0.55, wrist: 0.15, roll: 0.6 }, right: { swing: 0.15, abduct: 0.27, twist: 0.33, elbow: 0.07, wrist: 0, roll: 0 } },
  },
  rest: { headYaw: 1.1, headPitch: 0.24, lids: [0.42, 0.46], mouth: [0.6, -0.1], arms: 'rest' },
};

/** Every part of a built piece at its current node transforms, flattened under `at`. */
function flatten(p: Piece, at: Matrix4): KitPart[] {
  const out: KitPart[] = [];
  const walk = (n: PieceNode, pw: Matrix4): void => {
    const w = pw.clone().multiply(n.transform ?? new Matrix4());
    out.push(...place(n.parts, w));
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, at);
  return out;
}

/** Review: the whole board, the lowered stool on its runner at a jack (or at rest), Patch at 1.5x on it. */
function operator(opts: Record<string, unknown>): Piece {
  const at = (typeof opts['at'] === 'string' ? opts['at'] : 'storefront') as JackName | 'rest';
  const pose = OPERATOR_POSES[typeof opts['work'] === 'string' ? opts['work'] : at === 'rest' ? 'rest' : 'grip'] ?? OPERATOR_POSES['grip']!;
  const board = switchboard({ ...kit(opts), jacks: JACKS, ...(opts['labels'] ? { labels: opts['labels'] as SwitchboardLabelRefs } : {}), ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}) });
  const sock = board.sockets?.[at === 'rest' ? 'stool' : `stool.${at}`] ?? new Matrix4();
  const stoolAt = sock.clone();
  const st = stool({ ...kit(opts), seatY: STOOL_SEAT });
  const seat = st.sockets?.['seat'] ?? new Matrix4();
  const yaw = at === 'rest' ? -1.05 : OPERATOR.yaw;
  const patchAt = stoolAt.clone().multiply(seat).multiply(new Matrix4().makeRotationY(yaw)).multiply(new Matrix4().makeScale(OPERATOR.scale, OPERATOR.scale, OPERATOR.scale));
  const patch = patchFelt({ ...kit(opts), standIn: false, pose });
  const b = piece('switchboard-operator', { ao: false });
  b.add(flatten(board, new Matrix4()), flatten(st, stoolAt), flatten(patch, patchAt));
  // the plug seated in the jack being worked (at rest: in STOREFRONT)
  const jackAt = board.sockets?.[`jack.${at === 'rest' ? 'storefront' : at}`];
  if (jackAt) b.add(flatten(cordPlug({ ...kit(opts), rest: 'seat' }), jackAt));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'switchboard',
    build: (opts = {}) =>
      switchboard({
        ...kit(opts),
        ...(opts['labels'] ? { labels: opts['labels'] as SwitchboardLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
        jacks: jacksOf(opts),
      }),
    variants: { whole: { jacks: JACKS }, slice: { jacks: SLICE_JACKS }, high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, 'whole low': { jacks: JACKS, detail: 'low' } },
    poses: Object.keys(NAMED_POSES),
    labels: (labels, opts) => ({ labels: switchboardLabels(labels, jacksOf(opts)) }),
    camera: { distance: 9 },
    note: 'The switchboard: the whole board (variant `whole`: four live jacks, two RESERVED, a drawer per line, the stool runner) or the G1 slice (default: two live jacks).',
  },
  {
    name: 'switchboard-operator',
    build: (opts = {}) => operator(opts),
    variants: { storefront: { at: 'storefront' }, 'storefront drawer': { at: 'storefront', work: 'drawer', pose: 'storefront' }, lamp: { at: 'lamp' }, rest: { at: 'rest' } },
    labels: (labels) => ({ labels: switchboardLabels(labels, JACKS) }),
    camera: { distance: 10 },
    note: 'Review only: the whole board, the lowered stool on its runner, and Patch at 1.5x working a jack (the reach check).',
  },
  {
    name: 'stool',
    build: (opts = {}) => stool({ ...kit(opts), ...(typeof opts['seatY'] === 'number' ? { seatY: opts['seatY'] } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, operator: { seatY: STOOL_SEAT } },
    camera: { distance: 3 },
    note: "Patch's stool: turned legs, rungs, a round worn seat (`seatY` sets the height; the whole board's operator sits on STOOL_SEAT).",
  },
  {
    name: 'cord-plug',
    // the catalogue shows a loose plug lying on the bench with a length of cord; the view builds it seated (rest: 'seat')
    build: (opts = {}) => cordPlug({ ...kit(opts), rest: 'bench', demoCord: opts['cord'] !== false }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'plug only': { cord: false } },
    camera: { distance: 2.2 },
    note: 'The patch cord: a knurled brass plug, a cable-red boot, the braided cord geometry.',
  },
];

