/** Fetch's lane: a closed outline of yellow tape round every run of the runner's lane (taped corners), wide enough for the bigger Fetch. */
import { Matrix4 } from 'three';
import { laneOutline } from '../../../sim/index.ts';
import { laneTape } from '../../kit/pieces/bench/index.ts';
import { LANE_TAPE } from '../../bench.ts';
import { ORDER, staticStation, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'lane',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const points = laneOutline(k.scene.runner.lane.points, LANE_TAPE.half, LANE_TAPE.past);
      return [{ piece: laneTape({ seed: k.seed + 4, points }), at: new Matrix4() }];
    });
  },
};
