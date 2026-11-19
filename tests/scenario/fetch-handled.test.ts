// S5: Fetch picked up and put down, at the bench's size, under real Rapier (§ B5 "picked up"; § B2 "Fetch
// can be shipped"; § E5 worked example "ships Fetch").
import { describe, expect, test } from 'vitest';
import { benchWorld, onBelt, putOn, tape } from './line-helpers.ts';
import { roundsBench, startPlay } from './fetch-helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import { lanePath } from '../../src/workshop/sim/path.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import type { World } from '../../src/workshop/sim/world.ts';

/** How far Fetch stands from the nearest point of its path. */
function offPath(w: World): number {
  const f = w.crew('fetch')!;
  const sc = w.scene;
  const path = lanePath(sc.runner.lane.points, FETCH_TUNING.cornerRadius * (sc.crewScale ?? 1));
  const q = path.at(path.nearest(f.x, f.z));
  return Math.hypot(f.x - q[0], f.z - q[1]);
}

const SCENE = roundsBench();

describe('picked up and put down', () => {
  test('picked up, its wheel spins (held); put down on the bench off its lane, it rights itself and hurries back, then carries on its rounds', async () => {
    const w = await benchWorld('held-bench', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    t.run(steps(4));
    putOn(w, t, 'fetch', [2, 0, -2.6]);
    expect(w.crew('fetch')!.state).toBe('held');
    const back = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'return', steps(5));
    expect(back).not.toBeNull();
    const idle = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'idle', steps(8));
    expect(idle).not.toBeNull();
    expect(offPath(w)).toBeLessThan(1e-6); // back on its path (A1 round 6: runs of tape)
    // its rounds go on: a crate onto the belt within a quarter minute
    const fed = t.until((e) => e.type === 'taken-in' && e.mouth === 'belt' && e.part !== 'fetch', steps(15));
    expect(fed).not.toBeNull();
    w.dispose();
  }, 60_000);

  test('put down on the belt it rides, is struck, ships; it comes back up the chute by itself ("written by crew") and hurries back to its lane', async () => {
    const w = await benchWorld('held-belt', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    t.run(steps(1));
    putOn(w, t, 'fetch', onBelt(0.35));
    // standing still while the belt holds it
    const taken = t.until((e) => e.type === 'taken-in' && e.part === 'fetch', steps(3));
    expect(taken?.e).toMatchObject({ id: 'belt' });
    const txn = w.writer('fetch', 'location');
    expect(txn).toMatch(/^t\d+$/);
    expect(w.crew('fetch')!.state).toBe('held');
    const struck = t.until((e) => e.type === 'struck' && e.part === 'fetch', steps(10));
    expect(struck?.e).toMatchObject({ material: 'metal' });
    const shipped = t.until((e) => e.type === 'shipped' && e.part === 'fetch', steps(10));
    expect(shipped).not.toBeNull();
    expect(w.mode('fetch')).toBe('gone');
    expect(w.crew('fetch')!.state).toBe('held');
    // (R2) refused at once: thrown back up the chute onto its stand by the pad, under two seconds after it went
    const returned = t.until((e) => e.type === 'restock.launched' && e.part === 'fetch', steps(2));
    expect(returned).not.toBeNull();
    const hurry = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'return', steps(6));
    expect(hurry).not.toBeNull();
    // where it came to rest is the crew's: the shipment is no longer the visitor's to take back (§ E5 "ships Fetch")
    expect(w.writer('fetch', 'location')).toBe('crew');
    const idle = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'idle', steps(8));
    expect(idle).not.toBeNull();
    expect(offPath(w)).toBeLessThan(1e-6); // back on its path (A1 round 6: runs of tape)
    w.dispose();
  }, 60_000);
});
