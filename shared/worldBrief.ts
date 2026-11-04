// Generated worlds (docs/specs/generated-worlds-spec.md section 0): the shapes and the pure rules every part builds to. The Worker (worker/worldLook.ts) asks Muse Spark for a WorldBrief and validates it here,
// the offline showcase script (scripts/generate-world-art.mjs) does the same with the same code, and the game stores a small WorldLook inside the level (`LevelDef.look`; no pixels: the art lives in the
// device's IndexedDB under `look.id`).
//
// The rule is the Forge's: the model supplies WORDS and CHOICES from closed lists, code supplies every fact. A brief that fails a check is refused (the caller falls back to the base theme), never repaired
// into something the model did not say, except for two things that are always safe to fix: a colour outside its brightness band is moved into it (so no brief can make an unreadable world), and a missing
// night (or day) palette is derived from the other. Free text from a client never reaches the image model: the Worker paints only from sentences it validated itself, carried in a signed ticket.
//
// Pure: no DOM, no Worker globals except `crypto.subtle` (Workers, browsers and Node 19+ all have it), so it runs in all three places.

/** The base themes a generated outdoor world can wear (they keep their physics, props and missions), and the indoor one. */
export const OUTDOOR_BASES = ["garden", "sky", "junk", "beach", "snow"] as const;
export const BASES = [...OUTDOOR_BASES, "room"] as const;
export type Base = (typeof BASES)[number];
export type LookTime = "day" | "night";

/** What an indoor look can say (closed lists, so a brief cannot invent a wall the Toy Room cannot draw). */
export const ROOM_WALLS = ["stripes", "stars", "dots", "plain"] as const;
export const ROOM_FLOORS = ["wood", "carpet", "tiles"] as const;

export type Hex = string;
export interface Palette { sky: [Hex, Hex, Hex]; fog: Hex; ground: Hex }
export interface RoomLook { wall: (typeof ROOM_WALLS)[number]; floor: (typeof ROOM_FLOORS)[number]; accent: Hex }

/** What Muse Spark returns once validated. `far` and `mid` are ONE sentence each; the image prompts are templates with those sentences swapped in. An indoor brief has no far or mid (no painted layers). */
export interface WorldBrief {
  name: string;
  kind: "outdoor" | "indoor";
  day: Palette;
  night: Palette;
  far: string;
  mid: string;
  room: RoomLook | null;
  say: string;
}

/** What the level keeps (small JSON): `art` says which layers actually exist on the device, so a failed layer falls back to the base theme's own art. */
export interface WorldLook {
  v: 1;
  id: string;
  kind: "outdoor" | "indoor";
  base: Base;
  name: string;
  day: Palette;
  night: Palette;
  art: { farDay: boolean; farNight: boolean; mid: boolean };
  room?: RoomLook;
  aiMade: true;
}

// ---- colour ---------------------------------------------------------------------------------------------------------------------------------

export const isHex = (s: unknown): s is Hex => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

/** [h 0..360, s 0..1, l 0..1] of a #rrggbb colour. */
export function toHsl(hex: Hex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): Hex {
  const hh = ((h % 360) + 360) % 360 / 360, ss = Math.min(1, Math.max(0, s)), ll = Math.min(1, Math.max(0, l));
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
  const f = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(f(hh + 1 / 3))}${to(f(hh))}${to(f(hh - 1 / 3))}`;
}

/** Brightness bands (HSL lightness) per look: a day world is light, a night world dark, whatever the brief says. */
export const BANDS = {
  day: { sky: [0.38, 0.93], fog: [0.62, 0.97], ground: [0.3, 0.82] },
  night: { sky: [0.04, 0.3], fog: [0.05, 0.34], ground: [0.1, 0.45] },
} as const;

/** The colour with its lightness moved into [lo, hi] (hue and saturation kept). */
export function clampLightness(hex: Hex, lo: number, hi: number): Hex {
  const [h, s, l] = toHsl(hex);
  const nl = Math.min(hi, Math.max(lo, l));
  return nl === l ? hex.toLowerCase() : fromHsl(h, s, nl);
}

export function clampPalette(p: Palette, look: LookTime): Palette {
  const b = BANDS[look];
  const [sLo, sHi] = [b.sky[0], b.sky[1]], [fLo, fHi] = [b.fog[0], b.fog[1]], [gLo, gHi] = [b.ground[0], b.ground[1]];
  return {
    sky: [clampLightness(p.sky[0], sLo, sHi), clampLightness(p.sky[1], sLo, sHi), clampLightness(p.sky[2], sLo, sHi)],
    fog: clampLightness(p.fog, fLo, fHi),
    ground: clampLightness(p.ground, gLo, gHi),
  };
}

/** A night palette made from a day one: the same hues pulled toward blue-violet and dark ("night is the same scene with the lights on"). */
export function deriveNight(day: Palette): Palette {
  const dark = (hex: Hex, k: number): Hex => { const [h, s, l] = toHsl(hex); return fromHsl(h + (235 - h) * 0.35, s * 0.85, l * k); };
  return clampPalette({ sky: [dark(day.sky[0], 0.18), dark(day.sky[1], 0.3), dark(day.sky[2], 0.45)], fog: dark(day.fog, 0.32), ground: dark(day.ground, 0.45) }, "night");
}

/** A day palette made from a night one (when only the night was given). */
export function deriveDay(night: Palette): Palette {
  const light = (hex: Hex, k: number): Hex => { const [h, s, l] = toHsl(hex); return fromHsl(h + (210 - h) * 0.25, Math.min(1, s * 1.1), Math.min(0.95, l * k + 0.25)); };
  return clampPalette({ sky: [light(night.sky[0], 1.6), light(night.sky[1], 1.4), light(night.sky[2], 1.2)], fog: light(night.fog, 1.2), ground: light(night.ground, 1.4) }, "day");
}

// ---- the brief ------------------------------------------------------------------------------------------------------------------------------

export const MAX_NAME = 28;
export const MAX_SENTENCE = 170;
export const MIN_SENTENCE = 14;
export const MAX_WISH_CHARS = 200;

/** One tidy piece of text, or null: a string, whitespace collapsed, quotes and line breaks out, no links, within [min, max] characters, and it passes the caller's child-safe check. */
export function cleanText(raw: unknown, safe: (s: string) => boolean, min: number, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\r\n\t]+/g, " ").replace(/["`\u201c\u201d]/g, "").replace(/\s{2,}/g, " ").replace(/\u2014/g, ",").replace(/\u2013/g, "-").trim();
  if (s.length < min || s.length > max) return null;
  if (/https?:|www\.|@|\.com\b|[<>{}[\]\\]/i.test(s)) return null;
  return safe(s) ? s : null;
}

/** A sentence (the far and mid descriptions, what the world says). */
export const cleanSentence = (raw: unknown, safe: (s: string) => boolean, max = MAX_SENTENCE): string | null => cleanText(raw, safe, MIN_SENTENCE, max);
/** A world's name: two to four words, not a sentence. */
export const cleanName = (raw: unknown, safe: (s: string) => boolean): string | null => cleanText(raw, safe, 3, MAX_NAME);

function parsePalette(raw: unknown): Palette | null {
  const r = raw as { sky?: unknown; fog?: unknown; ground?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.sky) || r.sky.length !== 3) return null;
  if (!r.sky.every(isHex) || !isHex(r.fog) || !isHex(r.ground)) return null;
  return { sky: [r.sky[0] as Hex, r.sky[1] as Hex, r.sky[2] as Hex], fog: r.fog, ground: r.ground };
}

export type BriefResult = { ok: true; brief: WorldBrief } | { ok: false; reason: string };

/**
 * Validate what the model said. `base` is the base theme the level already has (Create chose it); an indoor world is base "room". Unknown keys are dropped; the result is a fresh object. `safe` is the caller's child-safe
 * check (the Worker passes `kidSafeText` with the child's words so the echo rule applies).
 */
export function parseBrief(raw: unknown, opts: { base: Base; safe: (s: string) => boolean }): BriefResult {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, reason: "not an object" };
  if (r.ok === false) return { ok: false, reason: "the model declined" };
  const indoor = opts.base === "room";
  const name = cleanName(r.name, opts.safe);
  if (!name) return { ok: false, reason: "name" };
  const say = cleanSentence(r.say, opts.safe) ?? `Let's explore ${name} together!`;
  let day = parsePalette(r.day), night = parsePalette(r.night);
  const given = (v: unknown) => v !== undefined && v !== null;
  if ((given(r.day) && !day) || (given(r.night) && !night)) return { ok: false, reason: "palette" };           // (one that is there but malformed is refused; only an ABSENT one is derived)
  if (!day && !night) return { ok: false, reason: "no palette" };
  if (!day) day = deriveDay(night as Palette);
  if (!night) night = deriveNight(day);
  day = clampPalette(day, "day");
  night = clampPalette(night, "night");
  if (indoor) {
    const room = r.room as { wall?: unknown; floor?: unknown; accent?: unknown } | null;
    if (!room || typeof room !== "object") return { ok: false, reason: "room" };
    const wall = (ROOM_WALLS as readonly unknown[]).includes(room.wall) ? (room.wall as RoomLook["wall"]) : "plain";
    const floor = (ROOM_FLOORS as readonly unknown[]).includes(room.floor) ? (room.floor as RoomLook["floor"]) : "wood";
    const accent = isHex(room.accent) ? clampLightness(room.accent, 0.3, 0.8) : "#ff9d5c";
    return { ok: true, brief: { name, kind: "indoor", day, night: day, far: "", mid: "", room: { wall, floor, accent }, say } };
  }
  const far = cleanSentence(r.far, opts.safe), mid = cleanSentence(r.mid, opts.safe);
  if (!far) return { ok: false, reason: "far" };
  if (!mid) return { ok: false, reason: "mid" };
  return { ok: true, brief: { name, kind: "outdoor", day, night, far, mid, room: null, say } };
}

/**
 * The instruction for Muse Spark. The child's words are quoted as `The child said: "..."` (the Worker's echo rule looks for exactly that), capped, and never repeated back by the model. The lists are the closed ones above.
 */
export function briefPrompt(wish: string, base: Base): string {
  const said = wish.replace(/["\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, MAX_WISH_CHARS);
  const indoor = base === "room";
  const shape = indoor
    ? `{"name":"2 to 4 words","day":{"sky":["#hex","#hex","#hex"],"fog":"#hex","ground":"#hex"},"night":{"sky":["#hex","#hex","#hex"],"fog":"#hex","ground":"#hex"},"room":{"wall":"one of ${ROOM_WALLS.join(", ")}","floor":"one of ${ROOM_FLOORS.join(", ")}","accent":"#hex"},"say":"one short friendly sentence"}`
    : `{"name":"2 to 4 words","day":{"sky":["#hex top","#hex middle","#hex horizon"],"fog":"#hex","ground":"#hex"},"night":{"sky":["#hex top","#hex middle","#hex horizon"],"fog":"#hex","ground":"#hex"},"far":"ONE sentence describing the distant scenery only","mid":"ONE sentence naming 5 to 8 different things that are spread evenly along the whole strip","say":"one short friendly sentence"}`;
  return [
    `You design the look of a children's game world (soft clay toy style, ages 3 to 10). Answer with ONE JSON object and nothing else, exactly this shape: ${shape}`,
    `The world is ${indoor ? "a cosy indoor room" : `an outdoor place built on the "${base}" theme`}. Rules: every colour is a #rrggbb hex. The "day" palette is light and cheerful, the "night" palette is the same place after dark (deep, dark, a little blue).`,
    indoor
      ? "Describe the room's colours only; do not describe a picture."
      : `"far" describes the faraway scenery (hills, sea, sky, skyline) with no people, no animals in the foreground and NO time of day in it. "mid" lists the things in the middle distance (for example: lollipop trees, a candy cottage, gumdrop hills); they are painted spread along the whole width.`,
    `Use only kind, safe, child-friendly ideas. Never use brand names, real people, characters from shows, words in other languages, scary things, weapons or text to be written in the picture. Never repeat the child's words back; make the world YOUR OWN interpretation of the wish. If the wish is unsafe or makes no sense, make a gentle meadow, sea or room instead.`,
    `The child said: "${said}"`,
  ].join("\n\n");
}

// ---- the images -----------------------------------------------------------------------------------------------------------------------------

/** 8:1 (the service answers about 4480 x 560 whatever it is asked: `size` only sets the aspect). */
export const IMAGE_SIZE = "4096x512";
const STYLE = "Smooth flat illustration, soft clay toy style for a children's game, no text.";

/** The far band prompt: a panorama with a level horizon, in the look's time of day. The sentence is the validated brief's `far`. */
export function farPrompt(far: string, look: LookTime): string {
  const when = look === "day"
    ? "in bright daytime, a clear sky with a warm sun and a few soft clouds"
    : "at night, a deep dark sky full of twinkling stars with a glowing full moon, a few distant warm lights";
  return `A wide panoramic scene ${when}: ${far} ${STYLE} Level horizon, nothing in the middle of the picture, the same soft look from left to right.`;
}

/** The mid strip prompt: discrete things spread across the WHOLE width, on pure black, so the game can key the surround away. (A plain "centered strip" prompt came back as one cluster; this wording fixed that for the Junkyard.) */
export function midPrompt(mid: string): string {
  return `A wide horizontal strip that fills the WHOLE width of the picture from the far left edge to the far right edge with no gaps: ${mid} All different from each other and spread evenly along the entire strip, soft clay toy style, empty space above, on a PURE SOLID BLACK background (#000000), nothing else, no ground line, no sky, no text.`;
}

// ---- signed art tickets ---------------------------------------------------------------------------------------------------------------------

/** What a ticket carries: which layer, which look (far only), the validated sentence, and when it stops being good. */
export interface ArtTicket { k: "far" | "mid"; look?: LookTime; s: string; exp: number }
export const TICKET_TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
};
async function hmac(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`worldart:${text}`)));      // ("worldart:" keeps this key's other uses, the spoken names, from ever validating an art ticket)
}

/** `payload.signature`, both base64url. The Worker signs after it has validated the sentence; it never paints from anything else. */
export async function signTicket(secret: string, t: ArtTicket): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify({ k: t.k, look: t.look ?? null, s: t.s, exp: t.exp })));
  return `${body}.${b64u(await hmac(secret, body))}`;
}

/** The ticket if its signature is right (canonical encoding only) and it has not expired; otherwise null. */
export async function verifyTicket(secret: string, ticket: unknown, now: number): Promise<ArtTicket | null> {
  if (typeof ticket !== "string" || ticket.length > 1200) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const want = b64u(await hmac(secret, body));
  if (sig.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);             // (constant time)
  if (diff !== 0) return null;
  const raw = unb64u(body);
  if (!raw) return null;
  let parsed: { k?: unknown; look?: unknown; s?: unknown; exp?: unknown };
  try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch { return null; }
  if ((parsed.k !== "far" && parsed.k !== "mid") || typeof parsed.s !== "string" || typeof parsed.exp !== "number") return null;
  if (parsed.k === "far" && parsed.look !== "day" && parsed.look !== "night") return null;
  if (now > parsed.exp) return null;
  return { k: parsed.k, ...(parsed.k === "far" ? { look: parsed.look as LookTime } : {}), s: parsed.s, exp: parsed.exp };
}

// ---- ids and the stored look ------------------------------------------------------------------------------------------------------------------

/** `gen-` and ten hex digits: the key the art is stored under on the device. */
export function newLookId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(5))): string {
  return "gen-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export const isLookId = (s: unknown): s is string => typeof s === "string" && /^gen-[0-9a-f]{10}$/.test(s);

/** The look the level keeps, from a validated brief. `art` starts all false: it is set as each layer is stored. */
export function buildLook(brief: WorldBrief, base: Base, id: string): WorldLook {
  return {
    v: 1, id, kind: brief.kind, base, name: brief.name, day: brief.day, night: brief.night,
    art: { farDay: false, farNight: false, mid: false },
    ...(brief.room ? { room: brief.room } : {}),
    aiMade: true,
  };
}

/** A stored look read back from untrusted JSON (a shared level file, an old save): the look, or null. */
export function parseLook(raw: unknown): WorldLook | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1 || !isLookId(r.id)) return null;
  if ((r.kind !== "outdoor" && r.kind !== "indoor") || !(BASES as readonly unknown[]).includes(r.base)) return null;
  const day = parsePalette(r.day), night = parsePalette(r.night);
  if (!day || !night || typeof r.name !== "string") return null;
  const art = r.art as { farDay?: unknown; farNight?: unknown; mid?: unknown } | null;
  const room = r.room as { wall?: unknown; floor?: unknown; accent?: unknown } | undefined;
  const look: WorldLook = {
    v: 1, id: r.id, kind: r.kind, base: r.base as Base, name: r.name.slice(0, MAX_NAME),
    day: clampPalette(day, "day"), night: r.kind === "indoor" ? clampPalette(day, "day") : clampPalette(night, "night"),     // (indoors is the same at every hour: its "night" IS its day palette, so it is not darkened)
    art: { farDay: art?.farDay === true, farNight: art?.farNight === true, mid: art?.mid === true },
    aiMade: true,
  };
  if (room && (ROOM_WALLS as readonly unknown[]).includes(room.wall) && (ROOM_FLOORS as readonly unknown[]).includes(room.floor) && isHex(room.accent)) {
    look.room = { wall: room.wall as RoomLook["wall"], floor: room.floor as RoomLook["floor"], accent: room.accent };
  }
  return look;
}
