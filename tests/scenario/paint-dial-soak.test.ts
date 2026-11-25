// P4 D2b: a soak aimed at the paint dial, on the whole bench (the real crew, the line, Rapier). Each seeded session
// opens t-components' crate and then does ordinary and stupid things in a random order: the knob pressed, dragged
// through detents, the lever, the dial picked up and set down, thrown, put on the belt to ship, off the bench's edge,
// its crate shut and opened, the ledger's crank, "Reset the workshop". At every step: the dial's scheme is one of the
// dial's; the view says what the field says; a turn out of reach changed nothing; and the durable state is what the
// history says (the replay check). At the end of a session left alone, the dial is somewhere a visitor can find it.
//
// In verify: PAINT_SOAK sessions (default 6). Bigger: PAINT_SOAK=200 npx vitest run tests/scenario/paint-dial-soak.test.ts
// (PAINT_SOAK_FROM=n starts at seed n, to run one session again).
// (I2) The crate opens the one way the bench has: set down on the opening stand; "its crate shut and opened" is the
// crate lifted off the stand (it shuts) and set on it again (it opens). Each seed runs twice: on LOOSE_FULL_BENCH (the
// stand's `things: 'loose'`, where the dial can be carried, thrown, shipped and sent off the edge, as before) and on
// the shipped bench (`things: 'fixed'`: the dial stays on its tray, every attempt to take it is refused).
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, LOOSE_FULL_BENCH, onBelt, openOnStand, putOn, standTop, type Tape } from './line-helpers.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import { LEDGER, PAINT } from '../../src/workshop/sim/scenes/bench.ts';
import { PAINT_TUNING, SCHEME_FIELD } from '../../src/workshop/sim/machines/paint-dial.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PaintDialView, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.PAINT_SOAK ?? 6);
const FROM = Number(process.env.PAINT_SOAK_FROM ?? 0);
const PARTS = FULL_BENCH.parts.map((p) => p.id);
const JACKS = FULL_BENCH.cord.jacks.map((j) => j.id);
const S = PAINT_TUNING.schemes;
const SEEN: Record<string, number> = { press: 0, drag: 0, misfire: 0, turned: 0, wiped: 0, undo: 0, grab: 0, throw: 0, belt: 0, shipped: 0, edge: 0, lid: 0, crank: 0, reset: 0 };

async function session(seed: number, scene: SceneDesc): Promise<{ ok: boolean; log: string[]; error?: string }> {
  const r = rng(`paint-soak-${seed}`);
  const w: World = await benchWorld(`paint-soak-${seed}`, { scene });
  const log: string[] = [];
  const chk = checker(w, { jacks: JACKS, parts: PARTS });
  const D = PAINT.dial;
  const check = (where: string): void => {
    const s = w.setting(D, SCHEME_FIELD);
    if (typeof s !== 'string' || !S.includes(s)) throw new Error(`${where}: the dial's scheme is not one of the dial's: ${JSON.stringify(s)}`);
    const v = w.machine(PAINT.unit) as PaintDialView;
    if (v.scheme !== s || v.index !== S.indexOf(s)) throw new Error(`${where}: the view says ${v.scheme} for ${s}`);
    if (!w.part(D)) throw new Error(`${where}: the dial is gone`);
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      w.advance();
      const ev = w.drainEvents();
      for (const e of ev) {
        if (e.type === 'misfire' && e.id === PAINT.knob) SEEN.misfire!++;
        if (e.type === 'paint.turned') SEEN.turned!++;
        if (e.type === 'paint.wiped') SEEN.wiped!++;
        if (e.type === 'shipped' && e.part === D) SEEN.shipped!++;
      }
      check(`step ${w.step}`);
      chk.step(ev, w.step);
    }
  };
  /** (I2) `run` as a tape, for the helpers that carry a crate (every step still checked). */
  const t = { run: (n: number) => (run(n), []) } as unknown as Tape;
  /** A turn out of reach changes nothing. */
  const knob = (intent: { type: 'press' } | { type: 'turn'; value: number }): void => {
    const reach = (w.machine(PAINT.unit) as PaintDialView).reachable;
    const was = w.setting(D, SCHEME_FIELD);
    w.dispatch(intent.type === 'press' ? { type: 'press', id: PAINT.knob } : { type: 'turn', id: PAINT.knob, value: intent.value });
    if (!reach && w.setting(D, SCHEME_FIELD) !== was) throw new Error('a turn out of reach changed the scheme');
  };
  const carry = (to: Vec3, v: Vec3): void => {
    const m = w.motion(D);
    if (!m || m.mode === 'gone' || m.mode === 'chute') return;
    w.dispatch({ type: 'grab', id: D, grip: m.pose.p });
    run(2);
    if (w.holding()?.id !== D) {
      // (I2: on the shipped bench the dial on its tray is not a hand's; whatever the hand took instead, it lets go)
      if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      run(1);
      return;
    }
    // now and then a turn while it is in the hand: a misfire
    if (r.chance(0.3)) knob({ type: 'press' });
    for (let k = 1; k <= 12; k++) {
      w.dispatch({ type: 'carry', target: [m.pose.p[0] + ((to[0] - m.pose.p[0]) * k) / 12, Math.max(0.6, to[1]), m.pose.p[2] + ((to[2] - m.pose.p[2]) * k) / 12] });
      run(1);
    }
    w.dispatch({ type: 'release', velocity: v });
    run(1);
  };
  try {
    run(30);
    openOnStand(w, t, PAINT.crate);
    run(5);
    for (let a = 0; a < 28; a++) {
      const k = r.int(16);
      if (k < 4) {
        knob({ type: 'press' });
        SEEN.press!++;
        log.push('press');
      } else if (k < 6) {
        // a drag through a few detents in one gesture
        const from = S.indexOf(w.setting(D, SCHEME_FIELD) as string);
        const to = r.int(S.length);
        const dir = Math.sign(to - from);
        for (let i = from; i !== to; i += dir) {
          knob({ type: 'turn', value: (i + dir) / (S.length - 1) });
          run(2);
        }
        SEEN.drag!++;
        log.push(`drag to ${to}`);
      } else if (k < 8) {
        w.dispatch({ type: 'undo' });
        SEEN.undo!++;
        log.push('undo');
      } else if (k < 9) {
        carry([r.range(-3, 3), 0.5, r.range(1, 3.5)], [0, 0, 0]);
        SEEN.grab!++;
        log.push('set down');
      } else if (k < 10) {
        carry([r.range(-4, 4), 1.5, r.range(-2, 3)], [r.range(-6, 6), r.range(0, 5), r.range(-6, 6)]);
        SEEN.throw!++;
        log.push('thrown');
      } else if (k < 11) {
        carry(onBelt(r.range(0.2, 0.8)), [0, 0, 0]);
        SEEN.belt!++;
        log.push('belt');
      } else if (k < 12) {
        carry([9.5, 1.2, r.range(-3, 3)], [8, 2, 0]);
        SEEN.edge!++;
        log.push('off the edge');
      } else if (k < 13) {
        // (I2) the crate shut and opened: lifted off the stand to a clear spot, or set on it again
        if (w.mode(PAINT.crate) === 'free' && !w.holding()) {
          const open = w.setting(PAINT.crate, 'open') === true;
          putOn(w, t, PAINT.crate, open ? [-5.6, 0, 1.6] : standTop(w));
          SEEN.lid!++;
          log.push(open ? 'crate off the stand' : 'crate on the stand');
        }
      } else if (k < 14) {
        w.dispatch({ type: 'press', id: LEDGER.crank });
        SEEN.crank!++;
        log.push('crank');
      } else if (k < 15) {
        if (r.chance(0.3)) {
          w.dispatch({ type: 'reset' });
          SEEN.reset!++;
          log.push('reset');
        }
      }
      run(r.chance(0.5) ? r.int(20) + 1 : r.int(240) + 30);
    }
    // left alone: in time the dial is in its crate or lying on the bench, its scheme one of the dial's (30 s: a dial
    // shipped late in a session may still be on its way back up the chute at 14 s; seed 6 of 60 was, and was on the
    // bench 10 s later)
    run(steps(30));
    const m = w.mode(D);
    const l = w.part(D)!.location;
    if (!(m === 'gone' && l.at === 'in') && !(m === 'free' || m === 'machine')) throw new Error(`left alone, the dial is ${m} (${JSON.stringify(l)})`);
    w.dispose();
    return { ok: true, log };
  } catch (e) {
    w.dispose();
    return { ok: false, log, error: String(e) };
  }
}

test(`the paint dial soak: ${SESSIONS} sessions keep the dial's scheme one of its own, the view true to it, and the history replayable`, async () => {
  const bad: string[] = [];
  for (let s = FROM; s < FROM + SESSIONS; s++) {
    for (const [name, scene] of [['loose', LOOSE_FULL_BENCH], ['fixed', FULL_BENCH]] as const) {
      const o = await session(s, scene);
      if (!o.ok) bad.push(`seed ${s} (things ${name}): ${o.error}\n  after: ${o.log.join(', ')}`);
    }
  }
  process.stderr.write(`\npaint dial soak: ${JSON.stringify(SEEN)}\n`);
  expect(bad).toEqual([]);
  expect(SEEN.turned).toBeGreaterThan(0);
}, Math.max(300_000, SESSIONS * 40_000));
