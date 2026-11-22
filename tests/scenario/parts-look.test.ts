// Brief W5: a part keeps what was done to it. Over a visit (paint, carry, belt, ship, undo the shipment,
// undo the paint, label, undo the label, reset) on the whole bench under real Rapier, the parts view draws
// every part's paint and label as its fields say at every step where no station is performing on it; and
// while the platen performs, the drawing is the station's (the paint wipes on, the tape runs on).
import { describe, expect, test } from 'vitest';
import { MeshBasicMaterial, Scene, type Material } from 'three';
import { benchWorld, onBelt, putOn, type Tape } from './line-helpers.ts';
import { plug, textAndWait, traySpot } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PlatenView, SimEvent } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import * as K from '../../src/workshop/view/kit/index.ts';
import { crate } from '../../src/workshop/view/kit/pieces/crate/index.ts';
import { createPartsView, partShows, partsHooks, paintToken, type PartWork } from '../../src/workshop/view/stations/parts.ts';
import { PlatenPerformances } from '../../src/workshop/view/stations/platen.ts';
import type { Frame, LabelRegion, Labels, ViewContext } from '../../src/workshop/view/types.ts';
import type { Piece } from '../../src/workshop/view/kit/types.ts';

const stubMaterials = {
  of: (): Material => new MeshBasicMaterial(),
  textured: (): Material => new MeshBasicMaterial(),
  decal: (): Material => new MeshBasicMaterial(),
  update() {},
  dispose() {},
};

/** Labels in Node: regions only (the tape's words are painted in the browser; here a region records nothing). */
const stubLabels = {
  region(name: string, size: { w: number; h: number }): LabelRegion {
    return { key: `stencil:region|${name}`, px: { w: 10, h: 2 }, size, draw() {}, put() {} };
  },
} as unknown as Labels;

interface Rig {
  w: World;
  t: Tape;
  view: ReturnType<ReturnType<typeof createPartsView>>;
  scene: Scene;
  perfs: PlatenPerformances;
  /** Steps where a part was drawn other than its fields while no station worked on it. */
  wrong: string[];
  /** What was seen while the platen worked: mid-wipe paint, a part-laid tape. */
  seen: { wipe: number; tape: number };
}

async function rig(): Promise<Rig> {
  const w = await benchWorld();
  const scene = new Scene();
  const ctx = {
    scene,
    stage: {} as ViewContext['stage'],
    materials: stubMaterials,
    labels: stubLabels,
    tier: 'high',
    reducedMotion: false,
    realize: (p: Piece) => K.realize(p, stubMaterials),
    pickable() {},
  } as unknown as ViewContext;
  const view = createPartsView({
    half: (p) => w.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
    tapes: true,
    piece: (p, _h, extras) => crate({ size: p.size, paint: paintToken(p.colour), seed: 3, stencil: false, ...(extras.tape ? { tape: extras.tape } : {}) }),
  })(ctx);
  const perfs = new PlatenPerformances();
  const hooks = partsHooks(scene);
  hooks.workers.push((id, frame, out) => perfs.work(id, frame.time, out));
  const r: Rig = { w, t: null as unknown as Tape, view, scene, perfs, wrong: [], seen: { wipe: 0, tape: 0 } };
  const work: PartWork = { paint: null, label: null };
  const events: { step: number; e: SimEvent }[] = [];
  const step = (): SimEvent[] => {
    w.advance();
    const ev = w.drainEvents();
    for (const e of ev) events.push({ step: w.step, e });
    perfs.update(w.machine('platen') as PlatenView, w, false);
    const frame = { world: w, events: ev, time: w.time, dt: 1 / HZ, alpha: 1, pointer: null, hovered: null, held: null, focused: null } as unknown as Frame;
    view.update(frame);
    for (const part of w.parts()) {
      if (part.kind === 'robot') continue;
      const d = view.drawn(part.id);
      if (!d) continue;
      if (partShows(hooks, part, frame, work)) {
        if (d.paint === 'mixed') r.seen.wipe++;
        if (d.tape !== null && d.tape > 0.05 && d.tape < 0.95) r.seen.tape++;
        continue;
      }
      // (P4 D1: a crate's thing that is not a crate, the ledger board, has no label tape and wears its paint in its own view)
      if (part.kind !== 'crate' && d.tape === null) continue;
      const tapeOk = part.label ? d.tape !== null && d.tape > 0.999 && d.text === part.label : d.tape === 0;
      if (d.paint !== paintToken(part.colour) || !tapeOk) r.wrong.push(`step ${w.step} ${part.id}: drawn ${JSON.stringify(d)}, fields ${part.colour} "${part.label}"`);
    }
    return ev;
  };
  r.t = {
    events,
    run(n) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) out.push(...step());
      return out;
    },
    until(pred, max) {
      for (let i = 0; i < max; i++) {
        const hit = step().find(pred);
        if (hit) return { step: w.step, e: hit };
      }
      return null;
    },
    of(type) {
      return events.filter((x) => x.e.type === type) as never;
    },
  };
  return r;
}

const lever = (r: Rig): void => {
  r.w.dispatch({ type: 'undo' });
  r.t.run(1);
};

describe('a part keeps what was done to it (W5): drawn from its fields wherever it goes', () => {
  test('paint, carry, belt, ship, undo the shipment, undo the paint, label, undo the label, reset', async () => {
    const r = await rig();
    const { w, t } = r;
    t.run(10);
    putOn(w, t, 'crate-3', traySpot(), 120);
    t.run(60);
    plug(w, t, 'jack-platen');
    textAndWait(w, t, 'Make it blue.');
    t.run(4 * HZ);
    expect(w.part('crate-3')!.colour).toBe('paint-blue');
    expect(r.view.drawn('crate-3')!.paint).toBe('paint-blue');
    expect(r.seen.wipe).toBeGreaterThan(20);

    // carried to the belt and shipped: blue all the way
    putOn(w, t, 'crate-3', onBelt(0.06));
    expect(t.until((e) => e.type === 'shipped' && e.part === 'crate-3', 40 * HZ)).not.toBeNull();
    t.run(30);
    expect(r.view.drawn('crate-3')!.paint).toBe('paint-blue');

    // the shipment undone: back, still blue
    lever(r);
    t.run(3 * HZ);
    expect(w.part('crate-3')!.location.at).not.toBe('shipped');
    expect(r.view.drawn('crate-3')!.paint).toBe('paint-blue');

    // the paint undone: bare again (the crate is no longer on the tray; the fields say so at once)
    lever(r);
    t.run(3 * HZ);
    expect(w.part('crate-3')!.colour).toBe('bare');
    expect(r.view.drawn('crate-3')!.paint).toBeNull();

    // on the tray again: a label, laid on; its undo peels it
    putOn(w, t, 'crate-3', traySpot(), 120);
    t.run(60);
    r.seen.tape = 0;
    textAndWait(w, t, 'Call it FRAGILE.');
    t.run(4 * HZ);
    expect(w.part('crate-3')!.label).toBe('FRAGILE');
    expect(r.view.drawn('crate-3')).toMatchObject({ tape: 1, text: 'FRAGILE' });
    expect(r.seen.tape).toBeGreaterThan(10);
    lever(r);
    t.run(4 * HZ);
    expect(w.part('crate-3')!.label).toBe('');
    expect(r.view.drawn('crate-3')!.tape).toBe(0);

    // painted and labelled, then the whole workshop reset
    textAndWait(w, t, 'Paint it red and call it MINE');
    t.run(6 * HZ);
    expect(r.view.drawn('crate-3')).toMatchObject({ paint: 'cable-red', text: 'MINE', tape: 1 });
    w.dispatch({ type: 'reset' });
    t.run(4 * HZ);
    expect(r.view.drawn('crate-3')).toMatchObject({ paint: null, tape: 0 });

    expect(r.wrong.slice(0, 5)).toEqual([]);
  }, 120_000);
});
