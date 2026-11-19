// R2: the loop that must not die. One uncaught error in a step or a frame used to stop the animation loop
// (a frozen bench, no word). Strict (development, every test) it is thrown as before; lenient (the production
// page) the faulting unit is skipped, a second fault within 3 s (or any fault of the world itself) puts the
// bench back to its opening state, three resets in a minute rebuild, and a view that throws is paused and
// retried, never frozen for good.
import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { createStubPhysics, createWorld, vignette } from '../../../src/workshop/sim/index.ts';
import type { StepFault, World } from '../../../src/workshop/sim/index.ts';
import type { SimContext, Unit } from '../../../src/workshop/sim/context.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { FaultGuard, GUARD_TUNING, strictMode } from '../../../src/workshop/shell/guard.ts';
import { Driver } from '../../../src/workshop/shell/frame.ts';
import { createLoop } from '../../../src/workshop/view/stage/loop.ts';
import type { StationView } from '../../../src/workshop/view/types.ts';

/** A unit that throws in `phase` while `on()` says so, and counts its calls. */
function faulty(id: string, phase: 'pre' | 'post' | 'heard', on: () => boolean, calls: { n: number }): (ctx: SimContext) => Unit {
  return () => ({
    id,
    [phase]: () => {
      calls.n++;
      if (on()) throw new Error(`${id} broke`);
    },
  });
}

function world(units: ((ctx: SimContext) => Unit)[], onFault?: (f: StepFault) => void): World {
  const b = vignette.bench;
  const physics = createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } });
  return createWorld({ seed: 1, physics, units, ...(onFault ? { onFault } : {}) });
}

describe('the step (World.advance)', () => {
  it('strict (no onFault, every test): a unit that throws throws out of the step, as before', () => {
    const w = world([faulty('bad', 'pre', () => true, { n: 0 })]);
    expect(() => w.advance()).toThrow('bad broke');
  });

  it('lenient: the faulting unit is skipped for the rest of the step, the others and the world carry on', () => {
    const faults: StepFault[] = [];
    const bad = { n: 0 };
    const good = { n: 0 };
    let throwing = true;
    const w = world([faulty('bad', 'pre', () => throwing, bad), faulty('good', 'post', () => false, good)], (f) => faults.push(f));
    w.advance();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ unit: 'bad', phase: 'pre', step: 1 });
    expect(good.n).toBe(1);
    w.advance();
    expect(w.step).toBe(2);
    throwing = false;
    w.advance();
    expect(faults).toHaveLength(2);
    expect(bad.n).toBe(3);
  });

  it('recover() puts the bench back to its opening state, even mid-rung', () => {
    const b = bench.bench;
    const physics = createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } });
    const w = createWorld({ seed: 1, physics, scene: bench });
    const start = w.durable();
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    for (let i = 0; i < 5; i++) w.advance();
    w.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 30; i++) w.advance();
    expect(w.bracketed).toBe(true);
    w.recover();
    expect(w.bracketed).toBe(false);
    for (let i = 0; i < 5; i++) w.advance();
    expect(w.durable().map((d) => [d.target, d.field, JSON.stringify(d.value)])).toEqual(start.map((d) => [d.target, d.field, JSON.stringify(d.value)]));
    expect(w.undoStack()).toEqual([]);
    // and it plays on
    w.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 400; i++) w.advance();
  });
});

describe('the guard', () => {
  const make = (strict = false) => {
    let t = 0;
    const calls = { recover: 0, rebuild: 0, logged: [] as string[] };
    const g = new FaultGuard({ strict, now: () => t, recover: () => void calls.recover++, rebuild: () => void calls.rebuild++, log: (m) => calls.logged.push(m) });
    return { g, calls, at: (ms: number) => void (t = ms) };
  };
  const fault = (unit: string): StepFault => ({ unit, phase: 'pre', error: new Error(`${unit} broke`), step: 1 });

  it('strict: a view, the sound, a hook: thrown as before; never caught at the loop', () => {
    const { g } = make(true);
    expect(() => g.run('view:x', () => { throw new Error('boom'); })).toThrow('boom');
    expect(g.escaped(new Error('loose'))).toBe(false);
  });

  it('one simulation fault: skipped, no reset; a second from ANY unit within 3 s: the bench is put back', () => {
    const { g, calls, at } = make();
    g.stepFault(fault('belt'));
    g.afterStep();
    expect(calls.recover).toBe(0);
    at(GUARD_TUNING.REPEAT_MS + 100);
    g.stepFault(fault('dock'));
    g.afterStep();
    expect(calls.recover).toBe(0); // more than 3 s apart
    at(GUARD_TUNING.REPEAT_MS + 200);
    g.stepFault(fault('revert-crew'));
    g.afterStep();
    expect(calls.recover).toBe(1);
    expect(g.faults()).toMatchObject({ count: 3, resets: 1 });
  });

  it('a fault of the world itself: put back at once', () => {
    const { g, calls } = make();
    g.stepFault(fault('world'));
    g.afterStep();
    expect(calls.recover).toBe(1);
  });

  it('three resets within a minute: rebuilt from scratch; a reset that throws: rebuilt', () => {
    const { g, calls, at } = make();
    for (let k = 0; k < 3; k++) {
      at(k * 10_000);
      g.stepFault(fault('world'));
      g.afterStep();
    }
    expect(calls.recover).toBe(2);
    expect(calls.rebuild).toBe(1);
    const t = new FaultGuard({ strict: false, now: () => 0, recover: () => { throw new Error('no'); }, rebuild: () => void (calls.rebuild += 10), log: () => {} });
    t.stepFault(fault('world'));
    t.afterStep();
    expect(calls.rebuild).toBe(11);
  });

  it('a view that throws is paused 1 s and retried; after three faults in 10 s, every 5 s; never frozen for good', () => {
    const { g, at } = make();
    let runs = 0;
    const bad = (): void => {
      runs++;
      throw new Error('view broke');
    };
    at(0);
    g.run('view:fetch', bad);
    at(500);
    g.run('view:fetch', bad);
    expect(runs).toBe(1); // paused
    at(1001);
    g.run('view:fetch', bad);
    at(2002);
    g.run('view:fetch', bad);
    expect(runs).toBe(3); // the third fault in 10 s
    at(3100);
    g.run('view:fetch', bad);
    expect(runs).toBe(3); // now every 5 s
    at(7003);
    g.run('view:fetch', () => void runs++);
    expect(runs).toBe(4); // retried, and it works again
    at(60_000);
    g.run('view:fetch', () => void runs++);
    expect(runs).toBe(5);
  });

  it('each distinct fault is logged once, with the step and the last intents; every one is counted', () => {
    const { g, calls } = make();
    g.noteIntent({ type: 'press', id: 'undo-lever' });
    for (let i = 0; i < 5; i++) g.run('view:x', () => { throw new Error('same'); });
    g.stepFault(fault('belt'));
    expect(calls.logged).toHaveLength(2);
    expect(g.faults().last).toMatchObject({ unit: 'belt', intents: [{ type: 'press', id: 'undo-lever' }] });
  });

  it('strict mode: development, automation and ?strict=1 are strict; the production page is lenient; ?strict=0 forces it', () => {
    expect(strictMode({ dev: true, search: '', webdriver: false })).toBe(true);
    expect(strictMode({ dev: false, search: '', webdriver: true })).toBe(true);
    expect(strictMode({ dev: false, search: '?strict=1', webdriver: false })).toBe(true);
    expect(strictMode({ dev: false, search: '', webdriver: false })).toBe(false);
    expect(strictMode({ dev: true, search: '?strict=0', webdriver: true })).toBe(false);
  });
});

describe('the frame and the loop', () => {
  it('lenient: a view that throws does not stop the frame; the others are updated and the stage renders', () => {
    const w = world([]);
    const g = new FaultGuard({ strict: false, now: () => 0, recover: () => {}, rebuild: () => {}, log: () => {} });
    let others = 0;
    let rendered = 0;
    const bad: StationView = { root: Object.assign(new Group(), { name: 'bad' }), update: () => { throw new Error('view broke'); }, dispose: () => {} };
    const good: StationView = { root: new Group(), update: () => void others++, dispose: () => {} };
    const d = new Driver({ world: w, views: [bad, good], render: () => void rendered++, now: () => 0, guard: g });
    for (let i = 0; i < 3; i++) {
      d.step();
      d.render({ alpha: 1, dt: 1 / 60 });
    }
    expect(others).toBe(3);
    expect(rendered).toBe(3);
    expect(g.faults().count).toBe(1);
  });

  it('strict: a view that throws throws out of the frame (tests fail loudly)', () => {
    const w = world([]);
    const g = new FaultGuard({ strict: true, recover: () => {}, rebuild: () => {} });
    const bad: StationView = { root: new Group(), update: () => { throw new Error('view broke'); }, dispose: () => {} };
    const d = new Driver({ world: w, views: [bad], render: () => {}, now: () => 0, guard: g });
    expect(() => d.render({ alpha: 1, dt: 1 / 60 })).toThrow('view broke');
  });

  it("the loop's last resort: an error that escapes a frame is handed over and the next frame still comes", () => {
    let cb: ((t: number) => void) | null = null;
    let t = 0;
    const env = { now: () => t, raf: (f: (t: number) => void) => ((cb = f), 1), caf: () => { cb = null; } };
    let frames = 0;
    let escaped = 0;
    const loop = createLoop({ step: () => {}, render: () => { frames++; if (frames === 2) throw new Error('escaped'); }, onError: () => (escaped++, true) }, env);
    loop.start();
    for (let i = 0; i < 4; i++) {
      t += 17;
      const f = cb as ((t: number) => void) | null;
      cb = null;
      f?.(t);
    }
    expect(frames).toBe(4);
    expect(escaped).toBe(1);
    // without onError (strict) it is thrown and the loop stops
    const strict = createLoop({ step: () => {}, render: () => { throw new Error('loud'); } }, env);
    strict.start();
    const f = cb as ((t: number) => void) | null;
    expect(() => f?.(t + 17)).toThrow('loud');
  });
});
