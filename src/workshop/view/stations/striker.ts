/**
 * The striker, alive (brief W1; REWRITE.md § B2 X2 "the belt is a music
 * box", § D 6). The kit's `striker` piece (its mechanism is told in
 * `kit/pieces/striker/pose.ts`), its body merged into the set, its arm,
 * cam, follower, spring and lamp driven here from the simulation's
 * `StrikerView` and `struck` events:
 *
 *  - the cam winds as a riding part comes (`cock`, which the simulation
 *    advances at the belt's pace), so the follower lifts the arm and the
 *    overhead spring stretches: the anticipation;
 *  - on `struck` the cam turns past its step (quickly from wherever it
 *    was; from rest that is a wind-up and a let-go), the follower drops
 *    away and the arm FALLS, thrown by the spring: it is a body here, with
 *    a floor under it (the follower, the top of whatever stands under the
 *    hammer, the rubber stop) and a little bounce off it;
 *  - where the felt lands on a part it posts the hit on the line's bus
 *    (the parts overlay squashes the part), as strong as the arm was fast;
 *  - then the cam comes round (faster the faster the belt runs) and the
 *    spiral lifts the arm back to rest;
 *  - a misfire is a `struck` with no part: the same wind and let-go onto
 *    the stop, a clack;
 *  - the lamp: dark, steady while a part comes and just after, a slow
 *    blink as a tell.
 *
 * With reduced motion the arm sits on its floor (no bounce, no fall: a
 * cut) and the cam steps to where it is going.
 *
 * Nodes are posed without allocation (the piece's `poseStriker` makes a few
 * matrices per call; this mirrors its maths with scratch objects).
 */
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import { splitStatic, type StaticPool } from './set.ts';
import { armOnCam, camRadius, COCKED, DROPPED, HIDDEN, REST, springRestLength, strikeDeg, stopDeg, STRIKER } from '../kit/pieces/striker/pose.ts';
import { lampOn, lineBus } from './line.ts';

/** Tune here. Angles in degrees, cam in turns, times in seconds. */
export const STRIKER_FEEL = {
  /** The spring throws the arm down this hard (deg/s²): S from cocked in about 65 ms. */
  throw: 21000,
  /** What is left of its speed after it lands: on felt on a part, on the rubber stop. */
  bounce: 0.3,
  stopBounce: 0.36,
  /** Below this landing speed (deg/s) it just stays down. */
  rest: 40,
  /** The felt lands on a part at this speed (deg/s) for a full-strength hit. */
  fullHit: 1300,
  /** The cam: how fast it winds toward the cock (1/s), unwinds when nothing comes, snaps past its step (turns/s). */
  wind: 22,
  unwind: 5,
  snap: 5.5,
  /** Struck again while it is still low: thrown down from where it is at this speed (deg/s). */
  rethrow: 500,
  /** How fast it comes round after a strike: base plus per unit/s of belt speed (turns/s). */
  recover: 0.55,
  recoverPerSpeed: 0.95,
  /** The felt's reach round the hammer's axis (for finding what is under it), units. */
  felt: 0.07,
} as const;

export interface StrikerViewOptions {
  entry: Entry | undefined;
  /** Where the piece's origin stands (bench, y 0, no yaw). */
  at: readonly [number, number];
  seed: number;
  /** Hand the striker's body to the set (only the arm, cam, follower, spring and lamp stay here). */
  pool?: StaticPool;
  /** The machine's id (default 'striker') and the belt's (default 'belt'). */
  machine?: Id;
  belt?: Id;
}

const DEG = Math.PI / 180;
const MOVING = /^(arm|cam|follower|spring|lamp)$/;

interface Node {
  o: Object3D;
  p: Vector3;
  q: Quaternion;
}

const Yax = new Vector3(0, 1, 0);
const tq = new Quaternion();
const tv = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const e3 = new Vector3(1, 0, 0);
const mS = new Matrix4();
const mT = new Matrix4();

export function createStrikerView(o: StrikerViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = STRIKER_FEEL;
    const id = o.machine ?? 'striker';
    const beltId = o.belt ?? 'belt';
    const bus = lineBus(ctx.scene);
    const root = new Group();
    root.name = 'striker';
    root.position.set(o.at[0], 0, o.at[1]);
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => void root.removeFromParent() };
    const whole = buildEntry(o.entry, null, { seed: o.seed }, ctx.labels);
    const place = new Matrix4().makeTranslation(o.at[0], 0, o.at[1]);
    // the hammer's axis on the bench (world x, z), from its socket at rest
    const hammer = new Vector3();
    const sock = whole.sockets?.['hammer'];
    if (sock) hammer.setFromMatrixPosition(sock).applyMatrix4(place);
    const p = o.pool ? splitStatic(whole, place, (n) => MOVING.test(n), o.pool) : whole;
    const obj = ctx.realize(p);
    root.add(obj);

    const node = (name: string): Node | null => {
      const n = obj.getObjectByName(name);
      return n ? { o: n, p: n.position.clone(), q: n.quaternion.clone() } : null;
    };
    const arm = node('arm'), cam = node('cam'), follower = node('follower'), spring = obj.getObjectByName('spring') ?? null;
    const lit = obj.getObjectByName('lamp.lit') ?? null, unlit = obj.getObjectByName('lamp.unlit') ?? null;
    const restLen = springRestLength();
    const r0 = camRadius(REST.turns);
    const STOP = stopDeg();
    const boss = new Vector3(...STRIKER.boss);

    // the state: the cam's turns (continuous; the spiral repeats every turn), what it is doing, the arm as a body
    let c: number = REST.turns;
    let mode: 'wind' | 'drop' | 'recover' = 'wind';
    let camTo = 0;
    let th: number = REST.deg;
    let om = 0;
    let lastFloor: number = REST.deg;
    /** The part under the felt now (for the hit), and the last pose values drawn. */
    let under: Id | null = null;
    let drawn = { th: NaN, c: NaN, lamp: -1 };

    const floorNow = (w: Frame['world']): number => {
      // the follower holds it from below; a part under the hammer stops the felt at its top
      let f = armOnCam(c);
      under = null;
      const b = w.machine(beltId);
      if (b?.kind !== 'belt') return f;
      for (const pid of b.riding) {
        const m = w.motion(pid);
        const h = w.halfExtents(pid);
        if (!m || !h) continue;
        if (Math.abs(m.pose.p[0] - hammer.x) > h[0] + F.felt || Math.abs(m.pose.p[2] - hammer.z) > h[2] + F.felt) continue;
        const d = strikeDeg(m.pose.p[1] + h[1] - STRIKER.beltTop);
        if (d > f) {
          f = d;
          under = pid;
        }
      }
      return f;
    };

    const pose = (lampLit: boolean): void => {
      if (th !== drawn.th) {
        if (arm) arm.o.quaternion.copy(arm.q).multiply(tq.setFromAxisAngle(Yax, -(th - REST.deg) * DEG));
        if (spring) {
          // springMatrix(th, restLen) with scratch: from the boss, its +X down to the cup on the arm, stretched to reach it
          const a = th * DEG;
          const top = STRIKER.armHalf + 0.012;
          tv.set(STRIKER.pivot[0], STRIKER.pivot[1] + top * Math.cos(a) + STRIKER.springAt * Math.sin(a), STRIKER.pivot[2] - top * Math.sin(a) + STRIKER.springAt * Math.cos(a)).sub(boss);
          const len = tv.length();
          e1.copy(tv).multiplyScalar(1 / len);
          e2.crossVectors(e3, e1);
          mT.makeTranslation(boss.x, boss.y, boss.z).multiply(mS.makeBasis(e1, e2, e3)).multiply(mS.makeScale(len / restLen, 1, 1));
          mT.decompose(spring.position, spring.quaternion, spring.scale);
        }
        drawn.th = th;
      }
      if (c !== drawn.c) {
        if (cam) cam.o.quaternion.copy(cam.q).multiply(tq.setFromAxisAngle(Yax, -(c - REST.turns) * Math.PI * 2));
        if (follower) follower.o.position.copy(tv.set(camRadius(c) - r0, 0, 0).applyQuaternion(follower.q)).add(follower.p);
        drawn.c = c;
      }
      const l = lampLit ? 1 : 0;
      if (l !== drawn.lamp) {
        if (lit) lit.scale.setScalar(lampLit ? 1 : HIDDEN);
        if (unlit) unlit.scale.setScalar(lampLit ? HIDDEN : 1);
        drawn.lamp = l;
      }
    };
    pose(false);

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const m = w.machine(id);
        if (m?.kind !== 'striker') return;
        const dt = Math.min(frame.dt, 0.1);
        const reduced = w.reducedMotion;
        const b = w.machine(beltId);
        const speed = b?.kind === 'belt' ? Math.abs(b.surface) : 0;
        for (const e of frame.events) {
          if (e.type !== 'struck' || e.id !== id) continue;
          // the next step at or after where the cam is; if that is most of a turn away (it has only just let go, a
          // quick run of parts), the arm is already low: it is thrown again from where it is
          const next = Math.floor(c - DROPPED) + 1 + DROPPED;
          if (next - c < 0.6) {
            mode = 'drop';
            camTo = next;
          } else if (!reduced) om = Math.min(om, -F.rethrow);
        }

        // ── the cam ──
        if (mode === 'drop') {
          c = reduced ? camTo : Math.min(camTo, c + F.snap * dt);
          if (c >= camTo) {
            mode = 'recover';
            camTo = Math.floor(c) + 1 + REST.turns; // round the base circle and up the spiral to rest
          }
        } else if (mode === 'recover') {
          c = reduced ? camTo : Math.min(camTo, c + (F.recover + F.recoverPerSpeed * speed) * dt);
          if (c >= camTo) mode = 'wind';
        } else {
          const base = Math.floor(c - REST.turns + 1e-9) + REST.turns;
          const goal = base + (COCKED.turns - REST.turns) * m.cock;
          if (reduced) c = goal;
          else c += (goal - c) * (1 - Math.exp(-(goal > c ? F.wind : F.unwind) * dt));
        }
        // keep the number small (the drawing only needs it mod 1)
        if (c > 8) {
          c -= 8;
          camTo -= 8;
        }

        // ── the arm: a body on its floor ──
        const floor = floorNow(w);
        const fRate = dt > 1e-5 ? (floor - lastFloor) / dt : 0;
        lastFloor = floor;
        if (reduced) {
          th = floor;
          om = 0;
        } else {
          let left = dt;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 480);
            om -= F.throw * h;
            th += om * h;
            if (th <= floor) {
              const vi = Math.max(0, fRate) - om; // closing speed
              th = floor;
              if (vi > F.rest) {
                const onPart = under !== null && floor > STOP + 0.5 && floor > armOnCam(c) + 0.01;
                if (onPart && under) bus.hits.push({ id: under, at: frame.time, strength: Math.min(1, vi / F.fullHit) });
                om = Math.max(0, fRate) + vi * (onPart ? F.bounce : floor <= STOP + 0.01 ? F.stopBounce : 0.12);
              } else om = Math.max(0, fRate);
            }
            left -= h;
          }
        }
        pose(lampOn(m.lamp, frame.time));
      },
      dispose() {
        root.removeFromParent();
        drawn = { th: NaN, c: NaN, lamp: -1 };
      },
    };
  };
}
