/**
 * The ledger board, alive (P4 D1; sim/machines/ledger.ts). The parts view draws the board itself (its piece is
 * view/kit/pieces/ledger-board, posed where the simulation says, hovered, squashed, carried); this view poses the
 * piece's moving nodes from the board's state every frame, and gives the crank and the plunger their pick targets.
 *
 * - The tokens: each where `LedgerView.tokens` says; while a show plays, where its script has them (`tokensAt`): a
 *   drop is a hop from the hopper to a cup, a coin flipping once; the bounce a high jump out of the cup and a little
 *   rebound in the gutter; a wipe a hop back to the hopper; the gate a short sideways flick into the side cup; a
 *   rewind (the lever, a reset) a quick low hop straight back. The rubber payment is the rubber node wherever its
 *   index is; its tier's core shows at its middle.
 * - The flag: up (the red star stands high over the board: the allocations do not add up) or down (folded along the
 *   right end), as the script says while a show plays, else as the state says. Up, it snaps with a twang and
 *   overshoots and settles on its spring; down at the end of a repair, it is pressed down and settles with a little
 *   bounce. A mark, never a lamp: nothing glows.
 * - The crank turns once under the hand and an eighth of a turn with every token dealt; the plunger goes down and
 *   comes back under the hand (at once, even when its repair waits for a deal to finish), and only part way (a
 *   twitch) when it refuses; the gate swings across as it
 *   routes the bounced payment. A Button misfire twitches either; a tell wiggles the crank and bobs the plunger.
 * - Painted (the platen, a text), its wooden base wears the paint; the brass, the rubber and the tokens are not painted.
 * - Reduced motion: no travel at all. The tokens are drawn where the state says the moment it changes, the flag with
 *   them; the controls still move under the visitor's hand (a press is a press).
 *
 * Everything here is view-only: nothing the simulation owns is written. Time is the simulation's (`Frame.time`).
 */
import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3, type BufferAttribute, type BufferGeometry, type Mesh } from 'three';
import type { Id, LedgerView, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { TOKENS, placeOf, rubberOf, starAt, tokensAt, type Place, type TokenAt } from '../../sim/index.ts';
import { BOARD, SIDE_AT, cupAt, gutterAt, hopperAt } from '../kit/pieces/ledger-board/dims.ts';
import { linear } from '../palette.ts';
import { paintToken } from './parts.ts';

/** Tune here: how the board moves (view only). Heights in units. */
export const LEDGER_FEEL = {
  /** A drop's hop: its least height over the straight line, and how much more per unit it travels. */
  hop: 0.055,
  hopPerUnit: 0.28,
  /** The bounce: how high it jumps, and its rebound in the gutter (share of the bounce's time, height). */
  bounce: 0.23,
  rebound: 0.32,
  reboundH: 0.03,
  /** The gate's flick and the rewind's hop. */
  gateH: 0.05,
  rewindH: 0.03,
  /** The gate swings this far (radians). */
  gateSwing: 1.25,
  /** A hand turns the crank once over this long (s); a deal turns it this much more with every token dealt. */
  crankTurn: 0.3,
  crankPerToken: Math.PI / 4,
  /** A press takes the plunger down and back over this long (s). */
  press: 0.24,
  /** A refusal pushes the plunger this share of its travel, over this long (s). */
  refuseDepth: 0.3,
  refuseTime: 0.28,
  /** A tell: the crank rocks, the plunger bobs, for this long (s). */
  tellTime: 1.2,
  /** The flag's spring: up, stiff and lightly damped (a twang, an overshoot, a settle); down, softer and well damped, with a little bounce off its rest; a kick as it lets go. */
  flagUpOmega: 22,
  flagUpZeta: 0.22,
  flagDownOmega: 16,
  flagDownZeta: 0.55,
  flagRest: 0.3,
  flagKick: 6,
  /** Hover: the plunger's T-handle rises this much (units). */
  hoverLift: 0.004,
} as const;

const HIDE = 1e-4;
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface Nodes {
  tokens: Object3D[];
  rubber: Object3D;
  crank: Object3D;
  plunger: Object3D;
  gate: Object3D;
  flag: Object3D;
  rest: Map<Object3D, { p: Vector3; q: Quaternion }>;
}

export interface LedgerViewOptions {
  /** The board's part id and the unit's id (sim LEDGER). */
  readonly board: Id;
  readonly unit: Id;
  readonly crank: Id;
  readonly plunger: Id;
}

const qa = new Quaternion();
const qb = new Quaternion();
const va = new Vector3();
const vb = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const footM = new Matrix4();

/** Where a token lies at a place (its bottom's centre), and its tilt there. */
function placed(p: Place, i: number, rubber: number, out: Vector3, q: Quaternion): void {
  q.identity();
  if (p === 'h') {
    const h = hopperAt(i);
    out.set(h.p[0], h.p[1], h.p[2]);
    q.setFromAxisAngle(X, h.tilt[0]).multiply(qb.setFromAxisAngle(Z, h.tilt[1]));
    return;
  }
  if (p === 'g') {
    const g = gutterAt(rubber);
    out.set(g[0], g[1], g[2]);
    q.setFromAxisAngle(Z, 0.06);
    return;
  }
  if (p === 's') {
    out.set(SIDE_AT[0], SIDE_AT[1], SIDE_AT[2]);
    q.setFromAxisAngle(X, -0.05);
    return;
  }
  const c = cupAt(Number(p.slice(1)));
  out.set(c[0], c[1], c[2]);
}

export function createLedgerView(o: LedgerViewOptions): (ctx: ViewContext) => StationView {
  return (ctx: ViewContext): StationView => {
    const F = LEDGER_FEEL;
    const root = new Group();
    root.name = 'ledger';
    ctx.scene.add(root);
    /** The pick targets hang here, posed as the board is drawn (not under the board's object, whose box is the board's target). */
    const holder = new Group();
    holder.name = 'ledger:targets';
    holder.matrixAutoUpdate = false;
    root.add(holder);
    let group: Group | null = null;
    let obj: Object3D | null = null;
    let nodes: Nodes | null = null;
    let half = 0.04;
    let shown = false;
    const tells = new Map<Id, number>();
    let refusedAt = -Infinity;
    /** The flag: how far up (0 down .. 1 up, past 1 in its overshoot), its rate, the time it was last stepped, which way it was going. */
    let flagA = 0;
    let flagV = 0;
    let flagT: number | null = null;
    let flagUp = false;
    /** When each control was last worked by a hand (it travels at once, even when its work waits its turn). */
    let crankAt = -Infinity;
    let plungerAt = -Infinity;

    const find = (w: WorldView): void => {
      if (nodes) return;
      const g = ctx.scene.getObjectByName(`part:${o.board}`) as Group | undefined;
      const piece = g?.children[0];
      if (!g || !piece) return;
      const by = (name: string): Object3D | null => {
        let n: Object3D | null = null;
        piece.traverse((x) => {
          if (!n && x.name === name && !(x as { isMesh?: boolean }).isMesh) n = x;
        });
        return n;
      };
      const tokens = Array.from({ length: TOKENS }, (_, i) => by(`token-${i}`));
      const rest = [by('rubber'), by('crank'), by('plunger'), by('gate'), by('flag')];
      if (tokens.some((x) => !x) || rest.some((x) => !x)) return;
      group = g;
      obj = piece;
      half = w.halfExtents(o.board)?.[1] ?? half;
      const [rubber, crank, plunger, gate, flag] = rest as Object3D[];
      const all = [...(tokens as Object3D[]), rubber!, crank!, plunger!, gate!, flag!];
      nodes = { tokens: tokens as Object3D[], rubber: rubber!, crank: crank!, plunger: plunger!, gate: gate!, flag: flag!, rest: new Map(all.map((n) => [n, { p: n.position.clone(), q: n.quaternion.clone() }])) };
      // the crank's target: round its arm and grip (a finger finds it at the framing the camera gives; the input grows a small one to 44 px)
      const crankT = new Object3D();
      crankT.name = 'ledger:crank.pick';
      holder.add(crankT);
      ctx.pickable(o.crank, crankT, { box: new Box3(new Vector3(BOARD.hopperX - BOARD.crankArm - 0.02, BOARD.crankY - BOARD.crankArm - 0.02, BOARD.hopperZ + BOARD.crankZ - 0.01), new Vector3(BOARD.hopperX + BOARD.crankArm + 0.02, BOARD.crankY + BOARD.crankArm + 0.02, BOARD.hopperZ + BOARD.crankZ + 0.06)), pad: 0.006, active: () => shown && reachable() });
      const plungerT = new Object3D();
      plungerT.name = 'ledger:plunger.pick';
      holder.add(plungerT);
      ctx.pickable(o.plunger, plungerT, { box: new Box3(new Vector3(BOARD.plungerX - 0.055, BOARD.h + 0.02, BOARD.plungerZ - 0.03), new Vector3(BOARD.plungerX + 0.055, BOARD.plungerTop + 0.01, BOARD.plungerZ + 0.03)), pad: 0.006, active: () => shown && reachable() });
    };

    let lastWorld: WorldView | null = null;
    const reachable = (): boolean => {
      const m = lastWorld?.motion(o.board);
      return !!m && (m.mode === 'free' || m.mode === 'machine') && !m.held;
    };

    /** Pose a node from its rest: a translation and a turn in the piece's space. */
    const pose = (n: Object3D, p: Vector3 | null, q: Quaternion | null): void => {
      const r = nodes!.rest.get(n)!;
      if (p) n.position.copy(p);
      else n.position.copy(r.p);
      n.quaternion.copy(r.q);
      if (q) n.quaternion.multiply(q);
      n.updateMatrix();
    };
    const show = (n: Object3D, on: boolean): void => {
      const s = on ? 1 : HIDE;
      if (n.scale.x !== s) {
        n.scale.setScalar(s);
        n.updateMatrix();
      }
    };

    /** A token on its way from one place to another, `k` of the way: its bottom's centre and its turn. */
    const between = (a: TokenAt, i: number, rubber: number, out: Vector3, q: Quaternion): void => {
      placed(a.from, i, rubber, va, qa);
      placed(a.to, i, rubber, vb, q);
      let k = a.k;
      let h = 0;
      let spin = 0;
      const d = va.distanceTo(vb);
      if (a.kind === 'bounce') {
        // out of the cup, high, down in the gutter, and a little rebound there
        const share = 1 - F.rebound;
        if (k < share) {
          const u = k / share;
          k = u;
          h = F.bounce * 4 * u * (1 - u);
          spin = u * Math.PI * 4;
        } else {
          const u = (k - share) / F.rebound;
          k = 1;
          h = F.reboundH * 4 * u * (1 - u);
          spin = Math.PI * 4;
        }
      } else if (a.kind === 'gate') {
        k = smooth(k);
        h = F.gateH * 4 * k * (1 - k);
      } else if (a.kind === 'rewind') {
        k = smooth(k);
        h = F.rewindH * 4 * k * (1 - k);
      } else {
        // a drop, a wipe, a gather: a hop, the coin flipping once
        h = (F.hop + F.hopPerUnit * d) * 4 * k * (1 - k);
        spin = k * Math.PI * 2;
      }
      out.lerpVectors(va, vb, k);
      out.y += h;
      q.slerp(qa, 1 - k);
      if (spin !== 0) q.multiply(qb.setFromAxisAngle(X, spin));
    };

    /**
     * Painted (the platen, a text): the board's wooden base takes the paint, as a crate's planks do (the wood class
     * reads its finish as paint coverage), in the paint's colour at each vertex's own tone; bare again, its own wood.
     */
    let painted = 'bare';
    const bareOf = new Map<BufferGeometry, { col: Float32Array; finish: Float32Array }>();
    const paint = (colour: string): void => {
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
          // this board's own copy (a piece's geometry may be shared through the build memo)
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

    const tp = new Vector3();
    const tq = new Quaternion();
    const pp = new Vector3();

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        lastWorld = w;
        find(w);
        const lv = w.machine(o.unit) as LedgerView | undefined;
        if (!nodes || !group || !obj || !lv || lv.kind !== 'ledger') return;
        const N = nodes;
        shown = group.visible;
        holder.matrix.copy(group.matrix).multiply(footM.makeTranslation(0, -half, 0));
        holder.matrixWorldNeedsUpdate = true;
        holder.visible = shown;
        const refused = frame.events.some((e) => e.type === 'ledger.refused');
        for (const e of frame.events) {
          if (e.type === 'tell' && (e.id === o.crank || e.id === o.plunger)) tells.set(e.id, frame.time);
          if (e.type === 'ledger.refused') refusedAt = frame.time;
          if (e.type === 'handle.worked' && e.id === o.crank) crankAt = frame.time;
          if (e.type === 'handle.worked' && e.id === o.plunger && !refused) plungerAt = frame.time;
        }
        paint(w.part(o.board)?.colour ?? 'bare');
        if (!shown) return;
        const reduced = ctx.reducedMotion || w.reducedMotion;
        const s = lv.show;
        // seconds into the show at this render (the view's `since` is as of the last step)
        const t = s ? s.since + Math.max(0, frame.time - w.time) : Infinity;
        const script = s ? { beats: s.beats, length: s.length } : null;
        const at: TokenAt[] = s && script && !reduced ? tokensAt(script, s.before, s.after, t) : lv.tokens.map((x) => ({ from: placeOf(x), to: placeOf(x), k: 1, kind: null }));
        // which index the rubber payment is: during a show, as its `after` says (the deal changes it at the gather's end; the same index either side of a repair)
        const rubberNow = s && !reduced ? (t < dealSwap(s) ? rubberOf(s.before) : rubberOf(s.after)) : rubberOf(lv.tokens);
        for (let i = 0; i < TOKENS; i++) {
          const a = at[i]!;
          between(a, i, rubberNow, tp, tq);
          const isR = i === rubberNow;
          show(N.tokens[i]!, !isR);
          if (isR) pose(N.rubber, tp, tq);
          else pose(N.tokens[i]!, tp, tq);
        }
        // the flag: its goal up or down; a spring that snaps up (stiff, little damping: it twangs and settles) and is pressed down
        const up = s && script && !reduced ? starAt(script, s.before, s.after, t) : lv.wrong;
        const goal = up ? 1 : 0;
        if (reduced || flagT === null) {
          flagA = goal;
          flagV = 0;
        } else {
          let left = Math.min(0.1, Math.max(0, frame.time - flagT));
          const omega = up ? F.flagUpOmega : F.flagDownOmega;
          const zeta = up ? F.flagUpZeta : F.flagDownZeta;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            flagV += (omega * omega * (goal - flagA) - 2 * zeta * omega * flagV) * h;
            flagA += flagV * h;
            // the arm lies on its rest when down: it cannot go through the board
            if (flagA < 0) {
              flagA = 0;
              flagV = -flagV * F.flagRest;
            }
            left -= h;
          }
        }
        flagT = frame.time;
        if (up !== flagUp) {
          if (up && !reduced) flagV += F.flagKick;
          flagUp = up;
        }
        pose(N.flag, null, qa.setFromAxisAngle(Y, (Math.PI / 2) * flagA));
        // the crank: once round under the hand, an eighth with every token dealt; a misfire's twitch; a tell's rock
        let crank = Math.PI * 2 * smooth((frame.time - crankAt) / F.crankTurn);
        if (s && s.kind === 'deal' && !reduced) crank += F.crankPerToken * s.beats.filter((x) => x.kind === 'drop' && t >= x.at).length;
        const cm = lv.crankMisfire;
        if (cm && cm.since < 0.4) crank += Math.sin((cm.since / 0.4) * Math.PI) * 0.35 * cm.level;
        const ct = tells.get(o.crank);
        if (ct !== undefined && frame.time - ct < F.tellTime && !reduced) crank += Math.sin((frame.time - ct) * 14) * 0.18 * (1 - (frame.time - ct) / F.tellTime);
        pose(N.crank, null, qa.setFromAxisAngle(Y, -crank));
        // the plunger: down and back as the repair begins; part way when it refuses; a misfire's twitch; a tell's bob; a hair up under the pointer
        let down = 0;
        const u = (frame.time - plungerAt) / F.press;
        if (u > 0 && u < 1) down = u < 0.35 ? smooth(u / 0.35) : 1 - smooth((u - 0.35) / 0.65);
        const ru = (frame.time - refusedAt) / F.refuseTime;
        if (ru >= 0 && ru < 1) down = Math.max(down, F.refuseDepth * Math.sin(ru * Math.PI));
        const pm = lv.misfire;
        if (pm && pm.since < 0.3) down = Math.max(down, 0.4 * pm.level * Math.sin((pm.since / 0.3) * Math.PI));
        const pt = tells.get(o.plunger);
        if (pt !== undefined && frame.time - pt < F.tellTime && !reduced) down = Math.max(down, 0.12 * Math.max(0, Math.sin((frame.time - pt) * 9)));
        const lift = frame.hovered === o.plunger && down === 0 ? F.hoverLift : 0;
        const r = N.rest.get(N.plunger)!;
        pp.copy(r.p);
        pp.y += lift - down * BOARD.plungerTravel;
        pose(N.plunger, pp, null);
        // the gate: across and back as it routes the bounced payment
        let swing = 0;
        if (s && !reduced) {
          for (const b of s.beats) {
            if (b.kind !== 'gate') continue;
            const u = (t - b.at) / (b.dur * 1.6);
            if (u > 0 && u < 1) swing = Math.max(swing, F.gateSwing * Math.sin(u * Math.PI));
          }
        }
        pose(N.gate, null, qa.setFromAxisAngle(Y, -swing));
        obj.updateMatrixWorld(true);
      },
      dispose() {
        root.removeFromParent();
        nodes = null;
      },
    };
  };
}

/** A deal changes which payment is rubber: before its gather is done the old one is, after it the new one. */
function dealSwap(s: NonNullable<LedgerView['show']>): number {
  if (s.kind !== 'deal') return -Infinity;
  const first = s.beats.find((b) => b.kind === 'drop');
  return first ? first.at : -Infinity;
}

