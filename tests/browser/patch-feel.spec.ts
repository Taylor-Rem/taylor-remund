import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// R5, the feel of throwing Patch (Taylor, 2026-11-20: "Eliminate unnatural discontinuities ... Add tests and
// measurements that catch the kinds of problems you've identified: unexpected velocity resets, visual snapping,
// unnatural pauses, and divergence between rendered and simulated motion. Account for legitimate collision impulses
// and intentionally exaggerated animation. We don't want tests that prevent us from making the workbench fun.").
//
// On /dev/bench/ on the real GPU, a scripted hand (CDP mouse events at 125 Hz, as a real mouse) takes Patch off its
// stool and throws it four ways: across the bench, straight up, up with some drift, and from the right toward the
// stool. Every RENDERED frame logs the drawn body bone's world matrix (the rig's `body` node: everything Patch is
// hangs from it) with the simulation's state, `at`, `prevAt` and the frame's alpha; every simulation step logs the
// simulation's own Patch. Then, with bounds that are each explained where they are set:
//   - after a release the drawn body moves in the first frame, and from then on stays near the simulation's middle;
//   - no frame in which the drawn body jumps or turns faster than a bound (outside `away` and the edge, jumps by design);
//   - the turn at the foot of the stool is the short way (at most half a turn, and a little);
//   - through a landing the roll never turns back by more than a few degrees;
//   - in the air the simulation never has a step without motion, and a throw with drift keeps drifting through its top.
// The measured values are printed (`[feel]` lines) so a change of feel shows up as numbers before it shows as a failure.
//
// Dev pages exist only in `astro dev`: this file starts its own server (or uses I1_ORIGIN while iterating).

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(8 * 60_000);

let server: DevServer | null = null;
let origin = process.env.I1_ORIGIN ?? '';
test.beforeAll(async () => {
  if (!origin) {
    server = await startDevServer();
    origin = server.origin;
  }
});
test.afterAll(() => server?.stop());

// ───────────────────────── the bounds (each with its reason; change one only for its reason) ─────────────────────────

/**
 * World units from the drawn body's middle to the simulation's middle (drawn between steps, as the view draws it) in
 * the air. The performances in the air turn the body about its middle, so with nothing else this is 0; what is
 * allowed for: the float's bob (0.03), keeping every drawn part above the bench when it comes down near it (ground.ts
 * lifts the whole figure, up to about 0.15 in the last frames before touchdown) and the release blend's turn. The
 * release freeze this replaced left it 0.7 to 1.7 behind.
 */
const TRACK = 0.25;
/**
 * TRACK holds from this long (s) after the release. Until then the drawn body is letting go of where it was drawn in
 * the hand (the release blend, 0.18 s: carried low over the bench the dangle is drawn lifted clear of the bench top,
 * up to 0.7 above the simulation's middle under the hand). It moves with the simulation from the first frame meanwhile
 * (JUMP and TURN hold throughout).
 */
const SETTLE = 0.25;
/**
 * Within this height of the bench top (world) the view lifts the whole figure so that no drawn part goes through the
 * bench (ground.ts: the tumble's flung limbs reach about 0.7 from its middle): there TRACK is held across the bench
 * only, not up and down.
 */
const CLEAR = 1.0;
/**
 * A snap: the fastest the drawn body's middle may move AWAY FROM the simulation's in one frame, units per second of
 * simulation time between the two frames (the change of drawn-minus-simulated, so however fast the simulation itself
 * goes, a hard throw or a flick of the hand that reaches 45 u/s in its last step, is not counted). The simulation's
 * point is its middle in the air, the hand less `hangBelow` in the hand, and its feet plus `restMid` on the bench.
 * What the performances legitimately add on top: the landing's bounce and roll (about 12 u/s), the dangle swinging in
 * the hand and the dangle let go of at release (about 15), the feet-to-middle change at touchdown (up to 0.3 in a frame
 * on a loaded machine). The pops this catches: the release (the body held at the hand 4 frames while the simulation
 * flew 14 u/s, then 0.8 to 2 units in one frame: 50 to 120 u/s), the landing's whip (about 47 u/s).
 */
const JUMP = 30;
/**
 * The fastest the drawn body may turn in one frame, rad/s. The tumble turns head over heels at up to 11 rad/s and
 * wobbles about its long axis; the landing roll carries that on (at most about 17 rad/s for a slow tumble with nearly
 * a whole turn left to upright); a release eases the dangle into the tumble over 0.18 s. The pops this catches: 100
 * degrees in one frame at release (about 100 rad/s), the pirouette at the stool (up to 176 degrees in a frame).
 */
const TURN = 25;
/** At the foot of the stool: the most the facing may range over (degrees) from 0.4 s before the climb to its turn round to sit (0.43 s in). Half a turn, the short way, and 20 for the walk's own sway. The pirouette was 290 to 446. */
const STOOL_TURN = 200;
/** Through the landing's roll after a throw across: the most the head-over-heels may turn BACK (degrees). The landing rolled back 280 to 620 before. A few degrees for the settle. */
const ROLL_BACK = 10;
/**
 * A throw with drift: its speed across the bench at any step in the air as a share of its speed at release (the
 * simulation's, from step to step). Gravity does not touch it; the old hang stopped it dead (0) for 9 steps.
 */
const DRIFT = 0.95;

// ───────────────────────── the hand ─────────────────────────

type XY = { x: number; y: number };
interface Hand {
  page: Page;
  cdp: CDPSession;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ev = (h: Hand, type: string, q: XY, buttons: number) => h.cdp.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: buttons || type !== 'mouseMoved' ? 'left' : 'none', buttons, clickCount: 1 } as any);
const project = (h: Hand, p: number[]) => h.page.evaluate((p) => (window as any).__bench.project(p) as XY, p);
const patchView = (h: Hand) => h.page.evaluate(() => {
  const v = (window as any).__bench.ws.world.crewView('patch').view;
  return { state: v.state as string, at: v.at as number[] };
});
const holding = (h: Hand) => h.page.evaluate(() => ((window as any).__bench.ws.world.holding()?.id ?? null) as string | null);
const pickAt = (h: Hand, q: XY) => h.page.evaluate(([x, y]) => ((window as any).__bench.ws.surface.at(x, y, 'mouse', null)?.id ?? null) as string | null, [q.x, q.y]);
const screenOf = (h: Hand, id: string) => h.page.evaluate((id) => (window as any).__bench.ws.surface.screen(id) as XY | null, id);
const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n: number): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 50 });
}

/** The pressed hand along a straight line over `ms`, a mouse event every 8 ms by the clock; `accel` speeds up to the end (a throw). */
async function stroke(h: Hand, a: XY, b: XY, ms: number, ease: 'accel' | 'smooth', release = false): Promise<void> {
  const dt = 8;
  const n = Math.max(2, Math.round(ms / dt));
  const f = ease === 'accel' ? (k: number) => k * k : (k: number) => k * k * (3 - 2 * k);
  const sends: Promise<unknown>[] = [];
  await new Promise<void>((done) => {
    let k = 0;
    const t0 = performance.now();
    const tick = setInterval(() => {
      k = Math.min(n, Math.max(k + 1, Math.round((performance.now() - t0) / dt)));
      const e = f(k / n);
      sends.push(ev(h, 'mouseMoved', { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, 1));
      if (k >= n) {
        clearInterval(tick);
        if (release) sends.push(ev(h, 'mouseReleased', b, 0));
        done();
      }
    }, dt);
  });
  await Promise.all(sends);
}

async function take(h: Hand, id: string): Promise<XY> {
  for (let i = 0; i < 6; i++) {
    let s: XY | null = null;
    for (let j = 0; j < 40 && !s; j++) {
      const q = await screenOf(h, id);
      if (q && (await pickAt(h, q)) === id) s = q;
      else await frames(h.page, 4);
    }
    if (!s) throw new Error(`no clear grip on ${id}`);
    await ev(h, 'mouseMoved', s, 0);
    await frames(h.page, 3);
    await ev(h, 'mousePressed', s, 1);
    await frames(h.page, 8);
    if ((await holding(h)) === id) return s;
    await ev(h, 'mouseReleased', s, 0);
    await frames(h.page, 20);
  }
  throw new Error(`could not take ${id}`);
}

/** Carry Patch so its middle is over world (x, z); returns the hand's screen point. */
async function carry(h: Hand, from: XY, to: [number, number]): Promise<XY> {
  let hand = from;
  for (let pass = 0; pass < 5; pass++) {
    const p = (await patchView(h)).at;
    const here = await project(h, p);
    const there = await project(h, [to[0], p[1]!, to[1]]);
    const next = { x: hand.x + (there.x - here.x), y: hand.y + (there.y - here.y) };
    if (Math.hypot(next.x - hand.x, next.y - hand.y) < 3) break;
    await stroke(h, hand, next, pass === 0 ? 1000 : 250, 'smooth');
    hand = next;
    await frames(h.page, 15);
  }
  return hand;
}

async function untilSeated(h: Hand): Promise<void> {
  await expect.poll(async () => (await patchView(h)).state, { timeout: 60_000, intervals: [250] }).toBe('seated');
}

// ───────────────────────── the recording ─────────────────────────

/** Installed in the page: every rendered frame and every simulation step. */
function install(): void {
  const B = (window as any).__bench;
  const ws = B.ws;
  const w = ws.world;
  const root = ws.views.find((v: any) => v.root?.name === 'patch')?.root;
  let body: any = null;
  root?.traverse((o: any) => {
    if (!body && o.name === 'body' && o.children.some((c: any) => c.name === 'spine')) body = o;
  });
  if (!body) throw new Error('no body bone under the patch view');
  const rec = { frames: [] as any[], steps: [] as any[], releases: [] as number[], hits: [] as number[], top: w.scene.bench.top as number };
  (window as any).__feel = rec;
  const drv = ws.driver;
  const render = drv.render.bind(drv);
  drv.render = (info: any) => {
    const f = render(info);
    const v = w.crewView('patch').view;
    const e = body.matrixWorld.elements;
    rec.frames.push({ s: w.step, a: f.alpha, t: f.time, dt: f.dt, st: v.state, at: [...v.at], prev: v.prevAt === v.at ? null : [...v.prevAt], drop: !!v.thrown?.drop, m: Array.from(e) });
    return f;
  };
  const advance = w.advance.bind(w);
  w.advance = () => {
    advance();
    const v = w.crewView('patch').view;
    rec.steps.push({ s: w.step, st: v.state, at: [...v.at], vel: v.thrown?.v ? [...v.thrown.v] : null, top: !!v.thrown?.top });
  };
  const dispatch = w.dispatch.bind(w);
  w.dispatch = (i: any) => {
    if ((i.type === 'release' && w.holding()?.id === 'patch') || (i.type === 'drag' && i.id === 'patch' && i.end)) rec.releases.push(w.step + 1);
    dispatch(i);
  };
  const drain = w.drainEvents.bind(w);
  w.drainEvents = () => {
    const out = drain();
    for (const e of out) if (e.type === 'patch.throw' && e.phase === 'hit') rec.hits.push(w.step);
    return out;
  };
}

interface FrameRow { s: number; a: number; t: number; dt: number; st: string; at: number[]; prev: number[] | null; drop: boolean; m: number[] }
interface StepRow { s: number; st: string; at: number[]; vel: number[] | null; top: boolean }

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const col = (f: FrameRow, i: number): V => [f.m[i * 4]!, f.m[i * 4 + 1]!, f.m[i * 4 + 2]!];
const boneAt = (f: FrameRow): V => [f.m[12]!, f.m[13]!, f.m[14]!];
/** The body's middle (0.3 up the body bone, the point it tumbles about; the matrix carries the crew's scale). */
const middle = (f: FrameRow): V => { const o = boneAt(f), u = col(f, 1); return [o[0] + 0.3 * u[0], o[1] + 0.3 * u[1], o[2] + 0.3 * u[2]]; };
/** The angle (rad) between two frames' body orientations. */
function turned(a: FrameRow, b: FrameRow): number {
  const A = [norm(col(a, 0)), norm(col(a, 1)), norm(col(a, 2))], C = [norm(col(b, 0)), norm(col(b, 1)), norm(col(b, 2))];
  let tr = 0;
  for (let i = 0; i < 3; i++) tr += C[i]![0] * A[i]![0] + C[i]![1] * A[i]![1] + C[i]![2] * A[i]![2];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}
const yawOf = (f: FrameRow): number => { const z = col(f, 2); return Math.atan2(z[0], z[2]); };
const wrap = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x));
/** The simulation's `at` drawn between steps, as the view should draw it. */
const simAt = (f: FrameRow): V => (f.prev ? [f.prev[0]! + (f.at[0]! - f.prev[0]!) * f.a, f.prev[1]! + (f.at[1]! - f.prev[1]!) * f.a, f.prev[2]! + (f.at[2]! - f.prev[2]!) * f.a] : (f.at as V));
const DESIGNED_JUMP = new Set(['away', 'ledge', 'haul']);
/** The simulation's point for Patch's middle in each state (PATCH_TUNING: hangBelow 0.6, restMid 0.3). */
const simRef = (f: FrameRow): V => {
  const p = simAt(f);
  return f.st === 'held' ? [p[0], p[1] - 0.6, p[2]] : f.st === 'fly' || f.st === 'wall' ? p : [p[0], p[1] + 0.3, p[2]];
};

interface Measured {
  name: string;
  releaseMoved: number;
  track: number;
  jump: number;
  jumpAt: string;
  turn: number;
  turnAt: string;
  stoolTurn: number;
  rollBack: number | null;
  stillSteps: number;
  driftShare: number | null;
  hits: number;
  floatSteps: number;
}

function measure(name: string, frames: FrameRow[], steps: StepRow[], release: number, hits: number[], benchTop: number): Measured {
  const m: Measured = { name, releaseMoved: 0, track: 0, jump: 0, jumpAt: '', turn: 0, turnAt: '', stoolTurn: 0, rollBack: null, stillSteps: 0, driftShare: null, hits: hits.length, floatSteps: 0 };
  const fr = frames.filter((f) => f.s >= release - 30);
  // the release: the first frame drawn after the release step
  const i0 = fr.findIndex((f) => f.s >= release && f.st !== 'held');
  expect(i0, `${name}: a frame after the release`).toBeGreaterThan(0);
  m.releaseMoved = len(sub(middle(fr[i0]!), middle(fr[i0 - 1]!)));
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1]!, b = fr[i]!;
    if (DESIGNED_JUMP.has(a.st) || DESIGNED_JUMP.has(b.st)) continue;
    // (per second of whichever clock moved more between the frames: the simulation's (the stage's time, where Patch
    // is) or the frame's own (the view's damped turns and spins run on it); a late frame can have little of one and
    // much of the other)
    const dt = Math.max(b.t - a.t, b.dt, 1 / 240);
    const j = len(sub(sub(middle(b), simRef(b)), sub(middle(a), simRef(a)))) / dt;
    const r = turned(a, b) / dt;
    if (j > m.jump) { m.jump = j; m.jumpAt = `${a.st}>${b.st} step ${b.s}`; }
    if (r > m.turn) { m.turn = r; m.turnAt = `${a.st}>${b.st} step ${b.s}`; }
    if (b.st === 'fly' && i >= i0 && b.t - fr[i0]!.t >= SETTLE) {
      const d = sub(middle(b), simAt(b));
      // (near the bench the whole figure is lifted clear of its top: there only across the bench counts)
      m.track = Math.max(m.track, simAt(b)[1] - benchTop > CLEAR ? len(d) : Math.hypot(d[0], d[2]));
    }
  }
  // the landing's roll: the turn about the body's own side-to-side axis, signed by the way it first turned
  const li = fr.findIndex((f) => f.st === 'land');
  if (li > 0 && !fr[li]!.drop) {
    let first = 0, acc = 0, peak = 0, back = 0;
    for (let i = li; i < fr.length && fr[i]!.st === 'land'; i++) {
      const a = fr[i - 1]!, b = fr[i]!;
      const ax = norm(col(a, 0)), u0 = norm(col(a, 1)), u1 = norm(col(b, 1));
      const cr: V = [u0[1] * u1[2] - u0[2] * u1[1], u0[2] * u1[0] - u0[0] * u1[2], u0[0] * u1[1] - u0[1] * u1[0]];
      const ang = Math.atan2(cr[0] * ax[0] + cr[1] * ax[1] + cr[2] * ax[2], u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2]);
      if (!first && Math.abs(ang) > 0.01) first = Math.sign(ang);
      if (first) {
        acc += ang * first;
        peak = Math.max(peak, acc);
        back = Math.max(back, peak - acc);
      }
    }
    m.rollBack = (back * 180) / Math.PI;
  }
  // the foot of the stool: the facing's range from 0.4 s before the climb to 0.43 s into it (where it turns round to sit)
  const ci = fr.findIndex((f) => f.st === 'climb');
  if (ci > 0) {
    const tc = fr[ci]!.t;
    let yaw = 0, lo = 0, hi = 0;
    for (let i = 1; i < fr.length; i++) {
      const b = fr[i]!;
      if (b.t < tc - 0.4 || b.t > tc + 0.43) continue;
      yaw += wrap(yawOf(b) - yawOf(fr[i - 1]!));
      lo = Math.min(lo, yaw);
      hi = Math.max(hi, yaw);
    }
    m.stoolTurn = ((hi - lo) * 180) / Math.PI;
  }
  // the air, the simulation's own steps: a step without motion; the drift kept through the top (a third of a second
  // either side of it, before anything it may meet later on: a knock is a legitimate change of speed)
  const air = steps.filter((s) => s.s >= release && s.st === 'fly');
  const v0 = air[1] ? sub(air[1].at as V, air[0]!.at as V) : null;
  const level0 = v0 ? Math.hypot(v0[0], v0[2]) * 60 : 0;
  const apex = air.find((s) => s.vel && s.vel[1]! <= 0)?.s ?? -1;
  let least = Infinity;
  for (let i = 1; i < air.length; i++) {
    if (air[i]!.s !== air[i - 1]!.s + 1) break;
    const d = sub(air[i]!.at as V, air[i - 1]!.at as V);
    // (a step stopped against something it met, Fetch or a part, is a legitimate impulse: not counted)
    if (len(d) < 1e-5 && !hits.some((h) => Math.abs(h - air[i]!.s) <= 2)) m.stillSteps++;
    if (air[i]!.top) m.floatSteps++;
    if (apex >= 0 && Math.abs(air[i]!.s - apex) <= 20 && !hits.some((h) => h <= air[i]!.s + 1)) least = Math.min(least, Math.hypot(d[0], d[2]) * 60);
  }
  if (level0 > 1 && least < Infinity) m.driftShare = least / level0;
  return m;
}

test('R5: Patch thrown four ways by mouse: it leaves the hand at once, the drawn body stays with the simulated one, nothing pops, the landing rolls on, the turn at the stool is the short way, and a throw up floats without stopping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/dev/bench/?hud=0`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  const h: Hand = { page, cdp: await page.context().newCDPSession(page) };
  // the first press ends the opening demonstration: a crate lifted and put back down
  {
    const s = await take(h, 'crate-3');
    await stroke(h, s, { x: s.x, y: s.y - 6 }, 120, 'smooth');
    await frames(page, 15);
    await ev(h, 'mouseReleased', { x: s.x, y: s.y - 6 }, 0);
    await frames(page, 60);
  }
  await page.evaluate(install);
  const throws: Array<{ name: string; to: [number, number]; flick: (hand: XY) => Promise<XY> }> = [
    {
      name: 'across',
      to: [-6.5, -2],
      // 2.4 units to the right in 200 ms, speeding up (12 u/s on average): a firm throw across the bench
      flick: async (hand) => {
        const p = (await patchView(h)).at;
        const a = await project(h, p), b = await project(h, [p[0]! + 2.4, p[1]!, p[2]!]);
        return { x: hand.x + b.x - a.x, y: hand.y + b.y - a.y };
      },
    },
    { name: 'up', to: [-4.5, 2], flick: async (hand) => ({ x: hand.x, y: hand.y - 70 }) },
    { name: 'up with drift', to: [-5.5, 2], flick: async (hand) => ({ x: hand.x + 10, y: hand.y - 70 }) },
    {
      name: 'from the right',
      to: [7.5, 1.5],
      flick: async (hand) => {
        const p = (await patchView(h)).at;
        const a = await project(h, p), b = await project(h, [p[0]! - 1.49, p[1]!, p[2]! - 0.59]);
        return { x: hand.x + b.x - a.x, y: hand.y + b.y - a.y };
      },
    },
  ];
  const results: Measured[] = [];
  for (const th of throws) {
    await untilSeated(h);
    const s = await take(h, 'patch');
    const hand = await carry(h, s, th.to);
    await frames(page, 30);
    const to = await th.flick(hand);
    await page.evaluate(() => { const r = (window as any).__feel; r.frames.length = 0; r.steps.length = 0; r.releases.length = 0; r.hits.length = 0; });
    await stroke(h, hand, to, th.name === 'across' ? 200 : th.name === 'from the right' ? 220 : 110, 'accel', true);
    await untilSeated(h);
    const rec = await page.evaluate(() => (window as any).__feel as { frames: FrameRow[]; steps: StepRow[]; releases: number[]; hits: number[]; top: number });
    expect(rec.releases.length, `${th.name}: let go once`).toBe(1);
    if (process.env.FEEL_DUMP) writeFileSync(`${process.env.FEEL_DUMP}-${th.name.replace(/ /g, '-')}-${Date.now()}.json`, JSON.stringify(rec));
    const m = measure(th.name, rec.frames, rec.steps, rec.releases[0]!, rec.hits, rec.top);
    results.push(m);
    console.log(`[feel] ${JSON.stringify({ ...m, track: +m.track.toFixed(3), jump: +m.jump.toFixed(1), turn: +m.turn.toFixed(1), stoolTurn: Math.round(m.stoolTurn), rollBack: m.rollBack === null ? null : +m.rollBack.toFixed(1), releaseMoved: +m.releaseMoved.toFixed(3), driftShare: m.driftShare === null ? null : +m.driftShare.toFixed(3) })}`);
  }
  for (const m of results) {
    // (the hand in a release frame moves on by itself, so "moved" is any motion at all: the freeze was exactly 0)
    expect(m.releaseMoved, `${m.name}: the drawn body moves in the first frame after the release`).toBeGreaterThan(0.01);
    expect(m.track, `${m.name}: the drawn middle within ${TRACK} of the simulation's in the air`).toBeLessThanOrEqual(TRACK);
    expect(m.jump, `${m.name}: no frame snaps the drawn body away from the simulation's faster than ${JUMP} u/s (${m.jumpAt})`).toBeLessThanOrEqual(JUMP);
    expect(m.turn, `${m.name}: no frame turns it faster than ${TURN} rad/s (${m.turnAt})`).toBeLessThanOrEqual(TURN);
    expect(m.stoolTurn, `${m.name}: the turn at the foot of the stool, degrees`).toBeLessThanOrEqual(STOOL_TURN);
    if (m.rollBack !== null) expect(m.rollBack, `${m.name}: the landing's roll turns back, degrees`).toBeLessThanOrEqual(ROLL_BACK);
    expect(m.stillSteps, `${m.name}: simulation steps in the air without motion`).toBe(0);
  }
  const up = results.find((m) => m.name === 'up')!;
  expect(up.floatSteps, 'thrown straight up, it floats at its top for a few steps').toBeGreaterThan(3);
  const drift = results.find((m) => m.name === 'up with drift')!;
  expect(drift.driftShare, 'thrown up with drift, it has drift').not.toBeNull();
  expect(drift.driftShare!, `thrown up with drift: its speed across never below ${DRIFT} of what it left with`).toBeGreaterThanOrEqual(DRIFT);
  // (a little drift, about 10 degrees off straight up: it still floats, and drifts on through the float)
  expect(drift.floatSteps, 'thrown up with a little drift, it floats too').toBeGreaterThan(3);
});
