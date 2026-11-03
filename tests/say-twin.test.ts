import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, stopSay, toggleSound } from "../src/features/game/world/runtime/audio";
import { resetPromptVoice } from "../src/lib/promptVoice";
import { SCENE_PROMPTS, promptIdForText } from "../src/lib/scenePrompts";

/**
 * Speech twin (carousel §11.1 `tell`): scene prompts speak while the toast pill always shows, so muted play stays fully playable. They speak with the game's one voice,
 * the Gemini clip (src/lib/promptVoice.ts), and NEVER the phone's own (Dan, 2026-11-03: "no phone use for everything in the game").
 */
describe("speech twin", () => {
  const audios: Array<{ url: string; paused: boolean }> = [];
  const phone: string[] = [];

  beforeEach(() => {
    audios.length = 0;
    phone.length = 0;
    resetPromptVoice();
    vi.stubGlobal("Audio", class {
      url: string; paused = false;
      constructor(url: string) { this.url = url; audios.push(this as never); }
      addEventListener() {}
      play() { return Promise.resolve(); }
      pause() { this.paused = true; }
    });
    // A TRIPWIRE: if a prompt is ever spoken through the phone's own engine, `phone` fills and afterEach fails the test.
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    vi.stubGlobal("window", { speechSynthesis: { cancel() { phone.push("cancel"); }, speak(u: { text: string }) { phone.push(u.text); } } });
  });

  afterEach(() => {
    expect(phone, "something used the phone's own voice").toEqual([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("speaks scene copy with its Gemini clip, by id, when sound is on", () => {
    say("Go pop the BIG bubble.");
    expect(audios.map((a) => a.url)).toEqual([`/api/voice?s=${promptIdForText("Go pop the BIG bubble.")}`]);
  });

  it("stays silent while muted, and muting stops a prompt that is still playing", () => {
    say("Go pop the BIG bubble.");
    toggleSound(); // off
    try {
      expect(audios[0]!.paused).toBe(true);
      say("Go pop the BIG bubble.");
      expect(audios).toHaveLength(1); // nothing new was asked for
    } finally {
      toggleSound(); // back on
    }
    say("Go pop the BIG bubble.");
    expect(audios).toHaveLength(2);
  });

  it("says nothing for empty text or for a line that is not in the closed list", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    say("");
    say("Something a child typed.");
    expect(audios).toHaveLength(0);
  });

  it("speaks every line in the list through the clip voice, and never through the phone's", () => {
    for (const p of SCENE_PROMPTS) say(p.text);
    expect(audios).toHaveLength(SCENE_PROMPTS.length);
  });

  it("stopSay stops what is playing", () => {
    say("All done!");
    stopSay();
    expect(audios[0]!.paused).toBe(true);
  });

  it("no-ops without a window or without audio", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("Audio", undefined);
    expect(() => say("Hello.")).not.toThrow();
    expect(() => say("All done!")).not.toThrow();
    expect(() => stopSay()).not.toThrow();
    expect(audios).toHaveLength(0);
  });
});
