/**
 * The storefront (REWRITE.md § B2 X1 "what a text can change", ART-P2 § 5
 * STOREFRONT). Registry name `storefront`. Nobody's shop.
 */
import type { CatalogueEntry } from '../../catalogue.ts';
import type { KitOptions, Piece, Token } from '../../types.ts';
import { paints } from '../../../palette.ts';
import { BUILD_DEFAULTS, buildStorefront } from './build.ts';

export interface StorefrontOptions extends KitOptions {
  fascia?: Token;
  awning?: Token;
}

export function storefront(o: StorefrontOptions = {}): Piece {
  return buildStorefront({
    ...BUILD_DEFAULTS,
    seed: o.seed ?? 1,
    detail: o.detail ?? 'high',
    ...(o.fascia ? { fascia: o.fascia } : {}),
    ...(o.awning ? { awning: o.awning } : {}),
  });
}

const asPaint = (v: unknown): Token | undefined => (typeof v === 'string' && (paints as readonly string[]).includes(v) ? (v as Token) : undefined);

export const catalogue: CatalogueEntry[] = [
  {
    name: 'storefront',
    build: (opts = {}) => {
      const f = asPaint(opts['fascia']);
      const a = asPaint(opts['awning']);
      return storefront({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(f ? { fascia: f } : {}),
        ...(a ? { awning: a } : {}),
      });
    },
    camera: { distance: 5 },
    note: 'The toy storefront a text changes: fascia colour and words, awning colour, OPEN/CLOSED, the picture in the window.',
  },
];
