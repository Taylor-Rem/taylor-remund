/**
 * The storefront's geometry. See index.ts for what it is and dims.ts for the
 * layout. Built in areas: the building (plinth, walls, roof, chimney), the
 * shop front (pilasters, consoles, cornice, stallriser, window, door, step),
 * the fascia's slats, the awning, the window's inside (lit and unlit), the
 * OPEN sign, the picture, the lantern, and the jack box.
 */
import { Matrix4 } from 'three';
import type { BufferGeometry } from 'three';
import type { KitPart, Piece, Token } from '../../types.ts';
import { linear } from '../../../palette.ts';
import { extrude, lathe, roundedBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { aim, chain, mat, mergeGeometries, part, piece, place, texturedPart, T, type NodeBuilder } from '../../compose.ts';
import { rng, type Rng } from '../../rng.ts';
import { deform, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, hexHead, innerBox, ridgedBand, sheet, stud } from '../../cheap.ts';
import { AWNING, DEFAULTS, DOOR, F, FASCIA, JACKBOX, NODES, OPEN_SIGN, PICTURE, SHOP, SLAT_H, WINDOW, WORDS, slatY, slatZ } from './dims.ts';
import { canvasStrip, grid, valancePanel } from './geo.ts';
import { triangleCount } from '../../mesh.ts';
import { ATLAS, slatUv } from './atlas.ts';
import { awningGeometry, nodeMatrices } from './pose.ts';

const BIND = nodeMatrices({}, true);
/** A moving node's transform as built (the bind pose: see pose.ts). */
const bind = (name: string): Matrix4 => {
  const m = BIND.get(name);
  if (!m) throw new Error(`storefront: no bind transform for node ${name}`);
  return m.clone();
};

const DEG = Math.PI / 180;

export interface StorefrontBuild {
  seed: number;
  detail: 'high' | 'low';
  fascia: Token;
  awning: Token;
  /** Texture keys (empty: built blank, for clay and tests). */
  words: string;
  pictures: string;
  plate: { key: string; w: number; h: number } | null;
}

/** The woodwork's colours. */
const CREAM: Token = 'paper';
const PANEL: Token = 'teal-panel';

type V3 = [number, number, number];
const box = (min: V3, max: V3, c = 0.012, omit?: Array<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'>, band = 0): BufferGeometry =>
  // a wear band only on the big faces (it costs 8 triangles a face)
  bevelBox({ min, max, c, ...(omit ? { omit } : {}), band: band >= 0.012 ? band : 0 });

/** Painted wood (cream woodwork, panels, the fascia): wood class, paint coverage 1. */
function painted(g: BufferGeometry, token: Token, seed: number, along: 'x' | 'y' | 'z' = 'x', shade = 1): KitPart {
  return setFinish(part('wood', grain(g, along), token, { seed, jitter: 0.035, warm: 0.02, shade }), 1);
}
/** Bare wood. */
function bare(g: BufferGeometry, token: Token, seed: number, along: 'x' | 'y' | 'z' = 'x', shade = 1): KitPart {
  return part('wood', grain(g, along), token, { seed, jitter: 0.07, warm: 0.03, shade });
}
/** Stone (plinth, step, chimney cap): matte, the paper class in a grey. */
function stone(g: BufferGeometry, seed: number, shade = 0.62): KitPart {
  return part('paper', g, 'steel', { seed, jitter: 0.05, shade });
}
function brass(g: BufferGeometry, seed: number, polish = 0): KitPart {
  const p = part('brass', g, 'brass', { seed, jitter: 0.04, warm: 0.04 });
  return polish ? setFinish(p, polish) : p;
}

/** A small dent that keeps the solid's own wear and cavity. */
function knock(g: BufferGeometry, at: V3, dir: V3, r: number, d: number): void {
  const l = Math.hypot(...dir) || 1;
  deform(g, (x, y, z) => {
    const q = Math.hypot(x - at[0], y - at[1], z - at[2]) / r;
    if (q >= 1) return [x, y, z];
    const w = (1 - q * q) ** 2 * d;
    return [x - (dir[0] / l) * w, y - (dir[1] / l) * w, z - (dir[2] / l) * w];
  }, { keepSurf: true });
}

/** Triangles per area of the last build (for the budget: where to cut). */
export const AREA_TRIANGLES: Record<string, number> = {};

export function buildStorefront(o: StorefrontBuild): Piece {
  const { seed, detail } = o;
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('storefront', { detail, seed });

  const areas: Array<[string, () => void]> = [
    ['building', () => building(b, R, seed, hi)],
    ['shopFront', () => shopFront(b, R, seed, hi)],
    ['door', () => door(b, R, seed, hi)],
    ['fascia', () => fascia(b, o, R, seed)],
    ['awning', () => awning(b, o, R, seed, hi)],
    ['windowInside', () => windowInside(b, o, R, seed, hi)],
    ['lantern', () => lantern(b, R, seed, hi)],
    ['jackBox', () => jackBox(b, o, R, seed, hi)],
  ];
  const count = (n: NodeBuilder): number => n.parts.reduce((s, q) => s + triangleCount(q.geometry), 0) + n.children.reduce((s, c) => s + count(c), 0);
  for (const [name, f] of areas) {
    const before = count(b);
    f();
    AREA_TRIANGLES[name] = count(b) - before;
  }

  b.socket('words', T(0, (FASCIA.y0 + FASCIA.y1) / 2, FASCIA.z + FASCIA.t / 2));
  b.socket('window', T((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + 0.9) / 2, F));
  b.socket('jack', T(JACKBOX.x + 0.07, JACKBOX.h * 0.42, JACKBOX.z + JACKBOX.d / 2 + 0.03));
  b.socket('lamp', T(JACKBOX.x - 0.1, JACKBOX.h * 0.72, JACKBOX.z + JACKBOX.d / 2 + 0.03));
  return b.build();
}

// ---- the building: plinth, walls, roof, chimney ---------------------------------------

function building(b: NodeBuilder, R: Rng, seed: number, hi: boolean): void {
  const { back, plinth } = SHOP;
  const hw = SHOP.pilOut;
  // plinth: a dark stone course, a little proud of everything above it
  {
    const g = box([-hw - 0.02, 0, back - 0.02], [hw + 0.02, plinth, F + SHOP.pilProud + 0.03], 0.014, ['ny'], 0.02);
    knock(g, [hw * 0.55 + R.spread(0.2), plinth, F + 0.1], [0, 0.4, 1], 0.08, 0.008);
    b.add(stone(g, seed + 1, 0.5));
  }
  // the walls: clapboard on the sides (the left one shows from the bench's middle), a plain back
  const wallTop = 2.05;
  const wx = 1.12;
  // a shell, open at the front (the shop front closes it): two side walls, a back wall, and inside, a dark lining
  b.add(painted(mergeGeometries([
    box([-wx, plinth, back], [-wx + 0.05, wallTop, F - 0.02], 0.01, ['ny']),
    box([wx - 0.05, plinth, back], [wx, wallTop, F - 0.02], 0.01, ['ny']),
    box([-wx + 0.05, plinth, back], [wx - 0.05, wallTop, back + 0.05], 0.01, ['ny']),
  ]), 'teal-light', seed + 2, 'y', 0.62));
  b.add(part('wood', innerBox([-wx + 0.05, plinth, back + 0.05], [wx - 0.05, wallTop, F - 0.02]), 'teal-deep', { seed: seed + 12, shade: 0.6 }));
  {
    const n = hi ? 11 : 7;
    const pitch = (wallTop - plinth) / n;
    const boards: BufferGeometry[] = [];
    for (const sx of [-1]) {
      for (let i = 0; i < n; i++) {
        const y0 = plinth + i * pitch;
        // each board laps over the one below and stands out at its foot
        const g = box([-0.02, 0, back + 0.01], [0.004, pitch + 0.012, F - 0.03], 0, ['px', 'ny', 'nz']);
        transform(g, chain(T(sx * wx, y0, 0), new Matrix4().makeRotationZ(sx * -0.09), new Matrix4().makeScale(sx, 1, 1)));
        boards.push(g);
      }
    }
    b.add(painted(mergeGeometries(boards), 'teal-light', seed + 3, 'z', 0.75));
  }
  // the roof: slates on a pitch rising behind the cornice to a tiled ridge; gable ends in the side walls' clapboard
  const eaveY = 2.1, eaveZ = F - 0.02, ridgeZ = -0.12, ridgeY = 2.34;
  const roofY = eaveY;
  {
    const slope = Math.atan2(ridgeY - eaveY, eaveZ - ridgeZ);
    const run = Math.hypot(ridgeY - eaveY, eaveZ - ridgeZ);
    // the roof's frame: x across, y up the pitch, z out of the slates
    const onPitch = (y: number, z: number): Matrix4 => chain(T(0, y, z), new Matrix4().makeRotationX(slope - Math.PI / 2));
    // front pitch: courses of slates, each lapping the one above it, cut into slates with joints staggered course to course
    const courses = hi ? 6 : 4;
    const pitch = run / courses;
    const slates: BufferGeometry[] = [];
    const dark: BufferGeometry[] = [];
    const along = (t: number): [number, number] => [eaveY + (ridgeY - eaveY) * t, eaveZ + (ridgeZ - eaveZ) * t];
    for (let c = 0; c < courses; c++) {
      const [y, z] = along(c / courses);
      const n = 7 + (c % 2);
      const sw = (wx * 2 + 0.08) / n;
      for (let k = 0; k < n; k++) {
        const x0 = -wx - 0.04 + (k - (c % 2) * 0.5) * sw;
        const xa = Math.max(-wx - 0.04, x0 + 0.004), xb = Math.min(wx + 0.04, x0 + sw - 0.004);
        if (xb - xa < 0.02) continue;
        const tilt = R.spread(0.02);
        const g = box([xa, 0, -0.012], [xb, pitch + 0.035, 0.012], 0, ['nz']);
        // lie it on the pitch, its foot a little proud of the course below
        transform(g, chain(onPitch(y, z), T(0, 0, 0.014 + c * 0.0), new Matrix4().makeRotationZ(tilt)));
        (R() < 0.12 ? dark : slates).push(g);
      }
    }
    b.add(part('paper', mergeGeometries(slates), 'teal-panel', { seed: seed + 4, shade: 0.95, jitter: 0.04 }));
    if (dark.length) b.add(part('paper', mergeGeometries(dark), 'teal-panel', { seed: seed + 5, shade: 0.72 }));
    // under the slates, so the joints read dark
    const under = box([-wx - 0.03, -0.025, -0.01], [wx + 0.03, run, 0.0], 0.0, ['ny', 'nz', 'px', 'nx']);
    transform(under, onPitch(eaveY, eaveZ));
    b.add(part('paper', under, 'teal-deep', { seed: seed + 13, shade: 0.8 }));
    // the back pitch, plain (seen only at its ridge), and the gable ends
    const backRun = Math.hypot(ridgeY - eaveY, ridgeZ - back);
    const bslope = Math.atan2(ridgeY - eaveY, ridgeZ - back);
    const bk = box([-wx - 0.04, 0, -0.012], [wx + 0.04, backRun, 0.012], 0.006, ['ny']);
    transform(bk, chain(T(0, eaveY, back), new Matrix4().makeRotationX(Math.PI / 2 - bslope)));
    b.add(part('paper', bk, 'teal-panel', { seed: seed + 14, shade: 0.8 }));
    const gable: Array<[number, number]> = [[-eaveZ, eaveY - 0.06], [-back, eaveY - 0.06], [-back, eaveY], [-ridgeZ, ridgeY - 0.02], [-eaveZ, eaveY]];
    for (const sx of [-1, 1]) {
      const g = extrude(gable, 0.05, { radius: 0, bevel: 0.006, segs: 1, band: 0, support: false, caps: 'end' });
      transform(g, chain(T(sx < 0 ? -wx : wx - 0.05, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
      b.add(painted(g, 'teal-light', seed + 15 + sx, 'z', 0.62));
    }
    // the ridge: a row of rounded clay tiles
    const ridge = lathe(profile(0, 0).to(0.04, 0, { sharp: true }).to(0.042, 0.02, { smooth: true }).to(0.042, wx * 2 + 0.1, { smooth: true }).to(0, wx * 2 + 0.12), { segs: hi ? 8 : 6, band: 0 });
    b.add(part('paper', transform(ridge, chain(T(-wx - 0.06, ridgeY + 0.005, ridgeZ), new Matrix4().makeRotationZ(-Math.PI / 2))), 'paint-orange', { seed: seed + 16, shade: 0.62 }));
  }
  // the chimney stack: on the ridge, brick courses (each its own box, offset), a stone cap, two pots
  {
    const cx = -0.6 + R.spread(0.04), cz = ridgeZ;
    const base = eaveY + 0.1;
    const w = 0.34, d = 0.24, h = 0.4, courses = hi ? 5 : 3;
    const ch = h / courses;
    const bricks: BufferGeometry[] = [];
    for (let i = 0; i < courses; i++) {
      const y0 = base + i * ch;
      const ins = i % 2 ? 0.004 : 0;
      const g = box([cx - w / 2 + ins, y0, cz - d / 2 + ins], [cx + w / 2 - ins, y0 + ch - 0.006, cz + d / 2 - ins], 0.008, ['ny']);
      bricks.push(g);
    }
    b.add(part('paper', mergeGeometries(bricks), 'cable-red', { seed: seed + 6, shade: 0.8, jitter: 0.05, warm: 0.05 }));
    // mortar behind, so the course lines read dark
    b.add(part('paper', box([cx - w / 2 + 0.008, base, cz - d / 2 + 0.008], [cx + w / 2 - 0.008, base + h, cz + d / 2 - 0.008], 0.004, ['ny']), 'steel', { seed: seed + 7, shade: 0.45 }));
    // lead flashing where it meets the slates
    b.add(part('metal', box([cx - w / 2 - 0.02, base - 0.06, cz - d / 2 - 0.02], [cx + w / 2 + 0.02, base + 0.03, cz + d / 2 + 0.02], 0.01, ['ny']), 'steel', { seed: seed + 17, shade: 0.55 }));
    const capG = box([cx - w / 2 - 0.03, base + h, cz - d / 2 - 0.03], [cx + w / 2 + 0.03, base + h + 0.045, cz + d / 2 + 0.03], 0.012);
    b.add(stone(capG, seed + 8, 0.7));
    const pot = lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.055, 0.02, { fillet: 0.006, segs: 1 }).to(0.042, 0.03, { sharp: true }).to(0.038, 0.13, { smooth: true }).to(0.048, 0.15, { sharp: true }).to(0.044, 0.165, { sharp: true }).to(0.03, 0.16), { segs: 7, band: 0, caps: 'start' });
    [-0.075, 0.08].forEach((dx, i) => {
      const hh = i ? 1.12 : 1;
      b.add(part('paper', transform(pot.clone(), chain(T(cx + dx, base + h + 0.045, cz + R.spread(0.02)), new Matrix4().makeScale(1, hh, 1), new Matrix4().makeRotationZ(R.spread(0.04)))), 'paint-orange', { seed: seed + 9 + i, shade: 0.8, jitter: 0.08 }));
    });
  }
  // a vent pipe with a cowl, through the slates toward the right
  {
    const vx = 0.62, t = 0.55;
    const vy = eaveY + (ridgeY - eaveY) * t, vz = eaveZ + (ridgeZ - eaveZ) * t;
    const pipe = lathe(profile(0, -0.1).to(0.05, -0.1, { sharp: true }).to(0.05, -0.02, { fillet: 0.005, segs: 1 }).to(0.026, -0.01).to(0.026, 0.22).to(0.05, 0.23, { sharp: true }).cubic(0, 0.32, 0.06, 0.26, 0.03, 0.32, 3), { segs: 7, band: 0, caps: false });
    b.add(part('metal', transform(pipe, T(vx, vy, vz)), 'steel', { seed: seed + 11, shade: 0.8 }));
  }
  void roofY;
}

// ---- the shop front: pilasters, consoles, cornice, stallriser, window frame ------------

function shopFront(b: NodeBuilder, R: Rng, seed: number, hi: boolean): void {
  const { plinth, pilIn, pilOut, pilProud, pilTop } = SHOP;
  // pilasters: a shaft with a sunk panel, a base block, a capital
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -pilOut : pilIn, x1 = sx < 0 ? -pilIn : pilOut;
    const shaft = box([x0, plinth, F - 0.02], [x1, pilTop, F + pilProud], 0.014, ['ny', 'nz'], 0.012);
    knock(shaft, [sx * (pilOut - 0.02), 0.4 + R.range(0, 0.4), F + pilProud], [sx, 0, 1], 0.05, 0.006);
    b.add(painted(shaft, CREAM, seed + 20 + sx, 'y'));
    // the sunk panel: a darker field in a thin bead, set into the shaft's face
    const px0 = x0 + 0.04, px1 = x1 - 0.04;
    b.add(painted(box([px0, 0.3, F + pilProud - 0.004], [px1, pilTop - 0.17, F + pilProud + 0.006], 0.006, ['nz']), PANEL, seed + 22 + sx, 'y', 0.9));
    const base = box([x0 - 0.012, plinth, F - 0.02], [x1 + 0.012, 0.22, F + pilProud + 0.016], 0.012, ['ny', 'nz'], 0.01);
    b.add(painted(base, CREAM, seed + 24 + sx, 'x', 0.95));
    const capital = mergeGeometries([
      box([x0 - 0.014, pilTop - 0.075, F - 0.02], [x1 + 0.014, pilTop - 0.04, F + pilProud + 0.02], 0.01, ['nz']),
      box([x0 - 0.024, pilTop - 0.04, F - 0.02], [x1 + 0.024, pilTop, F + pilProud + 0.032], 0.012, ['nz']),
    ]);
    b.add(painted(capital, CREAM, seed + 26 + sx, 'x', 0.97));
  }
  // consoles: a scrolled corbel above each pilaster, carrying the slats' pins and the cornice
  {
    const yb = pilTop, yt = FASCIA.y1 + 0.005;
    const h = yt - yb;
    const outline: Array<[number, number]> = [];
    // side profile in (-z, y): the back runs up the wall; the front swells out toward the top
    const zBack = F - 0.02, zTop = F + 0.17, zFoot = F + pilProud + 0.01;
    outline.push([-zBack, yb]);
    const n = hi ? 4 : 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // an ogee: tucked in low, a belly, flaring to the top
      const z = zFoot + (zTop - zFoot) * (0.5 - 0.5 * Math.cos(Math.PI * t)) + 0.018 * Math.sin(Math.PI * 2 * t);
      outline.push([-z, yb + 0.02 + (h - 0.05) * t]);
    }
    outline.push([-zTop, yt]);
    outline.push([-zBack, yt]);
    const g0 = extrude(outline, pilOut - pilIn - 0.02, { radius: 0, bevel: 0.01, segs: 1, detail: hi ? 'high' : 'low', band: 0, support: false });
    for (const sx of [-1, 1]) {
      const g = transform(g0.clone(), chain(T(sx < 0 ? -pilOut + 0.01 : pilIn + 0.01, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
      b.add(painted(g, CREAM, seed + 30 + sx, 'y', 0.98));
      // a carved leaf panel on its face: a sunk teal oval
      const cx = sx * (pilIn + pilOut) / 2;
      const leaf = lathe(profile(0, 0).to(0.045, 0, { sharp: true }).to(0.045, 0.012, { fillet: 0.006, segs: 1 }).to(0, 0.016), { segs: hi ? 10 : 6, band: 0, caps: 'end' });
      b.add(painted(transform(leaf, chain(T(cx, yb + h * 0.55, F + 0.14), new Matrix4().makeRotationX(Math.PI / 2 - 0.5), new Matrix4().makeScale(0.9, 1, 1.6))), PANEL, seed + 33 + sx, 'x'));
      // the slats' pins: a brass boss on the console's inner face for each slat
      for (let i = 0; i < FASCIA.slats; i++) {
        const boss = stud(0.022, 0.013, 6);
        b.small(() => brass(transform(boss, aim([sx * (pilIn + 0.002), slatY(i), slatZ(i)], [-sx, 0, 0])), seed + 40 + i, 0.3));
      }
    }
  }
  // behind the slats: a dark recess, so the gaps and a turning slat show depth
  b.add(part('wood', box([-pilIn - 0.01, FASCIA.y0 - 0.04, F - 0.03], [pilIn + 0.01, FASCIA.y1 + 0.01, F + 0.01], 0.006, ['nz']), 'teal-deep', { seed: seed + 45, shade: 0.9 }));
  // a moulded ledge under the slats, and the cornice over everything
  {
    const ledge = extrude([[-(F - 0.02), FASCIA.y0 - 0.045], [-(F + 0.15), FASCIA.y0 - 0.045], [-(F + 0.17), FASCIA.y0 - 0.02], [-(F + 0.15), FASCIA.y0 - 0.008], [-(F - 0.02), FASCIA.y0 - 0.008]], pilIn * 2, { radius: 0.006, bevel: 0.008, segs: 2, band: 0 });
    b.add(painted(transform(ledge, chain(T(-pilIn, 0, 0), new Matrix4().makeRotationY(Math.PI / 2))), CREAM, seed + 46, 'x', 0.96));
  }
  {
    const y0 = FASCIA.y1 + 0.005;
    const cw = pilOut + 0.05;
    // the cornice's section in (-z, y): a fillet, a cove, a projecting drip, a top that slopes back
    const pts: Array<[number, number]> = [[-(F - 0.03), y0], [-(F + 0.17), y0], [-(F + 0.175), y0 + 0.02]];
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 0.5;
      pts.push([-(F + 0.175 + 0.045 * Math.sin(a)), y0 + 0.02 + 0.045 * (1 - Math.cos(a))]);
    }
    pts.push([-(F + 0.225), y0 + 0.07], [-(F + 0.227), y0 + 0.1], [-(F + 0.205), y0 + 0.112], [-(F - 0.03), y0 + 0.125]);
    const g = extrude(pts, cw * 2, { radius: 0, bevel: 0.01, segs: 1, band: 0, support: false });
    transform(g, chain(T(-cw, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
    knock(g, [0.4 + R.spread(0.3), y0 + 0.1, F + 0.225], [0, 0.3, 1], 0.07, 0.008);
    b.add(painted(g, CREAM, seed + 47, 'x', 0.98));
    // returns: the cornice turns back along the sides
    for (const sx of [-1, 1]) {
      const rg = box([sx < 0 ? -cw : cw - 0.06, y0, -0.44], [sx < 0 ? -cw + 0.06 : cw, y0 + 0.11, F - 0.03], 0.012, ['ny']);
      b.add(painted(rg, CREAM, seed + 48 + sx, 'z', 0.94));
    }
    // dentils under the drip: a row of small blocks (they make the cornice read as a cornice at a distance)
    if (hi) {
      const dn: BufferGeometry[] = [];
      const count = 20;
      for (let i = 0; i < count; i++) {
        const x = -cw + 0.07 + ((cw * 2 - 0.14) * i) / (count - 1);
        dn.push(box([x - 0.024, y0 + 0.025, F + 0.13], [x + 0.024, y0 + 0.06, F + 0.2], 0, ['nz', 'pz']));
      }
      b.add(painted(mergeGeometries(dn), CREAM, seed + 50, 'x', 0.9));
    }
  }
  // the stallriser under the window: two raised panels in a frame, a sill over it
  {
    const x0 = WINDOW.x0 - 0.05, x1 = SHOP.pilIn;
    const y0 = SHOP.plinth, y1 = WINDOW.y0 - 0.03;
    b.add(painted(box([x0, y0, F - 0.04], [x1, y1, F], 0.01, ['ny', 'nz']), CREAM, seed + 51, 'x', 0.96));
    const pw = (x1 - x0 - 0.15) / 2;
    for (let i = 0; i < 2; i++) {
      const px = x0 + 0.05 + i * (pw + 0.05);
      const pg = box([px, y0 + 0.05, F], [px + pw, y1 - 0.04, F + 0.018], 0.012, ['nz'], 0.008);
      b.add(painted(pg, PANEL, seed + 52 + i, 'x', 1));
    }
    const sill = box([x0 - 0.02, y1, F - 0.06], [x1, WINDOW.y0 + 0.012, F + 0.06], 0.012, ['nz'], 0.01);
    knock(sill, [x0 + 0.3 + R.spread(0.2), WINDOW.y0 + 0.012, F + 0.06], [0, 1, 1], 0.05, 0.006);
    b.add(painted(sill, CREAM, seed + 54, 'x', 1));
  }
  // the window frame: the post by the door, the head, a glazing bar; slim, cream
  {
    const z0 = F - 0.05, z1 = F + 0.012;
    const fr: BufferGeometry[] = [];
    fr.push(box([WINDOW.x0 - 0.09, SHOP.plinth, z0], [WINDOW.x0, AWNING.rollerY + 0.03, z1 + 0.02], 0.012, ['nz'], 0.01)); // the post between door and window
    fr.push(box([WINDOW.x1, WINDOW.y0, z0], [SHOP.pilIn, WINDOW.y1, z1 - 0.01], 0.008, ['nz'])); // the jamb against the right pilaster
    fr.push(box([WINDOW.x0, WINDOW.y1, z0], [SHOP.pilIn, AWNING.rollerY + 0.03, z1], 0.01, ['nz'])); // head
    fr.push(box([DOOR.x0 - 0.02, DOOR.y1, z0], [WINDOW.x0 - 0.09, AWNING.rollerY + 0.03, z1], 0.01, ['nz'])); // over the door
    fr.push(box([WINDOW.x0, 1.06, z0 + 0.01], [WINDOW.x1, 1.095, z1 - 0.012], 0.008, ['nz'])); // transom bar
    const mx = (WINDOW.x0 + WINDOW.x1) / 2 + 0.17;
    fr.push(box([mx - 0.014, 1.095, z0 + 0.01], [mx + 0.014, WINDOW.y1, z1 - 0.014], 0.006, ['nz'])); // a bar in the transom lights
    b.add(painted(mergeGeometries(fr), CREAM, seed + 55, 'y', 1));
    // the glazing: two clear panes would be invisible; a thin bead of putty round the big pane says there is glass
    const bead: BufferGeometry[] = [];
    const bz = F - 0.03;
    bead.push(box([WINDOW.x0, WINDOW.y0, bz], [WINDOW.x1, WINDOW.y0 + 0.014, bz + 0.012], 0, ['nz']));
    bead.push(box([WINDOW.x0, 1.048, bz], [WINDOW.x1, 1.062, bz + 0.012], 0, ['nz']));
    bead.push(box([WINDOW.x0, WINDOW.y0, bz], [WINDOW.x0 + 0.014, 1.06, bz + 0.012], 0, ['nz']));
    bead.push(box([WINDOW.x1 - 0.014, WINDOW.y0, bz], [WINDOW.x1, 1.06, bz + 0.012], 0, ['nz']));
    b.add(painted(mergeGeometries(bead), CREAM, seed + 56, 'x', 0.85));
  }
}

// ---- the door: recessed, half glazed, panels below, brass fittings, a step -------------

function door(b: NodeBuilder, R: Rng, seed: number, hi: boolean): void {
  const { x0, x1, y0, y1, recess } = DOOR;
  const zd = F - recess;
  // the reveal: the opening's sides and soffit, painted cream, darker inside
  const rv: BufferGeometry[] = [];
  rv.push(box([x0 - 0.02, y0, zd - 0.02], [x0, y1, F], 0.004, ['px']));
  rv.push(box([x1, y0, zd - 0.02], [x1 + 0.02, y1, F], 0.004, ['nx']));
  rv.push(box([x0 - 0.02, y1, zd - 0.02], [x1 + 0.02, y1 + 0.03, F], 0.004, ['ny']));
  b.add(painted(mergeGeometries(rv), CREAM, seed + 60, 'y', 0.7));
  // the left pilaster's inner side to the door is the reveal's outer face: a lining board
  b.add(painted(box([-SHOP.pilIn - 0.005, SHOP.plinth, zd - 0.02], [x0 - 0.02, y1 + 0.03, F - 0.02], 0.004, ['ny']), CREAM, seed + 61, 'y', 0.6));
  // the leaf: stiles and rails, two raised panels below, a glazed upper half
  const zl = zd - 0.005, t = 0.035;
  const st = 0.065, railB = 0.13;
  const midY = 0.62;
  const leaf: BufferGeometry[] = [];
  leaf.push(box([x0, y0, zl], [x0 + st, y1, zl + t], 0.008, ['nz']));
  leaf.push(box([x1 - st, y0, zl], [x1, y1, zl + t], 0.008, ['nz']));
  leaf.push(box([x0 + st, y0, zl], [x1 - st, y0 + railB, zl + t], 0.008, ['nz']));
  leaf.push(box([x0 + st, midY - 0.05, zl], [x1 - st, midY + 0.035, zl + t], 0.008, ['nz']));
  leaf.push(box([x0 + st, y1 - 0.07, zl], [x1 - st, y1, zl + t], 0.008, ['nz']));
  leaf.push(box([(x0 + x1) / 2 - 0.022, y0 + railB, zl], [(x0 + x1) / 2 + 0.022, midY - 0.05, zl + t], 0.006, ['nz']));
  b.add(painted(mergeGeometries(leaf), PANEL, seed + 62, 'y', 1.05));
  // raised panels, in the leaf's own colour, a hair proud of a sunk field
  for (const [px0, px1] of [[x0 + st, (x0 + x1) / 2 - 0.022], [(x0 + x1) / 2 + 0.022, x1 - st]] as const) {
    b.add(painted(box([px0 + 0.012, y0 + railB + 0.012, zl], [px1 - 0.012, midY - 0.062, zl + t - 0.008], 0.012, ['nz'], 0.008), PANEL, seed + 63, 'y', 0.95));
  }
  // the glazed half: dark glass behind glazing bars (the shop behind the door is dark)
  {
    const gx0 = x0 + st, gx1 = x1 - st, gy0 = midY + 0.035, gy1 = y1 - 0.07;
    b.add(part('glass', grid(gx0, gx1, gy0, gy1, zl + 0.012, 1, 1), 'teal-deep', { shade: 1.4 }));
    const bars = [box([(gx0 + gx1) / 2 - 0.01, gy0, zl + 0.012], [(gx0 + gx1) / 2 + 0.01, gy1, zl + 0.028], 0.004, ['nz']), box([gx0, (gy0 + gy1) / 2 + 0.04, zl + 0.012], [gx1, (gy0 + gy1) / 2 + 0.06, zl + 0.028], 0.004, ['nz'])];
    b.add(painted(mergeGeometries(bars), PANEL, seed + 64, 'y', 1.05));
  }
  // brass: a kick plate, a letterbox in the middle rail, a knob, the hinges' knuckles
  {
    b.add(brass(box([x0 + 0.015, y0 + 0.012, zl + t], [x1 - 0.015, y0 + 0.105, zl + t + 0.006], 0.004, ['nz']), seed + 65));
    const lb = box([-0.075, -0.018, 0], [0.075, 0.018, 0.012], 0.005, ['nz']);
    b.add(brass(transform(lb, T((x0 + x1) / 2, midY - 0.008, zl + t)), seed + 66, 0.4));
    b.add(part('glass', box([(x0 + x1) / 2 - 0.06, midY - 0.014, zl + t + 0.0115], [(x0 + x1) / 2 + 0.06, midY - 0.002, zl + t + 0.0125], 0.0), 'ink'));
    const knob = lathe(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.008, { fillet: 0.004, segs: 1 }).to(0.008, 0.016).to(0.008, 0.04).cubic(0, 0.085, 0.032, 0.045, 0.034, 0.085, 3), { segs: 7, band: 0, caps: false });
    b.add(brass(transform(knob, aim([x1 - st / 2, 0.58, zl + t], [0, 0, 1])), seed + 67, 0.5));
    for (const ky of [y0 + 0.2, y1 - 0.2]) {
      const k = lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.09, { sharp: true }).to(0, 0.09), { segs: 6, band: 0 });
      b.small(() => brass(transform(k, T(x0 + 0.004, ky - 0.045, zl + t + 0.004)), seed + 68));
    }
  }
  // the step: a worn stone block, its front edge rounded by feet
  {
    const g = box([x0 - 0.05, 0, zd - 0.01], [x1 + 0.05, 0.075, zd + recess + 0.15], 0.016, ['ny']);
    // a hollow worn in its middle
    deform(g, (x, y, z) => {
      const dx = (x - (x0 + x1) / 2) / 0.18, dz = (z - (F + 0.02)) / 0.12;
      const q = dx * dx + dz * dz;
      return q < 1 && y > 0.07 ? [x, y - 0.007 * (1 - q), z] : [x, y, z];
    }, { keepSurf: true });
    b.add(stone(g, seed + 70, 0.75));
  }
  // a threshold strip of brass under the leaf
  b.add(brass(box([x0, y0 - 0.005, zd - 0.02], [x1, y0 + 0.004, zd + 0.06], 0.003), seed + 71, 0.2));
  void R;
}

// ---- the fascia: four slats, each a node that turns about its long axis ----------------

function fascia(b: NodeBuilder, o: StorefrontBuild, R: Rng, seed: number): void {
  const hw = FASCIA.hw, t = FASCIA.t, h = SLAT_H;
  const c = 0.011;
  for (let i = 0; i < FASCIA.slats; i++) {
    const n = b.node(NODES.slat(i), bind(NODES.slat(i)));
    // the slat body (its chamfered edges and ends) and its two gridded faces carry the paint
    const body = box([-hw, -h / 2, -t / 2 + 0.002], [hw, h / 2, t / 2 - 0.002], c, undefined, 0.006);
    // one slat took a knock at its end
    if (i === R.int(0, FASCIA.slats - 1)) knock(body, [hw * (R() < 0.5 ? 1 : -1), h / 2, t / 2], [0, 1, 1], 0.05, 0.006);
    const faceF = grid(-hw + c, hw - c, -h / 2 + c, h / 2 - c, t / 2 - 0.0005, FASCIA.cols, 1);
    const faceB = grid(-hw + c, hw - c, -h / 2 + c, h / 2 - c, -t / 2 + 0.0005, FASCIA.cols, 1, { back: true });
    n.add(painted(mergeGeometries([body, faceF, faceB]), o.fascia, seed + 80 + i, 'x'));
    // the words: one strip of the atlas on each face
    if (o.words) {
      const uvA = slatUv('A', i);
      const uvB = slatUv('B', i);
      const wf = grid(-hw, hw, -h / 2, h / 2, t / 2 + 0.0015, 12, 1, { uv: uvA });
      // the back face, read after a half turn: its local -y is up then, so v runs the other way
      const wb = grid(-hw, hw, -h / 2, h / 2, -t / 2 - 0.0015, 12, 1, { back: true, uv: uvB, flipV: true });
      // a back face seen from +z after a half turn about x: mirror x as well? No: a turn about x keeps x.
      n.add(setFinish(texturedPart('wood', mergeGeometries([wf, wb]), o.words), 1));
    }
  }
}

// ---- the awning: roller, drop arms, canvas (node), valance (node), crank (node) --------

function awning(b: NodeBuilder, o: StorefrontBuild, R: Rng, seed: number, hi: boolean): void {
  const hw = AWNING.hw;
  const full = awningGeometry(1);
  // the roller's hood: a cream half-round cassette on two brass end caps
  {
    const hood = extrude([[-(F - 0.02), AWNING.rollerY + 0.05], [-(F + 0.07), AWNING.rollerY + 0.05], [-(F + 0.1), AWNING.rollerY + 0.02], [-(F + 0.1), AWNING.rollerY - 0.005], [-(F + 0.085), AWNING.rollerY - 0.02], [-(F - 0.02), AWNING.rollerY - 0.02]], hw * 2 + 0.03, { radius: 0, bevel: 0.008, segs: 1, band: 0, support: false });
    // the canvas leaves through a slot under the hood's lip
    transform(hood, chain(T(-hw - 0.015, 0, 0), new Matrix4().makeRotationY(Math.PI / 2)));
    b.add(painted(hood, CREAM, seed + 90, 'x', 0.92));
    for (const sx of [-1, 1]) {
      const cap = lathe(profile(0, 0).to(0.045, 0, { sharp: true }).to(0.045, 0.012, { fillet: 0.005, segs: 1 }).to(0.03, 0.02).to(0, 0.022), { segs: 7, band: 0, caps: 'end' });
      b.add(brass(transform(cap, aim([sx * (hw + 0.016), AWNING.rollerY + 0.012, F + 0.045], [sx, 0, 0])), seed + 91, 0.3));
    }
  }
  // the canvas: stripes from the roller (z = 0) to the front bar (z = len), in the node's frame
  // (the node turns down to the slope and scales its z with the extension)
  const L = full.len;
  const aw = b.node(NODES.awning, bind(NODES.awning));
  const colour = aw.node(NODES.awningColour);
  const n = AWNING.stripes;
  const sw = (hw * 2) / n;
  const white: BufferGeometry[] = [], col: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = canvasStrip(-hw + i * sw, -hw + (i + 1) * sw, L, 0.022, 3);
    (i % 2 === 0 ? col : white).push(g);
  }
  aw.add(part('paper', mergeGeometries(white), 'paper', { seed: seed + 92, shade: 0.94 }));
  colour.add(part('paper', mergeGeometries(col), o.awning, { seed: seed + 93 }));
  // the valance and the front bar: hung at the arms' tips, they move with them (never scaled)
  const va = b.node(NODES.valance, bind(NODES.valance));
  const vcol = va.node(NODES.valanceColour);
  {
    const bar = lathe(profile(0, 0).to(0.016, 0, { sharp: true }).to(0.016, hw * 2 + 0.05, { sharp: true }).to(0, hw * 2 + 0.05), { segs: hi ? 8 : 6, band: 0 });
    va.add(brass(transform(bar, chain(T(-hw - 0.025, 0, 0), new Matrix4().makeRotationZ(-Math.PI / 2))), seed + 94, 0.2));
    const vw: BufferGeometry[] = [], vc: BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = valancePanel(-hw + i * sw, -hw + (i + 1) * sw, AWNING.valance, 0.022, hi ? 4 : 3);
      transform(g, T(0, -0.008, 0.012));
      (i % 2 === 0 ? vc : vw).push(g);
    }
    va.add(part('paper', mergeGeometries(vw), 'paper', { seed: seed + 95, shade: 0.94 }));
    vcol.add(part('paper', mergeGeometries(vc), o.awning, { seed: seed + 96 }));
  }
  // the arms: brass bars from a bracket on each pilaster up to the front bar
  for (const [name, sx] of [[NODES.armL, -1], [NODES.armR, 1]] as const) {
    const ax = sx * (hw + 0.022);
    const bracket = box([-0.03, -0.05, 0], [0.03, 0.03, 0.02], 0.006, ['nz']);
    b.add(brass(transform(bracket, chain(T(sx * SHOP.pilIn, AWNING.pivotY, AWNING.pivotZ), new Matrix4().makeRotationY(-sx * Math.PI / 2))), seed + 97));
    const arm = b.node(name, bind(name));
    const bar = lathe(profile(0, 0).to(0.011, 0, { sharp: true }).to(0.009, AWNING.arm, { sharp: true }).to(0, AWNING.arm), { segs: 6, band: 0 });
    arm.add(brass(bar, seed + 98));
    // its knuckle at the pivot, and a ferrule at the tip
    arm.add(brass(transform(lathe(profile(0, -0.014).to(0.02, -0.014, { sharp: true }).to(0.02, 0.014, { sharp: true }).to(0, 0.014), { segs: 8, band: 0 }), new Matrix4().makeRotationZ(Math.PI / 2)), seed + 99, 0.2));
  }
  // the winder: a brass boss on the right pilaster with a crank that turns face-on to the visitor
  {
    const cx = (SHOP.pilIn + SHOP.pilOut) / 2, cy = 1.2, cz = F + SHOP.pilProud;
    const bossG = lathe(profile(0, 0).to(0.04, 0, { sharp: true }).to(0.04, 0.016, { fillet: 0.006, segs: 1 }).to(0.024, 0.026).to(0.016, 0.034).to(0, 0.034), { segs: 8, band: 0, caps: 'end' });
    b.add(brass(transform(bossG, aim([cx, cy, cz], [0, 0, 1])), seed + 100, 0.2));
    const cr = b.node(NODES.crank, bind(NODES.crank));
    const armG = extrude([[-0.012, -0.012], [0.012, -0.012], [0.012, 0.075], [-0.012, 0.075]], 0.01, { radius: 0.011, bevel: 0.003, segs: 2, band: 0 });
    cr.add(brass(armG, seed + 101, 0.35));
    const grip = lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.014, 0.02, { smooth: true }).to(0.011, 0.045, { fillet: 0.005, segs: 1 }).to(0, 0.046), { segs: 8, band: 0, caps: 'end' });
    cr.add(part('rubber', transform(grip, aim([0, 0.066, 0.01], [0, 0, 1])), 'ink', { shade: 1.4 }));
  }
}

/**
 * The lit window's glow: bulb class at its indicator level, whose light goes as the cube of
 * the vertex colour away from the facing centre, so these are bigger than they look.
 */
const GLOW = { peak: 0.78, edge: 0.3, rgb: linear('amber-glow') } as const;

// ---- the window's inside: display floor, back partition (lit and unlit), the hanging lamp, the OPEN sign, the picture

function windowInside(b: NodeBuilder, o: StorefrontBuild, R: Rng, seed: number, hi: boolean): void {
  const x0 = WINDOW.x0, x1 = WINDOW.x1;
  const zb = F - WINDOW.depth;
  const yf = WINDOW.y0 + 0.012;
  // the display floor: boards, bare pine, running left to right
  {
    const boards: BufferGeometry[] = [];
    const nb = 4;
    const bd = (WINDOW.depth - 0.04) / nb;
    for (let i = 0; i < nb; i++) {
      const z0 = zb + i * bd;
      boards.push(box([x0, yf - 0.02, z0 + 0.002], [x1, yf, z0 + bd - 0.002], 0.004, ['ny']));
    }
    b.add(bare(mergeGeometries(boards), 'wood', seed + 110, 'x', 0.85));
  }
  // the sides of the display, dark
  b.add(painted(mergeGeometries([box([x0 - 0.02, yf, zb], [x0, WINDOW.y1, F - 0.03], 0.004), box([x1, yf, zb], [x1 + 0.02, WINDOW.y1, F - 0.03], 0.004)]), 'teal-deep', seed + 111, 'z', 1.2));
  // the back partition: boarded, dark (unlit); and its lit twin, a warm glow pooled under the lamp
  const unlit = b.node(NODES.windowUnlit, bind(NODES.windowUnlit));
  {
    const boards: BufferGeometry[] = [];
    const n = 4;
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) boards.push(box([x0 + i * w + 0.002, yf, zb - 0.02], [x0 + (i + 1) * w - 0.002, WINDOW.y1, zb], 0.004, ['nz']));
    unlit.add(painted(mergeGeometries(boards), 'teal-deep', seed + 112, 'y', 1.35));
  }
  const lit = b.node(NODES.windowLit, bind(NODES.windowLit));
  {
    // a gridded panel whose vertex colour falls off from a hot spot under the lamp: an indicator-level bulb surface, dim
    const gx = 10, gy = 6;
    const g = grid(x0 - (x0 + x1) / 2, x1 - (x0 + x1) / 2, yf - 0.75, WINDOW.y1 - 0.75, 0, gx, gy);
    const pos = g.getAttribute('position');
    const colA = g.getAttribute('color');
    const surf = g.getAttribute('surf');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const d = Math.hypot((x + 0.1) / 0.75, (y - 0.25) / 0.6);
      const k = GLOW.edge + (GLOW.peak - GLOW.edge) * Math.exp(-d * d * 1.6);
      // amber at the hot spot, deeper toward the edges (bulb class: vertex colour is the light)
      colA.setXYZ(i, k * GLOW.rgb[0], k * GLOW.rgb[1], k * GLOW.rgb[2]);
      surf.setXYZ(i, 0, 0, 1);
    }
    lit.add({ material: 'bulb', geometry: g });
    // and the pool of light the lamp throws on the display floor (the floor itself stays dark wood; lit, this lies on it)
    const cx = (x0 + x1) / 2, cy = 0.75, cz = zb + 0.004;
    const fl = grid(x0 + 0.01, x1 - 0.01, -(F - 0.035), -(zb + 0.01), 0, 10, 5);
    transform(fl, chain(T(-cx, yf + 0.0025 - cy, -cz), new Matrix4().makeRotationX(-Math.PI / 2)));
    const fp = fl.getAttribute('position'), fc = fl.getAttribute('color'), fs = fl.getAttribute('surf');
    const lx = x0 + 0.42 - cx, lz = zb + 0.22 - cz;
    for (let i = 0; i < fp.count; i++) {
      const d = Math.hypot((fp.getX(i) - lx) / 0.55, (fp.getZ(i) - lz) / 0.45);
      const k = GLOW.edge * 0.6 + (GLOW.peak - GLOW.edge * 0.6) * 0.85 * Math.exp(-d * d * 1.4);
      fc.setXYZ(i, k * GLOW.rgb[0], k * GLOW.rgb[1], k * GLOW.rgb[2]);
      fs.setXYZ(i, 0, 0, 1);
    }
    lit.add({ material: 'bulb', geometry: fl, castShadow: false });
  }
  // the hanging lamp: a cream shade on a flex, its bulb lit (in the lit node) or dark glass
  {
    const lx = x0 + 0.42, ly = 1.04, lz = zb + 0.16;
    b.add(part('rubber', sweep(polylinePath([[lx, WINDOW.y1, lz], [lx, ly + 0.07, lz]], 0.02, 1), { radius: 0.005, segs: 4, ends: 'flat' }), 'ink'));
    const shade = lathe(profile(0.012, 0.07).to(0.02, 0.07, { sharp: true }).cubic(0.085, 0, 0.03, 0.05, 0.08, 0.02, 3).to(0.08, -0.006, { sharp: true }), { segs: 8, band: 0, caps: false });
    b.add(setFinish(part('steel', transform(shade, T(lx, ly, lz)), 'paper', { seed: seed + 113 }), 0));
    const bulbG = lathe(profile(0, -0.04).cubic(0.028, 0.0, 0.03, -0.04, 0.03, 0.0, 4).to(0.012, 0.012).to(0, 0.012), { segs: 8, band: 0, caps: false });
    lit.add(part('bulb', transform(bulbG.clone(), T(lx - (x0 + x1) / 2, ly - 0.75, lz - zb - 0.004)), 'amber-glow'));
    unlit.add(part('glass', transform(bulbG.clone(), T(lx, ly, lz)), 'paper', { shade: 0.6 }));
  }
  openSign(b, o, seed);
  picture(b, o, R, seed, hi, yf);
}

function openSign(b: NodeBuilder, o: StorefrontBuild, seed: number): void {
  const S = OPEN_SIGN;
  // the hook in the window head and the cord, static; the card on its swivel is the node
  b.add(brass(transform(lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.03, { sharp: true }).to(0, 0.03), { segs: 6, band: 0 }), T(S.x, S.y, S.z)), seed + 120));
  const yTop = S.y - S.drop;
  b.add(part('rubber', sweep(polylinePath([[S.x, S.y, S.z], [S.x, yTop + 0.012, S.z]], 0.02, 1), { radius: 0.0035, segs: 4, ends: 'flat' }), 'paper', { shade: 0.7 }));
  const n = b.node(NODES.openSign, bind(NODES.openSign));
  // the card: a thin board with an edge, both faces printed from the atlas
  const w = S.w, h = S.h, t = 0.014;
  n.add(painted(box([-w / 2, -h, -t / 2], [w / 2, 0, t / 2], 0.005), 'ink', seed + 121, 'x', 1.6));
  n.add(brass(transform(lathe(profile(0, 0).to(0.01, 0, { sharp: true }).to(0.01, 0.02, { sharp: true }).to(0, 0.02), { segs: 6, band: 0 }), T(0, -0.008, 0)), seed + 122));
  const ins = 0.012;
  if (o.pictures) {
    const f = grid(-w / 2 + ins, w / 2 - ins, -h + ins, -ins, t / 2 + 0.001, 1, 1, { uv: ATLAS.open });
    // the back, read after the card turns half round about its string (y): mirror u
    const bk = grid(-w / 2 + ins, w / 2 - ins, -h + ins, -ins, -t / 2 - 0.001, 1, 1, { back: true, uv: [ATLAS.closed[2], ATLAS.closed[1], ATLAS.closed[0], ATLAS.closed[3]] });
    n.add(texturedPart('paper', mergeGeometries([f, bk]), o.pictures));
  } else {
    n.add(part('paper', grid(-w / 2 + ins, w / 2 - ins, -h + ins, -ins, t / 2 + 0.001, 1, 1), 'cable-red'));
    n.add(part('paper', grid(-w / 2 + ins, w / 2 - ins, -h + ins, -ins, -t / 2 - 0.001, 1, 1, { back: true }), 'ink', { shade: 1.6 }));
  }
}

function picture(b: NodeBuilder, o: StorefrontBuild, R: Rng, seed: number, hi: boolean, yf: number): void {
  const P = PICTURE;
  const fw = 0.045; // the gilt moulding's width
  const ox0 = P.x - P.w / 2, ox1 = P.x + P.w / 2, oy0 = P.y - P.h / 2, oy1 = P.y + P.h / 2;
  const r = P.h; // the drum is a hexagon of side P.h: its corners reach P.h from the axle
  const ap = (P.h * Math.sqrt(3)) / 2;
  const zf = P.faceZ;
  // the picture box: a painted case round the drum, its front a panel with the opening, a gilt frame round that
  {
    const cx0 = ox0 - fw - 0.03, cx1 = ox1 + fw + 0.03;
    const cy0 = Math.max(yf, P.y - r - 0.03), cy1 = P.y + r + 0.03;
    const zc0 = P.z - r - 0.02;
    const front = [
      box([cx0, cy0, zf - 0.03], [cx1, oy0 - 0.005, zf], 0.01, ['nz']),
      box([cx0, oy1 + 0.005, zf - 0.03], [cx1, cy1, zf], 0.01, ['nz']),
      box([cx0, oy0 - 0.005, zf - 0.03], [ox0 - 0.005, oy1 + 0.005, zf], 0.006, ['nz']),
      box([ox1 + 0.005, oy0 - 0.005, zf - 0.03], [cx1, oy1 + 0.005, zf], 0.006, ['nz']),
    ];
    const kn = front[1]!;
    knock(kn, [cx1, cy1, zf], [1, 1, 1], 0.04, 0.006);
    b.add(painted(mergeGeometries(front), PANEL, seed + 130, 'x', 1.1));
    // its sides and top, behind
    b.add(painted(box([cx0, cy0, zc0], [cx1, cy1, zf - 0.03], 0.012, ['pz', 'ny']), PANEL, seed + 131, 'z', 0.85));
    // the gilt frame round the opening, proud of the panel
    const mould = (x0: number, y0: number, x1: number, y1: number): BufferGeometry => box([x0, y0, zf - 0.005], [x1, y1, zf + 0.022], 0.01, ['nz'], 0.006);
    const fr = [mould(ox0 - fw, oy0 - fw, ox1 + fw, oy0), mould(ox0 - fw, oy1, ox1 + fw, oy1 + fw), mould(ox0 - fw, oy0, ox0, oy1), mould(ox1, oy0, ox1 + fw, oy1)];
    b.add(brass(mergeGeometries(fr), seed + 132, 0.2));
    const feet: BufferGeometry[] = [];
    for (const fx of [cx0 + 0.04, cx1 - 0.04]) for (const fz of [zc0 + 0.04, zf - 0.05]) feet.push(transform(lathe(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.026, 0.012, { smooth: true }).to(0.02, cy0 - yf + 0.002).to(0, cy0 - yf + 0.002), { segs: 5, band: 0, caps: 'end' }), T(fx, yf, fz)));
    void feet;
  }
  // the drum: six faces (five pictures and a blank), turning about x behind the opening
  const d = b.node(NODES.drum, bind(NODES.drum));
  {
    const hex: Array<[number, number]> = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      hex.push([Math.cos(a) * (r - 0.004), Math.sin(a) * (r - 0.004)]);
    }
    const core = extrude(hex, P.w + 0.02, { radius: 0, bevel: 0.004, segs: 1, band: 0, support: false });
    // extruded along +z from 0: centre it, turn it so the extrusion runs along x (a flat then faces +z)
    transform(core, chain(new Matrix4().makeRotationY(Math.PI / 2), T(0, 0, -(P.w + 0.02) / 2)));
    d.add(painted(core, 'ink', seed + 134, 'x', 1.4));
    const faces: BufferGeometry[] = [];
    for (let k = 0; k < P.faces; k++) {
      const g = grid(-P.w / 2, P.w / 2, -P.h / 2 + 0.004, P.h / 2 - 0.004, ap + 0.001, 1, 1, o.pictures ? { uv: ATLAS.pictures[k]! } : {});
      // face k looks +Z when the drum has turned k sixths forward (its top tipping toward the visitor)
      transform(g, new Matrix4().makeRotationX((-k * Math.PI) / 3));
      faces.push(g);
    }
    if (o.pictures) d.add(texturedPart('paper', mergeGeometries(faces), o.pictures));
    else d.add(part('paper', mergeGeometries(faces), 'paper'));
    // the axle, out through the case's right side, with a knurled brass knob on the end
    const L = P.w / 2 + fw + 0.08;
    d.add(brass(transform(lathe(profile(0, 0).to(0.008, 0, { sharp: true }).to(0.008, L, { sharp: true }).to(0, L), { segs: 6, band: 0 }), new Matrix4().makeRotationZ(-Math.PI / 2)), seed + 135));
    d.add(brass(transform(ridgedBand(0.026, 0.022, hi ? 12 : 8, 0.004), chain(T(L - 0.01, 0, 0), new Matrix4().makeRotationZ(-Math.PI / 2))), seed + 136, 0.3));
  }
  void R;
}

// ---- the lantern on the left pilaster --------------------------------------------------

function lantern(b: NodeBuilder, R: Rng, seed: number, hi: boolean): void {
  const px = -(SHOP.pilIn + SHOP.pilOut) / 2, py = 1.12, pz = F + SHOP.pilProud;
  // the bracket: a scrolled iron arm out of a brass back plate
  b.add(brass(transform(box([-0.035, -0.06, 0], [0.035, 0.06, 0.012], 0.006, ['nz']), T(px, py, pz)), seed + 140));
  const reach = 0.17;
  const arm = sweep(polylinePath([[px, py + 0.02, pz + 0.01], [px, py + 0.05, pz + reach * 0.6], [px, py + 0.02, pz + reach]], 0.05, 3), { radius: 0.009, segs: 5, ends: 'dome' });
  b.add(part('metal', arm, 'ink', { seed: seed + 141, shade: 1.8 }));
  const brace = sweep(polylinePath([[px, py - 0.05, pz + 0.01], [px, py - 0.02, pz + reach * 0.45], [px, py + 0.035, pz + reach * 0.62]], 0.03, 2), { radius: 0.006, segs: 4, ends: 'flat' });
  b.add(part('metal', brace, 'ink', { seed: seed + 142, shade: 1.8 }));
  // the lantern hangs under the arm's end: a brass cap, four glazed sides, a brass foot
  const lx = px, ly = py - 0.035, lz = pz + reach;
  const capG = lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.052, 0.012, { sharp: true }).cubic(0.0, 0.07, 0.04, 0.03, 0.012, 0.06, 3).to(0, 0.075), { segs: 4, band: 0, caps: 'start' });
  b.add(brass(transform(capG, chain(T(lx, ly, lz), new Matrix4().makeRotationY(Math.PI / 4))), seed + 143, 0.2));
  const footG = lathe(profile(0, -0.11).to(0.038, -0.11, { sharp: true }).to(0.04, -0.095, { sharp: true }).to(0.03, -0.09).to(0, -0.09), { segs: 4, band: 0 });
  b.add(brass(transform(footG, chain(T(lx, ly, lz), new Matrix4().makeRotationY(Math.PI / 4))), seed + 144, 0.2));
  // corner posts
  const posts: BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    posts.push(transform(box([-0.005, -0.09, -0.005], [0.005, 0, 0.005], 0, ['py', 'ny']), T(lx + Math.cos(a) * 0.036, ly, lz + Math.sin(a) * 0.036)));
  }
  b.add(part('metal', mergeGeometries(posts), 'ink', { shade: 1.8 }));
  // the glass: lit (a warm glow) or dark
  const glassG = lathe(profile(0, -0.09).to(0.034, -0.09, { sharp: true }).to(0.034, 0, { sharp: true }).to(0, 0), { segs: 4, band: 0, caps: false });
  transform(glassG, new Matrix4().makeRotationY(Math.PI / 4));
  const litN = b.node(`${NODES.windowLit}.lantern`, bind(`${NODES.windowLit}.lantern`));
  litN.add(part('bulb', glassG.clone(), 'amber-glow', { shade: 0.35 }));
  const unN = b.node(`${NODES.windowUnlit}.lantern`, bind(`${NODES.windowUnlit}.lantern`));
  unN.add(part('glass', glassG.clone(), 'teal-deep', { shade: 1.5 }));
  void R;
  void hi;
}

// ---- the jack box: STOREFRONT plate, the jack, the station lamp, the conduit -------------

function jackBox(b: NodeBuilder, o: StorefrontBuild, R: Rng, seed: number, hi: boolean): void {
  const J = JACKBOX;
  const zf = J.z + J.d / 2;
  // the box: teal enamel on a little stone base, a drip lid
  b.add(stone(box([J.x - J.w / 2 - 0.03, 0, J.z - J.d / 2 - 0.03], [J.x + J.w / 2 + 0.03, 0.05, zf + 0.03], 0.012, ['ny'], 0.01), seed + 150, 0.6));
  const body = roundedBox({ w: J.w, h: J.h - 0.05, d: J.d, r: 0.03, rPlan: 0.03, segs: 2, band: 0, open: true });
  transform(body, T(J.x, 0.05, J.z));
  knock(body, [J.x + J.w / 2, 0.2, zf], [1, 0, 1], 0.05, 0.007);
  b.add(part('steel', body, 'teal-panel', { seed: seed + 151, shade: 1.1, jitter: 0.03 }));
  const lid = box([J.x - J.w / 2 - 0.025, J.h, J.z - J.d / 2 - 0.025], [J.x + J.w / 2 + 0.025, J.h + 0.04, J.z + J.d / 2 + 0.025], 0.012, ['ny']);
  b.add(part('steel', lid, 'teal-panel', { seed: seed + 152, shade: 0.95 }));
  // the brass face plate
  const fp = { x0: J.x - J.w / 2 + 0.03, x1: J.x + J.w / 2 - 0.03, y0: 0.09, y1: J.h - 0.03 };
  const face = box([fp.x0, fp.y0, zf], [fp.x1, fp.y1, zf + 0.01], 0.006, ['nz']);
  b.add(brass(face, seed + 153, 0.1));
  // screws in its corners
  for (const [sx, sy] of [[fp.x0 + 0.02, fp.y0 + 0.02], [fp.x1 - 0.02, fp.y0 + 0.02], [fp.x0 + 0.02, fp.y1 - 0.02], [fp.x1 - 0.02, fp.y1 - 0.02]] as const) {
    b.small(() => brass(transform(stud(0.011, 0.006, 6), aim([sx, sy, zf + 0.01], [0, 0, 1])), seed + 154));
  }
  // the engraved name, on a strip along the plate's foot
  const pw = o.plate?.w ?? 0.28, ph = o.plate?.h ?? 0.07;
  const plateG = transform(sheet({ w: Math.min(pw, fp.x1 - fp.x0 - 0.02), h: ph, t: 0.002, nx: 1, ny: 1 }), T(J.x, fp.y0 + ph / 2 + 0.012, zf + 0.0105));
  if (o.plate && o.plate.key) b.add(texturedPart('brass', plateG, o.plate.key));
  else b.add(brass(plateG, seed + 155));
  // the jack: a fat knurled brass ring round a dark socket
  {
    const jx = J.x + 0.07, jy = J.h * 0.48;
    b.add(brass(transform(ridgedBand(0.038, 0.03, hi ? 12 : 8, 0.004), aim([jx, jy, zf + 0.01], [0, 0, 1])), seed + 156, 0.3));
    b.add(brass(transform(lathe(profile(0.016, 0.03).to(0.04, 0.03, { sharp: true }).to(0.036, 0.038, { fillet: 0.004, segs: 1 }).to(0.016, 0.036), { segs: 10, band: 0, caps: false }), aim([jx, jy, zf + 0.01], [0, 0, 1])), seed + 157, 0.5));
    b.add(part('rubber', transform(lathe(profile(0, 0).to(0.017, 0, { sharp: true }).to(0.017, 0.032).to(0, 0.032), { segs: 8, band: 0 }), aim([jx, jy, zf + 0.008], [0, 0, 1])), 'ink', { shade: 0.6 }));
  }
  // the station lamp: a lens in a brass bezel, lit or unlit
  {
    const lx = J.x - 0.09, ly = J.h * 0.48;
    const bezel = lathe(profile(0.026, 0).to(0.042, 0, { sharp: true }).to(0.042, 0.016, { fillet: 0.006, segs: 1 }).to(0.03, 0.026, { fillet: 0.004, segs: 1 }).to(0.026, 0.024), { segs: 10, band: 0, caps: false });
    b.add(brass(transform(bezel, aim([lx, ly, zf + 0.01], [0, 0, 1])), seed + 158, 0.45));
    const lens = lathe(profile(0, 0.006).to(0.027, 0.006, { sharp: true }).cubic(0, 0.036, 0.028, 0.02, 0.016, 0.034, 2), { segs: 8, band: 0, caps: false });
    const lit = b.node(NODES.lampLit, bind(NODES.lampLit));
    lit.add(setFinish(part('bulb', transform(lens.clone(), aim([0, 0, 0], [0, 0, 1])), 'amber-glow'), 1));
    const un = b.node(NODES.lampUnlit, bind(NODES.lampUnlit));
    un.add(part('glass', transform(lens.clone(), aim([0, 0, 0], [0, 0, 1])), 'amber', { shade: 0.35 }));
  }
  // the conduit: cloth-covered, out of a gland in the box's side, down to the bench, off toward the switchboard
  {
    const gx = J.x - J.w / 2, gy = 0.17, gz = J.z;
    const gland = lathe(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.02, { fillet: 0.004, segs: 1 }).to(0.022, 0.03).to(0.022, 0.045).to(0, 0.045), { segs: 8, band: 0, caps: 'end' });
    b.add(brass(transform(gland, aim([gx, gy, gz], [-1, 0, 0])), seed + 159, 0.2));
    const pts: V3[] = [[gx - 0.04, gy, gz], [gx - 0.14, gy - 0.02, gz + 0.01], [gx - 0.2, 0.03, gz + 0.04], [gx - 0.34, 0.025, gz + 0.02], [gx - 0.55, 0.025, gz - 0.05], [gx - 0.72, 0.025, gz - 0.16]];
    b.add(part('felt', sweep(polylinePath(pts, 0.08, hi ? 3 : 2), { radius: 0.022, segs: 6, ends: 'flat' }), 'ink', { seed: seed + 160, shade: 2.2 }));
    // a saddle strap holding it to the bench, two screws
    b.small(() => part('metal', transform(box([-0.05, 0, -0.016], [0.05, 0.052, 0.016], 0.008, ['ny']), chain(T(gx - 0.42, 0, gz + 0.012), new Matrix4().makeRotationY(-0.2))), 'steel', { seed: seed + 161, shade: 0.8 }));
  }
  void R;
}

/** The default build options. */
export const BUILD_DEFAULTS: Readonly<Omit<StorefrontBuild, 'seed' | 'detail'>> = {
  fascia: DEFAULTS.fascia,
  awning: DEFAULTS.awning,
  words: '',
  pictures: '',
  plate: null,
};

export { place, hexHead };
