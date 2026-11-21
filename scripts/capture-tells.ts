// capture-tells: the bench's tells, seen (T1). For each station of the Button's ladder, force its tell on
// /dev/bench/ in system Chrome with the GPU and measure the station's lamp on screen: where it is, whether it is in
// the picture at all, how big its lit lens is (px across), and how much of the picture round it the blink changes.
// Writes the whole frame with the lamp lit and dark, a close crop of each (3× zoom), and a JSON report.
//
//   node scripts/capture-tells.ts --origin http://localhost:4347 --out shots/t1/after/wide [--w 1440 --h 900]
//        [--mobile] [--stations a,b] [--motion full|reduce] [--times 1|2] [--lamps before|after] [--query k=v]
//   node scripts/capture-tells.ts ... --frames N --every S --stations id    a sequence of whole frames from the tell
//
// Hold the browser lock around it (one short job): one viewport per run.
// --motion reduce (default) emulates prefers-reduced-motion, so the belt and the crew stand still.
// --times 2 tells each station twice (the second time round: the rattle).
// The lamp is found by node name under the station view's root (`--lamps after`: view/stations/tells.ts
// TELL_PARTS; `--lamps before`: what the bench drew before T1, a jack's lens for the cord, the line and the lamp).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openPage } from './capture.ts';

const ALL = ['undo-lever', 'striker', 'cord', 'belt', 'dock', 'chute', 'lamp', 'line', 'platen', 'storefront'];

/** Where each station's lamp is: [root, node] pairs; the first found that changes most is the lamp. */
const LAMPS: Record<'before' | 'after', Record<string, [string, string][]>> = {
  before: {
    'undo-lever': [['undo-station', 'lamp.lit']],
    striker: [['striker', 'lamp.lit']],
    cord: ['storefront', 'platen', 'belt', 'lamp'].map((j) => ['switchboard', `lamp.${j}.lit`] as [string, string]),
    belt: [['belt', 'lamp.lit']],
    dock: [['dock', 'lamp.lit']],
    chute: [],
    lamp: [['switchboard', 'lamp.lamp.lit']],
    line: ['storefront', 'platen', 'belt', 'lamp'].map((j) => ['switchboard', `lamp.${j}.lit`] as [string, string]),
    platen: [['platen', 'lamp.lit']],
    storefront: [['storefront', 'lamp.lit']],
  },
  after: {
    'undo-lever': [['undo-station', 'lamp.lit']],
    striker: [['striker', 'lamp.lit']],
    cord: [['switchboard', 'lamp.cord.lit']],
    belt: [['belt', 'lamp.lit']],
    dock: [['dock', 'lamp.lit']],
    chute: [['chute', 'lamp.lit']],
    lamp: [['lamp', 'pilot.lit']],
    line: [['phone', 'lamp.lit']],
    platen: [['platen', 'lamp.lit']],
    storefront: [['storefront', 'lamp.lit']],
  },
};

const { values: v } = parseArgs({
  options: {
    origin: { type: 'string', default: 'http://localhost:4347' },
    out: { type: 'string' },
    w: { type: 'string', default: '1440' },
    h: { type: 'string', default: '900' },
    mobile: { type: 'boolean' },
    stations: { type: 'string' },
    motion: { type: 'string', default: 'reduce' },
    times: { type: 'string', default: '1' },
    lamps: { type: 'string', default: 'after' },
    frames: { type: 'string' },
    every: { type: 'string', default: '6' },
    query: { type: 'string', default: '' },
    shot: { type: 'string' },
    pictures: { type: 'string', default: '1' },
    clip: { type: 'string' },
    skip: { type: 'string', default: '0' },
  },
});
if (!v.out) {
  console.error('capture-tells: --out <dir> is required');
  process.exit(2);
}
const out = resolve(v.out);
mkdirSync(out, { recursive: true });
const w = Number(v.w), h = Number(v.h);
const stations = v.stations ? v.stations.split(',') : ALL;
const lampsOf = LAMPS[v.lamps === 'before' ? 'before' : 'after'];

const s = await openPage(`${v.origin}/dev/bench/?manual=1&hud=0&names=0&preserve=1${v.query ? `&${v.query}` : ''}`, { w, h, mobile: !!v.mobile, readyTimeout: 90_000 });
console.log(`renderer: ${s.renderer}`);
if (/swiftshader|llvmpipe/i.test(s.renderer)) {
  console.error('software renderer: refused');
  await s.close();
  process.exit(1);
}
const page = s.page;
if (v.motion !== 'full') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
}

type Obj = { name: string; children: Obj[]; getObjectByName(n: string): Obj | undefined; updateWorldMatrix(a: boolean, b: boolean): void; matrixWorld: { elements: number[] } };
type B = {
  ws: {
    world: { step: number; interactable(id: string): { tell(): void } | undefined; machine(id: string): { lamp?: string } | undefined };
    advance(n: number): void;
    stage: { renderer: { getContext(): WebGL2RenderingContext }; scene: Obj; camera: { worldToScreen(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } } };
  };
  measure(): { scene: unknown; frame: unknown };
  shot(n: string): void;
};

await page.evaluate((shot) => {
  const b = (window as unknown as { __bench: B }).__bench;
  b.ws.advance(240);
  if (shot) b.shot(shot);
  b.ws.advance(0);
}, v.shot ?? null);

const stats = await page.evaluate(() => (window as unknown as { __bench: B }).__bench.measure());
writeFileSync(join(out, 'renderer-info.json'), JSON.stringify({ scene: stats.scene, frame: stats.frame }, null, 2));
console.log(`renderer.info: ${JSON.stringify(stats.scene)}`);

if (v.frames) {
  const id = stations[0]!;
  const n = Number(v.frames), every = Number(v.every);
  await page.evaluate(
    ({ id, times }) => {
      const b = (window as unknown as { __bench: B }).__bench;
      const w = b.ws.world as unknown as { step: number; tells(): { last: unknown } };
      b.ws.world.interactable(id)?.tell();
      if (times > 1) {
        // the second time round, as the scheduler would record it (a station's own tell() does not): the view
        // reads `tells().last`; only this page's world is patched, for this picture
        const real = w.tells.bind(w);
        const at = w.step;
        w.tells = () => ({ ...(real() as object), last: { id, step: at, times } });
      }
      b.ws.advance(1);
    },
    { id, times: Number(v.times) },
  );
  if (Number(v.skip) > 0) await page.evaluate((k) => (window as unknown as { __bench: B }).__bench.ws.advance(k), Number(v.skip));
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: join(out, `${id}-seq-${String(i).padStart(3, '0')}.png`), ...(v.clip ? { clip: (([x, y, cw, ch]) => ({ x: x!, y: y!, width: cw!, height: ch! }))(v.clip.split(',').map(Number)) } : {}) });
    await page.evaluate((k) => (window as unknown as { __bench: B }).__bench.ws.advance(k), every);
  }
  await s.close();
  process.exit(0);
}

interface Row {
  id: string;
  lamp: string | null;
  at: [number, number] | null;
  inView: boolean;
  litPx: number;
  across: number;
  changed: number;
  control: number;
  peak: number;
}
const rows: Row[] = [];

for (const id of stations) {
  const r = await page.evaluate(
    ({ id, cands, times }) => {
      const b = (window as unknown as { __bench: B }).__bench;
      const gl = b.ws.stage.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const dpr = W / innerWidth;
      const find = (root: string, node: string): Obj | null => {
        for (const c of b.ws.stage.scene.children) if (c.name === root) return c.getObjectByName(node) ?? null;
        return null;
      };
      const screen = (o: Obj): [number, number, boolean] => {
        o.updateWorldMatrix(true, false);
        const e = o.matrixWorld.elements;
        const p = b.ws.stage.camera.worldToScreen({ x: e[12]!, y: e[13]!, z: e[14]! });
        return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight, Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1];
      };
      const HALF = 40; // CSS px round the lamp
      const K = 14, gap = 12;
      const win = (cx: number, cy: number) => {
        const x0 = Math.max(0, Math.round((cx - HALF) * dpr)), y0 = Math.max(0, Math.round(H - (cy + HALF) * dpr));
        const ww = Math.max(0, Math.min(W - x0, Math.round(2 * HALF * dpr))), hh = Math.max(0, Math.min(H - y0, Math.round(2 * HALF * dpr)));
        return { x0, y0, ww, hh };
      };
      const sample = (boxes: { x0: number; y0: number; ww: number; hh: number }[]) => {
        const lo = boxes.map((q) => new Uint8Array(q.ww * q.hh).fill(255));
        const hi = boxes.map((q) => new Uint8Array(q.ww * q.hh));
        const sums: number[][] = boxes.map(() => []);
        const steps: number[] = [];
        for (let k = 0; k < K; k++) {
          b.ws.advance(gap);
          steps.push(b.ws.world.step);
          boxes.forEach((q, i) => {
            const a = new Uint8Array(q.ww * q.hh * 4);
            if (q.ww > 0 && q.hh > 0) gl.readPixels(q.x0, q.y0, q.ww, q.hh, gl.RGBA, gl.UNSIGNED_BYTE, a);
            let sum = 0;
            for (let j = 0; j < q.ww * q.hh; j++) {
              const y = Math.max(a[j * 4]!, a[j * 4 + 1]!, a[j * 4 + 2]!);
              sum += y;
              if (y < lo[i]![j]!) lo[i]![j] = y;
              if (y > hi[i]![j]!) hi[i]![j] = y;
            }
            sums[i]!.push(sum);
          });
        }
        return { lo, hi, sums, steps };
      };
      const found = cands.map(([root, node]) => ({ name: `${root}/${node}`, o: find(root, node) })).filter((c) => c.o) as { name: string; o: Obj }[];
      const pts = found.map((c) => screen(c.o));
      const boxes = pts.map(([x, y]) => win(x, y));
      const control = sample(boxes);
      for (let k = 0; k < times; k++) {
        b.ws.world.interactable(id)?.tell();
        if (k < times - 1) b.ws.advance(60 * 9);
      }
      const told = sample(boxes);
      const thr = 24;
      let best = { i: -1, changed: 0, control: 0, peak: 0, across: 0, onStep: 0, offStep: 0 };
      boxes.forEach((q, i) => {
        let n = 0, nc = 0, peak = 0, x0 = 1e9, x1 = -1;
        for (let j = 0; j < q.ww * q.hh; j++) {
          const d = told.hi[i]![j]! - told.lo[i]![j]!;
          const c = control.hi[i]![j]! - control.lo[i]![j]!;
          if (c > thr) nc++;
          if (d > thr && c <= thr) {
            n++;
            peak = Math.max(peak, d);
            const x = j % q.ww;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
          }
        }
        if (n > best.changed || best.i < 0) {
          const sm = told.sums[i]!;
          best = { i, changed: n, control: nc, peak, across: n ? (x1 - x0 + 1) / dpr : 0, onStep: told.steps[sm.indexOf(Math.max(...sm))]!, offStep: told.steps[sm.indexOf(Math.min(...sm))]! };
        }
      });
      const i = best.i;
      return {
        lamp: i >= 0 ? found[i]!.name : null,
        at: i >= 0 ? ([Math.round(pts[i]![0]), Math.round(pts[i]![1])] as [number, number]) : null,
        inView: i >= 0 ? pts[i]![2] : false,
        changed: Math.round(best.changed / (dpr * dpr)),
        control: Math.round(best.control / (dpr * dpr)),
        peak: best.peak,
        across: Math.round(best.across * 10) / 10,
        onStep: best.onStep,
        offStep: best.offStep,
        state: String(b.ws.world.machine(id)?.lamp ?? '-'),
      };
    },
    { id, cands: lampsOf[id] ?? [], times: Number(v.times) },
  );
  rows.push({ id, lamp: r.lamp, at: r.at, inView: r.inView, litPx: r.changed, across: r.across, changed: r.changed, control: r.control, peak: r.peak });
  console.log(`${id}: ${r.lamp ?? 'no lamp'} at ${r.at ? r.at.join(',') : '-'} ${r.inView ? 'in view' : 'OUT OF VIEW'}; blink changes ${r.changed} px (${r.across} px across, peak Δ ${r.peak}); noise ${r.control} px; sim lamp ${r.state}`);
  if (v.pictures !== '0') {
    const steps = r.at ? ([['on', r.onStep], ['off', r.offStep]] as const) : ([['on', 0]] as const);
    for (const [name, at] of steps) {
      // the same blink phase again a whole blink later: before T1 a blink was 1.4 s (1.2 s on the platen and the
      // storefront); after, 2 s everywhere
      await page.evaluate(
        ({ at, P, id }) => {
          const b = (window as unknown as { __bench: B }).__bench;
          b.ws.world.interactable(id)?.tell(); // still telling when the picture is taken
          let target = at;
          while (target <= b.ws.world.step) target += P;
          b.ws.advance(target - b.ws.world.step);
        },
        { at, id, P: v.lamps === 'before' ? (id === 'platen' || id === 'storefront' ? 72 : 84) : 120 },
      );
      await page.screenshot({ path: join(out, `${id}-${name}.png`) });
      if (r.at && r.inView) {
        const cw = 160, ch = 110;
        const x = Math.max(0, Math.min(w - cw, r.at[0] - cw / 2)), y = Math.max(0, Math.min(h - ch, r.at[1] - ch / 2));
        await page.screenshot({ path: join(out, `${id}-${name}-crop.png`), clip: { x, y, width: cw, height: ch }, scale: 'device' });
      }
    }
  }
  await page.evaluate(() => (window as unknown as { __bench: B }).__bench.ws.advance(60 * 9));
}
writeFileSync(join(out, 'tells.json'), JSON.stringify(rows, null, 2));
await s.close();
