/**
 * The keyboard focus mark (I1 round 2; REWRITE.md § E9 "focus is always
 * visible", § B6 keyboard column). One view for every station: whatever has
 * the keyboard's focus (`Frame.focused`) gets four cream corner brackets
 * standing a hair off its pick target's box on screen, like the corners of a
 * photo pinned to a board; while the keys hold something, the destination
 * they have chosen (`Frame.keyDest`) gets the same mark in a lighter weight.
 * No station draws anything for focus.
 *
 * Steady: it never blinks or pulses (§ E9: nothing flashes). It follows its
 * target (a crate moving on the belt) because it is rebuilt every frame from
 * the box. Drawn over everything, unlit, not shadowed, in `paper`; one mesh,
 * one draw call, drawn only when something is focused.
 *
 * Sizes are in CSS pixels of the stage (read from the window: the view has
 * no renderer), so it reads the same at the home framing on a laptop and on
 * a phone.
 */
import { Box3, Vector3, type BufferAttribute, type PerspectiveCamera } from 'three';
import type { Id } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { focusMarkMesh, FOCUS_MARK_VERTS } from '../kit/stage-helpers.ts';

/** Tune here: CSS px. */
export const FOCUS_FEEL = {
  /** How far the brackets stand off the target's box. */
  margin: 7,
  /** A bracket's arm: its length (at most this share of the shorter side), and its thickness: focus, then the destination. */
  arm: 15,
  armShare: 0.38,
  thick: [3.5, 2] as const,
  /** Brightness of each weight (the colour is the material's `paper`). */
  shade: [1, 0.78] as const,
} as const;

export function createFocusView(): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const mesh = focusMarkMesh(2, ctx.materials.focusMark());
    ctx.scene.add(mesh);
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    const camera = (ctx.stage.camera as unknown as { camera: PerspectiveCamera }).camera;
    const box = new Box3();
    const v = new Vector3();

    /** Write mark `m` round `id`'s box; false when it has no box or is off screen. */
    function mark(m: number, id: Id, weight: 0 | 1): boolean {
      if (!ctx.targetBox?.(id, box)) return false;
      const H = Math.max(1, (globalThis as { innerHeight?: number }).innerHeight ?? 900);
      const W = H * camera.aspect;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        if (v.z > 1) return false; // behind the camera
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z);
      }
      if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return false;
      // px → NDC
      const px = 2 / W, py = 2 / H;
      const F = FOCUS_FEEL;
      x0 -= F.margin * px; x1 += F.margin * px; y0 -= F.margin * py; y1 += F.margin * py;
      const side = Math.min((x1 - x0) / px, (y1 - y0) / py);
      const arm = Math.min(F.arm, side * F.armShare);
      const ax = arm * px, ay = arm * py, tx = F.thick[weight] * px, ty = F.thick[weight] * py;
      const z = Math.max(-0.999, Math.min(0.999, z0));
      let k = m * FOCUS_MARK_VERTS;
      const quad = (qx0: number, qy0: number, qx1: number, qy1: number): void => {
        for (const [x, y] of [[qx0, qy0], [qx1, qy0], [qx1, qy1], [qx0, qy1]] as const) {
          v.set(x, y, z).unproject(camera);
          pos.setXYZ(k, v.x, v.y, v.z);
          const s = F.shade[weight];
          col.setXYZ(k, s, s, s);
          k++;
        }
      };
      // four brackets: each a horizontal and a vertical bar meeting at the corner
      for (const [cx, sx] of [[x0, 1], [x1, -1]] as const)
        for (const [cy, sy] of [[y0, 1], [y1, -1]] as const) {
          quad(Math.min(cx, cx + sx * ax), Math.min(cy, cy + sy * ty), Math.max(cx, cx + sx * ax), Math.max(cy, cy + sy * ty));
          quad(Math.min(cx, cx + sx * tx), Math.min(cy, cy + sy * ay), Math.max(cx, cx + sx * tx), Math.max(cy, cy + sy * ay));
        }
      return true;
    }

    return {
      root: mesh,
      update(frame: Frame) {
        camera.updateMatrixWorld();
        let n = 0;
        // while the keys carry the focused thing it is plainly in the hand: only where it is going is marked
        const carried = frame.keyDest !== null && frame.focused === frame.held;
        if (frame.focused !== null && !carried && mark(n, frame.focused, 0)) n++;
        if (frame.keyDest !== null && frame.keyDest !== frame.focused && mark(n, frame.keyDest, 1)) n++;
        // a quad is six indices
        mesh.geometry.setDrawRange(0, n * (FOCUS_MARK_VERTS / 4) * 6);
        mesh.visible = n > 0;
        if (n > 0) {
          pos.needsUpdate = true;
          col.needsUpdate = true;
        }
      },
      dispose() {
        ctx.scene.remove(mesh);
        mesh.geometry.dispose();
      },
    };
  };
}
