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
import { Group, Quaternion, Vector3 } from 'three';
import type { Id, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { button as buttonPiece, buttonLabels, poseButton } from '../kit/pieces/button/index.ts';

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
  /** Camera shake on the flinch (stage units; 0 for none). */
  shake: 0.07,
} as const;

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
}

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
  const s = w.scene.statics.find((x) => x.id === 'button-pedestal');
  const top = w.scene.bench.top;
  if (!s) return { p: new Vector3(0, top, 0), q: new Quaternion() };
  return { p: new Vector3(s.pose.p[0], top, s.pose.p[2]), q: new Quaternion(s.pose.q[0], s.pose.q[1], s.pose.q[2], s.pose.q[3]) };
}

export function createButtonView(opts: ButtonViewOptions = {}): (ctx: ViewContext) => ButtonView {
  return (ctx) => {
    const F = BUTTON_FEEL;
    const reduced = ctx.reducedMotion;
    const root = new Group();
    root.name = 'button-station';
    ctx.scene.add(root);
    const body = new Group(); // the console, which shudders
    root.add(body);
    const refs = opts.labels === false ? undefined : buttonLabels(ctx.labels);
    const obj = ctx.realize(buttonPiece({ ...(refs ? { labels: refs } : {}), detail: opts.detail ?? (ctx.tier === 'low' ? 'low' : 'high') }));
    body.add(obj);

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
    let flinchDur = 3;
    let rewDur = 1.2;
    const state: ButtonViewState = { press: 0, guard: 0, count: 0, shudder: shud };

    const place = (w: WorldView): void => {
      const { p, q } = pedestalOf(w);
      root.position.copy(p);
      root.quaternion.copy(q);
      id = w.scene.button.id;
      ctx.pickable(id, obj);
      const b = w.button();
      count.x = countTo = b.presses;
    };

    const view: ButtonView = {
      root,
      state,
      update(frame: Frame) {
        const w = frame.world;
        if (id === null) place(w);
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        const b = w.button();

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
          // the guard: a spring with a stop at its parked position
          let left = dt;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            springStep(guard, 0, F.guardOmega, F.guardDamping, h);
            if (guard.x < 0) {
              guard.x = -guard.x * F.guardStop;
              guard.v = -guard.v * F.guardStop;
            }
            left -= h;
          }
          if (Math.abs(guard.x) < 1e-5 && Math.abs(guard.v) < 1e-4) guard.x = guard.v = 0;
          state.guard = guard.x;
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

        body.position.set(shud[0], shud[1], shud[2]);
        poseButton(obj, { press: state.press, guard: state.guard, count: state.count });
      },
      dispose() {
        root.removeFromParent();
      },
    };
    return view;
  };
}
