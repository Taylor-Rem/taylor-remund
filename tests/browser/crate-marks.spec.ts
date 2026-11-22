import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 S5 round four: a crate's mark is one ink at every distance. Each stencil exists in two inks, `ink` (dark, on bare
// wood and light paint) and `paper` (light, on dark paint); the one not worn was only sunk behind the plank, and the
// sprayed decals' polygon offset pulled it back through at a distance (the home framing): the marks and words flipped
// light, or half and half, as the camera moved. Now it is also shrunk to a speck (view/kit/pieces/crate/paint.ts).
// Rendered on the real GPU, crate-3 and crate-2 at the home framing and at seven camera distances, each read by its
// pixels: the brightest of the mark's middle against the brightest of the bare front beside it. A light mark on bare
// wood fails; and on crate-3 painted paint-blue (through the line, as a visitor does it) a dark mark fails.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

let server: DevServer | null = null;
let origin = process.env.I1_ORIGIN ?? '';
test.beforeAll(async () => {
  if (!origin) {
    server = await startDevServer();
    origin = server.origin;
  }
});
test.afterAll(() => server?.stop());

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/dev/bench/?hud=0&names=0`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  await page.evaluate(() => (window as any).__workshop.loop.setManual(true));
}

type Read = { view: string; d: number; mark: number; beside: number; dark: number };

/** The crate's mark and the bare front beside it, by the pixels, at the home framing and seven distances. */
const readMarks = (page: Page, id: string): Promise<Read[]> =>
  page.evaluate((id) => {
    const ws = (window as any).__bench.ws, wd = ws.world, cam = ws.stage.camera;
    const V = cam.focus.constructor;
    const gl = ws.stage.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const cw = ws.stage.canvas.clientWidth, ch = ws.stage.canvas.clientHeight;
    const out: Read[] = [];
    const views: [string, () => void][] = [['home', () => cam.cutTo(cam.home())]];
    for (const z of [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1]) views.push([`zoom ${z}`, () => { const p = wd.motion(id).pose.p; cam.cutTo({ focus: [p[0], p[1], p[2]], zoom: z }); }]);
    for (const [view, go] of views) {
      go();
      ws.advance(2);
      const m = wd.motion(id), half = wd.halfExtents(id);
      const [qx, qy, qz, qw] = m.pose.q;
      const rot = (x: number, y: number, z: number): number[] => {
        const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
        return [ix * qw - iw * qx - iy * qz + iz * qy, iy * qw - iw * qy - iz * qx + ix * qz, iz * qw - iw * qz - ix * qy + iy * qx];
      };
      // read in the same task as the frame is drawn (the drawing buffer is not kept)
      ws.advance(0);
      const px = new Uint8Array(4);
      const lum = (u: number, v: number): number => {
        const o = rot(half[0] * u, half[1] * v, half[2] + 0.012);
        const s = cam.worldToScreen(new V(m.pose.p[0] + o[0], m.pose.p[1] + o[1], m.pose.p[2] + o[2]));
        gl.readPixels(Math.round(((s.x + 1) / 2) * W), Math.round(((s.y + 1) / 2) * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!;
      };
      const mark: number[] = [], beside: number[] = [];
      for (let j = 0; j <= 12; j++) {
        const v = -0.5 + (0.8 * j) / 12;
        for (let i = 0; i <= 8; i++) mark.push(lum(-0.3 + (0.6 * i) / 8, v));
        for (const u of [-0.62, -0.58, 0.58, 0.62]) beside.push(lum(u, v));
      }
      const q = (a: number[], f: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))]!;
      out.push({ view, d: +cam.distance.toFixed(1), mark: Math.round(q(mark, 0.95)), beside: Math.round(q(beside, 0.95)), dark: Math.round(q(mark, 0.05)) });
    }
    return out;
  }, id);

test('P4 S5 round four: a bare crate\'s mark is the dark ink at every distance (never light, never a flash on the way in)', async ({ page }) => {
  await open(page);
  for (const id of ['crate-3', 'crate-2']) {
    const reads = await readMarks(page, id);
    console.log(`[S5 marks] ${id}: ${JSON.stringify(reads)}`);
    for (const r of reads) {
      // a light stencil on bare wood is far brighter than the wood beside it; the dark ink is not
      expect(r.mark, `${id} at ${r.view} (${r.d} units): the mark's brightest ${r.mark} against the wood beside ${r.beside}`).toBeLessThan(r.beside * 1.25 + 8);
      // and the dark ink is there: the mark's darkest well under the wood
      expect(r.dark, `${id} at ${r.view}: the mark's darkest ${r.dark} against the wood beside ${r.beside}`).toBeLessThan(r.beside * 0.8);
    }
  }
});

test('P4 S5 round four: on a crate painted paint-blue the mark is the light ink at every distance', async ({ page }) => {
  await open(page);
  // crate-3 on the platen's tray, "Make it blue." down the line: Patch paints it, as a visitor has it done
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws, wd = ws.world;
    ws.dispatch({ type: 'grab', id: 'crate-3', grip: wd.motion('crate-3').pose.p });
    ws.advance(6);
    ws.dispatch({ type: 'place', at: 'platen' });
    ws.advance(120);
    // the cord into PLATEN's jack first (the line paints what the jack it is in names)
    ws.dispatch({ type: 'unplug', cord: 'cord' });
    ws.advance(10);
    ws.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-platen' });
    ws.advance(30);
    ws.dispatch({ type: 'text', text: 'Make it blue.' });
    for (let i = 0; i < 240 && wd.part('crate-3')?.colour !== 'paint-blue'; i++) ws.advance(30);
    for (let i = 0; i < 20; i++) ws.advance(30);
  });
  expect(await page.evaluate(() => (window as any).__bench.ws.world.part('crate-3')?.colour)).toBe('paint-blue');
  const reads = await readMarks(page, 'crate-3');
  console.log(`[S5 marks] crate-3 painted: ${JSON.stringify(reads)}`);
  for (const r of reads) expect(r.mark, `crate-3 painted, at ${r.view} (${r.d} units): the mark's brightest ${r.mark} against the paint beside ${r.beside}`).toBeGreaterThan(r.beside * 1.25 + 8);
});
