/**
 * Patch works the board (W2 part 2; REWRITE.md § B5 "Patch", § D 3, § F3).
 *
 * The simulation says what Patch is doing (`PatchView.state`, `stateTime`,
 * `stateLength`, the stool on its runner); this view performs it with the
 * felt piece's performances (kit/pieces/patch-felt/perform.ts), each
 * TIME-SCALED to the simulation's stage: the performances are authored at
 * their own lengths and the stages are shorter, so a stage's 0..1 is
 * mapped onto its stretch of the performance, never the other way.
 *
 *   notice                       notice()          lamp of the line, ears first
 *   roll                         rollTo()          the yank, the glide, the stop; the stool rides the runner
 *   drawer / work / check / reply job()            0-2.5 / 2.5-5.3 / 5.3-7.8 / 7.8-9.2 of JOB_LENGTH
 *   seated after a reply         job() 9.2-10.6    the folder put back, the drawer shoved home (follow-through)
 *   stare + look (cord pulled)   theLook()         its first 4.4 s into the 1.5 s the stages allow, then held for as long as the plug is out
 *   look (the lever)             a head turn to the lever
 *   held / walk / climb          held(), returnToStool(), climb()
 *   duck / catch / bonk          duck(), catchCrate(), bonked()
 *
 * Changing performance blends from wherever Patch is (`blendTo`). The stool
 * is drawn here (it rolls): the set leaves it out. The drawer for the jack
 * in hand follows the paw (`poseSwitchboard` on the board the bus holds).
 * Reduced motion: each stage holds its end pose, cuts between them, and no
 * breath, blinks or glances run.
 */
import { Group, Matrix4, Vector3, type Object3D } from 'three';
import type { PatchState, PatchView, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import { placedMatrix } from './set.ts';
import { poseMatrices, SIDE_ON, type PatchPose } from '../kit/pieces/patch-felt/index.ts';
import {
  CLIMB_LENGTH, JOB_LENGTH, LOOK_LENGTH, NOTICE_LENGTH, REACTION_LENGTH, REST_X, SEATED, VISITOR_BOARD,
  atWork, blendTo, boardToRoot, bonked, catchCrate, climb, duck, held, job, jobTargets, lookAt, notice, resolvePose,
  returnToStool, rollLength, rollTo, theLook, toPose, walkDuration, withBlinks, withBreath, type JobTargets, type V3,
  WORK_SWIVEL, mixPose, pawPoint, reach, type FullPose,
} from '../kit/pieces/patch-felt/perform.ts';
import { BOARD_WHOLE, JACKS, poseSwitchboard, type JackName } from '../kit/pieces/switchboard/index.ts';
import { clamp01, damp, inOutCubic, inOutQuad, outCubic } from '../anim/index.ts';
import { jackName, patchlampBus } from './patchlamp-bus.ts';

/** Tune here: seconds, rates in 1/s. */
export const OPERATOR_FEEL = {
  /** Blends between performances: from a pose the next one starts from, and from anywhere else. */
  blendNear: 0.18,
  blendFar: 0.35,
  /** A thrown part: no time to ease into it. */
  blendReact: 0.07,
  /** The look held after the cord comes out: the stages' share of it (s), then natural speed. */
  lookStages: 1.5,
  /** The job's follow-through after the reply: the folder put back, the drawer shut (natural speed). */
  shutFrom: 9.2,
  /** The idle head: how fast it follows, how near the pointer must be, how much of the way it turns. */
  idleRate: 2.4,
  near: 4.5,
  idleShare: 0.55,
  /** A blink about this often at rest. */
  blinkEvery: 3.4,
  /** The hand's velocity while held: a damped follower. */
  carryRate: 7,
};

export interface OperatorViewOptions {
  patch: Entry | undefined;
  stool: Entry | undefined;
  fit: Fit;
  seed: number;
  crewScale: number;
  key: object;
  /** World points the job checks on each line (the thing it changed), board space computed here. */
  things: Partial<Record<JackName, Vec3>>;
}

type Mode = 'idle' | 'notice' | 'roll' | 'plug' | 'job' | 'shut' | 'look' | 'lever' | 'held' | 'walk' | 'climb' | 'duck' | 'catch' | 'bonk';

const JOB_SPAN: Partial<Record<PatchState, [number, number]>> = { drawer: [0, 2.5], work: [2.5, 5.3], check: [5.3, 7.8], reply: [7.8, 9.2] };

const tv = new Vector3();

export function createOperatorView(o: OperatorViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = OPERATOR_FEEL;
    const bus = patchlampBus(o.key);
    const S = o.crewScale;
    const BOARD_X = o.fit.board.at.x;
    const BOARD_Z = o.fit.board.at.z;
    const toBoard = (p: Vec3): V3 => [p[0] - BOARD_X, p[1], p[2] - BOARD_Z];

    // ── the stool, on its runner ──
    const stoolPiece: Piece | null = o.stool ? buildEntry(o.stool, null, { seed: o.seed, seatY: 0.62 }, ctx.labels) : null;
    const stool = new Group();
    stool.name = 'stool';
    if (stoolPiece) stool.add(ctx.realize(stoolPiece));
    stool.applyMatrix4(placedMatrix(o.fit.stool.at));
    const stoolRest = stool.position.clone();
    ctx.scene.add(stool);

    // ── Patch, drawn at the crew's scale about the seat ──
    const piece = o.patch ? buildEntry(o.patch, null, { seed: o.seed, standIn: false }, ctx.labels) : null;
    const obj = piece ? ctx.realize(piece) : new Group();
    const root = new Group();
    root.name = 'patch';
    root.add(obj);
    ctx.scene.add(root);
    const seat = new Vector3(...o.fit.stool.seat);
    root.position.copy(seat);
    root.rotation.y = SIDE_ON;
    root.scale.setScalar(S);
    root.updateMatrixWorld(true);
    // the rig's nodes, found once (posePatch would search the tree for each, every frame)
    const nodes = new Map<string, Object3D>();
    for (const n of Object.keys(poseMatrices(SEATED))) {
      const x = obj.getObjectByName(n);
      if (x) nodes.set(n, x);
    }
    const apply = (p: PatchPose): void => {
      const ms = poseMatrices(p);
      for (const n in ms) {
        const x = nodes.get(n);
        if (x) ms[n]!.decompose(x.position, x.quaternion, x.scale);
      }
    };
    if (ctx.pickable) ctx.pickable('patch', root);
    const seatH = o.fit.stool.seat[1] / S;

    // ── the job's targets for each jack (cached: the job's keys are cached by this object) ──
    const targets = new Map<JackName, JobTargets>();
    const targetsFor = (j: JackName): JobTargets => {
      let t = targets.get(j);
      if (!t) {
        const thing = o.things[j];
        t = jobTargets(j, thing ? toBoard(thing) : undefined, VISITOR_BOARD);
        targets.set(j, t);
      }
      return t;
    };
    const nearestJack = (xBoard: number): JackName => {
      let best: JackName = 'lamp';
      for (const j of JACKS) if (Math.abs(BOARD_WHOLE.jackX[j] + BOARD_WHOLE.stoolDX - xBoard) < Math.abs(BOARD_WHOLE.jackX[best] + BOARD_WHOLE.stoolDX - xBoard)) best = j;
      return best;
    };
    const atRest = (xBoard: number): boolean => Math.abs(xBoard - REST_X) < 0.05;
    const workRest = new Map<JackName, PatchPose>();
    const restPose = (xBoard: number): PatchPose => {
      if (atRest(xBoard)) return SEATED;
      const j = nearestJack(xBoard);
      let p = workRest.get(j);
      if (!p) workRest.set(j, (p = atWork(targetsFor(j))));
      return p;
    };

    // ── view state ──
    let mode: Mode = 'idle';
    let modeAt = 0; // frame time the mode began
    let lastState: PatchState | null = null;
    let last: PatchPose = SEATED;
    let blendFrom: PatchPose | null = null;
    let blendAt = 0;
    let blendDur = 0;
    let entry: PatchPose = SEATED; // the pose a performance starts from
    let jobJack: JackName | null = null;
    let stoolB: number = REST_X; // the stool's board x as drawn
    let rollFrom: number = REST_X, rollTo_: number = REST_X;
    let lookPlug: V3 = [0, 0, 1];
    let walkFrom: V3 = [0, 0, 1];
    let walkSim = 1;
    let reactFrom: V3 = [0, 0, 1];
    let lookStart = 0;
    let hover = 0;
    /** The cord's move (state `plug`): the poses of the paw at the plug, yanking it, and at the new jack. */
    let plugKeys: { base: FullPose; at: FullPose; yank: FullPose; to: FullPose } | null = null;
    const pawW = new Vector3();
    let heldId: string | null = null;
    let heldObj: Object3D | null = null;
    let drawer = 0;
    let drawerShown = -1;
    const drawers: Record<JackName, number> = { storefront: 0, platen: 0, belt: 0, lamp: 0 };
    // the idle head
    let hy = 0, hp = 0, gx = 0, gy = 0;
    // the hand while held
    const handPrev = new Vector3();
    const handVel = new Vector3();
    let handFirst = true;
    const rootInv = new Matrix4();

    const enter = (m: Mode, t: number, near: boolean): void => {
      if (mode !== m || m === 'job') {
        blendFrom = last;
        blendAt = t;
        blendDur = near ? F.blendNear : F.blendFar;
      }
      mode = m;
      modeAt = t;
      entry = last;
    };
    /** World → root space with the root on the stool's seat (wherever the stool is now), whatever the root is doing. */
    const seatInv = new Matrix4();
    const seatSpace = (p: Vec3): V3 => {
      seatInv.compose(tv.set(seat.x + (stoolB - REST_X), seat.y, seat.z), root.quaternion, root.scale).invert();
      tv.set(p[0], p[1], p[2]).applyMatrix4(seatInv);
      return [tv.x, tv.y, tv.z];
    };
    /** World → root space (the root as it is now). */
    const rootSpace = (p: Vec3): V3 => {
      tv.set(p[0], p[1], p[2]).applyMatrix4(rootInv);
      return [tv.x, tv.y, tv.z];
    };
    const blinkTimes = (t: number): number[] => {
      const k = Math.floor(t / F.blinkEvery);
      return [k * F.blinkEvery + 0.4 + ((k * 7) % 5) * 0.23, (k + 1) * F.blinkEvery + 0.4 + (((k + 1) * 7) % 5) * 0.23];
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const cv = w.crewView('patch');
        if (!cv || cv.kind !== 'patch') return;
        const v = cv.view as PatchView;
        const reduced = w.reducedMotion || ctx.reducedMotion;
        const t = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        const st = v.state;
        const u = Number.isFinite(v.stateLength) && v.stateLength > 0 ? clamp01(v.stateTime / v.stateLength) : 0;
        const U = reduced ? (Number.isFinite(v.stateLength) ? 1 : u) : u; // reduced motion: each stage holds its end pose
        const cord = w.cord('cord');
        const plugOut = !!cord?.lifted;

        // ── which performance ──
        const lv = w.machine('line');
        const inHand = lv?.kind === 'line' ? jackName(lv.job?.jack ?? null) : null;
        if (st !== lastState) {
          const prev = lastState;
          lastState = st;
          const jack = inHand ?? jackName(v.drawer) ?? jobJack;
          switch (st) {
            case 'notice':
              jobJack = null;
              enter('notice', t, true);
              break;
            case 'roll':
              rollFrom = (v.stool.roll?.from ?? v.stool.x) - BOARD_X;
              rollTo_ = (v.stool.roll?.to ?? v.stool.x) - BOARD_X;
              enter('roll', t, true);
              break;
            case 'plug': {
              const from = jackName(v.plug?.from ?? null), to = jackName(v.plug?.to ?? null);
              plugKeys = null;
              if (from && to) {
                const L = BOARD_WHOLE;
                const grip = (j: JackName): V3 => boardToRoot([L.jackX[j], L.jackY, L.panelZ + L.plateT + 0.3], stoolB);
                const base = atWork(targetsFor(to));
                const a = grip(from), b = grip(to);
                const mid: V3 = [(a[0] + b[0]) / 2 + 0.05, Math.max(a[1], b[1]) - 0.02, (a[2] + b[2]) / 2 + 0.2];
                const r = (p: V3): FullPose => resolvePose(reach(p, 'right', base, { swivel: WORK_SWIVEL }).pose);
                plugKeys = { base: resolvePose(entry), at: r(a), yank: r(mid), to: r(b) };
              }
              enter('plug', t, true);
              break;
            }
            case 'drawer':
            case 'work':
            case 'check':
            case 'reply':
              if (jack) jobJack = jack;
              enter('job', t, prev !== null && prev !== 'seated');
              break;
            case 'stare':
              lookStart = t;
              lookPlug = seatSpace((cord?.plugAt ?? v.lookAt ?? [root.position.x, 1.4, root.position.z - 1]) as Vec3);
              enter('look', t, true);
              break;
            case 'look':
              if (prev !== 'stare') enter('lever', t, false);
              break;
            case 'held':
              handFirst = true;
              enter('held', t, false);
              break;
            case 'walk': {
              walkFrom = seatSpace([v.at[0], 0, v.at[2]]);
              walkSim = Math.max(0.2, Math.hypot(v.at[0] - (seat.x + stoolB - REST_X), v.at[2] - (seat.z + 0.77)) / 1.6);
              enter('walk', t, false);
              break;
            }
            case 'climb':
              if (prev !== 'walk') walkFrom = seatSpace([v.at[0], 0, v.at[2]]);
              enter('climb', t, prev === 'walk');
              break;
            case 'duck':
            case 'catch':
            case 'bonk':
              reactFrom = v.lookAt ? seatSpace(v.lookAt) : [0, 0.5, 2];
              enter(st, t, true);
              blendDur = F.blendReact;
              break;
            case 'seated':
              if (prev === 'reply' && jobJack) enter('shut', t, true);
              else if (prev === 'stare' || prev === 'look') {
                if (plugOut && mode === 'look') break; // the look holds while the plug is out
                enter('idle', t, false);
              } else enter('idle', t, false);
              break;
          }
        }
        // the look ends when the plug goes back in (the simulation is seated by then)
        if (mode === 'look' && st === 'seated' && !plugOut) enter('idle', t, false);
        if (mode === 'shut' && t - modeAt >= JOB_LENGTH - F.shutFrom) enter('idle', t, true);

        // ── the stool: the simulation's place, or the roll's own curve ──
        let pose: PatchPose;
        let caught: V3 | null = null;
        drawer = 0;
        const simB = v.stool.x - BOARD_X;
        if (mode !== 'roll') stoolB = simB;
        const age = t - modeAt;
        switch (mode) {
          case 'notice': {
            const ringing = (lv?.kind === 'line' ? jackName(lv.ringing) : null) ?? nearestJack(stoolB);
            const lamp = boardToRoot([BOARD_WHOLE.jackX[ringing] + BOARD_WHOLE.lampDX, BOARD_WHOLE.jackY, BOARD_WHOLE.panelZ + BOARD_WHOLE.plateT + 0.07], stoolB);
            pose = notice(U * NOTICE_LENGTH, lamp, entry);
            break;
          }
          case 'roll': {
            const len = rollLength(rollFrom, rollTo_);
            const r = rollTo(U * len, { fromX: rollFrom, toX: rollTo_, from: entry, to: restPose(rollTo_) });
            stoolB = r.stoolX;
            pose = r.pose;
            break;
          }
          case 'plug': {
            // reach for the plug, a yank that brings it out on its cord, across, and into the new jack
            const K = plugKeys;
            if (!K) {
              pose = entry;
              break;
            }
            let f: FullPose;
            if (U < 0.3) f = mixPose(K.base, K.at, inOutCubic(U / 0.3));
            else if (U < 0.5) f = mixPose(K.at, K.yank, outCubic((U - 0.3) / 0.2));
            else if (U < 0.85) f = mixPose(K.yank, K.to, inOutQuad((U - 0.5) / 0.35));
            else f = mixPose(K.to, K.base, inOutCubic((U - 0.85) / 0.15) * 0.25);
            pose = toPose(f);
            break;
          }
          case 'job': {
            const span = JOB_SPAN[st] ?? [0, 0];
            const T = targetsFor(jobJack ?? nearestJack(stoolB));
            const f = job(span[0] + (span[1] - span[0]) * U, T);
            pose = f.pose;
            drawer = f.drawer;
            break;
          }
          case 'shut': {
            const f = job(reduced ? JOB_LENGTH : Math.min(JOB_LENGTH, F.shutFrom + age), targetsFor(jobJack ?? nearestJack(stoolB)));
            pose = f.pose;
            drawer = f.drawer;
            break;
          }
          case 'look': {
            const a = t - lookStart;
            const lt = reduced ? LOOK_LENGTH : Math.min(a, F.lookStages) * (LOOK_LENGTH / F.lookStages) + Math.max(0, a - F.lookStages);
            pose = theLook(lt, { plug: lookPlug, from: entry, visitor: boardToRoot(VISITOR_BOARD, stoolB) });
            break;
          }
          case 'lever': {
            const base = resolvePose(entry);
            const lk = v.lookAt ? lookAt(base, rootSpace(v.lookAt), 0.75) : null;
            pose = lk ? toPose({ ...base, ...lk, brows: [-0.5, -0.3], lids: [0.4, 0.42] }) : entry;
            break;
          }
          case 'held': {
            // the root goes to the visitor's hand; the scruff hangs from it
            const hand = new Vector3(v.at[0], v.at[1], v.at[2]);
            if (handFirst) {
              handPrev.copy(hand);
              handVel.set(0, 0, 0);
              handFirst = false;
            }
            if (dt > 1e-4) {
              tv.subVectors(hand, handPrev).divideScalar(dt);
              handVel.x = damp(handVel.x, tv.x, F.carryRate, dt);
              handVel.y = damp(handVel.y, tv.y, F.carryRate, dt);
              handVel.z = damp(handVel.z, tv.z, F.carryRate, dt);
            }
            handPrev.copy(hand);
            const c = Math.cos(-SIDE_ON), s = Math.sin(-SIDE_ON);
            const vr: V3 = [(handVel.x * c + handVel.z * s) / S, handVel.y / S, (-handVel.x * s + handVel.z * c) / S];
            pose = held(reduced ? 1 : age, reduced ? [0, 0, 0] : vr, { visitor: boardToRoot(VISITOR_BOARD, stoolB) });
            break;
          }
          case 'walk': {
            const W = walkDuration(walkFrom);
            pose = returnToStool(reduced ? W : Math.min(W, age * (W / walkSim)), walkFrom, { seatH });
            break;
          }
          case 'climb': {
            pose = climb(U * CLIMB_LENGTH, { seatH });
            break;
          }
          case 'duck':
            pose = duck(U * REACTION_LENGTH, { from: reactFrom });
            break;
          case 'catch': {
            const L = BOARD_WHOLE;
            // the keyshelf point the simulation sets a caught part on (AT.keyshelf; PatchView does not carry it yet)
            const shelf = boardToRoot([L.jackX.lamp - 0.22, L.shelfY, L.shelfZ - 0.2], stoolB);
            const c = catchCrate(U * REACTION_LENGTH, { from: reactFrom, shelf });
            pose = c.pose;
            caught = c.crate;
            break;
          }
          case 'bonk':
            pose = bonked(U * REACTION_LENGTH, { from: reactFrom });
            break;
          default: {
            // idle: the rest (side-on, face to the visitor) or at work by a jack; the head follows the action, slowly
            const base = resolvePose(restPose(stoolB));
            let target: V3 | null = null;
            if (frame.pointer && frame.hovered && frame.hovered !== 'patch') {
              tv.set(frame.pointer[0], frame.pointer[1], frame.pointer[2]);
              if (tv.distanceTo(root.position) < F.near) target = rootSpace(frame.pointer);
            }
            let gHy = base.headYaw, gHp = base.headPitch, gG: [number, number] = base.gaze;
            if (target && !reduced) {
              const lk = lookAt(base, target, 0.8);
              gHy = base.headYaw + (lk.headYaw - base.headYaw) * F.idleShare;
              gHp = base.headPitch + (lk.headPitch - base.headPitch) * F.idleShare;
              gG = lk.gaze;
            }
            const r = reduced ? 1e3 : F.idleRate;
            hy = damp(hy, gHy, r, dt);
            hp = damp(hp, gHp, r, dt);
            gx = damp(gx, gG[0], r * 2, dt);
            gy = damp(gy, gG[1], r * 2, dt);
            let f = { ...base, headYaw: hy, headPitch: hp, gaze: [gx, gy] as [number, number] };
            if (!reduced) f = withBlinks(withBreath(f, t), t, blinkTimes(t));
            pose = toPose(f);
            break;
          }
        }
        if (mode !== 'idle') {
          // keep the idle head where the performance leaves it, so idle picks up without a jump
          const r = resolvePose(pose);
          hy = r.headYaw;
          hp = r.headPitch;
          gx = r.gaze[0];
          gy = r.gaze[1];
        }
        if (blendFrom && !reduced && t - blendAt < blendDur) pose = blendTo(blendFrom, pose, t - blendAt, blendDur);
        else blendFrom = null;
        last = pose;
        // hovered: the ears turn to the pointer (not while a rung plays)
        const hovGoal = frame.hovered === 'patch' && !w.bracketed && mode !== 'held' ? 1 : 0;
        hover = reduced ? hovGoal : damp(hover, hovGoal, 14, dt);
        if (hover > 0.01) {
          const e = pose.ears ?? [0, 0];
          pose = { ...pose, ears: [e[0] + (-0.55 - e[0]) * hover, e[1] + (-0.45 - e[1]) * hover] };
        }

        // ── place the stool and Patch ──
        const dx = stoolB - REST_X;
        stool.position.set(stoolRest.x + dx, stoolRest.y, stoolRest.z);
        if (mode === 'held') root.position.set(v.at[0], v.at[1], v.at[2]);
        else root.position.set(seat.x + dx, seat.y, seat.z);
        root.updateMatrixWorld(true);
        rootInv.copy(root.matrixWorld).invert();
        apply(pose);
        // a caught part is drawn in the paw (the parts view drew it where the simulation has it; this runs after)
        if (mode === 'catch' && v.holding) {
          if (v.holding !== heldId) {
            heldId = v.holding;
            heldObj = ctx.scene.getObjectByName(`part:${v.holding}`) ?? null;
          }
          if (heldObj && caught && !reduced) {
            pawW.set(caught[0], caught[1], caught[2]).applyMatrix4(root.matrixWorld);
            const e = heldObj.matrix.elements;
            e[12] = pawW.x;
            e[13] = pawW.y;
            e[14] = pawW.z;
            heldObj.matrixWorldNeedsUpdate = true;
          }
        }
        if (mode === 'plug' && st === 'plug') {
          const p = pawPoint(pose, 'right');
          pawW.set(p[0], p[1], p[2]).applyMatrix4(root.matrixWorld);
          bus.paw = { x: pawW.x, y: pawW.y, z: pawW.z, u: U };
        } else bus.paw = null;

        // ── the drawer of the jack in hand follows the paw; any other closes ──
        for (const j of JACKS) {
          const want = j === jobJack && (mode === 'job' || mode === 'shut') ? drawer : 0;
          drawers[j] = reduced ? want : want > drawers[j] ? want : damp(drawers[j], want, 8, dt);
        }
        const sum = drawers.storefront * 1 + drawers.platen * 3 + drawers.belt * 9 + drawers.lamp * 27;
        if (bus.board && sum !== drawerShown) {
          poseSwitchboard(bus.board, { drawers });
          drawerShown = sum;
        }
      },
      dispose() {
        root.removeFromParent();
        stool.removeFromParent();
      },
    };
  };
}
