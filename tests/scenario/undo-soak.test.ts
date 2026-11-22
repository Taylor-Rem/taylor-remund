// R2 (Taylor's coworkers, 2026-11-19: "if you press the undo button too many times it breaks something because
// the simulation freezes"): a soak aimed at undo, on the whole bench (the real crew, the real line, the
// Patchlamp station) under real Rapier. Each seeded session is a visitor doing ordinary and stupid things —
// lifting, throwing and shipping every part and both robots, off every edge, Patch off its stool, the Button
// mid-everything, texts, the cord, the belt's handles, undo in the middle — and then the UNDO lever pulled
// until the stack is empty and ten times more. Nothing may throw, and at every step the durable state equals
// what the history says it should (the replay check, tests/scenario/standins/replay.ts).
//
// In verify: UNDO_SOAK sessions (default 12). The big one: UNDO_SOAK=3000 npx vitest run tests/scenario/undo-soak.test.ts
// (its time limit grows with the count: a second a session; 3000 did not fit the fixed ten minutes on 2026-11-21)
// One seed alone, with the shortest failing prefix: UNDO_SEED=<n> npx vitest run tests/scenario/undo-soak.test.ts
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, LINE, onBelt } from './line-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import type { Rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.UNDO_SOAK ?? 12);
const ONLY = process.env.UNDO_SEED !== undefined ? Number(process.env.UNDO_SEED) : null;
const PARTS = FULL_BENCH.parts.map((p) => p.id);
const JACKS = FULL_BENCH.cord.jacks.map((j) => j.id);
const LOOSE = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'revert'] as const;
/** What the sessions did, over the whole run (so the soak shows it exercised what it claims). */
const SEEN: Record<string, number> = { opened: 0, shutPressed: 0, clapped: 0, plates: 0, openUndone: 0, selected: 0, looks: 0, sessions: 0, shippedFetch: 0, shippedRevert: 0, shipped: 0, undone: 0, refused: 0, kept: 0, rungs: 0, returned: 0, patchHeld: 0, offEdge: 0 };
/** P4 S5: the project crates: a latch or a plate pressed, at random (whatever state the crate is in). */
const CRATES = FULL_BENCH.projects ?? [];
const TEXTS = ['make the sign red', 'paint it blue', "we're closed", 'we are open', 'undo that', 'hello', 'who are you', 'turn the lamp up'];

interface Outcome {
  readonly ok: boolean;
  readonly error?: string;
  readonly at?: string;
  readonly log: string[];
}

/** Where a carried thing is let go: on the belt, the dock's ramp, off an edge, anywhere on the bench, high up. */
function target(r: Rng): { to: Vec3; v: Vec3; what: string } {
  const k = r.int(10);
  if (k < 3) return { to: onBelt(r.range(0.1, 0.95), r.range(-0.2, 0.2)), v: [0, 0, 0], what: 'belt' };
  if (k < 4) return { to: [LINE.ramp.start[0] + 0.3, 0.7, LINE.ramp.start[2]], v: [1, 0, 0], what: 'ramp' };
  if (k < 6) {
    const side = r.int(4);
    const to: Vec3 = side === 0 ? [-10, 1.5, r.range(-4, 4)] : side === 1 ? [10, 1.5, r.range(-4, 4)] : side === 2 ? [r.range(-8, 8), 1.5, 6.5] : [r.range(-8, 8), 2, -6];
    return { to, v: [to[0] * 0.6, 3, to[2] * 0.6], what: 'off the edge' };
  }
  if (k < 8) return { to: [r.range(-8, 8), r.range(0.5, 2.5), r.range(-4, 4.5)], v: [r.range(-9, 9), r.range(-2, 5), r.range(-9, 9)], what: 'thrown' };
  return { to: [r.range(-8, 8), r.range(0.5, 1.5), r.range(-4, 4.5)], v: [0, 0, 0], what: 'set down' };
}

async function session(seed: number, maxActions: number): Promise<Outcome & { actions: number }> {
  const r = rng(`undo-soak-${seed}`);
  const w = await benchWorld(`undo-soak-${seed}`, { scene: FULL_BENCH });
  const log: string[] = [];
  let actions = 0;
  let pending: SimEvent[] = [];
  const chk = checker(w, { jacks: JACKS, parts: PARTS });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      w.advance();
      const ev = w.drainEvents();
      pending = ev;
      chk.step(ev, w.step);
      // (P4 S5) nothing spills: an open crate is always lying free or in the hand, never in a machine, the crew's hands, the chute or shipped
      for (const c of CRATES) if (w.setting(c.crate, 'open') === true) {
        const mode = w.mode(c.crate);
        if (mode !== 'free' && mode !== 'held') throw new Error(`${c.crate} open while ${mode}`);
      }
      for (const e of ev) {
        if (e.type === 'shipped') {
          SEEN.shipped!++;
          if (e.part === 'fetch') SEEN.shippedFetch!++;
          if (e.part === 'revert') SEEN.shippedRevert!++;
        }
        if (e.type === 'undone') {
          SEEN.undone!++;
          if (e.kept.length) SEEN.kept!++;
        }
        if (e.type === 'undo.refused') SEEN.refused!++;
        if (e.type === 'crate.opened') SEEN.opened!++;
        if (e.type === 'crate.shut') SEEN[e.why === 'press' ? 'shutPressed' : 'clapped']!++;
        if (e.type === 'crate.plate') SEEN.plates!++;
        if (e.type === 'undone' && e.restores.some((x) => x.field === 'open')) SEEN.openUndone!++;
        if (e.type === 'look') SEEN.looks!++;
        if (e.type === 'rung.started') SEEN.rungs!++;
        if (e.type === 'returned' || e.type === 'part.returned') SEEN.returned!++;
      }
    }
  };
  const carry = (id: Id, grabType: 'grab' | 'drag'): void => {
    const m = w.motion(id)?.pose.p ?? (id === 'patch' ? (w.machine('patch') as { at: Vec3 }).at : [0, 1, 0]);
    const t = target(r);
    if (t.what === 'off the edge') SEEN.offEdge!++;
    if (id === 'patch') SEEN.patchHeld!++;
    log.push(`${w.step}: ${grabType === 'grab' ? 'lift' : 'drag'} ${id}, ${t.what} at ${t.to.map((v) => v.toFixed(1)).join(',')}`);
    if (grabType === 'grab') w.dispatch({ type: 'grab', id, grip: m });
    const n = 8 + r.int(30);
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const p: Vec3 = [m[0] + (t.to[0] - m[0]) * f, Math.max(m[1], t.to[1]) + 1.2 * Math.sin(Math.PI * f), m[2] + (t.to[2] - m[2]) * f];
      if (grabType === 'grab') w.dispatch({ type: 'carry', target: p });
      else w.dispatch({ type: 'drag', id, target: p });
      // the Button, mid-carry, now and then
      if (r.chance(0.02)) {
        log.push(`${w.step}: press the Button mid-carry`);
        w.dispatch({ type: 'press', id: 'button' });
      }
      run(1);
    }
    if (grabType === 'grab') w.dispatch({ type: 'release', velocity: t.v });
    else w.dispatch({ type: 'drag', id, target: t.to, end: true });
    run(1);
  };
  SEEN.sessions!++;
  try {
    run(steps(2));
    while (actions < maxActions) {
      const k = r.int(100);
      if (k < 12) {
        // the coworkers' path: a robot (or a crate) set on a running belt, to ride through the dock's door
        const id = r.pick(['fetch', 'fetch', 'revert', 'crate-1', 'crate-3']);
        if (['free', 'crew', 'machine'].includes(w.mode(id) ?? '')) {
          w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
          const m = w.motion(id)!.pose.p;
          const to = onBelt(r.range(0.5, 0.9));
          log.push(`${w.step}: ship ${id} (set on the running belt)`);
          w.dispatch({ type: 'grab', id, grip: m });
          for (let i = 1; i <= 20; i++) {
            w.dispatch({ type: 'carry', target: [m[0] + (to[0] - m[0]) * (i / 20), to[1] + 1.2 * Math.sin((Math.PI * i) / 20) + 0.4, m[2] + (to[2] - m[2]) * (i / 20)] });
            run(1);
          }
          w.dispatch({ type: 'release', velocity: [0, 0, 0] });
          run(1);
        }
      } else if (k < 40) {
        const avail = LOOSE.filter((id) => ['free', 'crew', 'machine'].includes(w.mode(id) ?? ''));
        if (avail.length) carry(r.pick(avail), 'grab');
      } else if (k < 46) carry('patch', r.chance(0.5) ? 'grab' : 'drag');
      else if (k < 56) {
        log.push(`${w.step}: press the Button`);
        w.dispatch({ type: 'press', id: 'button' });
        run(1 + r.int(steps(3)));
      } else if (k < 64) {
        log.push(`${w.step}: pull the UNDO lever`);
        w.dispatch({ type: r.chance(0.5) ? 'undo' : 'press', id: 'undo-lever' } as never);
        run(1 + r.int(40));
      } else if (k < 70) {
        const t = r.pick(TEXTS);
        log.push(`${w.step}: text "${t}"`);
        w.dispatch({ type: 'text', text: t });
      } else if (k < 76) {
        const jack = r.pick([...JACKS, null]);
        log.push(`${w.step}: cord to ${jack}`);
        w.dispatch({ type: 'unplug', cord: 'cord' });
        run(1 + r.int(30));
        w.dispatch({ type: 'plug', cord: 'cord', jack });
      } else if (k < 84) {
        const id = r.pick(['belt-dial', 'belt-lever']);
        const v = id === 'belt-lever' && r.chance(0.6) ? 1 : r.next();
        log.push(`${w.step}: turn ${id} to ${v.toFixed(2)}`);
        w.dispatch({ type: 'turn', id, value: v });
      } else if (k < 88) {
        log.push(`${w.step}: press the shut cover / lamp`);
        w.dispatch({ type: 'press', id: r.pick(['button-cover', 'lamp', 'belt-dial']) });
      } else if (k < 97 && CRATES.length) {
        // P4 S5: a project crate's latch (open or shut), now and then its plate, sometimes twice in a row
        const open = CRATES.filter((x) => w.setting(x.crate, 'open') === true);
        const c = open.length > 0 && r.chance(0.5) ? r.pick(open) : r.pick(CRATES);
        const m = w.motion(c.crate);
        if (r.chance(0.25) && !w.holding() && m?.mode === 'free') {
          // (round three) a double-tap: the first tap takes it up and the lift carries it a little; the second asks for
          // it (select: back where it lay, and open)
          log.push(`${w.step}: double-tap ${c.crate}`);
          w.dispatch({ type: 'grab', id: c.crate, grip: m.pose.p });
          run(1 + r.int(12));
          w.dispatch({ type: 'carry', target: [m.pose.p[0], m.pose.p[1] + 0.3, m.pose.p[2] + 0.4 * r.next()] });
          run(1 + r.int(6));
          w.dispatch({ type: 'select', id: c.crate });
          SEEN.selected!++;
        } else {
          const id = r.chance(0.3) ? c.plate : c.lid;
          log.push(`${w.step}: press ${id}`);
          w.dispatch({ type: 'press', id });
          if (r.chance(0.2)) {
            run(1 + r.int(20));
            w.dispatch({ type: 'press', id: c.lid });
          }
        }
      }
      actions++;
      run(r.int(steps(r.chance(0.2) ? 12 : 2.5)) + 1);
    }
    if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(steps(1));
    // the coworkers: pull the lever until there is nothing left, and ten times more
    let extra = 0;
    for (let pulls = 0; pulls < 400 && extra < 10; pulls++) {
      if (w.undoStack().length === 0 && !w.bracketed) extra++;
      w.dispatch({ type: 'press', id: 'undo-lever' });
      run(1 + r.int(25));
    }
    run(steps(15));
    log.push(`${w.step}: done (stack ${w.undoStack().length})`);
    return { ok: true, log, actions };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: `${err.message}`, at: (err.stack ?? '').split('\n').slice(1, 4).join(' | '), log, actions };
  } finally {
    w.dispose();
  }
}

test(`undo soak: ${ONLY ?? SESSIONS} seeded session(s) of a visitor and then the lever pulled dry, on the whole bench`, { timeout: Math.max(600_000, SESSIONS * 1_000) }, async () => {
  const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SESSIONS }, (_, i) => i);
  const failures = new Map<string, { seed: number; shortest: number; log: string[]; at: string }>();
  for (const seed of seeds) {
    const actions = 6 + (seed % 25);
    const o = await session(seed, actions);
    if (o.ok) continue;
    const key = (o.error ?? '').replace(/\d+(\.\d+)?/g, '#');
    const prev = failures.get(key);
    if (prev && prev.shortest <= o.actions) continue;
    // the shortest prefix of this session that still fails
    let lo = 0;
    let hi = o.actions;
    let best = o;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = await session(seed, mid);
      if (!m.ok && (m.error ?? '').replace(/\d+(\.\d+)?/g, '#') === key) {
        hi = mid;
        best = m;
      } else lo = mid + 1;
    }
    failures.set(key, { seed, shortest: hi, log: best.log, at: best.at ?? '' });
  }
  const report = [...failures.entries()].map(([k, f]) => `\n✗ ${k}\n  seed ${f.seed}, shortest session ${f.shortest} actions; ${f.at}\n  ${f.log.slice(-12).join('\n  ')}`);
  process.stderr.write(`\nundo soak covered: ${JSON.stringify(SEEN)}\n`);
  if (report.length) process.stderr.write(`\nundo soak: ${failures.size} distinct failure(s)${report.join('')}\n`);
  expect([...failures.keys()]).toEqual([]);
});
