// R4 (Taylor, 2026-11-20: "When you lift Fetch or Revert up high and drop them, the physics can take over ... You should
// be able to throw them up rather than just lift them up. My test ... throwing them up then catching them and back up
// again like juggling."): the upward throw's cap, drops from the top of the lift (5.5), catches in the air, and
// nothing left where no hand and no robot can reach.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, onBelt, putOn, tape, type Tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LOOSE_TUNING, throwCap } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Pose, RevertView, Vec3 } from '../../src/workshop/sim/types.ts';

const upY = (q: readonly number[]): number => 1 - 2 * ((q[0] as number) ** 2 + (q[2] as number) ** 2);
const G = 16;

/** Lift `id` and hold it at `at`, still (the hand there long enough for the carry spring to bring it). */
function liftTo(w: World, t: Tape, id: string, at: Vec3): void {
  w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
  t.run(1);
  expect(w.holding()?.id).toBe(id);
  for (let i = 0; i < 120; i++) {
    w.dispatch({ type: 'carry', target: at });
    t.run(1);
  }
}
/** `p` inside the box `pose`/`half` by more than `m`. */
function inside(p: Vec3, pose: Pose, half: readonly number[], m = 0.02): boolean {
  const [qx, qy, qz, qw] = pose.q;
  const d: Vec3 = [p[0] - pose.p[0], p[1] - pose.p[1], p[2] - pose.p[2]];
  const ix = -qx, iy = -qy, iz = -qz;
  const tx = 2 * (iy * d[2] - iz * d[1]), ty = 2 * (iz * d[0] - ix * d[2]), tz = 2 * (ix * d[1] - iy * d[0]);
  const l = [d[0] + qw * tx + (iy * tz - iz * ty), d[1] + qw * ty + (iz * tx - ix * tz), d[2] + qw * tz + (ix * ty - iy * tx)];
  return Math.abs(l[0]!) < half[0]! - m && Math.abs(l[1]!) < half[1]! - m && Math.abs(l[2]!) < half[2]! - m;
}
/** Every step for `n`: the part's centre never inside a fixed body, never under the bench top. Returns the lowest centre height. */
function watchFall(w: World, t: Tape, id: string, n: number): number {
  const statics = w.scene.statics.filter((s) => s.shape.type === 'box' && s.id !== 'bench');
  let low = Infinity;
  for (let i = 0; i < n; i++) {
    t.run(1);
    const m = w.motion(id)!;
    if (m.mode === 'gone' || m.mode === 'chute') continue;
    const p = m.pose.p;
    low = Math.min(low, p[1]);
    if (Math.abs(p[0]) < 9 && Math.abs(p[2]) < 5) expect(p[1], `${id} through the bench top`).toBeGreaterThan(0.05);
    for (const s of statics) expect(inside(p, s.pose, (s.shape as { half: Vec3 }).half), `${id} inside ${s.id}`).toBe(false);
  }
  return low;
}

describe('throwing up: the cap', () => {
  test('a small crate flicked up hard from the bench rises about 4.5 and is back down in about a second and a half; never past the wall\'s top', async () => {
    const w = await benchWorld('r4-up-crate', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(30);
    liftTo(w, t, 'crate-3', [-1.5, 1.2, 1.2]);
    const y0 = w.motion('crate-3')!.pose.p[1];
    w.dispatch({ type: 'release', velocity: [0, 30, 0] });
    const rel = t.run(1).find((e) => e.type === 'part.released') as { speed: number } | undefined;
    expect(rel!.speed).toBeCloseTo(LOOSE_TUNING.upMax, 1);
    let top = 0;
    let back = -1;
    for (let i = 0; i < steps(3) && back < 0; i++) {
      t.run(1);
      const p = w.motion('crate-3')!.pose.p;
      top = Math.max(top, p[1]);
      if (i > 10 && p[1] < y0) back = i / HZ;
    }
    expect(top - y0).toBeGreaterThan(3.8);
    expect(top - y0).toBeLessThan(4.7);
    expect(top + w.halfExtents('crate-3')![1], 'under the back wall\'s top').toBeLessThan(6);
    expect(back).toBeGreaterThan(1.2);
    expect(back).toBeLessThan(1.8);
    w.dispose();
  }, 60_000);

  test('by mass: Fetch goes up slower (about 8.5 u/s), Revert slower still; from the top of the lift no throw passes 7.2', async () => {
    const w = await benchWorld('r4-up-mass', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(30);
    liftTo(w, t, 'fetch', [-1.5, 1.6, 1.2]);
    w.dispatch({ type: 'release', velocity: [0, 30, 0] });
    const relF = t.run(1).find((e) => e.type === 'part.released') as { speed: number };
    const kF = throwCap(0.9) / LOOSE_TUNING.throwMax;
    expect(relF.speed).toBeCloseTo(LOOSE_TUNING.upMax * kF, 1);
    t.run(steps(6));
    // from the top of the lift: a crate let go at 5.5 with a hard flick up stays under 7.2 (the ceiling is at 8)
    liftTo(w, t, 'crate-3', [-1.5, 5.5, 0]);
    w.dispatch({ type: 'release', velocity: [0, 30, 0] });
    let top = 0;
    for (let i = 0; i < steps(2); i++) {
      t.run(1);
      top = Math.max(top, w.motion('crate-3')!.pose.p[1]);
    }
    expect(top).toBeLessThan(LOOSE_TUNING.upApex + 0.05);
    w.dispose();
  }, 60_000);
});

describe('dropped from the top of the lift (5.5)', () => {
  const ONTO: [string, (w: World) => Vec3][] = [
    ['the bench', () => [-1.5, 5.5, 1.2]],
    ['the running belt', () => [onBelt(0.4)[0], 5.5, onBelt(0.4)[2]]],
    ['the console\'s top', () => [-0.6, 5.5, 0.5]],
    ['the crate stack', () => [AT.stack[0], 5.5, AT.stack[1]]],
    ['Fetch', (w) => { const p = w.motion('fetch')!.pose.p; return [p[0], 5.5, p[2]]; }],
  ];
  for (const [what, at] of ONTO) {
    test(`a small crate onto ${what}: it falls at about 13 u/s and never passes into anything`, async () => {
      const w = await benchWorld(`r4-drop-${what}`, { scene: FULL_BENCH });
      const t = tape(w);
      t.run(steps(1));
      startPlay(w);
      if (what === 'Fetch') for (let i = 0; i < steps(30) && !(w.crew('fetch')!.state === 'idle' && !w.crew('fetch')!.carrying); i++) t.run(1);
      liftTo(w, t, 'crate-3', at(w));
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      watchFall(w, t, 'crate-3', steps(3));
      const p = w.motion('crate-3')!.pose.p;
      if (w.motion('crate-3')!.mode === 'free') expect(p[1]).toBeGreaterThan(0.2);
      w.dispose();
    }, 60_000);
  }

  test('Fetch dropped from 5.5 onto the bench: it lands, rights itself, shakes it off (dazed, not hurt) and is back at work', async () => {
    const w = await benchWorld('r4-drop-fetch', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    startPlay(w);
    liftTo(w, t, 'fetch', [-1.5, 5.5, 1.4]);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    watchFall(w, t, 'fetch', steps(1.5));
    let back = -1;
    for (let i = 0; i < steps(10) && back < 0; i++) {
      t.run(1);
      const f = w.crew('fetch')!;
      if (w.motion('fetch')!.mode === 'crew' && !['held', 'shrug', 'jetpack', 'return'].includes(f.state)) back = i / HZ;
    }
    expect(back).toBeGreaterThan(0);
    expect(upY(w.motion('fetch')!.pose.q)).toBeGreaterThan(0.99);
    w.dispose();
  }, 60_000);

  const REVERT_ONTO: [string, (w: World) => Vec3][] = [
    ['a crate', (w) => { const p = w.motion('crate-3')!.pose.p; return [p[0], 5.5, p[2]]; }],
    ['Fetch', (w) => { const p = w.motion('fetch')!.pose.p; return [p[0], 5.5, p[2]]; }],
    ['Patch\'s stool', () => [3.02, 5.5, -3.46]],
  ];
  for (const [what, at] of REVERT_ONTO) {
    // (S7, 2026-11-20: up on a crate or Patch's stool it gets itself down: off a low thing it trundles, from higher it
    // goes down and comes back up through its hatch)
    test(`Revert dropped from 5.5 onto ${what}: nothing passes into anything, nothing throws, and it trundles home`, async () => {
      const w = await benchWorld(`r4-drop-revert-${what}`, { scene: FULL_BENCH });
      const t = tape(w);
      t.run(steps(1));
      w.dispatch({ type: 'press', id: 'undo-lever' }); // it comes up with its card (nothing to take back)
      for (let i = 0; i < steps(6) && (w.machine('revert-crew') as RevertView).lift < 1; i++) t.run(1);
      t.run(steps(1));
      liftTo(w, t, 'revert', at(w));
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      watchFall(w, t, 'revert', steps(2));
      for (const id of ['crate-3', 'fetch']) {
        const m = w.motion(id)!;
        if (m.mode === 'free' || m.mode === 'crew') expect(m.pose.p[1], `${id} pushed into the bench`).toBeGreaterThan(0.1);
      }
      let home = false;
      for (let i = 0; i < steps(40) && !home; i++) {
        t.run(1);
        home = (w.machine('revert-crew') as RevertView).state === 'below';
      }
      if (process.env.REVERT_DROP_LOG) console.log('LOG', what, t.events.filter((x) => ['crew.knocked', 'crew.nudged', 'part.hit', 'crew.state'].includes(x.e.type) && JSON.stringify(x.e).match(/revert|fetch|crate-3/)).slice(0, 40).map((x) => `${(x.step / HZ).toFixed(2)} ${JSON.stringify(x.e).slice(0, 110)}`).join('\n'));
      expect(home, 'Revert went home').toBe(true);
      w.dispose();
    }, 90_000);
  }
});

describe('caught in the air', () => {
  for (const id of ['crate-3', 'fetch'] as const) {
    test(`${id}: thrown up, caught rising and caught falling, with no snap; a juggle of three, then set down; the lever once puts it back where it lay before the juggle`, async () => {
      const w = await benchWorld(`r4-juggle-${id}`, { scene: FULL_BENCH });
      const t = tape(w);
      t.run(steps(1));
      startPlay(w);
      t.run(steps(2));
      const before = w.part(id)!.location;
      const stack0 = w.undoStack().length;
      liftTo(w, t, id, [-1.5, 1.6, 1.4]);
      for (let k = 0; k < 3; k++) {
        w.dispatch({ type: 'release', velocity: [0, 30, 0] });
        // caught rising on the first and third, falling on the second
        const wait = k === 1 ? steps(1.0) : steps(0.25);
        t.run(wait);
        const m0 = w.motion(id)!.pose.p;
        const speed = Math.hypot(...([0, 1, 2].map((i) => (w.motion(id)!.pose.p[i]! - w.motion(id)!.prev.p[i]!) * HZ) as [number, number, number]));
        w.dispatch({ type: 'grab', id, grip: m0 });
        t.run(1);
        expect(w.holding()?.id, `caught (${k})`).toBe(id);
        const m1 = w.motion(id)!.pose.p;
        // no snap: it moves on from where it was by no more than its own speed carries it in a step (and the lift's ease)
        expect(Math.hypot(m1[0] - m0[0], m1[1] - m0[1], m1[2] - m0[2]), 'no snap').toBeLessThan(speed / HZ + 0.1);
        // the hand brings it back down to throw again
        for (let i = 0; i < 60; i++) {
          w.dispatch({ type: 'carry', target: [-1.5, 1.6, 1.4] });
          t.run(1);
        }
      }
      // set down where the juggle began, still
      for (let i = 0; i < 60; i++) {
        w.dispatch({ type: 'carry', target: [-1.5, 1.0, 1.4] });
        t.run(1);
      }
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      t.run(steps(6));
      // the three caught throws left nothing on the stack (no rest between them); the set-down is one
      // (Fetch: the first catch also drops the crate in its hands, which is that grab's transaction)
      expect(w.undoStack().length, 'one transaction: where it came to rest').toBeLessThanOrEqual(stack0 + (id === 'fetch' ? 2 : 1));
      w.dispatch({ type: 'undo' });
      t.run(steps(3));
      if (id === 'crate-3') expect(w.part(id)!.location).toEqual(before);
      for (let k = 0; k < 4; k++) {
        w.dispatch({ type: 'undo' });
        t.run(steps(0.5));
      }
      t.run(steps(8));
      expect(w.holding()).toBeNull();
      w.dispose();
    }, 120_000);
  }
});

describe('nothing stays where no hand and no robot can reach', () => {
  const HIGH: [string, Vec3][] = [
    ['the switchboard\'s top', [-0.1, 3.4, -4.67]],
    ['the storefront\'s roof', [7.07, 3.0, -3.54]],
  ];
  for (const [where, at] of HIGH) {
    test(`a crate set on ${where} goes home by the chute after three seconds: thrown back onto the pad`, async () => {
      const w = await benchWorld(`r4-high-${where}`, { scene: FULL_BENCH });
      const t = tape(w);
      t.run(steps(1));
      putOn(w, t, 'crate-3', [at[0], at[1] - 0.25, at[2]], 120);
      t.run(steps(1));
      const p0 = w.motion('crate-3')!.pose.p;
      expect(p0[1], 'it lies up there').toBeGreaterThan(LOOSE_TUNING.highRest);
      const sent = t.until((e) => e.type === 'restock.launched' && e.part === 'crate-3', steps(LOOSE_TUNING.highRestTime + 4));
      expect(sent, 'sent home by the chute').not.toBeNull();
      t.run(steps(4));
      const p = w.motion('crate-3')!.pose.p;
      expect(Math.hypot(p[0] - AT.pad[0], p[2] - AT.pad[1])).toBeLessThan(2.4);
      expect(p[1]).toBeLessThan(0.6);
      w.dispose();
    }, 60_000);
  }
});
