// The tier table (REWRITE.md § E7; P3 B1): what is known before anything heavy loads → high, low or still.
import { describe, expect, it } from 'vitest';
import { chooseTier, FAILURES_TO_STILL, isSoftwareRenderer, quickStill, SMALL_MEMORY_GB, type TierSignals } from '../../../src/workshop/shell/tier.ts';

const GPU = 'ANGLE (AMD, Vulkan 1.4.305 (AMD Radeon Graphics (RADV RENOIR) (0x00001638)), radv)';
const capable: TierSignals = { override: null, webgl2: true, renderer: GPU, saveData: false, deviceMemory: 8, failures: 0, saved: null, measured: null };
const with_ = (o: Partial<TierSignals>): TierSignals => ({ ...capable, ...o });

describe('chooseTier', () => {
  it.each<[string, Partial<TierSignals>, 'high' | 'low' | 'still', string]>([
    ['a capable machine', {}, 'high', 'capable'],
    ['no WebGL 2', { webgl2: false, renderer: null }, 'still', 'no WebGL 2'],
    ['SwiftShader (Chrome without a GPU)', { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }, 'still', 'software renderer'],
    ['llvmpipe (Mesa without a GPU)', { renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }, 'still', 'software renderer'],
    ['Microsoft Basic Render Driver', { renderer: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)' }, 'still', 'software renderer'],
    ['Apple Software Renderer', { renderer: 'Apple Software Renderer' }, 'still', 'software renderer'],
    ['data saver', { saveData: true }, 'still', 'data saver'],
    ['failed twice this session', { failures: FAILURES_TO_STILL }, 'still', 'failed before'],
    ['failed once: still tries', { failures: 1 }, 'high', 'capable'],
    ['small memory', { deviceMemory: SMALL_MEMORY_GB - 2 }, 'low', 'small memory'],
    ['memory unknown (not Chromium)', { deviceMemory: null }, 'high', 'capable'],
    ['exactly 4 GB is not small', { deviceMemory: 4 }, 'high', 'capable'],
    ['an earlier visit’s probe failed', { measured: 'low' }, 'low', 'slow frames before'],
    ['the renderer’s name hidden (privacy): judged by the rest', { renderer: null }, 'high', 'capable'],
    ['saved: low', { saved: 'low' }, 'low', 'saved setting'],
    ['saved: high beats small memory and an old probe', { saved: 'high', deviceMemory: 2, measured: 'low' }, 'high', 'saved setting'],
    ['saved: still', { saved: 'still' }, 'still', 'saved setting'],
    ['saved: auto chooses', { saved: 'auto', deviceMemory: 2 }, 'low', 'small memory'],
    ['saved: high cannot run without WebGL 2', { saved: 'high', webgl2: false }, 'still', 'no WebGL 2'],
    ['?tier=high over a software renderer (tests in other engines)', { override: 'high', renderer: 'SwiftShader' }, 'high', 'address'],
    ['?tier=low', { override: 'low' }, 'low', 'address'],
    ['?tier=still on a capable machine', { override: 'still' }, 'still', 'address'],
    ['?tier=nonsense is ignored', { override: 'ultra' }, 'high', 'capable'],
  ])('%s → %s', (_name, o, tier, why) => {
    expect(chooseTier(with_(o))).toEqual({ tier, why });
  });

  it('a software renderer is never taken for a GPU, nor a GPU for software', () => {
    for (const gpu of [GPU, 'Apple M2', 'Mali-G78', 'Adreno (TM) 740', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel(R) Iris(R) Xe Graphics']) expect(isSoftwareRenderer(gpu), gpu).toBe(false);
  });
});

describe('quickStill (the head’s inline decision, before any context is made)', () => {
  const q = (o: Partial<Parameters<typeof quickStill>[0]>): boolean => quickStill({ override: null, saveData: false, failures: 0, saved: null, hasWebgl2Api: true, ...o });
  it('agrees with the table wherever it decides without a context', () => {
    expect(q({})).toBe(false);
    expect(q({ hasWebgl2Api: false })).toBe(true);
    expect(q({ saveData: true })).toBe(true);
    expect(q({ failures: FAILURES_TO_STILL })).toBe(true);
    expect(q({ failures: FAILURES_TO_STILL - 1 })).toBe(false);
    expect(q({ saved: 'still' })).toBe(true);
    expect(q({ override: 'still' })).toBe(true);
    expect(q({ override: 'high', saveData: true, hasWebgl2Api: false })).toBe(false);
    for (const o of [{ saveData: true }, { failures: FAILURES_TO_STILL }, { saved: 'still' as const }, { override: 'still' }, { override: 'low' }, { override: 'high', saveData: true }]) {
      expect(q(o), JSON.stringify(o)).toBe(chooseTier(with_(o)).tier === 'still');
    }
  });

  it('is self-contained: its source runs on its own (the page inlines it)', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const f = new Function(`return (${quickStill.toString()})`)() as typeof quickStill;
    expect(f({ override: null, saveData: true, failures: 0, saved: null, hasWebgl2Api: true })).toBe(true);
    expect(f({ override: null, saveData: false, failures: 0, saved: null, hasWebgl2Api: true })).toBe(false);
  });
});
