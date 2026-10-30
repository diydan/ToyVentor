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
  Mount, Dragon Wing, Glow Star Capsule, TU05 beam teaser, Racer skin).
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

### Addendum — recorded Thu Oct 29
- Closing the Day 3 PartSpec thread: the recurring new-parts runbook
  ([creating-parts.md](creating-parts.md)) and binary-STL support in
  `scripts/stl_to_glb.py` landed on Oct 29 (`d388b74`), with regression
  tests for both STL encodings and independent geometry checks on all six
  demo-subset conversions. This is Day 4 follow-through, recorded here so
  the Day 3 fork does not read as dropped; it does not change the Day 3
  close-out above.
- Still open from Day 3 at the time of this addendum: the first physical
  print from either lane (the PartSpec Large 2x2 hand-feel condition in
  decision 0005 stays first in the queue), the calibration piece +
  1-2 Snap samples, a real Android Chrome AR pass, and the send/don't-send
  call on the drafted license email (0004). The app's 4-stat vs PartSpec's
  19-stat vocabulary gap also remains a game-design decision before any
  PartSpec set ships.
- Also landed Oct 29 and counted as Day 4 work, not backfilled here: the
  product vision + modular-system spec alignment (`ea75f33`) — see
  [vision.md](vision.md) and the Day 4 entry below.

---

## Day 4 — Thu Oct 29: Pack Rips

Goal: daily pack, 3 items, 1 printable guaranteed, rarity + one stat (wireframe p.5).

### Start of Day
- [x] One thing that must work by tonight: Packs show the deterministic daily pack (3 parts, first printable), rarity badges, and one stat per part.
- [x] Pack odds/content table defined? Paste it here: free date-seeded pack, same for everyone; no paid odds or shop. Rarity is display-only: common = stat +1, uncommon = stat +2, rare = stat +3. Epic/legendary colors are reserved for future sets.
- [ ] Muse Image skins: which prompts are you pre-generating?

### End of Day
- Shipped: the hand-off between the app and ToyVentor World, and the model
  route behind Create mode. The game now lives in the repo
  (`game/engine25.js` plus `game/build25.py`, source of truth unchanged)
  and is served from the app's own origin at `/world/ToyVentor-World.html`,
  so Create mode can reach the Worker without a cross-site call. The toy
  contract (`toyventor.toy/1`, base64url in the URL hash) carries the
  kid's toy, the parts they placed, and the paint colors, so the Play
  button opens the world already wearing the build. The Worker gained
  `/api/muse/spark`: it runs Meta Muse Spark, holds the kid-facing rules
  (short lines, safe topics, no identifying details, no brands), and
  checks the recipe against the game's own level shape before sending it
  back. Live check: a snowy world recipe came back in 6.8 seconds. 93
  unit tests green, plus the engine tests for the editor, Create mode,
  parts and the toy contract itself.
- Parts workflow: added [creating-parts.md](creating-parts.md) as the
  recurring runbook for new robots, figurines, add-ons and mechanisms, and
  fixed `scripts/stl_to_glb.py` to accept PartSpec's binary STLs as well as
  the app lane's ASCII STLs. The new regression tests cover both encodings;
  the full app suite is 95 green, and all six demo-subset STL-to-GLB
  conversions were geometry-checked independently. No new part was created,
  and the Large hand-feel print still gates the TU lattice decision.
- Demo-able right now (yes/no, what): yes. Scan, build, Play opens the
  world with the build on it, Create mode writes a world. The 90-second
  run is in [demo-script.md](demo-script.md).
- Every pack item works in AR + game (yes/no): not re-checked this round.
- Blockers: the published game artifacts still hold the old game build,
  so the public game page needs a republish by hand. The e16 mission test
  is flaky in this headless environment (fails at the bridge slot on one
  run, passes on the next, same result on the unmodified engine).
- Parametric 3D parts are still hard to produce at pace while the optimal
  AI-assisted authoring/review workflow is unsettled. The single route must
  be locked by end of Day 5 (Oct 30): frozen lattice, shared
  connector/metadata contract and export path. Until then, broad print
  tests stay blocked; only the existing demo-size control can move.
- Tomorrow's first task: republish the artifacts, then the rename sweep
  (ToyForge) in the landing page and the drafts folder.

### Stretch goal — scan to 3D (recorded Thu Oct 29, 22:50)
- Stretch goal, not in the demo path: a real 3D body for the kid's actual toy,
  from the same photo the scan already takes. Spec drafted in
  [scan-to-3d.md](scan-to-3d.md). Route is a recommendation, not a decision.
- Why it matters: the game can only render three body presets
  (`shared/toycontract.ts:71` — car -> vehicle, figure -> character, anything
  else -> robot), so the coffee cup that proved our segmentation becomes a
  robot. A photo body is what makes the household-object promise real.
- Route: Meta SAM 3D Objects takes image + mask -> GLB, and our scan already
  emits that mask (decision 0006), so there is no second segmentation. Runware
  `meta:sam@3d` is $0.0051-$0.009/run with Zero Data Retention; fal
  `fal-ai/sam-3/3d-objects` is $0.02/unit and returns per-object scale,
  rotation and camera pose. Meta's own Model API hosts no 3D model, so this
  would be a second key or self-hosting.
- Other routes written up in the spec: parametric body from the mask (zero
  cost, exact silhouette, and the honest answer for the 2.5D game), depth-only
  2.5D, library retrieval as a catalog/fallback source, image-to-3D without
  the mask (Meshy/Tripo polycount control, wrong silhouette), multi-view, and
  self-hosted open weights.
- Numbers that decide it: ~$0.006 per scan (about 166 scans per $1) and
  50-105s per mesh. Latency, not cost, is the constraint — so it can only ever
  be a background job with pre-generated catalog bodies, never a step in the
  kid's flow.
- First thing to prove if it is picked up: SAM 3D has no polycount knob, so a
  decimation step is needed, and the parts pipeline is stdlib-only Python
  today (trimesh or Blender would be a new dependency).
- Also landed tonight: a 100-item household scan-target eval set
  (`tests/fixtures/scan-targets.json` + `tests/scan-targets.test.ts`), ranked
  by how likely a kid is to scan each item, each with a one-noun SAM prompt.
  Every prompt is a ready-made segmentation test and a ready-made mask for
  the 3D route.
- Not doing it unless Days 5-9 are green; the preloaded toy still covers the
  demo (plan.md Day 9).

### Stretch goal — parent time gates (recorded Thu Oct 29, 23:18)
- Second stretch goal, also not in the demo path: parents set the rules, the
  kid earns time. Spec drafted in [parent-time-gate.md](parent-time-gate.md).
- The controls: a session timer for right now, and cumulative STEM challenges
  that award minutes, inside a daily limit that earned time can never push
  past. Daily budget, daily limit, session timer and minutes-per-challenge are
  separate numbers doing separate jobs.
- Good news for the scope: the STEM playground already exists — nine panels
  plus the bridge and lift missions — and every completion lands in one place
  (`S.mdone`, written by `mtWin()` at `game/engine25.js:1042`). So this is a
  counter over missions that already exist, not a new STEM library, which
  keeps it clear of the "STEM library + classroom" non-goal.
- Where it would live: two D1 tables beside `ownership` (`parent_settings`,
  `time_ledger`), two Worker routes (`/api/parent/settings`,
  `/api/parent/time`) shaped like the existing `/api/ownership`, one hook in
  the game at `mtWin()`, and the session clock in the app shell rather than
  inside the game canvas. The game reads a budget and reports completions; it
  never writes settings.
- The under-8 tension, taken seriously: snap.md says the game has "no
  timers", and a countdown in the play space would turn a cooperative toy into
  a race. So the session ends by fading out with no number on screen and no
  fail state — the kid never sees a clock, the parent sees the number.
- Also needed: a parent gate, because nothing in the app gates adult settings
  today. Arithmetic gate (long-press plus a two-digit sum) over a PIN — no
  setup, no forgotten PIN, fits the tone.
- The rule that must not bend: the daily limit. If earned time can exceed it,
  parents stop trusting the feature and the app starts to feel like a slot
  machine. The per-challenge award is also capped per day, so a child learns
  "challenges buy minutes", not "grind to win time".
- Scope reality: this touches the game, the app shell and D1 in one feature,
  and has to be mirrored into the React game port under
  `src/features/game/world/`. A Day 8 change at best.

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

### Decision recorded — Fri Oct 30
- No rollover on earned time (parent time gates, stretch spec
  [parent-time-gate.md](parent-time-gate.md)): the day resets at local midnight
  in the family's stored timezone, the daily limit stays put, and yesterday's
  surplus is gone. A child cannot bank time for tomorrow. The ledger is keyed
  by day, so rollover is not even representable — the rule is enforced by the
  shape of the data, not by a check someone has to remember to write.

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
