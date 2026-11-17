/**
 * Fetch, take A ("the Bulb"): the geometry. See ./rig.ts for the node tree,
 * the pivots and the poses. Every node's parts are built in that node's own
 * space (origin = its pivot), so the rig moves them cleanly.
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import { lathe, extrude, segs as segN } from '../../solids.ts';
import { profile } from '../../profile.ts';
import type { PSample } from '../../profile.ts';
import { sweep, polylinePath, linePath, arcPath, sections } from '../../sweep.ts';
import { collar, domeRivet, hexBolt, spring as coilSpring } from '../../details.ts';
import { aim, chain, part, piece, place, ring, T } from '../../compose.ts';
import type { NodeBuilder } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { deform, dent, transform } from '../../deform.ts';
import { setFinish, grain } from '../../space.ts';
import { finish, MeshData } from '../../mesh.ts';
import { DIM, PARENT, NODE_NAMES, eyeDims, aerialFrame, poseMatrices } from './rig.ts';
import type { NodeName } from './rig.ts';

export interface FetchBuildOptions extends KitOptions {
  /** Texture key of the name tape (made by view/labels, e.g. `labels.tape(world.names.fetch)`). Without it, only the `nameplate` socket is left. */
  nameKey?: string;
  /** World size the tape wants (labels.size(key)); default 0.2 × 0.055. */
  nameSize?: { w: number; h: number };
}

const DEG = Math.PI / 180;
const toZ = new Matrix4().makeRotationX(Math.PI / 2); // a lathe's +Y onto +Z
const toX = new Matrix4().makeRotationZ(-Math.PI / 2); // a lathe's +Y onto +X
const toNegX = new Matrix4().makeRotationZ(Math.PI / 2); // a lathe's +Y onto -X
/** Hardware (bolts, rivets, screws) is seen at a few pixels: always the cheap cut. */
const HW = 'low' as const;

// ---- the bulb's outline ----------------------------------------------------------

type P2 = [number, number];

/** The bulb's side profile (o, y) in head space, bottom (neck) to top, with outward normals. */
export function bulbOutline(n = 1): PSample[] {
  const { neckR, neckY, eqY, rMax, top } = DIM.bulb;
  const pts: P2[] = [];
  // the neck rises nearly straight, then swells into the bulb: a cubic, vertical at the equator
  const P0: P2 = [neckR, neckY], P1: P2 = [neckR + 0.02, neckY + 0.06], P2: P2 = [rMax, eqY - 0.12], P3: P2 = [rMax, eqY];
  const nl = Math.max(5, Math.round(7 * n));
  for (let i = 0; i <= nl; i++) {
    const t = i / nl, u = 1 - t;
    pts.push([
      u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
      u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
    ]);
  }
  // the dome: a superellipse quarter, fuller than a sphere (a bulb, not a ball)
  const nu = Math.max(6, Math.round(9 * n));
  const k = 2.15;
  for (let i = 1; i <= nu; i++) {
    const a = (i / nu) * (Math.PI / 2);
    pts.push([rMax * Math.pow(Math.cos(a), 2 / k), eqY + (top - eqY) * Math.pow(Math.sin(a), 2 / k)]);
  }
  const out: PSample[] = [{ o: 0, y: neckY, no: 0, ny: -1 }, { o: neckR, y: neckY, no: 0, ny: -1 }];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    let to = b[0] - a[0], ty = b[1] - a[1];
    if (i === pts.length - 1) {
      to = -1;
      ty = 0;
    }
    const l = Math.hypot(to, ty) || 1;
    out.push({ o: pts[i]![0], y: pts[i]![1], no: ty / l, ny: -to / l });
  }
  return out;
}

const OUTLINE = bulbOutline(3).slice(1);
/** The bulb's radius at height y (head space), before the face is pressed. */
export function bulbR(y: number): number {
  for (let i = 0; i < OUTLINE.length - 1; i++) {
    const a = OUTLINE[i]!, b = OUTLINE[i + 1]!;
    if ((y - a.y) * (y - b.y) <= 0 && Math.abs(b.y - a.y) > 1e-9) return a.o + ((b.o - a.o) * (y - a.y)) / (b.y - a.y);
  }
  return y < DIM.bulb.neckY ? DIM.bulb.neckR : 0;
}

/** The face: the bulb's front is pressed a little flat, so the eye sits in a face and not on a ball. */
export function pressFace(x: number, y: number, z: number): [number, number, number] {
  const { faceZ, faceSoft } = DIM.bulb;
  if (z <= faceZ) return [x, y, z];
  return [x, y, faceZ + faceSoft * Math.tanh((z - faceZ) / faceSoft)];
}

/** A point on the bulb's skin at height y and azimuth a (0 = front, + toward +X), lifted by `lift`. */
function onBulb(y: number, a: number, lift = 0): { p: [number, number, number]; n: [number, number, number] } {
  const r = bulbR(y) + lift;
  const p = pressFace(Math.sin(a) * r, y, Math.cos(a) * r);
  const dy = 0.004;
  const slope = (bulbR(y + dy) - bulbR(y - dy)) / (2 * dy);
  const n = new Vector3(Math.sin(a), -slope, Math.cos(a)).normalize();
  return { p, n: [n.x, n.y, n.z] };
}

/**
 * Handling grime in the paint's colour: the bulb darkens and warms toward its neck and
 * underside (where oil and dust collect), with a slow seeded mottle, so the cream is
 * old enamel and not a new plastic ball.
 */
function grime(pt: KitPart, seed: number): KitPart {
  const g = pt.geometry;
  const R = rng(seed);
  const ph = [R.range(0, 6.3), R.range(0, 6.3), R.range(0, 6.3)];
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const low = 1 - Math.min(1, Math.max(0, (y - 0.06) / 0.32));
    const mottle = Math.sin(x * 9 + ph[0]!) * Math.sin(y * 11 + ph[1]!) * Math.sin(z * 8 + ph[2]!);
    const k = (1 - 0.3 * low * low) * (1 + 0.06 * mottle);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * (1 - 0.04 * low), col.getZ(i) * k * (1 - 0.12 * low));
  }
  col.needsUpdate = true;
  return pt;
}

// ---- building ---------------------------------------------------------------------

export function buildFetchBulb(o: FetchBuildOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('fetch-bulb', { detail, seed });
  const M = poseMatrices({});

  // the node tree, in NODE_NAMES order (parents come first)
  const nodes = { root: b } as unknown as Record<NodeName, NodeBuilder>;
  for (const n of NODE_NAMES) {
    if (n === 'root') continue;
    nodes[n] = nodes[PARENT[n]].node(n, M[n]);
  }
  const N = nodes;
  const e = eyeDims();
  const S = (n: number, min = 6): number => segN(n, detail, min);

  // ===== the wheel (wheel space: +Y is the axle) =====================================
  {
    const R0 = DIM.tyreR, hw = DIM.tyreW / 2;
    const tyre = lathe(
      profile(R0 * 0.57, -hw + 0.016)
        .to(R0 * 0.82, -hw, { fillet: 0.028 })
        .to(R0, -hw + 0.042, { fillet: 0.036 })
        .to(R0, -0.03, { smooth: true })
        .groove(0.012, 0.016, 0.003, 0.002)
        .to(R0, hw - 0.042, { smooth: true })
        .to(R0 * 0.82, hw, { fillet: 0.036 })
        .to(R0 * 0.57, hw - 0.016, { fillet: 0.028 }),
      { segs: S(28, 14), detail, caps: false },
    );
    // moulded tread: staggered blocks across the crown, pressed out of the round
    const lugs = 14;
    deform(tyre, (x, y, z) => {
      const r = Math.hypot(x, z);
      if (r < R0 - 0.035) return [x, y, z];
      const a = Math.atan2(z, x);
      const w = Math.cos(a * lugs + (y > 0 ? Math.PI : 0));
      const block = Math.max(0, Math.min(1, (w + 0.1) * 2.5)) * Math.min(1, Math.max(0, (Math.abs(y) - 0.016) / 0.02));
      const k = 1 + (block * 0.013 * Math.min(1, (r - (R0 - 0.035)) / 0.025)) / r;
      return [x * k, y, z * k];
    });
    N.wheel.add(part('rubber', tyre, 'ink', { seed: seed + 1, jitter: 0.04 }));
    // the hub: a pressed dish, painted, with a turned brass cap and wheel nuts each side
    const hub = lathe(
      profile(0, -hw + 0.034)
        .to(0.044, -hw + 0.034, { fillet: 0.012 })
        .to(R0 * 0.6, -hw + 0.012, { fillet: 0.008 })
        .to(R0 * 0.62, -hw + 0.022, { fillet: 0.004 })
        .to(R0 * 0.62, hw - 0.022, { fillet: 0.004 })
        .to(R0 * 0.6, hw - 0.012, { fillet: 0.008 })
        .to(0.044, hw - 0.034, { fillet: 0.012 })
        .to(0, hw - 0.034),
      { segs: S(20, 10), detail },
    );
    N.wheel.add(part('steel', hub, 'paper', { seed: seed + 2, shade: 0.86, warm: 0.04 }));
    for (const s of [1, -1]) {
      const cap = lathe(profile(0, 0).to(0.034, 0, { sharp: true }).to(0.034, 0.01, { fillet: 0.006 }).to(0.024, 0.024, { fillet: 0.008 }).to(0, 0.028), { segs: S(14, 8), detail, caps: 'end' });
      N.wheel.add(setFinish(place([part('brass', cap, 'brass', { seed: seed + 3 + s, jitter: 0.05 })], aim([0, s * (hw - 0.036), 0], [0, s, 0])), 0.5));
      N.wheel.small(() => ring(hexBolt({ af: 0.022, detail: HW, seed: seed + 6 + s }), 0.066, 2, { frame: aim([0, s * (hw - 0.03), 0], [0, s, 0]), phase: R.range(0, 1) }));
    }
  }

  // ===== the fork and crown (lean space: origin at the axle) =============================
  {
    const top = DIM.crownTop - DIM.axleY;
    for (const s of [1, -1]) {
      const x0 = s * DIM.forkX;
      const path = polylinePath([[x0, -0.014, 0], [x0 + s * 0.014, top * 0.5, -0.004], [x0 * 0.9, top - 0.035, 0]], 0.08, 4);
      const leg = sweep(path, { section: sections.roundRect(0.009, 0.03, 1), radius: 0.018, taper: (t) => 1.1 - 0.16 * t, step: 0.04, detail, ends: 'round', up: [1, 0, 0] });
      N.lean.add(part('steel', leg, 'teal-panel', { seed: seed + 10 + s, jitter: 0.04 }));
      // the axle stub: a brass spacer to the hub, a fat nut outside the leg
      N.lean.add(place([part('brass', lathe(profile(0, 0).to(0.032, 0, { sharp: true }).to(0.032, DIM.forkX - DIM.tyreW / 2 - 0.02, { fillet: 0.006, segs: 1 }).to(0, DIM.forkX - DIM.tyreW / 2 - 0.02), { segs: S(12, 8), detail, caps: false }), 'brass', { seed: seed + 12 + s, jitter: 0.05 })], aim([s * (DIM.tyreW / 2 - 0.012), 0, 0], [s, 0, 0])));
      N.lean.add(place(hexBolt({ af: 0.05, h: 0.024, washer: false, detail: HW, seed: seed + 14 + s }), aim([x0 + s * 0.028, 0, 0], [s, 0, 0])));
    }
    // the crown: a cast bridge over the tyre, with a brass seat for the spring
    const crown = lathe(
      profile(0, top - 0.07).to(0.074, top - 0.07, { fillet: 0.022 }).to(0.094, top - 0.012, { fillet: 0.02 }).to(0.05, top, { fillet: 0.012 }).to(0, top),
      { segs: S(14, 8), detail },
    );
    const bridge = sweep(
      polylinePath([[-DIM.forkX * 0.92, top - 0.054, 0], [-0.07, top - 0.034, 0], [0.07, top - 0.034, 0], [DIM.forkX * 0.92, top - 0.054, 0]], 0.08, 4),
      { section: sections.roundRect(0.009, 0.034, 1), radius: 0.016, detail, ends: 'round', up: [0, 1, 0] },
    );
    N.lean.add(part('steel', crown, 'teal-panel', { seed: seed + 16, jitter: 0.04 }), part('steel', bridge, 'teal-panel', { seed: seed + 17, jitter: 0.04 }));
    N.lean.add(place(collar({ r: 0.052, inner: 0.026, h: 0.014, detail: HW, seed: seed + 18 }), T(0, top - 0.002, 0)));
  }

  // ===== the neck: a coil spring (scaled by squash) round a sliding post ======================
  {
    const h = DIM.bodyY - DIM.crownTop;
    N.spring.add(coilSpring({ r: 0.046, wire: 0.0095, turns: 3, pitch: (h - 0.012) / 3.2, detail: 'low', seed: seed + 20, material: 'metal', token: 'steel' }));
    const post = lathe(profile(0, -0.06).to(0.022, -0.06, { sharp: true }).to(0.022, h + 0.01, { sharp: true }).to(0, h + 0.01), { segs: S(12, 8), detail, caps: false });
    N.suspension.add(setFinish(part('metal', post, 'steel', { seed: seed + 21 }), 0.8));
  }

  // ===== the yoke (body space) and the shoulders ===========================================
  {
    const yoke = lathe(
      profile(0.11, 0.064)
        .to(0.11, 0.02, { sharp: true })
        .to(0.03, 0.0, { sharp: true })
        .to(0.03, -0.02, { fillet: 0.006, segs: 1 })
        .to(0.1, -0.03, { fillet: 0.024, segs: 2 })
        .to(0.162, 0.01, { fillet: 0.03, segs: 2 })
        .to(0.164, 0.05, { fillet: 0.012, segs: 2 })
        .to(0.136, 0.068, { fillet: 0.008, segs: 1 })
        .close(),
      { segs: S(20, 10), detail },
    );
    N.body.add(part('steel', yoke, 'teal-panel', { seed: seed + 30, jitter: 0.04 }));
    for (const s of [1, -1]) {
      const sh = DIM.shoulder;
      const housing = lathe(
        profile(0, -0.03).to(0.05, -0.03, { sharp: true }).to(0.056, 0.022, { fillet: 0.014, segs: 2 }).to(0.046, 0.044, { fillet: 0.012, segs: 2 }).to(0, 0.044),
        { segs: S(11, 8), detail, caps: 'end' },
      );
      N.body.add(place([part('steel', housing, 'teal-panel', { seed: seed + 31 + s, jitter: 0.04 })], chain(T(s * (sh.x - 0.06), sh.y, sh.z), s > 0 ? toX : toNegX)));
    }
  }

  // ===== the head: the bulb, its screw base, the band, the face ===========================
  {
    const bulb = lathe(bulbOutline(hi ? 1 : 0.6), { segs: S(36, 18), detail, caps: false });
    deform(bulb, pressFace);
    // a knock on the back of the dome, from some earlier delivery
    dent(bulb, [-0.2, 0.5, -0.17], [-0.6, 0.6, -0.5], 0.075, 0.009);
    N.head.add(grime(part('steel', bulb, 'paper', { seed: seed + 50, jitter: 0.025, warm: 0.03, shade: 0.86 }), seed + 48));

    // the screw base: brass threads seated in the yoke
    const nr = DIM.bulb.neckR;
    const base = lathe(
      profile(0, -0.034)
        .to(nr - 0.012, -0.034, { fillet: 0.006 })
        .to(nr - 0.006, 0.006, { smooth: true })
        .bead(0.008, 0.02, 3)
        .to(nr - 0.004, 0.03)
        .to(nr - 0.002, DIM.bulb.neckY + 0.006, { fillet: 0.004 })
        .to(0, DIM.bulb.neckY + 0.006),
      { segs: S(18, 10), detail, caps: false },
    );
    N.head.add(setFinish(part('brass', base, 'brass', { seed: seed + 51, jitter: 0.04 }), 0.2));

    // the teal band round the bulb's widest part (the eye's barrel covers it in front)
    const y0 = DIM.bulb.eqY - 0.05, y1 = DIM.bulb.eqY + 0.03;
    const bandP = profile(bulbR(y0) - 0.004, y0)
      .to(bulbR(y0) + 0.008, y0 + 0.004, { fillet: 0.004 })
      .to(bulbR((y0 + y1) / 2) + 0.013, (y0 + y1) / 2, { smooth: true })
      .to(bulbR(y1) + 0.008, y1 - 0.004, { fillet: 0.004 })
      .to(bulbR(y1) - 0.004, y1);
    const band = deform(lathe(bandP, { segs: S(26, 14), detail, caps: false }), pressFace);
    N.head.add(part('steel', band, 'teal-light', { seed: seed + 52, jitter: 0.03 }));
    // rivets along the band's sides and back
    N.head.small(() => {
      const out: KitPart[] = [];
      for (let i = 0; i < 0; i++) {
        const a = (75 + i * 105) * DEG;
        if (Math.cos(a) > 0.6) continue; // the barrel is there
        const q = onBulb((y0 + y1) / 2, a, 0.013);
        out.push(...place(domeRivet({ d: 0.019, detail: HW, seed: seed + 60 + i, material: 'metal', token: 'steel' }), aim(q.p, q.n)));
      }
      return out;
    });

    // two panel seams over the dome, where the shell was rolled and welded: grime gathers in them
    for (const az of [100 * DEG, -112 * DEG]) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 7; i++) {
        const y = y1 + 0.004 + (DIM.bulb.top - 0.06 - y1) * (i / 7);
        pts.push(new Vector3(...onBulb(y, az + i * 0.05, 0.001).p));
      }
      N.head.add(part('steel', sweep({ points: pts }, { radius: 0.0042, segs: 5, ends: 'round', detail }), 'paper', { seed: seed + 55, shade: 0.72, warm: 0.06 }));
    }

    // a hatch on the crown of the head with a row of vents, set a little off true
    const hq0 = onBulb(DIM.bulb.top - 0.05, 150 * DEG, -0.004);
    const hatchM = chain(aim(hq0.p, hq0.n, 0), new Matrix4().makeRotationY(-0.5));
    const curve = (x: number, z: number): number => (x * x + z * z) * 0.95;
    const hatch = extrude([[-0.085, -0.055], [0.085, -0.055], [0.085, 0.055], [-0.085, 0.055]], 0.016, { axis: 'y', bevel: 0.006, radius: 0.032, detail, caps: 'end', bevelBase: 0, band: 0 });
    N.head.add(place([part('steel', deform(hatch, (x, y, z) => [x, y - curve(x, z), z]), 'teal-light', { seed: seed + 70, jitter: 0.04 })], hatchM));
    const vents: KitPart[] = [];
    for (let i = 0; i < 2; i++) {
      const z = -0.014 + i * 0.028;
      const slot = sweep(linePath([-0.05, 0, 0], [0.05, 0, 0], 1), { radius: 0.0058, segs: 6, ends: 'round', detail });
      vents.push(part('steel', transform(slot, T(0, 0.015 - curve(0, z), z)), 'teal-deep', { seed: seed + 71 + i }));
    }
    N.head.add(place(vents, hatchM));


    // a riveted repair patch low on the left cheek (the visitor's right)
    const pq = onBulb(0.2, 44 * DEG, 0.001);
    const patchM = aim(pq.p, pq.n, 14);
    const patch = extrude([[-0.05, -0.036], [0.047, -0.041], [0.052, 0.035], [-0.046, 0.032]], 0.008, { axis: 'y', bevel: 0.003, radius: 0.008, detail, caps: 'end', bevelBase: 0, band: 0 });
    N.head.add(place([part('steel', transform(patch, T(0, -0.004, 0)), 'paper', { seed: seed + 85, shade: 0.9, warm: 0.05 })], patchM));
    N.head.small(() => [[-0.038, -0.025], [0.04, 0.024], [-0.035, 0.022]].flatMap(([x, z], i) => place(domeRivet({ d: 0.012, detail: HW, seed: seed + 86 + i, material: 'metal', token: 'steel' }), chain(patchM, T(x!, 0.004, z!)))));

    // the aerial's mount: a brass boss on the bulb's back-left shoulder
    const { dir } = aerialFrame();
    const ab = DIM.aerial.base;
    N.head.add(place(collar({ r: 0.036, inner: 0.012, h: 0.034, detail: HW, seed: seed + 90 }), aim([ab[0] - dir.x * 0.026, ab[1] - dir.y * 0.026, ab[2] - dir.z * 0.026], [dir.x, dir.y, dir.z])));
  }

  // ===== the eye (eye space: origin at the lens sphere's centre, +Z out along its axis) ===========
  {
    const zb = e.zb;
    const rb = e.bezelR + 0.016;
    // the barrel the eye sits in, flaring into the face
    const barrel = lathe(
      profile(0, zb - 0.21)
        .to(rb - 0.004, zb - 0.21, { sharp: true })
        .to(rb, zb - 0.08, { smooth: true })
        .to(rb, zb - 0.05, { smooth: true })
        .bead(0.008, 0.016, 3)
        .to(rb, zb - 0.006, { fillet: 0.009 })
        .to(0, zb - 0.006),
      { segs: S(22, 12), detail, caps: false },
    );
    N.eye.add(part('steel', transform(barrel, toZ), 'paper', { seed: seed + 100, jitter: 0.02, warm: 0.02 }));
    // the bezel: a turned brass ring with a chamfered bore
    const bezel = lathe(
      profile(e.boreR, zb - 0.004)
        .to(e.bezelR, zb - 0.004, { sharp: true })
        .to(e.bezelR, zb + 0.016, { fillet: 0.01, segs: 2 })
        .to(e.bezelR - 0.012, e.zFront, { fillet: 0.01, segs: 2 })
        .to(e.boreR + 0.012, e.zFront, { fillet: 0.005, segs: 1 })
        .to(e.boreR, e.zFront - 0.012, { fillet: 0.003, segs: 1 })
        .close(),
      { segs: S(26, 12), detail },
    );
    N.eye.add(setFinish(part('brass', transform(bezel, toZ), 'brass', { seed: seed + 101, jitter: 0.04, warm: 0.03 }), 0.55));
    // a dark rubber gasket in the gap the lids slide through
    const gasket = lathe(profile(e.lensBaseR - 0.006, zb - 0.008).to(e.boreR + 0.01, zb - 0.008, { sharp: true }).to(e.boreR + 0.01, zb - 0.003, { sharp: true }).to(e.lensBaseR - 0.006, zb - 0.003).close(), { segs: S(16, 8), detail });
    N.eye.add(part('rubber', transform(gasket, toZ), 'ink'));
    // the lens: dark glass, a sphere cap
    const ln = hi ? 7 : 5;
    const lensS: PSample[] = [];
    for (let i = 0; i <= ln; i++) {
      const t = e.cap * (1 - i / ln);
      lensS.push({ o: e.R * Math.sin(t), y: e.R * Math.cos(t) - (i === 0 ? 0.002 : 0), no: Math.sin(t), ny: Math.cos(t) });
    }
    N.eye.add(setFinish(part('glass', transform(lathe(lensS, { segs: S(24, 12), detail, caps: false }), toZ), 'ink'), 0.75));
    // hinge bosses for the lid shutters, either side of the bezel
    for (const s of [1, -1]) {
      const boss = lathe(profile(0, 0).to(0.028, 0, { sharp: true }).to(0.028, 0.012, { fillet: 0.006 }).to(0.018, 0.024, { fillet: 0.006 }).to(0, 0.026), { segs: S(12, 8), detail, caps: 'end' });
      N.eye.add(setFinish(place([part('brass', boss, 'brass', { seed: seed + 104 + s, jitter: 0.05 })], chain(T(s * (e.bezelR + 0.004), 0, zb - 0.034), s > 0 ? toX : toNegX)), 0.6));
    }
    // screws round the bezel face
    // four fixings round the bezel face: brass rivets, and one steel nut where a rivet was replaced
    const replaced = R.int(0, 3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const rr = (e.boreR + e.bezelR) / 2 - 0.003;
      const at = chain(T(Math.cos(a) * rr, Math.sin(a) * rr, e.zFront - 0.004), toZ);
      N.eye.small(() =>
        place(i === replaced ? hexBolt({ af: 0.02, h: 0.008, detail: HW, seed: seed + 108 + i }) : domeRivet({ d: 0.017, detail: HW, seed: seed + 108 + i, material: 'brass', token: 'brass' }), at),
      );
    }

    // ---- the brow: a hinged visor over the bezel; it shades the eye and gives it an eyebrow to act with ----
    {
      const rv = rb + 0.009; // its underside rests on the barrel
      const zh = zb - 0.085; // the hinge line (the node's origin)
      const bp = profile(rv - 0.008, zb - 0.1)
        .to(rv + 0.002, zb - 0.1, { fillet: 0.004, segs: 1 })
        .to(rv + 0.006, e.zFront + 0.006, { fillet: 0.01, segs: 2 })
        .to(rv - 0.012, e.zFront + 0.03, { fillet: 0.006, segs: 2 })
        .to(rv - 0.02, e.zFront + 0.02, { fillet: 0.004, segs: 1 })
        .to(rv - 0.008, e.zFront - 0.004, { smooth: true })
        .close();
      // over the top, 112 degrees of arc (lathe angles: -90 deg lands on +Y after toZ); the ends taper shut
      const half = 56 * DEG;
      const visor = transform(lathe(bp, { segs: S(14, 8), detail, from: -Math.PI / 2 - half, to: -Math.PI / 2 + half }), toZ);
      const rm = rv - 0.004;
      deform(visor, (x, y, z) => {
        const off = Math.abs(Math.atan2(x, y)); // 0 at the top
        const t = Math.max(0, Math.min(1, (half - off) / (18 * DEG)));
        const k = Math.max(0.3, Math.sin((t * Math.PI) / 2));
        const r = Math.hypot(x, y) || 1;
        const r2 = rm + (r - rm) * k;
        return [(x / r) * r2, (y / r) * r2, zh + (z - zh) * (0.8 + 0.2 * k)];
      });
      N.brow.add(part('steel', transform(visor, T(0, -(e.bezelR + 0.016), -zh)), 'teal-light', { seed: seed + 115, jitter: 0.03 }));
      // its hinge knuckle on the barrel
      const kn = lathe(profile(0, -0.05).to(0.011, -0.05, { fillet: 0.004, segs: 1 }).to(0.011, 0.05, { fillet: 0.004, segs: 1 }).to(0, 0.05), { segs: S(8, 6), detail });
      N.brow.add(setFinish(part('brass', transform(kn, toX), 'brass', { seed: seed + 116 }), 0.4));
    }

    // ---- the pupil node: the lit iris, its brass aperture ring and the dark pupil ----
    const sphereRing = (r: number, a0: number, a1: number, n: number): PSample[] => {
      const out: PSample[] = [];
      for (let i = 0; i <= n; i++) {
        const t = a1 - ((a1 - a0) * i) / n;
        out.push({ o: r * Math.sin(t), y: r * Math.cos(t), no: Math.sin(t), ny: Math.cos(t) });
      }
      return out;
    };
    const aI = Math.asin(e.irisR / e.R), aP = Math.asin(e.pupilR / e.R);
    const iris = lathe(sphereRing(e.R + 0.0025, aP - 0.01, aI, hi ? 4 : 3), { segs: S(24, 12), detail, caps: false });
    // the iris is lit like an indicator lamp (finish 1), not a bulb: it reads as lit without blooming into a blob
    N.pupil.add(setFinish(part('bulb', transform(iris, toZ), 'amber-glow'), 0.8));
    const rim = lathe(
      profile(e.R * Math.sin(aI - 0.012) + 0.0005, e.R * Math.cos(aI - 0.012) + 0.003)
        .to(e.R * Math.sin(aI + 0.03) + 0.004, e.R * Math.cos(aI + 0.03) + 0.002, { fillet: 0.003 })
        .to(e.R * Math.sin(aI + 0.03), e.R * Math.cos(aI + 0.03) - 0.002),
      { segs: S(24, 12), detail, caps: false },
    );
    N.pupil.add(setFinish(part('brass', transform(rim, toZ), 'brass', { seed: seed + 110 }), 0.7));
    const pup = lathe(sphereRing(e.R + 0.0045, 0, aP, hi ? 3 : 2), { segs: S(20, 10), detail, caps: false });
    N.pupil.add(setFinish(part('glass', transform(pup, toZ), 'ink'), 1));

    // ---- the lid shutters: thin spherical shells hinged on the eye's X axis, built shut ----
    const lid = (Rl: number, top: boolean): KitPart[] => {
      const w = e.boreR + 0.012; // half-width across the eye
      const t = 0.004;
      const ob = Math.sqrt(Rl * Rl - w * w), ib = Math.sqrt((Rl - t) ** 2 - w * w);
      const sag = (r: number, o0: number): number => (r - o0) / (2 * w);
      const p = profile(ob, -w)
        .arc(ob, w, sag(Rl, ob), hi ? 7 : 5, { sharp: true })
        .to(ib, w, { sharp: true })
        .arc(ib, -w, -sag(Rl - t, ib), hi ? 4 : 3, { sharp: true })
        .close();
      const e0 = top ? -1.2 * DEG : -118 * DEG, e1 = top ? 118 * DEG : 1.2 * DEG;
      // lathe about Y, then Y onto X: the lathe angle φ lands at elevation φ − 90° above the eye's axis
      const g = transform(lathe(p, { segs: S(9, 6), detail, from: Math.PI / 2 + e0, to: Math.PI / 2 + e1 }), toX);
      const parts: KitPart[] = [part('steel', g, 'paper', { seed: seed + (top ? 120 : 121), jitter: 0.02 })];
      // the lip on the leading edge, so the lid has a thickness you can see
      const el = top ? -1.2 * DEG : 1.2 * DEG;
      const a0 = Math.acos(w / (Rl - t / 2));
      const lipPath = arcPath([0, 0, 0], Rl - t / 2, Math.PI - a0, a0, hi ? 10 : 6, [1, 0, 0], [0, Math.sin(el), Math.cos(el)]);
      parts.push(part('steel', sweep(lipPath, { radius: e.lip, segs: 6, ends: 'round', detail }), 'teal-light', { seed: seed + (top ? 122 : 123) }));
      return parts;
    };
    N.lidTop.add(lid(e.lidTopR, true));
    N.lidBottom.add(lid(e.lidBotR, false));
  }

  // ===== arms (arm space: origin at the shoulder, the arm hangs along −Y at rest) ===============
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const arm = N[`arm${side}`], fore = N[`forearm${side}`], hand = N[`hand${side}`];
    const knob = (r: number): BufferGeometry => lathe(profile(0, -r).to(r * 0.8, -r * 0.85, { fillet: r * 0.5 }).to(r, 0, { smooth: true }).to(r * 0.8, r * 0.85, { fillet: r * 0.5 }).to(0, r), { segs: S(8, 6), detail });
    arm.add(part('brass', transform(knob(0.044), toX), 'brass', { seed: seed + 130 + s, jitter: 0.05 }));
    const upper = sweep(linePath([0, -0.012, 0], [0, -DIM.upperArm + 0.01, 0], 2), { radius: 0.038, taper: (t) => 1 - 0.12 * t, step: 0.06, segs: 9, ends: 'round', detail });
    arm.add(part('steel', upper, 'teal-light', { seed: seed + 132 + s, jitter: 0.04 }));
    // elbow: a brass knuckle
    fore.add(part('brass', transform(knob(0.037), toX), 'brass', { seed: seed + 134 + s, jitter: 0.05 }));
    // the forearm swells toward the wrist (toy proportions: Popeye, not a pipe)
    const fa = sweep(linePath([0, -0.012, 0], [0, -DIM.forearm + 0.018, 0], 4), { radius: 0.036, taper: (t) => 0.92 + 0.55 * Math.sin(t * Math.PI * 0.6), step: 0.032, segs: 9, ends: 'round', detail });
    fore.add(part('steel', fa, 'teal-light', { seed: seed + 136 + s, jitter: 0.04 }));
    fore.add(part('brass', lathe(profile(0, -DIM.forearm - 0.006).to(0.05, -DIM.forearm - 0.006, { fillet: 0.006, segs: 1 }).to(0.05, -DIM.forearm + 0.012, { fillet: 0.006, segs: 1 }).to(0, -DIM.forearm + 0.01), { segs: S(12, 8), detail, caps: false }), 'brass', { seed: seed + 138 + s, jitter: 0.05 }));
    // the hand: a palm block and two steel pincer jaws with rubber pads
    const palm = lathe(profile(0, 0.004).to(0.046, 0.004, { fillet: 0.014 }).to(0.058, -0.032, { fillet: 0.018 }).to(0.04, -0.05, { fillet: 0.014 }).to(0, -0.05), { segs: S(11, 8), detail });
    hand.add(part('steel', palm, 'paper', { seed: seed + 140 + s, jitter: 0.04 }));
    for (const [jn, zs] of [[`pincer${side}a`, 1], [`pincer${side}b`, -1]] as const) {
      const jaw = sweep(polylinePath([[0, 0.008, zs * 0.02], [0, -0.04, zs * 0.048], [0, -0.09, zs * 0.012]], 0.04, 4), { radius: 0.018, taper: (t) => 1.1 - 0.3 * t, step: 0.03, segs: 7, ends: 'round', detail, up: [1, 0, 0] });
      N[jn as NodeName].add(part('metal', jaw, 'steel', { seed: seed + 142 + zs, jitter: 0.05 }));
    }
  }

  // ===== the aerial (segment spaces: +Y along the aerial) and its flag =======================
  {
    const seg = DIM.aerial.seg;
    const rod = (r0: number, r1: number, y0: number, y1: number): BufferGeometry => sweep(linePath([0, y0, 0], [0, y1, 0], 1), { radius: r0, taper: (t) => 1 - (1 - r1 / r0) * t, step: 0.14, segs: 6, ends: 'round', detail });
    N.aerial.add(setFinish(part('metal', rod(0.0095, 0.008, -0.03, seg + 0.006), 'steel', { seed: seed + 151 }), 0.6));
    N.aerial2.add(setFinish(part('metal', rod(0.0075, 0.0065, 0, seg + 0.006), 'steel', { seed: seed + 152 }), 0.6));
    N.aerial3.add(setFinish(part('metal', rod(0.0062, 0.0052, 0, seg), 'steel', { seed: seed + 153 }), 0.6));
    for (const n of ['aerial2', 'aerial3'] as const) {
      const ferrule = lathe(profile(0, -0.009).to(0.012, -0.009, { fillet: 0.003, segs: 1 }).to(0.012, 0.009, { fillet: 0.003, segs: 1 }).to(0, 0.009), { segs: S(8, 6), detail, caps: false });
      N[n].add(setFinish(part('brass', ferrule, 'brass', { seed: seed + 154 }), 0.5));
    }
    const tip = lathe(profile(0, -0.013).to(0.013, -0.008, { fillet: 0.006 }).to(0.014, 0.002, { smooth: true }).to(0, 0.015), { segs: S(10, 8), detail });
    N.aerial3.add(setFinish(part('brass', transform(tip, T(0, seg + 0.008, 0)), 'brass', { seed: seed + 155 }), 0.8));
    // the pennant: a swallowtail of stiff painted cloth, rippled, flying outward (−X)
    const flag = extrude([[0, 0.004], [-0.2, -0.006], [-0.15, -0.056], [-0.2, -0.108], [0, -0.116]], 0.005, { axis: 'z', bevel: 0.0018, radius: [0.004, 0.006, 0.01, 0.006, 0.004], detail });
    transform(flag, T(0, 0, -0.0025));
    deform(flag, (x, y, z) => [x, y + x * x * 0.45, z + Math.sin(x * 26 + 0.4) * 0.013 * Math.min(1, -x * 9)]);
    N.flag.add(part('paper', flag, 'tape-yellow', { seed: seed + 156, jitter: 0.05 }));
    N.flag.add(part('brass', sweep(linePath([0, -0.118, 0], [0, 0.006, 0], 1), { radius: 0.0095, segs: 7, ends: 'round', detail }), 'brass', { seed: seed + 157 }));
  }

  // ===== the name tape (when the labels have made one) and its socket =====================
  {
    const sz = o.nameSize ?? { w: 0.2, h: 0.055 };
    const yy = 0.185, az = -36 * DEG; // low on the bulb's right cheek (the visitor's left), under the eye
    const q = onBulb(yy, az, 0.003);
    b.socket('nameplate', chain(T(0, DIM.headY, 0), T(...q.p), new Matrix4().makeRotationY(az)));
    if (o.nameKey) {
      // a strip of tape bent round the bulb, a few degrees off level, one end lifting
      const md = new MeshData().withUv();
      const nu = 10;
      for (let i = 0; i <= nu; i++)
        for (let j = 0; j <= 1; j++) {
          const u = i / nu;
          const r0 = bulbR(yy);
          const ang = az + ((u - 0.5) * sz.w) / r0;
          const y = yy + (j - 0.5) * sz.h + (u - 0.5) * sz.w * 0.07;
          const lift = 0.003 + (u > 0.86 ? (u - 0.86) * 0.06 : 0);
          const pt = onBulb(y, ang, lift);
          md.v(pt.p[0], pt.p[1], pt.p[2], pt.n[0], pt.n[1], pt.n[2], u, j);
        }
      for (let i = 0; i < nu; i++) md.quad(i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1);
      N.head.add({ material: 'tape', geometry: grain(finish(md), 'x'), texture: o.nameKey });
    }
  }

  return b.build();
}
