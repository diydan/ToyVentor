# Spec: Four-Stage Progressive Power & Robotics System (`Snap → Pro → Momentum → Mech`, Pass 4e Canonical)

## Status, Scope & Canonical Authority

- **Status:** Pre-CAD Engineering & Physics Specification (**Pass 4e**, resolving all `P0`, `P1`, and `P2` findings from two independent pre-CAD engineering reviews). **No repository code has been modified.**
- **Companion specs:** Physical craft grammar and `Cards A–D` datums live in [flatpack-modular-craft-spec.md](flatpack-modular-craft-spec.md); live lattice rules live in [`parts/partspec/interfaces.json`](../../parts/partspec/interfaces.json) and [parts-tu-spec.md](../parts/parts-tu-spec.md). This Pass 4e specification supersedes both the Pass 4d (`ae0dfaa`) baseline and the temporary condensed summary draft.
- **Unified Age-Grading & Compliance Scope (Aligned with [`COMPLIANCE.md`](../../parts/partspec/COMPLIANCE.md)):**
  - **Stage 1 (`Snap`, Cards `A–D`):** **Ages `3+`** (`Snap Small`; `Large` under-3 remains parked). Carries `print_page_warnings.always` plus `16 CFR 1500.19` small-parts warning whenever combined with small character add-ons or `Pro` parts (`F1_printed_fit` and `F2_breakage` pending).
  - **Stage 2 (`Pro` Steering) & Stage 3 (`Momentum`, Cards `E1–E2`):** **Ages `8+`** (matches `interfaces.json` `pro_min_age = 8` and places latex-balloon play at `8+`, while retaining the mandatory `16 CFR 1500.19(b)(2)` uninflated/broken latex balloon warning for households with children under 8).
  - **Stage 4 (`Mech`, Card `F`):** **Ages `10+`** (supervised programmable robotics extension). Introduces three explicit US compliance obligations beyond passive plastic parts: `ASTM F963-23` §4.25 tool-locked battery compartment + IEC 62133 protected cell, `FCC Part 15` pre-certified intentional radiator module with keep-out compliance, and local-LAN / zero-PII browser communication (`COPPA`). (`EN 71` and `IEC 62115` remain out of scope until an EU launch per `COMPLIANCE.md`.)

---

## 1. Universal `3 TU` (`37.5 mm`) Power Core Contract & Chassis Interface Lock

Raising both powered brick envelopes from `2 TU` (`25.0 mm`) to **`3 TU` (`37.50 mm` body height; `40.30 mm` overall with `2.80 mm` top studs)** while locking `#1 kit_keel_base` to a **single universal `z_axle = 6.25 mm` (`0.5 TU`) tier** resolves every PTO gear, micro-servo, and battery-stack collision without modifying `#1` across Stages 1–4:

| Standard Envelope | Outer Body `BBox` (`mm`) | Internal Cavity (`2.0 mm` walls/floor/lid) | Top / Bottom / Rear Interfaces | Roles Across `Pro`, `Momentum` & `Mech` |
| :--- | :--- | :--- | :--- | :--- |
| **Full Power Core (`4×4×3 TU`)** | `49.8 × 49.8 × 37.5` (`+2.8` studs) | **`45.8 × 45.8 × 33.5 mm`** | `10`-stud `socket_small` bottom (`rows 6..9`); `4×4` `stud_small` lid; **replicated rear `c_jaw_tu01` hinge (`Y = 124.9, X = ±14.0, z = 47.0 mm`)** so `#11` `4×4` Dump Tub hinges & tips `55°` on top of any Core! | `Pro` hand-crank gearbox; `Momentum` `#64` band engine, `10°` bellows, or shrouded `2:1` flywheel; `Mech` `1×`/`2×` gearmotor drive or `MCU` + `600 mAh` LiPo brain. |
| **Actuator Half-Core (`2×4×3 TU`)** | `24.8 × 49.8 × 37.5` (`+2.8` studs) | **`20.8 × 45.8 × 33.5 mm`** | `2×4` `socket_small` bottom; `2×4` `stud_small` lid; side/bottom `bore_grid` shaft port. | `Pro` rack-steering column; `Momentum` balloon jet shutter or `IF-bump` ratchet; `Mech` upright `9g`-class micro servo (`12.6 × 32.5 × 29.0 mm` -> `>= 3.0 mm` clearance on all axes). |

### 1.1 Five Future-Proof Features Locked Into `#1 kit_keel_base` Today

1. **`10.0 × 33.0 mm` Rear PTO Through-Slot (`X = ±5.0 mm`, `Y = 89.75 .. 122.75 mm`, centered on `row 8` at `Y = 106.25 mm`):** Passes `gear_spur_z10` (`Ø30.0 × 6.2 mm` manifest BBox) with `1.90 mm/side` axial and `1.50 mm/end` radial clearance, leaving a `2.15 mm` rear cross-tie and `10` perimeter studs (`row 6` all `4` cols + `rows 7..9` cols `0, 3`).
2. **Universal `25.00 mm` (`2.0 TU`) PTO Datum + Positive Axle-Keeper Clips:** Every land craft (`Race Car`, `Dump Truck`, `Tractor`) uses `z_axle = 6.25 mm`. A module-`2.5` `gear_spur_z10` on the Core output shaft at **`z_pto = 31.25 mm`** (`18.75 mm` above the `12.50 mm` keel deck; gear top at `z = 46.25 mm`, clearing the `z = 48.00 mm` lid ceiling by **`+1.75 mm`**) meshes at `31.25 - 6.25 = 25.00 mm` (`2.0 TU`) above the deck (`z = 16.25 .. 21.25 mm`). Under `80 N·mm` burst torque, tooth forces are `6.4 N` horizontal (`±Y` into solid `1.6 mm` jaw walls) and `2.33 N` downward (`-Z`, `< 15%` of twin-jaw `18.8 N` retention), reinforced by snap-on under-keel **`pro_axle_keeper` clips** (`Card E1`) that close the `row 8` jaw into a `360°` eye for `Momentum`/`Mech` builds.
3. **`row 0` (`Y = 6.25 mm`) Front Steered Station:** Clear of the `Y = 37.50 mm` hull shoulder; accepts Snap barbells directly from below or `Card E1` `pro_steer_bridge` from above.
4. **Twin Upper Gunwale Cable Channels (`z = 7.50 .. 12.50 mm`, Zero Axle Crossing):** Two `5.5 × 5.0 mm` channels along `X = ±18.75 mm` (`rows 3..9`) and `X = 0.0 mm` (`rows 1..2`, aft of `row 0` axle) sit completely above the `z = 6.25 mm` axle plane, passing pre-crimped `5.0 × 4.5 mm` 3-pin servo and `JST-PH` plugs without rubbing rotating shafts.
5. **Relieved `Ø8.20 mm` Central Tunnels Between `3.00 mm` Outer Bearing Lands:** Eliminates FDM over-extrusion bore drag across `49.8 mm` spans.

---

## 2. The 7-Gate “Phase 3 Guarantee” Verification Protocol (Executed in Phase 1–2)

| Gate | Stage Executed | Exact Test & Datasheet Solids / Fixtures | Quantitative Pass Criterion |
| :--- | :--- | :--- | :--- |
| **`G1` — CAD Keep-Out, Sweep & Kip Ghost Audit** | Pre-CAD / Phase 1 | Boolean collision audit across all 9 craft with datasheet-true solids: `ghost_kip_seated` (`43×36×68 mm` + `25 mm` hand zone), `ghost_mcu_21x18` (`21×18×4.5 mm`), `ghost_carrier_38x38`, `ghost_lipo_602535` (`35×25×6.5 mm`), `ghost_gearmotor_12x24`, `ghost_servo_9g_class` (`12.6×32.5×29.0 mm` + `±45°` horn sweep), `8.0 mm` min-bend cable volumes, `12×7×25 mm` `USB-C` plug insertion corridor (clear of wheels/hitch), and `12×10 mm` RF antenna keep-out. | **`0.000 mm³`** overlap across static and extreme kinematic poses (`±26°` steer, `55°` dump tip on Core, `360°` slew, prop/rotor spin). |
| **`G2` — Physical `Pro` Rack Steering Proof** | Phase 1–2 (`Card E1`) | Printed `pro_steer_bridge`, bellcrank knuckles, and `pro_steer_rack` on `#1` `row 0` (`Y = 6.25 mm`), hand-driven via `#15`. | Smooth lock-to-lock travel: **`>= ±25°`** (`Ø36` wheel, `<= 54 cm` turning circle) and **`>= ±21°`** (`Ø50` wheel, `<= 62 cm` circle) with `>= 1.8 mm` tire-to-hull gap. |
| **`G3` — `Momentum` Impulse, Lift & Torque Proof** | Phase 1–2 (`Cards E1–E2`) | Bench load-cell / stopwatch log on `mom_jet_valve`, `mom_bellows_hinge`, and `#64` `mom_pullback_band` driving `row 8` `gear_spur_z10` with `pro_axle_keeper` installed. | Zero tooth skip or axle pop-out across `50` launches at **`65–80 N·mm`** burst torque; measured balloon impulse `0.28–0.48 N·s`; bellows lifts **`100 g`** tub payload to `>= 45°`. |
| **`G4` — Matched-CG Sealed Dummy Brick & Sponson Float** | Phase 1–2 | Sealed printed `4×4×3 TU` dummy brick weighted with internal sand/steel shot to **`115 g`** at the exact Card `F` CG (`z_cg = 24 mm`, **zero loose coins**), tested on all 9 craft + water tank with `2× Ø60×125 mm` foam-noodle sponsons. | Axles spin freely (`< 0.5 mm` sag); Dump Truck & Tractor meet static tip-over margins (`>= 1.4×`); Catamaran floats at **`<= 55%` draft** (`>= 25 mm` freeboard to deck) and stays upright at `20°` heel. |
| **`G5` — Thermal Soak & Stall Cutoff Gate** | Phase 2–3 (`Card F` `PETG`) | `Card F` printed in **`PETG`** (`HDT ~70 °C`), loaded with `1×` or `2×` gearmotor + `1.85 A` PTC + H-bridge under `15 min` locked-rotor / stall cycle at `25 °C` ambient. | Exterior touch temperature **`< 45 °C`**; internal motor-mount boss **`< 55 °C`** (`0` softening on adjacent `PLA` keel); zero MCU brown-out resets. |
| **`G6` — `1.0 m` Drop & `F2` Fragment Re-Screen** | Phase 1–3 | Assembled craft (`Snap`, `Momentum`, and `115 g`-loaded `Mech`) dropped `5×` from `1.0 m` onto vinyl-over-concrete (`ASTM F963-23` §8.7 reference protocol). | Zero detached or fractured piece fits inside the `Ø31.75 × 57.1 mm` `S1` small-parts cylinder; tool-locked battery door remains shut. |
| **`G7` — `500-Cycle` & `40 °C` Creep Endurance** | Phase 1 (`F1` Coupon) | `c_jaw_tu01` coupon (printed in `#1` `z=0` pose), `Card D` `0.60 mm` `PETG` fold coupon, and armed `mom_bumper_trigger` (`#32` band). | `c_jaw_tu01` retains **`>= 6.0 N`** pull-out after `500` cycles + `24 h @ 40 °C`; `Card D` shows `0` cracks after `500` folds; ratchet holds `24 h @ 40 °C` without slip. |

---

## 3. Stage 2 (`Pro`) & Stage 3 (`Momentum`, Zero Electronics): `Cards E1 & E2` (Ages `8+`)

### 3.1 `Pro` `row 0` Steering Linkage & Raked Bike Fork (`Card E1`)

- **4-Wheel Ackermann-Approximated Rack Linkage (`row 0`, `Y = 6.25 mm`):**
  - `pro_steer_bridge` (`49.8 × 24.8 × 12.5 mm`) snaps onto `rows 0..1` nose studs (`z = 12.50 mm`), placing vertical `Ø7.00 mm` kingpin bores at **`(X = ±18.75 mm, Y = 6.25 mm)`** above the axle plane.
  - `pro_steer_knuckle_L/R` carry a **`12.50 mm` (`1.0 TU`) kingpin-to-wheel-center offset** (wheel centers at `X = ±31.25 mm`, matching Snap track) and a **`10.0 mm` rearward tie-rod arm** (`Y = 16.25 mm`, `8°` inward Ackermann toe).
  - `pro_steer_rack` (`62.5 × 12.5 × 6.2 mm`, `±4.40 mm` lateral travel along `Y = 16.25 mm`) meshes directly with a `gear_spur_z10` on `#15` steering stem (`row 2`, `Y = 31.25 mm`, `18.75 mm` pitch-to-rack engagement) in `Pro`, and with the `mech_servo_9g` pinion horn in `Mech`.
  - **Verified Lock & Turning Circle (`L = 100.0 mm` wheelbase, `62.5 mm` track):**
    - `#4` (`Ø36.0 × 12.3 mm`) at **`±26.0°` hard stop:** `+4.17 mm` nose gap (`#7` stays `24.8 mm` wide!), `+7.41 mm` hull/stud shoulder gap -> **`51.9 cm` outer turning circle**.
    - `#5` (`Ø50.0 × 12.3 mm`) at **`±22.0°` auxiliary stop:** `+2.87 mm` nose gap, `+2.08 mm` shoulder gap -> **`59.6 cm` outer turning circle**.
- **Motorbike Steerable Raked Fork (`pro_fork_rake_adpt`):** Snaps into `#2`'s front vertical bore, tilting the front fork axis **`15.0°`** with **`+6.0 mm` positive mechanical trail** so pushed bikes and powered Cargo Trikes self-center cleanly.

### 3.2 Honest Stage-3 `Momentum` Physics & Child-Safety Controls (`Cards E1 & E2`)

All performance figures below are analytical conservation-of-momentum / energy bounds; prototype bench logs in Gate `G3` govern final catalog copy:

| Module | Card | Stored-Energy Mechanism | Analytical Physics Bound (Recomputed) | Built-In Child Safety Controls (`Ages 8+`) |
| :--- | :--- | :--- | :--- | :--- |
| **`mom_pullback_band`** | `E1` | `#64` rubber band (`89 × 6.4 mm`) routed over `R = 4.0 mm` rounded fairleads onto a `Ø12.0 mm` D-spool + `LAY_FLAT` freewheel pawl (`2.0 mm` tooth depth) driving `row 8` `Z10:Z10`. | Elastic energy **`0.22–0.38 J`**; initial axle torque **`35–65 N·mm`**; hard-floor run **`2.0–3.8 m`** (`110 g` craft, `C_rr ≈ 0.045`) with freewheel coast after unwind. | Band wholly enclosed inside `4×4×3 TU` Core + keel channel (`0` exposed snap path); `~50–100` cycle replacement interval noted. |
| **`mom_bumper_trigger`** | `E1` | Mechanical **`IF-contact-THEN-release`** front plunger + `LAY_FLAT` over-center ratchet (`>= 2.0 mm` tooth engagement) holding a `#32` band. | Releases `0.15–0.25 J` on `>= 1.5 N` bumper contact to auto-tip `#11` Dump Tub or close `#12` Scoop. | Finger-safe pinch stops (`< 4 mm` or `>= 12 mm` at `55°` dump stop); `24 h @ 40 °C` creep gate (`G7`). |
| **`mom_slam_launcher`** | `E1` | Stationary tabletop base + **captive** `35 mm`-stroke `#64`-band push rod (`PETG` recommended) impacting `#1`'s rear cross-tie. | Transfers **`0.15–0.25 J`** (`v_0 ≈ 1.6–2.1 m/s` on `100 g` craft -> `2.5–4.0 m` dash) with zero onboard engine mass. | **Plunger is non-detachable (captive stop pin)** — cannot launch free projectiles; kinetic energy `< 0.25 J`. |
| **`mom_jet_valve`** | `E2` | Upright-printed smooth balloon collar + slide-shut valve + 3 snap-in convergent nozzles (`Ø3.0`, `Ø4.5`, `Ø6.0 mm`). | `9"–11"` balloon (`4–6 L` air, `ΔP ≈ 2–3 kPa`) carries **`0.28–0.48 N·s` total impulse**:<br>• `Ø3.0 mm`: `2.5–4.5 gf` (`0.025–0.045 N`) for `7–10 s`<br>• `Ø4.5 mm`: `4.5–8.0 gf` (`0.045–0.080 N`) for `4.0–6.5 s` (`1.2–2.5×` hard-floor drag)<br>• `Ø6.0 mm`: `8.0–14.0 gf` (`0.08–0.14 N` peak) for `2.5–3.8 s` (`2.0–3.5×` drag). | **Printed mouthpiece deleted** (hygiene + small-part risk; inflate by hand pump or direct neck); carries mandatory **`16 CFR 1500.19(b)(2)` latex balloon warning**. |
| **`mom_bellows_hinge`** | `E2` | `4×4 TU` hinged clamshell with **`10°` pre-angled start stop** and **`18 mm` folding side curtains** preventing lateral balloon blowout under `#11` Tub. | Effective patch `~12.5 cm²` at `1.5–3.0 kPa` -> **`190–380 gf` (`1.9–3.7 N`)** normal force (`47–93 N·mm` torque at `r = 25 mm`). **Rated max `#11` payload: `100–120 g`** (`0°→10°` cos-load peak respected). | Low-pressure air (`<= 3 kPa`, zero liquid/syringes); `12 mm` minimum finger-clearance stops on clamshell hinge. |
| **`mom_flywheel_core`** | `E2` | `150.0 mm` `LAY_FLAT` toothed rip-cord rack driving a **`2:1` compound step-up (`gear_spur_z20` -> `gear_spur_z10`)** into a **1-piece solid printed rotor (`Ø48 × 10 mm`, `~22 g`, `100%` infill)**. | `1.5 m/s` hand pull gives **`~1,800–2,200 RPM`** (`v_tip ≈ 4.5–5.5 m/s`, `E_rot ≈ 0.14–0.21 J`) for smooth flywheel-drive tabletop coasters & Helicopter turbine spin-up. (**Solo self-balancing gyro bike claim deleted.**) | **Zero loose coins**; rotor is 100% enclosed inside a pin-locked `2.0 mm` `4×4×3 TU` shroud (`< 3.0 mm` vent slots); overhead neck-height zip-lines prohibited (`<= 300 mm` breakaway tabletop guide tether only). |

### 3.3 Verified `<= 170.0 × 170.0 mm` Placements for `Card E1` & `Card E2` (`mm`)

- **`Card E1` — `Pro` Steering, Axle Keepers, Band Core, Bumper Trigger & Slam Launcher (`14` items, `169.1 × 149.3 mm` outer, `56.6%` box density):**
  - `mom_band_core_tray`: `(3.0, 3.0, 49.8, 49.8)` | `mom_band_core_lid`: `(57.8, 3.0, 49.8, 49.8)` | `mom_band_spool_pawl`: `(3.0, 117.4, 26.0, 26.0)`
  - `mom_slam_base`: `(112.6, 3.0, 36.0, 62.3)` | `mom_slam_plunger`: `(70.3, 70.3, 76.0, 18.0)` | `mom_bumper_trigger`: `(3.0, 57.8, 62.3, 24.8)`
  - `pro_steer_bridge`: `(3.0, 87.6, 49.8, 24.8)` | `pro_steer_rack`: `(153.6, 3.0, 12.5, 62.5)` | `pro_steer_knuckle_L..R`: `(34.0, 117.4, 18.0, 24.8)`, `(57.0, 128.3, 24.8, 18.0)`
  - `pro_fork_rake_adpt`: `(127.8, 93.3, 27.8, 24.8)` | `pro_axle_keeper_x2`: `(127.8, 123.1, 36.0, 14.0)` | `gear_spur_z10_a..b`: `(57.8, 93.3, 30.0, 30.0)`, `(92.8, 93.3, 30.0, 30.0)`
- **`Card E2` — Balloon Jet, `10°` Bellows & Shrouded `2:1` Flywheel Core (`9` items, `168.8 × 157.4 mm` outer, `66.0%` box density):**
  - `mom_ripcord_rack_150`: `(3.0, 3.0, 150.0, 12.0)` | `gear_spur_z20`: `(3.0, 20.0, 55.0, 55.0)` | `mom_flywheel_rotor`: `(117.8, 20.0, 48.0, 48.0)`
  - `mom_flywheel_tray`: `(57.8, 104.6, 49.8, 49.8)` | `mom_flywheel_lid`: `(112.6, 104.6, 49.8, 49.8)`
  - `mom_bellows_base`: `(63.0, 49.8, 49.8, 49.8)` | `mom_bellows_leaf`: `(3.0, 80.0, 49.8, 49.8)`
  - `mom_jet_valve_body`: `(63.0, 20.0, 49.8, 24.8)` | `mom_nozzle_tree_x3`: `(117.8, 73.0, 44.0, 18.0)`

---

## 4. Stage 4 (`Mech`, Ages `10+`): `Card F` Drop-In Robotics Architecture (`PETG` Mandatory)

### 4.1 Datasheet-Verified Internal Packaging Audit (`3 TU` Envelopes)

1. **`mech_brain_mcu` (`4×4×3 TU` = `49.8 × 49.8 × 37.5 mm`, internal cavity `45.8 × 45.8 × 33.5 mm`):**
   - **Single Frozen Onboard Battery (`z_cav = 0.0 .. 6.5 mm`):** Protected **`3.7 V` nominal / `4.20 V` charge** `602535` LiPo pouch (`35.0 × 25.0 × 6.5 mm`, `600 mAh`, integrated overcharge/overdischarge/short-circuit PCM, `IEC 62133` cell) inside a bottom sub-bay closed by `mech_bat_door_screw` with a **captive `M2.5` screw (`ASTM F963-23` §4.25 tool-locked battery access)**. *Chemistry lock:* `4.20 V` single-cell LiPo matches standard onboard `4.20 V` linear USB-C charge ICs; **`3.2 V` `LiFePO4` cells are strictly prohibited on `4.2 V` charge pads**. (An optional off-board `3×AAA NiMH` battery trailer connects via a diode-OR `JST-PH` power port that bypasses the `4.2 V` LiPo charger.)
   - **Manufactured Carrier PCBA (`mech_carrier_pcb_38x38`, `38.0 × 38.0 × 1.6 mm` at `z_cav = 8.5 .. 10.1 mm` above `2.0 mm` vented divider):** Explicitly budgeted as a **custom manufactured PCBA line item** (zero user soldering), carrying female socket strips for a `21.0 × 18.0 × 4.5 mm` pre-certified Wi-Fi/BLE MCU stamp (`z_cav = 10.1 .. 14.6 mm`, `USB-C` facing aft/side through a `12 × 7 mm` bezel with unobstructed `25 mm` plug corridor), dual low-voltage H-bridge IC, **two right-angle 3-pin servo headers (`1` steering/accessory + `1` spare)**, `I²C` IMU footprint, **`12.0 × 10.0 mm` copper-free RF antenna keep-out** under the top-front `PETG` wall, and **`11.5 mm` vertical connector + `>= 8.0 mm` wire-bend headroom** (`z_cav = 14.6 .. 26.1 mm`, leaving **`+7.4 mm` top cooling air gap** inside `33.5 mm`!).
   - **Worst-Case Current Budget & Brown-Out Immunity:** Dedicated `500 mA` low-dropout `3.3 V` logic regulator + `470 µF` holdup rail isolates MCU Wi-Fi peaks (`0.32 A`) from actuator droop; raw `V_bat` (`3.7 V`) feeds motors and servos through a **`1.85 A` hold resettable PTC fuse**. Simultaneous worst-case draw (`0.32 A` Wi-Fi TX + `0.60 A` single gearmotor stall + `0.55 A` firmware-endpoint-clamped `9g` servo = **`1.47 A < 1.85 A` hold**, `< 2.5C` on `600 mAh` cell).
2. **`mech_drive_gearmotor` (`4×4×3 TU`, cavity `45.8 × 45.8 × 33.5 mm`):**
   - **Baseline (`mech_drive_1x`):** One transverse `12 × 10 × 24 mm` micro metal gearmotor (`6 V` class run at `3.7 V`, `150–300 RPM`) + `9.5 mm` `LAY_FLAT` D-shaft-to-`Pro` coupler (`34.0 mm <= 45.8 mm` X cavity) driving `gear_spur_z10` at `z_pto = 31.25 mm` (`+1.75 mm` lid clearance).
   - **Skid-Steer Variant (`mech_drive_2x` Optional Pack):** Two `12 × 10 × 24 mm` motors mounted **side-by-side in `Y`** (`27.0 mm <= 45.8 mm` Y, `34.0 mm <= 45.8 mm` X, H-bridge current-limited to `0.50 A/ch`), shipped with **`2× 38.0 mm` split `shaft_drive` half-axles + `2× gear_spur_z10`** so differential Tractor/Rover builds require no extra cards.
3. **`mech_servo_9g` (`2×4×3 TU` = `24.8 × 49.8 × 37.5 mm`, cavity `20.8 × 45.8 × 33.5 mm`):**
   - Holds a datasheet-true `9g`-class micro servo (`12.6 mm` width × `32.5 mm` mounting-ear span × `29.0 mm` height to spline tip) upright with `+8.2 mm` X, `+13.3 mm` Y, and `+4.5 mm` Z clearance, plus a `LAY_FLAT` spline-to-`Pro` horn.

### 4.2 Browser Connectivity (`Wi-Fi WebSocket` Primary) & Verified `Card F` Packing

- **Cross-Platform `ToyVentor World` Transport (iOS + Android + Desktop):** Primary control uses **local Wi-Fi SoftAP / LAN mDNS + WebSocket (`ws://`)**, which works natively in **iOS Safari, iPadOS, Android Chrome, and Desktop browsers** with zero app install and zero cloud PII. `WebBluetooth` (`navigator.bluetooth`) is supported only as an **optional secondary transport on Android/Desktop Chromium** (explicitly documented as unavailable in iOS Safari).
- **Honest Marine, Air & Land Physics in `Mech`:**
  - **Catamaran Airboat:** Uses the `2× Ø60 × 125 mm` closed-cell foam-noodle sponsons (`~424 gf` buoyancy at `60%` draft vs `~255 g` total Mech boat mass), above-water stern air-fan (`#6` inside a printed `Ø76 mm` finger-safe duct) + servo air-rudder (`zero` submerged shaft seals), with `mech_brain_mcu` elevated on a `1 TU` splash riser (`>= 38 mm` above waterline).
  - **Aeroplane & Helicopter:** Strictly **ground-taxiing + motorized rotor/winch/light action** (`~240 g` printed FDM + battery mass cannot achieve free flight; spec makes zero flight claims).
- **Verified `Card F` `PETG` Layout (`8` items, `165.4 × 119.8 mm` outer `<= 170.0 mm`, `50.4%` box density):**
  - `mech_brain_tray`: `(3.0, 3.0, 49.8, 49.8)` | `mech_brain_lid`: `(57.8, 3.0, 49.8, 49.8)` | `mech_bat_door_screw`: `(57.8, 57.8, 42.0, 30.0)`
  - `mech_drive_tray`: `(112.6, 3.0, 49.8, 49.8)` | `mech_drive_lid`: `(3.0, 57.8, 49.8, 49.8)`
  - `mech_servo_tray`: `(104.8, 57.8, 49.8, 24.8)` | `mech_servo_lid`: `(104.8, 87.6, 49.8, 24.8)` | `mech_dshaft_horn_set`: `(57.8, 92.8, 38.0, 24.0)`

---

## 5. Complete 9-Craft × 4-Stage Progression Matrix (Post-Review Verified)

| Craft | Stage 1: `Snap` (`3+`, Cards `A–D`) | Stage 2: `Pro` (`8+`, `+ Card E1` / Pro Gears) | Stage 3: `Momentum` (`8+`, `+ Cards E1–E2`) | Stage 4: `Mech` (`10+`, `+ Card F` `PETG`) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Race Car** | Push coupe/formula (`z_axle = 6.25 mm`, fixed `row 0` barbell) | `row 0` hand rack-and-pinion steering (`±26°`, `51.9 cm` circle) | `Ø6.0` balloon sprint dragster (`2–3.5×` drag) or `#64` band racer (`2–3.8 m`) | Rear gearmotor (`25.00 mm` PTO) + front `9g` servo proportional rack steering |
| **2. Dump Truck** | Push truck + manual `55°` `#11` `4×4` tipping tub | Crank-worm bed tipper or `360°` `#14` crane | `#64` band drive + `10°` curtained balloon bellows (`<= 120 g` lift) or `IF-bump` auto-dump | Rear gearmotor + `9g` servo remote-tipping `#11` tub stacked on Core-top hinge |
| **3. Farm Tractor** | `4.01°` forward-raked tractor + front `Y=0.1` loader (`<= 75 g` scoop) | `row 0` rack steering (`±26°`) + geared rear PTO implement | `#64` band climber + `IF-bump-then-scoop` loader (`<= 150 g` scoop with Core ballast) | Baseline `1×` rear gearmotor + servo loader, or `2×` side-by-side skid-steer variant |
| **4. Trailer** | Fifth-wheel (`#14`) towed flatbed / tipper / `#9` ramp hauler | Geared `360°` slewing crane trailer | `10°` balloon-bellows tipper or dock-bump auto-unloader | Optional `3×AAA NiMH` auxiliary power car + hitch-cabled servo tipper |
| **5. Bike / Trike** | Kickstand inline push bike **&** self-standing 3-wheel Cargo Trike (`Card A`) | `15°` raked `+6 mm`-trail steerable fork (`pro_fork_rake_adpt`) | Shrouded `2:1` printed-flywheel Cargo Trike coaster or captive `mom_slam_launcher` dash | Motorized Cargo Trike (`1×` rear gearmotor + front raked handlebar servo) |
| **6. Aeroplane** | Swoosh plane + free-spin `Ø68` nose prop (`+4.75 mm` ground clear) | Axle-driven taxiing nose prop | `#64` band taxiing prop plane or balloon reaction jet | Wi-Fi RC ground-taxiing prop plane with steerable nose/tail gear (non-flying) |
| **7. Catamaran** | Tabletop dry-play ski catamaran (`2× #10` runners) | Hand-cranked `#5` paddlewheels or stern air-prop | Foam-noodle waterborne balloon air-jet boat (`~424 gf` buoyancy at `60%` draft) | Foam-noodle Wi-Fi RC airboat with ducted stern `#6` fan + servo air-rudder |
| **8. Helicopter** | Skids + `z=96 mm` 4-blade main rotor (`+15.5 mm` over Kip) + `+10°` tail rotor | Coupled main + tail rotor gear train | Enclosed `2:1` rip-cord turbine spin-up + manual rescue basket | Motorized dual-rotor ground ship + servo rescue hoist |
| **9. Space Shuttle** | Orbiter + `PETG` `#18` `Book-Fold` payload doors | Geared satellite deployment arm | Captive `mom_slam_launcher` runway launch + `IF-bump` spring payload doors | Wi-Fi mission orbiter with programmed servo bay doors & arm sequence |
