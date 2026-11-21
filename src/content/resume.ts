import resumeJson from './resume.json';
import { assertContent } from './schema.ts';
import type { Entry, FactEntry, UiEntry, VoiceEntry } from './schema.ts';

/**
 * Everything /resume/ says (REWRITE.md § F1), carried word for word from the
 * live page (legacy/resume/index.html) with the one correction of § 1 (the
 * Artificer macro). Validated on load.
 *
 * Paragraph-like texts use the small inline form of
 * src/components/paper/inline.ts: `code`, **bold**, *em*, [text](href).
 */

export interface LinkEntry extends UiEntry {
  href: string;
}
/** A project link; `private` marks the live page's disabled "Private Repo" mark (no link). */
export type ProjectLink = LinkEntry | (UiEntry & { private: true });

export interface Project {
  /** An anchor the page must keep (`patchlamp`, REWRITE.md § 2). */
  id?: string;
  label: FactEntry;
  title: FactEntry;
  subtitle: FactEntry;
  paragraphs: FactEntry[];
  tags: FactEntry[];
  links: ProjectLink[];
}

export interface Role {
  title: FactEntry;
  employer: FactEntry;
  dates: FactEntry;
  place: FactEntry;
  bullets: FactEntry[];
}

export interface SkillItem extends FactEntry {
  /** Symbol id in /assets/skill-icons.svg; absent where the live page showed no icon. */
  icon?: string;
}

export interface Resume {
  page: {
    title: UiEntry;
    description: FactEntry;
    og: { title: UiEntry; description: FactEntry; type: string; url: string };
  };
  nav: { projects: LinkEntry; experience: LinkEntry; contact: LinkEntry };
  about: {
    eyebrow: UiEntry;
    heading: VoiceEntry;
    subtitle: FactEntry;
    paragraphs: FactEntry[];
    photo: { src: string; width: number; height: number; alt: UiEntry };
  };
  figures: { number: FactEntry; label: FactEntry }[];
  skills: { eyebrow: UiEntry; heading: UiEntry; groups: { title: UiEntry; items: SkillItem[] }[] };
  projects: { eyebrow: UiEntry; heading: UiEntry; intro: FactEntry; entries: Project[] };
  experience: { eyebrow: UiEntry; heading: UiEntry; roles: Role[] };
  contact: { eyebrow: UiEntry; heading: VoiceEntry; text: FactEntry; links: LinkEntry[] };
  person: { locality: FactEntry; region: FactEntry };
}

export const resume = assertContent(resumeJson, 'src/content/resume.json') as unknown as Resume;

export function isLink(l: ProjectLink): l is LinkEntry {
  return typeof (l as Entry).href === 'string';
}
