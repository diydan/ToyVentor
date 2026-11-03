import { describe, expect, it } from "vitest";
import { parseThemeReply } from "../shared/songLyrics";
import { vocalPromptFor } from "../shared/songCards";

const GOOD = {
  name: "Zippy Roadster",
  mood: "bouncy",
  tempo: "fast",
  instruments: ["drums", "bells"],
  verse: ["Wheels go round and round", "Down the sunny road", "Little engine hums a tune", "Off we go, off we go"],
  chorus: ["Zippy Roadster, zoom zoom zoom", "Zippy Roadster, make some room", "Wheels are spinning, hear us sing", "Zippy Roadster is the king"],
};
const ok = (over: Record<string, unknown> = {}, ctx = {}) => parseThemeReply({ ...GOOD, ...over }, ctx);
const reason = (over: Record<string, unknown>, ctx = {}) => {
  const r = ok(over, ctx);
  return r.ok ? "ok" : r.reason;
};

describe("a good reply becomes a checked theme song", () => {
  it("builds the lyrics string itself: [Verse], [Chorus], [Chorus]", () => {
    const r = ok();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.song.name).toBe("Zippy Roadster");
    expect(r.song.lyrics).toBe(`[Verse]\n${GOOD.verse.join("\n")}\n\n[Chorus]\n${GOOD.chorus.join("\n")}\n\n[Chorus]\n${GOOD.chorus.join("\n")}`);
    expect(r.song.lyrics.length).toBeLessThanOrEqual(900);
  });
  it("takes the cards from the closed lists and builds the sung style text from them, nothing else", () => {
    const r = ok();
    if (!r.ok) throw new Error("expected ok");
    expect(r.song.request).toEqual({ mood: "bouncy", tempo: "fast", instruments: ["drums", "bells"] });
    expect(r.song.prompt).toBe(vocalPromptFor(r.song.request));
    expect(r.song.prompt).toMatch(/singer/);
    expect(r.song.prompt).not.toMatch(/instrumental only|no vocals/i);
  });
  it("an unknown mood or tempo becomes the neutral card, and unknown instruments are dropped", () => {
    const r = ok({ mood: "angry", tempo: "warp", instruments: ["kazoo", "piano", "drums", "bells"] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.song.request).toEqual({ mood: "bouncy", tempo: "medium", instruments: ["piano", "drums"] });
  });
  it("lets Kip and the creation's own name keep their capitals", () => {
    expect(reason({ verse: ["Here comes Kip in the car", "Waving to the sun", "Honk honk goes the horn", "Everybody run"] })).toBe("ok");
  });
});

describe("the name", () => {
  it("is refused when empty, long, or not letters", () => {
    expect(reason({ name: "" })).toBe("no_name");
    expect(reason({ name: "One Two Three Four Five Six" })).toBe("name_too_long");
    expect(reason({ name: "Zippy 2000" })).toBe("name_characters");
    expect(reason({ name: "Zippy <b>" })).toBe("name_characters");
    expect(reason({ name: 7 })).toBe("no_name");
  });
  it("is refused when it is a brand or unsafe", () => {
    expect(reason({ name: "Lego Racer" })).toBe("name_unsafe");
    const sing = (name: string) => ({ name, chorus: GOOD.chorus.map((l) => l.replace("Zippy Roadster", name)) });
    expect(reason(sing("Deadly Roadster"))).toBe("ok"); // whole words only: "deadly" is not "dead"
    expect(reason(sing("Dead Roadster"))).toBe("name_unsafe");
  });
  it("may not hand the child's own words back", () => {
    expect(reason({ name: "A Red Racing Car Please" }, { childSaid: "a red racing car please" })).toBe("name_echoes_child");
    expect(reason({}, { childSaid: "a race car" })).toBe("ok"); // too short to count as an echo
  });
  it("runs the caller's own safe-text check", () => {
    expect(reason({}, { extraSafe: (t: string) => !/roadster/i.test(t) })).toBe("name_unsafe");
  });
});

describe("every line", () => {
  const withLine = (line: string) => ({ verse: [line, ...GOOD.verse.slice(1)] });
  it("is refused when it has a digit, a link, an email, or a strange character", () => {
    expect(reason(withLine("Call me on 5551234"))).toBe("verse_characters");
    expect(reason(withLine("Go to www dot toys dot com"))).toBe("ok"); // no link shape: spelled out, harmless words
    expect(reason(withLine("Visit www.toys.com now"))).toBe("verse_unsafe");
    expect(reason(withLine("Mail me at a@b.co"))).toBe("verse_characters");
    expect(reason(withLine("Wheels <go> round"))).toBe("verse_characters");
    expect(reason(withLine("Wheels go round 100 times"))).toBe("verse_characters");
  });
  it("is refused when it is harmful, rude, or a brand", () => {
    expect(reason(withLine("We will kill the engine"))).toBe("verse_unsafe");
    expect(reason(withLine("You are so stupid"))).toBe("verse_unsafe");
    expect(reason(withLine("Faster than a Ferrari today"))).toBe("verse_unsafe");
    expect(reason(withLine("Zoom past the lego town"))).toBe("verse_unsafe");
  });
  it("is refused when a capital shows up after the first word: that is a name of something", () => {
    expect(reason(withLine("Driving with my friend Sarah"))).toBe("verse_capital");
    expect(reason(withLine("Down the road to Paris"))).toBe("verse_capital");
    expect(reason(withLine("Then I wave hello"))).toBe("ok");
  });
  it("is refused when it is too short, too long, or the section is the wrong size", () => {
    expect(reason(withLine("Zoom"))).toBe("verse_line_size");
    expect(reason(withLine("Wheels go round and round and round and round again"))).toBe("verse_line_size");
    expect(reason({ verse: GOOD.verse.slice(0, 2) })).toBe("verse_length");
    expect(reason({ chorus: [...GOOD.chorus, ...GOOD.chorus] })).toBe("chorus_length");
    expect(reason({ verse: "not a list" })).toBe("verse_missing");
  });
  it("may not copy four of the child's words in a row", () => {
    expect(reason({}, { childSaid: "wheels go round and round the sunny road" })).toBe("verse_echoes_child");
  });
});

describe("a THEME song sings the creation's name", () => {
  it("is refused when no chorus line says it", () => {
    expect(reason({ chorus: ["Zoom zoom zoom", "Make some room", "Wheels are spinning, hear us sing", "What a happy thing"] })).toBe("chorus_lacks_name");
  });
  it("is refused when it is too long in all", () => {
    const line = "Wheels go round and round now";
    expect(reason({ verse: Array(6).fill(line), chorus: ["Zippy Roadster, " + "la ".repeat(8), ...Array(5).fill(line)] })).not.toBe("ok");
  });
  it("is refused when the reply is not an object at all", () => {
    expect(parseThemeReply(null)).toEqual({ ok: false, reason: "not_object" });
    expect(parseThemeReply([GOOD])).toEqual({ ok: false, reason: "not_object" });
    expect(parseThemeReply("nope")).toEqual({ ok: false, reason: "not_object" });
  });
});
