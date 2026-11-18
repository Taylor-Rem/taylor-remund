/**
 * The bake table's key and file format (K1). `kit/bake.ts` uses them at
 * start-up, `scripts/bake.ts` writes the file. Plain code with no bundler
 * imports, so the recorder runs it in Node as it is.
 *
 * The key is everything the ray-traced bake (`surface.ts` `bakeCavity`)
 * reads: positions, normals, the surf channel, the index, the placing
 * matrices, the bounding radius each part's rays are cut to, and the
 * options. Two inputs that differ in any bit get different keys.
 *
 * The file (little-endian):
 *   u32 magic 'K1BK', u32 format, u32 entry count, u32 value count, u32 meta bytes, 3 × u32 0
 *   per entry, sorted by key: u32 h1, u32 h2, u32 vertex count, u32 first value
 *   u16 values, one per vertex of the piece (its parts in build order):
 *     UNCHANGED (the bake left the vertex's cavity alone) or round(cavity × SCALE)
 *   meta: UTF-8 JSON (`BakeMeta`): the hashes it was recorded under and the
 *     measurements (sizes and sockets) recorded with it
 */
import type { BufferGeometry, Matrix4 } from 'three';
import { ATTR } from './types.ts';
import type { AoOptions } from './surface.ts';

/** One geometry of the piece and its placing in piece space (what `bakeCavity` takes). */
export interface BakeItem {
  geometry: BufferGeometry;
  matrix?: Matrix4 | undefined;
}

/** File layout version. */
export const BAKE_FORMAT = 1;
const MAGIC = 0x4b42314b; // 'K1BK' read little-endian
/** The value meaning "the bake did not change this vertex". */
export const UNCHANGED = 0xffff;
/** Stored values are round(cavity × SCALE): at most 1/131068 from the live value. */
export const SCALE = 65534;

// ───────────────────────── the key ─────────────────────────

/** Two 32-bit lanes of a murmur3-style hash over 32-bit words. */
class Hasher {
  private h1 = 0x9747b28c;
  private h2 = 0x2f9b7ae1;
  private n = 0;
  words(a: ArrayLike<number>): void {
    let h1 = this.h1, h2 = this.h2;
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      let k = Math.imul(v, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      h1 ^= k;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
      let j = Math.imul(v ^ 0x5bd1e995, 0x85ebca6b);
      j = (j << 17) | (j >>> 15);
      j = Math.imul(j, 0xc2b2ae35);
      h2 ^= j;
      h2 = (h2 << 11) | (h2 >>> 21);
      h2 = (Math.imul(h2, 9) + 0x7f4a7c15) | 0;
    }
    this.h1 = h1;
    this.h2 = h2;
    this.n += a.length;
  }
  /** A typed array by its bits (floats) or by value (integers), then its length. */
  array(a: Float32Array | Float64Array | Uint32Array | Uint16Array | Int32Array): void {
    if (a instanceof Float32Array) this.words(new Uint32Array(a.buffer, a.byteOffset, a.length));
    else if (a instanceof Float64Array) this.words(new Uint32Array(a.buffer, a.byteOffset, a.length * 2));
    else this.words(a);
    this.words([a.length]);
  }
  digest(): [number, number] {
    const fmix = (h: number): number => {
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      return h >>> 0;
    };
    let h1 = (this.h1 ^ this.n) | 0, h2 = (this.h2 ^ this.n) | 0;
    h1 = (h1 + h2) | 0;
    h2 = (h2 + h1) | 0;
    h1 = fmix(h1);
    h2 = fmix(h2);
    h1 = (h1 + h2) >>> 0;
    h2 = (h2 + h1) >>> 0;
    return [h1, h2];
  }
}

/** The options with `bakeCavity`'s defaults filled in, so an option left out and the same option given key alike. */
function resolved(opts: AoOptions): Float64Array {
  const r = opts.range ?? [0.06, 0.42];
  return Float64Array.of(opts.samples ?? 4, opts.distance ?? 0.14, r[0], r[1], opts.seed ?? 7);
}

/**
 * The key of a bake. Reads the geometry only (changes nothing on it).
 */
export function bakeKey(items: readonly BakeItem[], opts: AoOptions = {}): { h1: number; h2: number; n: number } {
  const h = new Hasher();
  h.array(resolved(opts));
  let n = 0;
  for (const { geometry: g, matrix } of items) {
    const pos = g.getAttribute('position');
    n += pos.count;
    h.array(pos.array as Float32Array);
    const nr = g.getAttribute('normal');
    h.array(nr ? (nr.array as Float32Array) : new Float32Array(0));
    const s = g.getAttribute(ATTR.surf);
    h.array(s ? (s.array as Float32Array) : new Float32Array(0));
    h.words([s ? s.itemSize : 0]);
    if (g.index) h.array(g.index.array as Uint16Array | Uint32Array);
    else h.words([0xffffffff, pos.count]);
    h.array(Float64Array.from(matrix ? matrix.elements : [1]));
    // the bake cuts each part's rays to its bounding radius: one already on the geometry (it could be
    // stale) is part of the input; one the bake would compute follows from the positions already hashed
    h.array(Float64Array.of(g.boundingSphere ? g.boundingSphere.radius : -1));
  }
  const [h1, h2] = h.digest();
  return { h1, h2, n };
}

/** A key as 16 hex digits. */
export const keyText = (k: { h1: number; h2: number }): string => `${k.h1.toString(16).padStart(8, '0')}${k.h2.toString(16).padStart(8, '0')}`;

// ───────────────────────── the file ─────────────────────────

/** What the table was recorded under, and the measurements recorded with it. */
export interface BakeMeta {
  /** Hash of the bake's code (scripts/bake.ts CODE_FILES). */
  code: string;
  /** Hash of everything that shapes the pieces (scripts/bake.ts INPUT_TREES). */
  inputs: string;
  /** Measurements (sizes and sockets of pieces built only to be measured), by key. */
  measured: Record<string, unknown>;
}

export interface BakeTable {
  /** key text → [first value, vertex count] */
  readonly index: ReadonlyMap<string, readonly [number, number]>;
  readonly values: Uint16Array;
  readonly meta: BakeMeta;
}

const HEAD = 32;

/** Read a table file. Throws on a file of another format or a broken one. */
export function parseBakeTable(buf: ArrayBuffer): BakeTable {
  if (buf.byteLength < HEAD) throw new Error('bake table: too short');
  const head = new Uint32Array(buf, 0, HEAD / 4);
  if (head[0] !== MAGIC || head[1] !== BAKE_FORMAT) throw new Error(`bake table: not a format-${BAKE_FORMAT} table`);
  const count = head[2]!;
  const total = head[3]!;
  const metaBytes = head[4]!;
  const metaAt = HEAD + count * 16 + total * 2;
  if (metaAt + metaBytes > buf.byteLength) throw new Error('bake table: truncated');
  const ent = new Uint32Array(buf, HEAD, count * 4);
  const values = new Uint16Array(buf, HEAD + count * 16, total);
  const index = new Map<string, readonly [number, number]>();
  for (let i = 0; i < count; i++) {
    const o = ent[i * 4 + 3]!, n = ent[i * 4 + 2]!;
    if (o + n > total) throw new Error('bake table: an entry runs past the values');
    index.set(keyText({ h1: ent[i * 4]!, h2: ent[i * 4 + 1]! }), [o, n]);
  }
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, metaAt, metaBytes))) as BakeMeta;
  return { index, values, meta };
}

/** Write a table file. Entries (and measurements) are sorted by key, so the same input makes the same bytes. */
export function writeBakeTable(entries: ReadonlyArray<{ key: string; values: Uint16Array }>, meta: BakeMeta): Uint8Array {
  const list = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const total = list.reduce((s, e) => s + e.values.length, 0);
  const sorted: BakeMeta = { code: meta.code, inputs: meta.inputs, measured: Object.fromEntries(Object.keys(meta.measured).sort().map((k) => [k, meta.measured[k]])) };
  const json = new TextEncoder().encode(JSON.stringify(sorted));
  const metaAt = HEAD + list.length * 16 + total * 2;
  const buf = new ArrayBuffer(metaAt + json.length);
  new Uint8Array(buf, metaAt, json.length).set(json);
  const head = new Uint32Array(buf, 0, HEAD / 4);
  head[0] = MAGIC;
  head[1] = BAKE_FORMAT;
  head[2] = list.length;
  head[3] = total;
  head[4] = json.length;
  const ent = new Uint32Array(buf, HEAD, list.length * 4);
  const values = new Uint16Array(buf, HEAD + list.length * 16, total);
  let o = 0;
  list.forEach((e, i) => {
    ent[i * 4] = parseInt(e.key.slice(0, 8), 16);
    ent[i * 4 + 1] = parseInt(e.key.slice(8, 16), 16);
    ent[i * 4 + 2] = e.values.length;
    ent[i * 4 + 3] = o;
    values.set(e.values, o);
    o += e.values.length;
  });
  return new Uint8Array(buf);
}
