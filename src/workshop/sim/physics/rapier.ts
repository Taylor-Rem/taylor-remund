/**
 * The physics adapter over Rapier (`@dimforge/rapier3d` 0.21.0, the plain
 * package). This is the only file in the project that imports Rapier
 * (check-layers enforces it), and it imports it lazily: the app calls
 * `createRapierPhysics()` after first paint (REWRITE.md § E6) and the
 * engine, with its 3 MB WebAssembly file, arrives then.
 *
 * Loading, as measured 2026-11-17:
 * - The package has no `main`/`exports`, only `module: rapier.js`, and its
 *   files import each other without extensions and import the `.wasm` as an
 *   ES module (wasm-bindgen's "bundler" target).
 * - Vite 8 (Rolldown) bundles that as is: the wasm becomes a separate
 *   hashed asset fetched when this chunk loads.
 * - Vitest (Node 22) resolves the bare package name through SSR rules that
 *   ignore `module`, so the import names the file: `@dimforge/rapier3d/rapier.js`.
 *   Node then instantiates the wasm through its ES-module integration (it
 *   prints an ExperimentalWarning once). Plain `node` without Vite cannot
 *   load the package at all (extensionless relative imports).
 * The same specifier therefore works in both, with no second dependency.
 */
import type * as RapierNS from '@dimforge/rapier3d/rapier.js';
import type { Id, Pose, Vec3 } from '../types.ts';
import type { BodyDesc, BodyKind, BodyState, Contact, PhysicsOptions, PhysicsPort, PhysicsSnapshot, SensorDesc, Shape, StaticDesc } from './port.ts';
import { DT } from '../clock.ts';

type R = typeof RapierNS;

/** Solver settings chosen for stable stacking of a few light boxes (see tests/scenario). */
export const RAPIER_TUNING = {
  solverIterations: 8,
  /** Contact force (units) below which Rapier reports nothing; impulse = force × dt. */
  contactForceThreshold: 0.5,
  /** Margin of the rounded box edges, as a fraction of the smallest half extent. */
  defaultRadiusFraction: 0.06,
} as const;

interface RapierSnapshot extends PhysicsSnapshot {
  readonly engine: 'rapier';
  readonly bytes: Uint8Array;
}

let loaded: Promise<R> | null = null;
/** Load the engine once (the wasm instantiates as the module evaluates). */
function loadRapier(): Promise<R> {
  loaded ??= import('@dimforge/rapier3d/rapier.js');
  return loaded;
}

export async function createRapierPhysics(options: Partial<PhysicsOptions> = {}): Promise<PhysicsPort> {
  const RAPIER = await loadRapier();
  return rapierPort(RAPIER, { gravity: options.gravity ?? -9.81, dt: options.dt ?? DT });
}

function rapierPort(RAPIER: R, opts: PhysicsOptions): PhysicsPort {
  const { World, EventQueue, RigidBodyDesc, ColliderDesc, ActiveEvents, RigidBodyType } = RAPIER;

  let gravity = opts.gravity;
  let world = new World({ x: 0, y: gravity, z: 0 });
  const configure = (): void => {
    world.gravity = { x: 0, y: gravity, z: 0 };
    world.timestep = opts.dt;
    world.integrationParameters.numSolverIterations = RAPIER_TUNING.solverIterations;
  };
  configure();
  const events = new EventQueue(true);

  /** id → rigid body handle (bodies and statics). Handles survive snapshot/restore. */
  const bodyHandle = new Map<Id, number>();
  const bodyOrder: Id[] = [];
  const statics = new Set<Id>();
  const sensors = new Map<Id, number>(); // id → collider handle
  /** collider handle → owner id */
  const owner = new Map<number, Id>();

  const toPose = (t: { x: number; y: number; z: number }, r: { x: number; y: number; z: number; w: number }): Pose => ({ p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] });
  const v = (a: Vec3) => ({ x: a[0], y: a[1], z: a[2] });
  const qv = (p: Pose) => ({ x: p.q[0], y: p.q[1], z: p.q[2], w: p.q[3] });

  function body(id: Id): RapierNS.RigidBody {
    const h = bodyHandle.get(id);
    if (h === undefined) throw new Error(`physics: no body "${id}"`);
    return world.getRigidBody(h);
  }

  function colliderDescs(shape: Shape): { desc: RapierNS.ColliderDesc; share?: number }[] {
    const box = (half: Vec3, radius: number | undefined, at?: Pose) => {
      const r = Math.min(radius ?? Math.min(half[0], half[1], half[2]) * RAPIER_TUNING.defaultRadiusFraction, Math.min(half[0], half[1], half[2]) * 0.5);
      const desc = r > 0 ? ColliderDesc.roundCuboid(half[0] - r, half[1] - r, half[2] - r, r) : ColliderDesc.cuboid(half[0], half[1], half[2]);
      if (at) desc.setTranslation(at.p[0], at.p[1], at.p[2]).setRotation(qv(at));
      return { desc };
    };
    if (shape.type === 'box') return [box(shape.half, shape.radius)];
    return shape.parts.map((p) => ({ ...box(p.half, p.radius, p.at), ...(p.share !== undefined ? { share: p.share } : {}) }));
  }

  const kindType = (k: BodyKind) => (k === 'dynamic' ? RigidBodyType.Dynamic : RigidBodyType.KinematicPositionBased);

  const port: PhysicsPort = {
    engine: 'rapier',
    dt: opts.dt,

    setGravity(y) {
      gravity = y;
      world.gravity = { x: 0, y, z: 0 };
    },

    addBody(d: BodyDesc) {
      if (bodyHandle.has(d.id)) throw new Error(`physics: body "${d.id}" exists`);
      const rb = world.createRigidBody(
        (d.kind === 'dynamic' ? RigidBodyDesc.dynamic() : RigidBodyDesc.kinematicPositionBased())
          .setTranslation(d.pose.p[0], d.pose.p[1], d.pose.p[2])
          .setRotation(qv(d.pose))
          .setLinearDamping(d.linearDamping ?? 0)
          .setAngularDamping(d.angularDamping ?? 0)
          .setCcdEnabled(d.ccd ?? false),
      );
      const descs = colliderDescs(d.shape);
      for (const { desc, share } of descs) {
        desc
          .setMass(share !== undefined ? d.mass * share : d.mass / descs.length)
          .setFriction(d.friction)
          .setRestitution(d.restitution)
          .setActiveEvents(ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(RAPIER_TUNING.contactForceThreshold);
        owner.set(world.createCollider(desc, rb).handle, d.id);
      }
      bodyHandle.set(d.id, rb.handle);
      bodyOrder.push(d.id);
    },

    removeBody(id) {
      const rb = body(id);
      for (let i = 0; i < rb.numColliders(); i++) owner.delete(rb.collider(i).handle);
      world.removeRigidBody(rb);
      bodyHandle.delete(id);
      bodyOrder.splice(bodyOrder.indexOf(id), 1);
    },

    hasBody: (id) => bodyHandle.has(id) && !statics.has(id),

    addStatic(d: StaticDesc) {
      if (bodyHandle.has(d.id)) throw new Error(`physics: static "${d.id}" exists`);
      const rb = world.createRigidBody(RigidBodyDesc.fixed().setTranslation(d.pose.p[0], d.pose.p[1], d.pose.p[2]).setRotation(qv(d.pose)));
      for (const { desc } of colliderDescs(d.shape)) {
        desc.setFriction(d.friction ?? 0.7).setRestitution(d.restitution ?? 0.1);
        owner.set(world.createCollider(desc, rb).handle, d.id);
      }
      bodyHandle.set(d.id, rb.handle);
      statics.add(d.id);
    },

    addSensor(d: SensorDesc) {
      if (sensors.has(d.id)) throw new Error(`physics: sensor "${d.id}" exists`);
      const rb = world.createRigidBody(RigidBodyDesc.fixed().setTranslation(d.pose.p[0], d.pose.p[1], d.pose.p[2]).setRotation(qv(d.pose)));
      const [first] = colliderDescs(d.shape);
      if (!first) throw new Error(`physics: sensor "${d.id}" has no shape`);
      const c = world.createCollider(first.desc.setSensor(true), rb);
      sensors.set(d.id, c.handle);
    },

    setKind(id, kind) {
      const rb = body(id);
      if (rb.bodyType() !== kindType(kind)) rb.setBodyType(kindType(kind), true);
    },
    setEnabled(id, enabled) {
      body(id).setEnabled(enabled);
    },
    isEnabled: (id) => body(id).isEnabled(),
    setGravityScale(id, s) {
      body(id).setGravityScale(s, true);
    },
    setDamping(id, linear, angular) {
      const rb = body(id);
      rb.setLinearDamping(linear);
      rb.setAngularDamping(angular);
    },
    touching(id) {
      const rb = body(id);
      const out: { other: Id; normal: Vec3 }[] = [];
      for (let i = 0; i < rb.numColliders(); i++) {
        const c = rb.collider(i);
        world.contactPairsWith(c, (o) => {
          const other = owner.get(o.handle);
          if (other === undefined || other === id) return;
          world.contactPair(c, o, (manifold, flipped) => {
            if (manifold.numContacts() === 0) return;
            // (the manifold's normal runs from its first shape to its second; `flipped`: its first shape is the other one)
            const n = manifold.normal();
            const k = flipped ? 1 : -1;
            out.push({ other, normal: [n.x * k, n.y * k, n.z * k] });
          });
        });
      }
      return out;
    },

    state(id): BodyState {
      const rb = body(id);
      const l = rb.linvel();
      const a = rb.angvel();
      return { pose: toPose(rb.translation(), rb.rotation()), linvel: [l.x, l.y, l.z], angvel: [a.x, a.y, a.z], sleeping: rb.isSleeping() };
    },
    pose(id) {
      const rb = body(id);
      return toPose(rb.translation(), rb.rotation());
    },
    setPose(id, p) {
      const rb = body(id);
      rb.setTranslation(v(p.p), true);
      rb.setRotation(qv(p), true);
    },
    setVelocity(id, linvel, angvel) {
      const rb = body(id);
      rb.setLinvel(v(linvel), true);
      if (angvel) rb.setAngvel(v(angvel), true);
    },
    applyImpulse(id, impulse, angular) {
      const rb = body(id);
      rb.applyImpulse(v(impulse), true);
      if (angular) rb.applyTorqueImpulse(v(angular), true);
    },
    driveKinematic(id, p) {
      const rb = body(id);
      rb.setNextKinematicTranslation(v(p.p));
      rb.setNextKinematicRotation(qv(p));
    },
    wake(id) {
      body(id).wakeUp();
    },
    sleep(id) {
      body(id).sleep();
    },

    sensorContents(id) {
      const h = sensors.get(id);
      if (h === undefined) throw new Error(`physics: no sensor "${id}"`);
      const out = new Set<Id>();
      world.intersectionPairsWith(world.getCollider(h), (other) => {
        const o = owner.get(other.handle);
        if (o !== undefined && !statics.has(o)) out.add(o);
      });
      return [...out].sort();
    },

    step() {
      world.step(events);
      const pairs = new Map<string, { a: Id; b: Id; impulse: number }>();
      events.drainContactForceEvents((e) => {
        const a = owner.get(e.collider1());
        const b = owner.get(e.collider2());
        if (a === undefined || b === undefined || a === b) return;
        const [x, y] = a < b ? [a, b] : [b, a];
        const key = `${x}|${y}`;
        const impulse = e.totalForceMagnitude() * opts.dt;
        const prev = pairs.get(key);
        if (prev) prev.impulse += impulse;
        else pairs.set(key, { a: x, b: y, impulse });
      });
      events.drainCollisionEvents(() => {});
      return [...pairs.values()].sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
    },

    snapshot(): RapierSnapshot {
      return { engine: 'rapier', bytes: world.takeSnapshot() };
    },
    restore(s) {
      if (s.engine !== 'rapier') throw new Error(`physics: cannot restore a ${s.engine} snapshot`);
      const next = World.restoreSnapshot((s as RapierSnapshot).bytes);
      if (!next) throw new Error('physics: snapshot did not deserialize');
      world.free();
      world = next;
      configure();
    },

    bodies: () => [...bodyOrder],
    dispose() {
      events.free();
      world.free();
    },
  };
  return port;
}
