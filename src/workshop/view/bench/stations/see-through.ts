/**
 * P4 S5 round three: a crew member in the way of what is being looked at goes see-through. While a look holds the
 * camera (`CameraRig.look`: an opened crate's card, shell/boot.ts `lookAt`), any crew body standing between the camera
 * and that box fades, the whole body at once, to a fine screen door (`EffectMaterials.fade`: the materials module
 * draws each mesh with its see-through twin, the same programs, one uniform per body, and owns which material that is,
 * with the paint scheme's keep twins: D2c), and comes back when it is out of the way or the look is left.
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
import { Box3, Group, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three';
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

/** (D2c) Seconds after this view's first frame before the ghosts' programs are built (the bench usable by then). */
export const PREPARE_AFTER = 1.5;
/**
 * (D2c) ...and only once the bench has been calm this long: nothing in a hand and no loose part flying or rolling. A
 * program links on the main thread where the GPU has no parallel compile (this laptop), long enough to jolt a hand
 * mid-throw (measured: the juggling tests drift 0.53 where they hold under 0.3).
 */
export const PREPARE_CALM = 1.2;

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
  /** Whether it is faded now (the materials module holds what each mesh had: one owner, D2c). */
  swapped: boolean;
  /** (D2c) Its ghosts' programs are built and linked: until then it stays solid. */
  ready: boolean;
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

    /**
     * (D2c) The ghosts' programs, built ahead (only a ghost's program carries the screen door). From `PREPARE_AFTER`
     * seconds after this view's first frame (the bench is live and usable by then), one body at a time, each program
     * linked in a task of its own; a body fades only once its are ready. Without the means (a stand-in), at once.
     */
    const queue: Body[] = [];
    let firstAt: number | null = null;
    let busyAt = -Infinity;
    let preparing = false;
    /** Something in a hand, or a loose part awake and free (thrown, falling, rolling): a hand may be at work. */
    const busy = (w: Frame['world']): boolean => {
      if (w.holding() !== null) return true;
      for (const p of w.parts()) {
        const m = w.motion(p.id);
        if (m && m.awake && (m.mode === 'free' || m.held)) return true;
      }
      return false;
    };
    const pump = (time: number, w: Frame['world']): void => {
      if (preparing || queue.length === 0 || firstAt === null) return;
      if (busy(w)) busyAt = time;
      if (time - firstAt < PREPARE_AFTER || time - busyAt < PREPARE_CALM) return;
      const b = queue.shift()!;
      const compile = ctx.stage.compileObject?.bind(ctx.stage);
      if (!ctx.materials.prepareFade || !compile) {
        b.ready = true;
        return;
      }
      preparing = true;
      ctx.materials.prepareFade(b.obj, b.fade, compile).then(
        (n) => {
          programs += n;
          b.ready = true;
          preparing = false;
        },
        () => {
          b.ready = true;
          preparing = false;
        },
      );
    };
    let programs = 0;
    root.userData.ghostPrograms = () => programs;

    // (D2c) the materials module owns each mesh's material (this fade, the paint scheme's keep twins): ask it
    const swap = (b: Body, on: boolean): void => {
      if (on === b.swapped) return;
      ctx.materials.fade?.(b.obj, on ? b.fade : null);
      b.swapped = on;
    };

    return {
      root,
      update(frame: Frame) {
        if (m === 'off' || !ctx.materials.fade || !ctx.targetObject) return;
        firstAt ??= frame.time;
        pump(frame.time, frame.world);
        const cam = ctx.stage.camera as CameraRig;
        const look = m === 'all' ? null : cam.look;
        const px = SEE_THROUGH.pad;
        if (look) onScreen(look, cam, a);
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
            b = { key, obj, fade: { value: 0 }, swapped: false, ready: false, level: 0 };
            queue.push(b);
            bodies.set(cv.id, b);
          }
          const key = b.key;
          const held = ids.includes(frame.held ?? '');
          let want = 0;
          if (b.ready && !held && (m === 'all' || look) && b.obj.visible) {
            if (m === 'all') want = SEE_THROUGH.fade;
            else if (ctx.targetBox?.(key, box)) {
              onScreen(box, cam, t);
              const overlap = t.x0 < a.x1 + px && t.x1 > a.x0 - px && t.y0 < a.y1 + px && t.y1 > a.y0 - px;
              if (overlap && t.near < a.mid) want = SEE_THROUGH.fade;
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
