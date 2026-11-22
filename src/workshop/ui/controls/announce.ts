/**
 * What happened, said aloud (P3 B2; REWRITE.md § E9: "What happens is
 * announced in a polite live region in short sentences"). The world's
 * events in, short sentences out; the sentences are content
 * (world.json `said`, each naming the event it speaks for). Pure: tested in
 * Node on the whole bench (tests/unit/ui/announce.test.ts).
 *
 * The rule: what the visitor did, and what came of it. Nothing before the
 * visitor's first action (attract mode is the crew's), nothing of the crew's
 * own business, no tells: a screen-reader user who has done nothing hears
 * nothing. A part's consequences (on the belt, struck, shipped) are told only
 * for a part the visitor has touched (`WorldView.touched`, § E5 rule 5): a
 * crate Fetch carries on its rounds is the crew's.
 *
 * One sentence per thing that happened, not per step of it: a Button rung is
 * its press (and what that rung does), then Revert's card; an undo is one
 * sentence however many fields it put back. The sentences of one frame are
 * said together.
 *
 * Not said here: what the phone panel says itself in its own live region (a
 * text sent, Patch on it, the reply, "Now on the …" while it is open), so
 * nothing is said twice. A change Patch makes for a text is his answer and
 * the phone's to say; a change the visitor makes with their own hand while a
 * text is in flight (the belt's dial or lever: the belt's change comes in the
 * same frame as the `handle.worked` that made it) is the visitor's, and is
 * said.
 *
 * A part let go (K2): what is said is what the world has decided, as soon as
 * it has decided it, and only once per letting go.
 *   - Let go fast: "thrown", at once (where it lands is the crew's business
 *     and the chute's).
 *   - Let go slowly: nothing until the world settles it, which it does in
 *     one step: the part comes to rest (`part.rested`), and in that same step
 *     a mouth under it has either taken it in (`taken-in`) or not. Taken in:
 *     where it went ("on the belt"); not: "put down". Never both, never one
 *     and later the other for the same letting go.
 *   - Taken in at the letting go itself (the keys' Enter over a mouth):
 *     where it went, in that frame.
 *   - Picked up again, gone off the bench's edge (the chute: "came back" is
 *     said when it does), or a reset before it rests: nothing for the drop.
 */
import type { Id, SimEvent, WorldView } from '../../sim/types.ts';
import { SAID, fill, textOf, type SaidKey } from './words.ts';
import { plainName } from './model.ts';

/** Tune here. */
export const ANNOUNCE_TUNING = {
  /** A part let go faster than this (units/s) was thrown; slower, put down. */
  thrown: 1.5,
  /** Steps a slow letting go is followed before it is forgotten unsaid (the world settles a part long before). */
  settle: 600,
} as const;

/** What the page knows that the events do not. */
export interface HearContext {
  /** What the keys hold now (input's `keyHold`), or null. */
  readonly keyHeld: Id | null;
  /** The phone panel is open (it speaks for the cord then). */
  readonly phoneOpen: boolean;
}

const MOUTH_SAID: Readonly<Record<string, SaidKey>> = { belt: 'onBelt', dock: 'atDock', platen: 'onPlaten' };
const RUNG_SAID: Readonly<Record<number, SaidKey>> = { 1: 'rung1', 2: 'rung2', 3: 'rung3', 4: 'rung4' };

export class Announcer {
  /** Texts in flight on the phone (n): their effects are Patch's answer, which the phone panel says. */
  private texts = new Set<number>();
  /** Parts let go slowly, not yet settled by the world (the step each was let go). */
  private pending = new Map<Id, number>();

  /** The sentences for one frame's events (none, most frames). */
  hear(w: WorldView, events: readonly SimEvent[], ctx: HearContext): string[] {
    const out: string[] = [];
    const say = (key: SaidKey, slots: Record<string, string | number> = {}): void => {
      const s = fill(SAID[key], slots);
      if (!out.includes(s)) out.push(s);
    };
    const name = (id: Id): string => plainName(w, id);
    // texts in flight are tracked from the start: their effects are never mistaken for the visitor's handle
    for (const e of events) {
      if (e.type === 'line.sent') this.texts.add(e.n);
      else if (e.type === 'line.reply' || e.type === 'line.refused') this.texts.delete(e.n);
    }
    if (!w.playMode) {
      this.pending.clear();
      return out;
    }
    const takenIn = new Set(events.flatMap((e) => (e.type === 'taken-in' ? [e.part] : [])));
    // the visitor's own hand on a handle this frame (the dial, the lever): what changed with it is theirs, text or no
    // text (a handle commits in the step it is worked; Patch's answer to a text commits in steps of its own)
    const worked = events.some((e) => e.type === 'handle.worked');
    let belt: { speed: boolean; run: boolean } | null = null;
    let lamp = false;
    for (const e of events) {
      switch (e.type) {
        case 'part.grabbed':
          this.pending.delete(e.id);
          say(ctx.keyHeld === e.id ? 'pickedKeys' : 'picked', { thing: name(e.id) });
          break;
        case 'cord.unplugged':
          if (!e.by && ctx.keyHeld === e.cord) say('pickedKeys', { thing: name(e.cord) });
          break;
        case 'part.released':
          if (takenIn.has(e.id)) break;
          if (e.speed > ANNOUNCE_TUNING.thrown) say('thrown', { thing: name(e.id) });
          else this.pending.set(e.id, w.step);
          break;
        case 'part.rested':
          // settled: in a mouth (`taken-in`, this same step) or where it lies
          if (!this.pending.delete(e.id)) break;
          if (!takenIn.has(e.id)) say('putDown', { thing: name(e.id) });
          break;
        case 'taken-in': {
          if (!w.touched(e.part)) break;
          this.pending.delete(e.part);
          const key = MOUTH_SAID[e.mouth];
          if (key) say(key, { thing: name(e.part) });
          break;
        }
        case 'part.returned':
          if (w.touched(e.id)) say('returned', { thing: name(e.id) });
          break;
        case 'struck':
          if (e.part !== null && w.touched(e.part)) say('struck', { thing: name(e.part) });
          break;
        case 'shipped':
          if (w.touched(e.part)) say('shipped', { thing: name(e.part) });
          break;
        case 'button.pressed':
          say(w.reducedMotion ? 'rungStill' : (RUNG_SAID[Math.min(4, Math.max(1, e.rung))] ?? 'rung1'));
          break;
        case 'card': {
          const text = textOf(e.content);
          if (!text) break;
          if (w.interactable(e.by)) say(e.content.startsWith('slip.') ? 'slip' : 'card', { name: name(e.by), text });
          break;
        }
        case 'cord.plugged': {
          if (e.by || ctx.phoneOpen) break;
          const answered = events.find((x): x is Extract<SimEvent, { type: 'jack.answered' }> => x.type === 'jack.answered' && x.jack === e.jack);
          if (answered) say('plugged', { jack: name(e.jack), station: name(answered.station) });
          else say('pluggedNone', { jack: name(e.jack) });
          break;
        }
        case 'handle.worked': {
          const it = w.interactable(e.id);
          if (it?.name === 'name.dock.bell') say('bell');
          else if (e.id === w.button().coverId) {
            const c = w.button().cover;
            if (c === 'open') say('coverOpen');
            else if (c === 'shut') say('coverShut');
          }
          break;
        }
        case 'effect': {
          const f = e.effect;
          // the visitor's own change (a transaction), not one Patch makes for a text (the phone says those)
          if (typeof f.cause !== 'string' || !f.cause.startsWith('t')) break;
          const kind = w.machine(f.target)?.kind;
          if (this.texts.size > 0 && !(kind === 'belt' && worked)) break;
          if (kind === 'belt') {
            belt ??= { speed: false, run: false };
            if (f.field === 'speed') belt.speed = true;
            else if (f.field === 'direction' || f.field === 'running') belt.run = true;
          } else if (kind === 'lamp' && (f.field === 'x' || f.field === 'z')) lamp = true;
          break;
        }
        case 'undone': {
          if (e.by !== 'lever') break;
          const targets = [...new Set(e.restores.map((r) => r.target))];
          if (targets.length === 1) say('undone', { thing: name(targets[0]!) });
          else if (targets.length > 1) say('undoneMany', { count: targets.length });
          break;
        }
        // (P4 S5) a project crate opened or shut: by the visitor's press, or clapped shut as it was picked up, taken or knocked
        case 'crate.opened':
          say('opened', { thing: name(e.crate) });
          break;
        case 'crate.shut':
          if (e.why === 'press' || w.touched(e.crate)) say('shutBy', { thing: name(e.crate) });
          break;
        // (P4 D1) the ledger board: dealt (and every deal has its bounced payment), repaired, or nothing to repair
        case 'ledger.dealt':
          say('ledgerDealt');
          say('ledgerBounced');
          break;
        case 'ledger.repaired':
          say('ledgerRepaired');
          break;
        case 'ledger.refused':
          say('ledgerNothing');
          break;
        // (P4 D3) the report press: what it printed, and whether the envelope went; the envelope home again
        case 'press.printed':
          if (e.marks === 0) say('pressPrintedNone');
          else if (e.marks === 1) say('pressPrintedOne');
          else say('pressPrinted', { count: e.marks });
          if (!e.envelope) say('pressStillOut');
          break;
        case 'press.home':
          say('pressHome');
          break;
        case 'reset':
          this.pending.clear();
          say('reset');
          break;
        default:
          break;
      }
    }
    if (belt) {
      // the belt as it is after the change (one sentence for the dial, one for the lever)
      for (const it of w.interactables()) {
        const v = w.machine(it.id);
        if (v?.kind !== 'belt') continue;
        if (belt.speed) say('speed', { level: v.speed, levels: v.detents });
        if (belt.run) say(!v.running ? 'stopped' : v.direction === 'forward' ? 'forward' : 'backward');
        break;
      }
    }
    if (lamp) say('lamp');
    // a part let go that left the bench (the chute brings it back, and says so), or was never settled: forgotten
    for (const [id, at] of this.pending) {
      const mode = w.motion(id)?.mode;
      if (mode === 'chute' || mode === 'gone' || w.step - at > ANNOUNCE_TUNING.settle) this.pending.delete(id);
    }
    return out;
  }
}
