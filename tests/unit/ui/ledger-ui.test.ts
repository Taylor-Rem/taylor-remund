// P4 D1: the ledger board in the controls list and the live region. Stowed, neither the board nor its controls are
// in the list; out of its crate, the board (with its red star said, for someone who cannot see it), the crank and the
// plunger are, by name; the live region says what happened in a sentence: dealt, one payment bounced, repaired.
import { describe, expect, test } from 'vitest';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench, LEDGER } from '../../../src/workshop/sim/scenes/bench.ts';
import { Announcer, type HearContext } from '../../../src/workshop/ui/controls/announce.ts';
import { listModel, type ControlsSource } from '../../../src/workshop/ui/controls/model.ts';
import { STATION_BOXES } from '../../../src/workshop/shell/bench-stage.ts';
import { createSurface } from '../../../src/workshop/input/surface.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Intent } from '../../../src/workshop/sim/types.ts';

const NONE: HearContext = { keyHeld: null, phoneOpen: false };

function source(w: World): ControlsSource {
  const surface = createSurface({ world: () => w, ray: () => ({ origin: [0, 10, 10], dir: [0, -1, 0] }), pick: () => null, half: () => null, panels: () => new Set(['phone']), hidden: () => new Set(['line']), panelStation: () => 'patchlamp' });
  return {
    world: w,
    usable: () => surface.usable!(),
    role: (id) => surface.role(id),
    stationOf: (id) => w.interactable(id)?.station ?? (id === 'phone' ? 'patchlamp' : null),
    stations: Object.keys(STATION_BOXES),
    held: null,
    keyHold: null,
    destinations: [],
    reading: (id) => surface.reading!(id),
  };
}

async function rig(): Promise<{ w: World; step(n: number): string[]; act(i: Intent, n?: number): string[]; items(): Map<Id, string> }> {
  const w = await rapierWorld(1, { scene: bench });
  const a = new Announcer();
  const step = (n: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      w.advance();
      out.push(...a.hear(w, w.drainEvents(), NONE));
    }
    return out;
  };
  const act = (i: Intent, n = 1): string[] => (w.dispatch(i), step(n));
  const items = (): Map<Id, string> => new Map(listModel(source(w)).stations.flatMap((s) => s.items.map((it) => [it.id, it.label] as const)));
  return { w, step, act, items };
}

describe('the ledger board, for someone who cannot see it', () => {
  test('stowed: not in the list; out: the board, its crank and its plunger by name; said: dealt, one payment bounced, repaired, nothing to repair', async () => {
    const r = await rig();
    r.step(30);
    let m = r.items();
    for (const id of [LEDGER.board, LEDGER.crank, LEDGER.plunger]) expect(m.has(id), id).toBe(false);
    // the crate on it set aside, the crate opened: the board out, and it deals itself
    r.act({ type: 'grab', id: 'crate-2', grip: r.w.motion('crate-2')!.pose.p }, 2);
    r.act({ type: 'place', at: [1.15, 0, 2.6] }, 90);
    // (I2) opened the one way the bench has: taken and set on the opening stand by its mouth (the keys' place), not its latch
    r.act({ type: 'grab', id: LEDGER.crate, grip: r.w.motion(LEDGER.crate)!.pose.p }, 2);
    const said = r.act({ type: 'place', at: 'opening-stand' }, 240);
    // (I2: what the latch's press said, with the setting down said too, as any place is)
    expect(said).toEqual(['Ledger Management System opened.', 'Ledger Management System put down.', 'Dealt.', 'One payment bounced.']);
    m = r.items();
    expect(m.get(LEDGER.board)).toBe('Ledger board, red star lit');
    expect(m.get(LEDGER.crank)).toBe('Ledger board crank');
    expect(m.get(LEDGER.plunger)).toBe('Ledger board plunger');
    r.step(4 * 60);
    expect(r.act({ type: 'press', id: LEDGER.plunger })).toEqual(['Repaired: one charge unpaid, one payment bounced.']);
    expect(r.items().get(LEDGER.board)).toBe('Ledger board');
    r.step(4 * 60);
    expect(r.act({ type: 'press', id: LEDGER.plunger })).toEqual(['Nothing to repair.']);
    expect(r.act({ type: 'press', id: LEDGER.crank })).toEqual(['Dealt.', 'One payment bounced.']);
    r.w.dispose();
  });
});
