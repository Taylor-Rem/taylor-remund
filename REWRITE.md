# REWRITE — taylorremund.com, the workshop

**Status: draft 3, approved at G0 on 2026-11-17 (§ Approval log). Building
has begun at P0 and stops at G1**, which is a hard stop: nothing of the
wider environment is produced until Taylor has passed the look. Branch
`rewrite`, local only. `main` is the live site and stays untouched until
the cutover.

Taylor, 2026-11-17: "I don't want a better résumé website. I want an
unforgettable interactive experience that happens to contain my résumé."

This file is the plan a session executes, as `REDESIGN.md` was for the last
one. § 0 records how it got here and what each draft changed. `CLAUDE.md`
still describes the live site and is rewritten on this branch in phase P0,
after approval. Until then: about the *future* site this file wins; about
the *live* site `CLAUDE.md` does.

**How to read it.** Taylor: § The point, § What is fixed, § G (the release
and the gates), § E5 (undo), § Decisions. A building session: all of it,
then start at § J.

| Part | Sections |
|---|---|
| 1. Ground | § 0 Record · § 1 What exists · § 2 What must survive · § 3 Rules that hold · § 4 Raw material and the other writers |
| 2. Specification | The point · What is fixed · A Creative direction · B Experience design · C World layout · D Interaction inventory · E Technical architecture · F Content migration · G Releases, phases and gates · H Risks and tradeoffs · I Definition of done · J Builder handoff |
| 3. Closing | Decisions · Cutover · Approval log |

**Words used in this file.**

- **Bench**: the tabletop the whole workshop stands on. **Stage**: the
  full-window 3D view of it on `/`.
- **Station**: a named area of the bench with one machine and one camera
  framing.
- **Part**: any loose object a visitor can pick up (a crate, a tool, a
  robot).
- **Mouth**: where a machine takes parts in (a tray, a belt, a door).
  **Verb**: the one thing a machine does to whatever is in its mouth.
- **Handle**: anything fixed that is worked in place (a button, lever, dial,
  plug). **Setting**: the value a handle leaves behind (the belt's speed,
  which jack the cord is in).
- **Jack**: a socket on the switchboard; one per station that can be
  instructed.
- **Hatch**: a brass plate on a machine that opens the real project's facts.
- **Tell**: a small idle motion that hints an untouched thing can be used.
- **Rung**: one step of the Big Red Button's escalation.
- **Attract mode**: the time before a visitor's first action, when the crew
  demonstrates. **Play mode**: everything after.
- **Effect**: one recorded change to the world. **Transaction**: one
  visitor action and every effect it caused (§ E5).
- **Paperwork**: the plain HTML document on `/`. **Strip**: the always
  visible HTML bar with the name and the four links.
- **Release 1**: what is live at the cutover. **Arrival**: a machine or
  feature added after it.

---

# Part 1 — Ground

## 0. Record: how this plan got here

**Draft 1** (`caf9c95`, 2026-11-17) planned a bigger conventional site:
Astro, one case study per project, a section on working with agents.
**Draft 2** (`fc80b61`, the same day) reconciled it with Taylor's workshop
brief. **Draft 3** (this one) answers his review of draft 2.

What became of draft 1:

| Draft 1 | Now |
|---|---|
| § What exists, § What must survive, § Raw material, § The other writers, § Cutover | Kept, corrected where later reading found more (§ 1 to § 4, § Cutover). |
| Decision 1, the site is about Taylor as an engineer | Confirmed by the brief: "The homepage should primarily sell the person and his capabilities, not lead with a price list." |
| Decision 2, Astro with static output | Kept. Taylor: "I'm approving the change to a proper build system as part of the proposed architecture, but not authorizing implementation yet." |
| Decision 3, launch with case studies and a section on how he works with agents | Superseded. The workshop is the centrepiece. A Patchlamp case study is still wanted (the gap "no page goes deeper than a card" is real) and is an early arrival, not part of release 1; until then the Patchlamp hatch carries its core. |
| Decision 4, cookieless measurement, recommended yes | Answered no for release 1. Taylor: "Unprompted playtesting is sufficient ... We can revisit telemetry later." |
| Decision 5, `/ai/` stays with its prices, restyled, out of the main navigation | Unchanged. |
| Decision 6, the branch stays local | Unchanged. |

Rulings by Taylor on 2026-11-17 that this spec is built on:

- One central interaction mechanic, not a set of minigames, and
  experimentation has to be rewarding: "If most combinations simply return
  REJECTED, the novelty will wear off quickly." (§ B1, § B2)
- Robots as his agents, and work orders, inspection and undo as the
  workshop's personality. (§ B5)
- The Big Red Button "should be prominent and irresistible, but its
  sequence shouldn't overwhelm the visitor or reveal everything
  immediately." (§ B4)
- Code-built geometry is the first approach, and "visual quality is
  nonnegotiable." (gate G1)
- No analytics in the initial release.
- The synthetic ledger toy is "approved conceptually, provided it exposes no
  confidential employer information."
- "Patch the raccoon can absolutely make an appearance."
- The desk's objects are chosen separately. "Don't invent personal details."

What draft 3 changed, at his review of draft 2:

1. **Release 1 is small by design**, not by fallback: "I'd rather launch a
   smaller, exceptionally polished workshop ... Our standard is the quality
   of the experience, not the number of implemented interactions." The
   inspector, the jukebox and everything else in the larger picture are
   arrivals in the reserved bays (§ G).
2. **The undo model is designed here**, before any code: § E5.
3. **Contradictions removed.** The list is at the end of this section.
4. **Fixed and flexible are separated** (§ What is fixed): "The artistic
   goal is fixed. The precise means of achieving it can evolve through the
   approval gates."
5. **The look comes first.** G1 is harder to pass, has an early check
   before it, a limit of two attempts, and the standard it sets is checked
   again at every later gate (§ A, § G).
6. **Every engineering decision is tied to what the visitor feels** (§ E0).

**Amendment to draft 3** (2026-11-17, at Taylor's request before G0;
§ E5 and its test row in § E8 only): consecutive transactions writing the
same field restore the previous writer as well as the previous value;
"undo that" is all or nothing; an older pending change never commits over
a newer one; a moving part has one owner when throws overlap; being held
is no longer a recorded location; named deterministic tests for each.

Contradictions found in draft 2 and how each was settled:

| draft 2 said | settled as |
|---|---|
| A tune of "five sizes"; parts have three sizes | Three sizes give three notes; material sets octave and timbre. The house tune is five notes long, not five sizes (§ B1, § B2). |
| A test that "a crate fed to the belt ships"; a dock that ships only stamped parts | In release 1 the dock ships anything and the test says so. The stamp requirement and its test arrive together with the inspector (§ E8, § G). |
| Legal pages preserved byte for byte; a privacy edit recommended | "Byte for byte" is against an approved text of record, which only Taylor's approved edits change; the callout blocks never change (§ 2, § E8). |
| One lamp per station used for six different meanings | Board lamps mean a line is connected. Station lamps have three states. Tool links use the tool's colour (§ B1). |
| Pallets by employer role; four personal projects with no role | A fourth pallet for his own projects (§ C). |
| "No post-processing"; visual quality first | Allowed when it earns its frame time (§ E3). |
| The crew texts Patch and moves the cord; undo must not tangle with background events | The crew demonstrates only in attract mode. In play mode it never touches a setting (§ B3, § E5). |
| `#services` and `#about` must keep working; no station by those names in the smaller release | An address with no station opens the paperwork at that section (§ B6). |
| "Whatever a handle did can be taken back"; the Button cannot | Undo covers changes to parts and settings. The Button rewinds itself (§ B1, § E5). |
| No Patchlamp price on this site; `/ai/` carried whole, with one | New text types no Patchlamp price. `/ai/`'s published panel is kept if still true on the day, corrected from `Prices.php` if not (§ 3). |
| First paint within 150 KB, with a picture, two fonts and CSS | 200 KB (§ E7). |

## 1. What exists (measured 2026-11-17, at `fa99b13`)

- 7 pages, 1,985 lines of hand-written HTML/CSS/JS, 760 KB with images. The
  nav and footer are duplicated by hand in every page.
- `/` (151 lines) sells Patchlamp and the services. `/ai/` (213) is the
  services page with published prices. `/resume/` (380) is the only
  engineer-facing page: 4 skill groups, 11 project cards of one paragraph
  each, 3 roles. `/privacy/`, `/terms/`, `/sms/`, `/career-send/` are
  compliance pages.
- No page goes deeper than a card on any project.
- Hosting: GitHub Pages, legacy build from `main` root, HTTPS enforced, the
  certificate covers the apex and `www` (checked through the API:
  `build_type` legacy, no custom 404). DNS is at Porkbun. Pages cannot
  redirect: every URL in § 2 has to exist as a real file in what is served.
- `origin/main` has not moved since `fa99b13` (fetched 2026-11-17).
- Baseline, `shot design .`: 165 KB, LCP 108 ms, CLS 0, and 12 failures the
  rewrite should not carry over: fonts fetched from Google's CDN, accent
  text at 1.46:1 contrast, no `:focus-visible` rule, scroll reveals that
  start invisible and ignore reduced motion. `shot check . --all`: no
  console errors, no failed requests, small tap targets on the legal pages
  on a phone.
- Baseline screenshots, every page at desktop and phone:
  `shots/taylorremund.com-site-20261117-175156/` (ignored by git).
- `/resume/` also makes third-party requests: its skill icons load from
  `cdn.simpleicons.org` (`resume/index.html:75-118`).
- `/resume/`'s first section is never closed before the skills section
  opens (`resume/index.html:64-67`). The migration fixes it.
- `/privacy/` says of this website: "does not use analytics, advertising,
  cookies, or tracking of any kind. There is no login and no form." It also
  says the typefaces load from Google Fonts, and that a changed policy gets
  a new effective date. All three bind the rewrite (§ Decisions).
- `/privacy/`, `/terms/` and `/career-send/` carry
  `<meta name="robots" content="noindex, follow">`; `/sms/` does not.
- patchlamp.com links to this site three times, always to the bare
  `https://taylorremund.com` (grep of `~/projects/patchlamp`).
- This machine is a fair performance reference: integrated AMD Radeon
  (Cezanne), Chrome, Playwright's Chromium, and `shot`.
- Three sentences on the live site that could not be squared with the
  sourced facts; they are for Taylor to rule on (§ Decisions), and the
  rewrite carries the corrected wording:
  - `resume/index.html:161` calls Artificer's `define_agents!` a "procedural
    macro"; `~/career/facts/projects/artificer.md` records `macro_rules!`.
  - `resume/index.html:62` says "Full-time role eliminated by automation I
    built"; `~/career/facts/work-kingsley.md` says "eliminated a full-time
    manual workload".
  - `index.html:72` names "Starter $99/mo"; `Prices.php` has published that
    tier as "Patch Pro" since 2026-11-09, and "Standard ... with a built
    site" needs re-reading against the terms of that date.

## 2. What must survive

| path | who depends on it | what has to stay true |
|---|---|---|
| `/` | patchlamp.com's footer ("a Taylor Remund product"), its home and how pages; the GitHub repo's homepage; the Career Send Google app's homepage | A small-business owner arriving from patchlamp.com still learns in one screen who is behind it, before any JavaScript runs. The anchors `#patchlamp`, `#services`, `#about` and `#contact` keep working. |
| `/resume/` | the GitHub profile and its README (as `/resume`, no slash), LinkedIn, anything he has sent a person | The most-linked page. Stays at this path, as a directory, so both spellings resolve. Never depends on WebGL. The anchors `#about`, `#skills`, `#projects`, `#patchlamp`, `#experience`, `#contact` keep working. |
| `/ai/` | the homepage; anyone holding a quoted price; `/terms/` ("the services described at taylorremund.com/ai") | The prices are commitments (`CLAUDE.md` § Content rules). Not changed or removed without his word. The `mailto:` subjects and the anchors `#how`, `#packages`, `#patchlamp`, `#why`, `#faq`, `#contact` keep working. |
| `/privacy/` `/terms/` `/sms/` | Twilio's 10DLC campaign lists these URLs | **Nothing changes by accident.** Each page's `.legal` wrapper equals its approved text of record (`legal-reference/`) byte for byte. That record starts as an exact copy of `main`'s and changes only by an edit Taylor approves, in a commit of its own. The `legal-callout` blocks never change at all. `/sms/` shows the service number, the consent/STOP/HELP/rates language, and links the other two. Every page's footer links all three, the stage on `/` included. Each page keeps the robots meta it has today. |
| `/career-send/` | the Career Send Google app lists it as its privacy policy; no page links to it, on purpose | The same record-and-check as the legal pages; the Limited Use wording. It stays unlinked, out of the sitemap, with its `noindex`. |
| `/assets/og.png`, `/assets/taylor.jpg`, `/assets/exchange-room-*` | link previews already cached elsewhere; Patchlamp's brand | The paths keep answering. The share card's picture changes at the cutover, with his word. |
| `CNAME` | the domain | Never edited or deleted; with a build step it is emitted at the root of the output. |

## 3. Rules that hold whatever is built

- Every claim is true and has a source. No invented testimonial, client
  name or metric. **A toy is a claim:** a machine that imitates a real
  system says something about that system, so each one has a row in the toy
  truth table (§ F3) before it ships.
- AI-assisted building is told confidently and never overstated. How this
  site itself was built is said on the site, in words Taylor approves and
  that are true on the day.
- Every Patchlamp sentence is true of `~/projects/patchlamp/CLAIMS.md` and
  stays inside Patchlamp's disclosure line (`~/career/facts/projects/patchlamp.md`).
  Patch is "it". Asked what it is, Patch says: Claude wearing a name tag
  that says Patch (`BRAND.md` § The name).
- His employer's code is described, never quoted or linked beyond the two
  repositories he keeps public. The ledger toy, when it arrives, uses
  invented tokens and shows nothing the résumé page does not already say.
- A change in how his experience is represented waits for his yes. A
  correction of a wrong fact does not.
- Plateful is retired: past tense, no links, nothing that sells it.
  "Plateful LLC" appears only as the legal entity.
- New text on this site types no Patchlamp price; it links to
  patchlamp.com/pricing. `/ai/`'s existing Patchlamp panel is kept as
  published if it is still true on the day of the cutover, and corrected
  from `Prices.php` if it is not. The `/ai/` service prices are not
  touched.
- Nothing personal is invented. An object, hobby or detail about Taylor
  enters the world only when he names it.
- Nothing a visitor types or does leaves their browser in release 1.

## 4. Raw material and the other writers

- **Sourced facts** (use them, don't re-derive; a fact that is not there
  gets a source before it is published): `~/career/facts/profile.md`,
  `~/career/facts/projects/*.md` (13 projects),
  `~/career/facts/work-kingsley.md`.
- **The current `/resume/`**: Patchlamp, Plateful (retired, past tense),
  Artificer, Sharewire, Ledger Management System, Support Desk Rewrite,
  Clean & Green Inspections, t-components, Report Generation Framework,
  Support Automation Suite, DalleBoard.
- **Public repositories** a page can link: `patchlamp` (the overview),
  `artificer`, `db`, `sharewire`, `share-or-steal`, `destiny-vault`,
  `support_tool`, `utilities-master`, `specs-capstone`, `fullstack-piano`.
- **Patchlamp's brand**: `~/projects/patchlamp/BRAND.md` (the position
  sentence, the rules, who Patch is), `assets/exchange-room-*` (Patch at
  the switchboard under one lamp: the palette and the mood of § A come from
  this picture).
- **Images: thin.** One headshot (`assets/taylor.jpg`), the share card, the
  Patchlamp brand image.
- **3D assets: none.** No models, no Blender on this machine. Gate G1
  exists because of this.

The other writers:

- The career workspace (`~/career`) lands fact corrections and résumé
  changes on `main`, fast-forward only, without notice. Until the cutover
  they keep landing on the old files. Before the cutover:
  `git log fa99b13..origin/main` and carry every content change across.
- `~/projects/rem-portfolio` is a second checkout that other sessions read
  for reference. Nothing to do there until the cutover.
- `git pull --ff-only` on `main` before every session; rebase or merge
  `rewrite` onto it as it moves.

---

# Part 2 — The specification

## The point

**People who arrive start playing without being told to, find things that
surprise them, and want to keep looking.** Then they want to know who made
it.

Everything below serves that sentence. When two good things compete, this
is the order:

1. What the visitor feels in the first minute.
2. How it looks.
3. That every claim is true and nothing that must survive is lost. (These
   are not traded away; they are the conditions the first two work inside.)
4. How much there is. This always loses. A thing that is not at the
   standard does not ship; the release gets smaller instead.

## What is fixed, and what may change

"The artistic goal is fixed. The precise means of achieving it can evolve
through the approval gates."

| fixed: changes only by Taylor's edit to this file | a starting point: may be bettered on the way |
|---|---|
| The point, and how it is tested (§ I) | The crew's names; every line anyone prints |
| The three laws (§ B1) | Which gags; what each rung does; which words Patch understands |
| Every toy is true (§ 3, § F3) | Exact layout, sizes and colours, until G1 fixes the look |
| What must survive (§ 2) | How a character moves and reacts |
| The gates, and what passes them | The kit's pieces; the shape of the code |
| The list of what is in release 1 (§ G) | The house tune; the cards; the tells |
| The rules of the history model (§ E5) | How those rules are implemented |
| The budgets, as floors (§ E7) | Which techniques meet them |

How a better idea gets in:

- **A swap** needs no approval: inside one station, an idea of about the
  same size that serves the same purpose and passes the same tests may
  replace what is written here. It is listed at the next gate.
- **Growth** waits for a gate: anything that adds a station, a character, a
  dependency or a claim is proposed at the next gate and built only if
  Taylor says so.
- Every gate's packet includes a short list: *found on the way* (kept,
  changed, proposed).
- The character sheets and interaction descriptions below are sketches of
  intent. They say what a thing is for and how it should feel. They are not
  scripts.

## A. Creative direction

**In one sentence.** A working miniature factory on a workbench, lit by one
lamp and staffed by a small crew of robots and a raccoon, where anything
loose can be picked up and every machine does something to whatever it is
fed.

**The fiction.** The workshop ships software. Things get built in the
middle of the bench and leave by the dock on the right. That is how Taylor
works: he decides what gets built, agents build inside marked lanes, and
anything can be undone. The visitor is the foreman for as long as they
stay. (The inspector, who makes "nothing ships unchecked" part of the
world, is the first arrival after release 1.)

**What makes it his, and not a tribute or a template.**

1. **The toys are true.** Each machine is a miniature of something he
   built and behaves the way the real thing behaves, quirks included (§ F3).
2. **The crew is his method.** Robots that do the work, lanes they cannot
   leave, a lever that takes back the last change. No other 3D portfolio
   can show this, because it is a fact about him.
3. **The lamp and the switchboard are already his.** Patchlamp is named for
   the lamp that lights on a switchboard when a line is connected and an
   operator is on it.
4. **A workbench, not a room.** The cut-away isometric bedroom is the most
   copied shape in 3D portfolios. This is a bench seen from the front and a
   little above, like a model railway layout, with the dark of the room
   beyond its edge.
5. **It talks in label tape.** No floating cards in the 3D world.

**The standard, and what keeps code-built geometry from looking primitive.**
Visual quality is the highest priority of the build. The risk is specific:
boxes and cylinders under flat light look like a tutorial. These are the
means expected to prevent it; G1 judges the result, not the means.

- **No visible primitive.** Every object is a compound of forms, with
  bevelled edges, turned profiles, and shapes swept along curves.
- **Three scales of detail on every hero object:** its large form; its
  mid-size parts (panels, hinges, feet, handles); its small ones (bolts,
  seams, vents, wear).
- **Nothing is perfect.** Crates sit a degree or two askew, tape is a
  little crooked, paint is worn at the edges, the bench is scuffed. The
  variation is seeded so it is the same on every visit.
- **Light does the work.** Soft shadows under everything, darkness gathered
  in creases, warm lamp against cool window, a rim of light on the
  characters, brass and paint that catch the lamp. Lighting is a task of
  its own, not a default.
- **Five materials that read as different** under the same lamp: painted
  steel, brass, wood, rubber, paper.
- **Characters with appeal:** a silhouette that reads at thumbnail size,
  eyes that look at things, weight in every move.

**Palette.** Taken from the exchange-room picture. Starting values; G1
fixes them, and after G1 a material uses no other colour.

| token | value | used for |
|---|---|---|
| `teal-deep` | `#12292c` | the room beyond the bench, deepest shadow |
| `teal-panel` | `#1f4a4f` | machine bodies, the switchboard |
| `teal-light` | `#3a7c7a` | machine highlights, trim |
| `amber` | `#f2a93b` | the lamp, lit indicators |
| `amber-glow` | `#ffd27a` | bulbs, the only things that glow |
| `brass` | `#b08d4a` | plates, hatches, fittings, jacks |
| `wood` | `#6b4a2f` | the bench top, crates (darker) |
| `wood-light` | `#a67c52` | crates, pallets, pegboard |
| `paper` | `#efe6d2` | cards, labels' text, the paperwork pages |
| `ink` | `#1a1c1e` | text, rubber, the belt |
| `cable-red` | `#8f2f2a` | the patch cord |
| `button-red` | `#d6322b` | the Button and nothing else |
| `tape-yellow` | `#e3b21c` | lane tape on the bench |
| `steel` | `#7d8790` | rollers, rails, tools |

**Light.** One key light, the lamp, warm, from the upper back left. A dim
cool fill from the window. The bench is bright; the room falls away into
`teal-deep`, never pure black. Only bulbs and indicator lamps glow.

**Text in the world, three registers.**

- *Label tape* (embossed white capitals on black, red or blue tape):
  Taylor's voice. `DO NOT TOUCH`. `RESERVED: INSPECTION`.
- *Crate stencil*: facts. Project names, employers, dates.
- *Paper cards and slips* in a monospaced face: the crew's voice.

**Type on the HTML pages.** Recommended: IBM Plex Sans for reading, IBM
Plex Mono for labels and data, one stencil display face for the name only;
all open licences. This drops Inter and Space Grotesk, the most common
pairing on generated sites. Confirmed at G1 with the rest of the look.

**Motion.** Mechanical and weighted. Things anticipate, overshoot a little
and settle. Nothing fades or floats in the way an interface does.

**Sound.** Thunks, clicks, a bell, the belt's hum. Every part has its own
note (§ B1), so the workshop is quietly musical.

**Voice.** Dry and short. No exclamation marks, no "welcome to my
portfolio". The crew says at most six words at a time.

**What it must never look like.** Gradient backgrounds, glowing spheres,
glass panels, neon, floating holograms, template project cards, a robot
mascot that waves and says hello.

## B. Experience design

### B1. The universal interaction model

Three laws. A visitor never reads them; the world behaves by them
everywhere, which is what lets someone guess right the first time.

1. **If it is loose, you can pick it up.** Drag it, or tap it and then tap
   where it should go. Let go and it falls with weight.
2. **If it has a mouth, it takes anything loose.** Every machine has one
   verb and applies it to whatever arrives. A machine never answers with a
   bare refusal: it either does its verb, or says specifically what it
   wanted instead.
3. **If it has a handle, it does what it looks like it does, at once.**
   Any change made to a part or a setting can be taken back at the UNDO
   lever.

**Why experiments keep paying off.** Machines do not know about kinds of
part. They read and write a small set of properties that every part has.
So any part in any machine produces a real result with no pair-by-pair
scripting, and the order in which machines are visited matters. The
written surprises of § B2 sit on top of that floor.

| property | values | seen or heard as |
|---|---|---|
| kind | crate, tool, robot (more kinds arrive later) | its shape |
| colour | the 8 paint colours | its paint |
| label | up to 16 characters | label tape on its side |
| size | S, M, L | its bulk, its weight, and its note: three sizes, three notes, large is low |
| material | wood, metal, paper, rubber | its timbre and its octave when struck (metal rings an octave above wood); its bounce |
| marks | shipping marks; stamps when the inspector arrives | ink on it |
| contents | none, or one of the shipped systems | a latch on the lid |

Machines and their verbs in release 1:

| station | mouth | verb on any part | reads | writes |
|---|---|---|---|---|
| Patchlamp platen | the tray under the nozzle | changes it by text | the instruction | colour, label |
| The belt | its whole surface | carries it, at the speed and direction set | size | where it is |
| The striker | under the arm at the end of the belt | strikes it; it sounds | size, material | nothing |
| The dock | the roll-up door | ships it: out, with a bell | nothing | marks; where it is |
| The bench edge | anything that falls off | sends it back up the return chute | nothing | where it is |

**The feedback grammar**, the same everywhere:

| event | what happens |
|---|---|
| pointer over something usable | it lifts a hair and the cursor becomes a hand |
| picked up | it rises, its shadow separates, it sounds its own note |
| handle worked | visible travel, a click, the consequence inside 100 ms |
| verb done | a bell |
| verb cannot apply | a paper slip naming what it wanted; never a red cross |
| undone | a tape-rewind sound and the motion run backwards |

**Lamps mean three things and no more.**

- A lamp beside a jack on the switchboard is lit when the cord is in that
  jack: someone is on the line.
- A station's own lamp is dark when idle, steady while its verb is running,
  and blinks slowly as a tell.
- When a tool is lifted, everything built with it pulses twice in *that
  tool's colour*, which is never amber.

### B2. Cross-machine interactions

Three in release 1. Each is one mechanism that works on everything, which
is what makes it worth building well.

**X1. Re-patch the cord (switchboard × every station with a jack).**
The phone talks to whatever the cord is plugged into. Drag the plug to
another jack and the same phone now instructs that station:

| jack | what a text can change |
|---|---|
| STOREFRONT | sign colour, sign words, awning colour, open or closed, a photo in the window |
| PLATEN | colour and label of whatever part is on the tray, a robot included |
| BELT | faster, slower, stop, go, reverse |
| LAMP | brighter, dimmer, a colour, off, on |

"Make it blue" into LAMP turns the light of the whole workshop blue. "The
lamp's off" leaves the bench lit only by the board's lamps and the robots'
eyes. Every jack answers "undo that", "help" (it lists what it can change
here) and "who are you". An instruction for something the cord is not
plugged into gets the true answer: "That's outside this folder. Plug me
into it first." That is Patchlamp's boundary, felt in the hand. Anything
Patch cannot parse gets: "That one's for Taylor. His mailbox is over
there," and the mailbox flag goes up. The toy never claims a message was
sent. Two more jacks are capped with tape that reads RESERVED.

**X2. The belt is a music box (belt × striker × any part).**
Every part that passes under the striker sounds: its note by size, its
octave and timbre by material. The belt's speed dial is the tempo and its
direction lever plays the line backwards. Three crates small to large play
a falling or rising run; add tools and there are six pitches to arrange.
Fetch bobs in time. A card pinned by the striker shows five shapes in a
row, each small, medium or large: the house tune. Play it and the lamp
answers and the crew takes a bow.

**X3. Undo reaches everything (UNDO lever × every station).**
One pull takes back the visitor's last action and what it caused, wherever
that was: paint drains back up the nozzle, a label peels off, a toppled
stack un-topples, a shipped crate comes back in through the dock door with
a reversing beep, the light returns to amber. Pull again to go further
back. § E5 is the model that makes this reliable.

**Arriving later** (§ G): the inspector, who checks parts against order
slips and says exactly what was wrong (X4); the Claude Code lamp clipped to
a robot, which doubles its speed but not the inspector's (X5); the sorter
feeding the belt in size order; a gate that keeps an order out of the wrong
restaurant's window; hold-to-rewind.

**What a visitor can discover in release 1.** Fifteen things, from thirteen
interactions:

1. Things can be picked up and thrown, and each has a note.
2. The Button answers, and answers differently four times.
3. A text changes the storefront.
4. "Undo that", and the lever, run it backwards.
5. The cord moves, and then the phone talks to something else.
6. The lamp: the whole room changes colour. Lamp off is night.
7. Anything on the platen can be changed, a robot included.
8. The belt carries whatever is put on it; the striker plays it.
9. Order makes a tune; the dial is its tempo; the lever reverses it.
10. Things leave by the dock. Undo brings them back through the door. Fetch
    can be shipped.
11. Lifting a tool makes everything built with it answer.
12. Shipped crates open.
13. Hatches show the real thing.
14. The house tune.
15. The crew has opinions: pick Fetch up, pull Patch's cord mid-job, leave
    Revert in peace.

### B3. The first thirty seconds

No instruction text appears at any point. Every cue is something in the
world.

| time | what the visitor sees | what makes it happen |
|---|---|---|
| before JavaScript | The strip (name, role, four links) and a still picture of the bench, dim. | Plain HTML and one image. This is also the whole experience for a browser that cannot run the stage. |
| loading | The picture brightens as the lamp "warms up". No spinner, no bar. | Brightness follows load progress. |
| 0 s | The picture becomes the live bench with no jump. The belt is moving, Fetch is carrying a crate, Patch is at the board, the sign reads TAYLOR REMUND. | The still is rendered from the same camera and the same starting state the live scene begins in. |
| 0 to 3 s | Whatever the pointer passes lifts a hair. Fetch's head follows the pointer. | § B1. On touch, the things nearest the first touch wobble. |
| about 4 s without input | Fetch fumbles its crate. It tumbles forward and stops, rocking, beside the Big Red Button. Fetch looks at the crate, then out at the visitor, and holds out its hands. | Triggered by inactivity, not by the clock. Two obvious things to do are now side by side: hand the crate back, or press the button. |
| first touch | The crate lifts and sounds its note. Dropped on the belt, it rides to the striker, sounds again, and leaves by the dock with a bell. Or the Button's first rung plays (§ B4). | Either choice gives a chain of consequences inside fifteen seconds with no intent to find one. |
| after the first consequence | The lamp of the nearest untouched station blinks slowly; later its lid rattles. | A tell. One at a time, nearest first, every twelve seconds of inactivity, never while the visitor is busy, and none after six discoveries. |

**Attract mode.** Until the visitor's first action, the crew demonstrates
the whole loop, about thirty seconds a lap: Fetch takes a crate from the
stack to the platen and taps the phone ("Make it blue."); Patch moves the
cord, does the job, replies; the crate rides the belt, sounds, and ships.
The phone's screen keeps that conversation, so a visitor who opens it sees
what a text looks like. Anything can be taken out of a robot's hands.

**Play mode.** At the visitor's first action, attract mode ends for the
visit. From then on the crew never works a handle or changes a setting:
those are the visitor's. Fetch goes on carrying fresh crates down the belt
and Patch waits for texts. This is a rule of the history model (§ E5) as
much as of manners.

Rules that protect this sequence:

- **The centre cluster.** The Button, the loose crate, the phone and Patch
  sit inside the middle 40% of the bench, so a phone held upright shows all
  four without panning.
- **Never nag.** If the fumbled crate is ignored for twelve seconds Fetch
  picks it up, shrugs and carries on. The fumble repeats at most every
  forty seconds and stops for good after the visitor's first action.
- **Nothing is hidden behind the first action.** The strip's links work
  from the first paint.

### B4. The Big Red Button

Front and centre, under label tape that reads DO NOT TOUCH. It is the most
obvious thing on the bench and it does not show everything at once: it
escalates one rung per press, and each rung reveals at most one thing the
visitor has not found.

| rung | what happens | Revert's card |
|---|---|---|
| 1. The flinch (3 s) | The lamp dips, the belt lurches back, one crate slides off the stack, Fetch freezes mid-roll. Revert trundles out and puts the crate back. | WELL, THAT WAS UNNECESSARY. |
| 2. The hiccup (4 s) | As rung 1, and the nearest station the visitor has not used misfires once: one beat of its verb. | AGAIN. |
| 3. The cover | A different unused station misfires. Then Revert screws a flip-up cover over the button. | IT SAYS DO NOT. |
| 4. The works (7 s) | Every station the visitor *has already used* misfires together: sparks, a turning warning lamp, the crate stack comes down. Then the whole bench runs backwards to how it was. | I JUST CLEANED THAT. |
| after | Further presses draw from rungs 2 to 4 with a deck of cards, so it never goes dead. A plate beside it counts the presses. | (a deck of six) |

The ladder continues in a later arrival: a padlock, a key that turns up in
Patch's drawer, and a last rung.

Constraints on every rung:

- The visitor's arrangement is never lost: the bench is put back exactly
  (§ E5, "The Button is bracketed").
- A rung is short. While it plays, the camera can still be moved but parts
  and handles do not respond.
- No flashing faster than three times a second, and no full-screen flash.
  With reduced motion, a rung is the card and the lamp dip only.
- The camera does not move by itself beyond a small shake, and not at all
  with reduced motion.
- The rung reached is remembered between visits. "Reset the workshop" in
  the settings starts over.

### B5. The crew

Fetch, Revert and Patch in release 1. Proof, the inspector, is the first
arrival. They share one rule: **the visitor always comes first.** A robot's
reaction lasts at most a second and a half, only one of them does anything
attention-seeking at a time, none repeats a line twice running, and none
uses or moves a part the visitor has touched (§ E5).

These are sketches of character, not scripts (§ What is fixed). The names
are working names (§ Decisions).

**Fetch, the runner.** One wheel, one round eye, a flag on an aerial. It
carries parts between stations inside lanes of yellow tape.

- *Temperament:* eager and too fast. It overshoots every stop and skids.
- *With the visitor:* watches the pointer. Holds its hands up when
  something is carried near it. If the visitor does its job for it, it
  looks at its empty hands and salutes.
- *Picked up:* its wheel spins in the air. Put down outside its lanes, it
  hurries back.
- *Its boundary:* it cannot cross the tape. Reaching for something outside
  it, it stretches, gives up, and prints a slip: "OUT OF MY LANE."

**Revert, the caretaker.** Low and wide on treads, with a broom, a dustpan
and a crank on its back. It lives in a cupboard under the bench.

- *Temperament:* deadpan. It answers with printed cards.
- *What it does:* comes out after the Button, and whenever the UNDO lever
  is pulled: it turns its crank and the change runs backwards. It restocks
  the crate stack and, when the bench is crowded, puts away the oldest
  things nobody has touched for a while.
- *Left in peace:* if the bench stays tidy for two minutes it parks in the
  light from the window and powers down, one eye still open.
- *Picked up:* it is heavy and goes limp.

**Patch, the operator.** The raccoon in a cardigan and headset from
Patchlamp's brand picture, on a stool at the switchboard. Patch does not
leave the stool.

- *What it does:* when a text arrives the line's lamp lights, Patch pulls
  open the drawer labelled for that jack (the folder), does the work, leans
  out to check the result is really there, and texts back.
- *With the visitor:* pull the cord out mid-job and Patch looks at the dead
  plug, then slowly at the visitor.
- *Asked "who are you":* "CLAUDE, WEARING A NAME TAG THAT SAYS PATCH."
- *Brand rules apply:* Patch is "it", says "I" of itself, and names Taylor.

**Proof, the inspector (first arrival).** Tall and narrow, fixed at a
bench beside the belt, with a loupe, a rubber stamp and a clipboard. Exact,
slow, impossible to hurry: the belt stops for it. It checks each part
against the open order slips, stamps what is right, and tags what is not
with exactly what was wrong ("EXPECTED BLUE. GOT RED."). From the day it
arrives, the dock stays shut for anything unstamped.

What each stands for, said once on the workshop's maker's plate, in words
Taylor approves:

| in the workshop | in his work |
|---|---|
| lanes of tape a robot cannot cross | an agent works inside one project's permissions |
| the UNDO lever and Revert | every change is versioned and can be reverted |
| Patch on the stool, one drawer per jack | Patchlamp's operator, one folder per client |
| Proof, and the dock that stays shut (on arrival) | review and tests before anything ships |

### B6. Camera and controls

The camera looks at the bench from the front and above, at a fixed angle,
through a long lens so it reads as a miniature. It pans along the bench and
zooms between the whole bench and one station. There is no free orbit: one
side of everything is the good side, and nobody gets lost.

| | mouse | touch | keyboard |
|---|---|---|---|
| look | move (things lift under the pointer) | (none) | Tab moves through the controls list |
| use a handle | click | tap | Enter or Space |
| carry a part | drag; or click it, then click a mouth | drag; or tap it, then tap a mouth | Enter to pick up, choose a destination, Enter |
| pan | drag on empty bench | one finger on empty bench, or two fingers anywhere | arrow keys |
| zoom | wheel, toward the pointer | pinch | `+` and `-` |
| frame one station | double-click it | double-tap it | Enter on its name |
| back out | Esc | pinch out or the back button | Esc |
| undo, mute, controls list | (the lever), strip, strip | same | `U`, `M`, `?` |

- Tap-then-tap carrying exists for touch and for anyone who cannot drag;
  while a part is held that way, every mouth that would take it pulses.
- Framing a station sets the address (`/#patchlamp`), so a station can be
  linked to and the browser's back button backs out.
- An address that names a section of the paperwork with no station of its
  own (`/#services`, `/#about`) opens the paperwork at that section.
- On the stage the page itself does not scroll. The strip offers **Read**,
  which swaps the stage for the paperwork (§ B7).

### B7. The conventional path

Nothing a recruiter or a customer needs is available only in 3D.

- **The strip**, on `/` at all times, in HTML: "Taylor Remund · software
  engineer · I build and run Patchlamp", then Résumé, GitHub, LinkedIn,
  Email, then Read, sound, and settings. On a phone the links fold into one
  menu. A slim line at the bottom carries Privacy, Terms and SMS.
- **The paperwork**: the same page's plain document: who he is, Patchlamp,
  the work, the services, about, contact (§ F1). It is what a search
  engine, a screen reader, a browser without WebGL and a visitor who
  presses Read all get. The first thing focus lands on is a link to it.
- **`/resume/`** stays a fast plain page and is one click from everywhere.
- **In the world**, second routes to the same places: a clipboard marked
  RÉSUMÉ hanging by the pallets, and the mailbox (contact).
- **Hatches**: a brass plate opens an HTML panel: what the real thing is,
  what the toy shows, what the toy simplifies, the facts with their dates,
  and links. Two in release 1: Patchlamp's, and the maker's plate under the
  sign for the workshop itself.

### B8. Taking control of a robot

**Recommendation: not in release 1; a lighter version as an arrival.**

- It is practical. Fetch on one wheel is easy to drive.
- It is expensive to do well: a second camera that behaves in tight
  spaces, collision for the whole bench at robot height, touch controls,
  and places worth driving to. That is a second game.
- It is the character control the design deliberately avoided, returning
  by a side door, and it adds little until there are hidden places to find.

The arrival **ride along** comes first: click Fetch, choose it, and the
camera sits on Fetch's shoulder while it does its rounds. Everything can
still be clicked from there. Full driving is built only if playtesters
keep trying to steer.

### B9. Sound

- Recommended: short mechanical sounds are on, quietly, from the visitor's
  first click or tap; the mute control is always in the strip and is
  remembered. What testers do at G2 settles the default.
- Part notes are synthesised in the browser. A handful of recorded sounds
  (lever, bell, beep) are original or CC0. No licensed music.

### B10. Reduced motion, small screens, weak hardware

- **Reduced motion:** the belt and crew start still, the camera cuts
  instead of easing, Button rungs are a card and a lamp dip. Whatever the
  visitor does still moves. The settings can turn full motion on.
- **A phone held upright:** the stage opens on the centre cluster. Hit
  areas are at least 44 px. Text entry on the in-world phone uses the
  ready-made texts first.
- **Weak or absent graphics:** the still picture and the paperwork. A weak
  machine that can run the stage gets it with fewer loose parts and without
  cast shadows (§ E7).

## C. World layout

The opening bench is compact: about 20 units wide and 10 deep, where a
robot is 1 unit tall. Everything usable is in view on a wide screen without
panning. It is built in bolted sections, so it can be lengthened at either
end when arrivals need room. Work flows left to right. Tall things stand at
the back. Nothing usable is hidden behind anything else from the fixed
camera.

```
                         BACK WALL
 ┌─────────────┬───────────────────────────┬──────────────┐
 │  TOOL WALL  │   sign: TAYLOR REMUND     │    WINDOW    │
 │  (pegboard) │   SWITCHBOARD + Patch     │  (mountains) │
 │             │   the LAMP, clamped here  │              │
 ├─────────────┴───────────────────────────┴──────────────┤
 │                                                         │
 │  ┌ tape ──┐     UNDO     PLATEN ─► storefront  ┌ tape ──┐
 │  │RESERVED│     lever                          │RESERVED│
 │  └────────┘     phone                          └────────┘
 │                                                         │
 │                    ( DO NOT TOUCH )                     │
 │                                                         │
 │  crate                                   striker        │
 │  stack ═════════════ belt ════════════════ arm ═══► DOCK│
 │                                                         │
 │  return chute    Revert's cupboard     pallets · clipboard
 │                  (under the bench)     · mailbox        │
 └─────────────────────────────────────────────────────────┘
                     FRONT EDGE (the visitor)
 strip:  Taylor Remund · software engineer · I build and run Patchlamp
         Résumé · GitHub · LinkedIn · Email      Read · sound · settings
```

| station | address | where | first seen as |
|---|---|---|---|
| The sign and the lamp | `#top` | back, centre | the name, lit |
| Patchlamp | `#patchlamp` | centre | Patch at the board, the phone, the storefront |
| The Button | `#button` | front of centre | the reddest thing on the bench |
| The belt | `#line` | along the front | motion, the striker, the dock |
| Shipped | `#work` | front right | pallets of stencilled crates |
| Tool wall | `#tools` | back left | tools on a shadow board |
| Mailbox | `#contact` | front right | a flag |

**How attention is guided without a path.** The lamp makes the centre the
brightest place. Motion draws the eye left to right along the belt. Tells
(§ B3) point at whatever is nearest and untouched.

**The reserved bays.** Two taped rectangles with label tape naming what is
coming. They are an honest roadmap and a reason to come back. When a
machine arrives, a returning visitor finds its crate in the bay and
watches Fetch open it; a new visitor simply finds the machine.

**The shipped pallets are the work history.** Four pallets. Three are
stencilled with role, employer and dates exactly as `/resume/` gives them:
Software Developer, Kingsley Management Corporation, Nov 2024 to present;
Automation Engineer, the same, Jun 2023 to Nov 2024; DevMountain, Nov 2022
to Apr 2023. The fourth is his own projects. On each, a crate for every
project card on `/resume/` that belongs there (Patchlamp has its station
instead). A crate opens to a standing card: the name, one line, the tools.
Crates, not years, carry the weight: `profile.md` lists "leading with years
of experience" under what must not be done.

**The window** shows cut-out mountains.

## D. Interaction inventory

Release 1 has thirteen. Every one is finished to the standard G1 sets, or
it is not in the release.

**1. Pick up and throw anything loose.** *Input:* drag, or tap then tap.
*Behaviour:* the part rises and follows on a spring; released, it falls
and tumbles with its weight and bounce. *Feedback:* its note, its shadow,
the crew's eyes. *Reset:* what leaves the bench comes back up the chute;
UNDO puts a moved thing back. *Why it is fun:* weight and sound make moving
things satisfying before anything else is understood.

**2. The Big Red Button.** § B4, rungs 1 to 4. *Reset:* each rung rewinds
itself. *Why:* everyone presses it; it answers with a joke, and each press
gives back a little more.

**3. Text a change.** *Input:* tap the phone; choose a ready-made text or
type one. *Behaviour:* the line's lamp lights, Patch opens the folder
drawer, makes the change, checks it, replies. *Feedback:* the change, the
reply on the phone, the lamp. *Reset:* "undo that", or the lever. *Why:*
words turn into a physical change, the way the product works.

**4. Re-patch the cord.** X1. *Input:* drag the plug to another jack.
*Feedback:* the cord swings like a rope, the jack's lamp lights, the
phone's ready-made texts change to suit. *Reset:* UNDO, or "Reset the
workshop". *Why:* one familiar action suddenly works on everything, the
lamp most of all.

**5. Run the belt.** *Input:* a speed dial, a direction lever.
*Behaviour:* everything on it moves accordingly. *Reset:* UNDO. *Why:* it
is the room's clock; changing it changes everything downstream.

**6. The striker.** X2. *Input:* anything passing under it. *Why:* an
arrangement of objects becomes a tune with no instruction.

**7. The dock.** *Input:* anything reaching the door. *Behaviour:* the
door rolls up, the part leaves, a bell rings. Plain crates are replaced
from the stack; a tool or a robot comes back up the chute with a RETURN TO
SENDER mark. *Reset:* UNDO brings a shipment back through the door. *Why:*
things have somewhere to go, and coming back is funnier than leaving.

**8. UNDO.** X3. *Input:* pull the lever; or text "undo that". *Why:*
seeing a change run backwards is satisfying each time, and it makes
experimenting safe.

**9. The tool wall.** *Input:* lift a tool off its peg. *Behaviour:*
everything built with that tool pulses in the tool's colour: the Patchlamp
station, the crates on the pallets. Hung back, it snaps to its painted
shadow. A tool is a part like any other: it has a note, it can be painted
and shipped. *Tools:* Laravel, Vue, PHP, Python, Rust, SQL, Flutter, Claude
Code; a pinned sheet opens the full skills list from `/resume/`. *Why:*
skills shown as what they built.

**10. Open what was shipped.** *Input:* the latch on any crate on the
pallets. *Behaviour:* the lid opens and a card stands up. Its plate opens
the full card from `/resume/`. *Why:* the work history is something to
open, not to read.

**11. Hatches.** § B7.

**12. The mailbox and the clipboard.** § B7. *Why:* the practical things
are also pleasant to use.

**13. The crew.** § B5. Poke, pick up, paint, hand things to.

One written secret, the house tune (§ B2 X2). The other surprises are not
written at all; they fall out of the laws: a blue robot, a shipped Fetch,
night, a tune played on wrenches.

Everything else in the larger picture is an arrival, listed in § G.

## E. Technical architecture

Versions named here were current on npm on 2026-11-17. The building session
reads the current documentation for each before using it; it does not work
from memory.

### E0. What the engineering is for

Each decision below exists for something the visitor feels. A choice that
cannot be traced to a row here is questioned before it is built, and where
a technical goal conflicts with the feel, the feel wins, inside § 2 and
§ 3.

| decision | what the visitor gets |
|---|---|
| A still picture first, and the lamp warming up | Something to look at in the first second; curiosity, not a wait |
| Real physics for loose parts | Weight. Things feel like things. |
| Scripted machines on a fixed step | A press answers at once, the same way every time |
| Machines act on properties, not kinds | Every experiment does something |
| Recorded effects and the history model (§ E5) | It is safe to try anything, and undoing is a pleasure |
| The crew never touches the visitor's things | The visitor is in charge; nothing they made is spoiled |
| One registry of everything usable | Tells always have something next to point at; nothing is unreachable by keyboard |
| Frame-time budgets | Dragging stays tight; the toy never feels like software |
| Tiers and a fallback | Nobody meets a broken page |
| The soak test | Nothing gets stuck, lost or piled up after ten minutes of play |
| The strip in plain HTML | Someone who came for the résumé is never made to play for it |
| Simulation separate from drawing | Behaviour can be tested, so polish time goes to feel, not to bugs |

Feel targets, checked at G2 and G5: a hover answers in the next frame; a
grab within 50 ms; a handle's consequence within 100 ms; a chain of
consequences within 15 seconds of arriving; something new to find for at
least the first three minutes.

### E1. Choices

| area | choice | why, and what it costs |
|---|---|---|
| Site shell | **Astro**, static output, directory URLs | Shared layouts for eight pages, content files with a checked schema, no JavaScript on pages that need none. Cost: Pages moves from "serve the branch" to an Actions build. |
| 3D library | **Three.js** in TypeScript, used directly | One persistent scene driven by a simulation loop. React Three Fiber would add React to a stack that has none; the Vue equivalent is younger. Cost: the project writes its own small conventions for lifecycle and disposal. |
| Renderer | **`WebGLRenderer`** (WebGL 2) | Nothing in this look needs WebGPU, and it is the widest-supported and best-documented path. Reports on WebGPU in Firefox and on phones conflicted when checked. |
| Physics | **Rapier** for loose parts only | Stable stacking, sensors, snapshots. Cost: its WebAssembly file is 3.08 MB before compression (measured from the package); compressed size is measured in P2. It loads after first paint and sits behind an adapter so it can be swapped. |
| Machines and crew | Scripted state machines on a fixed 60 Hz step | Predictable, testable, cheap. Physics is for things that tumble, not for things that perform. |
| Geometry | Built in code from a parts kit (§ E3) | No modelling tool is available; the look is designed to suit it. Proven or replaced at G1. |
| Animation | A small in-house timeline driven by the simulation clock | Lets reduced motion be honoured in one place and keeps behaviour testable. |
| Audio | Web Audio directly | Synthesised notes plus a few samples; no library needed. |
| Interface overlay | Plain HTML and TypeScript | A strip and three kinds of panel do not need a framework. |
| Tests | Vitest (unit and headless simulation), Playwright (browser), `shot` (page audits) | § E8 |
| Hosting | GitHub Pages through Actions | Same host, same domain, same certificate. |

Runtime dependencies are two: `three` and Rapier. Everything else is a
development dependency. Versions are pinned exactly and the lockfile is
committed; CI installs with `npm ci`.

### E2. Layers

The rule that makes this maintainable: **the simulation does not know it is
being drawn.**

```
src/content/     facts: projects, roles, skills, services, toy claims
src/pages/       index, resume, ai, privacy, terms, sms, career-send, 404
src/layouts/     Paper (the conventional pages), Stage (the home page)
src/workshop/
  sim/           world, parts, history, machines/, crew/, physics adapter, clock, rng
  view/          kit/, materials, light, camera, labels, effects, one view per station
  input/         pointer, touch, keyboard, picking, the controls list
  audio/         notes, samples, mixer
  ui/            strip, panels (hatch, phone, contact), settings
  shell/         boot, capability tiers, picture-to-stage handoff, fallback, saved state
tests/           unit/, scenario/ (headless simulation), browser/ (Playwright)
scripts/         verify, check-urls, check-legal, check-claims, budget, poster
legal-reference/ the approved text of record for the four compliance pages
public/          CNAME, assets/ at their old paths, the still picture, fonts, robots.txt
```

| layer | owns | must not |
|---|---|---|
| `content` | every fact and every sentence a visitor can read, each with a source | contain layout or behaviour |
| `sim` | parts and their properties, machines, the crew, the history, physics | import Three.js or touch the DOM; it runs in Node for tests |
| `view` | turning simulation state into a picture | change simulation state |
| `input` | turning pointer, touch and keys into intents (hover, press, grab, drop, turn, plug, focus) | know what any machine does |
| `audio` | sound for simulation events | decide when things happen |
| `ui` | the HTML around and over the stage | hold facts; it reads them from `content` |
| `shell` | starting, choosing a tier, falling back, saving | know about any particular station |

### E3. The parts kit, and the tools of the look

Every mesh in the world comes from a kit function; nothing is built from
raw primitives at the point of use. That is what keeps the look consistent
and lets a build check enforce it.

- Kit pieces for release 1: rounded and bevelled solids, turned profiles,
  pipe along a path, lamp, lever, dial, push button, jack and plug, cord (a
  simple rope, not a chain of physics joints), belt with rollers, crate in
  three sizes, pallet, pegboard and peg, eight tools, label tape, paper
  card, hatch plate, the robot rig (one rig, two sets of proportions and
  fittings), Patch, storefront, phone, mailbox, clipboard, window with
  cut-out mountains, painted sign with bulbs.
- Every piece takes its colours from the palette tokens only.
- Repeated pieces are instanced; the fixed body of each station is merged
  into as few meshes as its materials allow.
- All text is drawn to textures from the content files at start-up.
- A development-only page shows each kit piece on a turntable: the parts
  catalogue for review and for picture-comparison tests.

Means the build may use to reach the standard of § A, each allowed when it
earns its frame time: shading baked into creases at build time; generated
surface variation (grain, wear, dust); a generated environment for brass
and paint to reflect; soft shadow filtering; a rim light on characters;
and post-processing (a little depth blur, bloom on bulbs) if G1 shows the
look needs it and § E7 still holds.

If G1 concludes that some or all geometry should be modelled instead, the
kit's interface stays and its insides change: a kit function may return a
loaded model. Nothing above the kit needs to know.

### E4. The contracts

Sketches, to fix responsibilities. The building session settles the exact
signatures.

```ts
// Anything a visitor can act on.
interface Interactable {
  id: string;                 // stable; used in addresses, saves and tests
  station: StationId;
  name: string;               // what a screen reader and the controls list call it
  affordances: Affordance[];  // 'press' | 'grab' | 'turn' | 'slide' | 'plug' | 'open'
  tell(): void;               // the idle hint
  misfire(level: 1 | 2): void; // what the Button makes it do; transient only
}

// Anything with a mouth.
interface Machine extends Interactable {
  accept(part: Part, cause: Cause): Outcome;         // does its verb, or says what it wanted
  instruct?(cmd: Instruction, cause: Cause): Outcome; // for stations with a jack
  abort(cause: Cause): void;                          // drop pending work for this cause
}

// The only way durable state changes.
interface Effect { target: Id; field: string; before: Value; after: Value; cause: Cause; }
type Cause = TransactionId | 'crew' | 'system';
```

Invariants the tests hold the code to:

1. Every `Interactable` is in one registry. The registry is the only source
   for picking, the controls list, tells, Button rungs, reset and saving.
   A test fails if an interactable lacks a name, a tell, or a misfire.
2. Machines do not call each other. They meet only through parts, through
   instructions from the switchboard, and through events on one bus.
3. Durable state changes only through `Effect`s (§ E5).
4. Given the same seed and the same recorded input, everything that is not
   physics ends in exactly the same state. Physics is asserted by outcome
   ("the crate reaches the dock within N steps"), not by exact position.
5. No visible sentence is written in `sim`, `view` or `ui`. A check fails
   the build on a string that reads like prose outside `content`.
6. Every content entry that states a fact has a `source`.

### E5. History and undo

The lever has to reverse a chain of consequences without touching anything
the visitor did not cause, and without ever leaving the world in a state it
could not have reached. This model is settled before any machine is
written. P2 builds it first and tests it alone.

**Undo restores recorded values. It does not run actions backwards.** No
machine has "inverse" code that could be wrong.

**Three kinds of state.**

| kind | what it is | examples | recorded |
|---|---|---|---|
| Durable | named values that say how the world *is* | a part's colour, label, marks and location; the belt's speed and direction; the lamp's colour and level; the storefront's sign, awning, hours and photo; which jack the cord is in | Yes. It changes only through effects. |
| Motion | a loose part on the move | position, rotation, velocity | No. Only where it comes to rest, as its location. |
| Transient | everything in flight | animations, where a robot is and what it intends, the belt's phase, timers, particles, sound | Never. It is rebuilt from durable state. |

A part's **location** is durable and is exactly one of: `rest` (with a
pose), `in` (a named station's mouth), `shipped`. Being held and being in
flight are motion, not locations: while a part is held or moving, its
durable location stays what it last was, and is written again only when
the part comes to rest, enters a mouth, or ships. So a recorded "before"
is always a place a part can be put back to.

**The rules.**

1. **Commit points.** Durable state changes in a single simulation step,
   all at once. An animation is the showing of a change, never the change.
   So the durable world is valid at every step, and an undo can run at any
   step.
2. **Effects.** Every durable change is recorded as an effect: what, which
   field, the value before, the value after, and its cause.
3. **Causes.** A visitor's action (a press, a release, a turn, a plug, a
   sent text) opens a **transaction**. A cause is a transaction, or `crew`
   (a robot acting on its own), or `system` (restocking, putting away).
   Only transactions go on the undo stack.
4. **Who is charged.** This is how a chain is followed.
   - An effect that comes from an instruction is charged to the transaction
     that sent it, however long Patch takes.
   - An effect a machine applies to a part is charged to the transaction
     that last placed that part, while that transaction is still on the
     stack. Put a crate on a stopped belt; a minute later start the belt;
     the crate ships. The shipment belongs to putting the crate down, and
     starting the belt is its own transaction.
   - When a visitor lets go of a part, a window stays open until everything
     it set moving is at rest again (six seconds at most). Any part that
     was at rest before and is at rest somewhere else when the window
     closes is charged to that transaction: the toppled stack belongs to
     the throw.
   - **A moving part has one owner.** If the visitor starts another action
     while a window is still open, the older window closes at that moment
     and records only what has already come to rest; everything still
     moving passes to the new transaction. If the visitor picks up a part
     that is still moving, that part passes to the new transaction and the
     older window goes on without it. Either way the part's recorded
     "before" is its last durable location, the place it rested before
     anything disturbed it, so undoing the newer action puts it back there
     and the older transaction holds no entry for it.
   - A part that falls off the bench and comes back up the chute is charged
     the same way as any machine effect.
5. **Single writers.** These keep histories from tangling.
   - In play mode the crew never works a handle or changes a setting.
     Settings have one writer: the visitor.
   - A part the visitor has touched or changed is the visitor's. The crew
     does not use it or move it. Fetch draws fresh crates from the stack.
   - In attract mode there is no history yet, so the crew may demonstrate
     anything.
6. **Writer and previous writer.** Every durable field carries, beside its
   value, the cause that last wrote it: its **writer**. The first time a
   transaction writes a field it records one **entry** for it: the value
   the field had at that moment (`before`) and the writer it had at that
   moment (`previous writer`). Later writes to the same field by the same
   transaction only update that entry's `after`. So a transaction holds one
   entry per field, and an undo never passes through the states in between.
7. **Writes arrive in order.** A field is never written by an older
   transaction after a newer one has written it. This holds by
   construction: instructions are carried out one at a time in the order
   they were sent; a machine's effect on a part is charged to whoever
   placed it last; a moving part has one owner. It is also enforced at the
   commit point: a pending change whose field a newer transaction has
   written since does not commit, and whoever was carrying it out says so
   (text "faster", then turn the dial by hand before Patch gets there, and
   Patch replies that it has been changed since and leaves it). So for
   any field, the chain of previous writers runs strictly back in time.
8. **The lever.** It takes the most recent transaction on the stack. For
   each of its entries: if the transaction is still the field's writer,
   the field gets its `before` value back **and its writer becomes the
   entry's previous writer**; if the crew or the system has written the
   field since, the field is left exactly as it is and Revert says so on a
   card. Then the transaction leaves the stack. No newer transaction can
   have written any of its fields, because there is none.

   *Consecutive writes to one field.* A crate starts in its original
   colour, writer W. T1 paints it blue: T1's entry is before = original,
   previous writer = W; the field is now blue, writer T1. T2 paints it red:
   T2's entry is before = blue, previous writer = T1; the field is now
   red, writer T2. Undoing T2 gives blue with writer T1. Undoing T1 then
   finds itself the writer and gives the original colour with writer W.
   Each undo restores exactly the state its own transaction found.
9. **Putting things back.** Restoring a location of `rest` hops the part
   back to its earlier pose along a short arc, without physics; if the
   place is taken, to the nearest free spot. Restoring from `shipped`
   brings it in through the dock door. Restoring `in` sets it back in that
   station's mouth.
10. **Unfinished business.** A transaction may still have work pending
    when it is undone: Patch mid-job, a crate still riding the belt.
    Undoing it first cancels everything pending under it (each machine
    drops that work and returns to idle; nothing more commits), then
    restores.
11. **One step.** All the restores of one undo are applied in the same
    simulation step. What the visitor sees (paint draining, the hop, the
    reversing beep) is transient and plays after.
12. **"Undo that" is all or nothing.** Texted to Patch, it picks the most
    recent instruction sent through the jack the cord is in that has not
    been undone, which may not be the newest transaction on the stack. It
    goes ahead **only if that transaction is still the writer of every
    field it wrote.** Then it is rule 8 applied to that transaction, and
    by rule 7 no newer transaction holds an entry for any of those fields,
    so taking it out of the middle of the stack leaves every other entry
    true. If anything has written any of those fields since (a newer
    transaction, the crew, the system), **nothing is changed and the
    transaction stays where it is**; Patch replies that something has
    changed it since, and that the lever takes things back in order. It
    never restores part of a transaction, and it never removes a
    transaction whose value a newer entry still holds as its `before`.
    That is what keeps a later pull of the lever from bringing back a
    value no surviving action set.
13. **Not in the history at all:** the camera, panels, lids and hatches,
    sound, what has been discovered, and the Button.
14. **Forgetting.** The stack holds thirty transactions. When the oldest
    drops off, its entries are deleted, and wherever it was a field's
    writer or an entry's previous writer, that becomes `settled`: a
    settled value is simply how the world is, and cannot be undone. When
    Revert puts a part away, every entry about that part is deleted from
    every transaction first, so no entry is left pointing at something
    that has gone. A transaction with no entries and nothing pending
    leaves the stack, so a pull of the lever never does nothing silently.

**The Button is bracketed.** At the press: a snapshot of all durable state
and every part's pose; parts and handles stop responding; the crew pauses;
the stack is frozen. During the rung: misfires are transient, physics runs
freely, and every step's poses are recorded. At the end: the recording
plays backwards, the snapshot is restored exactly, and everything resumes.
The world after a rung equals the world before it, except the rung and the
press count. So the Button cannot interfere with the history, and the
history cannot interfere with the Button.

**Worked examples.**

| the visitor | what is recorded | one pull of the lever |
|---|---|---|
| Texts "make it blue" with a crate on the platen, then at once drags a different crate away | T1: nothing yet (Patch is working). T2: the second crate's location. Two seconds later Patch commits: T1 gains the first crate's colour. | Undoes T2 (the later action): the second crate hops back. A second pull undoes T1: the paint drains. |
| Throws a crate into the stack; four crates end up on the floor of the bench | T: the thrown crate's location and the four others', gathered when everything is at rest. | All five hop back, last moved first. The stack is whole. |
| Puts a tool on the belt; it rides, sounds, ships | T: the tool's location, written twice (`in` the belt, then `shipped`), kept as one entry: before = on its peg. | The tool comes back in through the dock door and hangs itself up. It never stops halfway. |
| Texts "make it blue", then "make it red", at the same crate | T1: colour, before = original. T2: colour, before = blue, previous writer = T1. | First pull: blue, and the colour is T1's again. Second pull: the original colour. Two texts of "undo that" do the same. |
| Texts "faster" to the belt (speed 1 to 2), then turns the dial by hand (2 to 3), then texts "undo that" | T1: speed, before = 1. T2: speed, before = 2, previous writer = T1. | "Undo that" picks T1, finds the dial has written the speed since, and changes nothing; T1 stays on the stack and Patch says so. The lever then gives 2, then 1. Had T1 been removed, the next pull would have restored a 2 that no surviving action set. |
| Paints a crate blue by text, drags a different crate across the bench, then texts "undo that" | T1: the first crate's colour. T2: the second crate's location. | "Undo that" picks T1, which still owns the colour: the paint drains and T1 leaves the middle of the stack. T2 is untouched; the lever still undoes it. |
| Throws crate A at the stack; before things settle, throws crate B | T1 closes the moment B is let go, holding only what has already come to rest. Everything still moving, A included if it is, is T2's, with before = where it rested before either throw. | First pull: everything T2 holds returns to where it started. Second pull: the rest. |
| Throws a crate at the stack, then catches one of the falling crates and sets it down | T1: the thrown crate and the others, without the caught one. T2: the caught crate, before = its place in the stack. | First pull: the caught crate goes back to the stack. Second pull: the others follow. |
| Texts "make the sign red", then pulls the lever while Patch is still reaching for the drawer | T is open with nothing committed. | Patch's job is cancelled; Patch looks at the lever. Nothing changes, because nothing had. |
| Paints a crate, leaves it for five minutes; Revert puts it away | T's entry about that crate was deleted when Revert put it away; T, left empty, left the stack. | The lever undoes whatever came before it, or reports there is nothing left. |
| Ships Fetch | T: Fetch's location = `shipped`. Ten seconds later Fetch comes back up the chute by itself: written by `crew`. | Fetch's location is no longer T's to restore. Revert's card says someone has moved that since. |
| Presses the Button mid-experiment | Nothing. The rung is bracketed. | Undoes the action before the press, exactly as if the Button had not been pressed. |

**What the tests hold** (§ E8). History tests run against stand-in
machines with scripted rest events in place of physics, so every one is
exact and repeats identically.

*The replay check*, after every action and every undo in a sequence
generated from a seed that mixes actions, lever pulls and "undo that":
the durable state equals what is obtained by starting from the initial
state and applying, in order, every recorded effect whose transaction has
not been undone. Any restored value that no surviving effect accounts for
fails it. That is the test for stale state.

*Invariants*, checked at every step of the same sequences: every field's
writer is a transaction on the stack, `crew`, `system` or `settled`; every
entry's previous writer is one of those too, and where it is a transaction
it is older than the entry's own; no field written by `crew` or `system`
since is changed by an undo; every part has exactly one location and the
cord is in exactly one jack; no entry points at a part that has been put
away; with the crew frozen and fewer actions than the stack holds, pulling
the lever until it is empty returns every field to its starting value and
writer.

*Named cases*, one deterministic test each:

| test | sequence | must hold |
|---|---|---|
| `consecutive-writes` | T1 original to blue; T2 blue to red; lever; lever | after the first pull: blue, writer T1; after the second: original, original writer |
| `consecutive-writes-forgotten` | the same, then T1 is forgotten; lever | blue, writer `settled`; a further pull does not touch the colour |
| `targeted-undo-clean` | T1 paints by text; T2 moves another part; "undo that" | colour restored; T1 gone from the middle; T2's entry and the part it moved unchanged; lever then undoes T2 |
| `targeted-undo-refused` | T1 "faster" by text; T2 dial by hand; "undo that"; lever; lever | "undo that" changes no value and no stack entry; then speed 2 with writer T1; then speed 1 |
| `targeted-undo-refused-by-crew` | T1 changes a field by text; a stand-in writes that field as `crew`; "undo that" | nothing changes; T1 stays. (Rule 5 keeps this from arising in play; the test pins rule 12 in case it ever does.) |
| `late-commit-dropped` | T1 "faster" by text, still pending; T2 dial by hand; Patch reaches the job | T1 commits nothing; speed and its writer are T2's; lever restores the speed from before both |
| `window-handover` | T1 throw; one part at rest; T2 throw while another still moves; all at rest; lever; lever | the moving part is in T2 alone with before = its place before either throw; after both pulls everything is where it started |
| `window-claim-by-grab` | T1 throw; a falling part is caught and set down as T2; lever; lever | T1 holds no entry for the caught part; after both pulls everything is where it started |
| `open-transaction-undo` | T sends a text; lever before the commit | the job is cancelled, nothing is written, T leaves the stack |
| `put-away-forgets` | T paints a crate; Revert puts it away; lever | no entry names the crate; the lever acts on the transaction before T or reports nothing left |
| `button-bracket` | actions; a Button rung; lever | durable state after the rung is identical to before it; the lever undoes the action before the press |

### E6. Loading, in order

1. HTML, CSS, the still picture and the strip. This alone is a complete,
   useful page.
2. The stage script and, in parallel, the physics file.
3. The scene is built in the same state and from the same camera as the
   still picture, then swapped in.
4. Sound loads on the first click or tap.

The still picture is rendered from the real scene by a script and
committed; a check fails if the scene has changed since it was rendered.

### E7. Budgets and tiers

Targets set by this spec; none is measured yet. "Reference laptop" is this
machine.

| what | budget |
|---|---|
| First paint of `/` (HTML, CSS, picture, fonts) | at most 200 KB transferred; LCP at most 1.5 s on the reference laptop with "Fast 4G" throttling; CLS 0 |
| Stage usable | at most 3 s on the reference laptop unthrottled; at most 6 s with "Fast 4G" |
| Stage transfer, physics included | at most 2.2 MB compressed. If Rapier alone makes this impossible, G2 decides between raising the number and swapping the engine. |
| Sound | at most 400 KB, after first gesture |
| Frame time, reference laptop, 1440×900, high tier | median at most 16.7 ms, 95th percentile at most 22 ms over a scripted 60 s session that includes Button rung 4 |
| Low tier under 4× CPU throttle | at least 30 frames a second |
| Scene | at most 180 draw calls, 250,000 triangles, 60 loose bodies awake |
| Conventional pages | no third-party request, at most 5 KB of JavaScript, `shot design` clean |

| tier | chosen when | what it gets |
|---|---|---|
| High | capable graphics and a short frame-time probe passes | cast shadows, full part count, device pixel ratio up to 2 |
| Low | the probe fails, or a small-memory device | soft blob shadows, 30 loose bodies, pixel ratio 1 |
| Still | no WebGL 2, software rendering, data-saver, a crash, or no JavaScript | the picture and the paperwork |

If frame time worsens during a visit the stage steps down by itself:
resolution first, then shadows, then part count. A lost graphics context
shows the picture and a button to restart the workshop. Any uncaught error
in the stage falls back to the Still tier. The stage stops drawing when its
tab is hidden.

### E8. Tests and checks

| kind | what it proves |
|---|---|
| Unit | part properties; each machine's states; the instruction parser, from a table of texts; the content schema |
| History | everything under "What the tests hold" in § E5: the replay check and the invariants on sequences generated from a seed, and each named case as a deterministic test |
| Scenario (headless) | recorded inputs lead to expected outcomes. Release 1: a crate put on the belt sounds at the striker and ships at the dock; each of X1, X2, X3 end to end; rung 4 leaves the bench as it was. When the inspector arrives, the shipping scenario changes with it: stamped parts ship, unstamped parts do not. |
| Soak | an hour of simulated random grabbing, throwing and pressing from a seed: no part outside the bench, no runaway part count, every machine back to idle after reset |
| Browser | the page loads in Chromium, Firefox and WebKit with no console error; the canvas is not blank; the Still tier appears when WebGL is refused; reduced motion is honoured; the keyboard path presses the Button and hears the result announced |
| Pictures | the approved frames from G1, re-rendered at a fixed simulation step and compared |
| Legal | two checks. (1) Each compliance page's `.legal` wrapper in the built output equals `legal-reference/` byte for byte. (2) Every `legal-callout` block equals the copy frozen from `main` at `fa99b13`, whatever else has been approved. A change of wording is made by editing `legal-reference/` in a commit of its own that names Taylor's approval and its date; check (2) cannot be satisfied by such an edit. |
| Site | every path in § 2 answers from the built output, `/resume` included; no page links to `/career-send/`; no broken link; `shot check . --all`; `shot design .`; the transfer budgets |
| Claims | every row of the toy truth table (§ F3) and every Patchlamp sentence has its source filled in |

One command, `npm run verify`, runs everything that needs no graphics card.
`npm run perf` runs the frame-time session on the reference laptop.

### E9. Accessibility

- The paperwork is a complete alternative and is the first thing in the
  focus order.
- Every interactable is also a button in an HTML controls list, grouped by
  station. Focusing one frames it on the stage.
- What happens is announced in a polite live region in short sentences
  ("Crate painted blue." "Shipped.").
- Carrying never requires a drag (§ B6).
- Text contrast on HTML is at least 4.5:1; focus is always visible; HTML
  targets and in-world hit areas on touch are at least 44 px.
- No flashing above three a second anywhere.

### E10. Saved state, privacy, observability

- Saved in the visitor's own browser only: settings (sound, motion,
  quality), what they have discovered, the Button's rung and count. The
  layout of loose parts is not saved.
- No analytics, no cookie, no network request carrying anything a visitor
  did or typed.
- For playtests, `?playtest=1` keeps a timestamped log of interactions in
  memory and offers it as a file at the end. It is never sent anywhere.
- `?debug` shows frame time, draw calls, body count, tier, and the undo
  stack.

### E11. Build and deployment

- `main` builds in GitHub Actions: install from the lockfile, build, run
  `verify`, upload, deploy to Pages. The Node version is pinned.
- `CNAME` is emitted at the root of the output.
- The `rewrite` branch is not pushed, so until the cutover the same script
  runs locally and is the gate.
- Rollback is written in § Cutover before it is needed.

## F. Content migration

### F1. Page by page

| today | at the cutover |
|---|---|
| **`/` hero**: "Software that runs small businesses", two product cards | Replaced by the stage and the strip. The page's first lines of HTML say who he is and that he builds and runs Patchlamp. Title and description become person-first; wording is Taylor's. |
| **`/` Patchlamp band** (`#patchlamp`): lead, three bullets, a price line, two links, the exchange-room picture | In the world: the Patchlamp station and its hatch. In the paperwork: a `#patchlamp` section with the brand's position sentence (`Position::SENTENCE`), the three bullets if each still has its `CLAIMS.md` row, the picture, and links to patchlamp.com and patchlamp.com/pricing. No price typed. |
| **`/` services teaser** (`#services`): two cards with prices | In the paperwork: the same two cards, text and prices read from the one file `/ai/` uses. Not in the 3D world in release 1. |
| **`/` about** (`#about`): two paragraphs, the photograph, the résumé link | In the paperwork: the two paragraphs and the real photograph, updated only where the site's description of itself changes. Not in the 3D world until the desk arrives. |
| **`/` contact** (`#contact`): GitHub, LinkedIn, email | The strip, the mailbox, and the paperwork's contact section. Email stays `mailto:`; there is still no form. |
| **Footers**: the "plain files, edited by asking Claude" line | The line stops being true at the cutover and is replaced with one Taylor approves about how this site is built. Footer links to Privacy, Terms and SMS stay on every page. |
| **`/resume/`** | Carried whole into the Paper layout: about, the three figures, four skill groups, eleven project cards, three roles, contact. Skill icons are served from this site. A print stylesheet is added. The corrections in § 1 are applied once ruled on. Its unclosed section is fixed. |
| **`/ai/`** | Carried whole into the Paper layout: every sentence, every price, every `mailto:` subject, every anchor. Out of the main navigation, linked from the paperwork and the footer. Its Patchlamp panel is re-read against `CLAIMS.md` and `Prices.php` at the cutover (§ 3). |
| **`/privacy/` `/terms/` `/sms/` `/career-send/`** | Each page's `.legal` wrapper is copied from `main` into `legal-reference/` and served unchanged inside the Paper layout; § E8's two checks guard it. The page furniture around the wrapper (nav, footer) is the site's shared one. Tap targets are fixed in the layout's CSS, not in the text. A change of wording follows § E8 and § Decisions. |
| **`assets/`** | Old paths keep answering. A new share card (the bench, with the name) replaces `og.png` at the cutover, with his word. |
| *(new)* **`/404.html`** | A plain page: a machine that is not there, and the four links. |
| *(new)* `sitemap.xml`, `robots.txt`, canonical links, `Person` structured data on `/` and `/resume/` | The sitemap lists only indexable pages. |

### F2. Where each kind of content lives in release 1

| content | in the workshop | in conventional HTML |
|---|---|---|
| His name and role | the sign | the strip, the paperwork, every page title |
| Patchlamp | a station played with; its hatch | paperwork section; `/resume/#patchlamp` |
| Other projects | crates that open | `/resume/#projects` |
| Work history | the shipped pallets | `/resume/#experience` |
| Skills | the tool wall (eight) | `/resume/#skills` (all) |
| How he works | the crew, the lanes, the lever; the maker's plate | the paperwork |
| Services and prices | (not in release 1) | `/ai/`; paperwork section |
| About him | (not in release 1) | paperwork section, with the photograph |
| Contact, résumé, GitHub, LinkedIn | mailbox, clipboard | the strip, on screen at all times |
| Legal | (none) | footer links on every page; the line under the stage |

### F3. The toy truth table

Each toy behaviour, the real behaviour it stands for, and where that is
recorded. A row with no source does not ship. Rows for arrivals are written
when those machines are specified.

| the toy | the real thing | source |
|---|---|---|
| A text changes the storefront and a reply comes back | The owner texts; Patch makes the change, checks it is live and texts back | `CLAIMS.md`, hero rows |
| The toy takes seconds | "Usually in a minute"; the hatch says the toy is sped up | `CLAIMS.md` "Usually in a minute" |
| "Undo that" puts it back | The same | `CLAIMS.md` "Undo that last change" |
| Patch opens one drawer per jack and refuses what is outside it | It works inside a walled-off folder that holds only that client's things | `CLAIMS.md` "Works inside a walled-off folder" |
| An unparsed text is pointed at Taylor's mailbox; nothing is claimed sent | Out-of-scope asks are passed to Taylor | `CLAIMS.md` "Out-of-scope asks" |
| Patch says it is Claude wearing a name tag | The same | `BRAND.md` § The name |
| The phone is scripted; no model is called | Said plainly in the hatch: this is a toy; the real Patch runs Claude Code | this file |
| Robots stay in their lanes; changes can be undone | How he builds with agents: permissions, versioning | `profile.md` § Positioning; wording for Taylor |
| Pallet labels and crate stencils | Roles, employers, dates, project names as published | `/resume/` |

The belt, the striker and the dock claim nothing. They are there because
they are fun.

## G. Releases, phases and gates

### Release 1: a small workshop, finished

**The world.** The compact bench, the lamp, the sign, the window, two
reserved bays.

**The crew.** Fetch, Revert, Patch.

**What can be used.**

- The Big Red Button, rungs 1 to 4.
- Patchlamp: the switchboard with four live jacks (STOREFRONT, PLATEN,
  BELT, LAMP), the cord, the phone, the platen, the storefront.
- The belt with its dial and lever, the striker, the dock, the return
  chute.
- The UNDO lever.
- The tool wall, eight tools.
- The shipped pallets; crates that open.
- The mailbox and the résumé clipboard.
- Two hatches: Patchlamp, and the maker's plate.

**What ties it together.** X1, X2, X3. The house tune.

**Around it.** The strip, the paperwork, the controls list, three tiers,
settings. Every conventional page of § F1, and the 404.

That is thirteen interactions and fifteen things to discover (§ B2). It is
the default, not a fallback. If G2's testers find it thin, the answer is
Taylor's to choose at that gate: pull the first arrival forward, or
deepen what is there.

**Not in release 1, on purpose.** Everything in the arrivals table.

### Arrivals, in the reserved bays

Each ships alone, when it is finished to the standard, through its own
small version of the gates: its truth-table rows approved, its tests, the
budgets still held, a look check against the approved frames, and two
people who try it cold. The order is a recommendation; Taylor sets it.

| | arrival | what it adds |
|---|---|---|
| 1 | **The inspector** | Proof, the order board and order slips, stamps and tags. The dock starts refusing unchecked work (X4). The Claude Code lamp on a robot (X5): Fetch doubles its speed, the queue forms at Proof, and Proof prints "FAST IS FINE. UNCHECKED IS NOT." Completes the statement about how he works. |
| 2 | **The Patchlamp case study** | A page: the problem, the three codebases, why every transport pulls, the permission boundary, the claims file, what was measured, how it was built. Independent of the bench; can ship at any time after release 1. |
| 3 | **The ledger sorter** | Tokens fall through three tiers of bins. One bounces, an error lamp lights, and a lever sucks the month back and replays it. Built only from what `/resume/` already says; Taylor checks the toy and its hatch for anything confidential before it ships. Its output can feed the belt in size order. |
| 4 | **More Button** | The padlock, the key in Patch's drawer (Patch pockets shiny things), the last rung, special orders and a trophy shelf. |
| 5 | **The desk** | Furniture, the framed photograph, and whatever objects Taylor chooses. |
| 6 | **The jukebox** | Sharewire: records in a shared crate, a shelf of your own, a turntable the striker's arm can swing to. |
| 7 | **Ride along, and the real time of day** | The camera on Fetch's shoulder; the window's light follows the clock in Utah; a blind with a cord. |
| 8 | **The Artificer bench** | Two slots, a foreman robot that delegates, and a second job refused with a BUSY lamp, because that is what the real one does. |
| 9 | **The machine under the sheet** | Plateful: three little shop windows, one machine, and a gate that will not let an order into the wrong one. Past tense, no links. |
| 10 | **Hold to rewind** | Hold the UNDO lever and the last twenty seconds of the whole bench run backwards. |
| 11 | **Small furniture** | A services window with a bell; a filing cabinet; a ticker tape that prints this repository's real commit subjects; a dial marked GRAVITY. |
| 12 | **Drive Fetch** | Only if people keep trying to. |
| 13 | **Anything with a server** | A worldwide count of Button presses; measurement. Each needs a decision and wording on `/privacy/`. |
| 14 | **A real model behind the phone** | Needs a server, a budget and abuse limits. A decision, not a default. |

### Phases

Gates are G0 to G6 and phases P0 to P6. Every gate is a stop: the session
presents the evidence listed, with its *found on the way* list, and waits.
Gates marked **Taylor** need his dated line in § Approval log.

**P0. Groundwork.** *Depends on:* G0.
- Scaffold the project; pin versions; the layer folders of § E2; `verify`
  running with the URL, legal, link and budget checks against a
  placeholder site.
- Freeze `legal-reference/` and the callout copies from `main`.
- Rewrite `CLAUDE.md` on this branch to describe the new site: one manual.
  Content rules carry over unchanged; the plain-files, no-build and
  no-library rules are replaced by § E.
- **Gate (objective):** `npm run verify` passes; the built output answers
  every path of § 2; both legal checks pass.

**P1. The vignette: is code-built geometry good enough?**
*Depends on:* P0. This phase builds one slice of the bench to finished
quality and nothing else. It is the most important phase in the plan.

*The early look, within the first days.* Three objects under the lamp, as
stills: the Button on its pedestal, one crate, Fetch standing. Shown to
Taylor before anything else is modelled. It is not a gate and needs no
score; it exists so that a wrong direction costs days, not weeks. If he
winces, the direction changes before the vignette is built.

*What the vignette contains.*
- The centre cluster: the Button with its tape and its cover, a length of
  belt with rollers, a stack of three crates and one loose crate, the
  phone, the lamp.
- Fetch, complete: rig, eye, idle, roll, carry, fumble, look at pointer.
- Patch on its stool at a board with two jacks and one cord.
- A slice of back wall: the first word of the sign with its bulbs, and six
  tools on the pegboard.
- The bench edge and the fall-off into the dark room.
- Working, because a look cannot be judged frozen: pick up and throw the
  crate; press the Button (rung 1); re-plug the cord; Fetch's fumble.

*What is handed over for review.*
- Six fixed pictures: the whole vignette at 1440×900; the same on a phone
  held upright at 390×844; close views of the Button, of Fetch, of Patch;
  one frame mid-action.
- A twenty-second screen recording, and the build itself to use.
- The whole-vignette picture at 320 pixels wide, to judge silhouettes.
- The whole-vignette picture beside `assets/exchange-room-1280.jpg`, to
  judge the palette, and beside a frame of bruno-simon.com, to judge the
  league.
- The parts catalogue page.

*Gate G1, part one (objective).*
- Reference laptop, 1440×900: median frame at most 16.7 ms, 95th
  percentile at most 22 ms, over thirty seconds of interaction.
- Every mesh comes from the kit; every colour is a palette token (a check
  proves both).
- At the default view, capital letters on the sign, the DO NOT TOUCH tape
  and the station plates are at least 12 px tall on a 1440-wide screen.
- No flicker between touching surfaces and no striped shadows in the six
  pictures.

*Gate G1, part two: the visual review (Taylor).* He scores six questions
from 1 to 5, from the pictures and from using it:

1. Does it look made by hand, by someone who cared?
2. Can you tell what can be touched without being told?
3. Is it one place: one palette, one light, one hand?
4. Do Fetch and Patch have character in a still picture?
5. Would you send someone a screenshot of this?
6. Beside Bruno Simon's site, is this a different style of the same
   quality?

And two or three people who have seen nothing are shown the whole-vignette
picture for five seconds and asked: what is this, whose is it, and what
would you click first?

**Pass:** every score is 4 or 5; at least two of the cold viewers say a
workshop or factory, name him, and point at something that can in fact be
used; nobody describes it as a template, as generated, or as made of
blocks. Taylor may also fail it on instinct, with no reason given.

**Not yet:** one more round on the named weaknesses, then the gate again.
There are two attempts in all. A method that has not passed in two is not
polished further.

**No:** code-built geometry is not the method. In order of preference:
model the characters and the hero pieces in a 3D tool and keep code for
the rest; commission a kit to this spec; or change the art style to one
code does naturally, such as flat cut paper. The choice is Taylor's and
this file is revised before any more is built.

Nothing of the wider environment is produced before G1 passes. **The six
approved pictures become the standard**: every later gate compares what is
new against them, and anything below them is finished or removed.

**P2. The playable bench: do people play with it?** *Depends on:* G1.
- First, alone: the history model of § E5 with its tests, against stand-in
  machines.
- Then: the whole belt, the striker, the dock, the platen and the
  storefront, the cord with four jacks, UNDO, Revert, Button rungs 1 to 4.
- Use the real contracts of § E4 from the start, so P3 hardens this code
  and does not rewrite it.
- Measure the compressed size of the physics file and time-to-usable.
- **Gate G2 (Taylor, with numbers).** Three people who have not seen it,
  using the protocol of § I: at least two act within twenty seconds
  unprompted and use three different things within two minutes. The feel
  targets of § E0 and the frame budget hold. The transfer budget holds or
  the engine question of § E7 is decided. The look check passes. He
  confirms release 1's list, or changes it here.

**P3. The foundation.** *Depends on:* G2.
- The registry and everything hung on it: controls list, tells, saving,
  reset, the playtest log.
- Tiers, the picture-to-stage handoff, fallback, reduced motion.
- The full test suite of § E8, the soak test included.
- The Paper layout and every conventional page of § F1, from content
  files, with the corrections ruled on.
- **Gate G3 (objective).** `verify` passes with every check enabled. The
  browser tests pass in three engines. `shot design .` is clean. Each
  conventional page's visible text matches `main`'s, apart from a written
  list of intended differences.

**P4. The rest of release 1.** *Depends on:* G3.
- The tool wall, the pallets and their crates, the mailbox and clipboard,
  the two hatches, the house tune, the paperwork's content, the 404.
- **Gate G4 (Taylor reads; the rest objective).** Every item of release
  1's list exists and has a test. The look check passes. He reads and
  approves: both hatches, the paperwork, the truth table, every line the
  crew prints.

**P5. Polish.** *Depends on:* G4.
- Sound, the crew's idle behaviour, timing, the share card.
- Real phones: his own, and an older one if one can be borrowed.
- **Gate G5 (Taylor).** Every budget of § E7 holds on the full bench. The
  whole bench is compared against the approved pictures; anything below
  the standard is finished or taken out, and he says which.

**P6. Verification and launch.** *Depends on:* G5.
- The playtest of § I. Fixes. The playtest again if a threshold was
  missed.
- § Cutover.
- **Gate G6 (Taylor).** § I is met and the cutover list is complete. He
  says to merge.

## H. Risks and tradeoffs

| risk | how it shows | response |
|---|---|---|
| **The look falls short.** The largest risk. | The early look disappoints; G1 scores below 4. | The early look, then G1 with two attempts and three fallbacks. No environment is built before it passes. |
| **The small release feels thin.** | G2's testers run out of things inside two minutes. | Decided at G2: bring the inspector forward, or deepen what is there. Never by adding half-finished things. |
| **Scope grows.** | A phase needs something not in release 1's list. | It becomes an arrival. The list changes only by Taylor's edit at a gate. |
| **The spec is followed where a better idea exists.** | Something works as written and is not fun. | § What is fixed: swap it, and say so at the gate. |
| **Undo leaves the world wrong.** | A history test fails; a part is in two places or nowhere. | § E5 is built first and alone, with generated tests, before any machine depends on it. |
| **The physics file is heavy.** | Stage transfer over 2.2 MB or usable later than 6 s throttled. | Decided at G2: accept and raise the budget, or swap the engine behind the adapter. |
| **Phones.** | Dragging fights panning; things are too small. | The centre cluster, tap-then-tap carrying, 44 px hit areas, real devices in P5. |
| **A recruiter in a hurry is slowed down.** | The résumé takes more than one click or ten seconds. | The strip, from first paint. Tested in § I. |
| **A toy says something untrue.** | A behaviour has no truth-table row. | The row is a build requirement. |
| **The crew upstages the visitor.** | Testers watch instead of acting, or are interrupted. | The rules at the top of § B5; tuned in P5. |
| **The legal pages drift.** | A legal check fails. | Both checks are in `verify`; the build does not pass. |
| **`main` moves under the branch.** | The career workspace lands a change on the old files. | § 4, and the cutover list. |

**Deliberately not built.** A walking avatar as the main way in. Free
camera orbit. A free-text box as the only way to instruct Patch. A tool
that changes a machine's behaviour (thirty tools times every machine).
Several deep simulations at launch. A contact form. Any tracking. Licensed
music. More than one room.

**Shortcuts that keep the quality.**

- One fixed camera angle means only one side of anything needs to be good.
- One robot rig serves every robot. Patch never leaves the stool.
- Machines are scripted; only loose parts are simulated.
- Undo restores recorded values; nothing needs inverse code.
- A crate opens to one standing card, the same mechanism for all of them.
- The Button's rewind builds the recording that hold-to-rewind will need.
- Text is label tape: a texture, no 3D lettering.

**If something in release 1 is not at the standard by G5,** it is taken
out, in this order of least loss: the house tune; the clipboard (the strip
covers it); the BELT jack; the standing cards (crates then open straight
to the résumé card). The Button, Patchlamp with the cord and the lamp, the
belt with the striker and the dock, UNDO, the tool wall, the pallets and
the mailbox are the release; without them it is not ready.

## I. Definition of done

Release 1 is done when all of the following are true.

**People play with it, unprompted.** Measured by watching, not by
counters.

- *Who:* at least five people who have never seen it; at least two who do
  not work in software; at least two on a phone.
- *How:* they are given the address and one sentence: "This is someone's
  website. Have a look." Nothing else is said. The observer notes times, or
  the tester opens the address with `?playtest=1` and the log is saved.
  After three minutes, or when they stop, they are asked to find his
  résumé, and then: what was that, and whose?
- *Thresholds:*

| what is measured | pass |
|---|---|
| Time to the first deliberate action on something usable | 20 s or less for at least 4 of 5 |
| Different things used in the first 2 minutes | 3 or more for at least 4 of 5 |
| Reached a chain of consequences (one action causing a second machine to act) | at least 4 of 5 |
| Carried on past 2 minutes without being asked, or said they wanted to | at least 3 of 5 |
| Stalled for more than 15 s saying or showing they did not know what to do | nobody |
| Found the résumé when asked | 10 s or less, all 5 |
| Said whose site it is and roughly what he does | at least 4 of 5 |

- A missed threshold is fixed and tested again with new people.
- Worth writing down, though not a threshold: anyone who pressed the Button
  a second time, laughed, or showed the screen to someone else.

**It looks the part.** The whole bench holds the standard of the pictures
approved at G1, by Taylor's eye at G5.

**It is fast and it holds.** Every budget of § E7 and every feel target of
§ E0, measured, on the full bench. The soak test and the history tests
pass.

**It works without the stage.** With WebGL refused, with JavaScript off,
with reduced motion, by keyboard alone and with a screen reader, a visitor
can learn who he is, read about the work, and reach the résumé, the
services, the legal pages and the contact links.

**Nothing was lost.** Every path of § 2 answers. Both legal checks pass.
`/ai/`'s prices and `mailto:` subjects are identical. Each conventional
page's text matches `main`'s except for the written list of intended
differences. `main`'s changes since `fa99b13` are carried across.

**Every claim is true.** The truth table has no empty source. Taylor has
read both hatches, the paperwork and every line the crew prints.

**The repository shows the same care.** `verify` passes from a clean
checkout with one command. `CLAUDE.md` and `README.md` describe what is
there.

## J. Builder handoff

**Before anything.** Check § Approval log. Without a dated G0 line, do not
build: no scaffold, no dependency, no asset. Reading and planning only.

**What matters most, in order.** § The point. Read it before each phase.
A phase that passes its checks and is not a pleasure to use has not
succeeded; say so at the gate.

**How to work.**

- Phases in order. Each gate is a stop: present the evidence the gate
  lists and the *found on the way* list, and wait. A gate marked Taylor is
  passed only by his line in the log.
- Finish before starting. A station is taken to the standard before the
  next one is begun.
- Branch `rewrite`, local. Do not push it. `git pull --ff-only` on `main`
  at the start of each session and bring `rewrite` up to it.
- Small commits with plain messages.
- Read the current documentation for Astro, Three.js and Rapier before
  using them.
- Facts come from the files in § 4. A fact that is not there gets a source
  or does not appear.
- Decide alone: structure, naming, signatures, tuning, swaps as defined in
  § What is fixed. Bring to Taylor, batched: growth; anything that changes
  how his experience is represented; any wording on a legal page; any
  Patchlamp sentence; anything about his employer; any new runtime
  dependency; any budget that cannot be met.
- If this file turns out to be wrong, correct it in the same commit as the
  work and say so at the next gate. The plan and the code never disagree.

**Milestones, in dependency order.**

| | milestone | needs | done when |
|---|---|---|---|
| M0 | Scaffold and checks | G0 | P0's gate |
| M1 | The early look, then the parts kit and the vignette | M0 | G1, both parts |
| M2 | The history model, tested alone | M0 | every § E5 test passes against stand-in machines |
| M3 | The playable bench | M1, M2 | G2 |
| M4 | Registry, tiers, fallback, accessibility, saved state | M3 | the browser tests pass in three engines |
| M5 | Conventional pages from content files | M0 (may run alongside M2 to M4) | the text-parity and legal checks pass |
| M6 | The rest of release 1 | M4, M5 | G4 |
| M7 | Polish | M6 | G5 |
| M8 | Playtest, fixes, cutover | M7 | G6 |

**Who owns what.** The table in § E2. The one rule not to bend: `sim` never
imports from `view`, `ui` or the browser.

**What to run.** `npm run verify` before every commit that claims a
milestone. `npm run perf` at G1, G2 and G5. `shot check . --all` and
`shot design .` at G3 and G6. `shot` pictures for every review packet.

**Out of scope for the building session, whatever seems convenient.** Any
arrival. Any server. Any analytics. Editing a `legal-callout`. Editing the
rest of a legal wrapper without the approved-edit commit of § E8. Editing
`CNAME`. Pushing the branch. Changing a price. Writing a personal detail
about Taylor that he has not supplied.

---

# Part 3 — Closing

## Decisions

**Needed to approve G0: one.**

- **Release 1 as listed in § G.** In particular that it opens without the
  inspector, the jukebox, the desk, the services window and the standalone
  case-study page, each of which is an arrival.

**Needed later, each at its gate. None blocks G0.**

| by | decision | recommendation |
|---|---|---|
| G1 | The look: the six scores; final palette and type | (his eye) |
| G2 | Whether release 1's list stands after people have played it; the sound default; the physics budget | Stands; quiet effects on from the first click; accept Rapier if usable inside 6 s throttled |
| G3 | **`/privacy/` and the fonts.** Serving the fonts from this site (which the audit asks for) makes the page's Google Fonts sentence untrue. Either (a) serve them from this site and approve one edit to the record: that bullet removed, one sentence added that the workshop keeps settings and progress in the visitor's own browser and sends nothing, and a new effective date; or (b) keep loading from Google Fonts and change nothing. | (a). The callouts are untouched either way. The words and the date are his; Twilio's reviewer reads this page. |
| G3 | **Three sentences on the live site** (§ 1). | The macro is a wrong fact and can be corrected on `main` at any time; the figure's wording and the price line are his to rule on. |
| G4 | **What the workshop says about how he builds**: the table in § B5 and the maker's plate saying this site was built by him with Claude. | Each must be true of his practice and of this build; he approves the exact words. |
| G4 | **The crew's names.** Fetch and Revert are working names. `BRAND.md` shows his real crew already has names for some jobs. | Use the real ones if he is willing to make them public; otherwise keep these. |
| G6 | **How playtesters reach it before the cutover.** | Tailscale Funnel from this machine for remote testers, his own laptop for people in the room. The branch stays unpublished. |
| after | The order of arrivals; the desk's objects. | The inspector first. |

## Cutover (one merge, when G6 has passed)

- Every path in § 2 answers 200 in the served output, including `/resume`
  without the slash and the unlinked `/career-send/`.
- `main`'s compliance pages on the day are compared with
  `legal-reference/`. Every difference is either an edit Taylor approved
  here, or a change that landed on `main` and is carried across. Nothing
  else. The callout blocks are identical.
- `main`'s changes since `fa99b13` are carried across.
- Every Patchlamp sentence on the site is re-read against `CLAIMS.md` and
  `Prices.php` as they stand that day.
- `npm run verify`, `shot check . --all` and `shot design .` are clean, or
  each remaining item has a stated reason.
- `CLAUDE.md` and `README.md` describe the new site; `REDESIGN.md` and
  this file are marked as the record.
- The Pages source switches to GitHub Actions in the same step as the
  merge. Rollback, written before it is needed: revert the merge commit on
  `main`, switch the Pages source back to "Deploy from a branch" (`main`,
  root), and confirm `/`, `/resume/` and `/sms/` answer.
- The new share card replaces `assets/og.png`.
- For Taylor to pass on, since they are other workspaces' files: the repo
  description ("plain HTML/CSS on GitHub Pages"), `~/projects/CLAUDE.md`'s
  map row and `~/projects/patchlamp/BRAND.md`'s "studio site, Patchlamp
  first" line stop being true at the cutover. The career workspace needs
  to know where résumé content now lives (`src/content/`).

## Approval log

| gate | what it approves | date | by |
|---|---|---|---|
| G0 | This specification; building may begin at P0 and stops at G1 | 2026-11-17 | Taylor: "I am authorizing G0 and the start of implementation." Not authorised by this line: deploying, pushing the branch, changing production, or passing any later gate. |
| G1 | The look; the method for producing the rest of the bench | | |
| G2 | The bench plays; release 1's list confirmed | | |
| G4 | Both hatches, the paperwork, the truth table, the crew's lines | | |
| G5 | The whole bench holds the standard | | |
| G6 | Release 1 is done; merge | | |
