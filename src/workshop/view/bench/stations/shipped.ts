/** Shipped (P4) and the mailbox, in clay: pallets (lighter), crates (mid), the mailbox on its post and the clipboard. */
import { CRATE_EDGE_VIEW, MAILBOX, SHIPPED } from '../../bench.ts';
import { placedMatrix } from '../../stations/set.ts';
import { clayBlock } from '../clay.ts';
import { ORDER, staticStation, type BenchStation, type PoolItem } from '../station.ts';

export const station: BenchStation = {
  name: 'shipped',
  order: ORDER.pool,
  make(k) {
    return staticStation(k, () => {
      const out: PoolItem[] = [];
      const P = SHIPPED.pallet;
      SHIPPED.pallets.forEach((p, i) => {
        out.push({ piece: clayBlock(`pallet-${i}`, P.w, P.h, P.d, 0.6), at: placedMatrix({ x: p.x, z: p.z }) });
        for (const [j, c] of p.crates.entries()) {
          const e = CRATE_EDGE_VIEW[c.size];
          out.push({ piece: clayBlock(`shipped-crate-${i}-${j}`, e - 0.02, e - 0.02, e - 0.02, 0.5), at: placedMatrix({ x: p.x + c.dx, y: P.h + c.y, z: p.z + P.d / 2 - e / 2 }) });
        }
      });
      const m = MAILBOX, c = MAILBOX.clipboard;
      out.push(
        { piece: clayBlock('mailbox-post', m.post, m.postH, m.post), at: placedMatrix({ x: m.x, z: m.z }) },
        { piece: clayBlock('mailbox', m.box.w, m.box.h, m.box.d, 0.55), at: placedMatrix({ x: m.x, y: m.postH, z: m.z }) },
        { piece: clayBlock('clipboard', c.w, c.h, c.t, 0.7), at: placedMatrix({ x: m.x, y: c.y, z: m.z + m.post / 2 + c.t / 2 + 0.01 }) },
      );
      return out;
    });
  },
};
