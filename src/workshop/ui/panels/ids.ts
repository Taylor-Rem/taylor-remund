/**
 * What a brass plate must emit to open a panel (REWRITE.md § B7 "Hatches";
 * P4 H1). The plates are objects in the world, built by other packages; the
 * panels are HTML over the stage. They meet in one of two ways, and both
 * carry a panel id:
 *
 *   1. A plate in the world (the simulation, which never touches the DOM)
 *      emits a sim event when it is pressed:
 *
 *        { type: 'plate.pressed', plate: <PanelId>, by: <the plate's interactable id> }
 *
 *      The panels hear every frame's events (`Workshop.onFrame`) and open the
 *      one named. The plate needs no other wiring; undo and the history never
 *      see it (opening a panel is not a durable change, § E5 rule 13).
 *
 *   2. Anything in the page (the controls list, a development flag, a test)
 *      dispatches a DOM event on `document`:
 *
 *        document.dispatchEvent(new CustomEvent('workshop:panel', { detail: { panel: <PanelId> } }))
 *
 * Panel ids:
 *   project:<slug>   a project's card: its published /resume/ entry (slug: src/components/paper/projects.ts,
 *                    "Clean & Green Inspections" → "clean-green-inspections"; the résumé anchor
 *                    "p-clean-green-inspections" is accepted too)
 *   patchlamp        Patchlamp's hatch
 *   maker            the maker's plate (how the site was built, the bench's own workings live)
 *   contact          the mailbox
 *   resume           the clipboard: not a panel; the page goes to /resume/
 *   skills           (P4 T2) the tool wall's pinned sheet: the full skills list as /resume/ #skills publishes it
 *
 * The development flag: `/?panel=<id>` opens that panel once the bench is usable.
 */

export type PanelId = `project:${string}` | 'patchlamp' | 'maker' | 'contact' | 'resume' | 'skills';

/** The DOM event's name. */
export const PANEL_EVENT = 'workshop:panel';
/** The sim event's type. */
export const PLATE_PRESSED = 'plate.pressed';

/** A panel id as the panels know it, or null for anything else. `project:p-<slug>` (a résumé anchor) is read as `project:<slug>`. */
export function panelId(v: unknown): PanelId | null {
  if (typeof v !== 'string') return null;
  if (v === 'patchlamp' || v === 'maker' || v === 'contact' || v === 'resume' || v === 'skills') return v;
  const m = /^project:(?:p-)?([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(v);
  return m ? `project:${m[1]!}` : null;
}

/** The panel a frame's sim event asks for, or null (any event that is not a plate's). */
export function platePanel(e: { readonly type: string }): PanelId | null {
  return e.type === PLATE_PRESSED ? panelId((e as { plate?: unknown }).plate) : null;
}
