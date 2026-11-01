# Brain Dump — Next App Phase

Raw working notes, revised after review. Decisions marked **Resolved** are settled; items under **Open** block spec-ing that section. Hand back to turn into the scoped spec + implementation plan.

> **Ordering (resolved, supersedes earlier draft):** §1 + §2 first (small, on existing code) → §3 enabled-only → §4 as its own spec → greyed roster (§3b) wired to XP → §5 last. The greyed roster no longer ships before XP. Specced in [`app-continuation-spec.md`](../specs/app-continuation-spec.md) (Phases 1–5), which follows this ordering.

---

## 1. Top Bar & Navigation

- **Left dropdown = `Toy Box` (`[mini toy image] Toy Box ▾`):**
  - Label stays **"Toy Box"** (instead of swapping to the toy's text name with a plain color dot).
  - Shows a **mini icon** of the active toy (pipeline below — the icon must never block the top bar).
- **Top-right = Settings (`⚙️`) icon:**
  - **Grown-Ups / Play Time** lives inside the top-right **Settings (`⚙️`)** button.
  - Remove the `Grown-ups · Play Time` button from `Toy Box` completely (`Toy Box` stays 100% kid toys + scan). Today that button is in [`MyToySheet.tsx`](../../src/features/game/world/MyToySheet.tsx) ("Grown-ups · Play Time"); remove it there.
  - Remove the duplicate `Grown-ups` entry in the `⋯` menu ([`GameCanvas.tsx`](../../src/features/game/world/GameCanvas.tsx)) once `⚙️` ships, so there is one parent path in the top bar.
- **Exception — Sleep Curtain (resolved):** [`SleepCurtain.tsx`](../../src/features/game/world/SleepCurtain.tsx) also has a `Grown-ups` button, and it **stays**. During quiet hours / time-ended the curtain covers the stage, so that button may be the only reachable parent path (`⚙️` is behind it). It opens the same gated sheet (§2) — it is not a bypass.

### 1.1 Mini-icon pipeline (resolved)

The label is frozen as "Toy Box", so the icon alone carries active-toy identity. Treat the icon as a fallback chain, cheapest first:

| Toy source | Icon | Cost / timing |
| --- | --- | --- |
| Built-in (Kip, vehicles) | Static built-in SVG icon | Free, instant, offline-safe |
| Scanned / custom | SAM cutout thumbnail from the scan photo (the `imageDataUrl` already stored on the toy) | Already paid at scan time; reuse it |
| Scanned, no usable cutout | Silhouette / glyph placeholder | Free, instant |
| Scanned, async upgrade | Meta Muse Image–generated mini icon | Generated **after** the bar renders; cached per toy id; failure or offline keeps the thumbnail/silhouette |

Rules:

- The top bar renders immediately with the best already-local icon. A Muse Image call is never on the render path (no latency, cost, or offline/failure block).
- Cache the generated icon against the toy id so it is generated at most once per toy.
- **Accessibility (required, since the text label never changes):** the `Toy Box` button gets `aria-label="Toy Box — {active toy name} active"` plus a `title`/tooltip showing the active toy name for parents. The mini icon itself is decorative (`aria-hidden`).

## 2. Grown-Up Unlock UX

**Resolved: keep one real barrier. Drop only the typed multiplication — not the gate.**

Current state: [`GrownUpsSheet.tsx`](../../src/features/game/world/GrownUpsSheet.tsx) is hold (1.2s) → challenge (4-digit PIN if `pinSet`, else typed `17 × 8`-style multiplication), with a 5-minute sitting window (`sitting_window` strictness; see `src/lib/parentTime.ts` and `worker/parent.ts`). A pure tap-only unlock is **not** a gate — any kid can tap `⚙️` — so it is rejected.

New flow:

1. Tap `⚙️` → **hold-to-open** (keep the existing 1.2s hold as the entry step / fallback).
2. → **4-tap PIN pad**: big tap targets, no keyboard, no mental math. Reuses the existing PIN (`pinSet`) — no new credential store.
3. Keep the **5-minute sitting window** exactly as-is: inside the window, re-entry is a confirm tap; outside it, the PIN is required again.
4. If no PIN is set yet, the first unlock offers **"Set a PIN"** (4 taps, confirm once). The multiplication challenge survives only as a one-time bootstrap until a PIN exists, then never appears again.

Net change vs. today: remove typed multiplication as the standing challenge; keep hold + PIN + sitting window.

## 3. `Toy Box` Roster & Kip / Craft Assets

Split in two. Only §3a ships early; §3b waits for §4.

### 3a. Enabled & playable (Early Phase)

1. **Kip (Full)** — full heads, hairstyles, hats, backpacks, hand props, and 3D rig integration. Real assets exist today (`parts/kip/`, `public/kip/`).
2. **One Starter Vehicle** (`Roadster Racer`, roster id `seed-car`).
3. **Scan a Real Toy** (Meta SAM 3.1 + Meta Muse Image icon/skin, with the §1.1 fallback chain).

No locked cards, no XP language, no lock icons in this phase.

### 3b. Greyed-out roster (deferred — ships only after the §4 XP spec lands)

- The rest of the vehicles & modular craft as greyed-out preview cards **with the XP unlock path already live**. Until then, ship nothing tappable that promises an unlock that does not exist.
- If a teaser is wanted before XP, the only allowed state is a non-interactive **"Coming soon"** card — no lock, no XP cost, no "unlocks at…" copy.
- Tapping a live greyed card (once XP exists) answers "how do I open this?" inline (XP needed + where XP comes from). Never a dead lock.

### 3c. Asset-readiness audit (required before committing the §3b roster)

Readiness is overstated today: Kip has real parts; the vehicle lineup lives in spec docs ([`flatpack-modular-craft-spec.md`](../specs/flatpack-modular-craft-spec.md)), not yet as playable `Toy Box` entries (current built-ins are only the seed toys). No vehicle enters the roster table until its row is filled:

| Vehicle (UI name) | Spec name | Model? | Rig? | Parts set? | Missions? | Roster state |
| --- | --- | --- | --- | --- | --- | --- |
| Roadster Racer (`seed-car`) | Race Car | ☐ | ☐ | ☐ | ☐ | Enabled (§3a) |
| Hauler Truck | Dump / Tow Truck | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Scooter | — | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Motorbike | Motorbike (& Trike) | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Tractor & Trailer | Farm / Loader Tractor + Modular Trailer | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Aeroplane | Prop / Jet Aeroplane | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Boat | Catamaran / Speedboat | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Helicopter | Rescue Helicopter | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Space Shuttle | Space Shuttle | ☐ | ☐ | ☐ | ☐ | Blocked on audit |
| Bolt Mech | Bolt Power Mech | ☐ | ☐ | ☐ | ☐ | Blocked on audit |

**Name alignment (resolved):** UI names are canonical; spec names are aliases for the same craft. `Roadster Racer` = spec `Race Car`, `Hauler Truck` = spec `Dump / Tow Truck`. Specs should cross-reference the UI name so the two stop drifting.

## 4. XP, STEM Accuracy Bonus, Difficulty & Advanced Part Unlocks (Core Phase)

**This is a system, not a feature — it gets its own spec with actual XP numbers before §3b references it.** No XP exists in `src/` today. The principle is settled; the mechanics are not:

- **Settled:** base XP always on completion; accuracy is **bonus-only** (no punishment for testing/iterating). That fits a STEM toy and stays.

**Open — must be answered in the XP spec:**

1. **What "accuracy" means per mission type.** "Clean 1st/2nd try, exact measurement/balance/ratio" is three different signals. Define the metric per mission family (attempt count? exactness error? part efficiency?) instead of one vague word.
2. **Anti-farming.** Can a kid replay the easiest level forever? Needs a replay rule (diminishing returns, daily caps, or new-content-weighted XP) — decided with numbers, not vibes.
3. **Where XP persists.** Device (`localStorage`, like today's Toy Box) vs. D1 account sync — and what happens on a new device / cleared storage.
4. **Multiple kids on one device.** One shared XP pool, or per-kid profiles? This changes the data model; decide before persistence (3).
5. **One currency, three gates.** XP gating difficulty, vehicles, **and** parts makes a single bottleneck that can stall all three. The spec must either justify the single currency or split it (e.g. vehicles on total XP, parts on mission-family mastery) so one stall cannot freeze everything.
6. **Migration / grandfathering (resolved direction):** when XP gating lands, every toy a user already has unlocked **stays unlocked**. Nobody loses a toy to a new currency.
7. **Parent visibility (required):** a read-only XP summary inside the `⚙️` sheet (current XP/rank, what unlocked recently, reset control). If XP gates playtime-adjacent rewards, parents will ask where to see/reset it — answer lives behind the §2 gate.

Only after this spec exists do §3b lock costs get numbers.

## 5. Weekly STEM Pack Rips (Late Phase)

Correctly last — it depends on §3 and §4. Two commitments need owners before this is spec'd:

- **"New STEM activities every week" is a forever content commitment.** Name an owner, and ship an **evergreen fallback pack** (rotating past spotlights) that auto-serves any missed week so the feature never shows a stale/empty week.
- Align **Pack Rips** with:
  1. Toys the kid actually owns/unlocked (every pulled card fits). This is enforceable today: sets already carry mount/grid compatibility data (`shared/part.ts`, checked in `shared/checks.ts`) — filter pulls through it; no dead cards.
  2. **New STEM activities every week** (weekly spotlight lab + matching part drops + bonus XP for trying that week's STEM challenge with your upgraded toy), falling back to the evergreen pack when no new week ships.

---

## 6. Background Cogs, 2.5D Illustrated Layers & Parallax
- **Problem spotted in playtest:** The background Factory cogs ([`game/engine25.js`](../../game/engine25.js) `gear()` at lines `34`, `348`, `410`) both have 8 boxy teeth at different radii (`0.9` vs `0.55`) and unaligned speeds (`+0.6` vs `-1.0`), so the teeth clip instead of meshing realistically, and primitive 3D background shapes look flat/blocky.
- **Direction — 2.5D Layered Art + Animated Planes behind the 3D Stage:**
  - Keep the **foreground interactive layer in true lit 3D** (hero toy, ground path, interactive hiding-spot props, STEM bridge/lift mechanisms).
  - Replace primitive background scenery/cogs with **multi-depth 2D SVG / Meta Muse Image–illustrated backdrop layers** placed at stepped `Z` depths (`z = -4, -9, -16, -24`) for natural camera **parallax** + crisp tooth-locked animated SVG involute gears (`ω2 = -ω1 × Z1/Z2 + π/Z2` phase), drifting clouds, and warm workshop lighting.

## 7. `Demo Mode` Toggle in Settings (`⚙️`) & Simplified Everyday UI
- Add a **`Demo Mode` toggle** inside the top-right **Settings (`⚙️`)** sheet (default **`Off`** for real kid play; flip **`On`** for hackathon filming / testing / jumping anywhere).
- **When `Demo Mode` is `OFF` (Normal Kid Mode) — strip all duplicates & overwhelm:**
  - **Remove duplicate Home / Title / Build buttons:** Drop `#home` ("Home" — the 3D stage *is* home), `#open` (in-world duplicate "Build"), and the title-screen stack (`Build first`, `Create a world`, `STEM Playground`, `Level editor` — all duplicated by the top bar). Boot straight onto the live playable stage.
  - **Hide the 12-tab world/lab picker strip (`Garden`..`Toy Room` + `Lab 1`..`Lab 6`):** Do not dump 12 worlds + 6 raw lab tabs at once. Start in the current unlocked world (`Garden`) and surface only the next natural portal / STEM challenge as the kid progresses.
  - **Hide dev/showcase shortcuts** (`Kip 3D Rig` standalone viewer link, raw `Level Editor` JSON I/O, pre-seeded bridge state) when `Demo Mode` is `Off`.
  - **Only what is needed on screen in Normal Mode:**
    1. **Top bar:** `[mini icon] Toy Box ▾` · `Build` · `Create` · `Pack` · `⚙️` (plus quiet Story Moods / Character Card access).
    2. **Live 3D Stage:** Toy + current world + tap-to-move/interact + minimal `found / scrap` pill. Zero duplicate buttons.
- **When `Demo Mode` is `ON` (inside `⚙️`):**
  - Exposes the full 12-world / `Lab 1–6` quick-jump bar, `Level Editor`, `Kip 3D Rig` launcher, 1-tap `Seed Demo Save` (for the Garden bridge shot), and sandbox `Unlock All Toys & Tier Parts`.

---

## Add More Ideas Below
- 
