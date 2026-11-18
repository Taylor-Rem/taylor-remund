/**
 * The storefront, repainted by text (W2 part 3; REWRITE.md § B2 X1 the
 * STOREFRONT row, § F3 "a text changes the storefront and a reply comes
 * back").
 *
 * Each change the simulation lists (`StorefrontView.beats`) is performed
 * with the piece's own function (kit/pieces/storefront/perform.ts), from its
 * `from` to its `to` over the beat's length: forwards for a change; for an
 * undo the same motion run backwards and quicker (the paint wiped back the
 * way it came, the slats turned back, the drum rolled back); a reset is a
 * quick tidy. New words are painted on the face turned away
 * (`setFasciaWords`) before the slats turn. Outside a beat the shop shows
 * its durable settings (snapped once, when they differ: a restored visit).
 *
 * The station lamp: dark idle, steady while Patch works its line, a slow
 * blink as a tell; when the plug seats in its jack it winks (`answered`).
 * Its misfire: the awning gives a jolt and the card a flick.
 */
import { Group, Matrix4, type Object3D } from 'three';
import type { StationBeat, StorefrontView } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Token } from '../kit/types.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import { splitStatic, type StaticPool } from './set.ts';
import {
  awningColour, fasciaColour, fasciaWordsTurn, hiddenFace, openClosed, paintAwning, paintFascia, pictureIndex, pictureRoll,
  poseStorefront, setFasciaWords, storefrontContent, storefrontLabels, type StorefrontLabelRefs, type WindowPicture,
} from '../kit/pieces/storefront/index.ts';
import { patchlampBus } from './patchlamp-bus.ts';

/** Tune here: seconds. Each beat's length forwards (an undo runs `undoSpeed` times quicker, a reset `resetSpeed`). */
export const STOREFRONT_FEEL = {
  sign: 1.5,
  words: 1.7,
  awning: 2.3,
  open: 1.3,
  picture: 1.6,
  undoSpeed: 1.6,
  resetSpeed: 3,
  /** The lamp's wink when the plug seats in its jack, and its tell's blink period. */
  wink: 0.5,
  blink: 1.2,
  /** A misfire's jolt of the awning (fraction of its travel). */
  jolt: 0.12,
};

export interface StorefrontViewOptions {
  entry: Entry | undefined;
  at: Matrix4;
  seed: number;
  pool?: StaticPool;
  key: object;
}

type Field = 'sign' | 'words' | 'awning' | 'open' | 'picture';

export function createStorefrontView(o: StorefrontViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = STOREFRONT_FEEL;
    const root = new Group();
    root.name = 'storefront';
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => root.removeFromParent() };
    const refs: StorefrontLabelRefs = storefrontLabels(ctx.labels);
    const whole = buildEntry(o.entry, null, { seed: o.seed }, ctx.labels);
    const moving = (n: string): boolean => /^sign\.slat|^awning|^opensign$|^window\.|^picture\.drum$|^lamp\./.test(n);
    const live = o.pool ? splitStatic(whole, o.at, moving, o.pool) : whole;
    const obj: Object3D = ctx.realize(live);
    obj.applyMatrix4(o.at);
    root.add(obj);
    patchlampBus(o.key).stations.storefront = obj;

    // what the shop shows now (view state; the durable values are the simulation's)
    const shown = { sign: 'paint-green' as Token, awning: 'cable-red' as Token, open: true, picture: 'mountains' as WindowPicture, words: '' };
    let turns = 0; // the fascia's half turns: even shows face A
    let first = true;
    /** The beat being performed per field: its identity, so a new one is noticed. */
    const playing: Partial<Record<Field, { key: string; done: boolean }>> = {};
    let lampShown = -1;
    const busy = new Set<string>();
    const wordsOf = (w: string): string => (w === '' ? storefrontContent.fascia : w);

    const lengthOf = (b: StationBeat): number => {
      const base = F[b.field as Field] ?? 1.5;
      return b.how === 'change' ? base : base / (b.how === 'undo' ? F.undoSpeed : F.resetSpeed);
    };

    function snap(v: StorefrontView): void {
      if (shown.sign !== v.sign) paintFascia(obj, (shown.sign = v.sign as Token));
      if (shown.awning !== v.awning) paintAwning(obj, (shown.awning = v.awning as Token));
      if (shown.open !== v.open || first) poseStorefront(obj, { open: (shown.open = v.open) ? 1 : 0, lights: v.open ? 1 : 0 });
      if (shown.picture !== v.picture || first) poseStorefront(obj, { picture: pictureIndex((shown.picture = v.picture)) });
      if (wordsOf(shown.words) !== wordsOf(v.words)) {
        // painted on the face showing (no turn: nothing is being performed)
        setFasciaWords(ctx.labels, refs, turns % 2 === 0 ? 'A' : 'B', wordsOf(v.words));
        shown.words = v.words;
      }
    }

    function perform(b: StationBeat, reduced: boolean): void {
      const field = b.field as Field;
      const key = `${b.how}|${String(b.from)}|${String(b.to)}`;
      const p = playing[field];
      const fresh = !p || p.key !== key || (p.done && b.since < 0.1);
      if (fresh) {
        playing[field] = { key, done: false };
        if (field === 'words') {
          // the new words on the face turned away, before the slats turn (an undo turns back to the face that still has them)
          const back = b.how !== 'change';
          const face = back ? (Math.abs(turns) % 2 === 0 ? 'B' : 'A') : hiddenFace(turns);
          setFasciaWords(ctx.labels, refs, face, wordsOf(String(b.to)));
        }
      }
      const cur = playing[field]!;
      if (cur.done) return;
      const len = lengthOf(b);
      const t = reduced ? 1 : Math.min(1, b.since / len);
      const fwd = b.how === 'change';
      switch (field) {
        case 'sign':
          if (fwd) fasciaColour(obj, b.from as Token, b.to as Token, t);
          else fasciaColour(obj, b.to as Token, b.from as Token, 1 - t);
          if (t >= 1) shown.sign = b.to as Token;
          break;
        case 'awning':
          if (fwd) awningColour(obj, b.from as Token, b.to as Token, t);
          else awningColour(obj, b.to as Token, b.from as Token, 1 - t);
          if (t >= 1) shown.awning = b.to as Token;
          break;
        case 'open':
          if (fwd) openClosed(obj, b.from as boolean, b.to as boolean, t);
          else openClosed(obj, b.to as boolean, b.from as boolean, 1 - t);
          if (t >= 1) shown.open = b.to as boolean;
          break;
        case 'picture': {
          const a = pictureIndex(b.from as WindowPicture), z = pictureIndex(b.to as WindowPicture);
          if (fwd) pictureRoll(obj, a, z, t);
          else pictureRoll(obj, z, a, 1 - t);
          if (t >= 1) {
            shown.picture = b.to as WindowPicture;
            poseStorefront(obj, { picture: z });
          }
          break;
        }
        case 'words':
          if (fwd) fasciaWordsTurn(obj, turns, t);
          else fasciaWordsTurn(obj, turns - 1, 1 - t);
          if (t >= 1) {
            turns += fwd ? 1 : -1;
            shown.words = String(b.to);
          }
          break;
      }
      if (t >= 1) cur.done = true;
    }

    return {
      root,
      update(frame: Frame) {
        const mv = frame.world.machine('storefront');
        if (!mv || mv.kind !== 'storefront') return;
        const v = mv as StorefrontView;
        const reduced = frame.world.reducedMotion || ctx.reducedMotion;
        const t = frame.time;
        busy.clear();
        for (const b of v.beats) {
          perform(b, reduced);
          if (!playing[b.field as Field]?.done) busy.add(b.field);
        }
        // outside a beat the shop shows the durable settings
        if (busy.size === 0) snap(v);
        first = false;

        // the station lamp; a wink as the plug seats in its jack; a misfire jolts the awning
        let lamp = v.lamp === 'steady' ? 1 : v.lamp === 'blink' ? ((t / F.blink) % 1 < 0.5 ? 1 : 0) : 0;
        if (v.answered < F.wink) lamp = reduced ? 1 : (v.answered / F.wink) * 3 % 1 < 0.6 ? 1 : 0;
        if (lamp !== lampShown) {
          poseStorefront(obj, { lamp });
          lampShown = lamp;
        }
        if (v.misfire && v.misfire.since < 0.8 && !busy.has('awning') && !reduced) {
          const s = v.misfire.since;
          const j = F.jolt * v.misfire.level * Math.sin(s * 22) * Math.exp(-s * 5);
          poseStorefront(obj, { awning: 1 - Math.abs(j) });
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}
