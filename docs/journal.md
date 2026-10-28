# Hackathon Journal — ToyVentor

Meta Global AI Developer Hackathon, Oct 26 – Nov 4 (10 days × morning + evening = 20 check-ins).
Project: ToyVentor on toyventor.com (renamed from ToyForge on Oct 28). Track: indie. Key phrase: "multi-modal Lego — scan it, augment it, print it, play it."

How this works: each morning say "start day N" and I'll walk you through the Start of Day
questions; each evening say "end day N" and we'll log what shipped. Submission due Nov 4, 9:00 PM ET.

---

## Day 1 — Mon Oct 26: Kickoff + Scope lock (in progress, extended into Oct 27 morning)

### Start of Day
- [x] Watched kickoff livestream
- [x] Track confirmed: indie. Theme: Build for Your World
- [x] Scope locked to spec.md

### End of Day
- Shipped: ideation + landed on ToyForge. Foundational building blocks: ToyForge Snap
  + ToyForge Pro (what Pro covers: TBD). Started basic product design concepts.
- Origin story: Lego fanatic as a kid, robotics fanatic as an adult, and wanting to encourage my son's
  ingenuity and creativity, with hidden STEM elements inside a gamified, next-gen, AI-powered Lego.
- Demo-able right now: spec + wireframe (12 pages) only, no code yet.
- Blockers: none (idea stage).
- Tomorrow's first task: Scan + Toybox (Day 2).

---

## Day 2 — Tue Oct 27: Scan + Toybox

Goal: photo a toy, detect mount + size class, save to toybox (wireframe p.2-3).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] SAM path segmentation: what are you trying first?
- [ ] Which physical toy is the test subject (car / figure)?
- [ ] Workshops/office hours to attend today:

### End of Day
- Shipped: a lot. Docs reorganised into docs/ with Snap and Pro as their own
  canonical files; spec de-duplicated and given its origin story, an example
  part record, rejected alternatives, and honest open questions. App
  foundation committed: React + TypeScript + Vite SPA for Cloudflare
  Workers (PWA-ready, not hosted, no service worker yet), Factory/Toybox/
  Scan screens, Worker API, shared part/toy/set schemas, the four builder
  checks as pure functions, base set as data with a validator, seed car +
  seed figure. 30 unit tests green.
  Also today: under-8 gameplay guidance for Snap (open-ended, no fail
  states, 2.5D, ages 1-3 narration layer); household-object characters
  added to the spec (SAM outlines a cup or slipper, it sprouts limbs and
  becomes a character); push-to-talk in the wireframe; design guide and
  mockups; four Snap sample parts in OpenSCAD (Brick 2x2 both sizes,
  Dragon Wing, Glow Star Capsule) matched to the base set, none printed.
- Discovery: [BlockML](https://blockml.org/), an open modeling language
  where one model can be rendered out to software, documents, and physical
  things. If it holds up, describing our parts once and rendering the
  builder models, print files, and set data from that single source could
  save hours if not days and accelerate a significant portion of this
  project: the parts pipeline is exactly the multi-output problem it
  targets. Unproven until tomorrow's spike: one real part through it,
  compare against hand-written OpenSCAD, decide before Day 4's print gate.
- Demo-able right now: yes, locally. Factory -> Scan -> photo + SAM outline
  -> Toybox with part cards and live check results. Not deployed, and not
  yet run on an actual phone.
- SAM segmentation: WORKING. Day 2 test subjects ended up a coffee cup and
  a water bottle, which fits the household-object direction better than the
  car did. Live sam-3.1 through our Worker: image inline as a base64 data
  URL (the Files-upload path is video-only and silently returns zero
  matches for images), streaming Responses API, boxes parsed from the
  output_text lane. "cup" and "water bottle" both matched first try on the
  generated test photo; a 210mm scale anchor on the bottle derived a 65mm
  width. Lessons: one short noun per request ("coffee cup" missed, "cup"
  hit), SAM gives proportions not millimetres so a human still sets the
  real longest side, and toys it can't outline are saved "by hand", never
  fake-scanned. Still to prove: real phone photos of the real cup/bottle.
  Caught in time: the API key briefly sat in a committed file; moved to
  gitignored .dev.vars before any commit touched it.
- Blockers: OpenSCAD not installed here, so zero STLs and zero prints.
  Day 4's calibration test is the hard deadline on that (the BlockML spike
  may reroute how parts get authored, but not that deadline). Nothing
  deployed yet (no D1/KV bindings, no domain). Journal day goals and plan
  day steps have drifted apart; plan wins from tomorrow.
- Tomorrow's first task: real cup + bottle photos on a phone, a timeboxed
  BlockML spike on one part, then Day 3 per the plan: virtual builder
  viewer with grid snapping on the scanned toy's stand-in body.

---

## Day 3 — Wed Oct 28: Augment + AR try-on (today, day 3 of 10)

Goal: snap-on parts tray + true-scale AR preview (wireframe p.4).

### Start of Day
- [x] One thing that must work by tonight: scan -> build on the grid ->
  try the part on at footprint scale, end to end in the browser.
- [x] Parts to build first (from the 24-part hero set): the 8-part base
  set already in sets/base.json (Spoiler, Brick 2x2 small + large, Forge
  Mount, Dragon Wing, Glow Star Capsule, SU05 beam teaser, Racer skin).
  The other 16 wait for proof the first 8 fit and print.
- [ ] AR: which device/browser are you testing on? So far: headless Chrome
  on desktop only. Real phone (Android Chrome for the AR button) still owes.

### Midday (13:09)
- Done since last night, committed: virtual builder (isometric canvas,
  drag/snap/collisions/undo, per-toy saved builds), mini game driven by
  build stats, fit-filtered Market, seeded daily Packs, STL downloads,
  GLB pipeline (OpenSCAD 2026.10.11 is installed now; all 8 parts render
  to manifold STLs, Day 2's "no OpenSCAD" blocker is gone), Reveal with
  saved character cards + synth theme, offline PWA shell.
- Done this morning, not yet committed (Muse session only): SAM outline
  now persists on scanned toys; AR try-on crops to the outline and places
  the part's real GLB at footprint scale (verified visually in a browser
  after three fixes the screenshots caught); Muse Image skins live in
  the Toybox, probed and verified through our own Worker. 56 tests green.
- BlockML spike outcome: MachineBlocks bricks would fit the 16mm grid at
  x2, but a CC BY-NC-SA vs Apache-2.0 conflict in their sources
  hard-gates adoption. Hand OpenSCAD stays canonical; license email
  drafted (decisions 0002-0004), not sent.
- Name change: ToyForge is now **ToyVentor**, and toyventor.com is
  secured. "ToyForge" was already in use by others in toys, so the new
  name was chosen and the domain registered before anything public
  launches. Forward-facing surfaces renamed (app title, package, Worker
  name, spec/plan docs); historical entries and the license email keep
  their context, and trademark clearance beyond the domain is still
  unverified and on the pre-publish list.
- Still to do today (Dan): real cup + bottle photos on a phone; print the
  calibration piece and 1-2 Snap samples ahead of Day 4's gate; decide
  on sending the license email; try AR on Android Chrome.
- Still to do today (agent lanes): deploy prep + ownership backend
  against local D1/KV, SAM mask decoding for cutouts/attach points,
  Live Play mood buttons, STEM gear challenge.
- Note: plan.md day themes now run ahead of this journal's (Packs/Market/
  game/Reveal landed early). Treat plan.md scope-freeze dates as canonical.

### End of Day
- Shipped (committed earlier today): virtual builder + mini game +
  Market/Packs + STL/GLB pipeline (c64839f), Reveal + offline PWA (76e5c48),
  SAM outline try-on + Muse Image skins + Live Play mood buttons (2543997),
  app restyled to the design guide, Toybox as landing page
  (uploads + built-ins), ToyForge -> ToyVentor rename incl. Worker name
  (fce89a6), and the D1 ownership backend with device sync (7415b83).
- Later Day 3, now landing: a hidden-calibration first-print selector —
  compliant sockets in the small stud profile plus a one-piece
  `forge-mount-first-print` whose breakaway strip carries three dotted
  sockets (snug / standard / easy) and a loose test brick, with the choice
  logic and tests in `shared/calibration.ts`. No standalone calibration task
  ever reaches the user; the five-step calibration piece stays an
  engineering tool.
- Parts geometry fork, surfaced and recorded: PartSpec landed under
  `docs/PartSpec/` — a Python/manifold3d generator on one 12.5 mm TU
  lattice (Snap Small 12.5, Large 25, Pro 12.5) with 60 catalog parts
  passing its geometry + measured-fit gate in scratch. Decision 0005
  (proposed) makes it the geometry canon only after the Large hand-feel
  print passes, freezes new 16/32 mm app-lane geometry in the meantime, and
  sketches the merge back into the app. A fail-closed bridge
  (`scripts/bridge-partspec.ts`, `shared/partspec.ts`) already converts a
  6-part TU demo subset into `sets/partspec-demo.json` (validates, ships
  nowhere yet), and the first TU print in the queue is the PartSpec Large
  2x2 for that hand-feel check — ahead of rebuilding the selector on TU.
- SAM mask spike (decision 0006): real masks are available inline in the
  sam-3.1 stream and Meta's official `@meta-sam/parser` decodes them in
  scratch (cup silhouette + handle, 72.1% coverage). Not integrated:
  license check first, box-only path stays the fallback. This is also the
  2D half of the scan export PartSpec's hugging/clip-on shoes wait on.
- Docs organised: a `docs/README.md` index (start-here, both parts lanes,
  decision index), PartSpec de-duplicated to one `specs/` snapshot plus a
  pointer README, the duplicated wireframes PDF dropped, and
  `snap-samples.md` bannered as the 16/32 mm app-lane prototype record.
  `.gitignore` now also covers the Muse memory lock and the nested
  PartSpec `pkg/` repo (standalone, to be pushed separately).
- Demo-able right now: yes, scan -> build on grid -> AR try-on at footprint
  scale -> game boost -> STL export -> Reveal, in the browser on desktop.
  The tonight-must-work item is met.
- AR try-on: working on desktop Chrome (outline crop + GLB at footprint
  scale, screenshot-verified this morning). Real phone / Android Chrome
  still untested, carries to Day 4.
- Blockers: still no physical print from either lane (Day 4 decides the
  Large hand-feel condition, then the TU selector rebuild, then real
  clearances and the one-size call); license email drafted (0004), not
  sent; toyventor.com route not attached yet (deploy preflight script now
  names the exact wrangler steps); stats vocabulary between the app's 4
  and PartSpec's 19 needs a game-design decision before a PartSpec set
  ships.
- Tomorrow's first task: Day 4 per plan.md — print the PartSpec Large 2x2
  for the hand-feel condition, then the calibration piece + 1-2 Snap
  samples, settle one-size vs two.

---

## Day 4 — Thu Oct 29: Pack Rips

Goal: daily pack, 3 items, 1 printable guaranteed, rarity + one stat (wireframe p.5).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] Pack odds/content table defined? Paste it here:
- [ ] Muse Image skins: which prompts are you pre-generating?

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- Every pack item works in AR + game (yes/no):
- Blockers:
- Tomorrow's first task:

---

## Day 5 — Fri Oct 30: Merge Forge + Recycle

Goal: 2-3 donors in, 1 toy out, max 2 new adapters (wireframe p.6).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] The 6 merges: which 2-3 are you building first?
- [ ] Adapter budget check: any merge needing >2 new adapters? Cut or redesign:

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- Forge needs at most 2 new adapters (yes/no):
- Blockers:
- Tomorrow's first task:

---

## Day 6 — Sat Oct 31: Market + Print

Goal: fit-filtered market + support-free STL export (wireframe p.7-9).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] Market fit filter (My Toys): mount + size class check working?
- [ ] Print: which part gets the first real STL export + test print?

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- Market top results always fit scanned toy (yes/no):
- Blockers:
- Tomorrow's first task:

---

## Day 7 — Sun Nov 1: Color + Play

Goal: AR color preview + mini-game equip (wireframe p.10-11, stretch: color).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] Color: full masks or cut to AR preview only?
- [ ] Mini game: toy loads + physical add-on gives boost (yes/no)?

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- Scan-to-game loop working on phone (yes/no):
- Blockers:
- Tomorrow's first task:

---

## Day 8 — Mon Nov 2: Reveal + Theme song

Goal: entrance animation + 15s theme song + character card, plays once then saves (wireframe p.12).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] Song service: cached per character id? Fallback if generation fails:
- [ ] Minimo clips tagged (finish/equip/win/idle) for car + figure rigs?

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- Reveal plays animation + song once, then saves (yes/no):
- Blockers:
- Tomorrow's first task:

---

## Day 9 — Tue Nov 3: Polish + Demo

Goal: full demo run on phone, in demo time. No new features after today.

### Start of Day
- [ ] Feature freeze declared? Remaining cuts:
- [ ] Demo script written (scan car → colored upgrade in game)?
- [ ] Seed content pre-generated so demo never waits (yes/no)?

### End of Day
- Shipped:
- Full demo run time (minutes):
- Demo-able right now (yes/no, what):
- Blockers:
- Tomorrow's first task:

---

## Day 10 — Wed Nov 4: Submit by 9 PM ET

Goal: submission in. No code after 6 PM ET, to buffer for the form, video, screenshots.

### Start of Day
- [ ] Submission checklist: video recorded, screenshots taken, description drafted?
- [ ] Track + theme stated on the entry?
- [ ] Hard stop time for code today:

### End of Day (after submitting)
- Submitted (yes/no, time):
- Entry URL:
- What I'd do with one more day:
- See you at finals Nov 9.
