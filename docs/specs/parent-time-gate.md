# Spec: Parent Time Gates & STEM Earned Play Time

Status: Active · Single-Stage Architecture (aligned with `docs/ux/world-first-spec.md` & `docs/parts/snap.md`)

Decided (Dan, Oct 30): **Earned time never rolls over.** The day resets at local midnight in the family's stored IANA timezone, and yesterday's surplus is gone. A child cannot bank time for tomorrow, and the daily ceiling stays the trust anchor.

---

## Why This Exists

ToyVentor's promise is that screen time builds something physical and real. A parent's weeknight question is *"How long will this run, and what are they doing in there?"* Right now the answer is *"Unlimited, until you take the phone back."*

Parent Time Gates give grown-ups calm, predictable boundaries without turning a under-8 creative sandbox into an anxious arcade timer:

1. **Off by default (`enabled: false`):** Fresh installs and live demos open directly into ToyVentor World with zero lockouts. A parent turns Play Time on in one tap via presets (`Weeknight`, `Weekend`, `Quick 15m`).
2. **Three numbers that never blur:**
   - **Base Daily Time (`dailyBaseMinutes`):** Guaranteed play minutes today (e.g. `20 min`).
   - **Hard Daily Ceiling (`dailyLimitMinutes`):** Maximum daily minutes including STEM bonuses (e.g. `30 min`, `>= dailyBaseMinutes`). Completed STEM missions (`S.mdone` across the 9 STEM Playground labs + Bridge + Lift) earn `+minutesPerChallenge` (default `+5 min` per unique mission today), **strictly capped at `dailyLimitMinutes`**.
   - **Optional Sitting Timer & Bedtime Quiet Hours:** A right-now session cap (e.g. `15 min` for this sitting) and local-time bedtime window (e.g. `19:30` to `07:00`).
3. **Calm fade-out, never a countdown (`docs/parts/snap.md`):** Kids never see a ticking clock, warning banner, or fail state. During the final minute, a subtle warm twilight vignette tints the stage edges; when time runs out, the world fades smoothly into a warm **"Resting for tonight / Time for a break"** card while muting background audio and mic.

---

## What Changed From the Draft Spec (Design Improvements)

1. **Single-Stage Native Placement (Replaces Retired `Toybox` Route):**
   - `ToyboxScreen` was retired in `docs/ux/world-first-spec.md`. Grown-ups now lives in **`⋯ -> Grown-ups`**, a quiet **`Grown-ups · Play Time`** footer link inside `MyToySheet`, `?tab=parent`, and the corner button on the **`SleepCurtain`** fade-out card. Zero buttons or clocks are added to the kid's 4-control top dock.
2. **7 Overlapping Knobs Simplified to Presets + 3 Clear Controls:**
   - Removed the weekly *"Cumulative target"* (contradicted non-rollover and encouraged multi-day grind).
   - Paired `dailyBaseMinutes` + `dailyLimitMinutes` with 1-tap presets (`Weeknight 20m / 30m cap`, `Weekend 45m / 60m cap`, `Quick 15m`) and tucked `sessionLimitMinutes` + `quietHours` into one clean disclosure.
3. **Complete Ledger Schema (`used_seconds` + Unique `completed_ids`):**
   - Added monotonic `used_seconds`, `session_used_seconds`, `extra_parent_minutes`, and per-day `completed_ids` JSON array to `time_ledger`.
   - **Unique per day:** Each unique mission ID (`<world>.<type>`, e.g. `lab1.measure`, `garden.bridge`) grants bonus minutes **at most once per local day**, preventing 10-second mission grinding while allowing replay tomorrow.
   - **Parent grace stays separate from kid STEM cap:** If a parent unlocks the gate on the Sleep Curtain and taps **`+5 min right now`**, `extra_parent_minutes` grants immediate parent-approved grace without mutating tomorrow's settings or letting kid gameplay breach `dailyLimitMinutes`.
4. **Hardened Gate Security (Dropped `"Remember this device"` + Added Server Proof):**
   - Removed *"Remember this device"* (permanently disabling the gate on a shared family tablet left settings 1 tap away from a 4-year-old).
   - Kept two safe strictness modes: **`Every time` (default)** and **`5-min setup window`** (which immediately re-locks on tab backgrounding `visibilitychange` or tapping **`Lock & Back to World`**).
   - Added HMAC-SHA256 signed `x-parent-proof` verification in the Worker (`/api/parent/gate`) so unauthenticated client calls cannot modify `/api/parent/settings` or forge parent grace grants.
5. **Zero-Touch Engine Bridge (`engine.ts` Diffing `S.mdone`):**
   - Instead of embedding Worker `fetch` calls inside `public/world/ToyVentor-World.html`, `src/features/game/world/engine.ts` diffs `window.__x.S.mdone` alongside `S.found` and emits `{ type: "missionsDone", keys, total }`. All 9 STEM Playground labs, Bridge, Lift, and custom level missions work automatically with offline local-first fallback.

---

## Pure Rule Engine (`shared/parent-time.ts`)

```ts
evaluatePlayTime(nowMs, settings, ledger) -> {
  day,                       // "YYYY-MM-DD" in settings.timezone
  enabled,
  inQuietHours,
  usedSeconds,
  earnedMinutes,             // 0 .. (dailyLimitMinutes - dailyBaseMinutes)
  dailyCapMinutes,           // min(dailyBaseMinutes + earnedMinutes, dailyLimitMinutes)
  extraParentMinutes,        // parent-only "+5 min" grace today
  dailyRemainingSeconds,
  sessionRemainingSeconds,   // number | null
  remainingSeconds,          // number | null (null when disabled)
  twilightCue,               // true when 0 < remainingSeconds <= 60
  locked,                    // true when enabled && remainingSeconds === 0
  reason,                    // "disabled" | "active" | "daily_limit" | "session_limit" | "quiet_hours"
}
```

### Invariants & Boundary Rules

- **Hard ceiling:** `dailyCapMinutes = Math.min(settings.dailyBaseMinutes + ledger.earnedMinutes, settings.dailyLimitMinutes)`. Kid STEM completions can never push `dailyCapMinutes` past `settings.dailyLimitMinutes`.
- **At-cap completion:** Completing a mission when `dailyBaseMinutes + earnedMinutes >= dailyLimitMinutes` awards `0` minutes (never negative) and still records the mission ID in `completedIds`.
- **Idempotency:** Completing the same `missionId` twice on the same `day` awards minutes on the first completion only.
- **Midnight reset (no rollover):** `day` is computed via `Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone })`. Crossing local midnight starts a fresh `(player_id, day)` ledger with `usedSeconds = 0`, `earnedMinutes = 0`, `extraParentMinutes = 0`, and `completedIds = []`.
- **Clock-backwards & tab-sleep safety:** Active play heartbeats report bounded elapsed active seconds (`0 <= deltaSeconds <= 65`), never `clientNow - sessionStart`. Negative or NaN deltas clamp to `0`; play time pauses automatically while `document.visibilityState !== "visible"`, while `GrownUpsSheet` is open, or while `SleepCurtain` is active.
- **Mid-mission grace:** When `missionPanel.open` is true at `remainingSeconds === 0` (outside quiet hours), the curtain waits up to `25 s` (or until the mission panel closes) before fading out so a child is never cut off mid-step.

---

## Storage & API Contracts

### D1 Schema (`migrations/0002_parent_time.sql` + Self-Bootstrap)

- `parent_settings`:
  - `player_id TEXT PRIMARY KEY`
  - `settings_json TEXT NOT NULL`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `time_ledger`:
  - `player_id TEXT NOT NULL`
  - `day TEXT NOT NULL` (`YYYY-MM-DD` in family timezone)
  - `used_seconds INTEGER NOT NULL DEFAULT 0`
  - `earned_minutes INTEGER NOT NULL DEFAULT 0`
  - `extra_parent_minutes INTEGER NOT NULL DEFAULT 0`
  - `session_used_seconds INTEGER NOT NULL DEFAULT 0`
  - `completed_ids TEXT NOT NULL DEFAULT '[]'`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `PRIMARY KEY (player_id, day)`

### Worker Endpoints (`worker/parent.ts`)

All routes identify the family device via `x-device-id` (`isPlayerId`) and degrade cleanly to `{ mode: "local-only" }` (`501`/`503`) if D1 is unbound, matching `worker/ownership.ts`:

- `POST /api/parent/gate`:
  - `{ action: "challenge" }` -> returns a Web Crypto random 2-digit STEM multiplication prompt `{ mode: "math" | "pin", a, b, challengeToken }` (never exposing `pinHash`).
  - `{ action: "verify", challengeToken, answer, pin }` -> verifies math answer or SHA-256 PIN digest and issues an HMAC-SHA256 signed `{ ok: true, proofToken, expiresAt }`.
- `GET /api/parent/settings` -> returns sanitized `ParentSettings` (`pinSet: boolean`, `pinHash` stripped).
- `PUT /api/parent/settings` -> **requires valid `x-parent-proof` header** (`403` without it); validates and persists `ParentSettings` (and optional new 4-digit `pin`).
- `GET /api/parent/time` -> returns `{ settings, ledger, status }` for today in the family's timezone.
- `POST /api/parent/time` ->
  - Unauthenticated play sync: `{ activeSecondsDelta?, completedMissionIds? }` (monotonically increments `used_seconds` and credits new `completed_ids` up to `dailyLimitMinutes`).
  - Parent-authenticated actions (**requires valid `x-parent-proof`**): `{ parentAction: "grant_five_minutes" | "reset_session" }`.

### Offline / Local Cache (`src/lib/parentTime.ts`)

- Mirrors settings and today's ledger in `localStorage` (`toyforge:parent-time:v1`) so limits, STEM awards, and the Sleep Curtain work offline and sync with D1 when online.

---

## Parent Gate & Grown-Ups UX (`GrownUpsSheet.tsx` & `SleepCurtain.tsx`)

1. **Two-Step Grown-Up Entry:**
   - **Step 1:** Press-and-hold ring (`1.2 s`, pointer or keyboard `Space`/`Enter`) so toddler taps bounce harmlessly.
   - **Step 2:** Two-digit multiplication (`12..19 × 4..9`) or family 4-digit PIN.
   - **Sitting window option:** When `gateStrictness === "sitting_window"`, re-entry within 5 minutes asks a 1-tap `"Still a grown-up? Confirm"`, and **immediately locks** whenever the app is backgrounded (`visibilitychange`) or the parent taps **`Lock & Back to World`**.
2. **Grown-Ups Controls (No Kid Content Inside):**
   - **Today's Summary Bar:** `Used` · `STEM Bonus (+Xm, N missions)` · `Ceiling` + one-tap **`+5 min today`** and **`Reset sitting`**.
   - **Presets:** `Off`, `Weeknight (20m / 30m cap)`, `Weekend (45m / 60m cap)`, `Quick 15m`.
   - **Custom Sliders/Pills:** `Base daily time`, `Hard daily ceiling`, `Minutes per STEM mission`, and a `Sitting timer, Bedtime & Gate` disclosure (`sessionLimitMinutes`, `quietHours`, `timezone`, `gateStrictness`, optional 4-digit PIN).
3. **Calm Sleep Curtain (`SleepCurtain.tsx`):**
   - Full-stage night-sky fade (`1.6 s` transition; instant under `prefers-reduced-motion`).
   - Stops `LivePlay` loops/mic and closes open build/pack overlays.
   - Copy has zero countdowns, zero red/error states, and zero em dashes: **`{toyName} is resting for tonight`** (or **`Time for a break!`** for sitting caps) + **`Grown-ups`** button in the corner.

---

## Validation Gates

1. **Unit & Worker Tests (`tests/parent-time.test.ts`):**
   - Pure rule engine: cap enforcement (`dailyBase + earned <= dailyLimit`), at-cap zero award, idempotent per-day `missionId` credit, local-midnight rollover in non-UTC timezones (`America/Los_Angeles`, `Pacific/Auckland`) with zero carry-over, overnight & daytime `quietHours`, negative/huge heartbeat clamping, and parent `+5 min` grace.
   - Worker `/api/parent/*`: D1 self-bootstrap, `403` rejection on unauthenticated `PUT /api/parent/settings` and `grant_five_minutes`, valid HMAC `x-parent-proof` flow, PIN hashing & verification, and player isolation.
2. **Engine Bridge (`tests/world-engine.test.ts`):**
   - `diffFoundKeys` / `missionsDone` event emission when `S.mdone` gains new mission keys.
3. **Build, Preflight & `390×844` E2E:**
   - `npm run validate`, `npm run typecheck`, `npm test`, `npm run build`, `npm run preflight`, and Playwright verification of `⋯ -> Grown-ups` gate -> preset activation -> STEM mission bonus -> Sleep Curtain fade-out -> parent `+5 min` unlock (zero em dashes in DOM).
