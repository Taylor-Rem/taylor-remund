/** Fetch's lane: a closed rectangle of yellow tape round the runner's lane, wide enough for the bigger Fetch. */
import { Matrix4 } from 'three';
import { laneTape } from '../../kit/pieces/bench/index.ts';
import { LANE_TAPE } from '../../bench.ts';
import { ORDER, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'lane',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const lane = k.scene.runner.lane;
      const hw = LANE_TAPE.half, px = LANE_TAPE.past;
      const x0 = Math.min(lane.a[0], lane.b[0]) - px, x1 = Math.max(lane.a[0], lane.b[0]) + px;
      const zc = (lane.a[1] + lane.b[1]) / 2;
      return [{ piece: laneTape({ seed: k.seed + 4, points: [[x0, zc - hw], [x1, zc - hw + 0.015], [x1, zc + hw], [x0, zc + hw - 0.01], [x0, zc - hw]] }), at: new Matrix4() }];
    });
  },
};
