// Revert, the caretaker (REWRITE.md § B5; S4), state by state, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, AT, REVERT } from '../../../src/workshop/sim/scenes/bench.ts';
import { REVERT_TUNING, CARD_KEPT, CARD_NOTHING } from '../../../src/workshop/sim/crew/revert.ts';
import { BUTTON_TUNING } from '../../../src/workshop/sim/machines/button.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import type { Id, Pose, RevertView, SimEvent } from '../../../src/workshop/sim/types.ts';

const benchStub = () => stubWorld(1, { scene: bench });
/**
 * The bench without Fetch's rounds: since layout round 4 the stack is in Fetch's reach, and in play mode
 * Fetch takes fresh crates off it and sends them down the belt (S5). The tests of Revert between jobs
 * count what is on the bench and what moved; Fetch's own traffic is held in fetch-rounds.test.ts.
 */
const { rounds: _rounds, ...quietRunner } = bench.runner;
const quietStub = () => stubWorld(1, { scene: { ...bench, runner: quietRunner } });
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

  test('rung 3: it trundles to the Button, fits the cover, goes home and sinks back down its hatch', () => {
    const { world } = benchStub();
    run(world, 5);
    rung(world);
    rung(world);
    const ev = rung(world);
    expect(world.button().cover).toBe('fitting');
    let atButton = false;
    for (let i = 0; i < steps(30); i++) {
      ev.push(...run(world, 1));
      const r = R(world);
      // A1 round 7: behind the console, facing the visitor over it
      if (r.state === 'fit') atButton = Math.hypot(r.x - REVERT.button.x, r.z - REVERT.button.z) < 0.01 && Math.abs(Math.atan2(Math.sin(r.heading), Math.cos(r.heading))) < 0.02 && r.z + AT.revert.half[2] < AT.console.c[2] - AT.console.half[2];
    }
    expect(atButton).toBe(true);
    const seq = states(ev).filter((s, i, a) => s !== a[i - 1]);
    expect(seq).toEqual(expect.arrayContaining(['trundle', 'fit', 'idle', 'sinking', 'below']));
    expect(seq.indexOf('fit')).toBeLessThan(seq.lastIndexOf('idle'));
    expect(seq.slice(-3)).toEqual(['idle', 'sinking', 'below']);
    expect(world.button().cover).toBe('shut');
    expect(R(world)).toMatchObject({ state: 'below', lift: 0, hatch: 0 });
    expect(world.mode('revert')).toBe('gone');
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
    run(world, steps(REVERT_TUNING.undoCrank.base + REVERT_TUNING.undoCrank.per) + 1);
    expect(R(world).state).toBe('idle'); // on its hatch: it stands by, then sinks
    run(world, steps(REVERT_TUNING.homePause) + 1);
    expect(R(world).state).toBe('sinking');
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

describe('Revert goes home (S7)', () => {
  test('a visit: it rises, works, goes home, sinks, and called again mid-descent comes back up from where it is', () => {
    const { world } = benchStub();
    run(world, 5);
    const ev = rung(world); // rises, cranks, holds up its card
    ev.push(...run(world, 1));
    expect(R(world)).toMatchObject({ state: 'idle', lift: 1 });
    // a deadpan pause after the card comes down, then the lift takes it down; the doors stay open meanwhile
    for (let i = 0; i < steps(REVERT_TUNING.card + REVERT_TUNING.homePause + 1) && R(world).state !== 'sinking'; i++) ev.push(...run(world, 1));
    expect(R(world).state).toBe('sinking');
    expect(R(world).card).toBeNull();
    ev.push(...run(world, Math.round(steps(REVERT_TUNING.rise) * 0.3)));
    const part = R(world);
    expect(part.state).toBe('sinking');
    expect(part.lift).toBeGreaterThan(0.5);
    expect(part.lift).toBeLessThan(0.9);
    expect(part.hatch).toBe(1);
    // called mid-descent (an undo): it rises again from where the lift is, cranking
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    run(world, 2);
    const lift = R(world).lift;
    ev.push(...press(world, 'undo-lever'));
    expect(R(world).state).toBe('rising');
    expect(R(world).lift).toBeGreaterThanOrEqual(lift - 0.05);
    expect(R(world).cranking).toBe(true);
    ev.push(...run(world, Math.ceil(steps(REVERT_TUNING.rise) * (1 - lift)) + 2));
    expect(R(world)).toMatchObject({ lift: 1 });
    expect(['crank', 'idle']).toContain(R(world).state);
    expect(world.mode('revert')).toBe('crew');
    // and when that is done it goes down again, to stay
    ev.push(...run(world, steps(REVERT_TUNING.undoCrank.max + REVERT_TUNING.card + REVERT_TUNING.homePause + REVERT_TUNING.rise + REVERT_TUNING.doors) + 4));
    expect(R(world)).toMatchObject({ state: 'below', lift: 0, hatch: 0 });
    expect(world.mode('revert')).toBe('gone');
    const seq = states(ev).filter((s, i, a) => s !== a[i - 1]);
    expect(seq).toEqual(['rising', 'idle', 'crank', 'idle', 'sinking', 'rising', ...seq.slice(6, -2), 'sinking', 'below']);
  });

  test('a rung pressed while it sinks calls it back up; a reduced-motion rung (no call) lets it finish going down', () => {
    const toSinking = (w: World): void => {
      run(w, 5);
      rung(w);
      for (let i = 0; i < steps(REVERT_TUNING.card + REVERT_TUNING.homePause + 1) && R(w).state !== 'sinking'; i++) run(w, 1);
      run(w, 10);
    };
    const a = benchStub().world;
    toSinking(a);
    press(a, 'button');
    expect(R(a).state).toBe('rising');
    const b = benchStub().world;
    toSinking(b);
    expect(R(b).state).toBe('sinking');
    b.dispatch({ type: 'motion', reduced: true });
    press(b, 'button');
    expect(b.bracketed).toBe(true);
    run(b, steps(REVERT_TUNING.rise));
    expect(R(b)).toMatchObject({ state: 'below', lift: 0 });
  });
});

describe('Revert between presses (S7)', () => {
  test('presses in quick succession: when a rung\'s rewind ends it stands by, idle, even as the next rung plays', () => {
    const { world } = benchStub();
    run(world, 5);
    const ev = rung(world);
    expect(R(world).state).toBe('crank'); // the rung's last step: the crank's last turn
    // the next press lands at once; through that rung, after the first rewind, it is never left cranking
    ev.push(...press(world, 'button'));
    let crankingIdle = 0;
    while (world.bracketed) {
      ev.push(...run(world, 1));
      const r = R(world);
      if (r.state === 'crank' && !r.cranking) crankingIdle++;
    }
    expect(crankingIdle).toBe(0);
    const seq = states(ev).filter((s, i, a) => s !== a[i - 1]);
    expect(seq.filter((s) => s === 'crank').length).toBe(2);
    ev.push(...run(world, 1));
    expect(states(ev).at(-1)).toBe('idle');
  });

  test('a press during the rewind\'s last moment: the crank stops when the rewind does, in the bracket of the next rung', () => {
    const { world } = benchStub();
    run(world, 5);
    press(world, 'button');
    while (world.bracketed) run(world, 1);
    run(world, 1);
    expect(R(world).state).toBe('idle');
    // crank into the next rung: an undo crank that outlasts the press
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    run(world, 2);
    press(world, 'undo-lever');
    run(world, 1);
    expect(R(world).state).toBe('crank');
    press(world, 'button');
    expect(world.bracketed).toBe(true);
    for (let i = 0; i < steps(REVERT_TUNING.undoCrank.max) + 2; i++) run(world, 1);
    expect(world.bracketed).toBe(true);
    expect(R(world)).toMatchObject({ state: 'idle', cranking: false });
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
  test('left off its hatch, a tidy bench for two minutes: it trundles to the window\'s light and powers down, one eye open, moving nothing', () => {
    const { world, physics } = quietStub();
    run(world, 5);
    rung(world);
    run(world, 10);
    setDown(world, physics, 'revert', -5.5, -0.5); // off its hatch: it does not go down, it waits where it is
    const before = others(world);
    const ev = run(world, steps(135)); // (A1 round 7: its track runs further back behind the console, a longer trip)
    expect(states(ev)).toContain('trundle');
    expect(R(world)).toMatchObject({ state: 'park', eyes: 'one' });
    expect(R(world).x).toBeCloseTo(REVERT.park.x, 5);
    expect(R(world).z).toBeCloseTo(REVERT.park.z, 5);
    for (const [id, p] of others(world)) if (id !== 'fetch' && id !== 'crate-4') expect(p, id).toEqual(before.get(id));
  });

  test('a crowded bench: after a while it comes up and puts away the oldest crate nobody has stirred, onto the stack', () => {
    const { world, physics } = quietStub();
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

  /** Four strays, then on to the moment Revert starts its sweep: the part it sweeps. */
  function toSweep(world: World, physics: StubPhysics): Id {
    run(world, 5);
    setDown(world, physics, 'crate-3', -6, -3);
    run(world, steps(5));
    setDown(world, physics, 'crate-2', -6.5, 1);
    setDown(world, physics, 'crate-1', -2, -3.5);
    setDown(world, physics, 'crate-4', 1.5, -3.2);
    for (let i = 0; i < steps(100) && R(world).state !== 'sweep'; i++) run(world, 1);
    expect(R(world).state).toBe('sweep');
    return R(world).sweeping!;
  }
  /** Its own body brushes `part` (a contact between them, and the part nudged into a wobble). */
  function brush(world: World, physics: StubPhysics, part: Id): void {
    physics.setVelocity(part, [0.4, 0, 0.2]);
    physics.contact({ a: 'revert', b: part, impulse: 6 });
    run(world, 1);
  }

  test('S7: its own body brushing the part it sweeps (turning inside its collider) does not spoil the sweep', () => {
    const { world, physics } = quietStub();
    const part = toSweep(world, physics);
    run(world, 10);
    const ev = [] as SimEvent[];
    brush(world, physics, part);
    for (let i = 0; i < steps(REVERT_TUNING.sweep + REVERT_TUNING.settle + 1); i++) ev.push(...run(world, 1));
    expect(ev.filter((e) => e.type === 'revert.sweep').map((e) => e.type === 'revert.sweep' && e.part)).toEqual([part]);
    expect(world.writer(part, 'location')).toBe('system');
  });

  test('S7: a stir by the visitor during the sweep still counts: it leaves the part be', () => {
    const { world, physics } = quietStub();
    const part = toSweep(world, physics);
    run(world, 10);
    brush(world, physics, part); // its own brush first, and then the visitor's hand
    world.dispatch({ type: 'grab', id: part, grip: world.motion(part)!.pose.p });
    run(world, 2);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const ev = run(world, steps(REVERT_TUNING.sweep + REVERT_TUNING.settle + 1));
    expect(ev.some((e) => e.type === 'revert.sweep' && e.part === part)).toBe(false);
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
