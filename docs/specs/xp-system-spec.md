# Spec: STEM XP System (Phase 3 Gate)

Standalone sign-off spec required by [app-continuation-spec.md §4.1](app-continuation-spec.md).
No Phase 3 implementation starts until every decision below is signed off.
Code-grounded: 11 mission types exist (`bridge`, `measure`, `balance`,
`logic`, `lift`, `lever`, `circuit`, `code`, `pattern`, `clean`, `raft`);
completion arrives today as binary flags only (`S.mdone`, scraped as
`missionsDone` keys); no attempt counter exists anywhere. The existing
ledger already records `completedMissionIds` and STEM `earnedMinutes` per
day, and ownership sync accepts toys/parts/skins/characters payloads.

> Status: **ACCEPTED — implement.** Decisions 1–7 resolved below, aligned
> with continuation §4.3–§4.6 (shared device pool, daily multiplier rules,
> per-mission tier gates). Maker Rank gates vehicles only. Greyed-out
> roster wiring stays Phase 4; Phase 3 ships awards, stars, ranks,
> persistence, parent visibility, and instrumentation.

## Decision 1 — Accuracy per mission type

Attempt count is the universal base metric: it matches the Test-it loop
kids already use and is instrumentable in one place (Phase 0B mission
state emits attempt/clean-solve events). Exactness applies only where a
mission has a measurable target.

- Build/test family (`bridge`, `lift`, `raft`, `clean`, `logic`, `circuit`,
  `code`, `pattern`): stars from Test-it presses on the solving run —
  3 stars on the 1st press, 2 on the 2nd, 1 on the 3rd+.
- Measure family (`measure`, `balance`, `lever`): same attempt tiers, plus
  the 3-star bar requires the first solve inside the mission tolerance
  (exact measurement/balance/ratio, per-mission constant, not a global
  epsilon).

**Resolved details.**

- One *attempt* = one evaluated try: a press of the mission's primary
  action (`Test it`, `Turn crank`, `Drive through`, `Go`, `Drop`,
  `Flip the switch`, `Run`). Two exceptions: `pattern` counts each
  completed answer evaluation (auto-checked), and `clean` counts each
  final fairness check (`Eat together`); wrong-tool hints in `clean`
  steps 1–2 are guidance, not attempts.
- Attempts accumulate from the last solve of that mission until the
  next solve (persisted counter, reset on solve). Leaving and returning
  does not reset them.
- Tolerances are exact-equality per mission (no epsilon table needed):
  `measure` beam sum = 6 (`|6 − sum|` recorded as error), `balance`
  left torque = right torque (`|L − R|` recorded), `lever` star caught
  in both baskets (error 0/1). First-solve error 0 = clean solve.
- Multi-stage missions (`logic` OR/AND/NOT, `lever` two baskets,
  `pattern` three rounds, `clean` three steps) keep stage progress;
  stages do not add attempts beyond evaluated tries above.

Recommendation: adopt the above. Attempts primary, tolerance-gated 3 stars
for the measure family only.

## Decision 2 — Anti-farming with numbers

- First solve of a `(missionId, tier)` per local day pays full XP.
- Improving a star later pays the full uncollected bonus delta at once.
- Repeating an already-3-star `(missionId, tier)` the same day pays 0.25x
  practice XP.
- New labs and higher tiers always pay full, so optimal play is breadth,
  not grinding the easiest level.

**Resolved details.**

- Keys: `missionId` = legacy `world.type` (e.g. `lab1.measure`);
  progression key = `${missionId}:t${tier}`. All shipped missions are
  Tier 1 today; Tier 2/3 variants reuse the id at higher tiers.
- Legacy `mdone` flags map to Tier 1 with attempts unknown: they count
  as solved for play-time, and stars/XP are earned on the next scored
  solve (no retroactive accuracy bonus).
- Daily rules use the day's best multiplier `M = 1 + accuracy +
  partMatch` per key (`localDay(now, settings.timezone)`): first solve
  of the day pays `Math.round(Base × M)`; improving the day's best pays
  `Math.round(Base × M_new) − Math.round(Base × M_best)`; non-improving
  repeats pay `Math.round(Base × M × 0.25)`, at most 2 paid practice
  replays per key per day. Worked example (Tier 1, no part-match):
  1-star solve pays 100; a later same-day 3-star solve pays
  `150 − 100 = 50`; a further same-day 3-star repeat pays
  `round(150 × 0.25) = 38` practice XP.
- Solved missions reopen for improvement/practice (near detection no
  longer requires unsolved). Scrap rewards still pay once via the chest.
- Local day = `localDay(now, settings.timezone)` from the parent-time
  ledger, so XP and play-time reset together at local midnight.

Recommendation: adopt as written. One formula, no caps UI to explain.

## Decision 3 — Persistence

Local-first in `localStorage["toyforge:progression:v1"]`
(`totalXp`, `rank`, `missionStars`, `sandboxUnlockAll`), synced through
ownership in the existing `character` lane as
`{ type: "character", id: "progression:v1", payload }` when a device
identity exists — same pattern the Toy Box uses today, no parallel
payload path. New device without an identity starts
fresh; cleared storage is identical to a new device. The parent sheet
states this honestly ("XP lives on this device").

**Resolved details.**

- Stored shape: `totalXp`, `missionStars`, `daily` (per-day best
  multiplier and practice counts), `unlockedIds`, `sandboxUnlockAll`.
  `rank` is derived, never stored.
- Merge on pull: max `totalXp`, max stars and daily bests per key, union
  `unlockedIds`, OR `sandboxUnlockAll`. Local storage stays
  authoritative offline; sync is best-effort.

Recommendation: adopt. No account system is being built for the freeze.

## Decision 4 — Multiple kids, one device

One shared pool per device. Per-kid profiles would change the data model
of every ledger write for a case the freeze cannot test. Revisit
post-freeze only if parents ask.

Recommendation: shared pool. (Decision ordering note removed; this
decision stands on its own.)

## Decision 5 — One currency or two tracks

A single XP number gating difficulty, vehicles, and parts stalls all three
on one grind. Split along data already planned:

- **Maker Rank (total XP)** gates vehicles only (Phase 4 cards).
- **Lab mastery (stars per mission family)** gates difficulty tiers and
  advanced parts: Tier 2 needs 2 stars on the Tier 1 of that family,
  Tier 3 needs 4+ family stars; Pro parts need the matching family's
  3-star solves, not a global total.

**Resolved details.**

- Per continuation §4.4: Tier 2 unlocks per mission at
  `stars("{missionId}:t1") >= 2`; Tier 3 at
  `stars("{missionId}:t2") >= 2`. *Family* = lab (`lab1`…`lab6`);
  family stars (sum per lab) drive the parent view and Pro-stat
  unlocks (`torque` → Lab 1/2, `speed` → Lab 3/4, `glow` → Lab 2/4,
  `spin` → Lab 5/6, each on any 3★ in a matching lab). Maker Rank
  never gates tiers or parts.
- Part-match bonus (+10%): each mission type has one stat
  (`bridge`/`lift`/`lever`/`balance` → torque, `raft` → speed,
  `circuit`/`measure`/`clean` → glow, `code`/`pattern`/`logic` →
  spin). Bonus applies when the active toy's build total for that
  stat is > 0.

Recommendation: two tracks. No new currency, no extra UI: stars already
render per mission.

## Decision 6 — Grandfathering mechanics

On the release that turns gating on, record every currently selectable toy
(seed toys used, scanned toys, anything with a saved build) into a
permanent `unlockedIds` set stored beside progression. Scanned toys are
always added at scan time. XP reset wipes totals and stars only — never
`unlockedIds`, never scanned toys. `seed-figure` stays playable for
existing owners and is never listed as a Rank unlock.

**Resolved details.**

- `unlockedIds` lives inside the progression record, so it syncs with
  XP and survives Reset XP.
- "Currently selectable" = every toy in the roster (seed, scanned, or
  saved). Roster changes re-run grandfathering; scanned toys are added
  when they enter the roster.

Recommendation: adopt. Matches the rule already in the continuation spec.

## Decision 7 — Parent visibility

Behind the PIN gate, the grown-up sheet gains a read-only block: total XP
and Maker Rank, stars per lab family, recently unlocked vehicles/parts,
and a confirmed Reset XP control (resets totals/stars, keeps Decision 6).
It sits beside the Play Time ledger; no XP numbers ever render on the kid
stage beyond the rank pip, progress bar, and completion toast.

**Resolved details.**

- The block shows total XP, Maker Rank, ★ per lab, the device-honesty
  line, a sandbox unlock toggle (earned XP unchanged), and a two-tap
  confirmed Reset XP. Vehicle/part lock *cards* remain Phase 4.

Recommendation: adopt. Parents of gated rewards need one place to see
and reset.

## Confirmed numbers (bind Phase 4 lock copy)

- Base XP by tier: Tier 1 = 100, Tier 2 = 150, Tier 3 = 220.
- Accuracy bonus: 3 stars +50%, 2 stars +25%, 1 star +0% on full base.
- Part-match bonus: +10% when the active toy wears the mission's stat.
- Award = round(Base x (1 + Accuracy + PartMatch) x ReplayFactor).
  `round` is `Math.round` (halves round up: `150 × 0.25 = 37.5 → 38`).
- Ranks: 1 Snap Sprout 0; 2 Workshop Builder 250; 3 Gearhead 600;
  4 Sky & Sea Pilot 1,100; 5 Aero Captain 1,800; 6 Mech Inventor 2,700.
- Rank 2 unlocks Hauler Truck + Motor Scooter (Star Scout excluded).

## Instrumentation requirement (Phase 0B)

Binary done-flags cannot score accuracy. Phase 0B mission state must emit
per-mission attempt counts (Test-it presses on the solving run) and a
clean-solve flag with the measured error for the measure family. The
facade scrapes these alongside `missionsDone`; React never touches the
engine per frame.

**Resolved implementation.** Legacy state gains `S.ma` (attempts since
last solve), `S.me` (measured error), and `S.lastWin`
(`{key, attempts, error, at}`). The facade emits
`{type: "missionSolved", detail}` when `lastWin.at` changes, ignoring
wins recorded before mount so reloads never re-award XP.

## Sign-off

- [x] Decisions 1-7 resolutions accepted
- [x] Numbers above bind Phase 4 lock copy
- [x] Instrumentation requirement accepted into Phase 0B
- [ ] Signed: ________  Date: ________

Phase 3 code starts only after all four boxes are checked.
