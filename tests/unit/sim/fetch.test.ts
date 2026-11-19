import { describe, expect, test } from 'vitest';
import { stubWorld, run, crewStates } from './helpers.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import type { SimEvent } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';

/** Run n steps and note the step of every Fetch state change. */
function trace(world: World, n: number): { step: number; state: string }[] {
  const out: { step: number; state: string }[] = [];
  for (let i = 0; i < n; i++) {
    world.advance();
    for (const e of world.drainEvents()) if (e.type === 'crew.state' && e.id === 'fetch') out.push({ step: world.step, state: e.state });
  }
  return out;
}

describe('Fetch (§ B3, § B5)', () => {
  test('starts carrying a crate, rolling its lane with overshoot and skid-back', () => {
    const { world } = stubWorld();
    expect(world.crew('fetch')).toMatchObject({ state: 'idle', carrying: 'crate-4' });
    expect(world.mode('crate-4')).toBe('crew');
    expect(world.mode('fetch')).toBe('crew');
    const t = trace(world, steps(5));
    expect(t.map((s) => s.state).slice(0, 3)).toEqual(['roll', 'skid', 'idle']);
    // it overshot: during the skid it moves backwards along its heading
    const w2 = stubWorld().world;
    let sawBackward = false;
    let maxSpeed = 0;
    for (let i = 0; i < steps(5); i++) {
      w2.advance();
      w2.drainEvents();
      const m = w2.crew('fetch');
      if (m?.state === 'skid' && m.speed < 0) sawBackward = true;
      maxSpeed = Math.max(maxSpeed, m?.speed ?? 0);
      // never off its lane
      expect(m?.z).toBeCloseTo(w2.scene.runner.lane.points[0]![1], 9);
      expect(m!.x).toBeGreaterThanOrEqual(w2.scene.runner.lane.points[0]![0]);
      expect(m!.x).toBeLessThanOrEqual(w2.scene.runner.lane.points[w2.scene.runner.lane.points.length - 1]![0]);
    }
    expect(sawBackward).toBe(true);
    expect(maxSpeed).toBeGreaterThan(FETCH_TUNING.maxSpeed * 0.9);
    // the crate rides in its hands, in front of it
    const m = w2.crew('fetch')!;
    const crate = w2.motion('crate-4')!.pose.p;
    expect(Math.hypot(crate[0] - m.x, crate[2] - m.z)).toBeCloseTo(FETCH_TUNING.handForward, 1);
  });

  test('fumbles after ~4 s of inactivity, offers, and after 12 s ignored fetches the crate back and shrugs', () => {
    const { world } = stubWorld();
    const t = trace(world, steps(30));
    const fumble = t.find((s) => s.state === 'fumble');
    expect(fumble).toBeDefined();
    expect(fumble!.step).toBeGreaterThanOrEqual(steps(FETCH_TUNING.fumbleAfter));
    expect(fumble!.step).toBeLessThan(steps(FETCH_TUNING.fumbleAfter + 4));
    const after = t.filter((s) => s.step >= fumble!.step).map((s) => s.state);
    expect(after.slice(0, 2)).toEqual(['fumble', 'offer']);
    const offer = t.find((s) => s.state === 'offer')!;
    const leave = t.find((s) => s.step > offer.step)!;
    expect(leave.step - offer.step).toBeGreaterThanOrEqual(steps(FETCH_TUNING.ignoredFor));
    expect(after).toContain('pickup');
    expect(after).toContain('shrug');
    expect(world.crew('fetch')?.carrying).toBe('crate-4');
    // the fumbled crate came to rest by itself: charged to the crew, not the visitor
    expect(world.writer('crate-4', 'location')).toBe('crew');
    expect(world.touched('crate-4')).toBe(false);
  });

  test('R1: the pointer on the offered crate holds the offer (to 12 s in all); hover is not an action', () => {
    const offerLength = (hover: boolean): number => {
      const { world } = stubWorld();
      let i = 0;
      while (world.crew('fetch')?.state !== 'offer' && i++ < steps(30)) run(world, 1);
      const from = world.step;
      if (hover) world.dispatch({ type: 'hover', id: 'crate-4' });
      while (world.crew('fetch')?.state === 'offer' && i++ < steps(60)) {
        // a reaching hand: the pointer stays on the crate (hover intents keep coming as it moves over it)
        if (hover && (world.step - from) % 30 === 0) world.dispatch({ type: 'hover', id: 'crate-4' });
        run(world, 1);
      }
      expect(world.playMode).toBe(false);
      return (world.step - from) / 60;
    };
    expect(offerLength(false)).toBeCloseTo(FETCH_TUNING.ignoredFor, 1);
    expect(offerLength(true)).toBeCloseTo(FETCH_TUNING.offerHeldFor, 1);
  });

  test('the offer looks at the crate, then out at the visitor', () => {
    const { world } = stubWorld();
    let looks: string[] = [];
    for (let i = 0; i < steps(12); i++) {
      world.advance();
      world.drainEvents();
      const m = world.crew('fetch')!;
      if (m.state === 'offer') looks.push(m.lookAt && m.lookAt[2] > 5 ? 'out' : m.lookAt ? 'crate' : 'none');
    }
    looks = looks.filter((x, i) => looks[i - 1] !== x);
    expect(looks).toEqual(['crate', 'out']);
  });

  test('never nag: at most one fumble per 40 s', () => {
    const { world } = stubWorld();
    const t = trace(world, steps(130));
    const fumbles = t.filter((s) => s.state === 'fumble').map((s) => s.step);
    expect(fumbles.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < fumbles.length; i++) expect(fumbles[i]! - fumbles[i - 1]!).toBeGreaterThanOrEqual(steps(FETCH_TUNING.fumbleEvery));
  });

  test('never after the visitor\'s first action', () => {
    const { world } = stubWorld();
    run(world, 30);
    world.dispatch({ type: 'press', id: 'button' });
    const t = trace(world, steps(120));
    expect(world.playMode).toBe(true);
    expect(t.filter((s) => s.state === 'fumble')).toEqual([]);
  });

  test('input of any kind (even hovering) resets the inactivity timer', () => {
    const { world } = stubWorld();
    const states: string[] = [];
    for (let i = 0; i < steps(30); i++) {
      if (i % steps(3) === 0) world.dispatch({ type: 'hover', id: i % 2 ? 'button' : null });
      world.advance();
      states.push(...crewStates(world.drainEvents()));
    }
    expect(world.playMode).toBe(false);
    expect(states).not.toContain('fumble');
  });

  test('rule 5: once the visitor has touched the fumbled crate, Fetch never takes it again', () => {
    const { world } = stubWorld();
    let i = 0;
    while (world.crew('fetch')?.state !== 'offer' && i++ < steps(15)) run(world, 1);
    expect(world.crew('fetch')?.state).toBe('offer');
    const at = world.motion('crate-4')!.pose.p;
    world.dispatch({ type: 'grab', id: 'crate-4', grip: at });
    run(world, 2);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const ev: SimEvent[] = run(world, steps(90));
    expect(world.touched('crate-4')).toBe(true);
    expect(crewStates(ev)).not.toContain('pickup');
    for (let k = 0; k < steps(30); k++) {
      run(world, 1);
      expect(world.crew('fetch')?.carrying).toBeNull();
    }
  });

  test('taking the crate out of its hands: it salutes and carries on empty-handed', () => {
    const { world } = stubWorld();
    run(world, 10);
    world.dispatch({ type: 'grab', id: 'crate-4', grip: world.motion('crate-4')!.pose.p });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'part.grabbed', id: 'crate-4' });
    expect(world.crew('fetch')).toMatchObject({ state: 'salute', carrying: null });
    expect(world.mode('crate-4')).toBe('held');
  });

  test('picked up: held (wheel spinning); put down, it rights itself and hurries back to its lane', () => {
    const { world } = stubWorld();
    run(world, 10);
    world.dispatch({ type: 'grab', id: 'fetch', grip: world.motion('fetch')!.pose.p });
    run(world, 1);
    expect(world.crew('fetch')).toMatchObject({ state: 'held', carrying: null });
    expect(world.mode('crate-4')).toBe('free'); // it let go of its crate
    for (let i = 0; i < 30; i++) {
      world.dispatch({ type: 'carry', target: [1.5, 1.5, 2.5] });
      run(world, 1);
    }
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const t = trace(world, steps(5));
    expect(t.map((s) => s.state).slice(0, 2)).toEqual(['return', 'idle']);
    const m = world.crew('fetch')!;
    expect(m.z).toBeCloseTo(world.scene.runner.lane.points[0]![1], 9);
    expect(world.mode('fetch')).toBe('crew');
  });

  test('near things: hands up while the visitor carries something near it, and its eye on what is carried', () => {
    const { world } = stubWorld();
    run(world, 10);
    // take its crate (it salutes, empty-handed), and hold it close
    world.dispatch({ type: 'grab', id: 'crate-4', grip: world.motion('crate-4')!.pose.p });
    run(world, 1);
    const f = world.crew('fetch')!;
    const near: [number, number, number] = [f.x + 0.6, 1.2, f.z + 0.6];
    for (let i = 0; i < 20; i++) {
      world.dispatch({ type: 'carry', target: near });
      run(world, 1);
    }
    let m = world.crew('fetch')!;
    expect(m.handsUp).toBe(true);
    expect(m.gaze).toMatchObject({ what: 'held', id: 'crate-4' });
    // carried away, the hands come down; the eye still follows it
    for (let i = 0; i < 40; i++) {
      world.dispatch({ type: 'carry', target: [f.x + 6, 1.2, f.z - 3] });
      run(world, 1);
    }
    m = world.crew('fetch')!;
    expect(m.handsUp).toBe(false);
    expect(m.gaze).toMatchObject({ what: 'held', id: 'crate-4' });
    expect(Math.hypot(m.gaze!.at[0] - world.motion('crate-4')!.pose.p[0], m.gaze!.at[2] - world.motion('crate-4')!.pose.p[2])).toBeLessThan(1e-9);
  });

  test('near things: its eye follows the nearest part on the move, and lets go of it once it rests', () => {
    const { world } = stubWorld();
    run(world, 10);
    world.dispatch({ type: 'grab', id: 'crate-4', grip: world.motion('crate-4')!.pose.p });
    run(world, 1);
    world.dispatch({ type: 'release', velocity: [2.5, 0, 0] });
    run(world, 3);
    expect(world.crew('fetch')!.gaze).toMatchObject({ what: 'moving', id: 'crate-4' });
    run(world, steps(3));
    expect(world.crew('fetch')!.gaze).toBeNull();
  });

  test('frozen while a rung plays, then resumes where it was', () => {
    const { world } = stubWorld();
    let i = 0;
    while (world.crew('fetch')?.state !== 'roll' && i++ < 400) run(world, 1);
    run(world, 10);
    const before = world.crew('fetch')!;
    world.dispatch({ type: 'press', id: 'button' });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'crew.state', id: 'fetch', state: 'frozen', from: 'roll' });
    for (let k = 0; k < steps(5); k++) {
      run(world, 1);
      if (!world.bracketed) break;
      expect(world.crew('fetch')).toMatchObject({ state: 'frozen', x: before.x, z: before.z });
    }
    expect(world.bracketed).toBe(false);
    expect(world.crew('fetch')?.state).toBe('roll');
  });
});
