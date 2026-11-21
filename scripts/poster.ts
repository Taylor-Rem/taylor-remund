// poster: the still pictures of a scene, rendered by the real stage on the
// real GPU from the very page that later boots the live scene (REWRITE.md
// § E6: "The still picture is rendered from the real scene by a script and
// committed; a check fails if the scene has changed since it was rendered").
//
//   node scripts/poster.ts                 render every band of the set (default: the handoff page's)
//   node scripts/poster.ts --check         exit 1 if anything that draws the picture changed since
//   node scripts/poster.ts --prove [--sizes 1440x900,1920x1080,1280x720,390x844,390x844@3]
//                                          the handoff, measured: the last frame of the picture and
//                                          the first of the stage at each size, and their difference
//        [--set src/dev-pages/handoff/posters.json] [--page /dev/handoff/] [--dist <built dir>]
//        [--out shots/b1/proof]
//
// The set (posters.json) names the aspect bands (shell/poster.ts). For each
// band and density the page is opened at the band's widest aspect with
// `?band=i`: the loader boots the scene, frames it with the scene's own
// framing, makes the view valid for the whole band (shell/loader.ts
// `bandView`), steps the world to the set's state and holds. The canvas is
// screenshotted and encoded as AVIF (and the widest band once as JPEG, the
// <img> fallback). The camera each picture was taken from is written into the
// set: the live stage adopts it.
//
// The pictures depend on the scene's code and content, so the check hashes
// those trees (sim, view, shell, content, fonts, the page and the set's
// bands): any change there asks for a new render. Better a false alarm than
// a picture that no longer matches the stage it hands over to.
//
// Exit codes: 0 ok, 1 failed or stale, 2 usage.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from '@playwright/test';
import { isMain, REPO_ROOT } from './lib/cli.ts';
import { PAPER_ONLY_CONTENT } from './lib/paper-content.ts';
import { ffmpegPath, GPU_ARGS, isSoftware } from './capture.ts';
import { buildWithDevPages, serveDist, tempBuildDir } from './loadtime.ts';
import type { PosterFile, PosterSet, PosterView } from '../src/workshop/shell/poster.ts';
import { pixelSize } from '../src/workshop/shell/poster.ts';

export const DEFAULT_SET = 'src/dev-pages/handoff/posters.json';
export const DEFAULT_PAGE = '/dev/handoff/';

/**
 * Every set of loading pictures, the page it is rendered from (a page with the poster hooks: `?band=`,
 * `window.__ready`), and the pages that show it. The bench's one set is rendered from `/dev/bench/` (the
 * home page carries no test hooks) and shown by `/` and `/dev/bench/` alike: same bench, same framing
 * (shell/bench-stage.ts). `--set` with one of these paths picks its page; `--page` overrides.
 */
export const SETS: readonly { set: string; page: string; shownOn: readonly string[] }[] = [
  { set: 'src/dev-pages/handoff/posters.json', page: '/dev/handoff/', shownOn: ['/dev/handoff/'] },
  { set: 'src/assets/bench/posters.json', page: '/dev/bench/', shownOn: ['/', '/dev/bench/'] },
];
/** What draws the picture: every file under these is hashed, but for the content only the paper pages read (PAPER_ONLY_CONTENT). */
export const INPUT_TREES = ['src/workshop/sim', 'src/workshop/view', 'src/workshop/shell', 'src/content', 'public/fonts'];

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** The hash of everything that can change the picture: the trees, the page, and the set's bands and state. */
export function inputsHash(root: string, set: PosterSet, page: string): string {
  const h = createHash('sha256');
  const files: string[] = [];
  for (const t of INPUT_TREES) walk(join(root, t), files);
  const paperOnly = new Set(PAPER_ONLY_CONTENT.map((f) => join(root, f)));
  const drawn = files.filter((f) => !paperOnly.has(f));
  drawn.push(join(root, page));
  for (const f of drawn.sort()) {
    h.update(relative(root, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  h.update(JSON.stringify({ step: set.step, settle: set.settle, narrowest: set.narrowest, bands: set.posters.map((p) => [p.minAspect, p.aspect, p.height, p.densities]) }));
  return h.digest('hex').slice(0, 20);
}

/** The page source behind a page path (/dev/handoff/ → src/dev-pages/handoff.astro; / → src/pages/index.astro). */
export function pageSource(path: string): string {
  if (path === '/' || path === '') return 'src/pages/index.astro';
  const stem = path.replace(/^\/dev\/?/, '').replace(/\/$/, '');
  return stem ? `src/dev-pages/${stem}.astro` : 'src/dev-pages/index.astro';
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.slice(-600)}`))));
  });
}

/** sRGB in, tagged as sRGB / BT.709 full range out, so the browser decodes the colours that went in. */
const TAGS = ['-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-colorspace', 'bt709', '-color_range', 'pc'];

export async function encodeAvif(png: string, out: string, crf = 30): Promise<void> {
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', png, '-vf', 'scale=out_color_matrix=bt709:out_range=full,format=yuv444p', ...TAGS, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(crf), '-cpu-used', '3', '-row-mt', '1', out]);
}

export async function encodeJpeg(png: string, out: string): Promise<void> {
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', png, '-q:v', '4', out]);
}

async function launch(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: true, args: [...GPU_ARGS, '--ignore-certificate-errors'] });
}

async function openAt(browser: Browser, url: string, w: number, h: number, dpr: number, mobile = false): Promise<{ page: Page; close(): Promise<void>; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
  return { page, errors, close: () => context.close() };
}

// ───────────────────────── render ─────────────────────────

async function render(set: PosterSet, setPath: string, origin: string, page: string): Promise<void> {
  const dir = dirname(setPath);
  const tmp = mkdtempSync(join(tmpdir(), 'poster-'));
  const browser = await launch();
  const keep = new Set<string>();
  try {
    for (let i = 0; i < set.posters.length; i++) {
      const band = set.posters[i]!;
      const files: PosterFile[] = [];
      let view: PosterView | null = null;
      for (const d of band.densities) {
        const css = pixelSize(band, 1);
        const s = await openAt(browser, `${origin}${page}?band=${i}`, css.width, css.height, d);
        try {
          if (s.errors.length) throw new Error(`band ${i}: ${s.errors[0]}`);
          const info = (await s.page.evaluate(() => {
            const h = (window as unknown as { __handoff: { framed: unknown; phase: string; failed: string | null } }).__handoff;
            const c = document.createElement('canvas').getContext('webgl2');
            const e = c?.getExtension('WEBGL_debug_renderer_info');
            return { framed: h.framed, phase: h.phase, failed: h.failed, renderer: c ? String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '') : '' };
          })) as { framed: PosterView; phase: string; failed: string | null; renderer: string };
          if (info.phase !== 'held-picture') throw new Error(`band ${i}: page is ${info.phase} (${info.failed ?? ''})`);
          if (isSoftware(info.renderer)) throw new Error(`refusing to render a picture on a software renderer (${info.renderer})`);
          set.renderer = info.renderer;
          view = { focus: info.framed.focus.map((v) => Math.round(v * 1e5) / 1e5) as unknown as PosterView['focus'], distance: Math.round(info.framed.distance * 1e5) / 1e5 };
          const png = join(tmp, `b${i}@${d}.png`);
          await s.page.screenshot({ path: png, type: 'png' });
          const name = `band${String(i).padStart(2, '0')}-${Math.round(band.aspect * 1000)}@${d}x.avif`;
          await encodeAvif(png, join(dir, name));
          keep.add(name);
          const px = pixelSize(band, d);
          files.push({ file: name, width: px.width, height: px.height, density: d, type: 'image/avif', bytes: statSync(join(dir, name)).size });
          if (i === set.posters.length - 1 && d === 1) {
            const jpg = `band${String(i).padStart(2, '0')}-${Math.round(band.aspect * 1000)}@1x.jpg`;
            await encodeJpeg(png, join(dir, jpg));
            keep.add(jpg);
            files.push({ file: jpg, width: px.width, height: px.height, density: 1, type: 'image/jpeg', bytes: statSync(join(dir, jpg)).size });
            set.fallback = jpg;
          }
          console.log(`band ${i} [${band.minAspect}, …) at ${band.aspect}: ${px.width}×${px.height} ${files.map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).slice(-1)[0]}  view ${JSON.stringify(view)}`);
        } finally {
          await s.close();
        }
      }
      band.view = view;
      // the fallback <img> is listed last for the widest band (it is not a <source>)
      band.files = files.filter((f) => f.type !== 'image/jpeg');
      const jpg = files.find((f) => f.type === 'image/jpeg');
      if (jpg) band.files.push(jpg);
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const f of readdirSync(dir)) if (/\.(avif|jpg|webp)$/.test(f) && !keep.has(f)) unlinkSync(join(dir, f));
  set.rendered = new Date().toISOString().slice(0, 10);
}

// ───────────────────────── prove ─────────────────────────

export interface DiffStats {
  width: number;
  height: number;
  mean: number;
  p99: number;
  max: number;
  over8: number;
  over24: number;
  /** The integer shift (dx, dy) that best aligns B to A: (0, 0) means nothing moved. */
  shift: [number, number];
  shiftGain: number;
}

/** In the page: difference of two PNGs (base64), an amplified difference picture, and the best alignment shift. */
async function diffInPage(page: Page, a: string, b: string, gain: number): Promise<{ stats: DiffStats; png: string }> {
  return page.evaluate(
    async ([a64, b64, k]) => {
      const load = async (s: string): Promise<ImageData> => {
        const blob = await (await fetch(`data:image/png;base64,${s}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const A = await load(a64 as string);
      const B = await load(b64 as string);
      const w = Math.min(A.width, B.width);
      const h = Math.min(A.height, B.height);
      const out = new ImageData(w, h);
      const hist = new Uint32Array(256);
      let sum = 0;
      let max = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * A.width + x) * 4;
          const j = (y * B.width + x) * 4;
          const d = Math.max(Math.abs(A.data[i]! - B.data[j]!), Math.abs(A.data[i + 1]! - B.data[j + 1]!), Math.abs(A.data[i + 2]! - B.data[j + 2]!));
          hist[d]!++;
          sum += d;
          if (d > max) max = d;
          const o = (y * w + x) * 4;
          const v = Math.min(255, d * (k as number));
          // dim copy of the picture underneath so the differences can be located
          const base = (A.data[i]! + A.data[i + 1]! + A.data[i + 2]!) / 3 / 6;
          out.data[o] = Math.min(255, base + v);
          out.data[o + 1] = Math.min(255, base + v * 0.35);
          out.data[o + 2] = base;
          out.data[o + 3] = 255;
        }
      const n = w * h;
      let acc = 0;
      let p99 = 0;
      for (let d = 0; d < 256; d++) {
        acc += hist[d]!;
        if (acc >= n * 0.99) {
          p99 = d;
          break;
        }
      }
      let over8 = 0;
      let over24 = 0;
      for (let d = 9; d < 256; d++) over8 += hist[d]!;
      for (let d = 25; d < 256; d++) over24 += hist[d]!;
      // alignment: mean |A - shift(B)| of luminance over the middle of the frame, shifts within ±4 px
      const lum = (D: ImageData, x: number, y: number): number => {
        const i = (y * D.width + x) * 4;
        return D.data[i]! * 0.3 + D.data[i + 1]! * 0.59 + D.data[i + 2]! * 0.11;
      };
      const R = 4;
      const step = Math.max(1, Math.floor(Math.min(w, h) / 400));
      let best: [number, number] = [0, 0];
      let bestE = Number.POSITIVE_INFINITY;
      let zeroE = 0;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          let e = 0;
          let m = 0;
          for (let y = R + Math.floor(h * 0.1); y < h - R - Math.floor(h * 0.1); y += step)
            for (let x = R + Math.floor(w * 0.1); x < w - R - Math.floor(w * 0.1); x += step) {
              e += Math.abs(lum(A, x, y) - lum(B, x + dx, y + dy));
              m++;
            }
          e /= m || 1;
          if (dx === 0 && dy === 0) zeroE = e;
          if (e < bestE - 1e-9) {
            bestE = e;
            best = [dx, dy];
          }
        }
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d')!.putImageData(out, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return {
        stats: { width: w, height: h, mean: sum / n, p99, max, over8: over8 / n, over24: over24 / n, shift: best, shiftGain: zeroE - bestE },
        png: btoa(bin),
      };
    },
    [a, b, gain] as const,
  );
}

export interface ProofRow {
  size: string;
  band: unknown;
  adoptError: number | null;
  picture: string;
  stage: string;
  diff: string;
  stats: DiffStats;
}

async function prove(origin: string, page: string, sizes: string[], out: string): Promise<ProofRow[]> {
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  const rows: ProofRow[] = [];
  try {
    for (const size of sizes) {
      const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(size);
      if (!m) throw new Error(`bad size ${size}`);
      const [w, h, dpr] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
      const mobile = w < h;
      const s = await openAt(browser, `${origin}${page}?hold=1`, w, h, dpr, mobile);
      try {
        if (s.errors.length) throw new Error(`${size}: ${s.errors[0]}`);
        const tag = size.replace('@', '-at');
        const pic = join(out, `${tag}-1-picture.png`);
        const stg = join(out, `${tag}-2-stage.png`);
        const dif = join(out, `${tag}-3-diff.png`);
        // the last frame of the picture: fully warm, the stage settled behind it
        await s.page.waitForTimeout(150);
        const a = await s.page.screenshot({ path: pic, type: 'png' });
        const info = await s.page.evaluate(() => {
          const h = (window as unknown as { __handoff: { band: unknown; adopted: { error: number } | null; release(): void } }).__handoff;
          const r = { band: h.band, adoptError: h.adopted ? h.adopted.error : null, src: (document.querySelector('img.poster') as HTMLImageElement | null)?.currentSrc ?? '' };
          h.release();
          return r;
        });
        await s.page.waitForFunction("window.__handoff.phase === 'held-stage'", null, { timeout: 10_000 });
        await s.page.waitForTimeout(50);
        // the first frame of the stage: the canvas over the picture, before the loop has run a step
        const b = await s.page.screenshot({ path: stg, type: 'png' });
        const { stats, png } = await diffInPage(s.page, a.toString('base64'), b.toString('base64'), 8);
        writeFileSync(dif, Buffer.from(png, 'base64'));
        await s.page.evaluate(() => (window as unknown as { __handoff: { release(): void } }).__handoff.release());
        rows.push({ size, band: info.band, adoptError: info.adoptError, picture: resolve(pic), stage: resolve(stg), diff: resolve(dif), stats });
        console.log(
          `${size.padEnd(11)} band ${JSON.stringify(info.band)} ${basename(info.src)}  adopt error ${info.adoptError === null ? '-' : info.adoptError.toFixed(4)}  ` +
            `|Δ| mean ${stats.mean.toFixed(2)}  p99 ${stats.p99}  max ${stats.max}  >8: ${(stats.over8 * 100).toFixed(2)}%  >24: ${(stats.over24 * 100).toFixed(3)}%  best shift ${JSON.stringify(stats.shift)} (gain ${stats.shiftGain.toFixed(3)})`,
        );
      } finally {
        await s.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, 'proof.json'), JSON.stringify(rows, null, 1));
  return rows;
}

// ───────────────────────── the command line ─────────────────────────

const USAGE = `usage: node scripts/poster.ts [--check | --prove [--sizes WxH[@dpr],…] [--out dir]] [--set ${DEFAULT_SET}] [--page ${DEFAULT_PAGE}] [--dist dir]`;

async function main(): Promise<number> {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({
      args: process.argv.slice(2),
      options: {
        check: { type: 'boolean' },
        prove: { type: 'boolean' },
        sizes: { type: 'string' },
        out: { type: 'string' },
        set: { type: 'string' },
        page: { type: 'string' },
        dist: { type: 'string' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch (e) {
    console.error(`poster: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (v['help']) {
    console.log(USAGE);
    return 0;
  }
  const setArg = String(v['set'] ?? DEFAULT_SET);
  const setPath = resolve(REPO_ROOT, setArg);
  const known = SETS.find((s) => resolve(REPO_ROOT, s.set) === setPath);
  const page = String(v['page'] ?? known?.page ?? DEFAULT_PAGE);
  const set = JSON.parse(readFileSync(setPath, 'utf8')) as PosterSet;
  const hash = inputsHash(REPO_ROOT, set, pageSource(page));

  if (v['check']) {
    const missing = set.posters.flatMap((p) => p.files).filter((f) => !existsSync(join(dirname(setPath), f.file)));
    const unrendered = set.posters.filter((p) => !p.view || p.files.length === 0);
    if (set.hash !== hash || missing.length || unrendered.length) {
      console.error(`poster: STALE ${relative(REPO_ROOT, setPath)}: ${set.hash !== hash ? `rendered from ${set.hash || 'nothing'}, the scene is now ${hash}` : ''}${missing.length ? ` missing ${missing.map((f) => f.file).join(', ')}` : ''}${unrendered.length ? ` ${unrendered.length} band(s) never rendered` : ''}. Re-render: node scripts/poster.ts`);
      return 1;
    }
    console.log(`poster: ok, ${set.posters.length} band(s) rendered ${set.rendered} from ${hash}`);
    return 0;
  }

  let built: string | null = null;
  let dist = v['dist'] ? resolve(String(v['dist'])) : null;
  if (!dist) {
    built = tempBuildDir('poster');
    console.log('building with the dev pages…');
    buildWithDevPages(built);
    dist = built;
  }
  const server = await serveDist(dist);
  try {
    if (v['prove']) {
      const sizes = String(v['sizes'] ?? '1440x900,1920x1080,1280x720,390x844,390x844@3').split(',');
      const out = resolve(REPO_ROOT, String(v['out'] ?? 'shots/b1/proof'));
      const rows = await prove(server.origin, page, sizes, out);
      console.log(`proof: ${out}`);
      return rows.every((r) => r.stats.shift[0] === 0 && r.stats.shift[1] === 0) ? 0 : 1;
    }
    await render(set, setPath, server.origin, page);
    set.hash = hash;
    writeFileSync(setPath, `${JSON.stringify(set, null, 2)}\n`);
    const total = set.posters.flatMap((p) => p.files).reduce((s, f) => s + f.bytes, 0);
    console.log(`poster: ${set.posters.length} band(s), ${(total / 1024).toFixed(0)} KB in all, hash ${hash}; now rebuild before measuring (the build carries the pictures)`);
    return 0;
  } finally {
    await server.stop();
    if (built) rmSync(built, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`poster: ${String(e instanceof Error ? e.stack : e)}`);
      process.exit(1);
    },
  );
}
