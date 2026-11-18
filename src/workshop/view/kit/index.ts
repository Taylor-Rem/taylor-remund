/**
 * The parts kit (REWRITE.md § E3): everything every object in the world is
 * built from. Solids, lathe and sweep, details, surface signals,
 * composition, and realize (the one place meshes are made).
 */
export * from './types.ts';
export { rng, askew, hash2 } from './rng.ts';
export type { Rng } from './rng.ts';
export { MeshData, finish, triangleCount } from './mesh.ts';
export { tint, bakeCavity, bakeStats, surfFromCurvature, surfDebugColors, weld } from './surface.ts';
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
  flat, part, texturedPart, paint, withVariant, large, noShadow, withShadow, mat, T, Rdeg, chain, aim, place, apply, array, mirror, alongEdge, ring, grid,
  mergeGeometries, merge, NodeBuilder, PieceBuilder, piece, countTriangles, pieceBounds, budget,
} from './compose.ts';
export type { PartsLike, Placement, PieceOptions, Budget, BudgetRow } from './compose.ts';
export { realize, drawStats, sourcesOf, SHADOW_LAYER } from './realize.ts';
export { bevelBox, innerBox, skin, decalBands, stud, mergeMarked, sheet, cylinderRibbons, ridgedBand, hexHead, stripes, DIGIT_STROKES } from './cheap.ts';
export type { BevelBoxOptions, FaceName, SheetOptions } from './cheap.ts';
export { grain, setFinish, lposOf, offsetLpos } from './space.ts';
export { LPOS_OFFSET } from './compose.ts';
export type { CatalogueEntry, BuildOptions } from './catalogue.ts';
export type { RealizeOptions, Backend, SkinSource } from './realize.ts';
