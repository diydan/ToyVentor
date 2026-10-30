# Parts (`parts/`)

All parametric 3D part generation, validation, and legacy OpenSCAD prototypes live here.

## Directory Layout

| Path | Role | Lattice | Status |
| --- | --- | --- | --- |
| [`partspec/`](partspec/INTERFACE_STANDARD.md) | **PartSpec v2** Python (`manifold3d` + `trimesh`) parametric generator, fit/ledge/preprint validators, assembly solver, hidden-calibration first-print selector, and app exporter | **`12.5 mm` TU** (`1 TU` Small & Pro, `2 TU = 25 mm` Large) | **Active geometry canon** (`105` verified parts across Snap, Pro, and Kip Wave 9). All catalog and calibration geometry lives here; see [`docs/parts-tu-spec.md`](../docs/parts-tu-spec.md) and [`docs/creating-parts.md`](../docs/creating-parts.md). |
| [`kip/`](kip/README.md) | **Kip** clean-room parametric OpenSCAD hero character (`Pro 8+` & `Snap 3+`), rig manifest, and interactive 3D viewer source | **`12.5 mm` TU** (`stud_small` + Pro `Ø 7.0 mm` / `Ø 6.6 mm` ports) | **Active hero character rig** (`npm run build:kip` / `npx tsx scripts/build-kip.ts --scad` → `public/kip/`). |
| [`test-print-tu/`](test-print-tu/README.md) | Pre-oriented, support-free `12.5 mm` / `25 mm` TU PLA test-print bundle (`z_min = 0.000 mm`) | **`12.5 mm` / `25 mm` TU** | **Ready to slice & print** (`17` binary STLs across Plates 1–3 + first-print selector). |
| [`scad/`](scad/README.md) | Retired OpenSCAD prototype library (`profiles/`, `snap/`, `pro/`, `mount/`, `calibration/`) | `16 / 32 mm` Snap + `12.5 mm` Pro stub | **Retired legacy prototype history** (superseded by `partspec/` and `make_calibration.forge_mount_first_print` per [Decision 0005](../docs/decisions/0005-partspec-lattice-merge.md)). |

## Related Paths in Repo

- **Normative readable specs (`01`–`11`):** [`docs/PartSpec/specs/`](../docs/PartSpec/specs/README.md) (refreshed from `parts/partspec/` via `python3 parts/partspec/make_specs.py parts/partspec`)
- **Engineering & parametric review:** [`docs/parts-review.md`](../docs/parts-review.md)
- **PartSpec → App set bridge:** [`scripts/bridge-partspec.ts`](../scripts/bridge-partspec.ts) & [`shared/partspec.ts`](../shared/partspec.ts) (`npm run bridge`)
- **Kip 3D character build & viewer sync:** [`scripts/build-kip.ts`](../scripts/build-kip.ts) & `public/kip/` (`npm run build:kip`)
- **Legacy OpenSCAD → STL/GLB build:** [`scripts/build-parts.sh`](../scripts/build-parts.sh) & [`scripts/stl_to_glb.py`](../scripts/stl_to_glb.py) (`npm run parts`)
- **App set definitions & served meshes:** [`sets/`](../sets/) and `public/parts-{stl,glb}/`

## Common Commands (`parts/partspec/`)

```bash
# Set up local Python venv (gitignored)
python3 -m venv parts/partspec/.venv
source parts/partspec/.venv/bin/activate
pip install -r parts/partspec/requirements.txt

# Generate parts, validate assemblies & fit matrix, and run full gate in scratch dir
cd parts/partspec
python3 toyventor_parts.py out
python3 toyventor_assembly.py out
python3 make_standard.py out/INTERFACE_STANDARD.md
python3 make_agents.py out
python3 make_catalog.py out
python3 selftest.py out

# Refresh tracked docs/PartSpec/specs/ after promoting changes to parts/partspec/
python3 make_specs.py .
```

> **Git hygiene:** Only source code, schemas, pre-computed JSON manifests, and cached PrusaSlicer reports (`validation/*.json`) are tracked in Git (`~1.9 MB`). Regenerable `*.stl`, `*.png`, `calibration/`, and `app_export/` outputs are gitignored.
