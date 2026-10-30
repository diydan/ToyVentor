# Third-party software

ToyVentor's own code is Apache-2.0 and its designs CC BY 4.0 (see `LICENSING.md`). It depends on these libraries, all with licences that allow commercial use:

| Library | Used for | Licence |
| --- | --- | --- |
| manifold3d | Solid geometry: booleans, slicing, extrusion | Apache-2.0 |
| trimesh | Mesh checks, STL export, and ray casting in the pre-print wall-thickness check | MIT |
| numpy | Numbers and arrays | BSD-3-Clause |
| scipy | Used by trimesh for geometry helpers | BSD-3-Clause |
| jsonschema | Manifest validation | MIT |

Preview images are made with matplotlib (PSF-based licence), which is not part of the generator. The 3D review page loads three.js (MIT) from a CDN.

No code, geometry or data from other construction systems or part generators is used. BlockML and MachineBlocks were evaluated and not adopted (see `WHY_NOT_BLOCKML_MACHINEBLOCKS.md`).

## External tools (run, not included)

| Tool | Used for | Licence | How |
| --- | --- | --- | --- |
| PrusaSlicer 2.8.1 | Stage 2 of `preprint_check.py`: slicing, filament, time, stability warnings | AGPL-3.0 | Run as a separate, unmodified program when installed; not included in this repository |
