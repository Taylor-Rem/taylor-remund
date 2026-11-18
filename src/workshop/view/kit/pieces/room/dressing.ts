/**
 * What stands in the dark past the bench's ends (V; REWRITE.md § A "The
 * dark has something in it"; ART-P2 § 5): a few dim, generic workshop
 * shapes at the room's edge. Silhouettes with a rim of cool light; never
 * usable, never brighter than the darkest thing on the bench; nothing that
 * says anything about anyone (no memento, photograph, book title, logo or
 * hobby): steel shelving with plain boxes and tins, a hanging cable, a run
 * of painted pipe with a junction box, a stool on the floor.
 *
 *   roomEnd({ side: 'left' | 'right', floor })
 *
 * Origin: where the bench's end meets the back wall's face, at the bench
 * top's height (place at (±9, 0, -5) for an 18-wide bench). 'left' builds
 * toward -X, 'right' toward +X; z grows from the wall toward the visitor.
 *
 * Classes: steel (enamel: shelving, pipe), wood (shelves, boxes, the stool),
 * rubber (the cable). Seen only from the front: no backs, no undersides.
 */
import { CatmullRomCurve3, Matrix4, Vector3, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import { aim, chain, mergeGeometries, part, piece, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { curvePath, sweep } from '../../sweep.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { rng, type Rng } from '../../rng.ts';
import { grain } from '../../space.ts';
import { tint } from '../../surface.ts';
import { FLOOR_Y } from '../bench/frame.ts';
import type { Token } from '../../../palette.ts';

export interface RoomEndOptions extends KitOptions {
  side: 'left' | 'right';
  /** The floor's height (default FLOOR_Y). */
  floor?: number;
}

/** How far the room's things are taken down from their tokens: dim, so the bench stays the only bright thing. */
export const DIM = 0.2;

type Tone = { token: Token; shade: number };

function toned(g: BufferGeometry, R: Rng, t: Tone, jitter = 0.08): BufferGeometry {
  return tint(g, t.token, { seed: R.int(0, 1e6), jitter, shade: t.shade * DIM, warm: R.spread(0.04) });
}

/** A rectangle tube's worth of angle steel, upright: a front face and the one return the camera sees. */
function upright(x: number, z: number, y0: number, y1: number, s: number): BufferGeometry {
  return grain(bevelBox({ min: [x - s / 2, y0, z - s / 2], max: [x + s / 2, y1, z + s / 2], c: 0.012, omit: ['nz', 'ny', 'py'], wear: 0.9 }), 'y');
}

/** Steel shelving against the wall with plain boxes and tins on it (left end). */
function shelving(b: ReturnType<typeof piece>, R: Rng, sx: number, floor: number): void {
  const x0 = sx * 1.25, x1 = sx * 3.75; // from the bench end outward
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const z0 = 0.06, z1 = 1.05;
  const top = 3.35;
  const steel: BufferGeometry[] = [];
  const wood: BufferGeometry[] = [];
  for (const x of [xa + 0.05, xb - 0.05]) steel.push(upright(x, z1 - 0.05, floor, top, 0.09));
  const shelves = [floor + 0.35, floor + 1.95, -1.05, 0.55, 2.1, top - 0.04];
  for (const y of shelves) {
    // a steel lip in front, a board on it
    steel.push(grain(bevelBox({ min: [xa, y - 0.09, z1 - 0.07], max: [xb, y, z1 - 0.01], c: 0.01, omit: ['nz', 'ny'], wear: 0.9 }), 'x'));
    wood.push(grain(bevelBox({ min: [xa + 0.02, y, z0], max: [xb - 0.02, y + 0.035, z1 - 0.07], c: 0.008, omit: ['ny', 'nz'], wear: 0.6 }), 'x'));
  }
  // a cross brace at the back between the lowest shelves (it shows through the gaps)
  {
    const L = Math.hypot(xb - xa, shelves[1]! - shelves[0]!);
    const g = bevelBox({ min: [0, -0.02, 0.08], max: [L, 0.02, 0.1], c: 0.005, omit: ['nz'] });
    steel.push(transform(g, chain(T(xa, shelves[0]!, 0), new Matrix4().makeRotationZ(Math.atan2(shelves[1]! - shelves[0]!, xb - xa)))));
  }
  const sTone: Tone = { token: 'teal-panel', shade: 1.0 };
  b.add(part('steel', toned(mergeGeometries(steel), R, sTone, 0.04)));
  b.add(part('wood', toned(mergeGeometries(wood), R, { token: 'wood', shade: 0.75 })));
  // boxes and tins: on the two shelves that stand above the bench top, a few below
  for (const y of [0.55, 2.1, -1.05]) {
    let x = xa + R.range(0.1, 0.3);
    while (x < xb - 0.45) {
      const bw = R.range(0.4, 0.75), bh = R.range(0.35, 0.95) * (y > 2 ? 1.1 : 1), bd = R.range(0.5, 0.8);
      if (x + bw > xb - 0.08) break;
      if (R() < 0.25) {
        // a tin: a short turned can, steel
        const r = R.range(0.13, 0.19), hgt = R.range(0.2, 0.36);
        const can = lathe(profile(0, 0).to(r, 0, { fillet: 0.01, segs: 1 }).to(r, hgt, { fillet: 0.012, segs: 1 }).to(r * 0.9, hgt, { sharp: true }).to(0, hgt), { segs: 10, detail: 'low', band: 0 });
        b.add(part('steel', toned(transform(can, T(x + r, y + 0.035, z1 - 0.2 - r)), R, { token: R.pick(['steel', 'teal-light'] as const), shade: 0.8 })));
        x += r * 2 + R.range(0.05, 0.15);
      } else {
        // a plain card box, flaps a little open on some
        const zf = z1 - 0.1 - R.range(0, 0.12);
        const g = bevelBox({ min: [x, y + 0.035, zf - bd], max: [x + bw, y + 0.035 + bh, zf], c: 0.018, omit: ['ny', 'nz'], wear: 0.8 });
        const lean = R.spread(0.03);
        transform(g, chain(T(x + bw / 2, y, zf), new Matrix4().makeRotationZ(lean), T(-(x + bw / 2), -y, -zf)));
        b.add(part('wood', toned(grain(g, 'x'), R, { token: 'wood-light', shade: 0.62 })));
        if (R() < 0.4) {
          const flap = bevelBox({ min: [0, -0.008, -bd + 0.02], max: [bw * 0.5, 0.008, -0.02], c: 0.004 });
          b.add(part('wood', toned(transform(flap, chain(T(x + bw, y + 0.035 + bh, zf), new Matrix4().makeRotationZ(R.range(0.4, 0.9)))), R, { token: 'wood-light', shade: 0.55 })));
        }
        x += bw + R.range(0.04, 0.18);
      }
    }
  }
  // bolts where the lips meet the uprights
  const studs: BufferGeometry[] = [];
  for (const y of shelves) for (const x of [xa + 0.05, xb - 0.05]) studs.push(transform(stud(0.022, 0.01, 5), chain(T(x, y - 0.045, z1 - 0.004), new Matrix4().makeRotationX(Math.PI / 2))));
  b.small(() => part('steel', toned(mergeGeometries(studs), R, { token: 'steel', shade: 0.7 })));
}

/** A cable hanging from out of sight above, a slack loop caught on a wall hook (left end, near the bench). */
function hangingCable(b: ReturnType<typeof piece>, R: Rng, sx: number): void {
  const x = sx * 0.55;
  const pts = [
    new Vector3(x, 8.5, 0.7),
    new Vector3(x + sx * 0.02, 5.5, 0.72),
    new Vector3(x + sx * 0.05, 3.4, 0.66),
    new Vector3(x + sx * 0.18, 2.55 + R.spread(0.05), 0.5),
    new Vector3(x + sx * 0.38, 2.9, 0.22),
    new Vector3(x + sx * 0.46, 3.25, 0.08), // the hook
    new Vector3(x + sx * 0.5, 2.9, 0.12),
    new Vector3(x + sx * 0.48, 2.2 + R.spread(0.05), 0.2),
  ];
  const g = sweep(curvePath(new CatmullRomCurve3(pts, false, 'centripetal'), 36), { radius: 0.03, segs: 6, ends: 'dome', detail: 'low', up: [0, 0, 1] });
  b.add(part('rubber', toned(g, R, { token: 'ink', shade: 1.6 })));
  // the plug at its end and the wall hook it hangs on
  const plug = lathe(profile(0, 0).to(0.05, 0, { fillet: 0.01, segs: 1 }).to(0.055, 0.14, { fillet: 0.02, segs: 1 }).to(0, 0.16), { segs: 8, detail: 'low', band: 0 });
  b.add(part('rubber', toned(transform(plug, chain(T(x + sx * 0.48, 2.2, 0.2), new Matrix4().makeRotationX(Math.PI))), R, { token: 'ink', shade: 1.8 })));
  b.add(part('steel', toned(transform(bevelBox({ min: [-0.03, -0.12, 0], max: [0.03, 0.03, 0.12], c: 0.01, omit: ['nz'] }), T(x + sx * 0.46, 3.25, 0)), R, { token: 'steel', shade: 0.8 })));
}

/** A run of painted pipe up the wall and along it overhead, with clamps and a junction box (right end). */
function pipeRun(b: ReturnType<typeof piece>, R: Rng, sx: number, floor: number): void {
  const x = sx * 0.75;
  const zr = 0.16;
  const yTop = 5.6;
  const pts = [new Vector3(x, floor, zr), new Vector3(x, yTop - 0.35, zr), new Vector3(x, yTop, zr), new Vector3(x + sx * 0.35, yTop, zr), new Vector3(x + sx * 6, yTop, zr)];
  const pipe = sweep(curvePath(new CatmullRomCurve3(pts, false, 'catmullrom', 0.05), 30), { radius: 0.085, segs: 8, ends: 'flat', detail: 'low' });
  b.add(part('steel', toned(pipe, R, { token: 'teal-panel', shade: 1.3 })));
  // a thinner conduit beside it, down to a junction box at the bench's height
  const cx = x + sx * 0.32;
  const cond = sweep(curvePath(new CatmullRomCurve3([new Vector3(cx, yTop + 0.6, 0.1), new Vector3(cx, 1.9, 0.1)]), 2), { radius: 0.035, segs: 6, ends: 'flat', detail: 'low' });
  b.add(part('steel', toned(cond, R, { token: 'steel', shade: 0.75 })));
  const jb = bevelBox({ min: [cx - 0.2, 1.3, 0], max: [cx + 0.2, 1.9, 0.18], c: 0.02, omit: ['nz'], wear: 0.9 });
  b.add(part('steel', toned(jb, R, { token: 'teal-panel', shade: 1.2 })));
  b.add(part('steel', toned(bevelBox({ min: [cx - 0.17, 1.33, 0.18], max: [cx + 0.17, 1.87, 0.2], c: 0.006, omit: ['nz'] }), R, { token: 'teal-panel', shade: 1.35 })));
  const studs: BufferGeometry[] = [];
  for (const [dx, dy] of [[-0.14, 0.05], [0.14, 0.05], [-0.14, 0.49], [0.14, 0.49]] as const) studs.push(transform(stud(0.018, 0.01, 5), chain(T(cx + dx, 1.33 + dy, 0.2), new Matrix4().makeRotationX(Math.PI / 2))));
  // clamps on the pipe: up the wall and along the top
  const clamps: BufferGeometry[] = [];
  for (const y of [floor + 1.2, -0.6, 1.6, 3.8]) clamps.push(bevelBox({ min: [x - 0.13, y - 0.04, 0], max: [x + 0.13, y + 0.04, zr + 0.1], c: 0.012, omit: ['nz'] }));
  for (const d of [1.6, 3.4, 5.2]) clamps.push(bevelBox({ min: [x + sx * d - 0.04, yTop - 0.13, 0], max: [x + sx * d + 0.04, yTop + 0.13, zr + 0.1], c: 0.012, omit: ['nz'] }));
  b.add(part('steel', toned(mergeGeometries(clamps), R, { token: 'steel', shade: 0.6 })));
  b.small(() => part('steel', toned(mergeGeometries(studs), R, { token: 'steel', shade: 0.7 })));
}

/** A plain four-legged stool on the floor (right end). */
function floorStool(b: ReturnType<typeof piece>, R: Rng, sx: number, floor: number): void {
  const cx = sx * 2.4, cz = 2.2;
  const h = 1.55;
  const seat = lathe(profile(0, 0).to(0.42, 0, { fillet: 0.03, segs: 1 }).to(0.42, 0.09, { fillet: 0.04, segs: 2 }).to(0, 0.1), { segs: 14, detail: 'low', band: 0 });
  const parts: BufferGeometry[] = [transform(seat, T(cx, floor + h - 0.1, cz))];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2 + R.spread(0.05);
    const fx = cx + Math.cos(a) * 0.42, fz = cz + Math.sin(a) * 0.42;
    const tx = cx + Math.cos(a) * 0.28, tz = cz + Math.sin(a) * 0.28;
    const L = Math.hypot(fx - tx, h - 0.1, fz - tz);
    const leg = bevelBox({ min: [-0.04, 0, -0.04], max: [0.04, L, 0.04], c: 0.012, omit: ['ny', 'py'] });
    parts.push(transform(leg, aim([fx, floor, fz], [tx - fx, h - 0.1, tz - fz], 45)));
  }
  // a rung
  parts.push(bevelBox({ min: [cx - 0.36, floor + 0.5, cz + 0.3], max: [cx + 0.36, floor + 0.56, cz + 0.36], c: 0.01 }));
  b.add(part('wood', toned(grain(mergeGeometries(parts), 'y'), R, { token: 'wood', shade: 0.75 })));
}

export function roomEnd(o: RoomEndOptions): Piece {
  const seed = o.seed ?? (o.side === 'left' ? 11 : 12);
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const floor = o.floor ?? FLOOR_Y;
  const sx = o.side === 'left' ? -1 : 1;
  const b = piece(`room-${o.side}`, { detail, seed, ao: { distance: 0.25 } });
  if (o.side === 'left') {
    shelving(b, R, sx, floor);
    hangingCable(b, R, sx);
  } else {
    pipeRun(b, R, sx, floor);
    floorStool(b, R, sx, floor);
  }
  return b.build();
}
