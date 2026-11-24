/**
 * What to play, from what happened (REWRITE.md § E2: `audio` makes sound for simulation events and
 * never decides when things happen). Each frame the score reads the step's events and a few view
 * states the simulation publishes (the belt's surface, the UNDO lever's phase, Revert's crank, Fetch's
 * wheels) and answers with cues: which sound, how loud, where on the bench. It has no Web Audio in it,
 * so the whole mapping runs headless against the real simulation (tests/scenario/audio-score.test.ts).
 *
 * It reads the world and never writes it. Its only state is its own memory of the last frame (a
 * lever's phase, a crank's angle) and of what it played a moment ago (so a pile-up of contacts does
 * not become a roar).
 */
import { HZ, TIER, rubberOf } from '../sim/index.ts';
import type { Id, PatchView, SimEvent, Vec3, WorldView } from '../sim/index.ts';
import { soundDef } from './voices.ts';

/** One sound to start now. */
export interface Cue {
  readonly id: string;
  /** Linear gain on top of the sound's own level (1 = as designed). */
  readonly gain: number;
  /** -1 (left) .. 1 (right). */
  readonly pan: number;
  /** Playback rate (1 = as rendered; only for unpitched sounds, never a note). */
  readonly rate?: number;
  /** The sound's parameter (its length, seconds), where it has one. */
  readonly param?: number;
  /** A low-pass on this voice (Hz): a soft landing is duller than a hard one. */
  readonly lowpass?: number;
}

/** A looped sound's settings this frame. */
export interface LoopCue {
  readonly id: 'loop.hum' | 'loop.treads' | 'loop.wheel' | 'loop.jet';
  readonly gain: number;
  readonly rate: number;
  readonly pan: number;
}

export interface Heard {
  readonly cues: readonly Cue[];
  readonly loops: readonly LoopCue[];
}

export const SCORE_TUNING = {
  /** How wide the stereo picture is: a part at the bench's end is panned this far. */
  panWidth: 0.4,
  /**
   * A landing's speed (units/s, the part's own speed in the frame before the contact) that is barely
   * heard, and one that is a full knock (a fall from 2.5 units lands at about 9). The world's impulse
   * (`strength`) hardly grows with the height of a fall, so it only gates: below `hitSoft` nothing.
   */
  speedSoft: 0.4,
  speedHard: 9,
  hitSoft: 0.04,
  /** A contact is at most this much quieter than a full knock (dB). */
  hitRange: 22,
  /** The same part does not knock twice within this long (s): resting jitter is not a drum roll. */
  hitGap: 0.08,
  /**
   * Patch with a body of its own (the 2026-11-20 prototype): after its first touchdown (its thud) each further bounce
   * on the bench or a fixed thing is a pat, this much of a knock's loudness for its speed, and none below `patchPatMin`.
   */
  patchPat: 0.6,
  patchPatMin: 0.08,
  /** (R4) A contact's speed is the fastest the part went over this long before it (s). */
  speedWindow: 0.1,
  /** (R4) A throw is heard (a whoosh) from this release speed (units/s): below it a let-go is a set-down. */
  throwMin: 4,
  /** (R4) The whoosh against the landing it leads to: at most this fraction of that landing's gain. */
  whoosh: 0.55,
  /**
   * (R1) A crate thrown out of the chute lands on the pad: its own note, as a knock this loud, once; the
   * physics' own contacts for it are not heard for this long after (it is handed to physics still, a hair up).
   */
  padLanding: { gain: 0.6, quiet: 0.35 },
  /** (R1) A crew member's yelp when lifted is not heard again within this long (s). */
  yelpGap: 2,
  /** (S5 jet) The landing after the cut, in Fetch's own note: the touchdown and the bounce's. */
  jetLanding: { gain: 0.42, bounce: 0.2, near: 0.012 },
  /** The same sound starts at most once in this long (s), unless it is a note. */
  sameGap: 0.03,
  /** (I1 R1) The bell rung by hand: its gain (a shipment's is 1), how much quieter each ring on the last one's heels, the window (s), the most at once. */
  handBell: { gain: 0.72, fall: 0.8, window: 2.2, voices: 3 },
  /** The belt's middle speed (units/s): the hum's rate is 1 there. */
  beltNominal: 1.5,
  /** Revert's crank clicks once per this much turn (rad): an eighth of a turn. */
  ratchetStep: Math.PI / 4,
  /** Revert's top trundle speed and Fetch's (units/s), for their loops' rate. */
  revertSpeed: 1.4,
  fetchSpeed: 3.25,
  /** An undo's rewind: this long, plus this much for each field put back, at most this long (s). */
  rewind: { base: 0.35, per: 0.12, max: 1.4 },
  /** "Reset the workshop" rewinds for this long. */
  resetRewind: 1.6,
} as const;

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** The gain of a landing at `speed` (units/s): log-scaled from barely there to a full knock. */
export function hitGain(speed: number): number {
  const T = SCORE_TUNING;
  if (speed <= 0) return 0;
  const k = clamp(Math.log(speed / T.speedSoft) / Math.log(T.speedHard / T.speedSoft), 0, 1);
  return Math.pow(10, (-T.hitRange * (1 - k)) / 20);
}

export class Score {
  private lastPlayed = new Map<string, number>();
  private lastHit = new Map<Id, number>();
  /** (R1) Parts whose physics contacts are not heard until this time: a crate just set on the pad. */
  private quietUntil = new Map<Id, number>();
  /** (R1) Parts the chute has just thrown out (its flap kick is then the launch's, not a return's hollow thump). */
  private launched = new Map<Id, number>();
  /** (R1) When each crew member last yelped. */
  private yelped = new Map<Id, number>();
  /** (S5 jet) The jets are burning (from `jet.ignited` to `jet.cut`): the hiss sounds. */
  private jetOn = false;
  /** (R4) Revert's knocks heard in this knocking, and its leaves last frame. */
  private knocks = 0;
  private lastHatch = 0;
  /** (R4) Patch stuck to a wall: its height last frame (null until seen), until it starts down. */
  private patchWall: { y: number | null } | null = null;
  /** Patch's own body, when it has one (the prototype's `PatchView.body`; remembered while the script has Patch), and whether this throw has come down yet. */
  private patchBodyId: Id | null = null;
  private patchDown = false;
  /** (S5 jet) After the cut: where it lands, and whether the touchdown has been heard. */
  private jetDown: { y: number; touched: boolean } | null = null;
  /**
   * (R4) Each moving part's recent speeds (units/s, sim time): a contact is heard at the fastest of the last
   * `SCORE_TUNING.speedWindow` seconds, because by the step a contact is reported the solver has often already
   * slowed the body (a fast crate reached the bench between two samples and sounded softer than a set-down).
   */
  private speeds = new Map<Id, { t: number; v: number }[]>();
  private leverPhase: string | null = null;
  private crank: number | null = null;
  private crankAcc = 0;
  private belt: Id | null | undefined = undefined;
  private lever: Id | null | undefined = undefined;
  private revert: Id | null | undefined = undefined;
  private fetch: Id | null | undefined = undefined;
  private cues: Cue[] = [];
  private readonly bells = new Set<Id>();
  private bellRings: number[] = [];

  /** Read one frame: its events (in order) and the world as it stands after them. */
  hear(world: WorldView, events: readonly SimEvent[]): Heard {
    this.cues = [];
    this.find(world);
    const now = world.time;
    // (R1) a crate set on the pad this frame: its physics contacts are quiet whatever their order in the step
    for (const e of events) if (e.type === 'restocked' && e.on === 'pad') this.quietUntil.set(e.part, now + SCORE_TUNING.padLanding.quiet);
    for (const e of events) this.event(world, e, now);
    this.states(world, now);
    this.track(world, now);
    return { cues: this.cues, loops: this.loops(world) };
  }

  // ───────────────────────── one-shots, from events ─────────────────────────

  private play(id: string, now: number, o: Partial<Omit<Cue, 'id'>> = {}, at?: Vec3 | null): void {
    const note = id.startsWith('note.') || id.startsWith('hit.') || id.startsWith('pick.');
    const last = this.lastPlayed.get(id);
    if (!note && last !== undefined && now - last < SCORE_TUNING.sameGap && now >= last) return;
    this.lastPlayed.set(id, now);
    soundDef(id); // an unknown id is a bug here, not a silent miss in the browser
    this.cues.push({ id, gain: o.gain ?? 1, pan: o.pan ?? this.panOf(at ?? null), ...(o.rate !== undefined ? { rate: o.rate } : {}), ...(o.param !== undefined ? { param: o.param } : {}), ...(o.lowpass !== undefined ? { lowpass: o.lowpass } : {}) });
  }

  /** Patch's own body part (null until its view has named it: the first time it is taken hold of). */
  private patchBody(w: WorldView): Id | null {
    const c = w.crewView('patch');
    const b = c && c.kind === 'patch' ? (c.view as PatchView).body : undefined;
    if (b) this.patchBodyId = b.id;
    return this.patchBodyId;
  }

  private event(w: WorldView, e: SimEvent, now: number): void {
    const T = SCORE_TUNING;
    switch (e.type) {
      case 'part.released': {
        // (R4) a throw: the whoosh it leaves through, never louder than the landing it leads to; below `throwMin` silence
        this.note(e.id, now, e.speed);
        // (Patch's own body let go: its throw's sounds are `patch.throw`'s, not a paper crate's whoosh as well)
        if (e.id === this.patchBody(w)) return;
        if (e.speed < T.throwMin) return;
        this.whoosh(now, e.speed, this.posOf(w, e.id));
        // Fetch is the thing thrown: its yelp (its own two seconds, apart from the lift's)
        if (e.id === this.fetch) this.yelp(w, e.id, 'fetch.yelp', now, `${e.id}#throw`);
        return;
      }
      case 'patch.throw': {
        // (R4) Patch thrown: a stuffed raccoon, never hurt
        const at = this.posOf(w, 'patch');
        switch (e.phase) {
          case 'thrown':
            this.patchDown = false;
            this.play('patch.fly', now, { param: clamp(0.15 + 0.035 * e.speed, 0.15, 0.55) }, at);
            if (e.speed >= T.throwMin) this.whoosh(now, e.speed, at);
            return;
          case 'landed':
            this.patchDown = true;
            return this.play('patch.thud', now, { gain: Math.max(0.3, hitGain(e.speed)) }, at);
          case 'hit':
            this.patchDown = true;
            if (e.wall) {
              this.patchWall = { y: null };
              return this.play('patch.pat', now, { gain: Math.max(0.5, hitGain(e.speed)) }, at);
            }
            return this.play('patch.bump', now, { gain: Math.max(0.4, hitGain(e.speed)) }, at);
          case 'gone':
            return this.play('patch.fall', now, {}, at);
          case 'chute':
            this.patchDown = false;
            this.play('chute.launch', now, {}, at);
            return this.play('patch.rise', now, {}, at);
        }
        return;
      }
      case 'part.grabbed': {
        const p = w.part(e.id);
        if (p) this.play(`pick.${p.material}.${p.size}`, now, {}, this.posOf(w, e.id));
        return;
      }
      case 'part.hit': {
        const p = w.part(e.id);
        if (!p || e.strength < T.hitSoft) return;
        // Patch's own body: its contacts are `patch.throw`'s to sound (a thud, a bump, a pat on a wall), never a paper
        // crate's knock as well. What is added here is only what the script never had: after its first touchdown it
        // tumbles on, and each further bounce on something fixed is a soft pat
        const pb = this.patchBody(w);
        if (pb !== null && (e.id === pb || e.other === pb)) {
          if (e.id !== pb || e.other !== null || !this.patchDown) return;
          const g = hitGain(this.peak(pb, now)) * T.patchPat;
          const last = this.lastHit.get(pb);
          if (g < T.patchPatMin || (last !== undefined && now - last < T.hitGap * 2 && now >= last)) return;
          this.lastHit.set(pb, now);
          this.play('patch.pat', now, { gain: g }, this.posOf(w, pb));
          return;
        }
        // the faster of the two, as it was coming in (a crate dropped on a resting one: the dropped one's speed)
        const g = hitGain(Math.max(this.peak(e.id, now), e.other ? this.peak(e.other, now) : 0));
        if (g <= 0) return;
        const last = this.lastHit.get(e.id);
        if (last !== undefined && now - last < T.hitGap && now >= last) return;
        const quiet = this.quietUntil.get(e.id);
        if (quiet !== undefined && now < quiet && now >= quiet - T.padLanding.quiet) return;
        this.lastHit.set(e.id, now);
        const k = Math.log10(g * 10 + 1e-9); // ~0 soft .. 1 hard
        this.play(`hit.${p.material}.${p.size}`, now, { gain: g, lowpass: 1800 + 10000 * clamp(k, 0, 1) }, this.posOf(w, e.id));
        return;
      }
      case 'struck': {
        const at = e.part ? this.posOf(w, e.part) : this.posOf(w, e.id);
        if (e.part && e.size && e.material) {
          this.play(`note.${e.material}.${e.size}`, now, {}, at);
          this.play('striker.felt', now, {}, at);
        } else this.play('striker.air', now, {}, at);
        return;
      }
      case 'handle.worked': {
        if (this.bells.has(e.id)) return this.ringByHand(w, e.id, now);
        const at = this.posOf(w, e.id);
        if (e.id === w.undoId || e.id === this.lever) return this.play('undo.latch', now, {}, at);
        const b = w.button();
        if (e.id === b.id) return; // `button.pressed` follows: the clunk
        if (e.id === b.coverId) return this.play('cover.snap', now, {}, this.posOf(w, b.id));
        if (w.machine(e.id)?.kind === 'lamp') return this.play('lamp.creak', now, {}, at);
        const it = w.interactable(e.id);
        if (it?.affordances.includes('turn')) return this.play('handle.dial', now, { rate: 0.94 + 0.12 * clamp(e.value ?? 0.5, 0, 1) }, at);
        return this.play('handle.lever', now, {}, at);
      }
      case 'button.pressed':
        return this.play('button.clunk', now, {}, this.posOf(w, w.button().id));
      // P4 D1: the ledger board's beats. A payment dealt into a cup clinks in its tier's note (the deal runs in tier
      // order, so it rises: brass low, copper, steel high); the rubber one thuds; the gate clicks; the repair ends
      // with a bell (§ B1: verb done); the flag snapping up twangs; a refusal is a dry tick.
      case 'ledger.beat': {
        const at = this.posOf(w, e.board);
        const rubber = e.token !== null && w.machine(e.id)?.kind === 'ledger' && rubberIndex(w, e.id) === e.token;
        switch (e.beat) {
          case 'drop':
            return this.play(rubber ? 'hit.rubber.S' : `hit.metal.${(['L', 'M', 'S'] as const)[TIER[e.token ?? 0] ?? 0]}`, now, { gain: 0.55, lowpass: 9000 }, at);
          case 'bounce':
            return this.play('hit.rubber.M', now, { gain: 0.8 }, at);
          case 'wipe':
          case 'gather':
            return this.play('pick.metal.S', now, { gain: 0.4 }, at);
          case 'gate':
            return this.play('handle.lever', now, { gain: 0.5 }, at);
          case 'star':
            // up: the flag's spring twangs (a high ring); pressed down at the end of a repair: the bell (§ B1: verb done)
            if (e.on === true) return this.play('note.metal.S', now, { gain: 0.45 }, at);
            return e.show === 'repair' ? this.play('dock.bell', now, { gain: 0.55 }, at) : undefined;
          default:
            return;
        }
      }
      // P4 D3: the report press's beats, each its own sound from the existing notes: the thunk of the lever coming
      // down, four ratchet clicks as the printed sheet comes up, the paper slip of the gridded sheet flipping over and
      // of each fold, the whoosh and snap of the arm's flick (a dry puff for the shrug of an empty bed), the drawer's
      // slide, the copy's slip into it and the latch of it shutting. The bell is the dock's, later, when the envelope ships.
      case 'press.beat': {
        const at = this.posOf(w, e.body);
        switch (e.beat) {
          case 'thunk':
            return this.play('undo.thunk', now, { gain: 0.75 }, at);
          case 'ratchet':
            return this.play('revert.ratchet', now, { gain: 0.45, rate: 1.05 + 0.04 * e.n }, at);
          case 'flip':
            return this.play('card.slip', now, { gain: 0.6 }, at);
          case 'fold':
            return this.play('card.slip', now, { gain: 0.32, rate: 1.15 + 0.08 * e.n }, at);
          case 'wind':
            return this.play('revert.ratchet', now, { gain: 0.3, rate: 0.7 }, at);
          case 'flick':
            this.play('throw.whoosh', now, { gain: 0.45 }, at);
            return this.play('cover.snap', now, { gain: 0.35 }, at);
          case 'shrug':
            return this.play('striker.air', now, { gain: 0.45 }, at);
          case 'drawer':
            return this.play('handle.dial', now, { gain: 0.4, rate: 0.85 }, at);
          case 'copy':
            return this.play('card.slip', now, { gain: 0.25, rate: 0.9 }, at);
          case 'click':
            return this.play('undo.latch', now, { gain: 0.55 }, at);
          default:
            return;
        }
      }
      case 'press.refused':
        // the lever gives and springs back: a dry puff, as the ledger's refusal
        return this.play('striker.air', now, { gain: 0.5, rate: 1.2 }, this.posOf(w, e.body));
      case 'ledger.refused':
        return this.play('striker.air', now, { gain: 0.6 }, this.posOf(w, e.board));
      // P4 D2b: the paint dial's wipe has crossed the room: the bell (§ B1: verb done). Its detents click as any dial's.
      case 'paint.wiped':
        return this.play('dock.bell', now, { gain: 0.5 }, this.posOf(w, e.dial));
      case 'cover':
        // fitted by Revert: the cover snaps shut (a visitor's lift and shut is the `handle.worked` above)
        if (e.state === 'shut' && this.lastPlayed.get('cover.snap') !== now) this.play('cover.snap', now, { gain: 0.8 }, this.posOf(w, w.button().id));
        return;
      case 'rung.beat': {
        const at = this.posOf(w, w.button().id);
        const lv = e.level === 2 ? 1 : 0.7;
        switch (e.beat) {
          case 'flinch':
            return this.play('rung.flinch', now, { gain: lv }, at);
          case 'hiccup':
            return this.play('rung.hiccup', now, { gain: lv }, e.ids[0] ? this.posOf(w, e.ids[0]) : at);
          case 'works':
            return this.play('rung.works', now, { gain: lv }, at);
          case 'sparks':
            return this.play('rung.sparks', now, { gain: lv }, at);
          case 'warning':
            return this.play('rung.warning', now, { param: e.duration }, at);
          case 'shake':
            return this.play('rung.shake', now, { gain: lv }, at);
          case 'rewind':
            return this.play('tape.rewind', now, { param: e.duration, pan: 0 });
          default:
            return; // dip, shove, stack, card, cover, revert: seen, or heard through their own events
        }
      }
      case 'shipped':
        return this.play('dock.bell', now, {}, this.posOf(w, e.id));
      case 'returned':
        if (e.how === 'door') this.play('dock.beep', now, {}, this.posOf(w, e.id));
        return;
      case 'door':
        return this.play(e.open ? 'dock.open' : 'dock.close', now, {}, this.posOf(w, e.id));
      case 'restock.launched':
        // (R1) a fresh crate shot out of the chute: the pneumatic thump and whoosh (the flap's kick follows as its own event)
        this.launched.set(e.part, now);
        return this.play('chute.launch', now, {}, e.from);
      case 'restocked': {
        if (e.on !== 'pad') return; // on the stack: physics' own contact is its knock
        // (R1) touchdown on the pad: one knock in the crate's own note, and its physics contacts quiet for a moment
        const p = w.part(e.part);
        if (!p) return;
        this.quietUntil.set(e.part, now + T.padLanding.quiet);
        this.lastHit.set(e.part, now);
        return this.play(`hit.${p.material}.${p.size}`, now, { gain: T.padLanding.gain, lowpass: 8000 }, this.posOf(w, e.part));
      }
      case 'flap': {
        const at = this.posOf(w, e.id);
        const t = e.part ? this.launched.get(e.part) : undefined;
        const launch = t !== undefined && now - t < 0.5 && now >= t;
        if (e.part && !launch) this.play('chute.thump', now, {}, at);
        return this.play('chute.flap', now, {}, at);
      }
      case 'undone':
        return this.play('tape.rewind', now, { param: Math.min(T.rewind.max, T.rewind.base + T.rewind.per * e.restores.length), pan: 0 });
      case 'jet.ignited':
        this.jetOn = true;
        this.jetDown = null;
        return this.play('jet.pop', now, {}, e.at);
      case 'jet.cut': {
        this.jetOn = false;
        const j = this.fetch ? w.crew(this.fetch)?.jet : null;
        this.jetDown = j ? { y: j.to[1], touched: false } : null;
        return this.play('jet.puff', now, {}, e.at);
      }
      case 'reset':
        this.jetOn = false;
        this.jetDown = null;
        return this.play('tape.rewind', now, { param: T.resetRewind, pan: 0 });
      case 'cord.unplugged':
        return this.play('plug.out', now, { gain: e.by ? 0.6 : 1 }, this.posOf(w, e.jack));
      case 'cord.plugged':
        return this.play('plug.seat', now, { gain: e.by ? 0.6 : 1 }, this.posOf(w, e.jack));
      case 'jack.answered':
        return this.play('relay.tick', now, {}, this.posOf(w, e.station));
      case 'line.sent':
        return this.play('phone.tick', now, {}, this.posOf(w, 'line'));
      case 'line.reply':
      case 'line.refused':
        return this.play('phone.buzz', now, {}, this.posOf(w, 'line'));
      case 'mailbox.flag':
        return this.play('mailbox.flag', now, {}, this.posOf(w, 'line'));
      case 'crew.knocked': {
        const g = e.strength === 3 ? 1 : e.strength === 2 ? 0.65 : 0.42;
        const r = e.strength === 3 ? 1 : e.strength === 2 ? 1.06 : 1.12; // a harder knock is a lower bonk
        return this.play('crew.bonk', now, { gain: g, rate: r }, this.posOf(w, e.id));
      }
      case 'crew.nudged':
        return this.play('crew.catch', now, { gain: 0.6 }, this.posOf(w, e.id));
      case 'patch.reacted':
        if (e.answer === 'bonk') this.play('patch.bonk', now, {}, this.posOf(w, 'patch'));
        else if (e.answer === 'catch') this.play('crew.catch', now, {}, this.posOf(w, 'patch'));
        return;
      case 'revert.sweep':
        return this.play('revert.sweep', now, {}, e.from.p);
      case 'crew.state': {
        if (e.id === this.revertBody(w) && e.state === 'rising') this.play('revert.hatch', now, {}, this.posOf(w, e.id));
        // (R4) Fetch let go (thrown, dropped): once at rest it rights itself and shakes: the servo's whirr
        if (e.id === this.fetch && e.state === 'shrug' && e.from === 'held') this.play('fetch.whirr', now, {}, this.posOf(w, e.id));
        // (R1) lifted into the visitor's hand: one yelp in its own voice, not again within two seconds
        if (e.state === 'held' && e.from !== 'held') {
          const voice = e.id === this.fetch ? 'fetch.yelp' : w.machine(e.id)?.kind === 'patch' ? 'patch.yelp' : null;
          const last = this.yelped.get(e.id);
          if (voice && (last === undefined || now - last >= T.yelpGap || now < last)) {
            this.yelped.set(e.id, now);
            this.play(voice, now, {}, this.posOf(w, e.id));
          }
        }
        return;
      }
      case 'rung.started': {
        // (R1) the press frightens Fetch: one startled chirp, if it is on the bench and not in a hand; nothing more with reduced motion
        if (w.reducedMotion || !this.fetch) return;
        const f = w.crew(this.fetch);
        const mode = w.mode(this.fetch);
        if (!f || f.state === 'held' || mode === 'held' || mode === 'gone' || mode === 'chute') return;
        return this.play('fetch.chirp', now, {}, [f.x, 0, f.z]);
      }
      case 'tell': {
        // T1: the second time round for a station its lid rattles (the view), with its sound; never with reduced motion
        const last = (w as Partial<Pick<WorldView, 'tells'>>).tells?.().last ?? null;
        const rattle = !w.reducedMotion && last !== null && last.id === e.id && last.times > 1;
        return this.play(rattle ? 'tell.rattle' : 'tell.tick', now, {}, this.posOf(w, e.id));
      }
      case 'misfire': {
        const kind = w.machine(e.id)?.kind;
        // the striker, the dock and the chute misfire through their own events (`struck`, `door`, `flap`)
        if (kind === 'striker' || kind === 'dock' || kind === 'chute') return;
        if (kind === 'belt') return this.play('rung.hiccup', now, { gain: e.level === 2 ? 0.6 : 0.4 }, this.posOf(w, e.id));
        return this.play('relay.tick', now, { gain: e.level === 2 ? 1 : 0.7 }, this.posOf(w, e.id));
      }
      case 'card':
        return this.play('card.slip', now, {}, this.posOf(w, e.by));
      default:
        return;
    }
  }

  // ───────────────────────── one-shots, from states ─────────────────────────

  private states(w: WorldView, now: number): void {
    // (R4) Revert knocking from under a covered hatch: a hollow knock at each jump of the leaves (two, then they open)
    if (this.revert) {
      const v = w.machine(this.revert);
      if (v?.kind === 'revert') {
        if (v.knock < 0) this.knocks = 0;
        else if (this.knocks < 2 && v.hatch > 1e-3 && this.lastHatch <= 1e-3) {
          this.knocks++;
          this.play('revert.knock', now, {}, [v.x, 0, v.z]);
        }
        this.lastHatch = v.hatch;
      }
    }
    // (R4) Patch stuck to a wall: the squeak when it starts down
    if (this.patchWall) {
      const pv = w.machine('patch');
      if (pv?.kind !== 'patch' || pv.state !== 'wall') this.patchWall = null;
      else {
        if (this.patchWall.y !== null && pv.at[1] < this.patchWall.y - 1e-4) {
          this.play('patch.slide', now, {}, pv.at);
          this.patchWall = null;
        } else this.patchWall.y = pv.at[1];
      }
    }
    // (S5 jet) the hiss never outlives the flight (caught in mid-air, put back by a rung); the landing after the cut
    if (this.fetch) {
      const T = SCORE_TUNING.jetLanding;
      const f = w.crew(this.fetch);
      const j = f?.jet ?? null;
      if (!j || f?.state !== 'jetpack') {
        this.jetOn = false;
        // done: the bounce comes down on its tape (only after a cut: a flight caught in a hand lands nowhere)
        if (this.jetDown && f?.state !== 'held') this.play(this.fetchNote(w), now, { gain: this.jetDown.touched ? T.bounce : T.gain, lowpass: 6000 }, f ? [f.x, 0, f.z] : null);
        this.jetDown = null;
      } else if (this.jetDown && !this.jetDown.touched) {
        const y = w.motion(this.fetch)?.pose.p[1];
        if (y !== undefined && y <= this.jetDown.y + T.near) {
          this.jetDown.touched = true;
          this.play(this.fetchNote(w), now, { gain: T.gain, lowpass: 8000 }, [f!.x, 0, f!.z]);
        }
      }
    }
    // the UNDO lever: the thunk at its stop and the clack home, from its own published phase
    if (this.lever) {
      const v = w.machine(this.lever);
      if (v?.kind === 'undo-lever') {
        const prev = this.leverPhase;
        if (prev === 'pull' && v.phase === 'hold') this.play('undo.thunk', now, {}, this.posOf(w, this.lever));
        if (prev === 'return' && v.phase === 'rest' && v.result !== null) this.play('undo.home', now, {}, this.posOf(w, this.lever));
        this.leverPhase = v.phase;
      }
    }
    // Revert's crank: a pawl click per eighth of a turn while it cranks
    if (this.revert) {
      const v = w.machine(this.revert);
      if (v?.kind === 'revert') {
        if (this.crank !== null && v.cranking) {
          this.crankAcc += Math.abs(v.crank - this.crank);
          let n = 0;
          while (this.crankAcc >= SCORE_TUNING.ratchetStep) {
            this.crankAcc -= SCORE_TUNING.ratchetStep;
            if (n++ < 2) this.cues.push({ id: 'revert.ratchet', gain: 1, pan: this.panOf([v.x, 0, v.z]) });
          }
        } else this.crankAcc = 0;
        this.crank = v.crank;
      }
    }
  }

  /** Each moving part's speed now, for the contacts of the next frame (units/s, from its last step). */
  private track(w: WorldView, now: number): void {
    const W = SCORE_TUNING.speedWindow;
    for (const p of w.parts()) {
      const m = w.motion(p.id);
      let list = this.speeds.get(p.id);
      if (list) {
        list = list.filter((x) => now - x.t <= W && now >= x.t);
        if (list.length === 0) this.speeds.delete(p.id);
        else this.speeds.set(p.id, list);
      }
      if (!m || !m.awake) continue;
      const a = m.prev.p;
      const b = m.pose.p;
      const v = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * HZ;
      if (v > 0.05) this.note(p.id, now, v);
    }
  }

  private note(id: Id, now: number, v: number): void {
    const list = this.speeds.get(id) ?? [];
    list.push({ t: now, v });
    this.speeds.set(id, list);
  }

  /** The fastest a part went over the last `speedWindow` seconds. */
  private peak(id: Id, now: number): number {
    let m = 0;
    for (const x of this.speeds.get(id) ?? []) if (now - x.t <= SCORE_TUNING.speedWindow && now >= x.t) m = Math.max(m, x.v);
    return m;
  }

  // ───────────────────────── loops ─────────────────────────

  private loops(w: WorldView): LoopCue[] {
    const T = SCORE_TUNING;
    const out: LoopCue[] = [];
    // the belt's hum: pitched by its speed, silent when it stops, never louder than a whisper (its level)
    const b = this.belt ? w.machine(this.belt) : undefined;
    if (b?.kind === 'belt' && this.belt) {
      const s = Math.abs(b.surface);
      out.push({ id: 'loop.hum', gain: clamp(s / 0.5, 0, 1) * (0.7 + 0.3 * clamp(s / 3, 0, 1)), rate: clamp(s / T.beltNominal, 0.3, 2.2), pan: this.panOf(this.posOf(w, this.belt)) });
    } else out.push({ id: 'loop.hum', gain: 0, rate: 1, pan: 0 });
    // Revert's treads
    const r = this.revert ? w.machine(this.revert) : undefined;
    if (r?.kind === 'revert' && r.drawn && r.lift > 0.5) {
      const s = Math.abs(r.speed) + 0.3 * Math.abs(r.turning);
      out.push({ id: 'loop.treads', gain: clamp(s / 0.4, 0, 1), rate: 0.6 + 0.6 * clamp(s / T.revertSpeed, 0, 1), pan: this.panOf([r.x, 0, r.z]) });
    } else out.push({ id: 'loop.treads', gain: 0, rate: 1, pan: 0 });
    // Fetch's wheel: by its speed; spinning free in the visitor's hand
    const f = this.fetch ? w.crew(this.fetch) : undefined;
    if (f && f.state !== 'jetpack') {
      const held = f.state === 'held';
      const s = held ? T.fetchSpeed * 0.6 : Math.abs(f.speed);
      out.push({ id: 'loop.wheel', gain: clamp(s / 0.5, 0, 1) * (held ? 0.6 : 1), rate: 0.7 + 0.6 * clamp(s / T.fetchSpeed, 0, 1), pan: this.panOf(held ? this.posOf(w, f.id) : [f.x, 0, f.z]) });
    } else out.push({ id: 'loop.wheel', gain: 0, rate: 1, pan: 0 });
    // (S5 jet) the jetpack's hiss: one voice from the ignition to the cut; louder and brighter with the thrust
    const thrust = this.jetOn && f?.jet ? clamp(f.jet.thrust, 0, 1) : 0;
    out.push({ id: 'loop.jet', gain: thrust > 0 ? 0.25 + 0.75 * Math.pow(thrust, 0.8) : 0, rate: 0.82 + 0.36 * thrust, pan: f ? this.panOf([f.x, 0, f.z]) : 0 });
    return out;
  }

  // ───────────────────────── where things are ─────────────────────────

  /** Find the units the score follows, once: by kind, never by a name typed here. */
  /**
   * (I1 R1) The bell rung by hand: the shipment's bell, a touch softer. Rung fast it stays pleasant: each ring
   * within the last one's length a little quieter, and never more than three sounding at once (a fourth is
   * the swing alone).
   */
  private ringByHand(w: WorldView, id: Id, now: number): void {
    const T = SCORE_TUNING.handBell;
    this.bellRings = this.bellRings.filter((t) => now - t < T.window && now >= t);
    if (this.bellRings.length >= T.voices) return;
    const gain = T.gain * Math.pow(T.fall, this.bellRings.length);
    this.bellRings.push(now);
    this.lastPlayed.delete('dock.bell'); // a hand may ring it on the heels of a shipment
    const dock = id.slice(0, -'-bell'.length);
    this.play('dock.bell', now, { gain }, this.posOf(w, dock));
  }

  private find(w: WorldView): void {
    if (this.belt !== undefined) return;
    this.bench = w.scene.bench;
    this.belt = null;
    this.revert = null;
    this.lever = w.undoId;
    for (const it of w.interactables()) {
      const k = w.machine(it.id)?.kind;
      if (k === 'belt' && !this.belt) this.belt = it.id;
      if (k === 'revert' && !this.revert) this.revert = it.id;
      if (k === 'undo-lever' && !this.lever) this.lever = it.id;
      // (I1 R1) a dock's hand bell: `<dock>-bell` (sim/machines/dock.ts `bellOf`)
      if (k === 'dock' && w.interactable(`${it.id}-bell`)) this.bells.add(`${it.id}-bell`);
    }
    const fetch = w.crewViews().find((c) => c.kind === 'fetch');
    this.fetch = fetch ? fetch.id : null;
    if (this.fetch && !w.crew(this.fetch)) this.fetch = null;
  }

  /** (R4) A throw's whoosh: length and pitch by speed, at a fraction of the landing it leads to. */
  private whoosh(now: number, speed: number, at: Vec3 | null): void {
    const T = SCORE_TUNING;
    this.play('throw.whoosh', now, { param: clamp(0.12 + 0.02 * (speed - T.throwMin), 0.12, 0.42), rate: clamp(0.85 + 0.025 * speed, 0.85, 1.25), gain: T.whoosh * hitGain(speed) }, at);
  }

  /** A crew yelp, not again within `yelpGap` of the last under the same key. */
  private yelp(w: WorldView, id: Id, voice: string, now: number, key: string = id): void {
    const last = this.yelped.get(key);
    if (last !== undefined && now - last < SCORE_TUNING.yelpGap && now >= last) return;
    this.yelped.set(key, now);
    this.play(voice, now, {}, this.posOf(w, id));
  }

  /** Fetch's own knock: its note by its size and material (the landing of a flight). */
  private fetchNote(w: WorldView): string {
    const p = this.fetch ? w.part(this.fetch) : undefined;
    return p ? `hit.${p.material}.${p.size}` : 'hit.metal.M';
  }

  private revertBody(w: WorldView): Id | null {
    const v = this.revert ? w.machine(this.revert) : undefined;
    return v?.kind === 'revert' ? v.body : null;
  }

  /** Where something is on the bench: a part, a crew member, a station, a jack, the Button. */
  posOf(w: WorldView, id: Id): Vec3 | null {
    const m = w.motion(id);
    if (m && m.mode !== 'gone' && m.mode !== 'chute') return m.pose.p;
    const c = w.crew(id);
    if (c) return [c.x, 0, c.z];
    const s = w.scene;
    const st = s.button.ladder?.stations.find((x) => x.id === id);
    if (st) return st.at;
    const j = s.cord.jacks.find((x) => x.id === id);
    if (j) return j.at;
    if (id === s.button.id) return s.button.at;
    const v = w.machine(id);
    if (v && (v.kind === 'revert' || v.kind === 'patch')) return v.kind === 'revert' ? [v.x, 0, v.z] : v.at;
    return null;
  }

  /** Left to right across the bench, -panWidth .. panWidth; the middle when there is nowhere to put it. */
  panOf(p: Vec3 | null): number {
    if (!this.bench || !p) return 0;
    const b = this.bench;
    const half = (b.maxX - b.minX) / 2 || 1;
    return clamp((p[0] - (b.maxX + b.minX) / 2) / half, -1, 1) * SCORE_TUNING.panWidth;
  }

  private bench: { readonly minX: number; readonly maxX: number } | null = null;
}

/** P4 D1: which payment on the ledger board is the rubber one now. */
function rubberIndex(w: WorldView, unit: Id): number {
  const v = w.machine(unit);
  return v && v.kind === 'ledger' ? rubberOf(v.tokens) : -1;
}
