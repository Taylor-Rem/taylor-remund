/**
 * The switchboard (REWRITE.md § B2 X1, § B5 "Patch", § D 4; art-direction
 * § 10 SWITCHBOARD). Registry name `switchboard`.
 *
 * A teal enamel cabinet standing in a worn wood frame: a dark plinth, a low
 * desk with a drawer per line under a wooden keyshelf, and above it the jack
 * panel between two wooden stiles under a moulded cornice and an arched crest
 * carrying the board's master lamp. Two builds:
 *
 *  - **the whole board** (`jacks: JACKS`, the `whole` variant): four live
 *    jacks in one row, left to right STOREFRONT, PLATEN, BELT, LAMP, each a
 *    big brass jack with a lens lamp beside it, and two capped positions
 *    under a strip of RESERVED tape. The tapes sit in two rows above the row
 *    so all four carry 12 px capitals at the bench's 60 px a unit: PLATEN and
 *    BELT directly over their jacks; STOREFRONT and LAMP above them, each
 *    with a clear window of plate down to its own jack. A row of small dead
 *    jacks under the live row. A drawer per line in the keyshelf, each with
 *    a brass card holder naming its line and a folder of papers inside. The
 *    jack row stands at a seated paw's height (Patch at 1.5x on a 0.62 stool)
 *    and the keyshelf is shallow enough to lean over; in front of the board a
 *    brass-railed runner the stool rolls along, so Patch can work every jack.
 *  - **the G1 slice** (`jacks: ['storefront', 'lamp']`, the default until the
 *    vignette is retired): what the owner approved, two live jacks with two
 *    capped positions between them, a dead field above, two drawers. Same
 *    picture as at G1, on the diet.
 *
 * Origin: the floor at the centre of the frame; +Z toward the visitor. The
 * jack panel's face is the plane z = 0.
 *
 * Moving nodes (pivots at the node origin):
 *  - `lamp.<jack>`: the lens lamp, holding `lamp.<jack>.lit` (`bulb` class,
 *    built collapsed to HIDDEN scale) and `lamp.<jack>.unlit` (a dark lens);
 *    `poseSwitchboard` swaps their scales.
 *  - `collar.<jack>`: the jack's knurled collar and crown, at the jack's
 *    centre, local +Z out of the panel. It lifts COLLAR_LIFT out (and swells
 *    a little) to show a band of yellow enamel: the jack offering itself while
 *    the plug is held (§ D 4). Pose `offer`.
 *  - `drawer.<jack>`: the drawer. Local +X points out of the board (world +Z);
 *    it slides along it.
 * Sockets (per live jack): `jack.<jack>` (the mouth, +Z out of the bore: a
 * seated plug's `seat` goes here), `lamp.<jack>` (the lens), `label.<jack>`
 * (the tape centre), `drawer.<jack>` (the drawer's pull, shut), and
 * `cord.root` (where the cord rises out of the keyshelf, +Y up), `stool`
 * (where Patch's stool stands at rest). The whole board adds
 * `stool.<jack>` (where the stool stands on its runner to work that jack).
 */
import { Matrix4 } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import { extrude, lathe, profiledBox, roundedBox, slab } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { aim, chain, flat, mat, part, piece, place, texturedPart, T } from '../../compose.ts';
import type { PartsLike, PieceBuilder } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import type { Rng } from '../../rng.ts';
import { dent, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, sheet, stud } from '../../cheap.ts';
import { triangleCount } from '../../mesh.ts';
import { estimateLabels, JACKS, SLICE_JACKS, TAPE_CAP, TAPE_CAP_WHOLE } from './labels.ts';
import type { JackName, LabelRef, SwitchboardLabelRefs } from './labels.ts';
import { HIDDEN, NAMED_POSES, poseSwitchboard } from './pose.ts';
import type { SwitchboardPose } from './pose.ts';
import { BEZEL_SEAT, bezel, bigJack, cappedJack, cardHolder, cupPull, drawerBox, holeGeom, JACK_MOUTH, lensPart, screw, smallJack, SMALL_MOUTH, Z_UP } from './parts.ts';

export { JACK_MOUTH, COLLAR_LIFT } from './parts.ts';

/** The G1 slice's layout (unchanged), shared with the tests, the pose helper and the view. */
export const BOARD = {
  /** Outer width of the frame, and the cornice's top. */
  w: 4.4,
  top: 2.82,
  /** The keyshelf's top surface and its front edge. */
  shelfY: 0.89,
  shelfZ: 0.7,
  /** The jack panel's face (the plates stand proud of it). */
  panelZ: 0,
  plateT: 0.03,
  /**
   * The live row, low on the panel just above the keyshelf: jack centres (x), their height, and
   * the lens lamp's offset from its jack. A seated cord drops from here to the shelf and never
   * crosses a tape; the plug (standing out toward the camera) covers shelf, not letters.
   */
  jackX: { storefront: -1.0, lamp: 1.04 } as Partial<Record<JackName, number>>,
  jackY: 1.18,
  lampDX: 0.4,
  /** The tape centre ABOVE each jack pair (the designation over the jack, as on a real board). */
  tapeX: { storefront: -0.78, lamp: 1.26 } as Partial<Record<JackName, number>>,
  tapeY: 1.64,
  /** Drawer centres (x), the drawers' front face (z) and how far a drawer pulls out. */
  drawerY: 0.65,
  drawerZ: 0.6,
  /** Where the cord rises out of the keyshelf. */
  cordRoot: [0.04, 0.89, 0.48] as [number, number, number],
} as const;

/**
 * The whole board's layout. Heights are planned for the seated operator (Patch
 * at 1.5x on a stool whose seat is at STOOL_SEAT on the runner): the jack row
 * a little above shoulder height, the drawers' pulls a hand's drop below it,
 * the keyshelf shallow enough to lean over.
 */
export const BOARD_WHOLE = {
  w: 5.2,
  top: 2.92,
  shelfY: 0.89,
  shelfZ: 0.48,
  panelZ: 0,
  plateT: 0.03,
  /** The live row, left to right; each lens lamp sits lampDX right of its jack. */
  jackX: { storefront: -1.2, platen: -0.18, belt: 0.82, lamp: 1.72 } as Record<JackName, number>,
  jackY: 1.46,
  lampDX: 0.35,
  /**
   * The tapes, each on a leaning holder centred over its own jack, in two rows so the long
   * ones fit: STOREFRONT and BELT high, PLATEN and LAMP low; the low row leaves a window of
   * bare plate under each high tape down to its jack. The holders' bottom edges (y).
   */
  tapeRow: { storefront: 'high', platen: 'low', belt: 'high', lamp: 'low' } as Record<JackName, 'low' | 'high'>,
  holderLowY: 1.665,
  holderHighY: 2.2,
  /** The capped positions (RESERVED), at the row's left end. */
  capped: [-2.05, -1.69] as const,
  /** The drawers: one per line, each under its jack and lamp (left of them, under RESERVED, a blank panel). */
  drawerX: { storefront: -1.025, platen: -0.005, belt: 0.995, lamp: 1.895 } as Record<JackName, number>,
  drawerY: 0.685,
  drawerZ: 0.47,
  drawerW: 0.86,
  drawerH: 0.23,
  cordRoot: [0.14, 0.89, 0.25] as [number, number, number],
  /** The stool's runner in front of the board: centre line z, its top (where the stool stands), rail gauge, its ends. */
  runner: { z: 0.92, top: 0.052, gauge: 0.5, x0: -2.5, x1: 3.55 },
  /** Where the stool stands to work a jack: this far right of it (Patch sits facing -X, its right side to the board). */
  stoolDX: 0.15,
  /** Where the stool rests (x), past the board's right end. */
  stoolRestX: 3.12,
} as const;

/** The seat height (above the runner) the whole board is planned for: pass it to `stool({ seatY })`. */
export const STOOL_SEAT = 0.62;

export interface SwitchboardOptions extends KitOptions {
  /** Label refs from `switchboardLabels(labels, jacks)`. Without them the tape and cards are blank (clay reviews, tests). */
  labels?: SwitchboardLabelRefs;
  /** Build already posed (a name from NAMED_POSES, or a pose). Lamps dark, collars down and drawers shut is the default. */
  pose?: string | SwitchboardPose;
  /**
   * The live jacks. `['storefront', 'lamp']` (the default) builds the G1 slice the vignette shows;
   * any other set builds the whole board with all four (JACKS).
   */
  jacks?: readonly JackName[];
  /** Review: triangles by section, filled while building. */
  tally?: Map<string, number>;
}

export function isSliceJacks(jacks: readonly JackName[] | undefined): boolean {
  return !jacks || (jacks.length === 2 && jacks.includes('storefront') && jacks.includes('lamp'));
}

export function switchboard(o: SwitchboardOptions = {}): Piece {
  const built = isSliceJacks(o.jacks) ? buildSlice(o) : buildWhole(o);
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`switchboard: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    poseSwitchboard(built.root, p);
  }
  return built;
}

/** Adds parts to a node, counting their triangles under a section name when a tally is asked for. */
function adder(tally: Map<string, number> | undefined) {
  return (n: { add(...p: PartsLike[]): unknown }, label: string, ...p: PartsLike[]): void => {
    const list = flat(p);
    if (tally) tally.set(label, (tally.get(label) ?? 0) + list.reduce((s, q) => s + triangleCount(q.geometry), 0));
    n.add(list);
  };
}

// ============================================================================
// shared assemblies
// ============================================================================

/** One live jack at (x, y) on the plate face: escutcheon, bore and sleeve fixed, the collar a node. */
function liveJack(b: PieceBuilder, add: ReturnType<typeof adder>, j: JackName, x: number, y: number, zPlate: number, spin: number, segs: number, seed: number): void {
  const at = aim([x, y, zPlate - 0.002], [0, 0, 1], spin);
  const jk = bigJack(segs, seed);
  add(b, 'jacks', place(jk.fixed, at));
  // the collar's node: at the jack's centre, local +Z out of the panel; its parts in jack (+Y) space
  const inJack = aim([0, 0, 0], [0, 0, 1], spin);
  const c = b.node(`collar.${j}`, T(x, y, zPlate - 0.002));
  add(c, 'jacks', place(jk.collar, inJack));
  // the yellow sleeve under the collar: its own (still) node, so its baked cavity can be lifted
  add(b.node(`sleeve.${j}`, T(x, y, zPlate - 0.002)), 'jacks', place([jk.sleeve], inJack));
}

/**
 * The sleeves sit inside their collars at rest, so the cavity bake grimes them nearly black;
 * they are only ever seen with the collar lifted, in the open: give them back their paint.
 */
function cleanSleeves(n: PieceNode): void {
  if (n.name.startsWith('sleeve.')) {
    for (const q of n.parts) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) sf.setY(i, Math.min(sf.getY(i), 0.12));
      sf.needsUpdate = true;
    }
  }
  for (const c of n.children ?? []) cleanSleeves(c);
}

function withCleanSleeves(p: Piece): Piece {
  cleanSleeves(p.root);
  return p;
}

/** The lens lamp beside a jack: a brass bezel (fixed) round a lit and a dark lens (nodes). */
function lensLamp(b: PieceBuilder, add: ReturnType<typeof adder>, j: JackName, lx: number, y: number, zPlate: number, spin: number, hi: boolean, seed: number): void {
  add(b, 'lamps', place(bezel(0.115, hi, seed), aim([lx, y, zPlate - 0.002], [0, 0, 1], spin)));
  const lamp = b.node(`lamp.${j}`, aim([lx, y, zPlate - 0.002 + BEZEL_SEAT], [0, 0, 1]));
  add(lamp.node(`lamp.${j}.lit`, new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN)), 'lamps', lensPart(0.072, hi ? 10 : 8, true, seed + 2));
  add(lamp.node(`lamp.${j}.unlit`), 'lamps', lensPart(0.072, hi ? 10 : 8, false, seed + 3, true));
}

/** A strip of label tape (blank: ink paper) at `at`, peeling at its right end when `lifting`. */
function tapeStrip(b: PieceBuilder, add: ReturnType<typeof adder>, ref: LabelRef, at: Matrix4, lifting: boolean, label = 'tape'): void {
  const lift = lifting ? (u: number, v: number) => 0.035 * Math.pow(Math.max(0, (u - 0.86) / 0.14), 2) * Math.max(0, 1 - v * 0.85) : () => 0;
  const face = transform(sheet({ w: ref.w, h: ref.h, t: 0.004, lift, nx: lifting ? 6 : 1, ny: lifting ? 2 : 1 }), at);
  if (ref.key) add(b, label, texturedPart('tape', face, ref.key));
  else add(b, label, part('paper', face, 'ink', { shade: 0.9 }));
  if (lifting) add(b, label, part('paper', transform(sheet({ w: ref.w, h: ref.h, t: 0.004, lift, nx: 6, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
}

/** A drawer node: its wooden front, the brass card holder and card naming the line, a cup pull, and the box with the folder behind. */
function drawer(b: PieceBuilder, add: ReturnType<typeof adder>, j: JackName, x: number, y: number, z: number, dw: number, dh: number, card: LabelRef, at: { card: readonly [number, number]; pull: readonly [number, number] }, seed: number, inner: Rng, shade = 0.7): void {
  const d = b.node(`drawer.${j}`, chain(T(x, y, z), new Matrix4().makeRotationY(-Math.PI / 2)));
  const toNode = new Matrix4().makeRotationY(Math.PI / 2);
  const parts: KitPart[] = [];
  const front = bevelBox({ min: [-dw / 2, -dh / 2, -0.05], max: [dw / 2, dh / 2, 0], c: 0.014, omit: ['nz'] });
  parts.push(part('wood', front, 'wood', { seed, shade, jitter: 0.05 }));
  parts.push(...drawerBox(inner, seed + 10, dw, 0.46, -dh / 2 + 0.03, dh - 0.07));
  // the card holder and the pull, where `at` puts them on the front (x, y)
  const [cx, hy] = at.card;
  parts.push(...place([cardHolder(card.w, card.h, hy, seed + 2)], T(cx, 0, 0)));
  const cardG = transform(sheet({ w: card.w, h: card.h, t: 0.002, nx: 1, ny: 1 }), T(cx, hy, 0.002));
  if (card.key) parts.push(texturedPart('paper', cardG, card.key));
  else parts.push(part('paper', cardG, 'paper'));
  parts.push(...place(cupPull(seed + 4, at.pull[1]), T(at.pull[0], 0, 0)));
  add(d, 'drawers', place(parts, toNode));
}

/** The keyshelf's cord grommets (the cord rises from the middle one) and its ferrule; returns the cord.root socket. */
function grommets(b: PieceBuilder, add: ReturnType<typeof adder>, root: readonly [number, number, number], yK: number, seed: number): Matrix4 {
  for (const dx of [-0.36, 0, 0.36]) {
    const g = lathe(
      profile(0.034, -0.02).to(0.034, 0.004, { sharp: true }).to(0.062, 0.006, { sharp: true }).to(0.054, 0.016, { sharp: true }).to(0.034, 0.008),
      { segs: 8, caps: false, band: 0 },
    );
    add(b, 'grommets', setFinish(part('brass', transform(g, T(root[0] + dx, yK, root[2])), 'brass', { seed }), 0.35));
    if (dx !== 0) add(b, 'grommets', setFinish(part('steel', transform(lathe(profile(0, -0.025).to(0.034, -0.025), { segs: 6, caps: false, band: 0 }), T(root[0] + dx, yK, root[2])), 'ink', { shade: 0.6 }), 0));
  }
  const fer = lathe(profile(0.044, 0).to(0.044, 0.035, { fillet: 0.006, segs: 1 }).to(0.036, 0.06, { fillet: 0.008, segs: 1 }).to(0, 0.062), { segs: 10, caps: 'end', band: 0 });
  add(b, 'grommets', setFinish(part('brass', transform(fer, T(root[0], yK + 0.004, root[2])), 'brass', { seed: seed + 1 }), 0.5));
  return T(root[0], yK + 0.066, root[2]);
}

/** The slanted writing ledge with a pad and a pencil, at (lx, yK, lz). */
function writingLedge(b: PieceBuilder, add: ReturnType<typeof adder>, R: Rng, lx: number, yK: number, lz: number, w: number, d: number, seed: number): void {
  const ledge = chain(T(lx, yK, lz), mat({ rot: [12, -4 + R.spread(2), 0] }));
  add(b, 'ledge', part('wood', transform(roundedBox({ w, h: 0.05, d, r: 0.012, rPlan: 0.03, segs: 1, detail: 'low', band: 0 }), chain(ledge, T(0, 0.02, 0))), 'wood', { seed, shade: 0.74, jitter: 0.05 }));
  // a wedge under its back edge
  add(b, 'ledge', part('wood', bevelBox({ min: [lx - w / 2 + 0.03, yK, lz - d / 2], max: [lx + w / 2 - 0.03, yK + 0.07, lz - d / 2 + 0.13], c: 0.01, omit: ['ny', 'nz'] }), 'wood', { seed: seed + 1, shade: 0.48 }));
  // the pad: a stack of paper, its top sheet curling up a little at the front
  const pw = w - 0.24, pd = d - 0.17;
  const pad = chain(ledge, T(-0.04, 0.07, 0.01), mat({ rot: [-90, 0, R.spread(4)] }));
  add(b, 'ledge', part('paper', transform(bevelBox({ min: [-pw / 2, -0.01, -pd / 2], max: [pw / 2, 0.01, pd / 2], c: 0.003, omit: ['ny'] }), chain(ledge, T(-0.04, 0.055, 0.01), mat({ rot: [0, R.spread(4), 0] }))), 'paper', { seed: seed + 2, shade: 0.86 }));
  add(b, 'ledge', part('paper', transform(sheet({ w: pw, h: pd, t: 0.002, nx: 1, ny: 3, lift: (_u, v) => 0.02 * Math.pow(Math.max(0, (0.25 - v) / 0.25), 2) }), pad), 'paper', { seed: seed + 3 }));
  // a pencil lying across it
  const pen = chain(ledge, T(0.02, 0.085, 0.12), mat({ rot: [0, 0, -90] }), mat({ rot: [0, 28 + R.spread(6), 0] }));
  const pg = lathe(profile(0, 0).to(0.014, 0, { sharp: true }).to(0.014, 0.3, { sharp: true }).to(0, 0.3), { segs: 6, caps: true, band: 0 });
  add(b, 'ledge', setFinish(part('wood', transform(pg, chain(pen, T(0, -0.15, 0))), 'tape-yellow', { seed: seed + 4 }), 1));
  const tip = lathe(profile(0, 0).to(0.014, 0, { sharp: true }).to(0.003, 0.05, { sharp: true }).to(0, 0.052), { segs: 6, caps: false, band: 0 });
  add(b, 'ledge', part('wood', transform(tip, chain(pen, T(0, 0.15, 0))), 'wood-light', { seed: seed + 5 }));
}

/** The moulded cornice (cove and bead) w wide, its top at `top`. */
function cornice(w: number, top: number, zP: number, hi: boolean, R: Rng, seed: number): KitPart {
  const r = 0.08;
  const pr = profile(0, 0)
    .to(r - 0.07, 0, { sharp: true })
    .to(r - 0.07, 0.03, { sharp: true })
    .arc(r - 0.005, 0.12, -0.18, hi ? 3 : 2)
    .to(r - 0.005, 0.135, { sharp: true })
    .to(r + 0.02, 0.15, { sharp: true })
    .to(r + 0.02, 0.21, { fillet: 0.02, segs: 1 })
    .to(r - 0.01, 0.24, { sharp: true })
    .to(0, 0.24);
  const g = profiledBox({ w: w + 0.16, d: 0.8, rPlan: r, detail: 'low', band: 0 }, pr);
  transform(g, T(0, top - 0.24, zP - 0.19));
  dent(g, [1.2 + R.spread(0.4), top - 0.05, zP + 0.23], [0, 0.4, 1], 0.1, 0.012);
  return part('wood', g, 'wood', { seed, jitter: 0.04, shade: 0.59 });
}

/** The arched crest on the cornice with the master lamp in its bezel, and two turned finials on the stiles. */
function crestAndFinials(b: PieceBuilder, add: ReturnType<typeof adder>, w: number, top: number, zP: number, hi: boolean, seed: number): void {
  const cw = 1.7, ch = 0.3;
  const outline: Array<[number, number]> = [[-cw / 2, 0], [cw / 2, 0], [cw / 2, 0.05]];
  const n = hi ? 8 : 6;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = cw / 2 - t * cw;
    const u = Math.abs(x) / (cw / 2);
    outline.push([x, 0.05 + (ch - 0.05) * Math.pow(Math.cos((u * Math.PI) / 2), 0.7)]);
  }
  outline.push([-cw / 2, 0.05]);
  const g = extrude(outline, 0.09, { bevel: 0.018, bevelBase: 0, segs: 1, detail: 'low', radius: 0.02, band: 0 });
  transform(g, T(0, top - 0.01, zP - 0.12));
  dent(g, [0.5, top + 0.17, zP - 0.03], [0.5, 1, 1], 0.07, 0.01);
  add(b, 'frame', part('wood', g, 'wood', { seed, jitter: 0.04, shade: 0.64 }));
  const mAt = aim([0, top + 0.15, zP - 0.03], [0, 0, 1], 12);
  add(b, 'lamps', place(bezel(0.11, hi, seed + 1), mAt));
  add(b, 'lamps', place([lensPart(0.068, 8, false, seed + 2)], chain(mAt, T(0, BEZEL_SEAT, 0))));
  for (const sx of [-1, 1]) b.small(() => place([part('brass', stud(0.014, 0.009, 5), 'brass', { seed: seed + 3 })], chain(T(sx * 0.62, top + 0.06, zP - 0.03), Z_UP)));
  for (const s of [-1, 1]) {
    const fg = lathe(
      profile(0, 0).to(0.05, 0, { sharp: true }).to(0.05, 0.02, { sharp: true }).to(0.032, 0.04, { fillet: 0.01, segs: 1 }).to(0.026, 0.06, { smooth: true }).curve(0.058, 0.11, 0.06, 0.07, 2).curve(0, 0.17, 0.05, 0.16, 2),
      { segs: 8, band: 0 },
    );
    add(b, 'frame', part('wood', transform(fg, T(s * (w / 2), top, zP + 0.08)), 'wood', { seed: seed + 5 + s, shade: 0.65 }));
  }
}

// ============================================================================
// THE G1 SLICE (two live jacks): the approved picture, on the diet
// ============================================================================

function buildSlice(o: SwitchboardOptions): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const add = adder(o.tally);
  const b = piece('switchboard', { detail, seed });
  const W = BOARD.w;
  const yK = BOARD.shelfY;
  const zP = BOARD.panelZ;
  const pt = BOARD.plateT;
  const zPlate = zP + pt;
  const est = estimateLabels(TAPE_CAP);
  const tapeRef = (j: JackName): LabelRef => o.labels?.tape[j] ?? { key: '', ...est.tape[j] };
  const cardRef = (j: JackName): LabelRef => o.labels?.card[j] ?? { key: '', ...est.card[j] };

  // ---- large form: plinth, desk, keyshelf, panel body, stiles, cornice ----
  add(b, 'frame', part('wood', roundedBox({ w: W - 0.12, h: 0.11, d: 1.0, r: 0.02, segs: 1, detail: 'low', band: 0 }), 'wood', { seed, shade: 0.33 }));
  {
    const g = roundedBox({ w: W - 0.24, h: 0.72, d: 1.04, r: 0.03, rPlan: 0.03, segs: 1, detail: 'low', band: 0 });
    transform(g, T(0, 0.1, 0.02));
    dent(g, [-1.6 + R.spread(0.2), 0.16, 0.54], [0, 0, 1], 0.12, 0.012);
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 1, shade: 0.92, jitter: 0.03 }));
  }
  for (const s of [-1, 1]) {
    const g = roundedBox({ w: 0.16, h: 0.74, d: 1.12, r: 0.03, segs: 1, detail: 'low', band: 0 });
    transform(g, T(s * (W / 2 - 0.08), 0.08, 0.04));
    dent(g, [s * (W / 2), 0.55, 0.6], [s, 0, 1], 0.07, 0.012);
    add(b, 'frame', part('wood', grain(g, 'y'), 'wood', { seed: seed + 2 + s, jitter: 0.06, shade: 0.59 }));
  }
  add(b, 'frame', part('wood', bevelBox({ min: [-W / 2 + 0.16, 0.49, 0.5], max: [W / 2 - 0.16, 0.81, 0.575], c: 0.012, band: 0.02, omit: ['nz'] }), 'wood', { seed: seed + 4, shade: 0.53 }));
  {
    const g = roundedBox({ w: W + 0.12, h: 0.085, d: 0.82, r: 0.03, rTop: 0.035, rPlan: 0.05, segs: 2, detail: 'low', band: 0 });
    transform(g, T(0, yK - 0.085, (BOARD.shelfZ - 0.12) / 2));
    for (const x of [-0.9 + R.spread(0.2), 0.9 + R.spread(0.2)]) dent(g, [x, yK, BOARD.shelfZ], [0, 1, 1], 0.32, 0.012);
    add(b, 'frame', part('wood', g, 'wood', { seed: seed + 5, jitter: 0.04, shade: 0.59 }));
  }
  {
    const g = roundedBox({ w: W - 0.3, h: 1.74, d: 0.5, r: 0.03, segs: 1, detail: 'low', band: 0 });
    transform(g, T(0, yK - 0.02, zP - 0.25));
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 6, shade: 0.8, jitter: 0.03 }));
  }
  for (const s of [-1, 1]) {
    const g = roundedBox({ w: 0.2, h: 1.76, d: 0.6, r: 0.035, segs: 2, detail: 'low', band: 0 });
    transform(g, T(s * (W / 2 - 0.1), yK - 0.02, zP - 0.19));
    dent(g, [s * (W / 2 - 0.2), 1.3 + R.spread(0.3), zP + 0.11], [-s, 0, 1], 0.08, 0.014);
    dent(g, [s * (W / 2), 2.2 + R.spread(0.2), zP + 0.11], [s, 0, 1], 0.06, 0.01);
    add(b, 'frame', part('wood', grain(g, 'y'), 'wood', { seed: seed + 7 + s, jitter: 0.06, shade: 0.62 }));
  }
  add(b, 'frame', cornice(W, BOARD.top, zP, hi, R, seed + 10));
  crestAndFinials(b, add, W, BOARD.top, zP, hi, seed + 13);
  add(b, 'frame', part('wood', bevelBox({ min: [-W / 2 + 0.19, BOARD.top - 0.34, zP - 0.05], max: [W / 2 - 0.19, BOARD.top - 0.235, zP + 0.07], c: 0.015, omit: ['nz'] }), 'wood', { seed: seed + 11, shade: 0.56 }));
  add(b, 'frame', part('wood', bevelBox({ min: [-W / 2 + 0.19, yK - 0.01, zP - 0.05], max: [W / 2 - 0.19, yK + 0.05, zP + 0.07], c: 0.015, omit: ['nz', 'ny'] }), 'wood', { seed: seed + 12, shade: 0.53 }));

  // ---- medium: the two enamel plates, screwed on, a little off true ----
  const plateA = { y0: yK + 0.07, y1: 1.95 };
  const plateB = { y0: 1.99, y1: BOARD.top - 0.355 };
  const plateW = W - 0.44;
  const plates: Array<{ y0: number; y1: number; s: number }> = [{ ...plateA, s: 1.06 }, { ...plateB, s: 0.98 }];
  plates.forEach((pl, i) => {
    const h = pl.y1 - pl.y0;
    const g = slab({ w: plateW, d: h, t: pt, r: 0.05, bevel: 0.011, detail: 'low', open: true, band: 0 });
    transform(g, chain(T(R.spread(0.01), (pl.y0 + pl.y1) / 2, zP), askew(seed + 20 + i, 0.25), Z_UP));
    dent(g, [-plateW / 2 + 0.3 + R.range(0, 1.2), pl.y1, zPlate], [0, 1, 1], 0.07, 0.009);
    dent(g, [plateW / 2 - 0.2 - R.range(0, 1.4), pl.y0, zPlate], [0, -1, 1], 0.06, 0.008);
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 22 + i, shade: pl.s, jitter: 0.03 }));
    const xs = [-plateW / 2 + 0.06, -plateW / 6, plateW / 6, plateW / 2 - 0.06];
    const underTape = (x: number): boolean => SLICE_JACKS.some((j) => Math.abs(x - BOARD.tapeX[j]!) < tapeRef(j).w / 2 + 0.06);
    for (const x of xs) for (const y of [pl.y0 + 0.05, pl.y1 - 0.05]) {
      if (i === 0 && y > pl.y0 + 0.5 && underTape(x)) continue;
      const sd = R.int(0, 999);
      b.small(() => {
        const at = aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 60));
        const p = place([screw(0.02, 0.011, sd)], at);
        o.tally?.set('screws', (o.tally.get('screws') ?? 0) + triangleCount(p[0]!.geometry));
        return p;
      });
    }
  });

  // ---- the live row ----
  const sockets: Record<string, Matrix4> = {};
  for (const j of SLICE_JACKS) {
    const x = BOARD.jackX[j]!, y = BOARD.jackY;
    liveJack(b, add, j, x, y, zPlate, R.range(0, 60), hi ? 16 : 12, seed + 30 + (j === 'lamp' ? 1 : 0));
    sockets[`jack.${j}`] = T(x, y, zPlate - 0.002 + JACK_MOUTH);
    const lx = x + BOARD.lampDX;
    lensLamp(b, add, j, lx, y, zPlate, R.range(0, 30), hi, seed + 34);
    sockets[`lamp.${j}`] = T(lx, y, zPlate + BEZEL_SEAT + 0.04);
  }
  for (const [i, x] of [0.06, 0.42].entries()) add(b, 'capped', place(cappedJack(hi, seed + 40 + i), aim([x, BOARD.jackY, zPlate - 0.002], [0, 0, 1], R.range(0, 60))));

  // ---- the tape over each pair ----
  for (const j of SLICE_JACKS) {
    const st = tapeRef(j);
    const ang = (j === 'storefront' ? 1 : -1) * R.range(0.6, 1.6);
    const x = BOARD.tapeX[j]! + R.spread(0.03);
    const y = BOARD.tapeY + R.spread(0.02);
    tapeStrip(b, add, st, chain(T(x, y, zPlate + 0.001), mat({ rot: [0, 0, ang] })), j === 'lamp');
    sockets[`label.${j}`] = T(x, y, zPlate + 0.005);
  }

  // ---- the dead field ----
  {
    const n = 12;
    const pitch = (plateW - 0.42) / (n - 1);
    const x0 = -((n - 1) / 2) * pitch;
    const yLamps = plateB.y0 + 0.11, yStrip = yLamps + 0.115, yJ1 = yStrip + 0.12;
    const missing = new Set([R.int(0, n - 1)]);
    const taped = new Set([(R.int(0, n - 1) + 3) % n, (R.int(0, n - 1) + 7) % n]);
    for (const k of missing) taped.delete(k);
    const lampG = bezel(0.058, hi, seed + 50, true);
    const lensG = lensPart(0.038, 6, false, seed + 51, true);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch + R.spread(0.006);
      add(b, 'dead', place(lampG, aim([x, yLamps, zPlate - 0.002], [0, 0, 1], R.range(0, 40))));
      add(b, 'dead', place([lensG], aim([x, yLamps, zPlate - 0.002 + 0.024], [0, 0, 1])));
    }
    // the designation strip: a paper card in a brass channel, ruled into cells
    add(b, 'dead', part('brass', bevelBox({ min: [x0 - 0.13, yStrip - 0.045, zPlate], max: [-x0 + 0.13, yStrip + 0.045, zPlate + 0.012], c: 0.006, omit: ['nz', 'ny'] }), 'brass', { seed: seed + 52, shade: 0.85 }));
    add(b, 'dead', part('paper', bevelBox({ min: [x0 - 0.115, yStrip - 0.03, zPlate + 0.012], max: [-x0 + 0.115, yStrip + 0.03, zPlate + 0.015], c: 0.0, omit: ['nz', 'ny', 'nx', 'px'] }), 'paper', { seed: seed + 53, shade: 0.92 }));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i - 0.5) * pitch;
      add(b, 'dead', part('brass', bevelBox({ min: [x - 0.006, yStrip - 0.03, zPlate + 0.012], max: [x + 0.006, yStrip + 0.03, zPlate + 0.018], c: 0, omit: ['nz', 'ny', 'py', 'nx', 'px'] }), 'brass', { seed: seed + 54 }));
    }
    const jg = smallJack(seed + 55);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch + R.spread(0.006);
      const y = yJ1;
      if (missing.has(i)) {
        add(b, 'dead', place(holeGeom(), aim([x, y, zPlate - 0.001], [0, 0, 1])));
        continue;
      }
      add(b, 'dead', place(jg, aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 36))));
      if (taped.has(i)) {
        const at = chain(T(x, y, zPlate + SMALL_MOUTH + 0.002), mat({ rot: [0, 0, R.spread(14)] }));
        add(b, 'dead', part('paper', transform(sheet({ w: 0.2, h: 0.07, t: 0.003, nx: 1, ny: 1 }), at), 'cable-red', { seed: seed + 56 + i, shade: 1.15 }));
      }
    }
  }

  // ---- the desk: drawers, kick plates, keyshelf fittings, the writing ledge ----
  for (const j of SLICE_JACKS) {
    // the G1 drawers drew three seeded numbers each (their cards): kept, so everything after stays where it was
    R.spread(0.02);
    R.spread(0.02);
    R.spread(0.02);
    drawer(b, add, j, BOARD.tapeX[j]!, BOARD.drawerY, BOARD.drawerZ, 1.0, 0.27, cardRef(j), { card: [0, 0.045], pull: [0, -0.075] }, seed + 60 + (j === 'lamp' ? 1 : 0), rng(seed + 160 + (j === 'lamp' ? 1 : 0)));
    sockets[`drawer.${j}`] = T(BOARD.tapeX[j]!, BOARD.drawerY - 0.075, BOARD.drawerZ + 0.06);
  }
  {
    const zD = 0.54;
    for (const [i, x] of [-1.15, 1.15].entries()) {
      const g = slab({ w: 1.5, d: 0.26, t: 0.018, r: 0.035, bevel: 0.007, detail: 'low', open: true, band: 0 });
      transform(g, chain(T(x + R.spread(0.02), 0.28, zD), askew(seed + 70 + i, 0.4), Z_UP));
      add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 72 + i, shade: 1.08 }));
      for (const dx of [-0.69, 0.69]) b.small(() => place([screw(0.016, 0.01, seed + 74, 0.9)], chain(T(x + dx, 0.28, zD + 0.018), Z_UP)));
    }
    const pg = slab({ w: 0.42, d: 0.13, t: 0.01, r: 0.018, bevel: 0.004, detail: 'low', open: true, band: 0 });
    transform(pg, chain(T(0, 0.3, zD + 0.002), askew(seed + 76, 1.5), Z_UP));
    add(b, 'fittings', setFinish(part('brass', pg, 'brass', { seed: seed + 77, warm: 0.04 }), 0.15));
    for (const dx of [-0.18, 0.18]) b.small(() => place([part('brass', stud(0.011, 0.007, 5), 'brass', { seed: seed + 78 })], chain(T(dx, 0.3, zD + 0.012), Z_UP)));
  }
  b.socket('cord.root', grommets(b, add, BOARD.cordRoot, yK, seed + 80));
  writingLedge(b, add, R, W / 2 - 0.45, yK, 0.33, 0.66, 0.5, seed + 85);

  for (const [k, m] of Object.entries(sockets)) b.socket(k, m);
  b.socket('stool', T(0.1, 0, 1.25));
  return withCleanSleeves(b.build());
}

// ============================================================================
// THE WHOLE BOARD (four live jacks, two reserved)
// ============================================================================

/**
 * A designation holder: a wooden wedge screwed to the plate, its face leaning
 * back TAPE_TILT so the tape on it looks up at the camera (the bench camera
 * looks down at about 36°: a vertical tape loses a sixth of its height to
 * that, a leaning one almost nothing). w wide, h up the slope, base at y0.
 * Returns the matrix of the face's centre (tape space: +Z out of the face).
 */
function holder(b: PieceBuilder, add: ReturnType<typeof adder>, x: number, y0: number, w: number, h: number, zPlate: number, R: Rng, seed: number): Matrix4 {
  const a = (TAPE_TILT * Math.PI) / 180;
  const H = h * Math.cos(a), D = h * Math.sin(a);
  // the profile in (z, y): back on the plate, the face from the proud bottom edge up and back
  const prof: Array<[number, number]> = [[0, 0], [D + 0.025, 0], [D + 0.025, 0.02], [0.012, H], [0, H]];
  const g = extrude(prof.map(([z, y]) => [-z, y] as [number, number]), w, { bevel: 0.008, bevelBase: 0, segs: 1, detail: 'low', radius: 0.004, band: 0 });
  // extruded along +Z from 0..w: turn it so the extrusion runs along +X and the profile's -z becomes +z
  transform(g, chain(T(x - w / 2, y0, zPlate), new Matrix4().makeRotationY(Math.PI / 2)));
  dent(g, [x + R.spread(w / 3), y0 + 0.01, zPlate + D], [0, -0.4, 1], 0.05, 0.006);
  add(b, 'holders', part('wood', g, 'wood', { seed, shade: 0.62, jitter: 0.05 }));
  // two brass screws in the face's top corners
  const face = chain(T(x, y0 + 0.02 / 2 + H / 2, zPlate + (D + 0.025 + 0.012) / 2), new Matrix4().makeRotationX(-a));
  for (const s of [-1, 1]) b.small(() => place([part('brass', stud(0.011, 0.006, 5), 'brass', { seed: seed + 1, shade: 0.85 })], chain(face, T(s * (w / 2 - 0.035), h / 2 - 0.035, 0.002), Z_UP)));
  return face;
}

/** A cheap chamfered block w × h × d standing on y = 0, centred in x and z (its back and bottom left open). */
function box(w: number, h: number, d: number, c: number) {
  return bevelBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], c, omit: ['ny', 'nz'] });
}

/** How far the whole board's designation holders lean back from vertical (degrees). */
export const TAPE_TILT = 22;

function buildWhole(o: SwitchboardOptions): Piece {
  const L = BOARD_WHOLE;
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed + 1000);
  const add = adder(o.tally);
  const b = piece('switchboard', { detail, seed });
  const W = L.w;
  const yK = L.shelfY;
  const zP = L.panelZ;
  const pt = L.plateT;
  const zPlate = zP + pt;
  const est = estimateLabels(TAPE_CAP_WHOLE);
  const tapeRef = (j: JackName): LabelRef => o.labels?.tape[j] ?? { key: '', ...est.tape[j] };
  const cardRef = (j: JackName): LabelRef => o.labels?.card[j] ?? { key: '', ...est.card[j] };
  const resRef: LabelRef = o.labels?.reserved ?? { key: '', ...est.reserved };
  const sockets: Record<string, Matrix4> = {};
  const plateW = W - 0.44;
  const zF = L.drawerZ; // the drawers' faces, flush under the keyshelf's edge
  const zD = zF - 0.07; // the desk body's face, under the drawers

  // ---- large form ----
  add(b, 'frame', part('wood', box(W - 0.12, 0.11, 0.78, 0.02), 'wood', { seed, shade: 0.33 }));
  {
    const d = zD + 0.42;
    const g = box(W - 0.24, L.drawerY - L.drawerH / 2 - 0.1, d, 0.025);
    transform(g, T(0, 0.1, zD - d / 2));
    dent(g, [-1.9 + R.spread(0.2), 0.18, zD], [0, 0, 1], 0.12, 0.012);
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 1, shade: 0.92, jitter: 0.03 }));
  }
  // the desk's wooden end panels, up to the keyshelf
  for (const s of [-1, 1]) {
    const g = box(0.16, yK - 0.085 - 0.08, zF + 0.44, 0.025);
    transform(g, T(s * (W / 2 - 0.08), 0.08, zF + 0.02 - (zF + 0.44) / 2));
    dent(g, [s * (W / 2), 0.5, zF], [s, 0, 1], 0.07, 0.012);
    add(b, 'frame', part('wood', grain(g, 'y'), 'wood', { seed: seed + 2 + s, jitter: 0.06, shade: 0.59 }));
  }
  // the drawer rail: a dark wooden board behind the drawers (seen in the gaps between them)
  add(b, 'frame', part('wood', bevelBox({ min: [-W / 2 + 0.16, L.drawerY - L.drawerH / 2 - 0.03, zD], max: [W / 2 - 0.16, yK - 0.085, zF - 0.04], c: 0.01, omit: ['nz'] }), 'wood', { seed: seed + 4, shade: 0.36 }));
  // the keyshelf: a thick plank with a rounded, hand-worn front edge, just proud of the drawers
  {
    const d = L.shelfZ + 0.12;
    const g = roundedBox({ w: W + 0.12, h: 0.085, d, r: 0.03, rTop: 0.035, rPlan: 0.05, segs: 2, detail: 'low', band: 0 });
    transform(g, T(0, yK - 0.085, L.shelfZ - d / 2));
    for (const x of [-1.4 + R.spread(0.2), 1.3 + R.spread(0.2)]) dent(g, [x, yK, L.shelfZ], [0, 1, 1], 0.32, 0.012);
    add(b, 'frame', part('wood', g, 'wood', { seed: seed + 5, jitter: 0.04, shade: 0.59 }));
  }
  const panelTop = L.top - 0.24;
  {
    const g = box(W - 0.3, panelTop - yK + 0.04, 0.5, 0.02);
    transform(g, T(0, yK - 0.02, zP - 0.25));
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 6, shade: 0.8, jitter: 0.03 }));
  }
  for (const s of [-1, 1]) {
    const g = roundedBox({ w: 0.2, h: panelTop - yK + 0.04, d: 0.6, r: 0.035, segs: 2, detail: 'low', band: 0 });
    transform(g, T(s * (W / 2 - 0.1), yK - 0.02, zP - 0.19));
    dent(g, [s * (W / 2 - 0.2), 1.5 + R.spread(0.3), zP + 0.11], [-s, 0, 1], 0.08, 0.014);
    dent(g, [s * (W / 2), 2.3 + R.spread(0.2), zP + 0.11], [s, 0, 1], 0.06, 0.01);
    add(b, 'frame', part('wood', grain(g, 'y'), 'wood', { seed: seed + 7 + s, jitter: 0.06, shade: 0.62 }));
  }
  add(b, 'frame', cornice(W, L.top, zP, hi, R, seed + 10));
  crestAndFinials(b, add, W, L.top, zP, hi, seed + 13);
  add(b, 'frame', part('wood', bevelBox({ min: [-W / 2 + 0.19, yK - 0.01, zP - 0.05], max: [W / 2 - 0.19, yK + 0.05, zP + 0.07], c: 0.015, omit: ['nz', 'ny'] }), 'wood', { seed: seed + 12, shade: 0.53 }));

  // ---- the plates: the dead row low, the live plate above it ----
  const plates = [
    { y0: yK + 0.065, y1: 1.245, s: 0.98 },
    { y0: 1.27, y1: panelTop - 0.02, s: 1.06 },
  ];
  // the designation holders' spans, so no screw lands under one
  const holderW = (j: JackName): number => tapeRef(j).w + 0.1;
  const holderH = (j: JackName): number => tapeRef(j).h + 0.06;
  const holderY = (j: JackName): number => (L.tapeRow[j] === 'high' ? L.holderHighY : L.holderLowY);
  const tapeX = (j: JackName): number => tapeCentreX(j, holderW(j), plateW);
  plates.forEach((pl, i) => {
    const h = pl.y1 - pl.y0;
    const g = slab({ w: plateW, d: h, t: pt, r: 0.05, bevel: 0.011, detail: 'low', open: true, band: 0 });
    transform(g, chain(T(R.spread(0.01), (pl.y0 + pl.y1) / 2, zP), askew(seed + 20 + i, 0.25), Z_UP));
    dent(g, [-plateW / 2 + 0.3 + R.range(0, 1.6), pl.y1, zPlate], [0, 1, 1], 0.07, 0.009);
    dent(g, [plateW / 2 - 0.2 - R.range(0, 1.8), pl.y0, zPlate], [0, -1, 1], 0.06, 0.008);
    add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 22 + i, shade: pl.s, jitter: 0.03 }));
    const xs = [-plateW / 2 + 0.06, -plateW / 4, 0, plateW / 4, plateW / 2 - 0.06];
    const covered = (x: number, y: number): boolean => JACKS.some((j) => Math.abs(x - tapeX(j)) < holderW(j) / 2 + 0.05 && y > holderY(j) - 0.05 && y < holderY(j) + holderH(j) + 0.05);
    for (const x of xs) for (const y of [pl.y0 + 0.05, pl.y1 - 0.05]) {
      if (covered(x, y)) continue;
      // the live plate's lower edge runs along the jack row: only its corner screws
      if (i === 1 && y < pl.y0 + 0.1 && Math.abs(x) < plateW / 2 - 0.1) continue;
      const sd = R.int(0, 999);
      const sp = R.range(0, 60);
      b.small(() => place([screw(0.02, 0.011, sd)], aim([x, y, zPlate - 0.002], [0, 0, 1], sp)));
    }
  });

  // ---- the live row ----
  for (const j of JACKS) {
    const x = L.jackX[j], y = L.jackY;
    liveJack(b, add, j, x, y, zPlate, R.range(0, 60), hi ? 14 : 12, seed + 30 + JACKS.indexOf(j));
    sockets[`jack.${j}`] = T(x, y, zPlate - 0.002 + JACK_MOUTH);
    const lx = x + L.lampDX;
    lensLamp(b, add, j, lx, y, zPlate, R.range(0, 30), hi, seed + 34 + JACKS.indexOf(j) * 4);
    sockets[`lamp.${j}`] = T(lx, y, zPlate + BEZEL_SEAT + 0.04);
  }
  // the two reserved positions at the row's left end, capped, under one strip of red RESERVED tape
  for (const [i, x] of L.capped.entries()) add(b, 'capped', place(cappedJack(hi, seed + 40 + i), aim([x, L.jackY, zPlate - 0.002], [0, 0, 1], R.range(0, 60))));
  {
    const cx = (L.capped[0] + L.capped[1]) / 2 + R.spread(0.02);
    tapeStrip(b, add, resRef, chain(T(cx, L.jackY + R.spread(0.015), zPlate + 0.079), mat({ rot: [0, 0, 3 + R.spread(1.5)] })), false, 'capped');
  }

  // ---- the tapes, each on its own leaning holder over its jack, in two rows ----
  for (const j of JACKS) {
    const st = tapeRef(j);
    const x = tapeX(j);
    const face = holder(b, add, x, holderY(j), holderW(j), holderH(j), zPlate, R, seed + 100 + JACKS.indexOf(j) * 3);
    const ang = ({ storefront: 1, platen: -1, belt: 1, lamp: -1 } as const)[j] * R.range(0.4, 1.2);
    const at = chain(face, T(R.spread(0.015), R.spread(0.008), 0.003), mat({ rot: [0, 0, ang] }));
    tapeStrip(b, add, st, at, false);
    sockets[`label.${j}`] = chain(face, T(0, 0, 0.007));
  }

  // ---- the dead row: small jacks under the live row, one missing, two taped over ----
  {
    const n = 14;
    const pitch = (plateW - 0.36) / (n - 1);
    const x0 = -((n - 1) / 2) * pitch;
    const y = (plates[0]!.y0 + plates[0]!.y1) / 2 + 0.005;
    const missing = new Set([R.int(2, n - 3)]);
    const taped = new Set([(R.int(0, n - 1) + 4) % n, (R.int(0, n - 1) + 9) % n]);
    for (const k of missing) taped.delete(k);
    const jg = smallJack(seed + 55);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch + R.spread(0.006);
      if (missing.has(i)) {
        add(b, 'dead', place(holeGeom(), aim([x, y, zPlate - 0.001], [0, 0, 1])));
        continue;
      }
      add(b, 'dead', place(jg, aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 36))));
      if (taped.has(i)) {
        const at = chain(T(x, y, zPlate + SMALL_MOUTH + 0.002), mat({ rot: [0, 0, R.spread(14)] }));
        add(b, 'dead', part('paper', transform(sheet({ w: 0.2, h: 0.07, t: 0.003, nx: 1, ny: 1 }), at), 'cable-red', { seed: seed + 56 + i, shade: 1.15 }));
      }
    }
  }

  // ---- the drawers: one per line, flush under the keyshelf ----
  for (const j of JACKS) {
    const x = L.drawerX[j];
    drawer(b, add, j, x, L.drawerY, zF, L.drawerW, L.drawerH, cardRef(j), { card: [-0.2, 0.01], pull: [0.17, 0.03] }, seed + 60 + JACKS.indexOf(j) * 7, rng(seed + 160), 1.0);
    sockets[`drawer.${j}`] = T(x + 0.17, L.drawerY + 0.03 - 0.02, zF + 0.06);
  }
  // under the reserved positions, a blank front with no pull: nothing in there yet
  {
    const x0 = -W / 2 + 0.18, x1 = L.drawerX.storefront - L.drawerW / 2 - 0.025;
    add(b, 'drawers', part('wood', bevelBox({ min: [x0, L.drawerY - L.drawerH / 2, zF - 0.05], max: [x1, L.drawerY + L.drawerH / 2, zF], c: 0.014, omit: ['nz'] }), 'wood', { seed: seed + 59, shade: 0.8, jitter: 0.05 }));
  }
  // the kick plates on the desk front, and a blank brass maker's plate between them
  {
    const ky = (0.11 + L.drawerY - L.drawerH / 2 - 0.03) / 2;
    for (const [i, x] of [-1.35, 1.35].entries()) {
      const g = slab({ w: 1.9, d: 0.22, t: 0.018, r: 0.035, bevel: 0.007, detail: 'low', open: true, band: 0 });
      transform(g, chain(T(x + R.spread(0.02), ky, zD), askew(seed + 70 + i, 0.4), Z_UP));
      add(b, 'body', part('steel', g, 'teal-panel', { seed: seed + 72 + i, shade: 1.08 }));
      for (const dx of [-0.88, 0.88]) b.small(() => place([screw(0.016, 0.01, seed + 74, 0.9)], chain(T(x + dx, ky, zD + 0.018), Z_UP)));
    }
    const pg = slab({ w: 0.42, d: 0.13, t: 0.01, r: 0.018, bevel: 0.004, detail: 'low', open: true, band: 0 });
    transform(pg, chain(T(0, ky, zD + 0.002), askew(seed + 76, 1.5), Z_UP));
    add(b, 'fittings', setFinish(part('brass', pg, 'brass', { seed: seed + 77, warm: 0.04 }), 0.15));
  }
  b.socket('cord.root', grommets(b, add, L.cordRoot, yK, seed + 80));
  writingLedge(b, add, R, W / 2 - 0.42, yK, 0.24, 0.56, 0.4, seed + 85);

  // ---- the stool's runner: a plank on the bench with two brass rails, stops at both ends ----
  {
    const r = L.runner;
    const len = r.x1 - r.x0, cx = (r.x0 + r.x1) / 2;
    const plank = box(len, 0.04, 0.66, 0.012);
    transform(plank, T(cx, 0, r.z));
    dent(plank, [cx + R.spread(1.5), 0.04, r.z + 0.33], [0, 1, 1], 0.12, 0.01);
    add(b, 'runner', part('wood', plank, 'wood', { seed: seed + 90, shade: 0.5, jitter: 0.05 }));
    for (const dz of [-r.gauge / 2, r.gauge / 2]) {
      add(b, 'runner', setFinish(part('brass', bevelBox({ min: [r.x0 + 0.04, 0.04, r.z + dz - 0.022], max: [r.x1 - 0.04, r.top, r.z + dz + 0.022], c: 0.006, omit: ['ny', 'nx', 'px'] }), 'brass', { seed: seed + 91, warm: 0.03 }), 0.75));
    }
    for (const x of [r.x0 + 0.08, r.x1 - 0.08]) {
      add(b, 'runner', part('brass', bevelBox({ min: [x - 0.035, 0.04, r.z - 0.3], max: [x + 0.035, 0.1, r.z + 0.3], c: 0.012, omit: ['ny'] }), 'brass', { seed: seed + 92, shade: 0.85 }));
    }
    b.socket('stool', T(L.stoolRestX, r.top, r.z));
    for (const j of JACKS) b.socket(`stool.${j}`, T(L.jackX[j] + L.stoolDX, r.top, r.z));
  }

  for (const [k, m] of Object.entries(sockets)) b.socket(k, m);
  return withCleanSleeves(b.build());
}

/**
 * Where a tape's holder is centred on the whole board: over its jack, nudged in
 * only as far as the plate's edge needs.
 */
export function tapeCentreX(j: JackName, w: number, plateW = BOARD_WHOLE.w - 0.44): number {
  const m = 0.03;
  const x = BOARD_WHOLE.jackX[j];
  return Math.max(-plateW / 2 + m + w / 2, Math.min(plateW / 2 - m - w / 2, x));
}
