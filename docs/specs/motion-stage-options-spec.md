# Spec: First Motion Stage, Key-Wound vs Pull-Back, and the `Snap -> Motion -> Pro` Ladder

**Status:** draft 6, 2026-11-03 — **Decisions locked by Dan (section 6); CAD pass complete: [`verify_band_jet.py`](../../parts/partspec/verify_band_jet.py) `8/8` PASS (`0` FAIL, `0` UNKNOWN), `Gate G1` `13/13` PASS, all `205` parts pass the part gate and `8/8` kit cards pack at `>= 5.00 mm`. Outstanding: the physical print tests (section 10) and the viewer/app stage-ladder rename.**
- **Decided & applied in specs + `CARD_LAYOUTS`:** Ladder **`Snap -> Motion -> Pro`** (no separate `Mech` stage; `Card F` = optional **Pro Powered Add-On** `10+`, servo replaces hand column/wheel); pull-back-only Band Core (`key`, `latch pawl`, `bumper`, and `bellows` dropped from `Cards E2–E3`; rear axle `gear_spur_z10` added to `Card E2`); `Ø50` wheels first-class in every stage; top-balloon jet (`mom_jet_valve_body`) selected.
- **Done in `toyventor_kitcard.py` (CAD pass closed 2026-11-03):** Band Core clutch mirrored (`C1` PASS: clear window `24.5..30.5 deg`; `Gate G1` `3c` PASS); tray saddles closed to `360 deg` teardrop `free` bores (`C3` PASS, `0.35 mm` max `+Z` lift); pawl bite `0.78 mm` (`C2` PASS: pawl tip `R10.38` over pocket crest `R9.60`, valley deepened to `R10.55`); nozzle set redrawn as four unblocked inserts (`C4` PASS: rear orifices `O3.2 / O4.6 / O6.1 / O8.0` measured, each the narrowest section, `<= 0.5 mm3` seat overlap); air path widened (`C5` PASS: inlet `50.1`, valve port `38.1`, tunnel `52.6 mm2`, narrowest `O6.96`; best `9.4 gf = 1.38x` rolling drag at `150 g` against the `>= 1.3x` rule); `C6`/`C8` placement and gear-mesh checks pass; `C7` passes at the viewer phases `17.5 / 46.5 deg` (`0.00 mm3`, about `1.5 deg` of margin inside the `24.5..30.5 deg` window).
- **Found and fixed while exporting (2026-11-03):** the earlier `Gate G1` / `verify_band_jet.py` passes did not run the part gate (`toyventor_parts.py`), and two parts failed it. **`mom_band_spool_pawl`** failed `G1_watertight`, `G3_single_body` (`45` bodies) and `P1_no_supports` (`124 mm2`): the conical drum flange (`R8.4`, `21 deg` underside over the open pawl zone) could not print without supports, and its `R5.8` base nearly coincided with the `R5.75..5.79` drum and `R5.80` hub. It is now a revolved `R7.2` retaining lip with a `48 deg` underside and a base buried at `R5.6` (watertight, `0` overhang); **the lip leaves about `1.6 mm` of drum between lip top (`z 4.6`) and hub cone (`z 6.2`) for a `6.4 mm` band, so whether it still keeps a slack band out of the pawls is a print-test question, not a CAD one.** **`mom_nozzle_set`** failed `P4_no_ledges` (`5.1 mm2`: the plug's teardrop apex overhung the `R6.0` flange); the flange is now the hull of the disc and the plug footprint. The gate's own seat pose in `_pneumatic_jet_check` still used the pre-redraw insert position and now seats the real `O4.5` insert (`xc = -12.0`). The set is `63.0 x 14.1 x 8.2 mm` (slot on `Card E3` moved to `x = 44.0`, outer `162.4 x 162.8 mm <= 164`). Companion specs [progressive-power-system-spec.md](progressive-power-system-spec.md) and [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) are synced to this scorecard.

**Draft 2 corrects draft 1.** A review pass found problems in the CAD that draft 1 missed, and checking them also found three errors in draft 1 itself (the rear wheel is not a blocker at the right key spin, the key's shape was described wrongly, and "geometry works" confused "no overlap" with "functions"). Section 7 lists every review finding and how it was checked.

**Question:** the Band core (Stage 3 `Momentum`) is wound with a removable `mom_wind_key`, and the key cannot be inserted in the current CAD. Is the key the right first motion mechanism, would pull-back be better, and does `Snap -> Pro -> Momentum -> Mech` reuse parts well?

Evidence tags: **[M]** measured on the committed STLs, **[S]** a number from the specs (analytic, not tested), **[E]** my estimate (assumptions stated), **[?]** unknown until something is printed or benched.

## 1. What is true today

### 1.1 The key as drawn cannot wind, even if inserted [M]

`mom_wind_key` is flat, 5 mm thick: a 28 mm wide paddle (8 deep) on a 6.6 mm wide central stem (30 mm overall), **plus two 2.8 mm prongs 7.8 mm either side of the axis** (from about 10 to 16.5 mm along the key). The tray's right wall has two matching holes at y +-7.8, and the spool has two matching sockets (4 mm deep) for the prongs. So the key is meant to go in at **spin 90 / 270** (prongs along +-y). Overlap at that spin (interactive: `/kip/WindKey-Lab.html`, table from `parts/kip/windkey_table.py`, one row per 30 deg of spin):

| Part | why | demo wind pose (x 25) | stem tip at spool face (x 46.9) | fully out (x 55) |
| :--- | :--- | ---: | ---: | ---: |
| `shaft_tu03` (PTO shaft) | sits on the spool axis, ends at x 22.3, 5.5 mm past the spool face (16.85) | 577 mm3 | 112 | 0 |
| `mom_band_core_tray` | wall x 22.9..24.9 is solid on the axis: the central stem has no opening | 285 | 52 | 0 |
| spool / PTO gear | stem tip inside them | 261 / 24 | 0 | 0 |
| rear wheel R | **clear at spin 90.** Only at spin 0 / 180 do the paddle and prongs point down into the tyre | 0 | 0 (spin 0: 96) | 0 |

Two more problems no overlap number shows:

- **The prongs cannot turn.** They pass through two fixed holes in a stationary wall, so the key could rotate only a few degrees (clearance, roughly +-5 deg **[E]**). Winding 2.5 turns needs the prongs to sweep a full circle, so the wall needs an arc window, and the right saddle pedestal (x 17.1..22.3, solid below the shaft) lies in that sweep **[M]**.
- **Draft 1 said the wheel was a blocker. It is only a blocker at the wrong spin.**

### 1.2 What the Band core actually models

- **The one-way clutch is built the wrong way round [M].** In the PTO gear's 8-tooth pocket (open end, z 7..9.6) the wall radius rises 9.60 -> 10.35 mm over 0..43.7 deg of each 45 deg tooth and drops back in the last 1.3 deg. Sweeping the spool against the gear shows contact building about 8x faster when the spool turns **+** (0.4 vs 0.05 mm3 per deg): the CAD **locks when the spool turns + about the axis relative to the gear and overruns when it turns -**. Both parts are placed with the same rotation, so +z local is world +x. A forward-rolling truck spins the axle gear +x and, through the 1:1 external mesh, the PTO gear -x. So: **pull-back overruns (nothing winds); forward launch overruns (or, if the band were wound the other way, locks and drives the truck backward); forward coast locks (the wheels drag the spool).** As modelled the clutch can only push the truck backward. The sweeps in draft 1 proved no overlap on this path, not that it functions.
- **Pawl bite is thin [M]:** pawl tip radius 10.16, pocket crest 9.60: **0.56 mm** nominal bite (the 0.75 mm is the ramp rise, not the bite). The spool's free O7.0 bore sits on a O6.6 shaft with 5.0 flats, so it can sit 0.2 mm off-centre across the round and up to 1.0 mm across the flats **[E]**: one pawl can lose its bite while the opposite ones gain. Printed 0.4 mm perimeters make 0.56 mm a small step **[?]**.
- **The drum has no left retaining flange [M]:** the pawl zone ends at z 2.5 and the spool radius is only 5.9 mm right after it, so a slack 6.4 mm band could walk into the pawls **[?]**.
- **The PTO shaft is held, but loses upward capture twice a turn [M].** Two C-jaw saddles inside the tray at x -15.1..-9.9 and 17.1..22.3 hold it down and sideways (jaw throat 6.0 mm, 1.8 mm above the axis). The shaft is 6.6 round with 5.0 flats, so when a flat faces +-y within 16 deg (about 18% of each turn) it is narrower than the throat. The axle gear below pushes the PTO gear up: radial force about **1.9 N** at 65 N.mm **[E]** (F_t 5.2 N x tan 20 deg). The lid does not cap the saddles, but its gear dome stops the gear **1.1 mm** above its seat (measured gap 1.104), so the shaft cannot be ejected; it can lift enough to open the gear centre distance, with mesh quality unknown **[?]**.
- The shaft is captured end to end (boss face at x -15.45, wall at 22.9: 0.85 mm play).
- The truck as modelled in the viewer has **no `mom_latch_pawl`**: the `ARMED` hold has never been placed or checked.
- **Bumper release is not connected [M]:** the bumper sits at the nose (y -32.5..-74.5); the tray's gabled trip window is in the tray's front wall at y 12.6, 45 mm behind the bumper's rear edge; the catalog has no pushrod part; the demo's tub tip is scripted (`tipDeg = 55 * smooth(...)`), not driven by anything.
- Drive path: wheel -> axle `gear_spur_z10` -> `mom_pto_gear_z10` (1:1) -> spool pawls -> band drum. Sweeps of spool 0..360 deg and gear phase found no blocking overlap (gear vs spool face 3 mm3 at some phases, axle gear vs tray 0.3 mm3, pawl vs PTO gear 2.98 mm3).

### 1.3 Part reuse across the stages [M]

From the parts drawn in the viewer's modelled trucks (probe frames of the motion suite, Kip driver excluded). Kit core in every stage: `kit_keel_base`, `kit_barbell_shaft`, `kit_wheel_med`/`giant`, `kit_tilting_tub`, `shaft_tu03`.

| Stage | Parts added over Snap | Of Pro's 9 added parts it reuses | Used by a later stage? |
| :--- | :--- | ---: | :--- |
| Pro steering | 9 (bridge, rack, 2 knuckles, link, column, wheel, captive pin, axle Z10 gear) | n/a | **Mech reuses 7 of 9** (not column, wheel) |
| Band core | 8 | 2 (axle gear, captive pin) | **No.** 6 parts are single-use: tray, lid, spool, PTO gear, bumper, key |
| Bellows | 2 (base, leaf). The viewer also draws `kit_turntable`, but that is a Stage 1 Card B part | 0 | No |
| Mech | 18 | 7 | n/a |

These counts are the viewer's dump truck. Full Stage 3 also carries the slam launcher (2 single-use parts), balloon jet (3) and flywheel (5). The catalog has **five separate 4x4 core tray/lid pairs** (band, bellows, flywheel, mech drive, mech brain = 10 parts) behind a "universal core" that is dimensional only; the bellows pair is a hinged clamshell, so it is a looser match.

## 2. The options for the first motion stage

### Option A: key-wound, as specified (`ARMED` + key + latch pawl)

To work it needs all of: (1) the shaft stopped short of the spool dogs; (2) a wall opening for the central stem **and** an arc window for a full turn of the prongs, clear of the right saddle; (3) the key redrawn so its stem and prongs reach the spool from outside the wheel (the stem is only 12 mm long today); (4) the latch pawl and hold flange modelled and swept **[?]**; (5) a loose 28 mm part that must not be lost.

The band load (35-65 N.mm **[S]**) is held for as long as the toy stays armed, on printed ratchet teeth and a printed pawl: a sustained PLA load, creep **[?]** (the spec's creep gate G7 covers the bumper, not this hold). Pull-back has none.

### Option B: pull-back only (no key, no `ARMED`, no latch pawl)

Drag the truck backwards: wheel -> axle gear -> PTO gear -> spool winds the band; let go and the band drives the wheels forward; coast uses the overrun.

**The one-way argument holds only if the clutch locks when the spool lags the gear** (relative rotation spool minus gear negative): then pull-back locks and winds, launch locks and drives forward, coast overruns, and the key (turning the spool while the wheels stand still) overruns and winds. **The CAD locks the other way (section 1.2), so Option B does not function until the pocket sawtooth and the spiral pawls are mirrored** (a two-part change). Everything below assumes that fix.

| Check | Value | Basis |
| :--- | :--- | :--- |
| Drag distance for 2.5 turns | **283 mm** (2.5 x pi x 36) | [E] 1:1 gears, O36 wheels |
| Peak tyre force while winding | **1.9-3.6 N** ideal (35-65 N.mm / 18 mm); **3.0-5.6 N** at 65% winding efficiency; **4.3-8.0 N** at 45% | [S] band torque, [E] efficiency. (The spec's 45% converts stored energy to run distance; it is not a winding efficiency.) |
| Z10 tooth bending stress at 65 N.mm | **about 1.9 MPa** (Lewis, F_t 5.2 N, b 6.25, m 2.5, Y 0.176) | [E] static; printed PLA across layers is roughly 15-25 MPa |
| `shaft_tu03` torsion at 65 N.mm (d 5.0) | **about 2.7 MPa** | [E] |
| Spiral pawl strain at 0.75 mm rise | 0.68% (below 1% PLA limit) | [S] |
| Band strain at 2.5 turns | 114% (EPDM breaks at 450-600%) | [S] |

**Hand press needed to keep the tyres from slipping (N, after the 1.08 N craft weight) [E]:**

| winding efficiency | tyre-to-floor friction 0.4 | friction 0.2 |
| :--- | ---: | ---: |
| 100% | 4-8 | 9-17 |
| 65% | 6-13 | 14-27 |
| 45% | 10-19 | 21-39 |

Friction 0.4 was my first guess; hard PLA on smooth floors is often lower, and nobody has measured it **[?]**. Gears, shaft and pawls have large margins; **traction is the risk.** Options, cheapest first: a rubber O-ring in a printed rim groove or a TPU sleeve (roughly halves the press if friction doubles), larger rear wheels (`#5` O50: 1.4-2.6 N ideal), a smaller drum, a lower-energy band. A weaker band shortens the run.

**Run distance needs checking [E].** The spec quotes a 2.0-3.5 m run (stored 0.22-0.38 J, 45% efficiency) and also a 0.12 N overrun drag during coast, on top of 0.0485 N rolling drag. If both act through the coast, the same inputs give about 0.5-0.9 m of coast after the 283 mm powered phase, roughly 0.8-1.2 m in all. This applies to Option A equally (it is the band core, not the winding method) and needs the bench test.

What B removes: key, latch pawl (not modelled today), the `ARMED` hold, the spool's key dogs and hold flange (a simpler print), the bumper trigger. **The bumper auto-release was never connected in CAD (1.2), so dropping it loses a feature that does not exist as built.** In the viewer the bumper trigger occupies the same nose slot as `pro_steer_bridge` (both at (0, -50, 12.5)): without it, steering and motion share the front end without that conflict. A combined pose with steering and the band core has not been checked here **[?]**.

### Bigger wheel option (decided: wanted in every stage)

`kit_wheel_giant` (O50, 12.3 wide) already exists and has the same fixed hub as `kit_wheel_med`, so the rear axle, axle gear and PTO gear are untouched. **Today it is blocked in the band stage only by the bumper trigger** (the viewer says the O50 tyres extend 12.6 mm past the bumper face); dropping the bumper removes that. Effects on pull-back, scaling the O36 figures by 18/25 = 0.72 **[E]**:

- Peak tyre force while winding **1.4-2.6 N** ideal (35-65 N.mm / 25 mm), and every hand-press figure in the table above falls by about 28% before the weight term (for example 65% efficiency, friction 0.2: about 10-19 N instead of 14-27 N).
- Drag distance for 2.5 turns **393 mm** instead of 283 mm.
- Overrun drag equivalent about **0.084 N** instead of 0.12 N (the spec's 2.1 N.mm over the radius): the coast improves roughly 25% **[E]**.
- Existing limits stay: with steering, giants keep 1.80 mm keel clearance only up to about 26 deg inner, so steering is capped at 25 deg (already in the viewer). Tub-tip sweeps already ran clean with both wheel sizes in every stage **[M]**; the band-stage pose with giants has not been swept without the bumper **[?]**.

**Suggestion:** make O50 the first answer to traction (it needs no new part), and add a rubber O-ring groove to **both** wheel sizes as the second. Coupon #1 becomes a four-way: O36 / O50 x bare PLA / O-ring.

### Balloon option (Motion b): research and requirements

Dan's steer (2026-11-02): the balloon should **stick out of the top, not sit under the dump tip**, and a special piece for balloon power is fine. Confirmed: the bellows is dropped and the jet piece is the balloon option.

**What other balloon cars do** (classroom and hobby sources; none gives thrust data for a car like ours):

- The balloon neck goes on a rigid nozzle or tube and is secured to it (a rubber band in NASA's version), and the **nozzle points straight out of the tail**, with the neck pointing rearward ([NASA Glenn](https://www.grc.nasa.gov/WWW/K-12/BGP/Ashlie/BalloonRocketCar_easy.html), [Eurobricks](https://www.eurobricks.com/forum/forums/topic/9183-help-for-school-project)).
- **Nozzle size trades thrust against burn time and the sources do not agree on the best size**: bigger gives more thrust and empties faster, smaller gives less thrust and may roll longer (NASA). A university propulsion lab tests a 10 mm and a 5-6 mm nozzle at balloon diameters of 15, 20 and 25 cm, on a smooth tile floor with 10-15 m of tape, and gets thrust from deflation time and distance ([SMU](https://s2.smu.edu/propulsion/Pages/balloonlab.htm)). **Our nozzle set (O3.0 / 4.5 / 6.0) tops out at the smallest size that lab uses.**
- **Light, low, long and wide**: one builder's car that worked was "low, flat, and long" ([Mombrite](https://www.mombrite.com/balloon-powered-le%67o-cars/)); another with a balloon holder on the back "fell over quite a lot" and the author suggests "lighter, wider" ([Science Sparks](https://www.science-sparks.com/balloon-powered-le%67o-car/)). A search summary also said the inflated balloon should rest on the car, not the floor; I could not confirm that on a page I read, but it is sensible.
- **Wheels**: NASA says to find every place parts rub; Eurobricks builders prefer thin, light wheels because large tyres add weight, and argue over rubber grip against friction. Larger wheels roll with less resistance in general **[E]**. A jet car's wheels are not driven, so grip does not matter; that differs from pull-back, where it is the problem.
- Balloon pressure varies during the burn, so thrust is not constant (an [IYPT 2011 team report](https://archive.iypt.org/iypt_book/2011_5_Car_Brazil_BCS_v3.pdf), known only from a search summary: the PDF would not read here). The SMU lab simply assumes constant acceleration. Printed balloon-powered *air engines* also exist (a different route, not pursued here).
- Not usable: the Instructables 3D-printed jet car and the toy-brick "balloon engine" listing would not load (title only, HTTP 403), and a search snippet describing a balloon on a top pipe did not appear on the page it came from. Many other hits were low-quality and were ignored.

**What our CAD already has [M]:** `mom_jet_valve_body` (49.8 x 27.8 x 28.0 mm, 4x2 stud footprint) is already a balloon-on-top piece: a smooth top balloon collar (OD 19.2, bead 20.8, vertical O5.0 inlet up to z 28), a tapered slide-valve seat, and a rear 4 deg Luer socket for `mom_nozzle_set` (O3.0 / 4.5 / 6.0) pointing +Y, with `mom_jet_slide_valve` shutting it. So the piece you describe exists. It is **not drawn in any truck stage and has not been placed on the truck**.

**The viewer's balloon is not a real balloon [E]:** a 9 inch balloon holding 4-6 L is about 20-23 cm across when free (sphere of that volume), against a truck 50 mm wide; the viewer draws it as a 36 x 36 x 16 mm pinched ellipsoid inside the bellows. A real one has to stick out, as you say.

**The spec's jet numbers are consistent with an ideal nozzle, but the body's own air path is the real limit [M for the areas, E for the model].** Ideal nozzle, F = 2 x A x pressure at 2.5 kPa: O3.0 0.035 N, O4.5 0.08 N, O6.0 0.14 N, and air time = 5 L / (A x 64 m/s) about 11 s, 4.9 s and 2.7 s: these match the spec's 2.5-14 gf and 2.5-10 s. **But the air has to get through `mom_jet_valve_body` first: inlet 19.6 mm2 (O5.0), valve open port 20.4 mm2, tunnel 20.6 mm2, so about O5.0 everywhere.** With that passage and a nozzle as two orifices in series, the jet thrust is rho Q^2 / A_nozzle with Q = A_eff x sqrt(2 x pressure / rho): **O3.0 3.2 gf, O4.5 4.9 gf, O6.0 4.7 gf, O8.0 3.4 gf**, and the most any nozzle can give is about A x pressure = 0.049 N (5 gf). The spec's 8-14 gf for O6.0 is 2-3 times too high, and a wider nozzle does not help: O8 is worse than O4.5. Against the spec's 0.0485 N rolling drag (110 g) the best case is 1.0x, and at the kit's real solid-PLA mass (about 150 g, drag 0.066 N) **no nozzle moves the truck**. To benefit from O6 or O8 the body's inlet, valve port and tunnel must be enlarged first: with an O8 passage an O6 nozzle gives about 0.11 N (1.6x drag at 150 g). The lab's *Body passage* slider shows this.

**Requirements for the balloon piece (proposal):**

1. **Balloon on top** on the collar, upright at rest. A cradle is optional and its job is probably a **rear stop** that keeps a trailing balloon out of the jet stream (not a tilt-holder); the balloon rests against Kip at rest unless something holds it back.
2. **Nozzle straight back along the truck axis**, with the jet clear of the rear wheels, the hinge and anything else.
3. **No dump tub in this mode**: it is the heaviest part on those rows and the piece needs the space. (This drops the bellows idea of a balloon under the tub; the bellows parts, `mom_bellows_base` and `mom_bellows_leaf`, would go.)
4. **Inflation by hand pump on the collar**, no mouthpiece (spec rule); the valve must hold pressure (spec: 15% diameter loss or less over 15 s).
5. **Enlarge the body's internal passages first** (inlet, valve port and tunnel to about O8, which changes `mom_jet_valve_body` and `mom_jet_slide_valve`); only then do O6 and O8 nozzles pay off. As drawn, every nozzle is capped near 5 gf.
6. **Wheels free-rolling**; test O36 vs O50, since the larger wheel lowers rolling resistance but adds mass.
7. **Stability [E]:** the thrust line at about z 25 is a few millimetres above the centre of mass, so the pitching moment is about 1 N.mm against a restoring moment of about 54 N.mm (1.08 N weight x 50 mm half-wheelbase). Tipping from thrust is not the risk; **wind drag on a 20 cm balloon on a 50 mm truck is [?]** and the lab test should measure it.

**Checked on the truck (2026-11-02; interactive: `/kip/JetCar-Lab.html`, data from `parts/kip/jetcar_table.py`). It is also a stage in the Truck viewer: `/kip/Truck-Mockup.html?stage=jet` (button "3B' Balloon Jet (proposal)"; options Balloon, Lean, Nozzle; `&balloon=200&lean=30&nozzle=8`), and in the Workshop `/kip/Workshop.html?bench=truck&stage=jet`. The viewer stage draws the real jet body, no tub and no axle gear, with a procedural nozzle insert and balloon, and its Gate G1 line reads "not in Gate G1" because no craft covers it; its Action Demo only inflates and vents (the truck stays put, matching section 2). The bellows stage is left in place until you confirm it can go.**

- **Placement [M].** `mom_jet_valve_body` seats on the keel's rear rows 8-9, body centre (0, 50.0, 12.5): overlap with the keel 0, **1.8 mm to either wheel size (O36 or O50)**, 25.2 mm to the windscreen, rear face at y 64.4 (the keel ends at 62.4). Only the four corner studs engage, because rows 7-9 have no inner studs (the PTO slot).
- **No axle gear in this stage [M].** The Z10 axle gear overlaps the body by 442 mm3, and a jet car has no PTO, so Motion (b) uses no Pro-line gear and Card E2's missing `gear_spur_z10` does not matter for the balloon.
- **Straight up is the pose the CAD gives; it rubs Kip but is not blocked [M for the geometry, E for the balloon].** The collar is vertical, so the balloon starts upright. Kip's back is at y 9.6 and the collar at y 47. A *rigid* sphere (25 mm neck) overlaps him from about 125 mm diameter up (-0.7 mm at 125, -7.2 at 200; only 100 mm clears, by 3.4), but a real balloon is soft and light, so that is a rub, not a block. **The hard limit is the other end:** a balloon leaning back past about 45-50 deg reaches the jet stream (and a wheel is never the limit, 30+ mm). Leaning back 15-45 deg clears both Kip and the jet (10-50 at 150 mm); 30 deg is the balanced choice (at 200 mm: 23.6 mm to Kip, 23.8 mm to the jet).
- **What the balloon probably does in a run [E, order of magnitude].** Filled with air it floats in air, so its net weight is only the rubber (a few grams) and it has almost no inertia lean. **Air drag is what pushes it back:** about 27 mN at 2 m/s on a 175 mm sphere (Cd 0.47) and 61 mN at 3 m/s, acting about 105 mm above the neck. A pressurised neck (2.5 kPa, 10 mm radius) resists roughly 4 N.mm before it kinks. At the end-of-burn speeds from the nozzle table (about 1.4 m/s with O6 and 1.9 m/s with O8, ideal, 150 g) the drag moment is 1.4-2.6 N.mm, so expect it to trail back, not fold; above 2-3 m/s it can fold. So the likely pose is **upright at rest, trailing back during the run**, and the hard question is stopping it trailing into the jet. A printed jet piece with a real balloon on the real keel should settle this before any cradle is drawn.
- **The nozzle set cannot be used as drawn [M].** `mom_nozzle_set` is one bar carrying three plugs. Seated the way the gate seats it (plate behind the body, plugs pointing rearward, y 19-33) it never enters the socket, and `_pneumatic_jet_check` only tests air connectivity inside a box, so it cannot notice. Turned to point into the body, at the pose where its 4 deg cone mates with the socket (plate against the rear face) one plug overlaps the body by **83-89 mm3**, because its tip (O8.4 tapering to 7.6, beyond the cone) lands in the 5.0 mm wide tunnel, and the whole bar overlaps by about **520 mm3** because the other two plugs hit the turret. (Pulled back until only the tip is inside the socket mouth the overlap falls to 9.6 mm3, which is not a seated pose.) The nozzle needs a redesign as **individual inserts with the orifice at the rear**; the lab draws a proposed insert (O3 / 4.5 / 6 / 8), not CAD.
- **Mass decides whether it moves at all [M for the parts, E for infill].** Solid PLA: keel 71 g, jet body 20 g, shaft 2.5 g, wheel 13 g (O36) or 26 g (O50) each; the Snap truck with the jet piece and four O36 wheels is about 150 g before Kip, against the spec's 110 g reference (real prints use infill, so less; four O50 wheels add about 52 g). Rolling drag at Crr 0.045 is 0.066 N at 150 g and 0.049 N at 110 g, while the body's air path caps thrust at about 0.049 N, so thrust over drag is **0.47x (O3), 0.73x (O4.5), 0.70x (O6), 0.50x (O8) at 150 g**: nothing moves it as drawn, and 110 g is the break-even. Ideal-nozzle numbers (`3.8x` for O8 and so on) overstated this and are withdrawn.

### Option C: both, key later

Ship B first. Add `ARMED` as an upgrade only after it has an access path designed in (Option A's list) and a modelled and swept latch pawl.

### Comparison

| | A key-wound | B pull-back |
| :--- | :--- | :--- |
| Works in current CAD | **No** (stem blocked; prongs cannot turn; no latch pawl; clutch reversed) | **No** (clutch reversed) but no overlaps on the path |
| Prerequisite CAD fixes | shaft, wall window and arc window, key, latch pawl, spool, clutch mirror, shaft keeper | **clutch mirror** (pocket + pawls), shaft keeper (lid ribs or closed bores), pawl bite, drum flange |
| Loose parts | 1 (28 mm key) | 0 |
| Sustained printed load | **Yes** (armed) | No |
| Wind effort | low (turn key) | **traction-limited, needs a hand press** |
| Features lost | none | bumper auto-release (not built today) |
| Open unknowns | creep, latch pawl, key fit | tyre friction, clutch action after the mirror, run distance |

## 3. The stage ladder

### 3.0 Decided ladder (Dan, 2026-11-02): Snap -> Motion -> Pro

| Stage | Contents | Viewer stage today | Notes |
| :--- | :--- | :--- | :--- |
| **1 Snap** | static build, no motion (Cards A-D) | `snap` | unchanged |
| **2 Motion** | one core in the rear rows 6-9 at a time, fixed axles: **(a) pull-back band core**, **(b) balloon jet**: `mom_jet_valve_body` with the balloon on top, on the Snap truck with the tub removed and **no axle gear** (see the balloon section; the bellows that tips the bed is dropped: decided) | `band`, `bellows` | mixes lines: bellows base/leaf and jet valve body are Snap-line; the band core needs Pro-line hardware (axle `gear_spur_z10`, `shaft_tu03`, spool, PTO gear) |
| **3 Pro** | rack steering (9 parts) **plus the powered module merged in from Mech** (servo steering, drive motor, brain) | `pro` + `mech` | Mech already reuses 7 of Pro's 9 steering parts, so the merge adds only the powered parts: **11, which is Card F, printed in PETG** (drive tray/lid, brain tray/lid, servo mount/lid, two pinions, battery-door screw, pilot pin, sill duct). The viewer's Mech truck is a 9g servo on the rack, an N20 motor, a 602535 LiPo and an XIAO board |

**What the viewer shows today [M]:** stage 3B (balloon) is a pin-hinged bellows that **tips the dump bed** (10-50 deg, rated 100 g payload) with a hose and puff rings; it does **not** propel the truck. The balloon *jet* parts (`mom_jet_valve_body`, `mom_jet_slide_valve`, `mom_nozzle_set`, Card E3) exist in the catalog but are not drawn in any truck stage. So a balloon-propelled Motion truck has not been modelled yet.

What the merge changes, to settle in section 6: Mech is graded 10+ and carries the battery, radio and local-network obligations, Pro is 8+, so a Pro that includes the powered module is either 10+ or keeps the powered module as an optional add-on. Card F folds into the Pro cards. Mech's servo replaces the hand steering column and wheel (the Mech truck does not draw them), so Pro needs a rule for both together.

### 3.1 Earlier comparison of the two orders (kept for the reasoning)

| | L1: current | L2: Snap, Motion, Pro, Mech |
| :--- | :--- | :--- |
| Order | Snap, Pro steering, Momentum, Mech | Snap, Motion (band/jet/bellows), Pro steering, Mech |
| Physical parts reuse [M] | Pro steering carries into Mech (7 of 9). Momentum is a dead-end branch (6 single-use parts) | Same parts: ordering does not change reuse |
| Kid-facing complexity | steering (9 parts, links, pins) before the first self-propelled motion | first motion early; steering after |
| Fit with the CAD [M] | the band truck is drawn **without** steering, so Momentum does not depend on Pro steering | consistent with the viewer |
| Cost to change | none | stage names, HUD text, spec headings, card names **and the cards**: Card E2 has **no `gear_spur_z10`**; the two on Card E1 are the axle gear and the steering pinion, so a motion-first build must move a gear onto the motion card (Option B shrinks E2, which should make room; not checked) |

**Reading:** reuse does not favour either order (Pro steering is reused by Mech in both). The ladder is a learning-experience choice, and L2 is not free: it re-cuts the cards. Reuse does argue for fewer one-off parts in the motion stage (favours B) and, longer term, one shared lid across the cores once the sear slot goes.

## 4. Proposed direction (recommendation, awaiting Dan's yes on item 2)

1. **Ladder: Snap -> Motion -> Pro** (decided). Motion offers two cores, **pull-back band** and **balloon**; they are alternatives in the same slot, not combined.
2. **Choose pull-back as the band core's only winding method for now; drop the key, latch pawl and bumper.** A key and pull-back can in principle share one core (the spec's `PULL-BACK` / `ARMED` switch), but the key adds a loose part, a sustained printed load and a wall window, and the balloon already gives a no-mechanism mode. If you later want a "wind it up and hold" mode, add it as an upgrade (Option C) with an access path designed in.
3. Two CAD fixes pull-back cannot work without: **mirror the clutch** (pocket sawtooth and spiral pawls) and **stop the PTO shaft lifting out of its saddles** (lid keeper ribs or closed bores).
4. **Bigger wheel (O50) is first-class** in Motion and Pro, with an O-ring groove on both sizes as the second traction fix (section 2).
5. Do **not** adopt any of this on my estimates alone: the coupons decide (section 5).

## 5. What decides it: bench tests, in this order

0. **CAD first:** mirror the pocket sawtooth and spiral pawl curl; add lid keeper ribs over the two saddles (or closed teardrop bores); decide the drum's left flange. Then print.
1. **Tyre friction coupon:** a sled with a printed tread on the real floors, four ways: **O36 / O50 x bare PLA / O-ring** (TPU sleeve if you want it as a fifth). **Proposed pass rule (Dan to agree):** wind 2.5 turns on hard floor with a hand press of **8 N (0.8 kgf) or less** and no slip. Bare PLA below friction 0.3 is expected to fail; then the sleeve option is the decision.
2. **Clutch coupon, mounted as built:** the PTO-gear pocket, spool and pawls on `shaft_tu03` **inside the real tray saddles** with the axle gear driving from below (not held concentric by hand). It tests: winds under hand torque, overruns the other way, skip torque comfortably above the 65 N.mm peak, backlash, whether the shaft lifts out of the saddle, and whether a slack band stays on the drum over 20+ rapid launches.
3. **Band torque:** a spring scale on the wound band at 2.5 turns against the spec's 35-65 N.mm; also measure the real run to settle the 2.0-3.5 m vs about 1 m question.
4. **If A stays in play:** a creep test of a loaded printed hold ratchet over days, and the prong/socket fit.

## 6. Decisions for Dan

Decided: ladder Snap -> Motion -> Pro; no Mech stage; bigger wheel wanted; **balloon = the jet piece with the balloon on top, the bellows dropped**.

Decided (Dan, 2026-11-02, implementation pass):

- **Pull-back only; key, latch pawl and bumper dropped for now** (section 4 item 2). Option C (key as later upgrade) stays open.
- **Pro's powered module: optional add-on.** Pro = hand-steered rack steering (8+); the powered module (servo, drive motor, brain — former Mech/Card F) is an optional upgrade with its own 10+ grading.
- **Hand vs servo steering: servo replaces the column and wheel; never both fitted.**
- **Jet body and nozzle: enlarge internal passages to about O8 and redesign `mom_nozzle_set` as individual rear-orifice inserts (O3.0/4.5/6.0/8.0).**
- **Traction: O50 first-class in Motion and Pro now; O-ring groove only if the section 5 friction coupon calls for it.**
- **Card re-cut accepted:** the Motion card gains a `gear_spur_z10`; bellows leaves the cards; the powered module keeps its own plate as the Pro powered add-on.
- **One shared tray/lid across cores: deferred** (too large for this pass).

Still open:

- **Balloon cradle:** probably a rear stop to limit the trail-back (not a tilt-holder), and whether to let the balloon rest against Kip at rest or hold it back about 30 deg; decide after a printed balloon test on the real keel (nothing is designed).
- **Balloon size to support:** 150-225 mm all work with a 15-45 deg lean; smaller is lighter and needs less lean.

## 7. Review log: findings checked against the CAD (2026-11-02)

| Finding | Result | How |
| :--- | :--- | :--- |
| Clutch locks the wrong way (pull-back and launch overrun, coast locks) | **Confirmed** | pocket profile at z 8.5, spool-vs-gear rotation sweep, gear-train sign |
| Saddles exist and lose +Z capture twice a turn | **Confirmed, with a limit:** saddles at x -15.1..-9.9 and 17.1..22.3, throat 6.0 mm, flats narrower than the throat for about 18% of a turn; but the lid dome stops the gear 1.1 mm up, so it cannot be ejected | ray scans of the tray, shaft width vs rotation, gear-to-lid gap |
| Draft 1 said no bearing support (`[?]`) | **Wrong in draft 1**, replaced in 1.2 | as above |
| Pawl bite 0.56 mm nominal; 0.30 worst case | **Nominal confirmed**; worst case depends on spool offset (0.2 mm round, up to 1.0 mm across the flats), load shifts to the other pawls | spool and gear radii |
| Drum has no left flange | **Confirmed** (radius 5.9 mm right after the pawl zone); the band-width-vs-drum-width point is **not measured** | spool radial profile |
| Key carries twin prongs; wall holes; spool sockets; prongs cannot turn | **Confirmed**; draft 1's "19 mm shoulder" was these prongs | key sections at z 12-16 (3 regions), wall and socket scans |
| Rear wheel blocker | **Draft 1 was wrong**: a spin artifact (clear at spin 90) | per-spin table |
| Bumper release not implemented | **Confirmed**: 45 mm gap, no pushrod part, scripted tip | positions in CAD and viewer, catalog search |
| Steering plus motion additive once the bumper is dropped | **Not reproduced.** The bumper and `pro_steer_bridge` share the same nose slot (confirmed); the zero-overlap combined pose was not rebuilt | viewer placements only |
| Friction 0.4 is optimistic; 45% is not a winding efficiency | **Accepted**: friction 0.2-0.4 range, three efficiencies (table in section 2); 45% is the spec's run-distance figure | spec text |
| L2 is not "docs only" (Card E2 has no `gear_spur_z10`) | **Confirmed** | card lists |
| Bellows row counted the turntable | **Confirmed**: Card B part | flatpack card table |
| Bellows is a clamshell; mech brain tray is 2 TU | Clamshell: per spec text. 2 TU: **not checked** | |
| Coupon ordering, pass/fail thresholds, traction decision | **Accepted** into sections 5 and 6 | |

## 8. Sources

- Jet truck checks: `parts/kip/jetcar_table.py` -> `parts/kip/viewer/jetcar-clearance.json`; driver pose snapshot `parts/kip/viewer/jetcar-kip-pose.json` (from the Truck page's `?probe=sweep`); interactive: `parts/kip/viewer/JetCar-Lab.html`. Nozzle-seat and mass probes: scratch scripts on the generator's own geometry (`toyventor_kitcard._raw_geo`).
- Balloon-car research: [NASA Glenn balloon rocket car](https://www.grc.nasa.gov/WWW/K-12/BGP/Ashlie/BalloonRocketCar_easy.html); [SMU balloon-powered car lab](https://s2.smu.edu/propulsion/Pages/balloonlab.htm); [Eurobricks balloon brick-car thread](https://www.eurobricks.com/forum/forums/topic/9183-help-for-school-project); [Mombrite](https://www.mombrite.com/balloon-powered-le%67o-cars/); [Science Sparks](https://www.science-sparks.com/balloon-powered-le%67o-car/). Read, not just listed. Jet-valve CAD: `mom_jet_valve_body` in `parts/partspec/toyventor_kitcard.py`.

- Overlap table: `parts/kip/windkey_table.py` -> `parts/kip/viewer/windkey-overlaps.json` (per spin, 30 deg steps); interactive: `parts/kip/viewer/WindKey-Lab.html`.
- Clutch, pawl, saddle, key and wall measurements: probes of the committed mockup STLs in `public/kip/partspec/mockup/` (scratch scripts, not kept in the repo).
- Reuse table: part lists in the motion-suite probe frames (`J2_tip`, `J6_demo`) of the committed `Truck-Mockup.html`; tray/lid pairs from the PartSpec catalog; card lists from [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) section 5.
- Stage definitions and band numbers: [progressive-power-system-spec.md](progressive-power-system-spec.md) section 3.2 and [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) section 3.1.

## 9. Historical draft additions for `functional-print-mechanics-spec.md` *(Applied & Superseded 2026-11-02)*

> **Applied status (`2026-11-02`):** Incorporated into [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) (`Review Status`, `§0.1–§0.3`, `§3` Warning, `§3.1`, `§3.4`, `§5`, `§6`) and [progressive-power-system-spec.md](progressive-power-system-spec.md), updated further to reflect the live [`verify_band_jet.py`](../../parts/partspec/verify_band_jet.py) scorecard (`C1`-`C8` all PASS as of 2026-11-03). Kept below as the pre-pass handoff record:

**9.1 Warning banner: fix the count and add two items.** Change "found five `P0` defects" to "found seven defect groups" (bullet 4 already groups three) and append:

> 5. **Unseatable `mom_nozzle_set` and an untested seat:** the set is one `42.0 x 14.0 x 13.5 mm` bar carrying three plugs (`Ø3.0 / Ø4.5 / Ø6.0 mm`). Seated as `_pneumatic_jet_check()` seats it (`rotate((-90, 0, 0))`, `translate((0, 19.05, 12.50))`) the plate sits behind the body and the plugs point rearward (`y = 19.05 .. 32.55`), so no plug enters the `y = 8.5 .. 14.7` socket; the check only tests inlet-to-exhaust air connectivity inside a box (`(0, -3, 24.5)` to `(0, 17.5, 12.5)`), not seating. Turned to point into the body (`rotate((90, 0, 0))`, `y_plate = 19.05 .. 19.2`), one plug overlaps `mom_jet_valve_body` by `83-89 mm3` (its `Ø8.4 -> 7.6 mm` tip lands in the `5.0 mm` tunnel) and the whole bar by `~520 mm3` (the other two plugs hit the turret). The nozzle needs redesigning as individual inserts with the orifice at the rear.
> 6. **Balloon jet not placed on any truck:** on the Snap truck's rear rows 8-9 (body centre `(0, 50.0, 12.5)`) `mom_jet_valve_body` seats with `0 mm3` keel overlap, `1.8 mm` to either wheel size, `25.2 mm` to `kit_windscreen`, on four corner studs only (rows 7-9 have no inner studs), and overlaps the rear `gear_spur_z10` by `442 mm3`, so the jet stage carries no axle gear. A balloon standing straight up on the vertical collar rubs Kip's back and hat from about `Ø125 mm` (soft contact); trailing back past about `45-50 deg` it reaches the jet stream (`z = 25`). Interactive check: `/kip/JetCar-Lab.html`.
> 7. **Jet air path capped near `Ø5 mm`:** `mom_jet_valve_body`'s inlet (`19.6 mm2`, `Ø5.0`), `mom_jet_slide_valve` open port (`20.4 mm2`) and tunnel (`20.6 mm2`) are all about `Ø5`. In series with any nozzle this limits jet thrust to about `A x dP = 0.049 N` (`~5 gf`) at `2.5 kPa`: `Ø3.0` `~3.2 gf`, `Ø4.5` `~4.9 gf`, `Ø6.0` `~4.7 gf`, `Ø8.0` `~3.4 gf`, so the `2.5-14 gf` table is `2-3x` high for `Ø6.0` and a wider nozzle does not help. Rolling drag is `0.066 N` at `150 g` (solid-PLA Snap truck plus jet piece), so no nozzle moves the truck as drawn. The passages must be enlarged (about `Ø8`) before larger nozzles matter.

**9.2 `D3` (line "D3 - Pneumatic geometry").** Replace "Resolved in CAD" with "Open: nozzle set cannot be seated (see Warning item 5)", and replace "while `mom_nozzle_set` press-wedges `4.0 deg` Luer-tapered male plugs ... coaxially into the rear socket (3.4)" with "while `mom_nozzle_set` is intended to press-wedge `4.0 deg` Luer-tapered male plugs ... into the rear socket, which the shipped geometry cannot do (3.4)".

**9.3 Section 3.4.** In the mermaid node `Nozzle`, add "(not seatable as modelled)". After the `_pneumatic_jet_check()` sentence in the last bullet, add: "It also does **not** test that any nozzle plug seats in the socket; the pose it uses leaves the plugs outside the body." Add a performance sentence: "Bound, `2.5 kPa`, `5 L`, nozzle in series with the body's own `~Ø5` air path (inlet `19.6 mm2`, valve port `20.4 mm2`, tunnel `20.6 mm2`): `~3.2 gf` (`Ø3.0`), `~4.9 gf` (`Ø4.5`), `~4.7 gf` (`Ø6.0`), `~3.4 gf` (`Ø8.0`), maximum `A x dP ~ 5 gf` whatever the nozzle; rolling drag is `0.066 N` for the `150 g` solid-PLA Snap truck plus jet piece (the spec's `110 g` reference needs infill) and `0.049 N` at `110 g`, so thrust over drag is `<= 1.0x`." Replace the existing `2.5-14 gf` table in `progressive-power-system-spec.md` (section 3.2, `mom_jet_valve`) the same way.

**9.4 Ladder note (one line under the document banner).** "Decided 2026-11-02 (Dan): ladder Snap -> Motion -> Pro, no separate Mech stage, balloon = `mom_jet_valve_body` with the balloon on top, bellows dropped; see `motion-stage-options-spec.md`."

## 10. Print-and-test sheet: balloon jet and pull-back band (rewritten 2026-11-03)

> **State of the CAD this sheet tests (2026-11-03):** `verify_band_jet.py` `8/8` PASS, `Gate G1` `13/13`, all `205` parts pass the part gate, and the served copies in `public/kip/partspec/` match their validation reports (`kip-validation-index`: `159` of `159`). Nothing has been printed yet, so every number below marked *predicted* is a model result that the print is allowed to contradict.

**Purpose.** Settle what the CAD cannot: (A) does the printed jet seal and move the truck, and how does a real balloon behave on the collar; (B) does the pull-back band core wind, lock, coast and keep its band on the drum; (C) which wheel helps.

### 10.1 What to print and gather

| Test | Print | Source | Note |
| :--- | :--- | :--- | :--- |
| A, jet | `mom_jet_valve_body` | `parts/partspec/toyventor_mom_jet_valve_body_S.stl` (`49.8 x 27.8 x 28.0 mm`, as exported, no supports) | also on `Card E3` |
| A, jet | `mom_jet_slide_valve` | `toyventor_mom_jet_slide_valve_P.stl` (`9.6 x 38.0 mm`, prints lay-flat as exported) | the cross-bore leaks without it; carries the small-parts notice |
| A, jet | `mom_nozzle_set` | `toyventor_mom_nozzle_set_P.stl` (`63.0 x 14.1 x 8.2 mm`, four inserts on tabs round a storage hub) | snap each insert off its tab when you test it; the old one-bar version is gone |
| A+B, truck | Snap truck | keel, 2 barbell shafts, 4 `kit_wheel_med`, windscreen, Kip seated; **no tub, no hinge, no axle gear for the jet** (the jet body overlaps the rear axle gear by `442 mm3`) | an existing Snap truck works; add 4 `kit_wheel_giant` for the wheel test |
| B, band | `Card E2` | `parts/partspec/cards/card_e2_sprue.stl` (`157.2 x 152.1 mm`): band tray and lid, PTO gear, `shaft_tu03`, slam base and plunger, axle `gear_spur_z10`, band spool, two captive pins | or print the parts singly from `parts/partspec/` |
| B, band | Bands | `1x #64` synthetic loop (`89 x 6.4 x 1.6 mm`) for the standard setup; `2x #32` loops (`76 x 3.2 x 1.1 mm`) as the narrow-band option | latex-free synthetic rubber; the `Motion` stage carries the latex notice |
| A | Balloons and pump | 9 inch latex balloons, a hand pump (no mouth inflation: there is no mouthpiece) | ages 8+, supervised; keep burst pieces from small children |
| both | Measuring | kitchen scale (`0.1 g`), tape measure, flat board with a ruler, spring scale or newton gauge (to `15 N`), phone camera at 60 fps on a stand, masking-tape marks every 25 cm | |
| both | Track | smooth tile or laminate, `4 m` or more | |

Slice at your normal PLA settings (`0.4 mm` nozzle, `0.20 mm` layers, no supports) and **write down infill, perimeters and finished weights**; mass is a first-order input. The part gate ran geometry checks only (no slicer on the machine), so a slicer warning on the pawls, the lip or the valve apex is a result worth recording: the gate flags three warnings the print should confirm or clear (`mom_pto_gear_z10` thin cup base, `mom_jet_slide_valve` teardrop apex tip, `mom_band_core_tray` a `0.33 mm` plate over one socket ceiling).

### 10.2 Test A: balloon jet, measurements in order

1. **Mass (T0).** Weigh the finished truck (Kip and a deflated balloon on the collar), the body and the valve. Model: about `150 g` solid PLA.
2. **Rolling drag (T1).** Tilt the board slowly until the truck, pushed gently, just keeps rolling: coefficient = rise / run. Model `0.045` (`2.6 deg`, `4.6 cm` rise per metre); drag force = coefficient x weight (`0.066 N = 6.75 gf` at `150 g`).
3. **Seal (T2).** With the valve OPEN, inflate to about `15 cm`, close it, take the pump off, and watch `15 s`.
4. **Balloon posture (T3).** At `125`, `150` and `175 mm`: does it stand upright, lean, or rest on Kip's hat and back? Film the first run from the side for trail angle, whether it reaches the jet axis, and whether it folds over the nozzle at the end of the burn.
5. **Runs (T4).** For each of the four inserts (`O3.2`, `O4.6`, `O6.1`, `O8.0` as measured; `O3.0 / 4.5 / 6.0 / 8.0` as drawn) and then the bare socket, 3 runs from the same mark with a full `175 mm` balloon: distance, time to stop, acceleration from the video. Thrust = mass x acceleration + drag during the burn.
6. **Wheels (T5).** Repeat the best insert with `O50` wheels (all four, or the rear pair) and note the mass change.
7. **A/B on passage size (T6, optional, cheap).** Print the pre-re-export jet body and slide valve and run the bare socket on both: `git show f60a7b2:public/kip/partspec/toyventor_mom_jet_valve_body_S.stl > old_body.stl` and `git show f125017:public/kip/partspec/toyventor_mom_jet_slide_valve_P.stl > old_valve.stl`. Same balloon, truck and track; only the passage differs (`O5` against `O7`). Predicted `5.1 gf` against `9.2 gf`.

### 10.3 Test A: predictions to beat (written first, so the print can fail)

Model: `2.5 kPa`, two orifices in series (the `38.1 mm2` valve port and the insert), rolling drag `6.75 gf` at `150 g`. Insert figures are from `verify_band_jet.py` `C5`; the bare-socket line is my estimate from the same model.

| Configuration | Predicted thrust | Over drag at `150 g` |
| :--- | ---: | ---: |
| `O3.2` insert | `3.9 gf` | `0.6x` |
| `O4.6` insert | `7.2 gf` | `1.1x` |
| `O6.1` insert | `9.3 gf` | `1.4x` |
| `O8.0` insert | `9.4 gf` | `1.4x` |
| bare socket (tunnel exit, `52.6 mm2`) | about `9.2 gf` | about `1.4x` |
| T6 old body, bare socket (`O5` passages) | about `5.1 gf` | about `0.75x` |

**What moves the ratio (read this first if the truck only just fails).** Over drag = thrust / (rolling coefficient x mass), and thrust scales with balloon pressure. Starting from the best insert (`9.4 gf` at `2.5 kPa`, `0.045`, `150 g`):

| Change | Value | Over drag |
| :--- | :--- | ---: |
| Truck mass | `110 g` / `120 g` / `150 g` / `175 g` / `200 g` | `1.9x` / `1.7x` / `1.4x` / `1.2x` / `1.0x` |
| Rolling coefficient (at `150 g`) | `0.035` / `0.045` / `0.060` | `1.8x` / `1.4x` / `1.0x` |
| Balloon pressure (at `150 g`) | `1.5` / `2.0` / `2.5` / `3.0 kPa` | `0.8x` / `1.1x` / `1.4x` / `1.7x` |

The `1.3x` rule holds up to a truck mass of about `160 g` at the model's coefficient and pressure, and the ratio reaches `1.0x` near `210 g`. The model uses a constant `2.5 kPa`; a real latex balloon's pressure is highest early in the burn and falls as it deflates, so the mean over the burn may sit below that. The video acceleration in T4 shows the actual curve: compare the first and last quarter of the burn before blaming the passages.

The valve port (`38.1 mm2`) is the limit: the series ceiling is `9.7 gf`, so `O8.0` should buy almost nothing over `O6.1`. The margin over the `1.3x` rule is thin (`1.38x`): if the truck only just fails, check T0 and T1 first, because mass and drag move the ratio as much as the model does. If it moves clearly less than predicted, say so in the record and fix section 2; if it moves with the old body (T6), the passage model is wrong.

### 10.4 Test A: pass rules (agreed by Dan, 2026-11-02) and what each outcome means

| Result | Rule | If it fails or surprises |
| :--- | :--- | :--- |
| Seal | `15%` diameter loss or less in `15 s` | thicken the `0.60 mm` web between the inlet rim and the tunnel lip; the jet is not usable until it holds |
| Moves | thrust over drag `1.3x` or more with some insert, as drawn | predicted pass with `O6.1` and `O8.0`. Fix order: lower mass (infill, Kip off), `O50` wheels, then a larger valve port (the limit; needs a bigger spool, not drawn) |
| Goes | mean of 3 runs of `2 m` or more on tile | lower mass, `O50` wheels, or larger passages |
| Balloon clear | trail angle under `45 deg` in every frame, jet never obstructed | add a rear stop; if it folds over the nozzle at the end of the burn, a cradle or a shorter neck |
| Soft contact | tracks straight within `10 cm` over `2 m`, Kip not knocked over | hold the balloon back about `30 deg` (an angled neck seat) or use a smaller balloon |

### 10.5 Test B: pull-back band core, in order

1. **Assemble and look (B0).** Tray, lid, PTO gear and spool on `shaft_tu03` in the real saddles, axle gear below. Check by hand: the spool turns freely on the shaft, the gear meshes with the axle gear without binding, the lid closes over the gear dome. With the band off, turn the gear both ways: it should **lock the spool one way and slip the other** (the pawls click over the sawtooth). Record which way each turn goes against the truck: dragging the truck backward must wind, releasing must drive it forward.
2. **Tyre friction (B1).** A sled or the truck itself on the real floor, four ways: `O36 / O50` x bare PLA / O-ring. Wind `2.5` turns by pulling the truck back with a hand press you can measure (a gauge on the truck). *Predicted:* bare PLA below friction `0.3` slips and fails; the O-ring or `O50` option is then the decision.
3. **Shaft capture (B2).** With the lid on and the band wound, watch whether the shaft lifts out of a saddle. *Predicted:* `0.35 mm` worst case against the `0.5 mm` limit.
4. **Band torque (B3).** Spring scale on the band at `2.5` turns. *Predicted:* torque `35` to `65 N.mm`, which is about `5.5` to `10 N` of force at the drum radius (`6.4 mm`). Use `1x #64` first, then `2x #32`.
5. **Retention (B4, the open design question).** The spool carries a `R7.2` retaining lip, the smallest shape that prints without supports; it leaves about `1.6 mm` of drum above it for a `6.4 mm` band. Wind, release and repeat for `20` or more rapid launches. *Check:* does the band stay on the drum and clear of the pawls, or does it walk down into the pawl zone and jam?
6. **Runs (B5).** 3 runs each on `O36` and `O50`, from the same mark, hard floor: distance, and whether the clutch freewheels in the coast. *Predicted:* `2.0` to `3.5 m` if the clutch freewheels cleanly, `0.8` to `1.2 m` if the pawl drag acts throughout the coast (about `0.12 N` on `O36`, `0.084 N` on `O50`); the bench settles which.
7. **Skip torque (B6, optional).** Add torque by hand against a locked wheel until the clutch skips. *Predicted:* comfortably above the `65 N.mm` launch peak.

### 10.6 Test B: pass rules and what each outcome means

| Result | Rule | If it fails or surprises |
| :--- | :--- | :--- |
| Winds | `2.5` turns with a hand press of `8 N (0.8 kgf)` or less, no slip | `O50` wheels, then an O-ring groove on both wheel sizes |
| Locks the right way | winds on the pull-back, drives forward on release, freewheels in the coast | wrong way round means the mirror is wrong in print (it passes `C1` in CAD): stop and send the photo |
| Skip torque | above `65 N.mm` with margin | a pawl is skipping: check the bite (`0.78 mm` drawn) and print orientation |
| Shaft | lift `0.5 mm` or less | thicken the saddle or add a lid keeper rib |
| Band retention | band stays on the drum over `20+` launches | **fixes, cheapest first:** (1) use the `2x #32` loops (`3.2 mm` wide each); (2) tape a ring on the drum above the pawls to confirm the diagnosis; (3) redesign: a separate flat-printed retaining ring that snaps onto the drum (needs CAD, not drawn) |
| Goes | mean of 3 runs of `2 m` or more | `O50` wheels, O-ring tyres, lighter truck, or a higher-torque band |

### 10.7 Record sheet (one row per run)

**Jet:** date, body infill and weight, truck mass, drag coefficient, wheel size, insert (bore), balloon diameter at start, pressure note, distance, stop time, peak acceleration, trail angle (max), contact with Kip (none / rubs / pushes), jet obstructed (y/n), seal loss over `15 s`, notes.
**Band:** date, wheel size and tyre (bare / O-ring), band (`#64` or `2x #32`), turns wound, hand press at `2.5` turns, scale reading, clutch direction (winds / drives / coasts), shaft lift, band on drum after `20` launches (y/n), distance, notes.
Keep the video for both.

### 10.8 Cost and time

Jet: three small prints (about `19 g`, `2 g` and `3 g` at solid), a bag of balloons; about two hours for T0 to T5, plus one hour for the T6 A/B. Band: one plate (`Card E2`) and two bands; about two hours for B0 to B5. The results decide whether the next step is a cradle, a bigger valve port, a retaining ring, or a clutch tweak, and which of the parked warnings (PTO cup base, tray plate) matter.
