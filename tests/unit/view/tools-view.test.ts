// P4 T2: the tool wall's tools drawn (view/stations/tools.ts), headless: the rig's bone for each tool is where the parts
// view draws that tool (hanging, in the hand), hidden when it is out of the world; a coat of paint reaches its handle's
// vertices only, and comes off again; while a tool is in the hand the things it built glow, in its colour, and stop when
// it is back on the wall; the rattle is drawn on the drawn pose only (the simulation's poses are not touched).
import { describe, expect, test } from 'vitest';
import { Box3, BufferAttribute, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Material, type Mesh, type Texture } from 'three';
import { realize } from '../../../src/workshop/view/kit/realize.ts';
import type { Frame, Labels, ViewContext } from '../../../src/workshop/view/types.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import { stubWorld, run } from '../sim/helpers.ts';
import { bench, TOOLWALL, pegId, toolLook } from '../../../src/workshop/sim/scenes/bench.ts';
import { LAYOUT } from '../../../src/workshop/view/bench.ts';
import { createPartsView, partsHooks, type PartWorker } from '../../../src/workshop/view/stations/parts.ts';
import { createToolsView, toolBodyPiece } from '../../../src/workshop/view/stations/tools.ts';
import { tool } from '../../../src/workshop/view/kit/pieces/toolwall/tools.ts';
import type { ToolKind } from '../../../src/workshop/view/kit/pieces/toolwall/tools.ts';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import { linear } from '../../../src/workshop/view/palette.ts';
import type { World } from '../../../src/workshop/sim/world.ts';

const mat = (): Material => new MeshBasicMaterial();
const MATS = { of: mat, textured: mat, update() {}, dispose() {} };
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

function views(world: World) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(22, 1.6, 0.1, 200);
  camera.position.set(0, 9, 14);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ctx: ViewContext = {
    scene,
    stage: { camera: { camera, shake: () => {} } } as unknown as ViewContext['stage'],
    materials: { ...MATS, decal: () => new MeshBasicMaterial(), focusMark: () => new MeshBasicMaterial(), halo: () => new MeshBasicMaterial() } as unknown as ViewContext['materials'],
    labels: labels(),
    tier: 'high',
    reducedMotion: false,
    realize: (p, o) => realize(p, MATS, o),
    pickable: () => {},
  };
  const parts = createPartsView({
    half: (p) => world.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
    piece: (p) => toolBodyPiece(tool((p.kind === 'tool' && p.id.startsWith('tool-') ? p.id.slice(5) : 'vue') as ToolKind, { detail: 'low' })),
    blobs: 'off',
  })(ctx);
  const S = LAYOUT.stations.toolwall;
  const tools = createToolsView({ unit: TOOLWALL.unit, sheet: TOOLWALL.sheet, look: TOOLWALL.look, toolLook: (k) => toolLook(k), peg: (k) => pegId(k), wall: [S.x, S.y, -5 + 0.012], seed: 1 })(ctx);
  const draw = (): void => {
    const f: Frame = { world, events: world.drainEvents(), time: world.step / HZ, dt: 1 / HZ, alpha: 1, pointer: null, hovered: null, held: null, focused: null, keyDest: null, working: null };
    parts.update(f);
    tools.update(f);
    scene.updateMatrixWorld(true);
  };
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      run(world, 1);
      draw();
    }
  };
  const bone = (id: string) => tools.root.getObjectByName(`tool.${id.slice(5)}`)!;
  const glow = () => tools.root.getObjectByName('tools:glow') as Mesh;
  /** Where the rig draws the tool's body middle (its bounds' middle in its own frame, through its bone). */
  const middle = (id: string): Vector3 => pieceBounds(tool(id.slice(5) as ToolKind)).getCenter(new Vector3()).applyMatrix4(bone(id).matrixWorld);
  const colours = (): number[] => {
    const out: number[] = [];
    tools.root.traverse((x) => {
      const m = x as Mesh;
      if (!m.isMesh || m.name === 'tools:glow') return;
      const c = m.geometry.getAttribute('color') as BufferAttribute | undefined;
      if (c) for (let i = 0; i < c.count; i++) out.push(c.getX(i), c.getY(i), c.getZ(i));
    });
    return out;
  };
  return { scene, draw, step, bone, glow, middle, colours };
}

describe('the tool wall drawn', () => {
  test('each tool is drawn where the world has it, on its peg; in the hand, there', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 3);
    const v = views(world);
    v.draw();
    for (const k of Object.keys(TOOLWALL.tools)) {
      const id = `tool-${k}`;
      expect(v.middle(id).distanceTo(new Vector3(...world.motion(id)!.pose.p)), id).toBeLessThan(0.02);
    }
    const id = 'tool-php';
    world.dispatch({ type: 'grab', id, grip: world.motion(id)!.pose.p });
    world.dispatch({ type: 'carry', target: [-5, 2.5, -3] });
    v.step(25);
    expect(world.holding()?.id).toBe(id);
    expect(v.middle(id).distanceTo(new Vector3(...world.motion(id)!.pose.p))).toBeLessThan(0.08); // (a hair of hover lift and squash)
  });

  test('in the hand the things it built glow in its colour, and its own place; back on its peg, nothing does; the rattle is the view\'s', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 3);
    const v = views(world);
    v.draw();
    expect(v.glow().visible).toBe(false);
    const id = 'tool-vue';
    world.dispatch({ type: 'grab', id, grip: world.motion(id)!.pose.p });
    world.dispatch({ type: 'carry', target: [-6, 2.5, -3] });
    const before = world.motion('crate-3')!.pose.p.slice();
    v.step(20);
    expect(world.motion('crate-3')!.pose.p).toEqual(before);
    const g = v.glow();
    expect(g.visible).toBe(true);
    expect(g.geometry.drawRange.count / 6).toBeGreaterThanOrEqual(3);
    const col = g.geometry.getAttribute('color') as BufferAttribute;
    const green = linear('paint-green'), amber = linear('amber-glow');
    expect(col.getY(0) / col.getX(0)).toBeCloseTo(green[1] / amber[1] / (green[0] / amber[0]), 3);
    // back at its place: it hangs, and the glow is out a few seconds later
    const h = TOOLWALL.tools['vue']!.at;
    world.dispatch({ type: 'carry', target: [h[0], h[1], h[2] + 0.3] });
    v.step(40);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    v.step(4 * HZ);
    expect(world.motion(id)!.mode).toBe('machine');
    expect(v.glow().visible).toBe(false);
  });

  test('a coat of paint reaches the handle (its own colour) and not the steel; taken off, the tool is as it was', () => {
    const { world } = stubWorld(1, { scene: bench });
    run(world, 3);
    const v = views(world);
    v.draw();
    const bare = v.colours();
    let paint: 'paint-blue' | null = 'paint-blue';
    const worker: PartWorker = (id, _f, out) => {
      if (id !== 'tool-php' || !paint) return false;
      out.paint = { from: 'bare', to: paint, t: 1, axis: [0, -1, 0] };
      return true;
    };
    partsHooks(v.scene).workers.push(worker);
    v.draw();
    const blue = v.colours();
    const changed = blue.reduce((n, x, i) => n + (Math.abs(x - bare[i]!) > 1e-6 ? 1 : 0), 0);
    expect(changed).toBeGreaterThan(30);
    // only the hammer's handle: every changed vertex is blue at its own tone
    const b = linear('paint-blue');
    for (let i = 0; i < blue.length; i += 3) {
      if (Math.abs(blue[i]! - bare[i]!) + Math.abs(blue[i + 1]! - bare[i + 1]!) + Math.abs(blue[i + 2]! - bare[i + 2]!) < 1e-6) continue;
      const t = blue[i]! / b[0];
      expect(blue[i + 2]! / b[2]).toBeCloseTo(t, 3);
    }
    paint = null;
    v.draw();
    expect(v.colours()).toEqual(bare);
    void Box3;
  });
});
