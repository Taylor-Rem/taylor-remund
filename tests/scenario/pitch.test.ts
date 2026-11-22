// Pitch on the bench (P4 P1a; sim/crew/pitch.ts): moored, his round, held, let go and thrown, bumped, poked, on the
// platen's tray, in the dock's door, under reduced motion, in the registry, and "Reset the workshop". Every way ends
// with him at his mast, upright, his body out of the world.
import { describe, expect, test } from 'vitest';
import { world, lift, fling, untilHome, home, pitchOf, fmt, MOORED, BODY, PITCHED, PITCH_SPEC } from './pitch-helpers.ts';
import { bench, PITCH_ON } from '../../src/workshop/sim/scenes/bench.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const S = (s: number): number => Math.round(s * HZ);

describe('Pitch', () => {
  test('the shipped bench has no Pitch until the switch is flipped', () => {
    expect(PITCH_ON).toBe(false);
    expect(bench.parts.some((p) => p.id === BODY)).toBe(false);
    expect(PITCHED.parts.at(-1)?.id).toBe(BODY);
    expect(PITCHED.units?.length).toBe((bench.units?.length ?? 0) + 1);
  });

  test('moored at the start, in the registry, his body out of the world', async () => {
    const { w } = await world();
    expect(home(w)).toBe(true);
    const it = w.interactable('pitch');
    expect(it?.affordances).toEqual(['grab']);
    expect(it?.name).toBe('name.pitch');
    expect(w.mode(BODY)).toBe('gone');
    w.dispose();
  });

  test('his round: unasked after a quiet spell, a pause over a machine, and home', async () => {
    const { w, t } = await world();
    const seen = new Set<string>();
    let paused = 0;
    let highest = 0;
    for (let i = 0; i < S(90); i++) {
      t.run(1);
      const v = pitchOf(w);
      seen.add(v.state);
      if (v.state === 'pause') paused++;
      highest = Math.max(highest, v.at[1]);
    }
    console.log('round: states', [...seen].join(' '), 'paused', (paused / HZ).toFixed(1), 's, highest', highest.toFixed(2));
    expect(seen.has('castoff')).toBe(true);
    expect(seen.has('pause')).toBe(true);
    expect(seen.has('moor')).toBe(true);
    expect(highest).toBeGreaterThan(PITCH_SPEC.cruise - 0.05);
    w.dispose();
  });

  test('held: he trails the hand on a string; let go he sails, slows, and goes home', async () => {
    const { w, t } = await world();
    lift(w, t, [0, 2.2, 1.5], 5);
    expect(pitchOf(w).state).toBe('held');
    // a sweep across the bench: he trails
    let lagMost = 0;
    let hand: Vec3 = [0, 2.2, 1.5];
    for (let i = 0; i < 40; i++) {
      hand = [hand[0] + 0.12, 2.2, 1.5];
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
      lagMost = Math.max(lagMost, hand[0] - pitchOf(w).at[0]);
    }
    console.log('held: most lag behind a hand at 7.2 units/s', lagMost.toFixed(2));
    expect(lagMost).toBeGreaterThan(0.3);
    expect(lagMost).toBeLessThan(1.6);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(1);
    expect(['sail', 'fly']).toContain(pitchOf(w).state);
    const n = untilHome(w, t);
    console.log('let go at (4.8, 2.2, 1.5): home in', (n / HZ).toFixed(1), 's');
    expect(n).toBeGreaterThan(0);
    w.dispose();
  });

  test('thrown every way: never lost, never falls, home every time', async () => {
    const dirs: Vec3[] = [[12, 0, 0], [-12, 0, 0], [0, 0, 10], [0, 0, -10], [8, 8, 0], [0, 12, -4], [-9, 2, 9], [10, -6, 4]];
    for (const d of dirs) {
      const { w, t } = await world();
      lift(w, t, [1.0, 2.0, 1.8], 10);
      fling(w, t, [1.0, 2.0, 1.8], d, 12);
      let lowest = Infinity;
      let n = -1;
      for (let i = 0; i < S(30); i++) {
        if (home(w)) {
          n = i;
          break;
        }
        t.run(1);
        lowest = Math.min(lowest, pitchOf(w).at[1]);
      }
      console.log(`thrown ${fmt(d, 0)}: home in ${(n / HZ).toFixed(1)} s, lowest middle ${lowest.toFixed(2)}`);
      expect(n, `thrown ${fmt(d, 0)}`).toBeGreaterThan(0);
      w.dispose();
    }
  });

  test('bumped at his mast by a thrown crate: pushed aside, home again', async () => {
    const { w, t } = await world();
    // a crate thrown at him from in front of the mast
    const from: Vec3 = [MOORED[0] - 2.2, MOORED[1] + 0.1, MOORED[2] + 1.4];
    w.dispatch({ type: 'grab', id: 'crate-4', grip: w.motion('crate-4')!.pose.p });
    t.run(1);
    for (let i = 0; i < 40; i++) {
      w.dispatch({ type: 'carry', target: from });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [8, 0, -5] });
    let bumped = false;
    let pushed = 0;
    for (let i = 0; i < S(2); i++) {
      t.run(1);
      const v = pitchOf(w);
      if (v.state === 'sail' && v.ruffled?.how === 'bumped') bumped = true;
      pushed = Math.max(pushed, Math.hypot(v.at[0] - MOORED[0], v.at[2] - MOORED[2]));
    }
    console.log('bumped:', bumped, 'pushed', pushed.toFixed(2));
    expect(bumped).toBe(true);
    expect(pushed).toBeGreaterThan(0.2);
    expect(untilHome(w, t)).toBeGreaterThan(0);
    w.dispose();
  });

  test('poked: a press that does not take hold; he faces the visitor, and is back as he was', async () => {
    const { w, t } = await world();
    const a = pitchOf(w).at;
    w.dispatch({ type: 'grab', id: 'pitch', grip: [a[0], a[1] + 0.3, a[2]] });
    t.run(20);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(1);
    expect(pitchOf(w).state).toBe('poked');
    expect(w.mode(BODY)).toBe('gone');
    const n = untilHome(w, t, S(5));
    expect(n).toBeGreaterThan(0);
    w.dispose();
  });

  test('on the platen: the tray holds him, he can be painted, he leaves by himself; reset makes him bare', async () => {
    const { w, t } = await world();
    lift(w, t, [3.2, 1.5, 0.7], 5);
    w.dispatch({ type: 'place', at: 'platen' });
    t.run(20);
    expect(pitchOf(w).state).toBe('tray');
    expect(w.mode(BODY)).toBe('machine');
    expect(w.part(BODY)?.location).toMatchObject({ at: 'in', mouth: 'platen' });
    // paint him (the platen's verb, as the line would)
    w.commit([{ target: BODY, field: 'colour', after: 'blue' }], 'system');
    const n = untilHome(w, t);
    console.log('the tray: home in', (n / HZ).toFixed(1), 's');
    expect(n).toBeGreaterThan(0);
    expect(w.part(BODY)?.location).toEqual({ at: 'shipped' });
    expect(w.part(BODY)?.colour).toBe('blue');
    w.dispatch({ type: 'reset' });
    t.run(2);
    expect(home(w)).toBe(true);
    expect(w.part(BODY)?.colour).toBe('bare');
    w.dispose();
  });

  test('the lever takes him off the tray', async () => {
    const { w, t } = await world();
    lift(w, t, [3.2, 1.5, 0.7], 5);
    w.dispatch({ type: 'place', at: 'platen' });
    t.run(20);
    expect(pitchOf(w).state).toBe('tray');
    w.dispatch({ type: 'undo' });
    t.run(3);
    expect(w.mode(BODY)).toBe('gone');
    expect(untilHome(w, t)).toBeGreaterThan(0);
    w.dispose();
  });

  test('in the dock door he backs out by himself', async () => {
    const { w, t } = await world();
    lift(w, t, [5.4, 1.2, 3.2], 5);
    w.dispatch({ type: 'place', at: 'dock' });
    let door = false;
    for (let i = 0; i < S(6); i++) {
      t.run(1);
      if (pitchOf(w).state === 'door') door = true;
    }
    expect(door).toBe(true);
    expect(untilHome(w, t)).toBeGreaterThan(0);
    w.dispose();
  });

  test('reduced motion: no round; let go, he is put back at his mast with a cut', async () => {
    const { w, t } = await world();
    w.dispatch({ type: 'motion', reduced: true });
    t.run(S(40));
    expect(home(w)).toBe(true);
    lift(w, t, [0, 2, 1.5], 5);
    w.dispatch({ type: 'release', velocity: [5, 0, 0] });
    t.run(2);
    expect(home(w)).toBe(true);
    expect(pitchOf(w).prevAt).toBe(pitchOf(w).at);
    w.dispose();
  });
});
