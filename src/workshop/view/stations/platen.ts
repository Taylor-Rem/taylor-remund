/**
 * The platen at work (W2 part 4, W5; REWRITE.md § B1 "the tray under the
 * nozzle", § B2 X1 the PLATEN row, X3 "paint drains back up the nozzle, a
 * label peels off").
 *
 * A colour beat: the arm swings over and dips; the sight tube already shows
 * the new paint; the stream runs down out of the nozzle and the new paint
 * wipes over the part under it, from the top at the back down the front,
 * while the tube's level falls; the stream draws back up into the nozzle,
 * the arm lifts and swings home. A label beat (after the paint, when a text
 * asks both): the tape head's ram presses its roller on the part and the
 * carriage runs the strip on behind it, left to right. An undo is the same
 * numbers run backwards and quicker: the paint drawn back up off the part,
 * the tape peeled.
 *
 * This view only PERFORMS: it works the part through the parts hooks
 * (`partsHooks`, a worker): while a beat runs, the part shows the beat's
 * coverage (the wipe's edge, the tape's laid length); before a beat it
 * shows what the beat starts from, after it the part's own fields, which
 * the beat ends on. The parts view and Fetch's view draw it.
 *
 * Beats run one after the other in the order the simulation lists them
 * (a text's paint, then its label; an undo's label, then its paint), each
 * for its own length, even past the time the simulation keeps listing it.
 *
 * The station lamp follows `PlatenView.lamp`; when the plug seats in its
 * jack the arm nods (`answered`); a misfire twitches the arm.
 */
import { Group, Matrix4, type Object3D } from 'three';
import type { Id, PlatenView, StationBeat, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Token } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import { splitStatic, type StaticPool } from './set.ts';
import { posePlaten, setPaint, REST, type PlatenPose } from '../kit/pieces/platen/index.ts';
import { clamp01, inOutCubic, inOutQuad, outBack, outCubic, smoothstep } from '../anim/index.ts';
import { patchlampBus } from './patchlamp-bus.ts';
import { WIPE_AXIS, partsHooks, unhook, type PartWork, type PartWorker } from './parts.ts';

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
  /** The wipe runs under the stream: from this point of the colour beat to that one. */
  wipe: [0.33, 0.7] as readonly [number, number],
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

/** How far the wipe has run at u of the colour beat (forwards): it follows the stream. */
function wipeAt(u: number): number {
  const [a, b] = PLATEN_FEEL.wipe;
  return smoothstep(a, b, u);
}

/** The label beat at u (0..1, forwards): the arm over, the ram down, the strip laid, the ram up. */
function labelPose(u: number, p: PlatenPose): void {
  p.swing = Math.max(p.swing ?? 0, u < 0.12 ? inOutCubic(u / 0.12) : u > 0.88 ? 1 - inOutCubic((u - 0.88) / 0.12) : 1);
  p.press = u < 0.12 ? 0 : u < 0.24 ? outBack(1.2)((u - 0.12) / 0.12) : u < 0.8 ? 1 : u < 0.9 ? 1 - inOutQuad((u - 0.8) / 0.1) : 0;
  p.tape = tapeAt(u);
}

/** How much of the strip is laid at u of the label beat (forwards): it grows behind the roller. */
function tapeAt(u: number): number {
  return u < 0.24 ? 0 : u < 0.8 ? inOutQuad((u - 0.24) / 0.56) : 1;
}

/** One beat being performed: when it starts (simulation seconds), how long it runs. */
interface Perf {
  field: string;
  part: Id | null;
  from: unknown;
  to: unknown;
  how: StationBeat['how'];
  /** When the simulation began it, and when this view starts performing it (after the beat before it in the same text). */
  began: number;
  start: number;
  len: number;
}

/** The beats of the platen being performed now, oldest first: the simulation's list, each kept until performed. */
export class PlatenPerformances {
  readonly list: Perf[] = [];
  #reduced = false;

  /** Read this step's beats (the simulation lists each for `PATCHLAMP_BEAT_SECONDS`; a beat is performed for its own length). */
  update(v: PlatenView, w: WorldView, reduced: boolean): void {
    this.#reduced = reduced;
    const now = w.time;
    for (const b of v.beats) {
      if (b.field !== 'colour' && b.field !== 'label') continue;
      const began = Math.round((now - b.since) * 600) / 600;
      if (this.list.some((p) => p.field === b.field && p.part === b.part && p.how === b.how && Math.abs(p.began - began) < 1e-3)) continue;
      // a newer change of the same field replaces the one performing (the simulation does the same)
      for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.field === b.field && this.list[i]!.part === b.part) this.list.splice(i, 1);
      const base = b.field === 'label' ? PLATEN_FEEL.label : PLATEN_FEEL.colour;
      const len = b.how === 'change' ? base : base / (b.how === 'undo' ? PLATEN_FEEL.undoSpeed : PLATEN_FEEL.resetSpeed);
      // after the beat begun in the same step, listed before it (one text's paint then its label)
      const prev = [...this.list].reverse().find((p) => Math.abs(p.began - began) < 1e-3 && p.part === b.part);
      this.list.push({ field: b.field, part: b.part, from: b.from, to: b.to, how: b.how, began, start: prev ? prev.start + prev.len : began, len });
    }
    // performed and over: forgotten
    for (let i = this.list.length - 1; i >= 0; i--) if (now >= this.list[i]!.start + this.list[i]!.len + 0.1) this.list.splice(i, 1);
  }

  /** 0..1 through `p` at simulation time `t` (1 at once with reduced motion). */
  k(p: Perf, t: number): number {
    return this.#reduced ? 1 : clamp01((t - p.start) / p.len);
  }

  /** The performance of `field` on `part` that is running or waiting to run at `t` (the earliest), or undefined. */
  of(field: string, part: Id | null, t: number): Perf | undefined {
    return this.list.find((p) => p.field === field && (part === null || p.part === part) && this.k(p, t) < 1);
  }

  /** The part's coverage at `t` while a beat runs or waits on it: into `out`. True if any does. */
  work(id: Id, t: number, out: PartWork): boolean {
    let any = false;
    const c = this.of('colour', id, t);
    if (c) {
      const fwd = c.how === 'change';
      const u = fwd ? this.k(c, t) : 1 - this.k(c, t);
      // forwards the new paint wipes over the old; backwards the same edge runs back (the forward change's from and to)
      const before = String(fwd ? c.from : c.to), after = String(fwd ? c.to : c.from);
      out.paint = { from: before, to: after, t: wipeAt(u), axis: WIPE_AXIS };
      any = true;
    }
    const l = this.of('label', id, t);
    if (l) {
      const fwd = l.how === 'change';
      const u = fwd ? this.k(l, t) : 1 - this.k(l, t);
      const before = String(fwd ? l.from : l.to), after = String(fwd ? l.to : l.from);
      // the words being laid grow behind the roller; a label taken away peels back the same way
      out.label = after !== '' ? { text: after, length: tapeAt(u) } : { text: before, length: 1 - tapeAt(u) };
      any = true;
    }
    return any;
  }
}

export interface PlatenViewOptions {
  entry: Entry | undefined;
  at: Matrix4;
  seed: number;
  pool?: StaticPool;
  key: object;
}

const HIDDEN = 1e-4;

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
    let strip: Object3D | null = null;
    obj.traverse((x) => {
      if (x.name === 'label.strip' && !strip) strip = x;
    });

    const perfs = new PlatenPerformances();
    // the part on the tray (or one a beat is still running on) shows the beat's coverage
    const worker: PartWorker = (id, frame, out) => perfs.work(id, frame.time, out);
    const hooks = partsHooks(ctx.scene);
    hooks.workers.push(worker);

    const pose: PlatenPose = { ...REST };
    let posed = '';
    let tubePaint = '';

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const mv = w.machine('platen');
        if (!mv || mv.kind !== 'platen') return;
        const v = mv as PlatenView;
        const reduced = w.reducedMotion || ctx.reducedMotion;
        const t = frame.time;
        perfs.update(v, w, reduced);
        Object.assign(pose, REST);
        const part = v.onTray ? w.part(v.onTray) : undefined;
        const labelled = !!part && part.label !== '';

        const colourP = perfs.of('colour', null, t);
        const labelP = perfs.of('label', null, t);
        let busy = false;
        if (colourP && perfs.k(colourP, t) > 0) {
          busy = true;
          const fwd = colourP.how === 'change';
          const u = fwd ? perfs.k(colourP, t) : 1 - perfs.k(colourP, t);
          colourPose(u, pose);
          // the tube shows the paint going on (forwards) or being drawn back (undo)
          const inTube = paintOf(fwd ? colourP.to : colourP.from);
          if (inTube && tubePaint !== inTube) {
            setPaint(obj, inTube);
            tubePaint = inTube;
          }
          if (inTube === null) pose.flow = 0;
        }
        if (labelP && perfs.k(labelP, t) > 0) {
          busy = true;
          const fwd = labelP.how === 'change';
          labelPose(fwd ? perfs.k(labelP, t) : 1 - perfs.k(labelP, t), pose);
        } else if (labelP) pose.tape = labelP.how === 'change' ? 0 : 1;
        else pose.tape = labelled ? 1 : 0;

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
        // a crate carries its own tape (the parts view lays it); the platen's blank strip is for anything else
        const ownTape = !part || part.kind === 'crate';
        const key = `${pose.swing!.toFixed(4)}|${pose.dip!.toFixed(4)}|${pose.flow!.toFixed(4)}|${pose.tray!.toFixed(3)}|${pose.press!.toFixed(4)}|${pose.tape!.toFixed(4)}|${pose.level!.toFixed(3)}|${pose.pressure!.toFixed(3)}|${pose.wheel!.toFixed(3)}|${pose.lamp}|${ownTape}`;
        if (key !== posed) {
          posePlaten(obj, pose);
          if (ownTape && strip) (strip as Object3D).scale.setScalar(HIDDEN);
          posed = key;
        }
      },
      dispose() {
        unhook(hooks.workers, worker);
        root.removeFromParent();
      },
    };
  };
}
