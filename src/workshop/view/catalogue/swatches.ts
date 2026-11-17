/**
 * Colour-check swatches for the catalogue (`?swatch=1`): small rounded
 * blocks of the tokens the grade must keep true under the lamp. The
 * Button's glossy red (steel, finish 1) must stay red, not orange; paper
 * cream at the hot spot must not clip or bloom; teal-panel enamel should
 * read grey-green, not mint; brass and wood for reference.
 */
import type { Piece } from '../kit/types.ts';
import type { MaterialClass } from '../kit/types.ts';
import type { Token } from '../palette.ts';
import { roundedBox } from '../kit/solids.ts';
import { part, piece } from '../kit/compose.ts';
import { setFinish } from '../kit/space.ts';

export const SWATCHES: ReadonlyArray<{ cls: MaterialClass; token: Token; finish?: number }> = [
  { cls: 'steel', token: 'button-red', finish: 1 },
  { cls: 'paper', token: 'paper' },
  { cls: 'steel', token: 'teal-panel' },
  { cls: 'steel', token: 'teal-light' },
  { cls: 'brass', token: 'brass' },
  { cls: 'tape', token: 'tape-yellow' },
];

/** A row of swatches, 0.36 units each, centred on x = 0, standing on y = 0. */
export function swatchRow(): Piece {
  const b = piece('swatches', { ao: false });
  const n = SWATCHES.length;
  SWATCHES.forEach((s, i) => {
    const g = roundedBox({ w: 0.3, h: 0.3, d: 0.3, r: 0.04 });
    g.translate((i - (n - 1) / 2) * 0.38, 0, 0);
    const p = part(s.cls, g, s.token);
    if (s.finish) setFinish(p, s.finish);
    b.add(p);
  });
  return b.build();
}
