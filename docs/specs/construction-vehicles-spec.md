# Construction vehicles and implements: bulldozer, excavator and friends (draft 1, 2026-11-03)

**Status (updated 2026-11-03 13:45 CET):** the two road-roller parts are in the catalog (commit `0418f2e`) and the roller is drawn on the Workshop's third tab, the Yard bench; the bulldozer has a lift sweep (section 8) but no CAD; everything else here is still a proposal. Section 9 is the progress table. Nothing here is printed. Asked for by Dan on 2026-11-03: "can we add construction attachments, how would we create a bulldozer and other construction vehicles?". This draft says what the kit already has, how each vehicle would be made from it, what new parts it needs, how we would prove each one is mechanically sound before anyone prints it, and what Dan has to decide.

Labels, as in the Motion spec: **[M]** measured from the repo files, **[E]** an estimate from a stated model, **[?]** not known yet.

## 1. What the kit already does [M]

The catalog (205 parts) already carries most of a construction yard. Everything below is a part that exists today and builds in the 12.5 mm "TU" lattice:

| Job | Existing parts | Where it is specified |
|---|---|---|
| Dump truck | `kit_keel_base` (49.8 x 124.8), `kit_tilting_tub` (4x4 tub, 55 degree stop), `pro_tub_hinge`, giant or medium wheels | craft 2, `flatpack-modular-craft-spec.md` |
| Front loader and snowplow | `kit_clevis_spine` as the loader boom (27.8 x 99.8, 6.4 mm free-bore cheeks), `kit_scoop_blade` (49.8 x 37.3 x 20, the bucket or plough blade, mounts by a 4x3 grid of stud sockets on its underside) | craft 3 (tractor), same spec (its "front C-jaw" is older text: `kit_keel_base` no longer lists a C-jaw connector **[M]**) |
| Crane | `kit_turntable` (49.8 x 49.8 x 8, 360 degree slew, 0.30 mm glide ring) plus a clevis-spine boom | craft 4 (trailer), `progressive-power-system-spec.md` row 4 |
| Big wheels | `kit_wheel_giant` (O50 x 12.3, four crank bores) | craft 3 |
| Drive, steering, power | rack steering (9 parts), PTO and Z10 gears, the pull-back band core, the optional powered add-on (N20 motor, one SG90 servo) | Motion and power specs |

So a tractor with a loader, a dump truck and a crane trailer are not new. What is new is **tracks**, **a wide pushing blade**, **a multi-link digging arm**, and **a standard way to swap implements** so one vehicle takes several attachments.

## 2. The idea: vehicles plus implements

Two kinds of thing, so a child can mix them and the catalog stays small:

- **Carriers** (the vehicle that moves): wheeled carrier (exists: keel plus wheels), tracked carrier (new), and the turntable carrier (a carrier with a slewing deck on top, exists as the crane base).
- **Implements** (what it does): bucket, push blade, plough, ripper, forks, drum, mixer drum, digging arm, crane hook.

**One implement interface.** Measured **[M]**: implements already mount on **stud decks**. `kit_scoop_blade` carries a 4x3 grid of stud sockets (`under_sockets`) and the keel, the turntable and the clevis spine all carry stud grids (`stud_small`, 12.5 mm pitch). So **Implement Interface I1 is the stud deck**: an implement is a part with a 4x3 (or 4x4) socket grid, and a carrier or arm offers a matching stud grid, so the same blade or bucket snaps on anywhere. No new connector kind is needed. The pivots are the **axles** (the keel's `axle_row0`, `axle_row7_*` and `axle_row8_*` free bores) and the clevis cheeks.

## 3. The vehicles

Mass and stability figures are **[E]** from solid-PLA masses in the Motion spec (keel 71 g, giant wheel 26 g old and 21.3 g new, medium wheel 13 g) and have to be replaced by weighed values.

### 3.1 Bulldozer

- **Carrier:** keel plus two track units, one each side. A track unit is a drive wheel and an idler (two O50 giant wheels, 100 mm apart) with a track loop round them.
- **Width [M arithmetic]:** keel 49.8 mm plus two 12.3 mm wheels plus 0.2 mm gaps = **74.8 mm = 6 TU**, so the blade should be **6 TU wide** (a new `kit_dozer_blade`, 74.8 mm), wider than the tracks as on a real dozer.
- **Blade mount:** two push arms (clevis spines or two new beams) pinned to the carrier near the drive axle, so the blade rises and lowers on a hinge; a hand lever, or a tilt rack, sets the height. A real dozer's blade also angles; v1 does not.
- **Track loop length [M arithmetic]:** 2 x 100 mm + pi x 50 mm = **357 mm**, which is 28.6 links at 12.5 mm pitch, so **29 links per side, 58 for the vehicle**.
- **Track options, with a recommendation:**
  1. **Printed link chain**, one link part (12.5 mm pitch, 12.3 mm wide, about 4 mm thick) joined with the existing O6.6 free pin, printed 58 times. Looks right and is repairable. Cost: 58 links and 58 pins per vehicle; needs a sprocket form on the wheel rim or a smooth-rim wheel with a guide lip.
  2. **A flexible belt** (TPU or similar, 357 mm x 12.3 mm, cleats printed on). Fewest parts, but a long thin flexible print is the hardest print in the kit and may not be printable at 0.4 mm without supports. **[?]**
  3. **Wheeled dozer first**: the same carrier on four O50 wheels with the 6 TU blade. No new carrier part, a real dozer silhouette, ready for the tracked version later.
  **Recommendation: ship 3 first, develop 1 next.** A rubber band cannot be the track: the largest standard band in the kit's COTS list (#32) is far too short for a 357 mm loop. **[E]**
- **Steering:** a tracked dozer steers by driving the two sides at different speeds (skid steering). Hand-pushed it just turns in place by hand; powered it needs **two motors**, one per side. The optional powered add-on has **one** N20 motor, so a powered dozer needs a new twin-motor module (see section 6, question 3).

### 3.2 Excavator

- **Carrier:** the tracked carrier or, first, a wheeled one, with `kit_turntable` on top as the slewing deck and a cab (`kit_windscreen` and the seated Kip) on the turntable.
- **Arm:** boom, stick and bucket in series, each joint a pin through clevis cheeks like the dump tub's barrel hinge. The boom can be the existing clevis spine (99.8 mm); the stick another spine or a shorter new beam; the bucket a **narrow dig bucket** (a new `kit_dig_bucket`, about 24.8 mm wide; the 49.8 mm `kit_scoop_blade` is a loader bucket, too wide to dig with).
- **Actuation, by stage:** Snap and Pro are hand-set joints with friction or a ratchet detent; Motion has no excavator (the cores are propulsion); the powered add-on can run **one** joint (the bucket curl or the slew) from its servo. Three powered joints is more than the kit's power module carries. **[E]**
- **Reach [E]:** boom 100 mm plus stick about 75 mm plus bucket about 40 mm gives roughly 200 mm of reach from the slew axis, a stable play envelope for a kit whose base is 75 mm wide.
- **Stability check (static) [E]:** base about 190 g (keel 71 g, tracks about 60 g, cab and Kip about 60 g), arm and bucket 40 g at 90 mm, a 30 g payload at 180 mm, tipping about the front edge of a 150 mm long track: tipping moment about 3,750 g.mm against a restoring moment of about 14,250 g.mm, a safety factor of about 3.8. This is the check the CAD gate must repeat with the real masses.

### 3.3 Wheel loader and backhoe

The tractor with the loader boom already is a front loader. A **backhoe** is the same tractor with a small excavator arm on the rear C-jaw or a rear turntable: no new carrier, one narrow bucket and one arm. Build it after the excavator arm exists.

### 3.4 Road roller

The simplest new vehicle and a good first one: two **smooth drums** (a new `kit_drum_roller`, O50 x 24.8, a 2 TU wide smooth drum on the same hub) in place of the front wheels, giant wheels at the back, the keel and the existing rack steering. One new part, no new mechanism. High play value (it "flattens" things in the app).

### 3.5 Forklift

A mast of two vertical beams, a sliding carriage with two forks (new `kit_fork`, two per vehicle), lifted by a hand crank through a Z10 pinion on a short rack (the steering rack and pinion are the right pattern), a counterweight at the rear. New parts: forks, a carriage, a mast beam pair. Mid-complexity; needs the rack-lift mechanism proved before it is promised.

### 3.6 Concrete mixer and crane truck

The mixer is a drum on the turntable (new `kit_mixer_drum`), spun from the axle through the existing PTO gear: a showcase for the one-way clutch and PTO already built. The crane truck is the existing crane on a wheeled carrier. Both are later.

## 4. Where they sit on the ladder

The decided ladder is Snap, Motion, Pro (powered module is an optional Pro add-on, `Card F`, ages 10 and up). Proposed placement:

| Vehicle | Snap (3+) | Motion (8+) | Pro (8+) | Powered add-on (10+) |
|---|---|---|---|---|
| Road roller, wheeled dozer | static build, hand pushed | pull-back band drives it | rack steering | drive and steer |
| Tracked dozer | static | pull-back band (straight run only) | hand-pushed, blade lever | twin-motor skid steer (needs the new module) |
| Excavator | static, fixed arm | none | hand-set joints, slewing deck | one powered joint |
| Forklift, mixer | static | mixer spins from the axle, forklift none | hand-crank lift | none planned |

## 5. How we would create them, in order

1. **Spec and parts list** (this document, then a Dan decision per section 6).
2. **CAD in `toyventor_kitcard.py`** as a new wave (suggested `W14`, Cards G and H), written the same way as the existing kit parts: new parts registered in the catalog, each passing the **part gate** (`toyventor_parts.py`: watertight, one body, support-free, minimum walls) and the geometry-only print check, before any card layout or viewer work. Lesson from the band and jet pass: the pose-sweep gate (`verify_gate_g1`) and the part gate are different gates; run both.
3. **Mechanical soundness checks, written before the parts**, using the methods that have already caught real defects here:
   - boolean overlap sweeps with the real STLs across each joint's full range, in 1 degree steps (the arm and blade must clear the carrier, the cab, the tracks and each other everywhere in their travel);
   - linkages solved from the real hardpoints (the way the rack steering is), not drawn at hard-coded angles; for the arm that is a forward-kinematics model of the three joints with a reach and lift envelope read off the CAD;
   - one-way mechanisms checked for **direction**, not just overlap (a sweep with no overlap says nothing about which way a clutch locks);
   - rolling and steering kinematics: no-slip wheels (done for the Truck) plus **skid-steer** for tracks (the instantaneous centre of rotation from the two side speeds), tested numerically as the Truck's keyboard driving already is;
   - a static stability number with the real masses (section 3.2), and a print-and-test plan whose predictions are written down first, as in section 10 of the Motion spec.
4. **A viewer:** these vehicles do not belong in the Truck bench. The Workshop's benches are modules on a shared stage now, so the natural home is **a third bench, "Yard"** (`yard-bench.js`, mounted with the same `mountXBench` shape), with a vehicle chooser, the same blueprint look and the same keyboard driving. Tracked vehicles need the driving model extended with a differential-drive step; the pure model in `truck-drive.js` is the place, with its unit tests.
5. **Print tests**, in the order of risk: roller drum, 6 TU blade on the wheeled carrier, a short track chain test strip, the arm joints, then the full tracked vehicles.

## 6. Decisions for Dan

1. **Order.** **Decided (Dan, 2026-11-03): road roller and bulldozer first.** Then, as recommended, tracks, the excavator arm, forklift and mixer.
2. **Tracks.** Printed link chain (recommended for v2), a flexible belt, or stay wheeled for the first dozer?
3. **Power for tracked vehicles.** A twin-motor skid-steer module is a new powered part and a new set of safety obligations (the add-on already carries battery, radio and thermal rules). Hand-pushed only for now, or plan the module?
4. **Where it lives.** A new "Yard" bench in the Workshop (recommended), or extra stages in the Truck bench?
5. **One interface for all implements** (section 2): agreed, or keep each attachment's own mounting?
7. **Dozer shaft. Decided (Dan, 2026-11-03: "yes").** The arms need a 9 TU (112.5 mm) rear axle, not the roller's 103 mm one, to clear the wheels, so a separate part `kit_barbell_shaft_9tu` is added for the dozer and the roller keeps its 103 mm axle. The lift hold and arm retention are still to be settled in a scratch prototype.
6. **Front-axle float. Decided (Dan, 2026-11-03: "yes"): accept it for now.** A fixed front axle (the roller's, and the existing unsteered trucks') floats 14.3 mm sideways each way because the keel is only 24.8 mm wide at the row-0 nose (section 8). Accepted for a pushed toy until the first print shows whether it matters; a spacer on a Pro cruciform shaft is cheap to add afterwards. The Yard bench's float button shows the 14.2 mm slide on the model.

Working assumptions until Dan says otherwise (my recommendations, adopted so the roller and wheeled dozer can proceed): the first dozer is **wheeled** (tracks come after, as printed links), everything is **hand-pushed** for now (no twin-motor module), the viewer is a new **Yard bench**, and **I1 is the stud deck** as section 2 now says.

## 7. What is not known

- Whether the existing C-jaw accepts the proposed implement bar without a new connector **[?]**.
- Whether a 29-link chain per side prints and runs without binding at 0.4 mm **[?]**, and whether a flexible belt prints at all **[?]**.
- Real masses for every vehicle (all section 3 masses are estimates) **[?]**.
- The age grading of a tracked, powered vehicle **[?]**: compliance work belongs to the power specs, not to this draft.

## 8. Design study: road roller and bulldozer (2026-11-03)

Measured from the real connectors and the viewer's placements, then prototyped in a scratch copy of the CAD and run through the real part gate. **The two roller parts landed on 2026-11-03** (wave W14, see "Landed" below); the dozer parts are still concept only.

**The envelope [M].** The truck's wheels sit at x = 26.7 to 39.0 mm each side (12.3 wide) on axles at rows 0 and 8 (y = -56.25 and +43.75, wheelbase 100 mm). The 78 mm barbell shaft is exactly 49.8 + 2 x (12.3 + 1.8). With O50 wheels the truck is 78 mm wide. **The keel is not the same width at the two axles** (measured from the real `kit_keel_base`): row 8 is the full 49.8 mm hull, so the wheels sit 1.8 mm clear of it; row 0 is the 24.8 mm nose (half width 12.4), so the wheels sit 14.3 mm clear of it. This was wrong in the first draft of this section, which assumed 1.8 mm at both rows.

**One new shared part: a wide axle.** `kit_barbell_shaft_wide`, 103.0 mm (= 49.8 + 2 x (24.8 + 1.8), also = a 12.3 mm wheel plus a 12.3 mm dozer arm outboard on each side). Same cruciform-tip shaft function, 3.3 g. Gate: verified.

**Road roller [M, prototyped].** Four smooth dished drums, `kit_drum_roller` (O50 x 24.8, 2 TU wide, fixed hub, four ribs, 4.0 mm floor, 2.4 mm wall at the open face), on two wide axles, fixed axles (no rack steering: a 24.8 mm drum does not fit the steering knuckle's stub; steered rollers need a longer stub and are later). Gate: verified, no blocking failure; 26.2 cm³, **32.5 g each, about 130 g for four** (the drum's mass is mostly its rim; a lighter roller uses two drums and two giant wheels). New parts for the roller: 2 wide axles and 4 drums. Preview: a squat double-drum roller chassis that reads correctly.

**Bulldozer: a C-frame on the rear axle [M geometry, concept only].** With 78 mm of wheels the push arms cannot sit between wheel and keel (a 1.8 mm gap), so they sit **outboard of the wheels** at x = 39.2 to 51.5 mm and pivot on the **rear axle**, as real dozer lift arms pivot near the final drive; the wide axle's ends are flush with the arms' outer faces. The arms never meet a wheel at any lift angle because their x range is outside the wheels'. The blade is **two existing `kit_scoop_blade`s side by side (99.6 mm)** on a new stud-deck crossbar between the arm ends, so **no new blade part**. New parts for the dozer: 1 wide axle (rear; the front keeps the 78 mm shaft), 2 arms (`kit_dozer_arm`, about 12.3 x 12.3 x 150, free bore on the axle, pin at the front), 1 crossbar (`kit_dozer_bar`, two 4x3 stud grids). **Revised by the lift sweep below: the arms are the existing `beam_str_tu10` Pro beams, so there is no `kit_dozer_arm`, and the rear axle must be longer than 103 mm.** Preview: arms run along both sides outside the wheels and the blade spans the front.

**Still to design before CAD for the dozer [?]:** how the arms are held at a chosen height (a friction or detent pivot, or a prop link from the keel studs), how they are retained on the shaft end, the blade's pitch, and whether the crossbar is one part with the arms (a printed U-frame) or three. These are the questions a first prototype should answer; none needs a decision from Dan yet.

**Lift sweep (2026-11-03) [M, scratch CAD: `parts/kip/dozer_lift_sweep.py`].** Real CAD for the keel, medium wheels, both axles, two `beam_str_tu10` arms (125 mm, 10 free bores at 12.5 mm, the first on the rear axle, 118.75 mm from pivot to tip) and two `kit_scoop_blade`s; the crossbar joining the arm tips is a plain box (the real part is not designed). The arms sit outboard of the wheels (x 39.0 to 51.5) and lift about the rear axle.

| Lift | Blade above ground | Arm to wheels | Blade and bar to front wheels | Overlap |
|---|---|---|---|---|
| -4.5 deg (blade on the ground) | 0 mm | 0.00 | 1.13 mm | 0 |
| 0 | 11.75 mm | 0.00 | 0.77 mm | 0 |
| 10 | 34.7 mm | 0.00 | 5.1 mm | 0 |
| 25 | 67.9 mm | 0.00 rear, 18 front | 27.7 mm | 0 |

What it settles and what it does not:
- **The lift range is real and nothing collides.** The blade meets the ground at -4.47 degrees (arm tips slightly down) and rises 67.9 mm at +25; zero boolean overlap with the keel, wheels or axles at any angle, 14.1 mm of keel clearance, and a beam's first bore clears the cruciform axle by 0.20 mm all the way round, so a kit beam does pivot on the wide axle.
- **Arms from existing beams: one new part fewer.** `kit_dozer_arm` is not needed. The crossbar (stud decks for the blades, bores for the arm tips) is still one new part.
- **The arm rubs the wheel [M, a flaw in the first study; the 112.5 mm axle is decided and prepared, see section 9].** A beam is 12.5 mm wide and the space outboard of the wheel on the 103 mm axle is exactly 12.5 mm (51.5 - 39.0), so the arm touches both wheel faces (0.00 mm) over most of the range, and the wheel is a rotating part. A 1.0 mm gap needs a shaft of at least 105.0 mm before any retainer; **9 TU = 112.5 mm** fits the 12.5 pitch and leaves 3.75 mm each end for the gap and a retainer. That is a second wide axle, `kit_barbell_shaft_wide` stays the roller's.
- **Not solved: nothing holds an arm on the shaft end, and nothing holds the blade at a chosen height.** Left alone the blade rests on the ground (the arms hang to -4.5 degrees), which is a fair "float" mode but not a "carry" mode. Candidate holds, none tried: a prop beam from a keel stud-deck bracket to a hole in the arm, or a pin through the arm and a second hole in a short beam fixed to the keel. Candidate retention: a collar on the longer shaft's end. Both need a model before a decision.
- The blade is 0.77 mm from the front wheels at lift 0: tight but clear; it opens as the blade rises.

**Lift hold study (2026-11-04) [M, scratch: `parts/kip/dozer_hold_study.py`, geometry from the real CAD].** What it settles:
- **Friction at the pivot cannot hold the blade [M].** Arms, crossbar and both blades weigh 83 g (crossbar at 45 % of its solid box) to 94 g (solid) and put 74 to 97 N*mm on the rear axle at every lift angle (the torque barely falls with lift: the centre of mass is 120 mm out). A friction pivot (mu 0.3, 2.5 mm lever) would need a **98 to 130 N** squeeze on a printed shaft, about a hard pinch, and PLA creeps under it. So the arms need a positive hold (a stop or a strut), or the v1 dozer is **float only**: the blade rests on the ground, the child lifts it by hand and it drops back. Float is the natural mode of a pushed toy, and it needs no new part.
- **A cross-member between the arms cannot sit anywhere but past the keel nose [M].** The keel is 15.3 mm tall and its nose ends at y = -62.4; the arm holes at 12.5 mm pitch from the axle land at y = 18.8, 6.2, -6.2 and -18.8 for holes 3 to 6 at lift 0, all at z 6.2, inside the keel's y and z range. A cross shaft through them would pass through the hull until the lift reaches about 8 degrees (hole 6), 10 (hole 5), 14 (hole 4) or 21 (hole 3), where the hole rises past the 15.3 mm keel top, and the 5 mm shaft needs a little more. The crossbar therefore belongs at the arm tips, as the sweep assumed.
- **The only workable hold is a strut from the crossbar to a keel nose stud [M geometry, not designed].** The strut would run about 30 mm back and 10 to 20 mm down (an estimate from the hole positions, not a model), so it needs a **hinged** end on the stud (a bore on a vertical stud cannot tilt), which means one new small part (`kit_dozer_prop`, a link with a pin at one end and a stud socket at the other) and bores on the crossbar for its pin. Bore pitches of 25.0 or 37.5 mm give two or three discrete heights across the range. No CAD yet.
- **Retention is still open.** The 9 TU axle's tip has no barb (the cruciform end is a pin shape for a rotor blade), the arms have 0.2 mm radial clearance, and craft 11 only proves 3.0 mm of shaft beyond each beam. Something must stop an arm sliding off the end: a `bushing_tu01` is 12.5 mm long and does not fit the shaft, so a small collar (or a printed cap that presses on the tip) is another new part. Relying on the wheel faces and the 3.75 mm end stubs alone would not hold a pushed, bumped toy.

**What this asks of Dan [?]:** the v1 dozer as **float only** (no new part beyond the crossbar and a retention collar), or float plus a carry strut (one more part, a hinge to design and test). I recommend float only for v1; the strut is a v2 once the first dozer is printed and a child has used it.

**Landed 2026-11-03 [M]: the road-roller parts (commit `0418f2e`).** Both are in the catalog as Pro parts of the new wave **W14 "Construction"** (`targets.pro` 85 to 87):

| Part | Size | Volume | Mass (PLA 1.24) | Part gate | Pre-print check |
|---|---|---|---|---|---|
| `kit_barbell_shaft_wide` | 6.6 x 103.0 x 5.0 mm, LAY_FLAT | 2.65 cm3 | 3.3 g | verified, above the S1 small-parts cylinder | pass, "prints as is" |
| `kit_drum_roller` | O50.0 x 24.8 mm, face down | 26.24 cm3 | 32.5 g | verified, above the S1 small-parts cylinder | pass, "prints as is" |

They sit on a new **Card G** ("Construction: Road-Roller Drums and Wide-Track Axles", 111.0 x 134.2 mm in the 164 mm limit, every gap at least 5.0 mm): four drums and two wide axles, exactly one road roller. **Gate G1 gains craft 10, `10_road_roller`** (14 crafts now): keel plus two wide axles plus four drums, zero overlap with the keel, windscreen and Kip, each wide axle flush with its drums' outer faces, and the front and rear drums clear of each other. Results: the full `selftest.py` passes (164 checks, 0 failures) on a fresh regeneration of all 207 parts, `verify_band_jet.py` 8/8, and the catalog-dependent vitest suites pass (123). The catalog is now 207 parts, all verified (120 Snap, 87 Pro). The self-test also needs the gitignored `app_export/` rebuilt (`make_app_export.py`); it was, and now holds both parts as `pro-kit-drum-roller` and `pro-kit-barbell-shaft-wide`. Card B was also refreshed (it carries the two giant wheels, which changed with the wheel redesign). Not yet done: the two parts have no viewer mockup STL and no Yard-bench or Truck placement; `sync_truck_parts.py` does not list them.

**Front-axle float [M, found while landing, applies to existing trucks too].** Nothing holds a fixed front axle sideways except the keel. At row 8 the drums (or wheels) sit 1.8 mm from the 49.8 mm hull, so the axle moves 1.8 mm at most. At row 0 they sit 14.3 mm from the 24.8 mm nose, so the **front axle floats 14.3 mm each way** until a drum meets the nose. Gate G1 craft 10 proves the whole travel is free of contact and that the keel is what ends it at 14.3 mm (the check fails if the axle could slide further). The unsteered Stage 1 to 4 trucks with the 78 mm barbell front axle have exactly the same float. A drum with its dish turned toward the keel stops at about 14.8 mm, so orientation does not decide it; the viewer should still mirror the pair so each floor faces the keel, as its wheel pair does. **[?]** Whether 14 mm of side float matters in a pushed toy is untested; a 12.5 mm spacer on each side would close it to 1.8 mm, and I found none that fits a Pro cruciform shaft (`bushing_tu01` is 12.5 mm long but has a `bore_grid` hub).

**Next steps, in order:** (1) done: the Yard bench is a Workshop tab, (2) done on paper (lift hold study above: float only for v1 unless Dan wants the carry strut; the retention collar and the crossbar are the two new parts to design), then the crossbar CAD, (3) the first print test: the roller drum and wide axle (clean in the slicer), (4) done: the wheel groove patch landed with the 9 TU axle in one regeneration (9611195).

## 9. Progress (2026-11-03, 12:30 CET)

| Step | State | Evidence |
|---|---|---|
| This spec and the roller/dozer design study (sections 1 to 8) | done | commit `0418f2e` |
| Dan's decisions: build order (roller and bulldozer first), remove the WindKey Lab | decided 2026-11-03 | section 6; the Lab is deleted in `0418f2e` |
| Roller parts in the catalog: `kit_barbell_shaft_wide`, `kit_drum_roller` (wave W14), Card G, Gate G1 craft 10 | **done, committed** `0418f2e` | part gate verified for both; pre-print check "prints as is" for both; `selftest.py` 164 ok on a fresh regeneration; `verify_band_jet.py` 8/8; `kip-validation-index` 161 of 161; vitest 124 in the 7 suites that read the catalog and the Truck/Kip modules (run 12:30, working tree) |
| CAD baseline after the landing | Gate G1 **14/14**, **9** card layouts, **207** parts all verified (120 Snap, 87 Pro) | the figures "13/13, 8 cards, 205/205" in `functional-print-mechanics-spec.md` and `progressive-power-system-spec.md` are dated records from before the roller; I left them alone because another session had both files open with uncommitted edits |
| Roller in the viewer | **built**: the Yard bench v1 (a standalone page and the third Workshop tab), real CAD, drums as a mirrored pair, push and brake, a front-axle float button | `tests/yard-vehicles.test.ts` 11; `scripts/e2e-yard-bench.mjs` 42 in headless Chrome; record in `workshop-spec.md` "Yard bench v1" |
| Anything printed | **nothing printed**; every number above is CAD, not a print. A real OrcaSlicer 2.4.2 slice with Dan's profile now exists (below) | roller drum: 0 support, 1 h 55 m, 18.8 g; wide axle: 0 support, 20 min, 3.3 g. All 209 print STLs: 64 would get supports, 4 more show overhang walls, 141 are clean (`parts/partspec/validation/orca-sweep.csv`, `scripts/orca-sweep.py`) | the first print test is the roller drum (section 5, step 5) |
| Bulldozer: arms, crossbar, lift hold, retention, blade pitch | **lift sweep done** (arms are existing beams; range -4.5 to +25 degrees; the arm rubs the wheel without a longer shaft); the crossbar, the hold and the retention are not designed | `parts/kip/dozer_lift_sweep.py`; section 8 |
| Dozer axle `kit_barbell_shaft_9tu` (112.5 mm, decision 7) | **landed with the wheel fix in one regeneration** (patch in `docs/specs/patches/`, kept as the record) | part gate verified (all 211 parts); slice 0 supports, 21 min, 3.6 g; Card G 118.5 x 145.8 mm; Gate G1 **15/15** and `verify_band_jet.py` 8/8 with both patches in; craft 11 mutation-tested (beams at zero gap fail it: `clearance 0.000 mm, need >= 1.0`); full `selftest.py` passes |
| Tracks, excavator, forklift, mixer | not started | |
| The five dropped Motion CAD parts (wind key, latch pawl, bumper trigger, bellows base and leaf) | still in the catalog and CAD, no longer drawn or loaded by the Truck bench | removal is a CAD-lane decision; needs Dan |

**Work in the tree that is not this lane's, and what it changes here.** A peer has uncommitted free-hub front wheels (`kit_wheel_med_free`, `kit_wheel_giant_free`, wave W11) that turn `kit_wheel_giant` into `_wheel_giant(hub_kind)`. Their note in `selftest.py` says the committed steered front wheel sits on a Double-D stub in a Double-D bore, which is a key, so it could only rock about 1.35 degrees. That does not touch the roller (its drums are fixed-hub on fixed axles and drive the axle), but the part counts, card layouts and Gate G1 figures in this section will move when that work lands, so recount from `catalog.json` then.

**What a real slice found (2026-11-03) [M].** The PartSpec pre-print check is geometry only, and its ledge rule accepts a flat roof held on both sides. OrcaSlicer 2.4.2 with Dan's own profile (Ender-3 Pro 0.4, 0.20 mm, 2 walls, supports on, auto, 30 degrees, PLA 220 C) disagrees for some parts. The roller parts are clean. The **redesigned giant wheel is not**: 4,108 support moves under its 20 lower tread grooves, which the old wheel did not have. A fix is applied and recorded in `workshop-spec.md` item 4a (gable grooves, re-cut after the arms; 0 supports on both giant wheels). Of all 209 print STLs, 64 get supports under that profile: 19 hair parts and 7 hats (4,800 to 16,400 moves each), the Kip cockpit and truck parts (`kit_keel_base_S` 860 moves, `kit_windscreen_S` 877, `mech_brain_tray_S` 8,216, the band and drive trays about 2,000), both giant wheels (the free-hub one too: 4,108, measured), `veh_*` chassis and others. **This is not proof those parts fail:** Orca puts supports under any flat or shallow roof, including short bridges that print fine, and the Kip print path forces supports off per object for parts the CAD gate calls support-free. It is a measured list of what to look at before printing, and the first print test of a part on that list should say which. `scripts/orca-sweep.py` reruns it (about 10 minutes).

**Reading the sweep: what Dan's profile flags (2026-11-03) [M].** I measured where the profile starts adding supports with eight test overhangs, a post with a sloped underside at 20, 30, 35, 40, 45, 50, 60 and 80 degrees from vertical: **no supports up to 50 degrees, supports at 60 and 80** (5,075 and 5,789 moves). So the "supports 30 degrees" setting agrees with the CAD's 45 degree rule; a part on the list has a roof flatter than about 55 degrees from vertical, which means flat or near-flat roofs, mostly short bridges held on both sides. **The keel base [M]:** its 860 support moves (+2 min and +0.17 g against supports off) sit in the two side pockets of the keel's recessed waist: the outline is ±17.9 mm wide at z = 6 mm against ±24.9 mm elsewhere, between y = 0 and 13 mm, and the supports span y +3 to +9 mm, z 4 to 11 mm, x ±22 mm. I did not name the exact roof. **The windscreen [M]:** 877 moves (+2.4 min, +0.5 g), under one 5.8 mm wide, 39.6 mm long flat roof at z = 11.5 mm, a short bridge. Neither is likely to need supports to print, but only a print will say; supports on costs minutes and a little cleanup. Method trap: OrcaSlicer rotated the keel 90 degrees on the plate, so support coordinates have to be mapped back to the part by testing which of the four orientations puts the points outside the solid (only one does).
