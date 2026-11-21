/**
 * The light of lit station lamps on what is beside them (T1; REWRITE.md § A "Only bulbs and indicator lamps
 * glow"; § E3 "bloom on bulbs"): a soft warm disc round each lit lamp, facing the camera, added to what is behind
 * it. Not a light (the frame budget has none to spare): one mesh, one draw call for every lamp, none while no lamp
 * is lit. The look (falloff, `amber-glow`, additive, depth-tested without depth write) is the materials module's
 * `halo()`; this file configures no material.
 *
 * A glow has a radius in world units and a floor in CSS px, so a lamp across the bench on a phone still glows
 * enough to be seen; it is drawn a little toward the camera from the lamp so the housing it sits in does not cut it.
 */
import { Vector3, type BufferAttribute, type Material, type Mesh, type PerspectiveCamera } from 'three';
import { haloMesh } from '../kit/stage-helpers.ts';

/** Tune here. */
export const HALO_TUNING = {
  /** The glow's brightness at a lamp's full level (linear, × amber-glow; the bloom threshold is 4.5). */
  gain: 2.8,
  /** Drawn this share of its radius toward the camera. */
  forward: 0.6,
} as const;

export class LampHalos {
  readonly mesh: Mesh;
  private readonly cap: number;
  private n = 0;
  private camera: PerspectiveCamera | null = null;
  private H = 900;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly toCam = new Vector3();
  private readonly c = new Vector3();
  private readonly v = new Vector3();

  constructor(materials: { halo?: () => Material }, capacity: number) {
    const m = materials.halo?.();
    if (!m) throw new Error('lamp-halos: the materials module has no halo()');
    this.cap = capacity;
    this.mesh = haloMesh(capacity, m);
  }

  /** Start a frame's glows, for this camera (its matrices current) and the stage's height in CSS px. */
  begin(camera: PerspectiveCamera, cssHeight: number): void {
    this.camera = camera;
    this.H = cssHeight;
    this.n = 0;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  }

  /** A glow at `p` (world), `r` units across at least `minPx` CSS px, at `level` 0..1. */
  add(p: Vector3, r: number, minPx: number, level: number): void {
    const cam = this.camera;
    if (!cam || this.n >= this.cap) return;
    this.toCam.setFromMatrixPosition(cam.matrixWorld).sub(p);
    const dist = this.toCam.length();
    this.toCam.normalize();
    // world units per CSS px at that distance
    const perPx = (2 * dist * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / (cam.zoom * this.H);
    const rad = Math.max(r, minPx * perPx);
    this.c.copy(p).addScaledVector(this.toCam, rad * HALO_TUNING.forward);
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    const col = this.mesh.geometry.getAttribute('color') as BufferAttribute;
    const k = this.n * 4;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    corners.forEach(([sx, sy], i) => {
      this.v.copy(this.c).addScaledVector(this.right, sx * rad).addScaledVector(this.up, sy * rad);
      pos.setXYZ(k + i, this.v.x, this.v.y, this.v.z);
      const g = level * HALO_TUNING.gain;
      col.setXYZ(k + i, g, g, g);
    });
    this.n++;
  }

  /** Finish the frame: draw what was added (nothing, and no draw call, if none). */
  end(): void {
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.n * 6);
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
