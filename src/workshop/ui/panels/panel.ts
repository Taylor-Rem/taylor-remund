/**
 * The one panel a brass plate opens over the stage (REWRITE.md § B7
 * "Hatches", § E9; P4 H1): a <dialog> on paper.
 *
 *   - On a wide screen it stands at the side and is NOT modal (round 2), like
 *     the controls list, the settings and the phone's panel: the bench beside
 *     it stays fully playable, so the maker's plate shows the bench's changes
 *     as the visitor makes them. Focus goes in on opening and back on closing;
 *     it is not trapped. While focus is inside, no key reaches the stage; a
 *     press on the stage leaves the panel open and the stage takes keys again.
 *     Esc closes it when focus is inside; with focus on the stage, Esc is the
 *     stage's (the camera's "back", § B6), as with the phone's panel.
 *   - On a phone (the sheet) it is modal: the page behind is inert, Tab stays
 *     inside, Esc, Close or a press on the bench above closes it; no key
 *     reaches the stage wherever the browser leaves focus.
 *   - opened by id (ids.ts): focus goes to its heading; a second plate swaps
 *     the content in place;
 *   - what it shows is in the page already, never a second copy: a project's
 *     card is the <template> the page drew with /resume/'s own component
 *     (src/components/paper/Panels.astro); Patchlamp's hatch, the maker's plate
 *     and contact are the paperwork's own sections (#patchlamp-toy, #maker,
 *     #contact), cloned, with the parts only the stage has (the live workings,
 *     the address to copy) from the page's templates;
 *   - no slide under reduced motion (panel.css).
 *
 * It holds no words: they are the page's (src/content/hatches.json, drawn
 * into the markup and `#pn-words`).
 */
import './panel.css';
import type { PanelId } from './ids.ts';

export interface PanelsOptions {
  readonly doc?: Document;
  /** Told after a panel's content is in and it is open (the maker's plate starts its live lines here). */
  onOpen?(id: PanelId, body: HTMLElement): void;
  onClose?(id: PanelId): void;
}

export interface Panels {
  readonly current: PanelId | null;
  /** Open `id` (replacing what is open). False when the page has nothing for it. */
  open(id: PanelId, returnTo?: HTMLElement | null): boolean;
  close(): void;
  destroy(): void;
}

/** Each section the paperwork holds for a panel, and the template that adds what only the stage has. */
const FROM_PAPERWORK: Readonly<Record<string, { section: string; extra?: string }>> = {
  patchlamp: { section: 'patchlamp-toy' },
  maker: { section: 'maker', extra: 'pn-live' },
  contact: { section: 'contact', extra: 'pn-address' },
};

/** (P4 T2) A panel drawn whole into a template of its own (src/components/paper/Panels.astro). */
const FROM_TEMPLATE: Readonly<Record<string, string>> = { skills: 'pn-skills' };

/** At or below this width the panel is a modal sheet from the bottom (panel.css says the same). */
const SHEET_QUERY = '(max-width: 640px)';

/** A clone's ids get this prefix, so nothing in the panel shares an id with the paperwork behind it. */
const PREFIX = 'pn-';

function reId(root: ParentNode): void {
  const map = new Map<string, string>();
  for (const el of root.querySelectorAll<HTMLElement>('[id]')) {
    if (el.id.startsWith(PREFIX)) continue;
    const to = PREFIX + el.id;
    map.set(el.id, to);
    el.id = to;
  }
  for (const attr of ['aria-labelledby', 'aria-describedby', 'for']) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const v = el.getAttribute(attr)!;
      el.setAttribute(attr, v.split(/\s+/).map((x) => map.get(x) ?? x).join(' '));
    }
  }
}

export function createPanels(o: PanelsOptions = {}): Panels | null {
  const doc = o.doc ?? document;
  const found = doc.getElementById('plate-panel') as HTMLDialogElement | null;
  if (!found || typeof found.showModal !== 'function') return null;
  const dialog: HTMLDialogElement = found;
  const body = dialog.querySelector<HTMLElement>('.pn-body')!;
  const closeButton = dialog.querySelector<HTMLButtonElement>('.pn-close')!;
  const said = dialog.querySelector<HTMLElement>('.pn-said')!;
  let current: PanelId | null = null;
  let returnTo: HTMLElement | null = null;

  const content = (id: PanelId): DocumentFragment | null => {
    const frag = doc.createDocumentFragment();
    if (id.startsWith('project:')) {
      const t = doc.getElementById('pn-projects') as HTMLTemplateElement | null;
      const card = t?.content.querySelector(`[data-panel="${id}"]`);
      if (!card) return null;
      frag.append(card.cloneNode(true));
      return frag;
    }
    // (P4 T2) the tool wall's sheet: the skills list, from its template (/resume/'s own component drew it)
    const tpl = FROM_TEMPLATE[id];
    if (tpl) {
      const t = doc.getElementById(tpl) as HTMLTemplateElement | null;
      if (!t) return null;
      frag.append(t.content.cloneNode(true));
      return frag;
    }
    const from = FROM_PAPERWORK[id];
    const section = from ? doc.getElementById(from.section) : null;
    if (!from || !section) return null;
    const copy = section.cloneNode(true) as HTMLElement;
    if (from.extra) {
      const t = doc.getElementById(from.extra) as HTMLTemplateElement | null;
      if (t) copy.append(t.content.cloneNode(true));
    }
    frag.append(copy);
    return frag;
  };

  const heading = (): HTMLElement | null => body.querySelector<HTMLElement>('h2, h3');

  function open(id: PanelId, to?: HTMLElement | null): boolean {
    if (id === 'resume') {
      doc.defaultView?.location.assign('/resume/');
      return true;
    }
    const frag = content(id);
    if (!frag) return false;
    if (current !== null && current !== id) o.onClose?.(current);
    reId(frag);
    body.replaceChildren(frag);
    said.textContent = '';
    const h = heading();
    if (h) {
      h.tabIndex = -1;
      dialog.setAttribute('aria-labelledby', h.id);
    }
    dialog.dataset['panel'] = id;
    if (!dialog.open || !dialog.contains(doc.activeElement)) {
      // where focus goes back to: what had it before the panel did (a second plate pressed on the stage while the
      // panel is open counts as a new opening from the stage)
      const a = doc.activeElement as HTMLElement | null;
      returnTo = to ?? (a && a !== doc.body && !dialog.contains(a) ? a : null);
    }
    if (!dialog.open) present();
    current = id;
    body.scrollTop = 0;
    (h ?? closeButton).focus({ preventScroll: true });
    o.onOpen?.(id, body);
    return true;
  }

  function close(): void {
    if (!dialog.open) return;
    const was = current;
    const hadFocus = dialog.contains(doc.activeElement) || doc.activeElement === doc.body || doc.activeElement === null;
    current = null;
    dialog.close();
    if (was) o.onClose?.(was);
    body.replaceChildren();
    const back = returnTo;
    returnTo = null;
    // focus goes back where it was, unless the visitor has already taken it elsewhere (the stage, beside the panel)
    if (hadFocus && back && back.isConnected) back.focus({ preventScroll: true });
  }

  /** Shown as this width wants it: a modal sheet on a phone, a non-modal panel at the side of a wide screen. */
  const sheet = doc.defaultView?.matchMedia(SHEET_QUERY) ?? null;
  function present(): void {
    if (sheet?.matches) dialog.showModal();
    else dialog.show();
  }
  /** The width crossed the line while open: shown again the other way, the content and focus kept. */
  const onSheetChange = (): void => {
    if (!dialog.open) return;
    const focused = dialog.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : null;
    dialog.close();
    present();
    focused?.focus({ preventScroll: true });
  };
  sheet?.addEventListener('change', onSheetChange);

  // ── closing: Esc (the dialog's own cancel), Close, a press on the stage around the sheet ──
  const onCancel = (e: Event): void => {
    e.preventDefault();
    close();
  };
  const onClick = (e: MouseEvent): void => {
    if (e.target === dialog) close(); // the sheet's backdrop (modal only: a side panel has none)
    const copy = (e.target as HTMLElement | null)?.closest?.('.pn-copy');
    if (copy) void copyAddress(copy as HTMLElement);
  };
  // no key from inside the panel reaches the page's listeners (the stage's M, U, ?); Esc closes it (a side panel's
  // dialog has no cancel of its own in every browser)
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  };
  // The sheet (modal): no key from outside it either. A browser may let focus fall to the page while a modal
  // dialog is open (WebKit gives Tab back to the document after the last control), and the stage answers keys aimed
  // at the page itself: such a key goes nowhere, and Tab brings focus back into the panel. A side panel is not
  // modal: there a key on the stage is the stage's.
  const win = doc.defaultView;
  const modal = (): boolean => {
    try {
      return dialog.matches(':modal');
    } catch {
      return !!sheet?.matches;
    }
  };
  const onStrayKey = (e: KeyboardEvent): void => {
    if (!dialog.open || !modal() || dialog.contains(e.target as Node | null)) return;
    e.stopImmediatePropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      (heading() ?? closeButton).focus({ preventScroll: true });
    }
  };
  win?.addEventListener('keydown', onStrayKey, true);
  const onClosed = (): void => {
    // closed by something else (the browser, a form): tidy as Close does (not when it was only shown again the
    // other way for a new width: it is open again by the time this event arrives)
    if (current !== null && !dialog.open) {
      const was = current;
      current = null;
      o.onClose?.(was);
    }
  };

  /** The address onto the visitor's own clipboard (nothing leaves the browser); else it is selected to copy by hand. */
  async function copyAddress(button: HTMLElement): Promise<void> {
    const text = button.closest('.pn-address')?.querySelector<HTMLElement>('.pn-mail');
    if (!text) return;
    const done = (): void => {
      said.textContent = '';
      requestAnimationFrame(() => (said.textContent = button.dataset['copied'] ?? ''));
    };
    try {
      await navigator.clipboard.writeText(text.textContent ?? '');
      done();
    } catch {
      const range = doc.createRange();
      range.selectNodeContents(text);
      const sel = doc.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('close', onClosed);
  closeButton.addEventListener('click', close);

  return {
    get current() {
      return current;
    },
    open,
    close,
    destroy() {
      close();
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('keydown', onKey);
      dialog.removeEventListener('close', onClosed);
      closeButton.removeEventListener('click', close);
      win?.removeEventListener('keydown', onStrayKey, true);
      sheet?.removeEventListener('change', onSheetChange);
    },
  };
}
