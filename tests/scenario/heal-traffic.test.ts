// R3 follow-up: the three robots' routes against each other while the bench heals. Twenty seeded sessions on the
// whole bench under Rapier: crates strewn by the visitor until Fetch has nothing it may carry, Fetch on its
// rounds, Patch set down somewhere and walking home, while Revert sweeps, carries and drops. Revert never
// overlaps Fetch or Patch, neither of them walks through Revert, and nobody stops for good: the belt is fed again.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, PatchView, RevertView, Vec3 } from '../../src/workshop/sim/types.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
// verify runs 6; the full twenty: TRAFFIC=20 npx vitest run tests/scenario/heal-traffic.test.ts
const SESSIONS = Number(process.env.TRAFFIC ?? 6);
/** Patch's footprint on the bench (patch-route's own radius is about this). */
const PATCH_R = 0.4;

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

async function session(seed: number, patchAt?: Vec3, crateAt?: (r: ReturnType<typeof rng>) => Vec3): Promise<{ fed: number | null; overlaps: string[]; heals: number }> {
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
  for (let i = 0; i < steps(Number(process.env.TRAFFIC_SECS ?? 150)); i++) {
    for (const e of t.run(1)) {
      if (e.type === 'taken-in' && e.id === 'belt' && fed === null) fed = i / HZ;
      if (e.type === 'revert.sweep' && e.to.at === 'rest') heals++;
    }
    if (process.env.TRAFFIC_DBG && (i % 120 === 0 || (i > 1900 && i < 2150 && i % 6 === 0))) {
      const rv = w.machine('revert-crew') as RevertView;
      process.stderr.write(`\n  ${(i / HZ).toFixed(0)}s revert ${rv.state} @${rv.x.toFixed(2)},${rv.z.toFixed(2)} h${rv.heading.toFixed(2)} carrying ${rv.carrying} | fetch ${w.crew('fetch')?.state} @${w.motion('fetch')!.pose.p.map((v) => v.toFixed(1)).join(',')} | patch ${(w.machine('patch') as PatchView).state}`);
    }
    const rb = revertBox(w);
    if (!rb) continue;
    const fb = fetchBox(w);
    const pb = patchBox(w);
    if (fb && overlap(rb, fb)) overlaps.push(`${(i / HZ).toFixed(1)}s Revert/Fetch at ${rb.x.toFixed(2)},${rb.z.toFixed(2)} (${(w.machine('revert-crew') as RevertView).state}) / ${fb.x.toFixed(2)},${fb.z.toFixed(2)} (${w.crew('fetch')?.state})`);
    if (pb && overlap(rb, pb)) overlaps.push(`${(i / HZ).toFixed(1)}s Revert/Patch at ${rb.x.toFixed(2)},${rb.z.toFixed(2)} (${(w.machine('revert-crew') as RevertView).state}) / ${pb.x.toFixed(2)},${pb.z.toFixed(2)} (${(w.machine('patch') as PatchView).state})`);
  }
  if (process.env.TRAFFIC_DBG) process.stderr.write(`\nseed ${seed} end: ${CRATES.map((id) => `${id} ${w.part(id)!.location.at}/${w.mode(id)}${w.touched(id) ? '*' : ''}@${w.motion(id)!.pose.p.map((v) => v.toFixed(1)).join(',')}`).join(' | ')} revert ${(w.machine('revert-crew') as RevertView).state} fetch ${w.crew('fetch')?.state}`);
  w.dispose();
  return { fed, overlaps, heals };
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
});
