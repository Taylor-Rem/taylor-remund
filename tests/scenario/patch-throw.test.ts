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
  /** The most steps running its sphere was inside a loose part or a robot's body in the air (one: the step of contact). */
  overlap: number;
  overlapAt: string;
}

/** Loose parts Patch knocked in its flight (from its events). */
// (S5 R4: and Fetch knocked by it: Fetch's slide drops the crate in its hands, as a crate's hit does, charged to the
// throw's transaction like a knocked crate)
const knocked = (t: Tape): string[] => [
  ...t.of('patch.throw').filter((x) => x.e.phase === 'hit' && x.e.what !== undefined && /^(crate|tool)/.test(x.e.what)).map((x) => x.e.what as string),
  ...t.of('crew.knocked').filter((x) => x.e.by === 'patch').map((x) => x.e.id),
];

/** Until it is back on its stool (or `limit` s), watching the flight. */
function watch(w: World, t: Tape, limit: number): Flight {
  const f: Flight = { states: [], inside: 0, insideAt: '', overlap: 0, overlapAt: '' };
  const run = new Map<string, number>();
  for (let i = 0; i < limit * HZ; i++) {
    t.run(1);
    const v = patchView(w);
    if (f.states[f.states.length - 1] !== v.state) f.states.push(v.state);
    if (v.state === 'fly') {
      // a loose part or a robot: never inside it for more than the step it is met
      for (const part of w.parts()) {
        const id = part.id;
        const m = w.motion(id);
        const h = w.halfExtents(id);
        if (!m || !h) continue;
        // inside: more than halfway into its sphere (its box, near enough: the parts sit upright)
        const box = { id, x: m.pose.p[0], z: m.pose.p[2], hx: h[0], hz: h[2], yaw: 0, y0: m.pose.p[1] - h[1], y1: m.pose.p[1] + h[1] };
        const inside = sphereMeets(box, v.at[0], v.at[1], v.at[2], T.bodyR * 0.5);
        // (while a Button rung plays Patch is held where it is and the world rewinds round it: not counted)
        const n = inside ? (run.get(id) ?? 0) + (w.bracketed ? 0 : 1) : 0;
        run.set(id, n);
        if (n > f.overlap) {
          f.overlap = n;
          f.overlapAt = `${id} at ${v.at.map((x) => x.toFixed(2)).join(',')}`;
        }
      }
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
  test('it can be thrown at least as hard as a part (it is light and soft)', () => {
    expect(T.throwMax).toBeGreaterThanOrEqual(LOOSE_TUNING.throwMax);
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
    // nothing durable changed, unless it knocked a crate on the way (then that is one transaction, the throw's)
    if (knocked(t).length === 0) {
      expect(w.durable()).toEqual(before);
      expect(w.undoStack()).toEqual([]);
    } else expect(w.undoStack().length).toBe(1);
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
    throwFrom(w, t, [7, 1.4, 4.6], [0, 0, 3]); // (clear of the belt and the ramp: its middle 0.8 up as it crosses the edge)
    const f = watch(w, t, 30);
    expect(f.states.slice(0, 2)).toEqual(['fly', 'ledge']);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('thrown at the stack of crates: it knocks them (one at least goes more than half a unit), all come to rest in a valid place, charged to the throw', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    const at0 = new Map([...w.parts()].map((p) => [p.id, w.motion(p.id)!.pose.p]));
    throwFrom(w, t, [-1.5, 2.1, 1.75], [9, 0, 0]);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
    expect(knocked(t).length).toBeGreaterThan(0);
    t.run(5 * 60);
    const moved = [...w.parts()].filter((p) => p.kind === 'crate').map((p) => Math.hypot(w.motion(p.id)!.pose.p[0] - at0.get(p.id)![0], w.motion(p.id)!.pose.p[2] - at0.get(p.id)![2]));
    expect(Math.max(...moved)).toBeGreaterThan(0.5);
    for (const p of w.parts()) {
      if (p.kind !== 'crate') continue;
      const loc = w.durable().find((d) => d.target === p.id && d.field === 'location');
      expect(loc, p.id).toBeTruthy();
      const where = (loc!.value as { at: string }).at;
      expect(['rest', 'in', 'on', 'shipped'], `${p.id} ${JSON.stringify(loc!.value)}`).toContain(where);
      if (where === 'rest') expect(w.motion(p.id)!.pose.p[1]).toBeGreaterThan(-0.01); // on the bench (or a machine), not under it
    }
    // charged to one transaction: the throw's
    expect(w.undoStack().length).toBe(1);
    expect(f.overlap, f.overlapAt).toBeLessThanOrEqual(1);
  }, 60_000);

  test('thrown at Fetch: it stops against it and drops beside it, never inside its body; the event names Fetch', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    const fc = w.crewView('fetch')!;
    const body = fc.kind === 'fetch' ? fc.body : '';
    const fp = w.motion(body)!.pose.p;
    throwFrom(w, t, [fp[0] - 3, 2.2, fp[2]], [9, 0, 0]);
    // the stack as it stands after each step of the flight
    const stackAt = new Map<number, string[]>();
    // (until the hit, then the flight is watched from there; the steps before it are the arc out of the hand)
    for (let i = 0; i < 90 && !t.of('patch.throw').some((x) => x.e.phase === 'hit' && x.e.what === body); i++) {
      t.run(1);
      stackAt.set(w.step - 1, w.undoStack().map((x) => x.id));
      stackAt.set(w.step, w.undoStack().map((x) => x.id));
    }
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
    const hit = t.of('patch.throw').find((x) => x.e.phase === 'hit' && x.e.what === body);
    expect(hit).toBeTruthy();
    // § E5: the hit belongs to the throw: it carries the throw's transaction, and that is on the stack then
    const txn = hit!.e.txn;
    expect(txn).toMatch(/^t\d+$/);
    expect(stackAt.get(hit!.step)).toContain(txn);
    expect(f.overlap, f.overlapAt).toBeLessThanOrEqual(1);
  }, 60_000);

  test('the wall: met flat it sticks a moment, slides down it and sits', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-5, 3.2, 1], [0, 0, -9]);
    const seen: string[] = [];
    let stuckAt: number[] | null = null;
    for (let i = 0; i < 4 * 60; i++) {
      t.run(1);
      const v = patchView(w);
      if (seen.at(-1) !== v.state) seen.push(v.state);
      if (v.state === 'wall' && v.stateTime < 0.2) stuckAt = stuckAt ?? [...v.at];
      if (v.state === 'wall' && v.stateTime > 0 && v.stateTime < T.stick - 0.02) expect(v.at).toEqual(stuckAt);
    }
    expect(seen.slice(0, 3)).toEqual(['fly', 'wall', 'land']);
    expect(t.of('patch.throw').some((x) => x.e.phase === 'hit' && x.e.wall === true)).toBe(true);
    const f = watch(w, t, 30);
    expect(f.states.at(-1)).toBe('seated');
  }, 60_000);

  test('the sound of a throw: thrown, landed (and gone and back up the chute off the bench), each with its speed', async () => {
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [2, 3.5, 4], [0, 0, 12]);
    watch(w, t, 30);
    const phases = t.of('patch.throw').map((x) => x.e.phase);
    expect(phases.slice(0, 2)).toEqual(['thrown', 'gone']);
    expect(phases).toContain('chute');
    expect(phases).toContain('landed');
    expect(t.of('patch.throw').every((x) => Number.isFinite(x.e.speed))).toBe(true);
  }, 60_000);

  test('from the carry in the open back lane: it carries on as far as the throw was hard (and a set-down stays put)', async () => {
    const far = async (speed: number): Promise<number> => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      throwFrom(w, t, [-6.5, 0.95, -1.5], [speed, 0, 0]);
      for (let i = 0; i < 4 * 60 && !['shake', 'look', 'walk'].includes(patchView(w).state); i++) t.run(1);
      const v = patchView(w);
      return Math.hypot(v.at[0] + 6.5, v.at[2] + 1.5);
    };
    const cap = await far(14), mid = await far(8), soft = await far(4);
    expect(cap).toBeGreaterThanOrEqual(9);
    expect(cap).toBeLessThanOrEqual(11);
    expect(mid).toBeGreaterThanOrEqual(4);
    expect(mid).toBeLessThanOrEqual(5);
    expect(soft).toBeGreaterThanOrEqual(1);
    expect(soft).toBeLessThanOrEqual(2);
    if (process.env.PATCH_THROW_LOG) console.log('lane', cap.toFixed(2), mid.toFixed(2), soft.toFixed(2));
    const w = await benchWorld(1);
    const t = tape(w);
    t.run(20);
    throwFrom(w, t, [-6.5, 0.95, -1.5], [0, 0, 0]);
    expect(patchView(w).state).not.toBe('fly');
  }, 60_000);

  test('let go touching Fetch, the phone, the console or the stack: no pop (never more than half a unit above the hand)', async () => {
    const places: [string, (w: World) => Vec3][] = [
      ['fetch', (w) => { const c = w.crewView('fetch')!; const p = w.motion(c.kind === 'fetch' ? c.body : '')!.pose.p; return [p[0] - 0.4, 0.95, p[2]]; }],
      ['phone', () => [0.2, 0.95, 1.9]],
      ['console', () => [-0.6, 0.95, 1.3]],
      ['stack', () => [2.21 - 0.55, 0.95, 1.75]],
    ];
    for (const [name, at] of places) {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const hand = at(w);
      throwFrom(w, t, hand, [6, 0, 0]);
      const v = patchView(w);
      expect(v.at[1], name).toBeLessThanOrEqual(hand[1] + 0.5);
      watch(w, t, 30);
      expect(patchView(w).state, name).toBe('seated');
    }
  }, 120_000);

  // R4 fault (I1's crew test): taken off its stool the carry presses Patch to the back wall; let go there with the
  // hand moving away from the wall, it must fly. Through the intent path, as the page does it: lifted, carried to the
  // body and held there, then let go with the hand's velocity.
  describe('let go touching a body: away or along it flies, into it is the hit', () => {
    // (`side`: along the face, the way that is open; the back wall's case is I1's own: the hand front-left)
    const places: { name: string; hand: Vec3; away: [number, number]; side: number }[] = [
      { name: 'the back wall by the stool', hand: [2.75, 1.2, -4.42], away: [0, 1], side: -1 },
      { name: "the console's back", hand: [-0.6, 1.2, -0.58], away: [0, -1], side: 1 },
      { name: "the storefront's front", hand: [6.0, 1.2, -2.66], away: [0, 1], side: -1 },
    ];
    for (const pl of places) {
      const [ax, az] = pl.away;
      const sx = pl.side;
      const cases: { what: string; v: Vec3; fly: boolean; min: number }[] = [
        { what: 'away and to the side at 12', v: [sx * 8.6 * Math.abs(az) + ax * 8.9, 0, az * 8.9 + sx * 8.6 * Math.abs(ax)], fly: true, min: 2.5 },
        { what: 'straight away at 14', v: [ax * 14, 0, az * 14], fly: true, min: 2.5 },
        // (along the back wall, the way the board's end is not: toward the storefront)
        { what: 'along it at 8', v: [(pl.name.startsWith('the back') ? 1 : sx) * 8 * Math.abs(az), 0, sx * 8 * Math.abs(ax)], fly: true, min: 1.5 },
        { what: 'into it at 6', v: [-ax * 6, 0, -az * 6], fly: false, min: 0 },
      ];
      for (const c of cases) {
        test(`${pl.name}: ${c.what}`, async () => {
          const w = await benchWorld(1);
          const t = tape(w);
          t.run(20);
          const s = patchView(w).at;
          // lifted off the stool, carried to the body and held against it (a pause, then the flick's own few carries)
          w.dispatch({ type: 'drag', id: 'patch', target: [s[0], 2.4, s[2]] });
          t.run(1);
          for (let i = 1; i <= 40; i++) {
            w.dispatch({ type: 'drag', id: 'patch', target: [s[0] + ((pl.hand[0] - s[0]) * i) / 40, 2.4 + ((pl.hand[1] - 2.4) * i) / 40, s[2] + ((pl.hand[2] - s[2]) * i) / 40] });
            t.run(1);
          }
          t.run(20);
          w.dispatch({ type: 'drag', id: 'patch', target: pl.hand, end: true, velocity: c.v });
          // where it comes to rest (the first frame of the shake), then home
          let rest: Vec3 | null = null;
          for (let i = 0; i < 6 * 60 && !rest; i++) {
            t.run(1);
            const v = patchView(w);
            if (v.state === 'shake') rest = [...v.at] as Vec3;
          }
          watch(w, t, 40);
          const all = t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state);
          const states = all.join('>');
          if (c.fly) {
            expect(all, states).toContain('fly');
            expect(rest, states).not.toBeNull();
            // as far as the throw was hard, unless something stood in its way (then it met it: a hit)
            const hitSomething = t.of('patch.throw').some((x) => x.e.phase === 'hit');
            if (!hitSomething) expect(Math.hypot(rest![0] - pl.hand[0], rest![2] - pl.hand[2]), states).toBeGreaterThan(c.min);
          } else {
            // the wall gag, there (at most a step or two of flight first, when it was held a hair off the face)
            expect(all, states).toContain('wall');
            const flew = t.of('crew.state').filter((x) => x.e.id === 'patch');
            const f0 = flew.find((x) => x.e.state === 'fly'), w0 = flew.find((x) => x.e.state === 'wall');
            if (f0 && w0) expect(w0.step - f0.step, states).toBeLessThanOrEqual(6);
          }
          expect(patchView(w).state, states).toBe('seated');
        }, 60_000);
      }
    }
  });

  // I1's two failing records: held against the back wall, the hand sweeping -x along it at y 1.2 and let go
  // front-left at 12 u/s at x 2.52 (its middle at the board's end) and at x 2.3 (its middle in the board's desk)
  for (const x of [2.52, 2.3]) {
    test(`I1's record: let go at x ${x} over the board's end, the hand front-left at 12: it flies`, async () => {
      const w = await benchWorld(1);
      const t = tape(w);
      t.run(20);
      const s = patchView(w).at;
      w.dispatch({ type: 'drag', id: 'patch', target: [s[0], 2.4, s[2]] });
      t.run(1);
      for (let i = 1; i <= 30; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: [s[0] + ((3.37 - s[0]) * i) / 30, 2.4 + ((1.39 - 2.4) * i) / 30, s[2] + ((-4.42 - s[2]) * i) / 30] });
        t.run(1);
      }
      for (let i = 1; i <= 6; i++) {
        w.dispatch({ type: 'drag', id: 'patch', target: [3.37 + ((x - 3.37) * i) / 6, 1.39 - (0.24 * i) / 6, -4.42] });
        t.run(1);
      }
      w.dispatch({ type: 'drag', id: 'patch', target: [x, 1.15, -4.42], end: true, velocity: [-8.5, 0, 8.8] });
      t.run(1);
      const first = patchView(w);
      expect(first.state).toBe('fly');
      expect(first.at[1]).toBeLessThanOrEqual(1.15 + 0.5);
      const f = watch(w, t, 40);
      const all = t.of('crew.state').filter((e) => e.e.id === 'patch').map((e) => e.e.state);
      expect(all, all.join('>')).not.toContain('wall');
      expect(f.states.at(-1)).toBe('seated');
    }, 60_000);
  }

  test('a hundred seeded throws: every one ends on the stool, the job carried on, nothing durable changed by it', async () => {
    const r = rng(Number(process.env.PATCH_THROW_SEED ?? 20261119));
    const log: string[] = [];
    for (let k = 0; k < 100; k++) {
      const from: Vec3 = [-8 + r() * 16, 1.2 + r() * 2.6, -3.5 + r() * 8];
      const a = r() * Math.PI * 2;
      const sp = r() * 16; // past the cap too: it is clamped
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
      else if (kind !== 3 && knocked(t).length === 0) expect(w.durable(), line).toEqual(before);
      // (S5 R4) it knocked a crate, or Fetch (which drops what it carries): all of it is the throw's, one transaction
      else if (kind !== 3) expect(w.undoStack().length, line).toBe(1);
      expect(f.overlap, `${line} ${f.overlapAt}`).toBeLessThanOrEqual(1);
    }
    if (process.env.PATCH_THROW_LOG) console.log(log.join('\n'));
  }, 600_000);
});
