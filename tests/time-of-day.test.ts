import { describe, expect, it } from "vitest";
import {
  DAY_FROM_HOUR,
  loadTimeOfDayMode,
  localHour,
  NIGHT_FROM_HOUR,
  saveTimeOfDayMode,
  timeOfDayFor,
  type ModeStorage,
} from "../src/lib/timeOfDay";

/** A UTC instant at hh:mm on 2026-11-03. */
const utc = (hh: number, mm = 0): number => Date.UTC(2026, 10, 3, hh, mm);

const memory = (): ModeStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("time of day", () => {
  it("day is 07:00 to 18:59 and night is the rest, in the given timezone", () => {
    expect([DAY_FROM_HOUR, NIGHT_FROM_HOUR]).toEqual([7, 19]);
    const at = (h: number, m = 0) => timeOfDayFor(utc(h, m), "UTC", "auto");
    expect(at(0)).toBe("night");
    expect(at(6, 59)).toBe("night");
    expect(at(7, 0)).toBe("day");
    expect(at(12)).toBe("day");
    expect(at(18, 59)).toBe("day");
    expect(at(19, 0)).toBe("night");
    expect(at(23, 59)).toBe("night");
  });

  it("reads the hour in the timezone it is given (the game passes none: the device clock)", () => {
    const noonUtc = utc(12);
    expect(localHour(noonUtc, "UTC")).toBe(12);
    // 12:00 UTC is 13:00 in Berlin (winter) and 04:00 in Los Angeles.
    expect(localHour(noonUtc, "Europe/Berlin")).toBe(13);
    expect(localHour(noonUtc, "America/Los_Angeles")).toBe(4);
    expect(timeOfDayFor(noonUtc, "Europe/Berlin", "auto")).toBe("day");
    expect(timeOfDayFor(noonUtc, "America/Los_Angeles", "auto")).toBe("night");
    // Midnight is hour 0, never 24.
    expect(localHour(utc(0), "UTC")).toBe(0);
  });

  it("falls back to the device clock for a missing or unknown timezone", () => {
    const now = utc(12);
    const device = new Date(now).getHours();
    expect(localHour(now, undefined)).toBe(device);
    expect(localHour(now, "Not/AZone")).toBe(device);
    expect(["day", "night"]).toContain(timeOfDayFor(now, "Not/AZone", "auto"));
  });

  it("a pinned mode wins over the clock", () => {
    expect(timeOfDayFor(utc(3), "UTC", "day")).toBe("day");
    expect(timeOfDayFor(utc(13), "UTC", "night")).toBe("night");
    expect(timeOfDayFor(utc(3), "UTC", "auto")).toBe("night");
    // No mode given means auto.
    expect(timeOfDayFor(utc(13), "UTC")).toBe("day");
  });
});

describe("the pinned mode on the device", () => {
  it("is auto until set, then remembered, and bad values read as auto", () => {
    const store = memory();
    expect(loadTimeOfDayMode(store)).toBe("auto");
    expect(saveTimeOfDayMode("night", store)).toBe(true);
    expect(loadTimeOfDayMode(store)).toBe("night");
    expect(saveTimeOfDayMode("day", store)).toBe(true);
    expect(loadTimeOfDayMode(store)).toBe("day");
    store.setItem("tvTimeOfDay:v1", "dusk");
    expect(loadTimeOfDayMode(store)).toBe("auto");
    expect(saveTimeOfDayMode("dusk" as never, store)).toBe(false);
  });

  it("survives storage that is missing or blocked", () => {
    expect(loadTimeOfDayMode(null)).toBe("auto");
    expect(saveTimeOfDayMode("day", null)).toBe(false);
    const blocked: ModeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadTimeOfDayMode(blocked)).toBe("auto");
    expect(saveTimeOfDayMode("night", blocked)).toBe(false);
  });
});
