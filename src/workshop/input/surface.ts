/**
 * The recogniser's view of the world (`GestureWorld`), assembled from three
 * things the shell hands in: a screen-to-ray function (the camera), a pick
 * function (view/picking) and the read-only `WorldView`. What a thing *is*
 * for input (part, handle, plug, jack) is read from the registry's
 * affordances, never from what a machine does.
 */
import type { Id, Quat, Vec3, WorldView } from '../sim/types.ts';
import { CarryPlane, type CarryTuning, type Obstacle, type RayLike } from './carry.ts';
import type { GestureWorld, PointerKind, Role, Target } from './gesture.ts';

export interface SurfaceDeps {
  readonly world: () => WorldView | null;
  /** The pointer ray for a point in CSS pixels of the canvas. */
  ray(x: number, y: number): RayLike;
  /** The nearest pickable under the ray (touch: larger hit areas), ignoring `exclude`. */
  pick(ray: RayLike, kind: PointerKind, exclude: Id | null): { id: Id; point: Vec3 } | null;
  /** Half extents of a loose part's body (from its proxy), or null if unknown. */
  half(id: Id): Vec3 | null;
  carry?: Partial<CarryTuning>;
}

export interface Surface extends GestureWorld {
  readonly plane: CarryPlane | null;
  /** What `id` is to input, from its affordances. */
  role(id: Id): Role;
  /** Current obstacles (statics and every loose part but `exclude`), for tests and overlays. */
  obstacles(exclude: Id | null): Obstacle[];
}

/** Height of a rotated box's top above its centre (its half extent along world Y). */
export function halfHeight(q: Quat, half: Vec3): number {
  const [x, y, z, w] = q;
  // second row of the rotation matrix
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  return Math.abs(r10) * half[0] + Math.abs(r11) * half[1] + Math.abs(r12) * half[2];
}

/** Horizontal half extents (x, z) of a rotated box's world AABB. */
export function halfFootprint(q: Quat, half: Vec3): [number, number] {
  const [x, y, z, w] = q;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);
  return [Math.abs(r00) * half[0] + Math.abs(r01) * half[1] + Math.abs(r02) * half[2], Math.abs(r20) * half[0] + Math.abs(r21) * half[1] + Math.abs(r22) * half[2]];
}

export function createSurface(deps: SurfaceDeps): Surface {
  let plane: CarryPlane | null = null;
  let carried: { id: Id; what: 'part' | 'plug'; halfX: number; halfZ: number } | null = null;
  const staticObstacles = new Map<string, Obstacle[]>();

  const statics = (w: WorldView): Obstacle[] => {
    let s = staticObstacles.get(w.scene.id);
    if (!s) {
      s = [];
      for (const st of w.scene.statics) {
        const boxes = st.shape.type === 'box' ? [{ half: st.shape.half, at: [0, 0, 0] as Vec3 }] : st.shape.parts.map((p) => ({ half: p.half, at: p.at.p }));
        for (const b of boxes) {
          const [hx, hz] = halfFootprint(st.pose.q, b.half);
          const hy = halfHeight(st.pose.q, b.half);
          const cx = st.pose.p[0] + b.at[0];
          const cy = st.pose.p[1] + b.at[1];
          const cz = st.pose.p[2] + b.at[2];
          s.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, top: cy + hy, bottom: cy - hy });
        }
      }
      staticObstacles.set(w.scene.id, s);
    }
    return s;
  };

  const role = (id: Id): Role => {
    const w = deps.world();
    const it = w?.interactable(id);
    if (!w || !it) return 'none';
    const a = it.affordances;
    if (a.includes('grab')) return 'part';
    if (a.includes('plug')) return w.cord(id) ? 'plug' : 'jack';
    if (a.includes('press') || a.includes('turn') || a.includes('slide') || a.includes('open')) return 'handle';
    return 'none';
  };

  const obstacles = (exclude: Id | null): Obstacle[] => {
    const w = deps.world();
    if (!w) return [];
    const out = statics(w).slice();
    for (const p of w.parts()) {
      if (p.id === exclude) continue;
      const m = w.motion(p.id);
      if (!m || m.mode === 'chute' || m.mode === 'held') continue;
      const half = deps.half(p.id);
      if (!half) continue;
      const [hx, hz] = halfFootprint(m.pose.q, half);
      const hy = halfHeight(m.pose.q, half);
      const c = m.pose.p;
      out.push({ minX: c[0] - hx, maxX: c[0] + hx, minZ: c[2] - hz, maxZ: c[2] + hz, top: c[1] + hy, bottom: c[1] - hy });
    }
    return out;
  };

  const benchPoint = (ray: RayLike): Vec3 | null => {
    const w = deps.world();
    const top = w?.scene.bench.top ?? 0;
    if (ray.dir[1] > -1e-6) return null;
    const t = (top - ray.origin[1]) / ray.dir[1];
    return [ray.origin[0] + ray.dir[0] * t, top, ray.origin[2] + ray.dir[2] * t];
  };

  const surface: Surface = {
    get plane() {
      return plane;
    },
    get bracketed() {
      return deps.world()?.bracketed ?? false;
    },
    role,
    obstacles,

    at(x, y, kind, exclude): Target {
      const ray = deps.ray(x, y);
      const hit = deps.pick(ray, kind, exclude);
      if (!hit) return { id: null, role: 'none', point: benchPoint(ray) };
      return { id: hit.id, role: role(hit.id), point: hit.point };
    },

    beginCarry(id, what, grip, t) {
      const w = deps.world();
      if (!w) return;
      plane ??= new CarryPlane(w.scene.bench, deps.carry);
      if (what === 'plug') {
        const cord = w.cord(id);
        const jackZ = cord ? jackDepth(w, cord.jack) : grip[2];
        plane.begin({ kind: 'plug', jackZ }, grip, t, []);
        carried = { id, what, halfX: 0.08, halfZ: 0.08 };
        return;
      }
      const m = w.motion(id);
      const half = deps.half(id) ?? [0.25, 0.25, 0.25];
      const q = m?.pose.q ?? ([0, 0, 0, 1] as Quat);
      const [hx, hz] = halfFootprint(q, half);
      const bottom = (m?.pose.p[1] ?? grip[1]) - halfHeight(q, half);
      carried = { id, what, halfX: hx, halfZ: hz };
      plane.begin({ kind: 'part', halfX: hx, halfZ: hz, gripAboveBottom: Math.max(0, grip[1] - bottom) }, grip, t, obstacles(id));
    },

    carryTarget(x, y, t) {
      const ray = deps.ray(x, y);
      if (!plane || !carried) return benchPoint(ray) ?? [0, 0, 0];
      return plane.target(ray, t, carried.what === 'part' ? obstacles(carried.id) : []);
    },

    spot(x, y) {
      const ray = deps.ray(x, y);
      const w = deps.world();
      if (!w) return [0, 0, 0];
      plane ??= new CarryPlane(w.scene.bench, deps.carry);
      return plane.spot(ray, carried?.halfX ?? 0.2, carried?.halfZ ?? 0.2, obstacles(carried?.id ?? null));
    },

    endCarry() {
      plane?.end();
      carried = null;
    },
  };
  return surface;
}

/** z of a jack on the board (scene data). */
function jackDepth(w: WorldView, jack: Id): number {
  const j = w.scene.cord.jacks.find((k) => k.id === jack);
  return j ? j.at[2] : w.scene.bench.minZ + 1;
}
