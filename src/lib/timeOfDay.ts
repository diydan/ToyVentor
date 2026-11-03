// One clock for "is it day or night" so the trail map, and later the 3D worlds
// and the Garage, always agree. Two looks only (Dan, 2026-11-03): day and
// night. Night is the same scene with the lights on and its own lighting, not
// a different place; indoor scenes look the same either way.
//
// Auto follows the user's local time: the device's own clock, which follows the
// user when they travel. (The grown-up's timezone setting, used for play-time
// limits and quiet hours, is saved once and can go stale, so the look does not
// use it.) A grown-up can pin Day or Night, which also makes it easy to show
// either on demand.

export type TimeOfDay = "day" | "night";
export type TimeOfDayMode = "auto" | "day" | "night";

/** Local hour the day look starts (07:00) and the night look starts (19:00). */
export const DAY_FROM_HOUR = 7;
export const NIGHT_FROM_HOUR = 19;

/** The hour of day, 0-23, in the given timezone; the device's own clock if none or invalid. */
export function localHour(nowMs: number, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    if (Number.isFinite(h)) return ((h % 24) + 24) % 24;
  } catch {
    /* an unknown timezone name: fall back to the device clock */
  }
  return new Date(nowMs).getHours();
}

/** Day or night right now. A pinned mode wins; auto reads the clock. */
export function timeOfDayFor(
  nowMs: number,
  timeZone: string | undefined,
  mode: TimeOfDayMode = "auto",
): TimeOfDay {
  if (mode === "day" || mode === "night") return mode;
  const h = localHour(nowMs, timeZone);
  return h >= DAY_FROM_HOUR && h < NIGHT_FROM_HOUR ? "day" : "night";
}

const KEY = "tvTimeOfDay:v1";

export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ModeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const isTimeOfDayMode = (v: unknown): v is TimeOfDayMode =>
  v === "auto" || v === "day" || v === "night";

/** The pinned mode on this device; anything missing or unrecognised is auto. */
export function loadTimeOfDayMode(storage: ModeStorage | null = defaultStorage()): TimeOfDayMode {
  try {
    const v = storage?.getItem(KEY);
    return isTimeOfDayMode(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

/** Remember the mode on this device (a display preference, not progress). */
export function saveTimeOfDayMode(
  mode: TimeOfDayMode,
  storage: ModeStorage | null = defaultStorage(),
): boolean {
  if (!storage || !isTimeOfDayMode(mode)) return false;
  try {
    storage.setItem(KEY, mode);
    return true;
  } catch {
    return false;
  }
}
