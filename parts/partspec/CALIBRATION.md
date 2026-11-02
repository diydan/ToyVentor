# Calibration print: check sheet

One print turns ToyVentor's fit targets into measurements for your printer. Files are in `calibration/` (regenerate with `python3 make_calibration.py`).

> **Safety:** the ladders, stud tester, pins, shaft and balls are small parts and testing tools. Keep them all away from your son.

## 1. Print

| File | What it is |
| --- | --- |
| `toyventor_cal_forge_mount_first_print.stl` | Hidden-calibration 3x2 Small Forge Mount + 1/2/3-dot selector strip + 2x1 test brick |
| `toyventor_cal_snap_ladder.stl` | Snap stud-hole ladder, 8 steps |
| `toyventor_cal_stud_tester.stl` | One designed Small stud on a solid-bottom handle (zero underside cavities) |
| `toyventor_cal_pro_ladder.stl` | Pro ladder: flat-sided bores (one row) and round bores (other row), 8 steps |
| `toyventor_shaft_tu03_P.stl` | Shaft, for the flat-sided row |
| `toyventor_pin_free_P.stl` | Free pin, for the round row (should turn) |
| `toyventor_pin_friction_P.stl` | Friction pin, for the round row (should grip) |
| `toyventor_cal_cube_cell.stl` | Print-optimised experiment: cube cell with a hole in every face (**print 2**) |
| `toyventor_cal_face_plate.stl` | Print-optimised experiment: smooth face plate with a crush-rib plug (**print 2**) |
| `toyventor_cal_flex_skin_coupon.stl` | Card D 0.80/0.60 mm flex skin coupon (prints smooth show-face-down with upward-opening blind stud sockets; zero supports) |

Print every file as it loads (flat on the bed, no supports — every underside socket is self-roofing and the flex skin prints show-face-down so even slicers with Auto Support left on generate zero support material inside sockets). **Give the shaft, free pin, friction pin and cube cells a 3 mm brim:** the slicer's stability check says they can come loose from the bed without one (`validation/calibration/`). Trim the brim off before testing. Settings: 0.4 mm nozzle, 0.2 mm layers, PLA, 3 walls, 15 to 20% infill. **Set any XY, contour or hole compensation to 0 for this print,** so it shows how the printer really runs. Note the printer, slicer and filament.

## 2. Read the ladders

- **Step 1 is at the notched corner.** Steps go 1 to 8 from there.
- **Step 2 carries a dimple:** that is the designed size. Each step adds 0.1 mm of clearance across.

**A. Snap (stud tester in the Snap ladder).** Press the stud into each hole. The right step: it goes in with a firm press by hand, holds when you turn the ladder over and shake it gently, and comes out by hand without tools. Record that step.

**B. Pro, flat-sided row (shaft).** Push the shaft's end into each flat-sided hole. The right step: it slides in with finger pressure and has no turning play. Record that step.

**C. Pro, round row (pins).**
- Free pin: the right step turns freely with no wobble.
- Friction pin: the right step takes a firm thumb push, holds, and comes out by hand.

Record both steps.

**D. Print-optimised experiment (cube cells and face plates).** These parts grip by flexing, not by precision, so they should fit without any slicer compensation. Use the first print, with compensation at 0.
- Do the sideways holes in the cubes look round, and does the friction pin go in?
- Join the two cubes with the friction pin, side to side and then top to bottom. Does it grip, and come apart by hand?
- Push a face plate into an open hole. Does it hold, come out by hand, and sit flat?
- The point: if the friction pin and plates fit at 0 compensation, while the studs in test A needed a step other than 2, flexing joints beat precise ones on this printer.

**E. Flex skin coupon (on the 3x2 Forge Mount base).** Flip the flex skin over (its smooth bed face is the outside show surface) and press its blind stud sockets onto the 3x2 Forge Mount studs. Fold the free flap along the 0.60 mm hinge web and count the folds before whitening or cracking (PLA is a feel-and-count baseline; Card D skins print in PETG or TPU).

## 3. Turn the step into one setting

Tests A and B share the same designed clearance. Use their step (they should agree within one step) to read the offset `s`, which is how much each printed surface grows:

| Step | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Extra clearance D (mm) | -0.1 | 0.0 | +0.1 | +0.2 | +0.3 | +0.4 | +0.5 | +0.6 |
| Offset s = D / 4 (mm) | -0.025 | 0 | +0.025 | +0.05 | +0.075 | +0.10 | +0.125 | +0.15 |

Then compensate by `s`:
- **Bambu Studio / OrcaSlicer:** X-Y contour compensation = -s; X-Y hole compensation = +s.
- **PrusaSlicer:** XY Size Compensation = -s.
- **Cura:** Horizontal Expansion = -s.

Reprint the Snap ladder with that setting. Step 2 (the dimple) should now feel right. If it does, the printer is calibrated: every part's fit was designed for that.

If neither A nor B finds a good step (step 1 too loose, or step 8 still too tight), tell me. The ladder needs a wider range for that printer.

## 4. Send back

```
Printer / slicer / filament:
A  Snap stud step:
B  Pro shaft step:
C  Free pin step:            Friction pin step:
D  Cubes: sideways holes clean? yes / no | pin grips in cube: yes / loose / tight | face plate holds: yes / loose / tight
E  Flex skin: sockets fit? yes / loose / tight | folds before whitening/crack:
Reprint at -s: step 2 feels right?  yes / no
Notes (anything that broke, warped, or felt odd):
```

These results set your printer's offsets in `interfaces.json` and confirm or adjust the friction pin's fins.
