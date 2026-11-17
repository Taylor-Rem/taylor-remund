# REWRITE — taylorremund.com, the workshop

**Status: draft 2, for review (2026-11-17). Nothing is built, and nothing in
this file authorises building.** Work starts when § Approval log carries a
dated line from Taylor against gate G0. Branch `rewrite`, local only. `main`
is the live site and stays untouched until the cutover.

Taylor, 2026-11-17: "I don't want a better résumé website. I want an
unforgettable interactive experience that happens to contain my résumé."

This file is the plan a session executes, as `REDESIGN.md` was for the last
one. It replaces the first draft of this file (commit `caf9c95`), which
planned a case-study site; § 0 records what was kept and what changed.
`CLAUDE.md` still describes the live site and is rewritten on this branch in
phase P0, after approval. Until then: about the *future* site this file wins;
about the *live* site `CLAUDE.md` does.

**How to read it.** Taylor: § Open decisions first, then A to D, G and I.
A building session: all of it, then start at § J.

| Part | Sections |
|---|---|
| 1. Ground | § 0 Record · § 1 What exists · § 2 What must survive · § 3 Rules that hold · § 4 Raw material and the other writers |
| 2. Specification | A Creative direction · B Experience design · C World layout · D Interaction inventory · E Technical architecture · F Content migration · G Releases, phases and gates · H Risks and tradeoffs · I Definition of done · J Builder handoff |
| 3. Closing | Open decisions · Cutover · Approval log |

**Words used in this file.**

- **Bench**: the tabletop the whole workshop stands on. **Stage**: the
  full-window 3D view of it on `/`.
- **Station**: a named area of the bench with one machine and one camera
  framing.
- **Part**: any loose object a visitor can pick up (a crate, a tool, a
  record, a robot).
- **Mouth**: where a machine takes parts in (a tray, a belt, a pad, a door).
  **Verb**: the one thing a machine does to whatever is in its mouth.
- **Handle**: anything fixed that is worked in place (a button, lever, dial,
  plug, drawer).
- **Jack**: a socket on the switchboard; one per station.
- **Order**: a paper slip describing something to make and ship.
- **Hatch**: a brass plate on a machine that opens the real project's facts.
- **Tell**: a small idle motion that hints an untouched thing can be used.
- **Rung**: one step of the Big Red Button's escalation.
- **Paperwork**: the plain HTML document on `/`. **Strip**: the always
  visible HTML bar with the name and the four links.
- **Release 1**: what is live at the cutover. **Expansion**: anything after.

---

# Part 1 — Ground

## 0. Record: how this plan got here

The first draft (`caf9c95`, 2026-11-17 morning) planned a bigger conventional
site: Astro, one case study per project, a section on working with agents.
The same day Taylor brought the workshop brief and an assessment followed.
This draft reconciles the two. Nothing from the first draft was dropped
without a line here.

| First draft | Now |
|---|---|
| § What exists, § What must survive, § Raw material, § The other writers, § Cutover | Kept, corrected where today's reading found more (§ 1 to § 4, § Cutover). |
| Decision 1, the site is about Taylor as an engineer | Confirmed by the brief: "The homepage should primarily sell the person and his capabilities, not lead with a price list." |
| Decision 2, Astro with static output | Kept. Taylor, 2026-11-17: "I'm approving the change to a proper build system as part of the proposed architecture, but not authorizing implementation yet." |
| Decision 3, launch with case studies and a section on how he works with agents | Superseded. The workshop is the centrepiece. One Patchlamp case study ships with release 1 (the gap the first draft named, "no page goes deeper than a card", is still real). How he works with agents is carried by the crew (§ B5) and by a section of that case study. More case studies are expansions. |
| Decision 4, cookieless measurement, recommended yes | Answered no for release 1. Taylor: "Unprompted playtesting is sufficient ... We can revisit telemetry later." So `/privacy/`'s "no analytics" sentence stays true and § I measures by playtest. |
| Decision 5, `/ai/` stays with its prices, restyled, out of the main navigation | Unchanged. |
| Decision 6, the branch stays local | Unchanged. |

Rulings by Taylor on 2026-11-17, in conversation, that this spec is built on:

- One central interaction mechanic, not a set of minigames. Grab anything
  loose, feed it to any machine: accepted, and pushed further: "If most
  combinations simply return REJECTED, the novelty will wear off quickly ...
  I want experimentation to be genuinely rewarding." (§ B1, § B2)
- Robots as his agents, and work orders, inspection and undo as the
  workshop's personality: accepted. (§ B5)
- The Big Red Button "should be prominent and irresistible, but its sequence
  shouldn't overwhelm the visitor or reveal everything immediately." (§ B4)
- Code-built geometry is the first approach, and "visual quality is
  nonnegotiable. The prototype vignette must pass an explicit visual review
  before we commit to producing the rest of the environment that way."
  (§ G, gate G1)
- No analytics in the initial release.
- The synthetic ledger toy is "approved conceptually, provided it exposes no
  confidential employer information."
- "Patch the raccoon can absolutely make an appearance."
- The desk's personal objects are chosen separately. "The Viking ship is a
  definite possibility, but don't invent personal details."

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
  certificate covers the apex and `www` (checked again today through the
  API: `build_type` legacy, no custom 404). DNS is at Porkbun. Pages cannot
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

Found in today's reading, and not in the first draft:

- `/resume/` also makes third-party requests: its skill icons load from
  `cdn.simpleicons.org` (`resume/index.html:75-118`).
- `/resume/`'s first section is never closed before the skills section
  opens (`resume/index.html:64-67`). The migration fixes it.
- `/privacy/` says of this website: "does not use analytics, advertising,
  cookies, or tracking of any kind. There is no login and no form." It also
  says the typefaces load from Google Fonts. Both sentences bind the
  rewrite: see § Open decisions 3.
- `/privacy/`, `/terms/` and `/career-send/` carry
  `<meta name="robots" content="noindex, follow">`; `/sms/` does not.
- patchlamp.com links to this site three times, always to the bare
  `https://taylorremund.com` (grep of `~/projects/patchlamp`, 2026-11-17).
- This machine is a fair performance reference: integrated AMD Radeon
  (Cezanne), Chrome, Playwright's Chromium, and `shot`.
- Sentences on the live site that today's reading could not square with the
  sourced facts. They are for Taylor to rule on (§ Open decisions 5); the
  rewrite carries the corrected wording, not the old one.
  - `resume/index.html:161` calls Artificer's `define_agents!` a "procedural
    macro"; `~/career/facts/projects/artificer.md` records it as
    `macro_rules!`.
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
| `/privacy/` `/terms/` `/sms/` | Twilio's 10DLC campaign lists these URLs | The whole `.legal` wrapper verbatim, the `legal-callout` blocks inside it included. `/sms/` shows the service number, the consent/STOP/HELP/rates language, and links the other two. Every page's footer links all three, the stage on `/` included. Each page keeps the robots meta it has today. |
| `/career-send/` | the Career Send Google app lists it as its privacy policy; no page links to it, on purpose | The Limited Use wording. Easy to lose: a crawl of the site does not find it. It stays unlinked, out of the sitemap, with its `noindex`. |
| `/assets/og.png`, `/assets/taylor.jpg`, `/assets/exchange-room-*` | link previews already cached elsewhere; patchlamp's brand | The paths keep answering. The share card's picture changes at the cutover, with his word. |
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
  repositories he keeps public. The ledger toy uses invented tokens and
  shows nothing the résumé page does not already say.
- A change in how his experience is represented waits for his yes. A
  correction of a wrong fact does not.
- Plateful is retired: past tense, no links, nothing that sells it.
  "Plateful LLC" appears only as the legal entity.
- No Patchlamp price is typed on this site beyond what he approves at the
  cutover; the recommendation is none at all, with a link to
  patchlamp.com/pricing (§ F1). The `/ai/` service prices are not touched.
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
  Patchlamp brand image. The workshop replaces most of the need; the case
  study still needs diagrams drawn and screenshots taken with `shot`.
- **3D assets: none.** No models, no Blender on this machine. § G gate G1
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

## A. Creative direction

**In one sentence.** A working miniature factory on a workbench, lit by one
lamp and staffed by three robots and a raccoon, where anything loose can be
picked up and every machine does something to whatever it is fed.

**The fiction.** The workshop ships software. Orders arrive as paper slips
on the left, things get built in the middle, they are checked, and they
leave by the dock on the right. That is how Taylor works: he writes the
order, agents build inside marked lanes, nothing ships unchecked, and
anything can be undone. The visitor is the foreman for as long as they stay.

**What makes it his, and not a tribute or a template.**

1. **The toys are true.** Each machine is a miniature of something he
   built and behaves the way the real thing behaves, quirks included (§ F3).
2. **The crew is his method.** Robots that do the work, lanes they cannot
   leave, an inspector who cannot be hurried, a lever that takes back the
   last change. No other 3D portfolio can show this, because it is a fact
   about him.
3. **The lamp and the switchboard are already his.** Patchlamp is named for
   the lamp that lights on a switchboard when a line is connected and an
   operator is on it. In the workshop every station has a lamp, and a lamp
   lit means someone is on it.
4. **A workbench, not a room.** The cut-away isometric bedroom is the most
   copied shape in 3D portfolios. This is a long bench seen from the front
   and a little above, like a model railway layout, with the dark of the
   room beyond its edge.
5. **It talks in label tape.** No floating cards in the 3D world.

**Palette.** Taken from the exchange-room picture. These are starting
values; gate G1 fixes them, and after G1 a material may use no other colour.

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
| `paper` | `#efe6d2` | slips, orders, labels' text, the paperwork pages |
| `ink` | `#1a1c1e` | text, rubber, the belt |
| `cable-red` | `#8f2f2a` | patch cords, the inspector's tags |
| `button-red` | `#d6322b` | the Button and nothing else |
| `tape-yellow` | `#e3b21c` | lane tape on the bench |
| `steel` | `#7d8790` | rollers, rails, tools |

**Light.** One key light, the lamp, warm, from the upper back left. A dim
cool fill from the window. The bench is bright; the room falls away into
`teal-deep`, never pure black. Shadows are soft and present under every
object. Only bulbs and indicator lamps glow.

**Materials and form.** Painted steel with worn edges, brass, oiled wood,
rubber, paper. Every edge is bevelled; no part is a raw cube or cylinder.
Shapes are chunky and a little exaggerated, the way a toy is.

**Text in the world, three registers.**

- *Label tape* (embossed white capitals on black, red or blue tape):
  Taylor's voice. `DO NOT TOUCH`. `RETIRED 2026`. `RESERVED: SORTER`.
- *Crate stencil*: facts. Project names, employers, dates.
- *Paper slips* in a monospaced face: the crew's voice, orders, receipts,
  the inspector's tags.

**Type on the HTML pages.** Recommended: IBM Plex Sans for reading, IBM
Plex Mono for labels and data, one stencil display face for the name only;
all self-hosted, all open licences. This drops Inter and Space Grotesk,
which is the most common pairing on generated sites. The choice is
confirmed at G1 with the rest of the look.

**Motion.** Mechanical and weighted. Things anticipate, overshoot a little
and settle. A press answers within 100 ms. Nothing fades or floats in the
way an interface does.

**Sound.** Thunks, clicks, a bell, the belt's hum. Every part has its own
note (§ B1), so the workshop is quietly musical before anyone finds the
jukebox.

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
   And whatever it did can be taken back at the UNDO lever.

**Why the combinations stay rewarding.** Machines do not know about kinds
of part. They read and write a small set of properties that every part
has. So any part in any machine produces a real result with no
pair-by-pair scripting, and the order in which machines are visited
matters. The written surprises of § B2 sit on top of that floor.

| property | values | seen or heard as |
|---|---|---|
| kind | crate, tool, record, token, slip, robot, prop | its shape |
| colour | the 8 paint colours | its paint |
| label | up to 16 characters | label tape on its side |
| size | S, M, L | its bulk, its weight, and its pitch (large is low) |
| material | wood, metal, paper, rubber, brass | its timbre when struck, its bounce |
| stamps | APPROVED, tags from the inspector, shipping marks | ink on it |
| contents | none, or one of the shipped systems | a latch on the lid |
| lit | on, off | a small lamp clipped to it |

Machines and their verbs in release 1:

| station | mouth | verb on any part | reads | writes |
|---|---|---|---|---|
| Patchlamp platen | the tray under the nozzle | changes it by text | the instruction | colour, label |
| The belt | its whole surface | carries it, at the speed and direction set | size | position |
| Jukebox arm | under the arm when it is swung over the belt | plays it | size, material | nothing (sound) |
| Inspection pad | the pad at Proof's bench | checks it against the open orders | every property | stamps |
| Dock | the roll-up door | ships it if it is stamped | stamps | removes it; UNDO brings it back |
| Bench edge | anything that falls off | returns it by the lost-and-found chute | nothing | position |

Every action a visitor takes is recorded as a command with an inverse.
That one record gives UNDO, the reset after the Button, saved progress, and
scripted tests (§ E4).

**The feedback grammar**, the same everywhere:

| event | what happens |
|---|---|
| pointer over something usable | it lifts a hair, the cursor becomes a hand, its station lamp brightens |
| picked up | it rises, its shadow separates, it sounds its own note |
| handle worked | visible travel, a click, the consequence inside 100 ms |
| verb succeeds | a bell, the station lamp goes steady amber |
| verb cannot apply | a paper slip naming what it wanted, the lamp blinks twice; never a red cross |
| undone | a tape-rewind sound and the motion run backwards |

### B2. Cross-machine interactions

Five in release 1. X1 and X3 are part of the smallest release that may
ship. X2, X4 and X5 are in release 1 unless they are cut in the order § H
gives.

**X1. Re-patch the cable (switchboard × every station).**
The phone talks to whatever the cord is plugged into. Each station has a
jack and a lamp on Patch's board. The cord starts in STOREFRONT. Drag its
plug to another jack and the same phone now instructs that station:

| jack | what a text can change |
|---|---|
| STOREFRONT | sign colour, sign words, awning colour, open or closed, a photo in the window |
| PLATEN | colour and label of whatever part is on the tray |
| BELT | faster, slower, stop, go, reverse |
| JUKEBOX | play, stop, next, louder, quieter |
| DOCK | open, close |
| LAMP | brighter, dimmer, a colour, off, on |

"Make it blue" into LAMP turns the light of the whole workshop blue. "The
lamp's off" leaves the bench lit only by the board's indicators and the
robots' eyes. Every jack answers "undo that", "help" (it lists what it can
change here) and "who are you". An instruction for something the cord is
not plugged into gets the true answer: "That's outside this folder. Plug
me into it first." That is Patchlamp's boundary, felt in the hand. Anything
Patch cannot parse gets: "That one's for Taylor. His mailbox is over
there," and the mailbox flag goes up. The toy never claims a message was
sent.

**X2. The line is a music box (belt × jukebox arm × size).**
Swing the jukebox's arm over the belt and every part that passes under it
sounds its note: pitch by size, timbre by material. The belt's speed dial
is the tempo and its direction lever plays the tune backwards. Line parts
up small to large and it plays a scale. Shuffle them and it does not. Fetch
bobs in time; Proof taps its stamp on the beat and stops, pointedly, when
the rhythm is uneven. A sheet pinned by the jukebox shows five sizes in a
row: the house tune. Play it and a drawer in the jukebox opens with a new
record (§ D, item 16).

**X3. Undo reaches everything (UNDO lever × every station).**
One pull takes back the visitor's last change, wherever it was: paint
drains back up the nozzle, a label peels off, a part hops back to where it
was resting, a shipped crate comes back in through the dock door with a
reversing beep, the light returns to amber. Pull again to go further back
(30 steps). With nothing left: "NOTHING LEFT. IT'S ALL AS I FOUND IT."

**X4. Orders and inspection (order board × platen × Proof × dock).**
The board holds order slips ("ONE BLUE CRATE, LABELLED TACOS"). Proof
checks whatever reaches its pad against the open orders. A match gets
APPROVED and the dock opens for it. A miss gets a red tag that says what
was wrong: "EXPECTED BLUE. GOT RED." The tag is the hint. A part that
matches no order gets "NOT ON AN ORDER" and the nearest open order is
turned to face the visitor. Unstamped parts do not leave: the dock stays
shut and they roll into a bin marked UNCHECKED. Every third order filled
puts up a special order that points at a combination the visitor has not
tried yet (§ D, item 10). Specials leave a small trophy on the shelf.

**X5. The lamp on a robot (tool wall × crew × inspection).**
The tool labelled CLAUDE CODE is a small work lamp. Clip it to Fetch and
Fetch works at double speed for thirty seconds: crates pile up at the
inspection pad, because Proof does not check any faster. Proof's slip:
"FAST IS FINE. UNCHECKED IS NOT." Clip it to Proof and it inspects at the
same pace under a better light. Clip it to Revert and it sweeps at double
speed. Offer it to Patch and Patch points at its own name tag: "ALREADY
ON." This is the workshop's one direct statement about AI-assisted work;
its wording is Taylor's to approve (§ Open decisions 4).

Planned with expansions (§ G, After release 1): the sorter feeding the belt
in size order so the scale plays itself (EXP1), a gate that swats an order
out of the wrong restaurant's window (EXP5), and hold-to-rewind for the
last twenty seconds (EXP6).

### B3. The first thirty seconds

No instruction text appears at any point. Every cue is something in the
world.

| time | what the visitor sees | what makes it happen |
|---|---|---|
| before JavaScript | The strip (name, role, four links) and a still picture of the bench, dim. | Plain HTML and one image. This is also the whole experience for a browser that cannot run the stage. |
| loading | The picture brightens as the lamp "warms up". No spinner, no bar. | Brightness follows load progress. |
| 0 s | The picture becomes the live bench with no jump. The belt is moving, Fetch is carrying a crate to the platen, Patch is plugging a cord, the sign reads TAYLOR REMUND. | The still is rendered from the same camera and the same starting state the live scene begins in. |
| 0 to 3 s | Whatever the pointer passes lifts a hair. Fetch's head follows the pointer. | Law of feedback, § B1. On touch, the things nearest the first touch wobble. |
| about 4 s without input | Fetch fumbles its crate. It tumbles forward and stops, rocking, beside the Big Red Button. Fetch looks at the crate, then out at the visitor, and holds out its hands. | Triggered by inactivity, not by the clock. Two obvious things to do are now side by side: hand the crate back, or press the button. |
| first touch | The crate lifts and sounds its note. Dropped on the belt, it rides under the arm, is checked by Proof, and ships or comes back tagged. Or the Button's first rung plays (§ B4). | Either choice gives a chain of consequences inside fifteen seconds without any intent to find one. |
| after the first consequence | The lamp of the nearest untouched station blinks once; later its lid rattles or its drawer inches open. | A tell. One at a time, nearest first, every twelve seconds of inactivity, never while the visitor is busy, and none after six discoveries. |
| always | The ambient loop keeps running: Fetch takes an order, carries a crate to the platen, texts Patch, the crate changes, the belt, the note, the stamp, the dock. About thirty seconds a lap. | The crew demonstrates every core action over and over, so a visitor who only watches still learns what can be done. Anything in the loop can be taken out of a robot's hands. |

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
| 5. The padlock | Revert padlocks the cover and drives off with the key. The key ends up in Patch's drawer, because Patch pockets shiny things. Trading Patch a token for it, or opening the drawer while Patch is busy, gets it back. | (none; Revert just looks) |
| 6. FINE. | Unlocked and pressed: five seconds in which the lamp runs through its colours, every part sounds its note in a rising run and the crew takes a bow. Then the button is swapped for a small one labelled FINE. that only goes *boop*. A plate beside it counts the presses. | FINE. |

Constraints on every rung:

- The visitor's own arrangement is never lost: the bench is recorded for
  the length of the rung and played back in reverse at the end.
- No flashing faster than three times a second, and no full-screen flash at
  all. With reduced motion, a rung is the card and the lamp dip only.
- The camera does not move by itself beyond a small shake, and not at all
  with reduced motion.
- The rung reached is remembered between visits. "Reset the workshop" in
  the settings starts over.

### B5. The crew

Three robots and Patch in release 1. They share one rule: **the visitor
always comes first.** A robot's reaction lasts at most a second and a half,
only one of them does anything attention-seeking at a time, and none of
them repeats a line twice running.

The working names below are placeholders: § Open decisions 6.

**Fetch, the runner.** One wheel, one round eye, a flag on an aerial. It
carries orders and parts between stations inside lanes of yellow tape.

- *Temperament:* eager and too fast. It overshoots every stop and skids.
- *With the visitor:* watches the pointer. Holds its hands up when
  something is carried near it. If the visitor does its job for it, it
  looks at its empty hands and salutes.
- *Picked up:* its wheel spins in the air. Put down outside its lanes, it
  hurries back.
- *Its boundary:* it cannot cross the tape. Reaching for something outside
  it, it stretches, gives up, and prints a slip: "OUT OF MY LANE."
- *Given an order slip:* it carries the order out, which shows the visitor
  how it is done.

**Proof, the inspector.** Tall and narrow, fixed at the inspection bench,
with a loupe on a jointed arm, a rubber stamp and a clipboard.

- *Temperament:* exact, slow, impossible to hurry. The belt stops for it.
- *What it does:* § B2 X4. It never rejects without saying what it
  expected.
- *With the visitor:* a part thrown straight at the dock is pointed back to
  its pad. Something exactly right gets a small nod and a tick.
- *With Fetch:* it disapproves of the speed. If Fetch idles too close, it
  stamps APPROVED on Fetch's back, and Fetch wears it for the rest of the
  visit.
- *Painted by the visitor:* it inspects its own arm and tags itself "NOT ON
  AN ORDER."

**Revert, the caretaker.** Low and wide on treads, with a broom, a dustpan
and a crank on its back. It lives in a cupboard under the bench.

- *Temperament:* deadpan. It answers with printed cards, never slips.
- *What it does:* comes out when the bench is a mess, after the Button, and
  whenever the UNDO lever is pulled: it turns its crank and the change runs
  backwards. It returns what fell off the edge through the lost-and-found
  chute. When there are too many loose parts it restacks the oldest crates.
- *Left in peace:* if the bench stays tidy for two minutes it parks in the
  light from the window and powers down, one eye still open.
- *Picked up:* it is heavy and goes limp.

**Patch, the operator.** The raccoon in a cardigan and headset from
Patchlamp's brand picture, on a stool at the switchboard. Patch does not
leave the stool.

- *What it does:* when a text arrives the line's lamp lights, Patch plugs
  in, pulls open the drawer labelled for that jack (the folder), does the
  work, leans out to check the result is really there, and texts back.
- *With the visitor:* pull the cord out mid-job and Patch looks at the dead
  plug, then slowly at the visitor.
- *Its nature:* it pockets tokens and anything shiny left near the board.
  The hoard is in its bottom drawer.
- *Asked "who are you":* "CLAUDE, WEARING A NAME TAG THAT SAYS PATCH."
- *Brand rules apply:* Patch is "it", says "I" of itself, and names Taylor.

What each one stands for, said once on the workshop's own hatch and in the
case study, in words Taylor approves:

| in the workshop | in his work |
|---|---|
| an order slip | he decides what gets built |
| lanes of tape a robot cannot cross | an agent works inside one project's permissions |
| Proof, and the dock that stays shut | review and tests before anything ships |
| the UNDO lever and Revert | every change is versioned and can be reverted |
| Patch on the stool | Patchlamp's operator |

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
- **In the world**, second routes to the same places: the filing cabinet
  (top drawer RÉSUMÉ, second PROJECTS, third the three legal pages), the
  mailbox (contact), the services window by the dock (a bell; ringing it
  opens the two services with their prices, read from the same file `/ai/`
  uses, and a link to `/ai/`).
- **Hatches**: each machine's brass plate opens an HTML panel: what the
  real thing is, what the toy shows, what the toy simplifies, the facts
  with their dates, and links.

### B8. Taking control of a robot

**Recommendation: not in release 1; a lighter version first.**

- It is practical. Fetch on one wheel is easy to drive.
- It is expensive to do well: a second camera that behaves in tight
  spaces, collision for the whole bench at robot height, touch controls,
  and places worth driving to. That is a second game.
- It is the character control the design deliberately avoided, returning
  by a side door, and it adds little that the foreman's view lacks until
  there are hidden places to find.

Expansion EXP3 ships **ride along**: click Fetch, choose it, and the camera
sits on Fetch's shoulder while it does its rounds. Everything can still be
clicked from there. Full driving (EXP8) is built only if playtesters keep
trying to steer.

### B9. Sound

- Short mechanical sounds are on, quietly, from the visitor's first click
  or tap. Music and anything that loops plays only when the jukebox is on.
  The mute control is always in the strip and is remembered. (§ Open
  decisions 2.)
- Part notes are synthesised in the browser. A handful of recorded sounds
  (stamp, lever, bell, beep) are original or CC0. No licensed music.

### B10. Reduced motion, small screens, weak hardware

- **Reduced motion:** the belt and crew start still, the camera cuts
  instead of easing, Button rungs are a card and a lamp dip. Whatever the
  visitor does still moves. The settings can turn full motion on.
- **A phone held upright:** the stage opens on the centre cluster. Hit
  areas are at least 44 px. Text entry on the in-world phone uses the
  ready-made texts first.
- **Weak or absent graphics:** the still picture and the paperwork. A weak
  machine that can run the stage gets it with fewer loose parts and without
  cast shadows (§ E6).

## C. World layout

The bench is about 28 units wide and 12 deep, where a robot is 1 unit tall.
Work flows left to right: orders in, building in the middle, checking, out
by the dock. Tall things stand at the back. Nothing usable is hidden behind
anything else from the fixed camera.

```
                              BACK WALL
 ┌───────────────┬───────────────────────────┬───────────┬──────────────┐
 │   TOOL WALL   │   sign: TAYLOR REMUND     │  WINDOW   │ trophy shelf │
 │   (pegboard)  │   SWITCHBOARD + Patch     │ (Wasatch) │              │
 │               │   the LAMP, clamped here  │  + blind  │              │
 ├───────────────┴───────────────────────────┴───────────┴──────────────┤
 │                                                                       │
 │  ┌ BAY B ─┐        UNDO      PLATEN ──► storefront     JUKEBOX   DESK │
 │  │reserved│        lever                               + arm          │
 │  └────────┘        phone                                              │
 │                                                       ┌ BAY C ─┐      │
 │  ┌ BAY A ─┐              ( DO NOT TOUCH )             │ sheet  │      │
 │  │reserved│                                           └────────┘      │
 │  └────────┘                                                           │
 │  ORDER                                  jukebox  INSPECTION           │
 │  BOARD  ═══════════════ belt ════════════ arm ═══ pad (Proof) ══► DOCK│
 │  crates                                                      UNCHECKED│
 │  ticker tape       Revert's cupboard           services · mailbox ·   │
 │                    (under the bench)           cabinet · shipped pallets
 └───────────────────────────────────────────────────────────────────────┘
                          FRONT EDGE (the visitor)
 strip:  Taylor Remund · software engineer · I build and run Patchlamp
         Résumé · GitHub · LinkedIn · Email          Read · sound · settings
```

| station | address | where | first seen as |
|---|---|---|---|
| The sign and the lamp | `#top` | back, centre | the name, lit |
| Patchlamp | `#patchlamp` | centre | Patch at the board, the phone, the storefront |
| The Button | `#button` | front of centre | the reddest thing on the bench |
| The line | `#line` | along the front | the belt, Proof, the dock |
| Shipped | `#work` | front right | pallets of stencilled crates, grouped by role and dates |
| Tool wall | `#tools` | back left | tools on a shadow board |
| Jukebox | `#jukebox` | right of centre | a turntable with an arm |
| Services window | `#services` | by the dock | a shutter and a bell |
| Desk | `#about` | right | a desk, a chair, a framed photograph |
| Mailbox and cabinet | `#contact` | front right | a flag, three drawers |

**How attention is guided without a path.** The lamp makes the centre the
brightest place. Motion draws the eye left to right along the belt. Tells
(§ B3) point at whatever is nearest and untouched. The three reserved bays
are taped rectangles with label tape naming what is coming, which is both
an honest roadmap and a reason to come back.

**The shipped pallets are the work history.** Three pallets, stencilled
with role, employer and dates exactly as `/resume/` gives them: Software
Developer, Kingsley Management Corporation, Nov 2024 to present;
Automation Engineer, the same, Jun 2023 to Nov 2024; DevMountain, Nov 2022
to Apr 2023. On each, crates for the systems shipped in that role. Crates,
not years, carry the weight: `profile.md` lists "leading with years of
experience" under what must not be done.

**The window** shows cut-out mountains. Its blind has a pull cord. Light
that follows Utah's real time of day comes with EXP3.

**The desk** is furniture and a framed real photograph in release 1. Its
objects arrive when Taylor has chosen them (EXP2).

## D. Interaction inventory

Tier E is essential to release 1. Tier H is high value and in release 1
unless cut at G5. Tier L is later or hidden.

### The major interactions

**1. Pick up and throw anything loose (E).** *Input:* drag, or tap then
tap. *Behaviour:* the part rises and follows on a spring; released, it
falls and tumbles with its weight and bounce. *Feedback:* its note, its
shadow, the crew's eyes. *Reset:* parts that leave the bench come back by
the chute; over forty loose parts, Revert restacks the oldest crates.
*Why it is fun:* weight and sound make moving things satisfying before
anything else is understood.

**2. The Big Red Button (E for rungs 1 to 4, H for 5 and 6).** § B4.
*Reset:* each rung rewinds itself. *Why:* everyone presses it; it answers
with a joke, and each press gives back a little more.

**3. Text a change (E).** *Input:* tap the phone; choose a ready-made text
or type one. *Behaviour:* the line's lamp lights, Patch plugs in, opens the
folder drawer, makes the change, checks it, replies. *Feedback:* the change
itself, the reply on the phone, the lamp. *Reset:* "undo that", or the
lever. *Why:* words turn into a physical change, the way the product works.

**4. Re-patch the cord (E).** X1. *Input:* drag a plug to another jack.
*Feedback:* the cord swings like a rope, the jack's lamp lights, the
phone's ready-made texts change to suit. *Reset:* the cord stays where it
is put; "Reset the workshop" returns it to STOREFRONT. *Why:* one familiar
action suddenly works on everything, the lamp most of all.

**5. Run the belt (E).** *Input:* a speed dial, a direction lever.
*Behaviour:* everything on it moves accordingly; fast enough and Proof
raises a hand and the belt waits. *Reset:* the dial and lever stay as set.
*Why:* it is the room's clock; changing it changes everything downstream.

**6. Play the line (E).** X2. *Input:* swing the arm over the belt.
*Reset:* swing it back over the turntable to play records instead.
*Why:* an arrangement of objects becomes a tune with no instruction.

**7. Inspection (E).** X4. *Input:* anything reaching the pad.
*Feedback:* the stamp's thunk, or a red tag that can be read. *Reset:*
stamps and tags come off with UNDO. *Why:* a rejection that says what it
wanted is a puzzle, not a wall.

**8. Ship it, and open what was shipped (E).** *Input:* a stamped part at
the dock; or the latch on any crate from the shipped pallets.
*Behaviour:* the door rolls up, the part leaves, a bell rings. A shipped
system's crate unfolds like a pop-up book into a small scene with one line
about it; its plate opens the full card. *Reset:* UNDO brings a shipment
back; the latch folds the scene away. *Why:* the work history is something
to open, not to read.

**9. UNDO (E).** X3. *Input:* pull the lever. *Why:* seeing a change run
backwards is satisfying each time, and it makes experimenting safe.

**10. Orders (E for the board, H for specials).** *Input:* tear a slip off
and fill it by hand, or hand it to Fetch. *Specials in release 1:* a crate
of a colour and a label; three crates small to large; something that is
not a crate (ship Fetch, and it comes back down the chute wearing a
RETURN TO SENDER label); a crate that has been un-painted; the house tune;
a storefront change. *Reset:* filled orders stay spiked; trophies stay on
the shelf between visits. *Why:* goals for people who want them, invisible
to people who do not.

**11. The tool wall (E).** *Input:* lift a tool off its peg. *Behaviour:*
the lamps of every station built with that tool light, and its name shows
on label tape. Hung back, it snaps to its painted shadow. A tool is a part
like any other: it has a note, it can be painted and shipped. *Tools in
release 1:* Laravel, Vue, PHP, Python, Rust, SQL, Flutter, Claude Code;
a pinned sheet opens the full skills list from `/resume/`. *Why:* skills
shown as what they built.

**12. Hatches (E).** § B7. One on Patchlamp, one on the line (how he
works), one on the jukebox, and the maker's plate under the sign for the
workshop itself: who built it and how, with numbers measured at build time.

**13. The mailbox and the filing cabinet (E).** § B7. *Why:* the practical
things are also pleasant to open.

**14. The crew (E).** § B5. Poke, pick up, feed, paint, hand things to.

### Smaller ones

| # | interaction | tier | what it does |
|---|---|---|---|
| 15 | The lamp on a robot (X5) | H | § B2 |
| 16 | The house tune | H | five sizes in order open the jukebox drawer; a new record |
| 17 | Patch's hoard | H | Patch pockets tokens; its bottom drawer holds them, and later the Button's key |
| 18 | The services window | H | ring the bell: the two services, prices from the shared file, a link to `/ai/` |
| 19 | The blind | H | pull the cord: day or night at the window |
| 20 | The ticker tape | H | a machine by the order board prints this repository's real commit subjects; pull the tape to read back |
| 21 | The sheet over bay C | H | tug it: dust, and it settles. The label says RETIRED 2026. |
| 22 | The trophy shelf | H | one object per special order filled, kept between visits |
| 23 | The lost-and-found chute | H | anything that leaves the bench comes back, sometimes with a note |
| 24 | Paint a robot | H | on the platen a robot is a part; each reacts in character and keeps the colour until undone |

Tier L, kept for expansions: the sorter and its replay; the desk's objects;
ride along; the Artificer bench; the machine under the sheet; hold to
rewind; a dial marked GRAVITY with tape that says FACTORY SETTING. PLEASE.

## E. Technical architecture

Versions named here were current on npm on 2026-11-17. The building session
reads the current documentation for each before using it; it does not work
from memory.

### E1. Choices

| area | choice | why, and what it costs |
|---|---|---|
| Site shell | **Astro**, static output, directory URLs | Shared layouts for nine pages, content files with a checked schema, no JavaScript on pages that need none. Cost: Pages moves from "serve the branch" to an Actions build. |
| 3D library | **Three.js** in TypeScript, used directly | One persistent scene driven by a simulation loop. React Three Fiber would add React to a stack that has none; the Vue equivalent is younger. Cost: the project writes its own small conventions for lifecycle and disposal. |
| Renderer | **`WebGLRenderer`** (WebGL 2) | Nothing in this look needs WebGPU, and it is the widest-supported and best-documented path. Today's reading found conflicting reports on WebGPU in Firefox and on phones. Kept open by writing no raw shader code beyond a short approved list. |
| Physics | **Rapier** for loose parts only | Stable stacking, sensors, snapshots. Cost: its WebAssembly file is 3.08 MB before compression (measured from the package today); compressed size is measured in P1. It loads after first paint. It sits behind an adapter so it can be swapped if the budget in § E6 cannot be met. |
| Machines and crew | Scripted state machines on a fixed 60 Hz step | Predictable, testable, cheap. Physics is for things that tumble, not for things that perform. |
| Geometry | Built in code from a parts kit (§ E3) | No modelling tool is available; the look is designed to suit it. Proven or replaced at G1. |
| Animation | A small in-house timeline driven by the simulation clock | Keeps the simulation deterministic and lets reduced motion be honoured in one place. |
| Audio | Web Audio directly | Synthesised notes plus a few samples; no library needed. |
| Interface overlay | Plain HTML and TypeScript | A strip and four kinds of panel do not need a framework. |
| Tests | Vitest (unit and headless simulation), Playwright (browser), `shot` (page audits) | § E7 |
| Hosting | GitHub Pages through Actions | Same host, same domain, same certificate. |

Runtime dependencies are two: `three` and Rapier. Everything else is a
development dependency. Versions are pinned exactly and the lockfile is
committed; CI installs with `npm ci`.

### E2. Layers

The rule that makes this maintainable: **the simulation does not know it is
being drawn.**

```
src/content/     facts: projects, roles, skills, services, toy claims, legal fragments
src/pages/       index, resume, ai, privacy, terms, sms, career-send, projects/patchlamp, 404
src/layouts/     Paper (the conventional pages), Stage (the home page)
src/workshop/
  sim/           world, parts, commands, orders, machines/, crew/, physics adapter, clock, rng
  view/          kit/, materials, light, camera, labels, effects, one view per station
  input/         pointer, touch, keyboard, picking, the controls list
  audio/         notes, samples, mixer
  ui/            strip, panels (hatch, phone, contact, services), settings
  shell/         boot, capability tiers, picture-to-stage handoff, fallback, saved state
tests/           unit/, scenario/ (headless simulation), browser/ (Playwright)
scripts/         verify, check-urls, check-legal, check-claims, budget, poster, commits
legal-reference/ frozen copies of the four compliance wrappers, taken from main
public/          CNAME, assets/ at their old paths, the still picture, fonts, robots.txt
```

| layer | owns | must not |
|---|---|---|
| `content` | every fact and every sentence a visitor can read, each with a source | contain layout or behaviour |
| `sim` | parts and their properties, machines, the crew, orders, commands and their inverses, physics | import Three.js or touch the DOM; it runs in Node for tests |
| `view` | turning simulation state into a picture | change simulation state |
| `input` | turning pointer, touch and keys into intents (hover, press, grab, drop, turn, plug, focus) | know what any machine does |
| `audio` | sound for simulation events | decide when things happen |
| `ui` | the HTML around and over the stage | hold facts; it reads them from `content` |
| `shell` | starting, choosing a tier, falling back, saving | know about any particular station |

### E3. The parts kit

Every mesh in the world comes from a kit function; nothing is built from
raw primitives at the point of use. That is what keeps the look consistent
and lets a build check enforce it.

- Kit pieces for release 1: rounded box, bevelled cylinder, pipe along a
  path, gear, lamp, lever, dial, push button, jack and plug, cord (a simple
  rope, not a physics joint chain), belt segment with rollers, crate in
  three sizes, pallet, pegboard and peg, label tape, paper slip, ink stamp,
  pop-up fold, hatch plate, drawer, the robot rig (one rig, three sets of
  proportions and fittings), Patch, storefront, phone, mailbox, cabinet,
  window with cut-out mountains, painted sign with bulbs.
- Every piece takes its colours from the palette tokens only.
- Repeated pieces (rollers, pegs, jacks, bolts) are instanced; the fixed
  body of each station is merged into as few meshes as its materials allow.
- All text is drawn to textures from the content files at start-up.
- A development-only page shows each kit piece on a turntable. It is the
  parts catalogue for review and for picture-comparison tests.

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
  misfire(level: 1 | 2): void; // what the Button makes it do
}

// Anything with a mouth.
interface Machine extends Interactable {
  accept(part: Part): Outcome;        // did its verb, or says what it wanted
  instruct?(cmd: Instruction): Outcome; // for stations with a jack
  snapshot(): unknown; restore(s: unknown): void;
}

// Everything a visitor changes goes through one of these.
interface Command { apply(w: World): void; invert(w: World): void; describe(): string; }
```

Invariants the tests hold the code to:

1. Every `Interactable` is in one registry. The registry is the only source
   for picking, the controls list, tells, Button rungs, reset and saving.
   A test fails if an interactable lacks a name, a tell, or a misfire.
2. Machines do not call each other. They meet only through parts, through
   instructions from the switchboard, and through events on one bus.
3. Every visitor action is a `Command`. For each command type a test
   applies it, inverts it, and requires the world to be as it was.
4. Given the same seed and the same recorded input, everything that is not
   physics ends in exactly the same state. Physics is asserted by outcome
   ("the crate reaches the dock within N steps"), not by exact position.
5. No visible sentence is written in `sim`, `view` or `ui`. A check fails
   the build on a string literal that reads like prose outside `content`.
6. Every content entry that states a fact has a `source`. The schema
   rejects one without it.

### E5. Loading, in order

1. HTML, CSS, the still picture and the strip. This alone is a complete,
   useful page.
2. The stage script and, in parallel, the physics file.
3. The scene is built in the same state and from the same camera as the
   still picture, then swapped in.
4. Sound loads on the first click or tap.

The still picture is rendered from the real scene by a script and
committed; a check fails if the scene has changed since it was rendered.

### E6. Budgets and tiers

Targets set by this spec; none is measured yet. "Reference laptop" is this
machine.

| what | budget |
|---|---|
| First paint of `/` (HTML, CSS, picture, fonts) | at most 150 KB transferred; LCP at most 1.5 s on the reference laptop with "Fast 4G" throttling; CLS 0 |
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

### E7. Tests and checks

| kind | what it proves |
|---|---|
| Unit | part properties; each machine's states; the instruction parser, from a table of texts; the order and inspection logic; the content schema |
| Command symmetry | invariant 3 in § E4, for every command |
| Scenario (headless) | recorded inputs lead to expected outcomes: a crate fed to the belt ships; rung 4 then its rewind leaves the bench as it was; each cross-machine interaction X1 to X5 end to end |
| Soak | an hour of simulated random grabbing, throwing and pressing from a seed: no part outside the bench, no runaway part count, every machine back to idle after reset, the undo stack intact |
| Browser | the page loads in Chromium, Firefox and WebKit with no console error; the canvas is not blank; the Still tier appears when WebGL is refused; reduced motion is honoured; the keyboard path presses the Button and hears the result announced |
| Pictures | six fixed frames at a fixed simulation step compared against approved ones |
| Site | every path in § 2 answers from the built output, `/resume` included; the legal wrappers equal `legal-reference/` byte for byte; no page links to `/career-send/`; no broken link; `shot check . --all`; `shot design .`; the transfer budgets |
| Claims | every row of the toy truth table (§ F3) and every Patchlamp sentence has its source filled in |

One command, `npm run verify`, runs everything that needs no graphics card.
`npm run perf` runs the frame-time session on the reference laptop. Both
are what the gates in § G call.

### E8. Accessibility

- The paperwork is a complete alternative and is the first thing in the
  focus order.
- Every interactable is also a button in an HTML controls list, grouped by
  station. Focusing one frames it on the stage.
- What happens is announced in a polite live region in short sentences
  ("Crate painted blue." "Inspection: expected blue, got red.").
- Carrying never requires a drag (§ B6).
- Text contrast on HTML is at least 4.5:1; focus is always visible; HTML
  targets and in-world hit areas on touch are at least 44 px.
- No flashing above three a second anywhere.

### E9. Saved state, privacy, observability

- Saved in the visitor's own browser only: settings (sound, motion,
  quality), what they have discovered, the Button's rung, trophies. The
  layout of loose parts is not saved.
- No analytics, no cookie, no network request carrying anything a visitor
  did or typed.
- For playtests, `?playtest=1` keeps a timestamped log of interactions in
  memory and offers it as a file at the end. It is never sent anywhere.
- `?debug` shows frame time, draw calls, body count and tier.

### E10. Build and deployment

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
| **`/` Patchlamp band** (`#patchlamp`): lead, three bullets, a price line, two links, the exchange-room picture | In the world: the Patchlamp station and its hatch. In the paperwork: a `#patchlamp` section with the brand's position sentence (`Position::SENTENCE`), the three bullets if each still has its `CLAIMS.md` row, the picture, and links to patchlamp.com and patchlamp.com/pricing. Recommended: no price typed here at all, so the two sites cannot drift. |
| **`/` services teaser** (`#services`): two cards with prices | In the world: the services window. In the paperwork: the same two cards, text and prices read from the one file `/ai/` uses. |
| **`/` about** (`#about`): two paragraphs, the photograph, the résumé link | In the world: the desk and the framed photograph (the real one; a face on this site is never generated). In the paperwork: the two paragraphs, updated only where the site's own description of itself changes. |
| **`/` contact** (`#contact`): GitHub, LinkedIn, email | The strip, the mailbox, and the paperwork's contact section. Email stays `mailto:`; there is still no form. |
| **Footers**: the "plain files, edited by asking Claude" line | The line stops being true at the cutover and is replaced with one Taylor approves about how this site is built. Footer links to Privacy, Terms and SMS stay on every page. |
| **`/resume/`** | Carried whole into the Paper layout: about, the three figures, four skill groups, eleven project cards, three roles, contact. Skill icons are served from this site. A print stylesheet is added. Each project with a station links to it. The corrections in § 1 are applied once ruled on. Its unclosed section is fixed. |
| **`/ai/`** | Carried whole into the Paper layout: every sentence, every price, every `mailto:` subject, every anchor. Out of the main navigation, linked from the paperwork, the services window and the footer. Its Patchlamp panel is re-read against `CLAIMS.md` at the cutover. |
| **`/privacy/` `/terms/` `/sms/`** | The `.legal` wrapper of each is copied from `main` into `legal-reference/` and served unchanged inside the Paper layout. A check compares them byte for byte. Their tap targets are fixed in the layout's CSS, not in their text. Any change of wording is Taylor's (§ Open decisions 3). |
| **`/career-send/`** | The same treatment. Unlinked, out of the sitemap, `noindex` kept. |
| **`assets/`** | Old paths keep answering. A new share card (the bench, with the name) replaces `og.png` at the cutover, with his word. |
| *(new)* **`/projects/patchlamp/`** | The one case study: the problem, the three codebases, why every transport pulls, the permission boundary, the claims file, what was measured, how it was built. All inside the disclosure line. |
| *(new)* **`/404.html`** | A plain page: a machine that is not there, and the four links. |
| *(new)* `sitemap.xml`, `robots.txt`, canonical links, `Person` structured data on `/` and `/resume/` | The sitemap lists only indexable pages. |

### F2. Where each kind of content lives

| content | in the workshop | in conventional HTML |
|---|---|---|
| His name and role | the sign | the strip, the paperwork, every page title |
| Patchlamp | a station played with; its hatch | paperwork section; the case study |
| Other projects | crates that open; later, their own machines | `/resume/#projects` |
| Work history | the shipped pallets | `/resume/#experience` |
| Skills | the tool wall (eight) | `/resume/#skills` (all) |
| How he works | the crew, the lanes, the dock, the lever | the line's hatch; a section of the case study |
| Services and prices | the services window (no prices in 3D) | `/ai/`; paperwork section |
| About him | the desk, the photograph | paperwork section |
| Contact, résumé, GitHub, LinkedIn | mailbox, filing cabinet | the strip, on screen at all times |
| Legal | the cabinet's third drawer | footer links on every page |

### F3. The toy truth table

Each toy behaviour, the real behaviour it stands for, and where that is
recorded. A row with no source does not ship. Rows for expansion machines
are written when those machines are specified.

| the toy | the real thing | source |
|---|---|---|
| A text changes the storefront and a reply comes back | The owner texts; Patch makes the change, checks it is live and texts back | `CLAIMS.md`, hero rows |
| The toy takes seconds | "Usually in a minute"; the hatch says the toy is sped up | `CLAIMS.md` "Usually in a minute" |
| "Undo that" puts it back | The same | `CLAIMS.md` "Undo that last change" |
| Patch opens one drawer per jack and refuses what is outside it | It works inside a walled-off folder that holds only that client's things | `CLAIMS.md` "Works inside a walled-off folder" |
| An unparsed text is pointed at Taylor's mailbox; nothing is claimed sent | Out-of-scope asks are passed to Taylor | `CLAIMS.md` "Out-of-scope asks" |
| Patch says it is Claude wearing a name tag | The same | `BRAND.md` § The name |
| The phone is scripted; no model is called | Said plainly in the hatch: this is a toy; the real Patch runs Claude Code | this file |
| Robots stay in their lanes; nothing ships unstamped; changes can be undone | How he builds with agents: permissions, review, versioning | `profile.md` § Positioning; wording for Taylor |
| The jukebox: records in a shared crate, a shelf of your own, music that keeps playing as the view moves | Sharewire: a shared catalogue, a personal library, a player that survives page navigation | `sharewire.md` |
| Pallet labels and crate stencils | Roles, employers, dates, project names as published | `/resume/` |

## G. Releases, phases and gates

### Release 1: what is live at the cutover

**In.**

- The bench, the lamp, the sign, the window, the three taped bays.
- The crew: Fetch, Proof, Revert, Patch.
- Stations: Patchlamp (switchboard, phone, platen, storefront), the line
  (order board, belt, inspection, dock), the jukebox, the tool wall, the
  Button, the UNDO lever, shipped pallets, services window, desk
  (furniture and photograph), mailbox, filing cabinet.
- Interactions 1 to 14 of § D, and 15 to 24 unless cut at G5.
- Cross-machine interactions X1 to X5.
- The strip, the paperwork, hatches, the controls list, three tiers.
- Every conventional page of § F1, the Patchlamp case study, the 404.

**Out, on purpose.** The ledger sorter, the Artificer bench, the machine
under the sheet, the desk's objects, any control of a robot, day and night,
hold to rewind, anything needing a server, any measurement.

If the schedule forces it, the smallest thing that may still be called
release 1 is: the bench; Fetch, Revert and Patch; the Button to rung 4;
Patchlamp with X1; the belt with a dock that ships anything; UNDO (X3); the
tool wall; the shipped pallets; the mailbox and the cabinet; the strip, the
paperwork and every conventional page. § H gives the order of cuts.

### Phases

Gates are named G0 to G6 and phases P0 to P6. Expansions are named EXP1 to
EXP10 so they are not confused with the subsections of § E.

Every gate is a stop. The session presents the evidence listed and waits.
Gates marked **Taylor** need his dated line in § Approval log.

**P0. Groundwork.** *Depends on:* G0.
- Scaffold the project; pin versions; the layer folders of § E2; `verify`
  running with the URL, legal, link and budget checks against a
  placeholder site.
- Freeze `legal-reference/` from `main`.
- Rewrite `CLAUDE.md` on this branch to describe the new site: one manual.
  Content rules carry over unchanged; the plain-files, no-build and
  no-library rules are replaced by § E.
- **Gate (objective):** `npm run verify` passes; the built output answers
  every path of § 2; the legal check passes.

**P1. The vignette: does code-built geometry look good enough?**
*Depends on:* P0. This phase builds one slice of the bench to finished
quality and nothing else.

*What is in it.*
- The centre cluster: the Button on its pedestal with its tape and its
  cover, a metre and a half of belt with rollers, a stack of three crates
  and one loose crate, the phone, the lamp.
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
- A twenty-second screen recording.
- The whole-vignette picture at 320 pixels wide, to judge silhouettes.
- The whole-vignette picture beside `assets/exchange-room-1280.jpg`, to
  judge the palette.
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

*Gate G1, part two: the visual review (Taylor).* He scores five questions
from 1 to 5, from the pictures and from using it:

1. Does it look made by hand, by someone who cared?
2. Can you tell what can be touched without being told?
3. Is it one place: one palette, one light, one hand?
4. Do Fetch and Patch have character in a still picture?
5. Would you send someone a screenshot of this?

And two or three people who have seen nothing are shown the whole-vignette
picture for five seconds and asked: what is this, whose is it, and what
would you click first?

**Pass:** every score is 4 or 5, and at least two of the cold viewers say a
workshop or factory, name him, and point at something that can in fact be
used. Nobody describes it as a template or as generated.

**Not yet:** one more round on the named weaknesses, then the gate again.

**No:** code-built geometry is not the method. In order of preference:
model the characters and the hero pieces in a 3D tool and keep code for the
rest; commission a kit to this spec; or change the art style to one code
does naturally, such as flat cut paper. The choice is Taylor's and this
file is revised before any more is built.

Nothing of the wider environment is produced before G1 passes.

**P2. The prototype: do people play with it?** *Depends on:* G1.
- Extend the vignette into a playable strip: the whole belt, the dock,
  Proof, the platen and the storefront, Revert, UNDO, Button rungs 1 to 4,
  the order board with ordinary orders, one shipped crate that unfolds.
- Use the real contracts of § E4 from the start, so P3 hardens this code
  and does not rewrite it.
- Measure the compressed size of the physics file and time-to-usable.
- **Gate G2 (Taylor, with numbers).** Three people who have not seen it,
  using the protocol of § I: at least two act within twenty seconds
  unprompted and use three different things within two minutes. The frame
  budget holds. The transfer budget holds or the engine question of § E6 is
  decided. He confirms the scope of release 1 or cuts it here.

**P3. The foundation.** *Depends on:* G2.
- The registry and everything hung on it: controls list, tells, saving,
  reset, the playtest log.
- Tiers, the picture-to-stage handoff, fallback, reduced motion.
- The full test suite of § E7, the soak test included.
- The Paper layout and every conventional page of § F1, from content
  files, with the corrections ruled on.
- **Gate G3 (objective).** `verify` passes with every check enabled. The
  browser tests pass in three engines. `shot design .` is clean. Each
  conventional page's visible text matches `main`'s, apart from a written
  list of intended differences.

**P4. The rest of release 1.** *Depends on:* G3.
- The remaining stations and interactions of release 1's list, X1 to X5
  with their scenario tests, hatches, the case study, the 404.
- **Gate G4 (Taylor reads; the rest objective).** Every item of that "In" list
  exists and has a test. He reads and approves: every hatch, the case
  study, the truth table, every line the crew prints.

**P5. Polish and personality.** *Depends on:* G4.
- Sound, the crew's idle behaviour, secrets (items 16, 17, rungs 5 and 6),
  timing, the share card.
- Real phones: his S24 Ultra and iPhone 14 Pro Max, and one older device.
- **Gate G5 (objective, then his cuts).** Every budget of § E6 holds on the
  full bench. Anything of tier H that threatens a budget or is not good is
  cut here, in the order of § H.

**P6. Verification and launch.** *Depends on:* G5.
- The playtest of § I. Fixes. The playtest again if a threshold was
  missed.
- § Cutover.
- **Gate G6 (Taylor).** § I is met and the cutover list is complete. He
  says to merge.

### After release 1: expansions

Each ships alone, through its own small version of the gates: truth-table
rows approved, tests, budgets still held, two people try it cold.

| | expansion | notes |
|---|---|---|
| EXP1 | **The ledger sorter**, bay A | Tokens fall through three tiers of bins. One bounces, an error lamp lights, and a lever sucks the month back and replays it. Built only from what `/resume/` already says; Taylor checks the toy and its hatch for anything confidential before it ships. Its output can feed the belt in size order. |
| EXP2 | **The desk's objects** | Whatever Taylor chooses. Each can be picked up and has one line. |
| EXP3 | **Ride along, and the real time of day** | The camera on Fetch's shoulder; the window's light follows the clock in Utah. |
| EXP4 | **The Artificer bench**, bay B, with a fourth robot | Two slots, a foreman that delegates, and a second job refused with a BUSY lamp, because that is what the real one does. |
| EXP5 | **The machine under the sheet**, bay C | Plateful: three little shop windows, one machine, and a gate that will not let an order into the wrong one. Past tense, no links. |
| EXP6 | **Hold to rewind** | Hold the UNDO lever and the last twenty seconds of the whole bench run backwards. |
| EXP7 | **More case studies** | The ledger system first, once Taylor has supplied the facts that file is waiting on. |
| EXP8 | **Drive Fetch** | Only if people keep trying to. |
| EXP9 | **Anything with a server** | A worldwide count of Button presses; measurement. Each needs a decision and wording on `/privacy/`. |
| EXP10 | **A real model behind the phone** | Needs a server, a budget and abuse limits. A decision, not a default. |

## H. Risks and tradeoffs

| risk | how it shows | response |
|---|---|---|
| **The look falls short.** The largest risk. | G1 scores below 4. | G1 is a hard stop with three fallbacks. No environment is built before it passes. |
| **Scope grows.** Every machine invites one more feature. | A phase needs something not in release 1's list (§ G). | It goes to the expansions table (§ G). Release 1's list changes only by Taylor's edit to this file. |
| **Combinations multiply.** | A special case is being written for one part in one machine. | Machines act on properties. A written special case needs a line in § B2 or § D first. |
| **The physics file is heavy.** | Stage transfer over 2.2 MB or usable later than 6 s throttled. | Decided at G2: accept and raise the budget, or swap the engine behind the adapter. |
| **Phones.** | Dragging fights panning; things are too small. | The centre cluster, tap-then-tap carrying, 44 px hit areas, tested on real devices in P5. |
| **A recruiter in a hurry is slowed down.** | The résumé takes more than one click or ten seconds. | The strip, from first paint. Tested in § I. |
| **A toy says something untrue.** | A behaviour has no truth-table row. | The row is a build requirement. |
| **The crew upstages the visitor.** | Testers watch instead of acting, or are interrupted. | The rules at the top of § B5; tuned in P5. |
| **The legal pages drift.** | The legal check fails. | It is in `verify`; the build does not pass. |
| **`main` moves under the branch.** | The career workspace lands a change on the old files. | § 4, and the cutover list. |
| **Sound annoys.** | Testers mute at once. | Quiet effects only; music is opt-in. |

**Deliberately not built.** A walking avatar as the main way in. Free
camera orbit. A free-text box as the only way to instruct Patch. A tool
that changes a machine's behaviour (thirty tools times every machine). Five
deep simulations at launch. A contact form. Any tracking. Licensed music.
Post-processing chains. More than one room.

**Shortcuts that keep the quality.**

- One fixed camera angle means only one side of anything needs to be good.
- One robot rig serves three robots. Patch never leaves the stool.
- Machines are scripted; only loose parts are simulated.
- Glow is a sprite on a bulb, not a full-screen effect.
- The pop-up fold makes a small scene from flat pieces.
- The Button's rewind builds the recording that hold-to-rewind (EXP6) will
  need later.
- Text is label tape: a texture, no 3D lettering.

**Order of cuts, if G5 or the schedule demands them.** First the secrets
(16, 17, rungs 5 and 6). Then items 19 to 24. Then X5. Then special orders.
Then the jukebox, which takes X2 with it. Then the services window, whose
content stays in the paperwork and on `/ai/`. Last, Proof and the order
board, which take X4 with them and leave a dock that ships anything. Below
that is the smallest release named in § G, which is not cut.

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

- A missed threshold is fixed and tested again with new people. People who
  have seen it do not count twice.
- Worth writing down, though not a threshold: anyone who pressed the Button
  a second time, laughed, or showed the screen to someone else.

**It is fast and it holds.** Every budget of § E6, measured, on the full
bench. The soak test passes.

**It works without the stage.** With WebGL refused, with JavaScript off,
with reduced motion, by keyboard alone and with a screen reader, a visitor
can learn who he is, read about the work, and reach the résumé, the
services, the legal pages and the contact links.

**Nothing was lost.** Every path of § 2 answers. The legal wrappers are
identical. `/ai/`'s prices and `mailto:` subjects are identical. Each
conventional page's text matches `main`'s except for the written list of
intended differences. `main`'s changes since `fa99b13` are carried across.

**Every claim is true.** The truth table has no empty source. Taylor has
read every hatch, the case study and every line the crew prints.

**The repository shows the same care.** `verify` passes from a clean
checkout with one command. `CLAUDE.md` and `README.md` describe what is
there.

## J. Builder handoff

**Before anything.** Check § Approval log. Without a dated G0 line, do not
build: no scaffold, no dependency, no asset. Reading and planning only.

**How to work.**

- Phases in order. Each gate is a stop: present the evidence the gate
  lists, and wait. A gate marked Taylor is passed only by his line in the
  log.
- Branch `rewrite`, local. Do not push it. `git pull --ff-only` on `main`
  at the start of each session and bring `rewrite` up to it.
- Small commits with plain messages.
- Read the current documentation for Astro, Three.js and Rapier before
  using them. Do not work from memory of older versions.
- Facts come from the files in § 4. A fact that is not there gets a source
  or does not appear.
- Decide alone: structure, naming, signatures, tuning, anything reversible
  and inside this spec. Bring to Taylor, batched: anything that changes how
  his experience is represented, any wording on a legal page, any Patchlamp
  sentence, anything about his employer, any change to release 1's list, any new
  runtime dependency, any budget that cannot be met.
- If this file turns out to be wrong, correct this file in the same commit
  as the work, and say so at the next gate. Do not leave the plan and the
  code disagreeing.

**Milestones, in dependency order.**

| | milestone | needs | done when |
|---|---|---|---|
| M0 | Scaffold and checks | G0 | P0's gate |
| M1 | Parts kit and the vignette | M0 | G1, both parts |
| M2 | Simulation core: parts, commands, undo, physics adapter, clock | M0 | command-symmetry and first scenario tests pass |
| M3 | Playable strip | M1, M2 | G2 |
| M4 | Registry, tiers, fallback, accessibility, saved state | M3 | the browser tests pass in three engines |
| M5 | Conventional pages from content files | M0 (may run alongside M2 to M4) | the text-parity and legal checks pass |
| M6 | Remaining stations, X1 to X5, hatches, case study | M4, M5 | G4 |
| M7 | Sound, crew behaviour, secrets, share card | M6 | G5 |
| M8 | Playtest, fixes, cutover | M7 | G6 |

**Who owns what.** The table in § E2. The one rule not to bend: `sim` never
imports from `view`, `ui` or the browser.

**What to run.** `npm run verify` before every commit that claims a
milestone. `npm run perf` at G1, G2 and G5. `shot check . --all` and
`shot design .` at G3 and G6. `shot` pictures for every review packet.

**Out of scope for the building session, whatever seems convenient.**
Anything in the expansions table. Any server. Any analytics. Editing the text inside a
legal wrapper. Editing `CNAME`. Pushing the branch. Changing a price.
Writing a personal detail about Taylor that he has not supplied.

---

# Part 3 — Closing

## Open decisions (recommended answers; Taylor confirms)

1. **Which machines open with release 1.** Recommended: Patchlamp, the
   line and the jukebox; the ledger sorter is the first expansion. The
   jukebox is the cheapest machine and brings sound, which two of the five
   cross-machine interactions need. The ledger system is still present on
   opening day as a crate that unfolds. The other way round (sorter in,
   jukebox later) puts his strongest professional story on the bench
   sooner and costs the music.
2. **Sound.** Recommended: quiet mechanical sounds from the first click,
   music only when the jukebox is switched on, mute always in the strip.
3. **`/privacy/`.** Self-hosting the fonts (which the audit asks for) makes
   its sentence about Google Fonts untrue, and the page promises a new
   effective date when it changes. Recommended: self-host, remove that one
   bullet, and add one sentence that the workshop remembers settings and
   progress in the visitor's own browser and sends nothing. The callout
   blocks are not touched. Twilio's reviewer reads this page, so the words
   and the date are his.
4. **What the workshop says about how he builds.** The table in § B5, the
   line "FAST IS FINE. UNCHECKED IS NOT.", and the maker's plate saying
   this site was built by him with Claude. Each has to be true of his
   practice and of this build; he approves the exact words.
5. **Three sentences on the live site** (§ 1). The macro is a wrong fact
   and can be corrected on `main` now. The figure's wording and the price
   line are his to rule on. Say the word and this session corrects them on
   `main`, or they are left to the career workspace.
6. **The crew's names.** Fetch, Proof and Revert are working names.
   `BRAND.md` shows his real crew already has names for some of these jobs.
   If he is willing to make those public, the workshop should use them:
   that is truer than anything invented here. If not, the working names
   stand.
7. **How playtesters reach it before the cutover.** Recommended: Tailscale
   Funnel from this machine for remote testers, his own laptop for people
   in the room. The branch stays unpublished.

Settled separately and not blocking: the desk's objects (EXP2); the final
type and palette values (G1).

## Cutover (one merge, when G6 has passed)

- Every path in § 2 answers 200 in the served output, including `/resume`
  without the slash and the unlinked `/career-send/`.
- The legal wrappers are identical to `main`'s on the day, checked by
  diff; `legal-reference/` is refreshed from `main` first if `main` moved.
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
| G0 | This specification; building may begin at P0 | | |
| G1 | The look; code-built geometry for the whole bench | | |
| G2 | The prototype plays; scope of release 1 confirmed | | |
| G4 | Every hatch, the case study, the truth table, the crew's lines | | |
| G5 | Which tier H items, if any, are cut before launch | | |
| G6 | Release 1 is done; merge | | |
