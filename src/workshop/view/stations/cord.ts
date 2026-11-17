/**
 * The switchboard slice and its cord (REWRITE.md § B2 X1, § D 4, § B1
 * "Lamps mean three things"; W4 brief § C).
 *
 *  - The board stands against the wall; each jack's lens lamp is lit exactly
 *    when the cord is in that jack (and not while it is lifted out).
 *  - The plug sits in its jack. Press-drag lifts it: the simulation tracks
 *    where the hand has it (`cord(id).plugAt`); here it follows, hanging
 *    plug-down and swinging a little with the hand's acceleration. Let go
 *    over a jack and it seats with a push (`cord.plugged`); anywhere else it
 *    goes home to the jack it came from.
 *  - The cord is a rope from the board's `cord.root` socket to the plug's
 *    `cord` socket that sags, swings and settles: a verlet chain integrated
 *    here on the simulation clock (it is transient: § E5), drawn as a tube
 *    whose vertices are rewritten in place each frame (one mesh, fixed
 *    topology; the switchboard piece's `cordGeometry` replaces the tube
 *    when it lands).
 *
 * Pieces by registry name: `switchboard` (sockets `jack.storefront`,
 * `jack.lamp`, `cord.root`; a lamp node per jack), `cord-plug` (socket
 * `cord`). Until they land: clay stand-ins of their size.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { Id, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { part, piece, place, T, Rdeg } from '../kit/compose.ts';
import { roundedBox, lathe, ellipsoid } from '../kit/solids.ts';
import { profile } from '../kit/profile.ts';
import { MeshData, finish } from '../kit/mesh.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import { clay, placedMatrix, splitStatic, type StaticPool } from './set.ts';

/** Tune here: lengths in units, rates in 1/s. */
export const CORD_FEEL = {
  /** Rope: points, radius, slack beyond the longest straight run it must make. */
  points: 26,
  radius: 0.032,
  sides: 8,
  slack: 0.75,
  /** Gravity on the rope (the world's is -16; a cloth cord reads heavier with a little less). */
  gravity: -13,
  /** Velocity kept per 1/120 s substep (air drag on cloth). */
  drag: 0.992,
  iterations: 14,
  /** The plug following the hand: a fast critically damped follower (rate). */
  follow: 28,
  /** How far the hand-held plug tilts with the hand's acceleration (radians per unit/s²), and its cap. */
  swing: 0.035,
  swingMax: 0.7,
  /** Seating: how far out the push starts, and the spring that drives it home (ω, ζ). */
  seatFrom: 0.16,
  seatOmega: 30,
  seatDamping: 0.45,
  /** Hover: the plug eases out a hair. */
  hoverOut: 0.035,
  /** How far proud of the jack face the seated plug's shoulder sits. */
  seatOut: 0.0,
};

export interface CordViewOptions {
  board: Entry | undefined;
  plug: Entry | undefined;
  /** The switchboard module (for `cordGeometry`, when it lands). */
  boardModule: Record<string, unknown> | null;
  fit: Fit;
  seed: number;
  /** Hand the board's cabinet to the set to be merged (the lamps and drawers stay here). */
  pool?: StaticPool;
}

/** The stand-in board: a clay cabinet with two brass jack rings and a lens lamp beside each (nodes `lamp.<jack>` with `on`/`off`). */
function standInBoard(fit: Fit): Piece {
  const { w, h, d } = { w: fit.board.bounds.max.x - fit.board.bounds.min.x, h: fit.board.bounds.max.y, d: fit.board.bounds.max.z - fit.board.bounds.min.z };
  const b = piece('stand-in-switchboard', { ao: false });
  const body = clay('board', w, h, d);
  b.add(place(body.root.parts, T(0, h / 2, 0)));
  const at = placedMatrix(fit.board.at).invert();
  for (const [name, p] of Object.entries(fit.board.jacks)) {
    const l = new Vector3(...p).applyMatrix4(at);
    const ring = lathe(profile(0.13, 0).to(0.13, 0.05, { fillet: 0.015 }).to(0.06, 0.07).to(0.045, 0.07).to(0.045, -0.02));
    b.add(place(part('brass', ring, 'brass'), new Matrix4().makeTranslation(l.x, l.y, l.z - 0.05).multiply(Rdeg(90, 0, 0))));
    const n = b.node(`lamp.${name}`, T(l.x + 0.3, l.y, l.z - 0.03));
    n.node('on').add(part('bulb', ellipsoid({ rx: 0.065, ry: 0.065, rz: 0.045 }), 'amber-glow'));
    n.node('off').add(part('glass', ellipsoid({ rx: 0.065, ry: 0.065, rz: 0.045 }), 'ink'));
  }
  return b.build();
}

/** The stand-in plug: tip at the origin pointing −Z (into a jack), body along +Z, the cord leaving its back (socket `cord`). */
function standInPlug(): Piece {
  const b = piece('stand-in-plug', { ao: false });
  const body = lathe(profile(0, 0.08).to(0.07, 0.08, { fillet: 0.02 }).to(0.075, 0.3, { fillet: 0.03 }).to(0.04, 0.36, { fillet: 0.02 }).to(0, 0.37));
  const tip = lathe(profile(0, -0.06).to(0.03, -0.06, { fillet: 0.01 }).to(0.035, 0.08).to(0.06, 0.08, { fillet: 0.01 }).to(0.06, 0.1).to(0, 0.1));
  b.add(place([part('paper', body, 'paper'), part('brass', tip, 'brass')], new Matrix4().makeTranslation(0, 0, 0.06).multiply(Rdeg(90, 0, 0))));
  b.socket('cord', T(0, 0, 0.43));
  return b.build();
}

/** A tube of fixed topology along `n` points (rings × sides), rewritten in place by `writeTube`. */
function tubePiece(n: number, sides: number, r: number): Piece {
  const md = new MeshData().withLpos();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const v = md.v(i * 0.1, Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a), Math.sin(a));
      // material space: along the cord (its braid runs along +X), round it
      md.setL(v, i * 0.1, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  const S = sides + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) md.quad(i * S + j, i * S + j + 1, (i + 1) * S + j + 1, (i + 1) * S + j);
  const g = finish(md, { wear: [0, 0] });
  const b = piece('cord', { ao: false });
  b.add(part('rubber', g, 'cable-red', { seed: 7, jitter: 0.02 }));
  return b.build();
}

const tN = new Vector3();
const tB = new Vector3();
const tT = new Vector3();
const tPrevN = new Vector3();

/** Write a tube through `pts` into the geometry made by `tubePiece` (parallel-transport frames). */
function writeTube(g: BufferGeometry, pts: readonly Vector3[], sides: number, r: number): void {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  const n = pts.length;
  const S = sides + 1;
  tPrevN.set(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    tT.subVectors(b, a).normalize();
    // parallel transport: the previous normal, made perpendicular to this tangent
    tN.copy(tPrevN).addScaledVector(tT, -tPrevN.dot(tT));
    if (tN.lengthSq() < 1e-8) tN.set(1, 0, 0).addScaledVector(tT, -tT.x);
    tN.normalize();
    tB.crossVectors(tT, tN);
    tPrevN.copy(tN);
    const p = pts[i]!;
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const nx = tN.x * c + tB.x * s, ny = tN.y * c + tB.y * s, nz = tN.z * c + tB.z * s;
      const k = i * S + j;
      pos.setXYZ(k, p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nrm.setXYZ(k, nx, ny, nz);
    }
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}

/** The rope: verlet points with pinned ends and their tangents. Pure maths (tested). */
export class Rope {
  readonly p: Vector3[];
  readonly q: Vector3[];
  readonly seg: number;
  constructor(a: Vector3, b: Vector3, n: number, length: number) {
    this.seg = length / (n - 1);
    this.p = [];
    this.q = [];
    // start as a hanging curve between the ends (a parabola that uses the length)
    const sag = Math.sqrt(Math.max(0, length * length - a.distanceToSquared(b))) * 0.5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const v = new Vector3().lerpVectors(a, b, t);
      v.y -= sag * 4 * t * (1 - t);
      this.p.push(v);
      this.q.push(v.clone());
    }
  }

  /**
   * Advance by dt. `a`, `b`: the pinned ends; `ta`, `tb`: unit directions the cord leaves each end along
   * (the second point from each end is held one segment out along it). `floor(v)` pushes a point out of solids.
   */
  step(dt: number, a: Vector3, ta: Vector3, b: Vector3, tb: Vector3, floor: (v: Vector3) => void): void {
    const F = CORD_FEEL;
    const n = this.p.length;
    if (!(dt > 0)) return; // no time, no motion (a still frame is a still frame)
    const sub = Math.max(1, Math.ceil(dt * 120));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        const p = this.p[i]!, q = this.q[i]!;
        const vx = (p.x - q.x) * F.drag, vy = (p.y - q.y) * F.drag, vz = (p.z - q.z) * F.drag;
        q.copy(p);
        p.x += vx;
        p.y += vy + F.gravity * h * h;
        p.z += vz;
      }
      for (let it = 0; it < F.iterations; it++) {
        this.p[0]!.copy(a);
        this.p[1]!.copy(a).addScaledVector(ta, this.seg);
        this.p[n - 1]!.copy(b);
        this.p[n - 2]!.copy(b).addScaledVector(tb, this.seg);
        for (let i = 0; i < n - 1; i++) {
          const p = this.p[i]!, r = this.p[i + 1]!;
          tT.subVectors(r, p);
          const d = tT.length() || 1e-6;
          const diff = (d - this.seg) / d;
          const wa = i <= 1 ? 0 : i >= n - 2 ? 1 : 0.5;
          const wb = i + 1 >= n - 2 ? 0 : i + 1 <= 1 ? 1 : 0.5;
          const sum = wa + wb || 1;
          p.addScaledVector(tT, (diff * wa) / sum);
          r.addScaledVector(tT, (-diff * wb) / sum);
        }
        for (let i = 2; i < n - 2; i++) floor(this.p[i]!);
      }
    }
  }
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);

export function createCordView(o: CordViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = CORD_FEEL;
    const root = new Group();
    root.name = 'cord';
    ctx.scene.add(root);
    const fit = o.fit;
    const boardM = placedMatrix(fit.board.at);

    // ── the board ──
    const boardWhole = o.board ? buildEntry(o.board, null, { seed: o.seed }, ctx.labels) : standInBoard(fit);
    const moving = (n: string): boolean => /^lamp[.-]|\.lamp$|^drawer|^on$|^off$/.test(n);
    const boardPiece = o.pool ? splitStatic(boardWhole, boardM, moving, o.pool) : boardWhole;
    const board = ctx.realize(boardPiece);
    board.applyMatrix4(boardM);
    root.add(board);

    // each jack's lamp: the real board lights its lens through `poseSwitchboard` (vertex colour);
    // the stand-in swaps a lit bulb for a dark lens
    type PoseBoard = (root: Object3D, pose: { lamps?: Record<string, number>; drawers?: Record<string, number> }) => void;
    const poseBoard = o.board ? ((o.boardModule?.['poseSwitchboard'] as PoseBoard | undefined) ?? null) : null;
    const BOARD = o.board ? (o.boardModule?.['BOARD'] as { w: number; shelfY: number; shelfZ: number; panelZ: number; top: number } | undefined) : undefined;
    const lampLevel: Record<string, number> = { storefront: -1, lamp: -1 };
    const lamps = new Map<Id, { on: Object3D[]; off: Object3D[] }>();
    const jackKey: Record<string, 'storefront' | 'lamp'> = { 'jack-storefront': 'storefront', 'jack-lamp': 'lamp' };
    for (const [id, key] of Object.entries(jackKey)) {
      if (poseBoard) continue;
      const node = board.getObjectByName(`lamp.${key}`) ?? board.getObjectByName(`lamp-${key}`) ?? board.getObjectByName(`${key}.lamp`);
      const on: Object3D[] = [];
      const off: Object3D[] = [];
      node?.traverse((m) => {
        const kind = (m as Mesh).userData?.['kitMaterial'];
        if (m.name === 'on' || kind === 'bulb') on.push(m);
        else if (m.name === 'off' || kind === 'glass') off.push(m);
      });
      lamps.set(id, { on, off });
    }

    // the jacks answer the pointer as themselves (a proxy box round each seat)
    const picking = (ctx as unknown as { picking?: { add(id: Id, o: Object3D, opts?: { box?: Box3; pad?: number }): void } }).picking;
    const jackAt = new Map<Id, Vector3>();
    for (const [id, key] of Object.entries(jackKey)) {
      const p = new Vector3(...fit.board.jacks[key]);
      jackAt.set(id, p);
      const g = new Group();
      g.name = `jack:${id}`;
      g.position.copy(p);
      root.add(g);
      const bx = new Box3(new Vector3(-0.17, -0.17, -0.08), new Vector3(0.17, 0.17, 0.12));
      if (picking) picking.add(id, g, { box: bx, pad: 0.02 });
      else ctx.pickable(id, g);
    }

    // ── the plug ──
    // seated convention (origin on the seating face, +Z back along the plug); the catalogue's entry shows it lying on the bench
    const cordPlug = o.boardModule?.['cordPlug'] as ((opts: { seed?: number; rest?: 'seat' | 'bench' }) => Piece) | undefined;
    const plugPiece = o.plug && cordPlug ? cordPlug({ seed: o.seed, rest: 'seat' }) : o.plug ? buildEntry(o.plug, null, { seed: o.seed, cord: false }, ctx.labels) : standInPlug();
    const plugInner = ctx.realize(plugPiece);
    const plug = new Group();
    plug.name = 'plug';
    plug.add(plugInner);
    root.add(plug);
    const cordSocket = plugPiece.sockets?.['cord'] ? new Vector3().setFromMatrixPosition(plugPiece.sockets['cord']) : new Vector3(0, 0, 0.43);
    if (picking) picking.add('cord', plug, { pad: 0.05 });
    else ctx.pickable('cord', plug);

    // ── the rope: the switchboard's braided cord when it is there, else a plain tube ──
    type CordGeometry = (pts: readonly (readonly [number, number, number])[]) => BufferGeometry;
    type UpdateCord = (g: BufferGeometry, pts: readonly (readonly [number, number, number])[]) => void;
    const cordGeometry = o.boardModule?.['cordGeometry'] as CordGeometry | undefined;
    const updateCord = o.boardModule?.['updateCord'] as UpdateCord | undefined;
    const braided = !!(cordGeometry && updateCord);
    let tube: Piece;
    if (braided) {
      const b = piece('cord', { ao: false });
      b.add({ material: 'rubber', geometry: cordGeometry!(Array.from({ length: F.points }, (_, i) => [i * 0.05, 0.5, 0] as const)) });
      tube = b.build();
    } else tube = tubePiece(F.points, F.sides, F.radius);
    const tubeObj = ctx.realize(tube);
    root.add(tubeObj);
    let tubeGeom: BufferGeometry | null = null;
    tubeObj.traverse((m) => {
      if ((m as Mesh).isMesh) {
        tubeGeom = (m as Mesh).geometry;
        m.frustumCulled = false;
      }
    });
    const rootAt = new Vector3(...fit.board.cordRoot);
    const far = Math.max(...[...jackAt.values()].map((j) => j.distanceTo(rootAt)));
    const startJack = jackAt.values().next().value ?? rootAt;
    const rope = new Rope(rootAt, startJack.clone().addScaledVector(AXIS_Z, cordSocket.z), F.points, far + F.slack);
    const boardFront = fit.board.at.z + fit.board.bounds.max.z;
    const boardTop = fit.board.bounds.max.y;
    const at = fit.board.at;
    const floor = (v: Vector3): void => {
      if (v.y < F.radius) v.y = F.radius;
      if (BOARD) {
        // the real board: the jack panel's face, and the keyshelf in front of it
        const lx = v.x - at.x, lz = v.z - at.z;
        if (Math.abs(lx) > BOARD.w / 2 || v.y > BOARD.top) return;
        if (lz < BOARD.shelfZ && v.y < BOARD.shelfY + F.radius) {
          if (BOARD.shelfZ - lz < BOARD.shelfY + F.radius - v.y) v.z = at.z + BOARD.shelfZ + F.radius;
          else v.y = BOARD.shelfY + F.radius;
        }
        if (lz < BOARD.panelZ + F.radius) v.z = at.z + BOARD.panelZ + F.radius;
        return;
      }
      // in front of the board's face, not inside the cabinet
      if (v.z < boardFront + F.radius && v.y < boardTop && v.x > fit.board.at.x + fit.board.bounds.min.x && v.x < fit.board.at.x + fit.board.bounds.max.x) v.z = boardFront + F.radius;
    };

    // plug state (view only)
    const pos = new Vector3().copy(startJack);
    const vel = new Vector3();
    const prevVel = new Vector3();
    const qSeated = new Quaternion(); // body along +Z
    const qHang = new Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2); // body along +Y, tip down
    const q = new Quaternion();
    const qSwing = new Quaternion();
    const qTilt = new Quaternion();
    let hang = 0; // 0 seated .. 1 hanging
    let seat = 0; // seat push offset along +Z
    let seatV = 0;
    let hover = 0;
    let swingX = 0, swingZ = 0;
    let first = true;
    const end = new Vector3();
    const tEnd = new Vector3();
    // the cord leaves the board straight: up out of the keyshelf's grommet (the real board), out of the face (the stand-in)
    const tRoot = o.board ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const ropePts: Array<[number, number, number]> = Array.from({ length: F.points }, () => [0, 0, 0]);
    const goal = new Vector3();

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const v = w.cord('cord');
        if (!v) return;
        const dt = Math.min(frame.dt, 0.05);
        for (const e of frame.events) {
          if (e.type === 'cord.plugged') {
            seat = F.seatFrom;
            seatV = 0;
          }
          if (e.type === 'cord.unplugged') hover = 0;
        }
        if (poseBoard) {
          // a lens comes up fast and dies a little slower (a filament)
          const want: Record<string, number> = {};
          let changed = false;
          for (const [id, key] of Object.entries(jackKey)) {
            const goalK = id === v.jack && !v.lifted ? 1 : 0;
            const cur = lampLevel[key]! < 0 ? goalK : lampLevel[key]!;
            const next = cur + (goalK - cur) * (1 - Math.exp(-(goalK > cur ? 30 : 12) * dt));
            const k = Math.abs(next - goalK) < 0.004 ? goalK : next;
            if (k !== lampLevel[key]) changed = true;
            lampLevel[key] = k;
            want[key] = k;
          }
          if (changed) poseBoard(board, { lamps: want });
        }
        for (const [id, l] of lamps) {
          const lit = id === v.jack && !v.lifted;
          for (const m of l.on) m.visible = lit;
          for (const m of l.off) m.visible = !lit;
        }
        // where the plug is heading
        if (v.lifted && v.plugAt) goal.set(v.plugAt[0], v.plugAt[1], v.plugAt[2]);
        else goal.copy(jackAt.get(v.jack) ?? startJack);
        if (first) {
          pos.copy(goal);
          first = false;
        }
        // follow: fast when in hand, a short glide home when dropped (the seat push covers the last bit)
        const k = 1 - Math.exp(-F.follow * dt);
        prevVel.copy(vel);
        vel.subVectors(goal, pos).multiplyScalar(k / Math.max(dt, 1e-4));
        pos.lerp(goal, k);
        // hanging plug-down while lifted; turned into the jack while seated
        const hangGoal = v.lifted ? 1 : 0;
        hang += (hangGoal - hang) * (1 - Math.exp(-14 * dt));
        // swing with the hand's acceleration (a pendulum's lag), eased
        const ax = (vel.x - prevVel.x) / Math.max(dt, 1e-4), az = (vel.z - prevVel.z) / Math.max(dt, 1e-4);
        const sx = v.lifted && !ctx.reducedMotion ? Math.max(-F.swingMax, Math.min(F.swingMax, ax * F.swing)) : 0;
        const sz = v.lifted && !ctx.reducedMotion ? Math.max(-F.swingMax, Math.min(F.swingMax, az * F.swing)) : 0;
        const ks = 1 - Math.exp(-9 * dt);
        swingX += (sx - swingX) * ks;
        swingZ += (sz - swingZ) * ks;
        // the seat push: a spring home from a little proud
        let left = dt;
        while (left > 1e-6) {
          const h = Math.min(left, 1 / 240);
          seatV += (-F.seatOmega * F.seatOmega * seat - 2 * F.seatDamping * F.seatOmega * seatV) * h;
          seat += seatV * h;
          left -= h;
        }
        const hovGoal = !v.lifted && frame.hovered === 'cord' && !w.bracketed ? F.hoverOut : 0;
        hover += (hovGoal - hover) * (1 - Math.exp(-30 * dt));

        q.copy(qSeated).slerp(qHang, hang);
        // tilt: lagging the hand (accelerating right swings the bottom left)
        qSwing.setFromAxisAngle(AXIS_Z, swingX).multiply(qTilt.setFromAxisAngle(AXIS_X, -swingZ));
        plug.quaternion.copy(qSwing).multiply(q);
        plug.position.copy(pos);
        if (!v.lifted) plug.position.z += (1 - hang) * (seat + hover + F.seatOut);

        // the rope: from the board's root to the plug's cord socket, leaving each straight
        end.copy(cordSocket).applyQuaternion(plug.quaternion).add(plug.position);
        tEnd.copy(cordSocket).normalize().applyQuaternion(plug.quaternion);
        rope.step(ctx.reducedMotion ? Math.min(dt, 1 / 60) : dt, rootAt, tRoot, end, tEnd, floor);
        if (tubeGeom) {
          if (braided) {
            for (let i = 0; i < F.points; i++) {
              const p = rope.p[i]!;
              const r = ropePts[i]!;
              r[0] = p.x;
              r[1] = p.y;
              r[2] = p.z;
            }
            updateCord!(tubeGeom, ropePts);
          } else writeTube(tubeGeom, rope.p, F.sides, F.radius);
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}
