/**
 * The phone on the stage (W2 part 5; REWRITE.md § D 3, § B2 X1).
 *
 *  - When Patch's reply arrives (`line.reply`, `line.refused`) the phone
 *    rings: it buzzes on its easel, a rattle that dies away, and its screen
 *    shows the exchange: the last text sent and the answer to it, drawn into
 *    the screen's own texture (the labels' phone painter; nothing is
 *    rebuilt). Before the first exchange it shows content's attract one.
 *  - Hovered, it tips up on its easel a little (not while a rung plays). A
 *    misfire of the line (a Button rung): one twitch.
 *  - It is the pick target `phone`, with a generous proxy.
 *
 * The phone panel over the stage (ui/phone/stage.ts) asks this view where
 * things are on screen: `stagePhoneBoxes(canvas)` gives the phone's box
 * (the panel's `anchor`) and the box of the station on a line (`avoid`).
 */
import { Box3, Group, Vector3, type DataTexture, type Object3D } from 'three';
import type { LineEntry, LineView } from '../../sim/types.ts';
import type { Frame, StageHandle, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import { placedMatrix } from './set.ts';
import type { Fit } from '../vignette.ts';
import { phoneScreen, posePhone } from '../kit/pieces/phone/index.ts';
import { paintPhone } from '../labels/draw.ts';
import { planPhone } from '../labels/layout.ts';
import { toTextureRows } from '../labels/raster.ts';
import { rng } from '../labels/rng.ts';
import { SUBSET } from '../labels/fonts.ts';
import { renderReply } from '../../../content/texts.ts';
import attractJson from '../../../content/attract.json';
import { damp } from '../anim/index.ts';
import { patchlampBus } from './patchlamp-bus.ts';
import type { JackName } from '../kit/pieces/switchboard/index.ts';

/** Tune here: degrees, seconds. */
export const PHONE_FEEL = {
  /** The ring: how far it rattles, how fast, how long. */
  ring: 2.6,
  ringHz: 19,
  ringFor: 0.9,
  /** It rocks back once as the buzz starts (degrees), then settles. */
  kick: 4,
  /** Hovered: it tips up this far. */
  hover: 5,
  /** A misfire's twitch. */
  twitch: 3,
};

export interface PhoneViewOptions {
  entry: Entry | undefined;
  at: Fit['phone']['at'];
  seed: number;
  key: object;
}

/** What the phone panel needs from the stage: boxes on screen, in page pixels. */
export interface PhoneBoxes {
  anchor(): DOMRect | null;
  avoid(jack: JackName | null): DOMRect | null;
}

let current: { phone: Object3D; stage: StageHandle; stations: Partial<Record<JackName, Object3D>> } | null = null;
const box = new Box3();
const corner = new Vector3();

function screenBox(o: Object3D, stage: StageHandle, canvas: HTMLElement): DOMRect | null {
  box.setFromObject(o);
  if (box.isEmpty()) return null;
  const r = canvas.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const s = stage.camera.worldToScreen(corner);
    const x = r.left + ((s.x + 1) / 2) * r.width, y = r.top + ((1 - s.y) / 2) * r.height;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}

/** The stage phone's box and the stations' boxes on `canvas`, for the phone panel. */
export function stagePhoneBoxes(canvas: HTMLElement): PhoneBoxes {
  return {
    anchor: () => (current ? screenBox(current.phone, current.stage, canvas) : null),
    avoid: (jack) => {
      const o = jack && current ? current.stations[jack] : undefined;
      return o && current ? screenBox(o, current.stage, canvas) : null;
    },
  };
}

const ATTRACT_TEXT = attractJson.text as Record<string, { text: string }>;
const SAFE = new Set(SUBSET.tape);
/** What the screen can print: the phone face's glyphs only (anything else is left out). */
const printable = (s: string): string => [...s].filter((c) => SAFE.has(c)).join('').trim();

export function createPhoneView(o: PhoneViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = PHONE_FEEL;
    const root = new Group();
    root.name = 'phone';
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => root.removeFromParent() };
    const piece = buildEntry(o.entry, null, { seed: o.seed }, ctx.labels);
    const obj = ctx.realize(piece);
    obj.applyMatrix4(placedMatrix(o.at));
    root.add(obj);
    const bus = patchlampBus(o.key);
    bus.phone = obj;
    current = { phone: obj, stage: ctx.stage, stations: bus.stations };
    const picking = (ctx as unknown as { picking?: { add(id: string, o: Object3D, opts?: { pad?: number }): void } }).picking;
    if (picking) picking.add('phone', obj, { pad: 0.12 });
    else ctx.pickable('phone', obj);

    // the screen's texture, repainted in place with the last exchange
    const key = phoneScreen(ctx.labels).key;
    const tex = ctx.labels.texture(key) as DataTexture;
    const plan = planPhone();
    let shownN = -1;
    let shownKind = '';
    const draw = (sent: string, answer: string | null): void => {
      const msgs: { from: 'owner' | 'patch'; text: string }[] = [{ from: 'owner', text: printable(sent) || '…' }];
      if (answer !== null) msgs.push({ from: 'patch', text: printable(answer) || '…' });
      try {
        const p = paintPhone(plan, msgs, rng(`phone-live|${sent}|${answer ?? ''}`));
        const rows = toTextureRows(p.color, p.w, p.h);
        const img = tex.image as { data: Uint8Array; width: number; height: number };
        if (img.data && img.data.length === rows.length) {
          img.data.set(rows);
          tex.needsUpdate = true;
        }
      } catch {
        /* a text the screen cannot lay out stays off it: the panel shows it */
      }
    };

    let ringAt = -Infinity;
    let hover = 0;
    let lastTilt = NaN;

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const reduced = w.reducedMotion || ctx.reducedMotion;
        const t = frame.time;
        for (const e of frame.events) if (e.type === 'line.reply' || e.type === 'line.refused') ringAt = t;
        const lv = w.machine('line');
        const line = lv?.kind === 'line' ? (lv as LineView) : null;

        // the screen: the last text and its answer
        if (line && line.log.length > 0) {
          let sent: Extract<LineEntry, { kind: 'sent' }> | null = null;
          let answer: Extract<LineEntry, { kind: 'reply' | 'refused' }> | null = null;
          for (let i = line.log.length - 1; i >= 0; i--) {
            const e = line.log[i]!;
            if (!answer && (e.kind === 'reply' || e.kind === 'refused')) answer = e;
            if (e.kind === 'sent') {
              sent = e;
              break;
            }
          }
          if (sent) {
            const ans = answer && answer.n === sent.n ? answer : null;
            const k = ans ? ans.kind : 'sent';
            if (sent.n !== shownN || k !== shownKind) {
              shownN = sent.n;
              shownKind = k;
              const words = sent.text !== '' ? sent.text : (ATTRACT_TEXT[(sent.content ?? '').replace(/^attract\.text\./, '')]?.text ?? '');
              draw(words, ans ? renderReply(ans.reply) : null);
            }
          }
        }

        // the ring, the hover, a misfire's twitch
        const hovGoal = frame.hovered === 'phone' && !w.bracketed ? 1 : 0;
        hover = reduced ? hovGoal : damp(hover, hovGoal, 14, Math.min(frame.dt, 0.1));
        let tilt = hover * F.hover;
        const a = t - ringAt;
        if (a >= 0 && a < F.ringFor && !reduced) {
          const env = (1 - a / F.ringFor) ** 2;
          tilt += F.kick * Math.sin(Math.min(1, a / 0.12) * Math.PI) * (1 - a / F.ringFor) + F.ring * env * Math.sin(a * Math.PI * 2 * F.ringHz);
        }
        if (line?.misfire && line.misfire.since < 0.5 && !reduced) {
          const s = line.misfire.since;
          tilt += F.twitch * line.misfire.level * Math.sin(s * 30) * Math.exp(-s * 8);
        }
        if (tilt !== lastTilt) {
          posePhone(obj, { tilt });
          lastTilt = tilt;
        }
      },
      dispose() {
        if (current?.phone === obj) current = null;
        bus.phone = null;
        root.removeFromParent();
      },
    };
  };
}
