import { describe, expect, it } from "vitest";
import { MOOD_LOOPS, MOODS, moodForKeyword, semitoneHz } from "../shared/liveplay";

describe("moodForKeyword", () => {
  it("maps the spec phrases", () => {
    expect(moodForKeyword("start adventure!")).toEqual({ mood: "joy", playTheme: false });
    expect(moodForKeyword("Danger, attack!")).toEqual({ mood: "danger", playTheme: false });
    expect(moodForKeyword("play my theme")).toEqual({ mood: "triumph", playTheme: true });
  });
  it("maps story words and bare mood names", () => {
    expect(moodForKeyword("a spooky secret")?.mood).toBe("mystery");
    expect(moodForKeyword("time to sleep")?.mood).toBe("calm");
    expect(moodForKeyword("mystery")?.mood).toBe("mystery");
    expect(moodForKeyword("the weather is fine")).toBeNull();
  });
});

describe("MOOD_LOOPS", () => {
  it("covers every mood with an 8-beat loop", () => {
    for (const mood of MOODS) {
      expect(MOOD_LOOPS[mood].melody).toHaveLength(8);
      expect(MOOD_LOOPS[mood].bassPattern).toHaveLength(8);
      expect(MOOD_LOOPS[mood].bpm).toBeGreaterThan(0);
    }
  });
  it("danger is faster than calm", () => {
    expect(MOOD_LOOPS.danger.bpm).toBeGreaterThan(MOOD_LOOPS.calm.bpm);
  });
  it("semitone math hits octaves", () => {
    expect(semitoneHz(110, 12)).toBeCloseTo(220);
    expect(semitoneHz(110, 0)).toBe(110);
  });
});
