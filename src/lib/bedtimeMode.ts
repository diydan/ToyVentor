// What the toy should be doing about bedtime, from the play-time status (Dan, 2026-11-05: "Kip going to bed by himself at quiet hours"). Pure: GameCanvas hands the answer to the engine.
//   going  the last minute before play stops for the night (quiet hours) or for the day (the daily limit): walk to bed, or lie down where he is
//   now    play has stopped for either and the curtain is up: asleep at once if he is not yet
//   off    anything else, and play coming back (he wakes)
// A sitting limit is a break, not a night, so it is "off" (the status already says so: `bedtime` is false for it). `sleepActive` is the curtain being up: a mission or the Garage
// that is allowed to finish after the day's limit keeps the toy up until it is done.
import type { PlayTimeStatus } from "../../shared/parent-time";

export type BedtimeMode = "off" | "going" | "now";

export function bedtimeModeFor(status: Pick<PlayTimeStatus, "locked" | "reason" | "bedtime">, sleepActive: boolean): BedtimeMode {
  if (status.locked) return sleepActive && (status.reason === "quiet_hours" || status.reason === "daily_limit") ? "now" : "off";
  return status.bedtime === true ? "going" : "off";
}
