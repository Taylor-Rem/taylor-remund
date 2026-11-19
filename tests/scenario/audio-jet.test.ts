// S5 jet (Taylor, 2026-11-19: "a little jetpack to fly back on"): the sound of Fetch's flight, from the simulation's
// events and state only. A pop at `jet.ignited`, one hiss that follows the thrust until `jet.cut`, a puff at the cut,
// the touchdown and the bounce in Fetch's own note; and the hiss never left hanging (caught in mid-air, a reset).
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { Score, type Cue, type LoopCue } from '../../src/workshop/audio/score.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

interface Frame {
  step: number;
  events: SimEvent[];
  cues: readonly Cue[];
  jet: LoopCue;
  state: string;
  thrust: number;
}

const B = FULL_BENCH.bench;

function listen(w: World): { frames: Frame[]; step(): Frame } {
  const score = new Score();
  const frames: Frame[] = [];
  return {
    frames,
    step() {
      w.advance();
      const events = w.drainEvents();
      const h = score.hear(w, events);
      const f = w.crew('fetch')!;
      const fr = { step: w.step, events, cues: h.cues, jet: h.loops.find((l) => l.id === 'loop.jet')!, state: f.state, thrust: f.jet?.thrust ?? 0 };
      frames.push(fr);
      return fr;
    },
  };
}

/** Lift Fetch, carry it out past the front edge, and let it go: it goes over. */
function overboard(w: World, l: ReturnType<typeof listen>): void {
  const p = w.motion('fetch')!.pose.p;
  w.dispatch({ type: 'grab', id: 'fetch', grip: p });
  l.step();
  const to: Vec3 = [-1, 1.5, B.maxZ + 0.6];
  for (let i = 0; i < 70; i++) {
    w.dispatch({ type: 'carry', target: to });
    l.step();
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 1] });
  l.step();
}

const ids = (fs: Frame[]): string[] => fs.flatMap((f) => f.cues.map((c) => c.id));

describe("Fetch's jetpack, heard", () => {
  test('a whole flight: pop at ignition, the hiss with the thrust, a puff at the cut, the touchdown and the bounce in its own note', async () => {
    const w = await benchWorld('audio-jet', { scene: FULL_BENCH });
    startPlay(w);
    const l = listen(w);
    overboard(w, l);
    const from = l.frames.length;
    for (let i = 0; i < steps(6) && !(l.frames.length > from + 5 && l.frames[l.frames.length - 1]!.state !== 'jetpack' && l.frames.some((f) => f.events.some((e) => e.type === 'jet.cut'))); i++) l.step();
    const fl = l.frames.slice(from);
    const ign = fl.findIndex((f) => f.events.some((e) => e.type === 'jet.ignited'));
    const cut = fl.findIndex((f) => f.events.some((e) => e.type === 'jet.cut'));
    expect(ign).toBeGreaterThanOrEqual(0);
    expect(cut).toBeGreaterThan(ign);
    // the fall is silent; the pop lands with the ignition
    expect(fl.slice(0, ign).some((f) => f.jet.gain > 0)).toBe(false);
    expect(fl[ign]!.cues.map((c) => c.id)).toContain('jet.pop');
    // one continuous hiss from the ignition to the cut, its level and brightness following the thrust
    const burning = fl.slice(ign + 1, cut);
    expect(burning.every((f) => f.jet.gain > 0)).toBe(true);
    const full = burning.reduce((a, f) => (f.thrust > a.thrust ? f : a));
    const soft = burning.filter((f) => f.thrust > 0).reduce((a, f) => (f.thrust < a.thrust ? f : a));
    expect(full.jet.gain).toBeGreaterThan(soft.jet.gain);
    expect(full.jet.rate).toBeGreaterThan(soft.jet.rate);
    expect(full.jet.gain).toBeLessThanOrEqual(1);
    // the cut: a puff, and the hiss off that frame and after
    expect(fl[cut]!.cues.map((c) => c.id)).toContain('jet.puff');
    expect(fl.slice(cut).every((f) => f.jet.gain === 0)).toBe(true);
    // the landing: the touchdown and the bounce, each once, in Fetch's own note (metal M), the bounce softer
    const p = w.part('fetch')!;
    const knocks = fl.slice(cut).flatMap((f) => f.cues.filter((c) => c.id === `hit.${p.material}.${p.size}`));
    expect(knocks.length).toBe(2);
    expect(knocks[1]!.gain).toBeLessThan(knocks[0]!.gain);
    // and only one pop, one puff
    expect(ids(fl).filter((x) => x === 'jet.pop').length).toBe(1);
    expect(ids(fl).filter((x) => x === 'jet.puff').length).toBe(1);
    w.dispose();
  }, 120_000);

  test('caught in mid-flight: the hiss stops at once, no puff, no landing knock', async () => {
    const w = await benchWorld('audio-jet-catch', { scene: FULL_BENCH });
    startPlay(w);
    const l = listen(w);
    overboard(w, l);
    let fr = l.step();
    for (let i = 0; i < steps(4) && w.crew('fetch')!.jet?.phase !== 'cruise'; i++) fr = l.step();
    expect(fr.jet.gain).toBeGreaterThan(0);
    w.dispatch({ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p });
    const after = [l.step(), l.step(), l.step()];
    expect(after.every((f) => f.jet.gain === 0)).toBe(true);
    const later: Frame[] = [];
    for (let i = 0; i < steps(1); i++) later.push(l.step());
    expect(ids([...after, ...later]).filter((x) => x === 'jet.puff' || x.startsWith('hit.metal'))).toEqual([]);
    w.dispose();
  }, 120_000);

  test('"Reset the workshop" in mid-flight: the hiss stops', async () => {
    const w = await benchWorld('audio-jet-reset', { scene: FULL_BENCH });
    startPlay(w);
    const l = listen(w);
    overboard(w, l);
    let fr = l.step();
    for (let i = 0; i < steps(4) && w.crew('fetch')!.jet?.phase !== 'rise'; i++) fr = l.step();
    expect(fr.jet.gain).toBeGreaterThan(0);
    w.dispatch({ type: 'reset' });
    const after = [l.step(), l.step()];
    expect(after.every((f) => f.jet.gain === 0)).toBe(true);
    w.dispose();
  }, 120_000);
});
