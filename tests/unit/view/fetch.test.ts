import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput, type FetchOutput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import type { World, WorldOptions } from '../../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';
import { WHEEL_R } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import type { Intent } from '../../../src/workshop/sim/types.ts';

interface Sample {
  step: number;
  t: number;
  state: string;
  stateTime: number;
  x: number;
  z: number;
  speed: number;
  mode: string;
  out: FetchOutput;
}

interface DriveOptions {
  pointer?: (step: number) => Vec3 | null;
  intents?: (step: number, world: World) => Intent[];
  reducedMotion?: boolean;
  visitor?: Vec3;
}

function drive(world: World, perf: FetchPerformer, n: number, o: DriveOptions = {}): Sample[] {
  const out: Sample[] = [];
  const id = world.scene.runner.id;
  for (let k = 0; k < n; k++) {
    for (const it of o.intents?.(world.step, world) ?? []) world.dispatch(it);
    world.advance();
    const events = world.drainEvents();
    const m = world.crew(id)!;
    const mo = world.motion(id)!;
    const input: FetchInput = {
      time: world.step / HZ,
      dt: 1 / HZ,
      member: m,
      mode: mo.mode,
      pose: mo.pose,
      teleport: mo.prev === mo.pose,
      half: world.halfExtents(id)!,
      pointer: o.pointer?.(world.step) ?? null,
      hovered: false,
      visitor: o.visitor ?? [0, 9, 14],
      button: [0, 0.62, 1.9],
      carriedAt: m.carrying ? (world.motion(m.carrying)?.pose.p ?? null) : null,
      nearHeld: null,
      sights: [[-2.7, 1.5, 0.7]],
      events,
      reducedMotion: o.reducedMotion ?? false,
    };
    const r = perf.update(input);
    out.push({
      step: world.step, t: input.time, state: m.state, stateTime: m.stateTime, x: mo.pose.p[0], z: mo.pose.p[2], speed: m.speed, mode: mo.mode,
      out: { pose: structuredClone(r.pose), root: r.root.clone(), shadow: { ...r.shadow } },
    });
  }
  return out;
}

const pos = (s: Sample): Vector3 => new Vector3().setFromMatrixPosition(s.out.root);
const fwd = (s: Sample): Vector3 => new Vector3(0, 0, 1).transformDirection(s.out.root).setY(0).normalize();
const range = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

describe('Fetch view: the performer (W4 § A)', () => {
  // one shared run: the lane loop, the fumble, the offer, the retrieve and shrug
  const lap = drive(stubWorld().world, new FetchPerformer(7), 1400);

  test('deterministic: the same world and seed give the same performance', () => {
    const again = drive(stubWorld().world, new FetchPerformer(7), 400);
    for (let i = 0; i < 400; i += 7) expect(again[i]!.out.pose).toEqual(lap[i]!.out.pose);
  });

  test('the wheel turns exactly with the ground: no skating', () => {
    let checked = 0;
    for (let i = 1; i < lap.length; i++) {
      const a = lap[i - 1]!;
      const b = lap[i]!;
      if (b.mode !== 'crew' || a.mode !== 'crew' || !['roll', 'skid'].includes(b.state)) continue;
      const ground = pos(b).sub(pos(a)).dot(fwd(b));
      const wheel = (b.out.pose.wheel! - a.out.pose.wheel!) * WHEEL_R;
      expect(Math.abs(wheel - ground)).toBeLessThan(2e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  test('it digs in to brake, whips forward at the stop and settles', () => {
    const firstSkid = lap.findIndex((s) => s.state === 'skid');
    const braking = lap.slice(firstSkid - 15, firstSkid).map((s) => s.out.pose.lean![0]);
    const skid = lap.slice(firstSkid, firstSkid + 30).map((s) => s.out.pose.lean![0]);
    expect(Math.min(...braking)).toBeLessThan(-0.15);
    expect(Math.max(...skid)).toBeGreaterThan(0.15);
    // the spring takes the stop
    expect(Math.max(...lap.slice(firstSkid, firstSkid + 20).map((s) => s.out.pose.squash!))).toBeGreaterThan(0.25);
  });

  test('the aerial lags: it bends back when the run starts', () => {
    const start = lap.findIndex((s) => s.state === 'roll');
    expect(Math.min(...lap.slice(start, start + 30).map((s) => s.out.pose.aerial![0]))).toBeLessThan(-0.6);
  });

  test('the offer: the eye goes to the visitor before the turret, and the hands come out after', () => {
    const i = lap.findIndex((s) => s.state === 'offer' && s.stateTime >= FETCH_TUNING.offerLook);
    expect(i).toBeGreaterThan(0);
    const before = lap[i - 1]!.out.pose;
    const end = lap[i + 60]!.out.pose;
    const early = lap[i + 4]!.out.pose;
    // 4 frames in: the pupil has swung most of its way, the turret has not
    const gazeMove = Math.hypot(early.gaze![0] - before.gaze![0], early.gaze![1] - before.gaze![1]);
    const headDone = Math.abs(early.headPitch! - before.headPitch!) / Math.max(1e-6, Math.abs(end.headPitch! - before.headPitch!));
    expect(gazeMove).toBeGreaterThan(0.4);
    expect(headDone).toBeLessThan(0.5);
    // hands: still low 8 frames in, out (offer preset swing ≈ 0.9) a second in
    const arms = (k: number): number => (lap[i + k]!.out.pose.arms as { left: { swing: number } }).left.swing;
    expect(arms(8)).toBeLessThan(arms(60) - 0.2);
    expect(arms(60)).toBeGreaterThan(0.75);
  });

  test('no blink while the eye is the point of a beat (the fumble and the ask)', () => {
    for (const s of lap) {
      const beat = s.state === 'fumble' || (s.state === 'offer' && s.stateTime > FETCH_TUNING.offerLook && s.stateTime < 2.5);
      if (beat) expect(s.out.pose.lids![0]).toBeLessThan(0.5);
    }
  });

  test('the fumble: eye wide, pupil a pinprick, arms up', () => {
    const f = lap.filter((s) => s.state === 'fumble' && s.stateTime > 0.6);
    expect(f.length).toBeGreaterThan(5);
    const p = f[0]!.out.pose;
    expect(p.pupilSize).toBeLessThan(0.7);
    expect(p.lids![0]).toBeLessThan(0.1);
    expect(p.brow).toBeLessThan(-0.8);
  });

  test('frozen: a statue but for the eye; resumes after', () => {
    const { world } = stubWorld();
    const perf = new FetchPerformer(7);
    const press: Intent = { type: 'press', id: 'button' };
    const run = drive(world, perf, 400, { intents: (step) => (step === 90 ? [press] : []) });
    const frozen = run.filter((s) => s.state === 'frozen');
    expect(frozen.length).toBeGreaterThan(60);
    const a = frozen[0]!.out.pose;
    for (const s of frozen) {
      const p = s.out.pose;
      expect(p.lean).toEqual(a.lean);
      expect(p.wheel).toBe(a.wheel);
      expect(p.arms).toEqual(a.arms);
      expect(p.aerial).toEqual(a.aerial);
      expect(p.flag).toBe(a.flag);
    }
    // the eye moved
    expect(range(frozen.map((s) => s.out.pose.gaze![0]))).toBeGreaterThan(0.1);
    // and it moves again after
    const after = run.slice(run.indexOf(frozen[frozen.length - 1]!) + 1, run.indexOf(frozen[frozen.length - 1]!) + 40);
    expect(range(after.map((s) => s.out.pose.wheel!))).toBeGreaterThan(0.5);
  });

  test('held: the wheel spins in the air and runs down, the spring hangs, the eye is wide', () => {
    const { world } = stubWorld();
    const intents = (step: number, w: typeof world): Intent[] => {
      if (step === 10) return [{ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p }];
      if (step > 10 && step < 90) return [{ type: 'carry', target: [1.5, 1.6, 1.4] }];
      return [];
    };
    const run = drive(world, new FetchPerformer(7), 80, { intents });
    const held = run.filter((s) => s.state === 'held' && s.stateTime > 0.6);
    expect(held.length).toBeGreaterThan(10);
    const turn = (i: number): number => Math.abs(held[i]!.out.pose.wheel! - held[i - 1]!.out.pose.wheel!);
    for (let i = 1; i < held.length; i++) expect(turn(i)).toBeGreaterThan(0.15);
    // slowing on its bearing, never speeding up
    for (let i = 2; i < held.length; i++) expect(turn(i)).toBeLessThanOrEqual(turn(i - 1) + 1e-9);
    expect(held[0]!.out.pose.squash).toBeLessThan(-0.4);
    expect(held[0]!.out.pose.lids![0]).toBeLessThan(0.05);
  });

  test('balances and blinks by itself; with reduced motion it does neither', () => {
    const still = { runner: { idle: [30, 30], fumbleAfter: 1000 } } as unknown as Partial<WorldOptions>; // FETCH_TUNING is `as const`
    const live = drive(stubWorld(1, still).world, new FetchPerformer(7), 900).slice(180);
    const calm = drive(stubWorld(1, still).world, new FetchPerformer(7), 900, { reducedMotion: true }).slice(180);
    expect(live.every((s) => s.state === 'idle')).toBe(true);
    expect(range(live.map((s) => s.out.pose.lean![1]))).toBeGreaterThan(0.01);
    expect(Math.max(...live.map((s) => s.out.pose.lids![0]))).toBeGreaterThan(0.9);
    for (const k of ['squash', 'headYaw', 'headPitch', 'flag', 'wheel'] as const) expect(range(calm.map((s) => s.out.pose[k] as number))).toBeLessThan(2e-3);
    expect(range(calm.map((s) => s.out.pose.lean![1]))).toBeLessThan(2e-3);
    expect(Math.max(...calm.map((s) => s.out.pose.lids![0]))).toBeLessThan(0.3);
  });

  test('looks at the pointer when it is near', () => {
    const still = { runner: { idle: [30, 30], fumbleAfter: 1000 } } as unknown as Partial<WorldOptions>; // FETCH_TUNING is `as const`
    const { world } = stubWorld(1, still);
    const m = world.crew('fetch')!;
    // the pointer sits to Fetch's right-front, then to its left-front
    const right = drive(world, new FetchPerformer(7), 120, { pointer: () => [m.x + 1, 0.3, m.z + 1] });
    const left = drive(world, new FetchPerformer(7), 120, { pointer: () => [m.x - 1, 0.3, m.z + 1] });
    // its heading is +X: a pointer at +X+Z is ahead-right (yaw < 0 toward its right), -X+Z is behind-right... compare the two
    expect(right[119]!.out.pose.headYaw).not.toBeCloseTo(left[119]!.out.pose.headYaw!, 1);
  });
});
