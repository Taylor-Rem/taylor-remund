// The comparison that decides (Taylor, 2026-11-20: "Evaluate this against the current implementation before
// committing to a replacement"): the scripted Patch (`bench`) and the Patch with a real body (`benchBody`) thrown the
// same ways by the same hand, on the whole bench under real Rapier, and what each did, step by step:
//   - its speed across the step it is let go, across its first contact, and across the script taking over;
//   - how far it travelled; the longest run of steps in the air without motion; the largest move in one step;
//   - the time from touching down to its first step home, and to its stool.
// It prints the table (the hand-in quotes it) and holds only what must be true of both: each ends on its stool.
//
//   npx vitest run tests/scenario/patch-compare.test.ts --silent=false
import { expect, test } from 'vitest';
import { FULL_BENCH, LENS, benchBody, lift, patch, watcher, world } from './patch-body-helpers.ts';
import type { Sample } from './patch-body-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { AT } from '../../src/workshop/sim/scenes/bench.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Lens, Vec3 } from '../../src/workshop/sim/types.ts';

interface Way {
  readonly name: string;
  /** Where the hand holds it before the throw, the hand's velocity, for how many steps; the lens if it is a flick up the screen. */
  readonly from: Vec3;
  readonly v: Vec3;
  readonly n?: number;
  readonly lens?: Lens;
  /** Something to wait for before Patch is lifted. */
  readonly ready?: (w: World, t: Tape) => void;
}

/** Play mode, and Fetch come to stand at its stand by the pad, empty-handed (it stands there a while). */
function fetchAtPad(w: World, t: Tape): void {
  startPlay(w);
  for (let i = 0; i < steps(90); i++) {
    t.run(1);
    const f = w.crew('fetch')!;
    if (!f.carrying && f.state === 'idle' && Math.hypot(f.x - -2.9, f.z - 2.78) < 0.05 && i > steps(8)) return;
  }
  throw new Error('Fetch did not come to stand at the pad');
}

const motor = AT.beltMotor.c;
const WAYS: readonly Way[] = [
  { name: 'across the open bench', from: [-6.5, 1.6, -2], v: [10, 0, 0] },
  { name: 'up (a flick up the screen)', from: [-6, 1.6, 0.5], v: [0, 0, -12], lens: LENS },
  { name: 'up with drift', from: [-6, 1.6, 0.5], v: [4, 0, -12], lens: LENS },
  { name: 'at the back wall', from: [-5.5, 2.2, -1.2], v: [0, 0, -10] },
  { name: "at the UNDO lever's housing", from: [-7.4, 1.4, 0.35], v: [9, 0, 0] },
  { name: 'into the crate stack', from: [6.0, 1.2, 1.8], v: [-9, 0, 0] },
  // (Fetch stood at its stand by the pad, (-2.9, 2.78); from its right along its tape, at its middle's height)
  { name: 'at Fetch', from: [-2.9 + 1.7 + (9 * 13.5) / HZ, 1.25, 2.78], v: [-9, 0, 0], ready: fetchAtPad },
  { name: 'off the left end, gently', from: [-7.8, 1.0, -1], v: [-3, 0, 0] },
  { name: 'off the front, hard', from: [-4, 1.6, 1.6], v: [0, 0, 12] },
  { name: 'dropped from high', from: [-6.5, 6, -2], v: [0, 0, 0], n: 4 },
  { name: "let go inside the belt motor's footprint", from: [motor[0] + 3.2, 1.0, motor[2] - 2.0], v: [-12, -1.2, 7.5], n: 18 },
];

interface Row {
  release: [number, number];
  contact: [number, number] | null;
  takeover: [number, number, string] | null;
  distance: number;
  still: number;
  jump: number;
  jumpAt: string;
  toStep: number | null;
  toSeat: number | null;
  end: string;
  states: string;
}

function run(w: World, t: Tape, way: Way): Row {
  way.ready?.(w, t);
  const from = way.from;
  lift(w, t, from);
  const watch = watcher(w, t);
  // the hand's last steps (watched, for its speed in the hand), and the release: it gets up to speed over a tenth of
  // a second and holds it, so what it holds has caught it up
  let hand: Vec3 = from;
  const n = way.n ?? 16;
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, (i + 1) / 6) / HZ;
    hand = [hand[0] + way.v[0] * k, hand[1] + way.v[1] * k, hand[2] + way.v[2] * k];
    w.dispatch({ type: 'carry', target: hand });
    watch.step();
  }
  const before = watch.samples.at(-1) as Sample;
  const mark = t.events.length;
  w.dispatch(way.lens ? { type: 'release', lens: way.lens } : { type: 'release' });
  const first = watch.step();
  const start = before.mid;
  const releasedAt = watch.samples.length - 1;
  // until it is back on its stool
  let seatedAt: number | null = null;
  for (let i = 0; i < 45 * HZ; i++) {
    const s = watch.step();
    if (s.state === 'seated') {
      seatedAt = watch.samples.length - 1;
      break;
    }
  }
  const S = watch.samples;
  const air = (s: Sample): boolean => s.state === 'fly';
  // the first contact: its own sound of one (a hit, a landing), or its body's hit
  const ev = t.events.slice(mark).find((x) => (x.e.type === 'patch.throw' && (x.e.phase === 'hit' || x.e.phase === 'landed')) || (x.e.type === 'part.hit' && (x.e.id === 'patch-body' || x.e.other === 'patch-body')));
  const at = (step: number): number => S.findIndex((s) => s.step === step);
  let contact: Row['contact'] = null;
  if (ev) {
    // (how fast it came in: the most over the three steps before, since the engine may stop a fast body short of
    // what it meets in one step and turn it in the next; and how fast it went on)
    const i = at(ev.step);
    if (i > 0) contact = [Math.max(...S.slice(Math.max(0, i - 3), i).map((x) => x.speed)), S[i]!.speed];
  }
  // the script taking over: the first step after the release that is not in the air
  const over = S.findIndex((s, i) => i > releasedAt && !air(s));
  const takeover: Row['takeover'] = over > 0 ? [S[over - 1]!.speed, S[over]!.speed, S[over]!.state] : null;
  const restAt = over > 0 ? S[over - 1]!.mid : S.at(-1)!.mid;
  // in the air without motion; the largest move in one step after the release
  // (in the air: from the hand to its first contact, or to the script taking over. Without motion: less than a
  // two-thousandth of a unit in the step, where the top of any throw moves more than that in all but one step.
  // Out of sight and coming back from the chute is not a move)
  const touched = ev ? at(ev.step) : over > 0 ? over : S.length;
  let still = 0, runStill = 0, jump = 0, jumpAt = '';
  for (let i = releasedAt; i < S.length; i++) {
    const s = S[i]!;
    runStill = i < touched && air(s) && s.speed / HZ < 5e-4 ? runStill + 1 : 0;
    still = Math.max(still, runStill);
    const d = s.speed / HZ;
    if (s.state !== 'held' && s.state !== 'away' && S[i - 1]?.state !== 'away' && d > jump) [jump, jumpAt] = [d, `${S[i - 1]?.state ?? '?'}>${s.state}`];
  }
  // from touching down (its landing's sound; else the script taking over) to its first step home, and to its stool
  const landed = t.events.slice(mark).find((x) => x.e.type === 'patch.throw' && x.e.phase === 'landed');
  const down = landed ? at(landed.step) : over;
  const stepAt = S.findIndex((s, i) => i > releasedAt && s.state === 'walk' && s.speed > 0.5);
  const states: string[] = [];
  for (let i = releasedAt; i < S.length; i++) if (states.at(-1) !== S[i]!.state) states.push(S[i]!.state);
  return {
    release: [before.speed, first.speed],
    contact,
    takeover,
    distance: Math.hypot(restAt[0] - start[0], restAt[2] - start[2]),
    still,
    jump,
    jumpAt,
    toStep: down > 0 && stepAt > 0 ? (stepAt - down) / HZ : null,
    toSeat: down > 0 && seatedAt !== null ? (seatedAt - down) / HZ : null,
    end: patch(w).state,
    states: states.join(' '),
  };
}

const n1 = (x: number | null | undefined): string => (x === null || x === undefined ? '-' : x.toFixed(1));
const pair = (p: readonly [number, number] | readonly [number, number, string] | null): string => (p ? `${p[0].toFixed(1)}>${p[1].toFixed(1)}${p[2] ? ` (${p[2]})` : ''}` : '-');

test('the scripted Patch and the Patch with a body, thrown the same ways: both end on the stool (the table is printed)', async () => {
  const lines: string[] = [];
  for (const way of WAYS) {
    const rows: Row[] = [];
    for (const scene of [FULL_BENCH, benchBody]) {
      const { w, t } = await world(scene, `compare-${way.name}`);
      rows.push(run(w, t, way));
      w.dispose();
    }
    const [old, neu] = rows as [Row, Row];
    lines.push(`\n${way.name}`);
    for (const [who, r] of [['script', old], ['body  ', neu]] as const) {
      lines.push(
        `  ${who}  release ${pair(r.release)}  contact ${pair(r.contact)}  takeover ${pair(r.takeover)}  travelled ${r.distance.toFixed(1)}  still in air ${r.still} steps  largest step ${r.jump.toFixed(2)} (${r.jumpAt})  down>first step ${n1(r.toStep)} s  down>stool ${n1(r.toSeat)} s`,
      );
      lines.push(`          ${r.states}`);
    }
    expect(old.end, `${way.name}: the scripted Patch`).toBe('seated');
    expect(neu.end, `${way.name}: the Patch with a body`).toBe('seated');
  }
  console.log(`speeds are units/s (before>after the step); distances are units; a step is 1/60 s\n${lines.join('\n')}`);
}, 600_000);
