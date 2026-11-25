// Helpers for the report press's scenarios (P4 D3).
import { benchWorld, tape, putOn, openOnStand, BENCH, LOOSE_BENCH, type Tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PRESS } from '../../src/workshop/sim/scenes/bench.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';

/** A part's location as one short word: `rest`, `shipped`, or `in:<mouth>`. */
export const loc = (w: World, id: string): string => {
  const l = w.part(id)!.location;
  return l.at === 'in' ? `in:${l.mouth}` : l.at;
};

/** Run until `ok` holds (true), or `max` steps (false). */
export function until(w: World, t: Tape, ok: () => boolean, max: number): boolean {
  void w;
  for (let i = 0; i < max; i++) {
    if (ok()) return true;
    t.run(1);
  }
  return ok();
}

/**
 * The bench with the press's crate set down on the opening stand and opened there (I2: the one way a crate opens; it was
 * set down on the open bench and opened by its latch): the press on its tray, on the stand. With `at` the press is then
 * carried off its tray and set down there, out on the bench, which only the stand's loose-things way allows
 * (`LOOSE_BENCH`, the default scene when `at` is given): on the shipped bench (`things: 'fixed'`) it never leaves its tray.
 */
export async function pressOut(seed: string, opts: { at?: [number, number, number]; scene?: SceneDesc } = {}): Promise<{ w: World; t: Tape }> {
  const scene = opts.scene ?? (opts.at ? LOOSE_BENCH : BENCH);
  if (opts.at && scene.openingStand?.things !== 'loose') throw new Error('pressOut: a press set down out on the bench needs the loose-things stand');
  const w = await benchWorld(seed, { scene });
  const t = tape(w);
  t.run(30);
  openOnStand(w, t, PRESS.crate);
  t.run(30);
  if (opts.at) {
    putOn(w, t, PRESS.body, opts.at, 60);
    t.run(HZ);
    if (w.mode(PRESS.body) !== 'free' && w.mode(PRESS.body) !== 'machine') throw new Error(`pressOut: the press is ${w.mode(PRESS.body)} at ${opts.at}`);
  }
  return { w, t };
}
