// F1: work a frame did that no pixel showed, taken out; these keep it out.
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, ShaderChunk, ShaderLib, type WebGLRenderer } from 'three';
import { canvasAttributes } from '../../../src/workshop/view/stage/index.ts';
import { defaultFlags, PostChain } from '../../../src/workshop/view/stage/post.ts';
import { coatOnlyWhereCoated } from '../../../src/workshop/view/materials/index.ts';

describe('the canvas (F1)', () => {
  it('with the post chain: no multisampling and no depth buffer of its own (the composite is one full-screen triangle)', () => {
    expect(canvasAttributes('high', true)).toEqual({ antialias: false, depth: false });
  });
  it('without it (the low tier, ?post=0) the scene is drawn to the canvas, which keeps both', () => {
    expect(canvasAttributes('low', true)).toEqual({ antialias: true, depth: true });
    expect(canvasAttributes('high', false)).toEqual({ antialias: true, depth: true });
  });
});

/** A renderer that only records what the post chain asks of it. */
function recorder(): { r: WebGLRenderer; calls: Array<{ what: 'render' | 'clear'; autoClear: boolean }> } {
  const calls: Array<{ what: 'render' | 'clear'; autoClear: boolean }> = [];
  let target: unknown = null;
  const r = {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    info: { render: { calls: 0, triangles: 0 } },
    setRenderTarget(t: unknown) {
      target = t;
    },
    getRenderTarget: () => target,
    clear() {
      calls.push({ what: 'clear', autoClear: r.autoClear });
    },
    render() {
      calls.push({ what: 'render', autoClear: r.autoClear });
    },
  };
  return { r: r as unknown as WebGLRenderer, calls };
}

describe('the post chain clears nothing its passes overwrite (F1)', () => {
  it('the scene is drawn with the renderer clearing as before; every full-screen pass after it without a clear', () => {
    const { r, calls } = recorder();
    const flags = { ...defaultFlags(), gtao: false };
    const chain = new PostChain(r, new Scene(), new PerspectiveCamera(), flags);
    chain.setSize(1440, 900);
    chain.render(30, null);
    const renders = calls.filter((c) => c.what === 'render');
    // the scene, the bloom pyramid (prefilter, 4 down, 4 up), the focus blur, the composite
    expect(renders.length).toBe(1 + 9 + 1 + 1);
    expect(renders[0]!.autoClear).toBe(true);
    for (const c of renders.slice(1)) expect(c.autoClear).toBe(false);
    // and the renderer is left as it was found
    expect((r as unknown as { autoClear: boolean }).autoClear).toBe(true);
  });
});

describe('the clearcoat lobe is worked out only where there is a coat (F1)', () => {
  it('guards each of the three places three adds it, and fails loudly if three moves them', () => {
    let fs = ShaderLib.physical.fragmentShader;
    expect(fs).toContain('#include <lights_physical_pars_fragment>');
    expect(fs).toContain('#include <lights_fragment_maps>');
    fs = coatOnlyWhereCoated(fs);
    expect(fs).not.toContain('#include <lights_physical_pars_fragment>');
    expect(fs.match(/if \( material\.clearcoat > 0\.0 \) clearcoat/g)?.length).toBe(3);
    // the rest of the chunks is three's own, unchanged
    expect(fs).toContain(ShaderChunk.lights_physical_pars_fragment.split('clearcoatSpecularDirect +=')[0]!);
    expect(() => coatOnlyWhereCoated('#include <lights_physical_pars_fragment>\n#include <lights_fragment_maps>'.replace('lights_fragment_maps', 'nothing'))).toThrow();
  });
});
