// P3 B2: what happened, said aloud (REWRITE.md § E9 "What happens is announced in a polite live region in short
// sentences"). On the whole bench, stepping the world: the visitor's doings and what came of them are said; attract
// mode, the crew's own rounds and tells are not; a rung is its press and its card.
import { describe, expect, test } from 'vitest';
import { stubWorld } from '../sim/helpers.ts';
import { rapierWorld } from '../../scenario/helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { Announcer, ANNOUNCE_TUNING, type HearContext } from '../../../src/workshop/ui/controls/announce.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Intent } from '../../../src/workshop/sim/types.ts';

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
