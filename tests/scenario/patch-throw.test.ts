// R4: Patch can be thrown. Let go with the hand moving, it flies a scripted arc (never a physics body), never
// through a fixed body; it lands clear, rolls, sits up, shakes its head, gives the look and walks home; over an
// open edge within reach it catches the ledge; well clear it is gone and comes back up the chute by the pad. A
// hundred seeded throws (any place, direction and speed to the cap; some while it holds a job, some with the
// Button pressed meanwhile) all end with Patch on its stool, the job carried on, nothing durable changed by it.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, answer, patchView, send } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PatchState, Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';
import { solidsOf, sphereMeets } from '../../src/workshop/sim/crew/patch-route.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';

const T = PATCH_TUNING;
const SOLIDS = solidsOf(bench);

/** Lift Patch, carry it to `from` (held: the hand there), and let go with the hand moving at `v`. */
function throwFrom(w: World, t: Tape, from: Vec3, v: Vec3): void {
  const s = patchView(w).at;
  const a: Vec3 = [s[0], 3, s[2] + 0.6];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: [a[0] + ((from[0] - a[0]) * i) / n, a[1] + ((from[1] - a[1]) * i) / n, a[2] + ((from[2] - a[2]) * i) / n] });
    t.run(1);
  }
  w.dispatch({ type: 'drag', id: 'patch', target: from, end: true, velocity: v });
  t.run(1);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Flight {
  states: PatchState[];
  /** The deepest it went into a fixed body in the air (0: never). */
  inside: number;
  insideAt: string;
}

/** Until it is back on its stool (or `limit` s), watching the flight. */
function watch(w: World, t: Tape, limit: number): Flight {
  const f: Flight = { states: [], inside: 0, insideAt: '' };
  for (let i = 0; i < limit * HZ; i++) {
    t.run(1);
    const v = patchView(w);
    if (f.states[f.states.length - 1] !== v.state) f.states.push(v.state);
    if (v.state === 'fly') {
      for (const o of SOLIDS)
        if (sphereMeets(o, v.at[0], v.at[1], v.at[2], T.bodyR * 0.8)) {
          f.inside = Math.max(f.inside, 1);
          f.insideAt = `${o.id} at ${v.at.map((x) => x.toFixed(2)).join(',')}`;
        }
    }
    if (v.state === 'seated' && f.states.length > 1) break;
  }
  return f;
}

describe('Patch thrown (R4)', () => {
  test('its cap is the parts\' cap', () => {
    expect(T.throwMax).toBe(LOOSE_TUNING.throwMax);
  });

  test('a throw across the bench: it flies, lands clear, rolls, sits up, shakes its head, gives the look and walks home', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    const before = w.durable();
    t.run(20);
    throwFrom(w, t, [4, 2.8, 2], [-6, 1, -0.5]);
    expect(patchView(w).state).toBe('fly');
    const f = watch(w, t, 30);
    expect(f.states.slice(0, 5)).toEqual(['fly', 'land', 'shake', 'look', 'walk']);
    expect(f.states.at(-1)).toBe('seated');
    expect(f.inside, f.insideAt).toBe(0);
    expect(w.durable()).toEqual(before);
    expect(w.undoStack()).toEqual([]);
  }, 60_000);

  test('against the back wall: it stops there and drops, never through it', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-5, 3, 0], [0, 1, -7.5]);
    let minZ = Infinity;
    for (let i = 0; i < 3 * HZ; i++) {
      t.run(1);
      const v = patchView(w);
      if (v.state === 'fly') minZ = Math.min(minZ, v.at[2]);
    }
    expect(minZ).toBeGreaterThan(-5 + T.bodyR * 0.8);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('off the front, hard and high: gone, then back up the chute by the pad, and home', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [2, 3.5, 4], [0, 1.6, 7.5]);
    const f = watch(w, t, 40);
    expect(f.states).toContain('away');
    const i = f.states.indexOf('away');
    expect(f.states.slice(i, i + 3)).toEqual(['away', 'fly', 'land']);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('off the front, low: it catches the ledge as when let go there', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [2, 0.9, 4.2], [0, 0, 3]);
    const f = watch(w, t, 30);
    expect(f.states.slice(0, 2)).toEqual(['fly', 'ledge']);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('a hundred seeded throws: every one ends on the stool, the job carried on, nothing durable changed by it', async () => {
    const r = rng(20261119);
    const log: string[] = [];
    for (let k = 0; k < 100; k++) {
      const from: Vec3 = [-8 + r() * 16, 1.2 + r() * 2.6, -3.5 + r() * 8];
      const a = r() * Math.PI * 2;
      const sp = r() * 9; // past the cap too: it is clamped
      const v: Vec3 = [Math.sin(a) * sp, Math.min(1.6, 0.18 * sp) * r(), Math.cos(a) * sp];
      const kind = k % 4; // 0, 1: plain; 2: while it holds a job; 3: the Button pressed in the air
      const w = await benchWorld(k + 1);
      const t = tape(w);
      t.run(20);
      const before = w.durable();
      const job = kind === 2 ? send(w, t, 'make the sign red') : null;
      if (job !== null) for (let i = 0; i < 3 * HZ && patchView(w).state !== 'drawer'; i++) t.run(1);
      throwFrom(w, t, from, v);
      if (kind === 3) {
        w.dispatch({ type: 'press', id: 'button' });
        t.run(1);
      }
      const f = watch(w, t, 60);
      const line = `${k}: from ${from.map((x) => x.toFixed(1))} v ${v.map((x) => x.toFixed(1))} kind ${kind}: ${f.states.join('>')}`;
      log.push(line);
      expect(patchView(w).state, line).toBe('seated');
      expect(patchView(w).at, line).toEqual(PATCHLAMP.patch.seat.map((x, i) => (i === 0 ? x + (patchView(w).stool.x - patchView(w).stool.rest) : x)));
      expect(f.inside, `${line} ${f.insideAt}`).toBe(0);
      if (job !== null) expect(answer(t, job, 30).e.type, line).toBe('line.reply');
      else if (kind !== 3) expect(w.durable(), line).toEqual(before);
    }
    if (process.env.PATCH_THROW_LOG) console.log(log.join('\n'));
  }, 600_000);
});
