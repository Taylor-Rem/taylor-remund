/**
 * The kit's demo and the reference for composing a piece: a small machine
 * housing. A rounded body on a plinth with rubber feet; an inset panel with
 * a row of louvres; a hatch on a hinge with a handle; a brass plate with
 * four rivets; a turned knob on a collar; a pipe leaving through a gland
 * and bending down into a bolted flange; bolts along the plinth (one of
 * them a brass replacement).
 *
 * Nodes that move: 'hatch' (swings about its hinge, local Y axis) and
 * 'knob' (turns about its local Y axis).
 */
import { Matrix4 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { roundedBox, slab, lathe, taperBox, profiledBox } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import {
  cableGland, domeRivet, flange, handle, hexBolt, hinge, knurlGeom, louvre, rubberFoot, seam, slottedScrew, collar, weldBead,
} from '../../details.ts';
import { aim, alongEdge, chain, mat, part, piece, place, T } from '../../compose.ts';
import { askew, rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';

export function testBlock(o: KitOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const b = piece('test-block', { detail, seed });

  // ---- large form: feet, plinth, body, hood --------------------------------
  const W = 1.0, D = 0.64; // body
  const yP0 = 0.055, yP1 = 0.155; // plinth
  const yB1 = 0.77; // body top
  const zF = D / 2; // body front

  for (const [x, z] of [[-0.5, -0.29], [0.5, -0.29], [-0.5, 0.29], [0.5, 0.29]] as const) {
    b.add(place(rubberFoot({ d: 0.12, h: 0.065, detail, seed: R.int(0, 999) }), T(x, 0, z)));
  }
  // plinth: a cast base with a canted shoulder
  const pr = 0.06;
  b.add(
    part(
      'steel',
      transform(
        profiledBox({ w: 1.16, d: 0.78, rPlan: pr, detail }, profile(0, 0).to(pr, 0, { sharp: true }).to(pr, 0.058, { fillet: 0.014 }).to(pr - 0.03, yP1 - yP0, { fillet: 0.012 }).to(0, yP1 - yP0)),
        T(0, yP0, 0),
      ),
      'teal-deep',
      { seed, jitter: 0.05 },
    ),
  );
  b.add(
    part(
      'steel',
      transform(taperBox({ w: W, h: yB1 - yP1, d: D, rPlan: 0.075, rTop: 0.06, rBottom: 0.02, topW: W * 0.97, topD: D, detail }), T(0, yP1, 0)),
      'teal-panel',
      { seed: seed + 1, jitter: 0.04 },
    ),
  );
  // hood: a pressed lid, a lip band and a raised top
  const hr = 0.1;
  b.add(
    part(
      'steel',
      transform(
        profiledBox({ w: 1.08, d: 0.72, rPlan: hr, detail }, profile(0, 0).to(hr, 0, { fillet: 0.01 }).to(hr, 0.03, { fillet: 0.012 }).to(hr - 0.03, 0.045, { fillet: 0.014 }).to(hr - 0.03, 0.08, { fillet: 0.024 }).to(0, 0.08)),
        T(0, yB1 - 0.005, 0),
      ),
      'teal-panel',
      { seed: seed + 2, shade: 1.12 },
    ),
  );

  // ---- medium: louvre panel (left), brass plate, hatch (right) --------------
  const panelX = -0.235, panelY = 0.43;
  const proud = 0.022;
  b.add(part('steel', transform(slab({ w: 0.44, d: 0.34, t: proud, r: 0.04, bevel: 0.009, detail, open: true }), chain(T(panelX, panelY, zF - 0.002), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 3, shade: 0.92 }));
  b.add(place(louvre({ w: 0.34, h: 0.22, count: 5, depth: 0.026, detail, seed: seed + 4 }), T(panelX, panelY - 0.11, zF + proud - 0.004)));
  for (const [dx, dy] of [[-0.19, -0.14], [0.19, -0.14], [-0.19, 0.14], [0.19, 0.14]] as const) {
    const s = R.int(0, 999);
    b.small(() => place(slottedScrew({ d: 0.034, detail, seed: s }), aim([panelX + dx, panelY + dy, zF + proud - 0.002], [0, 0, 1])));
  }

  // brass maker's plate, a degree and a half off true, four rivets
  const plateM = chain(T(-0.235, 0.68, zF - 0.002), askew(seed + 5, 2.5), mat({ rot: [90, 0, 0] }));
  b.add(part('brass', transform(slab({ w: 0.3, d: 0.1, t: 0.012, r: 0.018, bevel: 0.005, detail, open: true }), plateM), 'brass', { seed: seed + 6, warm: 0.04 }));
  for (const [dx, dz] of [[-0.128, -0.032], [0.128, -0.032], [-0.128, 0.032], [0.128, 0.032]] as const) {
    const s = R.int(0, 999);
    b.small(() => place(domeRivet({ d: 0.022, detail, seed: s }), chain(plateM, T(dx, 0.011, dz))));
  }

  // the hatch: hinge axis vertical at its left edge
  const hingeAt = new Matrix4().makeTranslation(0.045, 0.43, zF + 0.024);
  const vert = new Matrix4().makeRotationZ(Math.PI / 2);
  const hg = hinge({ length: 0.34, r: 0.019, knuckles: 3, detail, seed: seed + 7 });
  b.add(place(hg.fixed, chain(hingeAt, vert)));
  const hatch = b.node('hatch', chain(hingeAt, new Matrix4().makeRotationY(-0.02)));
  hatch.add(place(hg.moving, vert));
  hatch.add(part('steel', transform(slab({ w: 0.36, d: 0.4, t: 0.024, r: 0.035, bevel: 0.009, detail }), chain(T(0.205, 0, -0.022), mat({ rot: [90, 0, 0] }))), 'teal-panel', { seed: seed + 8, shade: 1.05 }));
  hatch.add(place(handle({ span: 0.16, reach: 0.05, r: 0.011, detail, seed: seed + 9 }), chain(T(0.33, 0, 0.0), new Matrix4().makeRotationZ(Math.PI / 2))));

  // ---- the knob on its collar, on the hood ----------------------------------
  const knobAt = T(0.3, yB1 + 0.075, -0.06);
  b.add(place(collar({ r: 0.07, inner: 0.03, h: 0.03, detail, seed: seed + 10 }), knobAt));
  const knob = b.node('knob', chain(knobAt, T(0, 0.028, 0), new Matrix4().makeRotationY(R.range(0, Math.PI * 2))));
  // the knob's brass is handled every day: polished (finish 1), while the plate and hinge keep the class's patina
  knob.add(setFinish(part('brass', lathe(profile(0, 0).to(0.05, 0, { fillet: 0.006, segs: 2 }).to(0.058, 0.014, { fillet: 0.006, segs: 2 }).to(0.046, 0.016).to(0, 0.016), { segs: 22, detail, support: false, caps: 'end' }), 'brass', { seed: seed + 11 }), 1));
  knob.add(setFinish(part('brass', transform(knurlGeom(0.054, 0.042, 18, undefined, detail), T(0, 0.014, 0)), 'brass', { seed: seed + 12 }), 0.7));
  knob.add(
    part(
      'rubber',
      lathe(profile(0, 0.05).to(0.05, 0.05, { sharp: true }).curve(0, 0.09, 0.05, 0.088, detail === 'low' ? 4 : 6), { segs: 22, detail, support: false, caps: false }),
      'ink',
    ),
  );
  knob.add(part('paper', transform(roundedBox({ w: 0.008, h: 0.006, d: 0.034, r: 0.0025, segs: 1, detail: 'low' }), T(0, 0.084, 0.018)), 'paper'));

  // ---- pipe: through a gland in the right side, bending down into a flange ---
  const glandAt: [number, number, number] = [W / 2 * 0.985 - 0.004, 0.43, 0.06];
  b.add(place(cableGland({ cable: 0.028, detail, seed: seed + 13 }), aim(glandAt, [1, 0, 0])));
  const fx = 0.84;
  const path = polylinePath([[glandAt[0] + 0.05, 0.43, 0.06], [fx, 0.43, 0.06], [fx, 0.05, 0.06]], 0.14, detail === 'low' ? 5 : 8);
  b.add(part('metal', sweep(path, { radius: 0.028, segs: 14, ends: 'flat', detail }), 'steel', { seed: seed + 14 }));
  b.add(place(flange({ od: 0.22, t: 0.02, bolts: 5, detail, seed: seed + 15 }), T(fx, 0, 0.06)));
  b.add(place(collar({ r: 0.045, inner: 0.027, h: 0.05, detail, seed: seed + 16 }), T(fx, 0.04, 0.06)));

  // ---- small: bolts along the plinth, a weld bead, a seam --------------------
  const boltRow = 5;
  const replaced = R.int(0, boltRow - 1);
  for (let i = 0; i < boltRow; i++) {
    const x = -0.44 + (0.88 * i) / (boltRow - 1);
    const brass = i === replaced;
    b.add(place(hexBolt({ af: 0.05, washer: true, detail, seed: R.int(0, 999), ...(brass ? { material: 'brass' as const, token: 'brass' as const } : {}) }), aim([x, (yP0 + yP1) / 2, 0.39], [0, 0, 1])));
  }
  // tack welds where the body sits on the plinth
  for (const [x0, x1] of [[-0.44, -0.3], [0.3, 0.44]] as const) {
    b.small(() => weldBead(polylinePath([[x0, yP1 + 0.003, zF + 0.003], [x1, yP1 + 0.003, zF + 0.003]], 0), { r: 0.009, seed: seed + 17 + x0 * 10, detail }));
  }
  b.small(() => seam({ path: polylinePath([[W / 2 + 0.001, yP1 + 0.06, -0.16], [W / 2 * 0.975 + 0.001, yB1 - 0.06, -0.16]], 0), up: [1, 0, 0], width: 0.02 }));

  // a riveted strap up the plain left side, a little off-centre
  // the body's sides lean in (its top is 3% narrower), so the strap leans with them
  const lean = Math.atan2((W / 2) * 0.03, yB1 - yP1 - 0.02);
  const strapM = chain(T(-W / 2 + 0.0005, yP1 + 0.02, 0.07 + R.spread(0.02)), new Matrix4().makeRotationZ(-lean), mat({ rot: [0, 0, 90] }));
  b.add(part('steel', transform(slab({ w: 0.56, d: 0.07, t: 0.012, r: 0.02, bevel: 0.005, detail, open: true }), chain(strapM, T(0.28, 0, 0))), 'teal-panel', { seed: seed + 19, shade: 0.9 }));
  b.small(() => alongEdge(domeRivet({ d: 0.02, detail, seed: seed + 20 }), [0.05, 0.0115, 0], [0.51, 0.0115, 0], 4).map((q) => ({ ...q, geometry: transform(q.geometry, strapM) })));

  b.socket('label', mat({ at: [-0.235, 0.68, zF + 0.012] }));
  return b.build();
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'test-block',
    build: (opts = {}) => testBlock({ ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.detail ? { detail: opts.detail } : {}) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, 'seed 2': { seed: 2 } },
    camera: { distance: 4.2 },
    note: 'The kit demo: every solid, detail and signal on one small machine housing.',
  },
];
