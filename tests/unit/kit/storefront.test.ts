import { describe, expect, it } from 'vitest';
import { fitWords } from '../../../src/workshop/view/kit/pieces/storefront/words.ts';

describe('storefront words', () => {
  it('probe', () => {
    for (const t of ['YOUR NAME HERE', 'OPEN', 'BAKERY', 'ABCDEFGHIJKLMNOP', 'WWWWWWWWWWWWWWWW', 'THE BIG RED SHOP', 'HELLO WORLD', 'MMMMMMMM MMMMMMM']) {
      const l = fitWords(t);
      console.log(t.padEnd(18), l.lines.join(' / ').padEnd(22), l.cap.toFixed(3), l.condense.toFixed(2), l.px.toFixed(1));
    }
    expect(1).toBe(1);
  });
});
