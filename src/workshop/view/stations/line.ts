/**
 * The line's parts, alive (brief W1; REWRITE.md § B1 "the belt, the
 * striker, the dock, the bench edge", § B2 X2-X3, § D 5-7): what the line
 * does to a part ON TOP of where the simulation says the part is. The parts
 * view (`stations/parts.ts`) draws every loose part at its simulated pose;
 * this view is an overlay on the parts view (`partsHooks(scene).overlays`)
 * and adds the line's motion to the parts that are on the line, by changing
 * the matrix the parts view composed (so the part's contact shadow goes with
 * it):
 *
 *  - struck: the hammer's felt lands on it (the striker view says when, on
 *    the line's bus) and it squashes a hair about its foot and springs back;
 *  - riding: kinematic, it follows the belt exactly; it tips a hair as it
 *    crosses the hand-over from the belt's end onto the ramp, and rumbles
 *    over the ramp's rollers;
 *  - turned off the back by the deflector: the simulation slides it back
 *    across the belt and then along the bench; here it rides the slide's
 *    surface down (its height and tilt follow the slide under it);
 *  - popped out of the return chute: it comes out of the throat along the
 *    mouth's axis (stretched a little, a short arc) and catches up with
 *    the simulated pose in a few frames;
 *  - undone (a shipment taken back, or a ride undone mid-belt): the path it
 *    rode, recorded here while it rode, run backwards and quicker (out
 *    through the door first, which opens before it comes), then a short hop
 *    from where it was set on the line to where the undo put it.
 *
 * Everything is view-only and on the simulation clock; nothing here writes
 * the world. With reduced motion none of it runs: the parts are drawn where
 * the simulation says, and an undo is a cut.
 *
 * The line's views talk through one small bus per scene (`lineBus`): the
 * striker posts the hits its hammer lands, the chute its mouth, this view
 * the parts it is drawing elsewhere than the simulation says (so the dock's
 * curtain and rollers answer a part coming back out).
 */
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { Id, LampState, Location, Part, RampSpec, SimEvent, Vec3, WorldView } from '../../sim/index.ts';
import { rampAt, rampLength } from '../../sim/index.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { DEFLECT } from '../kit/pieces/belt/dims.ts';
import { partsHooks, unhook, type PartsOverlay } from './parts.ts';

// ───────────────────────── the bus and the lamp ─────────────────────────

/** A hit the striker's felt landed on a part: its id, when, and how hard (0..1). */
export interface LineHit {
  id: Id;
  at: number;
  strength: number;
}

/** A part drawn away from its simulated pose (an undo running backwards), as the dock sees it this frame. */
export interface LineDrawn {
  x: number;
  y: number;
  z: number;
  /** Its drawn velocity (world units/s). */
  vx: number;
  vy: number;
  vz: number;
}

export interface LineBus {
  /** Hits landed since the parts overlay last read them. */
  hits: LineHit[];
  /** Parts the overlay draws away from their simulated pose this frame. */
  readonly drawn: Map<Id, LineDrawn>;
  /** The chute's mouth (world): where it is, and its axis out of the throat (unit). Null until the chute view is made. */
  mouth: { p: Vector3; axis: Vector3 } | null;
}

const buses = new WeakMap<object, LineBus>();

/** The line's bus for this scene (one per scene; made on first use). */
export function lineBus(scene: object): LineBus {
  let b = buses.get(scene);
  if (!b) {
    b = { hits: [], drawn: new Map(), mouth: null };
    buses.set(scene, b);
  }
  return b;
}

/** Tune here: the station lamp's tell (§ B1: "blinks slowly as a tell"): period and the lit part of it (seconds). */
export const LAMP_BLINK = { period: 1.4, lit: 0.75 } as const;

/** A station lamp's lit half (`lamp.lit` shown) for its state at simulation time `t`: dark, steady, or a slow blink. */
export function lampOn(state: LampState, t: number): boolean {
  if (state === 'dark') return false;
  if (state === 'steady') return true;
  return ((t % LAMP_BLINK.period) + LAMP_BLINK.period) % LAMP_BLINK.period < LAMP_BLINK.lit;
}

/**
 * True for a restore this view draws (W3 brief: the undo's hops are drawn "everywhere it is not already
 * drawn by a station"): a part's location coming back from `shipped` or from riding the belt or the dock.
 */
export function lineOwnsRestore(r: { field: string; from: unknown }, mouths: readonly Id[] = ['belt', 'dock']): boolean {
  if (r.field !== 'location') return false;
  const f = r.from as Location | undefined;
  return !!f && (f.at === 'shipped' || (f.at === 'in' && mouths.includes(f.mouth)));
}

// ───────────────────────── the overlay ─────────────────────────

/** Tune here. Angles in degrees, rates in rad/s or 1/s, lengths in units, times in seconds. */
export const LINE_FEEL = {
  /** The squash when the felt lands: largest (fraction of height) at full strength; its spring. */
  squash: 0.075,
  squashOmega: 44,
  squashZeta: 0.32,
  /** The rock (a tip about the part's foot, across its travel): spring, and the kick at the belt-to-ramp hand-over per unit/s of speed. */
  rockOmega: 26,
  rockZeta: 0.3,
  handover: 55,
  /** The rumble over the ramp's rollers: tilt (deg) and lift (units) at full speed, along the roller pitch. */
  rumbleTilt: 0.5,
  rumbleLift: 0.004,
  rollerPitch: 0.22,
  /** The deflector's slide: the tilt follows the slope under the part through this spring. */
  slideOmega: 18,
  slideZeta: 0.55,
  /** Out of the chute: how deep in the throat it starts, how long it takes to come out, how much it is stretched. */
  popDepth: 0.55,
  popTime: 0.16,
  popStretch: 0.14,
  /** An undo run backwards: the ride's duration from its length (base + per unit, clamped), the hop after it. */
  rewindBase: 0.3,
  rewindPerUnit: 0.085,
  rewindMin: 0.45,
  rewindMax: 1.5,
  hopBase: 0.26,
  hopPerUnit: 0.05,
  hopMax: 0.5,
  hopLift: 0.35,
  /** A shipment undone waits for the door to be this open (or this long) before it comes out. */
  doorClear: 0.5,
  doorWait: 0.45,
  /** Path samples kept per part (decimated by half when full), and how often one is taken (simulation steps). */
  pathMax: 512,
  sampleEvery: 2,
} as const;

/** Where the line is (the bench's numbers: the simulation's `LINE`). */
export interface LineGeom {
  belt: { to: number; top: number; z: number };
  ramp: RampSpec;
  /** The door: its origin and the way in. */
  door: { origin: Vec3; inward: Vec3 };
}

const DEG = Math.PI / 180;
const STRIDE = 8; // t, x, y, z, qx, qy, qz, qw

interface Replay {
  /** Samples to play, first first (the latest pose first: the path reversed), and the cumulative length at each. */
  pts: Float32Array;
  cum: Float32Array;
  n: number;
  /** Seconds of the ride, and of the hop that follows (to the simulated pose). */
  ride: number;
  hop: number;
  /** When it starts (Infinity: waiting for the door). */
  t0: number;
  waitFrom: number;
  door: boolean;
}

interface Track {
  id: Id;
  /** The path it rode on the line (t, x, y, z, q), oldest first. */
  path: Float32Array;
  n: number;
  lastStep: number;
  /** Rock: degrees about the axis across its travel; and its axis (world, unit) and the last x it was seen at. */
  rock: number;
  rockV: number;
  ax: number;
  az: number;
  lastS: number;
  /** Squash (fraction) and rate. */
  sq: number;
  sqV: number;
  /** The slide's tilt (degrees, about +X: its top toward -Z). */
  tilt: number;
  tiltV: number;
  /** The slide's drop now (units, ≤ 0). */
  slide: number;
  /** Out of the chute: when, and the mouth's axis. */
  popAt: number;
  replay: Replay | null;
  /** Last drawn position (for the bus's velocity), and what it posts on the bus while it is drawn away. */
  dx: number;
  dy: number;
  dz: number;
  drawn: LineDrawn;
}

const mA = new Matrix4();
const mB = new Matrix4();
const mC = new Matrix4();
const vA = new Vector3();
const vB = new Vector3();
const qA = new Quaternion();
const qB = new Quaternion();
const one = new Vector3(1, 1, 1);

/** Half extent along world Y of a box of half extents `h` turned by `q`. */
function halfY(q: Quaternion, h: Vec3): number {
  const { x, y, z, w } = q;
  return Math.abs(2 * (x * y + w * z)) * h[0] + Math.abs(1 - 2 * (x * x + z * z)) * h[1] + Math.abs(2 * (y * z - w * x)) * h[2];
}

/** m = T(p) · R(axis, deg) · T(-p), into `out`. */
function rotateAbout(out: Matrix4, px: number, py: number, pz: number, axis: Vector3, deg: number): Matrix4 {
  mC.makeTranslation(-px, -py, -pz);
  out.makeRotationAxis(axis, deg * DEG).multiply(mC);
  mC.makeTranslation(px, py, pz);
  return out.premultiply(mC);
}

/** A stretch by `k` along the unit `a` about point p (world), into `out`. */
function stretchAbout(out: Matrix4, p: Vector3, a: Vector3, k: number): Matrix4 {
  const side = 1 / Math.sqrt(Math.max(0.2, k)); // keep the volume
  const t = side - 1;
  // M = side·I + (k - side)·a aᵀ
  const d = k - side;
  out.set(
    1 + t + d * a.x * a.x, d * a.x * a.y, d * a.x * a.z, 0,
    d * a.y * a.x, 1 + t + d * a.y * a.y, d * a.y * a.z, 0,
    d * a.z * a.x, d * a.z * a.y, 1 + t + d * a.z * a.z, 0,
    0, 0, 0, 1,
  );
  mC.makeTranslation(-p.x, -p.y, -p.z);
  out.multiply(mC);
  mC.makeTranslation(p.x, p.y, p.z);
  return out.premultiply(mC);
}

/** A damped spring, in place, in sub-steps. */
const S = { x: 0, v: 0 };
function spring(o: { x: number; v: number }, to: number, omega: number, zeta: number, dt: number): void {
  let left = dt;
  const k = omega * omega, c = 2 * zeta * omega;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    o.v += (k * (to - o.x) - c * o.v) * h;
    o.x += o.v * h;
    left -= h;
  }
}

export function createLinePartsView(geom: LineGeom): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = LINE_FEEL;
    const bus = lineBus(ctx.scene);
    const tracks = new Map<Id, Track>();
    const R = geom.ramp;
    const LEN = rampLength(R);
    // the ramp's centre line, sampled once: nearest-point lookups and headings without allocation
    const N = 64;
    const table = new Float32Array((N + 1) * 5); // x, y, z, hx, hz
    for (let i = 0; i <= N; i++) {
      const a = rampAt(R, (LEN * i) / N);
      table.set([a.p[0], a.p[1], a.p[2], a.hx, a.hz], i * 5);
    }
    /** Distance along the ramp of the centre-line point nearest (x, z), refined between samples; and the heading there into `head`. */
    const head = { hx: 1, hz: 0 };
    const nearest = (x: number, z: number): number => {
      let best = 0, bd = Infinity;
      for (let i = 0; i <= N; i++) {
        const dx = table[i * 5]! - x, dz = table[i * 5 + 2]! - z;
        const d = dx * dx + dz * dz;
        if (d < bd) [bd, best] = [d, i];
      }
      head.hx = table[best * 5 + 3]!;
      head.hz = table[best * 5 + 4]!;
      // project onto the heading for the part between samples
      const s = (LEN * best) / N + (x - table[best * 5]!) * head.hx + (z - table[best * 5 + 2]!) * head.hz;
      return Math.max(-1, Math.min(LEN + 1, s));
    };
    const slideTopZ = geom.belt.z + DEFLECT.slideTop[0], slideTopY = DEFLECT.slideTop[1];
    const slideFootZ = geom.belt.z + DEFLECT.slideFoot[0], slideFootY = DEFLECT.slideFoot[1];
    const slope = Math.atan2(slideTopY - slideFootY, slideTopZ - slideFootZ) / DEG;
    const X = new Vector3(1, 0, 0);
    const axis = new Vector3();

    const track = (id: Id): Track => {
      let t = tracks.get(id);
      if (!t) {
        t = { id, path: new Float32Array(F.pathMax * STRIDE), n: 0, lastStep: -1e9, rock: 0, rockV: 0, ax: 0, az: 1, lastS: -1e9, sq: 0, sqV: 0, tilt: 0, tiltV: 0, slide: 0, popAt: -Infinity, replay: null, dx: 0, dy: 0, dz: 0, drawn: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 } };
        tracks.set(id, t);
      }
      return t;
    };
    const record = (t: Track, w: WorldView, time: number): void => {
      if (w.step - t.lastStep < F.sampleEvery) return;
      const m = w.motion(t.id);
      if (!m) return;
      t.lastStep = w.step;
      if (t.n >= F.pathMax) {
        // full: keep every other sample (the whole path, at half the resolution)
        for (let i = 0; i < F.pathMax / 2; i++) t.path.copyWithin(i * STRIDE, i * 2 * STRIDE, i * 2 * STRIDE + STRIDE);
        t.n = F.pathMax / 2;
      }
      const o = t.n * STRIDE;
      const P = m.pose;
      t.path[o] = time;
      t.path[o + 1] = P.p[0];
      t.path[o + 2] = P.p[1];
      t.path[o + 3] = P.p[2];
      t.path[o + 4] = P.q[0];
      t.path[o + 5] = P.q[1];
      t.path[o + 6] = P.q[2];
      t.path[o + 7] = P.q[3];
      t.n++;
    };

    /** Start an undo's run backwards: the path reversed (or, with none recorded, from where it went out), then the hop. */
    const startReplay = (t: Track, from: Location, hopFrom: { p: Vec3; q: readonly number[] } | undefined, time: number, w: WorldView): void => {
      const n = t.n > 0 ? t.n : hopFrom ? 1 : 0;
      if (n === 0) return;
      const pts = new Float32Array(n * STRIDE);
      if (t.n > 0) for (let i = 0; i < n; i++) pts.set(t.path.subarray((t.n - 1 - i) * STRIDE, (t.n - i) * STRIDE), i * STRIDE);
      else if (hopFrom) pts.set([0, hopFrom.p[0], hopFrom.p[1], hopFrom.p[2], hopFrom.q[0]!, hopFrom.q[1]!, hopFrom.q[2]!, hopFrom.q[3]!]);
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        const a = (i - 1) * STRIDE, b = i * STRIDE;
        cum[i] = cum[i - 1]! + Math.hypot(pts[b + 1]! - pts[a + 1]!, pts[b + 2]! - pts[a + 2]!, pts[b + 3]! - pts[a + 3]!);
      }
      const len = cum[n - 1]!;
      const m = w.motion(t.id);
      const last = (n - 1) * STRIDE;
      const hopLen = m ? Math.hypot(m.pose.p[0] - pts[last + 1]!, m.pose.p[1] - pts[last + 2]!, m.pose.p[2] - pts[last + 3]!) : 0;
      const door = from.at === 'shipped';
      t.replay = {
        pts, cum, n,
        ride: len > 1e-3 ? Math.min(F.rewindMax, Math.max(F.rewindMin, F.rewindBase + F.rewindPerUnit * len)) : 0,
        hop: hopLen > 0.02 ? Math.min(F.hopMax, F.hopBase + F.hopPerUnit * hopLen) : 0,
        t0: door ? Infinity : time,
        waitFrom: time,
        door,
      };
      t.n = 0;
    };

    /** The pose an undo's replay draws now, into vA/qA; false when it is over. */
    const replayPose = (t: Track, r: Replay, time: number, w: WorldView, doorOpen: number): boolean => {
      if (r.t0 === Infinity) {
        if (doorOpen >= F.doorClear || time - r.waitFrom >= F.doorWait) r.t0 = time;
        else {
          const p = r.pts;
          vA.set(p[1]!, p[2]!, p[3]!);
          qA.set(p[4]!, p[5]!, p[6]!, p[7]!);
          return true;
        }
      }
      const a = time - r.t0;
      if (a >= r.ride + r.hop) return false;
      if (a < r.ride) {
        // along the path, backwards: eased in and out, so it gathers itself and lands soft at the far end
        const u = a / r.ride;
        const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        const goal = e * r.cum[r.n - 1]!;
        let i = 0;
        while (i < r.n - 2 && r.cum[i + 1]! < goal) i++;
        const seg = r.cum[i + 1]! - r.cum[i]!;
        const k = seg > 1e-6 ? Math.min(1, Math.max(0, (goal - r.cum[i]!) / seg)) : 0;
        const p = r.pts, A = i * STRIDE, B = Math.min(r.n - 1, i + 1) * STRIDE;
        vA.set(p[A + 1]!, p[A + 2]!, p[A + 3]!).lerp(vB.set(p[B + 1]!, p[B + 2]!, p[B + 3]!), k);
        qA.set(p[A + 4]!, p[A + 5]!, p[A + 6]!, p[A + 7]!).slerp(qB.set(p[B + 4]!, p[B + 5]!, p[B + 6]!, p[B + 7]!), k);
        return true;
      }
      // the hop: from where it was set on the line to where the undo put it, on a short arc
      const m = w.motion(t.id);
      if (!m) return false;
      const u = (a - r.ride) / r.hop;
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const L = (r.n - 1) * STRIDE, p = r.pts;
      vA.set(p[L + 1]!, p[L + 2]!, p[L + 3]!);
      vB.set(m.pose.p[0], m.pose.p[1], m.pose.p[2]);
      const d = vA.distanceTo(vB);
      vA.lerp(vB, e);
      vA.y += 4 * u * (1 - u) * F.hopLift * Math.min(1, 0.4 + d * 0.3);
      qA.set(p[L + 4]!, p[L + 5]!, p[L + 6]!, p[L + 7]!).slerp(qB.set(m.pose.q[0], m.pose.q[1], m.pose.q[2], m.pose.q[3]), e);
      return true;
    };

    const onEvent = (e: SimEvent, w: WorldView, time: number, reduced: boolean): void => {
      if (e.type === 'taken-in') {
        if (e.mouth === 'belt' || (e.mouth === 'dock' && (tracks.get(e.part)?.n ?? 0) === 0)) {
          const t = track(e.part);
          t.n = 0;
          t.lastStep = -1e9;
          t.replay = null;
        }
      } else if (e.type === 'restocked' || (e.type === 'returned' && e.how === 'chute')) {
        const t = tracks.get(e.part);
        if (t) t.n = 0;
      } else if (e.type === 'flap' && e.part && !reduced) {
        track(e.part).popAt = time;
      } else if (e.type === 'undone') {
        for (const r of e.restores) {
          if (!lineOwnsRestore(r)) continue;
          const t = track(r.target);
          if (reduced) {
            t.n = 0;
            t.replay = null;
            continue;
          }
          startReplay(t, r.from as Location, r.pose, time, w);
        }
      } else if (e.type === 'reset' || e.type === 'put-away') {
        for (const t of tracks.values()) if (e.type === 'reset' || t.id === e.id) {
          t.replay = null;
          t.n = 0;
        }
      } else if (e.type === 'part.grabbed') {
        const t = tracks.get(e.id);
        if (t) t.replay = null;
      }
    };

    // ── the overlay: the per-frame bookkeeping once, at the top of the parts view's frame; then each part ──
    let w: WorldView | null = null;
    let time = 0, dt = 0, reduced = false, doorOpen = 0;
    let riding: readonly Id[] = [];
    let shipping: readonly Id[] = [];
    const active = new Map<Id, Track>();
    const overlay: PartsOverlay = {
      begin(frame: Frame) {
        const world = frame.world;
        w = world;
        time = frame.time;
        dt = Math.min(frame.dt, 0.1);
        reduced = world.reducedMotion;
        for (const e of frame.events) onEvent(e, world, time, reduced);
        for (const h of bus.hits) {
          if (reduced) continue;
          const t = track(h.id);
          t.sqV = Math.max(t.sqV, h.strength * F.squash * F.squashOmega * 1.5);
        }
        bus.hits.length = 0;
        bus.drawn.clear();

        const belt = world.machine('belt');
        const dock = world.machine('dock');
        doorOpen = dock?.kind === 'dock' ? dock.door : 0;
        riding = belt?.kind === 'belt' ? belt.riding : [];
        shipping = dock?.kind === 'dock' ? dock.shipping : [];
        // what to look at this frame: the parts on the line, and any with something still playing
        active.clear();
        for (const id of riding) active.set(id, track(id));
        for (const id of shipping) active.set(id, track(id));
        for (const t of tracks.values()) {
          if (active.has(t.id)) continue;
          if (t.replay || time - t.popAt < F.popTime || Math.abs(t.sq) > 1e-4 || Math.abs(t.sqV) > 1e-3 || Math.abs(t.rock) > 0.02 || Math.abs(t.rockV) > 0.1 || Math.abs(t.tilt) > 0.05 || t.slide !== 0) active.set(t.id, t);
        }
        // the path each part rides on the line, for an undo to run backwards
        for (const t of active.values()) {
          const m = world.motion(t.id);
          if (m && m.mode === 'machine' && (riding.includes(t.id) || shipping.includes(t.id)) && !world.bracketed) record(t, world, time);
        }
      },
      pose(id: Id, _frame: Frame, drawn: Matrix4): boolean {
        const t = active.get(id);
        if (!t || !w) return false;
        const m = w.motion(t.id);
        const part: Part | undefined = w.part(t.id);
        if (!m || !part) return false;
        const onLine = m.mode === 'machine' && (riding.includes(t.id) || shipping.includes(t.id));

        // ── an undo running backwards: the drawn pose is the replay's ──
        if (t.replay) {
          if (m.held || !replayPose(t, t.replay, time, w, doorOpen)) t.replay = null;
          else {
            drawn.compose(vA, qA, one);
            const inv = dt > 1e-5 ? 1 / dt : 0;
            const d = t.drawn;
            d.vx = (vA.x - t.dx) * inv;
            d.vy = (vA.y - t.dy) * inv;
            d.vz = (vA.z - t.dz) * inv;
            d.x = vA.x;
            d.y = vA.y;
            d.z = vA.z;
            bus.drawn.set(t.id, d);
            t.dx = vA.x;
            t.dy = vA.y;
            t.dz = vA.z;
            return true;
          }
        }
        if (reduced) return false;

        const half = w.halfExtents(t.id) ?? [0.3, 0.3, 0.3];
        // the drawn centre (the parts view's), and the part's foot under it
        vB.setFromMatrixPosition(drawn);
        qB.set(m.pose.q[0], m.pose.q[1], m.pose.q[2], m.pose.q[3]);
        const hy = halfY(qB, half);
        t.dx = vB.x;
        t.dy = vB.y;
        t.dz = vB.z;

        // ── rock: the hand-over from the belt onto the ramp, and the rollers' rumble ──
        let rumble = 0, lift = 0;
        if (onLine) {
          const s = nearest(vB.x, vB.z);
          const onRamp = shipping.includes(t.id) || vB.x > geom.belt.to;
          if (onRamp) {
            t.ax = head.hz;
            t.az = -head.hx;
          } else {
            t.ax = 0;
            t.az = -1;
          }
          // the centre crosses the gap between the belt's bed and the ramp's first roller: the nose dips
          const gap = geom.belt.to + 0.06;
          if (t.lastS > -1e8 && (t.lastS - gap) * (vB.x - gap) < 0 && Math.abs(vB.z - geom.belt.z) < 0.3) {
            const speed = Math.abs(vB.x - t.lastS) / Math.max(dt, 1e-3);
            t.rockV += Math.sign(vB.x - t.lastS) * Math.min(3, speed) * F.handover;
          }
          const speed = t.lastS > -1e8 ? Math.hypot(vB.x - t.lastS, 0) / Math.max(dt, 1e-3) : 0;
          t.lastS = vB.x;
          if (onRamp && s > 0 && s < LEN) {
            // over each roller in turn: a tip and a lift, as strong as it is quick (still, it sits still)
            const ph = (s / F.rollerPitch) * Math.PI * 2;
            const k = Math.min(1, speed / 1.5);
            rumble = Math.sin(ph) * F.rumbleTilt * k;
            lift = (0.5 - 0.5 * Math.cos(ph * 2)) * F.rumbleLift * k;
          }
        } else t.lastS = -1e9;
        S.x = t.rock;
        S.v = t.rockV;
        spring(S, 0, F.rockOmega, F.rockZeta, dt);
        t.rock = S.x;
        t.rockV = S.v;
        if (Math.abs(t.rock) < 1e-3 && Math.abs(t.rockV) < 1e-2) t.rock = t.rockV = 0;

        // ── the deflector's slide: off the back, down the slide under it ──
        let slideDY = 0, tiltGoal = 0;
        const guided = m.mode === 'machine' && riding.includes(t.id) && vB.z < geom.belt.z - 0.03;
        if (guided) {
          const z = vB.z;
          const surf = z >= slideTopZ ? geom.belt.top : z <= slideFootZ ? 0 : slideFootY + ((z - slideFootZ) / (slideTopZ - slideFootZ)) * (slideTopY - slideFootY);
          // the footprint spans the slope's ends: tilt with how much of it is on the slope
          const over = Math.max(0, Math.min(1, (slideTopZ - (z - half[2])) / (2 * half[2]))) * Math.max(0, Math.min(1, (z + half[2] - slideFootZ) / (2 * half[2])));
          tiltGoal = -slope * Math.min(1, over * 1.6);
          slideDY = Math.min(0, surf + hy - vB.y);
        }
        // the drop follows quickly while it slides; set down somewhere higher than the bench (a part already on the
        // spot), it is lifted onto it over a few frames instead of in one
        t.slide += (slideDY - t.slide) * (1 - Math.exp(-(guided ? 60 : 16) * dt));
        if (!guided && Math.abs(t.slide) < 1e-4) t.slide = 0;
        slideDY = t.slide;
        S.x = t.tilt;
        S.v = t.tiltV;
        spring(S, tiltGoal, F.slideOmega, F.slideZeta, dt);
        t.tilt = S.x;
        t.tiltV = S.v;
        if (!guided && Math.abs(t.tilt) < 0.05 && Math.abs(t.tiltV) < 0.2) t.tilt = t.tiltV = 0;

        // ── the squash under the felt ──
        S.x = t.sq;
        S.v = t.sqV;
        spring(S, 0, F.squashOmega, F.squashZeta, dt);
        t.sq = Math.max(-F.squash * 0.6, Math.min(F.squash, S.x));
        t.sqV = S.v;
        if (Math.abs(t.sq) < 1e-4 && Math.abs(t.sqV) < 1e-3) t.sq = t.sqV = 0;

        // ── compose, in world space, about the foot: squash, rock, tilt; then the slide's drop and the rumble's lift ──
        const fx = vB.x, fy = vB.y - hy, fz = vB.z;
        mA.identity();
        if (t.sq !== 0) {
          mB.makeTranslation(-fx, -fy, -fz);
          mC.makeScale(1 + t.sq * 0.5, 1 - t.sq, 1 + t.sq * 0.5).multiply(mB);
          mB.makeTranslation(fx, fy, fz);
          mA.multiplyMatrices(mB, mC);
        }
        const rockDeg = t.rock + rumble;
        if (rockDeg !== 0) {
          axis.set(t.ax, 0, t.az).normalize();
          mA.premultiply(rotateAbout(mB, fx, fy, fz, axis, rockDeg));
        }
        if (t.tilt !== 0) mA.premultiply(rotateAbout(mB, fx, fy, fz, X, t.tilt));
        if (slideDY !== 0 || lift !== 0) mA.premultiply(mB.makeTranslation(0, slideDY + lift, 0));

        // ── out of the chute's throat ──
        const pa = time - t.popAt;
        if (pa >= 0 && pa < F.popTime && bus.mouth) {
          const u = pa / F.popTime;
          const back = (1 - u) ** 2 * F.popDepth;
          const a = bus.mouth.axis;
          mA.premultiply(stretchAbout(mB, vB, a, 1 + F.popStretch * (1 - u)));
          mA.premultiply(mB.makeTranslation(-a.x * back, -a.y * back, -a.z * back));
        }
        drawn.premultiply(mA);
        return true;
      },
    };
    const hooks = partsHooks(ctx.scene);
    hooks.overlays.push(overlay);

    const root = new Group(); // nothing of its own to draw: it works through the parts view's overlay
    root.name = 'line-parts';
    ctx.scene.add(root);
    return {
      root,
      update() {},
      dispose() {
        unhook(hooks.overlays, overlay);
        tracks.clear();
        active.clear();
        bus.drawn.clear();
        bus.hits.length = 0;
        root.removeFromParent();
      },
    };
  };
}
