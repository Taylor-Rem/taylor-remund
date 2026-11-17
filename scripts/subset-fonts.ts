// subset-fonts: make the workshop's four fonts (public/fonts/*.woff2) from
// the original TrueType files. Zero dependencies: a small TrueType subsetter
// and a WOFF2 encoder (null-transformed glyf/loca, Brotli from node:zlib).
//
//   node scripts/subset-fonts.ts <dir holding the original .ttf files> [out dir, default public/fonts]
//
// The originals and where they come from are listed in public/fonts/README.txt
// (and in FONTS below). What it does to each font:
// - keeps glyph ids; empties every glyph outside the character set (and the
//   components of kept composites stay); zeroes the dropped glyphs' metrics;
// - rebuilds cmap as one (3,1) format 4 subtable for exactly the kept characters;
// - drops GSUB/GDEF and hinting (fpgm, prep, cvt, ...) and strips glyph
//   instructions; keeps GPOS/kern for kerning; post becomes format 3;
// - renames the family (under the OFL a subset is a Modified Version, and two
//   of these fonts reserve their names), keeping copyright, version and licence;
// - writes WOFF2.
// The output is deterministic: the same originals give the same bytes.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { FACES, SUBSET } from '../src/workshop/view/labels/fonts.ts';
import type { FaceRole } from '../src/workshop/view/labels/fonts.ts';

/** Which original makes which file. */
export const FONTS: Record<FaceRole, { original: string; source: string }> = {
  tape: { original: 'BarlowSemiCondensed-SemiBold.ttf', source: 'https://github.com/google/fonts/raw/main/ofl/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf' },
  type: { original: 'CourierPrime-Regular.ttf', source: 'https://github.com/google/fonts/raw/main/ofl/courierprime/CourierPrime-Regular.ttf' },
  stencil: { original: 'StardosStencil-Bold.ttf', source: 'https://github.com/google/fonts/raw/main/ofl/stardosstencil/StardosStencil-Bold.ttf' },
  sign: { original: 'AlfaSlabOne-Regular.ttf', source: 'https://github.com/google/fonts/raw/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf' },
};

const pad4 = (n: number): number => (n + 3) & ~3;

function checksum(b: Buffer): number {
  const p = Buffer.concat([b, Buffer.alloc(pad4(b.length) - b.length)]);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s;
}

function readTables(buf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const off = buf.readUInt32BE(r + 8);
    tables.set(buf.toString('latin1', r, r + 4), buf.subarray(off, off + buf.readUInt32BE(r + 12)));
  }
  return tables;
}

function need(tables: Map<string, Buffer>, tag: string): Buffer {
  const b = tables.get(tag);
  if (!b) throw new Error(`subset-fonts: font has no ${tag} table`);
  return b;
}

/** char code -> glyph id, from the best Unicode cmap subtable (format 12 preferred, else 4). */
function readCmap(cmap: Buffer): Map<number, number> {
  const n = cmap.readUInt16BE(2);
  let best: { o: number; fmt: number } | null = null;
  for (let i = 0; i < n; i++) {
    const pid = cmap.readUInt16BE(4 + i * 8);
    const eid = cmap.readUInt16BE(6 + i * 8);
    const o = cmap.readUInt32BE(8 + i * 8);
    const fmt = cmap.readUInt16BE(o);
    if (fmt === 12 && ((pid === 3 && eid === 10) || pid === 0)) best = { o, fmt };
    else if (fmt === 4 && ((pid === 3 && eid === 1) || pid === 0) && (!best || best.fmt !== 12)) best = { o, fmt };
  }
  if (!best) throw new Error('subset-fonts: no Unicode cmap');
  const map = new Map<number, number>();
  const o = best.o;
  if (best.fmt === 4) {
    const segX2 = cmap.readUInt16BE(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ros = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = cmap.readUInt16BE(ends + s * 2);
      const start = cmap.readUInt16BE(starts + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const ro = cmap.readUInt16BE(ros + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = cmap.readUInt16BE(ros + s * 2 + ro + (c - start) * 2);
          g = gi === 0 ? 0 : (gi + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else {
    const groups = cmap.readUInt32BE(o + 12);
    for (let i = 0; i < groups; i++) {
      const s = cmap.readUInt32BE(o + 16 + i * 12);
      const e = cmap.readUInt32BE(o + 20 + i * 12);
      const g0 = cmap.readUInt32BE(o + 24 + i * 12);
      for (let c = s; c <= e; c++) map.set(c, g0 + c - s);
    }
  }
  return map;
}

/** Walk a composite glyph's components: calls `each(flagOffset, flags)` and returns the byte length up to the last component. */
function walkComponents(g: Buffer, each: (p: number, flags: number) => void): number {
  let p = 10;
  let flags: number;
  do {
    flags = g.readUInt16BE(p);
    each(p, flags);
    p += 4;
    p += flags & 1 ? 4 : 2;
    if (flags & 8) p += 2;
    else if (flags & 0x40) p += 4;
    else if (flags & 0x80) p += 8;
  } while (flags & 0x20);
  return p;
}

function buildCmap(keep: Map<number, number>): Buffer {
  const codes = [...keep.keys()].filter((c) => c <= 0xffff).sort((a, b) => a - b);
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const c of codes) {
    const g = keep.get(c)!;
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && g - c === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: g - c });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const len = 16 + n * 8;
  const sub = Buffer.alloc(len);
  let es = 1;
  let ent = 0;
  while (es * 2 <= n) {
    es *= 2;
    ent++;
  }
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(len, 2);
  sub.writeUInt16BE(0, 4);
  sub.writeUInt16BE(n * 2, 6);
  sub.writeUInt16BE(es * 2, 8);
  sub.writeUInt16BE(ent, 10);
  sub.writeUInt16BE(n * 2 - es * 2, 12);
  segs.forEach((s, i) => {
    sub.writeUInt16BE(s.end, 14 + i * 2);
    sub.writeUInt16BE(s.start, 16 + n * 2 + i * 2);
    sub.writeUInt16BE((s.delta + 0x10000) & 0xffff, 16 + n * 4 + i * 2);
    sub.writeUInt16BE(0, 16 + n * 6 + i * 2);
  });
  const hdr = Buffer.alloc(20);
  hdr.writeUInt16BE(0, 0);
  hdr.writeUInt16BE(2, 2);
  hdr.writeUInt16BE(0, 4);
  hdr.writeUInt16BE(3, 6);
  hdr.writeUInt32BE(20, 8);
  hdr.writeUInt16BE(3, 12);
  hdr.writeUInt16BE(1, 14);
  hdr.writeUInt32BE(20, 16);
  return Buffer.concat([hdr, sub]);
}

function buildName(name: Buffer, family: string): Buffer {
  const count = name.readUInt16BE(2);
  const strOff = name.readUInt16BE(4);
  const orig = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (name.readUInt16BE(r) === 3 && name.readUInt16BE(r + 2) === 1 && name.readUInt16BE(r + 4) === 0x409) {
      const len = name.readUInt16BE(r + 8);
      const o = strOff + name.readUInt16BE(r + 10);
      let s = '';
      for (let k = 0; k < len; k += 2) s += String.fromCharCode(name.readUInt16BE(o + k));
      orig.set(name.readUInt16BE(r + 6), s);
    }
  }
  const ps = family.replace(/[^A-Za-z0-9]/g, '') + '-Regular';
  const recs = new Map<number, string>([
    [0, orig.get(0) ?? ''],
    [1, family],
    [2, 'Regular'],
    [3, `${ps};subset of ${orig.get(4) ?? orig.get(1)} ${orig.get(5) ?? ''}`.trim()],
    [4, family],
    [5, orig.get(5) ?? 'Version 1.0'],
    [6, ps],
    [13, orig.get(13) ?? 'This Font Software is licensed under the SIL Open Font License, Version 1.1.'],
    [14, orig.get(14) ?? 'https://openfontlicense.org'],
  ]);
  const ids = [...recs.keys()].filter((k) => recs.get(k)).sort((a, b) => a - b);
  const strs = ids.map((k) => {
    const s = recs.get(k)!;
    const b = Buffer.alloc(s.length * 2);
    for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
    return b;
  });
  const hdr = Buffer.alloc(6 + ids.length * 12);
  hdr.writeUInt16BE(0, 0);
  hdr.writeUInt16BE(ids.length, 2);
  hdr.writeUInt16BE(6 + ids.length * 12, 4);
  let so = 0;
  ids.forEach((k, i) => {
    const r = 6 + i * 12;
    const len = strs[i]!.length;
    hdr.writeUInt16BE(3, r);
    hdr.writeUInt16BE(1, r + 2);
    hdr.writeUInt16BE(0x409, r + 4);
    hdr.writeUInt16BE(k, r + 6);
    hdr.writeUInt16BE(len, r + 8);
    hdr.writeUInt16BE(so, r + 10);
    so += len;
  });
  return Buffer.concat([hdr, ...strs]);
}

/** WOFF2's table of known tags (index = the tag's code in the directory). */
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function base128(n: number): Buffer {
  const bytes = [n & 0x7f];
  let v = Math.floor(n / 128);
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return Buffer.from(bytes);
}

export interface SubsetResult {
  woff2: Buffer;
  glyphsKept: number;
  glyphsTotal: number;
  missing: string[];
}

/** Subset one TrueType font to `chars`, renamed `family`, as WOFF2. */
export function subsetFont(ttf: Buffer, family: string, chars: string): SubsetResult {
  const tables = readTables(ttf);
  const head = Buffer.from(need(tables, 'head'));
  const longLoca = head.readInt16BE(50) === 1;
  const numGlyphs = need(tables, 'maxp').readUInt16BE(4);
  const loca = need(tables, 'loca');
  const glyf = need(tables, 'glyf');
  const off = (g: number): number => (longLoca ? loca.readUInt32BE(g * 4) : loca.readUInt16BE(g * 2) * 2);
  const glyph = (g: number): Buffer => glyf.subarray(off(g), Math.max(off(g), off(g + 1)));

  const cmap = readCmap(need(tables, 'cmap'));
  const want = [...new Set([...chars].map((c) => c.codePointAt(0)!))].sort((a, b) => a - b);
  const keepMap = new Map<number, number>();
  const missing: string[] = [];
  for (const c of want) {
    const g = cmap.get(c);
    if (g) keepMap.set(c, g);
    else missing.push(String.fromCodePoint(c));
  }

  // Glyph closure over composites.
  const keep = new Set<number>([0, ...keepMap.values()]);
  const stack = [...keep];
  while (stack.length) {
    const g = glyph(stack.pop()!);
    if (g.length === 0 || g.readInt16BE(0) >= 0) continue;
    walkComponents(g, (p) => {
      const c = g.readUInt16BE(p + 2);
      if (!keep.has(c)) {
        keep.add(c);
        stack.push(c);
      }
    });
  }

  // Kept glyphs without instructions; long loca.
  const stripped = (gi: number): Buffer => {
    const src = Buffer.from(glyph(gi));
    if (src.length === 0) return src;
    const nc = src.readInt16BE(0);
    if (nc >= 0) {
      const il = 10 + nc * 2;
      const instrLen = src.readUInt16BE(il);
      return Buffer.concat([src.subarray(0, il), Buffer.from([0, 0]), src.subarray(il + 2 + instrLen)]);
    }
    const end = walkComponents(src, (p, flags) => {
      if (flags & 0x100) src.writeUInt16BE(flags & ~0x100, p);
    });
    return src.subarray(0, end);
  };
  const bodies: Buffer[] = [];
  const newLoca = Buffer.alloc((numGlyphs + 1) * 4);
  let cur = 0;
  for (let g = 0; g < numGlyphs; g++) {
    newLoca.writeUInt32BE(cur, g * 4);
    if (!keep.has(g)) continue;
    let gb = stripped(g);
    if (gb.length % 4) gb = Buffer.concat([gb, Buffer.alloc(4 - (gb.length % 4))]);
    bodies.push(gb);
    cur += gb.length;
  }
  newLoca.writeUInt32BE(cur, numGlyphs * 4);
  head.writeInt16BE(1, 50);
  head.writeUInt32BE(0, 8);

  // Zero the metrics of dropped glyphs (they compress away).
  const nhm = need(tables, 'hhea').readUInt16BE(34);
  const hmtx = Buffer.from(need(tables, 'hmtx'));
  for (let g = 0; g < numGlyphs; g++) {
    if (keep.has(g)) continue;
    if (g < nhm) hmtx.writeUInt32BE(0, g * 4);
    else hmtx.writeInt16BE(0, nhm * 4 + (g - nhm) * 2);
  }

  const post = Buffer.from(need(tables, 'post').subarray(0, 32));
  post.writeUInt32BE(0x00030000, 0);
  const out = new Map<string, Buffer>([
    ['cmap', buildCmap(keepMap)],
    ['head', head],
    ['hhea', Buffer.from(need(tables, 'hhea'))],
    ['hmtx', hmtx],
    ['maxp', Buffer.from(need(tables, 'maxp'))],
    ['name', buildName(need(tables, 'name'), family)],
    ['OS/2', Buffer.from(need(tables, 'OS/2'))],
    ['post', post],
    ['glyf', Buffer.concat(bodies)],
    ['loca', newLoca],
  ]);
  for (const t of ['GPOS', 'kern', 'gasp']) {
    const b = tables.get(t);
    if (b) out.set(t, Buffer.from(b));
  }
  const tags = [...out.keys()].sort();
  const table = (t: string): Buffer => out.get(t)!;

  // head.checkSumAdjustment, computed over the equivalent sfnt.
  {
    const n = tags.length;
    const dir = Buffer.alloc(12 + n * 16);
    dir.writeUInt32BE(0x00010000, 0);
    dir.writeUInt16BE(n, 4);
    let es = 1;
    let ent = 0;
    while (es * 2 <= n) {
      es *= 2;
      ent++;
    }
    dir.writeUInt16BE(es * 16, 6);
    dir.writeUInt16BE(ent, 8);
    dir.writeUInt16BE(n * 16 - es * 16, 10);
    let o = 12 + n * 16;
    const parts: Buffer[] = [];
    tags.forEach((t, i) => {
      const b = table(t);
      const r = 12 + i * 16;
      dir.write(t, r, 'latin1');
      dir.writeUInt32BE(checksum(b), r + 4);
      dir.writeUInt32BE(o, r + 8);
      dir.writeUInt32BE(b.length, r + 12);
      parts.push(b, Buffer.alloc(pad4(b.length) - b.length));
      o += pad4(b.length);
    });
    head.writeUInt32BE((0xb1b0afba - checksum(Buffer.concat([dir, ...parts]))) >>> 0, 8);
  }

  // WOFF2: glyf and loca null-transformed (transform version 3), loca right after glyf.
  const order = tags.filter((t) => t !== 'loca');
  order.splice(order.indexOf('glyf') + 1, 0, 'loca');
  const wdir = Buffer.concat(
    order.map((t) => {
      const ki = KNOWN.indexOf(t);
      const xf = t === 'glyf' || t === 'loca' ? 3 : 0;
      return Buffer.concat([Buffer.from([(ki >= 0 ? ki : 63) | (xf << 6)]), ki >= 0 ? Buffer.alloc(0) : Buffer.from(t, 'latin1'), base128(table(t).length)]);
    }),
  );
  const stream = Buffer.concat(order.map(table));
  const comp = brotliCompressSync(stream, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT, [constants.BROTLI_PARAM_SIZE_HINT]: stream.length },
  });
  const totalSfnt = 12 + 16 * tags.length + tags.reduce((s, t) => s + pad4(table(t).length), 0);
  const bodyLen = 48 + wdir.length + comp.length;
  const total = pad4(bodyLen);
  const hdr = Buffer.alloc(48);
  hdr.write('wOF2', 0, 'latin1');
  hdr.writeUInt32BE(0x00010000, 4);
  hdr.writeUInt32BE(total, 8);
  hdr.writeUInt16BE(tags.length, 12);
  hdr.writeUInt32BE(totalSfnt, 16);
  hdr.writeUInt32BE(comp.length, 20);
  hdr.writeUInt16BE(1, 24);
  hdr.writeUInt16BE(0, 26);
  return { woff2: Buffer.concat([hdr, wdir, comp, Buffer.alloc(total - bodyLen)]), glyphsKept: keep.size, glyphsTotal: numGlyphs, missing };
}

function main(argv: string[]): number {
  const [src, outDir = 'public/fonts'] = argv;
  if (!src) {
    console.error('usage: node scripts/subset-fonts.ts <dir holding the original .ttf files> [out dir]');
    for (const f of Object.values(FONTS)) console.error(`  ${f.original}  from ${f.source}`);
    return 2;
  }
  for (const role of Object.keys(FONTS) as FaceRole[]) {
    const spec = FONTS[role];
    const face = FACES[role];
    const res = subsetFont(readFileSync(join(src, spec.original)), face.family, SUBSET[role]);
    const dest = join(outDir, face.file);
    writeFileSync(dest, res.woff2);
    const miss = res.missing.length ? `; NOT IN FONT: ${JSON.stringify(res.missing.join(''))}` : '';
    console.log(`${dest}: ${res.woff2.length} bytes, ${res.glyphsKept} of ${res.glyphsTotal} glyphs (${face.family} from ${spec.original})${miss}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
