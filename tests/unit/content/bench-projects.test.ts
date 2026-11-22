// P4 S5: the project crates' words are the résumé's own. Every crate the bench calls a project has its words in
// src/content/bench-projects.json and nothing else does; the stencil is the published title in capitals, broken into
// lines and nothing more; the card's title, line and tools are the entry's title, subtitle and tags; the anchor is the
// one /resume/ gives the entry's heading; who it was built for is the employer /resume/ names (or his own name).
import { describe, expect, test } from 'vitest';
import { BENCH_PROJECTS, BENCH_PROJECTS_RAW, CARD_PLATE } from '../../../src/content/bench-projects.ts';
import { resume } from '../../../src/content/resume.ts';
import { PROJECT_CRATES, PROJECT_OF } from '../../../src/workshop/sim/scenes/bench.ts';
import { SUBSET } from '../../../src/workshop/view/labels/fonts.ts';

/** The slug /resume/ gives a project heading (src/pages/resume.astro). */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

describe('the project crates\' words', () => {
  test('the bench\'s six projects and the content\'s are the same six', () => {
    expect(Object.values(PROJECT_OF).sort()).toEqual(Object.keys(BENCH_PROJECTS).sort());
    expect(PROJECT_CRATES).toHaveLength(6);
  });

  test('each is a published entry: its card is the entry\'s title, subtitle and tags; its anchor the heading\'s', () => {
    for (const p of Object.values(BENCH_PROJECTS)) {
      const e = resume.projects.entries.find((x) => x.title.text === p.title)!;
      expect(e, p.id).toBeTruthy();
      expect(p.line).toBe(e.subtitle.text);
      expect(p.tools).toEqual(e.tags.map((t) => t.text));
      expect(p.anchor).toBe(`p-${slug(e.title.text)}`);
      expect(p.href).toBe(`/resume/#p-${slug(e.title.text)}`);
    }
    // Patchlamp has its station, not a crate; the retired and older work is memorabilia (DEMO-CONCEPTS.md)
    expect(Object.values(BENCH_PROJECTS).map((p) => p.title)).not.toContain('Patchlamp');
  });

  test('the stencil is the title in capitals, only broken into lines; the mark is who it was built for, as published', () => {
    const employer = resume.experience.roles[0]!.employer.text;
    for (const [id, raw] of Object.entries(BENCH_PROJECTS_RAW)) {
      const p = BENCH_PROJECTS[id]!;
      expect(raw.stencil.text, id).toBe(p.title.toUpperCase());
      expect(raw.stencil.lines.join(' '), id).toBe(raw.stencil.text);
      expect(raw.for.lines.join(' '), id).toBe(raw.for.text);
      const label = p.entry.label.text;
      if (label === 'Work') expect(raw.for.text, id).toBe(employer.toUpperCase());
      else expect(raw.for.text, id).toBe('TAYLOR REMUND');
      // every character is in the stencil face (a missing glyph would fall back in a browser)
      for (const ch of [...raw.stencil.lines.join(''), ...raw.for.lines.join('')]) expect(SUBSET.stencil, `${id}: ${ch}`).toContain(ch);
    }
    expect(CARD_PLATE.length).toBeGreaterThan(0);
  });
});
