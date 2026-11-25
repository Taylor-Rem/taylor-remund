// capture-pitch: the pictures of brief C1 (Pitch's look sketch), many frames in ONE browser on the
// real GPU (system Chrome, the GPU flags), so a whole set is one short hold of the browser lock.
//
//   flock …/browser.lock node scripts/capture-pitch.ts <origin> <set> [--only name,name]
//     <origin>  a running dev server, e.g. http://localhost:4355
//     <set>     a JSON file: [{ "name": "a-front", "q": "take=A&yaw=-35", "w": 900, "h": 900, "dpr": 1 }, …]
//               optional per shot: "record": seconds (a film instead of a still; "fps", default 30)
// Pictures land in shots/c1/<name>.png (or .mp4). Prints the renderer, and a line per frame.
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { GPU_ARGS, isSoftware, record, type Session } from './capture.ts';

interface Shot {
  name: string;
  q: string;
  w?: number;
  h?: number;
  dpr?: number;
  record?: number;
  fps?: number;
  mobile?: boolean;
}

const [origin, setFile, ...rest] = process.argv.slice(2);
if (!origin || !setFile) {
  console.error('usage: node scripts/capture-pitch.ts <origin> <set.json> [--only a,b]');
  process.exit(2);
}
const onlyAt = rest.indexOf('--only');
const only = onlyAt >= 0 ? new Set((rest[onlyAt + 1] ?? '').split(',')) : null;
const shots = (JSON.parse(readFileSync(setFile, 'utf8')) as Shot[]).filter((s) => !only || only.has(s.name));
const outDir = resolve('shots/c1');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
let failed = 0;
try {
  for (const s of shots) {
    const w = s.w ?? 1200, h = s.h ?? 900, dpr = s.dpr ?? 1;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: !!s.mobile, hasTouch: !!s.mobile });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
    });
    try {
      await page.goto(`${origin}/dev/pitch/?hud=0&${s.q}`, { waitUntil: 'load', timeout: 90_000 });
      // ready, or give up at once on a page error
      for (let t = 0; ; t += 250) {
        if (await page.evaluate('window.__ready === true')) break;
        if (errors.length) throw new Error('page error');
        if (t > 90_000) throw new Error('not ready in 90 s');
        await page.waitForTimeout(250);
      }
      const renderer = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const e = c?.getExtension('WEBGL_debug_renderer_info');
        return c && e ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      });
      if (isSoftware(renderer)) throw new Error(`software renderer (${renderer})`);
      await page.waitForTimeout(400);
      if (s.record) {
        const session = { browser, context, page, renderer, errors, close: async () => {} } as Session;
        const out = resolve(outDir, `${s.name}.mp4`);
        await record(session, s.record, out, { fps: s.fps ?? 30, w, h, dpr });
        console.log(`film ${out}`);
      } else {
        const out = resolve(outDir, `${s.name}.png`);
        await page.screenshot({ path: out });
        console.log(`still ${out} ${w}x${h}@${dpr}${errors.length ? `  ERRORS: ${errors.join(' | ').slice(0, 300)}` : ''}`);
      }
      if (errors.length) failed++;
    } catch (e) {
      failed++;
      console.log(`FAILED ${s.name}: ${(e as Error).message.slice(0, 300)} ${errors.join(' | ').slice(0, 400)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`done ${shots.length - failed}/${shots.length}`);
process.exit(failed ? 1 : 0);
