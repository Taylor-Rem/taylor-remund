/**
 * Fetch, take A: "the Bulb". The runner (REWRITE.md § B5, art-direction § 8).
 *
 * One big cream head-body like a lamp bulb tipped forward, the eye set in
 * its face; the bulb screws into a teal yoke on a short spring neck; a small
 * sturdy fork and one fat tyre directly beneath. Short arms hang from the
 * yoke under the bulb's overhang, so the head's silhouette stays clean. A
 * whippy aerial with a pennant. A rolling eye on a wheel.
 *
 * The rig, the poses and the expressions are in ./rig.ts; the geometry is in
 * ./build.ts.
 */
import type { CatalogueEntry } from '../../catalogue.ts';
import { buildFetchBulb } from './build.ts';
import { EXPRESSIONS, poseFetch } from './rig.ts';
import type { Expression, FetchPose } from './rig.ts';

export { buildFetchBulb } from './build.ts';
export type { FetchBuildOptions } from './build.ts';
export {
  poseFetch, poseMatrices, poseWorld, resolvePose, armJoints, designFrames, eyeDims,
  EXPRESSIONS, ARM_PRESETS, REST, NODE_NAMES, PARENT, DIM, GAZE_MAX, REST_TIP, REST_LEAN,
} from './rig.ts';
export type { FetchPose, ArmJoints, ArmPreset, Expression, NodeName } from './rig.ts';

const EXPR = Object.keys(EXPRESSIONS) as Expression[];

export const catalogue: CatalogueEntry[] = [
  {
    name: 'fetch-bulb',
    build: (opts = {}) => {
      const p = buildFetchBulb({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['nameKey'] === 'string' ? { nameKey: opts['nameKey'] as string } : {}),
      });
      // a pose: an expression's name, or an explicit partial pose
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in EXPRESSIONS) poseFetch(p, EXPRESSIONS[pose as Expression]);
      else if (pose && typeof pose === 'object') poseFetch(p, pose as Partial<FetchPose>);
      return p;
    },
    variants: Object.fromEntries([['rest', {}], ...EXPR.map((e) => [e, { pose: e }]), ['low', { detail: 'low' }]]),
    camera: { distance: 4.6 },
    note: 'Fetch, take A (the Bulb): a rolling eye on a wheel. Variants are its five expressions; poseFetch(root, pose) drives it.',
  },
];
