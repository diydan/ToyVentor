# Implementation Spec: Kip Demo — Side Menu, Print View, Selfie Face Plate

Supersedes `kip-demo-menu-print-selfie-spec.md` (deleted; see git history for the
full design rationale). This document is the build plan: what gets built, in
what order, in which files, and what proves each phase done. Design decisions
from the old spec are condensed into the constraints of each phase, not
repeated.

Status: implemented 2026-10-31 behind `?menu=side` (Phases 1, 2, and 3 L1 + L2
sticker). Not done, and why, is in "Implementation status" at the end, together
with the corrections the review found in this plan. Line numbers below are as
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
- Rollout: the new panel ships behind `?menu=side` (default off, old dock
  untouched) until parity is proven; removing the dock + flag is the last step
  of Phase 1.
- No geometry changes in these phases: do not touch
  `parts/partspec/toyventor_parts.py`, `catalog.json`, or regenerate `out/`.
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

**Phase 1, side menu: done behind `?menu=side`. The dock and the flag are NOT removed.**
`kip-menu.js` (schema + panel + sync), mount in `Kip-Demo.html`. Four handlers were split out of inline click listeners so the
dock and the menu share one code path (`triggerClip`, `toggleExplode`, `togglePartPile`, `setSpeedScale`). Evidence:
`npm run e2e:kip-menu` runs 165 single-step comparisons (click the dock button once vs choose the option in the menu, from
the same start state) and requires identical state, status text and every legacy dock label and class; it also checks every
dock option is reachable from the menu and the reverse, two-way sync from the dock, programmatic setters, URL params,
`#toy=` and SDK loads, shortcuts, `?clean=1`, and layout at 1440 / 1024 / 390. Unit tests: `tests/kip-menu.test.ts`.
Deviation: accessible names come from the visible `<label>`, with the old tooltip as `title`, not `aria-label` (a mismatching
`aria-label` overrides the visible name). Why the removal waits: it is a one-way change to the default UI of a file other
sessions are editing, and it deletes the only harness that can compare old and new. Remove the dock after this is reviewed:
about 25 setter sites write dock labels, and the parity table in `DOCK_PARITY` lists every element to drop.

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

**Phase 3, selfie face: L1 and L2 done; L3 not started (a spike by the spec).**
`kip-selfie.js`, hook in `kip-forge-sdk.js` (`setSelfieCanvas`). Camera starts only from a tap on a labelled button, is
released on snap, close, Escape and page hide, and the denied, no-camera and upload paths all reach Adjust. Privacy is
tested: zero http(s) requests during the flow, nothing in web storage, IndexedDB, caches, cookies or the URL, nothing
after a reload, and a source scan that the module never mentions fetch, storage, workers or the scan endpoint. A selfie
is taken off when you leave a human head, pick another face or insert, or apply a preset, and the flat insert is kept
while it is worn. The sticker is a 600 dpi PNG with its density set plus an SVG in millimetres with a cut line, exported
(8) **Prompt-a-face gallery.** Eight ready-made cartoon faces (`parts/kip/viewer/selfie-faces/`, composed for the short
wide window) with a prompt box on the intro step: typed words are matched locally against keyword tags (exact hits count
double, prefix hits single, ties go to gallery order) and the winner loads straight into Adjust. The pictures preload
with the page, so prompting makes zero network requests; the privacy gates (zero http(s) in-flow, source scan) are
unchanged and extended with a prompt-flow section in `npm run e2e:kip-selfie`.
directly from the Adjust step (the plan routed it through the Phase 2 sheet; it does not need to). A real print has not been
measured; the files measure 23.58 × 10.12 mm at 100%. Not done: the grown-up gate that controls `allow="camera"` when
embedded (host app), and the COPPA review (compliance owner). Tests: `tests/kip-selfie.test.ts`, `npm run e2e:kip-selfie`.

**Gates.** `npx tsc --noEmit` clean. `tests/kip.test.ts` has one failure that predates this work: the W9 catalog now has 58
rows against the test's 53 (the five in-flight hair parts). Run the e2e suites with `npm run e2e:kip-menu`,
`e2e:kip-print`, `e2e:kip-selfie` (local Chrome; CI excludes browser runs).

