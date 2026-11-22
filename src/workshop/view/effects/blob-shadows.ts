/**
 * Blob contact shadows (W1 brief § 1, REWRITE.md § E7 low tier): a soft
 * dark decal under an object, so it sits on the bench instead of hovering.
 * The low tier uses them instead of cast shadows; the high tier may use them
 * to ground small things that the shadow map is too coarse for.
 *
 * One instanced draw for every blob. Each blob is an ellipse: centre on the
 * bench, radii in x and z, and a strength 0..1. The look (radial falloff,
 * teal-deep tint, depth test without write, polygon offset) is the materials
 * module's decal: `new BlobShadows(materials.decal(), capacity, opacity)`.
 * Strength rides in the instance colour's red channel, which the decal reads;
 * this file configures no material.
 */
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh, type Material, type Object3D } from 'three';
import { blobShadowMesh } from '../kit/stage-helpers.ts';
import { createMaterials } from '../materials/index.ts';

export interface Blob {
  x: number;
  z: number;
  /** Radii along x and z. */
  rx: number;
  rz: number;
  /** 0..1. */
  strength: number;
  /** Rotation about +Y, radians. */
  angle?: number;
  /** Height of the surface the blob lies on (default the bench, 0). */
  y?: number;
}

/**
 * DEPRECATED fallback for callers still using `new BlobShadows(capacity, opacity)`:
 * one decal from a materials instance of its own, made once. Delete when every
 * caller passes `materials.decal()`.
 */
let fallbackDecal: Material | null = null;
function legacyDecal(): Material {
  fallbackDecal ??= createMaterials({ tier: 'high' }).decal();
  return fallbackDecal;
}

export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly capacity: number;
  /** Multiplies every blob's strength (the old per-instance opacity, relative to the decal's own). */
  private readonly gain: number;
  private count = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly c = new Color();

  /**
   * @param decal the materials module's decal (`materials.decal()`), shared.
   * @param capacity most blobs drawn.
   * @param opacity overall darkness 0..1, as an absolute opacity (the decal's own opacity is divided out).
   */
  constructor(decal: Material, capacity?: number, opacity?: number);
  /** @deprecated pass `materials.decal()` first. */
  constructor(capacity?: number, opacity?: number);
  constructor(a?: Material | number, b?: number, c?: number) {
    const legacy = typeof a !== 'object';
    const decal = legacy ? legacyDecal() : a;
    this.capacity = (legacy ? a : b) ?? 64;
    const opacity = (legacy ? b : c) ?? decal.opacity;
    this.gain = decal.opacity > 0 ? opacity / decal.opacity : 1;
    this.mesh = blobShadowMesh(this.capacity, decal);
    this.mesh.renderOrder = -1;
    // the instance colour exists from the start (F1): the decal's program reads it, and made by the first
    // `set` it made a second program, linked in the first frame (none is drawn while count is 0)
    this.mesh.setColorAt(0, this.c.setScalar(0));
    this.mesh.count = 0;
  }

  /** Replace every blob. */
  set(blobs: readonly Blob[]): void {
    this.count = Math.min(blobs.length, this.capacity);
    for (let i = 0; i < this.count; i++) this.write(i, blobs[i]!);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Move or change one blob (e.g. under a part being carried: smaller and fainter as it rises). */
  update(i: number, b: Blob): void {
    if (i >= this.count) return;
    this.write(i, b);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private write(i: number, b: Blob): void {
    this.q.setFromAxisAngle(this.up, b.angle ?? 0);
    this.p.set(b.x, (b.y ?? 0) + 0.003, b.z);
    this.s.set(b.rx * 2, 1, b.rz * 2);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    // Not a colour: the strength rides in the instance colour (the decal reads .r).
    this.mesh.setColorAt(i, this.c.setScalar(Math.min(1, Math.max(0, b.strength * this.gain))));
  }

  addTo(parent: Object3D): this {
    parent.add(this.mesh);
    return this;
  }

  /** Disposes the geometry only: the decal material belongs to the materials module. */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
