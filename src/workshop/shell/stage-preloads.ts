/**
 * What a stage page's code fetches once it runs, asked for at once (B1): the
 * bake table, the label painters' script, the label fonts (low priority: they
 * must not slow the picture or the code). Not the engine's wasm: preloaded
 * from the head it took a share of the line from the picture and the code
 * (Fast 4G, measured: picture 0.93 s, usable 4.3 s); started by the early
 * script once its 3 KB chunk is in (about 0.55 s) it still lands long before
 * the world wants it (picture 0.73 s, usable 3.95 s).
 *
 * For a page's frontmatter (StageHead's `preload`; on `/` the links wait in a
 * <template> until the tier is known: the Still tier fetches none of them).
 */
import bakeUrl from '../view/kit/bake-table.bin?url';
import workerUrl from '../view/labels/worker.ts?worker&url';
import { FACES } from '../view/labels/fonts.ts';

/** A preload link (StageHead.astro). */
export interface Preload {
  href: string;
  /** Default fetch (what the stage's code does with it: fetch()). */
  as?: 'fetch' | 'script' | 'font' | 'image';
  type?: string;
  priority?: 'high' | 'low' | 'auto';
}

export const STAGE_PRELOADS: readonly Preload[] = [
  { href: bakeUrl, priority: 'low' },
  { href: workerUrl, priority: 'low' },
  ...Object.values(FACES).map((f) => ({ href: `/fonts/${f.file}`, priority: 'low' as const })),
];
