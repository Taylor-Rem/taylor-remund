/**
 * The storefront (REWRITE.md § B2 X1 "what a text can change", ART-P2 § 5
 * STOREFRONT). Registry name `storefront`. Nobody's shop: its fascia says
 * what content says (not a business name) until a visitor's text says
 * otherwise.
 *
 * A model-railway shop front about 2.3 wide, 2.1 tall (2.6 to the chimney
 * pots) and 0.9 deep: cream pilasters with sunk teal panels, scrolled
 * consoles, a dentilled cornice, a recessed half-glazed door on a worn step,
 * a display window over a panelled stallriser, a striped awning on drop
 * arms, a lantern, a slate-less flat roof with a chimney stack, and beside
 * it a teal junction box with the STOREFRONT jack plate, the jack, the
 * station lamp and a cloth conduit leaving toward the switchboard.
 *
 * FIVE CHANGES, each driven by a pure function (perform.ts), each only
 * setting node transforms or rewriting paint vertex colours (recolour.ts):
 *  1. fascia colour: the four slats' paint (8 paints), wiped across.
 *  2. fascia words: the slats turn over, top first, to their other face,
 *     painted beforehand with the new words (labels.ts `setFasciaWords`).
 *  3. awning colour: the awning winds in, the stripes change, it winds out.
 *  4. OPEN / CLOSED: the card in the window turns on its string; the
 *     window's warm light and the lantern stutter out (or on).
 *  5. the picture: a six-sided drum behind a gilt frame rolls to the next
 *     face: mountains, sun, boat, tree, house, or the blank.
 * And the station lamp: `lamp.lit` / `lamp.unlit` (pose `lamp`).
 *
 * NODES (dims.ts NODES): `sign.slat0..3` (turn about local X), `awning`
 * (turn about X, scale Z: the canvas paying out), `awning.colour` (its
 * coloured stripes: paint only), `awning.valance` (moves to the arms' tips)
 * and `awning.valance.colour`, `awning.arm.l` / `.r` (turn about X),
 * `awning.crank` (turns about Z, face-on), `opensign` (turns about Y),
 * `window.lit` / `window.unlit` and `window.lit.lantern` /
 * `window.unlit.lantern` (swapped by scale), `picture.drum` (turns about X),
 * `lamp.lit` / `lamp.unlit`. Sockets: `words`, `window`, `jack`, `lamp`.
 *
 * Every pose value is in pose.ts (`poseStorefront`); the textures are made by
 * `storefrontLabels(labels)` (labels.ts) before the build.
 */
import type { CatalogueEntry } from '../../catalogue.ts';
import type { KitOptions, Piece, Token } from '../../types.ts';
import { paints } from '../../../palette.ts';
import { BUILD_DEFAULTS, buildStorefront } from './build.ts';
import { AWNING_NODES, FASCIA_NODES, registerPaint } from './recolour.ts';
import { NAMED_POSES, poseStorefront, REST, type StorefrontPose } from './pose.ts';
import { storefrontLabels, type StorefrontLabelRefs } from './labels.ts';
import { DEFAULTS } from './dims.ts';

export { poseStorefront, nodeMatrices, NAMED_POSES, REST, HIDDEN, slatTurn, wordsFace, awningGeometry, governedBy } from './pose.ts';
export type { StorefrontPose } from './pose.ts';
export { fasciaColour, fasciaWordsTurn, hiddenFace, awningColour, awningCycle, openClosed, lightStutter, pictureRoll } from './perform.ts';
export { paintFascia, paintAwning, wipeFascia, writePaint, FASCIA_NODES, AWNING_NODES } from './recolour.ts';
export { storefrontLabels, setFasciaWords, fasciaWords, PLATE_CAP } from './labels.ts';
export type { StorefrontLabelRefs } from './labels.ts';
export { fitWords, cleanWords, MAX_CHARS } from './words.ts';
export type { WordsLayout } from './words.ts';
export { PICTURES, pictureIndex, content as storefrontContent } from './content.ts';
export type { WindowPicture } from './content.ts';
export { NODES, DEFAULTS, SHOP } from './dims.ts';

export interface StorefrontOptions extends KitOptions {
  /** Fascia and awning paint at build (default DEFAULTS). Later changes go through recolour, not a rebuild. */
  fascia?: Token;
  awning?: Token;
  /** Texture refs from `storefrontLabels`; without them the words are absent and the pictures blank (clay, tests). */
  labels?: StorefrontLabelRefs;
  /** Build already posed (stills only: a view poses the realized object instead, from the bind pose). */
  pose?: StorefrontPose | null;
}

export function storefront(o: StorefrontOptions = {}): Piece {
  const fascia = o.fascia ?? DEFAULTS.fascia;
  const awning = o.awning ?? DEFAULTS.awning;
  const p = buildStorefront({
    ...BUILD_DEFAULTS,
    seed: o.seed ?? 1,
    detail: o.detail ?? 'high',
    fascia,
    awning,
    ...(o.labels ? { words: o.labels.words, pictures: o.labels.pictures, plate: o.labels.plate } : {}),
  });
  registerPaint(p, FASCIA_NODES, fascia);
  registerPaint(p, AWNING_NODES, awning);
  if (o.pose) {
    // the window's light follows the card unless the pose names it
    const { lights: _l, ...rest } = REST;
    poseStorefront(p.root, { ...rest, ...o.pose });
  }
  return p;
}

const asPaint = (v: unknown): Token | undefined => (typeof v === 'string' && (paints as readonly string[]).includes(v) ? (v as Token) : undefined);

export const catalogue: CatalogueEntry[] = [
  {
    name: 'storefront',
    build: (opts = {}) => {
      const f = asPaint(opts['fascia']);
      const a = asPaint(opts['awning']);
      const poseName = typeof opts['pose'] === 'string' ? opts['pose'] : 'rest';
      if (!(poseName in NAMED_POSES)) throw new Error(`storefront: no pose '${poseName}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
      return storefront({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(f ? { fascia: f } : {}),
        ...(a ? { awning: a } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as StorefrontLabelRefs } : {}),
        pose: NAMED_POSES[poseName] ?? null,
      });
    },
    labels: (labels, opts) => ({ labels: storefrontLabels(labels, typeof opts['words'] === 'string' ? { words: opts['words'] } : {}) }),
    variants: {
      high: { detail: 'high' },
      low: { detail: 'low' },
      blue: { fascia: 'paint-blue', awning: 'tape-yellow' },
      words: { words: 'THE BIG RED SHOP' },
    },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 5 },
    note: 'The toy storefront a text changes: fascia colour and words, awning colour, OPEN/CLOSED, the picture in the window; its jack box and station lamp.',
  },
];
