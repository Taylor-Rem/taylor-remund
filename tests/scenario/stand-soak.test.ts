// P4 S6: the opening stand under a random hand (STAND_SOAK sessions, default 12; STAND_PLACE a|b|c, default c): crates
// set on it, lifted off, a second one brought, thrown, the lever pulled at any point, "Reset the workshop" now and then.
// Every step: no project crate is open off the stand (once it lies still), none is open in a machine's or the crew's
// hands, and with `things: 'fixed'` no crate's thing is ever out of it (its location stays in its crate). At the end
// the lever is pulled until nothing is left: every crate is shut and every thing in its crate.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { OPENING_STAND, withOpeningStand, type StandPlace } from '../../src/workshop/sim/scenes/bench.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Id, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.STAND_SOAK ?? 12);
const PLACE = (process.env.STAND_PLACE ?? 'centre') as StandPlace;
const scene = withOpeningStand(FULL_BENCH, PLACE, 'fixed');
const CRATES = scene.projects ?? [];
const pl = OPENING_STAND.places[PLACE];
const TOP: Vec3 = [pl.at[0], pl.at[1] + pl.h, pl.at[2]];
const SPOTS: Vec3[] = [[-5.6, 0, 1.6], [-3.4, 0, 1.2], [0.9, 0, 1.4], TOP];
const SEEN = { set: 0, opened: 0, lifted: 0, second: 0, thrown: 0, undone: 0, resets: 0, sessions: 0 };

describe('the opening stand under a random hand', () => {
  test(`${SESSIONS} sessions at ${PLACE}: never open off the stand, never a thing out of its crate`, async () => {
    for (let s = 1; s <= SESSIONS; s++) {
      const w = await benchWorld(`stand-soak-${s}`, { scene });
      const t = tape(w);
      const r = rng(`stand-soak-${s}`);
      const check = (): void => {
        for (const c of CRATES) {
          if (w.setting(c.crate, 'open') === true) {
            const m = w.motion(c.crate)!;
            if (m.mode !== 'free' && m.mode !== 'held') throw new Error(`session ${s} step ${w.step}: ${c.crate} open while ${m.mode}`);
            const p = m.pose.p;
            const off = Math.abs(p[0] - TOP[0]) > OPENING_STAND.half[0] + 0.05 || Math.abs(p[2] - TOP[2]) > OPENING_STAND.half[1] + 0.05;
            if (m.mode === 'free' && !m.awake && off) throw new Error(`session ${s} step ${w.step}: ${c.crate} open off the stand at ${p.map((v) => v.toFixed(2))}`);
          }
          if (c.holds !== undefined) {
            const l = w.part(c.holds)!.location;
            if (!(l.at === 'in' && l.mouth === c.crate)) throw new Error(`session ${s} step ${w.step}: ${c.holds} out of ${c.crate} (${JSON.stringify(l)})`);
          }
        }
      };
      const run = (n: number): void => {
        for (let i = 0; i < n; i++) {
          for (const e of t.run(1)) if (e.type === 'crate.opened') SEEN.opened++;
          check();
        }
      };
      run(30);
      for (let a = 0; a < 14; a++) {
        const k = r.int(100);
        const free = CRATES.filter((c) => w.mode(c.crate) === 'free');
        if (k < 45 && free.length) {
          const c = r.pick(free);
          const onStand = Math.hypot(w.motion(c.crate)!.pose.p[0] - TOP[0], w.motion(c.crate)!.pose.p[2] - TOP[2]) < 0.4;
          if (!onStand) {
            if (CRATES.some((o) => w.setting(o.crate, 'open') === true)) SEEN.second++;
            SEEN.set++;
          } else SEEN.lifted++;
          putOn(w, t, c.crate, onStand ? r.pick(SPOTS.slice(0, 3)) : TOP);
          check();
        } else if (k < 60 && free.length) {
          const c = r.pick(free);
          w.dispatch({ type: 'grab', id: c.crate, grip: w.motion(c.crate)!.pose.p });
          run(4);
          w.dispatch({ type: 'release', velocity: [r.next() * 4 - 2, 2 + r.next() * 2, r.next() * 2 - 1] });
          SEEN.thrown++;
        } else if (k < 85) {
          w.dispatch({ type: 'press', id: 'undo-lever' });
          SEEN.undone++;
        } else if (k < 90) {
          w.dispatch({ type: 'reset' });
          SEEN.resets++;
        } else {
          const open = CRATES.filter((c) => w.setting(c.crate, 'open') === true);
          if (open.length) w.dispatch({ type: 'press', id: r.pick(open).plate });
        }
        run(r.int(steps(2.5)) + 1);
      }
      if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      run(steps(1));
      for (let pulls = 0; pulls < 300 && (w.undoStack().length > 0 || w.bracketed); pulls++) {
        w.dispatch({ type: 'press', id: 'undo-lever' });
        run(1 + r.int(25));
      }
      run(steps(4));
      for (const c of CRATES) expect(w.setting(c.crate, 'open'), `session ${s}: ${c.crate} shut when everything is undone`).toBe(false);
      SEEN.sessions++;
      w.dispose();
    }
    process.stderr.write(`\nstand soak covered: ${JSON.stringify(SEEN)}\n`);
  }, 30 * 60_000);
});
void (null as unknown as Id);
