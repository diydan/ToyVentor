# Spec: Level Carousel, Game Modes & STEM Ladders Port (Playtest Mockup)

Companion to [app-continuation-spec.md](app-continuation-spec.md),
[play-design-spec.md](play-design-spec.md),
[xp-system-spec.md](xp-system-spec.md), and
[native-world-port-spec.md](native-world-port-spec.md).
Source mockup: `/Users/dan/Downloads/toyventor` (`README.md`,
`CONTINUE.md`). This spec decides what ports into ToyForge, what ToyForge
keeps, and in what order. No implementation starts until §14 sign-off.

> Status: **SIGNED OFF 2026-11-02 — C1+C2 landed, C3 all six little rungs landed.**
> Decisions in §6 bind implementation.
> C3 as shipped (all six): `runtime/level2Scene.ts` (pure
> tap/arrive sessions over the carry core + ordered visit sessions
> for `little.pop`, `little.animals`, `little.peek`, `little.gogo`)
> + scene markers in `world.ts`; tap walks the toy there; arrivals
> resolve through the same rules as the panel proxy, so scene
> and panel can never disagree. Play-verified in headless Chrome:
> full Pack-the-car run in-world (2★ with accuracy math), full
> Pop/Animals/Peekaboo/Go runs in-world (Pop 2★ after a scene miss),
> run advance, miss counting. Marker taps win over occluding props
> within range; marker hit areas meet the band 0–1 target size;
> marker taps steer z to the marker so arrivals always resolve.
> Wrong taps hop the tapped marker and cue the right one ~0.8 s
> later (`reactThenHint`); copy never says "wrong".
> Toast twins every prompt; speech twin still open.
> C2 as shipped: `startLearnRun`/`stopLearnRun`/`learnState` on the
> engine facade with `LearnSnapshot` + `learnFinished` events; lab
> rungs ride the real lab missions at the rung tier; the 21 new-id
> rungs play as panel steps (`runtime/learnRungs.ts`, mission type
> `learn`, scored by the stock attempts/win pipeline); finishing a
> run returns to the Map; `Free world` exits a run from the dock
> menu. Tier chips hide during a run so the XP tier clamp cannot
> rewrite a rung's tier. `Hear it` speech arrives with C3 (§11).
> C1 as shipped: `src/lib/{age,learn,ladders,mapCards}.ts`, `ageBand` in
> `progression:v1` (§9.3), §9.4 one-time import, `MapCarousel` +
> `RungSheet` behind dock `⋯` → `Map`, grown-up Age/Levels rows, and
> engine `found`/`missionsDone` key snapshots for pips. Cards ship
> theme scenes (Q2 open); Learn taps show the coming-soon notice
> until C2. Scoring map note: `circuits` mints `circuits.series` (the
> three `lab4.circuit` tiers are consumed by the first three rungs).
> Open questions in §15 block the phases named beside them.

## 1. Problem & goal

ToyForge today is a single 3D stage
([GameCanvas.tsx](../../src/features/game/world/GameCanvas.tsx)) with a
top dock (`[Toy ▾]`, `Build`, `Create`, `Pack`, `⋯`), one active sheet at a
time, `6` worlds + `Lab 1–6` STEM missions, `11` mission types
(`bridge`, `measure`, `balance`, `logic`, `lift`, `lever`, `circuit`,
`code`, `pattern`, `clean`, `raft`), Maker-Rank XP
([progression.ts](../../src/lib/progression.ts)), daily quests and
real-life routines ([dailyQuests.ts](../../src/lib/dailyQuests.ts)), and
Toy Box inventory ([toybox.tsx](../../src/state/toybox.tsx),
[MyToySheet.tsx](../../src/features/game/world/MyToySheet.tsx)).
It has no level map a child can browse, no age-banded learning path, and
no coverage for ages `2–4` or everyday-life activities.

The playtest mockup (`toyventor`) prototypes exactly those gaps: a swipe
level carousel, `10` game modes, `7` age-banded learning ladders
(`38` rungs), a grown-up age gate, and world-first toddler levels. Its
engine, routing, and storage do **not** match ToyForge (§5).

**Goal:** port the mockup's *browsing UX, mode taxonomy, age logic, and
learning content* onto ToyForge's existing engine, XP, inventory, and
parent-time systems — without a second engine, a second save format, or
a page reload.

Out of scope for this spec: new 3D worlds, new printable parts, and
Spark level generation (owned by [play-design-spec.md](play-design-spec.md)
§Generating new levels). This spec only carries hand-made mockup content
into ToyForge's existing world and mission surfaces.

## 2. Source inventory (what the mockup is)

Vite + React 19 + TypeScript, `three@0.128.0`, two entries:
`/` = design guide, `/world.html` = game.

| Area | Mockup files | Size / shape |
| --- | --- | --- |
| Legacy engine | `src/world/engine/engine.js`, `shell.html`, `vendor.ts`, `world.css` | `2,134`-line classic global script, verbatim artifact; `three` r128 byte-identical vendor; global CSS (own HTML entry) |
| React bridge | `src/world/runtime/*` (`start.ts`, `events.ts`, `reducer.ts`, `types.ts`) | `window.__tvEmit` / `window.__tvAct`; engine boots once per page load |
| Routing | `src/world/runtime/mode.ts` | URL hash + `window.location.reload()` per screen (`goTo`) |
| Carousel | `src/world/MapCarousel.tsx`, `mapCards.ts`, `carousel.css`, `Buddy.tsx`, `RungSheet.tsx` | One swipe row, nothing locked, pips/silhouettes, one suggested card |
| Path map (alt) | `src/world/LevelMap.tsx` (`#path`) | Winding path, `Learn` then `Explore`, unlocks in order |
| Age + ladders | `src/world/runtime/age.ts`, `ladders.ts`, `learn.ts`, `AgePicker.tsx`, `AgeLayers.tsx` | `6` bands; banded vs sequence ladders (pure logic) |
| Worlds/labs | `src/world/runtime/stops.ts`, `progress.ts` | `6` worlds (5 hidden parts each) + `6` labs (missions); reads `localStorage["tf25"]` |
| Chrome | `Home.tsx`, `TopBar.tsx`, `GameMenu.tsx`, `GrownUps.tsx`, `ParentGate.tsx` | One icon top bar; `2 s` hold gate; icon-tile sheets |
| Design kit | `src/components/ui/*`, `icons.ts` (~`70` icons), `src/design/tokens.ts`, `src/styles/*` | Tokens as CSS vars, scoped under `.tv-ui` |
| World kit | `engine.js` §`WORLD KIT` | `kid()`, `tell()`, `tapItem`/`dragItem`/`dropZone`, `cueObj()`, `reactThenHint()`, `idleCue()`, `finishLevel()`, `proxyPanel()` |
| Tests | `tests/e2e/*` (`carousel-test.js`, `age-map-test.js`, `animals/pack/peek/gogo/tidy/finish/frame/shell-test.js`) | Headless-Chromium e2e; no real-phone check |

Known mockup debt (from its `CONTINUE.md`, inherited if we port naively):
carousel-vs-path undecided; only the `6` Little-ones levels are
world-first (its other `22` hand-built levels use the text mission
panel); the map's robot
guide stands in for the player's real toy; `learn.ts` has no unit tests;
`ParentGate` needs an assistive-tech alternative; nothing checked on a
real phone.

## 3. Destination inventory (what ToyForge already has)

| ToyForge piece | Files | Relevance |
| --- | --- | --- |
| App shell | [App.tsx](../../src/App.tsx) → `GameCanvas` | Single-screen play; `?tab=` overlays (`toy`/`scan`/`build`/`pack`/`reveal`/`parent`) |
| Engine facade | [engine.ts](../../src/features/game/world/engine.ts) (`WORLDS`, `EngineHandle`, world/mission snapshots) | All overlays talk to `EngineHandle` only; no per-frame React |
| Stage runtime | `src/features/game/world/runtime/world.ts`, `worldScene.ts`, `missions.ts`, `missionData.ts`, `playerRig.ts`, `stlRigLoader.ts` | Native in-process Three.js; `30` hidden parts; Lab 1–6 |
| XP + ranks | [progression.ts](../../src/lib/progression.ts) | `toyforge:progression:v1`, synced as `character` lane `progression:v1`; stars, ranks, tier gates, practice XP |
| Quests/routines | [dailyQuests.ts](../../src/lib/dailyQuests.ts) | 3 rotating Daily Quests, `11` Concept Badges, parent-enabled routines (+25 XP/day), Workshop Days |
| Inventory | [toybox.tsx](../../src/state/toybox.tsx), [MyToySheet.tsx](../../src/features/game/world/MyToySheet.tsx), [PackOverlay.tsx](../../src/features/game/world/PackOverlay.tsx) | Toys, builds, owned parts; grandfathered unlocks |
| Parent gate | [GrownUpsSheet.tsx](../../src/features/game/world/GrownUpsSheet.tsx), `shared/parent-time.ts`, [parentTime.ts](../../src/lib/parentTime.ts) | `1.2 s` hold + 4-tap PIN, lockout, play-time ledger, Sleep Curtain |
| Toy thumb | [ToyMiniIcon.tsx](../../src/features/game/world/ToyMiniIcon.tsx), `shared/toycontract.ts` | Live equipped-toy preview — the mockup's missing "toy on the map" |

ToyForge lab mapping already overlaps the mockup labs:
`lab1` bridge/measure/balance, `lab2` logic/lift, `lab3` raft,
`lab4` lever/circuit, `lab5` code/pattern, `lab6` clean — identical goal
keys to mockup `stops.ts`. World part keys (`character.*`, `vehicle.*`,
`robot.*`) also match mockup goal keys verbatim. Content therefore ports
by key, not by re-authoring.

---

## 4. Verdict (what ports, what stays, what is skipped)

Keep ToyForge's main menu, inventory, engine, XP, and parent-time.
Port patterns and content, never parallel implementations.

| Mockup piece | Verdict | ToyForge form |
| --- | --- | --- |
| Level carousel | **Port (rebuild)** | New `MapCarousel` sheet/overlay over ToyForge worlds, labs, ladders (§7) |
| Path map `#path` | **Skip** | Deleted concept; carousel wins per mockup `CONTINUE.md` todo 2. Do not port `LevelMap.tsx` / `stopStates()` lock chain |
| Game modes list | **Port taxonomy only** | Map `Entry` names onto ToyForge overlays (§8). Skip hash+reload `goTo()` |
| Age bands + `learn.ts` | **Port logic verbatim (adapted keys)** | `src/lib/learn.ts` + `src/lib/age.ts`, reading `progression:v1` (§9) |
| Ladder definitions | **Port as data** | `src/lib/ladders.ts` (generated mirror, like mockup) (§10) |
| World/lab stop list | **Reuse ToyForge ids** | Derive cards from ToyForge `WORLDS`/`catalog.ts`; mockup `stops.ts` is a checklist, not a source file |
| `RungSheet`, `AgePicker` | **Port as pattern** | Bottom sheets in GameCanvas sheet stack; age set only behind existing PIN gate |
| Buddy robot guide | **Replace** | Live `ToyMiniIcon` (equipped build + paint) marks the suggested card; robot SVG optional fallback only pre-first-build |
| `TopBar` + `GameMenu` | **Skip shell, keep rule** | ToyForge dock stays. Adopt rule only: every mode is reachable in ≤ 2 taps, icons + captions, one menu sheet |
| `ParentGate` hold | **Skip (keep ToyForge)** | ToyForge `1.2 s` hold + PIN is stronger; mockup `2 s` hold-only never becomes the sole barrier |
| Design tokens + kit + icons | **Cherry-pick** | Icon names/glyphs and `BottomSheet`/`IconTile` behaviour where ToyForge has a gap; no second token system |
| World-kit primitives | **Port as rules** | Bind to ToyForge primitives in play-design §The interaction primitives (§11); no `engine.js` code moves |
| Legacy `engine.js`, `vendor.ts`, `shell.html`, `world.css`, `iconify.ts`, `capture-map.cjs` | **Skip** | ToyForge runtime is canonical. Map thumbnails come from live scene render or static theme art, never `src/world/map/*.jpg` captures |
| Storage `tf25`/`tvDone`/`tvLittle`/`tvAge`/`tvStars` | **Skip** | Single store: extended `progression:v1` (§9.3). One-time import in §9.4, then ignore forever |
| Demo tabs (`tvDemo`), `#tester`, `#picker` | **Skip / map** | ToyForge Demo Mode + Grown-ups cover demos; tester flows stay out of the shipped app |
| E2E test list | **Port as checklist** | Re-implement scenarios against ToyForge (§13); mockup `.js` files are reference only |

## 5. Why not a wholesale port (hard constraints)

1. **One engine, one WebGL context.** ToyForge's native runtime already
   removed the iframe (Phase 0) and guarantees ≤ 1 live context under
   React 19 `StrictMode`. Mockup `engine.js` (global script, Three r128,
   `window.__x` debug handle) would double-bundle Three and reintroduce
   global CSS collisions (`.sheet`, `.chip`) the mockup itself works
   around with `.tv-ui` scoping.
2. **No reload navigation.** Mockup `readRoute()`/`goTo()` reload because
   its engine boots once per page. ToyForge `createEngine` mounts once
   and `setToy` swaps in memory. Carousel taps must switch world/mode
   in place; camera, audio, and play-time heartbeat must survive.
3. **One save, synced.** ToyForge progression is local-first **and**
   ownership-synced; the parent ledger timestamps progress. Forking
   `tf25`/`tvDone` would desync XP, stars, and play-time on the same
   device and break merge-on-pull.
4. **One safety gate.** Purchases, printing, time limits, and content
   already sit behind ToyForge's hold + PIN. Age-setting joins that
   gate; it never grows a parallel hold-only gate (COPPA / parent-time
   compatibility).
5. **One stage rule.** ToyForge allows at most one active sheet over the
   stage (`GameCanvas` enforces this today). Carousel, rung picker, and
   age picker are sheets in that stack — never routes, never stacked
   modals.

## 6. Decisions (bind implementation)

### Decision 1 — Carousel is the only level browser

Play opens on the stage as today. A `Map` affordance (dock `⋯` →
`Map`, plus post-level "back to map") opens **one** swipe carousel:
age-appropriate Learn cards first, then Explore (worlds, then labs) in
canonical order. Nothing is hard-locked for worlds/labs; progress shows
as collected things (gold = found/earned), never as a gate. Ladder
rungs keep their §9 lock rules — that is the only locking in the
system. The winding-path map is not built.

### Decision 2 — ToyForge shell wins

Top dock, Toy Box / `MyToySheet`, `PackOverlay`, `RevealOverlay`,
`ToyCustomizer` (Build), `CreatePanel`, `EditorPanel`, `MissionPanel`,
`GrownUpsSheet`, and `SleepCurtain` are unchanged contracts. This port
adds at most: `MapCarousel`, `RungSheet`, `AgePicker` (inside Grown-ups),
and engine-facade additions (§12). No file is replaced by its mockup
namesake.

### Decision 3 — The child's real toy is the guide

The carousel's centre/guide is the active equipped toy (live
`ToyMiniIcon` + name), satisfying mockup `CONTINUE.md` todo 1 directly.
The slice: toy thumb sits above the suggested card and animates
(bob/idle) as the "play this next" cue; the row opens centred on the
suggested card. No robot asset ships except as an empty-state fallback
before a first build exists.

### Decision 4 — Age is a grown-up setting, not a kid prompt

A grown-up sets one of `6` bands once, behind the existing PIN gate
(Grown-ups → Age). Age lives in `progression:v1` (§9.3) and syncs with
XP. While unset, Learn shows a single "Who's playing?" card whose tap
opens the gate (same behaviour as mockup). Age changes re-derive the
carousel immediately; earned stars are never deleted by an age change.

### Decision 5 — Ladders score through XP, never beside it

Every ladder finish is a `missionSolved` event scored by
[xp-system-spec.md](xp-system-spec.md) rules (attempt stars, daily
best/delta/practice). Banded rungs map to existing mission ids where
one exists (§10.2); new toddler/routine rungs get new ids with Tier 1
base XP until playtested. `tvDone` is never reintroduced: "done" =
`bestStars >= 1` for that rung's progression key.

### Decision 6 — World-first is the bar, panel is the fallback

The `6` Little-ones levels port as world-first reference
implementations. The remaining `32` rungs may launch with the existing
ToyForge mission panel (visually-hidden-but-focusable, per §11.4) and
are converted ladder-by-ladder. A rung is only "converted" when it
meets play-design world-first checks (touch the thing, cause →
consequence visible, no dead touches).

### Decision 7 — Younger bands win over older bands

Convert `little` → `early`/`daily` → `bridges`/`gears`/`circuits`/
`code` → labs polish, in that order (§12 rollout). Younger children
gain most from world-first play and currently have zero ToyForge
coverage; older bands already have playable labs.

---

## 7. Level carousel (detailed)

Reference: mockup `MapCarousel.tsx` + `mapCards.ts` + `carousel.css`.
Rebuild as ToyForge `src/features/game/world/MapCarousel.tsx` +
`src/lib/mapCards.ts` (pure derivation, unit-tested).

### 7.1 Layout and input

- One horizontal row of large scene cards over the stage (sheet/overlay,
  stage visible behind/around it per ToyForge sheet pattern). Title
  `Map`; header: `Home` (closes to stage) + age chip (opens gate).
- Input parity with mockup: swipe/scroll, mouse wheel (vertical →
  horizontal), `ArrowLeft`/`ArrowRight` step between focused cards,
  `Tab` through cards. Centre card at `100%` scale/opacity; neighbours
  scale/fade by distance (`--d` 0→1 over ~`1.1 ×` card width), updated
  on `requestAnimationFrame` from scroll. Honour
  `prefers-reduced-motion` (no scale animation; guide holds still).
- Each card is a single `<button>` with full accessible name:
  `{label}, {kind}: {done} of {total}` + `, done` when complete; the
  ask card reads "Who is playing? A grown-up sets the age…".

### 7.2 Card model

Types ports from mockup `mapCards.ts` (`MapCard`, `Pip`), re-sourced:

```ts
type CardKind = "ask" | "learn" | "world" | "lab";
interface Pip { icon: IconName; done: boolean; silhouette: boolean }
interface MapCard {
  id: string; kind: CardKind; label: string; theme: string;
  ladder?: LadderState; pips: Pip[];
  done: number; total: number; complete: boolean; suggested: boolean;
}
```

- `kind` badge + word: `Grown-up`/`Learn`/`World`/`Lab`
  (icons: `lock`/`play`/`compass`/`bridge`, per mockup `KIND_ICON`).
- World pips: one per hidden part (`5`); icon = part slot
  (`goal.split(".")[1]`, e.g. `hat`, `ears`, `back`); shown as outline
  silhouette until found, filled gold when found. Lab/ladder pips:
  `check` icons, filled when done. Completed card shows a `check`
  badge. "Found" reads ToyForge found/mdones via the engine facade
  snapshot — never `localStorage["tf25"]` directly.
- Scene art: live world render (offscreen snapshot of the ToyForge
  scene at card size) or theme art — decided in §15 Q2. Never the
  mockup's `src/world/map/*.jpg` set; if still art is used, regenerate
  from ToyForge worlds (`garden`, `sky`, `junk`, `beach`, `snow`,
  `room`, `lab1`–`lab6`, `little`, `early`, `daily`, `bridges`,
  `gears`, `circuits`, `code`) with a ToyForge capture script.

### 7.3 Ordering and suggestion

Order (ports `mapCards(age)`): `[ask?] → learn ladders (age-suited,
map order) → worlds (garden, sky, junk, beach, snow, room) → labs
(lab1…lab6)`. With no age set and no suites, the single `ask` card
leads. Suggestion rule (unchanged from mockup): the `ask` card if
present, else the first incomplete `learn` card, else the first
incomplete card. Row opens centred on the suggestion; the active toy
(Decision 3) hovers over it. The suggestion is advice only — every
card remains tappable (except locked rungs inside `RungSheet`).

### 7.4 Tap behaviour

- `ask` → open grown-up gate → `AgePicker`.
- `learn` with `ladder.choices > 1` → open `RungSheet` (§7.5); else
  start the ladder run directly (§9.2 plan).
- `world` / `lab` → switch stage to that world/lab in place (§12),
  close the carousel. No reload, no hash change required. Optional
  deep links (`?world=`, `#w-`) are §15 Q5, not v1.
- After a ladder run finishes, return to the carousel (mockup
  `__tvGoMap` behaviour), re-centred on the new suggestion. After a
  world/lab visit, `Map` reopens the carousel; progress pips refresh
  from the facade snapshot.

### 7.5 RungSheet

Ports mockup `RungSheet.tsx`: titled sheet listing every rung
(`title` + `Ages x–y`, `lock`/`check`/`play` mark). The
age-appropriate next rung glows (`next` class). Locked rungs disabled.
Pick → run that rung (banded) or run from that rung onward (sequence,
per §9.2 `planFor`). Sheet and carousel never open simultaneously.

## 8. Game modes (taxonomy → ToyForge mapping)

Mockup `Entry = home | map | path | play | learn | world | free |
build | create | lab | editor | picker` (`mode.ts`, `isLadder` =
`play|learn|picker`). ToyForge keeps the *names and intent*, drops
`path`/`picker`/`tester`, and implements every mode as stage state +
at most one sheet — never a route with reload.

| Mockup entry | ToyForge equivalent | Entry point |
| --- | --- | --- |
| `home` | Stage at rest (no sheet) | Boot; dock `Toy ▾`; carousel `Home` closes to stage |
| `map` | `MapCarousel` open | Dock `⋯` → `Map`; post-level return |
| `path` | — (not built) | — |
| `play` (`#l-little` loop) | Learn run, `little` ladder, kid mode | Carousel Learn card → run |
| `learn` (`#l-<track>[-<n>]`) | Learn run, named ladder[/rung], kid mode | Carousel / `RungSheet` pick |
| `world` (`#w-<id>`) | Stage in world/lab `id`, full moves + tool belt | Carousel World/Lab card; existing `Worlds` selector |
| `free` | Stage freeroam, no mission forcing | Dock `⋯` → `Free world` (and from a Learn run's menu) |
| `build` | `ToyCustomizer` open on stage | Dock `Build` (existing) |
| `create` | `CreatePanel` open (`/api/muse/spark` + offline parser) | Dock `Create` (existing) |
| `lab` | STEM playground = any `lab1–6` world (no separate engine mode) | Grown-ups → STEM playground → carousel filtered to labs (or `lab1`) |
| `editor` | `EditorPanel` open | Dock `⋯` / Grown-ups (existing `openEditor`) |
| `picker` / `tester` | — (not shipped) | Grown-ups `Levels` jumps to carousel + `RungSheet`; tester tooling out of product |

Mode invariants (port from mockup README §top bar):

- The same dock + menu appear in every mode, Learn runs included.
- Learn runs and worlds share the four moves + tool belt; in kid mode
  (§11) the belt hides behind the mission prompt but never disappears
  from the accessibility tree.
- From any mode: `Home` (1 tap to stage), `Map` (≤ 2 taps), `Build`,
  `Create`, sound, and Grown-ups are reachable. From a Learn run,
  `Free world` and `Hear it` (replay prompt speech) also appear.
- Demo/teleport tabs exist only under ToyForge Demo Mode, never as a
  kid-visible unlock bypass.

## 9. Age bands, ladder state, and persistence

Ports mockup `age.ts` → `src/lib/age.ts`, `learn.ts` → `src/lib/learn.ts`
(pure functions; this spec requires the unit tests the mockup lacks).

### 9.1 Bands

```ts
BANDS[6]: "2 to 3" (2–3) · "3 to 4" (3–4) · "5 to 6" (5–6) ·
          "7 to 9" (7–9) · "10 to 12" (10–12) · "13+" (13–∞)
```

`bandOf(ageText)` maps an engine rung age (`"3 to 4"`, `"4 to 6"`,
`"13+"`) to a band index (exact match, else first number's band).
`readAge` returns the stored index or `null`. Labels/picker copy reuse
mockup `AgePicker.tsx` / `BANDS[i].label`.

### 9.2 Ladder state (ports `learn.ts` rules exactly)

A ladder is **banded** iff its rung bands strictly increase
(`bridges`, `gears`, `circuits`, `code`); otherwise a **sequence**
(`little`, `early`, `daily`).

- **Visibility:** hidden if `age < youngest rung band`. Banded ladders
  stay visible for every older age; sequences hide when
  `age > oldest + 1` (so `little` shows for bands 0–1, `early` for
  1–2). With no age set, **no** Learn cards show (only `ask`) unless
  Demo/`sandboxUnlockAll` is on.
- **Banded:** start rung = last rung with `band <= age` (`ageRung`).
  `unlockedTo = max(ageRung, maxDone + 1)` (or all, if sandbox).
  Shown dots = rungs `ageRung…end`. Tap plays `next` (first undone
  shown rung ≤ unlocked). One rung per run (`plan = [next]`). Rungs
  below `ageRung` stay open via `RungSheet`. `choices = unlockedTo+1`.
- **Sequence:** shown = rungs with `band <= age`, in order. Tap plays
  from first undone shown rung through the end
  (`plan = shown ≥ next`), then returns to the map. `choices = 1`.
- `planFor(track, age, rung?)` honours an explicit rung pick; a direct
  start on an age-unsuited ladder still plays (built as if open) so
  grown-up picks and demos never dead-end.
- `learnStates(age)` returns visible ladders in map order; `[]` when
  age unset and not sandbox.

"Done" per rung: ToyForge `missionStars[key] >= 1` (Decision 5),
where `key` is the rung's progression key (§10.2). Legacy mockup
`tvDone`/`tvLittle` are read once by the §9.4 importer only.

### 9.3 Storage (single record, backwards compatible)

Extend [progression.ts](../../src/lib/progression.ts)
`ProgressionState` (key `toyforge:progression:v1`, ownership id
`progression:v1`):

| Field | Type | Notes |
| --- | --- | --- |
| `ageBand` | `number \| null`, optional | Band index `0–5`; absent/`null` = unset. Validated in `normalizeProgression` (integer range, else dropped) |
| *(existing)* `missionStars`, `daily`, `totalXp`, `unlockedIds`, `sandboxUnlockAll`, `resetAt`, quests/chores fields | unchanged | Ladder stars live here; no new stars store |

Merge rule on pull: prefer the record with non-null `ageBand`; if both
set and differ, prefer the one with higher `totalXp` (matches existing
"furthest along wins" merge) and log the conflict (§15 Q4). `sandboxUnlockAll`
subsumes mockup `tvOpenAll`; `tvDemo` maps to ToyForge Demo Mode.
Normalize must tolerate old clients (missing `ageBand`) and never
wipe `unlockedIds` on XP reset (existing rule extends to `ageBand`:
reset keeps age — §15 Q4 confirms).

### 9.4 One-time mockup import (device-local, silent)

On first boot after this ships, if any mockup key exists locally
(`tvAge`, `tvDone`, `tvLittle`, `tf25`), import once and set a
`carousel:imported:v1` marker: `tvAge` → `ageBand`; each finished rung
→ `1` star on its Tier-1 key (no retro XP — same rule as legacy
`mdone` in xp-spec Decision 2); `tf25.found`/`mdone` already share
ToyForge goal keys, so found parts re-derive from ToyForge's own save
and need no copy. Afterwards mockup keys are never read again. No UI,
no prompt; playtests start clean on fresh devices.

---

## 10. STEM & activity catalogue

New data file `src/lib/ladders.ts` — a generated mirror of mockup
`runtime/ladders.ts` (itself generated from engine `TRACKS`), checked
against ToyForge mission ids by test (§13). Shape:
`Ladder { id, label, theme, rungs: { title, age }[] }`,
`ladderById(id)`.

### 10.1 Full rung catalogue (7 ladders, 38 rungs)

| Ladder (`id`, theme) | Shape | Rungs (`title`, engine age) |
| --- | --- | --- |
| `little` — Little ones (`garden`) | sequence | Pop the bubbles `2–3` · Animal friends `2–3` · Pack the car `2–3` · Peekaboo `2–3` · Go, car, go! `2–3` · Tidy one thing `2–3` |
| `early` — Early learning (`sky`) | sequence | Colors `3–4` · Numbers `3–4` · Words `3–4` · Phrases `3–4` |
| `daily` — Daily life (`room`) | sequence | Wash hands `3–4` · Brush teeth `3–4` · Get dressed `3–4` · Clean up toys `3–4` · Tidy the room `5–6` · Help cook `4–6` · Family meal `3–4` · Clean up after meals `3–4` |
| `bridges` — Bridges (`beach`) | banded | One plank `3–4` · Measure the gap `5–6` · Triangles `7–9` · Budget bridge `10–12` · Lightest truss `13+` |
| `gears` — Gears (`junk`) | banded | Turn the crank `3–4` · Big gear, small gear `5–6` · Gear lift `7–9` · Exact ratio `10–12` · Gearbox `13+` |
| `circuits` — Circuits (`snow`) | banded | Tap to light `3–4` · Metal or not `5–6` · Close the loop `7–9` · Series or parallel `10–12` · Sensor logic `13+` |
| `code` — Code (`sky`) | banded | Tap the arrows `3–4` · Sequence cards `5–6` · Loops `7–9` · If-then rules `10–12` · Text code `13+` |

Explore stops (derive from ToyForge, verify against this list):
worlds `garden`, `sky`, `junk`, `beach`, `snow`, `room` (5 hidden
parts each); labs `lab1` Bridges, `lab2` Machines, `lab3` Water,
`lab4` Levers and Lights, `lab5` Code and Patterns, `lab6` Clean-up
with goals `labN.bridge/measure/balance/logic/lift/raft/lever/circuit/
code/pattern/clean` as in §3. `STOP_ICON`/`THEME_COLOR`
(mockup `mapStyle.ts`) port as the carousel's icon/colour lookup,
keyed by the same ids.

### 10.2 Rung → mission scoring map

Each rung gains a progression `missionId` (+ Tier 1 key
`{missionId}:t1`). Reuse existing ids wherever the ToyForge lab already
teaches the same task so stars, Concept Badges, and Daily Quests keep
working; mint new ids only for genuinely new tasks. Required mapping
(implementation must encode this table as data and test it):

| Ladder rung | `missionId` | Why |
| --- | --- | --- |
| `bridges`: One plank, Measure the gap, Triangles, Budget bridge, Lightest truss | `lab1.bridge` (tiers 1–3 for later rungs), `lab1.measure`, `lab1.balance` where the task matches | One concept, rising difficulty = tier, not new ids |
| `gears`: Turn the crank, Big/small gear, Gear lift, Exact ratio, Gearbox | `lab2.lift` (+tiers); `gears.ratio`, `gears.gearbox` if no lab equivalent exists | Lift is the ToyForge gear task today |
| `circuits`: Tap to light … Sensor logic | `lab4.circuit` (+tiers), `lab2.logic` for sensor logic | Existing switch/logic instrumentation |
| `code`: Tap arrows … Text code | `lab5.code` (+tiers), `lab5.pattern` for sequence cards | Existing code/pattern attempts already scored |
| `little`: all 6 | New: `little.pop`, `little.animals`, `little.pack`, `little.peek`, `little.gogo`, `little.tidy` | No ToyForge equivalent; Tier 1 only at launch |
| `early`: Colors/Numbers/Words/Phrases | New: `early.colors`, `early.numbers`, `early.words`, `early.phrases` | Language/number work is new coverage |
| `daily`: all 8 | New: `daily.wash`, `daily.brush`, `daily.dress`, `daily.toys`, `daily.tidy`, `daily.cook`, `daily.meal`, `daily.clean` | Pairs with (never duplicates) parent real-life routines; see §10.3 |

New ids enter `MISSION_TYPES`/`MISSION_STAT` only if they should earn
the part-match bonus; at launch toddler/routine rungs award base XP +
accuracy only (no part-match, no vehicle gates). Tier 2/3 for new ids
is a follow-up decision (§15 Q3).

### 10.3 Daily life vs real-life routines (no double-pay)

`daily` rungs are **in-game** play (the toy washes hands). ToyForge
real-life routines are **in-life** tasks (the child washes hands,
grown-up confirms, +25 XP/day). Both may exist; they use different
keys and neither blocks the other. UI copy must keep them distinct
("Play: wash hands" vs "Real life: wash hands") so families never
feel double-charged or pressured to perform a routine twice.

## 11. World-first interaction rules (port as behaviour)

Source: mockup README §World-first levels + §The world kit, bound to
[play-design-spec.md](play-design-spec.md) primitives
(`poke`, `carry`, `sort`, `sequence`, `turn`, `toggle`, `load`, `tune`,
`design`, `connect`, `program`, `real`). No `engine.js` moves; ToyForge
runtime implements the same contracts.

### 11.1 Primitive contracts (implement in ToyForge runtime)

| Mockup kit | ToyForge binding |
| --- | --- |
| `kid()` | Run flag `kidMode` for Learn runs (default on; Demo/tester off). Gates §11.2–11.4 behaviour |
| `tell(msg)` | Speech + toast pill twin. Every spoken prompt also renders as text; muted play stays fully playable |
| `tapItem` / `dragItem` / `dropZone` | `userData.tap`, `userData.drag = { tap, drop, cancel }`, `userData.drop`. A press that never moves is a tap (tap-then-tap alternative to dragging, mandatory for bands 0–1) |
| `cueObj(o, n)` | Point-at: meshes wiggle, flat sprites hop (never rotate a sprite) |
| `reactThenHint(tapped, hinted)` | Wrong tap: tapped item hops/wiggles + soft "boing" immediately; correct item cues ~`0.8 s` later. Copy stays positive — never the word "wrong" |
| `idleCue(m, { cue, blocked })` | After a quiet spell, cue the next useful object. Level sets `nudgeAll: true` when cueing the answer would spoil it (e.g. Peekaboo) |
| `finishLevel(m, { msg, toX })` | Win: hide prompt chrome, celebrate, toy drives/walks to the chest, controls release, then flow returns (§7.4) |
| `proxyPanel(buttons)` | Visually-hidden focusable buttons mirroring every world action (keyboard / screen-reader / switch). Tabbing into the panel reveals it |

### 11.2 Kid-mode driving and touching (bands 0–1, reference)

- Car/toy moves by touch: hold or drag to keep going, lift to stop
  (press > ~`260 ms` stops on release); tap = go to that spot; arrow
  keys always work. "Go, car, go!" has **no buttons** — progress is
  the car's position; each road dot turns green as it passes.
- Tap-the-scene levels opt in with `world: true`; every scene object
  in the round carries `tap`. Idle nudge wiggles meshes / hops sprites.
- Consistency rule: **every touch gets a reaction** (< `100 ms`, per
  play-design). Touching the road drives there if reachable; if the
  level gate blocks, the toy honks/hops instead of ignoring input.

### 11.3 Reference levels (port first, verbatim behaviour)

All six `little` rungs, already world-first in the mockup: Pop the
bubbles, Animal friends, Pack the car, Peekaboo, Go car go, Tidy one
thing. Their mockup e2e pairs (`animals-test`, `pack-test`,
`peek-test`, `gogo-test`, `tidy-test`, `finish-test`, plus tester
variants) are the acceptance scenarios in §13. World-first target
versions follow play-design §Converting today's levels (balloons tie
onto the toy, stepping stones drop in the river, etc.) where the
mockup rung is still panel-based.

### 11.4 Accessibility (non-negotiable at launch)

- The text mission panel on tap-the-scene levels is only *visually*
  hidden: goal + choice buttons stay in the accessibility tree;
  focusing the panel reveals it. Every level is playable without a
  pointer and without sound (toast twin, §11.1).
- Hit targets follow play-design age presets (`≥ 96 px` bands 0–1,
  stepping to `≥ 44 px` at `13+`); carousel cards and rung rows are
  native buttons with the §7.1 names.
- `ParentGate` hold-only is **not** ported (Decision 2): ToyForge PIN
  pad + math fallback remains the single gate, including for age set.

### 11.5 What stays panel-based at launch

`bridges`/`gears`/`circuits`/`code`/`early`/`daily` rungs beyond the
reference six ship on ToyForge's existing `MissionPanel` (with §11.4
panel-visibility rules) and convert per §12. Kid mode may tuck the
tool belt behind the panel, but moves, dock, and `Hear it` remain.

### 11.6 Path depth (decided 2026-11-02, lands first in C3)

Movement today is a strict 1D lane (`pos.z` stays 0; facing is 0 or
π; ground taps resolve through `laneX()`). C3 widens it to a shallow
**path**: the toy may stand/walk at z ∈ [−1.2, +1.2] around the lane
centre and faces its movement direction, including toward and away
from the camera. The path is still one authored strip — no free
roaming, no new navigation system. Tap targets become ground
points; near-detection, mission bounds, tidy/spot radii, and street
crossings become z-aware; camera framing and blob shadow follow z.
Keyboard keeps left/right on the lane centre (up/down nudge z).
Acceptance joins §13: tap-a-spot reaches all four facing
quadrants; existing labs/worlds complete unchanged on the centre
line.
**Shipped 2026-11-03** (except street crossings, still x-only):
taps/drag walk ground points via `lanePoint()` (z ∈ [−1.2, 1.2],
centre-line easing on ←/→, ↑/↓ nudge), `atan2` facing, z-aware
near/mission/tidy detection, blob + camera follow z. Headless
390×844 probe: far/near taps z −1.17/+1.14, diagonal face −0.93,
↑/↓ nudge with edge clamp, 72 unit tests green. Editor keeps an
x-only `laneX` getter backed by `lanePoint()`.

### 11.7 Prop reaction contract (decided 2026-11-02, binds C3+)

No dead props. Every reusable scene prop (the `propBuilders` table
in `world.ts` and anything added later) declares three behaviours:

- `idle` — a calm loop (sway, glow pulse, slow spin), still under
  `prefers-reduced-motion`.
- `poke` — a < 100 ms tap reaction (wiggle, hop, squeak, flash
  small, crack stage advance), never gold unless it is a reward.
- `use` — where sensible, a state change the level can read (lamp
  on/off + light pool, tree shake → fruit falls, stone cracks in
  stages, plant sprout, chair wobble-settle, teddy squish, ball
  roll, books flutter, blocks topple, cloud rain sprinkle, drum
  wobble, cottage window light, signpost spin).

A registry test lists every prop builder and fails if a prop has no
reaction entry. Existing partial credit (tidy spots, bolts, lamp
circuit, windmill blades) is grandfathered as their `use`.

**Status (2026-11-03): built for every scene prop.** `runtime/propReactions.ts` wraps each prop placed through the level's
`props` list, which is the single path for authored levels, the level kit, Muse "describe a world" recipes, room photos and the
editor's play-test (`propBuilders` is used in exactly one place), so created and generated props behave exactly like built-in
ones. The 25 built-ins each declare `idle` / `poke` / `use` in `PROP_SPECS`: lantern, lamp and cottage window switch on and off
(the real lights, glow sprite and glass); tree, palm, pine and bushes drop apples, coconuts, snow and berries (a tree shows
three apples hanging so it looks shakeable, and grows them back after ≈10 s); cloud rains; plant sprouts; blocks topple and
re-stack; books flutter; ball rolls out and back; chair wobble-settles; teddy and cushions squish; drum booms; umbrella spins;
snowman's hat hops; windmill blades spin up. Tests: `tests/prop-reactions.test.ts` (the registry guard parses the real
`propBuilders` table and fails if a builder has no `PROP_SPECS` entry) and the real-app `scripts/e2e-props.mjs`. A prop type
nobody wrote a spec for still gets the generic wiggle and an English name (`FALLBACK_SPEC`).

Taps hit an invisible hit box a little bigger than the prop, not its thin parts (a lantern pole is a few pixels wide, a tire is
hollow). A tap on a prop reacts and names it but does **not** send the toy walking; empty ground still does. Under
`prefers-reduced-motion` reactions are softened to 40 % but never removed; idle motion is a ~0.6° sway or an 8 cm bob.

### 11.7a Say what it is: language option

Decision (Dan, 2026-11-03): a tap also says the object and its colour, in a language the kid picks: "green tree", "blue light",
"árbol verde", "grüner Baum".

- **Setting.** More menu → *Words & Language*: English, Español, Français, Deutsch, Italiano, Português, Türkçe, or Off (default English;
  stored per device as `toyforge:prop-lang:v1`). I put it in the kid-facing menu rather than behind the grown-ups gate — say if
  it should be gated — **decided 2026-11-03: not gated.** Choosing a language plays a sample ("árbol verde") so the tap doubles as the preview.
- **Names are built, not translated.** `src/lib/propNames.ts` holds a closed vocabulary (25 nouns × 12 colours × 7 languages) with
  gender and number agreement ("árbol verde" but "lámpara azul", "bloques rojos", "blaue Lampe" but "blaues Licht"). Colours
  were chosen by looking at what each builder draws (the lantern is a *blue light* — its pole; a level can give it any light
  colour, which then names it, e.g. "pink light"). Turkish puts the colour first and never inflects it ("yeşil ağaç", "kırmızı bloklar"). The seven-language wording is mine and unreviewed by native speakers (Dan asked for that review; I cannot supply it).
- **Voice.** `google/gemini-3.8-flash-lite-tts` through the Workers AI binding `AI` (AI Gateway Unified Billing: no provider key
  in the repo). Route `GET /api/voice?lang=es&n=tree&c=green` (`worker/voice.ts`) takes **vocabulary keys only, never text**, so
  it can only say what the game can say and the clip set is bounded (462 used: 36 prop/colour pairs and 30 parts, × 7 languages). Each clip is generated once,
  silence-trimmed (≈ 56 KB), and cached at the edge and in the browser for a year (`immutable`). Probed live against the real
  binding: input is exactly `{ text, voice }`, output `{ audio: "data:audio/wav;base64,…" }`; language is auto-detected; `style`
  and `prompt` are rejected (7003), so there is no "say it cheerfully" knob; the voice is `DEFAULT_VOICE = "Leda"` (Gemini's
  "youthful"; set `VOICE_NAME` or change the constant). A first request takes ≈ 2.3 s, a cached one ≈ 10 ms.
  `scripts/prewarm-voice.ts <base-url>` warms all 462 clips after a deploy; the world also prefetches the clips for the props it
  placed.
- **Fallbacks, in order:** the Gemini clip → the device's own speech voice → the on-screen caption, which always shows. A failed
  clip request switches to the device voice for 60 s. Muting sound silences speech but not the caption. `/api/*` bypasses the
  service worker, so offline a clip plays only if it was heard before; otherwise the device voice speaks.
- **Privacy / cost.** No text a child typed or said, no identifiers, nothing personal is sent. Spend is bounded by the vocabulary,
  not by taps.
- **Generated objects.** Anything created through Create, Muse recipes, room photos or the editor is covered automatically (above).
  **Describe & Build** (the Kip viewer tab) is covered too: its matcher only ever picks from 30 curated parts, so a table is
  complete (`src/lib/partNames.ts`; `tests/part-names.test.ts` fails if a part is added to `kip-describe-parts.json` without
  names). Tapping a step in the list (or pressing Enter on it), or the build player reaching it, says the part in the colour the
  exploded view *draws* ("negra rueda deportiva" is wrong, "rueda deportiva negra" is built): the tab sends the part id and that
  hex to `/api/voice?lang=&p=&hex=` and the Worker reduces the hex to one of 12 colour words, so a hex cannot multiply the clip
  set. The tab has its own language picker (same `toyforge:prop-lang:v1` key, so the game's menu and the tab agree), shows the
  spoken text as a caption, and falls back to the English part name if the voice route is down (then it leaves the route alone for
  a minute). **Forge** has no screen yet, and its parts are free-form so no table can cover them. The plan when it exists: the
  generator returns its object's name in all seven languages in the same call that makes the object, and the Worker signs that
  text so `/api/voice` can speak it without becoming an open text-to-speech endpoint. Until then a generator that wants its
  object spoken returns a `noun` key from `NOUN_KEYS` and a `color` (`describeObject`); free text is spoken in English only,
  never half-translated.
- **Content change.** The Garden's only tree sat at x = −4, off the left edge of the playable lane, so no kid could ever tap one.
  Two trees were added on the lane (x = 9.5 and 26.5, behind the toy, clear of the hidden-part spots and the windmill).
- **Deploy.** The `ai` binding in `wrangler.jsonc` bills even under `wrangler dev`. Wrangler follows `.wrangler/deploy/config.json`
  to the *built* `dist/toyventor/wrangler.json`, so rebuild before deploying or the route and binding will be missing (a
  stale `dist` returned 404 for `/api/voice` in testing).

## 12. Engine-facade changes & rollout

All changes go through [engine.ts](../../src/features/game/world/engine.ts)
`EngineHandle`; React overlays never touch the runtime directly.

### 12.1 Facade additions (additive, backwards compatible)

| Addition | Purpose |
| --- | --- |
| `goToWorld(id: WorldId)` (or widen existing world switch) | Carousel World/Lab tap switches in place; preserves toy, camera reset per world, no reload |
| `startLearnRun({ track, plan })` / `stopLearnRun()` | Arms the §9.2 plan (`window.__tvPlan` equivalent, typed); runtime advances rungs in-plan, emits `missionSolved` per rung, then calls the run-finished callback (§7.4 return-to-map) |
| `LearnSnapshot` in world state (`{ track, rungIndex, kidMode } \| null`) | Dock/menu adapt (`Hear it`, `Free world`); sheet stack knows a run is active |
| `found`/mission snapshot exposure for pips | `mapCards.ts` derives goal booleans without reading storage |
| `setKidMode(on)` (internal to run start) | Toggles §11 behaviour; never a kid-facing setting |

Instrumentation reuses the shipped pipeline (`S.ma`/`S.me`/`S.lastWin`
per xp-spec): ladder rungs emit attempts + clean flag exactly like lab
missions, so `applySolve`, Daily Quests, and Concept Badges need **no**
new scoring code beyond §10.2 ids. Sleep Curtain + 25 s mission grace
extend to Learn runs unchanged.

### 12.2 Phases (each shippable alone)

| Phase | Ships | Done when |
| --- | --- | --- |
| **C1 — Carousel shell** | `age.ts`/`learn.ts`/`ladders.ts`/`mapCards.ts` + `ageBand` in progression + `MapCarousel`/`RungSheet`/`AgePicker`; World/Lab cards live; Learn cards visible with correct pips/suggestion; toy-as-guide | §13 carousel + age-map checks green; no Learn run yet (Learn tap → "coming soon" toast) |
| **C2 — Learn runs (panel)** | Facade `startLearnRun`; all 38 rungs playable via `MissionPanel`; §10.2 scoring; post-run return to map | Every rung solvable + scored; XP/quest badges update; grace/curtain hold |
| **C3 — World-first little** | §11 runtime contracts + six reference levels; toast-twin prompts; `proxyPanel` | Six e2e scenarios pass muted + keyboard-only; play-design checks pass |
| **C4 — early + daily** | World-first `early` (4) + `daily` (8); routine copy split (§10.3) | No panel button needed for bands 0–2 |
| **C5 — Banded polish** | World-first `bridges`/`gears`/`circuits`/`code` (20 rungs), tier mapping review | Panel only as §11.4 fallback everywhere |

C1 depends on nothing new in the runtime. C2–C5 each build on the
previous; none touches `PackOverlay`, roster gating, or print flows.

### 12.3 Files touched (budget)

New: `src/lib/age.ts`, `src/lib/learn.ts`, `src/lib/ladders.ts`,
`src/lib/mapCards.ts`, `src/features/game/world/MapCarousel.tsx`,
`RungSheet.tsx` (same folder). Edited: `progression.ts` (`ageBand` +
import + tests), `engine.ts` (facade, §12.1), `GameCanvas.tsx` (sheet
stack + `Map` entry), `GrownUpsSheet.tsx` (Age + Levels rows),
`missionData.ts`/`missions.ts`/`world.ts` (rung content, C2+). Deleted:
nothing in ToyForge; the mockup folder is never vendored.

---

## 13. Verification & acceptance

Robot checks run at `390 × 844` portrait (+ phone landscape), matching
ToyForge's existing e2e viewport. Mockup `tests/e2e` files are scenario
references only; ToyForge implements its own under `tests/`.

### 13.1 Unit tests (required with C1)

- `learn.ts`: banded vs sequence classification; visibility for all
  `7 ladders × 7 age states` (unset + 6 bands); `unlockedTo`/`next`/
  `plan`/`choices` for fresh, mid-progress, and complete saves;
  `planFor` with explicit rung; sandbox (`sandboxUnlockAll`) opens all.
- `age.ts`: `bandOf` for every ladder age string + `"4 to 6"` edge;
  `readAge`/`writeAge` round-trip and corrupt-value tolerance.
- `mapCards.ts`: ordering, suggestion precedence (`ask` > learn >
  first incomplete), pip derivation from found/mdone snapshots,
  `complete` flags. Include the mockup `age-map-test.js` matrix: e.g.
  band `5–6` starts `bridges` on rung 2 of 5; band `3–4` skips
  `daily/Tidy the room (5–6)`; band `7–9` no longer shows `little`.
- `progression.ts`: `ageBand` normalize/merge/backwards-compat; XP
  reset keeps `ageBand` + `unlockedIds`; §9.4 import idempotent
  (marker prevents re-import) and grants `1` star, zero retro XP.
- `ladders.ts`: every rung has a §10.2 `missionId`; every existing-id
  mapping resolves to a real ToyForge mission; icon/colour lookups
  cover every card id.

### 13.2 E2E / behaviour checks

1. **Carousel** (mockup `carousel-test.js`): opens centred on the
   suggested card; swipe/wheel/arrows/Tab navigate; scale fades;
   reduced-motion stills the guide; every card name announces
   `done of total`.
2. **Age flow** (`age-map-test.js`): unset → `ask` card → PIN gate →
   pick band → Learn cards appear/reorder instantly; changing band
   never deletes stars; banded `RungSheet` glows the age rung.
3. **Run loop** (`finish-test.js`, `frame-test.js`, `shell-test.js`):
   Learn tap (single-choice) starts immediately; multi-choice opens
   `RungSheet`; finishing a banded rung returns to the map; finishing
   a sequence run plays to the end then returns; world/lab taps switch
   in place with **zero** reloads and ≤ 1 WebGL context throughout.
4. **World-first six** (`animals`/`pack`/`peek`/`gogo`/`tidy` +
   bubbles): solver finishes; wrong-first player gets `reactThenHint`
   then finishes; random taps never error or stick; muted run finishes
   on toast text alone; keyboard/screen-reader run finishes via
   `proxyPanel`; every touch reacts (< `100 ms`).
5. **Toy guide** (new, Decision 3): rebuilding the toy (new parts /
   paint) updates the carousel guide without reopening; name announced.
6. **Parent systems**: Sleep Curtain locks a Learn run with grace
   (§12.1); play-time ledger logs Learn finishes; age set is
   impossible without PIN; Demo Mode alone unlocks everything.

### 13.3 Release gates (every phase)

`npm run validate`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run preflight` all green. Type/static errors in touched files:
zero — no "pre-existing" claims without re-running the checker on the
untouched tree. Real-phone check (touch drag, audio unlock, carousel
fling) required before C3 ships: the mockup never had one, so headless
green is necessary but not sufficient for kid-mode driving (§11.2).

### 13.4 Playtest targets (human, before C4)

Reuse [play-design-spec.md](play-design-spec.md) §Quality bar:
time-to-first-success `< 15 s` (bands 0–1), finish rate `≥ 9/10`,
help `< 1` per round, fun `≥ 2.5/3`, "just right" `≥ 70%`, never
stuck. Carousel adds one target: a first-time child reaches a playable
level from the stage in `≤ 2` taps without reading.

## 14. Sign-off

- [x] §4 verdict accepted (port carousel/taxonomy/content; keep ToyForge shell; skip engine/routing/storage)
- [x] Decisions 1–7 (§6) accepted
- [x] §10.2 scoring map accepted (reuse lab ids + new `little.*`/`early.*`/`daily.*`; no retro XP)
- [x] §9.3 single-store + §9.4 silent import accepted
- [x] Phase order C1→C5 accepted (carousel shell first)
- [x] Signed: Dan (approved in session, "yes, go")  Date: 2026-11-02

C1 started 2026-11-02 on this sign-off. Q2 stays open for C1 (cards ship
theme scenes without captured art); Q4 follows the §9.3 recommendation
(higher-`totalXp` record wins, reset keeps age, one shared age).

## 15. Open questions

- [x] **Q1 (blocks C1 polish) — RESOLVED 2026-11-02:** Carousel entry is dock `⋯` → `Map` **plus** an always-visible end-of-level "Back to Map" action. No dedicated dock `Map` icon (the `390 px` dock keeps one primary visible). Promote to a dedicated icon only if playtesters miss the `⋯` entry. §7/§8 entry points read accordingly.
- [ ] **Q2 (blocks C1 art):** Card scenes — live offscreen renders (always current, GPU cost) or regenerated stills (cheap, can go stale — the exact `capture-map.cjs` trap)? Recommendation: live renders cached per theme.
- [ ] **Q3 (blocks C5):** Do new `little.*`/`early.*`/`daily.*` ids ever get Tier 2/3, part-match bonuses, or Daily Quest slots? Recommendation: no until band 0–2 playtests say the Tier 1 loop is fun.
- [ ] **Q4 (blocks C1 storage):** `ageBand` conflict on multi-device merge + whether Reset XP keeps age. (§9.3 proposes: higher-XP wins; reset keeps age.) Also: one shared age per device (matching one shared XP pool) vs per-toy age? Recommendation: shared, revisited only with per-kid profiles.
- [ ] **Q5 (post-C1):** Deep links / shareable level links (`?world=garden`, ladder rung links) for teachers and playtests, or app-internal only? The mockup needed hashes because artifacts drop query strings; ToyForge has no such limit.
- [ ] **Q6 (blocks C3 ship):** Who runs the first real-phone + real-child sessions (§13.3–13.4), and at which bands? Mockup testing was headless-Chromium only.
- [ ] **Q7 (blocks C2 copy):** Mission-card voice for bands 0–1 — character speaking in-world with card fallback (play-design open question), or card + `Hear it` only at launch?
- [ ] **Q8 (post-C5):** Do converted rungs become `toyventor.level/2` recipes immediately (play-design plan steps 2–3), or ship as hand-coded missions first and become recipes in the generator phase?

## 16. Animation (Mixamo baked curves + procedural)

General game-feel upgrade, independent of the C1–C5 order. No new
renderer, no skeleton on the playable rig.

### 16.1 Today (reconciled 2026-11-02, code-verified)

An earlier draft of this section said the game had no clips and no
`AnimationMixer`. That is stale: commits `bf7cdb3`/`84f8961` landed
`runtime/mixamo.ts`. As shipped:

- `bakeClip` runs an `AnimationMixer` **once at load** over the
  Mixamo GLBs (`public/kip/mixamo/Xbot.glb`, `Michelle.glb`) and
  keeps only joint curves: hips offset, body/head quaternions, and
  arm/leg direction vectors as typed arrays. The ~65-bone skeleton
  is discarded; nothing skeletal drives the playable rig.
- `MixamoDriver` samples/blends those baked curves per frame onto
  our hard-part joints (`rig.arms`, feet hip pivots via
  `userData.hip`, `rig.head`, `rig.g`). Bank today (verified live):
  `idle`, `walk`, `run`, `nod` (agree), `no` (headShake), `sneak`,
  `sad`, `dance` (SambaDance, capped 4.4 s). `joy()` celebrates with
  the dance clip; wrong/right code cards play `no`/`nod`; hidden
  spots trigger `sneak`; failed abilities play `sad`.
- The driver engages only for `rig.type === "character"` with
  joints present. Vehicle and `rig.type === "robot"` builds keep
  the procedural equivalents (sine swing, `P.hop` arcs, squash from
  hop velocity, wheel spin, dust, step sounds), which are also the
  fallback while the bank loads or if it fails.
- Known gap: `mixGo` one-shot actions honour
  `prefers-reduced-motion`, but the per-frame locomotion drive in
  `world.ts` `frame()` is not yet gated the same way.

### 16.2 Approach: borrow the motion, not the skeleton

Direct retargeting would break every part combo and Printable-part
fidelity, so clips are baked to curves as above — the same outcome
this section originally asked for ("re-express as joint curves"),
sampled from the clips instead of hand-authored. New motions enter
either way: add a clip to `MIXAMO_SOURCES` (needs a human to
download it from mixamo.com; an agent session cannot fetch account
assets) or author a parametric curve for rigs the driver cannot
reach. Print geometry never moves either way.

Rules for every new motion: responds < 100 ms to its trigger; calm at
rest (vision: resting screens stay calm); gold/celebration motion
only on reward; no full-screen flash or >3 Hz strobe; vehicle and
hover builds get an equivalent (bounce/tilt/sparkle), never a dead
input; landing/step sounds stay synced to the visual contact frame.

### 16.3 Clip wishlist → parametric moves (priority order)

**A1 — Core four (requested first):**

| Move | Mixamo reference | Parametric form on our rig | Trigger |
| --- | --- | --- | --- |
| Walking | `walk` + `run` (Xbot, baked) | **Done.** Baked cycle with walk→run cross-fade (`walkRefSpeed` 2.4, run 2.9–3.5, `hipsGain` 2.2). Remaining: verify "no foot slide at cruise" on phone (§16.5) | Any locomotion (`speed > 0`) |
| Jumping | `Jump` (takeoff / air / land) | **Open.** No jump clip in the bank and no player jump move; only `P.hop` sine arcs + squash + blob squeeze exist. Parametric first (dip → stretch → tuck → overshoot land, dust on touch-down); swap in a clip if one is downloaded | Hop/move actions, level wins, carousel guide bob |
| Pushing | `Pushing` / `Shoving Object` | **Open.** No push clip; torque is a 0.7-unit lunge tween + shake. Parametric first: lean-in, both arms forward, short steps, effort wobble; vehicle nose-dip + wheel chug | `carry`/`load` pushes, bridge test, junk reveals |
| Jump-on / pop | `Jumping On` + land squash | **Superseded.** Collect/`joy()` plays the baked `dance` clip on driven rigs (hop+spin+squash fallback elsewhere). A distinct double-pop is not planned | Collecting a part, `joy()`, chest arrival (§11 `finishLevel`) |

**A2 — Level actions (pairs with C3 world-first):** idle breathing +
look-around (head/eye saccades, blink already exists), run/dash lean,
pick-up & place (reach → grip → lift → set down for `carry`), pull
(mirror of push), turn-the-crank (circular hand path for `turn`),
point (arm toward the hinted object, backs `cueObj`), tiptoe/sneak
(crouched steps for Peekaboo / `nudgeAll` levels).

**A3 — Feelings & rewards (gentle only):** wave hello (home/carousel
greeting), celebrate (happy jump + clap, replaces bare `joy()` spin),
"oops" shrug + head tilt (wrong-tap partner to `reactThenHint`; never
labelled "wrong"), sleepy yawn → droop (Sleep Curtain wind-down),
proud chest-puff (rank-up / new vehicle unlock).

**A4 — Part-aware tuning (no new clips):** wing flap rate follows
vertical speed; spring-legs overshoot; hover bob phase-locks to
steps; cape/antenna/tail lag from acceleration (mostly present —
retune against the A1 step cycle); vehicle suspension bounce on
land/go/stop.

### 16.4 Explicitly not now

Sitting/crouch/climb full-body clips, finger/hand detail, facial
blendshapes beyond eyes/brows, and any **live** skeleton on the
playable rig (a load-time `AnimationMixer` for baking is shipped
and stays). The earlier "no dance loops" line is retired: the
short capped `dance` celebrate is shipped and stays. Only motions
listed above graduate into the game, each with a reduced-motion
still (locomotion gating above included) and a muted/sound-off
read (motion must read without audio).

### 16.5 Acceptance (joins §13 gates)

Walk/jump/push/pop visible at 390 × 844 on Character, Vehicle, and a
`robot.*`-aliased build; no foot slide at cruise speed; land squash
reads in a single screenshot; zero new console errors; frame loop
unchanged (one WebGL context, no extra render pass — curves only);
touch response still < 100 ms with A1 enabled; real-phone touch
check rides with the C3 gate (§13.3).

## 17. Freeze polish (decided 2026-11-02, after C3)

Two presentation items, neither blocking C3–C5:

1. **Title menu + turntable.** Boot currently skips the title state
   (`P.title = true` then immediate `startPlay(false)` in
   `world.ts`). Restore a real main menu on the existing factory
   turntable (spinning meshing cogs already animate in showcase
   mode): equipped toy on the turntable, Play / Build / Create
   entries, then the same world boot as today. The trimmed title
   markup is recoverable from git history (`stageDom.ts` before
   `296de10`); reimplement as React chrome over the live stage, not
   as stage DOM.
2. **Parallax image backdrops.** Replace far backdrop geometry
   (hill spheres) with generated-image planes on stepped depths,
   keeping all gameplay geometry 3D. Approach, measured layer
   order, sizes, and fallback live in
   [parallax-backdrops-spec.md](parallax-backdrops-spec.md);
   nothing ships until its interactive mockup is approved.
