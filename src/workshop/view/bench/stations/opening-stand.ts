/**
 * P4 S6, a prototype behind one switch (`?open=stand`): the opening stand drawn where the scene puts it (its static body,
 * sim/scenes/bench.ts `withOpeningStand`). Its body is merged into the set (no draw call of its own); its lifter is its
 * own small object (one draw call), swung up about its hinge while a crate lies open on the stand (the stand's view,
 * `OpeningStandView.crate`), down when there is none; a cut under reduced motion. `?standTape=1`: with a strip of label
 * tape on its front (src/content/room.json `stand`), for the owner's pictures.
 */
import { Group } from 'three';
import type { OpeningStandView } from '../../../sim/types.ts';
import type { Frame, StationView } from '../../types.ts';
import { openingStand } from '../../kit/pieces/opening-stand/index.ts';
import { room } from '../../kit/pieces/room/words.ts';
import { ORDER, at, type BenchStation } from '../station.ts';
import { splitStatic } from '../../stations/set.ts';

/**
 * Tune here: how far the lifter swings up (radians) and how fast (share a second). `hint` (round two, `?standHint=1`):
 * while the hand holds a project crate that is shut, the stand answers it as the bench answers a held tool, by moving:
 * its lifter up, nodding and waving (`nod` of its swing and `wag` radians side to side, every `period` s, the hop's
 * shape), as a finger beckons; standing still under reduced motion.
 */
export const STAND_FEEL = { up: (-100 * Math.PI) / 180, rate: 1.6, hint: { half: 0.9, nod: 0.2, wag: 0.45, period: 1.3, hop: 0.55 } } as const;

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
    const hinting = query('standHint') === '1';
    const projects = new Set((k.scene.projects ?? []).map((c) => c.crate));
    return (ctx) => {
      const key = taped ? ctx.labels.tape(room.stand, 'black') : null;
      const piece = openingStand({ h, seed: k.seed, half: [half[0], half[2]], ...(key ? { tape: { key, ...ctx.labels.size(key) } } : {}) });
      // the body into the set's pool; the lifter (and the bare node above it) realized on its own, its bone driven
      const moving = splitStatic(piece, at(x, base, z), (n) => n === 'lifter', k.pool);
      const root = new Group();
      root.name = 'opening-stand';
      ctx.scene.add(root);
      const whole = ctx.realize(moving);
      whole.applyMatrix4(at(x, base, z));
      root.add(whole);
      const arm = whole.getObjectByName('lifter') ?? null;
      // its wave turns it about the stand's forward axis after its swing (the turn applied last, in the parent's frame)
      if (arm) arm.rotation.order = 'ZXY';
      let e = 0;
      let t = 0;
      return {
        root,
        update(frame: Frame) {
          if (!arm) return;
          const v = frame.world.machine(os.unit) as OpeningStandView | undefined;
          const reduced = ctx.reducedMotion || frame.world.reducedMotion;
          const held = hinting ? frame.world.holding() : null;
          const asking = !v?.crate && !!held && projects.has(held.id) && frame.world.setting(held.id, 'open') !== true;
          const H = STAND_FEEL.hint;
          const want = v?.crate ? 1 : asking ? H.half : 0;
          if (reduced) e = want;
          else e += Math.sign(want - e) * Math.min(Math.abs(want - e), STAND_FEEL.rate * frame.dt);
          const s = e * e * (3 - 2 * e);
          // the nod: a hop (up and down in a parabola) at the start of each period, while it asks
          t = asking ? t + frame.dt : 0;
          const u = (t % H.period) / H.hop;
          const nod = asking && !reduced && u < 1 ? 4 * u * (1 - u) * H.nod : 0;
          arm.rotation.x = STAND_FEEL.up * (s - nod);
          // and a wave side to side with each nod (a finger beckoning): about the stand's forward axis
          arm.rotation.z = asking && !reduced && u < 1 ? Math.sin(2 * Math.PI * u) * H.wag : 0;
        },
        dispose() {
          root.removeFromParent();
        },
      };
    };
  },
};
