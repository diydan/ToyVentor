# 0005 — PartSpec lattice and the merge back into the app

Date: 2026-10-28 (updated 2026-10-30). Status: migrated in code (`sets/base.json`, `sets/racer-garage.json`, `sets/kip-wardrobe.json`, `make_calibration.forge_mount_first_print` + `shared/calibration.ts`, and `parts/test-print-tu/` 17-STL print bundle); awaiting physical hand-feel and fit confirmation on Plate 1 (`01_big_blue_brick_L_2x2.stl` + `17_forge_mount_first_print_selector.stl`).

## Context

Two parts lanes exist:

- **PartSpec** (`parts/partspec/` generator, specs snapshot in `docs/parts/partspec/specs/`): Python
  `manifold3d` pipeline, one TU lattice at 12.5 mm (Snap Small 12.5, Snap Large
  25, Pro holes 12.5), 75 catalog parts passing geometry + measured-fit checks,
  connector manifests, safety screens. Its design log records Dan confirming
  the 12.5/25 lattice on 2026-10-28, conditional on a printed Large 2x2 feeling
  right in a toddler's hand and on a real toy.
- **App lane** (`parts/scad/` OpenSCAD profiles, `sets/base.json`, builder): 16 mm
  small / 32 mm large pitch, 8 parts. Everything user-facing today (builder
  grid, STL/GLB downloads, try-on scale) is built on these numbers.

They cannot both be canonical: footprints, stud diameters and fits differ, so
a part from one lane does not snap to the other.

## Decision (proposed)

PartSpec becomes the geometry canon once its records condition passes.
It is ahead on measured fit, part count, Pro completeness and mount design.
Until then:

1. Freeze new old-lattice (16/32 mm) geometry work in the app lane.
2. First physical prints, in order: PartSpec Large 2x2 (hand-feel condition),
   then a first-print selector rebuilt on the TU lattice.
3. The hidden-calibration UX carries over: users never run a calibration
   step. The selector's three dotted sockets must span PartSpec's fit window
   (surface offset about -0.07 to +0.08 mm), validated with its fit checker;
   the standalone calibration print stays an engineering tool. Prototype:
   `parts/scad/mount/forge-mount-first-print.scad` (old lattice) +
   `shared/calibration.ts`.
4. Migration, when approved: generate `sets/*.json` from PartSpec's
   `catalog.json`/manifest (part IDs mapped once), serve its STLs through the
   existing `public/parts-stl|glb` pipeline instead of committing binaries
   under `docs/`, and switch builder/try-on to TU footprints.

## Consequences if the print fails the condition

Per PartSpec's own log: shrink Large on the same TU lattice rather than
returning to 16 mm. The app lane stays frozen either way; nothing physical
has been printed from either lane yet.
