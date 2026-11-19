/**
 * Gesture recognition (REWRITE.md § B6): pointer, touch, wheel and key
 * samples in, `Intent`s and camera commands out. A pure state machine over
 * abstract samples, so every rule here is unit-tested in Node without a DOM
 * (tests/unit/input/gesture.test.ts, handles.test.ts, keys.test.ts); `dom.ts`
 * is the thin adapter.
 *
 * It knows nothing about what any machine does. It asks a `GestureWorld`
 * what is under a point and what ROLE that thing plays for a hand (read from
 * the registry's affordances: a part, a unit that can be held, a handle to
 * press, a dial to turn, a lever to slide, the plug, a jack, a mouth), where
 * a carried thing should head, and what a turned handle reads now. It reads
 * `bracketed` (§ B4: while a Button rung plays, parts and handles do not
 * respond, the camera still moves).
 *
 * The table it implements:
 *
 *  | | mouse | touch |
 *  |---|---|---|
 *  | hover | move: `hover` + cursor (a hand over anything usable) | (none) |
 *  | carry | press a part or a holdable unit (grab at once) and drag; let go = `release` with the hand's velocity | same, one finger |
 *  | tap-then-tap | click a part (it stays lifted, follows the pointer); click a spot or mouth = `place` | tap a part (it stays lifted); tap a spot = `place` |
 *  | press handle | press = `press` (at once) | lift = `press`; a drag off it is a pull (`press` once, at the threshold) |
 *  | dial (`turn`) | drag round it or along it: `turn` through its detents; click = `press` (one step); wheel over it = a step | same; tap = `press` |
 *  | lever (`slide`) | drag: follows between its notches (`turn` at each), settles in the nearest; click = `press` | same |
 *  | plug | press the plug = `unplug`, drag, let go = `plug` into the NEAREST jack within reach (live or capped; a capped one refuses), else `plug {null}` | same |
 *  | pan | drag on empty bench (or with the right/middle button) | one finger on empty bench, or two fingers anywhere |
 *  | zoom | wheel, toward the pointer | pinch |
 *  | frame | double-click | double-tap |
 *  | back out | Esc | (the strip / back button) |
 *
 * A drag that starts on something usable never pans. The keyboard column
 * (Tab, Enter/Space, arrows, U, Esc) is `key()` below.
 */
import type { Id, Intent, Vec3 } from '../sim/types.ts';
import { VelocityTracker } from './velocity.ts';

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** One pointer sample. `x`, `y` in CSS pixels of the canvas; `t` in ms (the event's timeStamp). */
export interface Sample {
  readonly id: number;
  readonly kind: PointerKind;
  readonly x: number;
  readonly y: number;
  readonly t: number;
  /** 0 = primary (left), 1 = middle, 2 = right. */
  readonly button?: number;
}

/**
 * What a point on the screen is over, as a hand sees it (from affordances only):
 * - `part`: a loose part (`grab`, it has a body): lifted and carried;
 * - `unit`: something else that says it can be held (`grab`, no loose body: Patch, the lamp's shade);
 * - `handle`: worked in place (`press`, `open`);
 * - `dial`: turned through detents (`turn`);
 * - `lever`: slid between notches (`slide`, and not held);
 * - `plug`, `jack`: the cord's (`plug`);
 * - `mouth`: where a held part may be set down.
 */
export type Role = 'part' | 'unit' | 'handle' | 'dial' | 'lever' | 'plug' | 'jack' | 'mouth' | 'none';

export interface Target {
  readonly id: Id | null;
  readonly role: Role;
  /** The world point under the pointer on what was hit (the bench plane when nothing was). */
  readonly point: Vec3 | null;
}

/** A turned or slid handle's reading: `value` 0..1 over `detents` evenly spaced stops. */
export interface HandleReading {
  readonly value: number;
  readonly detents: number;
}

/** What the carried thing is: a loose part, the cord's plug, or a unit held in place (Patch, the lamp). */
export type HeldKind = 'part' | 'plug' | 'unit';

/** What the recogniser needs from the world; the shell provides it from picking, the camera and the WorldView. */
export interface GestureWorld {
  /** What is under this screen point (touch gets the larger hit areas), ignoring `exclude`; `holding`: mouths count too. */
  at(x: number, y: number, kind: PointerKind, exclude: Id | null, holding?: HeldKind | null): Target;
  /** Start carrying `id` taken at world point `grip`; `t` in ms. */
  beginCarry(id: Id, what: HeldKind, grip: Vec3, t: number): void;
  /** Where the carried thing should head for the pointer at x, y now (world). */
  carryTarget(x: number, y: number, t: number): Vec3;
  /** Where the carried part would be set down at x, y (the top of what is there). */
  spot(x: number, y: number): Vec3;
  endCarry(): void;
  /** § B4: a Button rung is playing. */
  readonly bracketed: boolean;
  /** A handle's centre on screen and its radius (CSS px), for a drag round it. */
  screen?(id: Id): { x: number; y: number; r: number } | null;
  /** A dial's or lever's reading now. */
  reading?(id: Id): HandleReading | null;
  /** The jack the held plug would go into if let go at x, y: the nearest within reach, live or capped; null if none. */
  jackNear?(x: number, y: number, kind: PointerKind): Id | null;
  /** Keyboard: everything usable, in the controls list's order. */
  usable?(): readonly Id[];
  /** Keyboard: where a held thing of this kind may be set down (mouths; jacks for the plug). */
  destinations?(what: HeldKind): readonly Id[];
  /** Keyboard: a thing's (or a destination's) world point. */
  where?(id: Id): Vec3 | null;
  /** What `id` is to a hand (keyboard focus has no pointer to ask `at` with). */
  role?(id: Id): Role;
  /** The grip a grab names (default: the point the hand took it at; an arm that aims is taken where it points). */
  gripFor?(id: Id, what: HeldKind, point: Vec3): Vec3;
}

export type Cursor = 'default' | 'grab' | 'grabbing' | 'pointer';

/** What the recogniser asks for: intents for the world, and camera moves for the rig. */
export type Command =
  | { readonly type: 'intent'; readonly intent: Intent; /** ms of the input that caused it */ readonly t: number }
  /** Drag the bench: the world point under `from` should end up under `to` (CSS px). */
  | { readonly type: 'pan'; readonly from: readonly [number, number]; readonly to: readonly [number, number] }
  /** Keyboard pan, in steps (−1, 0, 1) along x and z. */
  | { readonly type: 'nudge'; readonly dx: number; readonly dz: number }
  /** Zoom by a factor of distance (< 1 is in) toward this point (CSS px), or the centre. */
  | { readonly type: 'zoom'; readonly factor: number; readonly x: number | null; readonly y: number | null }
  /** Frame the station under this point (a hook: stations are framed by whoever owns them). */
  | { readonly type: 'frame'; readonly x: number; readonly y: number; readonly id: Id | null }
  /** Keyboard focus moved to `id` (null: off the stage). The view shows it; the shell frames it. */
  | { readonly type: 'focus'; readonly id: Id | null }
  /** Back out (Esc). */
  | { readonly type: 'back' }
  /** The undo key (U). */
  | { readonly type: 'undo' }
  | { readonly type: 'cursor'; readonly cursor: Cursor };

/** Tune here. */
export const GESTURE_TUNING = {
  /** Movement (CSS px) that turns a press into a drag: mouse, then touch and pen. */
  dragMouse: 4,
  dragTouch: 9,
  /** Two taps within this long (ms) and this close (px) are a double tap. */
  doubleMs: 320,
  doublePx: 24,
  /** A second finger this soon (ms) after a grab, before it moved, turns the grab into a two-finger pan. */
  secondFingerMs: 220,
  /** Release velocity is the average over this window (ms). */
  velocityWindow: 80,
  /** A throw also lifts a little: upward speed per unit of horizontal speed, and its most. */
  loft: 0.18,
  loftMax: 1.6,
  /** Wheel: distance factor per pixel of deltaY. */
  wheel: 0.0015,
  /** Keys + and −. */
  keyZoom: 0.8,
  /** A dial: degrees of drag round its centre per detent, and px of drag along it per detent. */
  dialDeg: 36,
  dialPx: 26,
  /** A lever: px of drag per notch (at least; a big lever on screen takes this share of its radius). */
  leverPx: 22,
  leverShare: 0.55,
  /** A detent is taken once the drag is this far (in detents) past the halfway point: no chatter at a boundary. */
  hysteresis: 0.12,
  /** Wheel over a dial: deltaY px per detent; a pause this long (ms) starts a new count. */
  wheelStep: 50,
  wheelIdle: 260,
  /** Keyboard carrying: world units an arrow key moves the held thing, and how high it is held over its spot. */
  keyStep: 0.35,
  keyLift: 0.45,
} as const;

export type GestureTuning = { -readonly [K in keyof typeof GESTURE_TUNING]: number };

interface Ptr {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
}

/** A dial or lever being dragged. */
interface Turning {
  /** The reading when the drag began (detent index) and the number of detents. */
  k0: number;
  n: number;
  /** The detent sent last. */
  k: number;
  /** Round: by angle about the centre; along: by horizontal travel. */
  mode: 'round' | 'along';
  cx: number;
  cy: number;
  /** Accumulated detents of drag (signed, + is up/clockwise/right). */
  steps: number;
  /** Last angle (round mode). */
  a: number;
  /** Px per detent (along mode). */
  px: number;
  /** Where the hand has it now, 0..1 over its travel, between detents. */
  v: number;
}

type Active =
  /** Pressing a handle: mouse already sent `press` (`fired`); touch sends it on lift or when the finger pulls. */
  | { k: 'press'; p: number; id: Id; role: 'handle' | 'dial' | 'lever'; moved: boolean; fired: boolean; turn: Turning | null }
  /** Carrying the held thing with this pointer. `fresh`: grabbed by this press (not a tap-held thing pressed again). */
  | { k: 'carry'; p: number; moved: boolean; fresh: boolean }
  /** Dragging the bench (or a tap on nothing, until it moves). */
  | { k: 'pan'; p: number; moved: boolean; target: Target }
  | { k: 'pinch'; a: number; b: number };

interface Holding {
  id: Id;
  what: HeldKind;
  /** Held by tap-then-tap (no pointer down). */
  tap: boolean;
  /** Held by the keyboard: `at` is where it is held (world), `dest` the destination focused. */
  key: { at: Vec3; dest: Id | null } | null;
}

const ROLE_HOVER: ReadonlySet<Role> = new Set(['part', 'unit', 'handle', 'dial', 'lever', 'plug']);
const HANDLES: ReadonlySet<Role> = new Set(['handle', 'dial', 'lever']);

/** Signed smallest difference of two angles (radians). */
const dAngle = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

export class Gestures {
  readonly tuning: GestureTuning;
  private readonly world: GestureWorld;
  private readonly ptrs = new Map<number, Ptr>();
  private active: Active | null = null;
  private holding: Holding | null = null;
  private readonly vel = new VelocityTracker();
  private out: Command[] = [];
  private hovered: Id | null = null;
  private cursor: Cursor = 'default';
  /** The mouse's last position over the surface (for hover and tap-held following), or null when it left. */
  private mouse: { x: number; y: number } | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  private lastT = 0;
  /** Keyboard focus (an id from `usable()`), or null. */
  private focus: Id | null = null;
  /** The wheel over a dial: its id, the deltaY gathered, when it last turned. */
  private wheelAcc: { id: Id; d: number; t: number } | null = null;
  /** The roll the wheel is in: a roll that began as a zoom stays a zoom across a dial it passes over. */
  private wheelRoll: { mode: 'zoom' | 'dial'; t: number } | null = null;
  /** The detent last sent to each stepped handle, and when. */
  private readonly sent = new Map<Id, { k: number; n: number; t: number }>();

  constructor(world: GestureWorld, tuning: Partial<GestureTuning> = {}) {
    this.world = world;
    this.tuning = { ...GESTURE_TUNING, ...tuning };
  }

  /** Commands produced since the last drain, in order. */
  drain(): Command[] {
    const o = this.out;
    this.out = [];
    return o;
  }

  /** What is held, as far as input knows (for overlays and tests). */
  get held(): { id: Id; what: HeldKind; tap: boolean } | null {
    return this.holding ? { id: this.holding.id, what: this.holding.what, tap: this.holding.tap } : null;
  }

  get hover(): Id | null {
    return this.hovered;
  }

  /** The keyboard's focus on the stage, or null. */
  get focused(): Id | null {
    return this.focus;
  }

  /** Where the keyboard holds the held thing now, and the destination it is over (null: none, or not held by keys). */
  get keyHold(): { at: Vec3; dest: Id | null } | null {
    return this.holding?.key ? { at: this.holding.key.at, dest: this.holding.key.dest } : null;
  }

  /** Is this pointer down, as far as the recogniser knows? */
  hasPointer(id: number): boolean {
    return this.ptrs.has(id);
  }

  get state(): 'idle' | Active['k'] {
    return this.active?.k ?? 'idle';
  }

  /** A dial or lever being dragged: its id and where the hand has it (0..1 over its travel, between detents); else null. */
  get working(): { id: Id; value: number } | null {
    const a = this.active;
    return a?.k === 'press' && a.turn ? { id: a.id, value: a.turn.v } : null;
  }

  // ───────────────────────── pointer events ─────────────────────────

  down(s: Sample): void {
    this.lastT = s.t;
    if (this.ptrs.has(s.id)) return;
    if (s.kind === 'mouse') this.mouse = { x: s.x, y: s.y };
    this.ptrs.set(s.id, { id: s.id, kind: s.kind, x: s.x, y: s.y, x0: s.x, y0: s.y, t0: s.t });

    const a = this.active;
    if (a) {
      // a second finger: two fingers anywhere pan and pinch
      if (this.ptrs.size === 2 && a.k !== 'pinch') {
        const first = a.p;
        const p = this.ptrs.get(first)!;
        if (a.k === 'carry') {
          if (a.moved || s.t - p.t0 > this.tuning.secondFingerMs) return; // carrying: the second finger is ignored
          this.dropHeld(s.t); // a grab that was really the start of a two-finger gesture
        }
        if (a.k === 'press') {
          // a handle being worked keeps the hand; one only touched becomes the start of a two-finger gesture
          if (a.moved || a.fired) return;
        }
        this.active = { k: 'pinch', a: first, b: s.id };
        this.setCursor('default');
      }
      return;
    }

    if (s.kind === 'mouse' && (s.button ?? 0) !== 0) {
      this.active = { k: 'pan', p: s.id, moved: true, target: { id: null, role: 'none', point: null } };
      return;
    }

    // a hand on the stage takes over from the keys: no focus mark under a pointer
    if (this.focus !== null) this.setFocus(null, s.t);

    const h = this.holding;
    if (h) {
      // something is held by tap-then-tap (or by the keys: the pointer takes over)
      h.key = null;
      const onHeld = s.kind === 'mouse' || this.world.at(s.x, s.y, s.kind, null).id === h.id;
      if (onHeld && !this.world.bracketed) {
        this.active = { k: 'carry', p: s.id, moved: false, fresh: false };
        h.tap = false;
        this.vel.reset();
        this.sampleCarry(s.x, s.y, s.t);
        this.setCursor('grabbing');
        return;
      }
      this.active = { k: 'pan', p: s.id, moved: false, target: this.world.at(s.x, s.y, s.kind, h.id, h.what) };
      return;
    }

    const target = this.world.at(s.x, s.y, s.kind, null);
    const role = this.world.bracketed ? 'none' : target.role;
    if ((role === 'part' || role === 'unit' || role === 'plug') && target.id && target.point) {
      this.take(target.id, role, target.point, s);
      this.active = { k: 'carry', p: s.id, moved: false, fresh: true };
      return;
    }
    if ((role === 'handle' || role === 'dial' || role === 'lever') && target.id) {
      const fireNow = role === 'handle' && s.kind === 'mouse';
      this.active = { k: 'press', p: s.id, id: target.id, role, moved: false, fired: fireNow, turn: null };
      if (fireNow) this.intent({ type: 'press', id: target.id }, s.t);
      this.setCursor(role === 'handle' ? 'pointer' : 'grabbing');
      return;
    }
    this.active = { k: 'pan', p: s.id, moved: false, target };
  }

  move(s: Sample): void {
    this.lastT = s.t;
    if (s.kind === 'mouse') this.mouse = { x: s.x, y: s.y };
    const p = this.ptrs.get(s.id);
    const a = this.active;
    if (!p || !a) {
      // no button down: hover, and a tap-held part follows the mouse
      if (s.kind === 'mouse') {
        if (this.holding && !this.holding.tap && !this.holding.key) return;
        if (this.holding?.key) this.holding.key = null; // the mouse takes over from the keys
        if (this.holding) this.sampleCarry(s.x, s.y, s.t);
        this.updateHover(s.t);
      }
      return;
    }
    const px = p.x;
    const py = p.y;
    p.x = s.x;
    p.y = s.y;
    const far = Math.hypot(s.x - p.x0, s.y - p.y0) > (p.kind === 'mouse' ? this.tuning.dragMouse : this.tuning.dragTouch);
    switch (a.k) {
      case 'carry':
        if (a.p !== s.id) return;
        if (far) a.moved = true;
        this.sampleCarry(s.x, s.y, s.t);
        if (this.holding?.what === 'plug') this.updateHover(s.t, s.x, s.y, p.kind);
        return;
      case 'pan':
        if (a.p !== s.id) return;
        if (!a.moved) {
          if (!far) return;
          a.moved = true;
          this.out.push({ type: 'pan', from: [p.x0, p.y0], to: [s.x, s.y] });
          return;
        }
        this.out.push({ type: 'pan', from: [px, py], to: [s.x, s.y] });
        return;
      case 'press':
        if (a.p !== s.id) return;
        if (!a.moved && !far) return;
        if (!a.moved) {
          a.moved = true;
          if (a.role === 'handle') {
            // a pull: a press dragged off its start works it (the UNDO lever down its arc); never a pan
            if (!a.fired && !this.world.bracketed) {
              a.fired = true;
              this.intent({ type: 'press', id: a.id }, s.t);
            }
            return;
          }
          a.turn = this.startTurn(a.id, a.role, p);
        }
        if (a.turn) this.dragTurn(a.id, a.turn, s.x, s.y, s.t);
        return;
      case 'pinch': {
        const A = this.ptrs.get(a.a);
        const B = this.ptrs.get(a.b);
        if (!A || !B || (s.id !== a.a && s.id !== a.b)) return;
        const other = s.id === a.a ? B : A;
        const before = { x: (px + other.x) / 2, y: (py + other.y) / 2, d: Math.hypot(px - other.x, py - other.y) };
        const after = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, d: Math.hypot(A.x - B.x, A.y - B.y) };
        this.out.push({ type: 'pan', from: [before.x, before.y], to: [after.x, after.y] });
        if (before.d > 1 && after.d > 1) this.out.push({ type: 'zoom', factor: before.d / after.d, x: after.x, y: after.y });
        return;
      }
    }
  }

  up(s: Sample): void {
    this.lastT = s.t;
    const p = this.ptrs.get(s.id);
    if (!p) return;
    if (s.x !== p.x || s.y !== p.y) this.move(s);
    this.ptrs.delete(s.id);
    const a = this.active;
    if (!a) return;
    switch (a.k) {
      case 'carry': {
        if (a.p !== s.id) return;
        this.active = null;
        const h = this.holding;
        if (!h) return;
        if (!a.moved && a.fresh) {
          // a click or tap on a part: it stays in hand (tap-then-tap)
          h.tap = true;
          this.noteTap(s, h.id);
          if (s.kind === 'mouse') this.sampleCarry(s.x, s.y, s.t);
          return;
        }
        if (!a.moved) {
          // pressed the tap-held thing again without moving: set it down here
          this.place(s.x, s.y, s.kind, s.t);
          this.noteTap(s, h.id);
          return;
        }
        this.letGo(s);
        return;
      }
      case 'press':
        if (a.p !== s.id) return;
        this.active = null;
        if (!a.moved && !a.fired && !this.world.bracketed) this.intent({ type: 'press', id: a.id }, s.t);
        // a dial or lever let go: it is already in its nearest detent (sent as the drag crossed it)
        this.noteTap(s, a.id);
        if (s.kind === 'mouse') this.updateHover(s.t);
        else this.setCursor('default');
        return;
      case 'pan':
        if (a.p !== s.id) return;
        this.active = null;
        if (!a.moved) {
          if (this.holding) this.place(s.x, s.y, s.kind, s.t);
          this.noteTap(s, a.target.id);
        }
        return;
      case 'pinch': {
        // one finger lifted: the other goes on panning
        const rest = s.id === a.a ? a.b : a.a;
        this.active = this.ptrs.has(rest) ? { k: 'pan', p: rest, moved: true, target: { id: null, role: 'none', point: null } } : null;
        return;
      }
    }
  }

  /** The browser took the pointer (a system gesture, the tab lost focus): end cleanly, throw nothing. */
  cancel(s: Sample): void {
    this.lastT = s.t;
    if (!this.ptrs.has(s.id)) return;
    this.ptrs.delete(s.id);
    const a = this.active;
    if (!a) return;
    if (a.k === 'carry' && a.p === s.id) {
      this.active = null;
      this.dropHeld(s.t);
    } else if (a.k === 'pinch') {
      const rest = s.id === a.a ? a.b : a.a;
      this.active = this.ptrs.has(rest) ? { k: 'pan', p: rest, moved: true, target: { id: null, role: 'none', point: null } } : null;
    } else if ('p' in a && a.p === s.id) {
      this.active = null;
      this.setCursor('default');
    }
  }

  /** Every pointer is gone at once (the window lost focus). */
  cancelAll(t: number): void {
    for (const p of [...this.ptrs.values()]) this.cancel({ id: p.id, kind: p.kind, x: p.x, y: p.y, t });
  }

  /** The mouse left the surface. */
  leave(t: number): void {
    this.mouse = null;
    if (!this.active) this.setHover(this.focus, t);
  }

  /** The wheel: over a dial it steps the dial; anywhere else it zooms toward the pointer. */
  wheel(x: number, y: number, deltaY: number, t: number = this.lastT): void {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    this.lastT = t;
    const roll = this.wheelRoll && t - this.wheelRoll.t <= this.tuning.wheelIdle ? this.wheelRoll.mode : null;
    if (roll !== 'zoom' && !this.active && !this.holding && !this.world.bracketed) {
      const under = this.world.at(x, y, 'mouse', null);
      if (under.role === 'dial' && under.id) {
        this.wheelRoll = { mode: 'dial', t };
        let w = this.wheelAcc;
        if (!w || w.id !== under.id || t - w.t > this.tuning.wheelIdle) w = this.wheelAcc = { id: under.id, d: 0, t };
        // a mouse wheel's notch is one detent; a trackpad's small deltas gather to `wheelStep` a detent
        const dir = deltaY < 0 ? 1 : -1; // wheel up (away) turns it up
        if (Math.sign(deltaY) !== Math.sign(w.d)) w.d = 0;
        w.t = t;
        if (Math.abs(deltaY) >= this.tuning.wheelStep) {
          w.d = 0;
          this.stepHandle(under.id, dir, t);
          return;
        }
        w.d += deltaY;
        if (Math.abs(w.d) >= this.tuning.wheelStep) {
          w.d = 0;
          this.stepHandle(under.id, dir, t);
        }
        return;
      }
    }
    this.wheelAcc = null;
    this.wheelRoll = { mode: 'zoom', t };
    this.out.push({ type: 'zoom', factor: Math.exp(deltaY * this.tuning.wheel), x, y });
  }

  /**
   * Keys (KeyboardEvent.key). Returns true when the key was used (the caller
   * then prevents the browser's default). `shift` for Shift+Tab. Tab past
   * the last control (or before the first) is NOT used: focus leaves the stage.
   */
  key(k: string, t: number, o: { shift?: boolean } = {}): boolean {
    this.lastT = t;
    const h = this.holding;
    switch (k) {
      case 'Tab':
        if (h?.key) return this.cycleDestination(o.shift ? -1 : 1, t) || true;
        return this.cycleFocus(o.shift ? -1 : 1, t);
      case 'Enter':
      case ' ':
      case 'Spacebar':
        return this.use(t);
      case 'Escape':
        if (h) {
          this.active = null;
          this.dropHeld(t);
        } else if (this.focus !== null) {
          this.setFocus(null, t);
          this.out.push({ type: 'back' });
        } else this.out.push({ type: 'back' });
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const dz = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        if (h?.key) {
          this.keyMove(dx, dz, t);
          return true;
        }
        const role = this.focus !== null ? this.roleOf(this.focus) : 'none';
        if (!h && (role === 'dial' || role === 'lever') && !this.world.bracketed) {
          // a focused dial or lever: right and up turn it up, left and down turn it down
          this.stepHandle(this.focus!, dx !== 0 ? dx : -dz, t);
          return true;
        }
        this.out.push({ type: 'nudge', dx, dz });
        return true;
      }
      case '+':
      case '=':
        this.out.push({ type: 'zoom', factor: this.tuning.keyZoom, x: null, y: null });
        return true;
      case '-':
      case '_':
        this.out.push({ type: 'zoom', factor: 1 / this.tuning.keyZoom, x: null, y: null });
        return true;
      case 'u':
      case 'U':
        this.out.push({ type: 'undo' });
        return true;
      default:
        return false;
    }
  }

  /** The stage lost keyboard focus (Tab left it, a click elsewhere): no focus is shown. */
  blur(t: number): void {
    if (this.focus !== null) this.setFocus(null, t);
  }

  /**
   * Once per frame, before the simulation steps: the carried thing's target
   * is recomputed (the camera may have moved, the carry plane eases), and the
   * hover is re-read (things move under a still pointer).
   */
  tick(t: number): void {
    this.lastT = t;
    if (this.world.bracketed && this.hovered !== null && this.focus === null) this.setHover(null, t);
    const a = this.active;
    if (a?.k === 'carry') {
      const p = this.ptrs.get(a.p);
      if (p) this.sampleCarry(p.x, p.y, t);
      return;
    }
    if (this.holding?.key) {
      this.intent({ type: 'carry', target: this.holding.key.at }, t);
      return;
    }
    if (this.holding?.tap && this.mouse) this.sampleCarry(this.mouse.x, this.mouse.y, t);
    if (!a && this.mouse) this.updateHover(t);
  }

  /** Something outside input ended the hold (the world refused the grab, a rung began): forget it, no intent. */
  forget(): void {
    if (this.holding) this.world.endCarry();
    this.holding = null;
    if (this.active?.k === 'carry') this.active = null;
    this.setCursor('default');
  }

  // ───────────────────────── handles ─────────────────────────

  private roleOf(id: Id): Role {
    return this.world.role?.(id) ?? 'none';
  }

  /** A dial or lever starts to be dragged from the pointer's press point. */
  private startTurn(id: Id, role: 'dial' | 'lever', p: Ptr): Turning | null {
    const r = this.world.reading?.(id) ?? null;
    if (!r || r.detents < 2) return null;
    const n = Math.round(r.detents);
    const k0 = Math.round(Math.min(1, Math.max(0, r.value)) * (n - 1));
    const sc = this.world.screen?.(id) ?? null;
    const T = this.tuning;
    let mode: Turning['mode'] = 'along';
    let a = 0;
    if (role === 'dial' && sc) {
      // round when the hand took it on its upper half or its sides (there round and along agree for a straight
      // drag); a press low on the knob drags along, so a drag to the right never turns it down
      const dx = p.x0 - sc.x;
      const dy = p.y0 - sc.y;
      const d = Math.hypot(dx, dy);
      if (d > Math.max(4, sc.r * 0.25) && d < sc.r * 2.2 && dy < sc.r * 0.35) {
        mode = 'round';
        a = Math.atan2(dy, dx);
      }
    }
    const px = role === 'lever' ? Math.max(T.leverPx, (sc?.r ?? 0) * T.leverShare) : T.dialPx;
    return { k0, n, k: k0, mode, cx: sc?.x ?? p.x0, cy: sc?.y ?? p.y0, steps: 0, a, px, v: k0 / (n - 1) };
  }

  private dragTurn(id: Id, tr: Turning, x: number, y: number, t: number): void {
    const p = this.ptrs.get((this.active as { p: number }).p);
    if (tr.mode === 'round') {
      const dx = x - tr.cx;
      const dy = y - tr.cy;
      if (Math.hypot(dx, dy) > 3) {
        const a = Math.atan2(dy, dx);
        // screen y is down: an increasing angle is clockwise, which turns it up
        tr.steps += (dAngle(a, tr.a) * 180) / Math.PI / this.tuning.dialDeg;
        tr.a = a;
      }
    } else if (p) {
      tr.steps = (x - p.x0) / tr.px;
    }
    const want = tr.k0 + tr.steps;
    tr.v = Math.max(0, Math.min(1, want / (tr.n - 1)));
    // hysteresis: leave the current detent only once the drag is clearly past the halfway point
    let k = tr.k;
    if (want > k + 0.5 + this.tuning.hysteresis || want < k - 0.5 - this.tuning.hysteresis) k = Math.round(want);
    k = Math.max(0, Math.min(tr.n - 1, k));
    if (tr.mode === 'round') {
      // at an end stop the drag does not wind up past it
      const lo = -tr.k0 - 0.5;
      const hi = tr.n - 1 - tr.k0 + 0.5;
      tr.steps = Math.max(lo, Math.min(hi, tr.steps));
    }
    if (k !== tr.k) {
      tr.k = k;
      this.intent({ type: 'turn', id, value: k / (tr.n - 1) }, t);
    }
  }

  /** One detent up (+1) or down (−1), from the reading; `press` steps up when there is no reading. */
  private stepHandle(id: Id, dir: number, t: number): void {
    if (dir === 0) return;
    const r = this.world.reading?.(id) ?? null;
    if (!r || r.detents < 2) {
      if (dir > 0) this.intent({ type: 'press', id }, t);
      return;
    }
    const n = Math.round(r.detents);
    // steps sent faster than the world steps (a fast wheel, a held arrow key) count from the last one sent
    const last = this.sent.get(id);
    const k0 = last && last.n === n && t - last.t < 250 ? last.k : Math.round(Math.min(1, Math.max(0, r.value)) * (n - 1));
    const k = Math.max(0, Math.min(n - 1, k0 + Math.sign(dir)));
    if (k === k0) return;
    this.sent.set(id, { k, n, t });
    this.intent({ type: 'turn', id, value: k / (n - 1) }, t);
  }

  // ───────────────────────── keyboard ─────────────────────────

  private setFocus(id: Id | null, t: number): void {
    if (id === this.focus) return;
    this.focus = id;
    this.out.push({ type: 'focus', id });
    // the focused thing lifts as a hovered one does (until the view draws its own focus mark)
    if (!this.mouse || this.hovered === null || id !== null) this.setHover(id, t);
  }

  private cycleFocus(dir: number, t: number): boolean {
    const list = this.world.usable?.() ?? [];
    if (list.length === 0) return false;
    const i = this.focus === null ? -1 : list.indexOf(this.focus);
    let j: number;
    if (i < 0) j = dir > 0 ? 0 : list.length - 1;
    else j = i + dir;
    if (j < 0 || j >= list.length) {
      // past either end: focus leaves the stage (the browser's Tab goes on to the page)
      this.setFocus(null, t);
      return false;
    }
    this.setFocus(list[j]!, t);
    return true;
  }

  private cycleDestination(dir: number, t: number): boolean {
    const h = this.holding;
    if (!h?.key) return false;
    const list = this.world.destinations?.(h.what) ?? [];
    if (list.length === 0) return false;
    const i = h.key.dest === null ? -1 : list.indexOf(h.key.dest);
    const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    const dest = list[j]!;
    const p = this.world.where?.(dest);
    h.key.dest = dest;
    if (p) h.key.at = h.what === 'plug' ? [p[0], p[1], p[2] + 0.22] : [p[0], p[1] + this.tuning.keyLift, p[2]];
    this.setHover(dest, t);
    this.intent({ type: 'carry', target: h.key.at }, t);
    return true;
  }

  private keyMove(dx: number, dz: number, t: number): void {
    const h = this.holding;
    if (!h?.key) return;
    const s = this.tuning.keyStep;
    const [x, y, z] = h.key.at;
    // the plug moves on the board's face: up and down are up and down
    h.key.at = h.what === 'plug' ? [x + dx * s, Math.max(0.2, y - dz * s), z] : [x + dx * s, y, z + dz * s];
    if (h.key.dest !== null) {
      h.key.dest = null;
      this.setHover(null, t);
    }
    this.intent({ type: 'carry', target: h.key.at }, t);
  }

  /** Enter or Space. */
  private use(t: number): boolean {
    const h = this.holding;
    if (h) {
      // set the held thing down: at the destination the keys chose, else where it is held
      const dest = h.key?.dest ?? null;
      if (h.what === 'plug') this.intent({ type: 'plug', cord: h.id, jack: dest }, t);
      else if (dest !== null) this.intent({ type: 'place', at: dest }, t);
      else if (h.key) this.intent({ type: 'place', at: [h.key.at[0], h.key.at[1] - this.tuning.keyLift, h.key.at[2]] }, t);
      else if (this.mouse) {
        this.place(this.mouse.x, this.mouse.y, 'mouse', t);
        return true;
      } else this.intent({ type: 'release', velocity: [0, 0, 0] }, t);
      this.endHold(t);
      return true;
    }
    const id = this.focus;
    if (id === null || this.world.bracketed) return id !== null;
    const role = this.roleOf(id);
    if (HANDLES.has(role)) {
      this.intent({ type: 'press', id }, t);
      return true;
    }
    if (role === 'part' || role === 'unit' || role === 'plug') {
      const p = this.world.where?.(id);
      if (!p) return true;
      // an arm that aims (the lamp) is taken where it points, as the pointer's grab takes it: no jump
      const grip = this.world.gripFor?.(id, role, p) ?? p;
      const aims = grip !== p;
      this.take(id, role, p, { id: -1, kind: 'mouse', x: NaN, y: NaN, t }, true);
      const held = this.holding as Holding | null;
      if (held) {
        held.tap = true;
        held.key = {
          at: aims ? [grip[0], grip[1] + this.tuning.keyLift, grip[2]] : role === 'plug' ? [p[0], p[1], p[2] + 0.22] : [p[0], p[1] + this.tuning.keyLift, p[2]],
          dest: null,
        };
        this.intent({ type: 'carry', target: held.key.at }, t);
      }
      return true;
    }
    return true;
  }

  // ───────────────────────── the rest ─────────────────────────

  private take(id: Id, role: HeldKind, point: Vec3, s: Sample, keys = false): void {
    this.holding = { id, what: role, tap: false, key: null };
    if (role === 'plug') this.intent({ type: 'unplug', cord: id }, s.t);
    else this.intent({ type: 'grab', id, grip: this.world.gripFor?.(id, role, point) ?? point }, s.t);
    this.world.beginCarry(id, role, point, s.t);
    this.vel.reset();
    if (!keys) {
      this.sampleCarry(s.x, s.y, s.t);
      this.setHover(null, s.t);
    }
    this.setCursor('grabbing');
  }

  private sampleCarry(x: number, y: number, t: number): void {
    if (!this.holding) return;
    const target = this.world.carryTarget(x, y, t);
    this.vel.add(t, target);
    this.intent({ type: 'carry', target }, t);
  }

  /** The jack the plug would go into at x, y: the nearest within reach (the world's answer), else the one under the pointer. */
  private jackAt(x: number, y: number, kind: PointerKind, exclude: Id): Id | null {
    if (this.world.jackNear) return this.world.jackNear(x, y, kind);
    const under = this.world.at(x, y, kind, exclude, 'plug');
    return under.role === 'jack' ? under.id : null;
  }

  private letGo(s: Sample): void {
    const h = this.holding;
    if (!h) return;
    if (h.what === 'plug') {
      this.intent({ type: 'plug', cord: h.id, jack: this.jackAt(s.x, s.y, s.kind, h.id) }, s.t);
    } else {
      // (R4) a unit (Patch, the lamp's shade) is thrown like a part: what it does with the hand's velocity is its own
      this.intent({ type: 'release', velocity: this.throwVelocity(s.t) }, s.t);
    }
    this.endHold(s.t);
  }

  /** The hand's velocity at release, with a little loft so a flick arcs. */
  throwVelocity(t: number): Vec3 {
    // (R4) what the hand was doing when it threw, not the average of its last moments
    const v = this.vel.throw(t);
    const hs = Math.hypot(v[0], v[2]);
    const up = Math.max(v[1], 0) + Math.min(this.tuning.loftMax, hs * this.tuning.loft);
    return [v[0], v[1] < 0 ? v[1] + up : up, v[2]];
  }

  /** Let go where it is, throwing nothing (Esc, a cancelled pointer, a grab that became a pinch). */
  private dropHeld(t: number): void {
    const h = this.holding;
    if (!h) return;
    if (h.what === 'plug') this.intent({ type: 'plug', cord: h.id, jack: null }, t);
    else this.intent({ type: 'release', velocity: [0, 0, 0] }, t);
    this.endHold(t);
  }

  private place(x: number, y: number, kind: PointerKind, t: number): void {
    const h = this.holding;
    if (!h) return;
    if (h.what === 'plug') {
      this.intent({ type: 'plug', cord: h.id, jack: this.jackAt(x, y, kind, h.id) }, t);
    } else {
      const under = this.world.at(x, y, kind, h.id, h.what);
      this.intent({ type: 'place', at: under.role === 'mouth' && under.id ? under.id : this.world.spot(x, y) }, t);
    }
    this.endHold(t);
  }

  private endHold(t: number): void {
    this.holding = null;
    this.world.endCarry();
    this.vel.reset();
    this.setCursor('default');
    if (this.mouse) this.updateHover(t);
    else this.setHover(this.focus, t);
  }

  private noteTap(s: Sample, id: Id | null): void {
    const last = this.lastTap;
    if (last && s.t - last.t <= this.tuning.doubleMs && Math.hypot(s.x - last.x, s.y - last.y) <= this.tuning.doublePx) {
      this.out.push({ type: 'frame', x: s.x, y: s.y, id });
      this.lastTap = null;
      return;
    }
    this.lastTap = { x: s.x, y: s.y, t: s.t };
  }

  private updateHover(t: number, x?: number, y?: number, kind: PointerKind = 'mouse'): void {
    const px = x ?? this.mouse?.x;
    const py = y ?? this.mouse?.y;
    if (px === undefined || py === undefined || this.world.bracketed) {
      this.setHover(this.world.bracketed ? null : this.focus, t);
      if (!this.holding) this.setCursor('default');
      return;
    }
    const h = this.holding;
    let id: Id | null = null;
    let role: Role = 'none';
    if (h?.what === 'plug') id = this.jackAt(px, py, kind, h.id);
    else {
      const under = this.world.at(px, py, kind, h?.id ?? null, h?.what ?? null);
      role = under.role;
      if (h) id = under.role === 'mouth' ? under.id : null;
      else id = ROLE_HOVER.has(under.role) ? under.id : null;
    }
    this.setHover(id ?? (h ? null : this.focus), t);
    if (!h) this.setCursor(id === null ? 'default' : HANDLES.has(role) ? 'pointer' : 'grab');
  }

  private setHover(id: Id | null, t: number): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.intent({ type: 'hover', id }, t);
  }

  private setCursor(c: Cursor): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.out.push({ type: 'cursor', cursor: c });
  }

  private intent(intent: Intent, t: number): void {
    this.out.push({ type: 'intent', intent, t });
  }
}
