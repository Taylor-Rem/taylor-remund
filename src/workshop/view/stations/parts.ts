/**
 * The loose parts (REWRITE.md § B1 law 1, § D 1): one object per part,
 * where the simulation says it is, with the feedback grammar of § B1 on top.
 *
 *  - pose: `world.motion(id)` interpolated by `frame.alpha` (prev → pose),
 *    except across a teleport (`prev === pose`: the chute, a crew member
 *    righting itself); hidden while `mode` is `chute` or `gone` (shipped);
 *  - hovered: lifts a hair, eased over a few frames;
 *  - picked up: the simulation lifts it; its contact shadow shrinks and
 *    fades as it rises, so the shadow separates on every tier;
 *  - landed: a tiny squash-and-settle about its lowest point, scaled by the
 *    strength of the `part.hit` (a damped spring on the simulation clock).
 *
 * A part keeps what was done to it (brief W5): its paint and its label are
 * drawn from its durable fields (`Part.colour`, `Part.label`) whenever they
 * change, wherever it is, after a rebuild, an undo or a reset; nothing is
 * written while nothing changes. A station working on a part (the platen
 * painting it) says so through a worker on `partsHooks(scene)`: while it
 * works, the part shows the station's coverage (the wipe, the tape running
 * on); at rest, its fields. The worker's last frame and the fields agree, so
 * the hand-over never pops.
 *
 * Other views move a part's drawn pose through an overlay on the same hooks
 * (the line's rides and undo replays): the overlay is handed the matrix this
 * view composed and may change it; the part AND its contact shadow are drawn
 * where the overlays leave it.
 *
 * Everything here is view-only: the pose the simulation owns is never
 * written, only drawn with a little extra on top. All motion runs on
 * `frame.time`/`frame.dt`.
 */
import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Id, Part, Vec3, WorldView } from '../../sim/types.ts';
import type { Frame, LabelRegion, StationView, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { part as kitPart, piece as kitPiece } from '../kit/compose.ts';
import { roundedBox } from '../kit/solids.ts';
import { BlobShadows, type Blob } from '../effects/blob-shadows.ts';
import { paints, type Token } from '../palette.ts';
import { crateLook, crateTape, paintCrate } from '../kit/pieces/crate/index.ts';
import { crateTapeRegion, paintCrateTape } from '../kit/pieces/crate/tape.ts';

// ───────────────────────── the hooks: stations at work on a part, overlays on its pose ─────────────────────────

/**
 * What a station is doing to a part this frame. Either half may be null: that half shows the part's field.
 *  - paint: `from` replaced by `to` (paint names as `Part.colour` has them) up to `t` (0 all `from`, 1 all
 *    `to`), the edge travelling along `axis` (world space);
 *  - label: the strip of tape carrying `text`, laid on to `length` (0 none, 1 whole).
 */
export interface PartWork {
  paint: { from: string; to: string; t: number; axis: Vec3 } | null;
  label: { text: string; length: number } | null;
}

/** A station's say over a part: fill a half of `out` (both start null) and return true while it works on `id`. */
export type PartWorker = (id: Id, frame: Frame, out: PartWork) => boolean;

/**
 * Moves a part's drawn pose. `begin` runs once at the top of the parts view's frame; `pose` for each part
 * drawn, with the matrix composed so far (the simulated pose, hover and squash, and earlier overlays'):
 * change it in place and return true, or leave it and return false.
 */
export interface PartsOverlay {
  begin?(frame: Frame): void;
  pose(id: Id, frame: Frame, m: Matrix4): boolean;
}

export interface PartsHooks {
  readonly workers: PartWorker[];
  readonly overlays: PartsOverlay[];
}

const hooksOf = new WeakMap<object, PartsHooks>();

/** The scene's parts hooks (one per scene; made on first use, by whichever view asks first). */
export function partsHooks(scene: object): PartsHooks {
  let h = hooksOf.get(scene);
  if (!h) {
    h = { workers: [], overlays: [] };
    hooksOf.set(scene, h);
  }
  return h;
}

/** Take `item` off a hook list (a view's dispose). */
export function unhook<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

/** The bench's paint wipe: from the top at the back, down the front (world space; the platen pours from above). */
export const WIPE_AXIS: Vec3 = [0, -0.83, 0.56];

/**
 * What `part` shows now, into `out`: each half from the station working on it, or from its fields
 * (paint settled at t = 1; the tape whole when it has words). True when a station works on it.
 */
export function partShows(hooks: PartsHooks, part: Part, frame: Frame, out: PartWork): boolean {
  out.paint = null;
  out.label = null;
  let working = false;
  for (const w of hooks.workers) if (w(part.id, frame, out)) working = true;
  if (!out.paint) out.paint = { from: part.colour, to: part.colour, t: 1, axis: WIPE_AXIS };
  if (!out.label) out.label = { text: part.label, length: part.label ? 1 : 0 };
  return working;
}

/** A paint name as the palette token it draws with, or null (bare, or a name the palette does not paint with). */
export const paintToken = (c: string): Token | null => ((paints as readonly string[]).includes(c) ? (c as Token) : null);

/** Tune here: how the grammar feels. Lengths in units, rates in 1/s. */
export const PARTS_FEEL = {
  /** Hover: how far it lifts, and how fast it gets there (≈ 4 frames to 90%). */
  hoverLift: 0.03,
  hoverRate: 34,
  /** Landing squash: largest squash (fraction of height), and how much one unit of hit strength per unit of mass gives. */
  squashMax: 0.12,
  squashGain: 0.022,
  /** Hits below this speed change (strength / mass, units/s) do not squash at all (resting contact chatter). */
  squashFloor: 0.9,
  /** The spring that settles it: stiffness (ω, rad/s) and damping ratio. */
  squashOmega: 34,
  squashDamping: 0.42,
  /** Contact shadow: strength on the bench, how fast it fades with height, how much it spreads. */
  blobStrength: 0.9,
  blobFade: 0.9,
  blobSpread: 0.45,
  /** Footprint of the blob relative to the part's footprint. */
  blobSize: 1.12,
} as const;

export type PartsFeel = { -readonly [K in keyof typeof PARTS_FEEL]: number };

export interface PartsViewOptions {
  /**
   * Half extents of a part's body. Required until the simulation exposes
   * them (see the W2 report): the dev page passes the simulation's table.
   */
  half(part: Part): Vec3;
  /**
   * The piece for a part (the real crate arrives from its builder). Built on y = 0, centred, good side +Z,
   * in the part's paint. `extras.tape`: the key of the part's label region, when this view gives crates
   * label tape (build the crate with it).
   */
  piece?(part: Part, half: Vec3, extras: { tape?: string }): Piece;
  /** Give each crate a strip of label tape that carries `Part.label` (a label region per crate). Default off (the vignette's crates have none). */
  tapes?: boolean;
  /** Which parts this view draws. Default: everything but robots (the crew has views of its own). */
  include?(part: Part): boolean;
  /** Mass of a part, for scaling the squash (default: its volume). */
  mass?(part: Part, half: Vec3): number;
  feel?: Partial<PartsFeel>;
  /** Contact shadows under the parts: 'auto' = strong on the low tier, faint on high. */
  blobs?: 'auto' | 'off' | number;
}

/** The parts view, and what it draws on a part (read back from the drawing itself: tests and review pages). */
export interface PartsView extends StationView {
  drawn(id: Id): { paint: Token | null | 'mixed'; tape: number | null; text: string } | null;
}

interface Entry {
  id: Id;
  root: Group;
  obj: Object3D;
  half: Vec3;
  mass: number;
  seed: number;
  /** What is drawn now (compared with what should be, so nothing is written while nothing changes). */
  from: string;
  to: string;
  t: number;
  ax: number;
  ay: number;
  az: number;
  text: string;
  length: number;
  /** The label region (crates, with tapes on), the words painted on it, and how much of its width the strip takes. */
  region: LabelRegion | null;
  painted: string;
  used: number;
  /** Hover lift now. */
  lift: number;
  /** Squash spring: amount (positive = squashed) and its rate. */
  s: number;
  v: number;
  blob: Blob;
}

/** The stand-in piece: a rounded box of the part's size, in wood. */
export function standInPiece(part: Part, half: Vec3): Piece {
  const b = kitPiece(`part-${part.kind}`, { ao: false });
  const seed = hashId(part.id);
  const r = Math.min(half[0], half[1], half[2]) * 0.16;
  b.add(kitPart('wood', roundedBox({ w: half[0] * 2, h: half[1] * 2, d: half[2] * 2, r }), 'wood-light', { seed, jitter: 0.06, warm: 0.03 }));
  return b.build();
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

const qa = new Quaternion();
const qb = new Quaternion();
const pa = new Vector3();
const pb = new Vector3();
const up = new Vector3();
const sc = new Vector3();
const axis = new Vector3();
const mPose = new Matrix4();
const mSquash = new Matrix4();
const mT = new Matrix4();
const one = new Vector3(1, 1, 1);
const work: PartWork = { paint: null, label: null };

/** Half extent along world Y of a box of half extents `h` turned by `q`. */
function halfY(q: Quaternion, h: Vec3): number {
  const { x, y, z, w } = q;
  return Math.abs(2 * (x * y + w * z)) * h[0] + Math.abs(1 - 2 * (x * x + z * z)) * h[1] + Math.abs(2 * (y * z - w * x)) * h[2];
}
function halfXZ(q: Quaternion, h: Vec3): [number, number] {
  const { x, y, z, w } = q;
  return [
    Math.abs(1 - 2 * (y * y + z * z)) * h[0] + Math.abs(2 * (x * y - w * z)) * h[1] + Math.abs(2 * (x * z + w * y)) * h[2],
    Math.abs(2 * (x * z - w * y)) * h[0] + Math.abs(2 * (y * z + w * x)) * h[1] + Math.abs(1 - 2 * (x * x + y * y)) * h[2],
  ];
}

/** Height of the static surface under (x, z): the top of the highest static box whose footprint contains it. */
function staticFloor(world: WorldView, x: number, z: number, below: number): number {
  let top = world.scene.bench.top;
  for (const s of world.scene.statics) {
    if (s.shape.type !== 'box') continue;
    const h = s.shape.half;
    const p = s.pose.p;
    if (x < p[0] - h[0] || x > p[0] + h[0] || z < p[2] - h[2] || z > p[2] + h[2]) continue;
    const t = p[1] + h[1];
    if (t > top && t <= below + 0.02) top = t;
  }
  return top;
}

export function createPartsView(opts: PartsViewOptions): (ctx: ViewContext) => PartsView {
  return (ctx: ViewContext): PartsView => {
    const F: PartsFeel = { ...PARTS_FEEL, ...opts.feel };
    const include = opts.include ?? ((p: Part) => p.kind !== 'robot');
    const hooks = partsHooks(ctx.scene);
    const root = new Group();
    root.name = 'parts';
    ctx.scene.add(root);
    const entries = new Map<Id, Entry>();
    const blobOpacity = opts.blobs === 'off' ? 0 : typeof opts.blobs === 'number' ? opts.blobs : ctx.tier === 'low' ? 0.85 : 0.5;
    const shadows = blobOpacity > 0 ? new BlobShadows(ctx.materials.decal(), 64, blobOpacity).addTo(root) : null;
    const blobs: Blob[] = [];

    const make = (part: Part): Entry => {
      const half = opts.half(part);
      const region = opts.tapes && part.kind === 'crate' ? crateTapeRegion(ctx.labels, part.id, part.size) : null;
      const pc = (opts.piece ?? standInPiece)(part, half, region ? { tape: region.key } : {});
      const obj: Object3D = ctx.realize(pc);
      // the piece rests on y = 0 at its origin; the body's pose is its centre
      obj.position.y = -half[1];
      const g = new Group();
      g.name = `part:${part.id}`;
      g.matrixAutoUpdate = false;
      g.add(obj);
      root.add(g);
      ctx.pickable(part.id, g);
      const mass = opts.mass?.(part, half) ?? 8 * half[0] * half[1] * half[2];
      // the piece was built in the part's paint; its tape (if any) waits, hidden, for words
      const e: Entry = {
        id: part.id, root: g, obj, half, mass, seed: hashId(part.id),
        from: part.colour, to: part.colour, t: 1, ax: WIPE_AXIS[0], ay: WIPE_AXIS[1], az: WIPE_AXIS[2], text: '', length: 0,
        region, painted: '', used: 1,
        lift: 0, s: 0, v: 0, blob: { x: 0, z: 0, rx: 0, rz: 0, strength: 0, y: 0 },
      };
      if (region) crateTape(obj, 0);
      entries.set(part.id, e);
      return e;
    };

    /** Draw the part's paint and label as `w` says (a station's work, or the fields), writing only what changed. `q`: its drawn turn. */
    const look = (e: Entry, w: PartWork, q: Quaternion): void => {
      const p = w.paint!;
      const settled = p.t >= 1 || p.t <= 0 || p.from === p.to;
      const wasSettled = e.t >= 1 || e.t <= 0 || e.from === e.to;
      const shown = p.t <= 0 ? p.from : p.to;
      const wasShown = e.t <= 0 ? e.from : e.to;
      let write = false;
      if (settled) write = !wasSettled || shown !== wasShown;
      else {
        // mid-wipe the edge turns with the part: the axis in the piece's own space
        axis.set(p.axis[0], p.axis[1], p.axis[2]).applyQuaternion(qb.copy(q).invert());
        write = wasSettled || p.from !== e.from || p.to !== e.to || Math.abs(p.t - e.t) > 1e-4 || Math.abs(axis.x - e.ax) + Math.abs(axis.y - e.ay) + Math.abs(axis.z - e.az) > 1e-3;
      }
      if (write) {
        if (settled) paintCrate(e.obj, { from: paintToken(shown), to: paintToken(shown), t: 1 });
        else paintCrate(e.obj, { from: paintToken(p.from), to: paintToken(p.to), t: p.t, axis: [axis.x, axis.y, axis.z], seed: e.seed });
        e.from = p.from;
        e.to = p.to;
        e.t = p.t;
        e.ax = axis.x;
        e.ay = axis.y;
        e.az = axis.z;
      }
      const l = w.label!;
      const len = l.text ? Math.max(0, Math.min(1, l.length)) : 0;
      if (l.text !== e.text || Math.abs(len - e.length) > 1e-4) {
        if (e.region && l.text && l.text !== e.painted) {
          // a label region holds one strip: painted once per change of words (not per frame)
          e.used = paintCrateTape(e.region, l.text, e.seed) || 1;
          e.painted = l.text;
        }
        crateTape(e.obj, len * e.used);
        e.text = l.text;
        e.length = len;
      }
    };

    const kick = (e: Entry, strength: number): void => {
      const dv = strength / Math.max(1e-3, e.mass);
      if (dv < F.squashFloor) return;
      // a hit is an impulse on the spring's rate; bigger hits squash more, never past the cap
      const amount = Math.min(F.squashMax, (dv - F.squashFloor) * F.squashGain);
      e.v = Math.max(e.v, amount * F.squashOmega * 1.6);
    };

    const view: PartsView = {
      root,
      update(frame: Frame) {
        const w = frame.world;
        for (const o of hooks.overlays) o.begin?.(frame);
        for (const ev of frame.events) {
          if (ev.type !== 'part.hit') continue;
          const a = entries.get(ev.id);
          if (a) kick(a, ev.strength);
          const b = ev.other ? entries.get(ev.other) : undefined;
          if (b) kick(b, ev.strength);
        }
        const dt = Math.min(frame.dt, 0.1);
        const hoverK = 1 - Math.exp(-F.hoverRate * dt);
        blobs.length = 0;
        for (const part of w.parts()) {
          if (!include(part)) continue;
          const e = entries.get(part.id) ?? make(part);
          const m = w.motion(part.id);
          if (!m || m.mode === 'chute' || m.mode === 'gone') {
            e.root.visible = false;
            e.s = e.v = e.lift = 0;
            // out of sight it still wears its fields, so it comes back as it went
            partShows(hooks, part, frame, work);
            look(e, work, m ? qa.set(m.pose.q[0], m.pose.q[1], m.pose.q[2], m.pose.q[3]) : qa.identity());
            continue;
          }
          e.root.visible = true;
          // interpolated pose (none across a teleport)
          const P = m.pose;
          const Q = m.prev;
          if (Q === P || frame.alpha >= 1) {
            pa.set(P.p[0], P.p[1], P.p[2]);
            qa.set(P.q[0], P.q[1], P.q[2], P.q[3]);
          } else {
            pa.set(Q.p[0], Q.p[1], Q.p[2]);
            pb.set(P.p[0], P.p[1], P.p[2]);
            pa.lerp(pb, frame.alpha);
            qa.set(Q.q[0], Q.q[1], Q.q[2], Q.q[3]);
            qb.set(P.q[0], P.q[1], P.q[2], P.q[3]);
            qa.slerp(qb, frame.alpha);
          }
          // hover: a hair, eased; never while held (the simulation lifts it then)
          const goal = frame.hovered === part.id && !m.held && !w.bracketed ? F.hoverLift : 0;
          e.lift += (goal - e.lift) * hoverK;
          // squash: a damped spring, integrated in small steps
          let left = dt;
          const k = F.squashOmega * F.squashOmega;
          const c = 2 * F.squashDamping * F.squashOmega;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            e.v += (-k * e.s - c * e.v) * h;
            e.s += e.v * h;
            left -= h;
          }
          if (Math.abs(e.s) < 1e-5 && Math.abs(e.v) < 1e-4) e.s = e.v = 0;
          const s = Math.max(-F.squashMax, Math.min(F.squashMax, e.s));
          // compose: pose, lifted; then squashed about its lowest point along world Y
          pa.y += e.lift;
          mPose.compose(pa, qa, one);
          let hy = halfY(qa, e.half);
          if (s !== 0) {
            // T(b) · S · T(−b), b = the lowest point under the centre
            up.set(pa.x, pa.y - hy, pa.z);
            mT.makeTranslation(-up.x, -up.y, -up.z);
            mSquash.makeScale(1 + s * 0.5, 1 - s, 1 + s * 0.5).multiply(mT);
            mT.makeTranslation(up.x, up.y, up.z).multiply(mSquash);
            e.root.matrix.multiplyMatrices(mT, mPose);
          } else {
            e.root.matrix.copy(mPose);
          }
          // the overlays (the line's rides and undo replays): the part and its shadow go where they put it
          let over = false;
          for (const o of hooks.overlays) if (o.pose(part.id, frame, e.root.matrix)) over = true;
          if (over) {
            e.root.matrix.decompose(pa, qa, sc);
            hy = halfY(qa, e.half);
          }
          e.root.matrixWorldNeedsUpdate = true;
          // paint and label: the station's coverage while it works, the fields at rest
          partShows(hooks, part, frame, work);
          look(e, work, qa);
          // the contact shadow: on the surface under it, shrinking and fading as it rises
          if (shadows) {
            const bottom = pa.y - hy;
            const floor = staticFloor(w, pa.x, pa.z, bottom);
            const height = Math.max(0, bottom - floor);
            const [fx, fz] = halfXZ(qa, e.half);
            const grow = 1 + height * F.blobSpread;
            const b = e.blob;
            b.x = pa.x;
            b.z = pa.z;
            b.y = floor;
            b.rx = fx * F.blobSize * grow;
            b.rz = fz * F.blobSize * grow;
            b.strength = F.blobStrength * Math.exp(-height * F.blobFade) / grow;
            blobs.push(b);
          }
        }
        shadows?.set(blobs);
      },
      drawn(id) {
        const e = entries.get(id);
        if (!e) return null;
        const r = crateLook(e.obj, paints);
        return { ...r, text: e.text };
      },
      dispose() {
        shadows?.dispose();
        root.removeFromParent();
        entries.clear();
      },
    };
    return view;
  };
}
