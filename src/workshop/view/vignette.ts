/**
 * The vignette (REWRITE.md § G "P1. The vignette", § C, § B3 "The centre
 * cluster"): the list of station views that make the slice of bench, and
 * the parts of the composition the simulation does not hold.
 *
 * Everything is found by name: a piece by its registry name
 * (`kit/pieces/<name>/index.ts`), a station view by its file
 * (`view/stations/<name>.ts`). Until a piece or a view exists, its slot holds
 * a clearly temporary stand-in of the right size (clay), and `slots` says so.
 *
 * The layout. Where anything with a body stands (the console, the stack,
 * Fetch's lane, the board and its jacks, the stool, the phone, the belt)
 * is the simulation's (`sim/scenes/vignette.ts` `AT`, read here through the
 * scene's statics): the world boots from that scene unchanged. What has no
 * body (the sign, the tool wall, where the lamp is clamped) is placed by
 * `LAYOUT` below and nowhere else. `measured()` compares the simulation's
 * numbers with what the real pieces say (their sockets and bounds) and
 * lists the differences to hand back to the simulation.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id, SceneDesc, Vec3 } from '../sim/types.ts';
import { vignette as SIM_VIGNETTE } from '../sim/index.ts';
import type { StationView, StationViewFactory, ViewContext, Frame } from './types.ts';
import type { Piece } from './kit/types.ts';
import { listPieces, buildEntry, type Entry } from './catalogue/registry.ts';
import { pieceBounds } from './kit/compose.ts';
import { createPartsView } from './stations/parts.ts';
import { createSetView, type Placed, type StaticPool } from './stations/set.ts';
import { createBeltView } from './stations/belt.ts';
import { createCordView } from './stations/cord.ts';
import { createPatchView } from './stations/patch.ts';
import type { Token } from './palette.ts';
import { paints } from './palette.ts';

const DEG = Math.PI / 180;

// ───────────────────────── what has no body: the view's layout ─────────────────────────

/**
 * The back wall's composition, in bench units (art-direction § 2: +X right,
 * +Z toward the visitor, bench top y = 0, wall face z = -5). The board
 * (4.4 wide) stands centre-right against the wall; the sign hangs over it;
 * the tool wall (5.56 × 4.12 with its frame) hangs left of it with a gap;
 * the lamp is clamped in that gap, so its arm reaches over the bench without
 * standing in front of either.
 */
export const LAYOUT = {
  /** The sign's origin on the wall (x, height): over the board, clear of its crest. */
  sign: { x: 1.4, y: 3.05 },
  /** The tool wall's origin on the wall (x, height): left of the lamp's clamp. */
  toolwall: { x: -6.45, y: 0.3 },
  /** Where the lamp is clamped (its origin: on the bench top at the wall face). The key light follows from its bulb socket. */
  lampPlace: [-2.05, 0, -5] as Vec3,
  /** The key light when the lamp piece is missing. */
  bulb: { at: [-1.9, 5.2, -0.6] as const, aim: [0.6, 0, -0.1] as const },
  /** The phone turns a little toward the visitor (its body is the simulation's). */
  phoneYaw: -16,
  /** The belt's length (its body is the simulation's). */
  beltLength: 6,
  /** Fetch's lane tape: half its width round the lane. */
  laneHalfW: 0.52,
} as const;

/** The camera's two homes: the whole vignette on a wide screen, the centre cluster on an upright phone (§ B3). */
export const FRAMING = {
  wide: { min: [-6.0, 0, -5] as Vec3, max: [6.6, 4.5, 4.6] as Vec3 },
  /** Button, loose crate, phone and Patch, all four without panning. */
  phone: { min: [-2.25, 0, -3.9] as Vec3, max: [3.45, 1.7, 2.9] as Vec3 },
  /**
   * Where the focus is pinned at home: the middle of what a visitor plays with (the console's front,
   * Fetch's lane), so Fetch, the Button and the belt are sharp and only the wall's top and the very
   * front edge soften. With `focus` below for the blur itself.
   */
  focus: [0.4, 0.6, 1.4] as Vec3,
  /** The blur at this framing (stage LOOK.focus): a wider sharp band and a gentler ramp than the stage's default. */
  blur: { range: 0.075, scale: 12, max: 6, far: 0.5 },
} as const;

/** Sizes of stand-ins (art-direction § 10, W3 brief), for slots whose piece has not landed. */
export const STAND_IN = {
  board: { w: 4.4, h: 2.82, d: 1.3 },
  stool: { w: 0.62, h: 1.15, d: 0.62 },
  phone: { w: 0.42, h: 0.72, d: 0.3 },
  belt: { w: 6, h: 0.5, d: 0.9 },
  sign: { w: 5.4, h: 1.5, d: 0.2 },
  toolwall: { w: 5.56, h: 4.12, d: 0.12 },
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

// ───────────────────────── fitting the pieces to the scene ─────────────────────────

/** Where the pieces stand (from the scene's bodies) and what their sockets say. */
export interface Fit {
  /** The switchboard: placement, bounds (piece space), jack seats and the cord's root (world). */
  board: { at: Placed; bounds: Box3; jacks: Record<'storefront' | 'lamp', Vec3>; cordRoot: Vec3 };
  stool: { at: Placed; bounds: Box3; seat: Vec3 };
  phone: { at: Placed; bounds: Box3 };
  belt: { at: Placed; bounds: Box3 };
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

/** A static body of the scene, as a world box. */
export function staticBox(scene: SceneDesc, id: Id): Box3 | null {
  const s = scene.statics.find((q) => q.id === id);
  if (!s || s.shape.type !== 'box') return null;
  const [hx, hy, hz] = s.shape.half;
  const [x, y, z] = s.pose.p;
  return new Box3(new Vector3(x - hx, y - hy, z - hz), new Vector3(x + hx, y + hy, z + hz));
}

const centreXZ = (scene: SceneDesc, id: Id, fallback: [number, number]): [number, number] => {
  const b = staticBox(scene, id);
  if (!b) return fallback;
  const c = b.getCenter(new Vector3());
  return [c.x, c.z];
};

/**
 * Stand the pieces where the scene's bodies are: the board centred on its
 * body's x with its back to the wall; the stool, the phone and the belt on
 * their bodies' centres. Then read the jacks, the cord's root and the seat
 * from the real pieces' sockets.
 */
export function fitPieces(scene: SceneDesc, pieces: { board?: Piece | null; stool?: Piece | null; phone?: Piece | null; belt?: Piece | null }): Fit {
  const boardB = pieces.board ? pieceBounds(pieces.board) : box(STAND_IN.board.w, STAND_IN.board.h, STAND_IN.board.d);
  const [bx] = centreXZ(scene, 'board', [1.05, -4.35]);
  const boardAt: Placed = { x: bx, z: againstWall(boardB), yaw: 0 };
  const sj = (name: 'storefront' | 'lamp'): Vec3 => socketAt(pieces.board ?? null, `jack.${name}`, boardAt) ?? scene.cord.jacks.find((j) => j.id === `jack-${name}`)?.at ?? [bx, 1.6, -3.9];
  const jacks = { storefront: sj('storefront'), lamp: sj('lamp') };
  const cordRoot = socketAt(pieces.board ?? null, 'cord.root', boardAt) ?? ([bx, 0.9, boardAt.z + boardB.max.z] as Vec3);
  const stoolB = pieces.stool ? pieceBounds(pieces.stool) : box(STAND_IN.stool.w, STAND_IN.stool.h, STAND_IN.stool.d);
  const [sx, sz] = centreXZ(scene, 'stool', [-1.25, -3.35]);
  const stoolAt: Placed = { x: sx, z: sz, yaw: 0 };
  const seat = socketAt(pieces.stool ?? null, 'seat', stoolAt) ?? ([sx, stoolB.max.y, sz] as Vec3);
  const phoneB = pieces.phone ? pieceBounds(pieces.phone) : box(STAND_IN.phone.w, STAND_IN.phone.h, STAND_IN.phone.d);
  const [px, pz] = centreXZ(scene, 'phone', [2.75, -1.55]);
  const beltB = pieces.belt ? pieceBounds(pieces.belt) : box(STAND_IN.belt.w, STAND_IN.belt.h, STAND_IN.belt.d);
  const [ex, ez] = centreXZ(scene, 'belt-bed', [3.5, 4.05]);
  return {
    board: { at: boardAt, bounds: boardB, jacks, cordRoot },
    stool: { at: stoolAt, bounds: stoolB, seat },
    phone: { at: { x: px, z: pz, yaw: LAYOUT.phoneYaw }, bounds: phoneB },
    belt: { at: { x: ex, z: ez, yaw: 0 }, bounds: beltB },
  };
}

/**
 * What the real pieces say against the simulation's numbers: each body the
 * pieces would give, each socket the simulation copies. `console` is also
 * given centred on the console's origin (the Button's view stands the
 * piece at the body's centre, so body and picture coincide only then).
 */
export function measured(scene: SceneDesc, fit: Fit, k: { console?: { w: number; frontBottomZ: number; backZ: number } | undefined; deckY?: number | undefined } = {}): Record<string, unknown> {
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  const rv = (v: readonly number[]): number[] => v.map(r);
  const body = (b: Box3, at: Placed): { c: number[]; half: number[] } => {
    const c = b.getCenter(new Vector3()), s = b.getSize(new Vector3());
    return { c: rv([at.x + c.x, c.y, at.z + c.z]), half: rv([s.x / 2, s.y / 2, s.z / 2]) };
  };
  const sim = (id: Id): { c: number[]; half: number[] } | null => {
    const s = scene.statics.find((q) => q.id === id);
    return s && s.shape.type === 'box' ? { c: rv(s.pose.p), half: rv(s.shape.half) } : null;
  };
  const out: Record<string, unknown> = {
    board: { sim: sim('board'), pieces: body(fit.board.bounds, fit.board.at) },
    stool: { sim: sim('stool'), pieces: body(fit.stool.bounds, fit.stool.at) },
    jacks: Object.fromEntries(
      scene.cord.jacks.map((j) => {
        const key = j.id.replace(/^jack-/, '') as 'storefront' | 'lamp';
        return [j.id, { sim: rv(j.at), pieces: rv(fit.board.jacks[key]) }];
      }),
    ),
    cordRoot: rv(fit.board.cordRoot),
    seat: rv(fit.stool.seat),
  };
  const C = k.console;
  const s = sim('console');
  if (C && s) {
    const hz = Math.max(-C.backZ, C.frontBottomZ);
    out['console'] = { sim: s, centredOnOrigin: { c: rv([s.c[0]!, (k.deckY ?? 1.04) / 2, s.c[2]!]), half: rv([C.w / 2, (k.deckY ?? 1.04) / 2, hz]) } };
  }
  return out;
}

// ───────────────────────── loading the vignette ─────────────────────────

export interface VignetteOptions {
  /** Which Patch design (`patch-toy` | `patch-felt`); default patch-felt, else whichever is registered. */
  patch?: string | null;
  /** Which Fetch design; default `fetch-porter`, else the first `fetch-…`. */
  fetch?: string | null;
  seed?: number;
}

export interface Vignette {
  /** The scene the world boots from: the simulation's own. */
  scene: SceneDesc;
  /** The station views, in order (Fetch after the parts: it re-seats the crate in its claws). */
  stations: StationViewFactory[];
  /** What fills each slot (shown on the page's read-out and in the report). */
  slots: Slot[];
  fit: Fit;
  /** The pieces' numbers against the simulation's (for the report). */
  measured: Record<string, unknown>;
  /** The world, once the first frame has run (for the page's hooks). */
  world(): Frame['world'] | null;
}

/**
 * Find every piece and view, measure the pieces against the scene, and make
 * the station list. Call before booting; pass `scene` and `stations` to
 * `bootWorkshop`.
 */
export async function loadVignette(o: VignetteOptions = {}): Promise<Vignette> {
  const scene = SIM_VIGNETTE;
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

  // ── modules with the pose helpers and constants ──
  const mods = {
    button: await pieceModule('button'),
    belt: await pieceModule('belt'),
    fetch: E.fetch ? await pieceModule(E.fetch.name) : null,
    board: await pieceModule('switchboard'),
    patch: E.patch ? await pieceModule(E.patch.name) : null,
    lamp: await pieceModule('lamp'),
  };

  // ── measure (blank builds: sizes and sockets) ──
  const blank = (e: Entry | undefined, opts: Record<string, unknown> = {}): Piece | null => (e ? buildEntry(e, null, { seed, ...opts }) : null);
  const fit = fitPieces(scene, { board: blank(E.board), stool: blank(E.stool), phone: blank(E.phone), belt: blank(E.belt, { length: LAYOUT.beltLength }) });
  const meas = measured(scene, fit, {
    console: mods.button?.['CONSOLE'] as { w: number; frontBottomZ: number; backZ: number } | undefined,
    deckY: (mods.button?.['BUTTON'] as { deckY?: number } | undefined)?.deckY,
  });

  // the key light: from the real lamp clamped at LAYOUT.lampPlace (its bulb socket and its shade's axis)
  type KeyLight = (p: Piece, place: Vec3) => { position: Vec3; aim: Vec3 };
  const keyLight = mods.lamp?.['keyLight'] as KeyLight | undefined;
  const lampPiece = blank(E.lamp);
  const k = keyLight && lampPiece ? keyLight(lampPiece, LAYOUT.lampPlace) : null;
  const bulb = k ? { at: k.position, aim: k.aim } : LAYOUT.bulb;

  // ── the other engineers' station views, by file ──
  const views = {
    fetch: stationFactory(await stationModule('fetch'), ['createFetchView', 'fetchView', 'default'], { seed: 7 }),
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
  const paintOf = (c: string): Token | null => ((paints as readonly string[]).includes(c) ? (c as Token) : null);
  const partsView: StationViewFactory = (ctx: ViewContext): StationView =>
    createPartsView({
      half: (p) => worldRef?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
      ...(crate ? { piece: (p) => buildEntry(crate, null, { size: p.size, paint: paintOf(p.colour), seed: hashSeed(p.id) }, ctx.labels) } : {}),
    })(ctx);

  // the belt and the board hand their bodies to the set, so they are built first
  const pool: StaticPool = { items: [] };
  const stations: StationViewFactory[] = [
    watcher,
    createBeltView({ entry: E.belt, module: mods.belt, fit, seed, pool }),
    createCordView({ board: E.board, plug: E.plug, boardModule: mods.board, fit, seed, pool }),
    createSetView({
      entries: E,
      tools,
      scene,
      seed,
      pool,
      lampBody: !views.lamp,
      bulb,
      standIn: STAND_IN,
      at: { sign: LAYOUT.sign, toolwall: LAYOUT.toolwall, lamp: { x: LAYOUT.lampPlace[0], z: LAYOUT.lampPlace[2] }, phone: fit.phone.at, stool: fit.stool.at },
    }),
    partsView,
    createPatchView({ entry: E.patch, module: mods.patch, fit, seed }),
    views.button ?? standInButton({ entry: E.button, module: mods.button, seed }),
    // after the parts: Fetch re-seats the carried crate in its claws
    views.fetch ?? standInFetch({ entry: E.fetch, module: mods.fetch, seed }),
  ];
  if (views.lamp) stations.push(views.lamp);
  if (views.card) stations.push(views.card);
  return { scene, stations, slots, fit, measured: meas, world: () => worldRef };
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
    const con = SIM_VIGNETTE.statics.find((q) => q.id === 'console');
    root.position.set(con?.pose.p[0] ?? 0, 0, con?.pose.p[2] ?? 0);
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
