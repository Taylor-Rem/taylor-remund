// R3 follow-up: the three robots' routes against each other while the bench heals. Twenty seeded sessions on the
// whole bench under Rapier: crates strewn by the visitor until Fetch has nothing it may carry, Fetch on its
// rounds, Patch set down somewhere and walking home, while Revert sweeps, carries and drops. Revert never
// overlaps Fetch or Patch, neither of them walks through Revert, and nobody stops for good: the belt is fed again.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH, AT } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, PatchView, RevertView, Vec3 } from '../../src/workshop/sim/types.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2'];
// verify runs 6; the full twenty: TRAFFIC=20 npx vitest run tests/scenario/heal-traffic.test.ts
const SESSIONS = Number(process.env.TRAFFIC ?? 6);
/** Patch's footprint on the bench (patch-route's own radius is about this). */
const PATCH_R = 0.4;
const REVERT_HOME = [-4.832, 0.372] as const;

type Box = { x: number; z: number; hx: number; hz: number; h: number };
/** Two boxes on the bench top overlap by more than `slack` (separating axes). */
function overlap(a: Box, b: Box, slack = 0.02): boolean {
  const ax = [[Math.cos(a.h), -Math.sin(a.h)], [Math.sin(a.h), Math.cos(a.h)]];
  const bx = [[Math.cos(b.h), -Math.sin(b.h)], [Math.sin(b.h), Math.cos(b.h)]];
  for (const n of [...ax, ...bx]) {
    const pa = Math.abs(ax[0]![0]! * n[0]! + ax[0]![1]! * n[1]!) * a.hx + Math.abs(ax[1]![0]! * n[0]! + ax[1]![1]! * n[1]!) * a.hz;
    const pb = Math.abs(bx[0]![0]! * n[0]! + bx[0]![1]! * n[1]!) * b.hx + Math.abs(bx[1]![0]! * n[0]! + bx[1]![1]! * n[1]!) * b.hz;
    if (Math.abs((b.x - a.x) * n[0]! + (b.z - a.z) * n[1]!) >= pa + pb - slack) return false;
  }
  return true;
}
const yaw = (q: readonly number[]): number => 2 * Math.atan2(q[1]!, q[3]!);
/** Patch's footprint is round: does a circle of radius `r` at (x, z) reach into the box by more than `slack`? */
function touchesRound(b: Box, x: number, z: number, r: number, slack = 0.02): boolean {
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(b.h), s = Math.sin(b.h);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - b.hx), ez = Math.max(0, Math.abs(lz) - b.hz);
  return Math.hypot(ex, ez) < r - slack;
}

function revertBox(w: World): Box | null {
  const r = w.machine('revert-crew') as RevertView;
  if (!r.drawn || r.lift < 0.95) return null;
  const h = w.halfExtents('revert')!;
  return { x: r.x, z: r.z, hx: h[0], hz: h[2], h: r.heading };
}
function fetchBox(w: World): Box | null {
  const m = w.motion('fetch');
  const h = w.halfExtents('fetch');
  if (!m || !h || m.mode === 'gone' || m.mode === 'chute' || m.pose.p[1] > h[1] + 0.3) return null;
  return { x: m.pose.p[0], z: m.pose.p[2], hx: h[0], hz: h[2], h: yaw(m.pose.q) };
}
function patchBox(w: World): Box | null {
  const p = w.machine('patch') as PatchView;
  // on the bench top (walking, crossing, standing): not on its stool, not in the hand
  if (!['walk', 'look', 'stare', 'climb'].includes(p.state) || p.at[1] > 0.3) return null;
  return { x: p.at[0], z: p.at[2], hx: PATCH_R, hz: PATCH_R, h: 0 };
}

async function session(seed: number, patchAt?: Vec3, crateAt?: (r: ReturnType<typeof rng>) => Vec3): Promise<{ fed: number | null; overlaps: string[]; heals: number; swept: Id[]; padCrate: Id | null }> {
  const r = rng(`traffic-${seed}`);
  const w = await benchWorld(`traffic-${seed}`, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(20));
  // the visitor strews every crate it can take, until none is fresh (as in bench-runs-dry)
  for (let k = 0; k < 16; k++) {
    const fresh = CRATES.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest' && !w.touched(id));
    const busy = CRATES.some((id) => ['machine', 'chute', 'crew'].includes(w.mode(id) ?? ''));
    if (!fresh.length && !busy && k > 2) break;
    for (const id of fresh) {
      const to: Vec3 = crateAt ? crateAt(r) : [r.range(-8.3, 8.3), 0, r.range(-4.3, 4.4)];
      putOn(w, t, id, to);
      t.run(steps(0.5));
    }
    t.run(steps(4));
  }
  // Patch, lifted off its stool and set down somewhere on the bench (on Revert's way: once it carries a crate home)
  if (patchAt) for (let i = 0; i < steps(120) && !(w.machine('revert-crew') as RevertView).carrying; i++) t.run(1);
  const at: Vec3 = patchAt ?? [r.range(-7, 6), 0.4, r.range(-2.5, 1.5)];
  w.dispatch({ type: 'grab', id: 'patch', grip: (w.machine('patch') as PatchView).at });
  for (let i = 1; i <= 30; i++) {
    w.dispatch({ type: 'carry', target: [at[0], 2.5 - (2 * i) / 30, at[2]] });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  const overlaps: string[] = [];
  let fed: number | null = null;
  let heals = 0;
  const swept: Id[] = [];
  const padCrate = CRATES.find((id) => {
    const q = w.motion(id)?.pose.p;
    return !!q && w.mode(id) === 'free' && w.touched(id) && Math.hypot(q[0] - AT.pad[0], q[2] - AT.pad[1]) < 0.45;
  }) ?? null;
  for (let i = 0; i < steps(Number(process.env.TRAFFIC_SECS ?? 150)); i++) {
    for (const e of t.run(1)) {
      if (e.type === 'taken-in' && e.id === 'belt' && fed === null) fed = i / HZ;
      if (e.type === 'revert.sweep' && e.to.at === 'rest') {
        if (process.env.TRAFFIC_DBG) process.stderr.write(`\nSWEEP ${(i / HZ).toFixed(1)}s ${e.part} from ${e.from.p.map((v) => v.toFixed(2))} revert at ${(w.machine('revert-crew') as RevertView).x.toFixed(2)},${(w.machine('revert-crew') as RevertView).z.toFixed(2)} h ${(w.machine('revert-crew') as RevertView).heading.toFixed(2)} fetch ${w.motion('fetch')!.pose.p.map((v) => v.toFixed(2))} ${w.crew('fetch')?.state}`);
        heals++;
        swept.push(e.part);
      }
    }
    if (process.env.TRAFFIC_DBG && (i % 120 === 0 || (i > 1900 && i < 2150 && i % 6 === 0))) {
      const rv = w.machine('revert-crew') as RevertView;
      process.stderr.write(`\n  ${(i / HZ).toFixed(0)}s revert ${rv.state} @${rv.x.toFixed(2)},${rv.z.toFixed(2)} h${rv.heading.toFixed(2)} carrying ${rv.carrying} wait ${rv.waitingFor} | fetch ${w.crew('fetch')?.state} @${w.motion('fetch')!.pose.p.map((v) => v.toFixed(1)).join(',')} | patch ${(w.machine('patch') as PatchView).state}`);
    }
    const rb = revertBox(w);
    if (!rb) continue;
    const fb = fetchBox(w);
    const pb = patchBox(w);
    if (fb && overlap(rb, fb)) overlaps.push(`${(i / HZ).toFixed(1)}s Revert/Fetch at ${rb.x.toFixed(2)},${rb.z.toFixed(2)} (${(w.machine('revert-crew') as RevertView).state}) / ${fb.x.toFixed(2)},${fb.z.toFixed(2)} (${w.crew('fetch')?.state})`);
    // (the first second and a half after the visitor lets go of Patch: it may be dropped against Revert; they part at once)
    if (pb && touchesRound(rb, pb.x, pb.z, PATCH_R) && i >= steps(1.5)) overlaps.push(`${(i / HZ).toFixed(1)}s Revert/Patch at ${rb.x.toFixed(2)},${rb.z.toFixed(2)} (${(w.machine('revert-crew') as RevertView).state}) / ${pb.x.toFixed(2)},${pb.z.toFixed(2)} (${(w.machine('patch') as PatchView).state})`);
  }
  if (process.env.TRAFFIC_DBG) process.stderr.write(`\nseed ${seed} end: ${CRATES.map((id) => `${id} ${w.part(id)!.location.at}/${w.mode(id)}${w.touched(id) ? '*' : ''}@${w.motion(id)!.pose.p.map((v) => v.toFixed(1)).join(',')}`).join(' | ')} revert ${(w.machine('revert-crew') as RevertView).state} fetch ${JSON.stringify(w.crew('fetch')).slice(0, 600)}`);
  w.dispose();
  return { fed, overlaps, heals, swept, padCrate };
}

describe('the robots\' routes while the bench heals', () => {
  test(`${SESSIONS} sessions: Revert never overlaps Fetch or Patch, and the belt is fed again`, async () => {
    const report: string[] = [];
    let bad = 0;
    let heals = 0;
    const only = process.env.TRAFFIC_SEED;
    for (let seed = only ? Number(only) : 0; seed < (only ? Number(only) + 1 : SESSIONS); seed++) {
      const s = await session(seed);
      heals += s.heals;
      if (s.overlaps.length || s.fed === null) bad++;
      report.push(`seed ${seed}: fed ${s.fed === null ? 'NEVER' : `${s.fed.toFixed(0)} s`}, heals ${s.heals}, overlaps ${s.overlaps.length}${s.overlaps.length ? `: ${s.overlaps[0]} … ${s.overlaps.at(-1)}` : ''}`);
    }
    process.stderr.write(`\n${report.join('\n')}\n`);
    expect(heals).toBeGreaterThan(SESSIONS / 2); // it exercised the healing
    expect(bad, report.join('\n')).toBe(0);
  }, 1_200_000);

  test('Patch set down on Revert\'s track while it heals the back-left corner: they never overlap; one waits for the other', async () => {
    const report: string[] = [];
    let bad = 0;
    for (const [i, spot] of ([[-4.83, 0.4, -1.0], [-3.2, 0.4, -1.58], [-5.8, 0.4, -2.4]] as Vec3[]).entries()) {
      const s = await session(100 + i, spot, (r) => [r.range(-8.3, -6.5), 0, r.range(-4.3, -3.2)]);
      if (s.overlaps.length || s.fed === null) bad++;
      report.push(`Patch at ${spot.join(',')}: fed ${s.fed === null ? 'NEVER' : `${s.fed.toFixed(0)} s`}, heals ${s.heals}, overlaps ${s.overlaps.length}${s.overlaps.length ? `: ${s.overlaps[0]}` : ''}`);
    }
    process.stderr.write(`\n${report.join('\n')}\n`);
    expect(bad, report.join('\n')).toBe(0);
  }, 900_000);

  test('seed 16 (five handled crates, one on Revert\'s hatch, nothing Fetch may take): it heals at a cap of five loose crates and of six (Revert knocks the crate on its hatch in)', async () => {
    const T = DOCK_TUNING as { looseMax: number };
    const was = T.looseMax;
    const report: string[] = [];
    try {
      for (const cap of [5, 6]) {
        T.looseMax = cap;
        const s = await session(16);
        report.push(`cap ${cap}: fed ${s.fed === null ? 'NEVER' : `${s.fed.toFixed(0)} s`}, heals ${s.heals}, overlaps ${s.overlaps.length}`);
        expect(s.fed, report.join('; ')).not.toBeNull();
        expect(s.overlaps).toEqual([]);
      }
    } finally {
      T.looseMax = was;
    }
    process.stderr.write(`\nseed 16: ${report.join('; ')}\n`);
  }, 600_000);

  test('a handled crate left on Fetch\'s pad: Revert sweeps it like any other, sharing the pad with Fetch at its stand (never an overlap)', async () => {
    const w = await benchWorld('traffic-pad', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(20));
    const id = CRATES.find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
    putOn(w, t, id, [AT.pad[0], 0, AT.pad[1]]);
    const r = (): RevertView => w.machine('revert-crew') as RevertView;
    let swept = -1;
    const overlaps: string[] = [];
    for (let i = 0; i < steps(60) && swept < 0; i++) {
      for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === id && e.to.at === 'rest') swept = i / HZ;
      const rb = revertBox(w);
      const fb = fetchBox(w);
      if (rb && fb && overlap(rb, fb)) overlaps.push(`${(i / HZ).toFixed(1)}s`);
    }
    process.stderr.write(`\npad: ${id} swept after ${swept.toFixed(1)} s; Revert at ${r().x.toFixed(2)},${r().z.toFixed(2)}; overlaps ${overlaps.length}\n`);
    expect(swept).toBeGreaterThan(0);
    expect(swept).toBeLessThan(25);
    expect(overlaps).toEqual([]);
    w.dispose();
  }, 600_000);

  test('a handled crate set down on Revert\'s track between it and its target: it is swept first, then the target, and Revert never sets off and gives up behind it more than once', async () => {
    const w = await benchWorld('traffic-track', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(20));
    const TARGET: Vec3 = [2.3, 0, -0.3];
    const ON_TRACK: Vec3 = [-3.7, 0, -1.58];
    // (2026-11-20: Revert comes for any crate Fetch may not carry 8 s after it was last stirred: two crates set down
    // one after the other, the target first, then one on the track between Revert's hatch and it)
    const free = CRATES.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest');
    const target: Id | null = free[0] ?? null;
    const blocker: Id | null = free[1] ?? null;
    putOn(w, t, target!, TARGET);
    putOn(w, t, blocker!, ON_TRACK);
    expect(target && blocker).toBeTruthy();
    if (process.env.TRAFFIC_DBG) process.stderr.write(`\nTRACK at start: ${CRATES.map((id) => `${id} ${w.mode(id)}${w.touched(id) ? '*' : ''}@${w.motion(id)!.pose.p.map((v) => v.toFixed(2))}`).join(' | ')}\n`);
    const swept: Id[] = [];
    let gaveUp = 0;
    const r = (): RevertView => w.machine('revert-crew') as RevertView;
    for (let i = 0; i < steps(150) && !swept.includes(target!); i++) {
      if (process.env.TRAFFIC_DBG && i % 15 === 0 && i > steps(13) && i < steps(40)) process.stderr.write(`\nP ${(i / HZ).toFixed(2)} ${r().state} @${r().x.toFixed(2)},${r().z.toFixed(2)} h${r().heading.toFixed(2)} crate-2 ${w.motion('crate-2')!.pose.p.map((v) => v.toFixed(2))} ${w.mode('crate-2')}`);
      for (const e of t.run(1)) {
        if (e.type === 'revert.sweep' && e.to.at === 'rest') swept.push(e.part);
        if (process.env.TRAFFIC_DBG && e.type === 'crew.state' && e.id === 'revert') process.stderr.write(`\nT ${(i / HZ).toFixed(1)} ${e.from}->${e.state} @${r().x.toFixed(2)},${r().z.toFixed(2)} h${r().heading.toFixed(2)} crate-2 ${w.motion('crate-2')!.pose.p.map((v) => v.toFixed(2))}`);
        if (e.type === 'crew.state' && e.id === 'revert' && e.from === 'trundle' && e.state === 'idle' && Math.hypot(r().x - REVERT_HOME[0], r().z - REVERT_HOME[1]) > 0.1) gaveUp++;
      }
    }
    process.stderr.write(`\ntrack: target ${target}, on the track ${blocker}; swept in order ${swept.join(', ')}; trips given up ${gaveUp}\n`);
    expect(swept.indexOf(blocker!)).toBeGreaterThanOrEqual(0);
    expect(swept.indexOf(blocker!)).toBeLessThan(swept.indexOf(target!));
    expect(gaveUp).toBeLessThanOrEqual(1);
    w.dispose();
  }, 600_000);
});
