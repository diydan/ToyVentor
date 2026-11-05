// parentControls.ts: the ONE place that says whether the grown-up checks and the play-time limits are on
// (docs/specs/parent-controls-off-spec.md, draft 1; Dan asked for "an option to disable all parent gating and limits", scope agreed 2026-11-03).
//
// Rules this file keeps (each one is pinned in tests/parent-controls.test.ts):
//   - The default is ON, and anything that is not exactly "off" means on.
//   - Two ways to turn it off, neither reachable from the address bar, localStorage or a cookie:
//       * the build flag VITE_PARENT_CONTROLS=off (a showcase build), and
//       * a tab-only sessionStorage value, honoured ONLY while Demo Mode is on (the toggle lives in the Grown-Ups sheet's "Showcase & Developer" block).
//     Turning Demo Mode off therefore ends the bypass at once.
//   - "Off" never edits what a grown-up saved: the settings and the ledger are left alone, only what the client READS is overridden.
//   - The photo-upload gates (selfie cloud, room scan) are not part of this file and are never bypassed: they check a real proof on the Worker.
//
// Pure apart from `readParentControlsInputs` / `setParentControlsSession`, which touch only sessionStorage and the build env inside try/catch.

import type { PlayTimeStatus } from "../../shared/parent-time";
import type { GateSession, ParentSnapshot } from "./parentTime";

export type ParentControlsMode = "on" | "off";
/** Where an "off" came from: the build ('build', cannot be turned back on in the page) or this tab's Demo Mode toggle ('session'). 'default' means on. */
export type ParentControlsSource = "default" | "build" | "session";

export const PARENT_CONTROLS_SESSION_KEY = "toyforge:parent-controls:v1";
/** The proof token the Grown-Ups sheet already uses for "no server proof": parentTime.ts skips the Worker call for it. */
export const LOCAL_PROOF = "local-proof";
/** How long a bypass session claims to last; nothing is checked server-side for it, so this is only the sheet's own sitting window. */
export const BYPASS_SESSION_MS = 5 * 60 * 1000;

export interface ParentControlsInputs {
  /** `import.meta.env.VITE_PARENT_CONTROLS` */
  buildFlag?: unknown;
  /** `sessionStorage.getItem(PARENT_CONTROLS_SESSION_KEY)` */
  sessionValue?: unknown;
  /** Demo Mode (Grown-Ups, "Showcase & Developer"). The session value is ignored while it is off. */
  demoMode?: boolean;
}

export function parentControlsSource(inputs: ParentControlsInputs): ParentControlsSource {
  if (inputs.buildFlag === "off") return "build";
  if (inputs.demoMode === true && inputs.sessionValue === "off") return "session";
  return "default";
}

export function resolveParentControls(inputs: ParentControlsInputs): ParentControlsMode {
  return parentControlsSource(inputs) === "default" ? "on" : "off";
}

/** The real inputs: the build env and this tab's sessionStorage. Every read can fail (private window, blocked storage) and then means "not set". */
export function readParentControlsInputs(demoMode: boolean): ParentControlsInputs {
  let buildFlag: unknown;
  try {
    buildFlag = import.meta.env?.VITE_PARENT_CONTROLS;
  } catch {
    buildFlag = undefined;
  }
  let sessionValue: unknown;
  try {
    sessionValue = globalThis.sessionStorage?.getItem(PARENT_CONTROLS_SESSION_KEY) ?? undefined;
  } catch {
    sessionValue = undefined;
  }
  return { buildFlag, sessionValue, demoMode };
}

/** Shorthand for the page: the current mode for the current Demo Mode value. */
export function currentParentControls(demoMode: boolean): ParentControlsMode {
  return resolveParentControls(readParentControlsInputs(demoMode));
}

/**
 * The Demo Mode toggle's write. Stores in sessionStorage only (this tab, gone when it closes). Returns false when storage refused, so the toggle can say so.
 * Writing while Demo Mode is off is harmless: `parentControlsSource` ignores the value then.
 */
export function setParentControlsSession(off: boolean): boolean {
  try {
    const store = globalThis.sessionStorage;
    if (!store) return false;
    if (off) store.setItem(PARENT_CONTROLS_SESSION_KEY, "off");
    else store.removeItem(PARENT_CONTROLS_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * What every consumer of the play-time status should see. Off: the same shape `evaluatePlayTime` returns when Play Time is switched off (never locked, no
 * twilight, no bedtime, no quiet hours), so `sleepActive`, the mission grace and the heartbeat all fall out with no other change. The settings and the ledger inside the
 * snapshot are the SAME objects, untouched. On: the snapshot itself (same reference, so React state does not churn).
 */
export function effectiveParentSnapshot(snapshot: ParentSnapshot, mode: ParentControlsMode): ParentSnapshot {
  if (mode !== "off") return snapshot;
  const s = snapshot.status;
  if (!s.locked && !s.twilightCue && !s.bedtime && !s.inQuietHours && s.reason === "disabled") return snapshot; // already reads as off
  const status: PlayTimeStatus = {
    ...s,
    enabled: false,
    inQuietHours: false,
    remainingSeconds: null,
    twilightCue: false,
    bedtime: false,
    locked: false,
    reason: "disabled",
  };
  return { ...snapshot, status };
}

/**
 * The grown-up question, skipped. Off: a session the Grown-Ups sheet can use as if the question had been answered; its token is `LOCAL_PROOF`, which
 * parentTime.ts already treats as "do not call the Worker", so a bypassed edit changes this device only and the Worker's saved data is never written
 * without a real proof. On: null (ask the question as usual).
 */
export function bypassGateSession(mode: ParentControlsMode, nowMs: number = Date.now()): GateSession | null {
  if (mode !== "off") return null;
  return { proofToken: LOCAL_PROOF, expiresAt: nowMs + BYPASS_SESSION_MS };
}

/** The banner's words and whether the page can turn it back on (a build-time "off" cannot be undone from the page). Null while on. */
export function parentControlsBanner(
  source: ParentControlsSource,
): { text: string; canTurnOn: boolean; button: string } | null {
  if (source === "default") return null;
  return {
    text: "Grown-up checks and limits are off (demo).",
    canTurnOn: source === "session",
    button: "Turn back on",
  };
}
