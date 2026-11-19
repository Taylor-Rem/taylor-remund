import { it } from 'vitest';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';

it('timing (scratch)', () => {
  const ms = (f: () => void): number => {
    const a = performance.now();
    f();
    return performance.now() - a;
  };
  const out: string[] = [];
  // what the idle view runs every frame anyway (warm, as in play)
  for (let i = 0; i < 200; i++) {
    const f = PF.resolvePose(PF.SEATED);
    PF.lookAt(f, [1, 1, 3], 0.8);
    PF.nodeMatrix(PF.toPose(PF.withBlinks(PF.withBreath(f, i * 0.016), i * 0.016, [1])), ['body']);
  }
  for (const j of ['belt', 'platen', 'lamp', 'storefront'] as const) {
    const T = PF.jobTargets(j);
    out.push(`job ${j} first use ${ms(() => PF.job(1, T)).toFixed(2)} ms`);
  }
  const T2 = PF.jobTargets('belt');
  out.push(`job per frame ${(ms(() => { for (let i = 0; i < 100; i++) PF.job(i * 0.05, T2); }) / 100).toFixed(3)} ms`);
  for (const j of ['belt', 'platen'] as const) out.push(`rollTo ${j} first ${ms(() => PF.rollTo(0.3, { fromX: PF.REST_X, toX: PF.workX(j) })).toFixed(2)} ms`);
  out.push(`rollTo per frame ${(ms(() => { for (let i = 0; i < 100; i++) PF.rollTo(i * 0.01, { fromX: PF.REST_X, toX: PF.workX('belt') }); }) / 100).toFixed(3)} ms`);
  out.push(`plug first ${ms(() => PF.movePlug(0.3, 'storefront', 'platen', PF.workX('platen'))).toFixed(2)} ms`);
  out.push(`notice first ${ms(() => PF.notice(0.3, [-1, 0.4, 0.5])).toFixed(2)} ms`);
  out.push(`climb first ${ms(() => PF.climb(0.3)).toFixed(2)} ms; per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.climb(i * 0.016); }) / 50).toFixed(3)}`);
  out.push(`catch first ${ms(() => PF.catchCrate(0.5, { shelf: [0.1, 0.2, 0.5] })).toFixed(2)} ms; bonk first ${ms(() => PF.bonked(0.5, { from: [1, 1, 3] })).toFixed(2)} ms; duck ${ms(() => PF.duck(0.5, { from: [1, 1, 3] })).toFixed(2)} ms`);
  out.push(`look first ${ms(() => PF.theLook(1, { plug: [-0.5, 0.2, 0.4] })).toFixed(2)} ms; per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.theLook(i * 0.1, { plug: [-0.5, 0.2, 0.4] }); }) / 50).toFixed(3)}`);
  out.push(`held per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.held(i * 0.1, [0.2, 0, 0]); }) / 50).toFixed(3)}`);
  out.push(`toddle per frame ${(ms(() => { for (let i = 0; i < 50; i++) PF.toddle(i * 0.02, [0.3, -0.4, 0.5], 1); }) / 50).toFixed(3)}`);
  console.log(out.join('\n'));
});
