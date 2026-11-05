// The accounts groundwork (shared/accounts.ts, worker/accounts.ts, migrations/0004_accounts.sql; docs/specs/accounts-and-new-user-spec.md 2.1 to 2.7). INERT unless ACCOUNTS=on.
// The security properties (a link works once, no address is stored, the fourth link an hour is refused) are checked by `violations()` on the real handler AND on versions broken on purpose
// (a single-use check removed, a plain-text address stored, the rate counter reset): each broken version must be caught, or the check proves nothing.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNTS_PER_IP_DAY, DAY_MS, HOUR_MS, LINKS_PER_EMAIL_HOUR, LINKS_PER_IP_HOUR, LINK_TTL_MS, MAX_CHILDREN, MAX_PARENTS, SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS,
  SESSION_ROTATE_AFTER_MS, canAddChild, canAddParent, clearedSessionCookie, cleanFavourites, cleanFirstName, hashEmail, hashIp, hashToken, isDeviceId, linkRefusal, needsRotation,
  newSessionExpiry, normaliseEmail, randomId, randomToken, readCookie, retryAfterSeconds, sessionCookie, sessionVerdict, windowStart,
} from "../shared/accounts";
import {
  ACCOUNTS_SCHEMA, ACCOUNT_FAMILY_TABLES, ACCOUNT_TABLES_CLEANED_BY_EMAIL, createAccountsHandler, handleAccounts, logOutbox, selectSender,
  type AccountsDb, type AccountsDeps, type AccountsEnv, type EmailMessage,
} from "../worker/accounts";
import { cleanName } from "../src/lib/newPlayer";
import { sqliteD1, type SqliteD1 } from "./helpers/sqliteD1";

const MIGRATION = "migrations/0004_accounts.sql";
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0); // on the hour: the hourly rate windows start here
const PARENT = "parent@example.com";
const OTHER = "other@example.org";
const DEVICE = "12345678-1234-1234-1234-123456789abc";
const KID = { firstName: "Mia", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, under13: true };

// ---- harness ----------------------------------------------------------------------------------------------------------------------------------------------------------

interface Res { status: number; body: Record<string, any>; text: string; cookie: string | null; headers: Headers }
const wrapDb = (db: SqliteD1, rewrite: (sql: string) => string): AccountsDb => ({ prepare: (sql) => db.prepare(rewrite(sql)) });

function app(opts: { env?: Partial<AccountsEnv>; deps?: AccountsDeps; rewrite?: (sql: string) => string; migrate?: boolean } = {}) {
  const raw = sqliteD1({ migrations: opts.migrate === false ? [] : [MIGRATION] });
  const db: AccountsDb = opts.rewrite ? wrapDb(raw, opts.rewrite) : raw;
  const outbox: EmailMessage[] = [];
  const clock = { now: T0 };
  const handler = createAccountsHandler({ now: () => clock.now, sender: { send: async (m) => { outbox.push(m); } }, ...opts.deps });
  const env: AccountsEnv = { ACCOUNTS: "on", DB: db, ...opts.env };
  let ipCounter = 0;
  async function call(method: string, p: string, o: { body?: unknown; raw?: string; cookie?: string | null; ip?: string | null; contentType?: string | null } = {}): Promise<Res> {
    const headers: Record<string, string> = {};
    if (o.cookie) headers.cookie = o.cookie;
    if (o.ip !== null) headers["cf-connecting-ip"] = o.ip ?? `10.0.0.${(ipCounter++ % 250) + 1}`; // a fresh address per call, so a test about one limit is not tripped by the other
    const bodiless = method === "GET" || method === "HEAD";
    const body = bodiless ? undefined : o.raw !== undefined ? o.raw : o.body !== undefined ? JSON.stringify(o.body) : undefined;
    if (body !== undefined && o.contentType !== null) headers["content-type"] = o.contentType ?? "application/json";
    const res = await handler(new Request(`https://www.toyventor.com${p}`, { method, headers, body }), env);
    if (!res) return { status: 0, body: {}, text: "", cookie: null, headers: new Headers() };
    const text = await res.text();
    let parsed: Record<string, any> = {};
    try { parsed = JSON.parse(text) as Record<string, any>; } catch { /* not JSON */ }
    const set = res.headers.get("set-cookie");
    return { status: res.status, body: parsed, text, cookie: set ? set.split(";")[0]! : null, headers: res.headers };
  }
  const linkOf = (m: EmailMessage): string => /signin=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
  /** Ask for a link and open it: the session cookie ("tv_session=...") and the responses. */
  async function signIn(email = PARENT, role: "parent" | "self" = "parent") {
    const start = await call("POST", "/api/account/login/start", { body: { email, role } });
    const token = linkOf(outbox[outbox.length - 1]!);
    const verify = await call("POST", "/api/account/login/verify", { body: { token } });
    return { start, verify, token, cookie: verify.cookie };
  }
  const rows = (table: string): Record<string, unknown>[] => raw.raw.prepare(`select * from ${table}`).all() as Record<string, unknown>[];
  const dump = (): string => (raw.raw.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => `${t.name}:${JSON.stringify(rows(t.name))}`).join("\n");
  return { raw, db, outbox, clock, call, linkOf, signIn, rows, dump, env };
}
type App = ReturnType<typeof app>;

afterEach(() => { vi.unstubAllGlobals(); logOutbox.length = 0; });

// ---- the pure rules ---------------------------------------------------------------------------------------------------------------------------------------------------

describe("the pure rules (shared/accounts.ts)", () => {
  it("normaliseEmail lower-cases and trims, and refuses what is not an address", () => {
    expect(normaliseEmail("  Parent@Example.COM ")).toBe("parent@example.com");
    for (const bad of ["", "a@b", "a b@c.de", "@x.com", "a@@b.com", "a@b..com", "a@.com", `${"a".repeat(250)}@b.com`, `${"a".repeat(65)}@b.com`, "a@b.c", "<x>@y.com", 5, null, undefined]) expect(normaliseEmail(bad), String(bad)).toBeNull();
  });
  it("cleanFirstName is the same rule as the setup screen's cleanName", () => {
    for (const n of ["Mia", "Zoë", "Jean-Luc", "O'Neil", "Mary  Ann", " Chloé ", "李雷", "", "   ", "Mia2", "mia@x.com", "http://x", "Mia!", "-Mia", "a".repeat(20), "a".repeat(21), 5, null]) {
      const mine = cleanFirstName(n), theirs = cleanName(n);
      expect(mine.ok, String(n)).toBe(theirs.ok);
      if (mine.ok && theirs.ok) expect(mine.name).toBe(theirs.name);
      if (!mine.ok && !theirs.ok) expect(mine.problem).toBe(theirs.problem);
    }
  });
  it("cleanFavourites takes three short lower-case ids and nothing else", () => {
    expect(cleanFavourites({ colour: "blue", fruit: "apple", animal: "elephant" })).toEqual({ colour: "blue", fruit: "apple", animal: "elephant" });
    for (const bad of [null, "x", {}, { colour: "blue", fruit: "apple" }, { colour: "Blue", fruit: "apple", animal: "dog" }, { colour: "blue", fruit: "an apple", animal: "dog" }, { colour: "blue", fruit: "apple", animal: "a".repeat(30) }, { colour: 1, fruit: "apple", animal: "dog" }]) expect(cleanFavourites(bad)).toBeNull();
  });
  it("isDeviceId takes the app's UUID and refuses paths, spaces and short or long values", () => {
    expect(isDeviceId(DEVICE)).toBe(true);
    for (const bad of ["", "short", "../etc/passwd/../../xx", "a b c d e f g h i j k l", "x".repeat(65), 5, null]) expect(isDeviceId(bad)).toBe(false);
  });
  it("tokens are 32 random bytes in base64url (43 characters, no padding), ids carry their prefix, and a short random source is refused", () => {
    const fill = (n: number) => new Uint8Array(n).map((_, i) => 250 + (i % 6));
    expect(randomToken(fill)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomId(fill, "f_")).toMatch(/^f_[A-Za-z0-9_-]{22}$/);
    expect(() => randomToken(() => new Uint8Array(3))).toThrow();
  });
  it("hashes are separated by purpose: a token, an address and an IP with the same text hash differently, and a pepper changes them", async () => {
    const sha = async (s: string) => `h(${s})`;
    expect(await hashToken(sha, "x")).toBe("h(tok:x)");
    expect(await hashEmail(sha, "a@b.co")).toBe("h(email:|a@b.co)");
    expect(await hashEmail(sha, "a@b.co", "pep")).toBe("h(email:pep|a@b.co)");
    expect(await hashIp(sha, "1.2.3.4")).toBe("h(ip:|1.2.3.4)");
    expect(new Set([await hashToken(sha, "x"), await hashEmail(sha, "x"), await hashIp(sha, "x")]).size).toBe(3);
  });
  it("the windows, the limits and the family sizes are the spec's", () => {
    expect([LINKS_PER_EMAIL_HOUR, LINKS_PER_IP_HOUR, ACCOUNTS_PER_IP_DAY, MAX_CHILDREN, MAX_PARENTS, LINK_TTL_MS, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS, SESSION_ROTATE_AFTER_MS]).toEqual([3, 10, 5, 6, 3, 15 * 60_000, 30 * DAY_MS, 90 * DAY_MS, DAY_MS]);
    expect(windowStart(T0 + 59 * 60_000, HOUR_MS)).toBe(T0);
    expect(windowStart(T0 + HOUR_MS, HOUR_MS)).toBe(T0 + HOUR_MS);
    expect(retryAfterSeconds(T0, HOUR_MS)).toBe(3600);
    expect(retryAfterSeconds(T0 + HOUR_MS - 500, HOUR_MS)).toBe(1);
    expect(linkRefusal({ email: 3, ip: 1 })).toBeNull();
    expect(linkRefusal({ email: 4, ip: 1 })).toBe("email");
    expect(linkRefusal({ email: 1, ip: 10 })).toBeNull();
    expect(linkRefusal({ email: 1, ip: 11 })).toBe("ip");
    expect(canAddChild(5)).toBe(true);
    expect(canAddChild(6)).toBe(false);
    expect(canAddParent(2)).toBe(true);
    expect(canAddParent(3)).toBe(false);
  });
  it("a session is good inside 30 days idle and 90 absolute, and a token older than 24 hours is rotated", () => {
    const s = { createdMs: T0, lastUsedMs: T0, expiresMs: newSessionExpiry(T0) };
    expect(s.expiresMs).toBe(T0 + 90 * DAY_MS);
    expect(sessionVerdict(s, T0 + 30 * DAY_MS)).toBe("valid");
    expect(sessionVerdict(s, T0 + 30 * DAY_MS + 1)).toBe("expired");
    expect(sessionVerdict({ ...s, lastUsedMs: T0 + 80 * DAY_MS }, T0 + 90 * DAY_MS - 1)).toBe("valid");
    expect(sessionVerdict({ ...s, lastUsedMs: T0 + 80 * DAY_MS }, T0 + 90 * DAY_MS)).toBe("expired");
    expect(needsRotation(s, T0 + DAY_MS - 1)).toBe(false);
    expect(needsRotation(s, T0 + DAY_MS)).toBe(true);
  });
  it("the session cookie is httpOnly, Secure, SameSite=Lax and site-wide, and a cleared one has no age", () => {
    const c = sessionCookie("abc", 2592000);
    for (const part of [`${SESSION_COOKIE}=abc`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) expect(c).toContain(part);
    expect(clearedSessionCookie()).toContain("Max-Age=0");
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`, SESSION_COOKIE)).toBe("tok");
    expect(readCookie("a=1", SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
  });
});

// ---- off by default ---------------------------------------------------------------------------------------------------------------------------------------------------

describe("inert: nothing answers unless ACCOUNTS is exactly on", () => {
  const ROUTES: Array<[string, string]> = [["POST", "/api/account/login/start"], ["POST", "/api/account/login/verify"], ["GET", "/api/account/me"], ["POST", "/api/account/logout"], ["POST", "/api/account/children"], ["POST", "/api/account/claim-device"], ["DELETE", "/api/account"]];
  it("every route is a 404 'accounts are off' when ACCOUNTS is unset, and for anything but the exact word on", async () => {
    for (const accounts of [undefined, "", "ON", "On", "true", "1", "yes", " on", "off"]) {
      const a = app({ env: { ACCOUNTS: accounts } });
      for (const [method, p] of ROUTES) {
        const r = await a.call(method, p, { body: { email: PARENT, role: "parent" } });
        expect([r.status, r.body], `${accounts} ${method} ${p}`).toEqual([404, { error: "accounts are off" }]);
      }
      expect(a.rows("parents")).toEqual([]); // and nothing was written
      expect(a.outbox).toEqual([]);
    }
  });
  it("answers null (the Worker carries on) for every path that is not under /api/account, switched on or not", async () => {
    for (const accounts of [undefined, "on"]) {
      const a = app({ env: { ACCOUNTS: accounts } });
      for (const p of ["/", "/api/accounts", "/api/accountx/me", "/api/health", "/api/theme-song", "/account", "/api/world/look"]) expect((await a.call("GET", p)).status, `${accounts} ${p}`).toBe(0);
    }
  });
  it("the exported handleAccounts is the same inert handler", async () => {
    expect(await handleAccounts(new Request("https://x.test/api/account/me"), {})).toMatchObject({ status: 404 });
    expect(await handleAccounts(new Request("https://x.test/api/health"), {})).toBeNull();
  });
  it("switched on but with no database, it says so and does nothing else", async () => {
    const r = await app({ env: { DB: undefined } }).call("GET", "/api/account/me");
    expect([r.status, r.body]).toEqual([503, { error: "accounts need the database" }]);
  });
  it("switched on, an unknown path is a 404 and a wrong method a 405 with Allow", async () => {
    const a = app();
    expect((await a.call("GET", "/api/account/nothing")).body).toEqual({ error: "not found" });
    const wrong = await a.call("GET", "/api/account/login/start");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
    expect((await a.call("POST", "/api/account")).status).toBe(405);
  });
});

// ---- the schema -------------------------------------------------------------------------------------------------------------------------------------------------------

describe("the migration and the lazy tables", () => {
  const sqlOf = (db: SqliteD1): string[] => (db.raw.prepare("select name, sql from sqlite_master where name not like 'sqlite_%' order by name").all() as { name: string; sql: string }[]).map((r) => `${r.name}|${r.sql.replace(/\s+/g, " ")}`);
  it("the file and the Worker's own statements make exactly the same tables and indexes", async () => {
    const fromFile = sqliteD1({ migrations: [MIGRATION] });
    const fromWorker = sqliteD1();
    for (const sql of ACCOUNTS_SCHEMA) fromWorker.raw.exec(sql);
    expect(sqlOf(fromWorker)).toEqual(sqlOf(fromFile));
  });
  it("the Worker creates the tables itself on first use when the migration was never applied", async () => {
    const a = app({ migrate: false });
    expect((await a.call("GET", "/api/account/me")).status).toBe(401);
    expect((a.raw.raw.prepare("select count(*) as n from sqlite_master where name = 'parents'").get() as { n: number }).n).toBe(1);
  });
  it("does not touch the earlier migrations' tables: no ALTER, and none of their names appear", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "..", MIGRATION), "utf8").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/\bALTER\b|\bDROP\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
    for (const old of ["ownership", "parent_settings", "time_ledger", "song_reservations", "song_settings"]) expect(sql).not.toContain(old);
    for (const stmt of ACCOUNTS_SCHEMA) expect(stmt).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  });
  it("every table the migration makes is on a delete list: a new table keyed by a family, a parent, a child or a device cannot be forgotten by 'delete everything'", () => {
    const tables = (sqliteD1({ migrations: [MIGRATION] }).raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect([...ACCOUNT_FAMILY_TABLES, ...ACCOUNT_TABLES_CLEANED_BY_EMAIL].sort()).toEqual(tables);
  });
  it("stores no address: there is no email column, only hashes", () => {
    const cols = (sqliteD1({ migrations: [MIGRATION] }).raw.prepare("select m.name as t, p.name as c from sqlite_master m, pragma_table_info(m.name) p where m.type = 'table'").all() as { t: string; c: string }[]).map((r) => `${r.t}.${r.c}`);
    expect(cols.filter((c) => /email|mail|address|ip/i.test(c.split(".")[1]!)).sort()).toEqual(["login_links.email_hash", "parents.email_hash"]);
  });
});

// ---- the flow ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe("sign in, add a child, claim a device, delete the family", () => {
  it("runs end to end and leaves nothing behind", async () => {
    const a = app();
    const { start, verify, cookie } = await a.signIn();
    expect([start.status, start.body.ok]).toEqual([202, true]);
    expect(a.outbox).toHaveLength(1);
    expect(a.outbox[0]).toMatchObject({ to: PARENT, subject: "Your ToyVentor sign-in link" });
    expect(a.outbox[0]!.text).toContain("https://www.toyventor.com/?signin=");
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ ok: true, new: true, parent: { role: "parent" } });
    expect(cookie).toMatch(/^tv_session=[A-Za-z0-9_-]{43}$/);

    expect((await a.call("GET", "/api/account/me", { cookie })).body).toMatchObject({ children: [], devices: [], parent: { role: "parent" } });
    const kid = await a.call("POST", "/api/account/children", { cookie, body: KID });
    expect([kid.status, kid.body.child.firstName, kid.body.child.under13]).toEqual([201, "Mia", true]);
    const claim = await a.call("POST", "/api/account/claim-device", { cookie, body: { deviceId: DEVICE } });
    expect([claim.status, claim.body]).toEqual([201, { ok: true, already: false }]);

    const me = (await a.call("GET", "/api/account/me", { cookie })).body;
    expect(me.children).toEqual([{ id: kid.body.child.id, firstName: "Mia", favourites: KID.favourites, under13: true }]);
    expect(me.devices).toEqual([DEVICE]);
    expect(JSON.stringify(me)).not.toMatch(/email|hash|@/i); // never the address, never a hash
    expect(a.rows("consents").map((r) => r.kind).sort()).toEqual(["account", "child_profile"]);

    const del = await a.call("DELETE", "/api/account", { cookie });
    expect(del.status).toBe(200);
    expect(del.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await a.call("GET", "/api/account/me", { cookie })).status).toBe(401);
    for (const t of [...ACCOUNT_FAMILY_TABLES, "login_links"]) expect(a.rows(t), t).toEqual([]);
    expect(a.rows("account_rate").filter((r) => r.bucket === "email")).toEqual([]);
  });
  it("a second sign-in for the same address finds the same family, and the first verify made it", async () => {
    const a = app();
    const one = await a.signIn();
    const two = await a.signIn();
    expect(one.verify.body.new).toBe(true);
    expect(two.verify.body.new).toBe(false);
    expect(two.verify.body.family.id).toBe(one.verify.body.family.id);
    expect(a.rows("families")).toHaveLength(1);
    expect(a.rows("parents")).toHaveLength(1);
  });
  it("the same 202 body for an address that has an account and one that has not", async () => {
    const a = app();
    await a.signIn(PARENT);
    const known = await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    const unknown = await a.call("POST", "/api/account/login/start", { body: { email: "nobody@example.net", role: "parent" } });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(known.text).toBe(unknown.text);
    expect(a.outbox).toHaveLength(3); // both were sent a link
  });
  it("a malformed request is refused kindly: a bad address or role 422, not JSON 415 or 400, too large 413", async () => {
    const a = app();
    expect((await a.call("POST", "/api/account/login/start", { body: { email: "nope", role: "parent" } })).status).toBe(422);
    expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "admin" } })).status).toBe(422);
    expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "child" } })).status).toBe(422);
    expect((await a.call("POST", "/api/account/login/start", { raw: "email=x", contentType: "text/plain" })).status).toBe(415);
    expect((await a.call("POST", "/api/account/login/start", { raw: "{not json" })).status).toBe(400);
    expect((await a.call("POST", "/api/account/login/start", { raw: "[1]" })).status).toBe(400);
    expect((await a.call("POST", "/api/account/login/start", { raw: JSON.stringify({ email: PARENT, role: "parent", pad: "x".repeat(5000) }) })).status).toBe(413);
    expect(a.outbox).toEqual([]);
  });
});

describe("a sign-in link works once, for fifteen minutes", () => {
  it("a second use fails with the same answer as an unknown link", async () => {
    const a = app();
    const { token } = await a.signIn();
    const again = await a.call("POST", "/api/account/login/verify", { body: { token } });
    const unknown = await a.call("POST", "/api/account/login/verify", { body: { token: "A".repeat(43) } });
    expect([again.status, unknown.status]).toEqual([400, 400]);
    expect(again.text).toBe(unknown.text);
    expect(again.cookie).toBeNull();
  });
  it("an expired link fails: good the moment before 15 minutes, dead at 15", async () => {
    const a = app();
    await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    const token = a.linkOf(a.outbox[0]!);
    a.clock.now = T0 + LINK_TTL_MS;
    expect((await a.call("POST", "/api/account/login/verify", { body: { token } })).status).toBe(400);
    const b = app();
    await b.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    b.clock.now = T0 + LINK_TTL_MS - 1;
    expect((await b.call("POST", "/api/account/login/verify", { body: { token: b.linkOf(b.outbox[0]!) } })).status).toBe(200);
  });
  it("a malformed token is refused before the database", async () => {
    const a = app();
    for (const token of [undefined, 5, "", "short", "has spaces in it which is long enough to pass", "x".repeat(200)]) expect((await a.call("POST", "/api/account/login/verify", { body: { token } })).status).toBe(400);
  });
  it("only hashes are stored: the link token and the session token are nowhere in the database", async () => {
    const a = app();
    const { token, cookie } = await a.signIn();
    const sessionToken = cookie!.split("=")[1]!;
    expect(a.dump()).not.toContain(token);
    expect(a.dump()).not.toContain(sessionToken);
    expect(a.rows("login_links")[0]!.token_hash).toBe(await hashToken(async (s) => {
      const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }, token));
  });
});

describe("limits on asking for links", () => {
  it("the fourth link in an hour for one address is refused with 429 and Retry-After, and sends nothing", async () => {
    const a = app();
    for (let i = 0; i < 3; i++) expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } })).status).toBe(202);
    const fourth = await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    expect([fourth.status, fourth.body, fourth.headers.get("retry-after")]).toEqual([429, { error: "too many requests" }, "3600"]);
    expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } })).status).toBe(429); // a refused attempt still counts: flooding stays refused
    expect(a.outbox).toHaveLength(3);
    expect(a.rows("login_links")).toHaveLength(3);
    expect((await a.call("POST", "/api/account/login/start", { body: { email: OTHER, role: "parent" } })).status).toBe(202); // another address is not affected
  });
  it("opens again when the hour turns", async () => {
    const a = app();
    for (let i = 0; i < 4; i++) await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    a.clock.now = T0 + HOUR_MS - 1;
    expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } })).status).toBe(429);
    a.clock.now = T0 + HOUR_MS;
    expect((await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } })).status).toBe(202);
  });
  it("the same address in different letters is the same address", async () => {
    const a = app();
    for (const e of ["Parent@Example.com", "PARENT@example.com", " parent@example.com", "parent@EXAMPLE.COM"]) await a.call("POST", "/api/account/login/start", { body: { email: e, role: "parent" } });
    expect(a.outbox).toHaveLength(3);
  });
  it("ten links an hour from one IP, then 429, whatever the addresses", async () => {
    const a = app();
    for (let i = 0; i < LINKS_PER_IP_HOUR; i++) expect((await a.call("POST", "/api/account/login/start", { ip: "203.0.113.9", body: { email: `p${i}@example.com`, role: "parent" } })).status).toBe(202);
    expect((await a.call("POST", "/api/account/login/start", { ip: "203.0.113.9", body: { email: "p99@example.com", role: "parent" } })).status).toBe(429);
    expect((await a.call("POST", "/api/account/login/start", { ip: "203.0.113.10", body: { email: "p99@example.com", role: "parent" } })).status).toBe(202);
  });
  it("five new families a day from one IP, then 429 (an existing family can still sign in)", async () => {
    const a = app();
    for (let i = 0; i < ACCOUNTS_PER_IP_DAY; i++) {
      await a.call("POST", "/api/account/login/start", { body: { email: `n${i}@example.com`, role: "parent" } });
      expect((await a.call("POST", "/api/account/login/verify", { ip: "198.51.100.7", body: { token: a.linkOf(a.outbox[a.outbox.length - 1]!) } })).status).toBe(200);
    }
    await a.call("POST", "/api/account/login/start", { body: { email: "n9@example.com", role: "parent" } });
    expect((await a.call("POST", "/api/account/login/verify", { ip: "198.51.100.7", body: { token: a.linkOf(a.outbox[a.outbox.length - 1]!) } })).status).toBe(429);
    await a.call("POST", "/api/account/login/start", { body: { email: "n0@example.com", role: "parent" } });
    expect((await a.call("POST", "/api/account/login/verify", { ip: "198.51.100.7", body: { token: a.linkOf(a.outbox[a.outbox.length - 1]!) } })).status).toBe(200);
    expect(a.rows("families")).toHaveLength(ACCOUNTS_PER_IP_DAY);
  });
  it("keeps IPs out of the database: only their hash is held", async () => {
    const a = app();
    await a.call("POST", "/api/account/login/start", { ip: "203.0.113.77", body: { email: PARENT, role: "parent" } });
    expect(a.dump()).not.toContain("203.0.113.77");
    expect(a.dump()).not.toContain(PARENT);
  });
});

// ---- email ------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("email: off unless set up", () => {
  const startWith = (env: Partial<AccountsEnv>, deps: AccountsDeps = {}) => { const a = app({ env, deps: { sender: undefined, ...deps } }); return { a, start: () => a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } }) }; };
  it("EMAIL_BACKEND unset or off: 503 'email is not set up', and nothing is counted, created or sent", async () => {
    for (const backend of [undefined, "off", "OFF", "smtp", ""]) {
      const { a, start } = startWith({ EMAIL_BACKEND: backend });
      const r = await start();
      expect([r.status, r.body], String(backend)).toEqual([503, { error: "email is not set up" }]);
      expect(a.rows("login_links")).toEqual([]);
      expect(a.rows("account_rate")).toEqual([]);
    }
    const { a, start } = startWith({}, { sender: null });
    expect((await start()).status).toBe(503);
    expect(a.rows("login_links")).toEqual([]);
  });
  it("the log backend records the message and is refused in production", async () => {
    const dev = startWith({ EMAIL_BACKEND: "log" });
    expect((await dev.start()).status).toBe(202);
    expect(logOutbox).toHaveLength(1);
    expect(logOutbox[0]).toMatchObject({ to: PARENT });
    logOutbox.length = 0;
    const prod = startWith({ EMAIL_BACKEND: "log", ENVIRONMENT: "production" });
    expect((await prod.start()).status).toBe(503);
    expect(logOutbox).toEqual([]);
  });
  it("resend and binding need their secrets; with them the sender is built (NOT verified against the real services)", () => {
    expect(selectSender({ EMAIL_BACKEND: "resend" })).toBeNull();
    expect(selectSender({ EMAIL_BACKEND: "resend", RESEND_API_KEY: "k" })).toBeNull();
    expect(selectSender({ EMAIL_BACKEND: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "ToyVentor <hello@toyventor.com>" })).not.toBeNull();
    expect(selectSender({ EMAIL_BACKEND: "binding", EMAIL_FROM: "hello@toyventor.com" })).toBeNull();
    expect(selectSender({ EMAIL_BACKEND: "binding", SEND_EMAIL: { send: async () => ({}) } })).toBeNull();
    expect(selectSender({ EMAIL_BACKEND: "binding", SEND_EMAIL: { send: async () => ({}) }, EMAIL_FROM: "hello@toyventor.com" })).not.toBeNull();
  });
  it("the resend sender posts the message to api.resend.com with the key (a stand-in for fetch; the real service was not called)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); });
    const sender = selectSender({ EMAIL_BACKEND: "resend", RESEND_API_KEY: "key-1", EMAIL_FROM: "hello@toyventor.com" })!;
    await sender.send({ to: PARENT, subject: "s", text: "t" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer key-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "hello@toyventor.com", to: [PARENT], subject: "s", text: "t" });
    vi.stubGlobal("fetch", async () => new Response("no", { status: 422 }));
    await expect(sender.send({ to: PARENT, subject: "s", text: "t" })).rejects.toThrow();
  });
  it("the binding sender calls the binding with the configured From (a stand-in; the real binding was not called)", async () => {
    const sent: unknown[] = [];
    const sender = selectSender({ EMAIL_BACKEND: "binding", EMAIL_FROM: "hello@toyventor.com", SEND_EMAIL: { send: async (m) => { sent.push(m); } } })!;
    await sender.send({ to: PARENT, subject: "s", text: "t" });
    expect(sent).toEqual([{ from: "hello@toyventor.com", to: PARENT, subject: "s", text: "t" }]);
  });
  it("when the binding rejects, only its error code reaches the log (never the address), the error is rethrown, and the route answers 502", async () => {
    const logged: unknown[][] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { logged.push(a); });
    const failing = (error: unknown) => selectSender({ EMAIL_BACKEND: "binding", EMAIL_FROM: "hello@toyventor.com", SEND_EMAIL: { send: async () => { throw error; } } })!;
    const coded = Object.assign(new Error(`could not deliver to ${PARENT}`), { code: "E_RECIPIENT_SUPPRESSED" });
    await expect(failing(coded).send({ to: PARENT, subject: "s", text: "t" })).rejects.toBe(coded);
    await expect(failing("odd").send({ to: PARENT, subject: "s", text: "t" })).rejects.toBe("odd");
    warn.mockRestore();
    expect(logged.map((l) => l[1])).toEqual(["E_RECIPIENT_SUPPRESSED", "unknown"]);
    expect(JSON.stringify(logged)).not.toContain(PARENT);
  });
  it("wrangler.jsonc has the SEND_EMAIL binding and does not switch accounts on", () => {
    const cfg = fs.readFileSync(path.join(__dirname, "..", "wrangler.jsonc"), "utf8");
    expect(cfg).toMatch(/"send_email":\s*\[\{\s*"name":\s*"SEND_EMAIL"\s*\}\]/);
    expect(cfg).not.toMatch(/"ACCOUNTS"\s*:/);
    expect(cfg).not.toMatch(/"EMAIL_BACKEND"\s*:/);
  });
  it("a sender that fails answers 502 and says nothing about the address", async () => {
    const a = app({ deps: { sender: { send: async () => { throw new Error("smtp down"); } } } });
    const r = await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    expect([r.status, r.body]).toEqual([502, { error: "could not send the email" }]);
  });
  it("the emailed link uses ACCOUNTS_LINK_BASE when it is set, and carries only the token", async () => {
    const a = app({ env: { ACCOUNTS_LINK_BASE: "https://example.org/" } });
    await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
    expect(a.outbox[0]!.text).toMatch(/https:\/\/example\.org\/\?signin=[A-Za-z0-9_-]{43}\n/);
    expect(a.outbox[0]!.text).not.toMatch(/family|child|name/i);
  });
});

// ---- sessions ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe("sessions", () => {
  it("the cookie is httpOnly, Secure, SameSite=Lax, site-wide and lasts 30 days", async () => {
    const a = app();
    const { verify } = await a.signIn();
    const set = verify.headers.get("set-cookie")!;
    for (const part of ["tv_session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_IDLE_MS / 1000}`]) expect(set).toContain(part);
  });
  it("no cookie, a malformed one or an unknown one is 401, and so is every session route", async () => {
    const a = app();
    for (const [method, p] of [["GET", "/api/account/me"], ["POST", "/api/account/children"], ["POST", "/api/account/claim-device"], ["DELETE", "/api/account"]] as const) {
      expect((await a.call(method, p, { body: KID })).status, `${method} ${p}`).toBe(401);
      expect((await a.call(method, p, { body: KID, cookie: "tv_session=garbage" })).status).toBe(401);
      expect((await a.call(method, p, { body: KID, cookie: `tv_session=${"B".repeat(43)}` })).status).toBe(401);
    }
  });
  it("inside 24 hours the same cookie keeps working and no new one is issued; after 24 hours it is replaced and the old one is dead", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    a.clock.now = T0 + DAY_MS - 1;
    const early = await a.call("GET", "/api/account/me", { cookie });
    expect([early.status, early.cookie]).toEqual([200, null]);
    a.clock.now = T0 + DAY_MS;
    const rotated = await a.call("GET", "/api/account/me", { cookie });
    expect(rotated.status).toBe(200);
    expect(rotated.cookie).toMatch(/^tv_session=/);
    expect(rotated.cookie).not.toBe(cookie);
    expect((await a.call("GET", "/api/account/me", { cookie })).status).toBe(401);
    expect((await a.call("GET", "/api/account/me", { cookie: rotated.cookie })).status).toBe(200);
    expect(a.rows("sessions")).toHaveLength(1);
    expect(a.rows("sessions")[0]!.expires_ms).toBe(T0 + SESSION_ABSOLUTE_MS); // a rotation does not extend the 90 days
  });
  it("30 days without use ends a session, and the row is removed", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    a.clock.now = T0 + SESSION_IDLE_MS + 1;
    expect((await a.call("GET", "/api/account/me", { cookie })).status).toBe(401);
    expect(a.rows("sessions")).toEqual([]);
  });
  it("90 days ends it even when it is used all the time", async () => {
    const a = app();
    let { cookie } = await a.signIn();
    for (const day of [20, 40, 60, 80]) {
      a.clock.now = T0 + day * DAY_MS;
      const r = await a.call("GET", "/api/account/me", { cookie });
      expect([r.status, day]).toEqual([200, day]);
      cookie = r.cookie ?? cookie;
    }
    a.clock.now = T0 + 91 * DAY_MS;
    expect((await a.call("GET", "/api/account/me", { cookie })).status).toBe(401);
  });
  it("a rotated cookie never outlives the absolute end", async () => {
    const a = app();
    let { cookie } = await a.signIn();
    for (const day of [25, 50, 75]) { // used often enough never to go idle
      a.clock.now = T0 + day * DAY_MS;
      cookie = (await a.call("GET", "/api/account/me", { cookie })).cookie ?? cookie;
    }
    a.clock.now = T0 + 80 * DAY_MS;
    const r = await a.call("GET", "/api/account/me", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain(`Max-Age=${(10 * DAY_MS) / 1000}`); // 10 days left of the 90, not another 30
  });
  it("logout ends the session and clears the cookie; logging out with nothing is fine", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    const out = await a.call("POST", "/api/account/logout", { cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await a.call("GET", "/api/account/me", { cookie })).status).toBe(401);
    expect((await a.call("POST", "/api/account/logout")).status).toBe(200);
  });
});

// ---- children and devices ---------------------------------------------------------------------------------------------------------------------------------------------

describe("children", () => {
  it("six, then the seventh is refused with 409 (and eight at once still make exactly six)", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    for (let i = 0; i < MAX_CHILDREN; i++) expect((await a.call("POST", "/api/account/children", { cookie, body: { ...KID, firstName: `Kid${"abcdef"[i]}` } })).status).toBe(201);
    const seventh = await a.call("POST", "/api/account/children", { cookie, body: KID });
    expect([seventh.status, seventh.body]).toEqual([409, { error: "a family has at most 6 children" }]);
    expect(a.rows("children")).toHaveLength(6);
    const b = app();
    const s = await b.signIn();
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) => b.call("POST", "/api/account/children", { cookie: s.cookie, body: { ...KID, firstName: `Kid${"abcdefgh"[i]}` } })));
    expect(all.filter((r) => r.status === 201)).toHaveLength(6);
    expect(b.rows("children")).toHaveLength(6);
  });
  it("takes a first name and three closed-list ids and nothing else", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    const bad = [{ ...KID, firstName: "Mia2" }, { ...KID, firstName: "mia@x.com" }, { ...KID, firstName: "" }, { ...KID, firstName: "a".repeat(21) }, { ...KID, favourites: { colour: "blue", fruit: "a very long free text answer", animal: "dog" } }, { ...KID, favourites: null }, { ...KID, under13: "yes" }, { firstName: "Mia", favourites: KID.favourites }];
    for (const body of bad) expect((await a.call("POST", "/api/account/children", { cookie, body })).status, JSON.stringify(body)).toBe(422);
    expect(a.rows("children")).toEqual([]);
    expect((await a.call("POST", "/api/account/children", { cookie, body: { ...KID, under13: false } })).status).toBe(201);
    expect(a.rows("consents").map((r) => r.kind)).toEqual(["account"]); // only an under-13 profile records a child consent
  });
});

describe("claiming a device", () => {
  it("writes one mapping row and touches nothing else; claiming again is fine; a bad id is refused", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    const before = a.dump().replace(/"claimed_ms":\d+/g, "");
    expect((await a.call("POST", "/api/account/claim-device", { cookie, body: { deviceId: DEVICE } })).status).toBe(201);
    const again = await a.call("POST", "/api/account/claim-device", { cookie, body: { deviceId: DEVICE } });
    expect([again.status, again.body]).toEqual([200, { ok: true, already: true }]);
    expect(a.rows("device_claims")).toHaveLength(1);
    expect(a.rows("device_claims")[0]).toMatchObject({ device_id: DEVICE });
    expect(a.dump().replace(/"claimed_ms":\d+/g, "").replace(/device_claims:.*\n?/, "")).toBe(before.replace(/device_claims:.*\n?/, ""));
    for (const deviceId of ["", "short", "../../etc/passwd/xxxxxxxxxxxxxx", 5]) expect((await a.call("POST", "/api/account/claim-device", { cookie, body: { deviceId } })).status).toBe(422);
  });
});

// ---- families are separate --------------------------------------------------------------------------------------------------------------------------------------------

describe("one family cannot reach another's rows", () => {
  async function two(): Promise<{ a: App; one: string; two: string; kid: string }> {
    const a = app();
    const one = (await a.signIn(PARENT)).cookie!;
    const twoCookie = (await a.signIn(OTHER)).cookie!;
    const kid = (await a.call("POST", "/api/account/children", { cookie: one, body: KID })).body.child.id as string;
    await a.call("POST", "/api/account/claim-device", { cookie: one, body: { deviceId: DEVICE } });
    return { a, one, two: twoCookie, kid };
  }
  it("each sees only its own children, devices and grown-up", async () => {
    const { a, one, two: second } = await two();
    const mine = (await a.call("GET", "/api/account/me", { cookie: one })).body;
    const theirs = (await a.call("GET", "/api/account/me", { cookie: second })).body;
    expect([mine.children.length, mine.devices.length]).toEqual([1, 1]);
    expect([theirs.children, theirs.devices]).toEqual([[], []]);
    expect(theirs.family.id).not.toBe(mine.family.id);
    expect(theirs.parent.id).not.toBe(mine.parent.id);
  });
  it("another family cannot claim a device that is taken (409), and its attempt changes nothing", async () => {
    const { a, two: second } = await two();
    const r = await a.call("POST", "/api/account/claim-device", { cookie: second, body: { deviceId: DEVICE } });
    expect([r.status, r.body]).toEqual([409, { error: "that device already belongs to a family" }]);
    expect(a.rows("device_claims")).toHaveLength(1);
  });
  it("deleting one family leaves the other's rows, links and session exactly as they were", async () => {
    const { a, one, two: second } = await two();
    const familyOne = (await a.call("GET", "/api/account/me", { cookie: one })).body.family.id as string;
    const before = { kids: a.rows("children").filter((r) => r.family_id === familyOne), devices: a.rows("device_claims"), parent: a.rows("parents").filter((r) => r.family_id === familyOne), consents: a.rows("consents").filter((r) => r.family_id === familyOne) };
    expect(before.kids).toHaveLength(1); // (something to lose, or the comparisons below prove nothing)
    expect(before.devices).toHaveLength(1);
    expect((await a.call("DELETE", "/api/account", { cookie: second })).status).toBe(200);
    expect(a.rows("children").filter((r) => r.family_id === familyOne)).toEqual(before.kids);
    expect(a.rows("device_claims")).toEqual(before.devices);
    expect(a.rows("parents").filter((r) => r.family_id === familyOne)).toEqual(before.parent);
    expect(a.rows("consents").filter((r) => r.family_id === familyOne)).toEqual(before.consents);
    expect(a.rows("families")).toHaveLength(1);
    expect(a.rows("parents")).toHaveLength(1);
    expect((await a.call("GET", "/api/account/me", { cookie: one })).status).toBe(200); // still signed in
    expect((await a.call("GET", "/api/account/me", { cookie: second })).status).toBe(401);
    expect(a.rows("login_links").length).toBe(1); // only the other family's link is left (the used one, kept as a record)
  });
  it("a deleted address can sign up again as a brand new family", async () => {
    const a = app();
    const { cookie } = await a.signIn();
    await a.call("DELETE", "/api/account", { cookie });
    const again = await a.signIn();
    expect(again.verify.body.new).toBe(true);
  });
});

// ---- mutants ----------------------------------------------------------------------------------------------------------------------------------------------------------

/** The three security properties, run against whatever handler the app was built with: an empty list means all three hold. */
async function violations(a: App): Promise<string[]> {
  const found: string[] = [];
  await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } });
  const token = a.linkOf(a.outbox[0]!);
  const first = await a.call("POST", "/api/account/login/verify", { body: { token } });
  const second = await a.call("POST", "/api/account/login/verify", { body: { token } });
  if (first.status !== 200) found.push("the first use of a link failed");
  if (second.status === 200) found.push("a link worked twice");
  if (a.dump().includes(PARENT)) found.push("an address is stored in plain text");
  let sent = 1;
  for (let i = 0; i < 4; i++) { const r = await a.call("POST", "/api/account/login/start", { body: { email: PARENT, role: "parent" } }); if (r.status === 202) sent++; }
  if (sent > LINKS_PER_EMAIL_HOUR) found.push("more than three links an hour were sent for one address");
  return found;
}

describe("the security checks catch a broken version", () => {
  it("the real handler passes all three", async () => {
    expect(await violations(app())).toEqual([]);
  });
  it("a version with no single-use check is caught", async () => {
    const found = await violations(app({ rewrite: (sql) => sql.replace(" AND used_ms IS NULL", "") }));
    expect(found).toContain("a link worked twice");
  });
  it("a version that stores the address in plain text is caught", async () => {
    const found = await violations(app({ deps: { hashEmail: async (email) => email } }));
    expect(found).toContain("an address is stored in plain text");
  });
  it("a version whose rate counter never counts is caught", async () => {
    const found = await violations(app({ rewrite: (sql) => sql.replace("count = count + 1", "count = 1") }));
    expect(found).toContain("more than three links an hour were sent for one address");
  });
  it("the mutants are each caught for the right reason only: the others still hold", async () => {
    expect(await violations(app({ rewrite: (sql) => sql.replace(" AND used_ms IS NULL", "") }))).toEqual(["a link worked twice"]);
    expect(await violations(app({ deps: { hashEmail: async (email) => email } }))).toEqual(["an address is stored in plain text"]);
  });
});
