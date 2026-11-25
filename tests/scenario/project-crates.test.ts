// P4 S5: the crates are Taylor's projects. Six crates circulate as themselves; each opens on the opening stand (I2: the
// stand is how a crate opens, `OPENING_STAND_ON`; until then each opened by its latch): one effect of `open`, under the
// placing that set it there, undone by the lever and by "Reset the workshop"; the lid claps shut first whenever the crate
// is picked up, taken, knocked or burdened; Revert leaves an open crate alone; a crate's thing sits on its tray while it
// is open (proved with the development stand-in). Every crate here is opened by `openOnStand` (line-helpers.ts).
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, openOnStand, FULL_BENCH, BENCH, LOOSE_BENCH } from './line-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { OPENING_STAND, PROJECT_CRATES, STAND_IN_THING, withStandIn, withoutOpeningStand } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import { parseSaved } from '../../src/workshop/sim/saved.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const isOpen = (w: World, id: Id): boolean => w.setting(id, OPEN) === true;
const press = (w: World, id: Id): void => w.dispatch({ type: 'press', id });
const SIX = PROJECT_CRATES.map((c) => c.crate);
/** A clear spot on the open bench (front left), well away from the stand. */
const CLEAR: Vec3 = [-5.6, 0, 1.6];

describe('the six project crates', () => {
  test('the bench has exactly six crates, each a project with a plate in the registry (and, with the stand, no latch)', async () => {
    const w = await benchWorld('pc-six', { scene: FULL_BENCH });
    const crates = [...w.parts()].filter((p) => p.kind === 'crate').map((p) => p.id);
    expect(crates.sort()).toEqual([...SIX].sort());
    expect(new Set(PROJECT_CRATES.map((c) => c.project)).size).toBe(6);
    for (const c of PROJECT_CRATES) {
      // (I2) the stand opens a crate: its latch is no interactable (nothing a hand or a key can take)
      expect(w.interactable(c.lid)).toBeUndefined();
      expect(w.interactable(c.plate)?.affordances).toContain('press');
      expect(w.interactable(c.crate)?.name).toBe(`name.project.${c.project}`);
      expect(isOpen(w, c.crate)).toBe(false);
    }
    w.dispose();
  });

  test('left alone for eight minutes, every one of the six comes onto the bench, and only these: a shipped crate comes back as itself', async () => {
    const w = await benchWorld('pc-circulate', { scene: FULL_BENCH });
    const t = tape(w);
    const seen = new Set<Id>();
    const restocked: Id[] = [];
    for (let i = 0; i < steps(8 * 60); i++) {
      for (const e of t.run(1)) if (e.type === 'restocked') restocked.push(e.part);
      if (i % 30 === 0) for (const id of SIX) if (w.mode(id) !== 'gone' && w.mode(id) !== 'chute') seen.add(id);
    }
    process.stderr.write(`\nseen on the bench: ${[...seen].join(', ')}; came back: ${restocked.join(', ')}\n`);
    expect([...seen].sort()).toEqual([...SIX].sort());
    for (const id of restocked) expect(SIX).toContain(id);
    w.dispose();
  }, 300_000);
});

describe('opening and shutting (I2: on the stand; until then "the latch")', () => {
  test('set on the stand it opens (one effect of open, under the placing\'s own transaction), lifted off it shuts; the lever takes each back', async () => {
    const w = await benchWorld('pc-latch', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const from = t.events.length;
    openOnStand(w, t, 'crate-3');
    const ev = t.events.slice(from).map((x) => x.e);
    expect(isOpen(w, 'crate-3')).toBe(true);
    // (I2) the stand opens it (its unit says so), no longer the crates' latch
    expect(ev).toContainEqual({ type: 'crate.opened', id: OPENING_STAND.unit, crate: 'crate-3', project: 't-components' });
    expect(ev.filter((e) => e.type === 'effect' && e.effect.target === 'crate-3' && e.effect.field === OPEN)).toHaveLength(1);
    expect(w.touched('crate-3')).toBe(true);
    // (I2) one transaction, the placing's: where it came to rest and its lid (a latch's press was the lid alone)
    const t1 = w.undoStack().at(-1)!;
    expect(t1.entries.filter((e) => e.field === OPEN)).toEqual([expect.objectContaining({ target: 'crate-3', field: OPEN, before: false, after: true })]);
    expect(t1.entries.every((e) => e.target === 'crate-3')).toBe(true);
    t.run(30);
    const n = w.undoStack().length;
    putOn(w, t, 'crate-3', CLEAR);
    t.run(30);
    expect(isOpen(w, 'crate-3')).toBe(false);
    // (I2) shut by the lift, not by a latch
    expect(t.of('crate.shut').map((x) => x.e)).toContainEqual({ type: 'crate.shut', id: 'crates', crate: 'crate-3', project: 't-components', why: 'grab' });
    expect(w.undoStack().length).toBe(n + 1);
    w.dispatch({ type: 'undo' });
    t.run(30);
    expect(isOpen(w, 'crate-3')).toBe(true);
    w.dispatch({ type: 'undo' });
    t.run(30);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.writer('crate-3', OPEN)).toBe('settled');
    w.dispose();
  }, 60_000);

  test('"Reset the workshop" shuts every open crate', { timeout: 60_000 }, async () => {
    const w = await benchWorld('pc-reset', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    openOnStand(w, t, 'crate-3');
    t.run(5);
    expect(isOpen(w, 'crate-3')).toBe(true);
    w.dispatch({ type: 'reset' });
    t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.undoStack()).toEqual([]);
    w.dispose();
  });

  test('it does not open in Fetch\'s hands, nor under another crate; the plate does nothing while it is shut', async () => {
    const w = await benchWorld('pc-refuse', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    expect(w.mode('crate-4')).toBe('crew'); // Fetch starts with it in its hands
    // (I2) what were latch presses, and a double-click on each: nothing answers (the stand is the one way)
    press(w, 'crate-4-lid');
    press(w, 'crate-1-lid'); // crate-2 stands on it
    w.dispatch({ type: 'select', id: 'crate-4' });
    w.dispatch({ type: 'select', id: 'crate-1' });
    press(w, 'crate-3-plate');
    const ev = t.run(1);
    expect(isOpen(w, 'crate-4')).toBe(false);
    expect(isOpen(w, 'crate-1')).toBe(false);
    expect(ev.some((e) => e.type === 'crate.plate' || e.type === 'crate.opened')).toBe(false);
    expect(w.undoStack()).toEqual([]);
    // the one on top of the stack, set on the stand, opens; with it open, its plate says so
    openOnStand(w, t, 'crate-2');
    expect(isOpen(w, 'crate-2')).toBe(true);
    press(w, 'crate-2-plate');
    expect(t.run(1)).toContainEqual({ type: 'crate.plate', id: 'crates', crate: 'crate-2', project: 'reports' });
    w.dispose();
  }, 60_000);

  test('picked up while open, it claps shut, under the letting go: one pull of the lever puts it back where it was, open', async () => {
    const w = await benchWorld('pc-grab', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    openOnStand(w, t, 'crate-3');
    t.run(10);
    // (I2) where it was: open, on the stand
    const was = w.motion('crate-3')!.pose.p;
    putOn(w, t, 'crate-3', [-0.2, 0, -1.2]);
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(t.of('crate.shut').map((x) => x.e.why)).toEqual(['grab']);
    // (D2d) shut by anything but its latch: it gives back the look at its card
    expect(t.of('look.back').map((x) => (x.e as { target: string }).target)).toEqual(['crate-3-card']);
    const top = w.undoStack().at(-1)!;
    expect(top.entries.map((e) => e.field).sort()).toEqual(['location', OPEN]);
    w.dispatch({ type: 'undo' });
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(p[0] - was[0], p[2] - was[2])).toBeLessThan(0.05);
    w.dispose();
  }, 60_000);

  test('something set on an open crate claps it shut; a crate set moving claps shut; nothing is ever left open in a machine', async () => {
    const w = await benchWorld('pc-burden', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    openOnStand(w, t, 'crate-3');
    t.run(10);
    const p = w.motion('crate-3')!.pose.p;
    // crate-2 (M) off the stack and onto it
    putOn(w, t, 'crate-2', [p[0], p[1] + w.halfExtents('crate-3')![1], p[2]]);
    t.run(2 * HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    // (I2) on the stand a crate set on top is the stand's to answer: it hands the open one off, shut ('machine'), where
    // off the stand it was a burden ('burden'); the look at its card is given back either way
    expect(t.of('crate.shut').map((x) => x.e.why)).toContain('machine');
    expect(t.of('look.back').map((x) => (x.e as { target: string }).target)).toContain('crate-3-card');
    // and a part that is not a crate set on the open crate (a tool off the wall): it claps shut (on the stand the crates'
    // burden rule stands back for the stand's; what shuts it there is that it is knocked from square, 'moved')
    const w3 = await benchWorld('pc-burden-tool', { scene: BENCH });
    const t3 = tape(w3);
    t3.run(30);
    openOnStand(w3, t3, 'crate-3');
    t3.run(30);
    const tool = [...w3.parts()].find((x) => x.kind === 'tool' && x.id.startsWith('tool-'))!.id;
    const p3 = w3.motion('crate-3')!.pose.p;
    putOn(w3, t3, tool, [p3[0], p3[1] + w3.halfExtents('crate-3')![1], p3[2]]);
    t3.run(2 * HZ);
    expect(isOpen(w3, 'crate-3')).toBe(false);
    expect(t3.of('crate.shut').map((x) => x.e.why)).toEqual(['moved']);
    expect(t3.of('look.back').map((x) => (x.e as { target: string }).target)).toContain('crate-3-card');
    w3.dispose();
    // every step of a busy minute on the whole bench: no crate is open unless it lies free
    const w2 = await benchWorld('pc-machine', { scene: FULL_BENCH });
    const t2 = tape(w2);
    t2.run(30);
    openOnStand(w2, t2, 'crate-3');
    t2.run(10);
    putOn(w2, t2, 'crate-1', CLEAR); // the stack's bottom crate off it: now crate-2 is the top and free (I2: the old spot was on the stand)
    // (I2) crate-2 onto the stand: it hands crate-3 off, shut, and opens
    openOnStand(w2, t2, 'crate-2');
    t2.run(1);
    for (let i = 0; i < steps(60); i++) {
      t2.run(1);
      for (const id of SIX) if (isOpen(w2, id)) expect(['free', 'held'], `${id} open while ${w2.mode(id)}`).toContain(w2.mode(id));
    }
    w.dispose();
    w2.dispose();
  }, 120_000);

  test('Revert leaves an open crate alone; shut again, it is the visitor\'s and is swept as any handled crate is', async () => {
    const w = await benchWorld('pc-revert', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(30);
    openOnStand(w, t, 'crate-3');
    t.run(1);
    const at = w.motion('crate-3')!.pose.p;
    const swept = (ev: SimEvent[]): boolean => ev.some((e) => (e.type === 'revert.sweep' || e.type === 'put-away') && ('part' in e ? e.part : e.id) === 'crate-3');
    let gone = false;
    for (let i = 0; i < steps(90); i++) if (swept(t.run(1))) gone = true;
    expect(gone).toBe(false);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(p[0] - at[0], p[2] - at[2])).toBeLessThan(0.05);
    w.dispose();
  }, 120_000);
});

describe('a visit remembers which crates were open', () => {
  test('saved() lists the open crates; a world made from it starts with them open (where they can be), and reset shuts them', async () => {
    const w = await benchWorld('pc-save', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    expect(w.saved().open).toBeUndefined();
    openOnStand(w, t, 'crate-3');
    t.run(1);
    expect(t.run(1).length >= 0 && w.saved().open).toEqual(['crate-3']);
    const text = JSON.stringify({ ...w.saved(), open: ['crate-3', 'crate-1', 'crate-4', 'not-a-crate'] });
    const saved = parseSaved(text);
    expect(saved?.open).toEqual(['crate-3', 'crate-1', 'crate-4', 'not-a-crate']);
    w.dispose();
    // the loose crate opens; the one under another and the one in Fetch's hands stay shut; an unknown id is dropped
    // (I2: on the bench without the stand, where a crate can be open where the scene puts it)
    const w2 = await benchWorld('pc-save-2', { scene: withoutOpeningStand(BENCH), saved: saved! });
    expect(isOpen(w2, 'crate-3')).toBe(true);
    expect(isOpen(w2, 'crate-1')).toBe(false);
    expect(isOpen(w2, 'crate-4')).toBe(false);
    expect(w2.writer('crate-3', OPEN)).toBe('settled');
    expect(w2.undoStack()).toEqual([]);
    const t2 = tape(w2);
    t2.run(5);
    w2.dispatch({ type: 'reset' });
    t2.run(1);
    expect(isOpen(w2, 'crate-3')).toBe(false);
    expect(w2.saved().open).toBeUndefined();
    // (I2) with the stand a crate is open only on it, and none starts there: the visit begins with every crate shut, and
    // nothing claps shut as the page comes up (it had opened at its start place and shut at once, "moved")
    const w3 = await benchWorld('pc-save-3', { scene: BENCH, saved: saved! });
    for (const id of SIX) expect(isOpen(w3, id)).toBe(false);
    const t3 = tape(w3);
    t3.run(120);
    expect(t3.of('crate.shut')).toEqual([]);
    expect(t3.of('look.back')).toEqual([]);
    expect(w3.undoStack()).toEqual([]);
    w3.dispose();
    // and a snapshot from before P4 (no `open`) still reads
    expect(parseSaved(JSON.stringify({ v: 1, button: { rung: 0, reached: 0, presses: 0, cover: 'none', deck: { left: [], last: null } }, used: [] }))).not.toBeNull();
    expect(parseSaved(JSON.stringify({ v: 1, button: { rung: 0, reached: 0, presses: 0, cover: 'none', deck: { left: [], last: null } }, used: [], open: 'crate-3' }))).toBeNull();
    w2.dispose();
  }, 60_000);
});

describe('a place for a thing (the development stand-in in t-components\' crate)', () => {
  const block = STAND_IN_THING;
  // (I2) a thing taken off its tray is the stand's other way (`things: 'loose'`, LOOSE_BENCH): on the shipped bench it
  // never leaves the tray (tests/scenario/opening-stand.test.ts, "things fixed")
  test('shut, the thing is not in the world; open, it sits on the tray; taken off it is a loose part; set back on it is stowed; reset stows it', async () => {
    const w = await benchWorld('pc-thing', { scene: withStandIn(LOOSE_BENCH) });
    const t = tape(w);
    t.run(30);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('gone');
    openOnStand(w, t, 'crate-3');
    t.run(2);
    expect(w.mode(block)).toBe('machine');
    const c = w.motion('crate-3')!.pose.p;
    const b = w.motion(block)!.pose.p;
    expect(b[1]).toBeGreaterThan(c[1] + w.halfExtents('crate-3')![1]);
    expect(Math.hypot(b[0] - c[0], b[2] - c[2])).toBeLessThan(w.halfExtents('crate-3')![2]);
    // taken off and set on the bench: a loose part, at rest there; the crate stays open
    putOn(w, t, block, [-0.4, 0, -1.0]);
    t.run(HZ);
    expect(w.part(block)!.location.at).toBe('rest');
    expect(w.mode(block)).toBe('free');
    expect(isOpen(w, 'crate-3')).toBe(true);
    // the lever puts it back on the tray
    w.dispatch({ type: 'undo' });
    t.run(2);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('machine');
    // off again; the crate shut while it is out (I2: lifted off the stand, where a latch shut it); opened again, and the
    // thing set back on it: stowed
    putOn(w, t, block, [-0.4, 0, -1.0]);
    t.run(HZ);
    putOn(w, t, 'crate-3', CLEAR);
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.mode(block)).toBe('free');
    openOnStand(w, t, 'crate-3');
    t.run(2);
    const c2 = w.motion('crate-3')!.pose.p;
    const top: Vec3 = [c2[0], c2[1] + w.halfExtents('crate-3')![1], c2[2]];
    putOn(w, t, block, top);
    t.run(HZ);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('machine');
    // (I2) shut with the thing on its tray (lifted off the stand): it goes in with it
    putOn(w, t, 'crate-3', CLEAR);
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.mode(block)).toBe('gone');
    // out on the bench, then reset: stowed, the crate shut
    openOnStand(w, t, 'crate-3');
    t.run(2);
    putOn(w, t, block, [-0.4, 0, -1.0]);
    t.run(HZ);
    w.dispatch({ type: 'reset' });
    t.run(2);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('gone');
    expect(isOpen(w, 'crate-3')).toBe(false);
    w.dispose();
  }, 60_000);

  test('the open crate picked up with its thing on the tray: the lid claps shut and the thing goes in with it; nothing is lost', async () => {
    // (I2) on the shipped bench (the thing fixed on its tray): the crate is what a hand lifts
    const w = await benchWorld('pc-thing-carry', { scene: withStandIn(BENCH) });
    const t = tape(w);
    t.run(30);
    openOnStand(w, t, 'crate-3');
    t.run(2);
    expect(w.mode(block)).toBe('machine');
    putOn(w, t, 'crate-3', [-0.3, 0, -1.2]);
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.mode(block)).toBe('gone');
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    w.dispatch({ type: 'undo' });
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(w.mode(block)).toBe('machine');
    w.dispose();
  }, 60_000);
});

// (I2) Round two's "asked for by itself" (a double-click or double-tap opened a crate and asked to be looked at) is gone
// with the stand: the owner's own complaint (a crate caught and caught again opened). What it proved is said here of
// the one way left: set on the stand, a crate opens and asks to be looked at; a request opens nothing anywhere; a crate
// taken from Fetch's arms opens on the stand, and shut by anything but a hand gives the look back.
describe('round two, with the stand: a crate set on it asks to be looked at; asked for by itself, nothing opens', () => {
  test('set on the stand a crate opens and emits look; a select on it or on anything else opens nothing and asks nothing; lifted off it gives the look back', async () => {
    const w = await benchWorld('pc-select', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'select', id: 'crate-3' });
    let ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(ev.some((e) => e.type === 'look' || e.type === 'crate.opened')).toBe(false);
    const from = t.events.length;
    openOnStand(w, t, 'crate-3');
    expect(t.events.slice(from).map((x) => x.e)).toContainEqual({ type: 'look', target: 'crate-3-card' });
    w.dispatch({ type: 'select', id: 'crate-3' });
    ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(ev.some((e) => e.type === 'crate.shut' || e.type === 'look.back')).toBe(false);
    w.dispatch({ type: 'select', id: 'fetch' });
    ev = t.run(1);
    expect(ev.some((e) => e.type === 'look' || e.type === 'crate.opened')).toBe(false);
    const n = t.events.length;
    putOn(w, t, 'crate-3', CLEAR);
    t.run(30);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(t.events.slice(n).some((x) => x.e.type === 'look.back' && (x.e as { target: string }).target === 'crate-3-card')).toBe(true);
    w.dispose();
  }, 60_000);

  test('(D2d) the crate in Fetch\'s arms, asked for: nothing opens; taken from his arms and set on the stand, it opens and asks to be looked at', async () => {
    const w = await benchWorld('pc-fetch-back', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    expect(w.mode('crate-4')).toBe('crew');
    // the double-click as the page sends it: its first tap takes the crate from Fetch's arms, its second asks for it
    w.dispatch({ type: 'grab', id: 'crate-4', grip: w.motion('crate-4')!.pose.p });
    t.run(2);
    w.dispatch({ type: 'select', id: 'crate-4' });
    t.run(2 * HZ);
    expect(isOpen(w, 'crate-4')).toBe(false);
    expect(t.of('look')).toEqual([]);
    if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(HZ);
    openOnStand(w, t, 'crate-4');
    expect(t.of('look').map((x) => (x.e as { target: string }).target)).toContain('crate-4-card');
    expect(t.of('crate.shut').map((x) => x.e.why)).not.toContain('press');
    w.dispose();
  }, 60_000);

  test('a double-tap\'s first tap lifted the crate (and the lift carried it toward the visitor): asked for, nothing opens; let go over the stand it opens there', async () => {
    const w = await benchWorld('pc-select-held', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const p = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
    w.dispatch({ type: 'carry', target: [p[0], p[1] + 0.35, p[2] + 0.45] });
    t.run(8);
    w.dispatch({ type: 'select', id: 'crate-3' });
    t.run(steps(1.5));
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(t.of('look')).toEqual([]);
    if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(HZ);
    openOnStand(w, t, 'crate-3');
    expect(t.of('look').map((x) => x.e.target)).toEqual(['crate-3-card']);
    w.dispose();
  }, 60_000);
});
