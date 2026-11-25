/**
 * (E1) The view's side of a late unit: where each late crew member's views are fetched from. The shell's late loader
 * (shell/late.ts) asks for them after the bench is usable; the dynamic import lives here, in the view, so that the
 * shell names no station (scripts/check-layers.ts). Each target is a chunk of its own (astro.config `late-*` groups).
 */
/** Pitch's views and pieces (his chunk). One function per unit, so a build where he is off leaves it out altogether. */
export const pitchViews = (): Promise<typeof import('./late/pitch.ts')> => import('./late/pitch.ts');
