// Revert's view on its first frames (as Fetch's, 2026-11-20): a fresh view (page load, the loading picture, a
// stage rebuilt on a running world) draws Revert where the simulation has it, and its springs start at rest:
// no speed, swing or sag taken from the world's origin, where its last pose "was" before it was ever drawn.
import { describe, expect, test } from 'vitest';
import { MeshBasicMaterial, Scene, Vector3 } from 'three';
import type { Material, Texture } from 'three';
import { realize } from '../../../src/workshop/view/kit/realize.ts';
import type { Frame, Labels, ViewContext } from '../../../src/workshop/view/types.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import { stubWorld, run } from '../sim/helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { LAYOUT, REVERT_SCALE, origin } from '../../../src/workshop/view/bench.ts';
import { createRevertView } from '../../../src/workshop/view/stations/revert.ts';
import type { RevertView } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';

const mat = (): Material => new MeshBasicMaterial();
/** The options the bench gives Revert's view (view/bench/stations/revert.ts), at the bench's crew scale. */
const LAYOUT_REVERT = (() => {
  const sp = LAYOUT.stations.revert;
  const [ox, oz] = origin(sp);
  return { hatch: origin(LAYOUT.stations.hatch), scale: REVERT_SCALE, centre: [sp.x - ox, sp.z - oz] as const, seed: 3 };
})();
function labels(): Labels {
  const k = (t: string) => t;
  return {
    tape: k, stencil: k, card: k, slip: k, plate: k, sign: k, phone: () => 'phone',
    size: () => ({ w: 2, h: 1.4 }), capHeight: () => 0.23, texture: () => ({ image: {} }) as unknown as Texture,
    normalMap: () => null, roughnessMap: () => null, transparent: () => false,
    region: (name, size) => ({ key: name, px: { w: 1, h: 1 }, size, draw: () => {}, put: () => {} }),
    ready: () => Promise.resolve(),
  };
}

function freshView(world: World) {
  const scene = new Scene();
  const ctx: ViewContext = {
    scene,
    stage: { camera: { camera: { position: new Vector3(0, 9, 14) }, shake: () => {} } } as unknown as ViewContext['stage'],
    materials: { of: mat, textured: mat, update() {}, dispose() {}, decal: () => new MeshBasicMaterial(), focusMark: () => new MeshBasicMaterial() },
    labels: labels(),
    tier: 'low',
    reducedMotion: false,
    realize: (p) => realize(p, { of: mat, textured: mat, update() {}, dispose() {} }),
    pickable: () => {},
  };
  const view = createRevertView(LAYOUT_REVERT)(ctx);
  const body = view.root.children.find((c) => c.name === 'revert')!;
  const frames: { k: number; at: Vector3; sim: readonly number[]; springs: typeof view.state.springs }[] = [];
  for (let k = 0; k <= 14; k++) {
    if (k > 0) world.advance();
    const events = world.drainEvents();
    const frame: Frame = { world, events, time: world.step / HZ, dt: 1 / HZ, alpha: 1, pointer: null, hovered: null, held: null, focused: null, keyDest: null, working: null };
    view.update(frame);
    view.root.updateMatrixWorld(true);
    frames.push({ k, at: new Vector3().setFromMatrixPosition(body.matrixWorld), sim: [(world.machine('revert-crew') as RevertView).x, (world.machine('revert-crew') as RevertView).lift, (world.machine('revert-crew') as RevertView).z], springs: { ...view.state.springs } });
  }
  if (process.env.DBG) for (const f of frames) process.stderr.write(`\nF ${f.k} at ${f.at.toArray().map((v) => v.toFixed(2))} sim ${f.sim.map((v) => v.toFixed(2))}`);
  return frames;
}

describe('Revert view: the first frames of a fresh view', () => {
  test('up on its hatch when the view is made: drawn where the simulation has it at frames 0, 1, 12 and 14, its springs at rest', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 5);
    world.dispatch({ type: 'press', id: 'button' }); // a rung calls it up
    for (let i = 0; i < 2000 && world.bracketed; i++) run(world, 1);
    for (let i = 0; i < 600 && (world.machine('revert-crew') as RevertView).lift < 1; i++) run(world, 1);
    run(world, 2);
    const r = world.machine('revert-crew') as RevertView;
    expect(r.lift).toBe(1);
    const frames = freshView(world);
    const now = world.machine('revert-crew') as RevertView;
    for (const f of frames.filter((x) => [0, 1, 12, 14].includes(x.k))) {
      // (driving, it noses down a little: -0.03; never the kick of a speed taken from the origin)
      expect(Math.abs(f.springs.pitch), `pitch at frame ${f.k}`).toBeLessThan(0.035);
      expect(Math.abs(f.springs.swing), `swing at frame ${f.k}`).toBeLessThan(0.02);
      expect(Math.abs(f.springs.sag), `sag at frame ${f.k}`).toBeLessThan(0.02);
      expect(Math.hypot(f.at.x - f.sim[0]!, f.at.z - f.sim[2]!), `drawn where the simulation has it at frame ${f.k}`).toBeLessThan(0.5);
      expect(f.at.length(), `not at the origin at frame ${f.k}`).toBeGreaterThan(1);
    }
    // the last frame: within its body's size of where the simulation has it
    const last = frames.at(-1)!;
    expect(Math.hypot(last.at.x - now.x, last.at.z - now.z)).toBeLessThan(0.5);
  });

  test('in the visitor\'s hand when the view is made: drawn there, no swing or sag from the origin', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 5);
    world.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 2000 && world.bracketed; i++) run(world, 1);
    run(world, 120);
    const p = world.motion('revert')!.pose.p;
    world.dispatch({ type: 'grab', id: 'revert', grip: [p[0], p[1], p[2]] });
    for (let i = 0; i < 20; i++) {
      world.dispatch({ type: 'carry', target: [p[0], 2.4, p[2]] });
      run(world, 1);
    }
    const frames = freshView(world);
    for (const f of frames.filter((x) => [0, 1, 12, 14].includes(x.k))) {
      expect(Math.abs(f.springs.swing), `swing at frame ${f.k}`).toBeLessThan(0.05);
      expect(Math.abs(f.springs.pitch), `pitch at frame ${f.k}`).toBeLessThan(0.05);
      expect(Math.hypot(f.at.x - f.sim[0]!, f.at.z - f.sim[2]!), `drawn at the hand at frame ${f.k}`).toBeLessThan(0.5);
    }
  });
});
