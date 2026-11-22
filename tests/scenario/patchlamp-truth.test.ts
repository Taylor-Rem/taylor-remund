// REWRITE.md § F3, the toy truth table (S3): one test per row the Patchlamp toy can break, on seeded
// sequences of real texts, handles, cord moves, lever pulls and "undo that" on the whole bench under
// real Rapier, with § E5's replay check and invariants watching every step.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, traySpot } from './patchlamp-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, TransactionId, Value } from '../../src/workshop/sim/types.ts';
import type { ReplyLine } from '../../src/workshop/sim/instruct/types.ts';
import { renderReply } from '../../src/content/texts.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

const JACKS = ['jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp'] as const;
const STATION: Record<string, Id> = { 'jack-storefront': 'storefront', 'jack-platen': 'platen', 'jack-belt': 'belt', 'jack-lamp': 'lamp' };
const PARTS = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'crate-spare-1', 'crate-spare-2'];
const TEXTS = [
  'make it blue', 'make it red', 'paint it yellow', 'call it FRAGILE', 'label it HELLO', 'make the sign green', 'make the sign say OPEN LATE',
  'paint the awning violet', "we're closed", 'we are open', 'put a boat in the window', 'change the picture', 'take the picture down',
  'faster', 'slower', 'stop', 'go', 'reverse it', 'brighter', 'dimmer', 'lights out', 'lights on', 'back to warm', 'make it teal',
  'undo that', 'undo that', 'undo that', 'help', 'who are you', 'thanks', 'make the lamp blue', 'stop the belt', 'paint the crate red',
  'can taylor call me', 'make it pink', 'call it a label far too long for tape', 'make the sign red and email my accountant', 'put a cat in the window',
];

/** What a change line claims, checked against the durable state now (independent of the line's own check). */
function shows(w: World, l: ReplyLine, station: Id, part: Id | null, was: (f: string) => Value | undefined): boolean {
  const s = (f: string): Value | undefined => w.setting(station, f);
  switch (l.id) {
    case 'change.sign': return s('sign') === l.colour;
    case 'change.words': return s('words') === l.words;
    case 'change.awning': return s('awning') === l.colour;
    case 'change.open': return s('open') === true;
    case 'change.closed': return s('open') === false;
    case 'change.picture': return s('picture') === l.picture;
    case 'change.picture.none': return s('picture') === 'none';
    case 'change.picture.next': return s('picture') !== 'none' && s('picture') !== was('picture');
    case 'change.platen.colour': return part !== null && w.part(part)!.colour === l.colour;
    case 'change.platen.label': return part !== null && w.part(part)!.label === l.words;
    case 'change.belt.faster': return (s('speed') as number) > (was('speed') as number);
    case 'change.belt.slower': return (s('speed') as number) < (was('speed') as number);
    case 'change.belt.stop': return s('running') === false;
    case 'change.belt.go': return s('running') === true;
    case 'change.belt.flip': return s('direction') !== was('direction');
    case 'change.belt.forward': return s('direction') === 'forward';
    case 'change.belt.backward': return s('direction') === 'backward';
    case 'change.lamp.brighter': return (s('level') as number) > (was('level') as number) || (s('on') === true && was('on') === false);
    case 'change.lamp.dimmer': return (s('level') as number) < (was('level') as number);
    case 'change.lamp.off': return s('on') === false;
    case 'change.lamp.on': return s('on') === true;
    case 'change.lamp.colour': return s('colour') === l.colour;
    case 'change.lamp.warm': return s('colour') === 'warm';
    default: throw new Error(`no claim check for ${l.id}`);
  }
}

interface Run {
  readonly w: World;
  readonly t: Tape;
  readonly stats: { replies: number; changes: number; refusals: number; mailbox: number; undone: number; cancelled: number; textEffects: number; firstReplySeconds: number[] };
}

/** One seeded sequence: texts on every line, the dial, the cord, the lever, crates on the tray. Checks every step. */
async function sequence(seed: number, steps: number): Promise<Run> {
  const r = rng(`patchlamp-truth-${seed}`);
  const w = await benchWorld(seed);
  const stats: Run['stats'] = { replies: 0, changes: 0, refusals: 0, mailbox: 0, undone: 0, cancelled: 0, textEffects: 0, firstReplySeconds: [] };
  const chk = checker(w, { jacks: [...JACKS], parts: PARTS });
  /** Each text: its jack, the step it was sent, whether Patch was free then; each text transaction's jack. */
  const sentAt = new Map<number, { jack: Id; step: number; free: boolean }>();
  // (`free` is cleared for every text in hand when a Button rung pauses Patch)
  const txnJack = new Map<TransactionId, Id>();
  /** Values at each line.working (the moment before Patch's work), by text number. */
  const before = new Map<number, Map<string, Value | undefined>>();
  const fail = (msg: string): never => {
    throw new Error(`seed ${seed}, step ${w.step}: ${msg}`);
  };
  const t = tape(w);
  const observe = (ev: readonly SimEvent[]): void => {
    chk.step(ev, w.step);
    for (const e of ev) {
      if (e.type === 'line.sent') {
        const line = w.machine('line') as { waiting: number; job: unknown };
        sentAt.set(e.n, { jack: e.jack, step: w.step, free: line.job === null && line.waiting <= 1 }); // (this text is the one waiting)
        const top = w.undoStack().at(-1);
        if (top?.kind === 'text' && top.opened === w.step) txnJack.set(top.id, e.jack);
      } else if (e.type === 'line.working') {
        const s = sentAt.get(e.n)!;
        const st = STATION[s.jack]!;
        const m = new Map<string, Value | undefined>();
        for (const f of ['picture', 'speed', 'direction', 'level', 'on']) m.set(f, w.setting(st, f));
        before.set(e.n, m);
      } else if (e.type === 'effect') {
        const c = e.effect.cause;
        const jack = typeof c === 'string' && c.startsWith('t') ? txnJack.get(c as TransactionId) : undefined;
        if (jack === undefined) continue;
        stats.textEffects += 1;
        // § F3 "one drawer per jack": a text writes only its own line's station (or the part on the platen's tray)
        const st = STATION[jack]!;
        const ok = st === 'platen' ? (e.effect.field === 'colour' || e.effect.field === 'label') && PARTS.includes(e.effect.target) : e.effect.target === st;
        if (!ok) fail(`a text through ${jack} wrote ${e.effect.target}.${e.effect.field}`);
      } else if (e.type === 'line.reply' || e.type === 'line.refused') {
        const words = renderReply(e.reply);
        // nothing is ever claimed sent
        if (/\b(sent|send|forward|forwarded|emailed|messaged|passed (it )?on)\b/i.test(words)) fail(`a reply claims something was sent: ${words}`);
        if (e.mailbox && !e.reply.some((l) => l.id === 'mailbox')) fail('a mailbox flag without the mailbox line');
        if (e.mailbox) stats.mailbox += 1;
        if (e.type === 'line.refused') {
          stats.refusals += 1;
          if (e.reason === 'cancelled') stats.cancelled += 1;
          if (e.reply.some((l) => l.id.startsWith('change.') || l.id.startsWith('done.'))) fail(`a refusal says something was done: ${words}`);
          continue;
        }
        stats.replies += 1;
        const s = sentAt.get(e.n)!;
        const changes = e.reply.filter((l) => l.id.startsWith('change.'));
        if (changes.length === 0) continue;
        stats.changes += 1;
        if (!e.reply.some((l) => l.id === 'done.checked')) fail('a change reply without the check');
        if (s.free) stats.firstReplySeconds.push((w.step - s.step) / HZ);
        // the reply never says a thing was done that the durable state does not show
        const st = STATION[s.jack]!;
        const onTray = st === 'platen' ? ((w.machine('platen') as { onTray: Id | null }).onTray) : null;
        const was = before.get(e.n)!;
        for (const l of changes) if (!shows(w, l, st, onTray, (f) => was.get(f))) fail(`reply to text ${e.n} says ${l.id} ${JSON.stringify(l)} but the world does not show it`);
      } else if (e.type === 'undone') stats.undone += 1;
      else if (e.type === 'rung.started') for (const v of sentAt.values()) v.free = false; // a rung pauses Patch: not a timing sample
    }
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) observe(t.run(1));
  };
  // a crate on the tray to begin with, so the platen line has something to paint
  putOn(w, t, 'crate-3', traySpot(), 120);
  observe(t.events.map((x) => x.e));
  run(60);
  while (w.step < steps) {
    if (w.bracketed || r.chance(0.985)) {
      run(1);
      continue;
    }
    const k = r.int(100);
    if (k < 55) w.dispatch({ type: 'text', text: r.pick(TEXTS) });
    else if (k < 65) {
      w.dispatch({ type: 'unplug', cord: 'cord' });
      run(1);
      w.dispatch({ type: 'plug', cord: 'cord', jack: r.pick([...JACKS, 'jack-reserved-1']) });
    } else if (k < 75) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
    else if (k < 80) w.dispatch({ type: 'turn', id: 'belt-lever', value: r.next() });
    else if (k < 90) w.dispatch({ type: 'undo' });
    else if (k < 95) {
      const b = PATCHLAMP.lamp.home.aim;
      w.dispatch({ type: 'drag', id: 'lamp', target: [b[0] + r.range(-3, 3), b[1], b[2] + r.range(-3, 3)], end: true });
    } else if (k < 97) w.dispatch({ type: 'press', id: 'button' });
    else w.dispatch({ type: 'reset' });
    run(1);
  }
  return { w, t, stats };
}

describe('§ F3 the toy truth table, on seeded sequences', () => {
  test('every row the toy can break holds at every step of eight sequences (the replay check and the invariants too)', async () => {
    const total = { replies: 0, changes: 0, refusals: 0, mailbox: 0, undone: 0, cancelled: 0, textEffects: 0 };
    const seconds: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { stats } = await sequence(seed, 7200);
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += stats[k];
      seconds.push(...stats.firstReplySeconds);
    }
    process.stdout.write(`\npatchlamp truth: ${JSON.stringify(total)}, ${seconds.length} timed\n`);
    // it really exercised the station
    expect(total.changes).toBeGreaterThan(40); // (S6: a job is 4.5 s and a roll now, so fewer finish in the same two minutes)
    expect(total.refusals).toBeGreaterThan(60);
    expect(total.mailbox).toBeGreaterThan(5);
    expect(total.cancelled).toBeGreaterThan(5);
    expect(total.undone).toBeGreaterThan(30);
    expect(total.textEffects).toBeGreaterThan(40); // (S6: fewer jobs finish, see above)
    // "the toy takes seconds": a change texted to a free Patch is answered in four and a half, plus the stool's roll
    // (S6: 4.5 s at that jack, at most 1.2 s more to roll the whole runner)
    expect(seconds.length).toBeGreaterThan(0); // most texts here queue behind another (the single job is also timed in patchlamp-patch)
    for (const s of seconds) {
      expect(s).toBeGreaterThanOrEqual(4.4);
      expect(s).toBeLessThanOrEqual(5.8);
    }
  }, 300_000);
});

describe('§ F3 rows, one each', () => {
  test('"Patch says it is Claude wearing a name tag": the who-answer, verbatim from § B5', () => {
    const spec = readFileSync('REWRITE.md', 'utf8');
    expect(spec).toContain(renderReply([{ id: 'who' }]));
  });

  test('"The phone is scripted; no model is called": the station has no way to reach a network', () => {
    for (const f of ['src/workshop/sim/machines/line.ts', 'src/workshop/sim/crew/patch.ts', 'src/workshop/sim/machines/platen.ts', 'src/workshop/sim/machines/storefront.ts', 'src/workshop/sim/machines/lamp.ts', 'src/workshop/ui/phone/world-line.ts']) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\(\s*['"]https?:/);
    }
  });

  test('"An unparsed text is pointed at Taylor\'s mailbox; nothing is claimed sent": no reply line says anything was sent', () => {
    const all = JSON.parse(readFileSync('src/content/texts.json', 'utf8')) as { replies: Record<string, { text: string }> };
    for (const [id, e] of Object.entries(all.replies)) expect(e.text, id).not.toMatch(/\b(sent|send|forward|forwarded|emailed|messaged)\b/i);
  });
});
