// What `/` keeps in the visitor's browser and the settings (P3 B3; REWRITE.md § B10, § E10): every stored value
// is untrusted, anything unknown is the default; effective reduced motion; storage that throws is a visit that
// is not remembered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effectiveReduced,
  MOTION_KEY,
  parseMotion,
  parseQuality,
  QUALITY_KEY,
  readKey,
  reducedFromStored,
  writeKey,
  type MotionSetting,
} from '../../../src/workshop/shell/saved.ts';

const HOSTILE: [string, unknown][] = [
  ['null (no key)', null],
  ['undefined', undefined],
  ['empty', ''],
  ['upper case', 'REDUCED'],
  ['with spaces', ' reduced '],
  ['a number', 1],
  ['true', true],
  ['an object', { motion: 'reduced' }],
  ['an array', ['reduced']],
  ['JSON of a valid value', '"reduced"'],
  ['a prototype name', '__proto__'],
  ['toString', 'toString'],
  ['a megabyte', 'x'.repeat(1 << 20)],
  ['another setting’s value', 'still'],
];

describe('parseMotion: system, reduced or full; anything else is system', () => {
  it.each(HOSTILE)('%s → system', (_, v) => expect(parseMotion(v)).toBe('system'));
  it.each(['system', 'reduced', 'full'] as const)('%s → itself', (v) => expect(parseMotion(v)).toBe(v));
});

describe('parseQuality: auto, high, low or still; anything else is auto', () => {
  it.each([...HOSTILE.filter(([n]) => !n.startsWith('another')), ['another setting’s value', 'reduced'] as [string, unknown]])('%s → auto', (_, v) => expect(parseQuality(v)).toBe('auto'));
  it.each(['auto', 'high', 'low', 'still'] as const)('%s → itself', (v) => expect(parseQuality(v)).toBe(v));
});

describe('effective reduced motion: the setting says reduced, or it follows the system and the system says reduce', () => {
  it.each<[MotionSetting, boolean, boolean]>([
    ['system', false, false],
    ['system', true, true],
    ['reduced', false, true],
    ['reduced', true, true],
    ['full', false, false],
    ['full', true, false],
  ])('%s, system reduces %s → %s', (m, sys, out) => expect(effectiveReduced(m, sys)).toBe(out));

  it('from the raw stored value (the head runs this before the first paint): anything unknown follows the system', () => {
    for (const [, v] of HOSTILE) {
      expect(reducedFromStored(v, true)).toBe(true);
      expect(reducedFromStored(v, false)).toBe(false);
    }
  });

  it('is self-contained: its source runs inline in the head', () => {
    const f = new Function(`return (${reducedFromStored.toString()})('reduced', false);`) as () => boolean;
    expect(f()).toBe(true);
  });
});

describe('storage', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('absent: nothing is read, nothing is kept, nothing throws', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    expect(readKey(MOTION_KEY)).toBeNull();
    expect(writeKey(MOTION_KEY, 'reduced')).toBe(false);
  });

  it('throwing (a private window, a sandbox, a full quota): the same', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(readKey(QUALITY_KEY)).toBeNull();
    expect(writeKey(QUALITY_KEY, 'still')).toBe(false);
  });

  it('a quota exceeded on write: false, no throw', () => {
    const store = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    expect(writeKey(QUALITY_KEY, 'low')).toBe(false);
  });
});

describe('the settings, as a page sees them', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
    });
    vi.resetModules();
  });

  it('read once from storage (hostile values as the default); a change is stored, the default as no key; listeners hear it', async () => {
    store.set(MOTION_KEY, 'sideways');
    store.set(QUALITY_KEY, 'low');
    const m = await import('../../../src/workshop/shell/saved.ts');
    expect(m.getSettings()).toEqual({ motion: 'system', quality: 'low' });
    const heard: unknown[] = [];
    m.onSettings((s, was) => heard.push([s, was]));
    m.setSettings({ motion: 'full' });
    expect(store.get(MOTION_KEY)).toBe('full');
    m.setSettings({ quality: 'auto', motion: 'system' });
    expect(store.has(QUALITY_KEY)).toBe(false);
    expect(store.has(MOTION_KEY)).toBe(false);
    m.setSettings({ quality: 'auto' }); // no change: no one is told
    expect(heard).toEqual([
      [{ motion: 'full', quality: 'low' }, { motion: 'system', quality: 'low' }],
      [{ motion: 'system', quality: 'auto' }, { motion: 'full', quality: 'low' }],
    ]);
    // a hostile value handed in is the default too
    m.setSettings({ quality: 'ultra' as never });
    expect(m.getSettings().quality).toBe('auto');
  });
});
