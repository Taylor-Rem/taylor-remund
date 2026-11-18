/**
 * Hops: a loose part drawn travelling along a short arc from where it was to
 * where the simulation has already put it (REWRITE.md § B2 X3 "a toppled stack
 * un-topples", § B5 Revert's dustpan; W3 brief § 3). The simulation moves a
 * part in one step (an undo restores it at once, a put-away sets it on the
 * stack at once); this draws the trip.
 *
 * It draws over the parts view: it runs after it (a crew-order view) and, while
 * a hop plays, overwrites that part's matrix (`part:<id>`, the parts view's
 * group) with the arc's pose. When the hop lands the parts view's own pose is
 * where the part already is, so there is no jump. View only: nothing here is
 * written back.
 *
 * A hop: anticipation is the part's own stillness (it waits its turn at the
 * pose it left), then it lifts, travels on an arc whose height grows with the
 * distance, turns on the way (slerp), and lands with a little dip below its
 * resting place that springs back. A chain of hops plays one after another,
 * staggered, last moved first.
 */
import { Matrix4, Quaternion, Vector3, type Object3D, type Scene } from 'three';
import type { Id, Pose } from '../../sim/types.ts';

/** Tune here. Seconds and units. */
export const HOP_FEEL = {
  /** A hop's length: a base and a little more per unit of distance, at most this long. */
  base: 0.32,
  perUnit: 0.07,
  max: 0.7,
  /** Arc height: a base plus this much per unit of distance, at most this high. */
  height: 0.28,
  heightPerUnit: 0.12,
  heightMax: 1.1,
  /** One hop starts this long after the one before it (a toppled stack: last moved first). */
  stagger: 0.11,
  /** The landing: a dip below the rest pose (units) that springs back over this long. */
  land: 0.05,
  landTime: 0.18,
} as const;

interface Hop {
  id: Id;
  from: Pose;
  /** Where it lands: a pose, or (when null) wherever the simulation says it is now. */
  to: Pose | null;
  /** A point the arc passes over (a dustpan), or null. */
  via: Vector3 | null;
  start: number;
  dur: number;
  height: number;
  /** After it lands, the part is hidden (it went down a hatch): its group is left invisible. */
  vanish: boolean;
  /** Seconds after the landing to keep drawing it there (the parts view takes over after). */
  stay: number;
}

const pa = new Vector3();
const pb = new Vector3();
const pc = new Vector3();
const qa = new Quaternion();
const qb = new Quaternion();
const one = new Vector3(1, 1, 1);
const m = new Matrix4();

/** Quadratic Bézier through a control point lifted above the middle (or above `via`). */
function arc(out: Vector3, a: Vector3, b: Vector3, via: Vector3 | null, h: number, u: number): Vector3 {
  if (via) {
    // two halves: a → via, via → b, each its own small arc
    if (u < 0.5) return arc(out, a, via, null, h * 0.6, u * 2);
    return arc(out, via, b, null, h * 0.6, (u - 0.5) * 2);
  }
  const k = 1 - u;
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, cy = Math.max(a.y, b.y) + h * 2;
  out.set(k * k * a.x + 2 * k * u * cx + u * u * b.x, k * k * a.y + 2 * k * u * cy + u * u * b.y, k * k * a.z + 2 * k * u * cz + u * u * b.z);
  return out;
}

export interface PartHops {
  /** Hop `id` from `from` to where it is now (or to `to`), starting at `start` (simulation seconds). */
  add(id: Id, from: Pose, start: number, o?: { to?: Pose; via?: Vector3; vanish?: boolean; stay?: number; dur?: number }): void;
  /** A chain: each part starts `stagger` after the last. Returns the time the last one lands. */
  chain(items: readonly { id: Id; from: Pose }[], start: number): number;
  /** Draw every hop in flight. Call each frame after the parts view has drawn. */
  update(time: number, now: (id: Id) => Pose | undefined): void;
  /** Is this part mid-hop (or waiting its turn)? */
  busy(id: Id): boolean;
  clear(): void;
}

export function createHops(scene: Scene): PartHops {
  const F = HOP_FEEL;
  const hops: Hop[] = [];
  const groups = new Map<Id, Object3D | null>();
  const group = (id: Id): Object3D | null => {
    let g = groups.get(id);
    if (g === undefined || (g && !g.parent)) {
      g = scene.getObjectByName(`part:${id}`) ?? null;
      groups.set(id, g);
    }
    return g;
  };
  const span = (a: Pose, b: Pose | null): number => (b ? Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) : 1);

  return {
    add(id, from, start, o = {}) {
      for (let i = hops.length - 1; i >= 0; i--) if (hops[i]!.id === id) hops.splice(i, 1);
      const d = span(from, o.to ?? null);
      hops.push({
        id,
        from,
        to: o.to ?? null,
        via: o.via ? o.via.clone() : null,
        start,
        dur: o.dur ?? Math.min(F.max, F.base + F.perUnit * d),
        height: Math.min(F.heightMax, F.height + F.heightPerUnit * d),
        vanish: o.vanish ?? false,
        stay: o.stay ?? 0,
      });
    },
    chain(items, start) {
      let t = start;
      let end = start;
      for (const it of items) {
        this.add(it.id, it.from, t);
        const h = hops[hops.length - 1]!;
        end = Math.max(end, t + h.dur);
        t += F.stagger;
      }
      return end;
    },
    busy(id) {
      return hops.some((h) => h.id === id);
    },
    update(time, now) {
      for (let i = hops.length - 1; i >= 0; i--) {
        const h = hops[i]!;
        const g = group(h.id);
        const age = time - h.start;
        const end = h.dur + F.landTime + h.stay;
        if (!g || age > end) {
          if (g && h.vanish) g.visible = false;
          hops.splice(i, 1);
          continue;
        }
        const to = h.to ?? now(h.id);
        if (!to) continue;
        pa.set(h.from.p[0], h.from.p[1], h.from.p[2]);
        pb.set(to.p[0], to.p[1], to.p[2]);
        qa.set(h.from.q[0], h.from.q[1], h.from.q[2], h.from.q[3]);
        qb.set(to.q[0], to.q[1], to.q[2], to.q[3]);
        // the height of the part's centre above its lowest point does not change: the parts view composes the same way
        if (age < 0) {
          // waiting its turn where it was left
          m.compose(pa, qa, one);
        } else if (age < h.dur) {
          const u = age / h.dur;
          // lift off quick, hang, come down: an eased parameter along the arc
          const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
          arc(pc, pa, pb, h.via, h.height, 0.15 * u + 0.85 * e);
          qa.slerp(qb, Math.min(1, e * 1.1));
          m.compose(pc, qa, one);
        } else {
          // landed: a dip that springs back
          const k = Math.min(1, (age - h.dur) / F.landTime);
          pb.y -= F.land * Math.sin(Math.PI * k) * (1 - k * 0.5);
          m.compose(pb, qb, one);
        }
        g.visible = true;
        g.matrix.copy(m);
        g.matrixWorldNeedsUpdate = true;
      }
    },
    clear() {
      hops.length = 0;
    },
  };
}
