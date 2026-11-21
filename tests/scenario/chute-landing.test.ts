// A crate thrown back up the chute lands like a thrown thing (Taylor, 2026-11-20: "crates abruptly stopping during
// returns"). Before, the scripted arc ended exactly on the pad and the crate was handed to physics at a standstill:
// 6.4 units/s to 0.3 in one step, no bounce. Now the dock hands it to physics the step before touchdown, moving as the
// arc moves, and the engine lands it: a small bounce, a settle by its material. The arc's last stretch is steep and
// slow across so that it still rests where Fetch takes it: measured here over many returns of each size with the
// seeded world (`CHUTE_LANDINGS`, default 40 a size; the hand-in measured 200), and Fetch's real pickup of each size.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, onBelt, putOn, tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { qangle, yawOf } from '../../src/workshop/sim/math.ts';
import type { Id, Pose, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { SimContext, Unit } from '../../src/workshop/sim/context.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const N = Number(process.env.CHUTE_LANDINGS ?? 40);
const G = 16;
const PAD = AT.pad;
const PAD_RADIUS = 0.45;
const STAND = FULL_BENCH.runner.stands!.pad as readonly [number, number];
const FETCH_BODY = Math.hypot(0.3 * 1.5, 0.26 * 1.5); // its body turning on the spot at the stand
/**
 * THE BOUNDS. At the hand-over to physics its velocity changes in the step by gravity's step (16/60 = 0.27) and a
 * hair of Rapier's integration (0.05): the arc goes on. The landing itself is a real contact (any change allowed), but
 * it must look like one: it comes off the pad again (a bounce: some step after touchdown moving up) unless the
 * material absorbs it, and it never stops dead from the arc's speed in one step before it has touched (its bottom
 * more than 0.02 above the pad).
 */
const HANDOVER_DV = G / HZ + 0.05;

/** The far corner of a turned box from a point, and its nearest distance to it (on the bench). */
function nearestTo(pose: Pose, half: Vec3, px: number, pz: number): number {
  const a = yawOf(pose.q);
  const dx = px - pose.p[0];
  const dz = pz - pose.p[2];
  const lx = Math.cos(a) * dx - Math.sin(a) * dz;
  const lz = Math.sin(a) * dx + Math.cos(a) * dz;
  return Math.hypot(Math.max(0, Math.abs(lx) - half[0]), Math.max(0, Math.abs(lz) - half[2]));
}

/** A stand-in unit that sends a part up the return chute when asked (as an edge would). */
function sender(): { unit: (ctx: SimContext) => Unit; send: (id: Id) => void } {
  let due: Id | null = null;
  return {
    send: (id) => (due = id),
    unit: (ctx) => ({
      id: 'test-sender',
      pre() {
        if (due) ctx.toChute(due, 'system');
        due = null;
      },
    }),
  };
}

interface Landing {
  rest: Pose;
  handoverDv: number;
  arrive: number;
  bounced: boolean;
  deadStop: boolean;
  settle: number;
  up: number;
}

/** Send `id` up the chute and watch it land; null if it never came back onto the pad. */
function land(w: World, s: ReturnType<typeof sender>, id: Id): Landing | null {
  s.send(id);
  const half = w.halfExtents(id)!;
  let prev: Vec3 | null = null;
  let prevV: Vec3 | null = null;
  let prevMode = '';
  let released = -1;
  const r: Landing = { rest: w.motion(id)!.pose, handoverDv: 0, arrive: 0, bounced: false, deadStop: false, settle: 0, up: 1 };
  let touched = false;
  let still = 0;
  for (let i = 0; i < steps(8); i++) {
    w.advance();
    const ev: SimEvent[] = w.drainEvents();
    const m = w.motion(id)!;
    const p = m.pose.p;
    const v: Vec3 | null = prev ? [(p[0] - prev[0]) * HZ, (p[1] - prev[1]) * HZ, (p[2] - prev[2]) * HZ] : null;
    if (v && prevV && m.mode !== 'chute' && prevMode !== 'chute') {
      const dv = Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]);
      if (prevMode === 'machine' && m.mode === 'free') {
        released = i;
        r.handoverDv = dv;
        r.arrive = Math.hypot(...prevV);
      }
      if (released >= 0) {
        const bottom = p[1] - half[1];
        if (bottom < 0.02) touched = true;
        if (!touched && Math.hypot(...v) < 0.5 && Math.hypot(...prevV) > 3) r.deadStop = true;
        if (touched && v[1] > 0.05) r.bounced = true;
      }
    }
    prev = p;
    prevV = v;
    prevMode = m.mode;
    // at rest: still (its centre moving under 0.02 u/s, turning under 0.1 rad/s (qangle's own floor is 0.03)) for a third of a second after it touched
    still = touched && v && Math.hypot(...v) < 0.02 && qangle(m.pose.q, m.prev.q) * HZ < 0.1 ? still + 1 : 0;
    void ev;
    if (still >= 20 && m.mode === 'free') {
      r.rest = m.pose;
      r.settle = (i - released) / HZ;
      const q = m.pose.q;
      r.up = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
      return r;
    }
  }
  if (process.env.CHUTE_DEBUG) console.log('no landing:', id, w.motion(id)!.mode, w.motion(id)!.pose.p, 'released', released, 'touched', touched, 'still', still, 'v', prevV, 'ang', qangle(w.motion(id)!.pose.q, w.motion(id)!.prev.q), 'fetch', w.crew('fetch')!.state, w.crew('fetch')!.carrying);
  return null;
}

describe('a crate thrown back up the chute lands on the pad and settles there by itself', () => {
  for (const id of ['crate-3', 'crate-2', 'crate-1']) {
    test(`${id}: ${N} returns: it arrives moving, bounces and settles, and rests where Fetch takes it every time`, async () => {
      const s = sender();
      const w = await benchWorld(`chute-landing-${id}`, { units: [s.unit] });
      const size = w.part(id)!.size;
      const half = w.halfExtents(id)!;
      const out: Landing[] = [];
      for (let k = 0; k < N; k++) {
        const l = land(w, s, id);
        expect(l, `return ${k} came back onto the pad and rested`).not.toBeNull();
        out.push(l!);
      }
      const dPad = out.map((l) => Math.hypot(l.rest.p[0] - PAD[0], l.rest.p[2] - PAD[1]));
      const gaps = out.map((l) => nearestTo(l.rest, half, STAND[0], STAND[1]) - FETCH_BODY);
      const yaws = out.map((l) => Math.abs(Math.atan2(Math.sin(4 * yawOf(l.rest.q)), Math.cos(4 * yawOf(l.rest.q))) / 4));
      const xs = out.map((l) => l.rest.p[0]);
      const zs = out.map((l) => l.rest.p[2]);
      const sd = (a: number[]): number => {
        const m = a.reduce((x, y) => x + y, 0) / a.length;
        return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
      };
      const max = (a: number[]): number => Math.max(...a);
      const min = (a: number[]): number => Math.min(...a);
      console.log(
        `${id} (${size}) x${N}: arrives at ${min(out.map((l) => l.arrive)).toFixed(1)}-${max(out.map((l) => l.arrive)).toFixed(1)} u/s, handover |dv| ≤ ${max(out.map((l) => l.handoverDv)).toFixed(3)}; ` +
          `bounced ${out.filter((l) => l.bounced).length}/${N}; at rest after ${min(out.map((l) => l.settle)).toFixed(2)}-${max(out.map((l) => l.settle)).toFixed(2)} s; ` +
          `rest x ${min(xs).toFixed(3)}..${max(xs).toFixed(3)} (sd ${sd(xs).toFixed(3)}), z ${min(zs).toFixed(3)}..${max(zs).toFixed(3)} (sd ${sd(zs).toFixed(3)}); ` +
          `from the pad's middle ≤ ${max(dPad).toFixed(3)}; clear of Fetch at its stand ≥ ${min(gaps).toFixed(3)}; off square ≤ ${(max(yaws) * 57.3).toFixed(1)}°; upright ≥ ${min(out.map((l) => l.up)).toFixed(4)}`,
      );
      for (const [k, l] of out.entries()) {
        expect(l.handoverDv, `return ${k}: the arc goes on into physics`).toBeLessThanOrEqual(HANDOVER_DV);
        expect(l.arrive, `return ${k}: it arrives moving`).toBeGreaterThan(3);
        expect(l.deadStop, `return ${k}: no dead stop in the air`).toBe(false);
        // where Fetch's rounds look for it (`padRadius`), clear of its body turning at the stand, square and upright
        expect(dPad[k]!, `return ${k}: on the pad`).toBeLessThanOrEqual(PAD_RADIUS);
        expect(gaps[k]!, `return ${k}: clear of Fetch at its stand`).toBeGreaterThan(0.03);
        expect(yaws[k]!, `return ${k}: square`).toBeLessThan(0.12);
        expect(l.up, `return ${k}: upright`).toBeGreaterThan(0.995);
      }
      // a landing, not a placing: most bounce (wood on wood gives back a little)
      expect(out.filter((l) => l.bounced).length).toBeGreaterThanOrEqual(N * 0.8);
      w.dispose();
    }, 600_000);
  }
});

describe('Fetch takes the pad\'s crate after a real landing, every size', () => {
  const cases: [Id, number][] = [];
  for (const id of ['crate-1', 'crate-2', 'crate-3']) for (let seed = 0; seed < 4; seed++) cases.push([id, seed]);
  test.each(cases)('%s (seed %i): shipped, its replacement thrown back onto the pad, Fetch takes it without knocking it first', async (id, seed) => {
    const w = await benchWorld(`chute-landing-take-${id}-${seed}`, { scene: FULL_BENCH });
    const t = tape(w);
    startPlay(w);
    putOn(w, t, id, onBelt(0.3));
    expect(t.until((e) => e.type === 'shipped' && e.part === id, steps(20)), `${id} shipped`).not.toBeNull();
    const l = t.until((e) => e.type === 'restock.launched', steps(4));
    expect(l).not.toBeNull();
    const part = (l!.e as Extract<SimEvent, { type: 'restock.launched' }>).part;
    expect(w.part(part)!.size).toBe(w.part(id)!.size);
    t.until((e) => e.type === 'restocked' && e.part === part, steps(3));
    // settled by itself (the engine's landing), then left alone until Fetch's claws close on it
    for (let i = 0; i < steps(3) && w.part(part)!.location.at !== 'rest'; i++) t.run(1);
    expect(w.part(part)!.location.at).toBe('rest');
    const rest = w.motion(part)!.pose.p;
    let taken = false;
    for (let i = 0; i < steps(25) && !taken; i++) {
      const ev = t.run(1);
      if (w.crew('fetch')!.carrying === part) taken = true;
      else {
        expect(ev.some((e) => e.type === 'part.hit' && [e.id, e.other].includes('fetch') && [e.id, e.other].includes(part)), 'Fetch knocked it').toBe(false);
        const p = w.motion(part)!.pose.p;
        expect(Math.hypot(p[0] - rest[0], p[1] - rest[1], p[2] - rest[2]), 'it moved before the claws closed').toBeLessThan(1e-3);
      }
    }
    expect(taken, 'Fetch took it').toBe(true);
    w.dispose();
  }, 120_000);
});
