// The pad after a bounce (2026-11-20). A crate the chute throws onto the pad (a replacement for one shipped, or one
// that went off the bench and comes back up the chute) is Fetch's work only where Fetch takes it: on the pad, by its
// stand. Each seeded session lays one crate on or beside the pad (fresh, or the visitor's: a hand on it let go at once),
// ships a crate down the belt (its replacement comes up the chute) and sends another up the chute (as an edge does),
// then leaves the bench alone and follows both: thrown when, landed where, and whether Fetch took it.
//
// Measured over 200 sessions (2026-11-20). Before: 78 of 200 returns came down beside the pad (thrown there while
// anything lay within the dock's coarse circle round it), and 11 of 200 replacements ended off the pad or out of
// Fetch's reach (thrown past the circle while Revert stood at its sweep by the pad, or onto a neighbour's edge): each
// one not Fetch's work until Revert swept it round again. After (the dock reads the box each crate lands in, a crew
// body on the move takes the circle it turns in, a crate waits in the chute until its landing is free, and Fetch idle
// gives way to Revert waiting for it): none off the pad. A crate that waits is not lost: while one lies on the pad
// that Fetch cannot take, the healing clears it first (longest wait measured: 57 s, with a handled crate on the pad).
//
// In verify: PAD_SESSIONS sessions (default 12). The measurement: PAD_SESSIONS=200 npx vitest run tests/scenario/pad-landing.test.ts
// One session: PAD_SEED=<n> (PAD_TRACE=1 prints its events; PAD_WATCH=<s> watches longer)
import { expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, onBelt, putOn, tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { SimContext, Unit } from '../../src/workshop/sim/context.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.PAD_SESSIONS ?? 12);
const PAD = AT.pad;
const PAD_RADIUS = 0.45;
/** Seconds the bench is left alone after the crate is sent up the chute. */
const WATCH = Number(process.env.PAD_WATCH ?? 40);

/** The bench with the named crates at these places (the rest shipped behind the dock's door), Fetch empty-handed. */
function laidOut(at: Record<string, Vec3>): SceneDesc {
  return {
    ...FULL_BENCH,
    parts: FULL_BENCH.parts.map((p) => {
      if (p.kind !== 'crate') return p;
      const q = at[p.id];
      return q ? { ...p, pose: { p: q, q: [0, 0, 0, 1] as const }, shipped: false } : { ...p, shipped: true };
    }),
    runner: { ...FULL_BENCH.runner, carrying: undefined },
  } as unknown as SceneDesc;
}

/** A stand-in unit that sends a part up the return chute when asked (as an edge would). */
function sender(): { unit: (ctx: SimContext) => Unit; send: (id: Id) => void } {
  let due: Id | null = null;
  return {
    send: (id) => (due = id),
    unit: (ctx) => ({
      id: 'test-sender',
      pre() {
        if (due) ctx.toChute(due, 'system');
        due = null;
      },
    }),
  };
}

type Fate = 'taken' | 'off the pad' | 'gone again' | 'gave up' | 'on the pad, not taken' | 'never thrown';
interface Landing {
  readonly part: Id;
  readonly how: 'replacement' | 'return';
  thrownAt: number;
  rest: Vec3 | null;
  fate: Fate;
}

async function session(seed: number): Promise<{ label: string; landings: Landing[]; neighbour: string }> {
  const r = rng(`pad-landing-${seed}`);
  // the neighbour: crate-1 (an L) on the pad or beside it, up to 1.4 from its middle, any side the bench allows
  let nx = 0;
  let nz = 0;
  for (;;) {
    const a = r.range(0, Math.PI * 2);
    const d = r.int(4) === 0 ? r.range(0, 0.45) : r.range(0.45, 1.4);
    nx = PAD[0] + Math.cos(a) * d;
    nz = PAD[1] + Math.sin(a) * d;
    if (nz < 4.4 && nx > -6.0) break; // (on the bench, short of the deflector row's far slots)
  }
  const handled = r.int(2) === 0;
  const s = sender();
  const w = await benchWorld(`pad-landing-${seed}`, { scene: laidOut({ 'crate-1': [nx, 0.45, nz], 'crate-2': [-0.5, 0.35, 2.6], 'crate-3': [-1.2, 0.3, 0.8] }), units: [s.unit] });
  const t = tape(w);
  startPlay(w);
  if (handled) {
    w.dispatch({ type: 'grab', id: 'crate-1', grip: w.motion('crate-1')!.pose.p });
    t.run(1);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(1);
  }
  putOn(w, t, 'crate-2', onBelt(0.3)); // (it rides to the dock and ships: its replacement comes up the chute)
  const c1 = w.motion('crate-1')!.pose.p;
  const neighbour = `crate-1 ${handled ? 'handled' : 'fresh'} at (${c1[0].toFixed(2)}, ${c1[2].toFixed(2)}), ${Math.hypot(c1[0] - PAD[0], c1[2] - PAD[1]).toFixed(2)} from the pad`;
  const landings: Landing[] = [];
  let replacement: Landing | null = null;
  const ret: Landing = { part: 'crate-3', how: 'return', thrownAt: -1, rest: null, fate: 'never thrown' };
  landings.push(ret);
  s.send('crate-3');
  const start = w.step;
  const took = new Set<Id>();
  const gave = new Set<Id>();
  let shippedAt = -1;
  for (let i = 0; i < steps(WATCH); i++) {
    const ev: SimEvent[] = t.run(1);
    if (process.env.PAD_TRACE) for (const e of ev) if (['restock.launched', 'restocked', 'shipped', 'taken-in', 'crew.gaveUp', 'put-away', 'revert.sweep', 'part.grabbed', 'part.returned'].includes(e.type)) console.log(((w.step - start) / HZ).toFixed(2), JSON.stringify(e).slice(0, 160));
    for (const e of ev) {
      if (e.type === 'shipped' && e.part === 'crate-2' && shippedAt < 0) shippedAt = (w.step - start) / HZ;
      if (e.type === 'restock.launched') {
        const l = e.part === 'crate-3' ? ret : (replacement ??= { part: e.part, how: 'replacement', thrownAt: -1, rest: null, fate: 'never thrown' });
        if (!landings.includes(l)) landings.push(l);
        if (l.thrownAt < 0) l.thrownAt = (w.step - start) / HZ - (l.how === 'replacement' ? Math.max(0, shippedAt) : 0);
      }
      if (e.type === 'crew.gaveUp') gave.add(e.part);
    }
    const fc = w.crew('fetch')!.carrying;
    if (fc) took.add(fc);
  }
  // shipped crate-2 brought no replacement in the watch: it is counted too
  if (!replacement && shippedAt >= 0) landings.push({ part: '(crate-2\'s)', how: 'replacement', thrownAt: -1, rest: null, fate: 'never thrown' });
  for (const l of landings) {
    if (l.thrownAt < 0) continue;
    const m = w.motion(l.part)!;
    l.rest = m.pose.p as Vec3;
    if (took.has(l.part)) l.fate = 'taken';
    else if (gave.has(l.part)) l.fate = 'gave up';
    else if (m.mode === 'gone' || m.mode === 'chute') l.fate = 'gone again';
    else if (Math.hypot(l.rest[0] - PAD[0], l.rest[2] - PAD[1]) > PAD_RADIUS) l.fate = 'off the pad';
    else l.fate = 'on the pad, not taken';
  }
  const rv = w.machine('revert-crew') as unknown as { state: string; waitingFor: Id | null; x: number; z: number };
  const end = `; at the end Revert ${rv.state}${rv.waitingFor ? ` waiting for ${rv.waitingFor}` : ''} at (${rv.x.toFixed(2)}, ${rv.z.toFixed(2)}), Fetch ${w.crew('fetch')!.state}`;
  w.dispose();
  return { label: `seed ${seed}`, landings, neighbour: neighbour + end };
  return { label: `seed ${seed}`, landings, neighbour };
}

test(`the pad: ${SESSIONS} seeded sessions with a crate lying on or beside it; what the chute throws lands where Fetch takes it`, async () => {
  const counts = new Map<string, number>();
  const lines: string[] = [];
  const waits: Record<string, number[]> = { replacement: [], return: [] };
  let n = 0;
  const seeds = process.env.PAD_SEED ? [Number(process.env.PAD_SEED)] : Array.from({ length: SESSIONS }, (_, i) => i + 1);
  for (const s of seeds) {
    const out = await session(s);
    for (const l of out.landings) {
      n++;
      const k = `${l.how}: ${l.fate}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (l.thrownAt >= 0) waits[l.how]!.push(l.thrownAt);
      if (l.fate !== 'taken') lines.push(`${out.label} ${out.neighbour}: ${l.how} ${l.part} ${l.fate}${l.rest ? ` at (${l.rest[0].toFixed(2)}, ${l.rest[2].toFixed(2)})` : ''}${l.thrownAt >= 0 ? `, thrown at ${l.thrownAt.toFixed(1)} s` : ''}`);
    }
  }
  const w = (a: number[]): string => {
    const o = [...a].sort((x, y) => x - y);
    return `${o.length} thrown, after ${o.length ? `${(o[Math.floor(o.length / 2)] ?? 0).toFixed(1)} s median, ${(o[Math.floor(o.length * 0.9)] ?? 0).toFixed(1)} s 90th, ${(o[o.length - 1] ?? 0).toFixed(1)} s most` : '-'}`;
  };
  console.log(`${n} landings over ${SESSIONS} sessions:\n${[...counts].sort().map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n  replacements ${w(waits.replacement!)} (from the ship); returns ${w(waits.return!)} (from the send)\n${lines.join('\n')}`);
  expect(n).toBeGreaterThan(0);
  // what the chute throws ends where Fetch takes it; off its mark is the rare exception the healing catches (one in a hundred)
  const off = [...counts].filter(([k]) => k.endsWith('off the pad') || k.endsWith('gave up')).reduce((a, [, v]) => a + v, 0);
  expect(off, 'landings that end where Fetch cannot take them').toBeLessThanOrEqual(Math.floor(n / 100));
}, 3_600_000);
