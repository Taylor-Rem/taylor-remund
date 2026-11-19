import { describe, expect, it } from 'vitest';
import type { WebGLRenderer } from 'three';
import { Atlas } from '../../../src/workshop/view/labels/atlas.ts';

/** A renderer that records the GL calls the band uploads make. */
function fakeRenderer(): { renderer: WebGLRenderer; calls: string[] } {
  const calls: string[] = [];
  const tex = {};
  const gl = {
    TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, NONE: 0,
    UNPACK_FLIP_Y_WEBGL: 10, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 11, UNPACK_COLORSPACE_CONVERSION_WEBGL: 12, UNPACK_ALIGNMENT: 13,
    UNPACK_ROW_LENGTH: 14, UNPACK_SKIP_PIXELS: 15, UNPACK_SKIP_ROWS: 16,
    texSubImage2D: (_t: number, _l: number, x: number, y: number, w: number, h: number) => calls.push(`sub ${x},${y} ${w}x${h}`),
    generateMipmap: () => calls.push('mip'),
  };
  const renderer = {
    getContext: () => gl,
    state: { bindTexture: () => {}, unbindTexture: () => {}, pixelStorei: (k: number, v: number) => k >= 14 && calls.push(`store ${k}=${v}`) },
    properties: { get: () => ({ __webglTexture: tex }) },
  } as unknown as WebGLRenderer;
  return { renderer, calls };
}

describe('band uploads', () => {
  it('send a live page’s new rows a band per texSubImage2D, a frame’s budget at a time, and rebuild the mips once', () => {
    const at = new Atlas(1, { bandBytes: 64 * 1024, frameBytes: 128 * 1024 });
    const { renderer, calls } = fakeRenderer();
    at.attach(renderer);
    const a = at.place('flat', 300, 200)!;
    const v = a.page.views(a.rect);
    v.map.onUpdate!(v.map); // the first upload has happened: the page is live
    const rows = new Uint8Array(300 * 200 * 4).fill(9);
    a.page.writeRows(a.rect, 0, rows, 200);
    // nothing until a frame pumps; then at most two bands of 64 KB (316 texels wide with gutters: 51 rows a band)
    expect(calls.filter((c) => c.startsWith('sub'))).toHaveLength(0);
    at.pump();
    const subs1 = calls.filter((c) => c.startsWith('sub'));
    expect(subs1).toHaveLength(2);
    expect(subs1[0]).toBe(`sub ${a.rect.x - 8},${a.rect.y - 8} 316x51`);
    expect(calls).not.toContain('mip');
    for (let i = 0; i < 5; i++) at.pump();
    const subs = calls.filter((c) => c.startsWith('sub'));
    // 216 rows in bands of 51: 5 bands, then the mips once
    expect(subs).toHaveLength(5);
    expect(calls.filter((c) => c === 'mip')).toHaveLength(1);
    expect(at.queued()).toBe(0);
    // the band is cut out of the page's own copy
    expect(calls).toContain(`store 14=${a.page.w}`);
  });
});
