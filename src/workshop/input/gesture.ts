/**
 * Gesture recognition (REWRITE.md § B6): pointer, touch and wheel samples in,
 * `Intent`s and camera commands out. A pure state machine over abstract
 * samples, so every rule here is unit-tested in Node without a DOM
 * (tests/unit/input/gesture.test.ts); `dom.ts` is the thin adapter.
 *
 * It knows nothing about what any machine does. It asks a `GestureWorld`
 * what is under a point (a part, a handle, a plug, a jack, a mouth, or
 * nothing) and where a carried thing should head, and it reads
 * `bracketed` (§ B4: while a Button rung plays, parts and handles do not
 * respond, the camera still moves).
 *
 * The table it implements:
 *
 *  | | mouse | touch |
 *  |---|---|---|
 *  | hover | move: `hover` + cursor | (none) |
 *  | carry | press a part (grab at once) and drag; let go = `release` with the hand's velocity | same, one finger |
 *  | tap-then-tap | click a part (it stays lifted, follows the pointer); click a spot or mouth = `place` | tap a part (it stays lifted); tap a spot = `place` |
 *  | handle | press = `press` (at once) | tap = `press` (on lift, so a pan that starts on a handle does not fire it) |
 *  | plug | press the plug = `unplug`, drag, let go over a jack = `plug {jack}`, elsewhere `plug {null}` | same |
 *  | pan | drag on empty bench (or with the right/middle button) | one finger on empty bench, or two fingers anywhere |
 *  | zoom | wheel, toward the pointer | pinch |
 *  | frame | double-click | double-tap |
 *  | back out | Esc | (the strip / back button) |
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

/** What a point on the screen is over. */
export type Role = 'part' | 'handle' | 'plug' | 'jack' | 'mouth' | 'none';

export interface Target {
  readonly id: Id | null;
  readonly role: Role;
  /** The world point under the pointer on what was hit (the bench plane when nothing was). */
  readonly point: Vec3 | null;
}

/** What the recogniser needs from the world; the shell provides it from picking, the camera and the WorldView. */
export interface GestureWorld {
  /** What is under this screen point (touch gets the larger hit areas), ignoring `exclude`. */
  at(x: number, y: number, kind: PointerKind, exclude: Id | null): Target;
  /** Start carrying `id` (a part or a plug) taken at world point `grip`; `t` in ms. */
  beginCarry(id: Id, what: 'part' | 'plug', grip: Vec3, t: number): void;
  /** Where the carried thing should head for the pointer at x, y now (world). */
  carryTarget(x: number, y: number, t: number): Vec3;
  /** Where the carried part would be set down at x, y (the top of what is there). */
  spot(x: number, y: number): Vec3;
  endCarry(): void;
  /** § B4: a Button rung is playing. */
  readonly bracketed: boolean;
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

type Active =
  /** Pressing a handle: mouse already sent `press`; touch sends it on lift. */
  | { k: 'press'; p: number; id: Id; moved: boolean }
  /** Carrying the held thing with this pointer. `fresh`: grabbed by this press (not a tap-held thing pressed again). */
  | { k: 'carry'; p: number; moved: boolean; fresh: boolean }
  /** Dragging the bench (or a tap on nothing, until it moves). */
  | { k: 'pan'; p: number; moved: boolean; target: Target }
  | { k: 'pinch'; a: number; b: number };

interface Holding {
  id: Id;
  what: 'part' | 'plug';
  /** Held by tap-then-tap (no pointer down). */
  tap: boolean;
}

const ROLE_HOVER: ReadonlySet<Role> = new Set(['part', 'handle', 'plug']);

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
  get held(): { id: Id; what: 'part' | 'plug'; tap: boolean } | null {
    return this.holding ? { ...this.holding } : null;
  }

  get hover(): Id | null {
    return this.hovered;
  }

  get state(): 'idle' | Active['k'] {
    return this.active?.k ?? 'idle';
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
        if (a.k === 'carry') {
          const p = this.ptrs.get(first)!;
          if (a.moved || s.t - p.t0 > this.tuning.secondFingerMs) return; // carrying: the second finger is ignored
          this.dropHeld(s.t, a.fresh); // a grab that was really the start of a two-finger gesture
        }
        this.active = { k: 'pinch', a: first, b: s.id };
      }
      return;
    }

    if (s.kind === 'mouse' && (s.button ?? 0) !== 0) {
      this.active = { k: 'pan', p: s.id, moved: true, target: { id: null, role: 'none', point: null } };
      return;
    }

    const h = this.holding;
    if (h) {
      // something is held by tap-then-tap
      const onHeld = s.kind === 'mouse' || this.world.at(s.x, s.y, s.kind, null).id === h.id;
      if (onHeld && !this.world.bracketed) {
        this.active = { k: 'carry', p: s.id, moved: false, fresh: false };
        h.tap = false;
        this.vel.reset();
        this.sampleCarry(s.x, s.y, s.t);
        this.setCursor('grabbing');
        return;
      }
      this.active = { k: 'pan', p: s.id, moved: false, target: this.world.at(s.x, s.y, s.kind, h.id) };
      return;
    }

    const target = this.world.at(s.x, s.y, s.kind, null);
    const role = this.world.bracketed ? 'none' : target.role;
    if ((role === 'part' || role === 'plug') && target.id && target.point) {
      this.take(target.id, role, target.point, s);
      this.active = { k: 'carry', p: s.id, moved: false, fresh: true };
      return;
    }
    if (role === 'handle' && target.id) {
      this.active = { k: 'press', p: s.id, id: target.id, moved: false };
      if (s.kind === 'mouse') this.intent({ type: 'press', id: target.id }, s.t);
      this.setCursor('pointer');
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
        if (this.holding && !this.holding.tap) return;
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
        if (far && !a.moved) {
          a.moved = true;
          if (p.kind !== 'mouse') {
            // a touch that started on a handle and moved is a pan
            this.active = { k: 'pan', p: s.id, moved: true, target: { id: null, role: 'none', point: null } };
            this.out.push({ type: 'pan', from: [p.x0, p.y0], to: [s.x, s.y] });
          }
        }
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
        if (p.kind !== 'mouse' && !a.moved && !this.world.bracketed) this.intent({ type: 'press', id: a.id }, s.t);
        this.noteTap(s, a.id);
        this.updateHover(s.t);
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
      this.dropHeld(s.t, true);
    } else if (a.k === 'pinch') {
      const rest = s.id === a.a ? a.b : a.a;
      this.active = this.ptrs.has(rest) ? { k: 'pan', p: rest, moved: true, target: { id: null, role: 'none', point: null } } : null;
    } else if ('p' in a && a.p === s.id) {
      this.active = null;
    }
  }

  /** Every pointer is gone at once (the window lost focus). */
  cancelAll(t: number): void {
    for (const p of [...this.ptrs.values()]) this.cancel({ id: p.id, kind: p.kind, x: p.x, y: p.y, t });
  }

  /** The mouse left the surface. */
  leave(t: number): void {
    this.mouse = null;
    if (!this.active) this.setHover(null, t);
  }

  wheel(x: number, y: number, deltaY: number): void {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    this.out.push({ type: 'zoom', factor: Math.exp(deltaY * this.tuning.wheel), x, y });
  }

  /** Keys (KeyboardEvent.key). Returns true when the key was used. */
  key(k: string, t: number): boolean {
    this.lastT = t;
    switch (k) {
      case 'Escape':
        if (this.holding) {
          this.active = null;
          this.dropHeld(t, true);
        } else this.out.push({ type: 'back' });
        return true;
      case 'ArrowLeft':
        this.out.push({ type: 'nudge', dx: -1, dz: 0 });
        return true;
      case 'ArrowRight':
        this.out.push({ type: 'nudge', dx: 1, dz: 0 });
        return true;
      case 'ArrowUp':
        this.out.push({ type: 'nudge', dx: 0, dz: -1 });
        return true;
      case 'ArrowDown':
        this.out.push({ type: 'nudge', dx: 0, dz: 1 });
        return true;
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

  /**
   * Once per frame, before the simulation steps: the carried thing's target
   * is recomputed (the camera may have moved, the carry plane eases), and the
   * hover is re-read (things move under a still pointer).
   */
  tick(t: number): void {
    this.lastT = t;
    if (this.world.bracketed && this.hovered !== null) this.setHover(null, t);
    const a = this.active;
    if (a?.k === 'carry') {
      const p = this.ptrs.get(a.p);
      if (p) this.sampleCarry(p.x, p.y, t);
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

  // ───────────────────────── the rest ─────────────────────────

  private take(id: Id, role: 'part' | 'plug', point: Vec3, s: Sample): void {
    this.holding = { id, what: role, tap: false };
    if (role === 'part') this.intent({ type: 'grab', id, grip: point }, s.t);
    else this.intent({ type: 'unplug', cord: id }, s.t);
    this.world.beginCarry(id, role, point, s.t);
    this.vel.reset();
    this.sampleCarry(s.x, s.y, s.t);
    this.setHover(null, s.t);
    this.setCursor('grabbing');
  }

  private sampleCarry(x: number, y: number, t: number): void {
    if (!this.holding) return;
    const target = this.world.carryTarget(x, y, t);
    this.vel.add(t, target);
    this.intent({ type: 'carry', target }, t);
  }

  private letGo(s: Sample): void {
    const h = this.holding;
    if (!h) return;
    if (h.what === 'plug') {
      const under = this.world.at(s.x, s.y, s.kind, h.id);
      this.intent({ type: 'plug', cord: h.id, jack: under.role === 'jack' ? under.id : null }, s.t);
    } else {
      this.intent({ type: 'release', velocity: this.throwVelocity(s.t) }, s.t);
    }
    this.endHold(s.t);
  }

  /** The hand's velocity at release, with a little loft so a flick arcs. */
  throwVelocity(t: number): Vec3 {
    const v = this.vel.velocity(t, this.tuning.velocityWindow);
    const hs = Math.hypot(v[0], v[2]);
    const up = Math.max(v[1], 0) + Math.min(this.tuning.loftMax, hs * this.tuning.loft);
    return [v[0], v[1] < 0 ? v[1] + up : up, v[2]];
  }

  /** Let go where it is, throwing nothing (Esc, a cancelled pointer, a grab that became a pinch). */
  private dropHeld(t: number, _fresh: boolean): void {
    const h = this.holding;
    if (!h) return;
    if (h.what === 'plug') this.intent({ type: 'plug', cord: h.id, jack: null }, t);
    else this.intent({ type: 'release', velocity: [0, 0, 0] }, t);
    this.endHold(t);
  }

  private place(x: number, y: number, kind: PointerKind, t: number): void {
    const h = this.holding;
    if (!h) return;
    const under = this.world.at(x, y, kind, h.id);
    if (h.what === 'plug') {
      this.intent({ type: 'place', at: under.role === 'jack' && under.id ? under.id : this.world.spot(x, y) }, t);
    } else {
      this.intent({ type: 'place', at: under.role === 'mouth' && under.id ? under.id : this.world.spot(x, y) }, t);
    }
    this.endHold(t);
  }

  private endHold(t: number): void {
    this.holding = null;
    this.world.endCarry();
    this.vel.reset();
    this.setCursor('default');
    this.updateHover(t);
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
      this.setHover(null, t);
      if (!this.holding) this.setCursor('default');
      return;
    }
    const h = this.holding;
    const under = this.world.at(px, py, kind, h?.id ?? null);
    let id: Id | null = null;
    if (h) id = (h.what === 'plug' && under.role === 'jack') || (h.what === 'part' && under.role === 'mouth') ? under.id : null;
    else id = ROLE_HOVER.has(under.role) ? under.id : null;
    this.setHover(id, t);
    if (!h) this.setCursor(id === null ? 'default' : under.role === 'handle' ? 'pointer' : 'grab');
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
