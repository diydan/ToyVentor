# ToyVentor docs

Start with [vision.md](product/vision.md) for direction and
[spec.md](product/spec.md) for behavior. On product conflicts, the spec wins;
on geometry conflicts, [parts-tu-spec.md](parts/parts-tu-spec.md) and
[partspec/specs/](parts/partspec/specs/README.md) win.

## Layout

- `product/`: vision, submission story, canonical spec and review copy, plan,
  journal, demo script.
- `ux/`: one-stage World spec, interactive mockups, and design guide.
- `specs/`: `app-continuation-spec.md`, `native-world-port-spec.md`
  (Phase 0), `stage-simplification-and-kip-spec.md`, `xp-system-spec.md`
  (Phase 3 gate), parent time gate, flat-pack craft, progressive power, and
  scan-to-3D.
- `parts/`: Snap and Pro summaries, creating-parts runbook, TU spec, and the
  generated PartSpec snapshot.
- `decisions/`: dated records `0001`–`0006`.
- `archive/`: retired docs with their replacements.

## Start here

| File | What it is |
| --- | --- |
| [vision.md](product/vision.md) | Internal long-term direction. |
| [submission-vision.md](product/submission-vision.md) | External hackathon narrative for November 4. |
| [spec.md](product/spec.md) | Canonical behavior, demo proof, safety, and delivery scope. |
| [plan.md](product/plan.md) | Work plan to the November 4 submission. |
| [demo-script.md](product/demo-script.md) | The 90-second run, stills, and failure replies. |
| [world-first-spec.md](ux/world-first-spec.md) | Active one-stage UX, dock, sheets, overflow, transitions, and demo path. |
| [design-guide.html](ux/design-guide.html) | Tokens, components, motion, accessibility, and open design needs. |
| [parts-tu-spec.md](parts/parts-tu-spec.md) | Active 12.5/25 mm geometry canon, catalog targets, sets, and print loop. |

## Active specs (post-consolidation)

| File | What it is |
| --- | --- |
| [native-world-port-spec.md](specs/native-world-port-spec.md) | **Phase 0:** native Vite/React Three.js stage port, removing the `<iframe>` and `public/world/**`. |
| [stage-simplification-and-kip-spec.md](specs/stage-simplification-and-kip-spec.md) | Companion spec for `Demo Mode`, cog-mesh fix, Kip V2 unification (`25` `robot.*` aliases), and retiring `#fix`. |
| [app-continuation-spec.md](specs/app-continuation-spec.md) | **Phases 1-5:** `Toy Box` bar & `⚙️` PIN gate, enabled roster, STEM XP, locked roster, and weekly packs. |
| [xp-system-spec.md](specs/xp-system-spec.md) | **Phase 3 gate:** STEM XP scoring, 11-mission tolerances, two-track gating, and D1 sync contract. |
| [parent-time-gate.md](specs/parent-time-gate.md) | Implemented parent caps and earned STEM time. |
| [flatpack-modular-craft-spec.md](specs/flatpack-modular-craft-spec.md) | Proposed flat-pack vehicle/craft grammar. |
| [progressive-power-system-spec.md](specs/progressive-power-system-spec.md) | Proposed momentum-to-robotics stages. |
| [scan-to-3d.md](specs/scan-to-3d.md) | Recommended scan-body route and acceptance tests. |

## ToyVentor World (the 2.5D game)

The game lane stays imperative and runs same-origin until Phase 0 (`native-world-port-spec.md`) lands:
`game/engine25.js`, `game/build25.py`, `public/world/ToyVentor-World.html`,
and `shared/toycontract.ts` for the app-to-game handoff. Phase 0 ports the
stage natively and deletes the iframe bundle.

## Product lines and parts

| File | What it is |
| --- | --- |
| [snap.md](parts/snap.md) / [pro.md](parts/pro.md) | Product summaries; normative geometry stays in generated PartSpec copies. |
| [creating-parts.md](parts/creating-parts.md) | Runbook for new parts and families. |
| [PartSpec](parts/partspec/README.md) / [specs](parts/partspec/specs/README.md) | Generated readable snapshot; edit sources, then regenerate. |
| [`../parts/README.md`](../parts/README.md) | Package overview for `parts/partspec/` and retired `parts/scad/`. |

## Generated — do not edit by hand

Do not hand-edit [spec-for-review.md](product/spec-for-review.md),
`partspec/specs/01_interface_standard.md`, `05_catalog.md`, or
`06_agent_instructions.md`. Regenerate them from `docs/product/spec.md` or
`parts/partspec/` sources.

## Drafts (not served by the app)

`drafts/` holds the public landing source, standalone waitlist worker/schema,
and older prototypes for reference.

## Archive

[archive/](archive/README.md) holds retired docs with replacements: the 5-tab
wireframe and PDF, pre-consolidation mockups, 16/32 mm samples, raw
brain-dump, and point-in-time parts review.
Archive entries are history; do not update them to match today.

## Changing these docs

Keep headings and section order; cut prose, never requirements. Verify changed
facts against code before writing them, and regenerate generated files from
their sources instead of editing them.


## Decisions

Dated records `0001`–`0006`; the TU merge in
[0005](decisions/0005-partspec-lattice-merge.md) remains the geometry authority.
