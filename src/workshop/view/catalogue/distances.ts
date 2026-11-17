/**
 * The catalogue's three review distances (W1.5 brief § 2), as pure camera
 * maths on the stage's own lens and pitch, so a test can hold them to the
 * pixels-per-unit they promise without a renderer.
 *
 *   wide     the piece at whole-bench scale: exactly the stage's home
 *            distance for the 20 x 10 bench (about 67 px per unit at 1440x900)
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

/** Camera distance (along the view direction, from the piece's centre) for a preset. */
export function distanceFor(d: Distance, aspect: number, pieceBox: Box3, lens: { fov: number; pitch: number; margin: number } = LENS): number {
  const tanV = Math.tan(MathUtils.degToRad(lens.fov) / 2);
  if (d === 'wide') {
    const b = benchSubject();
    return fitDistance(b, b.getCenter(new Vector3()), lens.fov, aspect, lens.pitch, lens.margin);
  }
  if (d === 'station') {
    // STATION_SPAN across the wider side of the frame.
    return STATION_SPAN / 2 / (tanV * Math.max(aspect, 1));
  }
  const c = pieceBox.getCenter(new Vector3());
  return fitDistance(pieceBox, c, lens.fov, aspect, lens.pitch, Math.max(lens.margin, 0.08));
}

/** Screen pixels per world unit at the focus, for a frame `heightPx` tall. */
export function pxPerUnit(distance: number, heightPx: number, fov: number = LENS.fov): number {
  return heightPx / (2 * Math.tan(MathUtils.degToRad(fov) / 2) * distance);
}
