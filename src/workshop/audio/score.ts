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
import { HZ } from '../sim/index.ts';
import type { Id, SimEvent, Vec3, WorldView } from '../sim/index.ts';
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
  readonly id: 'loop.hum' | 'loop.treads' | 'loop.wheel';
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
   * (R1) A crate thrown out of the chute lands on the pad: its own note, as a knock this loud, once; the
   * physics' own contacts for it are not heard for this long after (it is handed to physics still, a hair up).
   */
  padLanding: { gain: 0.6, quiet: 0.35 },
  /** (R1) A crew member's yelp when lifted is not heard again within this long (s). */
  yelpGap: 2,
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
  private speeds = new Map<Id, number>();
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
    for (const e of events) this.event(world, e, now);
    this.states(world, now);
    this.track(world);
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

  private event(w: WorldView, e: SimEvent, now: number): void {
    const T = SCORE_TUNING;
    switch (e.type) {
      case 'part.grabbed': {
        const p = w.part(e.id);
        if (p) this.play(`pick.${p.material}.${p.size}`, now, {}, this.posOf(w, e.id));
        return;
      }
      case 'part.hit': {
        const p = w.part(e.id);
        if (!p || e.strength < T.hitSoft) return;
        // the faster of the two, as it was coming in (a crate dropped on a resting one: the dropped one's speed)
        const g = hitGain(Math.max(this.speeds.get(e.id) ?? 0, e.other ? (this.speeds.get(e.other) ?? 0) : 0));
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
      case 'reset':
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
      case 'tell':
        return this.play('tell.tick', now, {}, this.posOf(w, e.id));
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
  private track(w: WorldView): void {
    this.speeds.clear();
    for (const p of w.parts()) {
      const m = w.motion(p.id);
      if (!m || !m.awake) continue;
      const a = m.prev.p;
      const b = m.pose.p;
      const v = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * HZ;
      if (v > 0.05) this.speeds.set(p.id, v);
    }
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
    if (f) {
      const held = f.state === 'held';
      const s = held ? T.fetchSpeed * 0.6 : Math.abs(f.speed);
      out.push({ id: 'loop.wheel', gain: clamp(s / 0.5, 0, 1) * (held ? 0.6 : 1), rate: 0.7 + 0.6 * clamp(s / T.fetchSpeed, 0, 1), pan: this.panOf(held ? this.posOf(w, f.id) : [f.x, 0, f.z]) });
    } else out.push({ id: 'loop.wheel', gain: 0, rate: 1, pan: 0 });
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
