// The soak (REWRITE.md § E8: "an hour of simulated random grabbing, throwing and pressing from a seed: no part
// outside the bench, no runaway part count, every machine back to idle after reset") on the whole bench with the
// belt running, under real Rapier: seeded grabbing, throwing, putting things on the belt and the ramp, the
// handles, the lever and the Button. The three things § E8 names are each asserted, all through the run:
//   1. no part outside the bench: none at rest or held outside it or below its top, and none in flight outside
//      it for longer than OUTSIDE_LIMIT (thrown off the edge, it comes back by the chute or lands);
//   2. no runaway part count: the world's parts, the registry and the physics world's bodies stay the counts
//      the visit began with;
//   3. every machine back to idle after reset: every RESET_EVERY simulated minutes and at the end, "Reset the
//      workshop", then each machine's own idle state (machineFaults below) and every durable setting as a
//      fresh bench has it.
//
// The length is an environment variable (verify runs the default):
//   SOAK_BENCH_MINUTES=60 VITEST_MAX_WORKERS=4 npx vitest run tests/scenario/soak-bench.test.ts   (the hour:
//   about 45 s on one core on the reference laptop; on this machine behind …/shots/p2/lead/soak.lock)
//   SOAK_BENCH_SEED=<any>   another script (default soak-bench-script)
import { expect, test } from 'vitest';
import './rapier-node.ts';
import { benchWorld, FULL_BENCH, LINE, onBelt, putOn, tape } from './line-helpers.ts';
import { createRapierPhysics } from '../../src/workshop/sim/physics/rapier.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { BeltView, ChuteView, DockView, MachineView, Vec3 } from '../../src/workshop/sim/types.ts';

const MINUTES = Number(process.env.SOAK_BENCH_MINUTES ?? 10);
const SEED = process.env.SOAK_BENCH_SEED ?? 'soak-bench-script';
/** A reset (and the idle check) this often, in simulated minutes; the end of the run always has one. */
const RESET_EVERY = 10;
/** The longest a part may be in flight outside the bench before it counts as gone for good (seconds). */
const OUTSIDE_LIMIT = 12;

/** What is not idle on the bench just after a reset and a settle: one line per fault. */
export function machineFaults(w: World): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of w.interactables()) {
    const m = w.machine(i.id) as MachineView | undefined;
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    const bad = (what: string): void => void out.push(`${m.id} (${m.kind}): ${what}`);
    switch (m.kind) {
      case 'belt':
        if (m.riding.length) bad(`riding ${m.riding.join(',')}`);
        if (m.waiting !== null) bad(`waiting on ${m.waiting}`);
        break;
      case 'striker':
        if (m.cock > 0.01) bad(`cocked ${m.cock.toFixed(2)}`);
        break;
      case 'dock':
        if (m.shipping.length) bad(`shipping ${m.shipping.join(',')}`);
        if (m.door > 0.01) bad(`door open ${m.door.toFixed(2)}`);
        break;
      case 'chute':
        if (m.waiting) bad(`${m.waiting} waiting inside`);
        break;
      case 'undo-lever':
        if (m.phase !== 'rest') bad(`phase ${m.phase}`);
        break;
      case 'line':
        if (m.job) bad(`a job in hand (text ${m.job.n})`);
        if (m.waiting) bad(`${m.waiting} texts waiting`);
        if (m.offering.length) bad(`offering ${m.offering.join(',')}`);
        break;
      case 'platen':
        if (m.onTray) bad(`${m.onTray} on the tray`);
        if (m.beats.length) bad(`${m.beats.length} beats showing`);
        break;
      case 'storefront':
      case 'lamp':
        if (m.beats.length) bad(`${m.beats.length} beats showing`);
        break;
      default:
        break; // the crew (Patch, Revert) are on their own rounds: § E8 asks this of the machines
    }
  }
  const b = w.button();
  if (b.phase !== 'idle') out.push(`button: phase ${b.phase}`);
  if (w.bracketed) out.push('a rung is still bracketing the bench');
  if (w.holding()) out.push('the hand still holds something');
  if (w.undoStack().length) out.push(`${w.undoStack().length} transactions left to undo`);
  return out;
}

/** Every durable setting that is not a part's place: as the visit began. */
const settings = (w: World): Record<string, unknown> =>
  Object.fromEntries(w.durable().filter((d) => d.field !== 'location').map((d) => [`${d.target}.${d.field}`, d.value]));

test(`soak: ${MINUTES} simulated minutes on the bench with the belt running`, { timeout: Math.max(180_000, MINUTES * 30_000) }, async () => {
  const physics = await createRapierPhysics();
  const w = await benchWorld('soak-bench', { scene: FULL_BENCH, physics }); // the whole bench: Fetch's rounds run too
  const r = rng(SEED);
  const ids = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
  const count = { parts: [...w.parts()].length, registry: [...w.interactables()].length, bodies: physics.bodies().length };
  const opening = settings(w);
  const b = w.scene.bench;
  const seen = { shipped: 0, struck: 0, returned: 0, restocked: 0, undone: 0, rungs: 0, takenIn: 0, grabbed: 0, stoppedSteps: 0, resets: 0, longestOutside: 0 };

  // a part crosses each machine's mouth once per ride: once it leaves the belt it is not taken back onto
  // it within a second unless a hand (the visitor's, or an undo) put it there
  let riding = new Set<string>();
  const left = new Map<string, number>();
  const retakes: string[] = [];
  const outsideSince = new Map<string, number>();
  const insideFn = (p: Vec3, pad = 0.01): boolean => p[0] >= b.minX - pad && p[0] <= b.maxX + pad && p[2] >= b.minZ - pad && p[2] <= b.maxZ + pad && p[1] > -0.05 && p[1] < b.ceiling;
  /** 1, every step: a part in flight outside the bench comes back (by the chute, or onto the bench) in time. */
  const outsideFlight = (): void => {
    for (const p of w.parts()) {
      const m = w.motion(p.id)!;
      const jet = p.id === 'fetch' && w.crew('fetch')?.state === 'jetpack';
      if (m.mode === 'gone' || m.mode === 'chute' || jet || insideFn(m.pose.p)) {
        outsideSince.delete(p.id);
        continue;
      }
      if (!outsideSince.has(p.id)) outsideSince.set(p.id, w.step);
      const since = outsideSince.get(p.id)!;
      seen.longestOutside = Math.max(seen.longestOutside, (w.step - since) / steps(1));
      if (w.step - since >= steps(OUTSIDE_LIMIT)) {
        expect.fail(`${p.id} outside the bench for good: since step ${since}, now ${w.step} at ${m.pose.p.map((x) => x.toFixed(2)).join(', ')} (${m.mode})`);
      }
    }
  };
  const step = (): void => {
    w.advance();
    outsideFlight();
    if (w.setting('belt', 'running') === false) seen.stoppedSteps++;
    const evs = w.drainEvents();
    for (const e of evs) if (e.type === 'part.grabbed' || e.type === 'undone' || e.type === 'reset') left.clear();
    const now = new Set((w.machine('belt') as BeltView).riding);
    for (const id of riding) if (!now.has(id)) left.set(id, w.step);
    for (const id of now) if (!riding.has(id) && left.has(id) && w.step - left.get(id)! < 60) retakes.push(`${id}@${w.step}`);
    riding = now;
    for (const e of evs) {
      if (e.type === 'shipped') seen.shipped++;
      if (e.type === 'struck' && e.part) seen.struck++;
      if (e.type === 'part.returned') seen.returned++;
      if (e.type === 'restocked') seen.restocked++;
      if (e.type === 'undone') seen.undone++;
      if (e.type === 'rung.started') seen.rungs++;
      if (e.type === 'taken-in') seen.takenIn++;
      if (e.type === 'part.grabbed') seen.grabbed++;
    }
  };
  const check = (): void => {
    // 2. no runaway count
    expect([...w.parts()].length).toBe(count.parts);
    expect([...w.interactables()].length).toBe(count.registry);
    expect(physics.bodies().length).toBe(count.bodies);
    // 1. no part outside the bench
    for (const p of w.parts()) {
      const m = w.motion(p.id)!;
      expect(m.pose.p.every(Number.isFinite) && m.pose.q.every(Number.isFinite), p.id).toBe(true);
      if (m.mode === 'gone' || m.mode === 'chute') continue;
      const pos = m.pose.p;
      // on the bench (a part on its way down is allowed below it only while it falls: the chute takes it)
      // no part at rest below the bench top inside its footprint (the edge sends it back by the chute)
      const inFoot = pos[0] >= b.minX && pos[0] <= b.maxX && pos[2] >= b.minZ && pos[2] <= b.maxZ;
      if ((m.mode === 'free' && !m.awake) || m.mode === 'held') expect(!inFoot || pos[1] > b.top, `${p.id} below the bench top at step ${w.step}: ${pos.join(', ')}`).toBe(true);
      // (S5: Fetch flying back onto the bench on its jetpack is outside it by design until it lands)
      const jet = p.id === 'fetch' && w.crew('fetch')?.state === 'jetpack';
      if (!jet && (m.mode !== 'free' || !m.awake)) expect(insideFn(pos), `${p.id} outside the bench at step ${w.step}: ${pos.join(', ')}`).toBe(true);
    }
  };
  // 3. every machine back to idle after reset, and every setting as the visit began
  const resetAndCheck = (): void => {
    while (w.bracketed) step();
    w.dispatch({ type: 'reset' });
    seen.resets++;
    // at once: nothing riding, nothing being shipped, nothing to undo (since layout round 4 the stack is in
    // Fetch's reach, and in play mode it goes on with its rounds a moment later: those are the crew's)
    step();
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    expect((w.machine('dock') as DockView).shipping).toEqual([]);
    expect(w.undoStack()).toEqual([]);
    expect(settings(w), 'every durable setting back as the visit began').toEqual(opening);
    // (a crew member's own body, Patch's since 2026-11-20, is out of the world, as a spare is, until a hand takes hold of it)
    const crewBodies = new Set(w.scene.parts.filter((p) => p.crewBody).map((p) => p.id));
    for (const p of w.parts()) expect(p.location.at === 'rest' || (p.location.at === 'shipped' && (p.id.startsWith('crate-spare') || crewBodies.has(p.id))), `${p.id}: ${p.location.at}`).toBe(true);
    // within two seconds the door has shut again (what the reset brought back in through it) and nothing waits in the chute
    for (let i = 0; i < steps(2); i++) step();
    expect((w.machine('dock') as DockView).door).toBe(0);
    expect((w.machine('chute') as ChuteView).waiting).toBe(0);
    expect(machineFaults(w), `not idle ${steps(2)} steps after the reset at step ${w.step}`).toEqual([]);
    for (let i = 0; i < steps(6); i++) step();
    check();
    expect(w.undoStack()).toEqual([]);
  };

  const end = steps(MINUTES * 60);
  let nextReset = steps(RESET_EVERY * 60);
  while (w.step < end) {
    const k = r.int(20);
    const avail = ids.filter((id) => ['free', 'crew', 'machine'].includes(w.mode(id) ?? ''));
    if (k < 13 && avail.length) {
      const id = r.pick(avail);
      const m = w.motion(id)!;
      w.dispatch({ type: 'grab', id, grip: m.pose.p });
      const roll = r.next();
      const to: Vec3 = roll < 0.4 ? onBelt(r.range(0.05, 0.9), r.range(-0.2, 0.2)) : roll < 0.5 ? [LINE.ramp.start[0] + 0.3, 0.6, LINE.ramp.start[2]] : roll < 0.6 ? [r.pick([-1, 1]) * r.range(9, 11), r.range(0.5, 2), r.range(-4, 5.5)] : [r.range(-7, 7), r.range(0.4, 2.8), r.range(-4, 4)];
      const lift: Vec3 = [to[0], to[1] + 1.2, to[2]];
      const n = 10 + r.int(50);
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        w.dispatch({ type: 'carry', target: [m.pose.p[0] + (lift[0] - m.pose.p[0]) * f, m.pose.p[1] + 1 + (lift[1] - m.pose.p[1] - 1) * f, m.pose.p[2] + (lift[2] - m.pose.p[2]) * f] });
        step();
      }
      w.dispatch({ type: 'release', velocity: roll < 0.5 ? [0, 0, 0] : [r.range(-8, 8), r.range(-2, 4), r.range(-8, 8)] });
    } else if (k < 15) {
      // the dial anywhere; the lever mostly back to forward (a stopped belt soaks nothing)
      if (r.chance(0.5)) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
      else w.dispatch({ type: 'turn', id: 'belt-lever', value: r.chance(0.75) ? 1 : r.next() });
    } else if (k < 17) {
      w.dispatch({ type: 'undo' });
    } else {
      w.dispatch({ type: 'press', id: 'button' });
    }
    step();
    const wait = r.chance(0.6) ? steps(4) : r.int(steps(1.2));
    for (let i = 0; i < wait && w.step < end; i++) step();
    check();
    if (w.step >= nextReset && w.step < end) {
      // the hand lets go first (a reset mid-carry is its own test): then the bench goes back to how it began
      if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      resetAndCheck();
      nextReset += steps(RESET_EVERY * 60);
    }
  }
  resetAndCheck();
  console.log(`soak-bench (${MINUTES} min, seed ${SEED}): ${JSON.stringify(seen)} over ${w.step} steps; retakes ${retakes.join(' ')}`);
  expect(retakes).toEqual([]);
  expect(seen.shipped).toBeGreaterThan(5 * (MINUTES / 10));
  expect(seen.struck).toBeGreaterThan(5 * (MINUTES / 10));
  expect(seen.returned).toBeGreaterThan(3 * (MINUTES / 10));
  w.dispose();
});

test('the idle check sees a bench that is not idle: a rung playing, a hand holding, a crate riding', async () => {
  const w = await benchWorld('soak-bench-idle', { scene: FULL_BENCH });
  try {
    for (let i = 0; i < 30; i++) w.advance();
    expect(machineFaults(w)).toEqual([]);
    w.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 10; i++) w.advance();
    expect(machineFaults(w).join('\n')).toMatch(/button: phase playing/);
    while (w.bracketed) w.advance();
    const m = w.motion('crate-1')!;
    w.dispatch({ type: 'grab', id: 'crate-1', grip: m.pose.p });
    w.advance();
    expect(machineFaults(w).join('\n')).toMatch(/the hand still holds something/);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const t = tape(w);
    putOn(w, t, 'crate-1', onBelt(0.2));
    let riding = false;
    for (let i = 0; i < 240 && !riding; i++) {
      t.run(1);
      riding = (w.machine('belt') as BeltView).riding.length > 0;
    }
    expect(riding).toBe(true);
    expect(machineFaults(w).join('\n')).toMatch(/belt \(belt\): riding crate-1/);
  } finally {
    w.dispose();
  }
});
