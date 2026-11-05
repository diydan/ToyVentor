// Accounts (docs/specs/accounts-and-new-user-spec.md 2.1 to 2.7): a grown-up signs in with an emailed one-time link, a family holds up to six child profiles (a first name and three
// closed-list favourites, never an email), and a signed-in grown-up can claim a device and delete the whole family. `handleAccounts` returns null for any path that is not /api/account or
// under /api/account/, and answers 404 {"error":"accounts are off"} unless the Worker's `ACCOUNTS` variable is exactly "on" (it is unset in production). It is wired into worker/index.ts
// (one block before the final 404) and the Worker has a `send_email` binding named SEND_EMAIL in wrangler.jsonc: Dan chose Cloudflare Email Sending, 2026-11-05.
//
//   POST   /api/account/login/start   {email, role: "parent"|"self"}   202, the same body whether or not the address is known; sends the link through the EmailSender
//   POST   /api/account/login/verify  {token}                          200 + session cookie; the link works once and for 15 minutes; the first verify creates the family and the grown-up
//   GET    /api/account/me                                              the family, the grown-up, the children, the claimed devices (never an email, never a hash)
//   POST   /api/account/logout                                          ends this session
//   POST   /api/account/children      {firstName, favourites, under13} 201; at most 6 a family
//   POST   /api/account/claim-device  {deviceId}                       writes one device_claims row (a mapping: no other table is touched)
//   DELETE /api/account                                                 deletes everything the family owns in the new tables
//
// To switch it on: onboard a sending domain (`npx wrangler email sending enable toyventor.com`; Email Sending is a beta and sending to ANY address needs the Workers Paid plan, until the
// domain is onboarded it can only send to verified addresses in the account), then set the variables ACCOUNTS=on, EMAIL_BACKEND=binding and EMAIL_FROM=<an address on that domain>.
// Optional: the secret ACCOUNTS_PEPPER and the variable ACCOUNTS_LINK_BASE. See `AccountsEnv`.
//
// Privacy: no address is stored. The address is hashed (SHA-256 of the lower-cased address, with an optional ACCOUNTS_PEPPER) for the link and the grown-up row; it is used once, to send the link, and
// then dropped. Link and session tokens are stored only as their SHA-256. A rate-limit row holds an IP's hash, not the IP.
import {
  ACCOUNTS_PER_IP_DAY, DAY_MS, HOUR_MS, LINK_TTL_MS, MAX_CHILDREN, SESSION_COOKIE, SESSION_IDLE_MS, SESSION_ROTATE_GRACE_MS,
  canAddChild, clearedSessionCookie, cleanFavourites, cleanFirstName, hashEmail, hashIp, hashToken, isDeviceId, isRole, linkRefusal, needsRotation, newSessionExpiry, normaliseEmail,
  overLimit, randomId, randomToken, readCookie, retryAfterSeconds, sessionCookie, sessionVerdict, windowStart,
  type Random, type Sha256,
} from "../shared/accounts";

// ---- the database and the environment ------------------------------------------------------------------------------------------------------------------------------

/** What the code needs of D1 (the real binding and tests/helpers/sqliteD1.ts both fit). */
export interface AccountsDb {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ meta?: { changes?: number } }>;
      all: () => Promise<{ results: Record<string, unknown>[] }>;
      first: () => Promise<Record<string, unknown> | null>;
    };
  };
}

/** Cloudflare Email Sending's Worker binding: `send({to, from, subject, text})` resolves with `{messageId}` and rejects with an Error that has a `code` ("E_SENDER_NOT_VERIFIED", "E_RECIPIENT_SUPPRESSED",
 *  "E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", ...). The shape is from developers.cloudflare.com/email-service/api/send-emails/workers-api (read 2026-11-05); it has NOT been run against the real service. */
export interface SendEmailBinding {
  send: (message: { from: string; to: string; subject: string; text: string }) => Promise<unknown>;
}

export interface AccountsEnv {
  /** Exactly "on" switches the routes on. Unset (production today): every /api/account route is a 404. */
  ACCOUNTS?: string;
  /** "development" or "test" allow the "log" email backend (and "development" prints each message); anything else, or unset (the live Worker), refuses it. */
  ENVIRONMENT?: string;
  /** "off" (default: login/start answers 503), "log" (tests and local dev only), "resend", or "binding". */
  EMAIL_BACKEND?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  SEND_EMAIL?: SendEmailBinding;
  /** A secret mixed into the address and IP hashes, so a copy of the database cannot be checked against a list of addresses. Optional. */
  ACCOUNTS_PEPPER?: string;
  /** The site's address for the emailed link, "https://www.toyventor.com". Absent: the request's own origin. */
  ACCOUNTS_LINK_BASE?: string;
  DB?: AccountsDb;
}

// ---- the schema (the same statements as migrations/0004_accounts.sql; tests/accounts.test.ts keeps the two equal) ---------------------------------------------------

export const ACCOUNTS_SCHEMA: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL, timezone TEXT, deleted_ms INTEGER)",
  "CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, email_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('parent', 'self')), created_ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_parents_family ON parents (family_id)",
  "CREATE TABLE IF NOT EXISTS children (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, first_name TEXT NOT NULL, favourites_json TEXT NOT NULL, under13 INTEGER NOT NULL, created_ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_children_family ON children (family_id)",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, parent_id TEXT NOT NULL, family_id TEXT NOT NULL, created_ms INTEGER NOT NULL, last_used_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions (parent_id)",
  "CREATE TABLE IF NOT EXISTS login_links (token_hash TEXT PRIMARY KEY, email_hash TEXT NOT NULL, role TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, used_ms INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_login_links_email ON login_links (email_hash)",
  "CREATE TABLE IF NOT EXISTS device_claims (device_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, claimed_by TEXT NOT NULL, claimed_ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_device_claims_family ON device_claims (family_id)",
  "CREATE TABLE IF NOT EXISTS consents (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, version INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_consents_family ON consents (family_id)",
  "CREATE TABLE IF NOT EXISTS account_rate (bucket TEXT NOT NULL, key TEXT NOT NULL, window_ms INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (bucket, key, window_ms))",
];

/**
 * Every table a family owns, in the order they are deleted. tests/accounts.test.ts reads the migration and fails when a table is added there and listed in NEITHER this list nor
 * `ACCOUNT_TABLES_CLEANED_BY_EMAIL`, so a new table keyed by a family, a parent, a child or a device cannot be forgotten by "delete everything" (spec 2.6).
 */
export const ACCOUNT_FAMILY_TABLES: readonly string[] = ["children", "consents", "device_claims", "sessions", "parents", "families"];
/** Tables keyed by the address hash instead of the family: a deleted family's rows in them are removed by that hash (the links, the email rate counters). */
export const ACCOUNT_TABLES_CLEANED_BY_EMAIL: readonly string[] = ["login_links", "account_rate"];

const readyDbs = new WeakSet<object>();
async function ensureTables(db: AccountsDb): Promise<void> {
  if (readyDbs.has(db)) return;
  for (const sql of ACCOUNTS_SCHEMA) await db.prepare(sql).bind().run();
  readyDbs.add(db);
}

// ---- email ----------------------------------------------------------------------------------------------------------------------------------------------------------

export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailSender { send: (message: EmailMessage) => Promise<void> }

/** Where the "log" backend puts what it would have sent (tests and local dev only; capped). */
export const logOutbox: EmailMessage[] = [];
/**
 * The "log" backend (tests and local dev only): keeps what it would have sent in `logOutbox`, and when ENVIRONMENT is exactly "development" also prints the message to the dev server's output
 * (`ACCOUNT-MAIL`, one JSON line) so a person running the real Worker locally can read the sign-in link. Only "development" and "test" may use it at all (see selectSender): it must never run on the
 * live Worker, where the variable is not set.
 */
const logSender = (env: AccountsEnv): EmailSender => ({
  send: async (m) => {
    logOutbox.push(m);
    if (logOutbox.length > 50) logOutbox.shift();
    if (env.ENVIRONMENT === "development") console.log("ACCOUNT-MAIL " + JSON.stringify({ to: m.to, subject: m.subject, text: m.text }));
  },
});

/** NOT VERIFIED against the real service: a plain POST to https://api.resend.com/emails with a bearer key. */
const resendSender = (apiKey: string, from: string): EmailSender => ({
  send: async (m) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`resend answered ${res.status}`);
  },
});
/** Not run against a real binding (see SendEmailBinding). A failure keeps only the service's error code (never the address) in the log, then rethrows for the route's 502. */
const bindingSender = (binding: SendEmailBinding, from: string): EmailSender => ({
  send: async (m) => {
    try { await binding.send({ from, to: m.to, subject: m.subject, text: m.text }); }
    catch (e) { console.warn("account email not sent:", typeof (e as { code?: unknown } | null)?.code === "string" ? (e as { code: string }).code : "unknown"); throw e; }
  },
});

/** The sender the environment asks for, or null when email is not set up (off, an unknown name, a missing secret, or "log" anywhere but development and test). */
export function selectSender(env: AccountsEnv): EmailSender | null {
  const mode = (env.EMAIL_BACKEND ?? "off").trim().toLowerCase();
  if (mode === "log") return env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test" ? logSender(env) : null; // FAIL CLOSED: the live Worker sets neither, so "log" is refused there
  if (mode === "resend") { const key = env.RESEND_API_KEY?.trim(), from = env.EMAIL_FROM?.trim(); return key && from ? resendSender(key, from) : null; }
  if (mode === "binding") { const from = env.EMAIL_FROM?.trim(); return env.SEND_EMAIL && from ? bindingSender(env.SEND_EMAIL, from) : null; }
  return null;
}

// ---- the handler ---------------------------------------------------------------------------------------------------------------------------------------------------

/** Everything with a side effect or a clock can be replaced (tests, and the mutants that prove the tests catch a broken version). */
export interface AccountsDeps {
  now?: () => number;
  random?: Random;
  sha256?: Sha256;
  /** Replaces the sender the environment selects; `null` means "no email set up". */
  sender?: EmailSender | null;
  /** Replaces how an address is turned into what the database holds (a test uses the identity to prove a plain-text address is caught). */
  hashEmail?: (normalisedEmail: string) => Promise<string>;
}

const defaultRandom: Random = (n) => crypto.getRandomValues(new Uint8Array(n));
const defaultSha256: Sha256 = async (text) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const changes = (r: { meta?: { changes?: number } }): number => r.meta?.changes ?? 0;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const ACCEPTED = { ok: true, message: "If that address can sign in, a link is on its way. It works once and lasts 15 minutes." };

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ error: "send JSON" }, 415);
  const text = await request.text();
  if (text.length > 4096) return json({ error: "too large" }, 413);
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : json({ error: "send a JSON object" }, 400);
  } catch {
    return json({ error: "send JSON" }, 400);
  }
}

interface Authed { parentId: string; familyId: string; setCookie?: string }

/** The part of the Worker's ExecutionContext this handler could use (the repo's tsconfig does not load the Workers ambient types, so the real `ExecutionContext` is passed structurally). */
export interface AccountsContext { waitUntil(promise: Promise<unknown>): void }

export function createAccountsHandler(deps: AccountsDeps = {}) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? defaultRandom;
  const sha256 = deps.sha256 ?? defaultSha256;

  return async function handleAccounts(request: Request, env: AccountsEnv, _ctx?: AccountsContext): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    if (path !== "/api/account" && !path.startsWith("/api/account/")) return null;
    if (env.ACCOUNTS !== "on") return json({ error: "accounts are off" }, 404);
    const db = env.DB;
    if (!db) return json({ error: "accounts need the database" }, 503);
    await ensureTables(db);

    const pepper = env.ACCOUNTS_PEPPER ?? "";
    const emailKey = deps.hashEmail ?? ((email: string) => hashEmail(sha256, email, pepper));
    const t = now();
    const route = `${request.method} ${path}`;
    const methods: Record<string, string> = { "/api/account/login/start": "POST", "/api/account/login/verify": "POST", "/api/account/me": "GET", "/api/account/logout": "POST", "/api/account/children": "POST", "/api/account/claim-device": "POST", "/api/account": "DELETE" };
    const allowed = methods[path];
    if (!allowed) return json({ error: "not found" }, 404);
    if (request.method !== allowed) return json({ error: "method not allowed" }, 405, { allow: allowed });

    /** Count one attempt in a fixed window and say how many there have been, this one included. */
    async function bump(bucket: string, key: string, windowMs: number): Promise<number> {
      const w = windowStart(t, windowMs);
      await db!.prepare("INSERT INTO account_rate (bucket, key, window_ms, count) VALUES (?, ?, ?, 1) ON CONFLICT(bucket, key, window_ms) DO UPDATE SET count = count + 1").bind(bucket, key, w).run();
      const row = await db!.prepare("SELECT count FROM account_rate WHERE bucket = ? AND key = ? AND window_ms = ?").bind(bucket, key, w).first();
      return num(row?.count ?? 1);
    }

    /** The signed-in grown-up from the session cookie, or null. A token older than 24 hours is replaced (the new cookie rides on the response). */
    async function authenticate(): Promise<Authed | null> {
      const raw = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
      if (!raw || !TOKEN.test(raw)) return null;
      const th = await hashToken(sha256, raw);
      const s = await db!.prepare("SELECT parent_id, family_id, created_ms, last_used_ms, expires_ms FROM sessions WHERE token_hash = ?").bind(th).first();
      if (!s) return null;
      const times = { createdMs: num(s.created_ms), lastUsedMs: num(s.last_used_ms), expiresMs: num(s.expires_ms) };
      if (sessionVerdict(times, t) === "expired") { await db!.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(th).run(); return null; }
      const parent = await db!.prepare("SELECT id FROM parents WHERE id = ? AND family_id = ?").bind(str(s.parent_id), str(s.family_id)).first();
      if (!parent) return null;
      const remainingSec = Math.min(SESSION_IDLE_MS, times.expiresMs - t) / 1000;
      if (needsRotation(times, t)) {
        // The old token is not killed at once: a second tab that sent it a moment ago, or a response that never arrived, must not sign the grown-up out. It is given a short grace (its end moves to now + the grace) and the
        // FIRST request to get here claims the rotation in one statement (only a row that ends later than the grace end changes), so two requests at the same time make one new session, not two.
        const graceEnd = t + SESSION_ROTATE_GRACE_MS;
        const claimed = await db!.prepare("UPDATE sessions SET expires_ms = ? WHERE token_hash = ? AND expires_ms > ?").bind(graceEnd, th, graceEnd).run();
        if (changes(claimed) === 1) {
          const next = randomToken(random);
          await db!.prepare("INSERT INTO sessions (token_hash, parent_id, family_id, created_ms, last_used_ms, expires_ms) VALUES (?, ?, ?, ?, ?, ?)").bind(await hashToken(sha256, next), str(s.parent_id), str(s.family_id), t, t, times.expiresMs).run();
          return { parentId: str(s.parent_id), familyId: str(s.family_id), setCookie: sessionCookie(next, remainingSec) };
        }
      }
      await db!.prepare("UPDATE sessions SET last_used_ms = ? WHERE token_hash = ?").bind(t, th).run();
      return { parentId: str(s.parent_id), familyId: str(s.family_id) };
    }
    const withCookie = (a: Authed, body: unknown, status = 200): Response => json(body, status, a.setCookie ? { "set-cookie": a.setCookie } : {});
    const needSession = (): Response => json({ error: "sign in first" }, 401);

    // ---- sign-in ------------------------------------------------------------------------------------------------------------------------------------------------

    if (path === "/api/account/login/start") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const email = normaliseEmail(body.email);
      if (!email || !isRole(body.role)) return json({ error: "an email address and a role (parent or self) are needed" }, 422);
      const sender = deps.sender !== undefined ? deps.sender : selectSender(env);
      if (!sender) return json({ error: "email is not set up" }, 503); // nothing is counted, created or sent
      const eh = await emailKey(email);
      const ih = await hashIp(sha256, request.headers.get("cf-connecting-ip") ?? "unknown", pepper);
      await db.prepare("DELETE FROM account_rate WHERE window_ms < ?").bind(t - 2 * DAY_MS).run();
      // nothing is kept longer than it is useful: a link's row (a hash of the address and of the token) goes a day after it ends, and an ended session goes with it
      await db.prepare("DELETE FROM login_links WHERE expires_ms < ?").bind(t - DAY_MS).run();
      await db.prepare("DELETE FROM sessions WHERE expires_ms < ?").bind(t).run();
      const counts = { email: await bump("email", eh, HOUR_MS), ip: await bump("ip", ih, HOUR_MS) };
      if (linkRefusal(counts)) return json({ error: "too many requests" }, 429, { "retry-after": String(retryAfterSeconds(t, HOUR_MS)) });
      const token = randomToken(random);
      await db.prepare("INSERT INTO login_links (token_hash, email_hash, role, created_ms, expires_ms, used_ms) VALUES (?, ?, ?, ?, ?, NULL)").bind(await hashToken(sha256, token), eh, body.role, t, t + LINK_TTL_MS).run();
      const base = (env.ACCOUNTS_LINK_BASE ?? url.origin).replace(/\/+$/, "");
      try {
        await sender.send({
          to: email,
          subject: "Your ToyVentor sign-in link",
          text: `Open this link on the same device to sign in to ToyVentor. It works once and lasts 15 minutes.\n\n${base}/?signin=${encodeURIComponent(token)}\n\nIf you did not ask for this, ignore this email: nothing happens unless the link is opened.`,
        });
      } catch {
        return json({ error: "could not send the email" }, 502);
      }
      return json(ACCEPTED, 202); // the same body for an address that has an account and one that has not
    }

    if (path === "/api/account/login/verify") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const invalid = (): Response => json({ error: "this link is not valid any more" }, 400); // used, expired, unknown or malformed: one answer
      if (typeof body.token !== "string" || !TOKEN.test(body.token)) return invalid();
      const th = await hashToken(sha256, body.token);
      const spent = await db.prepare("UPDATE login_links SET used_ms = ? WHERE token_hash = ? AND used_ms IS NULL AND expires_ms > ?").bind(t, th, t).run();
      if (changes(spent) !== 1) return invalid();
      const link = await db.prepare("SELECT email_hash, role FROM login_links WHERE token_hash = ?").bind(th).first();
      if (!link) return invalid();
      let parent = await db.prepare("SELECT id, family_id, role FROM parents WHERE email_hash = ?").bind(str(link.email_hash)).first();
      let created = false;
      if (!parent) {
        const ih = await hashIp(sha256, request.headers.get("cf-connecting-ip") ?? "unknown", pepper);
        if (overLimit(await bump("create", ih, DAY_MS), ACCOUNTS_PER_IP_DAY)) return json({ error: "too many requests" }, 429, { "retry-after": String(retryAfterSeconds(t, DAY_MS)) });
        const familyId = randomId(random, "f_"), parentId = randomId(random, "p_");
        try {
          await db.prepare("INSERT INTO families (id, created_ms, timezone, deleted_ms) VALUES (?, ?, NULL, NULL)").bind(familyId, t).run();
          await db.prepare("INSERT INTO parents (id, family_id, email_hash, role, created_ms) VALUES (?, ?, ?, ?, ?)").bind(parentId, familyId, str(link.email_hash), str(link.role), t).run();
          await db.prepare("INSERT INTO consents (id, family_id, kind, at_ms, version) VALUES (?, ?, 'account', ?, 1)").bind(randomId(random, "k_"), familyId, t).run();
          created = true;
          parent = { id: parentId, family_id: familyId, role: str(link.role) };
        } catch {
          await db.prepare("DELETE FROM families WHERE id = ? AND NOT EXISTS (SELECT 1 FROM parents WHERE family_id = families.id)").bind(familyId).run();
          parent = await db.prepare("SELECT id, family_id, role FROM parents WHERE email_hash = ?").bind(str(link.email_hash)).first(); // two links for one new address verified at once: the other won
          if (!parent) return json({ error: "could not sign in" }, 500);
        }
      }
      const token = randomToken(random);
      await db.prepare("INSERT INTO sessions (token_hash, parent_id, family_id, created_ms, last_used_ms, expires_ms) VALUES (?, ?, ?, ?, ?, ?)").bind(await hashToken(sha256, token), str(parent.id), str(parent.family_id), t, t, newSessionExpiry(t)).run();
      return json({ ok: true, new: created, family: { id: str(parent.family_id) }, parent: { id: str(parent.id), role: str(parent.role) } }, 200, { "set-cookie": sessionCookie(token, SESSION_IDLE_MS / 1000) });
    }

    // ---- everything below needs a session ------------------------------------------------------------------------------------------------------------------------

    if (path === "/api/account/logout") {
      const raw = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
      if (raw && TOKEN.test(raw)) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(sha256, raw)).run();
      return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
    }

    const who = await authenticate();
    if (!who) return needSession();
    const family = who.familyId;

    if (route === "GET /api/account/me") {
      const parent = await db.prepare("SELECT id, role FROM parents WHERE id = ? AND family_id = ?").bind(who.parentId, family).first();
      const kids = await db.prepare("SELECT id, first_name, favourites_json, under13 FROM children WHERE family_id = ? ORDER BY created_ms, id").bind(family).all();
      const devices = await db.prepare("SELECT device_id FROM device_claims WHERE family_id = ? ORDER BY claimed_ms, device_id").bind(family).all();
      return withCookie(who, {
        family: { id: family },
        parent: { id: str(parent?.id), role: str(parent?.role) },
        children: kids.results.map((k) => ({ id: str(k.id), firstName: str(k.first_name), favourites: JSON.parse(str(k.favourites_json)) as unknown, under13: num(k.under13) === 1 })),
        devices: devices.results.map((d) => str(d.device_id)),
      });
    }

    if (route === "POST /api/account/children") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const name = cleanFirstName(body.firstName), fav = cleanFavourites(body.favourites);
      if (!name.ok) return json({ error: `first name: ${name.problem}` }, 422);
      if (!fav) return json({ error: "favourites: a colour, a fruit and an animal, each from the lists" }, 422);
      if (typeof body.under13 !== "boolean") return json({ error: "under13 must be true or false" }, 422);
      const id = randomId(random, "c_");
      // one statement decides the limit and inserts, so two requests at once cannot both take the last place
      const made = await db.prepare("INSERT INTO children (id, family_id, first_name, favourites_json, under13, created_ms) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM children WHERE family_id = ?) < ?")
        .bind(id, family, name.name, JSON.stringify(fav), body.under13 ? 1 : 0, t, family, MAX_CHILDREN).run();
      if (changes(made) !== 1) return withCookie(who, { error: `a family has at most ${MAX_CHILDREN} children` }, 409);
      if (body.under13) await db.prepare("INSERT INTO consents (id, family_id, kind, at_ms, version) VALUES (?, ?, 'child_profile', ?, 1)").bind(randomId(random, "k_"), family, t).run();
      return withCookie(who, { child: { id, firstName: name.name, favourites: fav, under13: body.under13 } }, 201);
    }

    if (route === "POST /api/account/claim-device") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      if (!isDeviceId(body.deviceId)) return json({ error: "a device id is needed" }, 422);
      const mine = (await db.prepare("INSERT INTO device_claims (device_id, family_id, claimed_by, claimed_ms) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO NOTHING").bind(body.deviceId, family, who.parentId, t).run());
      if (changes(mine) === 1) return withCookie(who, { ok: true, already: false }, 201);
      const owner = await db.prepare("SELECT family_id FROM device_claims WHERE device_id = ?").bind(body.deviceId).first();
      if (str(owner?.family_id) === family) return withCookie(who, { ok: true, already: true });
      return withCookie(who, { error: "that device already belongs to a family" }, 409);
    }

    if (route === "DELETE /api/account") {
      const emails = (await db.prepare("SELECT email_hash FROM parents WHERE family_id = ?").bind(family).all()).results.map((r) => str(r.email_hash));
      for (const table of ACCOUNT_FAMILY_TABLES) await db.prepare(`DELETE FROM ${table} WHERE ${table === "families" ? "id" : "family_id"} = ?`).bind(family).run();
      for (const eh of emails) {
        await db.prepare("DELETE FROM login_links WHERE email_hash = ?").bind(eh).run();
        await db.prepare("DELETE FROM account_rate WHERE bucket = 'email' AND key = ?").bind(eh).run();
      }
      return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
    }

    return json({ error: "not found" }, 404);
  };
}

/** The Worker's handler: null for any path that is not under /api/account, 404 unless ACCOUNTS=on. */
export const handleAccounts = createAccountsHandler();
