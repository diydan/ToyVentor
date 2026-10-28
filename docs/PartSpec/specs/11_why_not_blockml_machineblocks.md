# Why ToyVentor does not use BlockML or MachineBlocks

**Short answer:** we evaluated both and built our own pipeline instead. One licence issue rules out the MachineBlocks geometry outright, and BlockML did not do the job we needed. Nothing from either is in the project.

## What was evaluated

- **BlockML:** the toolchain, blockml-core and its command-line tools, piloted by modelling ToyVentor parts as BlockML blocks.
- **MachineBlocks:** a spike with `@machineblocks/core` 3.0.0-A5 and `@machineblocks/cli` 0.1.6. With `unitMbuToMm="3.2"` it produced a watertight 2x2 brick on a 16 mm grid within an hour. ToyVentor has since moved to its own 12.5 / 25 mm lattice.

## Why not MachineBlocks

**Licence.** The package declares Apache-2.0 in `package.json` and its `LICENSE` file, but the geometry files carry Creative Commons BY-NC-SA 4.0 headers. That includes `lib/block.scad`, which generated SCAD needs at render time, plus the precompiled `Standard.scad` and the `.bml` block files.

- **NC (non-commercial)** would block paid part sets and a market for print files.
- **SA (share-alike)** could pull our derived designs under the same terms.
- **The ambiguity** between the package licence and the file headers is unresolved. We would rather not build on it than ask the author to settle it.

## Why not BlockML

Its licence (Apache-2.0) is fine. It just did not do the job:

- **What worked:** it validated contracts and property bounds and generated documentation.
- **What didn't:** it did not enforce rules across connected parts. A composed connector inside an assembly was not fully validated unless each one was made its own named type.
- **Geometry checks:** the checks that matter (printability, fit, small parts) stayed in Python anyway.
- **Weight:** about 114 MB of toolchain, with npm audit vulnerabilities.

## What we built instead

Our own Python pipeline, generated from one data file (`interfaces.json`):

- **Generator:** builds every part from a catalog row.
- **Gate:** checks geometry, printability, interfaces, small parts, and fit measured from the built geometry.
- **Validator:** checks how parts connect in a build: studs, pins and bores, and gear meshing.

As of 2026-10-28 it verifies all 60 planned parts (geometry and fit; physical checks pending a print) in under two minutes.

Third-party code is limited to permissive libraries (see `THIRD_PARTY.md`): manifold3d (Apache-2.0), trimesh (MIT), numpy (BSD), scipy (BSD) and jsonschema (MIT). All dimensions and geometry are our own.

## What this means

- No need to contact the MachineBlocks author.
- Keep the spike and pilot files out of the public repository; anything compiled through the MachineBlocks library could fall under its non-commercial terms.
- **When to revisit:** BlockML (Apache-2.0) could still be useful one day as an exchange format for describing parts. The MachineBlocks geometry files stay out unless their licence changes.
