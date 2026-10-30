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

XP is a system, not a feature, and none of it exists in `src/` today. No
implementation starts until the XP spec answers seven items: accuracy defined
per mission type; anti-farming replay rules with numbers; persistence
(device vs. synced, new-device and cleared-storage behavior); one shared pool
vs. per-kid profiles; one currency vs. split currencies for difficulty,
vehicles, and parts; grandfathering mechanics; and a required read-only parent
XP summary with a reset control. Scoring changes XP meaning only; physics,
checks, rarity, and audio cadence do not change.


### 4.2 Core Philosophy: Reward Precision Without Punishing Exploration

Attempts never lose XP. Harder challenges scale reward, not loss. First-try,
calibrated, quiz-verified, and combo successes earn the same voltage for the
same outcome. Every completed mission awards full base XP whatever the attempt
count; high accuracy adds +25–50% bonus XP with improvable 1–3★ mastery stars.


### 4.3 Draft XP Math — PROPOSAL, pending §4.1 sign-off

Award equals base XP by difficulty tier (100/150/220 XP) times one plus
accuracy and part-match bonuses, times a replay factor. Mastery: 3★ for
first-try exact solves (+50%), 2★ for second-try fixes (+25%), 1★ for solved
in 3+ tries (full base). Equipped parts matching the mission stat add +10%.
First daily solve of a mission-tier pays full; improving a star pays the full
uncollected delta at once; repeating an earned 3★ pays quarter practice XP so
progress comes from new labs, not farming. The proposal keeps separate
per-toy XP, sparks, quiz state, and anti-grind limits. Success animation and
sound occur once per completed mission; attempts are visible, but only
completed checkpoints affect XP.



### 4.4 Unlockable STEM Level Difficulty Tiers

Difficulty tiers unlock harder missions and parts without changing the meaning
of completed work. Tier visuals stay distinct from rarity and stats: Tier 1
Starter (default, forgiving, Snap, ages 4–6); Tier 2 Tinker (rank- or
2★-gated, tighter budgets, hints behind a tap, ages 6–8); Tier 3 Engineer
(rank-gated, exact gear ratios, multi-step patterns, part-efficiency goals,
ages 8+).


### 4.5 Draft Maker Ranks & Advanced Part Unlocks — PROPOSAL, pending §4.1 sign-off

Ranks unlock vehicles (as playable cards in Phase 4) and advanced part
families in Build/PrintDrawer in catalog order; thresholds below are the draft
the XP spec must confirm, split, or replace. No rank grants unsafe,
unverified, or unprinted geometry.

| Rank | Title | Draft XP | Vehicles | Parts & difficulty |
| --- | --- | --- | --- | --- |
| 1 | Snap Sprout | 0 | Kip, Red Racer, SAM Scan | Core Snap parts, Tier 1 labs 1–6 |
| 2 | Workshop Builder | 250 | Hauler Truck, Motor Scooter | Heavy Snap add-ons, Tier 2 labs 1–3 |
| 3 | Gearhead | 600 | Sport Motorbike, Loader Tractor & Trailer | Pro mechanical line unlocked |
| 4 | Sky & Sea Pilot | 1,100 | Prop Aeroplane, Catamaran Boat | Flat-pack aero/marine modules, Tier 2 labs 4–6, Tier 3 labs 1–2 |
| 5 | Aero Captain | 1,800 | Rescue Helicopter, Space Shuttle | Momentum stored-energy modules, Tier 3 labs 3–6 |
| 6 | Mech Inventor | 2,700 | Bolt Power Mech | Mech robotics preview brick |


### 4.6 Persistence, HUD Footprint & Parent Visibility

Progression records use payload shapes accepted by ownership: toys, parts,
skins, or characters. Zero HUD clutter on the stage: a subtle rank pip on the
toy pill, a progress bar in My Toys, and a short celebratory toast per
completed mission. Persistence is local-first with D1 sync when an identity
exists (final call in the XP spec). Parents get a read-only XP summary with
current rank, recent unlocks, and a confirmed reset control beside the play
time ledger, behind the PIN gate. An optional grown-up sandbox toggle can
unlock everything for demos without changing earned XP.


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
