// The line's part of REWRITE.md § B2 X3 ("a shipped crate comes back in through the dock door"), § D 7
// (a tool or a robot comes back up the chute with RETURN TO SENDER), § B1's bench edge, and § E5 rules
// 4, 9 and 10 on the real belt and dock. Whole bench, real Rapier.
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { describe, expect, test } from 'vitest';
import { AT, BENCH, benchWorld, LINE, onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import { throwPart, line } from './helpers.ts';
import { rideWatch } from './rides.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import { defaultHalfExtents } from '../../src/workshop/sim/parts.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { BeltView, Location, Restore, SimEvent } from '../../src/workshop/sim/types.ts';

const TOOL_HALF = defaultHalfExtents('tool', 'M');
/** The bench with one tool lying loose (tools stay P4 on the wall; a tool is a part like any other). */
const WITH_TOOL: SceneDesc = {
  ...BENCH,
  parts: [...BENCH.parts, { id: 'tool-rust', kind: 'tool', size: 'M', material: 'metal', colour: 'paint-orange', label: '', station: 'tools', name: 'name.crate', pose: { p: [1.5, TOOL_HALF[1], -0.6], q: qyaw(0.3) } }], // clear bench between the console and the phone (L1 round 3: Revert now stands at (-3.2, 0.35))
};
const undoneOf = (ev: readonly SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'undone' }> => e.type === 'undone');
const near = (a: readonly number[], b: readonly number[], d = 0.6): boolean => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) < d;


describe('the dock and the chute', () => {
  test('X3: a shipped tool comes back in through the door; its location is restored in one hop', async () => {
    const w = await benchWorld(1, { scene: WITH_TOOL });
    const t = tape(w);
    t.run(30);
    const peg = w.part('tool-rust')!.location;
    putOn(w, t, 'tool-rust', onBelt(0.5));
    expect(t.until((e) => e.type === 'struck' && e.part === 'tool-rust', 10 * HZ)?.e).toMatchObject({ size: 'M', material: 'metal', note: 4, octave: 1 });
    expect(t.until((e) => e.type === 'shipped' && e.part === 'tool-rust', 10 * HZ)).not.toBeNull();
    // its location was written three times by the one action, and is one entry: before = where it lay
    const entry = w.undoStack().flatMap((x) => x.entries).filter((e) => e.target === 'tool-rust' && e.field === 'location');
    expect(entry.length).toBe(1);
    expect(entry[0]!.before).toEqual(peg);
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    const u = undoneOf(ev)[0]!;
    const restores = u.restores.filter((r: Restore) => r.target === 'tool-rust');
    expect(restores.map((r) => r.field).sort()).toEqual(['location', 'marks']);
    const loc = restores.find((r) => r.field === 'location')!;
    expect(loc.from).toEqual({ at: 'shipped' });
    expect(loc.to).toEqual(peg);
    expect(near(loc.pose!.p, LINE.door.sill, 0.01)).toBe(true); // the hop starts at the door
    expect(ev.find((e) => e.type === 'returned')).toMatchObject({ part: 'tool-rust', how: 'door' });
    // in one hop: it is exactly where it lay, at once, and it does not come back up the chute later
    expect(w.part('tool-rust')!.location).toEqual(peg);
    const pegPose = (peg as Extract<Location, { at: 'rest' }>).pose;
    expect(Math.hypot(...w.motion('tool-rust')!.pose.p.map((v, i) => v - pegPose.p[i]!))).toBeLessThan(0.01); // physics may settle it a hair
    const mark = t.events.length;
    t.run(12 * HZ);
    if (process.env.LINE_TRACE) for (const x of t.events.slice(mark)) if (JSON.stringify(x.e).includes('tool-rust')) console.log(x.step, JSON.stringify(x.e).slice(0, 300));
    expect(t.of('part.returned').filter((x) => x.e.id === 'tool-rust')).toEqual([]);
    expect(w.part('tool-rust')!.location).toEqual(peg);
    w.dispose();
  }, 60_000);

  test('left alone, a shipped tool comes back up the chute marked RETURN TO SENDER, and it is still the action that shipped it', async () => {
    const w = await benchWorld(1, { scene: WITH_TOOL });
    const t = tape(w);
    t.run(30);
    const peg = w.part('tool-rust')!.location;
    putOn(w, t, 'tool-rust', onBelt(0.5));
    t.until((e) => e.type === 'shipped' && e.part === 'tool-rust', 10 * HZ);
    expect(t.until((e) => e.type === 'returned' && e.part === 'tool-rust', 8 * HZ)?.e).toMatchObject({ how: 'chute' });
    expect(t.until((e) => e.type === 'flap', 4 * HZ)?.e).toMatchObject({ id: 'chute', part: 'tool-rust' });
    expect(t.until((e) => e.type === 'part.rested' && e.id === 'tool-rust', 6 * HZ)).not.toBeNull();
    const p = w.part('tool-rust')!;
    expect(p.marks).toEqual(['mark.shipped', 'mark.return']);
    expect(near(w.motion('tool-rust')!.pose.p, AT.chute.p, 2.5)).toBe(true); // out of the chute's mouth (see the hand-in: the stack has moved away from it)
    const shipper = w.writer('tool-rust', 'location');
    expect(shipper).toMatch(/^t\d+$/);
    expect(w.writer('tool-rust', 'marks')).toBe(shipper);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('tool-rust')!.location).toEqual(peg);
    expect(w.part('tool-rust')!.marks).toEqual([]);
    w.dispose();
  }, 60_000);

  test('ships Fetch: it comes back up the chute by itself, written by crew; the lever leaves it and says so', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'fetch', onBelt(0.55));
    expect(t.until((e) => e.type === 'shipped' && e.part === 'fetch', 12 * HZ)).not.toBeNull();
    expect(w.crew('fetch')!.state).toBe('held');
    expect(t.until((e) => e.type === 'returned' && e.part === 'fetch', 12 * HZ)?.e).toMatchObject({ how: 'chute' });
    expect(waitFor(w, t, 'fetch', 'rest', 6 * HZ)).toBe(true);
    expect(w.writer('fetch', 'location')).toBe('crew');
    expect(w.writer('fetch', 'marks')).toBe('crew');
    expect(w.part('fetch')!.marks).toEqual(['mark.shipped', 'mark.return']);
    // and it hurries back to its lane
    t.run(8 * HZ);
    expect(w.mode('fetch')).toBe('crew');
    expect(Math.abs(w.crew('fetch')!.z - BENCH.runner.lane.a[1])).toBeLessThan(0.01);
    // the lever: Fetch's location is no longer the shipping's to restore (Revert's card)
    let u: Extract<SimEvent, { type: 'undone' }> | undefined;
    for (let i = 0; i < 4 && !u?.restores.some((r) => r.target === 'fetch') && !u?.kept.some((k) => k.target === 'fetch'); i++) {
      w.dispatch({ type: 'undo' });
      u = undoneOf(t.run(1))[0];
    }
    expect(u?.kept).toEqual(expect.arrayContaining([{ target: 'fetch', field: 'location', writer: 'crew' }]));
    w.dispose();
  }, 60_000);

  test('a part thrown off the bench comes back up the chute, and is the throw\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    const home = w.part('crate-3')!.location;
    const p = w.motion('crate-3')!.pose.p;
    throwPart(w, 'crate-3', line(p, [p[0], 2.5, 4.6], 30), [0, 1, 6]);
    const out = t.until((e) => e.type === 'part.returned' && e.id === 'crate-3', 6 * HZ);
    expect(out).not.toBeNull();
    expect(t.of('flap').map((x) => x.e.part)).toContain('crate-3');
    expect(t.until((e) => e.type === 'part.rested' && e.id === 'crate-3', 6 * HZ)).not.toBeNull();
    expect(near(w.motion('crate-3')!.pose.p, AT.chute.p, 2.5)).toBe(true);
    const txn = w.writer('crate-3', 'location');
    expect(txn).toMatch(/^t\d+$/);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('crate-3')!.location).toEqual(home);
    w.dispose();
  }, 60_000);
});

describe('the belt carries whatever is put on it', () => {
  test('reversed, a run rides back and is guided off the BACK of the belt at the motor end, set down still at the scene\'s spot, one at a time, still the placing\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(1);
    putOn(w, t, 'crate-3', onBelt(0.3));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    putOn(w, t, 'crate-2', onBelt(0.45));
    expect(waitFor(w, t, 'crate-2', 'in')).toBe(true);
    const placers = ['crate-3', 'crate-2'].map((id) => w.writer(id, 'location'));
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0 });
    t.run(1);
    const leverStep = w.step;
    expect((w.machine('belt') as BeltView).direction).toBe('backward');
    const watch = rideWatch();
    let overlap = 0;
    /** Where the deflector set each down (Fetch's lane ends close by and may knock it on afterwards: see the hand-in). */
    const setDown = new Map<string, readonly [number, number, number]>();
    for (let i = 0; i < 14 * HZ; i++) {
      const ev = t.run(1);
      watch(ev, w.step);
      // the moment the belt lets it go (no longer riding), where it was set down
      const riding = (w.machine('belt') as BeltView).riding;
      for (const id of ['crate-3', 'crate-2']) if (!setDown.has(id) && !riding.includes(id) && w.mode(id) === 'free') setDown.set(id, w.motion(id)!.pose.p);
      // on the belt itself (a part going off the back over the deflector has left its width)
      const r = (w.machine('belt') as BeltView).riding.filter((id) => Math.abs(w.motion(id)!.pose.p[2] - LINE.belt.z) < LINE.belt.halfWidth);
      for (let j = 1; j < r.length; j++) {
        const a = w.motion(r[j - 1]!)!.pose.p[0] + w.halfExtents(r[j - 1]!)![0];
        const b = w.motion(r[j]!)!.pose.p[0] - w.halfExtents(r[j]!)![0];
        if (a > b + 1e-3) overlap++;
      }
    }
    expect(overlap).toBe(0);
    const spot = LINE.belt.offBack;
    for (const [i, id] of ['crate-3', 'crate-2'].entries()) {
      expect(w.part(id)!.location.at, id).toBe('rest');
      const at = setDown.get(id)!;
      expect(at, id).toBeDefined();
      // off the back (toward -Z), at the slide's foot, each in a free place along its row (S7: filled from
      // the chute end, side by side; tests/scenario/deflector-row.test.ts holds the rest)
      expect(at[2], id).toBeLessThan(LINE.belt.z - LINE.belt.halfWidth);
      expect(Math.abs(at[2] - spot[2]), id).toBeLessThan(0.05);
      const row = LINE.belt.offBackRow;
      const ph0 = w.halfExtents(id)!;
      expect(at[0] - ph0[0], id).toBeGreaterThan(row.minX - 0.05);
      expect(at[0] + ph0[0], id).toBeLessThan(row.maxX + 0.05);
      // (S6) never on Fetch's lane, where its wheel goes: the tape between its stops, widened by its footprint
      const lane = w.scene.runner.lane;
      const fh = w.halfExtents('fetch')!;
      const reach = Math.hypot(fh[0], fh[2]);
      const stopA = lane.a[0] + FETCH_TUNING.inset * (w.scene.crewScale ?? 1);
      const ph = w.halfExtents(id)!;
      const intoLane = at[0] + ph[0] > stopA - reach && at[2] - ph[2] < lane.a[1] + reach;
      expect(intoLane, `${id} set down on Fetch's lane at ${at[0].toFixed(2)}, ${at[2].toFixed(2)}`).toBe(false);
      // where it was set down is the placing's (Fetch may knock it on afterwards, which is not the visitor's)
      const first = t.of('effect').find((x) => x.step > leverStep && x.e.effect.target === id && x.e.effect.field === 'location');
      expect(first?.e.effect.cause, id).toBe(placers[i]);
    }
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    w.dispose();
  }, 60_000);

  test('undone mid-ride, a part never stops halfway: it goes back where it was before it was put on', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    const home = w.part('crate-3')!.location;
    putOn(w, t, 'crate-3', onBelt(0.1));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    t.run(2 * HZ);
    expect(w.mode('crate-3')).toBe('machine');
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    expect(undoneOf(ev)[0]!.cancelled).toContain('belt');
    expect(w.part('crate-3')!.location).toEqual(home);
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    t.run(3 * HZ);
    expect(w.part('crate-3')!.location).toEqual(home);
    expect(t.of('struck')).toEqual([]);
    w.dispose();
  }, 60_000);

  test('a riding part can be taken off at any moment; undoing that puts it back on the belt where it was, and it still ships as the first placing\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', onBelt(0.1));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    const placer = w.writer('crate-3', 'location');
    t.run(2 * HZ);
    const x = w.motion('crate-3')!.pose.p[0];
    putOn(w, t, 'crate-3', [0, 0, 3.0 - 0.9]); // taken off, set on the bench behind it... in front of the lane
    expect(waitFor(w, t, 'crate-3', 'rest')).toBe(true);
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('crate-3')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    expect(w.writer('crate-3', 'location')).toBe(placer);
    expect((w.machine('belt') as BeltView).riding).toEqual(['crate-3']);
    expect(Math.abs(w.motion('crate-3')!.pose.p[0] - x)).toBeLessThan(0.05);
    expect(t.until((e) => e.type === 'shipped' && e.part === 'crate-3', 12 * HZ)).not.toBeNull();
    expect(w.writer('crate-3', 'location')).toBe(placer);
    w.dispose();
  }, 60_000);
});

describe('behind the curtain', () => {
  test('a part at the dock\'s door cannot be grabbed; on the ramp before it, it can, and let go it never ends inside the dock or under the bench top', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-1', onBelt(0.93));
    // on the ramp, rolling: it can be taken off (and the dock lets it go)
    expect(t.until((e) => e.type === 'taken-in' && e.id === 'dock', 4 * HZ)).not.toBeNull();
    const m = w.motion('crate-1')!;
    w.dispatch({ type: 'grab', id: 'crate-1', grip: m.pose.p });
    t.run(1);
    expect(w.holding()).toEqual({ kind: 'part', id: 'crate-1' });
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    expect(t.until((e) => e.type === 'part.rested' && e.id === 'crate-1', 3 * HZ)).not.toBeNull();
    // back on the ramp head it is taken in again, and rolls to the door; there it is behind the curtain
    let refused = 0;
    for (let i = 0; i < 6 * HZ && w.part('crate-1')!.location.at !== 'shipped'; i++) {
      const dock = w.machine('dock') as { shipping: readonly string[] };
      if (dock.shipping.includes('crate-1') && w.mode('crate-1') === 'machine') {
        const p = w.motion('crate-1')!.pose.p;
        const past = (p[0] - LINE.door.sill[0]) * LINE.door.inward[0] + (p[2] - LINE.door.sill[2]) * LINE.door.inward[2];
        if (past > -1e-3) {
          w.dispatch({ type: 'grab', id: 'crate-1', grip: p });
          t.run(1);
          expect(w.holding()).toBeNull();
          refused++;
          continue;
        }
      }
      t.run(1);
    }
    expect(refused, `${w.mode('crate-1')} ${JSON.stringify(w.part('crate-1')!.location).slice(0, 60)} ${JSON.stringify(w.motion('crate-1')!.pose.p)}`).toBeGreaterThan(0);
    expect(w.part('crate-1')!.location.at).toBe('shipped');
    for (const p of w.parts()) if (w.mode(p.id) === 'free') expect(w.motion(p.id)!.pose.p[1], p.id).toBeGreaterThan(0);
    w.dispose();
  }, 60_000);
});

describe('picking Fetch up', () => {
  test('the crate it drops is the visitor\'s doing: the lever puts it back', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    expect(w.crew('fetch')!.carrying).toBe('crate-4');
    const home = w.part('crate-4')!.location;
    putOn(w, t, 'fetch', [2.0, 0, 0.9]);
    expect(waitFor(w, t, 'crate-4', 'rest')).toBe(true);
    t.run(2 * HZ);
    expect(w.part('crate-4')!.location).not.toEqual(home);
    expect(w.writer('crate-4', 'location')).toMatch(/^t\d+$/);
    for (let i = 0; i < 3; i++) {
      w.dispatch({ type: 'undo' });
      t.run(1);
    }
    expect(w.part('crate-4')!.location).toEqual(home);
    w.dispose();
  }, 60_000);
});
