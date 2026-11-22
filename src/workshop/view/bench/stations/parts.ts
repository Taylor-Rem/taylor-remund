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
import { Box3, Group, Matrix4, Object3D, Vector3 } from 'three';
import type { Id, Part, Vec3, WorldView } from '../../../sim/types.ts';
import type { ProjectCrate } from '../../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../../types.ts';
import { buildEntry } from '../../catalogue/registry.ts';
import { createPartsView, paintToken, type PartDecorator } from '../../stations/parts.ts';
import { hashSeed } from '../../vignette.ts';
import { ORDER, type BenchStation } from '../station.ts';
import { BADGE_TEX_CAP, crateLid, crateMouth, crateSpec, crateWordKeys, WORD_CAP, type CrateSize } from '../../kit/pieces/crate/index.ts';
import { PICTO, type PictoName } from '../../labels/draw.ts';
import { paintProjectCard, projectCard, projectCardRegion, projectCardSize, projectPlateSize, type CapBand } from '../../kit/pieces/crate/card.ts';
import { HIDDEN } from '../../kit/pieces/crate/paint.ts';
import { BENCH_PROJECTS, CARD_PLATE } from '../../../../content/bench-projects.ts';
import { CRATES_TUNING, LEDGER, PAINT } from '../../../sim/index.ts';
import { DIAL_STYLE } from '../../kit/pieces/paint-dial/index.ts';

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

/** The plate's engraving: one plate label for every card, made at this cap height (the plate scales it to fit). */
const PLATE_CAP = 0.03;
const footM = new Matrix4();
/**
 * (round three) What a crate's tray allows a thing (world units), so things are designed under it: at most THING.height
 * tall over the tray's floor and THING.depth deep (front to back, centred on the tray; it may overhang the tray), and as
 * wide as the crate's mouth. The card stands high enough that a thing this tall leaves its lines and its plate clear
 * from the camera's pitch; the latch's target keeps out of its way; a look takes it in.
 */
export const THING = { height: 0.3, depth: 0.4 } as const;
const TAN_PITCH = Math.tan((33 * Math.PI) / 180);

interface Lid {
  readonly crate: ProjectCrate;
  /**
   * Where the card, the tray and the latch's and plate's pick targets hang: posed every frame as the crate is drawn, but
   * not under the crate's own object, whose box is the crate's pick target (measured from what is under it).
   */
  readonly holder: Group;
  /** The crate's piece stands this far under its body's middle (its half height). */
  readonly foot: number;
  /** How much higher its card stands (over a thing on its tray). */
  readonly lift: number;
  /** How far up the card's face starts over its foot (the plate under it). */
  readonly plateLift: number;
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
  /** (round three) The latch's pick target, moved to the crate's front while a thing lies on the tray. */
  latch?: { obj: Object3D; onTray: () => boolean; top: Vec3; front: Vec3 };
  /** Lying still on the bench, in nobody's hand: only then are its latch and plate targets (a crate in flight is caught, not opened). */
  still: boolean;
}

const query = (k: string): string | null => {
  try {
    return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get(k);
  } catch {
    return null;
  }
};
const legendBoth = (): boolean => query('crateLegend') === 'both';

/**
 * (round two) Each project crate's one mark, read across the bench: its pictogram, sprayed through a stencil like the
 * arrows a shipping crate carries. A coin for the ledger, a sheet of paper for the reports, a fan of paint chips for
 * t-components (each hints at what will be inside), a service bell for the support desk, a clipboard ticked for the
 * inspections, a processor chip for Artificer (its GPUs). A look, not a word: none says a fact that is not on /resume/.
 */
export const PICTO_OF: Readonly<Record<string, PictoName>> = { ledger: 'coin', reports: 'sheet', 't-components': 'chips', 'support-desk': 'bell', 'clean-green': 'check', artificer: 'chip' };
/**
 * Which mark the crates carry: `initial` (the project's initial in the place and the voice the size letter had at G1),
 * `picto`, or `none` (round one: the title across the front). `?crateMark=` chooses, for the pictures for the owner.
 */
export type CrateMark = 'initial' | 'picto' | 'none';
export const CRATE_MARK_DEFAULT: CrateMark = 'initial';
const crateMark = (): CrateMark => {
  const q = query('crateMark');
  return q === 'initial' || q === 'picto' || q === 'none' ? q : CRATE_MARK_DEFAULT;
};
/** A project's mark as the stencil text that sprays it (its title's first letter, or its pictogram's character). */
export function markText(project: string, title: string, mark: CrateMark): string | null {
  if (mark === 'none') return null;
  if (mark === 'picto') {
    const p = PICTO_OF[project];
    return p ? PICTO[p] : null;
  }
  return title.slice(0, 1).toUpperCase();
}

export const station: BenchStation = {
  name: 'parts',
  order: ORDER.parts,
  make(k) {
    const crate = k.entry('crate');
    const block = k.entry('test-block');
    const ledgerBoard = k.entry('ledger-board');
    const paintDialEntry = k.entry('paint-dial');
    const projects = new Map((k.scene.projects ?? []).map((c) => [c.crate, c]));
    const things = new Set((k.scene.projects ?? []).flatMap((c) => (c.holds !== undefined ? [c.holds] : [])));
    const both = legendBoth();
    const mark = crateMark();
    return (ctx: ViewContext): StationView => {
      // every project's stencil, made now while the labels' start-up pages are open, so the words land on the page the
      // crates' arrows and letters use and merge into their mesh (a label made later opens a page of its own: one more
      // draw call per crate). The crate's piece asks for the same keys and finds them made.
      for (const pc of projects.values()) {
        const words = BENCH_PROJECTS[pc.project];
        if (!words) continue;
        crateWordKeys(ctx.labels, words.stencil, WORD_CAP, true);
        crateWordKeys(ctx.labels, words.madeFor, WORD_CAP * 0.8);
        const m = markText(pc.project, words.title, mark);
        if (m) crateWordKeys(ctx.labels, [m], BADGE_TEX_CAP, true);
      }
      return createPartsView({
        half: (p) => k.world()?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
        tapes: true,
        known: k.scene.parts,
        piece: (p, half, extras) => {
          if (p.id === LEDGER.board && ledgerBoard) return buildEntry(ledgerBoard, null, { seed: hashSeed(p.id) }, ctx.labels); // P4 D1: the ledger board
          if (p.id === PAINT.dial && paintDialEntry) return buildEntry(paintDialEntry, null, { seed: hashSeed(p.id), style: DIAL_STYLE }, ctx.labels); // P4 D2b: the paint dial
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
            ...(words && pc && markText(pc.project, words.title, mark) ? { badge: markText(pc.project, words.title, mark)! } : {}),
          }, ctx.labels);
        },
        decorate: projectCrates(projects, things),
      })(ctx);
    };
  },
};

/** The project crates' lids, cards, trays and pick targets (and the stand-in thing scaled to its body). */
function projectCrates(projects: ReadonlyMap<Id, ProjectCrate>, things: ReadonlySet<Id>): (ctx: ViewContext) => PartDecorator {
  return (ctx) => {
    const F = LID_FEEL;
    const lids = new Map<Id, Lid>();
    const root = new Group();
    root.name = 'project-crates';
    ctx.scene.add(root);
    // every card's face, typed now while the labels' start-up pages are open (a region made later opens a page of its own)
    const plate = ctx.labels.plate(CARD_PLATE, { capHeight: PLATE_CAP });
    const plateSize = ctx.labels.size(plate);
    const faces = new Map<Id, { key: string; bands: { title: CapBand; line: CapBand } }>();
    /** The world as of the last frame (what `pickOver` asks: is the crate's thing on its tray). */
    let world: WorldView | null = null;
    return {
      make(part: Part, obj: Object3D, group: Group, half: Vec3) {
        if (things.has(part.id) && part.id !== LEDGER.board && part.id !== PAINT.dial) {
          // the stand-in thing: the test block is a unit across; scaled to the thing's body
          const s = (half[0] * 2) / 1.16;
          obj.scale.setScalar(s);
          return;
        }
        const pc = projects.get(part.id);
        if (!pc || part.kind !== 'crate') return;
        const size = part.size;
        const words = BENCH_PROJECTS[pc.project];
        let typed = faces.get(part.id);
        if (!typed && words) {
          const region = projectCardRegion(ctx.labels, part.id, size);
          typed = { key: region.key, bands: paintProjectCard(region, { title: words.title, line: words.line }, hashSeed(part.id)) };
          faces.set(part.id, typed);
        }
        const face = typed?.key;
        const P = projectPlateSize(size, plateSize, PLATE_CAP);
        const S = crateSpec(size);
        const m = crateMouth(size);
        const rim = m.rim;
        // the card, in the crate's mouth (the crate's piece stands on its base at the object's origin)
        // (round two) a crate with a thing on its tray stands its card higher, on posts, so the thing does not cover it: its
        // foot over the thing's top less what the camera's pitch shows of it from the front (the card is behind it)
        const trayY = Math.max(0.01, 2 * half[1] + 0.006 - 0.012 - rim);
        // (round three) the card's foot over the tallest thing the tray allows, less what the pitch gains for the card standing
        // behind it (from the thing's back edge to the card)
        const trayZ = half[2] * CRATES_TUNING.trayForward; // (where the world sets a thing down: sim/machines/crates.ts trayPose)
        const cardZ = -m.d / 2 + 0.035;
        const holds = pc.holds !== undefined;
        const lift = holds ? Math.max(0, trayY + 0.012 + THING.height - (trayZ - THING.depth / 2 - cardZ) * TAN_PITCH + 0.02) : 0;
        const piece = projectCard({ size, seed: hashSeed(part.id), ...(face ? { face } : {}), plate: { key: plate, ...plateSize, cap: PLATE_CAP }, trayY, trayZ, lift });
        const cardRoot = ctx.realize(piece);
        cardRoot.position.set(0, rim, 0);
        cardRoot.visible = false;
        const holder = new Group();
        holder.name = `project-crate:${part.id}`;
        holder.matrixAutoUpdate = false;
        holder.add(cardRoot);
        root.add(holder);
        let card: Object3D | null = null;
        let tray: Object3D | null = null;
        cardRoot.traverse((x) => {
          if (x.name === 'card' && !card) card = x;
          if (x.name === 'tray' && !tray) tray = x;
        });
        const trayNode = tray as Object3D | null;
        if (trayNode && pc.holds === undefined) trayNode.scale.setScalar(HIDDEN);
        // (round three) while the crate is open and its thing lies on its tray, a press anywhere through the thing is the
        // thing's (or a control's riding on it), never the crate's, its lid's or its latch's: the open lid and the card
        // stand behind the thing, so the crate's box is nearer along the ray. Taken by its sides and the lid's upper
        // part where the thing is not behind the ray, as ever.
        const thingOnTray = (): boolean => holds && (lids.get(part.id)?.rise ?? 0) > 0.5 && world?.motion(pc.holds!)?.mode === 'machine';
        if (holds) {
          const yields = [pc.crate, pc.lid] as const;
          ctx.pickOver?.(pc.holds!, () => (thingOnTray() ? yields : []));
        }
        lids.set(part.id, { crate: pc, holder, foot: half[1], size, lift, plateLift: P.lift, card, cardRoot, tray: trayNode, lid: 0, v: 0, t: 0, hasp: 0, rise: 0, still: false });
        // (round two) what an opening asks the page to look at (the world's `look`): the risen card, the crate's mouth and
        // its tray, a box of its own never pressed (no hand takes it: only `lookAt` reads it)
        if (pc.card !== undefined) {
          const lookAt = new Object3D();
          lookAt.name = 'look.box';
          holder.add(lookAt);
          const cs = projectCardSize(size);
          // (round three) and a thing on the tray, whole: as wide as the mouth, as deep as the tray allows
          const hw2 = Math.max(cs.w / 2, holds ? m.w / 2 : 0) + 0.02;
          const front = holds ? Math.max(m.d * 0.36, trayZ + THING.depth / 2) : m.d * 0.36;
          ctx.pickable(pc.card, lookAt, { box: new Box3(new Vector3(-hw2, rim - 0.04, -m.d / 2), new Vector3(hw2, rim + lift + 0.03 + P.lift + cs.h, front)), pad: 0, active: () => false });
        }
        // the latch's pick target (a bone has no meshes: a box of its own): the front of the lid, from above, where a hand
        // lifts a lid. Not the hasp on the front: at the camera's pitch the ray to a crate's middle crosses its front just
        // where the hasp hangs (about five sixths of its height up), and a press at a crate's middle must take hold of the
        // crate. No ray to the middle crosses the lid's top. The box floats a hair over the lid, so its middle lies outside
        // the crate's own (padded) box: the input's rule that a small target inside a big one wins wherever the big one is
        // pressed (shell/boot.ts `pickAt`) would otherwise give every press on the crate to its latch.
        const latch = new Object3D();
        latch.name = 'latch.pick';
        holder.add(latch);
        const hw = Math.max(0.07, S.w * 0.2);
        const lidState = (): Lid | undefined => lids.get(part.id);
        // the box about the latch object: over the lid's front, from above (the object at its middle)
        const lz = (S.d / 2 - 0.13 + S.d / 2 + 0.012) / 2, ldz = (0.13 + 0.012) / 2;
        latch.position.set(0, S.h + 0.04, lz);
        ctx.pickable(pc.lid, latch, { box: new Box3(new Vector3(-hw, -0.02, -ldz), new Vector3(hw, 0.02, ldz)), pad: 0.004, active: () => group.visible && lidState()?.still === true });
        // (round three) with a thing on its tray every ray over the lid's front runs on into the thing (which wins it):
        // the latch is pressed on the crate's front instead, over the hasp (its box turned upright against the front rail)
        if (holds) {
          // (and there, where its box is on the ray, it wins over the crate whose front it lies on)
          const crateOnly = [pc.crate] as const;
          ctx.pickOver?.(pc.lid, () => (thingOnTray() ? crateOnly : []));
          lids.get(part.id)!.latch = { obj: latch, onTray: thingOnTray, top: [0, S.h + 0.04, lz], front: [0, S.h - 0.075, S.d / 2 - 0.005] };
        }
        // the plate's pick target: the plate itself, under the card (only while it stands)
        const plateTarget = new Object3D();
        plateTarget.name = 'plate.pick';
        (card ?? cardRoot).add(plateTarget);
        plateTarget.position.set(0, P.h / 2 + 0.002, 0.006);
        const st = lids.get(part.id)!;
        ctx.pickable(pc.plate, plateTarget, { box: new Box3(new Vector3(-P.w / 2, -P.h / 2, -0.006), new Vector3(P.w / 2, P.h / 2, 0.006)), pad: 0.002, active: () => group.visible && st.still && st.rise > 0.9 });
        // (round three) where the type is, for measuring it on screen (never pressed): the capitals of the card's title and
        // of its line, and of the plate's word, each a flat box on the card
        if (pc.card !== undefined) {
          const cs = projectCardSize(size);
          const onCard = (b: CapBand): Box3 => new Box3(new Vector3(-cs.w / 2 + b.x0 * cs.w, P.lift + cs.h * (1 - b.y1), 0), new Vector3(-cs.w / 2 + b.x1 * cs.w, P.lift + cs.h * (1 - b.y0), 0.004));
          const bands: [string, Box3][] = [[`${pc.card}.face`, new Box3(new Vector3(-cs.w / 2, P.lift, 0), new Vector3(cs.w / 2, P.lift + cs.h, 0.004))], [`${pc.card}.plate-caps`, new Box3(new Vector3(-P.face.w * 0.4, P.h / 2 + 0.002 - P.cap / 2, 0), new Vector3(P.face.w * 0.4, P.h / 2 + 0.002 + P.cap / 2, 0.004))]];
          if (typed) bands.push([`${pc.card}.title-caps`, onCard(typed.bands.title)], [`${pc.card}.line-caps`, onCard(typed.bands.line)]);
          for (const [id, box] of bands) {
            const o = new Object3D();
            o.name = 'measure.box';
            (card ?? cardRoot).add(o);
            ctx.pickable(id, o, { box, pad: 0, active: () => false });
          }
        }
      },

      update(part: Part, obj: Object3D, group: Group, frame: Frame, shown: boolean) {
        world = frame.world;
        const st = lids.get(part.id);
        if (!st) return;
        // the holder where the crate's piece is: its part's pose (as drawn), down to the piece's foot
        st.holder.matrix.copy(group.matrix).multiply(footM.makeTranslation(0, -st.foot, 0));
        st.holder.matrixWorldNeedsUpdate = true;
        st.holder.visible = shown && group.visible;
        const mo = frame.world.motion(part.id);
        // (round three) an open crate with its thing on the tray is kept awake by it (the world holds the thing there each
        // step): it lies still all the same
        st.still = shown && mo?.mode === 'free' && !mo.held && (!mo.awake || (st.latch?.onTray() ?? false));
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
        if (st.latch) {
          const front = st.latch.onTray();
          const at = front ? st.latch.front : st.latch.top;
          st.latch.obj.position.set(at[0], at[1], at[2]);
          st.latch.obj.rotation.x = front ? -Math.PI / 2 : 0;
        }
        if (st.cardRoot) {
          const cs = projectCardSize(st.size);
          const e = st.rise * st.rise * (3 - 2 * st.rise);
          st.cardRoot.visible = st.rise > 0.001 || st.lid > 0.02;
          // hidden down in the mouth, it rises on its batten until the batten lies on the walls
          if (st.card) st.card.position.y = 0.026 + st.lift - (1 - e) * (cs.h + st.plateLift + 0.05 + F.cardDepth + st.lift);
        }
      },

      dispose() {
        root.removeFromParent();
        lids.clear();
      },
    };
  };
}
