/**
 * Which pieces exist, for the catalogue and the look page. The kit owns the
 * real registry (`kit/pieces/registry.ts`: every `kit/pieces/<name>/index.ts`
 * exports `catalogue` entries). This file only finds it, and until it lands
 * (or if a folder has no index yet) falls back to scanning the same folders
 * itself, plus the kit's original single-file test block. Nothing here is a
 * shared list: a builder adds a folder and it appears.
 *
 * Every lookup goes through `import.meta.glob`, so a file that does not exist
 * yet is simply an empty match, never a broken import.
 */
import type { KitOptions, Piece } from '../kit/types.ts';
import type { BuildOptions, CatalogueEntry } from '../kit/catalogue.ts';
import type { Labels } from '../types.ts';

export type { BuildOptions };
/** A registered piece: the kit's `CatalogueEntry` (kit/catalogue.ts). */
export type Entry = CatalogueEntry;

interface KitRegistry {
  loadCatalogue(): Promise<Entry[]>;
  findEntry(name: string): Promise<Entry | undefined>;
}

// eager (B1 round 2): the registry, and through it every piece, is in the bundle the page loads; a lazy
// glob cost a stub chunk and a round trip before the first piece could be found
const registry = import.meta.glob<KitRegistry>('../kit/pieces/registry.ts', { eager: true });
// (E1: never a late unit's folder: its pieces are fetched by the late loader, or by the kit registry on a development page)
const folders = import.meta.glob<{ catalogue?: Entry[] }>(['../kit/pieces/*/index.ts', '!../kit/pieces/pitch/index.ts']);
const legacy = import.meta.glob<{ testBlock?: (o?: KitOptions) => Piece }>('../kit/pieces/test-block.ts');

/** Where the list came from (shown on the index page, so nobody wonders). */
export type Source = 'registry' | 'folders' | 'fallback';

let cached: Promise<{ entries: Entry[]; source: Source }> | null = null;

async function discover(): Promise<{ entries: Entry[]; source: Source }> {
  const reg = registry['../kit/pieces/registry.ts'];
  let entries: Entry[] = [];
  let source: Source = 'fallback';
  if (reg) {
    entries = await reg.loadCatalogue();
    source = 'registry';
  } else {
    for (const key of Object.keys(folders).sort()) {
      const m = await folders[key]!();
      entries.push(...(m.catalogue ?? []));
    }
    if (entries.length) source = 'folders';
  }
  // The kit's test block before it moved into its folder.
  if (!entries.some((e) => e.name === 'test-block')) {
    const old = legacy['../kit/pieces/test-block.ts'];
    if (old) {
      const m = await old();
      const make = m.testBlock;
      if (make) {
        entries.push({
          name: 'test-block',
          build: (o = {}) => make({ ...(o.seed !== undefined ? { seed: o.seed } : {}), ...(o.detail ? { detail: o.detail } : {}) }),
          variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
        });
      }
    }
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`catalogue: two pieces are called '${e.name}'`);
    seen.add(e.name);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, source };
}

/** Every registered piece the page loads first, sorted by name (and a late unit's, once it has arrived: `addPieces`). */
export async function listPieces(): Promise<{ entries: Entry[]; source: Source }> {
  cached ??= discover();
  return cached;
}

/**
 * (E1) A late unit's pieces, now that its chunk has arrived: added to the list every lookup reads (the bake table's
 * measurements, the bench kit's `entry`). A name already listed is an error, as in `discover`.
 */
export async function addPieces(entries: readonly Entry[]): Promise<void> {
  const now = await listPieces();
  const fresh = entries.filter((e) => !now.entries.includes(e));
  for (const e of fresh) if (now.entries.some((x) => x.name === e.name)) throw new Error(`catalogue: two pieces are called '${e.name}'`);
  if (fresh.length === 0) return;
  const next = { entries: [...now.entries, ...fresh].sort((a, b) => a.name.localeCompare(b.name)), source: now.source };
  cached = Promise.resolve(next);
}

/** One piece by name, or undefined while it is not registered yet (a late unit's is fetched: the catalogue's pages). */
export async function findPiece(name: string): Promise<Entry | undefined> {
  return (await listPieces()).entries.find((e) => e.name === name) ?? (await registry['../kit/pieces/registry.ts']?.findEntry(name));
}

/**
 * The first registered name among `names` (e.g. Fetch's alternative designs:
 * `fetch`, then anything starting `fetch-`). A name ending in `*` matches by prefix.
 */
export async function firstPiece(names: readonly string[]): Promise<Entry | undefined> {
  const { entries } = await listPieces();
  for (const n of names) {
    const hit = n.endsWith('*') ? entries.find((e) => e.name.startsWith(n.slice(0, -1))) : entries.find((e) => e.name === n);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Build an entry: a variant's options under explicit ones, then, when `labels`
 * is given and the entry has the hook, the label keys its tape, stencils and
 * plates need (kit/catalogue.ts `labels`). Without labels it builds blank.
 */
export function buildEntry(e: Entry, variant: string | null, opts: BuildOptions = {}, labels?: Labels): Piece {
  const base = variant ? e.variants?.[variant] : undefined;
  if (variant && !base) throw new Error(`catalogue: ${e.name} has no variant '${variant}' (has: ${Object.keys(e.variants ?? {}).join(', ') || 'none'})`);
  const o: BuildOptions = { ...(base ?? {}), ...opts };
  const extra = labels && e.labels ? e.labels(labels, o) : {};
  return e.build({ ...o, ...extra });
}
