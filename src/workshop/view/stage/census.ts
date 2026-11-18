/**
 * The census (H1): where one frame's draw calls and triangles go, counted at
 * the source. Every draw three makes goes through
 * `WebGLRenderer.renderBufferDirect` (the main pass, the shadow pass, every
 * post pass); for ONE frame the census wraps it and records, per draw, the
 * pass it belongs to, the piece it belongs to, the material class and the
 * triangles `renderer.info` added for it. Nothing changes in what is drawn.
 *
 * THE COUNTING METHOD (every engineer measures this way; `budget(piece)` in
 * the kit counts the same geometry triangles without a renderer):
 *   - "triangles" of a draw = what three adds to `info.render.triangles` for
 *     it: index (or vertex) count of its draw range / 3, × instances;
 *   - main pass = draws of the scene into the scene target, after frustum
 *     culling (what the camera sees, whole meshes, not clipped triangles);
 *   - shadow pass = draws into the key light's shadow map (every mesh with
 *     castShadow inside the shadow camera's frustum, drawn with its depth
 *     material);
 *   - post = the full-screen passes (2 triangles each, GTAO included);
 *   - the scene figure gated by § E7 (180 calls, 250,000 triangles) is
 *     main + shadow; post is reported, not gated.
 *   - a piece = the nearest ancestor carrying `userData.kitPiece` (realize
 *     sets it), else the nearest named ancestor below the scene.
 */
import type { BufferGeometry, Material, Object3D, Scene, WebGLRenderer } from 'three';

export type Pass = 'main' | 'shadow' | 'post';

export interface Draw {
  pass: Pass;
  piece: string;
  /** The kit material class (or the material's type for non-kit draws). */
  material: string;
  mesh: string;
  triangles: number;
  skinned: boolean;
  instanced: number;
}

export interface PieceRow {
  piece: string;
  main: { calls: number; triangles: number };
  shadow: { calls: number; triangles: number };
  /** Draw calls in the main pass by material class. */
  byMaterial: Record<string, number>;
}

export interface Census {
  draws: Draw[];
  pieces: PieceRow[];
  totals: Record<Pass, { calls: number; triangles: number }>;
}

function pieceOf(o: Object3D, scene: Scene): string {
  let named = '';
  for (let a: Object3D | null = o; a && a !== scene; a = a.parent) {
    const k = a.userData['kitPiece'] as string | undefined;
    if (k) return k;
    if (a.name && a.parent === scene) named = a.name;
  }
  return named || o.name || o.type;
}

/**
 * Draw one frame with `draw()` and count it. `scene` is the stage's scene
 * (the main pass); everything drawn inside the shadow map's render is the
 * shadow pass; anything else (full-screen quads) is post.
 */
export function census(renderer: WebGLRenderer, scene: Scene, draw: () => void): Census {
  const draws: Draw[] = [];
  const r = renderer as WebGLRenderer & { renderBufferDirect: (...a: unknown[]) => void };
  const sm = renderer.shadowMap as unknown as { render: (...a: unknown[]) => void };
  const origDraw = r.renderBufferDirect;
  const origShadow = sm.render;
  let inShadow = false;
  sm.render = function (this: unknown, ...a: unknown[]) {
    inShadow = true;
    try {
      return origShadow.apply(this, a);
    } finally {
      inShadow = false;
    }
  };
  r.renderBufferDirect = function (this: unknown, ...a: unknown[]) {
    const [, sc, , material, object] = a as [unknown, Object3D | null, BufferGeometry, Material, Object3D];
    const before = renderer.info.render.triangles;
    const out = origDraw.apply(this, a);
    const tris = renderer.info.render.triangles - before;
    const pass: Pass = inShadow ? 'shadow' : sc === scene ? 'main' : 'post';
    const m = object as Object3D & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    draws.push({
      pass,
      piece: pass === 'post' ? (material.name || material.type) : pieceOf(object, scene),
      material: (object.userData['kitMaterial'] as string | undefined) ?? (object.userData['shadowProxy'] ? 'proxy' : material.type),
      mesh: object.name,
      triangles: tris,
      skinned: !!m.isSkinnedMesh,
      instanced: m.isInstancedMesh ? (m.count ?? 0) : 0,
    });
    return out;
  };
  try {
    draw();
  } finally {
    // both are own properties set in three's constructors: put the originals back
    r.renderBufferDirect = origDraw;
    sm.render = origShadow;
  }
  return summarise(draws);
}

export function summarise(draws: Draw[]): Census {
  const rows = new Map<string, PieceRow>();
  const totals: Census['totals'] = { main: { calls: 0, triangles: 0 }, shadow: { calls: 0, triangles: 0 }, post: { calls: 0, triangles: 0 } };
  for (const d of draws) {
    totals[d.pass].calls++;
    totals[d.pass].triangles += d.triangles;
    if (d.pass === 'post') continue;
    let row = rows.get(d.piece);
    if (!row) rows.set(d.piece, (row = { piece: d.piece, main: { calls: 0, triangles: 0 }, shadow: { calls: 0, triangles: 0 }, byMaterial: {} }));
    row[d.pass].calls++;
    row[d.pass].triangles += d.triangles;
    if (d.pass === 'main') row.byMaterial[d.material] = (row.byMaterial[d.material] ?? 0) + 1;
  }
  const pieces = [...rows.values()].sort((a, b) => b.main.triangles + b.shadow.triangles - (a.main.triangles + a.shadow.triangles));
  return { draws, pieces, totals };
}

/** Triangles in a piece's realised geometry (the meshes the camera draws; shadow proxies not counted), whatever the camera sees. */
export function geometryTriangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Object3D & { isMesh?: boolean; geometry?: BufferGeometry; isInstancedMesh?: boolean; count?: number };
    if (!m.isMesh || !m.geometry || o.userData['shadowProxy']) return;
    const g = m.geometry;
    const c = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
    const range = Math.min(c, g.drawRange.count);
    n += Math.floor(range / 3) * (m.isInstancedMesh ? (m.count ?? 1) : 1);
  });
  return n;
}
