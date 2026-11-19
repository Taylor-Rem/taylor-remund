/**
 * The chute's landing pad (A1 R1): where a fresh crate lands when it is shot out of the return chute, at
 * the left end of Fetch's tape. Marked the way everything on this bench is marked on the floor: a square of
 * the lane's yellow tape laid by hand, a hair out of square, its corners overlapping, and two short strips
 * across the corner that faces the chute (the side the crates come in from). No words. It lies on the last
 * slot of the deflector's row, in line with Fetch's tape (LAYOUT `pad`).
 */
import { Matrix4 } from 'three';
import { laneTape } from '../../kit/pieces/bench/index.ts';
import { rng } from '../../kit/rng.ts';
import { LAYOUT } from '../../bench.ts';
import { ORDER, staticStation, type BenchStation } from '../station.ts';

/** The tape's width: a little narrower than the lane's (0.12). Laid at low detail (a strip is a row of quads every 0.5): the triangle budget for the pad is 300. */
const W = 0.1;

export const station: BenchStation = {
  name: 'pad',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const s = LAYOUT.stations.pad;
      const R = rng(k.seed + 31);
      const hx = s.w / 2 - W / 2, hz = s.d / 2 - W / 2;
      const j = (): number => R.spread(0.02);
      const c: Array<[number, number]> = [[s.x - hx + j(), s.z + hz + j()], [s.x + hx + j(), s.z + hz + j()], [s.x + hx + j(), s.z - hz + j()], [s.x - hx + j(), s.z - hz + j()]];
      const square = laneTape({ seed: k.seed + 32, detail: 'low', width: W, points: [...c, c[0]!] });
      // across the back-left corner, on the chute's side (the front half of the pad is behind the belt's far rail
      // from the home camera; the back half is what is seen): two short strips
      const [bx, bz] = c[3]!;
      const strokes = [0.3, 0.52].map((d, i) =>
        laneTape({ seed: k.seed + 33 + i, detail: 'low', width: W * 0.9, points: [[bx + d - W * 0.3, bz + W * 0.3], [bx + W * 0.3, bz + d - W * 0.3]] }),
      );
      return [square, ...strokes].map((piece) => ({ piece, at: new Matrix4() }));
    });
  },
};
