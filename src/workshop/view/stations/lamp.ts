/**
 * The lamp (REWRITE.md § B4 rung 1 "the lamp dips", § B1, § B2 X1 the LAMP
 * row, § D 14 "the lamp's arm", § A "Light"; W4 brief). The key light is the
 * stage's; this view decides what it does over time, and moves the lamp's
 * body so the light comes out of its shade:
 *
 *  - THE ARM (§ D 14). The simulation's lamp (`LampView`) says where the beam
 *    points (`aim`, world; `home` when a field is missing); the piece's
 *    `aimLamp` lays the arm out for it. The view does not snap there: every
 *    joint is a spring, the outer ones (wrist, pan) looser than the inner,
 *    so a drag pulls the arm round with the shade trailing a little, and a
 *    stop leaves the shade nodding once on its wrist. In the hand the arm is
 *    stiff and well damped; let go, it sags a hair on its springs and
 *    settles (a little overshoot); an undo or a reset swings it home on a
 *    slower spring, the same path backwards. The key light is put at the
 *    DRAWN filament, along the DRAWN shade's axis, every frame the arm
 *    moves, so the pool and every shadow on the bench move with it.
 *  - THE LIGHT: brighter, dimmer, off, on, a colour (§ B2 X1). Level and
 *    on/off settle like a filament (thermal lag: warms quickly, cools a
 *    little slower; switched on, it catches once and comes up); the colour
 *    crosses over in about a third of a second. Never a cut. An undo is the
 *    same settle the other way. Off is night: the stage's rig keeps the
 *    board's lamps, the sign's bulbs and the robots' eyes.
 *  - the dip, on the simulation's `misfire` of the lamp: a brownout that
 *    drops fast, holds, stutters once, and recovers like a filament warming
 *    (one small sag on the way). With reduced motion: a plain dip and
 *    recovery, no stutter;
 *  - the rewind (`rung.rewinding`): the dip plays backwards with the rest
 *    of the world, so the lamp swells back to full exactly as the rewind
 *    lands, with a slow tape-wow on the light while the bench runs
 *    backwards (2.4 a second, 0.15 deep: § B4's "no flashing faster
 *    than three times a second" is kept).
 *
 * Without `arm` (the vignette, the Button's page) the lamp's body is stood
 * so its `bulb` socket is where the key light already is, and never moves.
 *
 * Reduced motion is honoured in one place (`reduced`): the arm cuts to its
 * pose, the light to its level and colour.
 *
 * Every curve runs on `frame.time`. Bulbs everywhere dim with the lamp
 * during a dip (same circuit) when the materials expose the bulb dimmer.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id, LampView as SimLampView, SimEvent, Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import type { Token } from '../palette.ts';
import { palette } from '../palette.ts';
import type { Piece } from '../kit/types.ts';
import { HOME, JOINTS, aimLamp, armFrames, type Joint, type LampPose } from '../kit/pieces/lamp/aim.ts';
import { nodeTransforms } from '../kit/pieces/lamp/pose.ts';
import { Spring, clamp, lerp, smoothstep } from '../anim/index.ts';

/** Tune here. Times in seconds. */
export const LAMP_FEEL = {
  /** Thermal lag of the filament toward a new level: rates (1/s) up and down. */
  warm: 11,
  cool: 7,
  /** The rewind's tape-wow: rate (Hz, under 3) and depth (fraction of the level). */
  wowHz: 2.4,
  wowDepth: 0.15,
  /** Bulbs keep at least this share of their glow at the bottom of a dip. */
  bulbFloor: 0.35,
  /** The light a brightness step gives, × the approved light (the visit starts at step 3 of 5: 1). */
  steps: [0.3, 0.6, 1, 1.3, 1.6] as readonly number[],
  /** The shade's liner and bulb glow (the piece's three lit levels) for each step. */
  glow: [1, 2, 3, 3, 3] as readonly (1 | 2 | 3)[],
  /** Switched on, the filament catches once: as it warms, it sags this deep between these times (s), then comes on. */
  catch: { from: 0.07, to: 0.19, depth: 0.6 },
} as const;

/** How the arm moves (natural frequency rad/s, damping ratio): in the hand, let go, swung home. */
export const ARM_FEEL = {
  /** In the hand: stiff and damped, a weighted lag behind the pointer. */
  drag: { omega: 15, zeta: 0.8 },
  /** Let go: it settles on its springs with a little overshoot. */
  free: { omega: 10, zeta: 0.45 },
  /** Undo or reset: swung home, the same path backwards, unhurried but not slow. */
  home: { omega: 7.5, zeta: 0.62 },
  /** Each joint's spring × these (the shade is loosest: it trails and nods). */
  omega: { swivel: 1, lean: 1, shoulder: 1, elbow: 0.92, wrist: 0.72, pan: 0.66 } as Record<Joint, number>,
  zeta: { swivel: 1, lean: 1, shoulder: 1, elbow: 0.95, wrist: 0.8, pan: 0.8 } as Record<Joint, number>,
  /** On letting go: the arm sags on its springs (rad/s kicked into the shoulder and the elbow) and the shade nods. */
  sag: { shoulder: -0.35, elbow: 0.25, wrist: 0.9 },
  /** Hovered: the shade nods (rad, added to the wrist's tilt and, toward the pointer, its pan). */
  nod: { wrist: -0.035, pan: 0.025 },
  /** A target that jumps this far (lamp units) without a hand on it is an undo or a reset: swing home. */
  jump: 0.05,
  /** Below this joint motion (rad) the arm is at rest and nothing is recomputed. */
  rest: 2e-5,
  /** The key light aims this far down the shade's axis (lamp space, as `lampLight`). */
  reach: 6.7,
} as const;

/** The brownout, as a level multiplier, `t` seconds after the misfire. */
export function dipCurve(t: number, reduced = false): number {
  if (t < 0) return 1;
  const lerp = (a: number, b: number, k: number): number => a + (b - a) * Math.min(1, Math.max(0, k));
  const smooth = (k: number): number => {
    const x = Math.min(1, Math.max(0, k));
    return x * x * (3 - 2 * x);
  };
  if (reduced) {
    if (t < 0.1) return lerp(1, 0.3, smooth(t / 0.1));
    if (t < 0.35) return 0.3;
    if (t < 1.2) return lerp(0.3, 1, smooth((t - 0.35) / 0.85));
    return 1;
  }
  // drop: the filament browns out in three frames
  if (t < 0.05) return lerp(1, 0.14, (t / 0.05) ** 1.5);
  // hold, glowing dull
  if (t < 0.27) return 0.14 + 0.03 * Math.sin((t - 0.05) * 9);
  // one stutter: the supply catches, then sags
  if (t < 0.34) return lerp(0.15, 0.62, smooth((t - 0.27) / 0.07));
  if (t < 0.45) return lerp(0.62, 0.28, smooth((t - 0.34) / 0.11));
  // recovery: a filament warming (fast, then slower), one small sag at 0.8 s
  if (t < 1.35) {
    const k = (t - 0.45) / 0.9;
    const warm = 1 - Math.exp(-k * 4.2);
    const base = lerp(0.28, 1, warm / (1 - Math.exp(-4.2)));
    const sag = t > 0.76 && t < 0.98 ? Math.sin(((t - 0.76) / 0.22) * Math.PI) * 0.16 : 0;
    return Math.min(1, base * (1 - sag));
  }
  return 1;
}

/** Switched on at t = 0: the filament catches once, a multiplier on its warming level (1 before and after). */
export function catchCurve(t: number): number {
  const c = LAMP_FEEL.catch;
  if (t <= c.from || t >= c.to) return 1;
  return 1 - c.depth * Math.sin((Math.PI * (t - c.from)) / (c.to - c.from));
}

export interface LampViewOptions {
  /** The lamp fixture's id (its misfires dip it; its settings drive it). Default 'lamp'. */
  id?: Id;
  /** Look for a `lamp` piece in the kit registry and stand it (default true). */
  body?: boolean;
  /**
   * The lamp with a moving arm (the bench): its piece is clamped with its origin at `place` (world,
   * no yaw), posed from the simulation's aim every frame, and the key light follows its drawn shade.
   */
  arm?: { place: Vec3; seed?: number };
}

export interface LampView extends StationView {
  /** The lamp's level now (0.., 1 = the approved light), after dip and wow. */
  readonly level: number;
  /** Ask for a level (when the simulation does not hold one). The filament eases there. */
  setLevel(level: number): void;
  /** Ask for a colour (a palette token, or null for the lamp's own). */
  setColour(colour: Token | null): void;
  /** Dip now, as a misfire would (dev pages). */
  dip(): void;
}

/** What the boot's materials offer beyond the contract (the bulb dimmer). */
interface Dimmable {
  set?(cls: 'bulb', param: string, value: number): void;
}

export function createLampView(opts: LampViewOptions = {}): (ctx: ViewContext) => LampView {
  return (ctx) => {
    const id = opts.id ?? 'lamp';
    const root = new Group();
    root.name = 'lamp';
    ctx.scene.add(root);
    const lights = ctx.stage.lights;
    // reduced motion (the boot's option, or the world's at run time): honoured here and in the arm, nowhere else
    let reduced = ctx.reducedMotion;

    let asked = 1;
    let askedColour: Token | null = null;
    let base = lights.lampState.level;
    let dipAt = -Infinity;
    let pendingDip = false;
    let rungAt = 0;
    let flinch = 3;
    let rewAt = -Infinity;
    let rewDur = 1.2;
    let level = 1;
    let lastSent = -1;
    let lastColour: Token | null | undefined;
    let lastBulb = -1;
    const dim = ctx.materials as unknown as Dimmable;

    // the light's colour, crossing over (only with the simulation's lamp: the stage's own colour otherwise)
    // on / off: when it was last switched on (the catch), and whether the shade shows lit
    let wasOn: boolean | null = null;
    let onAt = -Infinity;

    // the arm (bench), or the standing body (vignette)
    const arm = opts.arm ? createArm(ctx, root, opts.arm) : null;
    if (!arm && (opts.body ?? true)) void standBody(ctx, root);

    const view: LampView = {
      root,
      get level() {
        return level;
      },
      setLevel(l) {
        asked = Math.max(0, l);
      },
      setColour(c) {
        askedColour = c;
      },
      dip() {
        pendingDip = true;
      },
      update(frame: Frame) {
        const w = frame.world;
        const now = frame.time;
        reduced = ctx.reducedMotion || w.reducedMotion === true;
        if (arm) arm.reduced = reduced;
        if (pendingDip) {
          pendingDip = false;
          dipAt = now;
        }
        for (const e of frame.events) {
          if (e.type === 'misfire' && e.id === id) dipAt = now;
          else if (e.type === 'rung.started') {
            rungAt = now;
            flinch = e.duration;
            rewAt = -Infinity;
          } else if (e.type === 'rung.rewinding') {
            rewAt = now;
            rewDur = e.duration;
          } else if (e.type === 'rung.ended') rewAt = -Infinity;
        }
        const mv = w.machine(id);
        const lv: SimLampView | null = mv && mv.kind === 'lamp' ? mv : null;

        // the level asked for: the simulation's lamp, else its setting (older scenes), else what was asked
        let target: number;
        let colour: Token | null;
        let on = true;
        if (lv) {
          on = lv.on !== false;
          const n = Math.max(1, lv.levels ?? LAMP_FEEL.steps.length);
          const k = clamp(Math.round(((lv.level ?? lv.home?.level ?? 3) - 1) * ((LAMP_FEEL.steps.length - 1) / Math.max(1, n - 1))), 0, LAMP_FEEL.steps.length - 1);
          target = on ? LAMP_FEEL.steps[k]! : 0;
          colour = lv.colour && lv.colour !== 'warm' && lv.colour in palette ? (lv.colour as Token) : null;
          if (arm) arm.glow = LAMP_FEEL.glow[k]!;
        } else {
          const sl = w.setting(id, 'level');
          const sc = w.setting(id, 'colour');
          target = typeof sl === 'number' ? Math.min(1, Math.max(0, sl)) : asked;
          colour = typeof sc === 'string' && sc in palette ? (sc as Token) : askedColour;
        }
        if (wasOn === false && on) onAt = now;
        wasOn = on;

        const dt = Math.min(frame.dt, 0.1);
        const rate = target > base ? LAMP_FEEL.warm : LAMP_FEEL.cool;
        base += (target - base) * (reduced ? 1 : 1 - Math.exp(-rate * dt));

        // where on the dip's curve we are: during a rewind, time runs backwards through the rung
        const rewinding = w.button().phase === 'rewinding' && rewAt > -Infinity;
        let since = now - dipAt;
        let wow = 1;
        if (rewinding) {
          const tau = Math.max(0, now - rewAt);
          const k = Math.min(1, tau / Math.max(1e-3, rewDur));
          since = rungAt + flinch * (1 - k) - dipAt;
          if (!reduced) wow = 1 - LAMP_FEEL.wowDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * LAMP_FEEL.wowHz * tau)) * Math.sin(Math.PI * k);
        }
        const env = dipCurve(since, reduced);
        const caught = reduced ? 1 : catchCurve(now - onAt);
        level = base * caught * env * wow;

        // the rig takes 0..2 (above 1 only the key brightens) and owns the colour: the key, the fill
        // following a little, the environment's lamp panel and the lamp's own glow, crossing over (stage/light.ts)
        const rigLevel = level;
        if (Math.abs(rigLevel - lastSent) > 1e-4 || colour !== lastColour) {
          lights.setLamp(colour !== lastColour ? { level: rigLevel, colour } : { level: rigLevel });
          lastSent = rigLevel;
          lastColour = colour;
        }
        const bulb = LAMP_FEEL.bulbFloor + (1 - LAMP_FEEL.bulbFloor) * env;
        if (dim.set && Math.abs(bulb - lastBulb) > 1e-4) {
          dim.set('bulb', 'intensity', bulb);
          lastBulb = bulb;
        }

        // the arm, and the key light at its drawn filament
        if (arm) {
          arm.lit = on ? level > 0.06 : level > 0.15;
          arm.update(lv, frame.events, dt, frame.hovered === id && !w.bracketed && !(lv?.dragging) ? frame.pointer : null);
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
    return view;
  };
}

// ───────────────────────── the arm ─────────────────────────

interface Arm {
  /** Reduced motion now: the arm cuts to its pose. */
  reduced: boolean;
  /** The shade shows lit (the filament is glowing), and which of its three glows. */
  lit: boolean;
  glow: 1 | 2 | 3;
  /** `hover`: where the pointer is while it is over the shade (null: not over it). */
  update(lv: SimLampView | null, events: readonly SimEvent[], dt: number, hover: Vec3 | null): void;
}

/** The shade's pick box in the head's frame (+X out of the mouth): wrist hub to rim, the bell's radius and the grip. */
const SHADE_BOX = new Box3(new Vector3(-0.3, -0.72, -0.72), new Vector3(1.32, 0.72, 0.72));

function createArm(ctx: ViewContext, root: Group, o: { place: Vec3; seed?: number }): Arm {
  const place = new Vector3(...o.place);
  const placeM = new Matrix4().makeTranslation(place.x, place.y, place.z);
  const springs = {} as Record<Joint, Spring>;
  for (const j of JOINTS) springs[j] = new Spring(HOME[j], { omega: ARM_FEEL.free.omega, zeta: ARM_FEEL.free.zeta });
  const want: Record<Joint, number> = { ...HOME };
  const pose: LampPose & Record<Joint, number> = { ...HOME, on: true, level: 3 };
  let mode: 'drag' | 'free' | 'home' = 'free';
  const nod = new Spring(0, { omega: 26, zeta: 0.55 });
  let hoverSide = 1;
  let lastNod = 0;
  let wasDragging = false;
  let started = false;
  const tAim = new Vector3(Infinity, 0, 0);
  const tmp = new Vector3();
  let nodes: Map<string, Object3D> | null = null;
  let dirty = true;
  let shownLit: boolean | null = null;
  let shownGlow = 0;
  const grip = new Group();
  grip.name = 'lamp:shade';
  grip.matrixAutoUpdate = false;
  root.add(grip);
  const lights = ctx.stage.lights;
  const pos = new Vector3(), q = new Quaternion(), scl = new Vector3();
  const bulbW = new Vector3(), aimW = new Vector3();

  // the body: built (cached) from the registry, realized skinned at its clamp
  void (async () => {
    let reg: typeof import('../kit/pieces/registry.ts');
    try {
      reg = await import('../kit/pieces/registry.ts');
    } catch {
      return; // no registry outside Vite (unit tests): the light still follows the arm's maths
    }
    if (!reg.pieceFolders().includes('lamp')) return;
    const entry = (await reg.loadFolder('lamp')).find((e) => e.name === 'lamp');
    if (!entry) return;
    const piece: Piece = reg.buildCached(entry, { seed: o.seed ?? 1, detail: ctx.tier === 'low' ? 'low' : 'high' });
    const obj = ctx.realize(piece);
    obj.position.copy(place);
    root.add(obj);
    const m = new Map<string, Object3D>();
    obj.traverse((n) => {
      if (n.name) m.set(n.name, n);
    });
    nodes = m;
    dirty = true;
    ctx.pickable('lamp', grip, { box: SHADE_BOX, pad: 0.05 });
  })();

  const arm: Arm = {
    reduced: ctx.reducedMotion,
    lit: true,
    glow: 3,
    update(lv, events, dt, hover) {
      const reduced = arm.reduced;
      // where the beam is to go (lamp space): the simulation's aim, else home
      const aim = lv?.aim ?? lv?.home?.aim ?? null;
      const dragging = !!lv?.dragging;
      if (aim) {
        tmp.set(aim[0] - place.x, aim[1] - place.y, aim[2] - place.z);
        if (tmp.distanceToSquared(tAim) > 1e-10) {
          const jumped = started && !dragging && !wasDragging && tmp.distanceTo(tAim) > ARM_FEEL.jump;
          tAim.copy(tmp);
          const a = aimLamp([tmp.x, tmp.y, tmp.z]);
          for (const j of JOINTS) want[j] = a.pose[j];
          if (jumped) mode = 'home';
        }
      }
      for (const e of events) if ((e.type === 'undone' || e.type === 'reset') && !dragging) mode = 'home';
      if (dragging) mode = 'drag';
      else if (wasDragging) {
        // let go: it settles on its springs, with a sag and a nod of the shade
        mode = 'free';
        if (!reduced) {
          springs.shoulder.kick(ARM_FEEL.sag.shoulder);
          springs.elbow.kick(ARM_FEEL.sag.elbow);
          springs.wrist.kick(ARM_FEEL.sag.wrist);
        }
      }
      wasDragging = dragging;
      const p = ARM_FEEL[mode];
      let moved = 0;
      for (const j of JOINTS) {
        const s = springs[j];
        const before = s.x;
        if (!started || reduced) s.set(want[j]);
        else {
          s.tune({ omega: p.omega * ARM_FEEL.omega[j], zeta: p.zeta * ARM_FEEL.zeta[j] });
          s.step(want[j], dt);
        }
        pose[j] = s.x;
        moved = Math.max(moved, Math.abs(s.x - before));
      }
      // the hover answer (§ B1): the shade nods toward the pointer, a degree or two, eased; its rim catches the light
      if (hover) {
        // which way across the arm's plane the pointer lies, seen from the bulb
        const f0 = armFrames(pose);
        hoverSide = Math.sign((hover[0] - place.x - f0.bulb.x) * f0.pin.x + (hover[2] - place.z - f0.bulb.z) * f0.pin.z) || 1;
      }
      const hv = reduced ? (hover ? 1 : 0) : nod.step(hover ? 1 : 0, dt);
      if (Math.abs(hv) > 1e-4 || Math.abs(nod.v) > 1e-4) {
        pose.wrist += ARM_FEEL.nod.wrist * hv;
        pose.pan += ARM_FEEL.nod.pan * hv * hoverSide;
        moved = Math.max(moved, Math.abs(hv - lastNod));
      }
      lastNod = hv;
      if (mode === 'home' && JOINTS.every((j) => springs[j].settled(want[j], 2e-4))) mode = 'free';
      started = true;
      if (shownLit !== arm.lit || shownGlow !== arm.glow) {
        pose.on = arm.lit;
        pose.level = arm.glow;
        shownLit = arm.lit;
        shownGlow = arm.glow;
        dirty = true;
      }
      if (moved < ARM_FEEL.rest && !dirty) return;

      // the key light at the drawn filament, along the drawn shade
      const f = armFrames(pose);
      bulbW.copy(f.bulb).add(place);
      aimW.copy(f.bulb).addScaledVector(f.axis, ARM_FEEL.reach).add(place);
      lights.setBulb([bulbW.x, bulbW.y, bulbW.z], [aimW.x, aimW.y, aimW.z]);
      // (the rig refits the shadow camera itself when the bulb has moved far enough: stage/light.ts setBulb)
      grip.matrix.copy(placeM).multiply(f.head);
      grip.matrixWorldNeedsUpdate = true;

      // the body's nodes
      if (nodes) {
        const t = nodeTransforms(pose);
        for (const name in t) {
          const n = nodes.get(name);
          if (!n) continue;
          t[name]!.decompose(pos, q, scl);
          n.position.copy(pos);
          n.quaternion.copy(q);
          n.scale.copy(scl);
        }
        dirty = false;
      }
    },
  };
  return arm;
}

/** Stand the kit's lamp (if registered) so its bulb is where the key light is, and move the key to the socket. */
async function standBody(ctx: ViewContext, root: Group): Promise<void> {
  let reg: typeof import('../kit/pieces/registry.ts');
  try {
    reg = await import('../kit/pieces/registry.ts');
  } catch {
    return; // no registry outside Vite (unit tests)
  }
  if (!reg.pieceFolders().includes('lamp')) return;
  const entry = (await reg.loadFolder('lamp')).find((e) => e.name === 'lamp');
  if (!entry) return;
  const extra = entry.labels?.(ctx.labels, {}) ?? {};
  const piece = reg.buildCached(entry, extra);
  const socket = piece.sockets?.['bulb'];
  if (!socket) return;
  const obj = ctx.realize(piece);
  const key = ctx.stage.lights.key;
  const at = new Vector3().setFromMatrixPosition(socket);
  // stand it so the bulb socket lands on the key light's place
  obj.position.copy(key.position).sub(at);
  root.add(obj);
  obj.updateMatrixWorld(true);
  const world = new Matrix4().multiplyMatrices(obj.matrixWorld, socket);
  const p = new Vector3().setFromMatrixPosition(world);
  const aim = key.target.position;
  ctx.stage.lights.setBulb([p.x, p.y, p.z], [aim.x, aim.y, aim.z]);
}
