/**
 * The tool wall's eight tools (P4 T2): one rig, posed where the parts view draws each tool; their paint; what a tool in
 * the hand lights; each tool's place, the pinned sheet and the look boxes as pick targets (view/stations/tools.ts).
 * The board itself is in the set (built without its tools). After the parts: it reads the tools' objects as the parts
 * view drew them.
 */
import { LAYOUT } from '../../bench.ts';
import { TOOLWALL, pegId, toolLook } from '../../../sim/index.ts';
import { createToolsView } from '../../stations/tools.ts';
import { timed } from '../../stations/timing.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'tools',
  // after the stations it answers through (it poses Patchlamp's nodes over theirs); the parts view reads its hops a frame on
  order: ORDER.late - 1,
  make(k) {
    if (!k.scene.parts.some((p) => p.kind === 'tool' && p.stowedIn === TOOLWALL.unit)) return null;
    const S = LAYOUT.stations.toolwall;
    return timed(
      'tools',
      createToolsView({
        unit: TOOLWALL.unit,
        sheet: TOOLWALL.sheet,
        look: TOOLWALL.look,
        toolLook: (kind) => toolLook(kind),
        peg: (kind) => pegId(kind),
        // the set stands the board's back just off the wall (view/stations/set.ts `wallStand`): its frame starts at z 0
        wall: [S.x, S.y, -5 + 0.012],
        seed: k.seed,
      }),
    );
  },
};
