// P3 S1: what a visit remembers (REWRITE.md § E10), read back from a browser's storage as untrusted input.
// `parseSaved` gives back a valid snapshot or null, never throws, and never lets a wrong type or an out-of-range
// number through; a world made from a snapshot begins where the last visit left off, and nothing unknown gets in.
import { describe, expect, test } from 'vitest';
import { FRESH_SAVED, SAVED_MAX_TEXT, SAVED_VERSION, parseSaved, savedText } from '../../../src/workshop/sim/saved.ts';
import type { WorldSaved } from '../../../src/workshop/sim/saved.ts';
import { DECK } from '../../../src/workshop/sim/machines/button.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { run, stubWorld } from './helpers.ts';

/** A real snapshot: the ladder climbed, two cards drawn, four stations used. */
const GOOD: WorldSaved = {
  v: 1,
  button: { rung: 3, reached: 4, presses: 6, cover: 'shut', deck: { left: ['deck-2', 'deck-5', 'deck-1', 'deck-6'], last: 'deck-3' } },
  used: ['belt', 'striker', 'cord', 'line'],
};

/** GOOD with one change, as a plain value (what a hand-edited or hostile store could hold). */
const edit = (f: (s: Record<string, any>) => void): unknown => {
  const s = JSON.parse(JSON.stringify(GOOD)) as Record<string, any>;
  f(s);
  return s;
};

describe('parseSaved: a valid snapshot or null', () => {
  test('a real snapshot, as stored text and as a value, comes back equal (and a fresh object)', () => {
    expect(parseSaved(savedText(GOOD))).toEqual(GOOD);
    const v = JSON.parse(savedText(GOOD)) as unknown;
    const out = parseSaved(v);
    expect(out).toEqual(GOOD);
    expect(out).not.toBe(v);
    expect(out!.used).not.toBe((v as WorldSaved).used);
    expect(parseSaved(savedText(FRESH_SAVED))).toEqual(FRESH_SAVED);
  });

  const BAD: [string, unknown][] = [
    ['nothing', undefined],
    ['null', null],
    ['a number', 42],
    ['true', true],
    ['an array', [GOOD]],
    ['empty text', ''],
    ['not JSON', '{"v":1,'],
    ['truncated', savedText(GOOD).slice(0, 40)],
    ['JSON null', 'null'],
    ['another version', edit((s) => (s.v = 2))],
    ['version 0', edit((s) => (s.v = 0))],
    ['version as text', edit((s) => (s.v = '1'))],
    ['no version', edit((s) => delete s.v)],
    ['no button', edit((s) => delete s.button)],
    ['button an array', edit((s) => (s.button = [1, 2]))],
    ['a rung of 99', edit((s) => (s.button.rung = 99))],
    ['a rung of 5', edit((s) => (s.button.rung = 5))],
    ['a negative rung', edit((s) => (s.button.rung = -1))],
    ['a fractional rung', edit((s) => (s.button.rung = 2.5))],
    ['a rung as text', edit((s) => (s.button.rung = '3'))],
    ['a rung NaN (as null in JSON)', edit((s) => (s.button.rung = null))],
    ['reached 7', edit((s) => (s.button.reached = 7))],
    ['a negative count', edit((s) => (s.button.presses = -3))],
    ['a count past the most', edit((s) => (s.button.presses = 1e7))],
    ['a count of Infinity (text 1e999)', savedText(GOOD).replace('"presses":6', '"presses":1e999')],
    ['a rung above the rung reached', edit((s) => Object.assign(s.button, { rung: 3, reached: 2, presses: 2, cover: 'none', deck: { left: [], last: null } }))],
    ['fewer presses than rungs reached', edit((s) => (s.button.presses = 3))],
    ['below the deck, presses not the rung', edit((s) => Object.assign(s.button, { rung: 2, reached: 2, presses: 5, cover: 'none', deck: { left: [], last: null } }))],
    ['presses but no rung', edit((s) => Object.assign(s.button, { rung: 0, reached: 0, presses: 4, cover: 'none', deck: { left: [], last: null } }))],
    ['a cover before rung 3', edit((s) => Object.assign(s.button, { rung: 2, reached: 2, presses: 2, cover: 'shut', deck: { left: [], last: null } }))],
    ['an unknown cover', edit((s) => (s.button.cover = 'welded'))],
    ['a cover left open (not a remembered state)', edit((s) => (s.button.cover = 'open'))],
    ['no deck', edit((s) => delete s.button.deck)],
    ['a deck before the ladder is climbed', edit((s) => Object.assign(s.button, { rung: 2, reached: 2, presses: 2, cover: 'none', deck: { left: ['deck-1'], last: null } }))],
    ['an unknown card', edit((s) => s.button.deck.left.push('deck-99'))],
    ['a card twice', edit((s) => s.button.deck.left.push('deck-2'))],
    ['the last card also still to draw', edit((s) => (s.button.deck.last = 'deck-2'))],
    ['a last card that is not one', edit((s) => (s.button.deck.last = 7))],
    ['seven cards', edit((s) => (s.button.deck.left = [...DECK.map((c) => c.id), 'deck-1']))],
    ['used not a list', edit((s) => (s.used = 'belt'))],
    ['a used id that is not an id', edit((s) => s.used.push('<img src=x onerror=alert(1)>'))],
    ['a used id that is not text', edit((s) => s.used.push(3))],
    ['a used id twice', edit((s) => s.used.push('belt'))],
    ['an empty id', edit((s) => s.used.push(''))],
    ['an id a kilobyte long', edit((s) => s.used.push('a'.repeat(1024)))],
    ['a used list of 65', edit((s) => (s.used = Array.from({ length: 65 }, (_, i) => `s${i}`)))],
    ['an array a megabyte long', edit((s) => (s.used = Array.from({ length: 1 << 20 }, () => 'belt')))],
    ['stored text past the most', savedText(GOOD) + ' '.repeat(SAVED_MAX_TEXT)],
    ['a megabyte of text', 'x'.repeat(1 << 20)],
  ];
  for (const [what, value] of BAD) {
    test(`null for ${what}`, () => {
      expect(() => parseSaved(value)).not.toThrow();
      expect(parseSaved(value)).toBeNull();
    });
  }

  test('never throws, even for things no storage could hold', () => {
    const hostile: unknown[] = [
      Symbol('x'),
      () => GOOD,
      new Proxy({}, { get: () => { throw new Error('trap'); }, has: () => { throw new Error('trap'); }, getOwnPropertyDescriptor: () => { throw new Error('trap'); } }),
      Object.create(null),
      Object.defineProperty({}, 'v', { get: () => { throw new Error('getter'); }, enumerable: true }),
      JSON.parse('{"__proto__":{"v":1},"v":1}'),
    ];
    for (const h of hostile) {
      expect(() => parseSaved(h)).not.toThrow();
      expect(parseSaved(h)).toBeNull();
    }
  });

  test('a prototype in the stored text reaches nothing', () => {
    const t = savedText(GOOD).replace('{"v":1,', '{"__proto__":{"polluted":true},"v":1,');
    const out = parseSaved(t);
    expect(out).toEqual(GOOD);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  test('extra fields are not read (a later version may add some; this one keeps only its own)', () => {
    const out = parseSaved(edit((s) => Object.assign(s, { layout: [{ id: 'crate-1', p: [0, 0, 0] }], typed: 'hello' })));
    expect(out).toEqual(GOOD);
    expect(Object.keys(out!)).toEqual(['v', 'button', 'used']);
  });

  test('a well-formed id this bench does not know passes the shape check; the world drops it', () => {
    const s = edit((x) => (x.used = ['belt', 'jukebox', 'cord']));
    expect(parseSaved(s)!.used).toEqual(['belt', 'jukebox', 'cord']);
    const { world } = stubWorld(1, { scene: bench, saved: parseSaved(s)! });
    expect(world.button().used).toEqual(['belt', 'cord']);
    expect(world.saved().used).toEqual(['belt', 'cord']);
  });
});

describe('a world from a snapshot (§ E10)', () => {
  test('begins where the last visit left off: the rung, the rung reached, the count, the cover, the deck, what was used', () => {
    const { world } = stubWorld(1, { scene: bench, saved: GOOD });
    const b = world.button();
    expect([b.rung, b.reached, b.presses, b.cover]).toEqual([3, 4, 6, 'shut']);
    expect(b.deck).toEqual(GOOD.button.deck);
    expect(b.used).toEqual(GOOD.used);
    expect(world.saved()).toEqual(GOOD);
    // and its history starts empty
    expect(world.undoStack()).toHaveLength(0);
  });

  test('a fresh world\'s snapshot is the fresh one, version included', () => {
    const { world } = stubWorld(1, { scene: bench });
    expect(world.saved()).toEqual(FRESH_SAVED);
    expect(world.saved().v).toBe(SAVED_VERSION);
    // a plain JSON value: it survives the trip through text exactly
    expect(JSON.parse(JSON.stringify(world.saved()))).toEqual(world.saved());
  });

  test('a value that is not a valid snapshot is ignored, even typed as one', () => {
    const bad = { ...GOOD, button: { ...GOOD.button, rung: 99 } } as WorldSaved;
    const { world } = stubWorld(1, { scene: bench, saved: bad });
    expect(world.saved()).toEqual(FRESH_SAVED);
    expect(world.button().rung).toBe(0);
  });

  test('"Reset the workshop" clears it: after a reset saved() equals a fresh world\'s', () => {
    const { world } = stubWorld(1, { scene: bench, saved: GOOD });
    run(world, 5);
    world.dispatch({ type: 'reset' });
    const ev = run(world, 1);
    expect(world.saved()).toEqual(FRESH_SAVED);
    expect(ev.filter((e) => e.type === 'saved.changed')).toHaveLength(1);
  });

  test('saved.changed: only in a step where the snapshot changed (a press; a station used), never otherwise', () => {
    const { world } = stubWorld(1, { scene: bench });
    let changes = 0;
    let last = savedText(world.saved());
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        const ev = run(world, 1);
        const now = savedText(world.saved());
        const said = ev.filter((e) => e.type === 'saved.changed').length;
        expect(said, `step ${world.step}`).toBe(now === last ? 0 : 1);
        changes += said;
        last = now;
      }
    };
    step(120); // attract mode: nothing the visit would remember changes
    expect(changes).toBe(0);
    world.dispatch({ type: 'press', id: 'button' });
    step(400);
    expect(changes).toBe(1);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    step(10);
    expect(changes).toBe(2);
    expect(world.saved().used).toEqual(['belt']);
  });

  test('where loose parts lie, and anything typed, is not in it', () => {
    const { world } = stubWorld(1, { scene: bench });
    const id = [...world.parts()].find((p) => p.kind === 'crate')!.id;
    world.dispatch({ type: 'grab', id, grip: world.motion(id)!.pose.p });
    run(world, 2);
    world.dispatch({ type: 'release', velocity: [2, 0, 0] });
    run(world, 120);
    world.dispatch({ type: 'text', text: 'my secret words' });
    run(world, 60);
    const text = savedText(world.saved());
    expect(text).not.toMatch(/crate|pose|secret|words/);
    expect(world.saved()).toEqual({ ...FRESH_SAVED, used: world.saved().used });
  });
});
