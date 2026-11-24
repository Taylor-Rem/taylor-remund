/**
 * P4 S6, a prototype behind one switch (`?open=stand`): the opening stand drawn where the scene puts it (its static body,
 * sim/scenes/bench.ts `withOpeningStand`). Its body is merged into the set (no draw call of its own); its lifter is its
 * own small object (one draw call), swung up about its hinge while a crate lies open on the stand (the stand's view,
 * `OpeningStandView.crate`), down when there is none; a cut under reduced motion. `?standTape=1`: with a strip of label
 * tape on its front (src/content/room.json `stand`), for the owner's pictures.
 */
import { Group, Matrix4, type Object3D } from 'three';
import type { OpeningStandView } from '../../../sim/types.ts';
import type { Frame, StationView } from '../../types.ts';
import { openingStand } from '../../kit/pieces/opening-stand/index.ts';
import { room } from '../../kit/pieces/room/words.ts';
import { ORDER, at, type BenchStation } from '../station.ts';

/** Tune here: how far the lifter swings up (radians) and how fast (share a second). */
export const STAND_FEEL = { up: (72 * Math.PI) / 180, rate: 1.6 } as const;

const query = (k: string): string | null => {
  try {
    return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get(k);
  } catch {
    return null;
  }
};

export const station: BenchStation = {
  name: 'opening-stand',
  order: ORDER.pool + 1,
  make(k) {
    const os = k.scene.openingStand;
    const body = os ? k.scene.statics.find((s) => s.id === os.unit) : undefined;
    if (!os || !body || body.shape.type !== 'box') return null;
    const half = body.shape.half;
    const h = half[1] * 2;
    const [x, y, z] = body.pose.p;
    const base = y - h / 2;
    const taped = query('standTape') === '1';
    return (ctx) => {
      const key = taped ? ctx.labels.tape(room.stand, 'black') : null;
      const piece = openingStand({ h, seed: k.seed, half: [half[0], half[2]], ...(key ? { tape: { key, ...ctx.labels.size(key) } } : {}) });
      // the body into the set's pool, the lifter left out of it
      k.pool.items.push({ piece, at: at(x, base, z), skip: new Set(['lifter']) });
      const root = new Group();
      root.name = 'opening-stand';
      ctx.scene.add(root);
      // the lifter alone: the whole piece realized, its lifter kept where it stands in the piece
      const whole = ctx.realize(piece);
      let lifter: Object3D | null = null;
      whole.traverse((o) => {
        if (o.name === 'lifter' && !lifter) lifter = o;
      });
      const arm = lifter as Object3D | null;
      if (arm) {
        whole.updateMatrixWorld(true);
        const m = new Matrix4().copy(arm.matrixWorld);
        arm.removeFromParent();
        const holder = new Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(at(x, base, z).multiply(m));
        holder.add(arm);
        arm.position.set(0, 0, 0);
        arm.quaternion.identity();
        root.add(holder);
      }
      let e = 0;
      return {
        root,
        update(frame: Frame) {
          if (!arm) return;
          const v = frame.world.machine(os.unit) as OpeningStandView | undefined;
          const want = v?.crate ? 1 : 0;
          if (ctx.reducedMotion || frame.world.reducedMotion) e = want;
          else e += Math.sign(want - e) * Math.min(Math.abs(want - e), STAND_FEEL.rate * frame.dt);
          const s = e * e * (3 - 2 * e);
          arm.rotation.x = STAND_FEEL.up * s;
        },
        dispose() {
          root.removeFromParent();
        },
      };
    };
  },
};
