import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worldJson from '../../../src/content/world.json';
import { validateContent } from '../../../src/content/schema.ts';
import { CONTENT_IDS, contentById, world } from '../../../src/workshop/view/labels/content.ts';
import { cardFor } from '../../../src/workshop/sim/machines/button.ts';
import { walk } from '../../../scripts/lib/fsutil.ts';
import { FACES, SUBSET } from '../../../src/workshop/view/labels/fonts.ts';
import type { FaceRole } from '../../../src/workshop/view/labels/fonts.ts';

describe('src/content/world.json', () => {
  it('is valid content: every entry has a kind, every fact a source', () => {
    expect(validateContent(worldJson)).toEqual([]);
  });

  it('carries a source on every entry, not just the facts', () => {
    const missing: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.text === 'string' && !(typeof o.source === 'string' && o.source.trim())) missing.push(path);
        for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
      }
    };
    walk(worldJson, '$');
    expect(missing).toEqual([]);
  });

  it('holds exactly the vignette strings the brief names', () => {
    expect(world.sign).toBe('TAYLOR');
    expect(world.tape.doNotTouch).toBe('DO NOT TOUCH');
    expect(world.jacks).toEqual({ storefront: 'STOREFRONT', lamp: 'LAMP', platen: 'PLATEN' });
    expect(Object.values(world.tools)).toEqual(['LARAVEL', 'VUE', 'PHP', 'PYTHON', 'RUST', 'SQL', 'FLUTTER', 'CLAUDE CODE']);
    expect(world.cards.revertRung1).toBe('WELL, THAT WAS UNNECESSARY.');
    expect(world.slips.fetchOutOfLane).toBe('OUT OF MY LANE.');
    expect(world.phone.attract).toEqual([{ from: 'owner', text: 'Make it blue.' }]);
    expect(world.stencil.size).toEqual({ S: 'S', M: 'M', L: 'L' });
    expect(world.stencil.up).toBe('↑');
    expect(world.plates.presses).toBe('PRESSES');
  });

  it('the voice lines are quoted from REWRITE.md as written there', () => {
    const spec = readFileSync('REWRITE.md', 'utf8');
    for (const s of [world.tape.doNotTouch, world.cards.revertRung1, world.slips.fetchOutOfLane, world.phone.attract[0]!.text, world.jacks.storefront, world.jacks.platen]) {
      expect(spec, s).toContain(s);
    }
    expect(spec).toContain('sign: TAYLOR REMUND');
    expect(spec).toContain('A plate beside it counts the presses');
  });

  it('every tool name is on the published résumé (legacy/resume/index.html)', () => {
    const resume = readFileSync('legacy/resume/index.html', 'utf8').toUpperCase();
    // SQL appears only inside MySQL / PostgreSQL / SQLite: see the entry's source.
    for (const t of Object.values(world.tools)) expect(resume, t).toContain(t);
  });
});

describe('fonts', () => {
  it('every world string is covered by the subset of the face that draws it', () => {
    const uses: [FaceRole, string][] = [
      ['sign', world.sign],
      ['tape', world.tape.doNotTouch],
      ['tape', world.jacks.storefront],
      ['tape', world.jacks.platen],
      ...Object.values(world.tools).map((t): [FaceRole, string] => ['tape', t]),
      ['tape', world.plates.presses],
      ['type', world.cards.revertRung1],
      ['type', world.slips.fetchOutOfLane],
      ['tape', world.phone.attract.map((m) => m.text).join(' ')],
      ['stencil', Object.values(world.stencil.size).join('')],
    ];
    for (const [role, text] of uses) {
      const missing = [...text].filter((c) => !SUBSET[role].includes(c));
      expect(missing, `${role}: ${text}`).toEqual([]);
    }
  });

  it('every face file exists, is WOFF2 and is small', () => {
    let total = 0;
    for (const f of Object.values(FACES)) {
      const path = `public/fonts/${f.file}`;
      const head = readFileSync(path).subarray(0, 4).toString('latin1');
      expect(head, path).toBe('wOF2');
      const size = statSync(path).size;
      expect(size, path).toBeLessThan(20_000);
      total += size;
    }
    expect(total).toBeLessThan(48_000);
  });

  it('ships the licence beside the fonts', () => {
    const readme = readFileSync('public/fonts/README.txt', 'utf8');
    for (const f of Object.values(FACES)) {
      expect(readme).toContain(f.file);
      expect(readFileSync(`public/fonts/${f.file.replace('.woff2', '.OFL.txt')}`, 'utf8')).toMatch(/SIL Open Font License/i);
    }
  });
});

describe('contentById', () => {
  const ids = ['card.rung1', 'slip.out-of-lane', 'name.crate', 'name.fetch', 'name.lamp', 'name.belt', 'name.button', 'name.cord', 'name.jack.storefront', 'name.jack.lamp', 'name.dock.bell', 'name.belt.dial', 'name.belt.lever', 'name.striker', 'name.dock', 'name.chute', 'mark.shipped', 'mark.return',
    // S4
    'card.rung2', 'card.rung3', 'card.rung4', 'card.deck.1', 'card.deck.2', 'card.deck.3', 'card.deck.4', 'card.deck.5', 'card.deck.6', 'card.revert.kept', 'card.revert.nothing', 'name.revert', 'name.undo-lever', 'name.button.cover',
    // the Patchlamp station (S3)
    'name.line', 'name.patch', 'name.platen', 'name.storefront', 'name.jack.platen', 'name.jack.belt', 'name.jack.reserved', 'slip.reserved', 'slip.platen-full',
    // P4 S5: the project crates (each called by its project's published title), their latches and plates, the stand-in
    'name.project.ledger', 'name.project.reports', 'name.project.support-desk', 'name.project.clean-green', 'name.project.t-components', 'name.project.artificer', 'name.lid', 'name.plate', 'name.standin',
    // P4 D1: the ledger board and its two controls
    'name.ledger.board', 'name.ledger.crank', 'name.ledger.plunger',
    // P4 D2b: the paint dial and its knob
    'name.paint.dial', 'name.paint.knob',

    // P4 D3: the report press, its lever and its envelope
    'name.press.body', 'name.press.lever', 'name.press.envelope',
    // P4 T2: the tool wall's eight tools, its pinned sheet, and the wall (a tool's place)
    ...['laravel', 'vue', 'php', 'python', 'rust', 'sql', 'flutter', 'claude-code'].map((k) => `name.tool.${k}`), 'name.toolwall.sheet', 'name.toolwall.wall'];

  it('resolves every id the simulation speaks in, to the right entry', () => {
    for (const id of ids) expect(contentById(id).text, id).toBeTruthy();
    expect(contentById('card.rung1').text).toBe('WELL, THAT WAS UNNECESSARY.');
    expect(contentById(cardFor(1)).text).toBe('WELL, THAT WAS UNNECESSARY.');
    expect(contentById('slip.out-of-lane').text).toBe('OUT OF MY LANE.');
    expect(contentById('name.button')).toMatchObject({ text: 'Big Red Button', kind: 'ui' });
    expect(contentById('name.jack.lamp').text).toBe('Lamp jack');
    expect(contentById('name.project.ledger')).toMatchObject({ text: 'Ledger Management System', kind: 'fact' });
    expect([...CONTENT_IDS].sort()).toEqual([...ids].sort());
  });

  it('throws on an unknown id', () => {
    expect(() => contentById('card.rung99')).toThrow(/unknown content id/);
  });

  it('every literal content id in src/workshop/sim resolves', () => {
    const found = new Set<string>();
    for (const f of walk('src/workshop/sim').filter((x) => x.endsWith('.ts'))) {
      const code = readFileSync(`src/workshop/sim/${f}`, 'utf8');
      for (const m of code.matchAll(/'((?:card|slip|name)\.[a-z0-9.-]+)'/g)) found.add(m[1]!);
    }
    expect(found.size).toBeGreaterThan(0);
    for (const id of found) expect(() => contentById(id), id).not.toThrow();
  });
});
