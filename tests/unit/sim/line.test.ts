// The line's machines, state by state (REWRITE.md § E8 "each machine's states"), on the bench scene with
// the stub physics: every rest is scripted, so each case is exact. The scenarios under real Rapier are
// tests/scenario/line*.test.ts and x2-music.test.ts.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, LINE, CREW_SCALE } from '../../../src/workshop/sim/scenes/bench.ts';
import { BELT_TUNING } from '../../../src/workshop/sim/machines/belt.ts';
import { DOCK_TUNING, MARK_RETURN, MARK_SHIPPED } from '../../../src/workshop/sim/machines/dock.ts';
import { NOTE, OCTAVE } from '../../../src/workshop/sim/machines/striker.ts';
import { TELL_SECONDS } from '../../../src/workshop/sim/machine.ts';
import { inMouth } from '../../../src/workshop/sim/mouths.ts';
import { registryProblems } from '../../../src/workshop/sim/registry.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import type { BeltView, ChuteView, DockView, Id, Machine, SimEvent, StrikerView, Vec3 } from '../../../src/workshop/sim/types.ts';
import type { SceneDesc } from '../../../src/workshop/sim/scene.ts';

const benchStub = (scene: SceneDesc = bench) => stubWorld(1, { scene });
const beltOf = (w: World) => w.machine('belt') as BeltView;
const dockOf = (w: World) => w.machine('dock') as DockView;
const strikerOf = (w: World) => w.machine('striker') as StrikerView;

/** The visitor sets `id` down on the belt at x (scripted landing), and it comes to rest there. */
function setOnBelt(w: World, ph: StubPhysics, id: Id, x: number): SimEvent[] {
  const h = w.halfExtents(id)![1];
  const m = w.motion(id)!;
  w.dispatch({ type: 'grab', id, grip: m.pose.p });
  run(w, 1);
  ph.land(id, { p: [x, LINE.belt.top + h, LINE.belt.z], q: qyaw(0) }, 6);
  w.dispatch({ type: 'release', velocity: [3, 1, 0] });
  return run(w, 40);
}
const lever = (w: World, v: number) => {
  w.dispatch({ type: 'turn', id: 'belt-lever', value: v });
  return run(w, 1);
};

describe('the bench registry', () => {
  test('the line is in the registry: belt, dial, lever, striker, dock, chute; every one with a name, a tell and a misfire', () => {
    const { world } = benchStub();
    const all = [...world.interactables()];
    expect(registryProblems(all)).toEqual([]);
    for (const id of ['belt', 'belt-dial', 'belt-lever', 'striker', 'dock', 'chute']) expect(all.map((i) => i.id)).toContain(id);
    for (const id of ['belt', 'striker', 'dock', 'chute']) expect(world.machine(id)?.kind).toBe(id);
  });

  test('spares wait behind the dock door: shipped, out of the world', () => {
    const { world } = benchStub();
    for (const id of ['crate-spare-1', 'crate-spare-2', 'crate-spare-3']) {
      expect(world.part(id)!.location).toEqual({ at: 'shipped' });
      expect(world.mode(id)).toBe('gone');
      expect(world.motion(id)!.pose.p[1]).toBeLessThan(-1);
    }
  });

  test('a mouth is a turned box: inMouth follows its yaw', () => {
    const m = { id: 'm', machine: 'x', station: 'line' as const, c: [0, 0, 0] as Vec3, half: [1, 1, 0.1] as Vec3, yaw: 90, drop: [0, 0, 0] as Vec3 };
    expect(inMouth(m, [0, 0, 0.9])).toBe(true); // turned 90°: its long side runs along Z
    expect(inMouth(m, [0.9, 0, 0])).toBe(false);
    expect(inMouth({ ...m, yaw: 0 }, [0.9, 0, 0])).toBe(true);
  });
});

describe('the belt: settings and handles', () => {
  test('starts running forward at the middle detent', () => {
    const { world } = benchStub();
    run(world, 2);
    const b = beltOf(world);
    expect([b.speed, b.direction, b.running, b.detents]).toEqual([3, 'forward', true, 5]);
    expect(b.surface).toBeCloseTo(BELT_TUNING.speeds[2]!, 6);
    expect(b.lamp).toBe('steady');
  });

  test('the dial snaps to five detents; the speed changes on the next step (§ E0: within 100 ms)', () => {
    const { world } = benchStub();
    run(world, 2);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0.97 });
    const ev = run(world, 1);
    expect(world.setting('belt', 'speed')).toBe(5);
    expect(ev.find((e) => e.type === 'handle.worked')).toEqual({ type: 'handle.worked', id: 'belt-dial', value: 1 });
    const v0 = BELT_TUNING.speeds[2]!;
    const v1 = BELT_TUNING.speeds[4]!;
    expect(beltOf(world).surface).toBeGreaterThan(v0); // already moving faster in this step
    run(world, 5); // 100 ms
    expect((beltOf(world).surface - v0) / (v1 - v0)).toBeGreaterThan(0.6);
    for (const [v, d] of [[0, 1], [0.24, 2], [0.5, 3], [0.6, 3], [0.76, 4]] as const) {
      world.dispatch({ type: 'turn', id: 'belt-dial', value: v });
      run(world, 40);
      expect(world.setting('belt', 'speed')).toBe(d);
    }
  });

  test('one drag of the dial through several detents is one transaction; a pause makes a new one', () => {
    const { world } = benchStub();
    run(world, 2);
    for (const v of [0.6, 0.8, 1]) {
      world.dispatch({ type: 'turn', id: 'belt-dial', value: v });
      run(world, 3);
    }
    expect(world.undoStack().length).toBe(1);
    expect(world.undoStack()[0]!.entries[0]).toMatchObject({ field: 'speed', before: 3, after: 5 });
    run(world, HZ);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    run(world, 1);
    expect(world.undoStack().length).toBe(2);
    world.dispatch({ type: 'undo' });
    run(world, 1);
    expect(world.setting('belt', 'speed')).toBe(5);
    world.dispatch({ type: 'undo' });
    run(world, 1);
    expect(world.setting('belt', 'speed')).toBe(3);
  });

  test('the lever is a three-way switch: backward, stop, forward; pressed, it goes forward, stop, backward, stop, forward', () => {
    const { world } = benchStub();
    run(world, 2);
    const state = () => [world.setting('belt', 'running'), world.setting('belt', 'direction')];
    lever(world, 0.5);
    expect(state()).toEqual([false, 'forward']);
    run(world, 60);
    expect(beltOf(world).surface).toBe(0);
    expect(beltOf(world).lamp).toBe('dark');
    lever(world, 0);
    expect(state()).toEqual([true, 'backward']);
    run(world, 60);
    expect(beltOf(world).surface).toBeCloseTo(-BELT_TUNING.speeds[2]!, 6);
    lever(world, 1);
    expect(state()).toEqual([true, 'forward']);
    const seen: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      world.dispatch({ type: 'press', id: 'belt-lever' });
      run(world, 1);
      seen.push(state());
    }
    expect(seen).toEqual([[false, 'forward'], [true, 'backward'], [false, 'backward'], [true, 'forward']]);
  });

  test('pressing the dial steps it up a detent, round to the slowest after the fastest', () => {
    const { world } = benchStub();
    const got: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      world.dispatch({ type: 'press', id: 'belt-dial' });
      run(world, 1);
      got.push(world.setting('belt', 'speed'));
    }
    expect(got).toEqual([4, 5, 1, 2]);
  });

  test('instruct (the BELT jack): faster, slower, stop, go, reverse; at the ends it says what it wanted', () => {
    // the machine as the switchboard finds it, through its context
    let m!: Machine;
    const w2 = stubWorld(1, {
      scene: bench,
      units: [
        (ctx) => {
          m = ctx.machine('belt')!;
          return { id: 'probe' };
        },
      ],
    }).world;
    expect(m.instruct!({ verb: 'belt.set', args: { speed: 1 } }, 'system')).toEqual({ ok: true });
    expect(w2.setting('belt', 'speed')).toBe(4);
    expect(m.instruct!({ verb: 'belt.set', args: { speed: 1 } }, 'system')).toEqual({ ok: true });
    expect(m.instruct!({ verb: 'belt.set', args: { speed: 1 } }, 'system')).toEqual({ ok: false, wanted: 'belt.fastest' });
    expect(w2.setting('belt', 'speed')).toBe(5);
    expect(m.instruct!({ verb: 'belt.set', args: { running: false } }, 'system')).toEqual({ ok: true });
    expect(w2.setting('belt', 'running')).toBe(false);
    expect(m.instruct!({ verb: 'belt.set', args: { direction: 'flip' } }, 'system')).toEqual({ ok: true });
    expect(w2.setting('belt', 'direction')).toBe('backward');
    expect(m.instruct!({ verb: 'belt.set', args: { direction: 'forward', running: true } }, 'system')).toEqual({ ok: true });
    expect([w2.setting('belt', 'running'), w2.setting('belt', 'direction')]).toEqual([true, 'forward']);
    for (let i = 0; i < 4; i++) m.instruct!({ verb: 'belt.set', args: { speed: -1 } }, 'system');
    expect(m.instruct!({ verb: 'belt.set', args: { speed: -1 } }, 'system')).toEqual({ ok: false, wanted: 'belt.slowest' });
  });

  test('a tell blinks its lamp until the belt is used; a misfire lurches the surface back, transiently', () => {
    const { world } = benchStub();
    run(world, 2);
    world.interactable('belt')!.tell();
    expect(beltOf(world).lamp).toBe('blink');
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 1);
    expect(beltOf(world).lamp).toBe('steady');
    world.interactable('belt')!.tell();
    run(world, TELL_SECONDS * HZ + 1);
    expect(beltOf(world).lamp).toBe('steady');
    const before = world.durable();
    world.interactable('belt')!.misfire(2);
    expect(beltOf(world).surface).toBe(BELT_TUNING.lurch.speed * 2);
    expect(beltOf(world).misfire).toEqual({ level: 2, since: 0 });
    run(world, HZ);
    expect(beltOf(world).surface).toBeGreaterThan(0);
    expect(world.durable()).toEqual(before);
  });
});

describe('the belt carries whatever is put on it', () => {
  test('a part at rest on it is taken in (law 2), rides at the surface speed, and leaves the far end onto the ramp', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    const ev = setOnBelt(world, physics, 'crate-3', 0);
    expect(ev.find((e) => e.type === 'taken-in')).toEqual({ type: 'taken-in', id: 'belt', part: 'crate-3', mouth: 'belt' });
    expect(world.mode('crate-3')).toBe('machine');
    const x0 = world.motion('crate-3')!.pose.p[0];
    run(world, HZ);
    expect(world.motion('crate-3')!.pose.p[0] - x0).toBeCloseTo(BELT_TUNING.speeds[2]!, 2);
    // stopped, it waits on the belt, still in it
    lever(world, 0.5);
    run(world, HZ);
    const x1 = world.motion('crate-3')!.pose.p[0];
    run(world, HZ);
    expect(world.motion('crate-3')!.pose.p[0]).toBe(x1);
    expect(world.part('crate-3')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    lever(world, 1);
    const out: SimEvent[] = run(world, 6 * HZ);
    expect(out.some((e) => e.type === 'taken-in' && e.id === 'dock' && e.part === 'crate-3')).toBe(true);
  });

  test('anything: a robot rides too (Fetch)', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    setOnBelt(world, physics, 'fetch', 0);
    expect(beltOf(world).riding).toEqual(['fetch']);
    expect(world.crew('fetch')!.state).toBe('held');
  });
});

describe('the striker', () => {
  test('strikes each riding part in the step its centre passes under the arm, either way, with its note and octave', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    setOnBelt(world, physics, 'crate-1', LINE.strikerX - 1);
    let hit: { step: number; e: SimEvent } | null = null;
    for (let i = 0; i < 3 * HZ && !hit; i++) {
      for (const e of run(world, 1)) if (e.type === 'struck') hit = { step: world.step, e };
      if (!hit) expect(world.motion('crate-1')!.pose.p[0]).toBeLessThan(LINE.strikerX);
    }
    expect(hit!.e).toEqual({ type: 'struck', id: 'striker', part: 'crate-1', size: 'L', material: 'wood', note: NOTE.L, octave: OCTAVE.wood });
    expect(world.motion('crate-1')!.pose.p[0]).toBeGreaterThanOrEqual(LINE.strikerX);
    expect(strikerOf(world)).toMatchObject({ last: 'crate-1', since: 0, lamp: 'steady' });
    // back again under the lever: struck again
    lever(world, 0);
    const back = run(world, 2 * HZ).filter((e) => e.type === 'struck');
    expect(back.length).toBe(1);
  });

  test('cocks as a part approaches; a misfire strikes the air; it writes nothing', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    setOnBelt(world, physics, 'crate-3', LINE.strikerX - 1.9);
    run(world, 20);
    const c0 = strikerOf(world).cock;
    run(world, 10);
    expect(strikerOf(world).cock).toBeGreaterThan(c0);
    const before = world.durable();
    world.interactable('striker')!.misfire(1);
    expect(world.drainEvents()).toEqual([
      { type: 'misfire', id: 'striker', level: 1 },
      { type: 'struck', id: 'striker', part: null, size: null, material: null, note: 0, octave: 0 },
    ]);
    expect(world.durable()).toEqual(before);
  });

  test('S7: it tells the view when the next strike is due, at every speed; null when nothing is coming', () => {
    for (const detent of [1, 5]) {
      const { world, physics } = benchStub();
      run(world, 2);
      expect(strikerOf(world).next).toBeNull();
      world.dispatch({ type: 'turn', id: 'belt-dial', value: (detent - 1) / 4 });
      run(world, 40);
      setOnBelt(world, physics, 'crate-1', LINE.strikerX - 3);
      run(world, 10); // riding at the belt's pace
      const said = strikerOf(world).next;
      expect(said, `detent ${detent}`).not.toBeNull();
      const from = world.step;
      let at = -1;
      for (let i = 0; i < 10 * HZ && at < 0; i++) for (const e of run(world, 1)) if (e.type === 'struck') at = world.step;
      // within a step of what it said
      expect(Math.abs((at - from) / HZ - said!), `detent ${detent}`).toBeLessThanOrEqual(1.5 / HZ);
      // counting down as it comes, and null once nothing else is coming
      expect(strikerOf(world).next).toBeNull();
    }
    // stopped: nothing is coming
    const { world, physics } = benchStub();
    run(world, 2);
    setOnBelt(world, physics, 'crate-1', LINE.strikerX - 1.9);
    run(world, 20);
    lever(world, 0.5);
    run(world, 60);
    expect(strikerOf(world).next).toBeNull();
  });

  test('notes: three sizes, three notes, large is low; metal an octave above wood', () => {
    expect(NOTE.L).toBeLessThan(NOTE.M);
    expect(NOTE.M).toBeLessThan(NOTE.S);
    expect(OCTAVE.metal - OCTAVE.wood).toBe(1);
  });
});

describe('the dock', () => {
  test('takes in what rests on its ramp, opens, rolls it through, ships it with a mark and a bell, shuts', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    lever(world, 0.5);
    const id = 'crate-3';
    const m = world.motion(id)!;
    world.dispatch({ type: 'grab', id, grip: m.pose.p });
    run(world, 1);
    physics.land(id, { p: [LINE.belt.to + 0.5, LINE.belt.top + 0.225, LINE.belt.z], q: qyaw(0) }, 6);
    world.dispatch({ type: 'release', velocity: [3, 1, 0] });
    const ev = run(world, 40);
    expect(ev.find((e) => e.type === 'taken-in')).toEqual({ type: 'taken-in', id: 'dock', part: id, mouth: 'dock' });
    expect(world.part(id)!.location).toEqual({ at: 'in', station: 'line', mouth: 'dock' });
    expect(dockOf(world).shipping).toEqual([id]);
    expect(dockOf(world).lamp).toBe('steady');
    const door: number[] = [];
    const out: SimEvent[] = [];
    for (let i = 0; i < 4 * HZ; i++) {
      out.push(...run(world, 1));
      door.push(dockOf(world).door);
    }
    expect(out.filter((e) => e.type === 'door').map((e) => (e as { open: boolean }).open)).toEqual([false]); // (it opened as it took it in, above)
    expect(Math.max(...door)).toBe(1);
    expect(door.at(-1)).toBe(0);
    expect(out.find((e) => e.type === 'shipped')).toEqual({ type: 'shipped', id: 'dock', part: id });
    expect(world.part(id)!.marks).toEqual([MARK_SHIPPED]);
    expect(world.mode(id)).toBe('gone');
    expect(out.find((e) => e.type === 'restocked')).toMatchObject({ part: 'crate-spare-1' });
  });

  test('a misfire jumps the door open and shut; nothing durable changes', () => {
    const { world } = benchStub();
    run(world, 2);
    const before = world.durable();
    world.interactable('dock')!.misfire(1);
    run(world, 1);
    expect(dockOf(world).door).toBeGreaterThan(0.5);
    run(world, 2 * HZ);
    expect(dockOf(world).door).toBe(0);
    expect(world.durable()).toEqual(before);
  });

  test('restocking runs out of spares and then reuses the longest-shipped crate, put away first', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    const ship = (id: Id) => {
      setOnBelt(world, physics, id, LINE.belt.to - 0.3);
      for (let i = 0; i < 8 * HZ && world.part(id)!.location.at !== 'shipped'; i++) run(world, 1);
      expect(world.part(id)!.location.at).toBe('shipped');
      run(world, 3 * HZ);
    };
    for (const id of ['crate-3', 'crate-2', 'crate-1', 'crate-4']) ship(id);
    const restocked = world.drainEvents();
    void restocked;
    // three spares went to the stack; the fourth replacement is crate-3, forgotten by the history first
    expect(world.part('crate-3')!.location.at).toBe('rest');
    expect(world.part('crate-3')!.marks).toEqual([]);
    expect(world.writer('crate-3', 'location')).toBe('system');
    for (const t of world.undoStack()) expect(t.entries.some((e) => e.target === 'crate-3')).toBe(false);
  });
});

describe('the bench edge, the safety net', () => {
  test('a part forced inside the bench (below its top, inside its footprint) goes back up the chute, as if it had fallen off', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    const m = world.motion('crate-3')!;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    run(world, 1);
    physics.land('crate-3', { p: [0, -0.18, 2.5], q: qyaw(0) }, 6);
    world.dispatch({ type: 'release', velocity: [3, 1, 0] });
    const ev = run(world, 3 * HZ);
    expect(ev.find((e) => e.type === 'part.returned')).toEqual({ type: 'part.returned', id: 'crate-3' });
    const p = world.motion('crate-3')!.pose.p;
    expect(p[1]).toBeGreaterThan(0);
    // and it never came to rest down there: no location below the top was ever written
    for (const e of ev) if (e.type === 'effect' && e.effect.target === 'crate-3' && e.effect.field === 'location') expect((e.effect.after as { at: string; pose?: { p: number[] } }).pose?.p[1] ?? 1).toBeGreaterThan(0);
  });
});

describe('the chute', () => {
  test('kicks its flap when a part pops out, and counts what waits inside', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    const m = world.motion('crate-3')!;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    run(world, 1);
    physics.land('crate-3', { p: [12, -3, 0], q: qyaw(0) }, 10);
    world.dispatch({ type: 'release', velocity: [3, 0, 0] });
    run(world, 12);
    expect((world.machine('chute') as ChuteView).waiting).toBe(1);
    const ev = run(world, 2 * HZ);
    expect(ev.find((e) => e.type === 'flap')).toEqual({ type: 'flap', id: 'chute', part: 'crate-3' });
    expect((world.machine('chute') as ChuteView).waiting).toBe(0);
    expect((world.machine('chute') as ChuteView).flap).toBeLessThan(2);
  });
});

describe('law 2: a machine that wants something else says so', () => {
  test('the world prints the slip it names, and the part rests where it is', () => {
    const wanting = {
      ...bench,
      mouths: [{ id: 'fussy', machine: 'fussy', station: 'line' as const, c: [0, 1, -1] as Vec3, half: [1, 1, 1] as Vec3, drop: [0, 0, -1] as Vec3 }],
      units: [
        ...bench.units!,
        () => ({ id: 'fussy', station: 'line' as const, name: 'name.belt', affordances: [], tell() {}, misfire() {}, accept: () => ({ ok: false as const, wanted: 'slip.wants-blue' }), abort() {}, view: () => ({ kind: 'chute' as const, id: 'fussy', station: 'line' as const, lamp: 'dark' as const, misfire: null, flap: Infinity, waiting: 0 }) }),
      ],
    };
    const { world, physics } = stubWorld(1, { scene: wanting });
    run(world, 2);
    const m = world.motion('crate-3')!;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    run(world, 1);
    physics.land('crate-3', { p: [0.2, 0.225, -1.2], q: qyaw(0) }, 6);
    world.dispatch({ type: 'release', velocity: [3, 1, 0] });
    const ev = run(world, 40);
    expect(ev.find((e) => e.type === 'card')).toEqual({ type: 'card', by: 'fussy', content: 'slip.wants-blue' });
    expect(world.part('crate-3')!.location.at).toBe('rest');
    expect(world.mode('crate-3')).toBe('free');
  });

  test('tap-then-tap carrying puts a part at a mouth by its id', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    const m = world.motion('crate-3')!;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    run(world, 1);
    const drop = bench.mouths!.find((x) => x.id === 'belt')!.drop;
    physics.land('crate-3', { p: [drop[0], drop[1] + 0.225, drop[2]], q: qyaw(0) }, 2);
    world.dispatch({ type: 'place', at: 'belt' });
    run(world, 40);
    expect(world.part('crate-3')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    world.dispatch({ type: 'place', at: 'nowhere' });
    expect(run(world, 1).length).toBeGreaterThanOrEqual(0);
  });
});

describe('Fetch at crew scale', () => {
  test("the bench's Fetch is 1.25× P1: its body box, and its hands where the bigger body puts them", () => {
    const { world } = benchStub();
    run(world, 2);
    const half = world.halfExtents('fetch')!;
    const p1 = defaultHalfExtents('robot', 'M');
    for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo(p1[k]! * CREW_SCALE, 9);
    expect(world.motion('fetch')!.pose.p[1]).toBeCloseTo(FETCH_TUNING.bodyHalfHeight * CREW_SCALE, 6);
    const c = world.crew('fetch')!;
    const crate = world.motion('crate-4')!.pose.p;
    expect(crate[1]).toBeCloseTo(FETCH_TUNING.handHeight * CREW_SCALE, 2);
    expect(Math.hypot(crate[0] - c.x, crate[2] - c.z)).toBeCloseTo((FETCH_TUNING.bodyHalfDepth + FETCH_TUNING.handGap) * CREW_SCALE + 0.225, 2);
  });
});
