/**
 * The thin DOM adapter: pointer, wheel and key events on the stage canvas
 * become `Sample`s for the recogniser, and its commands go out through
 * `sink`. Everything that decides anything is in `gesture.ts`.
 *
 * Dragging never fights the browser: the canvas has `touch-action: none`,
 * the pointer is captured on press (a drag that leaves the canvas still
 * carries), the wheel and the context menu are taken, and the page itself
 * never scrolls or zooms under a gesture.
 *
 * Keys: the canvas is one stop in the page's Tab order. While it has focus,
 * Tab and Shift+Tab move through the controls list on the stage, and leave
 * it past either end. The stage's other keys (Enter, Space, arrows, + and −,
 * U, Esc) answer when the canvas or the page itself has focus, never while
 * the visitor is in a form, a button of the page, or a dialog (the phone
 * panel keeps its keys).
 */
import type { Id, Intent } from '../sim/types.ts';
import type { Command, Cursor, Gestures, PointerKind, Sample } from './gesture.ts';

export interface InputSink {
  /** An intent for the world; `t` is the DOM event's timeStamp (ms), for latency. */
  intent(intent: Intent, t: number): void;
  /** Camera: drag the bench point under `from` to `to` (CSS px). */
  pan(from: readonly [number, number], to: readonly [number, number]): void;
  nudge(dx: number, dz: number): void;
  zoom(factor: number, at: readonly [number, number] | null): void;
  /** Hook: frame the station under this point. */
  frame(x: number, y: number, id: Id | null): void;
  /** Keyboard focus on the stage moved (null: none). */
  focus?(id: Id | null): void;
  back(): void;
  undo(): void;
}

export interface DomInput {
  /** The pointer's last position over the canvas (CSS px), or null. */
  readonly pointer: { x: number; y: number; kind: PointerKind } | null;
  /** Once per frame before the steps: re-reads hover, re-aims the carried thing. */
  tick(t: number): void;
  dispose(): void;
}

const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');

const CSS_CURSOR: Record<Cursor, string> = { default: 'default', grab: 'grab', grabbing: 'grabbing', pointer: 'pointer' };

/** Is this key event's target somewhere the stage may answer (the canvas, or the page itself)? */
function stageKeyTarget(target: EventTarget | null, canvas: HTMLElement): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === canvas) return true;
  if (typeof document !== 'undefined' && (el === document.body || el === document.documentElement)) return true;
  return false;
}

export function attachInput(canvas: HTMLElement, gestures: Gestures, sink: InputSink): DomInput {
  let pointer: { x: number; y: number; kind: PointerKind } | null = null;
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
  // one stop in the Tab order; focus is drawn on the stage, not as an outline round the canvas
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  canvas.style.outline = 'none';
  let shiftTab = false;

  const local = (e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sample = (e: PointerEvent, x: number, y: number): Sample => ({ id: e.pointerId, kind: kindOf(e), x, y, t: e.timeStamp, button: e.button });

  const flush = (): void => {
    for (const c of gestures.drain()) run(c);
  };
  const run = (c: Command): void => {
    switch (c.type) {
      case 'intent':
        sink.intent(c.intent, c.t);
        return;
      case 'pan':
        sink.pan(c.from, c.to);
        return;
      case 'nudge':
        sink.nudge(c.dx, c.dz);
        return;
      case 'zoom':
        sink.zoom(c.factor, c.x === null || c.y === null ? null : [c.x, c.y]);
        return;
      case 'frame':
        sink.frame(c.x, c.y, c.id);
        return;
      case 'focus':
        sink.focus?.(c.id);
        return;
      case 'back':
        sink.back();
        return;
      case 'undo':
        sink.undo();
        return;
      case 'cursor':
        canvas.style.cursor = CSS_CURSOR[c.cursor];
        return;
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    const p = local(e);
    pointer = { ...p, kind: kindOf(e) };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no capturable pointer */
    }
    e.preventDefault();
    // the stage takes keyboard focus from a press on it (preventDefault stops the browser doing so)
    if (typeof document !== 'undefined' && document.activeElement !== canvas) canvas.focus({ preventScroll: true });
    gestures.down(sample(e, p.x, p.y));
    flush();
  };
  const onMove = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    // every sample the browser coalesced into this event: the throw needs them
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = list.length ? list : [e];
    for (const c of events) {
      const x = c.clientX - r.left;
      const y = c.clientY - r.top;
      gestures.move({ id: e.pointerId, kind: kindOf(e), x, y, t: c.timeStamp || e.timeStamp });
    }
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top, kind: kindOf(e) };
    flush();
  };
  const onUp = (e: PointerEvent): void => {
    const p = local(e);
    gestures.up(sample(e, p.x, p.y));
    if (e.pointerType !== 'mouse') pointer = null;
    flush();
  };
  const onCancel = (e: PointerEvent): void => {
    const p = local(e);
    gestures.cancel(sample(e, p.x, p.y));
    if (e.pointerType !== 'mouse') pointer = null;
    flush();
  };
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || canvas.hasPointerCapture?.(e.pointerId)) return;
    pointer = null;
    gestures.leave(e.timeStamp);
    flush();
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e);
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    gestures.wheel(p.x, p.y, e.deltaY * scale, e.timeStamp);
    flush();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') shiftTab = e.shiftKey;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!stageKeyTarget(e.target, canvas)) return;
    // Tab moves through the stage's controls only while the stage has focus; elsewhere it is the page's
    if (e.key === 'Tab' && e.target !== canvas) return;
    if (gestures.key(e.key, e.timeStamp, { shift: e.shiftKey })) {
      e.preventDefault();
    }
    flush();
  };
  const onFocus = (e: FocusEvent): void => {
    // arriving by Tab (not a press): the first control (the last, coming back with Shift+Tab) takes focus
    if (typeof canvas.matches === 'function' && !canvas.matches(':focus-visible')) return;
    if (gestures.focused === null) gestures.key('Tab', e.timeStamp, { shift: shiftTab });
    flush();
  };
  const onBlur = (e: FocusEvent): void => {
    gestures.blur(e.timeStamp);
    flush();
  };
  /**
   * A release must never be lost. The pointer is captured on press, so its `pointerup` comes to the canvas;
   * but capture can be taken away mid-drag (a system gesture, a screenshot, a devtools pause), and then the
   * up goes to whatever is under the pointer, or nowhere. So: an up or cancel anywhere in the window for a
   * pointer the recogniser still holds is handled as the canvas's; and capture lost while the pointer is
   * still down (no up came first) lets go where the pointer last was.
   */
  const onWindowUp = (e: PointerEvent): void => {
    if (e.target === canvas || !gestures.hasPointer(e.pointerId)) return;
    if (e.type === 'pointercancel') onCancel(e);
    else onUp(e);
  };
  const onWindowMove = (e: PointerEvent): void => {
    if (e.target !== canvas && gestures.hasPointer(e.pointerId)) onMove(e);
  };
  const onLostCapture = (e: PointerEvent): void => {
    if (!gestures.hasPointer(e.pointerId)) return; // the usual order: the up came first
    const r = canvas.getBoundingClientRect();
    const last = pointer ?? { x: e.clientX - r.left, y: e.clientY - r.top };
    // still pressed (the capture was taken, not the button let go): the gesture goes on outside the canvas
    if ((e.buttons & 1) === 1 && e.pointerType === 'mouse') return;
    gestures.up({ id: e.pointerId, kind: kindOf(e), x: last.x, y: last.y, t: e.timeStamp });
    flush();
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onWindowBlur = (): void => {
    // the window lost focus mid-gesture: every pointer is cancelled
    gestures.cancelAll(performance.now());
    flush();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('lostpointercapture', onLostCapture);
  window.addEventListener('pointerup', onWindowUp, true);
  window.addEventListener('pointermove', onWindowMove, true);
  window.addEventListener('pointercancel', onWindowUp, true);
  canvas.addEventListener('focus', onFocus);
  canvas.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onWindowBlur);

  return {
    get pointer() {
      return pointer;
    },
    tick(t) {
      gestures.tick(t);
      flush();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('pointerup', onWindowUp, true);
      window.removeEventListener('pointermove', onWindowMove, true);
      window.removeEventListener('pointercancel', onWindowUp, true);
      canvas.removeEventListener('focus', onFocus);
      canvas.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onWindowBlur);
    },
  };
}
