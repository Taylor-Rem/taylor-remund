// Helpers for the report press's scenarios (P4 D3).
import { benchWorld, tape, putOn, BENCH, type Tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PRESS } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
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

/** The bench with the press's crate set down on the open bench (at `at`) and opened: the press on its tray. */
export async function pressOut(seed: string, opts: { at?: [number, number, number]; scene?: SceneDesc } = {}): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: opts.scene ?? BENCH });
  const t = tape(w);
  t.run(30);
  putOn(w, t, PRESS.crate, opts.at ?? [-1.4, 0, 0.9]);
  t.run(HZ);
  for (let i = 0; i < 4 && w.setting(PRESS.crate, OPEN) !== true; i++) {
    w.dispatch({ type: 'press', id: `${PRESS.crate}-lid` });
    t.run(30);
  }
  return { w, t };
}
