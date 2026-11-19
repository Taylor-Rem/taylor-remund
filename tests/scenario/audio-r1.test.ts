// R1 (Taylor's test, 2026-11-19): the new beats are heard, from simulation events only. The chute's
// delivery (a pneumatic launch, one landing knock in the crate's own note); a Button press startles Fetch
// (one chirp; nothing with reduced motion); Fetch and Patch yelp once when lifted, not again within 2 s.
import { describe, expect, test } from 'vitest';
import { benchWorld, onBelt, putOn, tape } from './line-helpers.ts';
import { Score, type Cue } from '../../src/workshop/audio/score.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SimEvent } from '../../src/workshop/sim/types.ts';

/** A tape whose every step is heard by the score, as each frame is in the browser. */
function heardTape(w: World, score = new Score()) {
  const t = tape(w);
  const heard: { step: number; cue: Cue }[] = [];
  const run = t.run;
  const hearStep = (): SimEvent[] => {
    const ev = run(1);
    for (const cue of score.hear(w, ev).cues) heard.push({ step: w.step, cue });
    return ev;
  };
  const wrapped = {
    ...t,
    run(n: number) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) out.push(...hearStep());
      return out;
    },
    until(pred: (e: SimEvent) => boolean, max: number) {
      for (let i = 0; i < max; i++) {
        const hit = hearStep().find(pred);
        if (hit) return { step: w.step, e: hit };
      }
      return null;
    },
  };
  return { t: wrapped as typeof t, heard };
}

const after = (h: { step: number; cue: Cue }[], from: number) => h.filter((x) => x.step > from).map((x) => x.cue);

describe('R1 sounds', () => {
  test('a shipped crate\'s replacement: the launch, the flap without the return\'s thump, one landing knock in its own note', async () => {
    const w = await benchWorld('audio-r1-chute');
    const { t, heard } = heardTape(w);
    t.run(30);
    putOn(w, t, 'crate-3', onBelt(0.3));
    const launched = t.until((e) => e.type === 'restock.launched', steps(25));
    expect(launched).not.toBeNull();
    const from = launched!.step - 1;
    const part = (launched!.e as Extract<SimEvent, { type: 'restock.launched' }>).part;
    const landed = t.until((e) => e.type === 'restocked' && e.part === part, steps(3));
    expect(landed).not.toBeNull();
    t.run(steps(1.5));
    const cues = after(heard, from);
    const ids = cues.map((c) => c.id);
    expect(ids[0]).toBe('chute.launch');
    expect(ids).toContain('chute.flap');
    expect(ids).not.toContain('chute.thump');
    const p = w.part(part)!;
    // the physics' own contacts for it after touchdown (it is handed to physics still): heard or not, never twice
    const contacts = t.of('part.hit').filter((x) => x.step >= landed!.step && (x.e.id === part || x.e.other === part));
    console.log(`pad landing: ${contacts.length} physics contact(s) for ${part} after touchdown (strengths ${contacts.map((x) => x.e.strength.toFixed(2)).join(' ') || 'none'})`);
    const knocks = heard.filter((x) => x.step > from && x.cue.id.startsWith('hit.'));
    // exactly one knock for the new crate, at touchdown, in its own note (no other part is moving near the pad)
    expect(knocks.map((x) => x.cue.id)).toEqual([`hit.${p.material}.${p.size}`]);
    expect(knocks[0]!.step).toBe(landed!.step);
    expect(knocks[0]!.cue.gain).toBeLessThanOrEqual(1);
    w.dispose();
  }, 120_000);

  test('the landing knock is heard once even when the physics contact comes first in the same step', async () => {
    const w = await benchWorld('audio-r1-order');
    const score = new Score();
    const { t } = heardTape(w, score);
    t.run(30);
    putOn(w, t, 'crate-3', onBelt(0.3));
    const launched = t.until((e) => e.type === 'restock.launched', steps(25));
    const part = (launched!.e as Extract<SimEvent, { type: 'restock.launched' }>).part;
    // fly the crate by hand, step by step, up to the step it lands; the score hears each step (it knows the crate's speed)
    for (let i = 0; i < steps(3); i++) {
      w.advance();
      const ev = w.drainEvents();
      const landed = ev.find((e) => e.type === 'restocked' && e.part === part);
      if (!landed) {
        score.hear(w, ev);
        continue;
      }
      // the same step, the contact put first: one knock, the landing's, at the landing's gain
      const cues = score.hear(w, [{ type: 'part.hit', id: part, other: null, strength: 0.5 }, ...ev.filter((e) => e.type !== 'part.hit')]).cues.filter((c) => c.id.startsWith('hit.'));
      expect(cues.length).toBe(1);
      expect(cues[0]!.gain).toBeCloseTo(0.6, 6);
      w.dispose();
      return;
    }
    throw new Error('never landed');
  }, 120_000);

  test('a Button press startles Fetch: one chirp at the press; none with reduced motion', async () => {
    for (const reduced of [false, true]) {
      const w = await benchWorld('audio-r1-button');
      const { t, heard } = heardTape(w);
      t.run(30);
      if (reduced) {
        w.dispatch({ type: 'motion', reduced: true });
        t.run(1);
      }
      const from = w.step;
      w.dispatch({ type: 'press', id: 'button' });
      t.run(steps(2));
      const ids = after(heard, from).map((c) => c.id);
      expect(ids.filter((x) => x === 'fetch.chirp').length, `reduced ${reduced}`).toBe(reduced ? 0 : 1);
      expect(ids).toContain('button.clunk');
      w.dispose();
    }
  }, 120_000);

  test('lifted: Fetch yelps once, not again within two seconds; Patch yelps in its own voice', async () => {
    const w = await benchWorld('audio-r1-held');
    const { t, heard } = heardTape(w);
    t.run(30);
    const grab = (id: string): void => {
      const at = id === 'patch' ? (w.machine('patch') as { at: readonly [number, number, number] }).at : w.motion(id)!.pose.p;
      w.dispatch({ type: 'grab', id, grip: [at[0], at[1] + (id === 'patch' ? 1 : 0), at[2]] });
      t.run(20);
    };
    const letGo = (): void => {
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      t.run(20);
    };
    const from = w.step;
    grab('fetch');
    t.run(30); // held a while: no second yelp
    letGo();
    grab('fetch'); // within two seconds of the first: quiet
    letGo();
    t.run(steps(2.2));
    grab('fetch'); // later: again
    letGo();
    const fetchYelps = heard.filter((x) => x.step > from && x.cue.id === 'fetch.yelp');
    expect(fetchYelps.length).toBe(2);
    expect((fetchYelps[1]!.step - fetchYelps[0]!.step) / HZ).toBeGreaterThanOrEqual(2);
    const p0 = w.step;
    grab('patch');
    letGo();
    expect(after(heard, p0).map((c) => c.id)).toContain('patch.yelp');
    expect(after(heard, p0).map((c) => c.id)).not.toContain('fetch.yelp');
    w.dispose();
  }, 120_000);
});
