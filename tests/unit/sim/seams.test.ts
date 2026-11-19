// S6: the seams between the five simulation packages, one describe per seam, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { AT, bench, LINE, PATCHLAMP } from '../../../src/workshop/sim/scenes/bench.ts';
import type { CrewView, LampView, PatchView, RevertView, SimEvent, Vec3 } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import { KNOCK_TUNING, distanceTo } from '../../../src/workshop/sim/crew/fetch-knock.ts';

const benchStub = () => stubWorld(1, { scene: bench });

describe('seam 1: one crew', () => {
  test('the world lists the whole crew in step order, each as the view it already had', () => {
    const { world } = benchStub();
    run(world, 2);
    const crew = world.crewViews();
    expect(crew.map((c) => c.kind)).toEqual(['fetch', 'revert', 'patch']);
    const fetch = crew[0] as Extract<CrewView, { kind: 'fetch' }>;
    expect(fetch.member).toEqual(world.crew('fetch'));
    const revert = crew[1] as Extract<CrewView, { kind: 'revert' }>;
    expect(revert.view).toEqual(world.machine('revert-crew'));
    const patch = crew[2] as Extract<CrewView, { kind: 'patch' }>;
    expect(patch.view).toEqual(world.machine('patch'));
    expect(patch.body).toBeNull();
  });

  test('a member is found by its unit id or by its body, and nothing else is crew', () => {
    const { world } = benchStub();
    expect(world.crewView('fetch')?.kind).toBe('fetch');
    expect(world.crewView('revert')?.kind).toBe('revert');
    expect(world.crewView('revert-crew')?.kind).toBe('revert');
    expect(world.crewView('patch')?.kind).toBe('patch');
    for (const id of ['crate-1', 'belt', 'button', 'nobody']) expect(world.crewView(id)).toBeUndefined();
  });
});

describe('seam 2: one grab', () => {
  test('grab, carry and release lift Patch off its stool and put it down, as drag did; holding() knows', () => {
    const { world } = benchStub();
    run(world, 2);
    const patch = () => world.machine('patch') as PatchView;
    const seat = patch().at;
    world.dispatch({ type: 'grab', id: 'patch', grip: [seat[0], seat[1] + 1, seat[2]] });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'patch' });
    expect(world.playMode).toBe(true);
    expect(patch().state).toBe('held');
    world.dispatch({ type: 'carry', target: [0, 2, 1] });
    run(world, 1);
    expect(patch().at).toEqual([0, 2, 1]);
    world.dispatch({ type: 'release', velocity: [3, 0, 0] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(['walk', 'climb']).toContain(patch().state);
  });

  test("the lamp's shade: one grab, the arm follows the hand, one transaction when it is let go", () => {
    const { world } = benchStub();
    const lamp = () => world.machine('lamp') as LampView;
    const home = lamp().aim;
    world.dispatch({ type: 'grab', id: 'lamp', grip: home });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'lamp' });
    for (let i = 1; i <= 30; i++) {
      world.dispatch({ type: 'carry', target: [home[0] + i * 0.03, home[1], home[2] - i * 0.02] });
      run(world, 1);
    }
    expect(lamp().dragging).toBe(true);
    expect(world.undoStack()).toHaveLength(0); // nothing durable while the hand has it
    run(world, 6 * 60); // a hand held still longer than the lost-drag timeout is still holding
    expect(lamp().dragging).toBe(true);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(lamp().dragging).toBe(false);
    expect(world.undoStack()).toHaveLength(1);
    expect(world.setting('lamp', 'x')).not.toBe(home[0]);
    world.dispatch({ type: 'undo' });
    run(world, 1);
    expect(lamp().aim[0]).toBeCloseTo(home[0], 6);
  });

  test('while the hand holds a unit nothing else can be picked up, and the Button does not play', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'patch', grip: [3, 2, -3] });
    run(world, 1);
    const m = world.motion('crate-1')!;
    world.dispatch({ type: 'grab', id: 'crate-1', grip: m.pose.p });
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'patch' });
    expect(world.button().phase).toBe('idle');
  });

  test('a grab of something neither loose nor holdable is refused, and is not a first action', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'belt', grip: [0, 0.5, 3.9] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(world.playMode).toBe(false);
  });

  test('a grab of Fetch or Revert (loose bodies) still holds a part', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'fetch', grip: world.motion('fetch')!.pose.p });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'part', id: 'fetch' });
  });

  test('Reset the workshop lets go of a held unit', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'patch', grip: [3, 2, -3] });
    run(world, 1);
    world.dispatch({ type: 'reset' });
    run(world, 1);
    expect(world.holding()).toBeNull();
  });
});

describe('seam 4: the ladder knows every station', () => {
  const ladder = bench.button.ladder!;

  test('the platen, the storefront, the lamp, the phone line and the switchboard (the cord) are on it, each a live interactable', () => {
    const { world } = benchStub();
    const ids = ladder.stations.map((s) => s.id);
    for (const id of ['platen', 'storefront', 'lamp', 'line', 'cord']) expect(ids).toContain(id);
    for (const id of ids) expect(world.interactable(id), id).toBeDefined();
  });

  test('each misfire is one transient beat of its verb: a misfire event, a beat its view shows, nothing durable', () => {
    const { world } = benchStub();
    run(world, 2);
    const before = world.durable();
    for (const id of ['platen', 'storefront', 'lamp', 'line', 'cord']) {
      world.interactable(id)!.misfire(1);
      const ev = run(world, 1);
      expect(ev).toContainEqual({ type: 'misfire', id, level: 1 });
      expect(ev.some((e) => e.type === 'effect'), id).toBe(false);
      const shown = id === 'cord' ? world.cord('cord')!.misfire : world.machine(id)!.misfire;
      expect(shown, id).toMatchObject({ level: 1 });
      expect(shown!.since).toBeLessThan(0.1);
    }
    expect(world.durable()).toEqual(before);
  });

  test('a rung can misfire a Patchlamp station: rung 2 picks the nearest unused one, and it plays once', () => {
    const { world } = benchStub();
    run(world, 10);
    const at = bench.button.at;
    const nearest = ladder.stations
      .filter((s) => s.id !== ladder.lamp && !bench.button.flinch.includes(s.id))
      .map((s) => ({ id: s.id, d: Math.hypot(s.at[0] - at[0], s.at[2] - at[2]) }))
      .sort((a, b) => a.d - b.d)[0]!.id;
    expect(['line', 'platen', 'storefront', 'cord', 'undo-lever', 'striker', 'dock', 'chute']).toContain(nearest);
    for (const _ of [1, 2]) {
      world.dispatch({ type: 'press', id: 'button' });
      run(world, 1);
      for (let i = 0; i < 2000 && world.bracketed; i++) run(world, 1);
    }
    expect(world.button().rung).toBe(2);
    expect(world.button().targets).toEqual([nearest]);
  });

  test('a text sent counts as using the phone line; nothing the crew does counts', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'text', text: 'help' });
    run(world, 2);
    expect(world.button().used).toEqual(['line']);
  });
});

describe("seam 5: Patch's job has room to perform: the roll, and a little air", () => {
  const patch = (w: World) => w.machine('patch') as PatchView;
  /** Move the cord to `jack` (one step each way). */
  const plug = (w: World, jack: string) => {
    w.dispatch({ type: 'unplug', cord: 'cord' });
    run(w, 1);
    w.dispatch({ type: 'plug', cord: 'cord', jack });
    run(w, 1);
  };
  /** Send a text; return the steps from sending to the change and to the reply, and Patch's states on the way. */
  function timeJob(w: World, text: string): { change: number; reply: number; states: string[] } {
    w.dispatch({ type: 'text', text });
    const from = w.step + 1;
    let change = -1;
    let reply = -1;
    const states: string[] = [];
    for (let i = 0; i < 12 * 60 && reply < 0; i++) {
      for (const e of run(w, 1)) {
        if (e.type === 'effect' && change < 0) change = w.step - from;
        if (e.type === 'line.reply' || e.type === 'line.refused') reply = w.step - from;
        if (e.type === 'crew.state' && e.id === 'patch') states.push(e.state);
      }
    }
    return { change, reply, states };
  }

  test('free and already at that jack: the change shows about 2.6 s after the text, the reply about 4.5 s; no roll', () => {
    const { world } = benchStub();
    plug(world, 'jack-lamp');
    timeJob(world, 'dimmer'); // the stool rolls to LAMP
    const r = timeJob(world, 'brighter'); // already there
    expect(r.states).toEqual(['notice', 'drawer', 'work', 'check', 'reply', 'seated']);
    expect(r.change / 60).toBeCloseTo(2.6, 1);
    expect(r.reply / 60).toBeCloseTo(4.5, 1);
  });

  test('the roll is as long as the way along the runner (1.2 s for the whole of it), the plan says so, and the stool is published', () => {
    const { world } = benchStub();
    const s = patch(world).stool;
    expect(s.x).toBe(s.rest);
    expect(s.min).toBeLessThan(s.rest);
    // the cord starts in STOREFRONT: the stool rolls from its rest to that jack
    world.dispatch({ type: 'text', text: 'make the sign red' });
    run(world, 1);
    const plan = patch(world).plan!;
    expect(plan.map((p) => p.state)).toEqual(['notice', 'roll', 'drawer', 'work', 'check', 'reply']);
    const roll = plan[1]!.length;
    const to = AT.stoolAt.storefront[0];
    expect(roll).toBeCloseTo((1.2 * (s.rest - to)) / (s.rest - s.min), 6);
    expect(roll).toBeGreaterThan(0.3);
    expect(roll).toBeLessThanOrEqual(1.2);
    // during the roll the stool moves along the runner, Patch with it, and the stage's length is published
    run(world, Math.round(0.5 * 60) + 20);
    expect(patch(world).state).toBe('roll');
    expect(patch(world).stateLength).toBeCloseTo(roll, 6);
    const mid = patch(world).stool;
    expect(mid.x).toBeLessThan(s.rest);
    expect(mid.x).toBeGreaterThan(to);
    expect(mid.roll).toEqual({ from: s.rest, to, home: false });
    run(world, 60);
    expect(patch(world).stool.x).toBeCloseTo(to, 9);
    // the seat moved with the stool
    expect(patch(world).at[0]).toBeCloseTo(PATCHLAMP.patch.seat[0] + (to - s.rest), 9);
  });

  test("after a quiet spell it rolls back to its rest at the runner's right end; a text on the way is picked up from where it is", () => {
    const { world } = benchStub();
    const r = timeJob(world, 'make the sign red');
    expect(r.states.slice(0, 3)).toEqual(['notice', 'roll', 'drawer']);
    const rest = patch(world).stool.rest;
    expect(patch(world).stool.x).toBeLessThan(rest);
    run(world, 3 * 60);
    expect(patch(world).state).toBe('seated'); // not yet: the line has not been quiet long enough
    run(world, 66);
    expect(patch(world).state).toBe('roll');
    expect(patch(world).stool.roll?.home).toBe(true);
    run(world, 12);
    const partway = patch(world).stool.x;
    world.dispatch({ type: 'text', text: 'make the awning blue' });
    run(world, 2);
    expect(['notice', 'roll']).toContain(patch(world).state);
    const x = patch(world).stool.x;
    expect(x).toBeGreaterThanOrEqual(partway);
    expect(x).toBeLessThan(partway + 0.15); // stopped where it was (one step's roll at most), not at rest
    expect(x).toBeLessThan(rest - 1);
    timeJob(world, 'thanks');
    run(world, 12 * 60);
    expect(patch(world).stool.x).toBe(rest);
    expect(patch(world).state).toBe('seated');
  });

  test('lifted mid-roll, it carries on to the same jack from where the stool is once it is back on it', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'text', text: 'make the sign red' });
    run(world, Math.round(0.5 * 60) + 10);
    expect(patch(world).state).toBe('roll');
    const at = patch(world).at;
    world.dispatch({ type: 'grab', id: 'patch', grip: [at[0], at[1] + 1, at[2]] });
    run(world, 1);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(world, 1);
    const states: string[] = [];
    for (let i = 0; i < 10 * 60; i++) for (const e of run(world, 1)) if (e.type === 'crew.state' && e.id === 'patch') states.push(e.state);
    expect(states).toEqual(expect.arrayContaining(['climb', 'roll', 'drawer', 'work', 'check', 'reply']));
    expect(world.setting('storefront', 'sign')).toBe('cable-red');
  });
});

describe('seam 6: Fetch sees Revert', () => {
  /** Keep `id` sliding at Fetch from the side `from` (unit, x/z) for a few steps, then report a contact between them. */
  function hitFetch(world: World, physics: StubPhysics, id: string, from: readonly [number, number], speed: number, impulse = 2): SimEvent[] {
    const f = world.crew('fetch')!;
    const n = 8;
    const back = 0.9 + (speed * n) / 60;
    physics.setPose(id, { p: [f.x + from[0] * back, 0.6, f.z + from[1] * back], q: [0, 0, 0, 1] });
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      physics.setVelocity(id, [-from[0] * speed, 0, -from[1] * speed]);
      physics.wake(id);
      out.push(...run(world, 1));
    }
    physics.contact({ a: id, b: 'fetch', impulse });
    out.push(...run(world, 2));
    return out;
  }
  /**
   * Play mode (a lever pull with nothing to take: Revert comes up), the belt stopped (Fetch waits on its lane
   * with a crate), both idle. S7: Revert goes back down once its card is down and a pause has passed, so
   * this returns early in its stand-by (about two seconds in), not after ten.
   */
  function settle(world: World): void {
    world.dispatch({ type: 'undo' });
    run(world, 1);
    world.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    for (let i = 0; i < 40 * 60; i++) {
      run(world, 1);
      const f = world.crew('fetch')!;
      const r = world.machine('revert-crew') as RevertView;
      if (i > 120 && f.state === 'idle' && f.stateTime > 1 && r.state === 'idle') return;
    }
    throw new Error('the bench did not settle');
  }

  test("a knocked Fetch's slide stops short of Revert's body, as it stops short of any machine", () => {
    const { world, physics } = benchStub();
    settle(world);
    const f = world.crew('fetch')!;
    const r = world.machine('revert-crew') as RevertView;
    const half = world.halfExtents('revert')!;
    const box = { id: 'revert', x: r.x, z: r.z, hx: half[0], hz: half[2], yaw: r.heading };
    // shoved straight at Revert: hit from the far side
    const dx = r.x - f.x;
    const dz = r.z - f.z;
    const d = Math.hypot(dx, dz);
    const thrown = ['crate-1', 'crate-2', 'crate-3', 'crate-4'].find((id) => id !== f.carrying && world.mode(id) === 'free')!;
    const ev = hitFetch(world, physics, thrown, [-dx / d, -dz / d], 7, 3);
    const k = ev.find((e) => e.type === 'crew.knocked') as Extract<SimEvent, { type: 'crew.knocked' }> | undefined;
    expect(k).toBeDefined();
    const fh = world.halfExtents('fetch')!;
    const footprint = Math.hypot(fh[0], fh[2]) + KNOCK_TUNING.margin * (bench.crewScale ?? 1);
    const start = distanceTo(box, world.crew('fetch')!.x, world.crew('fetch')!.z);
    for (let i = 0; i < 90; i++) {
      run(world, 1);
      const m = world.crew('fetch')!;
      if (m.state !== 'knocked') break;
      const now = distanceTo(box, m.x, m.z);
      expect(now >= footprint - 1e-6 || now >= start - 1e-6).toBe(true); // never into Revert (only ever away, if it began closer)
    }
    expect(k!.distance).toBeLessThan((KNOCK_TUNING.distance[k!.strength - 1] as number) * (bench.crewScale ?? 1));
  });

  test('a part that starts inside Fetch (let go of in its body) is not a hit; once clear, a real hit counts once', () => {
    const { world, physics } = benchStub();
    run(world, 30);
    const crate = 'crate-3';
    world.dispatch({ type: 'grab', id: crate, grip: world.motion(crate)!.pose.p });
    run(world, 1);
    const f = world.crew('fetch')!;
    physics.setPose(crate, { p: [f.x + 0.1, 0.5, f.z], q: [0, 0, 0, 1] });
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(world, 1);
    physics.contact({ a: crate, b: 'fetch', impulse: 3 }); // the push that parts them
    const ev = run(world, 3);
    expect(ev.filter((e) => e.type === 'crew.knocked')).toEqual([]);
    expect(ev.filter((e) => e.type === 'crew.nudged')).toEqual([]);
    run(world, 30);
    const real = hitFetch(world, physics, crate, [0, 1], 7, 3);
    expect(real.filter((e) => e.type === 'crew.knocked')).toHaveLength(1);
  });

  test("a part let go of inside Patch's body is not a throw at it", () => {
    const { world, physics } = benchStub();
    const at = (world.machine('patch') as PatchView).at;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
    run(world, 1);
    physics.setPose('crate-3', { p: [at[0], at[1] + 0.75, at[2]], q: [0, 0, 0, 1] });
    world.dispatch({ type: 'release', velocity: [0, 0, 5] });
    const ev = run(world, 60);
    expect(ev.filter((e) => e.type === 'patch.reacted')).toEqual([]);
  });
});

describe("seam 8: a part at the dock's sill", () => {
  const bay = bench.statics.find((s) => s.id === 'dock')!;
  const door = LINE.door;

  test("the dock's collider is the bay behind the door: its front face is the door's plane, its back the piece's", () => {
    expect(bay.shape.type).toBe('box');
    const half = (bay.shape as { half: Vec3 }).half;
    // along the way in, from the door's origin
    const t = (bay.pose.p[0] - door.origin[0]) * door.inward[0] + (bay.pose.p[2] - door.origin[2]) * door.inward[2];
    expect(t - half[2]).toBeCloseTo(0, 6); // front face on the door's plane, nothing over the sill
    const tc = (AT.dock.c[0] - door.origin[0]) * door.inward[0] + (AT.dock.c[2] - door.origin[2]) * door.inward[2];
    expect(t + half[2]).toBeCloseTo(tc + AT.dock.half[2], 6); // the back where the piece's back is
    expect(half[0]).toBe(AT.dock.half[0]);
    expect(half[1]).toBe(AT.dock.half[1]);
  });

  test('a crate on the sill, short of the door plane, can be picked up; one through it cannot', () => {
    /** The S crate set on the ramp's head; run `n` steps (or, n < 0, until its leading face passes the door plane: returns the step count). */
    const ride = (n: number): { world: World; steps: number } => {
      const { world } = benchStub();
      world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
      run(world, 1);
      world.dispatch({ type: 'place', at: 'dock' }); // set down on the ramp's head (tap-then-tap)
      for (let i = 1; i <= (n < 0 ? 10 * 60 : n); i++) {
        run(world, 1);
        if (n >= 0 || world.mode('crate-3') !== 'machine') continue;
        const p = world.motion('crate-3')!.pose.p;
        const along = (p[0] - door.origin[0]) * door.inward[0] + (p[2] - door.origin[2]) * door.inward[2];
        if (along + world.halfExtents('crate-3')![0] > 0) return { world, steps: i };
      }
      return { world, steps: n };
    };
    const through = ride(-1).steps;
    expect(through).toBeGreaterThan(10);
    const tryGrab = (w: World): boolean => {
      w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
      run(w, 1);
      return w.holding()?.id === 'crate-3';
    };
    const before = ride(through - 3).world;
    expect(before.mode('crate-3')).toBe('machine');
    expect(tryGrab(before)).toBe(true);
    const after = ride(through + 1).world;
    expect(after.mode('crate-3')).toBe('machine');
    expect(tryGrab(after)).toBe(false);
  });

  test('the safety net: a part asleep below the bench top inside its footprint goes to the chute, even one that never counted as moving', () => {
    const { world, physics } = benchStub();
    run(world, 2);
    physics.setPose('crate-1', { p: [5.96, -0.09, 3.52], q: [0, 0, 0, 1] });
    physics.sleep('crate-1');
    run(world, 2);
    expect(world.mode('crate-1')).toBe('chute');
  });
});

describe('seam 3: reduced motion at run time; the saved Button; the undo id', () => {
  const press = (w: World): void => {
    w.dispatch({ type: 'press', id: 'button' });
    run(w, 1);
    for (let i = 0; i < 2000 && w.bracketed; i++) run(w, 1);
  };

  test('the motion intent switches the next rung to the card and the lamp dip, and back', () => {
    const { world } = benchStub();
    expect(world.reducedMotion).toBe(false);
    world.dispatch({ type: 'motion', reduced: true });
    run(world, 1);
    expect(world.reducedMotion).toBe(true);
    expect(world.button().reducedMotion).toBe(true);
    press(world);
    expect(world.button().script?.reduced).toBe(true);
    expect(world.button().script?.beats.map((b) => b.kind)).toEqual(['dip', 'rewind', 'card']);
    world.dispatch({ type: 'motion', reduced: false });
    run(world, 1);
    press(world);
    expect(world.button().script?.reduced).toBe(false);
  });

  test('a rung already playing finishes as it began', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 30);
    world.dispatch({ type: 'motion', reduced: true });
    run(world, 1);
    expect(world.button().script?.reduced).toBe(false);
    expect(world.bracketed).toBe(true);
  });

  test('switching it is not a first action and is not input to the crew', () => {
    const fumbleStep = (switchAt: number | null): number => {
      const { world } = benchStub();
      for (let i = 0; i < 12 * 60; i++) {
        if (i === switchAt) world.dispatch({ type: 'motion', reduced: true });
        const ev = run(world, 1);
        if (ev.some((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'fumble')) {
          expect(world.playMode).toBe(false);
          return world.step;
        }
      }
      return -1;
    };
    // Fetch's patience was not reset by a settings switch: the fumble comes at the same step
    expect(fumbleStep(null)).toBeGreaterThan(0);
    expect(fumbleStep(150)).toBe(fumbleStep(null));
  });

  test('a world made from a saved Button (typed ButtonSaved) keeps its reduced motion; the undo id is the lever', () => {
    const { world } = stubWorld(1, { scene: bench, button: { rung: 2, presses: 2, reached: 2, reducedMotion: true } });
    expect(world.reducedMotion).toBe(true);
    expect(world.button().reached).toBe(2);
    expect(world.undoId).toBe('undo-lever');
    expect(world.interactable(world.undoId!)).toBeDefined();
  });
});
