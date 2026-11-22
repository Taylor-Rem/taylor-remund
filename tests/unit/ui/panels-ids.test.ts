// P4 H1: what a plate must emit to open a panel (src/workshop/ui/panels/ids.ts).
import { describe, expect, test } from 'vitest';
import { panelId, platePanel } from '../../../src/workshop/ui/panels/ids.ts';
import { BENCH_PROJECTS } from '../../../src/content/bench-projects.ts';
import { projectAnchor } from '../../../src/components/paper/projects.ts';

describe('panel ids', () => {
  test('the four panels and the clipboard by name; anything else is not a panel', () => {
    for (const id of ['patchlamp', 'maker', 'contact', 'resume']) expect(panelId(id)).toBe(id);
    for (const bad of ['', 'Patchlamp', 'project:', 'project:Bad Slug', 'settings', 3, null, undefined]) expect(panelId(bad)).toBeNull();
  });

  test('a project by its slug, or by its anchor on /resume/ (the crates speak in anchors)', () => {
    expect(panelId('project:clean-green-inspections')).toBe('project:clean-green-inspections');
    expect(panelId('project:p-clean-green-inspections')).toBe('project:clean-green-inspections');
  });

  test('every project crate’s anchor is the one /resume/ gives its entry, so its card can be found', () => {
    for (const p of Object.values(BENCH_PROJECTS)) {
      expect(p.anchor).toBe(projectAnchor(p.entry));
      expect(panelId(`project:${p.anchor}`)).toBe(`project:${p.anchor.slice(2)}`);
    }
  });

  test('a frame’s sim events: only a plate’s opens a panel', () => {
    expect(platePanel({ type: 'plate.pressed', plate: 'maker', by: 'maker-plate' } as { type: string })).toBe('maker');
    expect(platePanel({ type: 'plate.pressed', plate: 'nonsense' } as { type: string })).toBeNull();
    expect(platePanel({ type: 'crate.opened' })).toBeNull();
  });
});
