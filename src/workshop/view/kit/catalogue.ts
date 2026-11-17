/**
 * The parts catalogue convention. Each piece lives in its own folder,
 * `kit/pieces/<name>/index.ts`, and exports `catalogue: CatalogueEntry[]`.
 * `kit/pieces/registry.ts` finds every folder by itself (import.meta.glob),
 * so adding a piece never means editing a shared list.
 */
import type { KitOptions, Piece } from './types.ts';
import type { Labels } from '../types.ts';

/** Options a catalogue build accepts: the kit's own plus anything piece-specific (size, colour, label...). */
export type BuildOptions = KitOptions & Record<string, unknown>;

export interface CatalogueEntry {
  /** Kit name, unique across the catalogue (e.g. 'crate', 'button'). */
  name: string;
  /** Build one instance. Must be deterministic in `opts` (same options, same piece). */
  build(opts?: BuildOptions): Piece;
  /** Named presets worth showing on the catalogue page (e.g. { S: { size: 'S' }, M: { size: 'M' } }). */
  variants?: Record<string, BuildOptions>;
  /** Suggested camera distance (world units) for a close view of one instance. */
  camera?: { distance?: number };
  /** One line for the catalogue page. */
  note?: string;
  /** Named poses the piece can be shown in; the chosen one is passed back to `build` as `pose`. */
  poses?: readonly string[];
  /**
   * For pieces with textured parts (label tape, stencils, plates, cards): make the
   * label textures this piece needs and return the extra build options that carry
   * their keys (for example `{ labels: refs }`, or `{ stencil: true }`). Whoever
   * builds the piece calls this once, after the labels module is ready and before
   * `build`, with the same options it is about to build with, and merges the result
   * into them. Pieces must still build without it (blank labels) for clay and tests.
   */
  labels?(labels: Labels, opts: BuildOptions): BuildOptions;
}
