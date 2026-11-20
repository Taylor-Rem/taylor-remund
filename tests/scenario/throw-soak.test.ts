// R4 (Taylor, 2026-11-19: "i want them to retain their momentum better after you let go, so you can throw boxes and
// Fetch and Patch and stuff. They should still always be able to recover."): the proof that every throw recovers.
//
// On the whole bench (the real crew, the real line) under real Rapier, each seeded session lifts one loose thing
// (a crate, Fetch, Revert), carries it to a point anywhere over the bench, and throws it: in any direction, at any
// speed up to the world's cap, sometimes at Patch, at another part, at the back wall, off an edge, with the Button
// pressed just after the release (the throw lands under a rung). Then, within `SETTLE` seconds:
//   - nothing is NaN; every part is at rest somewhere valid, or on its way back by a known route (the chute, a
//     machine's custody, Fetch's jets);
//   - no part's centre is inside a fixed body or inside another part;
//   - no robot is left off its wheels (Fetch upright on its tape or busy; Revert on its treads or below);
//   - and Fetch is back at work (not held, not mid-flight).
//
// In verify: THROW_SOAK sessions (default 16). The big one: THROW_SOAK=3000 npx vitest run tests/scenario/throw-soak.test.ts
// One seed: THROW_SEED=<n> npx vitest run tests/scenario/throw-soak.test.ts
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Pose, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.THROW_SOAK ?? 16);
const ONLY = process.env.THROW_SEED !== undefined ? Number(process.env.THROW_SEED) : null;
const LOOSE = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'revert'] as const;
/** Seconds after the throw by which the bench is itself again. */
const SETTLE = 14;
const THROWN = { n: 0 };

const finite = (p: Pose): boolean => [...p.p, ...p.q].every(Number.isFinite);
const upOf = (q: readonly number[]): number => 1 - 2 * ((q[0] as number) ** 2 + (q[2] as number) ** 2);
/** `p` in the frame of a box at `pose`: inside it by more than `margin`? */
function insideBox(p: Vec3, pose: Pose, half: readonly number[], margin: number): boolean {
  const [qx, qy, qz, qw] = pose.q;
  // rotate (p - centre) by the conjugate
  const d: Vec3 = [p[0] - pose.p[0], p[1] - pose.p[1], p[2] - pose.p[2]];
  const ix = -qx, iy = -qy, iz = -qz;
  const tx = 2 * (iy * d[2] - iz * d[1]);
  const ty = 2 * (iz * d[0] - ix * d[2]);
  const tz = 2 * (ix * d[1] - iy * d[0]);
  const l: Vec3 = [d[0] + qw * tx + (iy * tz - iz * ty), d[1] + qw * ty + (iz * tx - ix * tz), d[2] + qw * tz + (ix * ty - iy * tx)];
  return Math.abs(l[0]) < (half[0] as number) - margin && Math.abs(l[1]) < (half[1] as number) - margin && Math.abs(l[2]) < (half[2] as number) - margin;
}

interface Throw {
  readonly id: string;
  readonly from: Vec3;
  readonly v: Vec3;
  readonly what: string;
  readonly rung: boolean;
}

function plan(seed: number, w: World): Throw {
  const r = rng(`throw-soak-${seed}`);
  const THROWN_IDS = [...LOOSE, 'patch'];
  const id = THROWN_IDS[r.int(THROWN_IDS.length)] as string;
  const from: Vec3 = [r.range(-7.5, 7.5), r.range(1.0, 2.2), r.range(-3.8, 4.2)];
  const cap = LOOSE_TUNING.throwMax * 1.05; // a little over: the world clamps it
  const k = r.int(10);
  let dir: Vec3;
  let what: string;
  const toward = (t: Vec3): Vec3 => [t[0] - from[0], 0, t[2] - from[2]];
  if (k < 2) {
    const p = (w.crewView('patch') as { view?: { at?: Vec3 } } | undefined)?.view;
    dir = toward(p?.at ?? [3, 0, -2]);
    what = 'at Patch';
  } else if (k < 4) {
    const other = LOOSE[r.int(LOOSE.length)] as string;
    dir = toward(w.motion(other)?.pose.p ?? [0, 0, 0]);
    what = `at ${other}`;
  } else if (k < 5) {
    dir = [r.range(-0.3, 0.3), 0, -1];
    what = 'at the back wall';
  } else if (k < 6) {
    const side = r.int(3);
    dir = side === 0 ? [-1, 0, r.range(-0.3, 0.3)] : side === 1 ? [1, 0, r.range(-0.3, 0.3)] : [r.range(-0.3, 0.3), 0, 1];
    what = 'toward an edge';
  } else {
    const a = r.range(0, Math.PI * 2);
    dir = [Math.cos(a), 0, Math.sin(a)];
    what = 'anywhere';
  }
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const speed = r.range(0.5, cap);
  // the hand's loft: I1 sends 0.18 of the horizontal speed upward, at most 1.6; sometimes a lob, sometimes down
  const up = r.int(5) === 0 ? r.range(-2, 4) : Math.min(1.6, 0.18 * speed);
  return { id, from, v: [(dir[0] / l) * speed, up, (dir[2] / l) * speed], what: `${what} at ${speed.toFixed(1)}`, rung: r.int(6) === 0 };
}

async function session(seed: number): Promise<string[]> {
  const w = await benchWorld(`throw-soak-${seed}`, { scene: FULL_BENCH });
  /** Parts that have come to rest (or been taken into a machine) since the throw: moving later is someone's work (Revert's pan). */
  const rested = new Set<string>();
  const stillRun = new Map<string, number>();
  const calmed = new Set<string>();
  let lateFrom = Infinity;
  let holdRun = 0;
  let holdWorst = 0;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      w.advance();
      for (const e of w.drainEvents()) if (e.type === 'part.rested' || e.type === 'taken-in') rested.add(e.type === 'taken-in' ? e.part : e.id);
      // (R4 follow-up) Fetch standing with one crate in its hands (idle, or at a seat it cannot use)
      const fc = w.crew('fetch');
      holdRun = fc && fc.carrying && (fc.state === 'idle' || fc.state === 'place') ? holdRun + 1 : 0;
      holdWorst = Math.max(holdWorst, holdRun / HZ);
      // still for half a second at a time, counted over the last four seconds of the settle (crew and Revert move things on purpose)
      for (const id of LOOSE) {
        const m = w.motion(id);
        const still = !m || m.mode !== 'free' || Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[1] - m.prev.p[1], m.pose.p[2] - m.prev.p[2]) * HZ < 0.1;
        stillRun.set(id, still ? (stillRun.get(id) ?? 0) + 1 : 0);
        if ((stillRun.get(id) ?? 0) >= HZ / 2 && w.step >= lateFrom) calmed.add(id);
      }
    }
  };
  const fails: string[] = [];
  try {
    run(steps(1));
    const th = plan(seed, w);
    const label = `seed ${seed}: ${th.id} from (${th.from.map((v) => v.toFixed(1)).join(', ')}) ${th.what}${th.rung ? ', Button pressed after' : ''}`;
    const patchAt = (): Vec3 | undefined => (w.crewView('patch') as { view?: { at?: Vec3 } } | undefined)?.view?.at;
    const p0 = th.id === 'patch' ? (() => { const a = patchAt(); return a ? ([a[0], a[1] + 0.5, a[2]] as Vec3) : undefined; })() : w.motion(th.id)?.pose.p;
    if (!p0) return [];
    w.dispatch({ type: 'grab', id: th.id, grip: p0 });
    run(1);
    if (w.holding()?.id !== th.id) return []; // not to hand now (in the dock's door, a rung): nothing to throw
    THROWN.n++;
    for (let i = 0; i < 50; i++) {
      w.dispatch({ type: 'carry', target: th.from });
      run(1);
    }
    w.dispatch({ type: 'release', velocity: th.v });
    rested.clear();
    lateFrom = w.step + steps(SETTLE - 4);
    run(2);
    if (th.rung) w.dispatch({ type: 'press', id: 'button' });
    const TRACE = process.env.THROW_TRACE;
    if (TRACE) {
      for (let k = 0; k < SETTLE * 4; k++) {
        run(HZ / 4);
        const m = w.motion(TRACE)!;
        const f = w.motion('fetch')!.pose.p;
        console.log(`${(k / 4 + 0.25).toFixed(2)} ${TRACE} ${m.mode} ${m.pose.p.map((v) => v.toFixed(2)).join(',')} | fetch ${w.crew('fetch')!.state} ${w.motion('fetch')!.mode} ${f.map((v) => v.toFixed(2)).join(',')} carrying ${w.crew('fetch')!.carrying} | revert ${w.motion('revert')!.pose.p.map((v) => v.toFixed(2)).join(',')}`);
      }
    } else run(steps(SETTLE));
    // the checks
    const statics = w.scene.statics.filter((s) => s.shape.type === 'box');
    for (const id of LOOSE) {
      const m = w.motion(id);
      if (!m) continue;
      const mode = m.mode;
      if (!finite(m.pose)) fails.push(`${label}: ${id} NaN`);
      if (mode === 'held') fails.push(`${label}: ${id} still in the hand`);
      if (mode === 'gone' || mode === 'chute') continue; // shipped, or on its way back up the chute
      const p = m.pose.p;
      if (mode === 'free') {
        const moving = Math.hypot(p[0] - m.prev.p[0], p[1] - m.prev.p[1], p[2] - m.prev.p[2]) * HZ;
        if (moving > 0.3 && !calmed.has(id)) fails.push(`${label}: ${id} still moving (${moving.toFixed(2)} u/s; Fetch ${w.crew('fetch')!.state}, Revert ${(w.machine('revert') as { state?: string } | undefined)?.state ?? JSON.stringify(w.crewView('revert'))?.slice(0, 80)}, belt ${JSON.stringify(w.machine('belt'))?.slice(0, 60)}) at (${p.map((v) => v.toFixed(2)).join(', ')})`);
      }
      for (const s of statics) {
        if (s.id === 'bench') {
          if (p[1] < -0.05 && Math.abs(p[0]) < 9 && Math.abs(p[2]) < 5) fails.push(`${label}: ${id} inside the bench at (${p.map((v) => v.toFixed(2)).join(', ')})`);
          continue;
        }
        if (insideBox(p, s.pose, (s.shape as { half: Vec3 }).half, 0.02)) fails.push(`${label}: ${id} inside ${s.id} (${mode})`);
      }
      for (const o of LOOSE) {
        if (o === id) continue;
        const om = w.motion(o);
        if (!om || om.mode === 'gone' || om.mode === 'chute') continue;
        if (insideBox(p, om.pose, w.halfExtents(o)!, 0.02)) fails.push(`${label}: ${id} inside ${o}`);
      }
    }
    // Patch (its own recovery, the Patch builder's: reported here): back on its stool within a further 30 s, never NaN
    if (th.id === 'patch') {
      const pv = (): { state: string; at: Vec3 } => (w.crewView('patch') as unknown as { view: { state: string; at: Vec3 } }).view;
      for (let i = 0; i < 30 * HZ && pv().state !== 'seated'; i++) run(1);
      const v = pv();
      if (!v.at.every(Number.isFinite)) fails.push(`${label}: Patch NaN`);
      else if (v.state !== 'seated') fails.push(`${label}: Patch not back on its stool after ${SETTLE + 30} s (${v.state} at ${v.at.map((x) => x.toFixed(2)).join(', ')})`);
    }
    // Fetch set (not flung) into a machine that holds it still (the platen's tray) waits there FETCH_TUNING.leaveMachineSet
    // seconds to be painted before it hops off: give it that
    for (let i = 0; i < (FETCH_TUNING.leaveMachineSet + 6) * HZ && w.motion('fetch')!.mode === 'machine' && w.part('fetch')!.location.at === 'in' && (w.part('fetch')!.location as { mouth: string }).mouth === 'platen'; i++) run(1);
    if (w.crew('fetch')!.state === 'jetpack' || w.crew('fetch')!.state === 'shrug') run(steps(4));
    if (holdWorst > 10) fails.push(`${label}: Fetch stood holding a crate for ${holdWorst.toFixed(1)} s`);
    // Fetch: upright and back at work
    const f = w.motion('fetch')!;
    const fs = w.crew('fetch')!.state;
    if (f.mode === 'crew' && upOf(f.pose.q) < 0.95) fails.push(`${label}: Fetch off its wheels (${fs})`);
    const loc = w.part('fetch')!.location;
    const riding = f.mode === 'machine' && loc.at === 'in' && (loc.mouth === 'belt' || loc.mouth === 'dock');
    if (fs === 'held' && f.mode !== 'gone' && f.mode !== 'chute' && !riding) fails.push(`${label}: Fetch not back at work (held, ${f.mode})`);
    if (fs === 'jetpack') fails.push(`${label}: Fetch still on its jets`);
    // Revert: not left lying (its own recovery is S7's; reported here)
    const rv = w.motion('revert');
    if (rv && rv.mode === 'free' && upOf(rv.pose.q) < 0.7) fails.push(`${label}: Revert off its treads`);
  } catch (e) {
    fails.push(`seed ${seed}: threw ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
  } finally {
    w.dispose();
  }
  return fails;
}

test(`every throw recovers: ${ONLY ?? SESSIONS} seeded throw${(ONLY ?? SESSIONS) === 1 ? '' : 's'} on the whole bench`, async () => {
  const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SESSIONS }, (_, i) => i + 1);
  const fails: string[] = [];
  for (const s of seeds) fails.push(...(await session(s)));
  console.log(`thrown: ${THROWN.n} of ${seeds.length}`);
  if (fails.length) console.log(fails.join('\n'));
  expect(fails).toEqual([]);
}, 3_600_000);
