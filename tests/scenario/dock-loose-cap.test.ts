// R3 (S5's review): the dock sends a crate Revert dropped down its hatch back up the chute only while the bench
// holds fewer than `looseMax` crates, counting those it already owes back (a restock queued, not yet thrown).
// Three crates dropped down the hatch inside one second must not bring the bench over the cap; and the crate that
// comes back is the very crate that went down.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH } from './line-helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';
import type { SimContext, Unit } from '../../src/workshop/sim/context.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Vec3 } from '../../src/workshop/sim/types.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
/** The whole bench with a seventh crate behind the door (the large spare it had before P4 S5): one more than `looseMax`. */
const SEVEN = { ...FULL_BENCH, parts: [...FULL_BENCH.parts, { id: 'crate-spare-3', kind: 'crate' as const, size: 'L' as const, material: 'wood' as const, colour: 'bare', label: '', station: 'line' as const, name: 'name.crate', pose: { p: [0, -4, 0] as Vec3, q: [0, 0, 0, 1] as const }, shipped: true }] };
const loose = (w: World): Id[] => CRATES.filter((id) => w.part(id)!.location.at !== 'shipped');

/** Where the test's own hand fills the bench: open floor, clear of the pad, the stack and every machine. */
const FILL: Vec3[] = [[-2.4, 0.5, -0.3], [-1.3, 0.5, -0.3], [-3.5, 0.5, -0.3]];
/**
 * A stand-in for Revert at its hatch: on the steps asked, it drops the crate named down its hatch, as Revert does;
 * and (`ups`) puts a shipped spare on the bench, to fill it first. (Once sent up the chute: since 2026-11-20 a fresh
 * crate that comes back up the chute waits there until the pad is free for it, and in attract mode nobody clears the
 * pad, so the fill never arrived.)
 */
function hatch(drops: Map<number, Id>, ups: Map<number, Id>): (ctx: SimContext) => Unit {
  return (ctx) => ({
    id: 'test-hatch',
    pre() {
      const up = ups.get(ctx.clock.step);
      if (up) ctx.launch(up, { p: FILL[[...ups.values()].indexOf(up)] as Vec3, q: [0, 0, 0, 1] }, [0, 0, 0], [0, 0, 0], 'system');
      const id = drops.get(ctx.clock.step);
      if (!id) return;
      const from = ctx.pose(id)!;
      ctx.emit({ type: 'revert.sweep', id: 'revert', part: id, from, to: { at: 'shipped' } });
      ctx.putAway(id, { at: 'shipped' });
    },
  }) as Unit;
}

describe('R3: the dock\'s cap on loose crates', () => {
  test('three crates down the hatch within a second: the bench never holds more than looseMax, and each that comes back is one that went down', async () => {
    const drops = new Map<number, Id>();
    const ups = new Map<number, Id>();
    // (P4 S5: the bench has six crates, exactly `looseMax`, so it can never hold more by itself; the cap is held against the
    // bench with the third spare it had before the crates became Taylor's six projects)
    const w = await benchWorld('loose-cap', { scene: SEVEN, units: [hatch(drops, ups)] });
    const t = tape(w);
    // the bench filled to looseMax + 1 (two spares up the chute), and settled
    const spares = CRATES.filter((id) => w.part(id)!.location.at === 'shipped');
    spares.slice(0, DOCK_TUNING.looseMax + 1 - loose(w).length).forEach((id, i) => ups.set(steps(2 + 5 * i), id));
    t.run(steps(30));
    const before = loose(w);
    expect(before.length).toBe(DOCK_TUNING.looseMax + 1);
    const down = before.filter((id) => w.mode(id) === 'free').slice(0, 3);
    expect(down.length).toBe(3);
    const at = w.step + 10;
    down.forEach((id, i) => drops.set(at + i * steps(0.4), id));
    let most = 0;
    const back: Id[] = [];
    for (let i = 0; i < steps(60); i++) {
      for (const e of t.run(1)) if (e.type === 'restocked' || (e.type as string) === 'thrown') back.push((e as { part: Id }).part);
      if (w.step > at) most = Math.max(most, loose(w).length); // (from the first drop: it began one over, by the test's own hand)
    }
    const returned = down.filter((id) => w.part(id)!.location.at !== 'shipped');
    process.stderr.write(`\nloose before ${before.length}; dropped ${down.join(', ')}; came back ${returned.join(', ') || 'none'}; most loose ${most}\n`);
    expect(most).toBeLessThanOrEqual(DOCK_TUNING.looseMax);
    // as many come back as the cap allows (counting those owed), and only crates that went down
    expect(returned.length).toBe(Math.max(0, Math.min(3, DOCK_TUNING.looseMax - (before.length - 3))));
    expect(loose(w).filter((id) => !before.includes(id))).toEqual([]);
    w.dispose();
  }, 120_000);
});
