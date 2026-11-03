import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { say, stopSay, toggleSound } from "../src/features/game/world/runtime/audio";

/**
 * Speech twin (carousel §11.1 `tell`): scene prompts speak while the
 * toast pill always shows, so muted play stays fully playable.
 */
describe("speech twin", () => {
  const realWindow = (globalThis as any).window;
  const spoken: string[] = [];
  let cancels = 0;

  beforeEach(() => {
    spoken.length = 0;
    cancels = 0;
    (globalThis as any).window = {
      speechSynthesis: {
        speak: (u: any) => {
          spoken.push(u.text);
        },
        cancel: () => {
          cancels++;
        },
      },
    };
    // say() constructs this; the fake engine only reads .text.
    (globalThis as any).SpeechSynthesisUtterance = function (this: any, text: string) {
      this.text = text;
    };
  });

  afterEach(() => {
    (globalThis as any).window = realWindow;
  });

  it("speaks scene copy in en-US when sound is on", () => {
    const seen: any[] = [];
    (globalThis as any).window.speechSynthesis.speak = (u: any) => {
      seen.push({ text: u.text, lang: u.lang });
    };
    say("Go pop the BIG bubble.");
    expect(seen).toEqual([{ text: "Go pop the BIG bubble.", lang: "en-US" }]);
  });

  it("stays silent while muted and stops speech on mute", () => {
    toggleSound(); // off
    try {
      say("Go pop the BIG bubble.");
      expect(spoken).toEqual([]);
    } finally {
      toggleSound(); // back on
    }
    expect(cancels).toBeGreaterThan(0);
  });

  it("no-ops without a speech engine", () => {
    (globalThis as any).window = {};
    expect(() => say("Hello.")).not.toThrow();
    expect(() => stopSay()).not.toThrow();
  });
});
