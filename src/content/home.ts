import homeJson from './home.json';
import { assertContent } from './schema.ts';
import type { FactEntry, UiEntry } from './schema.ts';
import type { LinkEntry } from './resume.ts';
import { ai } from './ai.ts';
import type { Package } from './ai.ts';

/**
 * What the home page's paperwork says (REWRITE.md § B7, § F1): the plain
 * document behind the stage on `/`, carried from the live home page
 * (legacy/index.html) section by section. The section headings are
 * src/content/site.json `paperwork`; the strip is `strip`.
 *
 * Two things are read from elsewhere, never typed here:
 * - the services' names and prices, from src/content/ai.json (the one file
 *   /ai/ uses; CLAUDE.md § Content rules: prices are commitments);
 * - the contact links, from the strip's (site.json `strip.links`), so the
 *   address changes in one place.
 * No Patchlamp price is typed (REWRITE.md § 3): the section links to
 * patchlamp.com/pricing.
 *
 * Paragraph-like texts use the inline form of src/components/paper/inline.ts.
 */

export interface Picture {
  src: string;
  sources: { src: string; width: number }[];
  width: number;
  height: number;
  alt: UiEntry;
}

export interface ServiceCard {
  /** The package's name in ai.json; its name and prices are read from there. */
  package: string;
  text: FactEntry;
}

export interface Home {
  /** Open Graph, as the live home page has it (legacy/index.html); passed to src/layouts/Stage.astro by the
   *  page. Not in site.json, and not imported by the layout: both are inputs of the bench's pictures' hash
   *  (scripts/poster.ts), and a word changed here must not make them stale. */
  og: { title: UiEntry; description: FactEntry; type: string; url: string; image: string };
  patchlamp: { kicker: UiEntry; position: FactEntry; bullets: FactEntry[]; links: LinkEntry[]; picture: Picture };
  services: { eyebrow: UiEntry; intro: FactEntry; cards: ServiceCard[]; more: LinkEntry };
  about: {
    eyebrow: UiEntry;
    paragraphs: FactEntry[];
    photo: { src: string; width: number; height: number; alt: UiEntry };
  };
  contact: { eyebrow: UiEntry; text: FactEntry };
}

export const home = assertContent(homeJson, 'src/content/home.json') as unknown as Home;

/** A service card with its package from ai.json. A card naming no package there stops the build. */
export function serviceCards(): { card: ServiceCard; pkg: Package }[] {
  return home.services.cards.map((card) => {
    const pkg = ai.packages.entries.find((p) => p.name.text === card.package);
    if (!pkg) throw new Error(`src/content/home.json services: no package named ${JSON.stringify(card.package)} in src/content/ai.json`);
    return { card, pkg };
  });
}
