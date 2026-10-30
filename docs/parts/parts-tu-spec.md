# Spec: Parts, Kip & 12.5 mm TU Print Calibration

Oct 30, 2026 · Parts, Mechanical Engineering & Physical Print Lane (companion to [`docs/ux/world-first-spec.md`](../ux/world-first-spec.md), [`docs/parts/creating-parts.md`](creating-parts.md), and [decision 0005](../decisions/0005-partspec-lattice-merge.md))

## Goal

Own ToyVentor's single `12.5 mm` / `25 mm` TU physical-to-digital geometry truth across Snap, Pro, and Kip:

1. Keep `parts/partspec/` (`manifold3d` Python generator + validator) and `parts/kip/` (`30`-part OpenSCAD articulated character rig) 100% verified, support-free (`0.20 mm` PLA, flat on bed), and CPSC/ASTM small-part screened.
2. Finalize and sync any remaining Wave 9 character heads, hair, wardrobe, and vehicle STLs/GLBs across `public/kip/` and `public/parts-{stl,glb}/`.
3. Rebuild the hidden-calibration first-print Forge Mount selector (`1 / 2 / 3` embossed dots, zero user-facing calibration jargon) natively on the `12.5 mm` TU lattice per [decision 0005](../decisions/0005-partspec-lattice-merge.md).
4. Execute the physical PLA print loop (`parts/test-print-tu/` Plates 1-3) so `parts/partspec/interfaces.json` graduates from `"TARGETS ONLY"` to `"CALIBRATED"` before final submission.

---

## Parallel Lane Ownership & Read-Only UI Contract

Work is split into two non-overlapping lanes so physical part engineering and the single-stage World-First UI consolidation ([`docs/ux/world-first-spec.md`](../ux/world-first-spec.md)) run in parallel without merge conflicts:

| Boundary | Paths | Rule |
| --- | --- | --- |
| **Owned by this Parts Lane** | `parts/**`, `sets/*.json`, `public/kip/**`, `public/parts-stl/**`, `public/parts-glb/**`, `scripts/bridge-partspec.ts`, `scripts/build-kip.ts`, `shared/calibration.ts`, `tests/{partspec,snap-samples,kip,calibration}.test.ts`, `docs/parts/parts-tu-spec.md`, `docs/decisions/0005-partspec-lattice-merge.md` | Full read/write ownership. |
| **Shared Schema Contract (Frozen unless coordinated)** | `shared/part.ts`, `shared/partspec.ts`, `shared/checks.ts`, `src/lib/catalog.ts` | Keep stable (`Part`, `bboxMm`, `stlFile`, `glbFile`, `smallPartWarning`, `allParts`, `stlFileFor`, `glbFileFor`). |
| **Read-Only (Owned by World-First UX/UI Lane)** | `src/**` (except `src/lib/catalog.ts`), `worker/**`, `game/**`, `public/world/**`, `shared/world-parts.ts`, `tests/world-parts.test.ts`, `docs/world-first-*` | Do not edit. |

### Zero-Touch App Handoff

`src/lib/catalog.ts` discovers every `sets/*.json` file via `import.meta.glob("../../sets/*.json")` and resolves `/parts-stl/{stlFile}` and `/parts-glb/{glbFile}`. Running `npm run bridge` updates `sets/*.json`, `public/parts-stl/`, and `public/parts-glb/` so the World-First UI (`PrintDrawer`, `PackOverlay`, `TryOn`, `BuilderCanvas`) picks up calibrated meshes and new expansion packs with **zero `src/**` edits**.

### Git & Tooling Hygiene

- **Git:** Stage only files owned by this lane (`git add <owned-files>`). Never run `git reset --hard`, `git checkout .`, or `git commit -a`. Never touch `/Users/dan/Code/toyventor` (outside repo).
- **CAD & Python runtime:** Use `/tmp/tvvenv/bin/python3` (`manifold3d`, `trimesh`, `scipy`, `jsonschema`) and `/opt/homebrew/bin/openscad`.

---

## Baseline Already Landed on `main` (Do Not Regress)

1. **Pro Mechanical Printability Fixes (`parts/partspec/interfaces.json`, `toyventor_pro.py`, `toyventor_assembly.py`):**
   - `pin_friction`: open-tip `< 1.8%` PLA strain cantilever fins (`fin_oversize_mm = 0.4`, `slot_width_mm = 2.2`) with inter-TU center webs, printed `LAY_FLAT` (`[90, 0, 0]`).
   - `pin_free`: `LAY_FLAT` axial-strand orientation with `5.6 mm` flats (`> 5.1 mm` fixed double-D bore so free pins spin in `Ø7.0 mm` bores while physically blocked from fixed hubs).
   - `spur_section`: conjugate basic-rack hobbing (`0.000000 mm³` radial undercut interference across `Z10`, `Z12`, `Z20`, `Z30`, worm, rack, and internal ring) plus `_clocked_gear_clears` 3D Boolean clearance verification (`28/28` assemblies pass; `2,401` mating pairs with `0` out of tolerance).
2. **`12.5 mm` / `25 mm` TU App Catalog (`sets/*.json` + `public/parts-{stl,glb}/`):**
   - `sets/base.json` (`14` parts), `sets/racer-garage.json` (`8` parts), and `sets/kip-wardrobe.json` (`9` parts), backed by `30` support-free binary STLs and `30` GLBs with `bboxMm`, `stlFile`, `glbFile`, and ASTM F963 / `16 CFR § 1500.19` `smallPartWarning` flags.
3. **Kip v2 Articulated Character Rig (`parts/kip/` & `public/kip/`):**
   - `30` OpenSCAD parts (`public/kip/kip-manifest.json`), interactive 3D pose/explode/wardrobe viewer (`public/kip/Kip-Demo.html`), and `105` PartSpec STLs in `public/kip/partspec/`.
4. **16-STL First Physical Test-Print Bundle (`parts/test-print-tu/`):**
   - Plates 1-3 (`01_big_blue_brick_L_2x2.stl` through `16_kip_shin_print.stl`), pre-oriented flat on bed (`z_min = 0.000 mm`), 100% watertight, zero supports required.

---

## Remaining Deliverables (Priority Order)

### 1. Wave 9 Character/Hair Polish & Kip Viewer Sync (Immediate)

Unstaged Wave 9 updates currently sit in `parts/partspec/toyventor_parts.py`, `parts/kip/viewer/Kip-Demo.html`, `parts/kip/viewer/kip-vehicles-wardrobe.js`, and 11 head/hair STLs under `public/kip/partspec/`:

- Run `/tmp/tvvenv/bin/python3 parts/partspec/selftest.py` and `preprint_check.py` on all modified Wave 9 parts (`char_head_*`, `hair_*`) to confirm `105/105` catalog parts stay `verified`, watertight, and support-free.
- Run `npm run bridge` so any updated Wave 9 meshes referenced by `sets/kip-wardrobe.json` stay byte-synced across `public/parts-stl/` and `public/parts-glb/`.
- Run `npm run build:kip` and `npx vitest run tests/kip.test.ts` to verify `public/kip/Kip-Demo.html` and `public/kip/kip-manifest.json`.

### 2. `12.5 mm` TU Hidden-Calibration First-Print Selector ([Decision 0005](../decisions/0005-partspec-lattice-merge.md) #3)

Kids and parents never run a calibration wizard; the first Forge Mount print carries a 3-socket selector strip (`1`, `2`, `3` embossed dots) and asks one question (`"Snap the little brick into each dotted slot. Which clicked best?"`):

- Build the `12.5 mm` TU first-print Forge Mount + breakaway 3-socket selector in `parts/partspec/` (replacing the frozen `16 mm` prototype in `parts/scad/mount/forge-mount-first-print.scad`).
- Size the three dotted `socket_small` cells across PartSpec's real FDM fit window (radial surface offsets `-0.07 mm`, `0.00 mm`, `+0.08 mm` around nominal `stud_small`) with embossed `1 / 2 / 3` dot markers (no text to misprint at `0.4 mm` nozzle).
- Validate all three sockets with `toyventor_fit.py` and `preprint_check.py` (`z_min = 0.000 mm`, support-free).
- Update `shared/calibration.ts` (`FIT_VARIANTS`) and `tests/calibration.test.ts` if needed so `clearanceMm` matches the exact TU socket offsets, and export `17_forge_mount_first_print_selector.stl` into `parts/test-print-tu/` (plus `public/parts-stl/`).
- Mark `parts/scad/` as retired `16 mm` prototype history once the TU selector passes verification.

### 3. Physical PLA Print & Tolerance Lock-In (`parts/test-print-tu/`)

Slice and print Plates 1-3 (`0.20 mm` PLA, `0.4 mm` nozzle, `3` walls, `4` top/bottom shells, `15-20%` gyroid infill, **supports OFF**) per [`parts/test-print-tu/README.md`](../../parts/test-print-tu/README.md):

| Plate | Key Physical Gate | Pass Criterion |
| --- | --- | --- |
| **Plate 1 (`01`-`05`)** | Decision `0005` Large `2x2` (`50x50 mm`) + Small `12.5 mm` stud clutch | `01_big_blue_brick_L_2x2` feels right in a child's hand (`>= Ø31.7 mm` clear); `04_brick_s_2x2` & `05_racer_spoiler_2x1` hold `02_forge_mount_ring_s_5x5` inverted without falling, removable by hand. |
| **Plate 2 (`06`-`11`)** | Pro pins, double-D shaft & `m = 2.5 mm` rack-hobbed gears | `07_pin_friction_2tu` survives `10x` snap cycles into `06_beam_str_tu05` with zero cracking/whitening; `08_pin_free_2tu` spins freely and rejects fixed hubs; `10_gear_spur_z10` + `11_gear_spur_z20` spin `360°` smoothly at `3 TU` (`37.5 mm`). |
| **Plate 3 (`12`-`16`)** | Kip ball-joint articulation & TU cross-line adapters | `16_kip_shin_print` pops into `13_kip_boot_print` and holds pose (`±15°`); `14_kip_neck_turret_2x1` & `15_kip_back_dock_studs` seat cleanly in `12_kip_torso_print` and accept `05_racer_spoiler_2x1` / `04_brick_s_2x2`. |

When physical measurements are recorded:
1. Adjust only the empirical clearance/oversize fields in `parts/partspec/interfaces.json` and update its status note from `"TARGETS ONLY"` to `"CALIBRATED"` with printer + filament metadata.
2. Re-run `selftest.py`, `npm run bridge`, `npm run build:kip`, and regenerate `parts/test-print-tu/`.
3. Update [decision 0005](../decisions/0005-partspec-lattice-merge.md) status to `accepted & calibrated`.

### 4. Curated Expansion Packs (Optional, Zero UI Code)

- Follow [`docs/parts/creating-parts.md`](creating-parts.md) to add any extra themed sets (`sets/<pack-id>.json`) from verified PartSpec catalog entries via `scripts/bridge-partspec.ts`.

---

## Validation Gates

Every Parts-lane change must pass all 4 gates before committing:

1. **PartSpec Geometry, Fit & Preprint Gate:**
   ```bash
   /tmp/tvvenv/bin/python3 parts/partspec/selftest.py
   ```
   (`105+` catalog parts `verified`, `28+` assembly builds pass, `0` out-of-tolerance pairs in `fit_matrix.json`, modified STLs pass `preprint_check.py` on `fdm_pla_0.4.json`.)
2. **App Catalog & Kip Sync:**
   ```bash
   npm run bridge && npm run build:kip
   ```
3. **Schema & Type Validation:**
   ```bash
   npm run validate && npm run typecheck
   ```
4. **Parts & Calibration Unit Suites:**
   ```bash
   npx vitest run tests/partspec.test.ts tests/snap-samples.test.ts tests/kip.test.ts tests/calibration.test.ts
   ```
