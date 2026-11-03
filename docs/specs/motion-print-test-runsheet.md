# Motion print tests — bench run sheet

Companion to [motion-stage-options-spec.md](motion-stage-options-spec.md) §10 (procedures and pass rules live there). This sheet is values only: predictions written first, blanks for measured results. CAD last re-verified 2026-11-03: `verify_band_jet.py` 8/8 PASS, 0 FAIL, 0 UNKNOWN.

## Print manifest (PLA, 0.4 mm nozzle, 0.20 mm layers, supports OFF)

| File | Sliced (15% infill) | Time | Finished weight (write in) |
| --- | --- | --- | --- |
| `parts/partspec/toyventor_mom_jet_valve_body_S.stl` | 10.6 g | 1 h 16 | |
| `parts/partspec/toyventor_mom_jet_slide_valve_P.stl` | 1.5 g | 12 min | |
| `parts/partspec/toyventor_mom_nozzle_set_P.stl` | 2.4 g | 21 min | |
| `parts/partspec/cards/card_e2_sprue.stl` | 74.2 g | 8 h 14 | |
| Snap truck (keel 32.8 g, shaft 2.5 g each, O36 wheel 6.6 g each, windscreen 12.0 g) | ~76 g | | |
| `kit_wheel_giant` (O50), each (Test C) | 11.9 g | 1 h 25 | |

Gather: 9 inch balloons + hand pump, 1x #64 band, 2x #32 bands, kitchen scale (0.1 g), spring scale to 15 N, tape measure, phone camera 60 fps + stand, tape marks every 25 cm, 4 m+ smooth track.

Slicer warnings to confirm or clear in print: `mom_pto_gear_z10` thin cup base, `mom_jet_slide_valve` teardrop apex, `mom_band_core_tray` 0.33 mm plate. Watch bridges: slam base 62.3 x 13.3 mm roof, band lid 7.1 x 14.9 mm roof.

## Test A — balloon jet (§10.2 order)

| Step | Predicted (model) | Measured | Pass rule (§10.4) |
| --- | --- | --- | --- |
| T0 truck mass (Kip + deflated balloon) | ~109 g sliced (150 g solid) | | record only |
| T1 rolling coefficient | 0.045 (drag 4.9 gf @ 109 g) | | record only |
| T2 seal, 15 s @ ~15 cm | holds | | diameter loss ≤ 15% |
| T3 balloon posture 125/150/175 mm | upright | | trail < 45 deg, jet never obstructed |

T4 runs (175 mm balloon, 3 runs each; thrust = mass x accel + drag):

| Insert | Predicted thrust | Over drag @109 g | Run 1 dist/time | Run 2 | Run 3 | Mean dist | Peak accel | Verdict (≥1.3x, ≥2 m) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O3.2 | 3.9 gf | 0.8x | | | | | | expect fail |
| O4.6 | 7.2 gf | 1.5x | | | | | | |
| O6.1 | 9.3 gf | 1.9x | | | | | | |
| O8.0 | 9.4 gf | 1.9x | | | | | | ~nothing over O6.1 |
| bare socket | ~9.2 gf | 1.9x | | | | | | |

T5 wheels: repeat best insert on O50 (note mass; sliced truck ~130 g): runs ____ ____ ____, coefficient ____ . Pays off only if coefficient falls by more than the +21 g costs.

T6 optional A/B: old body/valve (O5 passages, predicted 5.1 gf) vs new (9.2 gf), bare socket: old ____ / new ____. If old body also moves well, the passage model is wrong — record it.

Soft contact: tracks straight within 10 cm over 2 m, Kip stays up: y/n ____.

## Test B — pull-back band core (§10.5 order)

| Step | Predicted | Measured | Pass rule (§10.6) |
| --- | --- | --- | --- |
| B0 clutch by hand | locks one way, slips the other; backward drag winds | | winds on pull-back, drives forward, freewheels in coast |
| B1 tyre friction O36/O50 x bare/O-ring | bare PLA < 0.3 slips | | 2.5 turns at ≤ 8 N hand press, no slip |
| B2 shaft lift, lid on, wound | ≤ 0.35 mm | | ≤ 0.5 mm |
| B3 band torque @ 2.5 turns (#64 / 2x #32) | 35-65 N.mm (5.5-10 N @ 6.4 mm) | | record; skip torque > 65 N.mm (B6) |
| B4 band retention, 20+ launches | open question (1.6 mm drum above lip) | | band stays on drum, clear of pawls |

B5 runs (hard floor, same mark):

| Wheels | Predicted distance | Run 1 | Run 2 | Run 3 | Mean | Freewheel in coast? |
| --- | --- | --- | --- | --- | --- | --- |
| O36 | 2.0-3.5 m clean coast; 0.8-1.2 m with pawl drag | | | | | |
| O50 | same range; pawl drag ~0.084 N vs 0.12 N | | | | | |

Pass: mean ≥ 2 m. B4 fix order if it walks: 2x #32 loops, then tape-ring diagnosis, then snap-on retaining ring (needs CAD, not drawn).

## Test C — wheel choice

Decided by T5 + B1 + B5 together: O50 wins if (a) jet coefficient drop beats +21 g, and/or (b) band winds slip-free on O50 where O36 slipped. Decision: ____________ (date ______).

Keep video for every run (§10.7 per-run fields). Record failures as written; a contradiction updates the spec, not the sheet.
