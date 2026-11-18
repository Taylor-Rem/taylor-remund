/**
 * Text in the world (REWRITE.md § A "Text in the world", art-direction § 7):
 * label tape, crate stencils, typed cards and slips, engraved brass plates,
 * the hand-painted sign and the phone screen, drawn to textures at start-up
 * from src/content. Implements the `Labels` contract of view/types.ts and a
 * little more (roughness maps, slips, the phone, per-label options, regions
 * that are redrawn at run time).
 *
 *   const labels = await createLabels({ anisotropy: renderer.capabilities.getMaxAnisotropy() });
 *   const key = labels.tape(world.tape.doNotTouch, 'black');
 *   labels.size(key)          // world units the quad wants (meets the 12 px rule by default)
 *   labels.texture(key)       // sRGB colour map, full albedo (use with white vertex colour)
 *   labels.normalMap(key)     // tangent-space normal map, or null
 *   labels.roughnessMap(key)  // G = roughness, B = metalness, or null
 *   labels.transparent(key)   // true: the colour map's alpha cuts the shape (use alphaTest)
 *
 * The atlas (T1, atlas.ts). Tapes, plates, the sign, stencils, cards and
 * slips are regions of a few shared pages; each key's textures are views of
 * its page (one GL texture per page) cut to its region by offset/repeat, so
 * a quad with 0..1 uvs draws as before. `labelAtlasOf(material)` tells
 * realize which page a textured part is on, so it can merge a piece's label
 * quads into one mesh. The phone and labels made with an explicit
 * `texelsPerUnit` keep a texture of their own, as before (the storefront
 * writes its own pixels into one).
 *
 * Start-up (T1). With `workers`, labels asked for before `ready()` resolves
 * are painted in workers (pool.ts): the call returns the key and size at once
 * (the plan is made here), the pixels land on the page when the worker
 * answers, and `ready()` resolves when every one has landed. Await it before
 * the first frame. After that, every label is painted here, synchronously,
 * as before (a card that pops up has its pixels on its first frame).
 *
 * Redrawing (T1). `region(name, size, { alpha, texelsPerUnit })` reserves a
 * colour-only region of a shared page for a texture that changes while it
 * is on screen (a fascia's words, a counter, a screen); `draw((ctx, w, h) =>
 * …)` repaints it on a 2D canvas and re-uploads only its rows.
 *
 * Textures are RGBA8 with mipmaps; rows are uploaded bottom-up, so u runs
 * left to right along the text and v bottom to top on a standard quad.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { Texture } from 'three';
import type { LabelOptions, Labels } from '../types.ts';
import type { Alpha, AtlasInfo, Page, PageKind, Rect } from './atlas.ts';
import { Atlas, normalScaleFor } from './atlas.ts';
import type { Painted } from './draw.ts';
import { ARROW, ARROW_ADVANCE, advance, checkText, context, paintPhone } from './draw.ts';
import { loadFonts } from './fonts.ts';
import type { FaceRole } from './fonts.ts';
import type { Plan, PlanOptions, Register } from './layout.ts';
import { TAPES, labelKey, planPaper, planPhone, planPlate, planSign, planStencil, planTape, textureBytes } from './layout.ts';
import type { JobRegister, PaintJob } from './paint.ts';
import { paintJob } from './paint.ts';
import { Pool } from './pool.ts';
import { halve, toTextureRows } from './raster.ts';
import type { Rng } from './rng.ts';
import { rng } from './rng.ts';

export { CONTENT_IDS, contentById, world } from './content.ts';
export type { PhoneMessage, PlanOptions, Register, TapeColour } from './layout.ts';
export { REGISTERS, capPx, minCapHeight, DEFAULT_VIEW } from './layout.ts';
export type { AtlasInfo } from './atlas.ts';
export { labelAtlasOf } from './atlas.ts';

/**
 * Main-thread time this module spends making labels (planning, painting,
 * placing on the atlas), summed over the session; `workerMs` is painting
 * time spent in workers (off the main thread). Also published as
 * `globalThis.__labelStats` for scripts (loadtime, perf, the T1 measurements).
 */
export const labelStats = {
  ms: 0,
  count: 0,
  inWorkers: 0,
  workerMs: 0,
  byRegister: {} as Record<string, { ms: number; count: number }>,
  /** performance.now() when the last start-up label landed (ready). */
  readyAt: 0,
};
(globalThis as { __labelStats?: typeof labelStats }).__labelStats = labelStats;

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const charge = (register: string, dt: number): void => {
  labelStats.ms += dt;
  const b = (labelStats.byRegister[register] ??= { ms: 0, count: 0 });
  b.ms += dt;
};

export interface LabelsOptions {
  /** Max anisotropy to use (pass renderer.capabilities.getMaxAnisotropy()). Default 8. */
  anisotropy?: number;
  /** Where the font files are served. Default `/fonts/`. */
  fontBase?: string;
  /** Changes every label's seeded imperfection at once. Default 'labels'. */
  seed?: string;
  /**
   * Paint start-up labels in workers (true: up to 4; a number: that many) until `ready()`
   * resolves. Default false (everything painted here, synchronously). `?labelWorkers=0|N`
   * on the page overrides it (A/B).
   */
  workers?: boolean | number;
  /** Put labels on shared atlas pages (default true; `?labelAtlas=0` turns it off for A/B). */
  atlas?: boolean;
}

/** The labels' options: the contract's, plus the texel density (first-class here; see the hand-in for the contract change). */
export type LabelOpts = LabelOptions & PlanOptions;

export interface LabelEntry {
  key: string;
  register: Register | 'region';
  text: string;
  size: { w: number; h: number };
  capHeight: number;
  px: { w: number; h: number };
  map: Texture;
  normal: Texture | null;
  rough: Texture | null;
  transparent: boolean;
  /** GPU bytes of its own textures (0 on the atlas: the pages are counted once, in memory()). */
  bytes: number;
  /** Where it sits on the atlas, or null (a texture of its own). */
  atlas: AtlasInfo | null;
}

/** A region that is redrawn at run time (`labels.region`). */
export interface LabelRegion {
  /** The texture key: use it as any label key (texturedPart, materials.textured). */
  readonly key: string;
  /** Its size in texels and in world units. */
  readonly px: { w: number; h: number };
  readonly size: { w: number; h: number };
  /**
   * Repaint: `paint` draws on a cleared 2D canvas of the region's size (origin top left,
   * as any canvas); the region's rows go up at the next draw, nothing else of the page.
   */
  draw(paint: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => void): void;
  /** Write rows [top, top + n) from RGBA bytes, rows top-down, `px.w` wide (a band redrawn by hand). */
  put(rows: Uint8Array | Uint8ClampedArray, top?: number, n?: number): void;
}

export interface RegionOptions {
  /** Texels per world unit (default 320, the cards'). */
  texelsPerUnit?: number;
  /** How its alpha is used: 'opaque' (default), 'cut' (alphaTest), 'spray' (blended, as a stencil). */
  alpha?: Alpha;
}

/** The concrete labels: the `Labels` contract plus inspection for dev pages and budgets. */
export interface WorkshopLabels extends Labels {
  tape(text: string, colour?: 'black' | 'red' | 'blue', opts?: LabelOpts): string;
  stencil(text: string, opts?: LabelOpts & { paint?: import('../palette.ts').Token }): string;
  card(text: string, opts?: LabelOpts): string;
  slip(text: string, opts?: LabelOpts): string;
  plate(text: string, opts?: LabelOpts): string;
  sign(text: string, opts?: LabelOpts): string;
  entry(key: string): LabelEntry;
  /** A region redrawn at run time (see the header). The same name returns the same region. */
  region(name: string, size: { w: number; h: number }, opts?: RegionOptions): LabelRegion;
  /** Resolves when every label asked for so far has its pixels (immediately without workers). */
  ready(): Promise<void>;
  /** Every label made so far, and the GPU memory their textures take (RGBA8 + mips; atlas pages counted whole). */
  memory(): { labels: number; textures: number; bytes: number; pages: number; pageBytes: number };
  entries(): readonly LabelEntry[];
  dispose(): void;
}

/** Which page and alpha each register goes to (null: a texture of its own). */
const PLACE: Record<Register, { page: PageKind | null; alpha: Alpha }> = {
  tape: { page: 'relief', alpha: 'cut' },
  plate: { page: 'relief', alpha: 'opaque' },
  sign: { page: 'relief', alpha: 'opaque' },
  stencil: { page: 'flat', alpha: 'spray' },
  card: { page: 'flat', alpha: 'opaque' },
  slip: { page: 'flat', alpha: 'cut' },
  phone: { page: null, alpha: 'opaque' },
};

function upload(data: Uint8Array, w: number, h: number, colour: boolean, anisotropy: number): DataTexture {
  const t = new DataTexture(toTextureRows(data, w, h), w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}

const query = (): URLSearchParams => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '');

/** Load the fonts (rejects loudly if any is missing), then return the label factory. */
export async function createLabels(opts: LabelsOptions = {}): Promise<WorkshopLabels> {
  await loadFonts(opts.fontBase);
  const anisotropy = opts.anisotropy ?? 8;
  const seed = opts.seed ?? 'labels';
  const q = query();
  const useAtlas = q.get('labelAtlas') === '0' ? false : (opts.atlas ?? true);
  const wq = q.get('labelWorkers');
  const want = wq !== null ? Number(wq) : opts.workers === true ? 4 : opts.workers || 0;
  const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 2;
  const nWorkers = typeof Worker !== 'undefined' && want > 0 ? Math.max(1, Math.min(want, cores - 1)) : 0;
  let pool: Pool | null = nWorkers > 0 ? new Pool(nWorkers, opts.fontBase ?? '/fonts/') : null;
  const pending = new Set<Promise<void>>();

  const made = new Map<string, LabelEntry>();
  const own = new Set<Texture>();
  const atlas = new Atlas(anisotropy);
  const regions = new Map<string, LabelRegion>();

  const advFor = new Map<FaceRole, ReturnType<typeof advance>>();
  const adv = (role: FaceRole): ReturnType<typeof advance> => {
    let a = advFor.get(role);
    if (!a) {
      const base = advance(role);
      a = role === 'stencil' ? (ch, next) => (ch === ARROW ? ARROW_ADVANCE : base(ch, next === ARROW ? undefined : next)) : base;
      advFor.set(role, a);
    }
    return a;
  };
  const r = (key: string): Rng & { state: () => number } => rng(`${seed}|${key}`);

  /** A label with a texture of its own (the phone, explicit densities, the atlas turned off). */
  const standalone = (key: string, register: Register, text: string, plan: Plan, painted: Painted): LabelEntry => {
    const map = upload(painted.color, painted.w, painted.h, true, anisotropy);
    const normal = painted.normal ? upload(painted.normal, painted.w, painted.h, false, anisotropy) : null;
    // Roughness varies slowly and the eye forgives it: half resolution, a quarter of the memory.
    const half = painted.rough ? halve(painted.rough, painted.w, painted.h) : null;
    const rough = half ? upload(half.data, half.w, half.h, false, anisotropy) : null;
    for (const t of [map, normal, rough]) if (t) own.add(t);
    const per = textureBytes(painted.w, painted.h);
    return {
      key,
      register,
      text,
      size: { ...plan.world },
      capHeight: plan.capWorld,
      px: { ...plan.px },
      map,
      normal,
      rough,
      transparent: painted.alpha,
      bytes: per * (1 + (normal ? 1 : 0)) + (half ? textureBytes(half.w, half.h) : 0),
      atlas: null,
    };
  };

  /** Views of a region, tagged so realize can find the page. */
  const tag = (page: Page, rect: Rect, alpha: Alpha): { map: Texture; normal: Texture | null; rough: Texture | null; atlas: AtlasInfo } => {
    const v = page.views(rect);
    const info = page.info(rect, alpha);
    v.map.userData['labelAtlas'] = info;
    return { ...v, atlas: info };
  };

  /**
   * Make a label: plan it here (its size is known at once), then paint it here or in a
   * worker, onto the atlas or onto a texture of its own.
   */
  const make = (key: string, register: JobRegister, text: string, o: LabelOpts | undefined, planOf: (rr: Rng) => Plan, job: Pick<PaintJob, 'colour' | 'paint'>): string => {
    if (made.has(key)) return key;
    const t0 = clock();
    const rr = r(key);
    const plan = planOf(rr);
    const where = PLACE[register];
    // an explicit density keeps a texture of its own: the storefront writes its own pixels into one
    const placed = useAtlas && where.page && o?.texelsPerUnit === undefined ? atlas.place(where.page, plan.px.w, plan.px.h) : null;
    const ns = placed && where.page === 'relief' ? normalScaleFor(plan.px.w, plan.px.h, placed.page) : undefined;
    const j: PaintJob = { register, plan, rng: rr.state(), ...job, ...(ns ? { ns } : {}) };
    if (!placed) {
      made.set(key, standalone(key, register, text, plan, paintJob(j)));
    } else {
      const { page, rect } = placed;
      const v = tag(page, rect, where.alpha);
      made.set(key, {
        key,
        register,
        text,
        size: { ...plan.world },
        capHeight: plan.capWorld,
        px: { ...plan.px },
        map: v.map,
        normal: v.normal,
        rough: v.rough,
        transparent: where.alpha !== 'opaque',
        bytes: 0,
        atlas: v.atlas,
      });
      const land = (p: Painted): void => {
        const tl = clock();
        page.write(rect, p.color, p.normal, p.rough);
        charge(register, clock() - tl);
      };
      if (pool) {
        labelStats.inWorkers++;
        const tw = clock();
        const done = pool
          .paint(j)
          .then(
            (p) => {
              labelStats.workerMs += clock() - tw;
              land(p);
            },
            () => {
              // no worker, or it failed: paint it here, exactly as it would have been
              const tm = clock();
              const p = paintJob(j);
              charge(register, clock() - tm);
              land(p);
            },
          )
          .finally(() => pending.delete(done));
        pending.add(done);
      } else land(paintJob(j));
    }
    labelStats.count++;
    const b = (labelStats.byRegister[register] ??= { ms: 0, count: 0 });
    b.count++;
    charge(register, clock() - t0);
    return key;
  };

  const get = (key: string): LabelEntry => {
    const e = made.get(key);
    if (e) return e;
    const p = atlas.byKey(key);
    if (p) {
      // a page's whole views (realize's merged meshes): no transform, uv channel 1
      const v = p.page.wholeViews();
      return {
        key,
        register: 'region',
        text: '',
        size: { w: 1, h: 1 },
        capHeight: 1,
        px: { w: p.page.w, h: p.page.h },
        map: v.map,
        normal: v.normal,
        rough: v.rough,
        transparent: p.alpha !== 'opaque',
        bytes: 0,
        atlas: null,
      };
    }
    throw new Error(`labels: no label with key ${JSON.stringify(key)}; make it first`);
  };

  const labels: WorkshopLabels = {
    tape(text, colour = TAPES[0], o) {
      const key = labelKey('tape', text, colour, o);
      return make(key, 'tape', text, o, (rr) => {
        const t = text.toUpperCase();
        checkText('tape', t);
        return planTape(t, adv('tape'), rr, o);
      }, { colour });
    },
    stencil(text, o) {
      const paint = o?.paint ?? 'ink';
      const key = labelKey('stencil', text, paint, o);
      return make(key, 'stencil', text, o, (rr) => {
        const t = text.toUpperCase();
        checkText('stencil', t.split(ARROW).join(''));
        return planStencil(t, adv('stencil'), rr, o);
      }, { paint });
    },
    card(text, o) {
      const key = labelKey('card', text, '', o);
      return make(key, 'card', text, o, (rr) => {
        checkText('type', text);
        return planPaper('card', text, adv('type'), rr, o);
      }, {});
    },
    slip(text, o) {
      const key = labelKey('slip', text, '', o);
      return make(key, 'slip', text, o, (rr) => {
        checkText('type', text);
        return planPaper('slip', text, adv('type'), rr, o);
      }, {});
    },
    plate(text, o) {
      const key = labelKey('plate', text, '', o);
      return make(key, 'plate', text, o, (rr) => {
        const t = text.toUpperCase();
        checkText('tape', t);
        return planPlate(t, adv('tape'), rr, o);
      }, {});
    },
    sign(text, o) {
      const key = labelKey('sign', text, '', o);
      return make(key, 'sign', text, o, (rr) => {
        const t = text.toUpperCase();
        checkText('sign', t);
        return planSign(t, adv('sign'), rr, o);
      }, {});
    },
    phone(messages, o) {
      const text = messages.map((m) => `${m.from}:${m.text}`).join('\n');
      const key = labelKey('phone', text, '', o);
      if (made.has(key)) return key;
      const t0 = clock();
      const rr = r(key);
      const plan = planPhone(o);
      made.set(key, standalone(key, 'phone', text, plan, paintPhone(plan, messages, rr)));
      labelStats.count++;
      (labelStats.byRegister['phone'] ??= { ms: 0, count: 0 }).count++;
      charge('phone', clock() - t0);
      return key;
    },
    region(name, size, o = {}) {
      const alpha = o.alpha ?? 'opaque';
      const key = alpha === 'spray' ? `stencil:region|${name}` : alpha === 'cut' ? `region:cut|${name}` : `region|${name}`;
      const had = regions.get(key);
      if (had) return had;
      const tpu = o.texelsPerUnit ?? 320;
      const px = { w: Math.max(4, Math.round(size.w * tpu)), h: Math.max(4, Math.round(size.h * tpu)) };
      const world = { w: px.w / tpu, h: px.h / tpu };
      const placed = (useAtlas ? atlas.place('flat', px.w, px.h) : null) ?? atlas.dedicated(px.w, px.h);
      const { page, rect } = placed;
      const v = tag(page, rect, alpha);
      made.set(key, { key, register: 'region', text: name, size: world, capHeight: world.h, px, map: v.map, normal: null, rough: null, transparent: alpha !== 'opaque', bytes: 0, atlas: v.atlas });
      let ctx: ReturnType<typeof context> | null = null;
      const region: LabelRegion = {
        key,
        px,
        size: world,
        draw(paint) {
          const t0 = clock();
          ctx ??= context(px.w, px.h);
          ctx.clearRect(0, 0, px.w, px.h);
          ctx.save();
          paint(ctx, px.w, px.h);
          ctx.restore();
          const img = ctx.getImageData(0, 0, px.w, px.h).data;
          page.writeRows(rect, 0, new Uint8Array(img.buffer, img.byteOffset, img.byteLength), px.h);
          charge('region', clock() - t0);
        },
        put(rows, top = 0, n = px.h - top) {
          const t0 = clock();
          if (top < 0 || n < 0 || top + n > px.h || rows.length < n * px.w * 4) throw new Error(`labels: region ${name}: rows ${top}..${top + n} do not fit ${px.w}x${px.h}`);
          page.writeRows(rect, top, rows instanceof Uint8Array ? rows : new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength), n);
          charge('region', clock() - t0);
        },
      };
      regions.set(key, region);
      return region;
    },
    ready() {
      if (!pending.size) {
        closeWindow();
        return Promise.resolve();
      }
      return Promise.all([...pending]).then(() => labels.ready());
    },
    size: (key) => ({ ...get(key).size }),
    texture: (key) => get(key).map,
    normalMap: (key) => get(key).normal,
    roughnessMap: (key) => get(key).rough,
    transparent: (key) => get(key).transparent,
    capHeight: (key) => get(key).capHeight,
    entry: get,
    entries: () => [...made.values()],
    memory() {
      let bytes = 0;
      for (const e of made.values()) bytes += e.bytes;
      const pageBytes = atlas.bytes();
      const textures = own.size + atlas.pages.reduce((s, p) => s + p.maps().length, 0);
      return { labels: made.size, textures, bytes: bytes + pageBytes, pages: atlas.pages.length, pageBytes };
    },
    dispose() {
      pool?.dispose();
      pool = null;
      for (const t of own) t.dispose();
      own.clear();
      atlas.dispose();
      made.clear();
      regions.clear();
    },
  };
  /** Start-up is over: from now on labels are painted here, and the workers go. */
  function closeWindow(): void {
    if (!pool) return;
    pool.dispose();
    pool = null;
    labelStats.readyAt = clock();
  }
  return labels;
}
