import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_HEARTBEAT_SECONDS,
  PARENT_PRESETS,
  PIN_COOLDOWN_MS,
  PIN_MAX_ATTEMPTS,
  applyParentAction,
  defaultParentSettings,
  emptyLedgerForDay,
  evaluatePinAttempt,
  evaluatePlayTime,
  isInQuietHours,
  localDay,
  recordActivePlay,
  recordMissionCompletions,
  validateAndMergeParentSettings,
  type ParentSettings,
} from "../shared/parent-time";
import {
  getLocalPinCooldownUntil,
  requestGateChallenge,
  updateParentSettings,
  verifyGateAnswer,
} from "../src/lib/parentTime";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const DEVICE_A = "12345678-1234-1234-1234-123456789abc";
const DEVICE_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function weeknightSettings(timezone = "America/Los_Angeles"): ParentSettings {
  const base = defaultParentSettings(timezone);
  const preset = PARENT_PRESETS.find((p) => p.id === "weeknight")!;
  const merged = validateAndMergeParentSettings(base, preset.patch);
  if (!merged.ok) throw new Error(merged.errors.join(", "));
  return merged.settings;
}

/** In-memory D1 stand-in supporting `parent_settings` and `time_ledger`. */
function fakeParentDb(): D1Like {
  const settingsMap = new Map<string, string>();
  const ledgerMap = new Map<
    string,
    {
      day: string;
      used_seconds: number;
      earned_minutes: number;
      extra_parent_minutes: number;
      session_used_seconds: number;
      completed_ids: string;
    }
  >();

  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [playerId, jsonText] = values as [string, string];
            if (sql.includes("DO NOTHING")) {
              if (!settingsMap.has(playerId)) settingsMap.set(playerId, jsonText);
            } else {
              settingsMap.set(playerId, jsonText);
            }
          } else if (sql.includes("INSERT INTO time_ledger")) {
            const [
              playerId,
              day,
              used_seconds,
              earned_minutes,
              extra_parent_minutes,
              session_used_seconds,
              completed_ids,
            ] = values as [string, string, number, number, number, number, string];
            ledgerMap.set(`${playerId}|${day}`, {
              day,
              used_seconds,
              earned_minutes,
              extra_parent_minutes,
              session_used_seconds,
              completed_ids,
            });
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const [playerId] = values as [string];
            const found = settingsMap.get(playerId);
            return { results: found !== undefined ? [{ settings_json: found }] : [] };
          }
          if (sql.includes("FROM time_ledger")) {
            const [playerId, day] = values as [string, string];
            const row = ledgerMap.get(`${playerId}|${day}`);
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

const callParent = (
  env: object,
  path: string,
  init: RequestInit = {},
  deviceId = DEVICE_A,
) =>
  worker.fetch(
    new Request(`http://local${path}`, {
      ...init,
      headers: {
        "x-device-id": deviceId,
        "x-client-timezone": "America/Los_Angeles",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    }),
    env as never,
  );

describe("shared/parent-time pure rule engine", () => {
  it("starts disabled by default with open play and zero cues", () => {
    const now = Date.parse("2026-10-30T19:00:00Z");
    const settings = defaultParentSettings("America/Los_Angeles");
    const status = evaluatePlayTime(now, settings, null);
    expect(status.enabled).toBe(false);
    expect(status.locked).toBe(false);
    expect(status.twilightCue).toBe(false);
    expect(status.remainingSeconds).toBeNull();
    expect(status.reason).toBe("disabled");
  });

  it("credits unique STEM missions up to dailyLimitMinutes and never exceeds or goes negative", () => {
    const now = Date.parse("2026-10-30T19:00:00Z");
    const settings = weeknightSettings("America/Los_Angeles"); // 20m base, 30m limit, +5m/mission

    const first = recordMissionCompletions(null, settings, now, ["lab1.measure"]);
    expect(first.awardedMinutes).toBe(5);
    expect(first.newlyCreditedIds).toEqual(["lab1.measure"]);
    expect(evaluatePlayTime(now, settings, first.ledger)).toMatchObject({
      dailyCapMinutes: 25,
      earnHeadroomMinutes: 5,
      dailyRemainingSeconds: 25 * 60,
    });

    // Duplicate mission on the same local day grants 0m
    const dup = recordMissionCompletions(first.ledger, settings, now, ["lab1.measure"]);
    expect(dup.awardedMinutes).toBe(0);
    expect(dup.ledger.earnedMinutes).toBe(5);

    // Second unique mission hits the 30m hard ceiling
    const second = recordMissionCompletions(first.ledger, settings, now, ["garden.bridge"]);
    expect(second.awardedMinutes).toBe(5);
    expect(evaluatePlayTime(now, settings, second.ledger)).toMatchObject({
      dailyCapMinutes: 30,
      earnHeadroomMinutes: 0,
      completedCount: 2,
    });

    // Third unique mission is recorded in completedIds but grants 0m past ceiling
    const third = recordMissionCompletions(second.ledger, settings, now, ["lab2.gear"]);
    expect(third.awardedMinutes).toBe(0);
    expect(third.ledger.earnedMinutes).toBe(10);
    expect(third.ledger.completedIds).toEqual([
      "lab1.measure",
      "garden.bridge",
      "lab2.gear",
    ]);

    // Equal base and ceiling (20m == 20m) never awards negative minutes
    const zeroHeadroom: ParentSettings = { ...settings, dailyLimitMinutes: 20 };
    const none = recordMissionCompletions(null, zeroHeadroom, now, ["lab3.circuit"]);
    expect(none.awardedMinutes).toBe(0);
    expect(none.ledger.earnedMinutes).toBe(0);
  });

  it("clamps heartbeats monotonically, triggers twilightCue in the final 60s, and locks at 0s", () => {
    const now = Date.parse("2026-10-30T19:00:00Z");
    const settings = weeknightSettings("UTC"); // 20m = 1200s
    let ledger = emptyLedgerForDay(localDay(now, "UTC"));

    // Negative / NaN deltas do nothing
    ledger = recordActivePlay(ledger, settings, now, -45);
    ledger = recordActivePlay(ledger, settings, now, Number.NaN);
    expect(ledger.usedSeconds).toBe(0);

    // Oversized delta clamps to MAX_HEARTBEAT_SECONDS (65s)
    ledger = recordActivePlay(ledger, settings, now, 999);
    expect(ledger.usedSeconds).toBe(MAX_HEARTBEAT_SECONDS);

    // Advance to 1139s (61s left -> no twilight cue yet)
    ledger = { ...ledger, usedSeconds: 1139 };
    expect(evaluatePlayTime(now, settings, ledger)).toMatchObject({
      remainingSeconds: 61,
      twilightCue: false,
      locked: false,
    });

    // Advance to 1140s (60s left -> subtle twilight cue active)
    ledger = recordActivePlay(ledger, settings, now, 1);
    expect(evaluatePlayTime(now, settings, ledger)).toMatchObject({
      remainingSeconds: 60,
      twilightCue: true,
      locked: false,
      reason: "active",
    });

    // Advance to 1200s (0s left -> Sleep Curtain locks calmly)
    ledger = recordActivePlay(ledger, settings, now, 60);
    expect(evaluatePlayTime(now, settings, ledger)).toMatchObject({
      remainingSeconds: 0,
      twilightCue: false,
      locked: true,
      reason: "daily_limit",
    });
  });

  it("resets at local midnight in the family IANA timezone with zero rollover", () => {
    const settings = weeknightSettings("America/Los_Angeles");
    // Oct 29 2026 23:59 PDT = Oct 30 2026 06:59 UTC
    const beforeMidnight = Date.parse("2026-10-30T06:59:00Z");
    // Oct 30 2026 00:01 PDT = Oct 30 2026 07:01 UTC
    const afterMidnight = Date.parse("2026-10-30T07:01:00Z");

    expect(localDay(beforeMidnight, "America/Los_Angeles")).toBe("2026-10-29");
    expect(localDay(afterMidnight, "America/Los_Angeles")).toBe("2026-10-30");

    let ledger = recordMissionCompletions(null, settings, beforeMidnight, [
      "lab1.measure",
      "garden.bridge",
    ]).ledger;
    ledger = { ...ledger, usedSeconds: 300, extraParentMinutes: 5 };
    // Unused minutes on Oct 29 do NOT carry over into Oct 30
    const nextDayStatus = evaluatePlayTime(afterMidnight, settings, ledger);
    expect(nextDayStatus).toMatchObject({
      day: "2026-10-30",
      usedSeconds: 0,
      earnedMinutes: 0,
      extraParentMinutes: 0,
      dailyCapMinutes: 20,
      completedCount: 0,
      dailyRemainingSeconds: 20 * 60,
    });

    // Also handles UTC+13 (Pacific/Auckland) date boundary cleanly
    expect(localDay(Date.parse("2026-10-30T11:30:00Z"), "Pacific/Auckland")).toBe(
      "2026-10-31",
    );
  });

  it("enforces sitting caps, parent +5m grace, sitting reset, and overnight quiet hours", () => {
    const settings: ParentSettings = {
      ...weeknightSettings("America/Los_Angeles"),
      sessionLimitMinutes: 15,
      quietHours: { enabled: true, start: "19:30", end: "07:00" },
    };

    // 14:00 PDT (21:00 UTC) -> outside quiet hours
    const afternoon = Date.parse("2026-10-30T21:00:00Z");
    expect(isInQuietHours(afternoon, settings.timezone, settings.quietHours)).toBe(false);

    let ledger = {
      ...emptyLedgerForDay(localDay(afternoon, settings.timezone)),
      usedSeconds: 900,
      sessionUsedSeconds: 900,
    };
    expect(evaluatePlayTime(afternoon, settings, ledger)).toMatchObject({
      locked: true,
      reason: "session_limit",
      dailyRemainingSeconds: 300,
      sessionRemainingSeconds: 0,
    });

    // Parent resets sitting timer -> unlocks remaining daily allowance
    const reset = applyParentAction(ledger, settings, afternoon, "reset_session");
    expect(evaluatePlayTime(afternoon, settings, reset)).toMatchObject({
      locked: false,
      sessionRemainingSeconds: 900,
      dailyRemainingSeconds: 300,
    });

    // Parent grants +5m when daily limit is reached -> adds 5m extraParentMinutes
    const maxedDaily = { ...ledger, usedSeconds: 1200, sessionUsedSeconds: 900 };
    const granted = applyParentAction(
      maxedDaily,
      settings,
      afternoon,
      "grant_five_minutes",
    );
    expect(evaluatePlayTime(afternoon, settings, granted)).toMatchObject({
      locked: false,
      extraParentMinutes: 5,
      remainingSeconds: 300,
    });

    // 20:15 PDT (03:15 UTC next day) -> inside overnight quiet hours
    const night = Date.parse("2026-10-31T03:15:00Z");
    expect(isInQuietHours(night, settings.timezone, settings.quietHours)).toBe(true);
    expect(evaluatePlayTime(night, settings, granted)).toMatchObject({
      locked: true,
      reason: "quiet_hours",
      remainingSeconds: 0,
    });
    // Heartbeats during quiet hours do not consume daily allowance
    expect(recordActivePlay(granted, settings, night, 30).usedSeconds).toBe(
      granted.usedSeconds,
    );
  });

  it("validates settings payloads and rejects out-of-range values", () => {
    const base = defaultParentSettings("UTC");
    expect(
      validateAndMergeParentSettings(base, {
        dailyBaseMinutes: 40,
        dailyLimitMinutes: 30,
      }).ok,
    ).toBe(false);
    expect(
      validateAndMergeParentSettings(base, { timezone: "Mars/Olympus_Mons" }).ok,
    ).toBe(false);
    expect(
      validateAndMergeParentSettings(base, {
        quietHours: { enabled: true, start: "25:99", end: "07:00" },
      }).ok,
    ).toBe(false);
    expect(validateAndMergeParentSettings(base, { pin: "12ab" }).ok).toBe(false);
  });
});

describe("/api/parent/* Cloudflare Worker routes", () => {
  it("returns 501 without D1 and 400 on invalid x-device-id", async () => {
    const noDb = await callParent({}, "/api/parent/time");
    expect(noDb.status).toBe(501);

    const badDevice = await worker.fetch(
      new Request("http://local/api/parent/time", {
        headers: { "x-device-id": "../bad" },
      }),
      { DB: fakeParentDb() } as never,
    );
    expect(badDevice.status).toBe(400);
  });

  it("self-bootstraps missing tables on a fresh local D1", async () => {
    let bootstrapped = false;
    const inner = fakeParentDb();
    const unmigrated: D1Like = {
      prepare: (sql) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            if (sql.startsWith("CREATE TABLE")) {
              bootstrapped = true;
              return {};
            }
            if (sql.startsWith("CREATE INDEX")) return {};
            if (!bootstrapped) {
              throw new Error("D1_ERROR: no such table: parent_settings: SQLITE_ERROR");
            }
            return inner.prepare(sql).bind(...values).run();
          },
          all: async () => {
            if (!bootstrapped) {
              throw new Error("D1_ERROR: no such table: parent_settings: SQLITE_ERROR");
            }
            return inner.prepare(sql).bind(...values).all();
          },
        }),
      }),
    };

    const res = await callParent({ DB: unmigrated }, "/api/parent/time");
    expect(res.status).toBe(200);
    expect(bootstrapped).toBe(true);
    const body = (await res.json()) as { persisted: boolean; settings: { timezone: string } };
    expect(body.persisted).toBe(false);
    expect(body.settings.timezone).toBe("America/Los_Angeles");
  });

  it("requires HMAC x-parent-proof for settings writes, PIN lifecycle, and +5m override", async () => {
    const env = { DB: fakeParentDb(), PARENT_GATE_SECRET: "unit-test-secret-key" };

    // Unauthenticated PUT /api/parent/settings -> 403
    const unauthPut = await callParent(env, "/api/parent/settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(unauthPut.status).toBe(403);

    // Unauthenticated +5m override -> 403
    const unauthGrant = await callParent(env, "/api/parent/time", {
      method: "POST",
      body: JSON.stringify({ parentAction: "grant_five_minutes" }),
    });
    expect(unauthGrant.status).toBe(403);

    // 1. Request STEM math challenge
    const chRes = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({ action: "challenge" }),
    });
    expect(chRes.status).toBe(200);
    const ch = (await chRes.json()) as {
      mode: string;
      a: number;
      b: number;
      challengeToken: string;
    };
    expect(ch.mode).toBe("math");

    // Wrong math answer -> 403
    const wrong = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({
        action: "verify",
        challengeToken: ch.challengeToken,
        answer: ch.a * ch.b + 1,
      }),
    });
    expect(wrong.status).toBe(403);

    // Correct math answer -> proofToken
    const okVerify = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({
        action: "verify",
        challengeToken: ch.challengeToken,
        answer: ch.a * ch.b,
      }),
    });
    expect(okVerify.status).toBe(200);
    const { proofToken } = (await okVerify.json()) as { proofToken: string };

    // Proof token is bound to DEVICE_A; DEVICE_B cannot replay it
    const crossPlayer = await callParent(
      env,
      "/api/parent/settings",
      {
        method: "PUT",
        headers: { "x-parent-proof": proofToken },
        body: JSON.stringify({ enabled: true }),
      },
      DEVICE_B,
    );
    expect(crossPlayer.status).toBe(403);

    // Save Weeknight preset + 4-digit PIN for DEVICE_A
    const saveRes = await callParent(env, "/api/parent/settings", {
      method: "PUT",
      headers: { "x-parent-proof": proofToken },
      body: JSON.stringify({
        enabled: true,
        dailyBaseMinutes: 20,
        dailyLimitMinutes: 30,
        minutesPerChallenge: 5,
        pin: "2580",
      }),
    });
    expect(saveRes.status).toBe(200);
    const savedBody = (await saveRes.json()) as {
      settings: Record<string, unknown>;
    };
    expect(savedBody.settings.pinSet).toBe(true);
    expect(savedBody.settings.pinHash).toBeUndefined();

    // Next gate challenge switches to PIN mode and verifies 2580
    const pinChRes = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({ action: "challenge" }),
    });
    const pinCh = (await pinChRes.json()) as { mode: string };
    expect(pinCh.mode).toBe("pin");

    const badPin = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({ action: "verify", pin: "0000" }),
    });
    expect(badPin.status).toBe(403);

    const goodPin = await callParent(env, "/api/parent/gate", {
      method: "POST",
      body: JSON.stringify({ action: "verify", pin: "2580" }),
    });
    expect(goodPin.status).toBe(200);

    // Record active play + STEM mission completion, then parent +5m override
    const playRes = await callParent(env, "/api/parent/time", {
      method: "POST",
      body: JSON.stringify({
        activeSecondsDelta: 60,
        minUsedSeconds: 1200,
        completedMissionIds: ["lab1.measure"],
      }),
    });
    expect(playRes.status).toBe(200);
    const playBody = (await playRes.json()) as {
      awardedMinutes: number;
      ledger: { usedSeconds: number; earnedMinutes: number };
      status: { dailyCapMinutes: number; remainingSeconds: number };
    };
    expect(playBody.awardedMinutes).toBe(5);
    expect(playBody.ledger.usedSeconds).toBe(1200);
    expect(playBody.status.dailyCapMinutes).toBe(25);
    expect(playBody.status.remainingSeconds).toBe(300);

    const grantRes = await callParent(env, "/api/parent/time", {
      method: "POST",
      headers: { "x-parent-proof": proofToken },
      body: JSON.stringify({ parentAction: "grant_five_minutes" }),
    });
    expect(grantRes.status).toBe(200);
    const grantBody = (await grantRes.json()) as {
      status: { extraParentMinutes: number; remainingSeconds: number };
    };
    expect(grantBody.status.extraParentMinutes).toBe(5);
    expect(grantBody.status.remainingSeconds).toBe(600);

    // DEVICE_B remains completely isolated
    const otherRes = await callParent(env, "/api/parent/time", {}, DEVICE_B);
    const otherBody = (await otherRes.json()) as {
      settings: { enabled: boolean };
      ledger: { usedSeconds: number };
    };
    expect(otherBody.settings.enabled).toBe(false);
    expect(otherBody.ledger.usedSeconds).toBe(0);
  });

  it("enforces 5-tries / 30s PIN cooldown on worker verify and allows Forgot-PIN math reset", async () => {
    vi.useFakeTimers();
    try {
      const startMs = Date.parse("2026-04-17T18:00:00Z");
      vi.setSystemTime(startMs);
      const env = { DB: fakeParentDb(), PARENT_GATE_SECRET: "unit-test-secret" };

      const chRes = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "challenge" }),
      });
      const ch = (await chRes.json()) as {
        a: number;
        b: number;
        challengeToken: string;
      };
      const okMath = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          challengeToken: ch.challengeToken,
          answer: ch.a * ch.b,
        }),
      });
      const { proofToken } = (await okMath.json()) as { proofToken: string };

      await callParent(env, "/api/parent/settings", {
        method: "PUT",
        headers: { "x-parent-proof": proofToken },
        body: JSON.stringify({ pin: "1357" }),
      });

      // Tries 1..4 return 403 with decreasing attemptsRemaining
      for (let attempt = 1; attempt < PIN_MAX_ATTEMPTS; attempt++) {
        const bad = await callParent(env, "/api/parent/gate", {
          method: "POST",
          body: JSON.stringify({ action: "verify", pin: "0000" }),
        });
        expect(bad.status).toBe(403);
        const body = (await bad.json()) as { attemptsRemaining: number };
        expect(body.attemptsRemaining).toBe(PIN_MAX_ATTEMPTS - attempt);
      }

      // 5th failed try triggers 429 + 30s cooldown
      const fifth = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "verify", pin: "9999" }),
      });
      expect(fifth.status).toBe(429);
      expect(fifth.headers.get("retry-after")).toBe("30");
      const fifthBody = (await fifth.json()) as {
        error: string;
        cooldownUntil: number;
        retryAfterSeconds: number;
        attemptsRemaining: number;
      };
      expect(fifthBody.error).toBe("pin_cooldown");
      expect(fifthBody.cooldownUntil).toBe(startMs + PIN_COOLDOWN_MS);
      expect(fifthBody.retryAfterSeconds).toBe(30);
      expect(fifthBody.attemptsRemaining).toBe(0);

      // Even the RIGHT PIN is rejected during the 30s cooldown window
      vi.setSystemTime(startMs + 12_000);
      const blockedRightPin = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "verify", pin: "1357" }),
      });
      expect(blockedRightPin.status).toBe(429);

      // After 30s, the right PIN succeeds again
      vi.setSystemTime(startMs + PIN_COOLDOWN_MS + 100);
      const afterCooldown = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "verify", pin: "1357" }),
      });
      expect(afterCooldown.status).toBe(200);

      // Trigger cooldown again and verify Forgot-PIN math recovery resets PIN + cooldown
      for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
        await callParent(env, "/api/parent/gate", {
          method: "POST",
          body: JSON.stringify({ action: "verify", pin: "1111" }),
        });
      }
      const recoveryChRes = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "challenge" }),
      });
      const recoveryCh = (await recoveryChRes.json()) as {
        a: number;
        b: number;
        challengeToken: string;
        cooldownUntil: number | null;
      };
      expect(recoveryCh.cooldownUntil).toBeGreaterThan(Date.now());

      const recoveryVerify = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          challengeToken: recoveryCh.challengeToken,
          answer: recoveryCh.a * recoveryCh.b,
        }),
      });
      expect(recoveryVerify.status).toBe(200);
      const { proofToken: recoveryProof } = (await recoveryVerify.json()) as {
        proofToken: string;
      };

      const resetPinRes = await callParent(env, "/api/parent/settings", {
        method: "PUT",
        headers: { "x-parent-proof": recoveryProof },
        body: JSON.stringify({ pin: "2468" }),
      });
      expect(resetPinRes.status).toBe(200);

      // New PIN works immediately with cooldown cleared
      const unlockedNew = await callParent(env, "/api/parent/gate", {
        method: "POST",
        body: JSON.stringify({ action: "verify", pin: "2468" }),
      });
      expect(unlockedNew.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("offline local-verify PIN lockout (airplane-mode parity)", () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;

  function makeMemoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => {
        map.delete(k);
      },
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
  });

  it("evaluates pure PIN state machine across 5 failures and 30s cooldown", () => {
    let settings = defaultParentSettings("UTC");
    const t0 = 1_700_000_000_000;
    for (let i = 1; i <= 4; i++) {
      const r = evaluatePinAttempt(settings, t0, false);
      expect(r.status).toBe("mismatch");
      if (r.status === "mismatch") expect(r.attemptsRemaining).toBe(5 - i);
      settings = r.settings;
    }
    const fifth = evaluatePinAttempt(settings, t0, false);
    expect(fifth.status).toBe("cooldown");
    if (fifth.status === "cooldown") {
      expect(fifth.cooldownUntil).toBe(t0 + PIN_COOLDOWN_MS);
      expect(fifth.retryAfterSeconds).toBe(30);
    }
    // Right PIN during cooldown still stays in cooldown
    const during = evaluatePinAttempt(fifth.settings, t0 + 5_000, true);
    expect(during.status).toBe("cooldown");
    // Right PIN after 30s clears cooldown
    const after = evaluatePinAttempt(fifth.settings, t0 + 30_000, true);
    expect(after.status).toBe("ok");
    expect(after.settings.pinFailedAttempts).toBe(0);
    expect(after.settings.pinCooldownUntil).toBeNull();
  });

  it("triggers 30s cooldown locally in airplane mode, persists across reload, and blocks server->offline bypass", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-04-17T19:00:00Z");
    vi.setSystemTime(t0);

    const memStorage = makeMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: memStorage,
      configurable: true,
      writable: true,
    });

    // Airplane mode: every network request rejects with TypeError("Failed to fetch").
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    // 1. Bootstrap setup offline + save 4-tap PIN "2580"
    const bootChallenge = await requestGateChallenge(t0);
    expect(bootChallenge.challengeToken).toBe("local");
    expect(bootChallenge.mode).toBe("math");

    const bootVerify = await verifyGateAnswer({
      challenge: bootChallenge,
      answer: bootChallenge.a * bootChallenge.b,
    });
    expect(bootVerify.ok).toBe(true);
    if (!bootVerify.ok) throw new Error("expected bootstrap verify");

    const saved = await updateParentSettings(
      { pin: "2580" },
      bootVerify.session.proofToken,
    );
    expect(saved.ok).toBe(true);

    // 2. Re-open gate in airplane mode -> PIN challenge
    const pinChallenge = await requestGateChallenge(t0);
    expect(pinChallenge.challengeToken).toBe("local");
    expect(pinChallenge.mode).toBe("pin");
    expect(pinChallenge.cooldownUntil).toBeNull();

    // 3. Tries 1..4 fail locally with attemptsRemaining 4..1
    for (let i = 1; i <= 4; i++) {
      const attempt = await verifyGateAnswer({
        challenge: pinChallenge,
        pin: `000${i}`,
      });
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) {
        expect(attempt.attemptsRemaining).toBe(5 - i);
        expect(attempt.cooldownUntil).toBeUndefined();
      }
    }

    // 4. 5th failed try triggers local 30s cooldown
    const fifth = await verifyGateAnswer({
      challenge: pinChallenge,
      pin: "9999",
    });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.attemptsRemaining).toBe(0);
      expect(fifth.retryAfterSeconds).toBe(30);
      expect(fifth.cooldownUntil).toBe(t0 + PIN_COOLDOWN_MS);
    }

    // 5. Simulate page reload 10s later while still offline: localStorage preserves deadline
    vi.setSystemTime(t0 + 10_000);
    expect(getLocalPinCooldownUntil()).toBe(t0 + PIN_COOLDOWN_MS);
    const reloadedChallenge = await requestGateChallenge();
    expect(reloadedChallenge.cooldownUntil).toBe(t0 + PIN_COOLDOWN_MS);

    // Even the CORRECT PIN ("2580") is blocked locally during cooldown!
    const blockedRightPin = await verifyGateAnswer({
      challenge: reloadedChallenge,
      pin: "2580",
    });
    expect(blockedRightPin.ok).toBe(false);
    if (!blockedRightPin.ok) {
      expect(blockedRightPin.retryAfterSeconds).toBe(20);
      expect(blockedRightPin.cooldownUntil).toBe(t0 + PIN_COOLDOWN_MS);
    }

    // 6. Advance past 30s -> local cooldown expires and correct PIN unlocks
    vi.setSystemTime(t0 + PIN_COOLDOWN_MS + 50);
    expect(getLocalPinCooldownUntil()).toBeNull();
    const unlocked = await verifyGateAnswer({
      challenge: await requestGateChallenge(),
      pin: "2580",
    });
    expect(unlocked.ok).toBe(true);

    // 7. Server -> airplane-mode handoff: 4 online 403s + 1 offline try immediately triggers 30s cooldown
    const t2 = t0 + 120_000;
    vi.setSystemTime(t2);
    let onlineTry = 0;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { action?: string }) : {};
      if (body.action === "challenge") {
        return new Response(
          JSON.stringify({
            mode: "pin",
            pinSet: true,
            a: 4,
            b: 6,
            challengeToken: "srv-token",
            cooldownUntil: null,
          }),
          { status: 200 },
        );
      }
      onlineTry += 1;
      return new Response(
        JSON.stringify({ ok: false, attemptsRemaining: PIN_MAX_ATTEMPTS - onlineTry }),
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    const srvCh = await requestGateChallenge(t2);
    for (let i = 1; i <= 4; i++) {
      const r = await verifyGateAnswer({ challenge: srvCh, pin: "0000" });
      expect(r.ok).toBe(false);
    }

    // Kid flips on airplane mode before the 5th try — still hits the 30s cooldown on try #5!
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const offlineFifth = await verifyGateAnswer({ challenge: srvCh, pin: "0000" });
    expect(offlineFifth.ok).toBe(false);
    if (!offlineFifth.ok) {
      expect(offlineFifth.attemptsRemaining).toBe(0);
      expect(offlineFifth.cooldownUntil).toBe(t2 + PIN_COOLDOWN_MS);
    }
  });
});
