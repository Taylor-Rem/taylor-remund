/**
 * (E1) The late loader: the crew members who arrive after the bench is usable. The owner's ruling (2026-11-25):
 * "We load the bench, then once that character loads they have an entrance." The budget's two rows follow from it
 * (`scripts/budget.ts`: "to usable" and "after").
 *
 * For each late unit that is switched on: in the first idle time after the bench is live (never on the way to
 * usable, as the sound is made ready, § E6), its two halves are fetched in parallel, each a chunk of its own: its
 * simulation (a scene module the shell may load: `sim/scenes/bench-<id>.ts`) and its views (the view's own loader,
 * `view/late.ts`). Its pieces are added to the list the bench's lookups read; its views are made on the running
 * stage one task at a time and their programs linked before they are drawn (`Workshop.addViews`); only then does it
 * join the world (`World.join`), at the start of the next step, and begin on its entrance.
 *
 * Nothing waits for it: every machine and crew member is whole without it. Refused (offline, a failed fetch), it
 * simply never comes, and nothing is reported (the bench is fine). A stage built again on the same world (a lost
 * graphics context, another tier) gets its views again (`again`).
 */
import type { LateArrival } from '../sim/scene.ts';
import type { StationView } from '../view/types.ts';
import type { Tier } from '../view/types.ts';
import { pitchViews } from '../view/late.ts';
import { addPieces } from '../view/catalogue/registry.ts';
import { PITCH_ON } from '../sim/scenes/bench.ts';
import type { BootStation, Workshop } from './boot.ts';

/** A development build's switches (`WORKSHOP_DEV_PAGES=1` at build: astro.config defines it; `astro dev` is one too). */
declare const __WORKSHOP_DEV_BUILD__: boolean | undefined;
const DEV_BUILD = !!import.meta.env?.DEV || (typeof __WORKSHOP_DEV_BUILD__ !== 'undefined' && __WORKSHOP_DEV_BUILD__ === true);
/**
 * A build with Pitch switched on as if `PITCH_ON` were (`WORKSHOP_PITCH=1` at build): the production page exactly as it
 * would be the day the owner flips the switch, for the browser test on the wire and the lead's review. Never set for
 * the build that is deployed.
 */
declare const __WORKSHOP_PITCH__: boolean | undefined;
const PITCH_BUILD = typeof __WORKSHOP_PITCH__ !== 'undefined' && __WORKSHOP_PITCH__ === true;
const query = (name: string): string | null => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(name);
  } catch {
    return null;
  }
};

interface LateUnit {
  readonly id: string;
  /** Switched on for this visit. */
  on(): boolean;
  /** Its simulation's half: the arrival, and what its views need from the scene. */
  sim(): Promise<{ arrival: LateArrival; viewOptions: (crewScale: number, tier: Tier) => unknown }>;
  /** Its views' half: its pieces' catalogue, and its views made from the options `sim` gives. */
  views(): Promise<{ pieces: readonly import('../view/catalogue/registry.ts').Entry[]; prepare(o: never): Promise<unknown[]> }>;
}

/**
 * Pitch (behind `PITCH_ON`, or a build made with `WORKSHOP_PITCH=1`; `?pitch=1` on a development page or build).
 * Where he cannot be on at all (the production page while `PITCH_ON` is off) this is null at build time, and nothing
 * the page loads can reach his chunk (scripts/budget.ts: his "after" row is empty).
 */
const PITCH: LateUnit | null =
  PITCH_ON || PITCH_BUILD || DEV_BUILD
    ? {
        id: 'pitch',
        on: () => PITCH_ON || PITCH_BUILD || query('pitch') === '1',
        async sim() {
          const m = await import('../sim/scenes/bench-pitch.ts');
          return {
            arrival: m.pitchArrival(),
            viewOptions: (scale: number, tier: Tier) => ({ scale, tier, mast: { at: m.PITCH_AT.mast, heading: m.PITCH_AT.heading, height: m.PITCH_AT.mastHeight } }),
          };
        },
        views: () => pitchViews() as never,
      }
    : null;

/** The late crew: Pitch is the only one so far. */
export const LATE_UNITS: readonly LateUnit[] = PITCH ? [PITCH] : [];

/** Is any late unit on for this visit? (A page that has none fetches nothing.) */
export function lateOn(): boolean {
  return LATE_UNITS.some((u) => u.on());
}

/** What the loader says it did (`window.__late`: the browser tests read it; nothing leaves the browser). */
export interface LateState {
  /** Per unit: asked (fetching), made (views ready), joined (in the world), or refused (it never comes). */
  units: Record<string, 'asked' | 'made' | 'joined' | 'refused'>;
  /** performance.now() of each step, per unit. */
  times: Record<string, { asked?: number; fetched?: number; made?: number; joined?: number }>;
}

export interface LateLoader {
  readonly state: LateState;
  /** The stage was built again on the same world: make the arrived units' views on it again. */
  again(ws: Workshop): void;
}

/**
 * Bring the late crew to a live bench: in the first idle time from now. `crewScale` is the bench's drawing scale and
 * `tier` the stage's. Call it once the bench is live (never on the way to usable).
 */
export function arriveLate(o: { workshop: () => Workshop | null; crewScale: number; tier: () => Tier }): LateLoader {
  const state: LateState = { units: {}, times: {} };
  (globalThis as { __late?: LateState }).__late = state;
  /** The views each arrived unit was made with, for a stage built again. */
  const made = new Map<string, () => Promise<BootStation[]>>();
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const idle = (f: () => void): void => {
    if (ric) ric.bind(globalThis)(f, { timeout: 1500 });
    else setTimeout(f, 200);
  };
  const go = async (u: LateUnit): Promise<void> => {
    const t = (state.times[u.id] = {} as LateState['times'][string]);
    state.units[u.id] = 'asked';
    t.asked = performance.now();
    try {
      const [s, v] = await Promise.all([u.sim(), u.views()]);
      t.fetched = performance.now();
      await addPieces(v.pieces);
      const stations = async (): Promise<BootStation[]> => (await v.prepare(s.viewOptions(o.crewScale, o.tier()) as never)) as BootStation[];
      const ws = o.workshop();
      if (!ws) throw new Error('no stage');
      await new Promise<void>((r) => idle(r));
      const views: StationView[] = await ws.addViews(await stations());
      if (views.length === 0) throw new Error('the stage went away');
      made.set(u.id, stations);
      state.units[u.id] = 'made';
      t.made = performance.now();
      ws.simWorld.join(s.arrival);
      state.units[u.id] = 'joined';
      t.joined = performance.now();
    } catch {
      // refused (offline, a failed fetch, the stage taken down): he simply does not come; the bench is whole without him
      state.units[u.id] = 'refused';
    }
  };
  idle(() => {
    for (const u of LATE_UNITS) if (u.on()) void go(u);
  });
  return {
    state,
    again(ws) {
      for (const stations of made.values()) void stations().then((s) => ws.addViews(s)).catch(() => {});
    },
  };
}
