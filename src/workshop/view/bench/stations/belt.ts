/**
 * The belt (station `line`): the belt piece at the bench's length, its body merged into the set; the
 * rollers, the seam and the lamp move here. Same feel as `view/stations/belt.ts`.
 */
import { Group, type Box3, type Object3D } from 'three';
import type { Frame, StationView, ViewContext } from '../../types.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { pieceBounds } from '../../kit/compose.ts';
import { placedMatrix, splitStatic } from '../../stations/set.ts';
import { BELT_FEEL } from '../../stations/belt.ts';
import { LAYOUT } from '../../bench.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'belt',
  order: ORDER.pool,
  async make(k) {
    const entry = k.entry('belt');
    const module = await k.module('belt');
    const length = LAYOUT.beltLength;
    return (ctx: ViewContext): StationView => {
      const root = new Group();
      root.name = 'belt';
      ctx.scene.add(root);
      if (!entry) return { root, update() {}, dispose: () => root.removeFromParent() };
      const whole = buildEntry(entry, null, { seed: k.seed, length }, ctx.labels);
      const at = placedMatrix(k.fit.belt.at);
      const p = splitStatic(whole, at, (n) => /^roller\d+$/.test(n) || n === 'seam' || n === 'lamp', k.pool);
      const obj = ctx.realize(p);
      root.applyMatrix4(at);
      root.add(obj);
      const picking = (ctx as unknown as { picking?: { add(id: string, o: Object3D, opts?: { box?: Box3 }): void } }).picking;
      if (picking) picking.add('belt', obj, { box: pieceBounds(whole) });
      else ctx.pickable('belt', obj);
      type PoseBelt = (root: Object3D, length: number, rollers: readonly unknown[], pose: { travel: number }) => void;
      const poseBelt = module?.['poseBelt'] as PoseBelt | undefined;
      const beltRollers = module?.['beltRollers'] as ((length: number) => readonly unknown[]) | undefined;
      const rollers = poseBelt && beltRollers ? beltRollers(length) : null;
      const u = (ctx.materials as unknown as { uniforms?: (cls: 'belt') => { u_offset?: { value: unknown }; u_speed?: { value: unknown } } }).uniforms?.('belt') ?? null;
      if (u?.u_speed && typeof u.u_speed.value === 'number') u.u_speed.value = 0;
      let v = ctx.reducedMotion ? 0 : BELT_FEEL.speed;
      let dv = 0;
      let phase = 0;
      return {
        root,
        update(frame: Frame) {
          ctx.materials.update(frame.time);
          const dt = Math.min(frame.dt, 0.1);
          for (const e of frame.events) if (e.type === 'misfire' && e.id === 'belt' && !ctx.reducedMotion) v = BELT_FEEL.lurch;
          const b = frame.world.button();
          const goal = ctx.reducedMotion ? 0 : b.phase === 'rewinding' ? BELT_FEEL.speed * BELT_FEEL.rewind : BELT_FEEL.speed;
          const w = BELT_FEEL.omega;
          for (let left = dt; left > 1e-6; ) {
            const h = Math.min(left, 1 / 240);
            dv += (-w * w * (v - goal) - 2 * BELT_FEEL.damping * w * dv) * h;
            v += dv * h;
            left -= h;
          }
          phase += v * dt;
          if (u?.u_offset) u.u_offset.value = phase;
          if (poseBelt && rollers) poseBelt(obj, length, rollers, { travel: phase });
        },
        dispose() {
          root.removeFromParent();
        },
      };
    };
  },
};
