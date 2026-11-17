/**
 * The parts kit (REWRITE.md § E3): everything every object in the world is
 * built from. Solids, lathe and sweep, details, surface signals,
 * composition, and realize (the one place meshes are made).
 */
export * from './types.ts';
export { rng, askew, hash2 } from './rng.ts';
export type { Rng } from './rng.ts';
export { MeshData, finish, triangleCount } from './mesh.ts';
export { tint, bakeCavity, surfFromCurvature, surfDebugColors, weld } from './surface.ts';
export type { AoOptions, TintOptions } from './surface.ts';
export { profile, Profile, circleLoop, rectLoop, chamferRectLoop, outlineLoop, ngon, superellipseLoop } from './profile.ts';
export type { Corner, PSample, Loop } from './profile.ts';
export { loft, planFrame } from './loft.ts';
export type { Frame, V3 } from './loft.ts';
export * from './solids.ts';
export { sweep, sections, linePath, polylinePath, arcPath, sBendPath, helixPath, curvePath, joinPaths, pathLength } from './sweep.ts';
export type { Path, SweepOptions } from './sweep.ts';
export { transform, flipWinding, deform, taper, bend, bulge, dent } from './deform.ts';
export * from './details.ts';
export {
  flat, part, texturedPart, paint, mat, T, Rdeg, chain, aim, place, apply, array, mirror, alongEdge, ring, grid,
  mergeGeometries, merge, NodeBuilder, PieceBuilder, piece, countTriangles, pieceBounds,
} from './compose.ts';
export type { PartsLike, Placement, PieceOptions } from './compose.ts';
export { realize } from './realize.ts';
export type { RealizeOptions } from './realize.ts';
