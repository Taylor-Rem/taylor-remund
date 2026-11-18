// The gesture state machine over scripted pointer samples (W2 brief § Tests).
import { describe, expect, it } from 'vitest';
import { Gestures, type Command, type GestureWorld, type PointerKind, type Sample, type Target } from '../../../src/workshop/input/gesture.ts';
import type { Id, Intent, Vec3 } from '../../../src/workshop/sim/types.ts';

/** A flat world: x px → world x / 100, y px → world z / 100. Things are rectangles in px. */
interface Thing {
  id: Id;
  role: Target['role'];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function fakeWorld(things: Thing[]): GestureWorld & { bracket: boolean; carrying: Id | null } {
  const w = {
    bracket: false,
    carrying: null as Id | null,
    get bracketed() {
      return w.bracket;
    },
    at(x: number, y: number, kind: PointerKind, exclude: Id | null): Target {
      const pad = kind === 'touch' ? 10 : 0;
      for (const t of things) {
        if (t.id === exclude) continue;
        if (x >= t.x0 - pad && x <= t.x1 + pad && y >= t.y0 - pad && y <= t.y1 + pad) return { id: t.id, role: t.role, point: [x / 100, 0.3, y / 100] };
      }
      return { id: null, role: 'none', point: [x / 100, 0, y / 100] };
    },
    beginCarry(id: Id) {
      w.carrying = id;
    },
    carryTarget(x: number, y: number): Vec3 {
      return [x / 100, 0.5, y / 100];
    },
    spot(x: number, y: number): Vec3 {
      return [x / 100, 0, y / 100];
    },
    endCarry() {
      w.carrying = null;
    },
  };
  return w;
}

const THINGS: Thing[] = [
  { id: 'crate', role: 'part', x0: 100, y0: 100, x1: 160, y1: 160 },
  { id: 'button', role: 'handle', x0: 300, y0: 100, x1: 340, y1: 140 },
  { id: 'cord', role: 'plug', x0: 500, y0: 100, x1: 520, y1: 120 },
  { id: 'jack-a', role: 'jack', x0: 600, y0: 100, x1: 620, y1: 120 },
];

function setup(things = THINGS) {
  const world = fakeWorld(things);
  const g = new Gestures(world);
  let t = 0;
  const s = (x: number, y: number, o: { id?: number; kind?: PointerKind; dt?: number; button?: number } = {}): Sample => {
    t += o.dt ?? 16;
    return { id: o.id ?? 1, kind: o.kind ?? 'mouse', x, y, t, button: o.button ?? 0 };
  };
  const intents = (cs: Command[]): Intent[] => cs.flatMap((c) => (c.type === 'intent' ? [c.intent] : []));
  const kinds = (cs: Command[]): string[] => intents(cs).filter((i) => i.type !== 'carry' && i.type !== 'hover').map((i) => i.type);
  return { world, g, s, intents, kinds, now: () => t };
}

describe('gestures: carrying', () => {
  it('press on a part grabs at once; drag carries; letting go releases with the hand’s velocity', () => {
    const { g, s, intents, kinds } = setup();
    g.down(s(130, 130));
    let out = g.drain();
    expect(kinds(out)).toEqual(['grab']);
    const grab = intents(out).find((i) => i.type === 'grab');
    expect(grab).toMatchObject({ id: 'crate', grip: [1.3, 0.3, 1.3] });
    // move right at 10 px (0.1 units) per 16 ms = 6.25 world units per second
    for (let i = 1; i <= 10; i++) g.move(s(130 + i * 10, 130));
    out = g.drain();
    expect(intents(out).filter((i) => i.type === 'carry').length).toBe(10);
    g.up(s(230, 130, { dt: 4 }));
    out = g.drain();
    const rel = intents(out).find((i) => i.type === 'release');
    expect(rel?.type).toBe('release');
    if (rel?.type !== 'release') return;
    expect(rel.velocity[0]).toBeGreaterThan(5);
    expect(rel.velocity[0]).toBeLessThan(7);
    expect(Math.abs(rel.velocity[2])).toBeLessThan(1e-6);
    expect(rel.velocity[1]).toBeGreaterThan(0); // the loft: a flick arcs
    expect(g.held).toBeNull();
  });

  it('a hand that stopped before letting go throws nothing', () => {
    const { g, s, intents } = setup();
    g.down(s(130, 130));
    for (let i = 1; i <= 10; i++) g.move(s(130 + i * 20, 130));
    g.drain();
    g.tick(s(0, 0, { dt: 150 }).t); // still for 150 ms
    g.up(s(330, 130, { dt: 1 }));
    const rel = intents(g.drain()).find((i) => i.type === 'release');
    expect(rel).toEqual({ type: 'release', velocity: [0, 0, 0] });
  });

  it('click vs drag: under the threshold a click is tap-then-tap; the part stays held and follows the mouse; a click on a spot places it', () => {
    const { g, s, intents, kinds } = setup();
    g.down(s(130, 130));
    g.move(s(132, 131)); // under 4 px
    g.up(s(132, 131));
    expect(kinds(g.drain())).toEqual(['grab']);
    expect(g.held).toMatchObject({ id: 'crate', tap: true });
    g.move(s(400, 300));
    expect(intents(g.drain()).some((i) => i.type === 'carry')).toBe(true);
    g.down(s(400, 300));
    g.up(s(401, 300));
    const out = intents(g.drain());
    expect(out.find((i) => i.type === 'place')).toEqual({ type: 'place', at: [4.01, 0, 3] });
    expect(g.held).toBeNull();
  });

  it('tap-then-tap on touch: tap a part, tap a spot', () => {
    const { g, s, kinds, intents } = setup();
    g.down(s(130, 130, { kind: 'touch' }));
    g.up(s(131, 130, { kind: 'touch' }));
    expect(kinds(g.drain())).toEqual(['grab']);
    g.down(s(700, 400, { kind: 'touch', id: 2, dt: 500 }));
    g.up(s(700, 400, { kind: 'touch', id: 2 }));
    const out = intents(g.drain());
    expect(out.find((i) => i.type === 'place')).toEqual({ type: 'place', at: [7, 0, 4] });
  });

  it('touch, holding by tap: a drag elsewhere pans and keeps the part held', () => {
    const { g, s, kinds } = setup();
    g.down(s(130, 130, { kind: 'touch' }));
    g.up(s(130, 130, { kind: 'touch' }));
    g.drain();
    g.down(s(700, 400, { kind: 'touch', id: 2, dt: 500 }));
    g.move(s(760, 400, { kind: 'touch', id: 2 }));
    g.up(s(760, 400, { kind: 'touch', id: 2 }));
    const out = g.drain();
    expect(out.some((c) => c.type === 'pan')).toBe(true);
    expect(kinds(out)).toEqual([]);
    expect(g.held?.id).toBe('crate');
  });

  it('Esc lets a held part go where it is, throwing nothing', () => {
    const { g, s, intents } = setup();
    g.down(s(130, 130));
    g.up(s(130, 130));
    g.drain();
    g.key('Escape', 1000);
    expect(intents(g.drain()).find((i) => i.type === 'release')).toEqual({ type: 'release', velocity: [0, 0, 0] });
    g.key('Escape', 1100);
    expect(g.drain()).toEqual([{ type: 'back' }]);
  });
});

describe('gestures: pan, pinch, handles, plug', () => {
  it('drag on empty bench pans (from the press point), never carries', () => {
    const { g, s, intents } = setup();
    g.down(s(800, 500));
    g.move(s(802, 500)); // under the threshold: nothing yet
    expect(g.drain().filter((c) => c.type === 'pan')).toEqual([]);
    g.move(s(820, 500));
    g.move(s(840, 510));
    g.up(s(840, 510));
    const out = g.drain();
    const pans = out.filter((c) => c.type === 'pan');
    expect(pans[0]).toEqual({ type: 'pan', from: [800, 500], to: [820, 500] });
    expect(pans[1]).toEqual({ type: 'pan', from: [820, 500], to: [840, 510] });
    expect(intents(out).filter((i) => i.type !== 'hover')).toEqual([]);
  });

  it('pinch: two fingers pan by the midpoint and zoom by the spread', () => {
    const { g, s } = setup();
    g.down(s(400, 400, { kind: 'touch', id: 1 }));
    g.down(s(600, 400, { kind: 'touch', id: 2 }));
    g.move(s(350, 400, { kind: 'touch', id: 1 }));
    const out = g.drain();
    const zoom = out.find((c) => c.type === 'zoom');
    expect(zoom).toMatchObject({ type: 'zoom' });
    if (zoom?.type === 'zoom') expect(zoom.factor).toBeCloseTo(200 / 250, 6); // fingers apart: closer
    expect(out.find((c) => c.type === 'pan')).toEqual({ type: 'pan', from: [500, 400], to: [475, 400] });
  });

  it('a second finger right after a grab turns it into a two-finger gesture (the part is set back down)', () => {
    const { g, s, kinds } = setup();
    g.down(s(130, 130, { kind: 'touch', id: 1 }));
    g.down(s(400, 400, { kind: 'touch', id: 2, dt: 60 }));
    expect(kinds(g.drain())).toEqual(['grab', 'release']);
    expect(g.state).toBe('pinch');
    expect(g.held).toBeNull();
  });

  it('a second finger while carrying (moved) is ignored: dragging never fights panning', () => {
    const { g, s } = setup();
    g.down(s(130, 130, { kind: 'touch', id: 1 }));
    g.move(s(180, 130, { kind: 'touch', id: 1 }));
    g.down(s(400, 400, { kind: 'touch', id: 2, dt: 30 }));
    g.move(s(450, 420, { kind: 'touch', id: 2 }));
    expect(g.state).toBe('carry');
    expect(g.drain().some((c) => c.type === 'pan' || c.type === 'zoom')).toBe(false);
  });

  it('mouse press on a handle presses at once; touch presses on lift, and a touch dragged off it pulls it (once), never pans', () => {
    const { g, s, kinds } = setup();
    g.down(s(320, 120));
    expect(kinds(g.drain())).toEqual(['press']);
    g.up(s(320, 120));
    expect(kinds(g.drain())).toEqual([]);
    g.down(s(320, 120, { kind: 'touch', id: 5, dt: 1000 }));
    expect(kinds(g.drain())).toEqual([]);
    g.up(s(320, 120, { kind: 'touch', id: 5 }));
    expect(kinds(g.drain())).toEqual(['press']);
    g.down(s(320, 120, { kind: 'touch', id: 6, dt: 1000 }));
    g.move(s(360, 160, { kind: 'touch', id: 6 }));
    g.move(s(360, 220, { kind: 'touch', id: 6 }));
    g.up(s(360, 220, { kind: 'touch', id: 6 }));
    const out = g.drain();
    expect(kinds(out)).toEqual(['press']);
    expect(out.some((c) => c.type === 'pan')).toBe(false);
  });

  it('the plug: press = unplug, released over a jack = plug {jack}, elsewhere = plug {null}', () => {
    const { g, s, intents, kinds } = setup();
    g.down(s(510, 110));
    expect(intents(g.drain()).find((i) => i.type === 'unplug')).toEqual({ type: 'unplug', cord: 'cord' });
    g.move(s(560, 110));
    g.move(s(610, 110));
    g.up(s(610, 110));
    expect(intents(g.drain()).find((i) => i.type === 'plug')).toEqual({ type: 'plug', cord: 'cord', jack: 'jack-a' });
    g.down(s(510, 110, { dt: 500 }));
    g.move(s(560, 300));
    g.up(s(560, 300));
    expect(kinds(g.drain())).toEqual(['unplug', 'plug']);
  });

  it('while bracketed, parts and handles do not respond but the camera still moves', () => {
    const { g, s, world, kinds } = setup();
    world.bracket = true;
    g.down(s(130, 130));
    g.move(s(200, 130));
    g.up(s(200, 130));
    let out = g.drain();
    expect(kinds(out)).toEqual([]);
    expect(out.some((c) => c.type === 'pan')).toBe(true);
    g.down(s(320, 120, { dt: 400 }));
    g.up(s(320, 120));
    out = g.drain();
    expect(kinds(out)).toEqual([]);
    g.wheel(320, 120, 100);
    expect(g.drain()[0]).toMatchObject({ type: 'zoom' });
  });

  it('pointer-cancel mid-carry lets go with no throw; mid-pan just stops', () => {
    const { g, s, intents } = setup();
    g.down(s(130, 130));
    for (let i = 1; i <= 5; i++) g.move(s(130 + i * 80, 130));
    g.drain();
    g.cancel(s(530, 130));
    expect(intents(g.drain()).find((i) => i.type === 'release')).toEqual({ type: 'release', velocity: [0, 0, 0] });
    expect(g.state).toBe('idle');
    g.down(s(800, 500, { dt: 300 }));
    g.move(s(850, 500));
    g.cancel(s(850, 500));
    expect(g.state).toBe('idle');
  });

  it('double-click asks to frame; hover follows the mouse and sets the cursor', () => {
    const { g, s } = setup();
    g.move(s(320, 120));
    let out = g.drain();
    expect(out).toContainEqual({ type: 'intent', intent: { type: 'hover', id: 'button' }, t: expect.any(Number) });
    expect(out).toContainEqual({ type: 'cursor', cursor: 'pointer' });
    g.move(s(130, 130));
    out = g.drain();
    expect(out).toContainEqual({ type: 'cursor', cursor: 'grab' });
    g.down(s(800, 500));
    g.up(s(800, 500));
    g.down(s(802, 501, { dt: 120 }));
    g.up(s(802, 501));
    expect(g.drain().some((c) => c.type === 'frame')).toBe(true);
  });

  it('keys: arrows nudge, + and − zoom, U asks for undo', () => {
    const { g } = setup();
    for (const k of ['ArrowLeft', '+', '-', 'u']) expect(g.key(k, 0)).toBe(true);
    expect(g.key('x', 0)).toBe(false);
    expect(g.drain().map((c) => c.type)).toEqual(['nudge', 'zoom', 'zoom', 'undo']);
  });
});
