/**
 * The phone, picked up (REWRITE.md § D 3, § B3, § B10, § E9): the HTML panel
 * a visitor texts Patch with. Plain DOM over the stage; not modal, so the
 * stage stays live and Tab can leave it. It draws what the line says and
 * hands the visitor's text to the line; it keeps nothing once the page is
 * gone, and sends nothing anywhere else.
 *
 * On a wide screen it stands to one side, away from the station the cord is
 * plugged into; on an upright phone it is a bottom sheet no taller than 45%
 * of the screen. It opens out of the phone on the bench and goes back into
 * it (a cut under reduced motion).
 */
import './phone.css';
import { cssVariables } from './colours.ts';
import {
  charsLeft,
  isWorking,
  lineAnnouncement,
  lineName,
  MAX_CHARS,
  readyFor,
  reduce,
  replay,
  toSend,
  words,
  type Item,
  type PhoneState,
} from './model.ts';
import type { Jack, PhoneEvent, PhoneLine } from './types.ts';

export interface PhonePanelOptions {
  line: PhoneLine;
  /** Where the panel lives in the page. Default `document.body`. */
  parent?: HTMLElement;
  /** Where the phone is on screen now (it opens out of this and goes back into it). */
  anchor?: () => DOMRect | null;
  /** Where the station on a line is on screen now; the panel stands clear of it on a wide screen. */
  avoid?: (jack: Jack | null) => DOMRect | null;
  /** Default: the visitor's `prefers-reduced-motion`. */
  reducedMotion?: () => boolean;
  /** Told when the panel opens or closes. */
  onToggle?: (open: boolean) => void;
}

export interface PhonePanel {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  /** Pick the phone up. Focus goes to the first ready-made text; `returnTo` (default: what had focus) gets it back on close. */
  open(returnTo?: HTMLElement | null): void;
  /** Put it down. */
  close(): void;
  /** Stand clear of the station again (call when the camera moves). */
  place(): void;
  destroy(): void;
}

/** Below this width, or upright and narrow, the panel is a bottom sheet. */
const SHEET_QUERY = '(max-width: 640px), (orientation: portrait) and (max-width: 900px)';
const MARGIN = 24;
const WIDE_W = 388;
const WIDE_MAX_H = 680;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A small seeded tilt in degrees for item `id` (slips are never quite square). */
const tilt = (id: number, amount: number): number => {
  const x = Math.sin(id * 12.9898 + 4.1414) * 43758.5453;
  return ((x - Math.floor(x)) * 2 - 1) * amount;
};

/** Decoration a screen reader skips. */
function hidden_<T extends HTMLElement>(e: T): T {
  e.setAttribute('aria-hidden', 'true');
  return e;
}

let uid = 0;

export function createPhonePanel(o: PhonePanelOptions): PhonePanel {
  const { line } = o;
  const n = ++uid;
  const reduced = o.reducedMotion ?? (() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  let state: PhoneState = replay(line.jack, line.log());
  let isOpen = false;
  let returnTo: HTMLElement | null = null;
  let anim: Animation | null = null;

  // ── the handset ──
  const root = el('section', 'ph');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `ph-name-${n}`);
  for (const [k, v] of Object.entries(cssVariables())) root.style.setProperty(k, v);

  const body = el('div', 'ph-body');
  for (const side of ['a', 'b', 'c']) body.append(hidden_(el('span', `ph-side ph-side-${side}`)));

  const name = el('h2', 'ph-vh', words.panel.name.text);
  name.id = `ph-name-${n}`;

  // the bumper's top: the speaker, the line's tape and its lamp, the close key
  const top = el('div', 'ph-top');
  const speaker = el('span', 'ph-speaker');
  speaker.setAttribute('aria-hidden', 'true');
  const tape = el('p', 'ph-tape');
  const tapeText = el('span', 'ph-tape-text');
  tape.append(tapeText);
  const lamp = el('span', 'ph-lamp');
  lamp.setAttribute('aria-hidden', 'true');
  const close = el('button', 'ph-close', words.panel.close.text);
  close.type = 'button';
  close.setAttribute('aria-label', words.panel.closeName.text);
  top.append(speaker, tape, lamp, close);

  // the screen
  const screen = el('div', 'ph-screen');
  const head = el('div', 'ph-head');
  const avatar = el('span', 'ph-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  head.append(avatar, el('span', 'ph-who', words.panel.who.text));

  const log = el('ol', 'ph-log');
  log.setAttribute('aria-label', words.conversation.name.text);
  log.tabIndex = -1;

  const ready = el('div', 'ph-ready');
  ready.setAttribute('role', 'group');
  ready.setAttribute('aria-label', words.ready.name.text);

  const form = el('form', 'ph-compose');
  form.noValidate = true;
  const label = el('label', 'ph-vh', words.compose.label.text);
  const input = el('input', 'ph-field');
  input.id = `ph-field-${n}`;
  label.htmlFor = input.id;
  input.type = 'text';
  input.maxLength = MAX_CHARS;
  input.autocomplete = 'off';
  input.spellcheck = true;
  input.enterKeyHint = 'send';
  const count = el('span', 'ph-count');
  count.setAttribute('aria-live', 'polite');
  const send = el('button', 'ph-send', words.compose.send.text);
  send.type = 'submit';
  form.append(label, input, count, send);

  screen.append(head, log, ready, form);
  body.append(name, top, screen);

  const live = el('div', 'ph-vh');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');

  root.append(body, live);
  (o.parent ?? document.body).append(root);

  // ── drawing ──
  let readyFor_: Jack | null | undefined;

  function drawItem(it: Item): HTMLLIElement {
    const li = el('li', `ph-item ph-${it.kind}`);
    switch (it.kind) {
      case 'line':
        li.append(el('span', 'ph-line-name', lineName(it.jack)));
        break;
      case 'sent':
        li.append(el('span', 'ph-vh', words.conversation.you.text + ' '), el('span', 'ph-words', it.text));
        break;
      case 'working': {
        li.style.setProperty('--tilt', `${tilt(it.id, 0.5).toFixed(2)}deg`);
        const dots = el('span', 'ph-dots');
        dots.setAttribute('aria-hidden', 'true');
        dots.append(el('i'), el('i'), el('i'));
        li.append(el('span', 'ph-vh', words.conversation.working.text), dots);
        break;
      }
      case 'answer':
        li.style.setProperty('--tilt', `${tilt(it.id, 0.5).toFixed(2)}deg`);
        if (it.refused) li.classList.add('ph-refused');
        li.append(el('span', 'ph-vh', words.conversation.patch.text + ' '), el('span', 'ph-words', it.text));
        break;
    }
    return li;
  }

  function drawLog(): void {
    log.replaceChildren(...state.items.map(drawItem));
    log.scrollTop = log.scrollHeight;
  }

  function drawReady(): void {
    if (readyFor_ === state.jack) return;
    readyFor_ = state.jack;
    const hadFocus = ready.contains(document.activeElement);
    const { own, every } = readyFor(state.jack);
    const row = (texts: readonly string[], cls: string): HTMLElement => {
      const r = el('div', `ph-keys ${cls}`);
      for (const t of texts) {
        const b = el('button', 'ph-key', t);
        b.type = 'button';
        b.addEventListener('click', () => submit(t));
        r.append(b);
      }
      return r;
    };
    ready.replaceChildren(row(own, 'ph-keys-own'), row(every, 'ph-keys-every'));
    if (hadFocus) firstFocus()?.focus();
  }

  function drawHead(): void {
    tapeText.textContent = lineName(state.jack);
    root.classList.toggle('ph-unplugged', state.jack === null);
    root.classList.toggle('ph-busy', isWorking(state));
    const off = state.jack === null;
    input.disabled = off;
    send.disabled = off;
    input.placeholder = off ? words.compose.unplugged.text : words.compose.placeholder.text;
  }

  function drawCount(): void {
    count.textContent = charsLeft(input.value) ?? '';
  }

  function draw(): void {
    drawHead();
    drawLog();
    drawReady();
    drawCount();
  }

  // ── the line ──
  function say(text: string): void {
    // clear first so the same words twice are announced twice
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  const unsubscribe = line.subscribe((e: PhoneEvent) => {
    const before = state;
    state = reduce(state, e);
    draw();
    if (e.type === 'jack') {
      if (isOpen) place();
      say(lineAnnouncement(e.jack));
    } else if (e.type === 'reply' || e.type === 'refused') {
      const a = state.items.find((i) => i.kind === 'answer' && i.id === e.id);
      if (a && a.kind === 'answer') say(a.text);
    } else if (e.type === 'working' && !isWorking(before)) {
      say(words.conversation.working.text);
    }
  });

  function submit(text: string): void {
    const t = toSend(text);
    if (t === null || state.jack === null) return;
    line.send(t);
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = toSend(input.value);
    if (t === null) return;
    submit(t);
    input.value = '';
    drawCount();
  });
  input.addEventListener('input', drawCount);
  close.addEventListener('click', () => panel.close());
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      panel.close();
    }
  });

  // ── placing it ──
  const sheet = matchMedia(SHEET_QUERY);

  function place(): void {
    const isSheet = sheet.matches;
    root.classList.toggle('ph-sheet', isSheet);
    root.classList.toggle('ph-wide', !isSheet);
    if (isSheet) {
      root.style.left = root.style.right = root.style.top = root.style.width = root.style.height = '';
      return;
    }
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = Math.min(WIDE_W, vw - MARGIN * 2);
    const h = Math.min(WIDE_MAX_H, vh - MARGIN * 2);
    const top = Math.round((vh - h) / 2);
    const avoid = o.avoid?.(state.jack) ?? null;
    const anchor = o.anchor?.() ?? null;
    const lefts = [MARGIN, vw - MARGIN - w];
    const cover = (x: number): number => {
      if (!avoid) return 0;
      const ox = Math.max(0, Math.min(x + w, avoid.right) - Math.max(x, avoid.left));
      const oy = Math.max(0, Math.min(top + h, avoid.bottom) - Math.max(top, avoid.top));
      return ox * oy;
    };
    // the side that covers less of the station; on a tie, the phone's own side
    const near = (x: number): number => (anchor ? Math.abs(x + w / 2 - (anchor.left + anchor.width / 2)) : x === lefts[1] ? 0 : 1);
    const [a, b] = lefts as [number, number];
    const left = cover(a) !== cover(b) ? (cover(a) < cover(b) ? a : b) : near(a) <= near(b) ? a : b;
    Object.assign(root.style, { left: `${left}px`, right: '', top: `${top}px`, width: `${w}px`, height: `${h}px` });
  }

  const onResize = (): void => {
    if (isOpen) place();
  };
  addEventListener('resize', onResize);
  sheet.addEventListener('change', onResize);

  // ── picking it up and putting it down ──
  function fromAnchor(): Keyframe | null {
    const a = o.anchor?.();
    if (!a || a.width === 0) return null;
    const r = root.getBoundingClientRect();
    const s = Math.max(0.04, Math.min(a.width / r.width, a.height / r.height));
    const dx = a.left + a.width / 2 - (r.left + r.width / 2);
    const dy = a.top + a.height / 2 - (r.top + r.height / 2);
    return { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-9deg)`, opacity: 0.35 };
  }

  function firstFocus(): HTMLElement | null {
    return ready.querySelector<HTMLButtonElement>('.ph-key') ?? (input.disabled ? close : input);
  }

  /**
   * (I1 R2) The panel is never stranded between open and shut. Every animation on it is cancelled before it
   * moves again (a finished one with `fill` would otherwise hold it at the phone's size under the next opening:
   * Taylor's "opens the size of the phone and there's no way to fix it"), none keeps a fill, and a timer puts it in
   * the state it is meant to be in when its move should be over, whatever happened to the animation meanwhile
   * (a background tab, a cancelled frame).
   */
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  function stopMoving(): void {
    for (const a of root.getAnimations()) a.cancel();
    anim = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  }
  function settle(): void {
    stopMoving();
    root.hidden = !isOpen;
  }
  function settleAfter(ms: number): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, ms + 120);
  }

  const panel: PhonePanel = {
    element: root,
    get isOpen() {
      return isOpen;
    },
    open(to) {
      if (isOpen) return;
      isOpen = true;
      returnTo = to ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
      stopMoving();
      root.hidden = false;
      place();
      draw();
      firstFocus()?.focus({ preventScroll: true });
      const from = reduced() ? null : fromAnchor();
      if (from) {
        anim = root.animate(
          [
            from,
            { transform: 'translate(0px, -8px) scale(1) rotate(0.8deg)', opacity: 1, offset: 0.75 },
            { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 },
          ],
          { duration: 380, easing: 'cubic-bezier(.3,0,.25,1)' },
        );
        anim.onfinish = settle;
        settleAfter(380);
      }
      o.onToggle?.(true);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      stopMoving();
      const to = reduced() ? null : fromAnchor();
      if (to) {
        // held at its end (no flash of the full panel before it is hidden) until `settle` hides it and cancels it:
        // nothing is left holding it after that
        anim = root.animate([{ transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 }, to], { duration: 220, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' });
        anim.onfinish = settle;
        settleAfter(220);
      } else settle();
      if (root.contains(document.activeElement) || document.activeElement === document.body) returnTo?.focus({ preventScroll: true });
      o.onToggle?.(false);
    },
    place,
    destroy() {
      unsubscribe();
      removeEventListener('resize', onResize);
      sheet.removeEventListener('change', onResize);
      stopMoving();
      root.remove();
    },
  };
  draw();
  return panel;
}
