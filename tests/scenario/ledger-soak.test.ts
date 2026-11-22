// P4 D1: a soak aimed at the ledger board, on the whole bench (the real crew, the line, Rapier). Each seeded session
// opens the ledger's crate and then does ordinary and stupid things in a random order: the crank, the plunger (often
// mid-show), the lever, the board picked up and set down, thrown, put on the belt to ship, off the bench's edge, its
// crate shut and opened, "Reset the workshop". At every step: the board's value is well formed (eight payments,
// one rubber: nothing is ever lost), the star the view publishes is the one the cups call for, and the durable state
// is what the history says (the replay check). At the end of a session left alone, the board is somewhere a
// visitor can find it: in its crate, or on the bench.
//
// In verify: LEDGER_SOAK sessions (default 6). Bigger: LEDGER_SOAK=200 npx vitest run tests/scenario/ledger-soak.test.ts
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, onBelt } from './line-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import { LEDGER } from '../../src/workshop/sim/scenes/bench.ts';
import { TOKENS_FIELD } from '../../src/workshop/sim/machines/ledger.ts';
import { balanced, validTokens } from '../../src/workshop/sim/machines/shared/ledger-board.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { LedgerView, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.LEDGER_SOAK ?? 6);
const PARTS = FULL_BENCH.parts.map((p) => p.id);
const JACKS = FULL_BENCH.cord.jacks.map((j) => j.id);
const SEEN: Record<string, number> = { deal: 0, repair: 0, refused: 0, waited: 0, undo: 0, grab: 0, throw: 0, belt: 0, shipped: 0, edge: 0, shut: 0, reset: 0 };

async function session(seed: number): Promise<{ ok: boolean; log: string[]; error?: string }> {
  const r = rng(`ledger-soak-${seed}`);
  const w: World = await benchWorld(`ledger-soak-${seed}`, { scene: FULL_BENCH });
  const log: string[] = [];
  const chk = checker(w, { jacks: JACKS, parts: PARTS });
  const B = LEDGER.board;
  const check = (where: string): void => {
    const t = w.setting(B, TOKENS_FIELD);
    if (!validTokens(t)) throw new Error(`${where}: the board's value is not well formed: ${JSON.stringify(t)}`);
    const v = w.machine(LEDGER.unit) as LedgerView;
    if (v.wrong !== !balanced(t)) throw new Error(`${where}: the star says ${v.wrong} for ${JSON.stringify(t)}`);
    if (v.show && JSON.stringify(v.show.after) !== JSON.stringify(t)) throw new Error(`${where}: the show ends somewhere other than the state`);
    if (!w.part(B)) throw new Error(`${where}: the board is gone`);
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      w.advance();
      const ev = w.drainEvents();
      for (const e of ev) {
        if (e.type === 'ledger.refused') SEEN.refused!++;
        if (e.type === 'shipped' && e.part === B) SEEN.shipped!++;
      }
      check(`step ${w.step}`);
      chk.step(ev, w.step);
    }
  };
  const carry = (to: Vec3, v: Vec3): void => {
    const m = w.motion(B);
    if (!m || m.mode === 'gone' || m.mode === 'chute') return;
    w.dispatch({ type: 'grab', id: B, grip: m.pose.p });
    run(2);
    if (w.holding()?.id !== B) return;
    for (let k = 1; k <= 12; k++) {
      w.dispatch({ type: 'carry', target: [m.pose.p[0] + ((to[0] - m.pose.p[0]) * k) / 12, Math.max(0.6, to[1]) , m.pose.p[2] + ((to[2] - m.pose.p[2]) * k) / 12] });
      run(1);
    }
    w.dispatch({ type: 'release', velocity: v });
    run(1);
  };
  try {
    run(30);
    // the large crate free, and opened: the board out, dealing itself
    const c2 = w.motion('crate-2')!;
    w.dispatch({ type: 'grab', id: 'crate-2', grip: c2.pose.p });
    run(2);
    w.dispatch({ type: 'place', at: [1.15, 0, 2.6] });
    run(90);
    w.dispatch({ type: 'press', id: `${LEDGER.crate}-lid` });
    run(5);
    for (let a = 0; a < 26; a++) {
      const k = r.int(14);
      const busy = (w.machine(LEDGER.unit) as LedgerView).show !== null;
      if (k < 3) {
        w.dispatch({ type: 'press', id: LEDGER.crank });
        SEEN.deal!++;
        if (busy) SEEN.waited!++;
        log.push('crank');
      } else if (k < 6) {
        w.dispatch({ type: 'press', id: LEDGER.plunger });
        SEEN.repair!++;
        if (busy) SEEN.waited!++;
        log.push('plunger');
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
        w.dispatch({ type: 'press', id: `${LEDGER.crate}-lid` });
        SEEN.shut!++;
        log.push('lid');
      } else {
        if (r.chance(0.3)) {
          w.dispatch({ type: 'reset' });
          SEEN.reset!++;
          log.push('reset');
        }
      }
      run(r.chance(0.5) ? r.int(20) + 1 : r.int(240) + 30);
    }
    // left alone: in time the board is in its crate or lying on the bench, and drawn as its state says
    run(steps(14));
    const m = w.mode(B);
    const l = w.part(B)!.location;
    if (!(m === 'gone' && l.at === 'in') && !(m === 'free' || m === 'machine')) throw new Error(`left alone, the board is ${m} (${JSON.stringify(l)})`);
    expect((w.machine(LEDGER.unit) as LedgerView).show).toBeNull();
    w.dispose();
    return { ok: true, log };
  } catch (e) {
    w.dispose();
    return { ok: false, log, error: String(e) };
  }
}

test(`the ledger board soak: ${SESSIONS} sessions lose no token and never leave the star wrong for the cups`, async () => {
  const bad: string[] = [];
  for (let s = 0; s < SESSIONS; s++) {
    SEEN.sessions = (SEEN.sessions ?? 0) + 1;
    const o = await session(s);
    if (!o.ok) bad.push(`seed ${s}: ${o.error}\n  after: ${o.log.join(', ')}`);
  }
  process.stderr.write(`\nledger soak: ${JSON.stringify(SEEN)}\n`);
  expect(bad).toEqual([]);
}, Math.max(300_000, SESSIONS * 20_000));
