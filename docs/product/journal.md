# Hackathon Journal — ToyVentor

Meta Global AI Developer Hackathon, Oct 26 – Nov 4 (10 days × morning + evening = 20 check-ins).
Project: ToyVentor on toyventor.com (renamed from ToyForge on Oct 28). Track: indie. Key phrase: "multi-modal Lego — scan it, augment it, print it, play it."

How this works: each morning say "start day N" for the Start of Day questions; each evening say "end day N" to log what shipped. Submission due Nov 4, 9:00 PM ET.

---

## Day 1 — Mon Oct 26: Kickoff + Scope lock (in progress, extended into Oct 27 morning)

### Start of Day
- [x] Watched kickoff livestream
- [x] Track confirmed: indie. Theme: Build for Your World
- [x] Scope locked to spec.md

### End of Day
- Shipped: ideation, landed on ToyForge. Building blocks: ToyVentor Snap + Pro (Pro scope TBD). First product design concepts.
- Origin story: Lego fanatic as a kid, robotics fanatic as an adult; built for my son's ingenuity, with STEM hidden inside a gamified, AI-powered Lego.
- Demo-able right now: spec + 12-page wireframe only, no code yet.
- Blockers: none (idea stage).
- Tomorrow's first task: Scan + Toybox (Day 2).

---

## Day 2 — Tue Oct 27: Scan + Toybox

Goal: photo a toy, detect mount + size class, save to toybox (wireframe p.2-3).

### Start of Day
- [ ] One thing that must work by tonight:
- [ ] SAM path segmentation: what are you trying first?
- [ ] Which physical toy is the test subject (car / figure)?
- [ ] Workshops/office hours to attend today:

### End of Day
- Shipped: docs reorganised into docs/ with Snap and Pro canonical; spec de-duplicated with origin story, example part record, rejected alternatives, honest open questions. App foundation committed: React + TypeScript + Vite SPA for Cloudflare Workers (PWA-ready, not hosted, no service worker yet), Factory/Toybox/Scan screens, Worker API, shared part/toy/set schemas, four builder checks as pure functions, base set as data with validator, seed car + seed figure. Also: under-8 Snap guidance (open-ended, no fail states, 2.5D, ages 1–3 narration layer); household-object characters (SAM outlines a cup or slipper, it sprouts limbs); push-to-talk in the wireframe; design guide and mockups; four Snap sample OpenSCAD parts (Brick 2x2 both sizes, Dragon Wing, Glow Star Capsule) matched to the base set, none printed.
- Discovery: [BlockML](https://blockml.org/) — one model rendering to software, documents, and physical things. Fits our parts pipeline exactly; unproven until tomorrow's spike (one real part through it vs hand-written OpenSCAD, decide before Day 4's print gate).
- SAM segmentation: WORKING. Test subjects ended up a coffee cup and water bottle — better for the household-object direction than the car. Live sam-3.1 through our Worker: image inline as base64 (Files-upload path is video-only, silently zero-matches images), streaming Responses API, boxes from the output_text lane. "cup" and "water bottle" matched first try; a 210 mm scale anchor derived a 65 mm width. Lessons: one short noun per request ("coffee cup" missed, "cup" hit); SAM gives proportions not millimetres, so a human sets the real longest side; un-outlineable toys save "by hand", never fake-scanned. Still to prove: real phone photos. Caught in time: the API key briefly sat in a committed file; moved to gitignored .dev.vars before any commit.
- Blockers: OpenSCAD not installed — zero STLs, zero prints. Day 4's calibration test is the hard deadline (BlockML may reroute authoring, not the deadline). Nothing deployed (no D1/KV, no domain). Journal day goals and plan day steps have drifted; plan wins from tomorrow.
- Tomorrow's first task: real cup + bottle phone photos, timeboxed BlockML spike on one part, then Day 3 per plan: virtual builder viewer with grid snapping on the scanned toy's stand-in body.

---

## Day 3 — Wed Oct 28: Augment + AR try-on (today, day 3 of 10)

Goal: snap-on parts tray + true-scale AR preview (wireframe p.4).

### Start of Day
- [x] Must work by tonight: scan → build on the grid → try the part on at footprint scale, end to end in browser.
- [x] Build first (from the 24-part hero set): the 8-part base set already in sets/base.json (Spoiler, Brick 2x2 small + large, Forge Mount, Dragon Wing, Glow Star Capsule, TU05 beam teaser, Racer skin). Other 16 wait for proof the first 8 fit and print.
- [ ] AR device/browser: headless desktop Chrome only so far. Real phone (Android Chrome) still owed.

### Midday (13:09)
- Committed since last night: virtual builder (isometric canvas, drag/snap/collisions/undo, per-toy saved builds), stat-driven mini game, fit-filtered Market, seeded daily Packs, STL downloads, GLB pipeline (OpenSCAD 2026.10.11 installed; all 8 parts render manifold — Day 2's blocker gone), Reveal with saved character cards + synth theme, offline PWA shell.
- Uncommitted (Muse session): SAM outline persists on scanned toys; AR try-on crops to outline, places the real GLB at footprint scale (screenshot-verified after three fixes); Muse Image skins live in the Toybox, probed through our Worker.
- BlockML spike outcome: MachineBlocks bricks would fit the 16 mm grid at x2, but a CC BY-NC-SA vs Apache-2.0 conflict hard-gates adoption. Hand OpenSCAD stays canonical; license email drafted (decisions 0002–0004), not sent.
- Name change: ToyForge → **ToyVentor**, toyventor.com secured ("ToyForge" was taken in toys). Forward surfaces renamed (app title, package, Worker, spec/plan); history and the license email keep context. Trademark clearance beyond the domain is unverified — on the pre-publish list.
- Still to do (Dan): real cup + bottle phone photos; print calibration piece + 1–2 Snap samples ahead of Day 4's gate; send/don't-send on the license email; AR on Android Chrome.
- Still to do (agents): deploy prep + ownership backend on local D1/KV, SAM mask decoding for cutouts/attach points, Live Play mood buttons, STEM gear challenge.
- Note: plan.md day themes now run ahead of this journal (Packs/Market/game/Reveal landed early). Plan scope-freeze dates are canonical.

### End of Day
- Shipped (committed): virtual builder + mini game + Market/Packs + STL/GLB pipeline (c64839f), Reveal + offline PWA (76e5c48), SAM outline try-on + Muse Image skins + Live Play mood buttons (2543997), app restyled to the design guide, Toybox as landing page (uploads + built-ins), ToyForge → ToyVentor rename incl. Worker name (fce89a6), D1 ownership backend with device sync (7415b83).
- Landing later Day 3: hidden-calibration first-print selector — compliant sockets in the small stud profile plus a one-piece `forge-mount-first-print` whose breakaway strip carries three dotted sockets (snug / standard / easy) and a loose test brick; logic in `shared/calibration.ts`. No standalone calibration task reaches the user; the five-step piece stays an engineering tool.
- Parts geometry fork, surfaced and recorded: PartSpec landed under `docs/parts/partspec/` — Python/manifold3d generator on one 12.5 mm TU lattice (Snap Small 12.5, Large 25, Pro 12.5), 60 catalog parts passing its gate in scratch. Decision 0005 (proposed) makes it canon only after the Large hand-feel print passes, freezes new 16/32 mm app-lane geometry meanwhile, sketches the merge back. Fail-closed bridge (`scripts/bridge-partspec.ts`, `shared/partspec.ts`) converts a 6-part TU demo subset into `sets/partspec-demo.json` (validates, ships nowhere yet); first TU print queued is the PartSpec Large 2x2, ahead of rebuilding the selector on TU.
- SAM mask spike (decision 0006): real masks available inline in the sam-3.1 stream; Meta's official `@meta-sam/parser` decodes them in scratch (cup silhouette + handle, 72.1% coverage). Not integrated: license check first, box-only stays the fallback. Also the 2D half of the scan export PartSpec's hugging/clip-on shoes wait on.
- Docs organised: `docs/README.md` index, PartSpec de-duplicated to one `specs/` snapshot plus pointer README, duplicated wireframes PDF dropped, `snap-samples.md` bannered as the 16/32 mm prototype record. `.gitignore` covers the Muse memory lock and nested PartSpec `pkg/` repo (standalone, pushed separately).
- Demo-able right now: yes — scan → build on grid → AR try-on at footprint scale → game boost → STL export → Reveal, in desktop browser. Tonight-must-work item met.
- AR try-on: working on desktop Chrome (outline crop + GLB at footprint scale, screenshot-verified). Real phone / Android Chrome untested, carries to Day 4.
- Blockers: no physical print from either lane (Day 4 decides the Large hand-feel condition, then TU selector rebuild, then clearances and the one-size call); license email drafted (0004), not sent; toyventor.com route not attached (preflight script names the wrangler steps); app's 4 stats vs PartSpec's 19 need a game-design decision before a PartSpec set ships.
- Tomorrow's first task: Day 4 per plan.md — PartSpec Large 2x2 hand-feel print, calibration piece + 1–2 Snap samples, settle one-size vs two.

### Addendum — recorded Thu Oct 29
- Day 3 thread closed: recurring new-parts runbook ([creating-parts.md](../parts/creating-parts.md)) + binary-STL support in `scripts/stl_to_glb.py` landed (`d388b74`), with independent geometry checks on all six demo conversions. Day 4 follow-through, recorded here so the fork doesn't read as dropped; Day 3 close-out above unchanged.
- Still open at addendum time: first physical print from either lane (decision 0005's Large 2x2 condition first in queue), calibration piece + samples, Android Chrome AR pass, license-email call (0004), 4-vs-19 stat vocabulary gap.
- Also Oct 29, counted as Day 4 not backfilled: product vision + modular-system alignment (`ea75f33`) — see [vision.md](vision.md) and Day 4 below.

---

## Day 4 — Thu Oct 29: Pack Rips

Goal: daily pack, 3 items, 1 printable guaranteed, rarity + one stat (wireframe p.5).

### Start of Day
- [x] Must work by tonight: Packs show the deterministic daily pack (3 parts, first printable), rarity badges, one stat per part.
- [x] Pack odds/content: free date-seeded pack, same for everyone; no paid odds or shop. Rarity display-only: common = +1, uncommon = +2, rare = +3. Epic/legendary reserved for future sets.
- [ ] Muse Image skins: which prompts are you pre-generating?

### End of Day
- Shipped: app ↔ ToyVentor World hand-off + the model route behind Create mode. Game in-repo (`game/engine25.js` + `game/build25.py`, source of truth unchanged), served from our origin at `/world/ToyVentor-World.html` so Create mode avoids a cross-site call. Toy contract (`toyventor.toy/1`, base64url URL hash) carries toy, placements, paint; Play opens the world already wearing the build. Worker gained `/api/muse/spark` with kid-facing rules (short lines, safe topics, no identifying details, no brands) and recipe validation against the game's level shape. Live check: snowy world recipe in 6.8 s, covering the editor, Create mode, parts and the toy contract.
- Parts: [creating-parts.md](../parts/creating-parts.md) runbook + `scripts/stl_to_glb.py` binary-STL support; six demo conversions geometry-checked. No new part created; Large hand-feel print still gates the TU decision.
- Demo-able: yes. Scan, build, Play opens the world wearing the build, Create writes a world. 90-second run in [demo-script.md](demo-script.md).
- Every pack item works in AR + game: not re-checked this round.
- Blockers: published game artifacts hold the old build — public game page needs a hand republish.
- Parametric parts still slow while the AI-assisted authoring workflow is unsettled. Single route must lock by end of Day 5: frozen lattice, shared connector/metadata contract, export path. Until then broad print tests blocked; only the demo-size control moves.
- Tomorrow's first task: republish artifacts, then the ToyForge rename sweep in landing page + drafts.

### Addendum — recorded Fri Oct 30 (rest of Day 4)
- First written 17:48; the evening ran six more hours, recorded here.
- React port all evening: React host for ToyVentor World, then Factory and mission panels, then Create mode + level editor — each onto the React tree so the Worker is same-origin.
- Engine modernised in place (ES modules, current color-space names, OutputPass, intensities rescaled for physical units), checked against before/after screenshots of all 12 levels.
- Pro off the open STEMFIE grid onto our 12.5 mm TU hole grid: `pro-beam-su05` → `pro-beam-tu05` (part, set file, builder palette, Augment STL mapping followed). No STEMFIE reference left; one system, one grid.
- Real SAM masks decoded with Meta's official parser: true outlines + AR anchors instead of box-only (decision 0006).
- Worker pointed at toyventor.com against live D1; deploys guarded (no paint on empty builds, upstream errors hidden from kid, preflight before publish).
- Docs: product vision, merged submission vision, World / Create / demo-run docs, spec aligned with the demo as it stands.
- 23:53 — parametric route lock-in recorded + Day 4 pack-rarity table fixed above. Day's last blocker closed early; the lock completed Day 5.
- Two lines above did not survive the week — corrected here, not rewritten:
  - "Game lives in-repo (`game/engine25.js` + `game/build25.py`)" — Day 5's native canvas port replaced the iframe facade; that lane is empty. Running game is `src/features/game/world/runtime/`. "three.js 0.160" work landed on now-deleted legacy files; the React runtime runs `three@0.183.2`.
  - "Large hand-feel print gates the TU decision" — out of date the night it was written. Decision 0005 withdrew it when Large was parked Oct 28; lattice migrated in code Day 5. What gates print work is the physical calibration print.
- Tomorrow's first task: TU migration + World-first consolidation, then parts lock-in (all Day 5).

### Stretch — scan to 3D (Thu Oct 29, 22:50)
- Stretch, not demo path: a real 3D body for the kid's actual toy from the scan photo. Spec in [scan-to-3d.md](../specs/scan-to-3d.md); recommendation, not decision.
- Why: game renders three body presets (`shared/toycontract.ts:71` — car → vehicle, figure → character, else robot), so the cup that proved segmentation becomes a robot. A photo body makes the household-object promise real.
- Route: Meta SAM 3D Objects (image + mask → GLB); our scan already emits the mask (decision 0006), no second segmentation. Runware `meta:sam@3d` $0.0051–0.009/run with Zero Data Retention; fal `fal-ai/sam-3/3d-objects` $0.02/unit with scale/rotation/pose. Meta's Model API hosts no 3D model — second key or self-hosting. Other routes in spec: mask-parametric body (zero cost, exact silhouette, honest 2.5D answer), depth-only 2.5D, library retrieval, maskless image-to-3D (Meshy/Tripo, wrong silhouette), multi-view, self-hosted weights.
- Deciding numbers: ~$0.006/scan (~166 scans per $1), 50–105 s per mesh. Latency, not cost, constrains — background job with pre-generated bodies only, never a kid-flow step.
- If picked up, prove first: SAM 3D has no polycount knob → decimation step needed; pipeline is stdlib-only Python (trimesh/Blender = new dependency).
- Also landed: 100-item household scan-target eval set (`tests/fixtures/scan-targets.json` + test), ranked by kid-scan likelihood, each with a one-noun SAM prompt — ready-made segmentation tests and 3D-route masks.
- Not doing it unless Days 5–9 are green; preloaded toy covers the demo (plan.md Day 9).

### Stretch — parent time gates (Thu Oct 29, 23:18)
- Second stretch, also not demo path: parents set rules, kid earns time. Spec in [parent-time-gate.md](../specs/parent-time-gate.md).
- Controls: session timer for right now + cumulative STEM challenges awarding minutes, inside a daily limit earned time can never exceed. Budget, limit, session timer, minutes-per-challenge are separate numbers.
- Scope good news: STEM playground exists (nine panels + bridge/lift missions), every completion lands in one place (`S.mdone`, via `mtWin()` at `game/engine25.js:1042`) — a counter over existing missions, not a new STEM library, clear of the "STEM library + classroom" non-goal.
- Shape: two D1 tables beside `ownership` (`parent_settings`, `time_ledger`), two Worker routes (`/api/parent/settings`, `/api/parent/time`) shaped like `/api/ownership`, one game hook at `mtWin()`, session clock in app shell not game canvas. Game reads budget, reports completions, never writes settings.
- Under-8 tension: snap.md promises "no timers" — session ends by fading out, no number on screen, no fail state. Kid never sees a clock; parent sees the number. Also needs a parent gate (nothing gates adult settings today): arithmetic gate (long-press + two-digit sum) over PIN — no setup, no forgotten PIN.
- Iron rule: the daily limit. Earned time exceeding it kills parent trust and turns the app into a slot machine. Per-challenge award capped per day: "challenges buy minutes", not "grind to win time".
- Scope reality: touches game + app shell + D1, mirrored into the React port under `src/features/game/world/`. Day 8 change at best.

---

## Day 5 — Fri Oct 30: Fabricate and connect

Goal (plan.md Days 5–7): fit/print behavior across bridged sets, exact prototype disclaimers, packaging + sustainability wording. The wireframe's "Merge Forge + Recycle" theme was dropped at day start — plan.md non-goals, spec roadmap "Later". The day went into one geometry truth, one game lane, and the two unproven things: head parts and the power system.

### Start of Day
- [x] Must work by tonight: one stage (World IS the app), one lattice with one export path.
- [x] Parametric route lock-in: one frozen lattice, one shared connector/metadata contract, one export path — done, see Decision.
- [x] Adapter budget: not applicable, no merge adapters built. The two adapter slots went to the Pro-to-TU migration.

### End of Day
- One lattice, one contract, one export path: PartSpec contract grew the TU fields the app needs (rotated-fit checks included); bridge scripts carry verified parts into `sets/` with auto-discovery. TU base, wardrobe, garage sets generated, not hand-written. App on TU screens (pack rip, scan targets, legacy engine removal); TU print payloads, Kip wave, world page shipped as assets. Worker gained ownership self-bootstrap + db scripts.
- Game lane on React: World panels as React overlays on the legacy engine, whole app consolidated onto single-stage ToyVentor World, native canvas port replaced the iframe facade (`game/build25.py` and `public/world/` deleted; stage HTML + scoped CSS in `src/features/game/world/runtime/`). Play-testing POC works: toy, placements, paint survive into the world; stage resumes past title on remount via persisted flag; three.js served from our origin. Tests moved along with the port. P0 fixes: network-first service worker for app shell + world page; SAM/skin upstreams bounded with degrading timeouts. Safety: contact PII scrubbed before Muse Spark calls; `toyApply` check hardened.
- Head challenge closed: all six heads are generated and validated (chibi, chin, tall + bear, fox, kid); head/hair meshes refined in `toyventor_parts.py`; viewer + Kip manifests updated; validation manifests regenerated for six heads, eight hairs, robot visor. That retires the spec's "2 known Kip failures" note.
- Parent time gates shipped: two D1 tables beside `ownership`, `/api/parent/settings` + `/api/parent/time`, STEM-earned play time, calm sleep curtain preserving the parent path while suppressing play entries. Earned minutes additive inside the daily cap, never past it.
- Modular vehicles, started: Kip Wave 9 (33 parts, 17 assemblies) + six-rank maker ladder gating vehicles by earned XP — Hauler Truck and Motor Scooter at 250, Sport Motorbike and Loader Tractor & Trailer at 600, Prop Aeroplane and Catamaran Boat at 1,100, Rescue Helicopter and Space Shuttle at 1,800, Bolt Power Mech at 2,700. Earned once = unlocked forever; directly unlocked toys keep vehicles regardless of rank. Named, gated, unlockable — the carrying craft is still the flatpack work below. In flight, uncommitted: vehicle-unlock rules + parent XP reset (`resetAt` stamp so offline reset beats stale remote total).
- STEM power, scoped: four-stage system specified, not built — Snap → Pro → Momentum → Mech on a universal 3 TU power core + chassis interface. Ages 3+ to 10+, each stage with its compliance load (small-parts + 16 CFR 1500.19 balloon rule early; ASTM F963-23 tool-locked battery, IEC 62133 cells, FCC Part 15, COPPA for Mech). Seven-gate verification protocol with numeric pass criteria; spec at Pass 4e after two independent pre-CAD reviews. No repo code changed. Companion flatpack spec carries the craft grammar + Cards A–D datums the stages hang off.
- Docs: scan-to-3D gated behind a spike with Route B recommended, retired docs archived, product/spec/UX condensed into topic folders.
- Demo-able: yes, locally — scan or pick a toy, build with live checks, play in World wearing the build, open a pack, reveal a card, export a gated STL. Create mode writes a world. One stage throughout.
- Merge Forge adapters: not applicable — dropped today, none built.
- Blockers:
  - Nothing printed. 17-STL bundle staged in `parts/test-print-tu/`; calibration selector built; `F1_printed_fit` / `F2_breakage` pending for all 108 catalog parts. Calibration print is the last unknown — a two-hour job that can't compress later.
  - Live site still on Oct 28 deploy: no World, Create, packs, Kip, parent gates. This build never published.
  - Remote D1 has only `ownership`; parent-time migration not applied remotely, so `/api/parent/*` fails live even after deploy.
- Tomorrow's first task: print Plate 1 (`01_big_blue_brick_L_2x2.stl` + `17_forge_mount_first_print_selector.stl`), apply parent-time migration to remote D1, publish.

### Addendum — recorded Oct 31 (counts, not a rewrite)
- Wave 9 is 53 parts (43 Snap + 10 Pro) with 41 assemblies per the Kip manifest and tests — the "33 parts, 17 assemblies" logged above was an early count.
- The spec's "2 known Kip failures" note is retired (see End of Day above); `docs/product/spec.md` now points at live counts instead of naming a number.

### Decision recorded — Fri Oct 30
- No rollover on earned time ([parent-time-gate.md](../specs/parent-time-gate.md)): day resets at local midnight in the family timezone, daily limit stays put, yesterday's surplus gone. Ledger keyed by day — rollover not representable; enforced by data shape, not a check someone must remember.
- Parametric route locked, closing the Day 4 blocker: one frozen 12.5/25 mm TU lattice, one shared connector/metadata contract (`parts/partspec/interfaces.json` + PartSpec schema), one export path (`scripts/bridge-partspec.ts` into `sets/`). Hand-written OpenSCAD frozen as legacy lane, not extended. Broad print testing unblocked, subject only to calibration.
- Merge Forge + Recycle cut, not deferred: plan.md non-goals, too few days left to start honestly.

---

## Day 6 — Sat Oct 31: Market + Print

Goal: fit-filtered market + support-free STL export (wireframe p.7–9). Start: must-work item, fit filter check, first real STL export + test print. End: shipped, demo-able, top results fit, blockers, tomorrow's task. *(Unfilled.)*

## Day 7 — Sun Nov 1: Color + Play

Goal: AR color preview + mini-game equip (wireframe p.10–11, stretch: color). Start: must-work item, full masks vs AR-preview cut, toy loads + add-on boost. End: shipped, demo-able, scan-to-game loop on phone, blockers, tomorrow's task. *(Unfilled.)*

## Day 8 — Mon Nov 2: Reveal + Theme song

Goal: entrance animation + 15 s theme + character card, plays once then saves (wireframe p.12). Start: must-work item, song caching per character id + failure fallback, Minimo clips tagged. End: shipped, demo-able, plays-once-then-saves check, blockers, tomorrow's task. *(Unfilled.)*

## Day 9 — Tue Nov 3: Polish + Demo

Goal: full demo run on phone, in demo time. No new features after today. Start: freeze declared + remaining cuts, demo script written, seed content pre-generated. End: shipped, full run time, demo-able, blockers, tomorrow's task. *(Unfilled.)*

## Day 10 — Wed Nov 4: Submit by 9 PM ET

Goal: submission in. No code after 6 PM ET (buffer for form, video, screenshots). Start: video/screenshots/description done, track + theme on entry, Cloudflare rate-limit rule on `/api/muse/spark` confirmed (10/min/IP — the in-isolate backstop in `worker/muse.ts` is best-effort; the dashboard rule is the real cost bound; do before any public URL), hard stop time. End: submitted + time, entry URL, one-more-day wishes. See you at finals Nov 9. *(Unfilled.)*

---

## Later — Max phase (noted Sat Oct 31)

Future arc: Snap → Pro → Max, Max being real robots — opening with kid-safe
battle bots (sumo/push, obstacle courses, no destructive weapons) plus
missions. Thesis: video games accelerated AI development; play does the same
for robotics. ScanDex exhaust and the asset pipeline are the training-data
path in. Power-system Momentum/Mech stages sit inside Max. Spec holds the
detail in [scan-to-3d.md](../specs/scan-to-3d.md); roadmap pointer in
[spec.md](spec.md).
- Why Max is real: I'm building a 4-foot household robot — hours in Fusion
  360 and Blender making parts, printing, testing, training — and the work
  looks exactly like the game loop above: model it, fit it, check it, try it.
  The difference is my son watches me do it instead of helping. Max is the
  phase where he stops watching: every scan, label, measurement, and battle
  bot mission becomes training data for the real thing standing in our house.

---

## Later — asset suggester + ScanDex (noted Sat Oct 31)

Every scan or upload proposes character, vehicle, or prop — kid confirms or
corrects, never auto-locked. Muse drafts the build plan from catalog parts
(preset, paint zones, one stat, connector placements); deterministic code
builds and validates; studs stamp on the flattest face; fail-closed bridge
decides what ships. New connections arrive with block-level checks (flat
face, full-form studs, grid registration, preset envelope). ScanDex is the
collection game around it: confirm-what-it-is, set-the-size, earn XP —
confirm-not-annotate, parent-gated, on-device-first. Its exhaust sharpens the
suggester and, later, feeds Max. Robot-training data stays exhaust, never the
pitch. Full write-up deferred to the letter.
