# Spec: Universal Flat-Pack Modular Vehicle & Craft System (Pass 4e — Post-Review Canonical)

## Status, Scope & Canonical Authority

- **Status:** Pre-CAD Engineering Specification (**Pass 4e**, incorporating all `P0`, `P1`, and `P2` findings from two independent pre-CAD engineering reviews). **No repository code has been modified; CAD implementation in `parts/partspec/` remains gated on sign-off of this document.**
- **Canonical note:** This document supersedes both the Pass 4d baseline (`ae0dfaa`) and the temporary condensed summary draft. All coordinates, clearances, `S1` small-part margins, strain bounds, and `<= 170.0 × 170.0 mm` 2D kit-card layouts below are deterministically verified.
- **Lattice & verification honesty:** All interface constants inherit from [`parts/partspec/interfaces.json`](../../parts/partspec/interfaces.json) (`v0.4.0-draft`, `1 TU = 12.50 mm`) and [parts-tu-spec.md](../parts/parts-tu-spec.md). Existing `105` catalog parts (`67` Snap + `38` Pro) are **generator-verified (`TARGETS ONLY`)**; physical checks `F1_printed_fit` and `F2_breakage` remain `pending` until physical calibration prints and use-and-abuse testing are completed.
- **Age grading & safety scope:** Aligned strictly with [`parts/partspec/COMPLIANCE.md`](../../parts/partspec/COMPLIANCE.md) (United States scope: `ASTM F963-23` / `16 CFR 1250`; `EN 71` out of scope until an EU launch). Stage 1 (`Snap`, Cards `A–D`) is rated **Ages `3+`** (`Snap Small`; `Large` under-3 remains parked). Intact parts on Cards `A–D` clear the design-time `S1_small_part_screen` (`above_cylinder`, `> +13%` margin), which is **not** a safety certification and **never** implies suitability for children under 3 years. Every kit carries `print_page_warnings.always` plus the `16 CFR 1500.19` small-parts warning whenever paired with `Snap Small` character accessories or `Pro` components.
- **Clean-room & licensing hygiene:** All geometry is authored from scratch on the `12.50 mm` `TU` lattice under Apache-2.0 (generator code) and CC BY 4.0 (designs/docs) per [`parts/partspec/LICENSING.md`](../../parts/partspec/LICENSING.md). External reference studies, third-party source filenames, and licence audits are kept strictly outside repository specs; no NC or SA source geometry is adapted or derived.

---

## 1. Core Architectural Decisions (Pass 4e Resolved)

1. **Hybrid `50 mm` (`4 TU`) Hull Grid:** `#1 kit_keel_base` (`49.8 × 124.8 × 15.3 mm`, `4×10 TU`) exposes `12.50 mm` `stud_small` top decks alongside `Pro` `bore_grid` (`Ø7.00 mm` free, `5.10 mm` double-D fixed) and `shaft_drive` (`Ø6.60 mm` round, `5.00 mm` flats) running gear, mating with Kip seated legs (`char_legs_seated`), vehicle/racer add-ons, and `Pro` gears without adapters (physical fit pending `F1` calibration).
2. **Single Universal On-Lattice Axle Tier (`z_axle = 6.25 mm = 0.5 TU`):** The off-lattice `high` axle bore is **deleted**. Every axle station on `#1` (`rows 0, 2, 7, 8`) uses one bottom-entry `45°`-teardrop `c_jaw_tu01` tier at **`z_axle = 6.25 mm`** inside the `12.50 mm` solid deck (`1.30 mm >= 1.20 mm` roof). All land builds (**Race Car, Dump Truck, Farm Tractor**) therefore share bottom-click barbell assembly and the exact **`25.00 mm` (`2.0 TU`)** rear PTO gear center distance (`z = 6.25 mm ↔ z = 31.25 mm`).
3. **Steered Front Axle at `row 0` (`Y = 6.25 mm`) + Separate `Pro` Bridge:** Positioning the front axle at `row 0` ahead of the `2×3 TU` tapered nose (`rows 0..2`) eliminates rear-edge tire-to-shoulder clash (`+7.41 mm` shoulder and `+4.17 mm` nose clearance at `±26°` lock with `Ø36.0 mm` wheels; `+2.08 mm` shoulder and `+2.87 mm` nose clearance at `±22°` lock with `Ø50.0 mm` wheels). `#1` carries no protruding kingpin ears; Stage 2 (`Pro`) snaps `pro_steer_bridge` onto `rows 0..1` nose studs above the axle jaw.
4. **Exact `10-Row` (`3 + 3 + 4 = 10`) Deck Allocation & Open-Top Cockpit:**
   - `rows 0..2` (`2×3 TU`): Tapered nose + `#7 kit_aero_wedge` (`24.8 mm` wide, clear of steered tire sweep).
   - `rows 3..5` (`4×3 TU`): Open-top `#8 kit_windscreen_frame` (`22.0 mm` tall, zero roof bridge) + Kip `2×2` seat (`rows 4..5`), giving unrestricted head-out clearance for the full Kip seated stack (`43.0 × 36.0 × 68.0 mm` above deck).
   - `rows 6..9` (`4×4 TU`): Rear Power & Cargo Bay (`#11 kit_tilting_tub` sized `4×4 TU = 49.8 × 49.8 × 18.0 mm`), with a **`10.0 × 33.0 mm` PTO through-slot** centered on `row 8` (`10` perimeter studs retained).
5. **15 Rigid Modules + 3 Smooth `PETG`/`TPU` Flex Skins across 4 Compact `<= 170 × 170 mm` Cards (`A–D`):** Unlocks all 9 canonical craft silhouettes (`60–85%` cross-craft part reuse) with `>= 5.0 mm` bed margin per side on a `180 × 180 mm` printer bed so `preprint_check.py` auto-brims never overflow.

---

## 2. Coordinate Frame, Keel Datum Map & New Interface Primitives

### 2.1 `#1 kit_keel_base` Coordinate System & `10-Row` Allocation (`49.8 × 124.8 × 15.3 mm`)

- **Origin:** `X = 0.0 mm` on longitudinal centerline (`-24.9 .. +24.9 mm`), `Y = 0.0 mm` at nominal front `TU` lattice boundary (part body `Y = 0.10 .. 124.90 mm`), `Z = 0.0 mm` on print bed.
- **Z-Stack:** Bed `z = 0.00 mm` -> Universal axle centerline `z_axle = 6.25 mm` (`0.5 TU`) -> `45°` teardrop apex `z = 11.20 mm` (`R_fillet = 1.00 mm`) -> Solid deck top `z_deck = 12.50 mm` (`1.30 mm >= 1.20 mm` `min_roof_mm`) -> `stud_small` tops `z_top = 15.30 mm` (`stud_h = 2.80 mm`).
- **CPSIA Section 103 Tracking Mark:** `24.0 × 8.0 × 0.40 mm` debossed batch/source code recess centered on the flat `z = 0.00 mm` underside across `rows 4..5` (`Y = 50.0 .. 74.0 mm`, bridged `< 8.0 mm`).

| Rows | `Y` Span (`mm`) | Hull Width (`mm`) | Top `stud_small` Grid | Underside / Flank / End Features | Assigned Craft Modules |
| :--- | :--- | :--- | :--- | :--- | :---
| **`rows 0..2`** | `0.10 .. 37.50` | `24.8` (`2 TU`, `|X| <= 12.4`) | `2×3` (`6` studs; `row 2` center has `Ø7.0` vertical steering bore at `Y = 31.25`) | **Front end (`Y = 0.1`):** transverse `c_jaw_tu01` (`z = 6.25`, opens `-Y`) for loader/plow.<br>**`row 0` (`Y = 6.25`) & `row 2` (`Y = 31.25`):** bottom-entry `c_jaw_tu01` axle stations (`z = 6.25`).<br>**`rows 1..2` (`Y = 14.0..37.5`):** center `5.5×5.0 mm` upper cable channel (`z = 7.5..12.5`). | Steered/fixed front wheels (`row 0`), `#7` Aero Wedge (`2×3`), `pro_steer_bridge` (`rows 0..1`), `#15` steering stem (`row 2`). |
| **`rows 3..5`** | `37.50 .. 75.00` | `49.8` (`4 TU`, `|X| <= 24.9`) | `4×3` (`12` studs; Kip `char_legs_seated` seats on inner `2×2` of `rows 4..5`, centered at `Y = 62.50`) | **Flanks (`rows 4..5`, `Y = 50.0..75.0`):** keyed rectangular wing/skid mortises `flank_rail_tu02` (`18.0 × 4.6 × 8.0 mm` at `z = 4.0..8.6`).<br>**Gunwales (`X = ±18.75`, `z = 7.5..12.5`):** twin `5.5×5.0 mm` cable channels clear of axles. | `#8` Open Windscreen (`4×3`), Kip pilot (`z = 12.5..80.5`), main `#9` Wings or `#10` Skids. |
| **`rows 6..9`** | `75.00 .. 124.90` | `49.8` (`4 TU`, `|X| <= 24.9`) | **`10` perimeter studs** (`row 6` all `4` cols; `rows 7..9` outer cols `0, 3`). Center `10.0 × 33.0 mm` **PTO through-slot** (`X = ±5.0`, `Y = 89.75..122.75`, `2.15 mm` rear cross-tie). | **`row 7` (`Y = 93.75`) & `row 8` (`Y = 106.25`):** bottom-entry `c_jaw_tu01` axle stations (`z = 6.25`; `row 8` is primary PTO axle).<br>**Flanks (`rows 7..8`):** rear `flank_rail_tu02` mortises (`2× #13` pods / delta wings).<br>**Rear edge (`Y = 124.9`, `X = ±14.0`, `z = 9.50`):** twin rearward `c_jaw_tu01` jaws for `#11` Tub hinge, `#2` Boom, or `#9` Ramps. | `#11` `4×4` Dump Tub, `#14` `4×4` Turntable, `#7` Heli Mast House, or `4×4×3 TU` Power Core. |

### 2.2 Toolchain & `interfaces.json` Gap Report (Per `AGENTS.md` Rule 3)

Before authoring Pass 5 CAD, the following four connector/socket definitions must be registered in `interfaces.json` and `seat_pair()` / `toyventor_assembly.py` (which currently validates `stud_grid`, `socket_grid`, `bore_grid`, and `pin` in `90°` `Z`-turns only; arbitrary-angle hinge/steer sweeps are verified via dedicated pose scripts in Gate `G1`):

1. **`socket_small` Reference Geometry (Codifying `toyventor_parts.py` `tube_dims` & `integrated_sockets`):**
   - **`cage` style** (`#7, #8, #11, #14`, Power Cores): outer rim wall `2.00 mm`, design radial stud gap `0.05 mm` (`fit = 0.10 mm`), internal coupling tubes `ID = 6.70 mm` (`ri = 3.35 mm`), `OD = 10.98 mm` (`ro = 5.49 mm`), socket depth `>= 3.20 mm` (`stud_h + 0.40 mm`), closed ceiling roof `>= 1.50 mm` (plates) / `2.00 mm` (bricks), `96` segments (`FIT_SEG`).
   - **`holes` style** (`#13` pod pads): blind stud holes `ID = 6.70 mm`, surrounding boss wall `>= 2.00 mm` (`OD >= 10.70 mm`), depth `3.20 mm`, closed ceiling roof `>= 1.20 mm` (`check I7_hole_roof`).
2. **`c_jaw_tu01` (Pinless Compliant `Ø6.60 mm` Shaft / Hinge Jaw):**
   - **Geometry:** `Ø7.00 mm` (`r = 3.50 mm`) circular seat with `45°` teardrop crown (`R_fillet = 1.00 mm` at apex to suppress notch stress), `242.0°` wrap angle -> **`6.00 mm` throat opening** (`0.60 mm` diametral interference on `Ø6.60 mm` `shaft_drive`, i.e., `δ = 0.30 mm/prong >= 0.25 mm` `min_snap_mm`), prong wall thickness **`t = 1.60 mm`**, axial bearing land **`b = 3.00 mm`** per side wall (central tunnel relieved to `Ø8.20 mm` to prevent shaft binding), `30°` entry lead-in chamfers.
   - **Mechanics (Castigliano curved-beam with `1.3×` inner-fiber factor):** Peak inner-fiber bending strain **`1.01%`** (`< 1.80%` PLA yield; `< 2.30%` PETG yield), radial spreading force **`9.4 N/prong`** (`~10–14 N` palm click-in across twin axle lands), **`0.0%` resting strain** once seated in the `Ø7.00 mm` bore.
   - **Calibration Gate:** Added as a mandatory `F1` coupon printed in `#1`'s exact `z = 0` orientation (`Gate G7`: `500` cycles + `24 h @ 40 °C`, post-test pull-out `>= 6.0 N`).
3. **`flank_rail_tu02` (Asymmetric Keyed Wing/Skid Mortise — True Geometric Poka-Yoke):**
   - **Geometry:** Rectangular pocket `18.0 mm` (`Y`) × `4.60 mm` (`Z`, `z = 4.00 .. 8.60 mm`, `45°` chamfered ceiling, span `<= 8.0 mm < 20.0 mm` bridge limit) × `8.0 mm` deep (`X`), with a **`3.0 × 2.0 mm` forward index step** on the `-Y` edge only and dual `0.25 mm` horizontal friction detents (`fit = 0.12 mm`).
   - **Poka-Yoke Separation:** Cannot accept a `Ø6.60 mm / 5.00 mm` shaft (`4.60 mm < 5.00 mm`), and `#9` swept wings / `#10` skids cannot be inserted backwards (eliminating accidental forward-swept wing reversal).
4. **Rotary Bearing Relief Rule:** Relieved central axle tunnels (`Ø8.20 mm` between `3.00 mm` outer bearing lands) prevent FDM seam/over-extrusion binding along `50 mm` bores; any friction delta vs. full-length bores is logged empirically during `F1` rather than claimed a priori.

---

## 3. Master Module Catalog (`15` Rigid Modules + `3` Smooth Flex Skins)

### 3.1 Complete Dimensional, Printability (`preprint_check.py`) & `S1` Screen Audit

All `Cards A–D` rigid parts print in `PLA` or `PETG` (`0.4 mm` nozzle, `0.20 mm` layers, `0` supports); `Card D` flex skins print in **`PETG` (recommended) or `95A TPU` (`PLA` prohibited due to sustained `~42 MPa` latch creep)**. `S1` values below are computed using the exact 3D projection + minimum-enclosing-circle algorithm from `parts/partspec/toyventor_parts.py:2231` (`Ø31.75 × 57.1 mm` cylinder, `> 10.0%` required for `above_cylinder`).

| # | Part ID | Card (Qty) | As-Printed `BBox` (`X × Y × Z mm`) | Print Pose & Key `P1/P2/V4/V6` Feature | Max Overhang / Max Bridge | `S1` Min Diam (` Margin `) | Primary Roles Across 9 Craft |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `kit_keel_base` | `A` (`1×`) | `49.8 × 124.8 × 15.3` | Flat (`z=0`), studs up; `45°` teardrops (`1.30 mm` roof); `10×33` PTO slot | `45°` / `8.0 mm` | `125.73 mm` (`+296.0%`) | Universal `4×10 TU` hull for 8 of 9 craft |
| **2** | `kit_clevis_spine` | `A` (`1×`) | `27.8 × 99.8 × 15.3` | Flat (`z=0`), studs up; `15.0 mm` clevis slots (`6.4 mm` cheeks), `45°` kickstand jaw | `45°` / `0.0 mm` | `99.80 mm` (`+214.3%`) | Bike/Trike frame, Heli boom (`+10°` stop), Loader boom, Drawbar |
| **3a** | `kit_barbell_shaft` | `A` (`2×`) | `6.6 × 76.0 × 5.0` | `LAY_FLAT` on `5.0 mm` `shaft_drive` flat (`2.0 mm` teardrop core hole) | `45°` / `0.0 mm` | `57.68 mm` (`+81.7%`) | `76.0 mm` outboard wheel axle (`+0.80 mm/side` clearance) & `90 mm` Heli mast |
| **3b** | `kit_spinner_pin` | `A` (`2×`), `B` (`1×`) | `36.0 × 48.5 × 5.0` | `LAY_FLAT` on `5.0 mm` flat: `Ø36.0 mm` grip ring + `12.5 mm` split-fin stem (axial grain!) | `45°` / `0.0 mm` | `36.05 mm` (`+13.5%`) | Bike clevis axle pin, Plane/Heli rotor retainer, Turntable center lock |
| **4** | `kit_wheel_med` | `A` (`4×`) | `36.0 × 36.0 × 12.3` | Flat (`z=0`), `5.1 mm` fixed double-D hub (`veh_wheel_sport` `Ø36` outer profile) | `42°` / `0.0 mm` | `36.00 mm` (`+13.4%`) | Race Car, Truck, Trailer, Bike/Trike, Plane gear, Tractor front (`11.75 mm` clear) |
| **5** | `kit_wheel_giant` | `B` (`2×`) | `50.0 × 50.0 × 12.3` | Flat (`z=0`), `5.1 mm` fixed hub + `4× Ø7.0` face bores (`wheel_tu04` `Ø50` profile) | `42°` / `0.0 mm` | `50.00 mm` (`+57.5%`) | Tractor rear (`4.01°` forward rake), Monster Truck, Paddlewheel |
| **6** | `kit_rotor_blade` | `C` (`3×`) | `68.0 × 20.0 × 6.0` | Flat (`z=0`), `Ø20.0 mm` reinforced hub (`6.5 mm` wall), `3.0 mm` `90°` half-lap | `35°` / `6.5 mm` | `50.68 mm` (`+59.6%`) | `1×` 2-blade Plane/Boat prop; `2×` crossed 4-blade Heli main + `1×` Heli tail |
| **7** | `kit_aero_wedge` | `C` (`1×`) | `24.8 × 37.3 × 33.2` | Flat (`z=0`), `2×3` `cage` sockets; `z=27.0` horizontal `45°` prop bore (`1.25 mm` roof) + top vertical `fixed` mast bore | `45°` / `10.9 mm` | `41.44 mm` (`+30.5%`) | Race/Plane nose (`+4.75 mm` prop clear), Heli rear mast house (`rows 6..8`), Shuttle nose |
| **8** | `kit_windscreen` | `B` (`1×`) | `49.8 × 37.3 × 22.0` | Flat (`z=0`), **open-top U-frame** (`0 mm` roof bridge!), `4×3` perimeter sockets | `45°` / `10.9 mm` | `43.30 mm` (`+36.4%`) | Head-out windscreen/roll-hoop for Kip (`39.8 mm` inner hip width, open above `z=22`) |
| **9** | `kit_foil_wing` | `C` (`3×`) | `74.8 × 49.8 × 5.0` | **Flat-bottom plank airfoil** (`45°` bevel leading edge, `0 mm` underside overhang!), keyed root + `Ø6.6` ramp hook | `45°` / `0.0 mm` | `74.97 mm` (`+136.1%`) | Plane/Shuttle wings & vertical tail (`2+1`), Race GT wing (`1×`), Trailer ramps (`2×`) |
| **10** | `kit_skid_runner` | `C` (`2×`) | `112.3 × 18.0 × 20.0` | Flat (`z=0`), upturned `45°` bow ski, twin `flank_rail_tu02` tongues + underside `Ø60` foam-noodle clips | `45°` / `8.0 mm` | `112.17 mm` (`+253.3%`) | Heli landing skids (`16 mm` drop), Snowmobile skis, Catamaran dry runners + sponson mounts |
| **11** | `kit_tilting_tub` | `B` (`1×`) | `49.8 × 49.8 × 18.0` | Flat (`z=0`), **`4×4 TU`** cargo tub, rear `Ø6.6` hinge bar (`45°` gussets, `55°` stop blocks -> `>= 12 mm` finger gap) | `45°` / `10.9 mm` | `52.95 mm` (`+66.8%`) | Truck/Trailer `55°` tipping dump bed (fits `#1` OR `3 TU` Power Core!), Shuttle bay |
| **12** | `kit_scoop_blade` | `B` (`1×`) | `49.8 × 37.3 × 20.0` | **Printed on flat back wall (`z=0`)** so curved bucket faces upward (`0°` underside overhang!), `Ø6.6` rear crossbar | `40°` / `8.0 mm` | `42.32 mm` (`+33.3%`) | Tractor front loader bucket, Truck snowplow, Heli rescue basket |
| **13** | `kit_booster_pod` | `B` (`2×`) | `24.8 × 65.0 × 28.0` | Flat (`z=0`), `2×4` `holes` sockets + `flank_rail_tu02` tongue, twin chamfered exhaust bells | `45°` / `3.2 mm` | `68.67 mm` (`+116.3%`) | Race/Truck sidepods, Shuttle OMS pods, Plane/Boat jet nacelles |
| **14** | `kit_turntable` | `B` (`1×`) | `49.8 × 49.8 × 8.0` | Flat (`z=0`), **1-piece rotary disc** (`Ø7.0` center `free` bore + smooth `0.30 mm` glide ring, `4×4` top studs + `c_jaw_tu01` saddle), pinned by `#3b` | `45°` / `0.0 mm` | `49.80 mm` (`+56.9%`) | `360°` Tow/Forestry crane slew base & Fifth-wheel Trailer hitch (zero print-in-place fusion risk!) |
| **15** | `kit_yoke_hbar` | `A` (`1×`) | `46.0 × 38.0 × 5.6` | `LAY_FLAT` (`46.0 mm < 49.8 mm` hull width!), `25.0 mm` `shaft_drive` stem + `Ø6.6` handgrips | `45°` / `0.0 mm` | `38.41 mm` (`+21.0%`) | Car/Truck/Plane/Boat steering yoke (`row 2`) & Bike/Trike handlebars |
| **16** | `skin_aero_cowl` | `D` (`1×`) | `96.0 × 37.3 × 0.6` | **Un-grooved `0.60 mm` `PETG`/`TPU` sheet** (`1.2 mm` edge frame stopped `8 mm` from `R >= 20 mm` bend; `V8` thin-wall waiver) | `0°` / `0.0 mm` | `85.59 mm` (`+169.6%`) | Curved hood/fuselage nose cowl (`1.50%` max strain at `R=20 mm`, zero tear-off strips) |
| **17** | `skin_windscreen` | `D` (`1×`) | `96.0 × 36.0 × 0.6` | **Un-grooved `0.60 mm` `PETG`/`TPU` sheet**, dual side slot latches onto `#8` front posts | `0°` / `0.0 mm` | `85.06 mm` (`+167.9%`) | Wrap-around front windscreen / jet visor (stays ahead of Kip's head!) |
| **18** | `skin_cargo_shroud` | `D` (`1×`) | `112.0 × 49.8 × 0.6` | **Un-grooved `0.60 mm` `PETG`/`TPU` sheet**, center `8.0 mm` rib-free `Book-Fold` corridor (`R >= 25 mm`, `1.20%` strain) | `0°` / `0.0 mm` | `112.00 mm` (`+252.8%`) | Shuttle clamshell payload doors, Camper/Wagon canopy, Boat spray deck |

---

## 4. Canonical 9-Craft Assembly Trace & Clearance Proofs

- **Kip Seated Ghost (`ghost_kip_seated`):** Derived from `char_legs_seated` (`24.8 × 27.1 × 18.8 mm`) + `robot_torso_core` (`24.8 × 24.8 × 22.8 mm`) + `char_head_kid` (`40.2 × 35.2 × 34.0 mm`) + `hair_pigtails` (`42.4 mm` wide) = **`43.0 × 36.0 × 68.0 mm`** above the `z = 12.50 mm` seat deck (`z = 12.5 .. 80.5 mm`, centered on `rows 4..5` at `Y = 62.50 mm`), plus `25.0 mm` vertical hand-entry clearance above `z = 80.5 mm`. Every occupied craft below leaves `z > 22.0 mm` across `Y = 44.0 .. 80.5 mm` completely unobstructed.

| # | Craft | Cards Required | Exact Row & Module Assignment | Verified Clearance, Stability & Buoyancy Proof |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Formula / GT Race Car** | `A + C` (`+ B` pods/arch, `+ D` cowl) | `#1` Keel; `4× #4` (`Ø36`) on `2× #3a` (`rows 0, 8`); `#7` Wedge (`rows 0..2`); Kip + opt. `#8` (`rows 3..5`); `1× #9` GT Wing on `row 9` rear studs/riser (`rows 6..8` open for Power Core!); opt. `2× #13` flank pods (`rows 7..8`); `#15` Yoke (`row 2`). | Ground clear `11.75 mm` (`3.0 mm` over `Z10` gear); `row 0` steer lock `±26°` (`+4.17 mm` nose, `+7.41 mm` shoulder, `51.9 cm` circle); `rows 6..9` fits `4×4×3 TU` Power Core with GT wing mounted on Core top-rear studs. |
| **2** | **Dump / Tow Truck** | `A + B` (`+ D` visor) | `#1` Keel; `4× #4` (`rows 0, 8`); `#8` Windscreen + Kip (`rows 3..5`); `#15` (`row 2`); `#11` `4×4` Dump Tub (`rows 6..9`, rear hinge bar in `#1` `Y=124.9` C-jaws) **OR** `#14` Turntable + `#2` Crane Boom (`rows 6..9`); opt. `#12` Front Plow (`Y=0.1` C-jaw). | `rows 3..5` (`#8`) + `rows 6..9` (`#11`) = `7` four-wide rows (`0.2 mm` design gap, zero overlap). `#11` tips `55°` on `#1` **and** on top of any `3 TU` Power Core (replicated top-rear C-jaw at `z=47.0 mm`); rear-tip payload limit `~220 g`. |
| **3** | **Farm / Loader Tractor** | `A + B` | `#1` Keel; `2× #4` (`Ø36`) front (`row 0`) + `2× #5` (`Ø50`) rear (`row 8`) on `2× #3a`; `#8` + Kip (`rows 3..5`); `#15` (`row 2`); `#2` Loader Boom clicked into `#1` **front `Y=0.1` C-jaw** + `#12` Scoop; opt. `#14` Rear PTO Implement Deck (`rows 6..9`). | Single `z_axle = 6.25 mm` tier gives `4.01°` forward rake & **full `25.00 mm` PTO mesh**! Front `Ø36` clears `±26°` steering (`+7.41 mm`). Static front-axle tip limit is `117 g` at `Y = -65 mm` -> **rated safe scoop load `<= 75 g` unpowered (`<= 150 g` with rear Power Core)**. |
| **4** | **Modular Trailer** | `2nd A + B` (`+ C` ramps) | `#1` Keel (`4× #4` bogie on `rows 7, 8`); `#2` Drawbar clicked into Trailer `Y=0.1` front C-jaw (`±25°` pitch) and pinned via `#3b` to Towing `#14` Fifth-Wheel Turntable (`360°` yaw); `#11` Tub or `2× #9` Car-Hauler Ramps hooked on rear `Y=124.9` C-jaws. | True 2-axis (`360°` yaw + `±25°` pitch) articulation; `#9` integral `Ø6.6` root hook clicks natively into `#1`'s `X = ±14.0 mm` rear C-jaws. |
| **5** | **Motorbike & Cargo Trike** | `A` standalone (`+ B` tub) | **Inline Bike:** `#2` Spine (`15.0 mm` clevis slots) + `2× #4` (`Ø36 × 12.3 mm`) pinned by `2× #3b` + `#15` Handlebar (`vertical front bore`) + `1× #3a` clicked into `#2`'s `45°` side kickstand jaw.<br>**Cargo Trike:** `#2` + `1× #4` front (`#3b`) + `2× #4` rear outboard on `1× #3a` (`76.0 mm`). | Clevis axial wheel clearance `(15.0 - 12.3)/2 = +1.35 mm/side` (`>= 0.50 mm` rule). `Card A` alone builds **both** the kickstand-supported 2-wheel Bike and self-standing 3-wheel Trike (`Card E1` adds `15°` raked steerable fork). |
| **6** | **Prop / Jet Aeroplane** | `A + C` (`+ B` pods/arch) | `#1` Keel; `2× #4` main gear (`row 0`) + rear keel tail-skid; `#7` Wedge (`rows 0..2`, `z=27.0` bore) + `1× #6` (`Ø68`) Prop pinned by `#3b`; Kip (`rows 4..5`); `2× #9` Main Wings (`rows 4..5` flanks) + `1× #9` Vertical Tail (`rows 8..9` center). | Even dead-level on `Ø36` wheels (`ground z = -11.75 mm`), `#7`'s `z = 27.0 mm` prop axis holds `Ø68.0 mm` (`R = 34.0 mm`) blade tips **`+4.75 mm` above ground** (`+11 mm` in tail-dragger stance); wings (`z = 4.0..9.0`, `Y = 50..124`) clear `row 0` wheels by `> 25 mm`. |
| **7** | **Catamaran / Speedboat** | `A + C` (`+ foam sponsons` for water) | `#1` Keel; `2× #10` Runners in `rows 4..5` / `7..8` `flank_rail_tu02` mortises; `#7` Bow (`rows 0..2`); Kip (`rows 4..5`); `#15` Helm (`row 2`); `1× #9` Sail/Wing or stern `#6` Air-Prop. | **Honest Buoyancy Rule:** `2× #10` gross external volume is `80.9 cm³` (`~45 cm³` net) -> **dry-floor / tabletop runner craft** as printed. For **waterborne play**, clip two household `Ø60 × 125 mm` closed-cell polyethylene pool-noodle cylinders (`706 cm³` gross, **`~424 gf` buoyancy at `60%` draft**) into `#10`'s underside clips (`zero` FDM water weeping). |
| **8** | **Rescue Helicopter** | `A + C` (`+ B` scoop basket) | `#1` Keel; `2× #10` Landing Skids (`16.0 mm` drop -> `ground z = -16.0 mm`); Kip (`rows 4..5`); `#7` Mast House (`rows 6..8`) + vertical `1× #3a` (`76 mm` mast -> `z_top = 109.2 mm`) + **`2× #6` crossed 4-blade Main Rotor** (`z = 96.0 mm`, `#3b`); `#2` Boom on rear C-jaw (`+10°` stop) + **`3rd #6` Tail Rotor** (`#3b`). | Builds 100% from `Cards A + C` (`3× #6` included!). Main rotor at `z = 96.0 mm` clears full-stack Kip (`z = 80.5 mm`) by **`+15.5 mm`**; `+10°` tail boom puts tail rotor center at `z = 26.83 mm` (`42.83 mm` above skid ground -> **`+8.83 mm` ground clearance**). |
| **9** | **Space Shuttle Orbiter** | `A + C` (`+ B` tub/pods, `+ D` `#18` doors) | `#1` Keel; `4× #4` landing gear (`rows 0, 8`); `#7` Nose (`rows 0..2`); Kip + opt. `#8` (`rows 3..5`); `2× #9` Delta Wings (`rows 7..8` flanks) + `1× #9` Vertical Tail Fin; opt. `#11` Payload Bay + `#18` `Book-Fold` Bay Doors (`rows 6..9`) + `2× #13` OMS Pods. | Zero row overlap (`#7` `rows 0..2`, Kip/`#8` `rows 3..5`, `#11`/`#18` `rows 6..9`); `#18` `PETG` clamshell bends at `R = 25.0 mm` (`1.20%` strain) with `8.0 mm` rib-free center corridor. |

---

## 5. Verified Four-Card Kit Layout (`<= 170.0 × 170.0 mm`, `180 mm` Bed Ready)

- **Hard Packing Envelope:** Outer runner frame **`<= 170.0 × 170.0 mm`** (`>= 5.0 mm` margin per side on a `180 × 180 mm` print bed to accommodate `preprint_check.py` auto-brims), outer runner width `3.0 mm × 1.0 mm`, inter-part clearance **`>= 5.0 mm`** between every axis-aligned bounding box.
- **Dual Export & Reinforced Sprue Gates:** Every card exports `card_<id>_loose.stl` (multi-object plate) and `card_<id>_sprue.stl`. Gates are **`1.60 mm` wide × `0.80 mm` tall** (`1.28 mm²`), recessed `0.50 mm` inside the part's `bed_chamfer` with symmetric `45°` V-nicks (`>= 4` gates on parts `> 15 g`; `0` gates on tire treads, gear teeth, or mating faces) so cards survive a `0.5 m` shipping drop test and twist free without leaving sharp points (`16 CFR 1500.48`).
- **Print Times & Materials:** Cards `A–C` print in `PLA` or `PETG` (`~1.8–2.8 h` per card at standard `0.20 mm` profile); Card `D` prints in **`PETG` or `95A TPU`** (`~22–35 min` for `3` layers + `1.2 mm` perimeter frames).

### 5.1 Deterministically Verified `(x, y, w, h)` Bounding-Box Placements (`mm`)

- **`Card A` — Core Chassis, Roadster, Bike & Trike (`11` items, `166.8 × 163.9 mm` outer, `70.6%` box density):**
  - `#1_keel`: `(3.0, 57.6, 124.8, 49.8)` | `#2_spine`: `(136.0, 14.6, 27.8, 99.8)` | `#15_yoke_hbar`: `(85.0, 14.6, 46.0, 38.0)`
  - `#4_wheel_med_1..4`: `(126.0, 119.4, 36.0, 36.0)`, `(3.0, 3.0, 36.0, 36.0)`, `(44.0, 3.0, 36.0, 36.0)`, `(3.0, 112.4, 36.0, 36.0)`
  - `#3a_shaft_1..2`: `(85.0, 3.0, 76.0, 6.6)`, `(3.0, 44.0, 76.0, 6.6)` | `#3b_spinner_1..2`: `(44.0, 112.4, 36.0, 48.5)`, `(85.0, 112.4, 36.0, 48.5)`
- **`Card B` — Heavy Truck, Tractor, Turntable & Booster Pods (`9` items, `165.8 × 168.9 mm` outer, `64.5%` box density):**
  - `#5_wheel_gnt_1..2`: `(3.0, 32.8, 50.0, 50.0)`, `(58.0, 32.8, 50.0, 50.0)` | `#8_windscreen`: `(113.0, 32.8, 49.8, 37.3)`
  - `#11_tilting_tub`: `(113.0, 75.1, 49.8, 49.8)` | `#12_scoop_blade`: `(3.0, 87.8, 49.8, 37.3)` | `#14_turntable`: `(57.8, 87.8, 49.8, 49.8)`
  - `#13_pod_1..2`: `(3.0, 3.0, 65.0, 24.8)`, `(73.0, 3.0, 65.0, 24.8)` | `#3b_spinner_3`: `(112.6, 129.9, 48.5, 36.0)`
- **`Card C` — Aero, Rotor & Ski/Runner Pack (`9` items including `3× #6`, `170.0 × 168.3 mm` outer, `70.0%` box density):**
  - `#9_foil_wing_1..3`: `(57.8, 57.8, 49.8, 74.8)`, `(3.0, 57.8, 49.8, 74.8)`, `(3.0, 3.0, 74.8, 49.8)` | `#7_aero_wedge`: `(82.8, 28.0, 37.3, 24.8)`
  - `#10_skid_1..2`: `(125.1, 28.0, 18.0, 112.3)`, `(149.0, 28.0, 18.0, 112.3)`
  - `#6_rotor_1..3`: `(82.8, 3.0, 68.0, 20.0)`, `(76.0, 145.3, 68.0, 20.0)`, `(3.0, 137.6, 68.0, 20.0)`
- **`Card D` — Smooth `PETG`/`TPU` Shape-Out Flex Skins (`3` items, `159.0 × 102.0 mm` outer, `43.6%` box density):**
  - `#18_cargo_shroud`: `(3.0, 3.0, 112.0, 49.8)` | `#16_aero_cowl`: `(3.0, 57.8, 96.0, 37.3)` | `#17_windscreen`: `(120.0, 3.0, 36.0, 96.0)`

---

## 6. Pre-CAD Sign-Off Checklist (Gate to Pass 5 CAD)

1. Register `socket_small` (`cage` & `holes` documentation), `c_jaw_tu01`, and `flank_rail_tu02` in `parts/partspec/interfaces.json` and extend `selftest.py` brand hygiene scanning across `docs/` with expanded third-party system/vendor patterns.
2. Print and cycle-test the `c_jaw_tu01` (`PLA` & `PETG`) and `Card D` `0.60 mm` `PETG` fold coupons (`F1` / Gate `G7`) before freezing `#1 kit_keel_base`.
3. Author `parts/partspec/toyventor_kitcard.py`, run `toyventor_parts.py`, `preprint_check.py`, and pose-sweep collision checks across all 9 canonical craft recipes, and keep `F1_printed_fit` / `F2_breakage` explicitly `pending` until physical validation completes.
