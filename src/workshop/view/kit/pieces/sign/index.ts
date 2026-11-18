/**
 * The sign (REWRITE.md § C "sign: TAYLOR REMUND", art-direction § 10 SIGN).
 * Registry name `sign`.
 *
 * A hung marquee board: a walnut frame with brass corner plates round one
 * dark enamel panel per word (the labels module's hand-painted `sign()`
 * texture: paper capitals with an amber drop shade and pinstripe), a row of
 * marquee bulbs in brass cups along the top and bottom rails, two forged
 * chains running up to one hook in the wall. One bulb is dead, one sits
 * crooked in its cup (seeded).
 *
 * Frame: origin on the WALL plane (z = 0) under the middle of the sign, y = 0
 * at the bottom of the frame; the face looks +Z. Place it with its origin on
 * the back wall.
 *
 * Nodes: `bulbs0`..`bulbsN` hold the lit bulbs' glass in groups of about six
 * (top row left to right, then the bottom row), so a view can flicker or
 * chase a group (each group is its own mesh). They do not move.
 * Sockets: `wash` (where the stage's warm wall wash goes: in front of the
 * sign's middle, about 2.6 off the wall), `face` (centre of the lettering).
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { extrude, lathe, roundedBox, torus } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { aim, chain, part, piece, texturedPart, T, mergeGeometries } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, sheet, stud } from '../../cheap.ts';
import { finish, MeshData } from '../../mesh.ts';

/** One painted panel: its texture key (empty when built without labels) and its world size. */
export interface SignPanelRef {
  key: string;
  w: number;
  h: number;
}

/** Height of a painted capital. The labels default is 0.9; at 0.75 TAYLOR is the brief's 5.4-wide board, and both words still fit the back wall later. */
export const SIGN_CAP = 0.75;

/** Dimensions shared with the tests and the stage. */
export const SIGN = {
  /** Rails: the top and bottom rails carry the bulbs, so they are deeper than the stiles. */
  rail: 0.3,
  stile: 0.22,
  /** How far the frame laps over the painted panel's edge. */
  lap: 0.045,
  /** Back of the board off the wall; frame depth; the panel's recess behind the frame's front. */
  standoff: 0.2,
  depth: 0.17,
  recess: 0.06,
  /** Spacing of the bulbs along a rail. */
  bulbPitch: 0.44,
  /** The wash: this far off the wall, in front of the board's middle. */
  washOut: 2.6,
} as const;

export interface SignOptions extends KitOptions {
  /** The words, one painted panel each (default: the first word from content, as the vignette shows). */
  words?: readonly string[];
  /** Painted panels from `signLabels`. Without them the panels are blank enamel of an estimated size. */
  panels?: readonly SignPanelRef[];
  capHeight?: number;
}

/** The painted panels' textures, one per word. */
export function signLabels(labels: Labels, words: readonly string[] = [world.sign], capHeight = SIGN_CAP): SignPanelRef[] {
  return words.map((w) => {
    const key = labels.sign(w, { capHeight });
    return { key, ...labels.size(key) };
  });
}

/** Panel size without the labels (clay, tests): measured against the real sign face, within a few percent. */
export function estimatePanel(word: string, capHeight = SIGN_CAP): { w: number; h: number } {
  const letters = word.replace(/\s/g, '').length;
  const spaces = word.length - word.trim().length + (word.trim().split(/\s+/).length - 1);
  return { w: capHeight * (1.21 + 1.07 * letters + 0.5 * spaces), h: capHeight * 1.761 };
}

const DEG = Math.PI / 180;

/**
 * The sign draws as five meshes (painted steel, its painted panels, walnut, brass, the lit bulbs).
 * The bare steel of the chains and the hook is drawn by the brass class, its colour turned back
 * from brass's lift (x1.5) and yellow pull (g +10%, b -10%) to bare steel's x1.15 (as Fetch does):
 * still a brushed grey metal.
 */
function bareSteel(q: KitPart): KitPart {
  const a = 0.84;
  const c = q.geometry.getAttribute('color');
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * a, c.getY(i) * (a / 1.1), c.getZ(i) * (a / 0.9));
  c.needsUpdate = true;
  return { ...q, material: 'brass' };
}

/** The dead globe, glass no longer: painted steel at full gloss (the wet coat does the reflecting), taken down to glass's dark tint, never chipped. */
function deadGlass(q: KitPart): KitPart {
  const g = q.geometry;
  const c = g.getAttribute('color'), s = g.getAttribute('surf');
  for (let i = 0; i < c.count; i++) {
    c.setXYZ(i, c.getX(i) * 0.44, c.getY(i) * 0.44, c.getZ(i) * 0.44);
    s.setX(i, 0);
    s.setZ(i, 1);
  }
  c.needsUpdate = true;
  s.needsUpdate = true;
  return { ...q, material: 'steel' };
}

/**
 * One chain link: an oval ring in the XY plane, half-axes rx, ry, wire radius r, a three-sided
 * wire, `m` stations round the oval (6 a link facing the wall: 36 triangles; 4 for one seen edge-on,
 * which reads as a bar either way: 24).
 */
function linkGeom(rx: number, ry: number, r: number, m = 6): BufferGeometry {
  const md = new MeshData();
  const k = 3;
  const rings: number[][] = [];
  for (let i = 0; i < m; i++) {
    // stations start at the link's ends (on Y), so the links still meet along the run; the sides,
    // a little flatter at six, are widened to keep the oval's breadth
    const a = (i / m) * Math.PI * 2 + Math.PI / 2;
    const cx = Math.cos(a) * rx * (m === 6 ? 1.08 : 1), cy = Math.sin(a) * ry;
    let nx = Math.cos(a) / rx, ny = Math.sin(a) / ry;
    const l = Math.hypot(nx, ny);
    nx /= l;
    ny /= l;
    const ring: number[] = [];
    for (let j = 0; j < k; j++) {
      const b = (j / k) * Math.PI * 2 + 0.5;
      const ox = Math.cos(b) * nx, oy = Math.cos(b) * ny, oz = Math.sin(b);
      ring.push(md.v(cx + ox * r, cy + oy * r, oz * r, ox, oy, oz));
    }
    rings.push(ring);
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) md.quad(rings[i]![j]!, rings[(i + 1) % m]![j]!, rings[(i + 1) % m]![(j + 1) % k]!, rings[i]![(j + 1) % k]!);
  return finish(md);
}

/** A chain of oval links from `a` to `b`, each link stretched along the run, alternate links turned 90 degrees. */
function chainLinks(a: [number, number, number], b: [number, number, number], seed: number, sag = 0.06): KitPart[] {
  const A = new Vector3(...a), B = new Vector3(...b);
  const L = A.distanceTo(B);
  const pitch = 0.12;
  const n = Math.max(2, Math.round(L / pitch));
  const geoms: BufferGeometry[] = [];
  const at = (t: number): Vector3 => A.clone().lerp(B, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = at(t);
    const d = at(Math.min(1, t + 0.01)).sub(at(Math.max(0, t - 0.01))).normalize();
    // the link is built in XY, stretched along Y; aim turns Y along the run, alternate links a quarter
    // turn about it: those stand edge-on to the room and need only four stations
    const g = linkGeom(0.042, 0.064, 0.013, i % 2 ? 4 : 6);
    transform(g, aim([p.x, p.y, p.z], [d.x, d.y, d.z], i % 2 ? 90 : 0));
    geoms.push(g);
  }
  return [bareSteel(part('metal', mergeGeometries(geoms), 'steel', { seed, shade: 0.85 }))];
}

/** The wall hook it all hangs from: a brass rose screwed to the wall, a forged hook out of it, turned up at the tip. */
function wallHook(reach: number, seed: number): KitPart[] {
  const rose = lathe(profile(0, 0).to(0.085, 0, { sharp: true }).to(0.085, 0.012, { fillet: 0.006, segs: 1 }).to(0.05, 0.03, { fillet: 0.01, segs: 1 }).to(0.03, 0.045).to(0, 0.045), { segs: 12, band: 0, caps: 'end' });
  const hook = sweep(polylinePath([[0, 0, 0.02], [0, 0, reach - 0.02], [0, 0.09, reach + 0.01]], 0.05, 3), { radius: 0.024, segs: 7, ends: 'dome' });
  const out: KitPart[] = [
    part('brass', transform(rose, new Matrix4().makeRotationX(Math.PI / 2)), 'brass', { seed, warm: 0.04 }),
    bareSteel(part('metal', hook, 'steel', { seed: seed + 1, shade: 0.8 })),
  ];
  for (const a of [0, Math.PI]) out.push(part('brass', transform(stud(0.014, 0.008, 6), aim([Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0.014], [0, 0, 1])), 'brass', { seed: seed + 2 }));
  return out;
}

export function sign(o: SignOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const cap = o.capHeight ?? SIGN_CAP;
  const words = o.words ?? [world.sign];
  const panels: SignPanelRef[] = o.panels ? [...o.panels] : words.map((w) => ({ key: '', ...estimatePanel(w, cap) }));
  const b = piece('sign', { detail, seed });

  const { rail, stile, lap, standoff, depth, recess } = SIGN;
  const mull = 0.16; // the post between two words
  const ph = Math.max(...panels.map((p) => p.h));
  const inner = panels.reduce((s, p) => s + p.w, 0) + mull * (panels.length - 1) - 2 * lap * (panels.length - 1);
  const W = inner + 2 * stile - 2 * lap;
  const H = ph + 2 * rail - 2 * lap;
  const z0 = standoff, z1 = standoff + depth;
  const zFace = z1 - recess;

  // ---- the board: a crooked hang (a degree off level), everything below is built in its frame ----
  const roll = R.spread(0.7) * DEG;
  const hang = chain(T(0, 0, 0), new Matrix4().makeRotationZ(roll));
  const at = (m: Matrix4): Matrix4 => chain(hang, m);

  // backing panel (dark enamel), behind the paint
  b.add(part('steel', transform(bevelBox({ min: [-W / 2 + stile * 0.5, rail * 0.5, z0], max: [W / 2 - stile * 0.5, H - rail * 0.5, zFace - 0.004], c: 0.01, omit: ['nz'] }), hang), 'teal-panel', { seed: seed + 1, shade: 0.45 }));

  // painted panels
  let x = -inner / 2;
  panels.forEach((p, i) => {
    const cx = x + p.w / 2;
    const face = transform(sheet({ w: p.w, h: p.h, t: 0.003, nx: 1, ny: 1 }), at(T(cx, H / 2, zFace)));
    if (p.key) b.add(texturedPart('steel', face, p.key));
    else b.add(part('steel', face, 'ink', { shade: 1.4 }));
    x += p.w - 2 * lap + mull;
    if (i < panels.length - 1) {
      const mx = x - mull / 2 + lap;
      b.add(part('wood', grain(transform(roundedBox({ w: mull, h: H - 2 * rail + 2 * lap, d: depth - 0.01, r: 0.025, rPlan: 0.025, segs: 2, detail, band: 0 }), at(T(mx, rail - lap, z0))), 'y'), 'wood', { seed: seed + 30 + i, jitter: 0.06 }));
    }
  });

  // ---- the frame: rails run the full width, stiles butt in between them ----
  const railG = (y0: number, s: number): BufferGeometry => {
    // no wear band: the walnut's worn edges are on the fillets, which is where the lamp finds them
    const g = roundedBox({ w: W, h: rail, d: depth, r: 0.035, rPlan: 0.03, segs: hi ? 3 : 2, detail, band: 0 });
    return transform(g, at(T(0, y0, z0)));
  };
  b.add(part('wood', railG(0, 0), 'wood', { seed: seed + 3, jitter: 0.06, warm: 0.03 }));
  b.add(part('wood', railG(H - rail, 1), 'wood', { seed: seed + 4, jitter: 0.06, warm: 0.03 }));
  for (const sx of [-1, 1]) {
    const g = roundedBox({ w: stile, h: H - 2 * rail + 0.01, d: depth - 0.012, r: 0.03, rPlan: 0.03, segs: hi ? 3 : 2, detail, band: 0 });
    b.add(part('wood', grain(transform(g, at(T(sx * (W / 2 - stile / 2), rail - 0.005, z0 + 0.004))), 'y'), 'wood', { seed: seed + 5 + sx, jitter: 0.07 }));
  }
  // a thin inner bead round the panels, so the frame steps down to the paint
  {
    const t = 0.03, d = 0.03;
    const ix = inner / 2, iy0 = rail - lap, iy1 = H - rail + lap;
    const bead = [
      bevelBox({ min: [-ix, iy0 - t, zFace], max: [ix, iy0, zFace + d], c: 0.01, omit: ['nz'] }),
      bevelBox({ min: [-ix, iy1, zFace], max: [ix, iy1 + t, zFace + d], c: 0.01, omit: ['nz'] }),
      bevelBox({ min: [-ix - t, iy0 - t, zFace], max: [-ix, iy1 + t, zFace + d], c: 0.01, omit: ['nz'] }),
      bevelBox({ min: [ix, iy0 - t, zFace], max: [ix + t, iy1 + t, zFace + d], c: 0.01, omit: ['nz'] }),
    ];
    b.add(part('wood', transform(mergeGeometries(bead), hang), 'wood', { seed: seed + 8, shade: 0.7 }));
  }

  // brass corner plates, three screws each
  for (const sx of [-1, 1])
    for (const sy of [0, 1]) {
      const L = 0.3, w = 0.085;
      const outline: Array<[number, number]> = [[0, 0], [L, 0], [L, w], [w, w], [w, L], [0, L]];
      const g = extrude(outline, 0.014, { bevel: 0.005, bevelBase: 0, caps: 'end', radius: 0.012, segs: 1, detail, band: 0 });
      // outline drawn in +x +y from the corner; mirror into each corner
      const m = at(chain(T(sx * (W / 2 - 0.035), sy ? H - 0.035 : 0.035, z1), new Matrix4().makeScale(-sx, sy ? -1 : 1, 1)));
      const gg = transform(g, m);
      b.add(setFinish(part('brass', gg, 'brass', { seed: seed + 10 + sx + sy * 3, warm: 0.04 }), 0.15));
      for (const [px, py] of [[0.045, 0.045], [0.24, 0.042], [0.042, 0.24]] as const) {
        const s = new Matrix4().makeScale(-sx, sy ? -1 : 1, 1);
        const p = new Matrix4().makeTranslation(px, py, 0).premultiply(s);
        const e = p.elements;
        b.small(() => part('brass', transform(stud(0.017, 0.01, 6), at(aim([sx * (W / 2 - 0.035) + e[12]!, (sy ? H - 0.035 : 0.035) + e[13]!, z1 + 0.012], [0, 0, 1]))), 'brass', { seed: seed + 12 }));
      }
    }

  // ---- the bulbs: brass cups on the rails' faces, glass globes ----
  const n = Math.max(4, Math.round((W - 0.5) / SIGN.bulbPitch) + 1);
  const span = W - 0.56;
  // the cup's flange is one bevelled ring, not a step: its side wall stood edge-on to every view
  const cupProfile = profile(0.068, 0.004).to(0.05, 0.028, { sharp: true }).to(0.055, 0.06, { sharp: true }).to(0.036, 0.066, { sharp: true });
  // six sides to a cup and seven to a globe: a bulb is a glow ten pixels across at the bench view and
  // the eye reads its brightness, not its polygon. The globe starts at its neck: its base sits in the
  // cup, where nothing sees it.
  const cupG = lathe(cupProfile, { segs: 6, detail, band: 0, caps: false });
  const globeProfile = profile(0.034, 0.058).to(0.036, 0.078, { smooth: true }).cubic(0, 0.205, 0.082, 0.09, 0.08, 0.205, 3);
  const globeG = lathe(globeProfile, { segs: hi ? 7 : 6, detail, band: 0, caps: false });
  const all: Array<{ row: number; i: number; m: Matrix4 }> = [];
  for (const row of [1, 0]) {
    const yc = row ? H - rail / 2 : rail / 2;
    for (let i = 0; i < n; i++) {
      const bx = -span / 2 + (span * i) / (n - 1);
      all.push({ row, i, m: at(aim([bx, yc, z1], [R.spread(0.04), R.spread(0.04), 1], R.range(0, 360))) });
    }
  }
  const dead = R.int(0, all.length - 1);
  let crooked = R.int(0, all.length - 1);
  if (crooked === dead) crooked = (crooked + 3) % all.length;
  const groups: BufferGeometry[][] = [];
  const perGroup = Math.ceil(n / Math.ceil(n / 6));
  all.forEach((bulb, k) => {
    b.add(part('brass', transform(cupG.clone(), bulb.m), 'brass', { seed: seed + 40 + k, jitter: 0.05, warm: 0.03 }));
    let m = bulb.m;
    if (k === crooked) m = chain(m, T(0, 0.06, 0), new Matrix4().makeRotationX(22 * DEG), new Matrix4().makeRotationZ(9 * DEG), T(0, -0.06, 0));
    const g = transform(globeG.clone(), m);
    if (k === dead) {
      // a dead globe: clear glass with nothing behind it
      b.add(deadGlass(part('glass', g, 'amber-glow', { seed: seed + 41 })));
      return;
    }
    const gi = bulb.row === 1 ? Math.floor(bulb.i / perGroup) : Math.ceil(n / perGroup) + Math.floor(bulb.i / perGroup);
    (groups[gi] ??= []).push(g);
  });
  groups.forEach((gs, i) => {
    if (!gs.length) return;
    b.node(`bulbs${i}`).add(part('bulb', mergeGeometries(gs), 'amber-glow'));
  });

  // ---- hanging: two eye bolts on the top rail, a chain from each up to one hook in the wall ----
  const zc = z0 + depth / 2;
  const hookY = H + Math.min(1.0, W * 0.13);
  b.add(wallHook(zc + 0.03, seed + 60).map((q) => ({ ...q, geometry: transform(q.geometry, T(0, hookY, 0)) })));
  [-(W / 2 - 0.9), W / 2 - 0.9].forEach((bx, i) => {
    const eye = lathe(profile(0, 0).to(0.035, 0, { sharp: true }).to(0.03, 0.02, { fillet: 0.006, segs: 1 }).to(0.012, 0.03).to(0.012, 0.05).to(0, 0.05), { segs: 8, detail, band: 0, caps: 'end' });
    const top = at(T(bx, H, zc));
    b.add(part('brass', transform(eye, top), 'brass', { seed: seed + 62 + i }));
    b.add(part('brass', transform(torus({ R: 0.03, r: 0.01, segs: 8, tubeSegs: 4 }), chain(top, T(0, 0.08, 0), new Matrix4().makeRotationX(Math.PI / 2), T(0, -0.01, 0))), 'brass', { seed: seed + 64 + i }));
    const e = top.elements;
    b.add(chainLinks([e[12]!, e[13]! + 0.12, zc], [Math.sign(bx) * 0.02, hookY + 0.06, zc + 0.03], seed + 66 + i));
  });

  b.socket('wash', T(0, H * 0.55, SIGN.washOut));
  b.socket('face', at(T(0, H / 2, zFace)));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'sign',
    build: (opts = {}) =>
      sign({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(Array.isArray(opts['words']) ? { words: opts['words'] as string[] } : {}),
        ...(Array.isArray(opts['panels']) ? { panels: opts['panels'] as SignPanelRef[] } : {}),
      }),
    labels: (labels, opts) => ({ panels: signLabels(labels, Array.isArray(opts['words']) ? (opts['words'] as string[]) : [world.sign]) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 9 },
    note: 'The hung sign: painted panel per word in a walnut frame, marquee bulbs top and bottom, chains up to a wall hook.',
  },
];
