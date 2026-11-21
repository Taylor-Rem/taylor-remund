import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmp, write } from './helpers.ts';
import { checkPictures, renderCommand, SETS } from '../../../scripts/check-pictures.ts';
import { inputsHash as posterHash, pageSource } from '../../../scripts/poster.ts';
import { CODE_FILES, codeHash, inputsHash as bakeInputs, TABLE_JSON } from '../../../scripts/bake.ts';
import { PAPER_ONLY_CONTENT } from '../../../scripts/lib/paper-content.ts';
import { REPO_ROOT } from '../../../scripts/lib/cli.ts';
import { readdirSync, readFileSync } from 'node:fs';

/** A fake repository that holds every set SETS names, rendered from the scene as it is, and a current bake table. */
function fakeRepo(): string {
  const root = tmp('pictures-');
  write(join(root, 'src/workshop/sim/world.ts'), 'export const a = 1;\n');
  write(join(root, 'src/content/world.json'), '{}\n');
  for (const f of CODE_FILES) write(join(root, f), `// ${f}\n`);
  for (const s of SETS) write(join(root, pageSource(s.page)), '---\n---\n');
  // the table first: it lies under view/, which the posters hash (as in the real repository: bake, then posters)
  write(join(root, TABLE_JSON), JSON.stringify({ format: 1, codeHash: codeHash(root), inputsHash: bakeInputs(root), entries: 1, vertices: 1, changed: 0, measurements: 0, bytes: 1, pages: [] }));
  for (const s of SETS) {
    write(join(root, s.set.replace('posters.json', 'p0.avif')), 'x');
    const set = { step: 600, settle: 30, narrowest: 0.4, posters: [{ minAspect: 0.4, aspect: 1.6, height: 900, densities: [1], view: { focus: [0, 0, 0] }, files: [{ file: 'p0.avif', bytes: 1 }] }], hash: '' };
    set.hash = posterHash(root, set as never, pageSource(s.page));
    write(join(root, s.set), JSON.stringify(set));
  }
  return root;
}

describe('check-pictures', () => {
  it('passes when every set and the bake table were made from the scene as it is', () => {
    const r = checkPictures(fakeRepo());
    expect(r.failures).toEqual([]);
  });

  it('a change to content only the paper pages read marks nothing stale; a change to content the bench reads marks everything', () => {
    const root = fakeRepo();
    for (const f of PAPER_ONLY_CONTENT) write(join(root, f), '{ "changed": true }\n');
    expect(checkPictures(root).failures).toEqual([]);
    write(join(root, 'src/content/world.json'), '{ "changed": true }\n');
    expect(checkPictures(root).failures).toHaveLength(SETS.length + 1);
  });

  it('nothing under src/workshop reads the content the hashes leave out (the list is true of the real repository)', () => {
    const names = PAPER_ONLY_CONTENT.map((f) => f.replace(/^src\/content\//, '').replace(/\.(json|ts)$/, ''));
    const reads = new RegExp(`content/(${[...new Set(names)].join('|')})(\\.json|\\.ts)?['"]`);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|astro)$/.test(e.name)) files.push(p);
      }
    };
    walk(join(REPO_ROOT, 'src/workshop'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => reads.test(readFileSync(f, 'utf8'))).map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('fails every picture when the scene changes and the pictures do not, naming the command that re-renders each', () => {
    const root = fakeRepo();
    write(join(root, 'src/workshop/sim/world.ts'), 'export const a = 2;\n');
    const f = checkPictures(root).failures;
    expect(f).toHaveLength(SETS.length + 1);
    for (const s of SETS) expect(f.some((l) => l.startsWith(`${s.set}: STALE`) && l.endsWith(renderCommand(s)))).toBe(true);
    expect(f.some((l) => /bake-table\.bin: STALE: what shapes the pieces changed.*node scripts\/bake\.ts$/.test(l))).toBe(true);
  });

  it("a change to the bake's own code is named as such", () => {
    const root = fakeRepo();
    write(join(root, CODE_FILES[0]!), '// changed\n');
    expect(checkPictures(root).failures.join('\n')).toMatch(/the bake's code changed/);
  });

  it('a missing picture file, and a posters.json it does not know, fail', () => {
    const root = fakeRepo();
    write(join(root, 'src/pages/stray/posters.json'), '{}');
    const s = SETS[0]!;
    write(join(root, s.set), JSON.stringify({ ...JSON.parse('{"posters":[]}'), hash: 'x', posters: [{ view: {}, files: [{ file: 'gone.avif', bytes: 1 }] }] }));
    const f = checkPictures(root).failures.join('\n');
    expect(f).toMatch(/src\/pages\/stray\/posters\.json: a picture set this check does not know/);
    expect(f).toMatch(/missing gone\.avif/);
  });
});
