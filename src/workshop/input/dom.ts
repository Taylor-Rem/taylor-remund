/**
 * The thin DOM adapter: pointer, wheel and key events on the stage canvas
 * become `Sample`s for the recogniser, and its commands go out through
 * `sink`. Everything that decides anything is in `gesture.ts`.
 *
 * Dragging never fights the browser: the canvas has `touch-action: none`,
 * the pointer is captured on press (a drag that leaves the canvas still
 * carries), the wheel and the context menu are taken, and the page itself
 * never scrolls or zooms under a gesture.
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

export function attachInput(canvas: HTMLElement, gestures: Gestures, sink: InputSink): DomInput {
  let pointer: { x: number; y: number; kind: PointerKind } | null = null;
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';

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
    gestures.wheel(p.x, p.y, e.deltaY * scale);
    flush();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (gestures.key(e.key, e.timeStamp)) {
      e.preventDefault();
      flush();
    }
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onBlur = (): void => {
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
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);

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
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}
