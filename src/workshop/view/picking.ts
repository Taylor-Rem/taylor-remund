/**
 * Picking (REWRITE.md § B1, § B6, § E9): which interactable or loose part is
 * under a ray. This is what `ViewContext.pickable(id, object)` writes to.
 *
 * Picks are made against simple proxies, never against render meshes: each
 * registered object gets one oriented box, measured once from its geometry
 * in its own frame and carried by its world matrix from then on. Two passes:
 *
 *   1. the true boxes (a little padding), nearest along the ray wins;
 *   2. if nothing was hit, every box grown to a minimum size on screen
 *      (44 px on touch, § E9), and the one whose centre is nearest the ray
 *      wins, so two small things side by side split the space between them.
 *
 * Nothing allocates per pick: scratch vectors and one reused hit object.
 * The cost is one 4×4 inverse per registered object per pick, a few dozen
 * for the whole vignette.
 */
import { Box3, Matrix4, Ray, Vector3, type Mesh, type Object3D, type PerspectiveCamera } from 'three';
import type { Id } from '../sim/types.ts';

export interface PickHit {
  id: Id;
  /** World point where the ray meets the proxy (on the true box when hit there). */
  readonly point: Vector3;
  /** World normal of the proxy face hit. */
  readonly normal: Vector3;
  /** Distance along the ray. */
  distance: number;
  /** True when only the grown (minimum-size) proxy was hit. */
  grown: boolean;
}

export interface PickOptions {
  /** Ignore this id (the thing being carried). */
  exclude?: Id | null;
  /** Minimum on-screen size of a proxy in CSS pixels (touch: 44). Default 0. */
  minPx?: number;
  /** Only consider ids for which this returns true. */
  filter?: (id: Id) => boolean;
}

interface Entry {
  id: Id;
  object: Object3D;
  /** The proxy in the object's own frame. */
  box: Box3;
  /** Padding added to every side of the true box, world units. */
  pad: number;
}

export interface PickableOptions {
  /** Extra margin round the true box, world units (forgiving edges). Default 0.03. */
  pad?: number;
  /** Use this box (object frame) instead of measuring the object's geometry. */
  box?: Box3;
}

const tmpInv = new Matrix4();
const tmpRay = new Ray();
const tmpBox = new Box3();
const tmpP = new Vector3();
const tmpC = new Vector3();
const tmpN = new Vector3();
const tmpS = new Vector3();
const tmpM = new Matrix4();
const fwd = new Vector3();

/** The object's geometry bounds in its own frame (children included). */
export function localBounds(object: Object3D, out = new Box3()): Box3 {
  out.makeEmpty();
  object.updateWorldMatrix(true, true);
  const inv = tmpM.copy(object.matrixWorld).invert();
  object.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb || bb.isEmpty()) return;
    tmpBox.copy(bb).applyMatrix4(new Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    out.union(tmpBox);
  });
  return out;
}

/** Which face of an axis-aligned box a point on its surface lies on, as an outward normal. */
function faceNormal(box: Box3, p: Vector3, out: Vector3): Vector3 {
  let best = Infinity;
  out.set(0, 1, 0);
  const d = [p.x - box.min.x, box.max.x - p.x, p.y - box.min.y, box.max.y - p.y, p.z - box.min.z, box.max.z - p.z];
  const n: [number, number, number][] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let i = 0; i < 6; i++) {
    const v = Math.abs(d[i]!);
    if (v < best) {
      best = v;
      const k = n[i]!;
      out.set(k[0], k[1], k[2]);
    }
  }
  return out;
}

export class Picking {
  private readonly entries = new Map<Id, Entry>();
  private readonly hit: PickHit = { id: '', point: new Vector3(), normal: new Vector3(), distance: 0, grown: false };
  private camera: PerspectiveCamera | null = null;
  private viewportH = 1;

  /** Register (or replace) an object as the proxy owner for `id`. */
  add(id: Id, object: Object3D, opts: PickableOptions = {}): void {
    const box = opts.box ? opts.box.clone() : localBounds(object);
    if (box.isEmpty()) box.set(new Vector3(-0.05, -0.05, -0.05), new Vector3(0.05, 0.05, 0.05));
    this.entries.set(id, { id, object, box, pad: opts.pad ?? 0.03 });
  }

  remove(id: Id): void {
    this.entries.delete(id);
  }

  has(id: Id): boolean {
    return this.entries.has(id);
  }

  ids(): IterableIterator<Id> {
    return this.entries.keys();
  }

  /** The proxy of `id` in its object's own frame (read-only), or null. */
  localBox(id: Id): Box3 | null {
    return this.entries.get(id)?.box ?? null;
  }

  /** The proxy of `id` in world space (an axis-aligned box round its oriented box), for tests and debug overlays. */
  worldBox(id: Id, out = new Box3()): Box3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return out.copy(e.box).applyMatrix4(e.object.matrixWorld);
  }

  /** What the pixel minimum is measured with: the camera and the viewport height in CSS pixels. */
  setView(camera: PerspectiveCamera, viewportHeightPx: number): void {
    this.camera = camera;
    this.viewportH = Math.max(1, viewportHeightPx);
  }

  /** World units per CSS pixel at this world point (0 without a camera). */
  unitsPerPixel(p: Vector3): number {
    const cam = this.camera;
    if (!cam) return 0;
    cam.getWorldDirection(fwd);
    const depth = Math.max(1e-3, tmpS.copy(p).sub(cam.position).dot(fwd));
    return (2 * depth * Math.tan((cam.fov * Math.PI) / 360)) / (this.viewportH * (cam.zoom || 1));
  }

  /** The nearest pickable under the ray, or null. The returned object is reused by the next call. */
  pick(ray: Ray, opts: PickOptions = {}): PickHit | null {
    const exclude = opts.exclude ?? null;
    let bestD = Infinity;
    let best: Entry | null = null;
    // pass 1: the true boxes
    for (const e of this.entries.values()) {
      if (e.id === exclude || !visible(e.object) || (opts.filter && !opts.filter(e.id))) continue;
      tmpInv.copy(e.object.matrixWorld).invert();
      tmpRay.copy(ray).applyMatrix4(tmpInv);
      tmpBox.copy(e.box).expandByScalar(e.pad);
      if (!tmpRay.intersectBox(tmpBox, tmpP)) continue;
      tmpP.applyMatrix4(e.object.matrixWorld);
      const d = tmpP.distanceTo(ray.origin);
      if (d < bestD) {
        bestD = d;
        best = e;
        this.hit.point.copy(tmpP);
      }
    }
    if (best) return this.finish(best, ray, false);
    const minPx = opts.minPx ?? 0;
    if (minPx <= 0 || !this.camera) return null;
    // pass 2: grown to the minimum on-screen size; nearest centre to the ray wins
    let bestPerp = Infinity;
    for (const e of this.entries.values()) {
      if (e.id === exclude || !visible(e.object) || (opts.filter && !opts.filter(e.id))) continue;
      e.box.getCenter(tmpC).applyMatrix4(e.object.matrixWorld);
      const minHalf = (minPx / 2) * this.unitsPerPixel(tmpC);
      tmpInv.copy(e.object.matrixWorld).invert();
      tmpRay.copy(ray).applyMatrix4(tmpInv);
      tmpBox.copy(e.box).expandByScalar(e.pad);
      e.box.getCenter(tmpS);
      tmpBox.min.set(Math.min(tmpBox.min.x, tmpS.x - minHalf), Math.min(tmpBox.min.y, tmpS.y - minHalf), Math.min(tmpBox.min.z, tmpS.z - minHalf));
      tmpBox.max.set(Math.max(tmpBox.max.x, tmpS.x + minHalf), Math.max(tmpBox.max.y, tmpS.y + minHalf), Math.max(tmpBox.max.z, tmpS.z + minHalf));
      if (!tmpRay.intersectBox(tmpBox, tmpP)) continue;
      const perp = ray.distanceSqToPoint(tmpC);
      if (perp < bestPerp) {
        bestPerp = perp;
        best = e;
        this.hit.point.copy(tmpP).applyMatrix4(e.object.matrixWorld);
      }
    }
    return best ? this.finish(best, ray, true) : null;
  }

  private finish(e: Entry, ray: Ray, grown: boolean): PickHit {
    const h = this.hit;
    h.id = e.id;
    h.grown = grown;
    h.distance = h.point.distanceTo(ray.origin);
    // normal: the face of the (padded) local box the local hit point lies on
    tmpInv.copy(e.object.matrixWorld).invert();
    tmpP.copy(h.point).applyMatrix4(tmpInv);
    tmpBox.copy(e.box).expandByScalar(e.pad);
    faceNormal(tmpBox, tmpP, tmpN).transformDirection(e.object.matrixWorld);
    h.normal.copy(tmpN);
    return h;
  }
}

function visible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
