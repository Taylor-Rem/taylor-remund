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
  /** A beat of resistance (the lever gives this share of its travel over this long), then it goes, holds, comes back. */
  leverGive: 0.12,
  giveShare: 0.12,
  leverDown: 0.09,
  leverHold: 0.2,
  leverBack: 0.6,
  /** Refused (the envelope in the air): after its give, it springs back over this long. */
  refuseBack: 0.3,
  /** The ratchet wheel: how far it turns with the lever, and with each click of the printed sheet (radians). */
  wheelTurn: 1.2,
  wheelClick: (2 * Math.PI) / PRESS_DIMS.wheelTeeth,
  /** The wind-back before the flick (radians down), the flick (radians up), its spring's wobble after. */
  wind: 0.22,
  flick: 0.95,
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
  wheel: Object3D;
  platen: Object3D;
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
      const names = ['lever', 'wheel', 'platen', 'printed', 'gridded', 'blank', 'drawer', 'stack', 'arm', 'env', 'flap-0', 'flap-1', 'flap-2'];
      const found = names.map(by);
      if (found.some((x) => !x)) return;
      const [lever, wheel, platen, printed, gridded, blank, drawer, stack, arm, env, f0, f1, f2] = found as Object3D[];
      group = g;
      obj = piece;
      half = w.halfExtents(o.body)?.[1] ?? half;
      const all = found as Object3D[];
      nodes = { lever: lever!, wheel: wheel!, platen: platen!, printed: printed!, gridded: gridded!, blank: blank!, drawer: drawer!, stack: stack!, arm: arm!, env: env!, flaps: [f0!, f1!, f2!], rest: new Map(all.map((n) => [n, { p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() }])) };
      // the press keeps its own colours when the room's paint scheme changes (it is a loose thing, not a machine)
      (ctx.materials as Partial<{ keepColours(root: Object3D): number }>).keepColours?.(piece);
      // the lever's target: the upper arm and the grip, at rest (up and back), deepened toward the visitor so a ray to it
      // meets it before the sheets behind: at least 28 px at the home framing, a
      // fingertip with the camera in
      const t = new Object3D();
      t.name = 'press:lever.pick';
      holder.add(t);
      const a = (D.leverRest * Math.PI) / 180;
      const reach = D.leverLen + D.gripL;
      const tipY = D.leverY + Math.cos(a) * reach;
      const tipZ = D.leverZ + Math.sin(a) * reach;
      ctx.pickable(o.lever, t, { box: new Box3(new Vector3(D.leverX - 0.055, D.leverY + 0.1, tipZ - 0.05).multiplyScalar(PRESS_SCALE), new Vector3(D.leverX + 0.035, tipY + 0.04, D.leverZ + 0.16).multiplyScalar(PRESS_SCALE)), pad: 0.01, active: () => shown && reachable() });
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
        const down = s && !reduced ? t < PRESS_SHOW.thunkAt + PRESS_SHOW.thunk : false;
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

        // the lever: it gives a little under the hand, then goes (fast) and thunks at the bottom, holds, and springs back
        // up with a small overshoot. At once under the hand, even when its pull waits its turn. Refused (the envelope in
        // the air): it gives the same little, then springs back without going.
        const since = frame.time - leverAt;
        const refused = pv.refused < 1.2 && Math.abs(since - pv.refused) < 0.2;
        let pull = 0;
        if (since >= 0 && since < F.leverGive) pull = F.giveShare * smooth(since / F.leverGive);
        else if (refused && since < F.leverGive + F.refuseBack) pull = F.giveShare * (1 - smooth((since - F.leverGive) / F.refuseBack)) - 0.03 * Math.sin(((since - F.leverGive) / F.refuseBack) * Math.PI);
        else if (!refused && since < F.leverGive + F.leverDown) {
          const u = (since - F.leverGive) / F.leverDown;
          pull = F.giveShare + (1 - F.giveShare) * u * u;
        } else if (!refused && since < F.leverGive + F.leverDown + F.leverHold) pull = 1;
        else if (!refused && since < F.leverGive + F.leverDown + F.leverHold + F.leverBack) {
          const u = (since - F.leverGive - F.leverDown - F.leverHold) / F.leverBack;
          pull = 1 - smooth(u) - 0.06 * u * Math.sin(u * Math.PI);
        }
        const lm = pv.misfire;
        if (lm && lm.since < 0.35) pull = Math.max(pull, 0.18 * lm.level * Math.sin((lm.since / 0.35) * Math.PI));
        if (!reduced && frame.time - toldAt < F.tellTime) pull = Math.max(pull, 0.08 * Math.max(0, Math.sin((frame.time - toldAt) * 10)) * (1 - (frame.time - toldAt) / F.tellTime));
        if (frame.hovered === o.lever && pull === 0) pull = -0.02;
        pose(N.lever, null, qa.setFromAxisAngle(X, pull * F.leverPull));
        // the platen comes down with the lever; the wheel turns with it, then clicks round as the printed sheet rises
        pose(N.platen, dv.set(0, -Math.max(0, pull) * D.platenDrop, 0), null);
        let wheel = Math.max(0, pull) * F.wheelTurn;
        if (s && !reduced) for (let n = 0; n < PRESS_SHOW.ratchets; n++) wheel += F.wheelClick * smooth(beatAt(script!, 'ratchet', t, n));
        pose(N.wheel, null, qa.setFromAxisAngle(X, wheel));

        // the blank: drawn in from the tray as the lever goes down; the next one is there by the time it is back
        const dropT = PRESS_SHOW.thunkAt + PRESS_SHOW.thunk;
        const bi = s && !reduced ? Math.min(1, t / dropT) : 0;
        const binside = s && !reduced && t < dropT + 0.45;
        pose(N.blank, dv.set(0, -0.004 * smooth(bi), F.blankIn * smooth(bi)), null, binside && bi >= 0.98 ? 0 : 1);

        // the printed sheet: down into its slot with the thunk, then up again in four separate clicks, like toast
        let rise = pv.report === null && !s ? 0 : 1;
        if (s && !reduced) {
          if (t < dropT) rise = s.before === null ? 0 : 1 - smooth(t / dropT);
          else {
            rise = 0;
            for (let n = 0; n < PRESS_SHOW.ratchets; n++) rise += smooth(beatAt(script!, 'ratchet', t, n)) / PRESS_SHOW.ratchets;
          }
        }
        pose(N.printed, dv.set(0, -(1 - rise) * D.sheetH, 0), null, rise <= 0.002 ? 0 : 1);

        // the gridded sheet: down with the thunk, then over like a calendar page into the holder beside it: it swings up
        // from lying back on the feed tray's side, about its foot, and stands
        let flip = pv.report === null && !s ? -1 : 1;
        if (s && !reduced) {
          if (t < dropT) flip = s.before === null ? -1 : 1 - t / dropT;
          else flip = t < PRESS_SHOW.flipAt ? -1 : beatAt(script!, 'flip', t);
        }
        if (flip < 0) pose(N.gridded, null, null, 0);
        else {
          const k = flip >= 1 ? 1 : 1 - (1 - flip) * (1 - flip) * (1 + 2.2 * flip);
          pose(N.gridded, null, qa.setFromAxisAngle(X, -(1 - k) * Math.PI * 0.55));
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
          // wound back (down: the held breath), then flicked up hard, then its spring's wobble
          const wk = beatAt(script!, 'wind', t);
          const fk = beatAt(script!, 'flick', t);
          if (wk > 0 && fk <= 0) arm = -F.wind * smooth(wk);
          if (fk > 0 && fk < 1) arm = -F.wind + (F.flick + F.wind) * Math.sin(fk * Math.PI);
          const after = t - (PRESS_SHOW.flickAt + PRESS_SHOW.flick);
          if (s.envelope && after > 0 && after < F.wobbleTime) arm = Math.sin(after * F.wobbleHz * Math.PI * 2) * F.wobble * (1 - after / F.wobbleTime);
          const sk = beatAt(script!, 'shrug', t);
          if (!s.envelope && sk > 0 && sk < 1) arm = Math.sin(sk * Math.PI) * F.shrug + Math.sin(sk * Math.PI * 4) * F.shrug * 0.35 * (1 - sk);
        }
        pose(N.arm, null, qa.setFromAxisAngle(Z, arm));
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
