// (P4 T2 round two, a dock fault found by the tool soak) A part on its way back from the dock (shipped, sent up the
// chute, in the air onto the pad: its durable location is still `shipped`) is taken into the next action's window: the
// visitor turns the belt's dial while it flies. The lever takes the turn back, and with it the parts still moving under
// it: the flying part is put back where its durable location says, `shipped`, behind the door. The dock queues a return
// for a part restored from somewhere else TO shipped, not for one restored from shipped to shipped, so nobody brings it
// back. It must come back within the dock's own return time (and a margin), whatever it is: a crate, the ledger board,
// a tool. (On `rewrite` at c8726e6 the board and the tool are stranded; T2's wall brings its own tools back after 14 s
// as a stopgap, which is why the tool here is a stand-in that is not the wall's.) A crate is not in it: a shipped crate is not
// sent back as itself but waits behind the door as a spare (the dock's `shippedOrder`), so put back as shipped it is not lost.
// Fixed in sim/machines/dock.ts `restored` (the lead, at T2's merge, by the diff T2's builder proposed: a tool restored
// to `shipped` from anywhere gets a return, the press's homeward envelope excepted). These failed before that line.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, onBelt, openOnStand, LOOSE_BENCH } from './line-helpers.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import { defaultHalfExtents } from '../../src/workshop/sim/parts.ts';
import { LEDGER } from '../../src/workshop/sim/scenes/bench.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const H = defaultHalfExtents('tool', 'M');
// (I2) the stand's loose-things bench: the ledger board below is shipped, which a board fixed on its tray never is
const WITH_TOOL: SceneDesc = {
  ...LOOSE_BENCH,
  parts: [...LOOSE_BENCH.parts, { id: 'tool-standin', kind: 'tool', size: 'M', material: 'metal', colour: 'paint-orange', label: '', station: 'line', name: 'name.crate', pose: { p: [1.5, H[1], -0.6], q: qyaw(0.3) } }],
};

/** Ship `id` from where it lies, let the dock send it back, and turn the dial while it flies home; then pull the lever. */
async function strandedCase(id: string, prepare?: (w: World, t: ReturnType<typeof tape>) => void): Promise<{ w: World; flewAt: number; mode: () => string; loc: () => string }> {
  const w = await benchWorld(`dock-return-undone-${id}`, { scene: WITH_TOOL });
  const t = tape(w);
  t.run(30);
  prepare?.(w, t);
  putOn(w, t, id, onBelt(0.4));
  // shipped, sent back, and in the air: its location still `shipped`, its body free and moving
  const flying = t.until((e) => (e.type === 'restock.launched' || e.type === 'part.returned') && ((e as { part?: string }).part === id || (e as { id?: string }).id === id), 40 * HZ);
  expect(flying, `${id} sent back up the chute`).not.toBeNull();
  // (the dock flies it onto the pad in its own hands; it is the world's again, still moving, as it lands)
  for (let i = 0; i < 3 * HZ && w.motion(id)!.mode !== 'free'; i++) t.run(1);
  expect(w.part(id)!.location.at).toBe('shipped');
  expect(w.motion(id)!.mode).toBe('free');
  // a new action while it flies (it joins the action's window), and the lever takes that action back
  w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
  t.run(2);
  w.dispatch({ type: 'undo' });
  t.run(1);
  return { w, flewAt: w.step, mode: () => w.motion(id)!.mode, loc: () => w.part(id)!.location.at };
}

const LIMIT = steps(DOCK_TUNING.returnAfter.tool + 6);

describe('the dock: a part on its way back, put back as shipped by an undo, still comes back', () => {
  for (const [what, id] of [['a tool', 'tool-standin']] as const) {
    test(what, async () => {
      const c = await strandedCase(id);
      let back = false;
      for (let i = 0; i < LIMIT && !back; i++) {
        c.w.advance();
        c.w.drainEvents();
        back = c.mode() !== 'gone';
      }
      expect(back, `${id} is ${c.mode()} (${c.loc()}) ${LIMIT / HZ} s after the undo`).toBe(true);
      c.w.dispose();
    }, 120_000);
  }

  test('the ledger board', async () => {
    const c = await strandedCase(LEDGER.board, (w, t) => {
      // out of its crate first (the crate on top of it set aside, the crate opened on the stand (I2: it was its latch), the
      // board taken off its tray)
      w.dispatch({ type: 'grab', id: 'crate-2', grip: w.motion('crate-2')!.pose.p });
      t.run(2);
      w.dispatch({ type: 'place', at: [1.15, 0, 2.6] });
      t.run(90);
      openOnStand(w, t, LEDGER.crate);
      t.run(4 * HZ);
    });
    let back = false;
    for (let i = 0; i < LIMIT && !back; i++) {
      c.w.advance();
      c.w.drainEvents();
      back = c.mode() !== 'gone';
    }
    expect(back, `the board is ${c.mode()} (${c.loc()}) ${LIMIT / HZ} s after the undo`).toBe(true);
    c.w.dispose();
  }, 120_000);
});
