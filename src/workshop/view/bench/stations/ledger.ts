/**
 * The ledger board (P4 D1), alive: view/stations/ledger.ts poses its tokens, its star, its crank, plunger and gate,
 * and gives the two controls their pick targets. After the parts: it reads the board's object as the parts view drew it.
 */
import { LEDGER } from '../../../sim/index.ts';
import { createLedgerView } from '../../stations/ledger.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'ledger',
  order: ORDER.parts + 2,
  make(k) {
    if (!k.scene.parts.some((p) => p.id === LEDGER.board)) return null;
    return timed('ledger', createLedgerView({ board: LEDGER.board, unit: LEDGER.unit, crank: LEDGER.crank, plunger: LEDGER.plunger }));
  },
};
