// P4 D3: the report press in the controls list, the live region and the maker's plate. Stowed, neither the press nor
// its lever is in the list; out of its crate, the press and its lever are, by name; the live region says what a pull
// printed in a sentence, and that the envelope shipped and came home; the plate lists a pull as one plain line,
// which the UNDO lever takes away whole.
import { describe, expect, test } from 'vitest';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench, PRESS } from '../../../src/workshop/sim/scenes/bench.ts';
import { Announcer, type HearContext } from '../../../src/workshop/ui/controls/announce.ts';
import { listModel, type ControlsSource } from '../../../src/workshop/ui/controls/model.ts';
import { STATION_BOXES } from '../../../src/workshop/shell/bench-stage.ts';
import { createSurface } from '../../../src/workshop/input/surface.ts';
import { historyLines, type LogWords } from '../../../src/workshop/ui/panels/log.ts';
import { liveWords } from '../../../src/content/hatches.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Intent } from '../../../src/workshop/sim/types.ts';

const NONE: HearContext = { keyHeld: null, phoneOpen: false };
const words = liveWords() as unknown as LogWords;

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

describe('the report press, for someone who cannot see it', () => {
  test('stowed: not in the list; out: the press and its lever by name; said: what was printed; the plate: one line a pull', async () => {
    const r = await rig();
    r.step(30);
    let m = r.items();
    for (const id of [PRESS.body, PRESS.lever, PRESS.envelope]) expect(m.has(id), id).toBe(false);
    r.act({ type: 'grab', id: PRESS.crate, grip: r.w.motion(PRESS.crate)!.pose.p }, 2);
    r.act({ type: 'place', at: [-4.0, 0, 1.6] }, 90);
    let opened: string[] = [];
    for (let k = 0; k < 4 && r.w.setting(PRESS.crate, 'open') !== true; k++) opened = r.act({ type: 'press', id: `${PRESS.crate}-lid` }, 30);
    expect(opened).toContain('Report Generation Framework opened.');
    m = r.items();
    expect(m.get(PRESS.body)).toBe('Report press');
    expect(m.get(PRESS.lever)).toBe('Report press lever');
    expect(m.has(PRESS.envelope)).toBe(false);
    expect(r.act({ type: 'press', id: PRESS.lever })).toEqual(['Printed: nothing has shipped yet.']);
    expect(historyLines(r.w, r.w.undoStack(), words).map((l) => l.text)[0]).toBe('Report press: report printed, copy stored, envelope sent');
    // the envelope flies, lands on the belt, rides and ships; later it is home
    const later = r.step(60 * 30);
    expect(later).toContain('Envelope shipped.');
    expect(later).toContain('The envelope is back in the press.');
    // the plate still says it in one line (the envelope's ride, its shipment and its homecoming are the pull's)
    const lines = historyLines(r.w, r.w.undoStack(), words).map((l) => l.text);
    expect(lines.filter((l) => l.startsWith('Report press') || l.startsWith('Envelope'))).toEqual(['Report press: report printed, copy stored, envelope sent']);
    // a second pull with the envelope home: the record holds what Fetch shipped meanwhile (never the envelope's own shipment)
    const second = r.act({ type: 'press', id: PRESS.lever });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatch(/^Printed: (nothing has shipped yet|one shipment|\d+ shipments)\.$/);
    r.step(30);
    // and a third while the second is still showing: it waits its turn, and once the envelope has landed it prints with the envelope out
    const third = r.act({ type: 'press', id: PRESS.lever }, 8 * 60);
    expect(third.some((x) => /^Printed: (nothing has shipped yet|one shipment|\d+ shipments)\.$/.test(x))).toBe(true);
    expect(third).toContain('The envelope is still out.');
    expect(historyLines(r.w, r.w.undoStack(), words).map((l) => l.text)[0]).toBe('Report press: report printed, copy stored');
    // the lever takes the last pull away whole
    r.act({ type: 'undo' }, 2);
    expect(historyLines(r.w, r.w.undoStack(), words).map((l) => l.text)[0]).toBe('Report press: report printed, copy stored, envelope sent');
    r.w.dispose();
  }, 60_000);
});
