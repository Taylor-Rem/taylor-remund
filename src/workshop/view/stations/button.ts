/**
 * The Big Red Button's view (REWRITE.md § B4, § B1 "feedback grammar", § E0;
 * W4 brief § B). The kit's `button` piece, where the scene's pedestal is,
 * driven by `world.button()` and the simulation's events:
 *
 *  - hover: the cap rises a hair (only while a press would be taken);
 *  - press (`button.pressed`): the cap goes down in three frames, hits its
 *    click-stop with a little chatter, and springs back past rest before it
 *    settles; the counter's wheels roll to the new count, odometer style,
 *    a touch past and back; the parked guard rattles on its hinges;
 *  - the flinch (`rung.started`, or a misfire of the Button): the console
 *    shudders on its bolts, the guard rattles harder, the camera shakes a
 *    little (none with reduced motion);
 *  - the rewind (`rung.rewinding`): this view's own motion runs backwards
 *    with the rest of the world: what it did during the rung is recorded
 *    and played back reversed, so the rewind lands on the instant of the
 *    press with the cap down; at `rung.ended` the cap lets go and springs up.
 *
 * Reduced motion: the cap and the wheels still answer; nothing shudders,
 * rattles, shakes or runs backwards. Everything runs on `frame.time`/`dt`.
 */
import { Group, Matrix4, Quaternion, Vector3, type Material, type PerspectiveCamera } from 'three';
import type { CoverState, Id, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { nodeBounds, proxyOn, proxyOnOff } from './proxy.ts';
import { button as buttonPiece, buttonLabels, poseButton, POSE } from '../kit/pieces/button/index.ts';
import { BUTTON_GLOW } from '../materials/button-glow.ts';
import { LampHalos } from '../effects/lamp-halos.ts';

/** Tune here. Rates in rad/s, times in seconds, travel as fractions of the cap's travel. */
export const BUTTON_FEEL = {
  /** Hover: how far up the cap rises (poseButton clamps at -0.3). */
  hover: -0.28,
  /** Press: time to the bottom, the click-stop's chatter, and when the spring lets go. */
  down: 0.045,
  chatter: 0.07,
  chatterDepth: 0.08,
  /** The cap's return spring: past rest and back. */
  capOmega: 30,
  capDamping: 0.3,
  /** Counter: delay after the press (the cap has to bottom out), and its roll. */
  countDelay: 0.05,
  countOmega: 15,
  countDamping: 0.48,
  /** The guard on its hinges: spring and the kicks a press and a flinch give it (guard fraction / s). */
  guardOmega: 24,
  guardDamping: 0.16,
  guardPress: 0.55,
  guardFlinch: 1.5,
  /** Where the parked guard rests against its stop: a bounce off it keeps this much speed. */
  guardStop: 0.35,
  /** The console's shudder on a flinch: amplitude (units), decay (1/s), and the two frequencies (Hz). */
  shudder: 0.011,
  shudderDecay: 9,
  shudderHz: [21, 15] as const,
  /** Camera shake on the flinch (stage units; 0 for none), and on rung 4's works (§ B4: small). */
  shake: 0.07,
  shakeWorks: 0.1,
  /** The cover (the guard): the nudge over the top as it is let go, gravity on its hinge (guard fraction / s²), and the bounce off the cap's rim. */
  coverNudge: 2.7,
  coverFall: 30,
  coverBounce: 0.3,
  /** Lifted (a press on the shut cover): it swings back over onto its parked stop with a lid's weight. */
  coverLiftOmega: 11,
  coverLiftDamping: 0.75,
  /** While Revert fits the cover it comes down this long into Revert's `fit`. */
  coverFitAt: 0.55,
  /** Hovered, the cover stirs on its hinge this much (guard fraction), eased at this rate (1/s). */
  coverHover: 0.035,
  coverHoverRate: 22,
} as const;

/** The guard's swing from parked to shut, radians (the piece's POSE). */
const GUARD_SWING = ((POSE.guardClosedDeg - POSE.guardOpenDeg) * Math.PI) / 180;

/**
 * Where the cover should be: 1 shut over the cap, 0 parked open. While Revert is fitting it (`fitting`),
 * it comes down when Revert, at the Button, turns it with its arm; the simulation shuts it on its own clock
 * if Revert never gets there.
 */
export function coverGoal(w: WorldView, cover: CoverState): 0 | 1 {
  if (cover === 'shut') return 1;
  if (cover !== 'fitting') return 0;
  for (const c of w.crewViews()) {
    if (c.kind === 'revert' && c.view.state === 'fit' && c.view.stateTime >= BUTTON_FEEL.coverFitAt) return 1;
  }
  return 0;
}

/** A damped spring step: x toward `to`, in sub-steps. */
function springStep(s: { x: number; v: number }, to: number, omega: number, zeta: number, dt: number): void {
  let left = dt;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    s.v += (-k * (s.x - to) - c * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
}

interface Sample {
  t: number;
  press: number;
  guard: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface ButtonViewOptions {
  /** Labels on the tape and plate (default true; tests pass false). */
  labels?: boolean;
  detail?: 'high' | 'low';
  /** The whole console drawn at this share of its size as built (L2: the bench's is smaller; default 1). */
  scale?: number;
  /**
   * (L2, development candidates for the Button in its dim corner) `lit`: the cap glows red from inside and breathes
   * slowly, its glow on the deck and the cover's bars (`?corner=1`); `lamp`: a small caged work lamp of its own on a
   * gooseneck from the console, its light a point light (`?corner=2`). Default: neither.
   */
  corner?: 'lit' | 'lamp';
  /** Where the console stands (x, z; the scene's `console` body), for what is placed before the first frame. */
  consoleAt?: readonly [number, number];
}

/**
 * (L2) The lit cap's breath: its glow swells from `low` to 1 and back over `period` seconds (reduced motion: steady at
 * `still`); its glow on what is round it is a red halo of `halo` units (and at least `haloPx` CSS px) at `gain` × the glow.
 */
export const LIT_FEEL = { period: 3.6, low: 0.55, still: 0.85, halo: 0.75, haloPx: 30, gain: 0.32, rise: 0.12 } as const;

/** What the view shows now, for tests and dev pages. */
export interface ButtonViewState {
  press: number;
  guard: number;
  count: number;
  shudder: readonly [number, number, number];
}

export interface ButtonView extends StationView {
  readonly state: ButtonViewState;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function pedestalOf(w: WorldView): { p: Vector3; q: Quaternion } {
  const s = w.scene.statics.find((x) => x.id === 'console');
  const top = w.scene.bench.top;
  if (!s) return { p: new Vector3(0, top, 0), q: new Quaternion() };
  return { p: new Vector3(s.pose.p[0], top, s.pose.p[2]), q: new Quaternion(s.pose.q[0], s.pose.q[1], s.pose.q[2], s.pose.q[3]) };
}

export function createButtonView(opts: ButtonViewOptions = {}): (ctx: ViewContext) => ButtonView {
  return (ctx) => {
    const F = BUTTON_FEEL;
    let reduced = ctx.reducedMotion;
    const root = new Group();
    root.name = 'button-station';
    root.scale.setScalar(opts.scale ?? 1);
    ctx.scene.add(root);
    const body = new Group(); // the console, which shudders
    root.add(body);
    const refs = opts.labels === false ? undefined : buttonLabels(ctx.labels);
    const built = buttonPiece({ ...(refs ? { labels: refs } : {}), detail: opts.detail ?? (ctx.tier === 'low' ? 'low' : 'high'), ...(opts.corner === 'lit' ? { lit: true } : {}), ...(opts.corner === 'lamp' ? { workLamp: true } : {}) });
    // (L2, `?corner=1`) the lit cap's glow on what is round it
    const halos = opts.corner === 'lit' ? new LampHalos({ halo: () => (ctx.materials as unknown as { buttonHalo: () => Material }).buttonHalo() }, 1) : null;
    if (halos) ctx.scene.add(halos.mesh);
    const camera = (ctx.stage.camera as unknown as { camera: PerspectiveCamera }).camera;
    const capAt = new Vector3();
    const obj = ctx.realize(built);
    body.add(obj);
    // the cover's pick target rides on the guard's hinge (W3 hover: what can be touched must look it)
    const guardBone = obj.getObjectByName('guard');
    const coverProxy = guardBone ? proxyOn(guardBone, nodeBounds(built, 'guard'), 'cover:proxy', 0.05) : null;
    // the Button's own target is its cap and the ring round it, riding down with the cap (not the whole console)
    const capBone = obj.getObjectByName('cap');
    // (L2: drawn smaller, its target keeps the size it had at full size: no harder to hit, on a phone above all)
    const capBox = nodeBounds(built, 'cap');
    const capW = capBox.max.x - capBox.min.x;
    const capPad = ((capW + 2 * 0.09) / (opts.scale ?? 1) - capW) / 2;
    const capProxy = capBone ? proxyOn(capBone, capBox, 'cap:proxy', capPad) : null;
    let coverHover = 0;

    let id: Id | null = null;
    const cap = { x: 0, v: 0 };
    const guard = { x: 0, v: 0 };
    const count = { x: 0, v: 0 };
    let countTo = 0;
    let countAt = -Infinity;
    let pressAt = -Infinity;
    let shudderAt = -Infinity;
    const shud: [number, number, number] = [0, 0, 0];
    const tape: Sample[] = [];
    let replaying = false;
    let wasShut = false;
    let fitted = false;
    let flinchDur = 3;
    let rewDur = 1.2;
    const state: ButtonViewState = { press: 0, guard: 0, count: 0, shudder: shud };

    const place = (w: WorldView): void => {
      const { p, q } = pedestalOf(w);
      root.position.copy(p);
      root.quaternion.copy(q);
      id = w.scene.button.id;
      ctx.pickable(id, capProxy ?? obj);
      const b = w.button();
      if (coverProxy) ctx.pickable(b.coverId, coverProxy);
      count.x = countTo = b.presses;
    };
    // (L2, `?corner=2`) the work lamp's light, where its bulb is, made with the station (before the first frame
    // compiles anything: the light count never changes after); high tier only
    const sock = built.sockets?.['worklamp'];
    if (sock && opts.consoleAt && ctx.tier === 'high') {
      const s = opts.scale ?? 1;
      const m = new Matrix4().makeTranslation(opts.consoleAt[0], 0, opts.consoleAt[1]).multiply(new Matrix4().makeScale(s, s, s)).multiply(sock);
      const at = new Vector3().setFromMatrixPosition(m);
      ctx.stage.lights.addPractical([at.x, at.y, at.z]);
    }

    const view: ButtonView = {
      root,
      state,
      update(frame: Frame) {
        const w = frame.world;
        if (id === null) place(w);
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        const b = w.button();
        reduced = ctx.reducedMotion || w.reducedMotion;

        for (const e of frame.events) {
          if (e.type === 'button.pressed') {
            pressAt = now;
            countTo = e.presses;
            countAt = now + F.countDelay;
            if (!reduced) guard.v += F.guardPress;
          } else if (e.type === 'rung.started') {
            flinchDur = e.duration;
            tape.length = 0;
            if (!reduced) {
              shudderAt = now;
              guard.v += F.guardFlinch;
              if (F.shake > 0) ctx.stage.camera.shake(F.shake);
            }
          } else if (e.type === 'rung.beat' && e.beat === 'shake' && !reduced && F.shakeWorks > 0) {
            ctx.stage.camera.shake(F.shakeWorks);
            guard.v += F.guardFlinch;
          } else if (e.type === 'misfire' && e.id === id && !reduced) {
            shudderAt = now;
            guard.v += F.guardFlinch;
          } else if (e.type === 'rung.rewinding') {
            rewDur = e.duration;
            replaying = !reduced && tape.length > 1;
          } else if (e.type === 'rung.ended') {
            if (replaying) {
              // let go from where the rewind left the cap: down, so it springs up now
              const first = tape[0]!;
              cap.x = first.press;
              cap.v = 0;
              guard.x = first.guard;
              guard.v = 0;
              pressAt = -Infinity;
            }
            replaying = false;
            tape.length = 0;
            shudderAt = -Infinity;
          }
        }

        if (replaying && b.phase === 'rewinding') {
          // the rung, backwards: sample what was recorded at the mapped rung time
          const k = Math.min(1, b.phaseTime / Math.max(1e-3, rewDur));
          const t = flinchDur * (1 - k);
          let i = tape.length - 1;
          while (i > 0 && tape[i]!.t > t) i--;
          const a = tape[i]!;
          const c = tape[Math.min(tape.length - 1, i + 1)]!;
          const u = c.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t))) : 0;
          state.press = lerp(a.press, c.press, u);
          state.guard = lerp(a.guard, c.guard, u);
          shud[0] = lerp(a.sx, c.sx, u);
          shud[1] = lerp(a.sy, c.sy, u);
          shud[2] = lerp(a.sz, c.sz, u);
        } else {
          // the cap: scripted down and click-stop, then the spring
          const s = now - pressAt;
          if (s >= 0 && s < F.down) {
            state.press = (s / F.down) ** 2;
            cap.x = state.press;
            cap.v = 0;
          } else if (s >= F.down && s < F.down + F.chatter) {
            state.press = 1 - F.chatterDepth * Math.sin((Math.PI * (s - F.down)) / F.chatter);
            cap.x = 1;
            cap.v = 0;
          } else {
            const live = b.phase === 'idle' && !w.bracketed && w.holding() === null;
            const goal = frame.hovered === id && live ? F.hover : 0;
            springStep(cap, goal, F.capOmega, reduced ? 1 : F.capDamping, dt);
            state.press = cap.x;
          }
          // the guard, which is the flip-up cover (§ B4 rung 3): parked open, or shut over the cap. It
          // drops shut under its own weight and bounces on the cap's rim; lifted, it swings back onto its
          // parked stop. While Revert fits it, it comes down when Revert's arm turns it (`coverGoal`).
          // once Revert has turned it down it stays down (the simulation calls it shut a little later, on its own clock)
          if (b.cover !== 'fitting') fitted = false;
          else if (!fitted && coverGoal(w, b.cover) === 1) fitted = true;
          const shut = b.cover === 'shut' || fitted;
          if (shut && !wasShut && !reduced) guard.v = Math.max(guard.v, F.coverNudge);
          wasShut = shut;
          if (reduced) {
            guard.x = shut ? 1 : 0;
            guard.v = 0;
          } else {
            let left = dt;
            while (left > 1e-6) {
              const h = Math.min(left, 1 / 240);
              if (shut) {
                // falling shut: gravity on the hinge (it has to be nudged over the top first), a bounce off the rim
                const theta = (1 - guard.x) * GUARD_SWING;
                guard.v += F.coverFall * Math.cos(theta) * h;
                guard.x += guard.v * h;
                if (guard.x > 1) {
                  guard.x = 1 - (guard.x - 1) * F.coverBounce;
                  guard.v = -guard.v * F.coverBounce;
                  if (Math.abs(guard.v) < 0.05) guard.v = 0;
                }
              } else {
                // lifted off the cap it swings back with the weight of a lid; a rattle on its stop is quick
                const lifting = guard.x > 0.2;
                springStep(guard, 0, lifting ? F.coverLiftOmega : F.guardOmega, lifting ? F.coverLiftDamping : F.guardDamping, h);
                if (guard.x < 0) {
                  guard.x = -guard.x * F.guardStop;
                  guard.v = -guard.v * F.guardStop;
                }
              }
              left -= h;
            }
            if (!shut && Math.abs(guard.x) < 1e-5 && Math.abs(guard.v) < 1e-4) guard.x = guard.v = 0;
            if (shut && guard.x > 0.999 && Math.abs(guard.v) < 1e-3) {
              guard.x = 1;
              guard.v = 0;
            }
          }
          // hovered, the cover twitches on its hinge: a hair up off the cap when shut, a hair toward it when lifted
          const coverLive = (b.cover === 'shut' || b.cover === 'open') && b.phase === 'idle' && !w.bracketed && w.holding() === null;
          coverHover = reduced ? 0 : coverHover + ((frame.hovered === b.coverId && coverLive ? 1 : 0) - coverHover) * (1 - Math.exp(-F.coverHoverRate * dt));
          state.guard = guard.x + (b.cover === 'shut' ? -1 : 1) * F.coverHover * coverHover;
          // the console's shudder on its bolts
          const ts = now - shudderAt;
          if (ts >= 0 && ts < 0.8) {
            const a = F.shudder * Math.exp(-F.shudderDecay * ts);
            shud[0] = a * Math.sin(2 * Math.PI * F.shudderHz[0] * ts);
            shud[2] = a * 0.6 * Math.sin(2 * Math.PI * F.shudderHz[1] * ts + 1.1);
            shud[1] = a * 0.5 * Math.max(0, Math.sin(2 * Math.PI * F.shudderHz[1] * ts));
          } else shud[0] = shud[1] = shud[2] = 0;
          if (b.phase === 'playing' && !reduced) tape.push({ t: b.phaseTime, press: state.press, guard: state.guard, sx: shud[0], sy: shud[1], sz: shud[2] });
        }

        // the counter: rolls to the new count, a touch past and back
        if (now >= countAt) springStep(count, countTo, F.countOmega, reduced ? 1 : F.countDamping, dt);
        if (Math.abs(count.x - countTo) < 1e-4 && Math.abs(count.v) < 1e-3) {
          count.x = countTo;
          count.v = 0;
        }
        state.count = Math.max(0, count.x);

        if (coverProxy) proxyOnOff(coverProxy, b.cover !== 'none');
        body.position.set(shud[0], shud[1], shud[2]);
        poseButton(obj, { press: state.press, guard: state.guard, count: state.count });
        if (halos) {
          // (L2, `?corner=1`) the cap breathes; its glow falls on the deck and the cover round it
          const L = LIT_FEEL;
          const glow = reduced ? L.still : L.low + (1 - L.low) * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / L.period));
          BUTTON_GLOW.u_buttonGlow.value = glow;
          capBone?.updateWorldMatrix(true, false);
          if (capBone) capAt.setFromMatrixPosition(capBone.matrixWorld);
          capAt.y += L.rise * root.scale.y;
          camera.updateMatrixWorld();
          halos.begin(camera, Math.max(1, (globalThis as { innerHeight?: number }).innerHeight ?? 900));
          halos.add(capAt, L.halo * root.scale.y, L.haloPx, glow * L.gain);
          halos.end();
        }
      },
      dispose() {
        root.removeFromParent();
        if (halos) {
          halos.mesh.removeFromParent();
          halos.dispose();
        }
      },
    };
    return view;
  };
}
