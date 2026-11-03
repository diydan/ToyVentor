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
// OFF BY DEFAULT. Nothing here spends money unless THEME_SONG=on and a MUREKA_API_KEY is set. This is the PLAY TEST slice, not the finished quota:
//   - the per-device weekly limit and the monthly budget (shared/songQuota.ts, to be kept in D1) are NOT wired;
//   - instead: a per-IP limit, and a cap on songs ordered per Worker instance (THEME_SONG_MAX_STARTS, default 25), best effort like the other routes;
//   - the audio link is Mureka's own (valid 30 days). Copying the bytes into our own storage needs an R2 bucket, which does not exist yet.
// The Mureka key is read here and sent only as the Authorization header to the Mureka host. It is never logged or returned.
import { readCappedJson } from "./body";
import { askText, resolveBackend } from "./modelBackend";
import { SAFETY, firstJsonObject, kidSafeText, scrubContactDetails, type MuseEnv } from "./muse";
import { INSTRUMENTS, MOODS, TEMPOS } from "../shared/songCards";
import { parseThemeReply, type ThemeSong } from "../shared/songLyrics";

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
const startHits = new Map<string, number[]>();
const pollHits = new Map<string, number[]>();
let startsThisInstance = 0;

export interface ThemeSongEnv extends MuseEnv {
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
}

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
}

export function themeSongEnabled(env: ThemeSongEnv): boolean {
  return (env.THEME_SONG ?? "").trim().toLowerCase() === "on" && Boolean(env.MUREKA_API_KEY?.trim()) && resolveBackend(env, "text").mode !== "off";
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
    about: "The song is ABOUT the idea: the verse paints it in your own simple words and keeps it gentle and happy, whatever the idea is; do not let it drift into a generic happy song. ",
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
async function writeSong(env: ThemeSongEnv, description: string, kind: ThemeKind): Promise<{ ok: true; song: ThemeSong; mode: string } | { ok: false; status: number; error: string; reason?: string }> {
  const backend = resolveBackend(env, "text");
  if (backend.mode === "off") return { ok: false, status: 503, error: "the song writer is not configured" };
  const childSaid = squish(description);
  const startedAt = Date.now();
  let lastReason = "unparseable";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const left = MODEL_BUDGET_MS - (Date.now() - startedAt);
    if (left < 3_000) break;
    const asked = await askText(backend, themePrompt(description, kind), { timeoutMs: left });
    if (!asked.ok) {
      console.log(JSON.stringify({ event: "theme-song", step: "text", status: asked.status === null ? "fetch-failed" : asked.status, backend: backend.mode }));
      return { ok: false, status: 502, error: asked.status === null ? "the song writer did not answer" : `the song writer returned ${asked.status}` };
    }
    const reply = firstJsonObject(asked.text);
    if (!isRecord(reply)) { lastReason = "unparseable"; continue; }
    const checked = parseThemeReply(reply, { childSaid, extraSafe: (t) => kidSafeText(t) });
    if (checked.ok) return { ok: true, song: checked.song, mode: backend.mode };
    lastReason = checked.reason;
  }
  console.log(JSON.stringify({ event: "theme-song", step: "gate", reason: lastReason, backend: backend.mode }));
  return { ok: false, status: 502, error: "no song this time", reason: lastReason };
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

async function handleStart(request: Request, env: ThemeSongEnv): Promise<Response> {
  if (limited(startHits, request.headers.get("CF-Connecting-IP"), START_WINDOW_MS, STARTS_PER_WINDOW, Date.now())) return json({ error: "One song at a time. Try again in a few minutes." }, 429);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "expected application/json" }, 415);
  const parsed = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
  const description = isRecord(parsed.value) && typeof parsed.value.description === "string" ? parsed.value.description.replace(/\s+/g, " ").trim() : "";
  if (!description) return json({ error: "description is required" }, 422);
  if (description.length > MAX_DESCRIPTION) return json({ error: `description over ${MAX_DESCRIPTION} characters` }, 413);

  const cap = Number(env.THEME_SONG_MAX_STARTS) || DEFAULT_MAX_STARTS;
  if (startsThisInstance >= cap) return json({ error: "The song studio is full for now." }, 429);

  const wanted = parsed.value ? (parsed.value as { kind?: unknown }).kind : undefined;
  const kind: ThemeKind = wanted === "level" ? "level" : wanted === "prompt" ? "prompt" : "build";
  // A child's own words reach the model only for a "prompt" song, so they are screened first: contact details, links and unsafe words are turned away kindly and nothing is spent.
  if (kind === "prompt" && !kidSafeText(description)) return json({ error: "Let's pick a different idea!", reason: "idea_not_allowed" }, 422);
  const written = await writeSong(env, description, kind);
  if (!written.ok) return json({ error: written.error, ...(written.reason ? { reason: written.reason } : {}) }, written.status);
  const { song } = written;

  // the paid call: after the gate, one song, the words we built and the fixed style text
  startsThisInstance++;
  const ordered = await mureka(env, "POST", "/v1/song/generate", { lyrics: song.lyrics, model: env.MUREKA_SONG_MODEL?.trim() || DEFAULT_SONG_MODEL, n: 1, prompt: song.prompt });
  const task = ordered.ok && isRecord(ordered.data) && (typeof ordered.data.id === "string" || typeof ordered.data.id === "number") ? String(ordered.data.id) : null;
  if (!task) startsThisInstance--; // nothing was ordered, so nothing is spent
  console.log(JSON.stringify({ event: "theme-song", step: "ordered", ok: task !== null, upstream: ordered.ok ? "ok" : (ordered as { status: number | null }).status, backend: written.mode, mood: song.request.mood, tempo: song.request.tempo }));
  return json({
    contract: THEME_SONG_CONTRACT,
    name: song.name,
    verse: song.verse,
    chorus: song.chorus,
    mood: song.request.mood,
    tempo: song.request.tempo,
    instruments: song.request.instruments,
    ai: true,
    task,
    // the name and the words are good even when the song could not be ordered: the client shows them and says no song came
    ...(task === null ? { songError: "The song studio could not start this one." } : {}),
  });
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
async function finishedLink(env: ThemeSongEnv, id: string): Promise<{ ok: true; url: string; durationMs: number | null } | { ok: false; status: "making" | "failed" | "error"; code?: number | null }> {
  const got = await mureka(env, "GET", `/v1/song/query/${id}`);
  if (!got.ok) return { ok: false, status: "error", code: got.status };
  const task = isRecord(got.data) ? got.data : {};
  const status = typeof task.status === "string" ? task.status : "";
  if (status === "succeeded") {
    const choice = Array.isArray(task.choices) && isRecord(task.choices[0]) ? task.choices[0] : null;
    if (!choice || !audioUrlOk(choice.url, env)) return { ok: false, status: "failed" };
    return { ok: true, url: choice.url, durationMs: typeof choice.duration === "number" ? choice.duration : null };
  }
  if (status === "failed" || status === "timeouted" || status === "cancelled") return { ok: false, status: "failed" };
  return { ok: false, status: "making" };
}

async function handleAudio(request: Request, env: ThemeSongEnv, id: string): Promise<Response> {
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (!/^\d{6,24}$/.test(id)) return json({ error: "not a song id" }, 400);
  const link = await finishedLink(env, id);
  if (!link.ok) return json(link.status === "error" ? { error: link.code === null ? "the song studio did not answer" : `the song studio returned ${link.code}` } : { status: link.status }, link.status === "error" ? 502 : 404);
  try {
    const res = await fetch(link.url, { signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS) });
    if (!res.ok) return json({ error: `the song file returned ${res.status}` }, 502);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_AUDIO_BYTES) return json({ error: "the song file is not the size of a song" }, 502);
    return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(bytes.byteLength), "cache-control": "private, max-age=3600" } });
  } catch {
    return json({ error: "the song file did not arrive" }, 502);
  }
}

async function handleStatus(request: Request, env: ThemeSongEnv, id: string): Promise<Response> {
  if (limited(pollHits, request.headers.get("CF-Connecting-IP"), POLL_WINDOW_MS, POLLS_PER_WINDOW, Date.now())) return json({ error: "Slow down." }, 429);
  if (!/^\d{6,24}$/.test(id)) return json({ error: "not a song id" }, 400);
  const link = await finishedLink(env, id);
  if (link.ok) return json({ status: "ready", url: link.url, durationMs: link.durationMs });
  if (link.status === "error") return json({ error: link.code === null ? "the song studio did not answer" : `the song studio returned ${link.code}` }, 502);
  return json({ status: link.status });
}

export async function handleThemeSong(request: Request, env: ThemeSongEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && !url.searchParams.has("id")) {
    return json({ ok: true, route: "theme-song", contract: THEME_SONG_CONTRACT, enabled: themeSongEnabled(env) });
  }
  if (!themeSongEnabled(env)) return json({ error: "theme songs are off" }, 503);
  if (request.method === "GET") return url.searchParams.get("audio") === "1" ? handleAudio(request, env, url.searchParams.get("id") ?? "") : handleStatus(request, env, url.searchParams.get("id") ?? "");
  if (request.method === "POST") return handleStart(request, env);
  return json({ error: "method not allowed" }, 405);
}
