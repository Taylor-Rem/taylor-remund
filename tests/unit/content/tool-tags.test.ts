// P4 T2: the tool wall's table from each tool to the published tags it stands for (src/content/tool-tags.json), and
// what each lights when lifted, computed from those tags against the résumé.
import { describe, expect, test } from 'vitest';
import { PATCHLAMP, PUBLISHED_TAGS, TOOL_TAG_SOURCES, TOOL_TAGS, toolLights } from '../../../src/content/tool-tags.ts';
import { BENCH_PROJECTS } from '../../../src/content/bench-projects.ts';
import { resume } from '../../../src/content/resume.ts';
import worldJson from '../../../src/content/world.json';
import { TOOL_KINDS } from '../../../src/workshop/view/kit/pieces/toolwall/tools.ts';

describe('the tool wall: what each tool stands for', () => {
  test('one row for every tool on the wall, and none for anything else', () => {
    expect(Object.keys(TOOL_TAGS).sort()).toEqual([...TOOL_KINDS].sort());
  });

  test('every tag is published on /resume/ (a pill on a project card), and every row has a source', () => {
    for (const [k, tags] of Object.entries(TOOL_TAGS)) {
      expect(tags.length, k).toBeGreaterThan(0);
      for (const t of tags) expect(PUBLISHED_TAGS.has(t), `${k}: "${t}"`).toBe(true);
      expect(TOOL_TAG_SOURCES[k]?.length ?? 0, k).toBeGreaterThan(10);
    }
  });

  test('nothing lights for a tool its published entry does not name', () => {
    for (const k of Object.keys(TOOL_TAGS)) {
      const tags = new Set(TOOL_TAGS[k]);
      for (const id of toolLights(k)) {
        const tools = id === PATCHLAMP ? resume.projects.entries.find((e) => e.title.text === 'Patchlamp')!.tags.map((t) => t.text) : BENCH_PROJECTS[id]!.tools;
        expect(tools.some((t) => tags.has(t)), `${k} lights ${id}`).toBe(true);
      }
    }
  });

  test('the pinned sheet is named by, and carries, the résumé\'s own heading for its skills', () => {
    expect(worldJson.names.toolwall.sheet.text).toBe(resume.skills.heading.text);
  });

  test('what each lights today (the hand-in table): no tool lights nothing', () => {
    const table = Object.fromEntries(TOOL_KINDS.map((k) => [k, toolLights(k)]));
    expect(table).toEqual({
      laravel: ['ledger', 'reports', 'support-desk', 'clean-green', PATCHLAMP],
      vue: ['ledger', 'reports', 'support-desk', 't-components'],
      php: ['ledger', 'reports', 'support-desk', 'clean-green', PATCHLAMP],
      python: [PATCHLAMP],
      rust: ['artificer'],
      sql: ['ledger', 'support-desk', 'clean-green', 'artificer'],
      flutter: ['clean-green'],
      'claude-code': [PATCHLAMP],
    });
    for (const k of TOOL_KINDS) expect(toolLights(k).length, k).toBeGreaterThan(0);
  });
});
