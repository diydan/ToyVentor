// Making a world's look LIVE (docs/specs/generated-worlds-spec.md section 0): the wish goes to the Worker (`POST /api/world/look`: Muse Spark's validated brief and three signed art tickets), the three pictures
// come back from `POST /api/world/art` in parallel, each is decoded, checked and (the mid strip) cut out of its black surround on the device (runtime/lookArt.ts), stored in IndexedDB under the look's id and
// registered as the world's backdrop. EVERYTHING the world touches is injected (fetch, decode, encode, the store, the clock), so every path is tested with fakes; the browser wiring is lookArtBrowser.ts.
//
// The failure ladder is the spec's: a layer that fails or fails its gate is tried once more (a ticket paints twice at most, and the retry is a different picture: the service has no seed), then LEFT OUT; a look
// with a layer missing falls back to its base theme's own art for that time of day (`backdropFor`), and a look that could not be made at all leaves the world exactly as Create made it. The world is always playable.
import { BASES, buildLook, newLookId, type Base, type LookTime, type WorldBrief, type WorldLook } from "../../../../../shared/worldBrief";
import { MAX_FAR_WIDTH, MAX_MID_WIDTH, gateFar, gateMid, keyMid, type Rgba } from "./lookArt";
import { generatedBackdrops, isBackdropRegistered, registerBackdrop, unregisterBackdrop } from "./backdrop";
import { putWithLimit, type LookArtRecord, type LookStore } from "./lookStore";
import { registerWishArtForLook } from "./wishWorlds";

export type LookStage = "thinking" | "painting" | "checking";
export type LookFailure = "gentle" | "daily-limit" | "slow-down" | "not-configured" | "offline" | "failed";
export interface LookArt { farDay?: Blob; farNight?: Blob; mid?: Blob }
export type MakeLookResult = { ok: true; look: WorldLook; art: LookArt } | { ok: false; status: LookFailure };

export interface MakeLookDeps {
  fetchImpl: typeof fetch;
  /** The Worker's world routes (default "/api/world"). */
  base?: string;
  decode(blob: Blob, maxWidth: number): Promise<Rgba>;
  encode(image: Rgba, type?: string): Promise<Blob>;
  store: LookStore;
  now?: () => number;
  newId?: () => string;
  onStage?: (stage: LookStage) => void;
  signal?: AbortSignal;
  /** Pause between a failed picture and its retry (a test passes 0). */
  retryPauseMs?: number;
}

/** A ticket paints twice at most (the Worker counts it): one try and one retry, however the retry is spent. */
const PAINTS_PER_TICKET = 2;

interface Ticketed { farDay: string; farNight: string; mid: string }

/** The look the Worker made, or why not. Nothing is thrown: a network error is "offline", anything unexpected "failed". */
async function askForLook(wish: string, theme: Base, d: MakeLookDeps): Promise<{ ok: true; brief: WorldBrief; art: Ticketed | null } | { ok: false; status: LookFailure }> {
  let res: Response;
  try {
    res = await d.fetchImpl(`${d.base ?? "/api/world"}/look`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wish, theme }), signal: d.signal });
  } catch { return { ok: false, status: d.signal?.aborted ? "failed" : "offline" }; }
  type LookBody = { ok?: unknown; status?: unknown; brief?: unknown; art?: unknown };
  let body = null as LookBody | null;
  try { body = (await res.json()) as LookBody; } catch { /* not JSON */ }
  if (res.status === 429) return { ok: false, status: body?.status === "slow-down" ? "slow-down" : "daily-limit" };
  if (res.status === 503) return { ok: false, status: "not-configured" };
  if (res.status === 404) return { ok: false, status: "not-configured" };                                   // (an older Worker without these routes)
  if (!res.ok || !body) return { ok: false, status: "failed" };
  if (body.ok !== true) return { ok: false, status: body.status === "not-configured" ? "not-configured" : "gentle" };
  const brief = body.brief as WorldBrief | undefined;
  if (!brief || typeof brief.name !== "string") return { ok: false, status: "failed" };
  if (brief.kind === "indoor") return { ok: true, brief, art: null };
  const a = body.art as Partial<Ticketed> | null;
  if (!a || typeof a.farDay !== "string" || typeof a.farNight !== "string" || typeof a.mid !== "string") return { ok: false, status: "failed" };
  return { ok: true, brief, art: { farDay: a.farDay, farNight: a.farNight, mid: a.mid } };
}

/** One picture from one ticket: fetch, decode, check, and turn into the blob that is kept. Returns null when it could not be had within the ticket's two paints. */
async function paintLayer(ticket: string, kind: "far-day" | "far-night" | "mid", d: MakeLookDeps): Promise<Blob | null> {
  let paints = PAINTS_PER_TICKET;
  while (paints > 0) {
    if (d.signal?.aborted) return null;
    paints--;
    let res: Response;
    try { res = await d.fetchImpl(`${d.base ?? "/api/world"}/art`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }), signal: d.signal }); }
    catch { if (paints > 0 && (d.retryPauseMs ?? 1500) > 0) await new Promise((r) => setTimeout(r, d.retryPauseMs ?? 1500)); continue; }
    if (res.status === 409 || res.status === 403 || res.status === 503 || res.status === 422 || res.status === 429) return null;         // (used up, forged, not configured: asking again cannot help)
    if (!res.ok) { if (paints > 0 && (d.retryPauseMs ?? 1500) > 0) await new Promise((r) => setTimeout(r, d.retryPauseMs ?? 1500)); continue; }
    try {
      const blob = await res.blob();
      if (blob.size < 500 || (blob.type && !blob.type.startsWith("image/"))) continue;
      if (kind === "mid") {
        const src = await d.decode(blob, MAX_MID_WIDTH);
        const keyed = keyMid(src);
        if (!gateMid(src, keyed).ok || !keyed) continue;                                                         // (a different picture on the retry)
        return await d.encode(keyed.image, "image/webp");
      }
      const src = await d.decode(blob, MAX_FAR_WIDTH);
      if (!gateFar(src, kind === "far-day" ? "day" : "night").ok) continue;
      return await d.encode(src, "image/webp");
    } catch { continue; }
  }
  return null;
}

/**
 * The whole live path for one wish over one base theme. On success the art is ALREADY stored (IndexedDB or memory) and `look.art` says which layers exist; the caller registers it (`registerGeneratedLook`) and
 * puts `look` on the level. An indoor look has no art and nothing to store.
 */
export async function makeLook(wish: string, theme: Base, d: MakeLookDeps): Promise<MakeLookResult> {
  if (!(BASES as readonly string[]).includes(theme) || !wish.trim()) return { ok: false, status: "failed" };
  d.onStage?.("thinking");
  const asked = await askForLook(wish.trim(), theme, d);
  if (!asked.ok) return asked;
  const id = (d.newId ?? newLookId)();
  const look = buildLook(asked.brief, theme, id);
  if (!asked.art) return { ok: true, look, art: {} };
  d.onStage?.("painting");
  const [farDay, farNight, mid] = await Promise.all([paintLayer(asked.art.farDay, "far-day", d), paintLayer(asked.art.farNight, "far-night", d), paintLayer(asked.art.mid, "mid", d)]);
  d.onStage?.("checking");
  if (d.signal?.aborted) return { ok: false, status: "failed" };
  look.art = { farDay: !!farDay, farNight: !!farNight, mid: !!mid };
  const art: LookArt = { ...(farDay ? { farDay } : {}), ...(farNight ? { farNight } : {}), ...(mid ? { mid } : {}) };
  if (farDay || farNight || mid) await putWithLimit(d.store, { id, at: (d.now ?? Date.now)(), ...art } satisfies LookArtRecord);
  return { ok: true, look, art };
}

// ---- the registry side -------------------------------------------------------------------------------------------------------------------------

const liveUrls = new Map<string, string[]>();

/** Make a look's art the world's backdrop. Object URLs are made here and revoked when the same look is registered again or forgotten. Returns whether any look has art to show. */
export function registerGeneratedLook(look: WorldLook, art: LookArt, makeUrl: (b: Blob) => string = (b) => URL.createObjectURL(b), revokeUrl: (u: string) => void = (u) => URL.revokeObjectURL(u)): boolean {
  forgetGeneratedLook(look.id, revokeUrl);
  const urls: string[] = [];
  const u = (b?: Blob): string | null => { if (!b) return null; const x = makeUrl(b); urls.push(x); return x; };
  const specs = generatedBackdrops({ farDay: u(art.farDay), farNight: u(art.farNight), mid: u(art.mid) });
  liveUrls.set(look.id, urls);
  registerBackdrop(look.id, specs);
  return Object.keys(specs).length > 0;
}

export function forgetGeneratedLook(id: string, revokeUrl: (u: string) => void = (u) => URL.revokeObjectURL(u)): void {
  for (const u of liveUrls.get(id) ?? []) { try { revokeUrl(u); } catch { /* nothing to free */ } }
  liveUrls.delete(id);
  unregisterBackdrop(id);
}

/**
 * Make sure a look's art is registered: already registered, or a showcase look (its art ships with the game), or stored on this device. Resolves true when art is (now) registered, false when there is none (the
 * world then wears its base theme's art, with the look's palette). Never throws.
 */
export async function ensureLookArt(look: WorldLook, store: LookStore, makeUrl?: (b: Blob) => string): Promise<boolean> {
  try {
    if (isBackdropRegistered(look.id)) return true;
    if (registerWishArtForLook(look.id)) return true;
    if (look.kind === "indoor" || !(look.art.farDay || look.art.farNight || look.art.mid)) return false;
    const rec = await store.get(look.id);
    return rec ? registerGeneratedLook(look, rec, makeUrl) : false;
  } catch { return false; }
}

// ---- the friendly limit on the device ------------------------------------------------------------------------------------------------------------

/** A courtesy, not a defence (clearing the browser's storage resets it); the Worker's budgets are the real cap. A few new worlds a day and a pause between them. */
export const DEVICE_DAILY_MAX = 3;
export const DEVICE_GAP_MS = 3 * 60 * 1000;
const CAP_KEY = "tvLookMade:v1";
type Kv = Pick<Storage, "getItem" | "setItem">;
const dayOf = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function readCap(kv: Kv, now: number): { day: string; n: number; last: number } {
  try {
    const v = JSON.parse(kv.getItem(CAP_KEY) ?? "null") as { day?: unknown; n?: unknown; last?: unknown } | null;
    if (v && v.day === dayOf(now) && Number.isFinite(v.n) && Number.isFinite(v.last)) return { day: v.day, n: Number(v.n), last: Number(v.last) };
  } catch { /* unreadable: start the day again */ }
  return { day: dayOf(now), n: 0, last: 0 };
}

export function deviceCap(kv: Kv, now: number): { ok: true } | { ok: false; why: "daily" | "wait"; waitMs: number } {
  const c = readCap(kv, now);
  if (c.n >= DEVICE_DAILY_MAX) return { ok: false, why: "daily", waitMs: 0 };
  if (c.last && now - c.last < DEVICE_GAP_MS && now >= c.last) return { ok: false, why: "wait", waitMs: DEVICE_GAP_MS - (now - c.last) };
  return { ok: true };
}

/** Count a world made now (call it once a look has actually been made). */
export function recordLook(kv: Kv, now: number): void {
  const c = readCap(kv, now);
  try { kv.setItem(CAP_KEY, JSON.stringify({ day: c.day, n: c.n + 1, last: now })); } catch { /* storage blocked: no cap on this device, the Worker's budgets still apply */ }
}

/** What Create says to a child for each way a look can fail (kind, short, and never about errors). Null: say nothing, the world simply has no new look. */
export function failureSay(status: LookFailure): string | null {
  switch (status) {
    case "gentle": return "I could not paint that one, so your world keeps its old look. Try other words!";
    case "daily-limit": return "That is a lot of new skies for today! Pick a wish world, or try again tomorrow.";
    case "slow-down": return "One moment, then try again.";
    default: return null;
  }
}
export const stageSay = (s: LookStage): string => (s === "thinking" ? "Dreaming up a look..." : s === "painting" ? "Painting the sky..." : "Checking the pictures...");
export type { LookTime };
