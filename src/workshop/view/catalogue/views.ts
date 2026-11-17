/**
 * The catalogue's review views (W1.5 brief § 2 `?view=`). Beauty is the real
 * materials; clay and the signal views are the materials module's own debug
 * path (`createMaterials({ debug })`, materials/index.ts DEBUG_VIEWS); wire is
 * the clay view drawn as wireframe. Nothing here makes a material or touches
 * geometry.
 */
import { DEBUG_VIEWS, type DebugView } from '../materials/index.ts';

export type ViewMode = 'beauty' | DebugView | 'wire';
export const VIEW_MODES: readonly ViewMode[] = ['beauty', ...DEBUG_VIEWS, 'wire'];

/** The materials debug view a review view is drawn with (undefined: the real look). */
export function debugOf(mode: ViewMode): DebugView | undefined {
  if (mode === 'beauty') return undefined;
  return mode === 'wire' ? 'clay' : mode;
}
