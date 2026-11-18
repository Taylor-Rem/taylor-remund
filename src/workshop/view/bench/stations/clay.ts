/**
 * Clay for every station still being built: each LAYOUT spot whose `fill` is 'clay' (the mailbox has its
 * own clay, in shipped.ts). A station whose piece lands sets its spot's fill to 'piece' and gets a file.
 */
import { LAYOUT, type Spot, type StationKey } from '../../bench.ts';
import { placedMatrix } from '../../stations/set.ts';
import { clayBlock } from '../clay.ts';
import { ORDER, staticStation, type BenchStation, type PoolItem } from '../station.ts';

const WALL_Z = -5;

export const station: BenchStation = {
  name: 'clay',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const out: PoolItem[] = [];
      for (const [name, s] of Object.entries(LAYOUT.stations) as Array<[StationKey, Spot]>) {
        if (s.fill !== 'clay' || name === 'mailbox') continue;
        const onWall = s.z <= WALL_Z;
        const at = placedMatrix({ x: s.x, y: s.y, z: onWall ? WALL_Z + s.d / 2 + 0.01 : s.z, yaw: s.yaw });
        out.push({ piece: clayBlock(name, s.w, Math.max(s.h, 0.02), s.d), at });
      }
      return out;
    });
  },
};
