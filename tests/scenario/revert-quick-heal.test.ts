// R3 (Taylor, 2026-11-20: "If even one is out of reach of the fetch, just have the robot come out pretty quickly
// to clean it up. If the player picks up the box before revert can reach it, he just returns to his spot."), on
// the whole bench under Rapier with Fetch on its rounds.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, RevertView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2'];
// (L2: at -8.2, -4.2 it stood in the corner, which is now behind the Button's console, where Revert has no stand: the strays
// there go home by the chute, tests/scenario/heal-unreachable.test.ts)
const BACK_LEFT: Vec3 = [-5.4, 0, -4.3];
/** (L2) The tower's place: in front of the Button's console at the bench's left end (it stood at -6.6, -1.6, where the console is now). */
const TX = -8.2, TZ = -0.2;
const rv = (w: World): RevertView => w.machine('revert-crew') as RevertView;
const loose = (w: World): Id => CRATES.find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;

async function bench(seed: string) {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(20));
  return { w, t };
}

describe('R3, 2026-11-20: Revert comes out quickly for a crate Fetch may not carry', () => {
  test('one crate thrown to the back left while Fetch is busy: swept within about 20 s of being set down', async () => {
    const { w, t } = await bench('quick-1');
    const id = loose(w);
    putOn(w, t, id, BACK_LEFT);
    let swept = -1;
    let fetchBusy = false;
    for (let i = 0; i < steps(40) && swept < 0; i++) {
      for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === id && e.to.at === 'rest') swept = i / HZ;
      if (CRATES.some((x) => w.mode(x) === 'crew' && x !== id) || w.crew('fetch')?.state !== 'idle') fetchBusy = true;
    }
    process.stderr.write(`\none crate: swept after ${swept.toFixed(1)} s (Fetch busy meanwhile: ${fetchBusy})\n`);
    expect(swept).toBeGreaterThan(7.9);
    expect(swept).toBeLessThan(20);
    expect(fetchBusy).toBe(true);
    w.dispose();
  }, 300_000);

  test('taken from under its nose: it stops, looks at the hand, goes home and down, no card; it never chases the crate while it is held; set down again, the while starts again', async () => {
    const { w, t } = await bench('quick-2');
    const id = loose(w);
    putOn(w, t, id, BACK_LEFT);
    for (let i = 0; i < steps(40) && !(rv(w).state === 'trundle' && rv(w).bound === id && Math.hypot(rv(w).x - BACK_LEFT[0], rv(w).z - BACK_LEFT[2]) < 3.5); i++) t.run(1);
    expect(rv(w).bound).toBe(id);
    // the visitor takes it, and holds it up
    const p = w.motion(id)!.pose.p;
    w.dispatch({ type: 'grab', id, grip: [p[0], p[1], p[2]] });
    const ev: SimEvent[] = [];
    let looked = false;
    let chased = false;
    let downAt = -1;
    for (let i = 0; i < steps(20) && downAt < 0; i++) {
      w.dispatch({ type: 'carry', target: [p[0] + 0.5, 2.2, p[2] + 1] });
      ev.push(...t.run(1));
      const r = rv(w);
      if (r.waitingFor === id) looked = true;
      if (r.bound === id || r.sweeping === id) chased = true;
      if (r.state === 'below') downAt = i / HZ;
    }
    process.stderr.write(`\ntaken: looked ${looked}; home and down after ${downAt.toFixed(1)} s; cards ${ev.filter((e) => e.type === 'card').length}\n`);
    expect(looked).toBe(true);
    expect(chased).toBe(false);
    expect(downAt).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'card' && e.by === 'revert')).toBe(false);
    expect(ev.some((e) => e.type === 'revert.sweep' && e.part === id)).toBe(false);
    // set down again: it is not swept before its while has passed again
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    let again = -1;
    for (let i = 0; i < steps(40) && again < 0; i++) for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === id && e.to.at === 'rest') again = i / HZ;
    process.stderr.write(`set down again: swept after ${again.toFixed(1)} s\n`);
    expect(again).toBeGreaterThan(7.9);
    w.dispose();
  }, 300_000);

  test('a tower the visitor builds (a crate on a crate) is left alone while it is fresh; once it has stood still a while it is taken from the top', async () => {
    const { w, t } = await bench('quick-3');
    const a = loose(w);
    putOn(w, t, a, [TX, 0, TZ]); // (L2: at -6.6, -1.6 until the Button's console stood there)
    const b = CRATES.find((x) => x !== a && w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
    putOn(w, t, b, [TX, 2 * w.halfExtents(a)![1], TZ]);
    t.run(steps(1));
    const top = w.motion(b)!.pose.p[1] > w.motion(a)!.pose.p[1] + 0.2 ? b : a;
    const bottom = top === a ? b : a;
    expect(w.motion(top)!.pose.p[1]).toBeGreaterThan(w.motion(bottom)!.pose.p[1] + 0.2); // a tower
    const order: { part: Id; at: number }[] = [];
    for (let i = 0; i < steps(70) && order.length < 2; i++) for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.to.at === 'rest') order.push({ part: e.part, at: i / HZ });
    process.stderr.write(`\ntower: ${order.map((o) => `${o.part === top ? 'top' : o.part === bottom ? 'bottom' : o.part} at ${o.at.toFixed(1)} s`).join(', ')}\n`);
    expect(order.length).toBeGreaterThan(0);
    expect(order[0]!.part).toBe(top); // from the top
    expect(order[0]!.at).toBeGreaterThan(25); // left alone while fresh (30 s still, less the time the tower took to build)
    w.dispose();
  }, 300_000);
});
