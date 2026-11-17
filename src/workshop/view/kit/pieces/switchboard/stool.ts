/**
 * Patch's stool (art-direction § 10 SWITCHBOARD). Registry name `stool`.
 *
 * A round wooden seat, dished and worn pale where it is sat on, on four
 * turned legs (a foot, a bead, a waist, a swell, a neck into the seat)
 * splayed a little, tied by four rungs at two heights. Seeded: the legs'
 * splay and the seat's set differ a touch.
 *
 * Origin: the floor under the seat's centre. Socket `seat`: the top of the
 * seat (SEAT_Y), +Y up: Patch's `root` goes here.
 */
import { Vector3 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { aim, mat, part, piece, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { grain } from '../../space.ts';

/** Height of the seat's top: a 1.1-unit seated character's paws reach the live jacks (BOARD.jackY 1.6) from here. */
export const SEAT_Y = 0.6;

export function stool(o: KitOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('stool', { detail, seed });
  const top = SEAT_Y;
  const t = 0.075; // seat thickness
  const rs = 0.31; // seat radius

  // ---- the seat: a turned disc, its top dished, its rim rounded over -------------
  {
    const y0 = top - t;
    const g = lathe(
      profile(0, y0 + 0.004)
        .to(rs - 0.05, y0, { fillet: 0.02, segs: 2 })
        .to(rs, y0 + 0.03, { fillet: 0.03, segs: 3 })
        .to(rs, top - 0.022, { fillet: 0.02, segs: 3 })
        .to(rs - 0.06, top, { smooth: true })
        .curve(0, top - 0.008, rs * 0.45, top - 0.012, hi ? 4 : 2),
      { segs: hi ? 30 : 18, detail },
    );
    // the grain runs across the seat (it is a plank, not end grain); a little out of round
    grain(g, 'x');
    deform(g, (x, y, z) => [x * 1.015, y + 0.004 * Math.sin(x * 9 + seed), z * 0.99], { keepSurf: true });
    b.add(part('wood', transform(g, mat({ rot: [R.spread(1.2), R.range(0, 360), R.spread(1.2)] })), 'wood', { seed, shade: 0.4, jitter: 0.05 }));
  }

  // ---- the legs ---------------------------------------------------------------------
  const footR = 0.3, headR = 0.18, headY = top - t + 0.01;
  const legs: Array<{ foot: Vector3; head: Vector3 }> = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2 + R.spread(0.06);
    const fr = footR + R.spread(0.012);
    const foot = new Vector3(Math.cos(a) * fr, 0.008, Math.sin(a) * fr); // lifted by the splayed foot's tilt, so its rim rests on the bench
    const head = new Vector3(Math.cos(a) * headR, headY, Math.sin(a) * headR);
    legs.push({ foot, head });
    const L = foot.distanceTo(head);
    const s = L / 0.53;
    const pr = profile(0, 0)
      .to(0.042, 0, { fillet: 0.008, segs: 1 })
      .to(0.048, 0.05 * s, { smooth: true })
      .to(0.038, 0.17 * s, { smooth: true })
      .to(0.039, 0.2 * s, { fillet: 0.004, segs: 1 })
      .to(0.053, 0.215 * s, { fillet: 0.008, segs: 2 })
      .to(0.039, 0.235 * s, { fillet: 0.004, segs: 1 })
      .to(0.034, 0.3 * s, { smooth: true })
      .to(0.043, 0.41 * s, { smooth: true })
      .to(0.031, 0.5 * s, { smooth: true })
      .to(0.034, L, { sharp: true })
      .to(0, L);
    const g = lathe(pr, { segs: hi ? 10 : 7, detail, band: 0 });
    const dir = head.clone().sub(foot).normalize();
    b.add(part('wood', transform(g, aim([foot.x, foot.y, foot.z], [dir.x, dir.y, dir.z], R.range(0, 360))), 'wood', { seed: seed + 10 + k, shade: 0.33, jitter: 0.06 }));
  }

  // ---- the rungs: front and back low, the sides a little higher (they cross clear) ------
  for (let k = 0; k < 4; k++) {
    const A = legs[k]!, B = legs[(k + 1) % 4]!;
    const h = k % 2 === 0 ? 0.19 : 0.25;
    const at = (l: { foot: Vector3; head: Vector3 }): Vector3 => l.foot.clone().lerp(l.head, h / headY);
    const pa = at(A), pb = at(B);
    // into the legs' centres, so the rung ends are hidden inside them
    const L = pa.distanceTo(pb);
    const g = lathe(
      profile(0, 0).to(0.02, 0, { sharp: true }).to(0.023, 0.15 * L, { smooth: true }).to(0.028, 0.5 * L, { smooth: true }).to(0.023, 0.85 * L, { smooth: true }).to(0.02, L, { sharp: true }).to(0, L),
      { segs: hi ? 8 : 6, detail, band: 0, caps: false },
    );
    const d = pb.clone().sub(pa).normalize();
    b.add(part('wood', transform(g, aim([pa.x, pa.y, pa.z], [d.x, d.y, d.z])), 'wood', { seed: seed + 20 + k, shade: 0.31, jitter: 0.06 }));
  }

  b.socket('seat', T(0, top, 0));
  return b.build();
}
