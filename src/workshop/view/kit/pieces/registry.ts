/**
 * The piece registry. Every `kit/pieces/<name>/index.ts` that exports
 * `catalogue: CatalogueEntry[]` is found here by Vite's import.meta.glob,
 * so builders working in parallel never edit a shared list. Eagerly (B1
 * round 2): every folder's code is in the pieces chunk already (astro.config
 * `codeSplitting`), and a lazy glob made one stub chunk per folder that the
 * catalogue then fetched one after another (26 round trips on Fast 4G).
 * The functions stay async so callers need not change.
 */
import type { BuildOptions, CatalogueEntry } from '../catalogue.ts';
import type { Piece } from '../types.ts';

type Module = { catalogue?: CatalogueEntry[] };
const modules = import.meta.glob<Module>('./*/index.ts', { eager: true });

/** Folder names of every registered piece module (no piece code is loaded). */
export function pieceFolders(): string[] {
  return Object.keys(modules)
    .map((k) => k.replace(/^\.\//, '').replace(/\/index\.ts$/, ''))
    .sort();
}

/** The catalogue entries of one folder. */
export async function loadFolder(folder: string): Promise<CatalogueEntry[]> {
  const m = modules[`./${folder}/index.ts`];
  if (!m) throw new Error(`no piece folder '${folder}'`);
  return m.catalogue ?? [];
}

/** Every catalogue entry, in folder order. Names must be unique. */
export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const all: CatalogueEntry[] = [];
  for (const f of pieceFolders()) all.push(...(await loadFolder(f)));
  const names = new Set<string>();
  for (const e of all) {
    if (names.has(e.name)) throw new Error(`two catalogue entries are called '${e.name}'`);
    names.add(e.name);
  }
  return all;
}

/** Find one entry by name. */
export async function findEntry(name: string): Promise<CatalogueEntry | undefined> {
  return (await loadCatalogue()).find((e) => e.name === name);
}

const memo = new Map<string, Piece>();

/**
 * Build through a memo keyed by (entry name, options), so sixty identical crates build and
 * bake once and share geometry. A memoised piece is shared: never mutate it.
 */
export function buildCached(entry: CatalogueEntry, opts: BuildOptions = {}): Piece {
  const key = `${entry.name}|${stableKey(opts)}`;
  let p = memo.get(key);
  if (!p) {
    p = entry.build(opts);
    memo.set(key, p);
  }
  return p;
}

/** Forget memoised pieces (tests, hot reload). */
export function clearBuildCache(): void {
  memo.clear();
}

function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${k}:${stableKey(o[k])}`).join(',')}}`;
}
