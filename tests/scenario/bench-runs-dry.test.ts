// R3 (Taylor, 2026-11-19: "If there are several boxes laying around out of reach of fetch and haven't been touched
// by the player for a while then I think Revert should be able to come out and clean them up. That way the
// simulation will never get stuck because Fetch can't reach any boxes."). Fetch carries only fresh crates (never
// touched by the visitor, lying still, in no machine), from the pad, else the stack. A visitor who handles every
// crate can leave it nothing to carry. On the whole bench under Rapier, four ways a visitor leaves the bench:
// does the belt ever carry a crate again without them, and when?
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH, AT } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { BeltView, Id, Vec3 } from '../../src/workshop/sim/types.ts';
import { REVERT } from '../../src/workshop/sim/scenes/bench.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
const WAIT = 240; // seconds the visitor then leaves the bench alone
let lastCarried = '';
let trail: string[] = [];
const tray = (): Vec3 => {
  const m = FULL_BENCH.mouths!.find((x) => x.id === 'platen')!;
  return [m.drop[0], m.drop[1], m.drop[2]];
};
/** Crates the visitor can see and take: on the bench, not in a machine. */
const onBench = (w: World): Id[] => CRATES.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest');

/** After the visitor's last action: seconds until a crate is taken onto the belt, or null within WAIT. */
function untilTheBeltCarries(w: World): number | null {
  const t = tape(w);
  trail = [];
  let lastState = '';
  for (let i = 0; i < steps(WAIT); i++) {
    const ev = t.run(1);
    const rv = w.machine('revert-crew') as { state: string; starving: boolean; x: number; z: number };
    const st = `${rv.state}${rv.starving ? '*' : ''}`;
    if (st !== lastState) trail.push(`${(i / HZ).toFixed(0)}s ${st}${process.env.REVERT_DBG ? `@${rv.x.toFixed(1)},${rv.z.toFixed(1)}` : ''}`);
    lastState = st;
    for (const e of ev) if (e.type === 'revert.sweep') trail.push(`${(i / HZ).toFixed(0)}s sweep ${e.part}→${e.to.at}`);
    for (const e of ev) if (e.type === 'restocked') trail.push(`${(i / HZ).toFixed(0)}s restocked ${e.part}`);
    for (const e of ev) if (e.type === 'taken-in' && e.id === 'belt' && e.part.startsWith('crate')) {
      lastCarried = `${e.part} (${w.touched(e.part) ? 'touched' : 'fresh'}, written by ${w.writer(e.part, 'location')})`;
      return i / HZ;
    }
  }
  return null;
}

/**
 * The visitor first takes in hand every crate there is to take (one riding the belt is lifted off it; the one in
 * Fetch's claws is waited for) and does `act` with them; crates still shipped behind the dock's door are left.
 */
function everyCrate(w: World, act: (ids: Id[]) => void): void {
  const t = tape(w);
  let quiet = 0;
  for (let k = 0; k < 16 && quiet < 2; k++) {
    // lift off the belt anything riding it (a visitor taking it back)
    for (const id of CRATES) if (w.mode(id) === 'machine' && w.part(id)!.location.at === 'in' && (w.machine('belt') as BeltView).riding.includes(id)) {
      const p = w.motion(id)!.pose.p;
      putOn(w, t, id, [p[0], 0, p[2] - 1.6]);
    }
    const fresh = onBench(w).filter((id) => !w.touched(id));
    const inClaws = CRATES.some((id) => w.mode(id) === 'crew');
    const busy = CRATES.some((id) => ['machine', 'chute'].includes(w.mode(id) ?? '')); // riding, shipping, coming up the chute
    if (fresh.length === 0 && !inClaws && !busy) {
      quiet++;
      t.run(steps(5));
      continue;
    }
    quiet = 0;
    act(onBench(w));
    t.run(steps(5));
  }
}

async function settled(seed: string): Promise<World> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  // the opening lap plays out first (attract mode), then the visitor arrives
  tape(w).run(steps(25));
  return w;
}

const CORNERS: Vec3[] = [[-8.3, 0, -4.3], [8.3, 0, -4.4], [-8.3, 0, 4.4], [-7.6, 0, -3.4]];

describe('R3: can the visitor leave the bench with nothing for Fetch to carry?', () => {
  test('control: left alone, the belt carries a crate within a minute', async () => {
    const w = await settled('dry-control');
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 0.5 }); // play mode, nothing else
    const t = untilTheBeltCarries(w);
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(60);
  }, 120_000);

  const cases: [string, (w: World) => void][] = [
    ['(a) every crate lifted once and set back where it was', (w) => {
      const t = tape(w);
      everyCrate(w, (ids) => {
        for (const id of ids.filter((x) => !w.touched(x))) {
          const p = w.motion(id)!.pose.p;
          putOn(w, t, id, [p[0], p[1] - w.halfExtents(id)![1], p[2]]);
          t.run(steps(1));
        }
      });
    }],
    ['(b) three crates strewn out of Fetch\'s reach', (w) => {
      const t = tape(w);
      let n = 0;
      everyCrate(w, (ids) => {
        for (const id of ids.filter((x) => !w.touched(x))) {
          putOn(w, t, id, CORNERS[n++ % CORNERS.length]!);
          t.run(steps(1));
        }
      });
    }],
    ['(c) every crate thrown into one corner', (w) => {
      const t = tape(w);
      let n = 0;
      everyCrate(w, (ids) => {
        for (const id of ids.filter((x) => !w.touched(x))) {
          const i = n++;
          putOn(w, t, id, [-8.2 + 0.7 * (i % 2), 0, -4.2 + 0.7 * Math.floor(i / 2)]);
          t.run(steps(1));
        }
      });
    }],
    ['(d) the stack\'s crates carried to the platen\'s tray and left', (w) => {
      // the stack's crates to the tray; every other crate the visitor has handled too (lifted and set back)
      const t = tape(w);
      const [x, y, z] = tray();
      let n = 0;
      everyCrate(w, (ids) => {
        for (const id of ids.filter((x2) => !w.touched(x2))) {
          const p = w.motion(id)!.pose.p;
          const onStack = Math.hypot(p[0] - AT.stack[0], p[2] - AT.stack[1]) < 0.6;
          if (onStack && n < 2) putOn(w, t, id, [x + (n++ ? 0.5 : -0.4), y, z]);
          else putOn(w, t, id, [p[0], p[1] - w.halfExtents(id)![1], p[2]]);
          t.run(steps(1));
        }
      });
    }],
  ];
  for (const [name, act] of cases) {
    test(`${name}: the belt carries a crate again without the visitor`, async () => {
      const w = await settled(`dry-${name.slice(1, 2)}`);
      const before = onBench(w);
      act(w);
      const t = untilTheBeltCarries(w);
      const report = `${name}: crates on the bench ${before.join(', ')}; touched now ${CRATES.filter((id) => w.touched(id)).join(', ') || 'none'}; the belt carried a crate after ${t === null ? `NEVER (${WAIT} s)` : `${t.toFixed(1)} s: ${lastCarried}`}`;
      process.stderr.write(`\n${report}\n  ${trail.join(' | ')}\n`);
      expect(t, report).not.toBeNull();
      expect(t!, report).toBeLessThan(90);
    }, 300_000);
  }

  test('(e) a crate left on Revert\'s hatch (2026-11-20: a crate Fetch may not carry brings Revert out by itself): Revert wants up for it, knocks it in from below, and it comes back up the chute', async () => {
    const w = await settled('dry-e');
    const t = tape(w);
    const id = CRATES.find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
    putOn(w, t, id, [REVERT.home.x, 0, REVERT.home.z]);
    const trailE: string[] = [];
    let last = '';
    let knocked = -1;
    let back = -1;
    for (let i = 0; i < steps(60) && back < 0; i++) {
      for (const e of t.run(1)) {
        if (e.type === 'revert.sweep' && e.part === id && e.to.at === 'shipped') knocked = i / HZ;
        if (e.type === 'restocked' && e.part === id) back = i / HZ;
      }
      const st = (w.machine('revert-crew') as { state: string }).state;
      if (st !== last) trailE.push(`${(i / HZ).toFixed(1)}s ${st}`);
      last = st;
    }
    const report = `(e) ${id} on the hatch: knocked in at ${knocked.toFixed(1)} s, back up the chute at ${back.toFixed(1)} s\n  ${trailE.join(' | ')}`;
    process.stderr.write(`\n${report}\n`);
    expect(trailE.some((x) => x.includes('stuck')), report).toBe(true); // it found its hatch covered
    expect(knocked, report).toBeGreaterThan(0);
    expect(back, report).toBeGreaterThan(knocked);
  }, 300_000);

  test('UNDO after Revert tidied the crate the visitor had set down: the crate is not pulled back; the lever goes on to older things, and nothing throws', async () => {
    const w = await settled('dry-undo');
    const t = tape(w);
    // (2026-11-20) one crate thrown to a corner: Revert comes for it a few seconds later
    const thrown = CRATES.find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
    putOn(w, t, thrown, CORNERS[0]!);
    // wait for a tidy
    let tidied: Id | null = null;
    for (let i = 0; i < steps(WAIT) && !tidied; i++) for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.to.at === 'rest') tidied = e.part;
    expect(tidied).not.toBeNull();
    // the visitor's transactions about it are forgotten (rule 14): none on the stack names it
    expect(w.undoStack().flatMap((x) => x.entries).some((e) => e.target === tidied)).toBe(false);
    const where = () => JSON.stringify(w.part(tidied!)!.location);
    t.run(steps(1));
    const before = w.undoStack().length;
    const seen: string[] = [];
    for (let k = 0; k < before + 3; k++) {
      w.dispatch({ type: 'press', id: 'undo-lever' });
      for (const e of t.run(steps(0.5))) {
        if (e.type === 'undone') seen.push(`undone ${e.restores.map((r) => r.target).join(',')}${e.kept.length ? ` kept ${e.kept.map((x) => x.target).join(',')}` : ''}`);
        if (e.type === 'undo.refused') seen.push(`refused ${e.reason}`);
        if (e.type === 'card') seen.push(`card ${e.content}`);
      }
    }
    process.stderr.write(`\nUNDO after a tidy of ${tidied}: stack ${before}; ${seen.join(' | ')}\n`);
    // the lever never pulled the tidied crate back to where the visitor had set it
    expect(seen.some((x) => x.startsWith('undone') && x.includes(tidied!))).toBe(false);
    expect(['system', 'crew', 'settled']).toContain(w.writer(tidied!, 'location')); // nobody's transaction: the lever cannot take it
    void where;
  }, 300_000);
});

