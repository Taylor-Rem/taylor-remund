// Taylor, 2026-11-20 ("eliminate unnatural discontinuities"): a part the world sends home by the chute where it stands
// (at rest up out of reach, or resting past the edge) was cut from view in one frame. The parts view now draws a brief
// exit on the simulation's clock: a squash, then a shrink to nothing about its lowest point, its shadow going with it,
// in `exitTime`; with reduced motion, nothing (gone at once, as before); never for a part that fell off the bench.
import { describe, expect, test } from 'vitest';
import { MeshBasicMaterial, Scene, Vector3, type Material, type Object3D } from 'three';
import { benchWorld } from './line-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SimContext, Unit } from '../../src/workshop/sim/context.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import * as K from '../../src/workshop/view/kit/index.ts';
import { createPartsView, PARTS_FEEL } from '../../src/workshop/view/stations/parts.ts';
import type { Frame, ViewContext } from '../../src/workshop/view/types.ts';
import type { Piece } from '../../src/workshop/view/kit/types.ts';

const stub = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), decal: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

async function rig(reducedMotion: boolean): Promise<{ w: World; send: (id: string) => void; frame: () => void; root: (id: string) => Object3D }> {
  let due: string | null = null;
  const unit = (ctx: SimContext): Unit => ({ id: 'test-sender', pre() { if (due) ctx.toChute(due, 'system'); due = null; } });
  const w = await benchWorld('parts-exit', { units: [unit] });
  const scene = new Scene();
  const ctx = { scene, stage: {}, materials: stub, labels: {}, tier: 'high', reducedMotion, realize: (p: Piece) => K.realize(p, stub), pickable() {} } as unknown as ViewContext;
  const view = createPartsView({ half: (p) => w.halfExtents(p.id) ?? [0.3, 0.3, 0.3] })(ctx);
  const frame = (): void => {
    w.advance();
    view.update({ world: w, events: w.drainEvents(), time: w.time, dt: 1 / HZ, alpha: 1, pointer: null, hovered: null, held: null, focused: null } as unknown as Frame);
  };
  return { w, send: (id) => (due = id), frame, root: (id) => scene.getObjectByName(`part:${id}`)! };
}

/** The drawn height of a part's root (its matrix's Y column length) and whether it is drawn. */
const drawn = (o: Object3D): { visible: boolean; sy: number } => ({ visible: o.visible, sy: new Vector3().setFromMatrixColumn(o.matrix, 1).length() });

describe('sent home by the chute in plain view', () => {
  test('it squashes and shrinks away where it stands in about a fifth of a second, then is gone', async () => {
    const r = await rig(false);
    for (let i = 0; i < 30; i++) r.frame();
    r.send('crate-3');
    const seen: { visible: boolean; sy: number }[] = [];
    for (let i = 0; i < 30; i++) {
      r.frame();
      seen.push(drawn(r.root('crate-3')));
    }
    expect(r.w.mode('crate-3')).toBe('chute');
    const shown = seen.filter((s) => s.visible);
    // drawn for the exit's length (give or take the step it started on), and shrinking all the way
    expect(shown.length).toBeGreaterThanOrEqual(Math.floor(PARTS_FEEL.exitTime * HZ) - 1);
    expect(shown.length).toBeLessThanOrEqual(Math.ceil(PARTS_FEEL.exitTime * HZ) + 1);
    expect(Math.min(...shown.map((s) => s.sy))).toBeLessThan(0.2);
    expect(seen.at(-1)!.visible).toBe(false);
    r.w.dispose();
  }, 60_000);

  test('with reduced motion: gone at once, as before', async () => {
    const r = await rig(true);
    for (let i = 0; i < 30; i++) r.frame();
    r.send('crate-3');
    r.frame();
    r.frame();
    expect(drawn(r.root('crate-3')).visible).toBe(false);
    r.w.dispose();
  }, 60_000);
});
