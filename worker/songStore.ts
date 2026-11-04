// The song quota in D1: a thin copy of the pure rules in shared/songQuota.ts (docs/specs/dance-party-spec.md 4.6, D4 and D10).
//
// Every rule lives in shared/songQuota.ts and is tested there. This file only (1) loads the rows those rules need, (2) runs `reserve` / `commit` / `refund` on them, and
// (3) writes back what changed. It never decides anything itself: a slot, a week, a month and a budget are the pure code's answers.
//
//   reserveSong   take a slot BEFORE the paid call (idempotent on `key`); then count again in the database and give the slot back if two requests raced past the limit
//   attachSong    remember the provider's task id and the name and words on the reservation, so a retried tap gets the same song and only its owner can ask for its audio
//   commitSong    the song is finished and kept
//   refundSong    the call was refused or failed, or a grown-up removed the song
//   statusFor     what a child sees: pips left this week, and when they come back
//   ownerOfTask   which device a task belongs to (the audio relay answers only that device)
//   read/writeSongSettings   a grown-up's two choices: the maker on or off, and the daily limit 0 to 10 (the column is still `weekly_limit`: it holds the per-period limit, which is now a day's)
//
// The monthly budget is global and its rows are bounded by the budget itself (a month holds at most SONG_MONTHLY_BUDGET songs), so loading a month is small.
// A cleared device id starts a fresh week: the monthly budget is the real guard (4.6).
// Tables are created on first use when the migration (migrations/0003_songs.sql) has not been applied, like the parent tables.
import {
  commit,
  effectiveLimit,
  refund,
  reserve,
  songMakerOn,
  status,
  type QuotaConfig,
  type QuotaState,
  type QuotaStatus,
  type RefundReason,
  type Reservation,
  type ReserveDenied,
} from "../shared/songQuota";
import { weekKey } from "../shared/songQuota";

/** What this file needs of a D1 database (the real one has more). */
export interface SongDb {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      all: () => Promise<{ results: Record<string, unknown>[] }>;
    };
  };
}

const CREATE = [
  "CREATE TABLE IF NOT EXISTS song_reservations (key TEXT PRIMARY KEY, device_id TEXT NOT NULL, week_key TEXT NOT NULL, month_key TEXT NOT NULL, songs INTEGER NOT NULL, state TEXT NOT NULL, created_ms INTEGER NOT NULL, refund_reason TEXT, task TEXT, payload TEXT, stored INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_song_res_device_week ON song_reservations (device_id, week_key)",
  "CREATE INDEX IF NOT EXISTS idx_song_res_month ON song_reservations (month_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_song_res_task ON song_reservations (task) WHERE task IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS song_settings (device_id TEXT PRIMARY KEY, maker_on INTEGER, weekly_limit INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
];

const missingTable = (err: unknown) => /no such table:\s*song_(reservations|settings)/i.test(err instanceof Error ? err.message : String(err));

/** Run `op`; if the tables are not there yet, create them once and run it again. */
async function withTables<T>(db: SongDb, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!missingTable(err)) throw err;
    for (const sql of CREATE) await db.prepare(sql).bind().run();
    console.log(JSON.stringify({ event: "songs_bootstrap", status: "created" }));
    return await op();
  }
}

// ---- rows <-> reservations --------------------------------------------------------------------------------------------------

const ROW_COLUMNS = "key, device_id, week_key, month_key, songs, state, created_ms, refund_reason";

function toReservation(r: Record<string, unknown>): Reservation {
  const out: Reservation = {
    key: String(r.key),
    deviceId: String(r.device_id),
    weekKey: String(r.week_key),
    monthKey: String(r.month_key),
    songs: Number(r.songs),
    state: r.state as Reservation["state"],
    createdMs: Number(r.created_ms),
  };
  if (typeof r.refund_reason === "string") out.refundReason = r.refund_reason as RefundReason;
  return out;
}

async function loadSlice(db: SongDb, deviceId: string, week: string, month: string, key: string): Promise<QuotaState> {
  const { results } = await db
    .prepare(`SELECT ${ROW_COLUMNS} FROM song_reservations WHERE month_key = ? OR (device_id = ? AND week_key = ?) OR key = ?`)
    .bind(month, deviceId, week, key)
    .all();
  const reservations: Record<string, Reservation> = {};
  for (const r of results) reservations[String(r.key)] = toReservation(r);
  return { reservations };
}

async function writeRow(db: SongDb, r: Reservation): Promise<void> {
  await db
    .prepare(
      "INSERT INTO song_reservations (key, device_id, week_key, month_key, songs, state, created_ms, refund_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET state = excluded.state, refund_reason = excluded.refund_reason, songs = excluded.songs, week_key = excluded.week_key, month_key = excluded.month_key, created_ms = excluded.created_ms, " +
        // a FRESH attempt under an old key (the old one was refunded) must not inherit its task, words or stored flag
        "task = CASE WHEN excluded.state = 'reserved' THEN NULL ELSE task END, payload = CASE WHEN excluded.state = 'reserved' THEN NULL ELSE payload END, stored = CASE WHEN excluded.state = 'reserved' THEN 0 ELSE stored END",
    )
    .bind(r.key, r.deviceId, r.weekKey, r.monthKey, r.songs, r.state, r.createdMs, r.refundReason ?? null)
    .run();
}

/** Write every reservation that differs from the slice we loaded (a reserve can also expire stale ones and move a paid, refunded attempt to its own id). */
async function writeChanges(db: SongDb, before: QuotaState, after: QuotaState): Promise<void> {
  for (const [key, r] of Object.entries(after.reservations)) {
    const old = before.reservations[key];
    if (!old || old.state !== r.state || old.refundReason !== r.refundReason || old.weekKey !== r.weekKey || old.createdMs !== r.createdMs) await writeRow(db, r);
  }
}

// ---- settings ---------------------------------------------------------------------------------------------------------------

export interface SongSettings {
  /** Not set is on (Dan, 2026-11-03, D10); only a plain `true` or "not set" is on. */
  makerOn: boolean;
  /** 0 to 5; not set is 5. */
  limit: number;
}

export async function readSongSettings(db: SongDb, deviceId: string): Promise<SongSettings> {
  return withTables(db, async () => {
    const { results } = await db.prepare("SELECT maker_on, weekly_limit FROM song_settings WHERE device_id = ?").bind(deviceId).all();
    const row = results[0];
    if (!row) return { makerOn: true, limit: effectiveLimit(undefined) };
    // NULL means "not set"; a stored 0 or 1 is a choice. Anything else reads as off / 0: a corrupt setting must not open more than a chosen one would.
    const makerOn = row.maker_on === null || row.maker_on === undefined ? songMakerOn(undefined) : songMakerOn(row.maker_on === 1);
    const limit = row.weekly_limit === null || row.weekly_limit === undefined ? effectiveLimit(undefined) : effectiveLimit(row.weekly_limit);
    return { makerOn, limit };
  });
}

/** Validate a grown-up's update: `makerOn` a boolean, `limit` a whole number 0 to 10. Either may be left out. */
export function parseSongSettingsUpdate(input: unknown): { ok: true; makerOn?: boolean; limit?: number } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "settings must be an object" };
  const v = input as Record<string, unknown>;
  const out: { ok: true; makerOn?: boolean; limit?: number } = { ok: true };
  if (v.makerOn !== undefined) {
    if (typeof v.makerOn !== "boolean") return { ok: false, error: "makerOn must be true or false" };
    out.makerOn = v.makerOn;
  }
  if (v.limit !== undefined) {
    if (typeof v.limit !== "number" || !Number.isInteger(v.limit) || v.limit < 0 || v.limit > 10) return { ok: false, error: "limit must be a whole number from 0 to 10" };
    out.limit = v.limit;
  }
  if (out.makerOn === undefined && out.limit === undefined) return { ok: false, error: "nothing to change" };
  return out;
}

export async function writeSongSettings(db: SongDb, deviceId: string, update: { makerOn?: boolean; limit?: number }): Promise<SongSettings> {
  return withTables(db, async () => {
    await db.prepare("INSERT INTO song_settings (device_id) VALUES (?) ON CONFLICT(device_id) DO NOTHING").bind(deviceId).run();
    if (update.makerOn !== undefined) await db.prepare("UPDATE song_settings SET maker_on = ?, updated_at = datetime('now') WHERE device_id = ?").bind(update.makerOn ? 1 : 0, deviceId).run();
    if (update.limit !== undefined) await db.prepare("UPDATE song_settings SET weekly_limit = ?, updated_at = datetime('now') WHERE device_id = ?").bind(update.limit, deviceId).run();
    return readSongSettings(db, deviceId);
  });
}

// ---- the quota --------------------------------------------------------------------------------------------------------------

export interface QuotaEnvConfig {
  /** `SONG_MONTHLY_BUDGET`: songs a month across every device. Not a whole number: no budget, nothing is made (fails closed). */
  monthlyBudget: unknown;
  timezone: string;
}

export type ReserveOutcome =
  | { ok: true; reservation: Reservation; replay: boolean; payload: string | null; task: string | null }
  | { ok: false; reason: ReserveDenied };

/**
 * Take a slot for `key` (one per tap) on `deviceId`. A replay of a live key answers with the song already made for it (`payload`, `task`) and spends nothing.
 * After the insert the week and the month are counted again in the database: two requests that raced past the check cannot both keep their slot.
 */
export async function reserveSong(db: SongDb, req: { key: string; deviceId: string; nowMs: number }, cfg: QuotaEnvConfig): Promise<ReserveOutcome> {
  return withTables(db, async () => {
    const settings = await readSongSettings(db, req.deviceId);
    const quotaCfg: QuotaConfig = { enabled: settings.makerOn, songsPerCall: 1, parentLimit: settings.limit, monthlyBudget: cfg.monthlyBudget, timezone: cfg.timezone };
    const week = weekKey(req.nowMs, cfg.timezone);
    const month = new Date(req.nowMs).toISOString().slice(0, 7);
    const before = await loadSlice(db, req.deviceId, week, month, req.key);
    const { state: after, result } = reserve(before, req, quotaCfg);
    if (!result.ok) {
      await writeChanges(db, before, after); // an expiry the check noticed is still recorded
      return { ok: false, reason: result.reason };
    }
    await writeChanges(db, before, after);
    if (result.replay) {
      const { results } = await db.prepare("SELECT payload, task FROM song_reservations WHERE key = ?").bind(req.key).all();
      return { ok: true, reservation: result.reservation, replay: true, payload: typeof results[0]?.payload === "string" ? (results[0].payload as string) : null, task: typeof results[0]?.task === "string" ? (results[0].task as string) : null };
    }
    // The race check: count again from the database itself. Only the rows that came BEFORE this one count against it (earlier created_ms, then the smaller key), so of two requests
    // that raced past the first check the earlier keeps its slot and the later gives it back; neither is refused for the other's sake.
    const again = await loadSlice(db, req.deviceId, week, month, req.key);
    const mine = again.reservations[req.key]!;
    const earlier = Object.entries(again.reservations).filter(([k, r]) => k !== req.key && (r.createdMs < mine.createdMs || (r.createdMs === mine.createdMs && k < req.key)));
    const verify = reserve({ reservations: Object.fromEntries(earlier) }, { ...req, key: req.key }, quotaCfg);
    if (!verify.result.ok) {
      const { state: refunded } = refund(again, req.key, "rejected_before_call", req.nowMs);
      await writeChanges(db, again, refunded);
      return { ok: false, reason: verify.result.reason };
    }
    return { ok: true, reservation: result.reservation, replay: false, payload: null, task: null };
  });
}

async function mutate(db: SongDb, key: string, nowMs: number, fn: (state: QuotaState) => QuotaState): Promise<boolean> {
  const { results } = await db.prepare(`SELECT ${ROW_COLUMNS} FROM song_reservations WHERE key = ?`).bind(key).all();
  if (!results[0]) return false;
  const before: QuotaState = { reservations: { [key]: toReservation(results[0]) } };
  const after = fn(before);
  await writeChanges(db, before, after);
  void nowMs;
  return true;
}

export async function commitSong(db: SongDb, key: string, nowMs: number): Promise<boolean> {
  return withTables(db, async () => {
    let ok = false;
    await mutate(db, key, nowMs, (s) => {
      const r = commit(s, key, nowMs);
      ok = r.result.ok;
      return r.state;
    });
    return ok;
  });
}

export async function refundSong(db: SongDb, key: string, reason: RefundReason, nowMs: number): Promise<boolean> {
  return withTables(db, async () => {
    let ok = false;
    await mutate(db, key, nowMs, (s) => {
      const r = refund(s, key, reason, nowMs);
      ok = r.result.ok;
      return r.state;
    });
    return ok;
  });
}

/** Remember what was ordered: the provider's task, and the name and words (so a retried tap gets the same song, and only this device can ask for its audio). */
export async function attachSong(db: SongDb, key: string, task: string, payload: string): Promise<void> {
  await withTables(db, async () => {
    await db.prepare("UPDATE song_reservations SET task = ?, payload = ? WHERE key = ?").bind(task, payload, key).run();
  });
}

/** The reservation key and owner of a provider task, or null. */
export async function reservationOfTask(db: SongDb, task: string): Promise<{ key: string; deviceId: string; state: string; stored: boolean } | null> {
  return withTables(db, async () => {
    const { results } = await db.prepare("SELECT key, device_id, state, stored FROM song_reservations WHERE task = ?").bind(task).all();
    const r = results[0];
    return r ? { key: String(r.key), deviceId: String(r.device_id), state: String(r.state), stored: Number(r.stored) === 1 } : null;
  });
}

export async function markStored(db: SongDb, key: string): Promise<void> {
  await withTables(db, async () => {
    await db.prepare("UPDATE song_reservations SET stored = 1 WHERE key = ?").bind(key).run();
  });
}

export interface SongStatus extends QuotaStatus {
  makerOn: boolean;
}

/** What a child sees this week: pips left and when they come back, with the grown-up's switch. */
export async function statusFor(db: SongDb, deviceId: string, nowMs: number, timezone: string): Promise<SongStatus> {
  return withTables(db, async () => {
    const settings = await readSongSettings(db, deviceId);
    const week = weekKey(nowMs, timezone);
    const { results } = await db.prepare(`SELECT ${ROW_COLUMNS} FROM song_reservations WHERE device_id = ? AND week_key = ?`).bind(deviceId, week).all();
    const reservations: Record<string, Reservation> = {};
    for (const r of results) reservations[String(r.key)] = toReservation(r);
    return { ...status({ reservations }, deviceId, nowMs, { parentLimit: settings.limit, timezone }), makerOn: settings.makerOn };
  });
}
