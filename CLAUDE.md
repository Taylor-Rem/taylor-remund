# taylorremund.com — Operating Manual (branch `rewrite`)

**This branch is the rewrite: the workshop.** An interactive miniature
factory on a workbench that happens to contain Taylor's résumé. `main` is
still the live plain-HTML site and stays untouched until the cutover; its
manual is `main`'s `CLAUDE.md`. `REWRITE.md` is the specification and the
plan this branch executes: read it before doing anything here. Where this
file and `REWRITE.md` disagree, `REWRITE.md` wins and this file gets fixed
in the same commit.

- **Where the build is:** `REWRITE.md` § Approval log says which gates have
  passed. Every gate is a stop. A gate marked Taylor is passed only by his
  dated line in that log.
- **The point** (`REWRITE.md` § The point): people who arrive start playing
  without being told to, find things that surprise them, and want to keep
  looking. Then they want to know who made it. A phase that passes its
  checks and is not a pleasure to use has not succeeded.

## Branch and deploy rules

- Branch `rewrite`, **local only. Never push it.** Small commits, plain
  messages. `git pull --ff-only` on `main` at the start of a session and
  bring `rewrite` up to it; the career workspace lands résumé changes on
  `main` without notice, and they arrive here as changes under `legacy/`.
- `main` deploys to production on push (GitHub Pages, legacy build from the
  branch root). Nothing on this branch changes production. The cutover is
  one merge after gate G6, by the list in `REWRITE.md` § Cutover.
- `CNAME` stays at the repo root, never edited or deleted. The build copies
  it into the output.

## Stack

Astro (static output, directory URLs) · TypeScript · Three.js used
directly (`WebGLRenderer`) · Rapier for loose parts only · Vitest ·
Playwright · `shot` for page audits. Runtime dependencies are exactly two:
`three` and `@dimforge/rapier3d` (the plain package: Vite serves its
`.wasm` as a separate file that loads in parallel, § E6). Versions are
pinned exactly and the lockfile is committed; Node is pinned in `.nvmrc`.
TypeScript is held at 6.x because `@astrojs/check` does not yet accept 7.
Read the current documentation for Astro, Three.js and Rapier before using
them; they are newer than anyone's memory (three r187 removed
`PCFSoftShadowMap`, Astro 7 changed `compressHTML`'s default, and so on).

```
npm run dev            # the site, plus dev-only pages under /dev/
npm run build          # static site into dist/
npm run verify         # THE gate: typecheck, unit tests, build, every check below
npm run test           # vitest (unit + headless simulation)
npm run test:browser   # playwright
npm run perf           # frame-time session on the reference laptop (gates G1, G2, G5)
```

`npm run verify` before every commit that claims a milestone. It runs
everything that needs no graphics card (`--only a,b`, `--skip a,b`,
`--keep-going`).

- Astro 7's `dev` and `preview` put themselves in the background when they
  detect an agent and leave a lock in `.astro/`. Pass `--ignore-lock` to
  keep one in the foreground on a port of your own
  (`npm run dev -- --port 4330 --ignore-lock`); stop strays with
  `npx astro dev stop` / `npx astro preview stop`.
- Dev-only pages (`src/dev-pages/*.astro`, served at `/dev/<name>/`) exist
  in `astro dev`, and in a build only with `WORKSHOP_DEV_PAGES=1`. A normal
  build never contains them.
- WebGL in headless Chrome is SwiftShader unless you ask for the GPU:
  system Chrome (`channel: 'chrome'`) with `--use-angle=vulkan
  --enable-features=Vulkan --ignore-gpu-blocklist` (`gpuArgs` in
  `playwright.config.ts`). Frame-time numbers mean nothing without it.
- `compressHTML` is off on purpose: the compliance pages carry their text
  of record byte for byte.
- Agent worktrees live in `.claude/worktrees/` (git-ignored). A new
  worktree starts from `main`; reset it onto `rewrite` before working.

## File map

```
src/content/        every fact and every sentence a visitor can read, as JSON, each fact with a source
src/pages/          index (the stage + the paperwork), legal pages, 404
src/layouts/        Paper (conventional pages), Stage (the home page)
src/dev-pages/      development-only pages (parts catalogue, look tests); never in a normal build
src/workshop/
  sim/              world, parts, history, machines/, crew/, physics/, clock, rng   (runs in Node)
  view/             palette, kit/, materials/, light, camera, labels, effects, stations/
  input/            pointer, touch, keyboard, picking, the controls list
  audio/            notes, samples, mixer
  ui/               strip, panels, settings
  shell/            boot, tiers, picture-to-stage handoff, fallback, saved state
tests/              unit/, scenario/ (headless simulation), browser/ (Playwright)
scripts/            verify and the checks it runs; capture and perf tools
integrations/       local Astro integrations: CNAME into the output, dev-only pages, legacy passthrough (temporary)
legal-reference/    the approved text of record for the four compliance pages (byte-exact)
reference/          the pictures approved at G1: the standard for the look (never regenerated)
legacy/             the old plain-HTML site, kept for migration; /resume/ and /ai/ are served from it until P3
public/             assets/ at their old URLs, fonts/, robots.txt
```

## The layers (the rule that keeps this maintainable)

**The simulation does not know it is being drawn.** `scripts/check-layers.ts`
enforces the table in `REWRITE.md` § E2:

| layer | owns | must not |
|---|---|---|
| `content` | every fact and visible sentence, each with a source | contain layout or behaviour |
| `sim` | parts, machines, crew, history, physics | import Three.js, touch the DOM, use wall-clock time or `Math.random` |
| `view` | turning simulation state into a picture | change simulation state |
| `input` | pointer, touch, keys → intents | know what any machine does |
| `audio` | sound for simulation events | decide when things happen |
| `ui` | the HTML around and over the stage | hold facts |
| `shell` | starting, tiers, fallback, saving | know about any particular station |

- Durable state changes only through effects (`REWRITE.md` § E5). Undo
  restores recorded values; no machine has inverse code.
- Machines do not call each other. They meet through parts, instructions
  and events.
- No visible sentence is written in `sim`, `view` or `ui`. Text lives in
  `src/content/` and the simulation speaks in ids.

## The look

`REWRITE.md` § A is the direction; the pictures approved at gate G1
(2026-11-18) are in `reference/g1/` and are the standard everything later
is compared against.

- Every mesh comes from a kit function (`src/workshop/view/kit/`); nothing
  is built from raw primitives at the point of use. Materials are made only
  in `view/materials/`. Colour literals exist only in `view/palette.ts`.
  `scripts/check-look.ts` enforces all three.
- No visible primitive. Three scales of detail on every hero object.
  Nothing is perfect, and the imperfection is seeded. One warm lamp, a cool
  fill, soft shadows under everything. Five materials that read as
  different: painted steel, brass, wood, rubber, paper.
- Text in the world is label tape (Taylor's voice), crate stencil (facts)
  or paper cards (the crew). Never floating UI.
- Judge renders, not code: capture stills under the real light and look at
  them before calling anything done.

## What must survive (`REWRITE.md` § 2)

`/`, `/resume/` (and `/resume`), `/ai/`, `/privacy/`, `/terms/`, `/sms/`,
`/career-send/`, `/assets/og.png`, `/assets/taylor.jpg`,
`/assets/exchange-room-*`, and their anchors. `scripts/check-urls.ts`
holds the list.

- **The compliance pages change by nothing but an approved edit.** Each
  page's `.legal` wrapper in the built output equals `legal-reference/`
  byte for byte, and every `legal-callout` block equals the copy frozen
  from `main` at `fa99b13` (`scripts/check-legal.ts`, two independent
  checks). A wording change is made by editing `legal-reference/` in a
  commit of its own that names Taylor's approval and its date. A callout
  never changes at all.
- `/sms/` is the public opt-in page Twilio's 10DLC reviewer checks: the
  service number, the consent/STOP/HELP/rates language, links to privacy
  and terms. Every page's footer links all three.
- `/career-send/` stays unlinked, out of the sitemap, `noindex`.
- `/resume/` never depends on WebGL.

## Content rules (carried over unchanged; they bind every page and every toy)

- **Every claim is true and has a source.** No invented testimonial, client
  name or metric. **A toy is a claim:** a machine that imitates a real
  system says something about that system, so each has a row in the toy
  truth table (`REWRITE.md` § F3) before it ships. Facts come from
  `~/career/facts/` and the published `/resume/`; a fact that is not there
  gets a source or does not appear.
- **Nothing personal is invented.** An object, hobby or detail about Taylor
  enters the world only when he names it.
- **Plateful is retired (2026-09-24).** Past tense, no links, nothing that
  sells it. "Plateful LLC" is the legal entity (dba Patchlamp) and appears
  only as that.
- **Prices on `/ai/` are real commitments:** session $150 ($250 for 2h),
  computer install $500–$1,500 (+$79/mo care plan). Never changed without
  Taylor saying so. Website plans are **Patchlamp's**: their prices live in
  `~/projects/patchlamp/app/Support/Prices.php` and they move. New text on
  this site types no Patchlamp price; it links to patchlamp.com/pricing.
  The "4% of store sales, capped at $500/mo" line was retracted 2026-09-15
  and must not come back.
- **Every Patchlamp sentence is true of `~/projects/patchlamp/CLAIMS.md`**
  and stays inside Patchlamp's disclosure line. The client owns the site
  and code; the texting service is Taylor's and ends when the engagement
  ends: never let copy blur that. Patch is "it"; asked what it is, Patch
  says: Claude wearing a name tag that says Patch.
- **His employer's code is described, never quoted or linked** beyond the
  two repositories he keeps public.
- A change in how his experience is represented waits for his yes. A
  correction of a wrong fact does not.
- The legal pages carry language carriers check during 10DLC review. Don't
  claim anything about Anthropic's training or retention practices unless
  Taylor has verified it for his account.
- **AI-assisted building is told confidently and never overstated.** How
  this site itself was built is said on the site in words Taylor approves.
- **Nothing a visitor types or does leaves their browser.** No analytics,
  no cookie, no tracker, no third-party request.
- Contact email is `remundtaylor3@gmail.com` until a domain email exists;
  update everywhere at once when it changes.

## Out of scope whatever seems convenient (`REWRITE.md` § J)

Any arrival. Any server. Any analytics. Editing a `legal-callout`. Editing
the rest of a legal wrapper without the approved-edit commit. Editing
`CNAME`. Pushing the branch. Changing a price. Writing a personal detail
about Taylor that he has not supplied.

## The products behind the pages

`~/projects/VISION.md` is the product picture; the Patchlamp site itself is
`~/projects/patchlamp` (`BRAND.md` for the brand and who Patch is,
`CLAIMS.md` for what may be said). The code that makes each Patchlamp claim
true is in `sms-relay/`.
