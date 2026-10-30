import { describe, expect, it } from "vitest";
import {
  MAX_HEARTBEAT_SECONDS,
  PARENT_PRESETS,
  applyParentAction,
  defaultParentSettings,
  emptyLedgerForDay,
  evaluatePlayTime,
  isInQuietHours,
  localDay,
  recordActivePlay,
  recordMissionCompletions,
  validateAndMergeParentSettings,
  type ParentSettings,
} from "../shared/parent-time";
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
});
