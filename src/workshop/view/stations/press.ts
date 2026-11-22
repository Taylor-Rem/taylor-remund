/**
 * The report press, alive (P4 D3; sim/machines/press.ts). The parts view draws the press and its envelope (their
 * pieces are view/kit/pieces/report-press, posed where the simulation says, hovered, squashed, carried); this view
 * poses the press's moving nodes from its state every frame, paints the paper, and gives the lever its pick target.
 *
 * - One pull, as its script of beats says (`PressView.show`): the lever comes down with a thunk and the top blank is
 *   taken in; the old sheets drop into their slots; the printed sheet ratchets up out of the crosshead in four clicks;
 *   the gridded sheet flips over into the holder beside it; on the spring arm's bed the envelope's three flaps fold
 *   down one by one and the arm flicks (the simulation launches the envelope at that beat: from then on the parts view
 *   draws it, and the bed is bare); with the envelope out, the bed comes up empty and the spring gives a little shrug;
 *   the drawer slides out, the copy drops in (its stack one sheet thicker), and it shuts with a click.
 * - The paper (`SHEETS`, one label region shared with the envelope's piece) is painted from the simulation's state:
 *   the printed sheet a row of stamped marks (rows of six, newest last), the gridded sheet the same marks one to a cell,
 *   the envelope its paint and its wax seal. Never per frame: it is redrawn when what it shows changes, which is once a
 *   pull (when the old sheets are down in their slots, so the new marks are never seen before they come up), and when
 *   the envelope is painted or sealed. No words anywhere.
 * - Painted (the platen, a text), the press's wooden base and drawer wear the paint, as the ledger board's do.
 * - Reduced motion: no travel. The holders, the drawer and the bed are drawn as the state says the moment it changes;
 *   the lever still moves under the visitor's hand (a pull is a pull).
 *
 * Everything here is view-only: nothing the simulation owns is written. Time is the simulation's (`Frame.time`).
 */
import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3, type BufferAttribute, type BufferGeometry, type Mesh } from 'three';
import type { Id, PressView, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { PRESS_SHOW, beatAt } from '../../sim/index.ts';
import { PRESS_DIMS, PRESS_SCALE, pressPaper } from '../kit/pieces/report-press/index.ts';
import { paintPressPaper } from '../kit/pieces/report-press/paper.ts';
import { SHEETS } from '../kit/pieces/report-press/dims.ts';
import { linear } from '../palette.ts';
import { paintToken } from './parts.ts';

/** Tune here: how the press moves (view only). Radians, units, seconds. */
export const PRESS_FEEL = {
  /** The lever's pull (from its rest, forward and down) and how long it takes to come back up. */
  leverPull: (PRESS_DIMS.leverPull * Math.PI) / 180,
  leverDown: 0.12,
  leverBack: 0.5,
  /** The flick: how far the arm swings up, its spring's wobble after (radians, per second, seconds). */
  flick: 1.05,
  wobble: 0.18,
  wobbleHz: 9,
  wobbleTime: 0.7,
  /** The shrug: a small lift and settle of the bare bed. */
  shrug: 0.22,
  /** A blank slides this far into the press as it is taken in. */
  blankIn: 0.07,
  /** A copy's thickness in the drawer's stack is shown up to this many copies (the drawer is full beyond). */
  stackMax: 14,
  /** Hover: the knob rises this much (units). */
  hoverLift: 0.004,
  /** A tell rocks the lever for this long (s). */
  tellTime: 1.2,
} as const;

const HIDE = 1e-4;
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const qa = new Quaternion();
const footM = new Matrix4();

export interface PressViewOptions {
  readonly unit: Id;
  readonly body: Id;
  readonly envelope: Id;
  readonly lever: Id;
}

interface Nodes {
  lever: Object3D;
  printed: Object3D;
  gridded: Object3D;
  blank: Object3D;
  drawer: Object3D;
  stack: Object3D;
  arm: Object3D;
  env: Object3D;
  flaps: Object3D[];
  rest: Map<Object3D, { p: Vector3; q: Quaternion; s: Vector3 }>;
}

export function createPressView(o: PressViewOptions): (ctx: ViewContext) => StationView {
  return (ctx: ViewContext): StationView => {
    const F = PRESS_FEEL;
    const D = PRESS_DIMS;
    const root = new Group();
    root.name = 'press';
    ctx.scene.add(root);
    const holder = new Group();
    holder.name = 'press:targets';
    holder.matrixAutoUpdate = false;
    root.add(holder);
    const region = pressPaper(ctx.labels);
    let group: Group | null = null;
    let obj: Object3D | null = null;
    let nodes: Nodes | null = null;
    let half: number = PRESS_DIMS.baseH;
    let shown = false;
    let lastWorld: WorldView | null = null;
    /** When the lever was last worked by a hand, last told, and what the paper shows now. */
    let leverAt = -Infinity;
    let toldAt = -Infinity;
    let paperKey = '';

    const reachable = (): boolean => {
      const m = lastWorld?.motion(o.body);
      return !!m && (m.mode === 'free' || m.mode === 'machine') && !m.held;
    };

    const find = (w: WorldView): void => {
      if (nodes) return;
      const g = ctx.scene.getObjectByName(`part:${o.body}`) as Group | undefined;
      const piece = g?.children[0];
      if (!g || !piece) return;
      const by = (name: string): Object3D | null => {
        let n: Object3D | null = null;
        piece.traverse((x) => {
          if (!n && x.name === name && !(x as { isMesh?: boolean }).isMesh) n = x;
        });
        return n;
      };
      const names = ['lever', 'printed', 'gridded', 'blank', 'drawer', 'stack', 'arm', 'env', 'flap-0', 'flap-1', 'flap-2'];
      const found = names.map(by);
      if (found.some((x) => !x)) return;
      const [lever, printed, gridded, blank, drawer, stack, arm, env, f0, f1, f2] = found as Object3D[];
      group = g;
      obj = piece;
      half = w.halfExtents(o.body)?.[1] ?? half;
      const all = found as Object3D[];
      nodes = { lever: lever!, printed: printed!, gridded: gridded!, blank: blank!, drawer: drawer!, stack: stack!, arm: arm!, env: env!, flaps: [f0!, f1!, f2!], rest: new Map(all.map((n) => [n, { p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() }])) };
      // the lever's target: round its knob and the top of its arm, at rest and pulled (a finger finds it at the framing
      // the camera gives; the input grows a small one to 44 px)
      const t = new Object3D();
      t.name = 'press:lever.pick';
      holder.add(t);
      const a = (D.leverRest * Math.PI) / 180;
      const tipY = D.leverY + Math.cos(a) * D.leverLen;
      const tipZ = D.leverZ + Math.sin(a) * D.leverLen;
      ctx.pickable(o.lever, t, { box: new Box3(new Vector3(D.leverX - 0.05, D.leverY + 0.04, D.leverZ - 0.02).multiplyScalar(PRESS_SCALE), new Vector3(D.leverX + 0.03, tipY + 0.05, tipZ + 0.05).multiplyScalar(PRESS_SCALE)), pad: 0.006, active: () => shown && reachable() });
    };

    /** Pose a node from its rest: a translation added, a turn after its own, a scale. */
    const pose = (n: Object3D, dp: Vector3 | null, q: Quaternion | null, s = 1): void => {
      const r = nodes!.rest.get(n)!;
      n.position.copy(r.p);
      if (dp) n.position.add(dp);
      n.quaternion.copy(r.q);
      if (q) n.quaternion.multiply(q);
      n.scale.copy(r.s).multiplyScalar(s <= 0 ? HIDE : 1);
      if (s > 0 && s !== 1) n.scale.y *= s;
      n.updateMatrix();
    };
    const dv = new Vector3();

    /** Painted (the platen, a text): the wooden base and drawer take the paint at each vertex's own tone, as the ledger board's do. */
    let painted = 'bare';
    const bareOf = new Map<BufferGeometry, { col: Float32Array; finish: Float32Array }>();
    const paintWood = (colour: string): void => {
      if (colour === painted || !obj) return;
      painted = colour;
      const token = paintToken(colour);
      const wood = linear('wood');
      const wl = wood[0] + wood[1] + wood[2];
      obj.traverse((x) => {
        const m = x as Mesh;
        if (!m.isMesh || m.userData['kitMaterial'] !== 'wood') return;
        let bare = bareOf.get(m.geometry);
        if (!bare) {
          m.geometry = m.geometry.clone();
          const col = (m.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
          const sf = m.geometry.getAttribute('surf') as BufferAttribute;
          bare = { col: col.slice(), finish: Float32Array.from({ length: sf.count }, (_, i) => sf.getZ(i)) };
          bareOf.set(m.geometry, bare);
        }
        const ca = m.geometry.getAttribute('color') as BufferAttribute;
        const sf = m.geometry.getAttribute('surf') as BufferAttribute;
        const a = ca.array as Float32Array;
        const pc = token ? linear(token) : null;
        for (let i = 0; i < sf.count; i++) {
          if (pc) {
            const tone = (bare.col[i * 3]! + bare.col[i * 3 + 1]! + bare.col[i * 3 + 2]!) / wl;
            a[i * 3] = pc[0] * tone;
            a[i * 3 + 1] = pc[1] * tone;
            a[i * 3 + 2] = pc[2] * tone;
            sf.setZ(i, 1);
          } else {
            a.set(bare.col.subarray(i * 3, i * 3 + 3), i * 3);
            sf.setZ(i, bare.finish[i]!);
          }
        }
        ca.needsUpdate = true;
        sf.needsUpdate = true;
      });
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        lastWorld = w;
        find(w);
        const pv = w.machine(o.unit) as PressView | undefined;
        if (!pv || pv.kind !== 'press') return;
        for (const e of frame.events) {
          if (e.type === 'handle.worked' && e.id === o.lever) leverAt = frame.time;
          if (e.type === 'tell' && e.id === o.lever) toldAt = frame.time;
        }
        const reduced = ctx.reducedMotion || w.reducedMotion;
        const s = pv.show;
        const t = s ? s.since + Math.max(0, frame.time - w.time) : Infinity;
        const script = s ? { beats: s.beats, length: s.length, flickAt: null } : null;
        const at = (kind: Parameters<typeof beatAt>[1], n?: number): number => (script && !reduced ? beatAt(script, kind, t, n) : s ? 1 : 0);
        // the paper: the report the holders show (the old one until both sheets are down in their slots)
        const down = s && !reduced ? t < PRESS_SHOW.thunk : false;
        const report = s && down ? s.before : pv.report;
        const key = JSON.stringify([report, w.part(o.envelope)?.colour ?? 'bare', pv.seal]);
        if (key !== paperKey) {
          paperKey = key;
          paintPressPaper(region, { report, envelope: w.part(o.envelope)?.colour ?? 'bare', seal: pv.seal });
        }
        if (!nodes || !group || !obj) return;
        const N = nodes;
        shown = group.visible;
        holder.matrix.copy(group.matrix).multiply(footM.makeTranslation(0, -half, 0));
        holder.matrixWorldNeedsUpdate = true;
        holder.visible = shown;
        paintWood(w.part(o.body)?.colour ?? 'bare');
        if (!shown) return;

        // the lever: down with the thunk (at once under the hand, even when its pull waits its turn), back up slowly
        const since = frame.time - leverAt;
        let pull = since < F.leverDown ? smooth(since / F.leverDown) : since < F.leverDown + F.leverBack ? 1 - smooth((since - F.leverDown) / F.leverBack) : 0;
        const lm = pv.misfire;
        if (lm && lm.since < 0.35) pull = Math.max(pull, 0.18 * lm.level * Math.sin((lm.since / 0.35) * Math.PI));
        if (!reduced && frame.time - toldAt < F.tellTime) pull = Math.max(pull, 0.08 * Math.max(0, Math.sin((frame.time - toldAt) * 10)) * (1 - (frame.time - toldAt) / F.tellTime));
        if (frame.hovered === o.lever && pull === 0) pull = -0.02;
        pose(N.lever, null, qa.setFromAxisAngle(X, pull * F.leverPull));

        // the blank: taken in along the tray with the thunk, and the next one there by the time the lever is back
        const bi = at('thunk');
        const binside = s && !reduced && t < PRESS_SHOW.thunk + 0.5;
        pose(N.blank, dv.set(F.blankIn * smooth(bi), 0, 0), null, binside && bi >= 0.95 ? 0 : 1);

        // the printed sheet: down into its slot with the thunk, up again in four clicks
        let rise = pv.report === null && !s ? 0 : 1;
        if (s && !reduced) {
          const dropping = t < PRESS_SHOW.thunk;
          if (dropping) rise = s.before === null ? 0 : 1 - smooth(t / PRESS_SHOW.thunk);
          else {
            rise = 0;
            for (let n = 0; n < PRESS_SHOW.ratchets; n++) rise += smooth(beatAt(script!, 'ratchet', t, n)) / PRESS_SHOW.ratchets;
          }
        }
        pose(N.printed, dv.set(0, -(1 - rise) * D.sheetH, 0), null, rise <= 0.002 ? 0 : 1);

        // the gridded sheet: gone with the thunk, then it flips over into its holder (its plain back first)
        let flip = pv.report === null && !s ? -1 : 1;
        if (s && !reduced) {
          if (t < PRESS_SHOW.thunk) flip = s.before === null ? -1 : 1 - t / PRESS_SHOW.thunk;
          else flip = t < PRESS_SHOW.flipAt ? -1 : beatAt(script!, 'flip', t);
        }
        if (flip < 0) pose(N.gridded, null, null, 0);
        else {
          const k = smooth(flip);
          pose(N.gridded, dv.set(0, (1 - k) * 0.03, 0), qa.setFromAxisAngle(Y, (1 - k) * Math.PI), Math.max(0.02, Math.min(1, k * 3)));
        }

        // the drawer: out, the copy in, shut with a click; its stack one sheet thicker from the copy's drop
        const out = s && !reduced ? smooth(beatAt(script!, 'drawer', t)) * (1 - smooth(beatAt(script!, 'click', t))) : 0;
        pose(N.drawer, dv.set(0, 0, out * D.drawerOut), null);
        const count = s && !reduced && t < PRESS_SHOW.copyAt ? s.drawer : pv.drawer;
        const shownCount = Math.min(count, F.stackMax);
        pose(N.stack, null, null, shownCount <= 0 ? 0 : shownCount);

        // the bed: its envelope while it is in the press; the flaps standing, folded down one by one; the flick; the shrug
        const envHere = pv.envelopeIn;
        pose(N.env, null, null, envHere ? 1 : 0);
        for (let n = 0; n < 3; n++) {
          const fold = s && s.envelope && !reduced ? smooth(beatAt(script!, 'fold', t, n)) : 0;
          // splayed open and up (135°, an envelope waiting to be folded), down flat over the envelope when folded
          const ang = (1 - fold) * ((3 * Math.PI) / 4);
          const axis = n === 2 ? X : Z;
          const sign = n === 1 ? -1 : 1; // (each turns up and outward about its hinge)
          pose(N.flaps[n]!, null, qa.setFromAxisAngle(axis, sign * ang));
        }
        let arm = 0;
        if (s && !reduced) {
          const fk = beatAt(script!, 'flick', t);
          if (fk > 0 && fk < 1) arm = Math.sin(fk * Math.PI) * F.flick;
          const after = t - (PRESS_SHOW.flickAt + PRESS_SHOW.flick);
          if (s.envelope && after > 0 && after < F.wobbleTime) arm += Math.sin(after * F.wobbleHz * Math.PI * 2) * F.wobble * (1 - after / F.wobbleTime);
          const sk = beatAt(script!, 'shrug', t);
          if (!s.envelope && sk > 0 && sk < 1) arm = Math.sin(sk * Math.PI) * F.shrug + Math.sin(sk * Math.PI * 4) * F.shrug * 0.35 * (1 - sk);
        }
        pose(N.arm, null, qa.setFromAxisAngle(X, -arm));
        void Z;
        obj.updateMatrixWorld(true);
      },
      dispose() {
        root.removeFromParent();
        nodes = null;
      },
    };
  };
}

/** For a test: the size of the paper region in world units. */
export const PRESS_PAPER_SIZE = { w: SHEETS.w, h: SHEETS.h } as const;
