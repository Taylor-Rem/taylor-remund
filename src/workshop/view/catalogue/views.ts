/**
 * The catalogue's review views (W1.5 brief § 2 `?view=`): beauty is the real
 * materials; the others swap a realized piece onto ONE neutral matte material
 * (the materials module's own `paper` class from a separate instance, with
 * its procedural layers turned off) and recolour a copy of each geometry:
 *
 *   clay    one neutral tone: form, bevels and shadow only
 *   wear    the `surf.x` signal (red over the clay tone)
 *   cavity  the `surf.y` signal (blue)
 *   lpos    material-space position as slow colour ramps (yellow to teal
 *           along +X, darker along Y): each part's own frame and its seeded
 *           +X offset show as a different hue; object position where absent
 *   wire    the clay with its wireframe
 *
 * No material is constructed here; colours are derived from palette tokens.
 */
import { BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { linear } from '../palette.ts';
import { ATTR } from '../kit/types.ts';
import type { WorkshopMaterials } from '../materials/index.ts';

export type ViewMode = 'beauty' | 'clay' | 'wear' | 'cavity' | 'lpos' | 'wire';
export const VIEW_MODES: readonly ViewMode[] = ['beauty', 'clay', 'wear', 'cavity', 'lpos', 'wire'];

type RGB = readonly [number, number, number];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** The clay tone: paper cut with steel, a mid neutral (linear rgb). */
export function clayTone(): RGB {
  return scaleRGB(mixRGB(linear('paper'), linear('steel'), 0.45), 0.85);
}

/** Turn a materials instance's `paper` class into plain clay (call once, on an instance used for nothing else). */
export function makeClay(mats: WorkshopMaterials): void {
  for (const [k, v] of Object.entries({ mottle: 0, fibre: 0, fibreBump: 0, cockle: 0, handled: 0, grime: 0, roughness: 0.85 })) {
    try {
      mats.set('paper', k, v);
    } catch {
      /* a parameter the class no longer has */
    }
  }
  // clay is matte: no specular glint for the bloom to pick up
  (mats.of('paper') as unknown as { specularIntensity: number }).specularIntensity = 0.04;
}

/** Per-vertex colours for a debug view of one geometry. */
export function debugColours(g: BufferGeometry, mode: Exclude<ViewMode, 'beauty'>): Float32Array {
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 3);
  const clay = clayTone();
  const surf = g.getAttribute(ATTR.surf);
  const lp = g.getAttribute(ATTR.lpos) ?? g.getAttribute('position');
  const hot = linear('button-red');
  const cold = linear('paint-blue');
  const bandA = linear('tape-yellow');
  const bandB = linear('teal-light');
  for (let i = 0; i < n; i++) {
    let c: RGB = clay;
    if (mode === 'wear' || mode === 'cavity') {
      const v = surf ? (mode === 'wear' ? surf.getX(i) : surf.getY(i)) : 0;
      c = mixRGB(scaleRGB(clay, 0.6), scaleRGB(mode === 'wear' ? hot : cold, 1.6), Math.min(1, Math.max(0, v)));
    } else if (mode === 'lpos') {
      // per-vertex colour can only show slow ramps: hue along +X (the grain), shade along Y
      const fx = (((lp.getX(i) * 1.5) % 1) + 1) % 1;
      const fy = (((lp.getY(i) * 2) % 1) + 1) % 1;
      c = scaleRGB(mixRGB(bandA, bandB, Math.abs(fx * 2 - 1)), 0.55 + 0.45 * fy);
    }
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/**
 * Put a realized piece into a review view. Geometry is copied (pieces may be
 * shared through the kit's build cache), so the original is untouched.
 */
export function applyView(root: Object3D, mode: ViewMode, clayMats: WorkshopMaterials): void {
  if (mode === 'beauty') return;
  const clay = clayMats.of('paper');
  (clay as unknown as { wireframe: boolean }).wireframe = mode === 'wire';
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.setAttribute(ATTR.color, new BufferAttribute(debugColours(g, mode), 3));
    m.geometry = g;
    m.material = clay;
  });
}
