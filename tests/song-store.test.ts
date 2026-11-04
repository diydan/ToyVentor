import { describe, expect, it } from "vitest";
import { attachSong, commitSong, markStored, parseSongSettingsUpdate, readSongSettings, refundSong, reservationOfTask, reserveSong, statusFor, writeSongSettings } from "../worker/songStore";
import { DAILY_SONGS, RESERVE_TTL_MS } from "../shared/songQuota";
import { sqliteD1 } from "./helpers/sqliteD1";

const DEV = "12345678-1234-1234-1234-123456789abc";
const OTHER = "abcdefab-1234-1234-1234-123456789abc";
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0); // Wed 2026-11-04: the family day "2026-11-04" (the limit is 10 a day since 2026-11-04 evening, it was 5 a week; the column is still week_key and the denial week_used)
const TODAY = "2026-11-04";
const CFG = { monthlyBudget: 100, timezone: "UTC" };
const key = (n: number) => `tap-${String(n).padStart(8, "0")}`;
const fresh = () => sqliteD1({ migrations: ["migrations/0003_songs.sql"] });

describe("the migration and the lazy tables", () => {
  it("the migration file runs and makes both tables, and the store also makes them on first use when it was never applied", async () => {
    const m = fresh();
    expect((m.raw.prepare("select name from sqlite_master where type = 'table' and name like 'song_%' order by name").all() as { name: string }[]).map((r) => r.name)).toEqual(["song_reservations", "song_settings"]);
    const bare = sqliteD1(); // no migration
    expect((await reserveSong(bare, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG)).ok).toBe(true);
    expect((bare.raw.prepare("select count(*) as n from song_reservations").get() as { n: number }).n).toBe(1);
  });
});

describe("the daily limit: ten songs a day for a device, then none until the family's next midnight", () => {
  it("lets ten slots through, refuses the eleventh, and says how many are left", async () => {
    const d = fresh();
    for (let i = 1; i <= DAILY_SONGS; i++) expect((await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW }, CFG)).ok).toBe(true);
    expect(await reserveSong(d, { key: key(DAILY_SONGS + 1), deviceId: DEV, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "week_used" });
    expect(await statusFor(d, DEV, NOW, "UTC")).toMatchObject({ limit: DAILY_SONGS, used: DAILY_SONGS, left: 0, resetsOn: "2026-11-05", makerOn: true });
  });
  it("is per device: another device still has its ten", async () => {
    const d = fresh();
    for (let i = 1; i <= DAILY_SONGS; i++) await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW }, CFG);
    expect((await reserveSong(d, { key: key(100), deviceId: OTHER, nowMs: NOW }, CFG)).ok).toBe(true);
    expect((await statusFor(d, OTHER, NOW, "UTC")).left).toBe(DAILY_SONGS - 1);
  });
  it("opens again at midnight, by the family's own clock", async () => {
    const d = fresh();
    for (let i = 1; i <= DAILY_SONGS; i++) { await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW }, CFG); await commitSong(d, key(i), NOW + 1000); } // committed songs hold their slot all day
    const lateEvening = Date.UTC(2026, 10, 4, 23, 0, 0);
    expect((await reserveSong(d, { key: key(21), deviceId: DEV, nowMs: lateEvening }, CFG)).ok).toBe(false);
    const nextDayUtc = Date.UTC(2026, 10, 5, 0, 30, 0);
    expect((await reserveSong(d, { key: key(22), deviceId: DEV, nowMs: nextDayUtc }, CFG)).ok).toBe(true);
    // a family in Los Angeles: it is still the 4th, 16:30, there at 00:30 UTC on the 5th, so the day has NOT turned
    expect((await reserveSong(d, { key: key(23), deviceId: DEV, nowMs: nextDayUtc }, { ...CFG, timezone: "America/Los_Angeles" })).ok).toBe(false);
    // ...and at 08:00 UTC on the 5th it is 00:00 on the 5th in Los Angeles: a new day there too
    expect((await reserveSong(d, { key: key(24), deviceId: DEV, nowMs: Date.UTC(2026, 10, 5, 8, 0, 0) }, { ...CFG, timezone: "America/Los_Angeles" })).ok).toBe(true);
  });
  it("a retry of the same tap spends nothing and returns the song already made for it", async () => {
    const d = fresh();
    const first = await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG);
    expect(first).toMatchObject({ ok: true, replay: false });
    await attachSong(d, key(1), "170010186285057", JSON.stringify({ name: "Stompy" }));
    const again = await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW + 5000 }, CFG);
    expect(again).toMatchObject({ ok: true, replay: true, task: "170010186285057", payload: JSON.stringify({ name: "Stompy" }) });
    expect((await statusFor(d, DEV, NOW, "UTC")).used).toBe(1);
  });
  it("refuses a key that another device already holds", async () => {
    const d = fresh();
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG);
    expect(await reserveSong(d, { key: key(1), deviceId: OTHER, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "key_in_use" });
  });
  it("refuses a malformed key or device before touching the database", async () => {
    const d = fresh();
    expect(await reserveSong(d, { key: "x", deviceId: DEV, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "bad_request" });
    expect(await reserveSong(d, { key: key(1), deviceId: "../etc/passwd", nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "bad_request" });
    expect((d.raw.prepare("select count(*) as n from song_reservations").get() as { n: number }).n).toBe(0);
  });
});

describe("refunds, commits and expiry", () => {
  it("a refund before the call gives the slot AND the budget back; a failed order too", async () => {
    const d = fresh();
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, { ...CFG, monthlyBudget: 1 });
    expect(await reserveSong(d, { key: key(2), deviceId: DEV, nowMs: NOW }, { ...CFG, monthlyBudget: 1 })).toEqual({ ok: false, reason: "budget_spent" });
    expect(await refundSong(d, key(1), "provider_failed", NOW)).toBe(true);
    expect((await statusFor(d, DEV, NOW, "UTC")).used).toBe(0);
    expect((await reserveSong(d, { key: key(3), deviceId: DEV, nowMs: NOW }, { ...CFG, monthlyBudget: 1 })).ok).toBe(true);
  });
  it("commit keeps the slot; a grown-up removing a committed song gives the child's slot back but NOT the budget", async () => {
    const d = fresh();
    const cfg = { ...CFG, monthlyBudget: 1 };
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, cfg);
    expect(await commitSong(d, key(1), NOW + 1000)).toBe(true);
    expect(await refundSong(d, key(1), "removed", NOW + 2000)).toBe(true);
    expect((await statusFor(d, DEV, NOW, "UTC")).left).toBe(DAILY_SONGS);
    expect(await reserveSong(d, { key: key(2), deviceId: DEV, nowMs: NOW }, cfg)).toEqual({ ok: false, reason: "budget_spent" });
  });
  it("a slot held past the time limit expires: the child's slot returns, the budget stays spent (the call may have been paid)", async () => {
    const d = fresh();
    const cfg = { ...CFG, monthlyBudget: 1 };
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, cfg);
    const later = NOW + RESERVE_TTL_MS + 1000;
    expect(await reserveSong(d, { key: key(2), deviceId: DEV, nowMs: later }, cfg)).toEqual({ ok: false, reason: "budget_spent" });
    expect((d.raw.prepare("select state, refund_reason from song_reservations where key = ?").get(key(1)) as { state: string; refund_reason: string })).toEqual({ state: "refunded", refund_reason: "expired" });
  });
  it("cannot commit a refunded slot or an unknown one", async () => {
    const d = fresh();
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG);
    await refundSong(d, key(1), "rejected_before_call", NOW);
    expect(await commitSong(d, key(1), NOW)).toBe(false);
    expect(await commitSong(d, key(9), NOW)).toBe(false);
    expect(await refundSong(d, key(9), "provider_failed", NOW)).toBe(false);
  });
  it("a fresh attempt under an old refunded key does not inherit the old task or words", async () => {
    const d = fresh();
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG);
    await attachSong(d, key(1), "111111111", "{\"name\":\"old\"}");
    await refundSong(d, key(1), "provider_failed", NOW);
    const retry = await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW + 10 }, CFG);
    expect(retry).toMatchObject({ ok: true, replay: false, task: null, payload: null });
    expect(await reservationOfTask(d, "111111111")).toBeNull();
  });
});

describe("the monthly budget is global", () => {
  it("is spent by every device together and fails closed when it is not a number", async () => {
    const d = fresh();
    const cfg = { ...CFG, monthlyBudget: 2 };
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, cfg);
    await reserveSong(d, { key: key(2), deviceId: OTHER, nowMs: NOW }, cfg);
    expect(await reserveSong(d, { key: key(3), deviceId: "third-device-1234", nowMs: NOW }, cfg)).toEqual({ ok: false, reason: "budget_spent" });
    for (const bad of [undefined, "100", -1, NaN, 1.5]) expect(await reserveSong(fresh(), { key: key(1), deviceId: DEV, nowMs: NOW }, { ...CFG, monthlyBudget: bad })).toEqual({ ok: false, reason: "budget_spent" });
  });
  it("a new month has a new budget", async () => {
    const d = fresh();
    const cfg = { ...CFG, monthlyBudget: 1 };
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, cfg);
    expect((await reserveSong(d, { key: key(2), deviceId: OTHER, nowMs: Date.UTC(2026, 11, 2) }, cfg)).ok).toBe(true);
  });
});

describe("two requests that race past the first check", () => {
  it("cannot both keep the last slot: the earlier keeps it, the later gives it back", async () => {
    const d = fresh();
    // nine slots used, one left. Simulate the race: both requests pass the first check against the same snapshot, so insert both rows directly, then run the verification of each.
    for (let i = 1; i <= DAILY_SONGS - 1; i++) await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW + i }, CFG);
    const ins = d.raw.prepare(`insert into song_reservations (key, device_id, week_key, month_key, songs, state, created_ms) values (?, ?, '${TODAY}', '2026-11', 1, 'reserved', ?)`);
    ins.run(key(50), DEV, NOW + 100);
    // the later request now runs through the real path: its check sees 10 live rows and refuses at once
    expect(await reserveSong(d, { key: key(51), deviceId: DEV, nowMs: NOW + 101 }, CFG)).toEqual({ ok: false, reason: "week_used" });
    expect((await statusFor(d, DEV, NOW, "UTC")).used).toBe(DAILY_SONGS);
  });
  it("the verification step refuses a request whose slot only exists because it raced, and only that one", async () => {
    const d = fresh();
    for (let i = 1; i <= DAILY_SONGS - 1; i++) await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW + i }, CFG);
    // wrap the database: when the later request has passed its check and inserted, an EARLIER row appears (the other request's insert landing first)
    let injected = false;
    let loads = 0;
    const racing = {
      ...d,
      prepare: (sql: string) => {
        const p = d.prepare(sql);
        return {
          bind: (...v: unknown[]) => {
            const b = p.bind(...v);
            if (/^SELECT .* FROM song_reservations WHERE month_key = \?/.test(sql) && v.includes(key(60)) && !injected) {
              const orig = b.all;
              return { ...b, all: async () => { loads++; if (loads === 2 && !injected) { /* the second load is the verification: an earlier request's row has just landed */ injected = true; d.raw.prepare(`insert into song_reservations (key, device_id, week_key, month_key, songs, state, created_ms) values (?, ?, '${TODAY}', '2026-11', 1, 'reserved', ?)`).run(key(59), DEV, NOW + 1); } return orig(); } };
            }
            return b;
          },
        };
      },
    } as unknown as ReturnType<typeof fresh>;
    const later = await reserveSong(racing, { key: key(60), deviceId: DEV, nowMs: NOW + 200 }, CFG);
    expect(later).toEqual({ ok: false, reason: "week_used" });
    expect((d.raw.prepare("select state, refund_reason from song_reservations where key = ?").get(key(60)) as { state: string; refund_reason: string })).toEqual({ state: "refunded", refund_reason: "rejected_before_call" });
    expect((d.raw.prepare("select state from song_reservations where key = ?").get(key(59)) as { state: string }).state).toBe("reserved");
  });
});

describe("a grown-up's settings", () => {
  it("default to on and ten, a stored choice is honoured, and the limit can only lower", async () => {
    const d = fresh();
    expect(await readSongSettings(d, DEV)).toEqual({ makerOn: true, limit: DAILY_SONGS });
    expect(await writeSongSettings(d, DEV, { limit: 2 })).toEqual({ makerOn: true, limit: 2 });
    for (let i = 1; i <= 2; i++) await reserveSong(d, { key: key(i), deviceId: DEV, nowMs: NOW }, CFG);
    expect(await reserveSong(d, { key: key(3), deviceId: DEV, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "week_used" });
    expect(await writeSongSettings(d, DEV, { makerOn: false })).toEqual({ makerOn: false, limit: 2 });
    expect(await reserveSong(d, { key: key(4), deviceId: OTHER, nowMs: NOW }, CFG)).toMatchObject({ ok: true }); // another device is unaffected
    expect(await reserveSong(d, { key: key(5), deviceId: DEV, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "not_enabled" });
    expect((await statusFor(d, DEV, NOW, "UTC")).makerOn).toBe(false);
  });
  it("a limit of 0 means no new songs, and a corrupt stored value reads as off or 0, never as more", async () => {
    const d = fresh();
    await writeSongSettings(d, DEV, { limit: 0 });
    expect(await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG)).toEqual({ ok: false, reason: "week_used" });
    d.raw.prepare("update song_settings set maker_on = 7, weekly_limit = 99 where device_id = ?").run(DEV);
    expect(await readSongSettings(d, DEV)).toEqual({ makerOn: false, limit: DAILY_SONGS }); // 99 is capped at 10, and 7 is not "on"
    d.raw.prepare("update song_settings set weekly_limit = 2.5 where device_id = ?").run(DEV);
    expect((await readSongSettings(d, DEV)).limit).toBe(0); // not a whole number: 0, never more
  });
  it("validates an update: only a boolean and a whole number 0 to 10, and something to change", () => {
    expect(parseSongSettingsUpdate({ makerOn: false, limit: 3 })).toEqual({ ok: true, makerOn: false, limit: 3 });
    expect(parseSongSettingsUpdate({ limit: 0 })).toEqual({ ok: true, limit: 0 });
    expect(parseSongSettingsUpdate({ limit: 10 })).toEqual({ ok: true, limit: 10 }); // the ceiling is a day's ten
    expect(parseSongSettingsUpdate({ limit: 7 })).toEqual({ ok: true, limit: 7 });
    for (const bad of [null, [], "x", {}, { limit: 11 }, { limit: 100 }, { limit: -1 }, { limit: 2.5 }, { limit: "3" }, { makerOn: "yes" }, { makerOn: 1 }]) expect(parseSongSettingsUpdate(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe("who owns a song", () => {
  it("a task belongs to the device that reserved it, and its stored flag can be set", async () => {
    const d = fresh();
    await reserveSong(d, { key: key(1), deviceId: DEV, nowMs: NOW }, CFG);
    await attachSong(d, key(1), "170010186285057", "{}");
    expect(await reservationOfTask(d, "170010186285057")).toEqual({ key: key(1), deviceId: DEV, state: "reserved", stored: false });
    await commitSong(d, key(1), NOW);
    await markStored(d, key(1));
    expect(await reservationOfTask(d, "170010186285057")).toEqual({ key: key(1), deviceId: DEV, state: "committed", stored: true });
    expect(await reservationOfTask(d, "999999999")).toBeNull();
  });
});
