/**
 * The label atlas (T1): every static label of the scene on a few shared
 * pages, so that label quads of one piece merge into one mesh.
 *
 * Two kinds of page:
 *  - `relief`: colour + tangent-space normal + roughness/metalness (half
 *    size): label tape, brass plates, the painted sign;
 *  - `flat`: colour only: stencils, cards, slips, and redrawable regions.
 * A label's alpha (opaque, cut, sprayed) is the material's business, not the
 * page's: one page holds all three, and only the material differs.
 *
 * Layout. Shelf packing in cells of CELL texels; every region sits GUTTER
 * texels inside its cell and the gutter repeats the region's edge texels, so
 * linear filtering at the region's edge sees what ClampToEdge saw on the
 * label's own texture, and every mip level up to CELL texels (level 4) is
 * built only from the region and its own gutter. Rows are stored bottom-up
 * (texture v runs up), as the labels' own textures were.
 *
 * Views. Every label gets its own Texture objects (`clone()`: same Source,
 * so one GL texture per page) whose offset/repeat cut its region out of the
 * page: a quad with 0..1 uvs draws exactly as before, through any backend.
 * Each page also has "whole" views on uv channel 1 with no transform: realize
 * merges the label quads of a piece that share a page into one mesh, writing
 * each quad's atlas uv into uv1 (`labelAtlasOf`, kit/realize.ts).
 *
 * The normal map and the tangent frame. three's tangent frame without
 * tangents (getTangentFrame) takes its axes' LENGTHS from the derivatives of
 * the uv the normal map is sampled with, and scales both by the longer: on a
 * label's own texture a wide label's x-slopes come out weaker than its
 * y-slopes by h/w. A region of a page has other derivatives, so the label
 * materials build the frame from the quad's own 0..1 uv (materials/index.ts
 * LABEL_LOCAL_FRAME): the same normal comes out, and the normal map is
 * stored exactly as on the label's own texture.
 *
 * Updates. Before a page's first upload, writes go into its data and the
 * first upload takes the whole page; after it, a write re-uploads only the
 * rows of the cells it touched (Texture.updateRanges, one texSubImage2D per
 * row) and the GPU rebuilds the page's mips.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { Material, Texture } from 'three';
import { textureBytes } from './layout.ts';

export type PageKind = 'relief' | 'flat';
export type Alpha = 'opaque' | 'cut' | 'spray';

/** Page sizes in texels. */
export const PAGE_SIZE: Record<PageKind, { w: number; h: number }> = {
  relief: { w: 2048, h: 2048 },
  flat: { w: 2048, h: 1024 },
};
/** Edge texels repeated round every region. */
export const GUTTER = 8;
/** Cells are multiples of this (mip levels up to it never mix two regions). */
export const CELL = 16;

/** A region in texels of the colour page, y counted from the bottom row. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf packer over a w×h page, cells rounded up to CELL. */
export class Shelves {
  private shelves: Array<{ y: number; h: number; x: number }> = [];
  private top = 0;
  readonly w: number;
  readonly h: number;
  /** Texels of repeated edge round each region (0: one region fills the page, ClampToEdge does it). */
  readonly gutter: number;
  constructor(w: number, h: number, gutter = GUTTER) {
    this.w = w;
    this.h = h;
    this.gutter = gutter;
  }
  /** A cell for a w×h region (plus gutters), or null when the page is full. */
  alloc(w: number, h: number): Rect | null {
    const G = this.gutter;
    if (G === 0) {
      // a page of its own: the region is the page
      if (this.top > 0 || w > this.w || h > this.h) return null;
      this.top = h;
      return { x: 0, y: 0, w, h };
    }
    const cw = Math.ceil((w + 2 * G) / CELL) * CELL;
    const ch = Math.ceil((h + 2 * G) / CELL) * CELL;
    if (cw > this.w || ch > this.h) return null;
    // the lowest shelf it fits on without wasting more than half the shelf's height
    let best: { y: number; h: number; x: number } | null = null;
    for (const s of this.shelves) if (s.h >= ch && s.h <= ch * 2 && this.w - s.x >= cw && (!best || s.h < best.h)) best = s;
    if (!best) {
      if (this.top + ch > this.h) {
        // no new shelf fits: any shelf with room, whatever its height
        for (const s of this.shelves) if (s.h >= ch && this.w - s.x >= cw) best = s;
        if (!best) return null;
      } else {
        best = { y: this.top, h: ch, x: 0 };
        this.shelves.push(best);
        this.top += ch;
      }
    }
    const cell = { x: best.x, y: best.y, w: cw, h: ch };
    best.x += cw;
    return { x: cell.x + G, y: cell.y + G, w, h };
  }
  /** Rows covered by shelves so far (the page's texture needs no more). */
  get height(): number {
    return this.top;
  }
}

/**
 * Copy `src` (w×h RGBA, rows top-down) into `dst` (a page `dw` wide, rows
 * bottom-up) with its bottom-left texel at (x, y), repeating the edge texels
 * `g` deep all round.
 */
export function blit(dst: Uint8Array, dw: number, src: Uint8Array, w: number, h: number, x: number, y: number, g: number): void {
  const stride = w * 4;
  for (let r = -g; r < h + g; r++) {
    const sr = h - 1 - Math.min(h - 1, Math.max(0, r)); // source row, top-down
    const row = src.subarray(sr * stride, sr * stride + stride);
    const o = ((y + r) * dw + x) * 4;
    dst.set(row, o);
    const l0 = row[0]!, l1 = row[1]!, l2 = row[2]!, l3 = row[3]!;
    const e = stride - 4;
    const r0 = row[e]!, r1 = row[e + 1]!, r2 = row[e + 2]!, r3 = row[e + 3]!;
    for (let k = 1; k <= g; k++) {
      const a = o - k * 4;
      dst[a] = l0;
      dst[a + 1] = l1;
      dst[a + 2] = l2;
      dst[a + 3] = l3;
      const b = o + stride + (k - 1) * 4;
      dst[b] = r0;
      dst[b + 1] = r1;
      dst[b + 2] = r2;
      dst[b + 3] = r3;
    }
  }
}

type MapName = 'color' | 'normal' | 'rough';

/** Rows a page texture grows by (a multiple of CELL, so mips stay aligned). */
const GROW = 64;

/**
 * One page texture and every view of it. The page is `w` × `h` texels as far as
 * the layout and every uv are concerned (its virtual size), but its texture holds
 * only the rows the shelves have used so far (`rows`, grown on demand): each view's
 * transform maps the virtual fractions onto the rows that exist. Growing before the
 * first upload only reallocates the CPU copy; after it, the GL texture is made again.
 */
class PageMap {
  readonly texture: DataTexture;
  readonly views: Texture[] = [];
  /** Each view's transform in virtual page fractions (applied through `rows`). */
  private virt = new Map<Texture, { off: [number, number]; rep: [number, number] }>();
  /** Uploaded at least once (from then on, writes go up as row ranges). */
  live = false;
  /** The CPU copy was let go (a sealed page with nothing to redraw, once uploaded). */
  dropped = false;
  /** Drop the CPU copy after the next upload. */
  dropAfterUpload = false;
  /** Row ranges written since the last upload (start, count in bytes). */
  private pending: Array<{ start: number; count: number }> = [];
  readonly w: number;
  readonly h: number;
  /** Rows the texture holds now. */
  rows = 0;
  constructor(w: number, h: number, colour: boolean, anisotropy: number) {
    this.w = w;
    this.h = h;
    const t = new DataTexture(new Uint8Array(0), w, 0, RGBAFormat, UnsignedByteType);
    t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.anisotropy = anisotropy;
    t.unpackAlignment = 4;
    this.texture = t;
  }
  get data(): Uint8Array {
    if (this.dropped) throw new Error('labels: a sealed atlas page has no CPU copy');
    return (this.texture.image as { data: Uint8Array }).data;
  }
  /** Make sure the texture holds rows [0, n). */
  ensure(n: number): void {
    if (n <= this.rows) return;
    const want = Math.min(this.h, Math.ceil(Math.max(n, this.live ? this.rows * 1.25 : 0) / GROW) * GROW);
    const old = this.rows ? this.data : null;
    const data = new Uint8Array(this.w * want * 4);
    if (old) data.set(old);
    if (this.live) {
      // a new GL texture of the new size: every view lets go of the old one first
      for (const v of this.views) v.dispose();
      this.live = false;
      this.pending = [];
    }
    this.texture.source.data = { data, width: this.w, height: want };
    this.rows = want;
    for (const v of this.views) this.place(v);
    for (const v of this.views) v.needsUpdate = true;
  }
  private place(v: Texture): void {
    const t = this.virt.get(v)!;
    const k = this.rows ? this.h / this.rows : 1;
    v.offset.set(t.off[0], t.off[1] * k);
    v.repeat.set(t.rep[0], t.rep[1] * k);
  }
  /** A new view (same GL texture): offset/repeat in virtual page fractions, on uv `channel`. */
  view(offset: [number, number], repeat: [number, number], channel: number): Texture {
    // clone() marks the shared source for upload; a new view of a page already up needs none
    // (and a sealed page has no CPU copy left to send)
    const sv = this.texture.source.version;
    const v = this.texture.clone();
    this.texture.source.version = sv;
    v.channel = channel;
    this.virt.set(v, { off: offset, rep: repeat });
    this.place(v);
    v.clearUpdateRanges();
    v.onUpdate = () => {
      this.live = true;
      this.uploaded();
      for (const o of this.views) o.clearUpdateRanges();
      if (this.dropAfterUpload) this.drop();
    };
    this.views.push(v);
    if (this.live) for (const r of this.pending) v.addUpdateRange(r.start, r.count);
    return v;
  }
  /** Let the CPU copy go after the next upload (now, if it is uploaded and nothing waits). */
  requestDrop(): void {
    this.dropAfterUpload = true;
    if (this.live && this.pending.length === 0) this.drop();
  }
  /** Let the CPU copy go (the GL texture keeps the pixels). */
  private drop(): void {
    if (this.dropped) return;
    this.dropped = true;
    this.texture.source.data = { data: null, width: this.w, height: this.rows };
  }
  /** Rows [y0, y1) of columns [x0, x1) were written: send them up at the next draw. */
  touched(x0: number, x1: number, y0: number, y1: number): void {
    if (this.live) {
      for (let y = y0; y < y1; y++) {
        const r = { start: (y * this.w + x0) * 4, count: (x1 - x0) * 4 };
        this.pending.push(r);
        for (const v of this.views) v.addUpdateRange(r.start, r.count);
      }
    }
    for (const v of this.views) v.needsUpdate = true;
  }
  /** After an upload, forget the ranges (every view's are cleared in onUpdate). */
  uploaded(): void {
    this.pending = [];
  }
  /** GPU bytes (RGBA8 + mips) of what the texture holds now. */
  bytes(): number {
    return this.rows ? textureBytes(this.w, this.rows) : 0;
  }
  /** CPU bytes kept. */
  cpuBytes(): number {
    return this.dropped ? 0 : this.w * this.rows * 4;
  }
  dispose(): void {
    for (const v of this.views) v.dispose();
    this.texture.dispose();
  }
}

/** The views of one region: what a label's material uses. */
export interface RegionViews {
  map: Texture;
  normal: Texture | null;
  rough: Texture | null;
}

/** What realize needs to merge a label part into its page's mesh (`labelAtlasOf`). */
export interface AtlasInfo {
  /** The page's own key for this alpha (a Labels key with no '|': textures with no transform, on uv1). */
  page: string;
  /** The region in page fractions: [u0, v0, u1, v1]. */
  rect: [number, number, number, number];
}

/** The atlas facts a label's material carries (set on its colour map's userData by createLabels), or null. */
export function labelAtlasOf(material: Material): AtlasInfo | null {
  const map = (material as { map?: Texture | null }).map;
  return (map?.userData?.['labelAtlas'] as AtlasInfo | undefined) ?? null;
}

export class Page {
  readonly color: PageMap;
  readonly normal: PageMap | null;
  readonly rough: PageMap | null;
  readonly shelves: Shelves;
  readonly w: number;
  readonly h: number;
  private whole: RegionViews | null = null;
  /** No new labels go here (set at labels.ready()); its CPU copy goes after upload unless it holds a redrawable region. */
  sealed = false;
  /** It holds a region that is redrawn at run time (its CPU copy is kept). */
  redrawn = false;
  readonly kind: PageKind;
  readonly index: number;
  constructor(kind: PageKind, index: number, anisotropy: number, size: { w: number; h: number } = PAGE_SIZE[kind], gutter = GUTTER) {
    this.kind = kind;
    this.index = index;
    const { w, h } = size;
    this.w = w;
    this.h = h;
    this.color = new PageMap(w, h, true, anisotropy);
    this.normal = kind === 'relief' ? new PageMap(w, h, false, anisotropy) : null;
    this.rough = kind === 'relief' ? new PageMap(w / 2, h / 2, false, anisotropy) : null;
    this.shelves = new Shelves(w, h, gutter);
  }
  /** The key materials use for this page's whole views with `alpha` (see materials labelAlpha: sprayed keys start "stencil"). */
  key(alpha: Alpha): string {
    const base = `atlas.${this.kind}${this.index}`;
    return alpha === 'spray' ? `stencil~${base}` : alpha === 'cut' ? `${base}.cut` : base;
  }
  maps(): PageMap[] {
    return [this.color, this.normal, this.rough].filter((m): m is PageMap => !!m);
  }
  /** A region for a w×h label, the page's texture grown to hold it, or null when full or sealed. */
  alloc(w: number, h: number): Rect | null {
    if (this.sealed) return null;
    const r = this.shelves.alloc(w, h);
    if (!r) return null;
    const top = this.shelves.height;
    this.color.ensure(top);
    this.normal?.ensure(top);
    this.rough?.ensure(Math.ceil(top / 2));
    return r;
  }
  /** No more labels here; once uploaded, its CPU copy goes unless something on it is redrawn. */
  seal(): void {
    this.sealed = true;
    if (this.redrawn) return;
    for (const m of this.maps()) m.requestDrop();
  }
  /** Views that cut `r` out of the page (uv channel 0). */
  views(r: Rect): RegionViews {
    const off: [number, number] = [r.x / this.w, r.y / this.h];
    const rep: [number, number] = [r.w / this.w, r.h / this.h];
    return {
      map: this.color.view(off, rep, 0),
      normal: this.normal ? this.normal.view(off, rep, 0) : null,
      // the half-size page in the same fractions (an odd-sized label's last half texel is gutter)
      rough: this.rough ? this.rough.view(off, rep, 0) : null,
    };
  }
  /** The page with no transform, on uv channel 1 (for merged meshes). */
  wholeViews(): RegionViews {
    this.whole ??= {
      map: this.color.view([0, 0], [1, 1], 1),
      normal: this.normal ? this.normal.view([0, 0], [1, 1], 1) : null,
      rough: this.rough ? this.rough.view([0, 0], [1, 1], 1) : null,
    };
    return this.whole;
  }
  info(r: Rect, alpha: Alpha): AtlasInfo {
    return { page: this.key(alpha), rect: [r.x / this.w, r.y / this.h, (r.x + r.w) / this.w, (r.y + r.h) / this.h] };
  }
  /** Write a painted label (rows top-down; roughness already at half size) into its region. */
  write(r: Rect, color: Uint8Array, normal: Uint8Array | null, rough: { data: Uint8Array; w: number; h: number } | null): void {
    const g = this.shelves.gutter;
    blit(this.color.data, this.w, color, r.w, r.h, r.x, r.y, g);
    this.color.touched(r.x - g, r.x + r.w + g, r.y - g, r.y + r.h + g);
    if (this.normal && normal) {
      blit(this.normal.data, this.w, normal, r.w, r.h, r.x, r.y, g);
      this.normal.touched(r.x - g, r.x + r.w + g, r.y - g, r.y + r.h + g);
    }
    if (this.rough && rough) {
      const hx = r.x / 2, hy = r.y / 2, hg = g / 2;
      blit(this.rough.data, this.rough.w, rough.data, rough.w, rough.h, hx, hy, hg);
      this.rough.touched(hx - hg, hx + rough.w + hg, hy - hg, hy + rough.h + hg);
    }
  }
  /** Write rows [top, top + n) of a region (rows counted top-down, as on a canvas) from `rows` (n×w RGBA, top-down). Colour only. */
  writeRows(r: Rect, top: number, rows: Uint8Array, n: number): void {
    const g = this.shelves.gutter;
    const data = this.color.data;
    const stride = r.w * 4;
    const first = top === 0, last = top + n === r.h;
    for (let j = 0; j < n; j++) {
      const row = rows.subarray(j * stride, (j + 1) * stride);
      const ty = r.y + (r.h - 1 - (top + j)); // texture row of canvas row top + j
      // the gutter repeats the edge rows above and below, and the edge columns
      const reps = [ty];
      if (first && j === 0) for (let k = 1; k <= g; k++) reps.push(ty + k);
      if (last && j === n - 1) for (let k = 1; k <= g; k++) reps.push(ty - k);
      for (const yy of reps) {
        const o = (yy * this.w + r.x) * 4;
        data.set(row, o);
        for (let k = 1; k <= g; k++) {
          data.copyWithin(o - k * 4, o, o + 4);
          data.copyWithin(o + stride + (k - 1) * 4, o + stride - 4, o + stride);
        }
      }
    }
    const y1 = r.y + (r.h - top) + (first ? g : 0);
    const y0 = r.y + (r.h - top - n) - (last ? g : 0);
    this.color.touched(r.x - g, r.x + r.w + g, y0, y1);
  }
  bytes(): number {
    return this.maps().reduce((s, m) => s + m.bytes(), 0);
  }
  cpuBytes(): number {
    return this.maps().reduce((s, m) => s + m.cpuBytes(), 0);
  }
  dispose(): void {
    for (const m of this.maps()) m.dispose();
  }
}

/** Every page, by kind; a region goes on the first page with room. */
export class Atlas {
  readonly pages: Page[] = [];
  private readonly anisotropy: number;
  constructor(anisotropy: number) {
    this.anisotropy = anisotropy;
  }
  place(kind: PageKind, w: number, h: number): { page: Page; rect: Rect } | null {
    const { w: pw, h: ph } = PAGE_SIZE[kind];
    if (w + 2 * GUTTER > pw || h + 2 * GUTTER > ph) return null;
    for (const page of this.pages) {
      if (page.kind !== kind) continue;
      const rect = page.alloc(w, h);
      if (rect) return { page, rect };
    }
    const page = new Page(kind, this.pages.filter((p) => p.kind === kind).length, this.anisotropy);
    this.pages.push(page);
    const rect = page.alloc(w, h);
    return rect ? { page, rect } : null;
  }
  /** A page of its own for a region too big for a shared page (flat only). */
  dedicated(w: number, h: number): { page: Page; rect: Rect } {
    // exactly its size, no gutter: sampled as a texture of its own would be (ClampToEdge, its own mips)
    const page = new Page('flat', this.pages.filter((p) => p.kind === 'flat').length, this.anisotropy, { w, h }, 0);
    this.pages.push(page);
    return { page, rect: page.alloc(w, h)! };
  }
  /** The page a page key names (Page.key), or undefined. */
  byKey(key: string): { page: Page; alpha: Alpha } | undefined {
    for (const page of this.pages) for (const alpha of ['opaque', 'cut', 'spray'] as const) if (page.key(alpha) === key) return { page, alpha };
    return undefined;
  }
  bytes(): number {
    return this.pages.reduce((s, p) => s + p.bytes(), 0);
  }
  cpuBytes(): number {
    return this.pages.reduce((s, p) => s + p.cpuBytes(), 0);
  }
  /** Start-up is over: the pages made so far take no more labels. */
  seal(): void {
    for (const p of this.pages) p.seal();
  }
  dispose(): void {
    for (const p of this.pages) p.dispose();
    this.pages.length = 0;
  }
}

export type { MapName };
