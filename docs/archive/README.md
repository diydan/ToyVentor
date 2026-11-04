# Archived docs

Retired material, kept tracked for history. Nothing here is current guidance.
Each entry says what superseded it.

Archived on 2026-11-04 during the docs consolidation: twelve documents moved
here, because they were superseded, merged, or folded into another file. The
full text of each is **unedited** — the file you read is the file that was
current when it was retired.

## Retired docs

| File | What it was | Superseded by |
| --- | --- | --- |
| [wireframe.md](wireframe.md) + [ToyVentor Wireframes.pdf](ToyVentor%20Wireframes.pdf) | The original 12-screen, 5-tab app wireframe (Oct 28) | [world-first-spec.md](../ux/world-first-spec.md) + [world-first-mockups.html](../ux/world-first-mockups.html), which retire the 5-tab dashboard for the one-stage World |
| [mockups.html](mockups.html) | Pre-consolidation screen mockups for that 5-tab UI | [world-first-mockups.html](../ux/world-first-mockups.html) |
| [snap-samples.md](snap-samples.md) | First Snap sample parts at the retired 16/32 mm OpenSCAD scale | The 12.5/25 mm TU lattice: [parts-tu-spec.md](../parts/parts-tu-spec.md), [PartSpec/specs/](README.md), [decision 0005](../decisions/0005-partspec-lattice-merge.md) |
| [brain-dump.md](brain-dump.md) | Raw working notes for the next app phase (Oct 30) | Formalised in [app-continuation-spec.md](../specs/app-continuation-spec.md) (roster, STEM XP, weekly packs), [parent-time-gate.md](../specs/parent-time-gate.md) (grown-up unlock), and [world-first-spec.md](../ux/world-first-spec.md) (top bar) |
| [parts-review.md](parts-review.md) | Point-in-time engineering review of the Snap and Pro libraries (2026-10-30) | Current geometry truth: [parts-tu-spec.md](../parts/parts-tu-spec.md), [PartSpec/specs/](../parts/partspec/specs/README.md), [decision 0005](../decisions/0005-partspec-lattice-merge.md). Findings are history where later work supersedes them |

## Merged into another document (2026-11-04)

### [qa/](qa/) — folded into [product/qa.md](../product/qa.md)

The one QA document now covers the pre-deploy gates, the live smoke, the
by-hand live checks, the real-phone pass and the real-child pass. These two
files were the old carousel QA checklist and play-test run sheet; their unique
content (the measured robot baseline, the predictions and their basis) was
carried into `product/qa.md` before they were moved.

| File | What it was | Superseded by |
| --- | --- | --- |
| [qa/carousel-qa-checklist.md](qa/carousel-qa-checklist.md) | The quick tick-box real-phone and real-child pass (2026-11-03) | [product/qa.md](../product/qa.md) parts 5, 6 and 7 |
| [qa/carousel-playtest-runsheet.md](qa/carousel-playtest-runsheet.md) | The values-only run sheet: robot baseline, predictions, blanks (2026-11-03) | [product/qa.md](../product/qa.md) sections 5.0 and 6 |

### [parts-engineering/](parts-engineering/) — folded into [specs/parts-engineering-spec.md](../specs/parts-engineering-spec.md)

Eight documents that used to sit beside each other with overlapping
supersession banners. The canonical file carries the live content; these hold
the reasoning, the derivations and the audit tables that produced it. Where
the canonical file and one of these differ on anything in §1–§7 of that file,
the canonical file wins.

| File | What it was | Superseded by |
| --- | --- | --- |
| [parts-engineering/functional-print-mechanics-spec.md](parts-engineering/functional-print-mechanics-spec.md) | The canonical CAD baseline: `D1`–`D3` and `R1`–`R7` review findings, the supersession table, the 8-card manifest, the sign-off gates | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §1–§4, §11 |
| [parts-engineering/progressive-power-system-spec.md](parts-engineering/progressive-power-system-spec.md) | The pre-CAD Pass 4g physics and electrical baseline | Its geometry, packaging and card manifests are superseded by §1.1 of the canonical file; its physics (§5), gates (§4), electrical safety (§6) and capability matrix (§7) are carried there unchanged |
| [parts-engineering/motion-stage-options-spec.md](parts-engineering/motion-stage-options-spec.md) | The ladder decision, the options analysis, the bench-test ordering and the print-and-test sheet | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §1 and §11.1 |
| [parts-engineering/flatpack-modular-craft-spec.md](parts-engineering/flatpack-modular-craft-spec.md) | Pass 4g coordinate frames, the 15-module catalog, the 9-craft assembly traces | Its geometry is superseded by §2 of the canonical file |
| [parts-engineering/kip-print-workflow-spec.md](parts-engineering/kip-print-workflow-spec.md) | The full "print what's on screen" engineering spec, with the printer profile, colour resolver, 3MF package, kit-card engine and sticker design | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §8 |
| [parts-engineering/parts-asset-optimization-spec.md](parts-engineering/parts-asset-optimization-spec.md) | The asset pipeline design, file and schema specs, the LLM tuning approach | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §9 |
| [parts-engineering/describe-and-build-viewer-spec.md](parts-engineering/describe-and-build-viewer-spec.md) | The Describe & Build design spec, its six build steps and validation plan | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §10.1 |
| [parts-engineering/kip-demo-implementation.md](parts-engineering/kip-demo-implementation.md) | The Kip demo build plan: side menu, print view, selfie face plate | [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §10.2 |

### [product/future-vision.md](product/future-vision.md) — folded into the vision docs

A one-page pitch draft ("Pokémon Go, but the things kids catch train real
robots"). The arc it describes is in [../product/vision.md](../product/vision.md)
and [../product/submission-vision.md](../product/submission-vision.md); its Max
phase is in the journal's "Later" entries and in
[../specs/parts-engineering-spec.md](../specs/parts-engineering-spec.md) §7.

| File | What it was | Superseded by |
| --- | --- | --- |
| [product/future-vision.md](product/future-vision.md) | The one-line pitch draft and the Snap → Pro → Max arc | [product/vision.md](../product/vision.md) + [product/submission-vision.md](../product/submission-vision.md) |

### [review/household-weekends-review.md](review/household-weekends-review.md) — the decision landed elsewhere

A review of the "household weekends" proposal. Its verdict and its one
blocking finding (the front silhouette is a weak discriminator, so the shape
game could not be playable for the youngest bands) both landed: the weekend
became "find one at home" and the game now shows the **three-quarter**
silhouette with a per-item `confusableWith` list, measured on the real
outlines.

| File | What it was | Superseded by |
| --- | --- | --- |
| [review/household-weekends-review.md](review/household-weekends-review.md) | The review of the household-weekends proposal (2026-11-03) | [specs/garage-weekend-spec.md](../specs/garage-weekend-spec.md) ("In the Garage") + [specs/household-library-spec.md](../specs/household-library-spec.md) ("Pictures: what was built") |

Archive entries are history; do not update them to match today.
