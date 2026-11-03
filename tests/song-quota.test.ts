// The song maker's weekly limit and monthly budget (shared/songQuota.ts; docs/specs/dance-party-spec.md 4.6, D4: 5 new songs a week per user).
//
// The week-boundary check and the random-sequence invariants are functions of an implementation, and both are also run on versions broken on
// purpose (a UTC week, a missing idempotency check, a missing budget check, a missing weekly limit): each must be caught, or the check
// proves nothing.
import { describe, expect, it } from "vitest";
import {
  REFUND_FREES_BUDGET,
  RESERVE_TTL_MS,
  MAX_SONGS_PER_CALL,
  WEEKLY_SONGS,
  budgetSongs,
  commit,
  effectiveLimit,
  effectiveSongsPerCall,
  emptyQuota,
  expireStale,
  mondayOf,
  monthKey,
  nextWeekKey,
  refund,
  reserve,
  songMakerOn,
  spentInMonth,
  status,
  usedInWeek,
  weekKey,
  type QuotaConfig,
  type QuotaState,
  type RefundReason,
  type ReserveRequest,
  type ReserveResult,
} from "../shared/songQuota";

// ---- helpers ------------------------------------------------------------------------------------------------------------

const A = "device-aaaaaaaa";
const B = "device-bbbbbbbb";
const key = (n: number) => `key-${String(n).padStart(6, "0")}`;
/** Tuesday 2026-11-03 12:00 UTC: the week of Monday 2026-11-02. */
const TUE = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 86_400_000;

const cfg = (over: Partial<QuotaConfig> = {}): QuotaConfig => ({ enabled: true, songsPerCall: 1, monthlyBudget: 1000, timezone: "UTC", ...over });

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

/** Reserve and commit one song. */
function make(state: QuotaState, k: number, nowMs: number, deviceId = A, c: QuotaConfig = cfg()): { state: QuotaState; result: ReserveResult } {
  const r = reserve(state, { key: key(k), deviceId, nowMs }, c);
  if (!r.result.ok) return r;
  return { state: commit(r.state, key(k), nowMs).state, result: r.result };
}

const denied = (r: { result: ReserveResult }) => (r.result.ok ? "ok" : r.result.reason);

// ---- the week ------------------------------------------------------------------------------------------------------------

describe("the week is Monday to Sunday in the family's own clock", () => {
  /** The boundary cases as a function of the week-key implementation, so it can be run on a broken one. Returns the failures. */
  function weekFailures(wk: (nowMs: number, tz: string) => string): string[] {
    const bad: string[] = [];
    const want = (label: string, got: string, expected: string) => {
      if (got !== expected) bad.push(`${label}: ${got}, wanted ${expected}`);
    };
    want("Tuesday, UTC", wk(TUE, "UTC"), "2026-11-02");
    want("Monday 00:00 UTC", wk(Date.UTC(2026, 10, 2, 0, 0, 0), "UTC"), "2026-11-02");
    want("Sunday 23:59:59 UTC", wk(Date.UTC(2026, 10, 8, 23, 59, 59), "UTC"), "2026-11-02");
    want("Monday 00:00:00 UTC, a week on", wk(Date.UTC(2026, 10, 9, 0, 0, 0), "UTC"), "2026-11-09");
    // Sunday 23:30 in Los Angeles (UTC-8 after the clocks went back on 1 Nov) is already Monday in UTC: still the old week locally
    want("Sunday night, Los Angeles", wk(Date.UTC(2026, 10, 9, 7, 30, 0), "America/Los_Angeles"), "2026-11-02");
    // Monday 00:30 in Auckland (UTC+13) is still Sunday in UTC: already the new week locally
    want("Monday small hours, Auckland", wk(Date.UTC(2026, 10, 8, 11, 30, 0), "Pacific/Auckland"), "2026-11-09");
    // across a new year: Friday 2027-01-01 belongs to the week that opened Monday 2026-12-28
    want("new year", wk(Date.UTC(2027, 0, 1, 12, 0, 0), "UTC"), "2026-12-28");
    // across a leap day: Tuesday 2028-02-29 is in the week of Monday 2028-02-28
    want("leap day", wk(Date.UTC(2028, 1, 29, 12, 0, 0), "UTC"), "2028-02-28");
    return bad;
  }

  it("holds at every boundary", () => {
    expect(weekFailures(weekKey)).toEqual([]);
  });

  it("fails the same check on a UTC week (so the check can fail)", () => {
    const utcWeek = (nowMs: number) => mondayOf(new Date(nowMs).toISOString().slice(0, 10));
    expect(weekFailures(utcWeek).length).toBeGreaterThan(0);
  });

  it("reads an unknown timezone as UTC, as the time gate does", () => {
    expect(weekKey(Date.UTC(2026, 10, 9, 7, 30, 0), "Not/AZone")).toBe("2026-11-09");
  });

  it("the Monday of any day is a Monday, at most six days back, and the next week is seven on", () => {
    for (let n = 0; n < 800; n++) {
      const dayKey = new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString().slice(0, 10);
      const monday = mondayOf(dayKey);
      expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);
      const back = (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / DAY;
      expect(back).toBeGreaterThanOrEqual(0);
      expect(back).toBeLessThanOrEqual(6);
      expect(mondayOf(nextWeekKey(monday))).toBe(nextWeekKey(monday));
      expect((Date.parse(`${nextWeekKey(monday)}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / DAY).toBe(7);
    }
  });

  it("refuses a string that is not a day", () => {
    expect(() => mondayOf("2026-11")).toThrow();
    expect(() => mondayOf("tomorrow")).toThrow();
  });

  it("the month is the UTC month", () => {
    expect(monthKey(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe("2026-11");
    expect(monthKey(Date.UTC(2026, 11, 1, 0, 0, 0))).toBe("2026-12");
  });
});

// ---- the grown-up's limit ---------------------------------------------------------------------------------------------------

describe("the limit a grown-up can set", () => {
  it("is 5 when unset, 0 to 5 when set, never above 5, and 0 when it is not a whole number in range", () => {
    expect(WEEKLY_SONGS).toBe(5);
    expect(effectiveLimit(undefined)).toBe(5);
    expect(effectiveLimit(null)).toBe(5);
    for (const n of [0, 1, 2, 3, 4, 5]) expect(effectiveLimit(n)).toBe(n);
    expect(effectiveLimit(6)).toBe(5);
    expect(effectiveLimit(1000)).toBe(5);
    expect(effectiveLimit(-1)).toBe(0);
    for (const bad of [2.5, NaN, Infinity, "3", "", {}, [], true]) expect(effectiveLimit(bad)).toBe(0);
  });
});

// ---- reserve, commit, refund ----------------------------------------------------------------------------------------------

describe("five new songs a week", () => {
  it("allows five, refuses the sixth, and opens again on Monday", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) {
      const r = make(s, i, TUE + i * 1000);
      expect(r.result.ok).toBe(true);
      s = r.state;
    }
    expect(denied(reserve(s, { key: key(6), deviceId: A, nowMs: TUE + 9000 }, cfg()))).toBe("week_used");
    // Sunday 23:59 UTC is still that week
    expect(denied(reserve(s, { key: key(6), deviceId: A, nowMs: Date.UTC(2026, 10, 8, 23, 59, 59) }, cfg()))).toBe("week_used");
    // Monday 00:00 UTC opens the next
    const monday = Date.UTC(2026, 10, 9, 0, 0, 0);
    expect(reserve(s, { key: key(6), deviceId: A, nowMs: monday }, cfg()).result.ok).toBe(true);
  });

  it("counts per device: one child's week is not another's", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) s = make(s, i, TUE, A).state;
    expect(make(s, 10, TUE, B).result.ok).toBe(true);
    expect(status(s, B, TUE, cfg()).used).toBe(0);
    expect(status(s, A, TUE, cfg()).used).toBe(5);
  });

  it("counts a slot in the week it was RESERVED, even if the song finishes after midnight", () => {
    const sunday = Date.UTC(2026, 10, 8, 23, 59, 50);
    const monday = Date.UTC(2026, 10, 9, 0, 0, 10);
    let s = emptyQuota();
    const r = reserve(s, { key: key(1), deviceId: A, nowMs: sunday }, cfg());
    s = commit(r.state, key(1), monday).state; // the song lands 20 s later, in the new week
    expect(usedInWeek(s, A, "2026-11-02")).toBe(1);
    expect(usedInWeek(s, A, "2026-11-09")).toBe(0);
    expect(status(s, A, monday, cfg()).left).toBe(5);
  });

  it("a lowered limit applies at once, and zero means none", () => {
    let s = emptyQuota();
    s = make(s, 1, TUE).state;
    s = make(s, 2, TUE).state;
    expect(denied(reserve(s, { key: key(3), deviceId: A, nowMs: TUE }, cfg({ parentLimit: 2 })))).toBe("week_used");
    expect(reserve(s, { key: key(3), deviceId: A, nowMs: TUE }, cfg({ parentLimit: 3 })).result.ok).toBe(true);
    expect(denied(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ parentLimit: 0 })))).toBe("week_used");
    // a corrupt setting does not open more than a chosen one would
    expect(denied(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ parentLimit: "5" })))).toBe("week_used");
    expect(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ parentLimit: 9 })).result.ok).toBe(true);
  });

  it("shows pips left and the Monday they come back", () => {
    let s = emptyQuota();
    expect(status(s, A, TUE, cfg())).toEqual({ weekKey: "2026-11-02", resetsOn: "2026-11-09", limit: 5, used: 0, left: 5 });
    s = make(s, 1, TUE).state;
    s = make(s, 2, TUE).state;
    expect(status(s, A, TUE, cfg())).toMatchObject({ used: 2, left: 3 });
    expect(status(s, A, TUE, cfg({ parentLimit: 1 }))).toMatchObject({ limit: 1, used: 2, left: 0 }); // never negative
    expect(status(s, A, Date.UTC(2026, 10, 9, 0, 0, 1), cfg())).toMatchObject({ weekKey: "2026-11-09", used: 0, left: 5 });
  });
});

describe("a retry never spends twice", () => {
  it("returns the same reservation for the same key, and says it is a replay", () => {
    const first = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg());
    expect(first.result).toMatchObject({ ok: true, replay: false });
    const again = reserve(first.state, { key: key(1), deviceId: A, nowMs: TUE + 5000 }, cfg());
    expect(again.result).toMatchObject({ ok: true, replay: true });
    expect(again.state).toBe(first.state); // nothing changed
    expect(usedInWeek(again.state, A, "2026-11-02")).toBe(1);
  });

  it("tells the Worker whether the song exists (committed) or is being made (reserved)", () => {
    const first = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg());
    expect(first.result.ok && first.result.reservation.state).toBe("reserved");
    const done = commit(first.state, key(1), TUE + 1000).state;
    const replay = reserve(done, { key: key(1), deviceId: A, nowMs: TUE + 9000 }, cfg());
    expect(replay.result.ok && replay.result.replay).toBe(true);
    expect(replay.result.ok && replay.result.reservation.state).toBe("committed");
  });

  it("a replay is free even when the week is full or the budget is spent", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) s = make(s, i, TUE).state;
    expect(reserve(s, { key: key(5), deviceId: A, nowMs: TUE + 1 }, cfg()).result).toMatchObject({ ok: true, replay: true });
    expect(reserve(s, { key: key(5), deviceId: A, nowMs: TUE + 1 }, cfg({ monthlyBudget: 5 })).result).toMatchObject({ ok: true, replay: true });
  });

  it("a key held by another device is refused, not shared", () => {
    const s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    expect(denied(reserve(s, { key: key(1), deviceId: B, nowMs: TUE }, cfg()))).toBe("key_in_use");
    expect(usedInWeek(s, B, "2026-11-02")).toBe(0);
  });

  it("a key whose reservation was refunded is a fresh attempt under the same checks", () => {
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    s = refund(s, key(1), "provider_failed", TUE).state;
    const retry = reserve(s, { key: key(1), deviceId: A, nowMs: TUE + 1000 }, cfg());
    expect(retry.result).toMatchObject({ ok: true, replay: false });
    expect(usedInWeek(retry.state, A, "2026-11-02")).toBe(1);
    // ...and a retry loop cannot go past the week
    let t = emptyQuota();
    for (let i = 1; i <= 5; i++) t = make(t, i, TUE).state;
    t = refund(t, key(5), "removed", TUE).state; // a grown-up removed the fifth
    t = make(t, 6, TUE).state; // a new song takes the slot
    expect(denied(reserve(t, { key: key(5), deviceId: A, nowMs: TUE }, cfg()))).toBe("week_used"); // the old key cannot sneak a sixth in
  });
});

describe("failures and removals give the week's slot back", () => {
  it("a refused or failed call frees the slot and the budget", () => {
    for (const reason of ["rejected_before_call", "provider_failed"] as RefundReason[]) {
      let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
      expect(spentInMonth(s, "2026-11")).toBe(1);
      s = refund(s, key(1), reason, TUE).state;
      expect(usedInWeek(s, A, "2026-11-02")).toBe(0);
      expect(spentInMonth(s, "2026-11")).toBe(0);
    }
  });

  it("a song a grown-up removes frees the child's slot but not the budget: the money was spent", () => {
    let s = make(emptyQuota(), 1, TUE).state;
    s = refund(s, key(1), "removed", TUE).state;
    expect(usedInWeek(s, A, "2026-11-02")).toBe(0);
    expect(spentInMonth(s, "2026-11")).toBe(1);
    expect(REFUND_FREES_BUDGET).toEqual({ rejected_before_call: true, provider_failed: true, removed: false, expired: false });
  });

  it("only a held reservation takes a call failure, and only a stored song takes a removal", () => {
    const held = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    expect(refund(held, key(1), "removed", TUE).result).toEqual({ ok: false, reason: "bad_reason" });
    const done = commit(held, key(1), TUE).state;
    expect(refund(done, key(1), "provider_failed", TUE).result).toEqual({ ok: false, reason: "bad_reason" });
    expect(refund(done, key(1), "expired", TUE).result).toEqual({ ok: false, reason: "bad_reason" });
    expect(refund(done, key(1), "removed", TUE).result.ok).toBe(true);
  });

  it("refunding twice is fine and keeps the first reason; unknown keys are named", () => {
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    s = refund(s, key(1), "provider_failed", TUE).state;
    const twice = refund(s, key(1), "rejected_before_call", TUE);
    expect(twice.result.ok && twice.result.reservation.refundReason).toBe("provider_failed");
    expect(twice.state).toBe(s);
    expect(refund(s, key(99), "provider_failed", TUE).result).toEqual({ ok: false, reason: "unknown_key" });
    expect(commit(s, key(99), TUE).result).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("commit twice is fine; a refunded reservation cannot be committed (the song is not kept)", () => {
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    const once = commit(s, key(1), TUE);
    const twice = commit(once.state, key(1), TUE);
    expect(twice.state).toBe(once.state);
    s = refund(s, key(1), "provider_failed", TUE).state;
    expect(commit(s, key(1), TUE).result).toEqual({ ok: false, reason: "refunded" });
  });
});

describe("a call that never finished", () => {
  it("is held until the TTL, then gives the slot back and keeps counting against the budget", () => {
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    const justBefore = TUE + RESERVE_TTL_MS - 1;
    expect(expireStale(s, justBefore)).toBe(s);
    expect(status(s, A, justBefore, cfg()).used).toBe(1);
    const after = TUE + RESERVE_TTL_MS;
    expect(status(s, A, after, cfg()).used).toBe(0);
    s = expireStale(s, after);
    expect(s.reservations[key(1)]).toMatchObject({ state: "refunded", refundReason: "expired" });
    expect(spentInMonth(s, "2026-11")).toBe(1); // it may have reached the provider
    expect(commit(s, key(1), TUE).result).toEqual({ ok: false, reason: "refunded" });
  });

  it("a crashed call cannot hold a slot for the whole week", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) s = reserve(s, { key: key(i), deviceId: A, nowMs: TUE }, cfg()).state; // five calls, all crash
    expect(denied(reserve(s, { key: key(6), deviceId: A, nowMs: TUE + 1000 }, cfg()))).toBe("week_used");
    expect(reserve(s, { key: key(6), deviceId: A, nowMs: TUE + RESERVE_TTL_MS }, cfg()).result.ok).toBe(true);
  });
});

describe("a late or repeated call cannot undo what was spent", () => {
  it("a key reused after a removal keeps the first attempt's spend on the books", () => {
    let s = make(emptyQuota(), 1, TUE).state;
    s = refund(s, key(1), "removed", TUE).state;
    expect(spentInMonth(s, "2026-11")).toBe(1);
    const again = reserve(s, { key: key(1), deviceId: A, nowMs: TUE + 1000 }, cfg());
    expect(again.result).toMatchObject({ ok: true, replay: false });
    expect(spentInMonth(again.state, "2026-11")).toBe(2); // the removed song AND the new attempt
    expect(usedInWeek(again.state, A, "2026-11-02")).toBe(1);
    // and again: the archive never collides with itself
    let t = refund(commit(again.state, key(1), TUE + 2000).state, key(1), "removed", TUE + 3000).state;
    t = reserve(t, { key: key(1), deviceId: A, nowMs: TUE + 4000 }, cfg()).state;
    expect(spentInMonth(t, "2026-11")).toBe(3);
  });

  it("a key reused after an EXPIRED attempt keeps that spend too, but a refused or failed one does not", () => {
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    s = reserve(s, { key: key(1), deviceId: A, nowMs: TUE + RESERVE_TTL_MS }, cfg()).state; // the first expired, this is a new attempt
    expect(spentInMonth(s, "2026-11")).toBe(2);
    let f = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state;
    f = refund(f, key(1), "provider_failed", TUE).state;
    f = reserve(f, { key: key(1), deviceId: A, nowMs: TUE + 1000 }, cfg()).state;
    expect(spentInMonth(f, "2026-11")).toBe(1);
  });

  it("a song that took longer than the TTL is not kept, however quiet the Worker was in between", () => {
    const s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg()).state; // nothing has swept it
    expect(commit(s, key(1), TUE + RESERVE_TTL_MS - 1).result.ok).toBe(true);
    const late = commit(s, key(1), TUE + RESERVE_TTL_MS);
    expect(late.result).toEqual({ ok: false, reason: "refunded" });
    expect(late.state.reservations[key(1)]).toMatchObject({ state: "refunded", refundReason: "expired" });
    // a late failure report cannot turn the expiry into a free refund
    const lateFail = refund(s, key(1), "provider_failed", TUE + RESERVE_TTL_MS);
    expect(lateFail.state.reservations[key(1)]?.refundReason).toBe("expired");
    expect(spentInMonth(lateFail.state, "2026-11")).toBe(1);
  });
});

describe("the monthly budget fails closed, and is the guard when a device id is cleared", () => {
  it("stops live songs for everyone when it is spent", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 3; i++) s = make(s, i, TUE, `device-${"x".repeat(7)}${i}`, cfg({ monthlyBudget: 3 })).state;
    expect(denied(reserve(s, { key: key(9), deviceId: "device-fresh0001", nowMs: TUE }, cfg({ monthlyBudget: 3 })))).toBe("budget_spent");
  });

  it("a cleared device id gets a fresh week but not a fresh budget", () => {
    let s = emptyQuota();
    let ok = 0;
    for (let i = 1; i <= 20; i++) {
      const r = make(s, i, TUE, `device-clear${String(i).padStart(4, "0")}`, cfg({ monthlyBudget: 7 }));
      if (r.result.ok) ok++;
      s = r.state;
    }
    expect(ok).toBe(7);
  });

  it("opens again in the next month, by UTC", () => {
    let s = make(emptyQuota(), 1, Date.UTC(2026, 10, 30, 12), A, cfg({ monthlyBudget: 1 })).state;
    expect(denied(reserve(s, { key: key(2), deviceId: B, nowMs: Date.UTC(2026, 10, 30, 23, 59) }, cfg({ monthlyBudget: 1 })))).toBe("budget_spent");
    expect(reserve(s, { key: key(2), deviceId: B, nowMs: Date.UTC(2026, 11, 1, 0, 0) }, cfg({ monthlyBudget: 1 })).result.ok).toBe(true);
  });

  it("a budget that is not a whole non-negative number is no budget: fail closed", () => {
    for (const bad of [undefined, null, NaN, -1, 2.5, "10", Infinity, {}]) {
      expect(denied(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ monthlyBudget: bad })))).toBe("budget_spent");
    }
    expect(denied(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ monthlyBudget: 0 })))).toBe("budget_spent");
  });

  it("is named before the week, so a resting maker never promises a Monday", () => {
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) s = make(s, i, TUE).state;
    expect(denied(reserve(s, { key: key(9), deviceId: A, nowMs: TUE }, cfg({ monthlyBudget: 5 })))).toBe("budget_spent");
  });
});

describe("the live maker is on by default, and billed per song", () => {
  it("is ON unless a grown-up turned it off; a corrupt setting reads as off", () => {
    expect(songMakerOn(undefined)).toBe(true);
    expect(songMakerOn(null)).toBe(true);
    expect(songMakerOn(true)).toBe(true);
    expect(songMakerOn(false)).toBe(false);
    for (const bad of ["true", "yes", 1, 0, {}, [], NaN]) expect(songMakerOn(bad), String(bad)).toBe(false);
    // wired to reserve: a never-touched setting lets a child ask, an explicit off does not
    const ask = (setting: unknown) => denied(reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, cfg({ enabled: songMakerOn(setting) })));
    expect(ask(undefined)).toBe("ok");
    expect(ask(false)).toBe("not_enabled");
  });

  it("turns a dollar cap into songs at the price per song ($0.045), and a bad cap or price into none", () => {
    expect(budgetSongs(50, 0.045)).toBe(1111);
    expect(budgetSongs(20, 0.045)).toBe(444);
    expect(budgetSongs(100, 0.045)).toBe(2222);
    expect(budgetSongs(0.45, 0.045)).toBe(10); // 0.45 / 0.045 is 10.000000000000002 in floating point: still 10, and 0.449 is 9
    expect(budgetSongs(0.449, 0.045)).toBe(9);
    expect(budgetSongs(0, 0.045)).toBe(0);
    for (const bad of [-1, NaN, Infinity, "50", null, undefined]) expect(budgetSongs(bad, 0.045), String(bad)).toBe(0);
    for (const bad of [0, -0.045, NaN, Infinity, "0.045", null, undefined]) expect(budgetSongs(50, bad), String(bad)).toBe(0);
  });

  it("reads songs per call as 1 to 3, and anything else as the most a call can bill", () => {
    for (const n of [1, 2, 3]) expect(effectiveSongsPerCall(n)).toBe(n);
    expect(MAX_SONGS_PER_CALL).toBe(3);
    for (const bad of [0, 4, -1, 2.5, NaN, Infinity, "2", null, undefined, {}]) expect(effectiveSongsPerCall(bad), String(bad)).toBe(3);
  });

  it("counts every song a call is billed for against the budget, and refuses a call that would pass it", () => {
    const two = cfg({ songsPerCall: 2, monthlyBudget: 5 });
    let s = make(emptyQuota(), 1, TUE, A, two).state;
    s = make(s, 2, TUE, B, two).state;
    expect(spentInMonth(s, "2026-11")).toBe(4);
    expect(s.reservations[key(1)]?.songs).toBe(2);
    // one song of budget is left, but a call bills two: refused, not overshot
    expect(denied(reserve(s, { key: key(3), deviceId: "device-cccccccc", nowMs: TUE }, two))).toBe("budget_spent");
    // the same budget at one song a call still has room
    expect(reserve(s, { key: key(3), deviceId: "device-cccccccc", nowMs: TUE }, cfg({ songsPerCall: 1, monthlyBudget: 5 })).result.ok).toBe(true);
  });

  it("gives back every song of a failed call, and keeps every song of a removed one", () => {
    const two = cfg({ songsPerCall: 2, monthlyBudget: 100 });
    let s = reserve(emptyQuota(), { key: key(1), deviceId: A, nowMs: TUE }, two).state;
    expect(spentInMonth(s, "2026-11")).toBe(2);
    s = refund(s, key(1), "provider_failed", TUE).state;
    expect(spentInMonth(s, "2026-11")).toBe(0);
    let t = make(emptyQuota(), 1, TUE, A, two).state;
    t = refund(t, key(1), "removed", TUE).state;
    expect(spentInMonth(t, "2026-11")).toBe(2);
    // a key reused after the removal keeps those two on the books and adds two more
    t = reserve(t, { key: key(1), deviceId: A, nowMs: TUE + 1000 }, two).state;
    expect(spentInMonth(t, "2026-11")).toBe(4);
  });

  it("a wrong songs-per-call setting costs the most a call can bill (3), never less", () => {
    const bad = cfg({ songsPerCall: 0, monthlyBudget: 5 });
    const s = make(emptyQuota(), 1, TUE, A, bad).state;
    expect(spentInMonth(s, "2026-11")).toBe(3);
    expect(denied(reserve(s, { key: key(2), deviceId: B, nowMs: TUE }, bad))).toBe("budget_spent");
  });

  it("the child's week is still five slots, whatever a call is billed", () => {
    const three = cfg({ songsPerCall: 3, monthlyBudget: 1000 });
    let s = emptyQuota();
    for (let i = 1; i <= 5; i++) s = make(s, i, TUE, A, three).state;
    expect(usedInWeek(s, A, "2026-11-02")).toBe(5);
    expect(denied(reserve(s, { key: key(6), deviceId: A, nowMs: TUE }, three))).toBe("week_used");
  });
});

describe("who may ask at all", () => {
  it("does nothing while the live maker is off, and changes nothing", () => {
    const s = emptyQuota();
    for (const enabled of [false, undefined, null, "yes", 1] as unknown[]) {
      const r = reserve(s, { key: key(1), deviceId: A, nowMs: TUE }, cfg({ enabled: enabled as boolean }));
      expect(r.result).toEqual({ ok: false, reason: "not_enabled" });
      expect(r.state).toBe(s);
    }
  });

  it("refuses a request that is not well formed, including numbers that would pass as text", () => {
    const base: ReserveRequest = { key: key(1), deviceId: A, nowMs: TUE };
    for (const bad of [
      { ...base, key: "" },
      { ...base, key: "short" },
      { ...base, key: "has space in it" },
      { ...base, key: "x".repeat(65) },
      { ...base, deviceId: "" },
      { ...base, deviceId: "a;b'c--drop-table" },
      { ...base, nowMs: NaN },
      { ...base, key: 12345678 as unknown as string },
    ]) {
      expect(denied(reserve(emptyQuota(), bad, cfg()))).toBe("bad_request");
    }
  });
});

describe("the state is never changed in place", () => {
  it("every transition leaves its input untouched (deep-frozen, so a write would throw)", () => {
    let s = deepFreeze(emptyQuota());
    for (let i = 1; i <= 4; i++) {
      s = deepFreeze(reserve(s, { key: key(i), deviceId: A, nowMs: TUE + i }, cfg()).state);
      s = deepFreeze(commit(s, key(i), TUE + i).state);
    }
    s = deepFreeze(refund(s, key(2), "removed", TUE).state);
    s = deepFreeze(reserve(s, { key: key(9), deviceId: A, nowMs: TUE + 99 }, cfg()).state);
    s = deepFreeze(refund(s, key(9), "provider_failed", TUE).state);
    s = deepFreeze(expireStale(s, TUE + 10 * RESERVE_TTL_MS));
    expect(status(s, A, TUE, cfg()).used).toBe(3);
  });
});

// ---- random sequences, with the invariants a Worker must keep ---------------------------------------------------------------

type Impl = {
  reserve: typeof reserve;
  commit: typeof commit;
  refund: typeof refund;
};

const REAL: Impl = { reserve, commit, refund };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIMIT = 2;
const BUDGET = 12;

// Building an Intl formatter per call is slow; the harness asks for the same instants over and over.
const weekMemo = new Map<number, string>();
const utcWeek = (ms: number) => {
  let w = weekMemo.get(ms);
  if (w === undefined) weekMemo.set(ms, (w = weekKey(ms, "UTC")));
  return w;
};

/**
 * Drive an implementation with random reserves, commits, refunds and the passing of time (seconds, hours and days), and check after EVERY step
 * what must always be true. Returns the first violation, or null. The invariants are the TRUE ones (limit 2, budget 12), whatever the
 * implementation was told, and what was paid and which keys are held is kept by the HARNESS in its own ledger, built only from what the
 * implementation RETURNED, so a version that forgets a record or ignores a key cannot hide it.
 */
function violation(impl: Impl, seed: number, songsPerCall = 1): string | null {
  const rnd = mulberry32(seed);
  const devices = [A, B, "device-cccccccc"];
  const config = cfg({ parentLimit: LIMIT, monthlyBudget: BUDGET, songsPerCall });
  let s = emptyQuota();
  let now = TUE;
  const paid = new Map<string, number>(); // month -> songs the provider was (or may have been) paid for
  const held = new Map<string, { dev: string; state: "reserved" | "committed" | "refunded"; at: number }>();
  for (let step = 0; step < 300; step++) {
    const jump = rnd();
    now += jump < 0.7 ? Math.floor(rnd() * 60_000) : jump < 0.95 ? Math.floor(rnd() * 2 * 3_600_000) : Math.floor(rnd() * 3 * DAY);
    const k = key(Math.floor(rnd() * 14));
    const dev = devices[Math.floor(rnd() * devices.length)]!;
    const op = rnd();
    const h = held.get(k);
    const alive = h !== undefined && (h.state === "committed" || (h.state === "reserved" && now - h.at < RESERVE_TTL_MS));
    if (op < 0.5) {
      const r = impl.reserve(s, { key: k, deviceId: dev, nowMs: now }, config);
      if (alive && h.dev === dev) {
        if (!r.result.ok || !r.result.replay) return `step ${step}: a key that is held was not a replay`;
      } else if (r.result.ok && !r.result.replay) {
        const m = monthKey(now);
        paid.set(m, (paid.get(m) ?? 0) + songsPerCall);
        held.set(k, { dev, state: "reserved", at: now });
      }
      s = r.state;
    } else if (op < 0.7) {
      const r = impl.commit(s, k, now);
      if (r.result.ok && h && alive) held.set(k, { ...h, state: "committed" });
      s = r.state;
    } else if (op < 0.9) {
      // mostly the reason that fits the record, sometimes any reason, so the refusals are exercised too
      const fit: RefundReason = h?.state === "committed" ? "removed" : "provider_failed";
      const all: RefundReason[] = ["rejected_before_call", "provider_failed", "removed", "expired"];
      const reason = rnd() < 0.8 ? fit : all[Math.floor(rnd() * all.length)]!;
      const r = impl.refund(s, k, reason, now);
      const after = r.state.reservations[k];
      if (h && h.state !== "refunded" && r.result.ok && after && after.state === "refunded") {
        // a refund gives the budget back only for a reason that does, and only while the attempt was still held (not already expired)
        if (after.refundReason !== undefined && REFUND_FREES_BUDGET[after.refundReason] && alive) {
          const m = monthKey(h.at);
          paid.set(m, (paid.get(m) ?? songsPerCall) - songsPerCall);
        }
        held.set(k, { ...h, state: "refunded" });
      } else if (h && !alive && h.state === "reserved" && after && after.state === "refunded") {
        held.set(k, { ...h, state: "refunded" }); // swept as expired on the way
      }
      s = r.state;
    }

    const live = expireStale(s, now);
    for (const [m, n] of paid) if (n > BUDGET) return `step ${step}: ${n} songs paid for in ${m}, the budget is ${BUDGET}`;
    const weeks = new Set(Object.values(live.reservations).map((r) => `${r.deviceId}|${r.weekKey}`));
    for (const w of weeks) {
      const [d, wk] = w.split("|") as [string, string];
      if (usedInWeek(live, d, wk) > LIMIT) return `step ${step}: ${d} holds ${usedInWeek(live, d, wk)} slots in ${wk}`;
    }
    for (const r of Object.values(s.reservations)) {
      if (r.state === "refunded" && r.refundReason === undefined) return `step ${step}: a refund with no reason`;
      if (r.weekKey !== utcWeek(r.createdMs)) return `step ${step}: a slot counted for a week it was not reserved in`;
    }
    // the state's own books agree with the harness's: no spend has gone missing
    for (const [m, n] of paid) if (spentInMonth(live, m) < n) return `step ${step}: the state counts ${spentInMonth(live, m)} songs in ${m}, ${n} were paid for`;
  }
  return null;
}

describe("random sequences keep the invariants", () => {
  const seeds = Array.from({ length: 16 }, (_, i) => 1000 + i * 7919);

  it("the real code never goes past the weekly limit or the budget, never double-counts a retry, and never loses a reason", () => {
    for (const seed of seeds) expect(violation(REAL, seed), `seed ${seed}`).toBeNull();
  }, 30_000);

  it("holds when a call is billed for 2 or 3 songs, and the same run catches a budget that counts calls instead of songs", () => {
    for (const n of [2, 3]) for (const seed of seeds) expect(violation(REAL, seed, n), `songs ${n}, seed ${seed}`).toBeNull();
    const countsCalls: Impl = { ...REAL, reserve: (s, req, c) => reserve(s, req, { ...c, songsPerCall: 1 }) };
    expect(seeds.some((seed) => violation(countsCalls, seed, 2) !== null)).toBe(true);
  }, 30_000);

  it("the same run catches a missing idempotency check (so the check can fail)", () => {
    let n = 0;
    const noIdempotency: Impl = { ...REAL, reserve: (s, req, c) => reserve(s, { ...req, key: `${req.key}-${n++}`.slice(0, 64) }, c) };
    expect(seeds.some((seed) => violation(noIdempotency, seed) !== null)).toBe(true);
  }, 30_000);

  it("catches a missing budget check", () => {
    const noBudget: Impl = { ...REAL, reserve: (s, req, c) => reserve(s, req, { ...c, monthlyBudget: 1_000_000 }) };
    expect(seeds.some((seed) => violation(noBudget, seed) !== null)).toBe(true);
  });

  it("catches a missing weekly limit", () => {
    const noLimit: Impl = { ...REAL, reserve: (s, req, c) => reserve(s, req, { ...c, parentLimit: 5 }) };
    expect(seeds.some((seed) => violation(noLimit, seed) !== null)).toBe(true);
  });

  it("catches a removal that wrongly gives the budget back", () => {
    // forgets a removed song entirely: the child's slot is free, and so is the budget it spent
    const freesBudget: Impl = {
      ...REAL,
      refund: (s, k, reason, now) => {
        const r = refund(s, k, reason, now);
        if (reason === "removed" && r.result.ok) {
          const { [k]: _gone, ...rest } = r.state.reservations;
          return { state: { reservations: rest }, result: r.result };
        }
        return r;
      },
    };
    expect(seeds.some((seed) => violation(freesBudget, seed) !== null)).toBe(true);
  });
});
