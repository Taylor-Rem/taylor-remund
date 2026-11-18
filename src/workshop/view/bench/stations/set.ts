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
    const bench: Entry | undefined = benchE ? { ...benchE, build: (opts = {}) => benchE.build({ ...opts, sections: B.sections, width: B.width, depth: B.depth, openings: [hole] }) } : undefined;
    const wall: Entry | undefined = wallE && k.room ? { ...wallE, build: (opts = {}) => wallE.build({ ...opts, ...roomWall() }) } : wallE;
    return createSetView({
      entries: { bench, wall, sign, toolwall: E('toolwall'), lamp: E('lamp'), phone: E('phone'), stool: E('stool') },
      tools: k.entries.filter((e) => e.name.startsWith('tool-')),
      // the set draws P1's lane tape round the runner's lane; the bench draws its own (lane.ts), so the set is handed the lane far off the bench
      scene: { ...k.scene, runner: { ...k.scene.runner, lane: { a: [-60, -60], b: [-60, -60] } } },
      seed: k.seed,
      pool: k.pool,
      lampBody: false,
      ...(k.bulb ? { bulb: k.bulb } : {}),
      standIn: STAND_IN,
      at: { sign: { x: S.sign.x, y: S.sign.y }, toolwall: { x: S.toolwall.x, y: S.toolwall.y }, lamp: { x: S.lamp.x, z: S.lamp.z }, phone: k.fit.phone.at, stool: k.fit.stool.at },
    });
  },
};
