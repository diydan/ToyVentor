// Client-side Parent Time Gates store & D1 sync layer.
// Mirrors `shared/parent-time.ts` in localStorage so limits, STEM mission
// awards, and the calm Sleep Curtain work offline and sync with `/api/parent/*`
// whenever D1 is reachable.
import {
  applyParentAction,
  defaultParentSettings,
  defaultTimeZone,
  emptyLedgerForDay,
  evaluatePlayTime,
  isValidPin,
  localDay,
  normalizeLedgerForNow,
  recordActivePlay,
  recordMissionCompletions,
  sanitizeParentSettings,
  validateAndMergeParentSettings,
  type ParentSettings,
  type ParentSettingsUpdateInput,
  type ParentTimeAction,
  type PlayTimeStatus,
  type PublicParentSettings,
  type TimeLedgerRow,
} from "../../shared/parent-time";
import { deviceId } from "./sync";

export const PARENT_STORAGE_KEY = "toyforge:parent-time:v1";

interface LocalParentBundle {
  settings: ParentSettings;
  ledger: TimeLedgerRow;
}

export interface ParentSnapshot {
  settings: PublicParentSettings;
  ledger: TimeLedgerRow;
  status: PlayTimeStatus;
}

export interface GateChallenge {
  mode: "math" | "pin";
  pinSet: boolean;
  a: number;
  b: number;
  challengeToken: string;
  localExpectedAnswer?: number;
}

export interface GateSession {
  proofToken: string;
  expiresAt: number;
}

function randomIntInclusive(min: number, max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0]! % (max - min + 1));
}

async function localPinHash(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`toyventor-local-pin:v1:${deviceId()}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadLocalParentBundle(nowMs = Date.now()): LocalParentBundle {
  const fallbackSettings = defaultParentSettings();
  const fallbackLedger = emptyLedgerForDay(localDay(nowMs, fallbackSettings.timezone));
  try {
    const raw = localStorage.getItem(PARENT_STORAGE_KEY);
    if (!raw) return { settings: fallbackSettings, ledger: fallbackLedger };
    const parsed = JSON.parse(raw) as Partial<LocalParentBundle>;
    const merged = validateAndMergeParentSettings(
      defaultParentSettings(parsed.settings?.timezone),
      parsed.settings ?? {},
    );
    const settings: ParentSettings = merged.ok
      ? {
          ...merged.settings,
          pinHash:
            typeof parsed.settings?.pinHash === "string"
              ? parsed.settings.pinHash
              : null,
        }
      : fallbackSettings;
    const ledger = normalizeLedgerForNow(parsed.ledger, settings, nowMs);
    return { settings, ledger };
  } catch {
    return { settings: fallbackSettings, ledger: fallbackLedger };
  }
}

function saveLocalParentBundle(bundle: LocalParentBundle): void {
  try {
    localStorage.setItem(PARENT_STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getLocalParentSnapshot(nowMs = Date.now()): ParentSnapshot {
  const { settings, ledger } = loadLocalParentBundle(nowMs);
  return {
    settings: sanitizeParentSettings(settings),
    ledger,
    status: evaluatePlayTime(nowMs, settings, ledger),
  };
}

function baseHeaders(proofToken?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-device-id": deviceId(),
    "x-client-timezone": defaultTimeZone(),
    ...(proofToken ? { "x-parent-proof": proofToken } : {}),
  };
}

function mergeRemoteIntoLocal(
  remoteSettings: PublicParentSettings,
  remoteLedger: TimeLedgerRow,
  persisted = true,
  nowMs = Date.now(),
): ParentSnapshot {
  const local = loadLocalParentBundle(nowMs);
  const nextSettings: ParentSettings = persisted
    ? {
        ...remoteSettings,
        pinHash: remoteSettings.pinSet ? (local.settings.pinHash ?? "server-pin") : null,
      }
    : local.settings;
  const normRemote = normalizeLedgerForNow(remoteLedger, nextSettings, nowMs);
  const normLocal = normalizeLedgerForNow(local.ledger, nextSettings, nowMs);

  // Never lose offline active play time on the same calendar day.
  const combinedCompleted = [
    ...new Set([...normRemote.completedIds, ...normLocal.completedIds]),
  ];
  const mergedLedger: TimeLedgerRow =
    normRemote.day === normLocal.day
      ? normalizeLedgerForNow(
          {
            day: normRemote.day,
            usedSeconds: Math.max(normRemote.usedSeconds, normLocal.usedSeconds),
            earnedMinutes: Math.max(normRemote.earnedMinutes, normLocal.earnedMinutes),
            extraParentMinutes: Math.max(
              normRemote.extraParentMinutes,
              normLocal.extraParentMinutes,
            ),
            sessionUsedSeconds: Math.max(
              normRemote.sessionUsedSeconds,
              normLocal.sessionUsedSeconds,
            ),
            completedIds: combinedCompleted,
          },
          nextSettings,
          nowMs,
        )
      : normRemote;

  saveLocalParentBundle({ settings: nextSettings, ledger: mergedLedger });
  return {
    settings: sanitizeParentSettings(nextSettings),
    ledger: mergedLedger,
    status: evaluatePlayTime(nowMs, nextSettings, mergedLedger),
  };
}

export async function pullParentTime(): Promise<ParentSnapshot> {
  try {
    const res = await fetch("/api/parent/time", { headers: baseHeaders() });
    if (res.ok) {
      const body = (await res.json()) as {
        persisted?: boolean;
        settings?: PublicParentSettings;
        ledger?: TimeLedgerRow;
      };
      if (body.settings && body.ledger) {
        return mergeRemoteIntoLocal(body.settings, body.ledger, body.persisted ?? true);
      }
    }
  } catch {
    /* offline fallback */
  }
  return getLocalParentSnapshot();
}

export async function requestGateChallenge(): Promise<GateChallenge> {
  try {
    const res = await fetch("/api/parent/gate", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ action: "challenge" }),
    });
    if (res.ok) {
      const body = (await res.json()) as GateChallenge;
      if (typeof body.a === "number" && typeof body.b === "number") {
        return body;
      }
    }
  } catch {
    /* offline fallback */
  }
  const { settings } = loadLocalParentBundle();
  const a = randomIntInclusive(12, 19);
  const b = randomIntInclusive(4, 9);
  return {
    mode: settings.pinHash ? "pin" : "math",
    pinSet: Boolean(settings.pinHash),
    a,
    b,
    challengeToken: "local",
    localExpectedAnswer: a * b,
  };
}

export async function verifyGateAnswer(params: {
  challenge: GateChallenge;
  answer?: number;
  pin?: string;
}): Promise<{ ok: true; session: GateSession } | { ok: false; error: string }> {
  const { challenge, answer, pin } = params;
  if (challenge.challengeToken !== "local") {
    try {
      const res = await fetch("/api/parent/gate", {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify({
          action: "verify",
          challengeToken: challenge.challengeToken,
          ...(answer !== undefined ? { answer } : {}),
          ...(pin !== undefined ? { pin } : {}),
        }),
      });
      if (res.status === 403) {
        return { ok: false, error: "That answer did not match. Try once more." };
      }
      if (res.ok) {
        const body = (await res.json()) as {
          ok?: boolean;
          proofToken?: string;
          expiresAt?: number;
        };
        if (body.ok && body.proofToken && body.expiresAt) {
          return {
            ok: true,
            session: { proofToken: body.proofToken, expiresAt: body.expiresAt },
          };
        }
      }
    } catch {
      /* fall through to local check if offline */
    }
  }

  // Local verification fallback (when D1 is unbound or device is offline).
  const { settings } = loadLocalParentBundle();
  let ok = false;
  if (pin !== undefined && settings.pinHash && settings.pinHash !== "server-pin") {
    if (isValidPin(pin)) {
      const candidate = await localPinHash(pin);
      ok = candidate === settings.pinHash;
    }
  } else if (answer !== undefined) {
    const expected = challenge.localExpectedAnswer ?? challenge.a * challenge.b;
    ok = Number.isInteger(answer) && answer === expected;
  }

  if (!ok) {
    return { ok: false, error: "That answer did not match. Try once more." };
  }

  const ttlMs = settings.gateStrictness === "sitting_window" ? 5 * 60_000 : 2 * 60_000;
  return {
    ok: true,
    session: {
      proofToken: "local-proof",
      expiresAt: Date.now() + ttlMs,
    },
  };
}

export async function updateParentSettings(
  patch: ParentSettingsUpdateInput,
  proofToken: string,
): Promise<{ ok: true; snapshot: ParentSnapshot } | { ok: false; error: string }> {
  const nowMs = Date.now();
  const local = loadLocalParentBundle(nowMs);
  const merged = validateAndMergeParentSettings(local.settings, patch);
  if (!merged.ok) {
    return { ok: false, error: merged.errors.join(". ") };
  }

  let pinHash = local.settings.pinHash ?? null;
  if (merged.newPin === "clear") pinHash = null;
  else if (typeof merged.newPin === "string") pinHash = await localPinHash(merged.newPin);

  const nextLocalSettings: ParentSettings = {
    ...merged.settings,
    pinHash,
  };
  const nextLocalLedger = normalizeLedgerForNow(local.ledger, nextLocalSettings, nowMs);
  saveLocalParentBundle({ settings: nextLocalSettings, ledger: nextLocalLedger });

  if (proofToken && proofToken !== "local-proof") {
    try {
      const res = await fetch("/api/parent/settings", {
        method: "PUT",
        headers: baseHeaders(proofToken),
        body: JSON.stringify({
          timezone: patch.timezone ?? nextLocalSettings.timezone,
          ...patch,
        }),
      });
      if (res.status === 403) {
        return { ok: false, error: "Grown-up unlock expired. Please confirm again." };
      }
      if (res.ok) {
        const body = (await res.json()) as {
          settings?: PublicParentSettings;
          ledger?: TimeLedgerRow;
        };
        if (body.settings && body.ledger) {
          // Preserve local pinHash digest alongside server confirmation.
          const synced = mergeRemoteIntoLocal(body.settings, body.ledger, true);
          if (pinHash && pinHash !== "server-pin") {
            const latest = loadLocalParentBundle();
            saveLocalParentBundle({
              settings: { ...latest.settings, pinHash },
              ledger: latest.ledger,
            });
          }
          return { ok: true, snapshot: synced };
        }
      }
    } catch {
      /* offline: local update already persisted */
    }
  }

  return {
    ok: true,
    snapshot: {
      settings: sanitizeParentSettings(nextLocalSettings),
      ledger: nextLocalLedger,
      status: evaluatePlayTime(nowMs, nextLocalSettings, nextLocalLedger),
    },
  };
}

export async function recordPlayProgress(params: {
  activeSecondsDelta?: number;
  completedMissionIds?: string[];
}): Promise<{ snapshot: ParentSnapshot; awardedMinutes: number }> {
  const nowMs = Date.now();
  const local = loadLocalParentBundle(nowMs);
  let ledger = local.ledger;
  let awardedMinutes = 0;

  if (typeof params.activeSecondsDelta === "number" && params.activeSecondsDelta > 0) {
    ledger = recordActivePlay(ledger, local.settings, nowMs, params.activeSecondsDelta);
  }
  if (params.completedMissionIds && params.completedMissionIds.length > 0) {
    const res = recordMissionCompletions(
      ledger,
      local.settings,
      nowMs,
      params.completedMissionIds,
    );
    ledger = res.ledger;
    awardedMinutes = res.awardedMinutes;
  }
  saveLocalParentBundle({ settings: local.settings, ledger });

  try {
    const res = await fetch("/api/parent/time", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({
        ...params,
        minUsedSeconds: ledger.usedSeconds,
        minSessionUsedSeconds: ledger.sessionUsedSeconds,
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        persisted?: boolean;
        awardedMinutes?: number;
        settings?: PublicParentSettings;
        ledger?: TimeLedgerRow;
      };
      if (body.settings && body.ledger) {
        const snapshot = mergeRemoteIntoLocal(
          body.settings,
          body.ledger,
          body.persisted ?? true,
        );
        return {
          snapshot,
          awardedMinutes: body.awardedMinutes ?? awardedMinutes,
        };
      }
    }
  } catch {
    /* offline: local ledger stays authoritative on device */
  }

  return {
    snapshot: {
      settings: sanitizeParentSettings(local.settings),
      ledger,
      status: evaluatePlayTime(nowMs, local.settings, ledger),
    },
    awardedMinutes,
  };
}

export async function runParentTimeAction(
  action: ParentTimeAction,
  proofToken: string,
): Promise<{ ok: true; snapshot: ParentSnapshot } | { ok: false; error: string }> {
  const nowMs = Date.now();
  const local = loadLocalParentBundle(nowMs);
  const nextLedger = applyParentAction(local.ledger, local.settings, nowMs, action);
  saveLocalParentBundle({ settings: local.settings, ledger: nextLedger });

  if (proofToken && proofToken !== "local-proof") {
    try {
      const res = await fetch("/api/parent/time", {
        method: "POST",
        headers: baseHeaders(proofToken),
        body: JSON.stringify({ parentAction: action }),
      });
      if (res.status === 403) {
        return { ok: false, error: "Grown-up unlock expired. Please confirm again." };
      }
      if (res.ok) {
        const body = (await res.json()) as {
          persisted?: boolean;
          settings?: PublicParentSettings;
          ledger?: TimeLedgerRow;
        };
        if (body.settings && body.ledger) {
          return {
            ok: true,
            snapshot: mergeRemoteIntoLocal(
              body.settings,
              body.ledger,
              body.persisted ?? true,
            ),
          };
        }
      }
    } catch {
      /* offline fallback */
    }
  }

  return {
    ok: true,
    snapshot: {
      settings: sanitizeParentSettings(local.settings),
      ledger: nextLedger,
      status: evaluatePlayTime(nowMs, local.settings, nextLedger),
    },
  };
}
