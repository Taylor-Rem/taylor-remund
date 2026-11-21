import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmp, write } from './helpers.ts';
import { checkProse, markupText, prose, scanCode, scanMarkup } from '../../../scripts/check-prose.ts';

const texts = (code: string): string[] => scanCode('src/workshop/ui/x.ts', code).map((h) => h.text);

describe('check-prose: what reads like words for a person', () => {
  it('sentences and labels are prose; ids, keys, paths, selectors, units and calls are not', () => {
    for (const s of ['Make the sign red.', 'Put the phone down', "That's outside this folder.", 'Big Red Button']) expect(prose(s), s).toBe(true);
    for (const s of ['part.grabbed', 'crate-1', 'workshop.sound.muted', '/dev/bench/', '#stage', '11px ui-monospace', 'a b', 'rgba(0, 0, 0, 0.5)', 'onFrame', 'x => y', 'belt']) {
      expect(prose(s), s).toBe(false);
    }
  });
});

describe('check-prose: code', () => {
  it('finds a sentence in a literal, in a template, and in an array of ready-made texts', () => {
    expect(texts("const a = 'Make the sign red.';")).toEqual(['Make the sign red.']);
    expect(texts('const b = `You have ${n} crates left`;')).toEqual(['You have ', ' crates left']);
    expect(texts("export const KEYS = ['Go faster.', 'Slow down a bit.'];")).toEqual(['Go faster.', 'Slow down a bit.']);
  });

  it('finds any literal written into a DOM text property or a visible attribute, one word included', () => {
    expect(texts("b.textContent = 'Send';")).toEqual(['Send']);
    expect(texts("b.setAttribute('aria-label', 'Close');")).toEqual(['Close']);
    expect(texts("i.placeholder = 'Text Patch';")).toEqual(['Text Patch']);
    expect(texts("b.setAttribute('data-id', 'Close');")).toEqual([]);
  });

  it('leaves errors, logs, assertions, imports, keys, CSS, media queries, class lists and shaders alone', () => {
    expect(texts("throw new Error('the bench is not ready yet');")).toEqual([]);
    expect(texts('throw new RangeError(`a part ${id} is outside the bench`);')).toEqual([]);
    expect(texts("console.warn('the label worker is slow today', x);")).toEqual([]);
    expect(texts("import x from 'some module path';")).toEqual([]);
    expect(texts("const v = { 'M blue': { size: 'M' } };")).toEqual([]);
    expect(texts("const css = 'color: red; font-weight: bold;';")).toEqual([]);
    expect(texts("matchMedia('(prefers-reduced-motion: reduce)');")).toEqual([]);
    expect(texts("el('span', `ph-side ph-side-${s}`);")).toEqual([]);
    expect(texts('const frag = `uniform float t;\nvoid main() { gl_FragColor = vec4(1.0); }`;')).toEqual([]);
    expect(texts("const p = { note: 'The belt: the room clock.', variants: { 'with crate': { load: 'crate', words: 'THE BIG SHOP' } } };")).toEqual([]);
    expect(texts('out.push(`${i.id}: no name at all here`);')).toEqual([]);
    expect(texts("log('workshop: the unit threw at step 4');")).toEqual([]);
    expect(texts("const e = `labels: ${a} is not in ${b} (subset)`;")).toEqual([]);
  });
});

describe('check-prose: markup', () => {
  it('finds text nodes and visible attributes, not expressions, scripts, styles or other attributes', () => {
    const src = [
      '---',
      "const t = site.title.text;",
      '---',
      '<main class="paper big-one" id="x">',
      '  <h1>{t}</h1>',
      '  <p>Hello there</p>',
      '  <img src="/a.png" alt="A crate" />',
      '  <nav aria-label="Links"><a href="/">{site.name}</a></nav>',
      '  {items.map((i) => <li>{i.text} &middot; More words</li>)}',
      '  <style>.x { content: "Not visible here"; }</style>',
      '  <script>const y = 1;</script>',
      '</main>',
    ].join('\n');
    expect(markupText(src).map((t) => [t.line, t.text, t.attr ?? ''])).toEqual([
      [6, 'Hello there', ''],
      [7, 'A crate', 'alt'],
      [8, 'Links', 'aria-label'],
      [9, 'More words', ''],
    ]);
  });

  it("a component's title and description props are visible; robots and class are not", () => {
    const hits = scanMarkup('src/pages/x.astro', '---\n---\n<Legal id="privacy" title="Privacy Policy" description="What is kept, and why." robots="noindex, follow" />\n');
    expect(hits.map((h) => h.text)).toEqual(['Privacy Policy', 'What is kept, and why.']);
  });
});

describe('check-prose: the tree', () => {
  it('fails on a leak, passes on words from content, and leaves dev pages and tests out', () => {
    const root = tmp('prose-');
    write(join(root, 'src/workshop/ui/ok.ts'), "import { site } from '../../content/site.ts';\nexport const s = site.strip.name.text;\n");
    write(join(root, 'src/dev-pages/bench.astro'), '<p>Review scaffolding words</p>\n');
    write(join(root, 'tests/unit/x.test.ts'), "const a = 'A sentence in a test.';\n");
    // the real ALLOW entries name files this tree does not have: each says it matches nothing
    const clean = checkProse(root).failures;
    expect(clean.every((f) => f.startsWith('ALLOW entry no longer matches anything'))).toBe(true);
    write(join(root, 'src/workshop/ui/leak.ts'), "export const label = 'Put the phone down';\n");
    const f = checkProse(root).failures.filter((x) => !x.startsWith('ALLOW'));
    expect(f).toEqual(['src/workshop/ui/leak.ts:1 "Put the phone down": reads like prose; visible words live in src/content/']);
  });
});
