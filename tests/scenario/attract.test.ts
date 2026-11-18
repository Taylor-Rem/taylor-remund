// S6: attract mode, then play mode (REWRITE.md § B3; § E5 rule 5), on the whole bench under real Rapier.
// Until the visitor's first action the crew demonstrates the whole loop, lap after lap: Fetch takes a crate
// from the stack to the platen's tray and taps the phone ("Make it blue."); Patch rolls to the PLATEN jack,
// moves the cord, does the job, replies, and puts the cord back; Fetch takes the painted crate to the belt;
// it rides, sounds at the striker, ships, and the stack is restocked. All of it as the crew: nothing goes on
// the undo stack. At the first action attract mode ends for the visit and nothing is left stuck.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { checker } from './standins/replay.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { parse } from '../../src/workshop/sim/instruct/index.ts';
import { ATTRACT_TIMELINE } from '../../src/workshop/sim/crew/fetch.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, LineView, PatchView, PlatenView, SimEvent, Value } from '../../src/workshop/sim/types.ts';

const JACKS = ['jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp'] as const;
const PARTS = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
const LAP_MAX = 40;
/** The first lap holds the fumble of § B3 (about 4 s in; Fetch offers the crate for 12 s before it carries on). */
const FIRST_LAP_MAX = LAP_MAX + 12;

const attractWorld = (seed: string): Promise<World> => benchWorld(seed, { scene: FULL_BENCH });

/**
 * The durable world as a lap leaves it, up to which crate is which: every setting's value; the parts on the
 * bench (not shipped) as a sorted list of what they are (kind, size, colour, label, marks, contents) and
 * where (on the stack, or which mouth); and how many are shipped.
 */
function signature(w: World): { settings: Record<string, Value>; parts: string[]; shipped: number } {
  const ids = new Set([...w.parts()].map((p) => p.id));
  const settings: Record<string, Value> = {};
  for (const d of w.durable()) if (!ids.has(d.target)) settings[`${d.target}.${d.field}`] = d.value;
  const stack = w.scene.runner.rounds!.stack;
  const parts: string[] = [];
  let shipped = 0;
  for (const p of w.parts()) {
    if (p.kind === 'robot') continue;
    if (p.location.at === 'shipped') {
      shipped++;
      continue;
    }
    // where it durably is (a crate in Fetch's hands is still where it rested)
    const pos = p.location.at === 'rest' ? p.location.pose.p : null;
    const where = p.location.at === 'in' ? `in ${p.location.mouth}` : pos && Math.hypot(pos[0] - stack[0], pos[2] - stack[1]) < 0.6 ? 'on the stack' : 'elsewhere';
    parts.push(JSON.stringify([p.kind, p.size, p.colour, p.label, p.marks, p.contents, where]));
  }
  return { settings, parts: parts.sort(), shipped };
}

/** Run until `n` laps are done (or `max` seconds); every step checked by `each`. */
function laps(w: World, t: Tape, n: number, max: number, each?: (ev: SimEvent[]) => void): void {
  for (let i = 0; i < max * HZ && w.attract().laps.length < n; i++) {
    const ev = t.run(1);
    each?.(ev);
  }
}

describe('attract mode: the crew demonstrates the whole loop until the first action', () => {
  test('three laps with nobody touching anything: each inside its time, the world after a lap the world before it but for the crates shipped, the undo stack empty', async () => {
    const w = await attractWorld('attract-laps');
    const t = tape(w);
    const chk = checker(w, { jacks: JACKS, parts: PARTS });
    const sigs: ReturnType<typeof signature>[] = [];
    let seen = 0;
    let sigAt = -1;
    laps(w, t, 4, 4 * FIRST_LAP_MAX, (ev) => {
      chk.step(ev, w.step);
      // nothing of it is the visitor's: every write is the crew's or the system's, and the lever has nothing to take
      for (const e of ev) if (e.type === 'effect') expect(['crew', 'system'], `${e.effect.target}.${e.effect.field}`).toContain(e.effect.cause);
      expect(w.undoStack()).toEqual([]);
      // a second after a lap ends (the stack's fresh crate has come to rest), what the world is
      if (w.attract().laps.length > seen) {
        seen = w.attract().laps.length;
        sigAt = w.step + HZ;
      }
      if (w.step === sigAt) sigs.push(signature(w));
    });
    expect(w.playMode).toBe(false);
    const done = w.attract().laps;
    expect(done.map((l) => l.lap)).toEqual([1, 2, 3, 4]);
    const lengths = done.map((l) => l.end - l.start);
    process.stdout.write(`\nattract laps (s): ${lengths.map((s) => s.toFixed(1)).join(', ')}\n`);
    expect(lengths[0]).toBeLessThan(FIRST_LAP_MAX);
    for (const s of lengths.slice(1)) expect(s).toBeLessThan(LAP_MAX);
    for (const s of lengths.slice(1)) expect(s).toBeGreaterThan(20); // "about thirty seconds a lap"
    // the world after a lap equals the world before it, except the count of crates shipped (from the end of the
    // first lap: it began with the loose crate in Fetch's hands rather than on the stack)
    expect(sigs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sigs.length; i++) {
      expect(sigs[i]!.settings).toEqual(sigs[i - 1]!.settings);
      expect(sigs[i]!.parts).toEqual(sigs[i - 1]!.parts);
      expect(sigs[i]!.shipped).toBe(sigs[i - 1]!.shipped); // (the spare that replaced it is behind the door no more)
    }
    // one crate shipped a lap
    const shippedAt = t.of('shipped').map((x) => x.step / HZ);
    for (const l of done) expect(shippedAt.filter((s) => s > l.start && s <= l.end), `lap ${l.lap}`).toHaveLength(1);
    // and the settings are the visit's own: the cord back in STOREFRONT, the lamp, the belt, the storefront untouched
    const first = signature(await attractWorld('attract-laps-start'));
    expect(sigs[0]!.settings).toEqual(first.settings);
    // the fumble of the first four seconds happened once, inside the first lap
    const fumbles = t.events.filter((x) => x.e.type === 'crew.state' && x.e.id === 'fetch' && x.e.state === 'fumble');
    expect(fumbles).toHaveLength(1);
    expect(fumbles[0]!.step / HZ).toBeLessThan(done[0]!.end);
    // the phone keeps the conversation: each lap's text, worked and answered with the change
    const log = (w.machine('line') as LineView).log;
    const sent = log.filter((e) => e.kind === 'sent');
    expect(sent.length).toBeGreaterThanOrEqual(4);
    for (const s of sent) expect(s).toMatchObject({ by: 'crew', content: 'attract.text.make-it-blue', jack: 'jack-platen', line: 'platen' });
    const replies = log.filter((e) => e.kind === 'reply');
    expect(replies.length).toBeGreaterThanOrEqual(4);
    for (const r of replies) expect(r.kind === 'reply' && r.reply.map((l) => l.id)).toEqual(['change.platen.colour', 'done.checked', 'done.patched']);
    // Patch moved the cord there and back, as the crew; the visitor's "used" list has nothing in it
    const moves = t.of('cord.plugged');
    expect(moves.slice(0, 8).map((x) => [x.e.jack, x.e.by])).toEqual([0, 1, 2, 3].flatMap(() => [['jack-platen', 'crew'], ['jack-storefront', 'crew']]));
    expect(w.button().used).toEqual([]);
    expect(chk.stats.effects).toBeGreaterThan(20);
  }, 180_000);

  test('the timeline the view follows: the beats in order, each lap, with the crew states that show them', async () => {
    const w = await attractWorld('attract-beats');
    const t = tape(w);
    laps(w, t, 2, 2 * FIRST_LAP_MAX);
    const beats = t.of('attract.beat').filter((x) => x.e.lap === 2).map((x) => x.e.beat);
    expect(beats).toEqual(ATTRACT_TIMELINE.map((b) => b.beat));
    // Fetch taps the phone; Patch rolls, moves the cord, works, and the plan it publishes says so
    expect(t.of('crew.state').some((x) => x.e.id === 'fetch' && x.e.state === 'tap')).toBe(true);
    const patch = t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state);
    expect(patch).toEqual(expect.arrayContaining(['notice', 'roll', 'plug', 'drawer', 'work', 'check', 'reply']));
    expect(w.attract()).toMatchObject({ on: true, lap: 3 });
  }, 180_000);

  test('the text Fetch sends is the words the phone shows: "Make it blue." means what the parser does with "blue" on the PLATEN line', () => {
    const content = JSON.parse(readFileSync(new URL('../../src/content/attract.json', import.meta.url), 'utf8')) as { text: Record<string, { text: string }> };
    const a = FULL_BENCH.runner.attract!;
    expect(a.say).toBe('attract.text.make-it-blue');
    const shown = content.text['make-it-blue']!.text;
    expect(shown).toBe('Make it blue.'); // verbatim from § B3
    const said = parse(shown, 'platen');
    const read = parse(a.words, 'platen');
    expect(said.kind).toBe('instruction');
    expect(read).toEqual(said);
  });
});

describe('play mode: the first action, at any moment of a lap', () => {
  /** A seeded first action of the visitor's, chosen by what is there to act on. */
  function firstAction(w: World, t: Tape, r: ReturnType<typeof rng>, k: number): string {
    const f = w.crew('fetch')!;
    const onTray = (w.machine('platen') as PlatenView).onTray;
    const kinds = ['text', 'button', 'cord', 'lever', 'grab-stack', ...(f.carrying ? ['grab-hands'] : []), ...(onTray ? ['grab-tray'] : [])];
    const kind = kinds[k % kinds.length]!;
    const grabAndDrop = (id: Id): void => {
      const p = w.motion(id)!.pose.p;
      w.dispatch({ type: 'grab', id, grip: p });
      for (let i = 0; i < 20; i++) {
        w.dispatch({ type: 'carry', target: [p[0] + i * 0.05, p[1] + 1, p[2] + 0.5] });
        t.run(1);
      }
      w.dispatch({ type: 'release', velocity: [r.range(-1, 1), 0, r.range(-1, 1)] });
    };
    switch (kind) {
      case 'text':
        w.dispatch({ type: 'text', text: 'make it red' });
        break;
      case 'button':
        w.dispatch({ type: 'press', id: 'button' });
        break;
      case 'cord':
        w.dispatch({ type: 'unplug', cord: 'cord' });
        t.run(1);
        w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
        break;
      case 'lever':
        w.dispatch({ type: 'undo' });
        break;
      case 'grab-stack': {
        const top = [...w.parts()].filter((p) => p.kind === 'crate' && w.mode(p.id) === 'free').sort((a, b) => w.motion(b.id)!.pose.p[1] - w.motion(a.id)!.pose.p[1])[0]!;
        grabAndDrop(top.id);
        break;
      }
      case 'grab-hands':
        grabAndDrop(f.carrying!);
        break;
      case 'grab-tray':
        grabAndDrop(onTray!);
        break;
    }
    t.run(1);
    return kind;
  }

  test('at each of twelve seeded moments of a lap: nothing left stuck, and nothing the visitor did is undone or moved by the crew', async () => {
    const r = rng('attract-first-action');
    const kinds: string[] = [];
    for (let k = 0; k < 12; k++) {
      const w = await attractWorld(`attract-first-${k}`);
      const t = tape(w);
      laps(w, t, 1, FIRST_LAP_MAX); // the second lap begins
      const lapStart = w.step;
      // a moment of the second lap: spread over its length, jittered
      const at = Math.round(((k + r.next()) / 12) * 29 * HZ);
      t.run(at);
      expect(w.playMode, `moment ${k}`).toBe(false);
      const beat = w.attract().beat;
      const kind = firstAction(w, t, r, k);
      kinds.push(`${kind}@${beat}`);
      expect(w.playMode, `moment ${k}: ${kind}`).toBe(true);
      expect(w.attract().on).toBe(false);
      // from now on: the crew writes no setting and no part the visitor has touched; the system only puts the crew's cord back
      const writers = new Map<string, string>();
      const watchFrom = w.step;
      let shipped = 0;
      for (let i = 0; i < 40 * HZ; i++) {
        for (const d of w.durable()) writers.set(`${d.target}.${d.field}`, d.writer);
        const ev = t.run(1);
        for (const e of ev) {
          if (e.type === 'shipped') shipped++;
          if (e.type !== 'effect') continue;
          const { target, field, cause } = e.effect;
          const before = writers.get(`${target}.${field}`)!;
          const isPart = PARTS.includes(target) || target === 'revert';
          if (cause === 'crew') {
            expect(isPart, `moment ${k} (${kind}): the crew wrote the setting ${target}.${field}`).toBe(true);
            if (target !== 'fetch' && target !== 'revert') expect(w.touched(target), `moment ${k} (${kind}): the crew wrote ${target}, the visitor's`).toBe(false);
          }
          // nothing the visitor wrote is written by the crew or the system (an undo of theirs aside)
          if (cause === 'crew' || cause === 'system') expect(/^t\d+$/.test(before) && !isPart, `moment ${k} (${kind}): ${cause} overwrote the visitor's ${target}.${field}`).toBe(false);
        }
        expect(w.undoStack().every((x) => x.opened >= watchFrom - 30), `moment ${k}`).toBe(true);
      }
      // nothing stuck: the crew's text is gone from the line, Patch is free, the cord is where the visit left it
      // (STOREFRONT) unless the visitor used the line, no crate of the crew's left on the tray, Fetch's rounds run on
      const line = w.machine('line') as LineView;
      const patch = w.machine('patch') as PatchView;
      expect(line.job, `moment ${k} (${kind}@${beat})`).toBeNull();
      expect(line.waiting).toBe(0);
      expect(['seated', 'roll']).toContain(patch.state);
      if (kind !== 'cord' && kind !== 'text') expect(w.setting('cord', 'jack'), `moment ${k} (${kind}@${beat})`).toBe('jack-storefront');
      // the crew's last word on the cord is only ever STOREFRONT (where it put it back)
      if (w.writer('cord', 'jack') === 'crew') expect(w.setting('cord', 'jack'), `moment ${k} (${kind}@${beat})`).toBe('jack-storefront');
      const tray = (w.machine('platen') as PlatenView).onTray;
      if (tray !== null) expect(w.touched(tray), `moment ${k} (${kind}@${beat}): ${tray} left on the tray`).toBe(true);
      expect(shipped, `moment ${k} (${kind}@${beat}): Fetch's rounds`).toBeGreaterThanOrEqual(1);
      w.dispose();
    }
    process.stdout.write(`\nfirst actions: ${kinds.join(', ')}\n`);
    // the moments covered the lap
    expect(new Set(kinds.map((x) => x.split('@')[1])).size).toBeGreaterThanOrEqual(5);
  }, 600_000);

  test('the named awkward moments: the cord in PLATEN mid-job, a crate on the tray, a crate in Fetch\'s hands', async () => {
    // mid-job, the cord in PLATEN (the crew's): the visitor takes a crate off the stack
    {
      const w = await attractWorld('attract-midjob');
      const t = tape(w);
      for (let i = 0; i < 60 * HZ && !((w.machine('patch') as PatchView).state === 'drawer' && w.setting('cord', 'jack') === 'jack-platen'); i++) t.run(1);
      expect(w.writer('cord', 'jack')).toBe('crew');
      firstAction(w, t, rng('x'), 4); // grab-stack
      expect(w.playMode).toBe(true);
      expect(w.setting('cord', 'jack')).toBe('jack-storefront'); // back where the visit began, as the system, at once
      expect(w.writer('cord', 'jack')).toBe('system');
      expect((w.machine('line') as LineView).job).toBeNull(); // the crew's text dropped: the visitor comes first
      t.run(2 * HZ);
      expect(['seated', 'roll']).toContain((w.machine('patch') as PatchView).state);
      // the crate it was about to paint was never painted, and Fetch takes it on to the belt
      const crate = w.attract().crate!;
      expect(w.part(crate)!.colour).toBe('bare');
      t.run(15 * HZ);
      expect((w.machine('platen') as PlatenView).onTray).toBeNull();
      w.dispose();
    }
    // a crate in Fetch's hands: the visitor presses the Button; after the rung Fetch sets it on the belt
    {
      const w = await attractWorld('attract-hands');
      const t = tape(w);
      laps(w, t, 1, FIRST_LAP_MAX);
      for (let i = 0; i < 10 * HZ && w.crew('fetch')!.carrying === null; i++) t.run(1);
      const crate = w.crew('fetch')!.carrying!;
      expect(crate).not.toBeNull();
      w.dispatch({ type: 'press', id: 'button' });
      t.run(1);
      for (let i = 0; i < 10 * HZ && w.bracketed; i++) t.run(1);
      const until = (pred: () => boolean): boolean => {
        for (let i = 0; i < 30 * HZ; i++) {
          if (pred()) return true;
          t.run(1);
        }
        return false;
      };
      expect(until(() => w.part(crate)!.location.at === 'in' || w.part(crate)!.location.at === 'shipped')).toBe(true);
      w.dispose();
    }
  }, 300_000);

  test('rule 5 under the replay check: attract mode first, then a seeded visitor; every step checked', async () => {
    const w = await attractWorld('attract-replay');
    const t = tape(w);
    const chk = checker(w, { jacks: JACKS, parts: PARTS });
    const r = rng('attract-replay');
    for (let i = 0; i < 35 * HZ; i++) chk.step(t.run(1), w.step);
    expect(w.playMode).toBe(false);
    const texts = ['make it red', 'faster', 'undo that', 'make the sign blue', 'dimmer', 'label it HELLO'];
    while (w.step < 160 * HZ) {
      if (w.bracketed || r.chance(0.97)) {
        const ev = t.run(1);
        chk.step(ev, w.step);
        if (w.playMode) for (const e of ev) if (e.type === 'effect' && e.effect.cause === 'crew') expect(PARTS.includes(e.effect.target), `${e.effect.target}.${e.effect.field}`).toBe(true);
        continue;
      }
      const k = r.int(10);
      if (k < 3) w.dispatch({ type: 'text', text: r.pick(texts) });
      else if (k < 5) {
        w.dispatch({ type: 'unplug', cord: 'cord' });
        chk.step(t.run(1), w.step);
        w.dispatch({ type: 'plug', cord: 'cord', jack: r.pick([...JACKS]) });
      } else if (k < 7) w.dispatch({ type: 'undo' });
      else if (k < 8) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
      else if (k < 9) w.dispatch({ type: 'press', id: 'button' });
      else {
        const free = [...w.parts()].filter((p) => p.kind === 'crate' && ['free', 'crew', 'machine'].includes(w.mode(p.id) ?? ''));
        if (free.length > 0) {
          const id = r.pick(free).id;
          w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
          chk.step(t.run(1), w.step);
          w.dispatch({ type: 'carry', target: [r.range(-6, 6), 1.5, r.range(-2, 3)] });
          for (let i = 0; i < 20; i++) chk.step(t.run(1), w.step);
          w.dispatch({ type: 'release', velocity: [0, 0, 0] });
        }
      }
      chk.step(t.run(1), w.step);
    }
    expect(w.playMode).toBe(true);
    expect(chk.stats.undone).toBeGreaterThan(3);
    expect(chk.stats.effects).toBeGreaterThan(30);
  }, 300_000);
});
