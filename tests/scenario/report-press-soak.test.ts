// P4 D3: a soak aimed at the report press, on the whole bench (the real crew, the line, Rapier). Each seeded session
// opens the press's crate and then does ordinary and stupid things in a random order: the lever (often mid-sequence,
// often with the envelope out), the UNDO lever, the press picked up and set down, thrown, put on the belt to ship, off
// the bench's edge, its crate shut and opened, the envelope picked up, thrown, set on the belt, the belt stopped and
// reversed, "Reset the workshop". At every step: the durable state is what the history says (the replay check); the
// envelope is somewhere (in the press, on its way, on the bench, riding, shipped and on its way home, down the chute)
// and never anywhere else, never in the crew's hands, never shipped for longer than its way home; the press is never
// in the crew's hands; whatever a pull prints is the record of what the dock has shipped (as the bus said it, the last
// twelve), and what the holders show is always something a pull printed. Left alone at the end, the envelope is in the
// press or on the bench, and the press is in its crate or on the bench.
//
// In verify: PRESS_SOAK sessions (default 6). Bigger: PRESS_SOAK=200 npx vitest run tests/scenario/report-press-soak.test.ts
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, onBelt } from './line-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { PRESS } from '../../src/workshop/sim/scenes/bench.ts';
import { REPORT_FIELD } from '../../src/workshop/sim/machines/press.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';
import { REPORT_MAX } from '../../src/workshop/sim/machines/shared/report-press.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PressView, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.PRESS_SOAK ?? 6);
const PARTS = FULL_BENCH.parts.map((p) => p.id);
const JACKS = FULL_BENCH.cord.jacks.map((j) => j.id);
const SEEN: Record<string, number> = { pull: 0, printed: 0, flicked: 0, shrug: 0, waited: 0, undo: 0, grab: 0, throw: 0, belt: 0, envelope: 0, envShipped: 0, home: 0, pressShipped: 0, edge: 0, lid: 0, beltLever: 0, reset: 0 };
const P = PRESS.body;
const E = PRESS.envelope;

async function session(seed: number): Promise<{ ok: boolean; log: string[]; error?: string }> {
  const r = rng(`press-soak-${seed}`);
  const w: World = await benchWorld(`press-soak-${seed}`, { scene: FULL_BENCH });
  const log: string[] = [];
  const chk = checker(w, { jacks: JACKS, parts: PARTS });
  /** The record as the bus has said it (as of the end of the last step), and every report a pull has printed. */
  let record: string[] = [];
  const printed = new Set<string>(['null']);
  let shippedAt = -1;
  const homeBy = steps(DOCK_TUNING.returnAfter.tool) + 3;
  const check = (where: string): void => {
    const m = w.mode(E);
    const l = w.part(E)!.location;
    if (m === 'crew') throw new Error(`${where}: the crew has the envelope`);
    if (w.mode(P) === 'crew') throw new Error(`${where}: the crew has the press`);
    if (m === 'gone' && !(l.at === 'shipped' || (l.at === 'in' && l.mouth === P))) throw new Error(`${where}: the envelope is out of the world at ${JSON.stringify(l)}`);
    if (m === 'gone' && l.at === 'shipped') {
      if (shippedAt < 0) shippedAt = w.step;
      if (w.step - shippedAt > homeBy) throw new Error(`${where}: shipped ${((w.step - shippedAt) / HZ).toFixed(1)} s and not home`);
    } else shippedAt = -1;
    const rep = w.setting(P, REPORT_FIELD);
    if (!printed.has(JSON.stringify(rep))) throw new Error(`${where}: the holders show ${JSON.stringify(rep)}, which no pull printed`);
    const v = w.machine(PRESS.unit) as PressView;
    if (v.show && JSON.stringify(v.show.after) !== JSON.stringify(rep)) throw new Error(`${where}: the sequence ends somewhere other than the state`);
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const before = [...record];
      w.advance();
      const ev = w.drainEvents();
      for (const e of ev) {
        if (e.type === 'press.printed') {
          SEEN.printed!++;
          const want = JSON.stringify(before.slice(-REPORT_MAX));
          const got = JSON.stringify(w.setting(P, REPORT_FIELD));
          if (want !== got) throw new Error(`step ${w.step}: printed ${got}, the record says ${want}`);
          printed.add(got);
          if (!e.envelope) SEEN.shrug!++;
        }
        if (e.type === 'press.flicked') SEEN.flicked!++;
        if (e.type === 'press.home') SEEN.home!++;
        if (e.type === 'shipped') {
          record.push(w.part(e.part)?.colour ?? 'bare');
          if (e.part === E) SEEN.envShipped!++;
          if (e.part === P) SEEN.pressShipped!++;
        }
        if (e.type === 'returned' && e.how === 'door') {
          // (the colour it shipped in is the one it is back in: an undo restores the colour with the location, or neither)
          const i = record.lastIndexOf(w.part(e.part)?.colour ?? 'bare');
          if (i >= 0) record.splice(i, 1);
        }
        if (e.type === 'reset') record = [];
      }
      check(`step ${w.step}`);
      chk.step(ev, w.step);
    }
  };
  const carry = (id: string, to: Vec3, v: Vec3): void => {
    const m = w.motion(id);
    if (!m || m.mode === 'gone' || m.mode === 'chute') return;
    w.dispatch({ type: 'grab', id, grip: m.pose.p });
    run(2);
    if (w.holding()?.id !== id) return;
    for (let k = 1; k <= 12; k++) {
      w.dispatch({ type: 'carry', target: [m.pose.p[0] + ((to[0] - m.pose.p[0]) * k) / 12, Math.max(0.6, to[1]), m.pose.p[2] + ((to[2] - m.pose.p[2]) * k) / 12] });
      run(1);
    }
    w.dispatch({ type: 'release', velocity: v });
    run(1);
  };
  try {
    run(30);
    // the middle crate off the stack, onto the open bench, and opened: the press on its tray
    const c2 = w.motion(PRESS.crate)!;
    w.dispatch({ type: 'grab', id: PRESS.crate, grip: c2.pose.p });
    run(2);
    w.dispatch({ type: 'place', at: [-1.2, 0, 2.0] });
    run(90);
    w.dispatch({ type: 'press', id: `${PRESS.crate}-lid` });
    run(5);
    for (let a = 0; a < 30; a++) {
      const k = r.int(20);
      const busy = (w.machine(PRESS.unit) as PressView).show !== null;
      if (k < 6) {
        w.dispatch({ type: 'press', id: PRESS.lever });
        SEEN.pull!++;
        if (busy) SEEN.waited!++;
        log.push('pull');
      } else if (k < 9) {
        w.dispatch({ type: 'undo' });
        SEEN.undo!++;
        log.push('undo');
      } else if (k < 10) {
        carry(P, [r.range(-3, 3), 0.5, r.range(0.8, 3)], [0, 0, 0]);
        SEEN.grab!++;
        log.push('press set down');
      } else if (k < 11) {
        carry(P, [r.range(-4, 4), 1.5, r.range(-2, 3)], [r.range(-6, 6), r.range(0, 5), r.range(-6, 6)]);
        SEEN.throw!++;
        log.push('press thrown');
      } else if (k < 12) {
        carry(P, onBelt(r.range(0.2, 0.8)), [0, 0, 0]);
        SEEN.belt!++;
        log.push('press on the belt');
      } else if (k < 13) {
        carry(P, [9.5, 1.2, r.range(-3, 3)], [8, 2, 0]);
        SEEN.edge!++;
        log.push('press off the edge');
      } else if (k < 15) {
        const to: Vec3 = r.chance(0.5) ? onBelt(r.range(0.2, 0.8)) : [r.range(-4, 6), 1.2, r.range(-2, 3.5)];
        carry(E, to, r.chance(0.5) ? [0, 0, 0] : [r.range(-6, 6), r.range(0, 4), r.range(-6, 6)]);
        SEEN.envelope!++;
        log.push('envelope');
      } else if (k < 16) {
        w.dispatch({ type: 'press', id: `${PRESS.crate}-lid` });
        SEEN.lid!++;
        log.push('lid');
      } else if (k < 18) {
        w.dispatch({ type: 'turn', id: 'belt-lever', value: [0, 0.5, 1][r.int(3)]! });
        SEEN.beltLever!++;
        log.push('belt lever');
      } else if (k < 19) {
        if (r.chance(0.4)) {
          w.dispatch({ type: 'reset' });
          SEEN.reset!++;
          log.push('reset');
        }
      } else {
        log.push('wait');
      }
      run(r.chance(0.5) ? r.int(20) + 1 : r.int(300) + 30);
    }
    // left alone, the belt running: the envelope comes to rest in the press or on the bench; the press in its crate or on the bench
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    run(steps(30));
    const me = w.mode(E);
    const le = w.part(E)!.location;
    if (!(me === 'gone' && le.at === 'in' && le.mouth === P) && !(me === 'free' || me === 'machine')) throw new Error(`left alone, the envelope is ${me} (${JSON.stringify(le)})`);
    const mp = w.mode(P);
    const lp = w.part(P)!.location;
    if (!(mp === 'gone' && lp.at === 'in') && !(mp === 'free' || mp === 'machine')) throw new Error(`left alone, the press is ${mp} (${JSON.stringify(lp)})`);
    expect((w.machine(PRESS.unit) as PressView).show).toBeNull();
    // and "Reset the workshop" puts both where a fresh visit has them
    w.dispatch({ type: 'reset' });
    run(5);
    if (w.mode(E) !== 'gone' || w.part(E)!.location.at !== 'in') throw new Error('after reset the envelope is not in the press');
    if (w.mode(P) !== 'gone' || w.part(P)!.location.at !== 'in') throw new Error('after reset the press is not in its crate');
    w.dispose();
    return { ok: true, log };
  } catch (e) {
    w.dispose();
    return { ok: false, log, error: String(e) };
  }
}

test(`the report press soak: ${SESSIONS} sessions never lose the envelope and never print anything but the record`, async () => {
  const bad: string[] = [];
  for (let s = 0; s < SESSIONS; s++) {
    SEEN.sessions = (SEEN.sessions ?? 0) + 1;
    const o = await session(s);
    if (!o.ok) bad.push(`seed ${s}: ${o.error}\n  after: ${o.log.join(', ')}`);
  }
  process.stderr.write(`\npress soak: ${JSON.stringify(SEEN)}\n`);
  expect(bad).toEqual([]);
}, Math.max(300_000, SESSIONS * 30_000));
