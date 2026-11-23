// The strip's Read swap (P3 B1): which addresses open the paperwork, and the head's copy of that list.
// P3 B2 (REWRITE.md § B6): an address that names a station frames it; `#patchlamp` names a station AND a section,
// so with the stage it frames the station and does not open the paperwork (without the stage it is a plain anchor).
import { describe, expect, it } from 'vitest';
import { PAPERWORK_IDS, STATION_ADDRESSES, readingFor, stationFor } from '../../../src/workshop/ui/strip/strip.ts';

describe('readingFor', () => {
  it('the paperwork and the sections with no station of their own (REWRITE.md § B6) open the paperwork there', () => {
    for (const id of ['paperwork', 'services', 'about', 'contact']) expect(readingFor(`#${id}`)).toBe(id);
  });
  it('no hash, an empty one, a station, or anything else is the stage', () => {
    for (const h of ['', '#', '#stage', '#patchlamp', '#Patchlamp', '#about-me', '#%E2%9C%93', '#%']) expect(readingFor(h)).toBeNull();
  });
  it('the list is exactly the paperwork, the three sections of § 2 with no station, and the two hatches (P4 H1)', () => {
    expect([...PAPERWORK_IDS].sort()).toEqual(['about', 'contact', 'maker', 'paperwork', 'patchlamp-toy', 'services']);
  });
  it('the two hatches’ sections open the paperwork there (P4 H1: Patchlamp’s hatch, the maker’s plate)', () => {
    expect(readingFor('#patchlamp-toy')).toBe('patchlamp-toy');
    expect(readingFor('#maker')).toBe('maker');
    expect(stationFor('#maker')).toBeNull();
  });
});

describe('stationFor', () => {
  it('a station of § C that the bench has frames it', () => {
    for (const id of ['top', 'patchlamp', 'button', 'line', 'tools']) expect(stationFor(`#${id}`)).toBe(id);
    expect([...STATION_ADDRESSES].sort()).toEqual(['button', 'line', 'patchlamp', 'tools', 'top']); // (P4 T2: /#tools, the tool wall)
  });
  it('anything else is no station', () => {
    for (const h of ['', '#', '#contact', '#about', '#Patchlamp', '#work', '#%']) expect(stationFor(h)).toBeNull();
  });
});
