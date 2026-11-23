// P4 T2: a soak aimed at the tool wall, on the whole bench (the real crew, the line running, Rapier). Each seeded session
// does ordinary and stupid things with the tools in a random order: one taken off its peg and set down on the bench,
// thrown at the wall (gently, hard, at its own place and at another's), hung back by the hand and by tap-then-tap (at
// its own place and at another's), put on the belt to be struck and shipped, off the bench's edge, the lever pulled,
// "Reset the workshop". At every step: every tool is somewhere (a part of the world, never lost), a tool the wall holds
// is on its own peg (never on another's place), and the durable state is what the history says (the replay check).
// After a reset all eight hang, bare; left alone at the end, every tool is on its peg or lying where a visitor finds it.
//
// In verify: TOOL_SOAK sessions (default 4). Bigger: TOOL_SOAK=100 npx vitest run tests/scenario/toolwall-soak.test.ts
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, onBelt } from './line-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import { TOOLWALL } from '../../src/workshop/sim/scenes/bench.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { ToolwallView, Vec3 } from '../../src/workshop/sim/types.ts';
import { TOOLS, allHung, hangAt, onPeg, pegOf } from './toolwall-helpers.ts';

const SESSIONS = Number(process.env.TOOL_SOAK ?? 4);
const PARTS = FULL_BENCH.parts.map((p) => p.id);
const JACKS = FULL_BENCH.cord.jacks.map((j) => j.id);
const SEEN: Record<string, number> = { setDown: 0, hungByHand: 0, placed: 0, placedWrong: 0, thrownSoft: 0, thrownHard: 0, thrownWrong: 0, belt: 0, shipped: 0, returned: 0, edge: 0, undo: 0, reset: 0, hung: 0, missed: 0, toppled: 0 };

async function session(seed: number): Promise<{ ok: boolean; log: string[]; error?: string }> {
  const r = rng(`tool-soak-${seed}`);
  const w: World = await benchWorld(`tool-soak-${seed}`, { scene: FULL_BENCH });
  const log: string[] = [];
  const chk = checker(w, { jacks: JACKS, parts: PARTS });
  const check = (where: string): void => {
    const v = w.machine(TOOLWALL.unit) as ToolwallView;
    for (const id of TOOLS) {
      const m = w.motion(id);
      if (!m || !w.part(id)) throw new Error(`${where}: ${id} is gone`);
      const hung = v.tools.find((t) => t.id === id)!.hung;
      if (hung) {
        if (m.mode !== 'machine') throw new Error(`${where}: ${id} is said to hang but is ${m.mode}`);
        // on its own peg (or gliding onto it): never at another's place
        for (const o of TOOLS) {
          if (o === id) continue;
          const h = hangAt(o);
          if (Math.hypot(m.pose.p[0] - h[0], m.pose.p[1] - h[1]) < 0.05) throw new Error(`${where}: ${id} hangs on ${o}'s place`);
        }
      }
    }
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      w.advance();
      const ev = w.drainEvents();
      for (const e of ev) {
        if (process.env.TOOL_SOAK_TRACE && JSON.stringify(e).includes(process.env.TOOL_SOAK_TRACE)) log.push(`@${w.step} ${JSON.stringify(e).slice(0, 160)}`);
        if (e.type === 'shipped' && TOOLS.includes(e.part)) SEEN.shipped!++;
        if (e.type === 'returned' && TOOLS.includes(e.part)) SEEN.returned!++;
        if (e.type === 'toolwall.hung') SEEN.hung!++;
        if (e.type === 'toolwall.missed') SEEN.missed!++;
        if (e.type === 'part.hit' && e.strength === 0.25 && TOOLS.includes(e.id)) SEEN.toppled!++;
      }
      check(`step ${w.step}`);
      chk.step(ev, w.step);
    }
  };
  const take = (id: string): boolean => {
    const m = w.motion(id);
    if (!m || m.mode === 'gone' || m.mode === 'chute' || m.mode === 'crew' || w.holding()) return false;
    w.dispatch({ type: 'grab', id, grip: m.pose.p });
    run(2);
    return w.holding()?.id === id;
  };
  const carry = (id: string, to: Vec3, n = 16): void => {
    const p0 = w.motion(id)!.pose.p;
    for (let k = 1; k <= n; k++) {
      w.dispatch({ type: 'carry', target: [p0[0] + ((to[0] - p0[0]) * k) / n, p0[1] + ((to[1] - p0[1]) * k) / n, p0[2] + ((to[2] - p0[2]) * k) / n] });
      run(1);
    }
    run(8);
  };
  const letGo = (v: Vec3): void => {
    w.dispatch({ type: 'release', velocity: v });
    run(1);
  };
  try {
    run(30);
    for (let a = 0; a < 30; a++) {
      const id = TOOLS[r.int(TOOLS.length - 1)]!;
      const other = TOOLS[r.int(TOOLS.length - 1)]!;
      const k = r.int(13);
      const h = hangAt(id);
      if (k < 2) {
        if (!take(id)) continue;
        carry(id, [r.range(-6, 6), 1.2, r.range(-2, 3.5)]);
        letGo([0, 0, 0]);
        SEEN.setDown!++;
        log.push(`${id} set down`);
      } else if (k < 4) {
        if (!take(id)) continue;
        carry(id, [h[0] + r.range(-0.2, 0.2), h[1] + r.range(-0.2, 0.2), h[2] + 0.3], 24);
        letGo([0, 0, 0]);
        SEEN.hungByHand!++;
        log.push(`${id} hung by hand`);
      } else if (k < 5) {
        if (!take(id)) continue;
        const wrong = r.chance(0.4) && other !== id;
        w.dispatch({ type: 'place', at: pegOf(wrong ? other : id) });
        run(1);
        if (wrong) SEEN.placedWrong!++;
        else SEEN.placed!++;
        log.push(`${id} placed at ${wrong ? other : id}`);
      } else if (k < 7) {
        if (!take(id)) continue;
        const wrong = r.chance(0.3) && other !== id;
        const at = wrong ? hangAt(other) : h;
        const hard = r.chance(0.4);
        carry(id, [at[0], at[1] - 0.1, at[2] + (hard ? 2.2 : 0.8)], 24);
        letGo(hard ? [r.range(-1, 1), r.range(0, 2), -r.range(8, 14)] : [0, 1.2, -2.8]);
        if (wrong) SEEN.thrownWrong!++;
        else if (hard) SEEN.thrownHard!++;
        else SEEN.thrownSoft!++;
        log.push(`${id} thrown ${hard ? 'hard' : 'gently'} at ${wrong ? other : 'its place'}`);
      } else if (k < 9) {
        if (!take(id)) continue;
        carry(id, [onBelt(r.range(0.2, 0.7))[0], 1.4, onBelt(0.5)[2]]);
        letGo([0, 0, 0]);
        SEEN.belt!++;
        log.push(`${id} on the belt`);
      } else if (k < 10) {
        if (!take(id)) continue;
        carry(id, [8.6, 1.4, r.range(-3, 3)]);
        letGo([9, 2, 0]);
        SEEN.edge!++;
        log.push(`${id} off the edge`);
      } else if (k < 12) {
        w.dispatch({ type: 'undo' });
        SEEN.undo!++;
        log.push('undo');
      } else if (r.chance(0.5)) {
        if (w.holding()) letGo([0, 0, 0]);
        w.dispatch({ type: 'reset' });
        SEEN.reset!++;
        run(2);
        log.push('reset');
        if (!allHung(w)) throw new Error(`after a reset not every tool hangs: ${TOOLS.filter((t) => !onPeg(w, t)).join(', ')}`);
        for (const t of TOOLS) if (w.part(t)!.colour !== 'bare') throw new Error(`after a reset ${t} is ${w.part(t)!.colour}`);
      }
      run(r.chance(0.5) ? r.int(30) + 1 : r.int(300) + 30);
    }
    if (w.holding()) letGo([0, 0, 0]);
    // left alone: every tool comes to hang, or to lie where a visitor finds it (on the bench, in a machine's mouth), within
    // half a minute: one on its way back (shipped and due back, in the chute, in the crew's hands) is not lost
    const out = (t: string): boolean => ['gone', 'chute', 'held'].includes(w.motion(t)!.mode);
    for (let i = 0; i < steps(30) && TOOLS.some(out); i++) run(1);
    for (const t of TOOLS) if (out(t)) throw new Error(`left alone, ${t} is ${w.motion(t)!.mode} (${JSON.stringify(w.part(t)!.location)})`);
    // and "Reset the workshop" hangs all eight
    w.dispatch({ type: 'reset' });
    run(3);
    if (!allHung(w)) throw new Error(`the last reset: not every tool hangs: ${TOOLS.filter((t) => !onPeg(w, t)).join(', ')}`);
    w.dispose();
    return { ok: true, log };
  } catch (e) {
    w.dispose();
    return { ok: false, log, error: String(e) };
  }
}

test(`the tool wall soak: ${SESSIONS} sessions lose no tool, hang none on another's place, and a reset hangs all eight`, async () => {
  const bad: string[] = [];
  for (let s = 0; s < SESSIONS; s++) {
    SEEN.sessions = (SEEN.sessions ?? 0) + 1;
    const o = await session(s);
    if (!o.ok) bad.push(`seed ${s}: ${o.error}\n  after: ${o.log.join(', ')}`);
  }
  process.stderr.write(`\ntool wall soak: ${JSON.stringify(SEEN)}\n`);
  expect(bad).toEqual([]);
}, Math.max(300_000, SESSIONS * 30_000));
