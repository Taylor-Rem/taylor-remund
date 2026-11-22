/**
 * How a published project is named in an address (REWRITE.md § F2: "Other
 * projects: crates that open | /resume/#projects"). One rule, used by
 * /resume/ for its entries' anchors and by the workshop's project cards for
 * the panel a crate's plate opens, so a plate, a card and the résumé always
 * agree on which project is meant.
 *
 *   slug          "Clean & Green Inspections" → "clean-green-inspections"
 *   anchor        the entry's title id on /resume/: "p-clean-green-inspections"
 *   panel id      "project:clean-green-inspections" (src/workshop/ui/panels/ids.ts)
 */
import type { Project } from '../../content/resume.ts';

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A project's slug, from its published title. */
export const projectSlug = (e: Project): string => slug(e.title.text);

/** The id of the entry's title on /resume/ (the place a card links to). */
export const projectAnchor = (e: Project): string => `p-${projectSlug(e)}`;
