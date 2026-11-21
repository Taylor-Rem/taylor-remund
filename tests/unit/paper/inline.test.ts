import { describe, expect, it } from 'vitest';
import { escapeHtml, inlineText, renderInline } from '../../../src/components/paper/inline.ts';
import { printAddress } from '../../../src/components/paper/links.ts';
import { resume } from '../../../src/content/resume.ts';

describe('renderInline', () => {
  it('escapes everything that is not a mark', () => {
    expect(renderInline(`a < b & "c" 'd' > e`)).toBe('a &lt; b &amp; &quot;c&quot; &#39;d&#39; &gt; e');
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders code, bold, em and links', () => {
    expect(renderInline('a `x<y>` b')).toBe('a <code>x&lt;y&gt;</code> b');
    expect(renderInline('**More than 1,800 commits.**')).toBe('<strong>More than 1,800 commits.</strong>');
    expect(renderInline('*Eliminated a workload.*')).toBe('<em>Eliminated a workload.</em>');
    expect(renderInline('I run [Patchlamp](/#patchlamp); see')).toBe('I run <a href="/#patchlamp">Patchlamp</a>; see');
    expect(renderInline('**in 2.5 days** and `DB::raw`')).toBe('<strong>in 2.5 days</strong> and <code>DB::raw</code>');
    expect(renderInline('[the `x` tool](https://a.example/?q="1")')).toBe('<a href="https://a.example/?q=&quot;1&quot;">the <code>x</code> tool</a>');
  });

  it('nests em in bold', () => {
    expect(renderInline('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
  });

  it('takes a backslash for a literal mark', () => {
    expect(renderInline('2 \\* 3 \\[x\\] \\`')).toBe('2 * 3 [x] `');
  });

  it('adds link attributes from the href', () => {
    expect(renderInline('[me](mailto:a@b.c)', { linkAttrs: (h) => ({ 'data-print': h.slice(7) }) })).toBe('<a href="mailto:a@b.c" data-print="a@b.c">me</a>');
  });

  it.each([
    ['unclosed code', 'a `b'],
    ['unclosed bold', '**a'],
    ['unclosed em', 'a *b'],
    ['unclosed link text', '[a'],
    ['link without href', '[a] b'],
    ['unclosed href', '[a](b'],
    ['empty href', '[a]()'],
    ['stray ]', 'a ] b'],
  ])('throws on %s', (_label, src) => {
    expect(() => renderInline(src)).toThrow(/inline:/);
  });

  it('gives the plain text a reader sees', () => {
    expect(inlineText('I run [Patchlamp](/#p) & **more** `x<y`')).toBe('I run Patchlamp & more x<y');
  });

  it('renders every paragraph of the résumé without error', () => {
    const texts = [
      resume.about.subtitle.text,
      ...resume.about.paragraphs.map((p) => p.text),
      resume.projects.intro.text,
      ...resume.projects.entries.flatMap((e) => e.paragraphs.map((p) => p.text)),
      ...resume.experience.roles.flatMap((r) => r.bullets.map((b) => b.text)),
      resume.contact.text.text,
    ];
    for (const t of texts) expect(() => renderInline(t)).not.toThrow();
  });

  it('escapeHtml handles all five', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('printAddress', () => {
  it.each([
    ['mailto:remundtaylor3@gmail.com', 'remundtaylor3@gmail.com'],
    ['mailto:a@b.c?subject=Hi', 'a@b.c'],
    ['https://github.com/Taylor-Rem/artificer', 'github.com/Taylor-Rem/artificer'],
    ['https://www.youtube.com/watch?v=b8bHnp2oqaI', 'youtube.com/watch?v=b8bHnp2oqaI'],
    ['https://patchlamp.com', 'patchlamp.com'],
    ['/case-studies/ledger-repair/', 'taylorremund.com/case-studies/ledger-repair/'],
    ['#projects', null],
    ['/#patchlamp', null],
    ['/', null],
  ])('%s → %s', (href, want) => {
    expect(printAddress(href)).toBe(want);
  });
});
