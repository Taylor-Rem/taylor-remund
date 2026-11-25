/**
 * L2, a candidate behind `?corner=1` (development): the Button's cap as an illuminated push button. Its cap is the
 * `bulb` class in its 'button' variant (kit/types.ts MaterialVariant), whose shader multiplies its glow by this
 * uniform; the Button's view (view/stations/button.ts) writes it each frame as the cap breathes. Every other bulb
 * ignores it.
 *
 *   u_buttonGlow  the cap's glow now, 0 (dark) .. 1 (its full level)
 */
export const BUTTON_GLOW = {
  u_buttonGlow: { value: 1 },
};
