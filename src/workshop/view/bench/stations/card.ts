/**
 * The cue card on its brass stick (view/stations/card.ts): every printed card that has no one else to hold
 * it up. Revert holds its own cards while it is up (view/stations/revert.ts); while it is down in its
 * hatch (a rung with reduced motion, its hatch covered) the stick puts them up instead.
 */
import { createCardView } from '../../stations/card.ts';
import { ORDER, type BenchStation } from '../station.ts';

const DOWN = new Set(['below', 'stuck']);

export const station: BenchStation = {
  name: 'card',
  order: ORDER.late + 1,
  make() {
    return createCardView({
      accept(e, w) {
        const r = w.crewViews().find((c) => c.kind === 'revert');
        if (!r || r.kind !== 'revert' || e.by !== r.body) return true;
        return DOWN.has(r.view.state);
      },
    });
  },
};
