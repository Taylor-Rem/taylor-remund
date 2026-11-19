// I1: every handle, every holdable thing and the keyboard, over scripted pointer samples (REWRITE.md § B6).
import { describe, expect, it } from 'vitest';
import { Gestures, type Command, type GestureWorld, type HandleReading, type HeldKind, type PointerKind, type Role, type Sample, type Target } from '../../../src/workshop/input/gesture.ts';
import type { Id, Intent, Vec3 } from '../../../src/workshop/sim/types.ts';

/** Things are discs on screen: centre (px), radius (px). x px → world x / 100, y px → world z / 100. */
interface Thing {
  id: Id;
  role: Role;
  x: number;
  y: number;
  r: number;
}

const THINGS: Thing[] = [
  { id: 'dial', role: 'dial', x: 300, y: 300, r: 30 },
  { id: 'lever', role: 'lever', x: 500, y: 300, r: 40 },
  { id: 'undo', role: 'handle', x: 700, y: 300, r: 25 },
  { id: 'crate', role: 'part', x: 100, y: 500, r: 30 },
  { id: 'lamp', role: 'unit', x: 300, y: 100, r: 20 },
  { id: 'cord', role: 'plug', x: 500, y: 100, r: 10 },
  { id: 'mouth', role: 'mouth', x: 700, y: 500, r: 40 },
];
const JACKS: { id: Id; x: number; y: number }[] = [
  { id: 'jack-a', x: 600, y: 100 },
  { id: 'jack-b', x: 680, y: 100 },
  { id: 'jack-capped', x: 740, y: 100 },
];

function fakeWorld(things = THINGS) {
  const readings = new Map<Id, HandleReading>([
    ['dial', { value: 0.5, detents: 5 }],
    ['lever', { value: 1, detents: 3 }],
  ]);
  const w = {
    bracket: false,
    carrying: null as { id: Id; what: HeldKind } | null,
    readings,
    get bracketed(): boolean {
      return w.bracket;
    },
    at(x: number, y: number, kind: PointerKind, exclude: Id | null, holding: HeldKind | null = null): Target {
      const pad = kind === 'touch' ? 10 : 0;
      for (const t of things) {
        if (t.id === exclude) continue;
        if (t.role === 'mouth' && !holding) continue;
        if (Math.hypot(x - t.x, y - t.y) <= t.r + pad) return { id: t.id, role: t.role, point: [x / 100, 0.3, y / 100] };
      }
      return { id: null, role: 'none', point: [x / 100, 0, y / 100] };
    },
    beginCarry(id: Id, what: HeldKind) {
      w.carrying = { id, what };
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
    screen(id: Id) {
      const t = things.find((k) => k.id === id);
      return t ? { x: t.x, y: t.y, r: t.r } : null;
    },
    reading: (id: Id) => readings.get(id) ?? null,
    jackNear(x: number, y: number): Id | null {
      let best: Id | null = null;
      let d0 = 30; // reach, px
      for (const j of JACKS) {
        const d = Math.hypot(x - j.x, y - j.y);
        if (d < d0) {
          d0 = d;
          best = j.id;
        }
      }
      return best;
    },
    usable: () => ['dial', 'lever', 'undo', 'crate', 'lamp', 'cord'],
    destinations: (what: HeldKind) => (what === 'plug' ? JACKS.map((j) => j.id) : ['mouth']),
    where(id: Id): Vec3 | null {
      const t = things.find((k) => k.id === id) ?? JACKS.map((j) => ({ ...j, r: 5 })).find((k) => k.id === id);
      return t ? [t.x / 100, 0.2, t.y / 100] : null;
    },
    role: (id: Id): Role => things.find((k) => k.id === id)?.role ?? 'none',
    // the lamp is an arm that aims: it is taken where it points
    gripFor: (id: Id, _what: HeldKind, point: Vec3): Vec3 => (id === 'lamp' ? [9, 0, 9] : point),
  } satisfies GestureWorld & Record<string, unknown>;
  return w;
}

function setup(things = THINGS) {
  const world = fakeWorld(things);
  const g = new Gestures(world);
  let t = 0;
  const s = (x: number, y: number, o: { id?: number; kind?: PointerKind; dt?: number } = {}): Sample => {
    t += o.dt ?? 16;
    return { id: o.id ?? 1, kind: o.kind ?? 'mouse', x, y, t, button: 0 };
  };
  const intents = (cs: Command[]): Intent[] => cs.flatMap((c) => (c.type === 'intent' ? [c.intent] : []));
  const acts = (cs: Command[]): Intent[] => intents(cs).filter((i) => i.type !== 'carry' && i.type !== 'hover');
  /** The world answering: a turn sets the reading (the next gesture starts from it). */
  const settle = (cs: Command[]): Command[] => {
    for (const i of intents(cs)) if (i.type === 'turn') world.readings.set(i.id, { ...world.readings.get(i.id)!, value: i.value });
    return cs;
  };
  /** A drag along points (each step 16 ms). */
  const drag = (pts: [number, number][], o: { kind?: PointerKind; id?: number } = {}): Command[] => {
    const [x0, y0] = pts[0]!;
    g.down(s(x0, y0, o));
    for (const [x, y] of pts.slice(1)) g.move(s(x, y, o));
    const [x1, y1] = pts[pts.length - 1]!;
    g.up(s(x1, y1, o));
    return settle(g.drain());
  };
  /** Points round a centre from angle a0 to a1 (degrees, screen: 0 is right, 90 is down), radius r. */
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 12): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
    });
  return { world, g, s, intents, acts, drag, arc, settle, now: () => t };
}

describe('the dial (turn)', () => {
  it('a click steps it (press); the hand opens over it before and after', () => {
    const { g, s, acts } = setup();
    g.move(s(300, 300));
    let out = g.drain();
    expect(out).toContainEqual({ type: 'cursor', cursor: 'pointer' });
    g.down(s(300, 290));
    g.up(s(300, 290));
    out = g.drain();
    expect(acts(out)).toEqual([{ type: 'press', id: 'dial' }]);
  });

  it('a drag ROUND it, clockwise from the top, turns it up through its detents, one turn intent per detent', () => {
    const { drag, arc, acts } = setup();
    // from straight up (-90°) clockwise by 70°: two detents at 36° each (past halfway, with the hysteresis)
    const out = drag(arc(300, 300, 26, -90, -20));
    expect(acts(out)).toEqual([
      { type: 'turn', id: 'dial', value: 0.75 },
      { type: 'turn', id: 'dial', value: 1 },
    ]);
  });

  it('round anticlockwise turns it down, and stops at the end without winding up', () => {
    const { drag, arc, acts, world } = setup();
    let out = drag(arc(300, 300, 26, -60, -200, 20)); // 140° anticlockwise from upper right
    expect(acts(out).map((i) => (i as { value: number }).value)).toEqual([0.25, 0]);
    expect(world.readings.get('dial')!.value).toBe(0);
    // dragging further down did not store up turns: the first step back clockwise turns it up at once
    out = drag(arc(300, 300, 26, -90, -50));
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.25 }]);
  });

  it('a drag ALONG it works too: right is up, left is down (taken low on the knob, it still drags along)', () => {
    const { drag, acts } = setup();
    let out = drag([
      [300, 320],
      [320, 320],
      [340, 321],
      [360, 322],
    ]);
    expect(acts(out)).toEqual([
      { type: 'turn', id: 'dial', value: 0.75 },
      { type: 'turn', id: 'dial', value: 1 },
    ]);
    out = drag([
      [300, 320],
      [285, 320],
      [270, 320],
    ]);
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.75 }]);
  });

  it('no chatter at a boundary: wobbling about the halfway point sends one turn, not many', () => {
    const { drag, acts } = setup();
    const out = drag([
      [300, 320],
      [313, 320],
      [312, 320],
      [314, 320],
      [313, 320],
      [317, 320],
      [313, 320],
    ]);
    expect(acts(out).length).toBeLessThanOrEqual(1);
  });

  it('the wheel over it steps it (a notch a detent; a trackpad gathers), elsewhere zooms', () => {
    const { g, s, acts, settle } = setup();
    g.wheel(300, 300, -100, s(0, 0).t);
    let out = settle(g.drain());
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.75 }]);
    for (let i = 0; i < 5; i++) g.wheel(300, 300, 12, s(0, 0).t);
    out = settle(g.drain());
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.5 }]);
    g.wheel(10, 10, 100, s(0, 0).t);
    expect(g.drain()[0]).toMatchObject({ type: 'zoom' });
  });

  it('a roll of the wheel that began as a zoom stays a zoom when the pointer comes over the dial', () => {
    const { g, s, acts } = setup();
    g.wheel(200, 300, -100, s(0, 0).t);
    g.wheel(300, 300, -100, s(0, 0, { dt: 80 }).t);
    g.wheel(300, 300, -100, s(0, 0, { dt: 80 }).t);
    let out = g.drain();
    expect(acts(out)).toEqual([]);
    expect(out.filter((c) => c.type === 'zoom').length).toBe(3);
    // a fresh roll over it, after a pause, turns it
    g.wheel(300, 300, -100, s(0, 0, { dt: 600 }).t);
    out = g.drain();
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.75 }]);
  });

  it('on touch: a tap steps it; a drag turns it and never pans', () => {
    const { g, s, drag, acts } = setup();
    g.down(s(300, 300, { kind: 'touch', id: 3 }));
    g.up(s(301, 300, { kind: 'touch', id: 3 }));
    expect(acts(g.drain())).toEqual([{ type: 'press', id: 'dial' }]);
    const out = drag(
      [
        [300, 320],
        [320, 320],
        [335, 320],
      ],
      { kind: 'touch', id: 4 },
    );
    expect(out.some((c) => c.type === 'pan')).toBe(false);
    expect(acts(out)).toEqual([{ type: 'turn', id: 'dial', value: 0.75 }]);
  });
});

describe('the three-way lever (slide)', () => {
  it('follows the drag between its notches and settles in the nearest: forward → stop → backward', () => {
    const { drag, acts, world } = setup();
    // 40 px radius: 28 px per notch
    const out = drag([
      [500, 300],
      [490, 300],
      [470, 300],
      [450, 300],
      [440, 300],
    ]);
    expect(acts(out)).toEqual([
      { type: 'turn', id: 'lever', value: 0.5 },
      { type: 'turn', id: 'lever', value: 0 },
    ]);
    expect(world.readings.get('lever')!.value).toBe(0);
  });

  it('let go between notches, it is in the nearest (nothing more is sent on release)', () => {
    const { drag, acts } = setup();
    const out = drag([
      [500, 300],
      [480, 300],
      [478, 300],
    ]);
    expect(acts(out)).toEqual([{ type: 'turn', id: 'lever', value: 0.5 }]);
  });

  it('a click throws it (press, the machine cycles it)', () => {
    const { drag, acts } = setup();
    expect(acts(drag([[500, 300]]))).toEqual([{ type: 'press', id: 'lever' }]);
  });
});

describe('the UNDO lever (press): a click pulls it; press and drag down the arc pulls it once', () => {
  it('mouse: at once on the press; the drag adds nothing; never pans', () => {
    const { g, s, acts } = setup();
    g.down(s(700, 290));
    expect(acts(g.drain())).toEqual([{ type: 'press', id: 'undo' }]);
    g.move(s(700, 320));
    g.move(s(705, 360));
    g.up(s(705, 360));
    const out = g.drain();
    expect(acts(out)).toEqual([]);
    expect(out.some((c) => c.type === 'pan')).toBe(false);
  });

  it('touch: a tap pulls it on lift; a pull down pulls it at the threshold, once', () => {
    const { g, s, acts } = setup();
    g.down(s(700, 290, { kind: 'touch', id: 2 }));
    expect(acts(g.drain())).toEqual([]);
    g.move(s(700, 305, { kind: 'touch', id: 2 }));
    expect(acts(g.drain())).toEqual([{ type: 'press', id: 'undo' }]);
    g.move(s(700, 340, { kind: 'touch', id: 2 }));
    g.up(s(700, 340, { kind: 'touch', id: 2 }));
    expect(acts(g.drain())).toEqual([]);
  });

  it('a second finger on a handle only touched becomes a pinch, and nothing is pressed', () => {
    const { g, s, acts } = setup();
    g.down(s(700, 300, { kind: 'touch', id: 1 }));
    g.down(s(900, 500, { kind: 'touch', id: 2, dt: 40 }));
    expect(g.state).toBe('pinch');
    g.up(s(700, 300, { kind: 'touch', id: 1 }));
    g.up(s(900, 500, { kind: 'touch', id: 2 }));
    expect(acts(g.drain())).toEqual([]);
  });
});

describe('holding units, and the plug into the nearest jack', () => {
  it('a unit that can be held (the lamp, Patch) is grabbed, carried and let go with the hand’s velocity, as a part is (R4)', () => {
    const { drag, acts, intents } = setup();
    const out = drag([
      [300, 100],
      [340, 120],
      [400, 140],
      [460, 160],
    ]);
    const a = acts(out);
    expect(a[0]).toEqual({ type: 'grab', id: 'lamp', grip: [9, 0, 9] }); // where it points (gripFor), not where the hand took it
    const rel = a[1];
    expect(rel?.type).toBe('release');
    if (rel?.type !== 'release') return;
    const v = rel.velocity;
    expect(v[0]).toBeGreaterThan(1); // moving right (x px / 100 = world x), down the screen (+z)
    expect(v[2]).toBeGreaterThan(0.3);
    expect(intents(out).filter((i) => i.type === 'carry').length).toBeGreaterThanOrEqual(3);
  });

  it('let go NEAR a jack (not on it), the plug seats in the nearest one within reach', () => {
    const { drag, acts } = setup();
    const out = drag([
      [500, 100],
      [560, 110],
      [662, 118],
    ]);
    expect(acts(out)).toEqual([
      { type: 'unplug', cord: 'cord' },
      { type: 'plug', cord: 'cord', jack: 'jack-b' },
    ]);
  });

  it('nearest a capped jack, it is pushed at the capped one (the world refuses it with a slip); far from all, dropped', () => {
    const { drag, acts } = setup();
    expect(acts(drag([[500, 100], [600, 120], [735, 104]])).at(-1)).toEqual({ type: 'plug', cord: 'cord', jack: 'jack-capped' });
    expect(acts(drag([[500, 100], [520, 300], [540, 400]])).at(-1)).toEqual({ type: 'plug', cord: 'cord', jack: null });
  });

  it('while the plug is held, the jack it would go into is the hovered one (it lifts to say so)', () => {
    const { g, s, intents } = setup();
    g.down(s(500, 100));
    g.move(s(560, 100));
    g.move(s(610, 104));
    const hovers = intents(g.drain()).filter((i) => i.type === 'hover');
    expect(hovers.at(-1)).toEqual({ type: 'hover', id: 'jack-a' });
  });

  it('tap-then-tap: tap the plug, tap near a jack', () => {
    const { g, s, acts } = setup();
    g.down(s(500, 100, { kind: 'touch', id: 1 }));
    g.up(s(500, 100, { kind: 'touch', id: 1 }));
    g.down(s(676, 112, { kind: 'touch', id: 2, dt: 600 }));
    g.up(s(676, 112, { kind: 'touch', id: 2 }));
    expect(acts(g.drain())).toEqual([
      { type: 'unplug', cord: 'cord' },
      { type: 'plug', cord: 'cord', jack: 'jack-b' },
    ]);
  });
});

describe('the cursor', () => {
  it('a hand over anything usable, a closed hand while holding, the default elsewhere; nothing during a rung', () => {
    const { g, s, world } = setup();
    const cursors = (): string[] => g.drain().flatMap((c) => (c.type === 'cursor' ? [c.cursor] : []));
    g.move(s(100, 500));
    expect(cursors()).toEqual(['grab']);
    g.move(s(300, 300));
    expect(cursors()).toEqual(['pointer']);
    g.move(s(900, 900));
    expect(cursors()).toEqual(['default']);
    g.move(s(100, 500));
    g.down(s(100, 500));
    expect(cursors()).toEqual(['grab', 'grabbing']);
    g.move(s(150, 520));
    g.up(s(150, 520));
    g.move(s(900, 900));
    expect(cursors()).toContain('default');
    world.bracket = true;
    g.move(s(300, 300));
    g.tick(s(300, 300).t);
    expect(cursors()).not.toContain('pointer');
  });
});

describe('the keyboard (§ B6: Tab, Enter or Space, arrows, U, Esc)', () => {
  it('Tab moves through the controls list and leaves it past the end; Shift+Tab goes back; focus lifts like a hover', () => {
    const { g, intents } = setup();
    expect(g.key('Tab', 0)).toBe(true);
    expect(g.focused).toBe('dial');
    let out = g.drain();
    expect(out).toContainEqual({ type: 'focus', id: 'dial' });
    expect(intents(out)).toContainEqual({ type: 'hover', id: 'dial' });
    g.key('Tab', 1);
    expect(g.focused).toBe('lever');
    g.key('Tab', 2, { shift: true });
    expect(g.focused).toBe('dial');
    for (let i = 0; i < 5; i++) g.key('Tab', 3);
    expect(g.focused).toBe('cord');
    expect(g.key('Tab', 4)).toBe(false); // the browser takes focus on to the page
    expect(g.focused).toBeNull();
    out = g.drain();
    expect(intents(out).at(-1)).toEqual({ type: 'hover', id: null });
  });

  it('Enter or Space works a focused handle; arrows step a focused dial or lever', () => {
    const { g, acts, settle } = setup();
    g.key('Tab', 0);
    g.drain();
    g.key('Enter', 1);
    expect(acts(g.drain())).toEqual([{ type: 'press', id: 'dial' }]);
    g.key('ArrowRight', 2);
    g.key('ArrowRight', 3);
    expect(acts(settle(g.drain()))).toEqual([
      { type: 'turn', id: 'dial', value: 0.75 },
      { type: 'turn', id: 'dial', value: 1 },
    ]);
    g.key('ArrowDown', 400);
    expect(acts(settle(g.drain()))).toEqual([{ type: 'turn', id: 'dial', value: 0.75 }]);
    g.key('Tab', 500);
    g.key('ArrowLeft', 501);
    expect(acts(settle(g.drain()))).toEqual([{ type: 'turn', id: 'lever', value: 0.5 }]);
    g.key('Tab', 600);
    g.key(' ', 601);
    expect(acts(g.drain())).toEqual([{ type: 'press', id: 'undo' }]);
  });

  it('Enter picks a part up, Tab chooses a destination, Enter sets it down there', () => {
    const { g, acts, intents } = setup();
    for (let i = 0; i < 4; i++) g.key('Tab', i);
    expect(g.focused).toBe('crate');
    g.drain();
    g.key('Enter', 10);
    let out = g.drain();
    expect(acts(out)).toEqual([{ type: 'grab', id: 'crate', grip: [1, 0.2, 5] }]);
    expect(intents(out).some((i) => i.type === 'carry')).toBe(true);
    g.key('Tab', 11);
    out = g.drain();
    expect(g.keyHold?.dest).toBe('mouth');
    expect(intents(out)).toContainEqual({ type: 'hover', id: 'mouth' });
    g.key('Enter', 12);
    expect(acts(g.drain())).toEqual([{ type: 'place', at: 'mouth' }]);
    expect(g.held).toBeNull();
  });

  it('arrows move a part held by the keys; Enter sets it down where it is held', () => {
    const { g, acts, intents } = setup();
    for (let i = 0; i < 4; i++) g.key('Tab', i);
    g.key('Enter', 10);
    g.drain();
    g.key('ArrowRight', 11);
    g.key('ArrowUp', 12);
    const carries = intents(g.drain()).filter((i) => i.type === 'carry');
    expect(carries.at(-1)).toEqual({ type: 'carry', target: [1 + 0.35, 0.2 + 0.45, 5 - 0.35] });
    g.key('Enter', 13);
    expect(acts(g.drain())).toEqual([{ type: 'place', at: [1.35, 0.2, 4.65] }]);
  });

  it('Enter on the plug lifts it; Tab goes through every jack; Enter pushes it in; Esc instead lets it go home', () => {
    const { g, acts } = setup();
    for (let i = 0; i < 6; i++) g.key('Tab', i);
    expect(g.focused).toBe('cord');
    g.key('Enter', 10);
    g.key('Tab', 11);
    g.key('Tab', 12);
    g.key('Enter', 13);
    expect(acts(g.drain())).toEqual([
      { type: 'unplug', cord: 'cord' },
      { type: 'plug', cord: 'cord', jack: 'jack-b' },
    ]);
    g.key('Enter', 20);
    g.key('Escape', 21);
    expect(acts(g.drain())).toEqual([
      { type: 'unplug', cord: 'cord' },
      { type: 'plug', cord: 'cord', jack: null },
    ]);
  });

  it('Enter on the lamp takes it where it points (as the pointer does): the light does not jump', () => {
    const { g, acts, intents } = setup();
    for (let i = 0; i < 5; i++) g.key('Tab', i);
    expect(g.focused).toBe('lamp');
    g.drain();
    g.key('Enter', 10);
    const out = g.drain();
    expect(acts(out)).toEqual([{ type: 'grab', id: 'lamp', grip: [9, 0, 9] }]);
    const c = intents(out).find((i) => i.type === 'carry') as { target: Vec3 };
    expect([c.target[0], c.target[2]]).toEqual([9, 9]);
  });

  it('Esc with nothing held clears the focus and backs out; U asks for undo', () => {
    const { g } = setup();
    g.key('Tab', 0);
    g.drain();
    g.key('Escape', 1);
    const out = g.drain();
    expect(g.focused).toBeNull();
    expect(out.map((c) => c.type)).toContain('back');
    g.key('U', 2);
    expect(g.drain().map((c) => c.type)).toEqual(['undo']);
  });

  it('during a rung, Enter on a focused handle does nothing', () => {
    const { g, world, acts } = setup();
    g.key('Tab', 0);
    world.bracket = true;
    g.key('Enter', 1);
    expect(acts(g.drain())).toEqual([]);
  });
});
