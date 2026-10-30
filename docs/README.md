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
| [submission-vision.md](submission-vision.md) | One-page hackathon narrative: pillars, demo proof, business sketch and next evidence |
| [spec.md](spec.md) | Product spec. Canonical for what ToyVentor is and what the demo proves |
| [spec-for-review.md](spec-for-review.md) | Generated review copy of the spec, ready to publish. Run `npm run spec:review` after changing the spec |
| [plan.md](plan.md) | 10-day plan to the Nov 4 submission |
| [journal.md](journal.md) | Dated progress log |
| [demo-script.md](demo-script.md) | The 90-second demo run: beats, shot list, backups, pre-flight checks |
| [wireframe.md](wireframe.md) + [ToyVentor Wireframes.pdf](ToyVentor%20Wireframes.pdf) | The 12 screens |
| [design-guide.html](design-guide.html) + [mockups.html](mockups.html) | Visual design. Open in a browser |
| [world-first-spec.md](world-first-spec.md) + [world-first-mockups.html](world-first-mockups.html) | Active UX/UI lane: One-stage World-first UI consolidation spec and interactive mockups |
| [parts-tu-spec.md](parts-tu-spec.md) | Active Parts lane: `12.5 mm` / `25 mm` TU PartSpec, Kip v2, hidden-calibration selector, and physical print loop |

## ToyVentor World (the 2.5D game)

| Path | What it is |
| --- | --- |
| `game/engine25.js` | The game source. One script, the source of truth |
| `game/build25.py` | Builds the single-page game from that source: `npm run build:world` |
| `public/world/ToyVentor-World.html` | The built game, served from the app's origin at `/world/ToyVentor-World.html` |
| `shared/toycontract.ts` | The toy contract: how the app hands the kid's build to the game |

## Drafts (not served by the app)

| Path | What it is |
| --- | --- |
| `drafts/ToyVentor-Landing-Public.html` | The public landing page, renamed from ToyForge. Source for the published landing page artifact |
| `drafts/ToyVentor-Waitlist-Worker.js` | Standalone Worker for the landing page's waitlist form at `/api/waitlist`. Not part of the main app Worker |
| `drafts/ToyVentor-Waitlist-schema.sql` | D1 waitlist table for that Worker |
| `drafts/ToyVentor-PackRip-ToyWorld.html`, `drafts/ToyVentor-Build-Brew-Play.html` | Older prototypes, kept for reference |

## Creating parts

| File | What it is |
| --- | --- |
| [creating-parts.md](creating-parts.md) | The recurring runbook for new robots, figurines, add-ons and mechanisms: brief, catalog slot, PartSpec gate, assembly proof, app bridge, printing and handoff |
| [parts-review.md](parts-review.md) | Full engineering and product-spec review of Snap and Pro part libraries and parametric specs across the OpenSCAD app lane, PartSpec v1, and PartSpec v2 |
| [flatpack-modular-craft-spec.md](flatpack-modular-craft-spec.md) | Multi-pass architecture (`52 -> 15` rigid modules + `3` shape-out flex skins across `4` flat-pack kit cards) adapting `/Users/dan/Code/parts` onto the `50 mm` (`4 TU`) / `12.5 mm` TU modular system for Cars, Trucks, Tractors, Trailers, Bikes, Planes, Boats, Helicopters & Spaceships |
| [progressive-power-system-spec.md](progressive-power-system-spec.md) | Four-stage progressive power & robotics architecture (`Snap → Pro → Momentum → Mech`): shared `4×4×2 TU` Power Core datum + Phase-3 keep-out verification gates for balloon jets/bellows, pull-back rubber-band spools, bumper-trigger auto-actuators, rip-cord gyros, string zip-lines, and drop-in no-solder ESP32 + N20 + 9g servo bricks |

## Stretch specs

| File | What it is |
| --- | --- |
| [scan-to-3d.md](scan-to-3d.md) | Stretch: a real 3D body from the kid's photo, and every route to one. Not in the demo path |
| [parent-time-gate.md](parent-time-gate.md) | Stretch: parent-set session timers and STEM-challenge time earning, inside a daily limit. Not in the demo path |

## Product lines (app lane — what the demo runs today)

| File | What it is |
| --- | --- |
| [snap.md](snap.md) | Snap (kid line): part types, design rules, print, game and AR behaviour. Canonical for the line per spec |
| [pro.md](pro.md) | Pro (8+ mechanical line) on ToyVentor's own 12.5 mm hole grid. Canonical for the line per spec |
| [snap-samples.md](snap-samples.md) | First app-lane sample parts at the old 16/32 mm scale. Prototype record; see decision 0005 before building on it |

## Parts geometry (`parts/` and PartSpec specs)

| Path | What it is |
| --- | --- |
| [`../parts/README.md`](../parts/README.md) | Overview of the unified `parts/` folder (`parts/partspec/` + `parts/scad/`) |
| [`../parts/partspec/`](../parts/partspec/INTERFACE_STANDARD.md) | Self-contained PartSpec v2 Python generator, validator, calibration kit, and app exporter (tracked in repo, `~2.5 MB`) |
| [PartSpec/README.md](PartSpec/README.md) | Entry point: status, layout, how the spec snapshot is refreshed |
| [PartSpec/specs/](PartSpec/specs/README.md) | Numbered specs 01–11: interface standard, Snap/Pro/Forge Mount specs, catalog, agent instructions, compliance, licensing, design log |

## Two parts lanes

Both live under `parts/`, and their parts do not snap to each other:

- **Canonical TU lane (live in app)** — `parts/partspec/` (Python `manifold3d`, one `12.5 mm` / `25 mm` TU lattice, `105` verified parts) + `parts/kip/` (`30`-part OpenSCAD Kip v2 rig). `sets/base.json`, `sets/racer-garage.json`, `sets/kip-wardrobe.json`, and `public/parts-{stl,glb}/` are generated from this lane via `npm run bridge` (see [parts-tu-spec.md](parts-tu-spec.md)).
- **Frozen legacy prototype** — `parts/scad/` (OpenSCAD, `16 mm` small / `32 mm` large). Kept read-only until the `12.5 mm` TU first-print selector and Plate 1 physical print confirm [decision 0005](decisions/0005-partspec-lattice-merge.md). Do not mix numbers from the two lanes.

## Archived v2 handover notes (gitignored)

`docs/part spec v2/` holds the local audit and handover notes from importing
PartSpec v2 (`AUDIT.md`, `REVIEW_PROMPT.md`, `files/HANDOVER*.md`). The
package itself is now folded directly into [`parts/partspec/`](../parts/partspec/INTERFACE_STANDARD.md)
so this repository is self-contained; `docs/part spec v2/` remains gitignored
as local working history.

## Decisions

| File | What it decides |
| --- | --- |
| [0001](decisions/0001-react-spa.md) | React SPA, no SSR |
| [0002](decisions/0002-blockml-machineblocks.md) | BlockML/MachineBlocks: adopt beside OpenSCAD, not instead (yet) |
| [0003](decisions/0003-blockml-spike.md) | Spike results: grid proven, licence gate found |
| [0004](decisions/0004-license-email-draft.md) | Retired licence-clarification draft — do not send; superseded by PartSpec's no-contact decision |
| [0005](decisions/0005-partspec-lattice-merge.md) | PartSpec lattice and the merge back into the app (proposed) |
| [0006](decisions/0006-sam-mask-decoding.md) | SAM mask decoding spike |

Decision records are dated history. They keep the product's old name
(ToyForge) where they describe the past; the rename to ToyVentor on
2026-10-28 is recorded in [journal.md](journal.md) and in PartSpec's
design log.
