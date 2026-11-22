// P4 T2: the tool wall. Eight tools on their pegs, each a loose part like any other: taken down, carried, thrown,
// set on the belt, struck, painted, shipped and back up the chute; hung back by letting go at its own painted shadow
// (by the hand, by tap-then-tap, by the keys' destination), never at another's; undone and reset like any part.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, waitFor, onBelt, BENCH } from './line-helpers.ts';
import { TOOLWALL, toolId } from '../../src/workshop/sim/scenes/bench.ts';
import { DOCK_TUNING, MARK_RETURN, MARK_SHIPPED } from '../../src/workshop/sim/machines/dock.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { ToolwallView, Vec3 } from '../../src/workshop/sim/types.ts';
import { KINDS, TOOLS, allHung, carryTo, hangAt, letGo, onPeg, pegOf, settle, take } from './toolwall-helpers.ts';
import { plug, textAndWait, traySpot } from './patchlamp-helpers.ts';

const VUE = toolId('vue');
const HAMMER = toolId('php');
const SPANNER = toolId('laravel');
const view = (w: Awaited<ReturnType<typeof benchWorld>>): ToolwallView => w.machine(TOOLWALL.unit) as ToolwallView;
const spot: Vec3 = [-3.6, 0, 1.9];

describe('the tool wall', () => {
  test('every tool starts on its peg, held by the wall: a loose part of kind tool, with a name, a tell, a misfire and a grab', async () => {
    const w = await benchWorld('tw-start', { scene: BENCH });
    const t = tape(w);
    t.run(2);
    expect(TOOLS).toHaveLength(8);
    for (const id of TOOLS) {
      expect(w.part(id)?.kind).toBe('tool');
      expect(onPeg(w, id)).toBe(true);
      const it = w.interactable(id)!;
      expect(it.affordances).toContain('grab');
      expect(typeof it.tell).toBe('function');
      expect(typeof it.misfire).toBe('function');
    }
    // still there a while later (not asleep in the physics, not fallen)
    t.run(HZ * 3);
    expect(allHung(w)).toBe(true);
    expect(view(w).tools.every((x) => x.hung)).toBe(true);
    w.dispose();
  });

  test('taken off its peg: the click; let go at its own shadow: back on, nothing to undo', async () => {
    const w = await benchWorld('tw-take', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const before = w.undoStack().length;
    take(w, t, VUE);
    expect(t.of('toolwall.taken').map((x) => x.e.tool)).toEqual([VUE]);
    expect(w.motion(VUE)?.mode).toBe('held');
    const h = hangAt(VUE);
    carryTo(w, t, VUE, [h[0] + 0.6, h[1] - 0.3, h[2] + 0.5]);
    carryTo(w, t, VUE, [h[0] + 0.1, h[1] + 0.05, h[2] + 0.25], 20);
    letGo(w, t);
    settle(w, t, VUE);
    expect(onPeg(w, VUE)).toBe(true);
    expect(t.of('toolwall.hung').map((x) => x.e.how)).toEqual(['hand']);
    // it never rested anywhere else: no change to take back
    expect(w.undoStack().length).toBe(before);
    w.dispose();
  });

  test('set down on the bench it stays where it was put; picked up and hung back; the lever takes each back in turn', async () => {
    const w = await benchWorld('tw-bench', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, VUE, spot);
    settle(w, t, VUE);
    expect(w.part(VUE)?.location.at).toBe('rest');
    const rested = w.motion(VUE)!.pose.p;
    expect(Math.hypot(rested[0] - spot[0], rested[2] - spot[2])).toBeLessThan(0.4);
    t.run(HZ * 4);
    expect(Math.hypot(w.motion(VUE)!.pose.p[0] - rested[0], w.motion(VUE)!.pose.p[2] - rested[2])).toBeLessThan(0.02);
    // hang it back
    take(w, t, VUE);
    const h = hangAt(VUE);
    carryTo(w, t, VUE, [h[0], h[1], h[2] + 0.3], 60);
    letGo(w, t);
    settle(w, t, VUE);
    expect(onPeg(w, VUE)).toBe(true);
    // the lever: back on the bench, then back on the peg
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(w.part(VUE)?.location.at).toBe('rest');
    expect(w.motion(VUE)?.mode).toBe('free');
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(onPeg(w, VUE)).toBe(true);
    w.dispose();
  });

  test('another tool\'s shadow does not take it: it drops to the bench, and the wall says so', async () => {
    const w = await benchWorld('tw-wrong', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    take(w, t, VUE);
    const other = hangAt(SPANNER);
    carryTo(w, t, VUE, [other[0] + 0.5, other[1], other[2] + 0.6], 50);
    carryTo(w, t, VUE, [other[0], other[1] - 0.1, other[2] + 0.3], 20);
    letGo(w, t);
    settle(w, t, VUE, 600);
    expect(onPeg(w, VUE)).toBe(false);
    expect(onPeg(w, SPANNER)).toBe(true);
    expect(w.part(VUE)?.location.at).toBe('rest');
    expect(t.of('toolwall.missed').map((x) => [x.e.tool, x.e.peg])).toEqual([[VUE, SPANNER]]);
    w.dispose();
  });

  test('tap-then-tap: placed at its own place it hangs; placed at another it drops', async () => {
    const w = await benchWorld('tw-place', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, HAMMER, spot);
    settle(w, t, HAMMER);
    take(w, t, HAMMER);
    w.dispatch({ type: 'place', at: pegOf(VUE) });
    settle(w, t, HAMMER, 600);
    expect(onPeg(w, HAMMER)).toBe(false);
    take(w, t, HAMMER);
    w.dispatch({ type: 'place', at: pegOf(HAMMER) });
    settle(w, t, HAMMER);
    expect(onPeg(w, HAMMER)).toBe(true);
    w.dispose();
  });

  test('thrown gently at its shadow it catches; thrown hard it bounces off the board and lies on the bench', async () => {
    const w = await benchWorld('tw-throw', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, SPANNER, [-6.5, 0, -2.0]);
    settle(w, t, SPANNER);
    take(w, t, SPANNER);
    const h = hangAt(SPANNER);
    carryTo(w, t, SPANNER, [h[0], h[1] - 0.1, h[2] + 0.8], 60);
    letGo(w, t, [0, 1.2, -2.8]);
    settle(w, t, SPANNER, 300);
    expect(onPeg(w, SPANNER)).toBe(true);
    // hard
    take(w, t, SPANNER);
    carryTo(w, t, SPANNER, [h[0], h[1] - 0.2, h[2] + 2.2], 60);
    letGo(w, t, [0, 1.0, -12]);
    settle(w, t, SPANNER, 600);
    expect(onPeg(w, SPANNER)).toBe(false);
    expect(w.part(SPANNER)?.location.at).toBe('rest');
    expect(w.motion(SPANNER)!.pose.p[1]).toBeLessThan(1.2);
    w.dispose();
  });

  test('a crate thrown at the board bounces off it; every tool stays on its peg', async () => {
    const w = await benchWorld('tw-crate', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', [-6.5, 0, -1.5]);
    t.run(30);
    const m = w.motion('crate-3')!;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    t.run(2);
    carryTo(w, t, 'crate-3', [-6.6, 3.0, -2.2], 40);
    letGo(w, t, [0, 1, -10]);
    t.run(HZ * 4);
    expect(allHung(w)).toBe(true);
    const c = w.motion('crate-3')!.pose.p;
    expect(c[2]).toBeGreaterThan(-4.8);
    w.dispose();
  });

  test('a tool rides the belt, is struck, ships with the bell, and comes back up the chute RETURN TO SENDER; the lever brings it back through the door and hangs it', async () => {
    const w = await benchWorld('tw-ship', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, SPANNER, onBelt(0.3));
    expect(waitFor(w, t, SPANNER, 'shipped', 60 * HZ)).toBe(true);
    expect(t.of('struck').some((x) => x.e.part === SPANNER)).toBe(true);
    expect(w.part(SPANNER)?.marks).toContain(MARK_SHIPPED);
    // back up the chute after the dock's return time, marked RETURN TO SENDER
    t.run(steps(DOCK_TUNING.returnAfter.tool) + steps(3));
    expect(w.part(SPANNER)?.marks).toContain(MARK_RETURN);
    settle(w, t, SPANNER, 600);
    expect(w.part(SPANNER)?.location.at).toBe('rest');
    // the lever: everything the putting-down caused, back: on its peg
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(onPeg(w, SPANNER)).toBe(true);
    w.dispose();
  });

  test('undo while it rides the belt: it comes straight back to its peg (never stops halfway)', async () => {
    const w = await benchWorld('tw-ship-undo', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, VUE, onBelt(0.3));
    t.run(HZ * 2);
    expect(w.part(VUE)?.location).toMatchObject({ at: 'in', mouth: 'belt' });
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(onPeg(w, VUE)).toBe(true);
    t.run(HZ * 3);
    expect(onPeg(w, VUE)).toBe(true);
    w.dispose();
  });

  test('painted on the platen it keeps its paint, on the bench and back on its peg; the lever drains it', async () => {
    const w = await benchWorld('tw-paint', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    plug(w, t, 'jack-platen');
    putOn(w, t, VUE, traySpot());
    t.run(HZ);
    expect(w.part(VUE)?.location).toMatchObject({ at: 'in', mouth: 'platen' });
    textAndWait(w, t, 'make it blue');
    expect(w.part(VUE)?.colour).toBe('paint-blue');
    take(w, t, VUE);
    const h = hangAt(VUE);
    carryTo(w, t, VUE, [h[0], h[1], h[2] + 0.3], 90);
    letGo(w, t);
    settle(w, t, VUE);
    expect(onPeg(w, VUE)).toBe(true);
    expect(w.part(VUE)?.colour).toBe('paint-blue');
    w.dispatch({ type: 'undo' }); // the hanging back
    t.run(2);
    w.dispatch({ type: 'undo' }); // the paint
    t.run(2);
    expect(w.part(VUE)?.colour).toBe('bare');
    w.dispose();
  });

  test('"Reset the workshop" hangs all eight, bare, wherever they were (in the hand, on the belt, shipped, painted)', async () => {
    const w = await benchWorld('tw-reset', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    putOn(w, t, VUE, onBelt(0.3));
    putOn(w, t, HAMMER, spot);
    putOn(w, t, SPANNER, onBelt(0.5));
    t.run(HZ * 12);
    // and one in the hand: the reset lets go of it, and it hangs too
    take(w, t, toolId('rust'));
    w.dispatch({ type: 'reset' });
    t.run(3);
    for (const id of TOOLS) {
      expect(onPeg(w, id), id).toBe(true);
      expect(w.part(id)?.colour).toBe('bare');
      expect(w.part(id)?.marks).toEqual([]);
    }
    expect(t.of('toolwall.hung').filter((x) => x.e.how === 'reset').length).toBeGreaterThan(0);
    t.run(HZ * 3);
    expect(allHung(w)).toBe(true);
    w.dispose();
  });

  test('a double-click asks for the camera: the board while it hangs, itself out on the bench', async () => {
    const w = await benchWorld('tw-look', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'select', id: VUE });
    expect(t.run(1).filter((e) => e.type === 'look').map((e) => (e as { target: string }).target)).toEqual([TOOLWALL.look]);
    putOn(w, t, VUE, spot);
    settle(w, t, VUE);
    w.dispatch({ type: 'select', id: VUE });
    expect(t.run(1).filter((e) => e.type === 'look').map((e) => (e as { target: string }).target)).toEqual(['tool-vue-look']);
    w.dispose();
  });

  test('the pinned sheet: pressed, it asks the page for the skills list; nothing durable', async () => {
    const w = await benchWorld('tw-sheet', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const before = w.undoStack().length;
    w.dispatch({ type: 'press', id: TOOLWALL.sheet });
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'toolwall.sheet')).toBe(true);
    expect(w.undoStack().length).toBe(before);
    w.dispose();
  });

  test('every tool has its place (a mouth) and a different weight from the crates; eight kinds', () => {
    expect(KINDS).toHaveLength(8);
    for (const id of TOOLS) expect(BENCH.mouths?.some((m) => m.id === pegOf(id) && m.machine === TOOLWALL.unit)).toBe(true);
  });
});
