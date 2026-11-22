/**
 * P4 S5 round three: a crew member in the way of what is being looked at goes see-through. While a look holds the
 * camera (`CameraRig.look`: an opened crate's card, shell/boot.ts `lookAt`), any crew body standing between the camera
 * and that box fades, the whole body at once, to a fine screen door (`EffectMaterials.seeThrough`: its own materials'
 * twins, the same programs, one uniform per body), and comes back when it is out of the way or the look is left.
 *
 * - *Crew*: every member the world lists (`WorldView.crewViews()`), each by the body the page registered as its pick
 *   target (its body part's id, or its own); a new member needs nothing here.
 * - *In the way*: its pick box and the look's box overlap on screen, and its nearest point is nearer the camera than the
 *   middle of the look's box. Judged here, once a frame, from boxes; the world is not told and no robot does anything
 *   differently.
 * - Never a body in the visitor's hand. Under reduced motion it cuts. Its shadow stays (the shadow pass draws its own
 *   depth material).
 *
 * `?seeThrough=0`: never (measurements, "before"); `?seeThrough=all`: every body, always (the frame-time A/B).
 */
import { Box3, Group, Matrix4, Ray, Vector3, type Material, type Mesh, type Object3D } from 'three';
import type { Id } from '../../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../../types.ts';
import type { CameraRig } from '../../stage/camera.ts';
import { ORDER, type BenchStation } from '../station.ts';

/** Tune here. */
export const SEE_THROUGH = {
  /** The share of a faded body's pixels dropped (it stays there, as a ghost of itself). */
  fade: 0.75,
  /** How fast it fades and comes back (share per second). */
  rate: 5,
  /** Screen overlap (NDC, a share of the frame's half height) a box is grown by before it counts as in the way. */
  pad: 0.01,
} as const;

type Mode = 'on' | 'off' | 'all';
const mode = (): Mode => {
  try {
    const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get('seeThrough');
    return q === '0' ? 'off' : q === 'all' ? 'all' : 'on';
  } catch {
    return 'on';
  }
};

interface Body {
  /** The pick target it was found by (its box is the body's). */
  readonly key: Id;
  readonly obj: Object3D;
  readonly fade: { value: number };
  /** The meshes and the materials they had, while swapped. */
  swapped: Map<Mesh, Material | Material[]> | null;
  level: number;
}

const corners = (b: Box3, f: (p: Vector3) => void): void => {
  const p = new Vector3();
  for (let i = 0; i < 8; i++) f(p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
};

/** A box on screen (NDC, x and y) and its nearest and middle depth along the view (world units). */
function onScreen(b: Box3, cam: CameraRig, out: { x0: number; x1: number; y0: number; y1: number; near: number; mid: number }): typeof out {
  const c = cam.camera;
  const o = new Vector3().setFromMatrixPosition(c.matrixWorld);
  const dir = new Vector3(0, 0, -1).transformDirection(c.matrixWorld);
  const view = new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  out.x0 = out.y0 = Infinity;
  out.x1 = out.y1 = -Infinity;
  out.near = Infinity;
  const q = new Vector3();
  corners(b, (p) => {
    out.near = Math.min(out.near, q.copy(p).sub(o).dot(dir));
    q.copy(p).applyMatrix4(view);
    out.x0 = Math.min(out.x0, q.x);
    out.x1 = Math.max(out.x1, q.x);
    out.y0 = Math.min(out.y0, q.y);
    out.y1 = Math.max(out.y1, q.y);
  });
  out.mid = b.getCenter(q).sub(o).dot(dir);
  return out;
}

export function createSeeThroughView(): (ctx: ViewContext) => StationView {
  return (ctx) => {
    const root = new Group();
    root.name = 'see-through';
    // (it draws nothing; in the scene so a measurement finds its levels by name)
    ctx.scene.add(root);
    const m = mode();
    const bodies = new Map<Id, Body>();
    /** What each body's level is (measurements read it: `root.userData.levels`). */
    const levels = new Map<Id, number>();
    root.userData.levels = levels;
    const box = new Box3();
    const a = { x0: 0, x1: 0, y0: 0, y1: 0, near: 0, mid: 0 };
    const t = { x0: 0, x1: 0, y0: 0, y1: 0, near: 0, mid: 0 };

    const swap = (b: Body, on: boolean): void => {
      if (on && !b.swapped) {
        const was = new Map<Mesh, Material | Material[]>();
        b.obj.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const twin = (x: Material): Material => ctx.materials.seeThrough?.(x, b.fade) ?? x;
          was.set(mesh, mesh.material);
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(twin) : twin(mesh.material);
        });
        b.swapped = was;
      } else if (!on && b.swapped) {
        for (const [mesh, mat] of b.swapped) mesh.material = mat;
        b.swapped = null;
      }
    };

    return {
      root,
      update(frame: Frame) {
        if (m === 'off' || !ctx.materials.seeThrough || !ctx.targetObject) return;
        const cam = ctx.stage.camera as CameraRig;
        const look = m === 'all' ? null : cam.look;
        // (round four) in the way by rays: lines from the camera to points of what must show (the look target's parts
        // `.face`, `.plate`, `.thing`; else the look box's middle and four points round it), and a body is in the way
        // when its box cuts enough of them before they arrive
        const eye = cam.camera.getWorldPosition(new Vector3());
        const pts: Vector3[] = [];
        if (look) {
          const grid = (bx: Box3, n: number): void => {
            for (let i = 0; i < n; i++)
              for (let j = 0; j < n; j++) {
                const u = n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1), v = n === 1 ? 0.5 : 0.15 + (0.7 * j) / (n - 1);
                pts.push(new Vector3(bx.min.x + (bx.max.x - bx.min.x) * u, bx.min.y + (bx.max.y - bx.min.y) * v, (bx.min.z + bx.max.z) / 2));
              }
          };
          const id = cam.lookId;
          if (id !== null && ctx.targetBox?.(`${id}.face`, box)) grid(box, 3);
          if (id !== null && ctx.targetBox?.(`${id}.plate`, box)) grid(box, 1);
          if (id !== null && ctx.targetBox?.(`${id}.thing`, box)) {
            grid(box, 2);
            pts.push(new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2));
          }
          if (pts.length === 0) grid(look, 2);
        }
        const need = Math.max(2, Math.ceil(pts.length * 0.15));
        const ray = new Ray();
        const hit = new Vector3();
        const cut = ctx.reducedMotion || frame.world.reducedMotion;
        for (const cv of frame.world.crewViews()) {
          const ids = cv.body !== null ? [cv.body, cv.id] : [cv.id];
          let b = bodies.get(cv.id);
          if (!b) {
            let obj: Object3D | null = null;
            let key: Id | null = null;
            for (const id of ids) {
              obj = ctx.targetObject(id);
              if (obj) {
                key = id;
                break;
              }
            }
            if (!obj || key === null) continue;
            b = { key, obj, fade: { value: 0 }, swapped: null, level: 0 };
            bodies.set(cv.id, b);
          }
          const key = b.key;
          const held = ids.includes(frame.held ?? '');
          let want = 0;
          if (!held && (m === 'all' || look) && b.obj.visible) {
            if (m === 'all') want = SEE_THROUGH.fade;
            else if (ctx.targetBox?.(key, box)) {
              let cuts = 0;
              for (const p of pts) {
                const d = p.distanceTo(eye);
                ray.set(eye, hit.copy(p).sub(eye).normalize());
                if (ray.intersectBox(box, hit) && hit.distanceTo(eye) < d - 0.02) cuts++;
              }
              if (cuts >= need) want = SEE_THROUGH.fade;
            }
          }
          b.level = cut ? want : b.level + Math.sign(want - b.level) * Math.min(Math.abs(want - b.level), SEE_THROUGH.rate * frame.dt);
          if (b.level > 0) swap(b, true);
          b.fade.value = b.level;
          if (b.level <= 0) swap(b, false);
          levels.set(cv.id, b.level);
        }
      },
      dispose() {
        root.removeFromParent();
        for (const b of bodies.values()) swap(b, false);
        bodies.clear();
      },
    };
  };
}

export const station: BenchStation = {
  name: 'see-through',
  order: ORDER.late + 5,
  make() {
    return createSeeThroughView();
  },
};
