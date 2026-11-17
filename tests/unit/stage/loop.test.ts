import { describe, expect, it } from 'vitest';
import { createLoop, FixedStep, type LoopEnv, type RenderInfo } from '../../../src/workshop/view/stage/loop.ts';

describe('FixedStep (the accumulator)', () => {
  it('turns real time into whole 60 Hz steps and an interpolation factor', () => {
    const c = new FixedStep();
    expect(c.tick(1 / 60)).toMatchObject({ steps: 1 });
    const t = c.tick(1.5 / 60);
    expect(t.steps).toBe(1);
    expect(t.alpha).toBeCloseTo(0.5, 6);
    const u = c.tick(0.5 / 60);
    expect(u.steps).toBe(1);
    expect(u.alpha).toBeCloseTo(0, 6);
  });

  it('runs no step for a short frame and carries the remainder', () => {
    const c = new FixedStep();
    const a = c.tick(0.004);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.24, 6);
    const b = c.tick(0.013);
    expect(b.steps).toBe(1);
    expect(b.alpha).toBeCloseTo(0.02, 6);
  });

  it('never spirals: a long pause is clamped and excess steps are dropped', () => {
    const c = new FixedStep({ maxSteps: 5, maxDelta: 0.25 });
    const t = c.tick(3);
    expect(t.steps).toBe(5);
    expect(t.dropped).toBeGreaterThan(2.8);
    // Nothing left over to catch up next frame.
    expect(c.tick(0).steps).toBe(0);
  });

  it('ignores negative and non-finite deltas', () => {
    const c = new FixedStep();
    expect(c.tick(-1).steps).toBe(0);
    expect(c.tick(Number.NaN).steps).toBe(0);
    expect(c.tick(Number.POSITIVE_INFINITY).steps).toBe(0);
  });

  it('keeps the long-run step rate exact', () => {
    const c = new FixedStep();
    let steps = 0;
    for (let i = 0; i < 1000; i++) steps += c.tick(1 / 144).steps; // a 144 Hz display
    expect(steps).toBe(Math.floor((1000 / 144) * 60 + 1e-6));
  });
});

/** A fake browser: frames run when the test says so. */
function fakeEnv(): LoopEnv & { frame(ms: number): void; pending: number; hide(h: boolean): void } {
  let now = 0;
  let next: ((t: number) => void) | null = null;
  let hidden = false;
  const subs: (() => void)[] = [];
  return {
    now: () => now,
    raf(cb) {
      next = cb;
      return 1;
    },
    caf() {
      next = null;
    },
    onVisibility(cb) {
      subs.push(cb);
      return () => {};
    },
    hidden: () => hidden,
    frame(ms: number) {
      now += ms;
      const cb = next;
      next = null;
      cb?.(now);
    },
    get pending() {
      return next ? 1 : 0;
    },
    hide(h: boolean) {
      hidden = h;
      for (const s of subs) s();
    },
  };
}

describe('createLoop', () => {
  it('steps the simulation 0..n times per frame and renders with alpha', () => {
    const env = fakeEnv();
    let steps = 0;
    const renders: RenderInfo[] = [];
    const loop = createLoop({ step: () => steps++, render: (i) => renders.push(i) }, env);
    loop.start();
    env.frame(0); // first frame: no delta yet
    env.frame(1000 / 60);
    env.frame(1000 / 30);
    expect(steps).toBe(3);
    expect(renders).toHaveLength(3);
    expect(renders[2]!.steps).toBe(3);
    expect(loop.frameTimes()).toHaveLength(2);
  });

  it('manual mode takes the wall clock out: advance(n) runs n steps and renders once', () => {
    const env = fakeEnv();
    let steps = 0;
    const renders: RenderInfo[] = [];
    const loop = createLoop({ step: () => steps++, render: (i) => renders.push(i), manual: true }, env);
    loop.start();
    expect(env.pending).toBe(0);
    loop.advance(120);
    expect(steps).toBe(120);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.alpha).toBe(1);
    expect(renders[0]!.time).toBeCloseTo(2, 6); // 120 steps at 60 Hz, alpha 1
    loop.advance(0);
    expect(steps).toBe(120);
    expect(renders).toHaveLength(2);
  });

  it('is deterministic in manual mode whatever the frame rate was', () => {
    const run = (): number[] => {
      const env = fakeEnv();
      const seen: number[] = [];
      let s = 0;
      const loop = createLoop({ step: () => s++, render: (i) => seen.push(i.time) }, env);
      loop.start();
      env.frame(7);
      env.frame(23);
      loop.setManual(true);
      loop.advance(10);
      return seen.slice(-1);
    };
    expect(run()).toEqual(run());
  });

  it('stops drawing while hidden and does not catch up on return', () => {
    const env = fakeEnv();
    let steps = 0;
    const loop = createLoop({ step: () => steps++, render: () => {} }, env);
    loop.start();
    env.frame(0);
    env.frame(1000 / 60);
    expect(steps).toBe(1);
    env.hide(true);
    expect(env.pending).toBe(0);
    expect(loop.running).toBe(false);
    env.hide(false);
    env.frame(60_000); // a minute later
    env.frame(1000 / 60);
    expect(steps).toBe(2);
    loop.dispose();
  });
});
