// A returning player (Dan, 2026-11-05: greet by name, do not run the setup again, a grown-up can start over).
//
// The setup (src/lib/newPlayer.ts) keeps one profile on the device under PROFILE_KEY. This file is what the title screen and the Grown-Ups sheet say about it, and the one way to forget it.
// Pure: no React, no DOM. Storage is injected (the page passes `localStorage`). Every function is null-safe, and a name is only ever used after it passes the same rule the setup applies
// (`cleanName`: letters, one space, hyphen or apostrophe between them, 1 to 20 characters), so a hand-edited value can never put markup or a link on the title screen.
import { PROFILE_KEY, cleanName, type PlayerProfile, type Store } from "./newPlayer";

/** The name to say, or null when there is none or it does not pass the setup's own rule. */
export function safeName(name: unknown): string | null {
  const r = cleanName(name);
  return r.ok ? r.name : null;
}

/** "Welcome back, Mia!" for a name, or null (the title screen then shows nothing). */
export function welcomeLine(name: unknown): string | null {
  const n = safeName(name);
  return n ? `Welcome back, ${n}!` : null;
}

/** The small link under the title's entries once a player is set up: "Not Mia? Set up a different player". Without a usable name it still offers the same way out. */
export function notYouLine(name: unknown): string {
  const n = safeName(name);
  return n ? `Not ${n}? Set up a different player` : "Set up a different player";
}

/** "Welcome back, Mia!" for a saved profile (null when there is no usable profile). */
export function welcomeBack(profile: Pick<PlayerProfile, "kidName"> | null | undefined): string | null {
  return welcomeLine(profile?.kidName);
}

/** "Not Mia? Set up a different player" for a saved profile. */
export function notYouLabel(profile: Pick<PlayerProfile, "kidName"> | null | undefined): string {
  return notYouLine(profile?.kidName);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * What the Grown-Ups sheet says about the player: "Mia was set up on this device on 5 Nov." (UTC date of `createdAt`; the year is added when it is not the year of `nowIso`).
 * A profile with no readable date reads "Mia is set up on this device." and no profile reads as an empty string.
 */
export function describeSetup(profile: Pick<PlayerProfile, "kidName" | "createdAt"> | null | undefined, nowIso: string): string {
  const name = safeName(profile?.kidName);
  if (!name) return "";
  const at = typeof profile?.createdAt === "string" ? new Date(profile.createdAt) : null;
  if (!at || Number.isNaN(at.getTime())) return `${name} is set up on this device.`;
  const now = new Date(nowIso);
  const sameYear = !Number.isNaN(now.getTime()) && now.getUTCFullYear() === at.getUTCFullYear();
  return `${name} was set up on this device on ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${sameYear ? "" : ` ${at.getUTCFullYear()}`}.`;
}

/**
 * The grown-up's "forget this player": removes ONLY the profile. The saved game (the toy, its colours, the stars), the songs kept in "My songs", the device id and every setting stay.
 * Returns whether there was a profile to forget (false too when storage is blocked: nothing was removed).
 */
export function forgetPlayer(store: Store | null | undefined): boolean {
  try {
    if (!store || store.getItem(PROFILE_KEY) === null) return false;
    store.removeItem(PROFILE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** How long the first tap on "Forget this player" stays armed. */
export const FORGET_ARM_MS = 5000;

/**
 * The two-tap guard on "Forget this player", as a pure step: the first tap arms it (`armedAt` = now), a second tap inside the window forgets, a tap after the window arms it again.
 * `armedAt` is what the last step returned (null: not armed).
 */
export function nextForgetTap(armedAt: number | null, nowMs: number, windowMs: number = FORGET_ARM_MS): { armedAt: number | null; forget: boolean } {
  if (armedAt !== null && Number.isFinite(armedAt) && nowMs >= armedAt && nowMs - armedAt <= windowMs) return { armedAt: null, forget: true };
  return { armedAt: nowMs, forget: false };
}
