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
  three bridged app sets.

Verification snapshot: live counts come from `npm test`, the PartSpec
selftest, and the bridge — not this paragraph. Catalog targets live in
`parts/partspec/catalog.json`. The demo surface is the three bridged app
sets, six explore worlds, six lesson labs, and 44 missions.



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

The world is the app: six explore worlds plus six lesson labs, 44 missions,
daily three-part packs, six parent-started moods, Character Card reveals, and
Create/Editor sheets. Missions support test, forge, or defer actions; only
Learn missions count for this demo.

- The top dock carries the toy pill, Build, Create, Pack, and overflow; only
  Pack Rip and Reveal take the full stage.
- The overflow keeps Moods, Character Card replay, Level Editor, Kip 3D Rig,
  Grown-ups, and fullscreen.
- Opening any sheet closes the others first; the stage stays live behind them.
- Status transitions never lose placed work, and sleep mode preserves the
  parent path while suppressing play entry points.
- Kip’s modular rig has 73 entries with wardrobe and vehicle parts, custom
  uploads, procedural animation, Mixamo, exploded view, and GLB export; its
  enlarged controls stay legible without losing engineering precision.




## Create mode

Create accepts world text, style, gameplay choices, seeded props, tutorial
flags, and one optional custom level. It previews live, rejects small-part and
bed-size errors before save, and cannot change physics, level topology, or the
engine contract. Create and editor changes never corrupt engine state; the
optional custom level ships in exactly one published slot for the demo.
Generated worlds may change sky, music, props, and intro missions, but never
physics or the fixed engine contract.


## STEM mode (stretch, off by default)

STEM stays off unless a parent enables it. Earned play minutes remain additive
inside the daily cap; missions pay once per day; progression stays auditable.
Accuracy-bonus XP and weekly STEM packs are proposed in
[app-continuation-spec.md](../specs/app-continuation-spec.md), not shipped.
The path to robotics runs virtual-first—structures, motion, power, sense,
control, then full robot—with the hackathon covering the first two steps. Lab
missions cover bridge, measure, balance, lever, logic, lift, raft, circuit,
code, pattern, and clean-up; a gear-ratio challenge is not in yet.


## Live Play (Game Mode, stretch)

Moods use six named chips and fixed musical scales; stems are made ahead and
crossfaded, never generated during play. Voice is parent-started push-to-talk,
and the app stays fully usable muted with a visible transcript. Playgrounds
stay bounded: each mood reuses the same stage, props, and checklist pattern,
so new audio never implies new mechanics.


## Forge Club

The canonical bridge maps all 19 PartSpec stats onto speed, spin, glow, and
torque, derives 1–3 rarity values, includes Snap and Pro, populates meshes and
warnings, and emits three tuned sets:

- `base.json`: 13 printable parts plus one non-printable skin.
- `racer-garage.json`: eight parts.
- `kip-wardrobe.json`: nine parts.

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
with text like “toy car” rather than clicks; malformed masks fall back to the
bounding box. Muse creates worlds from validated world code and composes loops
from reviewed stems. No toy photo or model weights leave the approved path.

| Feature | Status |
| --- | --- |
| Scan outline | SAM 3.1, live. |
| Skins | Muse Image, live for seeds. |
| Create worlds | Muse Spark, live with validated recipes. |
| STEM drafts | Muse Spark, human-reviewed. |
| Scene detection, mood reading | Planned, not in demo. |
| Voice transcription | Planned; demo uses browser speech. |
| Theme songs and loops | Planned Mureka API; synth stand-ins today. |

Two rejections stand: part geometry is never model-generated (a generated mesh
cannot promise watertight, support-free, and on-grid, and one failed kid print
collapses the pitch), and songs are never generated live (latency and mood
whiplash); only the Reveal theme is generated, ahead of time.


## What is real in the demo

| Feature | Live | Mocked or pre-made |
| --- | --- | --- |
| Scan | SAM 3.1 outline and mask anchor | Seed toy backup |
| Builder | Grid snapping, live checks, stand-in body | Part library made ahead |
| Play | AR try-on, World with the kid's build | Procedural in-game toys |
| 3D print | Pre-generated STL downloads when checks pass | Delivery handoff |
| Reveal | Entrance animation, card, synth theme | Mureka songs not wired |
| Packs | Seeded daily pulls with equip flow | Billing |
| Pro line | TU-lattice beams, pins, gears on the shared grid | Electronics later |

Every bridged set, part, and payload ships a real STL/GLB pair: 399 STL and 75
GLB files are currently served. Geometry, placement, and fit are exact;
slicer settings are illustrative. Print files stay hidden until four checks
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
  per-printer offset become homework nobody does? The calibration print has
  still not happened; the honest fallback is one size on one known-good
  profile, stated plainly.
- Does the “printed part gives a game boost” loop motivate, or punish kids
  without a printer? A guess, not evidence.
- Do Pro humanoid parts prove the one-system claim? They still need standard
  typed connection metadata and demonstrated Snap mates or fit-checked
  adapters.
- When does validation stop living in three places? Worker, game, and app
  each check shapes separately; one shared content package would end that.
- Roster navigation, weekly-pack rarity source, level-editor choice, Phase 2
  mission set, and STEM ledger enrichment: tracked in the continuation
  roadmap, not answered here.



## Roadmap

Today: the one-stage Toybox with scanning, building, packs, Reveal, and
printing. Next: My Toys roster, accuracy-bonus STEM XP, and weekly STEM packs
per [app-continuation-spec.md](../specs/app-continuation-spec.md). Later:
profiles, AR, ordering, creator tools, licensed IP, mystery drops, education
tracks, original characters, personal play loops, merge forge, recycle,
color tooling, real electronics, delivery integration, and classroom tools.
Beyond them: Max, the real-robots phase (Snap → Pro → Max), opening with
kid-safe battle bots and missions — play as the accelerant for robotics.
Detail lives in the journal's Later entries (Max phase; asset suggester +
ScanDex).
The native canvas port has landed including the three.js 0.183
upgrade; the world renders in-process and the standalone page is gone, so
there is nothing left to republish before recording.


