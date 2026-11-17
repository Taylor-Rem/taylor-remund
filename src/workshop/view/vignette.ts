/**
 * The vignette (REWRITE.md § G "P1. The vignette", § C, § B3 "The centre
 * cluster"): the list of station views that make the slice of bench, and
 * the layout they are composed by.
 *
 * Everything is found by name: a piece by its registry name
 * (`kit/pieces/<name>/index.ts`), a station view by its file
 * (`view/stations/<name>.ts`). Until a piece or a view exists on `rewrite`,
 * its slot holds a clearly temporary stand-in of the right size (clay), and
 * `slots` says so; when it lands, the slot switches over by itself.
 *
 * The layout. Positions the simulation needs (the Button's console, the
 * stack, Fetch's lane, the board and its jacks, the belt) live in the
 * simulation's table (`sim/scenes/vignette.ts` `AT`). The composition needs
 * different numbers (the real pieces are bigger than the placeholders), so
 * `LAYOUT` below is a LOCAL OVERRIDE: `vignetteScene()` derives a scene from
 * the simulation's with these numbers (and the real pieces' measured sizes
 * and sockets) and the page boots the world from it. The numbers are handed
 * to the simulation's engineer to move into `AT`; until then they live here.
 * Purely decorative things with no body in the simulation (the sign, the
 * tool wall, the lamp's body) are placed here and nowhere else.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id, Pose, SceneDesc, Vec3 } from '../sim/types.ts';
import { vignette as SIM_VIGNETTE } from '../sim/index.ts';
import type { StationView, StationViewFactory, ViewContext, Frame } from './types.ts';
import type { Piece } from './kit/types.ts';
import { listPieces, buildEntry, type Entry } from './catalogue/registry.ts';
import { pieceBounds } from './kit/compose.ts';
import { createPartsView } from './stations/parts.ts';
import { createSetView, flatten, mergedPiece, type Placed, type StaticPool } from './stations/set.ts';
import { createBeltView } from './stations/belt.ts';
import { createCordView } from './stations/cord.ts';
import { createPatchView } from './stations/patch.ts';
import type { Token } from './palette.ts';
import { paints } from './palette.ts';

const DEG = Math.PI / 180;

// ───────────────────────── the layout (local override; see above) ─────────────────────────

/**
 * The composition, in bench units (art-direction § 2: +X right, +Z toward the
 * visitor, bench top y = 0, back wall face at z = -5). Yaw in degrees.
 * Every object stands at its piece origin (resting on y = 0, good side +Z).
 */
export const LAYOUT = {
  /** The Big Red Button's console, front of centre (its origin: the console's centre line). */
  button: { x: 0.15, z: 0.55 },
  /** The crate stack: ground position of the bottom crate. Left of the Button, in the lamp's pool. */
  stack: { x: -3.05, z: -0.25 },
  /** Fetch's lane: in FRONT of the Button (behind it, a 1-unit robot vanishes behind a 1.5-unit console). */
  lane: { a: [-3.7, 2.25] as const, b: [3.9, 2.25] as const, halfW: 0.52 },
  /**
   * Where Fetch fumbles (world x): just right of the console, so Fetch and the crate end up beside
   * the Button, never in front of its DO NOT TOUCH tape (from 33° up, a crate in front of the console covers it).
   */
  fumbleX: 2.5,
  /** Where on the lane Fetch starts (0..1). */
  fetchStart: 0.22,
  /** The fumbled crate's launch: forward along Fetch's travel (+X) so it lands beside the Button, not on the belt. */
  toss: { linvel: [2.1, 2.2, 0.25] as Vec3, angvel: [2.5, 0, -6] as Vec3 },
  /** The switchboard: back against the wall, its centre at x. */
  board: { x: 1.05, yaw: 0 },
  /** Patch's stool: at the board's left end, turned so Patch sits side-on to the camera, facing the jacks. */
  stool: { x: -1.25, z: -3.35, yaw: 62 },
  /** The phone on its easel: right of centre, between the board and the Button. */
  phone: { x: 2.75, z: -1.55, yaw: -16 },
  /** A length of belt along the front (its centre). */
  belt: { x: 3.5, z: 4.05, length: 6 },
  /** The sign, hung on the wall above the board (its origin height). */
  sign: { x: 1.05, y: 3.05 },
  /** The tool wall, back left on the wall (its origin height). */
  toolwall: { x: -4.75, y: 0.6 },
  /** The lamp's clamp at the back edge of the bench. */
  lamp: { x: -4.45, z: -4.72, yaw: 0 },
} as const;

/** The camera's two homes: the whole vignette on a wide screen, the centre cluster on an upright phone (§ B3). */
export const FRAMING = {
  wide: { min: [-6.0, 0, -5] as Vec3, max: [6.6, 4.5, 4.6] as Vec3 },
  /** Button, loose crate, phone and Patch, all four without panning. */
  phone: { min: [-2.25, 0, -3.9] as Vec3, max: [3.45, 1.7, 2.9] as Vec3 },
  /** Where focus sits (depth of field) at home. */
  focus: [0.4, 0.55, 0.4] as Vec3,
} as const;

/** Sizes of stand-ins (art-direction § 10, W3 brief), for slots whose piece has not landed. */
export const STAND_IN = {
  board: { w: 3.2, h: 2.6, d: 0.7 },
  stool: { w: 0.62, h: 0.55, d: 0.62 },
  phone: { w: 0.42, h: 0.72, d: 0.3 },
  belt: { w: 6, h: 0.5, d: 0.9 },
  sign: { w: 5.4, h: 1.5, d: 0.2 },
  toolwall: { w: 4.2, h: 2.4, d: 0.12 },
  lamp: { w: 0.3, h: 0.45, d: 0.3 },
  patch: { w: 0.7, h: 1.1, d: 0.6 },
} as const;

/** The wall's face (z), and how far a hung thing stands off it. */
const WALL_Z = -5;
const WALL_GAP = 0.01;

// ───────────────────────── what is found by name ─────────────────────────

/** A slot of the vignette and what fills it. */
export interface Slot {
  name: string;
  /** What fills it: a registry piece, a station view file, or a stand-in. */
  source: string;
  real: boolean;
}

type Module = Record<string, unknown>;
const pieceModules = import.meta.glob<Module>('./kit/pieces/*/index.ts');
const stationModules = import.meta.glob<Module>('./stations/*.ts');

async function pieceModule(folder: string): Promise<Module | null> {
  const load = pieceModules[`./kit/pieces/${folder}/index.ts`];
  return load ? await load() : null;
}
async function stationModule(name: string): Promise<Module | null> {
  const load = stationModules[`./stations/${name}.ts`];
  return load ? await load() : null;
}

/** A function exported under one of these names. */
function exported<T>(m: Module | null, names: readonly string[]): T | null {
  if (!m) return null;
  for (const n of names) if (typeof m[n] === 'function') return m[n] as T;
  return null;
}

/**
 * A station view from another engineer's file, whichever shape it was
 * exported in: a factory `(ctx) => StationView`, or a maker of one
 * `(opts?) => factory`. Known names first; the adapter is the one place
 * that changes when their API settles.
 */
function stationFactory(m: Module | null, names: readonly string[], opts: Record<string, unknown>): StationViewFactory | null {
  if (!m) return null;
  for (const n of names) {
    const f = m[n];
    if (typeof f !== 'function') continue;
    // create…View(opts) returns a factory; …View(ctx) is one. Tell them apart by name.
    if (/^create/.test(n)) {
      const made = (f as (o: unknown) => unknown)(opts);
      if (typeof made === 'function') return made as StationViewFactory;
    } else return f as StationViewFactory;
  }
  return null;
}

// ───────────────────────── fitting the scene to the pieces ─────────────────────────

/** Measured from the real pieces (or the stand-ins' sizes). */
export interface Fit {
  /** The Button's console: its bounds relative to its origin. */
  button: Box3;
  /** The switchboard: placement, bounds (piece space), jack seats and the cord's root (world). */
  board: { at: Placed; bounds: Box3; jacks: Record<'storefront' | 'lamp', Vec3>; cordRoot: Vec3 };
  stool: { at: Placed; bounds: Box3; seat: Vec3 };
  phone: { at: Placed; bounds: Box3 };
  /** The belt: placement, its whole bounds, the carrying bed's collider and the motor housing's (piece space). */
  belt: { at: Placed; bounds: Box3; top: number; bed: Box3; motor: Box3 | null };
}

/** Constants the pieces export (their modules), for colliders tighter than the bounds. */
export interface FitConstants {
  /** The Button's `CONSOLE` and `BUTTON` (the console body: w, frontBottomZ, backZ; the deck height). */
  console?: { w: number; frontBottomZ: number; backZ: number } | undefined;
  deckY?: number | undefined;
  /** The belt's `BELT` (topY, width). */
  belt?: { topY: number; width: number } | undefined;
  beltLength?: number;
}

const box = (w: number, h: number, d: number): Box3 => new Box3(new Vector3(-w / 2, 0, -d / 2), new Vector3(w / 2, h, d / 2));

export function placeMatrix(at: Placed): Matrix4 {
  return new Matrix4().makeRotationY((at.yaw ?? 0) * DEG).setPosition(at.x, at.y ?? 0, at.z);
}

/** A socket of a piece placed in the world (its position), or null. */
export function socketAt(p: Piece | null, name: string, at: Placed): Vec3 | null {
  const s = p?.sockets?.[name];
  if (!s) return null;
  const v = new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(placeMatrix(at), s));
  return [v.x, v.y, v.z];
}

/** Stand a piece with bounds `b` against the back wall: its back face just off the wall. */
export function againstWall(b: Box3): number {
  return WALL_Z + WALL_GAP - b.min.z;
}

/** The measurements of the vignette's pieces (blank builds, no labels: sizes and sockets only). */
export function fitPieces(pieces: { button?: Piece | null; board?: Piece | null; stool?: Piece | null; phone?: Piece | null; belt?: Piece | null }, k: FitConstants = {}): Fit {
  // the console body (not the guard, the counter's bracket or the cable): what a crate bumps into
  const C = k.console ?? { w: 2.1, frontBottomZ: 0.66, backZ: -0.76 };
  const B = new Box3(new Vector3(-C.w / 2, 0, C.backZ), new Vector3(C.w / 2, k.deckY ?? 1.04, C.frontBottomZ));
  const boardB = pieces.board ? pieceBounds(pieces.board) : box(STAND_IN.board.w, STAND_IN.board.h, STAND_IN.board.d);
  const boardAt: Placed = { x: LAYOUT.board.x, z: againstWall(boardB), yaw: LAYOUT.board.yaw };
  const sb = STAND_IN.board;
  const fallbackJack = (dx: number): Vec3 => [boardAt.x + dx, 1.15, boardAt.z + boardB.max.z + 0.02];
  const jacks = {
    storefront: socketAt(pieces.board ?? null, 'jack.storefront', boardAt) ?? fallbackJack(-0.55),
    lamp: socketAt(pieces.board ?? null, 'jack.lamp', boardAt) ?? fallbackJack(0.45),
  };
  const cordRoot = socketAt(pieces.board ?? null, 'cord.root', boardAt) ?? ([boardAt.x - sb.w / 2 + 0.35, 0.72, boardAt.z + boardB.max.z + 0.02] as Vec3);
  const stoolB = pieces.stool ? pieceBounds(pieces.stool) : box(STAND_IN.stool.w, STAND_IN.stool.h, STAND_IN.stool.d);
  const stoolAt: Placed = { x: LAYOUT.stool.x, z: LAYOUT.stool.z, yaw: LAYOUT.stool.yaw };
  const seat = socketAt(pieces.stool ?? null, 'seat', stoolAt) ?? ([stoolAt.x, stoolB.max.y, stoolAt.z] as Vec3);
  const phoneB = pieces.phone ? pieceBounds(pieces.phone) : box(STAND_IN.phone.w, STAND_IN.phone.h, STAND_IN.phone.d);
  const beltB = pieces.belt ? pieceBounds(pieces.belt) : box(STAND_IN.belt.w, STAND_IN.belt.h, STAND_IN.belt.d);
  return {
    button: B,
    board: { at: boardAt, bounds: boardB, jacks, cordRoot },
    stool: { at: stoolAt, bounds: stoolB, seat },
    phone: { at: { x: LAYOUT.phone.x, z: LAYOUT.phone.z, yaw: LAYOUT.phone.yaw }, bounds: phoneB },
    belt: (() => {
      const top = k.belt?.topY ?? beltTop(pieces.belt ?? null, beltB);
      const len = k.beltLength ?? LAYOUT.belt.length;
      const hw = (k.belt?.width ?? STAND_IN.belt.d) / 2 + 0.06; // the rails stand just outside the belt
      const bed = new Box3(new Vector3(-len / 2, 0, -hw), new Vector3(len / 2, top, hw));
      const motor = pieces.belt && beltB.min.x < -len / 2 - 0.05 ? new Box3(new Vector3(beltB.min.x, 0, beltB.min.z), new Vector3(-len / 2, beltB.max.y, beltB.max.z)) : null;
      return { at: { x: LAYOUT.belt.x, z: LAYOUT.belt.z, yaw: 0 }, bounds: beltB, top, bed, motor };
    })(),
  };
}

/** The belt's carrying surface height: its documented constant if the piece exposes a socket for it, else its top. */
function beltTop(p: Piece | null, b: Box3): number {
  const s = p?.sockets?.['top'] ?? p?.sockets?.['surface'];
  if (s) return new Vector3().setFromMatrixPosition(s).y;
  return p ? Math.min(b.max.y, 0.5) : STAND_IN.belt.h;
}

const yawQ = (deg: number): Pose['q'] => [0, Math.sin((deg * DEG) / 2), 0, Math.cos((deg * DEG) / 2)];
const P = (p: Vec3, yawDeg = 0): Pose => ({ p, q: yawQ(yawDeg) });

/** A static box from piece bounds placed at `at` (yaw ignored for the box's extents: the boxes are axis-aligned). */
function staticBox(id: Id, b: Box3, at: Placed): SceneDesc['statics'][number] {
  const c = b.getCenter(new Vector3());
  const s = b.getSize(new Vector3());
  const yaw = (at.yaw ?? 0) * DEG;
  const cx = at.x + c.x * Math.cos(yaw) + c.z * Math.sin(yaw);
  const cz = at.z - c.x * Math.sin(yaw) + c.z * Math.cos(yaw);
  return { id, shape: { type: 'box', half: [s.x / 2, s.y / 2, s.z / 2] }, pose: P([cx, (at.y ?? 0) + c.y, cz], at.yaw ?? 0) };
}

/**
 * The simulation's vignette with this file's layout and the pieces' real
 * sizes: the Button's console, the board (and where its jacks really are),
 * the belt, the stool and the phone as bodies; the stack, the lane and the
 * fumble moved to the composition. Everything else (gravity, the chute, the
 * Button's rung, ids and names) is the simulation's.
 */
export function vignetteScene(fit: Fit, base: SceneDesc = SIM_VIGNETTE): SceneDesc {
  const L = LAYOUT;
  const bx = L.button.x, bz = L.button.z;

  // the console's collider: the body up to the deck (the cap and the parked guard are not obstacles worth a body)
  const pedestal = staticBox('button-pedestal', fit.button, { x: bx, z: bz });
  const board = staticBox('board', fit.board.bounds, fit.board.at);
  const belt = { ...staticBox('belt-bed', fit.belt.bed, fit.belt.at), friction: 0.9 };
  const extra = [staticBox('stool', fit.stool.bounds, fit.stool.at), staticBox('phone', fit.phone.bounds, fit.phone.at)];
  if (fit.belt.motor) extra.push(staticBox('belt-motor', fit.belt.motor, fit.belt.at));
  const statics = base.statics.map((s) => (s.id === 'button-pedestal' ? pedestal : s.id === 'board' ? board : s.id === 'belt-bed' ? belt : s)).concat(extra);

  // the stack: large, medium, small, each a little off true (as the simulation has it), at the new spot
  const size = (id: Id): number => {
    const p = base.parts.find((q) => q.id === id);
    const e = p?.size === 'L' ? 0.8 : p?.size === 'M' ? 0.6 : 0.45;
    return e;
  };
  const sx = L.stack.x, sz = L.stack.z;
  const [c1, c2, c3] = base.button.stack;
  const eL = size(c1 ?? ''), eM = size(c2 ?? ''), eS = size(c3 ?? '');
  const stackPose: Record<Id, Pose> = {
    ...(c1 ? { [c1]: P([sx, eL / 2, sz], 2.3) } : {}),
    ...(c2 ? { [c2]: P([sx + 0.04, eL + eM / 2, sz - 0.03], -5.2) } : {}),
    ...(c3 ? { [c3]: P([sx - 0.03, eL + eM + eS / 2, sz + 0.02], 7.4) } : {}),
  };
  const lane = { a: [L.lane.a[0], L.lane.a[1]] as const, b: [L.lane.b[0], L.lane.b[1]] as const };
  const lp = (t: number): [number, number] => [lane.a[0] + (lane.b[0] - lane.a[0]) * t, lane.a[1] + (lane.b[1] - lane.a[1]) * t];
  const runner = base.runner;
  const [fx, fz] = lp(L.fetchStart);
  const parts = base.parts.map((p) => {
    if (stackPose[p.id]) return { ...p, pose: stackPose[p.id]! };
    if (p.id === runner.id) return { ...p, pose: P([fx, p.pose.p[1], fz], 90) };
    if (p.id === runner.carrying) return { ...p, pose: P([fx, size(p.id) / 2, fz + 0.5]) };
    return p;
  });
  const jackAt: Record<string, Vec3> = { 'jack-storefront': fit.board.jacks.storefront, 'jack-lamp': fit.board.jacks.lamp };
  return {
    ...base,
    statics,
    parts,
    cord: { ...base.cord, jacks: base.cord.jacks.map((j) => ({ ...j, at: jackAt[j.id] ?? j.at })) },
    runner: {
      ...runner,
      lane,
      start: L.fetchStart,
      fumbleAt: Math.min(0.95, Math.max(0.05, (L.fumbleX - lane.a[0]) / (lane.b[0] - lane.a[0]))),
      toss: { linvel: L.toss.linvel, angvel: L.toss.angvel },
    },
  };
}

/** The scene numbers to hand to the simulation's `AT` table (for the report and the unit test). */
export function layoutForSim(scene: SceneDesc): Record<string, unknown> {
  const st = (id: Id): { p: Vec3; half: Vec3 } | null => {
    const s = scene.statics.find((q) => q.id === id);
    return s && s.shape.type === 'box' ? { p: s.pose.p, half: s.shape.half } : null;
  };
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  const rv = (v: Vec3 | readonly number[]): number[] => v.map(r);
  return {
    stack: rv([LAYOUT.stack.x, LAYOUT.stack.z]),
    button: st('button-pedestal') && { centre: rv(st('button-pedestal')!.p), half: rv(st('button-pedestal')!.half) },
    lane: { a: rv(scene.runner.lane.a), b: rv(scene.runner.lane.b) },
    fetchStart: scene.runner.start,
    fumbleAt: r(scene.runner.fumbleAt),
    toss: scene.runner.toss,
    board: st('board') && { centre: rv(st('board')!.p), half: rv(st('board')!.half) },
    jacks: Object.fromEntries(scene.cord.jacks.map((j) => [j.id, rv(j.at)])),
    belt: st('belt-bed') && { centre: rv(st('belt-bed')!.p), half: rv(st('belt-bed')!.half) },
    beltMotor: st('belt-motor') && { centre: rv(st('belt-motor')!.p), half: rv(st('belt-motor')!.half) },
    loose: (() => {
      const c = scene.parts.find((p) => p.id === scene.runner.carrying);
      return c ? rv(c.pose.p) : null;
    })(),
    chute: { p: rv(scene.chute.pose.p), linvel: rv(scene.chute.linvel) },
    bench: scene.bench,
    stool: st('stool') && { centre: rv(st('stool')!.p), half: rv(st('stool')!.half) },
    phone: st('phone') && { centre: rv(st('phone')!.p), half: rv(st('phone')!.half) },
  };
}

// ───────────────────────── loading the vignette ─────────────────────────

export interface VignetteOptions {
  /** Which Patch design (`patch-felt` | `patch-toy`); default whichever is registered (felt first). */
  patch?: string | null;
  /** Which Fetch design; default `fetch-porter`, else the first `fetch-…`. */
  fetch?: string | null;
  seed?: number;
}

export interface Vignette {
  /** The scene to boot the world from (the simulation's, laid out; see `vignetteScene`). */
  scene: SceneDesc;
  /** The station views, in drawing order. */
  stations: StationViewFactory[];
  /** What fills each slot (shown on the page's read-out and in the report). */
  slots: Slot[];
  fit: Fit;
  /** The world, once the first frame has run (for the page's hooks). */
  world(): Frame['world'] | null;
}

/**
 * Find every piece and view, measure the pieces, lay out the scene, and
 * make the station list. Call before booting; pass `scene` and `stations`
 * to `bootWorkshop`.
 */
export async function loadVignette(o: VignetteOptions = {}): Promise<Vignette> {
  const { entries } = await listPieces();
  const find = (name: string): Entry | undefined => entries.find((e) => e.name === name);
  const firstOf = (names: readonly string[]): Entry | undefined => {
    for (const n of names) {
      const hit = n.endsWith('*') ? entries.find((e) => e.name.startsWith(n.slice(0, -1))) : find(n);
      if (hit) return hit;
    }
    return undefined;
  };
  const seed = o.seed ?? 1;
  const slots: Slot[] = [];
  const slot = (name: string, e: Entry | undefined | null, standIn = 'stand-in'): void => {
    slots.push({ name, source: e ? `piece '${e.name}'` : standIn, real: !!e });
  };

  // ── the pieces, by name ──
  const E = {
    bench: find('bench'),
    wall: find('back-wall'),
    tape: find('lane-tape'),
    crate: find('crate'),
    button: find('button'),
    fetch: o.fetch ? find(o.fetch) : firstOf(['fetch-porter', 'fetch', 'fetch-*']),
    board: find('switchboard'),
    stool: find('stool'),
    plug: find('cord-plug'),
    belt: find('belt'),
    lamp: find('lamp'),
    phone: find('phone'),
    sign: find('sign'),
    toolwall: find('toolwall'),
    patch: o.patch ? find(o.patch) : firstOf(['patch-felt', 'patch-toy', 'patch', 'patch-*']),
  };
  const tools = entries.filter((e) => e.name.startsWith('tool-'));
  for (const [k, e] of Object.entries(E)) slot(k, e);
  slot('tools', tools[0], 'stand-in (no tool-… pieces)');

  // ── measure (blank builds: sizes and sockets) ──
  const blank = (e: Entry | undefined, opts: Record<string, unknown> = {}): Piece | null => (e ? buildEntry(e, null, { seed, ...opts }) : null);
  const buttonMod = await pieceModule('button');
  const beltMod = await pieceModule('belt');
  const fit = fitPieces(
    {
      board: blank(E.board),
      stool: blank(E.stool),
      phone: blank(E.phone),
      belt: blank(E.belt, { length: LAYOUT.belt.length }),
    },
    {
      console: buttonMod?.['CONSOLE'] as FitConstants['console'],
      deckY: (buttonMod?.['BUTTON'] as { deckY?: number } | undefined)?.deckY,
      belt: beltMod?.['BELT'] as FitConstants['belt'],
      beltLength: LAYOUT.belt.length,
    },
  );
  const scene = vignetteScene(fit);

  // ── modules with the pose helpers ──
  const mods = {
    button: buttonMod,
    fetch: E.fetch ? await pieceModule(E.fetch.name) : null,
    board: await pieceModule('switchboard'),
    patch: E.patch ? await pieceModule(E.patch.name) : null,
    lamp: await pieceModule('lamp'),
    toolwall: await pieceModule('toolwall'),
  };

  // ── the other engineers' station views, by file ──
  const views = {
    fetch: stationFactory(await stationModule('fetch'), ['createFetchView', 'fetchView', 'default'], { piece: E.fetch, module: mods.fetch }),
    button: stationFactory(await stationModule('button'), ['createButtonView', 'buttonView', 'default'], {}),
    card: stationFactory(await stationModule('card'), ['createCardView', 'cardView', 'default'], {}),
    lamp: stationFactory(await stationModule('lamp'), ['createLampView', 'lampView', 'default'], {}),
  };
  slots.push({ name: 'view: button', source: views.button ? 'stations/button.ts' : 'stand-in (posed piece)', real: !!views.button });
  slots.push({ name: 'view: fetch', source: views.fetch ? 'stations/fetch.ts' : 'stand-in (posed piece)', real: !!views.fetch });
  slots.push({ name: 'view: card', source: views.card ? 'stations/card.ts' : 'none yet', real: !!views.card });
  slots.push({ name: 'view: lamp', source: views.lamp ? 'stations/lamp.ts' : 'set (static body)', real: !!views.lamp });

  let worldRef: Frame['world'] | null = null;
  const watcher: StationViewFactory = () => ({
    root: new Group(),
    update(frame) {
      worldRef = frame.world;
    },
    dispose() {},
  });

  const crate = E.crate;
  const paintOf = (c: string): Token | null => ((paints as readonly string[]).includes(c) && c !== 'paper' ? (c as Token) : null);
  const partsView: StationViewFactory = (ctx: ViewContext): StationView =>
    createPartsView({
      half: (p) => worldRef?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
      ...(crate
        ? {
            // one node per crate, merged per material: a crate is rigid (repaint() is not used in P1)
            piece: (p) => {
              const c = buildEntry(crate, null, { size: p.size, paint: paintOf(p.colour), seed: hashSeed(p.id) }, ctx.labels);
              return mergedPiece('crate', flatten([{ piece: c, at: new Matrix4() }]));
            },
          }
        : {}),
    })(ctx);

  // the belt and the board hand their bodies to the set, so they are built first
  const pool: StaticPool = { items: [] };
  const stations: StationViewFactory[] = [
    watcher,
    createBeltView({ entry: E.belt, module: beltMod, fit, seed, pool }),
    createCordView({ board: E.board, plug: E.plug, boardModule: mods.board, fit, seed, pool }),
    createSetView({
      entries: E,
      tools,
      scene,
      seed,
      pool,
      lampBody: true,
      standIn: STAND_IN,
      at: { sign: LAYOUT.sign, toolwall: LAYOUT.toolwall, lamp: LAYOUT.lamp, phone: fit.phone.at, stool: fit.stool.at },
    }),
    partsView,
    createPatchView({ entry: E.patch, module: mods.patch, fit, seed }),
    views.button ?? standInButton({ entry: E.button, module: mods.button, seed }),
    views.fetch ?? standInFetch({ entry: E.fetch, module: mods.fetch, seed }),
  ];
  if (views.lamp) stations.push(views.lamp);
  if (views.card) stations.push(views.card);
  return { scene, stations, slots, fit, world: () => worldRef };
}

/** A small stable seed from an id. */
export function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 9973) + 1;
}

/** The camera's home box for a viewport (portrait: the phone framing). */
export function homeBox(portrait: boolean): Box3 {
  const f = portrait ? FRAMING.phone : FRAMING.wide;
  return new Box3(new Vector3(...f.min), new Vector3(...f.max));
}

// ───────────────────────── stand-in views (until Sections A and B land) ─────────────────────────

type PoseFn = (root: Object3D, pose: Record<string, unknown>) => void;

/**
 * The Button until its view lands: the real piece, posed by the simulation's
 * state (the cap goes down on the press and comes back up over the rung;
 * the counter shows the presses), pickable so it can be pressed.
 */
export function standInButton(o: { entry: Entry | undefined; module: Module | null; seed: number }): StationViewFactory {
  return (ctx) => {
    const root = new Group();
    root.name = 'button-stand-in';
    const p = o.entry ? buildEntry(o.entry, null, { seed: o.seed }, ctx.labels) : null;
    const obj = p ? ctx.realize(p) : new Group();
    root.position.set(LAYOUT.button.x, 0, LAYOUT.button.z);
    root.add(obj);
    ctx.scene.add(root);
    ctx.pickable('button', obj);
    const pose = (o.module?.['poseButton'] as PoseFn | undefined) ?? null;
    let press = 0;
    let pv = 0;
    let count = 0;
    return {
      root,
      update(frame) {
        const b = frame.world.button();
        for (const e of frame.events) if (e.type === 'button.pressed') pv = 14;
        const dt = Math.min(frame.dt, 0.05);
        const goal = b.phase === 'playing' ? 1 : b.phase === 'rewinding' ? Math.max(0, 1 - b.phaseTime / 0.8) : 0;
        pv += (-420 * (press - goal) - 22 * pv) * dt;
        press += pv * dt;
        const hov = frame.hovered === 'button' && !frame.world.bracketed ? -0.12 : 0;
        count += (b.presses - count) * (1 - Math.exp(-9 * dt));
        pose?.(obj, { press: Math.min(1, press + hov), count });
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}

/**
 * Fetch until its view lands: the real piece where the simulation's body is
 * (interpolated), turned by its heading, wheel turning with its ground speed,
 * arms by what it is doing, head toward what it attends to. Pickable.
 */
export function standInFetch(o: { entry: Entry | undefined; module: Module | null; seed: number }): StationViewFactory {
  return (ctx) => {
    const root = new Group();
    root.name = 'fetch-stand-in';
    const p = o.entry ? buildEntry(o.entry, null, { seed: o.seed, pose: 'offer' }, ctx.labels) : null;
    const obj = p ? ctx.realize(p) : new Group();
    const body = new Group();
    body.add(obj);
    root.add(body);
    ctx.scene.add(root);
    ctx.pickable('fetch', body);
    const pose = (o.module?.['poseFetch'] as PoseFn | undefined) ?? null;
    const pa = new Vector3(), pb = new Vector3();
    const qa = new Quaternion(), qb = new Quaternion();
    const inv = new Quaternion();
    const look = new Vector3();
    let wheel = 0;
    let headYaw = 0, headPitch = 0;
    return {
      root,
      update(frame) {
        const w = frame.world;
        const m = w.motion('fetch');
        const c = w.crew('fetch');
        if (!m || m.mode === 'chute') {
          body.visible = false;
          return;
        }
        body.visible = true;
        pb.set(...m.pose.p);
        qb.set(...m.pose.q);
        if (m.prev !== m.pose) {
          pa.set(...m.prev.p).lerp(pb, frame.alpha);
          qa.set(...m.prev.q).slerp(qb, frame.alpha);
        } else {
          pa.copy(pb);
          qa.copy(qb);
        }
        const half = w.halfExtents('fetch')?.[1] ?? 0.5;
        body.position.set(pa.x, pa.y - half, pa.z);
        body.quaternion.copy(qa);
        const dt = Math.min(frame.dt, 0.05);
        wheel += ((c?.speed ?? 0) / 0.155) * dt;
        // head toward the pointer if there is one, else what it attends to
        const t = frame.pointer ?? c?.lookAt ?? null;
        if (t) {
          inv.copy(qa).invert();
          look.set(t[0] - pa.x, t[1] - (pa.y + 0.3), t[2] - pa.z).applyQuaternion(inv);
          const gy = Math.max(-1.2, Math.min(1.2, Math.atan2(look.x, look.z)));
          const gp = Math.max(-0.5, Math.min(0.5, Math.atan2(look.y, Math.hypot(look.x, look.z))));
          const k = 1 - Math.exp(-8 * dt);
          headYaw += (gy - headYaw) * k;
          headPitch += (gp - headPitch) * k;
        }
        const st = c?.state ?? 'idle';
        const arms = c?.carrying ? 'carry' : st === 'offer' ? 'offer' : st === 'fumble' || st === 'held' ? 'flail' : st === 'salute' ? 'salute' : st === 'shrug' ? 'shrug' : 'rest';
        const lean: [number, number] = [Math.max(-0.2, Math.min(0.2, (c?.speed ?? 0) * 0.08)), 0];
        pose?.(obj, { wheel, headYaw, headPitch, arms, lean, gaze: [headYaw * 0.3, headPitch * 0.3], pupilSize: st === 'fumble' ? 0.6 : 1 });
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}
