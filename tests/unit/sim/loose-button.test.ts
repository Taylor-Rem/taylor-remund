import { describe, expect, test } from 'vitest';
import { stubWorld, run, types } from './helpers.ts';
import { BUTTON_TUNING } from '../../../src/workshop/sim/machines/button.ts';
import { throwCap } from '../../../src/workshop/sim/world.ts';
import { massOf } from '../../../src/workshop/sim/parts.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { rng } from '../../../src/workshop/sim/rng.ts';
import type { Intent, SimEvent, Vec3 } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';

const poses = (w: World) => [...w.parts()].map((p) => [p.id, w.motion(p.id)!.pose]);

describe('loose parts with the stub physics (exact)', () => {
  test('grab answers on the first step: the part is held and rises', () => {
    const { world } = stubWorld();
    const p0 = world.motion('crate-1')!.pose.p;
    world.dispatch({ type: 'grab', id: 'crate-1', grip: p0 });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'part.grabbed', id: 'crate-1' });
    const m = world.motion('crate-1')!;
    expect(m.held).toBe(true);
    expect(m.pose.p[1]).toBeGreaterThan(p0[1]);
    expect(world.holding()).toEqual({ kind: 'part', id: 'crate-1' });
    expect(world.touched('crate-1')).toBe(true);
  });

  test('carry follows the target without overshoot; release throws (clamped), it comes to rest and its location is committed', () => {
    const { world, physics } = stubWorld();
    const p0 = world.motion('crate-1')!.pose.p;
    world.dispatch({ type: 'grab', id: 'crate-1', grip: p0 });
    const target: Vec3 = [0, 1.2, 3];
    let lastGap = Infinity;
    for (let i = 0; i < 90; i++) {
      world.dispatch({ type: 'carry', target });
      run(world, 1);
      const p = world.motion('crate-1')!.pose.p;
      const gap = Math.hypot(p[0] - target[0], p[2] - target[2]);
      expect(gap).toBeLessThanOrEqual(lastGap + 1e-9);
      lastGap = gap;
    }
    expect(lastGap).toBeLessThan(0.01);
    const landing = { p: [0.5, 0.4, 3.5] as Vec3, q: [0, 0, 0, 1] as const };
    physics.land('crate-1', landing, 20);
    world.dispatch({ type: 'release', velocity: [100, 0, 0] });
    const ev = run(world, 1);
    const rel = ev.find((e) => e.type === 'part.released');
    // (R4) clamped to the cap for its mass: the whole cap for a light crate, less for a heavy one
    expect(rel).toEqual({ type: 'part.released', id: 'crate-1', speed: throwCap(world.scene.parts.find((p) => p.id === 'crate-1')!.mass ?? massOf(world.halfExtents('crate-1')!, world.scene.parts.find((p) => p.id === 'crate-1')!.material)) });
    expect(world.holding()).toBeNull();
    // still in flight: the durable location has not moved
    expect(world.part('crate-1')?.location).toMatchObject({ at: 'rest', pose: { p: p0 } });
    const after = run(world, 60);
    expect(types(after)).toContain('part.rested');
    expect(world.part('crate-1')?.location).toEqual({ at: 'rest', pose: landing });
    expect(world.writer('crate-1', 'location')).toBe('t1'); // § E5 rule 4: charged to the release's transaction
  });

  test('a part dropped off the bench comes back up the return chute, moving', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'grab', id: 'crate-2', grip: world.motion('crate-2')!.pose.p });
    for (let i = 0; i < 80; i++) {
      world.dispatch({ type: 'carry', target: [10.9, 1, 2] });
      run(world, 1);
    }
    world.dispatch({ type: 'release', velocity: [3, 0, 0] });
    const ev = run(world, steps(4));
    const returned = ev.findIndex((e) => e.type === 'part.returned' && e.id === 'crate-2');
    expect(returned).toBeGreaterThan(-1);
    expect(ev.slice(returned)).toContainEqual({ type: 'part.rested', id: 'crate-2' });
    const loc = world.part('crate-2')!.location;
    expect(loc.at).toBe('rest');
    if (loc.at === 'rest') {
      expect(loc.pose.p[0]).toBeGreaterThan(world.scene.chute.pose.p[0]); // it slid out of the chute's mouth
      expect(loc.pose.p[1]).toBeGreaterThan(0);
    }
    expect(world.mode('crate-2')).toBe('free');
  });

  test('halfExtents: every part\'s box is on the read surface, Fetch included', () => {
    const { world } = stubWorld();
    expect(world.halfExtents('crate-1')).toEqual([0.4, 0.4, 0.4]);
    expect(world.halfExtents('crate-3')).toEqual([0.225, 0.225, 0.225]);
    expect(world.halfExtents('fetch')).toEqual([0.3, 0.5, 0.26]);
    expect(world.halfExtents('nope')).toBeUndefined();
  });

  test('a cancelled pick-up (let go at once, slow, in place) goes back exactly and commits nothing', () => {
    const { world } = stubWorld();
    const loc = world.part('crate-3')!.location;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
    run(world, 6);
    expect(world.motion('crate-3')!.pose.p[1]).toBeGreaterThan(loc.at === 'rest' ? loc.pose.p[1] : 0);
    world.dispatch({ type: 'release', velocity: [0.2, 0, 0] });
    const ev = run(world, 60);
    expect(ev).toContainEqual({ type: 'part.released', id: 'crate-3', speed: 0 });
    expect(types(ev)).not.toContain('effect');
    expect(types(ev)).not.toContain('part.rested');
    expect(loc.at).toBe('rest');
    if (loc.at === 'rest') expect(world.motion('crate-3')!.pose).toEqual(loc.pose);
    expect(world.writer('crate-3', 'location')).toBe('settled');
    expect(world.holding()).toBeNull();
    expect(world.mode('crate-3')).toBe('free');
  });

  test('not cancelled: let go late, or fast, or after moving it', () => {
    for (const [wait, v, carry] of [
      [30, [0, 0, 0], false],
      [4, [3, 0, 0], false],
      [4, [0, 0, 0], true],
    ] as const) {
      const { world } = stubWorld();
      world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
      for (let i = 0; i < wait; i++) {
        if (carry) world.dispatch({ type: 'carry', target: [-1, 1.5, 1.5] });
        run(world, 1);
      }
      world.dispatch({ type: 'release', velocity: v as unknown as Vec3 });
      const ev = run(world, 120);
      expect(types(ev)).toContain('part.rested');
    }
  });

  test('place: tap-then-tap puts the held part at a spot', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
    world.dispatch({ type: 'place', at: [4, 0, 2] });
    run(world, 60);
    const loc = world.part('crate-3')!.location;
    expect(loc.at).toBe('rest');
    if (loc.at !== 'rest') return;
    expect(loc.pose.p[0]).toBe(4);
    expect(loc.pose.p[2]).toBe(2);
    expect(loc.pose.p[1]).toBeCloseTo(0.225, 1); // on the bench (the stub settles it on its half height)
    expect(world.writer('crate-3', 'location')).toBe('t1'); // § E5 rule 4: charged to the place's transaction
  });
});

describe('the Button, rung 1 (§ B4), bracketed (§ E5)', () => {
  test('press: events in order; parts and handles stop responding; the rewind; the world after equals the world before', () => {
    const { world } = stubWorld();
    run(world, 20);
    const durable = world.durable();
    const before = poses(world);
    world.dispatch({ type: 'press', id: 'button' });
    const first = run(world, 1);
    expect(types(first).filter((t) => t !== 'crew.state')).toEqual(['handle.worked', 'button.pressed', 'rung.started', 'rung.beat', 'misfire', 'misfire', 'rung.beat', 'rung.beat']);
    expect(first.flatMap((e) => (e.type === 'rung.beat' ? [e.beat] : []))).toEqual(['flinch', 'shove', 'revert']);
    expect(first).toContainEqual({ type: 'button.pressed', rung: 1, presses: 1 });
    expect(first).toContainEqual({ type: 'misfire', id: 'lamp', level: 1 });
    expect(first).toContainEqual({ type: 'misfire', id: 'belt', level: 1 });
    expect(first).toContainEqual({ type: 'crew.state', id: 'fetch', state: 'frozen', from: 'idle' });
    expect(world.bracketed).toBe(true);
    // the top crate of the stack was shoved
    run(world, 10);
    expect(world.motion('crate-3')!.pose.p).not.toEqual(before.find(([id]) => id === 'crate-3')![1]);

    // nothing the visitor does reaches parts or handles meanwhile
    const ignored: Intent[] = [
      { type: 'grab', id: 'crate-1', grip: [0, 0, 0] },
      { type: 'unplug', cord: 'cord' },
      { type: 'press', id: 'button' },
    ];
    for (const i of ignored) world.dispatch(i);
    const mid = run(world, 1);
    expect(types(mid)).not.toContain('part.grabbed');
    expect(types(mid)).not.toContain('cord.unplugged');
    expect(world.holding()).toBeNull();

    const rest: SimEvent[] = [];
    let n = 12;
    while (world.bracketed && n < 1000) {
      rest.push(...run(world, 1));
      n++;
    }
    expect(n).toBe(steps(BUTTON_TUNING.flinch) + steps(BUTTON_TUNING.rewind));
    const named = types(rest).filter((t) => t.startsWith('rung') || t === 'card');
    expect(named).toEqual(['rung.rewinding', 'rung.beat', 'rung.ended', 'rung.beat', 'card']);
    expect(rest).toContainEqual({ type: 'card', by: 'revert', content: 'card.rung1' });
    expect(types(rest)).not.toContain('effect');
    expect(world.durable()).toEqual(durable);
    expect(poses(world)).toEqual(before);
    expect(world.button()).toMatchObject({ rung: 1, presses: 1, phase: 'idle' });
    expect(world.crew('fetch')?.state).toBe('idle');
  });

  test('a press while holding something does nothing', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'grab', id: 'crate-1', grip: [0, 0, 0] });
    world.dispatch({ type: 'press', id: 'button' });
    const ev = run(world, 1);
    expect(types(ev)).not.toContain('button.pressed');
    expect(world.button().presses).toBe(0);
  });

  test('the press count goes on; the rung and count can be restored from a save (the next press climbs on from there)', () => {
    const { world } = stubWorld(1, { button: { rung: 1, presses: 7 } });
    world.dispatch({ type: 'press', id: 'button' });
    expect(run(world, 1)).toContainEqual({ type: 'button.pressed', rung: 2, presses: 8 });
  });
});

describe('determinism with the stub (§ E4 invariant 4, exact)', () => {
  function script(seed: number): { durable: unknown; events: SimEvent[] } {
    const { world } = stubWorld(seed);
    const r = rng(`script-${seed}`);
    const events: SimEvent[] = [];
    for (let i = 0; i < steps(60); i++) {
      if (i % 17 === 0) {
        const k = r.int(5);
        const id = r.pick(['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch']);
        if (k === 0) world.dispatch({ type: 'grab', id, grip: world.motion(id)!.pose.p });
        if (k === 1) world.dispatch({ type: 'carry', target: [r.range(-8, 8), r.range(0.5, 2), r.range(-4, 4)] });
        if (k === 2) world.dispatch({ type: 'release', velocity: [r.range(-6, 6), r.range(0, 3), r.range(-6, 6)] });
        if (k === 3 && r.chance(0.2)) world.dispatch({ type: 'press', id: 'button' });
        if (k === 4) world.dispatch(r.chance(0.5) ? { type: 'unplug', cord: 'cord' } : { type: 'plug', cord: 'cord', jack: r.pick(['jack-lamp', 'jack-storefront']) });
      }
      world.advance();
      events.push(...world.drainEvents());
    }
    return { durable: world.durable(), events };
  }

  test('same seed and script: same durable state and the same event sequence', () => {
    for (const seed of [1, 2, 3]) {
      const a = script(seed);
      const b = script(seed);
      expect(b.durable).toEqual(a.durable);
      expect(b.events).toEqual(a.events);
      expect(a.events.length).toBeGreaterThan(50);
    }
  });
});
