# Spec: App Continuation Roadmap (Top Bar & Parent Gate, Kip & Craft Roster, Accuracy-Bonus STEM XP, Weekly STEM Packs)

## 1. Overview & Phase Order

This roadmap ports the 2.5D stage natively into Vite/React first, then adds
roster identity, STEM XP, and weekly packs without breaking the sleep curtain
or part lanes.

0. **Phase 0 — Native ToyVentor World Port** ([`native-world-port-spec.md`](native-world-port-spec.md) & [stage-simplification-and-kip-spec.md](stage-simplification-and-kip-spec.md)):
   replace the `<iframe>` + `100 ms` DOM scraper with an in-process Three.js
   stage (`Phase 0A`), then extract typed state + Kip V2 `Character` / `Vehicle`
   modules, cog-mesh math fix, and `#fix` removal (`Phase 0B`).
1. **Phase 1 — Top bar, grown-up unlock behavior, and demo readiness.**
2. **Phase 2 — Enabled-only `Toy Box` roster** (with Phase 2 grandfathering).
3. **Phase 3 — Accuracy-bonus STEM XP, difficulty tiers, and advanced parts**
   (gated on standalone XP spec sign-off).
4. **Phase 4 — Greyed-out roster wired to XP** (gated on Phase 3 + readiness audit).
5. **Phase 5 — Toy-aligned weekly STEM pack drops** (with evergreen fallback).

Each phase must keep roster identity, save compatibility, and ledger
auditability intact. Nothing here overrides the canonical spec, the one-stage
UX rules, or the TU geometry canon.

## Build status (Oct 31, 2026 — code-verified)

- Phase 0 (port + typed runtime + cog mesh + `#fix` removal): landed.
- Phase 1 (Toy Box pill, PIN pad with dual-path lockout, Demo v1): landed.
- Phase 2 (enabled roster, Star Scout grandfathering, Kip unification): landed.
- Phase 3 (XP math, Tier 2/3 presets, badges, Pro-part gating): landed.
- Phase 4A (locked cards for the 3 ready vehicles): landed.
- Phase 4B (Ranks 3–6 flips): open — the rank 3 tractor awaits the
  chin-strap part verdict and the Wave 10 Cards A-B flat-pack modules (Pass 5
  CAD, `preprint_check` slicer validation, Gate G4 static tip-over proof);
  ranks 4–6 await their own Wave 10 proofs. The truck, scooter, and motorbike
  are already live.
- Phase 5 (weekly packs): parked by decision — no owner; weekly drops ship
  post-freeze, locked-card probe procedure adopted for the 4A verify.
- Open verification: live Toy Box probe of locked-card promote-at-threshold.


## 2. Phase 1 — Top Bar & Grown-Up Unlock

### 2.1 Top Bar

The top bar carries identity, primary creation, packs, and grown-up tools in
one row. It must fit a 390 px phone without scrolling, truncate long names,
and keep one primary action visible. Proposed: freeze the left pill as the toy
selector with the active toy name in its `aria-label`, keep `Build`,
`Create`, and `Pack` fixed, and consolidate grown-up entry so it appears once
instead of in both `MyToySheet.tsx` and the `⋯` menu.

### 2.2 Mini-icon pipeline (never blocks the top bar)

Background work—pack status, audio state, sync, and parent settings—must use
quiet indicators. It cannot add buttons, block input, or expand the dock.
Listening gets its own indicator, distinct from music playback. The `Toy Box`
mini icon renders immediately from local sources (static SVG -> scan SAM cutout
-> glyph fallback); any async Muse Image icon upgrade runs strictly off the
render path and caches once per toy.

### 2.3 Grown-Up Unlock UX (keep one real barrier)

One deliberate `1.2 s` hold on `⚙️` opens a **4-tap PIN pad** (reusing `pinSet`
in `shared/parent-time.ts`) plus the existing `5`-minute sitting window. Pure
tap-only unlock is rejected. There is no separate login wall, and the stage
remains usable underneath:

- **First-time setup:** `4 taps` + `Confirm 4 taps` after one bootstrap math check.
- **Retry & lockout:** `5` failed PIN verifies trigger a `30 s` cooldown on
  `/api/parent/gate` in `worker/parent.ts` **and** in the offline
  `localStorage` fallback in `src/lib/parentTime.ts`, so airplane mode
  cannot bypass it. Both paths count `5` failed attempts before the
  `30 s` cooldown and persist the cooldown deadline across reloads.
- **Forgot PIN:** `Forgot PIN?` falls back to one typed multiplication challenge
  and sets a new PIN so parents are never locked out.

### 2.4 Sleep Curtain exception

Sleep preserves the same calm styling and Grown-ups path on `SleepCurtain.tsx`
(opening the §2.3 gate when `⚙️` sits behind the curtain). Build, pack, mood,
editor, and pack-related entry points stay suppressed while rest is active.
A live mission in progress gets a grace caption instead of an abrupt end.


## 3. Phase 2 — Enabled-Only `Toy Box` Roster

### 3.1 Goal

Give every toy one canonical identity with real thumbnails and zero locked cards
or XP promises before Phase 3 ships. Saved, seed, and scanned toys become
addressable; starter multiplicity and aliases never create new toys.

### 3.2 Enabled starters & Phase 2 grandfathering

- **`Kip` (`seed-kip`)** — default starter #1 (`Character` on the Kip V2 rig).
- **`Red Racer` (`seed-car`)** — starter vehicle #1 (retains canonical `"Red Racer"`
  name from `seed/toys/seed-car.json` and `demo-script.md`; backed by
  `sets/racer-garage.json` + Kip V2 roadster chassis).
- **`Star Scout` (`seed-figure`) grandfathering in Phase 2:** already a seed toy,
  never presented as a new unlock; any device with `activeToyId === "seed-figure"`
  or a saved `seed-figure` build keeps it enabled immediately in Phase 2. One active unit per toy; team assembly is
presentation only. Missing or latest parts always offer repair, forge/reprint,
or fallback.

### 3.3 Roster inventory

| Card | Contents |
| --- | --- |
| My Toys | Photo, owner, caption, current builds. |
| Characters | Starter/mascot art, milestone card if earned. |
| Vehicles | Photo or starter art and current loadout. |
| Lab Bots | Bot avatar and lab completion. |
| Lab Kit Printer | Print/save activity avatar. |
| Forge Mount row | Hidden demo/calibration slug. |


## 4. Phase 3 — Accuracy-Bonus STEM XP, Difficulty Tiers & Advanced Parts

### 4.1 Gate: standalone XP spec first (no code before sign-off)

XP is a system, not a feature, and none of it exists in `src/` today. All seven
open design questions, exact formulas, mission tolerances, `S.mdone` migration,
and D1 sync encoding are resolved in **[`xp-system-spec.md`](xp-system-spec.md)**
(the authoritative Phase 3 gate). No Phase 3 code or Phase 4 lock copy ships
until `xp-system-spec.md` is signed off. Scoring changes XP meaning only;
physics, checks, rarity, and audio cadence do not change.


### 4.2 Core Philosophy: Reward Precision Without Punishing Exploration

Attempts never lose XP. Harder challenges scale reward, not loss. Every
completed mission awards full base XP whatever the `failedChecks` count; high
accuracy (`0` or `1` failed checks, plus within-tolerance calibration on
`measure`, `balance`, and `lever`) adds `+25–50%` bonus XP with improvable
`1–3★` mastery stars.


### 4.3 XP Math Summary — Governed by [`xp-system-spec.md`](xp-system-spec.md)

- **Shared device pool** (superseding earlier per-toy XP drafts): one unified
  `totalXp`, `rank`, `missionStars`, and permanent `unlockedIds` per device in
  `localStorage["toyforge:progression:v1"]`, synced through `/api/ownership` as
  `{ type: "character", id: "progression:v1", payload }`.
- **Run multiplier:** `M = 1 + accuracyBonus + partMatchBonus` (`3★ = +0.50`,
  `2★ = +0.25`, `1★ = +0.00`; `+0.10` when active toy provides `>= 1` point of
  the mission's matching `stat`), rounded via `Math.round`.
- **Daily replay & delta rules (keyed by `"{missionId}:t{tier}"` on
  `localDay(nowMs, settings.timezone)`):** first daily solve pays
  `Math.round(Base * M)`; improving `todayBestMultiplier` pays the exact
  uncollected delta `Math.round(Base * M) - Math.round(Base * todayBestMultiplier)`;
  same-day non-improving practice replays pay `0.25x` up to `2` paid practice
  replays per `(missionId, tier)` per day.


### 4.4 Unlockable STEM Level Difficulty Tiers (Track B: Lab Mastery)

Difficulty tiers and Pro parts are gated by **Lab Mastery (`missionStars`)**,
never by Maker Rank (`totalXp`), so vehicle progression and lab mastery cannot
stall each other:

- **Tier 1 Starter (`100` base XP):** unlocked on boot across all missions.
- **Tier 2 Tinker (`150` base XP):** unlocks per mission once
  `stars("{missionId}:t1") >= 2`.
- **Tier 3 Engineer (`220` base XP):** unlocks per mission once
  `stars("{missionId}:t2") >= 2`.
- **Pro parts by `(line === "Pro", stat)`:** unlock on earning `3★` in the
  matching lab family (`torque` -> `Lab 1`/`Lab 2`; `speed` -> `Lab 3`/`Lab 4`;
  `glow` -> `Lab 2`/`Lab 4`; `spin` -> `Lab 5`/`Lab 6`).
- Phase 3 must ship parameterized `Tier 2` and `Tier 3` presets across
  `Lab 1–6` before Phase 4 enables Rank 5–6 vehicle locks (`1,800` / `2,700 XP`).


### 4.5 Maker Ranks & Vehicle Unlocks (Track A: `totalXp` -> Vehicles Only)

Maker Ranks unlock Phase 4 vehicles in catalog order; thresholds are defined in
[`xp-system-spec.md`](xp-system-spec.md). No rank grants unsafe, unverified, or
unprinted geometry, and `Star Scout` (`seed-figure`) is grandfathered rather
than rank-locked.

| Rank | Title | XP Threshold | Vehicles Unlocked (Phase 4) |
| --- | --- | --- | --- |
| 1 | Snap Sprout | 0 | Kip, Red Racer, SAM Scan |
| 2 | Workshop Builder | 250 | Hauler Truck, Motor Scooter |
| 3 | Gearhead | 600 | Sport Motorbike, Loader Tractor & Trailer |
| 4 | Sky & Sea Pilot | 1,100 | Prop Aeroplane, Catamaran Boat |
| 5 | Aero Captain | 1,800 | Rescue Helicopter, Space Shuttle |
| 6 | Mech Inventor | 2,700 | Bolt Power Mech |


### 4.6 Persistence, HUD Footprint & Parent Visibility

Progression syncs inside the existing ownership `character` lane (`id:
"progression:v1"`), including permanent `unlockedIds` so grandfathered and
scanned toys survive `Reset XP` and device restore. Zero HUD clutter on the
stage: a subtle rank pip on `Toy Box`, a progress bar inside `Toy Box`, `1–3★`
badges on lab cards, and a short celebratory toast per completed mission.
Parents get a read-only Maker Progress summary (`totalXp`, rank, stars per lab,
recent unlocks), a confirmed `Reset XP` button, and a non-destructive `Sandbox
Unlock All` toggle beside the Play Time ledger behind the `⚙️` PIN gate.


## 5. Phase 4 — Greyed-Out Roster Wired to XP

### 5.1 Per-vehicle readiness audit (entry gate)

A locked card must name its catalog part, mission, art, rarity source, save
behavior, and unlock condition before wiring. Star Scout is already a seed toy
and cannot be presented as a new unlock. The audit also confirms the part is
verified, the mission exists in a shipped lab, the art is final, and the save
shape matches the flattened pipeline—no card wires to a placeholder.

### 5.2 Name alignment

Roster text uses canonical names even when content aliases appear in art.
Alternate names never create separate roster rows. Kip, Red Racer, and
Star Scout keep their canonical IDs (`seed-kip`, `seed-car`, `seed-figure`)
even where content calls them Kip, Race Car, or Space Racer variants (`Roadster Racer` and `Race Car` are content aliases for `Red Racer` only, never separate roster rows).

### 5.3 Locked-card behaviour & grandfathering

Locked cards explain the requirement and next step in one line each: what to
earn, where to earn it, and what unlocks. Previously earned access must not
regress when the roster or XP system changes: any device with an existing
build or active toy ID keeps that toy enabled immediately, including
`seed-figure` under the Star Scout grandfathering rule.


## 6. Phase 5 (Late Phase) — Toy-Aligned Weekly STEM Pack Drops

Each weekly pack traces its catalog parts, lab missions, arts, rarity source,
account consequences, parent approval path, save schema, rollback behavior, and
telemetry. A weekly pack must name its catalog parts, lab missions, arts,
rarity source, account consequences, approval path, save schema, rollback, and
telemetry before it ships. Delivery format, safety, rollback, and telemetry
remain open.


## 7. Planned File Map Across Phases

Roster, progression, and weekly-pack work reuse the current save, ownership,
contract, world, pack, and parent-time modules. New files must follow the
existing placement/paint/stats/mood/camera save shape and auditable ledger
pattern; no parallel payload path is permitted. Flattened saves stay
authoritative; `last_*` aliases resolve to canonical toys before roster
writes.


## 8. Town Layer Linkage (Vision: [`toyventor-town-vision.md`](toyventor-town-vision.md))

The Town vision's Phases A–E extend this roadmap past Phase 5; nothing there
is committed until it lands here as a numbered phase with entry gates:

- **Phase A (come-back loop)** overlaps Phases 3–5 + parent-time: daily quest
  board with real routines, the parent-set day schedule (sleep time and eating
  times, with the eating-time pause), concept badges, weekly parent summary,
  Workshop Day stamps, personal-best hints, "Kip is recharging." Done when
  testing families return 4+ days a week.
- **Phase B (adventure):** quest givers and chains, mystery quests, Mess
  meter, "Fix Kip's workshop" arc. Done when kids pick a second quest
  without being asked.
- **Phase C (connected town):** three-district slice first (Plaza, Home
  Street, Garden), then all districts, with vehicle gates. The first slice
  uses the ready rank 2 and 3 vehicles; the island and sky gates join when
  the Catamaran and Helicopter land. Done when a child plays 20 minutes
  across three places without help.
- **Phase D (toy as solution):** deliver-it and build-to-spec quests, Music
  Hall. Done when a build-to-spec solve prints the part used.
- **Phase E (families and seasons):** family play for learning to share
  (pass-and-play first, then a device each), the family meal quest, shared
  worlds with missions, and weekly events inside monthly packs. Done when
  two families complete a shared quest through grown-up-approved codes.

Prerequisites before any Town phase: STEM ladders playtests (8+ kids across
age bands) folded in; `toyventor.quest/1` field-final; transcription running
through the Worker with audio deleted after use.
