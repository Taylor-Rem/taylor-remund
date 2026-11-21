import caseStudiesJson from './case-studies.json';
import { assertContent } from './schema.ts';
import type { FactEntry, UiEntry } from './schema.ts';

/**
 * The case studies (REWRITE.md § F1): long-form pages the résumé links to,
 * carried word for word from the live pages (legacy/case-studies/), generated
 * from them, not retyped. Validated on load.
 *
 * They describe his employer's system: described, never quoted or linked
 * beyond his public repositories (REWRITE.md § 3).
 *
 * Paragraph-like texts use the small inline form of
 * src/components/paper/inline.ts: `code`, **bold**, *em*, [text](href).
 */

/** The article, in order: headings, paragraphs, lists, and the closing pointer. */
export type Block =
  | (UiEntry & { type: 'h2' })
  | (FactEntry & { type: 'p' })
  | { type: 'ul'; items: FactEntry[] }
  | (UiEntry & { type: 'pointer' });

export interface CaseStudy {
  /** URL path (`/case-studies/ledger-repair/`). */
  path: string;
  /** The id of the live page's article section. */
  id: string;
  page: {
    title: UiEntry;
    description: FactEntry;
    og: { title: UiEntry; description: FactEntry; type: string; url: string };
  };
  eyebrow: UiEntry;
  heading: UiEntry;
  meta: FactEntry;
  intro: FactEntry;
  blocks: Block[];
}

export const caseStudies = assertContent(caseStudiesJson, 'src/content/case-studies.json') as unknown as Record<string, CaseStudy>;

export function caseStudy(slug: string): CaseStudy {
  const c = caseStudies[slug];
  if (!c) throw new Error(`no case study ${JSON.stringify(slug)} in src/content/case-studies.json`);
  return c;
}
