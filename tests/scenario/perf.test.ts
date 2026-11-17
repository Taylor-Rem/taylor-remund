// What one fixed step costs, headless (Node, Rapier wasm, no rendering). § E7: 60 loose bodies awake is the scene budget.
import { expect, test } from 'vitest';
import { rapierWorld } from './helpers.ts';
import { vignette } from '../../src/workshop/sim/scenes/vignette.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import type { SceneDesc, PartSpec } from '../../src/workshop/sim/scene.ts';
import type { PartSize } from '../../src/workshop/sim/types.ts';

/** The vignette plus extra crates dropped in a loose heap over the bench, so they are tumbling while measured. */
function heap(total: number): SceneDesc {
  const extra: PartSpec[] = [];
  const sizes: PartSize[] = ['S', 'M', 'L'];
  for (let i = 0; extra.length + vignette.parts.length < total; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8) % 4;
    const layer = Math.floor(i / 32);
    extra.push({
      id: `extra-${i}`,
      kind: 'crate',
      size: sizes[i % 3]!,
      material: i % 4 === 0 ? 'metal' : 'wood',
      colour: 'paper',
      label: '',
      station: 'line',
      name: 'name.crate',
      pose: { p: [-6 + col * 1.6, 3 + layer * 1.2 + (i % 5) * 0.1, -3.5 + row * 1.4], q: qyaw(i * 0.37) },
    });
  }
  return { ...vignette, parts: [...vignette.parts, ...extra] };
}

async function measure(total: number, awake: boolean): Promise<{ bodies: number; msPerStep: number; stepsPerSecond: number }> {
  const w = await rapierWorld('perf', { scene: heap(total) });
  const bodies = [...w.parts()].length;
  if (awake) {
    // throw everything up so it is all tumbling during the measurement
    let k = 0;
    for (const p of w.parts()) {
      if (w.mode(p.id) !== 'free') continue;
      const m = w.motion(p.id)!;
      w.dispatch({ type: 'grab', id: p.id, grip: m.pose.p });
      w.dispatch({ type: 'release', velocity: [((k % 5) - 2) * 1.5, 4 + (k % 3), ((k % 7) - 3)] });
      w.advance();
      w.drainEvents();
      k++;
    }
  }
  if (!awake) for (let i = 0; i < 600; i++) w.advance();
  w.drainEvents();
  let awakeAtStart = 0;
  for (const p of w.parts()) if (w.motion(p.id)!.awake) awakeAtStart++;
  // thrown: measure the first second of tumbling, while nearly everything is awake
  const n = awake ? 60 : 300;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    w.advance();
    w.drainEvents();
  }
  const ms = (performance.now() - t0) / n;
  w.dispose();
  console.log(`${bodies} bodies (${awakeAtStart} awake at the start of the window): ${ms.toFixed(3)} ms/step, ${Math.round(1000 / ms)} steps/s, ${((ms / 16.7) * 100).toFixed(1)}% of a 60 Hz frame`);
  return { bodies, msPerStep: ms, stepsPerSecond: 1000 / ms };
}

test('step cost with ~10 and ~60 bodies', { timeout: 60_000 }, async () => {
  await measure(10, true); // warm-up (wasm tiering)
  const results = [await measure(10, false), await measure(10, true), await measure(60, false), await measure(60, true)];
  // Wall-clock ceilings are only meaningful on a quiet machine: the numbers are
  // always printed, and asserted only when asked (PERF_ASSERT=1), so a loaded
  // machine cannot fail the verify gate with a false regression.
  for (const r of results) expect(Number.isFinite(r.msPerStep) && r.msPerStep > 0).toBe(true);
  if (process.env.PERF_ASSERT === '1') {
    for (const r of results) expect(r.msPerStep).toBeLessThan(r.bodies > 30 ? 8 : 3);
  }
});
