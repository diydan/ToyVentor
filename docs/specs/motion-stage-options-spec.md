# Spec (draft for review): first motion stage, key-wound vs pull-back, and the stage ladder

**Status:** draft 3, 2026-11-02, for Dan's review. **Decided by Dan (2026-11-02): the ladder is Snap -> Motion -> Pro, with no separate Mech stage (its advanced parts merge into Pro), and a bigger-wheel option is wanted in every stage.** Still open: pull-back vs key for Motion (recommendation below), and the Pro powered-module questions (section 6). Mechanical soundness only: no age grading, compliance or card layout here. **Nothing in CAD or in the locked spec has been changed.** If this is accepted, the changes go into [progressive-power-system-spec.md](progressive-power-system-spec.md) and [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md).

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
| **2 Motion** | one core in the rear rows 6-9 at a time, fixed axles: **(a) pull-back band core**, **(b) balloon**: bellows lifting the tub, and the jet valve set | `band`, `bellows` | mixes lines: bellows base/leaf and jet valve body are Snap-line; the band core needs Pro-line hardware (axle `gear_spur_z10`, `shaft_tu03`, spool, PTO gear) |
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

Decided: ladder Snap -> Motion -> Pro; no Mech stage; bigger wheel wanted.

Still open:

- **Pull-back only, key dropped for now?** (my recommendation: yes; section 4 item 2)
- **Pro's powered module: required or optional?** Merging Mech into Pro makes Pro 10+ unless the servo, drive motor and brain stay an optional add-on with its own grading. I suggest optional: Pro = hand-steered rack steering, plus a powered upgrade.
- **Hand steering and servo steering together?** The Mech truck drops the steering column and wheel; the merged Pro needs one rule.
- **Traction:** O50 first, then an O-ring groove (my suggestion), TPU sleeve only if the coupon says so.
- Does moving Motion before Pro re-cut the cards (Card E2 needs a `gear_spur_z10`)? It will; confirm that is acceptable.
- Is one shared tray/lid across the cores a goal, or too large a change for now?

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

- Overlap table: `parts/kip/windkey_table.py` -> `parts/kip/viewer/windkey-overlaps.json` (per spin, 30 deg steps); interactive: `parts/kip/viewer/WindKey-Lab.html`.
- Clutch, pawl, saddle, key and wall measurements: probes of the committed mockup STLs in `public/kip/partspec/mockup/` (scratch scripts, not kept in the repo).
- Reuse table: part lists in the motion-suite probe frames (`J2_tip`, `J6_demo`) of the committed `Truck-Mockup.html`; tray/lid pairs from the PartSpec catalog; card lists from [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) section 5.
- Stage definitions and band numbers: [progressive-power-system-spec.md](progressive-power-system-spec.md) section 3.2 and [functional-print-mechanics-spec.md](functional-print-mechanics-spec.md) section 3.1.
