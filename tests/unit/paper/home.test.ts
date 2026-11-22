import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import homeJson from '../../../src/content/home.json';
import { home, serviceCards } from '../../../src/content/home.ts';
import { ai } from '../../../src/content/ai.ts';
import { site } from '../../../src/content/site.ts';

// The home page's paperwork (P4 A3; REWRITE.md § 3, § F1).

describe('src/content/home.json', () => {
  it('types no price: every price on the page is read from ai.json, and no Patchlamp price appears at all', () => {
    expect(JSON.stringify(homeJson)).not.toMatch(/\$\d/);
  });

  it('reads each service card\'s name and prices from ai.json, the one file /ai/ uses, in its order', () => {
    const cards = serviceCards();
    expect(cards.map((c) => c.pkg)).toEqual(ai.packages.entries);
    expect(cards.map((c) => c.pkg.price.text)).toEqual(['$150', '$500–$1,500']);
  });

  it('the four sections\' headings are the live page\'s', () => {
    expect(Object.keys(site.paperwork)).toEqual(['patchlamp', 'services', 'about', 'contact']);
  });

  it('links Patchlamp\'s pricing page rather than typing a price', () => {
    expect(home.patchlamp.links.map((l) => l.href)).toContain('https://patchlamp.com/pricing');
  });

  // BRAND.md § The position: worded once, reused as written. Where the Patchlamp checkout is on this machine,
  // the sentence here is held to its one source; elsewhere (a clean checkout) the test says it was skipped.
  const position = join(homedir(), 'projects/patchlamp/app/Support/Position.php');
  it.skipIf(!existsSync(position))('carries Position::SENTENCE word for word', () => {
    const php = readFileSync(position, 'utf8');
    const m = /SENTENCE = '((?:[^'\\]|\\.)*)';/.exec(php);
    expect(m).not.toBeNull();
    expect(home.patchlamp.position.text).toBe(m![1]!.replace(/\\'/g, "'"));
  });
});
