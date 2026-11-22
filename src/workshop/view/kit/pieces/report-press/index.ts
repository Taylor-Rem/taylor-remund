/**
 * The report press (P4 D3, round two): a table-top press in black-green japanned enamel with gold lining and bright
 * brass, on a wooden base, the thing in the Report Generation Framework's crate. A cousin of an Albion hand press
 * (the arched cast frame, the long bar), a cheque-writer (the big side handle, the paper standing up out of the top)
 * and a hand-cranked sewing machine (the japanning, the gold lines, the bright wheel). Its silhouette, before any
 * detail: a press with a big handle and paper sticking out of it.
 *
 * Three scales. Large: the base, the arched cheeks and the crown, the long lever with its fat grip, the two sheets
 * standing out of the crown, the spring arm with its paddle of a bed. Middle: the brass ratchet wheel on the lever's
 * hub (it turns as the lever comes down), the raised panels on the cheeks with their arched windows, the platen block
 * on its spindle, the cast feet, the drawer's face and pull, the feed tray with its blanks (the top one askew), the
 * coil spring. Small: gold lining along the crown and the bed plate, screw and bolt heads, a blank brass maker's oval
 * (no words), rivets on the tray; the enamel chips to bare metal at worn edges by itself (the enamel class, seeded).
 *
 * Materials, honestly: enamel (`steel`, the japanning and its painted gold lining; the press keeps its own colours
 * when the room's scheme changes: its view calls `keepColours`), brass (the wheel, the oval, the slot plates, the
 * bed, the bolts, the spring), wood (the base, the drawer, the lever's grip), paper (every sheet: one label region,
 * `SHEETS`). Four draws: see the hand-in for why not three.
 *
 * Nodes that move (the view poses them, view/stations/press.ts), all under 'body' (the scaled node):
 *   'lever'                    turns about its local X (forward and down is a pull); origin its pivot
 *   'wheel'                    the ratchet wheel on the lever's hub: turns about its local X
 *   'platen'                   the platen block: down along its local Y as the lever comes down
 *   'printed'                  the printed sheet: rises along its local Y out of the crown's slot
 *   'gridded'                  the gridded sheet: turns about its local Y (it flips over into its holder)
 *   'blank'                    the top blank on the feed tray: slides in along its local -Z
 *   'drawer', 'stack'          the drawer slides along +Z; the stack in it scales in Y (one copy a sheet)
 *   'arm'                      the spring arm: turns about its local Z at its hinge (up is the flick)
 *   'env', 'flap-0'..'flap-2'  the envelope on the bed, and its three flaps (each turns about its hinge)
 */
import { Matrix4, type BufferGeometry, type BufferAttribute } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { LabelRegion, Labels } from '../../../types.ts';
import type { Token } from '../../../palette.ts';
import { roundedBox, lathe, extrude } from '../../solids.ts';
import { bevelBox, sheet } from '../../cheap.ts';
import { profile } from '../../profile.ts';
import { domeRivet, hexBolt, spring } from '../../details.ts';
import { chain, mat, part, piece, texturedPart, T } from '../../compose.ts';
import { askew } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { COLOURWAYS, PRESS_DIMS, PRESS_SCALE, SHEETS, UV, type Colourway } from './dims.ts';
import { paperOnce } from './paper.ts';

export { COLOURWAYS, PRESS_DIMS, PRESS_SCALE, SHEETS, UV, GRID } from './dims.ts';
export type { Colourway } from './dims.ts';

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
function standingSheet(w: number, h: number, face: Rect, key: string | undefined, bow = 0.004): KitPart[] {
  const lift = (u: number): number => bow * Math.sin(Math.PI * u);
  const f = transform(sheet({ w, h, t: 0.0014, nx: 3, ny: 1, lift }), T(0, h / 2, 0));
  const b = transform(sheet({ w, h, t: 0.0014, nx: 3, ny: 1, lift, back: true }), T(0, h / 2, 0));
  return [paper(f, face, key), paper(b, UV.blank, key, 0.94)];
}

/** A sheet lying flat, its middle at the origin, its face up (+Y): `t` thick (a stack is one thick sheet). */
function lyingSheet(w: number, d: number, t: number, face: Rect, key: string | undefined, edge: Rect = UV.blank): KitPart[] {
  const down = new Matrix4().makeRotationX(-Math.PI / 2);
  const f = transform(sheet({ w, h: d, t, nx: 1, ny: 1 }), down);
  const b = transform(sheet({ w, h: d, t, nx: 1, ny: 1, back: true }), down);
  return [paper(f, face, key), paper(b, edge, key, 0.92)];
}

/** Parts moved by a matrix (a new geometry each). */
function moved(parts: KitPart[], m: Matrix4): KitPart[] {
  return parts.map((q) => ({ ...q, geometry: transform(q.geometry, m) }));
}

/** The arched cheek's outline, in the cheek's own (z, y): a wide cast foot, waisted, up to the crown. */
function cheekOutline(): Array<[number, number]> {
  const D = PRESS_DIMS;
  const y0 = D.baseH + D.footH + 0.012;
  return [[D.frameZ0, y0], [D.frameZ1, y0], [D.frameZ1, y0 + 0.03], [0.05, 0.14], [0.048, D.crownY], [-0.078, D.crownY], [-0.082, 0.14], [D.frameZ0, y0 + 0.03]];
}
/** The raised panel on each cheek's outer face (the same shape, inset). */
function panelOutline(): Array<[number, number]> {
  const D = PRESS_DIMS;
  const y0 = D.baseH + D.footH + 0.03;
  return [[D.frameZ0 + 0.02, y0], [D.frameZ1 - 0.02, y0], [D.frameZ1 - 0.02, y0 + 0.018], [0.034, 0.14], [0.032, D.crownY - 0.018], [-0.062, D.crownY - 0.018], [-0.066, 0.14], [D.frameZ0 + 0.02, y0 + 0.018]];
}
/** The arched window through each cheek and its panel (same space). */
function cheekWindow(): Array<[number, number]> {
  const cz = -0.015, w = 0.026, y0 = 0.1, yArch = 0.19;
  const out: Array<[number, number]> = [[cz - w, y0], [cz + w, y0]];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    out.push([cz + Math.cos(a) * w, yArch + Math.sin(a) * w]);
  }
  return out;
}
/** The ratchet wheel's outline: `n` sloping teeth round radius `r` (in its own plane). */
function wheelOutline(r: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 0.62) / n) * Math.PI * 2;
    out.push([Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88], [Math.cos(b) * r, Math.sin(b) * r]);
  }
  return out;
}
/** Five spoke windows in the wheel. */
function wheelWindows(r: number): Array<Array<[number, number]>> {
  return Array.from({ length: 5 }, (_, k) => {
    const a0 = (k / 5) * Math.PI * 2 + 0.22, a1 = ((k + 1) / 5) * Math.PI * 2 - 0.22;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 3; i++) {
      const a = a0 + ((a1 - a0) * i) / 3;
      pts.push([Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7]);
    }
    for (let i = 3; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / 3;
      pts.push([Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32]);
    }
    return pts;
  });
}

export interface ReportPressOptions extends KitOptions {
  /** The paper region's key (`pressPaper(labels).key`). Without it, plain paper. */
  paper?: string;
  /** Which japanning (`COLOURWAYS`): 'japan' (black-green, the one to ship) or 'oxblood'. */
  colourway?: Colourway;
}

export function reportPress(o: ReportPressOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const D = PRESS_DIMS;
  const key = o.paper;
  const C = COLOURWAYS[o.colourway ?? 'japan'];
  const b = piece('report-press', { detail, seed });
  // (everything at the press's size: built in its own measurements, drawn at `PRESS_SCALE`)
  const r = b.node('body', new Matrix4().makeScale(PRESS_SCALE, PRESS_SCALE, PRESS_SCALE));

  /** Japanned enamel: glossy, a little deeper where thick; it chips to bare metal at worn edges by itself. */
  const enamel = (g: BufferGeometry, s: number, shade = 1): KitPart => setFinish(part('steel', g, C.enamel as Token, { seed: seed + s, shade, jitter: 0.04 }), 0.85);
  /** Gold lining: a painted line, glossy. */
  // (round three) a painted line, satin (no gloss coat: the bed plate's level lines mirrored the lamp's bulb at the look's framing) and a shade down
  const gold = (g: BufferGeometry, s: number): KitPart => setFinish(part('steel', g, C.lining as Token, { seed: seed + s, jitter: 0.03, shade: 0.72 }), 0);
  /**
   * (round three, the lead's review) Cast-iron flats in satin, not gloss: a broad level face under the gloss coat mirrors
   * the lamp's bulb whole (a ball of light that blooms, the brightest thing in the picture at the look's framing). The
   * feet and the bed plate the frame stands on are as cast; the upright and curved faces keep their gloss and its edges.
   */
  const satin = (g: BufferGeometry, s: number): KitPart => setFinish(part('steel', g, C.enamel as Token, { seed: seed + s, jitter: 0.04 }), 0);
  const brass = (g: BufferGeometry, s: number, shade = 1): KitPart => part('brass', g, 'brass', { seed: seed + s, shade, warm: 0.04, jitter: 0.05 });
  const wood = (g: BufferGeometry, s: number, token: Token = 'wood', shade = 1): KitPart => part('wood', g, token, { seed: seed + s, shade, jitter: 0.05, warm: 0.04 });

  // ---- the wooden base, screwed at its corners ------------------------------------------------------------------
  r.add(wood(roundedBox({ w: D.w, h: D.baseH, d: D.d, r: 0.008, segs: 2, detail }), 0));
  r.small(() => [[-0.195, -0.145], [0.195, -0.145], [-0.195, 0.145], [0.195, 0.145]].flatMap(([x, z], i) => domeRivet({ d: 0.012, detail: 'low', seed: seed + 2 + i, cheap: true, material: 'brass', token: 'brass' }).map((q) => ({ ...q, geometry: transform(q.geometry, T(x!, D.baseH - 0.001, z!)) }))));

  // ---- the cast feet and the bed plate the frame stands on, lined in gold ------------------------------------------
  const plateY = D.baseH + D.footH;
  for (const [i, [x, z]] of D.feet.entries()) {
    r.add(satin(bevelBox({ min: [x - 0.026, D.baseH - 0.001, z - 0.022], max: [x + 0.026, plateY, z + 0.022], c: 0.004, omit: ['ny'] }), 10 + i));
    r.small(() => hexBolt({ af: 0.014, h: 0.005, cheap: true, seed: seed + 14 + i, material: 'brass', token: 'brass' }).map((q) => ({ ...q, geometry: transform(q.geometry, T(x + (x < 0 ? -0.016 : 0.016), plateY - 0.001, z)) })));
  }
  const px0 = -D.cheekX - 0.03, px1 = D.cheekX + 0.03, pz0 = D.frameZ0 - 0.012, pz1 = D.frameZ1 + 0.012;
  r.add(satin(bevelBox({ min: [px0, plateY - 0.002, pz0], max: [px1, plateY + 0.012, pz1], c: 0.004, omit: ['ny'] }), 20));
  // gold lining round the plate's top, a hair in from its edge
  const ly = plateY + 0.0125;
  for (const [a, bb] of [[[px0 + 0.008, pz1 - 0.008], [px1 - 0.008, pz1 - 0.006]], [[px0 + 0.008, pz0 + 0.006], [px1 - 0.008, pz0 + 0.008]], [[px0 + 0.006, pz0 + 0.008], [px0 + 0.008, pz1 - 0.008]], [[px1 - 0.008, pz0 + 0.008], [px1 - 0.006, pz1 - 0.008]]] as const) {
    r.add(gold(bevelBox({ min: [a[0], ly - 0.0006, a[1]], max: [bb[0], ly, bb[1]], omit: ['ny'] }), 21));
  }

  // ---- the arched cheeks, each with a raised panel; arched windows through both --------------------------------------
  const holes = { holes: [cheekWindow()], holeRadius: 0.01 };
  for (const s of [-1, 1]) {
    const at = chain(T(s * D.cheekX + D.cheekT / 2, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2), askew(seed + 30 + s, 0.4));
    r.add(enamel(transform(extrude(cheekOutline(), D.cheekT, { bevel: 0.003, radius: 0.008, segs: 1, support: false, ...holes }), at), 31 + s));
    // the panel on the outer face (its thickness outward)
    const pat = s < 0 ? chain(T(s * D.cheekX - D.cheekT / 2 + 0.0005, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2)) : chain(T(s * D.cheekX + D.cheekT / 2 + 0.0065, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2));
    r.add(enamel(transform(extrude(panelOutline(), 0.006, { bevel: 0.002, radius: 0.006, segs: 1, support: false, caps: 'end', ...holes }), pat), 34 + s, 1.15));
  }

  // ---- the crown across the cheeks' tops: a cornice, gold lines, the brass slot plates and a blank maker's oval ------
  const crownW = 2 * D.cheekX + D.cheekT + 0.034;
  r.add(enamel(roundedBox({ w: crownW, h: D.crownH, d: D.crownD, r: 0.008, segs: 1, detail: 'low' }).translate(0, D.crownY, D.crownZ), 40));
  const topY = D.crownY + D.crownH;
  r.add(enamel(roundedBox({ w: crownW + 0.016, h: 0.012, d: D.crownD + 0.014, r: 0.005, segs: 1, detail: 'low' }).translate(0, topY - 0.006, D.crownZ), 41, 1.1));
  for (const z of [D.crownZ + D.crownD / 2 + 0.0005, D.crownZ - D.crownD / 2 - 0.0005]) {
    const f = z > D.crownZ ? 1 : -1;
    r.add(gold(bevelBox({ min: [-crownW / 2 + 0.01, D.crownY + 0.008, z - (f > 0 ? 0 : 0.0008)], max: [crownW / 2 - 0.01, D.crownY + 0.0105, z + (f > 0 ? 0.0008 : 0)] }), 42));
  }
  const capTop = topY + 0.006;
  for (const x of D.sheetX) r.add(brass(bevelBox({ min: [x - D.sheetW / 2 - 0.008, capTop - 0.001, D.sheetZ - 0.012], max: [x + D.sheetW / 2 + 0.008, capTop + 0.005, D.sheetZ + 0.012], c: 0.0015, omit: ['ny'] }), 43));
  // the maker's oval on the crown's front (blank brass: no words)
  r.add(brass(transform(lathe(profile(0, 0).to(0.022, 0, { sharp: true }).to(0.022, 0.003, { sharp: true }).to(0.019, 0.005, { sharp: true }).to(0, 0.005), { segs: 14, support: false, caps: false }), chain(T(0, D.crownY + D.crownH * 0.5, D.crownZ + D.crownD / 2), mat({ rot: [90, 0, 0] }), new Matrix4().makeScale(1.7, 1, 1))), 44, 1.05));
  r.small(() => [-1, 1].flatMap((s, i) => hexBolt({ af: 0.016, h: 0.006, cheap: true, seed: seed + 45 + i, material: 'brass', token: 'brass' }).map((q) => ({ ...q, geometry: transform(q.geometry, T(s * (crownW / 2 - 0.02), capTop, D.crownZ + 0.025)) }))));

  // ---- the platen block on its spindle (the block comes down as the lever does) ---------------------------------------
  r.add(brass(transform(lathe(profile(0, 0).to(0.009, 0, { sharp: true }).to(0.009, D.crownY - D.platenY - 0.035, { sharp: true }).to(0, D.crownY - D.platenY - 0.035), { segs: 8, support: false, caps: false }), T(0, D.platenY + 0.035, -0.015)), 50, 0.9));
  const platen = r.node('platen', T(0, D.platenY, -0.015));
  platen.add(enamel(roundedBox({ w: 2 * D.cheekX - D.cheekT - 0.012, h: 0.04, d: 0.13, r: 0.006, segs: 1, detail: 'low' }), 51, 0.9));
  platen.add(gold(bevelBox({ min: [-D.cheekX + D.cheekT, 0.0355, 0.0655], max: [D.cheekX - D.cheekT, 0.0375, 0.0662] }), 52));

  // ---- the feed tray behind the crown, its blanks (the top one askew) ---------------------------------------------------
  const trayAt = chain(T(0, D.trayY, D.trayZ), mat({ rot: [D.trayTilt, 0, 0] }));
  r.add(enamel(transform(bevelBox({ min: [-D.trayW / 2, -0.005, -D.trayD / 2], max: [D.trayW / 2, 0, D.trayD / 2], c: 0.002, omit: ['ny'] }), trayAt), 60));
  for (const x of [-D.trayW / 2, D.trayW / 2]) r.add(enamel(transform(bevelBox({ min: [x - 0.003, 0, -D.trayD / 2], max: [x + 0.003, 0.02, D.trayD / 2], c: 0.0012, omit: ['ny'] }), trayAt), 61));
  // a cast bracket from the crown's back that the tray's front rests on (round three: not two stray rods)
  r.add(enamel(bevelBox({ min: [-D.trayW / 2 + 0.01, D.trayY - 0.05, D.trayZ + D.trayD / 2 - 0.03], max: [D.trayW / 2 - 0.01, D.trayY + 0.004, D.crownZ - D.crownD / 2 + 0.003], c: 0.004 }), 62));
  r.small(() => [-0.06, 0.06].flatMap((x, i) => domeRivet({ d: 0.007, detail: 'low', seed: seed + 63 + i, cheap: true, material: 'brass', token: 'brass' }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(trayAt, T(x, 0, D.trayD / 2 - 0.01))) }))));
  const stackT = D.blanks * D.blankT;
  r.add(moved(lyingSheet(D.trayW - 0.014, D.trayD - 0.012, stackT, UV.blank, key), chain(trayAt, T(0, stackT, 0.002))));
  const blank = r.node('blank', chain(trayAt, T(0.004, stackT + 0.0003, 0.004), mat({ rot: [0, 4, 0] })));
  blank.add(lyingSheet(D.trayW - 0.016, D.trayD - 0.014, D.blankT, UV.blank, key));

  // ---- the two sheets standing out of the crown ----------------------------------------------------------------------
  const lean = new Matrix4().makeRotationX(-D.sheetLean * DEG);
  r.node('printed', chain(T(D.sheetX[0], capTop + 0.004, D.sheetZ), lean)).add(standingSheet(D.sheetW, D.sheetH, UV.printed, key));
  // (round three) the gridded sheet hangs from its top edge, so it comes over toward the visitor like a calendar page
  const topAt = new Matrix4().makeTranslation(D.sheetX[1], capTop + 0.004 + D.sheetH * Math.cos(D.sheetLean * DEG), D.sheetZ - D.sheetH * Math.sin(D.sheetLean * DEG));
  r.node('gridded', chain(topAt, lean)).add(moved(standingSheet(D.sheetW, D.sheetH, UV.gridded, key), T(0, -D.sheetH, 0)));

  // ---- the lever on the left: a hub on the cheek, the ratchet wheel and its pawl, the long cast arm, the fat grip -------
  const hubX = -D.cheekX - D.cheekT / 2;
  r.add(enamel(transform(lathe(profile(0, 0).to(0.026, 0, { sharp: true }).to(0.026, 0.008, { sharp: true }).to(0.018, 0.012, { sharp: true }).to(0, 0.012), { segs: low ? 10 : 14, support: false, caps: false }), chain(T(hubX, D.leverY, D.leverZ), mat({ rot: [0, 0, 90] }))), 70));
  // the axle out from the cheek to the lever, past the sheets' edge so the lever stands clear of them
  r.add(enamel(transform(lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, hubX - D.leverX, { sharp: true }).to(0, hubX - D.leverX), { segs: 10, support: false, caps: false }), chain(T(D.leverX, D.leverY, D.leverZ), mat({ rot: [0, 0, -90] }))), 69));
  const wheel = r.node('wheel', T((hubX + D.leverX) / 2 + 0.006, D.leverY, D.leverZ));
  wheel.add(brass(transform(extrude(wheelOutline(D.wheelR, D.wheelTeeth), 0.008, { bevel: 0.0006, bevelBase: 0, radius: 0, segs: 1, support: false, caps: "end", holes: wheelWindows(D.wheelR), holeRadius: 0 }), chain(new Matrix4().makeRotationY(-Math.PI / 2), T(0, 0, -0.004))), 71, 0.7));
  // the pawl that clicks on the wheel's teeth (fixed to the cheek above it)
  r.add(enamel(bevelBox({ min: [hubX - 0.016, D.leverY + D.wheelR - 0.004, D.leverZ - 0.035], max: [hubX - 0.006, D.leverY + D.wheelR + 0.01, D.leverZ + 0.004], c: 0.002 }), 72));
  const lever = r.node('lever', chain(T(D.leverX, D.leverY, D.leverZ), mat({ rot: [D.leverRest, 0, 0] })));
  lever.add(enamel(transform(lathe(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.03, 0.014, { sharp: true }).to(0.02, 0.02, { sharp: true }).to(0, 0.02), { segs: low ? 10 : 14, support: false, caps: false }), chain(mat({ rot: [0, 0, 90] }), T(0, -0.01, 0))), 73));
  // (round three) a forged arm in bright steel (the lamp finds its bevelled edges), a flat tapered bar wide at the boss and
  // narrow under the grip, its thickness across (extruded outward from the boss's plane), with a raised rib and a gold line
  // along its outer face (each extruded outward from the face before it)
  const steelArm = (g: BufferGeometry, s: number, shade = 1): KitPart => setFinish(part('metal', g, 'steel', { seed: seed + s, shade, jitter: 0.03 }), 0.5);
  const armAt = chain(T(0, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2));
  lever.add(steelArm(transform(extrude([[-0.026, 0], [0.026, 0], [0.013, D.leverLen], [-0.013, D.leverLen]], 0.03, { bevel: 0.004, radius: 0.006, segs: 1, support: false }), armAt), 74));
  lever.add(steelArm(transform(extrude([[-0.008, 0.02], [0.008, 0.02], [0.004, D.leverLen - 0.02], [-0.004, D.leverLen - 0.02]], 0.006, { bevel: 0.002, radius: 0.002, segs: 1, support: false, caps: 'end' }), chain(T(-0.03, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2))), 75, 1.15));
  lever.add(gold(transform(extrude([[-0.0016, 0.035], [0.0016, 0.035], [0.0012, D.leverLen - 0.035], [-0.0012, D.leverLen - 0.035]], 0.001, { bevel: 0, bevelBase: 0, radius: 0, segs: 1, support: false, caps: 'end' }), chain(T(-0.036, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2))), 76));
  lever.add(brass(lathe(profile(0.011, D.leverLen - 0.004).to(0.016, D.leverLen - 0.002, { sharp: true }).to(0.016, D.leverLen + 0.01, { sharp: true }).to(0.012, D.leverLen + 0.012), { segs: 12, support: false, caps: false }), 76));
  lever.add(wood(lathe(profile(0, D.leverLen + 0.01).to(0.018, D.leverLen + 0.012, { sharp: true }).to(D.gripR, D.leverLen + 0.03).to(D.gripR * 1.04, D.leverLen + 0.055).to(D.gripR * 0.86, D.leverLen + D.gripL - 0.004).to(0, D.leverLen + D.gripL), { segs: low ? 10 : 14, support: false, caps: false }), 77, 'wood-light', 1.15)); // pale turned wood: the lightest thing on the press

  // ---- the drawer in the base's front: a wooden face with a brass pull; its stack of copies inside ------------------------
  const drawer = r.node('drawer', T(0, 0.006, D.d / 2));
  drawer.add(wood(bevelBox({ min: [-D.drawerW / 2, 0, -0.006], max: [D.drawerW / 2, D.drawerH, 0.003], c: 0.002 }), 80, 'wood', 1.2));
  drawer.add(wood(bevelBox({ min: [-D.drawerW / 2 + 0.006, 0, -D.drawerD], max: [D.drawerW / 2 - 0.006, 0.003, -0.006], c: 0.001, omit: ['ny'] }), 81, 'wood-light', 0.6));
  for (const s of [-1, 1]) drawer.add(wood(bevelBox({ min: [s * (D.drawerW / 2 - 0.006) - 0.002, 0, -D.drawerD], max: [s * (D.drawerW / 2 - 0.006) + 0.002, D.drawerH - 0.004, -0.006], c: 0.0008 }), 82, 'wood-light', 0.62));
  drawer.add(brass(transform(lathe(profile(0, 0).to(0.011, 0, { sharp: true }).to(0.0115, 0.004, { sharp: true }).to(0.007, 0.011, { sharp: true }).to(0, 0.012), { segs: 10, support: false, caps: false }), chain(T(0, D.drawerH / 2, 0.003), mat({ rot: [90, 0, 0] }))), 83));
  const stack = drawer.node('stack', T(0, 0.003, -D.drawerD / 2 - 0.003));
  stack.add(moved(lyingSheet(D.drawerW - 0.024, D.drawerD - 0.03, D.copyT, UV.blank, key), T(0, D.copyT, 0)));

  // ---- the spring arm on the right: a bracket on the cheek, the coil, the strap, the brass paddle of a bed ------------------
  const [hx, hy, hz] = D.hinge;
  r.add(enamel(bevelBox({ min: [hx - 0.004, hy - 0.03, hz - 0.03], max: [hx + 0.018, hy + 0.02, hz + 0.03], c: 0.003 }), 90));
  r.small(() => spring({ r: 0.011, wire: 0.0026, pitch: 0.009, turns: 3, detail: 'low', material: 'brass', token: 'brass', seed: seed + 91 }).map((q) => ({ ...q, geometry: transform(q.geometry, chain(T(hx + 0.009, hy, hz - 0.03), mat({ rot: [90, 0, 0] }))) })));
  const arm = r.node('arm', T(hx, hy, hz));
  const bed: [number, number, number] = [D.bedAt[0] - hx, D.bedAt[1] - hy, D.bedAt[2] - hz];
  arm.add(enamel(bevelBox({ min: [0.01, -0.006, -0.014], max: [bed[0] - 0.02, 0.004, 0.014], c: 0.002 }), 92));
  arm.add(gold(bevelBox({ min: [0.02, 0.0042, -0.002], max: [bed[0] - 0.03, 0.0048, 0.002], omit: ['ny'] }), 93));
  arm.add(brass(bevelBox({ min: [bed[0] - D.bedW / 2, bed[1] - 0.005, bed[2] - D.bedD / 2], max: [bed[0] + D.bedW / 2, bed[1], bed[2] + D.bedD / 2], c: 0.002 }), 94, 0.95));
  for (const s of [-1, 1]) arm.add(brass(bevelBox({ min: [bed[0] + s * (D.envW / 2 + 0.006) - 0.002, bed[1], bed[2] - D.envD / 2 - 0.002], max: [bed[0] + s * (D.envW / 2 + 0.006) + 0.002, bed[1] + 0.03, bed[2] - D.envD / 2 + 0.002], c: 0.0008, omit: ['ny'] }), 95));
  // the envelope on the bed: its body flat, its three flaps splayed (they fold down over it)
  const env = arm.node('env', T(bed[0], bed[1] + 0.0005, bed[2]));
  env.add(lyingSheet(D.envW, D.envD, 0.0015, UV.envFace, key));
  const flapT = 0.0012;
  env.node('flap-0', T(-D.envW / 2, 0.0015, 0)).add(moved(lyingSheet(D.envW * 0.42, D.envD * 0.96, flapT, UV.blank, key), T(D.envW * 0.21, 0, 0)));
  env.node('flap-1', T(D.envW / 2, 0.0015, 0)).add(moved(lyingSheet(D.envW * 0.42, D.envD * 0.96, flapT, UV.blank, key), T(-D.envW * 0.21, 0.0015, 0)));
  env.node('flap-2', T(0, 0.0015, D.envD / 2)).add(moved(lyingSheet(D.envW * 0.98, D.envD * 0.62, flapT, UV.blank, key), T(0, 0.003, -D.envD * 0.31)));
  return b.build();
}

/**
 * The envelope (the one loose part the press makes): a flat paper envelope at toy scale (big enough to read on the
 * belt from the whole bench), its flap side up, and on it nothing but the flap's fold lines and a wax seal (drawn on
 * the paper region by the view: the seal's colour, the envelope's paint). Base on y = 0, its size the simulation's
 * body. One draw, under 100 triangles.
 */
export function reportEnvelope(o: ReportPressOptions = {}): Piece {
  const D = PRESS_DIMS;
  const key = o.paper;
  const b = piece('report-envelope', { detail: o.detail ?? 'high', seed: o.seed ?? 1, ao: false });
  const down = new Matrix4().makeRotationX(-Math.PI / 2);
  const w = D.envW * PRESS_SCALE, d = D.envD * PRESS_SCALE, t = D.envT * PRESS_SCALE;
  const pillow = (u: number, v: number): number => 0.003 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const top = transform(sheet({ w, h: d, t: t - 0.003, nx: 3, ny: 3, lift: pillow }), down);
  const under = transform(sheet({ w, h: d, t: t - 0.003, nx: 1, ny: 1, back: true }), down);
  b.add(paper(top, UV.envBack, key), paper(under, UV.envFace, key, 0.92));
  return b.build();
}

const buildOpts = (opts: Record<string, unknown>): ReportPressOptions => ({
  ...(typeof opts['seed'] === 'number' ? { seed: opts['seed'] } : {}),
  ...(opts['detail'] === 'low' || opts['detail'] === 'high' ? { detail: opts['detail'] } : {}),
  ...(typeof opts['paper'] === 'string' ? { paper: opts['paper'] } : {}),
  ...(opts['colourway'] === 'japan' || opts['colourway'] === 'oxblood' ? { colourway: opts['colourway'] } : {}),
});

export const catalogue: CatalogueEntry[] = [
  {
    name: 'report-press',
    build: (opts = {}) => reportPress(buildOpts(opts as Record<string, unknown>)),
    labels: (labels) => ({ paper: paperOnce(pressPaper(labels)).key }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, oxblood: { colourway: 'oxblood' } },
    camera: { distance: 1.6 },
    note: 'The report press (P4 D3): japanned enamel, gold lining and brass on a wooden base; the long lever, the ratchet wheel, two sheets out of the crown, a feed tray, a drawer, a spring arm and its envelope; the moving parts are nodes the view poses.',
  },
  {
    name: 'report-envelope',
    build: (opts = {}) => reportEnvelope(buildOpts(opts as Record<string, unknown>)),
    labels: (labels) => ({ paper: paperOnce(pressPaper(labels)).key }),
    camera: { distance: 0.6 },
    note: 'The report press\'s envelope (P4 D3): a flat paper envelope, its fold lines and a wax seal.',
  },
];
