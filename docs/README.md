# ToyVentor docs

Start with [vision.md](product/vision.md) for direction and
[spec.md](product/spec.md) for behavior. On product conflicts, the spec wins;
on geometry conflicts, [parts-tu-spec.md](parts/parts-tu-spec.md) and
[partspec/specs/](parts/partspec/specs/README.md) win.

## Layout

- `product/`: vision, submission story, canonical spec and review copy, plan,
  journal, demo script, deploy checklist.
- `ux/`: one-stage World spec, interactive mockups, and design guide.
- `specs/`: `app-continuation-spec.md`, `native-world-port-spec.md`, `toyventor-town-vision.md`
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
| [native-world-port-spec.md](specs/native-world-port-spec.md) | **Phase 0 (landed):** native Vite/React Three.js stage port; `<iframe>` and `public/world/**` deleted. |
| [stage-simplification-and-kip-spec.md](specs/stage-simplification-and-kip-spec.md) | **Landed:** `Demo Mode` v1, cog-mesh fix, Kip V2 unification (`25` `robot.*` aliases), `#fix` retired. |
| [app-continuation-spec.md](specs/app-continuation-spec.md) | **Phases 1-5:** `Toy Box` bar & `⚙️` PIN gate, enabled roster, STEM XP, locked roster, and weekly packs. |
| [forge-ai-spec.md](specs/forge-ai-spec.md) | **Proposed:** six Muse Spark features (describe it, scan it, repair loop, host fit, build planner, finish it) on one recipe, gate and repair engine; five assist features (incl. failed-print triage); data plan and a stretch-goal, Glimmer-based, gated roadmap for two own models (Forge recipe writer, brick sculptor). |
| [toyventor-town-vision.md](specs/toyventor-town-vision.md) | **Vision:** open-world Town (districts, quests, daily rhythm); extends continuation past Phase 5. |
| [xp-system-spec.md](specs/xp-system-spec.md) | **Phase 3 (implemented):** STEM XP scoring, 11-mission tolerances, two-track gating, and D1 sync contract. |
| [carousel-modes-ladders-spec.md](specs/carousel-modes-ladders-spec.md) | **C1+C2 landed, C3 little-six landed:** carousel, age bands, playable Learn runs (38 rungs); all six Little-ones rungs world-first + path depth (§11.6) verified; stage Map button + orientation views (2026-11-03); C4 pick session (§11.8) and kid-band-only C5 decided, after the real-phone pass. |
| [garage-weekend-spec.md](specs/garage-weekend-spec.md) | **Phase 1 built (2026-11-03):** the Garage, an always-open build place on the map and in the carousel with a new part/idea/remix drop every Fri-Sun, age-specific missions, STEM-minute credit and Demo Mode Preview weekend. Real-life leg, parent controls and roof trophies are phase 2, not built. |
| [environment-spec.md](specs/environment-spec.md) | **Draft (2026-11-03):** time of day and weather. Map day/night built; 3D worlds on the parallax day/night images next; continuous light and weather are post-hackathon, weather by location gated on a privacy decision. |
| [parallax-backdrops-spec.md](specs/parallax-backdrops-spec.md) | **Draft (mockup built):** generated-image backdrop planes on stepped depths replacing hill spheres; gameplay stays 3D; awaiting mockup approval. |
| [dance-party-spec.md](specs/dance-party-spec.md) | **Draft 2 (2026-11-03, decisions made; headphones, 16 Mixamo dances and moves, party mode with a 12-song Mureka starter library and a Dance picker built in the Kip bench; no live song maker Worker yet):** Kip headphones (crown band; real ear sockets later), four Mixamo dances picked and a per-clip quality gate, an AI song maker on Dan's Mureka account (a pre-made starter library plus live songs, 5 new songs a week per user), a party mode with a movement break, and a Help cook / Clean up exercise on the new props with two new primitives (`scrub`, `flick`). |
| [parent-time-gate.md](specs/parent-time-gate.md) | Implemented parent caps and earned STEM time. |
| [flatpack-modular-craft-spec.md](specs/flatpack-modular-craft-spec.md) | Proposed flat-pack vehicle/craft grammar. |
| [kip-demo-implementation.md](specs/kip-demo-implementation.md) | **Proposed:** Kip demo left side menu with dropdowns, flat-pack 3D print view, and selfie face plate — the build plan, superseding the deleted design spec. |
| [workshop-spec.md](specs/workshop-spec.md) | **Stages 1 to 4 built:** the Workshop shell (`/kip/Workshop.html`) hosts the Kip, Truck and Yard benches with one stage, one menu and one print view, and opens in the game as an overlay (downloads off; the game switch-on is deferred). |
| [workshop-print-gate-spec.md](specs/workshop-print-gate-spec.md) | **Phases 1 to 3 built, switched off:** the grown-up question in front of the Workshop's exports and the selfie sticker; Dan's decisions, the file exits a child can reach today, and the post-hackathon order. |
| [parent-controls-off-spec.md](specs/parent-controls-off-spec.md) | **Built:** a showcase switch that turns the grown-up checks and play-time limits off (build flag, or per tab in Demo Mode); photo-upload gates stay on. |
| [progressive-power-system-spec.md](specs/progressive-power-system-spec.md) | Proposed momentum-to-robotics stages. |
| [scan-to-3d.md](specs/scan-to-3d.md) | Recommended scan-body route and acceptance tests. |
| [play-design-spec.md](specs/play-design-spec.md) | Play design: level primitives, recipe format, composition kit, generation pipeline, and playtest bar. Owns the level lane and its one ordered Plan. |
| [sam-physical-to-digital-spec.md](specs/sam-physical-to-digital-spec.md) | **Draft:** `SAM 3.1` + `Muse` photo-to-digital: sketch-to-part, twin sync, room-to-level, real-life quests. Owns the photo lane; Feature 3 feeds the level lane above. |

## ToyVentor World (the 2.5D game)

Phase 0A (`native-world-port-spec.md`) ported the 2.5D stage natively into the
Vite/React app: `src/features/game/world/runtime/world.ts`,
`src/features/game/world/runtime/stageDom.ts`, `src/features/game/world/engine.ts`,
and `shared/toycontract.ts` (`/#toy=…` handoff; legacy
`/world/ToyVentor-World.html` 302-redirects to `/`).

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
