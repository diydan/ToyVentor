# Hackathon Journal — ToyForge

Meta Global AI Developer Hackathon, Oct 26 – Nov 4 (10 days × morning + evening = 20 check-ins).
Project: ToyForge on toyforge.app. Track: indie. Key phrase: "multi-modal Lego — scan it, augment it, print it, play it."

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
  ingenuity and creativity — with hidden STEM elements inside a gamified, next-gen, AI-powered Lego.
- Demo-able right now: spec + wireframe (12 pages) only, no code yet.
- Blockers: none — idea stage.
- Tomorrow's first task: Scan + Toybox (Day 2).

---

## Day 2 — Tue Oct 27: Scan + Toybox (today)

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
  project — the parts pipeline is exactly the multi-output problem it
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
- Blockers: OpenSCAD not installed here, so zero STLs and zero prints —
  Day 4's calibration test is the hard deadline on that (the BlockML spike
  may reroute how parts get authored, but not that deadline). Nothing
  deployed yet (no D1/KV bindings, no domain). Journal day goals and plan
  day steps have drifted apart; plan wins from tomorrow.
- Tomorrow's first task: real cup + bottle photos on a phone, a timeboxed
  BlockML spike on one part, then Day 3 per the plan: virtual builder
  viewer with grid snapping on the scanned toy's stand-in body.

---

## Day 3 — Wed Oct 28: Augment + AR try-on

Goal: snap-on parts tray + true-scale AR preview (wireframe p.4).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] Parts to build first (from the 24-part hero set):
- [ ] AR: which device/browser are you testing on?

### End of Day
- Shipped:
- Demo-able right now (yes/no, what):
- AR try-on: working / flaky / blocked (details):
- Blockers:
- Tomorrow's first task:

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

Goal: submission in. No code after 6 PM ET — buffer for the form, video, screenshots.

### Start of Day
- [ ] Submission checklist: video recorded, screenshots taken, description drafted?
- [ ] Track + theme stated on the entry?
- [ ] Hard stop time for code today:

### End of Day (after submitting)
- Submitted (yes/no, time):
- Entry URL:
- What I'd do with one more day:
- See you at finals Nov 9.
