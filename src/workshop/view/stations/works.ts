/**
 * Rung 4, "the works" (REWRITE.md § B4: every station the visitor has
 * already used misfires together, sparks, a turning warning lamp, the crate
 * stack comes down, then the whole bench runs backwards; W3 round 2):
 *
 *  - the warning beacon on the Button's console: dark and grimy from the
 *    first moment of the visit; on the rung's `warning` beat it lights and
 *    its reflector turns (a little over one turn a second: the bright side
 *    comes round slower than three times a second), and the lamp's bounce
 *    light, borrowed (`lights.setBeacon`), sweeps an amber wash round the
 *    bench with it. Through the rewind it turns backwards, slowing, and at
 *    the end of the rung it goes dark. Reduced motion: lit, steady, no sweep;
 *  - sparks at each station the `sparks` beat names, from a point where that
 *    station would spark (its anchor, given by the bench), a few bursts each
 *    over the rung, staggered; never two bursts at one station closer than
 *    0.8 s. Not with reduced motion.
 *
 * The stations' own misfires, the lamp's dip, the stack and the rewind of
 * every part are drawn by their own views.
 */
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import type { Id, Vec3, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { beacon as beaconPiece, poseBeacon, BEACON } from '../kit/pieces/beacon/index.ts';
import { sparks as sparksPiece, poseSparks } from '../kit/pieces/sparks/index.ts';

/** Tune here. Seconds, radians. */
export const WORKS_FEEL = {
  /** Where the beacon stands on the console (the console's frame: x right, z toward the visitor; y its deck). */
  beaconAt: [0.8, 0, -0.6] as readonly [number, number, number],
  /** Drawn this much bigger than built: big enough to wonder about from the home view. */
  beaconScale: 2.0,
  /** The reflector's speed (turns per second); during the rewind it runs back at this share, slowing to a stop. */
  turns: 1.1,
  rewindTurns: 0.8,
  /** The wash: fades in and out over these. */
  washIn: 0.25,
  washOut: 0.4,
  /** Sparks: bursts per station, the gap between them, and how much each station waits after the one before. */
  bursts: 4,
  /** Sparks are drawn this much bigger than built, to read from the home view. */
  sparkScale: 2.4,
  gap: 0.95,
  stagger: 0.13,
} as const;

export interface WorksViewOptions {
  /** Where each station sparks (world), by station id. Stations not listed spark at their ladder point. */
  anchors?: Readonly<Record<Id, Vec3>>;
  seed?: number;
  /** (L2) The Button's console is drawn at this share of its size as built: the beacon on it with it (default 1). */
  consoleScale?: number;
}

interface Burst {
  obj: Object3D;
  /** When each of its bursts starts (simulation time). */
  starts: number[];
  seed: number;
}

export interface WorksView extends StationView {
  readonly state: { lit: boolean; angle: number; bursts: number };
}

export function createWorksView(opts: WorksViewOptions = {}): (ctx: ViewContext) => WorksView {
  return (ctx) => {
    const F = WORKS_FEEL;
    const root = new Group();
    root.name = 'works';
    ctx.scene.add(root);
    const detail = ctx.tier === 'low' ? 'low' : 'high';
    const beaconObj = ctx.realize(beaconPiece({ seed: opts.seed ?? 4, detail }));
    root.add(beaconObj);
    const sparkPool = new Map<Id, Burst>();
    let placed = false;
    let ladder: readonly { id: Id; at: Vec3 }[] = [];
    // the beacon
    let lit = false;
    let litAt = -Infinity;
    let rewindAt = -Infinity;
    let rewindFor = 2;
    let offAt = -Infinity;
    let angle = 0;
    let rate = 0;
    const lightAt: [number, number, number] = [0, 0, 0];
    const tmp = new Vector3();
    const state = { lit: false, angle: 0, bursts: 0 };

    const place = (w: WorldView): void => {
      placed = true;
      const s = w.scene.statics.find((x) => x.id === 'console');
      const top = w.scene.bench.top;
      const q = s ? new Quaternion(s.pose.q[0], s.pose.q[1], s.pose.q[2], s.pose.q[3]) : new Quaternion();
      const deck = s ? s.pose.p[1] + (s.shape.type === 'box' ? s.shape.half[1] : 0.52) : top + 1.04;
      const cs = opts.consoleScale ?? 1;
      const p = new Vector3(F.beaconAt[0] * cs, 0, F.beaconAt[2] * cs).applyQuaternion(q);
      beaconObj.position.set((s?.pose.p[0] ?? 0) + p.x, deck, (s?.pose.p[2] ?? 0) + p.z);
      beaconObj.quaternion.copy(q);
      beaconObj.scale.setScalar(F.beaconScale * cs);
      tmp.set(0, (BEACON.pivot + BEACON.domeH * 0.55) * F.beaconScale * cs, 0).applyQuaternion(q).add(beaconObj.position);
      lightAt[0] = tmp.x;
      lightAt[1] = tmp.y;
      lightAt[2] = tmp.z;
      ladder = w.scene.button.ladder?.stations ?? [];
      poseBeacon(beaconObj, { lit: false });
    };

    const anchorOf = (id: Id): Vec3 | null => opts.anchors?.[id] ?? ladder.find((s) => s.id === id)?.at ?? null;

    const burstAt = (id: Id, at: Vec3, start: number, k: number): void => {
      let b = sparkPool.get(id);
      if (!b) {
        const obj = ctx.realize(sparksPiece({ seed: 11 + sparkPool.size, detail }));
        obj.position.set(at[0], at[1], at[2]);
        obj.scale.setScalar(F.sparkScale);
        obj.visible = false;
        root.add(obj);
        b = { obj, starts: [], seed: 0 };
        sparkPool.set(id, b);
      }
      b.starts.length = 0;
      for (let i = 0; i < F.bursts; i++) b.starts.push(start + k * F.stagger + i * F.gap + (i * 0.17 * ((k % 3) - 1)));
      b.seed = (b.seed + 7) % 9973;
    };

    const view: WorksView = {
      root,
      state,
      update(frame: Frame) {
        const w = frame.world;
        if (!placed) place(w);
        const now = frame.time;
        const dt = Math.min(frame.dt, 0.1);
        const reduced = ctx.reducedMotion || w.reducedMotion;
        for (const e of frame.events) {
          if (e.type === 'rung.beat' && e.beat === 'warning') {
            lit = true;
            litAt = now;
            rewindAt = -Infinity;
            offAt = -Infinity;
          } else if (e.type === 'rung.beat' && e.beat === 'sparks' && !reduced) {
            e.ids.forEach((id, k) => {
              const at = anchorOf(id);
              if (at) burstAt(id, at, now, k);
            });
          } else if (e.type === 'rung.rewinding' && lit) {
            rewindAt = now;
            rewindFor = e.duration;
          } else if (e.type === 'rung.ended' && lit) {
            lit = false;
            offAt = now;
          }
        }

        // ── the beacon ──
        if (lit && !reduced) {
          if (rewindAt > -Infinity) {
            // backwards with the bench, slowing to a stop as the rewind ends
            const k = Math.min(1, (now - rewindAt) / Math.max(0.1, rewindFor));
            rate = -2 * Math.PI * F.rewindTurns * (1 - k * k);
          } else {
            // spins up over a quarter second, as a motor does
            const k = Math.min(1, (now - litAt) / 0.25);
            rate = 2 * Math.PI * F.turns * k * (2 - k);
          }
          angle += rate * dt;
        } else if (!lit) rate = 0;
        if (reduced) angle = 0;
        // off: one last fraction of a turn as it coasts (the lamp is out)
        poseBeacon(beaconObj, { lit, angle });
        state.lit = lit;
        state.angle = angle;

        // its wash: the bounce light swung round with the bright side
        const inK = Math.min(1, (now - litAt) / F.washIn);
        const outK = 1 - Math.min(1, (now - offAt) / F.washOut);
        const strength = lit ? inK : offAt > -Infinity ? Math.max(0, outK) : 0;
        if (strength > 0.001) {
          const a = reduced ? 0 : angle + beaconObj.rotation.y;
          ctx.stage.lights.setBeacon({ at: lightAt, angle: a, strength });
        } else ctx.stage.lights.setBeacon(null);

        // ── sparks ──
        let bursts = 0;
        for (const b of sparkPool.values()) {
          let any = false;
          for (let i = 0; i < b.starts.length; i++) {
            const t = now - b.starts[i]!;
            if (t < -0.01 || t > 0.8) continue;
            any = poseSparks(b.obj, { t, seed: b.seed * 31 + i }) || any;
            if (any) break;
          }
          b.obj.visible = any;
          if (any) bursts++;
        }
        state.bursts = bursts;
      },
      dispose() {
        ctx.stage.lights.setBeacon(null);
        root.removeFromParent();
      },
    };
    return view;
  };
}
