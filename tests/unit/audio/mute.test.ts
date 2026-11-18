// Mute is remembered in the visitor's own browser (§ B9, § E10), and survives a browser that refuses storage.
import { afterEach, describe, expect, test, vi } from 'vitest';

const store = (): Storage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('mute', () => {
  test('starts unmuted, toggles, tells listeners, and is remembered for the next visit', async () => {
    const s = store();
    vi.stubGlobal('localStorage', s);
    const m = await import('../../../src/workshop/audio/mute.ts');
    expect(m.isMuted()).toBe(false);
    const seen: boolean[] = [];
    const off = m.onMuted((b) => seen.push(b));
    expect(m.toggleMuted()).toBe(true);
    m.setMuted(true); // no change, no call
    m.setMuted(false);
    off();
    m.setMuted(true);
    expect(seen).toEqual([true, false]);
    expect(s.data.get('workshop.sound.muted')).toBe('1');
    vi.resetModules();
    const again = await import('../../../src/workshop/audio/mute.ts');
    expect(again.isMuted()).toBe(true);
  });

  test('a browser that refuses storage: unmuted, and muting still works for the visit', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    const m = await import('../../../src/workshop/audio/mute.ts');
    expect(m.isMuted()).toBe(false);
    m.setMuted(true);
    expect(m.isMuted()).toBe(true);
  });
});
