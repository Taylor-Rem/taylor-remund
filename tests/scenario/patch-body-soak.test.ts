// Recovery must remain dependable (Taylor, 2026-11-20: "I don't want a physics simulation that occasionally leaves
// Patch trapped behind a machine or unable to return to his stool"). The proof for the Patch with a real body
// (`benchBody`; sim/crew/patch-body.ts): seeded throws over the whole bench under real Rapier, the real crew at work.
//
// Each session waits a while (so the crew are somewhere else each time), lifts Patch, carries it to a point anywhere
// over the bench (bench height mostly, one in four high), and throws it: any direction, any speed to past the cap,
// level, lobbed, straight up, down, or let go still; sometimes at the back wall, at an edge, at Fetch, Revert or a
// crate; from inside a machine's footprint when the point is one. Then, some of the time: it is taken hold of again
// (in the air, tumbling, getting up, walking: whenever) and thrown again, up to three times; the Button is pressed
// while it is loose (the rung rewinds it); the lever is pulled; the workshop is reset.
//
// Every session must end with Patch seated on its stool within LIMIT seconds of the last time it was let go (the
// rung's own time, if one played, on top), its body out of the world, nothing in the hand. From the moment the
// script takes over (every state but `held`, `fly` and `away`) no step may have Patch below the bench top, inside a
// fixed body, or anywhere that is not a number. Nothing durable is changed by Patch: its body's own fields never
// change, and the only things a throw's transaction ever writes are the places of parts it knocked.
//
// It prints how long recovery took (median, 95th, slowest) and the slowest ten with where they lay.
//
// In verify: PATCH_SOAK sessions (default 24). The big one:
//   PATCH_SOAK=2400 npx vitest run tests/scenario/patch-body-soak.test.ts --silent=false
// One seed: PATCH_SEED=<n> (with PATCH_TRACE=1 for its states).
import { expect, test } from 'vitest';
import { BODY, benchBody, fmt, insideSolid, patch } from './patch-body-helpers.ts';
import { benchWorld, tape } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PatchState, Vec3 } from '../../src/workshop/sim/types.ts';

const SESSIONS = Number(process.env.PATCH_SOAK ?? 24);
const ONLY = process.env.PATCH_SEED !== undefined ? Number(process.env.PATCH_SEED) : null;
const TRACE = !!process.env.PATCH_TRACE;
/** Seconds from the last release to seated on the stool. */
const LIMIT = 45;
/** On its stool: sitting, or at its work there (a text that came meanwhile, or the job it was lifted from). */
const ON_STOOL: ReadonlySet<PatchState> = new Set<PatchState>(['seated', 'notice', 'roll', 'plug', 'drawer', 'work', 'check', 'reply', 'stare', 'duck', 'catch', 'bonk']);
const home = (w: World): boolean => ON_STOOL.has(patch(w).state) || (patch(w).state === 'look' && patch(w).walk === null && patch(w).at[1] > 0.3);

interface Outcome {
  seed: number;
  what: string;
  fails: string[];
  /** Seconds from the last release to seated (rung time taken out), or null if it never was thrown. */
  seconds: number | null;
  /** Where it lay when the script took over (the last time), and how. */
  lay: string;
  throws: number;
  rung: boolean;
}

async function session(seed: number): Promise<Outcome> {
  const r = rng(`patch-body-soak-${seed}`);
  const w = await benchWorld(`patch-body-soak-${seed}`, { scene: benchBody });
  const t = tape(w);
  const out: Outcome = { seed, what: '', fails: [], seconds: null, lay: '-', throws: 0, rung: false };
  const fail = (m: string): void => {
    if (out.fails.length < 6) out.fails.push(m);
  };
  let lay = '-';
  let lastState: PatchState | '' = '';
  const trace: string[] = [];
  const body0 = w.durable().filter((d) => d.target === BODY);
  /** One step, with the checks that hold in every step. */
  const step = (): void => {
    t.run(1);
    const v = patch(w);
    if (!v.at.every(Number.isFinite) || !Number.isFinite(v.heading)) fail(`not a number in ${v.state}`);
    if (v.body && ![...v.body.pose.p, ...v.body.pose.q].every(Number.isFinite)) fail(`its body is not a number in ${v.state}`);
    if (v.lay) lay = `(${fmt(v.lay.pose.p)}) ${v.lay.to[0] === v.lay.from[0] && v.lay.to[2] === v.lay.from[2] ? 'got up there' : `hopped ${Math.hypot(v.lay.to[0] - v.lay.from[0], v.lay.to[2] - v.lay.from[2]).toFixed(2)} to (${fmt(v.lay.to)})`}`;
    if (TRACE && v.state !== lastState) trace.push(`${(w.step / HZ).toFixed(2)} ${v.state} at (${fmt(v.at)})${v.lay ? ` lay ${lay}` : ''}`);
    if (process.env.PATCH_TRACE === '2' && v.state === 'walk' && w.step % 30 === 0)
      trace.push(`${(w.step / HZ).toFixed(2)}   walking at (${fmt(v.at)}) ${v.walk?.waiting ? 'WAITING' : ''} next ${v.walk?.next ? fmt(v.walk.next) : '-'} | fetch ${w.crew('fetch')?.state} (${fmt(w.motion('fetch')!.pose.p)}) | revert ${w.motion('revert')?.mode} (${fmt(w.motion('revert')!.pose.p)}) | ${[...w.parts()].filter((p) => p.kind === 'crate' && w.motion(p.id)?.mode === 'free').map((p) => `${p.id} (${fmt(w.motion(p.id)!.pose.p, 1)})`).join(' ')}`);
    lastState = v.state;
    // once the script has it: never under the bench top, never inside a fixed body (but, as the scripted Patch
    // always has, its own stool as it climbs onto it, `at` going straight from the stool's foot to its seat, and the
    // belt's rail as it climbs over it)
    if (v.state !== 'held' && v.state !== 'fly' && v.state !== 'away') {
      if (v.at[1] < -1e-6) fail(`below the bench top in ${v.state} at (${fmt(v.at)})`);
      const inside = insideSolid(v.at);
      if (inside && !(inside === 'stool' && v.state === 'climb') && !(inside === 'belt-bed' && v.state === 'cross')) fail(`inside ${inside} in ${v.state} at (${fmt(v.at)})`);
    }
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) step();
  };
  try {
    // the crew somewhere else each time
    run(steps(r.range(0.5, 8)));
    // ── the plan ──
    const from: [number, number, number] = [r.range(-8.6, 8.6), r.int(4) === 0 ? r.range(2.4, 7.5) : r.range(0.9, 2.4), r.range(-4.5, 4.6)];
    const toward = (p: Vec3 | undefined): Vec3 => (p ? [p[0] - from[0], 0, p[2] - from[2]] : [1, 0, 0]);
    const k = r.int(12);
    let dir: Vec3;
    let aim: string;
    if (k < 2) {
      dir = [r.range(-0.3, 0.3), 0, -1];
      if (r.int(2) === 0) from[2] = r.range(-4.6, -3);
      aim = 'at the back wall';
    } else if (k < 5) {
      const side = r.int(3);
      dir = side === 0 ? [-1, 0, r.range(-0.4, 0.4)] : side === 1 ? [1, 0, r.range(-0.4, 0.4)] : [r.range(-0.4, 0.4), 0, 1];
      if (r.int(2) === 0) {
        // from near that edge
        if (side === 0) from[0] = r.range(-8.9, -7);
        else if (side === 1) from[0] = r.range(7, 8.9);
        else from[2] = r.range(3, 4.9);
      }
      aim = 'toward an edge';
    } else if (k < 8) {
      const what = ['fetch', 'revert', 'crate-1', 'crate-3', 'crate-4'][r.int(5)] as string;
      dir = toward(w.motion(what)?.pose.p);
      aim = `at ${what}`;
    } else {
      const a = r.range(0, Math.PI * 2);
      dir = [Math.cos(a), 0, Math.sin(a)];
      aim = 'anywhere';
    }
    const L = Math.hypot(dir[0], dir[2]) || 1;
    const speed = r.range(0, LOOSE_TUNING.throwMax * 1.15);
    const u = r.int(10);
    const up = u < 2 ? r.range(-3, 4) : u < 4 ? r.range(6, 16) : Math.min(1.6, 0.18 * speed);
    const drop = u === 9;
    const v: Vec3 = drop ? [0, 0, 0] : [(dir[0] / L) * speed, up, (dir[2] / L) * speed];
    const again = r.int(5) === 0 ? 1 + r.int(3) : 0;
    const rung = r.int(6) === 0;
    const lever = r.int(10) === 0;
    const reset = r.int(14) === 0;
    // (half the throws are the page's own: the hand moves and lets go, stating nothing)
    const stated = r.int(2) === 0;
    out.rung = rung;
    out.what = `from (${fmt(from, 1)}) ${drop ? 'dropped' : `${aim} at ${speed.toFixed(1)}, ${up.toFixed(1)} up`}${stated ? '' : ' (by hand)'}${again ? `, taken again ${again}` : ''}${rung ? ', Button' : ''}${lever ? ', lever' : ''}${reset ? ', reset' : ''}`;

    // ── the throw ──
    const throwIt = (to: Vec3, vel: Vec3, quick: boolean): boolean => {
      const a = patch(w).at;
      w.dispatch({ type: 'grab', id: 'patch', grip: a });
      step();
      if (w.holding()?.id !== 'patch') return false; // (out of sight, or a rung plays: nothing to take hold of)
      const p = patch(w).at;
      const n = quick ? 8 + r.int(20) : Math.max(30, Math.round((Math.hypot(to[0] - p[0], to[2] - p[2]) / 9) * HZ));
      for (let i = 1; i <= n; i++) {
        const e = i / n;
        w.dispatch({ type: 'carry', target: [p[0] + (to[0] - p[0]) * e, p[1] + (to[1] - p[1]) * e + (quick ? 0 : 1.4 * Math.sin(Math.PI * e)), p[2] + (to[2] - p[2]) * e] });
        step();
      }
      if (stated) w.dispatch({ type: 'release', velocity: vel });
      else {
        let hand = to;
        for (let i = 0; i < 8; i++) {
          hand = [hand[0] + vel[0] / HZ, hand[1] + vel[1] / HZ, hand[2] + vel[2] / HZ];
          w.dispatch({ type: 'carry', target: hand });
          step();
        }
        w.dispatch({ type: 'release' });
      }
      step();
      out.throws += 1;
      return true;
    };
    if (!throwIt(from, v, false)) {
      out.fails.push('seated Patch could not be taken hold of');
      return out;
    }
    let released = w.step;
    let rungSteps = 0;
    // taken hold of again, whenever, and thrown again from thereabouts
    for (let j = 0; j < again; j++) {
      run(steps(r.range(0.1, 4)));
      const a = patch(w).at;
      const to: Vec3 = [Math.max(-8.8, Math.min(8.8, a[0] + r.range(-2, 2))), r.range(0.9, 4), Math.max(-4.6, Math.min(4.7, a[2] + r.range(-2, 2)))];
      const ang = r.range(0, Math.PI * 2);
      const sp = r.range(0, 14);
      if (throwIt(to, [Math.cos(ang) * sp, r.int(3) === 0 ? r.range(4, 13) : r.range(-1, 2), Math.sin(ang) * sp], true)) released = w.step;
    }
    if (rung) {
      run(r.int(40));
      // (where its body is as the Button is pressed: the rung's snapshot is of this)
      const loose = patch(w).state === 'fly';
      const at = w.motion(BODY)?.pose.p;
      w.dispatch({ type: 'press', id: 'button' });
      step();
      while (w.bracketed && rungSteps < 40 * HZ) {
        step();
        rungSteps += 1;
      }
      if (w.bracketed) fail('the rung did not end');
      // rewound: loose at the press, it is back in the air where it was
      const now = w.motion(BODY);
      if (loose && rungSteps > 0 && at && now?.mode === 'free' && Math.hypot(now.pose.p[0] - at[0], now.pose.p[1] - at[1], now.pose.p[2] - at[2]) > 0.05) fail(`after the rung its body is not where it was at the press`);
    }
    if (lever) {
      run(r.int(60));
      w.dispatch({ type: 'undo' });
      step();
    }
    if (reset) {
      run(r.int(90));
      w.dispatch({ type: 'reset' });
      step();
      if (patch(w).state !== 'seated') fail(`after a reset it is ${patch(w).state}`);
    }
    // ── home ──
    const deadline = released + rungSteps + LIMIT * HZ;
    while (w.step < deadline && !home(w)) step();
    const v2 = patch(w);
    if (!home(w)) fail(`not back on its stool ${LIMIT} s after it was let go: ${v2.state} at (${fmt(v2.at)}), lay ${lay}`);
    else out.seconds = (w.step - released - rungSteps) / HZ;
    out.lay = lay;
    run(steps(1));
    if (!home(w) && ON_STOOL.has(v2.state)) fail(`it left its stool again (${patch(w).state})`);
    if (w.motion(BODY)?.mode !== 'gone') fail(`its body is still in the world (${w.motion(BODY)?.mode})`);
    if (w.holding()) fail(`still in the hand`);
    // nothing durable is Patch's doing but the places of parts a throw knocked
    if (JSON.stringify(w.durable().filter((d) => d.target === BODY)) !== JSON.stringify(body0)) fail(`its body's durable fields changed`);
    for (const d of w.durable()) if (/^t\d+$/.test(String(d.writer)) && !(d.field === 'location' && w.part(d.target))) fail(`a throw wrote ${d.target}.${d.field}`);
    if (w.undoStack().length > out.throws) fail(`${w.undoStack().length} transactions on the stack after ${out.throws} throws`);
  } catch (e) {
    out.fails.push(`threw ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
  } finally {
    if (TRACE) console.log(`seed ${seed}: ${out.what}\n${trace.join('\n')}`);
    w.dispose();
  }
  return out;
}

test(`every throw of the Patch with a body ends on its stool: ${ONLY ?? SESSIONS} seeded session${(ONLY ?? SESSIONS) === 1 ? '' : 's'} on the whole bench`, async () => {
  const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SESSIONS }, (_, i) => i + 1);
  const all: Outcome[] = [];
  for (const s of seeds) all.push(await session(s));
  const failed = all.filter((o) => o.fails.length > 0);
  const times = all.map((o) => o.seconds).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (f: number): string => (times.length ? (times[Math.min(times.length - 1, Math.floor(f * times.length))] as number).toFixed(1) : '-');
  const slowest = all.filter((o) => o.seconds !== null).sort((a, b) => (b.seconds as number) - (a.seconds as number)).slice(0, 10);
  console.log(
    [
      `sessions ${all.length}; throws ${all.reduce((n, o) => n + o.throws, 0)} (${all.filter((o) => o.throws > 1).length} sessions taken hold of again, ${all.filter((o) => o.rung).length} with a Button rung); failed ${failed.length}`,
      `from the last release to seated on the stool: median ${q(0.5)} s, 95th ${q(0.95)} s, slowest ${q(1)} s (limit ${LIMIT} s)`,
      'the slowest:',
      ...slowest.map((o) => `  ${(o.seconds as number).toFixed(1)} s  seed ${o.seed}: ${o.what}; lay ${o.lay}`),
      ...failed.flatMap((o) => [`FAILED seed ${o.seed}: ${o.what}`, ...o.fails.map((f) => `    ${f}`)]),
    ].join('\n'),
  );
  expect(failed.map((o) => `seed ${o.seed}: ${o.fails[0]}`)).toEqual([]);
}, 7_200_000);
