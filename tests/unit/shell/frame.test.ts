// Frame assembly and step/alpha bookkeeping, against the stub physics.
import { describe, expect, it } from 'vitest';
import { createStubPhysics, createWorld, HZ, vignette } from '../../../src/workshop/sim/index.ts';
import type { Frame, StationView } from '../../../src/workshop/view/types.ts';
import { Driver, assembleFrame, frameTime } from '../../../src/workshop/shell/frame.ts';
import { FixedStep } from '../../../src/workshop/view/stage/loop.ts';
import { LatencyMeter } from '../../../src/workshop/shell/latency.ts';
import { Group } from 'three';

function world() {
  const b = vignette.bench;
  return createWorld({ seed: 1, physics: createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } }) });
}
function recorder(): StationView & { frames: Frame[] } {
  const frames: Frame[] = [];
  return { root: new Group(), frames, update: (f) => void frames.push(f), dispose() {} };
}

describe('frame assembly', () => {
  it('time interpolates between the last two steps and never goes negative', () => {
    expect(frameTime(0, 0)).toBe(0);
    expect(frameTime(60, 1)).toBeCloseTo(1, 12);
    expect(frameTime(60, 0.5)).toBeCloseTo((59.5) / HZ, 12);
  });

  it('a frame carries the world, the events since the last frame, alpha, dt, pointer, hovered, held', () => {
    const w = world();
    w.advance();
    const f = assembleFrame(w, [], 0.25, 0.5, [1, 0, 2], 'crate-3');
    expect(f.world).toBe(w);
    expect(f.alpha).toBe(0.25);
    expect(f.dt).toBe(0.1); // clamped
    expect(f.pointer).toEqual([1, 0, 2]);
    expect(f.hovered).toBe('crate-3');
    expect(f.held).toBeNull();
  });
});

describe('the driver', () => {
  it('runs due steps, hands every event to the views once, in order, and renders after the views', () => {
    const w = world();
    const v = recorder();
    const order: string[] = [];
    let ticks = 0;
    const d = new Driver({
      world: w,
      views: [v, { root: new Group(), update: () => void order.push('view'), dispose() {} }],
      render: () => void order.push('render'),
      input: { tick: () => void ticks++, pointer: () => null, hovered: () => null },
      now: () => 0,
    });
    const clock = new FixedStep();
    // three frames of a 144 Hz display, then a long one
    for (const dt of [1 / 144, 1 / 144, 1 / 144, 0.05]) {
      const t = clock.tick(dt);
      for (let i = 0; i < t.steps; i++) d.step();
      d.render({ alpha: t.alpha, dt });
    }
    expect(order.slice(0, 2)).toEqual(['view', 'render']);
    expect(ticks).toBe(4); // input once per frame, steps or not
    expect(d.steps).toBe(w.step);
    expect(v.frames.length).toBe(4);
    // grab a part: the event arrives in exactly one frame
    w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
    d.step();
    d.step();
    d.render({ alpha: 1, dt: 1 / 30 });
    d.render({ alpha: 1, dt: 0 });
    const n = v.frames.length;
    expect(v.frames[n - 2]!.events.filter((e) => e.type === 'part.grabbed')).toHaveLength(1);
    expect(v.frames[n - 1]!.events).toEqual([]);
    expect(v.frames[n - 2]!.held).toBe('crate-3');
  });

  it('the pose a frame shows interpolates prev → pose by alpha; a frame with no step changes only alpha', () => {
    const w = world();
    const v = recorder();
    const d = new Driver({ world: w, views: [v], render: () => {}, now: () => 0 });
    const from = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: from });
    w.dispatch({ type: 'carry', target: [from[0] + 2, from[1] + 0.5, from[2]] });
    d.step();
    d.render({ alpha: 0.3, dt: 1 / 60 });
    const f = v.frames[0]!;
    const m = f.world.motion('crate-3')!;
    expect(m.pose).not.toBe(m.prev);
    expect(m.pose.p[1]).toBeGreaterThan(m.prev.p[1]); // it rose within one step of the grab
    const stepBefore = w.step;
    d.render({ alpha: 0.8, dt: 1 / 120 });
    expect(w.step).toBe(stepBefore);
    expect(v.frames[1]!.time).toBeGreaterThan(v.frames[0]!.time);
  });

  it('measures input latency: DOM event → step, → rendered frame', () => {
    const w = world();
    const lat = new LatencyMeter();
    let now = 100;
    const d = new Driver({ world: w, views: [], render: () => void (now += 5), now: () => now, latency: lat });
    lat.dispatched({ type: 'press', id: 'button' }, 92);
    w.dispatch({ type: 'press', id: 'button' });
    d.render({ alpha: 0, dt: 0 }); // a frame with no step: nothing measured yet
    expect(lat.report().step['press']).toBeUndefined();
    now = 110;
    d.step();
    d.render({ alpha: 0, dt: 1 / 60 });
    const r = lat.report();
    expect(r.step['press']?.last).toBe(18);
    expect(r.frame['press']?.last).toBe(23);
  });
});
