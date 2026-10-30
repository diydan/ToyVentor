# ToyVentor 12.5 mm / 25 mm TU — First Physical Test-Print Bundle

All **17 binary STLs** in this folder are already rotated to their **support-free print orientation** (`z_min = 0.000 mm`, 100% watertight manifold meshes). Drop them straight onto your slicer plate without rotating or enabling supports.

## Slicer Settings (Bambu Studio / OrcaSlicer / PrusaSlicer)
- **Material:** PLA (matte or standard)
- **Nozzle / Layer height:** `0.4 mm` nozzle · `0.20 mm` layer height
- **Walls / Perimeters:** `3` walls (`1.2 mm`) so Pro pins, shafts, and ball sockets have full elastic hoop strength
- **Top / Bottom shells:** `4` top, `4` bottom
- **Infill:** `15–20%` gyroid or grid
- **Supports:** **OFF** (`None`)
- **Brim:** **OFF** (optional outer-only `3 mm` brim on small pins if your PEI plate runs cool)

---

## Plate 1 — Snap Hand-Feel & Forge Mount Fit (`01`–`05`, `17`)
| File | Lattice | Purpose & Physical Pass Criteria |
| --- | --- | --- |
| `01_big_blue_brick_L_2x2.stl` | `25.0 mm` Large (`2×2`, `50×50 mm`) | **Decision 0005 Gate:** Verify toddler hand feel (`≥ Ø31.7 mm` CPSC cylinder clear) and smooth chamfered edges. |
| `02_forge_mount_ring_s_5x5.stl` | `12.5 mm` Small (`5×5`, `62.3×62.3 mm`) | Base `stud_small` Forge Mount plate. Check flat first layer and crisp `Ø6.6 mm` studs. |
| `03_adapter_snap_pro_2x2.stl` | `12.5 mm` TU Bridge (`2×2`) | Snap-to-Pro bridge plate: `stud_small` studs on top + Pro `bore_grid` holes through body. |
| `04_brick_s_2x2.stl` | `12.5 mm` Small (`2×2`, `24.8×24.8 mm`) | Press onto `02_forge_mount_ring_s` and `03_adapter_snap_pro`: firm clutch, lifts mount under own weight, child-removable. |
| `05_racer_spoiler_2x1.stl` | `12.5 mm` Small (`2×1`, `24.8×11.9 mm`) | Snap onto `04_brick_s_2x2`, `02_forge_mount_ring_s`, and Kip's `14_kip_neck_turret_2x1`. |
| `17_forge_mount_first_print_selector.stl` | `12.5 mm` Small (`3×2` Mount + `1/2/3`-dot Strip + `2×1` Test Brick, `84.3×37.3 mm`) | **Hidden Calibration (Decision 0005 #3):** Snap the breakaway `2×1` test brick into sockets `1` (`0.00 mm`), `2` (`0.10 mm` standard), and `3` (`0.26 mm` easy); record which dot count clicks best (`[-0.100, +0.115] mm` surface-offset coverage), then twist off the breakaway tabs and keep the `3×2` Forge Mount. |

## Plate 2 — Pro Mechanical Pins, Shafts & Conjugate Gears (`06`–`11`)
| File | Lattice | Purpose & Physical Pass Criteria |
| --- | --- | --- |
| `06_beam_str_tu05.stl` | `12.5 mm` Pro (`5×1` TU) | Reference 5-bore beam (`Ø7.0 mm` free bores at `12.5 mm` pitch). |
| `07_pin_friction_2tu.stl` | `12.5 mm` Pro (`2` TU, `LAY_FLAT`) | Open-tip `< 1.8%` strain cantilever fins + center web. Clicks into `06_beam_str_tu05` and `03_adapter_snap_pro` **10× in a row** with zero cracking or stress whitening. |
| `08_pin_free_2tu.stl` | `12.5 mm` Pro (`2` TU, `LAY_FLAT`) | Axial-strand `5.6 mm` flats: spins freely inside `06_beam_str_tu05` (`Ø7.0 mm` bore) while physically blocked from entering `fixed` double-D hubs (`5.1 mm` flats). |
| `09_shaft_tu03.stl` | `12.5 mm` Pro (`3` TU, `LAY_FLAT`) | Double-D drive shaft: slides freely through `06_beam_str_tu05` and locks rotationally into `10_gear_spur_z10` / `11_gear_spur_z20`. |
| `10_gear_spur_z10.stl` | `m = 2.5 mm` (`Z = 10`, `pitch_d = 25 mm`) | Conjugate rack-hobbed 10T pinion (undercut-free). Mount on `09_shaft_tu03` in bore `0` of `06_beam_str_tu05`. |
| `11_gear_spur_z20.stl` | `m = 2.5 mm` (`Z = 20`, `pitch_d = 50 mm`) | Mount 3 TU (`37.5 mm`, bore `3`) from `Z10` on `06_beam_str_tu05`: spins 360° smoothly with zero tooth-root binding. |

## Plate 3 — Kip Character Articulation & TU Cross-Line Mating (`12`–`16`)
| File | Lattice | Purpose & Physical Pass Criteria |
| --- | --- | --- |
| `12_kip_torso_print.stl` | `12.5 mm` TU + Pro `Ø7.0` neck | Prints upright; tests `2×2` back socket, neck bore, and shoulder sockets. |
| `13_kip_boot_print.stl` | `12.5 mm` Small (`1×2` sole sockets) | Snaps onto `02_forge_mount_ring_s` studs AND accepts `16_kip_shin_print` ankle ball (`±15°` poseable tilt). |
| `14_kip_neck_turret_2x1.stl` | Pro `Ø6.6` shaft -> `2×1` `stud_small` | Inserts into `12_kip_torso_print` neck bore; top `2×1` studs mate with `05_racer_spoiler_2x1` and Wave 9 heads. |
| `15_kip_back_dock_studs.stl` | `2×2` `stud_small` back adapter | Snaps into `12_kip_torso_print` back recess (`LAY_FLAT` axial layers) and mounts `04_brick_s_2x2` / backpacks. |
| `16_kip_shin_print.stl` | Kip ball-joint shin (`LAY_FLAT` flat) | Pop ankle ball into `13_kip_boot_print`: firm poseable friction hold without splitting socket walls. |

---

## Post-Print Calibration Log (`TARGETS ONLY` → `CALIBRATED`)

Record measured results here after printing Plates 1–3, then promote `parts/partspec/interfaces.json`:

| Gate | Parts Tested | Target Value (`interfaces.json`) | Best Result / Measured Note | Action if Off-Target |
| --- | --- | --- | --- | --- |
| **1. Large `2×2` Hand Feel** | `01` | `stud_large.pitch = 25.0`, `brick_h = 30.0` | `[ ] Pass` | Lock Decision `0005` |
| **2. First-Print Selector (`1/2/3` dots)** | `17` | `stud_small.fit = 0.10` (`2` dots; `1` = `0.00`, `3` = `0.26`) | `Best dot: [ 1 / 2 / 3 ]` | If `1` or `3` wins on nominal PLA, shift `stud_small.fit` accordingly |
| **3. Small Stud Clutch** | `02`, `03`, `04`, `05` | `stud_small.stud_d = 6.6`, `fit = 0.10` | `[ ] Holds inverted, removable by hand` | Nudge `stud_small.fit` by `±0.04 mm` |
| **4. Pro Friction & Free Pins** | `06`, `07`, `08`, `09` | `pin_friction.fin_oversize_mm = 0.4`, `bore_grid.free_d = 7.0`, `fixed_flats = 5.1` | `[ ] 10× snap cycles, 0 whitening` | Nudge `fin_oversize_mm` (`±0.05 mm`) or `fixed_flats` (`±0.04 mm`) |
| **5. Rack-Hobbed Gear Mesh** | `06`, `09`, `10`, `11` | `pro.gear.backlash_mm = 0.2` (`3 TU = 37.5 mm`) | `[ ] Smooth 360° spin` | Nudge `pro.gear.backlash_mm` (`±0.05 mm`) |
| **6. Kip Ball & Turret Joints** | `12`–`16` | `parts/kip/scad/kip_params.scad` | `[ ] Poseable ±15° hold` | Nudge ball interference in `kip_params.scad` + `npm run build:kip -- --scad` |

### Lock-In Command Sequence After Physical Pass
```bash
# After updating parts/partspec/interfaces.json ("status": "CALIBRATED ..."):
cd parts/partspec && /tmp/tvvenv/bin/python3 toyventor_parts.py out && /tmp/tvvenv/bin/python3 toyventor_assembly.py out && /tmp/tvvenv/bin/python3 selftest.py out && /tmp/tvvenv/bin/python3 make_specs.py .
cd ../.. && npm run bridge && npm run build:kip && npm run validate && npm test
```
