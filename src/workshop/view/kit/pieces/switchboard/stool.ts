/**
 * Patch's stool (art-direction § 10 SWITCHBOARD): a tall operator's stool.
 * Registry name `stool`.
 *
 * A round, dished seat with a worn pale edge, high on four splayed turned
 * legs (a ball foot, a bead, a cove, a long swell, a collar under the
 * seat), a brass foot ring a third of the way up where the feet rest
 * (polished bright on top), and four stretchers just under the seat. Pale
 * `wood-light`, so the stool and Patch separate from the dark walnut bench
 * and the board's frame. Seeded: the legs' splay and the seat's set are a
 * little out of true.
 *
 * Origin: the floor under the seat's centre. Socket `seat`: the top of the
 * seat (SEAT_Y), +Y up: Patch's `root` goes here. At this height Patch's
 * `reach` preset puts its paw level with the board's live jacks (BOARD.jackY).
 */
import { Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { aim, mat, part, piece, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { sweep } from '../../sweep.ts';

/**
 * Height of the seat's top. Patch's root sits here; its `reach` paw then comes
 * up to about SEAT_Y + 0.41 (1.56), the live jacks' escutcheons (BOARD.jackY 1.6).
 */
export const SEAT_Y = 1.15;
/** Height of the brass foot ring (about a third of the way up). */
export const FOOT_RING_Y = 0.4;

/**
 * Turned legs are all curvature, so their measured wear runs high along the whole length and the
 * wood material sands them pale grey. Keep a third of it: the beads' crowns still read worn.
 */
function calm(g: BufferGeometry): BufferGeometry {
  const sf = g.getAttribute('surf');
  for (let i = 0; i < sf.count; i++) sf.setX(i, sf.getX(i) * 0.35);
  sf.needsUpdate = true;
  return g;
}

export function stool(o: KitOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('stool', { detail, seed });
  const top = SEAT_Y;
  const t = 0.085; // seat thickness
  const rs = 0.29; // seat radius
  const seatTilt = mat({ rot: [R.spread(1.6), 0, R.spread(1.6)] });

  // ---- the seat: a turned disc, dished, its rim rounded over and worn pale ------------
  {
    const y0 = top - t;
    const g = lathe(
      profile(0, y0 + 0.006)
        .to(rs - 0.06, y0, { fillet: 0.02, segs: 2 })
        .to(rs, y0 + 0.032, { fillet: 0.03, segs: 2 })
        .to(rs, top - 0.024, { fillet: 0.022, segs: 3 })
        .to(rs - 0.07, top, { smooth: true })
        .curve(0, top - 0.012, rs * 0.4, top - 0.016, hi ? 3 : 2),
      { segs: hi ? 26 : 16, detail },
    );
    // a plank, not end grain; a little out of round and not quite flat
    grain(g, 'x');
    deform(g, (x, y, z) => [x * 1.015, y + 0.004 * Math.sin(x * 9 + seed), z * 0.99]);
    b.add(part('wood', transform(g, seatTilt), 'wood-light', { seed, shade: 1.0, jitter: 0.04 }));
  }

  // ---- the legs: splayed, turned with bold beads and coves -------------------------------
  const footR = 0.36, headR = 0.17, headY = top - t + 0.012;
  const legs: Array<{ foot: Vector3; head: Vector3 }> = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2 + R.spread(0.05);
    const fr = footR + R.spread(0.015);
    // lifted by the splayed foot's tilt, so its rim rests on the bench
    const foot = new Vector3(Math.cos(a) * fr, 0.008, Math.sin(a) * fr);
    const head = new Vector3(Math.cos(a) * headR, headY, Math.sin(a) * headR);
    legs.push({ foot, head });
    const L = foot.distanceTo(head);
    const u = (f: number): number => f * L;
    // radii are toy-chunky; each bead is a short flat band between two quick turns, so it reads as a ring
    const pr = profile(0, 0)
      .to(0.05, 0, { smooth: true })
      .to(0.064, u(0.03), { smooth: true }) // the ball foot
      .to(0.044, u(0.075), { smooth: true }) // its neck
      .to(0.05, u(0.3), { smooth: true })
      .to(0.072, u(0.345), { sharp: true }) // a bold bead at the foot ring
      .to(0.072, u(0.385), { sharp: true })
      .to(0.044, u(0.43), { smooth: true }) // a cove above it
      .to(0.056, u(0.56), { smooth: true }) // the long swell
      .to(0.044, u(0.73), { smooth: true })
      .to(0.066, u(0.77), { sharp: true }) // the bead under the stretchers
      .to(0.066, u(0.8), { sharp: true })
      .to(0.042, u(0.85), { smooth: true })
      .to(0.052, u(0.96), { smooth: true }) // the collar into the seat
      .to(0.046, L, { sharp: true })
      .to(0, L);
    const g = calm(lathe(pr, { segs: hi ? 9 : 6, detail, band: 0 }));
    const dir = head.clone().sub(foot).normalize();
    b.add(part('wood', transform(g, aim([foot.x, foot.y, foot.z], [dir.x, dir.y, dir.z], R.range(0, 360))), 'wood-light', { seed: seed + 10 + k, shade: 0.8, jitter: 0.06 }));
  }
  const onLeg = (l: { foot: Vector3; head: Vector3 }, y: number): Vector3 => l.foot.clone().lerp(l.head, (y - l.foot.y) / (l.head.y - l.foot.y));

  // ---- the brass foot ring, through the legs at the bead, polished on top where feet rest --
  {
    const pts: Array<[number, number, number]> = [];
    const n = hi ? 28 : 16;
    const rr = onLeg(legs[0]!, FOOT_RING_Y).setY(0).length();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([Math.cos(a) * rr, FOOT_RING_Y + 0.004 * Math.sin(a * 3 + seed), Math.sin(a) * rr]);
    }
    const ring = sweep({ points: pts.map((p) => new Vector3(...p)), closed: true }, { radius: 0.02, segs: hi ? 7 : 5, detail });
    // the top of the ring is worn bright by heels; the underside keeps its patina
    b.add(setFinish(part('brass', ring, 'brass', { seed: seed + 30, warm: 0.04 }), 0.9, (_x, y) => y > FOOT_RING_Y + 0.008));
  }

  // ---- the stretchers, just under the seat, staggered so they cross clear ------------------
  for (let k = 0; k < 4; k++) {
    const A = legs[k]!, B = legs[(k + 1) % 4]!;
    const y = k % 2 === 0 ? 0.86 : 0.9;
    const pa = onLeg(A, y), pb = onLeg(B, y);
    const L = pa.distanceTo(pb);
    const g = lathe(
      profile(0, 0).to(0.024, 0, { sharp: true }).to(0.03, 0.2 * L, { smooth: true }).to(0.036, 0.5 * L, { smooth: true }).to(0.03, 0.8 * L, { smooth: true }).to(0.024, L, { sharp: true }).to(0, L),
      { segs: hi ? 7 : 5, detail, band: 0, caps: false },
    );
    calm(g);
    const d = pb.clone().sub(pa).normalize();
    b.add(part('wood', transform(g, aim([pa.x, pa.y, pa.z], [d.x, d.y, d.z])), 'wood-light', { seed: seed + 20 + k, shade: 0.85, jitter: 0.06 }));
  }

  b.socket('seat', T(0, top, 0));
  return b.build();
}
