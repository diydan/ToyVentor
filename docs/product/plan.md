# ToyVentor — 10-Day Plan

Active means testable in the app, not merely written. Submission is November 4,
2026.

## Goal

Ship a trustworthy 90-second demo: scan or choose a toy, equip upgrades, play,
open a pack, reveal the card, and print the part.

## Success Criteria

- Every demo control works; dead controls do not ship.
- Pack, Reveal, scan fallbacks, save/load, and Continue behave.
- Print files are genuinely producible with exact prototype disclaimers.
- Kid-facing and engineering facts agree.

## Approach

Build the daily-charmer surface first, then the pack flow, then fabrication,
then the submission freeze. Keep each stage testable before moving on: no
stage is done until its behaviors pass in the app, not merely in a doc or a
mockup.


## Steps

### Days 1–2 · Daily-charmer surface

Ship remaining controls behind working buttons, make Kip’s enlarged controls
legible, and stabilize save/load, Continue, seeds, and scan fallbacks.

### Days 3–4 · Pack flow

Polish sound, confetti, theme, and reveal without changing odds or ownership.
Make unclaimed dots, equipped pulls, misplaced-part guidance, daily claims,
and grown-up unlock beginner-proof.

### Days 5–7 · Fabricate and connect

Test fit and print behavior across bridged sets, keep prototype disclaimers
exact, and finish packaging and sustainability wording.

### Days 8–10 · Submission

Freeze the demo path, remove or finish dead ends, record the video, finalize
the write-up, and verify the live deploy.

## Validation Plan

Smoke checks, canonical review payload, live world page, seeded and fresh
mission states, offline/cache behavior, and print gating all pass before
recording. Typecheck, tests, build, and preflight stay green; the generated
spec review copy is regenerated from the canonical spec.


## Risks / Open Questions

Model availability, physics edge cases, printer variance, pack-edge states,
and final compliance remain the main risks. Name failures in the demo rather
than improvising around them.
