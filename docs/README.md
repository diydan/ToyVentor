# ToyVentor docs

One map for everything in this folder. [vision.md](product/vision.md) states the
long-term direction; if two documents disagree about product behaviour,
[spec.md](product/spec.md) wins. For part geometry, the TU lattice in
[parts-tu-spec.md](parts/parts-tu-spec.md) and [PartSpec/specs/](parts/partspec/specs/README.md)
wins: [decision 0005](decisions/0005-partspec-lattice-merge.md) migrated the
app onto it, and the old 16/32 mm lane is a frozen prototype record in
[archive/snap-samples.md](archive/snap-samples.md).

## Layout

Only this index sits at the root. Everything else lives in a topic folder:

| Folder | Holds |
| --- | --- |
| `product/` | Vision, canonical spec and its generated review copy, plan, journal, demo script |
| `ux/` | One-stage World spec, interactive mockups, design guide |
| `specs/` | Feature specs: app continuation, parent time gate, flat-pack craft, progressive power, scan-to-3D |
| `parts/` | Snap and Pro product lines, the creating-parts runbook, the TU parts spec |
| `parts/partspec/` | Numbered geometry specs 01–11 (several generated; see below), inside `parts/` |
| `decisions/` | Dated decision records 0001–0006 |
| `archive/` | Retired docs, each with its superseding document |

## Start here

| File | What it is |
| --- | --- |
| [vision.md](product/vision.md) | Internal long-term product vision |
| [submission-vision.md](product/submission-vision.md) | Tighter hackathon-facing narrative. For the Nov 4 submission, use this |
| [spec.md](product/spec.md) | Product spec. Canonical for what ToyVentor is and what the demo proves |
| [plan.md](product/plan.md) | 10-day plan to the Nov 4 submission |
| [journal.md](product/journal.md) | Dated progress log |
| [demo-script.md](product/demo-script.md) | The 90-second demo run: beats, shot list, backups, pre-flight checks |
| [world-first-spec.md](ux/world-first-spec.md) + [world-first-mockups.html](ux/world-first-mockups.html) | Active UX/UI lane: one-stage World-first UI consolidation |
| [design-guide.html](ux/design-guide.html) | Visual design tokens and components for the one-stage app: top dock, sheets, no tab bar. Open in a browser |
| [parts-tu-spec.md](parts/parts-tu-spec.md) | Active parts lane: 12.5 mm / 25 mm TU PartSpec, Kip v2, hidden-calibration selector, physical print loop |

## Active specs (post-consolidation)

| File | What it is |
| --- | --- |
| [app-continuation-spec.md](specs/app-continuation-spec.md) | Roadmap after consolidation: My Toys roster (Kip + craft), accuracy-bonus STEM XP, weekly STEM packs |
| [parent-time-gate.md](specs/parent-time-gate.md) | Parent time gates and STEM earned play time. Implemented. Its header status is authoritative |
| [flatpack-modular-craft-spec.md](specs/flatpack-modular-craft-spec.md) | Flat-pack modular vehicle and craft system on the TU lattice. References an external parts archive outside this repo |
| [progressive-power-system-spec.md](specs/progressive-power-system-spec.md) | Four-stage progressive power and robotics system (`Snap → Pro → Momentum → Mech`). Plan stage, no code yet |
| [scan-to-3d.md](specs/scan-to-3d.md) | Stretch: a real 3D body from a photo. Recommendation, not a decision. Not in the demo path |

## ToyVentor World (the 2.5D game)

| Path | What it is |
| --- | --- |
| `game/engine25.js` | The game source. One script, the source of truth |
| `game/build25.py` | Builds the single-page game from that source: `npm run build:world` |
| `public/world/ToyVentor-World.html` | The built game, served from the app's origin at `/world/ToyVentor-World.html` |
| `shared/toycontract.ts` | The toy contract: how the app hands the kid's build to the game |

## Product lines and parts

| File | What it is |
| --- | --- |
| [snap.md](parts/snap.md) | Snap (kid line): part types, design rules, print, game and AR behaviour |
| [pro.md](parts/pro.md) | Pro (8+ mechanical line) on the 12.5 mm TU hole grid |
| [creating-parts.md](parts/creating-parts.md) | The recurring runbook for new parts: brief, catalog slot, PartSpec gate, assembly proof, app bridge, printing, handoff |
| [`../parts/README.md`](../parts/README.md) | Overview of `parts/` (`parts/partspec/` + retired `parts/scad/`) |
| [PartSpec/README.md](parts/partspec/README.md) | Entry point to the numbered PartSpec specs: status, layout, how the snapshot is refreshed |
| [PartSpec/specs/](parts/partspec/specs/README.md) | Numbered specs 01–11: interface standard, Snap/Pro/Forge Mount, catalog, agent instructions, compliance, licensing, design log |

## Generated — do not edit by hand

| File | Generated from |
| --- | --- |
| [spec-for-review.md](product/spec-for-review.md) | `docs/product/spec.md` via `npm run spec:review` (`scripts/export-spec.ts`). `npm run preflight` checks it is in sync |
| [PartSpec/specs/01_interface_standard.md](parts/partspec/specs/01_interface_standard.md), [05_catalog.md](parts/partspec/specs/05_catalog.md), [06_agent_instructions.md](parts/partspec/specs/06_agent_instructions.md) | `parts/partspec/` sources via its `make_*.py` generators. Edit the source (`interfaces.json`, catalog, part code), then regenerate |

## Drafts (not served by the app)

| Path | What it is |
| --- | --- |
| `drafts/ToyVentor-Landing-Public.html` | The public landing page. Source for the published landing page artifact |
| `drafts/ToyVentor-Waitlist-Worker.js` | Standalone Worker for the landing page's waitlist form. Not part of the main app Worker |
| `drafts/ToyVentor-Waitlist-schema.sql` | D1 waitlist table for that Worker |
| `drafts/ToyVentor-PackRip-ToyWorld.html`, `drafts/ToyVentor-Build-Brew-Play.html` | Older prototypes, kept for reference |

## Archive

[archive/](archive/README.md) holds retired docs, each with its superseding
document: the 12-screen wireframe and its PDF, pre-consolidation mockups, the
16/32 mm Snap sample record, the raw brain-dump now formalised in
[app-continuation-spec.md](specs/app-continuation-spec.md), and the
point-in-time [parts review](archive/parts-review.md) (2026-10-30).

The PartSpec v2 import bundle that used to sit in a gitignored local folder
was deleted 2026-10-30: its package is folded into `parts/partspec/`.

## Decisions

| File | What it decides |
| --- | --- |
| [0001](decisions/0001-react-spa.md) | React SPA, no SSR |
| [0002](decisions/0002-blockml-machineblocks.md) | BlockML/MachineBlocks: adopt beside OpenSCAD, not instead (yet) |
| [0003](decisions/0003-blockml-spike.md) | Spike results: grid proven, licence gate found |
| [0004](decisions/0004-license-email-draft.md) | Retired licence-clarification draft — do not send |
| [0005](decisions/0005-partspec-lattice-merge.md) | PartSpec TU lattice and the merge back into the app. Migrated in code |
| [0006](decisions/0006-sam-mask-decoding.md) | SAM mask decoding: official parser, Worker-only, box fallback kept |

Decision records are dated history. They keep the product's old name
(ToyForge) where they describe the past; the rename to ToyVentor on
2026-10-28 is recorded in [journal.md](product/journal.md) and in PartSpec's
design log.
