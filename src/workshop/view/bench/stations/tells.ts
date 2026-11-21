/** The tells, seen (T1, view/stations/tells.ts): the station lamps' glow and the second tell's rattle, after every station has posed. */
import { createTellsView } from '../../stations/tells.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'tells',
  order: ORDER.late + 2,
  make() {
    return createTellsView();
  },
};
