// P4 D2b: the paint dial in the controls list, the live region, the maker's plate's log and the input's reading.
// Stowed, neither the dial nor its knob is in the list; out of its crate, both are, the knob with its place on the dial;
// a turn is said in one sentence; on the plate a turn reads as one plain line; a drag reads the knob's own detents
// (not the belt dial's, which shares its station).
import { describe, expect, test } from 'vitest';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench, PAINT } from '../../../src/workshop/sim/scenes/bench.ts';
import { PAINT_TUNING } from '../../../src/workshop/sim/machines/paint-dial.ts';
import { Announcer, type HearContext } from '../../../src/workshop/ui/controls/announce.ts';
import { listModel, type ControlsSource } from '../../../src/workshop/ui/controls/model.ts';
import { historyLines, type LogWords } from '../../../src/workshop/ui/panels/log.ts';
import { STATION_BOXES } from '../../../src/workshop/shell/bench-stage.ts';
import { createSurface } from '../../../src/workshop/input/surface.ts';
import { readingFromWorld } from '../../../src/workshop/input/readings.ts';
import hatches from '../../../src/content/hatches.json';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Intent } from '../../../src/workshop/sim/types.ts';

const NONE: HearContext = { keyHeld: null, phoneOpen: false };
const N = PAINT_TUNING.schemes.length;

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

/** The plate's log words, as the panel hands them in (src/content/hatches.json `maker.live.log`). */
function logWords(): LogWords {
  type T = { text: string };
  const L = (hatches as unknown as { maker: { live: { log: Record<string, T | Record<string, T>> } } }).maker.live.log;
  const flat = (o: Record<string, T>): Record<string, string> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.text]));
  const t = (k: string): string => (L[k] as T).text;
  return { field: t('field'), state: t('state'), moved: t('moved'), changed: t('changed'), byText: t('byText'), fields: flat(L['fields'] as Record<string, T>), values: flat(L['values'] as Record<string, T>), places: flat(L['places'] as Record<string, T>) };
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

describe('the paint dial, for someone who cannot see it', () => {
  test('stowed: not in the list; out: the dial and its knob, with its place; a turn said once; on the plate one plain line', async () => {
    const r = await rig();
    r.step(30);
    let m = r.items();
    expect(m.has(PAINT.dial)).toBe(false);
    expect(m.has(PAINT.knob)).toBe(false);
    r.act({ type: 'press', id: `${PAINT.crate}-lid` }, 3);
    m = r.items();
    expect(m.get(PAINT.dial)).toBe('Paint dial');
    expect(m.get(PAINT.knob)).toBe(`Paint dial knob, 1 of ${N}`);
    const said = r.act({ type: 'press', id: PAINT.knob }, 2);
    expect(said).toEqual(['The workshop is repainted.']);
    expect(r.items().get(PAINT.knob)).toBe(`Paint dial knob, 2 of ${N}`);
    const lines = historyLines(r.w, r.w.undoStack(), logWords());
    expect(lines[0]!.text).toBe('Paint dial paint: 1 → 2');
    // the lever's undo is said as the lever's, not as a turn
    const back = r.act({ type: 'undo' }, 2);
    expect(back).not.toContain('The workshop is repainted.');
    expect(r.items().get(PAINT.knob)).toBe(`Paint dial knob, 1 of ${N}`);
    r.w.dispose();
  }, 60_000);

  test('the input reads the knob from the dial, not from the belt that shares its station; a drag steps through its detents', async () => {
    const r = await rig();
    r.step(30);
    r.act({ type: 'press', id: `${PAINT.crate}-lid` }, 3);
    expect(readingFromWorld(r.w, PAINT.knob)).toEqual({ value: 0, detents: N });
    r.act({ type: 'turn', id: PAINT.knob, value: 2 / (N - 1) }, 2);
    expect(readingFromWorld(r.w, PAINT.knob)).toEqual({ value: 2 / (N - 1), detents: N });
    // the belt's dial still reads the belt
    const belt = r.w.machine('belt');
    expect(belt?.kind).toBe('belt');
    if (belt?.kind === 'belt') expect(readingFromWorld(r.w, 'belt-dial')).toEqual({ value: (belt.speed - 1) / (belt.detents - 1), detents: belt.detents });
    r.w.dispose();
  }, 60_000);
});
