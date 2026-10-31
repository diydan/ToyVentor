# Phase 4 Per-Vehicle Readiness Audit (`app-continuation-spec.md` §5.1–§5.3)

## 1. Entry-Gate Rules & Invariants

Per [`app-continuation-spec.md`](app-continuation-spec.md) §4.5 and §5.1–§5.3:

1. **Four mandatory entry gates per vehicle (`ready === true` iff all four pass):**
   - **`partVerified`**: PartSpec v2 geometry is `verified`, passes `preprint_check` slicer validation, has a conforming assembly, and ships `.stl` assets on disk alongside a validated `seed/toys/seed-*.json` board (`validateToy(seedToy) === []`).
   - **`missionShipped`**: Recommended STEM mission(s) exist in shipped `Lab 1`–`Lab 6` or world levels (`src/features/game/world/runtime/world.ts`).
   - **`artFinal`**: Bespoke `24×24` vector SVG silhouette ships in [`src/lib/toyIcon.ts`](../../src/lib/toyIcon.ts) and [`src/features/game/world/ToyMiniIcon.tsx`](../../src/features/game/world/ToyMiniIcon.tsx) (`size="mini"` `20×20` and `size="tile"` `44×44`).
   - **`saveShapeVerified`**: Reuses the flattened `localStorage` build key (`toyforge:build:v1:{id}` `Placement[]` in [`src/lib/builds.ts`](../../src/lib/builds.ts)), `toyforge:active-toy:v1`, and `toyventor.toy/1` contract (`type: "vehicle"` in [`shared/toycontract.ts`](../../shared/toycontract.ts)) with zero parallel payload paths.
2. **`Star Scout` (`seed-figure`) exclusion & grandfathering (§4.5, §5.1, §5.3):**
   - `Star Scout` is an existing bundled seed toy ([`seed/toys/seed-figure.json`](../../seed/toys/seed-figure.json)) and is **never** listed in `RANKS` or presented as a locked/new rank unlock.
   - Any device with `activeToyId === "seed-figure"`, a saved build, a Muse skin, a reveal, a saved `seed-figure` entry, or `progression.unlockedIds` containing `"seed-figure"` keeps `Star Scout` enabled immediately across roster updates and `Reset XP`.
3. **No placeholder or unverified geometry (§4.5, §5.1):**
   - Neither `totalXp` nor parent `Sandbox Unlock All` exposes an entry with `ready === false`. Vehicles awaiting Wave 10 (`Cards A–D`) or Stage 4 (`Card F`) physical/CAD promotion remain held back in [`src/lib/vehicleReadiness.ts`](../../src/lib/vehicleReadiness.ts) until promoted with verified STL assets and a bundled `seed/toys/seed-*.json`.

---

## 2. Per-Vehicle Readiness Table (Ranks 2–6)

| Rank / XP | Canonical Name (`id`) | PartSpec & App Set Parts | Shipped STEM Missions | SVG Variant | Rarity Source | Flattened Save & Contract | §5.1 Gate Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Rank 2**<br>`250 XP`<br>*Workshop Builder* | **Hauler Truck**<br>(`seed-truck`) | **W9 Verified:** `veh_truck_chassis`, `veh_truck_bed_cover`, `veh_cab_roof_cover`, `veh_car_hood_cover`, `veh_steering_wheel`, `veh_wheel_offroad` (`hauler_truck_v2_covers_and_offroad_wheels`)<br>**App sets:** `racer-bull-bar`, `racer-roof-rack`, `racer-light-bar`, `veh-car-hood-cover`, `veh-wheel-sport`, `brick-s-2x2` | `lab1.bridge`, `lab1.balance`, `garden.bridge` (`Lab 1: Bridges`) | `truck` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-truck` + `toyventor.toy/1` (`vehicle`) | **`ready: true`** |
| **Rank 2**<br>`250 XP`<br>*Workshop Builder* | **Motor Scooter**<br>(`seed-scooter`) | **W9 Verified:** `veh_scooter_frame`, `veh_scooter_fairing`, `veh_handlebar_fork`, `veh_wheel_moto` (`motor_scooter_v2_inline_2wheel`)<br>**App sets:** `racer-light-bar`, `racer-wheel`, `veh-wheel-sport`, `dome-s-2x2`, `glow-capsule` | `lab1.measure`, `lab4.circuit` (`Lab 1: Bridges`) | `scooter` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-scooter` + `toyventor.toy/1` (`vehicle`) | **`ready: true`** |
| **Rank 3**<br>`600 XP`<br>*Gearhead* | **Sport Motorbike**<br>(`seed-motorbike`) | **W9 Verified:** `veh_scooter_frame`, `veh_scooter_fairing`, `veh_moto_cowling`, `veh_handlebar_fork`, `veh_wheel_moto` (`sport_motorbike_v2_inline_2wheel`)<br>**App sets:** `veh-car-hood-cover`, `veh-wheel-sport`, `racer-twin-exhaust`, `racer-spoiler`, `gear-spur-z10` | `lab2.lift`, `lab2.logic`, `junk.lift` (`Lab 2: Machines`) | `motorbike` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-motorbike` + `toyventor.toy/1` (`vehicle`) | **`ready: true`** |
| **Rank 3**<br>`600 XP`<br>*Gearhead* | **Loader Tractor & Trailer**<br>(`seed-tractor`) | **W10 Cards A–B (pending promotion):** `kit_keel_base`, `kit_clevis_spine`, `kit_wheel_med`, `kit_wheel_giant`, `kit_scoop_blade`, `kit_tilting_tub`, `kit_turntable`, `kit_barbell_shaft`, `kit_spinner_pin` | `lab2.lift`, `lab4.lever` (`Lab 2: Machines`) | `tractor` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-tractor` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Awaits W10 STL export + Gate G4 tip-over proof)* |
| **Rank 4**<br>`1,100 XP`<br>*Sky & Sea Pilot* | **Prop Aeroplane**<br>(`seed-aeroplane`) | **W10 Cards A+C (pending promotion):** `kit_keel_base`, `kit_aero_wedge`, `kit_rotor_blade`, `kit_foil_wing`, `kit_spinner_pin`, `kit_wheel_med` | `lab4.lever`, `lab5.code` (`Lab 4: Levers and Lights`) | `aeroplane` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-aeroplane` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Awaits W10 STL export + slicer pass)* |
| **Rank 4**<br>`1,100 XP`<br>*Sky & Sea Pilot* | **Catamaran Boat**<br>(`seed-catamaran`) | **W10 Cards A+C (pending promotion):** `kit_keel_base`, `kit_skid_runner`, `kit_aero_wedge`, `kit_yoke_hbar`, `kit_foil_wing` | `lab3.raft` (`Lab 3: Water`) | `catamaran` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-catamaran` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Awaits W10 STL export + Gate G4 float proof)* |
| **Rank 5**<br>`1,800 XP`<br>*Aero Captain* | **Rescue Helicopter**<br>(`seed-helicopter`) | **W10 Cards A–C (pending promotion):** `kit_keel_base`, `kit_skid_runner`, `kit_turntable`, `kit_aero_wedge`, `kit_barbell_shaft`, `kit_rotor_blade`, `kit_clevis_spine`, `kit_scoop_blade` | `lab5.code`, `lab5.pattern` (`Lab 5: Code and Patterns`) | `helicopter` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-helicopter` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Awaits W10 STL export + Gate G1 rotor sweep)* |
| **Rank 5**<br>`1,800 XP`<br>*Aero Captain* | **Space Shuttle**<br>(`seed-shuttle`) | **W10 Cards A–D (pending promotion):** `kit_keel_base`, `kit_aero_wedge`, `kit_foil_wing`, `kit_booster_pod`, `kit_tilting_tub`, `skin_cargo_shroud`, `kit_wheel_med` | `lab4.circuit`, `lab5.pattern` (`Lab 5: Code and Patterns`) | `shuttle` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-shuttle` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Awaits W10 STL export + Gate G7 500-fold coupon)* |
| **Rank 6**<br>`2,700 XP`<br>*Mech Inventor* | **Bolt Power Mech**<br>(`seed-mech`) | **Stage 4 Card F PETG + W11 (pre-CAD):** `mech_brain_tray`, `mech_brain_lid`, `mech_bat_door_screw`, `mech_drive_tray`, `mech_drive_lid`, `mech_servo_tray`, `mech_servo_lid`, `mech_sill_duct`, `pro_steer_bridge`, `pro_steer_rack` | `lab5.code`, `lab6.clean`, `lab2.logic` (`STEM Labs 1 to 6`) | `mech` | `shared/pack.ts` `rarityForPart` (`stat.value` `1..3`) + deterministic XP Track A | `toyforge:build:v1:seed-mech` + `toyventor.toy/1` (`vehicle`) | **`ready: false`**<br>*(Pre-CAD Pass 4g robotics spec + Gate G5 soak)* |

---

## 3. Name Alignment & Alias Collapse (`§5.2`)

[`canonicalToyName`](../../src/lib/toyRoster.ts) and [`normalizeSavedToyIdentity`](../../src/lib/toyRoster.ts) collapse all built-in content/art/spec aliases onto canonical IDs so alternate names never create duplicate roster rows:

| Canonical ID | Canonical Roster Name | Collapsed Content / Spec Aliases |
| :--- | :--- | :--- |
| `seed-kip` | `Kip` | `Kip (Modular Hero)` |
| `seed-car` | `Red Racer` | `Roadster Racer`, `Race Car`, `Formula / GT Race Car` |
| `seed-figure` | `Star Scout` *(grandfathered only)* | `Space Scout` |
| `seed-truck` | `Hauler Truck` | `Dump / Tow Truck`, `Dump Truck`, `Tow Truck`, `Heavy Hauler Truck` |
| `seed-scooter` | `Motor Scooter` | `Step-Through Motor Scooter`, `City Scooter`, `Snap Scooter` |
| `seed-motorbike` | `Sport Motorbike` | `2-in-1 Sport Motorbike`, `Motorbike & Cargo Trike`, `Inline Motorbike`, `Cargo Trike` |
| `seed-tractor` | `Loader Tractor & Trailer` | `Farm / Loader Tractor`, `Modular Trailer`, `Loader Tractor`, `Tractor & Trailer` |
| `seed-aeroplane` | `Prop Aeroplane` | `Prop / Jet Aeroplane`, `Swoosh Aeroplane`, `Aeroplane` |
| `seed-catamaran` | `Catamaran Boat` | `Catamaran / Speedboat`, `Ski Catamaran`, `Catamaran Airboat`, `Speedboat` |
| `seed-helicopter` | `Rescue Helicopter` | `Twin-Blade Rescue Helicopter`, `Helicopter`, `Heli Rescue Craft` |
| `seed-shuttle` | `Space Shuttle` | `Space Shuttle Orbiter`, `Orbiter`, `Shuttle Orbiter` |
| `seed-mech` | `Bolt Power Mech` | `Bolt Mech`, `Stage 4 Mech`, `Power Core Mech` |

---

## 4. Locked-Card One-Line Guidance & Grandfathering (`§5.3`)

Every locked card uses [`formatLockedVehicleGuidance`](../../src/lib/vehicleReadiness.ts) to state **what to earn**, **where to earn it**, and **what unlocks** in a single plain-English sentence:

- **At `0 XP`**:
  - `Earn 250 XP in Lab 1: Bridges to unlock Hauler Truck.`
  - `Earn 250 XP in Lab 1: Bridges to unlock Motor Scooter.`
  - `Earn 600 XP in Lab 2: Machines to unlock Sport Motorbike.`
- **With partial progress (e.g. `160 XP`)**:
  - `Earn 90 more XP (250 XP, Rank 2) in Lab 1: Bridges to unlock Hauler Truck.`
- **Non-regression / grandfathering**:
  - [`isVehicleGrandfathered`](../../src/lib/vehicleReadiness.ts) and [`mergePhase4Roster`](../../src/lib/toyRoster.ts) keep any vehicle immediately enabled when `activeToyId`, a non-empty `toyforge:build:v1:{id}` placement list, a Muse skin, a reveal, a saved seed copy, or `progression.unlockedIds` already references it, surviving `Reset XP` and device restore.
