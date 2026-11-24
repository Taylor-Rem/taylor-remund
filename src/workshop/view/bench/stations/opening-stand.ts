/**
 * P4 S6, a prototype behind one switch (`?open=stand`): the opening stand drawn where the scene puts it (its static body,
 * sim/scenes/bench.ts `withOpeningStand`). Its body is merged into the set (no draw call of its own); what moves is its
 * own small object. `?standLook=` picks the look:
 *  - 0 (round one): the low table; its lifter lies on the deck and stands up behind an open crate's lid.
 *  - 1, 2 (round two, the owner's "a decorated stand that communicates … put a box on it"): a pedestal with a crate's
 *    outline painted on its deck and an arm waiting over it (kit/pieces/opening-stand/station.ts); 1 a lifter arm, 2 an
 *    inspection lamp. The arm answers a carried project crate, beats now and then when idle (and on the registry's
 *    tell), and lifts the lid of a crate opening on it (the lid waits for it: parts.ts `LID_HOLD`). Its moves:
 *    view/bench/stand-arm.ts.
 * Reduced motion: cuts. `?standTape=1`: with a strip of label tape on its front (src/content/room.json `stand`).
 */
import { Group, type Object3D } from 'three';
import type { Id, OpeningStandView } from '../../../sim/types.ts';
import type { Frame } from '../../types.ts';
import { openingStand } from '../../kit/pieces/opening-stand/index.ts';
import { standStation, STAND_ARM } from '../../kit/pieces/opening-stand/station.ts';
import { LID_OPEN } from '../../kit/pieces/crate/index.ts';
import { room } from '../../kit/pieces/room/words.ts';
import { ORDER, at, type BenchStation } from '../station.ts';
import { splitStatic } from '../../stations/set.ts';
import { ARM_FEEL, ease, lidEdge, pose, type ArmBones, type ArmSpec, type V3 } from '../stand-arm.ts';
import { LID_HOLD, LID_NOW } from './parts.ts';

/** Tune here: how far the round-one lifter swings up (radians) and how fast (share a second). */
export const STAND_FEEL = { up: (-100 * Math.PI) / 180, rate: 1.6 } as const;

const query = (k: string): string | null => {
  try {
    return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get(k);
  } catch {
    return null;
  }
};
/** The look asked for: 0 (round one), 1 or 2. */
export const standLook = (): 0 | 1 | 2 => {
  const l = query('standLook');
  return l === '1' ? 1 : l === '2' ? 2 : 0;
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
    const origin: V3 = [x, base, z];
    const taped = query('standTape') === '1';
    const look = standLook();
    const projects = new Map((k.scene.projects ?? []).map((c) => [c.crate, c]));
    return (ctx) => {
      const key = taped && look === 0 ? ctx.labels.tape(room.stand, 'black') : null;
      const piece =
        look === 0
          ? openingStand({ h, seed: k.seed, half: [half[0], half[2]], ...(key ? { tape: { key, ...ctx.labels.size(key) } } : {}) })
          : standStation({ look, h, seed: k.seed, half: [half[0], half[2]] });
      // the body into the set's pool; what moves (and the bare nodes above it) realized on its own, its bones driven
      const moving = splitStatic(piece, at(x, base, z), (n) => n === 'lifter' || n === 'yaw', k.pool);
      const root = new Group();
      root.name = 'opening-stand';
      ctx.scene.add(root);
      const whole = ctx.realize(moving);
      whole.applyMatrix4(at(x, base, z));
      root.add(whole);
      const reducedOf = (frame: Frame) => ctx.reducedMotion || frame.world.reducedMotion;

      if (look === 0) {
        const arm = whole.getObjectByName('lifter') ?? null;
        let e = 0;
        return {
          root,
          update(frame: Frame) {
            if (!arm) return;
            const v = frame.world.machine(os.unit) as OpeningStandView | undefined;
            const want = v?.crate ? 1 : 0;
            if (reducedOf(frame)) e = want;
            else e += Math.sign(want - e) * Math.min(Math.abs(want - e), STAND_FEEL.rate * frame.dt);
            arm.rotation.x = STAND_FEEL.up * e * e * (3 - 2 * e);
          },
          dispose() {
            root.removeFromParent();
          },
        };
      }

      // ---- looks 1 and 2: the arm ----
      const A = STAND_ARM[look];
      const spec: ArmSpec = { look, shoulder: [A.at[0], h + A.post, A.at[1]], upper: A.upper, fore: A.fore, deck: h };
      const find = (n: string): Object3D | null => whole.getObjectByName(n) ?? null;
      const bones = { yaw: find('yaw'), upper: find('upper'), fore: find('fore'), tip: find('tip'), lit: find('lit') };
      if (!bones.yaw || !bones.upper || !bones.fore || !bones.tip) return { root, update() {}, dispose: () => root.removeFromParent() };
      const B = bones as ArmBones;
      // poised: over the outline's middle, a hand's height above a large crate's top, the tip level (1) or looking down (2)
      const poised: V3 = look === 1 ? [-0.05, h + 0.62, 0.05] : [0.15, h + 0.7, -0.05];
      const cur: V3 = [...poised];
      let pitch = look === 1 ? -0.2 : -1.2;
      let lit = 0;
      let lastCrate: Id | null = null;
      // the idle beat: when the next starts (scene seconds), seeded
      let seedN = (k.seed * 9301 + 49297) % 233280;
      const rand = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
      let nextBeat = 4 + rand() * ARM_FEEL.jitter;
      let beatAt = -Infinity;
      const local = (p: readonly number[]): V3 => [p[0]! - origin[0], p[1]! - origin[1], p[2]! - origin[2]];

      return {
        root,
        update(frame: Frame) {
          const w = frame.world;
          const t = frame.time;
          const reduced = reducedOf(frame);
          const v = w.machine(os.unit) as OpeningStandView | undefined;
          const open = v?.crate ?? null;
          let goal: V3 = poised;
          let goalPitch = look === 1 ? -0.2 : -1.2;
          let rate: number = ARM_FEEL.follow;
          let glow = 0;
          // the registry's tell (and the idle beat): a beat now
          for (const e of frame.events) if (e.type === 'tell' && (e as { id?: Id }).id === os.unit) beatAt = t;
          if (open) {
            // a crate opening (or open) on it: under the lid's front edge, riding it up
            if (open !== lastCrate && !reduced) LID_HOLD.set(open, t + ARM_FEEL.lead);
            const m = w.motion(open);
            const hf = w.halfExtents?.(open) as V3 | undefined;
            if (m && hf) {
              const lid = Math.min(1, LID_NOW.get(open) ?? 0);
              const e = lidEdge({ p: m.pose.p as V3, q: m.pose.q as [number, number, number, number] }, hf, lid, LID_OPEN, origin);
              // under the edge: out along the lid's outward normal, and the tip turned as the lid is
              goal = [e.at[0], e.at[1] - ARM_FEEL.under, e.at[2] + 0.02];
              // (1 reaches in from the side: its paddle level under the edge; 2 from behind: its shade's lip under it)
              goalPitch = look === 1 ? 0.1 : e.angle - Math.PI / 2;
              rate = ARM_FEEL.ride;
              if (look === 2 && lid > 0.95) {
                // then it lets the lid be and leans in to look into the crate
                const c = local(m.pose.p);
                goal = [c[0] + 0.05, c[1] + hf[1] + 0.32, c[2] + hf[2] + 0.12];
                goalPitch = -1.15;
                rate = ARM_FEEL.follow;
                glow = 1;
              }
            }
          } else {
            const held = w.holding();
            const hc = held && projects.has(held.id) && w.setting(held.id, 'open') !== true ? w.motion(held.id) : null;
            if (hc) {
              const c = local(hc.pose.p);
              const dist = Math.hypot(c[0], c[2]);
              const dx = c[0] - spec.shoulder[0], dz = c[2] - spec.shoulder[2];
              const dl = Math.hypot(dx, dz) || 1;
              // turned to it: out from the shoulder toward it, raised (1: to meet it; 2: to look at it)
              const out = look === 1 ? 0.5 : 0.42;
              goal = [spec.shoulder[0] + (dx / dl) * out, h + (look === 1 ? 0.95 : 0.82), spec.shoulder[2] + (dz / dl) * out];
              const dy = c[1] - goal[1];
              goalPitch = Math.atan2(dy, Math.hypot(c[0] - goal[0], c[2] - goal[2]));
              if (look === 1) goalPitch = Math.max(-0.4, Math.min(0.5, goalPitch));
              glow = look === 2 ? Math.max(0, Math.min(1, (ARM_FEEL.near - dist) / (ARM_FEEL.near - ARM_FEEL.full))) : 0;
            } else if (!reduced) {
              if (t > nextBeat) {
                beatAt = t;
                nextBeat = t + ARM_FEEL.every + rand() * ARM_FEEL.jitter;
              }
              const u = (t - beatAt) / ARM_FEEL.beat[look];
              if (u >= 0 && u < 1) {
                if (look === 1) {
                  // a tap on the empty deck: down, two little taps, back
                  const s = Math.sin(Math.PI * Math.min(1, u * 1.6));
                  const taps = u > 0.25 && u < 0.7 ? Math.abs(Math.sin((u - 0.25) * Math.PI * 4.4)) * 0.04 : 0;
                  goal = [poised[0], poised[1] - s * (poised[1] - h - 0.03) + taps, poised[2] - 0.05 * s];
                  goalPitch = -0.2 - 0.4 * s;
                  rate = 12;
                } else {
                  // a sweep of the empty outline: its look goes round the four corners
                  const a = u * Math.PI * 2;
                  goal = [poised[0] + 0.18 * Math.sin(a), poised[1], poised[2] + 0.14 * Math.cos(a)];
                  goalPitch = -1.0 - 0.25 * Math.sin(a * 2);
                  B.yaw.rotation.z = 0;
                  glow = 0.35 * Math.sin(Math.PI * u);
                }
              }
            }
          }
          lastCrate = open;
          if (reduced) {
            cur[0] = goal[0]; cur[1] = goal[1]; cur[2] = goal[2];
            pitch = goalPitch;
            lit = glow;
          } else {
            ease(cur, goal, rate, frame.dt);
            const k2 = 1 - Math.exp(-rate * frame.dt);
            pitch += (goalPitch - pitch) * k2;
            lit += (glow - lit) * (1 - Math.exp(-8 * frame.dt));
          }
          pose(spec, B, cur, pitch);
          if (B.lit) {
            const s = lit > 0.02 ? 0.4 + 0.6 * lit : 0.0001;
            B.lit.scale.setScalar(s);
            B.lit.visible = lit > 0.02;
          }
        },
        dispose() {
          root.removeFromParent();
        },
      };
    };
  },
};
