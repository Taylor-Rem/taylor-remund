/**
 * Details: the small parts that make a thing look made. Each is low-poly
 * but never crude, returns KitPart[] (some details are two materials), and
 * is built at the origin standing on y = 0 along +Y (its mounting face on
 * y = 0) unless stated, so `aim(point, surfaceNormal)` seats it on any face.
 * Toy proportions: bolts are big.
 */
import type { BufferGeometry } from 'three';
import { Matrix4 } from 'three';
import type { Token } from '../palette.ts';
import type { KitPart, MaterialClass } from './types.ts';
import { lathe, extrude, segs } from './solids.ts';
import type { Detail } from './solids.ts';
import { ngon, outlineLoop, profile } from './profile.ts';
import { sweep, polylinePath, helixPath } from './sweep.ts';
import type { Path } from './sweep.ts';
import { aim, part, place, ring, T } from './compose.ts';
import { rng } from './rng.ts';
import { transform } from './deform.ts';
import { loft } from './loft.ts';
import { finish } from './mesh.ts';
import type { Loop, PSample } from './profile.ts';

export interface DetailOptions {
  detail?: Detail;
  material?: MaterialClass;
  token?: Token;
  seed?: number;
}

const tri = (d: Detail | undefined, n: number, min = 4): number => segs(n, d, min);

/** Hex bolt head (optionally on a washer). `af` = across flats. */
export function hexBolt(o: DetailOptions & { af?: number; h?: number; washer?: boolean } = {}): KitPart[] {
  const af = o.af ?? 0.06;
  const h = o.h ?? af * 0.42;
  const R = af / Math.sqrt(3); // circumradius from across-flats
  const out: KitPart[] = [];
  let y0 = 0;
  if (o.washer) {
    const wt = h * 0.28;
    out.push(part(o.material ?? 'metal', washerGeom(R * 1.35, R * 0.4, wt, o.detail), o.token ?? 'steel', { seed: o.seed ?? 0, jitter: 0.05 }));
    y0 = wt;
  }
  const spin = rng(o.seed ?? 0).range(0, Math.PI / 3);
  const head = extrude(ngon(6, R, spin), h, {
    axis: 'y',
    bevel: h * 0.32,
    bevelBase: 0,
    radius: R * 0.16,
    segs: o.detail === 'low' ? 1 : 2,
    support: false,
    caps: 'end',
    style: 'round',
  });
  transform(head, new Matrix4().makeTranslation(0, y0, 0));
  out.push(part(o.material ?? 'metal', head, o.token ?? 'steel', { seed: (o.seed ?? 0) + 1, jitter: 0.06 }));
  return out;
}

function washerGeom(ro: number, ri: number, t: number, d?: Detail): BufferGeometry {
  const r = t * 0.45;
  return lathe(profile(ri, 0).to(ro, 0, { sharp: true }).to(ro, t, { fillet: r, segs: 2 }).to(ri, t, { fillet: r * 0.5, segs: 1 }).close(), {
    segs: tri(d, 12, 8),
    support: false,
  });
}

/** A flat washer lying on y = 0. */
export function washer(o: DetailOptions & { od?: number; id?: number; t?: number } = {}): KitPart[] {
  const od = o.od ?? 0.07;
  return [part(o.material ?? 'metal', washerGeom(od / 2, (o.id ?? od * 0.45) / 2, o.t ?? od * 0.12, o.detail), o.token ?? 'steel', { seed: o.seed ?? 0, jitter: 0.05 })];
}

/** A dome-head rivet. */
export function domeRivet(o: DetailOptions & { d?: number; h?: number } = {}): KitPart[] {
  const r = (o.d ?? 0.035) / 2;
  const h = o.h ?? r * 0.7;
  const g = lathe(
    profile(0, 0)
      .to(r, 0, { sharp: true })
      .to(r, h * 0.14, { fillet: h * 0.1, segs: 1 })
      .curve(0, h, r * 0.92, h * 1.02, o.detail === 'low' ? 3 : 4),
    { support: false, caps: 'end', detail: o.detail ?? 'high' },
  );
  return [part(o.material ?? 'brass', g, o.token ?? 'brass', { seed: o.seed ?? 0, jitter: 0.07, warm: 0.04 })];
}

/** A cheese-head slotted screw: two bevelled half-heads either side of the slot, over a dark slot floor. */
export function slottedScrew(o: DetailOptions & { d?: number; h?: number } = {}): KitPart[] {
  const R = (o.d ?? 0.05) / 2;
  const h = o.h ?? R * 0.55;
  const gap = R * 0.13;
  const a = rng(o.seed ?? 0).range(0, Math.PI);
  const n = o.detail === 'low' ? 3 : 4;
  const half: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI;
    half.push([Math.cos(t) * R, Math.sin(t) * R]);
  }
  // pull the chord in by the half-gap
  const D = half.map(([x, z]) => [Math.max(x, gap), z] as [number, number]);
  const mk = (): BufferGeometry =>
    extrude(D, h, { axis: 'y', bevel: h * 0.45, bevelBase: 0, radius: h * 0.5, segs: 1, support: false, caps: 'end' });
  const g1 = mk();
  const g2 = transform(mk(), new Matrix4().makeRotationY(Math.PI));
  const floor = lathe(profile(R * 0.8, 0).to(R * 0.8, h * 0.35).to(0, h * 0.35), { segs: 8, support: false, caps: false });
  const spin = new Matrix4().makeRotationY(a);
  const out = [
    part(o.material ?? 'metal', transform(g1, spin), o.token ?? 'steel', { seed: o.seed ?? 0, jitter: 0.05 }),
    part(o.material ?? 'metal', transform(g2, spin), o.token ?? 'steel', { seed: o.seed ?? 0, jitter: 0.05 }),
    part(o.material ?? 'metal', floor, o.token ?? 'steel', { shade: 0.35 }),
  ];
  return out;
}

/** A wing nut: a turned boss with two rounded wings, along +Y. */
export function wingNut(o: DetailOptions & { size?: number } = {}): KitPart[] {
  const s = o.size ?? 0.07;
  const body = lathe(
    profile(0, 0)
      .to(s * 0.3, 0, { fillet: s * 0.04, segs: 1 })
      .to(s * 0.24, s * 0.36, { fillet: s * 0.06, segs: 2 })
      .to(0, s * 0.4),
    { segs: tri(o.detail, 12, 6), support: false },
  );
  const wingOutline: Array<[number, number]> = [
    [s * 0.12, s * 0.04],
    [s * 0.55, s * 0.28],
    [s * 0.58, s * 0.62],
    [s * 0.42, s * 0.66],
    [s * 0.16, s * 0.34],
  ];
  const thick = s * 0.09;
  const wing = (): BufferGeometry =>
    transform(
      extrude(wingOutline, thick, { axis: 'z', bevel: thick * 0.35, radius: [s * 0.03, s * 0.12, s * 0.12, s * 0.06, s * 0.06], segs: 2, support: false }),
      new Matrix4().makeTranslation(0, 0, -thick / 2),
    );
  const w1 = wing();
  const w2 = transform(wing(), new Matrix4().makeRotationY(Math.PI));
  const m = o.material ?? 'metal';
  const t = o.token ?? 'steel';
  return [part(m, body, t, { seed: o.seed ?? 0, jitter: 0.04 }), part(m, w1, t, { seed: o.seed ?? 0, jitter: 0.04 }), part(m, w2, t, { seed: o.seed ?? 0, jitter: 0.04 })];
}

/**
 * Louvre vent panel, standing in the XY plane on z = 0 facing +Z: a
 * bevelled frame proud of the surface, a dark back, and `count` angled
 * blades. Size w × h, frame proud by `depth`.
 */
export function louvre(o: DetailOptions & { w?: number; h?: number; count?: number; depth?: number; frameToken?: Token } = {}): KitPart[] {
  const w = o.w ?? 0.4, h = o.h ?? 0.3, n = o.count ?? 5, depth = o.depth ?? 0.03;
  const border = Math.min(w, h) * 0.12;
  const rr = border * 0.9;
  const outer: Array<[number, number]> = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const inner: Array<[number, number]> = [[-w / 2 + border, border], [w / 2 - border, border], [w / 2 - border, h - border], [-w / 2 + border, h - border]];
  const frame = extrude(outer, depth, {
    holes: [inner],
    radius: rr,
    holeRadius: rr * 0.5,
    bevel: depth * 0.4,
    bevelBase: 0,
    caps: 'end',
    segs: 3,
    detail: o.detail ?? 'high',
  });
  const iw = w - border * 2, ih = h - border * 2;
  // a dark back, a little behind the frame face
  const back = extrude(inner, depth * 0.3, { radius: rr * 0.5, bevel: 0.002, caps: 'end', support: false, segs: 2 });
  const out: KitPart[] = [
    part(o.material ?? 'steel', frame, o.frameToken ?? o.token ?? 'teal-panel', { seed: o.seed ?? 0, jitter: 0.03 }),
    part('metal', back, 'ink', { shade: 0.9 }),
  ];
  const pitch = ih / n;
  const slatT = Math.min(0.014, pitch * 0.26);
  const slatD = pitch * 1.25;
  const ang = -0.7; // blades lean out and down, like a rain hood
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // slat cross-section in (z, y): a rounded bar of depth slatD and thickness slatT, leaning by `ang`
  const corner = (zz: number, yy: number): [number, number] => [zz * ca - yy * sa, zz * sa + yy * ca];
  const sec = [corner(0, -slatT / 2), corner(slatD, -slatT / 2), corner(slatD, slatT / 2), corner(0, slatT / 2)];
  for (let i = 0; i < n; i++) {
    const y = border + pitch * (i + 0.72);
    const slat = extrude(sec.map(([zz, yy]) => [zz, yy] as [number, number]), iw + border * 0.3, {
      axis: 'z',
      radius: slatT * 0.48,
      bevel: Math.min(0.004, slatT * 0.3),
      bevelBase: 0,
      caps: 'end',
      segs: 1,
      support: false,
    });
    // the outline was drawn in (x=z', y); turn it so the extrusion runs along X and the section lies in ZY
    transform(slat, new Matrix4().makeRotationY(-Math.PI / 2));
    transform(slat, new Matrix4().makeTranslation((iw + border * 0.3) / 2, y, depth * 0.25));
    out.push(part(o.material ?? 'steel', slat, o.token ?? 'teal-panel', { seed: (o.seed ?? 0) + i, jitter: 0.04 }));
  }
  return out;
}

/**
 * A seam / groove strip lying on a surface along `path` (default a straight
 * run of `length` along X): two rounded lips with a dark valley between, a
 * hair proud of the surface, so it reads as a panel join. `up` is the
 * surface normal.
 */
export function seam(o: DetailOptions & { length?: number; width?: number; path?: Path; up?: [number, number, number] } = {}): KitPart[] {
  const w = o.width ?? 0.018;
  const hgt = w * 0.28;
  const path = o.path ?? polylinePath([[-(o.length ?? 0.5) / 2, 0, 0], [(o.length ?? 0.5) / 2, 0, 0]], 0);
  // cross-section in the section plane: u = surface normal (up), v = across
  const pts: Array<[number, number]> = [
    [-hgt * 0.6, -w / 2],
    [hgt * 0.15, -w / 2],
    [hgt, -w * 0.3],
    [hgt * 0.1, -w * 0.08],
    [hgt * 0.1, w * 0.08],
    [hgt, w * 0.3],
    [hgt * 0.15, w / 2],
    [-hgt * 0.6, w / 2],
  ];
  const section = outlineLoop(pts, { radius: [0, w * 0.1, w * 0.12, w * 0.05, w * 0.05, w * 0.12, w * 0.1, 0], segs: 2 });
  const g = sweep(path, { section, up: o.up ?? [0, 1, 0], profile: [{ o: 0, y: 0, no: 1, ny: 0 }, { o: 0, y: pathLen(path), no: 1, ny: 0 }] });
  return [part(o.material ?? 'steel', g, o.token ?? 'teal-panel', { seed: o.seed ?? 0 })];
}

function pathLen(p: Path): number {
  let L = 0;
  for (let i = 1; i < p.points.length; i++) L += p.points[i]!.distanceTo(p.points[i - 1]!);
  return L;
}

/**
 * A hinge along the X axis (pin axis), for a door hanging below/beside it:
 * alternate knuckles on a fixed leaf and a moving leaf, pin caps at both
 * ends. Leaves lie in the XY plane on z = 0 (fixed leaf above the pin,
 * moving leaf below). Returns the two sets separately so the moving one can
 * go in the door's node.
 */
export function hinge(o: DetailOptions & { length?: number; r?: number; knuckles?: number; leaf?: number } = {}): { fixed: KitPart[]; moving: KitPart[] } {
  const L = o.length ?? 0.3;
  const r = o.r ?? 0.022;
  const k = Math.max(3, o.knuckles ?? 3) | 1;
  const leaf = o.leaf ?? r * 3.2;
  const m = o.material ?? 'brass';
  const t = o.token ?? 'brass';
  const gap = 0.003;
  const seg = (L - gap * (k - 1)) / k;
  const fixed: KitPart[] = [];
  const moving: KitPart[] = [];
  const barrel = (len: number): BufferGeometry =>
    lathe(profile(0, 0).to(r, 0, { fillet: r * 0.3, segs: 2 }).to(r, len, { fillet: r * 0.3, segs: 2 }).to(0, len), {
      segs: tri(o.detail, 9, 6),
      support: false,
    });
  for (let i = 0; i < k; i++) {
    const x0 = -L / 2 + i * (seg + gap);
    const g = transform(barrel(seg), new Matrix4().makeTranslation(x0, 0, 0).multiply(new Matrix4().makeRotationZ(-Math.PI / 2)));
    (i % 2 === 0 ? fixed : moving).push(part(m, g, t, { seed: (o.seed ?? 0) + i, jitter: 0.05, warm: 0.03 }));
  }
  const lt = r * 0.55;
  const leafG = (up: boolean): BufferGeometry => {
    const y0 = up ? r * 0.2 : -leaf;
    const y1 = up ? leaf : -r * 0.2;
    return transform(
      extrude([[-L / 2, y0], [L / 2, y0], [L / 2, y1], [-L / 2, y1]], lt, { axis: 'z', bevel: lt * 0.35, bevelBase: 0, radius: [lt, lt, r * 0.6, r * 0.6], segs: 1, caps: 'end', support: false }),
      new Matrix4().makeTranslation(0, 0, -r * 0.45),
    );
  };
  fixed.push(part(m, leafG(true), t, { seed: (o.seed ?? 0) + 11, jitter: 0.04 }));
  moving.push(part(m, leafG(false), t, { seed: (o.seed ?? 0) + 12, jitter: 0.04 }));
  // pin caps
  const cap = lathe(profile(r * 0.6, 0).curve(0, r * 0.5, r * 0.6, r * 0.45, 3), { segs: tri(o.detail, 9, 6), support: false, caps: false });
  fixed.push(...place([part(m, cap, t)], new Matrix4().makeTranslation(L / 2, 0, 0).multiply(new Matrix4().makeRotationZ(-Math.PI / 2))));
  fixed.push(...place([part(m, cap.clone(), t)], new Matrix4().makeTranslation(-L / 2, 0, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2))));
  return { fixed, moving };
}

/** A pull handle standing off a surface (XY plane, z = 0) toward +Z: a swept bar with two turned bosses. */
export function handle(o: DetailOptions & { span?: number; reach?: number; r?: number; bossToken?: Token; bossMaterial?: MaterialClass } = {}): KitPart[] {
  const span = o.span ?? 0.22, reach = o.reach ?? 0.07, r = o.r ?? 0.014;
  const path = polylinePath(
    [
      [-span / 2, 0, r * 0.5],
      [-span / 2, 0, reach],
      [span / 2, 0, reach],
      [span / 2, 0, r * 0.5],
    ],
    reach * 0.55,
    o.detail === 'low' ? 3 : 5,
  );
  const bar = sweep(path, { radius: r, segs: tri(o.detail, 9, 6), ends: 'flat', up: [0, 1, 0] });
  const bossR = r * 1.9;
  const boss = lathe(
    profile(0, 0)
      .to(bossR, 0, { sharp: true })
      .to(bossR, r * 0.5, { fillet: r * 0.35, segs: 2 })
      .to(r * 1.25, r * 1.6, { fillet: r * 0.4, segs: 2 })
      .to(0, r * 1.6),
    { segs: tri(o.detail, 10, 6), support: false, caps: 'end' },
  );
  const bm = o.bossMaterial ?? 'brass';
  const bt = o.bossToken ?? 'brass';
  return [
    part(o.material ?? 'metal', bar, o.token ?? 'steel', { seed: o.seed ?? 0, jitter: 0.04 }),
    ...place([part(bm, boss, bt, { seed: (o.seed ?? 0) + 1, jitter: 0.05 })], aim([-span / 2, 0, 0], [0, 0, 1])),
    ...place([part(bm, boss.clone(), bt, { seed: (o.seed ?? 0) + 2, jitter: 0.05 })], aim([span / 2, 0, 0], [0, 0, 1])),
  ];
}

/**
 * A cable gland along +Y from y = 0: a hex body, a domed brass cap nut and
 * a rubber sleeve that grips a cable of radius `cable`.
 */
export function cableGland(o: DetailOptions & { cable?: number; size?: number } = {}): KitPart[] {
  const c = o.cable ?? 0.025;
  const s = o.size ?? c * 3.6; // across flats of the hex body
  const R = s / Math.sqrt(3);
  const hexH = s * 0.26;
  const hex = extrude(ngon(6, R, 0.2), hexH, { axis: 'y', bevel: hexH * 0.22, bevelBase: 0, radius: R * 0.12, segs: 1, support: false, caps: 'end' });
  // the cap nut: a short neck (a dark gap above the hex), a skirt, a dome down to the cable
  const capR = s * 0.4;
  const y0 = hexH;
  const cap = lathe(
    profile(c * 1.1, y0)
      .to(capR * 0.82, y0, { sharp: true })
      .to(capR * 0.82, y0 + s * 0.04, { sharp: true })
      .to(capR, y0 + s * 0.05, { fillet: s * 0.015, segs: 1 })
      .to(capR, y0 + s * 0.2, { fillet: s * 0.05, segs: 2 })
      .curve(c * 1.45, y0 + s * 0.38, capR * 0.85, y0 + s * 0.37, 3)
      .to(c * 1.1, y0 + s * 0.38),
    { segs: tri(o.detail, 14, 8), support: false, caps: false },
  );
  // the rubber boot: tapering, two moulded ribs, gripping the cable
  const y1 = y0 + s * 0.3;
  const L = s * 0.62;
  const boot = lathe(
    profile(c * 1.0, y1)
      .to(c * 1.42, y1, { sharp: true })
      .to(c * 1.3, y1 + L * 0.45, { smooth: true })
      .groove(c * 0.1, L * 0.1, 0, 0)
      .to(c * 1.08, y1 + L, { fillet: c * 0.08, segs: 1 })
      .to(c * 0.98, y1 + L),
    { segs: tri(o.detail, 12, 8), support: false, caps: false },
  );
  return [
    part(o.material ?? 'brass', hex, o.token ?? 'brass', { seed: o.seed ?? 0, jitter: 0.05 }),
    part(o.material ?? 'brass', cap, o.token ?? 'brass', { seed: (o.seed ?? 0) + 1, jitter: 0.05, warm: 0.03 }),
    part('rubber', boot, 'ink'),
  ];
}

/** A moulded rubber foot standing on y = 0 (its top at h): tapered, with two ribs and a recessed screw cap. */
export function rubberFoot(o: DetailOptions & { d?: number; h?: number } = {}): KitPart[] {
  const r = (o.d ?? 0.12) / 2;
  const h = o.h ?? r * 0.75;
  const g = lathe(
    profile(r * 0.9, 0)
      .to(r, h * 0.3, { fillet: h * 0.1, segs: 1 })
      .groove(r * 0.07, h * 0.12, h * 0.04, h * 0.02)
      .to(r * 0.86, h, { fillet: h * 0.14, segs: 2 })
      .to(0, h),
    { segs: tri(o.detail, 9, 6), support: false, caps: 'end' },
  );
  return [part(o.material ?? 'rubber', g, o.token ?? 'ink', { seed: o.seed ?? 0, jitter: 0.08 })];
}

/**
 * A knurled band along +Y from y = 0: a ring of straight ridges (radius r,
 * height h) with chamfered ends. For knobs and thumbscrews.
 */
export function knurledBand(o: DetailOptions & { r?: number; h?: number; ridges?: number; depth?: number } = {}): KitPart[] {
  return [part(o.material ?? 'brass', knurlGeom(o.r ?? 0.06, o.h ?? 0.05, o.ridges ?? 22, o.depth, o.detail), o.token ?? 'brass', { seed: o.seed ?? 0, jitter: 0.04, warm: 0.03 })];
}

export function knurlGeom(r: number, h: number, ridges: number, depthIn?: number, d?: Detail): BufferGeometry {
  const n = d === 'low' ? Math.max(12, Math.round(ridges / 2)) : ridges;
  const depth = depthIn ?? (Math.PI * 2 * r) / n * 0.32;
  const ch = Math.min(depth * 1.4, h * 0.2);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r - depth;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const loop = outlineLoop(pts, { radius: depth * 0.45, segs: 1 });
  // chamfer at both ends by offsetting the ridged loop inward
  const prof = profile(-ch, 0).to(0, ch, { smooth: true }).to(0, h - ch, { smooth: true }).to(-ch, h);
  const samples = prof.expand({ support: false });
  return loftGeom(loop, samples);
}

function loftGeom(loop: Loop, samples: PSample[]): BufferGeometry {
  return finish(loft({ loops: [loop], profile: samples }));
}

/** A weld bead along a path: a rippled round bead. */
export function weldBead(path: Path, o: DetailOptions & { r?: number; pitch?: number } = {}): KitPart[] {
  const r = o.r ?? 0.009;
  const L = pathLen(path);
  const pitch = o.pitch ?? r * 2.4;
  const R = rng(o.seed ?? 0);
  const phase = R.range(0, 1);
  const g = sweep(path, {
    radius: r,
    segs: o.detail === 'low' ? 6 : 8,
    ends: 'dome',
    step: pitch / 3,
    taper: (t) => 0.82 + 0.18 * Math.abs(Math.sin(((t * L) / pitch + phase) * Math.PI)),
    up: [0, 1, 0],
  });
  return [part(o.material ?? 'metal', g, o.token ?? 'steel', { seed: o.seed ?? 0, shade: 0.8 })];
}

/** A coil spring along +Y from y = 0. */
export function spring(o: DetailOptions & { r?: number; wire?: number; pitch?: number; turns?: number } = {}): KitPart[] {
  const r = o.r ?? 0.04, wire = o.wire ?? 0.008, pitch = o.pitch ?? wire * 3.2, turns = o.turns ?? 6;
  const path = helixPath(r, pitch, turns, o.detail === 'low' ? 9 : 14);
  for (const p of path.points) p.y += wire;
  const g = sweep(path, { radius: wire, segs: o.detail === 'low' ? 5 : 6, ends: 'round' });
  return [part(o.material ?? 'metal', g, o.token ?? 'steel', { seed: o.seed ?? 0 })];
}

/** A bolted flange ring along +Y from y = 0: a turned disc with a raised hub and `bolts` hex bolts round it. */
export function flange(o: DetailOptions & { od?: number; hub?: number; t?: number; bolts?: number; boltToken?: Token } = {}): KitPart[] {
  const R = (o.od ?? 0.24) / 2;
  const hub = o.hub ?? R * 0.55;
  const t = o.t ?? R * 0.18;
  const disc = lathe(
    profile(0, 0)
      .to(R, 0, { sharp: true })
      .to(R, t, { fillet: t * 0.4, segs: 2 })
      .to(hub, t, { fillet: t * 0.3, segs: 1 })
      .to(hub * 0.92, t * 2.1, { fillet: t * 0.3, segs: 2 })
      .to(0, t * 2.1),
    { caps: 'end', segs: tri(o.detail, 18, 10) },
  );
  const out = [part(o.material ?? 'steel', disc, o.token ?? 'teal-panel', { seed: o.seed ?? 0, jitter: 0.03 })];
  const n = o.bolts ?? 6;
  const R2 = rng(o.seed ?? 0);
  const bolt = hexBolt({ af: Math.min(0.055, (R - hub) * 0.75), washer: false, detail: o.detail ?? 'high', token: o.boltToken ?? 'steel', seed: (o.seed ?? 0) + 3 });
  out.push(...ring(bolt, (R + hub) / 2, n, { phase: R2.range(0, 1), frame: T(0, t, 0), spin: () => R2.range(0, 1) }));
  return out;
}

/** A turned collar (a short ring with a chamfered lip), along +Y from y = 0, for things passing through a surface. */
export function collar(o: DetailOptions & { r?: number; inner?: number; h?: number } = {}): KitPart[] {
  const r = o.r ?? 0.06, ri = o.inner ?? r * 0.6, h = o.h ?? r * 0.5;
  const g = lathe(
    profile(ri, 0)
      .to(r, 0, { sharp: true })
      .to(r, h * 0.45, { fillet: h * 0.15, segs: 2 })
      .to(r * 0.86, h * 0.6, { fillet: h * 0.1, segs: 1 })
      .to(r * 0.86, h, { fillet: h * 0.18, segs: 2 })
      .to(ri, h, { fillet: h * 0.1, segs: 1 })
      .to(ri, 0)
      .close(),
    { segs: tri(o.detail, Math.max(10, Math.round(r * 220)), 8), support: false },
  );
  return [part(o.material ?? 'brass', g, o.token ?? 'brass', { seed: o.seed ?? 0, jitter: 0.04, warm: 0.03 })];
}


