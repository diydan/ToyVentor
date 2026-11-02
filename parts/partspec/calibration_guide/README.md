# Calibration guide

A single-file page for working through the calibration print: a 3D view of every gauge (exploded and construction),
the test steps, and a scorecard that produces the text to send back.

Open `parts/partspec/calibration/calibration-guide.html` by double-clicking it. It needs no server and no network, and nothing
leaves the machine: answers are kept in the browser's local storage.

## Rebuild

```bash
parts/partspec/.venv/bin/python3 parts/partspec/calibration_guide/build_guide.py   # geometry + poses -> guide_assets.json
node parts/partspec/calibration_guide/build.mjs                                    # bundle -> ../calibration/calibration-guide.html
```

Rebuild after `make_calibration.py` regenerates the STLs in `calibration/`, or when a calibration file or the gcode changes.

## What each file does

| File | Role |
| --- | --- |
| `build_guide.py` | Reads the printed STLs, splits the breakaway-tab first-print coupon into its pieces, places each gauge pair in its test pose with an explode offset, and checks every pose with `manifold3d` (no unexpected overlap, the gauge really sits inside its hole, each cut crosses the tabs only). Also reads the print settings from the gcode. Exits non-zero on any failed check. |
| `app.js` | The viewer (three.js) and the scorecard. |
| `template.html` | Page shell and styles. |
| `build.mjs` | Bundles `app.js` with three.js and inlines `guide_assets.json` into one HTML file. |

## Notes on the poses

- Ladder gauges never overlap their holes in CAD, even at step 1 (clearance is 0 or more at every step), so any tightness you
  feel comes from the printer. The friction pin is the exception: its fins bite on purpose, and that bite shrinks as the step grows.
- At full insertion the friction pin's fins sit where the three holes of a cube cross, so the CAD shows no bite there. The
  build prints the numbers, and the guide tells the user how to read a loose result in test D.
- The flex skin coupon prints smooth show-face-down (`[180, 0, 0]`) so its blind stud sockets open upward with zero overhangs or support plugs; the guide flips it over onto the 3x2 Forge Mount studs in the test pose.
- The scorecard text matches the reply format in the calibration instructions. The guide never marks a physical check
  (`F1_printed_fit`, `F2_breakage`) as passed.
