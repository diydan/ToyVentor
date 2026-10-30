// Client-side Parent Time Gates store & D1 sync layer.
// Mirrors `shared/parent-time.ts` in localStorage so limits, STEM mission
// awards, and the calm Sleep Curtain work offline and sync with `/api/parent/*`
// whenever D1 is reachable.
import {
  PIN_MAX_ATTEMPTS,
  activePinCooldownUntil,
  applyParentAction,
  defaultParentSettings,
  defaultTimeZone,
  emptyLedgerForDay,
  evaluatePinAttempt,
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
  cooldownUntil?: number | null;
}

export interface GateSession {
  proofToken: string;
  expiresAt: number;
}

export type GateVerifyResult =
  | { ok: true; session: GateSession }
  | {
      ok: false;
      error: string;
      cooldownUntil?: number;
      retryAfterSeconds?: number;
      attemptsRemaining?: number;
    };

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
          pinFailedAttempts: Math.max(
            0,
            Math.floor(Number(parsed.settings?.pinFailedAttempts) || 0),
          ),
          pinCooldownUntil:
            typeof parsed.settings?.pinCooldownUntil === "number" &&
            Number.isFinite(parsed.settings.pinCooldownUntil)
              ? parsed.settings.pinCooldownUntil
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

export function getLocalPinCooldownUntil(nowMs = Date.now()): number | null {
  const { settings } = loadLocalParentBundle(nowMs);
  return activePinCooldownUntil(settings, nowMs);
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
        pinFailedAttempts: remoteSettings.pinSet
          ? (local.settings.pinFailedAttempts ?? 0)
          : 0,
        pinCooldownUntil: remoteSettings.pinSet
          ? (local.settings.pinCooldownUntil ?? null)
          : null,
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

export async function requestGateChallenge(nowMs = Date.now()): Promise<GateChallenge> {
  const localCooldown = getLocalPinCooldownUntil(nowMs);
  try {
    const res = await fetch("/api/parent/gate", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ action: "challenge" }),
    });
    if (res.ok) {
      const body = (await res.json()) as GateChallenge;
      if (typeof body.a === "number" && typeof body.b === "number") {
        const serverCooldown =
          typeof body.cooldownUntil === "number" && body.cooldownUntil > nowMs
            ? body.cooldownUntil
            : null;
        const effectiveCooldown =
          serverCooldown && localCooldown
            ? Math.max(serverCooldown, localCooldown)
            : (serverCooldown ?? localCooldown);
        return {
          ...body,
          cooldownUntil: effectiveCooldown,
        };
      }
    }
  } catch {
    /* offline fallback */
  }
  const { settings } = loadLocalParentBundle(nowMs);
  const a = randomIntInclusive(12, 19);
  const b = randomIntInclusive(4, 9);
  return {
    mode: settings.pinHash ? "pin" : "math",
    pinSet: Boolean(settings.pinHash),
    a,
    b,
    challengeToken: "local",
    localExpectedAnswer: a * b,
    cooldownUntil: activePinCooldownUntil(settings, nowMs),
  };
}

function pinCooldownMessage(retryAfterSeconds: number): string {
  return `Too many PIN tries. Wait ${retryAfterSeconds}s or tap Forgot PIN?`;
}

function pinMismatchMessage(attemptsRemaining?: number): string {
  if (typeof attemptsRemaining === "number") {
    return `That PIN did not match (${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left).`;
  }
  return "That answer did not match. Try once more.";
}

export async function verifyGateAnswer(params: {
  challenge: GateChallenge;
  answer?: number;
  pin?: string;
  nowMs?: number;
}): Promise<GateVerifyResult> {
  const { challenge, answer, pin } = params;
  const nowMs = params.nowMs ?? Date.now();

  // Enforce persisted local PIN cooldown before any network or offline attempt
  // so toggling airplane mode or reloading cannot bypass an active cooldown.
  if (pin !== undefined) {
    const localBundle = loadLocalParentBundle(nowMs);
    const localActiveUntil = activePinCooldownUntil(localBundle.settings, nowMs);
    if (localActiveUntil !== null) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((localActiveUntil - nowMs) / 1000),
      );
      return {
        ok: false,
        error: pinCooldownMessage(retryAfterSeconds),
        cooldownUntil: localActiveUntil,
        retryAfterSeconds,
        attemptsRemaining: 0,
      };
    }
  }

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
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          cooldownUntil?: number;
          retryAfterSeconds?: number;
        };
        const retryAfterSeconds = Math.max(
          1,
          Math.floor(Number(body.retryAfterSeconds) || 30),
        );
        const cooldownUntil =
          typeof body.cooldownUntil === "number" && body.cooldownUntil > nowMs
            ? body.cooldownUntil
            : nowMs + retryAfterSeconds * 1000;
        const latest = loadLocalParentBundle(nowMs);
        saveLocalParentBundle({
          settings: {
            ...latest.settings,
            pinFailedAttempts: PIN_MAX_ATTEMPTS,
            pinCooldownUntil: cooldownUntil,
          },
          ledger: latest.ledger,
        });
        return {
          ok: false,
          error: pinCooldownMessage(retryAfterSeconds),
          cooldownUntil,
          retryAfterSeconds,
          attemptsRemaining: 0,
        };
      }
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as {
          attemptsRemaining?: number;
        };
        if (pin !== undefined && typeof body.attemptsRemaining === "number") {
          const latest = loadLocalParentBundle(nowMs);
          saveLocalParentBundle({
            settings: {
              ...latest.settings,
              pinFailedAttempts: Math.max(
                0,
                PIN_MAX_ATTEMPTS - body.attemptsRemaining,
              ),
              pinCooldownUntil: null,
            },
            ledger: latest.ledger,
          });
        }
        return {
          ok: false,
          error:
            pin !== undefined
              ? pinMismatchMessage(body.attemptsRemaining)
              : "That answer did not match. Try once more.",
          ...(typeof body.attemptsRemaining === "number"
            ? { attemptsRemaining: body.attemptsRemaining }
            : {}),
        };
      }
      if (res.ok) {
        const body = (await res.json()) as {
          ok?: boolean;
          proofToken?: string;
          expiresAt?: number;
        };
        if (body.ok && body.proofToken && body.expiresAt) {
          const latest = loadLocalParentBundle(nowMs);
          if (
            (latest.settings.pinFailedAttempts ?? 0) > 0 ||
            latest.settings.pinCooldownUntil
          ) {
            saveLocalParentBundle({
              settings: {
                ...latest.settings,
                pinFailedAttempts: 0,
                pinCooldownUntil: null,
              },
              ledger: latest.ledger,
            });
          }
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
  const local = loadLocalParentBundle(nowMs);
  const { settings } = local;

  if (pin !== undefined) {
    let pinMatches = false;
    if (settings.pinHash && settings.pinHash !== "server-pin" && isValidPin(pin)) {
      const candidate = await localPinHash(pin);
      pinMatches = candidate === settings.pinHash;
    }
    const outcome = evaluatePinAttempt(settings, nowMs, pinMatches);
    saveLocalParentBundle({ settings: outcome.settings, ledger: local.ledger });

    if (outcome.status === "cooldown") {
      return {
        ok: false,
        error: pinCooldownMessage(outcome.retryAfterSeconds),
        cooldownUntil: outcome.cooldownUntil,
        retryAfterSeconds: outcome.retryAfterSeconds,
        attemptsRemaining: 0,
      };
    }
    if (outcome.status === "mismatch") {
      return {
        ok: false,
        error: pinMismatchMessage(outcome.attemptsRemaining),
        attemptsRemaining: outcome.attemptsRemaining,
      };
    }
  } else if (answer !== undefined) {
    const expected = challenge.localExpectedAnswer ?? challenge.a * challenge.b;
    const ok = Number.isInteger(answer) && answer === expected;
    if (!ok) {
      return { ok: false, error: "That answer did not match. Try once more." };
    }
  } else {
    return { ok: false, error: "That answer did not match. Try once more." };
  }

  const ttlMs = settings.gateStrictness === "sitting_window" ? 5 * 60_000 : 2 * 60_000;
  return {
    ok: true,
    session: {
      proofToken: "local-proof",
      expiresAt: nowMs + ttlMs,
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
