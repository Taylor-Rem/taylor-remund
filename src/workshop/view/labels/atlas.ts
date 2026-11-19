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
 * Layout. Skyline packing in cells of CELL texels; every region sits GUTTER
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
import type { Material, Texture, WebGLRenderer } from 'three';
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

/**
 * Skyline packer over a w×h page (bottom-left: each cell goes where its top
 * would be lowest), cells rounded up to CELL. Labels arrive one at a time
 * (online), of mixed heights; a skyline wastes far less than shelves did
 * (the bench's relief page: 2048 × 1920 rows with shelves).
 */
export class Shelves {
  /** The skyline: x-sorted segments, each at the height of what is under it. */
  private sky: Array<{ x: number; w: number; y: number }>;
  private top = 0;
  readonly w: number;
  readonly h: number;
  /** Texels of repeated edge round each region (0: one region fills the page, ClampToEdge does it). */
  readonly gutter: number;
  constructor(w: number, h: number, gutter = GUTTER) {
    this.w = w;
    this.h = h;
    this.gutter = gutter;
    this.sky = [{ x: 0, w, y: 0 }];
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
    let best: { i: number; x: number; y: number } | null = null;
    for (let i = 0; i < this.sky.length; i++) {
      const x = this.sky[i]!.x;
      if (x + cw > this.w) break;
      // the cell rests on the highest segment it spans
      let y = 0;
      for (let j = i, span = 0; span < cw; j++) {
        const sg = this.sky[j]!;
        y = Math.max(y, sg.y);
        span = sg.x + sg.w - x;
      }
      if (y + ch > this.h) continue;
      if (!best || y + ch < best.y + ch || (y + ch === best.y + ch && x < best.x)) best = { i, x, y };
    }
    if (!best) return null;
    // raise the skyline under the cell
    const x0 = best.x, x1 = best.x + cw, top = best.y + ch;
    const next: Array<{ x: number; w: number; y: number }> = [];
    for (const sg of this.sky) {
      const a = sg.x, b = sg.x + sg.w;
      if (b <= x0 || a >= x1) next.push(sg);
      else {
        if (a < x0) next.push({ x: a, w: x0 - a, y: sg.y });
        if (b > x1) next.push({ x: x1, w: b - x1, y: sg.y });
      }
    }
    next.push({ x: x0, w: cw, y: top });
    next.sort((p, q) => p.x - q.x);
    // merge neighbours at the same height
    this.sky = [];
    for (const sg of next) {
      const last = this.sky[this.sky.length - 1];
      if (last && last.y === sg.y && last.x + last.w === sg.x) last.w += sg.w;
      else this.sky.push({ ...sg });
    }
    this.top = Math.max(this.top, top);
    return { x: x0 + G, y: best.y + G, w, h };
  }
  /** Rows covered so far (the page's texture needs no more). */
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

/**
 * Uploads after a page is on the GPU (T1 round 3). Rows written to a live page are queued as
 * rectangles and sent up in BANDS: one texSubImage2D per band (UNPACK_ROW_LENGTH / SKIP_* cut
 * the band out of the page's CPU copy), at most `frameBytes` a frame, spread over animation
 * frames; when a page's queue is empty its mip chain is rebuilt once (generateMipmap). Without a
 * renderer the old path stands: three uploads the rows itself at the next draw, a call a row.
 */
export interface Uploads {
  renderer: WebGLRenderer | null;
  /** Bytes in one band (one texSubImage2D). */
  bandBytes: number;
  /** Bytes sent up in one frame, at most (a band is never split below one row). */
  frameBytes: number;
  /** Ask for a pump at the next animation frame. */
  schedule(): void;
  /** What it cost (performance.now() ms on the main thread). */
  stats: { bands: number; bytes: number; ms: number; maxMs: number; mips: number; mipMs: number };
}

/** Bytes in one band, and sent up in one frame at most (measured: see the T1 round 3 hand-in). */
export const BAND_BYTES = 256 * 1024;
export const FRAME_BYTES = 256 * 1024;

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
  /** Rectangles written since the page went up, to send in bands (with a renderer). */
  private queue: Rect[] = [];
  private up: Uploads | null;
  readonly w: number;
  readonly h: number;
  /** Rows the texture holds now. */
  rows = 0;
  constructor(w: number, h: number, colour: boolean, anisotropy: number, up: Uploads | null = null) {
    this.w = w;
    this.h = h;
    this.up = up;
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
      this.queue = [];
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
    if (this.live && this.up?.renderer && this.glTexture()) {
      this.queue.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      this.up.schedule();
      return;
    }
    if (this.live) {
      for (let y = y0; y < y1; y++) {
        const r = { start: (y * this.w + x0) * 4, count: (x1 - x0) * 4 };
        this.pending.push(r);
        for (const v of this.views) v.addUpdateRange(r.start, r.count);
      }
    }
    for (const v of this.views) v.needsUpdate = true;
  }
  /** The GL texture three made for this page (any live view's), or null. */
  private glTexture(): WebGLTexture | null {
    const r = this.up?.renderer;
    if (!r) return null;
    for (const v of this.views) {
      const t = (r.properties.get(v) as { __webglTexture?: WebGLTexture }).__webglTexture;
      if (t) return t;
    }
    return null;
  }
  /** Bytes still queued. */
  queued(): number {
    return this.queue.reduce((n, q) => n + q.w * q.h * 4, 0);
  }
  /**
   * Send up to `budget` bytes of the queue, a band per texSubImage2D; rebuild the mips when the
   * queue is empty. Returns the bytes sent.
   */
  pump(budget: number): number {
    const up = this.up;
    if (!up?.renderer || !this.queue.length) return 0;
    const tex = this.glTexture();
    if (!tex) {
      // the GL texture went (disposed, grown): the next draw uploads the whole page
      this.queue = [];
      for (const v of this.views) v.needsUpdate = true;
      return 0;
    }
    const r = up.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    const st = r.state;
    const data = this.data;
    st.bindTexture(gl.TEXTURE_2D, tex);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    st.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, this.w);
    let sent = 0;
    while (this.queue.length && sent < budget) {
      const q = this.queue[0]!;
      const n = Math.min(q.h, Math.max(1, Math.floor(up.bandBytes / (q.w * 4))));
      const t0 = performance.now();
      st.pixelStorei(gl.UNPACK_SKIP_PIXELS, q.x);
      st.pixelStorei(gl.UNPACK_SKIP_ROWS, q.y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, q.x, q.y, q.w, n, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const dt = performance.now() - t0;
      up.stats.bands++;
      up.stats.bytes += q.w * n * 4;
      up.stats.ms += dt;
      up.stats.maxMs = Math.max(up.stats.maxMs, dt);
      sent += q.w * n * 4;
      q.y += n;
      q.h -= n;
      if (q.h <= 0) this.queue.shift();
    }
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    st.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    st.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    if (!this.queue.length) {
      const t0 = performance.now();
      gl.generateMipmap(gl.TEXTURE_2D);
      up.stats.mips++;
      up.stats.mipMs += performance.now() - t0;
    }
    st.unbindTexture();
    return sent;
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
  constructor(kind: PageKind, index: number, anisotropy: number, size: { w: number; h: number } = PAGE_SIZE[kind], gutter = GUTTER, up: Uploads | null = null) {
    this.kind = kind;
    this.index = index;
    const { w, h } = size;
    this.w = w;
    this.h = h;
    this.color = new PageMap(w, h, true, anisotropy, up);
    this.normal = kind === 'relief' ? new PageMap(w, h, false, anisotropy, up) : null;
    this.rough = kind === 'relief' ? new PageMap(w / 2, h / 2, false, anisotropy, up) : null;
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
  private frame = 0;
  /** Band uploads (see Uploads); live once a renderer is attached. */
  readonly up: Uploads;
  constructor(anisotropy: number, band: { bandBytes?: number; frameBytes?: number } = {}) {
    this.anisotropy = anisotropy;
    this.up = {
      renderer: null,
      bandBytes: band.bandBytes ?? BAND_BYTES,
      frameBytes: band.frameBytes ?? FRAME_BYTES,
      schedule: () => this.schedule(),
      stats: { bands: 0, bytes: 0, ms: 0, maxMs: 0, mips: 0, mipMs: 0 },
    };
  }
  /** Send later writes to live pages up in bands through this renderer. */
  attach(renderer: WebGLRenderer): void {
    this.up.renderer = renderer;
  }
  private schedule(): void {
    if (this.frame || typeof requestAnimationFrame !== 'function') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.pump();
    });
  }
  /** One frame's worth of bands, across every page; asks for another frame while any are left. */
  pump(budget = this.up.frameBytes): void {
    let left = budget;
    for (const p of this.pages) for (const m of p.maps()) if (left > 0) left -= m.pump(left);
    if (this.pages.some((p) => p.maps().some((m) => m.queued() > 0))) this.schedule();
  }
  /** Bytes still waiting to go up. */
  queued(): number {
    return this.pages.reduce((n, p) => n + p.maps().reduce((k, m) => k + m.queued(), 0), 0);
  }
  place(kind: PageKind, w: number, h: number): { page: Page; rect: Rect } | null {
    const { w: pw, h: ph } = PAGE_SIZE[kind];
    if (w + 2 * GUTTER > pw || h + 2 * GUTTER > ph) return null;
    for (const page of this.pages) {
      if (page.kind !== kind) continue;
      const rect = page.alloc(w, h);
      if (rect) return { page, rect };
    }
    const page = new Page(kind, this.pages.filter((p) => p.kind === kind).length, this.anisotropy, PAGE_SIZE[kind], GUTTER, this.up);
    this.pages.push(page);
    const rect = page.alloc(w, h);
    return rect ? { page, rect } : null;
  }
  /** A page of its own for a region too big for a shared page (flat only). */
  dedicated(w: number, h: number): { page: Page; rect: Rect } {
    // exactly its size, no gutter: sampled as a texture of its own would be (ClampToEdge, its own mips)
    const page = new Page('flat', this.pages.filter((p) => p.kind === 'flat').length, this.anisotropy, { w, h }, 0, this.up);
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
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const p of this.pages) p.dispose();
    this.pages.length = 0;
  }
}

export type { MapName };
