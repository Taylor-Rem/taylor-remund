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
 * - **What was built with it** (round two: by moving, not glowing). While a tool is in the hand, everything built with it
 *   (src/content/tool-tags.ts `toolLights`) gives a hop on the spot, a few pixels up and down with a shake and a small
 *   second bounce, one after another in a wave that starts nearest the wall, again every `TOOLS_FEEL.period` while the
 *   tool is held; hung back or set down, no new hop starts. Each project crate on the bench and the thing out of its
 *   crate hop (drawn on the part's drawn pose, a parts overlay); Patchlamp's station answers in its own language: the
 *   phone buzzes on its stand, the storefront's OPEN sign swings, the platen's tray jumps (its nodes, over the pose
 *   their station gave them). View only: nothing the simulation owns moves. Reduced motion: nothing hops.
 * - **Targets.** Each tool's place (`peg-<kind>`: a mouth, for tap-then-tap and the keys) over its painted shadow,
 *   while a tool is in the hand; the pinned sheet; and the boxes a look asks for (the board, a tool out on the bench).
 */
import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3, type BufferAttribute, type Intersection, type Mesh, type Raycaster } from 'three';
import type { Id, ToolwallView, Vec3, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import type { Piece, PieceNode } from '../kit/types.ts';
import { piece as kitPiece, pieceBounds } from '../kit/compose.ts';
import { linear, type Token } from '../palette.ts';
import { buildToolInto, TOOL_PAINT, TOOL_KINDS, SHEET, BOARD, BOARD_B, type ToolKind } from '../kit/pieces/toolwall/index.ts';
import { tool as toolPiece } from '../kit/pieces/toolwall/tools.ts';
import { paintToken, partsHooks, partShows, unhook, type PartWork, type PartsOverlay } from './parts.ts';
import { toolLights, PATCHLAMP } from '../../../content/tool-tags.ts';

/** Tune here: how the things a tool built answer it (view only; seconds, units). */
export const TOOLS_FEEL = {
  /** The wave: the first hop starts this long after the tool comes off, each thing this long after the one before it (nearest the wall first), the whole wave again every `period` while the tool is held. */
  lead: 0.15,
  stagger: 0.14,
  period: 2.4,
  /** A hop: this long, this high (units: a crate 40 px tall is about 0.45, so a few pixels), shaking this far (degrees). */
  hop: 0.5,
  hopLift: 0.11,
  hopDeg: 8,
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
    // (T2 round two, development only) the alternative board draws its own tools: the loose ones are not shown
    if (BOARD_B) rig.visible = false;
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

    // ── what a tool built answers it: by moving (round two: a glow round a 40-pixel crate under the lamp did not show) ──
    /** The tool in the hand now (or the one just put back: its last hops finish), since when, and when it left the hand. */
    let answering: { kind: ToolKind; at: number; stop: number | null } | null = null;
    const reduced = (): boolean => ctx.reducedMotion || (world?.reducedMotion ?? false);
    /** Which parts each project id is: its crate, and the thing it holds. */
    const partsOf = (w: WorldView, project: string): Id[] => (w.scene.projects ?? []).filter((c) => c.project === project).flatMap((c) => [c.crate, ...(c.holds !== undefined ? [c.holds] : [])]);
    /** Each answering part's hop now: its lift (units) and its shake (radians); recomputed every frame. */
    const hops = new Map<Id, { y: number; a: number }>();
    /**
     * A hop at `u` of its length (0..1): up a few pixels and down in a parabola with a shake that dies away, then a
     * small second bounce as it settles. Its lift as a share of `hopLift`, its shake as a share of `hopDeg`.
     */
    const hopAt = (u: number): { y: number; a: number } => {
      if (u < 0 || u >= 1) return { y: 0, a: 0 };
      if (u < 0.72) {
        const v = u / 0.72;
        return { y: 4 * v * (1 - v), a: Math.sin(2 * Math.PI * 1.5 * v) * (1 - v) };
      }
      const v = (u - 0.72) / 0.28;
      return { y: 0.18 * Math.sin(Math.PI * v), a: 0 };
    };
    /** Thing `i` of the wave (nearest the wall first): its hop's place, 0..1, or -1 when it is between hops. */
    const waveAt = (i: number, t: number): number => {
      const A = answering;
      if (!A) return -1;
      const s = t - A.at - F.lead - i * F.stagger;
      if (s < 0) return -1;
      const k = Math.floor(s / F.period);
      const start = A.at + F.lead + k * F.period + i * F.stagger;
      if (A.stop !== null && start > A.stop) return -1;
      const u = (s - k * F.period) / F.hop;
      return u < 1 ? u : -1;
    };
    /** Patchlamp's station answers in its own language: the phone buzzes on its stand, the storefront's sign swings, the platen's tray jumps. */
    const PATCHLAMP_NODES: ReadonlyArray<{ root: string; node: string; axis: readonly [number, number, number]; deg: number; lift: number; buzz: number }> = [
      { root: 'phone', node: 'phone', axis: [0, 0, 1], deg: 9, lift: 0.04, buzz: 3 },
      { root: 'storefront', node: 'opensign', axis: [0, 0, 1], deg: 24, lift: 0, buzz: 1 },
      { root: 'platen', node: 'tray', axis: [1, 0, 0], deg: 3, lift: 0.03, buzz: 1 },
    ];
    const plNodes = new Map<string, { o: Object3D; base: { p: Vector3; q: Quaternion } | null; applied: { p: Vector3; q: Quaternion } | null } | null>();
    const findNode = (root: string, name: string): Object3D | null => {
      for (const c of ctx.scene.children) if (c.name === root) return c.getObjectByName(name) ?? null;
      return null;
    };
    const ax = new Vector3();
    const qB = new Quaternion();
    /** Pose a station's node with its share of a hop, over the pose its station gave it this frame. */
    const shakeNode = (spec: (typeof PATCHLAMP_NODES)[number], u: number): void => {
      let n = plNodes.get(spec.root);
      if (n === undefined) {
        const o = findNode(spec.root, spec.node);
        n = o ? { o, base: null, applied: null } : null;
        plNodes.set(spec.root, n);
      }
      if (!n) return;
      const o = n.o;
      // the pose its station gave it: what it shows now, unless that is still ours
      if (!n.applied || !o.position.equals(n.applied.p) || !o.quaternion.equals(n.applied.q)) n.base = { p: o.position.clone(), q: o.quaternion.clone() };
      const base = n.base!;
      if (u < 0) {
        if (n.applied && o.position.equals(n.applied.p) && o.quaternion.equals(n.applied.q)) {
          o.position.copy(base.p);
          o.quaternion.copy(base.q);
        }
        n.applied = null;
        return;
      }
      const h = hopAt(u);
      const a = Math.sin(2 * Math.PI * spec.buzz * u) * (1 - u) + h.a * 0.5;
      o.quaternion.copy(base.q).multiply(qB.setFromAxisAngle(ax.set(...spec.axis).normalize(), (a * spec.deg * Math.PI) / 180));
      o.position.copy(base.p).add(vB.set(0, h.y * spec.lift, 0).applyQuaternion(base.q));
      n.applied = { p: o.position.clone(), q: o.quaternion.clone() };
    };

    // the hop: drawn on the part's drawn pose (view only: the simulation's pose is not touched)
    const overlay: PartsOverlay = {
      pose(id: Id, _frame: Frame, m: Matrix4): boolean {
        const h = hops.get(id);
        if (!h || (h.y === 0 && h.a === 0)) return false;
        mA.makeRotationFromQuaternion(eulerOf(h.a * 0.6, h.a));
        m.multiply(mA);
        m.elements[13]! += h.y;
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
            if (tl.group) {
              const drawn: Mesh[] = [];
              tl.group.traverse((c) => {
                if ((c as Mesh).isMesh) drawn.push(c as Mesh);
              });
              for (const c of tl.group.children) c.visible = false;
              // (round two) ...but what is drawn there is the rig's tool: a pick that asks whether the ray meets the
              // drawn thing (the shell's test when two pick boxes overlap on the ray) must hear yes where the tool is.
              // Hidden, the parts view's meshes said no everywhere, and a tap on a hanging tool went to its place behind
              // it (a tap on PHP took PHP's peg), a tap on a lying tool to whatever box lay behind it.
              const said = new Object3D();
              said.name = 'tool:drawn';
              said.raycast = (rc: Raycaster, out: Intersection[]): void => {
                const n0 = out.length;
                for (const m of drawn) m.raycast(rc, out);
                for (let i = n0; i < out.length; i++) out[i]!.object = said;
              };
              tl.group.add(said);
            }
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
        }

        // ── what was built with the tool in the hand answers it: a wave of hops, nearest the wall first ──
        if (heldId) {
          const kind = kindOf(heldId)!;
          if (!answering || answering.kind !== kind || answering.stop !== null) answering = { kind, at: t, stop: null };
        } else if (answering && answering.stop === null) answering.stop = t;
        if (answering && answering.stop !== null && t > answering.stop + F.period + 1) answering = null;
        hops.clear();
        const lit: Array<{ id: Id | null; d: number }> = [];
        if (answering && !reduced()) {
          for (const pid of toolLights(answering.kind)) {
            if (pid === PATCHLAMP) {
              lit.push({ id: null, d: Math.hypot(0 - o.wall[0], -4 - o.wall[2]) });
              continue;
            }
            for (const id of partsOf(w, pid)) {
              const m = w.motion(id);
              // on the bench (or in a machine there): not below it, not in the chute, not in a crew member's hands, not shipped
              if (!m || m.mode === 'gone' || m.mode === 'chute' || m.mode === 'crew') continue;
              lit.push({ id, d: Math.hypot(m.pose.p[0] - o.wall[0], m.pose.p[2] - o.wall[2]) });
            }
          }
          lit.sort((x, y) => x.d - y.d);
        }
        let plU = -1;
        lit.forEach((x, i) => {
          const u = waveAt(i, t);
          if (x.id === null) {
            plU = u;
            return;
          }
          if (u < 0) return;
          const h = hopAt(u);
          hops.set(x.id, { y: h.y * F.hopLift, a: (h.a * F.hopDeg * Math.PI) / 180 });
        });
        for (const spec of PATCHLAMP_NODES) shakeNode(spec, plU);
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

