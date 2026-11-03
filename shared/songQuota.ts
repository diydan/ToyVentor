/**
 * The song maker's limits (docs/specs/dance-party-spec.md, 4.6, D4: "5 new songs a week per user"), as pure state transitions.
 *
 * The Worker will keep this in D1; the rules are here so they can be tested without a database, and the D1 code is a thin copy of them.
 * Every function takes the state and returns the NEXT state and a result: nothing is mutated, nothing reads a clock (the caller passes `nowMs`).
 *
 *   reserve   take a slot BEFORE the paid call. Idempotent on the key, so a retry never spends twice. Checks, in order: the request,
 *             that the live maker is on (on by default; a grown-up can turn it off), the monthly budget (fails closed), the week's limit.
 *   commit    the song was made and stored (not if it took longer than the TTL: that reservation has expired).
 *   refund    give the slot back: the call was refused or failed, or a grown-up removed the song.
 *   status    what a child sees: pips left this week, and when they come back.
 *
 * A "user" is the anonymous device id today (4.6); a cleared id would reset the week, which is why the monthly budget is the real guard.
 *
 * WEEK. Monday to Sunday in the family's timezone, from the parent-time day key (`localDay`), so a song made on Sunday night counts for
 * that week and Monday midnight in the family's own clock opens the next one. The week a slot counts for is fixed when it is RESERVED.
 *
 * BUDGET is a count of SONGS a month (`SONG_MONTHLY_BUDGET`; `budgetSongs` turns a dollar cap and the price per song into it), global, by UTC month.
 * The provider bills per song and one call can return several, so a reservation counts `songsPerCall` songs, not one: a call that would
 * pass the budget is refused. A song a grown-up
 * removes gives the child's slot back but NOT the budget: the money was spent. A reservation that never finished (the Worker died) expires
 * after `RESERVE_TTL_MS`, gives the slot back and keeps counting against the budget: it may have reached the provider.
 *
 * Pure: no clock, no storage, no network. Imports only the day-key helper.
 */
import { localDay } from "./parent-time";

export const WEEKLY_SONGS = 5;
/** Longer than any song takes to make; a slot held longer than this is a crashed call. */
export const RESERVE_TTL_MS = 10 * 60 * 1000;

export type ReservationState = "reserved" | "committed" | "refunded";
export type RefundReason = "rejected_before_call" | "provider_failed" | "removed" | "expired";

/** Whether a refund also gives the budget back (it does only when no paid work can have happened). */
export const REFUND_FREES_BUDGET: Readonly<Record<RefundReason, boolean>> = {
  rejected_before_call: true,
  provider_failed: true,
  removed: false,
  expired: false,
};

export interface Reservation {
  key: string;
  deviceId: string;
  /** The Monday ("YYYY-MM-DD", family timezone) of the week this slot counts for. */
  weekKey: string;
  /** "YYYY-MM", UTC. */
  monthKey: string;
  /** Songs this call is billed for (1 to 3): what it counts against the budget. The child's weekly slot is one either way. */
  songs: number;
  state: ReservationState;
  createdMs: number;
  refundReason?: RefundReason;
}

export interface QuotaState {
  reservations: Record<string, Reservation>;
}

export function emptyQuota(): QuotaState {
  return { reservations: {} };
}

// ---- weeks, months, limits -----------------------------------------------------------------------------------------------

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function dayNum(dayKey: string): number {
  return Math.round(Date.parse(`${dayKey}T00:00:00Z`) / MS_PER_DAY);
}
function dayKeyOf(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The Monday that opens the week `dayKey` is in. */
export function mondayOf(dayKey: string): string {
  if (!DAY_KEY.test(dayKey)) throw new Error(`not a day key: ${dayKey}`);
  const n = dayNum(dayKey);
  const sinceMonday = (((n + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday: n = 0 is 3 days after a Monday
  return dayKeyOf(n - sinceMonday);
}

/** The week a moment falls in, by the family's own clock. An unknown timezone reads as UTC (as `localDay` does). */
export function weekKey(nowMs: number, timezone: string): string {
  return mondayOf(localDay(nowMs, timezone));
}

export function nextWeekKey(week: string): string {
  return dayKeyOf(dayNum(week) + 7);
}

export function monthKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/**
 * The limit a grown-up may set: 0 to 5, never above 5. Not set (`undefined` or `null`) is 5. Anything else that is not a whole number
 * from 0 to 5 is read as 0, because a corrupt setting must not open more than a chosen one would.
 */
export function effectiveLimit(parentLimit: unknown): number {
  if (parentLimit === undefined || parentLimit === null) return WEEKLY_SONGS;
  if (typeof parentLimit !== "number" || !Number.isInteger(parentLimit)) return 0;
  return Math.min(WEEKLY_SONGS, Math.max(0, parentLimit));
}

/**
 * Whether the live song maker is on (Dan, 2026-11-03: on by default, with a notice; a grown-up can switch it off). Not set (`undefined` or
 * `null`) is ON. Only a plain `true` is on once something is set, so a corrupt setting reads as OFF: it must not open more than a chosen one would.
 */
export function songMakerOn(setting: unknown): boolean {
  if (setting === undefined || setting === null) return true;
  return setting === true;
}

/** The most songs one provider call can return (and bill). */
export const MAX_SONGS_PER_CALL = 3;

/** Songs one call is billed for. Anything that is not a whole number from 1 to 3 is read as the most a call can bill: fail closed. */
export function effectiveSongsPerCall(n: unknown): number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_SONGS_PER_CALL ? n : MAX_SONGS_PER_CALL;
}

/** How many songs a monthly dollar cap buys at a price per song ($50 at $0.045 is 1111). Not a positive price or a non-negative cap: 0. */
export function budgetSongs(monthlyDollars: unknown, pricePerSong: unknown): number {
  if (typeof monthlyDollars !== "number" || typeof pricePerSong !== "number") return 0;
  if (!Number.isFinite(monthlyDollars) || !Number.isFinite(pricePerSong) || monthlyDollars < 0 || pricePerSong <= 0) return 0;
  return Math.floor(monthlyDollars / pricePerSong + 1e-9);
}

/** A budget that is not a whole, non-negative number is no budget at all: fail closed. */
function effectiveBudget(monthlyBudget: unknown): number {
  return typeof monthlyBudget === "number" && Number.isInteger(monthlyBudget) && monthlyBudget >= 0 ? monthlyBudget : 0;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** `RegExp.test` turns a number into text and passes it, so the type is checked first. */
const isId = (x: unknown): x is string => typeof x === "string" && ID.test(x);

// ---- counting --------------------------------------------------------------------------------------------------------------

function isLive(r: Reservation): boolean {
  return r.state === "reserved" || r.state === "committed";
}

/** Slots a device holds in a week. */
export function usedInWeek(state: QuotaState, deviceId: string, week: string): number {
  let n = 0;
  for (const r of Object.values(state.reservations)) if (r.deviceId === deviceId && r.weekKey === week && isLive(r)) n++;
  return n;
}

/** Songs counted against the month's budget, across every device. */
export function spentInMonth(state: QuotaState, month: string): number {
  let n = 0;
  for (const r of Object.values(state.reservations)) {
    if (r.monthKey !== month) continue;
    if (isLive(r) || (r.state === "refunded" && r.refundReason !== undefined && !REFUND_FREES_BUDGET[r.refundReason])) n += r.songs;
  }
  return n;
}

/** Every reservation that has been held past the TTL becomes a refund (`expired`). Returns the same object when nothing changed. */
export function expireStale(state: QuotaState, nowMs: number): QuotaState {
  let next: Record<string, Reservation> | null = null;
  for (const r of Object.values(state.reservations)) {
    if (r.state === "reserved" && nowMs - r.createdMs >= RESERVE_TTL_MS) {
      next ??= { ...state.reservations };
      next[r.key] = { ...r, state: "refunded", refundReason: "expired" };
    }
  }
  return next ? { reservations: next } : state;
}

// ---- reserve, commit, refund -----------------------------------------------------------------------------------------------

export interface QuotaConfig {
  /** Whether the live song maker is on: pass `songMakerOn(settings.songMaker)` (on unless a grown-up turned it off). Only a plain `true` is on here. */
  enabled: boolean;
  /** Songs the provider bills for one call (it returns 2 by default, up to 3). Required: a wrong number here is a wrong budget. See `effectiveSongsPerCall`. */
  songsPerCall: number;
  /** The weekly limit the grown-up set, 0 to 5; see `effectiveLimit`. */
  parentLimit?: unknown;
  /** `SONG_MONTHLY_BUDGET`: songs a month, all families (`budgetSongs(dollars, price)`). */
  monthlyBudget: unknown;
  timezone: string;
}

export interface ReserveRequest {
  /** One per tap of the child's "make a song" card; a retry of that tap reuses it. */
  key: string;
  deviceId: string;
  nowMs: number;
}

export type ReserveDenied = "bad_request" | "not_enabled" | "budget_spent" | "week_used" | "key_in_use";

export type ReserveResult =
  | { ok: true; reservation: Reservation; replay: boolean }
  | { ok: false; reason: ReserveDenied };

/**
 * Take a slot before the paid call. The same key from the same device is a REPLAY while its reservation is held or committed: no second
 * slot, and `reservation.state` tells the Worker whether the song already exists (`committed`: serve it) or is being made (`reserved`: do
 * not call the provider again). A key whose reservation was refunded is a fresh attempt under the same checks, so a retry after a failure works
 * and still cannot go past the limit. A key held by ANOTHER device is refused.
 */
export function reserve(state: QuotaState, req: ReserveRequest, cfg: QuotaConfig): { state: QuotaState; result: ReserveResult } {
  const deny = (reason: ReserveDenied, s: QuotaState = state) => ({ state: s, result: { ok: false, reason } as ReserveResult });
  if (!isId(req.key) || !isId(req.deviceId) || typeof req.nowMs !== "number" || !Number.isFinite(req.nowMs)) return deny("bad_request");
  if (cfg.enabled !== true) return deny("not_enabled");

  const s = expireStale(state, req.nowMs);
  const existing = s.reservations[req.key];
  if (existing && existing.deviceId !== req.deviceId) return deny("key_in_use", s);
  if (existing && isLive(existing)) return { state: s, result: { ok: true, reservation: existing, replay: true } };

  const month = monthKey(req.nowMs);
  const songs = effectiveSongsPerCall(cfg.songsPerCall);
  if (spentInMonth(s, month) + songs > effectiveBudget(cfg.monthlyBudget)) return deny("budget_spent", s);
  const week = weekKey(req.nowMs, cfg.timezone);
  if (usedInWeek(s, req.deviceId, week) >= effectiveLimit(cfg.parentLimit)) return deny("week_used", s);

  // A retry under the key of an attempt that was refunded but PAID for (removed, expired) must not erase that spend: the old attempt moves
  // to its own id ("key~1", which no valid key can be) and keeps counting against the budget.
  let book = s.reservations;
  if (existing && existing.state === "refunded" && existing.refundReason !== undefined && !REFUND_FREES_BUDGET[existing.refundReason]) {
    let n = 1;
    while (`${req.key}~${n}` in book) n++;
    book = { ...book, [`${req.key}~${n}`]: { ...existing, key: `${req.key}~${n}` } };
  }
  const reservation: Reservation = { key: req.key, deviceId: req.deviceId, weekKey: week, monthKey: month, songs, state: "reserved", createdMs: req.nowMs };
  return { state: { reservations: { ...book, [req.key]: reservation } }, result: { ok: true, reservation, replay: false } };
}

export type CommitResult = { ok: true; reservation: Reservation } | { ok: false; reason: "unknown_key" | "refunded" };

/**
 * The song was made and stored. Committing twice is fine. A reservation that already expired (held `RESERVE_TTL_MS` or longer, whether or not
 * anything has swept it yet) or was refunded cannot be committed: the song is not kept. The answer never depends on other traffic.
 */
export function commit(state: QuotaState, key: string, nowMs: number): { state: QuotaState; result: CommitResult } {
  const s = expireStale(state, nowMs);
  const r = s.reservations[key];
  if (!r) return { state: s, result: { ok: false, reason: "unknown_key" } };
  if (r.state === "refunded") return { state: s, result: { ok: false, reason: "refunded" } };
  if (r.state === "committed") return { state: s, result: { ok: true, reservation: r } };
  const next: Reservation = { ...r, state: "committed" };
  return { state: { reservations: { ...s.reservations, [key]: next } }, result: { ok: true, reservation: next } };
}

export type RefundResult = { ok: true; reservation: Reservation } | { ok: false; reason: "unknown_key" | "bad_reason" };

/**
 * Give a slot back. A held reservation takes `rejected_before_call`, `provider_failed` or `expired`; a committed song takes only `removed`
 * (a grown-up took it out of "New songs"). Refunding twice is fine and keeps the first reason. A reservation held past the TTL has already
 * expired (and keeps counting against the budget), whatever reason the late caller gives.
 */
export function refund(state: QuotaState, key: string, reason: RefundReason, nowMs: number): { state: QuotaState; result: RefundResult } {
  const s = expireStale(state, nowMs);
  const r = s.reservations[key];
  if (!r) return { state: s, result: { ok: false, reason: "unknown_key" } };
  if (r.state === "refunded") return { state: s, result: { ok: true, reservation: r } };
  const fits = r.state === "committed" ? reason === "removed" : reason !== "removed";
  if (!fits) return { state: s, result: { ok: false, reason: "bad_reason" } };
  const next: Reservation = { ...r, state: "refunded", refundReason: reason };
  return { state: { reservations: { ...s.reservations, [key]: next } }, result: { ok: true, reservation: next } };
}

// ---- what a child sees -----------------------------------------------------------------------------------------------------

export interface QuotaStatus {
  weekKey: string;
  /** The Monday the pips come back ("new notes on Monday"). */
  resetsOn: string;
  limit: number;
  used: number;
  /** Music-note pips to show. At 0 the card offers the library. */
  left: number;
}

export function status(state: QuotaState, deviceId: string, nowMs: number, cfg: Pick<QuotaConfig, "parentLimit" | "timezone">): QuotaStatus {
  const s = expireStale(state, nowMs);
  const week = weekKey(nowMs, cfg.timezone);
  const limit = effectiveLimit(cfg.parentLimit);
  const used = usedInWeek(s, deviceId, week);
  return { weekKey: week, resetsOn: nextWeekKey(week), limit, used, left: Math.max(0, limit - used) };
}
