// I1: what a thing is to a hand comes from the registry's affordances and the scene's data (the bench scene, stub physics).
import { describe, expect, it } from 'vitest';
import { createStubPhysics, createWorld } from '../../../src/workshop/sim/index.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { createSurface, JACK_REACH } from '../../../src/workshop/input/surface.ts';
import { readingFromWorld } from '../../../src/workshop/input/readings.ts';
import type { RayLike } from '../../../src/workshop/input/carry.ts';
import type { Id } from '../../../src/workshop/sim/types.ts';

const world = () => createWorld({ seed: 1, physics: createStubPhysics(), scene: bench });

/** Screen px are world units ×100: a camera straight down (bench), or square-on to the board (jacks). */
const down = (x: number, y: number): RayLike => ({ origin: [x / 100, 20, y / 100], dir: [0, -1, 0] });
const front = (x: number, y: number): RayLike => ({ origin: [x / 100, -y / 100, 10], dir: [0, 0, -1] });

function surface(w = world(), ray = down, picked: Id | null = null) {
  return createSurface({ world: () => w, ray, pick: () => (picked ? { id: picked, point: [0, 0, 0] } : null), half: () => null, panels: () => new Set(['line']) });
}

describe('surface: roles from affordances', () => {
  it('every usable thing on the bench has a gesture', () => {
    const s = surface();
    const roles = Object.fromEntries(['crate-1', 'fetch', 'revert', 'patch', 'lamp', 'belt-dial', 'belt-lever', 'undo-lever', 'button', 'button-cover', 'cord', 'jack-lamp', 'jack-reserved-1', 'line', 'belt', 'striker'].map((id) => [id, s.role(id)]));
    expect(roles).toEqual({
      'crate-1': 'part',
      fetch: 'part',
      revert: 'none', // down its hatch at the start (mode gone): a hand cannot take it
      patch: 'unit',
      lamp: 'unit',
      'belt-dial': 'dial',
      'belt-lever': 'lever',
      'undo-lever': 'handle',
      button: 'handle',
      'button-cover': 'handle',
      cord: 'plug',
      'jack-lamp': 'jack',
      'jack-reserved-1': 'jack',
      line: 'handle', // the phone: a panel of the page's
      belt: 'mouth',
      striker: 'none',
    });
  });

  it('the controls list: everything usable, grouped by station, the phone in it, no jack and no mouth', () => {
    const list = surface().usable!();
    for (const id of ['belt-dial', 'belt-lever', 'undo-lever', 'button', 'button-cover', 'cord', 'patch', 'lamp', 'line', 'crate-1', 'fetch']) expect(list).toContain(id);
    for (const id of ['belt', 'jack-lamp', 'jack-reserved-1', 'striker']) expect(list).not.toContain(id);
    // grouped: each station's ids are contiguous
    const w = world();
    const stations = list.map((id) => w.interactable(id)?.station);
    const seen = new Set<string | undefined>();
    for (let i = 0; i < stations.length; i++) {
      if (i > 0 && stations[i] !== stations[i - 1]) expect(seen.has(stations[i])).toBe(false);
      seen.add(stations[i]);
    }
  });

  it('readings (the work-round until the world publishes one): the dial at its detent, the lever at its notch', () => {
    const w = world();
    expect(readingFromWorld(w, 'belt-dial')).toEqual({ value: 0.5, detents: 5 });
    expect(readingFromWorld(w, 'belt-lever')).toEqual({ value: 1, detents: 3 });
    expect(readingFromWorld(w, 'button')).toBeNull();
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    w.advance();
    expect(readingFromWorld(w, 'belt-dial')).toEqual({ value: 1, detents: 5 });
    expect(readingFromWorld(w, 'belt-lever')).toEqual({ value: 0.5, detents: 3 });
  });

  it('destinations: mouths for a part, every jack (capped too) for the plug', () => {
    const s = surface();
    expect(s.destinations!('part')).toEqual(['belt', 'dock', 'platen']);
    expect(s.destinations!('plug')).toEqual(bench.cord.jacks.map((j) => j.id));
    expect(s.where!('jack-lamp')).toEqual(bench.cord.jacks.find((j) => j.id === 'jack-lamp')!.at);
  });
});

describe('surface: the plug seats in the nearest jack within reach', () => {
  const at = (id: Id) => bench.cord.jacks.find((j) => j.id === id)!.at;
  const px = (x: number, y: number): [number, number] => [x * 100, -y * 100];

  it('let go near LAMP (not on it): LAMP', () => {
    const s = surface(world(), front);
    const [x, y] = at('jack-lamp');
    expect(s.jackNear!(...px(x + 0.25, y + 0.2), 'mouse')).toBe('jack-lamp');
  });

  it('between two: the nearer; nearest a capped jack: the capped one; out of reach: none', () => {
    const s = surface(world(), front);
    const a = at('jack-platen');
    const b = at('jack-belt');
    expect(s.jackNear!(...px(a[0] + 0.3, a[1]), 'mouse')).toBe('jack-platen');
    expect(s.jackNear!(...px(b[0] - 0.3, b[1]), 'mouse')).toBe('jack-belt');
    const r = at('jack-reserved-1');
    expect(s.jackNear!(...px(r[0] - 0.05, r[1] + 0.1), 'mouse')).toBe('jack-reserved-1');
    expect(s.jackNear!(...px(a[0], a[1] + JACK_REACH + 0.2), 'mouse')).toBeNull();
  });
});

describe('surface: the lamp’s arm has weight', () => {
  it('a held unit that slides rides the bench under the hand on a spring: it lags, then arrives', () => {
    const w0 = world();
    const s = surface(w0, down);
    // the grab names where it points now (no jump of the light), whatever point on the shade the hand took
    const aim0 = (w0.machine('lamp') as unknown as { aim: [number, number, number] }).aim;
    expect(s.gripFor!('lamp', 'unit', [1, 2.5, -2])).toEqual(aim0);
    s.beginCarry('lamp', 'unit', [1, 2.5, -2], 0);
    // the hand jumps to (3, 0); the aim follows over the next frames from where it was
    const a = s.carryTarget(300, 0, 16);
    expect(a[1]).toBe(0);
    expect(a[0]).toBeGreaterThan(aim0[0]);
    expect(a[0]).toBeLessThan(aim0[0] + 0.5);
    let p = a;
    for (let t = 32; t <= 600; t += 16) p = s.carryTarget(300, 0, t);
    expect(p[0]).toBeCloseTo(3, 2);
    expect(p[2]).toBeCloseTo(0, 2);
    s.endCarry();
  });

  it('Patch (held, does not slide) rides a lifted plane like a part', () => {
    const s = surface(world(), down);
    s.beginCarry('patch', 'unit', [5, 1, 0], 0);
    const p = s.carryTarget(500, 100, 16);
    expect(p[1]).toBeGreaterThan(bench.bench.top);
  });
});

describe('the first action ends attract mode; a hover does not', () => {
  it('hover alone leaves attract mode on; the first press ends it once', () => {
    const w = world();
    w.dispatch({ type: 'hover', id: 'belt-dial' });
    w.advance();
    expect(w.playMode).toBe(false);
    expect(w.attract().on).toBe(true);
    w.dispatch({ type: 'press', id: 'belt-dial' });
    w.advance();
    expect(w.playMode).toBe(true);
    expect(w.attract().on).toBe(false);
  });
});
