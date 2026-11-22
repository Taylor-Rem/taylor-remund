/**
 * The one panel a brass plate opens over the stage (REWRITE.md § B7
 * "Hatches", § E9; P4 H1): a modal <dialog> on paper, at the side of a wide
 * screen and a sheet from the bottom on a phone. The stage keeps running
 * behind it and takes no keys while it is open (the dialog makes the rest of
 * the page inert, and no key inside it reaches the stage's listeners).
 *
 *   - opened by id (ids.ts): focus goes to its heading; Tab stays inside;
 *   - closed by Esc, its Close button, or a press on the stage around it;
 *     focus goes back to where it was;
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
    if (!dialog.open) {
      const a = doc.activeElement as HTMLElement | null;
      returnTo = to ?? (a && a !== doc.body && !dialog.contains(a) ? a : null);
      dialog.showModal();
    }
    current = id;
    body.scrollTop = 0;
    (h ?? closeButton).focus({ preventScroll: true });
    o.onOpen?.(id, body);
    return true;
  }

  function close(): void {
    if (!dialog.open) return;
    const was = current;
    current = null;
    dialog.close();
    if (was) o.onClose?.(was);
    body.replaceChildren();
    const back = returnTo;
    returnTo = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  // ── closing: Esc (the dialog's own cancel), Close, a press on the stage around the sheet ──
  const onCancel = (e: Event): void => {
    e.preventDefault();
    close();
  };
  const onClick = (e: MouseEvent): void => {
    if (e.target === dialog) close(); // the backdrop: outside the sheet
    const copy = (e.target as HTMLElement | null)?.closest?.('.pn-copy');
    if (copy) void copyAddress(copy as HTMLElement);
  };
  // the stage takes no keys while the panel is open: none from inside it reaches the page's listeners (M, U, ?)
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
  };
  // …and none from outside it either: a browser may let focus fall to the page while the dialog is open (WebKit
  // gives Tab back to the document after the last control), and the stage answers keys aimed at the page itself.
  // While it is open such a key goes nowhere; Tab brings focus back into the panel.
  const win = doc.defaultView;
  const onStrayKey = (e: KeyboardEvent): void => {
    if (!dialog.open || dialog.contains(e.target as Node | null)) return;
    e.stopImmediatePropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      (heading() ?? closeButton).focus({ preventScroll: true });
    }
  };
  win?.addEventListener('keydown', onStrayKey, true);
  const onClosed = (): void => {
    // closed by something else (the browser, a form): tidy as Close does
    if (current !== null) {
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
    },
  };
}
