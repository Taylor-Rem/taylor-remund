/**
 * The return chute (REWRITE.md § B1 "The bench edge": anything that falls
 * off comes back up the return chute; § D 7: a tool or a robot comes back
 * up the chute). Registry name `chute`. ART-P2 § 5 "THE RETURN CHUTE".
 *
 * A sheet-metal duct that comes up through the bench top at its front-left
 * corner (out of a bolted collar: what falls off the edge goes down into
 * the dark and is sent back up this), rises, bends over and ends in a
 * flared, rolled mouth aimed down onto the bench. A sprung `tape-yellow`
 * flap hangs in the mouth; a part pops out of it with a clunk. A riveted
 * seam along its back, a dent, a wire bale handle on the bend, a brass
 * maker's plate.
 *
 * Frame: the origin is the middle of the duct where it comes through the
 * bench top (y = 0). The mouth looks along `CHUTE.aim`: +X turned
 * CHUTE.yaw degrees toward the visitor, and CHUTE.droop degrees down, so
 * the camera sees into the flare and the part comes out toward the open
 * bench. Place it with no yaw.
 *
 * Moving node: `flap` (pose.ts `poseChute`), hinged along the mouth's top
 * edge: its local X is the hinge; 0 shut (hanging in the mouth), + kicked
 * open (swung out and up).
 *
 * Sockets: `mouth` (the middle of the opening; its +Z points out along the
 * duct), `land` (where a part that pops out comes to rest on the bench),
 * `collar` (the duct at the bench top).
 */
import { Matrix4, Vector3 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { aim, chain, part, piece, T } from '../../compose.ts';
import { lathe, profiledBox, roundedBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath, sections, joinPaths, linePath, arcPath } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, stud } from '../../cheap.ts';
import { NAMED_POSES, poseChute } from './pose.ts';
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { sheet } from '../../cheap.ts';
import { texturedPart } from '../../compose.ts';
import type { ChutePose } from './pose.ts';

export { poseChute, NAMED_POSES } from './pose.ts';
export type { ChutePose } from './pose.ts';

const DEG = Math.PI / 180;

export const CHUTE = {
  /** The mouth's heading: +X turned this many degrees toward the visitor (+Z)... */
  yaw: 42,
  /** ...and tipped down this many degrees. */
  droop: 8,
  /** The duct's core section half-sizes (across, front-to-back of the section) and its wall offset. */
  hx: 0.11,
  hz: 0.11,
  wall: 0.07,
  /** The flare at the mouth: the offset grows to this. */
  flare: 0.16,
  /** Height the duct rises to before it bends, and the bend's radius. */
  rise: 0.45,
  bend: 0.24,
  /** Straight run after the bend, to the lip. */
  run: 0.12,
} as const;

export interface ChuteLabelRefs {
  /** The stencilled up-arrow on the riser. */
  arrow: { key: string; w: number; h: number };
}

export interface ChuteOptions extends KitOptions {
  pose?: string | ChutePose;
  /** From `chuteLabels(labels)`; without it the riser carries no stencil (clay, tests). */
  labels?: ChuteLabelRefs;
}

/** The arrow's capital height. */
export const ARROW_CAP = 0.17;

/** Make the chute's stencil (the crates' own up-arrow, from world.json) and return its key and size. */
export function chuteLabels(labels: Labels): ChuteLabelRefs {
  const key = labels.stencil(world.stencil.up, { paint: 'ink', capHeight: ARROW_CAP });
  return { arrow: { key, ...labels.size(key) } };
}

/** The duct's centre line: up from below the bench, over the bend, out to the lip; and its frame at the lip. */
function ductPath(): { points: Vector3[]; end: Vector3; dir: Vector3; side: Vector3 } {
  const yaw = CHUTE.yaw * DEG;
  const h = new Vector3(Math.cos(yaw), 0, Math.sin(yaw)); // horizontal heading
  const turn = (90 + CHUTE.droop) * DEG; // the bend turns the duct from straight up to droop below horizontal
  const r = CHUTE.bend;
  const up = linePath([0, -0.35, 0], [0, CHUTE.rise, 0], 2);
  // the arc in the vertical plane through h: centre at rise + h * r
  const c = new Vector3(0, CHUTE.rise, 0).addScaledVector(h, r);
  const arc = arcPath([c.x, c.y, c.z], r, Math.PI, Math.PI - turn, 8, [h.x, h.y, h.z], [0, 1, 0]);
  const last = arc.points[arc.points.length - 1]!;
  const dir = new Vector3().addScaledVector(h, Math.cos(-CHUTE.droop * DEG)).add(new Vector3(0, Math.sin(-CHUTE.droop * DEG), 0)).normalize();
  const end = last.clone().addScaledVector(dir, CHUTE.run);
  const run = linePath(last, end, 2);
  const path = joinPaths(up, arc, run);
  const side = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
  return { points: path.points, end, dir, side };
}

export function chute(o: ChuteOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('chute', { detail, seed });
  const dp = ductPath();
  const L = dp.points.reduce((s, p, i) => (i ? s + p.distanceTo(dp.points[i - 1]!) : 0), 0);
  const w = CHUTE.wall, f = CHUTE.flare, t = 0.016;
  // the mouth's frame: +Z out along the duct, +Y the section's "up" (the duct's outer side over the bend), X across
  const mz = dp.dir.clone(), mx = dp.side.clone().negate();
  const my = new Vector3().crossVectors(mz, mx).normalize();
  const mouthM = new Matrix4().makeBasis(mx, my, mz).setPosition(dp.end);

  const frameAt = (s: number): { p: Vector3; tan: Vector3 } => {
    let acc = 0;
    for (let i = 1; i < dp.points.length; i++) {
      const a = dp.points[i - 1]!, c = dp.points[i]!;
      const l = a.distanceTo(c);
      if (acc + l >= s) return { p: a.clone().lerp(c, (s - acc) / l), tan: c.clone().sub(a).normalize() };
      acc += l;
    }
    const n = dp.points.length;
    return { p: dp.points[n - 1]!.clone(), tan: dp.points[n - 1]!.clone().sub(dp.points[n - 2]!).normalize() };
  };
  // where the gore seams go: one on the riser, two across the bend, one on the run
  const sBend = 0.35 + CHUTE.rise;
  const arcL = CHUTE.bend * (90 + CHUTE.droop) * DEG;
  const gores = [0.2, sBend + arcL / 3, sBend + (2 * arcL) / 3, sBend + arcL + 0.01];
  // ======================================================================
  // LARGE: the duct, flaring to a rolled lip, its wall turning inside
  // ======================================================================
  {
    const p = profile(w, 0)
      .to(w, L - 0.3, { smooth: true })
      .to(w + 0.02, L - 0.16, { smooth: true })
      .to(f, L, { fillet: 0.02, segs: 2 })
      .to(f - t, L - 0.002, { fillet: 0.006, segs: 1 })
      .to(w + 0.01 - t, L - 0.17, { smooth: true })
      .to(w - t, L - 0.34);
    const g = sweep({ points: dp.points }, { section: sections.roundRect(CHUTE.hx, CHUTE.hz, hi ? 2 : 1), profile: p, up: [dp.side.x, 0, dp.side.z], detail });
    // a knock on the bend's outer side, where something came up hard
    const dentAt = new Vector3(0, CHUTE.rise + 0.16, 0).addScaledVector(new Vector3(Math.cos(CHUTE.yaw * DEG), 0, Math.sin(CHUTE.yaw * DEG)), 0.03);
    deform(g, (x, y, z) => {
      const q = Math.hypot(x - dentAt.x, y - (dentAt.y + 0.12), z - (dentAt.z + 0.12)) / 0.1;
      if (q >= 1) return [x, y, z];
      const k = (1 - q * q) ** 2 * 0.018;
      return [x, y - k * 0.6, z - k * 0.8];
    }, { keepSurf: true });
    part('metal', g, 'steel', { seed: seed + 1, shade: 1.05, jitter: 0.03 });
    // the throat goes dark: the inner wall (its normal faces the duct's axis) is darkened, more the deeper it goes
    {
      const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), col = g.getAttribute('color');
      const v = new Vector3(), q = new Vector3(), nn = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let best = Infinity;
        for (let k = 1; k < dp.points.length; k++) {
          const a0 = dp.points[k - 1]!, a1 = dp.points[k]!;
          const ab = a1.clone().sub(a0);
          const tt = Math.max(0, Math.min(1, v.clone().sub(a0).dot(ab) / ab.lengthSq()));
          const c = a0.clone().addScaledVector(ab, tt);
          const d2 = c.distanceToSquared(v);
          if (d2 < best) { best = d2; q.copy(c); }
        }
        nn.fromBufferAttribute(nrm, i);
        if (nn.dot(v.clone().sub(q)) < 0) {
          const depth = Math.max(0, dp.end.clone().sub(v).dot(dp.dir));
          const k = 0.45 * Math.max(0.15, 1 - depth / 0.3);
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
        }
      }
      col.needsUpdate = true;
    }
    b.add({ material: 'metal', geometry: g });
    // gore seams: the elbow is made of lengths joined by rolled bands
    for (const s of gores) {
      const { p, tan } = frameAt(s);
      const band = sweep({ points: [p.clone().addScaledVector(tan, -0.016), p.clone().addScaledVector(tan, 0.016)] }, { section: sections.roundRect(CHUTE.hx, CHUTE.hz, 1), radius: w + 0.01, up: [dp.side.x, 0, dp.side.z], detail, ends: 'flat' });
      b.add(part('metal', band, 'steel', { seed: seed + 10, shade: 0.88 }));
    }
    // the dark down the throat: a plug deep inside, where the inner wall ends
    const plug = roundedBox({ w: 2 * (CHUTE.hx + w - t) - 0.01, h: 0.01, d: 2 * (CHUTE.hz + w - t) - 0.01, r: 0.004, rPlan: 0.05, detail: 'low', open: true });
    b.add(part('rubber', transform(plug, chain(mouthM, T(0, 0, -0.33), new Matrix4().makeRotationX(Math.PI / 2))), 'ink', { shade: 0.15 }));
  }
  // the collar: a square flange bolted down where the duct comes through the bench top
  {
    const cw = 2 * (CHUTE.hx + w) + 0.16, cd = 2 * (CHUTE.hz + w) + 0.16;
    const r = 0.06;
    const g = profiledBox({ w: cw, d: cd, rPlan: 0.06, detail, band: 0 }, profile(0, 0).to(r, 0, { sharp: true }).to(r, 0.025, { fillet: 0.01, segs: 1 }).to(r - 0.04, 0.05, { fillet: 0.02, segs: 1 }).to(0, 0.05));
    b.add(part('steel', transform(g, new Matrix4().makeRotationY(CHUTE.yaw * DEG * 0)), 'teal-panel', { seed: seed + 2, shade: 1.0, jitter: 0.04 }));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.small(() => [part('metal', transform(hexHead(0.04, 0.02, R.range(0, 1)), T(sx * (cw / 2 - 0.05), 0.03, sz * (cd / 2 - 0.05))), 'steel', { seed: seed + 3, jitter: 0.08 })]);
    }
  }

  // ======================================================================
  // MEDIUM / SMALL: the seam and its rivets, bands, the bale handle, the plate
  // ======================================================================
  const h = new Vector3(Math.cos(CHUTE.yaw * DEG), 0, Math.sin(CHUTE.yaw * DEG));
  // the outward side of the bend (away from its centre): toward -h when vertical, +Y when over the top
  const outer = (tan: Vector3): Vector3 => {
    const n = new Vector3().crossVectors(new Vector3().crossVectors(h, new Vector3(0, 1, 0)), tan).normalize();
    return n.dot(h) > 0.01 || n.y < -0.01 ? n.negate() : n;
  };
  {
    // rivets beside each seam, on the face toward the visitor and on top
    for (const [gi, s0] of gores.entries()) {
      const { p, tan } = frameAt(s0 + 0.04);
      const d = CHUTE.hx + w + 0.002;
      const sd = new Vector3(dp.side.x, 0, dp.side.z);
      const up2 = new Vector3().crossVectors(tan, sd).normalize();
      for (const u of [-0.07, 0.07]) {
        const at = p.clone().addScaledVector(sd, d).addScaledVector(up2, u);
        b.small(() => [part('metal', transform(stud(0.015, 0.008, 6), aim([at.x, at.y, at.z], [sd.x, sd.y, sd.z])), 'steel', { seed: seed + 12 + gi, shade: 0.9, jitter: 0.1 })]);
      }
    }
  }
  {
    // the bale handle: a bent wire loop on two lugs on the bend's top, lying back
    const { p, tan } = frameAt(0.42 + Math.PI * CHUTE.bend * 0.5 * 0.55);
    const out = outer(tan);
    const across = new Vector3().crossVectors(tan, out).normalize();
    const d = CHUTE.hz + w;
    const base = p.clone().addScaledVector(out, d);
    const span = CHUTE.hx + 0.02;
    const pts: Array<[number, number, number]> = [];
    const at = (u: number, lift: number, back: number): [number, number, number] => {
      const q = base.clone().addScaledVector(across, u).addScaledVector(out, lift).addScaledVector(tan, -back);
      return [q.x, q.y, q.z];
    };
    pts.push(at(-span, 0.03, 0), at(-span, 0.06, 0.1), at(span, 0.06, 0.1), at(span, 0.03, 0));
    b.add(part('metal', sweep(polylinePath(pts, 0.05, hi ? 4 : 2), { radius: 0.012, segs: 6, detail, ends: 'round' }), 'steel', { seed: seed + 20, shade: 1.1 }));
    for (const u of [-span, span]) {
      const q = at(u, 0, 0);
      b.add(part('brass', transform(lathe(profile(0, 0).to(0.026, 0, { sharp: true }).to(0.026, 0.02, { fillet: 0.006, segs: 1 }).to(0.016, 0.036, { fillet: 0.008, segs: 1 }).to(0, 0.036), { segs: 8, detail, band: 0 }), aim(q, [out.x, out.y, out.z])), 'brass', { seed: seed + 21 }));
    }
  }
  {
    // a brass maker's plate on the duct's front face (toward the visitor), low down
    const { p } = frameAt(0.3);
    const fz = new Vector3(-h.z, 0, h.x); // horizontal, toward +Z side of the heading
    const d = CHUTE.hz + w + 0.001;
    const plate = roundedBox({ w: 0.16, h: 0.006, d: 0.09, r: 0.002, rPlan: 0.014, detail: 'low', open: true });
    const M = new Matrix4().makeBasis(h, new Vector3(0, 0, 0).add(fz).cross(h).negate().normalize(), fz);
    void M;
    b.add(setFinish(part('brass', transform(plate, chain(aim([p.x + fz.x * d, p.y, p.z + fz.z * d], [fz.x, fz.y, fz.z]), new Matrix4().makeRotationY(Math.PI / 2))), 'brass', { seed: seed + 30, warm: 0.03 }), 0.3));
    for (const sx of [-1, 1]) b.small(() => [part('brass', transform(stud(0.008, 0.006, 6), aim([p.x + fz.x * (d + 0.006) + h.x * 0, p.y + sx * 0.062, p.z + fz.z * (d + 0.006)], [fz.x, 0, fz.z])), 'brass', { seed: seed + 31 })]);
  }

  if (o.labels) {
    // a stencilled up-arrow on the riser's face under the mouth: what went down comes back up here
    const a = o.labels.arrow;
    const d = CHUTE.hz + w + 0.003;
    const sd = dp.side;
    const y = 0.09 + a.h / 2 + 0.02;
    const g = sheet({ w: a.w, h: a.h, t: 0.001, nx: 1, ny: 1 });
    transform(g, chain(T(sd.x * d, y, sd.z * d), new Matrix4().makeRotationY(Math.atan2(sd.x, sd.z)), new Matrix4().makeRotationZ(R.spread(4) * DEG)));
    b.add(texturedPart('metal', g, a.key));
  }

  // ======================================================================
  // THE FLAP: a sprung steel plate in yellow enamel, hinged on the lip's top edge
  // ======================================================================
  {
    const ay = CHUTE.hz + f; // the lip's top edge, in the mouth frame (+Y)
    const ax = CHUTE.hx + f;
    const hinge = chain(mouthM, T(0, ay - 0.01, 0.012));
    const fl = b.node('flap', hinge);
    // the plate hangs down (-Y) from the hinge, a little in front of the lip
    const fw = 2 * ax - 0.06, fh = 2 * ay - 0.05;
    const plate = roundedBox({ w: fw, h: 0.018, d: fh, r: 0.007, rPlan: 0.05, segs: 2, detail, band: 0.012 });
    // a pressed rib across it
    const g = transform(plate, chain(T(0, -fh / 2 - 0.01, 0.0), new Matrix4().makeRotationX(Math.PI / 2)));
    fl.add(part('steel', g, 'tape-yellow', { seed: seed + 40, shade: 0.95, jitter: 0.03 }));
    const rib = bevelBox({ min: [-fw / 2 + 0.06, -fh * 0.55 - 0.02, 0.009], max: [fw / 2 - 0.06, -fh * 0.55 + 0.02, 0.022], c: 0.009, omit: ['nz'] });
    fl.add(part('steel', rib, 'tape-yellow', { seed: seed + 41, shade: 1.05 }));
    // the hinge knuckles (fixed on the lip, moving on the flap), a pin, and a coil spring
    const knuckle = (x: number, len: number): ReturnType<typeof lathe> => transform(lathe(profile(0, 0).to(0.02, 0, { sharp: true }).to(0.02, len, { sharp: true }).to(0, len), { segs: 8, detail, band: 0 }), aim([x - len / 2, 0, 0], [1, 0, 0]));
    fl.add(part('brass', knuckle(-fw * 0.2, fw * 0.24), 'brass', { seed: seed + 42 }));
    fl.add(part('brass', knuckle(fw * 0.2, fw * 0.24), 'brass', { seed: seed + 42 }));
    b.add(part('brass', transform(knuckle(0, fw * 0.14), hinge), 'brass', { seed: seed + 43, shade: 0.9 }));
    b.add(part('brass', transform(knuckle(-fw / 2 - 0.02, 0.06), hinge), 'brass', { seed: seed + 43, shade: 0.9 }));
    b.add(part('brass', transform(knuckle(fw / 2 + 0.02, 0.06), hinge), 'brass', { seed: seed + 43, shade: 0.9 }));
    // the spring: a coil on the pin beside the near knuckle, its tail on the flap
    const coil = sweep({ points: Array.from({ length: 19 }, (_, i) => { const a = (i / 18) * Math.PI * 2 * 3; return new Vector3(fw * 0.36 + (i / 18) * 0.06, Math.sin(a) * 0.026, Math.cos(a) * 0.026); }) }, { radius: 0.006, segs: 4, detail, ends: 'flat' });
    b.add(part('metal', transform(coil, hinge), 'steel', { seed: seed + 44, shade: 0.8 }));
    // a brass knob at its foot, where the part pushes it
    fl.add(setFinish(part('brass', transform(lathe(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.015, { fillet: 0.006, segs: 1 }).to(0.02, 0.03, { fillet: 0.01, segs: 1 }).to(0, 0.032), { segs: 8, detail, band: 0 }), aim([0, -fh + 0.05, 0.009], [0, 0, 1])), 'brass', { seed: seed + 45 }), 0.6));
  }

  // ======================================================================
  // SOCKETS
  // ======================================================================
  b.socket('mouth', mouthM);
  const land = dp.end.clone().addScaledVector(h, 0.45);
  b.socket('land', chain(T(land.x, 0, land.z), new Matrix4().makeRotationY(-CHUTE.yaw * DEG)));
  b.socket('collar', T(0, 0, 0));

  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`chute: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    poseChute(built.root, p);
  }
  return built;
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'chute',
    build: (opts = {}) =>
      chute({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['pose'] === 'string' ? { pose: opts['pose'] } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as ChuteLabelRefs } : {}),
      }),
    labels: (labels) => ({ labels: chuteLabels(labels) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    poses: Object.keys(NAMED_POSES),
    camera: { distance: 3 },
    note: 'The return chute: a duct up through the bench, a flared mouth, a sprung flap. What falls off comes back here.',
  },
];
