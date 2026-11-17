/**
 * Content is plain JSON under src/content/, read by the pages, the workshop
 * bundle and the Node check scripts alike (REWRITE.md § E2: every sentence a
 * visitor can read lives here, each with a source).
 *
 * An *entry* is any JSON object with a string `text` field. Every entry says
 * what kind of sentence it is:
 * - `fact`  a claim about the world (Taylor, his work, Patchlamp, prices);
 *           it must carry a non-empty `source` saying where it is true.
 * - `voice` a line in a character's or the site's voice, not a claim.
 * - `ui`    a label, link text or heading that names a thing.
 */

export const ENTRY_KINDS = ['fact', 'voice', 'ui'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

interface EntryBase {
  text: string;
  /** Where the sentence is true or where it was taken from. Required for facts. */
  source?: string;
  /** Optional link target for entries that are links. */
  href?: string;
}
export interface FactEntry extends EntryBase {
  kind: 'fact';
  source: string;
}
export interface VoiceEntry extends EntryBase {
  kind: 'voice';
}
export interface UiEntry extends EntryBase {
  kind: 'ui';
}
export type Entry = FactEntry | VoiceEntry | UiEntry;

export interface ContentError {
  /** JSON path of the offending entry, e.g. `$.strip.links[0]`. */
  path: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function key(path: string, k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

/** Returns every problem found in a parsed content file; empty means valid. */
export function validateContent(json: unknown): ContentError[] {
  const errors: ContentError[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (!isObject(node)) return;
    if (typeof node.text === 'string') checkEntry(node, path, errors);
    for (const [k, v] of Object.entries(node)) walk(v, key(path, k));
  };
  walk(json, '$');
  return errors;
}

function checkEntry(node: Record<string, unknown>, path: string, errors: ContentError[]): void {
  const kind = node.kind;
  if (!(ENTRY_KINDS as readonly unknown[]).includes(kind)) {
    errors.push({ path, message: `entry needs "kind" of ${ENTRY_KINDS.join(' | ')}, got ${JSON.stringify(kind)}` });
  }
  if (node.text === '') errors.push({ path, message: 'entry "text" is empty' });
  if ('source' in node && typeof node.source !== 'string') {
    errors.push({ path, message: '"source" must be a string' });
  }
  if (kind === 'fact' && (typeof node.source !== 'string' || node.source.trim() === '')) {
    errors.push({ path, message: 'a "fact" entry needs a non-empty "source"' });
  }
  if ('href' in node && typeof node.href !== 'string') {
    errors.push({ path, message: '"href" must be a string' });
  }
}

/** Throws with every problem listed; use where a page or script loads content. */
export function assertContent<T>(json: T, name: string): T {
  const errors = validateContent(json);
  if (errors.length > 0) {
    throw new Error(`${name}: invalid content\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  }
  return json;
}
