# Spec: Parent Time Gates & STEM Earned Play Time

## Status

**Active:** implemented in `migrations/0002_parent_time.sql`,
`shared/parent-time.ts`, `worker/parent.ts`, `src/lib/parentTime.ts`,
`GrownUpsSheet.tsx`, and `SleepCurtain.tsx`.

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

### Bedtime: the toy goes to bed by itself (2026-11-05)

Dan: "Kip going to bed by himself at quiet hours". The curtain used to drop on a toy that was simply standing there; now the toy goes to bed first, and the curtain shows him tucked in.

- **The rule (`PlayTimeStatus.bedtime`, `BEDTIME_LEAD_SECONDS` = 60).** True in the last minute before play stops for the night (quiet hours begin: `secondsUntilQuietHours`, exact to the second in the
  family's time zone) or for the day (the daily limit is what stops play, i.e. it is not later than a sitting limit), and while play is stopped for either. **A sitting limit is a break, not a
  night: no bedtime** (`Time for a break!` keeps the toy up). Play Time off, and the demo override (`effectiveParentSnapshot` with controls off), never give bedtime. A status from a Worker that
  does not send the field reads as false.
- **The mode (`src/lib/bedtimeMode.ts`).** `going` in the lead-in, `now` when the curtain is up for quiet hours or the day's limit, `off` otherwise (a mission or the Garage allowed to finish
  after the day's limit has no curtain yet, so `off`). `GameCanvas` hands it to `engine.setBedtime`, the world to the sleep hook.
- **The toy (`sleepHook.setBedtime`, `sleepRoutine.lieHere` / `sleepNow`).** `going`: walk to the nearest bed in the world, hop up, lie down, fall asleep (the room dims, the Zzz drift); a world with
  no bed (the Garden, the Beach...): lie down where he is. A child who wakes him with a tap, or walks him away from the bed, during the lead-in is respected: he stays up until the curtain.
  `now`: asleep at once, on the bed or where he is, if he is not yet (a game opened in quiet hours finds him already asleep). `off`: he wakes with the yawn and hops down (no hop when there was
  no bed). A busy toy (a hug, a meal) waits and goes the moment it is free; the title screen, a vehicle toy and Play Time off do nothing. The bedtime sleep is held for real: if the
  animation loses the pose (the rig is swapped for the finished one just after a cold load), the hook lies him down again.
- **The curtain (`curtainLook`, `src/sleep-bed.css`).** For the night and the day's end it is see-through, with the message as a banner along the top, so the sleeping toy and the dusk room
  show through; for a sitting limit it is the heavy navy one as before.
- **Checked.** 12 + 23 + 8 unit tests (the rule at its exact boundaries, the hook's modes mutation-checked, the pure mode and the look) and in the real game: the Toy Room (walks to the bed, asleep,
  wakes, hops down, a child's tap wakes him and he stays up), the Garden (lies down on the grass), a game opened in quiet hours (asleep, banner, awake when they end), and real quiet hours
  that begin 98 s later (in bed by T-52 s, the curtain at T). Not done: the same for a vehicle (it has no bed), a bedtime story or lullaby, and a grown-up setting for it (it follows the
  quiet hours and the daily limit that are already set).

## Validation Gates

- Heartbeats, ledger resets, mission uniqueness, cap math, and proof expiry are
  covered by parent-time and world-engine tests.
- Quiet hours can end nightly rest; session limits can end one sitting without
  ending the day.
- Default play remains child-led and exploratory.
- The child UI never shows balances, PINs, prose answers, or remaining-time
  numbers.

