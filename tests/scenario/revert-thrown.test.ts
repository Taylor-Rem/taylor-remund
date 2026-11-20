// R4 (Taylor, 2026-11-20: "Do you think we should be able to grab revert as well? If so, we need to come up with
// something to do when he's thrown off the ledge or put onto the conveyor"; § B5 "Nobody is ever hurt"): wherever
// Revert is let go it gets itself down and home. Off a low thing it trundles; from higher, or where it cannot drive
// off, it goes down where it is and comes back up through its own hatch. Off the bench or refused by the dock it
// never comes up the chute: after a beat it rises through its hatch and gives the visitor one long look. No card
// for any of it; a rung while it is away still plays, and its card is held up by the stick.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH, AT, type Tape } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { RevertView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const rv = (w: World): RevertView => w.machine('revert-crew') as RevertView;

/** The bench with Revert up (called up by the lever: nothing to take back), its card down again. */
async function withRevertUp(seed: string): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(1));
  w.dispatch({ type: 'press', id: 'undo-lever' });
  for (let i = 0; i < steps(6) && rv(w).lift < 1; i++) t.run(1);
  t.run(steps(0.5));
  return { w, t };
}
function carry(w: World, t: Tape, to: Vec3): void {
  w.dispatch({ type: 'grab', id: 'revert', grip: w.motion('revert')!.pose.p });
  t.run(1);
  let target: Vec3 = [...to];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 90; i++) {
      w.dispatch({ type: 'carry', target });
      t.run(1);
    }
    // (the hand holds it by where it was taken: steer its body, not the hand, over the spot)
    const p = w.motion('revert')!.pose.p;
    target = [target[0] + (to[0] - p[0]), target[1], target[2] + (to[2] - p[2])];
  }
}
/** Run until Revert is below, then up again through its hatch (or `secs` pass). What it did, and what was said. */
function watch(w: World, t: Tape, secs: number) {
  const ev: SimEvent[] = [];
  let below = -1;
  let upAgain = -1;
  let lookedBack = false;
  let atChute = false;
  for (let i = 0; i < steps(secs); i++) {
    ev.push(...t.run(1));
    const r = rv(w);
    const m = w.motion('revert')!;
    if (m.mode === 'free' && Math.hypot(m.pose.p[0] - w.scene.chute.pose.p[0], m.pose.p[2] - w.scene.chute.pose.p[2]) < 1) atChute = true;
    if (below < 0 && r.state === 'below') below = i / HZ;
    if (below >= 0 && upAgain < 0 && r.lift >= 1) upAgain = i / HZ;
    if (r.lookingBack) lookedBack = true;
  }
  return { ev, below, upAgain, lookedBack, atChute };
}

describe('R4: Revert let go anywhere gets itself down and home', () => {
  const PERCHES: [string, (w: World) => Vec3][] = [
    ['a crate', (w) => { const p = w.motion('crate-3')!.pose.p; return [p[0], 3.5, p[2]]; }],
    ['Patch\'s stool', () => [3.02, 3.5, -3.46]],
    ['the console\'s top', () => [AT.console.c[0], 3.5, AT.console.c[2]]],
  ];
  for (const [what, at] of PERCHES) {
    test(`set down on ${what}: home and below within 30 s, no card`, async () => {
      const { w, t } = await withRevertUp(`perch-${what}`);
      carry(w, t, at(w));
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      const ev: SimEvent[] = [];
      let home = -1;
      let perched = 0;
      for (let i = 0; i < steps(30) && home < 0; i++) {
        ev.push(...t.run(1));
        const r = rv(w);
        if (process.env.DBG && i % 30 === 0) process.stderr.write(`\n  ${(i / HZ).toFixed(1)} ${r.state} ${w.motion('revert')!.mode} ${w.motion('revert')!.pose.p.map((v) => v.toFixed(2))}`);
        if (w.motion('revert')!.mode !== 'gone' && r.state !== 'held' && w.motion('revert')!.pose.p[1] - w.halfExtents('revert')![1] > 0.1) perched++;
        if (r.state === 'below' && i > steps(1)) home = i / HZ;
      }
      process.stderr.write(`\n${what}: up off the floor ${(perched / HZ).toFixed(1)} s; home and below after ${home.toFixed(1)} s\n`);
      expect(perched, 'it came to rest up there').toBeGreaterThan(0);
      expect(home).toBeGreaterThan(0);
      expect(ev.some((e) => e.type === 'card' && e.by === 'revert')).toBe(false);
      w.dispose();
    }, 120_000);
  }

  const EDGES: [string, Vec3, Vec3][] = [
    ['the front', [0, 2, 4.5], [0, 1, 6]],
    ['the left end', [-8.5, 2, 0], [-6, 1, 0]],
    ['the front right', [6, 2, 4.6], [2, 1, 6]],
  ];
  for (const [edge, from, v] of EDGES) {
    test(`thrown off ${edge}: never out of the chute; after a beat up through its hatch, one long look, no card`, async () => {
      const { w, t } = await withRevertUp(`edge-${edge}`);
      carry(w, t, from);
      w.dispatch({ type: 'release', velocity: v });
      const r = watch(w, t, 20);
      process.stderr.write(`\noff ${edge}: below at ${r.below.toFixed(1)} s, up again at ${r.upAgain.toFixed(1)} s, long look ${r.lookedBack}\n`);
      expect(r.atChute).toBe(false);
      expect(r.below).toBeGreaterThan(0);
      expect(r.upAgain).toBeGreaterThan(r.below);
      expect(r.lookedBack).toBe(true);
      expect(w.motion('revert')!.mode).not.toBe('free');
      expect(Math.hypot(rv(w).x - -4.832, rv(w).z - 0.372)).toBeLessThan(0.1); // at its hatch
      expect(r.ev.some((e) => e.type === 'card' && e.by === 'revert')).toBe(false);
      w.dispose();
    }, 120_000);
  }

  test('set on the belt: the dock refuses it; it comes up through its hatch, not out of the chute', async () => {
    const { w, t } = await withRevertUp('belt');
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 0.6 });
    const L = FULL_BENCH.mouths!.find((m) => m.id === 'belt')!;
    carry(w, t, [L.c[0] + 1, 1.6, L.c[2]]);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const r = watch(w, t, 60);
    const refused = r.ev.some((e) => (e.type === 'returned' && e.part === 'revert') || (e.type === 'part.returned' && e.id === 'revert'));
    process.stderr.write(`\nbelt: refused ${refused}; below at ${r.below.toFixed(1)} s, up again at ${r.upAgain.toFixed(1)} s\n`);
    expect(refused).toBe(true);
    expect(r.atChute).toBe(false);
    expect(r.upAgain).toBeGreaterThan(0);
    w.dispose();
  }, 180_000);

  test('a Button press while it is away (thrown off the front): the rung still plays and its card is said while it cannot hold it (the stick holds it up)', async () => {
    const { w, t } = await withRevertUp('away-rung');
    carry(w, t, [0, 2, 4.5]);
    w.dispatch({ type: 'release', velocity: [0, 1, 6] });
    t.run(steps(0.3));
    w.dispatch({ type: 'press', id: 'button' });
    const ev: { e: SimEvent; state: string }[] = [];
    for (let i = 0; i < steps(15); i++) for (const e of t.run(1)) ev.push({ e, state: rv(w).state });
    const beats = ev.filter((x) => x.e.type === 'rung.beat').length;
    const card = ev.find((x) => x.e.type === 'card' && x.e.by === 'revert');
    process.stderr.write(`\naway rung: ${beats} beats; card ${card ? `${(card.e as { content: string }).content} while Revert ${card.state}` : 'none'}\n`);
    expect(beats).toBeGreaterThan(2);
    expect(card).toBeDefined();
    // the stick holds up Revert's card while Revert is below, in a hand or in the air (view/bench/stations/card.ts)
    expect(['below', 'held', 'loose']).toContain(card!.state);
    w.dispose();
  }, 120_000);
});
