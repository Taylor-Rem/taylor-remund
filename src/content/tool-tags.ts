import toolTagsJson from './tool-tags.json';
import { resume } from './resume.ts';
import { BENCH_PROJECTS } from './bench-projects.ts';

/**
 * P4 T2: what each tool on the tool wall stands for (tool-tags.json): the published tags it is, and from them what it
 * lights when it is lifted: every project crate whose entry on /resume/ carries one of them, and Patchlamp's station
 * if Patchlamp's entry does. Computed here, never listed by hand (tests/unit/content/tool-tags.test.ts).
 */

interface Raw {
  tools: Record<string, { tags: string[]; source: string }>;
}
const raw = toolTagsJson as unknown as Raw;

/** Each tool's tags, by its kind (view/kit/pieces/toolwall TOOL_KINDS). */
export const TOOL_TAGS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(raw.tools).map(([k, v]) => [k, v.tags]));
/** Each tool's source line, for the checks. */
export const TOOL_TAG_SOURCES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(raw.tools).map(([k, v]) => [k, v.source]));

/** Every tag published on /resume/ #projects. */
export const PUBLISHED_TAGS: ReadonlySet<string> = new Set(resume.projects.entries.flatMap((e) => e.tags.map((t) => t.text)));

/** The id the Patchlamp station answers to in `toolLights` (its entry is the résumé's "Patchlamp" card). */
export const PATCHLAMP = 'patchlamp';

/** The things a tool lights: project ids (bench-projects.json) and, if Patchlamp's entry carries one of its tags, `patchlamp`. */
export function toolLights(kind: string): string[] {
  const tags = new Set(TOOL_TAGS[kind] ?? []);
  const out = Object.values(BENCH_PROJECTS)
    .filter((p) => p.tools.some((t) => tags.has(t)))
    .map((p) => p.id);
  const pl = resume.projects.entries.find((e) => e.title.text === 'Patchlamp');
  if (pl && pl.tags.some((t) => tags.has(t.text))) out.push(PATCHLAMP);
  return out;
}
