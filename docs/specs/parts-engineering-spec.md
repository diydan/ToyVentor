# Parts engineering: the one canonical spec

**Status (2026-11-04):** active. This file is the single entry point to the
parts engineering lane. It merges eight documents that used to sit beside each
other in `docs/specs/` with overlapping supersession banners. Every fact that
was still authoritative is carried here; the eight merged documents were
retired with the archive (Appendix A records what each held and where its
live content went).

**Read the sections, not the whole file.** §1–§7 are the engineering canon
(decisions, geometry, laws, gates, physics, electrical safety, capability
matrix). §8–§10 are workstreams that are still proposals or partially built.
§11 is what is physically unproven. §12 is what is waiting on a decision.

| Section | What it holds | Status |
| --- | --- | --- |
| §1 | The stage ladder and Dan's decisions | Decided |
| §2 | The 8-card packing manifest | Live CAD |
| §3 | The four mechanical laws | Live CAD |
| §4 | The 7-gate verification protocol `G1`–`G7` | `G1` automated; `G2`–`G7` bench |
| §5 | `Motion` physics and impulse bounds | Authoritative |
| §6 | `Card F` electrical, battery, thermal and RF safety | Authoritative |
| §7 | Craft × stage capability matrix | Authoritative |
| §8 | "Print what's on screen" workflow | Draft 2, partially built |
| §9 | Asset optimization pipeline | Proposed |
| §10 | Describe & Build and the Kip demo | Built, gaps listed |
| §11 | Physical validation gates (`F1`/`F2`) | Pending |
| §12 | Open decisions | Open |

**Live code beats this file.** The CAD is
[`parts/partspec/toyventor_kitcard.py`](../../parts/partspec/toyventor_kitcard.py),
the checks are [`parts/partspec/verify_band_jet.py`](../../parts/partspec/verify_band_jet.py)
and `toyventor_parts.py`, and the numbers live in
[`parts/partspec/interfaces.json`](../../parts/partspec/interfaces.json) and
[`catalog.json`](../../parts/partspec/catalog.json). The lattice rules are
[`parts-tu-spec.md`](../parts/parts-tu-spec.md) and
[decision 0005](../decisions/0005-partspec-lattice-merge.md); compliance is
[`parts/partspec/COMPLIANCE.md`](../../parts/partspec/COMPLIANCE.md). Where this
file and the code disagree, the code wins and this file is wrong.

**Verification snapshot (2026-11-03, from the working tree):** `8/8` kit-card
plates packed at `>= 5.00 mm` Chebyshev gap, `13/13` `Gate G1` assembly checks
passing, `8/8` (`C1`–`C8`) passing in `verify_band_jet.py`, and all `205` parts
passing the part gate (`toyventor_parts.py`). Physical workbench gates
(`F1_printed_fit`, `F2_breakage`) remain **pending** (§11).

---

## 1. The stage ladder

**Decided (Dan, 2026-11-02): `Snap → Motion → Pro`.** There is no separate
`Mech` stage. The powered module is an optional add-on to `Pro`, graded `10+`.

| Stage | Age | Contents | Cards |
| --- | --- | --- | --- |
| **1 Snap** | `3+` | Static build, no motion. | `A`–`D` |
| **2 Motion** | `8+` | One core in the rear rows 6-9 at a time, fixed axles: **(a)** pull-back band core + slam launcher; **(b)** top-balloon jet + rip-cord turbine. | `E2`, `E3` |
| **3 Pro** | `8+` base / `10+` powered | Rack steering; plus the optional **Pro Powered Add-On** (servo steering, drive motor, brain). | `E1`, `F` |

The two `Motion` cores are alternatives in the same slot, never combined.

**Dropped from the cards** (builders remain in `catalog.json` as un-carded
superseded parts): `mom_wind_key`, `mom_latch_pawl`, `mom_bumper_trigger`,
`mom_bellows_base`, `mom_bellows_leaf`. The bellows that tipped the dump bed
is gone; the balloon is the jet piece with the balloon on top.

**Decided (Dan, 2026-11-02, implementation pass):**

- **Pull-back only**; the key, latch pawl and bumper are dropped. "Key as a
  later upgrade" stays open as an option, not a commitment.
- **`Pro`'s powered module is an optional add-on.** `Pro` = hand-steered rack
  steering (`8+`); the powered module is `10+`.
- **Servo replaces the column and wheel; never both fitted.**
- **Jet body and nozzle:** internal passages enlarged to about `Ø8`, and
  `mom_nozzle_set` redesigned as individual rear-orifice inserts
  (`Ø3.0 / 4.5 / 6.0 / 8.0`).
- **Traction:** `Ø50` is first-class in `Motion` and `Pro`; the O-ring groove
  waits for the friction coupon.
- **Card re-cut accepted:** the `Motion` card gains a `gear_spur_z10`; the
  bellows leaves the cards; the powered module keeps its own plate.
- **One shared tray/lid across cores: deferred** (too large for this pass).

**Still open (see §12):** the balloon cradle (rear stop vs tilt-holder, and
whether it may rest against Kip or is held back about `30°`), and the balloon
size to support (`150`–`225 mm` all work with a `15`–`45°` lean; smaller is
lighter and needs less lean).

**App-facing names** (carried through 2026-11-03): rank 6 is `Power Pro
Inventor` and the vehicle is `Bolt Power Pro`
(`src/lib/progression.ts`, `src/lib/vehicleReadiness.ts`,
`seed/toys/seed-mech.json`). Old names stay as aliases; the internal id
`seed-mech` and the icon variant `mech` are unchanged. The Truck bench's
stage buttons are `1 Snap`, `2a/2b Motion`, `3 Pro`, `3+ Pro Powered Add-On`
(stage ids unchanged). The viewer's stage ids are `snap`, `band`, `bellows`,
`pro` and `mech`.

**Compliance by stage:** `Snap` is `Ages 3+` (`Snap Small`; `Large` under-3
remains parked). `Motion` and `Pro` hand steering are `Ages 8+`
(`interfaces.json:495`, `pro_min_age = 8`) and carry the `16 CFR 1500.19`
small-parts warning plus the uninflated/broken latex balloon warning, an
explicit natural-rubber latex allergy notice (recommending latex-free `EPDM`
or synthetic elastomer `#32`/`#64` bands) and pre-play inspection / worn-band
replacement instructions. The optional `Pro Powered Add-On` is `Ages 10+`,
`PETG` mandatory, with `ASTM F963-23` §4.25 tool-locked rear battery
compartment, an `IEC 62133` protected `1S` LiPo, a pre-certified `FCC Part 15`
intentional radiator module with keep-out compliance, and local-LAN /
zero-PII browser communication. `EN 71` and `IEC 62115` stay out of scope
until an EU launch.

### 1.1 What was superseded, and by what

This table is the authority map. Where the pre-CAD baseline and the shipped
CAD differ, the shipped CAD governs.

| Topic | Superseded pre-CAD entry | Authoritative live CAD |
| --- | --- | --- |
| **Stage ladder** | 4 stages `Snap → Pro → Momentum → Mech`; key-wound `ARMED` band + bumper + bellows | **`Snap (3+) → Motion (8+) → Pro (8+)`**, with `Card F` as the optional **Pro Powered Add-On (`10+`)**; pull-back-only band core; key, latch pawl, bumper and bellows dropped (§1). |
| **World coordinate datum** | Keel-front corner/row notation | Centered `#1 kit_keel_base` world frame (`X_world = 0`, `Y_world = 0` at keel midpoint, `Z_world = 0` bottom, `Z_world = 12.50` deck): `row 0` = `Y_world = -56.25`, `steer_bore` = `(0, -37.50)`, `row 8` = `Y_world = +43.75`, `row 9` = `Y_world = +56.25`, PTO slot = `10.0 × 31.4 mm`. |
| **Dump-bed hinge and flush drive lid** | Open `c_jaw_tu01` cradles on `#1` and all `4×4` core lids (`Y = 124.9`, `Z = 47.0`) | Interleaved enclosed `_bellows_knuckle` barrel hinges (`TUB_TRUNNION_Y = +30.95`, `TUB_TRUNNION_Z = +5.75`, `LID_CRADLE_Z = +10.95`) pinned by `37.5 mm` `shaft_tu03` on `#11` (`49.8 × 61.5 × 18.0`), transom-tenoned `pro_tub_hinge` (`29.4 × 19.5 × 19.4`, world `(+68.45, +18.25)`), `mom_band_core_lid` and `mech_brain_lid` (`49.8 × 61.5 × 16.6`). `mech_drive_lid` (`49.8 × 49.8 × 8.0`) has `0` knuckles so `mech_bat_door_screw` clears above it. |
| **Axle retention** | Open under-keel `c_jaw_tu01` axle jaws + snap-on `pro_axle_keeper` (`Card E1`) | `#1 kit_keel_base` uses closed `360°` `50°`-teardrop `free` horizontal axle through-bores (`rows 0, 7, 8`); **`pro_axle_keeper` is retired**. `Card E1` carries `shaft_tu03` for `pro_tub_hinge`. |
| **Knuckle cheek relief and `Gate G2` lock** | `KNUCKLE_FACE_RELIEF` held at `0`; `G2` table cited `±26.0°` / `56.8 cm` | **`KNUCKLE_FACE_RELIEF = 0.40 mm` active in CAD** (`>= 0.355 mm` keel-nose gap); `_stop_wedge_cs` at `dx = ±5.20 mm` yields **`±33.9°` inner / `±20.8°` outer (`60.6 cm <= 62.0 cm`)** on `#4` `Ø36`, and capped `±25.0°` inner / `±17.2°` outer (`72.0 cm <= 75.0 cm`) on `#5` `Ø50`. |
| **`Motion` band configuration** | Doubled `#64` loop (`44.5 mm`) wound `2.5` turns | **Single `#64` `EPDM` loop (`89 mm`) looped in a V over both front posts at `2.5` turns (`ε_max = 114%`)**, or `2× #32` loops (`ε_max = 132%`). Doubling `#64` hits `ε ≈ 328%` at `2.5` turns and is **capped at `<= 1.25` turns**. |
| **Dropped parts and slam plunger** | `mom_bumper_trigger` `48.0 × 32.8 × 12.5`; `mom_slam_plunger` `76.0 × 18.0 × 5.0` (`35 mm` stroke) | `mom_bumper_trigger` (`48.0 × 42.0 × 12.5 mm`), `mom_wind_key`, `mom_latch_pawl` and `mom_bellows_base/leaf` **dropped from `Cards E2/E3`**; `mom_slam_plunger` **`18.0 × 94.0 × 5.0 mm`** (`12.6 mm` bar, `2.80 mm` walls, `36.4 mm` captive stroke). |
| **Steering servo mount** | `mech_servo_9g` (`2×3×3 TU` box) on `pro_steer_bridge` `2×2` top studs at `Z = 25.00 mm` | `pro_steer_bridge` deck is stud-free (`RACK_Z = 25.20 mm`); `mech_servo_mount` (`48.0 × 19.05 × 32.8 mm`) anchors on **`#1` Row-2 studs `(±6.25, -31.25)`** and clamps a forward (`-Y`) shaft-down **nylon-gear `SG90`** (`0.55 A` stall; `MG90S` excluded by the `1.75 A` PPTC budget) via `mech_servo_lid` + `2× pro_captive_pin_28`. |
| **Motor and servo output couplers** | `mech_dshaft_horn_set` (one combined item with a printed servo horn spline) | **`mech_n20_pinion_z10`** (internal N20 bell + dogbone `Ø3.16` D-bore + `M2.5` set-screw + `Ø6.60` double-shear pilot journal), **`mech_servo_pinion_z10`** (`Ø23.0` rack-keeper flange + pocket for the **stock nylon servo horn** + bottom `Ø7.00` bore), and **`pro_pilot_pin`**. |
| **`2 TU` brain Z-stack** | `4×4×3 TU` (`37.5 mm`, `30.30 mm` clear Z) `mech_brain_mcu` with transverse LiPo | **`4×4×2 TU` (`25.0 mm` = `19.8 mm` tray + `5.2 mm` lid; `14.60 mm` clear Z, `z_local = 5.20..19.80 mm`)** `mech_brain_tray` + `mech_brain_lid` (stacked Drive + Brain = `62.5 mm` = `5 TU`, combined `Z_CG ≈ 44 mm`): lengthwise `602535` LiPo (`z_local = 5.5..11.7`), `1.6 mm` carrier PCB on `z_local = 12.8` ledges (`12.8..14.4`), surface-mounted `XIAO` (`14.5..19.0`, **`0.80 mm` lid gap`), **low-profile right-angle/pad headers off the XIAO footprint**, left `-X` `USB-C` bezel. |
| **Kit-card count (`Motion` and `Pro`)** | `2` plates (`Card E1` `14` items, `Card E2` `10` items) | **`3` plates** (`Card E1` `21` items `160.7 × 159.3`, `Card E2` `10` items `157.2 × 152.1`, `Card E3` `9` items `162.4 × 162.8 mm`), all `<= 164.0 × 164.0 mm` with `>= 5.00 mm` inter-part gaps (§2). |
| **`Pro Powered Add-On` item count** | `9` items (`152.9 × 140.4 mm`) | **`14` physical items** (`11` `W13` SKUs + `2× pro_captive_pin_28` + `1× shaft_tu03`), `163.6 × 154.3 mm <= 164.0 mm`, in `PETG` (§2). |
| **`pro_captive_pin_28` quantity** | Unlisted | **`8×` physical pins across the cards:** `4×` on `Card E1` (`2×` kingpins + `2×` tie-rod pins), `2×` on `Card E2` (`1×` slam stop + **`1×` spare**), `2×` on `Card F` (servo lid clamps). |

**Inheritance rule.** Everything in the archived pre-CAD baseline that is *not*
listed in the table above remains in full force. Specifically, the analytical
conservation-of-momentum and impulse bounds (§5), the `Gate G4` dummy-brick /
catamaran float protocol (§4), and the `Card F` electrical, battery, thermal
and RF safety requirements (§6) are carried here unchanged.

---

## 2. Canonical geometry: the 8-card packing manifest

Every plate is verified by `export_kitcards()` (`min_gap_mm = 5.00 mm`
Chebyshev clearance, `1.80 × 0.60 mm` V-nick sprue gates anchored inside
`z = 0.30 mm` slices, zero gates on gear teeth or tire treads).

| Card | Limit (`mm`) | Material | Verified outer (`mm`) | Items | Complete verified manifest (`CARD_LAYOUTS`) |
| --- | --- | --- | --- | --- | --- |
| **`Card A`** | `170.0` | `PLA/PETG` | `166.8 × 170.0` | `11` | `#1 kit_keel_base`, `#2 kit_clevis_spine`, `2× #3a kit_barbell_shaft`, `2× #3b kit_spinner_pin` (`3rd` on `B`), `4× #4 kit_wheel_med`, `#15 kit_yoke_hbar` |
| **`Card B`** | `170.0` | `PLA/PETG` | **`169.4 × 165.6`** | `9` | Barrel-knuckled **`#11 kit_tilting_tub` (`61.5 × 49.8`)**, `#12 kit_scoop_blade`, `#14 kit_turntable`, `#8 kit_windscreen`, `2× #13 kit_booster_pod`, `#3b kit_spinner_pin`, `2× #5 kit_wheel_giant` |
| **`Card C`** | `170.0` | `PLA/PETG` | `170.0 × 168.3` | `9` | `3× #9 kit_foil_wing`, `#7 kit_aero_wedge`, `2× #10 kit_skid_runner`, `3× #6 kit_rotor_blade` |
| **`Card D`** | `170.0` | `PETG/TPU` | `159.0 × 102.0` | `3` | `#18 skin_cargo_shroud`, `#16 skin_aero_cowl`, `#17 skin_windscreen` |
| **`Card E1`** *(Pro steer)* | `164.0` | `PLA/PETG` | **`160.7 × 159.3`** | `21` | `pro_steer_bridge`, `pro_steer_rack`, `pro_steer_knuckle_l`, `pro_steer_knuckle_r`, **`2× kit_wheel_med_free`**, **`2× kit_wheel_giant_free`**, `2× pro_tie_rod_link`, **`4× pro_captive_pin_28`**, `pro_steer_column`, `pro_steer_wheel`, `pro_tub_hinge`, `pro_fork_rake_adpt`, **`shaft_tu03` (`tub_pin`)**, `2× gear_spur_z10` |
| **`Card E2`** *(Motion (a) band and slam)* | `164.0` | `PLA/PETG` | **`157.2 × 152.1`** | `10` | `mom_band_core_tray`, `mom_band_core_lid`, `mom_pto_gear_z10`, `mom_band_spool_pawl`, `shaft_tu03` (`pto_shaft`), `gear_spur_z10` (axle), `mom_slam_base`, `mom_slam_plunger`, **`2× pro_captive_pin_28`** |
| **`Card E3`** *(Motion (b) air and turbine)* | `164.0` | `PLA/PETG` | **`162.4 × 162.8`** | `9` | `mom_ripcord_rack_150`, `mom_spindle_shaft`, `gear_spur_z10`, `mom_flywheel_rotor`, `mom_flywheel_tray`, `mom_flywheel_lid`, `mom_jet_valve_body`, `mom_jet_slide_valve`, `mom_nozzle_set` (4 individual inserts on sprue) |
| **`Card F`** *(Pro Powered Add-On)* | `164.0` | **`PETG`** | **`163.6 × 154.3`** | **`14`** | `mech_drive_tray`, `mech_drive_lid`, `mech_n20_pinion_z10`, `mech_brain_tray`, `mech_brain_lid`, `mech_bat_door_screw`, `mech_servo_mount`, `mech_servo_lid`, `mech_servo_pinion_z10`, `pro_pilot_pin`, `mech_sill_duct`, **`2× pro_captive_pin_28`**, **`shaft_tu03` (`tub_pin_f`)** |

**`180 × 180 mm` bed, brim and skirt margins.**

- **`Cards A, B, C` (`169.4..170.0 mm` max axis):** leave `5.0..5.3 mm`/side to a
  `180.0 mm` bed edge — **disable the outer skirt or move the prime line off
  the `170.0 mm` axis when using a `5.0 mm` brim** (`170.0 + 2×5.0 = 180.0 mm`
  exact), or cap the outer brim at **`<= 3.0 mm`** (`176.0 mm`) when a slicer
  skirt loop is enabled (`8.0 mm` brim overflows `180 mm` on `A–C`).
- **`Cards D, E1, E2, E3, F` (`<= 163.6 mm` max axis):** accommodate `3.0 mm`
  and `5.0 mm` brims with skirt room (`<= 173.6 mm`), and up to an `8.0 mm`
  brim (`179.6 mm <= 180.0 mm`) with the skirt disabled.

### 2.1 Notation and coordinate datums

- **Coordinate frames:** `z_local` = part build frame (`z_local = 0` on the
  part's base before `print_rotation_deg`); `z_tray` = height above a Power Core
  tray's underside (`Z_world = z_tray + 12.50 mm` when seated on `#1`, or
  `z_tray + 50.00 mm` for a stacked `mech_brain_tray`); `X_world`, `Y_world`,
  `Z_world` = assembled craft frame centered on `#1 kit_keel_base`.
- **Gate names:** `G1..G5`, `P1..P4`, `I1..I7`, `T1..T2`, `S1` in Law M4 are the
  `preprint_check` / `interfaces.json` part checks (`G5` = fits bed).
  **`13/13 Gate G1`** (`G1-Steer`, `G1-Motion`, `G1-AddOn`; the result key is
  `3b_motion_packs_and_jet_seal`) are the 3D assembly boolean checks in
  `toyventor_kitcard.verify_gate_g1()`, supplemented by **`C1..C8`** in
  `verify_band_jet.py`. `G2..G7` in §4 are the physical bench gates.

---

## 3. The four mechanical laws

1. **Law M1 — Positive bi-directional axial captivity (`±Z` / `±X`):** zero
   friction- or gravity-retained pins. Every rotary joint uses a headed pin
   that **turns freely (`PIN_FREE`) inside the moving `Ø7.00 mm` `free` bore**,
   seats for anti-rotation (`0.05 mm`/side nominal clearance; subject to
   `F1_printed_fit` printer-to-printer coupon verification) in the stationary
   `5.10 mm` `fixed` double-D bore where applicable, **and locks axially in the
   opposite direction via an explicit compliant split-cantilever snap-barb
   (`Ø7.60 mm` over a counterbored shoulder, `0.00%` seated strain)** with an
   open rear mouth (`>= Ø3.5 mm`) so pinching or pushing the distal tines
   releases the pin cleanly for disassembly. *(Rear solid axles `#3a` run
   through `#1`'s closed `360°` `free` bores and rely on `5.25 mm` `fixed`
   wheel-hub grip for lateral retention, checked empirically in `Gate G3`.)*
2. **Law M2 — Short shear spans and double-shear motor/servo support:** tall
   knuckle towers minimize single-shear tie-rod bending, and both motorized
   `Card F` outputs (`N20` `Ø3.0 mm` D-shaft and `9g` `SG90` output) are
   supported on their distal side by a `Ø6.60 / Ø7.00 mm` `Pro` pilot journal
   so gear separating forces never bend COTS shafts or strip teeth.
3. **Law M3 — Complete operating-state and 3D fluid closure:**
   - Stored-energy drivetrains must close every active operating state: for the
     pull-back Band Core (no `ARMED` latch), **(1) pull-back wind**, **(2) forward
     drive/release**, and **(3) overrun/freewheel coast** (`C1` chirality, `C2`
     `0.78 mm` pawl bite and `C3` closed-saddle shaft capture all PASS).
   - Pneumatic assemblies must pass both **`_pneumatic_jet_check`** (`OPEN`
     cavity connectivity, `CLOSED` `360°` topological disconnection, `100%` wall
     isolation from bottom `socket_small` holes, and outer socket fit) **and
     `verify_band_jet.py` `C4/C5`** (unobstructed insert bores + `>= 1.30×`
     series-orifice thrust/drag, both PASS: best `9.4 gf = 1.38×`), followed by
     physical bench leak verification (§11).
4. **Law M4 — Zero FDM micro-splines and support-free `0.4 mm` geometry:**
   never print `21T` micro-servo splines on a `0.4 mm` FDM nozzle. Capture the
   servo's factory-molded nylon horn inside a precision pocket secured by the
   stock `M2` center screw. Every part passes `G1..G5`, `P1..P4`, `I1..I7`,
   `T1..T2`, and `S1` (`non-marginal`).

---

## 4. The 7-gate verification protocol

| Gate | Stage executed | Exact test and fixtures | Quantitative pass criterion |
| --- | --- | --- | --- |
| **`G1` — CAD keep-out, sweep and Kip ghost audit** | Pre-CAD / Phase 1 | Boolean collision audit across all 9 craft (`13/13` checks in `toyventor_kitcard.verify_gate_g1()`, supplemented by `C1..C8` in `verify_band_jet.py`) with datasheet-true solids: live `ghost_kip_seated` (**`48.20×41.11×80.60 mm` above seat**, `Z_world = 12.50..93.10 mm` + `hair_pigtails` `95.50 mm` / `hair_mohawk` `99.50 mm`; tall hats excluded on rotorcraft), `ghost_xiao` (`21×17.8×4.5 mm`), `ghost_pcb` (`38×38×1.6 mm`), `ghost_lipo` (`25×35×6.2 mm`), `ghost_n20` (`12×10×24 mm`), `ghost_sg90` (in Row-2 `mech_servo_mount`), `USB-C` plug corridor, and `12×10 mm` RF antenna keep-out. | **`0.000 mm³`** overlap across static and extreme kinematic poses (`±33.9°` inner / `±20.8°` outer `Ø36`, `±25.0°` inner / `±17.2°` outer `Ø50`, `0°..55°` barrel-hinge dump sweep, `360°` slew, prop/rotor spin, `-X` clutch lock and `<= 0.50 mm` saddle lift; `C1..C8` all PASS as of 2026-11-03). |
| **`G2` — Physical `Pro` rack steering proof** | Phase 1-2 (`Card E1`) | Printed `pro_steer_bridge`, `15.0 mm`-scrub bellcrank knuckles (`KNUCKLE_FACE_RELIEF = 0.40 mm`), `pro_tie_rod_link`, and `36.0 mm` `pro_steer_rack` (`dx = ±5.20 mm` stop) on `#1` `row 0`, hand-driven via `pro_steer_column` + `pro_steer_wheel`. | Smooth lock-to-lock travel: **`>= ±25°` physical inner-wheel lock** (`60.6 cm <= 62.0 cm` wall-to-wall circle) on `#4` `Ø36` and **`>= ±20°` physical inner-wheel lock** (`72.0 cm <= 75.0 cm` circle) on `#5` `Ø50`, with **`>= 1.80 mm`** tire-to-hull/bridge/rack clearance and `>= 0.355 mm` knuckle-to-keel cheek gap. |
| **`G3` — `Motion` impulse, traction and torque proof** | Phase 1-2 (`Cards E2-E3`) | Bench load-cell / stopwatch log on `mom_jet_valve_body`, `mom_flywheel_tray`, and the pull-back single-`#64` V-loop / `2×#32` Band Core driving `row 8` `gear_spur_z10` inside `#1`'s closed `360°` axle bores. | Zero tooth skip or lateral axle walk across `50` launches at **`65-80 N·mm`** burst torque (`<= 8 N` pull-back tire-press target); measured balloon impulse `0.28-0.48 N·s` (**`>= 1.30×` thrust/drag** on hard floor, **`<= 15%` diameter loss over `15 s` hold**). |
| **`G4` — Matched-CG sealed dummy brick and sponson float** | Phase 1-2 | Sealed printed `5 TU` (`3 TU` Drive + `2 TU` Brain) dummy stack weighted with internal sand/steel shot to **`115-125 g`** at the shipped `Card F` CG (`Z_world ≈ 44 mm`, `z_stack ≈ 31.5 mm` above `#1` deck; **zero loose coins**), tested on all 9 craft + water tank with `2× Ø60×125 mm` foam-noodle sponsons. | Axles spin freely (`< 0.5 mm` sag); weighed Dump Truck and Tractor validate static tip-over margins (`>= 1.4×` rated scoop/bed load); Catamaran floats at **`<= 55%` draft** (`>= 25 mm` freeboard) and stays upright at `20°` heel. |
| **`G5` — Thermal soak and stall cutoff gate** | Phase 2-3 (`Card F` `PETG`) | `Card F` printed in **`PETG`** (`HDT ~70 °C`), loaded with `1×` (`0.60 A` chop) N20 gearmotor + `1×` (`0.55 A` stall) nylon-gear **`SG90`** servo (`MG90S` excluded) + **`2.50 A` (`25 °C`) PPTC** (`~1.75-1.83 A` derated hold at `55 °C`) under `15 min` locked-rotor + servo stall cycle at `25 °C` ambient. | Exterior touch temperature **`< 45 °C`**; internal motor-mount boss **`< 55 °C`** (`0` softening on adjacent `PLA` keel); zero PPTC nuisance trips at `55 °C` internal ambient (`1.47 A < 1.75 A`) and zero MCU brown-out resets. |
| **`G6` — `1.0 m` drop and `F2` fragment re-screen** | Phase 1-3 | Assembled craft (`Snap`, `Motion`, and `115-125 g`-loaded `Pro Powered Add-On`) dropped `5×` from `1.0 m` onto vinyl-over-concrete (`ASTM F963-23` §8.7 reference protocol). | **Stage 1 (`Cards A-D`) standalone parts:** zero detached/fractured piece fits the `Ø31.75 × 57.1 mm` `S1` cylinder. **Stages 2-4 (`8+`/`10+`):** zero fracture into sharp points/edges (`16 CFR 1500.48/49`), zero rotor/band shroud breach, zero tool-locked battery-door opening. |
| **`G7` — `500`-cycle and `40 °C` creep endurance** | Phase 1 (`F1` coupon) | `pro_captive_pin_28` snap-barb coupon, `Card D` `0.80/0.60 mm` `PETG` fold coupon, and armed Stage-3 ratchet/flexure coupon (`24 h @ 40 °C`). | `pro_captive_pin_28` retains **`>= 10.0 N`** pull-out after `20` release cycles + `24 h @ 40 °C`; `Card D` shows `0` cracks after `500` folds; ratchet holds `24 h @ 40 °C` without slip. |

---

## 5. `Motion` physics and impulse bounds (authoritative)

All performance figures below are **analytical** conservation-of-momentum /
energy bounds (`110 g` reference craft at `C_rr = 0.045` -> **`4.95 gf`
(`0.0485 N`) hard-floor rolling drag**). Prototype bench logs in `Gate G3`
govern the final catalog copy.

| Module | Card | Stored-energy mechanism | Analytical physics bound | Child-safety controls (`8+`) |
| --- | --- | --- | --- | --- |
| **`mom_pullback_band`** | `E2` | **Pull-back-only: single `#64` `EPDM` loop in V (`89 mm`, `ε_max = 114%` @ `2.5` turns) or `2× #32` loops (`ε_max = 132%`)** anchored across front `R = 4.0 mm` posts `(±16.0, -16.0 mm)` onto mirrored `Ø12.8 mm` `mom_band_spool_pawl` (`20.3 × 20.3 × 13.0`, printable `R7.2` retaining lip; `C1/C2/C3` PASS, `0.78 mm` bite) driving `Card E2`'s own `row 8` `gear_spur_z10` (`1:1`). | Stored elastic energy **`0.22-0.38 J`**; initial axle torque **`35-65 N·mm`**; assuming **`~45%` spool/gear drivetrain efficiency** (vs. `4.5-7.8 m` frictionless ideal against `0.0485 N` drag), hard-floor run is **`2.0-3.5 m`** with freewheel coast (`~0.8-1.2 m` if `0.12 N` `Ø36` / `0.084 N` `Ø50` overrun drag acts throughout coast; bench test decides). | Band 100% enclosed inside the Core (`0` exposed snap path; `0` sustained `ARMED` creep load); **latex-allergy notice (recommend latex-free `EPDM` bands) + inspect/replace every `~50-100` cycles**. |
| **`mom_bumper_trigger`** *(dropped)* | *(un-carded)* | Compliant parallelogram (`48.0 × 42.0 × 12.5 mm`) front bumper — **dropped from `Card E2` (`2026-11-02`)** with the pull-back-only decision (unbridged `45 mm` pushrod gap, shared nose slot with `pro_steer_bridge`, blocked `Ø50` tires; builder retained as a superseded catalog part). | Historical target: `>= 1.5 N` obstacle contact threshold (`4.2 mm` flexure stroke). | Finger-safe pinch stops (`< 4 mm` or `>= 12 mm` at `55°` dump stop). |
| **`mom_slam_launcher`** | `E2` | Stationary tabletop `mom_slam_base` (`62.3 × 38.0 × 21.0 mm`) + **captive** `36.4 mm`-stroke `mom_slam_plunger` (`18.0 × 94.0 × 5.0 mm`) impacting `#1`'s rear cross-tie. | Transfers **`0.15-0.25 J`** (`v_0 ≈ 1.6-2.1 m/s` on `100 g` craft -> `2.5-4.0 m` dash) with zero onboard engine mass. | **Plunger is non-detachable (captive `pro_captive_pin_28` stop pin)** + flat cup-free nose + mandatory **no-loose-objects-ahead-of-plunger** instruction (`ASTM F963-23` §4.9 check pending); kinetic energy `< 0.25 J`. |
| **`mom_jet_valve`** | `E3` | Upright-printed smooth balloon collar + `3.5°` tapered shutoff spool + `4` individual breakaway rear-orifice inserts (`Ø3.0 / Ø4.5 / Ø6.0 / Ø8.0` design, `63.0 × 14.1 × 8.2 mm`). *(Jet mode omits `row 8` `gear_spur_z10` due to `442 mm³` overlap, `C6` PASS. `C4` PASS (unblocked inserts, measured rear orifices `Ø3.2 / 4.6 / 6.1 / 8.0`) and `C5` PASS (series thrust `1.38×` drag).)* | `9"-11"` balloon (`4-6 L` air, `ΔP ≈ 2-3 kPa`) carries **`0.28-0.48 N·s` total impulse**: <br>• **Ideal unconstrained nozzle (`2.5 kPa`):** `Ø3.0` `2.5-4.5 gf` (`0.53×` @ `~150 g`), `Ø4.5` `4.5-8.0 gf` (`1.20×`), `Ø6.0` `8.0-14.0 gf` (`2.13×`), `Ø8.0` `3.80×` (`+52 g` w/ `4× Ø50`). <br>• **Series-orifice reality (governs):** pre-pass `~Ø5 mm` STLs (`19.6 / 20.4 / 20.6 mm²`) cap thrust at `~4.9 gf <= 0.74×` drag (`0` motion). The current CAD (inlet `50.1`, valve port `38.1`, tunnel `52.6 mm²`, narrowest `Ø6.96`) gives `3.9 / 7.2 / 9.3 / 9.4 gf` for the `Ø3.2 / 4.6 / 6.1 / 8.0` inserts, **best `9.4 gf = 1.38×` drag at `150 g`, above the agreed `>= 1.30×` pass rule (`C5` PASS)**; the valve port caps thrust at `ΔP · a1 = 9.7 gf`, so `Ø8.0` adds almost nothing over `Ø6.1`. An upright `>= Ø125 mm` balloon softly rubs Kip's back, trails `15-45°` clear under drag, and enters the `+Y` jet stream past `~45-50°`. | **Printed mouthpiece deleted** (hygiene + small-part risk; inflate by hand pump); carries a mandatory **`16 CFR 1500.19(b)(2)` latex balloon warning** + `S1` small-parts warning for snapped-apart nozzle inserts (`8+`). |
| **`mom_bellows_hinge`** *(dropped)* | *(un-carded)* | `4×4 TU` interleaved barrel-hinged clamshell (`shaft_tu03` pin) under `#11` Tub — **dropped from `Card E3` (`2026-11-02`)** in the `Snap → Motion → Pro` ladder in favor of the top-balloon jet; builders retained as superseded catalog parts. | Historical bound: effective patch `~12.5 cm²` at `1.5-3.0 kPa` -> **`190-380 gf` (`1.9-3.7 N`)** normal force (`100-120 g` `#11` payload). | Low-pressure air (`<= 3 kPa`, zero liquid/syringes); `12 mm` minimum finger-clearance stops on the clamshell hinge. |
| **`mom_flywheel_core`** | `E3` | **Vertical-spindle (`Z`-axis)** `150.0 mm` `LAY_FLAT` toothed rip-cord rack meshing **directly (`1:1`) with `gear_spur_z10` (`Ø30.0 × 6.25 mm`)** on a dedicated `78.0 mm` `mom_spindle_shaft` driving a **1-piece `100%`-infill `PLA` rotor (`Ø42.0 × 12.0 mm`, `20.0 g`)** inside `mom_flywheel_tray` (`21.8 mm` clear Z above the `z = 10.5 mm` step pedestal); the rack pulls free on exit for coast, and `mom_flywheel_lid` (`Z_world = 50.0 mm`) sets Helicopter rotor height at **`Z_world = 103.75..115.75 mm`**. | `I = ½ m (R² + r_i²) = 4.54 × 10⁻⁶ kg·m²`; `150 mm` stroke on a `Ø25.0 mm` pitch circle = **`1.91` turns**. A hand pull at `1.5-2.2 m/s` gives **`1,146-1,681 RPM`** (`v_tip = 2.52-3.70 m/s`, **`E_rot = 0.033-0.070 J`**) to spin Helicopter `2× #6` rotors (`4-8 s` coast) or audible Shuttle/Trike reaction-wheel play (**not geared to road wheels; zero gyro-balance claim**). | **Zero loose coins**; the `Ø42 mm` rotor (`S1` `+32.3%` `above_cylinder`) is 100% enclosed inside a pin-locked `2.0 mm` `4×4×3 TU` shroud (`< 3.0 mm` vent slots); overhead zip-lines prohibited. |

### 5.1 `Pro` rack steering clearances (shipped CAD)

`pro_steer_bridge` (`48.4 × 31.8 × 23.15 mm` shipped BBox; stud-free deck with
`_stop_wedge_cs` travel stops) anchors on `#1` `rows 0..1` nose studs with
kingpin bosses at `(X = ±18.75 mm, Y_world = -56.25 mm)`.
`pro_steer_knuckle_l` / `_r` (`25.6 × 25.6 × 27.1 mm`) give an exact **`15.00 mm`
(`1.20 TU`) kingpin-to-wheel-center scrub offset** (`W_track = 67.50 mm`, outer
width `79.80 mm` matching the rear `78.00 mm` `#3a` within `0.90 mm`/side).
**Resolved cheek clearance (`KNUCKLE_FACE_RELIEF = 0.40 mm` active at
`toyventor_kitcard.py:1008`):** `0.40 mm` is shaved off the inboard print-bed
cheek face (`z_bore = 5.85 mm`), holding **`>= 0.355 mm` keel-nose clearance**
across the full `dx = ±5.20 mm` rack sweep while passing `preprint_check.py`.
`pro_steer_rack` (**`36.0 × 15.1 × 6.25 mm`**, `|X| <= 18.0 mm` neutral,
`±5.20 mm` travel enforced by `_stop_wedge_cs` -> `|X| <= 23.20 mm` at full
lock, tie-rod `free` bores at `(±7.8125, -1.5625 mm)`) meshes directly with
`gear_spur_z10` (`r_pitch = 12.50 mm`) on `pro_steer_column` at `(0.0, -37.50 mm)`
in `Pro`, and with the coaxial `mech_servo_pinion_z10` in the `Pro Powered Add-On`.

Verified 3D boolean (`0.000 mm³` overlap) and surface clearances, with
Ackermann turning circles (`L = 100.0 mm`, `scrub = 15.00 mm`):

- `#4` (`Ø36.0 × 12.3 mm`) at **`±33.9°` inner / `±20.8°` outer lock**
  (`5.20 mm` rack stop; angles solved from the rigid tie-rod linkage, not
  assumed): measured wheel clearance **`+4.43 mm` keel**, **`+3.55 mm` bridge**,
  **`+3.12 mm` rack** (first wheel contact at `~6.4 mm` of rack travel) ->
  **`59.3 cm` wheel-center** / **`60.6 cm` wall-to-wall circle**
  (`Gate G2 <= 62.0 cm`).
- `#5` (`Ø50.0 × 12.3 mm`) at **`±25.0°` inner / `±17.2°` outer lock**
  (`dx = ±4.23 mm`, capped: keel clearance is `1.81 mm` at `26°` and `1.67 mm`
  at the `5.20 mm` stop): measured **`+2.13 mm` (`>= 1.80 mm`) keel**,
  **`+3.55 mm` bridge**, **`+3.17 mm` rack** -> **`70.7 cm` wheel-center** /
  **`72.0 cm` wall-to-wall circle** (`Gate G2 <= 75.0 cm`).
- `mom_bumper_trigger` (`48.0 × 42.0 × 12.5 mm` shipped BBox): the `48.0 mm`
  bar fits between `#4` `Ø36` front tires (`53.4 mm` apart); **not** valid with
  `#5` (`Ø50` tire front extends `12.6 mm` further forward), and it shares the
  nose slot with `pro_steer_bridge`.
- **Motorbike steerable raked fork (`pro_fork_rake_adpt`, `27.8 × 24.8 × 12.5 mm`):**
  snaps into `#2`'s front vertical `headtube` bore (`(0, -12.5 mm)`), offsetting
  the front fork axis with **`+6.0 mm` positive mechanical trail** so pushed
  bikes and powered Cargo Trikes self-center cleanly.

---

## 6. `Pro Powered Add-On`: electrical, battery, thermal and RF safety (authoritative)

> **Packaging note.** The shipped CAD replaced the pre-CAD `4×4×3 TU`
> (`30.30 mm` clear Z) `mech_brain_mcu` and bridge-top `mech_servo_9g` with the
> **`4×4×2 TU` (`14.60 mm` clear Z) `mech_brain_tray` + `mech_brain_lid`**
> (`z_local = 5.5..11.7` LiPo, `12.8..14.4` PCB, `14.5..19.0` surface-mounted
> XIAO, `0.80 mm` lid gap; right-angle/pad headers off the XIAO footprint) and
> **Row-2 `mech_servo_mount`**. **All battery chemistry, PCM, PPTC
> thermal-derating, current-budget and RF keep-out rules below remain in full
> force.**

1. **Battery, charger, carrier safety and thermal-derated current budget
   (`mech_brain_tray`, `PETG`).**
   - **Rear-door protected `1S` LiPo (`100%` intact bottom sockets):** protected
     **`3.7 V` nominal / `4.20 V` charge** `602535` LiPo pouch
     (`25.0 × 35.0 × 6.2 mm` lengthwise, `600 mAh`, `>= 3.0C = 1.80 A` integrated
     overcharge/overdischarge/short-circuit PCM, `IEC 62133` cell) closed aft by
     `mech_bat_door_screw` (`33.6 × 10.6 × 5.8 mm`, **captive `M2.5` screw per
     `ASTM F963-23` §4.25**). *Chemistry lock:* `4.20 V` single-cell LiPo matches
     standard `4.20 V` linear USB-C charge ICs; **`3.2 V` `LiFePO4` cells are
     strictly prohibited on `4.2 V` charge pads.** (Any future off-board
     `3×AAA NiMH` auxiliary pack must enter via a diode-OR keyed `2.0 mm`-pitch
     port that bypasses the `4.2 V` LiPo charger.)
   - **Carrier PCBA (`mech_carrier_pcb_38x38`, `38.0 × 38.0 × 1.6 mm` on
     `z_local = 12.80 mm` ledges):** surface-mounts a `21.0 × 17.8 × 4.5 mm`
     pre-certified Wi-Fi/BLE MCU stamp (`USB-C` through left `-X` bezel),
     H-bridge IC with **`0.60 A` current-sense chopping**, low-profile
     right-angle / side-entry servo and motor connectors outside the XIAO
     footprint, and a **`12.0 × 10.0 mm` copper-free RF antenna keep-out** under
     the top-front `PETG` wall/lid.
   - **Thermal-derated `1×` current budget (`2.50 A` @ `25 °C` resettable PPTC,
     locked to nylon-gear `SG90`):** a dedicated `500 mA` low-dropout `3.3 V`
     logic regulator + `470 µF` holdup rail isolates MCU Wi-Fi peaks (`0.32 A`)
     from actuator droop; raw `V_bat` (`3.7 V`) feeds the H-bridge and servo
     rail through a **`2.50 A` hold (`25 °C`) resettable PPTC** (`~1.75-1.83 A`
     derated hold at `50-55 °C` internal enclosure ambient during `Gate G5` soak,
     matching the `3.0C = 1.80 A` cell PCM ceiling):
     - **`1×` drive (`0.60 A` chop) + `1×` clamped nylon-gear `SG90` servo
       (`0.55 A` stall) + Wi-Fi TX peak (`0.32 A`):** **`1.47 A` (`2.45C`)**,
       strictly below **`1.75 A` (`55 °C` derated PPTC hold)** and **`1.80 A`
       (`3.0C` cell PCM)**. *Metal-gear `MG90S` servos draw `~1.0-1.2 A` at
       stall -> `~1.92-2.12 A` total and are **excluded** unless paired with a
       higher-rate cell and re-rated PPTC.*
2. **`mech_drive_tray` (`4×4×3 TU`):** houses one transverse `12 × 10 × 24 mm`
   N20 micro metal gearmotor (`6 V` class run at `3.7 V`, `200-300 RPM`,
   `0.60 A` H-bridge chop) driving centered double-shear
   `mech_n20_pinion_z10` through `#1`'s **`10.0 × 31.4 mm`** PTO through-slot at
   `Z_pto = 31.25 mm` (`+0.75 mm` clearance under `mech_drive_lid`'s `2.20 mm`
   PTO dome). (`mech_drive_2x` split-axle skid-steer remains excluded.)
3. **`mech_servo_mount` + `mech_sill_duct` (`49.8 × 37.3 × 11.6 mm`):** the
   shipped CAD replaces bridge-top `mech_servo_9g` with the Row-2
   `mech_servo_mount` + `mech_servo_lid` clamping a forward (`-Y`) shaft-down
   `SG90` driving `mech_servo_pinion_z10` over the under-keel `pro_pilot_pin`.
   `mech_sill_duct` snaps onto `rows 3..5` outer gunwale studs (`cols 0, 3`) with
   `6.0 × 5.0 mm` open-top wire troughs above its `4.70 mm` socket ceiling
   (`Z_world = 17.20 .. 23.50 mm`), leaving Kip's `rows 4..5` `2×2` studs and
   `25.20 mm` leg corridor unobstructed.

### 6.1 Browser connectivity decision

Primary browser control is specified as **local Wi-Fi SoftAP / LAN mDNS +
WebSocket (`ws://`)** so iOS Safari, iPadOS, Android Chrome and desktop
browsers connect without app installation or cloud PII. `WebBluetooth`
(`navigator.bluetooth`) is scoped only as an **optional secondary transport on
Android/Desktop Chromium** (unsupported in iOS Safari). **No `Pro Powered
Add-On` firmware has been built yet.**

### 6.2 Honest marine, air and land physics in the `Pro Powered Add-On`

- **Catamaran airboat:** `2× Ø60 × 125 mm` closed-cell foam-noodle sponsons
  (`~424 gf` net buoyancy at `60%` draft vs. `~255 g` total Add-On boat mass),
  above-water stern air-fan (`#6` inside a `Ø76 mm` finger-safe duct) + servo
  air-rudder (`zero` submerged shaft seals), with `mech_brain_tray` elevated on a
  `1 TU` splash riser (`>= 38 mm` above the waterline).
- **Aeroplane and Helicopter:** strictly **ground-taxiing + motorized
  rotor/winch/light action** (`~240 g` printed FDM + battery mass cannot fly;
  **zero flight claims**).

---

## 7. Craft × stage capability matrix

Stage-4 entries marked **[Aspirational expansion]** require an auxiliary servo,
contact sensor or trailer pack beyond `Card F` v1's single-N20 + single-`SG90`
hardware lock.

| Craft | Stage 1: `Snap` (`3+`, Cards `A-D`) | Stage 2: `Pro` (`8+`, Card `E1`) | Stage 3: `Motion` (`8+`, Cards `E2-E3`, `0` electronics) | Stage 4: `Pro Powered Add-On` (`10+`, Card `F` `PETG`) |
| --- | --- | --- | --- | --- |
| **1. Race Car** | Push roadster + `#7` top-bore yoke (`#15`), `#9` GT wing, `PETG` `#16` cowl | `row 0` rack steer (`±33.9°` inner / `60.6 cm` circle on `Ø36`) + rear `Z10` | Single-`#64` V-loop / `2×#32` band sprinter, `Ø6.0` balloon jet, or `mom_slam_base` | Wi-Fi RC racer (`1×` rear N20 + Row-2 `mech_servo_mount` `SG90`) |
| **2. Dump Truck** | `4×4` `#11` `55°` tipper + `#14` `360°` crane | Barrel-hinged `#11` (`pro_tub_hinge`) + `row 0` rack steer (`60.6 cm`) | `10°` balloon-bellows tipper (`100-120 g` load) or Band Core hauler | Wi-Fi RC steered dump hauler (`#11` manual `55°` barrel tip on `mech_brain_lid`; autonomous bump-and-dump / motorized bed servo = `[Aspirational expansion]`) |
| **3. Tractor** | `4.01°`-rake `#4/#5` tractor + front C-jaw `#2/#12` loader (`<= 75 g` unpowered) | `row 0` rack steer (`±25.0°` inner / `72.0 cm` w/ `#5`) + rear `25.00 mm` PTO | Single-`#64` V-loop / `2×#32` band climber + manual `#12` loader (`<= 150 g` w/ Core ballast) | Wi-Fi RC steered `#5` tractor (`1×` rear N20 + Row-2 `SG90`; powered front loader servo = `[Aspirational expansion]`) |
| **4. Trailer** | Fifth-wheel (`#14` + `28 mm` `#3b`) towed flatbed / tipper / `#9` ramp hauler | Geared `360°` slewing crane trailer | `10°` balloon-bellows tipper | Towed behind RC truck (`3×AAA NiMH` auxiliary power car + hitch-cabled tipper servo = `[Aspirational expansion]`) |
| **5. Bike / Trike** | Double-cheek `#3b` kickstand inline bike **and** self-standing 3-wheel Cargo Trike (`Card A`) | `15°` raked `+6 mm`-trail steerable fork (`pro_fork_rake_adpt`) | Captive `mom_slam_base` dash, `Ø6.0` balloon jet, or vertical turbine Trike pod | Motorized Cargo Trike (`1×` rear N20; raked-fork handlebar servo adapter = `[Aspirational expansion]`) |
| **6. Aeroplane** | Swoosh plane + free-spin `Ø68` nose prop (`+16.81 mm` level / `+17.75 mm` tail-dragger clear) | Axle-driven taxiing nose prop | Single-`#64` V-loop band taxiing prop plane or balloon reaction jet | Wi-Fi RC ground-taxiing plane with steerable front gear (non-flying) |
| **7. Catamaran** | Tabletop dry-play ski catamaran (`2× #10` runners + `#7` top-bore helm) | Hand-cranked `#5` paddlewheels or stern air-prop | Foam-noodle waterborne balloon air-jet boat (`~424 gf` net buoyancy at `60%` draft) | Foam-noodle Wi-Fi RC airboat concept (`[Aspirational expansion]`: stern fan duct + air-rudder mount) |
| **8. Helicopter** | Skids + `10`-stud `#14`/`#7` `Z_world=103.75 mm` 4-blade main rotor (`+10.65 mm` over Kip) + `+10°` tail rotor | Coupled main + tail rotor gear train | Enclosed `1:1` `Z10` rip-cord `Ø42 mm` turbine spin-up (`1,146-1,681 RPM`, `4-8 s` coast, `Z_world=103.75 mm`) | Motorized rotor ground ship / rescue hoist (`[Aspirational expansion]`, non-flying) |
| **9. Space Shuttle** | Orbiter + `PETG` `#18` `Book-Fold` payload doors | Geared satellite deployment arm | Captive `mom_slam_base` runway launch | Wi-Fi ground orbiter (`[Aspirational expansion]`: programmed bay-door and arm servos) |

---

## 8. "Print what's on screen" (Kip print workflow)

**Status:** Draft 2 for review (Pass 1 engineering specification, revised
2026-11-01). Phase 2 of the print view landed on the working tree; the
surrounding workflow is a proposal with named gates.

**Core goal:** turn whatever character, outfit, face expression/selfie,
accessory, prop or vehicle is currently on screen in `Kip-Demo.html` into a
complete, deterministic physical build package.

**Scope decisions already taken.**

- **Drop baked STL supports.** Use slicer tree/soluble metadata and show-face
  blockers instead of shipping support geometry inside the STLs.
- **Vehicle on screen: include by default**, on its own plates, with an
  `Include vehicle` toggle and the added grams shown. Every vehicle part is a
  catalog part that passes validation, so vehicles are the best kit-card
  candidates.
- **3D paint stencils: opt-in, default off, prototype first.** The drafted
  design could not print support-free; the replacement (planar face, conformal
  cavity) is unproven.
- **Sculpted-face sticker: emit the split kiss-cut set only.** The nose is
  `2.6 × 7.9 mm` on a `12.2 mm` window, so a one-piece sticker tears.
- **Default multi-colour mode:** `auto` (the hybrid plan) is the default;
  `split-plates` is the universal fallback; `by-layer` is opt-in; `by-object` is
  **not** the default (it needs hulls at least `68 mm` apart on X1/P1-class
  Bambu machines, and an undressed Kip's skin group is already `11,100 mm²`).
- **Default layout at first release: `loose`** until the kit-card layout passes
  its gate.

**Milestones and their gates.**

| Milestone | Delivers | Gate (all must pass) |
| --- | --- | --- |
| **M1. Honest BOM and colour plates, any printer** | Extended print state, shared `resolveBodyColors`, catalog-resolved files, retained custom STL bytes, `PrinterProfile` and presets, `split-plates`, spool budget, per-plate 3MF and STL, Orca/Bambu project 3MF, the print pack and README, the Print group controls, the one-line `v_groove_ring` fix, and the viewer bugs of the baseline audit. | An exhaustive sweep of **every value of every menu option** gives zero unmapped entries except explicit custom and photo items, and every BOM file exists on disk; resolved colours equal painted colours on every preset (e2e); peg and turret counts equal the visible slots on all 13 heads in both editions; **each generated 3MF is opened in real Orca, Bambu Studio and PrusaSlicer**; three reference builds are sliced with the PrusaSlicer CLI and the spool-budget error is recorded; privacy greps and the build and brand-scan lists stay green. |
| **M2. Sticker sheet** | Per-row/per-column unroll, mouth-ridge and nose reliefs, split sculpted set, shirt chest sticker, selfie squircle, cut SVG and DXF, PDF with scale bar, transparent PNG. | The `50.00 mm` bar measures `50.00 ± 0.02 mm` in the PDF; unrolled sizes match the measured arc-length ratios within `0.3%`; the SVG has no `image`, `clipPath`, `text` or pattern elements (test); selfie privacy tests stay green; **one printed plate carries a printed and cut sticker, measured on the real part**. |
| **M3. Multi-colour planning** | The hybrid planner, the by-object clearance test with the preset values and the last-object exemption, `by-layer` with `modifier_part` accents, waste estimates, per-slicer fit keys and support keys. | The planner gives the expected plan for the three reference builds and three dressed looks; the clearance test is unit-tested against the Orca rules (hull distance, Y overlap, rod versus lid height, last object exempt); a generated by-object plate loads in Orca without a "too close" error; a generated `modifier_part` colours the stud region in a real slice. |
| **M4. Kit cards** | The model-kit flat-pack engine and layout, the golden test against `toyventor_kitcard.py`, anchors in `kip-partspec-manifest.json`, validated brim in `partspec-validation.json`, the sprue-dimension question settled by a break-off coupon. | The PrusaSlicer CLI slice of a generated card shows one connected body and no floating islands (this proves the overlapping-shell assumption); coupon printed and snapped in PLA and PETG, result recorded. **Default layout stays `loose` until this passes.** |
| **M5. Stencils prototype and base-body CAD** | Section 8.2 stencil prototypes, printed and test-fitted; a real CAD pass on the 9 failing base parts. | Software gates pass in `tests/kip-print-stencils.test.ts`: every face and shirt stencil is watertight-manifold with V4 overhang `< 0.01 mm²` and `0` floating islands on the real STLs; the Adult Tool Card exceeds the small-parts cylinder; a live `OrcaSlicer` CLI gate slices the card 3MF with **0 `; FEATURE: Support` lines**. **Still pending (physical):** printed prototypes fit the plate/torso and a paint-pen test judged by the owner; `F1_printed_fit` / `F2_breakage`. |
| **M6. Kit tray edition** | The `Kit tray` label, the computed support-free summary line, the sweep, and the torso / `snap_torso` / `snap_arm` / `tail_acc` CAD; peg and turret coupon. | Needs M4 (engine, built) and the CAD half of M5. |

**The kit tray, in one paragraph.** Parts on a card are already support-free by
construction: the frame and gates are `1.0 mm` tall, print flat and never need
support, and a part keeps its own orientation on the card. **Only four base
parts need supports:** `torso` (Pro edition), `snap_torso`, `snap_arm` (Snap
edition) and `tail_acc` (when a tail is on). The torso is the real blocker in
both editions; re-orienting it cannot fix it and a single planar split cannot
either. Until that CAD job is done, the tray edition ships with one honestly
labelled support plate.

**Open decisions still waiting on a reviewer.** Each carries a recommendation
with its evidence in the archived full text; the ones that gate the most work
are the sprue dimensions (gate `1.80 × 0.80 mm` with a `0.40 mm` neck, `2`
layers, `0.6 mm` groove opening, frame `2.4 × 1.0 mm`, frame-to-part gap
`>= 1.2 mm`; confirm with a break-off coupon before locking), the seated Snap
legs (print what is on screen; no swap now), the ownership window for colour
extraction in `kip-vehicles-wardrobe.js`, and the support-free bar for the
tray claim (the viewer's `10.0 mm²` V4 tolerance, plus offline V5/V6/V10, with
the catalog `1.0 mm²` bar as a report-only column).

---

## 9. Asset optimization pipeline

**Status:** proposed engineering specification, Revision 2 (final print-finish
review integrated, 2026-11-01). No runtime, CAD or catalog file is modified by
this document.

**Targets:** `public/parts-glb/` (web/AR preview models) and `public/parts-stl/`
(downloadable print meshes). Evidence labels used in the archived text:
`[code]` = verified in the working tree, `[measured]` = benchmarked against
current repo payloads with `manifold3d`, `trimesh` and `preprint_check.py`,
`[design]` = proposed architecture and threshold.

| Milestone | Scope | Expected output |
| --- | --- | --- |
| **M1 — Web GLB quantization, indexing and fast-load path** | Upgrade `scripts/stl_to_glb.py` (`uint16` crease-indexed + `KHR_mesh_quantization`); parallelize `model-viewer` import + GLB preload in `PartPreview.tsx`/`PrintDrawer.tsx`; bump `public/sw.js` to `toyventor-v3`. | `public/parts-glb/` drops `41.91 MB -> 8.24 MB` immediately (even before LOD); mobile preview waterfall eliminated. |
| **M2 — Finish-safe `Manifold.simplify` print + web LOD pipeline** | Add `scripts/optimize_assets.py` + `asset_optimization_manifest.json` (`0.006 / 0.010 / 0.018 mm` finish classes + `slicer_recipe`); wire into `scripts/bridge-partspec.ts` (including `forge-mount-first-print.stl`); extend `scripts/preflight-deploy.ts` with GLB validity and byte budgets. | `public/parts-glb/` -> **`~2.10 MB` (`-95%`)**; `public/parts-stl/` -> **`~18.5 MB`** with `100%` `G2/G3` arc-safe `0.12 mm` curved surfaces and zero `V1-V10` regressions. |
| **M3 — Offline LLM advisor and CAD root-bloat refactor** | Ship `scripts/llm-lod-advisor.ts` (`npm run parts:tune-llm`) for per-part LOD/crease/show-face tuning; add `seg_for_radius()` in `toyventor_geom.py`; LLM-refactor the top 10 heavy builders gated by CSG symmetric volume diff. | `public/parts-glb/` -> **`~1.75 MB`**; `public/parts-stl/` -> **`~14-15 MB` (`-50%`)**; faster CAD rebuilds; zero silhouette or specular faceting. |
| **M4 — Toy-finish print card (`PrintDrawer` + `PackOverlay`) and `.3mf`** | Replace the hardcoded `"0.2 mm PLA"` with a per-part `slicer_recipe` (`0.12-0.16 mm` layers, smooth PEI, `3` walls @ `30 mm/s`, `outer_first`/`inner_first`, corner/`+Y` rear seam, selective `0.21 mm`-inset ironing, dry-PLA/flow checklist, `brim_width_mm`); optional `.3mf` export carrying these settings natively. | Toy-grade surface finish out of the box with zero support-mesh bloat. |
| **M5 *(optional follow-on)* — `public/kip/partspec/` sync** | Apply `optimize_assets.py` to `public/kip/partspec/` (`101 MB` raw STLs loaded by `stlRigLoader.ts`). | Cuts repo/CDN static payload by another **`~45-60 MB`** and removes main-thread rig parse stalls. |

**Acceptance gates.** `npm run bridge` completes deterministically in `< 20 s`
and logs exact before/after MB and triangle totals; `npm run preflight` exits
`0` with all STL binary checks, GLB magic/chunk checks, service-worker cache
checks and size budgets passing; `npm test` and `npm run e2e` pass without
regression. `preprint_check.py --no-slice` passes on **all** optimized files at
both `0.20 mm` and `0.16 mm` layer profiles with `0` failures and zero new
warnings against the baseline. `toyventor_fit.py` mid-stud slice audit on Snap
Small, Snap Large, a Pro bore/pin pair and the forge mount ring confirms
`|Δgap_min| <= 0.005 mm`. Headless Chrome at `390×844` compares the 5 largest,
5 highest-curvature and 5 smallest GLBs in `<model-viewer>`: silhouette
`IoU >= 0.995`, and median cold-cache first-frame paint on throttled Fast 4G
drops byte transfer by `> 85%` (`kit-keel-base`: `3.21 MB -> < 90 KB`).

---

## 10. Describe & Build, and the Kip demo

### 10.1 Describe & Build (built)

A "Describe & build" tab in Kip-Demo: the user types what they want, a
language-model call turns the text into an ordered recipe of catalog parts, the
page shows the recipe as an exploded view with a slider, then animates the
build step by step to the assembled item.

**Contract.** Pose and recipe are never written by a model. Muse reads the
child's words (in any language, which the English keyword matcher cannot) and
picks one of the ten ready builds in `kip-describe-recipes.json`; the reply is
that build's own steps and reference poses, so it is always buildable and
always checked. Unclear words get a question offering two builds. Inventing new
builds stays local to
`parts/kip/viewer/tools/describe-endpoint.mjs`, which asks the model for a
recipe and then runs the real validator; putting that validator behind a
hosted service is what it would take to let the deployed app invent builds.
**Not done.**

**Built (2026-11-03).** `worker/describe.ts`, route `POST /api/describe`, using
Create mode's client conventions (`worker/muse.ts`, Responses API, `muse-spark-1.3`,
contact details scrubbed before the words leave, kid-safety filter on what
comes back, 10 requests a minute per IP). The tab uses it by default when the
Settings address is empty and falls back quietly to its own matcher if the
route is missing, off or failing.

**Measured (real Muse, 2026-11-03):** English, Spanish, Turkish and French
descriptions each picked the right build, with Muse's line in the child's own
language; "a spaceship" and "something fun" got a question; an injection attempt
got a harmless question and the invented id was never trusted. `4.4` to `10.6 s`
per call (`12 s` budget), so expect a visible "Thinking..." wait.

**The waiting state (built 2026-11-03): a little workshop.** A `4` to `10 s`
wait must not look frozen or lie about progress. While the model thinks (and
while the sample book and the part list load), a strip under the status line
shows a striped belt carrying common bricks (`2x2`, `2x4`, `1x4`, a wheel; at
most 6 at once, random) that ride in; about a third "poof" away mid-belt (did
not fit) and the rest drop onto a parts pile that fills along `1 - exp(-t/5.5)`.
The pile never fills on its own: the last two bricks are held back for the real
answer, so it cannot say "done" first. The wording rotates at 3, 6 and 10 s.
Rules: hidden for the first `350 ms`; decoration is `aria-hidden` and the status
line (`role=status`) carries the words; reduced motion shows three still bricks
and no loop; on answer, error or `dispose()` everything stops. Progress is
honest decoration plus time, never a fake percentage. The strip lives in
`parts/kip/viewer/kip-workshop-wait.js`, shared with the photo "Print it" panel.

**Privacy (decided, Dan, 2026-11-03): no parent gate.** The child's description
(contact details removed) goes to our server and on to Muse by default, to pick
a build. Same class as Create mode. Mitigations in place: contact details
scrubbed before the words leave, the reply filtered, the Worker logs only
status and recipe (never the text), 10 requests a minute per IP.

**Frozen paths.** Implementation touches `parts/kip/viewer/*` and `public/kip/*`
only; every other frozen path stays off-limits.

### 10.2 Kip demo: side menu, print view, selfie face plate

**Phase 1, side menu: done, and it is now the only UI** (dock and `?menu=side`
removed 2026-11-01). `kip-menu.js` (schema + panel + sync) is mounted by
default in `Kip-Demo.html`. The suite is menu-only (`42` checks): `164` real
choices through the `<select>`s, toggles, pull slider and buttons each change
the live state and the menu shows it; two-way sync; shortcuts; `?clean=1`; URL
params, `#toy=` and SDK loads; layout at `1440 / 1024 / 390`. The option sets
cannot silently shrink: `tests/kip-menu.test.ts` ("retired bottom dock") fails
if the page regains a dock, a `?menu=` gate or any retired `btn-*` id.

**Phase 2, print view: done for the character; four pieces are not.**
`kip-print.js` (pure: inventory, STL, support scoring, deterministic MaxRects
packer, 3MF, zip), `kip-print-view.js` (three.js plate, heatmap, exports).
Tiers: *support-free* only for catalog parts whose bytes match a passing
validation report (`public/kip/partspec-validation.json`, written by
`npm run kip:validation-index`); *unverified* for a stale or missing report;
*geometry-checked* for non-catalog parts with no steep overhang (V4 only);
*needs-supports* otherwise, flagged per object in the 3MF. Options with no
single STL (pro gears, spinner, scanner ears, wheelie tail, custom parts,
vehicles) are listed as "not on the plate". A missing STL names the file and
disables export. `npm run kip:plate-check` packs all 10 presets and fails on
any layout violation, missing file or failing catalog verdict.

**Not done in phase 2:** (a) `Pile -> Build` starting from the plate, which
needs a slot-to-part map for the rig's slot groups; (b) sprue mode, blocked on
the open sprue-dimension question; (c) vehicles; (d) "trapped overhang gets a
verified alternative". Printing the sheet is a PNG, not a PDF.

**Phase 3, selfie face: L1 and L2 done (second pass 2026-11-01); L3 not
started** (a spike, not a commitment). `kip-selfie.js`, `kip-selfie-image.js`
(pure: cut-out and Toon), `kip-faceplate-shape.js`, hooked into
`kip-forge-sdk.js` (`setSelfieCanvas`). Camera starts only from a tap on a
labelled button and is released on snap, close, Escape and page hide; the
denied, no-camera and upload paths all reach Adjust. Privacy is tested: zero
http(s) requests during the flow, nothing in web storage, IndexedDB, caches,
cookies or the URL, nothing after a reload.

---

## 11. Physical validation gates — what is still unproven

**Nothing in this lane has been printed yet.** `F1_printed_fit` and
`F2_breakage` stay `false` until physical bench coupons are logged.

### 11.1 The jet and band bench procedure (the pass rules)

This is the procedure the run sheet points at. The **run sheet**
([`motion-print-test-runsheet.md`](motion-print-test-runsheet.md)) holds the
numbers; this section holds the procedures and the pass rules.

**State of the CAD this tests (2026-11-03):** `verify_band_jet.py` `8/8` PASS,
`Gate G1` `13/13`, all `205` parts pass the part gate, and the served copies in
`public/kip/partspec/` match their validation reports (`kip-validation-index`:
`159` of `159`). Nothing has been printed yet, so every number below marked
*predicted* is a model result that the print is allowed to contradict.

**Purpose.** Settle what the CAD cannot: (A) does the printed jet seal and move
the truck, and how does a real balloon behave on the collar; (B) does the
pull-back band core wind, lock, coast and keep its band on the drum; (C) which
wheel helps.

#### What to print and gather

| Test | Print | Source | Note |
| --- | --- | --- | --- |
| A, jet | `mom_jet_valve_body` | `parts/partspec/toyventor_mom_jet_valve_body_S.stl` (`49.8 x 27.8 x 28.0 mm`, as exported, no supports) | also on `Card E3` |
| A, jet | `mom_jet_slide_valve` | `toyventor_mom_jet_slide_valve_P.stl` (`9.6 x 38.0 mm`, prints lay-flat as exported) | the cross-bore leaks without it; carries the small-parts notice |
| A, jet | `mom_nozzle_set` | `toyventor_mom_nozzle_set_P.stl` (`63.0 x 14.1 x 8.2 mm`, four inserts on tabs round a storage hub) | snap each insert off its tab when you test it; the old one-bar version is gone |
| A+B, truck | Snap truck | keel, 2 barbell shafts, 4 `kit_wheel_med`, windscreen, Kip seated; **no tub, no hinge, no axle gear for the jet** (the jet body overlaps the rear axle gear by `442 mm3`) | an existing Snap truck works; add 4 `kit_wheel_giant` for the wheel test |
| B, band | `Card E2` | `parts/partspec/cards/card_e2_sprue.stl` (`157.2 x 152.1 mm`): band tray and lid, PTO gear, `shaft_tu03`, slam base and plunger, axle `gear_spur_z10`, band spool, two captive pins | or print the parts singly from `parts/partspec/` |
| B, band | Bands | `1x #64` synthetic loop (`89 x 6.4 x 1.6 mm`) for the standard setup; `2x #32` loops (`76 x 3.2 x 1.1 mm`) as the narrow-band option | latex-free synthetic rubber; the `Motion` stage carries the latex notice |
| A | Balloons and pump | 9 inch latex balloons, a hand pump (no mouth inflation: there is no mouthpiece) | ages 8+, supervised; keep burst pieces from small children |
| both | Measuring | kitchen scale (`0.1 g`), tape measure, flat board with a ruler, spring scale or newton gauge (to `15 N`), phone camera at 60 fps on a stand, masking-tape marks every 25 cm | |
| both | Track | smooth tile or laminate, `4 m` or more | |

Slice at your normal PLA settings (`0.4 mm` nozzle, `0.20 mm` layers, no
supports) and **write down infill, perimeters and finished weights**; mass is a
first-order input. The part gate ran geometry checks only; a first real-slicer
pre-check was run on 2026-11-03 (below). A slicer warning on the pawls, the
lip or the valve apex is still a result worth recording: the gate flags three
warnings the print should confirm or clear (`mom_pto_gear_z10` thin cup base,
`mom_jet_slide_valve` teardrop apex tip, `mom_band_core_tray` a `0.33 mm` plate
over one socket ceiling).

#### Slicer pre-check (OrcaSlicer 2.4.2 CLI, 2026-11-03, before anything is printed)

**Method.** Every Motion part (E2 and E3) and the four E2/E3 card plates, as
exported (`_S`/`_P` STLs and `parts/partspec/cards/`), centred on a
`300 x 300` bed, one part per 3MF, with Dan's own project settings from
`parts/partspec/calibration/Print2_Verify.3mf`: Ender-3 Pro `0.4 mm`, `0.20 mm`
Standard, `2` walls, `15%` infill, Creality Generic PLA `220 C`, supports
`normal(auto)` at `30 deg`. Each part was sliced with supports **ON** (Dan's
own default, so it shows where his slicer would add them) and **OFF** (what
this sheet asks for), then the G-code was read for support extrusion, filament
and time. The method was checked against controls whose answer is known: a flat
`22 mm` table gets supports (`2102 mm` of filament, up to the slab underside), a
`45 deg` ramp gets none, and an `8 x 8 mm` flat socket roof gets supports
(`73 mm`). All `49` slices (parts, cards, controls) exited `0`.

| Part | Filament (supports off) | Time | Supports ON (Dan's default) |
| --- | --- | --- | --- |
| `mom_jet_valve_body` | `10.6 g` | `1 h 16` | none |
| `mom_jet_slide_valve` | `1.5 g` | `12 min` | none (the teardrop apex is not flagged) |
| `mom_nozzle_set` | `2.4 g` | `21 min` | `3` blocks, `25 mm`, only at z `0.2..0.8` (four small flat faces, one per insert, `0.7 mm` above the bed) |
| `mom_band_spool_pawl` | `1.95 g` | `15 min` | none (the lip and the pawls slice clean) |
| `mom_pto_gear_z10` | `2.7 g` | `25 min` | `34` blocks, `370 mm` (`12%` of the part) under the `45..60 deg` cup walls |
| `mom_band_core_tray` | `24.5 g` | `2 h 39` | `33` blocks, `586 mm`, z `0.2..16.6`: under one connected flat roof at z `5.0` (`146 mm2`, spread over the whole `49.8 x 49.8` footprint) and `4 mm2` at z `16.5`; which tray feature that is was not traced |
| `mom_band_core_lid` | `12.3 g` | `1 h 33` | `23` blocks, `141 mm`, z `0.2..2.2`: one `7.1 x 14.9 mm` flat roof at z `2.2` |
| `mom_slam_base` | `22.5 g` | `2 h 12` | `45` blocks, `670 mm`: flat roofs at z `12.0` and z `17.0` (`62.3 x 13.3 mm`, the longest bridge on E2) |
| `shaft_tu03`, `gear_spur_z10`, `mom_slam_plunger`, `pro_captive_pin_28` | `1.2 / 2.3 / 4.0 / 0.9 g` | `9 / 20 / 24 / 8 min` | none (the pin has one first-layer block) |
| Card E2 loose / sprue | `72.4 / 74.2 g` | `8 h 00 / 8 h 14` | `158 / 154` blocks (`~4%` of the plate) |
| Card E3 loose / sprue | `67.0 / 68.8 g` | `7 h 27 / 7 h 40` | `124 / 126` blocks (`~3%`) |

Truck parts (second pass, same settings, supports off):

| Part | Solid PLA (estimate) | Sliced, `15%` infill | Time | Supports ON (Dan's default) |
| --- | ---: | ---: | --- | --- |
| `kit_keel_base` | `71 g` | `32.8 g` | `3 h 12` | `45` blocks, `298 mm`, `+0.18 g` |
| `kit_wheel_med` (`Ø36`), each | `13 g` | `6.6 g` | `50 min` | none |
| `kit_wheel_giant` (`Ø50`), each | `26 g` | `11.9 g` | `1 h 25` | `49` blocks, `1459 mm`, `+0.37 g` |
| `kit_barbell_shaft`, each | `2.5 g` | `2.5 g` | `16 min` | none |
| `kit_windscreen` | not listed | `12.0 g` | `1 h 25` | `13` blocks, `286 mm`, `+0.52 g` |
| `kit_tilting_tub` (not on the Test A truck) | not listed | `15.9 g` | `1 h 49` | none |
| Kip driver, 30 pieces (15 distinct) at the truck bench's `0.52` scale | not listed | `17.0 g` | about `3 h 45` summed | not sliced with supports on |

Test A truck, summed: keel + 2 shafts + 4 `Ø36` wheels + windscreen + jet body +
slide valve + one nozzle insert (a quarter of the set) = `88.6 g`; with Kip
`105.6 g`; with a `3 g` balloon (an assumption, not measured) `108.6 g`. With
four `Ø50` wheels instead: `129.8 g`. Two assumptions sit in those sums: the
balloon mass, and that the old T6 body weighs about what the new one does (it
was not sliced).

**Reading.**

- **Supports must be OFF for the trays, lids and slam base.** Dan's default adds
  supports under flat roofs, even small socket-style ones (an `8 x 8 mm`
  control roof got `73 mm`): the same effect as the "female-socket supports" on
  the calibration print. The 3MF writers in `kip-print.js` write
  `enable_support = 0` per object; a hand-made project with supports on will
  not. With supports off every part and card slices cleanly, with no support
  and no more than `14 mm` of overhang-wall filament in any part.
- **The Test A and Test B parts the sheet worries about are clean:** the jet
  body, slide valve, spool pawl (lip included) and PTO gear need no supports to
  slice. The nozzle-set pegs are a first-layer detail.
- **The longest flat bridge is the slam base's `62.3 x 13.3 mm` roof at
  z `17.0`, then the `7.1 x 14.9 mm` roof in the band lid.** Both are inside
  the gate's `20 mm` bridge limit; whether they sag is a print question, not a
  slicer result.
- **What the slicer cannot say.** It did not flag the three gate warnings (PTO
  gear cup base, valve apex, the `0.33 mm` tray plate), but it cannot judge a
  `0.33 mm` plate or a thin base either: those stay print checks.
- **Masses.** At `15%` infill the jet body is `10.6 g`, about half the solid-PLA
  `20 g` that the `150 g` truck assumes, so the printed truck will be lighter,
  drag lower and the thrust/drag ratios higher than predicted there. The Snap
  truck as Test A uses it comes to about `106 g` with Kip and about `109 g` with
  a deflated balloon, against `150 g` solid before Kip. The T0 weighing still
  decides, because slicer grams are not scale grams.
- **Limit of this check:** one part per bed, no brim or first-layer tuning,
  nothing about fit, strength or bridging quality.

#### Test A: balloon jet, measurements in order

1. **Mass (T0).** Weigh the finished truck (Kip and a deflated balloon on the
   collar), the body and the valve. Model: about `109 g` sliced at `15%` infill
   with Kip and a `3 g` balloon; `150 g` was the solid-PLA figure before Kip.
2. **Rolling drag (T1).** Tilt the board slowly until the truck, pushed gently,
   just keeps rolling: coefficient = rise / run. Model `0.045` (`2.6 deg`,
   `4.6 cm` rise per metre); drag force = coefficient x weight (`4.9 gf` at
   `109 g`, `6.75 gf = 0.066 N` at `150 g`).
3. **Seal (T2).** With the valve OPEN, inflate to about `15 cm`, close it, take
   the pump off, and watch `15 s`.
4. **Balloon posture (T3).** At `125`, `150` and `175 mm`: does it stand
   upright, lean, or rest on Kip's hat and back? Film the first run from the
   side for trail angle, whether it reaches the jet axis, and whether it folds
   over the nozzle at the end of the burn.
5. **Runs (T4).** For each of the four inserts (`Ø3.2`, `Ø4.6`, `Ø6.1`, `Ø8.0`
   as measured; `Ø3.0 / 4.5 / 6.0 / 8.0` as drawn) and then the bare socket, 3
   runs from the same mark with a full `175 mm` balloon: distance, time to
   stop, acceleration from the video. Thrust = mass x acceleration + drag
   during the burn.
6. **Wheels (T5).** Repeat the best insert with `Ø50` wheels (all four, or the
   rear pair) and note the mass change.
7. **A/B on passage size (T6, optional, cheap).** Print the pre-re-export jet
   body and slide valve and run the bare socket on both: `git show
   f60a7b2:public/kip/partspec/toyventor_mom_jet_valve_body_S.stl > old_body.stl`
   and `git show f125017:public/kip/partspec/toyventor_mom_jet_slide_valve_P.stl >
   old_valve.stl`. Same balloon, truck and track; only the passage differs
   (`Ø5` against `Ø7`). Predicted `5.1 gf` against `9.2 gf`.

#### Test A: predictions to beat (written first, so the print can fail)

Model: `2.5 kPa`, two orifices in series (the `38.1 mm2` valve port and the
insert), rolling drag `0.045` x mass. Insert figures are from
`verify_band_jet.py` `C5`; the bare-socket line is an estimate from the same
model. Two mass columns: `150 g` is the original solid-PLA figure (kept so the
first prediction stays on the record), `109 g` is the sliced truck with Kip and
a balloon (drag `4.9 gf`).

| Configuration | Predicted thrust | Over drag at `150 g` (solid) | Over drag at `109 g` (sliced) |
| --- | ---: | ---: | ---: |
| `Ø3.2` insert | `3.9 gf` | `0.6x` | `0.8x` |
| `Ø4.6` insert | `7.2 gf` | `1.1x` | `1.5x` |
| `Ø6.1` insert | `9.3 gf` | `1.4x` | `1.9x` |
| `Ø8.0` insert | `9.4 gf` | `1.4x` | `1.9x` |
| bare socket (tunnel exit, `52.6 mm2`) | about `9.2 gf` | about `1.4x` | about `1.9x` |
| T6 old body, bare socket (`Ø5` passages) | about `5.1 gf` | about `0.75x` | about `1.0x` (assumes the old body weighs the same; not sliced) |

With four `Ø50` wheels the sliced truck is about `130 g`, so the same row reads
`0.7x / 1.2x / 1.6x / 1.6x / 1.6x` on mass alone: bigger wheels cost `21 g`,
and T5 only pays off if the rolling coefficient falls by more than that.

**What moves the ratio (read this first if the truck only just fails).** Over
drag = thrust / (rolling coefficient x mass), and thrust scales with balloon
pressure. Starting from the best insert (`9.4 gf` at `2.5 kPa`, `0.045`,
`150 g`):

| Change | Value | Over drag |
| --- | --- | ---: |
| Truck mass | `110 g` / `120 g` / `150 g` / `175 g` / `200 g` | `1.9x` / `1.7x` / `1.4x` / `1.2x` / `1.0x` |
| Rolling coefficient (at `150 g`) | `0.035` / `0.045` / `0.060` | `1.8x` / `1.4x` / `1.0x` |
| Balloon pressure (at `150 g`) | `1.5` / `2.0` / `2.5` / `3.0 kPa` | `0.8x` / `1.1x` / `1.4x` / `1.7x` |

The `1.3x` rule holds up to a truck mass of about `160 g` at the model's
coefficient and pressure, and the ratio reaches `1.0x` near `210 g`. The model
uses a constant `2.5 kPa`; a real latex balloon's pressure is highest early in
the burn and falls as it deflates, so the mean over the burn may sit below
that. The video acceleration in T4 shows the actual curve: compare the first
and last quarter of the burn before blaming the passages.

The valve port (`38.1 mm2`) is the limit: the series ceiling is `9.7 gf`, so
`Ø8.0` should buy almost nothing over `Ø6.1`. The margin over the `1.3x` rule
is thin (`1.38x`): if the truck only just fails, check T0 and T1 first, because
mass and drag move the ratio as much as the model does. If it moves clearly
less than predicted, say so in the record and fix the passage model; if it moves
with the old body (T6), the passage model is wrong.

#### Test A: pass rules (agreed by Dan, 2026-11-02) and what each outcome means

| Result | Rule | If it fails or surprises |
| --- | --- | --- |
| Seal | `15%` diameter loss or less in `15 s` | thicken the `0.60 mm` web between the inlet rim and the tunnel lip; the jet is not usable until it holds |
| Moves | thrust over drag `1.3x` or more with some insert, as drawn | predicted pass with `Ø6.1` and `Ø8.0` at `150 g`; at the sliced `109 g` `Ø4.6` clears it as well (`1.5x`). Fix order: lower mass (infill, Kip off), `Ø50` wheels, then a larger valve port (the limit; needs a bigger spool, not drawn) |
| Goes | mean of 3 runs of `2 m` or more on tile | lower mass, `Ø50` wheels, or larger passages |
| Balloon clear | trail angle under `45 deg` in every frame, jet never obstructed | add a rear stop; if it folds over the nozzle at the end of the burn, a cradle or a shorter neck |
| Soft contact | tracks straight within `10 cm` over `2 m`, Kip not knocked over | hold the balloon back about `30 deg` (an angled neck seat) or use a smaller balloon |

#### Test B: pull-back band core, in order

1. **Assemble and look (B0).** Tray, lid, PTO gear and spool on `shaft_tu03` in
   the real saddles, axle gear below. Check by hand: the spool turns freely on
   the shaft, the gear meshes with the axle gear without binding, the lid
   closes over the gear dome. With the band off, turn the gear both ways: it
   should **lock the spool one way and slip the other** (the pawls click over
   the sawtooth). Record which way each turn goes against the truck: dragging
   the truck backward must wind, releasing must drive it forward.
2. **Tyre friction (B1).** A sled or the truck itself on the real floor, four
   ways: `Ø36 / Ø50` x bare PLA / O-ring. Wind `2.5` turns by pulling the truck
   back with a hand press you can measure (a gauge on the truck). *Predicted:*
   bare PLA below friction `0.3` slips and fails; the O-ring or `Ø50` option is
   then the decision.
3. **Shaft capture (B2).** With the lid on and the band wound, watch whether the
   shaft lifts out of a saddle. *Predicted:* `0.35 mm` worst case against the
   `0.5 mm` limit.
4. **Band torque (B3).** Spring scale on the band at `2.5` turns. *Predicted:*
   torque `35` to `65 N.mm`, which is about `5.5` to `10 N` of force at the
   drum radius (`6.4 mm`). Use `1x #64` first, then `2x #32`.
5. **Retention (B4, the open design question).** The spool carries a `R7.2`
   retaining lip, the smallest shape that prints without supports; it leaves
   about `1.6 mm` of drum above it for a `6.4 mm` band. Wind, release and repeat
   for `20` or more rapid launches. *Check:* does the band stay on the drum and
   clear of the pawls, or does it walk down into the pawl zone and jam?
6. **Runs (B5).** 3 runs each on `Ø36` and `Ø50`, from the same mark, hard
   floor: distance, and whether the clutch freewheels in the coast. *Predicted:*
   `2.0` to `3.5 m` if the clutch freewheels cleanly, `0.8` to `1.2 m` if the
   pawl drag acts throughout the coast (about `0.12 N` on `Ø36`, `0.084 N` on
   `Ø50`); the bench settles which.
7. **Skip torque (B6, optional).** Add torque by hand against a locked wheel
   until the clutch skips. *Predicted:* comfortably above the `65 N.mm` launch
   peak.

#### Test B: pass rules and what each outcome means

| Result | Rule | If it fails or surprises |
| --- | --- | --- |
| Winds | `2.5` turns with a hand press of `8 N (0.8 kgf)` or less, no slip | `Ø50` wheels, then an O-ring groove on both wheel sizes |
| Locks the right way | winds on the pull-back, drives forward on release, freewheels in the coast | wrong way round means the mirror is wrong in print (it passes `C1` in CAD): stop and send the photo |
| Skip torque | above `65 N.mm` with margin | a pawl is skipping: check the bite (`0.78 mm` drawn) and print orientation |
| Shaft | lift `0.5 mm` or less | thicken the saddle or add a lid keeper rib |
| Band retention | band stays on the drum over `20+` launches | **fixes, cheapest first:** (1) use the `2x #32` loops (`3.2 mm` wide each); (2) tape a ring on the drum above the pawls to confirm the diagnosis; (3) redesign: a separate flat-printed retaining ring that snaps onto the drum (needs CAD, not drawn) |
| Goes | mean of 3 runs of `2 m` or more | `Ø50` wheels, O-ring tyres, lighter truck, or a higher-torque band |

#### Record sheet (one row per run)

**Jet:** date, body infill and weight, truck mass, drag coefficient, wheel
size, insert (bore), balloon diameter at start, pressure note, distance, stop
time, peak acceleration, trail angle (max), contact with Kip (none / rubs /
pushes), jet obstructed (y/n), seal loss over `15 s`, notes.

**Band:** date, wheel size and tyre (bare / O-ring), band (`#64` or `2x #32`),
turns wound, hand press at `2.5` turns, scale reading, clutch direction (winds
/ drives / coasts), shaft lift, band on drum after `20` launches (y/n), distance,
notes.

Keep the video for both.

#### Cost and time

Jet: three small prints (about `19 g`, `2 g` and `3 g` at solid), a bag of
balloons; about two hours for T0 to T5, plus one hour for the T6 A/B. Band: one
plate (`Card E2`) and two bands; about two hours for B0 to B5. The results decide
whether the next step is a cradle, a bigger valve port, a retaining ring, or a
clutch tweak, and which of the parked warnings (PTO cup base, tray plate)
matter.

### 11.2 The other physical gates

- **Front-wheel snap (pass rule and fallback):** the steered wheels use a round
  `Ø6.60` `pin_free` stub ending in a `Ø7.30` barb (`0.15 mm` over the wheel's
  `Ø7.00` bore) and the new free-hub wheels `kit_wheel_med_free` (`Ø36`) and
  `kit_wheel_giant_free` (`Ø50`). **Not proven by a print:** the snap. Estimated
  pull-off about `1 kgf`; assembly force a few newtons per half. **Pass rule:**
  the wheel goes on by hand, holds when the truck is lifted and shaken, spins
  freely, and comes off with a firm pull without cracking the stub. If the
  stub cracks, shorten the slot or thicken the root before changing anything
  else.
- **`F1` / `D1` shake, double-D fit and pull-out coupon:** inverted assembled
  shake test (`< 0.5 mm` axial play), multi-printer check of Law M1's
  `0.05 mm`/side double-D fit, and measured `pro_captive_pin_28` /
  `pro_steer_column` / `pro_pilot_pin` retention (**`>= 10 N` minimum pull-out**
  vs `~20 N` analytical, clean pinch/push-out release across `20` cycles).
- **`G2` turning circle:** physical `<= 62.0 cm` (`Ø36`, `>= ±25°` inner lock) /
  `<= 75.0 cm` (`Ø50`, `>= ±20°` inner lock) wall-to-wall circle.
- **`G3` / `D3` `Motion` endurance, traction and FDM seal:** `50` pull-back band
  launches (`0` tooth skip or lateral `#3a` axle walk; settle `Ø36`/`Ø50` ×
  bare PLA/O-ring tire-traction and run-distance coupons), **`<= 15%` balloon
  diameter loss over `15 s` `CLOSED` staging hold** across the printed
  `0.60 mm` jet web, `>= 1.30×` measured thrust/drag, and a real-balloon
  rest/trail pose check, band retention with the `R7.2` drum lip (`6.4 mm`
  band, slack-band walk toward the pawls).
- **`G4` matched-CG `5 TU` stacked dummy core and sponson float:** sealed
  printed `3 TU` Drive + `2 TU` Brain dummy stack weighted with internal
  sand/steel shot (`0` loose coins) to **`115-125 g`** at the `2 TU`-brain
  combined CG (**`Z_world ≈ 44 mm` / `31.5 mm` above `#1` deck**): `< 0.5 mm`
  axle sag, `>= 1.4×` Dump Truck and Tractor static tip-over margins, and
  Catamaran `<= 55%` draft (`>= 25 mm` freeboard, upright at `20°` heel).
- **`G5` / `G6` / `G7`:** `15 min` `PETG` locked-rotor + `SG90` stall thermal
  soak (`< 45 °C` exterior touch, `< 55 °C` motor boss, `0` PPTC nuisance
  trips), `1.0 m` `5×` drop (`0` sharp fragments, `0` battery-door opening),
  and `500`-cycle / `24 h @ 40 °C` creep check.

**The bench run sheet** is
[`motion-print-test-runsheet.md`](motion-print-test-runsheet.md): predictions
written first, blanks for measured results, plus the print manifest (PLA,
`0.4 mm` nozzle, `0.20 mm` layers, supports OFF). CAD was last re-verified
2026-11-03: `verify_band_jet.py` `8/8` PASS, `0` FAIL, `0` UNKNOWN.

**The one open CAD question that a print answers:** whether the smaller `R7.2`
retaining lip still keeps a slack band out of the pawls (the drum now leaves
only about `1.6 mm` above the lip).

---

## 12. Open decisions

| # | Decision | Recommendation | Why (evidence) | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | Balloon cradle | Probably a rear stop to limit the trail-back (not a tilt-holder); decide whether the balloon may rest against Kip at rest or is held back about `30°`. | Nothing is designed yet; it wants a printed balloon test on the real keel. | `Motion` balloon |
| 2 | Balloon size to support | Leave `150-225 mm` open. | All work with a `15-45°` lean; smaller is lighter and needs less lean. | `Motion` balloon |
| 3 | Sprue dimensions | Gate `1.80 × 0.80 mm` with a `0.40 mm` neck (`2` layers) and a `0.6 mm` groove opening; frame `2.4 × 1.0 mm`; frame-to-part gap `>= 1.2 mm`. Confirm with a break-off coupon before locking. | The generator's neck of about `0.30 mm` becomes a one-layer slot of about `0.36 mm` at `0.2 mm` layers, under a nozzle width. Nothing is measured yet. | M4 |
| 4 | Default layout at first release | `loose` until M4 passes; kit-card layout becomes the default after. | Sprue is the least verified piece and needs build-time anchors and a physical check. | M1 scope |
| 5 | Seated Snap legs | Print what is on screen (no swap now). | `char_legs_seated` is built but hard-hidden (`snapSeatedLegsGroup.visible = false`); the Edition tooltip and `kip-manifest.json` still say it is shown. | §8 |
| 6 | Colour extraction ownership | Agree an owner and a window with the peer sessions before M1 starts. | The shared `resolveBodyColors` is the only way to keep the BOM from drifting, and the file is edited by other sessions. | M1 |
| 7 | Support-free bar for the tray claim | The `10.0 mm²` V4 tolerance the viewer already applies, plus offline V5, V6 and V10; show the catalog `1.0 mm²` bar as a report-only column. | At `1.0 mm²` `boot` (`3.9 mm²`) would fail too, which widens the CAD scope for a part that slicers normally print without supports. | M6 |
| 8 | Pegs and turrets on the cards | Keep them loose by default; allow gating behind a flag only after the peg and turret coupon. | The sampler finds anchors, so geometry is not the blocker; the `0.8 mm` stub on the seating shoulder is unproven. Today `13` of `33` instances (Pro) stay loose. | M6 |
| 9 | Torso route | Re-model the five named features in one CAD pass for both torsos; keep the support plate as the labelled fallback. | Best tilted pose `390 mm²` (axis best `426`), no single planar cut clears either torso, and the five overhang bands sum to the whole `426 mm²`. | M5, M6 |
| 10 | `Pro Powered Add-On` firmware | Not started. Local Wi-Fi SoftAP / LAN mDNS + WebSocket is the decided transport. | No firmware exists; §6.1 records the decision so the first implementation does not re-litigate it. | `Card F` |

---

## Appendix A: what each merged document held

Each file below was retired with the archive (removed). The archive held the
reasoning, the derivations, the audit tables and the sources that this file
condenses. Where this file and a retired file disagreed, this file is the live
one for the sections it covers (§1–§7 are the engineering canon); the retired
file remains the record of how the decision was reached.

| Retired file | What it held | Where its live content went |
| --- | --- | --- |
| `functional-print-mechanics-spec.md` | The canonical CAD baseline, the `D1`–`D3` / `R1`–`R7` review findings, the notation, the supersession table, the 8-card manifest and the sign-off gates. | §1, §1.1, §2, §3, §4, §11 |
| `progressive-power-system-spec.md` | The pre-CAD Pass 4g baseline: the physics and impulse derivations, the 7-gate protocol, the `Card F` electrical safety baseline and the capability matrix. Its geometry, packaging and card-manifest sections are superseded by §1.1. | §4, §5, §6, §7 (carried verbatim) |
| `motion-stage-options-spec.md` | The ladder decision, the options analysis, the bench-test ordering and the print-and-test sheet. | §1, §11 |
| `flatpack-modular-craft-spec.md` | Pass 4g coordinate frames, the 15-module catalog, the 9-craft assembly traces and the Pass 5 CAD execution sequence. Its geometry is superseded by §2. | §2 |
| `kip-print-workflow-spec.md` | The full "print what's on screen" engineering spec: the printer profile, the colour resolver, the 3MF package, the kit-card engine, the sticker and stencil design, and the appendix of sources. | §8 |
| `parts-asset-optimization-spec.md` | The asset pipeline design, the file and schema specifications, the LLM tuning approach and the dynamic-part section. | §9 |
| `describe-and-build-viewer-spec.md` | The Describe & Build design spec, its six build steps and its validation plan. | §10.1 |
| `kip-demo-implementation.md` | The Kip demo build plan, its phase constraints and its implementation log. | §10.2 |

**Not merged, still live elsewhere in `docs/specs/`:** the vehicle and
construction drafts (`construction-vehicles-spec.md`), the game and world
specs, the parent-gate specs, and the print bench run sheet.
