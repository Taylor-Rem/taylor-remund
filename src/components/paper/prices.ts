/**
 * Prices on the page are commitments (CLAUDE.md § Content rules): a price is
 * never set so that it wraps apart from its unit. These helpers only add
 * markup around the words the content file holds; they never change a word.
 */

/**
 * A price and the unit written right after it: `$150`, `$500–$1,500`,
 * `$79/mo`, `$79 a month`, `<strong>$25</strong>/mo` (the inline form's bold,
 * already rendered). Both strong tags or neither, so the span nests.
 */
const PRICE = /(?:<strong>\$\d[\d,]*<\/strong>|\$\d[\d,]*(?:–\$\d[\d,]*)?)(?:\/mo\b| a month\b)?/g;

/** Wraps every price in rendered inline HTML in `<span class="price">`, which does not break. */
export function keepPricesWhole(html: string): string {
  return html.replace(PRICE, (m) => `<span class="price">${m}</span>`);
}

/**
 * A price note's parts, split at its " · " separators (`60 minutes · $250 for
 * a 2-hour deep dive`), so each part can be kept on one line and the line
 * breaks only at a separator. Joining the parts with " · " gives the text back.
 */
export function noteParts(text: string): string[] {
  return text.split(' · ');
}
