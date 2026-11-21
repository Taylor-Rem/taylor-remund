// Fetch never stands for long in front of something the visitor presses. Seeded sessions of the whole bench under
// real Rapier, a visitor doing ordinary things, measured with `fetch-sight.ts`: per handle (the phone, the UNDO lever's
// plate and grip, the Button, the belt's dial and lever, the dock's bell, the lamp), the longest stretch Fetch (or the
// crate in its hands) stood on the line from the handle's middle to the eye, and the longest of those it stood still.
// Steps while a Button rung plays are not counted (nothing can be pressed then, § B4).
//
// (2026-11-21: in the page's test "the phone's panel is never stranded" the phone stayed covered by Fetch for thirty
// seconds, once in about eight runs. Measured on the page, that Fetch was in the visitor's hand: the test's own press on
// the phone, made at a random moment without looking, had landed on Fetch rolling past and picked it up (tap-then-tap),
// so it hung on the pointer, over the phone, while the test waited for the phone to come clear. This scan is the proof
// that Fetch on its own never does it.)
//
// Kinds of session: `attract` (nobody touches anything: attract mode's lap throughout), `phone` (the visitor picks the
// phone up every few seconds and does nothing else, as that page test does), `clicks` (the same, pressing at random
// moments whatever is in front: a press on Fetch or its crate takes it and lets it go where it is), `taps` (by touch: a
// tap on Fetch keeps it in hand, lifted where it was, until the next tap sets it down on the phone or Escape lets it
// go), and `mixed` (the phone and texts, the Button, the lever, the belt's switch and dial, the bell, crates put on the
// belt, on the bench, thrown, Fetch picked up and put down or thrown, and long looks with no hands).
//
// The bounds hold for the page's eye (its camera at the home framing). From the scene's `visitor` point, a low eye 14
// in front at 2.4 high, more is hidden, and the scan prints it: Fetch at the belt's feed (watching its crate ride in
// attract mode, about 9 s; holding a crate until the belt's pace lets it set it down) is on that eye's line to the
// UNDO plate; on the page, measured, the plate and the Button are never covered by it.
//
// In verify: 2 sessions a kind of 3 minutes. The big one: SIGHT_SESSIONS=100 npx vitest run tests/scenario/fetch-sight.test.ts
// SIGHT_KINDS=phone,taps (default all), SIGHT_FROM (default 1), SIGHT_SEED=<kind>:<n> for one, SIGHT_MINUTES,
// SIGHT_REPORT_ONLY=1 to print without the checks.
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, onBelt } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { hidden, sightWatch, SIGHTS } from './fetch-sight.ts';
import type { Stretch } from './fetch-sight.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const N = Number(process.env.SIGHT_SESSIONS ?? 2);
const FROM = Number(process.env.SIGHT_FROM ?? 1);
const MINUTES = Number(process.env.SIGHT_MINUTES ?? 3);
const ONLY = process.env.SIGHT_SEED ?? null;
const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];

/**
 * The bounds (seconds), from the page's eye. Standing still: 3, a salute (1.1 s) or a shrug (1.0 s) and the idle pause
 * before its next job (0.4 s), with room; the most measured over 300 sessions is 1.5 (a salute where the visitor took
 * its crate). Hidden at all, moving or not: 6, the time to pass by at work (a crate set down or taken where the line
 * runs, a hop back onto its tape on its jets and the pause after), far short of the thirty seconds that started this;
 * the most measured is 3.7 (put down by a tap on the phone and hopping back).
 */
const BOUND = { still: 3, any: 6 } as const;

type Kind = 'attract' | 'phone' | 'clicks' | 'taps' | 'mixed';

async function session(kind: Kind, seed: number): Promise<{ worst: Map<string, Stretch>; worstStill: Map<string, Stretch> }> {
  const w: World = await benchWorld(`sight-${kind}-${seed}`, { scene: FULL_BENCH });
  const r = rng(`sight-${kind}-${seed}`);
  const watch = sightWatch(w, () => {
    const rv = w.machine('revert-crew') as { state?: string } | undefined;
    return rv?.state && rv.state !== 'home' && rv.state !== 'below' ? ` (revert ${rv.state})` : '';
  });
  const end = steps(MINUTES * 60);
  const run = (n: number): void => {
    for (let i = 0; i < n && w.step < end; i++) {
      w.advance();
      w.drainEvents();
      watch.step();
    }
  };
  const carry = (id: string, to: Vec3, v: Vec3): void => {
    const m = w.motion(id);
    if (!m) return;
    w.dispatch({ type: 'grab', id, grip: m.pose.p });
    run(1);
    if (w.holding()?.id !== id) return;
    const a = m.pose.p;
    const n = 20 + r.int(30);
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      w.dispatch({ type: 'carry', target: [a[0] + (to[0] - a[0]) * f, Math.max(a[1], to[1]) + 1.2 * Math.sin(Math.PI * f), a[2] + (to[2] - a[2]) * f] });
      run(1);
    }
    w.dispatch({ type: 'release', velocity: v });
  };
  try {
    run(steps(r.range(2, 8))); // the visitor looks a moment first
    while (w.step < end) {
      if (kind === 'attract') {
        run(end);
        continue;
      }
      if (kind === 'clicks') {
        // as the page's test does: the phone pressed again at random moments without waiting for it to come clear; a
        // press that lands on Fetch (or the crate in its hands) is a click on that: taken and let go where it is
        if (hidden(w).has('phone (camera)')) {
          const c = w.crew('fetch')?.carrying;
          const id = c && r.chance(0.5) ? c : 'fetch';
          const m = w.motion(id);
          if (m) {
            w.dispatch({ type: 'grab', id, grip: m.pose.p });
            run(1 + r.int(6));
            w.dispatch({ type: 'release', velocity: [0, 0, 0] });
          }
        } else w.dispatch({ type: 'press', id: 'line' });
        run(1 + r.int(steps(1.5)));
        continue;
      }
      if (kind === 'taps') {
        // the same by touch: a tap that lands on Fetch keeps it in hand, lifted where it was (tap-then-tap), until the
        // next tap: on the phone (it is set down there) or Escape (it is let go where it hangs)
        if (hidden(w).has('phone (camera)') && w.mode('fetch') === 'crew') {
          const m = w.motion('fetch')!;
          const p0 = m.pose.p;
          w.dispatch({ type: 'grab', id: 'fetch', grip: p0 });
          const n = steps(r.range(0.2, 3));
          for (let i = 0; i < n; i++) {
            w.dispatch({ type: 'carry', target: [p0[0], p0[1] + 0.8, p0[2]] });
            run(1);
          }
          if (r.chance(0.5)) w.dispatch({ type: 'place', at: r.pick([[0.2, 0.72, 1.9], [0.2, 0.36, 2.05], [0.25, 0, 2.2]] as Vec3[]) });
          else w.dispatch({ type: 'release', velocity: [0, 0, 0] });
        } else w.dispatch({ type: 'press', id: 'line' });
        run(1 + r.int(steps(1.5)));
        continue;
      }
      if (kind === 'phone') {
        w.dispatch({ type: 'press', id: 'line' });
        run(1 + r.int(steps(5)));
        continue;
      }
      const k = r.int(20);
      if (k < 5) {
        w.dispatch({ type: 'press', id: 'line' });
        if (r.chance(0.4)) w.dispatch({ type: 'text', text: r.pick(['make it blue', 'paint it red', 'lamp brighter', 'hi', 'what is this']) });
      } else if (k < 6) w.dispatch({ type: 'press', id: 'button' });
      else if (k < 7) w.dispatch({ type: 'undo' });
      else if (k < 8) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
      else if (k < 9) w.dispatch({ type: 'turn', id: 'belt-lever', value: r.chance(0.8) ? 1 : r.next() });
      else if (k < 10) w.dispatch({ type: 'press', id: 'dock-bell' });
      else if (k < 15) {
        const avail = CRATES.filter((id) => w.mode(id) === 'free');
        if (avail.length) {
          const id = r.pick(avail);
          const roll = r.next();
          if (roll < 0.5) carry(id, onBelt(r.range(0.05, 0.8)), [0, 0, 0]);
          else if (roll < 0.8) carry(id, [r.range(-7, 7), 0.6, r.range(-3, 4)], [0, 0, 0]);
          else carry(id, [r.range(-6, 6), 1.5, r.range(-2, 4)], [r.range(-8, 8), r.range(0, 3), r.range(-8, 8)]);
        }
      } else if (k < 16 && w.mode('fetch') === 'crew') {
        // Fetch picked up and put down somewhere, now and then
        carry('fetch', [r.range(-6, 6), 0.8, r.range(-2, 4)], r.chance(0.5) ? [0, 0, 0] : [r.range(-6, 6), 1, r.range(-6, 6)]);
      }
      // then a look: mostly a few seconds, sometimes a long while with no hands
      run(r.chance(0.25) ? steps(r.range(15, 45)) : steps(r.range(1, 6)));
    }
  } finally {
    w.dispose();
  }
  return watch.done();
}

test(`Fetch does not stand in front of what the visitor presses: ${ONLY ?? `${N} sessions a kind`}, ${MINUTES} min each`, { timeout: 3_600_000 }, async () => {
  const plan: [Kind, number][] = ONLY ? [[ONLY.split(':')[0] as Kind, Number(ONLY.split(':')[1])]] : ((process.env.SIGHT_KINDS?.split(',') ?? ['attract', 'phone', 'clicks', 'taps', 'mixed']) as Kind[]).flatMap((k) => Array.from({ length: N }, (_, i) => [k, FROM + i] as [Kind, number]));
  const all: { kind: Kind; seed: number; worst: Map<string, Stretch>; worstStill: Map<string, Stretch> }[] = [];
  for (const [kind, seed] of plan) all.push({ kind, seed, ...(await session(kind, seed)) });
  const fails: string[] = [];
  for (const name of SIGHTS) {
    for (const which of ['worst', 'worstStill'] as const) {
      const xs = all.map((s) => ({ s, x: s[which].get(name) })).sort((a, b) => (b.x?.seconds ?? 0) - (a.x?.seconds ?? 0));
      const secs = xs.map((a) => a.x?.seconds ?? 0).sort((a, b) => a - b);
      const q = (f: number): string => (secs[Math.min(secs.length - 1, Math.floor(f * secs.length))] ?? 0).toFixed(1);
      const top = xs.slice(0, 3).filter((a) => a.x).map((a) => `${a.s.kind}:${a.s.seed} ${a.x!.seconds.toFixed(1)}s at t ${a.x!.from.toFixed(1)} (${a.x!.at.map((v) => v.toFixed(2)).join(', ')}) [${a.x!.what}]`);
      console.log(`[sight] ${name} ${which === 'worst' ? 'hidden' : 'hidden, Fetch still'}: median ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)}${top.length ? `; worst ${top.join(' | ')}` : ''}`);
      if (!name.endsWith('(camera)')) continue;
      const bound = which === 'worst' ? BOUND.any : BOUND.still;
      for (const a of xs) if (a.x && a.x.seconds > bound) fails.push(`${a.s.kind}:${a.s.seed} ${name} ${which} ${a.x.seconds.toFixed(1)} s > ${bound} [${a.x.what}]`);
    }
  }
  if (process.env.SIGHT_REPORT_ONLY) return;
  expect(fails).toEqual([]);
});
