# ToyVentor: Spec (toyventor.com)

> Review copy, generated 2026-11-01 from `docs/product/spec.md`. Do not
> edit this file by hand: run `npm run spec:review` after changing the spec.
> The block below is for reviewers. Delete it before publishing.

## What changed since the Oct 27 spec

| Section | Change | Why |
| --- | --- | --- |
| Whole spec, Oct 29 review pass | Demo table, model table, contract, Create mode, Pro, STEM, and Forge Club claims corrected to match the code as built. Dates updated. | A code review against the running app found rows that overstated what is live (Mureka, voice model, pin and gear set, gear ratio challenge, KV). |
| Roadmap | Added the React port decision for ToyVentor World: wrap the engine behind a typed facade, do not rewrite it, three.js upgrade last. All five steps are in locally, ending with three.js 0.160 ES modules and a 12-level screenshot comparison; the standalone page remains the demo path. | The port had been reviewed separately. The decision belongs in the spec, recorded with its actual progress. |
| ToyVentor World | New section. The app and the 2.5D world are now one toy: the Play button opens the world already wearing the kid's build, through the `toyventor.toy/1` contract in the page URL. | The hand-off between app and game was undefined. It is now a documented contract with a stated mapping rule and a stated failure behaviour. |
| Create mode | New section. The model route, the kid-facing rules it holds, and the recipe check. | Create mode now runs on Meta Muse Spark through the Worker's `/api/muse/spark` route, with the game's word parser as the fallback. The spec should say so. |
| Where we use Meta models | Added the Create mode row. | The model list was missing the one place a model writes game content. |
| Demo (90 seconds) | Now points at the full run in demo-script.md, and the beat list covers opening the world with the kid's build. | The old beat list did not include the world or Create mode. |
| ToyVentor Pro | "on ToyVentor's own 12.5 mm hole grid". The example part is renamed from SU05 to TU05 everywhere it appears, including the part id, the source file and the download files. | The part naming now matches the canonical interface standard, which uses TU. |
| Opening line | "brick-building fanatic" instead of naming a construction toy brand. | Public copy carries no third-party brand names. |
| Vision, snap and Pro cross-references | Kept as file names rather than links. | This copy is read outside the repo. |
| Nov 1 sync & stretch goals | Synced shipped five-set bridge (`modular-craft`, `mech-robotics`), live STL hero rigs, connected 6-district Town Slice 1, STEM XP + Maker Ranks 1-6 + Daily Quests + Real-Life Routines, and Kip `Describe & Build` + `.3mf` Plate Print; added dedicated `Stretch goals` section for Town Phases B-E and `SAM 3.1` + `Muse` physical-to-digital loops. | Aligns canonical spec with shipped code while keeping post-freeze generative and Town items clearly separated as stretch goals. |

## How to review

Five things are worth your attention, in this order.

1. **The demo claims are honest.** The "What is real in the demo" table says which
   features are live and which are pre-made or mocked. Check it against what the
   demo actually runs. If a row overstates, that row is the finding. This revision
   already corrected several rows after a code review; check the corrections too.
2. **The toy contract is the load-bearing new piece.** It claims the world comes
   up wearing the kid's build, that a bad contract cannot break the game, and that
   the two part libraries stay separate. Verify in the app: build a toy, press
   Play, and check the title screen shows the toy and the parts land as the
   mapping rule predicts. Sharing the link also unlocks those parts on the
   receiving device; that is now documented. Say so if it reads as a surprise.
3. **The kid-facing rules in Create mode.** The spec now says which rules the
   route's filter enforces and which are prompts to the model only (brands,
   names), and splits the recipe check between the route and the game. Check both
   halves, not the claim. The route also has no rate limit yet; the spec says so.
4. **The React port is complete locally, including three.js 0.160.** The
   Roadmap records a wrap-don't-rewrite decision for moving ToyVentor World into
   React. The facade, canvas host, HUD, Factory/customizer, mission panels,
   Create mode, and level editor exist locally in the Play tab, and the engine
   page now loads three 0.160 ES modules. Nothing in the demo depends on the
   React host. If any section reads as if the upgraded page were published,
   that is a finding: publishing is still the manual republish in Open questions.
5. **The open questions are still open.** The section at the end lists what the
   spec asserts but has not earned. If something in that list has since been
   answered, it should be updated rather than left as a question.

Two things are deliberately not in this spec: the toy contract format table, which
lives with the code that implements it, and the interface standard, which lives
in the PartSpec lane and is canonical there.

---

## At a glance

ToyVentor is one submitted package: a one-stage web app, backend worker, game
lane, parts catalog, docs, and versioned seed data. The child scans or chooses
a toy, rebuilds it from verified printable parts, improves it, plays it in
ToyVentor World, designs and shares new content, and prints the result. The
submission package includes app code, game source, parts, sets, seed content,
and documentation—not marketing pages or external tools.

Package contents:

- Web app (`src/`): one-stage world, Toybox, builder, packs, moods, Reveal,
  Create, editor, and parent gate.
- Backend worker (`worker/`): scan outline, world generation, packs, parent
  gate, ownership, and print/export routes.
- Shared contracts (`shared/`): toy, level, pack, check, calibration,
  parent-time, and SAM boundaries.
- Parts (`parts/partspec/`): generators, catalog, fit matrix, calibration,
  and the app bridge.
- World runtime (`src/features/game/world/runtime/`): the native canvas
  engine (three.js 0.183), in-process — the old `game/` + `public/world/`
  standalone page was retired by the native port.
- Seed content (`seed/`, `sets/`): starters, worlds, levels, packs, and the
  five bridged app sets (`base`, `racer-garage`, `kip-wardrobe`,
  `modular-craft`, and `mech-robotics`).

Verification snapshot: live counts come from `npm test`, the PartSpec
selftest, and the bridge - not this paragraph. Catalog targets live in
`parts/partspec/catalog.json`. The demo surface is the five bridged app
sets (63 entries), six explore worlds connected in a street ring, six lesson
labs, ten playable vehicles across Maker Ranks 1-6, and 44 missions.



- **Canonical behavior:** this file.
- **Direction:** vision.md.
- **Submission story:** submission-vision.md.
- **Run:** demo-script.md.
- **Status:** November 4, 2026; `npm test` and `parts/partspec/catalog.json` carry the live counts.
- **Geometry:** the 12.5/25 mm TU lattice in
  parts-tu-spec.md (../parts/parts-tu-spec.md); legacy 16/32 mm rows are frozen.

## Vision

Keep the toy alive after purchase: let the child rebuild it, take it into a
shared digital world, change it, print it, and share it with parent approval.
Toybox, Forge, Game, and Create stay on one canvas; parents gate time,
content, purchases, and printable files.


## Demo (90 seconds)

1. Scan or choose a starter toy.
2. Equip two upgrades and watch stats move.
3. Complete one garden mission.
4. Open the daily pack and equip the pull.
5. Reveal the Character Card and hear its theme.
6. Open 3D Print and export the support-free STL.

Acceptance: the toy responds on stage, checks gate the export, packs equip
directly, Reveal plays once for a new build, and failures name their cause
without losing work.


## Why

Finished toys go stale because they cannot change. When the same physical toy
can gain new parts, enter new worlds, earn new missions, and become printable
again, play and making reinforce each other. Scanning is the front door:
a photo plus object chip plus size pill plus one SAM outline turns a real toy
into a rebuildable, playable, printable companion in under a minute.


## Two product lines

- **Snap:** younger-child, snap-fit, tool-free parts with one game stat and AR
  behavior. Geometry is labeled ages 3+ with small-parts warnings; the product
  positions Snap support from age 4 with a grown-up nearby (initial playtests
  target 4–9), while the broader builder framing stays 8–16.
- **Pro:** mechanical beams, pins, shafts, gears, and joints for ages 8 and up
  on the same 12.5 mm hole grid. Small gears, pins, shafts, and bushings carry
  choking-hazard warnings.
- Committed catalog targets live in `parts/partspec/catalog.json`; the generator
  marks verification. Pro fit windows sit inside Snap’s calibration coverage.


## Virtual builder

The builder snaps parts, checks four engineering rules, previews 0.2 mm PLA,
hides STL files until the checks pass, and warns before unsupported or small
parts. Completed builds can immediately play, create, reveal, print, or order.
The four checks are on-grid placement, size fit, support-free geometry, and
printer-bed fit. Calibration uses a fixed primer and hidden-dot first-print
selector; resolved prints calibrate both Snap and Pro. Forge tracks scrap and
blocked tools without leaving the sheet.

Build preview, ordering, and Continue have fixed acceptance behavior: Continue
resumes the previous screen, saved toys precede built-ins, and the rest of the
shelf is newest-first with search, size, and name filters. Manual name, kind,
and size entry stays available when scanning fails.


## ToyVentor World

The world is the app: six explore worlds joined into a connected street ring
(`room <-> garden <-> beach <-> junk <-> snow <-> sky`), six lesson labs, 44
missions, 12 calm Town Sparkle tidy spots, daily three-part packs, six
parent-started moods, Character Card reveals, and Create/Editor sheets.
Missions support test, forge, or defer actions; only Learn missions count for
this demo.

- The stage boots calm by default with Toy Box, Build (`Character` and
  `Vehicle` archetypes), Create, Pack, Worlds, overflow, and the 1.2s hold
  Grown-ups gate (`⚙️`); only Pack Rip and Reveal take the full stage.
- Zero-reload in-place switching runs across Kip on foot and ten playable
  vehicles (starter `Red Racer` plus all nine Rank 2-6 vehicles through Rank 6
  `Bolt Power Mech`), backed by live STL hero rigs with bounded caching and
  procedural fallback, plus per-vehicle traversal perks (`cruiser`, `sprint`,
  `hauler`, `water-skim`, `sky-lift`, `bolt-mech`).
- Opening any sheet closes the others first; the stage stays live behind them.
- Status transitions never lose placed work, and sleep mode preserves the
  parent path while suppressing play entry points.
- Kip's modular 3D rig (`public/kip/Kip-Demo.html`) ships wardrobe and vehicle
  parts, Selfie / Smart Face, `Describe & Build` (10 curated assemblies,
  `fit_matrix` connector validation, and an 8 mm-margin non-overlapping
  exploded-view timeline), colour-grouped `.3mf` Plate Print view with 1:1
  sticker sheets, procedural animation, Mixamo, and GLB export.




## Create mode

Create accepts world text, style, gameplay choices, seeded props, tutorial
flags, and one optional custom level. It previews live, rejects small-part and
bed-size errors before save, and cannot change physics, level topology, or the
engine contract. Create and editor changes never corrupt engine state; the
optional custom level ships in exactly one published slot for the demo.
Generated worlds may change sky, music, props, and intro missions, but never
physics or the fixed engine contract.


## STEM XP, Quests & Real-Life Routines

Parent-time limits stay off unless a parent enables them; earned play minutes
remain additive inside the daily cap, and progression stays auditable on-device
(`localStorage["toyforge:progression:v1"]` with ownership sync).

- **STEM XP & Maker Ranks (1-6):** Missions score `1-3` mastery stars from
  attempt count and measurement tolerance, with anti-farming daily delta +
  `0.25x` practice replay caps, `+10%` stat-match bonus, Tier `1-3` mastery
  gates, and Maker Ranks `1-6` (`0` to `2,700 XP`) unlocking vehicles through
  Rank 6 `Bolt Power Mech` (xp-system-spec.md (../specs/xp-system-spec.md)).
- **Daily Quest Board & 11 Concept Badges:** Three deterministic daily quests
  (`+40 XP` once/day) and 11 STEM Concept Badges (`Sprout / Tinker / Master`)
  surface plain-English skills practiced in the Grown-ups summary.
- **Real Life Counts:** Optional parent-enabled offline routines (`+25 XP/day`
  via `"I did it!"` in Toy Box) stamp guilt-free **Workshop Days** that pause
  rather than reset when a day is missed. Weekly STEM pack drops remain parked
  post-freeze.
- Lab missions cover `bridge`, `measure`, `balance`, `lever`, `logic`, `lift`,
  `raft`, `circuit`, `code`, `pattern`, and `clean`.


## Live Play (Game Mode, stretch)

Moods use six named chips and fixed musical scales; stems are made ahead and
crossfaded, never generated during play. Voice is parent-started push-to-talk,
and the app stays fully usable muted with a visible transcript. Playgrounds
stay bounded: each mood reuses the same stage, props, and checklist pattern,
so new audio never implies new mechanics.


## Forge Club

The canonical bridge maps all 19 PartSpec stats onto speed, spin, glow, and
torque, derives 1-3 rarity values, includes Snap, Pro, Momentum, and Mech
parts on the 12.5/25 mm TU grid, populates meshes and warnings, and emits five
tuned sets (63 entries total, 62 printable):

- `base.json`: 13 printable parts plus one non-printable skin.
- `racer-garage.json`: eight parts.
- `kip-wardrobe.json`: nine parts.
- `modular-craft.json`: 19 flat-pack watercraft and aircraft parts.
- `mech-robotics.json`: 13 Pro steering, Momentum, and Bolt Power Mech parts.

App IDs hyphenate PartSpec underscores. The bridge removes the obsolete demo
set and keeps one small compatibility subset for tests. A green bridge alone
does not ship a part: screen imports, safety copy, saved-build compatibility,
and lattice migration are separate product decisions.

## Under the hood

App, Worker, shared contracts, parts package, game lane, seed data, and docs
ship together. The app reads catalog data only through `src/lib/catalog.ts`,
checks only through `shared/checks.ts`, and the Kip demo only through its
same-origin URL. External marketing or tooling may reuse the wording but is not
the product. Secrets stay server-side; app routes remain same-origin,
validated, and rate-limited. Model keys and PIN data never ship to the client.

### Where we use Meta models

SAM 3.1 outlines run Worker-side only through the official parser, prompted
with text like "toy car" rather than clicks; malformed masks fall back to the
bounding box. Muse creates worlds from validated world code and composes loops
from reviewed stems. No toy photo or model weights leave the approved path.

| Feature | Status |
| --- | --- |
| Scan outline | SAM 3.1, live. |
| Skins & Kip Smart Face | Muse Image + SAM 3.1, live (Smart Face opt-in). |
| Create worlds | Muse Spark, live with validated recipes + word-parser fallback. |
| Kip Describe & Build | Curated `fit_matrix`-validated recipe book live; custom endpoint opt-in. |
| STEM drafts | Muse Spark, human-reviewed. |
| Forge AI Recipe v1, Scan Assist, Build Coach | Stretch (forge-ai-spec.md (../specs/forge-ai-spec.md)). |
| Voice transcription (`muse-voice-transcribe-1.0`) | Stretch; demo uses browser speech. |
| Theme songs and loops | Stretch; synth stand-ins today. |

Two rejections stand: models never emit raw untrusted meshes (models may only
propose parameters or part assemblies that deterministic gated code builds and
verifies, because one failed kid print collapses the pitch), and songs are
never generated live (latency and mood whiplash); only the Reveal theme is
generated ahead of time or synthesized deterministically.


## What is real in the demo

| Feature | Live | Mocked or pre-made |
| --- | --- | --- |
| Scan | SAM 3.1 outline and mask anchor | Seed toy backup |
| Builder | Grid snapping, live checks, two-archetype Build sheet | Part library made ahead |
| Play | Live STL hero rigs + procedural fallback, 6-district ring, STEM XP | Town Phases B-E stretch |
| 3D print | Verified STL/GLB + Kip `.3mf` plate & sticker packs | Delivery handoff; `F1`/`F2` bench coupon pending |
| Reveal | Entrance animation, card, synth theme | External song API not wired |
| Packs | Seeded daily pulls with equip flow | Billing |
| Pro & Mech lines | TU-lattice beams, pins, gears, Momentum, Rank 6 Mech trays | Live electronics bench test pending |

Every bridged printable part ships a real STL/GLB pair (`62` STL/GLB pairs in
`public/parts-stl` and `public/parts-glb`; `370` STL and `64` GLB files served
across `public/`). Geometry, placement, and digital assembly fit are exact;
physical print fit (`F1_printed_fit`, `F2_breakage`) stays marked prototype
until bench coupons are logged. Print files stay hidden until four checks
pass; calibration uses a fixed primer and hidden-dot first-print selector. The
Reveal theme remains a synth placeholder until approved stems land. Glass is
reserved for focus surfaces; child-facing copy uses brand tokens while Pro
tools keep technical readouts and exact engineering wording.

One stat per part, always: the moment a part is good at two things it becomes
the default pick and the rest of the library might as well not exist. Rarity
changes look only, never stats.


## What success looks like

A reviewer scans or chooses a toy, equips upgrades, plays a mission, opens a
pack, reveals the card, and exports a printable file in 90 seconds. Failures
stay calm, named, and local.

## Safety and privacy

The assistant is optional and cannot alter results, stats, ownership, scores,
or awards. It never collects names, contacts, locations, photos, or builds,
never sends messages, never opens external links or profiles, and treats every
user as a child. Parents approve contacts and toys, inspect builds and contact
status, and can lock mic, camera, print, purchase, or STEM access without
breaking play. ToyVentor never shows another player’s name, contact, location,
voice, photo, or build unless parents approve it. Grown-up unlock uses one
deliberate hold plus a short-lived proof token; the child UI never shows
balances, PINs, answers, or remaining-time numbers.

Named assistant modes have fixed jobs: Bench tests and reviews printable
files; Print recommends material and orientation; STEM ties missions to
challenges; Ship guards packaging, labels, and sustainability; Toybox explains
search, size, and request state; Orders tracks mock ordering; Parents manages
approvals and visibility; Ideas stays within toys and tasks; Challenges runs
lessons and records scores only through locked routes. Web search and market
lookup stay in labeled chat, return cited sources, offer no clickable
affiliate path, and store nothing.

## ToyVentor Snap

Snap details live in snap.md (../parts/snap.md). Geometry is labeled ages 3+
with small-parts warnings; only the Small size is offered while Large stays
parked. Normative geometry lives in the generated PartSpec copy linked there.

## ToyVentor Pro

Pro details live in pro.md (../parts/pro.md). Pro is 8+ mechanical parts on
the shared hole grid, with choking-hazard warnings on small gears, pins,
shafts, and bushings. Normative geometry lives in the generated PartSpec copy
linked there.

## Open source

Parts, contracts, and published docs are meant to be inspectable; credentials,
private data, model weights, and unreleased content are not. Generators,
catalog, fit matrix, calibration, bridge, contracts, and game source ship in
the repo; secrets, PIN hashes, photos, and model weights never do. No console
copy, remote kill, customer data, device claims, inflated claims, or unlabeled
mic/camera use.


## Hackathon build order

Freeze one tap target per screen, stable demo data, calm failures, and the
existing 90-second flow. Ship remaining controls only behind working buttons;
remove or finish dead ends before recording. Preload the demo toy first on the
shelf and keep a pre-saved build ready for the Build beat. Performance is
front-loaded with 2.5D worlds and bounded DOM/WebGL; global scaling, tested
upgrades, and final compliance come after submission.


## Open questions

Things this spec asserts but has not earned yet:

- Will a SAM mask from a wobbly, badly lit phone photo give a usable size and
  attach point, or does the parent end up nudging a slider every time? Shiny
  or translucent toys are the main worry.
- Can one snap-fit clearance work across home printers, or does the
  per-printer offset become homework nobody does? The `F1` calibration print
  has started (`F1_printed_fit` and `F2_breakage` stay false until physical
  bench coupon caliper measurements are logged); the honest fallback is one
  size on one known-good profile, stated plainly.
- Does the “printed part gives a game boost” loop motivate, or punish kids
  without a printer? A guess, not evidence.
- Do Pro humanoid parts prove the one-system claim? They still need standard
  typed connection metadata and demonstrated Snap mates or fit-checked
  adapters.
- When does validation stop living in three places? Worker, game, and app
  each check shapes separately; one shared content package would end that.
- Weekly-pack rarity source and Phase 5 pack cadence remain parked post-freeze
  per app-continuation-spec.md (../specs/app-continuation-spec.md).


## Stretch goals

Everything below stays out of the blocking November 4 demo freeze unless the
90-second path, remote D1 migration, and live deploy are already green. Every
generative stretch goal preserves the core safety and fabrication rule:
`SAM 3.1` and `Muse` only emit clean masks and bounded JSON recipes; gated
deterministic code verifies every connector, overhang, small-part screen, and
physics check.

### Near-term stretch (Worker + existing validators)

- **Scan Assist (`A1`) & Build Coach (`A2`):** `Muse Spark` proposes ranked
  open-vocabulary nouns for `SAM 3.1` in `handleScanPost`, and rewrites
  deterministic mission/build check telemetry into one warm kid-safe hint
  (forge-ai-spec.md (../specs/forge-ai-spec.md)).
- **Live `Muse Spark` behind `Describe & Build`:** Wire `/api/muse/spark` to
  propose multi-part assemblies checked by `fit_matrix` and the 8 mm exploded
  timeline, falling back deterministically to the curated recipe book.
- **Parametric `Recipe v1` + `F3` Repair Loop:** `Muse Spark` proposes bounded
  slot parameters (`crown`, `head`, `back`, `hand`, `hood`, `roof`, `spoiler`)
  compiled by `kip_partspec_sdk.py` with up to four automated gate-repair turns.

### ToyVentor Town Phases B-E stretch (toyventor-town-vision.md (../specs/toyventor-town-vision.md))

- **Central `Plaza` & enterable Lab doors (`toyventor.town/1`):** Walk off the
  street directly into `Bridge Works`, `Power Station`, `Code Lab`, and `Water Lab`.
- **In-world NPC quest givers & story chains (`toyventor.quest/1`):** Spoken
  townspeople commissions and the *"Fix Kip's workshop"* arc, plus adaptive
  `Muse Spark` quests generated from unpracticed `CONCEPT_BADGES` and age band.
- **Hard vehicle map gates & Build-to-Spec / Deliver-It quests:** Islands and
  sky ledges gated by vehicle abilities, plus physics cargo and buoyancy checks
  tested against the child's own custom build.
- **Persistent town upgrades, `Makers' Park` & `Music Hall`:** Stars upgrade
  town landmarks; Create mode generates playable mission lots (`Muse Voice
  Transcribe` + `Muse Spark`) shared only via parent-approved family codes;
  rhythm/pitch prop loops in `Music Hall` and voice-only Bedtime mode.

### Physical-to-digital `SAM 3.1` + `Muse` stretch (forge-ai-spec.md (../specs/forge-ai-spec.md), scan-to-3d.md (../specs/scan-to-3d.md))

- **Kid Sketch / Clay -> Printable Snap Part:** `SAM 3.1` segments a paper
  drawing or clay sculpt off the table -> `Muse` assigns slot and stat ->
  deterministic contour extrusion/loft adds a verified `12.5 mm` TU snap socket.
- **Physical Build -> Digital Twin Sync:** One desk photo segmented by
  `SAM 3.1` across printed modules (`head`, `hat`, `wheels`, `chassis`) and
  matched by `Muse` against `ai_catalog.txt` into a playable `toyventor.toy/1`
  build, lifting custom marker/sticker art via `Muse Image`.
- **Living-Room Course -> Playable 2.5D Level:** `SAM 3.1` segments floor props
  (`book`, `cup`, `pillow`, `box`) from a side photo -> `Muse Spark` maps their
  positions and heights into a playable `toyventor.level/1` obstacle course.
- **Upcycle Lab (Cardboard & Bottle Adapters):** `SAM 3.1` measures a household
  box, tube, or bottle next to a printed `1x1 TU` tile -> `Muse` emits
  parametric clip/axle collar recipes that turn household recycling into a toy.
- **Photo Print-Fit & Calibration Doctor:** `SAM 3.1` + `Muse` inspect a photo
  of the printed `1/2/3-dot` calibration coupon to set per-printer XY fit
  compensation automatically.
- **Privacy-Safe STEM Scavenger & Tidy Quests (`Real Life Counts` 2.0):**
  Ephemeral `SAM 3.1` target-noun masks (zero background room pixels stored)
  verify tidy-up deltas and real-home lever/gear scavenger hunts.
- **`Max` Robotics Training Exhaust:** Parent-approved scans, `TU` socket
  mates, and Rank 6 `Bolt Power Mech` runs emit grounded `(mask, grasp_anchor,
  mm_scale, mass/torque)` priors for real household and sumo robots.


## Roadmap

Today: the unified one-stage ToyVentor World (in-process `three.js` 0.183,
standalone page retired) with live STL hero rigs, two-archetype Build, five
bridged part sets, connected 6-district Town Slice 1, accuracy-bonus STEM XP,
Maker Ranks 1-6, Daily Quests, Real-Life Routines, and Kip `Describe & Build` +
`.3mf` Plate Print. Next: `F1`/`F2` physical bench coupon sign-off, live
production cutover, and the Stretch Goals above (`Forge AI` `Recipe v1`, Town
Phases B-E, and `SAM 3.1` + `Muse` physical-to-digital loops). Later: weekly
STEM packs, profiles, ordering, licensed IP, classroom tools, and **Max**
(Snap -> Pro -> Max), opening with kid-safe battle bots and missions where play
accelerates real household robotics.


