// POST /api/theme-song and GET /api/theme-song?id=...: a name and a sung theme song for something a child just made.
//
//   POST {description, kind?}  kind is "build" (default: something a child made), "level" (a level a child just finished) or "prompt" (an idea from the Map's Songs sheet). The text model (Spark now, our own Glimmer after the switch in worker/modelBackend.ts flips) reads what the child made and
//                       answers with a NAME and a short song as JSON. shared/songLyrics.ts checks every field and BUILDS the lyrics, so the provider
//                       only ever gets words that passed the gate and a style text from the closed song cards. Then ONE song is ordered from Mureka
//                       (`n: 1`: billing is per song). The reply carries the name and the words at once; the song takes minutes.
//   GET  ?id=<task>     Where the song is: making, ready (with the audio link) or failed.
//   GET  ?id=<task>&audio=1   The song's audio bytes, relayed from the provider. Mureka's file host sends no CORS headers, so a page cannot decode its audio
//                       (the dance party has to, to measure the beat and cut the bars); the relay makes it same-origin. Only the provider's own host is relayed.
//
// Dan, 2026-11-03: the theme song has lyrics, the name is made when the build starts, and the text model is behind the Spark/Glimmer switch. This
// relaxes the instrumental-only rule of docs/specs/dance-party-spec.md 4.2 for THIS route only, with the gate in shared/songLyrics.ts instead.
//
// OFF BY DEFAULT. Nothing here spends money unless THEME_SONG=on and a MUREKA_API_KEY is set. When it is on it is METERED (docs/specs/dance-party-spec.md 4.6, D4 and D10):
//   - every call needs a device id (`x-device-id`); a slot is taken BEFORE any model or provider call (shared/songQuota.ts, kept in D1 by worker/songStore.ts: 5 a week per device
//     by default, the monthly budget SONG_MONTHLY_BUDGET for everyone, unset means no budget and nothing is made) and given back if anything fails before the song is ordered;
//   - a grown-up can switch songs off or lower the weekly limit for the device (POST /api/theme-song/settings, behind the parent proof);
//   - a song's status and audio are answered only to the device that made it (a numeric task id is not a secret);
//   - with an R2 bucket bound as UPLOADS (toyventor-uploads) the finished audio is copied there, so a kept song outlives the provider's 30-day link; without it the link is used, as before.
// THEME_SONG_QUOTA=off runs it UNMETERED for local probes (no D1, no device id, a per-instance cap of THEME_SONG_MAX_STARTS): never set it in production.
// The Mureka key is read here and sent only as the Authorization header to the Mureka host. It is never logged or returned.
import { isPlayerId } from "../shared/ownership";
import { readCappedJson } from "./body";
import { askText, resolveBackend } from "./modelBackend";
import { SAFETY, firstJsonObject, kidSafeText, scrubContactDetails, type MuseEnv } from "./muse";
import { INSTRUMENTS, MOODS, TEMPOS } from "../shared/songCards";
import { parseThemeReply, type ThemeSong } from "../shared/songLyrics";
import { parseLyricSections, type LyricLine } from "../shared/songKaraoke";
import { verifyParentProofFromRequest, type ParentEnv } from "./parent";
import { attachSong, commitSong, markStored, parseSongSettingsUpdate, readSongSettings, refundSong, reservationOfTask, reserveSong, statusFor, writeSongSettings, type SongDb, type SongStatus } from "./songStore";

export const THEME_SONG_CONTRACT = 1;
const MAX_BODY_BYTES = 4_000;
const MAX_DESCRIPTION = 300;
const DEFAULT_BASE = "https://api.mureka.ai";
const DEFAULT_SONG_MODEL = "mureka-9";
/** The text model gets two tries (a reply that fails the gate is common enough to ask once more) inside one budget. */
const MODEL_BUDGET_MS = 28_000;
const ATTEMPTS = 2;
const MUREKA_TIMEOUT_MS = 15_000;
const START_WINDOW_MS = 10 * 60_000;
const STARTS_PER_WINDOW = 3;
const POLL_WINDOW_MS = 60_000;
const POLLS_PER_WINDOW = 40;
const DEFAULT_MAX_STARTS = 25;
/** A theme song is about 1.6 MB; nothing near this is a song of ours. */
const MAX_AUDIO_BYTES = 8_000_000;
const AUDIO_TIMEOUT_MS = 20_000;
/** Waking our own model: at most one ping a Worker instance every 4 minutes (best effort: instances multiply), however many children open the Songs sheet. */
const WARM_EVERY_MS = 4 * 60_000;
const WARM_TIMEOUT_MS = 28_000; // a Worker keeps a background task for about 30 s after it has answered
let lastWarmPing = -Infinity;
const startHits = new Map<string, number[]>();
const pollHits = new Map<string, number[]>();
let startsThisInstance = 0;

/** The bit of an R2 bucket this route uses. */
export interface R2Like {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface ThemeSongEnv extends MuseEnv, ParentEnv {
  MUREKA_API_KEY?: string;
  /** "on" to let this route spend money. Anything else, or unset, is off. */
  THEME_SONG?: string;
  /** Mureka model id (default mureka-9, the one the starter library was made with). */
  MUREKA_SONG_MODEL?: string;
  /** Mureka base URL (default https://api.mureka.ai); a test points it elsewhere. */
  MUREKA_API_URL?: string;
  /** Songs this Worker instance may order before it refuses (default 25). */
  THEME_SONG_MAX_STARTS?: string;
  /** An exact file host to relay and link besides *.mureka.ai (a test uses its own). */
  MUREKA_AUDIO_HOST?: string;
  /** Songs a month across every device (a whole number). Unset or not a number: no budget, so no song is made. */
  SONG_MONTHLY_BUDGET?: string;
  /** "off" runs the route unmetered (local probes only). Anything else, or unset, is metered and needs the D1 binding (`DB`). */
  THEME_SONG_QUOTA?: string;
  /** An R2 bucket for finished songs. Optional: without it the provider's 30-day link is all there is. */
  UPLOADS?: R2Like;
}

const SONG_KEY = /^[A-Za-z0-9_-]{8,64}$/;
export const isMetered = (env: ThemeSongEnv): boolean => (env.THEME_SONG_QUOTA ?? "").trim().toLowerCase() !== "off";
const db = (env: ThemeSongEnv): SongDb => env.DB as unknown as SongDb;
const r2Key = (deviceId: string, task: string) => `songs/${deviceId}/${task}.mp3`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const squish = (t: string) => t.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

function limited(hits: Map<string, number[]>, ip: string | null | undefined, windowMs: number, max: number, now: number): boolean {
  if (!ip) return false;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}
/** Test hook: forget every counter. */
export function resetThemeSongLimits(): void {
  startHits.clear();
  pollHits.clear();
  startsThisInstance = 0;
  lastWarmPing = -Infinity;
}

export function themeSongEnabled(env: ThemeSongEnv): boolean {
  if ((env.THEME_SONG ?? "").trim().toLowerCase() !== "on" || !env.MUREKA_API_KEY?.trim() || resolveBackend(env, "text").mode === "off") return false;
  return !isMetered(env) || Boolean(env.DB); // metered means the quota has somewhere to live: no D1, no songs (fails closed)
}

/**
 * What the song is about: something a child BUILT (Describe & build), a level a child just FINISHED (the end-of-level card in the game), or an IDEA the child typed or
 * tapped in the Map's Songs sheet ("prompt": the only kind that carries the child's own words, so it is screened before any model sees it).
 */
export type ThemeKind = "build" | "level" | "prompt";

const KIND_WORDS: Record<ThemeKind, { intro: string; noun: string; about: string; said: string }> = {
  build: {
    intro: "A child just made something, and you will name it and write its theme song for a small child to sing along to. The child may write in any language; write the name and the song in simple English.",
    noun: "creation",
    about: "The song is ABOUT the creation: the verse says what it is and what it does or looks like, in your own simple words (wheels, stomping, flying, a hat); do not let it drift into a generic happy song. ",
    said: "made",
  },
  level: {
    intro: "A child just finished a level in a toy game, and you will name that adventure and write its theme song for a small child to sing along to. The child may write in any language; write the name and the song in simple English.",
    noun: "adventure",
    about: "The song is ABOUT the adventure: the verse says what the child did and how it felt (building, fixing, cleaning up, solving), in your own simple words; do not let it drift into a generic happy song. ",
    said: "finished",
  },
  prompt: {
    intro: "A child asked for a song about an idea, and you will name the song and write it for a small child to sing along to. The child may write in any language; write the name and the song in simple English.",
    noun: "song",
    about: "The song is ABOUT the idea: the verse paints it in your own simple words and keeps it gentle and happy, whatever the idea is; do not let it drift into a generic happy song. When the idea lists things the child picked (favourite colours, a fruit, an animal, what a toy is wearing), sing about as many of them as fit, by their plain names, one or two to a line. ",
    said: "asked for a song about",
  },
};

export function themePrompt(description: string, kind: ThemeKind = "build"): string {
  const k = KIND_WORDS[kind] ?? KIND_WORDS.build;
  return [
    SAFETY,
    k.intro,
    `Reply with JSON only: {"name": "<the ${k.noun}'s name>", "mood": "<one of: ${MOODS.join(", ")}>", "tempo": "<one of: ${TEMPOS.join(", ")}>", "instruments": ["<up to two of: ${INSTRUMENTS.join(", ")}>"], "verse": ["<line>", "<line>", "<line>", "<line>"], "chorus": ["<line>", "<line>", "<line>", "<line>"]}`,
    `Rules. The name: two to four words, playful, letters only, no numbers. Every line: three to seven words, simple and joyful, rhyme if you can, letters and basic punctuation only, no numbers. ` +
      "No names of real people, places, brands, characters, or songs. No capital letters except the first letter of a line and the name. " +
      k.about +
      "The chorus must sing the name in at least one line, spelled exactly as in \"name\". Do not copy the child's words in a row. Nothing scary, sad, or rude.",
    `The child ${k.said}: "${scrubContactDetails(description).replace(/"/g, "'")}"`,
  ].join("\n");
}

/** Ask the text model for a name and a song until one passes the gate (twice at most). */
/** Exported for the eval (scripts/eval-theme-song.ts): the same call the route makes, with the number of model calls it took. */
export async function writeSong(env: ThemeSongEnv, description: string, kind: ThemeKind): Promise<{ ok: true; song: ThemeSong; mode: string; attempts: number } | { ok: false; status: number; error: string; reason?: string; attempts: number }> {
  const backend = resolveBackend(env, "text");
  if (backend.mode === "off") return { ok: false, status: 503, error: "the song writer is not configured", attempts: 0 };
  const childSaid = squish(description);
  const startedAt = Date.now();
  let lastReason = "unparseable";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const left = MODEL_BUDGET_MS - (Date.now() - startedAt);
    if (left < 3_000) break;
    const asked = await askText(backend, themePrompt(description, kind), { timeoutMs: left });
    if (!asked.ok) {
      console.log(JSON.stringify({ event: "theme-song", step: "text", status: asked.status === null ? "fetch-failed" : asked.status, backend: backend.mode }));
      return { ok: false, status: 502, error: asked.status === null ? "the song writer did not answer" : `the song writer returned ${asked.status}`, attempts: attempt + 1 };
    }
    const reply = firstJsonObject(asked.text);
    if (!isRecord(reply)) { lastReason = "unparseable"; continue; }
    const checked = parseThemeReply(reply, { childSaid, extraSafe: (t) => kidSafeText(t) });
    if (checked.ok) return { ok: true, song: checked.song, mode: backend.mode, attempts: attempt + 1 };
    lastReason = checked.reason;
  }
  console.log(JSON.stringify({ event: "theme-song", step: "gate", reason: lastReason, backend: backend.mode }));
  return { ok: false, status: 502, error: "no song this time", reason: lastReason, attempts: ATTEMPTS };
}

async function mureka(env: ThemeSongEnv, method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; status: number | null }> {
  const base = (env.MUREKA_API_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${env.MUREKA_API_KEY!.trim()}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(MUREKA_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as unknown };
  } catch {
    return { ok: false, status: null };
  }
}

const budgetOf = (env: ThemeSongEnv): number | undefined => {
  const raw = env.SONG_MONTHLY_BUDGET?.trim();
  return raw ? Number(raw) : undefined; // not a whole number: the store reads it as no budget
};
const timezoneOf = (request: Request): string => (request.headers.get("x-client-timezone") ?? "UTC").slice(0, 64);

type Quota = Pick<SongStatus, "limit" | "used" | "left" | "resetsOn" | "makerOn">;
const quotaOf = (s: SongStatus): Quota => ({ limit: s.limit, used: s.used, left: s.left, resetsOn: s.resetsOn, makerOn: s.makerOn });

/** The reply for a slot the quota would not give, in words a child can be told. */
function denial(reason: string, quota: Quota | null): Response {
  switch (reason) {
    case "week_used": return json({ error: "No new songs until tomorrow. Dance to the ones you made!", reason, ...(quota ? { quota } : {}) }, 429);
    case "not_enabled": return json({ error: "Songs are switched off by a grown-up.", reason: "songs_off", ...(quota ? { quota } : {}) }, 403);
    case "budget_spent": return json({ error: "The song studio is resting this month.", reason }, 429);
    case "key_in_use": return json({ error: "That song belongs to someone else.", reason }, 409);
    default: return json({ error: "Something was not right with that request.", reason: "bad_request" }, 400);
  }
}

async function handleStart(request: Request, env: ThemeSongEnv): Promise<Response> {
  if (limited(startHits, request.headers.get("CF-Connecting-IP"), START_WINDOW_MS, STARTS_PER_WINDOW, Date.now())) return json({ error: "One song at a time. Try again in a few minutes." }, 429);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "expected application/json" }, 415);
  const metered = isMetered(env);
  const deviceHeader = request.headers.get("x-device-id");
  if (metered && !isPlayerId(deviceHeader)) return json({ error: "A device id is needed.", reason: "device_required" }, 401);
  const deviceId = metered ? (deviceHeader as string) : null;
  const parsed = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
  const description = isRecord(parsed.value) && typeof parsed.value.description === "string" ? parsed.value.description.replace(/\s+/g, " ").trim() : "";
  if (!description) return json({ error: "description is required" }, 422);
  if (description.length > MAX_DESCRIPTION) return json({ error: `description over ${MAX_DESCRIPTION} characters` }, 413);

  // the unmetered probe path keeps a per-instance cap; metered runs have the real quota and only use the cap if one is set on purpose
  const capSet = Number(env.THEME_SONG_MAX_STARTS);
  const cap = metered ? (capSet > 0 ? capSet : Infinity) : capSet > 0 ? capSet : DEFAULT_MAX_STARTS;
  if (startsThisInstance >= cap) return json({ error: "The song studio is full for now." }, 429);

  const wanted = parsed.value ? (parsed.value as { kind?: unknown }).kind : undefined;
  const kind: ThemeKind = wanted === "level" ? "level" : wanted === "prompt" ? "prompt" : "build";
  // A child's own words reach the model for a "prompt" song (the Songs sheet) and for a "build" song (what they typed in Describe & build); only the "level" sentence is ours. So those two are
  // screened first: contact details, links and unsafe words are turned away kindly and nothing is spent.
  if (kind !== "level" && !kidSafeText(description)) return json({ error: "Let's pick a different idea!", reason: "idea_not_allowed" }, 422);

  // take a slot BEFORE any model or provider call
  const rawKey = isRecord(parsed.value) ? parsed.value.key : undefined;
  const key = typeof rawKey === "string" && SONG_KEY.test(rawKey) ? rawKey : crypto.randomUUID();
  const nowMs = Date.now();
  let slotHeld = false;
  const giveBack = async (reason: "rejected_before_call" | "provider_failed") => {
    if (!metered || !slotHeld) return;
    slotHeld = false;
    try { await refundSong(db(env), key, reason, Date.now()); } catch { /* the slot expires by itself */ }
  };
  const quotaNow = async (): Promise<Quota | null> => {
    if (!metered) return null;
    try { return quotaOf(await statusFor(db(env), deviceId!, Date.now(), timezoneOf(request))); } catch { return null; }
  };
  if (metered) {
    let r;
    try { r = await reserveSong(db(env), { key, deviceId: deviceId!, nowMs }, { monthlyBudget: budgetOf(env), timezone: timezoneOf(request) }); }
    catch { return json({ error: "The song studio could not check your songs.", reason: "quota_unavailable" }, 503); }
    if (!r.ok) return denial(r.reason, await quotaNow());
    if (r.replay) {
      // the same tap again: the song already made for it, and nothing spent
      if (r.payload) { try { return json({ ...(JSON.parse(r.payload) as object), replay: true, quota: await quotaNow() }); } catch { /* fall through */ } }
      return json({ error: "That song is still being written.", reason: "in_progress" }, 409);
    }
    slotHeld = true;
  }

  let ordered = false;
  try {
    const written = await writeSong(env, description, kind);
    if (!written.ok) {
      await giveBack("rejected_before_call");
      return json({ error: written.error, ...(written.reason ? { reason: written.reason } : {}) }, written.status);
    }
    const { song } = written;

    // the paid call: after the gate, one song, the words we built and the fixed style text
    startsThisInstance++;
    const res = await mureka(env, "POST", "/v1/song/generate", { lyrics: song.lyrics, model: env.MUREKA_SONG_MODEL?.trim() || DEFAULT_SONG_MODEL, n: 1, prompt: song.prompt });
    const task = res.ok && isRecord(res.data) && (typeof res.data.id === "string" || typeof res.data.id === "number") ? String(res.data.id) : null;
    if (!task) { startsThisInstance--; await giveBack("provider_failed"); } // nothing was ordered, so nothing is spent
    else ordered = true;
    console.log(JSON.stringify({ event: "theme-song", step: "ordered", ok: task !== null, upstream: res.ok ? "ok" : (res as { status: number | null }).status, backend: written.mode, kind, mood: song.request.mood, tempo: song.request.tempo, metered }));
    const payload = {
      contract: THEME_SONG_CONTRACT,
      name: song.name,
      verse: song.verse,
      chorus: song.chorus,
      mood: song.request.mood,
      tempo: song.request.tempo,
      instruments: song.request.instruments,
      ai: true,
      task,
    };
    if (metered && task) await attachSong(db(env), key, task, JSON.stringify(payload));
    return json({
      ...payload,
      key,
      // the name and the words are good even when the song could not be ordered: the client shows them and says no song came
      ...(task === null ? { songError: "The song studio could not start this one." } : {}),
      ...(metered ? { quota: await quotaNow() } : {}),
    });
  } catch (err) {
    console.log(JSON.stringify({ event: "theme-song", step: "error", ordered, message: String(err instanceof Error ? err.message : err).slice(0, 120) }));
    if (!ordered) await giveBack("provider_failed"); // once ordered the money may be spent: the slot is left to expire and keeps counting against the budget
    return json({ error: "The song studio hiccuped. Try again in a moment." }, 502);
  }
}

/** Only an https link on the provider's own file host is ever passed to a page or fetched by the Worker. */
export function audioUrlOk(value: unknown, env: ThemeSongEnv): value is string {
  if (typeof value !== "string") return false;
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const extra = env.MUREKA_AUDIO_HOST?.trim().toLowerCase();
  return host === "mureka.ai" || host.endsWith(".mureka.ai") || (Boolean(extra) && host === extra);
}

/** The finished song's provider link, or the reason there is none. */
async function finishedLink(env: ThemeSongEnv, id: string): Promise<{ ok: true; url: string; durationMs: number | null; lines: LyricLine[] } | { ok: false; status: "making" | "failed" | "error"; code?: number | null }> {
  const got = await mureka(env, "GET", `/v1/song/query/${id}`);
  if (!got.ok) return { ok: false, status: "error", code: got.status };
  const task = isRecord(got.data) ? got.data : {};
  const status = typeof task.status === "string" ? task.status : "";
  if (status === "succeeded") {
    const choice = Array.isArray(task.choices) && isRecord(task.choices[0]) ? task.choices[0] : null;
    if (!choice || !audioUrlOk(choice.url, env)) return { ok: false, status: "failed" };
    // the provider times every line it sings: kept (compact) so the game can light up the line being sung; none is fine, the card then shows the words without a karaoke
    return { ok: true, url: choice.url, durationMs: typeof choice.duration === "number" ? choice.duration : null, lines: parseLyricSections(choice.lyrics_sections) };
  }
  if (status === "failed" || status === "timeouted" || status === "cancelled") return { ok: false, status: "failed" };
  return { ok: false, status: "making" };
}

/** Fetch the song's bytes from the provider's link, checked for size. */
async function fetchAudio(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return bytes.byteLength < 1 || bytes.byteLength > MAX_AUDIO_BYTES ? null : bytes;
  } catch { return null; }
}

/** Metered only: who may see this task. A task that is not this device's looks like a task that does not exist. */
async function ownerCheck(request: Request, env: ThemeSongEnv, id: string): Promise<{ deviceId: string; key: string; state: string; stored: boolean } | Response> {
  const deviceId = request.headers.get("x-device-id");
  if (!isPlayerId(deviceId)) return json({ error: "A device id is needed.", reason: "device_required" }, 401);
  let owner;
  try { owner = await reservationOfTask(db(env), id); } catch { return json({ error: "The song studio could not check your songs." }, 503); }
  if (!owner || owner.deviceId !== deviceId) return json({ status: "unknown" }, 404);
  return { deviceId, key: owner.key, state: owner.state, stored: owner.stored };
}

async function handleAudio(request: Request, env: ThemeSongEnv, id: string): Promise<Response> {
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (!/^\d{6,24}$/.test(id)) return json({ error: "not a song id" }, 400);
  const bytesResponse = (bytes: ArrayBuffer) => new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(bytes.byteLength), "cache-control": "private, max-age=3600" } });
  let owner: { deviceId: string; key: string; state: string; stored: boolean } | null = null;
  if (isMetered(env)) {
    const o = await ownerCheck(request, env, id);
    if (o instanceof Response) return o;
    owner = o;
    // our own copy first: it outlives the provider's 30-day link
    if (env.UPLOADS && owner.stored) {
      try { const obj = await env.UPLOADS.get(r2Key(owner.deviceId, id)); if (obj) return bytesResponse(await obj.arrayBuffer()); } catch { /* fall back to the provider */ }
    }
  }
  const link = await finishedLink(env, id);
  if (!link.ok) return json(link.status === "error" ? { error: link.code === null ? "the song studio did not answer" : `the song studio returned ${link.code}` } : { status: link.status }, link.status === "error" ? 502 : 404);
  const bytes = await fetchAudio(link.url);
  if (!bytes) return json({ error: "the song file did not arrive" }, 502);
  if (owner && env.UPLOADS && !owner.stored) await keepCopy(env, owner, id, bytes);
  return bytesResponse(bytes);
}

/** Copy a finished song into our own bucket (when there is one) and remember that it is there. Never throws: the song still plays from the provider's link. */
async function keepCopy(env: ThemeSongEnv, owner: { deviceId: string; key: string }, task: string, bytes: ArrayBuffer): Promise<void> {
  if (!env.UPLOADS) return;
  try {
    await env.UPLOADS.put(r2Key(owner.deviceId, task), bytes, { httpMetadata: { contentType: "audio/mpeg" } });
    await markStored(db(env), owner.key);
  } catch (err) {
    console.log(JSON.stringify({ event: "theme-song", step: "r2", ok: false, message: String(err instanceof Error ? err.message : err).slice(0, 100) }));
  }
}

async function handleStatus(request: Request, env: ThemeSongEnv, id: string): Promise<Response> {
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (!/^\d{6,24}$/.test(id)) return json({ error: "not a song id" }, 400);
  let owner: { deviceId: string; key: string; state: string; stored: boolean } | null = null;
  if (isMetered(env)) {
    const o = await ownerCheck(request, env, id);
    if (o instanceof Response) return o;
    owner = o;
  }
  const link = await finishedLink(env, id);
  if (link.ok) {
    if (owner) {
      try { if (owner.state === "reserved") await commitSong(db(env), owner.key, Date.now()); } catch { /* committed on the next look */ }
      if (env.UPLOADS && !owner.stored) { const bytes = await fetchAudio(link.url); if (bytes) await keepCopy(env, owner, id, bytes); }
    }
    return json({ status: "ready", url: link.url, durationMs: link.durationMs, ...(link.lines.length ? { lines: link.lines } : {}) });
  }
  if (link.status === "error") return json({ error: link.code === null ? "the song studio did not answer" : `the song studio returned ${link.code}` }, 502);
  if (link.status === "failed" && owner && owner.state === "reserved") { try { await refundSong(db(env), owner.key, "provider_failed", Date.now()); } catch { /* it expires by itself */ } } // the provider could not sing it: the child's slot comes back
  return json({ status: link.status });
}

/**
 * POST /api/theme-song/warm: a child opened the Songs sheet (or a build began), so a song is likely coming. When the text model is OUR OWN (a Modal container that scales to zero) this
 * pings its /health so the container is awake by the time the words are asked for, instead of the first song after idle waiting out a cold start. With the hosted model there is nothing to
 * wake. It always answers 202 and says nothing about the model: no address, no key, no state. Same shape and rate as the Forge's warm-up (worker/forgeMake.ts handleForgeWarm).
 */
async function handleWarm(request: Request, env: ThemeSongEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (isMetered(env) && !isPlayerId(request.headers.get("x-device-id"))) return json({ error: "A device id is needed.", reason: "device_required" }, 401);
  const accepted = () => json({ ok: true, status: "accepted" }, 202);
  const backend = resolveBackend(env, "text");
  if (backend.mode !== "self" || !backend.baseUrl) return accepted();
  const now = Date.now();
  if (now - lastWarmPing < WARM_EVERY_MS) return accepted();
  let health: string;
  try { health = `${new URL(backend.baseUrl).origin}/health`; } catch { return accepted(); }
  lastWarmPing = now;
  const started = Date.now();
  const ping = fetch(health, { method: "GET", signal: AbortSignal.timeout(WARM_TIMEOUT_MS) }).then(
    (r) => console.log(JSON.stringify({ event: "theme-song", step: "warm", status: "up", httpStatus: r.status, ms: Date.now() - started })),
    () => console.log(JSON.stringify({ event: "theme-song", step: "warm", status: "no_answer", ms: Date.now() - started })),
  );
  if (ctx) ctx.waitUntil(ping);
  return accepted();
}

/** /api/theme-song/settings: a grown-up's choices for this device. Reading is open (the child's own screen needs to know); changing needs the parent proof. */
async function handleSettings(request: Request, env: ThemeSongEnv): Promise<Response> {
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (!isMetered(env) || !env.DB) return json({ error: "Songs are not metered here, so there is nothing to set." }, 501);
  const deviceId = request.headers.get("x-device-id");
  if (!isPlayerId(deviceId)) return json({ error: "A device id is needed.", reason: "device_required" }, 401);
  try {
    if (request.method === "GET") {
      const s = await statusFor(db(env), deviceId, Date.now(), timezoneOf(request));
      return json({ settings: { makerOn: s.makerOn, limit: await readSongSettings(db(env), deviceId).then((x) => x.limit) }, quota: quotaOf(s) });
    }
    if (request.method !== "POST" && request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    if (!(await verifyParentProofFromRequest(request, env))) return json({ status: "gate-required", error: "A grown-up has to unlock this first." }, 401);
    const parsed = await readCappedJson(request, 2_000);
    if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
    const update = parseSongSettingsUpdate(parsed.value);
    if (!update.ok) return json({ error: update.error }, 422);
    const settings = await writeSongSettings(db(env), deviceId, update);
    return json({ settings, quota: quotaOf(await statusFor(db(env), deviceId, Date.now(), timezoneOf(request))) });
  } catch {
    return json({ error: "The song settings could not be reached." }, 503);
  }
}

export async function handleThemeSong(request: Request, env: ThemeSongEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const url = new URL(request.url);
  const sub = url.pathname.replace(/^\/api\/theme-song/, "");
  if (sub === "/settings") return handleSettings(request, env);
  if (sub === "/warm") return themeSongEnabled(env) ? handleWarm(request, env, ctx) : json({ error: "theme songs are off" }, 503);
  if (sub !== "" && sub !== "/") return json({ error: "not found" }, 404);
  if (request.method === "GET" && !url.searchParams.has("id")) {
    // a free probe: is the route on, and (with a device id) how many songs this device has left this week
    const enabled = themeSongEnabled(env);
    let quota: Quota | undefined;
    const device = request.headers.get("x-device-id");
    if (enabled && isMetered(env) && isPlayerId(device)) {
      try { quota = quotaOf(await statusFor(db(env), device, Date.now(), timezoneOf(request))); } catch { /* the probe still says the route is on */ }
    }
    return json({ ok: true, route: "theme-song", contract: THEME_SONG_CONTRACT, enabled, ...(quota ? { quota } : {}) });
  }
  if (!themeSongEnabled(env)) return json({ error: "theme songs are off" }, 503);
  if (request.method === "GET") return url.searchParams.get("audio") === "1" ? handleAudio(request, env, url.searchParams.get("id") ?? "") : handleStatus(request, env, url.searchParams.get("id") ?? "");
  if (request.method === "POST") return handleStart(request, env);
  return json({ error: "method not allowed" }, 405);
}
