// Revert, the caretaker (REWRITE.md § B5; S4), state by state, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, AT } from '../../../src/workshop/sim/scenes/bench.ts';
import { REVERT_TUNING, CARD_KEPT, CARD_NOTHING } from '../../../src/workshop/sim/crew/revert.ts';
import { BUTTON_TUNING } from '../../../src/workshop/sim/machines/button.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import type { Id, Pose, RevertView, SimEvent } from '../../../src/workshop/sim/types.ts';

const benchStub = () => stubWorld(1, { scene: bench });
/** The bench's "a while" (scenes/bench.ts, Revert's spec), seconds. */
const A_WHILE = 90;
const R = (w: World): RevertView => w.machine('revert-crew') as RevertView;
const press = (w: World, id: string): SimEvent[] => {
  w.dispatch({ type: 'press', id });
  return run(w, 1);
};
function rung(w: World): SimEvent[] {
  const out = press(w, 'button');
  for (let i = 0; i < 2000 && w.bracketed; i++) out.push(...run(w, 1));
  return out;
}
/** The visitor carries `id` and lets it land at (x, z), scripted. */
function setDown(w: World, ph: StubPhysics, id: Id, x: number, z: number, yaw = 0): void {
  const m = w.motion(id)!;
  w.dispatch({ type: 'grab', id, grip: m.pose.p });
  run(w, 1);
  ph.land(id, { p: [x, w.halfExtents(id)![1], z], q: qyaw(yaw) }, 6);
  w.dispatch({ type: 'release', velocity: [2, 1, 0] });
  run(w, 40);
}
const others = (w: World): Map<Id, Pose> => new Map([...w.parts()].filter((p) => p.id !== 'revert').map((p) => [p.id, w.motion(p.id)!.pose]));
const states = (ev: readonly SimEvent[]): string[] => ev.flatMap((e) => (e.type === 'crew.state' && e.id === 'revert' ? [e.state] : []));

describe('Revert at rest', () => {
  test('starts down its hatch: unseen, its body out of the world, the doors shut', () => {
    const { world } = benchStub();
    run(world, 5);
    expect(R(world)).toMatchObject({ kind: 'revert', body: 'revert', state: 'below', lift: 0, hatch: 0, drawn: true, card: null });
    expect(world.mode('revert')).toBe('gone');
    expect(world.part('revert')!.location).toMatchObject({ at: 'rest' }); // its durable place is on its hatch
  });
});

describe('Revert and the Button', () => {
  test('rung 1: it comes up while the rung plays, cranks through the rewind, holds the card; its body joins the world after', () => {
    const { world } = benchStub();
    run(world, 5);
    const ev = press(world, 'button');
    expect(R(world).state).toBe('rising'); // called in the press's own step
    run(world, steps(REVERT_TUNING.rise) + 2);
    expect(R(world)).toMatchObject({ lift: 1, hatch: 1 });
    expect(world.mode('revert')).toBe('gone'); // the rung is recorded and rewound: its body waits
    let cranked = false;
    while (world.bracketed) {
      ev.push(...run(world, 1));
      if (world.button().phase === 'rewinding' && R(world).cranking) cranked = true;
    }
    expect(cranked).toBe(true);
    expect(R(world).card).toMatchObject({ content: 'card.rung1' });
    run(world, 2);
    expect(world.mode('revert')).toBe('crew');
    const p = world.motion('revert')!.pose.p;
    expect(p[0]).toBeCloseTo(AT.revert.c[0], 5);
    expect(p[2]).toBeCloseTo(AT.revert.c[2], 5);
    expect(p[1]).toBeCloseTo(AT.revert.half[1], 5);
    run(world, steps(REVERT_TUNING.card) + 1);
    expect(R(world).card).toBeNull();
    expect(states(ev)).toContain('rising');
  });

  test('rung 3: it trundles to the Button, fits the cover, and goes home', () => {
    const { world } = benchStub();
    run(world, 5);
    rung(world);
    rung(world);
    const ev = rung(world);
    expect(world.button().cover).toBe('fitting');
    let atButton = false;
    for (let i = 0; i < steps(20); i++) {
      ev.push(...run(world, 1));
      const r = R(world);
      if (r.state === 'fit') atButton = Math.hypot(r.x - AT.buttonCap[0], r.z - (AT.console.c[2] - AT.console.half[2] - AT.revert.half[2] - 0.05)) < 0.01;
    }
    expect(atButton).toBe(true);
    const seq = states(ev).filter((s, i, a) => s !== a[i - 1]);
    expect(seq).toEqual(expect.arrayContaining(['trundle', 'fit', 'idle']));
    expect(seq.indexOf('fit')).toBeLessThan(seq.lastIndexOf('idle'));
    expect(world.button().cover).toBe('shut');
    expect(R(world)).toMatchObject({ state: 'idle' });
    expect(R(world).x).toBeCloseTo(AT.revert.c[0], 5);
    expect(R(world).z).toBeCloseTo(AT.revert.c[2], 5);
  });
});

describe('Revert and the UNDO lever: the undo never waits for it', () => {
  test('down in its hatch: the lever is answered in the same step, and Revert is already rising', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    run(world, 40);
    const ev = press(world, 'undo-lever');
    expect(ev.some((e) => e.type === 'undone')).toBe(true);
    expect(world.setting('belt', 'speed')).toBe(3);
    expect(R(world).state).toBe('rising');
    expect(R(world).cranking).toBe(true);
  });

  test('up: it cranks at once', () => {
    const { world } = benchStub();
    run(world, 5);
    rung(world);
    run(world, steps(REVERT_TUNING.card) + 10);
    expect(R(world).state).toBe('idle');
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 40);
    press(world, 'undo-lever');
    expect(R(world).cranking).toBe(true);
    run(world, 1);
    expect(R(world).state).toBe('crank');
    run(world, steps(REVERT_TUNING.undoCrank.max) + 1);
    expect(R(world).state).toBe('idle');
  });

  test('nothing left: the lever still travels, and Revert says so on a card', () => {
    const { world } = benchStub();
    run(world, 5);
    const ev = press(world, 'undo-lever');
    expect(ev).toContainEqual({ type: 'undo.refused', by: 'lever', reason: 'nothing', txn: null });
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: CARD_NOTHING });
    expect(R(world).card?.content).toBe(CARD_NOTHING);
  });

  test('an undo that kept something (the crew wrote it since): someone has moved that since', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    rung(world);
    run(world, steps(REVERT_TUNING.card) + 10);
    // the visitor moves Revert; then Revert's own crew writes where it is (§ E5 D7: the crew may write its own robot)
    setDown(world, physics, 'revert', -5.5, -0.5);
    world.commit([{ target: 'revert', field: 'location', after: { at: 'rest', pose: { p: [-5, AT.revert.half[1], -0.5], q: qyaw(0) } } }], 'crew');
    const ev = press(world, 'undo-lever');
    const u = ev.find((e) => e.type === 'undone');
    expect(u && u.type === 'undone' ? u.kept.map((k) => k.target) : null).toEqual(['revert']);
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: CARD_KEPT });
  });

  test('its hatch covered by something: it never pushes it off; it rattles the doors and stays down', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    setDown(world, physics, 'crate-4', AT.revert.c[0] + 0.2, AT.revert.c[2]);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    run(world, 40);
    const before = others(world);
    const ev = press(world, 'undo-lever'); // takes back the dial, not the crate
    expect(R(world).state).toBe('stuck');
    run(world, steps(REVERT_TUNING.stuck) + 2);
    expect(R(world).state).toBe('below');
    expect(world.mode('revert')).toBe('gone');
    expect(others(world).get('crate-4')).toEqual(before.get('crate-4'));
    expect(ev.some((e) => e.type === 'undone')).toBe(true); // the undo itself did not wait
  });
});

describe('Revert in the hand', () => {
  test('picked up it goes limp; put down it rights itself where it lies and carries on', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    rung(world);
    run(world, 10);
    world.dispatch({ type: 'grab', id: 'revert', grip: world.motion('revert')!.pose.p });
    run(world, 1);
    expect(R(world)).toMatchObject({ state: 'held', eyes: 'rolled', drawn: false });
    physics.land('revert', { p: [-6, AT.revert.half[1], 0.5], q: qyaw(0.4) }, 6);
    world.dispatch({ type: 'release', velocity: [1, 0, 0] });
    run(world, 40);
    expect(R(world)).toMatchObject({ state: 'idle', drawn: true });
    expect(R(world).x).toBeCloseTo(-6, 5);
    expect(R(world).heading).toBeCloseTo(0.4, 5);
    expect(world.mode('revert')).toBe('crew');
  });

  test('it is heavy: the hand moves it more slowly than a crate', () => {
    const lag = (id: Id): number => {
      const { world } = benchStub();
      run(world, 5);
      if (id === 'revert') {
        rung(world);
        run(world, 10);
      }
      const p = world.motion(id)!.pose.p;
      world.dispatch({ type: 'grab', id, grip: p });
      world.dispatch({ type: 'carry', target: [p[0] + 3, p[1] + 1, p[2]] });
      run(world, 6);
      return world.motion(id)!.pose.p[0] - p[0];
    };
    expect(lag('revert')).toBeLessThan(lag('crate-4') * 0.8);
  });
});

describe('Revert between jobs', () => {
  test('a tidy bench for two minutes: it trundles to the window\'s light and powers down, one eye open, moving nothing', () => {
    const { world } = benchStub();
    run(world, 5);
    rung(world);
    const before = others(world);
    const ev = run(world, steps(130));
    expect(states(ev)).toContain('trundle');
    expect(R(world)).toMatchObject({ state: 'park', eyes: 'one' });
    expect(R(world).x).toBeCloseTo(3.3, 5);
    expect(R(world).z).toBeCloseTo(0.45, 5);
    for (const [id, p] of others(world)) if (id !== 'fetch' && id !== 'crate-4') expect(p, id).toEqual(before.get(id));
  });

  test('a crowded bench: after a while it comes up and puts away the oldest crate nobody has stirred, onto the stack', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    // the visitor scatters the stack and takes the loose crate out of Fetch's hands: four strays
    setDown(world, physics, 'crate-3', -6, -3);
    const first = world.step;
    run(world, steps(5));
    setDown(world, physics, 'crate-2', -6.5, 1);
    setDown(world, physics, 'crate-1', -2, -3.5);
    setDown(world, physics, 'crate-4', 1.5, -3.2);
    expect(R(world).state).toBe('below');
    const ev: { step: number; e: SimEvent }[] = [];
    for (let i = 0; i < steps(100); i++) for (const e of run(world, 1)) ev.push({ step: world.step, e });
    const sweeps = ev.filter((x) => x.e.type === 'revert.sweep');
    expect(sweeps).toHaveLength(1); // four strays: one put away, and the bench is no longer crowded
    const s = sweeps[0]!;
    // the oldest stirred (crate-3), once nothing has stirred it for the while; Revert came up for it
    expect(s.e.type === 'revert.sweep' && s.e.part).toBe('crate-3');
    expect(s.step - first).toBeGreaterThanOrEqual(steps(A_WHILE));
    expect(ev.some((x) => x.e.type === 'crew.state' && x.e.id === 'revert' && x.e.state === 'rising')).toBe(true);
    expect(ev.some((x) => x.e.type === 'put-away' && x.e.id === 'crate-3')).toBe(true);
    const loc = world.part('crate-3')!.location;
    expect(loc.at).toBe('rest');
    if (loc.at === 'rest') expect(Math.hypot(loc.pose.p[0] - AT.stack[0], loc.pose.p[2] - AT.stack[1])).toBeLessThan(0.05);
    expect(world.writer('crate-3', 'location')).toBe('system');
    expect(world.touched('crate-3')).toBe(false);
    expect(world.undoStack().flatMap((t) => t.entries).some((e) => e.target === 'crate-3')).toBe(false);
    // what the visitor touched later was left alone
    for (const id of ['crate-1', 'crate-2', 'crate-4']) expect(world.writer(id, 'location'), id).not.toBe('system');
  });

  test('it never puts away what the visitor touched within the while', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    setDown(world, physics, 'crate-4', 1.5, -3.2);
    setDown(world, physics, 'crate-3', -6, -3);
    setDown(world, physics, 'crate-2', -6.5, 1);
    setDown(world, physics, 'crate-1', -2, -3.5);
    const ev = run(world, steps(A_WHILE - 10));
    expect(ev.some((e) => e.type === 'revert.sweep' || e.type === 'put-away')).toBe(false);
  });
});

describe('Reset the workshop', () => {
  test('Revert goes back down its hatch; the cover comes off; the Button starts over', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    const start = world.part('revert')!.location;
    rung(world);
    rung(world);
    rung(world);
    run(world, steps(BUTTON_TUNING.fit) + 30);
    setDown(world, physics, 'revert', -6, 0.5);
    world.dispatch({ type: 'reset' });
    run(world, 2);
    expect(R(world)).toMatchObject({ state: 'below', lift: 0, card: null });
    expect(world.mode('revert')).toBe('gone');
    expect(world.button()).toMatchObject({ rung: 0, cover: 'none' });
    expect(world.part('revert')!.location).toEqual(start);
    expect(world.writer('revert', 'location')).toBe('settled');
  });
});
