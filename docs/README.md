# ToyVentor docs

One map for everything in this folder. [vision.md](vision.md) states the
long-term direction; if two documents disagree about product behaviour,
[spec.md](spec.md) wins. If they disagree about part geometry, see
"Two parts lanes" below — that split is deliberate until
[decision 0005](decisions/0005-partspec-lattice-merge.md) resolves it.

## Start here

| File | What it is |
| --- | --- |
| [vision.md](vision.md) | Product vision: robotics through play, one modular system, access model and guardrails |
| [spec.md](spec.md) | Product spec. Canonical for what ToyVentor is and what the demo proves |
| [plan.md](plan.md) | 10-day plan to the Nov 4 submission |
| [journal.md](journal.md) | Dated progress log |
| [wireframe.md](wireframe.md) + [ToyVentor Wireframes.pdf](ToyVentor%20Wireframes.pdf) | The 12 screens |
| [design-guide.html](design-guide.html) + [mockups.html](mockups.html) | Visual design. Open in a browser |

## Creating parts

| File | What it is |
| --- | --- |
| [creating-parts.md](creating-parts.md) | The recurring runbook for new robots, figurines, add-ons and mechanisms: brief, catalog slot, PartSpec gate, assembly proof, app bridge, printing and handoff |

## Product lines (app lane — what the demo runs today)

| File | What it is |
| --- | --- |
| [snap.md](snap.md) | Snap (kid line): part types, design rules, print, game and AR behaviour. Canonical for the line per spec |
| [pro.md](pro.md) | Pro (8+ mechanical line) on the open STEMFIE 12.5 mm grid. Canonical for the line per spec |
| [snap-samples.md](snap-samples.md) | First app-lane sample parts at the old 16/32 mm scale. Prototype record; see decision 0005 before building on it |

## Parts geometry (PartSpec lane)

| Path | What it is |
| --- | --- |
| [PartSpec/README.md](PartSpec/README.md) | Entry point: status, layout, how the snapshot is refreshed |
| [PartSpec/specs/](PartSpec/specs/README.md) | Numbered specs 01–11: interface standard, Snap/Pro/Forge Mount specs, catalog, agent instructions, compliance, licensing, design log |

## Two parts lanes

There are two geometry sources and their parts do not snap to each other:

- **App lane** — `parts/` (OpenSCAD, 16 mm small / 32 mm large) plus
  `sets/base.json`. The builder, downloads and try-on use these numbers
  today. Frozen for new geometry.
- **PartSpec lane** — `docs/PartSpec/pkg/` (Python generator, one
  12.5 mm TU lattice). 60 parts pass its geometry and measured-fit gate;
  nothing printed yet.

Decision [0005](decisions/0005-partspec-lattice-merge.md) (proposed)
makes PartSpec the geometry canon once Dan's Large hand-feel print
passes, then migrates the app to TU footprints. Until that print, do not
mix numbers from the two lanes.

## Decisions

| File | What it decides |
| --- | --- |
| [0001](decisions/0001-react-spa.md) | React SPA, no SSR |
| [0002](decisions/0002-blockml-machineblocks.md) | BlockML/MachineBlocks: adopt beside OpenSCAD, not instead (yet) |
| [0003](decisions/0003-blockml-spike.md) | Spike results: grid proven, licence gate found |
| [0004](decisions/0004-license-email-draft.md) | Draft licence-clarification email (not sent) — appendix to 0003 |
| [0005](decisions/0005-partspec-lattice-merge.md) | PartSpec lattice and the merge back into the app (proposed) |
| [0006](decisions/0006-sam-mask-decoding.md) | SAM mask decoding spike |

Decision records are dated history. They keep the product's old name
(ToyForge) where they describe the past; the rename to ToyVentor on
2026-10-28 is recorded in [journal.md](journal.md) and in PartSpec's
design log.
