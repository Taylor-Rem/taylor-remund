/**
 * What each setting does to `/` (P3 B3; REWRITE.md § B9, § B10, § E7, § E10):
 * the host the settings panel (ui/settings/panel.ts) talks to. Fetched with
 * the panel, never before.
 *
 *   sound     audio/mute.ts, the same state as the strip's Sound control and
 *             the M key.
 *   motion    stored (shell/saved.ts); home.ts follows the effective value
 *             (the world and the camera at once, the views by a rebuild).
 *   quality   stored, then followed at once:
 *               high / low   the stage built again on the same world, the
 *                            camera where it was (home.ts `setTier`); from the
 *                            plain document, the stage starts;
 *               still        the stage is taken down: the plain document;
 *               automatic    what `chooseTier` says for this browser now
 *                            (the address's `?tier=` aside): an earlier visit's
 *                            slow frames (`MEASURED_KEY`) still mean low, so a
 *                            visitor who wants high on such a machine says High;
 *                            data-saver, a software renderer or two failures
 *                            this session mean the still picture.
 *   reset     the world's `reset` intent (home.ts). With no stage there is
 *             nothing to reset (the panel does not offer it).
 */
import { chooseTier, measuredTier } from './tier.ts';
import { getSettings, setSettings, type QualitySetting } from './saved.ts';
import { isMuted, onMuted, setMuted } from '../audio/mute.ts';
import type { HomePage } from './home-early.ts';
import type { SettingsHost } from '../ui/settings/panel.ts';

/** The tier "automatic" means in this browser now. */
export function autoTier(page: Pick<HomePage, 'signals'>): 'high' | 'low' | 'still' {
  return chooseTier({ ...page.signals, override: null, saved: 'auto', measured: measuredTier() }).tier;
}

export function settingsHost(page: HomePage): SettingsHost {
  const html = document.documentElement;
  const stageUp = (): boolean => html.classList.contains('stage-on');
  let busy: Promise<void> = Promise.resolve();

  const follow = async (q: QualitySetting): Promise<void> => {
    // the panel draws the visitor's choice before a rebuild holds the page for a moment
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const target = q === 'auto' ? autoTier(page) : q;
    const home = await page.home();
    if (target === 'still') {
      if (home) home.toStill();
      else {
        html.dataset['tier'] = 'still';
        html.dataset['tierWhy'] = 'saved setting';
      }
      return;
    }
    if (home) {
      await home.setTier(target);
      return;
    }
    // the page began on the Still tier: the stage's layout, then everything it needs
    html.dataset['tier'] = target;
    html.dataset['tierWhy'] = 'saved setting';
    page.strip.setMode('stage');
    const started = await page.startStage(target);
    await started?.ready;
  };

  return {
    stageUp,
    onStageChange(f) {
      new MutationObserver(f).observe(html, { attributes: true, attributeFilter: ['class'] });
    },
    soundOn: () => !isMuted(),
    setSound: (on) => setMuted(!on),
    onSound(f) {
      onMuted(() => f());
    },
    motion: () => getSettings().motion,
    setMotion: (m) => setSettings({ motion: m }),
    quality: () => getSettings().quality,
    setQuality(q) {
      setSettings({ quality: q });
      // one change at a time, in the order asked
      busy = busy.then(() => follow(q)).catch((e: unknown) => console.error('workshop: the quality could not be changed', e));
      return busy;
    },
    async reset() {
      const home = await page.home();
      return home ? home.reset() : false;
    },
  };
}
