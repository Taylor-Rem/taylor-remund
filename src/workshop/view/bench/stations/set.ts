/**
 * The set: everything that never moves, merged into one mesh per material (view/stations/set.ts): the
 * bench top (cut for Revert's hatch), the back wall (run on and cut for the window with the room), the
 * sign with the whole name, the tool wall and its tools, the phone on its easel, Patch's stool, and every
 * piece the stations before it handed to the pool.
 */
import { LAYOUT, SIGN_CAP_BENCH, SIGN_WORDS } from '../../bench.ts';
import { createSetView } from '../../stations/set.ts';
import { STAND_IN } from '../../vignette.ts';
import type { Entry } from '../../catalogue/registry.ts';
import { benchHole } from '../../kit/pieces/bench/index.ts';
import { OPENING } from '../../kit/pieces/revert-hatch/index.ts';
import { ROOM, roomWall } from '../../kit/pieces/room/index.ts';
import { signLabels } from '../../kit/pieces/sign/index.ts';
import { STOOL_SEAT } from '../../kit/pieces/switchboard/index.ts';
import { withShadow } from '../../kit/compose.ts';
import { ORDER, type BenchStation } from '../station.ts';

export const station: BenchStation = {
  name: 'set',
  order: ORDER.set,
  make(k) {
    const S = LAYOUT.stations;
    const E = (n: string): Entry | undefined => k.entry(n);
    const signE = E('sign'), benchE = E('bench'), wallE = E('back-wall');
    // the sign carries the whole name on one line, at the bench's capital height
    const sign: Entry | undefined = signE ? { ...signE, build: (opts = {}) => signE.build({ ...opts, words: SIGN_WORDS }), labels: (labels) => ({ panels: signLabels(labels, SIGN_WORDS, SIGN_CAP_BENCH) }) } : undefined;
    // the bench at 18 × 10 (the catalogue's default is 19.5 wide), cut for the hatch; with the room the wall run on and cut for the window
    const B = ROOM.bench;
    const H = S.hatch, hk = k.crewScale / 1.25;
    const hole = benchHole(H.at![0], H.at![1], OPENING.w * hk, OPENING.d * hk);
    // the bench top and the wall receive shadows and cast none: nothing under the top, nothing behind the wall, is in the key's light
    const bench: Entry | undefined = benchE ? { ...benchE, build: (opts = {}) => withShadow(benchE.build({ ...opts, sections: B.sections, width: B.width, depth: B.depth, openings: [hole] }), 'none') } : undefined;
    const wall: Entry | undefined = wallE ? { ...wallE, build: (opts = {}) => withShadow(wallE.build({ ...opts, ...(k.room ? roomWall() : {}) }), 'none') } : wallE;
    // the stool lowered for the whole board (Patch at 1.5× on it works the jack row)
    const stoolE = E('stool');
    const stool: Entry | undefined = stoolE ? { ...stoolE, build: (opts = {}) => stoolE.build({ ...opts, seatY: STOOL_SEAT }) } : undefined;
    return createSetView({
      entries: { bench, wall, sign, toolwall: E('toolwall'), lamp: E('lamp'), phone: E('phone'), stool },
      tools: k.entries.filter((e) => e.name.startsWith('tool-')),
      // the bench tapes its own lanes (lane.ts)
      scene: k.scene,
      laneTape: false,
      seed: k.seed,
      pool: k.pool,
      lampBody: false,
      ...(k.bulb ? { bulb: k.bulb } : {}),
      standIn: STAND_IN,
      // Patch's stool rolls on its runner (stations/operator.ts draws it)
      omit: ['stool', 'phone'],
      at: { sign: { x: S.sign.x, y: S.sign.y }, toolwall: { x: S.toolwall.x, y: S.toolwall.y }, lamp: { x: S.lamp.x, z: S.lamp.z }, phone: k.fit.phone.at, stool: k.fit.stool.at },
    });
  },
};
