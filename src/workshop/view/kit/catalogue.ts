/**
 * The parts catalogue convention. Each piece lives in its own folder,
 * `kit/pieces/<name>/index.ts`, and exports `catalogue: CatalogueEntry[]`.
 * `kit/pieces/registry.ts` finds every folder by itself (import.meta.glob),
 * so adding a piece never means editing a shared list.
 */
import type { KitOptions, Piece } from './types.ts';

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
}
