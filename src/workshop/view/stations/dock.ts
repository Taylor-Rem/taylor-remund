/**
 * The dock, alive (brief W1; REWRITE.md § B1 "the dock: ships it: out, with
 * a bell", § D 7, § B2 X3). The kit's `dock` piece (its ramp fitted to the
 * belt's end), its body merged into the set; its shutter, rollers, curtain,
 * bell and lamp driven here from the simulation's `DockView` and events:
 *
 *  - the shutter follows `DockView.door` through a stiff spring: it runs up
 *    a hair past open and settles, and coming down it bumps on the sill
 *    and settles (a misfire's jump open and shut is the same motion);
 *  - each roller of the ramp spins up under a part riding over it (as fast
 *    as the part goes, either way) and coasts down after it has gone;
 *  - the strip curtain in the bay is pushed the way the part goes through
 *    it (in when shipping, out when an undo brings it back) and swings and
 *    settles when it has gone through;
 *  - the bell swings on `shipped` and rings down slowly, its clapper lagging
 *    and knocking the rim; the shutter landing on the sill jostles it;
 *  - the lamp: steady while it ships, a slow blink as a tell, else dark.
 *
 * A part coming back out (an undo) is drawn by the line's parts overlay
 * (`stations/line.ts`), which posts where it draws it on the line's bus:
 * the curtain and the rollers answer it from there.
 *
 * With reduced motion the shutter follows the simulation exactly and
 * nothing swings or spins.
 */
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { dock as dockPiece, DOCK, DOOR_TRAVEL, HIDDEN, LIP_Y, rampAt, rampGeom, rampRollers, slats } from '../kit/pieces/dock/index.ts';
import { splitStatic, type StaticPool } from './set.ts';
import { lampOn, lineBus } from './line.ts';

/** Tune here. Angles in degrees, rates in rad/s, times in seconds. */
export const DOCK_FEEL = {
  /** The shutter's spring (on the door's 0..1), and what is left of its speed when it lands on the sill. */
  doorOmega: 24,
  doorZeta: 0.42,
  sillBounce: 0.3,
  /** The rollers: how fast they take up a part's speed, and coast down after it (1/s). */
  rollerGrip: 30,
  rollerCoast: 1.6,
  /** The curtain: the most it is pushed, how deep it is pushed by a part's depth into it, and its swing. */
  flapMax: 48,
  flapOmega: 8.5,
  flapZeta: 0.16,
  /** The bell: its swing (rad/s), the kick a shipment gives it (deg/s), and the shutter's jostle per unit of landing speed. */
  bellOmega: 11.5,
  bellZeta: 0.065,
  bellKick: 260,
  bellJostle: 40,
  /** The clapper: its own pendulum, and the rim it knocks against (deg either side of the bell). */
  clapOmega: 15,
  clapZeta: 0.12,
  clapRim: 16,
  clapBounce: 0.55,
} as const;

export interface DockViewOptions {
  /** Where the piece's origin (the door's middle on the bench) stands. */
  at: readonly [number, number];
  /** The ramp's start from the door's origin (the belt's bed end plus its gap). */
  reach: readonly [number, number];
  seed: number;
  pool?: StaticPool;
  /** The machine's id (default 'dock'). */
  machine?: Id;
}

const DEG = Math.PI / 180;
const MOVING = /^(door\.\d+|bell|flap|lamp|ramp\.roller\d+)$/;

interface Node {
  o: Object3D;
  p: Vector3;
  q: Quaternion;
  s: Vector3;
}

const tq = new Quaternion();
const tv = new Vector3();
const AX_X = new Vector3(1, 0, 0);
const AX_Y = new Vector3(0, 1, 0);
const AX_Z = new Vector3(0, 0, 1);

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

export function createDockView(o: DockViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = DOCK_FEEL;
    const id = o.machine ?? 'dock';
    const bus = lineBus(ctx.scene);
    const root = new Group();
    root.name = 'dock';
    root.position.set(o.at[0], 0, o.at[1]);
    ctx.scene.add(root);
    const whole = dockPiece({ seed: o.seed, reach: o.reach });
    const place = new Matrix4().makeTranslation(o.at[0], 0, o.at[1]);
    const p = o.pool ? splitStatic(whole, place, (n) => MOVING.test(n), o.pool) : whole;
    const obj = ctx.realize(p);
    root.add(obj);

    const node = (name: string): Node | null => {
      const n = obj.getObjectByName(name);
      return n ? { o: n, p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() } : null;
    };
    const slatInfo = slats();
    const slatNodes = slatInfo.map((s) => node(s.name));
    const bell = node('bell'), clapper = node('bell.clapper'), flap = node('flap');
    const lit = obj.getObjectByName('lamp.lit') ?? null, unlit = obj.getObjectByName('lamp.unlit') ?? null;

    // the ramp in world space: each roller's distance along it, a table of the centre line for nearest lookups
    const g = rampGeom(DOCK.turn, o.reach);
    const rollerS = rampRollers(g);
    const rollers = rollerS.map((_, i) => node(`ramp.roller${i}`));
    const rollerAng = new Float64Array(rollerS.length);
    const rollerW = new Float64Array(rollerS.length);
    const rollerGoal = new Float64Array(rollerS.length);
    const N = 64;
    const table = new Float32Array((N + 1) * 2);
    for (let i = 0; i <= N; i++) {
      const a = rampAt(g, (g.length * i) / N);
      table[i * 2] = a.x + o.at[0];
      table[i * 2 + 1] = a.z + o.at[1];
    }
    const along = (x: number, z: number): number => {
      let best = 0, bd = Infinity;
      for (let i = 0; i <= N; i++) {
        const dx = table[i * 2]! - x, dz = table[i * 2 + 1]! - z;
        const d = dx * dx + dz * dz;
        if (d < bd) [bd, best] = [d, i];
      }
      return (g.length * best) / N;
    };
    // the door: its outward normal (the bay's +Z), and the curtain's depth inside it
    const turn = (90 - DOCK.turn) * DEG;
    const outward = new Vector3(-Math.sin(turn), 0, Math.cos(turn));
    const doorAt = new Vector3(o.at[0], 0, o.at[1]);
    const curtainDepth = flap ? -flap.p.z : 0.3;

    const door = { x: 0, v: 0 };
    const bellS = { x: 0, v: 0 };
    const clap = { x: 0, v: 0 }; // absolute angle (deg), about the bell's hanger
    const flapS = { x: 0, v: 0 };
    /** Each part's last distance along the ramp and depth through the door (for its speed and its way). */
    const seen = new Map<Id, { s: number; d: number; step: number }>();
    let drawn = { door: NaN, lamp: -1 };

    /** Pose the slats for opening `x` (poseDock's slatMatrix, without allocation). */
    const poseDoor = (x: number): void => {
      const rise = Math.max(0, Math.min(1.05, x)) * DOOR_TRAVEL;
      for (let i = 0; i < slatInfo.length; i++) {
        const n = slatNodes[i];
        if (!n) continue;
        const s = slatInfo[i]!;
        const inside = s.y0 + rise >= LIP_Y - 0.004;
        tv.set(0, inside ? LIP_Y + 0.12 - s.y0 : rise, 0).multiply(n.s).applyQuaternion(n.q);
        n.o.position.copy(n.p).add(tv);
        n.o.scale.copy(n.s).multiplyScalar(inside ? HIDDEN : 1);
      }
    };
    const turnNode = (n: Node | null, axis: Vector3, rad: number): void => {
      if (n) n.o.quaternion.copy(n.q).multiply(tq.setFromAxisAngle(axis, rad));
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const m = w.machine(id);
        if (m?.kind !== 'dock') return;
        const dt = Math.min(frame.dt, 0.1);
        const reduced = w.reducedMotion;
        for (const e of frame.events) {
          if (e.type === 'shipped' && e.id === id && !reduced) bellS.v += F.bellKick;
        }

        // ── the shutter ──
        if (reduced) {
          door.x = m.door;
          door.v = 0;
        } else {
          let left = dt;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            spring(door, m.door, F.doorOmega, F.doorZeta, h);
            if (door.x < 0) {
              // on the sill: it bumps and settles; the bell feels it
              if (door.v < -0.4) bellS.v += F.bellJostle * -door.v;
              door.x = -door.x * F.sillBounce;
              door.v = -door.v * F.sillBounce;
            }
            left -= h;
          }
          if (Math.abs(door.x - m.door) < 1e-4 && Math.abs(door.v) < 1e-3) {
            door.x = m.door;
            door.v = 0;
          }
        }
        if (door.x !== drawn.door) {
          poseDoor(door.x);
          drawn.door = door.x;
        }

        // ── the parts on the ramp and through the door: rollers and curtain ──
        rollerGoal.fill(0);
        let push = 0;
        const feel = (pid: Id, x: number, z: number, r: number, vS: number | null, vD: number | null): void => {
          const s = along(x, z);
          const d = (doorAt.x - x) * outward.x + (doorAt.z - z) * outward.z; // depth through the door (in is +)
          const prev = seen.get(pid);
          const inv = dt > 1e-5 ? 1 / dt : 0;
          const speed = vS ?? (prev ? (s - prev.s) * inv : 0);
          const dSpeed = vD ?? (prev ? (d - prev.d) * inv : 0);
          if (prev) {
            prev.s = s;
            prev.d = d;
            prev.step = w.step;
          } else seen.set(pid, { s, d, step: w.step });
          if (d < 0.05) for (let i = 0; i < rollerS.length; i++) if (Math.abs(rollerS[i]! - s) < r) rollerGoal[i] = speed / DOCK.rollerR;
          // the curtain: pushed the way the part goes, by as much of it as is through the strips' plane
          const over = Math.min(d + r - curtainDepth, curtainDepth - (d - r));
          if (over > 0 && Math.abs(dSpeed) > 0.05) push = Math.sign(dSpeed) * Math.min(1, over / 0.25);
        };
        for (const pid of m.shipping) {
          const mo = w.motion(pid);
          const h = w.halfExtents(pid);
          if (mo && h) feel(pid, mo.pose.p[0], mo.pose.p[2], Math.max(h[0], h[2]), null, null);
        }
        for (const [pid, d] of bus.drawn) {
          const h = w.halfExtents(pid) ?? [0.3, 0.3, 0.3];
          feel(pid, d.x, d.z, Math.max(h[0], h[2]), null, -(d.vx * outward.x + d.vz * outward.z));
        }
        for (const [pid, sn] of seen) if (w.step - sn.step > 30) seen.delete(pid);

        if (!reduced) {
          for (let i = 0; i < rollerS.length; i++) {
            const goal = rollerGoal[i]!;
            const k = 1 - Math.exp(-(goal !== 0 ? F.rollerGrip : F.rollerCoast) * dt);
            rollerW[i]! += (goal - rollerW[i]!) * k;
            if (Math.abs(rollerW[i]!) < 0.01 && goal === 0) rollerW[i] = 0;
            if (rollerW[i] !== 0) {
              rollerAng[i]! += rollerW[i]! * dt;
              turnNode(rollers[i]!, AX_Y, rollerAng[i]!);
            }
          }
          // ── the curtain ──
          spring(flapS, push * F.flapMax, F.flapOmega, push !== 0 ? 1 : F.flapZeta, dt);
          turnNode(flap, AX_X, flapS.x * DEG);
          // ── the bell, and its clapper knocking the rim ──
          spring(bellS, 0, F.bellOmega, F.bellZeta, dt);
          spring(clap, bellS.x, F.clapOmega, F.clapZeta, dt);
          const rel = clap.x - bellS.x;
          if (Math.abs(rel) > F.clapRim) {
            clap.x = bellS.x + Math.sign(rel) * F.clapRim;
            const rv = clap.v - bellS.v;
            if (rv * rel > 0) clap.v = bellS.v - rv * F.clapBounce;
          }
          if (Math.abs(bellS.x) < 0.02 && Math.abs(bellS.v) < 0.05 && Math.abs(clap.x) < 0.02 && Math.abs(clap.v) < 0.05) bellS.x = bellS.v = clap.x = clap.v = 0;
          turnNode(bell, AX_Z, bellS.x * DEG);
          turnNode(clapper, AX_Z, (clap.x - bellS.x) * DEG);
        }

        // ── the lamp ──
        const on = lampOn(m.lamp, frame.time) ? 1 : 0;
        if (on !== drawn.lamp) {
          if (lit) lit.scale.setScalar(on ? 1 : HIDDEN);
          if (unlit) unlit.scale.setScalar(on ? HIDDEN : 1);
          drawn.lamp = on;
        }
      },
      dispose() {
        root.removeFromParent();
        seen.clear();
        drawn = { door: NaN, lamp: -1 };
      },
    };
  };
}
