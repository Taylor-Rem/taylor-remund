/**
 * The recogniser's view of the world (`GestureWorld`), assembled from what
 * the shell hands in: a screen-to-ray function (the camera), a pick
 * function (view/picking), a projection, and the read-only `WorldView`.
 * What a thing *is* for input (part, unit, handle, dial, lever, plug, jack,
 * mouth) is read from the registry's affordances and the scene's data,
 * never from what a machine does.
 */
import type { Id, Quat, Vec3, WorldView } from '../sim/types.ts';
import { CarryPlane, heldUp, rayAtDepth, UpHold, type CarryTuning, type Obstacle, type RayLike } from './carry.ts';
import type { GestureWorld, HandleReading, HeldKind, PointerKind, Role, Target } from './gesture.ts';
import { aimFromWorld, clampToPolygon, readingFromWorld } from './readings.ts';

export interface SurfaceDeps {
  readonly world: () => WorldView | null;
  /** The pointer ray for a point in CSS pixels of the canvas. */
  ray(x: number, y: number): RayLike;
  /**
   * The nearest pickable under the ray (touch: larger hit areas), ignoring `exclude`. `holding`: something
   * is in the hand, so the places it may be set down (mouths) are pickable too.
   */
  pick(ray: RayLike, kind: PointerKind, exclude: Id | null, holding?: HeldKind | null): { id: Id; point: Vec3 } | null;
  /** Half extents of a loose part's body (from its proxy), or null if unknown. */
  half(id: Id): Vec3 | null;
  /** A pick target's centre in the world (its proxy's), or null. */
  centre?(id: Id): Vec3 | null;
  /** A pick target on screen: its centre and radius in CSS px, or null. */
  screen?(id: Id): { x: number; y: number; r: number } | null;
  /** Ids that open something of the page's (the phone): a hand presses them like a handle. */
  panels?(): ReadonlySet<Id>;
  /** Interactables a hand reaches through something else (the line, through the phone): left out of the controls list. */
  hidden?(): ReadonlySet<Id>;
  /** A world point on screen (CSS px of the canvas), or null behind the camera. */
  project?(p: Vec3): [number, number] | null;
  /** The way the camera looks (unit), for reading a hand straight up the screen as straight up. */
  forward?(): Vec3;
  /** World units per CSS pixel at a world point (the camera's scale there), for reaches measured on screen. */
  unitsPerPx?(p: Vec3): number;
  /** A handle's reading (default: `readingFromWorld`). */
  reading?(id: Id): HandleReading | null;
  carry?: Partial<CarryTuning>;
  aim?: Partial<AimTuning>;
}

export interface Surface extends GestureWorld {
  readonly plane: CarryPlane | null;
  /** What `id` is to input, from its affordances. */
  role(id: Id): Role;
  /** Current obstacles (statics and every loose part but `exclude`), for tests and overlays. */
  obstacles(exclude: Id | null): Obstacle[];
}

/** Tune here: the lamp's arm (a unit held that `slide`s: the light it casts moves with the hand on screen). */
export const AIM_TUNING = {
  /** The aim follows the hand on a critically damped spring: ω in rad/s. Lower is heavier. */
  omega: 16,
} as const;
export type AimTuning = { -readonly [K in keyof typeof AIM_TUNING]: number };

/**
 * Tune here: how far from a jack a plug let go still seats in it: this many world units in the board's
 * plane, or this many CSS px on screen if that is more (a small screen: a fingertip's reach), mouse and touch.
 */
export const JACK_REACH = 0.42;
export const JACK_REACH_PX = { mouse: 18, touch: 34 } as const;

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

/** A critically damped spring on the bench plane (x, z), stepped by elapsed time. */
class Aim {
  x = 0;
  z = 0;
  private vx = 0;
  private vz = 0;
  private t = 0;
  private readonly omega: number;
  constructor(omega: number) {
    this.omega = omega;
  }
  reset(x: number, z: number, t: number): void {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.t = t;
  }
  to(x: number, z: number, t: number): void {
    let dt = Math.min(0.1, Math.max(0, (t - this.t) / 1000));
    this.t = Math.max(this.t, t);
    const w = this.omega;
    // sub-steps keep it stable for a long frame
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120);
      const ax = w * w * (x - this.x) - 2 * w * this.vx;
      const az = w * w * (z - this.z) - 2 * w * this.vz;
      this.vx += ax * h;
      this.vz += az * h;
      this.x += this.vx * h;
      this.z += this.vz * h;
      dt -= h;
    }
  }
}

/**
 * Tune here: how a flick up the screen leaves the hand. It is read on an upright plane through where the hand took
 * hold, facing the room (its depth fixed): up the screen is straight up, so a gentle flick goes up and
 * comes back down where it went up (Taylor: "throwing them up then catching them and back up again like juggling").
 * A hard one leans back the way the camera looks down, so it goes up and back and meets the back wall well up ("it
 * can be fun to throw them against the back wall too"): no lean below `from` u/s, `lean` times the line of sight's tilt
 * from `full` u/s, eased between.
 */
export const UP_FLICK = { from: 16, full: 28, lean: 1 } as const;

/** The upright plane through `p` facing the room (its depth fixed), its up (world up), and the line of sight's downward tilt. */
function facingAt(eye: Vec3, p: Vec3): { p: Vec3; n: Vec3; up: Vec3; pitch: number } | null {
  const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const hl = Math.hypot(d[0], d[2]);
  if (hl < 1e-6) return null;
  const pitch = Math.atan2(-d[1], hl);
  // facing the room (its depth fixed), as the hold up is (`UpHold`): straight up the screen is straight up
  const n: Vec3 = [0, 0, Math.sign(d[2]) || -1];
  const k = n[1];
  const up: Vec3 = [-k * n[0], 1 - k * n[1], -k * n[2]];
  const ul = Math.hypot(up[0], up[1], up[2]);
  if (ul < 1e-6) return null;
  return { p, n, up: [up[0] / ul, up[1] / ul, up[2] / ul], pitch };
}

/** The middle of a thing up in the air (a loose body flying, or Patch in flight), or null if it is not. */
function airborneMiddle(w: WorldView, id: Id): Vec3 | null {
  const m = w.motion(id);
  // flying: free, above the bench, and moving (a crate settling on the stack is awake but not in the air): more than
  // 0.01 a step, 0.6 u/s
  const step = m ? Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[1] - m.prev.p[1], m.pose.p[2] - m.prev.p[2]) : 0;
  if (m) return m.mode === 'free' && m.awake && step > 0.01 && m.pose.p[1] > w.scene.bench.top + 0.6 ? m.pose.p : null;
  const v = (w as unknown as { crewView?(id: Id): { view?: { state?: string; at?: Vec3 } } | undefined }).crewView?.(id)?.view;
  return v?.state === 'fly' && v.at ? [v.at[0], v.at[1] + 0.6, v.at[2]] : null;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function createSurface(deps: SurfaceDeps): Surface {
  let plane: CarryPlane | null = null;
  /** (R4) The height of the level plane the hand is measured on while it carries (where it took hold). */
  let handY: number | null = null;
  /** The surface's slope under the hand at its last sample (0 level, π/2 upright). */
  let handTheta = 0;
  /**
   * The upright plane through where the hand took hold, facing the room; its up (world
   * up) and the line of sight's downward tilt: a flick up the screen is read on it (`UP_FLICK`).
   */
  let facing: { p: Vec3; n: Vec3; up: Vec3; pitch: number } | null = null;
  const upHold = new UpHold();
  /** Where the hand held it at its last re-aim. */
  let lastTarget: Vec3 | null = null;
  let carried: {
    id: Id;
    what: HeldKind | 'aim';
    halfX: number;
    halfZ: number;
    reach?: readonly (readonly [number, number])[];
    /** An aim: where it pointed at the grab (world), and the screen offset from the hand to it (set by the first sample). */
    aim0?: Vec3;
    offset?: [number, number] | null;
  } | null = null;
  const aimT: AimTuning = { ...AIM_TUNING, ...deps.aim };
  const aim = new Aim(aimT.omega);
  const staticObstacles = new Map<string, Obstacle[]>();
  const noPanels: ReadonlySet<Id> = new Set();
  const panels = (): ReadonlySet<Id> => deps.panels?.() ?? noPanels;

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

  /** A held unit that also slides: an arm that aims (the lamp). */
  const aims = (w: WorldView, id: Id): boolean => !w.motion(id) && (w.interactable(id)?.affordances.includes('slide') ?? false);
  const isMouth = (w: WorldView, id: Id): boolean => (w.scene.mouths ?? []).some((m) => m.id === id);
  const isJack = (w: WorldView, id: Id): boolean => w.scene.cord.jacks.some((j) => j.id === id);

  const role = (id: Id): Role => {
    if (panels().has(id)) return 'handle';
    const w = deps.world();
    if (!w) return 'none';
    const it = w.interactable(id);
    const a = it?.affordances ?? [];
    if (a.includes('grab')) {
      const mode = w.mode(id);
      if (mode === 'chute' || mode === 'gone') return 'none'; // the world would refuse it
      return w.motion(id) ? 'part' : 'unit';
    }
    if (a.includes('plug')) return w.cord(id) ? 'plug' : 'jack';
    if (a.includes('turn')) return 'dial';
    if (a.includes('slide')) return 'lever';
    if (a.includes('press') || a.includes('open')) return 'handle';
    if (isJack(w, id)) return 'jack'; // a capped jack: it refuses, with a slip
    if (isMouth(w, id)) return 'mouth';
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

  const clampBench = (w: WorldView, x: number, z: number): [number, number] => {
    const b = w.scene.bench;
    return [Math.min(b.maxX, Math.max(b.minX, x)), Math.min(b.maxZ, Math.max(b.minZ, z))];
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

    at(x, y, kind, exclude, holding = null): Target {
      const ray = deps.ray(x, y);
      const hit = deps.pick(ray, kind, exclude, holding);
      if (!hit) return { id: null, role: 'none', point: benchPoint(ray) };
      return { id: hit.id, role: role(hit.id), point: hit.point };
    },

    beginCarry(id, what, grip, t) {
      const w = deps.world();
      if (!w) return;
      handY = grip[1];
      facing = facingAt(deps.ray(0, 0).origin, grip);
      plane ??= new CarryPlane(w.scene.bench, deps.carry);
      if (what === 'plug') {
        const cord = w.cord(id);
        const jackZ = cord ? jackDepth(w, cord.jack) : grip[2];
        plane.begin({ kind: 'plug', jackZ }, grip, t, []);
        carried = { id, what, halfX: 0.08, halfZ: 0.08 };
        return;
      }
      if (aims(w, id)) {
        // an arm that aims (the lamp): the hand drags the point on the bench it is over, and the arm follows with
        // weight, from where it points now (the grab's grip, `gripFor`)
        const now = aimFromWorld(w, id);
        const aim0: Vec3 = now ? now.aim : [grip[0], w.scene.bench.top, grip[2]];
        aim.reset(aim0[0], aim0[2], t);
        carried = { id, what: 'aim', halfX: 0, halfZ: 0, aim0, offset: null, ...(now ? { reach: now.reach } : {}) };
        return;
      }
      const m = w.motion(id);
      const half = deps.half(id) ?? [0.25, 0.25, 0.25];
      const q = m?.pose.q ?? ([0, 0, 0, 1] as Quat);
      const [hx, hz] = halfFootprint(q, half);
      const bottom = (m?.pose.p[1] ?? grip[1] - half[1]) - (m ? halfHeight(q, half) : 0);
      carried = { id, what, halfX: hx, halfZ: hz };
      plane.begin({ kind: 'part', halfX: hx, halfZ: hz, gripAboveBottom: Math.max(0, grip[1] - bottom) }, grip, t, obstacles(id));
      // caught in the air: the world says it is flying (over a station its bottom may be low above what is under it)
      upHold.begin(t, grip, plane.caught || airborneMiddle(w, id) !== null);
      lastTarget = grip;
    },

    carryTarget(x, y, t) {
      const ray = deps.ray(x, y);
      const w = deps.world();
      if (carried?.what === 'aim' && w) {
        // The pool of light moves with the hand on screen: the hand's travel since the grab is applied to where the
        // light fell, and that screen point is put back on the bench. (Taking the bench point under the hand itself
        // would send the light behind the wall at the grab: the shade hangs in front of the wall.)
        if (carried.offset === null && carried.aim0) {
          const s0 = deps.project?.(carried.aim0) ?? null;
          carried.offset = s0 ? [s0[0] - x, s0[1] - y] : [0, 0];
        }
        const o = carried.offset ?? [0, 0];
        const p = o[0] === 0 && o[1] === 0 ? benchPoint(ray) : benchPoint(deps.ray(x + o[0], y + o[1]));
        if (p) {
          let [cx, cz] = clampBench(w, p[0], p[2]);
          if (carried.reach) [cx, cz] = clampToPolygon(cx, cz, carried.reach);
          aim.to(cx, cz, t);
        }
        return [aim.x, w.scene.bench.top, aim.z];
      }
      if (!plane || !carried) return benchPoint(ray) ?? [0, 0, 0];
      const onSurface = plane.target(ray, t, carried.what === 'part' ? obstacles(carried.id) : []);
      if (carried.what === 'plug') return onSurface;
      // held up: a fast lift up the screen, or a thing caught in the air, rises in place instead of sliding back
      lastTarget = upHold.target(ray, x, y, t, onSurface, Math.min(plane.tuning.top, w?.scene.bench.ceiling ?? plane.tuning.top), deps.forward?.() ?? null);
      return lastTarget;
    },

    spot(x, y) {
      const ray = deps.ray(x, y);
      const w = deps.world();
      if (!w) return [0, 0, 0];
      if (carried?.what === 'aim') return [aim.x, w.scene.bench.top, aim.z];
      plane ??= new CarryPlane(w.scene.bench, deps.carry);
      return plane.spot(ray, carried?.halfX ?? 0.2, carried?.halfZ ?? 0.2, obstacles(carried?.id ?? null));
    },

    endCarry() {
      plane?.end();
      carried = null;
      handY = null;
      handTheta = 0;
      facing = null;
      lastTarget = null;
    },

    handFacing(x, y) {
      if (!facing) return null;
      // read as the hold up is (`heldUp`): at the depth where the hand holds it now, straight up the screen straight up
      return heldUp(deps.ray(x, y), upHold.anchored ?? lastTarget ?? facing.p, deps.forward?.() ?? null);
    },

    throwFrom(v, onFacing) {
      // (Taylor, 2026-11-20: "You should be able to throw them up") A flick with any part up the screen is read on
      // the plane facing the camera: it leaves the hand going on as the pointer went on the screen, up and back as
      // the line of sight sees up (and meets the back wall well up when thrown that way).
      if (facing && onFacing) {
        const u = onFacing[0] * facing.up[0] + onFacing[1] * facing.up[1] + onFacing[2] * facing.up[2];
        if (u > 0) {
          // a hard flick leans back by the line of sight's tilt (eased in with speed): at the back wall
          const sp = Math.hypot(onFacing[0], onFacing[1], onFacing[2]);
          const k = smooth((sp - UP_FLICK.from) / (UP_FLICK.full - UP_FLICK.from));
          const a = k * UP_FLICK.lean * facing.pitch;
          const h = Math.hypot(facing.n[0], facing.n[2]) || 1;
          const bx = facing.n[0] / h;
          const bz = facing.n[2] / h; // away from the camera, level
          const vy = onFacing[1];
          return [onFacing[0] + vy * Math.sin(a) * bx, vy * Math.cos(a), onFacing[2] + vy * Math.sin(a) * bz];
        }
      }
      // Down the screen or level: read on the surface it rides, unrolled (x, -, s), put back in the world where it let
      // go: toward the room (s rising) is outward, as on the bench; away from the room runs along the surface there
      if (v[2] >= 0 || handTheta <= 0) return v;
      const along = -v[2];
      return [v[0], v[1] + along * Math.sin(handTheta), -along * Math.cos(handTheta)];
    },

    handPoint(x, y) {
      const ray = deps.ray(x, y);
      const w = deps.world();
      const h = handY ?? w?.scene.bench.top ?? 0;
      if (plane && carried && carried.what !== 'aim' && carried.what !== 'plug') {
        // the surface the carried thing rides, unrolled, with its level held at the grab's height: (x, h, s), where s
        // is z over the bench and runs on round the curve and up the upright face. Where it is, for the throw.
        const hit = plane.hit(ray, h);
        handTheta = hit.theta;
        return [hit.p[0], h, hit.s];
      }
      // a level plane through where the hand took hold (or the bench, for an arm that aims)
      const dy = ray.dir[1];
      const t = dy < -1e-6 ? (h - ray.origin[1]) / dy : 0;
      return [ray.origin[0] + ray.dir[0] * t, h, ray.origin[2] + ray.dir[2] * t];
    },

    gripFor(id, what, point) {
      // an arm that aims is taken where it points now, so the grab does not jump the light to the hand
      const w = deps.world();
      if (what === 'unit' && w && aims(w, id)) return aimFromWorld(w, id)?.aim ?? point;
      // (R5) caught in the air: taken by its middle (the press lands on the front of its pick box; and a tumbling
      // thing taken off its middle is turned level about the grip, which walks it), so holding it up and throwing it
      // again keeps it where it is. The press is aimed at it: its middle is a few pixels from the pointer at most.
      return (w ? airborneMiddle(w, id) : null) ?? point;
    },

    screen: (id) => deps.screen?.(id) ?? null,

    reading(id) {
      if (deps.reading) return deps.reading(id);
      const w = deps.world();
      return w ? readingFromWorld(w, id) : null;
    },

    jackNear(x, y, kind) {
      const w = deps.world();
      if (!w) return null;
      const jacks = w.scene.cord.jacks;
      if (jacks.length === 0) return null;
      const ray = deps.ray(x, y);
      // where the hand is in the board's plane (the jacks' face), then the nearest jack within reach
      let best: Id | null = null;
      let bestD = Infinity;
      const p: [number, number, number] = [0, 0, 0];
      const px = kind === 'mouse' ? JACK_REACH_PX.mouse : JACK_REACH_PX.touch;
      for (const j of jacks) {
        rayAtDepth(ray, j.at[2], p);
        const d = Math.hypot(p[0] - j.at[0], p[1] - j.at[1]);
        const reach = Math.max(JACK_REACH, px * (deps.unitsPerPx?.(j.at) ?? 0));
        if (d < reach && d < bestD) {
          bestD = d;
          best = j.id;
        }
      }
      if (best !== null) return best;
      // a touch's larger hit area: a jack's pick target under the finger
      const hit = deps.pick(ray, kind, w.holding()?.id ?? null, 'plug');
      return hit && isJack(w, hit.id) ? hit.id : null;
    },

    usable() {
      const w = deps.world();
      if (!w) return [];
      // the controls list: everything a hand can use, grouped by station in the registry's order
      const byStation = new Map<string, Id[]>();
      for (const it of w.interactables()) {
        if (it.affordances.length === 0 && !panels().has(it.id)) continue;
        if (deps.hidden?.().has(it.id)) continue;
        if (role(it.id) === 'none' || role(it.id) === 'jack') continue;
        let l = byStation.get(it.station);
        if (!l) byStation.set(it.station, (l = []));
        l.push(it.id);
      }
      for (const id of panels()) {
        const st = w.interactable(id)?.station ?? 'panels';
        let l = byStation.get(st);
        if (!l) byStation.set(st, (l = []));
        if (!l.includes(id)) l.push(id);
      }
      return [...byStation.values()].flat();
    },

    destinations(what) {
      const w = deps.world();
      if (!w) return [];
      if (what === 'plug') return w.scene.cord.jacks.map((j) => j.id);
      return (w.scene.mouths ?? []).map((m) => m.id);
    },

    where(id) {
      const w = deps.world();
      if (!w) return null;
      const mouth = (w.scene.mouths ?? []).find((m) => m.id === id);
      if (mouth) return mouth.drop;
      const jack = w.scene.cord.jacks.find((j) => j.id === id);
      if (jack) return jack.at;
      const m = w.motion(id);
      if (m) return m.pose.p;
      return deps.centre?.(id) ?? null;
    },
  };
  return surface;
}

/** z of a jack on the board (scene data). */
function jackDepth(w: WorldView, jack: Id): number {
  const j = w.scene.cord.jacks.find((k) => k.id === jack);
  return j ? j.at[2] : w.scene.bench.minZ + 1;
}
