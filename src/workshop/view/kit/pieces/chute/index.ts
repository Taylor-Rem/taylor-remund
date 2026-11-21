/**
 * The return chute (REWRITE.md § B1 "The bench edge": anything that falls
 * off comes back up the return chute; § D 7: a tool or a robot comes back
 * up the chute). Registry name `chute`. ART-P2 § 5 "THE RETURN CHUTE".
 *
 * What the story says: things fall off the bench and come back UP. A
 * galvanised square duct about 0.86 across rises out of the dark below the
 * bench, climbs the outside of the front apron at the front-left corner
 * (bolted to it by two straps), bends over the bench's rounded front edge,
 * runs back over the bench on a pair of bolted strap legs, turns to look
 * along the bench (+X) and tips its mouth up, so the visitor looks into a
 * dark throat. The mouth flares, with a `tape-yellow` enamel lip, and
 * stays open: no flap (a lid read as a mailbox, and a mailbox comes later).
 * A big stencilled up-arrow on the riser's face says which way things go.
 *
 * Frame: the origin is on the bench's front edge line at the duct's x
 * (y = 0 the bench top, z = 0 the front edge; the apron's face is at
 * z = -0.05 and runs from y = -0.36 to -1.11). Place it at (x, 0, 5) for a
 * bench whose front edge is z = 5, with no yaw. Below the apron the riser
 * goes on down into the dark (to y = CHUTE.bottom) and is built plain.
 *
 * Nothing moves but the station lamp's twin lenses (`lamp.lit` / `lamp.unlit`
 * under `lamp`, T1): a part pops out of the mouth and the view gives the duct
 * a shake (the whole piece) with the clunk.
 *
 * Sockets: `mouth` (the middle of the opening; +Z points out of it),
 * `land` (where a part that pops out comes to rest on the bench top),
 * `apron` (where the riser's back meets the apron, the duct's centre line
 * at the apron's middle height), `edge` (where the duct passes over the
 * bench's front edge), `bottom` (the riser's foot in the dark, where a
 * fallen part enters).
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { aim, chain, part, piece, T, texturedPart } from '../../compose.ts';
import { profile } from '../../profile.ts';
import { sweep, sections } from '../../sweep.ts';
import { deform, transform } from '../../deform.ts';
import { grain } from '../../space.ts';
import { rng } from '../../rng.ts';
import { bevelBox, hexHead, sheet, stud } from '../../cheap.ts';
import { tint } from '../../surface.ts';
import { pilotLamp } from '../../details.ts';

const DEG = Math.PI / 180;

export const CHUTE = {
  /** The duct's core half-size and the wall offset (outer half-size = core + wall = 0.43). */
  core: 0.36,
  wall: 0.07,
  /** The flare: the offset grows to this at the lip (outer half-size 0.6). */
  flare: 0.24,
  /** The riser's centre, out from the front edge (its back face clears the edge's nose). */
  riserZ: 0.48,
  /** Where the riser starts, in the dark under the bench. */
  bottom: -3.0,
  /** The first bend (over the edge), its radius, and the height the duct runs back at. */
  bend1: 0.5,
  runY: 1.08,
  /** How far back from the front edge the run goes before it turns (the `run` option): default, least, most. */
  run: 1.25,
  runMin: 1.0,
  runMax: 3.0,
  /** The mouth's heading in plan (the `aim` option), degrees from +X toward -Z: default, most. */
  aim: 0,
  aimMax: 40,
  /** The second bend (turning to look along the aim), and the third (tipping the mouth up by `pitch`). */
  bend2: 0.5,
  bend3: 0.45,
  pitch: 30,
  /** The straight before the lip. */
  lead: 0.18,
  /** The bench's section, as bench/frame.ts builds it: the apron's face, its top and bottom. */
  apronZ: -0.05,
  apronTop: -0.36,
  apronBottom: -1.11,
} as const;

export interface ChuteLabelRefs {
  /** The stencilled up-arrow on the riser. */
  arrow: { key: string; w: number; h: number };
}

export interface ChuteOptions extends KitOptions {
  /** How far back from the front edge the duct runs before it turns (CHUTE.run; CHUTE.runMin..runMax). Strap legs are added as it grows. */
  run?: number;
  /** The mouth's heading in plan, degrees from +X toward -Z (CHUTE.aim; 0..CHUTE.aimMax). */
  aim?: number;
  /** From `chuteLabels(labels)`; without it the riser carries no stencil (clay, tests). */
  labels?: ChuteLabelRefs;
}

/** T1: the station lamp's lens radius (world units). */
export const CHUTE_LAMP_R = 0.07;

/** The arrow's capital height (world units): 27 px at 60 px a unit. */
export const ARROW_CAP = 0.45;

/** Make the chute's stencil (the crates' own up-arrow, from world.json) and return its key and size. */
export function chuteLabels(labels: Labels): ChuteLabelRefs {
  const key = labels.stencil(world.stencil.up, { paint: 'ink', capHeight: ARROW_CAP });
  return { arrow: { key, ...labels.size(key) } };
}

/** The duct's centre line, as points, with the distance along it where each stretch starts. */
export function ductPath(runIn: number = CHUTE.run, aimIn: number = CHUTE.aim): { points: Vector3[]; sBend1: number; sRun: number; sBend2: number; sBend3: number; sLead: number; length: number; end: Vector3; dir: Vector3; heading: Vector3 } {
  const C = CHUTE;
  const pts: Vector3[] = [];
  const push = (p: Vector3): void => {
    if (!pts.length || pts[pts.length - 1]!.distanceTo(p) > 1e-6) pts.push(p);
  };
  const yR = C.runY - C.bend1;
  // the riser: one long straight (it is in the dark below the apron), a ring at the apron's foot
  push(new Vector3(0, C.bottom, C.riserZ));
  push(new Vector3(0, C.apronBottom - 0.2, C.riserZ));
  push(new Vector3(0, yR, C.riserZ));
  // bend 1: up and over the edge, to run back (-Z)
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    push(new Vector3(0, yR + C.bend1 * Math.sin(a), C.riserZ - C.bend1 + C.bend1 * Math.cos(a)));
  }
  const run = Math.max(C.runMin, Math.min(C.runMax, runIn));
  const aim = Math.max(0, Math.min(C.aimMax, aimIn)) * DEG;
  // the straight run ends where bend 2 starts: the turn's own reach makes up the rest of `run`
  const zB = -(run - C.bend2);
  push(new Vector3(0, C.runY, zB));
  // bend 2: in the horizontal, from -Z turning right by phi, to look along the aim
  const phi = Math.PI / 2 - aim;
  const n2 = Math.max(3, Math.round((6 * phi) / (Math.PI / 2)));
  for (let i = 1; i <= n2; i++) {
    const a = (i / n2) * phi;
    push(new Vector3(C.bend2 - C.bend2 * Math.cos(a), C.runY, zB - C.bend2 * Math.sin(a)));
  }
  // bend 3: tip up by `pitch`, in the vertical plane of the heading
  const h = new Vector3(Math.sin(phi), 0, -Math.cos(phi));
  const b3 = pts[pts.length - 1]!.clone(), p = C.pitch * DEG;
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * p;
    push(b3.clone().addScaledVector(h, C.bend3 * Math.sin(a)).add(new Vector3(0, C.bend3 * (1 - Math.cos(a)), 0)));
  }
  const dir = h.clone().multiplyScalar(Math.cos(p)).add(new Vector3(0, Math.sin(p), 0));
  const last = pts[pts.length - 1]!.clone();
  const end = last.clone().addScaledVector(dir, C.lead);
  push(end);
  const L = (a: number, b: number): number => {
    let s = 0;
    for (let i = a + 1; i <= b; i++) s += pts[i]!.distanceTo(pts[i - 1]!);
    return s;
  };
  const sBend1 = L(0, 2), sRun = sBend1 + C.bend1 * (Math.PI / 2);
  const sBend2 = sRun + (C.riserZ - C.bend1 - zB);
  const sBend3 = sBend2 + C.bend2 * phi;
  const sLead = sBend3 + C.bend3 * p;
  return { points: pts, sBend1, sRun, sBend2, sBend3, sLead, length: L(0, pts.length - 1), end, dir, heading: h };
}

/** A point and the tangent at distance s along a polyline. */
function along(points: readonly Vector3[], s: number): { p: Vector3; tan: Vector3 } {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, c = points[i]!;
    const l = a.distanceTo(c);
    if (acc + l >= s) return { p: a.clone().lerp(c, (s - acc) / l), tan: c.clone().sub(a).normalize() };
    acc += l;
  }
  const n = points.length;
  return { p: points[n - 1]!.clone(), tan: points[n - 1]!.clone().sub(points[n - 2]!).normalize() };
}

/** Darken the duct's inner wall (its normal faces the axis): the throat goes dark, darker the deeper. */
function darkenThroat(g: BufferGeometry, points: readonly Vector3[], end: Vector3, dir: Vector3): void {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), col = g.getAttribute('color') as BufferAttribute;
  const v = new Vector3(), q = new Vector3(), nn = new Vector3(), ab = new Vector3(), c = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = Infinity;
    for (let k = 1; k < points.length; k++) {
      const a0 = points[k - 1]!;
      ab.copy(points[k]!).sub(a0);
      const tt = Math.max(0, Math.min(1, c.copy(v).sub(a0).dot(ab) / ab.lengthSq()));
      c.copy(a0).addScaledVector(ab, tt);
      const d2 = c.distanceToSquared(v);
      if (d2 < best) {
        best = d2;
        q.copy(c);
      }
    }
    nn.fromBufferAttribute(nrm, i);
    if (nn.dot(c.copy(v).sub(q)) < 0) {
      const depth = Math.max(0, c.copy(end).sub(v).dot(dir));
      const k = 0.35 * Math.max(0.12, 1 - depth / 0.35);
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
  }
  col.needsUpdate = true;
}

export function chute(o: ChuteOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const C = CHUTE;
  const b = piece('chute', { detail, seed });
  const dp = ductPath(o.run, o.aim);
  const L = dp.length;
  const w = C.wall, f = C.flare, t = 0.02;
  const half = C.core + w;
  const sec = sections.roundRect(C.core, C.core, hi ? 2 : 1);
  const up: [number, number, number] = [1, 0, 0];
  // the mouth's frame: +Z out along the duct, X across (horizontal), Y the section's up
  const mz = dp.dir.clone();
  const mx = new Vector3().crossVectors(new Vector3(0, 1, 0), mz).normalize();
  const my = new Vector3().crossVectors(mz, mx).normalize();
  const mouthM = new Matrix4().makeBasis(mx, my, mz).setPosition(dp.end);

  // ======================================================================
  // LARGE: the duct, flaring to a rolled lip, its wall turning inside
  // ======================================================================
  {
    const p = profile(w, 0)
      .to(w, L - 0.34, { smooth: true })
      .to(w + 0.03, L - 0.17, { smooth: true })
      .to(f, L, { fillet: 0.03, segs: 2 })
      .to(f - t, L - 0.004, { fillet: 0.008, segs: 1 })
      .to(w + 0.02 - t, L - 0.2, { smooth: true })
      .to(w - t, L - 0.5);
    const g = sweep({ points: dp.points }, { section: sec, profile: p, up, detail });
    // a knock on the riser's face, a shallower one on the bend
    const knock = (at: Vector3, dir: Vector3, r: number, d: number): void => {
      deform(g, (x, y, z) => {
        const q = Math.hypot(x - at.x, y - at.y, z - at.z) / r;
        if (q >= 1) return [x, y, z];
        const k = (1 - q * q) ** 2 * d;
        return [x - dir.x * k, y - dir.y * k, z - dir.z * k];
      }, { keepSurf: true });
    };
    knock(new Vector3(0.22 + R.spread(0.04), 0.2, C.riserZ + half), new Vector3(0, 0, 1), 0.16, 0.025);
    knock(new Vector3(-0.1, C.runY + half, -0.35), new Vector3(0, 1, 0), 0.14, 0.018);
    tint(g, 'steel', { seed: seed + 1, shade: 1.08, jitter: 0.03 });
    // below the apron's foot the riser falls into the dark: a gradient, so it sinks rather than stops
    {
      const pos = g.getAttribute('position'), col = g.getAttribute('color') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y >= C.apronBottom) continue;
        const k = Math.max(0.12, 1 - (C.apronBottom - y) / 1.6);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
      }
    }
    darkenThroat(g, dp.points, dp.end, dp.dir);
    b.add({ material: 'metal', geometry: g });
    // the dark down the throat: a plug where the inner wall ends
    const plug = bevelBox({ min: [-C.core - w + t, -C.core - w + t, -0.002], max: [C.core + w - t, C.core + w - t, 0.002] });
    b.add(part('metal', transform(plug, chain(mouthM, T(0, 0, -0.5))), 'ink', { shade: 0.12 }));
  }
  // the lip: a rolled rim of yellow enamel round the mouth (the read from across the bench)
  {
    const o2 = half + (f - w) - 0.012;
    const n = hi ? 20 : 14;
    const pts: Vector3[] = [];
    const rc = 0.13; // the rim's corner radius, as the section's rounded corners at the flare
    const hx = o2 - rc;
    for (let i = 0; i < n; i++) {
      // a rounded square of half-size o2, walked by angle
      const a = (i / n) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      const s = Math.max(Math.abs(cx), Math.abs(cy));
      let x = (cx / s) * hx, y = (cy / s) * hx;
      x += Math.sign(cx) * rc * Math.abs(cx);
      y += Math.sign(cy) * rc * Math.abs(cy);
      pts.push(new Vector3(x, y, 0).applyMatrix4(mouthM));
    }
    const rim = sweep({ points: pts, closed: true }, { radius: 0.032, segs: hi ? 5 : 4, detail });
    b.add(part('steel', rim, 'tape-yellow', { seed: seed + 5, shade: 0.95, jitter: 0.03 }));
  }

  // ======================================================================
  // MEDIUM: gore seams, the straps (to the apron and down to the bench top)
  // ======================================================================
  {
    const gores = [C.apronBottom - 0.2 - C.bottom, dp.sBend1 + (dp.sRun - dp.sBend1) / 2, dp.sRun + 0.05, dp.sBend2 + (dp.sBend3 - dp.sBend2) / 2];
    // a longer run is made of more lengths: a seam every metre or so
    const straight = dp.sBend2 - dp.sRun;
    for (let k = 1; k < Math.floor(straight / 1.0); k++) gores.push(dp.sRun + (straight * k) / Math.floor(straight / 1.0));
    for (const s of gores) {
      const { p, tan } = along(dp.points, s);
      const band = sweep({ points: [p.clone().addScaledVector(tan, -0.02), p.clone().addScaledVector(tan, 0.02)] }, { section: sec, radius: w + 0.014, up: Math.abs(tan.y) > 0.9 ? up : [0, 1, 0], detail, ends: 'flat' });
      b.add(part('metal', band, 'steel', { seed: seed + 10, shade: 0.9 }));
    }
    // rivets beside the visible gores, on the faces toward the visitor
    for (const s of gores.slice(1)) {
      const { p, tan } = along(dp.points, s + 0.05);
      // the face toward the visitor: +Z on the riser, +Y on the run (seen from above)
      const n = Math.abs(tan.y) > 0.7 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      const acr = new Vector3().crossVectors(tan, n).normalize();
      for (const u of [-0.24, 0.24]) {
        const at = p.clone().addScaledVector(n, half + 0.002).addScaledVector(acr, u);
        b.small(() => [part('metal', transform(stud(0.018, 0.01, 6), aim([at.x, at.y, at.z], [n.x, n.y, n.z])), 'steel', { seed: seed + 12, shade: 0.85, jitter: 0.1 })]);
      }
    }
  }
  {
    // two straps hold the riser to the apron: a steel band round its sides and front, ears bolted back to the apron
    for (const y of [C.apronTop - 0.16, C.apronBottom + 0.14]) {
      const z0 = C.riserZ - half, z1 = C.riserZ + half + 0.02;
      for (const sx of [-1, 1]) {
        // the side bar runs from the front band back to the apron, where an ear turns out flat against it
        const side = bevelBox({ min: [sx > 0 ? half : -half - 0.02, y - 0.05, C.apronZ], max: [sx > 0 ? half + 0.02 : -half, y + 0.05, z1], c: 0.008, omit: ['nz'] });
        b.add(part('steel', side, 'teal-panel', { seed: seed + 20, shade: 0.9 }));
        const ear = bevelBox({ min: [sx > 0 ? half + 0.02 : -half - 0.14, y - 0.05, C.apronZ], max: [sx > 0 ? half + 0.14 : -half - 0.02, y + 0.05, C.apronZ + 0.02], c: 0.006, omit: ['nz', 'nx', 'px'] });
        b.add(part('steel', ear, 'teal-panel', { seed: seed + 21, shade: 0.85 }));
        b.small(() => [part('metal', transform(hexHead(0.04, 0.02, R.range(0, 1)), aim([sx * (half + 0.08), y, C.apronZ + 0.02], [0, 0, 1])), 'steel', { seed: seed + 22 })]);
      }
      b.add(part('steel', bevelBox({ min: [-half - 0.02, y - 0.05, z1 - 0.02], max: [half + 0.02, y + 0.05, z1], c: 0.008, omit: ['nz'] }), 'teal-panel', { seed: seed + 23, shade: 0.95 }));
    }
    // two strap legs under the run back over the bench: flat bars from the duct's sides to feet bolted to the bench top
    // strap legs along the run: two pairs at the default run, one more pair per 0.9 or so as it grows
    const straight = dp.sBend2 - dp.sRun;
    const nLegs = Math.max(2, Math.ceil((straight - 0.32) / 0.9) + 1);
    const legS = Array.from({ length: nLegs }, (_, i) => dp.sRun + 0.2 + ((straight - 0.32) * i) / (nLegs - 1));
    for (const s of legS) {
      const { p } = along(dp.points, s);
      for (const sx of [-1, 1]) {
        const x = sx * (half + 0.012);
        const leg = bevelBox({ min: [x - 0.012, 0.02, p.z - 0.045], max: [x + 0.012, p.y + 0.05, p.z + 0.045], c: 0.006, omit: ['ny', 'py', 'nz'] });
        b.add(part('steel', grain(leg, 'y'), 'teal-panel', { seed: seed + 24, shade: 0.85 }));
        const foot = bevelBox({ min: [x - 0.012 + (sx > 0 ? 0 : -0.09), 0, p.z - 0.06], max: [x + 0.012 + (sx > 0 ? 0.09 : 0), 0.022, p.z + 0.06], c: 0.006, omit: ['ny', 'nz'] });
        b.add(part('steel', foot, 'teal-panel', { seed: seed + 25, shade: 0.8 }));
        b.small(() => [part('metal', transform(stud(0.022, 0.012, 6), T(x + sx * 0.06, 0.022, p.z)), 'steel', { seed: seed + 26 })]);
      }
    }
  }
  if (o.labels) {
    // the stencilled up-arrow on the riser's face, between the straps: what fell comes back up here
    const a = o.labels.arrow;
    const g = sheet({ w: a.w, h: a.h, t: 0.001, nx: 1, ny: 1 });
    // high on the riser, where the camera sees it over the bench's edge: from just below the top to the bend
    const y = Math.min(CHUTE.runY - CHUTE.bend1 - a.h / 2 - 0.02, 0.24);
    transform(g, chain(T(R.spread(0.03), y, C.riserZ + half + 0.003), new Matrix4().makeRotationZ(R.spread(3) * DEG)));
    b.add(texturedPart('metal', g, a.key));
  }

  // ======================================================================
  // THE STATION LAMP (T1): a pilot lamp on the top of the run, just past the bend over the bench's edge, where
  // the camera looks down on it. Nodes `lamp` > `lamp.lit` / `lamp.unlit` (the view swaps them).
  // ======================================================================
  const lampM = (() => {
    const { p, tan } = along(dp.points, dp.sRun + Math.min(0.22, (dp.sBend2 - dp.sRun) * 0.35));
    const acr = new Vector3().crossVectors(tan, new Vector3(0, 1, 0)).normalize();
    return chain(T(p.x + acr.x * 0.12, p.y + half - 0.004, p.z + acr.z * 0.12), new Matrix4().makeRotationY(R.range(0, Math.PI)));
  })();
  {
    const pl = pilotLamp({ r: CHUTE_LAMP_R, seed: seed + 400, material: 'metal', unlit: 'metal' });
    b.add(...pl.fixed.map((q) => ({ ...q, geometry: transform(q.geometry, lampM) })));
    const lamp = b.node('lamp', lampM);
    lamp.node('lamp.lit', new Matrix4().makeScale(1e-4, 1e-4, 1e-4)).add(pl.lit);
    lamp.node('lamp.unlit').add(pl.unlit);
  }

  // ======================================================================
  // SOCKETS
  // ======================================================================
  b.socket('lamp', lampM);
  b.socket('mouth', mouthM);
  const land = dp.end.clone().addScaledVector(dp.heading, 0.7);
  b.socket('land', T(land.x, 0, land.z));
  b.socket('apron', T(0, (C.apronTop + C.apronBottom) / 2, C.apronZ));
  b.socket('edge', T(0, 0, 0));
  b.socket('bottom', T(0, C.bottom, C.riserZ));

  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'chute',
    build: (opts = {}) =>
      chute({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(typeof opts['run'] === 'number' ? { run: opts['run'] } : {}),
        ...(typeof opts['aim'] === 'number' ? { aim: opts['aim'] } : {}),
        ...(opts['labels'] ? { labels: opts['labels'] as ChuteLabelRefs } : {}),
      }),
    labels: (labels) => ({ labels: chuteLabels(labels) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 }, 'run 3': { run: 3 }, 'aim 40': { aim: 40 }, 'run 3 aim 40': { run: 3, aim: 40 }, 'aim 20': { aim: 20 } },
    camera: { distance: 6 },
    note: 'The return chute: a duct up out of the dark, over the bench edge, its yellow-lipped mouth open along the bench.',
  },
];
