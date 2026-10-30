// Parent Time Gates & STEM Earned-Time API backed by D1.
// Settings writes and parent grace overrides require a short-lived HMAC-signed
// `x-parent-proof` token issued after solving the 2-digit STEM math or PIN gate.
import { isPlayerId } from "../shared/ownership";
import {
  activePinCooldownUntil,
  applyParentAction,
  defaultParentSettings,
  emptyLedgerForDay,
  evaluatePinAttempt,
  evaluatePlayTime,
  isValidPin,
  isValidTimeZone,
  localDay,
  normalizeLedgerForNow,
  recordActivePlay,
  recordMissionCompletions,
  sanitizeParentSettings,
  validateAndMergeParentSettings,
  type ParentSettings,
  type ParentTimeAction,
  type TimeLedgerRow,
} from "../shared/parent-time";
import type { D1Like, OwnershipEnv } from "./ownership";

export interface ParentEnv extends OwnershipEnv {
  PARENT_GATE_SECRET?: string;
  MODEL_API_KEY?: string;
}

const MAX_PARENT_BYTES = 16_384;
const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const PROOF_EVERY_TIME_TTL_MS = 2 * 60 * 1000;
const PROOF_SITTING_TTL_MS = 5 * 60 * 1000;
const SYSTEM_SEED_PLAYER_ID = "__gate_hmac_seed__";

const CREATE_PARENT_SETTINGS_SQL =
  "CREATE TABLE IF NOT EXISTS parent_settings (" +
  "player_id TEXT PRIMARY KEY, " +
  "settings_json TEXT NOT NULL, " +
  "updated_at TEXT NOT NULL DEFAULT (datetime('now')))";

const CREATE_TIME_LEDGER_SQL =
  "CREATE TABLE IF NOT EXISTS time_ledger (" +
  "player_id TEXT NOT NULL, " +
  "day TEXT NOT NULL, " +
  "used_seconds INTEGER NOT NULL DEFAULT 0, " +
  "earned_minutes INTEGER NOT NULL DEFAULT 0, " +
  "extra_parent_minutes INTEGER NOT NULL DEFAULT 0, " +
  "session_used_seconds INTEGER NOT NULL DEFAULT 0, " +
  "completed_ids TEXT NOT NULL DEFAULT '[]', " +
  "updated_at TEXT NOT NULL DEFAULT (datetime('now')), " +
  "PRIMARY KEY (player_id, day))";

const CREATE_TIME_LEDGER_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_time_ledger_player ON time_ledger (player_id)";

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function isMissingParentTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such table:\s*(parent_settings|time_ledger)/i.test(msg);
}

async function withParentTables<T>(db: D1Like, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isMissingParentTable(err)) throw err;
    await db.prepare(CREATE_PARENT_SETTINGS_SQL).bind().run();
    await db.prepare(CREATE_TIME_LEDGER_SQL).bind().run();
    await db.prepare(CREATE_TIME_LEDGER_INDEX_SQL).bind().run();
    console.log(JSON.stringify({ event: "parent_time_bootstrap", status: "created" }));
    return await op();
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    let padded = input.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4 !== 0) padded += "=";
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomIntInclusive(min: number, max: number): number {
  const span = max - min + 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0]! % span);
}

async function hashPin(playerId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`toyventor-pin:v1:${playerId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

async function resolveHmacKey(env: ParentEnv, db: D1Like): Promise<CryptoKey> {
  let rawSecret = env.PARENT_GATE_SECRET || env.MODEL_API_KEY || "";
  if (!rawSecret) {
    const existing = await withParentTables(db, () =>
      db
        .prepare("SELECT settings_json FROM parent_settings WHERE player_id = ?")
        .bind(SYSTEM_SEED_PLAYER_ID)
        .all(),
    );
    const stored = existing.results[0]?.settings_json;
    if (typeof stored === "string" && stored.length >= 32) {
      rawSecret = stored;
    } else {
      const rand = new Uint8Array(32);
      crypto.getRandomValues(rand);
      rawSecret = bytesToHex(rand);
      await withParentTables(db, () =>
        db
          .prepare(
            "INSERT INTO parent_settings (player_id, settings_json, updated_at) VALUES (?, ?, datetime('now')) " +
              "ON CONFLICT(player_id) DO NOTHING",
          )
          .bind(SYSTEM_SEED_PLAYER_ID, rawSecret)
          .run(),
      );
      const reread = await withParentTables(db, () =>
        db
          .prepare("SELECT settings_json FROM parent_settings WHERE player_id = ?")
          .bind(SYSTEM_SEED_PLAYER_ID)
          .all(),
      );
      if (typeof reread.results[0]?.settings_json === "string") {
        rawSecret = reread.results[0].settings_json;
      }
    }
  }
  const keyBytes = new TextEncoder().encode(`toyventor-parent-hmac:v1:${rawSecret}`);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(key: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(sig))}`;
}

async function verifySignedPayload<T extends { exp?: number }>(
  key: CryptoKey,
  token: string | null | undefined,
  nowMs: number,
): Promise<T | null> {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const encodedPayload = token.slice(0, dot);
  const sigBytes = fromBase64Url(token.slice(dot + 1));
  if (!sigBytes) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid) return null;

  const payloadBytes = fromBase64Url(encodedPayload);
  if (!payloadBytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as T;
    if (typeof parsed.exp !== "number" || parsed.exp < nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readSettings(
  db: D1Like,
  playerId: string,
  fallbackTz = "UTC",
): Promise<{ settings: ParentSettings; persisted: boolean }> {
  const defaultTz = isValidTimeZone(fallbackTz) ? fallbackTz : "UTC";
  const { results } = await withParentTables(db, () =>
    db
      .prepare("SELECT settings_json FROM parent_settings WHERE player_id = ?")
      .bind(playerId)
      .all(),
  );
  const raw = results[0]?.settings_json;
  if (typeof raw !== "string") {
    return { settings: defaultParentSettings(defaultTz), persisted: false };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ParentSettings>;
    const base = defaultParentSettings(parsed.timezone ?? defaultTz);
    const merged = validateAndMergeParentSettings(base, parsed);
    if (!merged.ok) return { settings: base, persisted: true };
    return {
      settings: {
        ...merged.settings,
        pinHash: typeof parsed.pinHash === "string" ? parsed.pinHash : null,
        pinFailedAttempts: Math.max(0, Math.floor(Number(parsed.pinFailedAttempts) || 0)),
        pinCooldownUntil:
          typeof parsed.pinCooldownUntil === "number" &&
          Number.isFinite(parsed.pinCooldownUntil)
            ? parsed.pinCooldownUntil
            : null,
      },
      persisted: true,
    };
  } catch {
    return { settings: defaultParentSettings(defaultTz), persisted: false };
  }
}

async function writeSettings(
  db: D1Like,
  playerId: string,
  settings: ParentSettings,
): Promise<void> {
  await withParentTables(db, () =>
    db
      .prepare(
        "INSERT INTO parent_settings (player_id, settings_json, updated_at) VALUES (?, ?, datetime('now')) " +
          "ON CONFLICT(player_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')",
      )
      .bind(playerId, JSON.stringify(settings))
      .run(),
  );
}

async function readLedger(
  db: D1Like,
  playerId: string,
  settings: ParentSettings,
  nowMs: number,
): Promise<TimeLedgerRow> {
  const today = localDay(nowMs, settings.timezone);
  const { results } = await withParentTables(db, () =>
    db
      .prepare(
        "SELECT day, used_seconds, earned_minutes, extra_parent_minutes, session_used_seconds, completed_ids " +
          "FROM time_ledger WHERE player_id = ? AND day = ?",
      )
      .bind(playerId, today)
      .all(),
  );
  const row = results[0];
  if (!row) return emptyLedgerForDay(today);
  let completedIds: string[] = [];
  try {
    const parsed = typeof row.completed_ids === "string" ? JSON.parse(row.completed_ids) : [];
    if (Array.isArray(parsed)) completedIds = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    completedIds = [];
  }
  return normalizeLedgerForNow(
    {
      day: String(row.day ?? today),
      usedSeconds: Number(row.used_seconds ?? 0),
      earnedMinutes: Number(row.earned_minutes ?? 0),
      extraParentMinutes: Number(row.extra_parent_minutes ?? 0),
      sessionUsedSeconds: Number(row.session_used_seconds ?? 0),
      completedIds,
    },
    settings,
    nowMs,
  );
}

async function writeLedger(
  db: D1Like,
  playerId: string,
  ledger: TimeLedgerRow,
): Promise<void> {
  await withParentTables(db, () =>
    db
      .prepare(
        "INSERT INTO time_ledger " +
          "(player_id, day, used_seconds, earned_minutes, extra_parent_minutes, session_used_seconds, completed_ids, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) " +
          "ON CONFLICT(player_id, day) DO UPDATE SET " +
          "used_seconds = excluded.used_seconds, " +
          "earned_minutes = excluded.earned_minutes, " +
          "extra_parent_minutes = excluded.extra_parent_minutes, " +
          "session_used_seconds = excluded.session_used_seconds, " +
          "completed_ids = excluded.completed_ids, " +
          "updated_at = datetime('now')",
      )
      .bind(
        playerId,
        ledger.day,
        ledger.usedSeconds,
        ledger.earnedMinutes,
        ledger.extraParentMinutes,
        ledger.sessionUsedSeconds,
        JSON.stringify(ledger.completedIds),
      )
      .run(),
  );
}

async function parseJsonBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PARENT_BYTES) {
    return { ok: false, response: json({ error: "payload too large" }, 413) };
  }
  try {
    const raw = await request.text();
    if (raw.length > MAX_PARENT_BYTES) {
      return { ok: false, response: json({ error: "payload too large" }, 413) };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, response: json({ error: "JSON object expected" }, 400) };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ error: "invalid JSON body" }, 400) };
  }
}

interface ChallengeTokenPayload {
  kind: "challenge";
  playerId: string;
  answer: number;
  exp: number;
}

interface ProofTokenPayload {
  kind: "proof";
  playerId: string;
  exp: number;
}

async function requireParentProof(
  request: Request,
  key: CryptoKey,
  playerId: string,
  nowMs: number,
): Promise<boolean> {
  const token = request.headers.get("x-parent-proof");
  const verified = await verifySignedPayload<ProofTokenPayload>(key, token, nowMs);
  return Boolean(
    verified && verified.kind === "proof" && verified.playerId === playerId,
  );
}

export async function handleParent(
  request: Request,
  env: ParentEnv,
  rest: string,
  nowMs = Date.now(),
): Promise<Response> {
  if (!env.DB) {
    return json({ error: "parent store not bound", mode: "local-only" }, 501);
  }
  const playerId = request.headers.get("x-device-id");
  if (!isPlayerId(playerId)) {
    return json({ error: "missing or invalid x-device-id" }, 400);
  }
  const db = env.DB;
  const fallbackTz = request.headers.get("x-client-timezone") ?? "UTC";

  try {
    if (rest === "/gate" && request.method === "POST") {
      const parsed = await parseJsonBody(request);
      if (!parsed.ok) return parsed.response;
      const { body } = parsed;
      const { settings } = await readSettings(db, playerId, fallbackTz);
      const key = await resolveHmacKey(env, db);

      if (body.action === "challenge") {
        const a = randomIntInclusive(12, 19);
        const b = randomIntInclusive(4, 9);
        const challengeToken = await signPayload(key, {
          kind: "challenge",
          playerId,
          answer: a * b,
          exp: nowMs + CHALLENGE_TTL_MS,
        } satisfies ChallengeTokenPayload);

        return json({
          mode: settings.pinHash ? "pin" : "math",
          pinSet: Boolean(settings.pinHash),
          a,
          b,
          challengeToken,
          cooldownUntil: activePinCooldownUntil(settings, nowMs),
        });
      }

      if (body.action === "verify") {
        let verified = false;
        if (typeof body.pin === "string") {
          const activeUntil = activePinCooldownUntil(settings, nowMs);
          if (activeUntil !== null) {
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil((activeUntil - nowMs) / 1000),
            );
            return json(
              {
                ok: false,
                error: "pin_cooldown",
                cooldownUntil: activeUntil,
                retryAfterSeconds,
                attemptsRemaining: 0,
              },
              429,
              { "retry-after": String(retryAfterSeconds) },
            );
          }

          if (settings.pinHash && isValidPin(body.pin)) {
            const candidateHash = await hashPin(playerId, body.pin);
            const expectedBytes = new TextEncoder().encode(settings.pinHash);
            const candidateBytes = new TextEncoder().encode(candidateHash);
            if (expectedBytes.length === candidateBytes.length) {
              // Compare via HMAC over both digests to avoid timing leaks.
              const expectedMac = await crypto.subtle.sign("HMAC", key, expectedBytes);
              verified = await crypto.subtle.verify(
                "HMAC",
                key,
                expectedMac,
                candidateBytes,
              );
            }
          }

          const outcome = evaluatePinAttempt(settings, nowMs, verified);
          if (
            outcome.settings.pinFailedAttempts !== (settings.pinFailedAttempts ?? 0) ||
            outcome.settings.pinCooldownUntil !== (settings.pinCooldownUntil ?? null)
          ) {
            await writeSettings(db, playerId, outcome.settings);
          }

          if (outcome.status === "cooldown") {
            console.log(
              JSON.stringify({ event: "parent_gate", status: "pin_cooldown" }),
            );
            return json(
              {
                ok: false,
                error: "pin_cooldown",
                cooldownUntil: outcome.cooldownUntil,
                retryAfterSeconds: outcome.retryAfterSeconds,
                attemptsRemaining: 0,
              },
              429,
              { "retry-after": String(outcome.retryAfterSeconds) },
            );
          }

          if (outcome.status === "mismatch") {
            return json(
              {
                ok: false,
                error: "incorrect answer",
                attemptsRemaining: outcome.attemptsRemaining,
              },
              403,
            );
          }
        } else if (typeof body.challengeToken === "string") {
          const challenge = await verifySignedPayload<ChallengeTokenPayload>(
            key,
            body.challengeToken,
            nowMs,
          );
          const numericAnswer = Number(body.answer);
          if (
            challenge &&
            challenge.kind === "challenge" &&
            challenge.playerId === playerId &&
            Number.isInteger(numericAnswer) &&
            numericAnswer === challenge.answer
          ) {
            verified = true;
          }
        }

        if (!verified) {
          return json({ ok: false, error: "incorrect answer" }, 403);
        }

        const ttl =
          settings.gateStrictness === "sitting_window"
            ? PROOF_SITTING_TTL_MS
            : PROOF_EVERY_TIME_TTL_MS;
        const expiresAt = nowMs + ttl;
        const proofToken = await signPayload(key, {
          kind: "proof",
          playerId,
          exp: expiresAt,
        } satisfies ProofTokenPayload);

        console.log(JSON.stringify({ event: "parent_gate", status: "verified" }));
        return json({ ok: true, proofToken, expiresAt });
      }

      return json({ error: "expected action 'challenge' or 'verify'" }, 422);
    }

    if (rest === "/settings") {
      if (request.method === "GET") {
        const { settings, persisted } = await readSettings(db, playerId, fallbackTz);
        return json({ settings: sanitizeParentSettings(settings), persisted });
      }

      if (request.method === "PUT") {
        const key = await resolveHmacKey(env, db);
        if (!(await requireParentProof(request, key, playerId, nowMs))) {
          return json({ error: "parent gate required" }, 403);
        }
        const parsed = await parseJsonBody(request);
        if (!parsed.ok) return parsed.response;

        const { settings: current } = await readSettings(db, playerId, fallbackTz);
        const merged = validateAndMergeParentSettings(current, parsed.body);
        if (!merged.ok) {
          return json({ error: "invalid settings", errors: merged.errors }, 422);
        }

        let pinHash = current.pinHash ?? null;
        if (merged.newPin === "clear") {
          pinHash = null;
        } else if (typeof merged.newPin === "string") {
          pinHash = await hashPin(playerId, merged.newPin);
        }

        const nextSettings: ParentSettings = {
          ...merged.settings,
          pinHash,
        };
        await writeSettings(db, playerId, nextSettings);

        // Re-normalize today's ledger if dailyLimitMinutes tightened earned headroom.
        const ledger = await readLedger(db, playerId, nextSettings, nowMs);
        await writeLedger(db, playerId, ledger);
        const status = evaluatePlayTime(nowMs, nextSettings, ledger);

        console.log(
          JSON.stringify({
            event: "parent_settings_put",
            enabled: nextSettings.enabled,
            dailyBaseMinutes: nextSettings.dailyBaseMinutes,
            dailyLimitMinutes: nextSettings.dailyLimitMinutes,
          }),
        );
        return json({
          ok: true,
          settings: sanitizeParentSettings(nextSettings),
          ledger,
          status,
        });
      }

      return json({ error: "method not allowed" }, 405);
    }

    if (rest === "/time") {
      const { settings, persisted } = await readSettings(db, playerId, fallbackTz);
      let ledger = await readLedger(db, playerId, settings, nowMs);

      if (request.method === "GET") {
        return json({
          persisted,
          settings: sanitizeParentSettings(settings),
          ledger,
          status: evaluatePlayTime(nowMs, settings, ledger),
        });
      }

      if (request.method === "POST") {
        const parsed = await parseJsonBody(request);
        if (!parsed.ok) return parsed.response;
        const { body } = parsed;

        if (body.parentAction !== undefined) {
          if (
            body.parentAction !== "grant_five_minutes" &&
            body.parentAction !== "reset_session"
          ) {
            return json({ error: "invalid parentAction" }, 422);
          }
          const key = await resolveHmacKey(env, db);
          if (!(await requireParentProof(request, key, playerId, nowMs))) {
            return json({ error: "parent gate required" }, 403);
          }
          ledger = applyParentAction(
            ledger,
            settings,
            nowMs,
            body.parentAction as ParentTimeAction,
          );
          await writeLedger(db, playerId, ledger);
          console.log(
            JSON.stringify({ event: "parent_time_override", action: body.parentAction }),
          );
          return json({
            ok: true,
            persisted,
            awardedMinutes: body.parentAction === "grant_five_minutes" ? 5 : 0,
            settings: sanitizeParentSettings(settings),
            ledger,
            status: evaluatePlayTime(nowMs, settings, ledger),
          });
        }

        let awardedMinutes = 0;
        if (typeof body.activeSecondsDelta === "number") {
          ledger = recordActivePlay(ledger, settings, nowMs, body.activeSecondsDelta);
        }
        // Monotonic offline catch-up: can only raise today's consumed seconds, never lower them.
        if (typeof body.minUsedSeconds === "number" && Number.isFinite(body.minUsedSeconds)) {
          const floorUsed = Math.min(86_400, Math.max(0, Math.floor(body.minUsedSeconds)));
          if (floorUsed > ledger.usedSeconds) {
            ledger = { ...ledger, usedSeconds: floorUsed };
          }
        }
        if (
          typeof body.minSessionUsedSeconds === "number" &&
          Number.isFinite(body.minSessionUsedSeconds)
        ) {
          const floorSess = Math.min(
            86_400,
            Math.max(0, Math.floor(body.minSessionUsedSeconds)),
          );
          if (floorSess > ledger.sessionUsedSeconds) {
            ledger = { ...ledger, sessionUsedSeconds: floorSess };
          }
        }
        if (Array.isArray(body.completedMissionIds)) {
          const ids = body.completedMissionIds.filter(
            (x): x is string => typeof x === "string",
          );
          const award = recordMissionCompletions(ledger, settings, nowMs, ids);
          ledger = award.ledger;
          awardedMinutes = award.awardedMinutes;
        }
        await writeLedger(db, playerId, ledger);

        return json({
          ok: true,
          persisted,
          awardedMinutes,
          settings: sanitizeParentSettings(settings),
          ledger,
          status: evaluatePlayTime(nowMs, settings, ledger),
        });
      }

      return json({ error: "method not allowed" }, 405);
    }

    return json({ error: "not found" }, 404);
  } catch {
    console.error(JSON.stringify({ event: "parent_time_error", status: "db-error" }));
    return json({ error: "parent store unavailable", mode: "local-only" }, 503);
  }
}
