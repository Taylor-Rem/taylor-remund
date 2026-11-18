/**
 * The warning beacon (REWRITE.md § B4 rung 4, "a turning warning lamp"; W3
 * round 2). Registry name `beacon`.
 *
 * A small rotating warning lamp of the kind bolted to a machine that should
 * never need it: a square steel mount plate with two studs, a short brass
 * stalk, a dark enamel collar, an amber dome, and a wire guard of three
 * hoops over the dome with a little cap where they meet. It stands on the
 * Button's console from the first moment of the visit, dark and a little
 * dusty, so a visitor wonders what it is for; on rung 4 it lights and turns.
 *
 * The dome comes in twins (drawing is skinned: nothing is made invisible,
 * only shrunk): `beacon.unlit`, a dark amber glass dome; and `beacon.mirror`,
 * the lit dome, one half bright (the turning reflector's side, lamp level, so
 * it blooms) and one half dull (indicator level). The mirror node turns about
 * its Y: the bright side sweeps round. `poseBeacon` sets both.
 *
 * Local frame: the mount's centre on the surface it stands on (y = 0). About
 * 0.42 tall, 0.2 across: built at bench scale, place at scale 1.
 */
import { Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { KitOptions, Piece, PieceNode } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { bevelBox, stud } from '../../cheap.ts';
import { arcPath, sweep } from '../../sweep.ts';
import { part, piece, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { rng } from '../../rng.ts';

/** Dimensions the view needs. */
export const BEACON = {
  /** The dome's centre of turning (its base) above the mount, its radius and height. */
  domeY: 0.2,
  domeR: 0.085,
  domeH: 0.15,
  /** Top of the guard. */
  top: 0.41,
  /** The mount plate's half size. */
  plate: 0.1,
} as const;

/** Scale of a hidden twin. */
export const HIDDEN = 1e-4;

export interface BeaconPose {
  /** Lit (the mirror dome shown, the dark one hidden). */
  lit?: boolean;
  /** The reflector's angle about Y, radians (0: the bright side faces +Z, the visitor). */
  angle?: number;
}

export const BEACON_POSES: Readonly<Record<string, BeaconPose>> = {
  dark: {},
  lit: { lit: true, angle: 0 },
  'lit-side': { lit: true, angle: Math.PI / 2 },
  'lit-away': { lit: true, angle: Math.PI },
};

export interface BeaconOptions extends KitOptions {
  pose?: string | BeaconPose;
}

const turn = (p: Parameters<typeof lathe>[0], o: Parameters<typeof lathe>[1] = {}) => lathe(p, { band: 0, support: false, ...o });

/** The dome's profile: from the axis at the base, out, up and over to the axis at the top. */
const domeProfile = () =>
  profile(0, 0)
    .to(BEACON.domeR, 0, { sharp: true })
    .to(BEACON.domeR, BEACON.domeH * 0.45, { smooth: true })
    .to(BEACON.domeR * 0.78, BEACON.domeH * 0.86, { smooth: true })
    .to(0, BEACON.domeH);

export function beacon(o: BeaconOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const low = detail === 'low';
  const R = rng(seed);
  const b = piece('beacon', { detail, seed });

  // the mount: a square steel plate a little askew, two studs
  const tw = R.spread(0.04);
  b.add(part('steel', transform(bevelBox({ min: [-BEACON.plate, 0, -BEACON.plate * 0.8], max: [BEACON.plate, 0.016, BEACON.plate * 0.8], c: 0.005 }), new Matrix4().makeRotationY(tw)), 'ink', { seed: seed + 1, shade: 1.1, jitter: 0.05 }));
  for (const s of [-1, 1]) b.add(setFinish(part('brass', transform(stud(0.013, 0.01, 5), T(s * 0.068 * Math.cos(tw), 0.015, -s * 0.068 * Math.sin(tw))), 'brass', { seed: seed + 2 + s }), 0.3));
  // the stalk and the collar
  b.add(grain(setFinish(part('brass', turn(profile(0, 0.014).to(0.021, 0.014, { sharp: true }).to(0.018, 0.09, { sharp: true }).to(0, 0.09), { segs: low ? 6 : 8, caps: 'end' }), 'brass', { seed: seed + 4 }), 0.45), 'y'));
  b.add(
    part(
      'steel',
      turn(
        profile(0, 0.085)
          .to(0.05, 0.085, { fillet: 0.01, segs: 1 })
          .to(BEACON.domeR + 0.012, BEACON.domeY - 0.03, { fillet: 0.006, segs: 1 })
          .to(BEACON.domeR + 0.012, BEACON.domeY + 0.004, { fillet: 0.004, segs: 1 })
          .to(0, BEACON.domeY + 0.004),
        { segs: low ? 10 : 14, caps: 'end' },
      ),
      'ink',
      { seed: seed + 5, shade: 1.25 },
    ),
  );

  // the dark dome: amber glass with no light behind it
  const domeSegs = low ? 10 : 14;
  b.node('beacon.unlit', T(0, BEACON.domeY, 0)).add(part('glass', turn(domeProfile(), { segs: domeSegs, caps: 'end' }), 'amber', { seed: seed + 6, shade: 0.55 }));
  // the lit dome, turning: the reflector's bright half, and the dull half behind it
  const lit = b.node('beacon.mirror', T(0, BEACON.domeY, 0));
  const half = Math.ceil(domeSegs / 2);
  // bright side centred on +Z (angle π/2 in the lathe's convention)
  lit.add(setFinish(part('bulb', turn(domeProfile(), { segs: half, from: Math.PI / 2 - Math.PI / 2, to: Math.PI / 2 + Math.PI / 2, caps: 'end' }), 'amber-glow', { seed: seed + 7 }), 0));
  lit.add(setFinish(part('bulb', turn(domeProfile(), { segs: half, from: Math.PI, to: Math.PI * 2, caps: 'end' }), 'amber', { seed: seed + 8, shade: 0.55 }), 1));

  // the wire guard: three hoops over the dome, a cap where they meet, a little bent
  const gr = BEACON.domeR + 0.022;
  const gy = BEACON.domeY;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + 0.25 + R.spread(0.04);
    const ax: [number, number, number] = [Math.cos(a), 0, Math.sin(a)];
    const path = arcPath(new Vector3(0, gy + 0.02, 0), gr, 0.02, Math.PI - 0.02, low ? 6 : 8, ax, [0, 1.25, 0]);
    b.add(part('metal', sweep(path, { radius: 0.0055, segs: 3, ends: 'flat', detail }), 'steel', { seed: seed + 10 + i, shade: 0.9 }));
  }
  b.add(setFinish(part('metal', transform(stud(0.022, 0.014, 6), T(0, gy + 0.02 + gr * 1.25 - 0.004, 0)), 'steel', { seed: seed + 14 }), 0.5));

  b.socket('dome', T(0, BEACON.domeY + BEACON.domeH * 0.5, 0));
  const built = b.build();
  // at rest it is dark (the lit twin was built in place, for the bake; it is shrunk away here)
  const p = o.pose === undefined ? BEACON_POSES.dark! : typeof o.pose === 'string' ? BEACON_POSES[o.pose] : o.pose;
  if (p) posePiece(built.root, p);
  return built;
}

/** The two dome nodes' transforms for a pose. */
function beaconMatrices(p: BeaconPose, unlit: Matrix4, mirror: Matrix4): void {
  const on = !!p.lit;
  unlit.makeScale(on ? HIDDEN : 1, on ? HIDDEN : 1, on ? HIDDEN : 1).setPosition(0, BEACON.domeY, 0);
  const s = on ? 1 : HIDDEN;
  mirror.makeRotationY(p.angle ?? 0).scale(new Vector3(s, s, s)).setPosition(0, BEACON.domeY, 0);
}

/** Pose a realized beacon: shows the lit or dark dome and turns the reflector. No allocation. */
export function poseBeacon(root: Object3D, p: BeaconPose): void {
  const u = root.getObjectByName('beacon.unlit');
  const m = root.getObjectByName('beacon.mirror');
  const on = !!p.lit;
  if (u) {
    u.position.set(0, BEACON.domeY, 0);
    u.scale.setScalar(on ? HIDDEN : 1);
  }
  if (m) {
    m.position.set(0, BEACON.domeY, 0);
    m.rotation.set(0, p.angle ?? 0, 0);
    m.scale.setScalar(on ? 1 : HIDDEN);
  }
}

function posePiece(root: PieceNode, p: BeaconPose): void {
  const walk = (n: PieceNode): void => {
    if (n.name === 'beacon.unlit') beaconMatrices(p, (n.transform = new Matrix4()), new Matrix4());
    if (n.name === 'beacon.mirror') beaconMatrices(p, new Matrix4(), (n.transform = new Matrix4()));
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'beacon',
    build: (opts = {}) =>
      beacon({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        pose: typeof opts['pose'] === 'string' ? opts['pose'] : 'dark',
      }),
    poses: Object.keys(BEACON_POSES),
    variants: { low: { detail: 'low' }, lit: { pose: 'lit' }, 'seed 2': { seed: 2 } },
    camera: { distance: 1.4 },
    note: 'The warning beacon on the Button’s console: dark and dusty until rung 4, then lit and turning (beacon.mirror about Y). ?pose=' + Object.keys(BEACON_POSES).join('|'),
  },
];
