// The browser's side of the accounts routes (worker/accounts.ts): ask for an emailed sign-in link, trade the link's token for a session, read the family, add a child, claim this device, sign out,
// delete the family. Every failure comes back as a plain sentence for a grown-up, never a status code. The routes are OFF unless the Worker has ACCOUNTS=on; then `me()` says "off" and the
// screens that use this stay hidden, so a visitor never meets a dead feature. The session is an httpOnly cookie: this file never sees it.
import type { Favourites, PlayerProfile } from "./newPlayer";

export type Role = "parent" | "self";

export interface AccountChild { id: string; firstName: string; favourites: Favourites; under13: boolean }
export interface AccountMe { family: { id: string }; parent: { id: string; role: Role }; children: AccountChild[]; devices: string[] }

export type Result<T> = { ok: true; data: T } | { ok: false; problem: string; status: number };
export type Standing = { kind: "off" } | { kind: "signed-out" } | { kind: "signed-in"; me: AccountMe } | { kind: "trouble"; problem: string };

/** The link's token as the Worker makes it (worker/accounts.ts TOKEN). */
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

/** The sign-in token in a page address's query (`?signin=...`), or null. Anything that is not the right shape is ignored, so a stray or hand-made parameter does nothing. */
export function signinTokenFromSearch(search: string): string | null {
  try {
    const t = new URLSearchParams(search).get("signin");
    return t && TOKEN.test(t) ? t : null;
  } catch { return null; }
}

/** The same address without the `signin` parameter (so the token is not left in the history or a bookmark). Everything else in the query and the hash is kept. */
export function withoutSignin(search: string): string {
  try {
    const q = new URLSearchParams(search);
    q.delete("signin");
    const s = q.toString();
    return s ? `?${s}` : "";
  } catch { return ""; }
}

/** A sentence for a failed call. `error` is the Worker's own words (never shown as they are: they are for logs), the status decides. */
export function describeFailure(status: number, error?: string): string {
  if (status === 0) return "There is no connection. Try again when the device is online.";
  if (status === 404 && error === "accounts are off") return "Accounts are not switched on yet.";
  if (status === 503) return "Email is not set up yet, so a sign-in link cannot be sent.";
  if (status === 429) return "Too many tries. Please wait an hour and try again.";
  if (status === 502) return "The email could not be sent. Please try again in a minute.";
  if (status === 401) return "Please sign in again.";
  if (status === 400) return "This link is not valid any more. Ask for a new one.";
  if (status === 409) return /device/i.test(error ?? "") ? "This device already belongs to another family." : "A family can have up to 6 children.";
  if (status === 422) return /email/i.test(error ?? "") ? "Please check the email address." : "Please check what was typed.";
  return "Something went wrong. Please try again.";
}

type Fetch = typeof fetch;

/** A very small check before asking: one "@", something each side, a dot after it, no spaces. The Worker is the real judge. */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export function createAccountsClient(fetchImpl: Fetch = (...a) => fetch(...a)) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T> & { raw?: unknown }> {
    let res: Response;
    try {
      res = await fetchImpl(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
    } catch { return { ok: false, problem: describeFailure(0), status: 0 }; }
    let json: unknown = null;
    try { json = await res.json(); } catch { /* an empty or non-JSON body */ }
    const error = typeof (json as { error?: unknown } | null)?.error === "string" ? (json as { error: string }).error : undefined;
    if (!res.ok) return { ok: false, problem: describeFailure(res.status, error), status: res.status, raw: json };
    return { ok: true, data: json as T };
  }
  return {
    /** Where this visitor stands: accounts off, signed out, signed in (with the family), or in trouble (the network). */
    async standing(): Promise<Standing> {
      const r = await call<AccountMe>("GET", "/api/account/me");
      if (r.ok) return { kind: "signed-in", me: r.data };
      if (r.status === 404) return { kind: "off" };
      if (r.status === 401) return { kind: "signed-out" };
      return { kind: "trouble", problem: r.problem };
    },
    startLogin: (email: string, role: Role) => call<{ ok?: boolean }>("POST", "/api/account/login/start", { email: email.trim(), role }),
    verify: (token: string) => call<{ ok: boolean; new: boolean }>("POST", "/api/account/login/verify", { token }),
    addChild: (child: { firstName: string; favourites: Favourites; under13: boolean }) => call<{ child: AccountChild }>("POST", "/api/account/children", child),
    claimDevice: (deviceId: string) => call<{ ok: boolean; already: boolean }>("POST", "/api/account/claim-device", { deviceId }),
    signOut: () => call<{ ok: boolean }>("POST", "/api/account/logout", {}),
    deleteFamily: () => call<{ ok: boolean }>("DELETE", "/api/account"),
  };
}
export type AccountsClient = ReturnType<typeof createAccountsClient>;

/** The player saved on this device, as a child to add to the family: only when there is one, it is not in the family already (same first name, any case) and the family has room. */
export function offerChild(profile: PlayerProfile | null, me: AccountMe, max = 6): { firstName: string; favourites: Favourites; under13: boolean } | null {
  if (!profile || me.children.length >= max) return null;
  if (me.children.some((c) => c.firstName.toLowerCase() === profile.kidName.toLowerCase())) return null;
  return { firstName: profile.kidName, favourites: profile.favourites, under13: profile.under13 };
}

/** Is this device already one of the family's? */
export const deviceIsClaimed = (me: AccountMe, device: string): boolean => me.devices.includes(device);
