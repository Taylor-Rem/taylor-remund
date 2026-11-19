import { it } from 'vitest';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';

it('timing (scratch)', () => {
  const ms = (f: () => void): number => {
    const a = performance.now();
    f();
    return performance.now() - a;
  };
  const out: string[] = [];
  // warm the JIT on something unrelated to the caches
  for (let i = 0; i < 3; i++) PF.reach([-0.3 + i * 0.01, 0.35, 0.25], 'right');
  const T = PF.jobTargets('platen');
  out.push(`cold reach handle ${ms(() => PF.reach(T.handle, 'right', PF.atWork(T), { swivel: PF.WORK_SWIVEL })).toFixed(1)} ms`);
  // what the idle view runs every frame anyway (warm, as in play)
  for (let i = 0; i < 200; i++) {
    const f = PF.resolvePose(PF.SEATED);
    PF.lookAt(f, [1, 1, 3], 0.8);
    PF.nodeMatrix(PF.toPose(PF.withBlinks(PF.withBreath(f, i * 0.016), i * 0.016, [1])), ['body']);
  }
  out.push(`job first use (no idle warm) not measured here`);
  const T2 = PF.jobTargets('belt');
  out.push(`job first use ${ms(() => PF.job(1, T2)).toFixed(1)} ms`);
  out.push(`job per frame ${(ms(() => { for (let i = 0; i < 100; i++) PF.job(i * 0.1, T2); }) / 100).toFixed(3)} ms`);
  out.push(`rollTo first ${ms(() => PF.rollTo(1, { fromX: PF.REST_X, toX: PF.workX('belt') })).toFixed(1)} ms`);
  out.push(`rollTo per frame ${(ms(() => { for (let i = 0; i < 100; i++) PF.rollTo(i * 0.03, { fromX: PF.REST_X, toX: PF.workX('belt') }); }) / 100).toFixed(3)} ms`);
  out.push(`climb first ${ms(() => PF.climb(1)).toFixed(1)} ms; per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.climb(i * 0.06); }) / 50).toFixed(3)}`);
  out.push(`catch first ${ms(() => PF.catchCrate(0.5, { shelf: [0.1, 0.2, 0.5] })).toFixed(1)} ms; bonk first ${ms(() => PF.bonked(0.5, { from: [1, 1, 3] })).toFixed(1)} ms; duck ${ms(() => PF.duck(0.5, { from: [1, 1, 3] })).toFixed(1)} ms`);
  out.push(`look first ${ms(() => PF.theLook(1, { plug: [-0.5, 0.2, 0.4] })).toFixed(1)} ms; per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.theLook(i * 0.1, { plug: [-0.5, 0.2, 0.4] }); }) / 50).toFixed(3)}`);
  out.push(`held per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.held(i * 0.1, [0.2, 0, 0]); }) / 50).toFixed(3)}`);
  console.log(out.join('\n'));
});
