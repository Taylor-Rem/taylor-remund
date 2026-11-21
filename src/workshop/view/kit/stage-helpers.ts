/**
 * The few meshes the stage itself needs (W1 brief § 1): owned by W1-stage.
 * Everything else in the world comes from kit pieces through realize().
 *
 * - `blobShadowMesh(n, decal)`: n instanced flat quads (unit size, lying on
 *   y = 0, facing up, uv 0..1) for soft contact shadows, drawn with the
 *   materials module's decal (view/effects/blob-shadows.ts).
 * - `focusMarkMesh(marks, material)` (I1): the keyboard focus mark's one mesh,
 *   room for `marks` marks of four corner brackets each (two bars a corner, a
 *   quad a bar), positions and colours written each frame by
 *   view/stations/focus.ts, in world space. One draw call.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedMesh, Mesh, PlaneGeometry, type Material } from 'three';

/** Vertices of one focus mark: 4 corners × 2 bars × 4 corners of a quad. */
export const FOCUS_MARK_VERTS = 32;

export function focusMarkMesh(marks: number, material: Material): Mesh {
  const n = Math.max(1, marks) * FOCUS_MARK_VERTS;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3).setUsage(DynamicDrawUsage));
  const idx: number[] = [];
  for (let q = 0; q < n / 4; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mesh = new Mesh(g, material);
  mesh.name = 'focus-mark';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return mesh;
}

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

/**
 * T1: the station lamps' glows (view/effects/lamp-halos.ts): one mesh with room for `n` quads (uv 0..1 each),
 * corners and levels written each frame in world space, facing the camera. One draw call, none while no lamp is lit.
 */
export function haloMesh(n: number, material: Material): Mesh {
  const k = Math.max(1, n);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(k * 4 * 3), 3).setUsage(DynamicDrawUsage));
  g.setAttribute('color', new BufferAttribute(new Float32Array(k * 4 * 3), 3).setUsage(DynamicDrawUsage));
  const uv = new Float32Array(k * 8);
  const idx: number[] = [];
  for (let q = 0; q < k; q++) {
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
    idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mesh = new Mesh(g, material);
  mesh.name = 'lamp-halos';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}
