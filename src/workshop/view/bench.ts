/**
 * The whole bench (REWRITE.md § C, § G "P2"; ART-P2 § 2-3; brief L1): the
 * layout every P2 piece is built to, the camera's homes, and the list of
 * station views that make the playable bench at `/dev/bench/`.
 *
 * `LAYOUT` is the table the team builds to: for every station its origin
 * (the centre of its footprint on the bench, or on the wall for what hangs
 * there), footprint (w along X, d along Z, before yaw), height and yaw, and
 * what fills it now (a real piece, or clay of that size). Where a station
 * has a body, the simulation's own table (`sim/scenes/bench.ts` `AT`) holds
 * the same numbers, and `tests/unit/view/bench.test.ts` holds the two
 * together; the world boots from the simulation's scene unchanged.
 *
 * The bench reuses the vignette's machinery (`fitPieces`, the set, the
 * station views): what is new here is the layout, the clay of the pieces
 * still being built, the crew drawn 1.25× (ART-P2 § 2) and a belt of the
 * bench's length.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { SceneDesc, Vec3 } from '../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from './types.ts';
import type { Piece } from './kit/types.ts';
import { listPieces, buildEntry, type Entry } from './catalogue/registry.ts';
import { part, piece, pieceBounds } from './kit/compose.ts';
import { bevelBox } from './kit/cheap.ts';
import { laneTape } from './kit/pieces/bench/index.ts';
import { signLabels } from './kit/pieces/sign/index.ts';
import { createPartsView } from './stations/parts.ts';
import { createSetView, placedMatrix, splitStatic, type StaticPool } from './stations/set.ts';
import { createCordView } from './stations/cord.ts';
import { createPatchView } from './stations/patch.ts';
import { createButtonView } from './stations/button.ts';
import { createFetchView } from './stations/fetch.ts';
import { createLampView } from './stations/lamp.ts';
import { createCardView } from './stations/card.ts';
import { BELT_FEEL } from './stations/belt.ts';
import { fitPieces, hashSeed, measured, STAND_IN, type Fit } from './vignette.ts';
import type { Token } from './palette.ts';
import { paints } from './palette.ts';
import { site } from '../../content/site.ts';

// ───────────────────────── the layout table ─────────────────────────

/** Where a station stands and how much room it takes. */
export interface Spot {
  /** Origin: the centre of its footprint (x, z). For what hangs on the wall, z is the wall's face. */
  readonly x: number;
  readonly z: number;
  /** Height of its base above the bench top (0 on the bench; what hangs: its bottom edge). */
  readonly y: number;
  /** Footprint along X (w) and Z (d), before yaw; and its height. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Turn about +Y, degrees (0: good side toward the visitor, +Z). */
  readonly yaw: number;
  /** What fills it now: a registered piece, clay of its size, or a taped rectangle. */
  readonly fill: 'piece' | 'clay' | 'tape';
}

const spot = (x: number, z: number, w: number, d: number, h: number, o: { y?: number; yaw?: number; fill?: Spot['fill'] } = {}): Spot => ({ x, z, y: o.y ?? 0, w, d, h, yaw: o.yaw ?? 0, fill: o.fill ?? 'clay' });

/** The crew are drawn this much bigger than their P1 pieces (ART-P2 § 2). */
export const CREW_SCALE = 1.25;

/** The sign's capitals (units): TAYLOR REMUND on one line. The 12 px rule at the 1440×900 home is met with room to spare (see check-bench). */
export const SIGN_CAP_BENCH = 0.5;

/** The sign's words: the name from the site's own content, in capitals (no visible string is typed here). */
export const SIGN_WORDS: readonly string[] = site.strip.name.text.toUpperCase().split(/\s+/);

/**
 * The layout. Left to right is the direction of work; tall things at the
 * back; nothing usable behind anything else from the fixed camera. The
 * stations with bodies repeat the simulation's `AT` (checked by test).
 */
export const LAYOUT = {
  bench: { minX: -9, maxX: 9, minZ: -5, maxZ: 5 },
  /** The belt's length (its bed; the piece adds its motor housing and end rail). */
  beltLength: 10,
  /** The back wall's boards: wider than the bench so they run on past both ends into the dark. */
  wall: { width: 21, height: 9 },
  stations: {
    // ── on the wall ──
    /** Pegboard and its six tools (the real piece, 5.56 × 4.06). */
    toolwall: spot(-6.35, -5, 5.56, 0.4, 4.06, { y: 0.3, fill: 'piece' }),
    /** The lamp's clamp on the wall rail; its arm reaches over the centre and its bulb is the key light. */
    lamp: spot(-3.4, -5, 0.5, 0.5, 4.7, { fill: 'piece' }),
    /** The sign, TAYLOR REMUND on one line, hung over the board (bottom edge at y). */
    sign: spot(0.8, -5, 8.6, 0.57, 2.9, { y: 3.3, fill: 'piece' }),
    /** The window with its cut-out mountains: the cool light's source (clay frame on the wall). */
    window: spot(7.0, -5, 2.8, 0.3, 2.3, { y: 2.9 }),
    // ── the back row ──
    board: spot(0.55, -4.335, 4.6, 1.31, 3.11, { fill: 'piece' }),
    stool: spot(3.15, -3.35, 0.65, 0.65, 1.15, { fill: 'piece' }),
    storefront: spot(7.05, -3.25, 2.3, 0.9, 2.1),
    // ── the middle row ──
    bayLeft: spot(-6.7, -2.3, 2.6, 1.8, 0, { fill: 'tape' }),
    undo: spot(-3.7, -1.9, 0.7, 0.7, 1.5),
    phone: spot(2.2, -1.35, 0.42, 0.3, 0.72, { yaw: -16, fill: 'piece' }),
    platen: spot(4.75, -2.0, 1.6, 1.4, 1.4),
    // ── the Button's row ──
    hatch: spot(-3.6, 0.35, 1.8, 1.4, 0.04),
    button: spot(-0.05, 0.55, 2.1, 1.52, 1.98, { fill: 'piece' }),
    bayRight: spot(7.05, 0.3, 2.6, 1.7, 0, { fill: 'tape' }),
    // ── the front ──
    stack: spot(-7.65, 1.15, 0.8, 0.8, 1.85, { fill: 'piece' }),
    lane: spot(-1.575, 2.0, 11.05, 1.04, 0, { fill: 'tape' }),
    /** The belt piece at length 10 (the bed x -5.4..4.6) with its motor housing at the left end: the whole piece's footprint. */
    belt: spot(-0.83, 3.695, 11.4, 1.57, 1.25, { fill: 'piece' }),
    control: spot(-7.05, 4.3, 0.9, 0.5, 0.75),
    striker: spot(4.15, 2.78, 0.6, 0.44, 1.7),
    dock: spot(7.35, 3.25, 1.7, 1.2, 1.6, { yaw: -50 }),
    chute: spot(-8.1, 3.3, 0.9, 1.1, 0.9),
    pallets: spot(6.75, 4.68, 3.5, 0.56, 0.15),
  },
} as const;

export type StationKey = keyof typeof LAYOUT.stations;

/** The camera's homes (§ B6): the whole bench on a wide screen; the centre cluster on an upright phone (§ B3). */
export const FRAMING = {
  /**
   * Not the bench's box but the box the rig fits about its centre so that `MUST_SEE` (the bench's front
   * corners with a little apron and room, the sign's hook, the tool wall, the window) all just fit, as large
   * as they can. The rig centres the box and fits every corner. At 16:10 the front corners bind across, so
   * the box is wide and shallow and sits forward; at 16:9 and wider the height binds, so it is tall and
   * narrow. Found by search against `MUST_SEE`; tests/unit/view/bench.test.ts holds them.
   */
  wide: { min: [-9.8, -2.5, 2] as Vec3, max: [9.8, 2, 3.5] as Vec3 },
  /** 16:9 and wider (above `widerFrom`). */
  wider: { min: [-9.6, -2, 2] as Vec3, max: [9.6, 4, 3] as Vec3 },
  widerFrom: 1.7,
  /** Button, loose crate, phone and Patch, all four without panning. */
  phone: { min: [-1.6, 0, -3.9] as Vec3, max: [4.0, 2.3, 2.9] as Vec3 },
  /** The lens on this page: the stage's fov and pitch (20, 33: the approved look); a thinner margin than its 0.06, since the room beyond the bench ends is margin enough and the 18-wide bench needs every pixel. */
  lens: { fov: 20, pitch: 33, margin: 0.035 },
  /** Where the focus is pinned at home: the console's front and Fetch's lane. */
  focus: [0, 0.6, 1.2] as Vec3,
  blur: { range: 0.075, scale: 12, max: 6, far: 0.5 },
  /** The pan limits: the bench and a little room past its ends. */
  bounds: { min: [-9.6, -1, -5] as Vec3, max: [9.6, 6, 5] as Vec3 },
} as const;

/**
 * What the home framing must show on a wide screen, whatever its shape: the bench's front corners with the
 * apron and a strip of the room below, the sign's hook, the tool wall's top-left, the window's top-right,
 * the bench's back corners.
 */
export const MUST_SEE: readonly Vec3[] = [
  [-8.75, -0.35, 5.05], [8.75, -0.35, 5.05], [0, -0.8, 5.3],
  [-3.5, 6.25, -4.95], [5.1, 6.25, -4.95],
  [-9.15, 4.4, -4.9], [8.45, 5.25, -4.7],
  [-9, 0, -5], [9, 0, -5],
];

/** The camera's home box for a viewport of this aspect (width / height; under 1: the phone framing). */
export function homeBox(aspect: number): Box3 {
  const f = aspect < 1 ? FRAMING.phone : aspect > FRAMING.widerFrom ? FRAMING.wider : FRAMING.wide;
  return new Box3(new Vector3(...f.min), new Vector3(...f.max));
}

/** A spot's footprint as a world box (yaw applied: the box round the turned footprint). */
export function spotBox(s: Spot): Box3 {
  const c = Math.cos(s.yaw * DEG), n = Math.sin(s.yaw * DEG);
  const hx = (Math.abs(c) * s.w + Math.abs(n) * s.d) / 2, hz = (Math.abs(n) * s.w + Math.abs(c) * s.d) / 2;
  const onWall = s.z <= WALL_Z;
  const z0 = onWall ? WALL_Z : s.z - hz, z1 = onWall ? WALL_Z + s.d : s.z + hz;
  return new Box3(new Vector3(s.x - hx, s.y, z0), new Vector3(s.x + hx, s.y + s.h, z1));
}

const DEG = Math.PI / 180;
const WALL_Z = -5;

// ───────────────────────── clay ─────────────────────────

/**
 * A stand-in of a piece being built: grey clay of its footprint and height,
 * resting on y = 0, good side +Z. Plain on purpose: it says "a thing this
 * big goes here", nothing about what it looks like.
 */
export function clayBlock(name: string, w: number, h: number, d: number): Piece {
  const b = piece(`stand-in-${name}`, { ao: false });
  const c = Math.max(0.005, Math.min(w, h, d) * 0.1);
  // 44 triangles: clay is counted in the budget (twice, with the shadow pass) like everything else
  b.add(part('paper', bevelBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], c, omit: ['-y'] }), 'steel', { shade: 0.45 }));
  return b.build();
}

/** A taped rectangle on the bench (the reserved bays, the hatch's border). */
function tapedRect(s: Spot, seed: number): Piece {
  const hw = s.w / 2, hd = s.d / 2;
  return laneTape({ seed, points: [[s.x - hw, s.z - hd], [s.x + hw, s.z - hd + 0.012], [s.x + hw, s.z + hd], [s.x - hw, s.z + hd - 0.01], [s.x - hw, s.z - hd]] });
}

/** The clay and tape of every station still being built, as pool items for the set to merge. */
export function standIns(seed: number): Array<{ piece: Piece; at: Matrix4 }> {
  const out: Array<{ piece: Piece; at: Matrix4 }> = [];
  const I = new Matrix4();
  for (const [name, s] of Object.entries(LAYOUT.stations) as Array<[StationKey, Spot]>) {
    if (s.fill === 'tape') {
      if (name !== 'lane') out.push({ piece: tapedRect(s, seed + hashSeed(name)), at: I });
      continue;
    }
    if (s.fill !== 'clay') continue;
    const onWall = s.z <= WALL_Z;
    const at = placedMatrix({ x: s.x, y: s.y, z: onWall ? WALL_Z + s.d / 2 + 0.01 : s.z, yaw: s.yaw });
    out.push({ piece: clayBlock(name, s.w, Math.max(s.h, 0.02), s.d), at });
    // the hatch is a trapdoor with a tape-yellow border
    if (name === 'hatch') out.push({ piece: tapedRect({ ...s, w: s.w + 0.16, d: s.d + 0.16 }, seed + 11), at: I });
  }
  return out;
}

// ───────────────────────── the belt, at the bench's length ─────────────────────────

/**
 * The belt view of `stations/belt.ts`, at a length of our choosing (that
 * file fixes 6; the bench's belt is 10). Same feel and the same split: the
 * body goes to the set; the rollers, the seam and the lamp move here.
 * PROPOSED: a `length` option on `BeltViewOptions`, and this goes.
 */
export function createBenchBeltView(o: { entry: Entry | undefined; module: Record<string, unknown> | null; fit: Fit; seed: number; pool: StaticPool; length: number }): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const length = o.length;
    const root = new Group();
    root.name = 'belt';
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => root.removeFromParent() };
    const whole = buildEntry(o.entry, null, { seed: o.seed, length }, ctx.labels);
    const at = placedMatrix(o.fit.belt.at);
    const p = splitStatic(whole, at, (n) => /^roller\d+$/.test(n) || n === 'seam' || n === 'lamp', o.pool);
    const obj = ctx.realize(p);
    root.applyMatrix4(at);
    root.add(obj);
    const picking = (ctx as unknown as { picking?: { add(id: string, o: Object3D, opts?: { box?: Box3 }): void } }).picking;
    if (picking) picking.add('belt', obj, { box: pieceBounds(whole) });
    else ctx.pickable('belt', obj);
    type PoseBelt = (root: Object3D, length: number, rollers: readonly unknown[], pose: { travel: number }) => void;
    const poseBelt = o.module?.['poseBelt'] as PoseBelt | undefined;
    const beltRollers = o.module?.['beltRollers'] as ((length: number) => readonly unknown[]) | undefined;
    const rollers = poseBelt && beltRollers ? beltRollers(length) : null;
    const u = (ctx.materials as unknown as { uniforms?: (cls: 'belt') => { u_offset?: { value: unknown }; u_speed?: { value: unknown } } }).uniforms?.('belt') ?? null;
    if (u?.u_speed && typeof u.u_speed.value === 'number') u.u_speed.value = 0;
    let v = ctx.reducedMotion ? 0 : BELT_FEEL.speed;
    let dv = 0;
    let phase = 0;
    return {
      root,
      update(frame: Frame) {
        ctx.materials.update(frame.time);
        const dt = Math.min(frame.dt, 0.1);
        for (const e of frame.events) if (e.type === 'misfire' && e.id === 'belt' && !ctx.reducedMotion) v = BELT_FEEL.lurch;
        const b = frame.world.button();
        const goal = ctx.reducedMotion ? 0 : b.phase === 'rewinding' ? BELT_FEEL.speed * BELT_FEEL.rewind : BELT_FEEL.speed;
        const w = BELT_FEEL.omega;
        for (let left = dt; left > 1e-6; ) {
          const h = Math.min(left, 1 / 240);
          dv += (-w * w * (v - goal) - 2 * BELT_FEEL.damping * w * dv) * h;
          v += dv * h;
          left -= h;
        }
        phase += v * dt;
        if (u?.u_offset) u.u_offset.value = phase;
        if (poseBelt && rollers) poseBelt(obj, length, rollers, { travel: phase });
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}

// ───────────────────────── the crew, drawn bigger ─────────────────────────

/**
 * Fetch drawn `s`× about its own origin (under the tyre). The simulation's
 * body stays its P1 size (that is the crew engineer's to change); the crate
 * in its hands is moved out to where the bigger hands are.
 */
export function scaledFetch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    const body = v.root.getObjectByName('fetch:body');
    const S = new Matrix4().makeScale(s, s, s);
    const M = new Matrix4(), Bi = new Matrix4();
    const p = new Vector3(), q = new Quaternion(), k = new Vector3();
    return {
      root: v.root,
      update(frame: Frame) {
        v.update(frame);
        if (!body || !body.visible) return;
        const B = body.matrix;
        const w = frame.world;
        const c = w.crew(w.scene.runner.id);
        if (c?.carrying && w.mode(c.carrying) === 'crew') {
          const o = ctx.scene.getObjectByName(`part:${c.carrying}`);
          if (o) {
            M.copy(B).multiply(S).multiply(Bi.copy(B).invert());
            o.matrix.decompose(p, q, k);
            o.matrix.compose(p.applyMatrix4(M), q, k);
            o.matrixWorldNeedsUpdate = true;
          }
        }
        B.multiply(S);
        body.matrixWorldNeedsUpdate = true;
      },
      dispose: () => v.dispose(),
    };
  };
}

/** Patch drawn `s`× about its seat. */
export function scaledPatch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    v.root.scale.setScalar(s);
    return v;
  };
}

// ───────────────────────── loading the bench ─────────────────────────

export interface BenchOptions {
  /** The scene the world boots from (`sim/scenes/bench.ts` `bench`; the page passes it). */
  scene: SceneDesc;
  seed?: number;
}

export interface Bench {
  scene: SceneDesc;
  stations: StationViewFactory[];
  fit: Fit;
  measured: Record<string, unknown>;
  /** Fetch's piece bounds at rest (piece space, before the crew scale), for measuring its height on screen. */
  fetchBounds: Box3 | null;
  /** The key light (the lamp's bulb and aim). */
  bulb: { at: Vec3; aim: Vec3 } | null;
  world(): Frame['world'] | null;
}

type Module = Record<string, unknown>;
const pieceModules = import.meta.glob<Module>('./kit/pieces/*/index.ts');
async function pieceModule(folder: string): Promise<Module | null> {
  const load = pieceModules[`./kit/pieces/${folder}/index.ts`];
  return load ? await load() : null;
}

export async function loadBench(o: BenchOptions): Promise<Bench> {
  const scene = o.scene;
  const seed = o.seed ?? 1;
  const { entries } = await listPieces();
  const find = (name: string): Entry | undefined => entries.find((e) => e.name === name);
  const E = {
    bench: find('bench'),
    wall: find('back-wall'),
    crate: find('crate'),
    fetch: find('fetch-porter'),
    board: find('switchboard'),
    stool: find('stool'),
    plug: find('cord-plug'),
    belt: find('belt'),
    lamp: find('lamp'),
    phone: find('phone'),
    sign: find('sign'),
    toolwall: find('toolwall'),
    patch: find('patch-felt'),
  };
  const tools = entries.filter((e) => e.name.startsWith('tool-'));
  const mods = { belt: await pieceModule('belt'), board: await pieceModule('switchboard'), patch: await pieceModule('patch-felt'), lamp: await pieceModule('lamp') };

  const blank = (e: Entry | undefined, opts: Record<string, unknown> = {}): Piece | null => (e ? buildEntry(e, null, { seed, ...opts }) : null);
  const S = LAYOUT.stations;
  const fit = fitPieces(scene, { board: blank(E.board), stool: blank(E.stool), phone: blank(E.phone), belt: blank(E.belt, { length: LAYOUT.beltLength }) }, { stool: { x: S.stool.x, z: S.stool.z }, phoneYaw: S.phone.yaw });
  const meas = measured(scene, fit);
  const fetchPiece = blank(E.fetch);
  const fetchBounds = fetchPiece ? pieceBounds(fetchPiece) : null;

  // the key light, from the real lamp clamped at its spot
  type KeyLight = (p: Piece, place: Vec3) => { position: Vec3; aim: Vec3 };
  const keyLight = mods.lamp?.['keyLight'] as KeyLight | undefined;
  const lampPiece = blank(E.lamp);
  const k = keyLight && lampPiece ? keyLight(lampPiece, [S.lamp.x, 0, S.lamp.z]) : null;
  const bulb = k ? { at: k.position, aim: k.aim } : null;

  // the sign carries the whole name on one line, at the bench's capital height
  const sign: Entry | undefined = E.sign
    ? { ...E.sign, build: (opts = {}) => E.sign!.build({ ...opts, words: SIGN_WORDS }), labels: (labels) => ({ panels: signLabels(labels, SIGN_WORDS, SIGN_CAP_BENCH) }) }
    : undefined;

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

  const pool: StaticPool = { items: [] };
  const clayAndTape: StationViewFactory = () => {
    // runs before the set: hand the stand-ins to its pool so they merge with it
    pool.items.push(...standIns(seed));
    return { root: new Group(), update() {}, dispose() {} };
  };
  const stations: StationViewFactory[] = [
    watcher,
    createBenchBeltView({ entry: E.belt, module: mods.belt, fit, seed, pool, length: LAYOUT.beltLength }),
    createCordView({ board: E.board, plug: E.plug, boardModule: mods.board, fit, seed, pool }),
    clayAndTape,
    createSetView({
      entries: { ...E, sign },
      tools,
      scene,
      seed,
      pool,
      lampBody: false,
      ...(bulb ? { bulb } : {}),
      standIn: STAND_IN,
      at: { sign: { x: S.sign.x, y: S.sign.y }, toolwall: { x: S.toolwall.x, y: S.toolwall.y }, lamp: { x: S.lamp.x, z: S.lamp.z }, phone: fit.phone.at, stool: fit.stool.at },
    }),
    partsView,
    scaledPatch(createPatchView({ entry: E.patch, module: mods.patch, fit, seed }), CREW_SCALE),
    createButtonView(),
    // after the parts: Fetch re-seats the carried crate in its claws
    scaledFetch(createFetchView({ seed: 7 }), CREW_SCALE),
    createLampView(),
    createCardView(),
  ];
  return { scene, stations, fit, measured: meas, fetchBounds, bulb, world: () => worldRef };
}
