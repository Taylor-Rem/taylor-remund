/**
 * The Button's moment (W4 § B), headless: the Button, lamp and card views
 * driven by the real simulation (stub physics) through whole rungs, frame by
 * frame on the simulation clock, against stand-ins for the stage, labels and
 * materials.
 */
import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Material, Texture } from 'three';
import { realize } from '../../../src/workshop/view/kit/realize.ts';
import type { Frame, Labels, ViewContext } from '../../../src/workshop/view/types.ts';
import type { Id, SimEvent } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import { BUTTON_TUNING } from '../../../src/workshop/sim/machines/button.ts';
import { createButtonView, type ButtonView } from '../../../src/workshop/view/stations/button.ts';
import { createCardView, CARD_FEEL, type CardView } from '../../../src/workshop/view/stations/card.ts';
import { createLampView, dipCurve, type LampView } from '../../../src/workshop/view/stations/lamp.ts';
import { stubWorld } from '../sim/helpers.ts';

const mat = (): Material => new MeshBasicMaterial();

function stubLabels(): Labels {
  const sizes = new Map<string, { w: number; h: number }>();
  const mk = (kind: string, text: string, w: number, h: number): string => {
    const key = `${kind}:${text}`;
    sizes.set(key, { w, h });
    return key;
  };
  return {
    tape: (t) => mk('tape', t, 0.3 * t.length, 0.46),
    stencil: (t) => mk('stencil', t, 0.1, 0.1),
    card: (t) => mk('card', t, 2.6, 1.5),
    slip: (t) => mk('slip', t, 0.5, 0.8),
    plate: (t) => mk('plate', t, 0.4, 0.13),
    sign: (t) => mk('sign', t, 4, 1),
    phone: () => mk('phone', '', 0.34, 0.6),
    size: (k) => sizes.get(k) ?? { w: 1, h: 1 },
    capHeight: () => 0.23,
    texture: () => null as unknown as Texture,
    normalMap: () => null,
    roughnessMap: () => null,
    transparent: () => false,
    region: (name, size) => ({ key: mk('region', name, size.w, size.h), px: { w: 1, h: 1 }, size, draw: () => {}, put: () => {} }),
    ready: () => Promise.resolve(),
  };
}

interface Rig {
  world: World;
  button: ButtonView;
  lamp: LampView;
  card: CardView;
  scene: Scene;
  levels: number[];
  shakes: number[];
  hovered: Id | null;
  step(n?: number): SimEvent[];
}

function rig(reducedMotion = false): Rig {
  const { world } = stubWorld(1);
  const scene = new Scene();
  const levels: number[] = [];
  const shakes: number[] = [];
  let lampLevel = 1;
  const lights = {
    get lampState() {
      return { level: lampLevel, colour: null };
    },
    setLamp(s: { level?: number }) {
      if (s.level !== undefined) lampLevel = s.level;
    },
    setBulb() {},
    key: { position: new Vector3(-3.6, 5.2, -0.6), target: { position: new Vector3() } },
  };
  const ctx: ViewContext = {
    scene,
    stage: { camera: { shake: (a: number) => shakes.push(a), camera: new PerspectiveCamera() }, lights } as unknown as ViewContext['stage'],
    materials: { of: mat, textured: mat, update() {}, dispose() {}, decal: () => new MeshBasicMaterial(), focusMark: () => new MeshBasicMaterial(), buttonHalo: () => new MeshBasicMaterial() },
    labels: stubLabels(),
    tier: 'high',
    reducedMotion,
    realize: (p) => realize(p, { of: mat, textured: mat, update() {}, dispose() {} }),
    pickable: () => {},
  };
  const lamp = createLampView({ body: false })(ctx);
  const button = createButtonView()(ctx);
  const card = createCardView()(ctx);
  const r: Rig = {
    world,
    button,
    lamp,
    card,
    scene,
    levels,
    shakes,
    hovered: null,
    step(n = 1) {
      const all: SimEvent[] = [];
      for (let i = 0; i < n; i++) {
        world.advance();
        const events = world.drainEvents();
        all.push(...events);
        const frame: Frame = { world, events, time: world.step / HZ, dt: 1 / HZ, alpha: 1, pointer: null, hovered: r.hovered, held: null, focused: null, keyDest: null, working: null };
        for (const v of [lamp, button, card]) v.update(frame);
        levels.push(lampLevel);
      }
      return all;
    },
  };
  r.step(5);
  return r;
}

const press = (r: Rig): void => r.world.dispatch({ type: 'press', id: r.world.scene.button.id });
const steps = (s: number): number => Math.round(s * HZ);
const rungSteps = steps(BUTTON_TUNING.flinch + BUTTON_TUNING.rewind) + 2;

describe('the Button view', () => {
  it('shows the press inside 100 ms: the cap goes down, then springs back past rest and settles', () => {
    const r = rig();
    press(r);
    let deepest = 0;
    let firstDown = -1;
    for (let i = 0; i < steps(0.1); i++) {
      r.step();
      deepest = Math.max(deepest, r.button.state.press);
      if (firstDown < 0 && r.button.state.press > 0.3) firstDown = i;
    }
    expect(firstDown).toBeGreaterThanOrEqual(0);
    expect(firstDown).toBeLessThan(steps(0.1));
    expect(deepest).toBeGreaterThan(0.9);
    let highest = 0;
    for (let i = 0; i < steps(0.6); i++) {
      r.step();
      highest = Math.min(highest, r.button.state.press);
    }
    expect(highest).toBeLessThan(-0.05); // overshoot past rest
    r.step(steps(1));
    expect(Math.abs(r.button.state.press)).toBeLessThan(0.02);
  });

  it('rolls the counter to the new count, a little past and back', () => {
    const r = rig();
    press(r);
    let peak = 0;
    for (let i = 0; i < steps(1.5); i++) {
      r.step();
      peak = Math.max(peak, r.button.state.count);
    }
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.25);
    r.step(rungSteps);
    expect(r.button.state.count).toBe(1);
  });

  it('lifts the cap a hair on hover, only while a press would be taken', () => {
    const r = rig();
    r.hovered = r.world.scene.button.id;
    r.step(steps(0.4));
    expect(r.button.state.press).toBeLessThan(-0.2);
    press(r);
    r.step(steps(1.5)); // inside the rung: bracketed
    expect(r.world.bracketed).toBe(true);
    expect(Math.abs(r.button.state.press)).toBeLessThan(0.05);
  });

  it('flinches: the guard rattles, the console shudders and the camera shakes once', () => {
    const r = rig();
    press(r);
    let guard = 0;
    let shudder = 0;
    for (let i = 0; i < steps(0.5); i++) {
      r.step();
      guard = Math.max(guard, r.button.state.guard);
      shudder = Math.max(shudder, Math.abs(r.button.state.shudder[0]));
    }
    expect(guard).toBeGreaterThan(0.01);
    expect(shudder).toBeGreaterThan(0.002);
    expect(r.shakes.length).toBe(1);
  });

  it('runs its own motion backwards during the rewind and lands on the press: the cap is down at the end, then lets go', () => {
    const r = rig();
    press(r);
    const ev = r.step(rungSteps);
    expect(ev.some((e) => e.type === 'rung.ended')).toBe(true);
    // right after the end the cap is still near the bottom, springing up
    const r2 = rig();
    press(r2);
    let atEnd = -1;
    for (let i = 0; i < rungSteps; i++) {
      const e = r2.step();
      if (e.some((x) => x.type === 'rung.rewinding')) atEnd = -2;
      if (atEnd === -2 && r2.world.button().phase === 'rewinding' && r2.world.button().phaseTime > BUTTON_TUNING.rewind - 0.05) atEnd = r2.button.state.press;
    }
    expect(atEnd).toBeGreaterThan(0.5);
    r2.step(steps(1));
    expect(Math.abs(r2.button.state.press)).toBeLessThan(0.03);
  });
});

describe('the lamp', () => {
  it('dips on the misfire inside 100 ms, flickers, recovers, swells back through the rewind and ends at full', () => {
    const r = rig();
    press(r);
    r.step(steps(0.1));
    expect(Math.min(...r.levels.slice(-steps(0.1)))).toBeLessThan(0.3);
    r.levels.length = 0;
    r.step(steps(BUTTON_TUNING.flinch - 0.1));
    expect(r.levels[r.levels.length - 1]).toBeCloseTo(1, 3);
    r.levels.length = 0;
    r.step(steps(BUTTON_TUNING.rewind) + 2);
    expect(Math.min(...r.levels)).toBeLessThan(0.4); // the dip, backwards
    expect(r.levels[r.levels.length - 1]).toBeCloseTo(1, 3);
  });

  it('never flashes more than three times a second (counting 10% swings)', () => {
    const r = rig();
    press(r);
    r.step(rungSteps + steps(1));
    // count reversals of direction bigger than 10% of full
    const xs = r.levels;
    const turns: number[] = [];
    let ext = xs[0]!;
    let dir = 0;
    xs.forEach((x, i) => {
      if (dir >= 0 && x < ext - 0.1) { if (dir > 0) turns.push(i); dir = -1; ext = x; }
      else if (dir <= 0 && x > ext + 0.1) { if (dir < 0) turns.push(i); dir = 1; ext = x; }
      else ext = dir > 0 ? Math.max(ext, x) : dir < 0 ? Math.min(ext, x) : ext;
    });
    // a flash is a pair of opposing changes: at most 3 pairs in any one-second window
    for (const t of turns) expect(turns.filter((u) => u >= t && u < t + HZ).length).toBeLessThanOrEqual(6);
  });

  it('follows a level the simulation or a caller asks for, easing like a filament', () => {
    const r = rig();
    r.lamp.setLevel(0.2);
    r.step(1);
    expect(r.lamp.level).toBeGreaterThan(0.5);
    r.step(steps(1));
    expect(r.lamp.level).toBeCloseTo(0.2, 2);
  });

  it('has a dip curve that starts and ends at full', () => {
    expect(dipCurve(-1)).toBe(1);
    expect(dipCurve(5)).toBe(1);
    expect(dipCurve(0.1)).toBeLessThan(0.25);
    expect(dipCurve(5, true)).toBe(1);
  });
});

describe('the card', () => {
  it('pops up after the rewind, holds, and drops away', () => {
    const r = rig();
    press(r);
    const ev = r.step(rungSteps);
    expect(ev.some((e) => e.type === 'card')).toBe(true);
    r.step(steps(0.8));
    expect(r.card.state.phase).toBe('hold');
    expect(r.card.state.pose.lift).toBeCloseTo(1, 1);
    expect(r.card.state.content).toBe('card.rung1');
    // it stands high, left of and behind the cap
    const cap = r.scene.getObjectByName('cap')!.getWorldPosition(new Vector3());
    const c = r.card.cardCentre()!;
    expect(c.y).toBeGreaterThan(cap.y + 0.6);
    expect(c.x).toBeLessThan(cap.x);
    expect(c.z).toBeLessThan(cap.z);
    r.step(steps(CARD_FEEL.hold + 0.06 * 40 + 1));
    expect(r.card.state.phase).toBe('stowed');
    expect(r.card.cardCentre()).toBeNull();
  });

  it('is taken away at once when the Button is pressed again', () => {
    const r = rig();
    press(r);
    r.step(rungSteps + steps(1));
    expect(r.card.state.phase).toBe('hold');
    press(r);
    r.step(steps(0.6));
    expect(r.card.state.phase).toBe('stowed');
  });

  it('with reduced motion: no shake, no sway, no wobble; still the card and the dip', () => {
    const r = rig(true);
    press(r);
    r.step(steps(0.1));
    expect(Math.min(...r.levels)).toBeLessThan(0.5);
    let sway = 0;
    let shudder = 0;
    for (let i = 0; i < rungSteps + steps(1); i++) {
      r.step();
      sway = Math.max(sway, Math.abs(r.card.state.pose.sway));
      shudder = Math.max(shudder, Math.abs(r.button.state.shudder[0]));
    }
    expect(r.shakes.length).toBe(0);
    expect(sway).toBe(0);
    expect(shudder).toBe(0);
    expect(r.card.state.phase).toBe('hold');
  });
});

describe('determinism', () => {
  it('two runs of the same presses pose everything identically', () => {
    const run = (): number[] => {
      const r = rig();
      press(r);
      const out: number[] = [];
      for (let i = 0; i < rungSteps + steps(2); i++) {
        r.step();
        const s = r.button.state;
        out.push(s.press, s.guard, s.count, ...s.shudder, r.lamp.level, r.card.state.pose.lift, r.card.state.pose.flap);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

