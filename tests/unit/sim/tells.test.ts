// P3 S1: tells (REWRITE.md § B3: "After the first consequence: the lamp of the nearest untouched station blinks
// slowly ... One at a time, nearest first, every twelve seconds of inactivity, never while the visitor is busy, and
// none after six discoveries"). Each word of the rule as `sim/tells.ts` reads it, one test each, on the whole bench.
import { describe, expect, test } from 'vitest';
import { run, stubWorld } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { TELL_TUNING } from '../../../src/workshop/sim/tells.ts';
import { TELL_SECONDS } from '../../../src/workshop/sim/machine.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { parseSaved } from '../../../src/workshop/sim/saved.ts';
import type { World, WorldOptions } from '../../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../../src/workshop/sim/types.ts';

const EVERY = steps(TELL_TUNING.every);
const STATIONS = bench.button.ladder!.stations;
const world = (opts: Partial<WorldOptions> = {}): World => stubWorld(1, { scene: bench, ...opts }).world;
const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** Untouched stations by distance from `p` (ties in ladder order). */
const byDistance = (p: Vec3, used: readonly Id[] = []): Id[] =>
  STATIONS.map((s, i) => ({ id: s.id, d: flat(s.at, p), i }))
    .filter((s) => !used.includes(s.id))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((s) => s.id);

/** Tells told in these events: the scheduler's (the world's `tells().last` moved), as [step, station, times]. */
function tellsOver(w: World, n: number): { step: number; id: Id; times: number }[] {
  const out: { step: number; id: Id; times: number }[] = [];
  let last = w.tells().last?.step ?? -1;
  for (let i = 0; i < n; i++) {
    run(w, 1);
    const l = w.tells().last;
    if (l && l.step !== last) {
      out.push(l);
      last = l.step;
    }
  }
  return out;
}

/**
 * Press the Button and run to the end of its rung (a first consequence); returns the step the press was input at
 * (the world counts inactivity from the step an intent is dispatched in, before the step that handles it).
 */
function pressThrough(w: World): number {
  const at = w.step;
  w.dispatch({ type: 'press', id: 'button' });
  const ev: SimEvent[] = [];
  for (let i = 0; i < 2000 && !ev.some((e) => e.type === 'rung.ended'); i++) ev.push(...run(w, 1));
  return at;
}

describe('tells: each word of the rule', () => {
  test('never in attract mode', () => {
    const w = world();
    expect(tellsOver(w, steps(90))).toEqual([]);
    expect(w.tells()).toMatchObject({ armed: false, last: null, next: null });
  });

  test('not before the first consequence: a pick-up put straight back is an action and not a consequence', () => {
    const w = world();
    run(w, 30);
    const id = [...w.parts()].find((p) => p.kind === 'crate' && w.mode(p.id) === 'free')!.id;
    w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
    run(w, 1);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(w, 1);
    expect(w.playMode).toBe(true);
    expect(w.tells().armed).toBe(false);
    expect(tellsOver(w, EVERY * 3)).toEqual([]);
  });

  test('the first comes after twelve seconds of inactivity, at the nearest untouched station to where the visitor acted (the Button)', () => {
    const w = world();
    run(w, 30);
    const pressed = pressThrough(w);
    expect(w.tells().armed).toBe(true);
    const told = tellsOver(w, EVERY * 2);
    expect(told[0]!.step).toBe(pressed + EVERY);
    expect(told[0]!.id).toBe(byDistance(bench.button.at)[0]);
    expect(told[0]!.times).toBe(1);
  });

  test('the tell is the station\'s own: its lamp blinks slowly (for TELL_SECONDS), and the bus says `tell`', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    const ev: SimEvent[] = [];
    let id: Id | null = null;
    for (let i = 0; i < EVERY * 2 && id === null; i++) {
      ev.push(...run(w, 1));
      id = w.tells().last?.id ?? null;
    }
    expect(id).not.toBeNull();
    expect(ev.some((e) => e.type === 'tell' && e.id === id)).toBe(true);
    const m = w.machine(id!);
    expect(m?.lamp).toBe('blink');
    run(w, steps(TELL_SECONDS) + 1);
    expect(w.machine(id!)?.lamp).not.toBe('blink');
  });

  test('one at a time, every twelve seconds, nearest first; moving on rather than nagging; only then round again', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    const order = byDistance(bench.button.at);
    const told = tellsOver(w, EVERY * (order.length + 3) + 5);
    // every twelve seconds exactly, never two at once (a blink is over before the next)
    for (let i = 1; i < told.length; i++) expect(told[i]!.step - told[i - 1]!.step).toBe(EVERY);
    expect(TELL_SECONDS).toBeLessThan(TELL_TUNING.every);
    // nearest first, each untouched station once, then the nearest again (the second time: `times` 2, the lid's seam)
    expect(told.slice(0, order.length).map((t) => t.id)).toEqual(order);
    expect(told.slice(0, order.length).every((t) => t.times === 1)).toBe(true);
    expect(told[order.length]).toMatchObject({ id: order[0], times: 2 });
  });

  test('inactivity: any input (the pointer passing included) puts the next tell twelve seconds after it', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    run(w, steps(10));
    const hoverAt = w.step;
    w.dispatch({ type: 'hover', id: null });
    const told = tellsOver(w, EVERY * 2);
    expect(told[0]!.step).toBe(hoverAt + EVERY);
  });

  test('nearest to where the visitor last acted: the plug put into the LAMP jack, the lamp is told first (from the Button it would be the phone)', () => {
    const w = world();
    run(w, 30);
    w.dispatch({ type: 'unplug', cord: 'cord' });
    run(w, 2);
    w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    run(w, 2);
    expect(w.button().used).toEqual(['cord']);
    expect(w.tells().armed).toBe(true); // the cord's jack changed: a consequence
    const jackAt = bench.cord.jacks.find((j) => j.id === 'jack-lamp')!.at;
    expect(w.tells().from).toEqual(jackAt);
    const told = tellsOver(w, EVERY + 5);
    expect(told.map((t) => t.id)).toEqual([byDistance(jackAt, ['cord'])[0]]);
    expect(told[0]!.id).toBe('lamp');
    expect(byDistance(bench.button.at, ['cord'])[0]).toBe('line');
  });

  test('untouched: a station the visitor has used is never told', () => {
    const w = world();
    run(w, 30);
    for (const id of ['striker', 'undo-lever']) {
      w.dispatch({ type: 'press', id });
      run(w, 2);
    }
    pressThrough(w);
    const used = w.button().used;
    expect(used).toEqual(expect.arrayContaining(['striker', 'undo-lever']));
    const told = tellsOver(w, EVERY * 9);
    expect(told.length).toBeGreaterThan(3);
    for (const t of told) expect(used).not.toContain(t.id);
  });

  test('never while busy: holding something (it waits; let go, the next comes twelve seconds after)', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    const id = [...w.parts()].find((p) => p.kind === 'crate' && w.mode(p.id) === 'free' && !w.touched(p.id))!.id;
    w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
    run(w, 1);
    expect(w.holding()).not.toBeNull();
    expect(tellsOver(w, EVERY * 3)).toEqual([]); // the hand still, nothing sent: inactive, but busy
    const letGo = w.step;
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const told = tellsOver(w, EVERY * 2);
    expect(told[0]!.step).toBe(letGo + EVERY);
  });

  test('never while busy: texts waiting to be answered hold the tell until the line is clear, then it comes at once', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    // a queue of jobs longer than twelve seconds (each a roll, a drawer, the work, a check and the reply)
    for (const t of ['make the sign say HELLO', 'brighter', 'paint the awning violet', 'dimmer', 'make the sign say OPEN']) w.dispatch({ type: 'text', text: t });
    run(w, 1);
    const lastInput = w.step;
    let clearAt = -1;
    const told: number[] = [];
    for (let i = 0; i < EVERY * 6 && told.length === 0; i++) {
      run(w, 1);
      const line = w.machine('line');
      if (clearAt < 0 && line?.kind === 'line' && line.job === null && line.waiting === 0) clearAt = w.step;
      if (w.tells().last) told.push(w.tells().last!.step);
    }
    expect(clearAt).toBeGreaterThan(lastInput + EVERY); // the line really was busy past the twelve seconds
    expect(told[0]).toBeGreaterThanOrEqual(clearAt);
    expect(told[0]! - clearAt).toBeLessThanOrEqual(1);
  });

  test('none after six discoveries: six used, no more tells this visit, and the snapshot carries it to the next', () => {
    const w = world();
    run(w, 30);
    // five used: tells still come
    for (const id of ['striker', 'undo-lever', 'belt-dial', 'dock', 'chute']) {
      w.dispatch({ type: 'press', id });
      run(w, 2);
    }
    expect(w.button().used).toHaveLength(5);
    expect(tellsOver(w, EVERY + 5)).toHaveLength(1);
    // the sixth
    w.dispatch({ type: 'unplug', cord: 'cord' });
    run(w, 2);
    w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    run(w, 2);
    expect(w.button().used).toHaveLength(6);
    expect(w.tells().stopped).toBe(true);
    expect(tellsOver(w, EVERY * 4)).toEqual([]);
    // next visit
    const next = world({ saved: parseSaved(JSON.stringify(w.saved()))! });
    run(next, 30);
    pressThrough(next);
    expect(next.tells()).toMatchObject({ armed: true, stopped: true, next: null });
    expect(tellsOver(next, EVERY * 3)).toEqual([]);
  });

  test('a restored visit\'s used stations are not told, and it waits for its own first consequence', () => {
    const used = ['belt', 'striker', 'dock'];
    const w = world({ saved: parseSaved({ v: 1, button: { rung: 0, reached: 0, presses: 0, cover: 'none', deck: { left: [], last: null } }, used })! });
    expect(tellsOver(w, steps(30))).toEqual([]);
    pressThrough(w);
    const told = tellsOver(w, EVERY * 4);
    expect(told.map((t) => t.id)).toEqual(byDistance(bench.button.at, used).slice(0, told.length));
    for (const t of told) expect(used).not.toContain(t.id);
  });

  test('"Reset the workshop" starts it over: nothing told, waiting for a new first consequence', () => {
    const w = world();
    run(w, 30);
    pressThrough(w);
    expect(tellsOver(w, EVERY * 2 + 2).length).toBe(2);
    w.dispatch({ type: 'reset' });
    run(w, 1);
    expect(w.tells()).toMatchObject({ armed: false, last: null, told: {}, from: bench.button.at });
    expect(tellsOver(w, EVERY * 2)).toEqual([]);
    pressThrough(w);
    expect(tellsOver(w, EVERY + 2)[0]).toMatchObject({ id: byDistance(bench.button.at)[0], times: 1 });
  });

  test('deterministic: two worlds told alike, step for step', () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) {
      run(w, 30);
      pressThrough(w);
    }
    expect(tellsOver(a, EVERY * 4)).toEqual(tellsOver(b, EVERY * 4));
  });
});
