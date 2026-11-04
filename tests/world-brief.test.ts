// shared/worldBrief.ts: the pure rules of generated worlds (docs/specs/generated-worlds-spec.md section 0). A brief the model wrote is validated here and never trusted; a colour is moved into its brightness band;
// the image prompts are templates around ONE validated sentence; a signed ticket is the only thing that can make the Worker paint, and it paints only the sentence inside it.
import { describe, expect, it } from "vitest";
import {
  BANDS, BASES, OUTDOOR_BASES, TICKET_TTL_MS, briefPrompt, buildLook, cleanSentence, clampLightness, clampPalette, deriveDay, deriveNight, farPrompt, fromHsl, isHex, isLookId, midPrompt,
  newLookId, parseBrief, parseLook, signTicket, toHsl, verifyTicket, type Palette,
} from "../shared/worldBrief";

const safe = () => true;
const DAY: Palette = { sky: ["#8a7bee", "#ff9ecd", "#ffd59e"], fog: "#ffd5e5", ground: "#a8e6a3" };
const NIGHT: Palette = { sky: ["#0a0820", "#241a52", "#4a2f7a"], fog: "#2a1f4a", ground: "#2d5a47" };
const BRIEF = { name: "Sweet Sunset", day: DAY, night: NIGHT, far: "A low round sun glows over a level line of soft purple hills in a peachy sky.", mid: "Rounded gumdrop hills with swirly lollipop trees, a candy cottage, a striped lamp post and a jelly bean rock.", say: "Let's explore this sweet place together!" };
const lightness = (h: string) => toHsl(h)[2];

describe("colour", () => {
  it("isHex takes exactly #rrggbb", () => {
    for (const ok of ["#000000", "#FFaa09", "#1d2470"]) expect(isHex(ok), ok).toBe(true);
    for (const bad of ["#fff", "000000", "#12345g", "#1234567", "", 5, null, "rgb(1,2,3)"]) expect(isHex(bad), String(bad)).toBe(false);
  });
  it("HSL round-trips a colour to within one step per channel", () => {
    for (const c of ["#ff5a4d", "#52b7ff", "#2b7f70", "#f4f7ff", "#10151f"]) {
      const [h, s, l] = toHsl(c);
      const back = fromHsl(h, s, l), a = parseInt(c.slice(1), 16), b = parseInt(back.slice(1), 16);
      for (const sh of [16, 8, 0]) expect(Math.abs(((a >> sh) & 255) - ((b >> sh) & 255)), `${c} -> ${back}`).toBeLessThanOrEqual(2);
    }
  });
  it("clampLightness moves a colour into its band and keeps its hue, and leaves a colour already inside it alone", () => {
    const dark = clampLightness("#220044", 0.4, 0.9);
    expect(lightness(dark)).toBeGreaterThanOrEqual(0.39);
    expect(Math.abs(toHsl(dark)[0] - toHsl("#220044")[0])).toBeLessThan(3);
    const light = clampLightness("#ffeeff", 0.05, 0.3);
    expect(lightness(light)).toBeLessThanOrEqual(0.31);
    expect(clampLightness("#808080", 0.2, 0.8)).toBe("#808080");
  });
  it("clampPalette puts a day palette in the light band and a night one in the dark band, whatever it was", () => {
    const wrongDay = clampPalette(NIGHT, "day"), wrongNight = clampPalette(DAY, "night");
    for (const c of wrongDay.sky) expect(lightness(c)).toBeGreaterThanOrEqual(BANDS.day.sky[0] - 0.01);
    for (const c of wrongNight.sky) expect(lightness(c)).toBeLessThanOrEqual(BANDS.night.sky[1] + 0.01);
    expect(lightness(wrongNight.ground)).toBeLessThanOrEqual(BANDS.night.ground[1] + 0.01);
    expect(lightness(wrongDay.fog)).toBeGreaterThanOrEqual(BANDS.day.fog[0] - 0.01);
  });
  it("a night derived from a day is dark and a day derived from a night is light, in both directions", () => {
    const n = deriveNight(DAY), d = deriveDay(NIGHT);
    for (const c of [...n.sky, n.fog, n.ground]) expect(isHex(c)).toBe(true);
    for (const c of n.sky) expect(lightness(c)).toBeLessThanOrEqual(0.31);
    for (const c of d.sky) expect(lightness(c)).toBeGreaterThanOrEqual(0.37);
  });
});

describe("cleanSentence", () => {
  it("takes a plain sentence, tidies whitespace and quotes, and refuses short, long, linked or unsafe ones", () => {
    expect(cleanSentence('  A  low "round"\n sun glows over soft hills.  ', safe)).toBe("A low round sun glows over soft hills.");
    expect(cleanSentence("Too short", safe)).toBeNull();
    expect(cleanSentence("x".repeat(200), safe)).toBeNull();
    for (const bad of ["Visit https://example.test for more hills and things", "Write to me@mail.test about hills and trees", "Hills with <script> and trees all over", 7, null, undefined]) expect(cleanSentence(bad, safe), String(bad)).toBeNull();
    expect(cleanSentence("A perfectly nice sentence about hills.", () => false)).toBeNull();                      // the caller's child-safe check has the last word
  });
});

describe("parseBrief", () => {
  const ok = (raw: unknown, base: (typeof BASES)[number] = "garden") => parseBrief(raw, { base, safe });
  it("accepts a good outdoor brief and returns a fresh object with the colours in their bands", () => {
    const r = ok({ ...BRIEF, extra: "dropped", props: ["tree"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.brief).sort()).toEqual(["day", "far", "kind", "mid", "name", "night", "room", "say"]);
    expect(r.brief.kind).toBe("outdoor");
    expect(r.brief.room).toBeNull();
    expect(r.brief.name).toBe("Sweet Sunset");
    for (const c of r.brief.night.sky) expect(lightness(c)).toBeLessThanOrEqual(0.31);
  });
  it("moves a night palette that is too bright, and a day palette that is too dark, into their bands (no unreadable world)", () => {
    const r = ok({ ...BRIEF, day: NIGHT, night: DAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const c of r.brief.day.sky) expect(lightness(c)).toBeGreaterThanOrEqual(0.37);
    for (const c of r.brief.night.sky) expect(lightness(c)).toBeLessThanOrEqual(0.31);
  });
  it("derives the missing look from the one given, and refuses a brief with neither", () => {
    const noNight = ok({ ...BRIEF, night: undefined }), noDay = ok({ ...BRIEF, day: undefined });
    expect(noNight.ok && noDay.ok).toBe(true);
    if (noNight.ok) for (const c of noNight.brief.night.sky) expect(lightness(c)).toBeLessThanOrEqual(0.31);
    if (noDay.ok) for (const c of noDay.brief.day.sky) expect(lightness(c)).toBeGreaterThanOrEqual(0.37);
    expect(ok({ ...BRIEF, day: undefined, night: undefined })).toEqual({ ok: false, reason: "no palette" });
  });
  it("refuses what it cannot trust: a bad colour, a wrong sky length, a missing sentence, a long name, a declined answer, a non-object", () => {
    for (const bad of [
      { ...BRIEF, day: { ...DAY, fog: "pink" } }, { ...BRIEF, day: { ...DAY, sky: ["#112233", "#445566"] } }, { ...BRIEF, far: "" }, { ...BRIEF, mid: 5 },
      { ...BRIEF, name: "A name that is far too long to ever fit on a card" }, { ok: false }, null, "text", [BRIEF],
    ]) expect(ok(bad).ok, JSON.stringify(bad)?.slice(0, 60)).toBe(false);
  });
  it("runs every sentence through the caller's child-safe check", () => {
    const bad = (s: string) => !/lollipop/i.test(s);
    expect(parseBrief(BRIEF, { base: "garden", safe: bad })).toEqual({ ok: false, reason: "mid" });
    expect(parseBrief({ ...BRIEF, name: "Lollipop Land" }, { base: "garden", safe: bad })).toEqual({ ok: false, reason: "name" });
    const r = parseBrief({ ...BRIEF, say: "A friendly hello for you all today" }, { base: "garden", safe: (s) => !/hello/i.test(s) });
    expect(r.ok && r.brief.say).toBe("Let's explore Sweet Sunset together!");                                    // (a bad `say` is replaced, not fatal)
  });
  it("an indoor brief needs a room block, takes only closed-list walls and floors (else the plain defaults) and has no painted layers", () => {
    const room = { wall: "stars", floor: "carpet", accent: "#ff77aa" };
    const r = ok({ name: "Pirate Room", day: DAY, night: NIGHT, room, say: "Ahoy, explorer, welcome aboard!" }, "room");
    expect(r.ok && r.brief.kind === "indoor" && r.brief.far === "" && r.brief.mid === "").toBe(true);
    expect(r.ok && r.brief.room?.wall).toBe("stars");
    const odd = ok({ name: "Odd Room", day: DAY, room: { wall: "lava", floor: "moss", accent: "red" } }, "room");
    expect(odd.ok && odd.brief.room).toEqual({ wall: "plain", floor: "wood", accent: "#ff9d5c" });
    expect(ok({ name: "No Room", day: DAY }, "room")).toEqual({ ok: false, reason: "room" });
    const black = ok({ name: "Dark Room", day: DAY, room: { wall: "plain", floor: "wood", accent: "#000000" } }, "room"), white = ok({ name: "Pale Room", day: DAY, room: { wall: "plain", floor: "wood", accent: "#ffffff" } }, "room");
    expect(black.ok && lightness(black.brief.room!.accent)).toBeGreaterThanOrEqual(0.29);                         // (an accent colour stays a visible colour, neither black nor white)
    expect(white.ok && lightness(white.brief.room!.accent)).toBeLessThanOrEqual(0.81);
    const same = ok({ name: "Same Both", day: DAY, room }, "room");
    expect(same.ok && same.brief.night).toEqual(same.ok && same.brief.day);                                         // (indoors is the same at any hour)
  });
});

describe("briefPrompt", () => {
  it("quotes the child's words the way the Worker's echo rule expects, capped and with no quotes or line breaks of their own", () => {
    const p = briefPrompt('a "candy"\nforest at sunset', "garden");
    expect(p).toContain('The child said: "a candy forest at sunset"');
    expect(briefPrompt("x".repeat(500), "garden").match(/The child said: "(x+)"/)![1]!.length).toBe(200);
  });
  it("names the base theme, asks for one JSON object, forbids repeating the child's words, and gives the outdoor shape or the indoor shape", () => {
    const out = briefPrompt("candy", "snow"), room = briefPrompt("candy", "room");
    expect(out).toContain('"snow" theme');
    expect(out).toMatch(/ONE JSON object/);
    expect(out).toMatch(/Never repeat the child's words/);
    expect(out).toContain('"far"');
    expect(out).toContain('"mid"');
    expect(room).toContain('"room"');
    expect(room).not.toContain('"far"');
    for (const w of ["stripes", "stars", "dots", "plain", "wood", "carpet", "tiles"]) expect(room).toContain(w);
  });
});

describe("image prompts", () => {
  it("the far band prompt wraps the validated sentence, asks for a level horizon and no text, and differs by look", () => {
    const day = farPrompt(BRIEF.far, "day"), night = farPrompt(BRIEF.far, "night");
    for (const p of [day, night]) { expect(p).toContain(BRIEF.far); expect(p).toMatch(/Level horizon/); expect(p).toMatch(/no text/); }
    expect(day).toMatch(/daytime/);
    expect(night).toMatch(/stars/);
    expect(night).toMatch(/moon/);
    expect(day).not.toMatch(/moon/);
  });
  it("the mid strip prompt asks for the whole width, discrete things, pure black and no text (the wording that fixed the Junkyard)", () => {
    const p = midPrompt(BRIEF.mid);
    expect(p).toContain(BRIEF.mid);
    for (const part of ["WHOLE width", "PURE SOLID BLACK", "#000000", "no text", "no ground line", "all different"]) expect(p, part).toMatch(new RegExp(part, "i"));
  });
});

describe("signed art tickets", () => {
  const SECRET = "test-secret-not-a-real-key";
  const NOW = 1_700_000_000_000;
  const T = { k: "far" as const, look: "night" as const, s: BRIEF.far, exp: NOW + TICKET_TTL_MS };
  it("a signed ticket verifies and gives back exactly what was signed", async () => {
    const tk = await signTicket(SECRET, T);
    expect(await verifyTicket(SECRET, tk, NOW)).toEqual(T);
    const mid = await signTicket(SECRET, { k: "mid", s: BRIEF.mid, exp: NOW + 1000 });
    expect(await verifyTicket(SECRET, mid, NOW)).toEqual({ k: "mid", s: BRIEF.mid, exp: NOW + 1000 });
  });
  it("is refused with another secret, a changed sentence, a changed signature, an expired time, or any non-ticket", async () => {
    const tk = await signTicket(SECRET, T);
    const [body, sig] = tk.split(".") as [string, string];
    expect(await verifyTicket("another-secret", tk, NOW)).toBeNull();
    const forged = btoa(JSON.stringify({ k: "far", look: "night", s: "Something else entirely painted here", exp: T.exp })).replace(/=+$/, "");
    expect(await verifyTicket(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    expect(await verifyTicket(SECRET, `${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, NOW)).toBeNull();
    expect(await verifyTicket(SECRET, tk, T.exp + 1)).toBeNull();
    for (const junk of ["", "x", "a.b.c", ".", null, undefined, 5, {}, "x".repeat(2000)]) expect(await verifyTicket(SECRET, junk, NOW), String(junk).slice(0, 20)).toBeNull();
  });
  it("is domain-separated: a plain HMAC of the same body (as another feature signs) is not an art ticket", async () => {
    const tk = await signTicket(SECRET, T);
    const body = tk.split(".")[0]!;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const plain = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    const b64 = btoa(String.fromCharCode(...plain)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyTicket(SECRET, `${body}.${b64}`, NOW)).toBeNull();
  });
  it("a far ticket must name a look, and the ticket is small", async () => {
    const noLook = await signTicket(SECRET, { k: "far", s: BRIEF.far, exp: NOW + 1000 });
    expect(await verifyTicket(SECRET, noLook, NOW)).toBeNull();
    expect((await signTicket(SECRET, T)).length).toBeLessThan(600);
  });
});

describe("ids and stored looks", () => {
  it("a look id is gen- and ten hex digits, from random bytes by default, and isLookId is strict", () => {
    expect(newLookId(Uint8Array.from([0, 1, 255, 16, 171]))).toBe("gen-0001ff10ab");
    expect(isLookId(newLookId())).toBe(true);
    expect(newLookId()).not.toBe(newLookId());
    for (const bad of ["gen-0001ff10a", "gen-0001ff10abc", "GEN-0001ff10ab", "gen-0001ff10aG", "../etc", "", 5, null]) expect(isLookId(bad), String(bad)).toBe(false);
  });
  it("buildLook keeps the brief's palettes, starts with no art and says it is AI-made; parseLook reads it back and clamps what it reads", () => {
    const r = parseBrief(BRIEF, { base: "garden", safe });
    if (!r.ok) throw new Error("brief");
    const look = buildLook(r.brief, "garden", "gen-0123456789");
    expect(look.art).toEqual({ farDay: false, farNight: false, mid: false });
    expect(look.aiMade).toBe(true);
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    const hostile = { ...look, day: NIGHT, night: DAY, name: "x".repeat(100) };
    const back = parseLook(hostile)!;
    expect(back.name.length).toBeLessThanOrEqual(28);
    for (const c of back.night.sky) expect(lightness(c)).toBeLessThanOrEqual(0.31);
  });
  it("an indoor look round-trips through parseLook: its night palette is its day palette and is NOT darkened into the night band", () => {
    const r = parseBrief({ name: "Pirate Room", day: DAY, room: { wall: "stars", floor: "wood", accent: "#ff7744" } }, { base: "room", safe });
    if (!r.ok) throw new Error("brief");
    const look = buildLook(r.brief, "room", "gen-0123456789");
    expect(look.night).toEqual(look.day);
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    expect(lightness(parseLook(look)!.night.sky[0]!)).toBeGreaterThan(0.35);
  });
  it("parseLook refuses a look with a bad id, base, kind, palette or version", () => {
    const r = parseBrief(BRIEF, { base: "garden", safe });
    if (!r.ok) throw new Error("brief");
    const good = buildLook(r.brief, "garden", "gen-0123456789");
    for (const bad of [{ ...good, id: "kid-world" }, { ...good, base: "moon" }, { ...good, kind: "both" }, { ...good, day: { ...good.day, fog: "x" } }, { ...good, v: 2 }, null, "x", 3]) expect(parseLook(bad), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
  });
  it("the closed lists are the ones the spec names", () => {
    expect([...OUTDOOR_BASES]).toEqual(["garden", "sky", "junk", "beach", "snow"]);
    expect([...BASES]).toEqual(["garden", "sky", "junk", "beach", "snow", "room"]);
  });
});
