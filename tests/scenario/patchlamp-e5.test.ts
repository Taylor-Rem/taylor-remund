// REWRITE.md § E5's worked examples and named cases that name Patch or a text (S3), with the real
// line, Patch, the platen and the belt on the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, waitFor } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { answer, patchView, plug, send, shopView, textAndWait, traySpot, untilPatch } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Location, Vec3 } from '../../src/workshop/sim/types.ts';
import { renderReply } from '../../src/content/texts.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

/** A short drag: pick `id` up, carry it toward `to` for `n` steps, let go still. One release transaction. */
function drag(w: World, t: Tape, id: Id, to: Vec3, n = 20): void {
  const p = w.motion(id)!.pose.p;
  w.dispatch({ type: 'grab', id, grip: p });
  t.run(1);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    w.dispatch({ type: 'carry', target: [p[0] + (to[0] - p[0]) * k, p[1] + 0.6, p[2] + (to[2] - p[2]) * k] });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  t.run(1);
}

/** Run until nothing moves in any release window (at most six seconds, § E5 rule 4). */
function settle(w: World, t: Tape): void {
  for (let i = 0; i < 7 * HZ && w.undoStack().some((x) => x.moving.length > 0); i++) t.run(1);
  t.run(2);
}

const lever = (w: World, t: Tape): void => {
  w.dispatch({ type: 'undo' });
  t.run(1);
};

/** A crate on the platen's tray, taken in. */
async function withCrateOnTray(): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld();
  const t = tape(w);
  t.run(30);
  putOn(w, t, 'crate-3', traySpot(), 120);
  if (!waitFor(w, t, 'crate-3', 'in')) throw new Error('crate-3 not taken in by the platen');
  plug(w, t, 'jack-platen');
  t.run(5);
  return { w, t };
}

const restPose = (w: World, id: Id): Location => w.part(id)!.location;

describe('§ E5 worked examples that name Patch or a text', () => {
  test('texts "make it blue" with a crate on the platen, then at once drags a different crate away: the lever undoes the drag first, then the paint', async () => {
    const { w, t } = await withCrateOnTray();
    const before = restPose(w, 'crate-2');
    const n = send(w, t, 'make it blue');
    const t1 = w.undoStack().at(-1)!;
    expect(t1).toMatchObject({ kind: 'text', subject: 'jack-platen', entries: [], pending: ['line'] });
    drag(w, t, 'crate-2', [-6.5, 0, -0.5]);
    t.run(20);
    const t2 = w.undoStack().at(-1)!;
    expect(t2.kind).toBe('release');
    expect(w.part('crate-3')!.colour).toBe('bare'); // T1: nothing yet, Patch is working
    expect(answer(t, n).e.type).toBe('line.reply');
    settle(w, t);
    expect(w.undoStack().at(-1)!.entries.map((e) => `${e.target}.${e.field}`)).toEqual(['crate-2.location']);
    expect(w.part('crate-3')!.colour).toBe('paint-blue');
    expect(w.writer('crate-3', 'colour')).toBe(t1.id); // charged to the text, however long Patch took
    lever(w, t); // the later action: the crate hops back
    expect(restPose(w, 'crate-2')).toEqual(before);
    expect(w.part('crate-3')!.colour).toBe('paint-blue');
    lever(w, t); // then the paint drains
    expect(w.part('crate-3')!.colour).toBe('bare');
    expect(w.writer('crate-3', 'colour')).toBe('settled');
  });

  test('"make it blue", then "make it red", at the same crate: each pull, or each "undo that", restores what its own text found', async () => {
    for (const how of ['lever', 'text'] as const) {
      const { w, t } = await withCrateOnTray();
      answer(t, send(w, t, 'make it blue'));
      const t1 = w.writer('crate-3', 'colour');
      answer(t, send(w, t, 'make it red'));
      const t2 = w.writer('crate-3', 'colour');
      const entry = w.undoStack().find((x) => x.id === t2)!.entries.find((e) => e.field === 'colour')!;
      expect(entry).toMatchObject({ before: 'paint-blue', previousWriter: t1, after: 'cable-red' });
      if (how === 'lever') lever(w, t);
      else expect(textAndWait(w, t, 'undo that').words).toBe('Put it back. I checked.');
      expect(w.part('crate-3')!.colour).toBe('paint-blue');
      expect(w.writer('crate-3', 'colour')).toBe(t1);
      if (how === 'lever') lever(w, t);
      else expect(textAndWait(w, t, 'undo that').words).toBe('Put it back. I checked.');
      expect(w.part('crate-3')!.colour).toBe('bare');
      expect(w.writer('crate-3', 'colour')).toBe('settled');
    }
  });

  test('"faster" to the belt, the dial by hand, then "undo that": nothing changes and Patch says so; the lever then gives 2, then 1 (here 4, then 3)', async () => {
    const w = await benchWorld();
    const t = tape(w);
    plug(w, t, 'jack-belt');
    expect(w.setting('belt', 'speed')).toBe(3);
    expect(textAndWait(w, t, 'faster').words).toBe("Belt's faster. I checked. Patched.");
    const t1 = w.writer('belt', 'speed');
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(1);
    expect(w.setting('belt', 'speed')).toBe(5);
    const stack = JSON.stringify(w.undoStack());
    const undo = textAndWait(w, t, 'undo that');
    expect(undo.e.type).toBe('line.reply');
    expect(undo.words).toBe('Something else changed it since, so I left it alone. The lever takes things back in order.');
    expect(w.setting('belt', 'speed')).toBe(5);
    expect(JSON.stringify(w.undoStack())).toBe(stack); // no value and no stack entry changed
    lever(w, t);
    expect(w.setting('belt', 'speed')).toBe(4);
    expect(w.writer('belt', 'speed')).toBe(t1);
    lever(w, t);
    expect(w.setting('belt', 'speed')).toBe(3);
  });

  test('paints a crate by text, drags a different crate, then texts "undo that": the paint drains and the text leaves the middle of the stack; the lever still undoes the drag', async () => {
    const { w, t } = await withCrateOnTray();
    answer(t, send(w, t, 'make it violet'));
    const t1 = w.writer('crate-3', 'colour');
    drag(w, t, 'crate-2', [-6.5, 0, -0.5]);
    settle(w, t);
    const moved = restPose(w, 'crate-2');
    const t2 = w.undoStack().at(-1)!;
    expect(textAndWait(w, t, 'undo that').words).toBe('Put it back. I checked.');
    expect(w.part('crate-3')!.colour).toBe('bare');
    expect(w.undoStack().map((x) => x.id)).not.toContain(t1);
    expect(w.undoStack().at(-1)!.id).toBe(t2.id);
    expect(w.undoStack().at(-1)!.entries).toEqual(t2.entries);
    expect(restPose(w, 'crate-2')).toEqual(moved);
    lever(w, t);
    expect(restPose(w, 'crate-2')).not.toEqual(moved);
  });

  test('"make the sign red", then the lever while Patch is still reaching for the drawer: the job is cancelled, nothing changes, Patch looks at the lever', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const n = send(w, t, 'make the sign red');
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    const tx = w.undoStack().at(-1)!;
    expect(tx).toMatchObject({ kind: 'text', entries: [], pending: ['line'] });
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    expect(ev.find((e) => e.type === 'undone')).toMatchObject({ txn: tx.id, by: 'lever', restores: [], cancelled: ['line'] });
    expect(answer(t, n).e).toMatchObject({ type: 'line.refused', reason: 'cancelled' });
    expect(renderReply(answer(t, n).e.reply)).toBe('Taken back. Nothing changed.');
    expect(patchView(w)).toMatchObject({ state: 'look', lookAt: [-3.7, 1.5, -1.9] });
    expect(w.undoStack()).toEqual([]);
    t.run(3 * HZ);
    expect(shopView(w).sign).toBe('paint-green');
    expect(patchView(w).state).toBe('seated');
  });

  test('late-commit-dropped: "faster" still pending, the dial by hand, then Patch reaches the job: it commits nothing and says it was changed since', async () => {
    const w = await benchWorld();
    const t = tape(w);
    plug(w, t, 'jack-belt');
    const n = send(w, t, 'faster');
    t.run(10);
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
    t.run(1);
    const t2 = w.writer('belt', 'speed');
    expect(w.setting('belt', 'speed')).toBe(1);
    const a = answer(t, n);
    expect(a.e).toMatchObject({ type: 'line.refused', reason: 'changed-since' });
    expect(renderReply(a.e.reply)).toBe('That changed before I got to it, so I left it alone.');
    expect(w.setting('belt', 'speed')).toBe(1);
    expect(w.writer('belt', 'speed')).toBe(t2);
    lever(w, t);
    expect(w.setting('belt', 'speed')).toBe(3);
    expect(w.undoStack().map((x) => x.kind)).toEqual(['plug']); // only the cord's move to the belt's jack is left
  });
});
