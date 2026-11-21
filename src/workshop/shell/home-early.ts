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
 * data-saver, failures, no WebGL 2 at all); here the stage's own WebGL 2
 * context is made on its canvas, with the attributes three will ask for, to
 * read the renderer's name (a software renderer is the Still tier). Three is
 * later handed the same context.
 */
import { chooseTier, readSignals, type StageTier } from './tier.ts';
import { createStrip } from '../ui/strip/strip.ts';

/**
 * The saved quality setting (`high`, `low`, `still`, or null for "choose"): the settings panel's, when it
 * arrives. Read it here (and in the head's inline script in Stage.astro, for `still`).
 */
export function savedQuality(): StageTier | 'auto' | null {
  return null;
}

const html = document.documentElement;
const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const quick = html.classList.contains('still');
const signals = readSignals(quick ? null : canvas, savedQuality());
const choice = chooseTier(signals);
html.dataset['tier'] = choice.tier;
html.dataset['tierWhy'] = choice.why;
const strip = createStrip(choice.tier === 'still' ? 'still' : 'stage');

if (choice.tier === 'still') {
  // a context made to read the renderer's name is let go
  if (canvas && !quick) {
    try {
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* nothing to let go */
    }
  }
  html.classList.remove('warming');
} else {
  const tpl = document.getElementById('stage-preloads') as HTMLTemplateElement | null;
  if (tpl) document.head.append(tpl.content.cloneNode(true));
  void import('./early.ts').then((m) => m.startEarly());
  const tier = choice.tier;
  import('./home.ts')
    .then((m) => m.startHome({ tier, strip }))
    .catch((e: unknown) => {
      // the stage's script never came (the network, a stale build): the plain document, as if it had failed
      console.error('workshop: the stage could not be loaded; the picture and the paperwork stay', e);
      html.classList.remove('warming');
      strip.setMode('still');
    });
}
