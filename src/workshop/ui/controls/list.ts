/**
 * The controls list on `/` (P3 B2; REWRITE.md § B6 keyboard column, § B7,
 * § E9): every interactable a real `<button>`, grouped by station, in the
 * page's Tab order after the strip and before the legal line. It drives the
 * SAME recogniser the canvas's keys drive (input/dom.ts `focusOn`, `key`,
 * `chooseDestination`), so pointer, touch and keys never disagree about what
 * is held.
 *
 *   - Focus on a thing's button: the stage marks it (view/stations/focus.ts)
 *     and frames its station when focus moves into a new one; inside a
 *     station the camera keeps still while the thing is comfortably in view.
 *     Either way, once the camera rests, the thing lies in what the page
 *     leaves uncovered (the strip, this list, the legal line): `Framing.bring`
 *     in shell/boot.ts holds the rule.
 *   - Enter or Space (a click, as a screen reader sends it): a handle is
 *     used; a part is picked up, and the list becomes its destinations (the
 *     mouths that would take it; the jacks, for the plug): focus one and the
 *     part goes over it, Enter puts it there, Esc or "Put it down here" puts
 *     it down where it is held. The arrows still move what is held.
 *   - A station's heading is a button: Enter frames the station and the
 *     address names it (`/#patchlamp`); Back, Esc or pinching out return to
 *     the whole bench and the bare address.
 *   - The other keys of § B6 work in the list as on the stage: arrows pan
 *     (or turn a focused dial or lever), + and − zoom, U undoes, M mutes
 *     (shell/boot.ts hears it anywhere), Esc backs out; `?` anywhere on the
 *     page opens the list and puts focus in it.
 *   - Seen or not: visually hidden until focus is inside it or it was opened
 *     (`?`, or the strip's opener); Esc closes it and focus returns to where
 *     it was. A screen reader finds it whether or not it is shown.
 *
 * What happened is said in the live region beside it (announce.ts).
 */
import type { Id } from '../../sim/types.ts';
import type { FrameWhy, Workshop } from '../../shell/boot.ts';
import { readingFor, stationFor } from '../strip/strip.ts';
import { listModel, modelKey, projectOf, type ControlsSource, type ListModel } from './model.ts';
import { Announcer } from './announce.ts';
import { LIST, SAID } from './words.ts';
import { PANEL_EVENT } from '../panels/ids.ts';

export interface ControlsDom {
  /** The list's section (`#controls`, Controls.astro). */
  readonly root: HTMLElement;
  /** The polite live region. */
  readonly said: HTMLElement;
  /** The strip's opener, if the page has one. */
  readonly opener: HTMLButtonElement | null;
}

/** What a history entry pushed from the bare address to frame a station carries: the way back is Back. */
const FROM_BARE = 'workshop.framedFromBare';
/** How many sentences the live region keeps (older ones are removed: a log, not a transcript). */
const KEEP_SAID = 4;

const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function attachControls(ws: Workshop, dom: ControlsDom): () => void {
  const { root, said, opener } = dom;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const html = doc.documentElement;
  const canvas = ws.stage.canvas;
  // the controls are this list's real buttons now: the canvas is no Tab stop (it keeps its keys when pressed)
  canvas.tabIndex = -1;

  const src: ControlsSource = {
    world: ws.world,
    usable: () => ws.surface.usable?.() ?? [],
    role: (id) => ws.surface.role(id),
    stationOf: (id) => ws.framing.of(id),
    stations: ws.framing.stations,
    get held() {
      return ws.gestures.held;
    },
    get keyHold() {
      return ws.gestures.keyHold;
    },
    get destinations() {
      return ws.gestures.destinations;
    },
    reading: (id) => ws.surface.reading?.(id) ?? null,
  };

  // ── the structure (the section's static heading is Controls.astro's) ──
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.className = cls;
    return e;
  };
  const body = el('div', 'controls-body');
  // Not a Tab stop of its own. Firefox puts a scrolling box in the Tab order, and while the list is hidden (a
  // 1px clip) this one scrolls: Tab from the strip landed on it, the list opened round it, it stopped scrolling,
  // and Firefox dropped the focus to the page, so Tab never reached the list's buttons (E2, 2026-11-21).
  body.tabIndex = -1;
  const hold = el('div', 'controls-hold');
  hold.hidden = true;
  const holdLabel = el('p', 'controls-hold-label');
  holdLabel.id = 'controls-hold-label';
  const dests = el('ul', 'controls-dests');
  dests.setAttribute('aria-labelledby', holdLabel.id);
  const put = el('button', 'controls-put');
  put.type = 'button';
  put.textContent = LIST.putDown;
  hold.append(holdLabel, dests, put);
  const stationsEl = el('div', 'controls-stations');
  body.append(hold, stationsEl);
  // (P4 H1) the Plates group: one button per panel a plate opens over the stage (Patchlamp's hatch, the maker's
  // plate, contact), from the page's own markup (src/components/paper/Panels.astro `#pn-index`); none on a page without it
  const platesEl = platesGroup(doc);
  if (platesEl) body.append(platesEl);
  root.append(body);
  root.hidden = false;

  interface StationEls {
    group: HTMLElement;
    heading: HTMLButtonElement;
    ul: HTMLUListElement;
  }
  const stations = new Map<string, StationEls>();
  const items = new Map<Id, { li: HTMLLIElement; button: HTMLButtonElement }>();
  const destEls = new Map<Id, { li: HTMLLIElement; button: HTMLButtonElement }>();

  const stationEls = (id: string, name: string): StationEls => {
    let s = stations.get(id);
    if (!s) {
      const group = el('section', 'controls-station');
      const heading = el('button', 'controls-heading');
      heading.type = 'button';
      heading.dataset['station'] = id;
      heading.id = `controls-st-${id}`;
      const h = el('h3', 'controls-h');
      h.append(heading);
      const ul = el('ul', 'controls-items');
      ul.setAttribute('aria-labelledby', heading.id);
      group.append(h, ul);
      s = { group, heading, ul };
      stations.set(id, s);
    }
    if (s.heading.textContent !== name) s.heading.textContent = name;
    return s;
  };
  const itemEls = (map: typeof items, id: Id, kind: 'id' | 'dest'): { li: HTMLLIElement; button: HTMLButtonElement } => {
    let it = map.get(id);
    if (!it) {
      const li = el('li', 'controls-item');
      const button = el('button', 'controls-button');
      button.type = 'button';
      button.dataset[kind] = id;
      li.append(button);
      it = { li, button };
      map.set(id, it);
    }
    return it;
  };
  /** P4 S5: the list's links (a project crate's plate): an `<a>` in its item, made once. */
  const links = new Map<Id, { li: HTMLLIElement; a: HTMLAnchorElement }>();
  const linkEls = (id: Id, href: string): { li: HTMLLIElement; a: HTMLAnchorElement } => {
    let it = links.get(id);
    if (!it) {
      const li = el('li', 'controls-item');
      const a = el('a', 'controls-button controls-link');
      a.dataset['link'] = id;
      li.append(a);
      it = { li, a };
      links.set(id, it);
    }
    if (it.a.getAttribute('href') !== href) it.a.href = href;
    return it;
  };
  /** Put `children` into `parent` in this order (moving only what is out of place), removing the rest. */
  const order = (parent: HTMLElement, children: readonly HTMLElement[]): void => {
    children.forEach((c, i) => {
      if (parent.children[i] !== c) parent.insertBefore(c, parent.children[i] ?? null);
    });
    while (parent.children.length > children.length) parent.lastElementChild!.remove();
  };

  // ── drawing the model ──
  let key = '';
  let model: ListModel | null = null;
  /** Restoring focus after a redraw moved the focused button: its focus handler must not act. */
  let quiet = false;
  /** The thing the keys picked up from this list (focus returns to it once it is put down). */
  let pickedFrom: Id | null = null;

  const draw = (m: ListModel): void => {
    const active = doc.activeElement as HTMLElement | null;
    const inList = !!active && root.contains(active);
    const wasHolding = model?.hold ?? null;
    model = m;
    // the stations and their things
    const groups: HTMLElement[] = [];
    const seen = new Set<Id>();
    for (const st of m.stations) {
      const s = stationEls(st.id, st.name);
      groups.push(s.group);
      const lis: HTMLLIElement[] = [];
      for (const it of st.items) {
        if (it.href !== undefined) {
          // (P4 S5) a real link: a project crate's plate, to its entry on /resume/ (it works as any link does)
          const e = linkEls(it.id, it.href);
          if (e.a.textContent !== it.label) e.a.textContent = it.label;
          lis.push(e.li);
          seen.add(it.id);
          continue;
        }
        const e = itemEls(items, it.id, 'id');
        if (e.button.textContent !== it.label) e.button.textContent = it.label;
        e.button.setAttribute('aria-disabled', String(m.busy));
        lis.push(e.li);
        seen.add(it.id);
      }
      order(s.ul, lis);
    }
    for (const [id, e] of items) if (!seen.has(id)) items.delete(id), e.li.remove();
    for (const [id, e] of links) if (!seen.has(id)) links.delete(id), e.li.remove();
    order(stationsEl, groups);
    for (const [id, s] of stations) if (!m.stations.some((x) => x.id === id)) stations.delete(id), s.group.remove();
    // what the keys hold, and where it may go
    const h = m.hold;
    hold.hidden = h === null;
    stationsEl.hidden = h !== null;
    if (platesEl) platesEl.hidden = h !== null;
    if (h) {
      holdLabel.textContent = h.label;
      const lis = h.dests.map((d) => {
        const e = itemEls(destEls, d.id, 'dest');
        if (e.button.textContent !== d.label) e.button.textContent = d.label;
        return e.li;
      });
      for (const [id, e] of destEls) if (!h.dests.some((d) => d.id === id)) destEls.delete(id), e.li.remove();
      order(dests, lis);
    }
    // focus: never lost to a redraw
    if (inList) {
      let target: HTMLElement | null = active && active.isConnected && !active.closest('[hidden]') ? active : null;
      if (h && !wasHolding) target = destEls.get(h.dests[0]?.id ?? '')?.button ?? put; // picked up: where should it go?
      if (!h && wasHolding) {
        const back = pickedFrom ? items.get(pickedFrom)?.button : null;
        target = back ?? stations.get(ws.framing.of(wasHolding.id) ?? '')?.heading ?? stationsEl.querySelector('button');
        pickedFrom = null;
      }
      target ??= stationsEl.querySelector<HTMLButtonElement>('button');
      if (target && doc.activeElement !== target) {
        quiet = target === active;
        target.focus({ preventScroll: true });
        quiet = false;
      }
    }
  };
  const update = (): void => {
    const m = listModel(src);
    const k = modelKey(m);
    if (k === key) return;
    key = k;
    draw(m);
  };

  // ── the live region ──
  const announcer = new Announcer();
  const say = (text: string): void => {
    const p = doc.createElement('p');
    p.textContent = text;
    said.append(p);
    while (said.childElementCount > KEEP_SAID) said.firstElementChild!.remove();
  };

  // ── shown or not, and what of the stage it covers ──
  let open = false;
  /** Where focus was before `?` or the opener opened the list (Esc returns it there). */
  let returnTo: HTMLElement | null = null;
  const shown = (): boolean => open || root.contains(doc.activeElement);
  const strip = doc.querySelector<HTMLElement>('header.strip');
  const legal = doc.querySelector<HTMLElement>('footer.legal');
  const measure = (): void => {
    const W = win.innerWidth;
    const H = win.innerHeight;
    const top = strip ? Math.max(0, strip.getBoundingClientRect().bottom) : 0;
    const bottomLine = legal ? Math.max(0, H - legal.getBoundingClientRect().top) : 0;
    let right = 0;
    let left = 0;
    let topIn = top;
    const bottom = bottomLine;
    // (a phone's sheet hangs from the strip's foot)
    root.style.setProperty('--controls-top', `${Math.round(top + 6)}px`);
    if (shown() && !root.hidden) {
      const r = root.getBoundingClientRect();
      // a panel at the side (wide screens) or a sheet under the strip (a phone)
      if (r.width < W * 0.7) {
        if (r.left < W / 2) left = Math.max(0, r.right);
        else right = Math.max(0, W - r.left);
      } else topIn = Math.max(top, r.bottom);
    }
    // (P4 H1 round three) under the list's own name: a plate's panel says what it covers under its own, and the shell
    // keeps the widest of the two on each side
    ws.framing.setInset({ top: topIn, right, bottom, left }, 'list');
  };
  /** The panel stands on the side the station about to be framed leaves free (then the insets are measured). */
  const sideFor = (st: string | null): void => {
    if (st === null) return;
    root.classList.toggle('left', ws.framing.freeSide(st) === 'left');
    measure();
  };
  const setOpen = (v: boolean): void => {
    open = v;
    root.classList.toggle('open', v);
    opener?.setAttribute('aria-expanded', String(v));
    measure();
  };
  const firstStop = (): HTMLElement | null => {
    const f = ws.gestures.focused;
    if (model?.hold) return destEls.get(ws.gestures.keyHold?.dest ?? '')?.button ?? dests.querySelector('button') ?? put;
    return (f ? items.get(f)?.button : null) ?? stationsEl.querySelector<HTMLButtonElement>('button');
  };
  const openList = (): void => {
    const a = doc.activeElement as HTMLElement | null;
    if (!root.contains(a)) returnTo = a && a !== doc.body ? a : null;
    setOpen(true);
    update();
    firstStop()?.focus({ preventScroll: true });
  };
  const closeList = (): void => {
    const back = returnTo && returnTo.isConnected && returnTo !== canvas ? returnTo : null;
    returnTo = null;
    setOpen(false);
    ws.input.focusOn(null);
    if (back) back.focus({ preventScroll: true });
    else if (root.contains(doc.activeElement)) (doc.activeElement as HTMLElement).blur();
    measure();
  };
  const usable = (): boolean => html.classList.contains('stage-on') && !html.classList.contains('reading') && !(ws.phone?.isOpen ?? false);

  // ── focus, clicks and keys ──
  const idOf = (t: EventTarget | null): { kind: 'id' | 'dest' | 'station' | 'put'; id: string } | null => {
    const b = t instanceof HTMLElement ? t.closest('button') : null;
    if (!b || !root.contains(b)) return null;
    if (b === put) return { kind: 'put', id: '' };
    if (b.dataset['id']) return { kind: 'id', id: b.dataset['id'] };
    if (b.dataset['dest']) return { kind: 'dest', id: b.dataset['dest'] };
    if (b.dataset['station']) return { kind: 'station', id: b.dataset['station'] };
    return null;
  };
  const onFocusIn = (e: FocusEvent): void => {
    // arriving from elsewhere on the page (Tab from the strip): Esc goes back there
    const from = e.relatedTarget as HTMLElement | null;
    if (!open && from && !root.contains(from)) returnTo = from;
    measure();
    if (quiet) return;
    const t = idOf(e.target);
    if (!t) return;
    if (t.kind === 'id') {
      const st = ws.framing.of(t.id);
      if (st !== ws.framing.station) sideFor(st);
      ws.input.focusOn(t.id);
    } else if (t.kind === 'dest') {
      // where it would go is in view (the dock, from the Button's station; the belt's feed on a phone)
      const st = ws.framing.of(t.id);
      if (st !== null && st !== ws.framing.station) sideFor(st);
      ws.framing.bring(t.id);
      ws.input.chooseDestination(t.id);
    } else if (t.kind === 'put') ws.input.chooseDestination(null);
    else if (t.kind === 'station') {
      ws.input.focusOn(null);
      if (ws.framing.station !== t.id) {
        sideFor(t.id);
        ws.framing.frame(t.id, 'focus');
      }
    }
  };
  const onFocusOut = (e: FocusEvent): void => {
    if (root.contains(e.relatedTarget as Node | null)) return;
    // focus left the list: no mark on the stage (what the keys hold stays held, as on the canvas)
    if (!ws.gestures.keyHold) ws.input.focusOn(null);
    // (measured after the focus has gone)
    win.requestAnimationFrame(measure);
  };
  const onClick = (e: MouseEvent): void => {
    // (P4 H1) a plate in the list opens its panel over the stage; a project's plate link goes to /resume/ only when
    // no panel takes it (the page without the panels, a modified click)
    const target = e.target instanceof Element ? e.target : null;
    const plate = target?.closest<HTMLElement>('button[data-panel]');
    if (plate && root.contains(plate)) {
      askPanel(doc, plate.dataset['panel']!, plate);
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('a[data-link]');
    if (link && root.contains(link)) {
      const anchor = new URL(link.href).hash.slice(1);
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0 && anchor && askPanel(doc, `project:${anchor}`, link)) e.preventDefault();
      return;
    }
    const t = idOf(e.target);
    if (!t) return;
    if (t.kind === 'station') {
      ws.framing.frame(t.id, 'select');
      return;
    }
    if (model?.busy && t.kind === 'id') {
      say(SAID.busy);
      return;
    }
    if (t.kind === 'id') {
      ws.input.focusOn(t.id);
      ws.input.key('Enter');
      if (ws.gestures.keyHold) pickedFrom = t.id;
    } else if (t.kind === 'dest') {
      ws.input.chooseDestination(t.id);
      ws.input.key('Enter');
    } else if (t.kind === 'put') {
      ws.input.key('Escape');
    }
    update();
  };
  const PASS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'u', 'U']);
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ws.gestures.keyHold) {
        ws.input.key('Escape'); // put down where it is held
        update();
        return;
      }
      if (ws.framing.station !== null) ws.framing.frame(null, 'back');
      closeList();
      return;
    }
    if (!PASS.has(e.key)) return;
    // the stage's keys, as the canvas takes them, for what this button stands for
    const t = idOf(e.target);
    if (t?.kind === 'id' && ws.gestures.focused !== t.id) ws.input.focusOn(t.id);
    if (ws.input.key(e.key, e.timeStamp)) e.preventDefault();
  };
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== '?' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || editable(e.target) || !usable()) return;
    e.preventDefault();
    openList();
  };
  const onOpener = (): void => {
    if (open) closeList();
    else openList();
  };
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  doc.addEventListener('keydown', onDocKey);
  opener?.addEventListener('click', onOpener);
  opener?.removeAttribute('hidden');
  win.addEventListener('resize', measure);

  // ── the address: a framed station is linkable, and Back backs out (§ B6) ──
  const bare = (): string => win.location.pathname + win.location.search;
  const setAddress = (st: string): void => {
    const now = stationFor(win.location.hash);
    if (now === st) return;
    try {
      if (now === null) win.history.pushState({ ...(win.history.state ?? {}), [FROM_BARE]: true }, '', `#${st}`);
      else win.history.replaceState(win.history.state, '', `#${st}`);
    } catch {
      /* the address is left as it is */
    }
  };
  const clearAddress = (): void => {
    if (stationFor(win.location.hash) === null) return;
    try {
      if ((win.history.state as Record<string, unknown> | null)?.[FROM_BARE]) win.history.back();
      else win.history.replaceState(null, '', bare());
    } catch {
      /* the address is left as it is */
    }
  };
  const offFraming = ws.framing.on((st: string | null, why: FrameWhy) => {
    if (why === 'select') {
      if (st) setAddress(st);
      else clearAddress();
    } else if (why === 'back') clearAddress();
    else if (why === 'focus' && stationFor(win.location.hash) !== null && stationFor(win.location.hash) !== st) {
      // the keys moved on to another station: the address no longer names what is framed
      try {
        win.history.replaceState(null, '', bare());
      } catch {
        /* left */
      }
    }
  });
  const followAddress = (): void => {
    if (readingFor(win.location.hash) !== null) return; // the paperwork's (ui/strip)
    const st = stationFor(win.location.hash);
    if (st !== ws.framing.station) ws.framing.frame(st, 'address');
  };
  win.addEventListener('popstate', followAddress);
  win.addEventListener('hashchange', followAddress);

  // ── every frame: the list follows the bench, and what happened is said ──
  const offFrame = ws.onFrame((frame) => {
    update();
    const sentences = announcer.hear(frame.world, frame.events, { keyHeld: ws.gestures.keyHold ? (ws.gestures.held?.id ?? null) : null, phoneOpen: ws.phone?.isOpen ?? false });
    if (sentences.length > 0) say(sentences.join(' '));
    // (P4 S5) the plate on an open project crate's card pressed on the stage: (P4 H1) its card over the stage, or,
    // where no panel takes it, its entry on /resume/, as its link in this list goes
    for (const e of frame.events) {
      if (e.type !== 'crate.plate') continue;
      const href = projectOf(frame.world, e.crate)?.href;
      if (href && !askPanel(doc, `project:${new URL(href, win.location.href).hash.slice(1)}`, null)) win.location.assign(href);
      break;
    }
  });

  update();
  measure();
  // an address that names a station frames it on arrival
  if (stationFor(win.location.hash) !== null) followAddress();

  return () => {
    offFrame();
    offFraming();
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    doc.removeEventListener('keydown', onDocKey);
    opener?.removeEventListener('click', onOpener);
    win.removeEventListener('resize', measure);
    win.removeEventListener('popstate', followAddress);
    win.removeEventListener('hashchange', followAddress);
    body.remove();
    root.classList.remove('open');
    root.hidden = true;
    opener?.setAttribute('hidden', '');
  };
}

/**
 * (P4 H1) Ask the panels over the stage to open `panel` (src/workshop/ui/panels/ids.ts): true when one did (the
 * panels' handler cancels the event), false when nothing took it (the caller then does what it did before).
 */
function askPanel(doc: Document, panel: string, from: HTMLElement | null): boolean {
  return !doc.dispatchEvent(new CustomEvent(PANEL_EVENT, { cancelable: true, detail: { panel, from } }));
}

/** (P4 H1) The Plates group, drawn from the page's `#pn-index` template (its heading and one button per panel), or null. */
function platesGroup(doc: Document): HTMLElement | null {
  const t = doc.getElementById('pn-index') as HTMLTemplateElement | null;
  if (!t) return null;
  const src = t.content;
  const group = doc.createElement('section');
  group.className = 'controls-station controls-plates';
  const h = doc.createElement('h3');
  h.className = 'controls-h controls-heading controls-plates-title';
  h.id = 'controls-plates-title';
  h.textContent = src.querySelector('.pn-index-title')?.textContent ?? '';
  const ul = doc.createElement('ul');
  ul.setAttribute('aria-labelledby', h.id);
  for (const b of src.querySelectorAll<HTMLButtonElement>('button[data-panel]')) {
    const li = doc.createElement('li');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'controls-button';
    button.dataset['panel'] = b.dataset['panel']!;
    button.textContent = b.textContent;
    li.append(button);
    ul.append(li);
  }
  group.append(h, ul);
  return group;
}
