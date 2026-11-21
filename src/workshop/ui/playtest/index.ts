/**
 * `?playtest=1` on `/` (P3 B3; REWRITE.md § I, § E10): a timestamped log of
 * what the tester did and what came of it, kept in memory, offered as a file
 * by one small control in the bottom-left corner. Loaded only when the
 * address asks (shell/home-early.ts imports it behind the check). It never
 * sends anything anywhere and stores nothing: the file is made in the page
 * (a Blob and a download link) when the observer presses the control.
 *
 * It records: when the picture showed and when the bench became usable; every
 * deliberate action (press, turn, pick up, let go, put down, throw, plug,
 * text, undo, reset), with the kind of input that made it (mouse, touch, pen,
 * keys) and the thing it was on, by id; every consequence the world reports
 * that a machine or a part did, with the action it came from (by the
 * transaction it wrote under, else the part it moved, else the press or
 * text it followed); each station first used; presses on the strip and in
 * the settings; the tab hidden and shown; the tier, the viewport and the
 * motion setting as they change. Gaps without input are computed from the
 * input times when the file is made. Typed words never: a text is "typed",
 * or the ready-made text it was.
 */
import { logFile, type InputKind, type Row, type Verb } from './log.ts';
import { readyTexts } from '../../../content/texts.ts';
import { site } from '../../../content/site.ts';
import { getSettings, onSettings, reducedNow, systemReducesMotion } from '../../shell/saved.ts';
import { isMuted } from '../../audio/mute.ts';
import type { HomePage } from '../../shell/home-early.ts';
import type { Id, Intent, SimEvent, World } from '../../sim/index.ts';

const now = (): number => Math.round(performance.now());
const round = (v: readonly number[]): number[] => v.map((x) => Math.round(x * 100) / 100);
/** Faster than this as it leaves the hand (units a second) is a throw, not a set-down. */
const THROW_SPEED = 1.5;
/** An intent this soon after an input event was made by it. */
const INPUT_WINDOW_MS = 1500;

/** The actions a kind of transaction (§ E5 rule 3) is opened by. */
const VERBS_OF: Readonly<Record<string, readonly Verb[]>> = {
  press: ['press'],
  turn: ['turn'],
  text: ['text'],
  plug: ['plug', 'let-go'],
  grab: ['pick-up'],
  release: ['let-go', 'put-down', 'throw'],
  place: ['put-down'],
};

const READY: ReadonlySet<string> = new Set(Object.values(readyTexts).flat() as string[]);

export interface Playtest {
  rows: readonly Row[];
  file(): string;
}

export function startPlaytest(page: HomePage): Playtest {
  const rows: Row[] = [];
  const inputs: number[] = [];
  const add = (r: Row): void => {
    rows.push(r);
  };
  const html = document.documentElement;
  const viewport = (): { w: number; h: number; dpr: number } => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 });
  const motion = (): { setting: string; system: boolean; reduced: boolean } => ({ setting: getSettings().motion, system: systemReducesMotion(), reduced: reducedNow() });
  add({ t: now(), kind: 'page', tier: html.dataset['tier'] ?? '', why: html.dataset['tierWhy'] ?? '', viewport: viewport(), motion: motion(), sound: !isMuted() });

  // ── the picture, and when the bench became usable ──
  const img = document.querySelector<HTMLImageElement>('img.poster');
  let pictured = false;
  const pictureAt = (t: number): void => {
    if (pictured) return;
    pictured = true;
    rows.splice(1, 0, { t: Math.round(t), kind: 'picture' });
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { identifier?: string; renderTime?: number; loadTime?: number })[]) {
        if (e.identifier === 'poster') pictureAt(e.renderTime || e.loadTime || e.startTime);
      }
    }).observe({ type: 'element', buffered: true });
  } catch {
    /* no element timing in this browser */
  }
  // (no element timing: the picture had loaded by now, or will)
  setTimeout(() => {
    if (pictured || !img) return;
    if (img.complete) pictureAt((performance.getEntriesByName(img.currentSrc)[0] as PerformanceResourceTiming | undefined)?.responseEnd ?? now());
    else img.addEventListener('load', () => pictureAt(now()), { once: true });
  }, 3000);
  let usable = false;
  const usableTimer = setInterval(() => {
    const at = (window as unknown as { __handoff?: { usableAt: number | null } }).__handoff?.usableAt;
    if (typeof at === 'number' && !usable) {
      usable = true;
      add({ t: Math.round(at), kind: 'usable' });
      clearInterval(usableTimer);
    }
  }, 250);

  // ── input: what kind, and when ──
  let lastInput: { kind: InputKind; t: number } = { kind: 'unknown', t: -Infinity };
  let lastWheel = -Infinity;
  addEventListener('pointerdown', (e) => {
    const t = now();
    inputs.push(t);
    lastInput = { kind: e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse', t };
  }, true);
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const t = now();
    inputs.push(t);
    lastInput = { kind: 'keys', t };
  }, true);
  addEventListener('wheel', () => {
    const t = now();
    if (t - lastWheel > 250) inputs.push(t);
    lastWheel = t;
  }, { capture: true, passive: true });
  const kind = (t: number): InputKind => (t - lastInput.t <= INPUT_WINDOW_MS ? lastInput.kind : 'unknown');

  // ── the strip, the settings, the page ──
  const stripName = (el: Element): string | null => {
    if (el.matches('.skip')) return 'skip';
    if (el.matches('.restart')) return 'restart';
    if (el.matches('.read')) return 'read';
    if (el.matches('.back')) return 'back';
    if (el.matches('.sound')) return 'sound';
    if (el.matches('.settings-open')) return 'settings';
    const href = el.getAttribute('href') ?? '';
    if (href.startsWith('/resume')) return 'resume';
    if (href.includes('github.com')) return 'github';
    if (href.includes('linkedin.com')) return 'linkedin';
    if (href.startsWith('mailto:')) return 'email';
    return href || el.textContent?.trim().slice(0, 20) || null;
  };
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const strip = t?.closest('.strip a, .strip button, a.skip, button.restart, footer.legal a');
    if (strip) {
      const control = stripName(strip);
      if (control) add({ t: now(), kind: 'strip', control });
      return;
    }
    const reset = t?.closest('#settings .settings-reset');
    if (reset) add({ t: now(), kind: 'settings', control: 'reset', value: reset.hasAttribute('data-armed') ? 'confirmed' : 'armed' });
    else if (t?.closest('#settings .settings-close')) add({ t: now(), kind: 'settings', control: 'close' });
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.closest('#settings') && t.checked) add({ t: now(), kind: 'settings', control: t.name.replace(/^settings-/, ''), value: t.value });
  }, true);
  document.addEventListener('visibilitychange', () => add({ t: now(), kind: 'visibility', hidden: document.hidden }));
  let resized: ReturnType<typeof setTimeout> | undefined;
  addEventListener('resize', () => {
    clearTimeout(resized);
    resized = setTimeout(() => add({ t: now(), kind: 'viewport', viewport: viewport() }), 400);
  });
  new MutationObserver(() => add({ t: now(), kind: 'tier', tier: html.dataset['tier'] ?? '', why: html.dataset['tierWhy'] ?? '' })).observe(html, { attributes: true, attributeFilter: ['data-tier'] });
  let lastMotion = JSON.stringify(motion());
  const motionChanged = (): void => {
    const m = motion();
    const k = JSON.stringify(m);
    if (k === lastMotion) return;
    lastMotion = k;
    add({ t: now(), kind: 'motion', motion: m });
  };
  onSettings(motionChanged);
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', motionChanged);
  } catch {
    /* no media queries */
  }

  // ── the world: actions and their consequences ──
  let seq = 0;
  let lastAction: number | null = null;
  let lastPress: number | null = null;
  let lastText: number | null = null;
  let held: Id | null = null;
  const dragging = new Set<Id>();
  const actionOn = new Map<Id, number>();
  const causeOfTxn = new Map<string, number | null>();
  const causeOfPart = new Map<Id, number>();
  const used = new Set<Id>();
  let world: World | null = null;
  const action = (t: number, verb: Verb, extra: Omit<Extract<Row, { kind: 'action' }>, 't' | 'kind' | 'seq' | 'verb' | 'input'> = {}): number => {
    const n = ++seq;
    add({ t: Math.round(t), kind: 'action', seq: n, verb, input: kind(t), ...extra });
    lastAction = n;
    if (extra.id) actionOn.set(extra.id, n);
    return n;
  };

  const onIntent = (intent: Intent, at: number): void => {
    switch (intent.type) {
      case 'grab':
        held = intent.id;
        action(at, 'pick-up', { id: intent.id });
        break;
      case 'release':
        if (held) action(at, 'let-go', { id: held });
        held = null;
        break;
      case 'place':
        action(at, 'put-down', { ...(held ? { id: held } : {}), at: typeof intent.at === 'string' ? intent.at : round(intent.at) });
        held = null;
        break;
      case 'press':
        lastPress = action(at, 'press', { id: intent.id });
        break;
      case 'turn':
        action(at, 'turn', { id: intent.id, value: Math.round(intent.value * 100) / 100 });
        break;
      case 'unplug':
        held = intent.cord;
        action(at, 'pick-up', { id: intent.cord });
        break;
      case 'plug':
        action(at, intent.jack === null ? 'let-go' : 'plug', { id: intent.cord, ...(intent.jack ? { at: intent.jack } : {}) });
        held = null;
        break;
      case 'text':
        // never the visitor's words: which ready-made text, or "typed"
        lastText = action(at, 'text', { text: READY.has(intent.text) ? { ready: intent.text } : 'typed' });
        break;
      case 'undo':
        action(at, 'undo');
        break;
      case 'reset':
        action(at, 'reset');
        break;
      case 'drag':
        if (!dragging.has(intent.id)) {
          dragging.add(intent.id);
          action(at, 'pick-up', { id: intent.id });
        }
        if (intent.end) {
          dragging.delete(intent.id);
          action(at, 'let-go', { id: intent.id });
        }
        break;
      default:
        break; // hover, carry, motion: not deliberate actions
    }
  };

  /** A transaction's action: by the thing it was opened on, else the latest action of its kind. */
  const txnCause = (txn: string): number | null => {
    if (causeOfTxn.has(txn)) return causeOfTxn.get(txn)!;
    const entry = world?.undoStack().find((x) => x.id === txn);
    let c: number | null = lastAction;
    if (entry) {
      const verbs: readonly Verb[] = VERBS_OF[entry.kind] ?? [];
      const latest = (): number | null => {
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i]!;
          if (r.kind === 'action' && verbs.includes(r.verb)) return r.seq;
        }
        return null;
      };
      c = (entry.kind === 'text' ? lastText : null) ?? actionOn.get(entry.subject) ?? latest() ?? lastAction;
    }
    causeOfTxn.set(txn, c);
    return c;
  };
  const partCause = (part: Id | null | undefined): number | null => (part ? (causeOfPart.get(part) ?? actionOn.get(part) ?? null) : null);
  const conseq = (e: Omit<Extract<Row, { kind: 'consequence' }>, 't' | 'kind'>): void => {
    if (e.cause === null) return; // what the crew and the system do by themselves is not a consequence
    add({ t: now(), kind: 'consequence', ...e });
  };
  const isMachine = (id: Id): boolean => world?.machine(id) !== undefined;

  const onEvent = (e: SimEvent): void => {
    switch (e.type) {
      case 'part.released': {
        // the last let-go of this part becomes a put-down or a throw, by how fast it left the hand
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i]!;
          if (r.kind === 'action' && r.id === e.id && r.verb === 'let-go') {
            r.speed = Math.round(e.speed * 100) / 100;
            r.verb = e.speed > THROW_SPEED ? 'throw' : 'put-down';
            break;
          }
          if (r.kind === 'action' && r.id === e.id) break;
        }
        return;
      }
      case 'part.rested': {
        const m = world?.motion(e.id);
        conseq({ event: e.type, id: e.id, cause: partCause(e.id), ...(m ? { at: round(m.pose.p) } : {}) });
        return;
      }
      case 'effect': {
        const c = e.effect.cause;
        if (c === 'crew' || c === 'system') return;
        const cause = txnCause(c);
        if (cause !== null && !isMachine(e.effect.target)) causeOfPart.set(e.effect.target, cause);
        // by target and field only: a value a text wrote is the visitor's words
        conseq({ event: e.type, id: e.effect.target, field: e.effect.field, cause, ...(isMachine(e.effect.target) ? { machine: e.effect.target } : {}) });
        return;
      }
      case 'taken-in':
      case 'shipped':
        conseq({ event: e.type, machine: e.id, part: e.part, cause: partCause(e.part) });
        return;
      case 'struck':
        conseq({ event: e.type, machine: e.id, ...(e.part ? { part: e.part } : {}), cause: e.part ? partCause(e.part) : lastPress });
        return;
      case 'returned':
        conseq({ event: e.type, machine: e.id, part: e.part, cause: partCause(e.part) ?? lastAction });
        return;
      case 'misfire':
        conseq({ event: e.type, machine: e.id, cause: lastPress });
        return;
      case 'button.pressed':
      case 'rung.started':
      case 'rung.ended': {
        const by = lastPress === null ? undefined : (rows.find((r) => r.kind === 'action' && r.seq === lastPress) as Extract<Row, { kind: 'action' }> | undefined)?.id;
        conseq({ event: e.type, rung: e.rung, ...(by ? { machine: by } : {}), cause: lastPress });
        return;
      }
      case 'cord.plugged':
      case 'cord.unplugged':
        if (e.by) return;
        conseq({ event: e.type, machine: e.cord, id: e.jack, cause: actionOn.get(e.cord) ?? lastAction });
        return;
      case 'line.sent':
        if (e.by === 'crew') return;
        // (never e.text)
        conseq({ event: e.type, machine: 'line', id: e.jack, cause: lastText });
        return;
      case 'undone':
      case 'undo.refused':
      case 'reset':
        conseq({ event: e.type, cause: lastAction });
        return;
      case 'crew.knocked':
        conseq({ event: e.type, id: e.id, part: e.by, cause: partCause(e.by) });
        return;
      case 'cover':
        conseq({ event: e.type, id: e.id, cause: lastPress });
        return;
      case 'saved.changed': {
        for (const s of world?.saved().used ?? []) {
          if (used.has(s)) continue;
          used.add(s);
          add({ t: now(), kind: 'first-use', station: s, cause: lastAction });
        }
        return;
      }
      default:
        if (e.type.startsWith('line.') && !('by' in e && e.by === 'crew')) conseq({ event: e.type, machine: 'line', cause: lastText });
    }
  };

  void page.home().then((h) => {
    if (!h) return;
    h.onIntent(onIntent);
    h.onFrame((frame) => {
      world = frame.world as World;
      // what an earlier visit used is not this visit's first use
      if (used.size === 0 && seq === 0) for (const s of world.saved().used) used.add(s);
      for (const e of frame.events) onEvent(e);
    });
  });

  // ── the offer: one quiet control in the bottom-left corner ──
  const words = site.playtest;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'playtest-save';
  Object.assign(button.style, {
    position: 'fixed', left: '16px', bottom: '8px', zIndex: '31', minHeight: '32px', padding: '4px 10px',
    font: "600 13px/20px 'Strip Tape', system-ui, sans-serif", letterSpacing: '0.03em',
    color: 'var(--cream-soft)', background: 'var(--wall)', border: '1px solid var(--cream-soft)', borderRadius: '3px', cursor: 'pointer', opacity: '0.85',
  } satisfies Partial<CSSStyleDeclaration>);
  const label = (): void => {
    button.textContent = `${words.save.text} · ${rows.length} ${words.count.text}`;
  };
  label();
  setInterval(label, 1000);
  const file = (): string =>
    logFile({ rows, inputs, end: now() }, { address: location.pathname + location.search, userAgent: navigator.userAgent, taken: now(), viewport: viewport(), motion: motion() });
  button.addEventListener('click', () => {
    const blob = new Blob([file()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  document.body.append(button);
  return { rows, file };
}
