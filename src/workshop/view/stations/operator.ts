/**
 * Patch works the board (W2 part 2; REWRITE.md § B5 "Patch", § D 3, § F3).
 *
 * The simulation says what Patch is doing (`PatchView.state`, `stateTime`,
 * `stateLength`, the stool on its runner); this view performs it with the
 * felt piece's performances (kit/pieces/patch-felt/perform.ts), each
 * authored FOR the simulation's stage lengths (PATCH_TUNING) and played at
 * natural speed: a performance's t is the stage's own `stateTime`.
 *
 *   notice                       notice()          lamp of the line, ears first
 *   roll                         rollTo()          the shove, the glide, the stop, over the stage's own length
 *   plug (attract mode)          movePlug()        the cord out of one jack and into another
 *   drawer / work / check / reply job()            JOB_STAGES, each at its own start
 *   seated after a reply         job() 'shut'      the folder put back, the drawer shoved home (follow-through)
 *   stare + look (cord pulled)   theLook()         the plug, then the visitor; held for as long as the plug is out
 *   look (the lever)             a head turn to the lever
 *   held / walk / climb          held(), toddle(), climb() (from PatchView.foot)
 *   duck / catch / bonk          duck(), catchCrate() (onto PatchView.shelf), bonked()
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
import { PATCH_TUNING } from '../../sim/index.ts';
import { poseMatrices, SIDE_ON, type PatchPose } from '../kit/pieces/patch-felt/index.ts';
import {
  BONK_LENGTH, CATCH_LENGTH, CLIMB_LENGTH, DUCK_LENGTH, JOB_STAGES, LOOK_LENGTH, NOTICE_LENGTH, REST_X, SEATED, SHUT_LENGTH, VISITOR_BOARD,
  atWork, blendTo, boardToRoot, bonked, catchCrate, climb, duck, held, job, jobTargets, lookAt, movePlug, notice, resolvePose,
  rollTo, theLook, toPose, toddle, withBlinks, withBreath, type JobStage, type JobTargets, type V3,
  rungReaction, facepalm, glanceShake, type FacepalmVariant, overTheEdge, type LedgeOptions, crossBelt, tumble, landed, shakeOff, splat, LAND_LENGTH, SHAKE_LENGTH,
} from '../kit/pieces/patch-felt/perform.ts';
import { BOARD_WHOLE, JACKS, poseSwitchboard, type JackName } from '../kit/pieces/switchboard/index.ts';
import { clamp01, damp, inOutCubic, inOutQuad, outCubic } from '../anim/index.ts';
import { jackName, patchlampBus } from './patchlamp-bus.ts';
import { partsHooks, unhook, type PartsOverlay } from './parts.ts';

/** Tune here: seconds, rates in 1/s. */
export const OPERATOR_FEEL = {
  /** Blends between performances: from a pose the next one starts from, and from anywhere else. */
  blendNear: 0.18,
  blendFar: 0.35,
  /** A thrown part: no time to ease into it. */
  blendReact: 0.07,
  /** The idle head: how fast it follows, how near the pointer must be, how much of the way it turns. */
  idleRate: 2.4,
  near: 4.5,
  idleShare: 0.55,
  /** A blink about this often at rest. */
  blinkEvery: 3.4,
  /** The hand's velocity while held: a damped follower. */
  carryRate: 7,
  /** R2: how fast the body turns to its way while walking (1/s). */
  walkTurn: 9,
};
/** R2: the walk's first seconds: a look at the visitor and a turn, no step (the simulation's). */
const SET_OFF: number = PATCH_TUNING.setOff;

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

type Mode = 'idle' | 'notice' | 'roll' | 'plug' | 'job' | 'shut' | 'look' | 'lever' | 'held' | 'walk' | 'cross' | 'fly' | 'land' | 'shake' | 'away' | 'wall' | 'climb' | 'duck' | 'catch' | 'bonk' | 'rung' | 'facepalm' | 'ledge';

/** Where each of the simulation's job stages starts in the job performance (it is authored at their lengths). */
const JOB_AT = new Map<string, { at: number; dur: number }>(JOB_STAGES.map((s) => [s.name, { at: s.at, dur: s.dur }]));
const SHUT_AT = JOB_AT.get('shut' satisfies JobStage)!.at;

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

    // ── idle prep: while Patch sits doing nothing, one small piece of its repertoire is got ready per frame
    // (each line's job keyframes, kept; the rest run once so the first real one is not its first time) ──
    const prep: Array<() => void> = [
      ...JACKS.map((j) => () => void job(0, targetsFor(j))),
      () => void notice(0.1, [-1, 0.4, 0.5]),
      () => void rollTo(0.3, { fromX: REST_X, toX: REST_X - 1, length: 0.6 }),
      () => void theLook(0.5, { plug: [-0.5, 0.2, 0.4] }),
      () => void climb(0.3),
      () => void duck(0.3),
      () => void bonked(0.3),
      () => void catchCrate(0.6),
      () => void rungReaction(1, 1, { play: 3, rewind: 1.2 }),
      () => void facepalm(1),
    ];

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
    let walked = 0;
    let walkPrev: V3 | null = null;
    /** R2: the walk's body yaw (root space), turning toward the simulation's heading; the glance back and being stopped (0..1). */
    let walkYaw = 0;
    /** R4: in the air: how far it has turned head over heels, when it left the hand, the way it was going; and on landing. */
    let flySpin = 0;
    let flyAt = 0;
    let flyYaw = 0;
    let landSpin = 0;
    let landYaw = 0;
    let landFromWall = false;
    let glance = 0;
    let glanced = 0;
    let stopped = 0;
    let climbFoot: V3 = [0, 0, 1];
    /** R1: the edge it went over (root space), kept for the ledge, the haul and the dusting off. */
    let ledgeO: LedgeOptions | null = null;
    let catchShelf: V3 | null = null;
    let reactFrom: V3 = [0, 0, 1];
    let lookStart = 0;
    let hover = 0;
    // a Button rung: the performance it interrupted (resumed, where the simulation left it, when the rung is over)
    let rungSaved: { mode: Mode; entry: PatchPose; at: number } | null = null;
    let rungDrawer = 0;
    // Fetch's fumble: the facepalm when Patch's paws are free, a glance and a head shake when they are not
    let fetchState = '';
    let fumbleAt = -1;
    let fumbleSeen = 0;
    let fumbleFrom: V3 = [0, 0, 1];
    /** When Patch reacts to a fumble (a beat after the crate lands), and for how long. */
    const FUMBLE_BEAT = 0.25, FUMBLE_LENGTH = 3.0;
    // after rung 3: Patch watches Revert fit the cover, and nods once when it is on
    let coverWas = '';
    let nodAt = -1;
    /** The cord's move (state `plug`): from which jack to which. */
    let plugMove: { from: JackName; to: JackName } | null = null;
    const pawW = new Vector3();
    let heldId: string | null = null;
    let heldObj: Object3D | null = null;
    // the part in the paw, for the parts view's overlay
    const inPaw: { id: string; frame: Frame | null; x: number; y: number; z: number } = { id: '', frame: null, x: 0, y: 0, z: 0 };
    let partsFrame: Frame | null = null;
    const hooks = partsHooks(ctx.scene);
    const overlay: PartsOverlay = {
      begin(f) {
        partsFrame = f;
      },
      pose(id, f, m) {
        if (inPaw.frame !== f || inPaw.id !== id) return false;
        const e = m.elements;
        e[12] = inPaw.x;
        e[13] = inPaw.y;
        e[14] = inPaw.z;
        return true;
      },
    };
    hooks.overlays.push(overlay);
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
        // natural speed: a performance's time is the stage's own; reduced motion holds each stage's end pose
        const finite = Number.isFinite(v.stateLength) && v.stateLength > 0;
        const sT = reduced && finite ? v.stateLength : finite ? Math.min(v.stateTime, v.stateLength) : v.stateTime;
        const cord = w.cord('cord');
        const plugOut = !!cord?.lifted;

        // ── a Button rung: the crew is the audience; the job resumes where the simulation left it ──
        if (w.bracketed && !rungSaved && mode !== 'held' && mode !== 'ledge') {
          rungSaved = { mode, entry, at: t };
          rungDrawer = drawer;
          enter('rung', t, true);
        } else if (!w.bracketed && rungSaved) {
          const sv = rungSaved;
          rungSaved = null;
          blendFrom = last;
          blendAt = t;
          blendDur = F.blendFar;
          mode = sv.mode;
          entry = sv.entry;
          // the performances that run on the view's clock pick up where they were
          modeAt += t - sv.at;
          lookStart += t - sv.at;
        }
        // ── Fetch fumbled its crate: Patch reacts a beat after it lands (from the back of the bench) ──
        const fc = w.crew('fetch');
        if (fc && fc.state !== fetchState) {
          if (fc.state === 'offer' && fetchState === 'fumble') {
            fumbleAt = t + FUMBLE_BEAT;
            fumbleFrom = seatSpace([fc.x, 0.4, fc.z]);
            fumbleSeen++;
          }
          fetchState = fc.state;
        }
        if (fumbleAt >= 0 && t >= fumbleAt && !rungSaved) {
          // paws free (idle at the rest or by a jack): the full facepalm; otherwise a glance (below)
          if (mode === 'idle') enter('facepalm', t, true);
          if (mode !== 'facepalm') fumbleAt = -fumbleAt - 1; // remembered as a glance's start (negative)
          else fumbleAt = -1;
        }

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
              plugMove = from && to ? { from, to } : null;
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
              // (back on the ground after the belt: the same walk goes on)
              if (prev !== 'cross') {
                walked = 0;
                walkPrev = null;
                walkYaw = resolvePose(last).body.rot[1];
                glanced = 0;
              }
              enter('walk', t, prev === 'cross');
              break;
            }
            case 'cross':
              enter('cross', t, true);
              break;
            case 'fly':
              // R4: thrown (or back up the chute): from the hand into the air at once
              if (prev !== 'fly') {
                flySpin = 0;
                flyAt = t;
              }
              enter('fly', t, false);
              blendDur = F.blendReact;
              break;
            case 'land':
              // off a wall: the facing it had stuck to the wall (face to the room) is kept to the sit
              landFromWall = prev === 'wall';
              if (!landFromWall) {
                landSpin = flySpin;
                landYaw = flyYaw;
              }
              enter('land', t, true);
              blendFrom = null;
              break;
            case 'shake':
              enter('shake', t, true);
              blendFrom = null;
              break;
            case 'away':
              enter('away', t, true);
              blendFrom = null;
              break;
            case 'wall':
              enter('wall', t, true);
              blendDur = F.blendReact;
              if (v.wall) landYaw = Math.atan2(v.wall.out[0], v.wall.out[2]) - SIDE_ON;
              landSpin = 0;
              break;
            case 'ledge':
            case 'haul':
            case 'dust':
              // R1: over the edge; the performance runs the three stages through on one set of keys
              if (mode !== 'ledge' && v.ledge) {
                ledgeO = { at: seatSpace(v.ledge.at), up: seatSpace(v.ledge.up), heading: v.heading - SIDE_ON, front: v.ledge.edge === 'front', visitor: boardToRoot(VISITOR_BOARD, stoolB) };
                enter('ledge', t, false);
                blendFrom = null; // from the hand to the edge in one frame: it caught it
              }
              break;
            case 'climb':
              // from its feet at the stool's foot (where the walk ended, or where it was put down)
              climbFoot = seatSpace(v.foot);
              enter('climb', t, prev === 'walk');
              break;
            case 'duck':
            case 'catch':
            case 'bonk':
              reactFrom = v.lookAt ? seatSpace(v.lookAt) : [0, 0.5, 2];
              catchShelf = null;
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
        if (mode === 'shut' && t - modeAt >= SHUT_LENGTH) enter('idle', t, true);

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
            pose = notice(reduced ? NOTICE_LENGTH : sT, lamp, entry);
            break;
          }
          case 'roll': {
            const len = finite ? v.stateLength : undefined;
            const r = rollTo(sT, { fromX: rollFrom, toX: rollTo_, ...(len !== undefined ? { length: len } : {}), from: entry, to: restPose(rollTo_) });
            stoolB = r.stoolX;
            pose = r.pose;
            break;
          }
          case 'plug': {
            // reach for the plug, a yank that brings it out on its cord, across, and into the new jack
            pose = plugMove ? movePlug(sT, plugMove.from, plugMove.to, stoolB, entry).pose : entry;
            break;
          }
          case 'job': {
            const span = JOB_AT.get(st) ?? { at: 0, dur: 0 };
            const T = targetsFor(jobJack ?? nearestJack(stoolB));
            const f = job(span.at + Math.min(sT, span.dur), T);
            pose = f.pose;
            drawer = f.drawer;
            break;
          }
          case 'shut': {
            const f = job(SHUT_AT + (reduced ? SHUT_LENGTH : Math.min(SHUT_LENGTH, age)), targetsFor(jobJack ?? nearestJack(stoolB)));
            pose = f.pose;
            drawer = f.drawer;
            break;
          }
          case 'look': {
            pose = theLook(reduced ? LOOK_LENGTH : t - lookStart, { plug: lookPlug, from: entry, visitor: boardToRoot(VISITOR_BOARD, stoolB) });
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
            pose = held(reduced ? 3 : age, reduced ? [0, 0, 0] : vr, { visitor: boardToRoot(VISITOR_BOARD, stoolB) });
            break;
          }
          case 'walk':
          case 'cross': {
            // the feet where the simulation has them; the gait's phase from the distance walked (no sliding)
            const feet = seatSpace([v.at[0], v.at[1], v.at[2]]);
            if (walkPrev) walked += Math.hypot(feet[0] - walkPrev[0], feet[2] - walkPrev[2]);
            walkPrev = feet;
            // the body turns to its way (before the first step, and at each corner), stepping round as it turns
            const want = v.heading - SIDE_ON;
            const dYaw = Math.atan2(Math.sin(want - walkYaw), Math.cos(want - walkYaw));
            const turn = reduced ? dYaw : dYaw * (1 - Math.exp(-F.walkTurn * dt));
            walkYaw += turn;
            if (st === 'walk' && v.stateTime < SET_OFF) walked += Math.abs(turn) * 0.12;
            const vis = boardToRoot(VISITOR_BOARD, stoolB);
            const toward = v.walk?.next ? seatSpace(v.walk.next) : null;
            // the look at the visitor before it sets off (the simulation's lookAt); on a long walk, one glance back
            const glanceGoal = v.lookAt ? 1 : v.walk?.scamper && walked > 1.3 && walked < 2.1 && glanced < 1 ? 1 : 0;
            if (walked >= 2.1 && v.walk?.scamper) glanced = 1;
            glance = reduced ? glanceGoal : damp(glance, glanceGoal, 9, dt);
            stopped = reduced ? (v.walk?.waiting ? 1 : 0) : damp(stopped, v.walk?.waiting ? 1 : 0, 8, dt);
            const o = { visitor: vis, toward, scamper: !!v.walk?.scamper, glance, stopped };
            if (st === 'cross' && finite) {
              const ground = seatSpace([v.at[0], v.foot[1], v.at[2]])[1];
              pose = crossBelt(reduced ? v.stateLength : sT, feet, walkYaw, ground, feet[1], o);
            } else pose = toddle(reduced ? 0 : walked, feet, walkYaw, o);
            break;
          }
          case 'climb': {
            pose = climb(reduced ? CLIMB_LENGTH : sT, { foot: climbFoot, visitor: boardToRoot(VISITOR_BOARD, stoolB) });
            // R2: arriving at a run, a little skid first: leaning back on its heels, ears forward, before the hop
            if (!reduced && blendFrom && sT < 0.2) {
              const k = Math.sin(Math.PI * clamp01(sT / 0.2));
              const r = pose.body?.rot ?? [0, 0, 0];
              pose = { ...pose, body: { ...pose.body, rot: [r[0] - 0.3 * k, r[1], r[2]] }, lean: [(pose.lean?.[0] ?? 0) - 0.15 * k, pose.lean?.[1] ?? 0], ears: [-0.5 * k, -0.5 * k] };
            }
            break;
          }
          case 'fly': {
            // turning head over heels as it goes, faster the harder it was thrown
            const tv = v.thrown?.v;
            const sp = tv ? Math.hypot(tv[0], tv[2]) : 0;
            if (tv && sp > 0.3) flyYaw = Math.atan2(tv[0], tv[2]) - SIDE_ON;
            if (!reduced) flySpin += Math.min(11, Math.max(4, sp * 1.3)) * dt;
            pose = tumble(reduced ? 0 : t - flyAt, seatSpace(v.at), flySpin, flyYaw);
            break;
          }
          case 'land':
            pose = landed(reduced ? LAND_LENGTH : sT, seatSpace(v.at), landYaw, reduced || landFromWall ? 0 : landSpin, v.thrown?.speed ?? 0, landFromWall);
            break;
          case 'shake':
            pose = shakeOff(reduced ? SHAKE_LENGTH : sT, seatSpace(v.at), landYaw);
            break;
          case 'away':
            pose = last;
            break;
          case 'wall':
            pose = splat(reduced ? 1 : v.stateTime, seatSpace(v.at), landYaw, v.wall?.stick ?? 0.25);
            break;
          case 'ledge':
            pose = ledgeO && (st === 'ledge' || st === 'haul' || st === 'dust') ? overTheEdge(st, sT, ledgeO) : last;
            break;
          case 'duck':
            pose = duck(reduced ? DUCK_LENGTH : sT, { from: reactFrom });
            break;
          case 'catch': {
            // set down where the simulation sets the part: its centre on PatchView.shelf (half its height up, and 0.01)
            if (!catchShelf) {
              const h = (v.holding ? w.halfExtents(v.holding)?.[1] : undefined) ?? 0.2;
              catchShelf = seatSpace([v.shelf[0], v.shelf[1] + h + 0.01, v.shelf[2]]);
            }
            const c = catchCrate(reduced ? CATCH_LENGTH : sT, { from: reactFrom, shelf: catchShelf });
            pose = c.pose;
            caught = c.crate;
            break;
          }
          case 'bonk':
            pose = bonked(reduced ? BONK_LENGTH : sT, { from: reactFrom });
            break;
          case 'rung': {
            const b = w.button();
            const sc = b.script;
            const P = sc?.play ?? 3, RW = sc?.rewind ?? 1.2;
            const tr = b.phase === 'playing' ? b.phaseTime : b.phase === 'rewinding' ? P + b.phaseTime : P + RW;
            pose = rungReaction(b.rung, reduced || w.reducedMotion ? P + RW : tr, { play: P, rewind: RW, button: seatSpace(w.scene.button.at), visitor: boardToRoot(VISITOR_BOARD, stoolB), from: entry, presses: b.presses });
            drawer = rungDrawer;
            break;
          }
          case 'facepalm': {
            const variant: FacepalmVariant = (['one', 'drag', 'one', 'both'] as const)[(fumbleSeen - 1) % 4]!;
            pose = facepalm(reduced ? FUMBLE_LENGTH : age, { length: FUMBLE_LENGTH, glance: fumbleFrom, visitor: boardToRoot(VISITOR_BOARD, stoolB), from: entry, variant });
            if (age >= FUMBLE_LENGTH) enter('idle', t, true);
            break;
          }
          default: {
            if (prep.length && t > 1 && !reduced) prep.shift()!();
            // idle: the rest (side-on, face to the visitor) or at work by a jack; the head follows the action, slowly
            const base = resolvePose(restPose(stoolB));
            let target: V3 | null = null;
            const bv = w.button();
            if (bv.cover === 'fitting') {
              const rv = w.machine('revert');
              if (rv && rv.kind === 'revert') target = seatSpace([rv.x, 0.6, rv.z]);
            }
            if (!target && frame.pointer && frame.hovered && frame.hovered !== 'patch') {
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
        // the cover is on: one nod (idle only; a nod is a small dip of the head and back)
        const cv0 = w.button().cover;
        if (cv0 !== coverWas) {
          if (coverWas === 'fitting' && cv0 === 'shut') nodAt = t;
          coverWas = cv0;
        }
        if (nodAt >= 0 && !reduced) {
          const k = (t - nodAt) / 0.7;
          if (k >= 1 || mode !== 'idle') nodAt = -1;
          else pose = { ...pose, headPitch: (pose.headPitch ?? 0) - 0.22 * Math.sin(Math.PI * k) * (k < 0.5 ? 1 : 0.8) };
        }
        // busy when Fetch fumbled: a quick glance at the crash and a small shake of the head, and on with the job
        if (fumbleAt < -1 && !reduced) {
          const g0 = -fumbleAt - 1;
          const k = (t - g0) / 0.9;
          if (k >= 1) fumbleAt = -1;
          else pose = glanceShake(pose, k, fumbleFrom);
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
        // R4: thrown off the bench, it is out of sight until it comes back up the chute
        root.visible = mode !== 'away';
        if (mode === 'held') root.position.set(v.at[0], v.at[1], v.at[2]);
        else root.position.set(seat.x + dx, seat.y, seat.z);
        root.updateMatrixWorld(true);
        rootInv.copy(root.matrixWorld).invert();
        apply(pose);
        // a caught part is drawn in the paw: through the parts view's overlay when it draws after this view (its
        // shadow goes with it), or straight onto its matrix when it has drawn already this frame
        inPaw.frame = null;
        if (mode === 'catch' && v.holding && caught && !reduced) {
          pawW.set(caught[0], caught[1], caught[2]).applyMatrix4(root.matrixWorld);
          inPaw.id = v.holding;
          inPaw.frame = frame;
          inPaw.x = pawW.x;
          inPaw.y = pawW.y;
          inPaw.z = pawW.z;
          if (partsFrame === frame) {
            if (v.holding !== heldId) {
              heldId = v.holding;
              heldObj = ctx.scene.getObjectByName(`part:${v.holding}`) ?? null;
            }
            if (heldObj) {
              const e = heldObj.matrix.elements;
              e[12] = pawW.x;
              e[13] = pawW.y;
              e[14] = pawW.z;
              heldObj.matrixWorldNeedsUpdate = true;
            }
          }
        }
        if (mode === 'plug' && st === 'plug') {
          const p = plugMove ? movePlug(sT, plugMove.from, plugMove.to, stoolB, entry).paw : null;
          if (p) {
            pawW.set(p[0], p[1], p[2]).applyMatrix4(root.matrixWorld);
            bus.paw = { x: pawW.x, y: pawW.y, z: pawW.z, u: finite ? clamp01(v.stateTime / v.stateLength) : 1 };
          } else bus.paw = null;
        } else bus.paw = null;

        // ── the drawer of the jack in hand follows the paw; any other closes ──
        for (const j of JACKS) {
          const want = j === jobJack && (mode === 'job' || mode === 'shut' || (mode === 'rung' && (rungSaved?.mode === 'job' || rungSaved?.mode === 'shut'))) ? drawer : 0;
          drawers[j] = reduced ? want : want > drawers[j] ? want : damp(drawers[j], want, 8, dt);
        }
        const sum = drawers.storefront * 1 + drawers.platen * 3 + drawers.belt * 9 + drawers.lamp * 27;
        if (bus.board && sum !== drawerShown) {
          poseSwitchboard(bus.board, { drawers });
          drawerShown = sum;
        }
      },
      dispose() {
        unhook(hooks.overlays, overlay);
        root.removeFromParent();
        stool.removeFromParent();
      },
    };
  };
}
