/**
 * Patch's reach table (kit/pieces/patch-felt/reach-table.ts): every arm question the performances ask on
 * the bench, answered by the exact search offline so play never searches.
 *
 *   PATCH_BAKE=1 npx vitest run tests/unit/kit/patch-bake.test.ts    (re-make the table after changing a performance)
 *
 * Without PATCH_BAKE it checks the table is complete: running every bench configuration asks nothing the
 * table cannot answer.
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';
import { SIDE_ON } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { JACKS } from '../../../src/workshop/view/kit/pieces/switchboard/labels.ts';
import { PATCHLAMP } from '../../../src/workshop/sim/index.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';

/** The climb's foot in root space, as the view computes it (seatSpace of PatchView.foot). */
function benchFoot(): PF.V3 {
  const seat = PATCHLAMP.patch.seat, foot = PATCHLAMP.patch.foot;
  const inv = new Matrix4().compose(new Vector3(...seat), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SIDE_ON), new Vector3(PF.CREW, PF.CREW, PF.CREW)).invert();
  const p = new Vector3(...foot).applyMatrix4(inv);
  return [p.x, p.y, p.z];
}

/** Every performance, every configuration the bench can ask for, run through its whole length. */
function everything(): void {
  const span = (L: number, n = 24): number[] => Array.from({ length: n + 1 }, (_, i) => (i / n) * L);
  for (const j of JACKS) {
    const T = PF.jobTargets(j, undefined, PF.VISITOR_BOARD);
    for (const t of span(PF.JOB_LENGTH, 60)) PF.job(t, T);
    PF.reachJack(T.plug);
    PF.reachDrawer(T.handle);
  }
  for (const a of PF.STOOL_STOPS) for (const b of PF.STOOL_STOPS) if (a !== b) for (const t of span(PF.rollLength(a, b))) PF.rollTo(t, { fromX: a, toX: b });
  for (const a of JACKS) for (const b of JACKS) if (a !== b) for (const x of PF.STOOL_STOPS) for (const t of span(PF.PLUG_LENGTH, 8)) PF.movePlug(t, a, b, x);
  for (const foot of [benchFoot(), undefined]) for (const t of span(PF.CLIMB_LENGTH)) PF.climb(t, foot ? { foot } : {});
  for (const from of [[2, 1, 3], [-2, 1, 3]] as PF.V3[]) for (const t of span(PF.BONK_LENGTH)) PF.bonked(t, { from });
  for (const t of span(PF.CATCH_LENGTH)) PF.catchCrate(t);
  // a caught part set on the shelf, from each stop of the stool, for each part a paw can catch
  for (const shelf of benchShelves()) for (const t of span(PF.CATCH_LENGTH, 6)) PF.catchCrate(t, { shelf });
}

/** The shelf point (the part's centre on it) in root space, as the view computes it, for each stool stop and catchable part. */
function benchShelves(): PF.V3[] {
  const out: PF.V3[] = [];
  const seat = PATCHLAMP.patch.seat, shelf = PATCHLAMP.patch.shelf;
  for (const x of PF.STOOL_STOPS) {
    const inv = new Matrix4().compose(new Vector3(seat[0] + (x - PF.REST_X), seat[1], seat[2]), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SIDE_ON), new Vector3(PF.CREW, PF.CREW, PF.CREW)).invert();
    for (const kind of ['crate', 'tool'] as const) {
      for (const size of ['S', 'M'] as const) {
        const h = defaultHalfExtents(kind, size)[1];
        const p = new Vector3(shelf[0], shelf[1] + h + 0.01, shelf[2]).applyMatrix4(inv);
        out.push([p.x, p.y, p.z]);
      }
    }
  }
  return out;
}

describe('patch reach table', () => {
  it.runIf(process.env['PATCH_BAKE'] === '1')('bakes the table (PATCH_BAKE=1)', () => {
    const out = PF.bakeReaches(everything);
    const rows = [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `  '${k}': [${v.join(', ')}],`);
    const head = `/**
 * Patch's arm, worked out when the piece is built (made by tests/unit/kit/patch-bake.test.ts with
 * PATCH_BAKE=1; do not edit by hand). Every question the performances ask on the bench, answered by
 * the exact search (perform.ts \`reachUncached\`, exact): key → [fore, side, twist, short, swing, abduct,
 * armTwist, elbow]. A question not here is answered live by the quick search (and counted in REACH_MISSES).
 */
export const REACH_TABLE: Record<string, readonly number[]> = {
${rows.join('\n')}
};
`;
    writeFileSync(new URL('../../../src/workshop/view/kit/pieces/patch-felt/reach-table.ts', import.meta.url), head);
    expect(out.size).toBeGreaterThan(20);
  });

  it.skipIf(process.env['PATCH_BAKE'] === '1')('answers every bench question from the table (no search in play)', () => {
    PF.clearPerformanceCaches();
    everything();
    expect([...PF.REACH_MISSES]).toEqual([]);
  });
});
