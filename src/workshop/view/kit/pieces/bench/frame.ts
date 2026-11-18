/**
 * What holds the bench up (V, the room; ART-P2 § 5 "THE ROOM"): stout legs
 * under the front edge, a knee brace or two on each, a low rail near the
 * floor, carriage bolts through the apron where a leg meets it.
 *
 * Only what the fixed camera sees is built. From the front and 33° above,
 * through a long lens, the rays that pass under the apron land on the floor
 * long before they reach the back of the bench, so the back legs, the side
 * rails and the inner faces are never seen and never made. What is seen is
 * the front face of each front leg (and a sliver of its side), the braces
 * and the rail, and only their upper parts clearly: everything is tinted
 * darker and given a cavity ramp toward the floor, so the frame falls into
 * the room the way the apron does.
 *
 *   benchFrame({ sections, width, depth, floor, ... })
 *
 * Same origin as `bench()`: centred on x = 0, the bench top at y = 0, the
 * front edge at z = depth / 2. `floor` is the floor's height (negative).
 */
import { Matrix4, type BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import { chain, large, mergeGeometries, part, piece, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import { grain } from '../../space.ts';
import { rng } from '../../rng.ts';
import { tint } from '../../surface.ts';
import { ATTR } from '../../types.ts';

export interface BenchFrameOptions extends KitOptions {
  /** As `bench()`: sections side by side (default 3), each `width` long (default 6), `depth` deep (default 10). */
  sections?: number;
  width?: number;
  depth?: number;
  /** The top's thickness and the apron's height (as `bench()`: 0.36, 0.75). */
  thickness?: number;
  apron?: number;
  /** The floor's height (default -4.6). */
  floor?: number;
}

/** The floor the legs stand on, below the bench top (y = 0). */
export const FLOOR_Y = -3.5;

/** How dark the frame's timber is against the bench top's (the bench's own shade is 0.55 of `wood`). */
const FRAME_SHADE = 0.42;

/** Cavity rising toward the floor: the frame falls into the dark (the materials' grime takes it down). */
function sinkInto(g: BufferGeometry, yTop: number, yBottom: number, amount: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const s = g.getAttribute(ATTR.surf);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (yTop - pos.getY(i)) / (yTop - yBottom)));
    s.setY(i, Math.max(s.getY(i), Math.min(1, t * amount)));
  }
  s.needsUpdate = true;
  return g;
}

/** A timber strut from a to b in the front plane (x, y), its face at zFace, section w × d; grain along it. */
function strut(ax: number, ay: number, bx: number, by: number, w: number, d: number, zFace: number): BufferGeometry {
  const L = Math.hypot(bx - ax, by - ay);
  const g = bevelBox({ min: [0, -w / 2, -d], max: [L, w / 2, 0], c: 0.02, omit: ['nz', 'nx', 'px'], wear: 0.55 });
  return transform(g, chain(T(ax, ay, zFace), new Matrix4().makeRotationZ(Math.atan2(by - ay, bx - ax))));
}

export function benchFrame(o: BenchFrameOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const n = Math.max(1, o.sections ?? 3);
  const width = o.width ?? 6, depth = o.depth ?? 10;
  const T0 = o.thickness ?? 0.36, ap = o.apron ?? 0.75;
  const floor = o.floor ?? FLOOR_Y;
  const b = piece('bench-frame', { detail, seed, ao: false });
  const x0 = -(n * width) / 2;
  const apronFace = depth / 2 - 0.05;
  const yApron = -T0 - ap; // the apron's lower edge
  const legW = 0.5, legD = 0.46;
  const legFace = apronFace - 0.05; // set back a little under the apron: a shadow line where they meet
  const brace = { w: 0.2, d: 0.16 };
  const tone = (shade = FRAME_SHADE): { seed: number; jitter: number; warm: number; shade: number } => ({ seed: R.int(0, 1e6), jitter: 0.06, warm: 0.03, shade });
  const legsX: number[] = [x0 + legW / 2 + 0.22];
  for (let i = 1; i < n; i++) legsX.push(x0 + i * width);
  legsX.push(-x0 - legW / 2 - 0.22);
  const bolts: BufferGeometry[] = [];
  const studs: BufferGeometry[] = [];
  for (let i = 0; i < legsX.length; i++) {
    const lx = legsX[i]! + R.spread(0.02);
    // the leg: grain up its length, a sliver of each side shows by perspective
    const leg = bevelBox({ min: [floor, lx - legW / 2, legFace - legD], max: [-T0, lx + legW / 2, legFace], c: 0.03, omit: ['nz', 'nx', 'px'], wear: 0.6 });
    // built along X (its grain), stood on end: (x, y, z) -> (y, x, z) (transform rights the winding)
    transform(leg, new Matrix4().set(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    tint(leg, 'wood', tone());
    b.add(large({ material: 'wood', geometry: sinkInto(leg, yApron, floor + 0.6, 1) }));
    // knee braces from the leg up to the apron's foot: inward at the ends, both ways at a joint
    const sides = i === 0 ? [1] : i === legsX.length - 1 ? [-1] : [-1, 1];
    for (const s of sides) {
      const reach = 1.15 + R.spread(0.08), drop = 1.25 + R.spread(0.06);
      const ax = lx + s * legW / 2 - s * 0.04, ay = yApron - drop;
      const bx = lx + s * (legW / 2 + reach), by = yApron + 0.02;
      const g = strut(ax, ay, bx, by, brace.w, brace.d, legFace - 0.03);
      tint(g, 'wood', tone(FRAME_SHADE * 0.95));
      b.add(large({ material: 'wood', geometry: sinkInto(g, yApron, floor + 0.6, 1) }));
      // a coach bolt through each end
      for (const [px, py, k] of [[ax + s * 0.18, ay + 0.2, 0], [bx - s * 0.22, by - 0.16, 1]] as const) {
        bolts.push(transform(grain(hexHead(0.075, 0.035, R.range(0, 1)), 'y'), chain(T(px + R.spread(0.01), py + R.spread(0.01), legFace - 0.03 + 0.001), new Matrix4().makeRotationX(Math.PI / 2))));
        if (k === 0) studs.push(transform(stud(0.055, 0.008, 6), chain(T(px, py, legFace - 0.03 - 0.002), new Matrix4().makeRotationX(Math.PI / 2))));
      }
    }
    // carriage bolts through the apron into the leg: two round heads
    for (const dy of [-0.2, 0.2]) {
      studs.push(transform(stud(0.045, 0.018, 7), chain(T(lx + R.spread(0.03), -T0 - ap / 2 + dy + R.spread(0.02), apronFace), new Matrix4().makeRotationX(Math.PI / 2))));
    }
  }
  // the low rail between the legs, near the floor: seen only as a dark bar; one length per bay
  for (let i = 0; i < legsX.length - 1; i++) {
    const xa = legsX[i]! + legW / 2 - 0.02, xb = legsX[i + 1]! - legW / 2 + 0.02;
    const y = floor + 0.55 + R.spread(0.03);
    const g = bevelBox({ min: [xa, y, legFace - 0.24], max: [xb, y + 0.3, legFace - 0.06], c: 0.02, omit: ['nz', 'nx', 'px', 'ny'], wear: 0.5 });
    tint(g, 'wood', tone(FRAME_SHADE * 0.9));
    b.add(large({ material: 'wood', geometry: sinkInto(g, yApron, floor + 0.6, 1) }));
  }
  b.small(() => part('metal', mergeGeometries(bolts), 'steel', { seed: R.int(0, 1e6), shade: 0.5, jitter: 0.1 }));
  b.small(() => part('metal', mergeGeometries(studs), 'steel', { seed: R.int(0, 1e6), shade: 0.42, jitter: 0.1 }));
  return b.build();
}
