# ToyVentor: Spec (toyventor.com)

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
labs, ten playable vehicles across Maker Ranks 1-6, and the authored mission
set: `13` mission instances across the `12` authored levels, in `11` mission
types. A level composed at run time adds `1` to `3` more stations.



- **Canonical behavior:** this file.
- **Direction:** [vision.md](vision.md).
- **Submission story:** [submission-vision.md](submission-vision.md).
- **Run:** [demo-script.md](demo-script.md).
- **Status:** November 4, 2026; `npm test` and `parts/partspec/catalog.json` carry the live counts.
- **Geometry:** the 12.5/25 mm TU lattice in
  [parts-tu-spec.md](../parts/parts-tu-spec.md); legacy 16/32 mm rows are frozen.

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
(`room <-> garden <-> beach <-> junk <-> snow <-> sky`), six lesson labs, 13
mission instances across the 12 authored levels, in 11 mission types, 12 calm
Town Sparkle tidy spots, daily three-part packs, six parent-started moods,
Character Card reveals, and Create/Editor sheets.
Missions support test, forge, or defer actions; only Learn missions count for
this demo.

- The stage boots calm by default with Toy Box, Build (`Character` and
  `Vehicle` archetypes), Create, Pack, Worlds, overflow, and the 1.2s hold
  Grown-ups gate (`⚙️`); only Pack Rip and Reveal take the full stage.
- Zero-reload in-place switching runs across Kip on foot and ten playable
  vehicles (starter `Red Racer` plus all nine Rank 2-6 vehicles through Rank 6
  `Bolt Power Pro`), backed by live STL hero rigs with bounded caching and
  procedural fallback, plus per-vehicle traversal perks (`cruiser`, `sprint`,
  `hauler`, `water-skim`, `sky-lift`, `bolt-mech`).
- Opening any sheet closes the others first; the stage stays live behind them.
- Status transitions never lose placed work, and sleep mode preserves the
  parent path while suppressing play entry points.
- A finished level can end in a song: the app offers "Make a song about it",
  the route names the build and writes the words, Mureka sings one song, the
  audio is measured and cut to whole bars, and the character dances on the
  beat. The finished song is kept in "My songs", so the Kip party can dance to
  it too. A song with no steady beat is not a dead end: it plays as a plain
  song. On in production (`THEME_SONG=on`) and metered: five songs a week a
  device, a monthly budget across everyone.
- The game opens on a title, not straight into play: a toy on the turntable
  with the factory's meshing gears, and three ways in - Play, Build, Create a
  world (`world/titleEntries.ts`; [carousel-modes-ladders-spec.md](../specs/carousel-modes-ladders-spec.md)
  section 17, item 1). The stage behind it never went away; what came back is
  the menu to leave it and a boot that waits for it.
- The dog follows Kip and sits when Kip stops: it stays home until the two have
  met (it hops, delighted), then it trots after him and stops a couple of
  units behind, on the side opposite the way he last walked, and when Kip has
  stood still for a while it sits down facing him. A prop in the way sends it
  to the other side, then a little further out
  (`runtime/dogFollow.ts`; [playful-interactions-spec.md](../specs/playful-interactions-spec.md)
  section 6).
- Kip does things on his own: a wave, a clap and a dance, played from the
  Mixamo clips the repo ships, after 30 to 60 s of standing still and then
  every 45 to 120 s. He turns to face the camera for them and back afterwards,
  and walking or a tap pulls him out (`runtime/idleBehavior.ts`). A win plays
  the real Mixamo cheer and fist pump.
- The outdoor worlds have things to do: a fruit basket, trees named for their
  fruit, a pumpkin patch whose pumpkins sit in the leaves, a snow angel patch,
  a bunny, a picnic blanket, a swing, a flower bed, a puff cloud, and a day
  and a night look. The real Mixamo jump, shove and walk are used
  (`runtime/outdoorProps.ts`).
- The Toy Room has a mess and a way out of it: the juice cup spills and the toy
  box tips into a heap, and a 60 px **Clean** button on the card rights the box,
  flies the toys home with a count and mops the puddle in six strokes. It is a
  button a child taps; nothing listens for the spoken word. Two more doors:
  the cleaning cart (x 8) opens the cleaning level and the hob (x 10) the
  cooking one, and the Map rungs `daily.clean` and `daily.cook` reach them.
- Kip's modular 3D rig (`public/kip/Kip-Demo.html`) ships wardrobe and vehicle
  parts, Selfie / Smart Face, `Describe & Build` (10 curated assemblies,
  `fit_matrix` connector validation, and an 8 mm-margin non-overlapping
  exploded-view timeline), colour-grouped `.3mf` Plate Print view with 1:1
  sticker sheets, procedural animation, Mixamo, and GLB export.
- **Tools > Pick it up** is the camera flow, and the flagship: a full-screen
  live camera view (a browser feature - `getUserMedia`, inline and muted,
  clear of the notch and home bar), so it needs https. The child taps or types
  what the object is, or simply presses the shutter and the Worker names the
  main thing in the picture (`POST /api/scan {nameIt}`, screened: never a
  person, a body part or a surface). SAM finds that word through the print
  panel's own scan, the object is cut out of the frozen frame where it lies,
  lifts off and flies into Kip's hand. A workshop-prop word (guitar, frying
  pan, mop...) gives Kip the bench's own prop and its clip, so a captured
  guitar strums; any other word gives the household 3D item the scan matched,
  coloured from the photo; with neither, the cut-out itself goes in his hand
  as a flat card on a handle, so any object works. After the Workshop closes,
  the game's Kip is holding it (`runtime/pickupHeld.ts`), and a tap on Kip or
  the chip puts it away. After a pick-up, **Make a song about it** appears,
  but only when the song route says it is on.
- The song player has Pause and Play, Stop, and a mini karaoke that follows
  the song's own line times, with a docked card, "New words" and an animated
  wait.
- The app installs: a real manifest, icons and home-screen tags. iOS ignores
  the manifest's icons, so it gets its own 180 px PNG.
- The game's default Kip is the Kip demo's Kip: the kid head with its inset
  face plate, the demo's face, skin tones, a tee, jeans and orange boots.




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
  Rank 6 `Bolt Power Pro` ([xp-system-spec.md](../specs/xp-system-spec.md)).
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
torque, derives 1-3 rarity values, includes Snap, Pro, Motion, and Pro Powered Add-On
parts on the 12.5/25 mm TU grid, populates meshes and warnings, and emits five
tuned sets (63 entries total, 62 printable):

- `base.json`: 13 printable parts plus one non-printable skin.
- `racer-garage.json`: eight parts.
- `kip-wardrobe.json`: nine parts.
- `modular-craft.json`: 19 flat-pack watercraft and aircraft parts.
- `mech-robotics.json`: 13 Pro steering, Motion, and Bolt Power Pro parts.

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
The one thing that does leave it is a child's voice, and only under the demo
exception below.

| Feature | Status |
| --- | --- |
| Scan outline | SAM 3.1, live. The camera pick-up also uses it, and the hosted vision model names the object when the child does not say what it is (screened: no people, body parts or surfaces). |
| Skins & Kip Smart Face | Muse Image + SAM 3.1, live (Smart Face opt-in). |
| Create worlds | Muse Spark, live with validated recipes + word-parser fallback. |
| Kip Describe & Build | Live: `POST /api/describe` reads the child's words and picks one of ten `fit_matrix`-validated builds; the curated recipe book is the offline fallback. |
| STEM drafts | Muse Spark, human-reviewed. |
| Forge AI Recipe v1, Scan Assist, Build Coach | Stretch ([forge-ai-spec.md](../specs/forge-ai-spec.md)). |
| Voice transcription | **Demo exception, live since 2026-11-04.** The Describe & Build microphone posts to `POST /api/transcribe`, which runs Meta's hosted `muse-voice-transcribe-1.0`. It is on only because `TRANSCRIBE_BACKEND=hosted` is set explicitly on the Worker: an unset switch, `MODEL_BACKEND=hosted` and `DEFAULT_MODE` all leave it off, so deploying the code never sends a child's voice to Meta by itself. The page converts the recording to a 16 kHz mono WAV and the words get the same scrub, cap and kid-safe check as any other route. Per [decision 0008](../decisions/0008-meta-models-and-under-18-users.md) this is a demo-only exception, run by adults, to end by unsetting `TRANSCRIBE_BACKEND`; self-hosted Whisper large-v3-turbo (MIT) stays the plan for children, and that server is written, not deployed. |
| Theme song for a build or a level | **Live since 2026-11-04** (`GET /api/theme-song` answers `enabled:true`). `POST /api/theme-song` has the text model write a name and the words, `shared/songLyrics.ts` builds the lyrics, and Mureka sings one song. Off unless `THEME_SONG=on` and the Mureka key is set; metered at five songs a week a device and `SONG_MONTHLY_BUDGET` a month across everyone. The finished song is copied to R2 so it outlives Mureka's 30-day link. The Reveal entrance theme is still the synth. |

Two rejections stand: models never emit raw untrusted meshes (models may only
propose parameters or part assemblies that deterministic gated code builds and
verifies, because one failed kid print collapses the pitch), and no song is
generated during play (latency and mood whiplash). The theme song is a
"making" artifact, not play: it is ordered at the end of a level or a build,
takes about a minute, and is cut to whole bars so the character can dance on
the beat.


## What is real in the demo

| Feature | Live | Mocked or pre-made |
| --- | --- | --- |
| Scan | SAM 3.1 outline and mask anchor | Seed toy backup |
| Builder | Grid snapping, live checks, two-archetype Build sheet | Part library made ahead |
| Play | Live STL hero rigs + procedural fallback, 6-district ring, STEM XP | Town Phases B-E stretch |
| 3D print | Verified STL/GLB + Kip `.3mf` plate & sticker packs | Delivery handoff; `F1`/`F2` bench coupon pending |
| Reveal | Entrance animation, card, synth theme | The Reveal entrance keeps the synth; the Mureka song is a separate route |
| End-of-level song and dance party | The name and the words, the song cut to whole bars, the character dancing on the beat | The song itself is ordered from Mureka and takes about a minute; it is on in production (`THEME_SONG=on`) and metered |
| Describe & Build | The model picks one of ten validated builds, with an exploded view and a build animation | Inventing new builds is local only; the hosted validator is not deployed |
| **Camera pick-up** | A full-screen live camera view, the object named (typed, or by the Worker), cut out of the frozen frame and lifted into Kip's hand; the game's Kip holds it afterwards | Needs https, so the live site or localhost; the real SAM and the real naming model were run on five public photos (2026-11-04: the right name 5 of 5, an outline 5 of 5, the teddy bear's scarf cut it to its head), but not on a real phone's camera |
| Song player | Pause and Play, Stop, and a mini karaoke on the song's own line times, with a docked card, "New words" and an animated wait | The song itself comes from the metered theme-song route |
| Cleaning and cooking levels | The mess and the Clean button, the vacuum, the mop and the soapy sponge; crack, pour, flip and serve pancakes | Not verified end to end in a browser; the paid step is 25 English lines and 14 prop-name clips |
| Title menu | The toy on the turntable and the factory's meshing gears, with Play, Build and Create a world | It was removed with the old HTML stage on 2026-11-02 and brought back on 2026-11-04 |
| Packs | Seeded daily pulls with equip flow | Billing |
| Pro & Pro Powered Add-On lines | TU-lattice beams, pins, gears, Motion, Rank 6 powered-module trays | Live electronics bench test pending |

Every bridged printable part ships a real STL/GLB pair (`62` STL/GLB pairs in
`public/parts-stl` and `public/parts-glb`; `370` STL and `64` GLB files served
across `public/`). Geometry, placement, and digital assembly fit are exact;
physical print fit (`F1_printed_fit`, `F2_breakage`) stays marked prototype
until bench coupons are logged. Print files stay hidden until four checks
pass; calibration uses a fixed primer and hidden-dot first-print selector. The
Reveal entrance theme remains a synth placeholder; the Mureka theme song is a
separate route for a build or a level. Glass is reserved for focus surfaces;
child-facing copy uses brand tokens while Pro tools keep technical readouts and
exact engineering wording.

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
deliberate hold plus a short-lived proof token (5 minutes in the every-time
mode, 10 minutes in the sitting mode, `worker/parent.ts`); the child UI never
shows balances, PINs, answers, or remaining-time numbers.

The camera pick-up sends the frame to the hosted vision model for an outline
and, when the child does not say what it is, to name it. The photo is never
stored or logged, only the count of names; the names are screened like every
other model word a child sees - no people, body parts or surfaces, nothing the
kid-safe lists refuse, one or two plain words (`worker/nameIt.ts`). The hosted
model's terms are for adults, so the camera flow is adult-operated for the
demo ([decision 0008](../decisions/0008-meta-models-and-under-18-users.md)).

Named assistant modes have fixed jobs: Bench tests and reviews printable
files; Print recommends material and orientation; STEM ties missions to
challenges; Ship guards packaging, labels, and sustainability; Toybox explains
search, size, and request state; Orders tracks mock ordering; Parents manages
approvals and visibility; Ideas stays within toys and tasks; Challenges runs
lessons and records scores only through locked routes. Web search and market
lookup stay in labeled chat, return cited sources, offer no clickable
affiliate path, and store nothing.

## ToyVentor Snap

Snap details live in [snap.md](../parts/snap.md). Geometry is labeled ages 3+
with small-parts warnings; only the Small size is offered while Large stays
parked. Normative geometry lives in the generated PartSpec copy linked there.

## ToyVentor Pro

Pro details live in [pro.md](../parts/pro.md). Pro is 8+ mechanical parts on
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
  per [app-continuation-spec.md](../specs/app-continuation-spec.md).


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
  ([forge-ai-spec.md](../specs/forge-ai-spec.md)).
- **Live `Muse Spark` behind `Describe & Build`:** Wire `/api/muse/spark` to
  propose multi-part assemblies checked by `fit_matrix` and the 8 mm exploded
  timeline, falling back deterministically to the curated recipe book.
- **Parametric `Recipe v1` + `F3` Repair Loop:** `Muse Spark` proposes bounded
  slot parameters (`crown`, `head`, `back`, `hand`, `hood`, `roof`, `spoiler`)
  compiled by `kip_partspec_sdk.py` with up to four automated gate-repair turns.
- **Finish it (`F6`): from a prototyped brick toy to a smooth, polished one:** the
  snap-part build stays the prototype; Finish merges it into one polished toy with
  fewer constraints (no studs, sockets or seams where nothing attaches) and more
  about how it works and how it looks (blended joins, one finish, moving parts kept
  clear), as a game mesh and a print STL from the same result. Printing comes first:
  one piece, or as few pieces as it needs, each gated. The model picks a look
  from a closed list; deterministic code makes and checks the geometry, and the
  brick build is kept so Finish is undoable ([forge-ai-spec.md](../specs/forge-ai-spec.md), F6).

### ToyVentor Town Phases B-E stretch ([toyventor-town-vision.md](../specs/toyventor-town-vision.md))

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

### Physical-to-digital `SAM 3.1` + `Muse` stretch ([forge-ai-spec.md](../specs/forge-ai-spec.md), [scan-to-3d.md](../specs/scan-to-3d.md))

- **Kid Sketch / Clay -> Printable Snap Part:** `SAM 3.1` segments a paper
  drawing or clay sculpt off the table -> `Muse` assigns slot and stat ->
  deterministic contour extrusion/loft adds a verified `12.5 mm` TU snap socket.
- **Physical Build -> Digital Twin Sync:** One desk photo segmented by
  `SAM 3.1` across printed modules (`head`, `hat`, `wheels`, `chassis`) and
  matched by `Muse` against `ai_catalog.txt` into a playable `toyventor.toy/1`
  build, lifting custom marker/sticker art via `Muse Image`.
- **Living-Room Course -> Playable 2.5D Level:** `SAM 3.1` segments floor props
  (`book`, `cup`, `pillow`, `box`) from a side photo -> the kit composes a playable
  room-themed `toyventor.level/1` around the pinned props (obstacles follow in `level/2`).
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
  mates, and Rank 6 `Bolt Power Pro` runs emit grounded `(mask, grasp_anchor,
  mm_scale, mass/torque)` priors for real household and sumo robots.


### Time of day and weather stretch ([environment-spec.md](../specs/environment-spec.md))

- **Day and night** (map first, then the 3D worlds on the parallax mid and far
  backgrounds): the same scene with the lights on at night; indoor scenes
  unchanged. The map's two looks are built.
- **Continuous light:** dawn, dusk and a deeper midnight, blended rather than
  switched; **weather** (rain, snow, fog) in the world and on the map.
- **Privacy gate:** weather where the child is needs a location, which the
  Safety and privacy section says is never collected. Ship **manual weather**
  first; **weather by a grown-up-chosen city** only after a policy decision and
  the COPPA review.


## Roadmap

Today: the unified one-stage ToyVentor World (in-process `three.js` 0.183,
standalone page retired) with live STL hero rigs, two-archetype Build, five
bridged part sets, connected 6-district Town Slice 1, accuracy-bonus STEM XP,
Maker Ranks 1-6, Daily Quests, Real-Life Routines, and Kip `Describe & Build` +
`.3mf` Plate Print. Live at `toyventor.com` (2026-11-04). Next: `F1`/`F2`
physical bench coupon sign-off, the self-hosted speech model that ends the demo
exception, and the Stretch Goals above (`Forge AI` `Recipe v1`, Town
Phases B-E, and `SAM 3.1` + `Muse` physical-to-digital loops). Later: weekly
STEM packs, profiles, ordering, licensed IP, classroom tools, and **Max**
(Snap -> Pro -> Max), opening with kid-safe battle bots and missions where play
accelerates real household robotics.


