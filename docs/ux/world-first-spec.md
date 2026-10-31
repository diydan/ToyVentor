# Spec: One Stage · ToyVentor World IS the App

Oct 30, 2026 · UI Consolidation & World-First Architecture (aligned with `docs/product/spec.md`, `docs/product/demo-script.md` & Spec Review)

## Goal

Retire the separate 5-tab dashboard and make ToyVentor World the entire app.
The app opens directly onto the full-screen 3D stage; scanning, skins, slot
building, Forge, AR/print, packs, world creation, Reveal, and moods run as one
sheet or modal at a time over the live world:

- SAM toy scanning with 1-tap starter backup.
- Muse photo skin painting.
- Slot building, Merge Forge, and Stud Grid placement.
- True-scale AR try-on and check-gated, support-free STL downloads.
- Daily booster pack foil rips.
- Muse world creation.
- Character Card Reveal with entrance theme, once per new build.
- Live Play story moods and parent-started push-to-talk voice.

Simple means: one stage with no tabs; a dock that fits a 390 px phone without
scrolling; one active overlay and one primary CTA at a time; maker depth one
tap deeper than the kid surface.


## Why the current UI feels complicated (facts on `main`)

- Two builders existed: an older 2D stud-grid path and the 3D Factory/
  customizer path.
- Four surfaces listed parts with different layouts and terminology.
- Prototype debug toggles and stacked CTAs leaked into kid views.
- Scan asked for photo, chips, select, noun input, sliders, and multiple CTAs
  before producing an outline.


## Target UX & Information Architecture

```text
390 × 844 full-bleed stage
[Toy ▾] [Build] [Create] [Pack•] [⋯]
3D ToyVentor World stage, always live
One frosted-glass sheet or modal at a time
Full-stage modals only for Daily Pack Rip and Character Card Reveal
```

### Top Dock (`50 px`, fits `390 px` width without scrolling)

| Slot | Control | Action |
| --- | --- | --- |
| Left | Toy pill | Toggles My Toy & Scan: switch toys, scan, or paint a photo skin. |
| Right 1 | Build | Toggles Factory/customizer, slots, paint, Forge, Print/AR. |
| Right 2 | Create | Toggles world creation and parent-started voice. |
| Right 3 | Pack | Opens the daily foil rip; gold dot means unclaimed. |
| Right 4 | `⋯` | Moods, Character Card, Level Editor, Kip 3D Rig, Grown-ups, Fullscreen. |

The overflow shows a hot-mic indicator only while listening, separate from
music playback.

## Slot-to-Board Build Model (`shared/world-parts.ts` + `src/lib/builds.ts`)

- Canonical builds remain `Placement[]` under `toyforge:build:v1:{toyId}`; no
  migration is required.
- Each part carries one stat that maps to the same toy-contract slot.
- Equipping replaces the existing placement in that slot bucket; freehand board
  placements keep their own IDs.
- Board coordinates are synthesized deterministically: canonical stat-bucket
  anchors snap to part pitch and are checked for fit and collisions, with a
  free-placement fallback. Failed equips return a reason without mutating the
  build.


## Overlay Specifications

### 1. `My Toy & Scan` Sheet (`src/features/game/world/MyToySheet.tsx`)

One two-step sheet replaces separate Toybox, Factory, Scan, and skin routes:

- Shelf: scanned/uploaded toys first (photo thumbnail plus `SAM` badge), then
  Red Racer, Star Scout, and Kip. Selecting a toy recomputes its contract and
  updates the stage immediately.
- Photo-skin disclosure appears only for scanned toys with photos; starter
  toys never show a dead placeholder card.
- Scan: photo viewfinder, object chips (`Car`, `Figure`, `Cup`, `Bottle`,
  `Other` with a one-word noun input only for `Other`), optional name, S/M/L
  pills (`75×45`, `110×55`, `180×90` mm) with exact millimeter details tucked
  away, one SAM outline CTA, manual-save fallback, and a quiet Red Racer/Kip/
  Star Scout backup row.


### 2. `Build, Forge & 3D Print` Sheet (`ToyCustomizer.tsx` + `PrintDrawer.tsx`)

One sheet unifies customization, Forge, fit-filtered catalog, Stud Grid, AR,
and gated STL export:

- Header: title, Forge/scrap toggle, Done, and a quiet Card shortcut when a
  Character Card already exists.
- Done auto-opens Reveal once for a new build signature; repeat builds return
  directly to the stage.
- Customizer: toy-type chips, slot chips, visual part cards, paint zone and
  swatches, engine fit check with `Fix it for me`, and explicitly mocked order
  preview.
- Print/AR drawer: AR View (true-scale GLB over the SAM photo, or model-viewer
  orbit for starters) or Stud Grid (12.5 mm snap board with Add, Rotate,
  Remove, Clear), four live checks, gated STL access, prototype material
  label, small-parts warnings, and persisted equips.
- The drawer filters catalog sets through the same fit promise as the old
  Market: only parts verified to fit the active toy appear, so new sets
  surface with zero code changes.


### 3. `Daily Pack` Modal (`src/features/game/world/PackOverlay.tsx`)

The rip runs over the dimmed stage (`Today's Pack`) with sound/mute, replay
after opening, and close controls. After the rip, the header swaps to
`Pack opened`; stats resolve from live bridged values, not a static table.
One Equip CTA equips the card onto the active toy and closes the overlay;
unusable parts get a `Not for this toy` state, and STL actions hide unless the
part is printable, has a mesh, and passes all checks. A `Print first, then
equip` notice covers pending physical prints.


### 4. `Create World` Sheet (`CreatePanel.tsx`) & `Mission` Sheet (`MissionPanel.tsx`)

Keep the world/level contracts, Muse route, offline fallback, STEM/lab and
bridge controls, “Make with Meta Muse” CTA, clean punctuation, and
parent-started voice.

### 5. `⋯` Overflow Menu, `Story Moods` (`LivePlayPanel.tsx`) & `Character Card` (`RevealOverlay.tsx`)

- Overflow uses large touch targets (minimum 44 px) and closes on outside tap,
  Escape, or selection. Items enable or disable with the active toy and sleep
  state.
- Mood chips (Joy, Suspense, Danger, Calm, Triumph, Mystery) work muted;
  parent-started voice reports listening separately from playback. `mystery`
  stays stubbed in code and must not promise content it lacks.
- Reveal auto-plays once per new build over a dimmed starfield with the guard
  `toyforge:reveals` in localStorage, and supports manual replay, theme
  replay, clean `#toy=` sharing, and return to the world.


### Transitions

Opening Build, Create, Pack, Moods, Reveal, editor, or the customizer closes
the engine sheets and other React overlays first. Sleep mode disables build,
pack, moods, editor, and pack-related entry points without removing the
parent path; the curtain reads as story ("Kip is recharging"), never as
lockout. Overlays never leave placed work, saved builds, or packs in an
ambiguous state. Backdrop tap, Done, and Play all return to the live stage;
Reveal returns automatically after its entrance theme unless replayed.

The time-aware day adds three surfaces, and none of them is a lockout or a
countdown. Eating time shows a warm table card, offers the family meal
routine, and returns the child to the same spot when the meal is done.
Bedtime runs the parent-set steps with the screen dark and a calm voice.
Dusk lights the town as bedtime approaches, on the clock. The parent path
stays reachable from every one of them, and no surface shows a clock, a
remaining-time number, or a reason that reads as a punishment.

## Safety, Privacy & Prototype-Truth Guardrails (`docs/product/spec.md` & `docs/product/demo-script.md`)

1. Mic and camera never start automatically; listening has its own indicator.
2. Home-print STL files are prototypes with exact material and support labels.
3. STL links never render when checks fail.
4. Mailed-print ordering is an explicitly mocked preview.
5. Screens avoid em dashes and third-party brands and use consistent model names.

## 90-Second Demo Beat Map (`docs/product/demo-script.md` on One Stage)

| Time | Beat | Action |
| --- | --- | --- |
| `0:00` | Open | Boot onto the stage; open My Toys. |
| `0:08` | Scan | Outline the toy or use a starter backup. |
| `0:16` | Build | Snap parts until all four checks pass. |
| `0:26` | Print ready | Preview AR/grid and confirm gated STL. |
| `0:34` | Play + Reveal | Finish the build, reveal the card, enter Garden. |
| `0:44` | Bridge mission | Forge/test the mission with seeded or Lab 1 state. |
| `0:54` | Create | Make a world; offline fallback remains available. |
| `1:12` | Share | Replay the card and copy the `#toy=` link. |

## Contracts & Compatibility Guarantees

`#toy=` (`toyventor.toy/1`), `toyventor.level/1`, storage keys, deep links,
Worker APIs, and the Kip demo URL remain unchanged. Existing builds load
without migration. `?tab=` deep links open Pack, My Toys, scan, Build, or
Reveal in the single-stage shell. The Kip 3D Rig stays reachable from `⋯`
whenever a figure/Kip toy is active. Reserved for the Town layer, not yet
implemented: `toyventor.quest/1` (quests with giver, age bands, steps,
concept tag, reward, unlocks) and `toyventor.town/1` (districts, edges,
buildings, vehicle gates). Future quest and town-board surfaces ride the same
overlay rules: one sheet at a time over the live stage.


## Parallel Lane Ownership & Read-Only Parts Contract

UX owns app/world/UI/docs; the parts lane owns parts, sets, public meshes,
bridge scripts, and catalog libraries. UI consumes catalog data only through
the catalog, checks, and Kip demo paths. Stage only owned files and never use
destructive repository-wide Git commands.

## File Plan

Add the world-parts bridge (`shared/world-parts.ts`) and its tests, the
unified MyToy sheet, Print drawer, Pack and Reveal overlays; update
mood/create/customizer/GameCanvas/App/styles; retire the old tabbed screens
and duplicate UI. Reuse BuilderCanvas, TryOn, CheckList, and SkinPanel
directly. Engine behavior stays behind its own UI and save object; React
reads typed events and never touches the engine per frame.


## Validation Gates

1. `npm run validate`, `npm run typecheck`, `npm test`, `npm run build`, and
   `npm run preflight` pass.
2. A 390×844 walkthrough checks dock fit, toy switching, photo-skin
   disclosure only on scanned toys, S/M/L pills, SAM outline, Starter backup
   row, slot-to-board equips, fit-filtered catalog, AR View plus Stud Grid,
   gated STL, pack equip with misplaced-part guidance, Create offline
   fallback, Lab 1, all six overflow tools, clean copy without em dashes or
   third-party brands, and sleep-mode entry suppression.
3. The 90-second demo runs uninterrupted with seeded or Lab 1 mission state.

