# ToyVentor — 10-Day Plan

## Goal
Ship ToyVentor — helping the next generation grow into robotics through play: scan it, augment it, print it, play it — for the Meta Global AI Developer Hackathon (indie track), submitted by Nov 4, 9:00 PM ET. Grounded in [vision](vision.md), [submission vision](submission-vision.md), [spec](spec.md) and [wireframe](wireframe.md); progress logged in [journal](journal.md).

## Success Criteria
- Scan a car to a colored upgrade in the game on a phone in under 60 seconds.
- Every pack item works in AR and in the game. One printable part per pack.
- STL export in under 10 seconds with checks passing.
- Market only shows parts that fit the scanned toy (mount + size class).
- A new expansion set loads from its set file with no code change.
- Reveal plays entrance animation + 15s theme song once, then saves.
- A build made in the virtual builder passes checks with no physical parts.
- Submission confirmed with video, screenshots, description.

## Approach
Build one car end to end, then widen. Scan -> builder -> AR -> game -> STL -> Reveal, each day demo-able on a phone. Freeze core demo end of Day 7. Days 8-9 add Pro teaser and Live Play buttons, then rehearse. Day 10 stretch only if Days 2-9 are green. Seed content pre-generated so the demo never waits. Preloaded toy covers live scan failure.

## Steps
1. **Day 1 — Oct 26: Foundations (done).** Core: scope lock, PWA shell on Workers + Static Assets, toybox, part format, seed car. Stretch: Factory map status dots (wireframe p.1-2).
2. **Day 2 — Oct 27: Scan.** Core: SAM 3.1 outline, size class, attach point, preloaded backup; car + figure saved (p.3). Stretch: manual size slider.
3. **Day 3 — Oct 28: Virtual builder.** Core: viewer, grid snap (stud + hole), collisions, undo, stand-in body; first 6 hero parts (p.4). Stretch: bridge plate preview.
4. **Day 4 — Oct 29: Checks + Print.** Core: 4 live checks (on grid, fits toy, support-free, fits bed), STL export, Mount + Snap print test in 1 size (p.9). Stretch: filament + print time estimate.
5. **Day 5 — Oct 30: AR + Skin.** Core: AR try-on true-scale, Muse Image skin, equip (p.4). Stretch: second seeded skin.
6. **Day 6 — Oct 31: Game + Reveal.** Core: mini game with printed-part boost (p.11), entrance clip + Mureka song + character card, plays once then saves (p.12). Stretch: win clip reuse.
7. **Day 7 — Nov 1: Market freeze.** Core: My Toys fit filter, 2 seeded Forge Club sets, seeded daily pack (p.5, p.7-8). Core demo frozen end of day. Stretch: pack rip animation.
8. **Day 8 — Nov 2: Pro teaser.** Core: rounded TU05 beam, friction pin, 1 gear pair on same Mount; Pro part equips in game. Stretch: gear ratio readout.
9. **Day 9 — Nov 3: Live Play + Rehearsal.** Core: 4 mood buttons + 4 loop crossfades, two clean timed runs, backup video recorded. Stretch: offline cache check on 4G.
10. **Day 10 — Nov 4: Submit.** Core: final demo record, form/video/screenshots by 9 PM ET, code hard stop 6 PM ET. Stretch if ahead overall: 3 voice keywords via Muse Voice Transcribe + 1 STEM gear ratio challenge.

## Validation Plan
- Daily: end-of-day phone check of what is demo-able right now, logged in journal.
- Day 4: Mount + Snap part prints support-free; checks pass in demo size.
- Day 6: full scan-to-Reveal loop under 60s; STL timed under 10s.
- Day 7: Market returns only fitting parts on 2 hero toys; frozen build runs with backup path.
- Day 9: two clean runs back-to-back under 60s; fit promise re-verified.
- Day 10: submission confirmation + entry URL logged.

## Risks / Open Questions
- SAM quality on phone photos is highest risk (Day 2 gate). Backup toy must always demo.
- Fit at ~0.1 mm play needs calibration loops. One demo size only to halve print tests.
- Song latency hurts Reveal. Pre-generate hero songs; animation must not wait on audio.
- The one-system claim is unproven for the newest Pro humanoid work until every humanoid part emits typed connection metadata and a new head demonstrates a direct Snap mate or fit-checked adapter in a validated assembly.
- Parametric part authoring is still contested: hand-written OpenSCAD, the PartSpec generator, and the best AI-assisted design/review workflow are not yet one route. This must lock by end of Day 5 (Oct 30) — lattice, connector/metadata contract and export path — because broad print tests cannot start until there is exactly one geometry truth to print.
- Non-goals stay cut: full Pro families, camera scene detection, STEM library + classroom, Merge Forge, Recycle, Color rig, electronics, delivery, open UGC, checkout, native app.
