// Pitch is never lost (P4 P1a; sim/crew/pitch.ts): seeded sessions on the whole bench with him on it, under real
// Rapier, the crew at work and the belt and the striker running (Fetch feeds the belt in play mode). Each session waits
// a while (he may be out on his round), then does from one to five of these, in any order: takes him and throws him
// (any way, any strength to past the world's cap, lobbed, down, straight up, let go still), juggles him (caught in the
// air and thrown again), pokes him, sets him on the platen's tray (and paints him there by text, through the PLATEN
// jack), at the dock's door or on the belt from the keys, throws a crate at him wherever he is, pulls the lever, resets
// the workshop, presses the Button while he is loose. Then nothing at all.
//
// Must hold:
//   - at every step: his middle a number; his heading a number; his body in the world exactly when his state says it
//     is (held, sail, tray), out of it otherwise; scripted, his middle never inside a fixed body;
//   - 20 s after the last input he is at his mast (moored, his middle at the cup, his nose the mast's way, his body out
//     of the world), and nothing is in the hand;
//   - his own durable fields change only by the platen (colour, label; his body's location `in` the tray) and by
//     himself (that location back to out of the world, as `crew`).
// It prints the coverage and how long he took to be home after the last input (median, 95th, slowest).
//
// In verify: PITCH_SOAK sessions (default 16). The big one (under soak.lock):
//   PITCH_SOAK=1000 VITEST_MAX_WORKERS=4 npx vitest run tests/scenario/pitch-soak.test.ts --silent=false
// One seed: PITCH_SEED=<n> (with PITCH_TRACE=1 for his states).
import { expect, test } from 'vitest';
import { PITCHED, BODY, home, pitchOf, fmt, LENS } from './pitch-helpers.ts';
import { benchWorld, tape } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import type { Rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.PITCH_SOAK ?? 16);
const FROM = Number(process.env.PITCH_SOAK_FROM ?? 1);
const ONLY = process.env.PITCH_SEED !== undefined ? Number(process.env.PITCH_SEED) : null;
const TRACE = !!process.env.PITCH_TRACE;
/** Seconds after the last input by which he must be at his mast. */
const AFTER = 20;

const COVER: Record<string, number> = {};
const cover = (k: string): void => {
  COVER[k] = (COVER[k] ?? 0) + 1;
};
const HOME_TIMES: number[] = [];
const ROUNDS = { flown: 0 };

const BOXES = PITCHED.statics.flatMap((s) => (s.shape.type === 'box' ? [{ id: s.id, c: s.pose.p, half: s.shape.half, q: s.pose.q }] : []));
function insideFixed(p: Vec3): string | null {
  for (const b of BOXES) {
    if (b.id === 'back-wall' || b.id === 'bench') continue;
    // (yawed boxes: into their frame about +Y)
    const yaw = Math.atan2(2 * (b.q[3] * b.q[1]), 1 - 2 * b.q[1] * b.q[1]);
    const dx = p[0] - b.c[0], dz = p[2] - b.c[2];
    const lx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const lz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    if (Math.abs(lx) < b.half[0] && Math.abs(p[1] - b.c[1]) < b.half[1] && Math.abs(lz) < b.half[2]) return b.id;
  }
  return null;
}

interface Ctx {
  w: World;
  r: Rng;
  run(n: number): void;
  input(): void;
  fails: string[];
}

/** Take hold of him (wherever and however he is), carry him to `to`, and hold there `hold` steps. False if he cannot be taken now. */
function take(c: Ctx, to: Vec3, hold = 30): boolean {
  const { w } = c;
  const v = pitchOf(w);
  const m = w.motion(BODY);
  const at = m && m.mode !== 'gone' ? m.pose.p : v.at;
  w.dispatch({ type: 'grab', id: 'pitch', grip: [at[0], at[1] + 0.25, at[2]] });
  c.input();
  c.run(1);
  if (w.holding()?.id !== 'pitch') return false;
  const n = 40;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    w.dispatch({ type: 'carry', target: [at[0] + (to[0] - at[0]) * k, at[1] + (to[1] - at[1]) * k, at[2] + (to[2] - at[2]) * k] });
    c.input();
    c.run(1);
  }
  for (let i = 0; i < hold; i++) {
    w.dispatch({ type: 'carry', target: to });
    c.input();
    c.run(1);
  }
  return true;
}

/** The hand moves at `v` for `n` steps and lets go (the page's way: the throw is what he was doing). */
function throwFrom(c: Ctx, from: Vec3, v: Vec3, n = 10): void {
  let hand = from;
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, (i + 1) / 3) / HZ;
    hand = [hand[0] + v[0] * k, hand[1] + v[1] * k, hand[2] + v[2] * k];
    c.w.dispatch({ type: 'carry', target: hand });
    c.input();
    c.run(1);
  }
  c.w.dispatch({ type: 'release', lens: LENS });
  c.input();
  c.run(1);
}

const anywhere = (r: Rng): Vec3 => [r.range(-8, 8), r.int(4) === 0 ? r.range(3, 7) : r.range(1.0, 2.8), r.range(-3.8, 4.6)];
const way = (r: Rng): Vec3 => {
  const u = r.int(10);
  const a = r.range(0, Math.PI * 2);
  const s = r.range(1, 22);
  if (u === 0) return [0, 0, 0];
  if (u === 1) return [r.range(-1, 1), r.range(8, 18), r.range(-1, 1)];
  if (u === 2) return [Math.cos(a) * s, r.range(-12, -2), Math.sin(a) * s];
  return [Math.cos(a) * s, r.range(-2, 6), Math.sin(a) * s];
};

const ACTIONS: Record<string, (c: Ctx) => void> = {
  throw(c) {
    const from = anywhere(c.r);
    if (!take(c, from)) return cover('throw: not to hand');
    const v = way(c.r);
    cover(Math.hypot(v[0], v[1], v[2]) < 0.1 ? 'let go still' : Math.hypot(v[0], v[2]) > 14 ? 'thrown past the cap' : 'thrown');
    throwFrom(c, from, v);
    if (c.r.int(4) === 0) {
      // juggled: caught in the air and thrown again
      c.run(steps(c.r.range(0.1, 1.2)));
      if (pitchOf(c.w).state === 'sail' && take(c, anywhere(c.r), 5)) {
        cover('juggled');
        throwFrom(c, pitchOf(c.w).at, way(c.r));
      }
    }
  },
  poke(c) {
    const v = pitchOf(c.w);
    const at = c.w.motion(BODY)?.mode !== 'gone' ? c.w.motion(BODY)!.pose.p : v.at;
    c.w.dispatch({ type: 'grab', id: 'pitch', grip: [at[0], at[1] + 0.25, at[2]] });
    c.input();
    c.run(c.r.range(2, 40) | 0);
    c.w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    c.input();
    c.run(1);
    cover(pitchOf(c.w).state === 'poked' ? 'poked' : 'poke: let go instead');
  },
  tray(c) {
    if (!take(c, [3.2, 1.6, 0.8], 5)) return cover('tray: not to hand');
    c.w.dispatch({ type: 'place', at: 'platen' });
    c.input();
    c.run(30);
    if (pitchOf(c.w).state !== 'tray') return cover('tray: not taken (the tray was full)');
    cover('on the tray');
    if (c.r.int(2) === 0) {
      // painted, by text through the PLATEN jack
      c.w.dispatch({ type: 'unplug', cord: 'cord' });
      c.input();
      c.run(1);
      c.w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-platen' });
      c.input();
      c.run(2);
      c.w.dispatch({ type: 'text', text: c.r.pick(['make it blue', 'paint it red', 'make it green']) });
      c.input();
      c.run(steps(4));
      if (c.w.part(BODY)?.colour !== 'bare') cover('painted on the tray');
    }
  },
  door(c) {
    if (!take(c, [5.2, 1.4, 3.3], 5)) return cover('door: not to hand');
    c.w.dispatch({ type: 'place', at: 'dock' });
    c.input();
    c.run(steps(1.5));
    cover(pitchOf(c.w).state === 'door' ? 'backed out of the door' : 'door: went home');
  },
  belt(c) {
    if (!take(c, [-1, 1.4, 3.8], 5)) return cover('belt: not to hand');
    c.w.dispatch({ type: 'place', at: 'belt' });
    c.input();
    c.run(steps(1));
    cover('set on the belt');
  },
  crate(c) {
    // a crate thrown at him, wherever he is
    const ids: Id[] = ['crate-3', 'crate-4', 'crate-1', 'crate-2'].filter((id) => c.w.motion(id)?.mode === 'free');
    if (ids.length === 0) return cover('crate: none free');
    const id = c.r.pick(ids);
    const p = c.w.motion(id)!.pose.p;
    c.w.dispatch({ type: 'grab', id, grip: p });
    c.input();
    c.run(1);
    if (c.w.holding()?.id !== id) return cover('crate: not to hand');
    const him = pitchOf(c.w).at;
    const from: Vec3 = [him[0] + c.r.range(-2.5, 2.5), Math.max(0.6, him[1] + c.r.range(-0.6, 0.6)), him[2] + c.r.range(1.0, 2.5)];
    for (let i = 0; i < 40; i++) {
      c.w.dispatch({ type: 'carry', target: from });
      c.input();
      c.run(1);
    }
    const him2 = pitchOf(c.w).at;
    const d: Vec3 = [him2[0] - from[0], him2[1] - from[1], him2[2] - from[2]];
    const l = Math.hypot(...d) || 1;
    const s = c.r.range(6, 14);
    c.w.dispatch({ type: 'release', velocity: [(d[0] / l) * s, (d[1] / l) * s + 1, (d[2] / l) * s] });
    c.input();
    let bumped = false;
    for (let i = 0; i < steps(1); i++) {
      c.run(1);
      if (pitchOf(c.w).ruffled?.how === 'bumped') bumped = true;
    }
    cover(bumped ? 'bumped by a thrown crate' : 'crate: missed him');
  },
  lever(c) {
    c.w.dispatch({ type: 'undo' });
    c.input();
    c.run(steps(c.r.range(0.2, 1.5)));
    cover('the lever');
  },
  reset(c) {
    c.w.dispatch({ type: 'reset' });
    c.input();
    c.run(steps(0.5));
    cover('reset');
  },
  button(c) {
    // the Button while he is loose (or not): the rung rewinds whatever moved
    c.w.dispatch({ type: 'press', id: 'button' });
    c.input();
    cover(pitchOf(c.w).state === 'sail' ? 'the Button while he sailed' : 'the Button');
    c.run(steps(c.r.range(0.2, 2)));
  },
};
const NAMES = Object.keys(ACTIONS);

async function session(seed: number): Promise<{ fails: string[]; homeAfter: number | null; label: string }> {
  const r = rng(`pitch-soak-${seed}`);
  const w = await benchWorld(`pitch-soak-${seed}`, { scene: PITCHED });
  const t = tape(w);
  const fails: string[] = [];
  let lastInput = 0;
  let wasRound = false;
  let traceState = '';
  const check = (): void => {
    const v = pitchOf(w);
    if (!v.at.every(Number.isFinite) || !Number.isFinite(v.heading)) fails.push(`step ${w.step}: not a number (${v.state})`);
    const m = w.mode(BODY);
    const embodied = v.state === 'held' || v.state === 'sail' || v.state === 'tray';
    if (!w.bracketed && embodied !== (m !== 'gone')) fails.push(`step ${w.step}: state ${v.state} with his body ${m}`);
    if (!embodied && !w.bracketed) {
      const inside = insideFixed(v.at);
      if (inside) fails.push(`step ${w.step}: scripted (${v.state}) inside ${inside} at ${fmt(v.at)}`);
    }
    if (v.leg === 'round' && !wasRound) ROUNDS.flown++;
    wasRound = v.leg === 'round';
  };
  const c: Ctx = {
    w,
    r,
    fails,
    run(n) {
      for (let i = 0; i < n; i++) {
        t.run(1);
        check();
        if (TRACE && (w.step % 30 === 0 || pitchOf(w).state !== traceState)) console.log(`${(w.step / HZ).toFixed(2)} ${pitchOf(w).state} ${fmt(pitchOf(w).at)} ${w.mode(BODY)} idle ${((w.step - lastInput) / HZ).toFixed(1)}`);
        if (TRACE && pitchOf(w).state === 'sail' && traceState !== 'sail') for (const p of w.parts()) { const m = w.motion(p.id)!; if (m.mode !== 'gone' && Math.hypot(m.pose.p[0] - pitchOf(w).at[0], m.pose.p[2] - pitchOf(w).at[2]) < 2.5) console.log('  near', p.id, m.mode, fmt(m.pose.p)); }
        traceState = pitchOf(w).state;
      }
    },
    input() {
      lastInput = w.step;
    },
  };
  const plan: string[] = [];
  try {
    c.run(steps(r.range(0.5, 30)));
    const n = 1 + r.int(5);
    for (let i = 0; i < n; i++) {
      const a = r.pick(NAMES);
      plan.push(a);
      ACTIONS[a]!(c);
      c.run(steps(r.range(0, 3)));
    }
    // a Button rung must be over before the quiet starts counting for the world (it plays on its own)
    while (w.bracketed) c.run(1);
    if (w.holding() !== null) {
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      c.input();
      c.run(1);
    }
    let homeAt: number | null = null;
    while (w.step - lastInput < steps(AFTER)) {
      c.run(1);
      if (homeAt === null && home(w)) homeAt = w.step;
      if (homeAt !== null && !home(w) && pitchOf(w).leg !== 'round') homeAt = null;
    }
    if (!home(w)) fails.push(`not at his mast ${AFTER} s after the last input: ${pitchOf(w).state} at ${fmt(pitchOf(w).at)}, body ${w.mode(BODY)}`);
    if (w.holding() !== null) fails.push('something still in the hand');
    const after = homeAt === null ? null : (homeAt - lastInput) / HZ;
    if (after !== null) HOME_TIMES.push(after);
    return { fails, homeAfter: after, label: `seed ${seed}: ${plan.join(', ')}` };
  } catch (e) {
    fails.push(`threw: ${(e as Error).stack ?? e}`);
    return { fails, homeAfter: null, label: `seed ${seed}: ${plan.join(', ')}` };
  } finally {
    w.dispose();
  }
}

test(`Pitch soak: ${SESSIONS} sessions, at his mast ${AFTER} s after the last input`, async () => {
  const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SESSIONS }, (_, i) => FROM + i);
  const bad: string[] = [];
  const slow: { s: number; label: string }[] = [];
  for (const seed of seeds) {
    const o = await session(seed);
    if (o.fails.length) bad.push(`${o.label}\n    ${o.fails.slice(0, 4).join('\n    ')}`);
    if (o.homeAfter !== null) slow.push({ s: o.homeAfter, label: o.label });
  }
  const ts = [...HOME_TIMES].sort((a, b) => a - b);
  const q = (k: number): string => (ts.length ? ts[Math.min(ts.length - 1, Math.floor(k * ts.length))]!.toFixed(1) : '-');
  console.log(`pitch soak: ${seeds.length} sessions, ${seeds.length - bad.length} at his mast ${AFTER} s after the last input; home after the last input: median ${q(0.5)} s, 95th ${q(0.95)} s, slowest ${ts.length ? ts.at(-1)!.toFixed(1) : '-'} s; rounds flown ${ROUNDS.flown}`);
  console.log(`coverage: ${Object.entries(COVER).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`slowest: ${slow.sort((a, b) => b.s - a.s).slice(0, 5).map((x) => `${x.s.toFixed(1)} s (${x.label})`).join('; ')}`);
  expect(bad, bad.join('\n')).toEqual([]);
}, 120_000 + SESSIONS * 4_000);
