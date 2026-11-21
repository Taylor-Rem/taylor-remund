/**
 * THE PHONE (art-direction § 10, W3 brief § C). Registry name `phone`.
 *
 * The one modern object in the room, built like the rest: a chunky phone
 * about 0.7 tall in a fat `ink` rubber bumper with moulded corner guards,
 * dark glass, a lit screen (the labels module's `phone(messages)` texture,
 * the attract conversation from content), brass side buttons, leaning back
 * on a small bent-brass easel with rubber feet.
 *
 * Node `phone` pivots on the line where the bumper's foot sits in the
 * easel's ledge (its +X), so a view can rock it about X when a text arrives
 * (`posePhone(root, { tilt })`). Socket `screen`: the screen's centre, +Z out
 * of the glass.
 *
 * The screen is a textured `bulb` part at the indicator level (finish 1):
 * it lights itself, and it stays lit when the lamp is off (the bench lit
 * only by the board's lamps and the robots' eyes, and this).
 */
import { Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { extrude, lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { chain, part, piece, texturedPart, T, aim } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, sheet, stud } from '../../cheap.ts';
import { world } from '../../../labels/content.ts';
import { pilotLamp } from '../../details.ts';
import { phonePixels, phoneRegion } from '../../../labels/index.ts';

const DEG = Math.PI / 180;

/** The phone's dimensions (world units). */
export const PHONE = {
  /** Body (bumper outline) width, height, thickness. */
  w: 0.4,
  h: 0.7,
  d: 0.085,
  /** Bumper corner radius in the face's plane. */
  r: 0.08,
  /** The screen's size (the label texture is made at this size). */
  screen: { w: 0.3, h: 0.3 * (0.6 / 0.34) },
  /** Where the screen's centre sits up the face. */
  screenY: 0.365,
  /** How far it leans back from upright, degrees. */
  lean: 15,
  /** T1: the foot plate's shelf in front of the ledge, and the line lamp's lens radius on it. */
  lampShelf: 0.15,
  lampR: 0.034,
} as const;

export interface PhoneScreenRef {
  key: string;
}

export interface PhoneOptions extends KitOptions {
  /** The screen texture from `phoneScreen(labels)`; without it the screen is a plain lit panel (clay, tests). */
  screen?: PhoneScreenRef;
  /** Build posed (tilt in degrees about the foot: + leans further back). */
  tilt?: number;
}

/**
 * Make the screen's texture: the attract conversation from content. It is made at the labels
 * module's own screen size (its layout is tuned there) and mapped onto this screen, which has
 * the same proportions.
 */
export function phoneScreen(labels: Labels, messages = world.phone.attract): PhoneScreenRef {
  // a region of the label atlas that the phone's view redraws in place (T1 round 3), painted
  // with `messages` the first time these labels make it
  const r = phoneRegion(labels);
  if (!screens.has(r)) {
    screens.add(r);
    r.put(phonePixels(messages));
  }
  return { key: r.key };
}
const screens = new WeakSet<object>();

/** A rounded rectangle outline, centred at (cx, cy). */
function rrect(w: number, h: number, cx = 0, cy = 0): Array<[number, number]> {
  return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
}

export function phone(o: PhoneOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const b = piece('phone', { detail, seed });
  const { w, h, d, r } = PHONE;

  // ====================================================================
  // THE EASEL: a brass foot plate with a ledge, a bent-rod strut behind
  // ====================================================================
  const footZ = 0.02; // where the bumper's foot sits (the pivot line), from the easel's front
  const ledgeH = 0.05;
  const plateT = 0.022;
  const lean = PHONE.lean * DEG;
  {
    // the foot plate: a rounded brass plate on four rubber feet
    // T1: it runs PHONE.lampShelf further forward than it did, a shelf for the line's lamp at its front right
    const pw = w + 0.08, pd = 0.34 + PHONE.lampShelf;
    // its underside sits on the feet a hair over the bench, where no view reaches: no base, no base bevel
    const plate = extrude(rrect(pw, pd, 0, -pd / 2 + 0.06 + PHONE.lampShelf), plateT, { axis: 'y', radius: 0.04, bevel: 0.007, bevelBase: 0, caps: 'end', segs: 2, detail, support: false });
    b.add(setFinish(part('brass', transform(plate, T(0, 0.012, 0)), 'brass', { seed: seed + 1, shade: 0.9, warm: 0.03 }), 0.2));
    for (const [x, z] of [[-pw / 2 + 0.05, 0.03 + PHONE.lampShelf], [pw / 2 - 0.05, 0.03 + PHONE.lampShelf], [-pw / 2 + 0.05, -pd + 0.1], [pw / 2 - 0.05, -pd + 0.1]] as const) {
      // under the plate's corners: a sliver of each shows at its edge
      const foot = lathe(profile(0, 0).to(0.026, 0, { sharp: true }).to(0.022, 0.014, { fillet: 0.004, segs: 1 }).to(0, 0.014), { segs: 6, detail, band: 0, caps: false });
      b.add(part('rubber', transform(foot, T(x, 0, z)), 'ink', { seed: seed + 2 }));
    }
    // the ledge: a folded brass lip in front of the foot, two screws
    // its back is against the phone's foot: no back cap, no back bevel
    const lip = extrude([[-w / 2 - 0.03, 0], [w / 2 + 0.03, 0], [w / 2 + 0.03, ledgeH], [-w / 2 - 0.03, ledgeH]], 0.018, { radius: [0.004, 0.004, 0.012, 0.012], bevel: 0.006, bevelBase: 0, caps: 'end', segs: 2, detail, support: false });
    b.add(setFinish(part('brass', transform(lip, T(0, 0.012 + plateT - 0.004, footZ + 0.04)), 'brass', { seed: seed + 3, warm: 0.03 }), 0.3));
    for (const x of [-0.12, 0.12]) b.small(() => [part('brass', transform(stud(0.011, 0.007), aim([x, 0.012 + plateT + ledgeH * 0.55, footZ + 0.058], [0, 0, 1])), 'brass', { seed: seed + 4 })]);
    // the strut: a bent rod from the plate's back up to the phone's back, a rubber tip
    const backZ = footZ - d; // the phone's back at its foot
    const tY = 0.42; // how high up the phone the strut touches
    const touch = new Vector3(0, tY * Math.cos(lean), backZ - tY * Math.sin(lean) - 0.012);
    for (const x of [-0.1, 0.1]) {
      const path = polylinePath([[x, 0.012 + plateT, -0.28], [x, 0.012 + plateT + 0.04, -0.28], [x * 0.7, touch.y - 0.04, touch.z - 0.02], [x * 0.55, touch.y, touch.z]], 0.05, hi ? 3 : 2);
      // behind the phone; its ends go into the knuckle and the rubber tip
      b.add(part('brass', sweep(path, { radius: 0.011, segs: 5, ends: 'flat', detail }), 'brass', { seed: seed + 5 }));
    }
    const tip = lathe(profile(0, 0).to(0.03, 0, { fillet: 0.008, segs: 1 }).to(0.03, 0.03, { fillet: 0.01, segs: 1 }).to(0, 0.032), { segs: 7, detail, band: 0 });
    b.add(part('rubber', transform(tip, chain(T(0, touch.y, touch.z - 0.022), new Matrix4().makeRotationZ(Math.PI / 2))), 'ink', { seed: seed + 6 }));
    // the strut's hinge: a brass knuckle on the plate
    const kn = lathe(profile(0, 0).to(0.02, 0, { sharp: true }).to(0.02, 0.26).to(0, 0.26), { segs: 8, detail, band: 0 });
    b.add(part('brass', transform(kn, chain(T(-0.13, 0.012 + plateT + 0.02, -0.28), new Matrix4().makeRotationZ(-Math.PI / 2))), 'brass', { seed: seed + 7 }));
  }

  // ====================================================================
  // THE LINE'S LAMP (T1): the phone line's own pilot lamp, on the foot plate's shelf at the front right,
  // nodes `lamp` > `lamp.lit` / `lamp.unlit` (the view swaps them). Lit while a text is on the line.
  // ====================================================================
  const lampM = chain(T(w / 2 - 0.07, 0.012 + plateT, footZ + 0.058 + (PHONE.lampShelf - 0.018) / 2), new Matrix4().makeRotationY(R.range(0, Math.PI)));
  {
    const pl = pilotLamp({ r: PHONE.lampR, seed: seed + 40, flange: false, unlit: 'glass' });
    b.add(...pl.fixed.map((q) => ({ ...q, geometry: transform(q.geometry, lampM) })));
    const lamp = b.node('lamp', lampM);
    lamp.node('lamp.lit', new Matrix4().makeScale(1e-4, 1e-4, 1e-4)).add(pl.lit);
    lamp.node('lamp.unlit').add(pl.unlit);
  }

  // ====================================================================
  // THE PHONE (node: pivots on its foot line, leans back on the strut)
  // ====================================================================
  const pivot = chain(T(0, 0.012 + plateT, footZ), new Matrix4().makeRotationX(-(lean + (o.tilt ?? 0) * DEG)));
  const ph = b.node('phone', pivot);
  // built standing, its foot on y = 0, its face toward +Z with the back at z = -d
  {
    const back = T(0, 0, -d);
    // the bumper: a fat rubber frame round the face, its lip a little proud of the glass
    const outer = rrect(w, h, 0, h / 2);
    const hole = rrect(w - 0.074, h - 0.08, 0, h / 2);
    // the back (open, and its rim) faces the wall in every view: the bevel is the front's alone
    const frame = extrude(outer, d, { holes: [hole], radius: r, holeRadius: r * 0.45, bevel: 0.016, bevelBase: 0, caps: 'end', segs: hi ? 3 : 2, detail });
    ph.add(part('rubber', transform(frame, back), 'ink', { seed: seed + 10, shade: 1.15 }));
    // the back shell inside the frame (it closes the hole behind the glass)
    // (its front is under the glass, its edges inside the bumper: a plain slab is enough)
    const shell = bevelBox({ min: [-(w - 0.05) / 2, 0.025, 0], max: [(w - 0.05) / 2, h - 0.025, d * 0.55], omit: ['pz'] });
    ph.add(part('rubber', transform(shell, back), 'ink', { seed: seed + 11 }));
    // corner guards: moulded pads standing out of the bumper at the four corners
    for (const [sx, sy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const) {
      const g = transform(
        lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.046, 0.012, { fillet: 0.008, segs: 1 }).to(0, 0.016), { segs: 8, detail, band: 0, caps: false }),
        chain(T(sx * (w / 2 - r + Math.SQRT1_2 * (r - 0.006)), sy ? h - r + Math.SQRT1_2 * (r - 0.006) : r - Math.SQRT1_2 * (r - 0.006), -d * 0.5), aim([0, 0, 0], [sx, sy ? 1 : -1, 0])),
      );
      ph.add(part('rubber', g, 'ink', { seed: seed + 12, shade: 1.25 }));
    }
    // dark glass, set a little under the bumper's lip
    const glassZ = -0.012;
    const glass = extrude(rrect(w - 0.06, h - 0.066, 0, h / 2), 0.02, { radius: r * 0.55, bevel: 0.004, bevelBase: 0, caps: 'end', segs: 1, detail, support: false });
    ph.add(setFinish(part('glass', transform(glass, T(0, 0, glassZ - 0.02)), 'ink'), 1));
    // the screen under the glass: lit, the conversation on it
    const sw = PHONE.screen.w, sh = PHONE.screen.h;
    const scr = transform(sheet({ w: sw, h: sh, t: 0, nx: 1, ny: 1 }), T(0, PHONE.screenY, glassZ + 0.002));
    setFinish(scr, 1);
    if (o.screen) ph.add(texturedPart('bulb', scr, o.screen.key));
    else ph.add(setFinish(part('bulb', scr, 'teal-light', { shade: 0.25 }), 1));
    // the earpiece slot and the camera
    // the slot: only its face shows above the glass
    ph.add(part('rubber', transform(bevelBox({ min: [-0.04, -0.006, -0.003], max: [0.04, 0.006, 0.002], c: 0.004, omit: ['nz'] }), T(0, PHONE.screenY + sh / 2 + 0.018, glassZ)), 'ink', { shade: 0.6 }));
    const cam = lathe(profile(0, 0).to(0.012, 0, { sharp: true }).to(0.012, 0.003, { fillet: 0.002, segs: 1 }).to(0.006, 0.004).to(0, 0.002), { segs: 10, detail, band: 0 });
    ph.add(part('brass', transform(cam, chain(T(0.07, PHONE.screenY + sh / 2 + 0.018, glassZ), new Matrix4().makeRotationX(Math.PI / 2))), 'brass', { seed: seed + 13 }));
    // brass side buttons: two on the right (volume), one on the left (power), proud of the bumper
    const btn = (x: number, y: number, len: number, sd: number): KitPart =>
      // each runs from the phone's middle out through the bumper: its inner end is inside the body
      part('brass', bevelBox({ min: [Math.min(0, x), y - len / 2, -d * 0.62], max: [Math.max(0, x), y + len / 2, -d * 0.38], c: 0.006, omit: [x > 0 ? 'nx' : 'px'] }), 'brass', { seed: sd, warm: 0.03 });
    const sideX = w / 2 + 0.009;
    ph.add(setFinish(btn(sideX, h * 0.7, 0.08, seed + 14), 0.5), setFinish(btn(sideX, h * 0.57, 0.08, seed + 15), 0.5), setFinish(btn(-sideX, h * 0.66, 0.11, seed + 16), 0.5));
    // the charging port and a lanyard hole on the foot (seen when it rocks)
    ph.add(part('rubber', transform(bevelBox({ min: [-0.035, -0.002, -d * 0.6], max: [0.035, 0.004, -d * 0.4], c: 0.003, omit: ['py'] }), T(0, 0, 0)), 'ink', { shade: 0.4 }));
    // a scuff on the bumper: one corner guard nicked (seeded)
    void R;
  }

  b.socket('screen', chain(pivot, T(0, PHONE.screenY, -0.012)));
  b.socket('lamp', lampM);
  return b.build();
}

/** Rock a realized phone about its foot: `tilt` in degrees from rest (+ back, - forward). */
export function posePhone(root: Object3D, pose: { tilt?: number }): void {
  const n = root.getObjectByName('phone');
  if (!n) return;
  const u = n.userData as { phoneRest?: { x: number } };
  if (!u.phoneRest) u.phoneRest = { x: n.rotation.x };
  n.rotation.x = u.phoneRest.x - (pose.tilt ?? 0) * DEG;
}

/** The same on a Piece description. */
export function posePiece(root: PieceNode, pose: { tilt?: number }): void {
  const walk = (n: PieceNode): void => {
    if (n.name === 'phone' && pose.tilt) n.transform = (n.transform ?? new Matrix4()).clone().multiply(new Matrix4().makeRotationX(-(pose.tilt * DEG)));
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

const POSES: Record<string, number> = { rest: 0, 'wobble-back': 6, 'wobble-forward': -4 };

export const catalogue: CatalogueEntry[] = [
  {
    name: 'phone',
    build: (opts = {}) => {
      const o: PhoneOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      const sc = opts['screen'] as PhoneScreenRef | undefined;
      if (sc && typeof sc.key === 'string') o.screen = sc;
      const pose = opts['pose'];
      if (typeof pose === 'string' && pose in POSES) o.tilt = POSES[pose]!;
      return phone(o);
    },
    labels: (labels) => ({ screen: phoneScreen(labels) }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    poses: Object.keys(POSES),
    camera: { distance: 2.5 },
    note: 'The phone: chunky, in an ink rubber bumper, leaning on a brass easel; its lit screen shows the attract text.',
  },
];
