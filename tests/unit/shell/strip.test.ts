// The strip's Read swap (P3 B1): which addresses open the paperwork, and the head's copy of that list.
import { describe, expect, it } from 'vitest';
import { PAPERWORK_IDS, readingFor } from '../../../src/workshop/ui/strip/strip.ts';

describe('readingFor', () => {
  it('the paperwork and its four sections (REWRITE.md § 2: the anchors keep working) open the paperwork there', () => {
    for (const id of ['paperwork', 'patchlamp', 'services', 'about', 'contact']) expect(readingFor(`#${id}`)).toBe(id);
  });
  it('no hash, an empty one, or anything else is the stage', () => {
    for (const h of ['', '#', '#stage', '#Patchlamp', '#about-me', '#%E2%9C%93', '#%']) expect(readingFor(h)).toBeNull();
  });
  it('the list is exactly the paperwork and the four anchors of § 2', () => {
    expect([...PAPERWORK_IDS].sort()).toEqual(['about', 'contact', 'paperwork', 'patchlamp', 'services']);
  });
});
