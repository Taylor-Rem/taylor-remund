/**
 * The paint dial, alive (P4 D2b; sim/machines/paint-dial.ts). The parts view draws the dial itself (its piece is
 * view/kit/pieces/paint-dial, posed where the simulation says, hovered, carried); this view
 *
 * - poses the dial's control from its scheme: the deck's chips flicked over the rod one by one (the chip worn hangs at
 *   the front) and its thumbwheel turned; the fan's knob and needle. A change travels over `PAINT_FEEL.flick` a
 *   detent; a tell rocks it, a misfire twitches it;
 * - repaints the workshop: when the dial's scheme changes (a hand, the lever, a reset) the enamel of every machine
 *   wipes across the room from wherever the dial is now (`materials.paint`), over the simulation's `wipe` seconds,
 *   and cuts under reduced motion; whatever the dial's scheme is when this view starts is shown at once;
 * - gives the control its pick target (`knob`): the deck's chips and wheel, the fan's knob; a finger finds it at the
 *   framing the camera gives a thing, and the input grows a small one to 44 px.
 *
 * `?paint=<letter>` (development): the workshop wears that scheme from the view's start whatever the dial says, so the
 * runners-up (E, F) can be seen on the real bench. Nothing the simulation owns is written. Time is the simulation's.
 */
import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Id, PaintDialView, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import { DIAL_SCHEMES, PAINT_DIAL, deckSwing, paintDialAngle, type PaintDialStyle } from '../kit/pieces/paint-dial/index.ts';
import { SCHEMES, type SchemeId } from '../materials/scheme.ts';

/** Tune here: how the dial moves (view only). */
export const PAINT_FEEL = {
  /** A detent's travel (s): a chip flicked over the rod, the knob from chip to chip. */
  flick: 0.28,
  /** The thumbwheel turns this much a detent (radians). */
  wheelPerDetent: Math.PI * 0.6,
  /** A tell: the front chip (the knob) rocks this much (radians), for this long (s). */
  tellSwing: 0.12,
  tellTime: 1.1,
  /** A misfire: a short twitch of this much (radians). */
  twitch: 0.1,
};

/** The development flag: a scheme to wear whatever the dial says (`?paint=E`), or null. */
export function devScheme(search: string | undefined = (globalThis as { location?: { search?: string } }).location?.search): SchemeId | null {
  const v = new URLSearchParams(search ?? '').get('paint');
  return v && v in SCHEMES ? (v as SchemeId) : null;
}

export interface PaintDialViewOptions {
  /** The dial's part id, the unit's id, the knob's id (sim PAINT). */
  readonly dial: Id;
  readonly unit: Id;
  readonly knob: Id;
  /** Its crate: where the wipe starts from when the dial is not in the world (a reset stows it). */
  readonly crate: Id;
  readonly style: PaintDialStyle;
}

const qa = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const footM = new Matrix4();
const vo = new Vector3();

export function createPaintDialView(o: PaintDialViewOptions): (ctx: ViewContext) => StationView {
  return (ctx: ViewContext): StationView => {
    const F = PAINT_FEEL;
    const root = new Group();
    root.name = 'paint-dial';
    ctx.scene.add(root);
    /** The pick target hangs here, posed as the dial is drawn (not under the dial's object, whose box is the dial's target). */
    const holder = new Group();
    holder.name = 'paint-dial:targets';
    holder.matrixAutoUpdate = false;
    root.add(holder);
    let group: Object3D | null = null;
    let knob: Object3D | null = null;
    let chips: Object3D[] = [];
    const rest = new Map<Object3D, Quaternion>();
    let half = 0.1;
    let shown = false;
    let lastWorld: WorldView | null = null;
    /** The detent drawn now (fractions mid-travel), and the scheme the materials were last told. */
    let drawn = -1;
    let told: string | null = null;
    let tellAt = -Infinity;
    const forced = devScheme();

    const reachable = (): boolean => {
      const m = lastWorld?.motion(o.dial);
      return !!m && (m.mode === 'free' || m.mode === 'machine') && !m.held;
    };

    const find = (w: WorldView): void => {
      if (knob) return;
      const g = ctx.scene.getObjectByName(`part:${o.dial}`);
      const piece = g?.children[0];
      if (!g || !piece) return;
      const by = (name: string): Object3D | null => {
        let n: Object3D | null = null;
        piece.traverse((x) => {
          if (!n && x.name === name && !(x as { isMesh?: boolean }).isMesh) n = x;
        });
        return n;
      };
      const k = by('knob');
      if (!k) return;
      const cs = o.style === 'deck' ? DIAL_SCHEMES.map((_, i) => by(`chip-${i}`)) : [];
      if (cs.some((c) => !c)) return;
      group = g;
      knob = k;
      chips = cs as Object3D[];
      for (const n of [k, ...chips]) rest.set(n, n.quaternion.clone());
      half = w.halfExtents(o.dial)?.[1] ?? half;
      // the control's target: the deck's chips and wheel (a tap anywhere on the deck flicks it), the fan's knob
      const t = new Object3D();
      t.name = 'paint-dial:knob.pick';
      holder.add(t);
      const box = o.style === 'deck'
        ? (() => {
            const D = PAINT_DIAL.deck;
            return new Box3(new Vector3(-D.cardW / 2 - 0.004, D.rodY - D.cardH - 0.01, -0.06), new Vector3(D.rodHalf + 0.032, D.rodY + D.wheelR + 0.004, 0.06));
          })()
        : (() => {
            const P = PAINT_DIAL.fan;
            return new Box3(new Vector3(-P.knobR - 0.01, P.t, P.pivotZ - P.knobR - 0.01), new Vector3(P.knobR + 0.01, P.t + P.knobH + 0.012, P.pivotZ + P.knobR + 0.01));
          })();
      ctx.pickable(o.knob, t, { box, pad: 0.006, active: () => shown && reachable() });
    };

    /** The dial's pose: the deck's chips and wheel, or the fan's knob, at detent `at` (fractions between), plus a rock. */
    const pose = (at: number, rock: number): void => {
      if (o.style === 'deck') {
        chips.forEach((c, i) => {
          // the piece was built at detent 0: its rest is deckSwing(i, 0); turn from there to deckSwing(i, at)
          const d = deckSwing(i, at) - deckSwing(i, 0) + (Math.round(at) === i ? rock : 0);
          c.quaternion.copy(rest.get(c)!).multiply(qa.setFromAxisAngle(X, -d));
          c.updateMatrix();
        });
        knob!.quaternion.copy(rest.get(knob!)!).multiply(qa.setFromAxisAngle(X, -at * F.wheelPerDetent));
        knob!.updateMatrix();
      } else {
        knob!.quaternion.copy(rest.get(knob!)!).multiply(qa.setFromAxisAngle(Y, paintDialAngle(at) - paintDialAngle(0) + rock));
        knob!.updateMatrix();
      }
    };

    /** Where the wipe starts: the dial where it is drawn; else its crate; else the middle of the bench. */
    const origin = (w: WorldView): [number, number, number] => {
      const m = w.motion(o.dial);
      if (m && m.mode !== 'gone' && m.mode !== 'chute') return [m.pose.p[0], m.pose.p[1], m.pose.p[2]];
      const c = w.motion(o.crate);
      if (c) return [c.pose.p[0], c.pose.p[1], c.pose.p[2]];
      ctx.scene.getObjectByName(`part:${o.crate}`)?.getWorldPosition(vo);
      return [vo.x, vo.y + 0.5, vo.z];
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        lastWorld = w;
        const lv = w.machine(o.unit) as PaintDialView | undefined;
        if (!lv || lv.kind !== 'paint-dial') return;
        const reduced = ctx.reducedMotion || w.reducedMotion;
        // the workshop's paint: the dial's scheme (or the development flag's), wiped from where the dial is
        const paint = ctx.materials.paint;
        const want = (forced ?? lv.scheme) as SchemeId;
        if (paint && want !== told) {
          const c = lv.change;
          // a change still crossing the room is wiped from its start; anything else (this view's start, a change long
          // done, the development flag) is shown at once
          const since = c && c.to === lv.scheme && !forced ? c.since + Math.max(0, frame.time - w.time) : Infinity;
          if (told === null || since >= lv.wipe || reduced) paint.set(want, {});
          else paint.set(want, { time: frame.time - since, origin: origin(w), seconds: lv.wipe, reduced });
          told = want;
        }
        find(w);
        if (!knob || !group) return;
        shown = group.visible;
        holder.matrix.copy(group.matrix).multiply(footM.makeTranslation(0, -half, 0));
        holder.matrixWorldNeedsUpdate = true;
        holder.visible = shown;
        for (const e of frame.events) if (e.type === 'tell' && e.id === o.knob) tellAt = frame.time;
        // the control travels to the detent the dial is at, a detent per `flick`
        const target = lv.index;
        if (drawn < 0 || reduced) drawn = target;
        else if (drawn !== target) {
          const step = Math.min(1, Math.max(0, frame.dt) / F.flick);
          drawn = drawn < target ? Math.min(target, drawn + step) : Math.max(target, drawn - step);
        }
        if (!shown) return;
        let rock = 0;
        const tt = frame.time - tellAt;
        if (tt >= 0 && tt < F.tellTime && !reduced) rock = Math.sin(tt * 12) * F.tellSwing * (1 - tt / F.tellTime);
        const mf = lv.misfire;
        if (mf && mf.since < 0.3 && !reduced) rock += F.twitch * mf.level * Math.sin((mf.since / 0.3) * Math.PI);
        pose(drawn, rock);
        group.updateMatrixWorld(true);
      },
      dispose() {
        root.removeFromParent();
        knob = null;
      },
    };
  };
}
