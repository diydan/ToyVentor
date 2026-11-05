// Pure rule engine for Parent Time Gates & STEM Earned Play Time.
// Runs identically in the Cloudflare Worker (authoritative D1 ledger) and in
// the browser (local-first mirror when offline or unmigrated).

export type GateStrictness = "every_time" | "sitting_window";

export interface QuietHours {
  enabled: boolean;
  /** 24-hour "HH:MM" in `settings.timezone` (e.g. "19:30"). */
  start: string;
  /** 24-hour "HH:MM" in `settings.timezone` (e.g. "07:00"). */
  end: string;
}

export interface ParentSettings {
  enabled: boolean;
  timezone: string;
  /** Guaranteed daily play allowance in whole minutes (5..180). */
  dailyBaseMinutes: number;
  /** Hard daily ceiling in whole minutes (>= dailyBaseMinutes, 5..240).
   *  STEM challenge awards can never push daily play past this number. */
  dailyLimitMinutes: number;
  /** Minutes earned per unique STEM mission completed today (0..15). */
  minutesPerChallenge: number;
  /** Optional cap for the current sitting in whole minutes (5..120 or null). */
  sessionLimitMinutes: number | null;
  quietHours: QuietHours;
  gateStrictness: GateStrictness;
  /** Salted SHA-256 hex digest when a 4-digit parent PIN is configured;
   *  stripped before sending settings to the browser. */
  pinHash?: string | null;
  /** Consecutive failed PIN tries toward the 5-attempt cooldown; stripped before public responses. */
  pinFailedAttempts?: number;
  /** Epoch ms deadline for an active 30s PIN cooldown; stripped before public responses. */
  pinCooldownUntil?: number | null;
}

export interface PublicParentSettings
  extends Omit<ParentSettings, "pinHash" | "pinFailedAttempts" | "pinCooldownUntil"> {
  pinSet: boolean;
}

export interface TimeLedgerRow {
  /** Local calendar date "YYYY-MM-DD" in `settings.timezone`. */
  day: string;
  /** Monotonic active play seconds used on `day`. */
  usedSeconds: number;
  /** Bonus minutes earned from unique STEM missions on `day` (capped by headroom). */
  earnedMinutes: number;
  /** Explicit "+5 min" grace granted by a parent after unlocking the gate on `day`. */
  extraParentMinutes: number;
  /** Active play seconds in the current sitting. */
  sessionUsedSeconds: number;
  /** Unique mission keys credited on `day` (e.g. ["lab1.measure", "garden.bridge"]). */
  completedIds: string[];
}

export type PlayStopReason =
  | "disabled"
  | "active"
  | "daily_limit"
  | "session_limit"
  | "quiet_hours";

export interface PlayTimeStatus {
  day: string;
  enabled: boolean;
  inQuietHours: boolean;
  usedSeconds: number;
  earnedMinutes: number;
  /** min(dailyBaseMinutes + earnedMinutes, dailyLimitMinutes) */
  dailyCapMinutes: number;
  /** Maximum STEM bonus headroom remaining today (minutes). */
  earnHeadroomMinutes: number;
  extraParentMinutes: number;
  completedCount: number;
  dailyRemainingSeconds: number;
  sessionRemainingSeconds: number | null;
  /** Effective seconds remaining right now; null when Play Time is disabled. */
  remainingSeconds: number | null;
  /** Subtle warm golden-hour tint in the final 60s (never a visible clock). */
  twilightCue: boolean;
  /** True when play has ended and the calm Sleep Curtain should fade in. */
  locked: boolean;
  /**
   * The toy goes to bed: true in the last `BEDTIME_LEAD_SECONDS` before play stops for the night (quiet hours) or for the day (the daily limit), and while it is stopped for
   * either. Not for a sitting limit ("time for a break": the toy stays up). The game puts the toy to bed on it (it walks to its bed, or lies down where it is) so it is tucked
   * in when the curtain comes, and wakes it when play comes back. A status from a server that does not send it reads as false.
   */
  bedtime: boolean;
  reason: PlayStopReason;
}

export type ParentPresetId = "off" | "weeknight" | "weekend" | "quick15";

export interface ParentPreset {
  id: ParentPresetId;
  label: string;
  summary: string;
  patch: Pick<
    ParentSettings,
    | "enabled"
    | "dailyBaseMinutes"
    | "dailyLimitMinutes"
    | "minutesPerChallenge"
    | "sessionLimitMinutes"
  >;
}

export const PARENT_PRESETS: readonly ParentPreset[] = [
  {
    id: "off",
    label: "Off",
    summary: "Open play · no limit",
    patch: {
      enabled: false,
      dailyBaseMinutes: 20,
      dailyLimitMinutes: 30,
      minutesPerChallenge: 5,
      sessionLimitMinutes: null,
    },
  },
  {
    id: "weeknight",
    label: "Weeknight",
    summary: "20m + up to 10m STEM (30m cap)",
    patch: {
      enabled: true,
      dailyBaseMinutes: 20,
      dailyLimitMinutes: 30,
      minutesPerChallenge: 5,
      sessionLimitMinutes: null,
    },
  },
  {
    id: "weekend",
    label: "Weekend",
    summary: "45m + up to 15m STEM (60m cap)",
    patch: {
      enabled: true,
      dailyBaseMinutes: 45,
      dailyLimitMinutes: 60,
      minutesPerChallenge: 5,
      sessionLimitMinutes: null,
    },
  },
  {
    id: "quick15",
    label: "Quick 15m",
    summary: "15m sitting · 30m daily cap",
    patch: {
      enabled: true,
      dailyBaseMinutes: 20,
      dailyLimitMinutes: 30,
      minutesPerChallenge: 5,
      sessionLimitMinutes: 15,
    },
  },
] as const;

export const MAX_HEARTBEAT_SECONDS = 65;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_COOLDOWN_MS = 30_000;

export type PinAttemptOutcome =
  | {
      status: "ok";
      settings: ParentSettings;
      attemptsRemaining: number;
    }
  | {
      status: "mismatch";
      settings: ParentSettings;
      attemptsRemaining: number;
    }
  | {
      status: "cooldown";
      settings: ParentSettings;
      cooldownUntil: number;
      retryAfterSeconds: number;
      attemptsRemaining: 0;
    };

export function activePinCooldownUntil(
  settings: Pick<ParentSettings, "pinCooldownUntil">,
  nowMs: number,
): number | null {
  const until = settings.pinCooldownUntil;
  return typeof until === "number" && Number.isFinite(until) && until > nowMs
    ? until
    : null;
}

/** Shared 5-attempt / 30 s PIN cooldown state machine used by both Worker D1 and offline localStorage. */
export function evaluatePinAttempt(
  settings: ParentSettings,
  nowMs: number,
  pinMatches: boolean,
): PinAttemptOutcome {
  const activeUntil = activePinCooldownUntil(settings, nowMs);
  if (activeUntil !== null) {
    return {
      status: "cooldown",
      settings,
      cooldownUntil: activeUntil,
      retryAfterSeconds: Math.max(1, Math.ceil((activeUntil - nowMs) / 1000)),
      attemptsRemaining: 0,
    };
  }

  const priorAttempts =
    typeof settings.pinCooldownUntil === "number" && settings.pinCooldownUntil <= nowMs
      ? 0
      : Math.max(0, Math.floor(Number(settings.pinFailedAttempts) || 0));

  if (pinMatches) {
    return {
      status: "ok",
      settings: {
        ...settings,
        pinFailedAttempts: 0,
        pinCooldownUntil: null,
      },
      attemptsRemaining: PIN_MAX_ATTEMPTS,
    };
  }

  const nextAttempts = priorAttempts + 1;
  if (nextAttempts >= PIN_MAX_ATTEMPTS) {
    const cooldownUntil = nowMs + PIN_COOLDOWN_MS;
    return {
      status: "cooldown",
      settings: {
        ...settings,
        pinFailedAttempts: nextAttempts,
        pinCooldownUntil: cooldownUntil,
      },
      cooldownUntil,
      retryAfterSeconds: Math.max(1, Math.ceil(PIN_COOLDOWN_MS / 1000)),
      attemptsRemaining: 0,
    };
  }

  return {
    status: "mismatch",
    settings: {
      ...settings,
      pinFailedAttempts: nextAttempts,
      pinCooldownUntil: null,
    },
    attemptsRemaining: PIN_MAX_ATTEMPTS - nextAttempts,
  };
}

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MISSION_ID_RE = /^[A-Za-z0-9_.-]{2,64}$/;
const PIN_RE = /^\d{4}$/;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_RE.test(pin);
}

export function isMissionId(id: unknown): id is string {
  return typeof id === "string" && MISSION_ID_RE.test(id);
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function defaultTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(resolved)) return resolved;
  } catch {
    /* ignore */
  }
  return "UTC";
}

export function defaultParentSettings(timezone = defaultTimeZone()): ParentSettings {
  return {
    enabled: false,
    timezone: isValidTimeZone(timezone) ? timezone : "UTC",
    dailyBaseMinutes: 20,
    dailyLimitMinutes: 30,
    minutesPerChallenge: 5,
    sessionLimitMinutes: null,
    quietHours: {
      enabled: false,
      start: "19:30",
      end: "07:00",
    },
    gateStrictness: "every_time",
    pinHash: null,
    pinFailedAttempts: 0,
    pinCooldownUntil: null,
  };
}

export function sanitizeParentSettings(settings: ParentSettings): PublicParentSettings {
  const {
    pinHash,
    pinFailedAttempts: _attempts,
    pinCooldownUntil: _cooldown,
    ...rest
  } = settings;
  return {
    ...rest,
    pinSet: Boolean(pinHash),
  };
}

/** Local "YYYY-MM-DD" in `timezone`. Never carries yesterday's balance forward. */
export function localDay(nowMs: number, timezone: string): string {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function parseMinutesOfDay(hhmm: string): number | null {
  const m = HH_MM_RE.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function localMinutesOfDay(nowMs: number, timezone: string): number {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const rawHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** How long before play stops for the night or for the day the toy starts for bed: the walk, the hop and the settling take up to about 14 s, and the warm twilight cue is the same minute. */
export const BEDTIME_LEAD_SECONDS = 60;

/**
 * Seconds until quiet hours next begin, or null when they are off, empty, or running now. Minutes of the day are whole in every time zone, so the seconds are the clock's own.
 */
export function secondsUntilQuietHours(nowMs: number, timezone: string, quietHours: QuietHours): number | null {
  if (!quietHours.enabled) return null;
  const start = parseMinutesOfDay(quietHours.start);
  const end = parseMinutesOfDay(quietHours.end);
  if (start === null || end === null || start === end) return null;
  if (isInQuietHours(nowMs, timezone, quietHours)) return null;
  const current = localMinutesOfDay(nowMs, timezone);
  const minutes = (start - current + 1440) % 1440;
  const secondOfMinute = Math.floor(nowMs / 1000) % 60;
  return minutes * 60 - secondOfMinute;
}

export function isInQuietHours(
  nowMs: number,
  timezone: string,
  quietHours: QuietHours,
): boolean {
  if (!quietHours.enabled) return false;
  const start = parseMinutesOfDay(quietHours.start);
  const end = parseMinutesOfDay(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const current = localMinutesOfDay(nowMs, timezone);
  if (start < end) {
    return current >= start && current < end;
  }
  // Overnight wrap, e.g. 19:30 -> 07:00
  return current >= start || current < end;
}

export function emptyLedgerForDay(day: string): TimeLedgerRow {
  return {
    day,
    usedSeconds: 0,
    earnedMinutes: 0,
    extraParentMinutes: 0,
    sessionUsedSeconds: 0,
    completedIds: [],
  };
}

/** Ensure ledger matches today's local date; crossing midnight resets everything. */
export function normalizeLedgerForNow(
  ledger: TimeLedgerRow | null | undefined,
  settings: ParentSettings,
  nowMs: number,
): TimeLedgerRow {
  const today = localDay(nowMs, settings.timezone);
  if (!ledger || ledger.day !== today) {
    return emptyLedgerForDay(today);
  }
  const maxEarnable = Math.max(0, settings.dailyLimitMinutes - settings.dailyBaseMinutes);
  return {
    day: today,
    usedSeconds: Math.max(0, Math.floor(Number(ledger.usedSeconds) || 0)),
    earnedMinutes: Math.max(
      0,
      Math.min(maxEarnable, Math.floor(Number(ledger.earnedMinutes) || 0)),
    ),
    extraParentMinutes: Math.max(
      0,
      Math.min(180, Math.floor(Number(ledger.extraParentMinutes) || 0)),
    ),
    sessionUsedSeconds: Math.max(0, Math.floor(Number(ledger.sessionUsedSeconds) || 0)),
    completedIds: Array.isArray(ledger.completedIds)
      ? [...new Set(ledger.completedIds.filter(isMissionId))]
      : [],
  };
}

export function evaluatePlayTime(
  nowMs: number,
  settings: ParentSettings,
  rawLedger: TimeLedgerRow | null | undefined,
): PlayTimeStatus {
  const ledger = normalizeLedgerForNow(rawLedger, settings, nowMs);
  const dailyCapMinutes = Math.min(
    settings.dailyBaseMinutes + ledger.earnedMinutes,
    settings.dailyLimitMinutes,
  );
  const earnHeadroomMinutes = Math.max(
    0,
    settings.dailyLimitMinutes - dailyCapMinutes,
  );
  const totalDailySeconds = (dailyCapMinutes + ledger.extraParentMinutes) * 60;
  const dailyRemainingSeconds = Math.max(0, totalDailySeconds - ledger.usedSeconds);
  const sessionRemainingSeconds =
    settings.sessionLimitMinutes !== null
      ? Math.max(0, settings.sessionLimitMinutes * 60 - ledger.sessionUsedSeconds)
      : null;
  const inQuiet = isInQuietHours(nowMs, settings.timezone, settings.quietHours);

  if (!settings.enabled) {
    return {
      day: ledger.day,
      enabled: false,
      inQuietHours: false,
      usedSeconds: ledger.usedSeconds,
      earnedMinutes: ledger.earnedMinutes,
      dailyCapMinutes,
      earnHeadroomMinutes,
      extraParentMinutes: ledger.extraParentMinutes,
      completedCount: ledger.completedIds.length,
      dailyRemainingSeconds,
      sessionRemainingSeconds,
      remainingSeconds: null,
      twilightCue: false,
      locked: false,
      bedtime: false,
      reason: "disabled",
    };
  }

  if (inQuiet) {
    return {
      day: ledger.day,
      enabled: true,
      inQuietHours: true,
      usedSeconds: ledger.usedSeconds,
      earnedMinutes: ledger.earnedMinutes,
      dailyCapMinutes,
      earnHeadroomMinutes,
      extraParentMinutes: ledger.extraParentMinutes,
      completedCount: ledger.completedIds.length,
      dailyRemainingSeconds,
      sessionRemainingSeconds,
      remainingSeconds: 0,
      twilightCue: false,
      locked: true,
      bedtime: true,
      reason: "quiet_hours",
    };
  }

  const remainingSeconds =
    sessionRemainingSeconds !== null
      ? Math.min(dailyRemainingSeconds, sessionRemainingSeconds)
      : dailyRemainingSeconds;

  let reason: PlayStopReason = "active";
  if (remainingSeconds <= 0) {
    reason =
      dailyRemainingSeconds <= 0
        ? "daily_limit"
        : "session_limit";
  }

  // Bedtime: the day's limit is what stops play (it is not later than a sitting limit), or quiet hours begin soon. A sitting limit is a break, not a night.
  const dailyStopsPlay = sessionRemainingSeconds === null || dailyRemainingSeconds <= sessionRemainingSeconds;
  const dailySoon = dailyStopsPlay && remainingSeconds > 0 && remainingSeconds <= BEDTIME_LEAD_SECONDS;
  const dailyDone = remainingSeconds <= 0 && reason === "daily_limit";
  const untilQuiet = secondsUntilQuietHours(nowMs, settings.timezone, settings.quietHours);
  const quietSoon = untilQuiet !== null && untilQuiet > 0 && untilQuiet <= BEDTIME_LEAD_SECONDS;

  return {
    day: ledger.day,
    enabled: true,
    inQuietHours: false,
    usedSeconds: ledger.usedSeconds,
    earnedMinutes: ledger.earnedMinutes,
    dailyCapMinutes,
    earnHeadroomMinutes,
    extraParentMinutes: ledger.extraParentMinutes,
    completedCount: ledger.completedIds.length,
    dailyRemainingSeconds,
    sessionRemainingSeconds,
    remainingSeconds,
    twilightCue: remainingSeconds > 0 && remainingSeconds <= 60,
    locked: remainingSeconds <= 0,
    bedtime: dailySoon || dailyDone || quietSoon,
    reason,
  };
}

/** Monotonically record active play seconds. Negative/NaN deltas (e.g. clock
 *  moved backwards) grant nothing and never reduce `usedSeconds`. */
export function recordActivePlay(
  rawLedger: TimeLedgerRow | null | undefined,
  settings: ParentSettings,
  nowMs: number,
  deltaSeconds: number,
): TimeLedgerRow {
  const ledger = normalizeLedgerForNow(rawLedger, settings, nowMs);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return ledger;
  // Do not accumulate active play time while locked in quiet hours.
  if (settings.enabled && isInQuietHours(nowMs, settings.timezone, settings.quietHours)) {
    return ledger;
  }
  const bounded = Math.min(MAX_HEARTBEAT_SECONDS, Math.floor(deltaSeconds));
  if (bounded <= 0) return ledger;
  return {
    ...ledger,
    usedSeconds: ledger.usedSeconds + bounded,
    sessionUsedSeconds: ledger.sessionUsedSeconds + bounded,
  };
}

export interface MissionAwardResult {
  ledger: TimeLedgerRow;
  awardedMinutes: number;
  newlyCreditedIds: string[];
}

/** Credit unique STEM missions completed today. Never exceeds `dailyLimitMinutes`,
 *  never double-counts a mission on the same local day, and never goes negative. */
export function recordMissionCompletions(
  rawLedger: TimeLedgerRow | null | undefined,
  settings: ParentSettings,
  nowMs: number,
  missionIds: readonly string[],
): MissionAwardResult {
  const ledger = normalizeLedgerForNow(rawLedger, settings, nowMs);
  const seen = new Set(ledger.completedIds);
  const newlyCreditedIds: string[] = [];

  for (const rawId of missionIds) {
    if (!isMissionId(rawId) || seen.has(rawId)) continue;
    seen.add(rawId);
    newlyCreditedIds.push(rawId);
  }

  if (newlyCreditedIds.length === 0) {
    return { ledger, awardedMinutes: 0, newlyCreditedIds: [] };
  }

  const maxEarnable = Math.max(
    0,
    settings.dailyLimitMinutes - settings.dailyBaseMinutes,
  );
  const headroom = Math.max(0, maxEarnable - ledger.earnedMinutes);
  const rawAward = newlyCreditedIds.length * Math.max(0, settings.minutesPerChallenge);
  const awardedMinutes = Math.min(headroom, rawAward);

  return {
    ledger: {
      ...ledger,
      earnedMinutes: ledger.earnedMinutes + awardedMinutes,
      completedIds: [...seen],
    },
    awardedMinutes,
    newlyCreditedIds,
  };
}

export type ParentTimeAction = "grant_five_minutes" | "reset_session";

/** Parent-authenticated immediate override on today's ledger. */
export function applyParentAction(
  rawLedger: TimeLedgerRow | null | undefined,
  settings: ParentSettings,
  nowMs: number,
  action: ParentTimeAction,
): TimeLedgerRow {
  const ledger = normalizeLedgerForNow(rawLedger, settings, nowMs);
  if (action === "reset_session") {
    return { ...ledger, sessionUsedSeconds: 0 };
  }
  // "grant_five_minutes": adds 5 parent-approved minutes today and clears at least
  // 5 minutes of sitting room if a sitting cap caused the pause.
  const rewoundSession =
    settings.sessionLimitMinutes !== null
      ? Math.min(
          ledger.sessionUsedSeconds,
          Math.max(0, settings.sessionLimitMinutes * 60 - 5 * 60),
        )
      : ledger.sessionUsedSeconds;
  return {
    ...ledger,
    extraParentMinutes: Math.min(180, ledger.extraParentMinutes + 5),
    sessionUsedSeconds: rewoundSession,
  };
}

export interface ParentSettingsUpdateInput {
  enabled?: unknown;
  timezone?: unknown;
  dailyBaseMinutes?: unknown;
  dailyLimitMinutes?: unknown;
  minutesPerChallenge?: unknown;
  sessionLimitMinutes?: unknown;
  quietHours?: unknown;
  gateStrictness?: unknown;
  /** Optional `"clear"` or 4-digit PIN string when updating PIN. */
  pin?: unknown;
}

export function validateAndMergeParentSettings(
  current: ParentSettings,
  input: unknown,
): { ok: true; settings: ParentSettings; newPin?: string | "clear" } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["settings payload must be an object"] };
  }
  const v = input as ParentSettingsUpdateInput;
  const errors: string[] = [];

  const enabled = v.enabled === undefined ? current.enabled : v.enabled;
  if (typeof enabled !== "boolean") errors.push("enabled must be a boolean");

  const timezone = v.timezone === undefined ? current.timezone : v.timezone;
  if (!isValidTimeZone(timezone)) errors.push("timezone must be a valid IANA time zone");

  const dailyBaseMinutes =
    v.dailyBaseMinutes === undefined ? current.dailyBaseMinutes : v.dailyBaseMinutes;
  if (
    typeof dailyBaseMinutes !== "number" ||
    !Number.isInteger(dailyBaseMinutes) ||
    dailyBaseMinutes < 5 ||
    dailyBaseMinutes > 180
  ) {
    errors.push("dailyBaseMinutes must be an integer between 5 and 180");
  }

  const dailyLimitMinutes =
    v.dailyLimitMinutes === undefined ? current.dailyLimitMinutes : v.dailyLimitMinutes;
  if (
    typeof dailyLimitMinutes !== "number" ||
    !Number.isInteger(dailyLimitMinutes) ||
    dailyLimitMinutes < 5 ||
    dailyLimitMinutes > 240
  ) {
    errors.push("dailyLimitMinutes must be an integer between 5 and 240");
  } else if (typeof dailyBaseMinutes === "number" && dailyLimitMinutes < dailyBaseMinutes) {
    errors.push("dailyLimitMinutes must be greater than or equal to dailyBaseMinutes");
  }

  const minutesPerChallenge =
    v.minutesPerChallenge === undefined
      ? current.minutesPerChallenge
      : v.minutesPerChallenge;
  if (
    typeof minutesPerChallenge !== "number" ||
    !Number.isInteger(minutesPerChallenge) ||
    minutesPerChallenge < 0 ||
    minutesPerChallenge > 15
  ) {
    errors.push("minutesPerChallenge must be an integer between 0 and 15");
  }

  const sessionLimitMinutes =
    v.sessionLimitMinutes === undefined
      ? current.sessionLimitMinutes
      : v.sessionLimitMinutes;
  if (
    sessionLimitMinutes !== null &&
    (typeof sessionLimitMinutes !== "number" ||
      !Number.isInteger(sessionLimitMinutes) ||
      sessionLimitMinutes < 5 ||
      sessionLimitMinutes > 120)
  ) {
    errors.push("sessionLimitMinutes must be null or an integer between 5 and 120");
  }

  let quietHours = current.quietHours;
  if (v.quietHours !== undefined) {
    if (typeof v.quietHours !== "object" || v.quietHours === null || Array.isArray(v.quietHours)) {
      errors.push("quietHours must be an object");
    } else {
      const q = v.quietHours as Record<string, unknown>;
      const qEnabled = q.enabled === undefined ? current.quietHours.enabled : q.enabled;
      const qStart = q.start === undefined ? current.quietHours.start : q.start;
      const qEnd = q.end === undefined ? current.quietHours.end : q.end;
      if (typeof qEnabled !== "boolean") errors.push("quietHours.enabled must be a boolean");
      if (typeof qStart !== "string" || !HH_MM_RE.test(qStart)) {
        errors.push("quietHours.start must be HH:MM (00:00..23:59)");
      }
      if (typeof qEnd !== "string" || !HH_MM_RE.test(qEnd)) {
        errors.push("quietHours.end must be HH:MM (00:00..23:59)");
      }
      if (errors.length === 0) {
        quietHours = {
          enabled: qEnabled as boolean,
          start: qStart as string,
          end: qEnd as string,
        };
      }
    }
  }

  const gateStrictness =
    v.gateStrictness === undefined ? current.gateStrictness : v.gateStrictness;
  if (gateStrictness !== "every_time" && gateStrictness !== "sitting_window") {
    errors.push("gateStrictness must be every_time or sitting_window");
  }

  let newPin: string | "clear" | undefined;
  if (v.pin !== undefined) {
    if (v.pin === "clear" || v.pin === null || v.pin === "") {
      newPin = "clear";
    } else if (isValidPin(v.pin)) {
      newPin = v.pin;
    } else {
      errors.push("pin must be a 4-digit number or 'clear'");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      enabled: enabled as boolean,
      timezone: timezone as string,
      dailyBaseMinutes: dailyBaseMinutes as number,
      dailyLimitMinutes: dailyLimitMinutes as number,
      minutesPerChallenge: minutesPerChallenge as number,
      sessionLimitMinutes: sessionLimitMinutes as number | null,
      quietHours,
      gateStrictness: gateStrictness as GateStrictness,
      pinHash: current.pinHash ?? null,
      pinFailedAttempts:
        newPin !== undefined
          ? 0
          : Math.max(0, Math.floor(Number(current.pinFailedAttempts) || 0)),
      pinCooldownUntil:
        newPin !== undefined ? null : (current.pinCooldownUntil ?? null),
    },
    ...(newPin !== undefined ? { newPin } : {}),
  };
}
