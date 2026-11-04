# ToyVentor — the 10-day plan, and what actually landed

**Submission: November 4, 2026, 9:00 PM ET.** This file was the forward plan
for the ten days of the hackathon. On the last day it became the record of what
shipped. The deep record of each day, with the commits and the failures, is
the [journal](journal.md); this file is the short version you can read in a
minute.

Active means testable in the app, not merely written.

## Goal

Ship a trustworthy 90-second demo: scan or choose a toy, equip upgrades, play,
open a pack, reveal the card, and print the part.

## Success criteria

- Every demo control works; dead controls do not ship.
- Pack, Reveal, scan fallbacks, save/load, and Continue behave.
- Print files are genuinely producible with exact prototype disclaimers.
- Kid-facing and engineering facts agree.

## The days

| Day | Date | Goal | Shipped |
| --- | --- | --- | --- |
| 1 | Mon Oct 26 | Kickoff and scope lock | The scope locked to `spec.md`, the track confirmed (indie), the app named ToyVentor. Spec plus a 12-page wireframe, no code. |
| 2 | Tue Oct 27 | Scan and Toybox | The React + TypeScript + Vite SPA foundation for Cloudflare Workers, and **SAM segmentation working** end to end through the Worker. The BlockML spike was the day's open question. |
| 3 | Wed Oct 28 | Augment and AR try-on | The virtual builder, the mini game, packs, the STL/GLB pipeline (`c64839f`), Reveal and the offline PWA (`76e5c48`), SAM outline try-on with Muse Image skins (`2543997`). PartSpec landed: a Python generator on one 12.5 mm TU lattice. |
| 4 | Thu Oct 29 | Pack rips | The deterministic daily pack (3 parts, first printable), rarity badges, one stat per part, the app ↔ ToyVentor World hand-off, and the model route behind Create mode. |
| 5 | Fri Oct 30 | Fabricate and connect | **One lattice, one contract, one export path** (decision 0005). The game lane moved onto React, the whole app consolidated onto the single-stage World, and the native canvas port replaced the iframe facade. All six heads generated and validated. |
| 6 | Sat Oct 31 | Market and print | 27 commits: the world splits, the Toy Box and XP phases 1 to 4, the headless-Chrome e2e suites, the viewer and asset work at 53 parts and 41 assemblies. The fit-filtered market was **not** built — the day went to the print half instead. |
| 7 | Sun Nov 1 | Colour and play | 41 commits: the 3MF print workflow M1+M2 (`509e7c2`), the Describe & Build tab (`fafe1be`), the quest board and Rank 5 roster, the asset optimization merge with 85 payloads, Town, and the Kit/Mech/Momentum generators. The AR colour preview and mini-game equip were **not** built — the day went to print, assets, Town and recovery. |
| 8 | Mon Nov 2 | Reveal and theme song | The crown rebuild (26 hair and hat STLs with zero-support ledges and 26 validation reports), the kit-tray M6 print workflow (`7803b2c`), the Forge eval harness with a v0 baseline of 47/60 first attempt, and **Calibration Print 1's scorecard, measured by hand**. |
| 9 | Tue Nov 3 | Polish and demo | The explorer trail map, the Garage phase 1, the carousel's six Little-ones rungs, Workshop 4c and 4d (one menu, one print view, mounted in the game), playful interactions (drag-to-feed), and the first construction parts. |
| 10 | Wed Nov 4 | Submit | Glimmer v1 measured on Modal, the deploy-readiness repair, the kid-safe word lists in seven languages, and the runbook for the demo. |

**Two goals were missed and are recorded as misses.** The fit-filtered market
(Day 6) and the AR colour preview with mini-game equip (Day 7) were written
into the plan and not built. They were not quietly rewritten.

## Where the app stands on submission day

**Live and demo-able:** the one-stage World; scan with the SAM 3.1 outline and
the seed backup; the builder with grid snapping and four checks; the daily
pack; the Character Card Reveal; the gated STL and `.3mf` export; the
Kip bench with wardrobe, selfie, Describe & Build and the plate print view;
the Workshop with the Kip, Truck and Yard benches; the explorer trail map;
the Garage; STEM XP and Maker Ranks 1 to 6; the end-of-level song and the
dance party; Make from words on the hosted model.

**Built but off by default, and labelled as such in the demo:** the theme song
(`THEME_SONG=on` plus a Mureka key, metered at five songs a week a device);
the voice route's remote provider; the showcase switch that turns the
grown-up checks off.

**Built but not reachable from the deployed site:** Make from words needs the
optimizer daemon, which runs on Dan's Mac. A live demo of it needs that Mac
and `npm run dev`, or the pre-generated parts.

**Not built, and not claimed:** anything printed (no physical coupon is
signed off, so `F1_printed_fit` and `F2_breakage` stay false); the deployed
fitness of Glimmer; the `Pro Powered Add-On` firmware; the real-life leg of
the Garage; the per-gate switchboard for the Workshop print gate; the
compliance work in [coppa-readiness-spec.md](../specs/coppa-readiness-spec.md).

## What is still open on submission day

| # | Open item | Why it is open |
| --- | --- | --- |
| 1 | The real-phone and real-child pass | Never run by a person. The carousel documents say so outright; the blanks are in [qa.md](qa.md) parts 5 and 6. |
| 2 | The live deploy and the rate-limit rule | The Cloudflare dashboard rule on `/api/muse/spark` (10/min/IP) is the real cost bound; the in-isolate backstop is best-effort. |
| 3 | Glimmer's four endpoint failures | Three HTTP 500s and one timeout in the 40-wish run, with no Modal logs read yet. The Worker does not retry a 5xx. Nov 4 stays on the hosted model. |
| 4 | One brand word through the filter | "Mickey Style Ears Hat" got past the output filter. Bare "mickey" and "minnie" are now in the filter with a test. |
| 5 | The six translated word lists | A hand translation, not read by a native speaker. The English age-fit list is unchanged; the obscenity lists come from LDNOOBW. |
| 6 | The physical print tests | The bench coupons gate geometry decisions, not the app. The procedures are in [parts-engineering-spec.md](../specs/parts-engineering-spec.md) §11. |
| 7 | The bulldozer | A lift sweep and a friction study, no CAD. v1 is float only: holding the blade would need a carry strut. |
| 8 | The Workshop print gate, phase 4 | The grown-up question in front of the exports is built for the Workshop but deferred for the switchboard. |

## What the demo may and may not say

**May say:** "Describe a hat or a head; the part is checked by the same print
gates as the catalog before it is called printable." "Runs on Meta's Muse
Spark in the demo; a self-hosted Muse Glimmer runs the same feature, measured
on 40 wishes, and is the route for children because Meta's hosted API terms
are for adults."

**May not say:** that Glimmer is in production or the default; that anything is
deployed; that the build complies with children's privacy law (the assessment
is not done); that parts are safe because they are "AI-made" — the gates check
printability, not taste.

**Say once, out loud:** this demo uses Meta's hosted model with adults
operating it ([decision 0008](../decisions/0008-meta-models-and-under-18-users.md)).

## After the submission

The "Later" entries in the [journal](journal.md) hold the parked work: time of
day and weather, the Max phase (real robots), and the asset suggester with
ScanDex. The privacy work is
[coppa-readiness-spec.md](../specs/coppa-readiness-spec.md) P0 to P5, which
must be done before any real child uses a deployed build or the address is
given to families.

## Changing this file

Keep it a status record, not a plan. When something lands, move it from
"still open" into the day's row and say what proved it. When a goal is missed,
record it as a miss rather than rewriting the goal.
