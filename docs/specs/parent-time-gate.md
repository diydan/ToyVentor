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

## Validation Gates

- Heartbeats, ledger resets, mission uniqueness, cap math, and proof expiry are
  covered by parent-time and world-engine tests.
- Quiet hours can end nightly rest; session limits can end one sitting without
  ending the day.
- Default play remains child-led and exploratory.
- The child UI never shows balances, PINs, prose answers, or remaining-time
  numbers.

