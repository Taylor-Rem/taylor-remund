/**
 * The switchboard slice (REWRITE.md § B2 X1, § B5 "Patch"; art-direction
 * § 10 SWITCHBOARD). Registry name `switchboard`.
 *
 * A teal enamel cabinet standing in a worn wood frame: a dark plinth, a
 * low desk with two drawers under a deep wooden keyshelf, and above it the
 * jack panel between two wooden stiles under a moulded cornice. The panel
 * is two screwed-on enamel plates: the lower one carries the two big live
 * jacks (STOREFRONT, LAMP), each a brass escutcheon with a knurled rim and
 * a black fibre bore, with a faceted lens lamp in a brass bezel beside it
 * and its label tape below; between them two capped positions. The upper
 * plate is the dead field: a row of dark lamps over a paper designation
 * strip and two rows of small jacks, a few missing or taped over.
 * The keyshelf has brass cord grommets (the cord rises from one) and a
 * small slanted writing ledge with a pad and a pencil.
 *
 * Origin: the floor at the centre of the frame; +Z toward the visitor. The
 * jack panel's face is the plane z = 0.
 *
 * Moving nodes:
 *  - `lamp.storefront`, `lamp.lamp`: the live lens lamps (`bulb` class,
 *    dark by default; `poseSwitchboard` lights them).
 *  - `drawer.storefront`, `drawer.lamp`: the drawers. Each node's local +X
 *    points out of the board (world +Z); the drawer slides along it.
 * Sockets: `jack.storefront`, `jack.lamp` (the jack mouth, +Z out of the
 * bore: a seated plug's `seat` goes here), `lamp.storefront`, `lamp.lamp`
 * (the lens centre), `label.storefront`, `label.lamp` (the tape centre),
 * `cord.root` (where the cord's fixed end rises out of the keyshelf, +Y
 * up), `stool` (where Patch's stool stands on the bench).
 */
import { Matrix4 } from 'three';
import type { KitOptions, KitPart, Piece } from '../../types.ts';
import { extrude, lathe, profiledBox, roundedBox, slab } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { aim, chain, mat, part, piece, place, texturedPart, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { dent, transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { bevelBox, ridgedBand, sheet, stud } from '../../cheap.ts';
import { estimateLabels, JACKS } from './labels.ts';
import type { JackName, SwitchboardLabelRefs } from './labels.ts';
import { NAMED_POSES, POSE, poseSwitchboard } from './pose.ts';
import type { SwitchboardPose } from './pose.ts';

/** The board's layout, shared with the tests, the pose helper and the view. */
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
  /** The live row: jack centres (x), their height, and the lens lamp's offset from its jack. */
  jackX: { storefront: -1.0, lamp: 1.04 } as Record<JackName, number>,
  jackY: 1.6,
  lampDX: 0.4,
  /** The tape centre under each jack pair. */
  tapeX: { storefront: -0.78, lamp: 1.26 } as Record<JackName, number>,
  tapeY: 1.2,
  /** Drawer centres (x), the drawers' front face (z) and how far a drawer pulls out. */
  drawerY: 0.65,
  drawerZ: 0.6,
  /** Where the cord rises out of the keyshelf. */
  cordRoot: [0.04, 0.89, 0.34] as [number, number, number],
} as const;

export interface SwitchboardOptions extends KitOptions {
  /** Label refs from `switchboardLabels(labels)`. Without them the tape and cards are blank (clay reviews, tests). */
  labels?: SwitchboardLabelRefs;
  /** Build already posed (a name from NAMED_POSES, or a pose). Lamps dark and drawers shut is the default. */
  pose?: string | SwitchboardPose;
}


const Z_UP = new Matrix4().makeRotationX(Math.PI / 2); // a slab lying in XZ turned to face +Z

export function switchboard(o: SwitchboardOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('switchboard', { detail, seed });
  const W = BOARD.w;
  const yK = BOARD.shelfY;
  const zP = BOARD.panelZ;
  const pt = BOARD.plateT;
  const zPlate = zP + pt; // the plates' face

  // ======================================================================
  // LARGE FORM: plinth, desk, keyshelf, panel body, stiles, cornice
  // ======================================================================
  // the plinth: a dark kick board, set back under the desk
  b.add(part('wood', roundedBox({ w: W - 0.12, h: 0.11, d: 1.0, r: 0.02, segs: 2, detail, band: 0 }), 'wood', { seed, shade: 0.33 }));
  // the desk's enamel body (its front shows between the end panels, below the drawers)
  {
    const g = roundedBox({ w: W - 0.24, h: 0.72, d: 1.04, r: 0.03, rPlan: 0.03, segs: 3, detail, band: 0 });
    transform(g, T(0, 0.1, 0.02));
    dent(g, [-1.6 + R.spread(0.2), 0.16, 0.54], [0, 0, 1], 0.12, 0.012);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 1, shade: 0.92, jitter: 0.03 }));
  }
  // the desk's wooden end panels
  for (const s of [-1, 1]) {
    const g = roundedBox({ w: 0.16, h: 0.74, d: 1.12, r: 0.03, detail, band: 0 });
    transform(g, T(s * (W / 2 - 0.08), 0.08, 0.04));
    dent(g, [s * (W / 2), 0.55, 0.6], [s, 0, 1], 0.07, 0.012);
    b.add(part('wood', grain(g, 'y'), 'wood', { seed: seed + 2 + s, jitter: 0.06, shade: 0.59 }));
  }
  // the drawer rail: a wooden face board across the desk's top
  b.add(part('wood', bevelBox({ min: [-W / 2 + 0.16, 0.49, 0.5], max: [W / 2 - 0.16, 0.81, 0.575], c: 0.012, band: 0.02, omit: ['nz'] }), 'wood', { seed: seed + 4, shade: 0.53 }));
  // the keyshelf: a thick plank with a rounded, hand-worn front edge
  {
    const g = roundedBox({ w: W + 0.12, h: 0.085, d: 0.82, r: 0.03, rTop: 0.035, rPlan: 0.05, detail });
    transform(g, T(0, yK - 0.085, (BOARD.shelfZ - 0.12) / 2));
    // the front edge is worn down where elbows rest
    for (const x of [-0.9 + R.spread(0.2), 0.9 + R.spread(0.2)]) dent(g, [x, yK, BOARD.shelfZ], [0, 1, 1], 0.32, 0.012);
    b.add(part('wood', g, 'wood', { seed: seed + 5, jitter: 0.04, shade: 0.59 }));
  }
  // the panel's enamel body
  {
    const g = roundedBox({ w: W - 0.3, h: 1.74, d: 0.5, r: 0.03, segs: 2, detail, band: 0 });
    transform(g, T(0, yK - 0.02, zP - 0.25));
    b.add(part('steel', g, 'teal-panel', { seed: seed + 6, shade: 0.8, jitter: 0.03 }));
  }
  // the stiles: two posts with chamfered fronts, knocked about
  for (const s of [-1, 1]) {
    const g = roundedBox({ w: 0.2, h: 1.76, d: 0.6, r: 0.035, segs: 3, detail, band: 0 });
    transform(g, T(s * (W / 2 - 0.1), yK - 0.02, zP - 0.19));
    dent(g, [s * (W / 2 - 0.2), 1.3 + R.spread(0.3), zP + 0.11], [-s, 0, 1], 0.08, 0.014);
    dent(g, [s * (W / 2), 2.2 + R.spread(0.2), zP + 0.11], [s, 0, 1], 0.06, 0.01);
    b.add(part('wood', grain(g, 'y'), 'wood', { seed: seed + 7 + s, jitter: 0.06, shade: 0.62 }));
  }
  // the cornice: a moulded crown (cove and bead) over everything
  {
    const r = 0.08;
    const pr = profile(0, 0)
      .to(r - 0.07, 0, { sharp: true })
      .to(r - 0.07, 0.03, { fillet: 0.01 })
      .arc(r - 0.005, 0.12, -0.18, hi ? 5 : 3)
      .to(r - 0.005, 0.135, { sharp: true })
      .to(r + 0.02, 0.15, { fillet: 0.01 })
      .to(r + 0.02, 0.21, { fillet: 0.02 })
      .to(r - 0.01, 0.24, { fillet: 0.012 })
      .to(0, 0.24);
    const g = profiledBox({ w: W + 0.16, d: 0.8, rPlan: r, detail }, pr);
    transform(g, T(0, BOARD.top - 0.24, zP - 0.19));
    dent(g, [1.2 + R.spread(0.4), BOARD.top - 0.05, zP + 0.23], [0, 0.4, 1], 0.1, 0.012);
    b.add(part('wood', g, 'wood', { seed: seed + 10, jitter: 0.04, shade: 0.59 }));
  }
  // the crest: an arched board standing on the cornice, carrying the board's master lamp in a big brass bezel
  {
    const cw = 1.7, ch = 0.3;
    const outline: Array<[number, number]> = [[-cw / 2, 0], [cw / 2, 0], [cw / 2, 0.05]];
    const n = hi ? 10 : 6;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = cw / 2 - t * cw;
      // a flattened ogee: shoulders, then a round crown
      const u = Math.abs(x) / (cw / 2);
      outline.push([x, 0.05 + (ch - 0.05) * Math.pow(Math.cos((u * Math.PI) / 2), 0.7)]);
    }
    outline.push([-cw / 2, 0.05]);
    const g = extrude(outline, 0.09, { bevel: 0.018, bevelBase: 0.018, segs: 2, detail, radius: 0.02 });
    transform(g, T(0, BOARD.top - 0.01, zP - 0.12));
    dent(g, [0.5, BOARD.top + 0.17, zP - 0.03], [0.5, 1, 1], 0.07, 0.01);
    b.add(part('wood', g, 'wood', { seed: seed + 13, jitter: 0.04, shade: 0.64 }));
    const mAt = aim([0, BOARD.top + 0.15, zP - 0.03], [0, 0, 1], 12);
    b.add(place(bezel(0.11, detail, seed + 14), mAt));
    b.add(place([lensPart(0.068, hi ? 10 : 8, 'glass', seed + 15)], chain(mAt, T(0, BEZEL_SEAT, 0))));
    for (const sx of [-1, 1]) b.small(() => place([part('brass', stud(0.014, 0.009, 6), 'brass', { seed: seed + 16 })], chain(T(sx * 0.62, BOARD.top + 0.06, zP - 0.03), Z_UP)));
  }
  // turned finials on the stiles' tops, above the cornice's corners
  for (const s of [-1, 1]) {
    const g = lathe(
      profile(0, 0).to(0.05, 0, { sharp: true }).to(0.05, 0.02, { fillet: 0.008, segs: 1 }).to(0.032, 0.04, { fillet: 0.01, segs: 1 }).to(0.026, 0.06, { smooth: true }).curve(0.058, 0.11, 0.06, 0.07, 3).curve(0, 0.17, 0.05, 0.16, 3),
      { segs: hi ? 12 : 8, detail, band: 0 },
    );
    b.add(part('wood', transform(g, T(s * (W / 2 + 0.0), BOARD.top, zP + 0.08)), 'wood', { seed: seed + 17 + s, shade: 0.65 }));
  }
  // a wooden rail under the cornice and a sill above the keyshelf, closing the panel's frame
  b.add(part('wood', bevelBox({ min: [-W / 2 + 0.19, BOARD.top - 0.34, zP - 0.05], max: [W / 2 - 0.19, BOARD.top - 0.235, zP + 0.07], c: 0.015, omit: ['nz'] }), 'wood', { seed: seed + 11, shade: 0.56 }));
  b.add(part('wood', bevelBox({ min: [-W / 2 + 0.19, yK - 0.01, zP - 0.05], max: [W / 2 - 0.19, yK + 0.05, zP + 0.07], c: 0.015, omit: ['nz', 'ny'] }), 'wood', { seed: seed + 12, shade: 0.53 }));

  // ======================================================================
  // MEDIUM: the two enamel plates, screwed on, a little off true
  // ======================================================================
  const plateA = { y0: yK + 0.07, y1: 1.86 };
  const plateB = { y0: 1.9, y1: BOARD.top - 0.355 };
  const plateW = W - 0.44;
  const plates: Array<{ y0: number; y1: number; s: number }> = [{ ...plateA, s: 1.06 }, { ...plateB, s: 0.98 }];
  plates.forEach((pl, i) => {
    const h = pl.y1 - pl.y0;
    const g = slab({ w: plateW, d: h, t: pt, r: 0.05, bevel: 0.011, detail, open: true });
    const M = chain(T(R.spread(0.01), (pl.y0 + pl.y1) / 2, zP), askew(seed + 20 + i, 0.25), Z_UP);
    transform(g, M);
    // knocks along the edges, where things were dropped
    dent(g, [-plateW / 2 + 0.3 + R.range(0, 1.2), pl.y1, zPlate], [0, 1, 1], 0.07, 0.009);
    dent(g, [plateW / 2 - 0.2 - R.range(0, 1.4), pl.y0, zPlate], [0, -1, 1], 0.06, 0.008);
    b.add(part('steel', g, 'teal-panel', { seed: seed + 22 + i, shade: pl.s, jitter: 0.03 }));
    // slotted screws at the corners and along the long edges
    const xs = [-plateW / 2 + 0.06, -plateW / 6, plateW / 6, plateW / 2 - 0.06];
    for (const x of xs) for (const y of [pl.y0 + 0.05, pl.y1 - 0.05]) {
      const sd = R.int(0, 999);
      b.small(() => place([part('metal', stud(0.02, 0.011, 6), 'steel', { seed: sd, shade: 0.85, jitter: 0.08 })], aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 60))));
    }
  });

  // ---- the live row ------------------------------------------------------
  const jackSockets: Record<string, Matrix4> = {};
  for (const j of JACKS) {
    const x = BOARD.jackX[j], y = BOARD.jackY;
    const at = aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 60));
    b.add(place(bigJack(detail, seed + 30 + (j === 'lamp' ? 1 : 0)), at));
    jackSockets[`jack.${j}`] = T(x, y, zPlate - 0.002 + JACK_MOUTH);
    // the lens lamp: a brass bezel (fixed) round a faceted lens (its own node, to be lit)
    const lx = x + BOARD.lampDX;
    const lat = aim([lx, y, zPlate - 0.002], [0, 0, 1], R.range(0, 30));
    b.add(place(bezel(0.115, detail, seed + 34), lat));
    const lamp = b.node(`lamp.${j}`, aim([lx, y, zPlate - 0.002 + BEZEL_SEAT], [0, 0, 1]));
    lamp.add(lensPart(0.072, hi ? 10 : 8, 'bulb', seed + 36));
    jackSockets[`lamp.${j}`] = T(lx, y, zPlate + BEZEL_SEAT + 0.04);
  }
  // two capped positions between them: future jacks, a brass blank in each
  for (const [i, x] of [0.06, 0.42].entries()) {
    const at = aim([x, BOARD.jackY, zPlate - 0.002], [0, 0, 1], R.range(0, 60));
    b.add(place(cappedJack(detail, seed + 40 + i), at));
  }

  // ---- the tape under each pair ----------------------------------------------
  {
    const est = estimateLabels();
    for (const j of JACKS) {
      const st = o.labels ? o.labels.tape[j] : { key: '', ...est.tape[j] };
      const ang = (j === 'storefront' ? 1 : -1) * R.range(0.6, 1.6);
      const x = BOARD.tapeX[j] + R.spread(0.03);
      const y = BOARD.tapeY + R.spread(0.02);
      const lifting = j === 'lamp';
      const lift = lifting ? (u: number, v: number) => 0.035 * Math.pow(Math.max(0, (u - 0.86) / 0.14), 2) * Math.max(0, 1 - v * 0.85) : () => 0;
      const at = chain(T(x, y, zPlate + 0.001), mat({ rot: [0, 0, ang] }));
      const face = transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: lifting ? 8 : 1, ny: lifting ? 2 : 1 }), at);
      if (o.labels && st.key) b.add(texturedPart('tape', face, st.key));
      else b.add(part('tape', face, 'ink'));
      if (lifting) b.add(part('tape', transform(sheet({ w: st.w, h: st.h, t: 0.004, lift, nx: 8, ny: 2, back: true }), at), 'ink', { shade: 0.8 }));
      jackSockets[`label.${j}`] = T(x, y, zPlate + 0.005);
    }
  }

  // ---- the dead field ----------------------------------------------------------
  {
    const n = 12;
    const pitch = (plateW - 0.42) / (n - 1);
    const x0 = -((n - 1) / 2) * pitch;
    const yLamps = plateB.y0 + 0.11, yStrip = yLamps + 0.115, yJ1 = yStrip + 0.12, yJ2 = yJ1 + 0.19;
    const missing = new Set([R.int(0, n - 1) + n, R.int(0, n - 1)]);
    const taped = new Set([R.int(0, n - 1), R.int(0, n - 1) + n]);
    const lampG = bezel(0.058, detail, seed + 50, true);
    const lensG = lensPart(0.038, 6, 'glass', seed + 51, true);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch + R.spread(0.006);
      b.add(place(lampG, aim([x, yLamps, zPlate - 0.002], [0, 0, 1], R.range(0, 40))));
      b.add(place([lensG], aim([x, yLamps, zPlate - 0.002 + 0.024], [0, 0, 1])));
    }
    // the designation strip: a paper card in a brass channel, ruled into cells
    b.add(part('brass', bevelBox({ min: [x0 - 0.13, yStrip - 0.045, zPlate], max: [-x0 + 0.13, yStrip + 0.045, zPlate + 0.012], c: 0.006, omit: ['nz'] }), 'brass', { seed: seed + 52, shade: 0.85 }));
    b.add(part('paper', bevelBox({ min: [x0 - 0.115, yStrip - 0.03, zPlate + 0.012], max: [-x0 + 0.115, yStrip + 0.03, zPlate + 0.015], c: 0.0, omit: ['nz'] }), 'paper', { seed: seed + 53, shade: 0.92 }));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i - 0.5) * pitch;
      b.add(part('brass', bevelBox({ min: [x - 0.006, yStrip - 0.03, zPlate + 0.012], max: [x + 0.006, yStrip + 0.03, zPlate + 0.018], omit: ['nz', 'ny', 'py'] }), 'brass', { seed: seed + 54 }));
    }
    const jg = smallJack(detail, seed + 55);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const k = row * n + i;
        const x = x0 + i * pitch + R.spread(0.006);
        const y = row === 0 ? yJ1 : yJ2;
        if (missing.has(k)) {
          // a bare hole where a jack was taken out: the plate's bore and two empty screw holes
          b.add(place(holeGeom(detail), aim([x, y, zPlate - 0.001], [0, 0, 1])));
          continue;
        }
        b.add(place(jg, aim([x, y, zPlate - 0.002], [0, 0, 1], R.range(0, 36))));
        if (taped.has(k)) {
          // taped over: a short strip of red tape across the mouth
          const at = chain(T(x, y, zPlate + SMALL_MOUTH + 0.002), mat({ rot: [0, 0, R.spread(14)] }));
          b.add(part('tape', transform(sheet({ w: 0.2, h: 0.07, t: 0.003, nx: 1, ny: 1 }), at), 'cable-red', { seed: seed + 56 + k, shade: 1.15 }));
        }
      }
    }
  }

  // ======================================================================
  // THE DESK: drawers, kick plates, keyshelf fittings, the writing ledge
  // ======================================================================
  for (const j of JACKS) {
    const x = BOARD.tapeX[j];
    const card = o.labels ? o.labels.card[j] : { key: '', ...estimateLabels().card[j] };
    const d = b.node(`drawer.${j}`, chain(T(x, BOARD.drawerY, BOARD.drawerZ), new Matrix4().makeRotationY(-Math.PI / 2)));
    // built in board orientation (+Z out) about the drawer's pivot, then turned into the node's frame
    const toNode = new Matrix4().makeRotationY(Math.PI / 2);
    const parts: KitPart[] = [];
    const dw = 1.0, dh = 0.27;
    const front = slab({ w: dw, d: dh, t: 0.05, r: 0.025, bevel: 0.014, detail, open: true });
    transform(front, chain(T(0, 0, -0.05), Z_UP));
    parts.push(part('wood', front, 'wood', { seed: seed + 60 + (j === 'lamp' ? 1 : 0), shade: 0.7, jitter: 0.05 }));
    // the drawer itself behind the front: two sides and a floor of pale deal, and a stack of index cards in it
    {
      const L = 0.5, z0 = -0.05 - L, sh = dh - 0.07, y0 = -dh / 2 + 0.03;
      for (const sx of [-1, 1]) parts.push(part('wood', bevelBox({ min: [sx * (dw / 2 - 0.05) - 0.012, y0, z0], max: [sx * (dw / 2 - 0.05) + 0.012, y0 + sh, -0.05], c: 0.004, omit: ['nz', 'pz', 'ny'] }), 'wood-light', { seed: seed + 65, shade: 0.7 }));
      parts.push(part('wood', bevelBox({ min: [-dw / 2 + 0.05, y0, z0], max: [dw / 2 - 0.05, y0 + 0.015, -0.05], omit: ['nz', 'pz', 'ny', 'nx', 'px'] }), 'wood-light', { seed: seed + 66, shade: 0.45 }));
      for (let k = 0; k < 3; k++) {
        const cz = -0.12 - k * 0.11 + R.spread(0.02);
        parts.push(part('paper', transform(bevelBox({ min: [-0.33, 0, -0.004], max: [0.33, sh * 0.85, 0.004], omit: ['nz', 'ny', 'nx', 'px'] }), chain(T(R.spread(0.03), y0 + 0.015, cz), mat({ rot: [-12 - k * 4, 0, R.spread(2)] }))), 'paper', { seed: seed + 67 + k, shade: 0.85 - k * 0.05 }));
      }
    }
    // the brass card holder and its card
    const hy = 0.045;
    const cw = card.w, ch = card.h;
    const holder = extrude(
      [[-cw / 2 - 0.022, -ch / 2 - 0.02], [cw / 2 + 0.022, -ch / 2 - 0.02], [cw / 2 + 0.022, ch / 2 + 0.008], [-cw / 2 - 0.022, ch / 2 + 0.008]],
      0.012,
      { holes: [[[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2 + 0.03], [-cw / 2, ch / 2 + 0.03]]], radius: 0.008, holeRadius: 0.003, bevel: 0.004, bevelBase: 0, caps: 'end', segs: 1, detail: 'low', band: 0 },
    );
    transform(holder, T(0, hy, 0));
    parts.push(setFinish(part('brass', holder, 'brass', { seed: seed + 62, warm: 0.03 }), 0.2));
    const cardG = transform(sheet({ w: cw, h: ch, t: 0.002, nx: 1, ny: 1 }), T(0, hy, 0.002));
    if (o.labels && card.key) parts.push(texturedPart('paper', cardG, card.key));
    else parts.push(part('paper', cardG, 'paper'));
    for (const sx of [-1, 1]) parts.push(part('brass', transform(stud(0.009, 0.006, 5), chain(T(sx * (cw / 2 + 0.012), hy - ch / 2 - 0.008, 0.012), Z_UP)), 'brass', { seed: seed + 63 }));
    // the cup pull under it
    parts.push(...cupPull(detail, seed + 64, -0.075));
    d.add(place(parts, toNode));
  }
  // the kick plates on the desk front, below the drawers, and a blank brass maker's plate
  {
    const zD = 0.54;
    for (const [i, x] of [-1.15, 1.15].entries()) {
      const g = slab({ w: 1.5, d: 0.26, t: 0.018, r: 0.035, bevel: 0.007, detail, open: true, band: 0 });
      transform(g, chain(T(x + R.spread(0.02), 0.28, zD), askew(seed + 70 + i, 0.4), Z_UP));
      b.add(part('steel', g, 'teal-panel', { seed: seed + 72 + i, shade: 1.08 }));
      for (const dx of [-0.69, 0.69]) b.small(() => place([part('metal', stud(0.016, 0.01, 6), 'steel', { seed: seed + 74, shade: 0.9 })], chain(T(x + dx, 0.28, zD + 0.018), Z_UP)));
    }
    const pg = slab({ w: 0.42, d: 0.13, t: 0.01, r: 0.018, bevel: 0.004, detail, open: true, band: 0 });
    transform(pg, chain(T(0, 0.3, zD + 0.002), askew(seed + 76, 1.5), Z_UP));
    b.add(setFinish(part('brass', pg, 'brass', { seed: seed + 77, warm: 0.04 }), 0.15));
    for (const dx of [-0.18, 0.18]) b.small(() => place([part('brass', stud(0.011, 0.007, 6), 'brass', { seed: seed + 78 })], chain(T(dx, 0.3, zD + 0.012), Z_UP)));
  }
  // the keyshelf's cord grommets: the cord rises from the middle one; the others are empty
  {
    const root = BOARD.cordRoot;
    for (const dx of [-0.36, 0, 0.36]) {
      const g = lathe(
        profile(0.034, -0.03).to(0.034, 0.004, { sharp: true }).to(0.06, 0.004, { fillet: 0.004, segs: 1 }).to(0.062, 0.012, { fillet: 0.004, segs: 1 }).to(0.046, 0.016, { fillet: 0.006, segs: 1 }).to(0.034, 0.008),
        { segs: hi ? 10 : 8, caps: false, detail, band: 0 },
      );
      b.add(setFinish(part('brass', transform(g, T(root[0] + dx, yK, root[2])), 'brass', { seed: seed + 80 }), 0.35));
      b.add(part('rubber', transform(lathe(profile(0, -0.03).to(0.034, -0.03).to(0.034, -0.025).to(0, -0.025), { segs: 8, caps: false, band: 0 }), T(root[0] + dx, yK, root[2])), 'ink', { shade: 0.6 }));
    }
    // the cord's own ferrule standing in the middle grommet
    const fer = lathe(profile(0.044, 0).to(0.044, 0.035, { fillet: 0.006, segs: 1 }).to(0.036, 0.06, { fillet: 0.008, segs: 1 }).to(0, 0.062), { segs: hi ? 14 : 10, caps: 'end', detail, band: 0 });
    b.add(setFinish(part('brass', transform(fer, T(root[0], yK + 0.004, root[2])), 'brass', { seed: seed + 81 }), 0.5));
    b.socket('cord.root', T(root[0], yK + 0.066, root[2]));
  }
  // the writing ledge: a slanted board on the keyshelf's right end, a pad and a pencil on it
  {
    const lx = W / 2 - 0.45, lz = 0.33, tilt = 12;
    const ledge = chain(T(lx, yK, lz), mat({ rot: [tilt, -4 + R.spread(2), 0] }));
    const g = roundedBox({ w: 0.66, h: 0.05, d: 0.5, r: 0.012, rPlan: 0.03, detail });
    b.add(part('wood', transform(g, chain(ledge, T(0, 0.02, 0))), 'wood', { seed: seed + 85, shade: 0.74, jitter: 0.05 }));
    // a wedge under its back edge
    b.add(part('wood', bevelBox({ min: [lx - 0.3, yK, lz - 0.25], max: [lx + 0.3, yK + 0.07, lz - 0.12], c: 0.01, omit: ['ny'] }), 'wood', { seed: seed + 86, shade: 0.48 }));
    // the pad: a stack of paper, its top sheet curling up a little at the front
    const pad = chain(ledge, T(-0.04, 0.07, 0.01), mat({ rot: [-90, 0, R.spread(4)] }));
    b.add(part('paper', transform(roundedBox({ w: 0.42, h: 0.02, d: 0.33, r: 0.004, rPlan: 0.006, detail: 'low', band: 0 }), chain(ledge, T(-0.04, 0.045, 0.01), mat({ rot: [0, R.spread(4), 0] }))), 'paper', { seed: seed + 87, shade: 0.86 }));
    b.add(part('paper', transform(sheet({ w: 0.42, h: 0.33, t: 0.002, nx: 4, ny: 4, lift: (_u, v) => 0.02 * Math.pow(Math.max(0, (0.25 - v) / 0.25), 2) }), pad), 'paper', { seed: seed + 88 }));
    // a pencil lying across it
    const pen = chain(ledge, T(0.02, 0.085, 0.12), mat({ rot: [0, 0, -90] }), mat({ rot: [0, 28 + R.spread(6), 0] }));
    const pg = lathe(profile(0, 0).to(0.014, 0, { sharp: true }).to(0.014, 0.3, { sharp: true }).to(0, 0.3), { segs: 6, caps: true, band: 0 });
    b.add(setFinish(part('wood', transform(pg, chain(pen, T(0, -0.15, 0))), 'tape-yellow', { seed: seed + 89 }), 1));
    const tip = lathe(profile(0, 0).to(0.014, 0, { sharp: true }).to(0.003, 0.05, { sharp: true }).to(0, 0.052), { segs: 6, caps: false, band: 0 });
    b.add(part('wood', transform(tip, chain(pen, T(0, 0.15, 0))), 'wood-light', { seed: seed + 90 }));
    const fer2 = lathe(profile(0.0145, 0).to(0.0145, 0.03).to(0, 0.03), { segs: 6, caps: false, band: 0 });
    b.add(part('metal', transform(fer2, chain(pen, T(0, -0.18, 0))), 'steel', { seed: seed + 91 }));
  }

  for (const [k, m] of Object.entries(jackSockets)) b.socket(k, m);
  b.socket('stool', T(0.1, 0, 1.25));
  const built = b.build();
  if (o.pose) {
    const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
    if (!p) throw new Error(`switchboard: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
    poseSwitchboard(built.root, p);
  }
  return built;
}

// ---- the jack and lamp parts (built along +Y, the face at y = 0) -----------------

/** Height of a big jack's mouth above the plate. */
export const JACK_MOUTH = 0.088;
/** Height of a small jack's mouth above the plate. */
const SMALL_MOUTH = 0.042;
/** Where a lens sits in its bezel. */
const BEZEL_SEAT = 0.03;

/** A big live jack: a brass escutcheon, a knurled rim, a black fibre bore. */
function bigJack(detail: 'high' | 'low', seed: number): KitPart[] {
  const hi = detail === 'high';
  const segs = hi ? 22 : 14;
  const esc = lathe(
    profile(0.175, 0).to(0.175, 0.012, { fillet: 0.006, segs: 1 }).to(0.142, 0.03, { fillet: 0.008, segs: 1 }).to(0.134, 0.032),
    { segs, caps: false, detail, band: 0 },
  );
  const knurl = transform(ridgedBand(0.135, 0.042, hi ? 30 : 20, 0.009), T(0, 0.03, 0));
  const rim = lathe(
    profile(0.135, 0.07).to(0.137, 0.074, { fillet: 0.004, segs: 1 }).to(0.13, JACK_MOUTH, { fillet: 0.012, segs: 2 }).to(0.09, JACK_MOUTH, { fillet: 0.01, segs: 2 }).to(0.074, JACK_MOUTH - 0.012),
    { segs, caps: false, detail, band: 0 },
  );
  const bore = lathe(profile(0.074, JACK_MOUTH - 0.012).to(0.058, JACK_MOUTH - 0.02, { fillet: 0.004, segs: 1 }).to(0.058, -0.06, { sharp: true }).to(0, -0.06), { segs: hi ? 16 : 10, caps: false, detail, band: 0 });
  return [
    part('brass', esc, 'brass', { seed, warm: 0.03, shade: 0.9 }),
    setFinish(part('brass', knurl, 'brass', { seed: seed + 1 }), 0.45),
    setFinish(part('brass', rim, 'brass', { seed: seed + 2 }), 0.7),
    part('rubber', bore, 'ink', { seed: seed + 3, shade: 0.8 }),
    ...[0, 1].map((k) => part('brass', transform(stud(0.012, 0.008, 6), T(Math.cos(0.8 + k * Math.PI) * 0.155, 0.014, Math.sin(0.8 + k * Math.PI) * 0.155)), 'brass', { seed: seed + 4 + k, shade: 0.8 })),
  ];
}

/** A capped position: a plain escutcheon and a domed brass blank screwed into it. */
function cappedJack(detail: 'high' | 'low', seed: number): KitPart[] {
  const hi = detail === 'high';
  const sg = hi ? 16 : 10;
  const esc = lathe(profile(0.13, 0).to(0.13, 0.01, { sharp: true }).to(0.105, 0.024, { fillet: 0.006, segs: 1 }).to(0.09, 0.025), { segs: sg, caps: false, detail, band: 0 });
  const cap = lathe(profile(0.093, 0.042).to(0.088, 0.046, { sharp: true }).curve(0, 0.075, 0.075, 0.078, 3), { segs: sg, caps: false, detail, band: 0 });
  const knurl = transform(ridgedBand(0.093, 0.018, hi ? 20 : 14, 0.006), T(0, 0.025, 0));
  return [part('brass', esc, 'brass', { seed, shade: 0.85 }), setFinish(part('brass', cap, 'brass', { seed: seed + 1, shade: 0.95 }), 0.3), part('brass', knurl, 'brass', { seed: seed + 2 })];
}

/** A small dead jack: a brass ring and a dark bore (cheap: there are two rows of them). */
function smallJack(detail: 'high' | 'low', seed: number): KitPart[] {
  const s = detail === 'high' ? 10 : 7;
  const ring = lathe(profile(0.078, 0).to(0.064, SMALL_MOUTH, { smooth: true }).to(0.042, SMALL_MOUTH, { smooth: true }).to(0.032, SMALL_MOUTH - 0.012), { segs: s, caps: false, band: 0 });
  const bore = lathe(profile(0.032, SMALL_MOUTH - 0.012).to(0, -0.005), { segs: 7, caps: false, band: 0 });
  return [part('brass', ring, 'brass', { seed, shade: 0.82, jitter: 0.08 }), part('rubber', bore, 'ink', { shade: 0.6 })];
}

/** Where a jack was taken out: a dark bore in the plate with a chamfered lip. */
function holeGeom(_detail: 'high' | 'low'): KitPart[] {
  const g = lathe(profile(0.06, 0.003).to(0.04, 0.003, { sharp: true }).to(0.034, -0.004, { sharp: true }).to(0.034, -0.03).to(0, -0.03), { segs: 10, caps: false, band: 0 });
  return [part('steel', g, 'ink', { shade: 0.8 })];
}

/** A brass bezel ring for a lens (along +Y, seated on y = 0). */
function bezel(r: number, detail: 'high' | 'low', seed: number, cheap = false): KitPart[] {
  const s = cheap ? 7 : detail === 'high' ? 20 : 12;
  const g = lathe(
    profile(r, 0)
      .to(r, r * 0.12, cheap ? { sharp: true } : { fillet: r * 0.06, segs: 1 })
      .to(r * 0.86, r * 0.36, cheap ? { sharp: true } : { fillet: r * 0.1, segs: 2 })
      .to(r * 0.66, r * 0.4, cheap ? { sharp: true } : { fillet: r * 0.05, segs: 1 })
      .to(r * 0.6, r * 0.26),
    { segs: s, caps: false, band: 0 },
  );
  return [setFinish(part('brass', g, 'brass', { seed, warm: 0.03, shade: cheap ? 0.8 : 1 }), cheap ? 0 : 0.5)];
}

/** A faceted jewel lens (few segments, creased: each facet catches the light). */
function lensPart(r: number, segs: number, cls: 'bulb' | 'glass', seed: number, cheap = false): KitPart {
  const pr = cheap ? profile(r, 0).to(r * 0.6, r * 0.55, { sharp: true }).to(0, r * 0.68) : profile(0, 0).to(r, 0, { sharp: true }).to(r * 0.95, r * 0.28, { sharp: true }).to(r * 0.55, r * 0.62, { sharp: true }).to(0, r * 0.72);
  const g = lathe(pr, { segs, caps: false, band: 0 });
  if (cls === 'bulb') {
    const p = part('bulb', g, 'amber-glow', { seed, shade: POSE.lensOff });
    return setFinish(p, 0.55);
  }
  return setFinish(part('glass', g, 'amber', { seed, shade: cheap ? 0.45 : 0.3 }), 0.6);
}

/** A brass cup (bin) pull: a back plate and a hood open underneath, centred at y. */
function cupPull(detail: 'high' | 'low', seed: number, y: number): KitPart[] {
  const hi = detail === 'high';
  const plate = slab({ w: 0.22, d: 0.085, t: 0.008, r: 0.03, bevel: 0.003, detail: 'low', open: true, band: 0 });
  transform(plate, chain(T(0, y, 0), Z_UP));
  // the hood: a quarter-round shell, its curved face looking up and out, open below
  const L = 0.17, rr = 0.05;
  const hood = lathe(profile(0, 0).to(rr, 0, { fillet: 0.012, segs: 2 }).to(rr, L, { fillet: 0.012, segs: 2 }).to(0, L), { segs: hi ? 8 : 6, from: -Math.PI / 2, to: 0, caps: false, band: 0 });
  // lathe Y -> world X; its quarter (local -Z .. +X) -> world +Z .. +Y
  const rot = new Matrix4().set(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
  transform(hood, chain(T(-L / 2, y - 0.03, 0.008), rot));
  // its dark underside (only seen from below)
  return [
    setFinish(part('brass', plate, 'brass', { seed, shade: 0.85 }), 0.2),
    setFinish(part('brass', hood, 'brass', { seed: seed + 1 }), 0.8),
    ...[-1, 1].map((s) => part('brass', transform(stud(0.008, 0.005, 5), chain(T(s * 0.09, y, 0.008), Z_UP)), 'brass', { seed: seed + 2 })),
  ];
}
