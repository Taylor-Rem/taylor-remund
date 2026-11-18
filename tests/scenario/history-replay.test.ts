// REWRITE.md § E5 "What the tests hold": the replay check and the invariants, at every step of
// sequences generated from a seed that mix throws, knocks, catches, texts, the dial, the cord, the
// lever, "undo that", the crew, Revert, the Button and resets; and the full drain.
//
// A failing sequence names its seed. Re-run one alone with HISTORY_SEED=<seed> (and HISTORY_TRACE=1 to see it).
import { describe, expect, test } from 'vitest';
import { BELT, BELT_ZONE, OFF_BENCH, SPEED, bench, catchAndSet, knock, lever, text, throwTo, turn } from './standins/index.ts';
import type { Bench } from './standins/index.ts';
import { checker } from './standins/replay.ts';
import type { Checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import type { Rng } from '../../src/workshop/sim/rng.ts';
import type { Location, Pose, SimEvent } from '../../src/workshop/sim/types.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import { HISTORY_TUNING } from '../../src/workshop/sim/history.ts';
import { AT as V } from '../../src/workshop/sim/scenes/vignette.ts';
import { line } from '../../src/workshop/sim/machines/line.ts';
import { storefront } from '../../src/workshop/sim/machines/storefront.ts';
import { lamp } from '../../src/workshop/sim/machines/lamp.ts';
import { patch } from '../../src/workshop/sim/crew/patch.ts';
import type { UnitFactory } from '../../src/workshop/sim/scene.ts';

const PARTS = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch'] as const;
const JACKS = ['jack-storefront', 'jack-lamp'] as const;
const COLOURS = ['paint-blue', 'cable-red', 'paint-green', 'bare'] as const;
const LABELS = ['', 'TAYLOR', 'HELLO', 'FRAGILE'] as const;

const trace = process.env.HISTORY_TRACE !== undefined;
const only = process.env.HISTORY_SEED !== undefined ? Number(process.env.HISTORY_SEED) : null;
const seeds = (n: number, base: number): number[] => (only !== null ? [only] : Array.from({ length: n }, (_, i) => base + i));

function spot(r: Rng): Pose {
  const roll = r.next();
  if (roll < 0.07) return OFF_BENCH;
  const [x, z] = roll < 0.22 ? [r.range(BELT_ZONE.minX + 0.2, BELT_ZONE.maxX - 0.2), r.range(BELT_ZONE.minZ + 0.2, BELT_ZONE.maxZ - 0.2)] : [r.range(-9, 5), r.range(-4, 4)];
  return { p: [x, 0.45, z], q: qyaw(r.range(-3, 3)) };
}

// The stand-in belt and dock do not move bodies (a part `in` the belt or `shipped` still lies where it
// was taken in), so the visitor only handles parts whose durable location is a rest: the real stations
// own their parts' bodies and put them back through `Unit.restored`.
const onBench = (b: Bench, id: string): boolean => b.world.part(id)!.location.at === 'rest';
const free = (b: Bench): string[] => PARTS.filter((id) => onBench(b, id) && b.world.mode(id) === 'free' && !b.world.motion(id)!.awake);
const moving = (b: Bench): string[] => PARTS.filter((id) => onBench(b, id) && b.world.mode(id) === 'free' && b.world.motion(id)!.awake);
const grabbable = (b: Bench, crew: boolean): string[] => PARTS.filter((id) => (crew || id !== 'fetch') && onBench(b, id) && (b.world.mode(id) === 'free' || b.world.mode(id) === 'crew'));

// (S3) The real Patchlamp station on the stand-ins' bench: the phone line, Patch, the storefront and the lamp
// (the vignette's two jacks; its fixture `lamp` keeps its id, so the lamp machine is `lamp-s3`).
const STATION: readonly UnitFactory[] = [
  line({ id: 'line', station: 'patchlamp', name: 'name.line', cord: 'cord', lines: [{ jack: 'jack-storefront', line: 'storefront', station: 'storefront' }, { jack: 'jack-lamp', line: 'lamp', station: 'lamp-s3' }] }),
  patch({
    id: 'patch', station: 'patchlamp', name: 'name.patch', line: 'line',
    seat: [V.stool.c[0], V.stool.c[1] + V.stool.half[1], V.stool.c[2]], facing: -Math.PI / 2, foot: [V.stool.c[0], 0, V.stool.c[2] + 0.8],
    body: { up: 0.75, radius: 0.6, head: 1.05, hands: 0.35 }, shelf: [V.stool.c[0] - 0.7, 0, V.stool.c[2]], lever: [-3, 1.5, -2], visitor: [0.6, 2.4, 14], phone: V.phone.c,
    jacks: { 'jack-storefront': V.jacks.storefront, 'jack-lamp': V.jacks.lamp }, stations: { storefront: [7, 1, -3.6], 'lamp-s3': [-2, 5.2, -0.6] },
    bench: { minX: V.bench.minX + 0.4, maxX: V.bench.maxX - 0.4, minZ: V.bench.minZ + 0.4, maxZ: V.bench.maxZ - 0.4 },
  }),
  storefront({ id: 'storefront', station: 'patchlamp', name: 'name.storefront' }),
  lamp({ id: 'lamp-s3', station: 'top', name: 'name.lamp', levels: 5, startLevel: 3, home: { bulb: [-2.2, 5.2, -0.6], aim: [2, 0, -0.1] }, reach: { centre: [-3.1, -4.76], min: 1, max: 5, minX: -8, maxX: 3.5, minZ: -4, maxZ: 1.5 }, follow: 0.6 }),
];
const STATION_TEXTS = [
  'make it blue', 'make it red', 'make the sign say HELLO', 'paint the awning violet', "we're closed", 'we are open', 'put a boat in the window', 'change the picture',
  'brighter', 'dimmer', 'lights out', 'lights on', 'back to warm', 'help', 'who are you', 'make the lamp green', 'paint the crate red', 'can taylor call me', 'make it pink',
];

interface Options {
  readonly steps: number;
  /** (S3) Texts, "undo that" and the lamp's arm go to the real Patchlamp station instead of the stand-in Patch. */
  readonly station?: boolean;
  /** The crew, Revert, stray knocks and resets take part (off for the full drain, where the crew is frozen). */
  readonly others: boolean;
  /** Stop acting after this many visitor actions. */
  readonly maxActions?: number;
}

/** One seeded sequence. Returns the bench and its checker; throws, naming the seed and step, on the first violation. */
function sequence(seed: number, o: Options): { b: Bench; chk: Checker; actions: number; start: ReturnType<Bench['world']['durable']> } {
  const r = rng(`history-${seed}`);
  let chk: Checker | null = null;
  const b: Bench = bench(seed, o.station ? { units: STATION } : {}, (ev: readonly SimEvent[]) => {
    // HISTORY_TRACE=1 prints every event and every open window, step by step (with HISTORY_SEED, to read one failure)
    if (trace) {
      const windows = b.world.undoStack().filter((t) => t.moving.length > 0);
      if (windows.length) console.log(b.world.step, 'window', JSON.stringify(windows.map((t) => [t.id, t.moving])));
      for (const e of ev) if (e.type !== 'crew.state' && e.type !== 'part.hit') console.log(b.world.step, JSON.stringify(e));
    }
    chk?.step(ev, b.world.step);
  });
  chk = checker(b.world, { jacks: JACKS, parts: PARTS });
  const start = b.world.durable();
  let actions = 0;
  const act = (): void => {
    const k = r.int(100);
    const visitor = o.maxActions === undefined || actions < o.maxActions;
    if (k < 22 && visitor) {
      // with the crew frozen, Fetch is left alone: picking it up makes it drop its crate, which is the crew's doing
      const g = grabbable(b, o.others);
      if (g.length === 0) return;
      const id = r.pick(g);
      throwTo(b, id, spot(r), 5 + r.int(75));
      actions++;
      // the throw knocks others about: they join its window
      const n = r.chance(0.5) ? r.int(3) : 0;
      for (const other of free(b).slice(0, n)) knock(b, other, spot(r), 5 + r.int(150));
      // a knock is a collision inside a physics step: the world sees it in that step, before any later intent
      if (n > 0) b.run(1);
    } else if (k < 28 && visitor) {
      const m = moving(b).filter((id) => o.others || id !== 'fetch');
      if (m.length === 0) return;
      catchAndSet(b, r.pick(m), [r.range(-9, 9), 0, r.range(-4, 4)]);
      actions++;
    } else if (k < 38 && visitor) {
      if (o.station && r.chance(0.4)) {
        // (S3) the lamp's arm: a drag of a few frames, let go; one transaction
        for (let i = 0, n = 1 + r.int(4); i < n; i++) {
          b.world.dispatch({ type: 'drag', id: 'lamp-s3', target: [r.range(-7, 3), 5.2, r.range(-4, 1.5)], end: i === n - 1 });
          b.run(1);
        }
      } else turn(b, r.int(4));
      actions++;
    } else if (k < 52 && visitor && o.station) {
      b.world.dispatch({ type: 'text', text: r.pick(STATION_TEXTS) });
      b.run(1);
      actions++;
    } else if (k < 52 && visitor) {
      const target = r.pick([...PARTS, BELT]);
      const delay = r.int(150);
      if (target === BELT) text(b, { kind: 'set', target, field: SPEED, value: r.int(4), delay });
      else if (r.chance(0.6)) text(b, { kind: 'set', target, field: 'colour', value: r.pick(COLOURS), delay });
      else text(b, { kind: 'set', target, field: 'label', value: r.pick(LABELS), delay });
      actions++;
    } else if (k < 58 && o.station) {
      b.world.dispatch({ type: 'text', text: 'undo that' });
      b.run(1);
    } else if (k < 58) {
      text(b, { kind: 'undo-that' });
    } else if (k < 70) {
      lever(b);
    } else if (k < 76 && visitor) {
      b.world.dispatch({ type: 'unplug', cord: 'cord' });
      b.world.dispatch({ type: 'plug', cord: 'cord', jack: r.pick(JACKS) });
      b.run(1);
      actions++;
    } else if (k < 78) {
      b.world.dispatch({ type: 'press', id: 'button' });
      b.run(1);
    } else if (!o.others) {
      b.run(1);
    } else if (k < 86) {
      // the crew works for itself: its own robot (allowed), or things rule 5 keeps it from in play mode
      const pick = r.int(4);
      if (pick === 0) b.crew.write([{ target: 'fetch', field: 'colour', after: r.pick(COLOURS) }]);
      else if (pick === 1) b.crew.write([{ target: 'fetch', field: 'location', after: { at: 'rest', pose: spot(r) } }]);
      else if (pick === 2) b.crew.write([{ target: r.pick(PARTS), field: 'colour', after: r.pick(COLOURS) }]);
      else b.crew.write([{ target: BELT, field: SPEED, after: r.int(4) }]);
      b.run(1);
    } else if (k < 92) {
      const f = free(b).filter((id) => id !== 'fetch');
      if (f.length === 0) return;
      const to: Location = { at: 'rest', pose: { p: [r.range(-9, 5), 0.45, r.range(-4.5, -3)], q: qyaw(0) } };
      b.revert.putAway(r.pick(f), to);
      b.run(1);
    } else if (k < 98) {
      const f = free(b);
      if (f.length) knock(b, r.pick(f), spot(r), 5 + r.int(100)); // something else sets a resting part moving
      b.run(1);
    } else if (r.chance(0.2)) {
      b.world.dispatch({ type: 'reset' });
      b.run(1);
    }
  };
  try {
    while (b.world.step < o.steps) {
      if (b.world.bracketed || r.chance(0.82)) b.run(1);
      else act();
    }
  } catch (e) {
    throw new Error(`history sequence seed ${seed} failed at step ${b.world.step}: ${(e as Error).message}\n  re-run alone: HISTORY_SEED=${seed} npx vitest run tests/scenario/history-replay.test.ts`, { cause: e });
  }
  return { b, chk, actions, start };
}

describe('§ E5 the replay check and the invariants, on seeded sequences', () => {
  test('hundreds of sequences, thousands of steps each, everything mixed: replay and invariants hold at every step', () => {
    const total = { steps: 0, undone: 0, refusedUndo: 0, effects: 0, kept: 0, putAway: 0, resets: 0, restores: 0 };
    for (const seed of seeds(200, 1000)) {
      const { chk } = sequence(seed, { steps: 2000, others: true });
      for (const [key, v] of Object.entries(chk.stats)) total[key as keyof typeof total] += v;
    }
    if (only !== null) return;
    // it really exercised the model (not vacuously true)
    expect(total.steps).toBeGreaterThanOrEqual(400_000);
    expect(total.undone).toBeGreaterThan(3000);
    expect(total.restores).toBeGreaterThan(3000);
    expect(total.refusedUndo).toBeGreaterThan(500);
    expect(total.kept).toBeGreaterThan(5);
    expect(total.putAway).toBeGreaterThan(300);
    expect(total.resets).toBeGreaterThan(5);
  });

  test('the full drain: with the crew frozen and fewer actions than the stack holds, pulling the lever until it is empty returns every field to its start, value and writer', () => {
    let drained = 0;
    for (const seed of seeds(200, 5000)) {
      const { b, start } = sequence(seed, { steps: 900, others: false, maxActions: HISTORY_TUNING.depth - 5 });
      while (b.world.bracketed) b.run(1); // a rung still playing: handles do not respond
      let ev: SimEvent[] = [];
      for (let i = 0; i < 2 * HISTORY_TUNING.depth; i++) {
        ev = lever(b);
        if (ev.some((e) => e.type === 'undo.refused' && e.reason === 'nothing') && b.world.undoStack().length === 0) break;
      }
      try {
        expect(b.world.undoStack()).toEqual([]);
        expect(b.world.durable()).toEqual(start);
      } catch (e) {
        throw new Error(`drain seed ${seed}: ${(e as Error).message}\n  re-run alone: HISTORY_SEED=${seed} npx vitest run tests/scenario/history-replay.test.ts`, { cause: e });
      }
      drained++;
    }
    expect(drained).toBe(only !== null ? 1 : 200);
  });
});

describe('§ E5 the replay check and the invariants, with the real Patchlamp station (S3)', () => {
  test('sequences of real texts, "undo that", the lamp\'s arm, the cord, the lever and everything else: replay and invariants hold at every step', () => {
    let undone = 0;
    let changed = 0;
    for (const seed of seeds(60, 9000)) {
      const { b, chk } = sequence(seed, { steps: 2000, others: true, station: true });
      undone += chk.stats.undone;
      changed += b.log.filter((e) => e.type === 'line.reply' && e.reply.some((l) => l.id.startsWith('change.'))).length;
    }
    if (only !== null) return;
    // the station took part: texts went down the line and were answered with a change (this visitor is frantic: most jobs are pulled or taken back)
    expect(changed).toBeGreaterThan(20);
    expect(undone).toBeGreaterThan(300);
  });

  test('the full drain with the real station: the lever empties the stack and every field is back at its start', () => {
    for (const seed of seeds(60, 12000)) {
      const { b, start } = sequence(seed, { steps: 900, others: false, maxActions: HISTORY_TUNING.depth - 5, station: true });
      while (b.world.bracketed) b.run(1);
      for (let i = 0; i < 2 * HISTORY_TUNING.depth && b.world.undoStack().length > 0; i++) lever(b);
      lever(b);
      try {
        expect(b.world.undoStack()).toEqual([]);
        expect(b.world.durable()).toEqual(start);
      } catch (e) {
        throw new Error(`station drain seed ${seed}: ${(e as Error).message}\n  re-run alone: HISTORY_SEED=${seed} npx vitest run tests/scenario/history-replay.test.ts`, { cause: e });
      }
    }
  });
});
