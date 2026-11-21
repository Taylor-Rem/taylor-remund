// Patch with a real body while it is held and thrown (the 2026-11-20 prototype; `PatchSpec.flight: 'body'`, scene
// `benchBody`; sim/crew/patch-body.ts). Taylor, 2026-11-20: "Patch should feel fun and physically convincing, retain
// momentum when thrown, interact naturally with the environment, and always be able to recover and return to his
// stool." These hold the MOTION, step by step, with a hand that takes hold, carries and lets go as the page does:
//   - in the hand its body is the world's (weight, lag, contacts); let go, it goes on as it was going;
//   - in the air there is no step without motion, the float at the top of a throw up included, and a throw with
//     sideways drift keeps its drift through the top;
//   - each time the script takes over (the wall, the ledge, the get-up) its speed is continuous, or it is a catch
//     that is named here;
//   - it travels about as far as a small crate thrown the same way, and what it hits moves by contact;
//   - it can be taken hold of again at any moment; a Button rung, a reset and the lever each leave it sound;
//   - and the scripted Patch (`bench`) is what it was.
// The seeded soak (every throw ends on the stool) is tests/scenario/patch-body-soak.test.ts.
import { describe, expect, test } from 'vitest';
import { BODY, SCRIPT, LENS, PATCH_BODY, SOLIDS, benchBody, fling, fmt, insideSolid, len, level, lift, middle, patch, watcher, world } from './patch-body-helpers.ts';
import type { Sample } from './patch-body-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { answer, send } from './patchlamp-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';
import { PATCH_BODY_TUNING } from '../../src/workshop/sim/crew/patch-body.ts';
import { PATCH_FLOAT, floatPull, floatWeight } from '../../src/workshop/sim/crew/patch-float.ts';
import { AT, PATCHLAMP, bench, benchScript } from '../../src/workshop/sim/scenes/bench.ts';
import { sphereMeets } from '../../src/workshop/sim/crew/patch-route.ts';
import type { PatchState, Vec3 } from '../../src/workshop/sim/types.ts';

const T = PATCH_TUNING;
const B = PATCH_BODY_TUNING;
const G = -benchBody.gravity;
const HALF = PATCH_BODY.half as Vec3;
/** The open lane at the back-left of the bench (clear of every fixed body from x -8.5 to 6.5 at z -2). */
const OPEN: Vec3 = [-6.5, 1.6, -2];
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1)))) * (180 / Math.PI);
/** The body's velocity over the last step. */
const vel = (w: World): Vec3 => {
  const m = w.motion(BODY)!;
  return [(m.pose.p[0] - m.prev.p[0]) * HZ, (m.pose.p[1] - m.prev.p[1]) * HZ, (m.pose.p[2] - m.prev.p[2]) * HZ];
};
/** Run until Patch is back on its stool (or `seconds`); the states it went through. */
function home(w: World, t: Tape, seconds = 45): PatchState[] {
  const states: PatchState[] = [patch(w).state];
  for (let i = 0; i < seconds * HZ && !(patch(w).state === 'seated' && i > 0); i++) {
    t.run(1);
    const s = patch(w).state;
    if (states.at(-1) !== s) states.push(s);
  }
  return states;
}
/** The index of the first sample the script has (not in the hand, not loose). */
const takeover = (S: readonly Sample[]): number => S.findIndex((s) => s.state !== 'fly' && s.state !== 'held');

describe('the scripted Patch is what it was', () => {
  test('`benchScript` has no body and its Patch none; `benchBody` is `benchScript` with the body part and the flag; `bench` is `benchBody`', async () => {
    // (2026-11-20: the bench's Patch is the body Patch; going back is `bench = benchScript`)
    expect(bench).toBe(benchBody);
    expect(benchScript.parts.some((p) => p.crewBody)).toBe(false);
    expect(benchBody.parts.slice(0, -1)).toEqual(benchScript.parts);
    expect(benchBody.parts.at(-1)).toBe(PATCH_BODY);
    expect(benchBody.statics).toBe(benchScript.statics);
    expect(benchBody.units?.length).toBe(benchScript.units?.length);
    expect(benchBody.units?.filter((u, i) => u !== benchScript.units?.[i]).length).toBe(1);
    const a = await world(SCRIPT);
    expect(a.w.motion(BODY)).toBeUndefined();
    expect('body' in patch(a.w)).toBe(false);
    expect('lay' in patch(a.w)).toBe(false);
    a.w.dispose();
    const b = await world();
    // out of the world until the hand takes hold; nobody's cargo, not a thing the hand can take by itself
    expect(b.w.motion(BODY)?.mode).toBe('gone');
    expect(b.w.interactable(BODY)).toBeUndefined();
    expect(patch(b.w).body).toBeNull();
    expect(patch(b.w).state).toBe('seated');
    b.w.dispatch({ type: 'grab', id: BODY, grip: [0, 0, 0] });
    b.t.run(1);
    expect(b.w.holding()).toBeNull();
    b.w.dispose();
  });
});

describe('in the hand: its body is the world\'s', () => {
  test('taken off the stool, its body comes into the world where it sat, in the hand; `at` rides the body', async () => {
    const { w, t } = await world();
    const seat = patch(w).at;
    w.dispatch({ type: 'grab', id: 'patch', grip: [seat[0], seat[1] + 0.5, seat[2]] });
    t.run(1);
    expect(w.holding()).toEqual({ kind: 'unit', id: 'patch', body: BODY });
    expect(w.motion(BODY)?.mode).toBe('held');
    const v = patch(w);
    expect(v.state).toBe('held');
    expect(v.body?.held).toBe(true);
    // where it sat (its box on the stool's top), not somewhere else
    expect(Math.hypot(v.body!.pose.p[0] - seat[0], v.body!.pose.p[2] - seat[2])).toBeLessThan(0.05);
    expect(v.body!.pose.p[1] - seat[1]).toBeGreaterThan(HALF[1] - 0.05);
    expect(v.body!.pose.p[1] - seat[1]).toBeLessThan(HALF[1] + 0.15);
    // `at` is the hand as the scripted Patch means it: `hangBelow` over its middle
    expect(v.at[1] - v.body!.pose.p[1]).toBeCloseTo(T.hangBelow, 6);
    w.dispose();
  });

  // Its rate in the hand is the world's by its mass (0.08: a little weightier than a small crate), so it trails a
  // steady 20 units/s by about half a unit, and has the hand's speed.
  test('it has weight: it trails a brisk hand by well under a unit and keeps up; held still it is still', async () => {
    const { w, t } = await world();
    lift(w, t, OPEN, 30);
    expect(len(vel(w))).toBeLessThan(0.05);
    const p0 = w.motion(BODY)!.pose.p;
    let hand: Vec3 = OPEN;
    let trail = 0;
    for (let i = 0; i < 24; i++) {
      hand = [hand[0] + 20 / HZ, hand[1], hand[2]];
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
      trail = Math.max(trail, hand[0] - OPEN[0] - (w.motion(BODY)!.pose.p[0] - p0[0]));
    }
    // (after each step: the hand's last move less what the body made of it. A small crate's is 0.11)
    expect(trail).toBeGreaterThan(0.08);
    expect(trail).toBeLessThan(0.9);
    expect(level(vel(w))).toBeGreaterThan(18.5);
    expect(level(vel(w))).toBeLessThan(21);
    w.dispose();
  });

  test('it cannot be carried through a machine, nor let go inside one: against the UNDO lever\'s housing it stops at its face, and let go there it is where it was', async () => {
    const { w, t } = await world();
    const z = AT.undo.c[2];
    const face = AT.undo.c[0] - AT.undo.half[0];
    lift(w, t, [face - 1.4, 1.0, z]);
    // the hand goes on into the housing, to its middle
    let hand: Vec3 = [face - 1.4, 1.0, z];
    for (let i = 0; i < 40; i++) {
      hand = [Math.min(AT.undo.c[0], hand[0] + 6 / HZ), hand[1], hand[2]];
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
      expect(insideSolid(w.motion(BODY)!.pose.p, 0), `step ${i}`).toBeNull();
    }
    expect(hand[0]).toBeCloseTo(AT.undo.c[0], 6);
    // its body is against the face, outside it (its middle at least a paw's depth short of it)
    const held = w.motion(BODY)!.pose.p;
    expect(held[0]).toBeLessThan(face - Math.min(HALF[0], HALF[2]) + 0.06);
    const watch = watcher(w, t);
    w.dispatch({ type: 'release' });
    const first = watch.step();
    // let go: no move to somewhere else (the scripted Patch was moved out of the body, up to half a unit, or sat down elsewhere)
    expect(len([first.mid[0] - held[0], first.mid[1] - held[1], first.mid[2] - held[2]])).toBeLessThan(0.1);
    const got = watch.until((s) => s.state === 'seated', 40);
    expect(got, 'home').not.toBeNull();
    for (const s of watch.samples) if (s.body) expect(insideSolid(s.mid, 0), `${s.state}`).toBeNull();
    w.dispose();
  }, 120_000);
});

describe('let go: it goes on as it was going', () => {
  // The hand tests' own bound for a crate (tests/scenario/hand-continuity.test.ts): the first free step may differ
  // from the last held one by gravity, the throw's small loft (upward only), and the easing toward what it had a
  // moment before.
  for (const [name, dir] of [['right', [1, 0]], ['left', [-1, 0]], ['toward the visitor', [0, 1]], ['away', [0, -1]], ['right and away', [1, -1]], ['left and toward', [-1, 1]]] as const) {
    test(`carried ${name} at a steady 8 units/s and let go: the same way, the same speed, and it is in the air under the engine`, async () => {
      const { w, t } = await world();
      const at: Vec3 = [-4, 1.4, -1];
      lift(w, t, at, 30);
      const L = Math.hypot(dir[0], dir[1]);
      let hand = at;
      for (let i = 0; i < 12; i++) {
        hand = [hand[0] + ((dir[0] / L) * 8) / HZ, hand[1], hand[2] + ((dir[1] / L) * 8) / HZ];
        w.dispatch({ type: 'carry', target: hand });
        t.run(1);
      }
      const before = vel(w);
      const was = middle(w);
      w.dispatch({ type: 'release' });
      const ev = t.run(1);
      const after = vel(w);
      expect(w.motion(BODY)!.mode).toBe('free');
      expect(patch(w).state).toBe('fly');
      expect(patch(w).body?.held).toBe(false);
      expect(angle([after[0], 0, after[2]], [before[0], 0, before[2]])).toBeLessThan(6);
      expect(level(after)).toBeGreaterThan(level(before) * 0.93);
      expect(level(after)).toBeLessThan(level(before) * 1.07);
      expect(after[1]).toBeGreaterThan(-0.5);
      expect(after[1]).toBeLessThan(LOOSE_TUNING.loftMax + 0.1);
      // and where it is: one step on from where it was, not somewhere else
      const now = middle(w);
      expect(len([now[0] - was[0], now[1] - was[1], now[2] - was[2]])).toBeLessThan((level(before) / HZ) * 1.2);
      // a throw: it says so once, with the body's own speed
      const thrown = ev.filter((e) => e.type === 'patch.throw' && e.phase === 'thrown') as { speed: number }[];
      expect(thrown.length).toBe(1);
      expect(thrown[0]!.speed).toBeGreaterThan(7.4);
      expect(thrown[0]!.speed).toBeLessThan(9);
      w.dispose();
    });
  }

  test('a hand that has stopped has thrown nothing: let go a tenth of a second after a sweep it falls where it is, and says nothing of a throw', async () => {
    const { w, t } = await world();
    const at: Vec3 = [-6.5, 0.9, -2];
    lift(w, t, at, 30);
    let hand = at;
    for (let i = 0; i < 8; i++) {
      hand = [hand[0] + 20 / HZ, hand[1], hand[2]];
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
    }
    for (let i = 0; i < 6; i++) {
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
    }
    expect(level(vel(w))).toBeLessThan(1);
    const mark = t.events.length;
    w.dispatch({ type: 'release' });
    t.run(1);
    expect(level(vel(w))).toBeLessThan(1);
    home(w, t);
    // (a hand's height over the bench: a set-down. No sound of a throw, none of a landing)
    expect(t.events.slice(mark).filter((x) => x.e.type === 'patch.throw')).toEqual([]);
    w.dispose();
  }, 60_000);
});

describe('in the air: the engine\'s, and never still', () => {
  /** The steps from the hand to its first contact. */
  async function flight(v: Vec3, lens = true, from: Vec3 = [-6, 1.6, 0.5]): Promise<{ S: Sample[]; floats: number[]; tops: boolean[]; weights: Set<number>; w: World; t: Tape; v0: Vec3 }> {
    const { w, t } = await world();
    lift(w, t, from, 30);
    fling(w, t, from, v, 16, lens ? LENS : undefined);
    const v0 = vel(w);
    const watch = watcher(w, t);
    const floats: number[] = [];
    const tops: boolean[] = [];
    const weights = new Set<number>();
    for (let i = 0; i < 6 * HZ; i++) {
      const before = t.events.length;
      const s = watch.step();
      if (t.events.slice(before).some((x) => x.e.type === 'part.hit' && (x.e.id === BODY || x.e.other === BODY))) {
        // (and the two steps before it: the engine may stop a fast body short of what it meets a step before the hit)
        watch.samples.splice(-3);
        floats.splice(-2);
        tops.splice(-2);
        break;
      }
      expect(s.state).toBe('fly');
      // (how much of the float is on now; `thrown.float`, how much this throw floats at all, is the same all the way)
      floats.push(patch(w).body?.float ?? -1);
      tops.push(patch(w).thrown?.top ?? false);
      weights.add(Math.round((patch(w).thrown?.float ?? -1) * 1e6) / 1e6);
    }
    return { S: watch.samples, floats, tops, weights, w, t, v0 };
  }

  test('thrown nearly straight up it lingers at the top (about the old hang\'s extra air time) and never stops: no step without motion', async () => {
    const { S, floats, tops, weights, w, v0 } = await flight([0, 0, -12]);
    // a flick up the screen at 12 units/s is a throw straight up at 0.7 of that
    expect(v0[1]).toBeGreaterThan(7.5);
    expect(level(v0)).toBeLessThan(0.5);
    // never still: no two steps running in which it moves less than a ten-thousandth of a unit (at the very top
    // of any throw one step may: its upward speed passes through zero; the floated gravity changes it by 0.04
    // units/s a step even there)
    const tiny = S.map((s) => s.speed / HZ < 1e-4);
    expect(tiny.some((x, i) => x && tiny[i + 1])).toBe(false);
    // and its upward speed changes every step, by never less than the floated gravity allows (it is not held)
    for (let i = 1; i < S.length; i++) expect(S[i - 1]!.v[1] - S[i]!.v[1], `step ${i}`).toBeGreaterThan((G * (1 - PATCH_FLOAT.depth) * 0.9) / HZ);
    // it lingers: longer above where it left the hand than gravity alone would keep it, by about the old 0.15 s
    const up = S.filter((s) => s.mid[1] > S[0]!.mid[1] - v0[1] / HZ).length / HZ;
    const plain = (2 * v0[1]) / G;
    expect(up - plain).toBeGreaterThan(0.09);
    expect(up - plain).toBeLessThan(0.24);
    // the view is told: the float rises to nearly all of it at the top and is gone on the way down; `top` at the top
    expect([...weights]).toEqual([1]); // (straight up and hard: it floats all it can, and the view is told so all the way)
    expect(Math.max(...floats)).toBeGreaterThan(0.9);
    expect(floats[0]).toBeLessThan(0.05);
    expect(floats.at(-1)).toBeLessThan(0.05);
    const apex = S.reduce((m, s, i) => (s.mid[1] > S[m]!.mid[1] ? i : m), 0);
    expect(tops[apex]).toBe(true);
    expect(tops[0]).toBe(false);
    // (it comes on and goes over several steps each way, never in one: the view eases the fold of its arms on top of this)
    for (let i = 1; i < floats.length; i++) expect(Math.abs(floats[i]! - floats[i - 1]!)).toBeLessThan(0.45);
    w.dispose();
  }, 60_000);

  test('with sideways drift the drift goes on through the top, untouched; the float is less the more it leans', async () => {
    const { S, floats, weights, w, v0 } = await flight([3.5, 0, -12]);
    expect(v0[0]).toBeGreaterThan(2.9);
    expect(v0[1]).toBeGreaterThan(7.5);
    const apex = S.reduce((m, s, i) => (s.mid[1] > S[m]!.mid[1] ? i : m), 0);
    // its level speed at the top is what it left with (its body has no drag from the air)
    expect(level(S[apex]!.v)).toBeGreaterThan(level(v0) * 0.98);
    expect(level(S[apex]!.v)).toBeLessThanOrEqual(level(v0) * 1.001);
    // every step it moves along its drift: no freeze
    for (const s of S) expect(level(s.v)).toBeGreaterThan(level(v0) * 0.98);
    // it leans (about twenty degrees off straight up): some float, not all of it
    expect(Math.max(...floats)).toBeGreaterThan(0.1);
    expect(Math.max(...floats)).toBeLessThan(0.8);
    expect(weights.size).toBe(1);
    expect(Math.abs(([...weights][0] as number) - floatWeight(v0))).toBeLessThan(0.05); // (`v0` is its first step in the air, a step of gravity on from the throw itself)
    expect([...weights][0]).toBeGreaterThan(0.1);
    expect([...weights][0]).toBeLessThan(0.8);
    w.dispose();
    // and a throw across the bench has none at all
    const across = await flight([10, 0, 0], false, OPEN);
    expect(Math.max(...across.floats)).toBe(0);
    expect([...across.weights]).toEqual([0]);
    across.w.dispose();
  }, 60_000);

  test('the float has no threshold: its weight changes smoothly with the throw\'s lean and its upward speed', () => {
    expect(floatWeight([0, 8, 0])).toBe(1);
    expect(floatWeight([0, 12, 0])).toBe(1);
    expect(floatWeight([8, 8, 0])).toBe(0);
    expect(floatWeight([10, 1.6, 0])).toBe(0);
    expect(floatWeight([0, 2, 0])).toBe(0);
    expect(floatWeight([0, -3, 0])).toBe(0);
    for (let up = 0; up <= 12; up += 0.05) {
      let prev = floatWeight([0, up, 0]);
      for (let side = 0.02; side <= 14; side += 0.02) {
        const k = floatWeight([side, up, 0]);
        expect(Math.abs(k - prev), `up ${up} side ${side}`).toBeLessThan(0.05);
        expect(k).toBeLessThanOrEqual(prev + 1e-12); // (never more for leaning further)
        prev = k;
      }
    }
    for (let side = 0; side <= 6; side += 0.25) {
      let prev = floatWeight([side, 0, 0]);
      for (let up = 0.02; up <= 12; up += 0.02) {
        const k = floatWeight([side, up, 0]);
        expect(Math.abs(k - prev), `side ${side} up ${up}`).toBeLessThan(0.05);
        prev = k;
      }
    }
    // gravity is never switched off: at the very top of the most vertical throw it still feels a good part of it
    expect(floatPull(1, 0)).toBeCloseTo(1 - PATCH_FLOAT.depth, 9);
    expect(floatPull(1, 0)).toBeGreaterThan(0.1);
    expect(floatPull(1, 6)).toBeGreaterThan(0.999);
    expect(floatPull(0, 0)).toBe(1);
    // the angles it is stated in: all of it within ten degrees of straight up, none from thirty
    const at = (deg: number): number => floatWeight([8 * Math.tan((deg * Math.PI) / 180), 8, 0]);
    expect(at(9)).toBe(1);
    expect(at(12)).toBeLessThan(1);
    expect(at(20)).toBeGreaterThan(0.3);
    expect(at(20)).toBeLessThan(0.7);
    expect(at(29)).toBeGreaterThan(0);
    expect(at(31)).toBe(0);
  });
});

describe('momentum: it travels as a thing thrown, and what it hits moves by contact', () => {
  /** How far (level) a thing thrown from the open lane at `speed` along +x has gone when it lies still. */
  async function reachOf(id: 'patch' | 'crate-3', speed: number, z: number): Promise<number> {
    const { w, t } = await world();
    const part = id === 'patch' ? BODY : id;
    // (both let go with their middles at the same height)
    const hold: Vec3 = [-6.5, id === 'patch' ? 0.9 + HALF[1] : 0.9, z];
    if (id === 'patch') lift(w, t, hold, 30);
    else {
      const from = w.motion(id)!.pose.p;
      w.dispatch({ type: 'grab', id, grip: from });
      for (let i = 1; i <= 80; i++) {
        const k = Math.min(1, i / 50);
        w.dispatch({ type: 'carry', target: [from[0] + (hold[0] - from[0]) * k, hold[1] + 1.5 * Math.sin(Math.PI * k), from[2] + (hold[2] - from[2]) * k] });
        t.run(1);
      }
    }
    const start = w.motion(part)!.pose.p;
    w.dispatch({ type: 'release', velocity: [speed, 0, 0] });
    let end = start;
    let still = 0;
    for (let i = 0; i < 8 * HZ && still < 15; i++) {
      t.run(1);
      const m = w.motion(part)!;
      if (m.mode !== 'free') break; // (Patch: the script has taken over where it lay)
      end = m.pose.p;
      still = Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[2] - m.prev.p[2]) * HZ < 0.1 ? still + 1 : 0;
    }
    w.dispose();
    return Math.hypot(end[0] - start[0], end[2] - start[2]);
  }

  // Where a tumbling thing stops is chancy (a crate on its corner, a plush toy on its back), so each is thrown down
  // four lanes and the means compared. Printed for the hand-in.
  test('across the open bench it travels about as far as a small crate thrown the same way', async () => {
    const lines: string[] = [];
    for (const speed of [6, 10, 14]) {
      let crate = 0, body = 0;
      const lanes = [-2.3, -2, -1.7, -1.4];
      for (const z of lanes) {
        crate += (await reachOf('crate-3', speed, z)) / lanes.length;
        body += (await reachOf('patch', speed, z)) / lanes.length;
      }
      lines.push(`thrown at ${speed}: a small crate ${crate.toFixed(1)} units, Patch ${body.toFixed(1)}`);
      expect(body, `at ${speed}`).toBeGreaterThan(crate * 0.65);
      expect(body, `at ${speed}`).toBeLessThan(crate * 1.5);
    }
    console.log(lines.join('\n'));
  }, 240_000);

  test('it knocks a loose crate on by contact; the knock is the throw\'s, and one pull of the lever takes it back while Patch tumbles on', async () => {
    const { w, t } = await world();
    const crate = 'crate-3';
    const c0 = w.motion(crate)!.pose.p;
    const loc0 = w.part(crate)!.location;
    const before = w.durable();
    const from: Vec3 = [c0[0] - 2.6, c0[1] + 0.25 + HALF[1], c0[2]];
    lift(w, t, from);
    const mark = t.events.length;
    fling(w, t, from, [9, 0, 0], 8);
    const hit = t.until((e) => e.type === 'patch.throw' && e.phase === 'hit' && e.what === crate, steps(2));
    expect(hit, 'it says it hit the crate').not.toBeNull();
    const txn = (hit!.e as { txn?: string }).txn;
    expect(txn, 'the hit names the throw').toBeTruthy();
    // by contact: the engine's own hit of the two, and the crate is moving on along the throw
    expect(t.events.slice(mark).some((x) => x.e.type === 'part.hit' && [x.e.id, x.e.other].includes(BODY) && [x.e.id, x.e.other].includes(crate))).toBe(true);
    const cv = w.motion(crate)!;
    expect((cv.pose.p[0] - cv.prev.p[0]) * HZ).toBeGreaterThan(2);
    // it is on the stack as the throw's, with the crate moving under it
    expect(w.undoStack().at(-1)?.id).toBe(txn);
    expect(w.undoStack().at(-1)?.moving).toContain(crate);
    // the lever, while both still move: the crate is put back; Patch is not a thing the lever puts anywhere
    expect(patch(w).state).toBe('fly');
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'undone')).toBe(true);
    expect(w.part(crate)!.location).toEqual(loc0);
    expect(Math.hypot(w.motion(crate)!.pose.p[0] - c0[0], w.motion(crate)!.pose.p[2] - c0[2])).toBeLessThan(0.05);
    expect(w.motion(BODY)!.mode).toBe('free');
    expect(patch(w).state).toBe('fly');
    expect((ev.find((e) => e.type === 'undone') as unknown as { restores: { target: string }[] }).restores.some((r) => r.target === BODY)).toBe(false);
    expect(home(w, t).at(-1)).toBe('seated');
    t.run(steps(8));
    // nothing of the throw's is left: the stack is empty and no field is written by a transaction (the crew go on
    // with their own work meanwhile, as `crew`; the crate, if Patch tumbling on nudged it again, rests as `system`'s)
    expect(w.undoStack()).toEqual([]);
    expect(w.durable().filter((d) => /^t\d+$/.test(String(d.writer)))).toEqual([]);
    expect(w.durable().filter((d) => d.target === BODY)).toEqual(before.filter((d) => d.target === BODY));
    w.dispose();
  }, 120_000);

  /** Play mode; Fetch waiting at its stand by the pad, empty-handed. */
  async function fetchWaiting(seed: string): Promise<{ w: World; t: Tape }> {
    const { w, t } = await world(benchBody, seed);
    startPlay(w);
    for (let i = 0; i < steps(90); i++) {
      t.run(1);
      const f = w.crew('fetch')!;
      if (!f.carrying && f.state === 'idle' && Math.hypot(f.x - -2.9, f.z - 2.78) < 0.05 && i > steps(8)) return { w, t };
    }
    throw new Error('Fetch did not come to stand at the pad empty-handed');
  }

  // Fetch already answers a free part that hits it, by the part's momentum (its box as paper weighs 0.05; Fetch's
  // own figure for the scripted Patch was 0.06). The body must not also say `patch.throw` hit for Fetch: that would
  // make Fetch play its scripted Patch-knock as well.
  for (const [speed, least] of [[5, 1], [9, 2], [13, 2]] as const) {
    test(`thrown at Fetch at ${speed} units/s: Fetch is knocked by the contact, by its momentum, away from Patch; no scripted Patch-knock; both recover`, async () => {
      const { w, t } = await fetchWaiting(`body-fetch-${speed}`);
      const f0 = w.motion('fetch')!.pose.p;
      const run = 8;
      // from Fetch's right along its tape, Patch's middle at Fetch's
      const from: Vec3 = [f0[0] + 1.7 + (speed * (run - 1)) / HZ, f0[1] + HALF[1], f0[2]];
      lift(w, t, from);
      const mark = t.events.length;
      fling(w, t, from, [-speed, 0, 0], run);
      const knocked = t.until((e) => e.type === 'crew.knocked' && e.id === 'fetch', steps(3));
      expect(knocked, 'Fetch is knocked').not.toBeNull();
      const k = knocked!.e as { by: string; strength: number; dir: number; spin: number };
      expect(k.by).toBe(BODY);
      expect(k.strength).toBeGreaterThanOrEqual(least);
      expect(Math.sign(Math.sin(k.dir)), 'away from where Patch came from').toBe(-1);
      // the engine's contact is what it answered; Patch said nothing that Fetch's scripted Patch-knock listens for
      const since = t.events.slice(mark);
      expect(since.some((x) => x.e.type === 'part.hit' && [x.e.id, x.e.other].includes(BODY) && [x.e.id, x.e.other].includes('fetch'))).toBe(true);
      expect(since.filter((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.what === 'fetch')).toEqual([]);
      expect(since.filter((x) => x.e.type === 'crew.knocked').length).toBe(1);
      expect(home(w, t).at(-1)).toBe('seated');
      // Fetch: on its wheels, on its tape, back at work
      t.run(steps(4));
      const m = w.motion('fetch')!;
      expect(m.mode).toBe('crew');
      expect(1 - 2 * (m.pose.q[0] ** 2 + m.pose.q[2] ** 2)).toBeGreaterThan(0.99);
      expect(['knocked', 'held']).not.toContain(w.crew('fetch')!.state);
      w.dispose();
    }, 120_000);
  }

  test('Fetch knocked while it carries a crate: the crate it drops is the throw\'s, and the lever puts it back', async () => {
    const { w, t } = await world(benchBody, 'body-fetch-crate');
    startPlay(w);
    // Patch is in the hand already, over Fetch's tape to the right of its stand by the pad, when Fetch comes to
    // stand there with a crate (it does not stand long)
    const speed = 11;
    const run = 8;
    const from: Vec3 = [-2.9 + 1.7 + (speed * (run - 1)) / HZ, 0.75 + HALF[1], 2.78];
    lift(w, t, [from[0], from[1] + 1.4, from[2]]);
    let crate: string | null = null;
    for (let i = 0; i < steps(120) && !crate; i++) {
      t.run(1);
      const f = w.crew('fetch')!;
      if (!f.carrying || f.state !== 'idle' || Math.hypot(f.x - -2.9, f.z - 2.78) > 0.05 || i < steps(8)) continue;
      // (in its hands and lifted: off the place its location says, not the moment its hands close on it there)
      const m = w.motion(f.carrying)!;
      const loc = w.part(f.carrying)!.location;
      if (m.mode === 'crew' && (loc.at !== 'rest' || Math.hypot(m.pose.p[0] - loc.pose.p[0], m.pose.p[1] - loc.pose.p[1], m.pose.p[2] - loc.pose.p[2]) > 0.4)) crate = f.carrying;
    }
    expect(crate, 'it stands with a crate').toBeTruthy();
    const locBefore = w.part(crate!)!.location;
    const stackBefore = w.undoStack().length;
    // down to its height, and thrown at it from its right along its tape
    for (let i = 1; i <= 10; i++) {
      w.dispatch({ type: 'carry', target: [from[0], from[1] + 1.4 * (1 - i / 10), from[2]] });
      t.run(1);
    }
    fling(w, t, from, [-speed, 0, 0], run);
    const knocked = t.until((e) => e.type === 'crew.knocked' && e.id === 'fetch', steps(3));
    expect((knocked?.e as { dropped?: string | null } | undefined)?.dropped, 'it drops its crate').toBe(crate);
    t.run(3);
    // the crate is loose, and moving under Patch's own throw: wherever it comes to rest is that transaction's
    expect(w.mode(crate!)).toBe('free');
    expect(w.undoStack().length).toBe(stackBefore + 1);
    const top = w.undoStack().at(-1)!;
    expect(top.kind).toBe('release');
    expect(top.subject, 'Patch\'s own throw').toBe(BODY);
    expect(top.moving).toContain(crate);
    const flung = w.motion(crate!)!.pose.p;
    expect(locBefore.at === 'rest' && Math.hypot(flung[0] - locBefore.pose.p[0], flung[1] - locBefore.pose.p[1], flung[2] - locBefore.pose.p[2])).toBeGreaterThan(0.4);
    // the lever: the crate is back where the history had it before the throw; Patch tumbles on
    w.dispatch({ type: 'undo' });
    const undone = t.run(1).find((e) => e.type === 'undone') as unknown as { restores: { target: string }[] } | undefined;
    // (put back on the pad, where Fetch, still sliding from the knock, may shove it again: its location is the record)
    expect(undone?.restores.map((r) => r.target)).toEqual([crate]);
    expect(w.part(crate!)!.location).toEqual(locBefore);
    expect(w.undoStack().length).toBe(stackBefore);
    expect(w.motion(BODY)!.mode).toBe('free');
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  test('back up the chute, what it knocks is still a throw\'s: it is on the stack, and one pull of the lever puts it back', async () => {
    const { w, t } = await world(benchBody, 'body-chute-knock');
    // a crate stood where the chute throws Patch (three quarters of the way from its mouth to the pad)
    const crate = 'crate-3';
    const aim: Vec3 = [AT.chute.p[0] + (AT.pad[0] - AT.chute.p[0]) * 0.75, bench.bench.top, AT.chute.p[2] + (AT.pad[1] - AT.chute.p[2]) * 0.75];
    const c0 = w.motion(crate)!.pose.p;
    w.dispatch({ type: 'grab', id: crate, grip: c0 });
    for (let i = 1; i <= 60; i++) {
      const k = i / 60;
      w.dispatch({ type: 'carry', target: [c0[0] + (aim[0] - c0[0]) * k, 1.2 + Math.sin(Math.PI * k), c0[2] + (aim[2] - c0[2]) * k] });
      t.run(1);
    }
    w.dispatch({ type: 'place', at: aim });
    t.run(steps(7.5)); // (at rest, and its own window shut)
    const loc0 = w.part(crate)!.location;
    const at0 = w.motion(crate)!.pose.p;
    expect(Math.hypot(at0[0] - aim[0], at0[2] - aim[2])).toBeLessThan(0.1);
    // off the front, hard, from where it meets nothing on the way
    const from: Vec3 = [-1.5, 1.6, 1.6];
    lift(w, t, from);
    fling(w, t, from, [0, 0, 12], 10);
    expect(t.until((e) => e.type === 'patch.throw' && e.phase === 'chute', steps(8)), 'it comes back up the chute').not.toBeNull();
    const hit = t.until((e) => e.type === 'patch.throw' && e.phase === 'hit' && e.what === crate, steps(3));
    expect(hit, 'it comes down on the crate').not.toBeNull();
    const txn = (hit!.e as { txn?: string }).txn;
    expect(txn, 'the hit names a transaction').toBeTruthy();
    expect(w.undoStack().at(-1)?.id).toBe(txn);
    expect(w.undoStack().at(-1)?.moving).toContain(crate);
    // wherever the crate comes to rest is that transaction's, and the lever takes it back
    t.run(steps(4));
    for (let i = 0; i < 4 && w.undoStack().some((x) => x.id === txn); i++) {
      w.dispatch({ type: 'undo' });
      t.run(1);
    }
    expect(w.part(crate)!.location).toEqual(loc0);
    expect(Math.hypot(w.motion(crate)!.pose.p[0] - at0[0], w.motion(crate)!.pose.p[2] - at0[2])).toBeLessThan(0.05);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);
});

describe('the gags are reactions to what the engine did', () => {
  test('a wall met square and fast: flat against it for the stick, then down it to the bench (a catch, named: the splat); it sits at its foot and goes home', async () => {
    const { w, t } = await world();
    const from: Vec3 = [-5.5, 2.2, -1.2];
    lift(w, t, from);
    const mark = t.events.length;
    fling(w, t, from, [0, 0, -10], 16);
    const watch = watcher(w, t);
    const got = watch.until((s) => s.state === 'wall', 2);
    expect(got, 'the wall').not.toBeNull();
    const S = watch.samples;
    const i = S.length - 1;
    // it really met it: it came in fast, the engine had turned it, and it is against the wall's face
    const hit = t.events.slice(mark).find((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit');
    expect(hit?.e).toMatchObject({ what: 'back-wall', wall: true });
    expect((hit!.e as { speed: number }).speed).toBeGreaterThan(8);
    expect(Math.max(...S.slice(Math.max(0, i - 4), i).map((s) => s.speed))).toBeGreaterThan(8);
    expect(S[i]!.mid[2] - AT.bench.minZ).toBeLessThan(Math.max(...HALF) + 0.12);
    expect(patch(w).body).toBeNull();
    expect(patch(w).wall?.out).toEqual([0, 0, 1]);
    // (taken a step before its body touches: flat against the face, the view carried there from the pose it had)
    expect(patch(w).at[2] - AT.bench.minZ).toBeCloseTo(B.wallFlat, 6);
    expect(patch(w).lay!.pose.p[2] - AT.bench.minZ).toBeLessThan(1.4);
    // the splat: still for the stick, then it slides, gathering speed, never faster than the scripted slide
    for (let k = 0; k < steps(T.stick) - 1; k++) expect(watch.step().speed, `stuck, step ${k}`).toBe(0);
    let fastest = 0;
    const slid = watch.until((s) => {
      if (s.state === 'wall') fastest = Math.max(fastest, s.speed);
      return s.state !== 'wall';
    }, 4);
    expect(slid?.state).toBe('land');
    expect(fastest).toBeGreaterThan(1);
    expect(fastest).toBeLessThan(6);
    // sat at the wall's foot, on the bench, not in it
    expect(slid!.at[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.abs(slid!.at[2] - AT.bench.minZ)).toBeLessThan(0.9);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  test('flicked level at the back wall from beside it, at a deliberate flick\'s speed: at the wall it goes, and splats; carried into it, brought to it slowly, or held against it, none', async () => {
    for (const [name, past, sticks, hold, n] of [['flicked into it', 1.2, true, 0, 12], ['flicked at it from a unit off', -1.0, true, 0, 4], ['carried into it briskly and let go', 1.2, false, 0, 24], ['brought to it slowly', -0.32, false, 0, 90], ['held against it', 1.2, false, 30, 12]] as const) {
      const { w, t } = await world();
      const from: Vec3 = [-5.5, 1.6, -3.2];
      lift(w, t, from);
      // the hand goes on toward (and past) the wall's face; the body cannot follow it through
      const wall = bench.bench.minZ;
      let hand: Vec3 = from;
      for (let i = 0; i < n; i++) {
        hand = [from[0], from[1], from[2] + ((wall - past - from[2]) * (i + 1)) / n];
        w.dispatch({ type: 'carry', target: hand });
        t.run(1);
      }
      for (let i = 0; i < hold; i++) {
        w.dispatch({ type: 'carry', target: hand });
        t.run(1);
      }
      const mark = t.events.length;
      w.dispatch({ type: 'release' });
      const watch = watcher(w, t);
      let s = watch.step();
      for (let i = 0; i < 20 && sticks && s.state === 'fly'; i++) s = watch.step();
      const walled = t.events.slice(mark).some((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.wall === true);
      expect(walled, name).toBe(sticks);
      expect(s.state, name).toBe(sticks ? 'wall' : 'fly');
      if (sticks) {
        // where its body was, its back to the wall; the view is given the pose it had
        expect(patch(w).lay?.pose, name).toBeTruthy();
        expect(Math.abs(patch(w).at[2] - wall), name).toBeCloseTo(B.wallFlat, 6);
        expect(t.events.slice(mark).filter((x) => x.e.type === 'patch.throw' && x.e.phase === 'thrown').length, name).toBe(1);
      }
      expect(home(w, t).at(-1)).toBe('seated');
      w.dispose();
    }
  }, 120_000);

  // Taylor, 2026-11-20: "One exception worth preserving is the playful juggling behavior when Patch is thrown almost
  // straight upward." A hand going up is a toss up wherever it is: beside the back wall too, and so is Patch caught
  // in the air there and thrown up again. (For a few hours a hand going up beside a wall was read as a throw at it.)
  test('tossed up beside the back wall it goes up: no splat, and it rises as it does in the open', async () => {
    const rose: number[] = [];
    for (const z of [bench.bench.minZ + 0.6, -1.5]) {
      const { w, t } = await world();
      const from: Vec3 = [-5.5, 1.8, z];
      lift(w, t, from);
      const mark = t.events.length;
      fling(w, t, from, [0, 9, 0], 8);
      const watch = watcher(w, t);
      const y0 = middle(w)[1];
      let top = y0;
      for (let i = 0; i < 40; i++) {
        const s = watch.step();
        expect(s.state, `from z ${z}: in the air`).toBe('fly');
        top = Math.max(top, s.mid[1]);
      }
      expect(t.events.slice(mark).some((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.wall === true), `from z ${z}: no splat`).toBe(false);
      rose.push(top - y0);
      expect(home(w, t).at(-1)).toBe('seated');
      w.dispose();
    }
    expect(rose[0]!, 'beside the wall it rises').toBeGreaterThan(1.2);
    expect(Math.abs(rose[0]! - rose[1]!), `beside the wall ${rose[0]!.toFixed(2)}, in the open ${rose[1]!.toFixed(2)}`).toBeLessThan(0.4);
  }, 120_000);

  // Found by the adoption's builder, 2026-11-20: the hand's LEVEL motion alone was read for a throw at a wall, so a
  // hand coming down 2.5 in a step with 0.23 of sideways in it was a throw at the stool at 14 units/s.
  test('brought down fast to the foot of its stool it is put down: not thrown at the stool, no splat; and the stool is no wall for it to be flat against', async () => {
    const { w, t } = await world();
    const foot = PATCHLAMP.patch.foot;
    w.dispatch({ type: 'drag', id: 'patch', target: [foot[0], 2.5, foot[2] + 0.23] });
    t.run(1);
    const mark = t.events.length;
    w.dispatch({ type: 'drag', id: 'patch', target: foot, end: true });
    const watch = watcher(w, t);
    for (let i = 0; i < 90; i++) expect(watch.step().state, `step ${i}`).not.toBe('wall');
    expect(t.events.slice(mark).some((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.wall === true)).toBe(false);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
    // thrown level and hard at the stool's side from the open bench: it meets it and is bounced off (0.69 tall)
    const again = await world();
    const from: Vec3 = [foot[0] + 2.2, 1.0, -3.46];
    lift(again.w, again.t, from);
    const m2 = again.t.events.length;
    fling(again.w, again.t, from, [-12, 0, 0], 10);
    const w2 = watcher(again.w, again.t);
    for (let i = 0; i < 60; i++) expect(w2.step().state, `thrown at the stool, step ${i}`).not.toBe('wall');
    expect(again.t.events.slice(m2).some((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.wall === true)).toBe(false);
    expect(home(again.w, again.t).at(-1)).toBe('seated');
    again.w.dispose();
  }, 120_000);

  test('a wall met slowly, or glancing, is only the engine\'s bounce: no stick', async () => {
    for (const [name, from, v] of [
      ['slowly', [-5.5, 1.4, -3.4], [0, 0, -3.5]],
      ['glancing', [-7.5, 1.6, -3.6], [11, 0, -3.5]],
    ] as const) {
      const { w, t } = await world();
      lift(w, t, from as Vec3);
      fling(w, t, from as Vec3, v as Vec3, 16);
      const watch = watcher(w, t);
      const mark = t.events.length;
      let nearest = Infinity;
      let turned = false;
      watch.until((s) => {
        if (s.body) nearest = Math.min(nearest, s.mid[2] - AT.bench.minZ);
        if (s.body && s.v[2] > 0.3) turned = true;
        return s.state !== 'fly';
      }, 8);
      expect(nearest, `${name}: it reached the wall`).toBeLessThan(Math.max(...HALF) + 0.1);
      expect(turned, `${name}: the engine turned it back`).toBe(true);
      // (the back wall did not hold it. Glancing off it at 11 it goes on along the bench at 8 and may then meet the
      // end of the board's panel square on, which is a wall met flat and fast, and sticks: that is the other test's)
      const met = t.events.slice(mark).filter((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit' && x.e.what === 'back-wall');
      expect(met.some((x) => x.e.type === 'patch.throw' && x.e.wall), name).toBe(false);
      if (name === 'slowly') expect(watch.samples.some((s) => s.state === 'wall'), name).toBe(false);
      expect(home(w, t).at(-1)).toBe('seated');
      w.dispose();
    }
  }, 120_000);

  test('over an open edge low and slow it catches the edge: eased there from where its body was, with the motion it had (no snap); then the haul, the dust-off, the look, home', async () => {
    const { w, t } = await world();
    const from: Vec3 = [-7.8, 1.0, -1];
    lift(w, t, from);
    fling(w, t, from, [-3, 0, 0], 16);
    const watch = watcher(w, t);
    const got = watch.until((s) => s.state === 'ledge', 3);
    expect(got, 'the ledge').not.toBeNull();
    const S = watch.samples;
    const i = S.length - 1;
    const ledge = patch(w).ledge!;
    expect(ledge.edge).toBe('left');
    expect(patch(w).body).toBeNull();
    // continuous: the step the script takes over it moves as it was moving (the scripted Patch jumped 0.3 of a unit to the edge here)
    expect(S[i]!.speed).toBeGreaterThan(S[i - 1]!.speed * 0.7);
    expect(S[i]!.speed).toBeLessThan(S[i - 1]!.speed * 1.3);
    expect(angle(S[i]!.v, S[i - 1]!.v)).toBeLessThan(35);
    // then it is drawn to the edge over the catch, never more than a fraction of a unit in a step, and is there
    for (let k = 0; k < steps(B.catchEase) + 1; k++) {
      const s = watch.step();
      expect(s.speed / HZ, `the catch, step ${k}`).toBeLessThan(0.12);
      expect(s.at[1]).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(len([patch(w).at[0] - ledge.at[0], patch(w).at[1] - ledge.at[1], patch(w).at[2] - ledge.at[2]])).toBeLessThan(1e-6);
    const states = home(w, t);
    expect(states.slice(0, 5)).toEqual(['ledge', 'haul', 'dust', 'look', 'walk']);
    expect(states.at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  test('over an edge fast it simply falls, under the engine, out of sight; then back up the chute as a body thrown onto the bench by the pad, where it tumbles to rest and gets up', async () => {
    const { w, t } = await world();
    const from: Vec3 = [-4, 1.6, 1.6];
    lift(w, t, from);
    const mark = t.events.length;
    fling(w, t, from, [0, 0, 12], 16);
    const watch = watcher(w, t);
    const gone = watch.until((s) => s.state === 'away', 3);
    expect(gone, 'out of sight').not.toBeNull();
    // it fell as a body: still moving fast and down as it went out of sight, well below the bench top
    const S = watch.samples;
    const last = S[S.length - 2]!;
    expect(last.body).toBe(true);
    expect(last.v[1]).toBeLessThan(-6);
    expect(last.mid[1]).toBeLessThan(-B.outOfSight + 0.4);
    expect(patch(w).body).toBeNull();
    expect(w.motion(BODY)?.mode).toBe('gone');
    // the `away` beat, then out of the chute's mouth, a body again
    const back = watch.until((s) => s.state === 'fly', 2);
    expect(back, 'back up the chute').not.toBeNull();
    expect((watch.samples.length - S.indexOf(gone!) - 1) / HZ).toBeCloseTo(T.away, 1);
    expect(back!.body).toBe(true);
    expect(len([back!.mid[0] - AT.chute.p[0], back!.mid[1] - AT.chute.p[1], back!.mid[2] - AT.chute.p[2]])).toBeLessThan(0.35);
    expect(patch(w).thrown?.chute).toBe(true);
    const phases = t.events.slice(mark).filter((x) => x.e.type === 'patch.throw').map((x) => (x.e as { phase: string }).phase);
    expect(phases).toEqual(['thrown', 'gone', 'chute']);
    // it comes down on the bench and tumbles to rest by the pad, under the engine
    const lies = watch.until((s) => s.state === 'land', 6);
    expect(lies, 'it lies by the pad').not.toBeNull();
    expect(Math.hypot(lies!.at[0] - AT.pad[0], lies!.at[2] - AT.pad[1])).toBeLessThan(1.6);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);
});

describe('recovery: the script takes over from where and how it lies', () => {
  test('come to rest where the visitor cannot see it, it hops to a place in their view when one is near', async () => {
    // (the simulation's own rule for "can the visitor see it": nothing tall between its middle and where they look from)
    const VISITOR: Vec3 = [0.6, 2.4, 14];
    const seen = (p: Vec3): boolean => {
      for (let i = 1; i <= 12; i++) {
        const k = (i / 12) * 0.5;
        if (SOLIDS.some((o) => sphereMeets(o, p[0] + (VISITOR[0] - p[0]) * k, p[1] + 0.45 + (VISITOR[1] - p[1] - 0.45) * k, p[2] + (VISITOR[2] - p[2]) * k, 0.05))) return false;
      }
      return true;
    };
    // behind the board's panel, and behind the storefront: set down there, out of sight
    for (const [x, z, near] of [[-4, -3.5, true], [3, -4.3, true], [-1.5, -3.1, false]] as const) {
      const { w, t } = await world();
      lift(w, t, OPEN, 5);
      const at: Vec3 = [x, bench.bench.top, z];
      expect(seen(at), `${x}, ${z}: out of sight`).toBe(false);
      w.dispatch({ type: 'place', at });
      for (let i = 0; i < steps(5) && !patch(w).lay; i++) t.run(1);
      const lay = patch(w).lay!;
      expect(lay, `${x}, ${z}: it gets up`).toBeTruthy();
      const far = Math.hypot(lay.to[0] - lay.from[0], lay.to[2] - lay.from[2]);
      if (near) {
        expect(seen(lay.to), `${x}, ${z}: it hops into view (${fmt(lay.to)})`).toBe(true);
        expect(far).toBeGreaterThan(0.05);
        expect(far).toBeLessThanOrEqual(PATCH_BODY_TUNING.seenWithin + 0.35);
      } else expect(far, `${x}, ${z}: no place in view within reach: it gets up near where it lies`).toBeLessThan(0.8);
      expect(home(w, t).at(-1)).toBe('seated');
      w.dispose();
    }
  }, 180_000);

  test('it gets up where it lies: the view is given the body\'s last pose, `at` does not jump, and its speed across the takeover is continuous (it was down)', async () => {
    const { w, t } = await world();
    lift(w, t, OPEN);
    fling(w, t, OPEN, [5, 0, 0], 16);
    const watch = watcher(w, t);
    let lastPose = patch(w).body!.pose;
    const got = watch.until((s) => {
      if (patch(w).body) lastPose = patch(w).body!.pose;
      return s.state === 'land';
    }, 8);
    expect(got, 'the get-up').not.toBeNull();
    const S = watch.samples;
    const i = S.length - 1;
    const v = patch(w);
    expect(v.body).toBeNull();
    expect(w.motion(BODY)?.mode).toBe('gone');
    // how it lay: the body's own last pose
    expect(v.lay?.pose).toEqual(lastPose);
    // plainly down when the script took it: slower than a unit a second, and the takeover adds no motion of its own
    expect(S[i - 1]!.speed).toBeLessThan(B.slowLinear + 0.2);
    expect(S[i]!.speed).toBeLessThan(B.slowLinear + 0.2);
    // on the open bench it can stand where it lies: its feet under where its middle was, no hop
    expect(Math.hypot(v.at[0] - lastPose.p[0], v.at[2] - lastPose.p[2])).toBeLessThan(1e-6);
    expect(v.lay!.arc).toBe(0);
    expect(len([v.lay!.to[0] - v.lay!.from[0], v.lay!.to[1] - v.lay!.from[1], v.lay!.to[2] - v.lay!.from[2]])).toBeLessThan(B.hopOver);
    // and no step from here to its stool moves it more than a brisk walk does
    const rest = watch.until((s) => s.state === 'seated', 40);
    expect(rest, 'home').not.toBeNull();
    for (const s of S.slice(i)) expect(s.speed / HZ, s.state).toBeLessThan(0.12);
    w.dispose();
  }, 120_000);

  test('where it lies it cannot stand (on top of the UNDO lever\'s housing): it hops down, a move with a duration along an arc, never through anything', async () => {
    const { w, t } = await world();
    const topY = AT.undo.c[1] + AT.undo.half[1];
    const over: Vec3 = [AT.undo.c[0], topY + 2 * HALF[1] + 0.08, AT.undo.c[2]];
    lift(w, t, over, 40);
    w.dispatch({ type: 'release' });
    const watch = watcher(w, t);
    const got = watch.until((s) => s.state === 'land', 6);
    expect(got, 'the get-up').not.toBeNull();
    const lay = patch(w).lay!;
    // it lay on the housing: its feet start on its top
    expect(lay.from[1]).toBeGreaterThan(topY - 0.05);
    expect(lay.to[1]).toBe(0);
    expect(lay.arc).toBeGreaterThan(0.2);
    const far = Math.hypot(lay.to[0] - lay.from[0], lay.to[2] - lay.from[2]);
    expect(far).toBeGreaterThan(0.3);
    const from = watch.samples.length;
    const down = watch.until((s) => s.state !== 'land', 4);
    const hop = watch.samples.slice(from, -1);
    // a move with a duration: many steps, none a jump, none inside a fixed body, none under the bench top
    expect(hop.length).toBeGreaterThan(steps(B.hop));
    for (const s of hop) {
      expect(s.speed / HZ, 'no jump').toBeLessThan(0.25);
      expect(insideSolid(s.at), 'never inside').toBeNull();
      expect(s.at[1]).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(Math.max(...hop.map((s) => s.at[1]))).toBeGreaterThan(topY);
    expect(len([down!.at[0] - lay.to[0], down!.at[1] - lay.to[1], down!.at[2] - lay.to[2]])).toBeLessThan(1e-6);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  /** From the first touch of the bench (or the release, for a set-down) to its first step home, and what it did meanwhile. */
  async function bit(from: Vec3, v: Vec3 | null): Promise<{ toStep: number; states: PatchState[]; hard: number }> {
    const { w, t } = await world();
    lift(w, t, from, 30);
    const mark = t.events.length;
    if (v) fling(w, t, from, v, 16);
    else {
      w.dispatch({ type: 'release' });
      t.run(1);
    }
    const watch = watcher(w, t);
    let hard = -1;
    const stepped = watch.until((s) => {
      if (patch(w).lay) hard = patch(w).lay!.hard;
      return s.state === 'walk' && s.speed > 0.5;
    }, 20);
    expect(stepped, 'a step home').not.toBeNull();
    const landed = t.events.slice(mark).find((x) => x.e.type === 'patch.throw' && x.e.phase === 'landed');
    const t0 = landed ? landed.step : watch.samples[0]!.step - 1;
    const states: PatchState[] = [];
    for (const s of watch.samples) if (states.at(-1) !== s.state) states.push(s.state);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
    return { toStep: (stepped!.step - t0) / HZ, states, hard };
  }

  // The scripted Patch held 2.9 to 4.5 s after every landing before its first step. Here the whole bit, its tumble
  // under the engine included, is scaled by how hard it came down. Printed for the hand-in.
  test('the beats before its first step home are scaled by how hard it came down: a set-down almost none, a throw a shake of the head, a big fall the full bit', async () => {
    const set = await bit([-6.5, 0.72, -2], null);
    const toss = await bit(OPEN, [5, 0, 0]);
    const thrown = await bit(OPEN, [10, 0, 0]);
    const fall = await bit([-6.5, 6.5, -2], null);
    console.log(
      [['set down', set], ['tossed at 5', toss], ['thrown at 10', thrown], ['dropped from 6', fall]]
        .map(([n, r]) => `${n}: ${(r as typeof set).toStep.toFixed(1)} s from touching down to its first step (how hard ${(r as typeof set).hard.toFixed(2)}): ${(r as typeof set).states.join(' ')}`)
        .join('\n'),
    );
    // set down: on its feet and off within a second and a bit of being let go; no shake, no look
    expect(set.toStep).toBeLessThan(1.3);
    expect(set.states).toEqual(['fly', 'land', 'walk']);
    expect(set.hard).toBeLessThan(0.1);
    // a toss: it tumbles, gets up and goes
    expect(toss.toStep).toBeLessThan(2.6);
    expect(toss.states).not.toContain('look');
    // a throw across the bench: the shake of the head, no long look
    expect(thrown.states).toContain('shake');
    expect(thrown.toStep).toBeGreaterThan(toss.toStep - 0.3);
    expect(thrown.toStep).toBeLessThan(3.0);
    // a big fall: the full bit (the shake, the look), no longer than the scripted one was
    expect(fall.states.slice(0, 5)).toEqual(['fly', 'land', 'shake', 'look', 'walk']);
    expect(fall.hard).toBeGreaterThan(0.85);
    expect(fall.toStep).toBeGreaterThan(2.4);
    expect(fall.toStep).toBeLessThan(4.5);
    expect(fall.toStep).toBeGreaterThan(thrown.toStep);
    expect(set.toStep).toBeLessThan(toss.toStep);
  }, 240_000);

  test('let go onto the running belt: it is carried along it as it lies, then gets up and hops off; on the stopped belt it lies where it fell', async () => {
    for (const running of [true, false]) {
      const { w, t } = await world();
      if (!running) {
        w.dispatch({ type: 'press', id: 'belt-lever' });
        t.run(30);
      }
      const surface = (w.machine('belt') as { surface: number }).surface;
      if (running) expect(surface).toBeGreaterThan(0.5);
      else expect(Math.abs(surface)).toBeLessThan(0.05);
      const over: Vec3 = [-3, AT.belt.c[1] + AT.belt.half[1] + 2 * HALF[1] + 0.15, AT.belt.c[2]];
      lift(w, t, over, 40);
      w.dispatch({ type: 'release' });
      const watch = watcher(w, t);
      const got = watch.until((s) => s.state !== 'fly', 6);
      expect(got?.state, 'it gets up').toBe('land');
      const S = watch.samples.slice(0, -1);
      const down = S.findIndex((s) => s.mid[1] < AT.belt.c[1] + AT.belt.half[1] + Math.max(...HALF) + 0.05);
      const carried = S.at(-1)!.mid[0] - S[down]!.mid[0];
      if (running) {
        // along the belt, at about its surface's speed by the time the script takes over
        expect(carried).toBeGreaterThan(0.15);
        expect(S.at(-1)!.v[0]).toBeGreaterThan(surface * 0.6);
        expect(S.at(-1)!.v[0]).toBeLessThan(surface * 1.4);
      } else expect(Math.abs(carried)).toBeLessThan(0.25);
      // it lay on the bed: it hops off it to the bench
      const lay = patch(w).lay!;
      expect(lay.from[1]).toBeCloseTo(AT.belt.c[1] + AT.belt.half[1], 1);
      expect(lay.to[1]).toBe(0);
      expect(lay.arc).toBeGreaterThan(0);
      expect(home(w, t).at(-1)).toBe('seated');
      w.dispose();
    }
  }, 120_000);

  test('lifted off its stool and let go there: it settles on its seat and is home, without a walk', async () => {
    const { w, t } = await world();
    const seat = patch(w).at;
    w.dispatch({ type: 'grab', id: 'patch', grip: [seat[0], seat[1] + 0.5, seat[2]] });
    t.run(3);
    w.dispatch({ type: 'release' });
    const states = home(w, t, 10);
    expect(states).toEqual(['held', 'fly', 'land', 'seated']);
    expect(patch(w).at).toEqual(seat);
    expect(w.motion(BODY)?.mode).toBe('gone');
    w.dispose();
  });
});

describe('it can be taken hold of again at any moment, and the grab is continuous', () => {
  const moments: [string, (s: Sample, w: World) => boolean, Vec3, Vec3][] = [
    ['in the air, rising', (s) => s.state === 'fly' && s.v[1] > 2, OPEN, [3, 9, 0]],
    ['in the air, falling', (s) => s.state === 'fly' && s.v[1] < -3, OPEN, [3, 9, 0]],
    ['tumbling on the bench', (s, w) => s.state === 'fly' && s.mid[1] < 0.6 && s.speed > 1 && s.speed < 5 && w.step > 0, OPEN, [9, 0, 0]],
    // (slow enough to be "plainly down": the script takes over a few steps on)
    ['lying, just before it gets up', (s) => s.state === 'fly' && s.speed < 0.8 && s.mid[1] < 0.5, OPEN, [6, 0, 0]],
    ['getting up', (s, w) => s.state === 'land' && patch(w).stateTime > 0.1, OPEN, [9, 0, 0]],
    ['shaking its head', (s) => s.state === 'shake', OPEN, [10, 0, 0]],
    ['stuck to the wall', (s) => s.state === 'wall', [-5.5, 2.2, -1.2], [0, 0, -10]],
    // (a stated velocity gets no loft: let go near enough the left end that it goes over it before it is down)
    ['hanging from the edge', (s, w) => s.state === 'ledge' && patch(w).stateTime > 0.5, [-8.5, 1.0, -1], [-3, 0, 0]],
    ['walking home', (s, w) => s.state === 'walk' && s.speed > 0.5 && patch(w).stateTime > 1, OPEN, [6, 0, 0]],
    ['climbing its stool', (s, w) => s.state === 'climb' && patch(w).stateTime > 0.3, [2.6, 1.0, -2.2], [0, 0, 0]],
  ];
  for (const [name, when, from, v] of moments) {
    test(`${name}: taken hold of where it is, carried on, and it still gets home`, async () => {
      const { w, t } = await world();
      lift(w, t, from);
      if (len(v) > 0) {
        w.dispatch({ type: 'release', velocity: v });
        t.run(1);
      } else {
        w.dispatch({ type: 'release' });
        t.run(1);
      }
      const watch = watcher(w, t);
      const at = watch.until((s) => when(s, w), 30);
      expect(at, `the moment (${watch.samples.map((s) => s.state).filter((s, i, a) => a[i - 1] !== s).join(' ')})`).not.toBeNull();
      const was = middle(w);
      const loose = patch(w).body !== null && patch(w).body !== undefined;
      const moving = at!.speed;
      w.dispatch({ type: 'grab', id: 'patch', grip: patch(w).at });
      const s1 = watch.step();
      expect(w.holding()).toEqual({ kind: 'unit', id: 'patch', body: BODY });
      expect(patch(w).state).toBe('held');
      expect(w.motion(BODY)?.mode).toBe('held');
      // where it was: loose, its body simply becomes held (in that step it moves by its own motion, and by the hand's
      // pull as its scruff is taken and it swings under it: the carry gains at most 13 units/s a step, a fifth of a
      // unit); from the script its body comes into the world where Patch is drawn (within its own size)
      const moved = len([s1.mid[0] - was[0], s1.mid[1] - was[1], s1.mid[2] - was[2]]);
      expect(moved, 'no relocation').toBeLessThan(loose ? moving / HZ + 0.24 : 0.45);
      expect(insideSolid(s1.mid, 0)).toBeNull();
      // carried on a little and let go: home
      const p = patch(w).at;
      for (let i = 1; i <= 20; i++) {
        w.dispatch({ type: 'carry', target: [p[0] + (i / 20) * 0.6 * (p[0] < 0 ? 1 : -1), Math.max(p[1], 1.2) + (i / 20) * 0.5, p[2]] });
        watch.step();
        expect(insideSolid(middle(w), 0)).toBeNull();
      }
      w.dispatch({ type: 'release' });
      expect(home(w, t).at(-1)).toBe('seated');
      expect(w.motion(BODY)?.mode).toBe('gone');
      w.dispose();
    }, 120_000);
  }

  // Taylor, 2026-11-20: "One exception worth preserving is the playful juggling behavior when Patch is thrown almost
  // straight upward."
  test('juggled: thrown up, caught near the top, thrown up again from there, three times; it never touches the bench, and no catch moves it', async () => {
    const { w, t } = await world();
    const at: Vec3 = [-6, 1.6, -1];
    lift(w, t, at, 30);
    const watch = watcher(w, t);
    let lowest = Infinity;
    const mark = t.events.length;
    for (let n = 0; n < 3; n++) {
      // the hand comes down with it to where it started, then a flick up: it rises fast and lets go
      const top = patch(w).at;
      for (let i = 1; i <= 14 && n > 0; i++) {
        w.dispatch({ type: 'carry', target: [top[0], top[1] + ((at[1] - top[1]) * i) / 14, top[2]] });
        watch.step();
      }
      let hand = patch(w).at;
      for (let i = 0; i < 6; i++) {
        hand = [hand[0], hand[1] + 9 / HZ, hand[2]];
        w.dispatch({ type: 'carry', target: hand });
        watch.step();
      }
      w.dispatch({ type: 'release' });
      const up = watch.step();
      expect(up.state).toBe('fly');
      expect(up.v[1], `throw ${n}`).toBeGreaterThan(5);
      // caught as it floats at the top
      const apex = watch.until((s) => (patch(w).body?.float ?? 0) > 0.6 || s.state !== 'fly', 3);
      expect(apex?.state, `throw ${n}: at the top`).toBe('fly');
      expect(patch(w).thrown?.top).toBe(true);
      const was = middle(w);
      w.dispatch({ type: 'grab', id: 'patch', grip: patch(w).at });
      const caught = watch.step();
      expect(w.holding()?.id).toBe('patch');
      expect(len([caught.mid[0] - was[0], caught.mid[1] - was[1], caught.mid[2] - was[2]]), `catch ${n}: where it was`).toBeLessThan(0.1);
      for (const s of watch.samples) lowest = Math.min(lowest, s.mid[1]);
    }
    expect(lowest).toBeGreaterThan(1);
    expect(t.events.slice(mark).filter((x) => x.e.type === 'patch.throw' && (x.e.phase === 'landed' || x.e.phase === 'hit'))).toEqual([]);
    w.dispatch({ type: 'release' });
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  test('out of sight (thrown off the bench) there is nothing to take hold of; back in the air from the chute there is', async () => {
    const { w, t } = await world();
    lift(w, t, [-4, 1.6, 1.6]);
    fling(w, t, [-4, 1.6, 1.6], [0, 0, 12], 16);
    const watch = watcher(w, t);
    expect(watch.until((s) => s.state === 'away', 3)).not.toBeNull();
    w.dispatch({ type: 'grab', id: 'patch', grip: patch(w).at });
    watch.step();
    expect(w.holding()).toBeNull();
    expect(watch.until((s) => s.state === 'fly', 2)).not.toBeNull();
    watch.step();
    w.dispatch({ type: 'grab', id: 'patch', grip: patch(w).at });
    watch.step();
    expect(w.holding()?.id).toBe('patch');
    w.dispatch({ type: 'release' });
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);

  test('a hundred grabs and releases in a row, wherever it is: it ends on its stool', async () => {
    const { w, t } = await world();
    let a = 12345;
    const rnd = (): number => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    let taken = 0;
    for (let n = 0; n < 100; n++) {
      w.dispatch({ type: 'grab', id: 'patch', grip: patch(w).at });
      t.run(1);
      if (w.holding()?.id === 'patch') {
        taken += 1;
        const p = patch(w).at;
        const to: Vec3 = [Math.max(-8, Math.min(8, p[0] + (rnd() - 0.5) * 3)), 1 + rnd() * 2.5, Math.max(-4, Math.min(4, p[2] + (rnd() - 0.5) * 3))];
        const k = 2 + Math.floor(rnd() * 10);
        for (let i = 1; i <= k; i++) {
          w.dispatch({ type: 'carry', target: [p[0] + ((to[0] - p[0]) * i) / k, p[1] + ((to[1] - p[1]) * i) / k, p[2] + ((to[2] - p[2]) * i) / k] });
          t.run(1);
        }
        w.dispatch({ type: 'release' });
      }
      t.run(1 + Math.floor(rnd() * 45));
      expect(patch(w).at.every(Number.isFinite)).toBe(true);
    }
    expect(taken).toBeGreaterThan(90);
    expect(home(w, t, 60).at(-1)).toBe('seated');
    expect(w.motion(BODY)?.mode).toBe('gone');
    expect(w.holding()).toBeNull();
    w.dispose();
  }, 240_000);
});

describe('from every awkward place it gets home', () => {
  // Taylor, 2026-11-20: "I don't want a physics simulation that occasionally leaves Patch trapped behind a machine or
  // unable to return to his stool." Every fixed body on the bench: let go on top of it, and pressed against each of
  // its four sides (behind it, between it and its neighbour, in its corner with the wall); and the bench's four
  // corners. One bench, one after another, so what an earlier one knocked about is in the way of the next.
  test('let go on top of every fixed body, against every side of it, and in every corner of the bench: on its stool each time, never inside anything on the way', async () => {
    const { w, t } = await world();
    const b = AT.bench;
    const places: { name: string; hand: Vec3 }[] = [];
    for (const o of SOLIDS) {
      const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      places.push({ name: `on ${o.id}`, hand: [o.x, o.y1 + 2 * HALF[1] + 0.12, o.z] });
      for (const [lx, lz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        // just off that side, a hand's height up (or the body's own height up its face, for a low one)
        const d = (lx !== 0 ? o.hx : o.hz) + 0.2;
        const x = o.x + c * lx * d + sn * lz * d, z = o.z - sn * lx * d + c * lz * d;
        if (x < b.minX + 0.2 || x > b.maxX - 0.2 || z < b.minZ + 0.2 || z > b.maxZ - 0.2) continue;
        places.push({ name: `against ${o.id} (${lx},${lz})`, hand: [x, Math.min(o.y1, 0.5) + 2 * HALF[1], z] });
      }
    }
    for (const [x, z] of [[b.minX + 0.3, b.minZ + 0.3], [b.maxX - 0.3, b.minZ + 0.3], [b.minX + 0.3, b.maxZ - 0.3], [b.maxX - 0.3, b.maxZ - 0.3]] as const) places.push({ name: `corner (${x}, ${z})`, hand: [x, 1.1, z] });
    expect(places.length).toBeGreaterThan(100);
    const took: { name: string; s: number; lay: string }[] = [];
    for (const pl of places) {
      lift(w, t, pl.hand, 12);
      w.dispatch({ type: 'release' });
      const from = w.step;
      let lay = '-';
      let seated = false;
      for (let i = 0; i < 45 * HZ && !seated; i++) {
        t.run(1);
        const v = patch(w);
        if (v.lay) lay = `(${fmt(v.lay.pose.p)}) > (${fmt(v.lay.to)})`;
        if (v.state !== 'held' && v.state !== 'fly' && v.state !== 'away') {
          expect(v.at[1], `${pl.name}: below the bench top in ${v.state}`).toBeGreaterThanOrEqual(-1e-6);
          const inside = insideSolid(v.at);
          if (inside && !(inside === 'stool' && v.state === 'climb') && !(inside === 'belt-bed' && v.state === 'cross')) expect.fail(`${pl.name}: inside ${inside} in ${v.state} at (${fmt(v.at)})`);
        }
        seated = v.state === 'seated';
      }
      expect(seated, `${pl.name}: on its stool (${patch(w).state} at ${fmt(patch(w).at)}; lay ${lay})`).toBe(true);
      took.push({ name: pl.name, s: (w.step - from) / HZ, lay });
    }
    took.sort((x, y) => y.s - x.s);
    console.log(`${places.length} places; the slowest:\n${took.slice(0, 6).map((x) => `  ${x.s.toFixed(1)} s  ${x.name}: lay ${x.lay}`).join('\n')}`);
    w.dispose();
  }, 600_000);
});

describe('where the scripted Patch does not get home, and this one does', () => {
  // Found by the test above and by the soak (2026-11-20); both are true of the scripted Patch on `bench` today.
  // (1) Let go past the right end by the storefront, its ledge catch hauls it up into the slot between the storefront
  // and the pallets, which it cannot walk out of: it stands there for good.
  test('past the right end by the storefront: no catch where the haul would stand it shut in; it falls, comes back by the chute, and is on its stool', async () => {
    const { w, t } = await world();
    const hand: Vec3 = [AT.bench.maxX + 0.3, 0.8 + HALF[1], -2.7];
    lift(w, t, hand, 20);
    w.dispatch({ type: 'release' });
    const states = home(w, t);
    expect(states).not.toContain('ledge');
    expect(states.slice(0, 4)).toEqual(['held', 'fly', 'away', 'fly']);
    expect(states.at(-1)).toBe('seated');
    // (and the scripted Patch, let go the same: still standing in the slot a minute later)
    const s = await world(SCRIPT);
    lift(s.w, s.t, [hand[0], 0.8, hand[2]], 20);
    s.w.dispatch({ type: 'release' });
    const old = home(s.w, s.t, 60);
    expect(old).toContain('ledge');
    expect(old.at(-1)).toBe('walk');
    s.w.dispose();
    w.dispose();
  }, 120_000);

  // (2) Its walk home waits for whatever of the crew stands in its way, for as long as it stands there: at the belt
  // with Fetch stood where it would step down (the soak's seed 543: 45 s and counting), or at its own stool with Fetch
  // on the spot. Here the visitor holds Fetch on that spot, so it is certain. The walk is the scripted Patch's still;
  // this Patch is watched on it, and stood in one place for `stuck` seconds it hops on toward its stool.
  for (const scene of [benchBody, SCRIPT]) {
    const body = scene === benchBody;
    test(`the visitor holds Fetch on the spot at the foot of Patch's stool: ${body ? 'it waits a while, then hops onto the spot and climbs up' : 'the scripted Patch waits for as long as Fetch is held there'}`, async () => {
      const { w, t } = await world(scene);
      // Patch thrown down the bench, so the hand is free while it tumbles and comes back
      lift(w, t, [-1, 1.6, -1.5]);
      w.dispatch({ type: 'release', velocity: [-7, 2, 0] });
      t.run(2);
      // Fetch taken and held over the foot of the stool
      const foot = patch(w).foot;
      const f0 = w.motion('fetch')!.pose.p;
      w.dispatch({ type: 'grab', id: 'fetch', grip: f0 });
      t.run(1);
      expect(w.holding()?.id).toBe('fetch');
      const over: Vec3 = [foot[0], 1.3, foot[2]];
      const watch = watcher(w, t);
      let hopped: Sample | null = null;
      let seated = false;
      for (let i = 0; i < 40 * HZ && !seated; i++) {
        const k = Math.min(1, i / 50);
        w.dispatch({ type: 'carry', target: [f0[0] + (over[0] - f0[0]) * k, over[1] + 1.2 * Math.sin(Math.PI * k), f0[2] + (over[2] - f0[2]) * k] });
        const s = watch.step();
        const lay = patch(w).lay;
        if (!hopped && s.state === 'land' && lay && lay.rise === 0 && lay.arc > 0) hopped = s;
        seated = s.state === 'seated';
      }
      expect(w.holding()?.id, 'Fetch is still in the hand').toBe('fetch');
      const S = watch.samples;
      // it came back and stood waiting, a unit or so short of its stool
      const waited = S.filter((s) => s.state === 'walk' && s.speed < 0.05 && Math.hypot(s.at[0] - foot[0], s.at[2] - foot[2]) < 2).length / HZ;
      if (!body) {
        expect(seated).toBe(false);
        expect(S.at(-1)!.state).toBe('walk');
        expect(waited).toBeGreaterThan(20);
      } else {
        expect(waited).toBeGreaterThan(B.stuck - 1);
        expect(waited).toBeLessThan(B.stuck + 2);
        expect(hopped, 'the hop').not.toBeNull();
        // the hop: onto the foot of its stool, a move with a duration, then the climb
        expect(patch(w).foot).toEqual(foot);
        const from = S.indexOf(hopped!);
        const hop = S.slice(from).filter((s, i, a) => s.state === 'land' && (i === 0 || a[i - 1]!.state === 'land'));
        expect(hop.length).toBeGreaterThan(steps(B.hop) - 2);
        for (const s of hop) expect(s.speed / HZ, 'no jump').toBeLessThan(0.3);
        expect(seated, `on its stool (${S.at(-1)!.state})`).toBe(true);
      }
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      w.dispose();
    }, 120_000);
  }
});

describe('its work, and the other ways of letting go', () => {
  test('lifted from a job and thrown: the job waits, it gets home, carries the job on and answers it', async () => {
    const { w, t } = await world();
    const job = send(w, t, 'make the sign red');
    // (the stool has rolled to that line's jack; it is at the drawer or at work there)
    for (let i = 0; i < 6 * HZ && patch(w).state !== 'work'; i++) t.run(1);
    expect(patch(w).state).toBe('work');
    const sat = patch(w).at;
    expect(Math.abs(sat[0] - AT.stool.c[0])).toBeGreaterThan(1);
    // lifted where it sits (no stool's body stands there: its body is simply in the hand, in the air)
    w.dispatch({ type: 'grab', id: 'patch', grip: [sat[0], sat[1] + 0.5, sat[2]] });
    t.run(1);
    expect(w.holding()?.id).toBe('patch');
    expect(Math.hypot(patch(w).body!.pose.p[0] - sat[0], patch(w).body!.pose.p[2] - sat[2])).toBeLessThan(0.05);
    for (let i = 1; i <= 30; i++) {
      w.dispatch({ type: 'carry', target: [sat[0] - i * 0.05, 2.2, sat[2] + i * 0.06] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [-6, 2, 3] });
    t.run(1);
    expect(patch(w).state).toBe('fly');
    expect(answer(t, job, 40).e.type).toBe('line.reply');
    expect(home(w, t).at(-1)).toBe('seated');
    expect(w.motion(BODY)?.mode).toBe('gone');
    w.dispose();
  }, 120_000);

  test('put down with a tap (the place intent): its body is set down at the place, still, and it gets up there and goes home', async () => {
    const { w, t } = await world();
    lift(w, t, OPEN);
    const to: Vec3 = [-3, bench.bench.top, 1];
    const mark = t.events.length;
    w.dispatch({ type: 'place', at: to });
    const watch = watcher(w, t);
    const s = watch.step();
    expect(w.holding()).toBeNull();
    // stood at the place: its bottom on it, upright, still (a step on: the hair it was put down from)
    const m = w.motion(BODY)!;
    expect(m.mode).toBe('free');
    expect(Math.hypot(m.pose.p[0] - to[0], m.pose.p[2] - to[2])).toBeLessThan(0.05);
    expect(Math.abs(m.pose.p[1] - HALF[1] - to[1])).toBeLessThan(0.05);
    expect(1 - 2 * (m.pose.q[0] ** 2 + m.pose.q[2] ** 2)).toBeGreaterThan(0.999);
    expect(s.state).toBe('fly');
    // a set-down, not a throw: no sound of one; it gets up within a couple of tenths of where it was put
    const up = watch.until((x) => x.state !== 'fly', 3);
    expect(up?.state).toBe('land');
    expect(Math.hypot(up!.at[0] - to[0], up!.at[2] - to[2])).toBeLessThan(0.3);
    expect(t.events.slice(mark).some((x) => x.e.type === 'patch.throw' && x.e.phase === 'thrown')).toBe(false);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 60_000);

  // (The world's grab is the only thing that brings the body into the hand. A bare `drag`, as the older tests send,
  // has none: let go, it is thrown from the hand as a body with the velocity the drag states.)
  test('a bare drag, not through the hand: let go, it is a body thrown from there, and it goes home', async () => {
    const { w, t } = await world();
    const seat = patch(w).at;
    for (let i = 0; i <= 30; i++) {
      w.dispatch({ type: 'drag', id: 'patch', target: [seat[0] + ((-4 - seat[0]) * i) / 30, 2.4, seat[2] + ((-1 - seat[2]) * i) / 30] });
      t.run(1);
    }
    expect(patch(w).state).toBe('held');
    expect(len([patch(w).at[0] - -4, patch(w).at[1] - 2.4, patch(w).at[2] - -1])).toBeLessThan(1e-9);
    w.dispatch({ type: 'drag', id: 'patch', target: [-4, 2.4, -1], end: true, velocity: [5, 1, 0] });
    t.run(1);
    expect(patch(w).state).toBe('fly');
    expect(w.motion(BODY)?.mode).toBe('free');
    expect(vel(w)[0]).toBeGreaterThan(4.5);
    expect(Math.hypot(patch(w).at[0] - -4, patch(w).at[2] - -1)).toBeLessThan(0.2);
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 60_000);
});

describe('the Button, the reset and the lever', () => {
  // Decided: while a rung plays Patch's script is frozen, as all the crew's is; its body, if it is in the air, is one
  // more loose body. It lands and lies where the engine puts it, is rewound with everything else, and at the end is
  // back in the air where it was at the press, with the motion it had. Then the throw carries on.
  test('the Button pressed while it flies: its body plays the rung as a loose body, is rewound, and is back in the air where it was, going as it was; then it lands and goes home', async () => {
    const { w, t } = await world();
    const before = w.durable();
    lift(w, t, OPEN);
    w.dispatch({ type: 'release', velocity: [2, 9, 0] });
    t.run(8);
    const at = w.motion(BODY)!.pose;
    const going = vel(w);
    w.dispatch({ type: 'press', id: 'button' });
    t.run(1);
    expect(w.bracketed).toBe(true);
    let low = Infinity;
    let rungSteps = 0;
    while (w.bracketed && rungSteps < 30 * HZ) {
      t.run(1);
      rungSteps += 1;
      const v = patch(w);
      if (!w.bracketed) break;
      // through the rung it is where its body is (the view can draw it), and its script does nothing
      expect(v.state).toBe('fly');
      expect(v.body?.pose).toEqual(w.motion(BODY)!.pose);
      low = Math.min(low, v.body!.pose.p[1]);
    }
    expect(w.bracketed).toBe(false);
    expect(rungSteps).toBeGreaterThan(30);
    // it came down during the rung, as a loose body does
    expect(low).toBeLessThan(0.6);
    // and is back where it was at the press, in the air, going as it was
    const m = w.motion(BODY)!;
    expect(m.mode).toBe('free');
    expect(len([m.pose.p[0] - at.p[0], m.pose.p[1] - at.p[1], m.pose.p[2] - at.p[2]])).toBeLessThan(0.02);
    expect(patch(w).state).toBe('fly');
    t.run(1);
    const after = vel(w);
    expect(len([after[0] - going[0], after[1] - going[1], after[2] - going[2]])).toBeLessThan(1);
    expect(home(w, t).at(-1)).toBe('seated');
    t.run(steps(7));
    // nothing durable came of it (the rung commits nothing; the throw knocked nothing; the crew's own work is `crew`'s)
    expect(w.undoStack()).toEqual([]);
    expect(w.durable().filter((d) => /^t\d+$/.test(String(d.writer)))).toEqual([]);
    expect(w.durable().filter((d) => d.target === BODY)).toEqual(before.filter((d) => d.target === BODY));
    w.dispose();
  }, 120_000);

  test('reset while it flies: on its stool at once, its body out of the world, and it can be lifted again', async () => {
    const { w, t } = await world();
    const before = w.durable();
    lift(w, t, OPEN);
    w.dispatch({ type: 'release', velocity: [8, 4, 0] });
    t.run(10);
    expect(patch(w).state).toBe('fly');
    w.dispatch({ type: 'reset' });
    t.run(1);
    expect(patch(w).state).toBe('seated');
    expect(patch(w).body).toBeNull();
    expect(w.motion(BODY)?.mode).toBe('gone');
    expect(w.durable().filter((d) => d.target === BODY)).toEqual(before.filter((d) => d.target === BODY));
    // and reset while it is in the hand
    lift(w, t, OPEN);
    w.dispatch({ type: 'reset' });
    t.run(1);
    expect(patch(w).state).toBe('seated');
    expect(w.holding()).toBeNull();
    expect(w.motion(BODY)?.mode).toBe('gone');
    lift(w, t, OPEN);
    w.dispatch({ type: 'release', velocity: [5, 0, 0] });
    expect(home(w, t).at(-1)).toBe('seated');
    w.dispose();
  }, 120_000);
});
