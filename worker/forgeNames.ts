// Names for Forge objects, spoken in the seven languages, without /api/voice ever becoming an open text-to-speech endpoint.
// Design: docs/specs/forge-ai-spec.md, "Naming and the waiting state" (approved by Dan 2026-11-03). Built here: the validation, the signing and the
// issuing. Not built yet: the generator route that calls the model and hands its `names` to parseNames/issueSpokenNames (there is no Forge screen).
//
// A Forge object is free text ("spoon", "wizard hat"), so the closed vocabulary of src/lib/propNames.ts cannot name it. The model returns, in the same call
// that makes the object, a name for each language as the Noun shape propNames already uses ({ w: word, g: gender, pl?: plural }). This file then:
//   1. parseNames   keeps only names that are safe and speakable (kid-safety filter, brand filter, letters of the Latin script only, at most 40 characters,
//                   a real gender); a language that fails is dropped, and a set with no good English name is dropped whole.
//   2. signSpeech   HMAC-SHA256 over the language and the noun entry, with the Worker secret VOICE_SIGNING_KEY. The COLOUR is not signed: it is one of the 12
//                   colour words, chosen later (the preview colour, or the print colour), and attached by code with nounPhrase() so word order and agreement
//                   stay built, never written by a model. That bounds the clips at 13 per signed name per language.
//   3. verifySpeech /api/voice?lang=&w=&g=&pl=&c=&sig= is only answered when the signature checks out, so the endpoint can only speak text this Worker itself
//                   produced and filtered. Without the secret nothing is signed and nothing is spoken (the route refuses, as before).
import { checkForgeRecipeBrandSafety, type ForgeRecipeV1 } from "../shared/forgeOptimizer";
import { LANGUAGES, type LangCode, type Noun } from "../src/lib/propNames";
import { kidSafeText } from "./muse";

export interface SigningEnv {
  /** At least 16 characters. Set with `wrangler secret put VOICE_SIGNING_KEY`; never committed. */
  VOICE_SIGNING_KEY?: string;
}
export type SpokenNames = Partial<Record<LangCode, Noun>>;
export type SignedName = Noun & { sig: string };
export type SignedNames = Partial<Record<LangCode, SignedName>>;

export const MAX_NAME_CHARS = 40;
const MIN_KEY_CHARS = 16;
/** Letters of the Latin script (with combining marks), in words joined by one space, apostrophe or hyphen. No digits, no symbols, no emoji, no other script. */
const WORD_RE = /^[\p{Script=Latin}\p{M}]+(?:[ '’-][\p{Script=Latin}\p{M}]+)*$/u;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;
const LANG_CODES = LANGUAGES.map((l) => l.code as LangCode);
/** These languages give a noun no neuter: a model that says "neuter" for one is wrong about the language, so that language is not trusted. */
const NO_NEUTER: readonly LangCode[] = ["es", "fr", "it", "pt"];

export const isLangCode = (v: unknown): v is LangCode => typeof v === "string" && (LANG_CODES as readonly string[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Is this a word the voice may be asked to say? Pure shape check, used by the route as well. */
export function isSpeakableWord(w: unknown): w is string {
  return typeof w === "string" && w.length >= 1 && w.length <= MAX_NAME_CHARS && WORD_RE.test(w);
}

/** One language's name, or null when it must not be spoken. Gender is unused by English and Turkish, so it is normalised there. */
export function normalizeNoun(lang: LangCode, raw: unknown): Noun | null {
  if (!isRecord(raw) || typeof raw.w !== "string") return null;
  const w = raw.w.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!isSpeakableWord(w)) return null;
  const pl = raw.pl;
  if (pl !== undefined && typeof pl !== "boolean") return null;
  let g = raw.g;
  if (lang === "en" || lang === "tr") g = "m";
  if (g !== "m" && g !== "f" && g !== "n") return null;
  if (g === "n" && NO_NEUTER.includes(lang)) return null;
  return pl ? { w, g, pl: true } : { w, g };
}

export interface ParsedNames {
  names: SpokenNames;
  /** Languages that were left out, and why: for the log, never shown to a child. */
  dropped: Array<{ lang: LangCode; reason: "missing" | "shape" | "unsafe" | "brand" | "echo" }>;
}

/** The recipe's own name as an English noun, if it is speakable, passes the kid-safety check WITH the echo rule, and is not the generic placeholder; else null. */
function standIn(recipeName: string | undefined, said: string): Noun | null {
  if (typeof recipeName !== "string") return null;
  const w = recipeName.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!w || w === "My Creation" || !isSpeakableWord(w) || !kidSafeText(w, said)) return null;
  return { w, g: "m" };
}

/**
 * Validate what the model returned as `names`. `childSaid` is the child's own words (for the echo rule in kidSafeText, which only blocks long copies, so
 * naming a "spoon" a "spoon" is fine). English is the fallback every other language falls back to, so with no good English name nothing is kept.
 *
 * `recipeName` (optional) is the part's own name, already filtered like any model text. It is used ONLY when the English name fails the echo rule and nothing else
 * (it copies the child's words, as a name for "ninja hat" naturally does) and the recipe name passes every check itself: it then stands in for the English name, so a
 * harmless two-word wish does not lose all seven names. An English name with an unsafe word or a brand is never replaced, and if the recipe name echoes the wish too
 * (or is not speakable, or is unsafe) nothing is kept, as before. Every name that is kept has passed the same checks as always. Dan approved this change 2026-11-04.
 */
export function parseNames(raw: unknown, childSaid = "", recipeName?: string): ParsedNames {
  const names: SpokenNames = {};
  const dropped: ParsedNames["dropped"] = [];
  const said = childSaid.toLowerCase().replace(/\s+/g, " ").trim();
  for (const lang of LANG_CODES) {
    const entry = isRecord(raw) && Object.hasOwn(raw, lang) ? raw[lang] : undefined;
    if (entry === undefined) { dropped.push({ lang, reason: "missing" }); continue; }
    let noun = normalizeNoun(lang, entry);
    if (!noun) { dropped.push({ lang, reason: "shape" }); continue; }
    if (!kidSafeText(noun.w, said)) {
      // English only, and only when the sole fault is the echo (the name is fine without the child's words in view): the recipe's own name may stand in
      const stand = lang === "en" && kidSafeText(noun.w) ? standIn(recipeName, said) : null;
      if (!stand) { dropped.push({ lang, reason: kidSafeText(noun.w) ? "echo" : "unsafe" }); continue; } // "echo": nothing wrong with the name but it copies the child's words (the app speaks the English name instead)
      noun = stand;
    }
    if (checkForgeRecipeBrandSafety({ name: noun.w, slot: "crown", shape: { slices: [] } } as unknown as ForgeRecipeV1)) { dropped.push({ lang, reason: "brand" }); continue; }
    names[lang] = noun;
  }
  if (!names.en) return { names: {}, dropped: LANG_CODES.map((lang) => dropped.find((d) => d.lang === lang) ?? { lang, reason: "missing" as const }) };
  return { names, dropped };
}

const enc = new TextEncoder();
const material = (lang: LangCode, n: Noun) => enc.encode(`v1|${lang}|${n.g}|${n.pl ? 1 : 0}|${n.w}`);
const toB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const signingConfigured = (env: SigningEnv): boolean => typeof env.VOICE_SIGNING_KEY === "string" && env.VOICE_SIGNING_KEY.length >= MIN_KEY_CHARS;

async function hmacKey(env: SigningEnv, usage: "sign" | "verify"): Promise<CryptoKey | null> {
  if (!signingConfigured(env)) return null;
  return crypto.subtle.importKey("raw", enc.encode(env.VOICE_SIGNING_KEY!), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** The signature for one language's noun entry, or null when no signing key is set. */
export async function signSpeech(env: SigningEnv, lang: LangCode, noun: Noun): Promise<string | null> {
  const key = await hmacKey(env, "sign");
  if (!key || !isLangCode(lang) || !isSpeakableWord(noun.w)) return null;
  return toB64url(await crypto.subtle.sign("HMAC", key, material(lang, noun)));
}

/** True only for a signature this Worker made for exactly this language and noun entry. Constant-time compare; malformed input is simply false. */
export async function verifySpeech(env: SigningEnv, lang: LangCode, noun: Noun, sig: unknown): Promise<boolean> {
  if (typeof sig !== "string" || !SIG_RE.test(sig) || !isLangCode(lang) || !isSpeakableWord(noun.w)) return false;
  const key = await hmacKey(env, "verify");
  if (!key) return false;
  const mac = fromB64url(sig);
  if (toB64url(mac.buffer) !== sig) return false; // canonical only: the last character of 43 carries 4 bits, so other spellings would decode to the same bytes
  return crypto.subtle.verify("HMAC", key, mac, material(lang, noun));
}

/**
 * What the generator's reply carries so the client can speak the object: each language's noun with its signature. Empty when no key is set (nothing can
 * be spoken, so the client uses captions and the device voice, as for any failed clip). Pass what parseNames returned.
 */
export async function issueSpokenNames(env: SigningEnv, names: SpokenNames): Promise<SignedNames> {
  const out: SignedNames = {};
  for (const lang of LANG_CODES) {
    const noun = names[lang];
    if (!noun) continue;
    const sig = await signSpeech(env, lang, noun);
    if (sig) out[lang] = { ...noun, sig };
  }
  return out;
}
