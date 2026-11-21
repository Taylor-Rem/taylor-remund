// K2: a framing that slides a box into what the page leaves uncovered measures the slide at the distance the camera
// will rest at (its zoom limits applied), so a small thing framed close (zoom clamped at 1) lands in the middle of
// the clear area, not past it (shell/bench-stage.ts `framedView`).
import { Box3, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import { framedView } from '../../../src/workshop/shell/bench-stage.ts';
import type { Stage } from '../../../src/workshop/view/stage/index.ts';

const bench = new Box3(new Vector3(-10.8, -1, -5), new Vector3(10.8, 6, 5));

/** The box's centre on screen (CSS px) with the rig cut to `v`. */
function centreAt(rig: CameraRig, box: Box3, W: number, H: number): { x: number; y: number } {
  const s = rig.worldToScreen(box.getCenter(new Vector3()));
  return { x: ((s.x + 1) / 2) * W, y: ((1 - s.y) / 2) * H };
}

describe('framedView', () => {
  for (const [W, H, inset] of [
    [390, 844, { top: 350, right: 0, bottom: 40, left: 0 }],
    [1440, 900, { top: 40, right: 300, bottom: 30, left: 0 }],
  ] as const) {
    test(`at ${W}×${H}, a small thing framed close sits in the middle of the clear area`, () => {
      const rig = new CameraRig({ fov: 20, pitch: 33, margin: 0.035 });
      rig.setAspect(W / H);
      rig.stationSize = 1.9;
      rig.setSubject(new Box3(new Vector3(-3, 0, -2), new Vector3(3, 2, 3)), { bounds: bench });
      const thing = new Box3(new Vector3(-1.2, 0.6, 1.4), new Vector3(-0.9, 1.0, 1.7));
      // framed by itself: closer than the camera may come, so the zoom is held at 1
      const v = framedView({ camera: rig } as unknown as Stage, thing, inset, W, H);
      expect(v.zoom).toBeGreaterThanOrEqual(0);
      expect(v.zoom).toBeLessThanOrEqual(1);
      rig.cutTo(v);
      const c = centreAt(rig, thing, W, H);
      const cx = (inset.left + W - inset.right) / 2, cy = (inset.top + H - inset.bottom) / 2;
      const w = W - inset.left - inset.right, h = H - inset.top - inset.bottom;
      expect(v.zoom).toBe(1);
      expect(Math.abs(c.x - cx)).toBeLessThan(w * 0.05);
      expect(Math.abs(c.y - cy)).toBeLessThan(h * 0.05);
    });
  }
});
