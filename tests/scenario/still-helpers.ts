// P3 S1: what moves on the bench, step to step (reduced motion's tests, tests/scenario/still.test.ts).
import type { World } from '../../src/workshop/sim/world.ts';

/** Every body's pose and every crew member's place, pose and hands: what a visitor could see move. */
export function picture(w: World): string {
  const bodies = [...w.parts()].map((p) => {
    const m = w.motion(p.id)!;
    return m.mode === 'gone' || m.mode === 'chute' ? [p.id, m.mode] : [p.id, m.mode, m.pose.p, m.pose.q];
  });
  const crew = w.crewViews().map((c) => {
    if (c.kind === 'fetch') {
      const m = c.member;
      return ['fetch', m.x, m.z, m.heading, m.hands, m.carrying];
    }
    // Patch: its whole view, its stage's clock included (the view performs a stage over that clock: if it runs, Patch
    // moves). Revert: everything but its clocks (down its hatch, its state's clock runs and nothing is seen to move).
    if (c.kind === 'patch') return ['patch', JSON.stringify(c.view)];
    return [c.id, JSON.stringify(c.view, (k, x) => (typeof x === 'number' && /time|Time|since/.test(k) ? undefined : x))];
  });
  const belt = w.machine('belt') as { surface?: number } | undefined;
  return JSON.stringify({ bodies, crew, belt: belt?.surface ?? null });
}

/** Step `n` times; the last step at which the picture changed (0: never), counted from the first of these steps. */
export function lastChange(w: World, n: number): number {
  let prev = picture(w);
  let last = 0;
  for (let i = 1; i <= n; i++) {
    w.advance();
    w.drainEvents();
    const now = picture(w);
    if (now !== prev) last = i;
    prev = now;
  }
  return last;
}
