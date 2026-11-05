// The pure rules of the accounts groundwork (docs/specs/accounts-and-new-user-spec.md sections 2.1 to 2.7). INERT: nothing here runs unless the Worker's `ACCOUNTS` switch is "on"
// (worker/accounts.ts); this file has no clock, no storage, no network. A grown-up signs in with an emailed one-time link; a child never has an email or a login.
//
//   tokens     a link token and a session token are 32 random bytes, base64url. Only their SHA-256 is ever stored, so a copy of the database signs nobody in.
//   email      a login link is tied to the SHA-256 of the lower-cased address (`hashEmail`), never the address: the address is used once, to send the link, and is not persisted.
//   limits     3 links an hour per email, 10 an hour per IP, 5 new families a day per IP (fixed windows; the Worker counts every ATTEMPT, so flooding stays refused).
//   sessions   30 days idle, 90 days absolute, a new token after 24 hours (rotation), links live 15 minutes and work once.
//   family     at most 6 children and 3 grown-ups.
//
// Randomness and hashing are INJECTED (`Random`, `Sha256`) so a test can run them deterministically and a mutant can be built from a broken one.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const LINK_TTL_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * DAY_MS;
export const SESSION_ABSOLUTE_MS = 90 * DAY_MS;
export const SESSION_ROTATE_AFTER_MS = DAY_MS;
export const LINKS_PER_EMAIL_HOUR = 3;
export const LINKS_PER_IP_HOUR = 10;
export const ACCOUNTS_PER_IP_DAY = 5;
export const MAX_CHILDREN = 6;
export const MAX_PARENTS = 3;
export const SESSION_COOKIE = "tv_session";

export type Role = "parent" | "self";
export const ROLES: readonly Role[] = ["parent", "self"];
export const isRole = (v: unknown): v is Role => v === "parent" || v === "self";

export type Random = (bytes: number) => Uint8Array;
/** Lower-case hex of the SHA-256 of the text. */
export type Sha256 = (text: string) => Promise<string>;

// ---- what a person types --------------------------------------------------------------------------------------------------------------------------------------------

/** An address, lower-cased and trimmed; null when it is not plausibly one (one "@", something either side, a dot in the domain, no spaces, at most 254 characters). */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.normalize("NFC").trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/.test(e)) return null;
  const [local, domain] = e.split("@");
  if (!local || !domain || local.length > 64 || domain.includes("..") || domain.startsWith(".") || domain.startsWith("-")) return null;
  return e;
}

export const NAME_MAX = 20;
export type NameResult = { ok: true; name: string } | { ok: false; problem: "empty" | "too-long" | "characters" };
/**
 * A child's first name or nickname: letters (any language) with single spaces, hyphens or apostrophes between them, 1 to 20 characters. The same rule as the app's setup screen (src/lib/newPlayer.ts
 * `cleanName`, written out again here because shared/ must not import from src/): digits, "@", ":", "/" and the rest are refused, which also keeps contact details and links out.
 */
export function cleanFirstName(raw: unknown): NameResult {
  const text = typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, problem: "empty" };
  if ([...text].length > NAME_MAX) return { ok: false, problem: "too-long" };
  if (!/^\p{L}+(?:[ '’-]\p{L}+)*$/u.test(text)) return { ok: false, problem: "characters" };
  return { ok: true, name: text };
}

const ID = /^[a-z][a-z0-9_]{0,23}$/;
export interface Favourites { colour: string; fruit: string; animal: string }
/** Three closed-list ids ("blue", "apple", "elephant"): the Worker checks the SHAPE (short lower-case ids, never free text); the lists themselves live in the app. */
export function cleanFavourites(raw: unknown): Favourites | null {
  const f = raw as Partial<Record<keyof Favourites, unknown>> | null;
  if (!f || typeof f !== "object") return null;
  const { colour, fruit, animal } = f;
  return typeof colour === "string" && ID.test(colour) && typeof fruit === "string" && ID.test(fruit) && typeof animal === "string" && ID.test(animal) ? { colour, fruit, animal } : null;
}

/** The anonymous device id the app keeps (`toyforge:device:v1`, a UUID): 16 to 64 characters of letters, digits, "-" and "_" (the same bounds as the rest of the Worker's device ids). */
export const isDeviceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);

// ---- tokens and hashes ---------------------------------------------------------------------------------------------------------------------------------------------

const toB64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** An opaque random token (base64url, no padding): 32 bytes by default, 43 characters. */
export function randomToken(random: Random, bytes = 32): string {
  const b = random(bytes);
  if (b.length !== bytes) throw new Error("random source returned the wrong number of bytes");
  return toB64url(b);
}
/** A short random id with a prefix ("f_", "p_", "c_"): 16 random bytes. */
export const randomId = (random: Random, prefix: string): string => `${prefix}${randomToken(random, 16)}`;

/** What the database holds for a link or session token: the hash, never the token. */
export const hashToken = (sha256: Sha256, token: string): Promise<string> => sha256(`tok:${token}`);
/** What the database holds for an address: the hash of the normalised address (with an optional secret pepper), never the address. */
export const hashEmail = (sha256: Sha256, email: string, pepper = ""): Promise<string> => sha256(`email:${pepper}|${email}`);
/** What the rate limiter holds for an IP: its hash, so no address is kept. */
export const hashIp = (sha256: Sha256, ip: string, pepper = ""): Promise<string> => sha256(`ip:${pepper}|${ip}`);

// ---- limits ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** The start of the fixed window a moment falls in. */
export const windowStart = (nowMs: number, windowMs: number): number => Math.floor(nowMs / windowMs) * windowMs;
/** Seconds until that window ends (at least 1), for a Retry-After header. */
export const retryAfterSeconds = (nowMs: number, windowMs: number): number => Math.max(1, Math.ceil((windowStart(nowMs, windowMs) + windowMs - nowMs) / 1000));
/** `count` attempts have been made in the window, this one included: is it past the limit? */
export const overLimit = (count: number, limit: number): boolean => count > limit;

export type LinkRefusal = "email" | "ip" | null;
/** Which limit, if any, a sign-in link request has hit. The email limit is checked first. */
export function linkRefusal(counts: { email: number; ip: number }): LinkRefusal {
  if (overLimit(counts.email, LINKS_PER_EMAIL_HOUR)) return "email";
  if (overLimit(counts.ip, LINKS_PER_IP_HOUR)) return "ip";
  return null;
}

export const canAddChild = (existing: number): boolean => existing < MAX_CHILDREN;
export const canAddParent = (existing: number): boolean => existing < MAX_PARENTS;

// ---- sessions -------------------------------------------------------------------------------------------------------------------------------------------------------

export interface SessionTimes {
  /** When THIS token was issued (a rotation issues a new one). */
  createdMs: number;
  lastUsedMs: number;
  /** The absolute end: 90 days after the sign-in, carried over by every rotation. */
  expiresMs: number;
}
export const newSessionExpiry = (signedInMs: number): number => signedInMs + SESSION_ABSOLUTE_MS;
/** A session works while it is inside its absolute end and was used within the idle window. */
export function sessionVerdict(s: SessionTimes, nowMs: number): "valid" | "expired" {
  if (nowMs >= s.expiresMs) return "expired";
  if (nowMs - s.lastUsedMs > SESSION_IDLE_MS) return "expired";
  return "valid";
}
/** A token older than 24 hours is replaced by a new one on its next use. */
export const needsRotation = (s: SessionTimes, nowMs: number): boolean => nowMs - s.createdMs >= SESSION_ROTATE_AFTER_MS;

// ---- cookies --------------------------------------------------------------------------------------------------------------------------------------------------------

/** The session cookie: httpOnly (scripts cannot read it), Secure, SameSite=Lax, for the whole site, lasting `maxAgeSec`. */
export const sessionCookie = (value: string, maxAgeSec: number): string => `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`;
export const clearedSessionCookie = (): string => `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
/** One cookie's value out of a Cookie header, or null. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}
