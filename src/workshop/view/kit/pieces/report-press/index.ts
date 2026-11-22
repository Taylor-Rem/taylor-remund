/**
 * The report press (P4 D3): a table-top press of cast iron and brass on a wooden base, something between a hand
 * letterpress and a cheque-writer, the thing in the Report Generation Framework's crate. And its envelope.
 *
 * Three scales: the large (the wooden base, the two arched iron cheeks, the crosshead across their tops, the long
 * lever); the medium (the two brass holders and their sheets, the sloping feed tray and its blanks, the drawer in the
 * base's front, the spring arm and its brass bed, the platen block, a small handwheel on the right cheek); the small
 * (bolts through the cheeks, screws in the base, a brass oil cup on the crosshead, rivets on the tray, the drawer's
 * brass pull, the spring's coils).
 *
 * Materials, honestly, in three draws: wood (the base, the drawer, the lever's turned knob), brass (every fitting; and
 * the cast iron, which is drawn in the brass class in iron's own near-black, as the ledger board's steel tokens are,
 * so it shares the draw), paper (every sheet: one label region, `SHEETS`, its rectangles `UV`). The iron is not
 * enamel: the press keeps its own colours whatever the room's paint scheme (it is a loose part). Painted on the
 * platen, its wooden base wears the paint (the view, as the ledger board's).
 *
 * Nodes that move (the view poses them, view/stations/press.ts):
 *   'lever'                    turns about its local X (forward and down is a pull); origin its pivot
 *   'printed'                  the printed sheet: rises along its local Y out of the crosshead's slot
 *   'gridded'                  the gridded sheet: turns about its local Y (it flips over into its holder)
 *   'blank'                    the top blank on the feed tray: slides in along its local X
 *   'drawer', 'stack'          the drawer slides along +Z; the stack in it scales in Y (one copy a sheet)
 *   'arm'                      the spring arm: turns about its local X at its hinge (the flick)
 *   'env', 'flap-0'..'flap-2'  the envelope on the bed, and its three flaps (each turns about its hinge)
 */
import { Matrix4, type BufferGeometry, type BufferAttribute } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { LabelRegion, Labels } from '../../../types.ts';
import { roundedBox, lathe, extrude } from '../../solids.ts';
import { bevelBox, sheet } from '../../cheap.ts';
import { profile } from '../../profile.ts';
import { domeRivet, hexBolt, spring } from '../../details.ts';
import { chain, mat, part, piece, texturedPart, T } from '../../compose.ts';
import { askew } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { PRESS_DIMS, PRESS_SCALE, SHEETS, UV } from './dims.ts';
import { paperOnce } from './paper.ts';

export { PRESS_DIMS, PRESS_SCALE, SHEETS, UV, GRID } from './dims.ts';

const DEG = Math.PI / 180;
type Rect = readonly [number, number, number, number];

/** The paper's region (one for the press and its envelope): the same labels give the same region whoever asks. */
export function pressPaper(labels: Labels): LabelRegion {
  return labels.region(SHEETS.name, { w: SHEETS.w, h: SHEETS.h }, { texelsPerUnit: SHEETS.tpu, alpha: 'opaque' });
}

/** Map a sheet's uv (0..1) onto a rectangle of the paper region. In place. */
function onto(g: BufferGeometry, r: Rect): BufferGeometry {
  const uv = g.getAttribute('uv') as BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  uv.needsUpdate = true;
  return g;
}

/** Paper: on the region when there is one, else plain paper (reviews, tests). */
function paper(g: BufferGeometry, r: Rect, key: string | undefined, shade = 1): KitPart {
  return key ? texturedPart('paper', onto(g, r), key) : part('paper', g, 'paper', { shade });
}

/** A sheet of paper standing up, its foot's middle at the origin, its face +Z: the face on `face`, the back and edge blank. */
function standingSheet(w: number, h: number, face: Rect, key: string | undefined, bow = 0.003): KitPart[] {
  const lift = (u: number): number => bow * Math.sin(Math.PI * u);
  const f = transform(sheet({ w, h, t: 0.0012, nx: 3, ny: 1, lift }), T(0, h / 2, 0));
  const b = transform(sheet({ w, h, t: 0.0012, nx: 3, ny: 1, lift, back: true }), T(0, h / 2, 0));
  return [paper(f, face, key), paper(b, UV.blank, key, 0.94)];
}

/** A sheet lying flat, its middle at the origin, its face up (+Y): `t` thick (a stack is one thick sheet). */
function lyingSheet(w: number, d: number, t: number, face: Rect, key: string | undefined, edge: Rect = UV.blank): KitPart[] {
  const down = new Matrix4().makeRotationX(-Math.PI / 2);
  const f = transform(sheet({ w, h: d, t, nx: 1, ny: 1 }), down);
  const b = transform(sheet({ w, h: d, t, nx: 1, ny: 1, back: true }), down);
  return [paper(f, face, key), paper(b, edge, key, 0.92)];
}

/** Cast iron: near-black metal, a little warm where it is worn, in the brass class's draw. */
const iron = (g: BufferGeometry, seed: number, shade = 1.9): KitPart => setFinish(part('brass', g, 'ink', { seed, shade, jitter: 0.06 }), 0);
const brass = (g: BufferGeometry, seed: number, shade = 1): KitPart => part('brass', g, 'brass', { seed, shade, warm: 0.04, jitter: 0.05 });

/** An arched cheek's outline (in the cheek's own (z, y): its foot on the bed plate, its back higher than its front). */
function cheekOutline(): Array<[number, number]> {
  const D = PRESS_DIMS;
  const z0 = D.frameZ0, z1 = D.frameZ1;
  const top = D.crossY;
  // (the outline's x is the press's z once the cheek is turned)
  return [[z0, D.baseH], [z1, D.baseH], [z1, D.baseH + 0.03], [z1 - 0.012, top - 0.02], [z1 - 0.03, top], [z0 + 0.012, top], [z0, top - 0.014]];
}

export interface ReportPressOptions extends KitOptions {
  /** The paper region's key (`pressPaper(labels).key`). Without it, plain paper. */
  paper?: string;
}

export function reportPress(o: ReportPressOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const D = PRESS_DIMS;
  const key = o.paper;
  const b = piece('report-press', { detail, seed });
  // (everything at the press's size: built in its own measurements, drawn at `PRESS_SCALE`)
  const r = b.node('body', new Matrix4().makeScale(PRESS_SCALE, PRESS_SCALE, PRESS_SCALE));

  // ---- large: the wooden base (a little off true, its front edge worn), screwed down at its corners --------------
  r.add(part('wood', roundedBox({ w: D.w, h: D.baseH, d: D.d, r: 0.008, segs: 2, detail }), 'wood', { seed, jitter: 0.05, warm: 0.04 }));
  r.small(() => [[-0.19, -0.14], [0.19, -0.14], [-0.19, 0.14], [0.19, 0.14]].flatMap(([x, z], i) => domeRivet({ d: 0.011, detail: 'low', seed: seed + 2 + i, cheap: true, material: 'brass', token: 'brass' }).map((q) => ({ ...q, geometry: transform(q.geometry, T(x!, D.baseH - 0.001, z!)) }))));

  // ---- the iron frame: a bed plate, two arched cheeks, a crosshead across their tops, the platen block -----------
  r.add(iron(transform(bevelBox({ min: [-D.cheekX - 0.025, 0, D.frameZ0 - 0.01], max: [D.cheekX + 0.025, 0.012, D.frameZ1 + 0.01], c: 0.003, omit: ['ny'] }), T(0, D.baseH - 0.001, 0)), seed + 10));
  const cheekG = (): BufferGeometry => extrude(cheekOutline(), D.cheekT, { bevel: 0.0025, radius: 0.006, segs: 1, support: false });
  for (const s of [-1, 1]) {
    // (extruded toward +Z, turned so its thickness runs across the frame; a hair off true, as a casting is)
    r.add(iron(transform(cheekG(), chain(T(s * D.cheekX + D.cheekT / 2, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2), askew(seed + 11 + s, 0.4))), seed + 12 + s));
  }
  const crossTop = D.crossY + D.crossH;
  r.add(iron(transform(roundedBox({ w: 2 * D.cheekX + D.cheekT + 0.02, h: D.crossH, d: D.crossD, r: 0.006, segs: 1, detail: 'low' }), T(0, D.crossY, D.crossZ)), seed + 14, 2.1));
  r.add(iron(transform(bevelBox({ min: [-D.cheekX + D.cheekT / 2 + 0.005, 0, -0.05], max: [D.cheekX - D.cheekT / 2 - 0.005, 0.036, 0.05], c: 0.003 }), T(0, 0.074, -0.012)), seed + 15, 1.6));
  // the brass slot plates the two sheets stand in, on the crosshead's top
  for (const x of D.sheetX) r.add(brass(transform(bevelBox({ min: [-D.sheetW / 2 - 0.007, 0, -0.009], max: [D.sheetW / 2 + 0.007, 0.004, 0.009], c: 0.0012, omit: ['ny'] }), T(x, crossTop - 0.001, D.sheetZ)), seed + 16));
  // bolts through the cheeks into the crosshead, and a brass oil cup on top
  r.small(() => [-1, 1].flatMap((s, i) => hexBolt({ af: 0.014, h: 0.006, cheap: true, seed: seed + 20 + i, material: 'brass', token: 'ink' }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(T(s * (D.cheekX + D.cheekT / 2 + 0.0005), D.crossY + D.crossH / 2, D.crossZ), mat({ rot: [0, 0, -s * 90] }))) }))));
  r.small(() => [brass(transform(lathe(profile(0, 0).to(0.007, 0, { sharp: true }).to(0.006, 0.01, { sharp: true }).to(0.009, 0.014, { sharp: true }).to(0, 0.016), { segs: 7, support: false, caps: false }), T(-0.012, crossTop, D.crossZ + 0.02)), seed + 22, 0.95)]);

  // ---- the handwheel on the right cheek (it sets the platen's depth; it does not move) ---------------------------
  const wheelAt = chain(T(D.cheekX + D.cheekT / 2, 0.1, -0.02), mat({ rot: [0, 0, -90] }));
  r.add(iron(transform(lathe(profile(0.012, 0).to(0.032, 0.002, { sharp: true }).to(0.034, 0.008, { sharp: true }).to(0.03, 0.011, { sharp: true }).to(0.012, 0.009, { sharp: true }).to(0, 0.016), { segs: 10, support: false, caps: false }), wheelAt), seed + 24, 1.7));

  // ---- the feed tray at the back left, sloping up, a short stack of blanks on it ---------------------------------
  const trayAt = chain(T(D.trayX, D.trayY, D.trayZ), mat({ rot: [0, 0, -D.trayTilt] }));
  r.add(iron(transform(bevelBox({ min: [-D.trayW / 2, -0.004, -D.trayD / 2], max: [D.trayW / 2, 0, D.trayD / 2], c: 0.0015, omit: ['ny'] }), trayAt), seed + 30, 1.8));
  for (const z of [-D.trayD / 2, D.trayD / 2]) r.add(iron(transform(bevelBox({ min: [-D.trayW / 2, 0, -0.002], max: [D.trayW / 2, 0.014, 0.002], c: 0.001, omit: ['ny'] }), chain(trayAt, T(0, 0, z))), seed + 31, 1.8));
  // the tray's leg down to the base, at its high end
  r.add(iron(transform(bevelBox({ min: [-0.006, 0, -0.025], max: [0.006, D.trayY - D.baseH + 0.01, 0.025], c: 0.002, omit: ['ny'] }), T(D.trayX - D.trayW / 2 + 0.012, D.baseH - 0.002, D.trayZ)), seed + 32, 1.7));
  r.small(() => [-0.03, 0.03].flatMap((z, i) => domeRivet({ d: 0.006, detail: 'low', seed: seed + 33 + i, cheap: true, material: 'brass', token: 'ink' }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(trayAt, T(D.trayW / 2 - 0.008, 0, z))) }))));
  const stackT = D.blanks * D.blankT;
  r.add(transform0(lyingSheet(D.trayW - 0.012, D.trayD - 0.012, stackT, UV.blank, key), chain(trayAt, T(0.002, stackT, 0))));
  const blank = r.node('blank', chain(trayAt, T(0.002, stackT + 0.0002, 0)));
  blank.add(lyingSheet(D.trayW - 0.014, D.trayD - 0.014, D.blankT, UV.blank, key));

  // ---- the two holders and their sheets on the crosshead: the printed sheet left, the gridded sheet right ----------
  const lean = chain(new Matrix4().makeRotationX(-D.sheetLean * DEG));
  for (const [i, x] of D.sheetX.entries()) {
    // a brass clip at each top corner, on a thin back post
    const post = chain(T(x, crossTop, D.sheetZ - 0.006), lean);
    r.add(brass(transform(bevelBox({ min: [-0.003, 0, -0.004], max: [0.003, D.sheetH * 0.9, 0], c: 0.001, omit: ['ny'] }), post), seed + 40 + i, 0.9));
    r.add(brass(transform(bevelBox({ min: [-D.sheetW * 0.32, D.sheetH * 0.86, -0.004], max: [D.sheetW * 0.32, D.sheetH * 0.92, 0.002], c: 0.0012 }), post), seed + 42 + i));
  }
  const printed = r.node('printed', chain(T(D.sheetX[0], crossTop, D.sheetZ), lean));
  printed.add(standingSheet(D.sheetW, D.sheetH, UV.printed, key));
  const gridded = r.node('gridded', chain(T(D.sheetX[1], crossTop, D.sheetZ), lean));
  gridded.add(standingSheet(D.sheetW, D.sheetH, UV.gridded, key));

  // ---- the lever on the left cheek: an iron boss, a long arm, a turned wooden knob --------------------------------
  r.add(iron(transform(lathe(profile(0, 0).to(0.02, 0, { sharp: true }).to(0.02, 0.012, { sharp: true }).to(0.012, 0.016, { sharp: true }).to(0, 0.016), { segs: low ? 9 : 12, support: false, caps: false }), chain(T(-D.cheekX - D.cheekT / 2, D.leverY, D.leverZ), mat({ rot: [0, 0, 90] }))), seed + 50, 1.7));
  const lever = r.node('lever', chain(T(D.leverX - 0.012, D.leverY, D.leverZ), mat({ rot: [D.leverRest, 0, 0] })));
  lever.add(iron(transform(lathe(profile(0, 0).to(0.008, 0, { sharp: true }).to(0.0065, D.leverLen * 0.5, { sharp: true }).to(0.005, D.leverLen, { sharp: true }).to(0, D.leverLen), { segs: 7, support: false, caps: false }), T(0, 0, 0)), seed + 51, 1.9));
  lever.add(part('wood', transform(lathe(profile(0, 0).to(0.006, 0.002, { sharp: true }).to(D.knobR * 0.9, D.knobR * 0.7).to(D.knobR, D.knobR * 1.25).to(D.knobR * 0.7, D.knobR * 2).to(0, D.knobR * 2.15), { segs: low ? 9 : 11, support: false, caps: false }), T(0, D.leverLen - 0.004, 0)), 'wood', { seed: seed + 52, shade: 0.8, warm: 0.05 }));
  lever.add(brass(transform(lathe(profile(0.0075, 0).to(0.009, 0.002, { sharp: true }).to(0.009, 0.008, { sharp: true }).to(0.0065, 0.009), { segs: 8, support: false, caps: false }), T(0, D.leverLen - 0.01, 0)), seed + 53));

  // ---- the drawer in the base's front: a wooden face with a brass pull; its stack of copies inside ----------------
  const drawer = r.node('drawer', T(0, 0.006, D.d / 2));
  drawer.add(part('wood', bevelBox({ min: [-D.drawerW / 2, 0, -0.006], max: [D.drawerW / 2, D.drawerH, 0.002], c: 0.002 }), 'wood-light', { seed: seed + 60, shade: 0.75, jitter: 0.06 }));
  drawer.add(part('wood', bevelBox({ min: [-D.drawerW / 2 + 0.006, 0, -D.drawerD], max: [D.drawerW / 2 - 0.006, 0.003, -0.006], c: 0.001, omit: ['ny'] }), 'wood-light', { seed: seed + 61, shade: 0.6 }));
  for (const s of [-1, 1]) drawer.add(part('wood', bevelBox({ min: [s * (D.drawerW / 2 - 0.006) - 0.002, 0, -D.drawerD], max: [s * (D.drawerW / 2 - 0.006) + 0.002, D.drawerH - 0.004, -0.006], c: 0.0008 }), 'wood-light', { seed: seed + 62, shade: 0.62 }));
  drawer.add(brass(transform(lathe(profile(0, 0).to(0.008, 0, { sharp: true }).to(0.0085, 0.004, { sharp: true }).to(0.005, 0.009, { sharp: true }).to(0, 0.01), { segs: 8, support: false, caps: false }), chain(T(0, D.drawerH / 2, 0.002), mat({ rot: [90, 0, 0] }))), seed + 63));
  // the stack: one sheet's thickness at scale 1 (the view scales it by the count), its foot on the drawer's floor
  const stack = drawer.node('stack', T(0, 0.003, -D.drawerD / 2 - 0.003));
  stack.add(transform0(lyingSheet(D.drawerW - 0.02, D.drawerD - 0.03, D.copyT, UV.blank, key), T(0, D.copyT, 0)));

  // ---- the spring arm on the right: a bracket at the back, a coil spring, an iron arm and the brass bed -------------
  const hinge = T(D.armX, D.armHingeY, D.armHingeZ);
  r.add(iron(transform(bevelBox({ min: [-0.03, D.baseH - D.armHingeY, -0.016], max: [0.03, 0.008, 0.016], c: 0.002, omit: ['ny'] }), hinge), seed + 70, 1.8));
  const arm = r.node('arm', hinge);
  const bedC: [number, number, number] = [0, D.bedY - D.armHingeY, D.bedZ - D.armHingeZ];
  // the arm: an iron strap from the hinge to under the bed
  arm.add(iron(transform(bevelBox({ min: [-0.012, -0.003, 0], max: [0.012, 0.004, bedC[2] - 0.02], c: 0.0015 }), chain(T(0, 0.004, 0), mat({ rot: [-Math.atan2(bedC[1] - 0.012, bedC[2] - 0.02) / DEG, 0, 0] }))), seed + 71, 1.8));
  arm.add(brass(transform(bevelBox({ min: [-D.bedW / 2, -0.004, -D.bedD / 2], max: [D.bedW / 2, 0, D.bedD / 2], c: 0.0015 }), T(bedC[0], bedC[1], bedC[2])), seed + 72, 0.95));
  // two brass fingers at the bed's back that hold the flaps up
  for (const s of [-1, 1]) arm.add(brass(transform(bevelBox({ min: [-0.002, 0, -0.002], max: [0.002, 0.022, 0.002], c: 0.0008, omit: ['ny'] }), T(s * (D.envW / 2 + 0.004), bedC[1], bedC[2] - D.envD / 2 + 0.006)), seed + 73));
  arm.small(() => spring({ r: 0.009, wire: 0.0022, pitch: 0.008, turns: 3, detail: 'low', material: 'brass', token: 'brass', seed: seed + 74 }).map((q) => ({ ...q, geometry: transform(q.geometry, T(0, -0.02, 0.05)) })));
  // the envelope on the bed: its body flat, its three flaps standing (they fold down over it)
  const env = arm.node('env', T(bedC[0], bedC[1] + 0.0005, bedC[2]));
  env.add(lyingSheet(D.envW, D.envD, 0.0015, UV.envFace, key));
  const flapT = 0.0012;
  const fl = env.node('flap-0', T(-D.envW / 2, 0.0015, 0));
  fl.add(transform0(lyingSheet(D.envW * 0.42, D.envD * 0.96, flapT, UV.blank, key), T(D.envW * 0.21, 0, 0)));
  const fr = env.node('flap-1', T(D.envW / 2, 0.0015, 0));
  fr.add(transform0(lyingSheet(D.envW * 0.42, D.envD * 0.96, flapT, UV.blank, key), T(-D.envW * 0.21, 0.0015, 0)));
  const ff = env.node('flap-2', T(0, 0.0015, D.envD / 2));
  ff.add(transform0(lyingSheet(D.envW * 0.98, D.envD * 0.62, flapT, UV.blank, key), T(0, 0.003, -D.envD * 0.31)));
  return b.build();
}

/** Parts moved by a matrix (a new geometry each). */
function transform0(parts: KitPart[], m: Matrix4): KitPart[] {
  return parts.map((q) => ({ ...q, geometry: transform(q.geometry, m) }));
}

/**
 * The envelope (the one loose part the press makes): a flat paper envelope, its flap side up, and on it nothing but a
 * wax-seal dot (drawn on the paper region by the view: the seal's colour, the envelope's paint). Its middle at the
 * body's middle's foot (base on y = 0), its size the simulation's body. One draw, under 60 triangles.
 */
export function reportEnvelope(o: ReportPressOptions = {}): Piece {
  const D = PRESS_DIMS;
  const key = o.paper;
  const b = piece('report-envelope', { detail: o.detail ?? 'high', seed: o.seed ?? 1, ao: false });
  const down = new Matrix4().makeRotationX(-Math.PI / 2);
  const pillow = (u: number, v: number): number => 0.0025 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const top = transform(sheet({ w: D.envW * PRESS_SCALE, h: D.envD * PRESS_SCALE, t: D.envT * PRESS_SCALE - 0.001, nx: 2, ny: 2, lift: pillow }), down);
  const under = transform(sheet({ w: D.envW * PRESS_SCALE, h: D.envD * PRESS_SCALE, t: D.envT * PRESS_SCALE - 0.001, nx: 1, ny: 1, back: true }), down);
  b.add(paper(top, UV.envBack, key), paper(under, UV.envFace, key, 0.92));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'report-press',
    build: (opts = {}) => reportPress({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}), ...(typeof (opts as { paper?: unknown }).paper === 'string' ? { paper: (opts as { paper: string }).paper } : {}) }),
    labels: (labels) => ({ paper: paperOnce(pressPaper(labels)).key }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    camera: { distance: 1.2 },
    note: 'The report press (P4 D3): a cast-iron press on a wooden base; a lever, two holders, a feed tray, a drawer, a spring arm and its envelope; the moving parts are nodes the view poses.',
  },
  {
    name: 'report-envelope',
    build: (opts = {}) => reportEnvelope({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(typeof (opts as { paper?: unknown }).paper === 'string' ? { paper: (opts as { paper: string }).paper } : {}) }),
    labels: (labels) => ({ paper: paperOnce(pressPaper(labels)).key }),
    camera: { distance: 0.5 },
    note: 'The report press\'s envelope (P4 D3): a flat paper envelope with a wax-seal dot.',
  },
];
