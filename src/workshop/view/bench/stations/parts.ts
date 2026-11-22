/**
 * The loose parts (crates; Fetch's own body is drawn by fetch.ts): each crate built in its paint, with a
 * strip of label tape for its label; the parts view keeps both as the world says from then on.
 *
 * P4 S5: the project crates (`SceneDesc.projects`). Each is stencilled with its project's published name across its
 * front and who it was built for on its right side (src/content/bench-projects.json, in the crate's own stencil); its
 * lid opens as its durable `open` says (the hasp swings off its staple first, then the lid lifts with a little weight
 * and settles; shut, it falls and claps); as it opens a typed card rises out of the mouth on its batten, the project's
 * title, its one line and its tools, with the brass plate that is the way to the full entry. The latch and the plate
 * are pick targets of their own (the crate's latch over its hasp and front rail; the plate while the card stands).
 * A crate in the hand is drawn shut (it claps shut as it is taken). A crate's thing (the dev stand-in, `?standin=1`)
 * sits on a little tray at the mouth's front; the tray is drawn only on a crate that holds one.
 *
 * `?crateLegend=both` (development: the pictures for the owner) keeps the size letter and the arrows under the words.
 */
import { Box3, Object3D, Vector3, type Group } from 'three';
import type { Id, Part, Vec3 } from '../../../sim/types.ts';
import type { ProjectCrate } from '../../../sim/scene.ts';
import type { Frame, StationView, ViewContext } from '../../types.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { createPartsView, paintToken, type PartDecorator } from '../../stations/parts.ts';
import { hashSeed } from '../../vignette.ts';
import { ORDER, type BenchStation } from '../station.ts';
import { crateLid, crateMouth, crateSpec, type CrateSize } from '../../kit/pieces/crate/index.ts';
import { paintProjectCard, projectCard, projectCardRegion, projectCardSize } from '../../kit/pieces/crate/card.ts';
import { HIDDEN } from '../../kit/pieces/crate/paint.ts';
import { BENCH_PROJECTS, CARD_PLATE } from '../../../../content/bench-projects.ts';

/** Tune here: how the lid moves (view only; simulation seconds). */
export const LID_FEEL = {
  /** The hasp swings off (or onto) its staple at this rate (share of its travel a second). */
  hasp: 9,
  /** Opening: a spring toward open that overshoots a little and settles (its stiffness, rad/s, and damping ratio). */
  omega: 11,
  zeta: 0.42,
  /** Shutting: it falls like a lid (share of its travel per second squared) and claps, bouncing back this much. */
  fall: 26,
  clap: 0.22,
  /** The card rises out of the mouth once the lid is this open, at this rate (share a second), and sinks first when it shuts. */
  cardFrom: 0.45,
  cardRate: 3.2,
  /** The card is a little lower than the rim before it rises: it is hidden inside. */
  cardDepth: 0.02,
} as const;

/** The plate's engraving: one plate label for every card (its capitals at the plate's own small size). */
const PLATE_CAP = 0.018;
/** A pick target's padding (world units). */
const PAD = 0.03;

interface Lid {
  readonly crate: ProjectCrate;
  readonly size: CrateSize;
  card: Object3D | null;
  cardRoot: Object3D | null;
  tray: Object3D | null;
  lid: number;
  v: number;
  /** When it was last drawn (simulation seconds). */
  t: number;
  hasp: number;
  rise: number;
}

const legendBoth = (): boolean => {
  try {
    return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get('crateLegend') === 'both';
  } catch {
    return false;
  }
};

export const station: BenchStation = {
  name: 'parts',
  order: ORDER.parts,
  make(k) {
    const crate = k.entry('crate');
    const block = k.entry('test-block');
    const projects = new Map((k.scene.projects ?? []).map((c) => [c.crate, c]));
    const things = new Set((k.scene.projects ?? []).flatMap((c) => (c.holds !== undefined ? [c.holds] : [])));
    const both = legendBoth();
    return (ctx: ViewContext): StationView =>
      createPartsView({
        half: (p) => k.world()?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
        tapes: true,
        known: k.scene.parts,
        piece: (p, half, extras) => {
          if (things.has(p.id) && block) {
            // a crate's thing: the stand-in is the kit's test block, at the thing's size (its width across)
            return buildEntry(block, null, { seed: hashSeed(p.id), detail: 'low' }, ctx.labels);
          }
          const pc = projects.get(p.id);
          const words = pc ? BENCH_PROJECTS[pc.project] : undefined;
          void half;
          return buildEntry(crate!, null, {
            size: p.size,
            paint: paintToken(p.colour),
            seed: hashSeed(p.id),
            ...(extras.tape ? { tape: extras.tape } : {}),
            ...(words ? { words: [...words.stencil], mark: [...words.madeFor], ...(both ? { legend: 'both' } : {}) } : {}),
          }, ctx.labels);
        },
        decorate: projectCrates(projects, things),
      })(ctx);
  },
};

/** The project crates' lids, cards, trays and pick targets (and the stand-in thing scaled to its body). */
function projectCrates(projects: ReadonlyMap<Id, ProjectCrate>, things: ReadonlySet<Id>): (ctx: ViewContext) => PartDecorator {
  return (ctx) => {
    const F = LID_FEEL;
    const lids = new Map<Id, Lid>();
    // every card's face, typed now while the labels' start-up pages are open (a region made later opens a page of its own)
    const plate = ctx.labels.plate(CARD_PLATE, { capHeight: PLATE_CAP });
    const plateSize = ctx.labels.size(plate);
    const faces = new Map<Id, string>();
    return {
      make(part: Part, obj: Object3D, group: Group, half: Vec3) {
        if (things.has(part.id)) {
          // the stand-in thing: the test block is a unit across; scaled to the thing's body
          const s = (half[0] * 2) / 1.16;
          obj.scale.setScalar(s);
          return;
        }
        const pc = projects.get(part.id);
        if (!pc || part.kind !== 'crate') return;
        const size = part.size;
        const words = BENCH_PROJECTS[pc.project];
        let face = faces.get(part.id);
        if (!face && words) {
          const region = projectCardRegion(ctx.labels, part.id, size);
          paintProjectCard(region, { title: words.title, line: words.line, tools: words.tools }, hashSeed(part.id));
          face = region.key;
          faces.set(part.id, face);
        }
        const S = crateSpec(size);
        const m = crateMouth(size);
        const rim = m.rim;
        // the card, in the crate's mouth (the crate's piece stands on its base at the object's origin)
        const piece = projectCard({ size, seed: hashSeed(part.id), ...(face ? { face } : {}), plate: { key: plate, ...plateSize }, trayY: Math.max(0.01, 2 * half[1] + 0.006 - 0.012 - rim) });
        const cardRoot = ctx.realize(piece);
        cardRoot.position.set(0, rim, 0);
        cardRoot.visible = false;
        obj.add(cardRoot);
        let card: Object3D | null = null;
        let tray: Object3D | null = null;
        cardRoot.traverse((x) => {
          if (x.name === 'card' && !card) card = x;
          if (x.name === 'tray' && !tray) tray = x;
        });
        const trayNode = tray as Object3D | null;
        if (trayNode && pc.holds === undefined) trayNode.scale.setScalar(HIDDEN);
        lids.set(part.id, { crate: pc, size, card, cardRoot, tray: trayNode, lid: 0, v: 0, t: 0, hasp: 0, rise: 0 });
        // the latch's pick target: over the hasp and the front's top rail (a bone has no meshes: a box of its own)
        const latch = new Object3D();
        latch.name = 'latch.pick';
        obj.add(latch);
        const hy = S.h - S.cleatT - S.lidT;
        const hw = Math.max(0.08, S.w * 0.2);
        ctx.pickable(pc.lid, latch, { box: new Box3(new Vector3(-hw, hy - S.railH * 1.2, S.d / 2 - 0.02), new Vector3(hw, S.h + 0.012, S.d / 2 + 0.05)), pad: PAD, active: () => group.visible });
        // the plate's pick target, on the card (only while it stands)
        const pw = Math.min(1, (projectCardSize(size).w * 0.34) / plateSize.w) * plateSize.w;
        const ph = (pw / plateSize.w) * plateSize.h;
        const plateTarget = new Object3D();
        plateTarget.name = 'plate.pick';
        (card ?? cardRoot).add(plateTarget);
        const cw = projectCardSize(size).w;
        plateTarget.position.set(cw / 2 - pw / 2 - 0.018, ph / 2 + 0.014, 0.006);
        const st = lids.get(part.id)!;
        ctx.pickable(pc.plate, plateTarget, { box: new Box3(new Vector3(-pw / 2 - 0.01, -ph / 2 - 0.01, -0.01), new Vector3(pw / 2 + 0.01, ph / 2 + 0.01, 0.02)), pad: PAD, active: () => group.visible && st.rise > 0.9 });
      },

      update(part: Part, obj: Object3D, _group: Group, frame: Frame, shown: boolean) {
        const st = lids.get(part.id);
        if (!st) return;
        const w = frame.world;
        const m = w.motion(part.id);
        const want = shown && w.setting(part.id, 'open') === true && !m?.held && m?.mode === 'free' ? 1 : 0;
        // (on the simulation's clock: a capture that steps the world a second between frames sees the lid a second on)
        const dt = Math.max(0, Math.min(2, frame.time - st.t));
        st.t = frame.time;
        if (ctx.reducedMotion || w.reducedMotion || !shown) {
          st.lid = want;
          st.v = 0;
          st.hasp = want;
          st.rise = want;
        } else {
          // the hasp first when it opens, last when it shuts
          const haspGoal = want === 1 ? 1 : st.lid < 0.06 ? 0 : st.hasp;
          st.hasp += Math.sign(haspGoal - st.hasp) * Math.min(Math.abs(haspGoal - st.hasp), F.hasp * dt);
          let left = dt;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 240);
            if (want === 1) {
              if (st.hasp > 0.7) {
                // a spring toward open, a little overshoot: it has weight
                st.v += (F.omega * F.omega * (1 - st.lid) - 2 * F.zeta * F.omega * st.v) * h;
                st.lid += st.v * h;
              }
            } else if (st.rise < 0.35) {
              // the card down first; then it falls shut, and claps
              st.v -= F.fall * h;
              st.lid += st.v * h;
              if (st.lid <= 0) {
                st.lid = 0;
                st.v = st.v < -0.6 ? -st.v * F.clap : 0;
              }
            }
            left -= h;
          }
          st.lid = Math.max(0, Math.min(1.12, st.lid));
          const riseGoal = want === 1 && st.lid > F.cardFrom ? 1 : 0;
          st.rise += Math.sign(riseGoal - st.rise) * Math.min(Math.abs(riseGoal - st.rise), F.cardRate * dt * (riseGoal ? 1 : 1.6));
        }
        crateLid(obj, st.lid, st.hasp);
        if (st.cardRoot) {
          const cs = projectCardSize(st.size);
          const e = st.rise * st.rise * (3 - 2 * st.rise);
          st.cardRoot.visible = st.rise > 0.001 || st.lid > 0.02;
          // hidden down in the mouth, it rises on its batten until the batten lies on the walls
          if (st.card) st.card.position.y = 0.026 - (1 - e) * (cs.h + 0.05 + F.cardDepth);
        }
      },

      dispose() {
        lids.clear();
      },
    };
  };
}
