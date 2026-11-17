/**
 * The few meshes the stage itself needs (W1 brief § 1): owned by W1-stage.
 * Everything else in the world comes from kit pieces through realize().
 *
 * - `blobShadowMesh(n)`: n instanced flat quads (unit size, lying on y = 0,
 *   facing up) for soft contact shadows. Three gives the mesh its default
 *   basic material; view/effects/blob-shadows.ts configures it (no material
 *   is constructed here or there).
 */
import { InstancedMesh, PlaneGeometry } from 'three';

export function blobShadowMesh(count: number): InstancedMesh {
  const g = new PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(g, undefined, Math.max(1, count));
  mesh.name = 'blob-shadows';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
