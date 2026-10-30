# Spec: One Stage · ToyVentor World IS the App

Oct 30, 2026 · UI Consolidation & World-First Architecture (aligned with `docs/spec.md`, `docs/demo-script.md` & Spec Review)

## Goal

Retire the separate 5-tab 2D dashboard (`Factory`, `Toybox`, `Packs`, `Market`, `Play` + pushed `Scan`, `Augment`, `Reveal`) and make **ToyVentor World** (`GameCanvas`) the entire application.

The app opens directly onto the full-screen 3D stage with **zero bottom tab bar**. Every physical-to-digital capability needed for the 90-second demo and real play runs as a single frosted-glass bottom sheet or modal overlay over the live 3D world:

- **Meta SAM 3.1** toy scanning (with 1-tap starter toy backup)
- **Meta Muse** photo skin painting (`Muse Image`)
- **3D slot building, Merge Forge & isometric Stud Grid placement** (`BuilderCanvas`)
- **True-scale AR Try-On & check-gated, support-free STL downloads**
- **Daily Booster Pack** foil rips
- **Meta Muse** AI world creation (`Muse Spark` `/api/muse/spark`)
- **Character Card Reveal** (16-step / ~6.7 s entrance synth auto-played once per new build, replayable on demand)
- **Live Play Story Moods** & parent-started push-to-talk voice

"Simple" is defined by four layout rules:

1. **One stage, zero tabs.** No `<BottomBar />`, no launcher screen (`FactoryScreen`), no separate part-catalog screens (`MarketScreen`, `ToyboxScreen` part list), and no standalone `AugmentScreen` route.
2. **Fit on a 390 px phone with zero horizontal dock scrolling.** The top studio bar holds the active toy pill plus **3 primary buttons** (`Build`, `Create`, `Pack`) for solo 4-year-old play and a **`⋯`** overflow menu for parent-assisted / older-kid (`Pro 8+`) tools.
3. **One active overlay at a time, one primary raised CTA per overlay.** Opening any sheet closes any other open sheet; the top ~40% of the 3D stage stays visible behind bottom sheets so kids always see their live 3D toy react.
4. **Kid-first surface, maker-depth one tap deeper.** Prototype debug toggles (`Slow motion`, `Reduced motion`, `Shake to rip`, `Try a shake`) are removed from the UI, and raw engineering specs (`12.5 mm TU`, `220×220 mm` bed math, 4-cell check tables) live inside clean `3D Print & AR Try-On` / `Check details` disclosures.

---

## Why the current UI feels complicated (facts on `main`)

- **Two apps bolted together:** Kids land on `ToyboxScreen` (31 stacked `PartCard`s × 4 engineering check boxes = **124 technical check rows** on the home screen), navigate 5 bottom tabs plus 3 pushed screens, and use an isometric 2D stud-grid builder (`AugmentScreen`), only to enter `PlayScreen` (`GameCanvas`) and discover a *second* 3D builder (`ToyCustomizer`), a *second* part/tool system (`Forge`), and a **9-item horizontal-scrolling top dock** (`Toy badge`, `+ Upgrades`, `Customize`, `Forge`, `Create`, `Editor`, `Moods`, `Kip 3D`, `Full`).
- **Four places list parts:** `ToyboxScreen`, `MarketScreen`, `AugmentScreen`, and `ToyCustomizer` each render part lists with different layouts and terminology.
- **Prototype controls leaked into kid views:** `PacksScreen` renders 6 debug/accessibility pills (`Replay rip`, `Sound on`, `Slow motion`, `Reduced motion`, `Shake to rip: off`, `Try a shake`) and 3 stacked full-width CTAs after ripping.
- **Engineering form friction on Scan:** `ScanScreen` asks for a photo, 4 quick chips, a `What is it?` `<select>`, an `Outline noun` text input, two millimeter sliders, and 2 full-width CTAs plus backup toy buttons.

---

## Target UX & Information Architecture

```
┌───────────────────────────────────────────────┐ 390 × 844 (100dvh, full bleed)
│ [🟢 Kip ▾]         [Build] [Create] [Pack•] [⋯] │ <- 48-52px Top Dock (no scroll)
├───────────────────────────────────────────────┤
│                                               │
│           3D TOYVENTOR WORLD STAGE            │ <- Always live (Garden, Sky,
│       (Turntable / 12 Worlds / 6 Labs)        │    Junkyard, Beach, Snow,
│                                               │    Toy Room, Labs 1-6)
│   [World ▾]                         [Zoom]    │
├───────────────────────────────────────────────┤
│  FROSTED-GLASS SHEET (.tv-sheet, <=62%)       │ <- At most ONE open at a time:
│  • My Toy & SAM Scan  (from [Kip ▾])          │    closes on backdrop/Done/Play
│  • Build, Forge & Print (from [Build])        │    (Done auto-pops Reveal once
│  • Create World       (from [Create])         │     when build signature is new)
│  • Mission / Lab      (from world spot)       │
│  • Story Moods / Editor (from [⋯])            │
└───────────────────────────────────────────────┘
  (Full-stage dimmed modal only for: Daily Pack Rip & Character Card Reveal)
```

### Top Dock (`48–52 px`, fits `390 px` width without scrolling)

| Slot | Control | Audience & Action |
| --- | --- | --- |
| Left | **`[Avatar/Dot] {Toy Name} ▾`** | **Solo kid (4+):** Toggles **`My Toy & Scan`** sheet (switch saved/starter toys, scan a real toy with Meta SAM 3.1, or paint a Meta Muse photo skin). |
| Right 1 | **`Build`** | **Solo kid (4+):** Toggles **`ToyCustomizer`** on the 3D Factory turntable (slots, parts, paint, Merge Forge, plus **`3D Print & AR Try-On`** with `AR View` / `Stud Grid` toggle). |
| Right 2 | **`Create`** | **Solo kid (4+):** Toggles **`CreatePanel`** (`/api/muse/spark` Meta Muse world builder + parent-started mic + picture chips). |
| Right 3 | **`Pack`** *(gold dot `•` when unclaimed)* | **Solo kid (4+):** Opens **`PackOverlay`** (foil booster rip). Shows gold dot until `toyforge:pack-claimed === today`. |
| Right 4 | **`⋯`** (`More` popover) | **Parent-assisted / Pro 8+ overflow:** **Story Moods & Mic**, **Character Card** (manual 16-step theme replay + `#toy=` share link), **Level Editor**, **Kip 3D Rig** (for figure/Kip toys), and **Fullscreen**. Shows a **pulsing coral hot-mic dot** (`aria-label="More (microphone listening)"`) strictly when `SpeechRecognition` is live, and a quiet gold note dot when only background music is playing. |

---

## Slot-to-Board Build Model (`shared/world-parts.ts` + `src/lib/builds.ts`)

- **Single system of record (`Placement[]`):** `toyforge:build:v1:{toyId}` (`BUILD_STORAGE_PREFIX = "toyforge:build:v1:"` in `src/lib/builds.ts`) remains the canonical store for app-lane printable builds. Existing saved `Placement[]` records require zero migration and load directly into `GameCanvas` (`toyContractFromBuild`), `PrintDrawer` (`BuilderCanvas`), and `RevealOverlay` (`characterFromBuild`).
- **Canonical slot-equip synthesis (`equipPartOnBuild`):**
  1. Each `Part` carries one `stat.name` (`speed | spin | torque | glow`), which corresponds 1:1 to a `ToyContract` slot on `toyTypeForKind(toy.kind)` (`shared/toycontract.ts`).
  2. Equipping a part from `PrintDrawer` or `PackOverlay` keys its slot bucket (`instanceId = "slot:" + bucket`, where `bucket` is `"skin"` for non-printable pack skins and `part.stat.name` otherwise) and **replaces** any existing slot-equipped placement in that same bucket (never duplicating on re-equip). Freehand multi-part board placements made on `Stud Grid` (`BuilderCanvas`) keep their own `instanceId`s and coexist cleanly.
  3. Board coordinates `(xMm, yMm, rotation)` are synthesized deterministically: `equipPartOnBuild` first verifies `allPass(runChecks(part, toy))`, then snaps the stat bucket's canonical anchor (`speed` `[0, 0]`, `glow` `[max, 0]`, `torque` `[0, max]`, `spin` `[max, max]`) to `pitchOf(part, rot)` via `snapMm` and checks `canPlace` on `boardForToy(toy)`, falling back to `findPlacement(part, remaining, partsById, board)` (`shared/build.ts:83`). If checks fail or no collision-free cell exists, `equipPartOnBuild` returns `{ ok: false, reason }` without mutating the build.

---

## Overlay Specifications

### 1. `My Toy & Scan` Sheet (`src/features/game/world/MyToySheet.tsx`)

Replaces `ToyboxScreen`, `FactoryScreen`, `ScanScreen`, and standalone `SkinPanel` routing in one compact two-step sheet:

- **Step A: Toy Shelf (default)**
  - Horizontal snap-scrolling shelf of owned toys: scanned/uploaded toys first (photo thumbnail + `SAM` badge), then built-in starters (`Red Racer`, `Star Scout`, `Kip`).
  - Tapping a toy selects it in `useToybox()`, recomputes `ToyContract` from `loadBuild(toy.id, partsById)`, calls `engine.setToy(contract)`, and updates the 3D stage immediately.
  - **Scanned photo extras (shown *only* when `selected.imageDataUrl` exists):** collapsible `<details>` row `"Paint photo skin (Meta Muse)"` mounting `<SkinPanel toy={selected} />` (`/api/skin`). Starter toys without photos never show a dead placeholder card.
  - **Single primary raised CTA:** **`Scan a Real Toy (Meta SAM 3.1)`**.
- **Step B: Kid-First Meta SAM 3.1 Scanner (in-sheet view)**
  1. **Photo viewfinder (`.scan-cam`):** tap to snap camera photo or pick image (`downscalePhoto`).
  2. **Object chips (replaces both `<select>` and `Outline noun`):** `Car`, `Figure`, `Cup`, `Bottle`, `Other` (reveals a 1-word noun input only when `Other` is active).
  3. **Name + 3 Size Pills:** optional `Name` input + **`S`** (`75×45 mm`), **`M`** (`110×55 mm`), **`L`** (`180×90 mm`) buttons. Exact millimeter sliders stay tucked inside `<details><summary>Exact size in mm</summary>`.
  4. **Single primary raised CTA:** **`Outline with Meta SAM 3.1`** (`/api/scan`), with a quiet `Save without AI outline` (`saveManual`) button underneath.
  5. **1-Tap Demo Backup Starter Strip:** Directly beneath the CTA, a quiet inline fallback row (`No camera handy?` -> `Red Racer`, `Kip`, `Star Scout`) lets a slow or failed live scan recover in 1 tap onto a starter toy without leaving the sheet.

### 2. `Build, Forge & 3D Print` Sheet (`ToyCustomizer.tsx` + `PrintDrawer.tsx`)

Unifies 3D slot customization, Merge Forge, Market's fit-filtered catalog, isometric Stud Grid placement, AR Try-On, and check-gated STL export in one place:

- **Top bar:** `Build your toy` title · `Forge (scrap)` toggle · `Done` button (plus quiet `Card` pill if the current build already has a saved Character Card).
- **Auto-Reveal on `Done` (`docs/spec.md` "Reveal plays once, then saves" rule):**
  - When tapping **`Done`**, compute `signature = buildSignature(placements)` from `loadBuild(toy.id, partsById)`.
  - If `placements.length > 0 && !revealForBuild(toy.id, signature)`, automatically open **`RevealOverlay`** (`firstReveal={true}`) so the entrance animation, 16-step (~6.7 s) synth theme (`playTheme`), and generated Character Card play once automatically and call `saveReveal(card)`.
  - If `signature` was already revealed earlier, `Done` closes straight back to the 3D stage without interrupting play.
- **3D Customizer controls (existing engine bridge):**
  - Toy type chips (`Vehicle`, `Character`, `Robot`) -> slot chips -> visual part cards (`.tv-opts`) -> paint zone + color swatches -> engine fit check (`Fix it for me` / `Preview Order (mock)`, explicitly marked as a mocked delivery preview).
- **New `3D Print & AR Try-On` collapsible drawer (`src/features/game/world/PrintDrawer.tsx`):**
  - Powered by `printablePartsForWorld(toy, allParts, { slot: snapshot.slot, line })` in `shared/world-parts.ts`:
    - Filters `allParts` (`sets/*.json` via `src/lib/catalog.ts`) through `allPass(runChecks(part, toy))`, preserving **Market's exact Fit Promise** (`Only parts verified to fit {toy.name}`). Adding a new `sets/*.json` file surfaces parts automatically with zero code changes.
    - Prioritizes parts whose `stat.name` matches the active World customizer slot (`slotStatForWorldSlot`), with `All` / `Snap` / `Pro` filter pills.
  - **Segmented Preview Toggle: `AR View` vs. `Stud Grid`:**
    1. **`AR View` (default):** Renders `<TryOn />` (`src/features/ar/TryOn.tsx`), compositing the part `.glb` (`glbFileFor`) at true millimeter scale over the kid's SAM-outlined photo, or interactive `<model-viewer>` 3D orbit for starter toys.
    2. **`Stud Grid`:** Renders `<BuilderCanvas />` (`src/features/builder/BuilderCanvas.tsx`), preserving the `12.5 mm` TU stud/hole snap board (`snapMm`), `canPlace` collision checks, `Add to board`, `Rotate`, `Remove` / `Clear`, and the 4 checks (`On grid`, `Fits size`, `No supports`, `Fits bed`) turning green live.
  - **Hard-Gated `.stl` Download & Print Profile:**
    - Displays the 1-line check status (`4/4 checks pass · 0.2 mm PLA · flat · support-free · Prototype`) with expandable `CheckList` (`src/components/CheckList.tsx`).
    - `.stl` download links render **strictly** when `part.printable && Boolean(stlFileFor(part)) && allPass(runChecks(part, toy))` (and board placement is valid). If any check fails, the `.stl` link stays hidden until fixed.
    - Renders the ASTM F963 / `16 CFR § 1500.19` `3+` small-parts warning whenever `part.smallPartWarning` is `true`.
    - Persists equipped parts via `equipPartOnBuild` -> `saveBuild(toy.id, placements)` (`src/lib/builds.ts`).

### 3. `Daily Pack` Modal (`src/features/game/world/PackOverlay.tsx`)

Brings the booster pack rip directly over the dimmed 3D World stage:

- **Header:** `Daily Pack` + `Sound on`/`Muted` pill + `Replay` pill (only after opening) + `✕` close button.
- **Removed prototype clutter:** `Slow motion`, `Reduced motion` button, `Shake to rip: off`, `Try a shake`, and the seeded-by-date fine-print paragraph are removed. OS `prefers-reduced-motion` continues to be honored automatically.
- **Post-rip action bar (when `phase === "done"`):**
  - Compact card summary (`{part.name}` · `{stat} +{value}` · collapsible `Fit & print check` via `CheckList`).
  - **Single primary raised CTA:** **`Equip {part.name} on {toy.name}`** (runs `equipPartOnBuild` -> `saveBuild`, updates `ToyContract` -> `engine.setToy(contract)`, and closes onto the 3D stage; disabled with a clear fit message when the pulled card does not fit the active toy's size class).
  - **Hard-gated STL link:** `Download {part.name}.stl` renders **strictly** when `part.printable && Boolean(stlFileFor(part)) && allPass(runChecks(part, toy))`, accompanied by `0.2 mm PLA · support-free · Prototype` and the `3+` small-parts warning when `part.smallPartWarning` is `true`.

### 4. `Create World` Sheet (`CreatePanel.tsx`) & `Mission` Sheet (`MissionPanel.tsx`)

- Keep their exact contracts (`toyventor.level/1`, `/api/muse/spark` on **Meta Muse**, offline word-parser fallback, and STEM Lab / Bridge mission controls), with `"Make with Meta Muse"` CTA, zero em dashes, and parent-started voice input.

### 5. `⋯` Overflow Menu, `Story Moods` (`LivePlayPanel.tsx`) & `Character Card` (`RevealOverlay.tsx`)

- **`⋯` Menu (parent-assisted / Pro 8+ overflow):** Anchored popover under the right-most dock button with `>= 44 px` touch targets; closes on outside tap, `Escape`, or item selection.
- **`Story Moods` (`LivePlayPanel.tsx`):** Mood chips work immediately with mic off, and voice cues are strictly parent-started. Reports `{ playing, listening }` separately so `⋯` displays a **hot-mic indicator** strictly when `listening === true` (distinct from music playback).
- **`Character Card` (`RevealOverlay.tsx`):**
  - Auto-triggered (`firstReveal={true}`) once per new `buildSignature` when closing `Build`; manually opened (`firstReveal={false}`) anytime from `⋯ -> Character Card` with a `Replay theme` button.
  - Plays the **16-step (~6.7 s)** synth entrance theme (`playTheme` in `src/features/reveal/theme.ts`), displays `characterFromBuild`, lead stat bars, **`Copy #toy= Share Link`** (calling `toyWorldUrl(contract, window.location.origin)` from `shared/toycontract.ts`), and **`Back to World`**.

---

## Safety, Privacy & Prototype-Truth Guardrails (`docs/spec.md` & `docs/demo-script.md`)

1. **Parent-started voice & unmistakable hot-mic indicator:** Neither microphone nor camera ever activates automatically on load or sheet open. When `SpeechRecognition` is listening, `⋯` displays a dedicated coral hot-mic indicator (`aria-label="More (microphone listening)"`) distinct from background music playback. Demo captures use grown-up hands or toy stand-ins, never child faces or names.
2. **Physical STL prototype & small-parts disclosure:** All home-printable `.stl` exports are labeled as **prototype parts** (not yet formally age-graded or lab-certified) using the single `0.2 mm PLA · flat · support-free` profile, and display the ASTM F963 / `16 CFR § 1500.19` `3+` small-parts warning whenever `part.smallPartWarning` is `true`.
3. **Hard check gate on print files:** `.stl` download links never render when `allPass(runChecks(part, toy))` is `false`.
4. **Honest delivery preview:** Mailed-print `Order` in `ToyCustomizer` is labeled as a **mocked preview** (local `.stl` download is live today; mailed fulfillment is post-hackathon).
5. **Strict UI copy hygiene:** Zero em dashes (`—`) anywhere in on-screen UI text, zero third-party toy brand names, and consistent `"Meta SAM 3.1"` / `"Meta Muse"` model naming.

---

## 90-Second Demo Beat Map (`docs/demo-script.md` on One Stage)

| Time | Demo Beat | Single-Stage Action | Backup / State Requirement |
| --- | --- | --- | --- |
| `0:00` | **Open** | App boots straight onto the 3D World stage; `[Toy ▾]` opens `MyToySheet` showing uploads + starter toys. Tap **Scan a Real Toy**. | Preloaded toy sits first in the shelf. |
| `0:08` | **Scan** | Snap toy on table, tap `Car` + `M`, tap **Outline with Meta SAM 3.1**. Outline traces and updates the 3D World toy. | Tap **Red Racer** or **Kip** in the Scan sheet's `No camera handy?` backup row. |
| `0:16` | **Build** | Tap **Build**, expand **3D Print & AR Try-On**, switch to **Stud Grid** (`BuilderCanvas`) to snap spoiler + wing and watch all 4 checks turn green. | Pre-saved build loads from `toyforge:build:v1:{toyId}`. |
| `0:26` | **Print ready** | Switch toggle to **AR View** (`TryOn`) for true-scale AR preview + gated `.stl` download (`0.2 mm PLA · flat · support-free`). | Local `.glb` / `.stl` assets served from `public/parts-*`; zero network needed. |
| `0:34` | **Play + Reveal** | Tap **Done**. First-time `buildSignature` auto-pops **Character Card Reveal** (16-step / ~6.7 s synth + card); close onto Garden and walk right to pop a hidden part. | Deterministic (`playTheme` + `characterFromBuild`). |
| `0:44` | **Bridge mission** | Walk to the Garden river spot -> `MissionPanel` opens -> forge beam + triangle brace -> tap **Test it** and cross the bridge. | **Requires pre-seeded demo save (`tf25` with `>= 4` scrap + unlocked brace blueprint)**; fresh-state verification uses **Lab 1** instead. |
| `0:54` | **Create mode** | Tap **Create**, type `"a snowy world with three snowmen and a cave to hide a part"`, tap **Make with Meta Muse**. Live 3D stage rebuilds behind the sheet. | Offline word parser builds the snowy world automatically if `/api/muse/spark` times out. |
| `1:12` | **Reveal / Share** | Reopen `⋯ -> Character Card` for the finale shot to replay the 16-step theme and copy the `#toy=` share link (`toyWorldUrl`). | Saved in `toyforge:reveals:v1` for instant replay. |

---

## Contracts & Compatibility Guarantees

| Contract / Surface | Guarantee |
| --- | --- |
| `#toy=` (`toyventor.toy/1`) | Unchanged. `toyWorldUrl` and `decodeToyContract` remain in `shared/toycontract.ts` (independent of retired `PlayScreen.tsx`). Both `/world/ToyVentor-World.html#toy=...` and root `/#toy=...` load directly into the 3D World wearing that contract. |
| `toyventor.level/1` | Unchanged across `CreatePanel`, `EditorPanel`, and `/api/muse/spark`. |
| `localStorage` keys | Preserved verbatim: `tf25`, `tvLevel`, `tvCreate`, `tvMyWorlds`, `toyforge:pack-claimed`, `toyforge:toybox:v1`, **`toyforge:build:v1:{toyId}`** (`BUILD_STORAGE_PREFIX = "toyforge:build:v1:"` in `src/lib/builds.ts`), `toyforge:skins:v1`, `toyforge:reveals:v1`, and `toyforge:device:v1`. |
| `?tab=` URL query params *(new shell routing)* | **New behavior in the single-stage shell** (replacing legacy `App.tsx` tab selection): on boot, `?tab=packs` auto-opens `PackOverlay`; `?tab=toybox` or `?tab=factory` auto-opens `MyToySheet` (shelf); `?tab=scan` auto-opens `MyToySheet` (scan step); `?tab=build` or `?tab=market` auto-opens `ToyCustomizer` once engine is ready; `?tab=reveal` auto-opens `RevealOverlay`. |
| Worker APIs | `/api/scan`, `/api/skin`, `/api/muse/spark`, and `/api/ownership` unchanged. |
| Kip 3D Demo | `kipDemoUrl(contract)` (`shared/toycontract.ts`) -> `/kip/Kip-Demo.html#toy=...` reachable from `⋯ -> Kip 3D Rig` whenever a figure/Kip toy is active. |

---

## Parallel Lane Ownership & Read-Only Parts Contract

Work is split into two non-overlapping execution lanes so UX/UI consolidation and physical part engineering can run concurrently without merge conflicts:

- **Owned by this World-First UX/UI Lane:** `src/**` (except `src/lib/catalog.ts`), `shared/world-parts.ts`, `tests/world-parts.test.ts`, `docs/world-first-spec.md`, and `docs/world-first-mockups.html`.
- **Read-Only Contract (Owned by the Parts Lane in [`docs/parts-tu-spec.md`](parts-tu-spec.md)):** `parts/**`, `sets/*.json`, `public/kip/**`, `public/parts-stl/**`, `public/parts-glb/**`, `scripts/bridge-partspec.ts`, `scripts/build-kip.ts`, `shared/part.ts`, `shared/partspec.ts`, `shared/calibration.ts`, and `src/lib/catalog.ts`.
- **Zero-Touch Integration Seam:** Consume catalog data strictly through `src/lib/catalog.ts` (`allParts`, `stlFileFor`, `glbFileFor`), `shared/checks.ts` (`runChecks`, `allPass`), and `/kip/Kip-Demo.html#toy=...`. Any calibrated `.stl`/`.glb` updates or new `sets/*.json` expansion packs generated by the Parts lane flow into `PrintDrawer` and `PackOverlay` automatically without UI code changes.
- **Git & Workspace Hygiene:** Stage only owned paths (`git add <owned-files>`); never run `git reset --hard`, `git checkout .`, or `git commit -a`, and never touch `/Users/dan/Code/toyventor`.

---

## File Plan

| Action | File | Purpose |
| --- | --- | --- |
| Add | `shared/world-parts.ts` + `tests/world-parts.test.ts` | Pure fit-filtered bridge (`printablePartsForWorld`) + canonical slot-to-board placement synthesizer (`equipPartOnBuild`, replacing same-stat slot equips cleanly). |
| Add | `src/features/game/world/MyToySheet.tsx` | Unified Toy shelf + 3-step Meta SAM 3.1 scanner + 1-tap starter backup row + conditional Meta Muse skin disclosure. |
| Add | `src/features/game/world/PrintDrawer.tsx` | Collapsible `3D Print & AR Try-On` section inside `ToyCustomizer` with `AR View` (`TryOn`) / `Stud Grid` (`BuilderCanvas`) toggle, 4 live checks, and check-gated `.stl` download + `3+` prototype safety notices. |
| Add | `src/features/game/world/PackOverlay.tsx` | Debug-free foil booster pack modal over the 3D stage with 1-tap `Equip on {toy}` (`equipPartOnBuild`) and check-gated `.stl` link. |
| Add | `src/features/game/world/RevealOverlay.tsx` | Auto-once-per-build + manual-replay Character Card modal (16-step / ~6.7 s `playTheme` + `characterFromBuild` + `toyWorldUrl` `#toy=` share copy). |
| Keep | `src/features/builder/BuilderCanvas.tsx`, `src/features/builder/engine/render.ts`, `src/features/ar/TryOn.tsx`, `src/components/CheckList.tsx`, `src/features/skin/SkinPanel.tsx` | Reused directly inside `PrintDrawer.tsx` and `MyToySheet.tsx`. |
| Update | `src/features/liveplay/LivePlayPanel.tsx`, `src/features/game/world/CreatePanel.tsx` | Report `{ playing, listening }` separately for the `⋯` hot-mic indicator; align `"Meta Muse"` copy and zero em dashes. |
| Update | `src/features/game/world/ToyCustomizer.tsx` | Mount `<PrintDrawer />`, label `Order` as mocked preview, and notify `onClose` so `GameCanvas` auto-triggers `RevealOverlay` once on new `buildSignature`. |
| Update | `src/features/game/world/GameCanvas.tsx` | Trim `.tv-dock` to `[Toy Pill ▾]`, `Build`, `Create`, `Pack`, `⋯` (with distinct hot-mic vs. music indicators); coordinate single-active-overlay state. |
| Update | `src/App.tsx` | Remove `<BottomBar />` and 5-tab router; sync D1 ownership, parse initial `#toy=` and new `?tab=` deep links, and render full-bleed `<GameCanvas />`. |
| Update | `src/index.css` | Add `.tv-toy-pill`, `.tv-more-menu`, `.tv-modal`, and `.tv-disclosure` styles; prune dead `.bottom-bar` rules. |
| Retire | `src/components/BottomBar.tsx`, `src/components/PartCard.tsx`, `src/screens/{Factory,Market,Toybox,Play,Augment,Scan,Packs,Reveal}Screen.tsx` | Replaced by the unified World stage and its overlays (~1,450 lines of duplicate UI removed). |

---

## Validation Gates

1. **Automated:** `npm run validate`, `npm run typecheck`, `npm test` (all existing suites + `world-parts.test.ts` + UI em-dash & storage-key guards), `npm run build`, and `npm run preflight` pass cleanly.
2. **Mobile viewport (`390×844`) Playwright walkthrough (fresh state):**
   - Dock fits on one row (`scrollWidth === clientWidth`, zero horizontal overflow, zero bottom tab bar).
   - `[Toy Pill ▾]` switches starter toys (`Red Racer` <-> `Kip`), exposes the 1-tap Scan backup row, and completes a manual/SAM toy scan updating the 3D World.
   - `Build` expands `3D Print & AR Try-On`, toggles between `AR View` (`<TryOn />`) and `Stud Grid` (`<BuilderCanvas />`), equips a printable part via `equipPartOnBuild` into `toyforge:build:v1:{toyId}`, gates `/parts-stl/*.stl` strictly on `allPass(runChecks)`, and auto-opens `RevealOverlay` once on `Done` for a new build signature.
   - `Pack` rips today's foil pack, flips all 3 cards, and equips onto the active toy in 1 tap (replacing same-slot equips cleanly without duplicating).
   - `Create` generates and loads a world with Meta Muse (or offline fallback); Lab 1 mission opens and runs cleanly from fresh state; `⋯` opens `Story Moods` (hot-mic indicator strictly tracks `listening`), `Character Card` (`toyWorldUrl` copy), `Editor`, `Kip 3D Rig`, and `Fullscreen`.
   - Zero em dashes (`—`) and zero third-party brand names appear in any rendered DOM text.
3. **90-second hackathon demo check (with pre-seeded `tf25` demo save for `0:44` Garden Bridge):** Scan car -> Build (`Stud Grid` checks green + `AR View` + STL ready) -> Auto Character Reveal -> Garden bridge mission (pre-seeded scrap + brace blueprint) -> Create world with Meta Muse -> Share `#toy=` link, all inside one uninterrupted 3D stage.
