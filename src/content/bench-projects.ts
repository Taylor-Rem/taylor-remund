import benchProjectsJson from './bench-projects.json';
import { assertContent } from './schema.ts';
import type { FactEntry, UiEntry } from './schema.ts';
import { resume, type Project } from './resume.ts';

/**
 * P4 S5: the crates on the bench that are Taylor's projects (bench-projects.json), each joined to its published
 * entry on /resume/ (resume.json projects.entries, by its title). The card's words are the entry's own: its title,
 * its subtitle as the one line, its tags as the tools. Nothing here is retyped from the résumé but the stencil (the
 * title in capitals, broken into lines) and who it was built for.
 */

interface Raw {
  projects: Record<string, { resume: string; anchor: string; stencil: FactEntry & { lines: string[] }; for: FactEntry & { lines: string[] } }>;
  card: { plate: UiEntry };
}

const raw = assertContent(benchProjectsJson, 'src/content/bench-projects.json') as unknown as Raw;

export interface BenchProject {
  /** The id the simulation speaks in (sim/scenes/bench.ts PROJECT_OF). */
  readonly id: string;
  /** Its entry on /resume/, as published. */
  readonly entry: Project;
  readonly title: string;
  /** The card's one line: the entry's subtitle. */
  readonly line: string;
  /** The card's tools: the entry's tags. */
  readonly tools: readonly string[];
  /** The id of its heading on /resume/, and the address of it. */
  readonly anchor: string;
  readonly href: string;
  /** The stencil on the crate, line by line (capitals), and who it was built for, line by line. */
  readonly stencil: readonly string[];
  readonly madeFor: readonly string[];
}

function join(id: string, r: Raw['projects'][string]): BenchProject {
  const entry = resume.projects.entries.find((e) => e.title.text === r.resume);
  if (!entry) throw new Error(`src/content/bench-projects.json: project ${id} names "${r.resume}", which is not a title in resume.json projects.entries`);
  return {
    id,
    entry,
    title: entry.title.text,
    line: entry.subtitle.text,
    tools: entry.tags.map((t) => t.text),
    anchor: r.anchor,
    href: `/resume/#${r.anchor}`,
    stencil: r.stencil.lines,
    madeFor: r.for.lines,
  };
}

/** Every project crate's words, by project id. */
export const BENCH_PROJECTS: Readonly<Record<string, BenchProject>> = Object.fromEntries(Object.entries(raw.projects).map(([id, r]) => [id, join(id, r)]));

/** The raw entries (the stencil and the mark, with their sources), for the checks. */
export const BENCH_PROJECTS_RAW = raw.projects;

/** The brass plate's words on every card. */
export const CARD_PLATE: string = raw.card.plate.text;

/** A project's words, or throws (an id the simulation speaks in that content does not have is a bug). */
export function benchProject(id: string): BenchProject {
  const p = BENCH_PROJECTS[id];
  if (!p) throw new Error(`bench-projects: no project ${JSON.stringify(id)} (known: ${Object.keys(BENCH_PROJECTS).join(', ')})`);
  return p;
}
