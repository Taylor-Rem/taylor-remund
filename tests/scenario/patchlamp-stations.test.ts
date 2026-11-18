// The stations on the Patchlamp lines (S3): the platen, the storefront, the lamp (its settings and its
// arm), on the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, waitFor } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, lampView, platenView, plug, shopView, textAndWait, traySpot } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

const lever = (w: World, t: Tape): void => {
  w.dispatch({ type: 'undo' });
  t.run(1);
};

describe('the platen: its tray takes anything loose and holds it; a text paints and labels it', () => {
  test('nothing on the tray: it says so, and nothing changes', async () => {
    const w = await benchWorld();
    const t = tape(w);
    plug(w, t, 'jack-platen');
    const a = textAndWait(w, t, 'make it blue');
    expect(a.e).toMatchObject({ type: 'line.refused', reason: 'station' });
    expect(a.words).toBe("Tray's empty. Put something on it first.");
    expect(w.undoStack().filter((x) => x.kind === 'text')).toEqual([]);
  });

  test('a crate on the tray: painted and labelled in one text, two beats; the lever runs both back', async () => {
    const w = await benchWorld();
    const t = tape(w);
    putOn(w, t, 'crate-3', traySpot(), 120);
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    plug(w, t, 'jack-platen');
    const a = textAndWait(w, t, 'paint it yellow and call it FRAGILE');
    expect(a.words).toBe('Painted it yellow. Labelled it FRAGILE. I checked. Patched.');
    expect(w.part('crate-3')).toMatchObject({ colour: 'tape-yellow', label: 'FRAGILE' });
    expect(platenView(w).beats.map((b) => [b.field, b.part, b.to, b.how])).toEqual([
      ['colour', 'crate-3', 'tape-yellow', 'change'],
      ['label', 'crate-3', 'FRAGILE', 'change'],
    ]);
    lever(w, t);
    t.run(1);
    expect(w.part('crate-3')).toMatchObject({ colour: 'bare', label: '' });
    expect(platenView(w).beats.map((b) => [b.field, b.to, b.how])).toEqual([
      ['label', '', 'undo'],
      ['colour', 'bare', 'undo'],
    ]);
    // the crate stays on the tray, held, and can be taken off
    expect(platenView(w).onTray).toBe('crate-3');
    w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
    t.run(1);
    expect(platenView(w).onTray).toBeNull();
  });

  test('one thing at a time: a second part set on a full tray gets a slip and rests where it lands', async () => {
    const w = await benchWorld();
    const t = tape(w);
    putOn(w, t, 'crate-3', traySpot(), 120);
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    putOn(w, t, 'crate-2', [traySpot()[0], traySpot()[1] + 0.5, traySpot()[2]], 120);
    t.run(90);
    expect(t.of('card').map((x) => x.e)).toContainEqual({ type: 'card', by: 'platen', content: 'slip.platen-full' });
    expect(platenView(w).onTray).toBe('crate-3');
  });

  test('Fetch on the tray: a robot is painted too', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(10);
    putOn(w, t, 'fetch', traySpot(), 160);
    expect(waitFor(w, t, 'fetch', 'in', 400)).toBe(true);
    expect(platenView(w).onTray).toBe('fetch');
    plug(w, t, 'jack-platen');
    expect(textAndWait(w, t, 'paint it violet').words).toBe('Painted it violet. I checked. Patched.');
    expect(w.part('fetch')!.colour).toBe('paint-violet');
  });
});

describe('the storefront: five durable settings a text changes', () => {
  test('sign colour, sign words, awning colour, open or closed, the window', async () => {
    const w = await benchWorld();
    const t = tape(w);
    expect(shopView(w)).toMatchObject({ sign: 'paint-green', words: '', awning: 'cable-red', open: true, picture: 'mountains' });
    expect(textAndWait(w, t, 'make the sign orange').words).toBe("Sign's orange. I checked. Patched.");
    expect(textAndWait(w, t, 'make the sign say HELLO THERE').words).toBe('Sign says HELLO THERE. I checked. Patched.');
    expect(textAndWait(w, t, 'paint the awning teal').words).toBe("Awning's teal. I checked. Patched.");
    expect(textAndWait(w, t, "we're closed").words).toBe('Door says CLOSED. I checked. Patched.');
    expect(textAndWait(w, t, 'put a boat in the window').words).toBe('Boat in the window. I checked. Patched.');
    expect(textAndWait(w, t, 'change the picture').words).toBe('New picture in the window. I checked. Patched.');
    expect(shopView(w)).toMatchObject({ sign: 'paint-orange', words: 'HELLO THERE', awning: 'teal-light', open: false, picture: 'tree' });
    expect(textAndWait(w, t, 'take the picture down').words).toBe("Window's empty. I checked. Patched.");
    expect(shopView(w).picture).toBe('none');
    // "Reset the workshop": all back, each as a beat run backwards
    w.dispatch({ type: 'reset' });
    t.run(1);
    expect(shopView(w)).toMatchObject({ sign: 'paint-green', words: '', awning: 'cable-red', open: true, picture: 'mountains' });
    expect(new Set(shopView(w).beats.map((b) => b.how))).toEqual(new Set(['reset']));
  });
});

describe('the lamp: brighter, dimmer, a colour, warm again, off, on; and its arm is a handle', () => {
  test('by text, as durable settings the stage reads', async () => {
    const w = await benchWorld();
    const t = tape(w);
    plug(w, t, 'jack-lamp');
    expect(lampView(w)).toMatchObject({ on: true, level: 3, levels: 5, colour: 'warm' });
    expect(textAndWait(w, t, 'brighter').words).toBe("Lamp's brighter. I checked. Patched.");
    expect(textAndWait(w, t, 'brighter').words).toBe("Lamp's brighter. I checked. Patched.");
    expect(textAndWait(w, t, 'brighter').words).toBe("Lamp's as bright as it goes.");
    expect(lampView(w).level).toBe(5);
    expect(textAndWait(w, t, 'make it violet').words).toBe("Lamp's violet. I checked. Patched.");
    expect(textAndWait(w, t, 'lights out').words).toBe("Lamp's off. I checked. Patched.");
    expect(lampView(w).on).toBe(false);
    expect(textAndWait(w, t, 'back to warm').words).toBe("Lamp's back to warm. I checked. Patched.");
    expect(textAndWait(w, t, 'lights on').words).toBe("Lamp's on. I checked. Patched.");
    expect(lampView(w)).toMatchObject({ on: true, colour: 'warm', level: 5 });
  });

  test('a drag swings the aim within what the joints allow, at once, in ONE transaction; the lever and a new visit put it back home', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const home = lampView(w).home;
    expect(lampView(w).aim).toEqual(home.aim);
    const path: Vec3[] = Array.from({ length: 40 }, (_, i) => [home.aim[0] + 0.03 * i, home.aim[1], home.aim[2] - 0.02 * i]);
    for (const p of path) {
      w.dispatch({ type: 'drag', id: 'lamp', target: p });
      t.run(1);
      expect(lampView(w).dragging).toBe(true);
    }
    // the light follows the hand at once; nothing durable until the hand lets go
    expect(lampView(w).aim[0]).toBeCloseTo(path.at(-1)![0], 1);
    expect(w.undoStack()).toEqual([]);
    // dragged far beyond its reach: held at the edge of what the arm allows
    w.dispatch({ type: 'drag', id: 'lamp', target: [20, 3, 20], end: true });
    t.run(1);
    const b = lampView(w).aim;
    // held at the region's edge (to the grid the arm is set on): the corner nearest the far right front
    const poly = PATCHLAMP.lamp.reach.polygon;
    expect(Math.min(...poly.map(([x, z]) => Math.hypot(b[0] - x, b[2] - z)))).toBeLessThan(0.02);
    expect(lampView(w).dragging).toBe(false);
    const stack = w.undoStack();
    expect(stack.length).toBe(1);
    expect(stack[0]!.entries.map((e) => e.field).sort()).toEqual(['x', 'z']);
    // the aim swings with it
    expect(lampView(w).aim).not.toEqual(home.aim);
    lever(w, t);
    expect(lampView(w).aim).toEqual(home.aim);
    // and a new visit starts at home whatever was left
    const w2 = await benchWorld();
    expect(lampView(w2).aim).toEqual(home.aim);
  });

  test('the Button flinch still dips the lamp (it is the lamp machine now, not a fixture)', async () => {
    const w = await benchWorld();
    const t = tape(w);
    w.dispatch({ type: 'press', id: 'button' });
    const ev = t.run(Math.round(0.5 * HZ));
    expect(ev).toContainEqual({ type: 'misfire', id: 'lamp', level: 1 });
    expect(lampView(w).misfire?.level).toBe(1);
  });
});
