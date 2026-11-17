/**
 * The cue-card arm (REWRITE.md § B4 "Revert's card"; W4 brief § B). Registry
 * name `card-arm`.
 *
 * Until Revert arrives, the Button's card answers on its own: a brass slot
 * plate set into the bench behind the console, and a spring-loaded brass
 * stick that shoots up through it holding a typed index card in a bulldog
 * clip, wobbles on its spring, holds, and drops away again. Stowed, the stick
 * and card are below the bench top (nobody sees under it from the front).
 *
 * Local frame: the slot's centre on the bench top (y = 0), the slot running
 * along X, the card's face toward +Z.
 *
 * Moving nodes (see `poseCardArm`):
 *  - `arm`: the stick, clip and card. Pivot at the slot. Slides along its own
 *    Y (the lift), leans about its X, sways about Z, twists about Y.
 *  - `card`: the card in the clip. Pivot at the clip's jaw (the card's
 *    bottom centre); flaps about its X (secondary motion, lagging the stick).
 */
import { Matrix4 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import type { Labels } from '../../../types.ts';
import { lathe } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { bevelBox, sheet } from '../../cheap.ts';
import { collar, slottedScrew, spring } from '../../details.ts';
import { sweep, polylinePath } from '../../sweep.ts';
import { chain, mat, part, piece, place, texturedPart, T } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { transform } from '../../deform.ts';
import { grain, setFinish } from '../../space.ts';
import { world } from '../../../labels/content.ts';
import { armTransform, cardTransform, NAMED_POSES } from './pose.ts';
import type { CardArmPose } from './pose.ts';

export { poseCardArm, NAMED_POSES, CARD_POSE, armTransform } from './pose.ts';
export type { CardArmPose } from './pose.ts';

/** Dimensions the view needs. */
export const CARD_ARM = {
  /** Visible stick above the slot when raised, to the clip's jaw. */
  stick: 1.42,
  /** The clip: jaw height above the stick's end. */
  jaw: 0.05,
  /** How deep the card is gripped. */
  grip: 0.06,
  /** The slot plate: margin past the card at each end, and its depth (Z). */
  slotPad: 0.12,
  slotD: 0.15,
  /** Card size to lay out with when no label was made (clay, tests): close to the real card. */
  cardEstimate: { w: 2.6, h: 1.5 },
} as const;

export interface CardRef {
  key: string;
  w: number;
  h: number;
}

export interface CardArmOptions extends KitOptions {
  /** The card's label (labels.card(text)) and size. Without it the card is blank paper. */
  card?: CardRef;
  /** Build already posed (a NAMED_POSES name or a pose), for stills. Default: unposed (raised, upright, no flap), the rest the view poses from. */
  pose?: string | CardArmPose;
}

/** How far the arm must drop so the stick, clip and card are all under the bench top. */
export function stowDepth(cardH: number): number {
  return CARD_ARM.stick + CARD_ARM.jaw + cardH + 0.08;
}

export function cardArm(o: CardArmOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed);
  const card = o.card ?? { key: '', ...CARD_ARM.cardEstimate };
  const b = piece('card-arm', { detail, seed, ao: false });

  // ---- the slot plate, flush on the bench ----------------------------------------
  const L = card.w + CARD_ARM.slotPad * 2;
  const D = CARD_ARM.slotD;
  const t = 0.014;
  const gap = 0.045; // the slot's opening
  const rail = (D - gap) / 2;
  // front and back rails (brass), chamfered; the ends closed by blocks
  b.add(part('brass', bevelBox({ min: [-L / 2, 0, gap / 2], max: [L / 2, t, D / 2], c: 0.005, omit: ['ny'] }), 'brass', { seed: seed + 1, jitter: 0.04 }));
  b.add(part('brass', bevelBox({ min: [-L / 2, 0, -D / 2], max: [L / 2, t, -gap / 2], c: 0.005, omit: ['ny'] }), 'brass', { seed: seed + 2, jitter: 0.04, shade: 0.92 }));
  for (const s of [-1, 1]) {
    const x0 = s * (L / 2 - 0.05);
    b.add(part('brass', bevelBox({ min: [Math.min(x0, s * L / 2), 0, -gap / 2], max: [Math.max(x0, s * L / 2), t * 0.9, gap / 2], c: 0.004, omit: ['ny'] }), 'brass', { seed: seed + 3, shade: 0.88 }));
  }
  // the dark inside of the slot: two rubber brush lips just below the rails
  b.add(part('rubber', bevelBox({ min: [-L / 2 + 0.05, -0.02, -gap / 2], max: [L / 2 - 0.05, 0.002, gap / 2], c: 0, omit: ['ny'] }), 'ink', { shade: 0.6 }));
  // screws along the rails, one replaced and turned the other way
  const nScrew = 4;
  for (let i = 0; i < nScrew; i++) {
    const x = -L / 2 + 0.11 + (i * (L - 0.22)) / (nScrew - 1);
    for (const z of [(gap / 2 + D / 2) / 2, -(gap / 2 + D / 2) / 2]) {
      const sd = R.int(0, 999);
      b.small(() => place(slottedScrew({ d: Math.min(0.036, rail * 0.75), detail: 'low', seed: sd }), T(x, t, z)));
    }
  }

  // ---- the arm: stick, return spring, guide collar, clip, card -----------------------
  const stow = stowDepth(card.h);
  const S = CARD_ARM.stick;
  const arm = b.node('arm', new Matrix4());
  // the stick: a brass rod with a turned ferrule at the top and a stop collar just under the slot
  const r = 0.027;
  const stick = lathe(
    profile(0, -stow + 0.02)
      .to(r, -stow + 0.02, { fillet: 0.006, segs: 1 })
      .to(r, S - 0.12, { sharp: true })
      .to(r * 1.45, S - 0.11, { fillet: 0.004, segs: 1 })
      .to(r * 1.45, S - 0.02, { fillet: 0.006, segs: 1 })
      .to(r * 1.1, S, { fillet: 0.004, segs: 1 })
      .to(0, S),
    { segs: detail === 'low' ? 8 : 12, support: false },
  );
  arm.add(setFinish(grain(part('brass', stick, 'brass', { seed: seed + 10, warm: 0.03 }), 'y'), 0.55));
  // the stop collar the spring pushes against (rides on the stick, just above the plate when raised)
  arm.add(place(collar({ r: 0.042, inner: r, h: 0.03, detail, seed: seed + 11 }), T(0, 0.02, 0)));
  // the return spring between the collar and the ferrule: visible, so the pop has a cause
  arm.add(place(spring({ r: 0.036, wire: 0.0075, pitch: 0.045, turns: 5, detail, seed: seed + 12, token: 'steel' }), T(0, S - 0.39, 0)));
  arm.add(place(collar({ r: 0.04, inner: r, h: 0.026, detail, seed: seed + 13 }), T(0, S - 0.41, 0)));

  // the bulldog clip: a steel jaw across the card's bottom edge, a brass pin, two wire handles bent back
  const jawW = 0.3;
  const jy = S + CARD_ARM.jaw;
  const clip = chain(T(0, jy, 0));
  arm.add(part('metal', transform(bevelBox({ min: [-jawW / 2, -0.03, 0.006], max: [jawW / 2, 0.055, 0.03], c: 0.008 }), clip), 'steel', { seed: seed + 20, shade: 0.75 }));
  arm.add(part('metal', transform(bevelBox({ min: [-jawW / 2, -0.03, -0.03], max: [jawW / 2, 0.04, -0.006], c: 0.008 }), clip), 'steel', { seed: seed + 21, shade: 0.7 }));
  arm.add(part('brass', transform(lathe(profile(0, -jawW / 2 - 0.012).to(0.011, -jawW / 2 - 0.012, { fillet: 0.004, segs: 1 }).to(0.011, jawW / 2 + 0.012, { fillet: 0.004, segs: 1 }).to(0, jawW / 2 + 0.012), { segs: 8, support: false }), chain(clip, T(0, -0.022, 0.034), mat({ rot: [0, 0, 90] }))), 'brass', { seed: seed + 22 }));
  for (const s of [-1, 1]) {
    const x = s * jawW * 0.3;
    const loop = polylinePath([[x, -0.022, 0.036], [x, -0.07, 0.07], [x + s * 0.05, -0.1, 0.07], [x + s * 0.05, -0.05, 0.04], [x + s * 0.035, -0.022, 0.036]], 0.012, 4);
    arm.add(part('metal', transform(sweep(loop, { radius: 0.0055, segs: 5 }), clip), 'steel', { seed: seed + 23 + s }));
  }
  // a socket block joining the stick to the clip
  arm.add(part('brass', bevelBox({ min: [-0.035, S - 0.005, -0.03], max: [0.035, jy - 0.028, 0.03], c: 0.006 }), 'brass', { seed: seed + 26, shade: 0.9 }));

  // the card: bottom edge in the jaw; a slight curl and a dog-eared corner
  const cardNode = arm.node('card', T(0, jy - CARD_ARM.grip, 0));
  const curl = (u: number, v: number): number => 0.025 * (u - 0.5) * (u - 0.5) * 4 * v + (u > 0.9 && v > 0.88 ? 0.03 * ((u - 0.9) / 0.1) * ((v - 0.88) / 0.12) : 0);
  const face = transform(sheet({ w: card.w, h: card.h, t: 0.006, nx: 10, ny: 4, lift: curl }), T(0, card.h / 2, -0.003));
  if (card.key) cardNode.add(texturedPart('paper', face, card.key));
  else cardNode.add(part('paper', face, 'paper'));
  cardNode.add(part('paper', transform(sheet({ w: card.w, h: card.h, t: 0.006, nx: 10, ny: 4, lift: curl, back: true }), T(0, card.h / 2, -0.003)), 'paper', { shade: 0.86 }));

  b.socket('card', T(0, jy - CARD_ARM.grip + card.h / 2, 0));
  b.socket('slot', new Matrix4());
  const built = b.build();
  if (o.pose === undefined) return built;
  const p = typeof o.pose === 'string' ? NAMED_POSES[o.pose] : o.pose;
  if (!p) throw new Error(`card-arm: no pose '${String(o.pose)}' (has: ${Object.keys(NAMED_POSES).join(', ')})`);
  applyPosePiece(built, p, stow);
  return built;
}

/** Bake a pose into the Piece description (stills in the catalogue). */
function applyPosePiece(p: Piece, pose: CardArmPose, stow: number): void {
  const walk = (n: import('../../types.ts').PieceNode): void => {
    if (n.name === 'arm' || n.name === 'card') {
      const m = poseMatrixFor(n.name, pose, stow, n.transform ?? new Matrix4());
      n.transform = m;
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
}

function poseMatrixFor(name: string, pose: CardArmPose, stow: number, rest: Matrix4): Matrix4 {
  return name === 'arm' ? armTransform(pose, stow) : cardTransform(pose, rest);
}

/** Make the card label for a content text and return its ref. */
export function cardRef(labels: Labels, text: string): CardRef {
  const key = labels.card(text);
  return { key, ...labels.size(key) };
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'card-arm',
    build: (opts = {}) =>
      cardArm({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(opts['card'] ? { card: opts['card'] as CardRef } : {}),
        pose: typeof opts['pose'] === 'string' ? opts['pose'] : 'raised',
      }),
    variants: { high: { detail: 'high' }, low: { detail: 'low' } },
    poses: Object.keys(NAMED_POSES),
    labels: (labels) => ({ card: cardRef(labels, world.cards.revertRung1) }),
    camera: { distance: 6 },
    note: 'The Button’s cue card on its spring-loaded stick, rising out of a brass slot in the bench.',
  },
];
