// Generated worlds, the Worker side (docs/specs/generated-worlds-spec.md section 0; the shapes and pure rules are in shared/worldBrief.ts).
//
//   POST /api/world/look  { wish, theme }  ->  one Muse Spark call writes a WorldBrief (the world's look) over the base theme Create already chose; code validates it. An OUTDOOR brief comes back with
//                                              three SIGNED art tickets (far day, far night, mid); an INDOOR brief has no painted layers (art: null).
//   POST /api/world/art   { ticket }       ->  the Worker paints ONE layer, from the sentence inside the signed ticket and from nothing else, and returns the raw image.
//
// Why two routes and signatures: the game builds Create's recipe prompt itself and sends it to /api/muse/spark, so the Worker cannot tell the model's words from a client's. Here the Worker writes the
// prompt, validates what the model said, and signs the sentences it will paint; a client can neither choose what the image model is asked nor ask for anything the Worker did not first approve.
// Free text from a client never reaches the image model (the child's words go to the text model only, the same class as Create and Describe).
//
// Cost control (the point of the daily budgets): a world is about three image calls and one text call. D1 counts UNITS per UTC day in scopes: "global" (WORLD_DAILY_GLOBAL, default 30), one per
// address (a hash, never the address; WORLD_DAILY_PER_IP, default 5), and for indoor looks (text only) "indoor" and a per-address indoor scope at five times those. A unit is taken before the model is
// asked and given back if no look comes out of it, so a model hiccup does not eat a child's day. No database means no outdoor looks (fail closed). The existing MODEL_SPEND_LIMITER and the in-isolate
// per-address limit sit in front of this too, and neither is a hard cap: the D1 counts are.
//
// Nothing here logs a wish, a sentence, a ticket, an address or a key.
import { signingConfigured, type SigningEnv } from "./forgeNames";
import { readCappedJson } from "./body";
import { SAFETY, firstJsonObject, kidSafeText, museRateLimited, scrubContactDetails } from "./muse";
import { DEFAULT_TEXT_MODEL, askText, hostedOnly, resolveBackend, resolveModel, type BackendEnv } from "./modelBackend";
import type { D1Like } from "./ownership";
import { BASES, IMAGE_SIZE, MAX_WISH_CHARS, TICKET_TTL_MS, briefPrompt, farPrompt, midPrompt, parseBrief, signTicket, verifyTicket, type Base } from "../shared/worldBrief";

export interface WorldLookEnv extends BackendEnv, SigningEnv {
  DB?: D1Like;
  /** Worlds per UTC day for the whole app (default 30), and per address (default 5). Digits only; anything else means the default. */
  WORLD_DAILY_GLOBAL?: string;
  WORLD_DAILY_PER_IP?: string;
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

const MAX_BODY_BYTES = 4_000;
const TEXT_TIMEOUT_MS = 45_000;
const ART_TIMEOUT_MS = 120_000;
const MAX_ART_BYTES = 6_000_000;
export const DEFAULT_DAILY_GLOBAL = 30;
export const DEFAULT_DAILY_PER_IP = 5;
/** Indoor looks cost one text call and no image, so their daily caps are this many times the outdoor ones. */
export const INDOOR_FACTOR = 5;
/** A ticket paints at most this many times: the first call and one retry. */
export const REDEEM_MAX = 2;

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLimit(value: unknown, fallback: number): number {
  return typeof value === "string" && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : fallback;
}

// ---- the daily budgets (D1) -------------------------------------------------------------------------------------------------

const CREATE = [
  "CREATE TABLE IF NOT EXISTS world_budget (day TEXT NOT NULL, scope TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope))",
  "CREATE TABLE IF NOT EXISTS world_art_redeem (h TEXT PRIMARY KEY, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0)",
];
const missingTable = (err: unknown) => /no such table:\s*world_(budget|art_redeem)/i.test(err instanceof Error ? err.message : String(err));

/** Run `op`; if the tables are not there yet, create them once and run it again (the pattern songStore.ts and ownership.ts use: no migration file). */
async function withTables<T>(db: D1Like, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!missingTable(err)) throw err;
    for (const sql of CREATE) await db.prepare(sql).bind().run();
    return await op();
  }
}

const changesOf = (res: unknown): number => {
  const meta = isRecord(res) && isRecord(res.meta) ? res.meta : null;
  return meta && typeof meta.changes === "number" ? meta.changes : 0;
};

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Seconds until the next UTC midnight (at least a minute), for retry-after. */
export function secondsToReset(now: number): number {
  const next = Date.parse(`${utcDay(now)}T00:00:00Z`) + 86_400_000;
  return Math.max(60, Math.ceil((next - now) / 1000));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The address as a scope name: a salted hash (the address itself is never stored), 16 hex characters. */
export async function ipScope(prefix: string, ip: string | null | undefined): Promise<string> {
  return `${prefix}:${(await sha256Hex(`worldip:${ip ?? "unknown"}`)).slice(0, 16)}`;
}

/** Take ONE unit of a scope for a day if it has fewer than `limit` used: a single upsert, so two requests racing for the last unit cannot both get it. */
export async function takeUnit(db: D1Like, day: string, scope: string, limit: number): Promise<boolean> {
  if (!(limit > 0)) return false;
  const res = await withTables(db, () =>
    db.prepare("INSERT INTO world_budget (day, scope, count) VALUES (?, ?, 1) ON CONFLICT (day, scope) DO UPDATE SET count = count + 1 WHERE count < ?").bind(day, scope, limit).run(),
  );
  return changesOf(res) > 0;
}

/** Give a unit back (a look that did not come out). Never below zero. */
export async function giveUnitBack(db: D1Like, day: string, scope: string): Promise<void> {
  await withTables(db, () => db.prepare("UPDATE world_budget SET count = count - 1 WHERE day = ? AND scope = ? AND count > 0").bind(day, scope).run());
}

/** Take a unit from every scope, in order, or from none: if a later scope is full, the ones already taken are given back. */
export async function takeUnits(db: D1Like, day: string, scopes: { scope: string; limit: number }[]): Promise<boolean> {
  const taken: string[] = [];
  for (const s of scopes) {
    let ok = false;
    try { ok = await takeUnit(db, day, s.scope, s.limit); } catch { ok = false; }                         // (a database error closes the door, it never opens it)
    if (!ok) {
      for (const t of taken) await giveUnitBack(db, day, t).catch(() => undefined);
      return false;
    }
    taken.push(s.scope);
  }
  return true;
}

/** Best-effort housekeeping: budget rows older than two days and redemption counts older than a day. */
async function cleanup(db: D1Like, now: number): Promise<void> {
  const ago = (days: number) => utcDay(now - days * 86_400_000);
  await withTables(db, async () => {
    await db.prepare("DELETE FROM world_budget WHERE day < ?").bind(ago(2)).run();
    await db.prepare("DELETE FROM world_art_redeem WHERE day < ?").bind(ago(1)).run();
  });
}

/** One redemption of a ticket (counted by a hash of it, the ticket itself is never stored): true while it has been used fewer than REDEEM_MAX times. */
export async function redeemTicket(db: D1Like, ticket: string, now: number): Promise<boolean> {
  const h = await sha256Hex(`worldart-redeem:${ticket}`);
  const res = await withTables(db, () =>
    db.prepare("INSERT INTO world_art_redeem (h, day, n) VALUES (?, ?, 1) ON CONFLICT (h) DO UPDATE SET n = n + 1 WHERE n < ?").bind(h, utcDay(now), REDEEM_MAX).run(),
  );
  return changesOf(res) > 0;
}

// ---- POST /api/world/look ---------------------------------------------------------------------------------------------------

const squish = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();
/** The child's words as the prompt quotes them: what the model must not repeat (the same rule worker/muse.ts applies to Create). */
const childSaidOf = (prompt: string): string => {
  const m = /The child said: "([^"]*)"/.exec(prompt);
  return m ? squish(m[1] ?? "") : "";
};

const isBase = (v: unknown): v is Base => typeof v === "string" && (BASES as readonly string[]).includes(v);

export async function handleWorldLook(request: Request, env: WorldLookEnv, ctx?: Ctx): Promise<Response> {
  const backend = resolveBackend(env, "text");
  if (request.method === "GET") {
    return json({ ok: true, route: "world-look", configured: backend.mode !== "off" && signingConfigured(env) && hostedOnly(env, "image") !== null });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const ip = request.headers.get("CF-Connecting-IP");
  if (museRateLimited(ip)) return json({ ok: false, status: "slow-down", error: "Slow down, one world at a time. Try again in a minute." }, 429, { "retry-after": "60" });

  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "expected application/json" }, 415);
  const parsed = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
  const body = isRecord(parsed.value) ? parsed.value : {};
  const wish = typeof body.wish === "string" ? body.wish.trim() : "";
  if (!wish) return json({ error: "wish is required" }, 422);
  if (wish.length > MAX_WISH_CHARS) return json({ error: `wish over ${MAX_WISH_CHARS} characters` }, 413);
  if (!isBase(body.theme)) return json({ error: `theme must be one of ${BASES.join(", ")}` }, 422);
  const theme = body.theme;
  const indoor = theme === "room";

  // A wish that carries an unsafe term, a link or contact details is not sent to any model: the game falls back to the base theme.
  if (!kidSafeText(wish)) {
    console.log(JSON.stringify({ event: "world_look", status: "wish-refused" }));
    return json({ ok: false, status: "gentle" });
  }

  const wantedModel = resolveModel(undefined, env) ?? DEFAULT_TEXT_MODEL;
  const needsArt = !indoor;
  if (backend.mode === "off" || (needsArt && (!signingConfigured(env) || hostedOnly(env, "image") === null))) {
    return json({ ok: false, status: "not-configured" }, 503);
  }

  // The daily budget, taken BEFORE the model is asked and given back if no look comes of it.
  const now = Date.now();
  const day = utcDay(now);
  const perIp = parseLimit(env.WORLD_DAILY_PER_IP, DEFAULT_DAILY_PER_IP);
  const global = parseLimit(env.WORLD_DAILY_GLOBAL, DEFAULT_DAILY_GLOBAL);
  const scopes = indoor
    ? [{ scope: await ipScope("ipi", ip), limit: perIp * INDOOR_FACTOR }, { scope: "indoor", limit: global * INDOOR_FACTOR }]
    : [{ scope: await ipScope("ip", ip), limit: perIp }, { scope: "global", limit: global }];
  const db = env.DB;
  let spent = false;
  if (db) {
    if (!(await takeUnits(db, day, scopes))) {
      console.log(JSON.stringify({ event: "world_look", status: "daily-limit", kind: indoor ? "indoor" : "outdoor" }));
      return json({ ok: false, status: "daily-limit" }, 429, { "retry-after": String(secondsToReset(now)) });
    }
    spent = true;
    if (ctx) ctx.waitUntil(cleanup(db, now).catch(() => undefined));
  } else if (!indoor) {
    console.log(JSON.stringify({ event: "world_look", status: "no-database" }));
    return json({ ok: false, status: "daily-limit" }, 429, { "retry-after": String(secondsToReset(now)) });          // (no way to count, so no image budget is ever spent)
  }
  const giveBack = async () => {
    if (!spent || !db) return;
    for (const s of scopes) await giveUnitBack(db, day, s.scope).catch(() => undefined);
  };
  const gentle = async (why: string) => {
    await giveBack();
    console.log(JSON.stringify({ event: "world_look", status: why, kind: indoor ? "indoor" : "outdoor" }));
    return json({ ok: false, status: "gentle" });
  };

  const prompt = briefPrompt(wish, theme);
  const childSaid = childSaidOf(prompt);
  const asked = await askText(backend, `${SAFETY}\n\n${scrubContactDetails(prompt)}`, { timeoutMs: TEXT_TIMEOUT_MS, model: wantedModel });
  if (!asked.ok) return gentle(asked.status === null ? "model-unreachable" : `model-${asked.status}`);
  const raw = firstJsonObject(asked.text);
  if (!isRecord(raw)) return gentle("unparseable");
  const result = parseBrief(raw, { base: theme, safe: (s) => kidSafeText(s, childSaid) });
  if (!result.ok) return gentle(`refused-${result.reason.replace(/[^a-z-]/g, "").slice(0, 16)}`);

  const brief = result.brief;
  if (indoor) {
    console.log(JSON.stringify({ event: "world_look", status: "ok", kind: "indoor" }));
    return json({ ok: true, brief, art: null });
  }
  const secret = env.VOICE_SIGNING_KEY as string;
  const exp = now + TICKET_TTL_MS;
  const [farDay, farNight, mid] = await Promise.all([
    signTicket(secret, { k: "far", look: "day", s: brief.far, exp }),
    signTicket(secret, { k: "far", look: "night", s: brief.far, exp }),
    signTicket(secret, { k: "mid", s: brief.mid, exp }),
  ]);
  console.log(JSON.stringify({ event: "world_look", status: "ok", kind: "outdoor" }));
  return json({ ok: true, brief, art: { farDay, farNight, mid } });
}

// ---- POST /api/world/art ----------------------------------------------------------------------------------------------------

/** What kind of image these bytes are, from their first bytes, or null: the service answers WebP, but this does not assume it. */
export function sniffImage(bytes: Uint8Array): "image/webp" | "image/png" | "image/jpeg" | null {
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export async function handleWorldArt(request: Request, env: WorldLookEnv, ctx?: Ctx): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "expected application/json" }, 415);
  const parsed = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
  const ticket = isRecord(parsed.value) ? parsed.value.ticket : undefined;
  if (typeof ticket !== "string" || !ticket) return json({ error: "ticket is required" }, 422);

  if (!signingConfigured(env)) return json({ ok: false, status: "not-configured" }, 503);
  const now = Date.now();
  const t = await verifyTicket(env.VOICE_SIGNING_KEY as string, ticket, now);
  if (!t) return json({ error: "not signed" }, 403);

  const hosted = hostedOnly(env, "image");
  if (!hosted || !env.DB) return json({ ok: false, status: "not-configured" }, 503);                  // (no database: a ticket's retries could not be counted, so nothing is painted)
  let allowed = false;
  try { allowed = await redeemTicket(env.DB, ticket, now); } catch { allowed = false; }
  if (!allowed) return json({ ok: false, status: "ticket-used" }, 409);
  if (ctx && Math.floor(now / 1000) % 16 === 0) ctx.waitUntil(cleanup(env.DB, now).catch(() => undefined));

  const prompt = t.k === "far" ? farPrompt(t.s, t.look ?? "day") : midPrompt(t.s);                   // (only ever the ticket's own sentence)
  const kind = t.k === "far" ? `far-${t.look ?? "day"}` : "mid";
  let res: Response;
  try {
    res = await fetch(hosted.url("/images/generations"), {
      method: "POST",
      headers: { authorization: `Bearer ${hosted.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size: IMAGE_SIZE, response_format: "b64_json" }),
      signal: AbortSignal.timeout(ART_TIMEOUT_MS),
    });
  } catch {
    console.log(JSON.stringify({ event: "world_art", status: "fetch-failed", kind }));
    return json({ ok: false, status: "art-failed" }, 502);
  }
  if (!res.ok) {
    console.log(JSON.stringify({ event: "world_art", status: res.status, kind }));
    return json({ ok: false, status: "art-failed" }, 502);
  }
  let b64: unknown;
  try {
    const body = (await res.json()) as { data?: { b64_json?: unknown }[] };
    b64 = body.data?.[0]?.b64_json;
  } catch {
    return json({ ok: false, status: "art-failed" }, 502);
  }
  if (typeof b64 !== "string" || b64.length < 100 || b64.length > MAX_ART_BYTES * 1.4) return json({ ok: false, status: "art-failed" }, 502);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return json({ ok: false, status: "art-failed" }, 502);
  }
  const type = sniffImage(bytes);
  if (!type || bytes.length > MAX_ART_BYTES) return json({ ok: false, status: "art-failed" }, 502);
  console.log(JSON.stringify({ event: "world_art", status: "ok", kind, bytes: bytes.length }));
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": type, "cache-control": "no-store", "x-art-kind": kind } });
}
