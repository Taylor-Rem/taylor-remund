/**
 * The controls list's start (P3 B2): loaded only once the page has chosen a
 * stage tier, it waits for the running workshop (shell/home.ts `onWorkshop`,
 * which comes when the bench is usable) and builds the list then, so nothing
 * here stands between the visitor and a usable bench. It follows the
 * workshop when it is rebuilt (a lost context, a step down a tier) or
 * restarted, and takes the list away when the stage gives up.
 */
import { onWorkshop } from '../../shell/home.ts';
import { attachControls } from './list.ts';

export function mountControls(doc: Document = document): void {
  const root = doc.getElementById('controls');
  const said = doc.getElementById('controls-said');
  if (!root || !said) return;
  const opener = doc.querySelector<HTMLButtonElement>('button.controls-opener');
  let detach: (() => void) | null = null;
  onWorkshop((ws) => {
    detach?.();
    detach = null;
    if (ws) detach = attachControls(ws, { root, said, opener });
  });
}
