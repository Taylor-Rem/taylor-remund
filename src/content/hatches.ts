import hatchesJson from './hatches.json';
import { assertContent } from './schema.ts';
import type { FactEntry, UiEntry, VoiceEntry } from './schema.ts';
import type { LinkEntry } from './resume.ts';

/**
 * The words of the panels a brass plate opens over the stage on `/`
 * (REWRITE.md § B7 "Hatches", § G "P4 as Taylor amended it"), and of the two
 * hatches' sections in the paperwork, where the same words are for anyone
 * without the stage (P4 H1). Read only by the page's HTML
 * (src/components/paper/PatchlampHatch.astro, MakerPlate.astro, Panels.astro): the workshop's code reads
 * them from the page, so this file is paper-only content
 * (scripts/lib/paper-content.ts) and a change to it never stales the bench's
 * pictures.
 *
 * No Patchlamp price is typed (REWRITE.md § 3): the hatch links to
 * patchlamp.com/pricing. Every Patchlamp sentence names its CLAIMS.md row.
 * Entries marked `provisional` are drafts for Taylor (P4 H1 report).
 */

type Section<T> = { heading: UiEntry; items: T[] };

export interface Hatches {
  panel: { close: UiEntry; list: UiEntry; copy: UiEntry; copied: UiEntry };
  patchlamp: {
    tape: UiEntry;
    title: UiEntry;
    real: { heading: UiEntry; paragraphs: FactEntry[] };
    shows: Section<FactEntry>;
    simplifies: Section<FactEntry>;
    facts: Section<FactEntry>;
    links: LinkEntry[];
  };
  maker: {
    tape: UiEntry;
    title: UiEntry;
    paragraphs: (FactEntry | VoiceEntry)[];
    live: {
      heading: UiEntry;
      tests: { label: UiEntry; value: UiEntry };
      frame: { label: UiEntry; value: UiEntry };
      history: { heading: UiEntry; empty: UiEntry };
      log: {
        field: UiEntry;
        state: UiEntry;
        moved: UiEntry;
        changed: UiEntry;
        byText: UiEntry;
        pulled: UiEntry;
        pulledSent: UiEntry;
        fields: Record<string, UiEntry>;
        values: Record<string, UiEntry>;
        places: Record<string, UiEntry>;
      };
    };
  };
}

export const hatches = assertContent(hatchesJson, 'src/content/hatches.json') as unknown as Hatches;

/** The words the workshop's code fills its live lines with (the plate's log), as plain strings by key. */
export function liveWords(): Record<string, string | Record<string, string>> {
  const l = hatches.maker.live.log;
  const flat = (o: Record<string, UiEntry>): Record<string, string> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.text]));
  return {
    field: l.field.text,
    state: l.state.text,
    moved: l.moved.text,
    changed: l.changed.text,
    byText: l.byText.text,
    pulled: l.pulled.text,
    pulledSent: l.pulledSent.text,
    empty: hatches.maker.live.history.empty.text,
    frame: hatches.maker.live.frame.value.text,
    copied: hatches.panel.copied.text,
    fields: flat(l.fields),
    values: flat(l.values),
    places: flat(l.places),
  };
}
