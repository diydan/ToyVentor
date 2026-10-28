# 0002 — BlockML / MachineBlocks spike: adopt beside OpenSCAD, not instead of it (yet)

Oct 28, 2026. Spike lives in /tmp/blockml-spike, deliberately outside this repo.

## What was proven

- A 20-line BlockML brick definition (`Brick2x2.bml`, a MachineBlocks
  CompositeBlock at size 2x2x3) renders through `@machineblocks/cli` to
  OpenSCAD, and OpenSCAD renders that to a valid 2.9 MB STL.
- `@machineblocks/core` ships a real brick/block library (studs, sockets,
  grids, presets) — the geometry ToyForge Snap was about to invent by hand,
  including the fit tolerances our hand-written stud_profile admits are
  unmeasured targets.
- OpenSCAD 2026.10.11 is now installed locally; `npm run parts` renders all
  8 current .scad parts to manifold STLs. The Day 4 print gate is unblocked
  on tooling either way.

## What was not proven

- That a MachineBlocks brick matches our set-file contract (footprint,
  size classes, Forge Mount interface) without fighting its defaults —
  its native grid is LEGO-like (15.9 mm 2x2), ours is a target 32 mm.
- Print quality or snap fit of anything. Nothing is printed yet.
- Any GLB path. OpenSCAD has no glb export; STL/3MF conversion is separate
  work regardless of authoring language.

## Decision

Do not run `blockml init` in this repo: it rewrites package.json and drops
agent files at the root, mid-hackathon, for a benefit that is so far one
brick deep. Instead:

1. Keep hand-written OpenSCAD as the committed source for the demo parts.
2. Next spike step, before Day 4 printing: express ONE Snap part (Brick
   2x2 small) in BlockML inside the spike project, render SCAD + STL, and
   compare dimensions and print orientation against parts/snap/. Adopt
   per-part only where the BlockML version wins on evidence.
3. If it wins twice, revisit as a parts/blockml/ subproject whose generated
   .scad files land in generated/ like every other build output.
