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
  /** While this says false there is no target (the thing is there but cannot be taken now). */
  active: (() => boolean) | null;
}

export interface PickableOptions {
  /** Extra margin round the true box, world units (forgiving edges). Default 0.03. */
  pad?: number;
  /** Use this box (object frame) instead of measuring the object's geometry. */
  box?: Box3;
  /** A target only while this says true (Patch hanging from the edge cannot be taken: no glove over it). */
  active?: () => boolean;
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
const tmpSc = new Vector3();

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
    this.entries.set(id, { id, object, box, pad: opts.pad ?? 0.03, active: opts.active ?? null });
  }

  remove(id: Id): void {
    this.entries.delete(id);
  }

  /** The object `id`'s proxy rides (for a finer test against what is drawn), or null. */
  objectOf(id: Id): Object3D | null {
    return this.entries.get(id)?.object ?? null;
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
      if (e.id === exclude || !visible(e.object) || (e.active && !e.active()) || (opts.filter && !opts.filter(e.id))) continue;
      axisScale(e.object, tmpSc);
      if (Math.min(tmpSc.x, tmpSc.y, tmpSc.z) < HIDDEN_SCALE) continue;
      tmpInv.copy(e.object.matrixWorld).invert();
      tmpRay.copy(ray).applyMatrix4(tmpInv);
      growWorld(tmpBox.copy(e.box), e.pad, tmpSc);
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
      if (e.id === exclude || !visible(e.object) || (e.active && !e.active()) || (opts.filter && !opts.filter(e.id))) continue;
      axisScale(e.object, tmpSc);
      if (Math.min(tmpSc.x, tmpSc.y, tmpSc.z) < HIDDEN_SCALE) continue;
      e.box.getCenter(tmpC).applyMatrix4(e.object.matrixWorld);
      const minHalf = (minPx / 2) * this.unitsPerPixel(tmpC);
      tmpInv.copy(e.object.matrixWorld).invert();
      tmpRay.copy(ray).applyMatrix4(tmpInv);
      growWorld(tmpBox.copy(e.box), e.pad, tmpSc);
      e.box.getCenter(tmpS);
      // the minimum size is a world measure: in the box's own frame it is divided by the axis scale
      const hx = minHalf / tmpSc.x, hy = minHalf / tmpSc.y, hz = minHalf / tmpSc.z;
      tmpBox.min.set(Math.min(tmpBox.min.x, tmpS.x - hx), Math.min(tmpBox.min.y, tmpS.y - hy), Math.min(tmpBox.min.z, tmpS.z - hz));
      tmpBox.max.set(Math.max(tmpBox.max.x, tmpS.x + hx), Math.max(tmpBox.max.y, tmpS.y + hy), Math.max(tmpBox.max.z, tmpS.z + hz));
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
    growWorld(tmpBox.copy(e.box), e.pad, axisScale(e.object, tmpSc));
    faceNormal(tmpBox, tmpP, tmpN).transformDirection(e.object.matrixWorld);
    h.normal.copy(tmpN);
    return h;
  }
}

/**
 * The object's world scale along its own axes, into `out`. Padding and the minimum on-screen size are world
 * measures; the proxy box is in the object's frame, so they are divided by this before they grow the box
 * (a proxy under a node scaled 10× would otherwise grow 10× too far: the Button's cap took most of a phone's
 * screen on touch). A target scaled to almost nothing (the house way of hiding a node) is not there.
 */
function axisScale(o: Object3D, out: Vector3): Vector3 {
  const m = o.matrixWorld.elements;
  return out.set(Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!));
}

/** Grow `box` (object frame) by `w` world units on every side, for an object of this axis scale. */
function growWorld(box: Box3, w: number, sc: Vector3): Box3 {
  box.min.x -= w / sc.x;
  box.min.y -= w / sc.y;
  box.min.z -= w / sc.z;
  box.max.x += w / sc.x;
  box.max.y += w / sc.y;
  box.max.z += w / sc.z;
  return box;
}

/** Below this world scale on any axis, a target has been hidden by scaling it away. */
const HIDDEN_SCALE = 1e-3;

function visible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
