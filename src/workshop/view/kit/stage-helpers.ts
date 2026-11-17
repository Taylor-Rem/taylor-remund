/**
 * The few meshes the stage itself needs (W1 brief § 1): owned by W1-stage.
 * Everything else in the world comes from kit pieces through realize().
 *
 * - `blobShadowMesh(n, decal)`: n instanced flat quads (unit size, lying on
 *   y = 0, facing up, uv 0..1) for soft contact shadows, drawn with the
 *   materials module's decal (view/effects/blob-shadows.ts).
 */
import { InstancedMesh, PlaneGeometry, type Material } from 'three';

export function blobShadowMesh(count: number, decal: Material): InstancedMesh {
  const g = new PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(g, decal, Math.max(1, count));
  mesh.name = 'blob-shadows';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
