// P4 S5: the crates are Taylor's projects. Six crates circulate as themselves; each opens by its latch (one effect,
// undone by the lever and by "Reset the workshop", remembered by the visit); the lid claps shut first whenever the crate
// is picked up, taken, knocked or burdened; Revert leaves an open crate alone; a crate's thing sits on its tray while it
// is open (proved with the development stand-in).
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, FULL_BENCH, BENCH } from './line-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { PROJECT_CRATES, STAND_IN_THING, withStandIn } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import { parseSaved } from '../../src/workshop/sim/saved.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const isOpen = (w: World, id: Id): boolean => w.setting(id, OPEN) === true;
const press = (w: World, id: Id): void => w.dispatch({ type: 'press', id });
const SIX = PROJECT_CRATES.map((c) => c.crate);

describe('the six project crates', () => {
  test('the bench has exactly six crates, each a project with a latch and a plate in the registry', async () => {
    const w = await benchWorld('pc-six', { scene: FULL_BENCH });
    const crates = [...w.parts()].filter((p) => p.kind === 'crate').map((p) => p.id);
    expect(crates.sort()).toEqual([...SIX].sort());
    expect(new Set(PROJECT_CRATES.map((c) => c.project)).size).toBe(6);
    for (const c of PROJECT_CRATES) {
      expect(w.interactable(c.lid)?.affordances).toContain('press');
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

describe('the latch', () => {
  test('a press opens it (one effect, the press\'s own transaction), a press shuts it; the lever takes each back', async () => {
    const w = await benchWorld('pc-latch', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    press(w, 'crate-3-lid');
    const ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(ev).toContainEqual({ type: 'crate.opened', id: 'crates', crate: 'crate-3', project: 't-components' });
    expect(ev.filter((e) => e.type === 'effect' && e.effect.target === 'crate-3')).toHaveLength(1);
    expect(w.touched('crate-3')).toBe(true);
    const t1 = w.undoStack().at(-1)!;
    expect(t1.entries).toEqual([expect.objectContaining({ target: 'crate-3', field: OPEN, before: false, after: true })]);
    t.run(30);
    press(w, 'crate-3-lid');
    const ev2 = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(ev2).toContainEqual({ type: 'crate.shut', id: 'crates', crate: 'crate-3', project: 't-components', why: 'press' });
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.writer('crate-3', OPEN)).toBe('settled');
    w.dispose();
  });

  test('"Reset the workshop" shuts every open crate', async () => {
    const w = await benchWorld('pc-reset', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    press(w, 'crate-3-lid');
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
    press(w, 'crate-4-lid');
    press(w, 'crate-1-lid'); // crate-2 stands on it
    press(w, 'crate-3-plate');
    const ev = t.run(1);
    expect(isOpen(w, 'crate-4')).toBe(false);
    expect(isOpen(w, 'crate-1')).toBe(false);
    expect(ev.some((e) => e.type === 'crate.plate' || e.type === 'crate.opened')).toBe(false);
    expect(w.undoStack()).toEqual([]);
    // the one on top of the stack opens; with it open, its plate says so
    press(w, 'crate-2-lid');
    t.run(1);
    expect(isOpen(w, 'crate-2')).toBe(true);
    press(w, 'crate-2-plate');
    expect(t.run(1)).toContainEqual({ type: 'crate.plate', id: 'crates', crate: 'crate-2', project: 'reports' });
    w.dispose();
  });

  test('picked up while open, it claps shut, under the letting go: one pull of the lever puts it back where it was, open', async () => {
    const w = await benchWorld('pc-grab', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const was = w.motion('crate-3')!.pose.p;
    press(w, 'crate-3-lid');
    t.run(10);
    putOn(w, t, 'crate-3', [-0.2, 0, -1.2]);
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(t.of('crate.shut').map((x) => x.e.why)).toEqual(['grab']);
    const top = w.undoStack().at(-1)!;
    expect(top.entries.map((e) => e.field).sort()).toEqual(['location', OPEN]);
    w.dispatch({ type: 'undo' });
    t.run(HZ);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(p[0] - was[0], p[2] - was[2])).toBeLessThan(0.05);
    w.dispose();
  });

  test('something set on an open crate claps it shut; a crate set moving claps shut; nothing is ever left open in a machine', async () => {
    const w = await benchWorld('pc-burden', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    press(w, 'crate-3-lid');
    t.run(10);
    const p = w.motion('crate-3')!.pose.p;
    // crate-2 (M) off the stack and onto it
    putOn(w, t, 'crate-2', [p[0], p[1] + w.halfExtents('crate-3')![1], p[2]]);
    t.run(2 * HZ);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(t.of('crate.shut').map((x) => x.e.why)).toContain('burden');
    // every step of a busy minute on the whole bench: no crate is open unless it lies free
    const w2 = await benchWorld('pc-machine', { scene: FULL_BENCH });
    const t2 = tape(w2);
    t2.run(30);
    press(w2, 'crate-3-lid');
    t2.run(10);
    putOn(w2, t2, 'crate-1', [-1.0, 0, 0.6]); // the stack's bottom crate off it: now crate-2 is the top and free
    press(w2, 'crate-2-lid');
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
    press(w, 'crate-3-lid');
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
    press(w, 'crate-3-lid');
    t.run(1);
    expect(t.run(1).length >= 0 && w.saved().open).toEqual(['crate-3']);
    const text = JSON.stringify({ ...w.saved(), open: ['crate-3', 'crate-1', 'crate-4', 'not-a-crate'] });
    const saved = parseSaved(text);
    expect(saved?.open).toEqual(['crate-3', 'crate-1', 'crate-4', 'not-a-crate']);
    w.dispose();
    const w2 = await benchWorld('pc-save-2', { scene: BENCH, saved: saved! });
    // the loose crate opens; the one under another and the one in Fetch's hands stay shut; an unknown id is dropped
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
    // and a snapshot from before P4 (no `open`) still reads
    expect(parseSaved(JSON.stringify({ v: 1, button: { rung: 0, reached: 0, presses: 0, cover: 'none', deck: { left: [], last: null } }, used: [] }))).not.toBeNull();
    expect(parseSaved(JSON.stringify({ v: 1, button: { rung: 0, reached: 0, presses: 0, cover: 'none', deck: { left: [], last: null } }, used: [], open: 'crate-3' }))).toBeNull();
    w2.dispose();
  });
});

describe('a place for a thing (the development stand-in in t-components\' crate)', () => {
  const block = STAND_IN_THING;
  test('shut, the thing is not in the world; open, it sits on the tray; taken off it is a loose part; set back on it is stowed; reset stows it', async () => {
    const w = await benchWorld('pc-thing', { scene: withStandIn(BENCH) });
    const t = tape(w);
    t.run(30);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('gone');
    press(w, 'crate-3-lid');
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
    // off again; the crate shut while it is out; opened again, and the thing set back on it: stowed
    putOn(w, t, block, [-0.4, 0, -1.0]);
    t.run(HZ);
    press(w, 'crate-3-lid');
    t.run(2);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.mode(block)).toBe('free');
    press(w, 'crate-3-lid');
    t.run(2);
    const top: Vec3 = [c[0], c[1] + w.halfExtents('crate-3')![1], c[2]];
    putOn(w, t, block, top);
    t.run(HZ);
    expect(w.part(block)!.location).toMatchObject({ at: 'in', mouth: 'crate-3' });
    expect(w.mode(block)).toBe('machine');
    press(w, 'crate-3-lid');
    t.run(2);
    expect(w.mode(block)).toBe('gone');
    // out on the bench, then reset: stowed, the crate shut
    press(w, 'crate-3-lid');
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
    const w = await benchWorld('pc-thing-carry', { scene: withStandIn(BENCH) });
    const t = tape(w);
    t.run(30);
    press(w, 'crate-3-lid');
    t.run(2);
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

describe('round two: asked for by itself (a double-click or double-tap), a crate opens and asks to be looked at', () => {
  test('select on a still crate opens it and emits look; on an open one, look again; on anything else nothing; the shut press asks for no look', async () => {
    const w = await benchWorld('pc-select', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'select', id: 'crate-3' });
    let ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(ev).toContainEqual({ type: 'look', target: 'crate-3-card' });
    w.dispatch({ type: 'select', id: 'crate-3' });
    ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(ev).toContainEqual({ type: 'look', target: 'crate-3-card' });
    press(w, 'crate-3-lid');
    ev = t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(ev.some((e) => e.type === 'look')).toBe(false);
    w.dispatch({ type: 'select', id: 'fetch' });
    ev = t.run(1);
    expect(ev.some((e) => e.type === 'look' || e.type === 'crate.opened')).toBe(false);
    // the latch opens it too, and asks to be looked at
    press(w, 'crate-3-lid');
    expect(t.run(1)).toContainEqual({ type: 'look', target: 'crate-3-card' });
    w.dispose();
  });

  test('a double-tap\'s first tap lifted the crate (and the lift carried it toward the visitor): asked for, it goes back where it lay and opens there', async () => {
    const w = await benchWorld('pc-select-held', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    const p = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
    w.dispatch({ type: 'carry', target: [p[0], p[1] + 0.35, p[2] + 0.45] });
    t.run(8);
    w.dispatch({ type: 'select', id: 'crate-3' });
    t.run(1);
    expect(w.mode('crate-3')).not.toBe('held');
    for (let i = 0; i < steps(1.5) && !isOpen(w, 'crate-3'); i++) t.run(1);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(t.of('look').map((x) => x.e.target)).toEqual(['crate-3-card']);
    const q = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(q[0] - p[0], q[2] - p[2])).toBeLessThan(0.1);
    w.dispose();
  });
});
