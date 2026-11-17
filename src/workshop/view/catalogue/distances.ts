/**
 * The catalogue's three review distances (W1.5 brief § 2), as pure camera
 * maths on the stage's own lens and pitch, so a test can hold them to the
 * pixels-per-unit they promise without a renderer.
 *
 *   wide     the piece at whole-bench scale: the 20-unit bench across the
 *            frame at the piece's depth, 2.5% margin a side (about 68 px per
 *            unit at 1440x900; the stage's fitted home view of the whole
 *            20 x 10 x 4 box is a little further, ~56 px per unit at its centre,
 *            because the box's near corners need room too)
 *            On a portrait phone, wide frames the centre cluster instead
 *            (PHONE_SPAN across the narrow width), as the stage's phone view does.
 *   station  about six units across the frame (one station's worth)
 *   close    the piece fills the frame
 */
import { Box3, MathUtils, Vector3 } from 'three';
import { fitDistance } from '../stage/camera.ts';

export type Distance = 'wide' | 'station' | 'close';
export const DISTANCES: readonly Distance[] = ['wide', 'station', 'close'];

/** The stage's defaults (CameraRig): the lens, the pitch and the margin round a fitted box. */
export const LENS = { fov: 20, pitch: 33, margin: 0.06 } as const;

/** The whole bench, as the stage frames it at zoom 0 (CameraRig's default subject). */
export function benchSubject(): Box3 {
  return new Box3(new Vector3(-10, 0, -5), new Vector3(10, 4, 5));
}

/** Width of the frame the station distance shows, in world units. */
export const STATION_SPAN = 6;
/** Width of the frame the wide distance shows: the 20-unit bench and a 2.5% margin a side. */
export const WIDE_SPAN = 20 / 0.95;
/** Width the wide distance shows on a portrait screen: the centre cluster (the stage page's phone box, 6.2 units). */
export const PHONE_SPAN = 6.2;

/** Camera distance (along the view direction, from the piece's centre) for a preset. */
export function distanceFor(d: Distance, aspect: number, pieceBox: Box3, lens: { fov: number; pitch: number; margin: number } = LENS): number {
  const tanV = Math.tan(MathUtils.degToRad(lens.fov) / 2);
  if (d === 'wide' && aspect < 1) {
    // a portrait phone: the centre cluster across the narrow width, as the stage's phone view frames it
    return PHONE_SPAN / 2 / (tanV * aspect);
  }
  if (d === 'wide' || d === 'station') {
    // a span across the wider side of the frame
    const span = d === 'wide' ? WIDE_SPAN : STATION_SPAN;
    return span / 2 / (tanV * Math.max(aspect, 1));
  }
  const c = pieceBox.getCenter(new Vector3());
  return fitDistance(pieceBox, c, lens.fov, aspect, lens.pitch, Math.max(lens.margin, 0.08));
}

/** Screen pixels per world unit at the focus, for a frame `heightPx` tall. */
export function pxPerUnit(distance: number, heightPx: number, fov: number = LENS.fov): number {
  return heightPx / (2 * Math.tan(MathUtils.degToRad(fov) / 2) * distance);
}
