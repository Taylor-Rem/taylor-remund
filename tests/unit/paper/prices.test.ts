import { describe, expect, it } from 'vitest';
import { keepPricesWhole, noteParts } from '../../../src/components/paper/prices.ts';
import { renderInline, inlineText } from '../../../src/components/paper/inline.ts';
import { ai } from '../../../src/content/ai.ts';

describe('keepPricesWhole', () => {
  it('wraps each price with the unit written after it, and changes no word', () => {
    expect(keepPricesWhole('Book a session — $150')).toBe('Book a session — <span class="price">$150</span>');
    expect(keepPricesWhole('$500–$1,500')).toBe('<span class="price">$500–$1,500</span>');
    expect(keepPricesWhole('care plan $79/mo')).toBe('care plan <span class="price">$79/mo</span>');
    expect(keepPricesWhole('; $79 a month keeps')).toBe('; <span class="price">$79 a month</span> keeps');
    expect(keepPricesWhole(renderInline('from **$25**/mo · no setup fee'))).toBe('from <span class="price"><strong>$25</strong>/mo</span> · no setup fee');
  });
  it('leaves text without a price alone', () => {
    expect(keepPricesWhole('no jargon to learn')).toBe('no jargon to learn');
  });
});

describe('noteParts', () => {
  it('splits a price note at its separators and joins back to the same text', () => {
    for (const p of ai.packages.entries) expect(noteParts(p.priceNote.text).join(' · ')).toBe(p.priceNote.text);
    expect(noteParts('60 minutes · $250 for a 2-hour deep dive')).toEqual(['60 minutes', '$250 for a 2-hour deep dive']);
  });
});

// The published prices (CLAUDE.md § Content rules), as the content file carries them.
// A change here is a change to a commitment: it needs Taylor's word, never a test edit alone.
describe('src/content/ai.json prices', () => {
  it('carries every published price in the live words', () => {
    const [session, install] = ai.packages.entries;
    expect(session?.price.text).toBe('$150');
    expect(session?.priceNote.text).toBe('60 minutes · $250 for a 2-hour deep dive');
    expect(install?.price.text).toBe('$500–$1,500');
    expect(install?.priceNote.text).toBe('one-time install · optional care plan $79/mo');
    expect(ai.hero.actions[0]?.text).toBe('Book a session — $150');
    expect(inlineText(ai.contact.body.text)).toMatch(/^The best first step is a \$150 working session:/);
    expect(inlineText(ai.faq.items[3]!.answer.text)).toContain('$79 a month keeps your install current');
    expect(ai.page.description.text).toContain('($150)');
    expect(ai.page.description.text).toContain('($500–$1,500)');
    expect(ai.patchlamp.price.text).toBe('from **$25**/mo · no setup fee · usage included');
    expect(JSON.stringify(ai)).not.toMatch(/4%|\$500\/mo|capped/);
  });
  it('keeps every mailto: subject', () => {
    const mailtos = [...ai.nav, ...ai.hero.actions, ...ai.packages.entries.map((p) => p.action), ...ai.contact.actions]
      .map((l) => l.href)
      .filter((h) => h.startsWith('mailto:'));
    expect(mailtos).toEqual([
      'mailto:remundtaylor3@gmail.com?subject=AI%20Working%20Session',
      'mailto:remundtaylor3@gmail.com?subject=AI%20Working%20Session',
      'mailto:remundtaylor3@gmail.com?subject=AI%20Working%20Session',
      'mailto:remundtaylor3@gmail.com?subject=AI%20on%20My%20Computer',
      'mailto:remundtaylor3@gmail.com?subject=AI%20Working%20Session',
    ]);
  });
});
