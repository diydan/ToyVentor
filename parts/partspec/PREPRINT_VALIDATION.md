# Pre-print validation

`preprint_check.py` checks any STL before it is printed or ordered, and writes one JSON report per part that the app can act on. It works on our catalog parts, on generated designs, and on Forge Mounts made from a scan.

## What runs

**Stage 1, geometry (always runs).** Pure Python on trimesh (MIT) and manifold3d (Apache-2.0), both already project dependencies.

| Check | Level | What it catches |
| --- | --- | --- |
| `V1_mesh_sound` | block | Holes in the mesh, flipped faces, more than one body |
| `V2_on_bed` | block | Part not sitting on the bed (z = 0) |
| `V3_fits_bed` | block | Bigger than the bed |
| `V4_no_steep_overhang` | block | Downward surface steeper than 45 degrees (needs supports) |
| `V5_no_floating_islands` | block | A piece of a layer resting on nothing, found by slicing every layer |
| `V6_bridge_span` | block | A bridge longer than 20 mm, measured between its supports, so roofs held up by tubes are judged correctly |
| `V7_min_feature` | warn | A feature narrower than the nozzle. Dome tops are ignored, because slicers skip them |
| `V8_wall_thickness` | warn | Thin regions. Counted when walls are under 0.8 mm over 2 mm², or under 0.4 mm over 0.25 mm². A reading is ignored where the two sides meet at a nearby edge (within 3 mm along the surface), because a sharp edge always reads thin at its tip and slicers handle it |
| `V10_no_ledges` | block | A flat underside held on one side only: a ledge over air, not a bridge. Each point needs support on both sides along some straight line within 20 mm, or must lie within 1 mm of support |
| `V9_bed_contact` | info | Bed contact area, height, slenderness, and whether the centre of mass sits over the contact |

**Stage 2, slicer (when PrusaSlicer is installed).** The part is sliced with the print profile, recording filament (g and m), print time, filament cost, layer count and the slicer's stability warnings.

| Check | Level | Meaning |
| --- | --- | --- |
| `S1_slices` | block | The slicer produced G-code |
| `S2_slicer_stability` | warn | Stability warnings remain after any brim fix |
| `S3_slicer_blocking` | block | The slicer found something that would print in mid-air |

If the slicer reports low bed adhesion, the part is re-sliced with a 3, 5 and then 8 mm brim. The smallest brim that clears the warning goes into the report's `print_settings`.

## Verdicts and what the app does

| Verdict | App action |
| --- | --- |
| `pass` | Print or sell as is |
| `pass_with_settings` | Print with `print_settings` applied (today only `brim_width_mm`); send them to the print service with the file |
| `pass_with_warnings` | Printable; show the warnings and queue the part for review before it reaches customers |
| `fail` | Do not print or sell; show the summary line |

## Running it

```
python3 preprint_check.py part.stl                        # one file, report in validation/
python3 preprint_check.py --catalog                       # every catalog part
python3 preprint_check.py --catalog --part pin_free       # chosen catalog parts
python3 preprint_check.py part.stl --no-slice             # geometry only (no slicer needed)
python3 preprint_check.py --summarize --out validation    # rebuild summary.json / summary.csv
```

In code: `from preprint_check import check_stl; report = check_stl(path, profile)`.

Outputs:
- `validation/<part_id>.json`: one report per part. The format is defined in `validation_report.schema.json`.
- `validation/summary.json` and `summary.csv`: verdicts, filament, time and brim for every part.

Each report records the file's SHA-256 fingerprint. An unchanged file checked with the same profile and validator version reuses its earlier slice, so the app can re-check cheaply.

## Print profile

`print_profiles/fdm_pla_0.4.json` holds the printer, process, filament and limits; the limits come from `interfaces.json` where it has them. It also sets each slicer warning's level:
- **block:** floating object part, empty layer.
- **warn:** collapsing overhang, floating bridge anchors, loose extrusions.
- **brim:** low bed adhesion.
- **info:** long bridging extrusions. PrusaSlicer raises this on every brick roof, even 7.6 mm ones, and our own V6 check already caps bridges at 20 mm.

Add a profile per printer or print service. Once the calibration print gives a printer's offset, record it there.

## Setting up the slicer

PrusaSlicer 2.8.1 is the last release with a Linux AppImage on GitHub; 2.9 ships for Linux as a Flatpak. Even from the command line it needs the GTK and WebKit libraries (on Ubuntu: `libwebkit2gtk-4.1-0 libgtk-3-0 libglu1-mesa libegl1 libopengl0`). Extract the AppImage (`--appimage-extract`) and point `PRUSASLICER` at `squashfs-root/AppRun`. On/off options take no value (`--no-support-material`, not `--support-material 0`). Slicing takes about 2 to 3 seconds per catalog part.

## How to put it in the app

1. **Server-side job (recommended now).** Run the check when a design is generated, uploaded or changed. Store the report beside the design and show the verdict. Send `print_settings` with every print order. The fingerprint cache keeps repeat checks cheap.
2. **Order gate.** The checkout or "send to print service" step refuses `fail` and asks for review on `pass_with_warnings`.
3. **Pricing input.** `filament_g` and `print_time_s` are the inputs a price estimate needs. `filament_cost_usd` is filament only, not a print price.
4. **Browser preview (later).** Kiri:Moto (MIT) slices in the browser and could show layer previews without a server round trip. The server check stays the gate.

## Tools researched

| Tool | What it does | How it runs | Licence | Our use |
| --- | --- | --- | --- | --- |
| PrusaSlicer | Full slicer with a complete command-line interface; stability analysis (bed adhesion, floating parts, bridges) | CLI, headless | AGPL-3.0 | Stage 2 slicer |
| OrcaSlicer | Slicer with a headless command line (`--slice`, settings and filament files); some builds need a display, even headless | CLI, headless | AGPL-3.0 | Alternative to PrusaSlicer; matches Bambu-style profiles |
| CuraEngine (cura-wasm) | Cura's engine compiled to WebAssembly for browser and Node | npm | AGPL-3.0 / LGPL-3.0; package marked deprecated | Not used |
| Kiri:Moto | Browser slicer with a JavaScript engine API and a Node command line | Browser, Node | MIT | Candidate for in-app previews |
| trimesh | Mesh loading, repair checks, ray casting, mass properties | Python | MIT | Stage 1 |
| manifold3d | Robust solids, slicing into layers, 2D offsets | Python | Apache-2.0 | Stage 1 (layers, islands, bridges, features) |
| PyMeshLab | MeshLab filters, including thickness analysis | Python | GPL-3.0 | Not used (licence) |
| ThinSkin | Thin-region detection by inward ray casting | Python | MIT; one commit | Not used; V8 uses the same idea on trimesh |
| Tweaker-3 | Finds a good print orientation for a mesh | Python | Not checked | Later: for generated and scanned designs, which arrive in arbitrary orientations |

**Licence note (not legal advice).** The AGPL slicers are run as separate, unmodified programs; nothing of theirs is in this repository. Check with counsel that this holds for a hosted service before launch.

## Current results (catalog, 2026-10-28)

60 parts: 47 pass, 11 pass with a brim, 2 pass with warnings, none fail. The whole catalog uses about 790 g of PLA and about 76 hours of printing.

- **Need a 3 mm brim:** the free pin, both friction pins, the three shafts, the Bumper Horns, the Glow Capsule, the Small Cloud Wings and the Ridge Fin. The Small Zoom Capsule needs 5 mm.
- **For review:** floating bridge anchors over the Large stud holes of the Waddle Tail and Large Cloud Wings. These are slicer warnings about round 13.3 mm hole ceilings, which usually print fine.
- **Calibration kit:** every piece passes; the shaft and pins need the 3 mm brim, as the check sheet says.

**What the validator found and how it was fixed (2026-10-28):**
- **Cloud Wings, both sizes:** each part's stud hole opened into the V between the wings. Only 40% (Small) and 60% (Large) of the hole was covered just above its ceiling.

  Fixed in the generator: every full stud hole now gets at least 1.2 mm of roof, with a boss clipped to the footprint where the shape is too thin. A new block check, `I7_hole_roof`, proves it on all 15 parts with integrated holes.
- **Small slope:** a knife-edge ridge narrower than the nozzle. Fixed for both slopes with a 1 mm front lip and a 1.6 mm flat top.
- **Ridge Fin:** a needle apex narrower than the nozzle for several layers. The rounding in its builder had been commented out by mistake; it's restored with a 1 mm radius.
- **Bounce Capsule:** a false alarm. Its thin readings were two sharp rims, which is what led to the edge rule in V8.
- **Pebble Armor Shells:** their full holes were always roofed. The thin readings sat over partial relief cuts at the rim, which are open at the side by design. No change.

## Limits

**Closed (2026-10-28):** a flat underside used to count as a bridge even when it was held on one side only; only the slicer caught those ledges. `V10_no_ledges` (and the generator's `P4_no_ledges`, the same code in `toyventor_ledge.py`) now tells a bridge from a ledge.

These checks predict printability on paper; they don't replace the calibration print or the physical checks (printed fit, breakage). Thresholds were tuned on this catalog against known false alarms (dome tops, sharp edges, tube-supported roofs). Recheck them when new kinds of part arrive. PrusaSlicer's stability model is cautious, so its levels live in the profile, where you can change them.
