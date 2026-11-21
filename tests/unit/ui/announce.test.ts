// P3 B2: what happened, said aloud (REWRITE.md § E9 "What happens is announced in a polite live region in short
// sentences"). On the whole bench, stepping the world: the visitor's doings and what came of them are said; attract
// mode, the crew's own rounds and tells are not; a rung is its press and its card.
import { describe, expect, test } from 'vitest';
import { stubWorld } from '../sim/helpers.ts';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { Announcer, ANNOUNCE_TUNING, type HearContext } from '../../../src/workshop/ui/controls/announce.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Intent, SimEvent } from '../../../src/workshop/sim/types.ts';

const NONE: HearContext = { keyHeld: null, phoneOpen: false };

function rig(reducedMotion = false, made?: World): { w: World; a: Announcer; said: string[]; step(n: number, ctx?: HearContext): string[]; act(i: Intent, ctx?: HearContext): string[] } {
  const w = made ?? stubWorld(1, { scene: bench }).world;
  if (reducedMotion) w.dispatch({ type: 'motion', reduced: true });
  const a = new Announcer();
  const said: string[] = [];
  const step = (n: number, ctx: HearContext = NONE): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      w.advance();
      out.push(...a.hear(w, w.drainEvents(), ctx));
    }
    said.push(...out);
    return out;
  };
  return { w, a, said, step, act: (i, ctx = NONE) => (w.dispatch(i), step(1, ctx)) };
}

describe('nothing is said for what the visitor did not do', () => {
  test('a visitor who has done nothing hears nothing: a minute of attract mode, the crew at work, tells', () => {
    const r = rig();
    r.step(60 * 60);
    expect(r.said).toEqual([]);
  });

  test('after the visitor has acted, the crew’s own rounds (Fetch shipping its crates) are still not said', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    r.step(60 * 90);
    // only the visitor's own turn of the dial
    expect(r.said).toEqual(['Belt speed 5 of 5.']);
  });
});

describe('the visitor’s doings, and what came of them', () => {
  test('the Button: its press and what its rung does, then Revert’s card; once each', () => {
    const r = rig();
    const press = r.act({ type: 'press', id: 'button' });
    expect(press).toEqual(['Big Red Button pressed. The bench flinches, and Revert winds it back.']);
    r.step(60 * 12);
    expect(r.said).toEqual(['Big Red Button pressed. The bench flinches, and Revert winds it back.', "Revert's card: WELL, THAT WAS UNNECESSARY."]);
  });

  test('under reduced motion the rung is a lamp dip and the card', () => {
    const r = rig(true);
    expect(r.act({ type: 'press', id: 'button' })).toEqual(['Big Red Button pressed. The lamp dips.']);
  });

  test('the belt: its speed and its direction, as they are after the change', () => {
    const r = rig();
    expect(r.act({ type: 'turn', id: 'belt-dial', value: 0 })).toEqual(['Belt speed 1 of 5.']);
    expect(r.act({ type: 'turn', id: 'belt-lever', value: 0.5 })).toEqual(['Belt stopped.']);
    expect(r.act({ type: 'turn', id: 'belt-lever', value: 0 })).toEqual(['Belt running backwards.']);
  });

  test('the cord in a jack, and what that jack switched', () => {
    const r = rig();
    r.act({ type: 'unplug', cord: 'cord' });
    const out = r.act({ type: 'plug', cord: 'cord', jack: 'jack-platen' });
    expect(out).toEqual(['Patch cord in the Platen jack. The phone talks to the Platen now.']);
    // while the phone panel is open it says that itself
    r.act({ type: 'unplug', cord: 'cord' });
    expect(r.act({ type: 'plug', cord: 'cord', jack: 'jack-belt' }, { keyHeld: null, phoneOpen: true })).toEqual([]);
  });

  test('a part picked up by the keys is told where to go; put on the belt, that is what is said (Rapier)', async () => {
    const r = rig(false, await rapierWorld(1, { scene: bench }));
    const id: Id = 'crate-3';
    const p = r.w.motion(id)!.pose.p;
    const held: HearContext = { keyHeld: id, phoneOpen: false };
    expect(r.act({ type: 'grab', id, grip: p }, held)).toEqual(['Small crate picked up. Choose where it goes.']);
    r.act({ type: 'place', at: 'belt' }, held);
    r.step(ANNOUNCE_TUNING.settle + 30);
    expect(r.said.slice(1)).toContain('Small crate is on the belt.');
    expect(r.said).not.toContain('Small crate put down.');
  });

  test('the UNDO lever: one sentence for what it took back', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    r.step(30);
    const out = r.act({ type: 'press', id: 'undo-lever' });
    r.step(30);
    expect([...out, ...r.said]).toContain('Undone: Belt is back as it was.');
  });

  test('the workshop reset', () => {
    const r = rig();
    r.act({ type: 'turn', id: 'belt-dial', value: 1 });
    expect(r.act({ type: 'reset' })).toContain('The workshop is reset.');
  });
});

// K2: the two announcements that were late or missing (the rules are written in announce.ts's header)
describe('a dial or lever change of the visitor’s own while Patch works on a text', () => {
  test('is said; the change Patch makes for the text is not (the phone says that)', () => {
    const r = rig();
    r.act({ type: 'press', id: 'button' }); // playing
    r.step(60 * 12);
    const a = r.a;
    // a text in flight (the line's own event, as the phone sends it)
    expect(a.hear(r.w, [{ type: 'line.sent', n: 7, jack: 'jack-belt', line: 'belt', text: 'speed up' } as SimEvent], NONE)).toEqual([]);
    // Patch's answer to it: the belt's speed written under the text's transaction, no hand on a handle
    expect(a.hear(r.w, [{ type: 'effect', effect: { target: 'belt', field: 'speed', before: 3, after: 4, cause: 't90' } } as SimEvent], NONE)).toEqual([]);
    // the visitor's own turn of the dial, the text still in flight
    expect(r.act({ type: 'turn', id: 'belt-dial', value: 0 })).toEqual(['Belt speed 1 of 5.']);
    expect(r.act({ type: 'turn', id: 'belt-lever', value: 0.5 })).toEqual(['Belt stopped.']);
    // the reply ends the text; nothing changes for the visitor's own
    a.hear(r.w, [{ type: 'line.reply', n: 7, reply: [], mailbox: false } as unknown as SimEvent], NONE);
    expect(r.act({ type: 'turn', id: 'belt-lever', value: 1 })).toEqual(['Belt running forwards.']);
  });
});

describe('a part let go: said when the world settles it, once', () => {
  /** The rig with crate-3 picked up by the pointer (the visitor has acted; the crate is theirs). */
  async function heldCrate(): Promise<ReturnType<typeof rig> & { id: Id }> {
    const r = rig(false, await rapierWorld(1, { scene: bench }));
    const id: Id = 'crate-3';
    const p = r.w.motion(id)!.pose.p;
    r.act({ type: 'grab', id, grip: p });
    r.step(10);
    return { ...r, id };
  }
  /** Carry the held crate over `to` (x, z), let it go slowly, and step until it is said or `max` steps pass. */
  function dropAt(r: Awaited<ReturnType<typeof heldCrate>>, to: readonly [number, number, number], max = 240): { said: string[]; steps: number; rested: number | null } {
    for (let i = 0; i < 40; i++) {
      r.w.dispatch({ type: 'carry', target: [to[0], to[1] + 0.6, to[2]] });
      r.step(1);
    }
    const before = r.said.length;
    r.w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    let rested: number | null = null;
    for (let i = 1; i <= max; i++) {
      r.w.advance();
      const ev = r.w.drainEvents();
      if (rested === null && ev.some((e) => e.type === 'part.rested' && e.id === r.id)) rested = i;
      r.said.push(...r.a.hear(r.w, ev, NONE));
      if (r.said.length > before && rested !== null) return { said: r.said.slice(before), steps: i, rested };
    }
    return { said: r.said.slice(before), steps: max, rested };
  }

  test('on the bench, away from every mouth: "put down", in the step it comes to rest (not a second and a half later)', async () => {
    const r = await heldCrate();
    const out = dropAt(r, [-3.6, bench.bench.top, 2.6]);
    expect(out.said).toEqual(['Small crate put down.']);
    expect(out.rested).not.toBeNull();
    expect(out.steps).toBe(out.rested);
    // well inside the old wait (90 steps from the letting go)
    expect(out.steps).toBeLessThan(75);
    // and nothing more about that letting go
    r.step(240);
    expect(r.said.filter((x) => x.startsWith('Small crate'))).toEqual(['Small crate picked up.', 'Small crate put down.']);
  });

  test('over the belt: where it went, and never "put down"', async () => {
    const r = await heldCrate();
    const belt = bench.mouths!.find((m) => m.id === 'belt')!;
    // over the middle of the belt (its feed end is beside the chute)
    const out = dropAt(r, [belt.c[0], belt.drop[1], belt.drop[2]]);
    expect(out.said).toEqual(['Small crate is on the belt.']);
    r.step(240);
    expect(r.said).not.toContain('Small crate put down.');
  });

  test('the orders the events can come in (events made by hand on the real bench)', async () => {
    const r = await heldCrate();
    const a = r.a;
    const hear = (...ev: SimEvent[]): string[] => a.hear(r.w, ev, NONE);
    const id = r.id;
    // let go, then settled in a mouth (taken in, then at rest, one step): where it went only
    expect(hear({ type: 'part.released', id, speed: 0.2 })).toEqual([]);
    expect(hear({ type: 'taken-in', id: 'belt', part: id, mouth: 'belt' }, { type: 'part.rested', id })).toEqual(['Small crate is on the belt.']);
    // let go, then at rest with no mouth: put down only
    expect(hear({ type: 'part.released', id, speed: 0.2 })).toEqual([]);
    expect(hear({ type: 'part.rested', id })).toEqual(['Small crate put down.']);
    // ... and a later taking in is news of its own (something moved it), said once, without a second "put down"
    expect(hear({ type: 'taken-in', id: 'belt', part: id, mouth: 'belt' }, { type: 'part.rested', id })).toEqual(['Small crate is on the belt.']);
    // taken in at the letting go itself (the keys' Enter over a mouth): said in that frame, nothing at rest
    expect(hear({ type: 'part.released', id, speed: 0.2 }, { type: 'taken-in', id: 'belt', part: id, mouth: 'belt' })).toEqual(['Small crate is on the belt.']);
    expect(hear({ type: 'part.rested', id })).toEqual([]);
    // let go, then picked up again before it rests: nothing for the drop
    expect(hear({ type: 'part.released', id, speed: 0.2 })).toEqual([]);
    expect(hear({ type: 'part.grabbed', id })).toEqual(['Small crate picked up.']);
    expect(hear({ type: 'part.rested', id })).toEqual([]);
    // thrown: said at once, nothing at rest
    expect(hear({ type: 'part.released', id, speed: 4 })).toEqual(['Small crate thrown.']);
    expect(hear({ type: 'part.rested', id })).toEqual([]);
  });
});

