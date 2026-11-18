/**
 * The room round the bench (ART-P2 § 5 "THE ROOM"): the bench's frame and legs, the floor far below, the
 * window with its mountains, the dim shapes beyond the bench ends. Off with `?room=0`. (The bench top and
 * the back wall are the set's.)
 */
import { ROOM } from '../../kit/pieces/room/index.ts';
import { ORDER, at, staticStation, type BenchStation, type PoolItem } from '../station.ts';

export const station: BenchStation = {
  name: 'room',
  order: ORDER.pool,
  make(k) {
    if (!k.room) return null;
    return staticStation(k, (build) => {
      const out: PoolItem[] = [];
      const put = (name: string, opts: Record<string, unknown>, m: ReturnType<typeof at>): void => {
        const p = build(name, opts);
        if (p) out.push({ piece: p, at: m });
      };
      const B = ROOM.bench;
      put('bench-frame', { sections: B.sections, width: B.width, depth: B.depth, floor: ROOM.floorY }, at());
      put('floor', { width: ROOM.floor.width, z0: ROOM.floor.z0, z1: ROOM.floor.z1 }, at(0, ROOM.floorY, 0));
      put('window', {}, at(ROOM.window.x, ROOM.window.y, ROOM.window.z));
      put('room-left', { floor: ROOM.floorY }, at(ROOM.ends.left.x, ROOM.ends.left.y, ROOM.ends.left.z));
      put('room-right', { floor: ROOM.floorY }, at(ROOM.ends.right.x, ROOM.ends.right.y, ROOM.ends.right.z));
      return out;
    });
  },
};
