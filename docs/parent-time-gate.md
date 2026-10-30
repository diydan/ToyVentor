# Parent time gates — timers and earned time

Status: stretch goal. Not in the demo path. Neither the settings model nor
the gate has been approved to ship.

Decided (Dan, Oct 30): **earned time does not roll over.** The day resets at
local midnight in the family's stored timezone, and yesterday's surplus is
gone. A child cannot bank time for tomorrow, and the daily limit stays the
meaningful number.

## Why this exists

The promise is that screen time builds something. The parent's question is
"how much, and what does it buy?" — right now the answer is "all of it, all
the time". A parent who cannot set a limit is not going to hand over the
device on a weeknight, and the product loses the household it is built for.

Two parents' controls cover it:

- a **session timer** the parent sets for right now, and
- **cumulative STEM challenges** that earn more time, inside a **daily limit**
  the parent sets and that earned time can never push past.

The STEM playground already exists: nine panels (measure, balance, logic door,
raft, lever, circuit, code cards, pattern lock, clean-up) plus the bridge and
lift missions. Every completion lands in one place — `S.mdone` keyed by world
and mission type, written by `mtWin()` at `game/engine25.js:1042` and by the
bridge and lift handlers at `:927` and `:932`. So "cumulative STEM challenges"
is a counter over missions that already exist, not a new STEM library — which
keeps it clear of the "STEM library + classroom" non-goal in
[plan.md](plan.md).

## What a parent sets

| Control | What it does |
| --- | --- |
| Daily budget | Minutes of play allowed per day |
| Daily limit | The hard ceiling. Earned time never pushes the day past it |
| Session timer | Minutes for the session happening now |
| Minutes per challenge | What one completed STEM mission is worth |
| Cumulative target | Optional: "finish N challenges this week for a bonus" |
| Gate strictness | How hard the grown-ups gate is: full every time, ramp within a sitting, once a day, or remember this device |
| Quiet hours | No play after bedtime, and no play before school |

The three numbers do different jobs and must not blur: the **daily limit is
the ceiling**, the **session timer is the session**, and **earned minutes are
the only way past the base budget** — capped by the limit.

## The rule engine

One pure function, next to the other pure rules in `shared/`:

```
remainingMinutes(now, settings, ledger) -> {
  minutesLeft, earnedToday, capReached, sessionEndsAt
}
```

- `cap = min(dailyBudget + earnedToday, dailyLimit)` — the limit is never
  exceeded, however much is earned.
- `sessionEndsAt = now + min(minutesLeft, sessionTimerRemaining)`.
- Minutes are whole numbers, and the ledger is server-side, because client
  time is not trustworthy.

Boundary conditions, which is where this kind of feature usually breaks:

- a challenge finished exactly at the cap grants nothing and never goes
  negative;
- the day rolls over at local midnight in the family's stored timezone: the
  earned counter resets to zero, the daily limit stays put, and nothing
  carries over;
- a clock moved backwards grants nothing;
- a challenge counted twice grants once.

## Where it lives

- **D1**: two tables beside `ownership` — `parent_settings` (player_id, json,
  updated_at) and `time_ledger` (player_id, day, earned_minutes,
  challenges_done). `ownership` stays for toys, parts, skins and characters;
  parent settings are a different kind of record and stay out of it. The
  ledger is keyed by day, so rollover is not representable: yesterday's row is
  history, not banked minutes.
- **Worker**: `/api/parent/settings` (read and write, parent-gated) and
  `/api/parent/time` (read the remaining minutes, report a completion). Same
  shape as the existing `/api/ownership` route at `worker/index.ts:206`, with
  the D1 calls in `worker/ownership.ts` as the pattern.
- **Game**: `mtWin()` is the single completion hook — one call to the Worker
  there, and the same for the bridge and lift handlers. The game reads the
  budget at load, following the pattern the Muse call already uses at
  `game/engine25.js:984` (same-origin `/api/...`, overridable by a global).
  The game never writes settings.
- **App shell**: the session clock belongs to the app (Toybox, builder), not
  inside the game canvas.
- **Parent area**: the Toybox's "Grown-ups" corner — settings, the minutes
  ledger, and the gate. The same corner shows today's minutes used, minutes
  earned and the cap.

## The parent gate — in the Toybox, always asked, and configurable

Nothing in the app gates adult settings today, and the settings must not be
one tap away from a four-year-old.

**It lives in the Toybox.** That is the app's landing view (`src/App.tsx`,
route `toy`; state in `src/state/toybox.tsx`), where a parent already goes to
see their toys and uploads. A "Grown-ups" corner there is where the settings,
the minutes ledger and the gate itself sit — not a hidden route, not a
separate app.

**It is asked every time.** The default is that entering the parent area always
costs something: long-press plus a two-digit multiplication a parent can do.
No setup, no forgotten PIN, and it fits the STEM tone. A PIN is the alternative
if a family prefers one.

**And it gets progressively cheaper, without ever disappearing.** Within one
sitting the friction decays, so a parent setting things up is not asked to
solve arithmetic five times:

| Entry | What it asks |
| --- | --- |
| First entry in a sitting | Long-press + arithmetic |
| Second entry, inside the window | A confirm tap — "still you?" |
| Later entries, inside the window | Straight in |
| After the window, or after the app was backgrounded | The full gate again |

The ramp never removes the gate; it only makes the next one cheaper. The
window defaults to 30 minutes and is bounded by the app being backgrounded, so
a device left on the table does not stay unlocked.

**And the parent chooses the strictness:**

| Setting | Behaviour |
| --- | --- |
| Full gate every time | Arithmetic on every entry, no ramp. The strictest option |
| Ramp within a sitting | Default: arithmetic first, then confirm taps inside the window |
| Once a day | One full gate per day, then straight in |
| Remember this device | No gate on this device after the first pass |

Default: the ramp, because the strictest setting makes a parent who wants to
fine-tune a limit tomorrow do it once a day instead of every time. The strict
option stays one tap away for anyone who wants it.

**Safety rule:** the ramp exists for the parent and never for the child. It
applies to the parent's entry path only, it never changes the kid's play time,
and the parent area shows no kid content to play with once it is open.

## The under-8 tension, stated plainly

[snap.md](snap.md) says the game has "no timers", and the under-8 rule is
open-ended, low-pressure, no fail states, nothing to lose. A countdown inside
the play space would break that promise and turn a cooperative toy into a
race — and it is exactly what nobody wants to hand a four-year-old at 7pm.

Resolution: the session ends by **fading out**, not by a visible countdown.
The world dims, a "see you tomorrow" card appears, there is no ticking number
in the HUD and no fail state. The kid never sees a clock counting down. The
parent sees the number.

## Risks

- **The daily limit is the trust anchor.** If earned time can exceed it,
  parents stop trusting the feature and the app starts to feel like a slot
  machine. This is the one rule that does not bend.
- **A child must not be able to extend their own limit.** Settings writes are
  parent-gated and the Worker ignores writes that come from the game client.
- **Grind pressure.** A kid who learns "challenges buy minutes" is fine. A kid
  who learns "grind to win time" is not. The per-challenge award is capped
  per day however many are completed.
- **Scope.** One feature across the game, the app shell and D1. On a ten-day
  clock this is a Day 8 change at best, and it also has to be mirrored into
  the React game port under `src/features/game/world/`.
- **The ramp is for the parent, not the child.** A device left on the table
  inside a relaxed window is the obvious failure: a four-year-old walks up and
  the gate is a confirm tap. Mitigations: the window is short by default, the
  full gate returns as soon as the app is backgrounded, and the parent area
  holds no kid content to play with.
- **Tone.** The house rule is that chance-based packs are never sold to
  children. Time gates are a parent's control, never a mechanic the child
  games.

## Done when

- A parent sets a daily budget and a session timer, and the session ends by
  fade-out when either one runs out.
- A completed STEM mission awards minutes, the award is visible in the parent
  view, and the daily limit still holds after it.
- The limit holds across multiple sessions, across a day boundary, and when
  challenges are completed in bursts.
- The game never shows a countdown or a fail state.
- The parent view shows minutes used, minutes earned and the cap.
- The grown-ups gate is in the Toybox: always asked, cheaper on later entries
  in the same sitting, never skipped, and the strictness is the parent's to
  choose.

## Open questions

- Is the weekly cumulative target worth building, or is a daily count enough?
- Should a challenge award minutes the first time only, or every time?
