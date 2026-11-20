// R4: Fetch answers a thrown Patch. Patch in the air treats Fetch as solid: it stops against it and drops beside it,
// and says so (`patch.throw`, phase `hit`, `what: 'fetch'`). Fetch is knocked as by a thrown crate (§ B5: "it is
// shoved and spun, not merely bumped into; it wobbles, finds its balance and goes back to its lane"): slid away from
// the side Patch came from, by its speed, bounded by `clearRun`; then it looks at Patch, and goes back to work.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, tape, type Tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PatchView, Vec3 } from '../../src/workshop/sim/types.ts';
import { obstacles, distanceTo } from '../../src/workshop/sim/crew/fetch-knock.ts';

const upY = (q: readonly number[]): number => 1 - 2 * ((q[0] as number) ** 2 + (q[2] as number) ** 2);
const patchAt = (w: World): Vec3 => (w.crewView('patch') as unknown as { view: PatchView }).view.at;

/** Play mode; Fetch waiting at its stand by the pad, empty-handed (the attract crate delivered). */
async function fetchWaiting(seed: string): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(1));
  startPlay(w);
  for (let i = 0; i < steps(60); i++) {
    t.run(1);
    const f = w.crew('fetch')!;
    if (!f.carrying && f.state === 'idle' && Math.hypot(f.x - -2.9, f.z - 2.78) < 0.05 && i > steps(8)) break;
  }
  return { w, t };
}

describe('Fetch hit by a thrown Patch', () => {
  // from Fetch's left along its tape, and from its right (Patch let go at Fetch's height, aimed at its middle)
  const sides: [string, number][] = [['from its left', -1], ['from its right', 1]];
  for (const [side, sx] of sides) {
    for (const speed of [4, 9, 14]) {
      test(`${side} at ${speed} u/s: knocked away from Patch, spun, looks at Patch, on its wheels on its tape, back at work within 10 s`, async () => {
        const { w, t } = await fetchWaiting(`r4-patch-hit-${sx}-${speed}`);
        const f0 = w.motion('fetch')!.pose.p;
        // the hand: up and over to a run-up point, then a run of 6 steps at the throw's speed toward Fetch (a fling, not a pause)
        const run = 6;
        const from: Vec3 = [f0[0] + sx * (1.6 + (speed * run) / HZ), 1.45, f0[2]]; // (the hand 0.6 over Patch's middle: its middle at Fetch's)
        w.dispatch({ type: 'grab', id: 'patch', grip: patchAt(w) });
        for (let i = 1; i <= 50; i++) {
          w.dispatch({ type: 'carry', target: [from[0], 2.8 - (1.35 * i) / 50, from[2]] });
          t.run(1);
        }
        for (let i = 1; i <= run; i++) {
          w.dispatch({ type: 'carry', target: [from[0] - (sx * speed * i) / HZ, 1.45, from[2]] });
          t.run(1);
        }
        w.dispatch({ type: 'release', velocity: [-sx * speed, 0.4, 0] });
        const hit = t.until((e) => e.type === 'patch.throw' && e.phase === 'hit' && e.what === 'fetch', steps(2));
        expect(hit, 'Patch meets Fetch').not.toBeNull();
        const knocked = t.until((e) => e.type === 'crew.knocked' && e.id === 'fetch', 5);
        expect(knocked, 'Fetch is knocked').not.toBeNull();
        const k = knocked!.e as { by: string; strength: number; distance: number; spin: number; dir: number };
        expect(k.by).toBe('patch');
        expect(k.strength, 'harder the faster').toBe(speed < 6 ? 1 : speed < 12 ? 2 : 3);
        expect(Math.abs(k.spin)).toBeGreaterThan(0);
        // away from the side Patch came from
        expect(Math.sign(Math.sin(k.dir))).toBe(-sx);
        // never inside a body on the way; a look at Patch; back at work within ten seconds
        const bodies = obstacles(w.scene).filter((o) => !o.id.startsWith('mouth:'));
        let looked = false;
        let back = -1;
        for (let i = 0; i < steps(10) && back < 0; i++) {
          t.run(1);
          const m = w.motion('fetch')!;
          const f = w.crew('fetch')!;
          for (const o of bodies) expect(distanceTo(o, m.pose.p[0], m.pose.p[2]), `inside ${o.id}`).toBeGreaterThan(0);
          if (f.state === 'knocked' && f.lookAt) {
            const pa = patchAt(w);
            if (Math.hypot(f.lookAt[0] - pa[0], f.lookAt[2] - pa[2]) < 0.01) looked = true;
          }
          if (f.state !== 'knocked' && f.state !== 'return' && i > 10) back = i / HZ;
        }
        expect(looked, 'it looks at Patch').toBe(true);
        expect(back, 'back at work within 10 s').toBeGreaterThan(0);
        const m = w.motion('fetch')!;
        expect(m.mode).toBe('crew');
        expect(upY(m.pose.q)).toBeGreaterThan(0.99);
        expect(Math.abs(m.pose.p[2] - 2.78) < 0.05 || Math.abs(m.pose.p[0] - 1.16) < 0.05, 'on its tape').toBe(true);
        w.dispose();
      }, 120_000);
    }
  }
});

describe('Fetch knocked by a thrown Patch while it carries a crate: the lever takes it back', () => {
  test('the crate it drops is the throw\'s: one pull puts it back where the history had it before the throw; five more pulls throw nothing', async () => {
    const w = await benchWorld('r4-patch-hit-crate', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    startPlay(w);
    // Fetch with a crate in its hands, standing (at the feed, the stack or the pad's stand)
    let crate: string | null = null;
    for (let i = 0; i < steps(60) && !crate; i++) {
      t.run(1);
      const f = w.crew('fetch')!;
      if (f.carrying && f.state === 'idle' && i > steps(2)) crate = f.carrying;
    }
    expect(crate, 'it stands with a crate').toBeTruthy();
    const locBefore = w.part(crate!)!.location;
    const stackBefore = w.undoStack().length;
    const f0 = w.motion('fetch')!.pose.p;
    const speed = 12;
    const run = 3;
    // from the open side: in front of it (toward the visitor), the hand at Patch's middle height over Fetch's
    const from: Vec3 = [f0[0], 1.45, Math.min(4.3, f0[2] + 1.0 + (speed * run) / HZ)];
    w.dispatch({ type: 'grab', id: 'patch', grip: patchAt(w) });
    for (let i = 1; i <= 40; i++) {
      w.dispatch({ type: 'carry', target: [from[0], 2.8 - (1.35 * i) / 40, from[2]] });
      t.run(1);
    }
    const f1 = w.motion('fetch')!.pose.p;
    const dz = f1[2] - from[2];
    const dx = f1[0] - from[0];
    const l = Math.hypot(dx, dz);
    for (let i = 1; i <= run; i++) {
      w.dispatch({ type: 'carry', target: [from[0] + (dx / l) * ((speed * i) / HZ), 1.45, from[2] + (dz / l) * ((speed * i) / HZ)] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [(dx / l) * speed, 0.3, (dz / l) * speed] });
    const hit = t.until((e) => e.type === 'patch.throw' && e.phase === 'hit' && e.what === 'fetch', steps(2));
    expect(hit, 'Patch meets Fetch').not.toBeNull();
    const txn = (hit!.e as { txn?: string }).txn;
    expect(txn, 'the hit names the throw').toBeTruthy();
    const knocked = t.until((e) => e.type === 'crew.knocked' && e.id === 'fetch', 5);
    expect((knocked?.e as { dropped?: string | null } | undefined)?.dropped, 'it drops its crate').toBe(crate);
    t.run(steps(6));
    expect(w.mode(crate!)).toBe('free');
    expect(w.writer(crate!, 'location'), 'its rest is the throw\'s').toBe(txn);
    expect(w.undoStack().length).toBe(stackBefore + 1);
    // the lever, once: the throw taken back; the crate where the history had it before the throw
    w.dispatch({ type: 'undo' });
    t.run(steps(3));
    expect(w.part(crate!)!.location).toEqual(locBefore);
    // and five more pulls: nothing throws
    for (let k = 0; k < 5; k++) {
      w.dispatch({ type: 'undo' });
      t.run(steps(1));
    }
    t.run(steps(10));
    expect(w.crew('fetch')!.state).not.toBe('held');
    w.dispose();
  }, 120_000);
});
