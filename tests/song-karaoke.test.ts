import { describe, expect, it } from "vitest";
import { KARAOKE_HOLD_S, KARAOKE_PEEK_S, cleanLines, karaokeAt, lyricsForCut, parseLyricSections, type CutLine } from "../shared/songKaraoke";

// The shape Mureka's finished song carries (measured on a real one, 2026-11-04): sections of lines, each line with start/end in ms and a start for every word.
const SECTIONS = [
  { section_type: "verse", start: 22000, end: 31000, lines: [
    { start: 22600, end: 25280, text: "Little cat naps on warm hay", words: [{ start: 22600, text: "Little " }, { start: 23280, text: "cat " }, { start: 23640, text: "naps " }, { start: 23960, text: "on " }, { start: 24320, text: "warm " }, { start: 24880, text: "hay" }] },
    { start: 27480, end: 30240, text: "Purring low till end of day", words: [{ start: 27480 }, { start: 28160 }, { start: 28600 }, { start: 29000 }, { start: 29400 }, { start: 29800 }] },
  ] },
  { section_type: "chorus", start: 31000, end: 40000, lines: [{ start: 32000, end: 34000, text: "Sing it again", words: [{ start: 32000 }, { start: 32700 }, { start: 33300 }] }] },
];

describe("reading the provider's timed lyrics", () => {
  it("keeps every line with its start, end, text and the start of each word", () => {
    const lines = parseLyricSections(SECTIONS);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ s: 22600, e: 25280, t: "Little cat naps on warm hay", w: [22600, 23280, 23640, 23960, 24320, 24880] });
    expect(lines.map((l) => l.s)).toEqual([22600, 27480, 32000]);
  });
  it("puts lines in time order even when the sections come in another order", () => {
    expect(parseLyricSections([SECTIONS[1], SECTIONS[0]]).map((l) => l.s)).toEqual([22600, 27480, 32000]);
  });
  it("drops what is not a line: no text, an end before the start, a time that is not a number, a time out of range", () => {
    const lines = parseLyricSections([{ lines: [
      { start: 1000, end: 2000, text: "   " },
      { start: 3000, end: 2000, text: "backwards" },
      { start: "1", end: 2000, text: "string time" },
      { start: -5, end: 2000, text: "negative" },
      { start: 1000, end: 1e12, text: "far future" },
      null, "x", { text: "no times" },
      { start: 4000, end: 5000, text: "good one" },
    ] }]);
    expect(lines.map((l) => l.t)).toEqual(["good one"]);
  });
  it("drops the word marks when they do not match the words (a rule, not a guess), and keeps the line", () => {
    const lines = parseLyricSections([{ lines: [{ start: 1000, end: 3000, text: "one two three", words: [{ start: 1000 }, { start: 2000 }] }] }]);
    expect(lines).toEqual([{ s: 1000, e: 3000, t: "one two three" }]);
  });
  it("cleans the text: control characters and runs of spaces, at most 120 characters", () => {
    const [l] = parseLyricSections([{ lines: [{ start: 0, end: 1000, text: "a\u0000b\n\n  c " + "x".repeat(300) }] }]);
    expect(l!.t.length).toBeLessThanOrEqual(120);
    expect(l!.t).toMatch(/^a b c x+$/);
  });
  it("keeps at most 80 lines and never throws on a shape it does not know", () => {
    const many = [{ lines: Array.from({ length: 200 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 500, text: `line ${i}` })) }];
    expect(parseLyricSections(many)).toHaveLength(80);
    for (const bad of [undefined, null, 5, "x", {}, [null], [{ lines: "no" }], [{ lines: [[]] }]]) expect(parseLyricSections(bad)).toEqual([]);
  });
  it("the compact form round-trips: what the Worker sends and the browser keeps reads back the same, and junk in it is dropped", () => {
    const lines = parseLyricSections(SECTIONS);
    expect(cleanLines(JSON.parse(JSON.stringify(lines)))).toEqual(lines);
    expect(cleanLines([{ s: 1, e: 2, t: "ok" }, { s: 1, e: 0, t: "backwards" }, 7, null])).toEqual([{ s: 1, e: 2, t: "ok" }]);
    expect(cleanLines("nope")).toEqual([]);
  });
});

describe("moving the lines onto the loop the party plays", () => {
  const lines = parseLyricSections(SECTIONS);
  it("counts from the start of the cut, and lights each word at its own time", () => {
    const cut = lyricsForCut(lines, 20, 30); // the cut begins 20 s into the song and is 30 s long
    expect(cut).toHaveLength(3);
    expect(cut[0]!.at).toBeCloseTo(2.6, 6);
    expect(cut[0]!.end).toBeCloseTo(5.28, 6);
    expect(cut[0]!.words.map((w) => w.t)).toEqual(["Little", "cat", "naps", "on", "warm", "hay"]);
    expect(cut[0]!.words[1]!.at).toBeCloseTo(3.28, 6);
  });
  it("drops a line that is not in the cut at all, and trims one that is only partly in it", () => {
    expect(lyricsForCut(lines, 26, 30).map((l) => l.text)).toEqual(["Purring low till end of day", "Sing it again"]);
    expect(lyricsForCut(lines, 0, 24).map((l) => l.text)).toEqual(["Little cat naps on warm hay"]); // the others start after the cut ends
    const partly = lyricsForCut(lines, 23, 30); // the cut starts while the first line is being sung
    expect(partly[0]!.text).toBe("Little cat naps on warm hay");
    expect(partly[0]!.at).toBe(0);
    expect(partly[0]!.words[0]!.at).toBe(0); // a word before the cut is lit from the start
  });
  it("spreads the words over the line when the provider gave no word marks", () => {
    const [l] = lyricsForCut([{ s: 10_000, e: 14_000, t: "a b c d" }], 10, 20);
    expect(l!.words.map((w) => w.at)).toEqual([0, 1, 2, 3]);
  });
  it("is empty for no lines or a cut with no length", () => {
    expect(lyricsForCut([], 0, 30)).toEqual([]);
    expect(lyricsForCut(lines, 0, 0)).toEqual([]);
    expect(lyricsForCut(lines, Number.NaN, 30)).toEqual([]);
  });
});

describe("what the karaoke shows at each moment of the loop", () => {
  const w = (t: string, at: number) => ({ t, at });
  const A: CutLine = { at: 2, end: 5, text: "one two three", words: [w("one", 2), w("two", 3), w("three", 4)] };
  const B: CutLine = { at: 6, end: 9, text: "four five", words: [w("four", 6), w("five", 7)] };
  const C: CutLine = { at: 20, end: 23, text: "six", words: [w("six", 20)] };
  const lines = [A, B, C];
  const LOOP = 30;

  it("has nothing for a song with no times", () => {
    expect(karaokeAt([], 5, LOOP)).toEqual({ index: -1, line: null, lit: 0, prev: null, next: null });
  });
  it("before the first line shows the first line coming, once it is close", () => {
    expect(karaokeAt(lines, 0, LOOP)).toMatchObject({ index: -1, line: null, next: A });
    expect(karaokeAt([{ ...A, at: 20, end: 22, words: [w("one", 20)] }], 0, LOOP).next).toBeNull(); // far away: not yet
  });
  it("lights the line a hair before it is sung, and its words as they come", () => {
    expect(karaokeAt(lines, 1.8, LOOP).index).toBe(-1);
    const v = karaokeAt(lines, 1.9, LOOP);
    expect(v).toMatchObject({ index: 0, line: A, lit: 0, next: B, prev: null });
    expect(karaokeAt(lines, 2.0, LOOP).lit).toBe(1);
    expect(karaokeAt(lines, 3.1, LOOP).lit).toBe(2);
    expect(karaokeAt(lines, 4.5, LOOP).lit).toBe(3);
  });
  it("moves straight to the next line when it begins, and keeps the previous one for the dim line above", () => {
    expect(karaokeAt(lines, 5.5, LOOP).index).toBe(0); // held a moment after its last word
    const v = karaokeAt(lines, 6.2, LOOP);
    expect(v).toMatchObject({ index: 1, line: B, prev: A, next: C });
  });
  it("in a gap between lines shows no line, and the next one only when it is close", () => {
    expect(9 + KARAOKE_HOLD_S).toBeLessThan(10);
    const far = karaokeAt(lines, 10, LOOP); // C is ten seconds away
    expect(far).toMatchObject({ index: -1, line: null, prev: B, next: null });
    expect(20 - 14).toBeLessThanOrEqual(KARAOKE_PEEK_S);
    expect(karaokeAt(lines, 14, LOOP)).toMatchObject({ index: -1, line: null, next: C });
  });
  it("after the last line the loop comes round to the first, and shows it when it is close", () => {
    expect(karaokeAt(lines, 24, LOOP).next).toBeNull(); // A is 8 s away round the loop
    expect(karaokeAt(lines, 25, LOOP)).toMatchObject({ index: -1, next: A }); // 7 s away: shown
    expect(karaokeAt(lines, 29, LOOP)).toMatchObject({ index: -1, next: A });
  });
  it("wraps a song time that has gone round the loop, and reads a negative or broken one as the start", () => {
    expect(karaokeAt(lines, LOOP + 3.1, LOOP)).toEqual(karaokeAt(lines, 3.1, LOOP));
    expect(karaokeAt(lines, LOOP * 5 + 6.2, LOOP).index).toBe(1);
    expect(karaokeAt(lines, -1, LOOP)).toEqual(karaokeAt(lines, 29, LOOP));
    expect(karaokeAt(lines, Number.NaN, LOOP)).toEqual(karaokeAt(lines, 0, LOOP));
  });
  it("a single line never offers itself as the next line while it is sung", () => {
    expect(karaokeAt([A], 3, LOOP)).toMatchObject({ index: 0, next: null });
  });
});
