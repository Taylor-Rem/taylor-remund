/**
 * The tool wall's tools, drawn (P4 T2; sim/machines/toolwall.ts). The board itself is static and merged into the set
 * (built without its tools); the eight tools are loose parts, and this view draws them.
 *
 * - **One rig for all eight.** The tools are one skinned piece, each tool a bone (kit/realize.ts: one mesh per material
 *   for all of them, one shadow draw), so the wall costs the same draw calls whether eight hang or none does, and a
 *   tool off the wall costs nothing more. The parts view still makes each tool a part as it does any other (its pick
 *   target, its hover lift and landing squash, the line's rides, the undo's hops, the chute's exit: the matrix it
 *   composes) but its own meshes are hidden; every frame each bone is put where the parts view put that tool's object.
 * - **Paint.** A tool painted on the platen wears the paint on whatever it wears its own colour on (its handle, its
 *   dipped grips, its enamel), at each vertex's own tone; mid-coat the paint runs over it as the platen pours. The steel
 *   stays steel. A tool keeps its colours when the room's paint scheme changes (`materials.keepColours`).
 * - **What was built with it.** While a tool is off its peg in the hand, and for a few seconds after it is set down,
 *   everything built with it answers (src/content/tool-tags.ts `toolLights`): a glow in the tool's colour round each
 *   project crate on the bench (and the thing out of its crate), round the switchboard and the storefront for
 *   Patchlamp; it swells twice as the tool comes off the wall (§ B1: "pulses twice in that tool's colour") and each
 *   crate rattles on the spot with it; then it settles and fades out over ten seconds of carrying, so it is findable
 *   in the corner of the eye and then out of the way. View only: the rattle is drawn on the crate's drawn pose (a parts
 *   overlay); nothing the simulation owns moves. Reduced motion: the glow, steady, no rattle.
 * - **Home.** While a tool is in the hand its own painted shadow glows faintly in its colour: where it goes back.
 * - **Targets.** Each tool's place (`peg-<kind>`: a mouth, for tap-then-tap and the keys) over its painted shadow,
 *   while a tool is in the hand; the pinned sheet; and the boxes a look asks for (the board, a tool out on the bench).
 */
import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3, type BufferAttribute, type Material, type Mesh, type PerspectiveCamera } from 'three';
import type { Id, ToolwallView, Vec3, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import type { Piece, PieceNode } from '../kit/types.ts';
import { piece as kitPiece, pieceBounds } from '../kit/compose.ts';
import { linear, type Token } from '../palette.ts';
import { haloMesh } from '../kit/stage-helpers.ts';
import { buildToolInto, TOOL_PAINT, TOOL_KINDS, SHEET, BOARD, type ToolKind } from '../kit/pieces/toolwall/index.ts';
import { tool as toolPiece } from '../kit/pieces/toolwall/tools.ts';
import { paintToken, partsHooks, partShows, unhook, type PartWork, type PartsOverlay } from './parts.ts';
import { toolLights, PATCHLAMP } from '../../../content/tool-tags.ts';

/** Tune here: how the things a tool built answer it (view only; seconds, units). */
export const TOOLS_FEEL = {
  /** The two swells as it comes off the wall: each this long, the second starting at `second`. */
  pulse: 0.5,
  second: 0.62,
  /** Between and after the swells the glow sits at `hold`, then fades over `fade` to `floor`. */
  hold: 0.5,
  holdFor: 1.4,
  fade: 8.6,
  floor: 0,
  /** Set down: what is left of the glow goes out over this long. */
  after: 2.5,
  /** Reduced motion: steady at this while in the hand. */
  steady: 0.55,
  /** The glow's brightness at level 1 (linear), its size against the thing's, and its floor on screen (CSS px). */
  gain: 2.6,
  grow: 2.1,
  minPx: 26,
  /** The rattle: degrees of yaw and of roll, units of lift, at its strongest, and how fast it shivers (Hz). */
  rattleDeg: 3.2,
  rattleRoll: 1.8,
  rattleLift: 0.012,
  rattleHz: 17,
  /** Its own place glows this much while it is in the hand. */
  home: 0.32,
} as const;

/** A tool's part id and kind. */
export const toolIdOf = (kind: ToolKind): Id => `tool-${kind}`;
const kindOf = (id: Id): ToolKind | null => (id.startsWith('tool-') && (TOOL_KINDS as readonly string[]).includes(id.slice(5)) ? (id.slice(5) as ToolKind) : null);

/**
 * A tool's piece as the parts view poses a part: its body's middle at the part's pose (the parts view sets the piece
 * half its height down, its origin on its foot). A tool is built hanging from its own origin; this re-roots it on its
 * bounds' middle. A new tree; the piece is not changed.
 */
export function toolBodyPiece(p: Piece): Piece {
  const b = pieceBounds(p);
  const c = b.getCenter(new Vector3());
  const h = b.getSize(new Vector3()).multiplyScalar(0.5);
  const root: PieceNode = { name: 'tool-body', parts: [], children: [p.root], transform: new Matrix4().makeTranslation(-c.x, h.y - c.y, -c.z) };
  return { ...p, root };
}

export interface ToolsViewOptions {
  /** The wall's unit (its `ToolwallView`). */
  unit: Id;
  /** The pinned sheet's id, and what a look at the board and at each tool asks for. */
  sheet: Id;
  look: Id;
  toolLook: (kind: ToolKind) => Id;
  /** Each tool's place (a mouth id). */
  peg: (kind: ToolKind) => Id;
  /** Where the board's origin is in the world (on the wall plane, under the middle of the board). */
  wall: Vec3;
  seed: number;
}

/** One tool in the rig: its bone, its body's middle in its own frame, and what of it wears its colour. */
interface RigTool {
  kind: ToolKind;
  id: Id;
  bone: Object3D;
  centre: Vector3;
  half: Vector3;
  /** Its painted vertices, per mesh: indices, their bare colours, their positions in the tool's own frame. */
  paint: Array<{ mesh: Mesh; idx: Int32Array; bare: Float32Array; local: Float32Array }>;
  /** What is drawn now: paint from, to, how far, and the edge's axis in its own frame. */
  drawn: string;
  group: Group | null;
}

const HIDE = 1e-4;
const mA = new Matrix4();
const mB = new Matrix4();
const vA = new Vector3();
const vB = new Vector3();
const qA = new Quaternion();
const work: PartWork = { paint: null, label: null };

export function createToolsView(o: ToolsViewOptions): (ctx: ViewContext) => StationView {
  return (ctx: ViewContext): StationView => {
    const F = TOOLS_FEEL;
    const root = new Group();
    root.name = 'tools';
    ctx.scene.add(root);
    const hooks = partsHooks(ctx.scene);

    // ── the rig: one piece, a node a tool, each at rest where it hangs ──
    const b = kitPiece('tools', { seed: o.seed });
    const rest = new Map<ToolKind, { centre: Vector3; half: Vector3 }>();
    for (const kind of TOOL_KINDS) {
      const one = toolPiece(kind, { seed: o.seed });
      const bb = pieceBounds(one);
      rest.set(kind, { centre: bb.getCenter(new Vector3()), half: bb.getSize(new Vector3()).multiplyScalar(0.5) });
      // spread along x at rest (the cavity bake must not see one tool inside another; bones place them from then on)
      buildToolInto(kind, b.node(`tool.${kind}`, new Matrix4().makeTranslation(TOOL_KINDS.indexOf(kind) * 1.5, 0, 0)), o.seed);
    }
    const rig = ctx.realize(b.build(), { backend: 'skinned' });
    root.add(rig);
    (ctx.materials as Partial<{ keepColours(root: Object3D): number }>).keepColours?.(rig);
    const tools: RigTool[] = TOOL_KINDS.map((kind) => {
      const bone = rig.getObjectByName(`tool.${kind}`)!;
      bone.matrixAutoUpdate = false;
      const r = rest.get(kind)!;
      return { kind, id: toolIdOf(kind), bone, centre: r.centre, half: r.half, paint: [], drawn: 'bare', group: null };
    });
    const byBone = new Map<Object3D, RigTool>(tools.map((t) => [t.bone, t]));
    // every mesh: never culled (the rest bounds are not where the tools are), and its painted vertices found by colour
    rig.traverse((x) => {
      const m = x as Mesh & { skeleton?: { bones: Object3D[] } };
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const cls = m.userData['kitMaterial'] as string | undefined;
      if (!m.skeleton || (cls !== 'wood' && cls !== 'steel' && cls !== 'felt')) return;
      const si = m.geometry.getAttribute('skinIndex') as BufferAttribute | undefined;
      const col = m.geometry.getAttribute('color') as BufferAttribute | undefined;
      const pos = m.geometry.getAttribute('position') as BufferAttribute;
      if (!si || !col) return;
      const per = new Map<RigTool, number[]>();
      for (let i = 0; i < col.count; i++) {
        const t = byBone.get(m.skeleton.bones[si.getX(i)]!);
        if (!t) continue;
        const p = linear(TOOL_PAINT[t.kind]);
        // its own colour at its own tone: every channel scaled alike (a wood-coloured part is not its paint)
        const r = [col.getX(i) / Math.max(1e-4, p[0]), col.getY(i) / Math.max(1e-4, p[1]), col.getZ(i) / Math.max(1e-4, p[2])];
        const lo = Math.min(...r), hi = Math.max(...r);
        if (lo < 0.35 || hi > 2.2 || hi / Math.max(1e-4, lo) > 1.3) continue;
        let l = per.get(t);
        if (!l) per.set(t, (l = []));
        l.push(i);
      }
      if (per.size === 0) return;
      // the mesh's own copy before any write (the skinned geometry is shared by the piece's realisations)
      m.geometry = m.geometry.clone();
      const c2 = m.geometry.getAttribute('color') as BufferAttribute;
      for (const [t, idx] of per) {
        const bare = new Float32Array(idx.length * 3);
        const local = new Float32Array(idx.length * 3);
        const at = TOOL_KINDS.indexOf(t.kind) * 1.5;
        idx.forEach((i, k) => {
          bare.set([c2.getX(i), c2.getY(i), c2.getZ(i)], k * 3);
          local.set([pos.getX(i) - at, pos.getY(i), pos.getZ(i)], k * 3);
        });
        t.paint.push({ mesh: m, idx: Int32Array.from(idx), bare, local });
      }
    });

    /** Draw a tool's paint as the parts view would a crate's: the station's coat while it works, its colour at rest. */
    const paint = (t: RigTool, w: PartWork, q: Quaternion): void => {
      const p = w.paint!;
      const settled = p.t >= 1 || p.t <= 0 || p.from === p.to;
      const key = settled ? (p.t <= 0 ? p.from : p.to) : `${p.from}>${p.to}@${p.t.toFixed(3)}`;
      if (key === t.drawn) return;
      t.drawn = key;
      const own = linear(TOOL_PAINT[t.kind]);
      const sum = own[0] + own[1] + own[2];
      const col = (c: string): readonly [number, number, number] | null => {
        const tok = paintToken(c);
        return tok ? linear(tok as Token) : null;
      };
      const from = col(p.from), to = col(p.to);
      // the edge along the wipe's axis in the tool's own frame (its own length runs along y)
      const ax = vA.set(p.axis[0], p.axis[1], p.axis[2]).applyQuaternion(qA.copy(q).invert()).normalize();
      const len = t.half.y * 2;
      const edge = -len * 0.6 + len * 2.2 * p.t;
      for (const pp of t.paint) {
        const ca = pp.mesh.geometry.getAttribute('color') as BufferAttribute;
        const a = ca.array as Float32Array;
        for (let k = 0; k < pp.idx.length; k++) {
          const i = pp.idx[k]!;
          const d = (pp.local[k * 3]! - t.centre.x) * ax.x + (pp.local[k * 3 + 1]! - t.centre.y) * ax.y + (pp.local[k * 3 + 2]! - t.centre.z) * ax.z + len / 2;
          const c = settled ? (p.t <= 0 ? from : to) : d <= edge ? to : from;
          if (!c) {
            a[i * 3] = pp.bare[k * 3]!;
            a[i * 3 + 1] = pp.bare[k * 3 + 1]!;
            a[i * 3 + 2] = pp.bare[k * 3 + 2]!;
          } else {
            const tone = (pp.bare[k * 3]! + pp.bare[k * 3 + 1]! + pp.bare[k * 3 + 2]!) / sum;
            a[i * 3] = c[0] * tone;
            a[i * 3 + 1] = c[1] * tone;
            a[i * 3 + 2] = c[2] * tone;
          }
        }
        ca.needsUpdate = true;
      }
    };

    // ── targets: each tool's place, the sheet, the look boxes ──
    let world: WorldView | null = null;
    const heldTool = (): Id | null => {
      const h = world?.holding();
      return h && h.kind === 'part' && kindOf(h.id) ? h.id : null;
    };
    const hangOf = (kind: ToolKind): { p: Vec3; q: readonly [number, number, number, number] } | null => {
      const s = world?.scene.parts.find((x) => x.id === toolIdOf(kind));
      return s ? { p: s.pose.p, q: s.pose.q } : null;
    };
    const targets = new Group();
    targets.name = 'tools:targets';
    root.add(targets);
    let targetsMade = false;
    const makeTargets = (w: WorldView): void => {
      if (targetsMade) return;
      targetsMade = true;
      for (const t of tools) {
        const h = w.scene.parts.find((x) => x.id === t.id);
        if (!h) continue;
        const at = new Object3D();
        at.name = `place:${t.kind}`;
        at.position.set(...h.pose.p);
        at.quaternion.set(...h.pose.q);
        targets.add(at);
        ctx.pickable(o.peg(t.kind), at, { box: new Box3(new Vector3(-t.half.x - 0.05, -t.half.y - 0.05, -t.half.z), new Vector3(t.half.x + 0.05, t.half.y + 0.05, t.half.z + 0.12)), pad: 0.02, active: () => heldTool() !== null });
        // a look at it out on the bench: its own box (never pressed), carried with it
        const lk = new Object3D();
        lk.name = `look:${t.kind}`;
        lk.matrixAutoUpdate = false;
        targets.add(lk);
        lookBoxes.set(t.kind, lk);
        ctx.pickable(o.toolLook(t.kind), lk, { box: new Box3(new Vector3(-t.half.x - 0.25, -t.half.y - 0.1, -t.half.z - 0.25), new Vector3(t.half.x + 0.25, t.half.y + 0.25, t.half.z + 0.25)), pad: 0, active: () => false });
      }
      // the sheet, on the board
      const sh = new Object3D();
      sh.name = 'sheet:pick';
      sh.position.set(o.wall[0] + SHEET.x, o.wall[1] + SHEET.y, o.wall[2] + BOARD.face + 0.01);
      targets.add(sh);
      ctx.pickable(o.sheet, sh, { box: new Box3(new Vector3(-SHEET.w / 2, -SHEET.h / 2, -0.01), new Vector3(SHEET.w / 2, SHEET.h / 2, 0.04)), pad: 0.02, active: () => !(world?.bracketed ?? false) });
      // a look at the board: the whole of it, a little in front
      const bd = new Object3D();
      bd.name = 'board:look';
      bd.position.set(o.wall[0], o.wall[1], o.wall[2]);
      targets.add(bd);
      const W = BOARD.w / 2 + 0.3;
      ctx.pickable(o.look, bd, { box: new Box3(new Vector3(-W, 0, 0), new Vector3(W, BOARD.y0 + BOARD.h + 0.3, 0.6)), pad: 0, active: () => false });
    };
    const lookBoxes = new Map<ToolKind, Object3D>();

    // ── what a tool built answers it ──
    const camera = (ctx.stage.camera as unknown as { camera: PerspectiveCamera }).camera;
    const haloMat = (ctx.materials as unknown as { halo?: () => Material }).halo?.();
    const glows = haloMat ? haloMesh(16, haloMat) : null;
    if (glows) {
      glows.name = 'tools:glow';
      root.add(glows);
    }
    const amber = linear('amber-glow');
    /** Per tool: when it last came into the hand and left it (simulation seconds), and its level as it left. */
    const lift = new Map<ToolKind, { at: number; down: number | null; left: number }>();
    const reduced = (): boolean => ctx.reducedMotion || (world?.reducedMotion ?? false);
    const levelOf = (kind: ToolKind, t: number): { level: number; s: number } => {
      const l = lift.get(kind);
      if (!l) return { level: 0, s: Infinity };
      const s = t - l.at;
      const held = l.down === null;
      let level: number;
      if (reduced()) level = F.steady;
      else if (s < F.second + F.pulse) {
        const bump = (x: number): number => (x >= 0 && x <= F.pulse ? Math.sin((Math.PI * x) / F.pulse) : 0);
        level = Math.max(F.hold * Math.min(1, s / 0.15), bump(s), bump(s - F.second));
      } else if (s < F.holdFor) level = F.hold;
      else level = F.floor + (F.hold - F.floor) * Math.max(0, 1 - (s - F.holdFor) / F.fade);
      if (held) return { level, s };
      const d = t - (l.down ?? t);
      return { level: l.left * Math.max(0, 1 - d / F.after), s };
    };

    /** The things lit, each frame: id (a part) or a point (Patchlamp), with the tool's colour, level, and since when. */
    interface Lit {
      kind: ToolKind;
      level: number;
      s: number;
    }
    const litParts = new Map<Id, Lit>();
    const litPoints: Array<{ p: Vec3; r: number; lit: Lit }> = [];
    /** Which parts each project id is: its crate, and the thing it holds. */
    const partsOf = (w: WorldView, project: string): Id[] => (w.scene.projects ?? []).filter((c) => c.project === project).flatMap((c) => [c.crate, ...(c.holds !== undefined ? [c.holds] : [])]);
    const patchlampPoints = (w: WorldView): Array<{ p: Vec3; r: number }> => {
      const out: Array<{ p: Vec3; r: number }> = [];
      for (const id of ['board-panel', 'storefront']) {
        const s = w.scene.statics.find((x) => x.id === id);
        if (s && s.shape.type === 'box') out.push({ p: [s.pose.p[0], s.pose.p[1] * 0.8, s.pose.p[2]], r: Math.max(s.shape.half[0], s.shape.half[1]) * 0.95 });
      }
      return out;
    };

    // the rattle: drawn on the crate's drawn pose, as its tool swells
    const overlay: PartsOverlay = {
      pose(id: Id, frame: Frame, m: Matrix4): boolean {
        if (reduced()) return false;
        const l = litParts.get(id);
        if (!l || l.s > F.second + F.pulse) return false;
        const env = (x: number): number => (x >= 0 && x <= F.pulse ? Math.sin((Math.PI * x) / F.pulse) : 0);
        const k = Math.max(env(l.s), env(l.s - F.second)) * Math.min(1, l.level * 1.6);
        if (k <= 0.001) return false;
        const ph = frame.time * F.rattleHz * Math.PI * 2;
        const yaw = Math.sin(ph) * F.rattleDeg * k * (Math.PI / 180);
        const roll = Math.sin(ph * 1.37 + 1.1) * F.rattleRoll * k * (Math.PI / 180);
        const lift2 = Math.abs(Math.sin(ph * 0.5)) * F.rattleLift * k;
        mA.makeRotationFromQuaternion(eulerOf(roll, yaw));
        m.multiply(mA);
        m.elements[13]! += lift2;
        return true;
      },
    };
    hooks.overlays.push(overlay);

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        world = w;
        makeTargets(w);
        const t = frame.time;
        const v = w.machine(o.unit) as ToolwallView | undefined;
        const heldId = heldTool();

        // ── each tool: its bone where the parts view drew its object; its paint ──
        for (const tl of tools) {
          if (!tl.group || tl.group.parent === null) {
            tl.group = (ctx.scene.getObjectByName(`part:${tl.id}`) as Group | undefined) ?? null;
            // the parts view's own meshes for it are only its pick target's shape: hidden
            if (tl.group) for (const c of tl.group.children) c.visible = false;
          }
          const g = tl.group;
          const part = w.part(tl.id);
          if (g && g.visible) {
            // the parts view's matrix places its piece half its height down from the body's middle; the rig's node is the
            // tool's own frame: its middle at `centre`
            mB.makeTranslation(-tl.centre.x, -tl.centre.y, -tl.centre.z);
            tl.bone.matrix.multiplyMatrices(g.matrix, mB);
          } else {
            const h = hangOf(tl.kind);
            const m = w.motion(tl.id);
            const gone = !m || m.mode === 'gone' || m.mode === 'chute';
            if (h && !gone && !g) {
              mA.compose(vA.set(...h.p), qA.set(...h.q), vB.set(1, 1, 1));
              tl.bone.matrix.multiplyMatrices(mA, mB.makeTranslation(-tl.centre.x, -tl.centre.y, -tl.centre.z));
            } else tl.bone.matrix.makeScale(HIDE, HIDE, HIDE).setPosition(0, -50, 0);
          }
          tl.bone.matrixWorldNeedsUpdate = true;
          // a look at it carries with it
          const lk = lookBoxes.get(tl.kind);
          if (lk && g) {
            lk.matrix.copy(g.matrix);
            lk.matrixWorldNeedsUpdate = true;
          }
          if (part) {
            partShows(hooks, part, frame, work);
            const m = w.motion(tl.id);
            paint(tl, work, qA.set(...(m?.pose.q ?? [0, 0, 0, 1])));
          }
          // in the hand, and when it left it
          const isHeld = heldId === tl.id;
          const l = lift.get(tl.kind);
          if (isHeld && (!l || l.down !== null)) lift.set(tl.kind, { at: t, down: null, left: 0 });
          else if (!isHeld && l && l.down === null) {
            const lv = levelOf(tl.kind, t).level;
            l.down = t;
            l.left = lv;
          }
          // back on its peg: nothing answers any more
          if (!isHeld && l && v?.tools.find((x) => x.id === tl.id)?.hung) lift.delete(tl.kind);
        }

        // ── what is lit, and how much ──
        litParts.clear();
        litPoints.length = 0;
        for (const [kind] of lift) {
          const lv = levelOf(kind, t);
          if (lv.level <= 0.003) {
            if (lift.get(kind)?.down !== null) lift.delete(kind);
            continue;
          }
          const lit: Lit = { kind, level: lv.level, s: lv.s };
          for (const pid of toolLights(kind)) {
            if (pid === PATCHLAMP) {
              for (const pt of patchlampPoints(w)) litPoints.push({ ...pt, lit });
              continue;
            }
            for (const id of partsOf(w, pid)) {
              const prev = litParts.get(id);
              if (!prev || prev.level < lit.level) litParts.set(id, lit);
            }
          }
        }

        // ── the glows ──
        if (!glows) return;
        camera.updateMatrixWorld();
        const H = Math.max(1, (globalThis as { innerHeight?: number }).innerHeight ?? 900);
        const halos = beginHalos(glows, camera, H);
        const tint = (kind: ToolKind, level: number): [number, number, number] => {
          // its hue at full brightness (the paints are dark: at their own value the glow would not show), over amber-glow's
          const c0 = linear(TOOL_PAINT[kind]);
          const top = Math.max(c0[0], c0[1], c0[2], 1e-4);
          const c = [c0[0] / top, c0[1] / top, c0[2] / top] as const;
          const g = level * F.gain;
          return [(c[0] / amber[0]) * g, (c[1] / amber[1]) * g, (c[2] / amber[2]) * g];
        };
        for (const [id, lit] of litParts) {
          const m = w.motion(id);
          // on the bench (or in a machine there): not below it, not in the chute, not in a crew member's hands, not shipped
          if (!m || m.mode === 'gone' || m.mode === 'chute' || m.mode === 'crew') continue;
          const half = w.halfExtents(id) ?? [0.3, 0.3, 0.3];
          const r = Math.max(half[0], half[1], half[2]) * F.grow;
          // behind its middle (the thing hides the glow's core; its skirt shows round it)
          halos.add(m.pose.p, r, F.minPx, tint(lit.kind, lit.level), -Math.max(half[0], half[2]));
        }
        for (const pt of litPoints) halos.add(pt.p, pt.r, F.minPx, tint(pt.lit.kind, pt.lit.level * 0.8), -0.4);
        // home: the tool in the hand, its own place
        if (heldId) {
          const kind = kindOf(heldId)!;
          const h = hangOf(kind);
          const tl = tools.find((x) => x.kind === kind)!;
          if (h) halos.add(h.p, Math.max(tl.half.x, tl.half.y) * 1.2, 0, tint(kind, F.home), -0.12);
        }
        halos.end();
      },
      dispose() {
        unhook(hooks.overlays, overlay);
        root.removeFromParent();
      },
    };
  };
}

const eu = new Quaternion();
const qx = new Quaternion();
const qy = new Quaternion();
const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
/** A rotation: `yaw` about y, then `roll` about x (small angles). */
function eulerOf(roll: number, yaw: number): Quaternion {
  return eu.copy(qy.setFromAxisAngle(AY, yaw)).multiply(qx.setFromAxisAngle(AX, roll));
}

/** A frame's glows on the halo mesh: camera-facing discs, each in its own colour (the vertex colour carries it). */
function beginHalos(mesh: Mesh, cam: PerspectiveCamera, cssH: number): { add(p: Vec3, r: number, minPx: number, rgb: readonly [number, number, number], back: number): void; end(): void } {
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  const toCam = new Vector3();
  const c = new Vector3();
  const v = new Vector3();
  const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
  const col = mesh.geometry.getAttribute('color') as BufferAttribute;
  const cap = pos.count / 4;
  let n = 0;
  return {
    add(p, r, minPx, rgb, back) {
      if (n >= cap) return;
      c.set(p[0], p[1], p[2]);
      toCam.setFromMatrixPosition(cam.matrixWorld).sub(c);
      const dist = toCam.length();
      toCam.normalize();
      const perPx = (2 * dist * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / (cam.zoom * cssH);
      const rad = Math.max(r, minPx * perPx);
      c.addScaledVector(toCam, back);
      const k = n * 4;
      ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy], i) => {
        v.copy(c).addScaledVector(right, sx * rad).addScaledVector(up, sy * rad);
        pos.setXYZ(k + i, v.x, v.y, v.z);
        col.setXYZ(k + i, rgb[0], rgb[1], rgb[2]);
      });
      n++;
    },
    end() {
      mesh.geometry.setDrawRange(0, n * 6);
      mesh.visible = n > 0;
      if (n > 0) {
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }
    },
  };
}
