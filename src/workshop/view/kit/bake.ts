/**
 * Start-up work looked up instead of done (K1): the cavity bake of every
 * piece, and the sizes and sockets of pieces built only to be measured.
 *
 * The bake. `PieceBuilder.build()` hands every piece's geometry to
 * `bakePiece`. That keys it by everything the ray-traced bake (`surface.ts`
 * `bakeCavity`) reads (`bake-format.ts` `bakeKey`) and looks in the bake
 * table, a binary file `scripts/bake.ts` records from the real pages in a
 * real browser. A hit writes the recorded cavity values (16-bit: at most
 * 1/131068 from the live value, far under what an 8-bit frame shows; a vertex
 * the bake left alone keeps its own value bit for bit); a miss runs the live
 * bake, exactly as before. Keyed by content, a table recorded from older
 * pieces can only miss, never be wrong, as long as the bake's code is the
 * same; that is pinned three ways: the build hands the code's hash to the
 * page (integrations/bake-table.ts) and a table recorded under other code is
 * not used at all; a unit test holds the hash in `bake-table.json` against
 * the source (verify); the dev server never uses the table.
 *
 * The measurements. `measured(key, compute)` returns what `compute` returns
 * (plain JSON: a box, some matrices), from the table when it was recorded
 * under exactly the sources the page was built from (the build hands their
 * hash over), else by computing it. A measurement is keyed by a name, not by
 * content, so it is never used unless every source that could change it is
 * the one it was recorded from.
 *
 * `measureOnly(fn)`: pieces built inside skip the bake (it changes neither
 * size nor sockets). Never draw a piece built there.
 */
import type { BufferAttribute, BufferGeometry } from 'three';
import { ATTR } from './types.ts';
import { bakeCavity, type AoOptions } from './surface.ts';
import { bakeKey, keyText, parseBakeTable, SCALE, UNCHANGED, type BakeItem, type BakeTable } from './bake-format.ts';
import tableUrl from './bake-table.bin?url';

export type { BakeItem, BakeTable } from './bake-format.ts';

/** The hashes of the sources this page was built from (set by integrations/bake-table.ts; absent in tests and Node). */
declare const __WORKSHOP_BAKE__: { code: string; inputs: string } | undefined;
const built = typeof __WORKSHOP_BAKE__ !== 'undefined' ? __WORKSHOP_BAKE__ : null;

/** How it went this session (loadtime, the dev pages, the bake script). */
export const bakeTableStats = { hits: 0, misses: 0, skipped: 0, measuredHits: 0, measuredMisses: 0, keyMs: 0, liveMs: 0, entries: 0, loaded: false, measurements: false, error: '' };
(globalThis as { __bakeStats?: typeof bakeTableStats }).__bakeStats = bakeTableStats;

let table: BakeTable | null = null;
let measurements: Record<string, unknown> | null = null;
let loading: Promise<void> | null = null;

/**
 * Use this table from now on (null: none). The bake values are used if the
 * table was recorded under the bake code this page was built with (or the
 * build said nothing); the measurements only if under every source.
 */
export function useBakeTable(t: BakeTable | null, sources: { code: string; inputs: string } | null = built): void {
  table = null;
  measurements = null;
  bakeTableStats.error = '';
  if (t && sources && t.meta.code !== sources.code) bakeTableStats.error = `the bake table was recorded under other bake code (${t.meta.code}, this build ${sources.code}): not used`;
  else if (t) {
    table = t;
    if (sources && t.meta.inputs === sources.inputs) measurements = t.meta.measured;
  }
  bakeTableStats.entries = table ? table.index.size : 0;
  bakeTableStats.loaded = !!table;
  bakeTableStats.measurements = !!measurements;
}

/**
 * Fetch the shipped table, once. Resolves when it is in, or has failed (then
 * everything is done live). Never on the dev server (there the bake is always
 * the code as it stands), outside a browser, or while the recorder runs.
 */
export function loadBakeTable(): Promise<void> {
  if (loading) return loading;
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (dev || typeof fetch !== 'function' || typeof document === 'undefined' || recording()) {
    loading = Promise.resolve();
    return loading;
  }
  loading = fetch(tableUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => useBakeTable(parseBakeTable(b)))
    .catch((e: unknown) => {
      bakeTableStats.error = String(e);
    });
  return loading;
}

let measuring = 0;

/** Run `fn` with the bake off: for builds that only read sizes and sockets. Never draw what it builds. */
export function measureOnly<T>(fn: () => T): T {
  measuring++;
  try {
    return fn();
  } finally {
    measuring--;
  }
}

/** The recorder's switch and its findings (scripts/bake.ts sets the switch before the page loads). */
interface Recorder {
  __bakeRecord?: boolean;
  __bakeRecorded?: Array<{ key: string; values: number[] }>;
  __bakeMeasured?: Record<string, unknown>;
}
const recording = (): boolean => (globalThis as Recorder).__bakeRecord === true;

/**
 * A measurement: from the table when it holds `key` and was recorded under
 * the sources this page was built from, else `compute()` (recorded when the
 * recorder runs). `compute` must return plain JSON and depend on nothing but
 * the sources and `key`.
 */
export function measured<T>(key: string, compute: () => T): T {
  if (measurements && !recording() && Object.prototype.hasOwnProperty.call(measurements, key)) {
    bakeTableStats.measuredHits++;
    return measurements[key] as T;
  }
  bakeTableStats.measuredMisses++;
  const v = compute();
  if (recording()) ((globalThis as Recorder).__bakeMeasured ??= {})[key] = JSON.parse(JSON.stringify(v)) as unknown;
  return v;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The cavity bake of one piece: from the table when it holds this exact input, else live. */
export function bakePiece(items: readonly BakeItem[], opts: AoOptions = {}): void {
  if (measuring > 0) {
    bakeTableStats.skipped++;
    return;
  }
  const rec = recording();
  if (!table && !rec) {
    live(items, opts);
    return;
  }
  const tk = now();
  const key = bakeKey(items, opts);
  const text = keyText(key);
  bakeTableStats.keyMs += now() - tk;
  const hit = rec ? undefined : table?.index.get(text);
  if (hit && hit[1] === key.n) {
    const v = table!.values;
    let o = hit[0];
    for (const { geometry } of items) {
      const surf = geometry.getAttribute(ATTR.surf) as BufferAttribute;
      const a = surf.array as Float32Array;
      const st = surf.itemSize;
      for (let i = 0; i < surf.count; i++, o++) {
        const q = v[o]!;
        if (q !== UNCHANGED) a[i * st + 1] = q / SCALE;
      }
      surf.needsUpdate = true;
    }
    bakeTableStats.hits++;
    return;
  }
  if (!rec) {
    live(items, opts);
    return;
  }
  // recording: bake live and note what it did to each vertex
  const before = items.map(({ geometry }) => surfY(geometry));
  live(items, opts);
  const out: number[] = [];
  items.forEach(({ geometry }, gi) => {
    const after = surfY(geometry);
    const b = before[gi]!;
    for (let i = 0; i < after.length; i++) out.push(after[i] === b[i] ? UNCHANGED : Math.round(Math.min(1, Math.max(0, after[i]!)) * SCALE));
  });
  ((globalThis as Recorder).__bakeRecorded ??= []).push({ key: text, values: out });
}

function live(items: readonly BakeItem[], opts: AoOptions): void {
  const t0 = now();
  bakeCavity(items, opts);
  bakeTableStats.misses++;
  bakeTableStats.liveMs += now() - t0;
}

function surfY(g: BufferGeometry): Float32Array {
  const s = g.getAttribute(ATTR.surf);
  const out = new Float32Array(s.count);
  for (let i = 0; i < s.count; i++) out[i] = s.getY(i);
  return out;
}
