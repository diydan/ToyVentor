# Spec: One Stage — ToyVentor World IS the App

Oct 30, 2026 · UI Consolidation & World-First Architecture

## Goal

Retire the separate 5-tab 2D dashboard (`Factory`, `Toybox`, `Packs`, `Market`, `Play` + pushed `Scan`, `Augment`, `Reveal`) and make **ToyVentor World** (`GameCanvas`) the entire application.

The app opens directly onto the full-screen 3D stage with **zero bottom tab bar**. Every physical-to-digital capability needed for the 90-second demo and real play — **Meta SAM 3.1 toy scanning**, **Muse Image skins**, **3D part building & Merge Forge**, **true-scale AR Try-On & support-free STL downloads**, **Daily Booster Pack rips**, **Muse Spark Create mode**, and **Live Play story moods** — runs as a single frosted-glass bottom sheet or modal overlay over the live 3D world.

"Simple" is defined by four rules:

1. **One stage, zero tabs.** No `<BottomBar />`, no launcher screen (`FactoryScreen`), no separate part-catalog screens (`MarketScreen`, `ToyboxScreen` part list), and no second 2D builder (`AugmentScreen`).
2. **Fit on a 390 px phone with zero horizontal dock scrolling.** The top studio bar holds the active toy pill plus **3 primary buttons** (`Build`, `Create`, `Pack`) and a **`⋯`** overflow menu.
3. **One active overlay at a time, one primary raised CTA per overlay.** Opening any sheet closes any other open sheet; the top 40%+ of the 3D stage stays visible behind bottom sheets so kids always see their live 3D toy react.
4. **Kid-first surface, maker-depth one tap deeper.** Prototype debug toggles (`Slow motion`, `Reduced motion`, `Shake to rip`, `Try a shake`) are removed from the UI, and raw engineering specs (`12.5 mm TU`, `220×220 mm` bed math, 4-cell check tables) stay tucked inside collapsible `Details & 3D Print` disclosures.

---

## Why the current UI feels complicated (facts on `main`)

- **Two apps bolted together:** Kids land on `ToyboxScreen` (31 stacked `PartCard`s × 4 engineering check boxes = **124 technical check rows** on the home screen), navigate 5 bottom tabs plus 3 pushed screens, and use an isometric 2D stud-grid builder (`AugmentScreen`) — only to enter `PlayScreen` (`GameCanvas`) and discover a *second* 3D builder (`ToyCustomizer`), a *second* part/tool system (`Forge`), and a **9-item horizontal-scrolling top dock** (`Toy badge`, `+ Upgrades`, `Customize`, `Forge`, `Create`, `Editor`, `Moods`, `Kip 3D`, `Full`).
- **Four places list parts:** `ToyboxScreen`, `MarketScreen`, `AugmentScreen`, and `ToyCustomizer` each render part lists with different layouts and terminology.
- **Prototype controls leaked into kid views:** `PacksScreen` renders 6 debug/accessibility pills (`Replay rip`, `Sound on`, `Slow motion`, `Reduced motion`, `Shake to rip: off`, `Try a shake`) and 3 stacked full-width CTAs after ripping.
- **Engineering form friction on Scan:** `ScanScreen` asks for a photo, 4 quick chips, a `What is it?` `<select>`, an `Outline noun` text input, two millimeter sliders, and 2 full-width CTAs plus backup toy buttons.

---

## Target UX & Information Architecture

```
┌─────────────────────────────────────────┐ 390 × 844 (100dvh, full bleed)
│ [🟢 Kip ▾]       [Build] [Create] [Pack•] [⋯] │ ← 48px Top Dock (no scroll)
├─────────────────────────────────────────┤
│                                         │
│         3D TOYVENTOR WORLD STAGE        │ ← Always live (Garden, Sky,
│     (Turntable / 12 Worlds / 6 Labs)    │    Junkyard, Beach, Snow,
│                                         │    Toy Room, Labs 1–6)
│   [World ▾]                   [Zoom]    │
├─────────────────────────────────────────┤
│  FROSTED-GLASS SHEET (.tv-sheet, ≤58%)  │ ← At most ONE open at a time:
│  • My Toy & SAM Scan  (from [Kip ▾])    │   closes on backdrop/Done/Play
│  • Build, Forge & Print (from [Build])  │
│  • Create World       (from [Create])   │
│  • Mission / Lab      (from world spot) │
│  • Story Moods / Editor (from [⋯])      │
└─────────────────────────────────────────┘
  (Full-stage dimmed modal only for: Daily Pack Rip & Character Card Reveal)
```

### Top Dock (`48 px`, fits `390 px` width without scrolling)

| Slot | Control | Action |
| --- | --- | --- |
| Left | **`[Avatar/Dot] {Toy Name} ▾`** | Toggles **`My Toy & Scan`** sheet (switch saved/starter toys, scan a real toy with SAM 3.1, or paint a Muse Image skin). |
| Right 1 | **`Build`** | Toggles **`ToyCustomizer`** on the 3D Factory turntable (slots, parts, paint, Merge Forge, plus the new **`3D Print & AR`** drawer). |
| Right 2 | **`Create`** | Toggles **`CreatePanel`** (`/api/muse/spark` AI world builder + voice mic + picture chips). |
| Right 3 | **`Pack`** *(gold dot `•` when unclaimed)* | Opens **`PackOverlay`** (foil booster rip). Shows gold dot until `toyforge:pack-claimed === today`. |
| Right 4 | **`⋯`** (`More` popover) | Compact menu with: **Story Moods & Mic** (gold dot when active), **Character Card** (15 s entrance theme + share link), **Level Editor**, **Kip 3D Rig** (for figure/Kip toys), and **Fullscreen**. |

---

## Overlay Specifications

### 1. `My Toy & Scan` Sheet (`src/features/game/world/MyToySheet.tsx`)

Replaces `ToyboxScreen`, `FactoryScreen`, `ScanScreen`, and standalone `SkinPanel` in one compact two-step sheet:

- **Step A — Toy Shelf (default):**
  - Horizontal snap-scrolling shelf of owned toys: scanned/uploaded toys first (photo thumbnail + `SAM` badge), then built-in starters (`Red Racer`, `Kip`, `Bot`).
  - Tapping a toy selects it in `useToybox()`, computes `ToyContract`, calls `engine.setToy(contract)`, and updates the 3D stage immediately.
  - **Scanned photo extras (shown *only* when `selected.imageDataUrl` exists):** collapsible `<details>` row `"Paint look with Muse Image"` containing the 4 preset chips (`Racer red`, `Dragon`, `Galaxy`, `Rainbow`), optional custom prompt, and `Paint skin` button (`/api/skin`). Seed toys without photos never show a dead placeholder card.
  - **Single primary raised CTA:** **`+ Scan a Real Toy`**.
- **Step B — Kid-First SAM 3.1 Scanner (in-sheet view):**
  1. **Photo viewfinder (`.scan-cam`):** tap to snap camera photo or pick image (`downscalePhoto`).
  2. **Object chips (replaces both `<select>` and `Outline noun`):** `Car`, `Figure`, `Cup`, `Bottle`, `Other` (reveals a 1-word noun input only when `Other` is active).
  3. **Name + 3 Size Pills:** optional `Name` input + **`Small`** (`75×45 mm`), **`Medium`** (`110×55 mm`), **`Large`** (`180×90 mm`) buttons. Exact millimeter sliders live inside `<details><summary>Exact size in mm</summary>`.
  4. **Single primary raised CTA:** **`Outline with Meta SAM 3.1`** (`/api/scan`), with one quiet fallback link `Save without AI outline` (`saveManual`) underneath.
  - Saving selects the new toy, syncs `/api/ownership`, updates the 3D World contract, and closes the sheet onto the 3D stage.

### 2. `Build, Forge & 3D Print` Sheet (`ToyCustomizer.tsx` + `PrintDrawer.tsx`)

Unifies 3D slot customization, Merge Forge, Market's fit-filtered catalog, AR Try-On, and STL export in one place:

- **Top bar:** `Build your toy` title · `Forge (scrap)` toggle · `Done` button.
- **3D Customizer controls (existing engine bridge):**
  - Toy type chips (`Vehicle`, `Character`, `Robot`) -> slot chips -> visual part cards (`.tv-opts`) -> paint zone + color swatches -> engine fit check (`Fix it for me` / `Order`).
- **New `3D Print & AR Try-On` collapsible drawer (`<details className="tv-disclosure">`):**
  - Powered by a pure mapping module `shared/world-parts.ts` (`printablePartsForWorld(toy, snapshot)`):
    - Filters `allParts` (`sets/base.json`, `sets/kip-wardrobe.json`, `sets/racer-garage.json`) through `allPass(runChecks(part, toy))` — preserving **Market's exact Fit Promise** (`Only parts verified to fit {toy.name}`).
    - Prioritizes parts matching the currently selected customizer slot/stat (`speed`, `spin`, `glow`, `torque`), with `All fitting` / `Snap` / `Pro` filter pills.
  - Selecting a printable part renders inline:
    1. **True-scale AR / 3D preview (`<TryOn />`):** composites the `.glb` over the kid's SAM-outlined photo when scanned, or interactive `<model-viewer>` 3D orbit for starter toys.
    2. **1-line check status:** `✓ Fits {toy.name} · Support-free PLA` (tap `Check details` to expand the 4 `CheckList` items and footprint mm).
    3. **Direct `.stl` download CTA:** `<a download href="/parts-stl/{stlFile}">Download {part.name} STL</a>` (plus required ASTM F963 / 16 CFR § 1500.19 small-parts notice when `part.smallPartWarning` is true).
    4. Persists equipped PartSpec parts to `builds.ts` so `toyContractFromBuild` and Character Reveal stay synchronized.

### 3. `Daily Pack` Modal (`src/features/game/world/PackOverlay.tsx`)

Brings the booster pack rip directly over the dimmed 3D World stage:

- **Header:** `Daily Pack` + `🔊`/`🔇` mute pill + `Replay` pill (only after opening) + `✕` close button.
- **Removed prototype clutter:** `Slow motion`, `Reduced motion` button, `Shake to rip: off`, `Try a shake`, and the seeded-by-date fine-print paragraph are removed. OS `prefers-reduced-motion` continues to be honored automatically.
- **Stage:** Crimped foil pack, hold-progress ring, tear flash/sun-rays/shockwave, and 3 fanned 3D rarity cards (`common`, `uncommon`, `rare`).
- **Post-rip action bar (when `phase === "done"`):**
  - Compact card summary (`{part.name}` · `{stat} +{value}` · collapsible `Fit & print check`).
  - **Single primary raised CTA:** **`Equip on {toy.name}`** — records the part on the active toy's build, updates `engine.setToy(contract)`, and closes the modal so you immediately see the upgrade on the 3D stage.
  - **Quiet secondary pills:** `Download STL` (if `part.printable`) and `Close`.

### 4. `Create World` Sheet (`CreatePanel.tsx`) & `Mission` Sheet (`MissionPanel.tsx`)

- Already implemented as `.tv-sheet` overlays on `GameCanvas`; keep their exact shapes and contracts (`toyventor.level/1`, `/api/muse/spark`, word-parser fallback, STEM Lab controls).

### 5. `⋯` Overflow Menu, `Story Moods` (`LivePlayPanel.tsx`) & `Character Card` (`RevealOverlay.tsx`)

- **`⋯` Menu:** Anchored popover under the right-most dock button; closes on outside tap, `Escape`, or item selection.
- **`Story Moods`:** Existing `.tv-sheet` (`LivePlayPanel`); background synth loop and speech recognition stay alive when the sheet is closed, indicated by a gold dot on `⋯`.
- **`Character Card` (`RevealOverlay`):** Compact modal card over the spinning 3D toy: plays the 16-step synth entrance theme (`playTheme`), displays the generated character title (`characterFromBuild`), lead stat bars, and **`Copy Share Link`** (`toyWorldUrl(contract)`) + **`Back to World`**.

---

## Contracts & Compatibility Guarantees

| Contract / Surface | Guarantee |
| --- | --- |
| `#toy=` (`toyventor.toy/1`) | Unchanged. Shared links (`/#toy=...` and `/world/ToyVentor-World.html#toy=...`) load directly into the 3D World wearing that build. |
| `toyventor.level/1` | Unchanged across `CreatePanel`, `EditorPanel`, and `/api/muse/spark`. |
| `localStorage` keys | `tf25`, `tvLevel`, `tvCreate`, `tvMyWorlds`, `toyforge:pack-claimed`, `toyforge:toybox:v1`, `toyforge:builds:v1`, `toyforge:skins:v1`, `toyforge:reveals:v1`, `toyforge:device:v1` all preserved. Existing saves, builds, scans, and packs survive seamlessly. |
| URL query params | Legacy `?tab=packs` auto-opens `PackOverlay`; `?tab=toybox` or `?tab=scan` auto-opens `MyToySheet`; `?tab=build` or `?tab=market` auto-opens `ToyCustomizer`. |
| Worker APIs | `/api/scan`, `/api/skin`, `/api/muse/spark`, and `/api/ownership` unchanged. |
| Kip 3D Demo | `/kip/Kip-Demo.html#toy=...` reachable from `⋯ -> Kip 3D Rig` whenever a figure/Kip toy is active. |

---

## File Plan

| Action | File | Purpose |
| --- | --- | --- |
| Add | `shared/world-parts.ts` + `tests/world-parts.test.ts` | Pure fit-filtered bridge between World toy/slot/stat and `sets/*.json` printable `Part`s. |
| Add | `src/features/game/world/MyToySheet.tsx` | Unified Toy shelf + 3-step SAM 3.1 scanner + conditional Muse Image skin row. |
| Add | `src/features/game/world/PrintDrawer.tsx` | Collapsible `3D Print & AR Try-On` section inside `ToyCustomizer` (`TryOn` GLB/AR + `.stl` download + collapsible `CheckList`). |
| Add | `src/features/game/world/PackOverlay.tsx` | Debug-free foil booster pack modal over the 3D stage with 1-tap `Equip on {toy}`. |
| Add | `src/features/game/world/RevealOverlay.tsx` | Compact character card + 15 s entrance theme + `#toy=` link copy modal. |
| Update | `src/features/game/world/ToyCustomizer.tsx` | Mount `<PrintDrawer />` cleanly below paint swatches. |
| Update | `src/features/game/world/GameCanvas.tsx` | Trim `.tv-dock` to `[Toy Pill ▾]`, `Build`, `Create`, `Pack`, `⋯`; coordinate single-active-overlay state. |
| Update | `src/App.tsx` | Remove `<BottomBar />` and 5-tab router; sync D1 ownership, parse initial `#toy=` / `?tab=`, and render full-bleed `<GameCanvas />`. |
| Update | `src/index.css` | Add `.tv-toy-pill`, `.tv-more-menu`, `.tv-modal`, and `.tv-disclosure` styles; prune dead multi-tab rules. |
| Retire | `src/components/BottomBar.tsx`, `src/screens/{Factory,Market,Toybox,Play,Augment,Scan,Packs,Reveal}Screen.tsx` | Replaced by the unified World stage and its 4 overlays (~1,400 lines of duplicate UI removed). |

---

## Validation Gates

1. **Automated:** `npm run typecheck`, `npm test` (all 20 existing suites + new `world-parts.test.ts`), and `npm run build` pass cleanly.
2. **Mobile viewport (`390×844`) Playwright walkthrough:**
   - Dock fits on one row (`scrollWidth === clientWidth`, zero horizontal overflow, zero bottom tab bar).
   - `[Toy Pill ▾]` switches starter toys (`Red Racer` ↔ `Kip`) and completes a manual/SAM toy scan, updating the 3D World.
   - `Build` opens `ToyCustomizer`, equips a 3D slot part, expands `3D Print & AR`, renders `<TryOn />`, and exposes a valid `/parts-stl/*.stl` download link.
   - `Pack` rips today's foil pack, flips all 3 cards, and equips onto the active toy in 1 tap.
   - `Create` generates and loads a world; `⋯` opens `Story Moods`, `Character Card`, `Editor`, and `Fullscreen`.
3. **90-second hackathon demo check:** Scan car → Build & AR/STL check → Play Garden bridge mission → Create world with Muse Spark → Character Card theme, all inside one uninterrupted 3D stage.
