/**
 * Pitch on the bench (P4 P1a; E1): everything of him the simulation needs, in a module of its own so that it is
 * fetched in his own chunk after the bench is usable (astro.config's `late-pitch` group; shell/late.ts). Nothing the
 * page loads first imports this file: `scripts/budget.ts` fails the build if a late chunk is ever reached eagerly.
 */
import type { Vec3 } from '../types.ts';
import type { LateArrival, PartSpec, SceneDesc } from '../scene.ts';
import { pitch } from '../crew/pitch.ts';
import type { PitchSpec } from '../crew/pitch.ts';
import { AT, BARE, CREW_SCALE, LINE, PATCHLAMP, REVERT, beltTop, pose } from './bench.ts';

/**
 * Where he moors (P1a): the mast's foot on the bench (x, z), the way his nose points moored (radians about +Y; 0 faces
 * the visitor), and the mast's height in the kit's units (the view's `pitchMast`; drawn at the crew's scale). Behind
 * the platen and right of Revert's park, on the right of the bench where the lamp's arm never reaches, in the home
 * picture at 1440×900 and at the right edge of a phone's centre cluster. ONE place to move him: everything below is
 * read from it.
 */
export const PITCH_AT = { mast: [5.6, -0.7] as const, heading: -0.85, mastHeight: 1.4 } as const;

/** The mast's cup as the kit piece has it (pitch/index.ts `pitchMast`: the head's cup 0.1 out along its +X, 0.02 under its top), kit units. */
const MAST_CUP = { out: 0.1, below: 0.02 } as const;
/** His hull's nose ahead of his middle (pitch/index.ts `BODY.nose`, kit units), and a hair of the cup's lip. */
const PITCH_NOSE = 0.34 * CREW_SCALE + 0.015;

/**
 * Pitch's own body (`PartSpec.crewBody`; sim/crew/pitch.ts): out of the world while his script has him; in it while
 * he is held, loose, or on the platen's tray. A balloon: almost no weight (0.12: a small crate is 0.06, a middle one
 * 0.14), no gravity (his unit takes it away), heavy drag (1.6 a second: a throw at 14 units/s is down to his slow in
 * under two seconds and about nine units), a soft bounce, little grip. Its box is his envelope round its middle and the
 * briefcase under it, nearly as tall as it is wide and deep and rounded as far as the engine allows, so its turning
 * (which is never drawn) hardly changes what it meets. Kind `robot`: the platen paints him as it paints Fetch.
 */
export const PITCH_BODY: PartSpec = {
  id: 'pitch-body',
  kind: 'robot',
  size: 'M',
  material: 'paper',
  colour: BARE,
  label: '',
  station: 'patchlamp',
  name: 'name.pitch',
  pose: pose([0, -4, 0]),
  crewBody: true,
  half: [0.56, 0.5, 0.56],
  round: 0.25,
  mass: 0.12,
  feel: { friction: 0.2, restitution: 0.35, linearDamping: 1.6, angularDamping: 6 },
};

/** Pitch's spec, every number from `PITCH_AT` and the bench's own tables. */
export const PITCH_SPEC: PitchSpec = (() => {
  const h = PITCH_AT.heading;
  const fwd: Vec3 = [Math.sin(h), 0, Math.cos(h)];
  const [mx, mz] = PITCH_AT.mast;
  const cup: Vec3 = [mx - fwd[0] * MAST_CUP.out * CREW_SCALE, (PITCH_AT.mastHeight - MAST_CUP.below) * CREW_SCALE, mz - fwd[2] * MAST_CUP.out * CREW_SCALE];
  const hammer: Vec3 = [LINE.strikerX, LINE.belt.top, LINE.belt.z];
  return {
    id: 'pitch',
    body: PITCH_BODY.id,
    station: 'patchlamp',
    name: 'name.pitch',
    mast: cup,
    heading: h,
    nose: PITCH_NOSE,
    // his middle on his way: his keel (0.62 under it) over everything that stands on the bench (the board's panel 3.21,
    // the storefront 2.83, the striker's arm at the top of its swing, a stack at its tallest), under the frame's top
    cruise: 4.2,
    stops: [
      { over: [hammer[0] + 0.1, 3.7, hammer[2] - 0.4], look: hammer },
      { over: [LINE.door.origin[0] + 0.2, 3.7, LINE.door.origin[2] - 0.4], look: [LINE.door.origin[0], 0.6, LINE.door.origin[2]] },
      { over: [PATCHLAMP.seat[0] - 0.1, 3.75, PATCHLAMP.seat[2] + 0.3], look: [PATCHLAMP.seat[0], PATCHLAMP.seat[1] + 0.1, PATCHLAMP.seat[2]] },
      { over: [AT.storefront.c[0], 3.7, AT.storefront.c[2] + 0.6], look: [AT.storefront.c[0], 1.6, AT.storefront.c[2] + 0.5] },
      { over: [0.6, 3.7, AT.belt.c[2] - 0.1], look: [0.0, beltTop, AT.belt.c[2]] },
    ],
    // the lamp's arm: everywhere it can be is left of x 2.8 and behind z 2.6, never lower than 2.6 (measured over its
    // whole reach, view/kit/pieces/lamp/aim.ts: shots/p4/pitch/lampreach.ts); his top is 0.5 over his middle
    lamp: { maxX: 2.8, maxZ: 2.6, under: 2.1 },
    keepOut: [
      // Patch on its stool, anywhere along its runner (it sits about 1.6 tall on a 0.69 seat)
      { min: [AT.boardRunner.c[0] - AT.boardRunner.half[0] - 0.3, 0, AT.stool.c[2] - 0.5], max: [AT.stool.c[0] + 0.7, 2.45, AT.stool.c[2] + 0.5] },
      // Revert up out of its hatch, along its track behind the console to the Button (1.34 tall), and in its park
      { min: [AT.revert.c[0] - AT.revert.half[0] - 0.05, 0, REVERT.park.z - 1.1], max: [REVERT.button.x + 1.05, 1.36, AT.revert.c[2] + AT.revert.half[2] + 0.05] },
      { min: [REVERT.park.x - 1.3, 0, REVERT.park.z - 1.1], max: [REVERT.park.x + 1.25, 1.36, REVERT.park.z + 1.1] },
      // Fetch on its lane (1.5 tall, its aerial and a crate held up over it)
      { min: [AT.lane.points[0][0] - 0.8, 0, AT.lane.points[2][1] - 0.7], max: [AT.lane.points[3][0] + 0.75, 1.8, AT.lane.points[0][1] + 0.75] },
      // the striker's arm at the top of its swing, and the dock's lamp over its portal (view/bench.ts BOUNDS)
      { min: [2.975 - 0.52, 0, 3.072 - 0.31], max: [2.975 + 0.72, 2.6, 3.072 + 1.19] },
      { min: [LINE.door.origin[0] - 1.7, 0, LINE.door.origin[2] - 1.35], max: [LINE.door.origin[0] + 1.38, 2.4, LINE.door.origin[2] + 1.2] },
      // the return chute's riser and mouth (no body: view/bench.ts BOUNDS.chute at (-7.8, 5))
      { min: [-7.8 - 0.57, 0, 5 - 2.69], max: [-7.8 + 1.16, 1.8, 5] },
    ],
    bounds: { minX: AT.bench.minX + 0.6, maxX: AT.bench.maxX - 0.6, minZ: AT.backWall.c[2] + AT.backWall.half[2] + 0.9, maxZ: AT.bench.maxZ - 0.4, maxY: 6.5 },
    tray: PATCHLAMP.platenMouth.id,
    dock: 'dock',
    door: { at: LINE.door.origin, out: [-LINE.door.inward[0], 0, -LINE.door.inward[2]] },
    visitor: PATCHLAMP.patch.visitor,
    // (E1) the mast's foot and its height, and where a late arrival comes in from: past the bench's right end (the
    // window's side), high, a little in front of the mast's line
    mastFoot: [mx, 0, mz],
    mastHeight: PITCH_AT.mastHeight * CREW_SCALE,
    entry: [AT.bench.maxX + 4.5, 6.4, mz + 0.4],
  };
})();

/**
 * The bench with Pitch on it from the first step (the tests; and a world that joined him is meant to agree with this
 * from the step he has finished arriving): his body the last of its parts, his unit the last of its units (nothing
 * before them moves in the order).
 */
export function withPitch(scene: SceneDesc): SceneDesc {
  return { ...scene, parts: [...scene.parts, PITCH_BODY], units: [...(scene.units ?? []), pitch(PITCH_SPEC)] };
}

/**
 * (E1) Pitch as a late unit: his body and his unit, which begins on his entrance (`World.join`). The shell's late
 * loader (shell/late.ts) fetches this module in a chunk of its own after the bench is usable.
 */
export function pitchArrival(): LateArrival {
  return { id: 'pitch', parts: [PITCH_BODY], units: [pitch(PITCH_SPEC, { arrive: true })] };
}

