// T1: tells a visitor can see. The station lamps' one blink (REWRITE.md § B1 "blinks slowly as a tell"; § E9 "No
// flashing above three a second anywhere"), the glow and the rattle's table (view/stations/tells.ts), and the cord's
// lamp, which the view keeps (it has no machine).
import { describe, expect, test } from 'vitest';
import { blinkLevel, lampLevel, lampOn, STATION_LAMP } from '../../../src/workshop/view/stations/station-lamp.ts';
import { RATTLE, RATTLE_SECONDS, rattleAt, StationLamps, TELL_PARTS } from '../../../src/workshop/view/stations/tells.ts';
import { TELL_RATTLE } from '../../../src/workshop/audio/voices.ts';
import { TELL_SECONDS } from '../../../src/workshop/sim/machine.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { run, stubWorld } from '../sim/helpers.ts';
import type { SimEvent, WorldView } from '../../../src/workshop/sim/types.ts';

const STEP = 1 / 60;

describe('the station lamps blink one way, slowly and softly', () => {
  test('one blink every two seconds: well under three a second', () => {
    expect(STATION_LAMP.period).toBe(2);
    expect(1 / STATION_LAMP.period).toBeLessThan(3);
    // it comes on once per period: count the rising edges of the lit bulb over a minute of simulation time
    let edges = 0;
    let was = lampOn('blink', 0);
    for (let t = STEP; t <= 60; t += STEP) {
      const on = lampOn('blink', t);
      if (on && !was) edges++;
      was = on;
    }
    expect(edges).toBeGreaterThanOrEqual(29);
    expect(edges).toBeLessThanOrEqual(31);
  });

  test('soft on and off: the level passes through the middle, it is not a square wave', () => {
    const levels = Array.from({ length: 120 }, (_, i) => blinkLevel(i * STEP));
    expect(Math.max(...levels)).toBe(1);
    expect(Math.min(...levels)).toBe(0);
    const between = levels.filter((l) => l > 0.1 && l < 0.9).length;
    expect(between).toBeGreaterThanOrEqual(10); // a quarter second up, a third down
    // no jump between two frames bigger than a fifth of the swing
    for (let i = 1; i < levels.length; i++) expect(Math.abs(levels[i]! - levels[i - 1]!)).toBeLessThan(0.2);
  });

  test('dark is dark, steady is lit, and the bulb switches at half the level', () => {
    for (let t = 0; t < 4; t += 0.05) {
      expect(lampLevel('dark', t)).toBe(0);
      expect(lampLevel('steady', t)).toBe(1);
      expect(lampOn('blink', t)).toBe(blinkLevel(t) >= 0.5);
    }
  });
});

describe('the tells, per station', () => {
  test('every station of the ladder has its lamp and its rattling part, and nothing else is listed', () => {
    const ladder = bench.button.ladder!.stations.map((s) => s.id).sort();
    expect(Object.keys(TELL_PARTS).sort()).toEqual(ladder);
    expect(ladder).toHaveLength(10);
    for (const [id, p] of Object.entries(TELL_PARTS)) {
      expect(p.lamp, id).toMatch(/lit$/);
      expect(p.glowPx, id).toBeGreaterThan(0);
      expect(p.rattle.deg, id).toBeGreaterThan(0);
      expect(p.rattle.deg, id).toBeLessThanOrEqual(15);
    }
  });

  test('the rattle: the same knocks the sound plays, short, and still at its end', () => {
    expect(RATTLE.start).toBe(TELL_RATTLE.start);
    expect(RATTLE.knocks).toEqual(TELL_RATTLE.knocks);
    expect(RATTLE_SECONDS).toBeLessThan(1);
    let peak = 0;
    for (let s = 0; s < RATTLE_SECONDS; s += 0.002) peak = Math.max(peak, Math.abs(rattleAt(s)));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(2);
    expect(Math.abs(rattleAt(RATTLE_SECONDS))).toBeLessThan(0.02);
    expect(rattleAt(-0.1)).toBe(0);
  });

  test('a fresh bench: no station is telling, and the stations that are idle are dark', () => {
    const w = stubWorld(1, { scene: bench }).world;
    const lamps = new StationLamps();
    run(w, 1);
    for (const id of Object.keys(TELL_PARTS)) {
      const s = lamps.state(w as unknown as WorldView, id, 0);
      expect(s, id).not.toBe('blink');
      if (!TELL_PARTS[id]!.running(w as unknown as WorldView, w.machine(id))) expect(s, id).toBe('dark');
    }
  });

  test("the cord's lamp (no machine: the view keeps it): eight seconds from its tell, over the moment the plug is lifted", () => {
    const lamps = new StationLamps();
    let lifted = false;
    const w = { cord: () => ({ lifted }), machine: () => undefined } as unknown as WorldView;
    const tell: SimEvent = { type: 'tell', id: 'cord' } as SimEvent;
    expect(lamps.state(w, 'cord', 10)).toBe('dark');
    lamps.heard([tell], 10);
    expect(lamps.state(w, 'cord', 10.5)).toBe('blink');
    expect(lamps.state(w, 'cord', 10 + TELL_SECONDS - 0.01)).toBe('blink');
    expect(lamps.state(w, 'cord', 10 + TELL_SECONDS + 0.01)).toBe('dark');
    lamps.heard([tell], 30);
    lifted = true;
    expect(lamps.state(w, 'cord', 31)).toBe('steady');
    lifted = false;
    expect(lamps.state(w, 'cord', 31.1)).toBe('dark');
  });
});
