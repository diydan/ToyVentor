# Third-party software

ToyVentor's own code is Apache-2.0 and its designs CC BY 4.0 (see `LICENSING.md`). It depends on these libraries, all with licences that allow commercial use:

| Library | Used for | Licence |
| --- | --- | --- |
| manifold3d | Solid geometry: booleans, slicing, extrusion | Apache-2.0 |
| trimesh | Mesh checks and STL export | MIT |
| numpy | Numbers and arrays | BSD-3-Clause |
| scipy | Used by trimesh for geometry helpers | BSD-3-Clause |
| jsonschema | Manifest validation | MIT |

Preview images are made with matplotlib (PSF-based licence), which is not part of the generator. The 3D review page loads three.js (MIT) from a CDN.

No code, geometry or data from other construction systems or part generators is used. BlockML and MachineBlocks were evaluated and not adopted (see `WHY_NOT_BLOCKML_MACHINEBLOCKS.md`).
