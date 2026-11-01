# Implementation Spec: Kip Demo — Side Menu, Print View, Selfie Face Plate

Supersedes `kip-demo-menu-print-selfie-spec.md` (deleted; see git history for the
full design rationale). This document is the build plan: what gets built, in
what order, in which files, and what proves each phase done. Design decisions
from the old spec are condensed into the constraints of each phase, not
repeated.

Status: implemented 2026-10-31 (Phases 1, 2, and 3 L1 + L2 sticker). On 2026-11-01
the side menu became the only UI (dock and `?menu=side` flag removed), the face
plate was redesigned round, and the selfie got a second pass (background
removal, new Toon, a window that matches the new plate). Not done, and why, is in
"Implementation status" at the end, together with the corrections the review
found in this plan. Line numbers below are as
written and have drifted — `Kip-Demo.html`, `kip-vehicles-wardrobe.js`,
`toyventor_kitcard.py` have uncommitted changes.

## Constraints (apply to all phases)

- `Kip-Demo.html` is 4,060 lines with concurrent uncommitted edits. New code
  goes in new modules; the HTML gains only imports and a mount point.
- Every new viewer `.js` must be added to the copy list in
  `scripts/build-kip.ts:41-56`, and to the brand-scan `filesToScan` list in
  `tests/kip.test.ts:143-151`.
- No test references `btn-*` ids (0 matches, checked 2026-10-31); old ids can
  be dropped when the dock is removed.
- Rollout (done): the panel shipped behind `?menu=side` until parity was proven
  (commit aa60423: 165 one-step dock-vs-menu comparisons, all equal), then the
  dock and the flag were removed (2026-11-01). An old `?menu=side` link still loads.
- No geometry changes in these phases: do not touch
  `parts/partspec/toyventor_parts.py`, `catalog.json`, or regenerate `out/`.
  (Superseded on 2026-11-01 for the face plate only: see "Face plate redesign".)
- Do not regenerate or re-export hair STLs: another change is mid-flight on
  `catalog.json` / `kip_partspec.py` (manifest written 17:33, catalog edited
  20:38). Five hairstyles (bowl, slick, pixie, side_pony, low_bun) 404 today.

## Phase 1 — Side menu

New file `parts/kip/viewer/kip-menu.js` (schema, builders, two-way sync,
drawer) + mount point in `Kip-Demo.html` + `build-kip.ts` entry.

- Build the menu from a `MENU` description: group → control →
  `{id, label, kind, options(), get(), set(), visibleWhen}`. `options()` reads
  the existing arrays (`FACE_INSERT_MODES`, `HAT_COLORS`, `HAIR_OPTIONS` at
  `kip-vehicles-wardrobe.js:109`) and `kip-manifest.json`
  (`categoryControls`, `:192`); `visibleWhen` replaces the inline
  `display:none` toggles in `syncWardrobeCategoryUi` (`Kip-Demo.html:2738`).
- Controls: native `<select>` for everything that today cycles
  (Type, Head, Face, Insert, Hair, Hat + tones, Skin, Shirt, Pants, Back,
  Ears, Tail, single grouped Prop select, Vehicle select, Edition, Preset,
  animation clips); real on/off stays toggles (Covers, Racer Kit, Ref).
  `aria-label`s from the existing `title=` tooltips.
- Two-way sync: every select re-reads `loco` (`Kip-Demo.html:1923`) on
  `presetApplied`, URL-param load (`:571`), `#toy=` load, and any programmatic
  setter. No select holds its own state.
- Shortcuts (`E`, `B`, `H`, WASD, Shift, Space) keep working: ignore them
  while a `select` is focused; blur after change. `H` / `?clean=1` hides the
  panel with the other chrome.
- Layout: 288 px panel, collapsible to 48 px rail; slide-over drawer under
  720 px. Recentre Kip with `camera.setViewOffset` (confirm against the
  vendored bundle on implementation).
- Hair select: one `<select>` with Hat-Ready / Sculpted-Top optgroups; counts
  from data (19 styles + off — never from copy).
- Done when: every dock control (~35 + runtime clips) reachable from the
  panel; old/new produce identical model + status for every option; URL,
  preset, and `#toy=` loads leave all selects showing active values;
  Human-only controls hidden per `categoryControls`; 1440/1024/390 px clean;
  `?clean=1` unchanged. Then remove the dock and the flag.

## Phase 2 — Print view

New file `parts/kip/viewer/kip-print.js` (inventory, packer, support analysis,
plate view, export). Scope: Kip character only (vehicles wait — no
slot-to-part map, concurrent edits on the truck files).

- Inventory: walk active slots, resolve via a `SLOT_TO_PART` table sourced
  from the wardrobe keys (`kip-vehicles-wardrobe.js:228-245`; the demo loads
  `/kip/partspec/toyventor_<id>_S.stl` — never `mockup/`, which is
  Truck-only). Audit served STLs against `out/` + manifest by sha/extents.
  **Fail loudly on a missing STL**, never silently drop the part.
- Layout: rigid transforms only on validated meshes. Deterministic packer
  (MaxRects/skyline on inflated footprints, 90° rotation, stable `partId`
  sort). Gaps `>= 5.0 mm`, inside the bound, no overlaps — violations are bugs.
- Plate bound: `min(170, 180 − 2 × brim)` on the 180 bed; larger beds use
  `bed − 2 × brim` labelled "not covered by the kit-plate profile".
- Supports: catalog parts show "support-free" (sha mismatch → **unverified**
  badge); custom STLs get re-orient scoring then a "needs supports" flag with
  heatmap + per-object slicer flag in 3MF. No generated support geometry in
  v1. Trapped overhangs get a verified-alternative suggestion.
- Sprue mode blocked on open question 5 (gate `1.60×0.80` vs `1.80×0.60`;
  frame `3.0×1.0` vs `2.4×1.0`): one constant each before building it. Loose
  export first; gate anchors precomputed as `print.anchors` in
  `kip_partspec.py`, browser only connects them.
- Offline gate: `npm run kip:plate-check -- <plate>` runs `preprint_check.py`;
  all 10 presets pass in CI. UI badge: "Layout verified in CI for the 10
  presets; custom builds are geometry-checked only."
- Export: 3MF (confirm exporter availability — `kip-viewer-deps.js` is
  603 bytes), STL zip fallback, print sheet PDF/PNG with small-parts warning.
- Done when: presets pack clean and pass the offline gate; 60°-overhang
  custom STL re-orients or flags honestly; re-pack under 300 ms target;
  `Pile → Build` runs plate → assembled without clipping the bed.

## Phase 3 — Selfie face plate (L1 + L2; L3 is a spike, not committed)

New file `parts/kip/viewer/kip-selfie.js` (capture, adjust, style, sticker
sheet). Entry point: Face → 📸 Selfie (menu Phase 1); reuses the Photo → Toy
modal pattern (`getUserMedia` 512×512, `stopWebcamIfActive`,
`Kip-Demo.html:3414,3329`).

- L1 digital: guide + countdown + Snap/Retake, file-upload fallback, pan /
  zoom / rotate adjust through the plate outline, Toon (default) / Photo /
  Sketch styles, auto-select Flat Decal insert, Remove restores the expression.
  Into `createDecalExpressionCanvas` as `expr: 'selfie'`
  (`kip-forge-sdk.js:17`). No ML in v1. Face is ~24 mm wide
  (`char_faceplate_flat` `bbox_mm [24.2, 17.7, 13.1]`) — Toon default sets
  expectations.
- L2 sticker: 1:1 mm PNG + SVG cut line via the Phase 2 sheet export.
- Privacy (requirements): on-device only, zero image-data requests (e2e
  check); memory-only by default, tab close clears; never in URL / `#toy=`
  (boolean `selfie: true` at most, like `prints: false`); never in the repo;
  no biometrics; labelled tap-to-start camera; grown-up gate controls
  `allow="camera"` when embedded; COPPA check with the compliance owner.
- L3 spike exit criteria: V4/V10 pass, seats all Human heads, legible at
  24 mm on a real print. Any fail → stays off.
- Done when: snap → face under 1 s target; denied/no-camera/upload paths all
  reach Adjust; reload leaves no selfie, no camera indicator; no z-fighting on
  all Human heads; sticker measures true at 100% print.

## Order and tests

1. Phase 1 (unblocks 2, 3; touches the most-edited file — land first).
2. Phase 3-L1 in parallel with Phase 2 (independent of printing).
3. Phase 3-L2 once the sheet export exists. Phase 3-L3 spike only after real
  prints exist.

Tests per phase (vitest + offline gate + headless-Chrome screenshots at
1440/1024/390 px): Phase 1 — schema round-trip, `categoryControls` coverage,
no-`btn-*` parity table in the PR. Phase 2 — packer invariants, determinism,
support tiers on synthetic meshes, `kip:plate-check` on all presets. Phase 3 —
privacy e2e (zero image-data requests), camera-fallback paths, generated-pattern
fixtures only. Repo gates every phase: `npx vitest run tests/kip.test.ts`,
`npx tsc --noEmit`, `npm run build:kip`, brand/vendor scan.

## Open questions (default in italics)

1. Panel behaviour — *collapsible 288 px, drawer under 720 px.*
2. Print v1 scope — *character only.*
3. Supports — *flag-only; generate when a real part needs it.*
4. Selfie print route — *sticker; L3 as spike.*
5. Sprue dimensions — gates `1.60×0.80` vs `1.80×0.60`, frame `3.0×1.0` vs
   `2.4×1.0`. *Owner decides; one constant each.*
6. Embedded camera — *grown-up gate controls `allow="camera"`; needs app owner.*
7. Missing hair STLs — *export the five (parts verified); not in this work.*
8. November 4 freeze scope — *assume standalone demo excluded; confirm.*

## Review corrections (checked against the tree, 2026-10-31)

Each of these changed what was built. None is a judgement call: all were verified by reading or running the code.

1. **The demo does not initialise in the working tree.** The uncommitted `kip-vehicles-wardrobe.js` loads five hair STLs
   (bowl, slick, pixie, side_pony, low_bun) that are not on disk. `loadExpansionGeos` awaits them, so one 404 rejects
   `init()` and the page shows `Error: fetch ... 404`. It is not "five hairstyles 404"; the whole demo is down until those
   files are exported (HEAD does not reference them). Open question 7's default ("not in this work") leaves it that way.
   The test harness stubs missing STLs (loudly) so everything else could be verified; `E2E_STRICT_STL=1` turns that off.
2. **`npm run build:kip` is unsafe right now.** It copies the working-tree wardrobe file into `public/kip/`, which would
   publish the broken load above into the in-app demo. All checks run against the viewer sources through an overlay server
   (`scripts/lib/kip-e2e.mjs`) instead. Run `build:kip` once the hair STLs are exported.
3. **There is no `presetApplied` event or any event bus.** Setters repaint their own dock label inline. The menu therefore
   syncs by re-reading state on a 100 ms timer and repainting what changed, which also covers URL params, `#toy=`, presets
   and anything else that calls a setter.
4. **`categoryControls` is documentation, not data the page uses.** The real rules are in `syncWardrobeCategoryUi`. The menu
   encodes them as `wardrobeVisibility()`, and a test compares every category against the manifest.
5. **`loco` is private to an inline module**, and ears, tail, preset, speed and the active clip are not in it. The menu takes
   an adapter (`ctx`) built at the mount point; that is the only part of the page it touches.
6. **The window `keydown` handler had no focus guard**, so typing `h`, `e` or `b` in any select toggled the UI, explode, or
   Pile → Build. The panel stops key events at its edge; no change to the page's handler.
7. **`preprint_check.py` cannot gate a plate.** V1 blocks any STL with more than one body, so a packed plate never passes
   as one file (kit cards are not gated that way either). CI has no Chrome or Python. `npm run kip:plate-check` gates what
   can be checked per preset instead (see Phase 2 status). "All 10 presets pass in CI" is not achievable as written.
8. **Base body parts need supports.** `public/kip/stls/*` (kip.scad) are exported in rig pose and are not in the catalog's
   validation set. Measured against V4: torso 527 mm², head hood 853 mm², limbs 35–90 mm², in their best axis-aligned
   orientation (tolerance 10 mm²). Only `crown_buds` is clean. So most plates carry parts flagged "needs supports".
9. **The selfie window is 23.6 × 10.1 mm, not the whole 24 × 18 mm plate.** That is the conformal decal plane
   (`buildConformalFaceplateDecalGeo`); a face photo fills a thin band, which is why Toon is the default.
10. **The Photo → Toy modal can send image data to a server** (the "SAM 3.1 (/api/scan)" button) and its webcam path has no
    grown-up gate. The selfie flow is separate and never reaches either; a test fails if its source mentions the endpoint.
11. `kip-viewer-deps.js` has no 3MF exporter, so `kip-print.js` writes its own minimal 3MF and zip.
12. The manifest's `urlParams.hair` still says "14 wig ids" (19 exist). Left alone: editing it needs a `build:kip` copy.

## Implementation status

**Phase 1, side menu: done, and it is now the only UI (dock and `?menu=side` removed 2026-11-01).**
`kip-menu.js` (schema + panel + sync), mounted by default in `Kip-Demo.html`. Handlers that the dock and the menu shared
(`triggerClip`, `toggleExplode`, `togglePartPile`, `setSpeedScale`, `openPhotoModal`) stay as plain functions; every dock
click handler, label writer, `#row-clips`, the `.dock` CSS and the bottom-dock camera shift are gone. One side effect that lived
inside the old label code is kept as `dropEarPodsOffClassic()` (leaving the classic head puts the ear pods away), and the Photo
modal's `refreshPhotoSegmentation()` now also runs when the menu opens it (the pre-removal menu skipped it; the parity run could
not see that).
Evidence: before removal, `npm run e2e:kip-menu` on commit aa60423 gave 112/112 including 165 single-step comparisons (click the
dock button once vs choose the option in the menu, same start state, identical state, status text and every dock label and
class) and every dock option reachable both ways. After removal the suite is menu-only (42 checks): 164 real choices through the
`<select>`s, toggles, pull slider and buttons each change the live state and the menu shows it; two-way sync; shortcuts;
`?clean=1`; URL params, `#toy=` and SDK loads; layout at 1440 / 1024 / 390. The option sets cannot silently shrink:
`tests/kip-menu.test.ts` ("retired bottom dock") fails if the page regains a dock, a `?menu=` gate or any retired `btn-*` id, if a
`DOCK_PARITY` row stops pointing at a real menu control, or if the fixed option lists change.
Deviation: accessible names come from the visible `<label>`, with the old tooltip as `title`, not `aria-label` (a mismatching
`aria-label` overrides the visible name). Camera presets no longer shift the target 20 units down for a bottom dock.

**Phase 2, print view: done for the character; four pieces are not.**
`kip-print.js` (pure: inventory, STL, support scoring, deterministic MaxRects packer, 3MF, zip), `kip-print-view.js`
(three.js plate, heatmap, exports). Tiers: *support-free* only for catalog parts whose bytes match a passing validation
report (`public/kip/partspec-validation.json`, written by `npm run kip:validation-index`); *unverified* for a stale or
missing report; *geometry-checked* for non-catalog parts with no steep overhang (V4 only; bridges and ledges are not judged
in the browser); *needs-supports* otherwise, flagged per object in the 3MF (PrusaSlicer-style setting, not tried in a
slicer). Options with no single STL (pro gears, spinner, scanner ears, wheelie tail, custom parts, vehicles) are listed as
"not on the plate". A missing STL names the file and disables export. `npm run kip:plate-check` packs all 10 presets and
fails on any layout violation, missing file or failing catalog verdict (a stale report is a warning, `--strict` fails it).
Tests: `tests/kip-print.test.ts`, `npm run e2e:kip-print`.
Not done: (a) `Pile → Build` starting from the plate: it needs a slot-to-part map for the rig's slot groups, which the
inventory table does not give; (b) sprue mode, blocked on open question 5; (c) vehicles; (d) "trapped overhang gets a
verified alternative". Printing the sheet is a PNG, not a PDF.

**Phase 3, selfie face: L1 and L2 done, second pass 2026-11-01; L3 not started (a spike by the spec).**
`kip-selfie.js` (modal, framing, export), `kip-selfie-image.js` (pure: cut-out and Toon), `kip-faceplate-shape.js` (plate outline
and window), hook in `kip-forge-sdk.js` (`setSelfieCanvas`). Camera starts only from a tap on a labelled button, is released on
snap, close, Escape and page hide, and the denied, no-camera and upload paths all reach Adjust. Privacy is tested: zero http(s)
requests during the flow, nothing in web storage, IndexedDB, caches, cookies or the URL, nothing after a reload, and a source scan
that neither selfie module mentions fetch, storage, workers, the scan endpoint or face detection.
Second pass: (1) **Window = the plate's own shape.** The picture covers the plate outline pulled in by a 0.5 mm bezel (an earlier
squircle cut did not match the plate, and the dashed oval guide did not either): 23.2 x 12.4 mm, 252 mm2, with the plate's flat
dome top and chamfered lower corners, instead of the old 23.6 x 10.1 rectangle whose lower corners hung off the plate. The live
camera and Adjust both draw that outline, dim everything outside it, and mark the printed smile ridge and the 2D art's eye positions.
(2) **Isotropic canvas.** 510 x 273 px at 22 px/mm both ways; the old 512 x 256 canvas was stretched 17% sideways on the plate and
not on the sticker. (3) **Framing.** Zoom goes below "cover" (down to the photo's full height, up to 8x) and starts at about three
quarters of the photo height, so a tall phone photo fits a head in the short window. (4) **Line up eyes & mouth.** Two taps (the
point between the eyes, then the mouth) give an exact zoom, turn and shift (`alignFrame`: two points fix all three, no stretch) that
put the eye midpoint on the plate's eye line and the mouth on the moulded smile ridge; the face then fills the plate, the chin falls
below it. Nothing is detected: the person taps. (5) **Background removal**, on by default with an Edge slider, made on the photo
itself once per picture and carried through the same frame (so the frame's edge never feeds it). Two paths: a flat backdrop (the
four frame corners one colour, as in the gallery faces) is cut exactly by flood fill from the edges, which keeps a white helmet
inside a dark outline; any other backdrop goes to a centre-weighted colour model (k-means in Lab for subject and backdrop, edge-aware
smoothing, one blob, holes filled). No face detection, no network. On synthetic cartoon heads the model scores IoU 0.93-0.99 over
plain, gradient, patterned, dark and skin-coloured walls; neither path has been tried on real photos. Removed background shows the
plate's skin colour on the model and is filled with it on the sticker. (6) **Toon**: edge-preserving smoothing, a six-colour palette
fitted to the subject, speckle removal, ink at a printable 0.2 mm; camera and uploads start on Toon, gallery faces keep their own look
(they are already cartoon art, Toon would ink over their outlines). (7) The 2D face art (cheeks, brows) is clipped to the plate outline
and the three cheek decals the CAD review flagged were moved in. (8) The sticker's cut line is the window outline as an SVG path in mm.
(9) **Gallery faces made with Muse Image.** The 8 sample faces were redrawn with Muse Image (`muse-image-1.0`, `images/edits`) on a
plate-shaped guide template, and SAM 3.1 (text prompts "eye" and "mouth") measured where each face's eyes and mouth are, once, at
build time: `scripts/kip-gen-faces.ts` writes `parts/kip/viewer/selfie-faces/faces.json`, copied as `marks` into `SAMPLE_FACES`, so
choosing a face lines it up automatically (zoom 0.6-1.8x, under 6 degrees of turn, mouth on the ridge). SAM found both eyes and the
mouth on all 8 old and all 8 new cartoon faces. Muse follows eye and mouth height roughly but not eye spacing (eyes 0.24-0.39 of the
width apart against 0.534 at the plate's 2D eye marks), which is why the line-up fixes the eye midpoint and the mouth, not the eye
spacing. Only prompts and a plain guide template went to those models, never a photo of a person. **SAM is not used on live photos**:
that would send a child's picture to a server, which the privacy requirements (and the pending COPPA review) rule out; it needs a
decision, a grown-up gate and consent first.
(10) **Smart face (opt-in, online), built 2026-11-01.** After a grown-up says yes on a consent screen and passes the app's own parent gate
(`POST /api/parent/gate`: the math question, or the PIN a parent set; the signed proof lasts 2-5 minutes and lives in memory only), one picture
(resized to at most 768 px, JPEG) can be sent per tap through ToyVentor's Worker to Meta's services: SAM 3.1 finds the eyes and mouth so the face
lines up by itself, or Muse Image redraws the picture as a cartoon (then SAM lines the cartoon up). The consent screen says plainly where the
picture goes, that ToyVentor does not save it, that Meta's service handles it under Meta's own rules, and that nothing leaves the device if
nobody says yes; it is asked again for every use, and closing the modal ends the proof. Client: `kip-selfie-cloud.js` is the ONLY selfie module
with a network call (one `fetch`, three relative `/api` URLs, no cookies or storage writes; it only reads the app's device id); `kip-selfie.js`
and `kip-selfie-image.js` stay network-free and a test scans them. Server: `worker/selfie.ts` with `/api/selfie/face-parts` and
`/api/selfie/cartoon`, OFF unless `SELFIE_CLOUD=on` (503 otherwise; documented in `.dev.vars.example`; keep it off in production until the COPPA
review is done), needs a valid `x-parent-proof` for the caller's `x-device-id`, the `x-selfie-consent: v1` header, a JPEG data URL under 900 KB,
a per-device and per-IP rate limit, never logs or stores the picture, and never forwards upstream text. Checked end to end against a local Worker
(real gate, real SAM, real Muse) on a cartoon face only: SAM lined it up (2 s on an idle machine, 41 s under this machine's load) and Muse redrew
it (12 s idle); when the 2-minute proof runs out before the follow-up line-up the screen says so and the manual line-up stays. No photo of a real
person was ever sent anywhere during development or tests (the test server stubs the routes). Menu wording was changed to stay true:
"Selfie (not saved)" and "stays on this device unless a grown-up chooses the online helper". (11) Camera, upload and gallery pictures all start
as **Photo** (Toon and Sketch one tap away). (12) The Adjust screen has real spacing (a divider and 20 px above the controls, wide stacked
Zoom/Turn sliders, 10-12 px between rows), scrolls inside the card, keeps the title/Close row at the top and the Use/Save/Retake row at the
bottom, and no longer scrolls the picture away when it opens. (13) **Eyes closer together**: the printed eyes on the flat, sculpted and button
art moved in (flat 6.2 -> 5.3 mm, sculpted 7.0 -> 5.8, button 7.1 -> 5.8 mm either side of centre; 48-52% of the plate width instead of 54-60%);
the classic head keeps its own spacing. The moulded vinyl domes moved from 7.3 to 6.0 mm in the CAD (`FACE_VINYL_EYE_X`, domes 12.0 mm apart, 2.16 mm
from the plate edge) and `FACEPLATE_EYE_MM.vinyl` in `kip-forge-sdk.js` moved with them (a test fails if the painted irises and the domes disagree).
(14) **Forehead 5% lower on all four human heads** (`FOREHEAD_SCALE = 0.95` in `toyventor_parts.py`): the brow-to-crown height drops 8.60 -> 8.17 mm
(kid, chibi, jumbo; crown 31.4 -> 30.97) and 9.04 -> 8.59 mm (tall; 33.4 -> 32.948), anchored at the brow so the face zone, plate, pocket, ears and jaw
are untouched. 5% is the most that fits: the small-parts screen needs a head at least 34.93 mm across and kid, chibi and jumbo are 35.08 mm now (6.4%
would be 34.96, 8% fails at 34.83); 8-10% would need the whole face zone lifted one 1.5625 mm lattice step, which changes the face proportions on every
head. The wig vault grew by at most 0.25 mm (top row capped at +0.18 mm: past it the shag wig traps an internal void), the hat cavity followed the
hat-ready wig envelope, and every `HAT_RIM` is 0.4 mm shorter so the three tallest hats stay 0.67 mm clear of the brows; wig fringes now sit 0.43 mm
closer to the brows (curly, shag and side_sweep touch them). Viewer anchors updated (`crownY`, `HAT_RIM_MM`, `HAT_WRAP_MM`), tied to the export by
`tests/kip-head-anchors.test.ts`. Gates seen passing: generator 206 verified, assembly 31 ok / 9 invalid rejected, fit matrix 0 out of tolerance,
pre-print on the 31 changed parts 0 fails (geometry only, no slicer), selftest all passed; the other two face plates are bit-identical.
A real print has not been measured. Not done: the grown-up gate that controls `allow="camera"` when embedded (host app), and the
COPPA review (compliance owner). Tests: `tests/kip-selfie.test.ts`, `tests/kip-selfie-image.test.ts`,
`tests/kip-faceplate-shape.test.ts` (checks the outline table against the exported plate STL), `npm run e2e:kip-selfie`.

**Face plate redesign (2026-11-01).** The universal human face plate was a 24.2 mm wide rectangle with a 6 mm run of vertical
sides and an 18.2 mm flat chin. It is now rounded: curved sides that are widest (24.2 mm) only at zb 6.75, softened shoulders and
a 13.8 mm chin (`FACE_ROUND_*` in `toyventor_parts.py`). The plate prints standing on its chin edge, so the lower outline may
widen at most 0.9 mm per mm of height (the 45 degree support-free rule): that caps how narrow the chin can be, and a true oval
would need supports. The pocket in all four human heads follows the plate outline, so they changed with it. See
`parts/partspec/DESIGN_LOG.md` for the gate results and the exact constants.

**Gates.** `npx tsc --noEmit` clean (checked 2026-10-31; rerun after the 2026-11-01 changes). `tests/kip.test.ts` has one failure that predates this work: the W9 catalog now has 58
rows against the test's 53 (the five in-flight hair parts). Run the e2e suites with `npm run e2e:kip-menu`,
`e2e:kip-print`, `e2e:kip-selfie` (local Chrome; CI excludes browser runs).

