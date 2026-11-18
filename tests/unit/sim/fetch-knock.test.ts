// S5: Fetch knocked about (§ B5, Taylor 2026-11-18). The rules alone, then the knock in a world on the
// stub physics (contacts scripted), so every case is exact.
import { describe, expect, test } from 'vitest';
import { KNOCK_TUNING, classify, clearRun, distanceTo, obstacles, toyBounce } from '../../../src/workshop/sim/crew/fetch-knock.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import { stubWorld, run } from './helpers.ts';
import type { SimEvent } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';

describe('how hard a hit is', () => {
  test('nothing below the smallest momentum; a slow part is a nudge; then three strengths by momentum', () => {
    const [n, s1, s2, s3] = KNOCK_TUNING.momentum;
    expect(classify(5, n * 0.9)).toBe(0);
    expect(classify(0, 1)).toBe(0);
    expect(classify(KNOCK_TUNING.minSpeed * 0.9, 2)).toBe('nudge');
    expect(classify(3, (n + s1) / 2)).toBe('nudge');
    expect(classify(3, s1)).toBe(1);
    expect(classify(3, s2 - 1e-6)).toBe(1);
    expect(classify(3, s2)).toBe(2);
    expect(classify(3, s3)).toBe(3);
    expect(classify(7, 5)).toBe(3);
  });

  test('a reaction never lasts over a second and a half (§ B5): slide plus wobble, at every strength', () => {
    for (let i = 0; i < 3; i++) expect((KNOCK_TUNING.shove[i] as number) + (KNOCK_TUNING.wobble[i] as number)).toBeLessThanOrEqual(1.5);
  });

  test('a toy bounce: the part keeps what a free toy of that mass would have let it keep', () => {
    // a part of mass 1 at 4 units/s into a toy of mass 1, restitution 0: off a wall it stops (-0 * 4); off the toy it keeps 2
    const dv = toyBounce([0, 0, 1], 4, 1, 1, 0);
    expect(dv[2]).toBeCloseTo(2, 9);
    // e = 1, equal masses: off a wall it comes back at -4, off the toy it stops: +4 given back
    expect(toyBounce([1, 0, 0], 4, 1, 1, 1)[0]).toBeCloseTo(4, 9);
    // a light part off a heavy toy: hardly any difference from a wall
    expect(toyBounce([1, 0, 0], 4, 0.05, 0.9, 0.2)[0]).toBeLessThan(0.3);
  });
});

describe('the knock is bounded: never off the bench, never into a machine', () => {
  const obs = obstacles(bench);
  const b = bench.bench;

  test('the machines are every static standing on the bench and every mouth, not the bench itself', () => {
    const ids = new Set(obs.map((o) => o.id));
    expect(ids.has('bench')).toBe(false);
    for (const id of ['console', 'belt-bed', 'belt-motor', 'striker', 'dock', 'revert', 'mouth:belt', 'mouth:dock']) expect(ids.has(id), id).toBe(true);
  });

  test('a turned box: distance is measured in its own frame', () => {
    const o = { id: 'x', x: 0, z: 0, hx: 1, hz: 0.1, yaw: Math.PI / 2 };
    // turned a quarter: its long side runs along Z
    expect(distanceTo(o, 0, 0.9)).toBe(0);
    expect(distanceTo(o, 0.9, 0)).toBeCloseTo(0.8, 9);
  });

  test('a slide toward the belt stops short of it; one along the open lane runs its whole length', () => {
    const r = 0.7;
    const toward = clearRun(-1, 2.2, 0, 1, 3, r, b, obs);
    expect(toward).toBeLessThan(3);
    for (const o of obs) expect(distanceTo(o, -1, 2.2 + toward)).toBeGreaterThanOrEqual(r - 1e-9);
    expect(clearRun(-1, 2.2, 1, 0, 1, r, b, obs)).toBeCloseTo(1, 9);
  });

  test('never past the bench edge', () => {
    const run = clearRun(8.0, 4.0, 1, 0, 5, 0.6, b, []);
    expect(8.0 + run + 0.6).toBeLessThanOrEqual(b.maxX + 1e-9);
  });

  test('something it already touches does not stop it moving away, only closer', () => {
    const o = [{ id: 'wall', x: 0, z: 0, hx: 1, hz: 1, yaw: 0 }];
    expect(clearRun(1.3, 0, 1, 0, 1, 0.5, { minX: -9, maxX: 9, minZ: -9, maxZ: 9 }, o)).toBeCloseTo(1, 9);
    expect(clearRun(1.3, 0, -1, 0, 1, 0.5, { minX: -9, maxX: 9, minZ: -9, maxZ: 9 }, o)).toBe(0);
  });
});

// ── in a world, on the stub physics: contacts are scripted, so the knock's rules are exact ──

/** Send `id` sliding at Fetch for a few steps (stub physics), then report a contact between them. */
function hitFetch(world: World, physics: StubPhysics, id: string, speed: number, impulse = 1): SimEvent[] {
  const f = world.crew('fetch')!;
  const p = world.motion(id)!.pose.p;
  const dx = f.x - p[0];
  const dz = f.z - p[2];
  const d = Math.hypot(dx, dz);
  // the stub keeps 80% of a sliding body's speed each step: start fast enough to arrive at `speed`
  physics.setPose(id, { p: [f.x - (dx / d) * 1.2, 0.6, f.z - (dz / d) * 1.2], q: [0, 0, 0, 1] });
  physics.setVelocity(id, [(dx / d) * speed * 1.25 * 1.25, 0, (dz / d) * speed * 1.25 * 1.25]);
  physics.wake(id);
  const out = run(world, 2);
  physics.contact({ a: id, b: 'fetch', impulse });
  out.push(...run(world, 2));
  return out;
}

const knocks = (ev: readonly SimEvent[]) => ev.filter((e) => e.type === 'crew.knocked');

describe('knocked (stub physics: scripted contacts)', () => {
  test('a fast part knocks it: shoved along the part\'s line, spun, then it wobbles, recovers and returns to its lane', () => {
    const { world, physics } = stubWorld();
    run(world, 30);
    const before = world.crew('fetch')!;
    const ev = hitFetch(world, physics, 'crate-1', 6, 2);
    const k = knocks(ev);
    expect(k).toHaveLength(1);
    expect(world.crew('fetch')!.state).toBe('knocked');
    const kn = world.crew('fetch')!.knock!;
    expect(kn).toMatchObject({ by: 'crate-1' });
    expect(kn.distance).toBeGreaterThan(0);
    expect(Math.abs(kn.spin)).toBeGreaterThan(0);
    // it drops the crate it was carrying
    expect((k[0] as Extract<SimEvent, { type: 'crew.knocked' }>).dropped).toBe('crate-4');
    expect(world.crew('fetch')!.carrying).toBeNull();
    // it slides, spins, wobbles, and is back on its lane within the reaction plus the walk back
    let states: string[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      run(world, 1);
      states.push(world.crew('fetch')!.state);
    }
    states = states.filter((s, i) => states[i - 1] !== s);
    expect(states.slice(0, 3)).toEqual(['knocked', 'return', 'idle']);
    expect(world.crew('fetch')!.z).toBeCloseTo(vignette.runner.lane.a[1], 9);
    expect(kn.distance).toBeLessThanOrEqual((KNOCK_TUNING.distance[2] as number) * (vignette.crewScale ?? 1) + 1e-9);
    expect(before.state).not.toBe('knocked');
  });

  test('a slow part is only a look', () => {
    const { world, physics } = stubWorld();
    run(world, 30);
    const ev = hitFetch(world, physics, 'crate-1', 0.8, 0.2);
    expect(knocks(ev)).toEqual([]);
    expect(ev.filter((e) => e.type === 'crew.nudged')).toHaveLength(1);
    expect(world.crew('fetch')!.lookAt).not.toBeNull();
    expect(world.crew('fetch')!.carrying).toBe('crate-4');
  });

  test('knocked while held: ignored', () => {
    const { world, physics } = stubWorld();
    run(world, 30);
    world.dispatch({ type: 'grab', id: 'fetch', grip: world.motion('fetch')!.pose.p });
    run(world, 1);
    expect(world.crew('fetch')!.state).toBe('held');
    const ev = hitFetch(world, physics, 'crate-1', 6, 2);
    expect(knocks(ev)).toEqual([]);
    expect(world.crew('fetch')!.state).toBe('held');
  });

  test('it cannot be knocked again until it has recovered', () => {
    const { world, physics } = stubWorld();
    run(world, 30);
    const first = knocks(hitFetch(world, physics, 'crate-1', 6, 2));
    expect(first).toHaveLength(1);
    const again = knocks(hitFetch(world, physics, 'crate-2', 6, 2));
    expect(again).toEqual([]);
    // recovered: knockable again
    run(world, 60 * 4);
    expect(['idle', 'roll', 'skid']).toContain(world.crew('fetch')!.state);
    expect(knocks(hitFetch(world, physics, 'crate-2', 6, 2))).toHaveLength(1);
  });

  test('frozen while a rung plays: not knocked', () => {
    const { world, physics } = stubWorld();
    run(world, 30);
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 2);
    expect(world.bracketed).toBe(true);
    expect(knocks(hitFetch(world, physics, 'crate-1', 6, 2))).toEqual([]);
  });

  test('the strength follows the momentum: the same speed knocks harder with a heavier part', () => {
    const strengthOf = (id: string, speed: number): number | null => {
      const { world, physics } = stubWorld();
      run(world, 30);
      const k = knocks(hitFetch(world, physics, id, speed, 2))[0] as Extract<SimEvent, { type: 'crew.knocked' }> | undefined;
      return k ? k.strength : null;
    };
    // crate-3 is S (0.06), crate-1 is L (0.33)
    const s = strengthOf('crate-3', 5);
    const l = strengthOf('crate-1', 5);
    expect(s).not.toBeNull();
    expect(l).not.toBeNull();
    expect(l!).toBeGreaterThan(s!);
  });
});
