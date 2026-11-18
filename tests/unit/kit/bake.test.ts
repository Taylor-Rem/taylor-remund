// K1: the bake table (src/workshop/view/kit/bake.ts). A lookup gives what the
// live bake gives; a table made by other bake code fails verify and is not
// used; a measurement is used only under the sources it was recorded from; a
// measuring build skips the bake and changes nothing it measures.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BufferGeometry } from 'three';
import { bakeTableStats, measured, measureOnly, useBakeTable } from '../../../src/workshop/view/kit/bake.ts';
import { bakeKey, keyText, parseBakeTable, SCALE, UNCHANGED, writeBakeTable, type BakeMeta } from '../../../src/workshop/view/kit/bake-format.ts';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { testBlock } from '../../../src/workshop/view/kit/pieces/test-block/index.ts';
import { catalogue as switchboardCatalogue } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { catalogue as benchCatalogue } from '../../../src/workshop/view/kit/pieces/bench/index.ts';
import { measureEntry, measureOf } from '../../../src/workshop/view/vignette.ts';
import { codeHash, inputsHash, readInfo, TABLE_BIN } from '../../../scripts/bake.ts';
import { REPO_ROOT } from '../../../scripts/lib/cli.ts';

type Rec = { __bakeRecord?: boolean; __bakeRecorded?: Array<{ key: string; values: number[] }>; __bakeMeasured?: Record<string, unknown> };
const G = globalThis as Rec;
const META: BakeMeta = { code: 'c', inputs: 'i', measured: {} };

afterEach(() => {
  useBakeTable(null);
  delete G.__bakeRecord;
  delete G.__bakeRecorded;
  delete G.__bakeMeasured;
});

function geometries(p: Piece): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const walk = (n: PieceNode): void => {
    for (const q of n.parts) out.push(q.geometry);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}
const cavity = (p: Piece): number[] => geometries(p).flatMap((g) => Array.from({ length: g.getAttribute('surf').count }, (_, i) => g.getAttribute('surf').getY(i)));
const stool = switchboardCatalogue.find((e) => e.name === 'stool')!;
const shipped = (): ReturnType<typeof parseBakeTable> => {
  const buf = readFileSync(join(REPO_ROOT, TABLE_BIN));
  return parseBakeTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};
/** Record the bakes of `build` live, as scripts/bake.ts does in the browser. */
function recordBakes(build: () => void): Array<{ key: string; values: Uint16Array }> {
  G.__bakeRecord = true;
  G.__bakeRecorded = [];
  build();
  const out = G.__bakeRecorded.map((r) => ({ key: r.key, values: Uint16Array.from(r.values) }));
  delete G.__bakeRecord;
  return out;
}
const tableOf = (entries: Array<{ key: string; values: Uint16Array }>, meta: BakeMeta = META) => parseBakeTable(writeBakeTable(entries, meta).buffer as ArrayBuffer);

describe('the shipped bake table', () => {
  it('was recorded by the bake code as it stands (else: node scripts/bake.ts)', () => {
    const info = readInfo();
    expect(info, 'src/workshop/view/kit/bake-table.json is missing: node scripts/bake.ts').not.toBeNull();
    expect(info!.codeHash, "the cavity bake's code changed since the bake table was recorded; its values are not this code's. Record it again: node scripts/bake.ts").toBe(codeHash());
  });

  it('parses and holds what its record says', () => {
    const info = readInfo()!;
    const t = shipped();
    expect(t.index.size).toBe(info.entries);
    expect(t.values.length).toBe(info.vertices);
    expect(Object.keys(t.meta.measured).length).toBe(info.measurements);
    expect(t.meta.code).toBe(info.codeHash);
    expect(t.meta.inputs).toBe(info.inputsHash);
  });

  it('Node builds a piece bit for bit as Chrome did: the bench\'s key is in the table Chrome recorded', () => {
    // only meaningful while the table is current (else the bench may have changed since)
    if (readInfo()!.inputsHash !== inputsHash()) return;
    const t = shipped();
    const bench = benchCatalogue.find((e) => e.name === 'bench')!;
    const keys = recordBakes(() => bench.build({ seed: 1 })).map((r) => r.key);
    expect(keys.length).toBe(1);
    expect(t.index.has(keys[0]!)).toBe(true);
  });
});

describe('looking the bake up', () => {
  it('gives the live bake, to 1/131068 where it changed a vertex and bit for bit everywhere else', () => {
    const rec = recordBakes(() => {
      testBlock({ seed: 3 });
      stool.build({ seed: 5 });
    });
    expect(rec.length).toBe(2);
    const a = testBlock({ seed: 3 }), b = stool.build({ seed: 5 });
    useBakeTable(tableOf(rec));
    const h0 = bakeTableStats.hits;
    const a2 = testBlock({ seed: 3 }), b2 = stool.build({ seed: 5 });
    expect(bakeTableStats.hits - h0).toBe(2);
    for (const [live, looked] of [[a, a2], [b, b2]] as const) {
      const x = cavity(live), y = cavity(looked);
      expect(y.length).toBe(x.length);
      let worst = 0;
      for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i]! - y[i]!));
      expect(worst).toBeLessThanOrEqual(0.5 / SCALE + 1e-7);
      const gx = geometries(live), gy = geometries(looked);
      for (let k = 0; k < gx.length; k++) {
        const sx = gx[k]!.getAttribute('surf').array, sy = gy[k]!.getAttribute('surf').array;
        let other = 0;
        for (let i = 0; i < sx.length; i++) if (i % 3 !== 1 && sx[i] !== sy[i]) other++;
        expect(other).toBe(0);
      }
    }
    expect(rec.some((r) => r.values.includes(UNCHANGED))).toBe(true);
  });

  it('another input misses: another seed, another option, one bit of one normal', () => {
    const rec = recordBakes(() => testBlock({ seed: 3 }));
    useBakeTable(tableOf(rec));
    const m0 = bakeTableStats.misses;
    testBlock({ seed: 4 });
    expect(bakeTableStats.misses - m0).toBe(1);
    const p = measureOnly(() => testBlock({ seed: 3 }));
    const items = geometries(p).map((geometry) => ({ geometry }));
    const k0 = keyText(bakeKey(items, {}));
    expect(keyText(bakeKey(items, { samples: 4 }))).toBe(k0); // a default given is the default
    expect(keyText(bakeKey(items, { samples: 5 }))).not.toBe(k0);
    const n = items[0]!.geometry.getAttribute('normal').array as Float32Array;
    const bits = new Uint32Array(n.buffer, n.byteOffset, n.length);
    bits[7] = bits[7]! ^ 1;
    expect(keyText(bakeKey(items, {}))).not.toBe(k0);
  });

  it('a table recorded under other bake code is not used at all', () => {
    const rec = recordBakes(() => testBlock({ seed: 3 }));
    useBakeTable(tableOf(rec, { code: 'old', inputs: 'i', measured: {} }), { code: 'new', inputs: 'i' });
    expect(bakeTableStats.loaded).toBe(false);
    expect(bakeTableStats.error).toMatch(/other bake code/);
    const m0 = bakeTableStats.misses;
    testBlock({ seed: 3 });
    expect(bakeTableStats.misses - m0).toBe(1);
  });
});

describe('measurements', () => {
  it('are used only when recorded under every source the page was built from', () => {
    const t = tableOf([], { code: 'c', inputs: 'old', measured: { k: 41 } });
    useBakeTable(t, { code: 'c', inputs: 'new' });
    expect(measured('k', () => 42)).toBe(42);
    useBakeTable(t, null);
    expect(measured('k', () => 42)).toBe(42);
    useBakeTable(t, { code: 'c', inputs: 'old' });
    expect(measured('k', () => 42)).toBe(41);
    expect(measured('other', () => 7)).toBe(7);
  });

  it('a measuring build skips the bake and measures the same size and sockets as a full build', () => {
    const s0 = bakeTableStats.skipped;
    const m = measureOnly(() => stool.build({ seed: 1 }));
    expect(bakeTableStats.skipped - s0).toBe(1);
    const f = stool.build({ seed: 1 });
    expect(pieceBounds(m).equals(pieceBounds(f))).toBe(true);
    expect(Object.keys(m.sockets ?? {})).toEqual(Object.keys(f.sockets ?? {}));
    for (const [k, s] of Object.entries(f.sockets ?? {})) expect(m.sockets![k]!.equals(s)).toBe(true);
    expect(cavity(m)).not.toEqual(cavity(f));
  });

  it('a recorded measure comes back exactly as the build measures it', () => {
    G.__bakeRecord = true;
    const live = measureEntry(stool, { seed: 1 });
    const rec = G.__bakeMeasured!;
    delete G.__bakeRecord;
    expect(Object.keys(rec)).toEqual(['measure|stool|{seed:1}']);
    useBakeTable(tableOf([], { code: 'c', inputs: 'i', measured: JSON.parse(JSON.stringify(rec)) as Record<string, unknown> }), { code: 'c', inputs: 'i' });
    const h0 = bakeTableStats.measuredHits;
    const looked = measureEntry(stool, { seed: 1 });
    expect(bakeTableStats.measuredHits - h0).toBe(1);
    expect(looked.bounds.equals(live.bounds)).toBe(true);
    expect(looked.bounds.equals(measureOf(stool.build({ seed: 1 })).bounds)).toBe(true);
    for (const [k, s] of Object.entries(live.sockets)) expect(looked.sockets[k]!.equals(s)).toBe(true);
  });
});
