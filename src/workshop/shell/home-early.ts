/**
 * The first script of `/` (P3 B1; REWRITE.md § E6, § E7): small, and it
 * imports nothing heavy. It chooses the tier, and only then asks for
 * anything heavy:
 *
 *   still       nothing more is fetched: not the stage's script, not the
 *               physics file, not the fonts, the bake table or the label
 *               painters. The page is the picture and the paperwork.
 *   high, low   the stage's preloads (waiting in a <template> in the page:
 *               a template's links are not fetched until they are put in the
 *               head), the physics engine (shell/early.ts) and the stage's
 *               script (shell/home.ts), all at once.
 *
 * The tier is read from shell/tier.ts: the head's inline script has already
 * settled the Still tier where no graphics context is needed (the address,
 * data-saver, failures, the visitor's saved "still picture", no WebGL 2 at
 * all); here the stage's own WebGL 2 context is made on its canvas, with the
 * attributes three will ask for, to read the renderer's name (a software
 * renderer is the Still tier). Three is later handed the same context.
 *
 * P3 B3: the settings control in the strip opens the settings panel; its code
 * (ui/settings/panel.ts, shell/settings-host.ts) is fetched on the first open,
 * or once the bench is usable, never before. `?playtest=1` and `?debug` load
 * their modules only when the address asks; without it they are never fetched.
 */
import { chooseTier, readSignals, type StageTier, type TierChoice, type TierSignals } from './tier.ts';
import { createStrip, type Strip } from '../ui/strip/strip.ts';
import { getSettings } from './saved.ts';
import type { HomeControl } from './home.ts';

/** The saved quality setting (`high`, `low`, `still`, or `auto`: choose). The head's script reads `still` too. */
export function savedQuality(): StageTier | 'auto' {
  return getSettings().quality;
}

/** What the page's lazily loaded parts (the settings, the playtest log, the debug panel) are handed. */
export interface HomePage {
  readonly strip: Strip;
  /** What was known when the tier was chosen, and the choice. */
  readonly signals: TierSignals;
  readonly choice: TierChoice;
  /** The stage's control once its script has loaded (null: the page began on the Still tier and nothing asked since). */
  home(): Promise<HomeControl | null>;
  /** Start the stage from the plain document (the page began on the Still tier): fetches what it needs. */
  startStage(tier: 'high' | 'low'): Promise<HomeControl | null>;
}

const html = document.documentElement;
const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const quick = html.classList.contains('still');
const signals = readSignals(quick ? null : canvas, savedQuality());
const choice = chooseTier(signals);
html.dataset['tier'] = choice.tier;
html.dataset['tierWhy'] = choice.why;
const strip = createStrip(choice.tier === 'still' ? 'still' : 'stage');

let home: Promise<HomeControl | null> | null = null;
let fetched = false;
/** Ask for everything heavy, then start the stage. */
function startStage(tier: 'high' | 'low'): Promise<HomeControl | null> {
  if (!fetched) {
    fetched = true;
    const tpl = document.getElementById('stage-preloads') as HTMLTemplateElement | null;
    if (tpl) document.head.append(tpl.content.cloneNode(true));
    void import('./early.ts').then((m) => m.startEarly());
  }
  return (home = import('./home.ts')
    .then((m) => m.startHome({ tier, strip }))
    .catch((e: unknown) => {
      // the stage's script never came (the network, a stale build): the plain document, as if it had failed
      console.error('workshop: the stage could not be loaded; the picture and the paperwork stay', e);
      html.classList.remove('warming');
      strip.setMode('still');
      return null;
    }));
}

if (choice.tier === 'still') {
  // a context made to read the renderer's name is let go (the stage, if the visitor starts it, draws on a fresh canvas)
  if (canvas && !quick) {
    try {
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* nothing to let go */
    }
    canvas.replaceWith(canvas.cloneNode(false));
  }
  html.classList.remove('warming');
} else {
  void startStage(choice.tier);
}

const page: HomePage = { strip, signals, choice, home: () => home ?? Promise.resolve(null), startStage };

// ── the settings: their code on the first open, or once the bench is usable ──
const opener = document.querySelector<HTMLButtonElement>('button.settings-open');
let settings: Promise<typeof import('../ui/settings/panel.ts')> | null = null;
const loadSettings = (): Promise<typeof import('../ui/settings/panel.ts')> =>
  (settings ??= Promise.all([import('../ui/settings/panel.ts'), import('./settings-host.ts')]).then(([panel, host]) => {
    panel.mountSettings(host.settingsHost(page));
    return panel;
  }));
opener?.addEventListener('click', () => void loadSettings().then((m) => m.toggleSettings()));
void page.home().then((h) => h?.ready.then(() => setTimeout(() => void loadSettings(), 1000)));

// ── for playtests and people helping debug, only when the address asks ──
const q = new URLSearchParams(location.search);
if (q.get('playtest') === '1') void import('../ui/playtest/index.ts').then((m) => m.startPlaytest(page));
if (q.has('debug')) void import('../ui/debug/index.ts').then((m) => m.startDebug(page));
