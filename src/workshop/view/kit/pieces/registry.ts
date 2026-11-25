/**
 * The piece registry. Every `kit/pieces/<name>/index.ts` that exports
 * `catalogue: CatalogueEntry[]` is found here by Vite's import.meta.glob,
 * so builders working in parallel never edit a shared list. Eagerly (B1
 * round 2): every folder's code is in the pieces chunk already (astro.config
 * `codeSplitting`), and a lazy glob made one stub chunk per folder that the
 * catalogue then fetched one after another (26 round trips on Fast 4G).
 * The functions stay async so callers need not change.
 *
 * (E1) Except the late units' folders (`LATE_FOLDERS`): a crew member who arrives after the bench is usable has his
 * pieces in a chunk of his own, so they are left out of the eager glob and found through a lazy one, which only
 * the catalogue's own pages ever call (`loadLateCatalogue`, `findEntry`; the late loader imports its own folder). `loadCatalogue` is the eager pieces.
 */
import type { BuildOptions, CatalogueEntry } from '../catalogue.ts';
import type { Piece } from '../types.ts';

type Module = { catalogue?: CatalogueEntry[] };
// (E1) the late units' folders are named here and in the glob's exclusions below (a glob takes literals only)
const modules = import.meta.glob<Module>(['./*/index.ts', '!./pitch/index.ts'], { eager: true });
/** (E1) A development build (`astro dev`, or a build with the development pages): its catalogue pages show the late pieces too. */
declare const __WORKSHOP_DEV_BUILD__: boolean | undefined;
const DEV_BUILD = !!import.meta.env?.DEV || (typeof __WORKSHOP_DEV_BUILD__ !== 'undefined' && __WORKSHOP_DEV_BUILD__ === true);
// (a production build has none of them here: nothing it loads can reach a late chunk through the registry)
const late: Record<string, () => Promise<Module>> = DEV_BUILD ? import.meta.glob<Module>('./pitch/index.ts') : {};

/** (E1) The folders of late units' pieces (not in the eager pieces; `loadLateFolder`). */
export const LATE_FOLDERS: readonly string[] = Object.keys(late).map((k) => k.replace(/^\.\//, '').replace(/\/index\.ts$/, ''));

/** Folder names of every registered piece module, the late units' too (no piece code is loaded). */
export function pieceFolders(): string[] {
  return [...Object.keys(modules), ...Object.keys(late)]
    .map((k) => k.replace(/^\.\//, '').replace(/\/index\.ts$/, ''))
    .sort();
}

/** The catalogue entries of one folder (a late unit's is fetched: its chunk). */
export async function loadFolder(folder: string): Promise<CatalogueEntry[]> {
  const m = modules[`./${folder}/index.ts`];
  if (m) return m.catalogue ?? [];
  const l = late[`./${folder}/index.ts`];
  if (!l) throw new Error(`no piece folder '${folder}'`);
  return (await l()).catalogue ?? [];
}

/** (E1) Every late unit's pieces (fetching their chunks): the catalogue's pages, never the stage's first load. */
export async function loadLateCatalogue(): Promise<CatalogueEntry[]> {
  const all: CatalogueEntry[] = [];
  for (const f of LATE_FOLDERS) all.push(...(await loadFolder(f)));
  return all;
}

/** Every catalogue entry the page loads first (the late units' are `loadLateCatalogue`), in folder order. Names must be unique. */
export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const all: CatalogueEntry[] = [];
  for (const f of pieceFolders()) if (!LATE_FOLDERS.includes(f)) all.push(...(await loadFolder(f)));
  const names = new Set<string>();
  for (const e of all) {
    if (names.has(e.name)) throw new Error(`two catalogue entries are called '${e.name}'`);
    names.add(e.name);
  }
  return all;
}

/** Find one entry by name (a late unit's piece too: its chunk is fetched). */
export async function findEntry(name: string): Promise<CatalogueEntry | undefined> {
  return (await loadCatalogue()).find((e) => e.name === name) ?? (await loadLateCatalogue()).find((e) => e.name === name);
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
