# Spec: Parent Time Gates & STEM Earned Play Time

## Status

**Active:** implemented in `migrations/0002_parent_time.sql`,
`shared/parent-time.ts`, `worker/parent.ts`, `src/lib/parentTime.ts`,
`GrownUpsSheet.tsx`, and `SleepCurtain.tsx`.

**Proposed:** the time-aware day — parent-set sleep and eating times, and a
schedule-driven phase model. See [The Time-Aware Day](#the-time-aware-day).
It lands with the Town Phase A come-back loop and does not change any
behavior until then.

## Why This Exists

Parents need calm control over play length without turning the toy into a
timer. STEM missions should earn extra play inside the same cap, while the
child sees rest—not balances, PINs, answers, or countdowns.

## What Changed From the Draft Spec (Design Improvements)

- Earned time is additive within the daily cap; it cannot create unlimited play.
- Mission IDs are unique and auditable per day.
- A fresh day always resets the ledger.
- One simple challenge plus a short-lived proof token unlocks Grown-ups.
- Local and server settings stay coherent, with settings winning over ledger
  state.

## Pure Rule Engine (`shared/parent-time.ts`)

Parents set play-time caps; STEM missions add earned minutes inside the cap.
Servers hold only settings, day, ledger totals, and completed mission IDs.

### Invariants & Boundary Rules

- Play time is additive: earned STEM minutes extend the base allowance only up
  to the daily limit.
- Completed mission IDs are unique and auditable per day.
- A fresh day always means a fresh ledger.
- Parents can watch, change, or exit through the same calm UI.

## Storage & API Contracts

### D1 Schema (`migrations/0002_parent_time.sql` + Self-Bootstrap)

The parent table stores settings, day, used/earned/extra time, completed IDs,
and proof metadata. Missing rows bootstrap to safe defaults. Days are local
calendar days; balances never carry forward.

### Worker Endpoints (`worker/parent.ts`)

Settings, challenges, answers, heartbeats, progress, and STEM awards run
through validated routes. Mission IDs must match the accepted pattern and stay
within length limits; duplicates credit once. Gated actions require proof,
then a narrower gate.

### Offline / Local Cache (`src/lib/parentTime.ts`)

Local snapshots preserve safe behavior offline. Remote time wins ties;
heartbeats arrive within about a minute. PIN hashes never leave the approved
path; only a PIN-set flag is exposed.


## Parent Gate & Grown-Ups UX (`GrownUpsSheet.tsx` & `SleepCurtain.tsx`)

`⋯ → Grown-ups` handles setup when idle and manages limits after unlock:

| Preset | Default |
| --- | --- |
| Off | Open play, no limit. |
| Weeknight | 20 base minutes plus up to 10 STEM minutes, 30-minute cap. |
| Weekend | 45 base minutes plus up to 15 STEM minutes, 60-minute cap. |
| Quick 15m | 20 base minutes, 30-minute cap, 15-minute session. |

Parents can change base, earnable cap, per-challenge award, session length,
quiet hours, and PIN. Settings always win over ledger state. A four-digit PIN
and short-lived challenge unlock the gate; cooldowns remain invisible and
adaptive.



Each mission card shows the skill, toy, time earned, and whether it is done.
No grind: each mission pays once per day and overflow cannot inflate the ledger.
Actual keys are `labN.*` identifiers emitted by the engine and validated as
mission IDs; their short titles may vary by lab content.

Sleep shows only `Time for a break!`, `{toyName} is resting for tonight`, or
`{toyName} is resting for today`, plus a sleep explanation, quiet-end caption,
one `Grown-ups` button, final-minute twilight softening, and an active-mission
grace caption when relevant.

## Validation Gates

- Heartbeats, ledger resets, mission uniqueness, cap math, and proof expiry are
  covered by parent-time and world-engine tests.
- Quiet hours can end nightly rest; session limits can end one sitting without
  ending the day.
- Default play remains child-led and exploratory.
- The child UI never shows balances, PINs, prose answers, or remaining-time
  numbers.


## The Time-Aware Day

Proposed. The gate today answers one question: how much play is left. The
time-aware day answers a second one: what time is it in this family. Parents
set sleep time and eating times; the game follows that clock, and the day
reads as play, eat, play, bedtime instead of a countdown into a lockout.

### Phase Model

Four phases, resolved from the real clock in `settings.timezone`:

| Phase | When | Play | Allowance |
| --- | --- | --- | --- |
| `sleep` | Between bedtime and morning | Closed | Not spent |
| `wind_down` | From the bedtime lead-in to bedtime | Closed, the routine runs | Not spent |
| `eating` | Inside a meal window | Paused, the sitting holds | Not spent |
| `play` | Everything else | Open | Counts down |

Precedence is `sleep` over `wind_down` over `eating` over `play`. A meal
window that overlaps bedtime loses to bedtime, and a meal window that covers
the whole day is rejected at validation rather than winning every phase.

### Settings Shape

`ParentSettings` gains two fields. The existing `quietHours` window becomes
the sleep window; its parent-facing name is "Sleep time", and the code name
stays so stored settings keep loading.

```ts
export interface MealWindow {
  enabled: boolean;
  /** Parent label: "Breakfast", "Lunch", "Dinner", or the family's own. */
  label: string;
  /** 24-hour "HH:MM" in `settings.timezone`. */
  start: string;
  /** Window length in whole minutes (5..120). */
  minutes: number;
}

export interface DaySchedule {
  /** Up to three meal windows, ordered by start time. */
  meals: MealWindow[];
  /** How long before bedtime the bedtime routine starts (0..60). */
  windDownMinutes: number;
}
```

`ParentSettings` carries `schedule: DaySchedule`. Validation rules, matching
the existing field rules:

- `meals` holds 0 to 3 entries, each with a valid `HH:MM` start, a length in
  5..120 minutes, a label of 1..24 characters, and no overlap with another
  meal or with the sleep window.
- A meal window may not wrap past midnight; a window that would end after
  00:00 is rejected.
- `windDownMinutes` is 0..60, and the bedtime lead-in may not reach back past
  the previous meal window's end.
- Unknown fields are dropped, and a missing `schedule` on stored settings
  resolves to `{ meals: [], windDownMinutes: 30 }`.

Existing families get no meal windows, so nothing changes for them until a
parent turns eating times on. A one-tap "use our family times" action in the
parent area fills in breakfast, lunch, and dinner at typical values that the
parent then edits.

### Rule Engine

`evaluatePlayTime` gains a `phase` field holding one of `play`, `eating`,
`wind_down`, or `sleep`. The reason enum gains `"eating"` and `"wind_down"`;
the sleep phase keeps the existing `"quiet_hours"` reason, so stored ledgers
and the sleep curtain read the same as they do today. `twilightCue` is
replaced by `duskCue`, which is true inside the bedtime lead-in on the clock
rather than inside the last minute of the allowance.

- Only the `play` phase accrues `usedSeconds` and `sessionUsedSeconds`. The
  existing quiet-hours carve-out in `recordActivePlay` becomes a phase check:
  eating, wind-down, and sleep never spend allowance.
- `remainingSeconds` reports the allowance as it is; it does not tick during
  a paused phase, so a family that eats for forty minutes loses no minutes.
- `locked` means play is unavailable, and the client picks the surface from
  the phase and the reason: the table card for `eating`, the bedtime routine
  for `wind_down`, the sleeping town for `sleep`, and the "Kip is
  recharging" curtain for `daily_limit` and `session_limit`.
- Crossing midnight still resets the ledger. The allowance never carries
  forward, and a phase change never rewrites it.

### Storage And API

`parent_settings.settings_json` is a JSON blob, so the new fields need no
migration. `/api/parent/settings` accepts `schedule` with the same merge
semantics as every other field: settings win over stored state, and a payload
that fails validation returns errors and changes nothing. The local mirror in
`src/lib/parentTime.ts` keeps the same shape so the gate works offline, and
the offline rule engine resolves the phase the same way.

### Surfaces

- **Parent area.** A "Sleep time" disclosure with bedtime, morning, and the
  bedtime lead-in, and an "Eating time" disclosure listing up to three meal
  windows with start and length. Both are editable in place, like today's
  bedtime and morning fields.
- **Eating.** The stage dims to a warm table card, the family meal routine is
  offered, and the child returns to the same spot in the world when the
  window ends. Nothing is lost and nothing is counted.
- **Bedtime.** The bedtime routine runs its parent-set steps with the screen
  dark and a calm voice, then the town falls asleep.
- **Dusk.** The town lights up as bedtime approaches, on the clock, with no
  countdown and no visible timer anywhere.

### Validation Gates

- Phase resolution is covered at every boundary minute, including an exact
  start minute, an exact end minute, an overnight sleep window, and a meal
  window that ends at midnight.
- A meal window overlapping the sleep window loses to sleep; a meal window
  overlapping another meal is rejected at validation.
- Allowance does not accrue during eating, wind-down, or sleep, and a pause
  followed by a resume leaves the sitting position unchanged.
- Settings with meals round-trip through `/api/parent/settings`, invalid meal
  payloads are rejected without changing stored state, and stored settings
  without a `schedule` load with the defaults.
- The child surface never shows a clock, a countdown, or the reason a phase
  changed in a form that reads as a punishment.


