// poseRevertInto (W3 round 2): the allocation-free poser gives the same transforms as poseMatrices, pose for pose.
import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D } from 'three';
import { POSES, MOVING_NODES, poseMatricesFor, poseRevertInto, revertScratch, CARD_ESTIMATE } from '../../../src/workshop/view/kit/pieces/revert/index.ts';
import type { RevertPose } from '../../../src/workshop/view/kit/pieces/revert/index.ts';

function rig(): Object3D {
  const root = new Object3D();
  for (const n of MOVING_NODES) {
    const o = new Object3D();
    o.name = n;
    root.add(o);
  }
  return root;
}

const extra: RevertPose[] = [
  { travel: [0.37, -1.2], sag: 0.6, bob: 0.02, pitch: 0.1, roll: -0.05, gaze: [1.4, 0.9], card: { lift: 0.6, open: 0.3, wobble: 5 }, arm: 'broom', broom: 0.4, stroke: -0.5 },
  { arm: 'broom', broom: 1, stroke: 0.8, card: { lift: 0.01 } },
  { arm: { yaw: 0.2, swing: 1.1, elbow: 0.3, wrist: 0.4, grip: 0.9 }, card: { lift: 1.12, open: 1 } },
];

describe('poseRevertInto', () => {
  const cards = [CARD_ESTIMATE, { w: 1.2, h: 0.8 }];
  const poses: RevertPose[] = [...Object.values(POSES), ...extra];
  it('matches poseMatrices for every named pose and a few hard ones', () => {
    const root = rig();
    const s = revertScratch();
    for (const card of cards) {
      for (const pose of poses) {
        poseRevertInto(root, pose, card, s);
        const want = poseMatricesFor(pose, card);
        for (const n of MOVING_NODES) {
          const o = root.getObjectByName(n)!;
          const got = new Matrix4().compose(o.position, o.quaternion, o.scale);
          const w = want[n];
          expect(w, n).toBeDefined();
          got.elements.forEach((v, i) => expect(v).toBeCloseTo(w!.elements[i]!, 5));
        }
      }
    }
  });
});
