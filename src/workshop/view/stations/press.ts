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
import type { Frame, LabelRegion, StationView, ViewContext } from '../types.ts';
import { PRESS_SHOW, beatAt } from '../../sim/index.ts';
import { GRID, PRESS_DIMS, UV, pressPaper } from '../kit/pieces/report-press/index.ts';
import { SHEETS } from '../kit/pieces/report-press/dims.ts';
import { hex, linear, type Token } from '../palette.ts';
import { paintToken } from './parts.ts';
import { rng as labelRng } from '../labels/rng.ts';

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

/** A paint name as a palette token for a mark (bare wood: the crate's own light wood). */
const markToken = (c: string): Token => paintToken(c) ?? 'wood-light';
/** A token as a canvas colour with alpha. */
const css = (tk: Token, a = 1): string => `${hex(tk)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

/** What the paper shows: the report on the sheets, the envelope's paint and its seal. */
interface PaperState {
  readonly report: readonly string[] | null;
  readonly envelope: string;
  readonly seal: string | null;
}

/**
 * Paint the press's paper region (browser only: canvas 2D): the two sheets' faces from `report`, the blanks, both faces
 * of the envelope. Every colour a palette token; no words.
 */
export function paintPressPaper(region: LabelRegion, s: PaperState): void {
  region.draw((ctx, W, H) => {
    const rect = (r: readonly [number, number, number, number]): { x: number; y: number; w: number; h: number } => ({ x: r[0] * W, y: (1 - r[3]) * H, w: (r[2] - r[0]) * W, h: (r[3] - r[1]) * H });
    const r = labelRng(`press|${JSON.stringify(s.report)}`);
    const j = (m: number): number => (r() * 2 - 1) * m;
    ctx.fillStyle = css('paper');
    ctx.fillRect(0, 0, W, H);
    // a faint warmth toward each sheet's edges, as stock has
    const stock = (b: { x: number; y: number; w: number; h: number }, tk: Token = 'paper'): void => {
      ctx.fillStyle = css(tk);
      ctx.fillRect(b.x, b.y, b.w, b.h);
      const g = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.25, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.75);
      g.addColorStop(0, css('wood-light', 0));
      g.addColorStop(1, css('wood-light', 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    };
    /** An inked stamp: a filled round, a little uneven, its rim darker and a lighter middle. */
    const stamp = (cx: number, cy: number, rad: number, tk: Token, square = false): void => {
      ctx.save();
      ctx.translate(cx + j(rad * 0.08), cy + j(rad * 0.08));
      ctx.rotate(j(0.25));
      ctx.fillStyle = css(tk, 0.88);
      ctx.beginPath();
      if (square) ctx.rect(-rad, -rad, rad * 2, rad * 2);
      else ctx.ellipse(0, 0, rad, rad * (0.94 + j(0.04)), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css('ink', 0.22);
      ctx.lineWidth = Math.max(1, rad * 0.14);
      ctx.stroke();
      ctx.fillStyle = css('paper', 0.18);
      ctx.beginPath();
      if (square) ctx.rect(-rad * 0.45, -rad * 0.45, rad * 0.9, rad * 0.9);
      else ctx.arc(0, 0, rad * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const marks = s.report ?? [];
    // the printed sheet: a ruled head (no words), then the marks in rows of six, newest last
    {
      const b = rect(UV.printed);
      stock(b);
      const m = b.w * 0.1;
      ctx.strokeStyle = css('ink', 0.6);
      ctx.lineWidth = Math.max(1, b.h * 0.012);
      ctx.beginPath();
      ctx.moveTo(b.x + m, b.y + b.h * 0.12);
      ctx.lineTo(b.x + b.w - m, b.y + b.h * 0.12 + j(1));
      ctx.stroke();
      ctx.lineWidth = Math.max(1, b.h * 0.005);
      ctx.beginPath();
      ctx.moveTo(b.x + m, b.y + b.h * 0.15);
      ctx.lineTo(b.x + b.w - m, b.y + b.h * 0.15);
      ctx.stroke();
      const cols = 6;
      const cw = (b.w - 2 * m) / cols;
      marks.forEach((c, i) => stamp(b.x + m + cw * (i % cols + 0.5), b.y + b.h * 0.27 + Math.floor(i / cols) * cw * 1.25, cw * 0.36, markToken(c)));
      // a short rule under the last row, so an empty report reads as a report with nothing in it
      ctx.strokeStyle = css('ink', 0.3);
      ctx.lineWidth = Math.max(1, b.h * 0.004);
      ctx.beginPath();
      const y = b.y + b.h * 0.27 + Math.max(1, Math.ceil(marks.length / cols)) * cw * 1.25;
      ctx.moveTo(b.x + m, y);
      ctx.lineTo(b.x + b.w - m, y);
      ctx.stroke();
    }
    // the gridded sheet: a ruled grid, the same marks one to a cell
    {
      const b = rect(UV.gridded);
      stock(b);
      const m = b.w * 0.09;
      const top = b.y + b.h * 0.12;
      const gw = b.w - 2 * m;
      const cw = gw / GRID.cols;
      const gh = cw * GRID.rows;
      ctx.fillStyle = css('teal-light', 0.12);
      ctx.fillRect(b.x + m, top - cw * 0.35, gw, cw * 0.35);
      ctx.strokeStyle = css('paint-blue', 0.5);
      ctx.lineWidth = Math.max(1, b.h * 0.005);
      for (let i = 0; i <= GRID.cols; i++) {
        ctx.beginPath();
        ctx.moveTo(b.x + m + i * cw, top - cw * 0.35);
        ctx.lineTo(b.x + m + i * cw, top + gh);
        ctx.stroke();
      }
      for (let k = -1; k <= GRID.rows; k++) {
        const y = k < 0 ? top - cw * 0.35 : top + k * cw;
        ctx.beginPath();
        ctx.moveTo(b.x + m, y);
        ctx.lineTo(b.x + m + gw, y);
        ctx.stroke();
      }
      marks.forEach((c, i) => stamp(b.x + m + cw * ((i % GRID.cols) + 0.5), top + cw * (Math.floor(i / GRID.cols) + 0.5), cw * 0.3, markToken(c), true));
    }
    // the blank stock
    stock(rect(UV.blank));
    // the envelope: its paint (paper when bare), the flap's fold lines on its back, the wax seal at the flap's tip
    const et = paintToken(s.envelope) ?? 'paper';
    {
      const b = rect(UV.envFace);
      stock(b, et);
    }
    {
      const b = rect(UV.envBack);
      stock(b, et);
      ctx.strokeStyle = css('ink', 0.16);
      ctx.lineWidth = Math.max(1, b.h * 0.012);
      const tip = { x: b.x + b.w / 2, y: b.y + b.h * 0.62 };
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.02, b.y + b.h * 0.04);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(b.x + b.w * 0.98, b.y + b.h * 0.04);
      ctx.stroke();
      ctx.strokeStyle = css('ink', 0.08);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.02, b.y + b.h * 0.96);
      ctx.lineTo(tip.x, b.y + b.h * 0.5);
      ctx.lineTo(b.x + b.w * 0.98, b.y + b.h * 0.96);
      ctx.stroke();
      if (s.seal !== null) {
        const tk = markToken(s.seal);
        const rad = b.h * 0.13;
        ctx.fillStyle = css(tk);
        ctx.beginPath();
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          const rr = rad * (1 + 0.1 * Math.sin(k * 2.7));
          if (k === 0) ctx.moveTo(tip.x + Math.cos(a) * rr, tip.y + Math.sin(a) * rr);
          else ctx.lineTo(tip.x + Math.cos(a) * rr, tip.y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = css('ink', 0.3);
        ctx.lineWidth = Math.max(1, rad * 0.12);
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, rad * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
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
      ctx.pickable(o.lever, t, { box: new Box3(new Vector3(D.leverX - 0.05, D.leverY + 0.04, D.leverZ - 0.02), new Vector3(D.leverX + 0.03, tipY + 0.05, tipZ + 0.05)), pad: 0.006, active: () => shown && reachable() });
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
          // standing at 90° (held by the bed's fingers), down flat over the envelope when folded
          const ang = (1 - fold) * (Math.PI / 2);
          const axis = n === 2 ? X : Z;
          const sign = n === 0 ? -1 : n === 1 ? 1 : -1;
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
