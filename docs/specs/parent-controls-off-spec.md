# An option to turn off the grown-up checks and the limits (draft 2, 2026-11-03)

**Status: built and committed 2026-11-03 (draft 2; `096780b`; real-browser e2e `scripts/e2e-parent-controls.mjs`, 35 checks); the one decision below was answered "no" (the photo-upload gates stay on).** Dan asked for "an option to disable all parent gating and limits". This is what that touches today, what an off switch exposes, how it is built so a child cannot reach it by accident, and what changed from draft 1 (section 8: no Worker variable was needed).

## 1. What "all" covers today (read in the code)

| What | Where it is enforced | What it protects |
|---|---|---|
| **Play-time limits**: daily cap, per-session limit, quiet hours, the Sleep Curtain | Client: `evaluatePlayTime` (`shared/parent-time.ts`) gives `status.locked`, `GameCanvas.tsx` turns it into `sleepActive` and disables the dock. Already switchable by a grown-up: `settings.enabled = false` (the "Off" preset) returns "never locked, never in quiet hours" | How long a child plays |
| **The Grown-Ups sheet's challenge** (hold 1.2 s, then a math question or the PIN) | Client: `requestGateChallenge` / `verifyGateAnswer` (`src/lib/parentTime.ts`) against `/api/parent/gate`, which issues a proof token valid 2 or 5 minutes | Who can open the sheet |
| **Gated parent actions** | Server: `PUT /api/parent/settings`, the `grant_five_minutes` and `reset_session` time actions, all via `requireParentProof` (`worker/parent.ts`) | Changing limits and PIN, giving extra time |
| **The Garage "We found it" confirm** | Client, inside the Grown-Ups sheet (`HouseholdConfirm`) | Paying XP and play-time minutes for a household find |
| **Selfie "Smart face" and room-photo scan** | Server: `verifyParentProofFromRequest` (`worker/selfie.ts`, `worker/roomScan.ts`), plus the selfie's consent screen | **A child's photo being sent to a third party's AI service** |
| **Forge optimizer** (`requireProof`), **Make from words** | Server; Make from words asks for no proof unless `FORGE_MAKE_REQUIRES_PROOF=1` (Dan, 2026-11-03: making and previewing are digital) | Paid model calls, digital only |
| **Workshop file downloads** | Shell option `downloads` (game mounts it `false`); the grown-up question is designed, not wired (`workshop-print-gate-spec.md`) | Files leaving the page |

Already in the code: **Demo Mode** (Grown-Ups, "Showcase & Developer", default off) unlocks content only (all worlds, editor, sandbox unlock-all, preview weekend). It switches off no check and no limit, so this is new.

## 2. What an off switch exposes

- **Unlimited play and no break** (the limits).
- **A child can change the limits and the PIN, and pay themselves play time** (settings, time actions, the Garage confirm).
- **A child's photo can leave the device** with no grown-up present, if the selfie and room-photo gates are included. This is the one that is different in kind: the others are about time and settings, this one is about a third party receiving a child's picture. The selfie flow also has a consent screen that exists for the same reason.

## 3. Recommended design

**One master switch, `parentControls: 'on' | 'off'`, read in one place** (`src/lib/parentControls.ts`, a pure function, new), with these rules:

1. **Default `'on'`, and a test pins it.** Nothing a child can type or tap changes it.
2. **Two ways to turn it off, neither reachable from a URL or from stored data a child could edit** (draft 1 had a third, a Worker variable: dropped, see section 8):
   - *Build time:* `VITE_PARENT_CONTROLS=off` in a demo build, for a showcase deployment. It cannot be turned back on in the page.
   - *Run time:* a second toggle in the Grown-Ups sheet's "Showcase & Developer" block, shown only while Demo Mode is on. It sits behind the gate, so a grown-up has to open it (and pass the question) to flip it. It is stored in `sessionStorage` (this tab, gone on close), not `localStorage`, never read from the address bar, and **counts only while Demo Mode is on**: turning Demo Mode off clears it.
3. **While it is off, a banner says so** ("Grown-up checks and limits are off (demo)") with a "Turn back on" button, so it cannot be left on without anyone noticing.
4. **What it overrides, without changing the parent's saved settings or the ledger:**
   - Limits: one override at the single place `status.locked` is consumed, so `sleepActive` is false.
   - The challenge: `requestGateChallenge` answers "bypass" and the Grown-Ups sheet opens.
   - Parent actions, the Garage confirm: the sheet works with the token `"local-proof"` that `parentTime.ts` already treats as "do not call the Worker", so a bypassed edit changes this device only and the Worker's saved data is never written without a real proof.
   - Play time is **not counted** while off (the five-second heartbeat only refreshes the display), so a demo does not spend the child's real day.
   - The Workshop: `downloads: true`.
   - The Worker is **not changed**: nothing under `worker/` or `shared/` reads the switch (a test pins it).
5. **Recommended: the photo-upload gates stay on even when everything else is off.** The selfie cloud and room scan keep requiring a real proof (and the selfie keeps its consent screen). A presenter passes the question once and it covers the next 2 to 5 minutes, as the selfie's own e2e already shows. The cost is one question during a demo; the benefit is that no switch, however it was set, lets a child's photo go to a third party unchecked.

## 4. Tests it needs

- The default is `'on'` (fails if it ever changes), and an unknown value means `'on'`.
- The address bar, `localStorage` and a cookie never turn it off; `sessionStorage` does, and a new tab starts `'on'`.
- Off: `sleepActive` is false with a locked ledger, the Grown-Ups sheet opens with no question, the banner shows, and the saved settings and ledger are byte-for-byte unchanged afterwards.
- Worker: with the variable set, settings and time actions are accepted without a proof; **the selfie and room-scan routes still answer "parent gate required"**; unset, everything is as today.
- The toggle is absent unless Demo Mode is on.

## 5. Blast radius

New: `src/lib/parentControls.ts`, `tests/parent-controls.test.ts`, `scripts/e2e-parent-controls.mjs`. Small hunks in three files: `GameCanvas.tsx` (one derived snapshot that every lock consumer reads, the banner, the heartbeat, the two handlers), `GrownUpsSheet.tsx` (open without the question, re-lock when switched on, the toggle, one honest message for room photos) and `WorkshopLauncher.tsx` (a `downloads` prop). Not touched: `parentTime.ts`, `worker/*`, `shared/*`, `src/index.css`.

## 6. The decision that is Dan's

**Does "all" include the photo-upload gates (selfie cloud, room scan)?** Recommended: no, as in section 3 item 5. If yes, the Worker variable also lets those routes through, so a demo build can send a photo to a third party with nobody present: do that only on a deployment that never holds a real child's photo. Smaller choices, each with a default above: whether the run-time toggle persists past the tab (default: no), whether a showcase build should strip the toggle from production builds (default: yes, behind the build flag), and the banner wording.

## 7. Not verified

I read the places in section 1, not every line of `GrownUpsSheet.tsx` or `GameCanvas.tsx`; there may be another place that reads `status.locked` or the proof directly. `grep` for `sleepActive`, `requestGateChallenge` and `requireParentProof` is the first step of the build, and a failing test (section 4) is how any miss shows up. Nothing here has been checked against a legal or app-store requirement for children's apps.
