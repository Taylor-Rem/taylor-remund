/**
 * The platen at work (W2 part 4; REWRITE.md § B1 "the tray under the
 * nozzle", § B2 X1 the PLATEN row, X3 "paint drains back up the nozzle, a
 * label peels off").
 *
 * A colour beat: the arm swings over and dips; the sight tube already shows
 * the new paint; the stream runs down out of the nozzle while the tray turns
 * the part under it and the tube's level falls; the part takes the colour
 * half way round; the stream draws back up into the nozzle, the arm lifts
 * and swings home. A label beat (after the paint, when a text asks both):
 * the tape head's ram presses its roller on the part and the carriage runs
 * the strip on behind it. An undo is the same numbers run backwards and
 * quicker: paint drawn back up, the tape peeled. The part on the tray is
 * repainted through the crate's own `repaint` on the parts view's object.
 *
 * The station lamp follows `PlatenView.lamp`; when the plug seats in its
 * jack the arm nods (`answered`); a misfire twitches the arm.
 */
import { Group, Matrix4, type Object3D } from 'three';
import type { PlatenView, StationBeat } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Token } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import { splitStatic, type StaticPool } from './set.ts';
import { posePlaten, setPaint, REST, type PlatenPose } from '../kit/pieces/platen/index.ts';
import { repaint } from '../kit/pieces/crate/index.ts';
import { clamp01, inOutCubic, inOutQuad, outBack, outCubic } from '../anim/index.ts';
import { patchlampBus } from './patchlamp-bus.ts';

/** Tune here: seconds; the beat's phases as fractions of it. */
export const PLATEN_FEEL = {
  colour: 2.6,
  label: 1.9,
  undoSpeed: 1.6,
  resetSpeed: 3,
  /** The answer when the plug seats: a nod of the arm (its swing), over this long. */
  nod: 0.7,
  nodSwing: 0.16,
  blink: 1.2,
};

const PAINTS = new Set(['cable-red', 'paint-orange', 'tape-yellow', 'paint-green', 'teal-light', 'paint-blue', 'paint-violet', 'paper']);
const paintOf = (c: unknown): Token | null => (typeof c === 'string' && PAINTS.has(c) ? (c as Token) : null);

/** The colour beat at u (0..1, forwards). */
function colourPose(u: number, p: PlatenPose): void {
  p.swing = outBack(1.4)(clamp01(u / 0.16));
  if (u > 0.84) p.swing = 1 - inOutCubic((u - 0.84) / 0.16);
  p.dip = u < 0.16 ? 0 : u < 0.3 ? inOutQuad((u - 0.16) / 0.14) : u < 0.74 ? 1 : u < 0.86 ? 1 - inOutQuad((u - 0.74) / 0.12) : 0;
  p.flow = u < 0.3 ? 0 : u < 0.4 ? outCubic((u - 0.3) / 0.1) : u < 0.64 ? 1 : u < 0.74 ? 1 - inOutQuad((u - 0.64) / 0.1) : 0;
  // the tray only shivers under the stream (the part on it is the parts view's: it does not turn with it)
  p.tray = u > 0.36 && u < 0.7 ? 0.04 * Math.sin((u - 0.36) * 60) * Math.sin(Math.PI * (u - 0.36) / 0.34) : 0;
  p.level = REST.level - 0.23 * clamp01((u - 0.34) / 0.36);
  p.pressure = REST.pressure + 0.38 * Math.sin(Math.PI * clamp01(u / 0.8));
  p.wheel = 1.6 * clamp01((u - 0.3) / 0.45);
}

/** The label beat at u (0..1, forwards): the arm over, the ram down, the strip laid, the ram up. */
function labelPose(u: number, p: PlatenPose): void {
  p.swing = Math.max(p.swing ?? 0, u < 0.12 ? inOutCubic(u / 0.12) : u > 0.88 ? 1 - inOutCubic((u - 0.88) / 0.12) : 1);
  p.press = u < 0.12 ? 0 : u < 0.24 ? outBack(1.2)((u - 0.12) / 0.12) : u < 0.8 ? 1 : u < 0.9 ? 1 - inOutQuad((u - 0.8) / 0.1) : 0;
  p.tape = u < 0.24 ? 0 : u < 0.8 ? inOutQuad((u - 0.24) / 0.56) : 1;
}

export interface PlatenViewOptions {
  entry: Entry | undefined;
  at: Matrix4;
  seed: number;
  pool?: StaticPool;
  key: object;
}

export function createPlatenView(o: PlatenViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = PLATEN_FEEL;
    const root = new Group();
    root.name = 'platen';
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => root.removeFromParent() };
    const whole = buildEntry(o.entry, null, { seed: o.seed }, ctx.labels);
    const moving = (n: string): boolean => /^tray$|^arm$|^tapehead|^sight\.paint$|^gauge\.needle$|^handwheel$|^lamp\./.test(n);
    const live = o.pool ? splitStatic(whole, o.at, moving, o.pool) : whole;
    const obj: Object3D = ctx.realize(live);
    obj.applyMatrix4(o.at);
    root.add(obj);
    patchlampBus(o.key).stations.platen = obj;

    const pose: PlatenPose = { ...REST };
    let posed = '';
    let tubePaint = '';
    let partId: string | null = null;
    let partObj: Object3D | null = null;
    let partPaint: string | null = '?';
    let labelled = false;
    const partObject = (id: string | null): Object3D | null => {
      if (id !== partId) {
        partId = id;
        partObj = id ? ctx.scene.getObjectByName(`part:${id}`) ?? null : null;
        partPaint = '?';
      } else if (id && !partObj) partObj = ctx.scene.getObjectByName(`part:${id}`) ?? null;
      return partObj;
    };
    const showPart = (paint: Token | null): void => {
      const key = paint ?? 'bare';
      if (!partObj || partPaint === key) return;
      repaint(partObj, paint);
      partPaint = key;
    };
    const lengthOf = (b: StationBeat): number => {
      const base = b.field === 'label' ? F.label : F.colour;
      return b.how === 'change' ? base : base / (b.how === 'undo' ? F.undoSpeed : F.resetSpeed);
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const mv = w.machine('platen');
        if (!mv || mv.kind !== 'platen') return;
        const v = mv as PlatenView;
        const reduced = w.reducedMotion || ctx.reducedMotion;
        const t = frame.time;
        Object.assign(pose, REST);
        const part = v.onTray ? w.part(v.onTray) : undefined;
        const pobj = partObject(v.onTray);
        let partShows: Token | null = paintOf(part?.colour);
        labelled = !!part && part.label !== '';

        const colourB = v.beats.find((b) => b.field === 'colour');
        const labelB = v.beats.find((b) => b.field === 'label');
        let busy = false;
        if (colourB) {
          const len = lengthOf(colourB);
          const k = reduced ? 1 : clamp01(colourB.since / len);
          if (k < 1) {
            busy = true;
            const fwd = colourB.how === 'change';
            const u = fwd ? k : 1 - k;
            colourPose(u, pose);
            // the tube shows the paint going on (forwards) or being drawn back (undo)
            const inTube = paintOf(fwd ? colourB.to : colourB.from);
            if (inTube && tubePaint !== inTube) {
              setPaint(obj, inTube);
              tubePaint = inTube;
            }
            if (inTube === null) pose.flow = 0;
            const before = paintOf(colourB.from), after = paintOf(colourB.to);
            partShows = fwd ? (u >= 0.5 ? after : before) : u >= 0.5 ? before : after;
          }
        }
        if (labelB) {
          const after = colourB && colourB.since < lengthOf(colourB) ? lengthOf(colourB) : 0;
          const len = lengthOf(labelB);
          const k = reduced ? 1 : clamp01((labelB.since - after) / len);
          if (k < 1) {
            busy = true;
            const fwd = labelB.how === 'change';
            const u = fwd ? k : 1 - k;
            labelPose(u, pose);
            if (labelB.since < after) pose.tape = fwd ? 0 : 1;
          }
        }
        if (!labelB || pose.tape === REST.tape) {
          if (!(labelB && busy)) pose.tape = labelled ? 1 : 0;
        }
        if (pobj) showPart(partShows);

        // the plug seats in its jack: the arm nods
        if (!busy && v.answered < F.nod && !reduced) {
          const a = v.answered / F.nod;
          pose.swing = F.nodSwing * Math.sin(Math.PI * a) * (1 - a * 0.4);
          pose.dip = 0.08 * Math.sin(Math.PI * clamp01(a * 2 - 0.4));
        }
        // a misfire: the arm twitches
        if (!busy && v.misfire && v.misfire.since < 0.8 && !reduced) {
          const s = v.misfire.since;
          pose.swing = Math.abs(0.12 * v.misfire.level * Math.sin(s * 24) * Math.exp(-s * 5));
          pose.pressure = REST.pressure + 0.3 * Math.exp(-s * 4);
        }
        pose.lamp = v.lamp === 'steady' ? 1 : v.lamp === 'blink' ? ((t / F.blink) % 1 < 0.5 ? 1 : 0) : v.answered < F.nod ? 1 : 0;
        const key = `${pose.swing!.toFixed(4)}|${pose.dip!.toFixed(4)}|${pose.flow!.toFixed(4)}|${pose.tray!.toFixed(3)}|${pose.press!.toFixed(4)}|${pose.tape!.toFixed(4)}|${pose.level!.toFixed(3)}|${pose.pressure!.toFixed(3)}|${pose.wheel!.toFixed(3)}|${pose.lamp}`;
        if (key !== posed) {
          posePlaten(obj, pose);
          posed = key;
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}
