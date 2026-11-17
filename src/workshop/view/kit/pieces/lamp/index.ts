/**
 * THE LAMP (art-direction § 10, W3 brief § C): the body of the key light.
 * Registry name `lamp`.
 *
 * A machinist's task lamp clamped to a short wall rail at the back of the
 * bench: a brass thumbscrew clamp round a steel rail on two brass
 * stand-offs, a swivel riser, two arm sections of paired steel tubes with
 * exposed springs and wing-nut joints, a bell shade (`teal-panel` enamel
 * outside, cream inside, a rolled cream lip), an `amber-glow` bulb, a brown
 * cloth cord trailing off along the wall.
 *
 * Built in its own space: origin on the bench top at the face of the back
 * wall, below the clamp (place it at `LAMP_PLACE`, world (-4.5, 0, -5)).
 * The arm is solved (rig.ts) so the filament lands on the stage's key light
 * (stage/light.ts default bulb, aimed at its default aim) and the shade's
 * axis points along the aim. The `bulb` socket IS the key light: its origin
 * is the filament and its +Y is the light's direction. Use `keyLight()`.
 *
 * Shadows. The key spot sits inside the shade. The shade's opening is wider
 * than the light's cone: the rim is ~66° off the axis seen from the
 * filament, the key's cone is 60° (and its shadow camera ~48°, ~58° at the
 * corners), so no part of the shade is lit by the key or drawn into its
 * shadow map; the bulb and the glowing liner are `bulb` class, which never
 * casts. Nothing has to be switched off by hand.
 *
 * The inside glows. The key light cannot light the liner (it is outside the
 * cone, behind the light), so the lit liner is `bulb` class with a dim cream
 * vertex colour that is brightest deep in the bell and falls toward the lip:
 * the glow a bulb throws on its own reflector. Lamp off swaps it for a plain
 * cream enamel liner and a dark glass bulb (`poseLamp(root, { on: false })`).
 *
 * Nodes (pivots at node origins; the arm's three pins are each node's +Y):
 *  - `arm1` (the shoulder), `arm2` (the elbow), `shade` (the wrist)
 *  - `lit` / `unlit` under `shade`: the glowing bulb and liner, and their
 *    dark twins. `unlit` is built collapsed into the wrist hub; `poseLamp` swaps them.
 * Sockets: `bulb` (filament, +Y along the light), `rail` (where the clamp
 * bites), `cord` (where the cord runs off the piece, along -X).
 */
import { CatmullRomCurve3, Matrix4, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { KitOptions, KitPart, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { extrude, lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { sweep, linePath, polylinePath, curvePath } from '../../sweep.ts';
import { aim, chain, part, piece, place, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { bevelBox, ridgedBand, stud, hexHead, sheet } from '../../cheap.ts';
import { ATTR } from '../../types.ts';
import { tint } from '../../surface.ts';

/** The lit liner's vertex-colour scale (× paper) deep in the bell and at the lip: its glow is this × the bulb class's lamp level. */
export const LINER_GLOW = { deep: 0.13, lip: 0.03 } as const;
/** Vent slots in the crown, and their glow (× amber-glow × the indicator level). */
const VENTS = 8;
const VENT_GLOW = 0.45;
import { DIM, LAMP_PLACE, solveArm, stageTarget } from './rig.ts';
import type { V3 } from './rig.ts';

export { DIM, LAMP_PLACE, STAGE_AIM, STAGE_BULB, solveArm, stageTarget } from './rig.ts';
export type { ArmSolution, V3 } from './rig.ts';

export interface LampOptions extends KitOptions {
  /** The filament, in the lamp's own space (default: the stage's key light with the lamp at LAMP_PLACE). */
  bulb?: V3;
  /** A point the shade looks at, in the lamp's own space (default: the stage's aim). */
  aim?: V3;
  /** Lit (default) or dark. */
  on?: boolean;
}

const DEG = Math.PI / 180;
/** The scale a swapped-out node is built at (collapsed into its pivot, inside the wrist hub). */
const HIDDEN = 1e-4;
/** Unit vector toward the camera at the stage's 33° pitch (good side +Z). */
const TO_CAMERA = new Vector3(0, Math.sin(33 * DEG), Math.cos(33 * DEG));

/** Turn a lathe built about +Y so its axis runs along +X (the node's arm direction). */
const Y_TO_X = new Matrix4().makeRotationZ(-Math.PI / 2);

/** Scale a geometry's vertex colours by f(local y) (the liner's glow falloff). */
function shadeBy(g: BufferGeometry, f: (y: number) => number): BufferGeometry {
  const c = g.getAttribute(ATTR.color);
  const p = g.getAttribute('position');
  for (let i = 0; i < c.count; i++) {
    const k = f(p.getY(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return g;
}

export function lamp(o: LampOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const hi = detail === 'high';
  const R = rng(seed);
  const target = stageTarget();
  const sol = solveArm(o.bulb ?? target.bulb, o.aim ?? target.aim);
  const b = piece('lamp', { detail, seed });

  const camSide = sol.pin.dot(TO_CAMERA) >= 0 ? 1 : -1;
  const arm1W = sol.arm1;
  const arm2W = arm1W.clone().multiply(sol.arm2);
  const shadeW = arm2W.clone().multiply(sol.shade);
  /** Which local Z (±1) points down in the world, for a node frame. */
  const downZ = (m: Matrix4): number => (new Vector3(0, 0, 1).transformDirection(m).y > 0 ? -1 : 1);

  // ====================================================================
  // THE RAIL: a steel tube on two brass stand-offs screwed to the wall
  // ====================================================================
  const { rail } = DIM;
  {
    const half = rail.len / 2;
    b.add(part('metal', sweep(linePath([-half, rail.y, rail.z], [half, rail.y, rail.z]), { radius: rail.r, segs: hi ? 12 : 8, ends: 'flat', detail }), 'steel', { seed: seed + 1, shade: 0.9 }));
    // turned end caps
    const cap = lathe(profile(0, 0).to(rail.r + 0.012, 0, { sharp: true }).to(rail.r + 0.012, 0.03, { fillet: 0.008, segs: 1 }).curve(0, 0.07, rail.r + 0.01, 0.07, 2), { segs: 8, detail, band: 0 });
    for (const s of [-1, 1]) b.add(part('brass', transform(cap.clone(), aim([s * half, rail.y, rail.z], [s, 0, 0])), 'brass', { seed: seed + 2 + s }));
    for (const x of [-0.55, 0.58]) {
      // a rosette on the wall, a turned post, a saddle round the rail
      const ros = lathe(profile(0, 0).to(0.1, 0, { sharp: true }).to(0.1, 0.016, { fillet: 0.008, segs: 1 }).to(0.05, 0.03, { fillet: 0.01, segs: 1 }).to(0, 0.032), { segs: 8, detail, band: 0 });
      b.add(part('brass', transform(ros, aim([x, rail.y, 0], [0, 0, 1])), 'brass', { seed: seed + 5, warm: 0.03 }));
      const post = lathe(profile(0, 0).to(0.034, 0, { sharp: true }).to(0.028, rail.z - 0.07, { smooth: true }).to(0.04, rail.z - 0.05, { fillet: 0.01, segs: 1 }).to(0, rail.z - 0.05), { segs: 7, detail, band: 0 });
      b.add(part('brass', transform(post, aim([x, rail.y, 0.02], [0, 0, 1])), 'brass', { seed: seed + 6 }));
      // the post's cupped top takes the rail
      // three screws in the rosette
      for (let k = 0; k < 2; k++) {
        const a = (k / 2) * Math.PI * 2 + R.range(0, 1);
        b.small(() => [part('metal', transform(stud(0.014, 0.01), aim([x + Math.cos(a) * 0.072, rail.y + Math.sin(a) * 0.072, 0.012], [0, 0, 1])), 'steel', { shade: 0.8 })]);
      }
    }
  }

  // ====================================================================
  // THE CLAMP: a brass C round the rail, the thumbscrew from below
  // ====================================================================
  const clampTop = rail.y + rail.r + 0.1;
  {
    const t = 0.17; // across X
    const top0 = rail.y + rail.r + 0.004;
    const bot1 = rail.y - rail.r - 0.05;
    const bot0 = bot1 - 0.085;
    // outline in (z, y), the throat open toward the wall
    const C: Array<[number, number]> = [
      [0.11, top0], [0.3, top0], [0.3, bot1], [0.13, bot1], [0.13, bot0], [0.385, bot0], [0.4, clampTop - 0.03], [0.36, clampTop], [0.11, clampTop],
    ];
    const g = extrude(C, t, { radius: [0.012, 0.012, 0.012, 0.012, 0.016, 0.03, 0.04, 0.03, 0.012], bevel: 0.016, segs: 1, detail, support: false });
    // drawn in (x = z, y), extruded along +Z: turn the extrusion onto X, centred
    transform(g, chain(T(t / 2, 0, 0), new Matrix4().makeRotationY(-Math.PI / 2)));
    b.add(setFinish(part('brass', g, 'brass', { seed: seed + 10, shade: 0.92, warm: 0.03 }), 0.15));
    // a cast boss on the spine's front, and a maker's rivet pair
    b.small(() => place([part('brass', stud(0.018, 0.012), 'brass', { seed: seed + 11 })], aim([-0.045, (bot0 + clampTop) / 2 + 0.05, 0.39], [0, 0, 1])));
    b.small(() => place([part('brass', stud(0.018, 0.012), 'brass', { seed: seed + 12 })], aim([0.045, (bot0 + clampTop) / 2 + 0.05, 0.392], [0, 0, 1])));
    // the thumbscrew: a pad under the rail, a threaded shank, a knurled wheel and a turned end
    const sx = 0, sz = rail.z;
    const pad = lathe(profile(0, 0).to(0.04, 0, { fillet: 0.006, segs: 1 }).to(0.04, 0.018, { fillet: 0.006, segs: 1 }).to(0, 0.018), { segs: 7, detail, band: 0 });
    b.add(part('metal', transform(pad, T(sx, rail.y - rail.r - 0.02, sz)), 'steel', { seed: seed + 13 }));
    const shank = lathe(
      (() => {
        const p = profile(0, bot0 - 0.2).to(0.022, bot0 - 0.2, { sharp: true });
        for (let k = 0; k < 3; k++) p.to(0.022, bot0 - 0.15 + k * 0.1, { smooth: true }).to(0.017, bot0 - 0.1 + k * 0.1, { smooth: true });
        return p.to(0.02, rail.y - rail.r - 0.02).to(0, rail.y - rail.r - 0.02);
      })(),
      { segs: 8, detail, band: 0 },
    );
    b.add(part('metal', transform(shank, T(sx, 0, sz)), 'steel', { seed: seed + 14 }));
    const wy = bot0 - 0.27;
    b.add(setFinish(part('brass', transform(ridgedBand(0.085, 0.05, hi ? 18 : 12, 0.01), T(sx, wy, sz)), 'brass', { seed: seed + 15 }), 0.4));
    const lips = lathe(profile(0, wy - 0.012).to(0.075, wy - 0.012, { fillet: 0.008, segs: 1 }).to(0.08, wy, { smooth: true }).to(0.08, wy + 0.05, { smooth: true }).to(0.06, wy + 0.068, { fillet: 0.01, segs: 1 }).to(0, wy + 0.072), { segs: 10, detail, band: 0 });
    b.add(part('brass', transform(lips, T(sx, 0, sz)), 'brass', { seed: seed + 16 }));
    const knob = lathe(profile(0, 0).to(0.032, 0, { sharp: true }).to(0.03, -0.05, { smooth: true }).curve(0, -0.08, 0.03, -0.08, 3), { segs: 7, detail, band: 0 });
    b.add(part('brass', transform(knob, T(sx, wy - 0.012, sz)), 'brass', { seed: seed + 17 }));
  }

  // ====================================================================
  // THE RISER: a swivel collar on the clamp, a short steel post, a knuckle
  // ====================================================================
  const S = sol.shoulder;
  {
    const y0 = clampTop;
    const col = lathe(profile(0, 0).to(0.11, 0, { sharp: true }).to(0.11, 0.025, { fillet: 0.01, segs: 1 }).to(0.075, 0.04, { fillet: 0.01, segs: 1 }).to(0.07, 0.11, { fillet: 0.015, segs: 1 }).to(0, 0.11), { segs: 10, detail, band: 0 });
    b.add(part('brass', transform(col, T(S.x, y0, S.z)), 'brass', { seed: seed + 20, warm: 0.03 }));
    const post = lathe(profile(0, 0).to(0.042, 0, { sharp: true }).to(0.042, S.y - y0 - 0.2, { smooth: true }).to(0, S.y - y0 - 0.2), { segs: 8, detail, caps: 'end', band: 0 });
    b.add(part('metal', transform(post, T(S.x, y0 + 0.1, S.z)), 'steel', { seed: seed + 21 }));
    // the tilt knuckle: a ball-ish brass casting the shoulder hub sits in
    const kn = lathe(profile(0, 0).to(0.05, 0, { sharp: true }).to(0.062, 0.03, { fillet: 0.02, segs: 2 }).curve(0.02, 0.12, 0.08, 0.11, 3).to(0, 0.125), { segs: 10, detail, band: 0 });
    b.add(part('brass', transform(kn, T(S.x, S.y - 0.17, S.z)), 'brass', { seed: seed + 22 }));
  }

  // ---- shared joint parts -------------------------------------------------
  /** A big wing nut along +Y (the kit's shape, cut to a third of its triangles: seen at 8-20 px). */
  const wing = (sz: number, sd: number): KitPart[] => {
    const body = lathe(profile(0, 0).to(sz * 0.3, 0, { sharp: true }).to(sz * 0.27, sz * 0.05, { smooth: true }).to(sz * 0.22, sz * 0.36, { fillet: sz * 0.05, segs: 1 }).to(0, sz * 0.4), { segs: 8, detail, band: 0, caps: false });
    const outline: Array<[number, number]> = [[sz * 0.14, sz * 0.04], [sz * 0.56, sz * 0.3], [sz * 0.56, sz * 0.66], [sz * 0.17, sz * 0.36]];
    const th = sz * 0.1;
    const w1 = transform(extrude(outline, th, { bevel: th * 0.3, bevelBase: th * 0.3, radius: [0, sz * 0.1, sz * 0.14, 0], segs: 1, support: false, detail: 'low' }), T(0, 0, -th / 2));
    const w2 = transform(w1.clone(), new Matrix4().makeRotationY(Math.PI));
    return [part('brass', body, 'brass', { seed: sd, jitter: 0.04 }), part('brass', w1, 'brass', { seed: sd + 1, jitter: 0.04 }), part('brass', w2, 'brass', { seed: sd + 2, jitter: 0.05 })];
  };
  /** A pin hub about the node's +Y, half-length hl. */
  const hub = (r: number, hl: number): BufferGeometry =>
    lathe(profile(0, -hl).to(r * 0.8, -hl, { sharp: true }).to(r, -hl + 0.02, { fillet: 0.012, segs: 1 }).to(r, hl - 0.02, { smooth: true }).to(r * 0.8, hl, { fillet: 0.012, segs: 1 }).to(0, hl), { segs: 9, detail, band: 0 });
  /** A tube along the node's +X at height y. */
  const tube = (x0: number, x1: number, y: number, r: number, z = 0): BufferGeometry => sweep(linePath([x0, y, z], [x1, y, z]), { radius: r, segs: hi ? 8 : 6, ends: 'flat', detail });
  /** A brass ferrule round a tube end, along +X from x. */
  const ferrule = (x: number, y: number, r: number, len: number, dir: 1 | -1): BufferGeometry => {
    const g = lathe(profile(r, 0).to(r + 0.014, 0.004, { smooth: true }).to(r + 0.014, len * 0.7, { smooth: true }).to(r + 0.004, len, { smooth: true }).to(r, len), { segs: 7, detail, band: 0, caps: false });
    return transform(g, chain(T(x, y, 0), new Matrix4().makeRotationZ(dir === 1 ? -Math.PI / 2 : Math.PI / 2)));
  };
  /** An exposed tension spring along +X from x0, `len` long, at (y, z), its hooks crossing to the tubes. */
  const springAlong = (x0: number, len: number, z: number, r: number, wire: number, seedK: number): KitPart[] => {
    // the coils as a turned stack of beads (a helix costs three times as much and reads the same at this size)
    const turns = Math.round(len / (wire * 5));
    const pitch = len / turns;
    const sp = profile(r - wire, 0);
    for (let k = 0; k < turns; k++) sp.to(r + wire, pitch * (k + 0.5), { smooth: true }).to(r - wire * 0.7, pitch * (k + 1), { smooth: true });
    const coil = lathe(sp, { segs: 5, detail, caps: false, band: 0 });
    const out: KitPart[] = [part('metal', transform(coil, chain(T(x0, 0, z), Y_TO_X)), 'steel', { seed: seedK, shade: 1.1 })];
    // hooks: a bent wire at each end, back to a lug on the arm's centreline
    for (const [xa, xb] of [[x0, x0 - 0.12], [x0 + len, x0 + len + 0.12]] as const) {
      out.push(part('metal', sweep(polylinePath([[xa, 0, z], [(xa + xb) / 2, 0, z * 0.9], [xb, 0, z * 0.25]], 0.02, 2), { radius: wire * 0.9, segs: 5, ends: 'round' }), 'steel', { seed: seedK + 1 }));
    }
    return out;
  };

  // ====================================================================
  // ARM 1 (the shoulder pin is its +Y)
  // ====================================================================
  const arm1 = b.node('arm1', sol.arm1);
  const L1 = DIM.l1, L2 = DIM.l2;
  const y1 = 0.13, r1 = 0.046;
  {
    arm1.add(part('brass', hub(0.1, 0.2), 'brass', { seed: seed + 30, warm: 0.03 }));
    for (const s of [-1, 1]) {
      arm1.add(part('metal', tube(0.06, L1 - 0.06, s * y1, r1), 'steel', { seed: seed + 31 + s, jitter: 0.04, shade: 1.25 }));
      arm1.add(part('brass', ferrule(0.05, s * y1, r1, 0.13, 1), 'brass', { seed: seed + 33 }));
      arm1.add(part('brass', ferrule(L1 - 0.05, s * y1, r1, 0.13, -1), 'brass', { seed: seed + 34 }));
    }
    // a spacer between the tubes at two places
    for (const x of [L1 * 0.6]) {
      const sp = lathe(profile(0, -y1).to(0.022, -y1, { sharp: true }).to(0.022, y1).to(0, y1), { segs: 8, detail, band: 0 });
      arm1.add(part('metal', transform(sp, T(x, 0, 0)), 'steel', { seed: seed + 35 }));
    }
    // the spring, slung under the arm, and the lug it hooks to
    const dz = downZ(arm1W);
    arm1.add(springAlong(0.36, 0.95, dz * 0.14, 0.05, 0.016, seed + 37));
    arm1.add(part('brass', bevelBox({ min: [0.12, -0.04, Math.min(0, dz * 0.13)], max: [0.26, 0.04, Math.max(0, dz * 0.13)], c: 0.014 }), 'brass', { seed: seed + 39 }));
    arm1.add(part('metal', bevelBox({ min: [1.43, -0.035, Math.min(0, dz * 0.12)], max: [1.55, 0.035, Math.max(0, dz * 0.12)], c: 0.012 }), 'steel', { seed: seed + 40 }));
  }
  // the shoulder's wing nut, on the side the visitor sees
  b.add(place(wing(0.2, seed + 41), aim([S.x + sol.pin.x * 0.2 * camSide, S.y + sol.pin.y * 0.2 * camSide, S.z + sol.pin.z * 0.2 * camSide], [sol.pin.x * camSide, sol.pin.y * camSide, sol.pin.z * camSide], R.range(0, 90))));

  // ====================================================================
  // ARM 2 (the elbow pin is its +Y)
  // ====================================================================
  const arm2 = arm1.node('arm2', sol.arm2);
  const y2 = 0.07, r2 = 0.04;
  {
    arm2.add(part('brass', hub(0.095, 0.19), 'brass', { seed: seed + 50, warm: 0.03 }));
    arm2.add(place(wing(0.19, seed + 51), aim([0, camSide * 0.19, 0], [0, camSide, 0], R.range(0, 90))));
    for (const s of [-1, 1]) {
      arm2.add(part('metal', tube(0.06, L2 - 0.06, s * y2, r2), 'steel', { seed: seed + 52 + s, jitter: 0.04, shade: 1.25 }));
      arm2.add(part('brass', ferrule(L2 - 0.05, s * y2, r2, 0.12, -1), 'brass', { seed: seed + 55 }));
    }
    const sp = lathe(profile(0, -y2).to(0.02, -y2, { sharp: true }).to(0.02, y2).to(0, y2), { segs: 8, detail, band: 0 });
    arm2.add(part('metal', transform(sp, T(L2 * 0.5, 0, 0)), 'steel', { seed: seed + 56 }));
    const dz = downZ(arm2W);
    arm2.add(springAlong(0.32, 0.62, dz * 0.12, 0.042, 0.014, seed + 57));
    arm2.add(part('metal', bevelBox({ min: [1.06, -0.03, Math.min(0, dz * 0.1)], max: [1.16, 0.03, Math.max(0, dz * 0.1)], c: 0.012 }), 'steel', { seed: seed + 58 }));
  }

  // ====================================================================
  // THE SHADE (the wrist pin is its +Y; the light runs along its +X)
  // ====================================================================
  const shade = arm2.node('shade', sol.shade);
  const fil = DIM.neck; // filament, along +X
  const bell0 = fil - 0.57; // where the bell's back starts
  const along = (y: number): Matrix4 => chain(T(bell0 + y, 0, 0), Y_TO_X);
  {
    shade.add(part('brass', hub(0.08, 0.15), 'brass', { seed: seed + 60, warm: 0.03 }));
    shade.add(place(wing(0.17, seed + 61), aim([0, camSide * 0.15, 0], [0, camSide, 0], R.range(0, 90))));
    // the stem and the neck housing (teal-light enamel, a groove, a brass switch knob)
    const stem = lathe(profile(0, 0).to(0.034, 0, { sharp: true }).to(0.034, 0.2).to(0, 0.2), { segs: 9, detail, band: 0, caps: 'end' });
    shade.add(part('brass', transform(stem, chain(T(0.04, 0, 0), Y_TO_X)), 'brass', { seed: seed + 62 }));
    const neck = lathe(profile(0, 0).to(0.075, 0, { fillet: 0.02, segs: 1 }).to(0.105, 0.05, { fillet: 0.02, segs: 1 }).to(0.105, 0.11).groove(0.008, 0.016, 0, 0).to(0.11, 0.2, { fillet: 0.014, segs: 1 }).to(0.16, 0.215, { sharp: true }).to(0, 0.225), { segs: 9, detail, band: 0 });
    shade.add(part('steel', transform(neck, chain(T(bell0 - 0.2, 0, 0), Y_TO_X)), 'teal-light', { seed: seed + 63, shade: 0.8 }));
    const dzS = downZ(shadeW);
    const knob = lathe(profile(0, 0).to(0.03, 0, { sharp: true }).to(0.028, 0.04).to(0.04, 0.045, { fillet: 0.008, segs: 1 }).to(0.04, 0.075, { fillet: 0.012, segs: 1 }).to(0, 0.08), { segs: 7, detail, band: 0 });
    shade.add(setFinish(part('brass', transform(knob, aim([bell0 - 0.11, camSide * 0.1, 0], [0, camSide, 0])), 'brass', { seed: seed + 64 }), 0.4));
    // the cord's gland on top of the housing
    const gl = lathe(profile(0, 0).to(0.035, 0, { sharp: true }).to(0.032, 0.05, { fillet: 0.006, segs: 1 }).to(0.026, 0.06).to(0, 0.06), { segs: 9, detail, band: 0 });
    shade.add(part('rubber', transform(gl, aim([bell0 - 0.1, 0, -dzS * 0.1], [0, 0, -dzS])), 'ink'));

    // the bell, outside: teal enamel, a dent where it was knocked into the wall
    const outerProfile = profile(0.11, -0.012)
        .to(0.165, 0.0, { fillet: 0.03, segs: 2 })
        .cubic(0.36, 0.13, 0.25, 0.0, 0.33, 0.06, hi ? 3 : 2)
        .to(0.38, 0.14, { sharp: true })
        .cubic(0.455, 0.36, 0.42, 0.18, 0.45, 0.26, hi ? 3 : 2)
        .bead(0.022, 0.06, hi ? 4 : 3)
        .cubic(0.598, 0.81, 0.47, 0.56, 0.57, 0.72, hi ? 5 : 3);
    const outer = lathe(outerProfile, { segs: hi ? 22 : 14, detail, caps: false, band: 0 });
    /** The bell's outside at height y along its axis: radius and the outward normal (o, y). */
    const bellAt = (y: number): { o: number; no: number; ny: number } => {
      const sm = outerProfile.expand({ detail: 1 });
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1]!, c = sm[i]!;
        if ((a.y - y) * (c.y - y) <= 0 && Math.abs(c.y - a.y) > 1e-6) {
          const f = (y - a.y) / (c.y - a.y);
          const no = c.o - a.o, ny = -(c.y - a.y); // a normal to the segment, outward
          const l = Math.hypot(no, ny);
          return { o: a.o + (c.o - a.o) * f, no: Math.abs(ny / l), ny: -Math.abs(no / l) * Math.sign(c.o - a.o || 1) };
        }
      }
      return { o: 0.3, no: 1, ny: 0 };
    };
    shade.add(part('steel', transform(outer, along(0)), 'teal-panel', { seed: seed + 65, shade: 1.08, jitter: 0.03 }));
    // the rolled lip: cream enamel wrapped over the edge
    const lip = lathe(profile(0.596, 0.8).to(0.632, 0.838, { fillet: 0.02, segs: 1 }).to(0.614, 0.872, { fillet: 0.014, segs: 1 }).to(0.58, 0.858, { sharp: true }).to(0.572, 0.82).close(), { segs: hi ? 20 : 14, detail, band: 0 });
    {
      // a rolled lip is all edge: halve its wear so it chips in places, not everywhere
      const sf = lip.getAttribute(ATTR.surf);
      for (let i = 0; i < sf.count; i++) sf.setX(i, sf.getX(i) * 0.45);
    }
    shade.add(part('steel', transform(lip, along(0)), 'paper', { seed: seed + 66, shade: 0.82 }));
    // a brass maker's badge riveted on the visitor's side of the bell
    {
      const toCam = TO_CAMERA.clone().transformDirection(shadeW.clone().invert());
      const ang = Math.atan2(toCam.z, toCam.y) + R.spread(0.15);
      const yb = 0.6, ob = 0.548, slope = Math.atan(0.5);
      const at = chain(T(bell0 + yb, 0, 0), new Matrix4().makeRotationX(ang), T(0, ob + 0.004, 0), new Matrix4().makeRotationZ(-slope));
      shade.add(setFinish(part('brass', transform(bevelBox({ min: [-0.09, 0, -0.055], max: [0.09, 0.012, 0.055], c: 0.005, omit: ['ny'] }), at), 'brass', { seed: seed + 70, shade: 0.9 }), 0.3));
      for (const x of [-0.065, 0.065]) shade.add(part('brass', transform(stud(0.012, 0.01), chain(at, T(x, 0.012, 0))), 'brass', { seed: seed + 71 }));
      // two engraved lines on it (no words: a maker's name would be a claim)
      for (const z of [-0.018, 0.018]) shade.add(part('metal', transform(bevelBox({ min: [-0.06, 0.012, z - 0.004], max: [0.06, 0.0135, z + 0.004], c: 0 }), at), 'ink', { shade: 1.5 }));
    }
    // the socket cup at the back of the bell, inside
    const cup = lathe(profile(0, 0.02).to(0.13, 0.02, { sharp: true }).to(0.13, 0.17, { fillet: 0.012, segs: 1 }).to(0.105, 0.19, { fillet: 0.01, segs: 1 }).to(0.08, 0.19).to(0, 0.19), { segs: 8, detail, band: 0 });
    shade.add(part('brass', transform(cup, along(0)), 'brass', { seed: seed + 67, shade: 0.8 }));
    const screw = lathe(
      (() => {
        const p = profile(0, 0.19).to(0.074, 0.19, { sharp: true });
        for (let k = 0; k < 2; k++) p.to(0.08, 0.22 + k * 0.06, { smooth: true }).to(0.07, 0.25 + k * 0.06, { smooth: true });
        return p.to(0.064, 0.345).to(0, 0.345);
      })(),
      { segs: 8, detail, band: 0 },
    );
    shade.add(part('brass', transform(screw, along(0)), 'brass', { seed: seed + 68 }));

    // the liner and the bulb: lit, and their dark twins
    const linerProfile = (): ReturnType<typeof profile> =>
      profile(0.578, 0.83)
        .cubic(0.47, 0.5, 0.555, 0.76, 0.505, 0.7, hi ? 4 : 3)
        .cubic(0.12, 0.035, 0.45, 0.22, 0.28, 0.05, hi ? 5 : 3)
        .to(0.12, 0.03);
    const glassProfile = (): ReturnType<typeof profile> =>
      profile(0.062, 0.335)
        .cubic(0.205, 0.6, 0.066, 0.43, 0.205, 0.46, 4)
        .curve(0, 0.8, 0.205, 0.8, 4);
    const lit = shade.node('lit');
    {
      const liner = lathe(linerProfile(), { segs: hi ? 18 : 12, detail, caps: false, band: 0 });
      // the bulb's own glow on its reflector: brightest deep in the bell, falling toward the lip
      tint(liner, 'paper');
      const g = shadeBy(liner, (y) => LINER_GLOW.deep - (LINER_GLOW.deep - LINER_GLOW.lip) * Math.min(1, Math.max(0, (y - 0.1) / 0.72)) ** 0.8);
      lit.add(part('bulb', transform(g, along(0))));
      const glass = lathe(glassProfile(), { segs: hi ? 9 : 8, detail, caps: false, band: 0 });
      lit.add(part('bulb', transform(glass, along(0)), 'amber-glow'));
    }
    // vent slots round the crown, the light leaking out of them: what tells the visitor,
    // who only ever sees the back of the shade, that this lamp is the one that is on
    const slots = (lit: boolean): KitPart[] => {
      const out: KitPart[] = [];
      const sAt = bellAt(0.075);
      const t = new Vector3(-sAt.ny, sAt.no, 0); // the dome's meridian here (o, y)
      for (let k = 0; k < VENTS; k++) {
        const phi = ((k + 0.5) / VENTS) * Math.PI * 2;
        const c = Math.cos(phi), sn = Math.sin(phi);
        // frame in lathe space: X along the meridian, Z out of the dome
        const X = new Vector3(t.x * c, t.y, t.x * sn);
        const Z = new Vector3(sAt.no * c, sAt.ny, sAt.no * sn);
        const Y = new Vector3().crossVectors(Z, X);
        const at = new Matrix4().makeBasis(X, Y, Z).setPosition(sAt.o * c + Z.x * 0.003, 0.075 + Z.y * 0.003, sAt.o * sn + Z.z * 0.003);
        if (lit) out.push(setFinish(part('bulb', transform(sheet({ w: 0.12, h: 0.03, t: 0.002, nx: 1, ny: 1 }), chain(along(0), at)), 'amber-glow', { shade: VENT_GLOW }), 1));
        // the slot's dark surround (it is a hole in the steel; the glow sits in it)
        else out.push(part('rubber', transform(sheet({ w: 0.145, h: 0.05, t: 0.001, nx: 1, ny: 1 }), chain(along(0), at)), 'ink', { shade: 0.5 }));
      }
      return out;
    };
    lit.add(slots(true));
    shade.add(slots(false));
    const unlit = shade.node('unlit', new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN));
    {
      const liner = lathe(linerProfile(), { segs: 10, detail: 'low', caps: false, band: 0 });
      unlit.add(part('steel', transform(liner, along(0)), 'paper', { seed: seed + 69, shade: 0.9 }));
      const glass = lathe(glassProfile(), { segs: 6, detail: 'low', caps: false, band: 0 });
      unlit.add(part('glass', transform(glass, along(0)), 'amber-glow'));
    }
  }

  // ====================================================================
  // THE CORD: brown cloth, out of the neck, slung under the arms, down past
  // the clamp and away along the foot of the wall
  // ====================================================================
  const cordEnd: V3 = [-1.25, 0.024, 0.26];
  {
    const at = (m: Matrix4, x: number, y: number, z: number): V3 => {
      const v = new Vector3(x, y, z).applyMatrix4(m);
      return [v.x, v.y, v.z];
    };
    const d2 = downZ(arm2W), d1 = downZ(arm1W), dS = downZ(shadeW);
    const pts: V3[] = [
      at(shadeW, bell0 - 0.1, 0, -dS * 0.16),
      at(shadeW, bell0 - 0.28, 0, -dS * 0.2),
      at(arm2W, L2 - 0.1, 0, d2 * 0.1),
      at(arm2W, L2 * 0.62, 0, d2 * 0.17),
      at(arm2W, L2 * 0.25, 0, d2 * 0.12),
      at(arm2W, -0.05, 0, d2 * 0.22),
      at(arm1W, L1 * 0.85, 0, d1 * 0.17),
      at(arm1W, L1 * 0.5, 0, d1 * 0.22),
      at(arm1W, L1 * 0.18, 0, d1 * 0.16),
      [S.x + 0.12, S.y - 0.25, S.z + 0.14],
      [0.16, clampTop - 0.05, 0.46],
      [0.2, rail.y - 0.3, 0.46],
      [0.14, 0.42, 0.38],
      [-0.12, 0.12, 0.3],
      [-0.4, 0.024, 0.24],
      [-0.8, 0.024, 0.28],
      cordEnd,
    ];
    b.add(part('rubber', sweep(curvePath(new CatmullRomCurve3(pts.map((q) => new Vector3(...q)), false, 'centripetal'), hi ? 34 : 22), { radius: 0.034, segs: 5, ends: 'flat', detail }), 'wood', { seed: seed + 80, shade: 0.45 }));
    // a hex nut on the clamp's spine, the cord's strain hook
    b.small(() => [part('metal', transform(hexHead(0.05, 0.025, 0.3), aim([0.13, clampTop - 0.12, 0.395], [0, 0, 1])), 'steel', { seed: seed + 82 })]);
  }

  // sockets
  const bulbM = chain(shadeW, T(fil, 0, 0), new Matrix4().makeRotationZ(-Math.PI / 2));
  b.socket('bulb', bulbM);
  b.socket('rail', T(0, rail.y, rail.z));
  b.socket('cord', chain(T(...cordEnd), new Matrix4().makeRotationZ(Math.PI / 2)));
  const built = b.build();
  if (o.on === false) posePiece(built.root, { on: false });
  return built;
}

export interface LampPose {
  /** Lit (true) or dark. */
  on?: boolean;
}

/** The node transforms `lit`/`unlit` take for a pose (Piece description). */
export function posePiece(root: PieceNode, pose: LampPose): void {
  const on = pose.on ?? true;
  const walk = (n: PieceNode): void => {
    if (n.name === 'lit') n.transform = on ? new Matrix4() : new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN);
    if (n.name === 'unlit') n.transform = on ? new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN) : new Matrix4();
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

/** Pose a realized lamp: lit or dark. (Level and colour are the light rig's and the bulb material's: `stage.lights.setLamp`.) */
export function poseLamp(root: Object3D, pose: LampPose): void {
  const on = pose.on ?? true;
  const lit = root.getObjectByName('lit');
  const unlit = root.getObjectByName('unlit');
  if (lit) {
    lit.scale.setScalar(1);
    lit.visible = on;
  }
  if (unlit) {
    unlit.scale.setScalar(1);
    unlit.visible = !on;
  }
}

/**
 * Where the key light goes for a lamp piece placed at `place` (world, no yaw):
 * the filament's world position, and a point `reach` along the shade's axis to aim at.
 * Pass both to `stage.lights.setBulb(position, aim)`.
 */
export function keyLight(p: Piece, place: V3 = LAMP_PLACE, reach = 6.7): { position: V3; aim: V3 } {
  const m = p.sockets?.['bulb'];
  if (!m) throw new Error('lamp: no bulb socket');
  const o = new Vector3().setFromMatrixPosition(m).add(new Vector3(...place));
  const d = new Vector3(0, 1, 0).transformDirection(m);
  const a = o.clone().addScaledVector(d, reach);
  return { position: [o.x, o.y, o.z], aim: [a.x, a.y, a.z] };
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'lamp',
    build: (opts = {}) => {
      const o: LampOptions = {};
      if (opts.seed !== undefined) o.seed = opts.seed;
      if (opts.detail) o.detail = opts.detail;
      if (opts['pose'] === 'off') o.on = false;
      return lamp(o);
    },
    variants: { high: { detail: 'high' }, low: { detail: 'low' }, off: { pose: 'off' }, 'seed 2': { seed: 2 } },
    poses: ['on', 'off'],
    camera: { distance: 12 },
    note: 'The lamp: the key light\'s body, clamped to a wall rail; its bulb socket is the stage\'s default key light (place it at x -4.5, z -5).',
  },
];
