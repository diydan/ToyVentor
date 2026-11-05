// Bedtime: the toy goes to bed in the last minute before play stops for the night (quiet hours) or for the day (the daily limit), and is in bed while it is stopped for either
// (Dan, 2026-11-05: "Kip going to bed by himself at quiet hours"). shared/parent-time.ts `PlayTimeStatus.bedtime`, `BEDTIME_LEAD_SECONDS`, `secondsUntilQuietHours`. A sitting limit is a
// break, not a night: the toy stays up. Each rule is run on the real engine at its exact boundary.
import { describe, expect, it } from "vitest";
import {
  BEDTIME_LEAD_SECONDS,
  defaultParentSettings,
  emptyLedgerForDay,
  evaluatePlayTime,
  localDay,
  secondsUntilQuietHours,
  validateAndMergeParentSettings,
  type ParentSettings,
  type QuietHours,
} from "../shared/parent-time";
import { effectiveParentSnapshot } from "../src/lib/parentControls";

const QUIET: QuietHours = { enabled: true, start: "19:00", end: "07:00" };
function settings(over: Record<string, unknown> = {}, tz = "UTC"): ParentSettings {
  const merged = validateAndMergeParentSettings(defaultParentSettings(tz), {
    enabled: true, dailyBaseMinutes: 20, dailyLimitMinutes: 60, sessionLimitMinutes: null, quietHours: { enabled: false, start: "19:00", end: "07:00" }, ...over,
  });
  if (!merged.ok) throw new Error(merged.errors.join(", "));
  return merged.settings;
}
const AT = (hms: string, day = "2026-11-05") => Date.parse(`${day}T${hms}Z`);
const used = (s: ParentSettings, now: number, seconds: number) => ({ ...emptyLedgerForDay(localDay(now, s.timezone)), usedSeconds: seconds });

describe("how long until quiet hours begin", () => {
  it("counts the seconds to the start, to the second, and is null when they are off, empty, or already running", () => {
    expect(secondsUntilQuietHours(AT("18:58:30"), "UTC", QUIET)).toBe(90);
    expect(secondsUntilQuietHours(AT("18:59:00"), "UTC", QUIET)).toBe(60);
    expect(secondsUntilQuietHours(AT("18:59:59"), "UTC", QUIET)).toBe(1);
    expect(secondsUntilQuietHours(AT("19:00:00"), "UTC", QUIET), "at the start they are running").toBeNull();
    expect(secondsUntilQuietHours(AT("03:00:00"), "UTC", QUIET), "overnight, inside").toBeNull();
    expect(secondsUntilQuietHours(AT("12:00:00"), "UTC", QUIET)).toBe(7 * 3600);
    expect(secondsUntilQuietHours(AT("18:58:30"), "UTC", { ...QUIET, enabled: false })).toBeNull();
    expect(secondsUntilQuietHours(AT("18:58:30"), "UTC", { enabled: true, start: "19:00", end: "19:00" })).toBeNull();
  });
  it("reads the family's own clock, and the next day's start after the window has ended (a daytime window too)", () => {
    // 2026-11-06 02:58:30 UTC is 18:58:30 in Los Angeles (PST, UTC-8, after the clocks went back)
    expect(secondsUntilQuietHours(Date.parse("2026-11-06T02:58:30Z"), "America/Los_Angeles", QUIET)).toBe(90);
    expect(secondsUntilQuietHours(AT("08:00:00"), "UTC", { enabled: true, start: "13:00", end: "14:00" })).toBe(5 * 3600);
    expect(secondsUntilQuietHours(AT("14:00:00"), "UTC", { enabled: true, start: "13:00", end: "14:00" })).toBe(23 * 3600);
  });
});

describe("bedtime: quiet hours", () => {
  const s = settings({ quietHours: QUIET });
  it("starts at the lead and not before: 61 s out is up, 60 s out is bedtime, and the last second still is", () => {
    expect(BEDTIME_LEAD_SECONDS).toBe(60);
    for (const [hms, want] of [["18:58:59", false], ["18:59:00", true], ["18:59:30", true], ["18:59:59", true]] as const) {
      const st = evaluatePlayTime(AT(hms), s, emptyLedgerForDay("2026-11-05"));
      expect(st.bedtime, hms).toBe(want);
      expect(st.locked, hms).toBe(false);
    }
  });
  it("is bedtime while they run (the curtain is up and he is in bed), and not once they end", () => {
    const night = evaluatePlayTime(AT("19:00:00"), s, emptyLedgerForDay("2026-11-05"));
    expect(night).toMatchObject({ locked: true, reason: "quiet_hours", bedtime: true });
    expect(evaluatePlayTime(AT("03:00:00", "2026-11-06"), s, emptyLedgerForDay("2026-11-06")).bedtime).toBe(true);
    const morning = evaluatePlayTime(AT("07:00:00", "2026-11-06"), s, emptyLedgerForDay("2026-11-06"));
    expect(morning).toMatchObject({ locked: false, bedtime: false });
  });
  it("works in the family's own time zone", () => {
    const la = settings({ quietHours: QUIET }, "America/Los_Angeles");
    const now = Date.parse("2026-11-06T02:59:00Z");   // 18:59:00 in Los Angeles
    expect(evaluatePlayTime(now, la, emptyLedgerForDay(localDay(now, "America/Los_Angeles"))).bedtime).toBe(true);
    expect(evaluatePlayTime(now - 2000, la, emptyLedgerForDay(localDay(now, "America/Los_Angeles"))).bedtime).toBe(false);
  });
  it("is off when Play Time is off, whatever the quiet hours say", () => {
    const off = settings({ enabled: false, quietHours: QUIET });
    expect(evaluatePlayTime(AT("18:59:30"), off, emptyLedgerForDay("2026-11-05"))).toMatchObject({ bedtime: false, locked: false });
    expect(evaluatePlayTime(AT("22:00:00"), off, emptyLedgerForDay("2026-11-05")).bedtime).toBe(false);
  });
});

describe("bedtime: the day's limit", () => {
  const s = settings();     // 20 minutes a day, no quiet hours, no sitting limit
  const now = AT("15:00:00");
  it("starts in the last minute, and is bedtime once the day is used up", () => {
    for (const [secs, want, locked] of [[1138, false, false], [1139, false, false], [1140, true, false], [1199, true, false], [1200, true, true], [5000, true, true]] as const) {
      const st = evaluatePlayTime(now, s, used(s, now, secs));
      expect(st.bedtime, `${secs} s used`).toBe(want);
      expect(st.locked, `${secs} s used`).toBe(locked);
    }
    expect(evaluatePlayTime(now, s, used(s, now, 1200)).reason).toBe("daily_limit");
  });
  it("wakes him when a grown-up gives more time: the lock lifts and so does bedtime", () => {
    const more = { ...used(s, now, 1200), extraParentMinutes: 10 };
    const st = evaluatePlayTime(now, s, more);
    expect(st).toMatchObject({ locked: false, bedtime: false });
  });
});

describe("bedtime: a sitting limit is a break, not a night", () => {
  const s = settings({ sessionLimitMinutes: 5 });    // a 5 minute sitting, a 20 minute day
  const now = AT("15:00:00");
  const sat = (sessionUsed: number, usedToday = 100) => ({ ...used(s, now, usedToday), sessionUsedSeconds: sessionUsed });
  it("the last minute of a sitting has the twilight but no bedtime, and the stopped sitting is not bedtime", () => {
    const soon = evaluatePlayTime(now, s, sat(250));        // 50 s of the sitting left, 18 minutes of the day
    expect(soon.twilightCue).toBe(true);
    expect(soon.bedtime).toBe(false);
    const done = evaluatePlayTime(now, s, sat(300));
    expect(done).toMatchObject({ locked: true, reason: "session_limit", bedtime: false });
  });
  it("but when the DAY ends first inside the same minute, it is bedtime (the day's limit is what stops play), and when the sitting ends first it is not", () => {
    // the day has 20 s left and the sitting 30 s: the day stops play first
    const day = evaluatePlayTime(now, s, sat(270, 1180));
    expect(day.remainingSeconds).toBe(20);
    expect(day.bedtime).toBe(true);
    // the sitting has 20 s left and the day 30 s: the sitting stops play first, so it is a break
    const sitting = evaluatePlayTime(now, s, sat(280, 1170));
    expect(sitting.remainingSeconds).toBe(20);
    expect(sitting.bedtime).toBe(false);
  });
});

describe("quiet hours that start inside the day's last minute, and the demo override", () => {
  it("either one is bedtime", () => {
    const s = settings({ quietHours: QUIET });
    const now = AT("18:59:30");
    expect(evaluatePlayTime(now, s, used(s, now, 100)).bedtime).toBe(true);
    expect(evaluatePlayTime(now, s, used(s, now, 1170)).bedtime).toBe(true);
  });
  it("controls off (a demo) never puts him to bed: the override reads as Play Time switched off, bedtime included", () => {
    const s = settings({ quietHours: QUIET });
    const snapshot = { settings: s, ledger: emptyLedgerForDay("2026-11-05"), status: evaluatePlayTime(AT("19:30:00"), s, emptyLedgerForDay("2026-11-05")) } as never;
    expect((snapshot as { status: { bedtime: boolean } }).status.bedtime).toBe(true);
    const eff = effectiveParentSnapshot(snapshot, "off") as unknown as { status: { bedtime: boolean; locked: boolean } };
    expect(eff.status.bedtime).toBe(false);
    expect(eff.status.locked).toBe(false);
    expect(effectiveParentSnapshot(snapshot, "on")).toBe(snapshot);
    // the lead-in too
    const lead = { settings: s, ledger: emptyLedgerForDay("2026-11-05"), status: evaluatePlayTime(AT("18:59:30"), s, emptyLedgerForDay("2026-11-05")) } as never;
    expect((lead as { status: { bedtime: boolean } }).status.bedtime).toBe(true);
    expect((effectiveParentSnapshot(lead, "off") as unknown as { status: { bedtime: boolean } }).status.bedtime).toBe(false);
  });
});
