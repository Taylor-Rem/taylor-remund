// What choosing where to get up costs (the body Patch; sim/crew/patch-body.ts `getUp`).
//
// The step in which its body comes to rest chooses where it gets on its feet: a place it can stand AND walk home
// from. "Can walk home from" plans the whole walk (the route planner, 2 to 15 ms a route on the reference laptop),
// and that step once asked it of every candidate before any cheaper question: dropped at the back line of the bench
// it planned 105 walks in one step, a third of a second in which nothing on the bench moved (found 2026-11-20 by
// frame times on the page: a 233 ms frame as it landed; the soak never saw it, because every session ended on the
// stool). The outcome tests cannot see this, so this one counts routes.
//
// Counted, not timed: a count is the same on a busy machine.
import { expect, test, vi } from 'vitest';

const routes = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/workshop/sim/crew/fetch-route.ts', async (original) => {
  const m = (await original()) as Record<string, unknown>;
  const route = m.route as (...a: unknown[]) => unknown;
  return {
    ...m,
    route: (...a: unknown[]) => {
      routes.n++;
      return route(...a);
    },
  };
});

import { lift, patch, world } from './patch-body-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

/** The most routes one step may plan as it lands (measured: 1 or 2 nearly everywhere, 7 at the worst place found). */
const MOST = 14;

test('dropped anywhere over the bench, the step it lands in plans a handful of routes, not one for every place it might get up', async () => {
  const seen = new Map<number, number>();
  let worst = { n: 0, at: '' };
  let landed = 0;
  for (let x = -8.5; x <= 8.5; x += 1)
    for (let z = -4.5; z <= 4.5; z += 1.5) {
      const { w, t } = await world();
      lift(w, t, [x, 3.2, z] as Vec3, 10);
      w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      let last = patch(w).state;
      for (let i = 0; i < 12 * HZ; i++) {
        routes.n = 0;
        t.run(1);
        const st = patch(w).state;
        // (the step its body is taken out of the world and the script has it: lying, at a wall, on a ledge, away)
        if (last === 'fly' && st !== 'fly') {
          landed++;
          seen.set(routes.n, (seen.get(routes.n) ?? 0) + 1);
          if (routes.n > worst.n) worst = { n: routes.n, at: `${x}, ${z} (${st})` };
          break;
        }
        last = st;
      }
      w.dispose();
    }
  console.log(`routes planned in the landing step, over ${landed} drops: ${[...seen.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} routes ${c}x`).join(', ')}; the most at ${worst.at}`);
  expect(landed).toBeGreaterThan(100);
  expect(worst.n, `the most routes in one landing step, at ${worst.at}`).toBeLessThanOrEqual(MOST);
}, 600_000);
