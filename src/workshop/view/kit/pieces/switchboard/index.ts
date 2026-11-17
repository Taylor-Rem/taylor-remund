/**
 * The switchboard station (REWRITE.md § B2 X1, § B5 "Patch"): the board
 * slice with its two live jacks, Patch's stool, and the patch cord's plug
 * and cord geometry. Registry names `switchboard`, `stool`, `cord-plug`.
 * See board.ts, stool.ts and plug.ts for the nodes and sockets of each.
 */
import type { CatalogueEntry } from '../../catalogue.ts';
import { switchboard } from './board.ts';
import type { SwitchboardLabelRefs } from './labels.ts';
import { switchboardLabels } from './labels.ts';
import { NAMED_POSES } from './pose.ts';
import { stool } from './stool.ts';
import { cordPlug } from './plug.ts';

export { switchboard, BOARD, JACK_MOUTH } from './board.ts';
export type { SwitchboardOptions } from './board.ts';
export { poseSwitchboard, NAMED_POSES, POSE, HIDDEN } from './pose.ts';
export type { SwitchboardPose } from './pose.ts';
export { switchboardLabels, estimateLabels, JACKS, TAPE_CAP, CARD_CAP } from './labels.ts';
export type { JackName, SwitchboardLabelRefs, LabelRef } from './labels.ts';
export { stool, SEAT_Y } from './stool.ts';
export { cordPlug, cordGeometry, updateCord, cordPart, PLUG } from './plug.ts';
export type { PlugOptions, CordOptions } from './plug.ts';

const kit = (opts: Record<string, unknown>) => ({
  ...(opts['seed'] !== undefined ? { seed: opts['seed'] as number } : {}),
  ...(opts['detail'] ? { detail: opts['detail'] as 'high' | 'low' } : {}),
});

export const catalogue: CatalogueEntry[] = [
  {
    name: 'switchboard',
    build: (opts = {}) =>
      switchboard({
        ...kit(opts),
        ...(opts['labels'] ? { labels: opts['labels'] as SwitchboardLabelRefs } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    poses: Object.keys(NAMED_POSES),
    labels: (labels) => ({ labels: switchboardLabels(labels) }),
    camera: { distance: 9 },
    note: 'The switchboard slice: two live jacks (STOREFRONT, LAMP) with lens lamps, a dead field, the keyshelf and its drawers.',
  },
  {
    name: 'stool',
    build: (opts = {}) => stool(kit(opts)),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 3 },
    note: "Patch's stool: turned legs, rungs, a round worn seat.",
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
