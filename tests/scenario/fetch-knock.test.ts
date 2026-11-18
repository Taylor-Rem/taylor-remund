// S5: Fetch knocked about by thrown parts, under real Rapier (§ B5 as amended 2026-11-18: "shoved and
// spun, not merely bumped into; it wobbles, finds its balance and goes back to its lane").
import { describe, expect, test } from 'vitest';
import { benchWorld } from './line-helpers.ts';
import { roundsBench, startPlay } from './fetch-helpers.ts';
import { runWhile, throwAndSee } from './fetch-helpers-throw.ts';
import { obstacles, distanceTo } from '../../src/workshop/sim/crew/fetch-knock.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Id, SimEvent } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const SCENE = roundsBench();
const OBS = obstacles(SCENE);
type Knocked = Extract<SimEvent, { type: 'crew.knocked' }>;
const knocks = (ev: readonly SimEvent[]): Knocked[] => ev.filter((e): e is Knocked => e.type === 'crew.knocked');

/** Fetch's footprint as the knock keeps it: a circle round its box. */
function footprintOf(w: World): number {
  const h = w.halfExtents('fetch')!;
  return Math.hypot(h[0], h[2]);
}

/** Watch Fetch while it is knocked: on the bench, never closer to any machine than it began (nor into one). */
function watchKnock(w: World, max: number): { ev: SimEvent[]; recovered: boolean } {
  const b = w.scene.bench;
  const r = footprintOf(w);
  const f0 = w.crew('fetch')!;
  const start = OBS.map((o) => distanceTo(o, f0.x, f0.z));
  let recovered = false;
  const ev = runWhile(w, () => !recovered, max, () => {
    const f = w.crew('fetch')!;
    expect(f.x - r >= b.minX && f.x + r <= b.maxX && f.z - r >= b.minZ && f.z + r <= b.maxZ, `on the bench: ${f.x}, ${f.z}`).toBe(true);
    OBS.forEach((o, i) => {
      const d = distanceTo(o, f.x, f.z);
      if (f.state === 'knocked') expect(d >= Math.min(r, start[i] as number) - 1e-6, `into ${o.id}: ${d.toFixed(3)} at ${f.x.toFixed(2)}, ${f.z.toFixed(2)}`).toBe(true);
    });
    const lane = w.scene.runner.lane;
    if (f.state === 'idle' && Math.abs(f.z - lane.a[1]) < 1e-6) recovered = true;
  });
  return { ev, recovered };
}

/** Fetch empty-handed and idle on its lane (it has set down what it carried and the stack is empty enough to wait). */
async function readyWorld(seed: string): Promise<World> {
  const w = await benchWorld(seed, { scene: SCENE });
  startPlay(w);
  // stop the belt: it then takes one crate and waits with it, idle on its lane
  w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
  runWhile(w, () => !(w.crew('fetch')!.state === 'idle' && w.crew('fetch')!.carrying !== null && w.crew('fetch')!.stateTime > 1), steps(20));
  return w;
}

describe('knocked', () => {
  test('each strength from a scripted throw: a slow toss is a look; harder or heavier throws knock it 1, 2, 3', async () => {
    // Fetch waits on its lane with a crate in its hands (the belt is stopped); the top of the stack (S), the middle (M) are thrown at it
    const cases: { id: Id; speed: number; want: 'nudge' | 1 | 2 | 3 }[] = [
      { id: 'crate-3', speed: 1.6, want: 'nudge' },
      { id: 'crate-3', speed: 4.2, want: 1 },
      { id: 'crate-3', speed: 7.4, want: 2 },
      { id: 'crate-2', speed: 7, want: 3 },
    ];
    for (const c of cases) {
      const w = await readyWorld(`knock-${c.id}-${c.speed}`);
      const thrown = c.id;
      const ev = throwAndSee(w, thrown, { yaw: 0.3, speed: c.speed });
      const k = knocks(ev);
      if (c.want === 'nudge') {
        expect(k, `${c.id} at ${c.speed}`).toEqual([]);
        expect(ev.some((e) => e.type === 'crew.nudged'), `${c.id} at ${c.speed}: a look`).toBe(true);
      } else {
        expect(k.map((x) => x.strength), `${c.id} at ${c.speed}`).toEqual([c.want]);
        expect(k[0]!.by).toBe(thrown);
        // shoved away from the throw (the part came from yaw 0.3, so it goes toward yaw 0.3 + PI, give or take its fall)
        const away = Math.atan2(Math.sin(k[0]!.dir - (0.3 + Math.PI)), Math.cos(k[0]!.dir - (0.3 + Math.PI)));
        expect(Math.abs(away)).toBeLessThan(0.6);
        expect(Math.abs(k[0]!.spin)).toBeGreaterThan(0.5);
        const r = watchKnock(w, steps(6));
        expect(r.recovered).toBe(true);
      }
      w.dispose();
    }
  }, 120_000);

  test('knocked while carrying: it drops the crate, charged to the throw; the lever puts it back', async () => {
    const w = await readyWorld('knock-carrying');
    const held = w.crew('fetch')!.carrying!;
    expect(held).not.toBeNull();
    const before = w.part(held)!.location;
    const ev = throwAndSee(w, 'crate-2', { yaw: -0.2, speed: 6.5 });
    const k = knocks(ev);
    expect(k).toHaveLength(1);
    expect(k[0]!.dropped).toBe(held);
    expect(w.crew('fetch')!.carrying).toBeNull();
    // once everything is at rest, the dropped crate's new place is the throw's
    runWhile(w, () => w.undoStack().some((t) => t.moving.length > 0), steps(7));
    const txn = w.undoStack().at(-1)!;
    expect(txn.kind).toBe('release');
    expect(txn.entries.map((e) => e.target)).toContain(held);
    expect(w.writer(held, 'location')).toBe(txn.id);
    // the lever: the thrown crate and the dropped one go back
    w.dispatch({ type: 'undo' });
    w.advance();
    const undone = w.drainEvents().find((e) => e.type === 'undone');
    expect(undone).toBeDefined();
    expect(w.part(held)!.location).toEqual(before);
    w.dispose();
  }, 60_000);

  test('knocked at the lane\'s end: thrown toward the motor housing and the stack, it stops short of them and comes back', async () => {
    const w = await readyWorld('knock-end');
    const lane = w.scene.runner.lane;
    // to the left end of its lane (the stack and the belt's drop are there): start the belt, let it set its crate down, and stop the belt again
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    runWhile(w, () => w.crew('fetch')!.carrying !== null, steps(15));
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    runWhile(w, () => !(w.crew('fetch')!.state === 'idle' && w.crew('fetch')!.stateTime > 1), steps(20));
    expect(w.crew('fetch')!.x).toBeLessThan(lane.a[0] + 1.5);
    const ev = throwAndSee(w, 'crate-1', { yaw: Math.PI / 2 + 0.4, speed: 7 });
    const r = watchKnock(w, steps(8));
    const k = knocks([...ev, ...r.ev]);
    expect(k).toHaveLength(1);
    expect(r.recovered).toBe(true);
    w.dispose();
  }, 60_000);

  test('the part bounces off it like off a toy, not a wall: it does not fly back the way it came', async () => {
    const w = await readyWorld('knock-toy');
    const speed = 6.5;
    const yaw = 0.2;
    const ev = throwAndSee(w, 'crate-2', { yaw, speed });
    expect(knocks(ev)).toHaveLength(1);
    runWhile(w, () => true, 4);
    // along the throw (from yaw toward Fetch: -sin, -cos), what is left of its speed
    const p0 = w.motion('crate-2')!.pose.p;
    w.advance();
    w.drainEvents();
    const p1 = w.motion('crate-2')!.pose.p;
    const along = ((p1[0] - p0[0]) * -Math.sin(yaw) + (p1[2] - p0[2]) * -Math.cos(yaw)) * 60;
    expect(along).toBeGreaterThan(-0.25 * speed);
    w.dispose();
  }, 60_000);

  test('fifty knocks in a row from a seed: from every side, at every strength, it always finds its balance and returns to its lane', async () => {
    const w = await readyWorld('knock-fifty');
    const r = rng('knock-fifty');
    const crates = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
    let knocked = 0;
    let tries = 0;
    const strengths = new Set<number>();
    while (knocked < 50 && tries < 220) {
      tries++;
      const f = w.crew('fetch')!;
      // the nearest crate lying free on the bench (not on the belt, not in the dock)
      const free = crates.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest' && w.motion(id)!.pose.p[1] < 1.2);
      if (free.length === 0 || f.state !== 'idle') {
        runWhile(w, () => true, steps(1));
        continue;
      }
      const id = r.pick(free);
      const yaw = r.range(-Math.PI, Math.PI);
      // throw from a clear spot only (not from inside a machine)
      const from = 1.7;
      const sx = f.x + Math.sin(yaw) * from;
      const sz = f.z + Math.cos(yaw) * from;
      if (OBS.some((o) => distanceTo(o, sx, sz) < 0.5) || sx < -8.5 || sx > 8.5 || sz < -4.5 || sz > 4.6) continue;
      // (nor from inside another robot's body: Revert is a body now, not a static, since S4)
      if ([...w.parts()].some((p) => p.kind === 'robot' && p.id !== 'fetch' && Math.hypot(w.motion(p.id)!.pose.p[0] - sx, w.motion(p.id)!.pose.p[2] - sz) < Math.max(w.halfExtents(p.id)![0], w.halfExtents(p.id)![2]) + 0.5)) continue;
      const ev = throwAndSee(w, id, { yaw, speed: r.range(3.5, 7.5), aimSide: r.range(-0.3, 0.3) });
      const watch = watchKnock(w, steps(9));
      const k = knocks([...ev, ...watch.ev]);
      expect(k.length).toBeLessThanOrEqual(1);
      if (k.length === 1) {
        knocked++;
        strengths.add(k[0]!.strength);
        expect(watch.recovered, `knock ${knocked} (from yaw ${yaw.toFixed(2)}) did not end on its lane`).toBe(true);
      }
      // let the bench settle a little between throws
      runWhile(w, () => true, steps(1.5));
    }
    console.log(`fifty knocks: ${knocked} knocks in ${tries} throws; strengths ${[...strengths].sort().join(', ')}`);
    expect(knocked).toBe(50);
    expect(strengths.size).toBeGreaterThanOrEqual(2);
    w.dispose();
  }, 240_000);
});
