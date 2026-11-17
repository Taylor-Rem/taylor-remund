/**
 * A deterministic stand-in for the physics engine, for exact tests
 * (REWRITE.md § E5 "What the tests hold": scripted rest events in place of
 * physics, so every test is exact and repeats identically).
 *
 * What it does: bodies sit where they are put. A dynamic body that is given
 * a velocity slides with it, losing a fixed fraction per step, and never
 * goes below the plane y = 0 (it stops with its lowest half extent on it);
 * when its speed is negligible it sleeps. Gravity pulls it down onto that
 * plane at a constant rate. There are no collisions. A test can script
 * where a body lands (`land`) and which contacts a step reports
 * (`contact`). Everything is plain arithmetic in a fixed order.
 */
import type { Id, Pose, Vec3 } from '../types.ts';
import type { BodyDesc, BodyKind, BodyState, Contact, PhysicsOptions, PhysicsPort, PhysicsSnapshot, SensorDesc, Shape } from './port.ts';
import { DT } from '../clock.ts';

interface StubBody {
  desc: BodyDesc;
  kind: BodyKind;
  pose: Pose;
  linvel: Vec3;
  angvel: Vec3;
  enabled: boolean;
  gravityScale: number;
  sleeping: boolean;
  /** Scripted landing: glide to `pose` over `steps` steps, then sleep there. */
  landing: { pose: Pose; steps: number; from: Pose; t: number } | null;
  /** Next kinematic pose. */
  drive: Pose | null;
}

interface StubSnapshot extends PhysicsSnapshot {
  readonly engine: 'stub';
  readonly bodies: ReadonlyMap<Id, StubBody>;
}

export interface StubPhysics extends PhysicsPort {
  /** The next time `id` is dynamic and moving, it glides to `pose` over `steps` steps and sleeps there. */
  land(id: Id, pose: Pose, steps?: number): void;
  /** Report this contact on the next step. */
  contact(c: Contact): void;
  /** Number of steps taken. */
  readonly steps: number;
}

/** Per-step velocity retention of a sliding body. */
const RETAIN = 0.8;
/** Below this speed a body stops and sleeps. */
const SLEEP_SPEED = 0.02;

const halfHeight = (s: Shape): number =>
  s.type === 'box' ? s.half[1] : Math.max(...s.parts.map((p) => p.at.p[1] + p.half[1]));

const clone = (b: StubBody): StubBody => ({ ...b, landing: b.landing ? { ...b.landing } : null });

export interface StubOptions extends Partial<PhysicsOptions> {
  /** Where the floor plane exists (the bench top). Outside it, bodies fall forever. Default: everywhere. */
  readonly footprint?: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
}

export function createStubPhysics(options: StubOptions = {}): StubPhysics {
  const fp = options.footprint;
  const onFloor = (p: Vec3): boolean => !fp || (p[0] >= fp.minX && p[0] <= fp.maxX && p[2] >= fp.minZ && p[2] <= fp.maxZ);
  let opts: PhysicsOptions = { gravity: options.gravity ?? -9.81, dt: options.dt ?? DT };
  let bodies = new Map<Id, StubBody>();
  const statics = new Set<Id>();
  const sensors = new Map<Id, SensorDesc>();
  let pendingContacts: Contact[] = [];
  const scriptedLandings = new Map<Id, { pose: Pose; steps: number }>();
  let stepCount = 0;

  function get(id: Id): StubBody {
    const b = bodies.get(id);
    if (!b) throw new Error(`stub physics: no body "${id}"`);
    return b;
  }
  const speed = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

  const port: StubPhysics = {
    engine: 'stub',
    dt: opts.dt,
    get steps() {
      return stepCount;
    },

    setGravity(y) {
      opts = { ...opts, gravity: y };
    },
    addBody(desc) {
      if (bodies.has(desc.id)) throw new Error(`stub physics: body "${desc.id}" exists`);
      bodies.set(desc.id, { desc, kind: desc.kind, pose: desc.pose, linvel: [0, 0, 0], angvel: [0, 0, 0], enabled: true, gravityScale: 1, sleeping: true, landing: null, drive: null });
    },
    removeBody(id) {
      get(id);
      bodies.delete(id);
    },
    hasBody: (id) => bodies.has(id),
    addStatic(d) {
      statics.add(d.id);
    },
    addSensor(d) {
      sensors.set(d.id, d);
    },
    setKind(id, kind) {
      const b = get(id);
      b.kind = kind;
      b.landing = null;
      if (kind === 'kinematic') {
        b.linvel = [0, 0, 0];
        b.angvel = [0, 0, 0];
      }
    },
    setEnabled(id, enabled) {
      get(id).enabled = enabled;
    },
    isEnabled: (id) => get(id).enabled,
    setGravityScale(id, s) {
      get(id).gravityScale = s;
    },
    setDamping() {},
    state(id): BodyState {
      const b = get(id);
      return { pose: b.pose, linvel: b.linvel, angvel: b.angvel, sleeping: b.sleeping };
    },
    pose: (id) => get(id).pose,
    setPose(id, p) {
      const b = get(id);
      b.pose = p;
      b.landing = null;
      b.sleeping = false;
    },
    setVelocity(id, linvel, angvel) {
      const b = get(id);
      b.linvel = linvel;
      if (angvel) b.angvel = angvel;
      b.sleeping = false;
    },
    applyImpulse(id, impulse) {
      const b = get(id);
      const m = b.desc.mass || 1;
      b.linvel = [b.linvel[0] + impulse[0] / m, b.linvel[1] + impulse[1] / m, b.linvel[2] + impulse[2] / m];
      b.sleeping = false;
    },
    driveKinematic(id, p) {
      get(id).drive = p;
    },
    wake(id) {
      get(id).sleeping = false;
    },
    sleep(id) {
      const b = get(id);
      b.sleeping = true;
      b.linvel = [0, 0, 0];
      b.angvel = [0, 0, 0];
    },
    sensorContents(id) {
      const s = sensors.get(id);
      if (!s) throw new Error(`stub physics: no sensor "${id}"`);
      const half = s.shape.type === 'box' ? s.shape.half : ([0, 0, 0] as Vec3);
      const out: Id[] = [];
      for (const [bid, b] of bodies) {
        if (!b.enabled || b.kind !== 'dynamic') continue;
        const d = [b.pose.p[0] - s.pose.p[0], b.pose.p[1] - s.pose.p[1], b.pose.p[2] - s.pose.p[2]];
        if (Math.abs(d[0] ?? 0) <= half[0] && Math.abs(d[1] ?? 0) <= half[1] && Math.abs(d[2] ?? 0) <= half[2]) out.push(bid);
      }
      return out.sort();
    },

    land(id, pose, steps = 30) {
      scriptedLandings.set(id, { pose, steps: Math.max(1, steps) });
    },
    contact(c) {
      pendingContacts.push(c);
    },

    step() {
      stepCount += 1;
      for (const [id, b] of bodies) {
        if (!b.enabled) continue;
        if (b.kind === 'kinematic') {
          if (b.drive) b.pose = b.drive;
          b.drive = null;
          continue;
        }
        if (b.gravityScale === 0) {
          // held: moves exactly with its velocity, no settling
          b.pose = { p: [b.pose.p[0] + b.linvel[0] * opts.dt, b.pose.p[1] + b.linvel[1] * opts.dt, b.pose.p[2] + b.linvel[2] * opts.dt], q: b.pose.q };
          continue;
        }
        if (b.sleeping) continue;
        const script = scriptedLandings.get(id);
        if (script && !b.landing) {
          b.landing = { pose: script.pose, steps: script.steps, from: b.pose, t: 0 };
          scriptedLandings.delete(id);
        }
        if (b.landing) {
          const l = b.landing;
          l.t += 1;
          const f = Math.min(1, l.t / l.steps);
          const p: Vec3 = [l.from.p[0] + (l.pose.p[0] - l.from.p[0]) * f, l.from.p[1] + (l.pose.p[1] - l.from.p[1]) * f, l.from.p[2] + (l.pose.p[2] - l.from.p[2]) * f];
          b.pose = { p, q: f >= 1 ? l.pose.q : l.from.q };
          b.linvel = f >= 1 ? [0, 0, 0] : [(l.pose.p[0] - l.from.p[0]) / l.steps / opts.dt, (l.pose.p[1] - l.from.p[1]) / l.steps / opts.dt, (l.pose.p[2] - l.from.p[2]) / l.steps / opts.dt];
          if (f >= 1) {
            b.landing = null;
            b.angvel = [0, 0, 0];
            b.sleeping = true;
          }
          continue;
        }
        const floor = halfHeight(b.desc.shape);
        const vy = b.linvel[1] + opts.gravity * b.gravityScale * opts.dt;
        let p: Vec3 = [b.pose.p[0] + b.linvel[0] * opts.dt, b.pose.p[1] + vy * opts.dt, b.pose.p[2] + b.linvel[2] * opts.dt];
        let lv: Vec3 = [b.linvel[0] * RETAIN, vy, b.linvel[2] * RETAIN];
        if (p[1] <= floor && b.pose.p[1] >= floor - 1e-9 && onFloor(p)) {
          p = [p[0], floor, p[2]];
          lv = [lv[0], 0, lv[2]];
        }
        b.pose = { p, q: b.pose.q };
        b.linvel = lv;
        b.angvel = [b.angvel[0] * RETAIN, b.angvel[1] * RETAIN, b.angvel[2] * RETAIN];
        if (p[1] === floor && speed(lv) < SLEEP_SPEED && speed(b.angvel) < SLEEP_SPEED) {
          b.linvel = [0, 0, 0];
          b.angvel = [0, 0, 0];
          b.sleeping = true;
        }
      }
      const out = pendingContacts;
      pendingContacts = [];
      return out;
    },

    snapshot(): StubSnapshot {
      return { engine: 'stub', bodies: new Map([...bodies].map(([k, b]) => [k, clone(b)])) };
    },
    restore(s) {
      if (s.engine !== 'stub') throw new Error(`stub physics: cannot restore a ${s.engine} snapshot`);
      bodies = new Map([...(s as StubSnapshot).bodies].map(([k, b]) => [k, clone(b)]));
    },
    bodies: () => [...bodies.keys()],
    dispose() {
      bodies.clear();
    },
  };
  return port;
}
