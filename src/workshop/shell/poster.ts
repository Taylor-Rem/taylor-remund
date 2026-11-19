/**
 * The still picture (REWRITE.md § B3 "before JavaScript", § E6): which
 * picture a screen gets, and the live camera that sees exactly that picture.
 *
 * The problem. The stage frames by aspect ratio (the camera rig fits the
 * scene's home box at a fixed field of view and pitch, so its distance, and
 * on a phone even the box, change with the shape of the screen); a picture
 * does not. The answer has two halves:
 *
 *  1. Art direction by bands. The scene names aspect bands; each band has a
 *     picture rendered at the band's WIDEST aspect, by the real stage, from
 *     the camera the scene's own framing chooses there. HTML picks the band
 *     with `<source media="(min-aspect-ratio: …)">` (widest band first), and
 *     CSS shows it with `object-fit: cover` centred. A screen narrower than
 *     the picture's aspect therefore sees the picture's full height and a
 *     centred horizontal crop of it.
 *  2. The live stage adopts the picture's camera. A centred horizontal crop
 *     of a pinhole picture is exactly what the same camera (same position,
 *     same vertical field of view) sees at the narrower aspect. So the stage
 *     starts at the picture's focus and distance, and its first frame is the
 *     picture, pixel for pixel up to resampling. No 2D fit can do that across
 *     aspects: the parallax between near and far differs with distance.
 *
 * Within a band the starting view is a little closer than the screen's own
 * home (the rig's home at the narrower aspect would stand further back); the
 * bands are chosen so that difference stays inside the rig's margin, and the
 * first "back" or resize goes home. A screen wider than the widest picture
 * would need a vertical crop the rig cannot express: give the widest band a
 * wide enough picture (the vignette's is 2.4:1).
 *
 * Pure: no DOM, no three. Runs in Node (tests, scripts/poster.ts).
 */

export type Vec3 = readonly [number, number, number];

/** A camera rig view, as the rig itself holds it. */
export interface PosterView {
  focus: Vec3;
  /** Distance from the focus along the rig's fixed view direction. */
  distance: number;
}

/** One aspect band and its picture. */
export interface PosterBand {
  /** Screens with width/height at least this (and below the next wider band) get this picture. */
  minAspect: number;
  /** The aspect the picture is rendered at: the band's widest (the next band's minAspect, a hair under). */
  aspect: number;
  /** Rendered height in pixels at 1x. */
  height: number;
  /** Pixel densities rendered (1 always; 2 for phones). */
  densities: number[];
}

export interface PosterFile {
  /** File name in the posters folder. */
  file: string;
  width: number;
  height: number;
  density: number;
  type: 'image/avif' | 'image/webp' | 'image/jpeg';
  bytes: number;
}

export interface PosterEntry extends PosterBand {
  /** The camera the picture was rendered from (the rig's view after the scene's framing at `aspect`). */
  view: PosterView | null;
  files: PosterFile[];
}

export interface PosterSet {
  /** What scene and page this is (free text). */
  scene: string;
  /** The world is stepped this many fixed steps, then rendered `settle` more frames, before the picture is taken. */
  step: number;
  settle: number;
  /** The narrowest screen considered (the first band starts at 0; its picture's camera is made valid down to this). */
  narrowest: number;
  /** Hash of everything that can change the picture (scripts/poster.ts); empty until rendered. */
  hash: string;
  /** The WebGL renderer and the date it was rendered with (provenance). */
  renderer: string;
  rendered: string;
  /** Widest band first is not required: they are sorted where it matters. */
  posters: PosterEntry[];
  /** The plain-<img> picture for browsers that take no <source>: a file name from one entry. */
  fallback: string;
}

/** Bands sorted widest first (the order `<source>` elements must have). */
export function widestFirst<T extends { minAspect: number }>(bands: readonly T[]): T[] {
  return [...bands].sort((a, b) => b.minAspect - a.minAspect);
}

/** The band a screen of this aspect gets: the widest band whose minAspect it reaches, else the narrowest. */
export function bandFor<T extends { minAspect: number }>(bands: readonly T[], aspect: number): T | null {
  const sorted = widestFirst(bands);
  for (const b of sorted) if (aspect >= b.minAspect) return b;
  return sorted[sorted.length - 1] ?? null;
}

/** A CSS media query for "aspect at least a", as an integer ratio (media queries take ratios). */
export function minAspectQuery(a: number): string {
  const den = 1000;
  return `(min-aspect-ratio: ${Math.round(a * den)}/${den})`;
}

/**
 * `sizes` for a covered picture of aspect `a` in a full-viewport box: it is
 * drawn at the viewport's height, so its width is a × 100vh, or the
 * viewport's width when the screen is wider than the picture.
 */
export function coverSizes(a: number): string {
  return `max(100vw, ${(a * 100).toFixed(1)}vh)`;
}

export interface SourceSpec {
  media: string | null;
  type: PosterFile['type'];
  srcset: string;
  sizes: string;
}

/**
 * The `<source>` elements for a `<picture>`, widest band first: for each band
 * and each file type, one source with every density. `url(file)` maps a file
 * name to where it is served.
 */
export function pictureSources(set: PosterSet, url: (file: string) => string): SourceSpec[] {
  const out: SourceSpec[] = [];
  const bands = widestFirst(set.posters);
  bands.forEach((b, i) => {
    const media = i === bands.length - 1 ? null : minAspectQuery(b.minAspect);
    const types = [...new Set(b.files.map((f) => f.type))];
    for (const type of types) {
      const files = b.files.filter((f) => f.type === type).sort((p, q) => p.width - q.width);
      out.push({ media, type, srcset: files.map((f) => `${url(f.file)} ${f.width}w`).join(', '), sizes: coverSizes(b.aspect) });
    }
  });
  return out;
}

/** The entry a picture file belongs to (from `img.currentSrc`, which ends with the served name). */
export function entryForUrl(set: PosterSet, src: string, url: (file: string) => string): PosterEntry | null {
  if (!src) return null;
  const clean = src.split(/[?#]/)[0]!;
  for (const e of set.posters) for (const f of e.files) if (clean.endsWith(url(f.file).split(/[?#]/)[0]!)) return e;
  return null;
}

/**
 * Where the picture's content sits on a screen of this size under
 * `object-fit: cover` centred: the scale and the offset of its top-left.
 * Used by tests and by the proof to reason about the crop.
 */
export function coverRect(pictureAspect: number, w: number, h: number): { scale: number; x: number; y: number; width: number; height: number } {
  const screen = w / h;
  if (screen <= pictureAspect) {
    const height = h;
    const width = h * pictureAspect;
    return { scale: height, x: (w - width) / 2, y: 0, width, height };
  }
  const width = w;
  const height = w / pictureAspect;
  return { scale: height, x: 0, y: (h - height) / 2, width, height };
}

/** True when the cover crop is horizontal only (the case the live camera reproduces exactly). */
export function cropIsExact(pictureAspect: number, screenAspect: number): boolean {
  return screenAspect <= pictureAspect + 1e-6;
}

/**
 * Bands for a scene whose framing is constant above `wideFrom` (the rig fits
 * by height there) and changes below it: geometric steps of at most `ratio`
 * in aspect, from `narrowest` up, split at aspect 1 (portrait and landscape
 * framings differ) and at every other aspect in `breaks` where the scene's
 * own framing switches (a band never straddles a switch; the band below one
 * is rendered a hair under it), and one band from `wideFrom` up rendered at
 * `widest`.
 */
export function makeBands(o: { narrowest: number; wideFrom: number; widest: number; ratio: number; breaks?: number[]; height: { portrait: number; landscape: number }; densities: { portrait: number[]; landscape: number[] } }): PosterBand[] {
  const bands: PosterBand[] = [];
  const split = (lo: number, hi: number): number[] => {
    const n = Math.max(1, Math.ceil(Math.log(hi / lo) / Math.log(o.ratio)));
    return Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / n));
  };
  const add = (lo: number, hi: number, portrait: boolean, hiIsBreak: boolean): void => {
    const starts = split(lo, hi);
    starts.forEach((s, i) => {
      const last = i + 1 >= starts.length;
      const top = last ? hi : starts[i + 1]!;
      bands.push({
        minAspect: round3(s),
        aspect: round3(last && hiIsBreak ? top - 0.001 : top),
        height: portrait ? o.height.portrait : o.height.landscape,
        densities: portrait ? o.densities.portrait : o.densities.landscape,
      });
    });
  };
  const cuts = [...new Set([1, ...(o.breaks ?? [])])].filter((c) => c > o.narrowest && c <= o.wideFrom).sort((x, y) => x - y);
  let lo = o.narrowest;
  for (const c of cuts) {
    add(lo, c, c <= 1, true);
    lo = c === 1 ? 1 : c + 0.001;
  }
  if (lo < o.wideFrom - 1e-9) add(lo, o.wideFrom, false, false);
  bands.push({ minAspect: round3(o.wideFrom), aspect: o.widest, height: o.height.landscape, densities: o.densities.landscape });
  bands[0]!.minAspect = 0;
  return bands;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The rendered pixel size of a band at a density. */
export function pixelSize(b: PosterBand, density = 1): { width: number; height: number } {
  return { width: Math.round(b.height * b.aspect * density), height: Math.round(b.height * density) };
}

/**
 * Brightness of the dim picture for a load progress 0..1 (the lamp warming
 * up): starts at `from`, eases toward 1 so the last steps are gentle, and is
 * exactly 1 at 1 (so the picture the stage replaces is the picture as rendered).
 */
export function warmth(progress: number, from = 0.42): number {
  const p = Math.min(1, Math.max(0, progress));
  if (p >= 1) return 1;
  const e = 1 - Math.pow(1 - p, 1.6);
  return from + (1 - from) * e;
}
