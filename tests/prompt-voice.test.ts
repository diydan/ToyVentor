import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_BACKOFF_MS, resetPromptVoice, sayPrompt, stopPrompt } from "../src/lib/promptVoice";
import { SERVER_BACKOFF_MS, resetVoiceBackoff, sayObject, stopObjectVoice } from "../src/lib/propVoice";
import { SCENE_PROMPTS, promptIdForText, scenePromptUrl } from "../src/lib/scenePrompts";

// The client side of the scene prompts: the Gemini clip by id, one at a time, no phone voice, silence (and a minute's rest for the server) when a clip fails.

interface FakeAudio { url: string; paused: boolean; listeners: Record<string, () => void>; play(): Promise<void>; pause(): void }
const audios: FakeAudio[] = [];
let playResult: () => Promise<void> = () => Promise.resolve();
const phone: string[] = [];

beforeEach(() => {
  audios.length = 0;
  phone.length = 0;
  playResult = () => Promise.resolve();
  resetPromptVoice();
  resetVoiceBackoff();
  vi.stubGlobal("Audio", class {
    url: string; paused = false; listeners: Record<string, () => void> = {};
    constructor(url: string) { this.url = url; audios.push(this as never); }
    addEventListener(ev: string, fn: () => void) { this.listeners[ev] = fn; }
    play() { return playResult(); }
    pause() { this.paused = true; }
  });
  // The phone's own voice is a TRIPWIRE: nothing here may speak through it, in any outcome.
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  vi.stubGlobal("window", { speechSynthesis: { cancel() { phone.push("cancel"); }, speak(u: { text: string }) { phone.push(u.text); } } });
});
afterEach(() => {
  expect(phone, "something used the phone's own voice").toEqual([]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BALL = "Go get the ball.";
const ballUrl = () => scenePromptUrl(promptIdForText(BALL)!);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("sayPrompt", () => {
  it("plays the clip of a line in the list, by id, and says so", () => {
    expect(sayPrompt(BALL)).toBe("clip");
    expect(audios.map((a) => a.url)).toEqual([ballUrl()]);
    expect(audios[0]!.url).toMatch(/^\/api\/voice\?s=[0-9a-f]{8}$/);
  });

  it("can ask for every line in the list", () => {
    for (const p of SCENE_PROMPTS) expect(sayPrompt(p.text), p.text).toBe("clip");
    expect(audios.map((a) => a.url)).toEqual(SCENE_PROMPTS.map((p) => scenePromptUrl(p.id)));
  });

  it("speaks nothing that is not EXACTLY a line in the list, asks for nothing, and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const t of ["", "Go get the ball", "go get the ball.", " Go get the ball.", "Go get the ball. ", "Something a child typed.", "Go get the ball. Go get the ball."])
      expect(sayPrompt(t), JSON.stringify(t)).toBe("none");
    expect(audios).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(6); // every one but the empty text, which is just nothing to say
    expect(String(warn.mock.calls[0]![0])).toContain("scripts/scene-prompts.ts");
  });

  it("plays one prompt at a time: a new one stops the one still playing", () => {
    sayPrompt(BALL);
    sayPrompt("All done!");
    expect(audios).toHaveLength(2);
    expect(audios[0]!.paused).toBe(true);
    expect(audios[1]!.paused).toBe(false);
  });

  it("stopPrompt stops the one that is playing, and is harmless when nothing is", () => {
    stopPrompt();
    sayPrompt(BALL);
    stopPrompt();
    expect(audios[0]!.paused).toBe(true);
    expect(() => stopPrompt()).not.toThrow();
  });

  it("falls silent, and leaves the server alone for a minute, when the clip fails to load", () => {
    const t0 = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0); // the failure is stamped with the clock's time
    sayPrompt(BALL, t0);
    audios[0]!.listeners.error!(); // the route answered 404/502/503, or the network is down
    expect(sayPrompt("All done!", t0 + 1)).toBe("none");
    expect(sayPrompt("All done!", t0 + PROMPT_BACKOFF_MS - 1)).toBe("none");
    expect(audios).toHaveLength(1); // nothing was even asked for
    expect(sayPrompt("All done!", t0 + PROMPT_BACKOFF_MS + 1)).toBe("clip");
    expect(audios).toHaveLength(2);
  });

  it("falls silent the same way when play() is rejected for a reason that is the server's, not the browser's", async () => {
    const t0 = Date.now();
    playResult = () => Promise.reject(Object.assign(new Error("no source"), { name: "NotSupportedError" }));
    expect(sayPrompt(BALL, t0)).toBe("clip");
    await tick();
    expect(sayPrompt(BALL, t0 + 1000)).toBe("none");
  });

  it("does not take the browser refusing to start a sound without a tap, or a pause cutting one off, for the server being down", async () => {
    for (const name of ["NotAllowedError", "AbortError"]) {
      resetPromptVoice();
      audios.length = 0;
      playResult = () => Promise.reject(Object.assign(new Error(name), { name }));
      expect(sayPrompt(BALL)).toBe("clip");
      await tick();
      playResult = () => Promise.resolve();
      expect(sayPrompt(BALL), name).toBe("clip"); // asked again at once: no minute's rest
      expect(audios, name).toHaveLength(2);
    }
  });

  it("ignores a failure that arrives after a newer prompt has taken over", async () => {
    sayPrompt(BALL);
    sayPrompt("All done!");
    audios[0]!.listeners.error!(); // the first clip's late failure
    expect(sayPrompt("Already done there.")).toBe("clip");
    expect(audios).toHaveLength(3);
  });

  it("says nothing, and does not throw, on a device with no audio", () => {
    vi.stubGlobal("Audio", undefined);
    expect(sayPrompt(BALL)).toBe("none");
    vi.stubGlobal("Audio", class { constructor() { throw new Error("no audio"); } });
    expect(sayPrompt(BALL)).toBe("none");
  });
});

describe("one voice at a time across prompts and object names", () => {
  it("a name tapped while a prompt is playing stops the prompt", () => {
    sayPrompt(BALL);
    expect(sayObject({ noun: "tree", color: "green", lang: "en", text: "green tree" })).toBe("clip");
    expect(audios[0]!.paused).toBe(true);
    expect(audios[1]!.url).toBe("/api/voice?lang=en&n=tree&c=green");
    expect(audios[1]!.paused).toBe(false);
  });

  it("stopObjectVoice stops a prompt too, and neither touches the phone's voice (the tripwire is in afterEach)", () => {
    sayPrompt(BALL);
    stopObjectVoice();
    expect(audios[0]!.paused).toBe(true);
  });

  it("the object voice and the prompt voice rest independently (their backoffs are separate)", () => {
    const t0 = Date.now();
    sayPrompt(BALL, t0);
    audios[0]!.listeners.error!();
    expect(sayObject({ noun: "tree", color: "green", lang: "en", text: "green tree" }, t0 + 1)).toBe("clip");
    expect(SERVER_BACKOFF_MS).toBe(PROMPT_BACKOFF_MS);
  });
});
