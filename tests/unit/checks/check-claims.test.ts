import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { checkClaims, claimProblems } from '../../../scripts/check-claims.ts';
import { must, tmp, write } from './helpers.ts';

describe('check-claims', () => {
  it('passes with 0 entries when src/content does not exist', () => {
    const r = checkClaims({ root: tmp('claims-') });
    expect(r.passed).toBe(true);
    expect(r.render()).toMatch(/0 entries/);
  });

  it('passes with 0 entries when src/content has no JSON', () => {
    const root = tmp('claims-');
    write(join(root, 'src/content/README.txt'), 'x');
    const r = checkClaims({ root });
    expect(r.passed).toBe(true);
    expect(r.render()).toMatch(/0 entries and 0 toy rows in 0 JSON files/);
  });

  it('passes well-formed entries and toy rows', () => {
    const root = tmp('claims-');
    write(join(root, 'src/content/projects.json'), JSON.stringify({
      projects: [
        { id: 'artificer', title: { text: 'Artificer', kind: 'ui' }, summary: { text: 'A Rust agent framework.', kind: 'fact', source: '~/career/facts/projects/artificer.md' } },
      ],
      crew: [{ text: 'Coming through!', kind: 'voice' }],
    }));
    write(join(root, 'src/content/toys.json'), JSON.stringify([{ toy: 'A text changes the storefront', real: 'The owner texts', source: 'CLAIMS.md, hero rows' }]));
    const r = checkClaims({ root });
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/3 entries and 1 toy row in 2 JSON files/);
  });

  it('fails each problem with file: json-path: problem', () => {
    const root = tmp('claims-');
    write(join(root, 'src/content/projects.json'), JSON.stringify({
      projects: [
        { summary: { text: 'Eliminated a full-time role.', kind: 'fact' } },
        { summary: { text: 'x', kind: 'fact', source: '   ' } },
        { 'odd key': { text: 'y' } },
        { summary: { text: 'z', kind: 'claim' } },
      ],
    }));
    write(join(root, 'src/content/toys.json'), JSON.stringify({ rows: [{ toy: 'Undo', real: 'Undo that' }] }));
    write(join(root, 'src/content/broken.json'), '{ "text": ');
    const f = checkClaims({ root }).failures;
    expect(f).toEqual([
      'src/content/broken.json: $: not valid JSON ' + must(f[0]).slice('src/content/broken.json: $: not valid JSON '.length),
      'src/content/projects.json: $.projects[0].summary: fact has no "source" (a fact that is not sourced does not appear)',
      'src/content/projects.json: $.projects[1].summary: fact has no "source" (a fact that is not sourced does not appear)',
      'src/content/projects.json: $.projects[2]["odd key"]: entry has "text" but no "kind" (fact, voice or ui)',
      'src/content/projects.json: $.projects[3].summary: entry "kind" is "claim"; must be "fact", "voice" or "ui"',
      'src/content/toys.json: $.rows[0]: toy truth-table row has no "source" (a row with no source does not ship, § F3)',
    ]);
  });

  it('claimProblems counts nested entries', () => {
    expect(claimProblems('f', { a: [{ text: 'x', kind: 'ui', b: { text: 'y', kind: 'voice' } }] }).entries).toBe(2);
  });
});
