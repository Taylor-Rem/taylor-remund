import { describe, expect, it } from 'vitest';
import { assertContent, validateContent } from '../../src/content/schema.ts';
import site from '../../src/content/site.json';

describe('validateContent', () => {
  it('accepts the shipped site.json', () => {
    expect(validateContent(site)).toEqual([]);
  });

  it('accepts each kind, and a fact with a source', () => {
    expect(
      validateContent({
        a: { text: 'x', kind: 'fact', source: 'somewhere' },
        b: { text: 'x', kind: 'voice' },
        c: [{ text: 'x', kind: 'ui', href: '/' }],
      }),
    ).toEqual([]);
  });

  it('ignores objects without a string text field', () => {
    expect(validateContent({ meta: { version: 1 }, list: [1, 'two', null], text: 3 })).toEqual([]);
  });

  it('requires a kind on every entry, with its path', () => {
    expect(validateContent({ strip: { links: [{ text: 'x' }] } })).toEqual([
      { path: '$.strip.links[0]', message: expect.stringContaining('"kind"') },
    ]);
  });

  it('rejects an unknown kind', () => {
    expect(validateContent({ text: 'x', kind: 'claim' })).toHaveLength(1);
  });

  it('requires a non-empty source on a fact', () => {
    expect(validateContent({ text: 'x', kind: 'fact' })[0]?.message).toMatch(/source/);
    expect(validateContent({ text: 'x', kind: 'fact', source: '  ' })[0]?.message).toMatch(/source/);
    expect(validateContent({ text: 'x', kind: 'fact', source: 7 }).length).toBeGreaterThan(0);
  });

  it('rejects empty text and a non-string href', () => {
    expect(validateContent({ text: '', kind: 'ui' })).toHaveLength(1);
    expect(validateContent({ text: 'x', kind: 'ui', href: 3 })).toHaveLength(1);
  });

  it('finds entries nested inside entries', () => {
    const errors = validateContent({ text: 'x', kind: 'ui', more: { 'two words': { text: 'y' } } });
    expect(errors.map((e) => e.path)).toEqual(['$.more["two words"]']);
  });

  it('assertContent throws listing every problem', () => {
    expect(() => assertContent([{ text: 'a' }, { text: 'b', kind: 'fact' }], 'f.json')).toThrow(/\$\[0\][\s\S]*\$\[1\]/);
    const ok = { text: 'a', kind: 'ui' };
    expect(assertContent(ok, 'f.json')).toBe(ok);
  });
});
