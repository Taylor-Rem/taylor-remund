/**
 * The whole switchboard and its cord, alive (W2 part 1; REWRITE.md § B2 X1,
 * § D 4 as amended 2026-11-18, § B1 "Lamps mean three things").
 *
 *  - Six jacks: four live lines and two capped with RESERVED tape. The plug
 *    seats in any live one with a push and a click (`cord.plugged`); pushed
 *    at a capped one it is refused with a little bounce (the slip the
 *    simulation prints, `slip.reserved`), then goes home.
 *  - Lifted, the plug is HELD the way a hand holds it: nose toward the
 *    board and a little down, its cord trailing from the boot, tilting with
 *    the hand's acceleration. It hangs only on its way home after being let
 *    go away from a jack.
 *  - While it is held the live jacks offer themselves (`LineView.offering`):
 *    their collars lift and breathe, the nearest one to the plug standing
 *    tallest; their lenses glow, breathing.
 *  - Each lens: lit while the cord is in its jack; a call waiting on it
 *    (`LineView.ringing`) blinks it until Patch has it in hand.
 *  - The drawers are Patch's: the operator view poses them (patchlamp-bus).
 *  - A Button misfire: the plug jumps in its jack and reseats.
 *
 * The cord is P1's rope (stations/cord.ts `Rope`) drawn with the
 * switchboard's braided geometry, kept off the board's face and keyshelf.
 */
import { Box3, Group, Quaternion, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { Id, LineView, PatchView, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { piece } from '../kit/compose.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import { placedMatrix, splitStatic, type StaticPool } from './set.ts';
import { CORD_FEEL, Rope } from './cord.ts';
import { JACKS, BOARD_WHOLE, cordPlug, cordGeometry, updateCord, poseSwitchboard, type JackName, type SwitchboardPose } from '../kit/pieces/switchboard/index.ts';
import { damp, inOutCubic, outCubic } from '../anim/index.ts';
import { patchlampBus, jackName } from './patchlamp-bus.ts';
import { lampOn } from './line.ts';
import { TELL_SECONDS } from '../../sim/index.ts';

/** Tune here: units, seconds, rates in 1/s. */
export const BOARD_FEEL = {
  /** The held plug: its nose down from level (radians), and how far it turns toward the jack nearest it. */
  heldPitch: -0.5,
  heldYawMax: 0.5,
  /** How fast the plug follows the hand, and goes home when let go. */
  follow: 26,
  home: 9,
  /** Acceleration tilt (radians per unit/s²), its cap, and its ease rate. */
  swing: 0.03,
  swingMax: 0.55,
  swingRate: 9,
  /** The seat: how far proud the push starts, and its spring (ω, ζ): a push and a click. */
  seatFrom: 0.14,
  seatOmega: 34,
  seatDamping: 0.42,
  /** The capped jack's refusal: how far the plug goes in, and how long the bounce takes. */
  refuseIn: 0.06,
  refuseTime: 0.42,
  /** Offering: collar lift for an offered jack, the nearest one, the breath's depth and period. */
  offer: 0.62,
  offerNear: 1,
  breath: 0.22,
  breathPeriod: 1.3,
  /** The nearest jack counts as nearest within this distance of the plug. */
  nearWithin: 1.6,
  /** A call waiting: the lens blinks at this period, lit this share of it. */
  ringPeriod: 0.7,
  ringDuty: 0.55,
  /** Hover: the seated plug eases out a hair; a jack's collar stirs. */
  hoverOut: 0.035,
  hoverCollar: 0.28,
  /** A misfire's jump (units at level 1). */
  misfireJump: 0.07,
};

export interface SwitchboardViewOptions {
  board: Entry | undefined;
  fit: Fit;
  seed: number;
  pool?: StaticPool;
  /** The bench kit (the key the station views share their bus by). */
  key: object;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

export function createSwitchboardView(o: SwitchboardViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = BOARD_FEEL;
    const C = CORD_FEEL;
    const bus = patchlampBus(o.key);
    const root = new Group();
    root.name = 'switchboard';
    ctx.scene.add(root);
    const fit = o.fit;
    const boardM = placedMatrix(fit.board.at);

    // ── the board: the cabinet merged into the set; lamps, collars and drawers live ──
    const whole: Piece = o.board ? buildEntry(o.board, null, { seed: o.seed, jacks: JACKS }, ctx.labels) : piece('no-board').build();
    const moving = (n: string): boolean => /^lamp\.|^drawer\.|^collar\./.test(n);
    const live = o.pool ? splitStatic(whole, boardM, moving, o.pool) : whole;
    const board = ctx.realize(live);
    board.applyMatrix4(boardM);
    root.add(board);
    bus.board = board;
    const litNode: Partial<Record<JackName, Object3D>> = {};
    for (const j of JACKS) {
      const n = board.getObjectByName(`lamp.${j}.lit`);
      if (n) litNode[j] = n;
    }

    // the jacks, from the scene (world mouths), and the pointer's proxies for them
    const jackAt = new Map<Id, Vector3>();
    let sceneJacks: readonly { id: Id; at: Vec3 }[] = [];
    let ready = false;
    const setup = (jacks: readonly { id: Id; at: Vec3 }[]): void => {
      sceneJacks = jacks;
      for (const j of jacks) {
        const p = new Vector3(...j.at);
        jackAt.set(j.id, p);
        const g = new Group();
        g.name = `jack:${j.id}`;
        g.position.copy(p);
        root.add(g);
        ctx.pickable(j.id, g, { box: new Box3(new Vector3(-0.17, -0.17, -0.08), new Vector3(0.17, 0.17, 0.12)), pad: 0.02 });
      }
      ready = true;
    };

    // ── the plug ──
    const plugPiece = cordPlug({ seed: o.seed, rest: 'seat' });
    const plug = new Group();
    plug.name = 'plug';
    plug.add(ctx.realize(plugPiece));
    root.add(plug);
    const cordSocket = plugPiece.sockets?.['cord'] ? new Vector3().setFromMatrixPosition(plugPiece.sockets['cord']) : new Vector3(0, 0, 0.54);
    ctx.pickable('cord', plug, { pad: 0.05 });

    // ── the cord ──
    const cb = piece('cord', { ao: false });
    cb.add({ material: 'rubber', geometry: cordGeometry(Array.from({ length: C.points }, (_, i) => [i * 0.05, 0.5, 0] as const)) });
    const tubeObj = ctx.realize(cb.build());
    root.add(tubeObj);
    let tubeGeom: BufferGeometry | null = null;
    tubeObj.traverse((m) => {
      if ((m as Mesh).isMesh) {
        tubeGeom = (m as Mesh).geometry;
        m.frustumCulled = false;
      }
    });
    const rootAt = new Vector3(...fit.board.cordRoot);
    let rope: Rope | null = null;
    const at = fit.board.at;
    const L = BOARD_WHOLE;
    const floor = (v: Vector3): void => {
      if (v.y < C.radius) v.y = C.radius;
      const lx = v.x - at.x, lz = v.z - at.z;
      if (Math.abs(lx) > L.w / 2 || v.y > L.top) return;
      if (lz < L.shelfZ && v.y < L.shelfY + C.radius) {
        if (L.shelfZ - lz < L.shelfY + C.radius - v.y) v.z = at.z + L.shelfZ + C.radius;
        else v.y = L.shelfY + C.radius;
      }
      if (lz < L.panelZ + C.radius) v.z = at.z + L.panelZ + C.radius;
    };
    const tRoot = new Vector3(0, 1, 0);
    const ropePts: Array<[number, number, number]> = Array.from({ length: C.points }, () => [0, 0, 0]);

    // ── view state ──
    const pos = new Vector3();
    const vel = new Vector3();
    const prevVel = new Vector3();
    const goal = new Vector3();
    const q = new Quaternion();
    const qSeated = new Quaternion();
    const qHeld = new Quaternion();
    const qHang = new Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);
    const qa = new Quaternion();
    const qb = new Quaternion();
    let held = 0; // 0 seated .. 1 held
    let hang = 0; // 0 .. 1 hanging (on the way home after a drop away from any jack)
    let heldYaw = 0;
    let seat = 0, seatV = 0;
    let hover = 0;
    let swingX = 0, swingZ = 0;
    let first = true;
    let lastHeld: Vector3 | null = null;
    let refuseAt = -Infinity;
    const refuseFrom = new Vector3();
    let homeAt = -Infinity; // a drop away from any jack: hangs on the way home
    let cordTellUntil = -Infinity; // P3: the cord's tell (it has no lamp: the lens of its jack blinks)
    const offer: Record<JackName, number> = { storefront: 0, platen: 0, belt: 0, lamp: 0 };
    const offerV: Record<JackName, number> = { storefront: 0, platen: 0, belt: 0, lamp: 0 };
    const shown: SwitchboardPose = { lamps: {}, collars: {} };
    const lastLamp: Record<string, number> = {};
    const lastCollar: Record<string, number> = {};
    const end = new Vector3();
    const tEnd = new Vector3();

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const v = w.cord('cord');
        if (!v) return;
        if (!ready) setup(w.scene.cord.jacks);
        const reduced = w.reducedMotion || ctx.reducedMotion;
        const dt = Math.min(frame.dt, 0.05);
        const t = frame.time;
        const lineV = w.machine('line');
        const line = lineV?.kind === 'line' ? (lineV as LineView) : null;
        const pv = w.crewView('patch');
        const patch = pv?.kind === 'patch' ? (pv.view as PatchView) : null;

        for (const e of frame.events) {
          if (e.type === 'cord.plugged') {
            const target = jackAt.get(e.jack);
            // seated where it was let go: a push and a click. Refused (it went home from somewhere else): the bounce first
            if (refuseAt > t - 0.05) {
              /* the refusal plays; the seat push follows it */
            } else if (target && lastHeld && lastHeld.distanceTo(target) > 0.6) homeAt = t;
            seat = F.seatFrom;
            seatV = 0;
          }
          if (e.type === 'tell' && e.id === 'cord') cordTellUntil = t + TELL_SECONDS;
          if (e.type === 'card' && e.by === 'cord' && lastHeld) {
            refuseAt = t;
            refuseFrom.copy(lastHeld);
          }
        }

        // where the plug's home is now, and where the hand has it
        const home = jackAt.get(v.jack) ?? rootAt;
        if (v.lifted && v.plugAt) {
          goal.set(v.plugAt[0], v.plugAt[1], v.plugAt[2]);
          lastHeld = (lastHeld ?? new Vector3()).copy(goal);
        } else goal.copy(home);
        const refusing = t - refuseAt < F.refuseTime && !v.lifted;
        if (refusing) {
          // pushed at a capped jack: in a little, a knock back out, then home
          const u = (t - refuseAt) / F.refuseTime;
          goal.copy(refuseFrom);
          goal.z -= F.refuseIn * Math.sin(Math.min(1, u * 2.2) * Math.PI) * (1 - u);
        }
        // Patch moving the cord itself (attract mode): out of its jack on a yank, in the paw, into the new jack
        const pp = patch?.state === 'plug' && patch.plug ? patch.plug : null;
        const paw = pp ? bus.paw : null;
        let inPaw = false;
        if (pp && paw) {
          const a = jackAt.get(pp.from), b = jackAt.get(pp.to);
          if (a && b) {
            const u = paw.u;
            if (u < 0.3) {
              goal.copy(a);
              goal.z += 0.03 * Math.max(0, (u - 0.18) / 0.12);
            } else if (u < 0.5) {
              const kk = outCubic((u - 0.3) / 0.2);
              goal.set(a.x + (paw.x - a.x) * kk, a.y + (paw.y - a.y) * kk + 0.12 * Math.sin(Math.PI * kk), a.z + 0.03 + (paw.z - a.z - 0.03) * kk);
            } else if (u < 0.85) goal.set(paw.x, paw.y, paw.z);
            else {
              const kk = inOutCubic((u - 0.85) / 0.15);
              goal.set(paw.x + (b.x - paw.x) * kk, paw.y + (b.y - paw.y) * kk, paw.z + (b.z + F.seatFrom - paw.z) * kk);
            }
            inPaw = u >= 0.3;
          }
        }
        const hovGoal = !v.lifted && !pp && frame.hovered === 'cord' && !w.bracketed ? F.hoverOut : 0;
        hover = reduced ? hovGoal : damp(hover, hovGoal, 22, dt);
        if (first) {
          pos.copy(goal);
          first = false;
        }
        const k = (reduced && !v.lifted) || inPaw ? 1 : 1 - Math.exp(-(v.lifted || refusing || pp ? F.follow : F.home) * dt);
        prevVel.copy(vel);
        vel.subVectors(goal, pos).multiplyScalar(k / Math.max(dt, 1e-4));
        pos.lerp(goal, k);
        if (!v.lifted && !refusing && !pp && pos.distanceTo(home) < 0.004) pos.copy(home);

        // the attitude: seated; held (nose to the board, a little down, turned toward the nearest jack); hanging on the way home
        let nearest: JackName | null = null;
        let nd = Infinity;
        for (const j of sceneJacks) {
          const n = jackName(j.id);
          if (!n) continue;
          const d = pos.distanceTo(jackAt.get(j.id)!);
          if (d < nd) {
            nd = d;
            nearest = n;
          }
        }
        const heldGoal = v.lifted || refusing || (inPaw && paw!.u < 0.9) ? 1 : 0;
        held = reduced ? heldGoal : damp(held, heldGoal, v.lifted || inPaw ? 16 : 10, dt);
        const hangGoal = !v.lifted && t - homeAt < 0.7 ? 1 : 0;
        hang = reduced ? 0 : damp(hang, hangGoal, hangGoal ? 10 : 7, dt);
        if (v.lifted && nearest) {
          const jp = jackAt.get(`jack-${nearest}`)!;
          const want = Math.max(-F.heldYawMax, Math.min(F.heldYawMax, Math.atan2(pos.x - jp.x, pos.z - jp.z) * 0.6));
          heldYaw = reduced ? want : damp(heldYaw, want, 6, dt);
        }
        qHeld.setFromAxisAngle(AXIS_Y, heldYaw).multiply(qa.setFromAxisAngle(AXIS_X, F.heldPitch));
        q.copy(qSeated).slerp(qHeld, held);
        if (hang > 0.001) q.slerp(qHang, hang);
        // tilt: lagging the hand
        const ax = (vel.x - prevVel.x) / Math.max(dt, 1e-4), az = (vel.z - prevVel.z) / Math.max(dt, 1e-4);
        const on = (v.lifted || hang > 0.05) && !reduced;
        const sx = on ? Math.max(-F.swingMax, Math.min(F.swingMax, ax * F.swing)) : 0;
        const sz = on ? Math.max(-F.swingMax, Math.min(F.swingMax, az * F.swing)) : 0;
        swingX = damp(swingX, sx, F.swingRate, dt);
        swingZ = damp(swingZ, sz, F.swingRate, dt);
        qa.setFromAxisAngle(AXIS_Z, -swingX).multiply(qb.setFromAxisAngle(AXIS_X, swingZ));
        plug.quaternion.copy(qa).multiply(q);
        plug.position.copy(pos);

        // the seat push (a spring home from proud of the jack), the misfire's jump
        let left = reduced ? 0 : dt;
        if (reduced) seat = 0;
        while (left > 1e-6) {
          const h = Math.min(left, 1 / 240);
          seatV += (-F.seatOmega * F.seatOmega * seat - 2 * F.seatDamping * F.seatOmega * seatV) * h;
          seat += seatV * h;
          left -= h;
        }
        let jump = 0;
        if (v.misfire && !reduced) {
          const s = v.misfire.since;
          if (s < 0.5) jump = F.misfireJump * v.misfire.level * Math.max(0, Math.sin(Math.min(1, s / 0.35) * Math.PI)) * (1 - s / 0.5);
        }
        if (!v.lifted) plug.position.z += (1 - held) * (seat + jump + hover);

        // ── the jacks: lenses and collars ──
        const offering = new Set((line?.offering ?? []).map((id) => jackName(id)));
        const ringing = jackName(line?.ringing ?? null);
        const pickedUp = patch && patch.state !== 'seated' && patch.state !== 'notice' && patch.state !== 'roll';
        const cordIn = jackName(v.jack);
        // P3 (§ B3): a tell for a station with no lamp of its own blinks a lens instead, slowly, at the station lamps'
        // rate (`lampOn`): the phone line and the cord, the lens of the jack the cord is in; the desk lamp, its own jack's
        const telling = new Set<string>();
        if ((line?.lamp === 'blink' || t < cordTellUntil) && cordIn) telling.add(cordIn);
        const lampV = w.machine('lamp');
        const lampJack = lampV?.kind === 'lamp' && lampV.lamp === 'blink' ? jackName(lampV.jack) : null;
        if (lampJack) telling.add(lampJack);
        for (const j of JACKS) {
          // collars: lifted while offered; the nearest stands tallest; all breathe, out of step
          const off = offering.has(j);
          const hov = frame.hovered === `jack-${j}` && !w.bracketed && !v.lifted;
          const target = off ? (j === nearest && nd < F.nearWithin ? F.offerNear : F.offer) : hov ? F.hoverCollar : 0;
          if (reduced) {
            offer[j] = target;
            offerV[j] = 0;
          } else {
            const om = 16, ze = 0.45;
            let l = dt;
            while (l > 1e-6) {
              const h = Math.min(l, 1 / 240);
              offerV[j] += (om * om * (target - offer[j]) - 2 * ze * om * offerV[j]) * h;
              offer[j] += offerV[j] * h;
              l -= h;
            }
          }
          const ph = JACKS.indexOf(j) * 0.9;
          const breath = off && !reduced ? F.breath * (0.5 + 0.5 * Math.sin((t / F.breathPeriod) * Math.PI * 2 + ph)) : 0;
          const collar = Math.max(0, offer[j] - breath * offer[j]);
          const cr = Math.round(collar * 400) / 400;
          if (lastCollar[j] !== cr) {
            shown.collars![j] = cr;
            lastCollar[j] = cr;
          } else delete shown.collars![j];
          // lenses: in its jack, a call waiting (blinking until Patch has it in hand), or offered (glowing, breathing)
          let lit = cordIn === j && !v.lifted ? 1 : 0;
          if (telling.has(j) && !v.lifted) lit = lampOn('blink', t) ? 1 : 0;
          if (ringing === j) lit = pickedUp ? 1 : (t / F.ringPeriod) % 1 < F.ringDuty || reduced ? 1 : 0;
          if (off) lit = 1;
          if (lastLamp[j] !== lit) {
            shown.lamps![j] = lit;
            lastLamp[j] = lit;
          } else delete shown.lamps![j];
        }
        poseSwitchboard(board, shown);
        // an offered lens breathes (its lit node's scale; poseSwitchboard only switches it)
        for (const j of JACKS) {
          const n = litNode[j];
          if (!n || lastLamp[j]! < 0.5) continue;
          const s = offering.has(j) && !reduced ? 0.86 + 0.14 * (0.5 + 0.5 * Math.sin((t / F.breathPeriod) * Math.PI * 2 + JACKS.indexOf(j) * 0.9 + 0.6)) : 1;
          n.scale.setScalar(s);
        }

        // ── the rope: from the board's root to the boot ──
        end.copy(cordSocket).applyQuaternion(plug.quaternion).add(plug.position);
        tEnd.copy(cordSocket).normalize().applyQuaternion(plug.quaternion);
        if (!rope) {
          let far = 0;
          for (const p of jackAt.values()) far = Math.max(far, p.distanceTo(rootAt));
          rope = new Rope(rootAt, end, C.points, far + C.slack);
          // settled before it is first seen: two seconds of hanging
          for (let i = 0; i < 40; i++) rope.step(0.05, rootAt, tRoot, end, tEnd, floor);
        }
        rope.step(reduced ? Math.min(dt, 1 / 60) : dt, rootAt, tRoot, end, tEnd, floor);
        if (tubeGeom) {
          for (let i = 0; i < C.points; i++) {
            const p = rope.p[i]!;
            const r = ropePts[i]!;
            r[0] = p.x;
            r[1] = p.y;
            r[2] = p.z;
          }
          updateCord(tubeGeom, ropePts);
        }
      },
      dispose() {
        bus.board = null;
        root.removeFromParent();
      },
    };
  };
}
