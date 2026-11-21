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
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { nodeBounds } from './proxy.ts';
import { clearOfEdge, figureOf, grounded, type Figure } from '../kit/pieces/patch-felt/ground.ts';
import type { PatchState, PatchView, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import { placedMatrix } from './set.ts';
import { HZ, PATCH_TUNING } from '../../sim/index.ts';
import { poseMatrices, SIDE_ON, type PatchPose } from '../kit/pieces/patch-felt/index.ts';
import { SCRUFF as SCRUFF_AT, setNode } from '../kit/pieces/patch-felt/rig.ts';
import { CORE, dirIntoBody, flung, gettingUp, intoBody, offsetOf, offsetSize, placeOf, placed, withOffset, type Offset, type Place } from '../kit/pieces/patch-felt/embodied.ts';
import {
  BONK_LENGTH, CATCH_LENGTH, CLIMB_LENGTH, DUCK_LENGTH, JOB_STAGES, LOOK_LENGTH, NOTICE_LENGTH, REST_X, SEATED, SHUT_LENGTH, VISITOR_BOARD,
  atWork, blendTo, boardToRoot, bonked, catchCrate, climb, duck, held, job, jobTargets, lookAt, movePlug, notice, resolvePose,
  rollTo, theLook, toPose, toddle, withBlinks, withBreath, type JobStage, type JobTargets, type V3,
  rungReaction, facepalm, glanceShake, type FacepalmVariant, overTheEdge, type LedgeOptions, crossBelt, tumble, landed, shakeOff, splat, falling, upward, flop, LAND_LENGTH, SHAKE_LENGTH,
  atTheTop, blendSpan, bodyMiddle, wrapAngle, mixPose, type BlendOptions,
} from '../kit/pieces/patch-felt/perform.ts';
import { BOARD_WHOLE, JACKS, poseSwitchboard, type JackName } from '../kit/pieces/switchboard/index.ts';
import { clamp01, damp, inOutCubic, inOutQuad, outCubic, smoothstep } from '../anim/index.ts';
import { jackName, patchlampBus } from './patchlamp-bus.ts';
import { partsHooks, unhook, type PartsOverlay } from './parts.ts';

/** Tune here: seconds, rates in 1/s. */
export const OPERATOR_FEEL = {
  /** Blends between performances: from a pose the next one starts from, and from anywhere else. */
  blendNear: 0.18,
  blendFar: 0.35,
  /** A thrown part: no time to ease into it. */
  blendReact: 0.07,
  /**
   * R5: let go (or thrown): the turn and the limbs ease out of the dangle over this long; the body's middle is where
   * the simulation has it from the first frame (never held back at the hand).
   */
  blendRelease: 0.18,
  /** R5: come down from the air: from the tumble into the landing's bounce (the middle eased down onto the bench). */
  blendLand: 0.12,
  /** R5: the slowest a turn between performances may be done at (rad/s): a big turn gets a longer blend, so it reads as a turn. */
  turnRate: 7,
  turnRateMoving: 14,
  /** R4 up: how fast the arms fold at the top of a throw up and unfold after (1/s). */
  foldRate: 14,
  /** R5: in the air, how fast its facing follows the way it is going (1/s): a rebound turns it round, not flips it. */
  flyTurn: 10,
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
  /** R5: the fastest it turns while walking (rad/s): a way that doubles back takes about a quarter of a second. */
  walkTurnMax: 12,

  // ── the body Patch (PatchSpec.flight 'body'): drawn from its physics body from the grab to the get-up ──
  /**
   * A takeover starts from the pose the figure was drawn in, and what it is off by is let go of over this long:
   * taken hold of where the script had it (the body comes into the world about there);
   */
  bodyGrab: 0.15,
  /** met a wall flat: from the pose its body had at the hit to flat against it (a few frames; the scripted splat cut there in one); */
  bodyFlatten: 0.1,
  /** caught the edge: from where its body was to the hang (the simulation's own ease there); */
  bodyCatch: 0.2,
  /** come to rest, the script taking over how it lay; and sat at the wall's foot after the slide. */
  bodySettle: 0.08,
  bodySit: 0.18,
  /** Its velocity is smoothed at this rate (1/s), and its limbs take up a change in the way it goes at this one (follow-through). */
  velRate: 18,
  trailRate: 12,
  /** At this speed (units/s) its limbs trail all they can; turning this fast (rad/s) they fly out all they can. */
  trailFull: 9,
  spinFull: 12,
  /** In the air it stretches along its way by up to this much, between these speeds; eased in and out at `stretchRate`. */
  stretch: 0.1,
  stretchFrom: 5,
  stretchFull: 14,
  stretchRate: 16,
  /**
   * The squash on a contact: this much per unit/s of speed the contact took over `squashFloor`, never more than
   * `squashMax`; a spring (rad/s, damping) so it is over in a fifth of a second and never held.
   */
  squashFloor: 1.2,
  squashGain: 0.03,
  squashMax: 0.28,
  squashRate: 38,
  squashDamp: 0.45,
  /** The squash as its hop lands. */
  hopSquash: 0.2,
};
/** R2: the walk's first seconds: a look at the visitor and a turn, no step (the simulation's). */
const SET_OFF: number = PATCH_TUNING.setOff;
/**
 * R5: the states in which the simulation moves `at` continuously from step to step: Patch is drawn between the last
 * two steps there (`Frame.alpha`), as the parts are. Never across a jump (`PatchView.prevAt` is `at` then).
 */
const MOVING: ReadonlySet<PatchState> = new Set<PatchState>(['held', 'fly', 'land', 'walk', 'cross', 'climb', 'haul', 'wall']);

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
        if (x) setNode(x, ms[n]!, n === 'body' && !!p.body?.squash);
      }
    };
    // the grab target rides Patch's drawn body (the rig's `body` node, everything else hangs from it), not the
    // root, which stays on the seat while Patch flies, lands, walks home (R4: Taylor, "his 'grab' box stays on his
    // stool"); measured once, at its rest pose. No target where the simulation refuses the grab
    // (hanging from the edge, hauling itself up, out of sight after going over the edge)
    const bodyNode = nodes.get('body') ?? obj;
    // the figure's points by node, for keeping every drawn part above the bench (ground.ts)
    const figure: Figure | null = piece ? figureOf(piece) : null;
    let floorBox = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
    /** Is this root-space point over the bench (only those points are kept above its top)? */
    const overBench = (x: number, z: number): boolean => {
      const me = root.matrixWorld.elements;
      const wx = me[0]! * x + me[8]! * z + me[12]!, wz = me[2]! * x + me[10]! * z + me[14]!;
      return wx >= floorBox.minX && wx <= floorBox.maxX && wz >= floorBox.minZ && wz <= floorBox.maxZ;
    };
    let grabbable = true;
    // (the felt is skinned: its meshes hang from the piece, not the bone, so the box is the body node's own parts
    // and its children's, measured in its frame, as proxy.ts does for any skinned node)
    if (ctx.pickable) {
      const box = piece ? nodeBounds(piece, 'body') : null;
      if (box && !box.isEmpty()) ctx.pickable('patch', bodyNode, { box, active: () => grabbable });
      else ctx.pickable('patch', root, { active: () => grabbable });
    }
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
    /**
     * R5: a blend begins at the frame BEFORE the one it is first drawn in (`blendFrom` is that frame's pose), so its
     * first frame is already a step on from it: never a frame held still on the pose it leaves. `blendNew` marks the
     * frame it was begun in (the root's move between seat and hand is accounted for then).
     */
    let blendNew = false;
    let frameDt = 0;
    let blendDur = 0;
    let blendOpts: BlendOptions = {};
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
    /** R4 up: when the fall began (frame time; the top of a throw up, or the release of a drop). */
    let fallAt = -1;
    let flyYaw = 0;
    /** R5 up: the fold at the top of a throw up (0..1, eased) and when it began (frame time; -1 before). */
    let foldK = 0;
    let floatAt = -1;
    /** R5: the tumble's own time when it came down (the landing's flail goes on from there). */
    let landAirT = 0.3;
    /** R5: where the simulation had Patch in the last frame drawn (between steps), and in which performance. */
    let lastAtI: Vec3 | null = null;
    let lastMode: Mode = 'idle';
    /** R5: the body's middle as last drawn (world; after the lift clear of the bench), where a release starts from. */
    const drawnMid = new Vector3();
    let drawnMidSet = false;
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

    // ── the body Patch (PatchSpec.flight 'body'): its figure's body is its physics body from the grab to the get-up ──
    const qSide = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -SIDE_ON);
    const qT = new Quaternion(), qU = new Quaternion();
    /** The body as last drawn (seat space, after the lift clear of the bench), and whether it was in sight. */
    let drawnPlace: Place | null = null;
    let drawnShown = false;
    /** What the placement was taken from in the last frame ('p': the engine; else the performance's name), and what is being let go of. */
    let lastSrc: string | null = null;
    let off: { o: Offset; at: number; dur: number } | null = null;
    /** Its velocity, smoothed (world, units/s); its last few steps' own (newest last); how fast it turns (rad/s, smoothed). */
    const bVel = new Vector3();
    const bSteps: { pose: object; v: Vector3 }[] = [];
    let bSpin = 0;
    /** The way its limbs trail (its own frame; length 0..1). */
    const trail: V3 = [0, 0, 0];
    /** The squash spring (+ squashed), its rate, its axis (root space); the stretch along its way. */
    let sq = 0, sqV = 0;
    const sqN = new Vector3(0, 1, 0);
    let stK = 0;
    /** Since it was let go: has it met anything (its arms do not fold after), and how far the fall's pose has given way to the tumble's. */
    let hitSince = false;
    let hitK = 0;
    /** How it lay when the simulation took over (as drawn), and whether its get-up has hopped. */
    let lie: { place: Place; limbs: PatchPose } | null = null;
    let hopped = false;

    const enter = (m: Mode, t: number, near: boolean): void => {
      if (mode !== m || m === 'job') {
        blendFrom = last;
        blendAt = t - frameDt;
        blendNew = true;
        blendDur = near ? F.blendNear : F.blendFar;
        blendOpts = {};
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
        frameDt = dt;
        const st = v.state;
        // natural speed: a performance's time is the stage's own; reduced motion holds each stage's end pose
        const finite = Number.isFinite(v.stateLength) && v.stateLength > 0;
        // (R5: drawn between the last two steps, as everything else on the bench is: the stage's time a step behind
        // by 1 - alpha, as the frame's own time is; and where it is, where `at` moves continuously)
        const lagT = (1 - frame.alpha) / HZ;
        const sT = reduced && finite ? v.stateLength : finite ? Math.min(Math.max(0, v.stateTime - lagT), v.stateLength) : Math.max(0, v.stateTime - lagT);
        const between = !reduced && frame.alpha < 1 && v.prevAt !== v.at && MOVING.has(v.state);
        const al = frame.alpha;
        const atI: Vec3 = between ? [v.prevAt[0] + (v.at[0] - v.prevAt[0]) * al, v.prevAt[1] + (v.at[1] - v.prevAt[1]) * al, v.prevAt[2] + (v.at[2] - v.prevAt[2]) * al] : v.at;
        const cord = w.cord('cord');
        const plugOut = !!cord?.lifted;
        // the body Patch (`PatchView.body` is there, null while the script has it): drawn from its body while it is in the world
        const bodied = v.body !== undefined;
        const bd = v.body ?? null;

        // ── a Button rung: the crew is the audience; the job resumes where the simulation left it ──
        if (w.bracketed && !rungSaved && mode !== 'held' && mode !== 'ledge' && !bd) {
          rungSaved = { mode, entry, at: t };
          rungDrawer = drawer;
          enter('rung', t, true);
        } else if (!w.bracketed && rungSaved) {
          const sv = rungSaved;
          rungSaved = null;
          blendFrom = last;
          blendAt = t - frameDt;
          blendNew = true;
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
          // (the body Patch's hop has landed: the squash of it, over the first frames of what comes next)
          if (prev === 'land' && bodied && hopped && !reduced) {
            sqN.set(0, 1, 0);
            sqV = Math.max(sqV, F.hopSquash * F.squashRate);
            hopped = false;
          }
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
                walkYaw = wrapAngle(resolvePose(last).body.rot[1]);
                glanced = 0;
              }
              enter('walk', t, prev === 'cross');
              break;
            }
            case 'cross':
              enter('cross', t, true);
              break;
            case 'fly': {
              // R4: thrown (or back up the chute): from the hand into the air at once
              const v0 = v.thrown?.v;
              const level = v0 ? Math.hypot(v0[0], v0[2]) : 0;
              if (prev !== 'fly') {
                flySpin = 0;
                flyAt = t;
                fallAt = -1;
                foldK = 0;
                floatAt = -1;
                hitSince = false;
                hitK = 0;
                // facing the way it goes; dropped or thrown up, the way it faced in the hand
                flyYaw = v0 && level > 0.3 && !v.thrown?.drop ? Math.atan2(v0[0], v0[2]) - SIDE_ON : wrapAngle(resolvePose(last).body.rot[1]);
              }
              enter('fly', t, false);
              // (R5: its middle leaves the hand in the first frame, where the simulation has it; the turn and the
              // limbs ease out of the dangle. Up the chute from out of sight it simply appears there)
              blendDur = F.blendRelease;
              blendOpts = { bodyLag: 0, keepMiddle: true, moving: true };
              if (bodied) blendOpts = { bodyLag: 0, moving: true }; // (its body is the engine's: only the limbs ease)
              if (prev === 'away') blendFrom = null;
              break;
            }
            case 'land':
              if (bodied && v.lay) {
                // the body Patch: the get-up from how it lay, from the pose it was drawn in (its own performance)
                lie = { place: drawnPlace ?? placeOf(last.body), limbs: last };
                hopped = false;
                enter('land', t, true);
                blendFrom = null;
                break;
              }
              // off a wall: the facing it had stuck to the wall (face to the room) is kept to the sit
              landFromWall = prev === 'wall';
              if (!landFromWall) {
                landSpin = flySpin;
                landYaw = flyYaw;
                landAirT = t - flyAt;
              }
              enter('land', t, true);
              // (R5: down from the air, eased over a few frames onto the landing's bounce, the limbs flailing on from
              // where they were; off a wall, from the bottom of the slide, the same facing, eased the same way)
              if (prev === 'fly' || prev === 'wall') {
                blendDur = F.blendLand;
                blendOpts = { bodyLag: 0, moving: true };
              } else blendFrom = null;
              break;
            case 'shake':
              // (R5: the sit the landing ends in is the shake's start: the near blend takes up the face's change)
              enter('shake', t, true);
              break;
            case 'away':
              enter('away', t, true);
              blendFrom = null;
              break;
            case 'wall':
              // flat against it at once, face to the room (no blend: a blend from the tumble shows its back)
              enter('wall', t, true);
              // (the body Patch flattens against it from the pose its body had, over a few frames: below)
              if (!bodied) blendFrom = null;
              else {
                blendDur = F.bodyFlatten;
                blendOpts = { bodyLag: 0, moving: true };
              }
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
                // from the hand to the edge in one frame: it caught it (the body Patch: from where its body was, below)
                if (!bodied) blendFrom = null;
                else {
                  blendDur = F.bodyCatch;
                  blendOpts = { bodyLag: 0, moving: true };
                }
              }
              break;
            case 'climb':
              // from its feet at the stool's foot (where the walk ended, or where it was put down)
              climbFoot = seatSpace(v.foot);
              enter('climb', t, prev === 'walk');
              // (R5: the turn to face the stool the short way (the blend), and never faster than `turnRate`)
              if (blendFrom) {
                const dYaw = Math.abs(wrapAngle(resolvePose(climb(0, { foot: climbFoot, visitor: boardToRoot(VISITOR_BOARD, stoolB) })).body.rot[1] - resolvePose(last).body.rot[1]));
                blendDur = Math.max(blendDur, dYaw / F.turnRate);
              }
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
        // ── the body Patch: where the engine has its body (seat space, between its last two steps), how it moves,
        // the visitor's point in its own frame, and the way its limbs trail ──
        let phys: Place | null = null;
        let visL: V3 = boardToRoot(VISITOR_BOARD, stoolB);
        let getUp: { place: Place; squash: number } | null = null;
        const inBody = bodied && (mode === 'held' || mode === 'fly' || mode === 'wall' || mode === 'ledge' || (mode === 'land' && !!v.lay));
        if (bodied) {
          const cS = Math.cos(-SIDE_ON), sS = Math.sin(-SIDE_ON);
          if (bd) {
            const k = reduced || bd.prev === bd.pose ? 1 : al;
            const p0 = bd.prev.p, p1 = bd.pose.p;
            qT.set(bd.prev.q[0], bd.prev.q[1], bd.prev.q[2], bd.prev.q[3]);
            qU.set(bd.pose.q[0], bd.pose.q[1], bd.pose.q[2], bd.pose.q[3]);
            const turn = 2 * Math.acos(Math.min(1, Math.abs(qU.dot(qT))));
            qT.slerp(qU, k).premultiply(qSide);
            phys = { mid: seatSpace([p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k]), q: [qT.x, qT.y, qT.z, qT.w] };
            // (its velocity from its own steps: a new step, a new sample)
            if (bSteps.length === 0 || bSteps[bSteps.length - 1]!.pose !== bd.pose) {
              const fresh = bSteps.length === 0;
              bSteps.push({ pose: bd.pose, v: new Vector3((p1[0] - p0[0]) * HZ, (p1[1] - p0[1]) * HZ, (p1[2] - p0[2]) * HZ) });
              if (bSteps.length > 4) bSteps.shift();
              if (fresh) {
                bVel.copy(bSteps[0]!.v);
                bSpin = turn * HZ;
              }
            }
            const raw = bSteps[bSteps.length - 1]!.v;
            bVel.x = damp(bVel.x, raw.x, F.velRate, dt);
            bVel.y = damp(bVel.y, raw.y, F.velRate, dt);
            bVel.z = damp(bVel.z, raw.z, F.velRate, dt);
            bSpin = damp(bSpin, turn * HZ, F.velRate, dt);
          } else {
            bSteps.length = 0;
            bVel.multiplyScalar(Math.exp(-F.velRate * dt));
            bSpin = damp(bSpin, 0, F.velRate, dt);
          }
          const frameOf = phys ?? drawnPlace;
          if (frameOf) {
            visL = intoBody(frameOf, visL);
            // against its velocity, in its own frame; as long as its speed makes it
            const sp = bVel.length();
            const kk = sp > 1e-3 ? -smoothstep(0.4, F.trailFull, sp) / sp : 0;
            const d = dirIntoBody(frameOf, [(bVel.x * cS + bVel.z * sS) * kk, bVel.y * kk, (-bVel.x * sS + bVel.z * cS) * kk]);
            for (let i = 0; i < 3; i++) trail[i] = reduced ? d[i]! : damp(trail[i]!, d[i]!, F.trailRate, dt);
          }
          // a contact: the squash of it, along what the contact took of its velocity (its last few steps: the engine
          // may stop a fast body short a step before it turns it)
          if (bd && !reduced) {
            for (const e of frame.events) {
              if (e.type !== 'part.hit' || (e.id !== bd.id && e.other !== bd.id) || bSteps.length < 2) continue;
              if (mode === 'fly') hitSince = true;
              tv.subVectors(bSteps[0]!.v, bSteps[bSteps.length - 1]!.v);
              const took = tv.length();
              if (took <= F.squashFloor) continue;
              const amount = Math.min(F.squashMax, (took - F.squashFloor) * F.squashGain);
              if (amount * F.squashRate > sqV) {
                sqV = amount * F.squashRate;
                sqN.set(tv.x * cS + tv.z * sS, tv.y, -tv.x * sS + tv.z * cS).normalize();
              }
            }
          }
          hitK = reduced ? (hitSince ? 1 : 0) : damp(hitK, hitSince ? 1 : 0, 10, dt);
          // (the spring, in steps small enough to hold it steady at any frame rate)
          for (let i = 0, n = Math.max(1, Math.ceil(dt / 0.004)); i < n && !reduced; i++) {
            const h = dt / n, W = F.squashRate;
            sqV += (-W * W * sq - 2 * F.squashDamp * W * sqV) * h;
            sq += sqV * h;
          }
          if (reduced) sq = sqV = 0;
        }
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
            if (bodied) {
              // the body Patch: its body is the engine's (hanging by its scruff, swinging as the body swings); the
              // dangle's limbs are posed in its own frame, trailing its own motion
              const frameOf = phys ?? drawnPlace;
              const cS = Math.cos(-SIDE_ON), sS = Math.sin(-SIDE_ON);
              const vl: V3 = frameOf ? dirIntoBody(frameOf, [(bVel.x * cS + bVel.z * sS) / S, bVel.y / S, (-bVel.x * sS + bVel.z * cS) / S]) : [0, 0, 0];
              pose = held(reduced ? 3 : age, reduced ? [0, 0, 0] : vl, { visitor: visL, yaw: 0 });
              break;
            }
            // the root goes to the visitor's hand; the scruff hangs from it
            const hand = new Vector3(atI[0], atI[1], atI[2]);
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
            const feet = seatSpace(atI);
            if (walkPrev) walked += Math.hypot(feet[0] - walkPrev[0], feet[2] - walkPrev[2]);
            walkPrev = feet;
            // the body turns to its way (before the first step, and at each corner), stepping round as it turns
            const want = v.heading - SIDE_ON;
            const dYaw = Math.atan2(Math.sin(want - walkYaw), Math.cos(want - walkYaw));
            // (R5: and never faster than `walkTurnMax`: a way that doubles back is a turn, not a flip)
            const turn = reduced ? dYaw : Math.sign(dYaw) * Math.min(Math.abs(dYaw) * (1 - Math.exp(-F.walkTurn * dt)), F.walkTurnMax * dt);
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
              const ground = seatSpace([atI[0], v.foot[1], atI[2]])[1];
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
            if (bodied) {
              // the body Patch: its body is the engine's (below). In its own frame: thrown across, the limbs flung out
              // and trailing the way it goes; let go still or thrown up, rising arms up and falling knowing it, until
              // it meets something (then the tumble's, down to lying where it stops); the float's fold over either
              const own: V3 = [0, 0.3, 0]; // (the performances' own middle: the body at rest at the origin)
              const tA = reduced ? 0 : t - flyAt;
              const vy = v.thrown?.v ? v.thrown.v[1] : 0;
              let p = flung({ t: tA, trail, spin: clamp01(bSpin / F.spinFull) });
              const goal = hitSince || !v.thrown ? 0 : v.thrown.float * (vy >= 0 ? 1 - smoothstep(0.6, 3, vy) : 1 - smoothstep(0.3, 1.8, -vy));
              foldK = reduced ? goal : damp(foldK, goal, F.foldRate, dt);
              if (foldK > 0.02 && floatAt < 0) floatAt = t;
              if (vy > 0 || foldK > 0.5) fallAt = -1;
              else if (fallAt < 0) fallAt = t;
              if (v.thrown?.drop && hitK < 0.999) {
                const up = resolvePose(upward(tA, own, 0, false, visL)), down = resolvePose(falling(reduced ? 1 : fallAt < 0 ? 0 : t - fallAt, own, 0, visL));
                p = toPose(mixPose(mixPose(up, down, smoothstep(-1.2, 1.2, -vy)), resolvePose(p), hitK));
              }
              pose = foldK > 1e-3 ? atTheTop(p, foldK, reduced || floatAt < 0 ? 0 : t - floatAt, own, 0, visL) : p;
              break;
            }
            const tv = v.thrown?.v;
            const sp = tv ? Math.hypot(tv[0], tv[2]) : 0;
            const mid = seatSpace(atI);
            if (v.thrown?.drop) {
              // R4 up: dropped, or thrown up: rising (arms up), the float at the top (arms folded: R5, eased in from a
              // little before the top and out a little after, as much as this throw floats), then falling and knowing it
              const vis = boardToRoot(VISITOR_BOARD, stoolB);
              const vy = tv ? tv[1] : 0;
              const goal = (v.thrown.float ?? 0) * (vy >= 0 ? 1 - smoothstep(0.6, 3, vy) : 1 - smoothstep(0.3, 1.8, -vy));
              foldK = reduced ? goal : damp(foldK, goal, F.foldRate, dt);
              if (foldK > 0.02 && floatAt < 0) floatAt = t;
              const rising = vy > 0;
              if (rising || foldK > 0.5) fallAt = -1;
              else if (fallAt < 0) fallAt = t;
              const base = rising ? upward(reduced ? 0 : t - flyAt, mid, flyYaw, false, vis) : falling(reduced ? 1 : fallAt < 0 ? 0 : t - fallAt, mid, flyYaw, vis);
              pose = foldK > 1e-3 ? atTheTop(base, foldK, reduced || floatAt < 0 ? 0 : t - floatAt, mid, flyYaw, vis) : base;
              break;
            }
            // turning head over heels as it goes, faster the harder it was thrown; facing the way it goes (R5: turned
            // toward it, so a rebound brings it round rather than flipping it in a frame)
            if (tv && sp > 0.3) {
              const want = Math.atan2(tv[0], tv[2]) - SIDE_ON;
              // (unwrapped: continuous, so a blend toward it never sees it jump a turn)
              flyYaw += reduced ? wrapAngle(want - flyYaw) : wrapAngle(want - flyYaw) * (1 - Math.exp(-F.flyTurn * dt));
            }
            if (!reduced) flySpin += Math.min(11, Math.max(4, sp * 1.3)) * dt;
            pose = tumble(reduced ? 0 : t - flyAt, mid, flySpin, flyYaw);
            break;
          }
          case 'land': {
            if (bodied && v.lay && lie) {
              // the body Patch: from how it lay into sitting up over the simulation's `rise`, then its hop
              landYaw = v.heading - SIDE_ON;
              const g = gettingUp(reduced ? v.stateLength : sT, { lie: lie.place, limbs: lie.limbs, rise: v.lay.rise, from: seatSpace(v.lay.from), to: seatSpace(v.lay.to), feet: seatSpace(atI), length: v.stateLength, yaw: landYaw, visitor: boardToRoot(VISITOR_BOARD, stoolB) });
              pose = g.pose;
              getUp = g;
              if (sT > v.lay.rise && v.stateLength - v.lay.rise > 1e-3) hopped = true;
              break;
            }
            const fall = v.thrown?.fall ?? 0;
            // R4 up: down from high after a drop or a throw up: the flop; else the landing's bounce and roll
            if (v.thrown?.drop && fall >= PATCH_TUNING.flopFrom) pose = flop(reduced ? v.stateLength : sT, seatSpace(atI), landYaw, fall, v.stateLength);
            else pose = landed(reduced ? LAND_LENGTH : sT, seatSpace(atI), landYaw, reduced || landFromWall || v.thrown?.drop ? 0 : landSpin, v.thrown?.speed ?? 0, landFromWall, landAirT);
            break;
          }
          case 'shake':
            pose = shakeOff(reduced ? v.stateLength : sT, seatSpace(v.at), landYaw, { visitor: boardToRoot(VISITOR_BOARD, stoolB), fall: v.thrown?.fall ?? 0, dust: !!v.thrown?.drop, length: v.stateLength });
            break;
          case 'away':
            pose = last;
            break;
          case 'wall':
            pose = splat(reduced ? 1 : Math.max(0, v.stateTime - lagT), seatSpace(atI), landYaw, v.wall?.stick ?? 0.25);
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
        // (the root moves between the seat and the hand when Patch is taken or let go: a blend begun this frame
        // starts from where the figure was drawn, not from the same place relative to the root's new spot: no snap)
        if (blendFrom && blendNew) {
          blendNew = false;
          const next = mode === 'held' && !bodied ? tv.set(atI[0], atI[1], atI[2]) : tv.set(seat.x + (stoolB - REST_X), seat.y, seat.z);
          const dxw = root.position.x - next.x, dyw = root.position.y - next.y, dzw = root.position.z - next.z;
          if (Math.abs(dxw) + Math.abs(dyw) + Math.abs(dzw) > 1e-6) {
            const c = Math.cos(-SIDE_ON), sn = Math.sin(-SIDE_ON);
            const b = blendFrom.body ?? {};
            const at0 = b.at ?? (b.pivot === 'scruff' ? SCRUFF_AT : ([0, 0, 0] as const));
            blendFrom = { ...blendFrom, body: { ...b, at: [at0[0] + (dxw * c + dzw * sn) / S, at0[1] + dyw / S, at0[2] + (-dxw * sn + dzw * c) / S] } };
          }
          // (R5: the pose it leaves brought within half a turn of where this one starts, once: the blend turns the short
          // way, and goes on turning with the target however far the target turns)
          {
            const fa = resolvePose(blendFrom), ta = resolvePose(pose).body.rot;
            fa.body.rot = [ta[0] + wrapAngle(fa.body.rot[0] - ta[0]), ta[1] + wrapAngle(fa.body.rot[1] - ta[1]), ta[2] + wrapAngle(fa.body.rot[2] - ta[2])];
            blendFrom = toPose(fa);
            // (and a big turn gets the time to read as a turn: never faster than `turnRate` on average, nor, out of a
            // moving pose (eased out, quickest at its start), than `turnRateMoving` at its start)
            const turn = Math.max(Math.abs(fa.body.rot[0] - ta[0]), Math.abs(fa.body.rot[1] - ta[1]), Math.abs(fa.body.rot[2] - ta[2]));
            // (not the body Patch's while its body is the engine's: only its limbs blend, and its body's turn is its own)
            if (!inBody) blendDur = Math.max(blendDur, blendOpts.moving ? (2 * turn) / F.turnRateMoving : turn / F.turnRate);
          }
          // (R5, let go: how far the drawn middle was from the simulation's, carried and let go of over the blend)
          if (blendOpts.keepMiddle) {
            // (against where the simulation had its middle in the last frame (under the hand), so this frame already
            // moves on by as much as the simulation did)
            const m0 = drawnMidSet ? seatSpace([drawnMid.x, drawnMid.y, drawnMid.z]) : bodyMiddle(blendFrom);
            const m1 = lastMode === 'held' && lastAtI ? seatSpace([lastAtI[0], lastAtI[1] - PATCH_TUNING.hangBelow, lastAtI[2]]) : bodyMiddle(pose);
            blendOpts = { ...blendOpts, carry: [m0[0] - m1[0], m0[1] - m1[1], m0[2] - m1[2]] };
          }
        }
        // (R5: on until every channel has arrived, the lagging body and tail included: a blend cut at `blendDur`
        // left those short of the pose and they jumped there in the next frame)
        if (blendFrom && !reduced && t - blendAt < blendSpan(blendDur, blendOpts)) pose = blendTo(blendFrom, pose, t - blendAt, blendDur, { ...blendOpts, keepTurns: true });
        else blendFrom = null;
        // ── the body Patch: its body where the engine has it; a takeover starts from the pose it was drawn in ──
        if (bodied) {
          const target: Place | null = phys ?? (getUp ? getUp.place : mode === 'wall' || mode === 'ledge' ? placeOf(pose.body) : null);
          const src = phys ? 'p' : target ? mode : null;
          if (src !== lastSrc) {
            off = null;
            if (target && drawnPlace && drawnShown && !reduced) {
              const o = offsetOf(drawnPlace, target);
              const size = offsetSize(o);
              if (size.far > 1e-4 || size.turn > 1e-3) off = { o, at: t - frameDt, dur: src === 'p' ? F.bodyGrab : mode === 'wall' ? F.bodyFlatten : mode === 'ledge' ? F.bodyCatch : lastSrc === 'wall' ? F.bodySit : F.bodySettle };
            }
            lastSrc = src;
          }
          // the stretch along its way in the air (eased; none while a contact's squash is on)
          const sp = bVel.length();
          const stGoal = phys && bd && !bd.held && Math.abs(sq) < 0.01 ? F.stretch * smoothstep(F.stretchFrom, F.stretchFull, sp) : 0;
          stK = reduced ? 0 : damp(stK, stGoal, F.stretchRate, dt);
          if (target) {
            let place = target;
            if (off) {
              const u = (t - off.at) / off.dur;
              // (out of a moving pose: it lets go at once and eases in)
              if (u >= 1) off = null;
              else place = withOffset(target, off.o, 1 - outCubic(clamp01(u)));
            }
            let squash: NonNullable<PatchPose['body']>['squash'];
            if (Math.abs(sq) > 0.004) squash = { along: [sqN.x, sqN.y, sqN.z], by: 1 - sq, about: place.mid };
            else if (getUp && Math.abs(getUp.squash - 1) > 0.004) squash = { along: [0, 1, 0], by: getUp.squash, about: [place.mid[0], place.mid[1] - CORE, place.mid[2]] };
            else if (stK > 0.004 && sp > 1e-3) {
              const cS = Math.cos(-SIDE_ON), sS = Math.sin(-SIDE_ON);
              squash = { along: [(bVel.x * cS + bVel.z * sS) / sp, bVel.y / sp, (-bVel.x * sS + bVel.z * cS) / sp], by: 1 + stK, about: place.mid };
            }
            pose = { ...pose, body: placed(place, squash) };
            // the tail streams behind it (not folded at the top of a throw up, where it swishes; less in the hand)
            const tl = Math.hypot(trail[0], trail[1], trail[2]);
            const tw = smoothstep(0.08, 0.45, tl) * (1 - foldK) * (bd?.held ? 0.6 : 1) * (phys ? 1 : 0);
            if (tw > 0.01) pose.stream = { dir: [trail[0] / tl, trail[1] / tl, trail[2] / tl], w: tw };
          } else if (Math.abs(sq) > 0.004) {
            // (the last of a squash over the script's own pose: the hop's landing, about its seat)
            const b = pose.body ?? {};
            const at0 = b.at ?? (b.pivot === 'scruff' ? SCRUFF_AT : ([0, 0, 0] as const));
            pose = { ...pose, body: { ...b, squash: { along: [sqN.x, sqN.y, sqN.z], by: 1 - sq, about: [at0[0], at0[1], at0[2]] } } };
          }
        }
        last = pose;
        lastAtI = atI;
        lastMode = mode;
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
        // (the body Patch can be taken hold of on the ledge too: its simulation gives it a body there)
        grabbable = bodied ? st !== 'away' : st !== 'ledge' && st !== 'haul' && st !== 'away';
        if (mode === 'held' && !bodied) root.position.set(atI[0], atI[1], atI[2]);
        else root.position.set(seat.x + dx, seat.y, seat.z);
        root.updateMatrixWorld(true);
        rootInv.copy(root.matrixWorld).invert();
        // R4 (Taylor: "Patch often clips through the floor"): no drawn part below the bench's top. The pose is lifted
        // by what the posed figure needs this frame (its lowest point over the bench, from the rig): the landing's
        // roll and bounce turn it about its middle, the wall slide's legs hang below it, a low carry drags it
        if (figure && mode !== 'away') {
          floorBox = w.scene.bench;
          const floor = (w.scene.bench.top - root.position.y) / S;
          // hanging from the edge, its back against the bench's front: moved out from it, not up off the edge
          if (mode === 'ledge' && st === 'ledge' && ledgeO) pose = clearOfEdge(pose, figure, floor, overBench, [-Math.sin(ledgeO.heading), -Math.cos(ledgeO.heading)]);
          else pose = grounded(pose, figure, floor, overBench);
        }
        apply(pose);
        if (bodied) {
          drawnPlace = placeOf(pose.body);
          drawnShown = root.visible;
        }
        {
          const m = bodyMiddle(pose);
          drawnMid.set(m[0], m[1], m[2]).applyMatrix4(root.matrixWorld);
          drawnMidSet = true;
        }
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
