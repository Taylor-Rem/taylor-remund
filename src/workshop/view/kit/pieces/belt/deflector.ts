/**
 * The way off the belt's motor end (option `deflector`; brief V-belt-r § 4).
 * Running backward, a part rides toward the motor housing; before it gets
 * there it meets a curved steel deflector standing on the belt, slides along
 * the deflector's brass rub strip toward the back, through a gap left in
 * the far rail, and down a sheet-steel slide onto the bench behind the belt.
 *
 *  - The deflector: an enamel plate on a curve in plan from the near rail
 *    (where a bracket bolts it to the rail's top) across the belt to its far
 *    edge (where a strap bolts it to the housing's right face), its top edge
 *    rolled over, a brass rub strip along the face the parts meet.
 *  - The slide: a sheet-steel chute with turned-up cheeks from under the
 *    belt's far edge down to the bench, on two legs, worn bright down its
 *    middle where parts run.
 *
 * Built in the belt's root space. `x0` is the belt's left end.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { NodeBuilder } from '../../compose.ts';
import { aim, chain, part, T } from '../../compose.ts';
import { extrude } from '../../solids.ts';
import { sweep } from '../../sweep.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import type { Rng } from '../../rng.ts';
import { BELT, DEFLECT } from './dims.ts';

export interface DeflectorOut {
  /** Where a part sent off the back comes to rest on the bench (+Y up). */
  offBack: Matrix4;
  /** The middle of the deflector's working face (+Z along its normal, into the belt's path). */
  face: Matrix4;
}

/** The deflector's curve in plan (x, z), t from 0 (near rail) to 1 (far edge), for a belt whose left end is x0. */
export function deflectorAt(x0: number, t: number): [number, number] {
  const { p0, c, p1 } = DEFLECT;
  const u = 1 - t;
  return [x0 + u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

/** A band `w` wide either side of the curve (offset along its plan normal by `off`), as a plan outline. */
function band(x0: number, n: number, w0: number, w1: number, t0 = 0, t1 = 1): Array<[number, number]> {
  const left: Array<[number, number]> = [], right: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const [x, z] = deflectorAt(x0, t);
    const [xa, za] = deflectorAt(x0, Math.min(1, t + 1e-3)), [xb, zb] = deflectorAt(x0, Math.max(0, t - 1e-3));
    const dx = xa - xb, dz = za - zb, l = Math.hypot(dx, dz);
    // normal toward +x side (the face the parts meet: they come from the right)
    const nx = -dz / l, nz = dx / l;
    const s = nx < 0 ? -1 : 1;
    left.push([x + s * nx * w1, z + s * nz * w1]);
    right.push([x + s * nx * w0, z + s * nz * w0]);
  }
  return [...left, ...right.reverse()];
}

/** Corner radii for a band outline of 2(n+1) points: round only its four corners. */
function bandRadii(n: number, r: number): number[] {
  const out = new Array<number>(2 * (n + 1)).fill(0);
  out[0] = out[n] = out[n + 1] = out[2 * n + 1] = r;
  return out;
}

export function buildDeflector(b: NodeBuilder, x0: number, seed: number, R: Rng, detail: 'high' | 'low'): DeflectorOut {
  const hi = detail === 'high';
  const D = DEFLECT;
  const n = hi ? 9 : 7;
  const zo = BELT.railIn + BELT.railDepth;

  // ---- the plate: the band extruded up, its top bevelled ----
  {
    const g = extrude(band(x0, n, -D.t / 2, D.t / 2), D.y1 - D.y0, { axis: 'y', bevel: 0.008, bevelBase: 0, radius: bandRadii(n, 0.008), segs: 1, detail, band: 0, caps: 'end' });
    transform(g, T(0, D.y0, 0));
    b.add(part('steel', grain(g, 'y'), 'teal-panel', { seed: seed + 1, shade: 1.05, jitter: 0.03 }));
    // the rolled top edge: a bead along the curve
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const [x, z] = deflectorAt(x0, i / n);
      pts.push(new Vector3(x, D.y1 - 0.002, z));
    }
    b.add(setFinish(part('brass', sweep({ points: pts }, { radius: 0.019, segs: 5, detail, ends: 'flat' }), 'brass', { seed: seed + 2, warm: 0.04 }), 0.5));
    // the brass rub strip on the working face, low, where a crate's side meets it
    const rs = extrude(band(x0, n, D.t / 2 - 0.002, D.t / 2 + 0.01, 0.03, 0.97), 0.05, { axis: 'y', bevel: 0, bevelBase: 0, radius: 0, segs: 1, detail: 'low', band: 0, caps: 'end' });
    transform(rs, T(0, D.y0 + 0.035, 0));
    b.add(setFinish(part('brass', rs, 'brass', { seed: seed + 3, warm: 0.04 }), 0.55));
    // (its screws face the back, where nobody looks: not modelled)
  }
  // ---- its mounts: a bracket onto the near rail's top, a strap to the housing's right face ----
  {
    const [ax, az] = deflectorAt(x0, 0);
    const br = bevelBox({ min: [-0.07, 0, -0.03], max: [0.07, D.y0 + 0.08 - BELT.railTop, zo - az + 0.01], c: 0.01, omit: ['ny'] });
    b.add(part('steel', transform(br, T(ax, BELT.railTop, az - 0.01)), 'teal-panel', { seed: seed + 6, shade: 0.9 }));
    for (const sx of [-0.04, 0.04]) b.add(part('metal', transform(stud(0.018, 0.012, 6), T(ax + sx, D.y0 + 0.08, az + 0.04)), 'steel', { seed: seed + 7 }));
    const [bx, bz] = deflectorAt(x0, 1);
    const strap = bevelBox({ min: [x0 - BELT.motorGap - 0.004, D.y1 - 0.12, bz - 0.04], max: [bx + 0.01, D.y1 - 0.03, bz + 0.04], c: 0.01, omit: ['nx'] });
    b.add(part('steel', strap, 'teal-panel', { seed: seed + 8, shade: 0.85 }));
    b.add(part('metal', transform(hexHead(0.034, 0.016, R.range(0, 1)), aim([bx - 0.05, D.y1 - 0.03, bz], [0, 1, 0])), 'steel', { seed: seed + 9 }));
  }

  // ---- the slide off the back ----
  const sx0 = x0 + 0.03, sx1 = x0 + D.gap - 0.03;
  {
    const [zt, yt] = D.slideTop, [zf, yf] = D.slideFoot;
    const len = Math.hypot(zt - zf, yt - yf);
    const ang = Math.atan2(yt - yf, zt - zf); // slope of the chute, rising toward the belt (+z)
    // in the chute's frame: x across, z down the slope (from the top edge), y up off its floor
    const frame = chain(T(0, yt, zt), new Matrix4().makeRotationX(-ang));
    const floor = bevelBox({ min: [sx0, -0.02, -len], max: [sx1, 0, 0], c: 0.008, omit: ['ny'] });
    b.add(part('steel', grain(transform(floor, frame), 'x'), 'teal-panel', { seed: seed + 20, shade: 0.9, jitter: 0.03 }));
    // worn bright down the middle where the parts run: a bare-metal strip a hair proud
    const wear = bevelBox({ min: [sx0 + 0.22, 0, -len + 0.04], max: [sx1 - 0.22, 0.0015, -0.04] });
    b.add(part('metal', transform(wear, frame), 'steel', { seed: seed + 21, shade: 0.85 }));
    // the cheeks: turned-up sheet at either side, a lip at the foot
    for (const x of [sx0, sx1 - 0.018]) {
      const ch = bevelBox({ min: [x, -0.02, -len], max: [x + 0.02, 0.11, 0.0], c: 0.006, omit: ['ny'] });
      b.add(part('steel', transform(ch, frame), 'teal-panel', { seed: seed + 22, shade: 1.05 }));
    }
    // the top lip, hooked under the belt's far edge, three rivets
    const lip = bevelBox({ min: [sx0, -0.02, -0.02], max: [sx1, 0.012, 0.03], c: 0.006 });
    b.add(part('steel', transform(lip, frame), 'teal-panel', { seed: seed + 23, shade: 0.8 }));
    for (let i = 0; i < 3; i++) b.small(() => [part('metal', transform(stud(0.012, 0.007, 5), chain(frame, T(sx0 + 0.15 + i * (sx1 - sx0 - 0.3) / 2, 0.012, 0.005))), 'steel', { seed: seed + 24 })]);
    // two legs from under the floor to the bench, with feet
    for (const x of [sx0 + 0.1, sx1 - 0.1]) {
      const zl = zf + 0.16, yl = yf + (yt - yf) * (0.16 / (zt - zf)) - 0.02;
      const leg = bevelBox({ min: [x - 0.025, 0.0, zl - 0.025], max: [x + 0.025, yl, zl + 0.025], c: 0.008, omit: ['ny', 'py'] });
      b.add(part('steel', leg, 'teal-panel', { seed: seed + 25, shade: 0.75 }));
      b.add(part('steel', bevelBox({ min: [x - 0.06, 0, zl - 0.05], max: [x + 0.06, 0.018, zl + 0.05], c: 0.006, omit: ['ny'] }), 'teal-panel', { seed: seed + 26, shade: 0.7 }));
    }
  }
  const [mx, mz] = deflectorAt(x0, 0.5);
  const [ma, mb] = deflectorAt(x0, 0.501);
  const dx = ma - mx, dz = mb - mz, l = Math.hypot(dx, dz);
  let nx = -dz / l, nz = dx / l;
  if (nx < 0) { nx = -nx; nz = -nz; }
  void (null as unknown as BufferGeometry);
  return {
    offBack: T(x0 + D.rest[0], 0, D.rest[1]),
    face: aim([mx + nx * D.t, (D.y0 + D.y1) / 2, mz + nz * D.t], [nx, 0, nz]),
  };
}
