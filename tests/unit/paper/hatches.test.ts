// P4 H1: the hatches' and panels' words (REWRITE.md § 3, § B7, § F3).
import { describe, expect, it } from 'vitest';
import hatchesJson from '../../../src/content/hatches.json';
import { hatches, liveWords } from '../../../src/content/hatches.ts';
import { PAPER_ONLY_CONTENT } from '../../../scripts/lib/paper-content.ts';
import { fromRun, longDate } from '../../../scripts/test-count.ts';

describe('src/content/hatches.json', () => {
  it('types no price, and links Patchlamp’s pricing page instead', () => {
    expect(JSON.stringify(hatchesJson)).not.toMatch(/\$\d/);
    expect(hatches.patchlamp.links.map((l) => l.href)).toContain('https://patchlamp.com/pricing');
  });

  it('every sentence of Patchlamp’s hatch is a fact that names where it is true', () => {
    const p = hatches.patchlamp;
    const facts = [...p.real.paragraphs, ...p.shows.items, ...p.simplifies.items, ...p.facts.items];
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.kind).toBe('fact');
      expect(f.source).toMatch(/CLAIMS\.md|resume\.json|BRAND\.md/);
    }
  });

  it('says the toy is a toy: scripted, no model called, the real Patch runs Claude Code (§ F3)', () => {
    const said = hatches.patchlamp.simplifies.items.map((i) => i.text).join(' ');
    expect(said).toMatch(/scripted/);
    expect(said).toMatch(/No model is called/);
    expect(said).toMatch(/Claude Code/);
  });

  it('Patch is “it”, never he or she', () => {
    const p = hatches.patchlamp;
    const texts = [...p.real.paragraphs, ...p.shows.items, ...p.simplifies.items].map((i) => i.text);
    for (const t of texts) expect(t).not.toMatch(/\b(he|him|his|she|her)\b/i);
  });

  it('the live lines have every word the log needs', () => {
    const w = liveWords() as Record<string, unknown>;
    for (const k of ['field', 'state', 'moved', 'changed', 'byText', 'empty', 'frame']) expect(typeof w[k]).toBe('string');
    for (const k of ['rest', 'belt', 'dock', 'platen', 'shipped', 'away']) expect((w['places'] as Record<string, string>)[k]).toBeTruthy();
  });

  it('is paper-only content: the bench’s pictures do not depend on it', () => {
    expect(PAPER_ONLY_CONTENT).toEqual(expect.arrayContaining(['src/content/hatches.json', 'src/content/hatches.ts', 'src/content/bench-tests.json']));
  });
});

describe('scripts/test-count.ts', () => {
  const at = new Date('2026-11-22T07:00:00Z');
  it('writes the count only from a run in which every test passed', () => {
    expect(fromRun({ numTotalTests: 10, numPassedTests: 9, numFailedTests: 1, success: false }, at, 'abc')).toEqual({ refused: expect.stringMatching(/did not pass/) });
    expect(fromRun({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, success: true }, at, 'abc')).toEqual({ refused: expect.any(String) });
    const ok = fromRun({ numTotalTests: 1834, numPassedTests: 1832, numFailedTests: 0, numPendingTests: 2, success: true }, at, 'abc');
    expect(ok).toMatchObject({ count: { text: '1,832', kind: 'fact' }, run: { passed: 1832, skipped: 2, commit: 'abc' } });
    expect((ok as { count: { source: string } }).count.source).toMatch(/2 skipped \(not counted\)/);
  });
  it('dates it as the site dates things', () => {
    expect(longDate(new Date(2026, 10, 22))).toBe('November 22, 2026');
  });
});
