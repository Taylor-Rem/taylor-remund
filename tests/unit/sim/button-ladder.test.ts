// The Button's four rungs, its cover and its deck (REWRITE.md § B4; S4), on the bench with the stub
// physics: every rung's script, step by step, and the bracket's promise that the world after a rung is
// the world before it, except the rung and the count.
import { describe, expect, test } from 'vitest';
import { stubWorld, run, types } from './helpers.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { BUTTON_TUNING, DECK, RUNG_SCRIPTS, cardFor, scriptFor } from '../../../src/workshop/sim/machines/button.ts';
import type { ButtonSaved } from '../../../src/workshop/sim/machines/button.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import type { Pose, SimEvent } from '../../../src/workshop/sim/types.ts';

const benchStub = (saved?: ButtonSaved) => stubWorld(1, { scene: bench, ...(saved ? { button: saved as { rung: number; presses: number } } : {}) });
const poses = (w: World): [string, Pose][] => [...w.parts()].map((p) => [p.id, w.motion(p.id)!.pose]);
const press = (w: World, id = 'button'): SimEvent[] => {
  w.dispatch({ type: 'press', id });
  return run(w, 1);
};
/** Press, and run until the rung is over (and one step more). */
function rung(w: World): SimEvent[] {
  const out = press(w);
  for (let i = 0; i < 2000 && w.bracketed; i++) out.push(...run(w, 1));
  return out;
}
/** Lift the cover if it is shut, then play a rung. */
function playThrough(w: World): SimEvent[] {
  if (w.button().cover === 'fitting') run(w, steps(BUTTON_TUNING.fit) + 1);
  if (w.button().cover === 'shut') press(w);
  return rung(w);
}
/** The ladder's stations a hiccup may choose, nearest the Button's cap first (from the scene: the layout still moves). */
const HICCUP_ORDER: string[] = (() => {
  const L = bench.button.ladder!;
  const at = bench.button.at;
  return L.stations
    .filter((s) => s.id !== L.lamp && !bench.button.flinch.includes(s.id))
    .map((s) => ({ id: s.id, d: Math.hypot(s.at[0] - at[0], s.at[2] - at[2]) }))
    .sort((a, b) => a.d - b.d)
    .map((s) => s.id);
})();
const nearer = (a: string, b: string): string[] => {
  const L = bench.button.ladder!;
  const d = (id: string) => {
    const s = L.stations.find((x) => x.id === id)!;
    return Math.hypot(s.at[0] - bench.button.at[0], s.at[2] - bench.button.at[2]);
  };
  return d(a) <= d(b) ? [a, b] : [b, a];
};
const beats = (ev: readonly SimEvent[]) => ev.flatMap((e) => (e.type === 'rung.beat' ? [e] : []));
const misfires = (ev: readonly SimEvent[]) => ev.flatMap((e) => (e.type === 'misfire' ? [`${e.id}:${e.level}`] : []));

describe('each rung as data (scriptFor)', () => {
  test('rung lengths are § B4\'s: the flinch 3 s, the hiccup 4 s, the works 7 s with its run backwards', () => {
    expect(RUNG_SCRIPTS[1].play).toBe(BUTTON_TUNING.flinch);
    expect(RUNG_SCRIPTS[1].rewind).toBe(BUTTON_TUNING.rewind);
    expect(RUNG_SCRIPTS[2].play).toBe(4);
    expect(RUNG_SCRIPTS[4].play + RUNG_SCRIPTS[4].rewind).toBe(7);
  });

  test('every script: beats in time order, a rewind at `play`, the card at the end; reduced motion is the dip and the card', () => {
    for (const r of [1, 2, 3, 4] as const) {
      const s = scriptFor(r);
      const at = s.beats.map((b) => b.at);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(s.beats.find((b) => b.kind === 'rewind')).toMatchObject({ at: s.play, duration: s.rewind });
      expect(s.beats.find((b) => b.kind === 'card')?.at).toBeCloseTo(s.play + s.rewind, 9);
      expect(s.beats.some((b) => b.kind === 'revert')).toBe(true);
      const q = scriptFor(r, true);
      expect(q.reduced).toBe(true);
      expect(new Set(q.beats.map((b) => b.kind))).toEqual(new Set(r === 3 ? ['dip', 'rewind', 'card', 'cover'] : ['dip', 'rewind', 'card']));
    }
    expect(RUNG_SCRIPTS[1].beats.map((b) => b.kind)).toEqual(['flinch', 'shove', 'revert', 'rewind', 'card']);
    expect(RUNG_SCRIPTS[2].beats.map((b) => b.kind)).toEqual(['flinch', 'shove', 'revert', 'hiccup', 'rewind', 'card']);
    expect(RUNG_SCRIPTS[3].beats.map((b) => b.kind)).toEqual(['dip', 'revert', 'hiccup', 'rewind', 'card', 'cover']);
    expect(RUNG_SCRIPTS[4].beats.map((b) => b.kind)).toEqual(['dip', 'shake', 'warning', 'revert', 'works', 'sparks', 'stack', 'rewind', 'card']);
  });
});

describe('the ladder on the bench', () => {
  test('rung 1: the flinch, as built in P1, bracketed; the card is rung 1\'s', () => {
    const { world } = benchStub();
    run(world, 10);
    const durable = world.durable();
    const ev = rung(world);
    expect(misfires(ev)).toEqual(['lamp:1', 'belt:1']);
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: cardFor(1) });
    expect(world.durable()).toEqual(durable);
    expect(world.button()).toMatchObject({ rung: 1, reached: 1, presses: 1, phase: 'idle', cover: 'none' });
  });

  test('rung 2: as rung 1, and the nearest station the visitor has not used misfires once, at its beat', () => {
    const { world } = benchStub();
    run(world, 10);
    rung(world);
    const before = world.durable();
    const t0 = world.step + 1;
    const out: { step: number; e: SimEvent }[] = [];
    world.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 2000 && (i === 0 || world.bracketed); i++) for (const e of run(world, 1)) out.push({ step: world.step, e });
    const ev = out.map((x) => x.e);
    expect(world.button()).toMatchObject({ rung: 2, reached: 2 });
    // nearest to the Button's cap, of the stations not used (not the flinch's lamp and belt): the striker strikes air
    const first = HICCUP_ORDER[0]!;
    expect(world.button().targets).toEqual([first]);
    const hic = out.find((x) => x.e.type === 'misfire' && x.e.id === first);
    expect(hic?.step).toBe(t0 + steps(BUTTON_TUNING.hiccupAt));
    expect(misfires(ev)).toEqual(['lamp:1', 'belt:1', `${first}:1`]);
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: cardFor(2) });
    expect(world.durable()).toEqual(before);
  });

  test('the hiccups skip what the visitor has used, and rung 3 never repeats rung 2\'s station', () => {
    const fresh = benchStub().world;
    run(fresh, 10);
    for (let i = 0; i < 3; i++) rung(fresh);
    expect(fresh.button().targets).toEqual([HICCUP_ORDER[1]]);
    const rest = HICCUP_ORDER.filter((id) => id !== 'undo-lever');
    const { world } = benchStub();
    run(world, 10);
    press(world, 'undo-lever');
    run(world, 30);
    expect(world.button().used).toEqual(['undo-lever']);
    rung(world);
    rung(world);
    expect(world.button().targets).toEqual([rest[0]]);
    rung(world);
    expect(world.button().targets).toEqual([rest[1]]);
  });

  test('rung 3: a different unused station misfires; then the cover is fitted, and it changes how a press feels', () => {
    const { world } = benchStub();
    run(world, 10);
    rung(world);
    rung(world);
    const hiccup2 = world.button().targets[0];
    const ev = rung(world);
    expect(world.button().rung).toBe(3);
    const t3 = world.button().targets;
    expect(t3).toHaveLength(1);
    expect(t3[0]).not.toBe(hiccup2);
    expect(misfires(ev)).toEqual(['lamp:1', `${t3[0]}:1`]);
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: cardFor(3) });
    expect(ev).toContainEqual({ type: 'cover', id: 'button-cover', state: 'fitting' });
    // Revert fits it; then the cover is shut
    expect(world.button().cover).toBe('fitting');
    run(world, steps(BUTTON_TUNING.fit));
    expect(world.button().cover).toBe('shut');
    // a press on a shut cover lifts it, at once, and plays nothing
    const lifted = press(world);
    expect(lifted).toContainEqual({ type: 'cover', id: 'button-cover', state: 'open' });
    expect(types(lifted)).not.toContain('button.pressed');
    expect(world.bracketed).toBe(false);
    // the next press plays rung 4; when it is over the cover drops shut again
    const r4 = rung(world);
    expect(r4).toContainEqual({ type: 'button.pressed', rung: 4, presses: 4 });
    expect(r4).toContainEqual({ type: 'cover', id: 'button-cover', state: 'shut' });
    expect(world.button().cover).toBe('shut');
    // the cover is also a handle of its own: lifted and lowered by hand
    expect(press(world, 'button-cover')).toContainEqual({ type: 'cover', id: 'button-cover', state: 'open' });
    expect(press(world, 'button-cover')).toContainEqual({ type: 'cover', id: 'button-cover', state: 'shut' });
  });

  test('a press while the cover is still being fitted is not refused: it plays, and the fitting carries on', () => {
    const { world } = benchStub();
    run(world, 10);
    for (let i = 0; i < 3; i++) rung(world);
    expect(world.button().cover).toBe('fitting');
    const ev = rung(world);
    expect(ev).toContainEqual({ type: 'button.pressed', rung: 4, presses: 4 });
    // the fitting went on through the rung (the cover is the Button's own, not the bracket's)
    expect(ev).toContainEqual({ type: 'cover', id: 'button-cover', state: 'shut' });
    expect(world.button().cover).toBe('shut');
  });

  test('rung 4: every station the visitor has used misfires together, harder; the stack comes down; then it is all put back', () => {
    const { world } = benchStub();
    run(world, 10);
    // use the belt (its dial) and the cord
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 0.25 });
    world.dispatch({ type: 'unplug', cord: 'cord' });
    run(world, 1);
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    run(world, 2);
    expect(world.button().used).toEqual(['belt', 'cord']);
    rung(world);
    rung(world);
    playThrough(world);
    run(world, steps(BUTTON_TUNING.fit) + 1);
    press(world); // lift the cover
    const durable = world.durable();
    const before = poses(world);
    const stack = ['crate-1', 'crate-2', 'crate-3'].map((id) => world.motion(id)!.pose.p);
    world.dispatch({ type: 'press', id: 'button' });
    const ev: SimEvent[] = [];
    let moved = 0;
    for (let i = 0; i < 2000 && (i === 0 || world.bracketed); i++) {
      ev.push(...run(world, 1));
      ['crate-1', 'crate-2', 'crate-3'].forEach((id, k) => {
        const p = world.motion(id)!.pose.p;
        moved = Math.max(moved, Math.hypot(p[0] - stack[k]![0], p[2] - stack[k]![2]));
      });
    }
    expect(world.button()).toMatchObject({ rung: 4, reached: 4 });
    const order = nearer('belt', 'cord');
    expect(world.button().targets).toEqual(order); // nearest first
    expect(misfires(ev)).toEqual(['lamp:2', ...order.map((id) => `${id}:2`)]);
    const stackBeat = beats(ev).find((b) => b.beat === 'stack');
    expect([...stackBeat!.ids].sort()).toEqual(['crate-1', 'crate-2', 'crate-3']);
    expect(moved).toBeGreaterThan(0.1); // the stack really came down (the stub slides them only a little; Rapier: tests/scenario/rung4.test.ts)
    expect(beats(ev).map((b) => b.beat)).toEqual(['dip', 'shake', 'warning', 'revert', 'works', 'sparks', 'stack', 'rewind', 'card']);
    expect(ev).toContainEqual({ type: 'card', by: 'revert', content: cardFor(4) });
    expect(types(ev)).not.toContain('effect');
    expect(world.durable()).toEqual(durable);
    expect(poses(world)).toEqual(before);
  });

  test('after the ladder: a deck of six, rungs 2 to 4, never the same card twice running, reshuffled when it runs out', () => {
    const { world } = benchStub();
    run(world, 10);
    for (let i = 0; i < 4; i++) playThrough(world);
    const drawn: string[] = [];
    const rungs: number[] = [];
    for (let i = 0; i < 40; i++) {
      const ev = playThrough(world);
      const card = ev.find((e) => e.type === 'card' && e.by === 'revert');
      drawn.push(card && card.type === 'card' ? card.content : '?');
      rungs.push(world.button().rung);
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i], `draw ${i}`).not.toBe(drawn[i - 1]);
    // every six draws use every card once
    for (let i = 0; i + 6 <= drawn.length; i += 6) expect(new Set(drawn.slice(i, i + 6))).toEqual(new Set(DECK.map((c) => c.card)));
    expect(new Set(rungs)).toEqual(new Set([2, 3, 4]));
    expect(world.button().presses).toBe(44);
  });
});

describe('reduced motion (§ B4, § B10): a rung is the card and the lamp dip only', () => {
  test('nothing is shoved, nothing but the lamp misfires, Revert is not called; the world is the same after', () => {
    const { world } = benchStub({ rung: 0, presses: 0, reducedMotion: true });
    run(world, 10);
    for (let r = 1; r <= 4; r++) {
      if (world.button().cover === 'shut') press(world);
      const before = poses(world);
      const durable = world.durable();
      world.dispatch({ type: 'press', id: 'button' });
      const ev: SimEvent[] = [];
      for (let i = 0; i < 2000 && !ev.some((e) => e.type === 'rung.ended'); i++) ev.push(...run(world, 1));
      expect(world.button().script?.reduced).toBe(true);
      expect(misfires(ev)).toEqual(['lamp:1']);
      expect(beats(ev).map((b) => b.beat).filter((b) => b !== 'cover')).toEqual(['dip', 'rewind', 'card']);
      expect(ev.some((e) => e.type === 'card')).toBe(true);
      expect(poses(world)).toEqual(before);
      expect(world.durable()).toEqual(durable);
    }
    expect(world.button().reached).toBe(4);
    expect(world.button().cover).toBe('shut');
  });
});

describe('remembered between visits; "Reset the workshop" starts over', () => {
  test('the view is what a save keeps: a world made from it carries on up the ladder, with the cover and the deck', () => {
    const { world } = benchStub();
    run(world, 10);
    press(world, 'undo-lever');
    for (let i = 0; i < 5; i++) playThrough(world);
    const v = world.button();
    const saved: ButtonSaved = { rung: v.rung, reached: v.reached, presses: v.presses, cover: v.cover, used: v.used, deck: v.deck };
    const { world: next } = benchStub(saved);
    expect(next.button()).toMatchObject({ reached: 4, presses: 5, cover: 'shut', used: ['undo-lever'], deck: v.deck });
    const ev = playThrough(next);
    const card = ev.find((e) => e.type === 'card');
    expect(card && card.type === 'card' ? card.content : null).not.toBe(v.card);
    expect(next.button().presses).toBe(6);
  });

  test('reset: rung 0, no presses, no cover, nothing used, the deck fresh', () => {
    const { world } = benchStub();
    run(world, 10);
    press(world, 'undo-lever');
    for (let i = 0; i < 3; i++) playThrough(world);
    run(world, steps(BUTTON_TUNING.fit) + 1);
    world.dispatch({ type: 'reset' });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'cover', id: 'button-cover', state: 'none' });
    expect(world.button()).toMatchObject({ rung: 0, reached: 0, presses: 0, cover: 'none', used: [], script: null, deck: { left: [], last: null } });
    expect(rung(world)).toContainEqual({ type: 'button.pressed', rung: 1, presses: 1 });
  });
});

describe('the Button and the history (§ E5 "The Button is bracketed")', () => {
  test('pressed mid-experiment, it changes nothing the lever then does: two pulls give exactly what they give without the press', () => {
    const script = (w: World, ph: ReturnType<typeof benchStub>['physics'], withPress: boolean): unknown[] => {
      run(w, 10);
      const out: unknown[] = [];
      // the visitor turns the dial, then sets a crate down somewhere else
      w.dispatch({ type: 'turn', id: 'belt-dial', value: 0 });
      run(w, 40);
      const m = w.motion('crate-4')!;
      w.dispatch({ type: 'grab', id: 'crate-4', grip: m.pose.p });
      run(w, 1);
      ph.land('crate-4', { p: [-2, 0.225, -3], q: qyaw(0.3) }, 8);
      w.dispatch({ type: 'release', velocity: [2, 1, 0] });
      run(w, 60);
      if (withPress) {
        rung(w);
        expect(w.undoStack().length).toBe(2);
      }
      for (let k = 0; k < 2; k++) {
        w.dispatch({ type: 'press', id: 'undo-lever' });
        const ev = run(w, 1);
        out.push(ev.filter((e) => e.type === 'undone').map((e) => (e.type === 'undone' ? e.restores.map((r) => [r.target, r.field, r.to, r.writer]) : null)));
        out.push(w.durable());
        run(w, 30);
      }
      return out;
    };
    const a = benchStub();
    const b = benchStub();
    expect(script(a.world, a.physics, true)).toEqual(script(b.world, b.physics, false));
  });

  test('the press is not in the history: no transaction opens, the stack is frozen while it plays', () => {
    const { world } = benchStub();
    run(world, 10);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 2);
    const stack = world.undoStack();
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 30);
    world.dispatch({ type: 'press', id: 'undo-lever' });
    const mid = run(world, 1);
    expect(types(mid)).not.toContain('undone');
    while (world.bracketed) run(world, 1);
    expect(world.undoStack()).toEqual(stack);
  });
});
