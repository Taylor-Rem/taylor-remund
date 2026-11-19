/**
 * One frame of the workshop, in order (W2 brief § 4):
 *
 *   1. input catches up (hover re-read, the carried thing re-aimed);
 *   2. each due fixed step: `world.advance()`, its events collected;
 *   3. a `Frame` is assembled (world, events since the last frame, time,
 *      dt, alpha, pointer, hovered, held) and every view is updated;
 *   4. the stage renders.
 *
 * Pure bookkeeping over a `World` and a list of views, so it runs in Node
 * against the stub physics (tests/unit/shell/frame.test.ts). The browser's
 * clock, the canvas and the DOM stay in boot.ts.
 */
import type { Id, SimEvent, Vec3, World } from '../sim/index.ts';
import { HZ } from '../sim/index.ts';
import type { Frame, StationView } from '../view/types.ts';
import type { RenderInfo } from '../view/stage/loop.ts';
import { LatencyMeter } from './latency.ts';

export interface FrameInputs {
  /** Before the frame's steps (step 1 above); `now` in ms. */
  tick(now: number): void;
  /** Where the pointer is in the world, or null. */
  pointer(): Vec3 | null;
  /** What the pointer is over (input's answer, a step earlier than the world's). */
  hovered(): Id | null;
  /** After the steps: reconcile with what the world says is held. */
  settle?(): void;
  /** Keyboard focus, the keys' chosen destination, and a dial or lever being dragged (Frame fields of the same names). */
  focused?(): Id | null;
  keyDest?(): Id | null;
  working?(): { id: Id; value: number } | null;
}

export interface DriverOptions {
  world: World;
  views: readonly StationView[];
  render(dt: number): void;
  input?: FrameInputs;
  now?: () => number;
  /** Called with every frame after the views have been updated (overlays, tests). */
  onFrame?(frame: Frame): void;
  latency?: LatencyMeter;
}

/** The simulation time to draw: interpolated between the last two steps. */
export function frameTime(step: number, alpha: number): number {
  return Math.max(0, (step - 1 + alpha) / HZ);
}

export function assembleFrame(
  world: World,
  events: readonly SimEvent[],
  alpha: number,
  dt: number,
  pointer: Vec3 | null,
  hovered: Id | null,
  keys: { focused: Id | null; keyDest: Id | null; working: { id: Id; value: number } | null } = { focused: null, keyDest: null, working: null },
): Frame {
  const h = world.holding();
  return {
    world,
    events,
    time: frameTime(world.step, alpha),
    dt: Math.min(Math.max(dt, 0), 0.1),
    alpha: Math.min(1, Math.max(0, alpha)),
    pointer,
    hovered,
    held: h ? h.id : null,
    focused: keys.focused,
    keyDest: keys.keyDest,
    working: keys.working,
  };
}

export class Driver {
  readonly latency: LatencyMeter;
  private readonly o: DriverOptions;
  private events: SimEvent[] = [];
  private ticked = false;
  private readonly now: () => number;
  /** The last frame handed to the views. */
  last: Frame | null = null;
  /** Steps run since the driver started. */
  steps = 0;
  frames = 0;

  constructor(o: DriverOptions) {
    this.o = o;
    this.now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
    this.latency = o.latency ?? new LatencyMeter();
  }

  private before(): void {
    if (this.ticked) return;
    this.ticked = true;
    this.o.input?.tick(this.now());
  }

  /** One fixed step (the loop's `step`). */
  step(): void {
    this.before();
    this.o.world.advance();
    for (const e of this.o.world.drainEvents()) this.events.push(e);
    this.steps++;
    this.latency.step(this.now());
  }

  /** Assemble the frame, update the views, render (the loop's `render`). */
  render(info: Pick<RenderInfo, 'alpha' | 'dt'>): Frame {
    this.before();
    this.o.input?.settle?.();
    const i = this.o.input;
    const frame = assembleFrame(this.o.world, this.events, info.alpha, info.dt, i?.pointer() ?? null, i?.hovered() ?? this.o.world.hovered, {
      focused: i?.focused?.() ?? null,
      keyDest: i?.keyDest?.() ?? null,
      working: i?.working?.() ?? null,
    });
    this.events = [];
    for (const v of this.o.views) v.update(frame);
    this.o.onFrame?.(frame);
    this.o.render(frame.dt);
    this.latency.rendered(this.now());
    this.ticked = false;
    this.frames++;
    this.last = frame;
    return frame;
  }
}
