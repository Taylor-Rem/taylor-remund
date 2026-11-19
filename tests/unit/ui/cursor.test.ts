// R1: the bench's glove cursor: who gets it, its pictures, its hotspots.
import { describe, expect, it } from 'vitest';
import { gloveHotspot, gloveSvg, GLOVE, GLOVES, GLOVE_POSES, POSE_OF, wantsGlove } from '../../../src/workshop/ui/cursor.ts';

describe('the glove cursor', () => {
  it('only a fine pointer that hovers gets it; more contrast, forced colours or reduced motion keep the system cursor', () => {
    const asks = (yes: string[]) => (q: string) => yes.some((y) => q.includes(y));
    const mouse = ['any-hover: hover', 'pointer: fine'];
    expect(wantsGlove(asks(mouse))).toBe(true);
    expect(wantsGlove(asks(['pointer: fine']))).toBe(false); // touch only
    expect(wantsGlove(asks([...mouse, 'prefers-contrast: more']))).toBe(false);
    expect(wantsGlove(asks([...mouse, 'forced-colors: active']))).toBe(false);
    expect(wantsGlove(asks([...mouse, 'prefers-reduced-motion: reduce']))).toBe(false);
  });

  it('four poses, each a 32 px SVG with its hotspot inside the picture', () => {
    for (const look of Object.values(GLOVES))
      for (const p of GLOVE_POSES) {
        const svg = gloveSvg(p, look);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('viewBox="0 0 32 32"');
        const [x, y] = gloveHotspot(p);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(32);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(32);
      }
    // a pointing finger's hotspot is its fingertip: near the top of the picture
    expect(gloveHotspot('point')[1]).toBeLessThan(6);
  });

  it('each of input’s cursors has a pose; the glove in use is a candidate', () => {
    expect(Object.keys(POSE_OF).sort()).toEqual(['default', 'grab', 'grabbing', 'pointer']);
    expect(GLOVES[GLOVE]).toBeTruthy();
  });
});
