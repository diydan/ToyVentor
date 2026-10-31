# Compliance checklist (United States)

> Not legal advice. A working list to take to a CPSC-accepted test lab and to counsel. The EU (EN 71) is out of scope until an EU launch.

## First, decide who the manufacturer is

- **If we print and ship parts**, we are the manufacturer of a children's product, and everything below applies to us.
- **If families print at home from our files**, the obligations may sit differently. Get advice before launch; this choice shapes the whole list.

## Requirements

| Requirement | What it means for us | Status |
| --- | --- | --- |
| ASTM F963-23, mandatory under 16 CFR 1250 since 20 April 2024 | The toy safety standard for products for children under 14 | Not started |
| Third-party testing at a CPSC-accepted lab | Every part family tested to F963-23 and the rules below | Not started |
| Children's Product Certificate | Issued from the lab results, kept on file, available on request | Not started |
| Tracking labels (CPSIA section 103) | Batch and source marks on the product and packaging, so a print run can be traced | `24x8x0.4 mm` underside recess molded on `kit_keel_base`; batch mark format pending |
| Small parts ban for under 3 (16 CFR 1501) | Nothing is offered for under 3 while Snap is 3 and up only (Large parked 2026-10-28). If Large returns, its parts must never fit the small-parts cylinder, also after use-and-abuse tests | Design screen in place (Large parts must clear the cylinder); lab test pending |
| Small parts warning for ages 3 to 6 (16 CFR 1500.19) | Small-line parts that fit the cylinder carry the choking-hazard warning on packaging and listing | Warning text generated per part; packaging not designed |
| Latex balloons & elastomer bands in Stage 3 Momentum (16 CFR 1500.19(b)(2)) | Stage 3 (`Momentum`, 8 and up) balloon-jet/bellows modules require the statutory uninflated/broken latex balloon choking-hazard warning for children under 8, plus a natural-rubber latex allergy notice (recommending latex-free EPDM bands) and band inspection instructions | Specified in Stage 3 Momentum spec; packaging/print-page notice pending |
| Use-and-abuse tests | Drop, torque, tension and compression, then the small-parts check on anything that comes off | Check F2 is pending: needs printed samples |
| Sharp points and edges (16 CFR 1500.48 and 1500.49) | Printed edges, gear teeth, sprue gate nicks and thin fins must pass | Not tested |
| Lead in substrate and coatings, phthalates (CPSIA; 16 CFR 1303, 1307) | Filament and any paint or coating must meet the limits | Need supplier certificates for every filament colour |
| Batteries & radio in Stage 4 Mech (F963-23 §4.25, IEC 62133, FCC Part 15, COPPA) | Stage 4 (`Mech`, 10 and up) specifies a captive-screw rear battery door (`ASTM F963-23` §4.25), protected `3.7 V` `IEC 62133` cell, pre-certified Wi-Fi/BLE module with antenna keep-out (`FCC Part 15`), and local-LAN zero-PII control (`COPPA`). Toys meeting F963 battery rules are outside Reese's Law | Pre-CAD specification only; no Mech hardware built yet |
| Removable join pins in hugging mounts | Pins are small parts. Allowed with the warning on Small (3 and up) and Pro (8 and up) mounts; never on Large (under 3), which joins permanently | Enforced by the generator |
| Age grading | Snap Small (Stage 1): 3 and up; Pro & Momentum (Stages 2–3): 8 and up; Mech robotics (Stage 4): 10 and up. Snap Large (under 3) is parked | Set in `interfaces.json` and specs |

## How our design checks map to this

- **S1 small-parts screen** is a conservative design-time estimate of the 16 CFR 1501 test. It never replaces the lab test.
- **F2 breakage** stands in for use-and-abuse testing and stays pending until printed parts are tested.
- **F1 printed fit** confirms parts connect as designed; it is quality, not compliance.

## Sources

- CPSC, Safety Standard Mandating ASTM F963 for Toys: https://www.federalregister.gov/documents/2024/01/18/2024-00741/safety-standard-mandating-astm-f963-for-toys
- CPSC toy safety business guidance: https://www.cpsc.gov/Business--Manufacturing/Business-Education/Toy-Safety
