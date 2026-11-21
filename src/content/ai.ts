import aiJson from './ai.json';
import { assertContent } from './schema.ts';
import type { FactEntry, UiEntry, VoiceEntry } from './schema.ts';
import type { LinkEntry } from './resume.ts';

/**
 * Everything /ai/ says (REWRITE.md § 2, § F1): the services page, carried word
 * for word from the live page (legacy/ai/index.html), generated from it, not
 * retyped. Its prices are commitments (CLAUDE.md § Content rules): never
 * changed, rounded, reworded or reordered. Validated on load.
 *
 * Paragraph-like texts use the small inline form of
 * src/components/paper/inline.ts: `code`, **bold**, *em*, [text](href).
 */

export interface ActionLink extends LinkEntry {
  /** The live page's one call to action in that row (its .nav-cta / first .pl-btn). */
  cta?: boolean;
  primary?: boolean;
}

export interface Package {
  name: UiEntry;
  for: FactEntry;
  /** Set large at the head of the entry. */
  price: FactEntry;
  /** Under the price: its unit and terms (" · " separates the parts). */
  priceNote: FactEntry;
  items: FactEntry[];
  action: LinkEntry;
}

export interface Ai {
  page: {
    title: UiEntry;
    description: FactEntry;
    og: { title: UiEntry; description: FactEntry; type: string; url: string };
  };
  /** The live page's own nav (without "Home": the layout's name links home). */
  nav: ActionLink[];
  hero: { kicker: UiEntry; heading: VoiceEntry; tagline: FactEntry; actions: LinkEntry[] };
  how: {
    eyebrow: UiEntry;
    heading: UiEntry;
    intro: VoiceEntry;
    steps: { number: UiEntry; title: UiEntry; body: FactEntry }[];
    note: FactEntry;
  };
  packages: { eyebrow: UiEntry; heading: UiEntry; intro: FactEntry; entries: Package[]; note: FactEntry };
  patchlamp: { kicker: UiEntry; heading: VoiceEntry; body: FactEntry; price: FactEntry; links: ActionLink[] };
  why: { eyebrow: UiEntry; heading: UiEntry; figures: { number: FactEntry; label: FactEntry }[]; body: FactEntry };
  faq: { eyebrow: UiEntry; heading: UiEntry; items: { question: UiEntry; answer: FactEntry }[] };
  contact: { heading: VoiceEntry; body: FactEntry; actions: LinkEntry[] };
}

export const ai = assertContent(aiJson, 'src/content/ai.json') as unknown as Ai;
