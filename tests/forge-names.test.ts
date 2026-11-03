import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_CHARS, isSpeakableWord, issueSpokenNames, normalizeNoun, parseNames, signSpeech, signingConfigured, verifySpeech } from "../worker/forgeNames";
import { handleVoice, modelText, parseVoiceKey, type VoiceEnv } from "../worker/voice";
import { LANGUAGES, type LangCode } from "../src/lib/propNames";

// Forge objects are free text, so their spoken names are signed by the Worker (worker/forgeNames.ts) and /api/voice speaks only what it signed.
// Spec: docs/specs/forge-ai-spec.md, "Naming and the waiting state".
const KEY = "a-test-signing-key-of-32-characters!";
const env = { VOICE_SIGNING_KEY: KEY };
const langs = LANGUAGES.map((l) => l.code as LangCode);

const GOOD = {
  en: { w: "spoon", g: "m" }, es: { w: "cuchara", g: "f" }, fr: { w: "cuillère", g: "f" }, de: { w: "Löffel", g: "m" },
  it: { w: "cucchiaio", g: "m" }, pt: { w: "colher", g: "f" }, tr: { w: "kaşık", g: "m" },
};

afterEach(() => vi.unstubAllGlobals());

/**
 * The other spellings of a 43-character signature that decode to the very same bytes: the last character carries only 4 data bits, so the three that differ in
 * its low 2 bits are padding noise. verifySpeech must refuse them (one canonical spelling per signature).
 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const sameBytesSpellings = (sig: string) => { const i = B64.indexOf(sig.slice(-1)); return [0, 1, 2, 3].map((k) => sig.slice(0, 42) + B64[(i & ~3) | k]).filter((x) => x !== sig); };

describe("what counts as a speakable word", () => {
  it("accepts letters of the Latin script (accents included) joined by one space, apostrophe or hyphen", () => {
    for (const w of ["spoon", "Löffel", "cuillère", "kaşık", "colher", "T-Rex", "teddy bear", "l'arbre", "sandcastle", "Straße", "étoile"]) expect(isSpeakableWord(w), w).toBe(true);
  });
  it("refuses everything else: digits, symbols, markup, emoji, other scripts, odd spacing, empty, too long, not a string", () => {
    for (const w of ["", " ", "spoon ", " spoon", "spoon  hat", "-spoon", "spoon-", "spoon--hat", "r2d2", "spoon!", "spoon: red", "<b>spoon</b>", "a/b", "😀", "ложка", "スプーン", "spoon\n", "spoon\u0000", "x".repeat(MAX_NAME_CHARS + 1)]) expect(isSpeakableWord(w), JSON.stringify(w)).toBe(false);
    for (const w of [null, undefined, 7, {}, ["spoon"]]) expect(isSpeakableWord(w)).toBe(false);
    expect(isSpeakableWord("x".repeat(MAX_NAME_CHARS))).toBe(true);
  });
});

describe("one language's name", () => {
  it("cleans the word and keeps gender and plural", () => {
    expect(normalizeNoun("es", { w: "  cuchara  ", g: "f" })).toEqual({ w: "cuchara", g: "f" });
    expect(normalizeNoun("de", { w: "Bauklötze", g: "n", pl: true })).toEqual({ w: "Bauklötze", g: "n", pl: true });
    expect(normalizeNoun("fr", { w: "étoile", g: "f" })!.w).toBe("étoile"); // NFC
    expect(normalizeNoun("pt", { w: "teddy  bear", g: "m", pl: false })).toEqual({ w: "teddy bear", g: "m" });
  });
  it("English and Turkish do not use gender, so whatever the model says is normalised", () => {
    expect(normalizeNoun("en", { w: "spoon", g: "f" })).toEqual({ w: "spoon", g: "m" });
    expect(normalizeNoun("tr", { w: "kaşık", g: "n" })).toEqual({ w: "kaşık", g: "m" });
    expect(normalizeNoun("en", { w: "spoon" })).toEqual({ w: "spoon", g: "m" });
  });
  it("refuses a bad gender, and a neuter in a language that has none (that language's data is not to be trusted)", () => {
    for (const lang of ["es", "fr", "it", "pt"] as LangCode[]) expect(normalizeNoun(lang, { w: "cosa", g: "n" }), lang).toBeNull();
    expect(normalizeNoun("de", { w: "Ding", g: "n" })).toEqual({ w: "Ding", g: "n" });
    for (const g of ["x", "", "M", 1, null, undefined]) expect(normalizeNoun("de", { w: "Ball", g }), String(g)).toBeNull();
  });
  it("refuses anything that is not a plain record with a speakable word, or a plural that is not a boolean", () => {
    for (const raw of [null, undefined, "spoon", 5, [], { g: "m" }, { w: 5, g: "m" }, { w: "r2d2", g: "m" }, { w: "ok", g: "m", pl: "yes" }, { w: "ok", g: "m", pl: 1 }]) expect(normalizeNoun("de", raw), JSON.stringify(raw)).toBeNull();
  });
});

describe("parseNames keeps only names that are safe to speak", () => {
  it("keeps a complete set, and says nothing was dropped", () => {
    const r = parseNames(GOOD, "a spoon");
    expect(r.dropped).toEqual([]);
    expect(Object.keys(r.names).sort()).toEqual([...langs].sort());
    expect(r.names.es).toEqual({ w: "cuchara", g: "f" });
  });
  it("naming the object what the child asked for is fine (only a long copy of the child's words is an echo)", () => {
    expect(Object.keys(parseNames(GOOD, "spoon").names)).toHaveLength(7);
  });
  it("drops a language that is missing or malformed and keeps the rest", () => {
    const r = parseNames({ ...GOOD, fr: undefined, de: { w: "Löffel", g: "x" }, it: "cucchiaio" });
    expect(Object.keys(r.names).sort()).toEqual(["en", "es", "pt", "tr"]);
    expect(r.dropped.map((d) => `${d.lang}:${d.reason}`).sort()).toEqual(["de:shape", "fr:missing", "it:shape"]);
  });
  it("drops an unsafe word, a link or number, a brand, and a long echo of the child's words, each with its reason", () => {
    expect(parseNames({ ...GOOD, es: { w: "knife", g: "m" } }).dropped).toEqual([{ lang: "es", reason: "unsafe" }]);
    expect(parseNames({ ...GOOD, fr: { w: "toyventor.com", g: "m" } }).dropped).toEqual([{ lang: "fr", reason: "shape" }]); // a dot is not a letter
    expect(parseNames({ ...GOOD, de: { w: "Lego Stein", g: "m" } }).dropped).toEqual([{ lang: "de", reason: "brand" }]);
    expect(parseNames({ ...GOOD, it: { w: "Duplo", g: "m" } }).dropped).toEqual([{ lang: "it", reason: "brand" }]);
    const echo = parseNames({ ...GOOD, en: { w: "a wizard hat with stars", g: "m" } }, "A wizard hat   with stars");
    expect(echo.names).toEqual({}); // English was the echo, so nothing is kept
    expect(echo.dropped).toHaveLength(7);
  });
  it("with no good English name nothing is kept, because English is what every other language falls back to", () => {
    for (const bad of [{ ...GOOD, en: undefined }, { ...GOOD, en: { w: "knife", g: "m" } }, { ...GOOD, en: { w: "Lego", g: "m" } }, { ...GOOD, en: { w: "", g: "m" } }]) {
      const r = parseNames(bad);
      expect(r.names, JSON.stringify(bad.en)).toEqual({});
      expect(r.dropped.map((d) => d.lang)).toEqual(langs);
    }
  });
  it("copes with anything the model might send, and ignores inherited keys", () => {
    for (const raw of [null, undefined, "x", 3, [], [GOOD], { constructor: GOOD }, JSON.parse('{"__proto__":{"w":"x","g":"m"}}')]) {
      const r = parseNames(raw);
      expect(r.names, JSON.stringify(raw)).toEqual({});
    }
    const input = structuredClone(GOOD);
    parseNames(input);
    expect(input).toEqual(GOOD); // not mutated
  });
});

describe("signing", () => {
  it("is on only with a key of at least 16 characters", async () => {
    expect(signingConfigured(env)).toBe(true);
    for (const e of [{}, { VOICE_SIGNING_KEY: "" }, { VOICE_SIGNING_KEY: "short" }, { VOICE_SIGNING_KEY: "x".repeat(15) }]) {
      expect(signingConfigured(e)).toBe(false);
      expect(await signSpeech(e, "es", { w: "cuchara", g: "f" })).toBeNull();
      expect(await verifySpeech(e, "es", { w: "cuchara", g: "f" }, "A".repeat(43))).toBe(false);
    }
    expect(signingConfigured({ VOICE_SIGNING_KEY: "x".repeat(16) })).toBe(true);
  });
  it("makes a 43 character URL-safe signature, the same every time, that verifies", async () => {
    const n = { w: "cuchara", g: "f" as const };
    const a = await signSpeech(env, "es", n);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await signSpeech(env, "es", n)).toBe(a);
    expect(await verifySpeech(env, "es", n, a)).toBe(true);
  });
  it("is bound to the language, the word, the gender and the plural: change any one and it no longer verifies", async () => {
    const n = { w: "cuchara", g: "f" as const };
    const sig = (await signSpeech(env, "es", n))!;
    for (const [lang, noun] of [["pt", n], ["es", { ...n, w: "cuchillo" }], ["es", { ...n, g: "m" as const }], ["es", { ...n, pl: true }], ["es", { w: "Cuchara", g: "f" as const }]] as Array<[LangCode, typeof n]>) {
      expect(await verifySpeech(env, lang, noun, sig), JSON.stringify([lang, noun])).toBe(false);
    }
  });
  it("refuses a tampered, truncated, padded, wrongly encoded or non-string signature, and a signature made with another key", async () => {
    const n = { w: "cuchara", g: "f" as const };
    const sig = (await signSpeech(env, "es", n))!;
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const other = (await signSpeech({ VOICE_SIGNING_KEY: "another-signing-key-of-32-characters" }, "es", n))!;
    expect(sameBytesSpellings(sig)).toHaveLength(3); // guard: the helper really found three alternative spellings
    for (const bad of [...sameBytesSpellings(sig), flipped, sig.slice(1), sig + "A", sig.replace(/.$/, "="), sig.replace(/^./, "+"), "", other, null, undefined, 7, {}]) expect(await verifySpeech(env, "es", n, bad), String(bad)).toBe(false);
  });
  it("will not sign or verify a word the voice may not say", async () => {
    expect(await signSpeech(env, "es", { w: "r2d2", g: "m" })).toBeNull();
    expect(await signSpeech(env, "xx" as LangCode, { w: "ok", g: "m" })).toBeNull();
    expect(await verifySpeech(env, "es", { w: "<b>", g: "m" }, "A".repeat(43))).toBe(false);
  });
  it("issues a signed noun per language that was kept, and nothing without a key", async () => {
    const { names } = parseNames({ ...GOOD, fr: undefined });
    const out = await issueSpokenNames(env, names);
    expect(Object.keys(out).sort()).toEqual(["de", "en", "es", "it", "pt", "tr"]);
    for (const [lang, entry] of Object.entries(out)) expect(await verifySpeech(env, lang as LangCode, { w: entry.w, g: entry.g, ...(entry.pl ? { pl: true } : {}) }, entry.sig), lang).toBe(true);
    expect(await issueSpokenNames({}, names)).toEqual({});
  });
});

// ---- the route ------------------------------------------------------------------------------------------------------------------
const wav = (() => { const b = new Uint8Array(44 + 400); b.set([0x52, 0x49, 0x46, 0x46], 0); return b; })();   // not a real WAV: the route passes such bytes through untouched
const dataUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...wav))}`;
/** A Worker env with the AI binding faked; `key` is the signing key (null: a Worker that has none; not undefined, which would pick the default). */
function fakeEnv(key: string | null = KEY) {
  const run = vi.fn(async (_m: string, _i: unknown, _o?: unknown) => ({ audio: dataUrl }));
  return { env: { AI: { run }, ...(key === null ? {} : { VOICE_SIGNING_KEY: key }) } as VoiceEnv, run };
}
const req = (qs: string) => new Request(`https://toyventor.com/api/voice?${qs}`);
async function signed(lang: LangCode, w: string, g: "m" | "f" | "n", pl = false) {
  const sig = await signSpeech(env, lang, pl ? { w, g, pl: true } : { w, g });
  return `lang=${lang}&w=${encodeURIComponent(w)}&g=${g}${pl ? "&pl=1" : ""}&sig=${sig}`;
}
const spoken = (run: ReturnType<typeof fakeEnv>["run"]) => (run.mock.calls[0]![1] as { text: string }).text;

describe("/api/voice speaks a Forge name only if the Worker signed it", () => {
  it("speaks a signed name with the colour attached by code, in the right gender and word order", async () => {
    for (const [lang, w, g, pl, colour, say] of [
      ["es", "cuchara", "f", false, "red", "cuchara roja"], ["es", "árbol", "m", false, "red", "árbol rojo"], ["de", "Haus", "n", false, "green", "grünes Haus"],
      ["de", "Löffel", "m", false, "blue", "blauer Löffel"], ["fr", "cuillères", "f", true, "red", "cuillères rouges"], ["en", "spoon", "m", false, "red", "red spoon"],
      ["tr", "kaşık", "m", false, "red", "kırmızı kaşık"], ["pt", "colher", "f", false, "black", "colher preta"],
    ] as Array<[LangCode, string, "m" | "f" | "n", boolean, string, string]>) {
      const { env: e, run } = fakeEnv();
      const res = await handleVoice(req(`${await signed(lang, w, g, pl)}&c=${colour}`), e);
      expect(res.status, say).toBe(200);
      expect(spoken(run)).toBe(modelText(lang, say)); // the language's lead-in, when it has one, goes in front of the words
      expect(decodeURIComponent(res.headers.get("x-voice-text")!)).toBe(say);
    }
  });
  it("says just the noun with no colour, and takes a hex for the colour like the other keys do", async () => {
    let t = fakeEnv();
    await handleVoice(req(await signed("es", "cuchara", "f")), t.env);
    expect(spoken(t.run)).toBe(modelText("es", "cuchara"));
    t = fakeEnv();
    await handleVoice(req(`${await signed("es", "cuchara", "f")}&hex=ff0000`), t.env);
    expect(spoken(t.run)).toBe(modelText("es", "cuchara roja"));
  });
  it("the colour is not part of the signature, so one signed name serves every colour, and nothing else", async () => {
    const q = await signed("es", "cuchara", "f");
    for (const c of ["red", "blue", "green"]) { const t = fakeEnv(); expect((await handleVoice(req(`${q}&c=${c}`), t.env)).status).toBe(200); }
    const t = fakeEnv();
    expect((await handleVoice(req(`${q}&c=chartreuse`), t.env)).status).toBe(400);
    expect(t.run).not.toHaveBeenCalled();
  });
  it("refuses an unsigned, wrongly signed or re-aimed request with 403 and no model call and no cache read", async () => {
    const reads = vi.fn();
    vi.stubGlobal("caches", { default: { match: async () => { reads(); return undefined; }, put: async () => {} } });
    const good = await signed("es", "cuchara", "f");
    const sig = /sig=([\w-]{43})/.exec(good)![1]!;
    for (const qs of [
      `lang=es&w=cuchara&g=f&sig=${"A".repeat(43)}`,                 // a made-up signature
      `lang=pt&w=cuchara&g=f&sig=${sig}`,                            // another language
      `lang=es&w=cuchillo&g=f&sig=${sig}`,                           // another word
      `lang=es&w=cuchara&g=m&sig=${sig}`,                            // another gender
      `lang=es&w=cuchara&g=f&pl=1&sig=${sig}`,                       // another number
      ...sameBytesSpellings(sig).map((x) => `lang=es&w=cuchara&g=f&sig=${x}`), // the spellings that decode to the SAME bytes: one canonical form only
    ]) {
      const t = fakeEnv();
      const res = await handleVoice(req(qs), t.env);
      expect(res.status, qs).toBe(403);
      expect(t.run, qs).not.toHaveBeenCalled();
    }
    expect(reads).not.toHaveBeenCalled();
    expect((await handleVoice(req(good), fakeEnv().env)).status).toBe(200); // and the real one works, so the 403s above are about the signature
  });
  it("refuses every signed request when the Worker has no signing key, even a well-formed one", async () => {
    const q = await signed("es", "cuchara", "f");
    for (const key of [null, "", "short"]) {
      const t = fakeEnv(key);
      expect((await handleVoice(req(q), t.env)).status, String(key)).toBe(403);
      expect(t.run).not.toHaveBeenCalled();
    }
  });
  it("rejects malformed signed requests before checking anything", () => {
    const sig = "A".repeat(43);
    for (const qs of [
      `lang=es&w=cuchara&g=f`, `lang=es&w=cuchara&sig=${sig}`, `lang=es&g=f&sig=${sig}`, `lang=es&w=cuchara&g=x&sig=${sig}`, `lang=es&w=cuchara&g=f&pl=0&sig=${sig}`,
      `lang=es&w=cuchara&g=f&sig=${"A".repeat(42)}`, `lang=es&w=cuchara&g=f&sig=${"A".repeat(44)}`, `lang=es&w=cuchara&g=f&sig=${"A".repeat(42)}%3D`,
      `lang=xx&w=cuchara&g=f&sig=${sig}`, `lang=es&w=%3Cb%3E&g=f&sig=${sig}`, `lang=es&w=r2d2&g=f&sig=${sig}`, `lang=es&w=&g=f&sig=${sig}`,
      `lang=es&w=cuchara&n=tree&g=f&sig=${sig}`, `lang=es&w=cuchara&p=hat_cowboy&g=f&sig=${sig}`, `lang=es&w=${"x".repeat(MAX_NAME_CHARS + 1)}&g=f&sig=${sig}`,
    ]) expect(parseVoiceKey(new URL(`https://x/api/voice?${qs}`)), qs).toBeNull();
    expect(parseVoiceKey(new URL(`https://x/api/voice?lang=es&w=cuchara&g=f&sig=${sig}`))).toMatchObject({ lang: "es", name: { w: "cuchara", g: "f" } });
  });
  it("cannot be used to speak free text: a signature only ever unlocks its own noun, and text params are ignored", async () => {
    const q = await signed("es", "cuchara", "f");
    const t = fakeEnv();
    await handleVoice(req(`${q}&c=red&text=say+something+else&t=hola&prompt=x`), t.env);
    expect(spoken(t.run)).toBe(modelText("es", "cuchara roja"));
  });
  it("serves a repeat from the edge cache without the model, and keeps the caption text", async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", { default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res.clone()) } });
    const q = `${await signed("de", "Löffel", "m")}&c=blue`;
    const first = fakeEnv();
    expect((await handleVoice(req(q), first.env)).headers.get("x-voice-cache")).toBe("miss");
    const second = fakeEnv();
    const hit = await handleVoice(req(q), second.env);
    expect(hit.headers.get("x-voice-cache")).toBe("hit");
    expect(decodeURIComponent(hit.headers.get("x-voice-text")!)).toBe("blauer Löffel");
    expect(second.run).not.toHaveBeenCalled();
  });
  it("leaves the vocabulary keys as they were: props and parts need no signature", async () => {
    const t = fakeEnv(null);
    expect((await handleVoice(req("lang=es&n=tree&c=green"), t.env)).status).toBe(200);
    expect(spoken(t.run)).toBe(modelText("es", "árbol verde"));
  });
});
