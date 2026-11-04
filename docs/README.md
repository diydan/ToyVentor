# ToyVentor docs

Start with [vision.md](product/vision.md) for direction and
[spec.md](product/spec.md) for behavior. On product conflicts, the spec wins;
on geometry conflicts, [parts-tu-spec.md](parts/parts-tu-spec.md) and
[partspec/specs/](parts/partspec/specs/README.md) win.

**This index lists every file in `docs/`.** If a document is not listed here,
it is a loose end. Status words mean: **landed** = built and in the app;
**draft** = written, decisions made, not all built; **proposed** = a plan
without a decision; **reference** = a third-party surface or a lookup table.

## Start here

| File | What it is |
| --- | --- |
| [vision.md](product/vision.md) | Internal long-term direction. |
| [submission-vision.md](product/submission-vision.md) | External hackathon narrative for November 4. |
| [spec.md](product/spec.md) | Canonical behavior, demo proof, safety, and delivery scope. |
| [plan.md](product/plan.md) | What shipped each day of the hackathon, and what is still open. |
| [demo-script.md](product/demo-script.md) | The 90-second run, stills, and failure replies. |
| [qa.md](product/qa.md) | The one QA document: pre-deploy gates, live smoke, by-hand live checks, real-phone and real-child passes. |
| [journal.md](product/journal.md) | The dated hackathon log, Day 1 to Day 10, plus the "Later" entries. |
| [world-first-spec.md](ux/world-first-spec.md) | Active one-stage UX, dock, sheets, overflow, transitions, and demo path. |
| [design-guide.html](ux/design-guide.html) | Tokens, components, motion, accessibility, and open design needs. |
| [parts-tu-spec.md](parts/parts-tu-spec.md) | Active 12.5/25 mm geometry canon, catalog targets, sets, and print loop. |
| [parts-engineering-spec.md](specs/parts-engineering-spec.md) | The one canonical parts engineering spec: ladder, card manifest, laws, gates, physics, electrical safety, print workflow, asset pipeline. |

## Product (`product/`)

| File | Status | What it is |
| --- | --- | --- |
| [spec.md](product/spec.md) | canonical | Canonical behavior, demo proof, safety, and delivery scope. |
| [spec-for-review.md](product/spec-for-review.md) | generated | Review copy of `spec.md`. Do not hand-edit; run `npm run spec:review`. |
| [vision.md](product/vision.md) | live | Internal long-term direction. |
| [submission-vision.md](product/submission-vision.md) | live | The tight external story for the submission. |
| [plan.md](product/plan.md) | live | The landed-status tracker: what shipped on which day, and what is still open. |
| [journal.md](product/journal.md) | live | The dated log, Day 1 to Day 10, and the "Later" entries for post-hackathon work. |
| [demo-script.md](product/demo-script.md) | live | The 90-second run, the stills to take, and the reply to each failure. |
| [close-out-checklist.md](product/close-out-checklist.md) | live | The submission-day master list (2026-11-04): Dan's chore list mapped to what the repo records, the ship gate, the demo beats, the submission package, and what waits. Points at qa.md rather than copying it. |
| [qa.md](product/qa.md) | live | The one QA document. Merge any new test procedure here rather than opening a new file. |
| [deploy-checklist.md](product/deploy-checklist.md) | live | What a clean export must contain, and the history of the deploy findings. |

## Specs (`specs/`)

### The app and the world

| File | Status | What it is |
| --- | --- | --- |
| [app-continuation-spec.md](specs/app-continuation-spec.md) | **Phases 0-4B + Town Slice 1 landed**; Phase 5 weekly packs parked | The roadmap: top bar and parent gate, enabled roster, STEM XP, vehicles, Town slice. |
| [stage-simplification-and-kip-spec.md](specs/stage-simplification-and-kip-spec.md) | **landed** | `Demo Mode` v1, cog-mesh fix, Kip V2 unification, `#fix` retired. |
| [native-world-port-spec.md](specs/native-world-port-spec.md) | **landed** | Phase 0: the native Vite/React Three.js stage port. `<iframe>` and `public/world/**` deleted. |
| [carousel-modes-ladders-spec.md](specs/carousel-modes-ladders-spec.md) | **C1+C2 and C3 (all six Little-ones rungs) landed**; C4 pick session and kid-band-only C5 decided | Level carousel, age bands, playable Learn runs (38 rungs), the stage Map button and orientation views. |
| [explorer-map-spec.md](specs/explorer-map-spec.md) | live | The branching trail map beside the Map carousel. |
| [play-design-spec.md](specs/play-design-spec.md) | live | Level primitives, recipe format, composition kit, generation pipeline, playtest bar. Owns the level lane and its one ordered Plan. Also: how a level is actually added today (five kinds, traps, pinned tests) and the Activity levels contract (Kip does a real task: the cleaning and cooking levels). |
| [xp-system-spec.md](specs/xp-system-spec.md) | **implemented** | STEM XP scoring, 11 mission tolerances, two-track gating, D1 sync contract. |
| [playful-interactions-spec.md](specs/playful-interactions-spec.md) | **draft; partly built** | Fruit, feeding, sleeping and more. Drag-to-feed works in the real Garden; the grown Describe & Build book is in. |
| [generated-worlds-spec.md](specs/generated-worlds-spec.md) | proposed | Muse-generated worlds and custom backdrops. Feasibility measured against the real service. |
| [environment-spec.md](specs/environment-spec.md) | **draft; map day/night built** | Time of day and weather. Continuous light and weather are post-hackathon; weather by location waits on a privacy decision. |
| [parallax-backdrops-spec.md](specs/parallax-backdrops-spec.md) | **draft; the Garden backdrop is in the game** | Generated-image backdrop planes on stepped depths. |
| [toyventor-town-vision.md](specs/toyventor-town-vision.md) | vision | The destination: open-world Town with districts, quests and a daily rhythm. Extends continuation past Phase 5. |

### The parts and the machine

| File | Status | What it is |
| --- | --- | --- |
| [parts-engineering-spec.md](specs/parts-engineering-spec.md) | **canonical** | The merged parts engineering spec. Read this instead of the eight documents it replaces. |
| [motion-print-test-runsheet.md](specs/motion-print-test-runsheet.md) | live | The values-only bench run sheet. The procedures and pass rules are in `parts-engineering-spec.md` §11.1. |
| [construction-vehicles-spec.md](specs/construction-vehicles-spec.md) | **draft 1** | Bulldozer, excavator and friends. Two road-roller parts are in the catalog; the bulldozer has a lift sweep but no CAD; the rest is a proposal. Nothing is printed. |
| [phase4-vehicle-readiness-audit.md](specs/phase4-vehicle-readiness-audit.md) | reference | The per-vehicle readiness table: unlock gates and names. Not a test procedure. |

### The parent, the privacy and the gate

| File | Status | What it is |
| --- | --- | --- |
| [parent-time-gate.md](specs/parent-time-gate.md) | **implemented** | Parent caps and earned STEM time. |
| [parent-controls-off-spec.md](specs/parent-controls-off-spec.md) | **built** | The showcase switch that turns the grown-up checks and play-time limits off. Photo-upload gates stay on. |
| [coppa-readiness-spec.md](specs/coppa-readiness-spec.md) | **draft; nothing built** | What children's data the build holds, the posture decision, phases P0 to P5, and the wording the entry may use. All deferred until after the hackathon; the condition is that the deployed build stays an adult-operated demo. |
| [workshop-print-gate-spec.md](specs/workshop-print-gate-spec.md) | **draft 2; phases 1-3 built, switched off** | The grown-up question in front of the Workshop's exports and the selfie sticker. Phase 4 and the per-gate switchboard are deferred. |

### The models and the media

| File | Status | What it is |
| --- | --- | --- |
| [forge-ai-spec.md](specs/forge-ai-spec.md) | proposed | Six Muse Spark features (describe it, scan it, repair loop, host fit, build planner, finish it) on one recipe, a gate and repair engine, and five assist features. |
| [sam-physical-to-digital-spec.md](specs/sam-physical-to-digital-spec.md) | draft | `SAM 3.1` + `Muse` photo-to-digital: sketch-to-part, twin sync, room-to-level, real-life quests. Owns the photo lane. |
| [scan-to-3d.md](specs/scan-to-3d.md) | recommendation | The scan-body route choice (Routes A to G), the decimation gate and the eval set. A recommendation, not a decision. |
| [dance-party-spec.md](specs/dance-party-spec.md) | **draft 2; partly built** | Kip headphones, four Mixamo dances with a per-clip quality gate, an AI song maker on Dan's Mureka account (a 12-song starter library and a Dance picker are built; no live song maker Worker yet), a party mode, and the Help cook / Clean up exercise. |
| [mureka-api-reference.md](specs/mureka-api-reference.md) | reference | The full Mureka API surface, read from the platform's OpenAPI document on 2026-11-03. |
| [workshop-spec.md](specs/workshop-spec.md) | **stages 1-4 built** | The Workshop shell hosts the Kip, Truck and Yard benches with one stage, one menu and one print view, and opens in the game as an overlay (downloads off). |

### The household and the weekend

| File | Status | What it is |
| --- | --- | --- |
| [garage-weekend-spec.md](specs/garage-weekend-spec.md) | **draft 2; phase 1 built (2026-11-03)** | The Garage: always open, with a new part, idea or remix every Fri-Sun, age-specific missions, STEM-minute credit and Demo Mode Preview weekend. The real-life leg, parent controls and roof trophies are phase 2. |
| [household-library-spec.md](specs/household-library-spec.md) | **draft 2; phases 2, 3, 4 and 5 built** | 50 everyday objects as 3D parts plus the next ten, matched from a child's word or photo. All 60 have a builder, a game GLB and a catalog entry. |

## Parts (`parts/`)

| File | Status | What it is |
| --- | --- | --- |
| [parts-tu-spec.md](parts/parts-tu-spec.md) | canonical | The 12.5/25 mm TU geometry canon, catalog targets, sets and print loop. |
| [creating-parts.md](parts/creating-parts.md) | live | The runbook for new parts and families, from brief to compatible, conforming, testable part. |
| [snap.md](parts/snap.md) / [pro.md](parts/pro.md) | live | Product summaries. The normative geometry stays in the generated PartSpec copies. |
| [partspec/README.md](parts/partspec/README.md) | generated | The generated readable snapshot. Edit the sources, then regenerate. |
| [partspec/specs/](parts/partspec/specs/README.md) | generated | The numbered standards, catalog, agent instructions and design log. |

The numbered PartSpec standards, in the order to read them:

| # | File | What it covers |
| --- | --- | --- |
| 01 | [interface_standard.md](parts/partspec/specs/01_interface_standard.md) | The standard: lattice, interfaces, checks, fit and tolerance, conformance (generated from `interfaces.json`) |
| 02 | [snap_spec.md](parts/partspec/specs/02_snap_spec.md) | The Snap line: sizes, part types, how parts connect, design and safety rules |
| 03 | [pro_spec.md](parts/partspec/specs/03_pro_spec.md) | The Pro line: base standard, families, pin-and-bore and gear rules, fit, print rules |
| 04 | [forge_mount_spec.md](parts/partspec/specs/04_forge_mount_spec.md) | The Forge Mount: faces, outlines, peg hole, hugging and clip-on shoes, join pins |
| 05 | [catalog.md](parts/partspec/specs/05_catalog.md) | The part catalog and its live status (generated) |
| 06 | [agent_instructions.md](parts/partspec/specs/06_agent_instructions.md) | Rules, commands and part list for AI agents (generated) |
| 07 | [compliance.md](parts/partspec/specs/07_compliance.md) | The US toy-safety checklist and status |
| 08 | [licensing.md](parts/partspec/specs/08_licensing.md) | Licences: code, designs, docs, name |
| 09 | [third_party.md](parts/partspec/specs/09_third_party.md) | The libraries we depend on and their licences |
| 10 | [design_log.md](parts/partspec/specs/10_design_log.md) | The dated design decisions (the independent-design record) |
| 11 | [why_not_blockml_machineblocks.md](parts/partspec/specs/11_why_not_blockml_machineblocks.md) | Why BlockML and MachineBlocks are not used |

## UX (`ux/`)

| File | Status | What it is |
| --- | --- | --- |
| [world-first-spec.md](ux/world-first-spec.md) | live | One-stage UX, dock, sheets, overflow, transitions and the demo path. |
| [world-first-mockups.html](ux/world-first-mockups.html) | live | The interactive mockups for that spec. |
| [design-guide.html](ux/design-guide.html) | live | Tokens, components, motion and accessibility, plus the open design needs. |

## Review (`review/`)

| File | Status | What it is |
| --- | --- | --- |
| [spoken-names.md](review/spoken-names.md) | generated | The native-speaker review sheet for everything the game says aloud. Generated by `scripts/spoken-names-sheet.ts`; edit the vocabulary, not this file. |

## Decisions (`decisions/`)

Dated records `0001`–`0008`. The TU merge in
[0005](decisions/0005-partspec-lattice-merge.md) remains the geometry
authority.

| # | What it decided |
| --- | --- |
| [0001](decisions/0001-react-spa.md) | React SPA as the app shape. |
| [0002](decisions/0002-blockml-machineblocks.md) | BlockML and MachineBlocks are not used. |
| [0003](decisions/0003-blockml-spike.md) | The BlockML spike. |
| [0004](decisions/0004-license-email-draft.md) | The licence email draft. |
| [0005](decisions/0005-partspec-lattice-merge.md) | The PartSpec and TU lattice merge. The geometry authority. |
| [0006](decisions/0006-sam-mask-decoding.md) | SAM mask decoding. |
| [0007](decisions/0007-sam-provider-retention.md) | SAM provider retention. |
| [0008](decisions/0008-meta-models-and-under-18-users.md) | Meta's hosted-model terms for under-18 users. Read this before any claim about children's privacy. |

## Mockups (`mockups/`)

Assets, not documents: the
[generated backdrops](mockups/generated-backdrops/README.md) and the
[parallax prototype](mockups/parallax/README.md). The spec that governs
the backdrops is [parallax-backdrops-spec.md](specs/parallax-backdrops-spec.md).

## Generated — do not edit by hand

| File | Regenerate with |
| --- | --- |
| [product/spec-for-review.md](product/spec-for-review.md) | `npm run spec:review` |
| [parts/partspec/specs/01_interface_standard.md](parts/partspec/specs/01_interface_standard.md), [05_catalog.md](parts/partspec/specs/05_catalog.md), [06_agent_instructions.md](parts/partspec/specs/06_agent_instructions.md) | the PartSpec generator, then `make_specs.py` |
| [parts/partspec/specs/10_design_log.md](parts/partspec/specs/10_design_log.md) | `parts/partspec/DESIGN_LOG.md` is the source; `make_specs.py` copies it |
| [review/spoken-names.md](review/spoken-names.md) | `npx tsx scripts/spoken-names-sheet.ts` |

## Outside `docs/`

- `drafts/` at the repository root holds the public landing source, the
  standalone waitlist worker and schema, and older prototypes for reference.
  It is **gitignored**, so it is a local working folder, not part of the
  submitted package.
- [`../generated/`](../generated/) holds build output, including the
  physical validation coupons. Never edited by hand.

## Archive

[archive/](archive/README.md) holds retired docs with their replacements: the
5-tab wireframe and PDF, pre-consolidation mockups, 16/32 mm samples, the raw
brain-dump, the point-in-time parts review, the eight merged parts engineering
documents, the two merged carousel QA documents, the future-vision pitch draft
and the household-weekends review. Archive entries are history; do not update
them to match today.

## Changing these docs

Keep headings and section order; cut prose, never requirements. Verify changed
facts against code before writing them, and regenerate generated files from
their sources instead of editing them.

**Before opening a new document, check the index above.** A new file needs a
reason that none of these covers, and it needs a row in this index. If two
documents describe the same thing, merge them and retire one: the 2026-11-04
consolidation merged eight parts-engineering documents into one and two QA
documents into `qa.md`, and the archive keeps the originals with a note saying
what replaced them.
