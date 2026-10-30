# ToyVentor Interface Standard v0.4.0-draft

> **Status:** TARGETS ONLY - nothing has been printed yet. Values lock after the calibration piece has been through fit loops on a real printer. Verified so far only for brick, plate and Forge Mount geometry; add-ons and capsules still need re-proportioning to the TU lattice.

This document is generated from `interfaces.json`. Edit the JSON, not this file.

## 1. Lattice

One base unit for every product line: **1 TU = 12.5 mm**.

Every interface pitch is an integer multiple of the TU, so all product lines share one lattice. Snap Small = 1 TU, Snap Large = 2 TU, Pro holes = 1 TU (halving to 1/8 TU).

**Nesting:** Snap Large studs land on every other Pro bore position; Snap Small studs land on every Pro bore position.

**Decision:** Decided 2026-10-28 by Dan: Snap moves from 8/16 mm to 12.5/25 mm so Snap and Pro share one lattice. Its one condition (a hand-feel check of a printed Large 2x2) was withdrawn the same day, when Snap became ages 3 and up only and Large was parked.

## 2. Interfaces

### Stud grid (Snap)

| Value | Small | Large |
| --- | --- | --- |
| Pitch (mm) | 12.5 | 25.0 |
| Stud diameter (mm) | 6.6 | 13.2 |
| Stud height (mm) | 2.8 | 5.6 |
| Diametral clearance target (mm) | 0.1 | 0.1 |
| Outer wall (mm) | 2.0 | 3.0 |
| Edge radius (mm) | 1.5 | 2.4 |
| Bed-edge chamfer (mm) | 0.5 | 0.6 |
| Plate height (mm) | 5.0 | 10.0 |
| Brick height (mm) | 15.0 | 30.0 |
| Fit class | FRICTION | FRICTION |

**Clearance:** Each size has its own clearance value (stud_small.fit, stud_large.fit). Both start at 0.10 mm as placeholders. Print clearance does not scale linearly with part size, so Large is expected to need more; the calibration piece sets both.

### Hole grid (Pro)

Pitch 1.0 TU (12.5 mm), halving down to 1/8 TU. Free bore 7.0 mm. Fixed bore flats 5.1 mm. Shaft 6.6 mm round, flats 5.0 mm, 2.0 mm centre hole. Pro hole grid. Free bore: shaft turns. Fixed bore: shaft drives.


### Pro parts (pin, beam, gear)

**Friction pin:** shaft 6.6 mm round, flats 5.0 mm, 2.0 mm centre hole; fins 0.4 mm wider across than the bore (target). Friction pin: flat-sided core (6.6 round, 5.0 flats) split open through both insertion ends with solid center web(s) between TU modules so the cantilever prongs flex elastically (<2% PLA strain); a fin on each round side at the centre of every TU stands fin_oversize_mm wider across than the free bore. Prints lying on a flat.

**Beam:** 1.0 TU section, longest 14 TU (175.0 mm); outside fillet 1.5 mm (0.5 mm on small features); hole-mouth chamfer 0.4 mm; bed-edge chamfer 0.5 mm. One bore on the centre of every TU cell along the length (first bore 0.5 TU from the end).

**Gear:** module 2.5 mm (target). module_mm * (z1 + z2) / 2 must be a multiple of 0.5 TU (6.25 mm), so meshing gears sit on the hole grid. With module 2.5, z1 + z2 must be a multiple of 5. Hub takes the fixed bore (5.1 mm flats). Module, backlash and thickness are TARGETS. Involute teeth, 20 degree pressure angle; each gear thins its teeth by backlash / 2 at the pitch circle. Gears are 0.5 TU thick and print flat.

### Mating rules

- `stud_grid` (M) with `socket_grid` (F): same size_class; opposed normals; seat planes coincide; cell centres coincide.
- `pin` (M) with `bore_grid` (F): pin profile fits bore class (free or fixed); axes coincide.

### Pro connectors and pin-and-bore rules

Pro parts print flat; most bores and pins run along z, and a connector may point along x or y (hinge knuckles, the cross connector). In a build, Pro parts may be tipped onto their side in quarter turns. A `bore_grid` connector (F) anchors its grid at the first bore centre (`anchor: corner`) with a `bore_class` (free or fixed) and a `depth_mm`; a `lattice` of `cell` means bores sit on cell centres measured from the part's corner, `axis` means on the part axis (gears, wheels). A `pin` connector (M) puts the pin axis at the frame origin, with a `profile` (round, flats, friction) and a `length_mm`. A pin and a bore mate when the axes coincide and their z ranges overlap, and the pair appears in this table:

| Pin interface | Bore class | Fit class |
| --- | --- | --- |
| `pin_free` | free | free |
| `shaft_drive` | free | free |
| `shaft_drive` | fixed | press |
| `pin_friction` | free | friction |

A pin and bore that are not listed cannot mate (a round pin in a fixed bore, for example). The fit class picks the limits: press uses the top-level tolerance numbers, free and friction use tolerance.classes.


## 3. Forge Mount (single definition)

ONE part family for both product lines. It gives a scanned toy a connector face.

- **Frame:** origin at centre of the toy attach point, on the mount's underside plane; +z points away from the toy (outward); +x toy forward axis as captured by the scan.
- **Attach:** through-hole, default 18.0 mm (set from the scan), 1.6 mm lead-in, 3 crush ribs. hole_d comes from the scan at generation time; 18 mm is a stand-in.
- **Face options:** `stud_large`, `stud_small`, `bore_grid`. Demo uses `stud_small`.
- **Rule:** A mount carries exactly one face option. Pro and Snap share the frame, the attach method and the generator; they differ only in the face option.
- **Grid rule:** A stud is omitted if its edge lies within hole_d/2 + lead_in + 0.5 mm of the attach centre. At least 4 studs must remain, otherwise use a larger grid. Omitted cells are recorded in the connector metadata.

## 4. Part metadata (for tools and AI)

Every part has a manifest entry (`part_manifest.schema.json`) with typed, gendered **connectors**: kind (`stud_grid`, `socket_grid`, `bore_grid`, `pin`, `bore`), gender (M/F), size class, a frame (origin + normal), and a grid (nx, ny, pitch, omitted cells). Two connectors mate when kinds are complementary, genders differ, size classes match, normals oppose, seat planes coincide and cell centres coincide.

**Generation loop:** (1) give the model the part catalog; (2) the model proposes `attach(parent connector, child part, child connector, cell, cell, rotation)` steps, never raw coordinates; (3) the validator accepts or rejects with a specific code and the model retries.

Validator error codes: `unknown_part`, `duplicate_id`, `size_mismatch`, `misaligned`, `profile_mismatch`, `gear_mesh_distance`, `unsupported_pose`, `floating`, `collision`.

## 5. Checks

Severity is data: each check's level lives in `interfaces.json` and nowhere else.

| ID | Group | Level | Meaning |
| --- | --- | --- | --- |
| `G1_watertight` | geometry | block | Mesh is closed (no holes). |
| `G2_winding` | geometry | block | Triangle winding is consistent (no flipped faces). |
| `G3_single_body` | geometry | block | Exactly one connected body. |
| `G4_on_bed` | geometry | block | Lowest point is exactly on the bed plane (z = 0). |
| `G5_fits_bed` | geometry | block | Bounding box fits limits.bed_mm. |
| `P1_no_supports` | printability | block | Downward-facing surface steeper than limits.max_overhang_deg totals less than limits.steep_overhang_max_mm2 (flat bridges and the first layers are handled separately). |
| `P2_bridge_span` | printability | block | Longest unsupported flat span (cavity roof) is within limits.max_bridge_mm. |
| `P4_no_ledges` | printability | block | Every flat downward face is a real bridge: each point has support on both sides along some straight line within limits.max_bridge_mm, or lies within limits.ledge_cantilever_mm of support. Ledges held on one side only total less than limits.ledge_max_mm2. |
| `P3_wall_min` | printability | info | Design wall thickness is at least limits.min_wall_mm (3 perimeters of a 0.4 mm nozzle). |
| `I1_lattice` | interface | warn | Interface pitch is an integer multiple or divisor of lattice.unit_mm. |
| `I2_connectors_on_part` | interface | block | Every connector cell lies on the part. |
| `I3_seats_on_reference` | interface | block | Part seats on a matching reference part with overlap below limits.seat_overlap_max_mm3 at target clearance. |
| `S1_small_part_screen` | safety | warn | Design-time screen against safety.small_parts_cylinder (conservative; not a lab test). |
| `M1_manifest_schema` | metadata | block | Manifest entry validates against part_manifest.schema.json. |
| `F1_printed_fit` | physical | block | Printed parts seat as intended: the measured printer surface offset falls inside the part's fit window (see manifest `fit`). Needs a calibration print. |
| `F2_breakage` | physical | block | PENDING: no piece produced by breakage fits the small-parts cylinder. |
| `T1_fit_as_designed` | tolerance | block | Seated on its partner, every engaged stud's measured radial gap equals the interface's design gap (fit / 2) within the faceting allowance, and the design gap itself is inside the max play and max interference limits. Catches cavities built too loose, too tight or without the tubes that hold the stud, and an interface changed to a clearance that cannot work. |
| `T2_fit_tolerance_window` | tolerance | warn | With printers calibrated to the stated surface error, the connection stays between the max interference and max play limits. Also records the printer surface offset window the calibration print must land in. |
| `I4_bore_on_grid` | interface | block | Every bore is on the lattice and really exists. Bores are a multiple of 1/8 TU apart and sit on the centre of a cell measured from the part's corner (beams and plates) or on the part's axis (gears and wheels). A bore exists when an empty probe fits inside it and there is material in a ring just outside. |
| `I5_pin_fits_bore` | interface | block | Every pin and bore is accepted by at least one pin_bore rule, and the built section matches the interface numbers (free bore 7.0, fixed bore 5.1 flats, shaft 6.6 round with 5.0 flats). The measured clearance is T1 and T2. |
| `I6_gear_on_grid` | interface | block | A gear's module equals the interface module, its pitch diameter is a whole number of TU (so any two gears centre on the 0.5 TU grid), and the built tip diameter matches module x (teeth + 2). |
| `I7_hole_roof` | interface | block | Every integrated stud hole is closed by at least 1.2 mm of material above its ceiling (six layers), so no hole opens into the part's surface. The builder adds a boss, clipped to the part's own footprint, where the shape is thinner. |

Each check says where it applies (`applies`: connector kinds or part families). A check that applies to a part must be emitted for it. A check that applies to no part yet is dormant, and the build still tests it with fixtures.

`block` failures stop export. `warn` is shown. `info` is noted. `pending` checks need a physical print and are never reported as passed.

### Fit and tolerance

Fit is measured, not assumed. After a part is built it is seated on its matching reference part (or a copy of itself), both are sliced at mid-stud height, and every engaged stud gets a signed radial gap against the female outline: positive is clearance, negative is interference. The measurement uses the built geometry, so a cavity that is too loose, too tight or missing its tubes shows up even when nothing overlaps.

- **T1 (block):** each measured gap equals the interface's design gap (fit / 2) within the faceting allowance, and the design gap itself is inside the limits: at most 0.2 mm play and 0.1 mm interference (radial).
- **T2 (warn):** if both parts print with a surface error of up to +/-0.05 mm after calibration, the gap still stays inside those limits. The part's **fit window** is the printer surface offset range that satisfies both limits, and the calibration print has to land inside it (check F1).
- **Fit matrix:** `build_check` seats every male stud connector on every complementary female connector in the catalog, measures each pair, and lists any connector with no partner. Every build also measures each connection it makes and warns with `fit_out_of_tolerance` if one is off.
- **Fit classes:** `press` (studs in tubes, flat shafts in fixed bores) uses the limits above. `free`: A round pin or shaft that must turn in a free bore: it may never bind, and may rattle no more than this. TARGETS.; `friction`: Compliant friction-pin fins: interference is by design (fin_oversize / 2). Not measured here; retention needs a print.
- **Resolution:** fit-critical cylinders use 96 segments, so polygon error stays under 0.01 mm.

| Tolerance value | mm |
| --- | --- |
| `surface_error_calibrated_mm` | 0.05 |
| `surface_error_uncalibrated_mm` | 0.1 |
| `max_interference_mm` | 0.1 |
| `max_play_mm` | 0.2 |
| `design_gap_tol_mm` | 0.005 |
| `classes` | {'free': {'max_interference_mm': 0.0, 'max_play_mm': 0.35, 'note': 'A round pin or shaft that must turn in a free bore: it may never bind, and may rattle no more than this. TARGETS.'}, 'friction': {'note': 'Compliant friction-pin fins: interference is by design (fin_oversize / 2). Not measured here; retention needs a print.'}} |

TARGETS until the calibration print. A surface offset moves every material surface by that amount, so a stud and a tube that both print oversize by e lose 2e of radial gap. Surface error is the spread left after a printer's offsets are applied. Max interference is the deepest radial interference still pushable by hand; max play is the loosest radial clearance still held firmly.

**Limits used by the checks:** `max_overhang_deg` = 45, `bed_mm` = [180, 180, 180], `max_bridge_mm` = 20, `first_layer_exclusion_mm` = 0.7, `min_wall_mm` = 1.2, `steep_overhang_max_mm2` = 1.0, `seat_overlap_max_mm3` = 0.5, `addon_body_scale` = 1.5625, `addon_body_scale_note` = 12.5 / 8: add-on body dimensions drawn for the old 8 mm lattice scale by this; wall, clearance, fillet and embed constants stay fixed (Snap v2.1)., `fit_segments` = 96, `fit_segments_note` = Polygon count for every fit-critical cylinder (studs, tubes). At 32 the chord error on a Large stud was about 0.03 mm, as big as the 0.05 mm design gap., `min_roof_mm` = 1.2, `ledge_max_mm2` = 1.0, `ledge_cantilever_mm` = 1.0.

## 6. Safety and the print page

Small-parts screen: cylinder 31.75 mm across, 25.4-57.1 mm deep. US 16 CFR 1501 / EN 71-1 style test; a part (or any piece that can break off) that fits entirely inside, in any orientation, is a small part. The screen uses the deepest setting and tries many orientations, so it over-flags rather than under-flags. It does not replace a lab test or a breakage test.

Each part gets a status and the print page shows the matching text below it, always preceded by the general notice:

- **always:** Printed at home or by a print service. Not tested to toy-safety standards. Adult supervision required. Check for cracks, sharp edges and loose pieces before each use, and stop using anything that has broken.
- **small_part:** CHOKING HAZARD - Small parts. Not for children under 3 years.
- **marginal:** This part is close to the small-parts size limit. Treat it as not suitable for children under 3 years.
- **above_cylinder:** Larger than the small-parts test size in our size check. This is not a safety certification, and it is not rated for children under 3 years.

A warning label is the right tool only for parts marketed to children 3 and over. For anything marketed to children under 3, small parts are not allowed, so those parts must pass the cylinder and breakage checks and be tested by a lab. Confirm with a toy-safety professional before selling printed parts for under-3s.

## 7. Part conformance

A part conforms when the generator reports no blocking failure and the small-parts result is not marginal. The generator computes `design_status` from the check results, so a part cannot be marked verified by hand.

- **verified:** No blocking check fails, the small-parts screen is not marginal, and a Large part clears the small-parts cylinder. Pending physical checks do not count against it.
- **needs_reproportion:** Anything else. A build that uses such a part gets an unverified_part warning.

**To add a part:**

1. Pick the line, the size class and the interface the part exposes (an entry in `interfaces`).
2. Add a catalog row (`catalog.json`) with `family`, `size`, `build`, `type`, `behavior` and `tags`. A row in a family (block, tile, slope, dome) needs no code. A bespoke part (add-on, capsule, Pro part) names one function that returns (manifold, connectors, extras), built with `block()`, `stud_conn()`, `socket_conn()` or the Pro primitives so geometry and metadata cannot drift. Take every number from `interfaces.json`.
3. Run `generate`. Read every failing check, fix the geometry or the row's parameters, and run again until no `block` check fails and the small-parts result is not `marginal`.
4. Run `build_check`, regenerate the standard, agent and catalog files, then run `selftest`. All must pass before the part is used.

**Rules every part follows:**

- Never type a footprint. The foot comes from the interface, so it is on the lattice by construction.
- Body dimensions drawn at the old 8 mm scale are multiplied by `limits.addon_body_scale`. Walls, clearances, fillets and embed depths are print-limited constants and are not scaled.
- Nothing tilted or curved above the foot may leave an underside steeper than `limits.max_overhang_deg`. Bury roots in the foot and let `keep_above()` trim them flush.
- If the small-parts result is `marginal`, resize the part until it is clearly inside or clearly outside the cylinder. A Small part may be `small_part` (ages 3 and up, carries the warning). A Large part must be `above_cylinder`.
- A part has exactly the connectors it physically has. Never claim a mate the validator does not enforce.
- Fit-critical cylinders (studs, tubes, bores) use `limits.fit_segments` polygons. A coarser cylinder shrinks the printed gap by more than the design gap.
- Every mating feature is fit-measured. If a part adds a new kind of mating feature, extend `seat_pair()` so `fit_report()` measures it; a connection the fit check cannot see is not verified.
- When a family parameter puts a part in the marginal small-parts band, change the parameter in the catalog row (a Small slope uses 30 degrees, not 45), not the family code.
- A round outline cannot carry studs on the lattice: the cavity must reach the corner studs, which needs a 28.4 mm outline against a 24.8 mm footprint at Small. Use a dome or other female-only shape on the standard foot.
- A part may print in a different orientation than it assembles (pins and shafts lie on a flat for strength along the axis). The part returns `print_rotation_deg`; printability checks (bed, overhang, bridge, small parts) run on the printed mesh, connector checks run in the assembly frame, and the STL is exported as printed.
- On a square Small 2x2 foot, keep the part under about 25 mm tall or over 57 mm: the foot is 33.8 mm across its rounded diagonal, so anything in between measures marginal in the small-parts screen however it is shaped. Use a larger foot (Small 4x4 or Large 2x2) for a tall Small-line part.
- Add-ons and capsules use an integrated base (`base: integrated`): no plate around the part, stud holes in its own underside. A shape too thin for a hole gets a small pad on two lattice points (`pad`), and a part whose direction matters (`lock`) needs two holes, or one hole plus a relief that keys it against a neighbouring stud; the generator refuses it otherwise. Every integrated part is checked sitting on a full plate, so no stud can hit it where it has no hole.

**Planned checks (not yet enforced):**

| ID | Group | Level | Meaning |
| --- | --- | --- | --- |

Planned, not enforced. Each moves into `checks` in the same change that adds the code that emits it. (Currently none planned.)

## 8. Tooling

interfaces.json (this file). Everything else is generated from it or from the part code.

| Task | Command |
| --- | --- |
| generate | `python3 toyventor_parts.py out` |
| build check | `python3 toyventor_assembly.py out   (also writes out/fit_matrix.json: every mating pair in the catalog, fit-measured)` |
| index | `python3 toyventor_index.py out COMMAND NAME   (COMMAND: list, used-by, uses, impact, checks)` |
| standard | `python3 make_standard.py out/INTERFACE_STANDARD.md` |
| agents | `python3 make_agents.py out` |
| selftest | `python3 selftest.py out` |
| catalog | `python3 make_catalog.py out   (progress toward the top 30 Snap and top 30 Pro parts; writes CATALOG.md)` |
| specs | `python3 make_specs.py out   (assembles specs/: the numbered documents to build against)` |

**Impact index:** `toyventor_index.py` answers which parts use an interface, which mating pairs it affects, and which results go stale if it changes.

**Agent instructions:** `AGENTS.md` is generated from this file and the manifest so an AI agent's rules cannot drift from the model.
