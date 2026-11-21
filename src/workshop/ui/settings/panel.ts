/**
 * The settings panel's behaviour (P3 B3; REWRITE.md § B4, § B9, § B10, § E9,
 * § E10). The markup and its words are SettingsPanel.astro's; what each
 * setting does to the page is the host's (shell/settings-host.ts). This file
 * is fetched on the first open, or once the bench is usable, never before.
 *
 *   - opened and closed by the strip's settings control (`aria-expanded`);
 *     closed by Esc, by its own Close, and by a press outside it. Focus goes
 *     into it when it opens (the chosen option of its first group) and back to
 *     the control when it closes (unless the press outside put it elsewhere);
 *   - sound, motion, quality: radio groups that show the state as it is now
 *     (sound follows the strip's Sound control and the M key at all times);
 *   - "Reset the workshop": the first press arms it (its label asks for a
 *     second press); a second press within a few seconds resets; leaving it
 *     disarms it;
 *   - the groups marked `data-needs="stage"` are hidden while there is no stage.
 */
import type { MotionSetting, QualitySetting } from '../../shell/saved.ts';

export interface SettingsHost {
  /** Is the stage up (else the panel holds the quality alone)? */
  stageUp(): boolean;
  onStageChange(f: () => void): void;
  soundOn(): boolean;
  setSound(on: boolean): void;
  onSound(f: () => void): void;
  motion(): MotionSetting;
  setMotion(m: MotionSetting): void;
  quality(): QualitySetting;
  /** Resolves once the page has followed the new quality (the stage rebuilt, taken down or started). */
  setQuality(q: QualitySetting): Promise<void>;
  /** "Reset the workshop". */
  reset(): Promise<boolean>;
}

/** How long an armed reset waits for its second press, ms. */
export const RESET_ARMED_MS = 5000;

let panel: HTMLElement | null = null;
let opener: HTMLButtonElement | null = null;
let host: SettingsHost | null = null;
let wired = false;

const radios = (name: string): HTMLInputElement[] => [...(panel?.querySelectorAll<HTMLInputElement>(`input[name="settings-${name}"]`) ?? [])];
const check = (name: string, value: string): void => {
  for (const r of radios(name)) r.checked = r.value === value;
};

function show(): void {
  if (!panel || !host) return;
  check('sound', host.soundOn() ? 'on' : 'off');
  check('motion', host.motion());
  check('quality', host.quality());
  const up = host.stageUp();
  for (const el of panel.querySelectorAll<HTMLElement>('[data-needs="stage"]')) el.hidden = !up;
}

export function mountSettings(h: SettingsHost): void {
  host = h;
  panel = document.getElementById('settings');
  opener = document.querySelector<HTMLButtonElement>('button.settings-open');
  if (!panel || wired) return;
  wired = true;
  const p = panel;
  show();
  h.onSound(show);
  h.onStageChange(() => {
    // a group that hides under the focus gives the focus to the panel's first control
    const had = p.contains(document.activeElement);
    show();
    if (had && !(document.activeElement instanceof HTMLElement && document.activeElement.offsetParent)) firstControl()?.focus();
  });

  p.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.checked) return;
    if (t.name === 'settings-sound') h.setSound(t.value === 'on');
    else if (t.name === 'settings-motion') h.setMotion(t.value as MotionSetting);
    else if (t.name === 'settings-quality') {
      const group = radios('quality');
      for (const r of group) r.disabled = true;
      p.querySelector('.settings-quality')?.setAttribute('aria-busy', 'true');
      void h.setQuality(t.value as QualitySetting).finally(() => {
        for (const r of group) r.disabled = false;
        p.querySelector('.settings-quality')?.removeAttribute('aria-busy');
        show();
        // (a disabled radio lost the focus: give it back)
        if (p.hidden === false && !p.contains(document.activeElement)) group.find((r) => r.checked)?.focus();
      });
    }
  });

  // ── reset: armed by the first press, done by the second ──
  const reset = p.querySelector<HTMLButtonElement>('.settings-reset');
  const status = p.querySelector<HTMLElement>('.settings-status');
  let disarm: ReturnType<typeof setTimeout> | undefined;
  const setArmed = (on: boolean): void => {
    if (!reset) return;
    clearTimeout(disarm);
    reset.toggleAttribute('data-armed', on);
    reset.textContent = (on ? reset.dataset['confirm'] : reset.dataset['label']) ?? '';
    if (on) disarm = setTimeout(() => setArmed(false), RESET_ARMED_MS);
  };
  reset?.addEventListener('click', () => {
    if (!reset.hasAttribute('data-armed')) {
      if (status) status.textContent = '';
      setArmed(true);
      return;
    }
    setArmed(false);
    void h.reset().then((ok) => {
      if (ok && status) status.textContent = status.dataset['done'] ?? '';
    });
  });
  reset?.addEventListener('blur', () => setArmed(false));

  // ── open and close ──
  p.querySelector('.settings-close')?.addEventListener('click', () => close(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !p.hidden) {
      e.stopPropagation();
      close(true);
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (p.hidden) return;
    const t = e.target as Node | null;
    if (t && (p.contains(t) || opener?.contains(t))) return;
    close(false);
  }, true);
  addEventListener('resize', () => {
    if (!p.hidden) place();
  });
}

function firstControl(): HTMLElement | null {
  if (!panel) return null;
  for (const g of panel.querySelectorAll<HTMLElement>('fieldset')) {
    if (g.hidden) continue;
    return g.querySelector<HTMLInputElement>('input:checked') ?? g.querySelector<HTMLInputElement>('input');
  }
  return panel.querySelector<HTMLElement>('.settings-close');
}

/** Just under the strip, at its right end. */
function place(): void {
  if (!panel) return;
  const strip = document.querySelector('.strip');
  const bottom = strip ? strip.getBoundingClientRect().bottom : 0;
  panel.style.top = `${Math.max(8, Math.round(bottom + 8))}px`;
}

export function isOpen(): boolean {
  return !!panel && !panel.hidden;
}

export function open(): void {
  if (!panel) return;
  show();
  panel.hidden = false;
  place();
  opener?.setAttribute('aria-expanded', 'true');
  firstControl()?.focus({ preventScroll: true });
}

/** `refocus`: give the focus back to the control (Esc, Close); a press outside leaves it where it landed. */
export function close(refocus: boolean): void {
  if (!panel || panel.hidden) return;
  const had = panel.contains(document.activeElement);
  panel.hidden = true;
  opener?.setAttribute('aria-expanded', 'false');
  const reset = panel.querySelector<HTMLButtonElement>('.settings-reset');
  if (reset?.hasAttribute('data-armed')) reset.blur();
  const status = panel.querySelector<HTMLElement>('.settings-status');
  if (status) status.textContent = '';
  if (refocus || had) opener?.focus({ preventScroll: true });
}

export function toggleSettings(): void {
  if (isOpen()) close(true);
  else open();
}
