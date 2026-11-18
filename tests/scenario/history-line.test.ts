// REWRITE.md § E5 "What the tests hold", over sequences that include the REAL belt, striker, dock and
// chute on the bench scene: the replay check and the invariants at every step, and the full drain.
// Stub physics (scripted rests), so every sequence is exact. Re-run one: LINE_SEED=<seed>.
import { describe, expect, test } from 'vitest';
import { createStubPhysics } from '../../src/workshop/sim/physics/stub.ts';
import type { StubPhysics } from '../../src/workshop/sim/physics/stub.ts';
import { createWorld } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import { bench as BENCH, LINE } from '../../src/workshop/sim/scenes/bench.ts';
import { HISTORY_TUNING } from '../../src/workshop/sim/history.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import type { Rng } from '../../src/workshop/sim/rng.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import type { Id, Location, Pose, SimEvent } from '../../src/workshop/sim/types.ts';
import { crewStandin, patchStandin, revertStandin, PHONE } from './standins/index.ts';
import type { Crew, Patch, Revert, Text } from './standins/index.ts';
import { checker } from './standins/replay.ts';
import type { Checker } from './standins/replay.ts';
import { roundsBench } from './fetch-helpers.ts';
import { rideWatch } from './rides.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';

const PARTS = BENCH.parts.map((p) => p.id);
const VISIBLE = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch'] as const;
const JACKS = BENCH.cord.jacks.map((j) => j.id);
const only = process.env.LINE_SEED !== undefined ? Number(process.env.LINE_SEED) : null;
const seeds = (n: number, base: number): number[] => (only !== null ? [only] : Array.from({ length: n }, (_, i) => base + i));

interface Line {
  readonly world: World;
  readonly physics: StubPhysics;
  readonly patch: Patch;
  readonly crew: Crew;
  readonly revert: Revert;
  run(n: number): SimEvent[];
}

function line(seed: number, observe: (ev: readonly SimEvent[]) => void, scene: SceneDesc = BENCH): Line {
  const b = scene.bench;
  const physics = createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } });
  const made: Partial<{ patch: Patch; crew: Crew; revert: Revert }> = {};
  const world = createWorld({ seed, physics, scene, units: [(c) => (made.patch = patchStandin(c)), (c) => (made.crew = crewStandin(c)), (c) => (made.revert = revertStandin(c))] });
  return {
    world,
    physics,
    patch: made.patch as Patch,
    crew: made.crew as Crew,
    revert: made.revert as Revert,
    run(n) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) {
        world.advance();
        const ev = world.drainEvents();
        observe(ev);
        out.push(...ev);
      }
      return out;
    },
  };
}

/** Where a thrown part lands: on the belt, on the dock's ramp, off the bench, or on the bench. */
function spot(r: Rng, w: World, id: Id): Pose {
  const h = w.halfExtents(id)![1];
  const roll = r.next();
  if (roll < 0.06) return { p: [11.5, -3, 0], q: qyaw(0) };
  if (roll < 0.36) return { p: [r.range(LINE.belt.from + 0.5, LINE.belt.to - 0.2), LINE.belt.top + h, LINE.belt.z + r.range(-0.3, 0.3)], q: qyaw(r.range(-0.4, 0.4)) };
  if (roll < 0.44) return { p: [r.range(LINE.belt.to + 0.2, LINE.door.sill[0] - 0.3), LINE.belt.top + h, LINE.belt.z], q: qyaw(0) };
  return { p: [r.range(-8, 3), h, r.range(-3.5, 1.2)], q: qyaw(r.range(-3, 3)) };
}

/**
 * S5, Fetch's rounds under the stub physics: the stub has no belt to land on (its floor is the bench top
 * everywhere), so a crate Fetch lets go of over the belt is scripted onto the belt's surface, as a real one
 * falls the last hair onto it. Rule 5 is watched at every step: Fetch never takes hold of a part the visitor
 * has touched, and the crew never writes one.
 */
function fetchWatch(b: () => Line, stats: Record<string, number>): (ev: readonly SimEvent[]) => void {
  const modes = new Map<Id, string>();
  let carrying: Id | null = null;
  return (ev) => {
    const w = b().world;
    const now = w.crew('fetch')!.carrying;
    if (now !== null && now !== carrying) {
      if (w.touched(now)) throw new Error(`rule 5: Fetch took hold of ${now}, which the visitor touched`);
      stats['fetchTook'] = (stats['fetchTook'] ?? 0) + 1;
    }
    carrying = now;
    for (const e of ev) {
      if (e.type === 'effect' && e.effect.cause === 'crew' && e.effect.target !== 'fetch' && w.touched(e.effect.target) && w.writer(e.effect.target, e.effect.field) === 'crew') throw new Error(`rule 5: the crew wrote ${e.effect.target}.${e.effect.field}, which the visitor touched`);
      if (e.type === 'crew.state' && e.id === 'fetch' && e.state === 'place') stats['fetchPlaced'] = (stats['fetchPlaced'] ?? 0) + 1;
    }
    for (const p of w.parts()) {
      const m = w.mode(p.id) ?? '';
      const was = modes.get(p.id);
      modes.set(p.id, m);
      if (was !== 'crew' || m !== 'free' || p.id === 'fetch') continue;
      const pos = w.motion(p.id)!.pose;
      if (pos.p[0] < LINE.belt.from || pos.p[0] > LINE.belt.to || Math.abs(pos.p[2] - LINE.belt.z) > LINE.belt.halfWidth) continue;
      b().physics.land(p.id, { p: [pos.p[0], LINE.belt.top + w.halfExtents(p.id)![1], pos.p[2]], q: pos.q }, 3);
    }
  };
}

function sequence(seed: number, o: { steps: number; others: boolean; maxActions?: number; rounds?: boolean }): { b: Line; chk: Checker; start: ReturnType<World['durable']>; stats: Record<string, number> } {
  const r = rng(`line-${seed}`);
  let chk: Checker | null = null;
  const stats: Record<string, number> = { shipped: 0, struck: 0, returnedDoor: 0, returnedChute: 0, restocked: 0, takenIn: 0 };
  const watchFetch = o.rounds ? fetchWatch(() => b, stats) : null;
  const rides = rideWatch();
  const b = line(seed, (ev) => {
    watchFetch?.(ev);
    rides(ev, b.world.step);
    for (const e of ev) {
      if (e.type === 'shipped') stats['shipped']!++;
      if (e.type === 'struck') stats['struck']!++;
      if (e.type === 'returned') stats[e.how === 'door' ? 'returnedDoor' : 'returnedChute']!++;
      if (e.type === 'restocked') stats['restocked']!++;
      if (e.type === 'taken-in') stats['takenIn']!++;
    }
    chk?.step(ev, b.world.step);
  }, o.rounds ? roundsBench() : BENCH);
  chk = checker(b.world, { jacks: JACKS, parts: PARTS });
  const start = b.world.durable();
  const w = b.world;
  let actions = 0;
  const grabbable = (crew: boolean): Id[] => VISIBLE.filter((id) => (crew || id !== 'fetch') && ['free', 'crew', 'machine'].includes(w.mode(id) ?? ''));
  const act = (): void => {
    const k = r.int(100);
    const visitor = o.maxActions === undefined || actions < o.maxActions;
    if (k < 30 && visitor) {
      const g = grabbable(o.others && (!o.rounds || r.chance(0.1))); // with the rounds, Fetch is picked up now and then, not every few seconds
      if (!g.length) return;
      const id = r.pick(g);
      const m = w.motion(id)!;
      w.dispatch({ type: 'grab', id, grip: m.pose.p });
      w.dispatch({ type: 'carry', target: [m.pose.p[0], m.pose.p[1] + 0.5, m.pose.p[2]] });
      b.run(1);
      b.physics.land(id, spot(r, w, id), 5 + r.int(60));
      w.dispatch({ type: 'release', velocity: [3, 1, 0] });
      b.run(1);
      actions++;
    } else if (k < 40 && visitor) {
      const handle = r.pick(['belt-dial', 'belt-lever']);
      // with Fetch's rounds, the lever mostly goes back to forward (it feeds only a belt running forward)
      w.dispatch({ type: 'turn', id: handle, value: o.rounds && handle === 'belt-lever' && r.chance(0.75) ? 1 : r.next() });
      b.run(1);
      actions++;
    } else if (k < 46 && visitor) {
      w.dispatch({ type: 'press', id: r.pick(['belt-dial', 'belt-lever']) });
      b.run(1);
      actions++;
    } else if (k < 54 && visitor) {
      const t: Text = r.chance(0.5)
        ? { kind: 'set', target: 'belt', field: 'speed', value: 1 + r.int(5), delay: r.int(150) }
        : { kind: 'set', target: r.pick(VISIBLE), field: 'colour', value: r.pick(['paint-blue', 'cable-red', 'bare']), delay: r.int(150) };
      b.patch.send(t);
      w.dispatch({ type: 'press', id: PHONE });
      b.run(1);
      actions++;
    } else if (k < 58) {
      b.patch.send({ kind: 'undo-that' });
      w.dispatch({ type: 'press', id: PHONE });
      b.run(1);
    } else if (k < 72) {
      w.dispatch({ type: 'undo' });
      b.run(1);
    } else if (k < 75) {
      w.dispatch({ type: 'press', id: 'button' });
      b.run(1);
    } else if (!o.others) {
      b.run(1);
    } else if (k < 82) {
      const pick = r.int(3);
      if (pick === 0) b.crew.write([{ target: 'fetch', field: 'colour', after: r.pick(['paint-blue', 'bare']) }]);
      else if (pick === 1) b.crew.write([{ target: r.pick(VISIBLE), field: 'label', after: 'HELLO' }]);
      else b.crew.write([{ target: 'belt', field: 'speed', after: 1 + r.int(5) }]);
      b.run(1);
    } else if (k < 84) {
      const f = VISIBLE.filter((id) => id !== 'fetch' && w.mode(id) === 'free' && w.part(id)!.location.at === 'rest');
      if (!f.length) return;
      const to: Location = { at: 'rest', pose: { p: [r.range(-8, 3), 0.4, r.range(-4.5, -3)], q: qyaw(0) } };
      b.revert.putAway(r.pick(f), to);
      b.run(1);
    } else if (r.chance(0.05)) {
      w.dispatch({ type: 'reset' });
      b.run(1);
    }
  };
  try {
    while (w.step < o.steps) {
      if (w.bracketed || r.chance(0.85)) b.run(1);
      else act();
    }
  } catch (e) {
    throw new Error(`line sequence seed ${seed} failed at step ${w.step}: ${(e as Error).message}\n  re-run alone: LINE_SEED=${seed} npx vitest run tests/scenario/history-line.test.ts`, { cause: e });
  }
  return { b, chk, start, stats };
}

describe('§ E5 on the real line: the replay check and the invariants, with the belt, the striker and the dock', () => {
  test('seeded sequences of throws onto the belt and the ramp, handles, texts, the lever, "undo that", the crew, Revert, the Button and resets', () => {
    const total: Record<string, number> = {};
    for (const seed of seeds(60, 100)) {
      const { chk, stats } = sequence(seed, { steps: 3000, others: true });
      for (const [k, v] of [...Object.entries(chk.stats), ...Object.entries(stats)]) total[k] = (total[k] ?? 0) + v;
    }
    if (only !== null) return;
    console.log('line replay:', JSON.stringify(total));
    // it really exercised the line, and undid it
    expect(total['shipped']).toBeGreaterThan(25);
    expect(total['struck']).toBeGreaterThan(25);
    expect(total['returnedDoor']).toBeGreaterThan(8);
    expect(total['returnedChute']).toBeGreaterThan(0);
    expect(total['restocked']).toBeGreaterThan(15);
    expect(total['undone']).toBeGreaterThan(300);
  }, 120_000);

  test('S5, Fetch\'s rounds running (the stack in its reach): the replay check and the invariants hold, and Fetch never takes or writes a part the visitor touched (rule 5)', () => {
    const total: Record<string, number> = {};
    for (const seed of seeds(40, 300)) {
      const { chk, stats } = sequence(seed, { steps: 3000, others: true, rounds: true });
      for (const [k, v] of [...Object.entries(chk.stats), ...Object.entries(stats)]) total[k] = (total[k] ?? 0) + v;
    }
    if (only !== null) return;
    console.log('line replay with rounds:', JSON.stringify(total));
    // the rounds really ran beside the visitor
    expect(total['fetchTook']).toBeGreaterThan(40);
    expect(total['fetchPlaced']).toBeGreaterThan(30);
    expect(total['undone']).toBeGreaterThan(150);
  }, 120_000);

  test('the full drain on the line: the crew frozen, fewer actions than the stack holds; the lever until empty gives back the start', () => {
    for (const seed of seeds(60, 7000)) {
      const { b, start } = sequence(seed, { steps: 1500, others: false, maxActions: HISTORY_TUNING.depth - 5 });
      while (b.world.bracketed) b.run(1);
      // let pending work finish or stand (the belt keeps carrying; what ships ships)
      for (let i = 0; i < 2 * HISTORY_TUNING.depth; i++) {
        b.world.dispatch({ type: 'undo' });
        const ev = b.run(1);
        if (ev.some((e) => e.type === 'undo.refused' && e.reason === 'nothing') && b.world.undoStack().length === 0) break;
      }
      try {
        expect(b.world.undoStack()).toEqual([]);
        // every field the visitor caused is back; what the system did on its own (restocking a spare,
        // a part that rested as `system` after a window closed) is not the visitor's to take back
        const now = new Map(b.world.durable().map((d) => [`${d.target}.${d.field}`, d]));
        for (const s of start) {
          const d = now.get(`${s.target}.${s.field}`)!;
          if (d.writer === 'system' || d.writer === 'crew') continue;
          expect(d, `${s.target}.${s.field}`).toEqual(s);
        }
      } catch (e) {
        throw new Error(`drain seed ${seed}: ${(e as Error).message}\n  re-run alone: LINE_SEED=${seed} npx vitest run tests/scenario/history-line.test.ts`, { cause: e });
      }
    }
  }, 120_000);
});
