# REWRITE — taylorremund.com, the portfolio

**Status: preparing (2026-11-17). Nothing is built.** Branch `rewrite`, local
only. `main` is the live site and stays untouched until the cutover.

Taylor, 2026-11-17: "A complete rewrite. It will become a much bigger
project. A much more impressive portfolio."

This file is the plan a session executes, as `REDESIGN.md` was for the last
one. `CLAUDE.md` still describes the live site; on this branch it is
rewritten (one manual, not a second layer) as soon as the decisions below
are confirmed. Until then, where the two disagree about the *future* site,
this file wins; about the *live* site, `CLAUDE.md` does.

## What exists (measured 2026-11-17, at `fa99b13`)

- 7 pages, 1,985 lines of hand-written HTML/CSS/JS, 760 KB with images. The
  nav and footer are duplicated by hand in every page.
- `/` (151 lines) sells Patchlamp and the services. `/ai/` (213) is the
  services page with published prices. `/resume/` (380) is the only
  engineer-facing page: 4 skill groups, 11 project cards of one paragraph
  each, 3 roles. `/privacy/`, `/terms/`, `/sms/`, `/career-send/` are
  compliance pages.
- No page goes deeper than a card on any project. That is the gap a bigger
  portfolio fills: work a reader can open and inspect.
- Hosting: GitHub Pages, legacy build from `main` root, HTTPS enforced, the
  certificate covers the apex and `www`. DNS is at Porkbun. Pages cannot
  redirect: every URL below has to exist as a real file in what is served.
- Baseline, `shot design .`: 165 KB, LCP 108 ms, CLS 0, and 12 failures the
  rewrite should not carry over: fonts fetched from Google's CDN (the only
  third-party request), accent text at 1.46:1 contrast, no `:focus-visible`
  rule, scroll reveals that start invisible and ignore reduced motion.
  `shot check . --all`: no console errors, no failed requests, small tap
  targets on the legal pages on a phone.
- Baseline screenshots, every page at desktop and phone:
  `shots/taylorremund.com-site-20261117-175156/` (ignored by git).

## What must survive

| path | who depends on it | what has to stay true |
|---|---|---|
| `/` | patchlamp.com's footer ("a Taylor Remund product"), its home and how pages; the GitHub repo's homepage; the Career Send Google app's homepage | A small-business owner arriving from patchlamp.com still learns in one screen who is behind it. |
| `/resume/` | the GitHub profile and its README (as `/resume`, no slash), LinkedIn, anything he has sent a person | The most-linked page. Stays at this path, as a directory, so both spellings resolve. |
| `/ai/` | the homepage; anyone holding a quoted price | The prices are commitments (`CLAUDE.md` § Content rules). Not changed or removed without his word. |
| `/privacy/` `/terms/` `/sms/` | Twilio's 10DLC campaign lists these URLs | The `legal-callout` blocks verbatim. `/sms/` shows the service number, the consent/STOP/HELP/rates language, and links the other two. Every page's footer links all three. |
| `/career-send/` | the Career Send Google app lists it as its privacy policy; no page links to it, on purpose | The Limited Use wording. Easy to lose: a crawl of the site does not find it. |
| `CNAME` | the domain | Never edited or deleted; with a build step it is emitted at the root of the output. |

Rules that hold whatever is decided: every claim is true and has a source;
no invented testimonial, client name or metric; AI-assisted building is told
confidently and never overstated; every Patchlamp sentence is true of
`~/projects/patchlamp/CLAIMS.md` and stays inside Patchlamp's disclosure
line; his employer's code is described, never quoted or linked beyond the
two repositories he keeps public; a change in how his experience is
represented waits for his yes, a correction of a wrong fact does not.

## Raw material

- **Sourced facts** (use them, don't re-derive; a fact that is not there
  gets a source before it is published): `~/career/facts/profile.md`
  (identity, work history, stack, the positioning in his words, what must
  not be claimed), `~/career/facts/projects/*.md` (13 projects),
  `~/career/facts/work-kingsley.md`.
- **The current `/resume/`**: Patchlamp, Plateful (retired, past tense),
  Artificer, Sharewire, Ledger Management System, Support Desk Rewrite,
  Clean & Green Inspections, t-components, Report Generation Framework,
  Support Automation Suite, DalleBoard.
- **Public repositories** a page can link: `patchlamp` (the overview),
  `artificer`, `db`, `sharewire`, `share-or-steal`, `destiny-vault`,
  `support_tool`, `utilities-master`, `specs-capstone`, `fullstack-piano`.
- **Images: thin.** One headshot (`assets/taylor.jpg`), the share card, the
  Patchlamp brand image. No project screenshot, diagram or demo exists
  here. A more impressive portfolio needs them made: screenshots with
  `shot`, diagrams drawn, demos chosen. This is the largest piece of work
  that is not code.

## The other writers

- The career workspace (`~/career`) lands fact corrections and résumé
  changes on `main`, fast-forward only, without notice. Until the cutover
  they keep landing on the old files. Before the cutover:
  `git log fa99b13..origin/main` and carry every content change across.
- `~/projects/rem-portfolio` is a second checkout that other sessions read
  for reference. Nothing to do there until the cutover.
- `git pull --ff-only` on `main` before every session; rebase or merge
  `rewrite` onto it as it moves.

## Decisions (recommended answers; Taylor confirms)

1. **Who the site is about — recommended: Taylor, as an engineer.** Today's
   manual says he is "who's behind the product, not the subject"; a
   portfolio reverses that. The reader becomes someone evaluating him.
   Patchlamp becomes the flagship case study; selling to small businesses
   is patchlamp.com's job. The homepage keeps one clear line for the
   visitor who arrived from patchlamp.com.
2. **Stack — recommended: Astro, static output.** The current rule is plain
   files with no build step "unless Taylor explicitly says otherwise".
   Many case-study pages sharing one layout strain that: seven pages
   already duplicate the nav and footer by hand. Astro keeps what the rule
   protected (plain HTML out, close to no JavaScript, served by the same
   GitHub Pages) and adds what a bigger site needs: case studies as
   Markdown with checked front matter (a `sources` field can be required),
   shared layouts, image handling, and Vue components where interaction
   earns its weight. The compliance pages are copied through byte for
   byte. Cost: Pages switches from "serve the branch" to a GitHub Actions
   build, and the repo stops being the plain-files exhibit of how client
   sites are kept.
3. **What the bigger site contains — recommended for launch: case studies
   and how he works with agents.** One page per major project (the problem,
   the architecture, the decisions, what was measured), and a section on
   the way he builds: agents under permission boundaries, review,
   verification. Writing and live demos are worth having and are each an
   ongoing commitment; they come after launch unless he wants them in it.
4. **Measuring visits — recommended: yes, cookieless, said on `/privacy/`.**
   The rule is no analytics unless he asks, so today nobody can say whether
   anyone opens the résumé page, and nobody will be able to say whether the
   rewrite changed anything. A counter with no cookies and no cross-site
   tracking, named in the privacy policy. Adding it edits a page Twilio's
   reviewer reads, so the wording is his to see first.
5. **`/ai/` — default, no decision needed now:** it stays live with its
   prices exactly as they are, restyled, out of the main navigation.
   Moving it to patchlamp.com or retiring it is a business decision for
   later.
6. **The branch stays local** until he says to push it. The repository is
   public; a pushed branch is published work in progress.

## Cutover (one merge, when the new site is better than the live one)

- Every path in § What must survive answers 200 in the served output,
  including `/resume` without the slash and the unlinked `/career-send/`.
- The legal callouts are identical to `main`'s, checked by diff.
- `main`'s changes since `fa99b13` are carried across.
- `shot check . --all` and `shot design .` are clean, or each remaining
  item has a stated reason.
- `CLAUDE.md` and `README.md` describe the new site; `REDESIGN.md` and this
  file leave or are marked as the record.
- If there is a build: the Pages source switches to GitHub Actions in the
  same step as the merge, and the rollback (`git revert` and switch back)
  is written down before it is needed.
- For Taylor to pass on, since they are other workspaces' files: the repo
  description ("plain HTML/CSS on GitHub Pages"), `~/projects/CLAUDE.md`'s
  map row and `~/projects/patchlamp/BRAND.md`'s "studio site, Patchlamp
  first" line stop being true at the cutover.
