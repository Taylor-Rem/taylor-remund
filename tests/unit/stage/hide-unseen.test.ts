import { describe, expect, test } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { hideUnseen } from '../../../src/workshop/view/stage/index.ts';
import { SHADOW_LAYER } from '../../../src/workshop/view/kit/index.ts';

// three's `compile` ignores layers and visibility: it would build a program for every shadow proxy's material,
// which no frame ever uses (the camera never draws that layer). The precompile leaves out what the camera cannot
// see (its material is taken away for the call, which is how `compile` passes a mesh by), then puts it back.
describe('hideUnseen', () => {
  const build = () => {
    const scene = new Scene();
    const piece = new Group();
    const seen = new Mesh(undefined, new MeshBasicMaterial());
    const proxy = new Mesh(undefined, new MeshBasicMaterial());
    proxy.layers.set(SHADOW_LAYER);
    piece.add(seen, proxy);
    scene.add(piece);
    return { scene, seen, proxy, camera: new PerspectiveCamera() };
  };
  /** What `compile` would prepare: every mesh's material, as three r187 walks them (WebGLRenderer.compile). */
  const compiled = (scene: Scene): unknown[] => {
    const out: unknown[] = [];
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material) out.push(m.material);
    });
    return out;
  };

  test('a mesh on a layer the camera does not draw is left out of a compile; everything else is in it', () => {
    const { scene, seen, proxy, camera } = build();
    const proxys = proxy.material;
    hideUnseen(scene, camera);
    expect(compiled(scene)).toEqual([seen.material]);
    expect(compiled(scene)).not.toContain(proxys);
  });

  test('the returned function gives back exactly what was taken (the shadow pass needs it)', () => {
    const { scene, seen, proxy, camera } = build();
    const before = [seen.material, proxy.material];
    hideUnseen(scene, camera)();
    expect([seen.material, proxy.material]).toEqual(before);
    expect(proxy.visible).toBe(true);
  });

  test('a camera that draws the layer leaves nothing out (the key light’s own)', () => {
    const { scene, camera } = build();
    camera.layers.enable(SHADOW_LAYER);
    hideUnseen(scene, camera);
    expect(compiled(scene)).toHaveLength(2);
  });
});
